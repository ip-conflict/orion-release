#!/bin/bash
# Backup giornaliero di ORION (cron, come root): dump del database e copia dei file
# caricati. Il ripristino si fa dalla pagina Sistema; a mano, vedi il manuale tecnico.
#   sudo /var/www/<dominio>/scripts/backup.sh <dominio>

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

DB_USER=$(grep -E '^DB_USER=' "$APP_DIR/.env" | cut -d= -f2-)
DB_DATABASE=$(grep -E '^DB_DATABASE=' "$APP_DIR/.env" | cut -d= -f2-)
if [ -z "${DB_DATABASE:-}" ]; then
    errore "DB_DATABASE non presente in $APP_DIR/.env."
    exit 1
fi

# Li legge root e, in sola lettura, l'utente dell'applicazione. Nessun altro.
umask 027
GRUPPO_APP=$(stat -c %G "$APP_DIR" 2>/dev/null || echo orion_app)
mkdir -p "$BACKUP_ROOT/db" "$BACKUP_ROOT/files"
chown root:"$GRUPPO_APP" "$BACKUP_ROOT/db" "$BACKUP_ROOT/files" 2>/dev/null || true
chmod 750 "$BACKUP_ROOT/db" "$BACKUP_ROOT/files"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DUMP_FILE="$BACKUP_ROOT/db/db_${TIMESTAMP}.sql.gz"

log "Avvio dump del database '$DB_DATABASE'..."
if ! sudo -u postgres pg_dump "$DB_DATABASE" | gzip > "$DUMP_FILE"; then
    errore "pg_dump fallito per il database '$DB_DATABASE'."
    rm -f "$DUMP_FILE"
    exit 1
fi

# Un dump vuoto o troncato è peggio di nessun backup.
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
if command -v node >/dev/null 2>&1 && [ -f "$APP_DIR/scripts/cifra-backup.mjs" ]; then
    CHIAVE_DATI=$(grep -E '^ORION_CHIAVE_FILE=' "$APP_DIR/.env" | cut -d= -f2-)
    if ! node "$APP_DIR/scripts/cifra-backup.mjs" "$DUMP_FILE" ${CHIAVE_DATI:+"$CHIAVE_DATI"} >>"$LOG_FILE" 2>&1; then
        log "ATTENZIONE: dump non cifrato (chiave dei dati mancante?): resta in chiaro."
    fi
fi
chown root:"$GRUPPO_APP" "$DUMP_FILE" 2>/dev/null || true
chmod 640 "$DUMP_FILE"
# I dump delle versioni precedenti erano leggibili da tutti.
find "$BACKUP_ROOT/db" -type f -name 'db_*.sql.gz' -exec chown root:"$GRUPPO_APP" {} + -exec chmod 640 {} + 2>/dev/null || true
log "Dump completato: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

# I file caricati non sono nel database: senza questa copia un ripristino avrebbe i
# riferimenti ma non i file.
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

ELIMINATI=$(find "$BACKUP_ROOT/db" -name 'db_*.sql.gz' -type f -mtime +"$GIORNI_CONSERVAZIONE" -print -delete | wc -l)
if [ "$ELIMINATI" -gt 0 ]; then
    log "Rotazione: rimossi $ELIMINATI dump più vecchi di $GIORNI_CONSERVAZIONE giorni."
fi

TOTALE=$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)
log "Backup completato. Spazio occupato da $BACKUP_ROOT: $TOTALE"
