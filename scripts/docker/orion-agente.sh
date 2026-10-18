#!/bin/bash
# Agente delle istanze ORION in container: esegue aggiornamenti e ritorni chiesti dalla pagina
# Sistema e fa i backup notturni. Gira come root sull'host (timer di systemd ogni minuto).
#   orion-agente giro | backup [istanza] | stato | approva <istanza> | rifiuta <istanza> | aggiorna <istanza> <versione>
#   orion-agente disco prepara <dispositivo> | disco copia | disco stato

set -u -o pipefail

BASE="${ORION_BASE:-/srv/orion}"
# docker compose preferisce l'ambiente al .env dell'istanza: una variabile rimasta qui farebbe
# lavorare un'istanza con i valori di un'altra.
for variabile in $(compgen -v | grep -E '^(ORION_|POSTGRES_)'); do
    case "$variabile" in ORION_BASE|ORION_AGENTE_LOG|ORION_SECONDI_SALUTE|ORION_DISCO_GIORNI|ORION_DISCO_CARTELLA) ;; *) unset "$variabile" ;; esac
done
LOG="${ORION_AGENTE_LOG:-/var/log/orion-agente.log}"
VERSIONE_RE='^[0-9]+(\.[0-9]+){1,3}([-+][0-9A-Za-z.]+)?$'
BACKUP_RE='^(orion_[a-z0-9-]+_)?db_[0-9]{8}_[0-9]{6}(_[A-Za-z0-9.-]+)?\.sql\.gz$'
SECONDI_SALUTE="${ORION_SECONDI_SALUTE:-240}"
DISCO_ETICHETTA=ORION-COPIE
DISCO_PUNTO=/mnt/orion-copie
DISCO_GIORNI="${ORION_DISCO_GIORNI:-90}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [${ISTANZA:-agente}] $*" >> "$LOG"; }
adesso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

dc() { docker compose -f "$DIR/compose.yaml" "$@"; }
leggi_env() { grep -E "^$1=" "$DIR/.env" | tail -1 | cut -d= -f2-; }
# I valori sono versioni e impronte già controllate: niente caratteri speciali per sed.
scrivi_env() {
    if grep -qE "^$1=" "$DIR/.env"; then sed -i "s|^$1=.*|$1=$2|" "$DIR/.env"; else echo "$1=$2" >> "$DIR/.env"; fi
}
politica() { local p; p=$(leggi_env ORION_AGGIORNAMENTI); echo "${p:-automatici}"; }

scrivi_stato() {
    local f="$DIR/agente/stato/$1"
    cat > "$f.tmp" && chmod 644 "$f.tmp" && mv -f "$f.tmp" "$f"
}

OP_ID=""; OP_TIPO=""; OP_INIZIO=""; PASSI='[]'
op_inizia() { OP_ID=$1; OP_TIPO=$2; OP_INIZIO=$(adesso); PASSI='[]'; }
op_scrivi() {
    jq -n --arg id "$OP_ID" --arg tipo "$OP_TIPO" --arg inizio "$OP_INIZIO" --argjson passi "$PASSI" \
        --argjson finita "$1" --arg esito "${2:-}" --arg messaggio "${3:-}" --arg ora "$(adesso)" \
        '{id: $id, tipo: $tipo, iniziata: $inizio, passi: $passi, finita: $finita,
          esito: (if $esito == "" then null else $esito end),
          messaggio: (if $messaggio == "" then null else $messaggio end),
          conclusa: (if $finita then $ora else null end)}' | scrivi_stato operazione.json
}
passo() {
    PASSI=$(jq -c --arg t "$1" --arg s "${2:-corso}" --arg q "$(adesso)" '. + [{testo: $t, stato: $s, quando: $q}]' <<< "$PASSI")
    op_scrivi false
    log "$1"
}
fine_passo() { PASSI=$(jq -c --arg s "$1" 'if length > 0 then .[-1].stato = $s else . end' <<< "$PASSI"); op_scrivi false; }
fatto() { op_scrivi true fatto "$1"; log "FATTO: $1"; }
fallito() {
    PASSI=$(jq -c 'if length > 0 and .[-1].stato == "corso" then .[-1].stato = "errore" else . end' <<< "$PASSI")
    op_scrivi true errore "$1"
    log "ERRORE: $1"
}

# L'impronta sotto il nome scelto, altrimenti l'identificativo locale: un'impronta registrata
# sotto un altro nome farebbe cercare l'immagine in un registro che non è il nostro.
rif_di() {
    local immagine=${1%:*} rif
    rif=$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$1" 2>/dev/null | grep -F "$immagine@" | head -1)
    echo "${rif:-$(docker image inspect -f '{{.Id}}' "$1" 2>/dev/null)}"
}
versione_di() { docker run --rm --network none --entrypoint node "$1" -p "require('/app/package.json').version" 2>/dev/null; }
migrazioni_di() {
    docker run --rm --network none --entrypoint ls "$1" /app/migrations 2>/dev/null \
        | sed -nE 's/^([0-9A-Za-z_.-]+)\.c?js$/\1/p' | jq -R . | jq -sc .
}

STORICO() { echo "$DIR/agente/stato/versioni.json"; }
storico_prepara() {
    [ -s "$(STORICO)" ] && return 0
    local rif ver migr
    rif=$(leggi_env ORION_IMMAGINE_RIF); ver=$(leggi_env ORION_VERSIONE)
    migr=$(migrazioni_di "$rif") || return 1
    jq -n --arg v "$ver" --arg r "$rif" --arg d "$(adesso)" --argjson m "$migr" \
        '[{versione: $v, rif: $r, dal: $d, migrazioni: $m}]' | scrivi_stato versioni.json
}
storico_cambia() {
    local migr
    migr=$(migrazioni_di "$2")
    jq --arg v "$1" --arg r "$2" --arg b "${3:-}" --arg ora "$(adesso)" --argjson m "${migr:-[]}" \
        '(if length > 0 then .[-1].al = $ora | .[-1].backup = (if $b == "" then null else $b end) else . end)
         + [{versione: $v, rif: $r, dal: $ora, migrazioni: $m}]' "$(STORICO)" | scrivi_stato versioni.json
}

battito() {
    jq -n --arg t "$(adesso)" --arg p "$(politica)" --arg v "$(leggi_env ORION_VERSIONE)" \
        '{visto_il: $t, politica: $p, versione: $v}' | scrivi_stato agente.json
}

attendi_salute() {
    local limite=$((SECONDS + SECONDI_SALUTE)) contenitore salute
    while ((SECONDS < limite)); do
        contenitore=$(dc ps -q app 2>/dev/null)
        salute=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$contenitore" 2>/dev/null)
        [ "$salute" = healthy ] && return 0
        [ "$salute" = unhealthy ] && return 1
        sleep 3
    done
    return 1
}

cambia_immagine() {
    scrivi_env ORION_IMMAGINE_RIF "$1"
    scrivi_env ORION_VERSIONE "$2"
    dc up -d --no-deps app >> "$LOG" 2>&1 && attendi_salute
}

# Lo scrive un container nuovo dell'immagine in servizio, non il processo che risponde in rete;
# il file resta di root: l'applicazione lo legge ma non lo cancella.
# Nel nome l'istanza e l'ora italiana (quella dell'istanza), come nei backup dell'applicazione.
orario_nome() { TZ="$(grep -E '^TZ=' "$DIR/orion.env" | cut -d= -f2-)" date "+%Y%m%d_%H%M%S"; }

fai_backup() {
    local nome f
    nome="orion_${ISTANZA}_db_$(orario_nome)_$1.sql.gz"
    f="$DIR/backup/notte/$nome"
    if dc run --rm -T --no-deps app node scripts/backup-db.mjs > "$f.tmp" 2>> "$LOG" && [ "$(stat -c%s "$f.tmp")" -gt 1000 ]; then
        chown root:"$(leggi_env ORION_UID)" "$f.tmp"; chmod 640 "$f.tmp"; mv -f "$f.tmp" "$f"
        echo "$nome"
    else
        rm -f "$f.tmp"
        return 1
    fi
}

esegui_aggiornamento() {
    local versione=$1 immagine rif_prima versione_prima rif backup
    immagine=$(leggi_env ORION_IMMAGINE); rif_prima=$(leggi_env ORION_IMMAGINE_RIF); versione_prima=$(leggi_env ORION_VERSIONE)

    passo "Scaricamento della versione $versione"
    if ! docker pull -q "$immagine:$versione" >> "$LOG" 2>&1 && ! docker image inspect "$immagine:$versione" > /dev/null 2>&1; then
        fallito "La versione $versione non c'è fra le immagini pubblicate: non è cambiato niente."
        return
    fi
    rif=$(rif_di "$immagine:$versione")
    if [ "$(versione_di "$rif")" != "$versione" ]; then
        fallito "L'immagine scaricata non è la versione $versione: non è cambiato niente."
        return
    fi
    fine_passo fatto

    passo "Backup del database"
    if ! backup=$(fai_backup pre-aggiornamento); then
        fallito "Il backup non è riuscito, quindi l'aggiornamento non è partito: non è cambiato niente."
        return
    fi
    fine_passo fatto

    passo "Aggiornamento del database"
    if ! ORION_IMMAGINE_RIF="$rif" dc run --rm -T --no-deps app node scripts/migrazioni.mjs su >> "$LOG" 2>&1; then
        fallito "Le migrazioni del database non sono riuscite: è ancora in servizio la versione $versione_prima. Il backup di prima è $backup."
        return
    fi
    fine_passo fatto

    passo "Avvio della versione $versione"
    if cambia_immagine "$rif" "$versione"; then
        fine_passo fatto
        storico_cambia "$versione" "$rif" "$backup"
        fatto "Aggiornamento alla versione $versione completato. Ricarica la pagina."
        return
    fi
    fine_passo errore
    # La versione nuova non ha servito nessuno: le sue modifiche al database si annullano con i
    # suoi stessi "down", altrimenti quella di prima ripartirebbe su uno schema che non conosce.
    passo "Ritorno alla versione $versione_prima"
    dc stop app >> "$LOG" 2>&1
    local schema="con il database com'era"
    if ! jq -r '.[-1].migrazioni[]' "$(STORICO)" | ORION_IMMAGINE_RIF="$rif" dc run --rm -T --no-deps app node scripts/migrazioni.mjs verso >> "$LOG" 2>&1; then
        schema="ma il database è rimasto alla forma nuova (il backup di prima è $backup)"
    fi
    if cambia_immagine "$rif_prima" "$versione_prima"; then fine_passo fatto; else fine_passo errore; fi
    fallito "La versione $versione non è partita: è di nuovo in servizio la $versione_prima, $schema."
}

esegui_ritorno() {
    local versione=$1 dati=$2 nome_backup=$3 voce rif rif_prima versione_prima backup
    rif_prima=$(leggi_env ORION_IMMAGINE_RIF); versione_prima=$(leggi_env ORION_VERSIONE)

    passo "Preparazione della versione $versione"
    voce=$(jq -c --arg v "$versione" '[.[] | select(.versione == $v)] | last // empty' "$(STORICO)" 2>/dev/null)
    if [ -z "$voce" ]; then
        fallito "La versione $versione non è mai stata in servizio qui: non è cambiato niente."
        return
    fi
    rif=$(jq -r .rif <<< "$voce")
    if ! docker image inspect "$rif" > /dev/null 2>&1 && ! docker pull -q "$rif" >> "$LOG" 2>&1; then
        fallito "L'immagine della versione $versione non è più disponibile: non è cambiato niente."
        return
    fi
    if [ "$dati" = si ] && { ! [[ $nome_backup =~ $BACKUP_RE ]] || [ ! -f "$DIR/backup/notte/$nome_backup" ]; }; then
        fallito "Il backup dei dati di allora non c'è: non è cambiato niente."
        return
    fi
    fine_passo fatto

    passo "Backup del database attuale"
    if ! backup=$(fai_backup pre-ritorno); then
        fallito "Il backup non è riuscito, quindi non si è tornati indietro: non è cambiato niente."
        return
    fi
    fine_passo fatto

    dc stop app >> "$LOG" 2>&1
    if [ "$dati" = si ]; then
        passo "Dati come erano prima di lasciare la versione $versione"
        if ! dc run --rm -T --no-deps app node scripts/ripristina-db.mjs "/backup/notte/$nome_backup" >> "$LOG" 2>&1; then
            dc up -d --no-deps app >> "$LOG" 2>&1
            fallito "Il ripristino dei dati di allora non è riuscito: database e programma sono quelli di prima."
            return
        fi
    else
        passo "Il database torna alla forma della versione $versione"
        if ! jq -r '.migrazioni[]' <<< "$voce" | dc run --rm -T --no-deps app node scripts/migrazioni.mjs verso >> "$LOG" 2>&1; then
            dc up -d --no-deps app >> "$LOG" 2>&1
            fallito "Il database non è tornato alla forma di quella versione: non è cambiato niente. Si può riprovare riportando anche i dati a com'erano."
            return
        fi
    fi
    fine_passo fatto

    passo "Avvio della versione $versione"
    if cambia_immagine "$rif" "$versione"; then
        fine_passo fatto
        storico_cambia "$versione" "$rif" "$backup"
        fatto "Tornati alla versione $versione. Ricarica la pagina. I dati di prima del ritorno sono nel backup $backup."
        return
    fi
    fine_passo errore
    passo "Ritorno alla versione $versione_prima"
    if cambia_immagine "$rif_prima" "$versione_prima"; then fine_passo fatto; else fine_passo errore; fi
    fallito "La versione $versione non è partita: è di nuovo in servizio la $versione_prima. Il database è già cambiato; i dati di prima sono nel backup $backup."
}

# La richiesta si legge dentro il container: un collegamento simbolico messo dall'applicazione
# punterebbe a un file del container, non dell'host.
leggi_richiesta() { dc exec -T app cat /agente/richieste/richiesta 2> /dev/null; }
togli_richiesta() { dc exec -T app rm -f /agente/richieste/richiesta > /dev/null 2>&1; }
campo() { grep -E "^$1=[0-9A-Za-z._+-]{0,80}$" <<< "$RICHIESTA" | head -1 | cut -d= -f2-; }

giro_istanza() {
    battito
    storico_prepara
    RICHIESTA=$(leggi_richiesta) || return 0
    [ -n "$RICHIESTA" ] || return 0
    local id tipo versione decisa
    id=$(campo id); tipo=$(campo tipo); versione=$(campo versione)
    if ! [[ $id =~ ^[0-9a-f]{16}$ && $tipo =~ ^(aggiornamento|ritorno)$ && $versione =~ $VERSIONE_RE ]]; then
        togli_richiesta
        log "Richiesta non valida, scartata."
        return 0
    fi
    op_inizia "$id" "$tipo"

    case "$(politica)" in
        bloccati)
            togli_richiesta
            fallito "Chi gestisce il server ha bloccato gli aggiornamenti di questa installazione."
            return 0 ;;
        chiedi)
            decisa=""
            [ "$(cat "$DIR/agente/approvata" 2> /dev/null)" = "$id" ] && decisa=si
            [ "$(cat "$DIR/agente/rifiutata" 2> /dev/null)" = "$id" ] && decisa=no
            if [ -z "$decisa" ]; then
                if [ "$(jq -r .id "$DIR/agente/stato/operazione.json" 2> /dev/null)" != "$id" ]; then
                    passo "In attesa dell'approvazione di chi gestisce il server"
                fi
                return 0
            fi
            togli_richiesta
            if [ "$decisa" = no ]; then
                passo "Chi gestisce il server non l'ha approvata" errore
                fallito "Chi gestisce il server non ha approvato la richiesta: non è cambiato niente."
                return 0
            fi
            passo "Approvata da chi gestisce il server" fatto ;;
        *)
            togli_richiesta ;;
    esac

    log "Richiesta $tipo verso $versione."
    if [ "$tipo" = aggiornamento ]; then
        esegui_aggiornamento "$versione"
    else
        esegui_ritorno "$versione" "$(campo dati)" "$(campo backup)"
    fi
}

backup_istanza() {
    local nome giorni uid
    uid=$(leggi_env ORION_UID)
    if nome=$(fai_backup notte); then log "Backup notturno: $nome"; else log "ERRORE: backup notturno del database non riuscito."; fi
    for cartella in uploads protected_uploads; do
        [ -d "$DIR/dati/$cartella" ] || continue
        rsync -a --delete "$DIR/dati/$cartella" "$DIR/backup/file/" || log "ERRORE: copia di $cartella non riuscita."
    done
    chown -R root:"$uid" "$DIR/backup/file"; chmod -R u=rwX,g=rX,o= "$DIR/backup/file"
    giorni=$(grep -E '^ORION_BACKUP_RETENTION_DAYS=' "$DIR/orion.env" | cut -d= -f2-)
    find "$DIR/backup/notte" -name '*.sql.gz' -type f -mtime +"${giorni:-30}" -delete
}

# Il disco esterno si monta solo per la copia: il resto del tempo non lo vede nessuno, nemmeno un
# programma impazzito sul server. ORION_DISCO_CARTELLA (una cartella qualunque) serve alle prove.
disco_configurato() { [ -n "${ORION_DISCO_CARTELLA:-}" ] || grep -q "^LABEL=$DISCO_ETICHETTA " /etc/fstab 2> /dev/null; }
monta_disco() {
    if [ -n "${ORION_DISCO_CARTELLA:-}" ]; then
        [ -d "$ORION_DISCO_CARTELLA" ] && echo "$ORION_DISCO_CARTELLA"
        return
    fi
    blkid -L "$DISCO_ETICHETTA" > /dev/null 2>&1 || return 1
    mountpoint -q "$DISCO_PUNTO" || mount "$DISCO_PUNTO" 2>> "$LOG" || return 1
    echo "$DISCO_PUNTO"
}
smonta_disco() {
    [ -n "${ORION_DISCO_CARTELLA:-}" ] && return 0
    sync
    umount "$DISCO_PUNTO" 2>> "$LOG" || log "ATTENZIONE: il disco delle copie non si smonta."
}

segna_disco() {
    local ultima
    ultima=$(jq -r '.ultima // empty' "$DIR/agente/stato/disco.json" 2> /dev/null)
    [ "$1" = fatta ] && ultima=$(adesso)
    jq -n --arg u "$ultima" --arg e "$1" '{configurato: true, ultima: (if $u == "" then null else $u end), esito: $e}' | scrivi_stato disco.json
}

# Sul disco solo roba cifrata con la chiave dell'istanza: i dump lo sono già, i file si
# impacchettano e si cifrano. Per riaprirli basta la chiave di recupero stampata.
copia_istanza() {
    local destinazione="$DISCO_DIR/$ISTANZA" archivio esito=fatta
    mkdir -p "$destinazione/db" "$destinazione/file"
    if ! rsync -a --ignore-existing --include='*.sql.gz' --exclude='*' "$DIR/backup/notte/" "$destinazione/db/" >> "$LOG" 2>&1; then
        log "ERRORE: copia dei dump sul disco non riuscita."
        esito=errore
    fi
    archivio="$destinazione/file/orion_${ISTANZA}_file_$(orario_nome).tar.gz"
    if dc run --rm -T --no-deps app sh -c 'cd /dati && set -- && for d in uploads protected_uploads loghi; do [ -d "$d" ] && set -- "$@" "$d"; done; tar -cz "$@" | node /app/scripts/cifra-flusso.mjs' \
        > "$archivio.tmp" 2>> "$LOG" && [ -s "$archivio.tmp" ]; then
        mv -f "$archivio.tmp" "$archivio"
    else
        rm -f "$archivio.tmp"
        log "ERRORE: archivio dei file per il disco non riuscito."
        esito=errore
    fi
    find "$destinazione/db" -name '*.sql.gz' -type f -mtime +"$DISCO_GIORNI" -delete
    ls -1t "$destinazione/file"/*.tar.gz 2> /dev/null | tail -n +4 | xargs -r rm -f
    segna_disco "$esito"
    log "Copia sul disco esterno: $esito."
}
disco_assente() { segna_disco assente; }

copia_su_disco() {
    disco_configurato || return 0
    if ! DISCO_DIR=$(monta_disco); then
        log "Disco delle copie non collegato: copia saltata."
        per_istanza disco_assente
        return 1
    fi
    export DISCO_DIR
    [ -f "$DISCO_DIR/LEGGIMI.txt" ] || cat > "$DISCO_DIR/LEGGIMI.txt" << 'TESTO'
Copie di ORION, una cartella per istanza.
db/    backup del database (orion_<istanza>_db_<data>_<ora>_<motivo>.sql.gz),
       cifrati con la chiave dell'istanza
file/  file caricati (orion_<istanza>_file_<data>_<ora>.tar.gz), cifrati con la stessa chiave

Un backup del database si ripristina dalla pagina Sistema: "Carica un backup da un file".
Fuori da ORION si decifra con scripts/decifra-backup.mjs e la chiave di recupero stampata.
TESTO
    per_istanza copia_istanza
    smonta_disco
}

disco_prepara() {
    local dispositivo=$1 conferma
    [ -b "$dispositivo" ] || { echo "$dispositivo non è un disco." >&2; exit 1; }
    if lsblk -nro MOUNTPOINT "$dispositivo" | grep -q .; then
        echo "$dispositivo (o una sua parte) è in uso: non lo tocco. È il disco del sistema?" >&2
        exit 1
    fi
    lsblk -o NAME,SIZE,MODEL,LABEL "$dispositivo"
    read -r -p "Tutto quello che c'è su $dispositivo sarà cancellato. Scrivi CANCELLA per continuare: " conferma
    [ "$conferma" = CANCELLA ] || { echo "Niente è stato toccato."; exit 1; }
    wipefs -a "$dispositivo" > /dev/null && mkfs.ext4 -q -F -L "$DISCO_ETICHETTA" "$dispositivo" || exit 1
    mkdir -p "$DISCO_PUNTO"
    chmod 700 "$DISCO_PUNTO"
    grep -q "^LABEL=$DISCO_ETICHETTA " /etc/fstab || echo "LABEL=$DISCO_ETICHETTA $DISCO_PUNTO ext4 noauto,nofail 0 0" >> /etc/fstab
    systemctl daemon-reload 2> /dev/null || true
    echo "Disco pronto. La copia si fa ogni notte dopo il backup, o subito con: orion-agente disco copia"
    echo "Un secondo disco si prepara allo stesso modo: si alternano, la copia va su quello collegato."
}

disco_stato() {
    if ! disco_configurato; then echo "Nessun disco per le copie: orion-agente disco prepara <dispositivo>"; return; fi
    if ! DISCO_DIR=$(monta_disco); then echo "Disco delle copie non collegato."; return; fi
    df -h "$DISCO_DIR" | tail -1 | awk '{print "Spazio libero sul disco: " $4 " su " $2}'
    for cartella in "$DISCO_DIR"/*/; do
        [ -d "$cartella/db" ] || continue
        printf '%-20s ultimo dump %s, ultimo archivio dei file %s\n' "$(basename "$cartella")" \
            "$(ls -1t "$cartella/db" 2> /dev/null | head -1)" "$(ls -1t "$cartella/file" 2> /dev/null | head -1)"
    done
    smonta_disco
}

per_istanza() {
    local azione=$1 solo=${2:-}
    for DIR in "$BASE"/*/; do
        DIR=${DIR%/}
        ISTANZA=$(basename "$DIR")
        [ -f "$DIR/compose.yaml" ] && [ -f "$DIR/.env" ] || continue
        [ -z "$solo" ] || [ "$solo" = "$ISTANZA" ] || continue
        (
            exec 9> "$DIR/agente/.blocco"
            # Il giro di ogni minuto salta un'istanza occupata; il resto aspetta il suo turno.
            if [ "$azione" = giro_istanza ]; then flock -n 9 || exit 0; else flock 9; fi
            "$azione"
        )
    done
}

stato_istanza() {
    local contenitore salute
    contenitore=$(dc ps -q app 2> /dev/null)
    salute=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$contenitore" 2> /dev/null)
    printf '%-20s %-10s porta %-6s %-11s %s\n' "$ISTANZA" "$(leggi_env ORION_VERSIONE)" "$(leggi_env ORION_PORTA)" "$(politica)" "${salute:-fermo}"
}

decidi() {
    local id
    id=$(jq -r 'select(.finita == false) | .id' "$DIR/agente/stato/operazione.json" 2> /dev/null)
    if [ -z "$id" ]; then echo "$ISTANZA: nessuna richiesta in attesa."; return; fi
    echo "$id" > "$DIR/agente/$DECISIONE"
    echo "$ISTANZA: richiesta $id $DECISIONE."
    giro_istanza
}

aggiorna_a_mano() {
    op_inizia "$(openssl rand -hex 8)" aggiornamento
    passo "Chiesto da chi gestisce il server" fatto
    esegui_aggiornamento "$VERSIONE_A_MANO"
    jq -r .messaggio "$DIR/agente/stato/operazione.json"
}

command -v jq > /dev/null || { echo "Serve jq (apt-get install jq)." >&2; exit 1; }
case "${1:-giro}" in
    giro) per_istanza giro_istanza ;;
    backup)
        per_istanza backup_istanza "${2:-}"
        [ -n "${2:-}" ] || copia_su_disco || true ;;
    disco)
        case "${2:-stato}" in
            prepara) [ -n "${3:-}" ] || { echo "Uso: $0 disco prepara <dispositivo>" >&2; exit 2; }; disco_prepara "$3" ;;
            copia) copia_su_disco || { echo "Disco delle copie non collegato." >&2; exit 1; } ;;
            *) disco_stato ;;
        esac ;;
    stato) per_istanza stato_istanza ;;
    approva|rifiuta)
        [ -n "${2:-}" ] || { echo "Uso: $0 $1 <istanza>" >&2; exit 2; }
        DECISIONE=$([ "$1" = approva ] && echo approvata || echo rifiutata)
        per_istanza decidi "$2" ;;
    aggiorna)
        [[ ${3:-} =~ $VERSIONE_RE ]] || { echo "Uso: $0 aggiorna <istanza> <versione>" >&2; exit 2; }
        VERSIONE_A_MANO=$3
        per_istanza aggiorna_a_mano "$2" ;;
    *) echo "Uso: $0 giro | backup [istanza] | stato | approva <istanza> | rifiuta <istanza> | aggiorna <istanza> <versione> | disco prepara <dispositivo> | disco copia | disco stato" >&2; exit 2 ;;
esac
