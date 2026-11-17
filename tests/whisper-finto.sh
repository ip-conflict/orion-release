#!/bin/sh
# Al posto di whisper-cli nelle prove: controlla gli argomenti e il WAV, e risponde come lui.
#   ORION_WHISPER=tests/whisper-finto.sh npm start
modello= lingua= file=
while [ $# -gt 0 ]; do
    case "$1" in
        -m) modello=$2; shift ;;
        -l) lingua=$2; shift ;;
        -f) file=$2; shift ;;
    esac
    shift
done
[ -f "$modello" ] && [ "$lingua" = it ] && [ "$(head -c 4 "$file")" = RIFF ] || { echo "argomenti sbagliati" >&2; exit 2; }
# Il modello "small" è lento apposta: la prova cambia modello mentre lavora.
case "$modello" in *ggml-small.bin) sleep 30 ;; esac
# Come quello vero, che risponde dopo secondi: il testo deve comparire anche quando nient'altro si muove.
[ -n "${ORION_WHISPER_ATTESA:-}" ] && sleep "$ORION_WHISPER_ATTESA"
printf '[BLANK_AUDIO]\n Bravo arrivato sul posto,\n serve una motopompa.\n'
