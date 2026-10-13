#!/bin/bash

# Aggiornamento di ORION dalla riga di comando (si può anche dalla pagina Sistema).
#   sudo ./update.sh

set -e

print_info() { echo -e "\n\e[34mINFO:\e[0m $1"; }
print_success() { echo -e "\e[32mSUCCESS:\e[0m $1"; }
print_warning() { echo -e "\e[33mWARNING:\e[0m $1"; }
print_error() { echo -e "\e[31mERROR:\e[0m $1" >&2; }

if [ "$EUID" -ne 0 ]; then
  print_error "Per favore, esegui questo script usando 'sudo'."
  exit 1
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)"; then
    print_error "Node.js $(node -v) è troppo vecchio: serve la 22.13 o più recente (consigliata la 24). Vedi \"Aggiornare Node.js\" nel manuale tecnico. Niente è stato toccato."
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

export $(grep -v '^#' "$APP_DIR/.env" | xargs)
if [ -z "$DB_USER" ] || [ -z "$DB_DATABASE" ]; then
    print_error "$APP_DIR/.env non contiene DB_USER/DB_DATABASE validi. Aggiornamento interrotto."
    exit 1
fi
# Chi è collegato rifà l'accesso una volta.
if [ -z "$COOKIE_SECRET" ]; then
    printf '\nCOOKIE_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$APP_DIR/.env"
    print_info "Aggiunta a .env una COOKIE_SECRET propria: chi è collegato dovrà rifare l'accesso."
fi

# Senza codifica, una password con @ : / # spezza la stringa di connessione in silenzio.
DB_PASSWORD_ENCODED=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$DB_PASSWORD")
DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD_ENCODED}@localhost:5432/${DB_DATABASE}"

BACKUP_DIR="/var/backups/orion"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql"

print_info "Creazione backup del database in $BACKUP_FILE..."
( umask 077; sudo -u postgres pg_dump "$DB_DATABASE" > "$BACKUP_FILE" )
chmod 600 "$BACKUP_FILE"
find "$BACKUP_DIR" -maxdepth 1 -name 'db_backup_*.sql' -exec chmod 600 {} + 2>/dev/null || true
print_success "Backup database completato."

# Le migrazioni prima dei file, dalla versione nuova: se falliscono, l'installazione
# resta esattamente com'era.
print_info "Installazione dipendenze necessarie per eseguire le migrazioni dalla nuova versione..."
(cd "$SOURCE_DIR" && npm install) || {
    print_error "Impossibile installare le dipendenze in $SOURCE_DIR. Aggiornamento interrotto PRIMA di toccare $APP_DIR: l'app corrente resta invariata e in esecuzione."
    exit 1
}
# npm a volte esce con 0 senza aver installato tutto ("Exit handler never called!").
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
    --exclude 'chiave-dati.key' \
    --exclude 'PRIMO-ACCESSO.txt' \
    "$SOURCE_DIR/" "$APP_DIR/"

print_success "File sincronizzati."

print_info "Sistemazione dei permessi..."
chown -R $APP_USER:$APP_USER $APP_DIR
for cartella in protected_uploads uploads logs; do
    if [ -d "$APP_DIR/$cartella" ]; then
        find "$APP_DIR/$cartella" -type d -exec chmod 750 {} +
        find "$APP_DIR/$cartella" -type f -exec chmod 640 {} +
    fi
done
print_success "Permessi ripristinati."

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

# Cartella dei backup dell'applicazione, separata da quella del cron.
mkdir -p /var/backups/orion/auto /var/backups/orion/db
chown -R $APP_USER:$APP_USER /var/backups/orion/auto
chmod 750 /var/backups/orion/auto

# Le installazioni nate prima del backup automatico non hanno il cron.
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

print_info "Riavvio del servizio PM2..."
if sudo -u $APP_USER bash -c "cd $APP_DIR && pm2 jlist" 2>/dev/null | grep -q '"name":"Orion"'; then
    sudo -u $APP_USER bash -c "cd $APP_DIR && (pm2 reload Orion || pm2 restart Orion)"
else
    # Dopo un aggiornamento dalla pagina Sistema fino alla 3.36 (cancellava .pm2) PM2 non
    # risponde più: si fermano i processi orfani e si riparte.
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
