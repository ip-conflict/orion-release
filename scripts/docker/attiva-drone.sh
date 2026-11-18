#!/bin/bash
# Accende il drone su un'istanza ORION in container: MediaMTX accanto al programma, le porte RTMP e
# WebRTC aperte nel firewall, il segreto fra i due. Vedi "Il drone" nel manuale tecnico.
#   sudo scripts/docker/attiva-drone.sh <nome> [porta-rtmp] [porta-webrtc]
#   sudo scripts/docker/attiva-drone.sh --elenco
# Senza porte tiene quelle già date all'istanza, o prende le prime libere da 1935 (TCP) e 8189 (UDP).

set -euo pipefail

QUI=$(cd "$(dirname "$0")" && pwd)
BASE="${ORION_BASE:-/srv/orion}"
errore() { echo "ERRORE: $*" >&2; exit 1; }

# Le porte riservate stanno nel .env di ogni istanza: è lì che le altre le leggono.
if [ "${1:-}" = "--elenco" ]; then
    [ "$(id -u)" -eq 0 ] || errore "Va lanciato con sudo."
    printf '%-24s %-12s %-12s\n' ISTANZA RTMP/TCP WEBRTC/UDP
    for env in "$BASE"/*/.env; do
        [ -f "$env" ] || continue
        r=$(sed -n 's/^ORION_DRONE_PORTA_RTMP=//p' "$env"); w=$(sed -n 's/^ORION_DRONE_PORTA_WEBRTC=//p' "$env")
        printf '%-24s %-12s %-12s\n' "$(basename "$(dirname "$env")")" "${r:-drone spento}" "${w:-}"
    done
    exit 0
fi

NOME=${1:-}; RTMP=${2:-}; WEBRTC=${3:-}
[[ $NOME =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || errore "Uso: $0 <nome> [porta-rtmp] [porta-webrtc]"
[[ -z $RTMP || $RTMP =~ ^[0-9]+$ ]] && [[ -z $WEBRTC || $WEBRTC =~ ^[0-9]+$ ]] || errore "Le porte sono numeri."
for p in $RTMP $WEBRTC; do [ "$p" -ge 1024 ] && [ "$p" -le 65535 ] || errore "Le porte vanno da 1024 a 65535."; done
[ "$(id -u)" -eq 0 ] || errore "Va lanciato con sudo."
DIR="$BASE/$NOME"
[ -f "$DIR/.env" ] && [ -f "$DIR/orion.env" ] || errore "L'istanza $NOME non c'è in $DIR."
DOMINIO=$(sed -n 's/^DOMAIN_NAME=//p' "$DIR/orion.env")
UID_ISTANZA=$(sed -n 's/^ORION_UID=//p' "$DIR/.env")
[ -n "$DOMINIO" ] && [ -n "$UID_ISTANZA" ] || errore "Nel .env o in orion.env mancano DOMAIN_NAME o ORION_UID."

# Una porta è libera se non è del drone di un'altra istanza e sull'host nessuno ci ascolta già.
prima_libera() {
    local porta=$1 chiave=$2 opzioni=$3
    while grep -qsx "$chiave=$porta" "$BASE"/*/.env || ss "$opzioni" "sport = :$porta" | grep -q .; do porta=$((porta + 1)); done
    echo "$porta"
}
PRIMA_RTMP=$(sed -n 's/^ORION_DRONE_PORTA_RTMP=//p' "$DIR/.env")
PRIMA_WEBRTC=$(sed -n 's/^ORION_DRONE_PORTA_WEBRTC=//p' "$DIR/.env")
[ -n "$RTMP" ] || RTMP=$PRIMA_RTMP
[ -n "$WEBRTC" ] || WEBRTC=$PRIMA_WEBRTC
if [ -z "$RTMP" ] || [ -z "$WEBRTC" ]; then command -v ss > /dev/null || errore "Manca ss (pacchetto iproute2): senza non si sa quali porte sono libere."; fi
[ -n "$RTMP" ] || RTMP=$(prima_libera 1935 ORION_DRONE_PORTA_RTMP -ltnH)
[ -n "$WEBRTC" ] || WEBRTC=$(prima_libera 8189 ORION_DRONE_PORTA_WEBRTC -lunH)

occupata() { command -v ss > /dev/null && ss "$2" "sport = :$1" | grep -q .; }
[ "$RTMP" = "$PRIMA_RTMP" ] || ! occupata "$RTMP" -ltnH || errore "Sull'host qualcosa ascolta già sulla porta $RTMP/TCP: scegline un'altra."
[ "$WEBRTC" = "$PRIMA_WEBRTC" ] || ! occupata "$WEBRTC" -lunH || errore "Sull'host qualcosa ascolta già sulla porta $WEBRTC/UDP: scegline un'altra."

# Un'altra istanza con le stesse porte non partirebbe: lo si dice prima.
for altra in "$BASE"/*/.env; do
    [ "$altra" = "$DIR/.env" ] && continue
    grep -qsx "ORION_DRONE_PORTA_RTMP=$RTMP" "$altra" && errore "La porta $RTMP è già del drone di $(basename "$(dirname "$altra")"): scegline un'altra."
    grep -qsx "ORION_DRONE_PORTA_WEBRTC=$WEBRTC" "$altra" && errore "La porta $WEBRTC è già del drone di $(basename "$(dirname "$altra")"): scegline un'altra."
done

# Il compose e la configurazione di MediaMTX arrivano da questa copia del programma.
install -m 644 "$QUI/compose.yaml" "$DIR/compose.yaml"
install -m 644 "$QUI/mediamtx.yml" "$DIR/mediamtx.yml"
mkdir -p "$DIR/drone/registrazioni"
chown "$UID_ISTANZA:$UID_ISTANZA" "$DIR/drone" "$DIR/drone/registrazioni"
chmod 700 "$DIR/drone" "$DIR/drone/registrazioni"

imposta() {
    local chiave=$1 valore=$2
    if grep -q "^$chiave=" "$DIR/.env"; then sed -i "s|^$chiave=.*|$chiave=$valore|" "$DIR/.env"; else echo "$chiave=$valore" >> "$DIR/.env"; fi
}
grep -q '^ORION_DRONE_SEGRETO=' "$DIR/.env" || imposta ORION_DRONE_SEGRETO "$(openssl rand -hex 24)"
imposta COMPOSE_PROFILES drone
imposta ORION_DRONE_HOST "$DOMINIO"
imposta ORION_DRONE_PORTA_RTMP "$RTMP"
imposta ORION_DRONE_PORTA_WEBRTC "$WEBRTC"
chmod 600 "$DIR/.env"

if command -v ufw > /dev/null; then
    if [ -n "$PRIMA_RTMP" ] && [ "$PRIMA_RTMP" != "$RTMP" ]; then ufw delete allow "$PRIMA_RTMP/tcp" > /dev/null || true; fi
    if [ -n "$PRIMA_WEBRTC" ] && [ "$PRIMA_WEBRTC" != "$WEBRTC" ]; then ufw delete allow "$PRIMA_WEBRTC/udp" > /dev/null || true; fi
    ufw allow "$RTMP/tcp" comment "ORION $NOME drone RTMP" > /dev/null
    ufw allow "$WEBRTC/udp" comment "ORION $NOME drone WebRTC" > /dev/null
fi

docker compose -f "$DIR/compose.yaml" up -d --quiet-pull > /dev/null
echo "Drone pronto per $NOME: il pilota trasmette su rtmp://$DOMINIO$([ "$RTMP" = 1935 ] || echo ":$RTMP")/drone/<chiave>."
echo "Resta da accenderlo in ORION: Impostazioni › Moduli › Drone. Le chiavi si danno dal centro operativo, con un'emergenza aperta."
echo "Porte del drone: $RTMP/TCP (RTMP) e $WEBRTC/UDP (WebRTC), aperte nel firewall; se il server sta dietro un router, inoltratele al server."
[ -z "$PRIMA_RTMP" ] || [ "$PRIMA_RTMP/$PRIMA_WEBRTC" = "$RTMP/$WEBRTC" ] || echo "Prima erano $PRIMA_RTMP/TCP e $PRIMA_WEBRTC/UDP: chiudetele sul router e ridate al pilota l'indirizzo nuovo."
