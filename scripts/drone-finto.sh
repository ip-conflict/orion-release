#!/bin/bash
# Un drone finto per provare la diretta senza volare: manda a MediaMTX quello che manda DJI Pilot 2 (RTMP,
# video H.264 senza B-frame, audio AAC), dall'immagine di prova di ffmpeg con l'orologio o da un video.
#   scripts/drone-finto.sh <indirizzo completo dal pannello Drone> [video] [minuti]
# Si ferma con Ctrl+C, come quando il pilota chiude la diretta. Serve ffmpeg (sudo apt install ffmpeg).

set -euo pipefail
errore() { echo "ERRORE: $*" >&2; exit 1; }

INDIRIZZO=${1:-}; VIDEO=${2:-}; MINUTI=${3:-}
[[ $INDIRIZZO =~ ^rtmp://[^/]+/drone/[A-Za-z0-9_-]{24,64}$ ]] \
    || errore "Uso: $0 rtmp://<dominio>[:porta]/drone/<chiave> [video] [minuti]. L'indirizzo è quello che dà il pannello Drone del centro operativo."
command -v ffmpeg > /dev/null || errore "Serve ffmpeg: su Ubuntu sudo apt install ffmpeg, su Windows e Mac da ffmpeg.org."
[ -z "$VIDEO" ] || [ -f "$VIDEO" ] || errore "Il video $VIDEO non c'è."
[[ -z $MINUTI || $MINUTI =~ ^[0-9]+$ ]] || errore "I minuti sono un numero."

if [ -n "$VIDEO" ]; then
    # Il video ricomincia da capo finché la diretta non si ferma; il suo audio non serve, come quello del drone.
    IMMAGINE=(-re -stream_loop -1 -i "$VIDEO")
    SCALA=(-vf "scale=-2:720,fps=30")
else
    IMMAGINE=(-re -f lavfi -i "testsrc2=size=1280x720:rate=30")
    SCALA=()
fi
DURATA=(); [ -z "$MINUTI" ] || DURATA=(-t "$((MINUTI * 60))")

echo "Trasmetto verso ${INDIRIZZO%/*}/… (Ctrl+C per smettere)."
# Un fotogramma chiave ogni due secondi: chi apre la diretta in sala aspetta al massimo quello. Niente B-frame,
# che il WebRTC del browser non mostra; 3 Mbit/s come il Matrice 4E in 720p.
exec ffmpeg -hide_banner -loglevel warning -stats \
    "${IMMAGINE[@]}" \
    -re -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
    -map 0:v:0 -map 1:a:0 "${SCALA[@]}" \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -b:v 3M -maxrate 3M -bufsize 6M -g 60 -keyint_min 60 -sc_threshold 0 -bf 0 \
    -c:a aac -b:a 64k \
    "${DURATA[@]}" -f flv "$INDIRIZZO"
