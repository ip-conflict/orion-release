# Immagine di ORION per le istanze in container: vedi "ORION in container" nel manuale tecnico.
#   docker build -t orion:locale .

FROM node:24-trixie-slim AS dipendenze
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts

FROM node:24-trixie-slim
# pg_dump rifiuta un server più nuovo di sé: il client è quello della versione del database del compose.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=dipendenze /app/node_modules ./node_modules
COPY . .
RUN node copy-libs.js && chmod -R a-w /app

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
