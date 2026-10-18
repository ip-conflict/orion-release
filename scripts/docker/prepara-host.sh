#!/bin/bash
# Prepara un host Ubuntu per le istanze ORION in container: Docker, nginx, certbot, firewall,
# l'agente e i suoi timer. Si lancia una volta; poi ogni istanza con nuova-istanza.sh.
#   sudo scripts/docker/prepara-host.sh

set -euo pipefail
QUI=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" -eq 0 ] || { echo "Va lanciato con sudo." >&2; exit 1; }

apt-get update
apt-get install -y ca-certificates jq rsync openssl nginx certbot python3-certbot-nginx ufw
command -v docker > /dev/null || apt-get install -y docker.io docker-compose-v2
systemctl enable --now docker nginx

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
rm -f /etc/nginx/sites-enabled/default
# Chi arriva con l'indirizzo IP o con un nome che non è di un'istanza non deve finire su una di loro.
cat > /etc/nginx/sites-available/orion-predefinito << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    ssl_reject_handshake on;
    return 444;
}
EOF
[ -f /proc/net/if_inet6 ] || sed -i '/listen \[::\]/d' /etc/nginx/sites-available/orion-predefinito
ln -sf /etc/nginx/sites-available/orion-predefinito /etc/nginx/sites-enabled/
grep -Eq '^\s*server_tokens\s' /etc/nginx/nginx.conf || sed -i '0,/#\s*server_tokens/s/#\s*server_tokens/server_tokens/' /etc/nginx/nginx.conf
nginx -t && systemctl reload nginx

install -m 755 "$QUI/orion-agente.sh" /usr/local/sbin/orion-agente
install -m 644 "$QUI"/systemd/orion-agente.service "$QUI"/systemd/orion-agente.timer \
    "$QUI"/systemd/orion-backup.service "$QUI"/systemd/orion-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now orion-agente.timer orion-backup.timer

mkdir -p /srv/orion
chmod 711 /srv/orion
echo "Host pronto. Una nuova istanza: sudo $QUI/nuova-istanza.sh <nome> <dominio> <versione>"
