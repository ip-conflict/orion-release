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
per gli accessi esterni durante un'emergenza e `manutenzione.js`. I servizi
condivisi hanno i loro moduli: `config.js` e `db.js` per configurazione e
database, `autenticazione.js`, `tempoReale.js` per il WebSocket e le
notifiche, `statoEmergenza.js` per l'emergenza attiva, `scadenze.js` per i
controlli giornalieri, e poi `email.js`, `audit.js`, `backup.js`,
`resoconto.js`, `caricamenti.js`, `anagrafica.js`. Le pagine web stanno in
`public/`, con i loro script in `public/js/`. Non c'è un passaggio di compilazione del frontend.

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
utente; crea l'utente di sistema che farà girare il programma; chiede le
credenziali del primo amministratore; prova a ottenere il certificato da
Let's Encrypt e, se non ci riesce, chiede di caricarne uno a mano; configura
il backup notturno e ne fa subito un primo di prova. Su una macchina senza
IPv6 configura Nginx solo in IPv4, invece di fermarsi su un errore.

Alla fine l'applicazione risponde all'indirizzo del dominio, e ci si entra
con l'amministratore appena creato.


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
fatture), resoconti delle emergenze chiuse, file temporanei delle
importazioni. Nginx non serve mai direttamente queste cartelle.

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
registri e `app-android`. Il controllo delle nuove versioni è spento finché
l'amministratore non lo accende, e ORION non si aggiorna mai da solo. Il
dettaglio è in `manutenzione-backup-e-aggiornamenti.md`.

Fino alla 3.36 l'aggiornamento dalla pagina Sistema cancellava `.pm2`: PM2
restava acceso ma senza più rispondere, e il primo `update.sh` successivo si
fermava su "Process Orion not found". Da quelle versioni si aggiorna con
`update.sh`, che adesso se ne accorge, ferma i processi rimasti dell'utente
dell'applicazione e riavvia ORION da capo.


## 8. Accesso, sessioni, permessi

Ogni richiesta passa da un controllo unico dell'identità, che legge il token
di sessione, verifica che non sia stato revocato, che l'account sia attivo e
rilegge i ruoli. Per questo sospendere un utente o togliergli un ruolo ha
effetto alla richiesta successiva, non alla scadenza del token.

Sopra quel controllo, i permessi delle rotte si esprimono con pochi
controlli: solo amministratore, solo chi non è esterno, solo il
magazziniere, solo un operatore interno. L'amministratore li supera tutti.
L'esterno non si somma a nessun altro ruolo: è una limitazione.

Gli esterni temporanei sono utenti con il ruolo esterno e un segno in più:
sono legati all'emergenza in cui sono nati. Entrano con un codice (il QR), non con
una password, e rigenerare il codice invalida quello vecchio. Alla chiusura dell'emergenza o a
una revoca vengono disattivati e le loro richieste ricevono una risposta 403
che dice il motivo (`accesso_temporaneo_finito`), così l'app lo spiega invece
di dire "sessione scaduta".

L'app, con l'impronta, non conserva la password: tiene un token di rinnovo
legato a quel telefono e cifrato con una chiave del portachiavi hardware. Il
server tiene solo l'impronta SHA-256 del token, e cambiare la password li
revoca tutti.


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

L'app riceve le notifiche dal WebSocket quando è aperta e, quando è chiusa,
controlla la coda con WorkManager. L'intervallo lo decide il server nel
contesto: 60 minuti in tempi normali, 15 durante un'emergenza. Quindici
minuti sono il minimo che Android ammette per un lavoro periodico, e il
sistema raggruppa questi controlli con quelli delle altre app, così la
batteria non ne soffre. Una consegna immediata ad app chiusa richiederebbe un
servizio di notifica centrale come Firebase: è stato escluso di proposito,
perché ORION non deve dipendere da servizi esterni.

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
corsi e segreteria non si tengono sul telefono.


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
fine. `npm run test:websocket` prova cosa arriva all'app sul WebSocket. Va
lanciata su un'istanza di collaudo, mai su quella di produzione.

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
