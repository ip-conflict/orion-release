# Immagine di ORION per le istanze in container: vedi "ORION in container" nel manuale tecnico.
#   docker build -t orion:locale .

ARG WHISPER_IMMAGINE=ghcr.io/ip-conflict/orion-whisper:v1.9.5

# Il numero di versione cambia a ogni rilascio: tolto da qui, le dipendenze restano in cache finché
# non cambiano davvero, invece di riscaricarle tutte a ogni aggiornamento.
FROM node:24-trixie-slim AS manifesto
WORKDIR /app
COPY package.json package-lock.json ./
RUN node -e "for (const f of ['package.json', 'package-lock.json']) { const j = JSON.parse(require('fs').readFileSync(f)); j.version = '0.0.0'; if (j.packages?.['']) j.packages[''].version = '0.0.0'; require('fs').writeFileSync(f, JSON.stringify(j, null, 2)); }"

FROM node:24-trixie-slim AS dipendenze
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=manifesto /app/package.json /app/package-lock.json ./
COPY copy-libs.js ./
# Le librerie del browser si copiano in public/ e poi si tolgono: nell'immagine pesavano un terzo di
# node_modules. Se il server comincia a importarne una, va tolta da questo elenco.
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts \
 && node copy-libs.js \
 && npm uninstall --no-save --omit=dev --ignore-scripts --no-audit --no-fund \
      @fortawesome/fontawesome-free @geoman-io/leaflet-geoman-free @tmcw/togeojson dompurify js-cookie \
      leaflet leaflet.markercluster qrcodejs \
 && npm cache clean --force

# whisper.cpp per la trascrizione, già compilato (docker/whisper.Dockerfile): qui si copia soltanto.
FROM ${WHISPER_IMMAGINE} AS whisper

FROM node:24-trixie-slim
# pg_dump rifiuta un server più nuovo di sé: il client è quello della versione del database del compose.
# L'immagine di base arriva a volte senza gli ultimi aggiornamenti di sicurezza di Debian (è successo con zlib).
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=whisper /opt/whisper /opt/whisper

WORKDIR /app
COPY --from=dipendenze /app/node_modules ./node_modules
COPY --from=dipendenze /app/public/vendor ./public/vendor
COPY --from=dipendenze /app/public/js/lib ./public/js/lib
# Niente "chmod -R": copierebbe tutto node_modules in uno strato nuovo, centinaia di MB a ogni
# versione. I file sono di root e l'app gira con un altro utente, su un disco in sola lettura.
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Europe/Rome \
    ORION_DATI_DIR=/dati \
    ORION_CHIAVE_FILE=/chiave/chiave-dati.key \
    ORION_BACKUP_DIR=/backup/auto \
    ORION_BACKUP_NOTTE_DIR=/backup/notte \
    ORION_BACKUP_FILE_DIR=/backup/file

# Il compose sceglie un utente per istanza; questo vale solo per chi lancia l'immagine a mano.
USER 10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --start-interval=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/salute').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "src/server.js"]
