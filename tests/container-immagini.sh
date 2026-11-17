#!/usr/bin/env bash
# Costruisce le tre immagini locali che vuole tests/container.mjs e stampa le tre versioni da passargli.
#   sudo tests/container-immagini.sh [versione di partenza]      (di serie quella di package.json)
# Fuori dal repository nessun file cambia: le varianti si preparano in una copia temporanea.
set -euo pipefail

QUI="$(cd "$(dirname "$0")/.." && pwd)"
PARTENZA="${1:-$(node -p "require('$QUI/package.json').version")}"
[[ $PARTENZA =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || { echo "Versione non valida: $PARTENZA (serve x.y.z)" >&2; exit 1; }
BASE="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
NUOVA="$BASE.$((BASH_REMATCH[3] + 1))"
ROTTA="$BASE.$((BASH_REMATCH[3] + 2))"
IMMAGINE="${ORION_IMMAGINE:-localhost/orion}"
COSTRUISCI=(docker build ${ORION_BUILD_ARGOMENTI:-})

LAVORO="$(mktemp -d)"
trap 'rm -rf "$LAVORO"' EXIT
git -C "$QUI" ls-files -z | (cd "$QUI" && xargs -0 cp --parents -t "$LAVORO")

versione() { (cd "$1" && npm version "$2" --no-git-tag-version --allow-same-version > /dev/null); }

versione "$LAVORO" "$PARTENZA"
"${COSTRUISCI[@]}" -q -t "$IMMAGINE:$PARTENZA" "$LAVORO" > /dev/null

# La versione nuova porta una tabella in più, che la prova cerca dopo l'aggiornamento e dopo il ritorno.
versione "$LAVORO" "$NUOVA"
cat > "$LAVORO/migrations/9999999999999_prova-container.cjs" << 'EOF'
exports.up = (pgm) => { pgm.createTable('prova_container', { id: 'id', nota: { type: 'text' } }, { ifNotExists: true }); };
exports.down = (pgm) => { pgm.dropTable('prova_container', { ifExists: true }); };
EOF
"${COSTRUISCI[@]}" -q -t "$IMMAGINE:$NUOVA" "$LAVORO" > /dev/null

# La versione rotta non arriva mai a rispondere: l'agente deve tornare da solo alla precedente.
versione "$LAVORO" "$ROTTA"
echo "throw new Error('versione di prova che non parte');" > "$LAVORO/src/server.js"
"${COSTRUISCI[@]}" -q -t "$IMMAGINE:$ROTTA" "$LAVORO" > /dev/null

echo "PROVA_PARTENZA=$PARTENZA"
echo "PROVA_NUOVA=$NUOVA"
echo "PROVA_ROTTA=$ROTTA"
