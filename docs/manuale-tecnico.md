# ORION, manuale tecnico

Questo manuale è per chi installa, mantiene e sviluppa ORION: il tecnico
dell'associazione che cura il server e lo sviluppatore che mette mano al
codice. Chi usa ORION trova quello che gli serve nei manuali d'uso
(`manuale-web.md` per il browser, `manuale-app.md` per il telefono).


## 1. Com'è fatto

ORION è pensato per essere decentralizzato: ogni associazione ha il suo
server, i suoi dati e la sua app collegata a quel server. Non c'è nessun
servizio centrale, nessun account presso terzi, nessuna notifica che passi da
Google o da altri. Se il server dell'associazione è acceso, ORION funziona;
se è spento, nessun altro ne sa niente.

Il server è un'applicazione Node.js (Express 5) con un database PostgreSQL.
Le librerie usate sono poche e tutte all'ultima versione principale: per
vedere se ce ne sono di nuove basta `npm outdated`, e `npm audit --omit=dev`
dice se qualcuna ha un problema di sicurezza noto. Express 5 lascia
`req.body` indefinito quando una richiesta non ha corpo: un middleware in
`server.js` lo rimette a oggetto vuoto, come le rotte si aspettano. Le
librerie del browser (mappa, icone, PDF, QR) non stanno nel repository:
`copy-libs.js` le copia da `node_modules` in `public/vendor` a ogni
installazione. Nell'immagine Docker, dopo la copia, i loro pacchetti si
tolgono da `node_modules` (l'elenco sta nel Dockerfile), perché il server non
li usa e pesavano un terzo delle dipendenze: una libreria che il server
comincia a importare va tolta da quell'elenco.
Il programma e il suo database girano in container Docker, uno per
associazione (capitolo 2). Davanti c'è Nginx, che fa da proxy, gestisce il
certificato HTTPS e lascia passare il WebSocket. Docker tiene acceso il
processo e lo fa ripartire, anche al riavvio della macchina, con un utente di
sistema dedicato e mai come root.

Il codice del server sta in `src/`, diviso in moduli piccoli. `server.js` è
solo il punto d'ingresso: prepara Express e i middleware, registra le rotte
nell'ordine giusto, avvia il server e lo chiude in modo pulito. Le rotte
stanno ciascuna nel suo modulo: `pubbliche.js` (accesso, branding, tesserino),
`sessioni.js`, `impostazioni.js`, `emergenze.js`, `utenti.js`, `squadre.js`,
`segnalazioni.js`, `segreteria.js`, `diarioSala.js`, `magazzino.js` per beni,
movimenti e verbali, `appMobile.js` per quello che esiste solo per l'app
(contesto, coda delle notifiche, token di rinnovo), `esterniTemporanei.js`
per gli accessi esterni durante un'emergenza, `situazione.js` per il punto
di situazione (`GET /api/situazione`, anche per un'emergenza chiusa con
`?emergenza=ID`, solo per l'amministratore), `rubrica.js` per la rubrica
d'emergenza, `funzioni.js` per le funzioni di supporto, `mappaElementi.js` per strade
chiuse e zone sulla mappa, `rischiZone.js` per i rischi delle segnalazioni
presi dalle zone di pericolo (le righe che cominciano con "⚠" nel campo
`environmental_hazard`, ricalcolate quando una segnalazione nasce o si sposta e
quando una zona di pericolo cambia; il testo scritto a mano resta) e
`manutenzione.js`. I servizi
condivisi hanno i loro moduli: `config.js` e `db.js` per configurazione e
database, `autenticazione.js`, `tempoReale.js` per il WebSocket e le
notifiche, `statoEmergenza.js` per l'emergenza attiva, `scadenze.js` per i
controlli giornalieri, e poi `email.js`, `audit.js`, `backup.js`,
`resoconto.js`, `caricamenti.js`, `anagrafica.js`. Le pagine web stanno in
`public/`, con i loro script in `public/js/`. Non c'è un passaggio di compilazione del frontend.
I fogli da stampare (`situazione.html`, `rubrica.html`) condividono
`public/css/stampa.css`: A4, margini fissati con `@page`, testo scuro anche
col tema scuro, numero di pagina in fondo.

L'app Android sta in un repository a parte (orion-app). È scritta in Kotlin
con Jetpack Compose, parla con il server attraverso le stesse rotte del web e
riceve gli aggiornamenti in tempo reale dallo stesso WebSocket. È una sola per
tutte le associazioni: il server si scrive al primo accesso.


## 2. Installare

ORION si installa in container Docker, una istanza per associazione. Una
macchina può ospitarne una sola o parecchie: ogni istanza ha i suoi due
container (il programma e il suo PostgreSQL) in una rete privata, una
cartella sua sotto `/srv/orion/<nome>`, un utente di sistema suo (un numero
da 20001 in su) e una porta sua che risponde solo sulla macchina stessa.
Davanti a tutte c'è lo stesso Nginx, con un sito e un certificato per
dominio. Accanto alle istanze gira l'agente (`/usr/local/sbin/orion-agente`,
da `scripts/docker/orion-agente.sh`), che esegue gli aggiornamenti, l'installazione del drone e i cambi di
memoria chiesti dalla pagina Sistema e fa i backup notturni.

### Cosa serve

| Cosa | Caratteristiche |
|---|---|
| Macchina | Ubuntu Server 24.04 LTS, processore x86, 4 GB di RAM per una o due istanze (8–16 GB per di più), SSD da almeno 80 GB, rete via cavo |
| Indirizzo | IPv4 pubblico e statico, non dietro CGNAT |
| Nomi | un nome per istanza (anche sottodomini dello stesso dominio), con un record A verso l'indirizzo pubblico |
| Accesso | un utente con sudo e OpenSSH, raggiunto dal tecnico attraverso una VPN |

Per un server in sede servono anche il gruppo di continuità e, nel BIOS, la
ripartenza automatica al ritorno della corrente; il disco esterno per le
copie è descritto nel capitolo 7.

Della rete il server vuole poco, ma quel poco va chiesto a chi gestisce il
router o il firewall. La macchina ha un indirizzo fisso nella rete locale
(una prenotazione DHCP). Il router inoltra a lei le porte TCP 80 e 443 e
nient'altro: le porte delle istanze, del database e la 22 restano chiuse,
perché le istanze rispondono solo sulla macchina stessa e il tecnico entra
dalla VPN. In uscita la macchina deve raggiungere internet sulle porte 80 e
443 (aggiornamenti di Ubuntu, registri delle immagini, Let's Encrypt, GitHub
per gli aggiornamenti e il bollettino di allerta), 53 per il DNS, 123 per
l'ora e la porta del server di posta (587 o 465); se il firewall ispeziona il
traffico cifrato, la macchina va esclusa. Se la sala operativa è nella stessa
rete, il router deve saper raggiungere il server con il suo nome pubblico (NAT
loopback), oppure un DNS locale deve far puntare i nomi all'indirizzo
interno: così la sala lavora anche con internet giù. Con IPv6 pubblico, o si
inoltrano anche lì le porte 80 e 443, o non si pubblicano record AAAA.

Con il drone acceso ogni istanza aggiunge due porte in ingresso, le stesse
qualunque sia il numero di droni (capitolo "Il drone"); le altre restano
quelle di sopra.

| Verso | Porta | Da dove o per cosa |
|---|---|---|
| Ingresso al server | 80 e 443/TCP | Browser della sala, app, schermo a parete, Let's Encrypt; comuni a tutte le istanze |
| Ingresso al server | RTMP dell'istanza/TCP (1935, 1936...) | Radiocomando del drone, dalla sua SIM: da qualunque indirizzo |
| Ingresso al server | WebRTC dell'istanza/UDP (8189, 8190...) | Browser della sala che guardano la diretta |
| Uscita dal server | 80 e 443/TCP, 53, 123, 587 o 465 | Come sopra; il video verso la sala viaggia come risposta sulla porta UDP di WebRTC |

La sala operativa, anche lontana dal server, non apre nessuna porta in
ingresso: è sempre lei a chiamare il server. In uscita deve poter
raggiungere il server sulla 443/TCP e, per vedere il drone, sulla porta UDP
di WebRTC della sua istanza. Le reti che bloccano l'UDP in uscita, come
capita in quelle comunali, lasciano lavorare la sala ma senza video del
drone: va chiesto di aprire quella porta verso l'indirizzo del server.

### Preparare la macchina

Una volta per macchina, dalla cartella del codice:

```
git clone https://github.com/ip-conflict/orion-release.git && cd orion-release
sudo scripts/docker/prepara-host.sh
```

Lo script installa Docker con il suo plugin compose, jq, rsync, iproute2,
Nginx, Certbot e il firewall (solo SSH e Nginx), copia l'agente in
`/usr/local/sbin/orion-agente` e `attiva-drone.sh` in
`/usr/local/sbin/orion-attiva-drone`, e accende i suoi due timer di systemd:
`orion-agente.timer` ogni minuto, `orion-backup.timer` alle 3:30. Mette
anche in Nginx un sito predefinito che non risponde: chi arriva con
l'indirizzo IP, o con un nome che non è di un'istanza, non finisce dentro
nessuna.

L'agente sta sulla macchina e non cambia quando un'istanza si aggiorna: le
immagini portano il programma, non l'agente. Ogni versione di ORION sa quale
versione dell'agente si aspetta (`AGENTE_ATTESO` in `src/manutenzione.js`,
`AGENTE_VERSIONE` nello script) e, se quello sulla macchina è più vecchio, la
pagina Sistema lo dice fra le avvertenze e non offre le funzioni che lui non
conosce. Si aggiorna dalla cartella del repository portata alla versione
nuova (`git pull`), con `sudo install -m 755 scripts/docker/orion-agente.sh
/usr/local/sbin/orion-agente`, oppure rilanciando `prepara-host.sh`.

### Creare un'istanza

```
sudo scripts/docker/nuova-istanza.sh <nome> <dominio> [versione]
```

Il nome è fatto di minuscole, cifre e trattini, il dominio deve già puntare
alla macchina. Senza versione si installa l'ultima pubblicata: lo script la
legge dai tag del registro (`ghcr.io` dà un token di sola lettura senza
account) e scarta quelli con il trattino, che sono versioni di prova; se il
registro non risponde, o l'immagine è costruita in sede, chiede di indicarla.
Lo script sceglie la prima porta libera da 3101 in su, genera
password e segreti, prepara le cartelle con i permessi giusti, scarica
l'immagine `ghcr.io/ip-conflict/orion:<versione>`, controlla che contenga
davvero quella versione, avvia i container e aspetta che il programma
risponda. Poi scrive il sito di Nginx e chiede il certificato a Let's Encrypt
(con `ORION_EMAIL` per l'indirizzo degli avvisi); se non ci riesce lo dice, e
basta rilanciare `sudo certbot --nginx -d <dominio>` quando le porte sono
aperte. `--senza-nginx` salta questa parte.

Il sito di Nginx accetta richieste fino a 100 MB, tranne il caricamento dei
backup dalla pagina Sistema, che arriva a 500 MB e ha una sua `location`. Le
istanze create prima di questa regola tagliano un backup grande con un errore
poco chiaro: si aggiunge a mano, nel blocco `server` di
`/etc/nginx/sites-available/<dominio>` (e nella copia per HTTPS che certbot ha
scritto nello stesso file), prima di `location /`, questo blocco con la porta
dell'istanza, e si ricarica Nginx con `sudo nginx -t && sudo systemctl reload
nginx`. Le istruzioni `proxy_*` vanno ripetute perché in Nginx una `location`
non eredita quelle di un'altra.

```nginx
location = /api/sistema/backup/carica {
    client_max_body_size 520M;
    proxy_request_buffering off;
    proxy_pass http://127.0.0.1:<porta>;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

L'immagine si può anche costruire sulla macchina, per esempio prima che
l'immagine ufficiale di una versione sia pubblicata: `sudo docker build -t
localhost/orion:1.2.3 .` dalla cartella del codice, e l'istanza si crea con
`ORION_IMMAGINE=localhost/orion`. Il prefisso `localhost/` non è un vezzo:
con un nome semplice l'agente chiederebbe gli aggiornamenti a Docker Hub, dove
chiunque può pubblicare un'immagine con quel nome. Per aggiornare si
costruisce la versione nuova con lo stesso nome; quando l'immagine ufficiale
c'è, basta mettere `ORION_IMMAGINE=ghcr.io/ip-conflict/orion` nel `.env`
dell'istanza. La costruzione non compila niente: scarica le dipendenze e
copia il programma di trascrizione dall'immagine `orion-whisper`, già
compilata (si veda la trascrizione più avanti), e richiede un paio di minuti
anche su un server piccolo. Le costruzioni successive riprendono le
dipendenze dalla cache di Docker finché `package-lock.json` non cambia
davvero, anche se cambia il numero di versione di ORION.

Per le prove conviene che l'immagine la costruisca GitHub, così il server
scarica soltanto e non tiene sul disco la cache di costruzione. Nel
repository di sviluppo il workflow "Immagine", lanciato a mano con una
versione di prova come `1.4.2-test.1`, pubblica `ghcr.io/ip-conflict/orion-dev`:
un nome diverso da quello di `orion-release`, così una prova non prende mai il
posto di una versione vera, e un pacchetto privato, perché contiene il codice.
Il server di prova accede una volta sola con `sudo docker login ghcr.io`,
usando come password un token di GitHub con il solo permesso
`read:packages`; poi nel `.env` dell'istanza si mette
`ORION_IMMAGINE=ghcr.io/ip-conflict/orion-dev` e si aggiorna con `sudo
orion-agente aggiorna <istanza> 1.4.2-test.1`. La versione va sempre
indicata, perché quelle con il trattino non si scelgono da sole. Il workflow
tiene gli strati delle dipendenze nella cache di GitHub, e una costruzione
che non le cambia richiede un paio di minuti. Su un host
preparato prima che `prepara-host.sh` installasse buildx, Docker avvisa che il
vecchio costruttore è deprecato: si toglie con `sudo apt install
docker-buildx`.

Ogni versione lascia sul disco la sua immagine, e ogni costruzione la sua
cache. Dopo il backup notturno l'agente toglie le immagini senza nome, la cache
di costruzione più vecchia di una settimana e, per ogni nome di immagine di
ORION, tutte le versioni tranne le tre più recenti e quelle in uso: bastano
per tornare indietro. `sudo orion-agente pulisci` lo fa subito e mostra lo
spazio occupato da Docker. I log dei container sono tenuti a tre file da 10
MB: `prepara-host.sh` lo imposta per tutto l'host in
`/etc/docker/daemon.json`, il `compose.yaml` delle istanze per i propri.

Il primo amministratore non si chiede durante l'installazione: si crea dal
browser. ORION, avviato senza amministratori, genera un codice di
configurazione monouso e lo scrive in `dati/PRIMO-ACCESSO.txt` dentro la
cartella dell'istanza; lo script lo mostra alla fine. La pagina di accesso,
finché l'amministratore non c'è, mostra al posto del login il modulo
"Configurazione iniziale": codice, nome, cognome, email facoltativa e
password, con le stesse regole di ogni altra password di ORION. Lo username lo
forma il server come per tutti (cognome e iniziale del nome, `generateUsername`)
e il modulo lo mostra in anteprima. Il codice serve perché fra la fine
dell'installazione e il primo accesso l'indirizzo è già pubblico, e senza
codice l'amministratore lo diventerebbe il primo che arriva. Creato
l'amministratore, si entra subito con una sessione che vale come verificata:
il codice letto sul server e la password sono già due fattori. La verifica in
due passaggi, obbligatoria per l'amministratore, si attiva all'accesso
successivo, come per chiunque non l'abbia ancora. Il file si cancella, il
modulo non compare più e la rotta risponde 409. Il vecchio `create-admin.js` resta come strumento
di emergenza, dentro il container: `sudo docker compose -f
/srv/orion/<nome>/compose.yaml exec -e ADMIN_USERNAME=<nome> -e
ADMIN_PASSWORD=<password> app node create-admin.js`.

### Com'è fatta un'istanza

| Nella cartella dell'istanza | Cosa contiene | Di chi è |
|---|---|---|
| `compose.yaml` | la descrizione dei due container, uguale per tutte | root |
| `.env` | variabili del compose: immagine, versione, porta, utente, regola degli aggiornamenti, password del database | root, 600 |
| `orion.env` | segreti e impostazioni del programma | root, 600 |
| `dati/` | file caricati, loghi, APK, registri, `PRIMO-ACCESSO.txt` | istanza |
| `chiave/` | `chiave-dati.key` | istanza |
| `postgres/` | i file del database | PostgreSQL |
| `backup/auto/` | backup fatti dall'applicazione | istanza |
| `backup/notte/`, `backup/file/` | backup notturni, quelli prima di aggiornamenti e ritorni, copia dei file | root, letti dall'istanza |
| `agente/richieste/` | la richiesta che la pagina Sistema scrive all'agente | istanza |
| `agente/stato/` | stato dell'agente, operazione in corso, versioni passate di qui, ultima copia su disco | root, letti dall'istanza |

Il programma gira con il file system a sola lettura, senza privilegi del
kernel e senza poterne acquistare; il codice sta nell'immagine e non lo può
cambiare. I dati vivono nelle cartelle montate, indicate dalle variabili
`ORION_DATI_DIR`, `ORION_CHIAVE_FILE`, `ORION_BACKUP_DIR`,
`ORION_BACKUP_NOTTE_DIR` e `ORION_BACKUP_FILE_DIR`, già impostate
nell'immagine. Il database sta in una rete senza uscita verso internet; ha un
ruolo suo, `orion_db_user`, padrone del database `orion_db` ma non
superutente. I limiti di memoria (`ORION_MEMORIA` e `ORION_MEMORIA_DB` nel
`.env`, di base 1 GB e 512 MB) impediscono che un'istanza rallenti le altre.

La memoria del programma si cambia dalla pagina Sistema, riquadro "Memoria di
ORION", con la password: la pagina scrive una richiesta `tipo=memoria` e
l'agente la esegue come un aggiornamento, con la stessa regola
(`ORION_AGGIORNAMENTI`) e mai con un'emergenza aperta. I conti li fa l'agente,
che vede tutte le istanze della macchina. Dalla memoria totale (`MemTotal` di
`/proc/meminfo`) toglie una parte per il sistema, Docker e Nginx (un giga, o il
15% sulle macchine grandi), i limiti scritti delle altre istanze, programma e
database, e il database di questa: quello che resta è la memoria libera. Dalla
pagina un'istanza non va oltre un tetto, di base 3 GB (bastano per ogni
modello di trascrizione), che chi gestisce la macchina cambia con
`ORION_MEMORIA_MASSIMA` nel `.env` dell'istanza: così un'associazione non si
prende la memoria libera che servirebbe alle altre. Si contano i
limiti e non l'uso del momento, così la somma dei limiti non supera mai la
memoria della macchina, nemmeno con tutte le istanze piene insieme; due
richieste da istanze diverse si mettono in fila su un blocco unico
(`/srv/orion/.blocco-memoria`), perché non facciano il conto sulla stessa
memoria. Abbassare si può sempre, fino a 768 MB; alzare solo dentro il massimo,
che l'agente ricontrolla anche se la pagina l'ha già fatto. All'istanza
l'agente dice solo la sua memoria, quella del suo database e il suo massimo:
la memoria della macchina e quella delle altre istanze direbbero a
un'associazione chi altro ospita il server, e quanto è grande. Poi scrive
`ORION_MEMORIA` nel `.env`, ricrea il container del programma (circa un minuto
di fermo) e, se il controllo di salute non passa, rimette il valore di prima.
`sudo orion-agente memoria` mostra i limiti di ogni istanza, la memoria libera
e il massimo dalla pagina, e avvisa se la somma supera la macchina (lo fa anche
`nuova-istanza.sh` dopo aver creato un'istanza); `sudo orion-agente memoria
<nome> <MB>` la cambia senza passare dalla pagina, anche oltre il tetto ma mai
oltre la memoria libera. Un processo che non è ORION, sulla stessa macchina, l'agente non
lo vede: chi ce lo mette deve lasciargli spazio abbassando le istanze.

Le istanze sulla stessa macchina non vedono i file né il database delle
altre, ma la macchina resta una: chi è root, o amministra Docker, vede tutto,
e il kernel è uno solo. Chi gestisce un server con più associazioni è
responsabile del trattamento per conto di ognuna (art. 28 del GDPR), e la
loro valutazione d'impatto lo deve dire. Due istanze possono stare su
sottodomini dello stesso dominio: i cookie di sessione sono legati al nome
esatto e firmati con segreti diversi, ma chi possiede il dominio comanda i
nomi di tutte e due.

Un'istanza si sposta su un'altra macchina creandone una nuova con la sua
chiave (`sudo ORION_CHIAVE_DA=<file della chiave> scripts/docker/nuova-istanza.sh
...`), entrando con un amministratore provvisorio, caricando e ripristinando
dalla pagina Sistema l'ultimo backup, e copiando `uploads` e
`protected_uploads` in `dati/` con il proprietario dell'istanza (`chown -R`).
Si toglie con un ultimo backup, `docker compose -f
/srv/orion/<nome>/compose.yaml down`, la cancellazione della sua cartella e
del suo sito in `/etc/nginx/sites-enabled`.


## 3. Configurazione

La configurazione di sistema di un'istanza sta in due file della sua
cartella, scritti da `nuova-istanza.sh` e leggibili solo da root.

| File | Voce | A cosa serve |
|---|---|---|
| `.env` | `ORION_IMMAGINE`, `ORION_VERSIONE`, `ORION_IMMAGINE_RIF` | da dove vengono le immagini, la versione in servizio e la sua impronta; le ultime due le scrive l'agente |
| `.env` | `ORION_PORTA`, `ORION_UID` | la porta sulla macchina e l'utente dell'istanza |
| `.env` | `ORION_AGGIORNAMENTI` | `automatici`, `chiedi` o `bloccati` (capitolo 7) |
| `.env` | `ORION_MEMORIA`, `ORION_MEMORIA_DB`, `ORION_POSTGRES_IMMAGINE` | limiti di memoria e immagine del database |
| `.env` | `ORION_MEMORIA_MASSIMA` | fin dove la pagina Sistema può alzare `ORION_MEMORIA` (3 GB) |
| `.env` | `POSTGRES_PASSWORD`, `ORION_DB_PASSWORD` | le password del database |
| `orion.env` | `JWT_SECRET`, `COOKIE_SECRET` | i segreti di sessioni e cookie |
| `orion.env` | `DOMAIN_NAME`, `TZ` | il dominio e il fuso orario |
| `orion.env` | `ORION_BACKUP_RETENTION_DAYS` | quanti giorni tenere i backup (30) |
| `orion.env` | `ORION_REGISTRO_GIORNI` | dopo quanti giorni escono le voci del registro delle operazioni (0, mai; vedi lo storico inalterabile) |

Dopo una modifica si riparte con `sudo docker compose -f
/srv/orion/<nome>/compose.yaml up -d`. I due segreti non vanno mai cambiati
senza sapere cosa si fa: cambiare `JWT_SECRET` fa uscire tutti.

La mappa del centro operativo usa servizi di OpenStreetMap chiesti dal
browser della sala, non dal server: le tessere della mappa
(tile.openstreetmap.org, il satellite da server.arcgisonline.com), gli
indirizzi (photon.komoot.io e nominatim.openstreetmap.org), i percorsi
delle squadre (router.project-osrm.org) e il radar della pioggia e i fulmini
del Dipartimento della Protezione Civile (l'ora dell'ultimo dato da
radar-api.protezionecivile.it, i dati dall'archivio
s3-prod-dpc-radar-webp-cache.s3.eu-south-1.amazonaws.com, l'ultima immagine
di riserva da radar-geowebcache.protezionecivile.it). Sono gli unici indirizzi esterni ammessi dalla
Content-Security-Policy in `src/server.js`. Senza rete la mappa resta vuota e
il percorso diventa linea d'aria; tutto il resto funziona.

Il radar (`public/js/radar-meteo.js`) è il prodotto SRI, l'intensità di
pioggia al suolo, con licenza CC BY-SA: l'attribuzione "Radar-DPC" compare
sulla mappa. Le immagini passate e i fulmini vengono dall'archivio da cui
legge la piattaforma radar.protezionecivile.it, che non è documentato: le
tessere sono WebP a 256 pixel, ai soli zoom 6 e 7, con il dato nel canale
rosso (0-255 per 0-100 mm/h), in
`SRI/AAAA/MM/GG/hhmm/z/x/y/sri.webp` (ora UTC); i fulmini sono file binari
ogni cinque minuti, `LGT/lgt_5min_<millisecondi>.bin`, nel formato 2 che la
piattaforma legge. La pagina colora le tessere da sé con la scala del
Dipartimento (più visibile per la pioggia debole) e le ingrandisce per gli
zoom più alti.

Poiché l'archivio può cambiare senza preavviso, nulla di quello che arriva si
usa senza controllo. All'accensione e a ogni aggiornamento (ogni due minuti)
si scarica una tessera di prova sull'Italia centrale per l'ultima ora
annunciata dall'API, o per una delle due precedenti se l'archivio è in
ritardo. Se manca o non è nel formato atteso (misura diversa, colori al posto
del dato in scala di grigio), la pagina passa da sola al servizio WMS, che dà
solo l'ultima immagine, lo scrive nel riquadro e riprova l'archivio ogni dieci
minuti. Lo stesso succede se durante l'animazione arriva una tessera non
valida. Un file dei fulmini che non si legge si scarta e il riquadro dice
"Fulmini non disponibili"; uno che manca (403) è normale, perché escono con
una decina di minuti di ritardo e restano poco. Senza risposta dall'API il
riquadro dice "Radar non raggiungibile". Ogni richiesta ha un limite di
dieci secondi. `tests/radar-regole.mjs` prova le regole senza rete,
`tests/radar-sala.mjs` prova la mappa con il servizio simulato, guasti
compresi. Il WMS di riserva vela di nero trasparente tutta l'area coperta dai
radar e non ha CORS: un filtro SVG applicato dal CSS toglie il velo.

La mappa dell'app è una pagina Leaflet negli asset dell'app
(`app/src/main/assets/mappa`), aperta in una WebView da un'origine https
finta, appassets.androidplatform.net, che l'app serve da sé
(`CaricatoreMappa`): così valgono CSP, CORS e moduli JavaScript come nel
browser della sala. La pagina non ha accesso al token né a interfacce
dell'app: riceve i dati con `ORION.avvia`, `ORION.elementi` e
`ORION.posizione` (centro dell'associazione, elementi della mappa senza
segnalazioni, la posizione del telefono) e chiede da sola tessere, satellite,
radar e fulmini agli stessi servizi della sala. La cartografia del territorio
la chiede invece l'app al server, col token, quando la pagina chiede
`/territorio/z/x/y`. Il radar è una copia di `public/js/radar-meteo.js`: si
cambia nel server e si ricopia nell'app. Gli elementi sono gli stessi che
l'app tiene cifrati per gli avvisi in viaggio, quindi senza rete la mappa
mostra quelli dell'ultima volta.

L'app chiede a router.project-osrm.org il percorso dal telefono
all'intervento quando si preme Naviga, ma solo se fra gli elementi della
mappa c'è almeno una strada chiusa o una zona interdetta. Il controllo
(`ControlloPercorso` nell'app) cerca le zone attraversate dal percorso e le
strade chiuse percorse per almeno 40 metri nello stesso verso, a meno di 25
metri dalla linea disegnata; un percorso che incrocia una strada chiusa non
conta. La zona che contiene la partenza non conta, quella che contiene
l'arrivo si dice a parte.

La sorveglianza in viaggio (`SorveglianzaZone`) gira nel servizio della
posizione: legge ogni posizione con precisione migliore di 50 metri, avvisa
una volta avvicinandosi (100 metri da una zona interdetta, 80 da una strada
chiusa, solo se la distanza cala) e una volta entrando in una zona interdetta,
e si riarma allontanandosi di 250 metri; per uscire da una zona bisogna
allontanarsi di 30 metri dal bordo. Le zone vengono da `/api/mappa/elementi`
all'avvio del servizio, a ogni `reload_mappa` e ogni cinque minuti, e restano
cifrate in `zone-in-viaggio.json` fino all'uscita. Il server fa lo stesso
controllo d'ingresso sulle posizioni che riceve (`src/zoneSquadre.js`), con la
stessa tolleranza di 30 metri: scrive nel diario di sala e manda
`squadra_in_zona` alle postazioni. Le posizioni più vecchie di cinque minuti
non contano. Lo stato "dentro" sta in memoria: dopo un riavvio del server una
squadra già dentro una zona viene annunciata una volta.

Il bollettino di allerta, se acceso nelle Impostazioni, è l'unica cosa che
il server stesso scarica da internet: ogni quarto d'ora chiede
`raw.githubusercontent.com` (vedi "Il bollettino di allerta" più avanti).
`ORION_ALLERTA_URL` sostituisce l'indirizzo, per le prove.

Gli indirizzi da cui controllare le versioni nuove (il servizio delle
release, il manifesto) li sceglie l'amministratore, ma il server non deve
diventare il modo per raggiungere la rete interna. Per questo
`src/indirizziEsterni.js` accetta solo `https` verso indirizzi pubblici: un
indirizzo privato, di loopback, link-local, CGNAT, multicast o riservato alla
documentazione viene rifiutato, e lo stesso controllo si ripete a ogni
reindirizzamento. Gli indirizzi IPv6 si leggono come numeri, non come testo,
perché le forme che portano dentro un IPv4 (`::ffff:7f00:1`, che il browser e
Node scrivono al posto di `::ffff:127.0.0.1`, le forme compatibili, NAT64 e
6to4) valgono quanto l'IPv4 che contengono. La richiesta non passa da `fetch`
ma da `https.request` con una ricerca del nome propria: il controllo avviene
sugli stessi indirizzi su cui poi ci si collega, così chi governa il DNS non
può rispondere con un indirizzo pubblico al controllo e con uno interno alla
connessione. Il salvataggio della configurazione rifiuta subito un indirizzo
che non passa. Chi tiene il manifesto su un server
dell'ente, raggiungibile solo dalla rete interna, mette
`ORION_AGGIORNAMENTI_RETE_LOCALE=true` in `orion.env`: allora sono ammessi
anche `http` e gli indirizzi interni.

Tutto il resto si configura dall'applicazione, nelle Impostazioni, e sta nel
database: la posta in uscita (SMTP), il logo e il nome dell'associazione, i
moduli Segreteria e Magazzino, il tesserino, la disponibilità dell'app
Android, il controllo degli aggiornamenti. La posta è facoltativa: senza,
ORION funziona lo stesso e mostra all'amministratore i link di attivazione
invece di spedirli.
Il manuale del web spiega come usare un account Gmail gratuito; dalle
Impostazioni "Manda una prova" (`POST /api/admin/email-prova`) prova i dati
scritti nel modulo, anche non ancora salvati, e restituisce il motivo
dell'errore insieme alla risposta grezza del server di posta.


## 4. Dove stanno i dati

Il database contiene tutto quello che è testo e numeri: utenti, ruoli,
emergenze, segnalazioni con il loro diario, squadre, fascicoli, magazzino,
verbali, notifiche, registro delle operazioni.

I file caricati stanno nella cartella `dati/` dell'istanza, in due cartelle.
`uploads/photos` tiene le foto profilo. Sul web la foto passa prima da
`public/js/ritaglio-foto.js` (`window.ritagliaFoto(file)`, usato dal profilo e
dalla segreteria), che la inquadra in una cornice 5 x 6 e carica un JPEG di
500 x 600; l'app fa lo stesso con `RitaglioFoto.kt`. `protected_uploads` tiene
tutto il resto, che si legge solo attraverso il server con i permessi giusti:
certificati e attestati, immagini e documenti delle segnalazioni, file del
magazzino (verbali firmati, fatture), l'archivio dei documenti del gruppo
(`documenti-gruppo`), resoconti delle emergenze chiuse, file temporanei delle
importazioni, la cartografia del territorio (`cartografia/territorio.mbtiles`
con accanto `territorio.json`, quello che il server ne ha letto; la cartella
si sposta con `ORION_CARTOGRAFIA_DIR`). Nginx non serve mai direttamente
queste cartelle. Accanto stanno `loghi/` (i loghi caricati; quelli di serie
vengono dall'immagine) e `app-android/`, dove a ogni avvio arriva l'APK
dell'immagine se è più recente e firmato con la stessa chiave.

I registri del programma stanno in `dati/logs/` e si leggono anche con
`sudo docker compose -f /srv/orion/<nome>/compose.yaml logs app`; vanno
guardati per primi quando qualcosa non torna: gli invii di posta riusciti e
falliti, per esempio, sono scritti lì. Il registro dell'agente è
`/var/log/orion-agente.log`.

Fuori dai container, per lo sviluppo, `ORION_DATI_DIR` non c'è e i dati
stanno nella cartella del codice, come i backup (`backup/`).


## 5. Il database e le migrazioni

Lo schema cresce con le migrazioni di node-pg-migrate, nella cartella
`migrations`, una per ogni cambiamento. La 1.0 parte da una sola migrazione,
`1790985600000_orion-1-0.cjs`, che applica `db/orion-1.0.sql`: lo schema
completo e i dati di partenza (i DPI proposti, le categorie, il corso base).
Riunisce le 37 migrazioni della numerazione interna 3.x, ed è identica al
risultato di applicarle una dopo l'altra a un database vuoto. Una migrazione
nuova si crea con `npm run migrate:create -- nome`: node-pg-migrate le dà un
nome col timestamp, che la mette in coda alle altre.

Le migrazioni si applicano a ogni avvio del server (`src/migrazioni.js`) e,
prima di cambiare versione, dall'agente con l'immagine nuova
(`scripts/migrazioni.mjs su`). Di solito all'avvio non ce n'è nessuna da
fare; servono dopo il ripristino di un backup di una versione precedente, che
riporta il database allo schema di allora. Se non riescono, il server parte lo
stesso e lo scrive nel registro, così l'amministratore può entrare e
ripristinare un altro backup; il controllo di salute (`/api/salute`) però
risponde 503, e l'agente lo vede. A mano si lanciano con `sudo docker compose
-f /srv/orion/<nome>/compose.yaml run --rm --no-deps app node
scripts/migrazioni.mjs su`.

Un database nato prima della 1.0 (un'installazione di prova, un backup
vecchio) ha ancora in `pgmigrations` le 37 righe di allora. Prima di ogni
applicazione `src/allineaMigrazioni.js` le riconosce e, se c'è l'ultima
(`v3-update-36`), le sostituisce con quella della 1.0: lo schema è già quello.
Un database fermo a una versione più vecchia della 3.36 non si allinea da
solo, e il messaggio dice di reinstallarlo.

Le assegnazioni delle squadre (`report_team_assignments`) tengono anche il
nome radio e il nome della squadra di allora, scritti da un trigger
all'inserimento. Eliminata una squadra (anche d'ufficio, alla chiusura
dell'emergenza), `squadra_id` diventa NULL e l'assegnazione resta: resoconti,
archivio e punto di situazione dicono ancora chi è intervenuto. La migrazione
della 1.0.3 ha ricostruito dalle note di sistema delle segnalazioni ("Squadra
'Alfa' assegnata.") le assegnazioni già perse.

Le funzioni di supporto (modulo acceso da `funzioni_enabled`) stanno in tre
tabelle: `funzioni` (sigla, nome, accesa o spenta, ordine; la 1.1.0 le crea con
le dieci del piano comunale), `funzione_membri` (chi ne fa parte e se è
referente) e `incarichi` (segnalazione, funzione, motivazione, stato aperto, in
corso o concluso, esito, con chi e quando). Un indice parziale impedisce due
incarichi non conclusi della stessa funzione sulla stessa segnalazione.
`report_updates.funzione_id` segna le note scritte per conto di una funzione.
A modulo spento le rotte rispondono 404 con `modulo_spento: true`. Assegnare e
annullare spetta a chi non è esterno; prendere in carico e concludere ai
membri della funzione e a chi non è esterno; i membri li gestisce
l'amministratore e, a emergenza aperta, chiunque non sia esterno ma solo per
gli utenti temporanei. Un esterno membro di una funzione agisce (note, foto,
punto) sulle segnalazioni dove la sua funzione ha un incarico, oltre a quelle
della sua squadra. L'assegnazione manda una notifica `incarico_funzione` ai
membri.

Strade chiuse, zone e aree stanno in `elementi_mappa`: la forma è un GeoJSON in
WGS84 (gradi) in una colonna jsonb, senza PostGIS. Con `emergency_id` NULL
l'elemento è del piano e resta; con l'emergenza, si toglie con `rimosso_il` e
`rimosso_da`, così resta nel registro. Il server controlla tipo e forma
(una strada è una linea, una zona un'area), rifiuta coordinate fuori dai gradi
con un messaggio che rimanda a EPSG:4326, arrotonda a sei decimali e accetta
fino a 50.000 punti per forma. Le rotte `/api/mappa/*` accettano richieste
fino a 8 MB (le altre restano al limite di serie di Express), per i livelli
importati. Disegno e lettura dei KML usano Leaflet-Geoman e @tmcw/togeojson,
copiate in `public/vendor` da `copy-libs.js` come le altre librerie.

Una regola da non dimenticare: `users.role` non si scrive mai a mano. È un
ruolo principale ricavato dal codice; i permessi veri stanno nella tabella
`utenti_ruoli`, e si rileggono dal database a ogni richiesta.


## 6. Cosa fa il server da solo

All'avvio, e poi ogni ora, il server controlla se ha già fatto il giro del
giorno. Se non l'ha fatto, lo fa: avvisi di scadenza ai volontari, report
mensile il primo del mese, avvisi del magazzino a chi li ha chiesti, e i
riepiloghi di segreteria e magazzino nella coda dell'app. Poiché il controllo
si ripete ogni ora, un server rimasto spento recupera il giro alla prima
accensione utile.

Una volta al giorno pulisce i token revocati, le chiavi d'idempotenza del
magazzino più vecchie di una settimana e la coda delle notifiche. Ogni sei
ore controlla se il backup notturno è stato saltato e, se sì, ne fa uno suo.

Alla chiusura di un'emergenza fa un backup del database, scrive il
resoconto, chiude gli accessi esterni temporanei, fa scadere le notifiche
dell'emergenza e chiude d'ufficio le squadre rimaste senza membri e senza
materiale in carico.

Ogni 15 secondi, con una simulazione aperta e lo scenario avviato, fa
uscire gli eventi a tempo del copione (`controllaUscite()` in
`src/copione.js`).

Ogni quindici minuti, se nelle Impostazioni è scelta una Regione, guarda se
c'è un bollettino di allerta nuovo (`src/allerta.js`).

Ogni minuto sigilla le righe nuove dei registri (note delle segnalazioni,
diario di sala, registro delle operazioni, movimenti, registro delle squadre,
stati delle squadre sugli interventi) in `registro_integrita`. Sempre ogni
minuto, con un'emergenza aperta, cerca le segnalazioni senza squadra da più dei
minuti critici delle Impostazioni e ne avvisa chi apre le emergenze
(`controllaSegnalazioniInRitardo()` in `src/avvisiSala.js`). Alla chiusura di un'emergenza prende il sigillo,
lo salva in `emergencies.sigillo_chiusura` (lo riportano resoconto e punto di
situazione), lo restituisce a chi chiude e lo manda per email agli
amministratori, se la posta è configurata.


## 7. Backup, ripristino, aggiornamenti

Il backup notturno lo fa l'agente alle 3:30 per tutte le istanze
(`orion-backup.timer`). Il dump lo scrive un container nuovo dell'immagine in
servizio, non il processo che risponde in rete; è cifrato con la chiave
dell'istanza e va in `backup/notte`, insieme alla copia di `uploads` e
`protected_uploads` in `backup/file`. I file sono di root con il gruppo
dell'istanza e permessi 640: il programma li vede, li verifica e li
ripristina, ma non li può cancellare. I dump più vecchi di
`ORION_BACKUP_RETENTION_DAYS` giorni escono. Oltre a questi, l'applicazione
fa i suoi backup in `backup/auto`: alla chiusura di un'emergenza, a richiesta
dalla pagina Sistema, prima di un ripristino, e quando si accorge che
l'ultimo ha più di venti ore.

Il nome di ogni backup dice di chi è, quando e perché, così un file scaricato
o copiato fuori dalla sua cartella si riconosce da solo:
`orion_<istanza>_db_<data>_<ora>_<motivo>.sql.gz`, con l'ora italiana
(`TZ` dell'istanza) e un motivo fra `notte`, `manuale`, `emergenza-<codice>`,
`pre-aggiornamento`, `pre-ritorno`, `pre-ripristino`, `recupero` e `caricato`
(`src/nomiBackup.js`; l'istanza la dà `ORION_ISTANZA`, o il primo pezzo del
dominio). I backup con il nome di prima (`db_<data>_<ora>...`, ora UTC) restano
validi, e scaricati dalla pagina prendono davanti il nome dell'istanza.

### Il disco esterno

I backup sulla stessa macchina proteggono da un errore, non dalla rottura del
server. Per la copia fuori l'agente sa usare un disco USB: lo si prepara una
volta con

```
sudo orion-agente disco prepara /dev/sdX
```

che rifiuta un disco in uso (quello del sistema, per esempio), chiede di
scrivere CANCELLA, lo formatta con l'etichetta `ORION-COPIE` e lo aggiunge a
`/etc/fstab` senza montarlo all'avvio. Dopo ogni backup notturno, se il disco
è collegato, l'agente lo monta in `/mnt/orion-copie`, ci copia i dump nuovi
di ogni istanza (`<istanza>/db/`) e un archivio dei suoi file
(`<istanza>/file/orion_<istanza>_file_<data>_<ora>.tar.gz`), e lo smonta: il resto del tempo il disco
non lo vede nessuno, nemmeno un programma impazzito sul server. Sul disco va
solo roba cifrata con la chiave dell'istanza: i dump lo sono già, l'archivio
dei file si cifra durante la copia, e senza chiave non si scrive. Sul disco
restano i dump di 90 giorni e gli ultimi tre archivi dei file.

Due dischi preparati allo stesso modo si alternano: uno resta collegato,
l'altro sta a casa di un responsabile, e una volta al mese si scambiano. La
copia va su quello collegato; `sudo orion-agente disco copia` la fa subito,
`sudo orion-agente disco stato` dice spazio libero e ultime copie. La pagina
Sistema mostra a ogni istanza la data dell'ultima copia, gialla dopo una
settimana e rossa dopo due. Un dump del disco si ripristina dalla pagina
Sistema con "Carica un backup da un file"; fuori da ORION, dump e archivi si
decifrano con `scripts/decifra-backup.mjs` e la chiave di recupero stampata,
che per questo va tenuta lontana dai dischi.

### Gli avvisi quando i backup non vanno

Ogni ora `controlloBackup` in `src/manutenzione.js` guarda cinque cose e, per
ognuna che non va, avvisa gli amministratori attivi con una notifica
nell'app (tipo `backup_problema`, categoria personale) e una email:

| Controllo | Quando avvisa |
|---|---|
| Ultimo backup del database, il più recente fra `backup/auto` e `backup/notte` | Più vecchio di 48 ore, o nessuno |
| Disco esterno, dove l'agente l'ha preparato (`agente/stato/disco.json`) | Non collegato all'ultimo giro, copia non riuscita, o ultima copia più vecchia di 7 giorni |
| Spazio libero nella cartella dei dati (`fs.statfs`) | Meno del 10% o meno di 2 GB (`ORION_SPAZIO_MINIMO_MB`) |
| Chiave di recupero (`cifratura_recupero_salvata`) | Non conservata 7 giorni dopo la creazione della chiave dei dati |
| Copia su Google Drive, se collegato | Ultima copia non riuscita, accesso scaduto o revocato, spazio di Drive finito |

Per ogni problema parte un avviso al giorno finché resta. Lo stato sta
nell'impostazione interna `avvisi_sistema` (`{ tipo: { dal, avvisato_il } }`),
che non si scrive e non si legge dalle impostazioni generali; quando un
problema sparisce si cancella, così se torna si riavvisa. La pagina Sistema
mostra gli stessi problemi in cima (`GET /api/sistema/avvisi`, solo
amministratori). L'intervallo del controllo si cambia con
`ORION_CONTROLLO_BACKUP_MS`, che serve solo alle prove.

### La copia su Google Drive

Facoltativa, in `src/drive.js`. Le credenziali che ORION ha già non servono:
la password per le app della posta non vale per Drive, e l'account di
servizio di Firebase non ha spazio nel Drive di un account gratuito. Serve un
client OAuth di tipo "Applicazione web" nel progetto Google Cloud
dell'associazione, con l'API di Drive attiva e l'indirizzo di ritorno
`https://<dominio>/api/sistema/drive/ritorno`. ORION chiede solo
`https://www.googleapis.com/auth/drive.file`, che lascia vedere e cambiare i
soli file creati da ORION; Google lo considera un permesso non sensibile. La
schermata di consenso va pubblicata: in prova Google fa scadere il token di
rinnovo dopo sette giorni.

"Collega" (`POST /api/sistema/drive/collega`) prepara il consenso con
`access_type=offline`, `prompt=consent`, PKCE (S256) e uno `state` casuale,
valido dieci minuti e a uso singolo, legato all'amministratore che l'ha
chiesto. Google torna su `GET /api/sistema/drive/ritorno`, che è pubblica: il
cookie della sessione è `SameSite=Strict` e su un ritorno da un'altra origine
il browser non lo manda, quindi chi ha chiesto il collegamento si riconosce
dallo `state`, e un ritorno senza uno `state` valido non collega niente.
Segreto del client e token di rinnovo stanno in `branding_settings`
(`drive_config`, con lo stato delle copie in `drive_stato`) cifrati con
`cifraTesto`; le due chiavi sono interne, non tornano mai al browser e non si
scrivono dalle impostazioni generali. "Scollega" revoca il token presso Google
e lo dimentica; cambiando l'ID del client il token vecchio si dimentica da
solo.

Le copie partono quando nascono i backup. Alla chiusura di un'emergenza,
appena `eseguiBackupDatabase` ha scritto il backup con il resoconto, quel file
va su Drive come copia d'emergenza, che non si cancella mai; quello di una
simulazione vale come copia del giorno. Il controllo orario (`controlloDrive`,
intervallo `ORION_DRIVE_CONTROLLO_MS`) ritenta le copie d'emergenza rimaste
indietro, copia il backup più recente di `backup/notte` o `backup/auto` se
dall'ultima copia del giorno sono passate venti ore e il backup è più nuovo, e
una volta alla settimana carica un archivio di `uploads`, `protected_uploads`
(senza le riprese del drone) e `loghi`, fatto con `tar` e cifrato mentre si
carica, senza file temporanei. Su Drive va solo materiale cifrato: un backup
in chiaro non si copia, e senza la chiave dei dati la copia aspetta. Le copie
passano da una coda sola, e non partono durante una manutenzione.

Il caricamento è quello a riprese di Drive (`uploadType=resumable`), a pezzi
di 8 MB: se la connessione cade o Google risponde 5xx, si chiede a Google fin
dove è arrivato e si riparte da lì, fino a cinque volte con attese crescenti.
L'archivio dei file, di cui la grandezza non si sa prima, si manda con il
totale sconosciuto fino all'ultimo pezzo. I file stanno nella cartella
"ORION <nome dell'associazione>", che si ricrea se qualcuno la cancella, e
portano in `appProperties` il tipo (`giornaliero`, `settimanale`, `emergenza`)
e l'istanza. Dopo ogni copia si tengono le ultime 14 giornaliere e gli ultimi
8 archivi settimanali (modificabili dalla pagina), contando e cancellando solo
i file con quelle proprietà: i file messi a mano nella cartella e le copie
d'emergenza restano.

| Rotta | Chi | Cosa fa |
|---|---|---|
| `GET /api/sistema/drive` | amministratore | Stato: client, account, ultime copie, ultimo errore, spazio, indirizzo di ritorno |
| `PUT /api/sistema/drive/client` | amministratore | `client_id`, `client_secret`, `giornalieri`, `settimanali` |
| `POST /api/sistema/drive/collega` | amministratore | L'indirizzo del consenso di Google |
| `GET /api/sistema/drive/ritorno` | chiunque, con lo `state` giusto | Scambia il codice con il token di rinnovo e torna alla pagina Sistema |
| `POST /api/sistema/drive/copia` | amministratore | Copia subito l'ultimo backup |
| `DELETE /api/sistema/drive` | amministratore | Revoca e dimentica il collegamento |

Gli indirizzi di Google si cambiano solo per le prove: `ORION_DRIVE_AUTH_URL`,
`ORION_DRIVE_TOKEN_URL`, `ORION_DRIVE_REVOKE_URL` e `ORION_DRIVE_URL`, che
`tests/drive.mjs` punta a un Google finto (`tests/drive-finto.mjs`) con
consenso, PKCE, rinnovo, revoca, caricamento a riprese con la connessione che
cade a metà e spazio finito. Il ripristino da Drive passa dal browser: si
scarica il file dalla cartella su Drive e lo si carica nella pagina Sistema;
su un server nuovo serve prima la chiave di recupero.

### Il ripristino

Il ripristino si fa dalla pagina Sistema ed è una transazione sola: se
qualcosa va storto a metà, il database resta com'era. Prima di cominciare
ORION salva i dati attuali; durante il lavoro risponde "in manutenzione" a
tutti; alla fine applica le migrazioni mancanti ed esce, e Docker lo fa
ripartire. Il dump passa a psql senza `.psqlrc` e attraverso un filtro: un
backup di pg_dump ha solo tre comandi con la barra rovesciata (`\restrict`,
`\unrestrict` e il `\.` che chiude i dati di un COPY), e un archivio con
qualunque altro, come `\!` che esegue un programma, viene rifiutato prima di
cominciare. Se psql si ferma, il messaggio riporta la sua riga d'errore.

### Gli aggiornamenti

Il controllo delle versioni nuove si fa a mano con "Controlla adesso";
acceso, quello giornaliero avvisa gli amministratori con una notifica e
un'email. ORION non si aggiorna mai da solo, e con un'emergenza aperta non si
aggiorna proprio.

L'aggiornamento non sostituisce file: cambia immagine, e lo fa l'agente. La
pagina Sistema scrive soltanto una richiesta (identificativo, tipo, versione)
in `agente/richieste/richiesta`. Al giro successivo l'agente la legge dentro il
container, con `docker compose exec`: un collegamento simbolico messo lì dal
programma punterebbe a un file del container, mai dell'host. Controlla ogni
campo e guarda la regola dell'istanza (`ORION_AGGIORNAMENTI`: `automatici`,
`chiedi` o `bloccati`). Scarica l'immagine nuova e controlla la versione
scritta nel suo `package.json`; fa un backup `pre-aggiornamento` in
`backup/notte`; applica le migrazioni con l'immagine nuova in un container a
parte; scrive nel `.env` l'impronta dell'immagine nuova (`ORION_IMMAGINE_RIF`,
il digest: gira esattamente quello che è stato pubblicato) e ricrea il
container del programma. Se entro quattro minuti il controllo di salute non
passa, annulla le migrazioni con i file della versione nuova e rimette
l'immagine di prima. Ogni passo finisce in `agente/stato/operazione.json`, che
la pagina Sistema mostra anche dopo il riavvio.

Con `chiedi` la richiesta resta in attesa finché il gestore non scrive
`sudo orion-agente approva <nome>` (o `rifiuta`); con `bloccati` è rifiutata
subito, e la pagina Sistema lo dice prima ancora di provare.
`sudo orion-agente stato` elenca le istanze con versione, porta, regola e
salute; `sudo orion-agente aggiorna <nome> <versione>` aggiorna senza
passare dalla pagina.

Si torna a una versione precedente dalla stessa pagina, riquadro "Tornare a
una versione precedente". Le versioni proposte sono quelle passate davvero di
qui, con il loro digest e l'elenco delle loro migrazioni, in
`agente/stato/versioni.json`: il programma non può chiedere un'immagine
qualunque. Di base i dati restano quelli di adesso: le migrazioni che la
versione scelta non conosce si annullano con il loro `down`, dalla più
recente, in una transazione sola, con l'immagine in servizio
(`scripts/migrazioni.mjs verso`). Le righe restano; si perdono solo le
tabelle e le colonne aggiunte dopo, con il loro contenuto. Se una di quelle
migrazioni non si può annullare (non sono le ultime applicate) si torna solo
riportando anche i dati. Con "Riporta anche i dati a com'erano" si ripristina
il backup fatto quando quella versione era stata lasciata
(`scripts/ripristina-db.mjs`, con gli stessi controlli della pagina Sistema).
In tutti e due i casi prima si fa un backup `pre-ritorno`. Per tornare avanti
si aggiorna di nuovo.

### Pubblicare una versione

La versione installata è il campo `version` di `package.json`, letto
all'avvio, e la pagina Sistema la confronta con il tag dell'ultima release di
`orion-release` (`releases/latest` di GitHub, che salta bozze e
pre-release). Una release si prepara così.

Se è cambiata anche l'app, prima si alza `versionCode` e `versionName` in
`app/build.gradle.kts` del repository dell'app, si compila con `./gradlew
:app:assembleRelease` (serve `keystore.properties` con la chiave dello
sviluppatore) e si porta l'APK nel server con `scripts/pubblica.sh
app/build/outputs/apk/release/app-release.apk ../Orion/app-android`; il terzo
argomento, facoltativo, alza la versione minima accettata e va usato solo
quando il server nuovo non funziona più con le app vecchie. I due file di
`app-android` si mettono nel commit del server.

Poi si provano server e app (capitolo 11) e si porta il numero di versione al
nuovo valore con `npm version 1.2.3 --no-git-tag-version`, che cambia anche
`package-lock.json`. Il codice di quel commit si copia in `orion-release`, si
fa il commit, si crea il tag `v1.2.3` e da quel tag una release su GitHub con
le note: sono le note che gli amministratori leggono nella pagina Sistema
prima di aggiornare. Una release in bozza o segnata come pre-release non viene
proposta a nessuno. La release fa partire il workflow
`.github/workflows/immagine.yml`, che da `orion-release` pubblica `ghcr.io/<proprietario>/orion:<versione>`
(dal repository di sviluppo lo stesso workflow pubblica `orion-dev`)
con nel `package.json` il numero della release; il pacchetto va reso pubblico
una volta nelle impostazioni di GitHub, altrimenti le macchine non lo
scaricano. Prima di annunciare la versione va controllato che il workflow sia
finito bene, perché senza immagine l'agente risponde che la versione non c'è;
alla fine, da un'istanza di prova, l'aggiornamento dalla pagina Sistema deve
andare a buon fine.

Chi non usa GitHub pubblica un manifesto JSON su un indirizzo proprio e lo
indica nella pagina Sistema; serve `versione`, `note` e `pubblicata_il` sono
facoltativi. Il manifesto dice soltanto che c'è una versione nuova: quale
immagine scaricare lo decide l'agente, con `ORION_IMMAGINE` nel `.env`
dell'istanza.

```json
{ "versione": "1.2.3", "note": "Novità..." }
```

### Node.js e PostgreSQL

Le versioni di Node.js e del client di PostgreSQL le decide l'immagine
(`Dockerfile`: Node 24 e il client di PostgreSQL 17 di Debian), quella del
database il compose (`postgres:17-trixie`, o `ORION_POSTGRES_IMMAGINE`). Si
aggiornano con una release. `pg_dump` rifiuta un server più nuovo di sé,
quindi un cambio di versione principale di PostgreSQL arriva con una release
che porta tutti e due; per un'istanza esistente si passa da un backup: backup
dalla pagina Sistema, istanza nuova accanto con la versione nuova del
database, ripristino del backup. Gli aggiornamenti minori di PostgreSQL
(17.x) arrivano scaricando di nuovo l'immagine: `sudo docker compose -f
/srv/orion/<nome>/compose.yaml pull db && sudo docker compose -f
/srv/orion/<nome>/compose.yaml up -d db`, a emergenza chiusa.

### La cifratura

`src/cifratura.js` (con il formato in `src/formatoCifrato.js`) cifra con
AES-256-GCM i file in `protected_uploads` (certificati, documenti, immagini,
magazzino, documenti del gruppo, resoconti) e `uploads/photos`, i backup del database, la password
SMTP e, nel database, l'esito delle visite mediche (`user_medical_records.status`,
`enc1:` come i segreti). Tipo e date delle visite restano in chiaro perché
servono alle scadenze; il confronto con "Idoneo" (squadre, tesserino,
cruscotto, avvisi) si fa nell'applicazione, in `src/esitiVisite.js`, e senza
la chiave un esito che non si legge vale come non idoneo. Gli esiti scritti
prima, o senza chiave, si cifrano all'avvio; tornando a una versione
precedente la migrazione li rimette in chiaro, e per questo chiede la chiave. Formato dei file: `ORIONCF1`, IV di 12 byte, dati, tag di 16 byte; il
tag rende evidente anche un file alterato. I file in chiaro di prima restano
leggibili e un giro orario li cifra; i caricamenti nuovi si cifrano subito
dopo il controllo del contenuto, e le rotte li mandano decifrati
(`inviaFile`).

La chiave sta in `chiave/chiave-dati.key` nella cartella dell'istanza
(`ORION_CHIAVE_FILE`), 600, creata al primo avvio. Non è nel database e non
finisce nei backup né sul disco esterno. Nel database c'è solo
la sua impronta (`cifratura_impronta`), che dice se la chiave sul disco è
quella dei dati: se manca o non corrisponde, ORION parte lo stesso, le rotte
dei file rispondono 503 e la pagina Sistema chiede la chiave di recupero (la
stessa chiave in base32, 52 caratteri). I backup notturni li cifra
`scripts/backup-db.mjs`, l'archivio dei file per il disco esterno
`scripts/cifra-flusso.mjs`; tutti si decifrano fuori da ORION con
`scripts/decifra-backup.mjs`, dando il file della chiave oppure
`ORION_CHIAVE_RECUPERO`. Per spostare un'istanza si porta anche la chiave
(`ORION_CHIAVE_DA` di `nuova-istanza.sh`). `node tests/cifratura.mjs` prova cifratura,
backup alterati, chiave di recupero e password della posta.

### Lo storico inalterabile

La migrazione `storico-inalterabile` mette sulle tabelle `report_updates`,
`diario_sala`, `audit_log`, `movimenti` ed `emergency_team_log` (e la
migrazione `stati-squadra` su `stati_squadra`) un trigger
che rifiuta UPDATE, DELETE e TRUNCATE. Passano solo gli UPDATE che non
toccano il contenuto registrato (le colonne messe a NULL dal database quando
si elimina una persona o una squadra) e i DELETE della cancellazione di
un'emergenza archiviata, che l'applicazione dichiara nella sua transazione
con `set_config('orion.cancellazione_emergenza', ...)`.

`orion_sigilla()` aggiunge a `registro_integrita` un anello per ogni riga non
ancora sigillata: l'impronta SHA-256 del contenuto (una scelta fissa di
colonne, date in UTC, calcolata da `orion_contenuto`) e l'impronta
dell'anello, che contiene la precedente. La cancellazione di un'emergenza
aggiunge un anello `cancellazione_emergenza` con gli id delle righe uscite.
`orion_verifica()` ripercorre la catena e confronta ogni riga con la sua
impronta; risponde in un paio di secondi anche con decine di migliaia di
voci. Il registro stesso non si modifica (altro trigger).

Il registro delle operazioni (`audit_log`) può anche scadere: con
`ORION_REGISTRO_GIORNI` maggiore di zero, la pulizia notturna sigilla, dichiara
la scadenza (`orion.scadenza_registro`, accettata dal trigger solo su questa
tabella), toglie le voci più vecchie (al massimo ventimila per notte) e
aggiunge un anello `scadenza_registro` con i loro id. La verifica le conta come
uscite, non come mancanti. Le altre tabelle dello storico non scadono: sono
la documentazione delle emergenze.

Il proprietario delle tabelle può spegnere i trigger e ricalcolare la catena:
contro di lui servono i sigilli tenuti fuori dal server, che
`/api/sistema/integrita/confronta` paragona all'anello corrispondente. Un
ripristino da backup riporta catena e sigilli di quel momento: i sigilli
emessi dopo non corrispondono più, ed è giusto così. `npm run test:integrita`
prova blocco, scoperta e riscrittura su un'istanza di prova (modifica il
database: chiede `ORION_TEST_DISTRUTTIVO=1`).


## 8. Accesso, sessioni, permessi

Ogni richiesta passa da un controllo unico dell'identità, che legge il token
di sessione, verifica che non sia stato revocato, che l'account sia attivo e
rilegge i ruoli. Per questo sospendere un utente o togliergli un ruolo ha
effetto alla richiesta successiva, non alla scadenza del token.

Una pagina riservata aperta senza sessione rimanda a
`/login.html?redirect=<pagina chiesta>`. Entrati, `public/js/login.js` torna
lì solo se l'indirizzo è un percorso dello stesso server (comincia con una
sola `/`, ha la stessa origine e non è la pagina d'accesso); altrimenti va
alla prima pagina di sempre. Così il QR di un'etichetta
(`/magazzino.html?e=<codice>`) apre il bene anche a chi non era entrato.

Sopra quel controllo, le rotte chiedono un permesso, non un ruolo
(`src/permessi.js`): `richiedePermesso(...)` davanti alla rotta,
`haPermesso(req, ...)` dentro, basta uno dei permessi indicati. I permessi
sono dieci (`emergenze.apertura`, `emergenze.archivio`, `emergenze.piano`,
`emergenze.funzioni`, `volontari.anagrafica`, `volontari.sanitario`,
`magazzino.gestione`, `magazzino.consegne`, `gruppo.documenti`,
`gruppo.attivita`); `PERMESSI_DEI_RUOLI` dice quali porta ogni ruolo (il
Coordinatore i quattro delle emergenze e `gruppo.attivita`, la Segreteria i due dei volontari, il Magazziniere i due del
magazzino, l'Amministratore tutti; `gruppo.documenti` solo l'Amministratore,
agli altri si concede in più). In più ci sono i permessi dati a una persona, nella tabella
`utenti_permessi` (persona, permesso, chi l'ha concesso e quando), che
`authenticateToken` legge nella stessa interrogazione dei ruoli e mette in
`req.user.permessi`: una concessione vale dalla richiesta successiva. Agli
esterni `permessiDi()` non dà niente. Restano controlli di ruolo
`checkAdminRole` (l'amministrazione del sistema: account, ruoli e permessi,
impostazioni, registro, sistema, eliminazione delle emergenze) e
`nonEsterni` (la base comune degli interni). Le interrogazioni che scelgono i
destinatari (riepiloghi del mattino, avvisi del magazzino per email) usano
`sqlHaPermesso()`.

`GET /api/permessi/catalogo` dà nomi, categorie e pacchetti; `GET` e
`PUT /api/admin/users/:id/permessi` (`{ in_piu: [...] }`, solo
amministratore) leggono e sostituiscono i permessi in più, con l'audit
`utente.permessi`. L'accesso, `/api/me/status` e il contesto dell'app portano
`permessi`; il web li tiene in `localStorage.userPermessi` e li usa con
`haPermesso()` di `apiHelper.js` per menu e pulsanti (il menu laterale li
rilegge a ogni pagina). La verifica in due passaggi è obbligatoria con
`mfaRichiesta()`: per l'amministratore e per chi ha `volontari.sanitario`.
Al login si entra con lo username o con l'email: la stessa email in due
account (con maiuscole diverse) non apre nessuno dei due, e i tentativi
sbagliati si contano sull'account trovato, così scrivendolo nei due modi non
raddoppiano.
`POST /api/users` vale per chi ha `volontari.anagrafica`, ma solo con il
ruolo volontario se non è amministratore; il libretto, per chi ha
l'anagrafica senza i dati sanitari, arriva senza visite e corsi
(`dati_sanitari: false`). `npm run test:permessi` prova concessioni,
revoche, Coordinatore, anagrafica e verifica obbligatoria.
L'esterno non si somma a nessun altro ruolo: è una limitazione.

Gli esterni temporanei sono utenti con il ruolo esterno e un segno in più:
sono legati all'emergenza in cui sono nati. Entrano con un codice (il QR), non con
una password, e rigenerare il codice invalida quello vecchio. Le rotte di
Gestione utenti (modifica, sospensione, azzeramento della password)
rispondono 409 su un temporaneo: si gestisce solo dal centro operativo.

`users.creato_il` la scrive il database; `users.ultimo_accesso` la scrive
`segnaAccesso()` in `autenticazione.js`, subito a ogni accesso (password,
codice, token di rinnovo dell'app) e, mentre la persona lavora, al massimo
una volta ogni cinque minuti, senza far aspettare la richiesta. Del codice il
server tiene l'impronta SHA-256, che basta per l'accesso, e una copia cifrata
(AES-256-GCM, chiave derivata da `JWT_SECRET`) per poterlo rimostrare dalla
finestra "Accesso esterno"; cambiare `JWT_SECRET` rende illeggibili le copie e
la finestra propone un codice nuovo. Cambiare la persona di un accesso
aggiorna nome ed ente, scrive l'uscita e l'entrata nel registro della
squadra, genera un codice nuovo e chiude le sessioni di chi c'era prima. Alla chiusura dell'emergenza o a
una revoca vengono disattivati e le loro richieste ricevono una risposta 403
che dice il motivo (`accesso_temporaneo_finito`), così l'app lo spiega invece
di dire "sessione scaduta".

Oltre al limite per indirizzo (cento tentativi sbagliati ogni quarto d'ora
dalla stessa rete), c'è un limite per account, in `src/tentativiAccesso.js`.
Si conta per account e per rete (l'indirizzo IPv4, o la rete /64 in IPv6): dopo
cinque password sbagliate sullo stesso nome dalla stessa rete, quella rete si
ferma per un minuto su quel nome, e ogni errore successivo raddoppia la pausa
fino a un massimo di quindici minuti. Le altre reti non sono toccate: chi
insiste da fuori non tiene fuori il coordinatore che entra dalla sala. Contato
sul solo account, invece, bastava un tentativo a ogni fine pausa per tenere
fuori una persona per sempre. Contro chi prova da molte reti insieme c'è una
seconda soglia per l'account intero: trenta errori in un'ora, da qualunque
rete, fermano l'account per cinque minuti, una pausa fissa che i tentativi
fatti nel frattempo non allungano; dopo, per rimetterla, servono altri trenta
errori. Questa pausa non ferma le reti da cui la persona è entrata con la
password negli ultimi trenta giorni (fino a venti per account, ricordate solo
da un accesso riuscito): chi attacca da molte reti non tiene fuori il
coordinatore dalla sua sala. Prima un errore solo, appena finita la pausa, la
rimetteva, e otto reti bastavano per tenere fuori dalle reti nuove la persona
per 48 minuti all'ora. Quando succede la persona riceve un'email e
nel registro delle operazioni resta `accesso.molti_tentativi`. L'accesso
risponde 429 con `Retry-After` e un messaggio che dice quanto aspettare, che la
pagina d'accesso e l'app mostrano così come arriva. Vale per qualunque nome
scritto, esistente o no, così la risposta non rivela quali account ci sono; una
password giusta azzera il conto della rete da cui si entra, e dopo un'ora senza
errori si riparte da capo. L'accesso dell'app con il token di rinnovo o con la
chiave del telefono non passa da queste pause: in emergenza è la via sicura per
entrare comunque. I controlli ancora in corso contano come errori: senza, cento
richieste mandate insieme passavano tutte il controllo prima che bcrypt
finisse la prima, e una password giusta in mezzo entrava anche dopo la pausa.
Oltre la soglia ne passa uno alla volta, gli altri ricevono 429. Il conto sta
in memoria: un riavvio lo azzera, reti fidate comprese. La rete è
quella vera solo dietro nginx, come nelle istanze in container: con la porta di
ORION esposta direttamente, chiunque se la sceglierebbe con `X-Forwarded-For`.
`npm run test:tentativi` lo prova su un server acceso, `npm run test:sicurezza`
anche senza.

Il link di ripristino (`POST /api/auth/forgot-password`) ha due tetti. Per
account se ne mandano al massimo tre all'ora: ogni link nuovo annulla il
precedente, e senza tetto chi conosce un nome terrebbe sempre scaduto quello
che la persona sta per aprire, oltre a riempirle la casella. Oltre il tetto la
richiesta risponde come sempre, perché la risposta non deve dire quali account
esistono, ma non manda niente: resta valido l'ultimo link mandato e nel log
c'è un avviso con il tempo che manca al prossimo. Per rete passano dieci
richieste ogni quarto d'ora, qualunque nome si scriva, poi la risposta è 429.
Anche questi conti stanno in memoria.

Le regole di una password nuova sono in `src/password.js` e valgono dovunque
se ne sceglie una (primo accesso, cambio password, link di ripristino): almeno
12 caratteri, al massimo 128, con maiuscole, minuscole, un numero e un
simbolo, e almeno sei caratteri diversi. Oltre alla forma si rifiutano le
password che la rispettano solo in apparenza. Si confrontano con un elenco di
parole che si provano per prime (password, qwerty, i mesi, le squadre di
calcio, le città, protezione civile, ORION...), dopo aver tradotto le
sostituzioni ovvie (0 per o, 3 per e, @ per a) e tolto numeri e simboli in
testa e in coda: "P@ssw0rd2025!" e "Juventus1897!" non passano, e nemmeno
una parola comune ripetuta o una parola lunga che fa quasi tutta la password.
Si rifiutano anche il proprio nome, cognome, nome utente o la prima parte
dell'email. Una frase o più parole che non stanno insieme passano. `npm run test:sicurezza` prova
queste regole, la pausa per account, gli indirizzi esterni e il TLS del
database senza bisogno del server.

L'app, con l'impronta, non conserva la password: tiene un token di rinnovo
legato a quel telefono e cifrato con una chiave del portachiavi hardware. Il
server tiene solo l'impronta SHA-256 del token, e cambiare la password li
revoca tutti.

### L'archivio dei documenti del gruppo

`src/documenti.js`, con la migrazione `documenti-gruppo`: le tabelle
`documenti_cartelle`, `documenti` (cartella, titolo, descrizione,
`visibilita` `interni` o `ruoli` con l'elenco `ruoli`, `in_emergenza`,
`sempre_con_me`), `documenti_versioni` (numero, file, nome originale, tipo,
dimensione, impronta SHA-256 del file in chiaro, nota, chi e quando) e
`documenti_beni` (il collegamento ai beni del magazzino). Chi vede cosa lo
decide `puoVedere()`: chi ha `gruppo.documenti` tutto; gli interni i
documenti per tutti e quelli riservati a un loro ruolo (l'amministratore
sempre); gli esterni solo quelli `in_emergenza`, e solo mentre un'emergenza
è aperta. Un documento che non si può vedere risponde 404, come uno che non
c'è.

Il collegamento si fa anche dal lato del magazzino, per chi ha
`gruppo.documenti` o `magazzino.gestione`: `POST /api/documenti/:id/beni`
accetta `simili: true` e collega anche i beni dello stesso tipo e con la
stessa denominazione non dismessi (`collegaBeni()`, che risponde 404 se il
documento o il bene non c'è), e `POST /api/magazzino/beni/:id/libretto`
(multipart, gli stessi controlli dell'archivio sul file) crea un documento
per gli interni nella cartella dei libretti, quella il cui nome comincia per
"Libretti" o una nuova "Libretti d'uso e manutenzione", con il titolo
"Libretto" e il nome del bene, e lo collega in una transazione; risponde con
il documento e `collegati`. Nell'app la scheda del bene e quella del
materiale in carico nella schermata I miei dati leggono `GET /api/documenti?bene=ID`. In `GET
/api/documenti` ogni documento porta anche `in_carico`: è collegato a un bene
che chi chiede ha adesso in carico, a sé o a una squadra di cui è membro
(`beniDi()`: i pezzi singoli da `beni_situazione`, gli sfusi dal saldo di
`detenzioni_sfusi`, come `beniInCarico()` del magazzino). L'app tiene sul
telefono i documenti con `sempre_con_me` o `in_carico`.

Le rotte: `GET /api/documenti` (con `?bene=ID` i soli collegati a un bene)
dà cartelle, documenti con l'ultima versione e i beni collegati, `gestisce`,
il tetto in MB e, a chi gestisce, il peso dell'archivio; `GET
/api/documenti/:id` aggiunge lo storico delle versioni; `GET
/api/documenti/:id/file` (con `?versione=N` una precedente) manda il file
decifrato, in linea per PDF e immagini, da scaricare per gli altri. Con
`gruppo.documenti`: `POST /api/documenti` e `POST /api/documenti/:id/versioni`
(multipart, campo `file`), `PUT` e `DELETE /api/documenti/:id`, `POST`, `PUT`
e `DELETE /api/documenti-cartelle` (una cartella si toglie solo vuota). Il
collegamento ai beni (`POST /api/documenti/:id/beni`, `DELETE
/api/documenti/:id/beni/:beneId`) vale anche con `magazzino.gestione`. Il
file deve avere un formato ammesso (PDF, JPG, PNG, WEBP, Word, Excel,
PowerPoint, OpenDocument, testo) e un contenuto che corrisponde
all'estensione (`file-type`), al massimo 25 MB (`MB_MASSIMI`, 413 oltre): si
salva in `protected_uploads/documenti-gruppo` e si cifra subito come gli
altri caricamenti. Ogni operazione finisce nel registro (`documento.*`,
`documenti.cartella_*`). Il contesto dell'app porta la capacità `documenti`
agli interni sempre e agli esterni a emergenza aperta. `npm run
test:documenti` prova permessi, visibilità, esterni, versioni, controlli sul
file, collegamento ai beni e cartelle.

### Attività, calendario e presenze

`src/attivita.js` e `src/presenze.js`, con la migrazione `attivita-presenze`.
Le tabelle: `attivita_tipi` (nome, ordine, attivo; nascono Esercitazione,
Addestramento, Servizio, Riunione, Manutenzione), `attivita` (tipo, titolo,
descrizione, luogo, `inizio` e `fine`, `convocazione` `tutti`, `scelti` o
`aperta`, `posti`, `avviso_app`, `avviso_email`, `responsabile_id`,
`corso_id` verso il catalogo dei corsi, `stato` `programmata`, `annullata` o
`conclusa`, con motivo e data), `attivita_persone` (attività e persona come
chiave, `convocato`, `risposta` `si` o `no`, quando e una nota) e
`partecipazioni`, le presenze: persona, `origine` `attivita` o `emergenza`
con il riferimento coerente (un vincolo lo controlla), titolo e tipo come
erano allora, inizio, fine, minuti, il dettaglio delle squadre per le
emergenze, il corso scritto nel libretto (`corso_utente_id`), chi l'ha
registrata e chi l'ha corretta. Due indici unici parziali tengono una sola
presenza per persona e attività e per persona ed emergenza. Il modulo si
spegne con `attivita_enabled` in `branding_settings` (acceso di partenza,
fra le impostazioni pubbliche): spento, le rotte rispondono 404 con
`modulo_spento` e i dati restano.

Chi vede un'attività lo dice `VISIBILE`: chi ha `gruppo.attivita`, il
responsabile, i convocati e, con `tutti` e `aperta`, ogni interno; gli
esterni mai. Il responsabile gestisce la sua attività anche senza il
permesso (`puoGestire`), ma non cambia il responsabile. `forma()` aggiunge
`gestisce`, `sono_convocato`, `mia_risposta`, i conteggi, `posti_liberi` e
`puo_rispondere`; chi gestisce riceve anche le persone, con la
raggiungibilità (un token nella tabella degli avvisi per l'app, l'email
valorizzata) per il segno "Da chiamare".

Le rotte: `GET /api/attivita/tipi`, e con il permesso `POST` e `PUT
/api/attivita/tipi/:id`; `GET /api/attivita?da&a`, `GET
/api/attivita/da-rispondere`, `GET /api/attivita/corsi` (il catalogo per
"vale come corso"), `GET /api/attivita/:id`; `POST /api/attivita` (con il
permesso), `PUT /api/attivita/:id` (solo programmata; con `avvisa: true` il
cambio va a chi non ha detto di no, e i convocati nuovi ricevono la
convocazione), `POST /api/attivita/:id/annulla`, `DELETE /api/attivita/:id`
(409 se ci sono presenze), `POST /api/attivita/:id/risposta` (`si` o `no`
con una nota; 409 `posti_esauriti` quando un'attività aperta è piena, con un
`FOR UPDATE` sulla riga per non superare i posti), `POST
/api/attivita/:id/concludi` (`presenze: [{ user_id, inizio, fine }]`),
`GET /api/attivita-persone` (gli interni da convocare). Gli avvisi partono
dopo la risposta: una notifica personale (`convocazione`,
`attivita_cambiata`, `attivita_annullata`, riferimento `attivita`) e, se
scelta, un'email con il collegamento a `/calendario.html?attivita=ID`. Una
risposta, la chiusura e l'annullamento fanno scadere le notifiche di
convocazione. Tutto finisce nel registro (`attivita.*`).

Chi conduce un'attività (`creato_da`, il responsabile, la regia) non è fra i
destinatari della convocazione, non è in `/api/attivita/da-rispondere` e
`forma()` gli dà `conduco: true` e `puo_rispondere: false`.

`GET /api/calendario?da&a` (al massimo 400 giorni) dà le attività visibili,
le emergenze del periodo e le scadenze raggruppate per giorno e categoria:
`mie` (le proprie visite e i propri corsi, con la Segreteria accesa),
`segreteria` (di tutti, con `volontari.sanitario`), `magazzino` (le scadenze
dei beni non dismessi, con `magazzino.gestione` e il Magazzino acceso); per
ogni visita e corso conta l'ultima registrazione del tipo. `filtri` dice
quali categorie ha chi chiede, `organizza` se può creare attività.

Le presenze di un'attività le scrive `registraPresenzeAttivita()`: sostituisce
quelle che c'erano e, se l'attività vale come corso, inserisce in
`user_courses` il corso dei presenti (con la scadenza del catalogo) e lo
toglie a chi esce. Quelle di un'emergenza le scrive
`registraPresenzeEmergenza()` alla chiusura, dopo la scadenza delle
notifiche: `intervalliDalRegistro()` legge `emergency_team_log`
(`membro_aggiunto`, `membro_rimosso`, i membri delle squadre già formate
all'apertura), unisce gli intervalli di ogni persona e scrive una presenza
per gli interni, COC compresa; gli esterni no. L'inserimento è `ON CONFLICT
DO NOTHING`, così una correzione già fatta non si perde. Le rotte di
`presenze.js`: `GET /api/presenze/mie?anno`, `GET /api/users/:id/presenze`
(la persona stessa, `gruppo.attivita` o `volontari.anagrafica`), `GET
/api/presenze/riepilogo?anno` (con `formato=csv` il file per il foglio di
calcolo, separato da punto e virgola), `GET` e `POST
/api/emergencies/:id/presenze`, `PUT` e `DELETE /api/presenze/:id` (le
correzioni, con `gruppo.attivita`, scrivono `corretta_da` e l'audit
`presenza.*`), `GET /api/presenze/:id/attestato` (il PDF con pdfmake e i
caratteri standard, alla persona stessa o a chi vede tutti). Gli esterni non
hanno presenze e ricevono 403. Eliminando una persona,
`attivita_persone` e `partecipazioni` si cancellano. Il contesto dell'app
porta il modulo (`moduli.attivita`) e la capacità `calendario` agli interni
con il modulo acceso. `npm run test:attivita` prova permessi, visibilità,
risposte, posti, annullamento, chiusura con il corso, attestato, calendario,
modulo spento e, in emergenza, la squadra COC e le presenze dal registro
(apre e chiude un'emergenza sua se non ce n'è una in corso).

Gli allegati di un'attività stanno in `attivita_allegati` e i file in
`protected_uploads/attivita`, cifrati come gli altri caricati; formati e
tetto (25 MB) sono quelli dell'archivio dei documenti, con il controllo del
contenuto, e al massimo 20 per attività. `POST /api/attivita/:id/allegati`
(campo `file`) li carica chi gestisce l'attività,
`GET /api/attivita/:id/allegati/:allegato` li apre chi la vede (PDF e
immagini nel browser, il resto si scarica), `DELETE` li toglie chi la
gestisce; `GET /api/attivita/:id` li elenca in `allegati`. Eliminando
l'attività si cancellano anche i file.

### Chiamata, simulazione e copione

Tre moduli del livello 4, con tre migrazioni.

La chiamata (`src/chiamate.js`, migrazione `chiamata-disponibilita`) ha
cinque tabelle. `chiamate` tiene il contesto, che è un'emergenza oppure
un'attività e mai tutti e due (un vincolo lo controlla), il messaggio, il
`criterio` (`tutti`, `reperibili`, `corso` con `corso_id`, `scelti`), i
modi di avviso e `minuti_attesa`, dopo i quali chi tace passa fra i "da
chiamare a voce". `chiamate_persone` dice chi è stato chiamato e se l'avviso
è partito per app o email. `disponibilita` tiene lo stato di una persona in
quel contesto (`in_arrivo`, `arrivato`, `non_disponibile`, `congedato`), con
la risposta, i minuti di ritardo, l'arrivo previsto, l'arrivo e il congedo;
due indici unici parziali ne tengono una per persona e contesto. Infine
`reperibilita` (persona, dal, al, chi l'ha messa) e `assenze` (persona, dal,
al, nota). Il contesto di una richiesta viene da `attivita_id` (in query o
nel corpo) oppure dall'emergenza aperta. Chiama chi ha
`emergenze.apertura` o `gruppo.attivita` in emergenza, e chi gestisce
l'attività fuori; segue le risposte ogni interno della sala. Nelle chiamate
non a nome restano fuori gli assenti del giorno e chi ha già detto di no;
chi è in squadra o già in arrivo resta fuori sempre. La notifica è di tipo
`chiamata`, categoria `emergenza`, riferimento `chiamata`; una risposta la fa
scadere. Le rotte: `GET /api/chiamate/candidati`, `POST /api/chiamate`,
`POST /api/chiamate/:id/richiama`, `GET /api/chiamate/mie`, `GET
/api/chiamate/:id`, `POST /api/chiamate/:id/risposta` (`arrivo`, `ritardo`
con `minuti`, `no`), `POST /api/disponibilita/arrivato`, `GET
/api/disponibilita`, `PUT /api/disponibilita/:userId` (la sala segna arrivi e
congedi, anche di chi non era stato chiamato); `GET`, `POST` e `DELETE` per
`/api/reperibilita` e per `/api/assenze`, con `GET /api/assenze/mie`. Ogni
cambio manda `reload_disponibili` sul canale in tempo reale. Le presenze
contano anche il tempo in sede: `intervalliDalRegistro()` riceve gli
intervalli di `intervalliInSede()` (dall'arrivo al congedo o alla fine) e li
unisce a quelli delle squadre, e la gestione delle squadre mette per primi
quelli `in_sede`. `/api/calendario` porta per ogni giorno reperibili e
assenti (`turni`).

La simulazione in sala (migrazione `simulazione-in-sala`) aggiunge
`attivita_tipi.natura` (`generica`, `addestramento`, `esercitazione`), le
colonne `simulazione` (`allertamento` o `sala`), `scenario`, `obiettivi`,
`enti` in `attivita`, la tabella `attivita_regia` (attività, persona) e in
`emergencies` le colonne `simulazione`, `attivita_id`, `interrotta_il` e
`interrotta_da`. Una simulazione si chiede solo per i tipi di natura
addestramento o esercitazione (400 altrimenti). `forma()` aggiunge
`natura`, `regia`, `regista` e `sala` (aperta o chiusa, con l'id
dell'emergenza). L'apertura e la chiusura delle emergenze stanno in due
funzioni esportate di `src/emergenze.js`, `apriEmergenza()` e
`chiudiEmergenza()`, che servono sia alle rotte di sempre sia a `POST
/api/attivita/:id/apri-sala`. Questa apre la sala da tre ore prima
dell'inizio fino alla fine, per chi conduce l'attività (organizzatori,
responsabile, regia), con il codice `SIM-AAAAMMGG-id`. `activeEmergency`
porta `simulazione` e `attivita_id`; resoconto, punto di situazione e stampe
mettono la filigrana, e le notifiche di categoria emergenza ricevono il
prefisso `[SIMULAZIONE]` in `creaNotifiche()`. La chiusura di una
simulazione non tiene strade chiuse né zone e scrive le presenze
nell'attività con `registraPresenzeSimulazione()`, che passa per
`registraPresenzeAttivita()`; l'attività diventa conclusa. Aprire
un'emergenza vera durante una simulazione risponde 409 con
`simulazione_in_corso: true`; con `interrompi_simulazione: true` la
simulazione si chiude tenendo squadre e sala, prende `interrotta_il` e
`interrotta_da`, e solo dopo si scrive il suo resoconto
(`completaChiusura()`). La chiude, oltre a chi ha `emergenze.apertura`, chi
conduce la simulazione. La simulazione al volo (`POST /api/simulazioni/al-volo`,
per chi ha `emergenze.apertura` o `gruppo.attivita`) crea in una transazione
un'attività del primo tipo attivo della natura chiesta, da adesso per le ore
indicate (da 1 a 24), con convocazione `scelti` senza nessuno, niente avvisi,
chi la apre come responsabile e `creato_da`, e se richiesto il copione di
un'altra attività (`copiaCopione()`, solo fra quelle di `GET
/api/simulazioni/copioni`, cioè di cui la persona fa la regia) oppure, con
`copia_scenario`, quello di uno scenario della biblioteca (`GET
/api/simulazioni/scenari`, stessi permessi); le due cose insieme danno 400.
Da uno scenario, natura, durata (al massimo 24 ore), titolo, scenario,
obiettivi ed enti non scritti nella richiesta vengono dallo scenario, e
l'attività prende `scenario_id`. Poi apre la
sala con `apriEmergenza()`. Se la sala non si apre, l'attività appena creata
si cancella. Il contesto dell'app porta `emergenza.simulazione`,
`emergenza.attivita_id` e, a chi conduce, la capacità `regia`.

La biblioteca degli scenari (`src/scenari.js`, migrazione `scenari`,
pagina `simulazioni.html`) è per chi ha `gruppo.attivita`, con il modulo
Attività acceso. La tabella `scenari` tiene titolo, natura (`addestramento` o
`esercitazione`), `durata_ore` da 1 a 72, scenario, obiettivi, enti, chi l'ha
creato e quando. Gli eventi del copione di uno scenario stanno nella stessa
`copione_eventi`, con `scenario_id` al posto di `attivita_id`: il vincolo
`copione_eventi_un_contenitore` vuole esattamente uno dei due, e togliendo lo
scenario i suoi eventi se ne vanno in cascata. Le rotte del copione
(`copione.xlsx`, `copione/eventi`, `copione/importa`, `copione/copia`)
rispondono anche sotto `/api/scenari/:id/`, con la colonna scelta da
`contenitoreDi(req)` e i permessi da `serveScenario()`; `PUT` e `DELETE
/api/copione/eventi/:id` guardano `scenario_id` dell'evento. `GET
/api/scenari/:id/copione` ha la forma di quello di un'attività mai andata in
sala (eventi `atteso`, niente sala, osservazioni e debriefing), più
`scenario`. `copione/copia` accetta `{ da }` (un'attività) o `{ da_scenario }`,
sotto entrambe le radici. `inserisciEvento()`, `eventiDi()` e `copiaCopione()`
prendono la colonna del contenitore, controllata contro un elenco chiuso. `GET
/api/scenari` dà gli scenari con `eventi`, `usi` (attività non annullate con
quello `scenario_id`), `ultimo_uso` e `prossimo_uso`, più `programmate` e
`svolte`, le attività con simulazione. `POST /api/scenari/:id/duplica` copia
dati e copione in una transazione. Pianificare è `POST /api/attivita` con
`scenario_id`: lo scenario deve esistere e l'attività avere la simulazione;
il copione si copia nella stessa transazione e `attivita.scenario_id` resta
(`ON DELETE SET NULL`), così le attività sopravvivono allo scenario con la
loro copia. Il calendario lo fa da `calendario.html?scenario=N`, che riempie
il modulo con `riempiDaScenario()`; il copione dello scenario si scrive da
`copione.html?scenario=N`, la stessa pagina con la radice delle rotte
cambiata, senza valutazione né pubblicazione.

Il copione (`src/copione.js`, migrazione `copione-regia`) sta in
`copione_eventi`: attività (o scenario), ordine, `minuto` (NULL vuol dire a mano), `tipo`
(`segnalazione`, `aggravamento`, `comunicazione`, `imprevisto`, `strada`),
titolo, testo, `modo` (`da_sola` o `telefono`), indirizzo e punto, priorità,
segnalante e telefono, `riferimento_id` per l'aggravamento, `squadra` (nome
radio) per l'imprevisto, `elemento_tipo` e `geometria` per la strada,
`risposta_attesa` e `minuti_attesi`. Gli esiti sono per emergenza in
`copione_esiti` (stato `uscito` o `saltato`, rimando, quando e da chi, se
automatico, la segnalazione o l'elemento creato). `regia_orologio` tiene
l'avvio e le pause, `osservazioni` gli appunti della regia, `debriefing` i
quattro campi con chi li ha scritti e la conclusione;
`attivita.copione_pubblicato` apre copione e debriefing ai partecipanti a
sala chiusa. Uscendo, una segnalazione crea il report come farebbe la sala
(con i rischi delle zone), un aggravamento aggiunge una nota e la priorità,
una comunicazione scrive nel diario di sala, un imprevisto manda la notifica
`imprevisto` ai membri della squadra, una strada crea l'elemento di mappa, e
una segnalazione da telefonare manda alla regia la notifica `regia_telefona`.
Il motore è `controllaUscite()`: fa uscire gli eventi a tempo il cui minuto,
più il rimando, è passato sull'orologio al netto delle pause. Ogni cambio
della regia (avvio, pausa, uscita, rimando, evento cambiato) passa da
`regiaCambiata()`, che avvisa le pagine e ripianifica con `pianifica()` un
timer sul prossimo evento, al millisecondo; il controllo ogni 15 secondi
resta come rete di sicurezza, e dopo un riavvio ripianifica tutto. Un
controllo alla volta: se ne arriva un altro mentre gira, si ripete alla fine.
Il tipo `pericolo` (migrazione `copione-zone-pericolo`) disegna una zona
`pericolo_alluvione`, `pericolo_frana` o `pericolo_generico` e poi rivede i
rischi delle segnalazioni con `aggiornaRischi()`; nel foglio Excel è "Zona di
pericolo (alluvione/frana/altro)". Una comunicazione che esce manda anche
`comunicazione_sala` (titolo, testo, ora) a tutti i collegati, e `GET
/api/regia/comunicazioni` dà quelle già uscite nella simulazione aperta a
chiunque sia in sala: il centro operativo le tiene in primo piano finché non
si segnano lette (lo ricorda il browser). L'evento improvvisato accetta
indirizzo e punto per la segnalazione. Le rotte del copione: `GET /api/copione/modello.xlsx`, `GET
/api/attivita/:id/copione` e `.xlsx`, `POST
/api/attivita/:id/copione/eventi`, `PUT` e `DELETE /api/copione/eventi/:id`,
`POST /api/attivita/:id/copione/importa` (multipart, 2 MB, tutto o niente
con l'elenco delle righe sbagliate), `POST /api/attivita/:id/copione/copia`,
`PUT /api/attivita/:id/copione/pubblica`, `PUT
/api/attivita/:id/debriefing` e `POST .../debriefing/concludi`, `POST
/api/attivita/:id/osservazioni`. Quelle della regia, con la sala aperta:
`GET /api/regia`, `POST /api/regia/avvia`, `POST /api/regia/pausa`, `POST
/api/regia/eventi/:id/esci`, `rimanda`, `salta` e `collega`, `POST
/api/regia/improvvisa`. Ogni cambio manda `regia_aggiorna` e finisce nel
registro (`copione.*`, `regia.*`, `debriefing.*`). L'archivio delle
emergenze chiuse riporta `simulazione`, il titolo dell'attività,
`interrotta_il` e il codice di chi l'ha interrotta.

`npm run test:chiamate`, `npm run test:simulazione` e `npm run
test:copione` provano tutto questo su un'istanza senza emergenze in corso:
aprono e chiudono emergenze e simulazioni loro.

### Il tesserino

Il tesserino si disegna in `public/js/tesserino.js`, caricato dalla
segreteria (stampa) e da `/admin/tesserino.html` (configuratore, solo
amministratori). Il modello calcola una volta l'elenco delle forme
(rettangoli, testi, immagini, QR, barre) e le traduce in pdfMake per la
stampa e in nodi SVG per l'anteprima; i testi si misurano con lo stesso
Roboto del PDF, caricato da `vfs_fonts.js` come FontFace. Il modello scelto
dall'amministratore sta in `badge_modello` (impostazione pubblica):
`{ colori, testi, posizioni, nascosti, retro }`, con `posizioni` nullo per la
disposizione automatica, che si adatta a QR, codice fiscale ed ente.
`retro` elenca gli elementi spostati sul retro, scelti fra QR, codice a barre,
scritta centrale, loghi e bandiere; ogni posizione vale sulla facciata del
suo elemento, e il retro automatico (`automaticheRetro`) mette il codice
largo in basso, il QR con scritta e loghi sopra, le bandiere in fondo. Il
retro c'è solo se contiene qualcosa di visibile (`conRetro`): allora
`facciate()` dà due disegni per tesserino, e `inPdf()` fa una pagina per
disegno nell'ordine ricevuto, con lo sfondo di ciascuna pagina in
`background` come funzione della pagina. La segreteria li mette in fila
tesserino per tesserino (stampanti fronte-retro) o prima tutti i fronti e
poi tutti i retri (stampanti a una facciata, con le tessere rimesse girate).
`PUT /api/branding/settings` lo accetta solo dopo `validaModelloTesserino`
(`src/modelloTesserino.js`): colori `#rrggbb`, testi da 1 a 40 caratteri,
misure numeriche entro il tesserino, chiavi note; vuoto vuol dire il
tesserino predefinito. Il disegno impone le misure minime (QR 38 pt di lato,
codice a barre largo almeno 231 moduli da tre punti a 300 dpi) e mette QR e
barre su bianco. Il QR non usa il nodo `qr` di pdfMake, che arrotonda il
modulo a punti interi e rimpiccioliva un QR di 33 moduli da 58 a 33 punti:
la matrice viene da qrcodejs (`_oQRCode`, un campo interno della versione
in `vendor`) e ogni modulo è un numero intero di punti della stampante,
come le barre; lo stesso disegno fa l'anteprima del configuratore. Gli elenchi delle chiavi stanno nei due file e vanno tenuti
uguali; `npm run test:tesserino` prova il controllo del server.

### Le condizioni d'uso e la loro accettazione

La versione in vigore delle condizioni d'uso sta in `branding_settings`
(`privacy_versione`) e in memoria (`statoInformativa.js`, letta all'avvio);
quella accettata da ciascuno in `users.presa_visione_versione`, letta nella
stessa interrogazione di `authenticateToken`. Se non coincidono le API
rispondono `428` con `informativa_da_vedere: true` e le pagine (GET che
accettano HTML) rimandano a `/informativa.html?redirect=…`. Restano libere
`GET /api/informativa`, `POST /api/informativa/presa-visione` (con la versione
letta: una superata dà 409), `/logout` e la pagina stessa;
`GET /api/pubblico/informativa` dà il testo anche senza accesso. I nomi delle
rotte e dei campi vengono da quando c'era anche l'informativa sul trattamento
dei dati, tolta per ora: l'app li usa, e le risposte portano ancora
`informativa` e `breve` vuoti. Ogni accettazione è una riga di
`prese_visione` con la persona per esteso, la versione, il canale e lo
SHA-256 del testo mostrato. Il testo predefinito sta in
`src/testiCondizioni.js` e usa `association_name`; quello riscritto in
`privacy_testo_condizioni`. `PUT /api/admin/informativa` salva, incrementa la
versione e registra l'accettazione di chi pubblica; `privacy_versione` e
`privacy_pubblicata_il` non si scrivono da `PUT /api/branding/settings`.

### L'eliminazione di una persona

`DELETE /api/users/:id`, dopo aver sistemato il materiale in carico, prova a
cancellare la riga di `users` (con visite, corsi, ruoli e il resto a cascata).
Se la persona compare nello storico protetto da chiavi esterne (`reports`,
`report_updates`, `emergency_documents`: errore 23503), torna a un punto di
salvataggio e la pseudonimizza (`src/eliminazionePersona.js`): cancella
visite, corsi, ruoli, token di rinnovo, codici di riserva, notifiche,
funzioni, avvisi e accessi temporanei, chiude le appartenenze alle squadre
ancora aperte e svuota in `users` password, email, codice fiscale, contatti,
indirizzo, foto, segreto MFA ed ente, cambia il `public_token` e segna
`eliminato_il`. Restano nome, cognome e nome utente. In entrambi i casi la
foto e i certificati si tolgono dal disco dopo il COMMIT. Gli elenchi degli
utenti, degli esterni temporanei e il controllo dei doppioni all'importazione
escludono `eliminato_il`; sospensione, riattivazione, modifica e reset della
password rispondono 404. Le tabelle immutabili (registro, diario, movimenti,
registro squadre) tengono il nome scritto per esteso e non si toccano. Anche
sostituire o cancellare una foto, un certificato o un attestato toglie il
file vecchio dal disco. `npm run test:eliminazione` prova i due casi.

### La verifica in due passaggi

La verifica in due passaggi ha due forme, che si possono avere insieme: il
telefono collegato, descritto nella sezione dopo, e i codici TOTP. `mfa_attiva`
vuol dire che almeno una delle due c'è. TOTP è la RFC 6238: codici di sei cifre a
intervalli di 30 secondi, HMAC-SHA1, calcolati dal telefono con un segreto di
160 bit condiviso al momento dell'attivazione. È scritta in `src/mfa.js`
senza librerie e senza servizi esterni. Il server accetta anche l'intervallo
prima e quello dopo, per gli orologi un po' avanti o indietro, e tiene in
`users.mfa_ultimo_passo` l'ultimo intervallo usato: lo stesso codice non vale
due volte, nemmeno da due richieste contemporanee. Il segreto sta in
`users.mfa_segreto` cifrato con la chiave dei dati (`enc1:`); se la chiave
manca quando lo si salva resta in chiaro e si cifra appena la chiave torna,
come la password della posta. I dieci codici di riserva (50 bit ciascuno)
stanno in `mfa_codici_riserva` solo come impronta SHA-256, legata
all'utente, e ognuno si consuma al primo uso.

L'accesso diventa di due passi. `POST /login` con la password giusta, a chi
ha la verifica, non dà la sessione ma una risposta 401 con `mfa: "codice"` e
una sfida casuale; la sessione la dà `POST /api/accesso/mfa` con la sfida e il
codice. Le sfide stanno in memoria, durano cinque minuti e cadono dopo cinque
codici sbagliati (`sfida_scaduta`); un riavvio del server le perde e si
rientra con la password. Entrambe le rotte stanno sotto il limite dei
tentativi d'accesso. Siccome con la password giusta si ha una sfida nuova
quante volte si vuole, i codici dell'app sbagliati si contano anche per
account, sopra le sfide: al decimo i codici dell'app di quella persona si
fermano per cinque minuti, e ogni errore dopo la pausa la raddoppia fino a
un'ora. La risposta è 429 con un messaggio che dice quanto aspettare. Chi
sbaglia lì ha già la password, quindi la pausa vale per l'account e non per la
rete, e alla prima pausa della giornata la persona riceve un'email che le dice
di cambiare la password; nel registro resta `mfa.molti_codici_sbagliati`.
Durante la pausa la persona vera entra lo stesso con la conferma dal telefono
collegato o con un codice di riserva, che con 50 bit non si indovinano. Un
codice dell'app giusto azzera il conto, come lo azzera togliere la verifica.
Come per le password, i codici ancora in verifica contano come errori, così
un'ondata di richieste mandate insieme su più sfide non scavalca il conto. Un'app che non conosce il secondo passo mostra il
messaggio della risposta, che dice di aggiornarla.

Per gli amministratori è obbligatoria. A un amministratore senza verifica
`/login` risponde `mfa: "attivazione"` con il segreto e l'indirizzo
`otpauth://` da mostrare come QR: la verifica si attiva con il primo codice
giusto, e solo allora arriva la sessione, insieme ai codici di riserva. Il
token di sessione porta `mfa: true` quando è nato con la verifica, e
`authenticateToken()` (come il WebSocket) rifiuta con 401 e motivo
`mfa_richiesta` ogni richiesta di un amministratore il cui token non lo
porta: vale per le sessioni di prima dell'aggiornamento e per chi diventa
amministratore mentre è collegato. Anche i token di rinnovo dell'app
ricordano se sono nati da una sessione con la verifica (`token_rinnovo.mfa`):
quelli nati senza non fanno entrare chi la deve fare. Attivarla, o cambiare
telefono, chiude le altre sessioni e cancella i token di rinnovo.

Per gli altri è facoltativa (`/api/mfa/prepara`, `/attiva`, `/codici`,
`/disattiva`, tutte con la password); gli accessi temporanei non la possono
attivare. Un amministratore la azzera a un altro da Gestione utenti
(`POST /api/admin/users/:id/mfa/azzera`, nel registro come
`mfa.azzerata`). Se l'unico amministratore perde telefono e codici di
riserva, la toglie chi ha accesso al server:

```
cd /percorso/di/orion && sudo -u <utente del servizio> node scripts/mfa-azzera.mjs <username>
```

Lo script chiude anche le sessioni e scollega i telefoni; al prossimo accesso
l'amministratore la riattiva. Anche questo finisce nel registro delle
operazioni.

### Il telefono come secondo fattore

L'app crea nel portachiavi hardware di Android una chiave P-256 per server e
persona, che non esce mai dal telefono; il server tiene in `telefoni_chiave`
solo la parte pubblica (SPKI), con un nome e l'ultimo uso. Da Android 11 la
chiave chiede impronta o PIN a ogni firma, prima solo l'impronta; su un
telefono senza blocco schermo non può chiedere niente e vale come fattore di
possesso. Ogni firma copre un testo con un prefisso diverso per scopo
(`orion-collega:`, `orion-accesso:`, `orion-conferma:`), così una firma non
vale per un'altra operazione; il server la verifica con `crypto.verify` di
Node. Il codice è in `src/telefoniChiave.js`.

Collegare un telefono vuol dire mandare la chiave pubblica firmata con sé
stessa. Si fa in tre modi: all'attivazione dell'account (sotto); dopo la
password, se il ruolo chiede la verifica e la persona non ce l'ha ancora
(`POST /api/accesso/mfa/telefono` con la sfida `attivazione`, come oggi si
attiva l'app dei codici dal browser); dal profilo, con la password
(`POST /api/telefoni`). Il primo telefono accende la verifica e dà i dieci
codici di riserva; ogni telefono nuovo manda una notifica e un'email alla
persona e finisce nel registro come `mfa.telefono_collegato`. Scollegare
l'ultimo telefono, senza app dei codici, spegne la verifica, e per chi la deve
avere è rifiutato.

All'accesso, `POST /login` risponde con la sfida e dice quanti telefoni ci
sono e se c'è l'app dei codici. L'app sul telefono collegato firma la sfida e
la manda a `/api/accesso/chiave`. Il browser chiede invece la conferma con
`POST /api/accesso/telefono`: il server sceglie un numero da 10 a 99 e lo
restituisce al browser, prepara tre scelte che lo contengono e manda alla
persona una notifica `conferma_accesso` senza il numero (WebSocket, Firebase se
c'è, coda delle notifiche). Il telefono legge le richieste in attesa con il
token degli avvisi (`GET /api/avvisi/conferme`), mostra browser, ora e i tre
numeri, e risponde a `POST /api/avvisi/conferme/:id`: "no", oppure il numero
scelto firmato con la chiave. Un numero sbagliato blocca l'accesso come un
rifiuto. Il browser chiede a `/api/accesso/telefono/stato` ogni due secondi e
riceve 202 finché si aspetta, la sessione quando il telefono ha confermato.
Le richieste stanno in memoria e durano due minuti; ogni sfida ne può chiedere
tre. Il numero da toccare serve contro chi manda richieste a raffica sperando
in una conferma distratta: il telefono non lo conosce, lo conosce solo chi sta
davanti al browser.

### L'attivazione dal telefono

Il link d'attivazione (`reset-password.html?token=..&id=..`, per email o sul
foglio con il QR) su Android propone "Continua nell'app". Il pulsante è un
`intent://attiva?...#Intent;scheme=orionmobile;package=it.orion.app;...;end`:
nominando il pacchetto, Android consegna il token solo all'app ORION e non a
un'altra app che si registri lo stesso schema. Senza app installata Chrome apre
l'indirizzo di riserva, la stessa pagina con `installa=1`, che spiega come
installarla. Lo stesso link si può inquadrare dall'app con "Accedi con un QR".
Fuori da Android, o scegliendo "Continua qui nel browser", resta la pagina di
sempre.

L'app legge nome, nome utente e cosa serve con `GET /api/attivazione` e le
condizioni con `/api/pubblico/informativa`; poi manda tutto in una richiesta
sola, `POST /api/attivazione`: password (con le stesse regole di sempre),
versione delle condizioni accettate e, se c'è, il telefono da collegare. Il
server controlla il token, salva password, presa visione e telefono in una
transazione, consuma il link e restituisce la sessione con i codici di
riserva; se qualcosa non va non cambia niente e il link resta buono. Per chi
deve avere la verifica il telefono è obbligatorio. A chi la verifica ce l'ha
già, un link di ripristino cambia la password ma non collega telefoni e non
apre sessioni: altrimenti la sola email basterebbe a scavalcare il secondo
fattore.

Dall'app, chi gestisce l'anagrafica iscrive una persona con `POST /api/users`
e mostra il link d'attivazione come QR, da inquadrare con il telefono di chi
viene iscritto. `npm run test:telefoni` prova tutto con un telefono finto.


### Le segnalazioni nel centro operativo

`GET /api/reports` e `GET /api/reports/:id` portano `ultima_nota`
(`testo`, `quando`, `autore`): l'ultima voce del diario non di sistema, che
la scheda mostra su una riga; quelle che arrivano dal WebSocket
(`new_report_update` non di sistema) la sostituiscono finché il server non ne
manda una più nuova. Assegnare una squadra (`POST /api/reports/:id/teams`) a
una segnalazione `New` o `Open` la porta a `InProgress`; togliere l'ultima
(`DELETE /api/reports/:id/teams/:teamId`) riporta una `InProgress` senza
`no_team_reason` a `Open`. In entrambi i casi il diario riceve la voce di
sistema del cambio di stato, come per una modifica a mano, e il WebSocket la
inoltra. Sulla mappa il colore del segnaposto viene da
`situazioneSegnalazione()` (da assegnare, con squadra, senza squadra,
risolta, chiusa) e l'anello delle novità da `haNovita()`, cioè dalle
segnalazioni che lampeggiano o hanno aggiornamenti non letti; l'insieme
`blinkingReportIds` ridisegna da sé il segnaposto a ogni cambio, e i gruppi
del markercluster prendono il colore della situazione più urgente.
`npm run test:stato-squadre` prova lo stato automatico e l'ultima nota.

Le letture stanno in `letture_segnalazioni` (persona, segnalazione,
`letta_il`): `PUT /api/letture/:id` la sposta in avanti (mai indietro, mai
oltre adesso), `GET /api/letture` dà per l'emergenza in corso, per ogni
segnalazione già aperta, `non_lette` (voci di altri dopo `letta_il`, al
millesimo come le ore del browser) e `forti` (quelle non di sistema o di
foto). Il centro operativo le segna aprendo una segnalazione e lasciandola, e
al caricamento ne ricava contatori e lampeggio. Dal WebSocket una voce non di
sistema, di foto o con `priorityRaisedToHigh` è forte (lampeggio, avviso,
notifica del computer con la finestra in secondo piano); le altre fanno solo
il contatore. `reload_reports` porta `daUtente`: chi ha fatto la modifica non
la vede come novità. `npm run test:letture` prova le letture.

Il quadro della situazione sta in `quadro_situazione`, una riga per
emergenza (`emergency_id` come chiave, `dati` in jsonb, `aggiornato_il`,
`aggiornato_da`). `PUT /api/situazione/quadro` lo sostituisce per
l'emergenza aperta (409 se non ce n'è una) dopo `normalizzaQuadro()`: testi
ripuliti e con una lunghezza massima, numeri della popolazione interi fra 0 e
un milione, `prossimo` nel formato del campo data e ora del browser, campi
vuoti tolti; ogni salvataggio va nel registro come
`emergenza.quadro_aggiornato`. `GET /api/situazione/quadro` lo restituisce o,
se manca, propone `recapito` e `responsabile` dall'ultimo quadro di un'altra
emergenza; `GET /api/situazione` lo porta nel campo `quadro`, anche per
un'emergenza chiusa. Entrambe le rotte escludono gli esterni.
`npm run test:quadro` prova controlli, salvataggio e proposta.

**Il tipo.** `reports.tipo` (migrazione `tipo-segnalazione`) vale uno dei
codici di `TIPI_SEGNALAZIONE` in `src/costanti.js`, con un vincolo nel
database; di serie `altro`. Si manda nella creazione e nella modifica (un
codice sconosciuto è 400) e `GET /api/segnalazioni/tipi` dà codici ed
etichette. `GET /api/situazione` lo conta in `per_tipo`, il resoconto ha una
riga per tipo.

**Le vicine.** `GET /api/reports/vicine?lat=&lon=` restituisce al massimo
cinque segnalazioni aperte dell'emergenza in corso entro cento metri, con la
distanza in `metri`. La distanza è calcolata in SQL con la formula
dell'emisenoverso, senza estensioni geografiche del database; fuori emergenza
la risposta è vuota, agli esterni 403. Il modulo di creazione la chiama prima
di salvare.

**Lo stato delle squadre.** Ogni assegnazione (`report_team_assignments`) ha
`stato` (assegnata, partita, sul_posto, conclusa, rientrata, in quest'ordine:
`STATI_SQUADRA`) e `stato_il`. `POST /api/reports/:id/teams/:teamId/stato`
con `{ stato, quando }` lo cambia: lo possono i membri della squadra, esterni
compresi, e gli interni; tornare indietro solo gli interni (agli altri 409),
lo stesso stato due volte è 409. `quando` è l'ora del tocco mandata dall'app
quando il cambio parte dalla coda senza rete: vale se non è più di due minuti
nel futuro e non più vecchia di sei ore, altrimenti si usa adesso. La rotta
accetta la chiave d'idempotenza. Ogni cambio scrive una nota di sistema nel
diario, una riga in `stati_squadra` (segnalazione, squadra, nome radio,
stato, ora, autore), che entra nello storico sigillato, e manda
`reload_reports` e `reload_squadre`. Il resoconto ne ricava per ogni squadra
il tempo di arrivo (da assegnata a sul posto) e la permanenza sul posto.
`GET /api/squadre` porta lo stato in `active_target_info.stato`.
`npm run test:stati-squadra` prova chi può cambiare cosa, l'ora dalla coda,
diario, resoconto e sigillo.

**Le esportazioni.** `GET /api/admin/emergencies/:id/segnalazioni.csv` e
`GET /api/admin/emergencies/:id/mappa.geojson` (`src/esportazioni.js`)
vogliono `emergenze.archivio` e un'emergenza chiusa (409 se è aperta). Il CSV
ha il BOM e il punto e virgola, come lo vuole Excel in italiano, e una cella
che comincia con `=`, `+`, `-` o `@` prende un apostrofo davanti perché Excel
non la esegua come formula. Il GeoJSON ha un punto per ogni segnalazione con
coordinate e le forme di `elementi_mappa` dell'emergenza, comprese quelle
tolte (con `rimosso_il`). Ogni scaricamento va nel registro come
`emergenza.esportata`. `npm run test:segnalazioni-nuove` prova tipo, vicine,
avvisi ed esportazioni.

### La qualifica di esterni e squadre

`users.qualifica` e `squadre.qualifica` (migrazione `qualifiche`) valgono uno
dei codici di `QUALIFICHE` in `src/costanti.js`, con un vincolo nel database,
oppure NULL: vuol dire del gruppo. `leggiQualifica()` tratta la stringa vuota
come NULL e risponde 400 a un codice sconosciuto. La qualifica di una persona
si scrive solo con il ruolo esterno (`POST` e `PUT /api/users`, che accettano
anche `ente`; per gli altri ruoli ente e qualifica tornano NULL) e negli
accessi temporanei (`POST /api/esterni-temporanei`, `PUT …/persona`); la
squadra nuova di un temporaneo prende la sua se `nuova_squadra.qualifica` non
dice altro. `PUT /api/squadre/:id` cambia la qualifica solo se il campo c'è,
così l'app e i client vecchi non la cancellano; la squadra COC resta sempre
del gruppo. Il trigger `assegnazione_nome_squadra` copia la qualifica in
`report_team_assignments` all'assegnazione, come nome e nome radio, e le
letture delle segnalazioni la riportano in `assigned_teams` anche dopo lo
scioglimento. `GET /api/qualifiche` dà codici e nomi; sigle e colori (fondo,
scritta, anello) stanno in `public/js/qualifiche.js` (e nell'app, solo le
sigle, in `Qualifiche` di `ModelliSquadre.kt`), che costruisce etichette,
cartellini e segnaposti con il DOM. Il segnaposto è il cerchio delle squadre
del gruppo con la lettera del nome radio, nel colore dell'ente e con
l'etichetta della sigla sotto. La Croce Rossa ha un codice suo (migrazione
`croce-rossa`, che allarga i due vincoli); prima stava con `sanitario`.
`npm run test:qualifiche` prova scelta, eredità, modifica e storico.

### Il caposquadra e la posizione delle squadre

Il caposquadra è un segno sul membro (`squadra_membri.caposquadra`), con un
indice unico parziale che ne ammette uno per squadra. Si nomina con
`PUT /api/squadre/:id/caposquadra` (`{ username }`, o `null` per toglierlo),
o con il campo `caposquadra` nella creazione e nella modifica della squadra;
una modifica che non lo nomina lascia quello di prima. Le nomine vanno nel
registro dell'emergenza (`caposquadra_nominato`, `caposquadra_tolto`) e nel
resoconto. `GET /api/squadre` restituisce il caposquadra e i membri con il telefono
dell'anagrafica solo se il modulo Segreteria è acceso e chi chiede non è un
esterno; il dettaglio della segnalazione prende da lì il caposquadra di ogni
squadra assegnata.

`POST /api/location` fa da arbitro fra i telefoni della stessa squadra, in
un'unica istruzione SQL: la posizione si scrive se arriva dal caposquadra, da
chi l'ha mandata l'ultima volta (`posizioni_squadre.inviata_da`), oppure se
quella registrata è più vecchia di `MINUTI_SUBENTRO` (tre minuti) o è di chi
non è più nella squadra. Altrimenti la risposta è 200 con `accettata: false`
e chi la sta mandando. L'app rimanda l'ultima posizione ogni minuto anche da
ferma, così il silenzio vuol dire davvero telefono spento o senza campo.
`GET /api/location` e il messaggio `team_location_update` dicono da quale
telefono arriva la posizione. Di ogni squadra si tiene solo l'ultima
posizione, e alla chiusura dell'emergenza `posizioni_squadre` si svuota nella
stessa transazione: dove sono stati i volontari non resta.

Dalla app 1.2.2 la posizione porta `eta_ms`, da quanti millisecondi il GPS
l'ha rilevata (con l'orologio monotono del telefono, così l'ora sbagliata del
telefono non conta). Il server la scrive con `last_update = NOW() - eta`
(al massimo un'ora indietro) e non la scrive se quella registrata è più
recente: una posizione rimasta indietro per un buco di rete arriva in sala
vecchia com'è e non copre una più nuova. Se la più recente è proprio di chi
manda, la risposta è `accettata: true, superata: true`. Senza `eta_ms` vale
adesso, come prima.

### La rete scarsa

Le scritture con l'intestazione `Idempotency-Key` passano da
`src/middleware/idempotenza.js`, montato su `/api/` dopo l'autenticazione
(il magazzino è escluso: gestisce la stessa tabella dentro le sue
transazioni). La chiave (da 8 a 100 caratteri fra lettere, cifre, `-` e
`_`) si prenota in `richieste_idempotenti` con la rotta e l'impronta del
corpo; la risposta si registra appena il gestore chiama `res.json`, anche se
chi l'ha chiesta ha già perso la connessione. Una richiesta ripetuta riceve
la risposta registrata con `Idempotent-Replayed: true`; una ancora in corso
riceve 409 con `in_corso: true` e `Retry-After`; la stessa chiave per una
richiesta diversa 422. Una risposta 5xx libera la chiave, e una rimasta in
corso più di due minuti (il server è caduto a metà) si considera
abbandonata. La pulizia settimanale del magazzino toglie anche queste
chiavi.

`PUT /api/reports/:id` accetta `stato_atteso`: se c'è un cambio di `status`
e lo stato attuale non è quello atteso (né già quello chiesto), risponde
409 con `conflitto: true` e `stato_attuale`, senza scrivere niente.

Il centro operativo carica `public/js/rete-scarsa.js` dopo `apiHelper.js`:
avvolge `fetchApi`. Le letture che la pagina elenca con
`OrionRete.salvaLetture()` si salvano in `localStorage` (al massimo 80
indirizzi, i più vecchi escono, legate all'utente e cancellate all'uscita)
e si restituiscono quando il server non risponde: errore di rete, 502, 503
senza manutenzione, 504, o niente risposta in 15 secondi. Le scritture
chiamate con l'opzione `coda: "descrizione"` partono con una chiave nuova;
se il server non risponde restano in `localStorage` (`orion.coda`) e
ripartono in ordine, con la stessa chiave, quando una prova su
`/api/emergencies/status` (ogni dieci secondi) torna a rispondere. Quello
che il server rifiuta va in `orion.coda.esiti` e resta nella fascia. Al
ritorno parte l'evento `orion:rete`, e il centro operativo rilegge stato,
squadre, segnalazioni ed eventi. Il WebSocket si riconnette con attese che
crescono fino a dieci secondi.

La cartografia del territorio è `src/cartografia.js`. Il file arriva a pezzi
da 16 MB (`POST /api/mappa/cartografia/pezzi?n=0,1,2…&id=…`, corpo
`application/octet-stream`, permesso `emergenze.piano`; il primo pezzo crea
l'id, un pezzo ripetuto si accetta senza sommarlo, uno fuori ordine dà 409),
così passa dal limite di 100 MB di nginx; il massimo è 4 GB
(`ORION_CARTOGRAFIA_MAX_MB`). `POST /api/mappa/cartografia/fine` controlla
il conto dei byte, apre il file con `node:sqlite` (serve Node 22.13 o più
recente), vuole le tabelle `tiles` e `metadata` e tasselli raster (PNG, JPG,
WEBP; i vettoriali pbf sono rifiutati), legge zoom, numero di tasselli,
`bounds` e attribuzione, e solo allora sostituisce il file di prima.
`GET /api/mappa/cartografia` dice se c'è e cosa contiene,
`GET /api/mappa/cartografia/:z/:x/:y` dà il tassello girando la riga (gli
MBTiles numerano dal basso, le mappe dall'alto) con una cache di una
settimana nel browser, `DELETE /api/mappa/cartografia` la toglie. I
tasselli non contano nei limiti di frequenza: una mappa a tutto schermo ne
chiede decine a ogni spostamento. `aggiungiCartografia()` in
`mappa-elementi.js` aggiunge il fondo alle mappe del centro operativo e del
copione e ci passa dopo quattro tasselli da internet falliti di fila.
`npm run test:rete` prova idempotenza, conflitti e età delle posizioni
(apre e chiude un'emergenza sua), `npm run test:cartografia` la cartografia
con un MBTiles costruito al momento (non tocca una cartografia già
caricata).

### Il bollettino di allerta

La fonte è il bollettino di criticità nazionale che il Dipartimento della
Protezione Civile pubblica ogni giorno (di norma entro le 16, con eventuali
aggiornamenti) nel repository
`pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica`, con licenza
CC-BY 4.0. È la sintesi delle valutazioni dei Centri Funzionali Decentrati,
quindi per ogni Regione riporta quelle del suo Centro Funzionale. Il server scarica
l'archivio dell'ultimo bollettino, `files/all/latest_all.zip`, con
`If-None-Match`: finché non cambia, la risposta è un 304 senza contenuto.

`src/bollettinoDpc.js` legge l'archivio senza dipendenze: lo zip, i due file
DBF degli attributi (`*_today.dbf` e `*_tomorrow.dbf`, con il codice della
zona in `Zona_all` e i tre rischi in testo, in latin1), l'ora di emissione dal
messaggio CAP e il PDF. `src/allerta.js` tiene una riga per versione in
`bollettini_allerta` (chiave: data e ora del file più il tipo, `first` o
`update`), con i livelli delle sole zone della Regione scelta, e il PDF in
`protected_uploads/bollettini/`, cifrato. Dei PDF restano gli ultimi tre; le
copie allegate alle emergenze stanno a parte, fra i loro documenti.

La zona viene dal comune scelto (`allerta_comune`) o, se vuoto, dal centro
della mappa (`map_center_lat`, `map_center_lon`), cercato nei confini delle
zone. Il catalogo delle zone di una Regione (codice, nome, comuni, confine
semplificato) sta in `src/dati/zone-allerta/<regione>.json` e si genera con

```
node scripts/zone-allerta.mjs veneto
```

dagli stessi dati aperti. Va rigenerato se la Regione ridisegna le zone (il
Veneto è passato da 8 a 25 zone). Ci sono tutte le Regioni dei dati del
Dipartimento: in `REGIONI` di `src/allertaRegioni.js` ognuna ha nome e
prefisso dei codici (`Lomb-`, `Tren-` per le due Province autonome, che nei
dati sono le due zone di una stessa voce). Nome dell'ente e pagina ufficiale
sono facoltativi e ci sono solo dove li si è letti dal sito della Regione
(oggi il Veneto): senza, la finestra del bollettino scrive "Centro Funzionale
competente" e non mostra il collegamento agli avvisi della Regione.

In diverse Regioni un comune diviso fra due bacini sta in più zone (Perugia,
Cagliari, Messina e una sessantina in Piemonte). `zonaDelComune()` sceglie
allora quella in cui cade il centro della mappa, o la prima se il centro è
fuori da tutte; `GET /api/allerta/regioni` manda `comuni_divisi` e le
Impostazioni dicono quale zona vale. Le prove (`tests/allerta.mjs`) cercano il
capoluogo di ogni Regione per nome e per coordinate e vogliono la stessa zona.

Con un'emergenza vera aperta, ogni versione nuova e quella in vigore
all'apertura entrano in `emergency_documents` (con `bollettino_id`, una volta
sola per emergenza, `uploader_user_id` vuoto: l'autore mostrato è "ORION") e
nel diario di sala, che è sigillato. Le simulazioni no. Chi ha
`emergenze.apertura` riceve la notifica `allerta_meteo` quando la zona arriva
al livello di `allerta_avvisa_da` (arancione se non scelto, `mai` la spegne):
sul telefono va nel canale degli avvisi personali, non in quello degli
interventi, e il tocco apre l'elenco delle notifiche.

Le rotte: `GET /api/allerta` (zona, giorni ancora validi, versioni degli
ultimi tre giorni o dall'apertura dell'emergenza), `GET
/api/allerta/bollettini/:id/pdf`, e per l'amministratore `GET
/api/allerta/regioni` e `POST /api/allerta/controlla`. Il WebSocket manda
`allerta_aggiornata` a ogni versione nuova.

### La squadra COC

`squadre.coc` segna la squadra della sala. L'apertura di un'emergenza la crea
se non c'è (`nome_radio` `COC`, nome "Sala operativa"); dopo il resoconto,
alla chiusura, `sciogliSquadraCoc()` scrive l'uscita dei membri nel registro
e la toglie, e `chiudiSquadreVuote()` non la tocca. Le rotte delle squadre
la mettono per prima in elenco, la escludono dalle disponibili, ne tengono il
nome nelle modifiche, saltano il controllo dell'idoneità e rispondono 409 a
chi la vuole eliminare a emergenza aperta. Assegnarla a una segnalazione dà
409, e `POST /api/location` di un suo membro risponde 409 con
`squadra_coc`: l'app non manda la posizione. Un esterno temporaneo può
starci, e da lì segue tutte le segnalazioni come gli interni. Il contesto
dell'app, a chi ne fa parte, dà la capacità `emergenza.sala` e la squadra con
`coc: true`.

## 9. Notifiche e tempo reale

Il WebSocket manda al web tutto quello che succede, perché in sala tutte le
postazioni devono vedere lo stesso quadro. L'app si presenta con
l'intestazione `X-Orion-Client: app` e riceve solo quello che riguarda la
persona e la sua squadra.

Le notifiche dell'app sono una coda per persona nel database, tabella
`notifiche`. Ogni notifica ha un tipo, una categoria (emergenza, personale,
segreteria, magazzino), un titolo pensato per la schermata di blocco (mai un
dato sanitario), un testo che si legge solo dentro l'app, un riferimento e,
se ha senso, una scadenza. Le notifiche scadute non si mostrano più e la
pulizia le cancella il giorno dopo; le lette si cancellano dopo 30 giorni, le
mai lette dopo 90. Una chiave unica per persona impedisce i doppioni.

Chi produce una notifica usa `notifica` o `notificaA` di `appMobile.js`;
chi deve toglierla perché ha perso significato usa `scadi`, per tipo, per
categoria, per riferimento o per persona. Chi produce cosa si legge in
`CATEGORIA_DEL_TIPO` di `appMobile.js`, che elenca tutti i tipi.

Gli avvisi della sala (`src/avvisiSala.js`, tipo `avviso_sala`, categoria
emergenza) vanno a chi ha `emergenze.apertura`, non è temporaneo e non ha
spento `users.avvisi_sala` (`GET` e `PUT /api/users/me/avvisi-sala`, il
secondo solo con quel permesso). Partono per una segnalazione nuova ad alta
priorità (non a chi l'ha creata), per una segnalazione senza squadra oltre i
minuti critici e per una squadra entrata in una zona interdetta. La chiave
(`alta:`, `ritardo:`, `zona:` con l'id) fa arrivare ogni fatto una volta sola.

L'app riceve le notifiche dal WebSocket della sessione quando è aperta. Ad
app chiusa le riceve con il token degli avvisi (`src/avvisi.js`, tabella
`token_avvisi`): il telefono lo chiede con la sessione (`POST /api/app/avvisi`),
il server ne conserva solo l'impronta, e vale solo per leggere la propria
coda (`GET /api/avvisi/notifiche`, con `Authorization: Avvisi <token>`) e per
restare in ascolto sul WebSocket, dal quale passano allora solo le notifiche.
Dura `GIORNI_AVVISI` (180) dall'ultimo uso, mentre la sessione dura un giorno
e per rinnovarla serve l'impronta: prima, un giorno dopo l'ultimo accesso il
controllo in background trovava la sessione scaduta e le notifiche smettevano
di arrivare. Il token si revoca con l'uscita dall'app (`DELETE /api/app/avvisi`),
con `chiudiSessioni` (cambio password) e con la sospensione o l'eliminazione
della persona; al massimo tre per persona.

Sul telefono il servizio "Avvisi attivi" (servizio in primo piano di tipo
`specialUse`, con la notifica fissa sul canale di importanza minima) tiene il
collegamento aperto anche ad app chiusa, riparte dopo un riavvio e dopo un
aggiornamento e si riapre quando torna la rete. Il server manda ai
collegamenti degli avvisi un ping ogni due minuti, che tiene aperta la strada
nella rete mobile e fa cadere quelli morti. Il servizio è acceso di base; chi
lo spegne resta con il controllo periodico di WorkManager (60 minuti, 15 in
emergenza, che Android può rimandare anche di ore), che legge la coda con lo
stesso token. Di base niente Firebase né altri servizi esterni.

### Le notifiche Firebase, facoltative

Un'associazione può scegliere Firebase Cloud Messaging con un suo progetto
Firebase: niente notifica fissa sul telefono e avvisi puntuali anche sui
telefoni che chiudono le app in background. Non c'è un progetto comune: ogni
associazione crea il suo, e senza configurazione non cambia niente. Nell'APK
non c'è `google-services.json`: l'app è la stessa per tutti.

L'amministratore carica dalla pagina Sistema due file del progetto:
`google-services.json`, da cui il server prende gli identificativi pubblici
dell'app `it.orion.app` (progetto, `app_id`, chiave API, numero del
mittente), e la chiave dell'account di servizio, che resta sul server cifrata
con la chiave dei dati (`branding_settings`, chiavi `firebase_app` e
`firebase_account`, fuori dalle impostazioni generali). Prima di salvare, il
server chiede a Google un token di accesso con quella chiave: una chiave che
non funziona non si salva. Il codice è in `src/firebase.js`, senza
dipendenze: il JWT firmato RS256 per l'OAuth e la chiamata a FCM HTTP v1.

| Rotta | Chi | Cosa fa |
|---|---|---|
| `GET /api/avvisi/configurazione` | telefono, token degli avvisi | Gli identificativi pubblici, o `null` se Firebase è spento |
| `PUT /api/avvisi/firebase` | telefono, token degli avvisi | Registra l'identificativo Firebase del telefono (`token`, `progetto`), o lo toglie con `token: null`; 409 se il progetto è cambiato |
| `GET /api/admin/firebase` | amministratore | Stato: progetto, account, telefoni registrati, ultimo segnale, ultimo errore |
| `PUT /api/admin/firebase` | amministratore | Attiva o sostituisce: `{ google_services, account }` |
| `DELETE /api/admin/firebase` | amministratore | Spegne Firebase e dimentica i telefoni registrati |

L'identificativo Firebase sta accanto al token degli avvisi
(`token_avvisi.fcm_token`, `fcm_progetto`, `fcm_il`), quindi si revoca con lui.
A ogni notifica `consegna` chiama `svegliaTelefoni`: se Firebase è configurato,
il server manda ai telefoni registrati della persona un messaggio di soli dati,
`{ orion: "novita" }`, ad alta priorità e con `collapse_key`, raggruppando le
notifiche ravvicinate in un segnale solo. A Google non va il contenuto: il
telefono si sveglia e legge la coda dal server col token degli avvisi. Gli
identificativi che Google dice non più registrati si tolgono da soli.

Sul telefono `FirebaseAvvisi` legge la configurazione dal server, avvia
Firebase a mano con quegli identificativi (`FirebaseOptions`, il provider di
avvio automatico è tolto dal manifesto), registra l'identificativo e allora
spegne il servizio "Avvisi attivi". Si torna al collegamento di sempre quando
Firebase è spento sul server, quando il telefono non ha Google Play e quando la
registrazione non riesce. Prima di spegnere o cambiare progetto il server manda
`{ orion: "configurazione" }` ai telefoni registrati e
`avvisi_configurazione` a quelli in ascolto: rileggono la configurazione
subito. Il controllo periodico la ricontrolla comunque ogni sei ore.

Lo stesso nome di pacchetto `it.orion.app` va registrato nel progetto di ogni
associazione: per la sola messaggistica Firebase non chiede il certificato di
firma. La versione di prova (`it.orion.app.dev`) va aggiunta al progetto come
seconda app, se la si vuole provare con Firebase. `npm run test:firebase`
prova tutto contro un Google finto (`tests/google-finto.mjs`): il server va
avviato con `ORION_GOOGLE_TOKEN_URL=http://127.0.0.1:3098/token` e
`ORION_FCM_URL=http://127.0.0.1:3098`.

`GET /api/app/avvisi/stato` dice alla persona come il server vede i suoi
telefoni; `GET /api/avvisi/telefoni` lo dice per tutti agli operatori interni
(la gestione utenti mostra il telefono verde se è in ascolto adesso o
registrato su Firebase);
`POST /api/notifiche/prova` con `{ ritardo }` (fino a 120 secondi) manda a sé
stessi una notifica di prova. `npm run test:avvisi` prova il token, le
revoche, il collegamento e la prova.

Le email restano per quello che hanno sempre fatto: attivazione e recupero
password, avvisi di scadenza ai volontari, report mensile, avvisi del
magazzino a chi li ha chiesti.


### Orion Voice

La voce è un modulo che si accende dalle impostazioni (`voce_enabled`) ed
esiste solo a emergenza aperta, simulazioni comprese. Vive in `src/voce.js`,
con i canali in `src/voceCanali.js`, la parola in `src/voceParola.js` e il
contenitore audio in `src/voceOgg.js`. Non passa da servizi esterni e il
server non decodifica l'audio: telefono e browser mandano pacchetti Opus già
pronti (mono, 16 kHz, pacchetti da 40 a 60 ms), il server li inoltra a chi
ascolta e alla fine li mette in un file Ogg Opus, che il browser riproduce
così com'è.

I canali non sono una tabella: si ricavano a ogni controllo da squadre,
caposquadra, squadra COC e permessi. "Sala" vuol dire i membri della squadra
COC; "chi coordina" chi ha il permesso `emergenze.apertura`.

| Canale | Chi ascolta | Chi parla |
|---|---|---|
| `squadra:<id>` | i membri della squadra e la sala | gli stessi, la sala con precedenza |
| `generale` | tutti quelli che hanno un canale | sala, chi coordina, capisquadra |
| `avvisi` | tutti quelli che hanno un canale | sala e chi coordina, sempre in priorità alta |
| `diretto:<persona>` | la persona, la sala, chi coordina | gli stessi; lo aprono sala e chi coordina |

Il volontario ha quindi un solo canale su cui parlare, la sua squadra, e
ascolta il generale e gli avvisi: quello che la sala dice a tutte le squadre
arriva anche a lui, mentre a parlarci sono pochi, così il generale non
diventa il traffico di tutte le squadre. Una squadra senza caposquadra parla
con la sala dal suo canale: per farla parlare sul generale basta nominare il
caposquadra dal centro operativo. Le priorità sono tre: normale, alta (sala
e chi coordina) ed emergenza (chiunque, sopra tutto, anche chi sul canale
della squadra ascolta soltanto; sul generale e sugli avvisi no, perché
arriverebbe a tutti).

Su un canale parla una persona alla volta, come in radio. Chi ha la parola
vive in memoria: se il server riparte, tutti i canali ripartono liberi. La
sala prende la parola anche a canale occupato, l'emergenza la prende sempre;
chi viene interrotto riceve `interrotto` e il suo messaggio resta salvato
come interrotto. Un messaggio dura al massimo 60 secondi, sotto il mezzo
secondo non si salva, e una persona ne salva al massimo 30 al minuto (i tocchi
a vuoto, i canali occupati e i messaggi annullati non contano).

Il collegamento è un WebSocket suo, `/voce`, distinto da quello del tempo
reale, che va solo dal server ai client e ha messaggi di 4 KB al massimo. Il
web entra con la sessione (cookie), il telefono con il token voce:
`POST /api/voce/token` con la sessione, poi `Authorization: Voce <token>`. Il
token vale per l'emergenza in corso e per nient'altro, non scade con la
sessione (che dura un giorno e si rinnova con l'impronta, cosa che con il
telefono in tasca non succede) e cade con la chiusura dell'emergenza, con
`chiudiSessioni` e con la sospensione della persona. Un telefono per persona:
il secondo fa uscire il primo con `chiuso`/`altro_telefono`; le postazioni
web non hanno limite. Il server manda un ping ogni 25 secondi, perché Nginx
chiude dopo 60 secondi un collegamento muto: così la configurazione delle
istanze già installate non va toccata. Ogni 3 secondi ricontrolla tutti i
collegati con una lettura sola: chi è uscito dalla squadra perde il canale
(e se stava parlando il messaggio si chiude), chi è sospeso o ha la sessione
chiusa viene scollegato, alla chiusura dell'emergenza o allo spegnimento del
modulo escono tutti.

I comandi viaggiano come testo JSON con il campo `t`, l'audio come trame
binarie. Dal client al server una trama è il numero del pacchetto (2 byte)
seguito dal pacchetto Opus; dal server a chi ascolta è il numero del
messaggio (4 byte), il numero del pacchetto (2 byte) e il pacchetto.

| Dal client | Risposta | Cosa fa |
|---|---|---|
| `parla` (`uuid`, `canale`, `priorita`, `differito`, `eta_ms`) | `parla_ok` con `ricevuti`, oppure `occupato` con chi parla, oppure `negato` con `motivo` | chiede la parola; con lo stesso `uuid` riprende un messaggio interrotto dalla rete |
| `fine` (`uuid`, `pacchetti`) | `salvato`, `annullato` o `manca` | chiude il messaggio |
| `annulla` (`uuid`) | `annullato` | il dito trascinato fuori dal tasto |
| `ascoltato` (`id`, `in_diretta`) | | dalla sala vale come "riprodotto in sala" |
| `ricevuto` (`id`) | | la conferma esplicita della sala |
| `ciao` (`ultimo`) | `persi` | i messaggi arrivati mentre il client era scollegato |
| `cuffie` (`canali`) | | i canali che una postazione di sala ascolta, per "nessuna postazione ascolta" |

Dal server arrivano anche `stato` all'apertura, `canali` quando cambiano,
`parola` con chi sta parlando, `inizio` e `fine` di un messaggio in diretta,
`messaggio` per uno arrivato in differita, `riprodotto` e `ricevuto` per le
conferme, `presenze` alla sala (per ogni canale quanti telefoni hanno la voce
accesa e quante postazioni lo ascoltano), `presa_in_carico` quando la sala
prende un'emergenza e `chiuso` prima di uno scollegamento voluto. Un messaggio
di emergenza può portare `posizione` (`lat`, `lon`); senza, la sala vede
l'ultima posizione della squadra.

Il messaggio è identificato dall'`uuid` che sceglie il telefono, così un invio
ripetuto dopo una caduta non lo duplica. Se la rete cade a metà frase il
canale torna libero (anche quando il collegamento non si chiude: il telefono
manda un pacchetto ogni 60 ms anche nelle pause, e cinque secondi senza audio
bastano, invece del minuto che servirebbe al ping per accorgersene), chi ascolta riceve `fine` con stato `in_ritardo`, e il
server tiene il messaggio aperto per dieci minuti: il telefono si ricollega,
ripete `parla` con lo stesso `uuid`, il server risponde con quanti pacchetti
ha già e il resto arriva come `messaggio`. Passati dieci minuti si salva
quello che c'è. Un messaggio registrato senza rete parte con
`differito: true` e con `eta_ms`, da quanto tempo è stato registrato secondo
l'orologio che non salta del telefono (lo stesso criterio delle posizioni):
non chiede la parola e arriva intero, con l'ora vera.

L'audio sta in `protected_uploads/voce/<emergenza>/<uuid>.ogg`, cifrato con
la chiave dell'istanza come gli altri file (senza chiave resta in chiaro e lo
cifra il giro orario), entra nei backup con il resto e si cancella quando si
elimina l'emergenza. Le tabelle sono `voce_messaggi` (con una copia del nome
radio e del nome di chi parla, perché squadre e persone possono sparire),
`voce_ascolti`, `voce_diretti` e `token_voce`. Un messaggio di squadra si
lega alla segnalazione a cui la squadra era assegnata quando è iniziato e
finisce nel suo diario come nota con `voce_id`; il testo della nota
("Messaggio vocale da Alfa, 12 s") lo leggono anche le app vecchie, la stampa
e il resoconto. Gli avvisi a tutti e i messaggi di emergenza finiscono nel
diario di sala.

Le rotte HTTP: `GET /api/voce/stato` (canali e ruolo di chi chiede),
`GET /api/voce/messaggi` (cronologia dei propri canali, a pagine con
`prima`), `GET /api/voce/messaggi/:id/audio` (il file; di un'emergenza
archiviata solo con `emergenze.archivio`, e l'ascolto finisce nel registro
delle operazioni), `POST /api/voce/messaggi/:id/ascolto` e `/ricevuto`,
`POST /api/voce/diretti` (con `user_id` o `username`) e
`DELETE /api/voce/diretti/:persona`, `GET /api/voce/emergenze` (le emergenze
non ancora prese in carico, con il telefono se la Segreteria è accesa, la
stessa regola dei membri delle squadre), `POST /api/voce/messaggi/:id/presa-in-carico`,
`POST /api/voce/messaggi/:id/segnalazione` (sposta un messaggio su un'altra
segnalazione: le note non si cambiano, se ne scrive una in tutte e due),
`GET /api/voce/archivio/:emergenza` (con `emergenze.archivio`) e
`GET /api/voce/statistiche` (per la pagina Sistema: ritardo medio e al
novantesimo percentile, messaggi in differita, collegati). Il ritardo di un
messaggio in diretta è quanto l'ultimo pacchetto arriva dopo la fine del
parlato; i messaggi ripresi o registrati senza rete si contano a parte. Un
esterno temporaneo sente solo i messaggi arrivati da quando è entrato in
squadra, e parla solo se nella creazione dell'accesso è rimasta la casella
"Può parlare" (`users.voce_parla`). Il contesto dell'app porta `moduli.voce` e
la capacità `voce`; il resoconto ha la sezione "Comunicazioni vocali".

Nel web la voce vive in `public/js/voce-co.js` (pannello, barra delle
squadre, tasti, emergenza), `public/js/voce-audio.js` (microfono, codifica,
riproduzione, toni), `public/js/voce-cattura.js` (l'AudioWorklet che porta il
microfono a 16 kHz) e `public/css/voce.css`; `centro-operativo.js` ha solo gli
agganci `window.voceSala` e `window.orionCentro`. Codifica e decodifica le fa
il browser con WebCodecs (Opus a 16 kHz, pacchetti da 60 ms, circa 20
kbit/s); il microfono si cattura alla frequenza della scheda audio perché
Firefox non collega il microfono a un contesto audio con una frequenza
diversa. Un browser senza `AudioEncoder` ascolta soltanto, e senza
`AudioDecoder` sente i messaggi a fine trasmissione, dal file. La
riproduzione è una coda: una voce alla volta, con un margine di 350 ms contro
i salti della rete, alta priorità ed emergenza davanti; mentre la postazione
parla la coda aspetta. Il microfono si apre alla pressione e si chiude al
rilascio; la richiesta della parola parte insieme all'apertura, e i pacchetti
registrati prima del sì partono subito dopo. Il rilascio si ascolta sul
documento e alla perdita del fuoco della finestra: il pannello si ridisegna
mentre si tiene premuto, e senza questo il messaggio andrebbe avanti fino al
minuto. Le cuffie spente valgono per la postazione e stanno nel browser; il
tasto per parlare è uno per tutti, l'impostazione `voce_tasto` (F9), e parla
sull'ultimo canale usato con PARLA. Per
chi è in sala (squadra COC o permesso `emergenze.apertura`) il pannello è
fisso: la classe `voce-fissa` sul corpo della pagina toglie linguetta e
chiusura e sposta la colonna degli eventi alla sua sinistra; per gli altri il
pannello si apre al posto degli eventi.

La trascrizione sta in `src/voceTrascrizione.js` e usa whisper.cpp. Non lo
compila chi costruisce ORION: `docker/whisper.Dockerfile` lo compila una volta
per versione nell'immagine `ghcr.io/ip-conflict/orion-whisper`, che contiene
solo i suoi file, e il Dockerfile di ORION li copia da lì
(`ARG WHISPER_IMMAGINE`). La pubblica il workflow "Whisper", da solo quando
`docker/whisper.Dockerfile` cambia su `master` oppure a mano; il pacchetto va
lasciato pubblico, perché i server lo scaricano senza credenziali. Per una
versione nuova di whisper.cpp si cambiano versione e commit in
`docker/whisper.Dockerfile` e il nome in `WHISPER_IMMAGINE`. Il workflow non
guarda il resto del codice, quindi può girare anche da un repository che ha
soltanto questi due file. Senza accesso al registro
l'immagine si costruisce in locale, `sudo docker build -f
docker/whisper.Dockerfile -t localhost/orion-whisper:v1.9.5 docker`, e poi
ORION con `--build-arg WHISPER_IMMAGINE=localhost/orion-whisper:v1.9.5`: su
due processori sono alcuni minuti, una volta sola.

whisper.cpp è fissato a una versione e a un commit, senza OpenMP e con tre
varianti per i processori x86 caricate all'avvio (`GGML_BACKEND_DL`): x86-64
di base, AVX2 e AVX-512, così la stessa immagine va su ogni macchina e usa il
meglio che trova. whisper.cpp ne compila quattordici; le altre undici si
tolgono dal suo `CMakeLists.txt` perché quintuplicavano il tempo di
compilazione per pochi punti di velocità. I compilatori in parallelo sono
quanti ne regge la memoria libera (circa 700 MB ciascuno), così un server
piccolo non va in swap. Il programma sta in `/opt/whisper`, circa 21 MB; `ORION_WHISPER` ne indica un altro, ed è così
che le prove usano `tests/whisper-finto.sh`. I modelli non sono
nell'immagine: l'amministratore ne sceglie uno (`POST /api/voce/trascrizione`,
impostazione `voce_trascrizione`), il server lo scarica da Hugging Face in
`<dati>/modelli` controllando prima lo spazio libero e poi l'impronta SHA-1
pubblicata da whisper.cpp, e un file diverso non si usa. `ORION_MODELLI_ORIGINE`
cambia l'indirizzo, per un'istanza senza accesso a internet che li tiene su
un server suo.

| Modello | File | Disco | Memoria circa |
|---|---|---|---|
| Veloce | `ggml-base.bin` | 142 MB | 400 MB |
| Equilibrata | `ggml-small.bin` | 466 MB | 900 MB |
| Accurata | `ggml-large-v3-turbo-q5_0.bin` | 547 MB | 1,3 GB |

Il limite di memoria del container (`ORION_MEMORIA`, di base 1 GB) vale anche
per la trascrizione, che gira nello stesso container: con "Equilibrata" o
"Accurata" va alzato, dalla pagina Sistema (riquadro "Memoria di ORION", che
accanto a ogni valore dice quali modelli ci stanno) o con `sudo orion-agente
memoria <istanza> <MB>`. A mano, scrivendo `ORION_MEMORIA` nel `.env`, il valore
vale solo dopo `docker compose -f /srv/orion/<istanza>/compose.yaml up -d`, e
l'agente non controlla che ci stia. Il server legge il limite dal cgroup
(`memory.max`), toglie quanto occupa già Node e rifiuta con 409 un modello
che non ci sta: senza, whisper veniva ucciso a ogni messaggio. Un messaggio
salvato entra in una coda in memoria, uno alla volta: il server ricava il WAV a 16 kHz dai pacchetti Opus con
`opus-decoder` (WebAssembly, in `src/voceOgg.js`), lancia `whisper-cli` con
priorità bassa, lingua italiana, i nomi radio delle squadre come
suggerimento e un core lasciato libero, e scrive il testo in
`voce_messaggi.trascrizione` con lo stato (`fatta`, `vuota`, `errore`) e il
tempo impiegato. Chi ascolta il canale riceve `trascritto` (`id`, `testo`).
Il testo non entra nella nota del diario, che è storico inalterabile: la
rotta della segnalazione lo porta accanto, come `voce_trascrizione`, e lo
mostrano diario, stampa, archivio e resoconto. Dopo un riavvio, o quando si
accende la trascrizione, il server riprende i messaggi dell'ultimo giorno
non ancora trascritti. Cambiare modello svuota la coda, ferma il messaggio in
lavoro e riprende quelli dell'ultimo giorno, compresi quelli finiti in
`errore`; l'ultimo errore compare nello stato (`ultimo_errore`) finché un
messaggio non va a buon fine. La colonna generata `ricerca` (tsvector italiano) con
il suo indice GIN serve la ricerca: `q` su `GET /api/voce/messaggi` e su
`/api/voce/archivio/:emergenza` trova le parole intere con le loro varianti
("motopompe" trova "motopompa") e, con un confronto semplice, pezzi di parola
e nomi. `GET /api/voce/trascrizione` dà lo stato per la pagina delle
impostazioni, con il rapporto fra tempo di calcolo e durata della voce.


### Il drone

Il drone trasmette a MediaMTX, un programma libero che riceve video in
diretta e lo ridistribuisce senza ricodificarlo, in un container accanto a
ORION. Il percorso è questo: il drone manda il video al radiocomando, l'app
di volo (DJI Pilot 2 sul Matrice 4E) lo invia in RTMP all'indirizzo
`rtmp://<dominio>/drone/<chiave>`, MediaMTX lo riceve e lo registra, la sala
lo guarda in WebRTC con un ritardo di circa un secondo. Chi può trasmettere e
chi può guardare lo decide ORION: MediaMTX, prima di accettare una
connessione, chiama `POST /api/drone/autorizza?s=<segreto>` (fuori
dall'accesso, prima dei limiti per rete, con il segreto dell'istanza
confrontato in tempo costante).

**Le chiavi.** `POST /api/drone/chiavi` (permesso `emergenze.apertura`, con
un'emergenza o una simulazione aperta) crea una chiave casuale di 32
caratteri, la restituisce una volta sola con l'indirizzo completo e il QR, e
nel database (`chiavi_drone`, migrazione `drone`) tiene l'impronta SHA-256
per riconoscerla e la chiave cifrata per costruire l'indirizzo della
diretta. MediaMTX accetta chi trasmette solo in RTMP o SRT, una volta sola per chiave
(`overridePublisher: no`, e ORION rifiuta una chiave già in onda), con una chiave
non revocata dell'emergenza in corso: chiusa l'emergenza, le sue chiavi non
valgono più e chi stava trasmettendo viene staccato
(`chiudiDiretteEmergenza()`, che usa l'API di MediaMTX); `DELETE
/api/drone/chiavi/:id` toglie una chiave e stacca subito il pilota.
`GET /api/drone/dirette` elenca le chiavi dell'emergenza con lo stato in onda,
letto dall'API di MediaMTX, senza mai riportare chiave o impronta. Ogni dieci
secondi il server confronta le dirette in corso e, se cambiano, manda
`reload_drone` alle postazioni.

**La visione.** Il browser non parla con MediaMTX: manda la sua proposta
WebRTC (WHEP, senza trickle ICE) a `POST /api/drone/dirette/:id/whep`, ORION
controlla la sessione (interni, non esterni) e la gira a MediaMTX con le sue
credenziali (`orion` e il segreto), che MediaMTX accetta come unico
spettatore. La sessione WHEP torna al browser come
`/api/drone/sessioni/<uuid>`, chiudibile solo da chi l'ha aperta. Così la
chiave non arriva mai al browser e chi conosce l'indirizzo di MediaMTX non
guarda niente. Il video passa invece direttamente fra il browser e MediaMTX,
sulla porta UDP di WebRTC annunciata con il dominio dell'istanza
(`webrtcAdditionalHosts`). Ogni diretta guardata, nel pannello o in una
finestra staccata (`drone-co.js`), è una sessione WHEP sua, che si chiude
quando la si smette di guardare o il drone esce di onda.

**L'app.** L'app non usa WebRTC ma HLS: MediaMTX produce lo stesso video in
LL-HLS (`hls: yes` in `mediamtx.yml`, porta 8888 solo nella rete dei
container, `ORION_DRONE_HLS`) e ORION lo gira all'app da `GET
/api/drone/dirette/:id/hls/:file`, con le credenziali di MediaMTX come per il
WHEP. Così passa dalla 443 con la sessione dell'app, senza porte né UDP in
più, al prezzo di due o tre secondi di ritardo. I pezzi del video non contano
nel limite di richieste per persona (`rateLimiters.js`), e a MediaMTX arrivano
solo i parametri di LL-HLS della query. Il nome del file è controllato
(niente barre né `..`) e la decisione su chi guarda si tiene dieci secondi,
perché i pezzi arrivano ogni secondo. `GET /api/app/drone` dà all'app i droni
che quella persona può vedere, con lo stato in onda, la squadra e il pilota,
mai la chiave. La regola vale per le richieste con `X-Orion-Client: app`, sia
HLS sia WHEP: vedono tutto chi ha `emergenze.apertura`, chi è nella squadra
COC e i caposquadra; gli altri solo il drone della loro squadra. Dal web resta
la regola di prima, ogni interno, perché il centro operativo lo apre ogni
interno. La squadra del drone sta in `chiavi_drone` (migrazione
`drone-squadra`): `pilota_id` e, solo senza pilota, `squadra_id`; con il
pilota conta la squadra in cui si trova lui in quel momento. Si scelgono alla
creazione della chiave (`pilota_id`, o `pilota` come nome utente, e
`squadra_id`) e si cambiano con `PATCH /api/drone/chiavi/:id`, solo con
`emergenze.apertura`. Nell'app la capacità `drone` c'è a modulo acceso,
emergenza aperta e per chi è in una squadra, in sala o apre le emergenze; il
lettore è Media3 (ExoPlayer) con lo stesso client OkHttp delle altre
richieste, quindi token e `X-Orion-Client` arrivano anche ai pezzi del
video. Lo schermo a parete apre da solo il primo drone in
onda in un riquadro.

**Le registrazioni.** MediaMTX registra ogni diretta in spezzoni MP4 da un
minuto (`recordSegmentDuration`) in `drone/registrazioni/drone/<chiave>/`.
Ogni 20 secondi (`ORION_DRONE_RACCOLTA_MS`) `raccogliRegistrazioni()` prende
gli spezzoni in cui MediaMTX non scrive più da 20 secondi
(`ORION_DRONE_RIPOSO_MS`): un minuto di volo si rivede circa un minuto e mezzo
dopo. Li cifra in flusso (AES-256-GCM, come gli altri file) in
`protected_uploads/drone/<emergenza>/`, li registra in `registrazioni_drone`
e cancella l'originale; senza la chiave dei dati li lascia dove sono e
riprova. Uno spezzone di una chiave che ORION non conosce più si cancella.
Le riprese si vedono già durante l'emergenza: `GET
/api/drone/dirette/:id/registrazioni` dà gli spezzoni del volo di un drone
dell'emergenza in corso, anche a chiave tolta, e il pannello Drone e l'app
li fanno scorrere di seguito come un video solo (`DroneVideo.rivedi` in
`drone-video.js`, la playlist di Media3 nell'app), con una barra per tutto il
volo e l'ora vera; in fondo chiedono se ne sono arrivati altri. Dopo, si
rivedono dall'archivio (`GET /api/drone/registrazioni`, raggruppate per
drone) con lo stesso lettore. Valgono le regole dell'emergenza: durante
l'emergenza gli interni, dopo chi ha `emergenze.archivio`; dall'app, anche
per le registrazioni, la regola di chi vede quale drone. `…/:id/file`
decifra al volo mentre manda, quindi un file alterato si interrompe a metà
invece di non partire, e accetta le richieste `Range`, che il lettore usa per
saltare avanti e indietro: il file è cifrato in un flusso solo, quindi si
decifra dall'inizio e si scarta quello che viene prima, un costo da poco per
un minuto di video. Ogni scaricamento va nel registro delle operazioni, e
anche la visione, una volta ogni mezz'ora per persona e drone, perché
rivedere un volo sono decine di richieste. Le riprese entrano nei backup e si
cancellano con l'emergenza.

**Installazione.** Il drone si installa in tre modi, che fanno la stessa cosa
con lo stesso script. Alla creazione dell'istanza, con `--drone` in fondo a
`nuova-istanza.sh`. Dalla pagina, in Impostazioni, Moduli, Drone: se MediaMTX
manca, l'amministratore conferma con la sua password e la richiesta va
all'agente (`POST /api/sistema/drone/installa`, tipo `drone`), con le stesse
regole degli aggiornamenti (automatici, con approvazione di chi gestisce il
server, bloccati) e mai a emergenza aperta, perché ORION si riavvia. L'agente
(versione 3) prende `compose.yaml` e `mediamtx.yml` dall'immagine in
servizio, così sono della versione dell'istanza, e lancia
`orion-attiva-drone`; se non riesce rimette il `compose.yaml` di prima, toglie
`COMPOSE_PROFILES=drone` e ferma MediaMTX. La pagina mostra i passi e, alla
fine, le porte da inoltrare sul router, che restano a mano. Un agente più
vecchio non lo sa fare: la pagina chiede di rilanciare `prepara-host.sh`.
Oppure a mano, sull'host, dopo aver creato l'istanza:

```
sudo scripts/docker/attiva-drone.sh <nome> [porta-rtmp] [porta-webrtc]
```

Lo script copia `compose.yaml` e `mediamtx.yml` nella cartella dell'istanza,
crea `drone/registrazioni` dell'utente dell'istanza, scrive nel `.env`
`COMPOSE_PROFILES=drone`, il segreto (`ORION_DRONE_SEGRETO`), il dominio e le
porte, apre nel firewall la porta RTMP (TCP) e quella di WebRTC (UDP) e avvia
il container `drone`. Le porte si possono dare a mano; se mancano, lo script
tiene quelle che l'istanza ha già, oppure prende le prime libere partendo da
1935 e 8189, saltando quelle del drone di altre istanze e quelle su cui
qualcosa sull'host è già in ascolto (per saperlo usa `ss`, del pacchetto
iproute2). Così più istanze sullo stesso host ricevono 1935 e 8189, poi 1936
e 8190, e via così; il messaggio finale dice quali porte ha scelto. Le porte
sono due per istanza qualunque sia il numero di droni: MediaMTX riceve tutti
i piloti sulla stessa porta RTMP, distinti dalla chiave nell'indirizzo, e
manda tutte le dirette WebRTC dalla stessa porta UDP. Le porte riservate
stanno nel `.env` di ogni istanza (`ORION_DRONE_PORTA_RTMP`,
`ORION_DRONE_PORTA_WEBRTC`), ed è lì che lo script guarda quelle delle
altre; `sudo scripts/docker/attiva-drone.sh --elenco` le mostra tutte, per
sapere cosa aprire sul router. Per cambiarle si rilancia lo script con le
porte nuove: rifiuta quelle di un'altra istanza e quelle già in ascolto
sull'host, toglie dal firewall le vecchie regole e ricorda di chiudere le
vecchie porte sul router e di ridare al pilota l'indirizzo, che contiene la
porta RTMP quando non è 1935. Il container gira con
l'utente dell'istanza, il file system in sola lettura e nessun privilegio;
l'API (9997) e il WHEP (8889) restano nella rete dei container. Se il
server sta dietro un router, le due porte vanno inoltrate al server. Poi si
accende il modulo in Impostazioni, Moduli, Drone: la pagina dice se MediaMTX
non è configurato e mostra le porte dell'istanza (`GET /api/drone/stato`, che
le legge da `ORION_DRONE_RTMP_PORTA` e `ORION_DRONE_WEBRTC_PORTA`) e il numero
massimo di droni in onda insieme (`drone_max_dirette`, da 1 a 20, di serie
3). Il massimo protegge la banda della connessione, circa 4 Mbit/s in
ingresso per drone: quando MediaMTX chiede se un pilota può trasmettere e ce
ne sono già tanti in onda (lui escluso, se si sta ricollegando), ORION
risponde di no, lo scrive nel registro (`drone.respinto`) e il pannello della
sala dice chi è stato respinto e perché. Se in quel momento l'API di MediaMTX
non risponde, il pilota passa: il limite è sulla banda, non sull'accesso. Fuori dai container le variabili sono `ORION_DRONE_SEGRETO`
(almeno 16 caratteri, senza il modulo non parte), `ORION_DRONE_API` e
`ORION_DRONE_WEBRTC` (di serie `http://drone:9997` e `http://drone:8889`),
`ORION_DRONE_HOST` e `ORION_DRONE_RTMP_PORTA` per l'indirizzo dato al
pilota, `ORION_DRONE_WEBRTC_PORTA` per mostrare la porta UDP nelle Impostazioni,
`ORION_DRONE_CONTROLLO_MS` per ogni quanto il server guarda chi è in onda
(di serie 10 secondi; le prove lo accorciano), `ORION_DRONE_REGISTRAZIONI` per la cartella degli spezzoni.

**Il Matrice 4E.** In DJI Pilot 2: Diretta (Live Stream), RTMP
personalizzato, l'indirizzo completo dato da ORION (o inquadrato dal QR). Il
video va in H.264, perché H.265 molti browser non lo mostrano, a 720p o
1080p, con 2-4 Mbit/s: il radiocomando deve avere una SIM dati o il
collegamento a un hotspot.

`npm run test:drone` prova chiavi, autorizzazioni, visione, sessioni,
raccolta, cifratura e permessi con un MediaMTX finto
(`tests/mediamtx-finto.mjs`), che però non manda video.

**Provare senza volare.** Con MediaMTX vero sul server, una diretta si
simula in tre modi, tutti con una chiave data dal pannello Drone come per un
pilota vero, quindi con autorizzazione, pannello, parete e registrazione
nell'archivio come in emergenza. Dal computer, `scripts/drone-finto.sh
<indirizzo completo> [video] [minuti]` manda con `ffmpeg` quello che manda
DJI Pilot 2: video H.264 a 720p e 30 fotogrammi, senza B-frame, 3 Mbit/s,
un fotogramma chiave ogni due secondi, audio AAC muto. Senza video manda
l'immagine di prova con l'orologio, che fa vedere a occhio il ritardo della
sala; con un video, per esempio una ripresa scaricata dall'archivio, lo
ripete finché non si ferma con Ctrl+C. Dal telefono, un'app che trasmette in
RTMP (Larix Broadcaster, gratuita per Android e iPhone) con l'indirizzo
completo come destinazione prova anche la rete mobile, come il radiocomando
con la SIM; va impostata in H.264, 720p, 2-4 Mbit/s. Da OBS Studio si sceglie
un servizio personalizzato con server `rtmp://<dominio>[:porta]/drone` e la
chiave come chiave dello stream, e nelle impostazioni dell'uscita un
fotogramma chiave ogni 2 secondi e il profilo baseline, che non usa B-frame.


## 10. L'app Android

L'app richiede Android 8 (API 26) o successivo. Si compila con Gradle 9,
un JDK 17 o successivo e l'SDK Android con la piattaforma 37:

```
./gradlew :app:testDebugUnitTest    # test su JVM con Robolectric
./gradlew :app:lintDebug            # controllo statico
./gradlew :app:assembleRelease      # APK di rilascio, firmato se c'è keystore.properties
```

La versione di debug ha un identificativo diverso (`it.orion.app.dev`) e
convive sul telefono con quella di rilascio.

La chiave di firma la tiene lo sviluppatore, fuori dal repository e con una
copia di sicurezza. Una sola chiave firma l'app di tutte le associazioni: se
si perde, tutti devono reinstallare. I dati della chiave stanno in
`keystore.properties`, nella radice del progetto, che git ignora.

L'app non passa dal Play Store. L'APK firmato si mette nella cartella
`app-android` del server insieme a `versione.json`, con lo script
`scripts/pubblica.sh` del repository dell'app, che controlla la firma e
scrive l'impronta del certificato. Il server lo offre a `/app/orion.apk`, e
nel contesto (`GET /api/app/contesto`, campo `app`) dice all'app qual è
l'ultima versione e qual è la più vecchia ancora accettata. Sotto la minima
l'app si ferma e chiede di aggiornarsi.

L'app non interroga il server apposta: legge il contesto a ogni accesso, ogni
volta che torna davanti e a ogni aggiornamento della schermata, e quando è
chiusa lo rilegge il lavoro periodico di Android al massimo ogni venti ore.
Se il `versionCode` annunciato è più alto del suo, scarica l'APK nei propri
file e prima di tenerlo controlla che sia ORION, che sia proprio la versione
annunciata e che sia firmato con lo stesso certificato dell'app installata;
altrimenti lo butta. L'installazione parte con il `PackageInstaller` solo
quando l'app non è davanti e la persona non è in servizio (emergenza aperta e
una squadra), così non si chiude sotto le mani di chi la usa. La prima volta
Android chiede di consentire le installazioni da ORION e di confermare; da
Android 12 le volte successive non chiede più niente. Finché il permesso non
c'è, la schermata principale mostra un riquadro con "Consenti" e, ad app
chiusa, arriva una notifica; con il file già scaricato il riquadro offre
"Aggiorna ora" per non aspettare. Android stesso, comunque, accetta un aggiornamento solo se è
firmato con la stessa chiave.

Sul telefono i dati che restano per il lavoro senza rete (contesto,
intervento, profilo, elenco delle consegne, coda delle azioni) sono cifrati
con una chiave del portachiavi hardware. Le azioni fatte senza rete (note,
foto, consegne, conferme) partono dalla coda in ordine, con una chiave
d'idempotenza, così un reinvio non registra due volte la stessa cosa. Visite,
corsi e segreteria non si tengono sul telefono. I documenti del gruppo
"sempre con me" invece sì, in chiaro nei file dell'app (`documenti-gruppo`,
una cartella per documento e impronta), perché li apre il visualizzatore del
telefono: si scaricano a ogni aggiornamento con la rete, si tengono solo se
l'impronta SHA-256 corrisponde a quella del server, si cambiano quando esce
una versione nuova, restano con la sessione scaduta se rientra la stessa
persona e si cancellano all'uscita. Sono esclusi dai backup del telefono come
tutto il resto. Il calendario e le presenze non si tengono sul telefono:
si leggono ogni volta dal server.

La voce nell'app vive nel pacchetto `voce`. `MotoreVoce` tiene lo stato
(canali, chi parla, trasmissione, cronologia, messaggi propri con le loro
conferme) e parla col server attraverso `CollegamentoVoce`, un WebSocket OkHttp
suo che si riapre da solo con un'attesa che cresce fino a dieci secondi; i
codici di chiusura 4000 (voce spenta), 4002 (niente emergenza) e 4001/4003
(token rifiutato, altro telefono) fermano i tentativi. Il token voce si chiede
con la sessione e si tiene cifrato nell'archivio della sessione, legato
all'emergenza; regge una sessione scaduta, non l'uscita né la sospensione.
La codifica Opus la fa Concentus, una traduzione in Java puro di libopus con
licenza BSD: niente librerie native da compilare per ogni processore. Si
registra a 16 kHz con la sorgente `VOICE_COMMUNICATION`, che toglie eco e
rumore, in pacchetti da 60 ms a 20 kbit/s; quando la coda d'invio di OkHttp
supera i quattro secondi il bitrate scende a 12 kbit/s e risale quando la rete
si riprende.

Il microfono è acceso solo fra la pressione e il rilascio. La richiesta della
parola parte insieme all'apertura del microfono e i pacchetti registrati prima
del sì partono subito dopo, così la prima parola non si perde. Se la rete cade
mentre si parla, il messaggio continua a registrarsi e alla riapertura parte
con lo stesso `uuid`, `differito` ed `eta_ms`; un messaggio registrato senza
rete va in una coda cifrata sul telefono (al massimo cinque, poi PARLA dice di
usare la radio) e parte da solo al ritorno della rete. L'orologio che conta
`eta_ms` è `elapsedRealtime`, che non salta se si cambia l'ora del telefono.

La riproduzione (`Riproduttore`) è una coda con una voce alla volta: alta
priorità ed emergenza passano davanti e interrompono quella in corso, che poi
riprende da dove era. Prima di partire una diretta aspetta cinque pacchetti di
margine. La voce normale va sul volume dei contenuti multimediali
(`USAGE_MEDIA`), quella urgente su quello della sveglia (`USAGE_ALARM`); il
fuoco audio abbassa la musica senza fermarla. Con il permesso di accesso a
"Non disturbare" i messaggi urgenti lo superano, rimettendo il filtro com'era a
fine messaggio. Durante una telefonata la coda aspetta e la notifica dice
quanti messaggi ci sono in attesa. Suoni e vibrazioni dei vari stati sono in
`SegnaliAndroid`; il cambio di canale deciso dalla sala lo annuncia la sintesi
vocale del telefono.

Con la voce attiva gira `ServizioVoce`, un servizio in primo piano di tipo
`mediaPlayback` e `microphone`, con la notifica che ha "Apri PARLA".
`AttivitaParla` si apre dalla notifica anche a telefono bloccato e mostra solo
canale, chi parla e PARLA. Il servizio si avvia solo con l'app davanti, perché
da dietro le quinte Android non concede il microfono; dopo un riavvio del
telefono la voce riparte alla prima apertura di ORION. Lo stesso servizio
ascolta il ritorno della rete, i tasti PTT dei telefoni da lavoro (gli intent
`android.intent.action.PTT.down`/`up`, `com.sonim.intent.action.PTT_KEY_DOWN`/`UP`,
`com.runbo.ptt.key.down`/`up`) e, se lo si accende dalle impostazioni della
voce, il tasto dell'auricolare con una `MediaSession`. Un tasto tenuto
premuto parla finché lo si tiene; un colpo breve, come quello degli auricolari
Bluetooth che mandano pressione e rilascio insieme, apre e il colpo successivo
invia. Il microfono dell'auricolare Bluetooth passa da `setCommunicationDevice`
(Android 12 e successivi) o dallo SCO. I pulsanti PTT Bluetooth che si
presentano come tastiera si imparano dalle impostazioni di Orion Voice: l'app
tiene il codice del tasto e, se viene da un dispositivo esterno, anche il suo
descrittore, così lo stesso tasto premuto sul telefono non fa parlare; il
volume si accetta solo da un dispositivo esterno. Li prendono `onKeyDown` e
`onKeyUp` delle attività, quindi solo con l'app o la schermata PARLA davanti.
Prenderli a telefono bloccato o con l'app chiusa vorrebbe un servizio di
accessibilità, e Play Protect blocca l'installazione dal browser delle app che
ne dichiarano uno ("può chiedere accesso a dati sensibili"): per questo l'app
non lo ha. I tasti multimediali arrivano comunque dalla `MediaSession`.

L'interfaccia è in `ui/voce`: `BarraVoce` in fondo a tutte le schermate,
`SchermataVoce` con la cronologia, `TastoParla` con i gesti (tenere premuto,
scorrere in su per bloccare, trascinare fuori per annullare, oppure "tocca e
ritocca"), `TastoEmergenza` da tenere due secondi e `PrimoAvvioVoce`. I test
su JVM sono `VoceTest` (codifica, protocollo, motore contro un server finto),
`VoceSchermataTest` (gesti e schermate) e `VoceServerVeroTest`, che prova due
telefoni contro un server vero preparato con `tests/voce-app-prepara.mjs` e
parte solo con `ORION_PROVA_VOCE`.


## 11. Provare

Per sviluppare e provare non servono i container: con Node 24 e un PostgreSQL
qualunque, un `.env` nella cartella del codice (`DB_HOST`, `DB_PORT`,
`DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `COOKIE_SECRET`,
`DOMAIN_NAME`), `npm install` e `npm start` avviano un'istanza di sviluppo,
con dati e backup nella cartella del codice. Lì aggiornamenti e ritorni non
ci sono, perché li fa l'agente: si provano con `tests/container.mjs`, più
sotto.

Le prove sono di due tipi. Quelle senza server si lanciano con `npm test`
e durano pochi secondi: controllano che le pagine non scrivano in HTML testo
non ripulito, che ogni pulsante sia collegato, le regole della voce e del
radar, le difese che non hanno bisogno del database (password, pause dopo i
tentativi sbagliati, indirizzi esterni) e i limiti di frequenza (il limite
dell'accesso conta solo i tentativi sbagliati, `skipSuccessfulRequests`, e
tutti i limiti rispondono in JSON con `message`, che il web e l'app
mostrano).

Tutte le altre girano contro un'istanza vera, con il suo database, e si
lanciano insieme con `npm run test:tutto` (`tests/batteria.mjs`). La
batteria vuole le stesse variabili del server (`DB_*`, `JWT_SECRET`,
`COOKIE_SECRET`, `PORT`, di solito la 3010, e `ORION_DATI_DIR` se i dati
stanno fuori dal codice, anche dal `.env`) più `ORION_ADMIN_PASSWORD`, e un
database di prova: rifiuta `orion_db`, il nome del database delle istanze in
container. Avvia lei il server, e lo riavvia prima di ogni prova perché i
limiti di frequenza stanno in memoria. L'amministratore entra con la verifica
in due passaggi, e un codice non vale due volte: ogni accesso aspetterebbe il
codice successivo, fino a 30 secondi. Per questo le prove tengono la sessione
dell'amministratore nella cartella temporanea, accanto al segreto della
verifica (`tests/accesso-prova.mjs`), e la riusano finché il server la
accetta; i giri con i clic rimettono nel browser i suoi cookie. Nei giri con
i clic non ci sono attese fisse: `assesta()` di `tests/clic/aiuto.mjs`
aspetta finché la pagina chiede dati o cambia, mai oltre un massimo, e dove
si aspetta il server si aspetta la cosa precisa (un pulsante, una richiesta).
La batteria accorcia i due controlli periodici del server che le prove
aspettano, con `ORION_DRONE_CONTROLLO_MS` e `ORION_CONTROLLO_COLLEGAMENTI_MS`
(di serie 10 e 60 secondi); crea l'amministratore se il database
è vuoto e un volontario di prova per la prova del WebSocket; apre
un'emergenza per le prove che la vogliono e chiude quella rimasta aperta da
una prova caduta a metà. Alla fine stampa una riga per prova ed esce con 0
solo se sono tutte verdi; l'uscita di ognuna va in `ORION_BATTERIA_DIR`, o
in una cartella temporanea nuova. `npm run test:tutto -- voce allerta`
lancia solo le prove nominate. `npm run test:tutto -- --rapida` salta le
quattro più lente, che insieme fanno due terzi del tempo: i giri con i clic
(`clic-aree`, `clic-sala`), che aprono il browser su tutte le pagine, e `mfa`
e `sospensione`, che aspettano davvero codici e sessioni che scadono. Su
GitHub, a ogni push e pull request gira la batteria rapida; prima di
pubblicare un'immagine, dalla release o lanciata a mano, quella intera. Con Chromium in un posto diverso da quello di
Playwright, `ORION_CHROMIUM` dice dove.

Fra quelle con il server, `npm run test:smoke` percorre l'applicazione da
capo a fondo: accesso, ruoli, emergenze, segnalazioni, squadre, esterni
temporanei, segreteria, magazzino, notifiche. Crea i suoi dati di prova e li
toglie alla fine. Lanciata da sola vuole il server avviato con
`ORION_AGGIORNAMENTI_RETE_LOCALE=true`, perché prova il controllo degli
aggiornamenti contro un manifesto irraggiungibile sulla macchina stessa; la
batteria avvia già il server così. `tests/matrice-permessi.mjs` prova ogni operazione di
`tests/matrice-permessi.json` con ogni profilo (volontario con e senza
squadra, squadra COC, membro di una funzione, coordinatore, segreteria,
magazziniere, esterno, amministratore, anonimo) e confronta l'esito con
quello scritto nel file: se fallisce, una modifica ha cambiato un permesso.
Un cambio di permessi voluto si registra rilanciandola con `--fotografa`,
che riscrive gli esiti, e guardando il diff riga per riga prima del commit.
`tests/numeri-segnalazioni.mjs` crea tante segnalazioni insieme e controlla
che i numeri progressivi non si ripetano. `npm run test:clic-sala` usa la sala con i clic
in un Chromium vero, come una persona: apre un'emergenza dal pulsante, crea le
segnalazioni con il tipo, prova l'avviso delle vicine, il filtro, lo stato
della squadra e la chiusura, scarica il CSV dall'archivio; poi una simulazione
al volo interrotta da un'emergenza vera, l'esterno che entra dal QR e trova
negate le pagine non sue, e ogni modulo spento da solo e tutti insieme (menu,
pulsanti della sala, pagine aperte dall'indirizzo, moduli mandati all'app).
`npm run test:clic-aree` fa lo stesso per le altre aree, con un giro per area
in `tests/clic/` (si lancia anche uno solo, per nome): consegna e rientro del
magazzino con la conferma dei DPI, visite e corsi in segreteria con il blocco
in squadra, convocazione e presenze nel calendario, chiamata dei volontari
fino all'ingresso in squadra, incarico a una funzione di supporto, documenti
con versioni e visibilità, iscrizione, sospensione ed eliminazione di una
persona con backup e sigillo dalla pagina Sistema, strade chiuse e zone
disegnate sulla mappa, copione e regia di una simulazione. `npm run test:websocket` prova cosa arriva all'app sul WebSocket, e
`npm run test:integrita` lo storico inalterabile facendo la parte di chi ha in
mano il database, `npm run test:mfa` la verifica in due passaggi, `npm run test:caposquadra` il
caposquadra e la posizione condivisa fra più telefoni, `npm run test:voce` la
voce (le regole senza server in `tests/voce-regole.mjs`, poi canali, parola,
diretta, archivio, ripresa dopo una caduta, emergenza e presa in carico;
vuole un'emergenza aperta; `tests/voce-sala.mjs` prova il pannello Voce in un
Chromium vero, con il microfono finto e Playwright, che è fra le dipendenze di sviluppo), `npm run test:rischi`
i rischi scritti dalle zone di pericolo, `npm run test:strade` le strade chiuse
che restano dopo la chiusura dell'emergenza (entrambe aprono e chiudono
un'emergenza loro, quindi vogliono un'istanza senza emergenze in corso),
`npm run test:taglie` le taglie proposte alla consegna, con un volontario e dei
DPI di prova che toglie alla fine, `npm run test:informativa` l'accettazione
delle condizioni d'uso (ripubblica il testo com'era, quindi la versione sale),
`npm run test:documenti` l'archivio dei documenti (apre e chiude
un'emergenza sua se non ce n'è una in corso), `npm run test:attivita`
attività, calendario, presenze e squadra COC (anche lei con un'emergenza
sua). `npm run test:tesserino` il controllo del modello del tesserino (lo rimette com'era).
`npm run test:allerta` il bollettino di allerta: serve da sé un bollettino di
prova su `127.0.0.1:3099` (`tests/bollettino-finto.mjs`), quindi il server va
avviato con `ORION_ALLERTA_URL=http://127.0.0.1:3099/latest_all.zip`; apre e
chiude un'emergenza sua e rimette le impostazioni com'erano.
Il resoconto dell'ultima verifica generale (matrice delle rotte per ruolo,
caricamenti truccati, pulsanti del web, simulazione d'uso) è in
`docs/verifica-generale.md`. `npm run test:scenari` la biblioteca degli scenari: copione, Excel, copia,
duplicazione, pianificazione e apertura al volo (apre e chiude una
simulazione sua, quindi vuole un'istanza senza emergenze in corso). Chi
entra nelle prove accetta le condizioni d'uso come farebbe una persona:
`accediConFetch` lo fa da sé, e il client dello smoke risponde al 428. Le prove
entrano come amministratore, quindi con il codice: la prima volta attivano da
sole la verifica e tengono il segreto in `orion-test-mfa/` nella cartella
temporanea della macchina (oppure lo prendono da `ORION_ADMIN_TOTP`). Vanno lanciate su un'istanza di collaudo, mai su quella di
produzione.

`tests/container.mjs` prova le istanze in container da capo a fondo, come
root su una macchina con Docker: aggiornamento e ritorno chiesti dalla
pagina Sistema ed eseguiti dall'agente, una versione che non parte,
l'approvazione del gestore, backup notturno e ripristino, il cambio di memoria
con il massimo lasciato dall'altra istanza, la separazione da
un'altra istanza. Vuole due istanze appena create con `nuova-istanza.sh` e
due immagini in più: una versione nuova con una migrazione `prova_container`
e una che non parte. Le tre immagini, con il prefisso `localhost/orion`, le
costruisce `tests/container-immagini.sh` da una copia del codice e stampa le
versioni da passare alla prova (la testa dei due file dice come lanciarli).
Su GitHub la prova dei container parte dal flusso "Prove" lanciato a mano con
la casella "container"; il resto delle prove parte a ogni modifica, e il
flusso "Immagine" non pubblica se sono rosse.

L'app ha i suoi test su JVM. Quelli di contratto leggono risposte vere del
server salvate in `app/src/test/resources/risposte`: quando il server cambia
formato si rigenerano da un'istanza di collaudo e i test dicono cosa si è
rotto. `SchermateFotoTest` fotografa le schermate principali in
`app/build/schermate`, per guardarle senza un telefono.

Prima di mettere in produzione una versione nuova la si prova su un telefono
vero, con il web accanto: accesso, avvisi ad app chiusa, chiamata, consegna
e rientro, posizione della squadra in emergenza.


## 12. Sviluppare

Qualche abitudine che il codice segue e che conviene mantenere.

I commenti spiegano il perché, non il cosa, e sono in italiano come il resto.
Una rotta nuova nasce con il suo controllo dei permessi e con una voce nel
registro delle operazioni, se cambia qualcosa. Un cambiamento dello schema è
una migrazione nuova, mai la modifica di una vecchia. Quello che il web
mostra all'utente passa sempre dalle funzioni che ripuliscono il testo, e la
prova sulla resa HTML lo verifica.

Sull'app, le schermate non conoscono il contenitore: ricevono uno stato e
delle azioni, così si provano da sole. Il contesto del server decide cosa si
vede; le rotte restano comunque l'ultima parola. Le rotte che servono solo
all'app stanno in `src/appMobile.js` e `src/avvisi.js`.

Una versione nuova del server che cambia il formato di una risposta usata
dall'app va provata con l'app già installata sui telefoni, perché non tutti
aggiornano lo stesso giorno. Se il cambio rompe, si alza la versione minima
accettata in `versione.json`.
