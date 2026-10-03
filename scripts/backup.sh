#!/bin/bash
# ==============================================================================
# Backup automatico di ORION
# ==============================================================================
#
# Esegue ogni giorno:
#   1. un dump compresso del database PostgreSQL (con rotazione)
#   2. una copia speculare dei file caricati (foto, certificati, documenti)
#
# Viene installato da setup.sh (e da update.sh sulle installazioni esistenti)
# in /etc/cron.d/orion-backup ed eseguito come root.
#
# USO MANUALE:
#   sudo /var/www/<dominio>/scripts/backup.sh <dominio>
#
# RIPRISTINO DALL'APPLICAZIONE (strada consigliata):
#   Pagina "Sistema" -> elenco dei backup -> Ripristina. Fa da sola il backup di
#   sicurezza, lavora in una transazione unica e riavvia l'applicazione.
#
# RIPRISTINO A MANO (se l'applicazione non parte più):
#   1. Database:
#        gunzip -c /var/backups/orion/db/db_<data>.sql.gz | sudo -u postgres psql <nome_db>
#      Se il database va ricreato da zero:
#        sudo -u postgres dropdb <nome_db> && sudo -u postgres createdb -O <utente_db> <nome_db>
#        gunzip -c /var/backups/orion/db/db_<data>.sql.gz | sudo -u postgres psql <nome_db>
#   2. File caricati:
#        rsync -a /var/backups/orion/files/ /var/www/<dominio>/
#        chown -R orion_app:orion_app /var/www/<dominio>
#   3. Riavvio: sudo -u orion_app pm2 start Orion
#
# ATTENZIONE: questi backup stanno sulla STESSA macchina dell'applicazione.
# Proteggono da errori applicativi e cancellazioni accidentali, NON dalla rottura
# del server o del disco. Copiare periodicamente /var/backups/orion su un altro
# supporto o su un'altra macchina (es. rsync verso un NAS del Comune).
# ==============================================================================

set -u
set -o pipefail

DOMAIN_NAME="${1:-}"
GIORNI_CONSERVAZIONE="${ORION_BACKUP_RETENTION_DAYS:-30}"
BACKUP_ROOT="/var/backups/orion"
LOG_FILE="/var/log/orion-backup.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [backup] $1" | tee -a "$LOG_FILE"; }
errore() { echo "$(date '+%Y-%m-%d %H:%M:%S') [backup] ERRORE: $1" | tee -a "$LOG_FILE" >&2; }

if [ -z "$DOMAIN_NAME" ]; then
    errore "Nome dominio mancante. Uso: $0 <dominio>"
    exit 1
fi

APP_DIR="/var/www/$DOMAIN_NAME"
if [ ! -f "$APP_DIR/.env" ]; then
    errore "Non trovo $APP_DIR/.env: installazione ORION non valida."
    exit 1
fi

# Legge le credenziali del database dall'installazione live
DB_USER=$(grep -E '^DB_USER=' "$APP_DIR/.env" | cut -d= -f2-)
DB_DATABASE=$(grep -E '^DB_DATABASE=' "$APP_DIR/.env" | cut -d= -f2-)
if [ -z "${DB_DATABASE:-}" ]; then
    errore "DB_DATABASE non presente in $APP_DIR/.env."
    exit 1
fi

# I dump contengono tutto il database (password cifrate, dati sanitari) e la
# copia dei file i certificati medici: li legge root e, in sola lettura,
# l'utente dell'applicazione, che li elenca e li ripristina dalla pagina
# Sistema. Nessun altro utente della macchina.
umask 027
GRUPPO_APP=$(stat -c %G "$APP_DIR" 2>/dev/null || echo orion_app)
mkdir -p "$BACKUP_ROOT/db" "$BACKUP_ROOT/files"
chown root:"$GRUPPO_APP" "$BACKUP_ROOT/db" "$BACKUP_ROOT/files" 2>/dev/null || true
chmod 750 "$BACKUP_ROOT/db" "$BACKUP_ROOT/files"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DUMP_FILE="$BACKUP_ROOT/db/db_${TIMESTAMP}.sql.gz"

# ------------------------------------------------------------------------------
# 1. Dump del database
# ------------------------------------------------------------------------------
log "Avvio dump del database '$DB_DATABASE'..."
if ! sudo -u postgres pg_dump "$DB_DATABASE" | gzip > "$DUMP_FILE"; then
    errore "pg_dump fallito per il database '$DB_DATABASE'."
    rm -f "$DUMP_FILE"
    exit 1
fi

# Un dump vuoto o troncato è peggio di nessun backup: meglio accorgersene subito.
DIMENSIONE=$(stat -c%s "$DUMP_FILE" 2>/dev/null || echo 0)
if [ "$DIMENSIONE" -lt 1000 ]; then
    errore "Il dump risulta sospettosamente piccolo ($DIMENSIONE byte): lo elimino, il backup NON è valido."
    rm -f "$DUMP_FILE"
    exit 1
fi
if ! gzip -t "$DUMP_FILE" 2>/dev/null; then
    errore "Il file di dump è corrotto (gzip -t fallito): lo elimino."
    rm -f "$DUMP_FILE"
    exit 1
fi
chown root:"$GRUPPO_APP" "$DUMP_FILE" 2>/dev/null || true
chmod 640 "$DUMP_FILE"
# I dump delle versioni precedenti erano leggibili da tutti: si sistemano.
find "$BACKUP_ROOT/db" -type f -name 'db_*.sql.gz' -exec chown root:"$GRUPPO_APP" {} + -exec chmod 640 {} + 2>/dev/null || true
log "Dump completato: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

# ------------------------------------------------------------------------------
# 2. Copia dei file caricati
# ------------------------------------------------------------------------------
# I documenti, i certificati e le foto NON sono nel database: senza questa copia
# un ripristino restituirebbe un archivio con i riferimenti ma senza i file.
# Copia speculare (non versionata) per non moltiplicare lo spazio occupato.
log "Copia dei file caricati..."
for CARTELLA in protected_uploads uploads public/logo.png public/logo2.png; do
    ORIGINE="$APP_DIR/$CARTELLA"
    [ -e "$ORIGINE" ] || continue
    DESTINAZIONE="$BACKUP_ROOT/files/$(dirname "$CARTELLA")"
    mkdir -p "$DESTINAZIONE"
    if ! rsync -a --delete "$ORIGINE" "$DESTINAZIONE/"; then
        errore "rsync fallito per $ORIGINE (il backup del database resta valido)."
    fi
done
log "Copia file completata."

# ------------------------------------------------------------------------------
# 3. Rotazione
# ------------------------------------------------------------------------------
ELIMINATI=$(find "$BACKUP_ROOT/db" -name 'db_*.sql.gz' -type f -mtime +"$GIORNI_CONSERVAZIONE" -print -delete | wc -l)
if [ "$ELIMINATI" -gt 0 ]; then
    log "Rotazione: rimossi $ELIMINATI dump più vecchi di $GIORNI_CONSERVAZIONE giorni."
fi

TOTALE=$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)
log "Backup completato. Spazio occupato da $BACKUP_ROOT: $TOTALE"
