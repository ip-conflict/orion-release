#!/bin/bash

# Installazione di ORION su Ubuntu 22.04 o 24.04, con un dominio che punta al server.
#   sudo ./setup.sh

set -e

print_info() {
    echo -e "\n\e[34mINFO:\e[0m $1"
}
print_success() {
    echo -e "\e[32mSUCCESS:\e[0m $1"
}
print_warning() {
    echo -e "\e[33mWARNING:\e[0m $1"
}
print_error() {
    echo -e "\e[31mERROR:\e[0m $1" >&2
}

if [ "$EUID" -ne 0 ]; then
  print_error "Per favore, esegui questo script usando 'sudo'."
  exit 1
fi

print_info "Avvio dello script di configurazione. Inserisci le seguenti informazioni."

read -p "Inserisci il tuo nome dominio (es. orion.miaassociazione.it): " DOMAIN_NAME
read -p "Vuoi usare Certbot per generare un certificato SSL gratuito? (s/n): " USE_CERTBOT

if [[ "$USE_CERTBOT" != "s" ]]; then
    print_info "Configurazione SSL manuale selezionata."
    read -p "Inserisci il percorso completo del tuo file certificato (es. /path/to/fullchain.pem): " SSL_CERT_PATH
    read -p "Inserisci il percorso completo della tua chiave privata (es. /path/to/privkey.pem): " SSL_KEY_PATH
    if [ ! -f "$SSL_CERT_PATH" ] || [ ! -f "$SSL_KEY_PATH" ]; then
        print_error "File del certificato non trovati. Verifica i percorsi."
        exit 1
    fi
else
    print_info "Configurazione SSL automatica con Certbot selezionata."
    read -p "Inserisci un indirizzo email (per notifiche SSL da Let's Encrypt): " ADMIN_EMAIL
fi

if [ -z "$DOMAIN_NAME" ]; then
    print_error "Il dominio è obbligatorio. Riavvia lo script."
    exit 1
fi

print_info "Aggiornamento dei pacchetti di sistema..."
apt-get update -y
print_info "Installazione di Nginx, PostgreSQL, Certbot, rsync e altre dipendenze..."
apt-get install -y nginx postgresql postgresql-contrib certbot python3-certbot-nginx ufw curl rsync cron

# PostgreSQL 14 (Ubuntu 22.04) esce dal supporto a novembre 2026.
PG_MAJOR=$(sudo -u postgres psql -tAc "SHOW server_version_num" 2>/dev/null | cut -c1-2)
if [ -n "$PG_MAJOR" ] && [ "$PG_MAJOR" -le 14 ]; then
    print_warning "PostgreSQL $PG_MAJOR non riceve più aggiornamenti di sicurezza da novembre 2026. Conviene passare a una versione supportata: vedi \"Aggiornare PostgreSQL\" nel manuale tecnico."
fi

APP_USER="orion_app" 
APP_DIR="/var/www/$DOMAIN_NAME"
SOURCE_DIR=$(pwd)
ECOSYSTEM_FILE="ecosystem.config.cjs"

print_success "Utente dell'applicazione da creare: '$APP_USER'"

print_info "Creazione dell'utente di sistema '$APP_USER' con home directory in '$APP_DIR'..."
if id "$APP_USER" &>/dev/null; then
    print_warning "L'utente di sistema '$APP_USER' esiste già. Salto la creazione."
else
    adduser --system --group --home "$APP_DIR" $APP_USER
    print_success "Utente di sistema '$APP_USER' creato."
fi

print_info "Configurazione del firewall (UFW)..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
print_success "Firewall abilitato e configurato."

REQUIRED_NODE_MAJOR=24
NODE_INSTALLED=false

if command -v node &>/dev/null; then
    CURRENT_NODE_VERSION=$(node -v)
    CURRENT_NODE_MAJOR=$(echo "$CURRENT_NODE_VERSION" | cut -d'v' -f2 | cut -d'.' -f1)
    
    if [ "$CURRENT_NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ]; then
        print_success "Node.js è già installato (versione $CURRENT_NODE_VERSION) e soddisfa i requisiti (v$REQUIRED_NODE_MAJOR+). Salto l'installazione."
        NODE_INSTALLED=true
    else
        print_warning "Node.js è installato (versione $CURRENT_NODE_VERSION) ma è obsoleto. Procedo con l'aggiornamento alla v$REQUIRED_NODE_MAJOR."
    fi
else
    print_info "Node.js non trovato. Procedo con l'installazione della versione $REQUIRED_NODE_MAJOR."
fi

if [ "$NODE_INSTALLED" = false ]; then
    print_info "Installazione di Node.js v$REQUIRED_NODE_MAJOR (LTS) a livello di sistema..."
    apt-get purge -y nodejs npm || true
    rm -f /etc/apt/sources.list.d/nodesource.list
    curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x -o /tmp/nodesource_setup.sh
    bash /tmp/nodesource_setup.sh
    apt-get install -y nodejs
    print_success "Node.js $(node -v) e npm $(npm -v) installati con successo."
fi

if command -v pm2 &>/dev/null; then
    print_success "PM2 è già installato (versione $(pm2 --version)). Salto l'installazione."
else
    print_info "Installazione di PM2 a livello globale..."
    npm install -g pm2
    print_success "PM2 installato."
fi

print_info "Configurazione del database PostgreSQL..."
DB_USER="orion_db_user"
DB_DATABASE="orion_db"
# Senza caratteri che diano problemi nella stringa di connessione.
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | fold -w 24 | head -n 1)

print_info "Configurazione del database PostgreSQL..."
# Se il ruolo esiste già (un rilancio dopo un'esecuzione interrotta) la password si
# allinea comunque a quella nuova scritta nel .env.
sudo -u postgres psql <<EOF
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER WITH LOGIN ENCRYPTED PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE $DB_USER WITH ENCRYPTED PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
EOF

if ! sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw "$DB_DATABASE"; then
    sudo -u postgres psql -c "CREATE DATABASE $DB_DATABASE OWNER $DB_USER;"
    print_success "Database '$DB_DATABASE' creato e assegnato."
else
    print_warning "Il database '$DB_DATABASE' esiste già."
fi

print_info "Configurazione dell'applicazione in $APP_DIR..."
mkdir -p $APP_DIR

print_info "Creazione del file di ambiente .env..."
JWT_SECRET_VALUE=$(openssl rand -hex 32)
COOKIE_SECRET_VALUE=$(openssl rand -hex 32)

cat > $APP_DIR/.env << EOF
JWT_SECRET=${JWT_SECRET_VALUE}
COOKIE_SECRET=${COOKIE_SECRET_VALUE}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=${DB_DATABASE}
DB_SSL=false
DOMAIN_NAME=${DOMAIN_NAME}
PORT=3000
NODE_ENV=production
EOF

# Il .env appena scritto non si tocca: una copia di prova lo sovrascriverebbe con
# credenziali sbagliate.
rsync -a --exclude 'node_modules' --exclude '.git' --exclude '/.env' --exclude '/.env.*' \
    --exclude '/logs' --exclude '/uploads' --exclude '/protected_uploads' --exclude '/public/uploads' \
    "$SOURCE_DIR/" "$APP_DIR/"

# node_modules resta fuori: chmod file per file dura minuti e il 644 toglierebbe
# l'esecuzione ai programmi di npm.
chown -R $APP_USER:$APP_USER $APP_DIR
find $APP_DIR -path "$APP_DIR/node_modules" -prune -o -type d -exec chmod 755 {} +
find $APP_DIR -path "$APP_DIR/node_modules" -prune -o -type f -exec chmod 644 {} +

chmod 600 $APP_DIR/.env

for cartella in protected_uploads uploads logs; do
    mkdir -p "$APP_DIR/$cartella"
    chown -R $APP_USER:$APP_USER "$APP_DIR/$cartella"
    find "$APP_DIR/$cartella" -type d -exec chmod 750 {} +
    find "$APP_DIR/$cartella" -type f -exec chmod 640 {} +
done

print_success "Proprietario, permessi e file .env sicuri impostati."

print_info "Installazione delle dipendenze (incluso node-pg-migrate e file-type)..."
# npm ci: un node_modules lasciato a metà da un'esecuzione precedente non si prende per buono.
sudo -u $APP_USER bash -c "cd $APP_DIR && npm ci" || {
    print_error "npm ci è fallito in $APP_DIR. Controlla i log di npm (es. $APP_DIR/.npm/_logs/) e la connettività verso il registry npm, poi rilancia lo script."
    exit 1
}
# npm a volte esce con 0 senza aver installato tutto ("Exit handler never called!").
if [ ! -x "$APP_DIR/node_modules/.bin/node-pg-migrate" ]; then
    print_error "npm install sembra essere fallito silenziosamente in $APP_DIR: node_modules/.bin/node-pg-migrate non è presente dopo l'installazione. Controlla i log di npm (es. $APP_DIR/.npm/_logs/) e rilancia lo script."
    exit 1
fi
print_success "Dipendenze installate."

print_info "Esecuzione delle migrazioni del database..."
if sudo -u $APP_USER bash -c "cd $APP_DIR && npm run-script | grep -q 'migrate'"
then
    DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_DATABASE}"
    sudo -u $APP_USER bash -c "cd $APP_DIR && export DATABASE_URL='${DATABASE_URL}' && npm run migrate"
    print_success "Migrazioni completate."
else
    print_warning "Nessuno script 'migrate' trovato. Salto la creazione delle tabelle."
fi

NGINX_MAIN_CONF="/etc/nginx/nginx.conf"
# Una sola riga server_tokens: alcune Ubuntu la scrivono già, e un doppione rende nginx
# inutilizzabile.
cp "$NGINX_MAIN_CONF" "$NGINX_MAIN_CONF.orion-bak"
if grep -Eq '^[[:space:]]*server_tokens[[:space:]]' "$NGINX_MAIN_CONF"; then
    awk '/^[[:space:]]*server_tokens[[:space:]]/ { if (visto++) next } { print }' "$NGINX_MAIN_CONF" > "$NGINX_MAIN_CONF.orion-tmp"
    cat "$NGINX_MAIN_CONF.orion-tmp" > "$NGINX_MAIN_CONF"
    rm -f "$NGINX_MAIN_CONF.orion-tmp"
    sed -i -E 's/^([[:space:]]*)server_tokens[[:space:]]+[^;]*;/\1server_tokens off;/' "$NGINX_MAIN_CONF"
    print_success "'server_tokens off;' impostato (una sola volta) in $NGINX_MAIN_CONF."
else
    sed -i -E '0,/^[[:space:]]*http[[:space:]]*\{/s//&\n    server_tokens off;/' "$NGINX_MAIN_CONF"
    print_success "'server_tokens off;' aggiunto a $NGINX_MAIN_CONF."
fi
if ! nginx -t; then
    print_error "La configurazione di nginx non e' valida (vedi sopra). Rimetto $NGINX_MAIN_CONF com'era e mi fermo: correggi e rilancia lo script."
    cp "$NGINX_MAIN_CONF.orion-bak" "$NGINX_MAIN_CONF"
    exit 1
fi

print_info "Configurazione di Nginx..."
NGINX_CONF_PATH="/etc/nginx/sites-available/$DOMAIN_NAME"
# Senza IPv6 (succede su diversi VPS) "listen [::]" fa fallire nginx.
if [ -f /proc/net/if_inet6 ]; then
    LISTEN_IPV6_CERTBOT="listen [::]:443 ssl ipv6only=on;"
    LISTEN_IPV6_MANUALE="listen [::]:443 ssl http2;"
else
    print_warning "IPv6 non disponibile su questa macchina: nginx ascoltera' solo in IPv4."
    LISTEN_IPV6_CERTBOT=""
    LISTEN_IPV6_MANUALE=""
fi
if [[ "$USE_CERTBOT" == "s" ]]; then
    bash -c "cat > $NGINX_CONF_PATH" << EOF
server { listen 80; server_name $DOMAIN_NAME; location / { return 301 https://\$host\$request_uri; } }
EOF
    ln -s -f $NGINX_CONF_PATH /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    # Un errore qui si scoprirebbe solo dal messaggio di certbot.
    if ! nginx -t; then
        print_error "nginx non accetta la configurazione (vedi sopra): il certificato non si puo' chiedere. Correggi e rilancia lo script."
        exit 1
    fi
    systemctl restart nginx
    
    EMAIL_FLAG="--email $ADMIN_EMAIL"
    if [ -z "$ADMIN_EMAIL" ]; then
        print_warning "Nessuna email fornita. L'account verrà registrato con '--register-unsafely-without-email'."
        EMAIL_FLAG="--register-unsafely-without-email"
    fi
    certbot --nginx -d $DOMAIN_NAME --non-interactive --agree-tos $EMAIL_FLAG

    bash -c "cat > $NGINX_CONF_PATH" << EOF
server {
    server_name $DOMAIN_NAME;
    $LISTEN_IPV6_CERTBOT listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN_NAME/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # --- MODIFICHE: Aumento limite upload e sicurezza ---
    client_max_body_size 100M;
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
server {
    if (\$host = $DOMAIN_NAME) { return 301 https://\$host\$request_uri; }
    listen 80; server_name $DOMAIN_NAME; return 404;
}
EOF
else
    bash -c "cat > $NGINX_CONF_PATH" << EOF
server {
    server_name $DOMAIN_NAME;
    listen 443 ssl http2; $LISTEN_IPV6_MANUALE
    ssl_certificate $SSL_CERT_PATH;
    ssl_certificate_key $SSL_KEY_PATH;
    client_max_body_size 100M;
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
server {
    listen 80; server_name $DOMAIN_NAME;
    return 301 https://\$host\$request_uri;
}
EOF
    ln -s -f $NGINX_CONF_PATH /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl reload nginx
print_success "Nginx e SSL configurati."
print_info "Avvio dell'applicazione con PM2 come utente '$APP_USER'..."
sudo -u $APP_USER bash -c "cd $APP_DIR && pm2 start $ECOSYSTEM_FILE --env production"

print_info "Configurazione di PM2 per l'avvio automatico al boot..."
# Alcune versioni di pm2 attivano il servizio invece di stampare il comando da eseguire.
if pm2 startup systemd -u $APP_USER --hp "$APP_DIR"; then
    print_success "Servizio di avvio automatico di PM2 configurato con successo."
else
    print_error "La configurazione dell'avvio automatico di PM2 è fallita."
    exit 1
fi

print_info "Salvataggio della lista dei processi per il riavvio..."
sudo -u $APP_USER bash -c "pm2 save"

print_success "Applicazione avviata e configurata per il riavvio automatico."

print_info "Configurazione del backup automatico giornaliero..."
chmod +x "$APP_DIR/scripts/backup.sh"

# Separata da quella del cron: l'utente dell'applicazione non può cancellare i backup notturni.
mkdir -p /var/backups/orion/auto /var/backups/orion/db
chown -R $APP_USER:$APP_USER /var/backups/orion/auto
chmod 750 /var/backups/orion/auto
cat > /etc/cron.d/orion-backup << EOF
# Backup giornaliero di ORION: dump del database + copia dei file caricati.
# Gestito da $APP_DIR/scripts/backup.sh (log in /var/log/orion-backup.log).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root $APP_DIR/scripts/backup.sh $DOMAIN_NAME >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/orion-backup
systemctl enable --now cron >/dev/null 2>&1 || true

# Subito, per sapere che funziona senza aspettare la notte.
if "$APP_DIR/scripts/backup.sh" "$DOMAIN_NAME" >/dev/null 2>&1; then
    print_success "Backup automatico attivo (ogni notte alle 03:30). Primo backup eseguito in /var/backups/orion."
else
    print_warning "Backup automatico configurato, ma il primo backup di prova è fallito. Controlla /var/log/orion-backup.log."
fi

echo
print_success "================================================"
print_success "      CONFIGURAZIONE COMPLETATA CON SUCCESSO!   "
print_success "================================================"
echo
echo "L'applicazione è ora in esecuzione e accessibile su: https://$DOMAIN_NAME"

FILE_PRIMO_ACCESSO="$APP_DIR/PRIMO-ACCESSO.txt"
for i in $(seq 1 30); do
    [ -f "$FILE_PRIMO_ACCESSO" ] && break
    sleep 1
done
if [ -f "$FILE_PRIMO_ACCESSO" ]; then
    CODICE_PRIMO_ACCESSO=$(grep -o 'CODICE: [A-Z0-9-]*' "$FILE_PRIMO_ACCESSO" | cut -d' ' -f2)
    echo
    print_warning "================================================"
    print_warning " ULTIMO PASSO: crea l'amministratore dal browser"
    print_warning "================================================"
    echo "Apri https://$DOMAIN_NAME : la pagina chiede il codice di configurazione"
    echo
    echo "        $CODICE_PRIMO_ACCESSO"
    echo
    echo "poi nome, cognome, username e password del primo amministratore."
    echo "Fallo subito: finché l'amministratore non c'è, la pagina resta in attesa del codice."
    echo "Il codice si ritrova con: sudo cat $FILE_PRIMO_ACCESSO"
    echo
    echo "Poi, da amministratore, pagina Sistema, riquadro Cifratura: stampa la chiave di recupero"
    echo "e conservala fuori dal server. Senza, se la chiave si perde, file e backup cifrati non si aprono."
else
    print_info "Nel database c'è già un amministratore: accedi con le sue credenziali."
fi
echo "I file del progetto si trovano in: $APP_DIR"
echo
echo "Stato dei processi PM2:"
sudo -u $APP_USER pm2 list
echo
