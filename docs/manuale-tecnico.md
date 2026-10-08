# ORION, manuale tecnico

Questo manuale è per chi installa, mantiene e sviluppa ORION: il tecnico
dell'associazione che cura il server e lo sviluppatore che mette mano al
codice. Chi usa ORION trova quello che gli serve nel manuale d'uso
(`manuale-uso.md`). Le ragioni delle scelte più delicate stanno nei documenti
vicini: ruoli e magazzino in `architettura-ruoli-e-magazzino.md`, backup e
aggiornamenti in `manutenzione-backup-e-aggiornamenti.md`, sicurezza in
`sicurezza.md`, le rotte dell'app in `app-android.md`.


## 1. Com'è fatto

ORION è pensato per essere decentralizzato: ogni associazione ha il suo
server, i suoi dati e la sua app collegata a quel server. Non c'è nessun
servizio centrale, nessun account presso terzi, nessuna notifica che passi da
Google o da altri. Se il server dell'associazione è acceso, ORION funziona;
se è spento, nessun altro ne sa niente.

Il server è un'applicazione Node.js (Express) con un database PostgreSQL.
Davanti c'è Nginx, che fa da proxy, gestisce il certificato HTTPS e lascia
passare il WebSocket. PM2 tiene acceso il processo e lo fa ripartire al
riavvio della macchina, con un utente di sistema dedicato e mai come root.

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

Serve una macchina Ubuntu pulita (provata su 24.04 LTS), un indirizzo IP
pubblico e un nome di dominio che punti a quell'indirizzo. Si clona il
repository, si rende eseguibile lo script e lo si lancia con i privilegi di
amministratore:

```
git clone https://github.com/ip-conflict/orion-release.git
cd orion-release
chmod +x ./setup.sh
sudo ./setup.sh
```

Lo script è interattivo. Installa Nginx, PostgreSQL, Node.js (almeno la
versione 22), PM2, Certbot, il firewall e cron; copia l'applicazione nella
cartella di produzione (`/var/www/<dominio>`); crea il database e il suo
utente; crea l'utente di sistema che farà girare il programma; prova a
ottenere il certificato da Let's Encrypt e, se non ci riesce, chiede di
caricarne uno a mano; configura il backup notturno e ne fa subito un primo di
prova. Su una macchina senza IPv6 configura Nginx solo in IPv4, invece di
fermarsi su un errore.

Il primo amministratore non si chiede durante l'installazione: si crea dal
browser. ORION, avviato senza amministratori, genera un codice di
configurazione monouso e lo scrive nel file `PRIMO-ACCESSO.txt` della
cartella dell'applicazione, leggibile solo dal suo utente e da root; lo
script lo mostra alla fine, insieme all'indirizzo da aprire. La pagina di
accesso, finché l'amministratore non c'è, mostra al posto del login il modulo
"Configurazione iniziale": codice, nome, cognome, username, email facoltativa
e password, con le stesse regole di ogni altra password di ORION. Il codice
serve perché fra la fine dell'installazione e il primo accesso l'indirizzo è
già pubblico, e senza codice l'amministratore lo diventerebbe il primo che
arriva. Creato l'amministratore, il file si cancella, il modulo non compare
più e la rotta risponde 409. Se il codice si perde, lo si rilegge con
`sudo cat /var/www/<dominio>/PRIMO-ACCESSO.txt`. Il vecchio `create-admin.js`
resta come strumento di emergenza, per chi ha accesso al server e deve
ricreare un amministratore a mano.


## 3. Configurazione

La configurazione di sistema sta nel file `.env` della cartella
dell'applicazione, scritto da `setup.sh`. Le voci che contano sono le
credenziali del database (`DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`,
`DB_PASSWORD`, e `DB_SSL` con `DB_SSL_STRICT` se il database è su un'altra
macchina), i segreti per firmare le sessioni e i cookie (`JWT_SECRET`,
`COOKIE_SECRET`), il dominio (`DOMAIN_NAME`), la porta interna (`PORT`, di
norma 3000) e il fuso orario (`TZ`, Europe/Rome). Facoltative sono
`ORION_BACKUP_DIR`, la cartella dei backup che l'applicazione fa da sola
(predefinita `/var/backups/orion/auto`), e `ORION_BACKUP_RETENTION_DAYS`,
quanti giorni tenerli (predefinito 30).

I due segreti non vanno mai cambiati a server acceso senza sapere cosa si fa:
cambiare `JWT_SECRET` fa uscire tutti.

La mappa del centro operativo usa servizi di OpenStreetMap chiesti dal
browser della sala, non dal server: le tessere della mappa
(tile.openstreetmap.org, il satellite da server.arcgisonline.com), gli
indirizzi (photon.komoot.io e nominatim.openstreetmap.org) e i percorsi
delle squadre (router.project-osrm.org). Sono gli unici indirizzi esterni
ammessi dalla Content-Security-Policy in `src/server.js`. Senza rete la mappa
resta vuota e il percorso diventa linea d'aria; tutto il resto funziona.

Tutto il resto si configura dall'applicazione, nelle Impostazioni, e sta nel
database: la posta in uscita (SMTP), il logo e il nome dell'associazione, i
moduli Segreteria e Magazzino, il tesserino, la disponibilità dell'app
Android, il controllo degli aggiornamenti. La posta è facoltativa: senza,
ORION funziona lo stesso e mostra all'amministratore i link di attivazione
invece di spedirli.
Il manuale d'uso spiega come usare un account Gmail gratuito; dalle
Impostazioni "Manda una prova" (`POST /api/admin/email-prova`) prova i dati
scritti nel modulo, anche non ancora salvati, e restituisce il motivo
dell'errore insieme alla risposta grezza del server di posta.


## 4. Dove stanno i dati

Il database contiene tutto quello che è testo e numeri: utenti, ruoli,
emergenze, segnalazioni con il loro diario, squadre, fascicoli, magazzino,
verbali, notifiche, registro delle operazioni.

I file caricati stanno sul disco, in due cartelle. `uploads/photos` tiene le
foto profilo. `protected_uploads` tiene tutto il resto, che si legge solo
attraverso il server con i permessi giusti: certificati e attestati, immagini
e documenti delle segnalazioni, file del magazzino (verbali firmati,
fatture), l'archivio dei documenti del gruppo (`documenti-gruppo`), resoconti
delle emergenze chiuse, file temporanei delle importazioni, la cartografia
del territorio (`cartografia/territorio.mbtiles` con accanto
`territorio.json`, quello che il server ne ha letto; la cartella si sposta
con `ORION_CARTOGRAFIA_DIR`). Nginx non serve mai direttamente queste cartelle.

I registri del programma stanno in `logs/` (quelli di PM2) e vanno guardati
per primi quando qualcosa non torna: gli invii di posta riusciti e falliti,
per esempio, sono scritti lì.


## 5. Il database e le migrazioni

Lo schema cresce con le migrazioni di node-pg-migrate, nella cartella
`migrations`, una per ogni cambiamento. La 1.0 parte da una sola migrazione,
`1790985600000_orion-1-0.cjs`, che applica `db/orion-1.0.sql`: lo schema
completo e i dati di partenza (i DPI proposti, le categorie, il corso base).
Riunisce le 37 migrazioni della numerazione interna 3.x, ed è identica al
risultato di applicarle una dopo l'altra a un database vuoto. Una migrazione
nuova si crea con `npm run migrate:create -- nome`: node-pg-migrate le dà un
nome col timestamp, che la mette in coda alle altre.

Le migrazioni si applicano da sole con l'installazione, con l'aggiornamento e
a ogni avvio del server (`src/migrazioni.js`). Di solito non ce n'è nessuna da
fare; servono dopo il ripristino di un backup di una versione precedente, che
riporta il database allo schema di allora. Se non riescono, il server parte lo
stesso e lo scrive nel registro, così l'amministratore può entrare e
ripristinare un altro backup. A mano si lanciano con `npm run migrate`, con
`DATABASE_URL` che punta al database.

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
ore controlla se il backup notturno è stato saltato e, se sì, lo recupera.

Alla chiusura di un'emergenza fa un backup del database, scrive il
resoconto, chiude gli accessi esterni temporanei, fa scadere le notifiche
dell'emergenza e chiude d'ufficio le squadre rimaste senza membri e senza
materiale in carico.

Ogni 15 secondi, con una simulazione aperta e lo scenario avviato, fa
uscire gli eventi a tempo del copione (`controllaUscite()` in
`src/copione.js`).

Ogni minuto sigilla le righe nuove dei registri (note delle segnalazioni,
diario di sala, registro delle operazioni, movimenti, registro delle squadre)
in `registro_integrita`. Alla chiusura di un'emergenza prende il sigillo,
lo salva in `emergencies.sigillo_chiusura` (lo riportano resoconto e punto di
situazione), lo restituisce a chi chiude e lo manda per email agli
amministratori, se la posta è configurata.


## 7. Backup, ripristino, aggiornamenti

Il backup notturno lo fa cron alle 3:30, come root, con `scripts/backup.sh`:
database e file caricati in `/var/backups/orion`, con il log in
`/var/log/orion-backup.log`. Poiché lo scrive root, l'utente
dell'applicazione non può cancellarlo. I file sono di root con il gruppo
dell'applicazione e permessi 640, le cartelle 750: l'applicazione li legge
per elencarli e ripristinarli, nessun altro utente della macchina li vede.
Oltre a questo l'applicazione fa i suoi backup (alla chiusura di
un'emergenza, prima di un ripristino o di un aggiornamento, e quelli di
recupero) nella cartella `auto`.

Tutti questi backup stanno sulla stessa macchina: proteggono da un errore,
non dalla rottura del disco. Una copia va scaricata dalla pagina Sistema e
tenuta altrove, con regolarità.

Il ripristino si fa dalla pagina Sistema ed è una transazione sola: se
qualcosa va storto a metà, il database resta com'era. Prima di cominciare
ORION salva i dati attuali; durante il lavoro risponde "in manutenzione" a
tutti; alla fine applica le migrazioni mancanti e si riavvia. Il dump passa a
psql senza `.psqlrc` e attraverso un filtro: un backup di pg_dump ha solo tre
comandi con la barra rovesciata (`\restrict`, `\unrestrict` e il `\.` che
chiude i dati di un COPY), e un archivio con qualunque altro, come `\!` che
esegue un programma, viene rifiutato prima di cominciare.

L'aggiornamento si fa dalla pagina Sistema oppure dalla riga di comando con
`sudo ./update.sh`. L'ordine è pensato perché un guasto non lasci le cose a
metà: backup, scaricamento e verifica del pacchetto, dipendenze installate
nella cartella di lavoro accanto al pacchetto nuovo, migrazioni lette dal
pacchetto nuovo, copia del codice attuale, sostituzione dei file (dipendenze
comprese), riavvio. Se dipendenze o migrazioni falliscono, nessun file è
ancora stato toccato. La sostituzione usa rsync con `--delete-after` ma non
tocca i file nascosti della cartella, che è anche la home dell'utente di
sistema (`.pm2`, `.npm`, `.npmrc`, `.env`), i dati caricati, i loghi, i
registri e `app-android`. Il controllo delle nuove versioni si fa a mano con
"Controlla adesso"; acceso, quello giornaliero avvisa gli amministratori con
una notifica e un'email. ORION non si aggiorna mai da solo, e con
un'emergenza aperta non si aggiorna proprio. Il dettaglio è in
`manutenzione-backup-e-aggiornamenti.md`.

Fino alla 3.36 l'aggiornamento dalla pagina Sistema cancellava `.pm2`: PM2
restava acceso ma senza più rispondere, e il primo `update.sh` successivo si
fermava su "Process Orion not found". Da quelle versioni si aggiorna con
`update.sh`, che adesso se ne accorge, ferma i processi rimasti dell'utente
dell'applicazione e riavvia ORION da capo.


### La cifratura

`src/cifratura.js` (con il formato in `src/formatoCifrato.js`) cifra con
AES-256-GCM i file in `protected_uploads` (certificati, documenti, immagini,
magazzino, documenti del gruppo, resoconti) e `uploads/photos`, i backup del database e la password
SMTP. Formato dei file: `ORIONCF1`, IV di 12 byte, dati, tag di 16 byte; il
tag rende evidente anche un file alterato. I file in chiaro di prima restano
leggibili e un giro orario li cifra; i caricamenti nuovi si cifrano subito
dopo il controllo del contenuto, e le rotte li mandano decifrati
(`inviaFile`).

La chiave sta in `chiave-dati.key` nella cartella dell'applicazione (o in
`ORION_CHIAVE_FILE`), 600, creata al primo avvio. Non è nel database e non
finisce nei backup; aggiornamenti (`update.sh`, pagina Sistema) e copia
dell'applicazione prima dell'aggiornamento la escludono. Nel database c'è solo
la sua impronta (`cifratura_impronta`), che dice se la chiave sul disco è
quella dei dati: se manca o non corrisponde, ORION parte lo stesso, le rotte
dei file rispondono 503 e la pagina Sistema chiede la chiave di recupero (la
stessa chiave in base32, 52 caratteri). I backup notturni di `backup.sh` si
cifrano con `scripts/cifra-backup.mjs`; un backup si decifra fuori da ORION
con `scripts/decifra-backup.mjs`, dando il file della chiave oppure
`ORION_CHIAVE_RECUPERO`. Per spostare un'installazione si copia anche
`chiave-dati.key`, oppure si inserisce la chiave di recupero dalla pagina
Sistema prima di ripristinare. `node tests/cifratura.mjs` prova cifratura,
backup alterati, chiave di recupero e password della posta.

### Lo storico inalterabile

La migrazione `storico-inalterabile` mette sulle tabelle `report_updates`,
`diario_sala`, `audit_log`, `movimenti` ed `emergency_team_log` un trigger
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
materiale in carico in Io leggono `GET /api/documenti?bene=ID`. In `GET
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
/api/simulazioni/copioni`, cioè di cui la persona fa la regia); poi apre la
sala con `apriEmergenza()`. Se la sala non si apre, l'attività appena creata
si cancella. Il contesto dell'app porta `emergenza.simulazione`,
`emergenza.attivita_id` e, a chi conduce, la capacità `regia`.

Il copione (`src/copione.js`, migrazione `copione-regia`) sta in
`copione_eventi`: attività, ordine, `minuto` (NULL vuol dire a mano), `tipo`
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
`{ colori, testi, posizioni, nascosti }`, con `posizioni` nullo per la
disposizione automatica, che si adatta a QR, codice fiscale ed ente.
`PUT /api/branding/settings` lo accetta solo dopo `validaModelloTesserino`
(`src/modelloTesserino.js`): colori `#rrggbb`, testi da 1 a 40 caratteri,
misure numeriche entro il tesserino, chiavi note; vuoto vuol dire il
tesserino predefinito. Il disegno impone le misure minime (QR 38 pt di lato,
codice a barre largo almeno 231 moduli da tre punti a 300 dpi) e mette QR e
barre su bianco. Gli elenchi delle chiavi stanno nei due file e vanno tenuti
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

La verifica in due passaggi è TOTP (RFC 6238): codici di sei cifre a
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
tentativi d'accesso. Un'app che non conosce il secondo passo mostra il
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

Lo script chiude anche le sessioni; al prossimo accesso l'amministratore la
riattiva. Anche questo finisce nel registro delle operazioni.


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
telefono arriva la posizione.

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
categoria, per riferimento o per persona. La tabella completa di chi produce
cosa è in `app-android.md`.

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
stesso token. Niente Firebase né altri servizi esterni.

`GET /api/app/avvisi/stato` dice alla persona come il server vede i suoi
telefoni; `GET /api/avvisi/telefoni` lo dice per tutti agli operatori interni
(la gestione utenti mostra il telefono verde se è in ascolto adesso);
`POST /api/notifiche/prova` con `{ ritardo }` (fino a 120 secondi) manda a sé
stessi una notifica di prova. `npm run test:avvisi` prova il token, le
revoche, il collegamento e la prova.

Le email restano per quello che hanno sempre fatto: attivazione e recupero
password, avvisi di scadenza ai volontari, report mensile, avvisi del
magazzino a chi li ha chiesti.


## 10. L'app Android

L'app richiede Android 8 (API 26) o successivo. Si compila con l'SDK
Android e Gradle:

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
nel contesto dice all'app qual è l'ultima versione e qual è la più vecchia
ancora accettata: l'app propone di aggiornarsi o si ferma di conseguenza.
Android accetta un aggiornamento solo se è firmato con la stessa chiave.

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


## 11. Provare

Il server ha una batteria di prove che gira contro un'istanza vera, con il
suo database:

```
ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD='...' npm test
```

`npm test` controlla che le pagine non scrivano in HTML testo non ripulito,
che i limiti di frequenza funzionino e poi percorre l'applicazione da capo a
fondo: accesso, ruoli, emergenze, segnalazioni, squadre, esterni temporanei,
segreteria, magazzino, notifiche. Crea i suoi dati di prova e li toglie alla
fine. `npm run test:websocket` prova cosa arriva all'app sul WebSocket, e
`npm run test:integrita` lo storico inalterabile facendo la parte di chi ha in
mano il database, `npm run test:mfa` la verifica in due passaggi, `npm run test:caposquadra` il
caposquadra e la posizione condivisa fra più telefoni, `npm run test:rischi`
i rischi scritti dalle zone di pericolo, `npm run test:strade` le strade chiuse
che restano dopo la chiusura dell'emergenza (entrambe aprono e chiudono
un'emergenza loro, quindi vogliono un'istanza senza emergenze in corso),
`npm run test:taglie` le taglie proposte alla consegna, con un volontario e dei
DPI di prova che toglie alla fine, `npm run test:informativa` l'accettazione
delle condizioni d'uso (ripubblica il testo com'era, quindi la versione sale),
`npm run test:documenti` l'archivio dei documenti (apre e chiude
un'emergenza sua se non ce n'è una in corso), `npm run test:attivita`
attività, calendario, presenze e squadra COC (anche lei con un'emergenza
sua). `npm run test:tesserino` il controllo del modello del tesserino (lo rimette com'era). Chi
entra nelle prove accetta le condizioni d'uso come farebbe una persona:
`accediConFetch` lo fa da sé, e il client dello smoke risponde al 428. Le prove
entrano come amministratore, quindi con il codice: la prima volta attivano da
sole la verifica e tengono il segreto in `orion-test-mfa/` nella cartella
temporanea della macchina (oppure lo prendono da `ORION_ADMIN_TOTP`). Vanno lanciate su un'istanza di collaudo, mai su quella di
produzione.

L'app ha i suoi test su JVM. Quelli di contratto leggono risposte vere del
server salvate in `app/src/test/resources/risposte`: quando il server cambia
formato si rigenerano da un'istanza di collaudo e i test dicono cosa si è
rotto. `SchermateFotoTest` fotografa le schermate principali in
`app/build/schermate`, per guardarle senza un telefono.

Prima di mettere in produzione una versione nuova si segue la lista di
collaudo in `collaudo.md`, su un telefono vero e con il web accanto.


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
all'app si documentano in `app-android.md`.

Una versione nuova del server che cambia il formato di una risposta usata
dall'app va provata con l'app già installata sui telefoni, perché non tutti
aggiornano lo stesso giorno. Se il cambio rompe, si alza la versione minima
accettata in `versione.json`.
