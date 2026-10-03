#!/bin/bash

# ==============================================================================
# Script di Aggiornamento per ORION
# ==============================================================================

set -e

# NOTA: dalla versione 3.23 l'aggiornamento si puo' fare anche dalla pagina
# "Sistema" dell'applicazione, senza collegarsi al server. Questo script resta
# per chi preferisce la riga di comando e per le installazioni che non
# partono piu'.

# Colori per i log a schermo
print_info() { echo -e "\n\e[34mINFO:\e[0m $1"; }
print_success() { echo -e "\e[32mSUCCESS:\e[0m $1"; }
print_warning() { echo -e "\e[33mWARNING:\e[0m $1"; }
print_error() { echo -e "\e[31mERROR:\e[0m $1" >&2; }

if [ "$EUID" -ne 0 ]; then
  print_error "Per favore, esegui questo script usando 'sudo'."
  exit 1
fi

read -p "Inserisci il nome dominio dell'istanza da aggiornare (es. orion.miaassociazione.it): " DOMAIN_NAME
APP_DIR="/var/www/$DOMAIN_NAME"
APP_USER="orion_app"
SOURCE_DIR=$(pwd)

if [ ! -d "$APP_DIR" ]; then
    print_error "La directory $APP_DIR non esiste. Verifica il nome dominio."
    exit 1
fi

if [ ! -f "$APP_DIR/.env" ]; then
    print_error "Non trovo $APP_DIR/.env. Questa non sembra un'installazione ORION valida (o creata con setup.sh)."
    exit 1
fi

# Carica le variabili d'ambiente dall'installazione live (DB_USER, DB_PASSWORD, DB_DATABASE, ...)
export $(grep -v '^#' "$APP_DIR/.env" | xargs)
if [ -z "$DB_USER" ] || [ -z "$DB_DATABASE" ]; then
    print_error "$APP_DIR/.env non contiene DB_USER/DB_DATABASE validi. Aggiornamento interrotto."
    exit 1
fi
# Codifica la password come fa src/server.js (encodeURIComponent): se contiene
# caratteri riservati negli URL (es. @ : / #), costruire la stringa di
# connessione senza codifica la spezza silenziosamente in modo non ovvio.
DB_PASSWORD_ENCODED=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$DB_PASSWORD")
DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD_ENCODED}@localhost:5432/${DB_DATABASE}"

# 1. BACKUP DEL DATABASE
BACKUP_DIR="/var/backups/orion"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql"

print_info "Creazione backup del database in $BACKUP_FILE..."
# Il dump contiene tutto il database: lo legge solo root.
( umask 077; sudo -u postgres pg_dump "$DB_DATABASE" > "$BACKUP_FILE" )
chmod 600 "$BACKUP_FILE"
find "$BACKUP_DIR" -maxdepth 1 -name 'db_backup_*.sql' -exec chmod 600 {} + 2>/dev/null || true
print_success "Backup database completato."

# 2. MIGRAZIONI DEL DATABASE - PRIMA di toccare i file dell'installazione live.
#
# Le eseguiamo dalla nuova versione del codice (SOURCE_DIR, non ancora
# sincronizzata su APP_DIR) puntando comunque al database di produzione.
# Se falliscono, l'app in $APP_DIR resta ESATTAMENTE come prima: nessun file
# sincronizzato, nessuna dipendenza toccata, PM2 continua a servire la
# versione precedente. Questo copre anche il caso di un aggiornamento da una
# versione molto vecchia, dove il database potrebbe non avere tutte le
# tabelle/colonne attese dalle migrazioni più recenti: node-pg-migrate
# applica solo le migrazioni non ancora registrate come eseguite (tabella
# pgmigrations), quindi recupera automaticamente anche più "salti di
# versione" in un colpo solo, in ordine.
print_info "Installazione dipendenze necessarie per eseguire le migrazioni dalla nuova versione..."
(cd "$SOURCE_DIR" && npm install) || {
    print_error "Impossibile installare le dipendenze in $SOURCE_DIR. Aggiornamento interrotto PRIMA di toccare $APP_DIR: l'app corrente resta invariata e in esecuzione."
    exit 1
}
# npm può in alcuni casi terminare con exit code 0 pur non avendo installato
# correttamente tutto (es. errori interni tipo "Exit handler never called!"):
# verifichiamo quindi anche che un binario chiave sia stato effettivamente
# prodotto, non solo il codice di uscita del comando.
if [ ! -x "$SOURCE_DIR/node_modules/.bin/node-pg-migrate" ]; then
    print_error "npm install sembra essere fallito silenziosamente in $SOURCE_DIR: node_modules/.bin/node-pg-migrate non è presente dopo l'installazione. Aggiornamento interrotto PRIMA di toccare $APP_DIR: l'app corrente resta invariata e in esecuzione. Controlla i log di npm (es. $SOURCE_DIR/.npm/_logs/ o ~/.npm/_logs/) e riprova."
    exit 1
fi

print_info "Verifica e applicazione migrazioni database (da $SOURCE_DIR, sul database live)..."
if ! (cd "$SOURCE_DIR" && export DATABASE_URL="$DATABASE_URL" && npm run migrate); then
    print_error "Le migrazioni del database sono FALLITE."
    print_error "Nessun file è stato toccato in $APP_DIR: l'applicazione precedente è ancora installata e in esecuzione, non è richiesta alcuna azione di emergenza."
    print_error "Il backup pre-aggiornamento resta comunque disponibile in $BACKUP_FILE, se dovesse servire."
    print_error "Correggi il problema (es. una migrazione non compatibile con lo stato attuale del database, magari molto datato) e poi rilancia questo script."
    print_error "Per indagare a mano: cd $SOURCE_DIR && DATABASE_URL='$DATABASE_URL' npm run migrate"
    exit 1
fi
print_success "Migrazioni applicate con successo."

# 3. SINCRONIZZAZIONE DEI FILE - solo ora che sappiamo che il database è a posto.
print_info "Sincronizzazione dei nuovi file in $APP_DIR..."
rsync -av --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.env' \
    --exclude 'public/uploads/' \
    --exclude 'public/logo.png' \
    --exclude 'public/logo2.png' \
    --exclude 'uploads/' \
    --exclude 'protected_uploads/' \
    --exclude 'logs/' \
    "$SOURCE_DIR/" "$APP_DIR/"

print_success "File sincronizzati."

# 4. PERMESSI
print_info "Sistemazione dei permessi..."
chown -R $APP_USER:$APP_USER $APP_DIR
# Certificati medici, documenti, foto e log: solo il programma li legge.
for cartella in protected_uploads uploads logs; do
    if [ -d "$APP_DIR/$cartella" ]; then
        find "$APP_DIR/$cartella" -type d -exec chmod 750 {} +
        find "$APP_DIR/$cartella" -type f -exec chmod 640 {} +
    fi
done
print_success "Permessi ripristinati."

# 5. DIPENDENZE
print_info "Aggiornamento dipendenze Node.js..."
sudo -u $APP_USER bash -c "cd $APP_DIR && npm install --omit=dev" || {
    print_error "npm install --omit=dev è fallito in $APP_DIR. I file sono già stati sincronizzati ma l'app NON è ancora stata riavviata (PM2 sta ancora servendo il processo precedente, con il vecchio node_modules). Risolvi il problema con le dipendenze e poi esegui manualmente: sudo -u $APP_USER bash -c \"cd $APP_DIR && npm install --omit=dev\" e infine 'pm2 reload Orion' come utente $APP_USER, oppure rilancia questo script."
    exit 1
}
if [ ! -x "$APP_DIR/node_modules/.bin/node-pg-migrate" ]; then
    print_error "npm install sembra essere fallito silenziosamente in $APP_DIR: node_modules/.bin/node-pg-migrate non è presente dopo l'installazione. L'app NON è ancora stata riavviata (PM2 sta ancora servendo il processo precedente). Controlla i log di npm (es. $APP_DIR/.npm/_logs/) e riprova."
    exit 1
fi
print_success "Dipendenze aggiornate."

# 5-bis. BACKUP AUTOMATICO
# Cartella per i backup che l'applicazione esegue da sola (chiusura emergenza,
# recupero dopo una notte a server spento), separata da quella del cron.
mkdir -p /var/backups/orion/auto /var/backups/orion/db
chown -R $APP_USER:$APP_USER /var/backups/orion/auto
chmod 750 /var/backups/orion/auto

# Le installazioni create prima dell'introduzione del backup automatico non hanno
# il cron: lo aggiungiamo qui, così si allineano con un semplice aggiornamento.
if [ ! -f /etc/cron.d/orion-backup ]; then
    print_info "Attivazione del backup automatico giornaliero (non era ancora configurato)..."
    apt-get install -y cron >/dev/null 2>&1 || true
    chmod +x "$APP_DIR/scripts/backup.sh"
    cat > /etc/cron.d/orion-backup << EOF
# Backup giornaliero di ORION: dump del database + copia dei file caricati.
# Gestito da $APP_DIR/scripts/backup.sh (log in /var/log/orion-backup.log).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root $APP_DIR/scripts/backup.sh $DOMAIN_NAME >/dev/null 2>&1
EOF
    chmod 644 /etc/cron.d/orion-backup
    systemctl enable --now cron >/dev/null 2>&1 || true
    print_success "Backup automatico attivo (ogni notte alle 03:30, in /var/backups/orion)."
else
    chmod +x "$APP_DIR/scripts/backup.sh" 2>/dev/null || true
    print_success "Backup automatico già configurato."
fi

# 6. RIAVVIO APPLICAZIONE
print_info "Riavvio del servizio PM2..."
if sudo -u $APP_USER bash -c "cd $APP_DIR && pm2 jlist" 2>/dev/null | grep -q '"name":"Orion"'; then
    sudo -u $APP_USER bash -c "cd $APP_DIR && (pm2 reload Orion || pm2 restart Orion)"
else
    # Succede dopo un aggiornamento fatto dalla pagina Sistema con una versione
    # fino alla 3.36: cancellava la cartella .pm2, e il PM2 rimasto in memoria
    # non risponde piu' ai comandi. Si fermano i processi orfani di questo
    # utente e si riparte da capo.
    print_warning "PM2 non conosce il processo Orion: fermo i processi rimasti dell'utente $APP_USER e riavvio da capo."
    pkill -u $APP_USER -f "src/server.js" 2>/dev/null || true
    pkill -u $APP_USER -f "God Daemon" 2>/dev/null || true
    sleep 2
    sudo -u $APP_USER bash -c "cd $APP_DIR && pm2 start ecosystem.config.cjs --env production"
fi
sudo -u $APP_USER bash -c "cd $APP_DIR && pm2 save"
print_success "Applicazione riavviata."

echo
print_success "================================================"
print_success "      AGGIORNAMENTO COMPLETATO CON SUCCESSO!    "
print_success "================================================"
echo "L'applicazione è tornata online con l'ultima versione."
