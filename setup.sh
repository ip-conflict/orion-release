#!/bin/bash

# ==============================================================================
# Script di Setup (Versione Semplificata)
# ==============================================================================
# 
# PREREQUISITI:
# 1. Un server Ubuntu/debian (testato su ubuntu 20.04/22.04).
# 2. Un dominio che punta all'indirizzo IP del server.
# 3. Aver clonato il repository Git dell'applicazione.
# 4. Eseguire questo script con un utente che ha privilegi 'sudo'.
#
# ==============================================================================

# Interrompi lo script in caso di errore
set -e

# --- Funzioni di utilità per i colori ---
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

# Verifica se lo script è eseguito come root/sudo
if [ "$EUID" -ne 0 ]; then
  print_error "Per favore, esegui questo script usando 'sudo'."
  exit 1
fi

# ==============================================================================
# 1. RACCOLTA INFORMAZIONI DALL'UTENTE
# ==============================================================================
print_info "Avvio dello script di configurazione. Inserisci le seguenti informazioni."

read -p "Inserisci il tuo nome dominio (es. orion.miaassociazione.it): " DOMAIN_NAME
read -p "Vuoi usare Certbot per generare un certificato SSL gratuito? (s/n): " USE_CERTBOT

# Gestione SSL
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

print_info "Ora configura il primo utente amministratore dell'applicazione web."
read -p "Inserisci lo username per l'admin (es. admin): " APP_ADMIN_USER
read -s -p "Inserisci la password per l'admin: " APP_ADMIN_PASSWORD
echo
read -p "Inserisci il nome dell'admin (es. Mario): " APP_ADMIN_NOME
read -p "Inserisci il cognome dell'admin (es. Rossi): " APP_ADMIN_COGNOME
read -p "Inserisci l'email dell'admin (opzionale): " APP_ADMIN_EMAIL

# Validazione input
if [ -z "$DOMAIN_NAME" ] || [ -z "$APP_ADMIN_USER" ] || [ -z "$APP_ADMIN_PASSWORD" ]; then
    print_error "Dominio e credenziali admin base sono obbligatori. Riavvia lo script."
    exit 1
fi

# ==============================================================================
# 2. INSTALLAZIONE DIPENDENZE DI SISTEMA
# ==============================================================================
print_info "Aggiornamento dei pacchetti di sistema..."
apt-get update -y
print_info "Installazione di Nginx, PostgreSQL, Certbot, rsync e altre dipendenze..."
apt-get install -y nginx postgresql postgresql-contrib certbot python3-certbot-nginx ufw curl rsync cron

# ==============================================================================
# 3. CREAZIONE UTENTE DI SISTEMA
# ==============================================================================
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

# ==============================================================================
# 4. CONFIGURAZIONE FIREWALL, NODE.JS E PM2
# ==============================================================================
print_info "Configurazione del firewall (UFW)..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
print_success "Firewall abilitato e configurato."

REQUIRED_NODE_MAJOR=22
NODE_INSTALLED=false

# Controlla se Node.js è già installato e se la versione è sufficiente
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

# Controlla se PM2 è già installato
if command -v pm2 &>/dev/null; then
    print_success "PM2 è già installato (versione $(pm2 --version)). Salto l'installazione."
else
    print_info "Installazione di PM2 a livello globale..."
    npm install -g pm2
    print_success "PM2 installato."
fi

# ==============================================================================
# 5. CONFIGURAZIONE DEL DATABASE POSTGRESQL
# ==============================================================================
print_info "Configurazione del database PostgreSQL..."
# Genera nomi standard e una password lunghissima e sicura
DB_USER="orion_db_user"
DB_DATABASE="orion_db"
# Genera 24 caratteri alfanumerici casuali senza caratteri speciali problematici per la stringa di connessione
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | fold -w 24 | head -n 1)

print_info "Configurazione del database PostgreSQL..."
# Creazione DB e Utente senza interazione. Usiamo <<EOF per prevenire qualsiasi problema di escape
# DB_PASSWORD viene generata casualmente ad ogni esecuzione e scritta nel .env
# poco più avanti: se il ruolo esiste già (es. un rilancio dello script dopo
# un'esecuzione precedente interrotta a metà), dobbiamo comunque allineare la
# password del ruolo a quella nuova, altrimenti il .env conterrebbe una
# password che non corrisponde più a quella effettiva su PostgreSQL.
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

# ==============================================================================
# 6. SETUP DELL'APPLICAZIONE IN /var/www/
# ==============================================================================
print_info "Configurazione dell'applicazione in $APP_DIR..."
mkdir -p $APP_DIR

# 1. CREAZIONE FILE .env (Prima del chown)
print_info "Creazione del file di ambiente .env..."
JWT_SECRET_VALUE=$(openssl rand -hex 32)
COOKIE_SECRET_VALUE=$(openssl rand -hex 32)
# Nota: Abbiamo rimosso DEFAULT_PASSWORD_VALUE come concordato per la sicurezza del reset

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

# 2. Copia dei file
# Il .env appena scritto non si tocca: se la cartella di partenza ne ha uno
# (una copia usata per delle prove), lo sovrascriverebbe con credenziali che
# non sono quelle del database appena creato. Lo stesso per dati e registri.
rsync -a --exclude 'node_modules' --exclude '.git' --exclude '/.env' --exclude '/.env.*' \
    --exclude '/logs' --exclude '/uploads' --exclude '/protected_uploads' --exclude '/public/uploads' \
    "$SOURCE_DIR/" "$APP_DIR/"

# 3. IMPOSTAZIONE PERMESSI
# node_modules resta fuori: a un secondo giro dello script c'e' gia', con
# decine di migliaia di file (un chmod per file durava minuti), e il 644 toglieva
# il permesso di esecuzione ai programmi di npm (node-pg-migrate compreso).
chown -R $APP_USER:$APP_USER $APP_DIR
find $APP_DIR -path "$APP_DIR/node_modules" -prune -o -type d -exec chmod 755 {} +
find $APP_DIR -path "$APP_DIR/node_modules" -prune -o -type f -exec chmod 644 {} +

# ---> IL FIX DI SICUREZZA FONDAMENTALE <---
chmod 600 $APP_DIR/.env
# ------------------------------------------

# Certificati medici, documenti, foto e log: li legge solo il programma. Il
# 644 generale sopra li lasciava leggibili a ogni utente della macchina.
for cartella in protected_uploads uploads logs; do
    mkdir -p "$APP_DIR/$cartella"
    chown -R $APP_USER:$APP_USER "$APP_DIR/$cartella"
    find "$APP_DIR/$cartella" -type d -exec chmod 750 {} +
    find "$APP_DIR/$cartella" -type f -exec chmod 640 {} +
done

print_success "Proprietario, permessi e file .env sicuri impostati."

# ==============================================================================
# 7. ESECUZIONE MIGRAZIONI E PULIZIA DIPENDENZE
# ==============================================================================
print_info "Installazione delle dipendenze (incluso node-pg-migrate e file-type)..."
# npm ci e non npm install: riparte da zero, esattamente dal package-lock. Se
# lo script viene rilanciato, un node_modules lasciato a meta' o rovinato (per
# esempio da una versione precedente di questo script, che gli toglieva il
# permesso di esecuzione) non viene preso per buono.
sudo -u $APP_USER bash -c "cd $APP_DIR && npm ci" || {
    print_error "npm ci è fallito in $APP_DIR. Controlla i log di npm (es. $APP_DIR/.npm/_logs/) e la connettività verso il registry npm, poi rilancia lo script."
    exit 1
}
# npm può in alcuni casi terminare con exit code 0 pur non avendo installato
# correttamente tutto (es. errori interni tipo "Exit handler never called!"):
# verifichiamo quindi anche che un binario chiave sia stato effettivamente
# prodotto, non solo il codice di uscita del comando.
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

print_info "Creazione del primo utente amministratore..."

# Crea un file temporaneo sicuro per le variabili d'ambiente admin
ADMIN_ENV_FILE="$APP_DIR/.env.admin"
cat > $ADMIN_ENV_FILE << EOF
ADMIN_USERNAME=${APP_ADMIN_USER}
ADMIN_PASSWORD=${APP_ADMIN_PASSWORD}
ADMIN_NOME=${APP_ADMIN_NOME}
ADMIN_COGNOME=${APP_ADMIN_COGNOME}
ADMIN_EMAIL=${APP_ADMIN_EMAIL}
EOF

# Imposta permessi restrittivi in modo che solo orion_app possa leggerlo
chmod 600 $ADMIN_ENV_FILE
chown $APP_USER:$APP_USER $ADMIN_ENV_FILE

# Esegui lo script dicendo a Node di caricare anche il file .env.admin
sudo -u $APP_USER bash -c "cd $APP_DIR && node --env-file=$ADMIN_ENV_FILE create-admin.js"

# Pulisci il file temporaneo distruggendolo
rm -f $ADMIN_ENV_FILE

print_success "Processo di creazione utente admin completato in modo sicuro."

# ==============================================================================
# 8. CONFIGURAZIONE DI NGINX E SSL
# ==============================================================================
NGINX_MAIN_CONF="/etc/nginx/nginx.conf"
# server_tokens off: nginx non dice la sua versione. Una sola riga, qualunque
# cosa ci fosse prima: alcune versioni di Ubuntu la scrivono gia' (anche con
# un altro valore), e aggiungerne una seconda rende nginx inutilizzabile
# ("server_tokens directive is duplicate"). Anche un'esecuzione precedente di
# questo script puo' averne lasciata una in piu': si tiene la prima.
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
# Su una macchina senza IPv6 (succede su diversi VPS) "listen [::]" fa fallire
# nginx: le righe IPv6 si scrivono solo se il sistema lo supporta.
if [ -f /proc/net/if_inet6 ]; then
    LISTEN_IPV6_CERTBOT="listen [::]:443 ssl ipv6only=on;"
    LISTEN_IPV6_MANUALE="listen [::]:443 ssl http2;"
else
    print_warning "IPv6 non disponibile su questa macchina: nginx ascoltera' solo in IPv4."
    LISTEN_IPV6_CERTBOT=""
    LISTEN_IPV6_MANUALE=""
fi
if [[ "$USE_CERTBOT" == "s" ]]; then
    # Configurazione temporanea per la sfida di Certbot
    bash -c "cat > $NGINX_CONF_PATH" << EOF
server { listen 80; server_name $DOMAIN_NAME; location / { return 301 https://\$host\$request_uri; } }
EOF
    ln -s -f $NGINX_CONF_PATH /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    # Prima di chiedere il certificato nginx deve funzionare: prima un errore
    # qui passava inosservato e si scopriva solo dal messaggio di certbot.
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
    # Configurazione Nginx con certificati manuali
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
# ==============================================================================
# 9. AVVIO APPLICAZIONE CON PM2 
# ==============================================================================
print_info "Avvio dell'applicazione con PM2 come utente '$APP_USER'..."
sudo -u $APP_USER bash -c "cd $APP_DIR && pm2 start $ECOSYSTEM_FILE --env production"

print_info "Configurazione di PM2 per l'avvio automatico al boot..."
# Eseguiamo direttamente il comando di startup e verifichiamo che non dia errori.
# In alcune versioni/ambienti, pm2 esegue direttamente l'attivazione del servizio
# invece di stampare il comando da eseguire. Questo approccio è più robusto.
if pm2 startup systemd -u $APP_USER --hp "$APP_DIR"; then
    print_success "Servizio di avvio automatico di PM2 configurato con successo."
else
    print_error "La configurazione dell'avvio automatico di PM2 è fallita."
    exit 1
fi

print_info "Salvataggio della lista dei processi per il riavvio..."
sudo -u $APP_USER bash -c "pm2 save"

print_success "Applicazione avviata e configurata per il riavvio automatico."

# ==============================================================================
# 9-bis. BACKUP AUTOMATICO GIORNALIERO
# ==============================================================================
print_info "Configurazione del backup automatico giornaliero..."
chmod +x "$APP_DIR/scripts/backup.sh"

# Cartella usata dall'applicazione per i backup che esegue da sola (chiusura di
# un'emergenza, recupero dopo una notte a server spento). È separata da quella
# scritta dal cron come root: così l'utente dell'applicazione non può cancellare
# i backup notturni.
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

# Primo backup subito, così si verifica che funzioni senza aspettare la notte
if "$APP_DIR/scripts/backup.sh" "$DOMAIN_NAME" >/dev/null 2>&1; then
    print_success "Backup automatico attivo (ogni notte alle 03:30). Primo backup eseguito in /var/backups/orion."
else
    print_warning "Backup automatico configurato, ma il primo backup di prova è fallito. Controlla /var/log/orion-backup.log."
fi

# ==============================================================================
# 10. COMPLETAMENTO
# ==============================================================================
echo
print_success "================================================"
print_success "      CONFIGURAZIONE COMPLETATA CON SUCCESSO!   "
print_success "================================================"
echo
echo "L'applicazione è ora in esecuzione e accessibile su: https://$DOMAIN_NAME"
echo "I file del progetto si trovano in: $APP_DIR"
echo
echo "Stato dei processi PM2:"
# Mostra lo stato dei processi dell'utente corretto
sudo -u $APP_USER pm2 list
echo
