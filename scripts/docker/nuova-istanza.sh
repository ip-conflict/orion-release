#!/bin/bash
# Crea un'istanza di ORION in container: cartelle, segreti, database, programma e, se c'è nginx,
# il sito con il certificato. Vedi "ORION in container" nel manuale tecnico.
#   sudo [ORION_CHIAVE_DA=chiave-dati.key] scripts/docker/nuova-istanza.sh <nome> <dominio> <versione> [--senza-nginx]

set -euo pipefail

QUI=$(cd "$(dirname "$0")" && pwd)
BASE="${ORION_BASE:-/srv/orion}"
IMMAGINE="${ORION_IMMAGINE:-ghcr.io/ip-conflict/orion}"
AGENTE="${ORION_AGENTE:-/usr/local/sbin/orion-agente}"
PRIMA_PORTA=3101

errore() { echo "ERRORE: $*" >&2; exit 1; }

NOME=${1:-}; DOMINIO=${2:-}; VERSIONE=${3:-}; NGINX=si
[ "${4:-}" = --senza-nginx ] && NGINX=no
[[ $NOME =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || errore "Uso: $0 <nome> <dominio> <versione> [--senza-nginx]; il nome è fatto di minuscole, cifre e trattini."
[[ $DOMINIO =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || errore "Dominio non valido: $DOMINIO"
[[ $VERSIONE =~ ^[0-9]+(\.[0-9]+){1,3}([-+][0-9A-Za-z.]+)?$ ]] || errore "Versione non valida: $VERSIONE"
[ "$(id -u)" -eq 0 ] || errore "Va lanciato con sudo."
command -v docker > /dev/null && docker compose version > /dev/null 2>&1 || errore "Servono docker e il plugin compose (vedi prepara-host.sh)."
command -v jq > /dev/null || errore "Serve jq (vedi prepara-host.sh)."

DIR="$BASE/$NOME"
[ -e "$DIR" ] && errore "L'istanza $NOME esiste già in $DIR."
grep -rqsx "DOMAIN_NAME=$DOMINIO" "$BASE"/*/orion.env && errore "Il dominio $DOMINIO è già di un'altra istanza."

# Prima porta libera: né di un'altra istanza né già in ascolto sull'host.
PORTA=$PRIMA_PORTA
while grep -qsx "ORION_PORTA=$PORTA" "$BASE"/*/.env || ss -ltnH "sport = :$PORTA" | grep -q .; do PORTA=$((PORTA + 1)); done
# Un utente per istanza: se un container ne uscisse, i file delle altre restano non suoi.
UID_ISTANZA=$((20000 + PORTA - PRIMA_PORTA + 1))

echo "Immagine $IMMAGINE:$VERSIONE..."
docker pull -q "$IMMAGINE:$VERSIONE" > /dev/null 2>&1 || docker image inspect "$IMMAGINE:$VERSIONE" > /dev/null 2>&1 \
    || errore "L'immagine $IMMAGINE:$VERSIONE non si trova."
RIF=$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$IMMAGINE:$VERSIONE" | grep -F "$IMMAGINE@" | head -1 || true)
RIF=${RIF:-$(docker image inspect -f '{{.Id}}' "$IMMAGINE:$VERSIONE")}
LETTA=$(docker run --rm --network none --entrypoint node "$RIF" -p "require('/app/package.json').version")
[ "$LETTA" = "$VERSIONE" ] || errore "L'immagine $IMMAGINE:$VERSIONE contiene la versione $LETTA."

segreto() { openssl rand -hex "$1"; }

umask 077
mkdir -p "$BASE"; chmod 711 "$BASE"
mkdir -p "$DIR"/{dati,chiave,postgres,backup/auto,backup/notte,backup/file,agente/richieste,agente/stato}
chmod 711 "$DIR"
chown "$UID_ISTANZA:$UID_ISTANZA" "$DIR"/{dati,chiave,backup/auto,agente/richieste}
chmod 700 "$DIR"/{dati,chiave}
chmod 750 "$DIR"/{backup/auto,agente/richieste}
# Notturni, copia dei file e stato dell'agente li scrive root: l'applicazione li legge soltanto.
chown root:"$UID_ISTANZA" "$DIR"/backup/{notte,file} "$DIR"/agente/stato
chmod 750 "$DIR"/backup/{notte,file} "$DIR"/agente/stato
chmod 755 "$DIR/backup" "$DIR/agente"

# Chi passa da un'installazione classica porta la sua chiave: i backup e i file cifrati restano leggibili.
if [ -n "${ORION_CHIAVE_DA:-}" ]; then
    install -m 600 -o "$UID_ISTANZA" -g "$UID_ISTANZA" "$ORION_CHIAVE_DA" "$DIR/chiave/chiave-dati.key"
fi

cp "$QUI/compose.yaml" "$DIR/compose.yaml"
install -m 755 "$QUI/postgres-init.sh" "$DIR/postgres-init.sh"
chmod 644 "$DIR/compose.yaml"

cat > "$DIR/.env" << EOF
ORION_ISTANZA=$NOME
ORION_IMMAGINE=$IMMAGINE
ORION_VERSIONE=$VERSIONE
ORION_IMMAGINE_RIF=$RIF
ORION_PORTA=$PORTA
ORION_UID=$UID_ISTANZA
ORION_AGGIORNAMENTI=automatici
${ORION_POSTGRES_IMMAGINE:+ORION_POSTGRES_IMMAGINE=$ORION_POSTGRES_IMMAGINE}
POSTGRES_PASSWORD=$(segreto 24)
ORION_DB_PASSWORD=$(segreto 24)
EOF
cat > "$DIR/orion.env" << EOF
JWT_SECRET=$(segreto 32)
COOKIE_SECRET=$(segreto 32)
DOMAIN_NAME=$DOMINIO
TZ=Europe/Rome
ORION_BACKUP_RETENTION_DAYS=30
EOF
chmod 600 "$DIR/.env" "$DIR/orion.env"

echo "Avvio di database e programma..."
docker compose -f "$DIR/compose.yaml" up -d --quiet-pull > /dev/null
for _ in $(seq 1 80); do
    SALUTE=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose -f "$DIR/compose.yaml" ps -q app)" 2> /dev/null || true)
    [ "$SALUTE" = healthy ] && break
    sleep 3
done
[ "$SALUTE" = healthy ] || errore "Il programma non risponde: docker compose -f $DIR/compose.yaml logs app"

if [ -x "$AGENTE" ]; then
    "$AGENTE" giro
else
    echo "ATTENZIONE: l'agente ($AGENTE) non è installato: aggiornamenti e backup notturni non funzionano (vedi prepara-host.sh)."
fi

if [ "$NGINX" = si ] && command -v nginx > /dev/null; then
    cat > "/etc/nginx/sites-available/$DOMINIO" << EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;
    client_max_body_size 100M;
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    location / {
        proxy_pass http://127.0.0.1:$PORTA;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    [ -f /proc/net/if_inet6 ] || sed -i '/listen \[::\]/d' "/etc/nginx/sites-available/$DOMINIO"
    ln -sf "/etc/nginx/sites-available/$DOMINIO" /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx
    if command -v certbot > /dev/null; then
        EMAIL=${ORION_EMAIL:+--email $ORION_EMAIL}
        certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos --redirect ${EMAIL:---register-unsafely-without-email} \
            || echo "ATTENZIONE: certificato non ottenuto; riprova con: certbot --nginx -d $DOMINIO"
    fi
fi

echo
echo "Istanza $NOME pronta: porta $PORTA, cartella $DIR."
if [ -f "$DIR/dati/PRIMO-ACCESSO.txt" ]; then
    echo "Apri https://$DOMINIO e crea il primo amministratore con questo codice:"
    grep -oE '[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}' "$DIR/dati/PRIMO-ACCESSO.txt" | head -1
fi
