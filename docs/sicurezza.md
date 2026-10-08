# Revisione di sicurezza

Fatta il 22 settembre 2026 su tutta l'applicazione, in vista di una possibile
apertura pubblica del codice. Questo documento dice **cosa è stato guardato**,
**cosa è stato trovato** e **cosa resta un rischio accettato**, perché fra un
anno la domanda sarà esattamente questa.

Metodo: lettura del codice più verifica sul campo. Quello che segue è stato
riprodotto su un'installazione vera, con un browser vero, non dedotto leggendo.

---

## Il difetto trovato: il testo delle segnalazioni finiva in pagina come HTML

**Gravità: alta.** Chiuso.

Il centro operativo passava i campi delle segnalazioni a `DOMPurify.sanitize()`
prima di metterli in pagina. Sembra la cosa giusta, e invece è l'attrezzo
sbagliato: DOMPurify è un **sanificatore di HTML**, non un **escape di testo**.
Con la configurazione predefinita:

- **lascia passare il markup benigno**, `<div style="...">` compreso;
- **non tocca le virgolette**, quindi dentro un attributo non impedisce di
  uscirne.

Le conseguenze, verificate una per una:

1. **Fuga dall'attributo.** Il titolo `Allagamento" data-pwned="si"
   onmouseover="..."` finiva in `title="${DOMPurify.sanitize(report.title)}"` e
   produceva attributi veri nel DOM di chi guardava la coda. L'esecuzione del
   gestore è stata bloccata dalla CSP (`script-src-attr 'none'`): la rete di
   sicurezza ha tenuto, ma era l'ultima.
2. **Copertura dello schermo, senza script.** La CSP non blocca gli stili: un
   titolo contenente `<div style="position:fixed;inset:0;...">` **ha coperto
   l'intera finestra** del centro operativo (1400×900 su 1400×900). Una
   segnalazione poteva accecare la sala operativa durante un'emergenza.
3. **Anche la descrizione**, l'unico campo in cui il markup è voluto, accettava
   `<br style="position:fixed;inset:0">`: con i soli `ALLOWED_TAGS` gli
   attributi passano, e un `<br>` così è un rettangolo a schermo intero.

Chi poteva farlo: **un volontario**, cioè il ruolo più basso che può scrivere
una segnalazione (gli utenti *esterni* non possono crearne). Il bersaglio: tutti
quelli che guardano la coda, coordinatori e amministratori compresi.

### Come è stato chiuso

La regola adesso è una sola:

| cosa è | come si mette in pagina |
|---|---|
| testo (titoli, indirizzi, nomi, note, telefoni) | `escapeHTML(...)`, che scappa anche virgolette e apici |
| markup voluto (gli a capo della descrizione) | `DOMPurify.sanitize(..., { ALLOWED_TAGS: ['br'], ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false })` |
| dentro un attributo | solo `escapeHTML` o `encodeURIComponent`, **mai** un sanificatore |

Diciannove punti di resa nel centro operativo sono passati a `escapeHTML`, le
schede di avviso della segreteria pure (i nomi dei volontari), e i percorsi dei
documenti dentro gli `href` sono scappati anche loro.

### Perché non tornerà

`tests/controllo-resa-html.mjs`, che gira come primo passo di `npm test` e non
ha bisogno né di server né di database. Fallisce se qualcuno rimette un
sanificatore dentro un attributo, se un campo del server finisce in un attributo
senza escape, o se DOMPurify viene usato senza liste chiuse.

---

## Cosa è stato guardato e non ha dato problemi

- **Iniezione SQL.** Tutte le query usano parametri. L'unico pezzo di SQL
  costruito come stringa (i filtri del registro operazioni) monta solo
  segnaposto `$1, $2`, mai i valori.
- **Attraversamento dei percorsi.** Le cinque rotte che servono file dal disco
  risolvono il percorso e verificano che resti dentro la cartella prevista, con
  il separatore finale (così `images_old` non passa il controllo di `images`).
  Provato con nomi che tentano di uscire: respinti.
- **Nomi dei file caricati.** Generati con `crypto.randomBytes`, non indovinabili.
- **Sessione.** JWT firmato HS256 con l'algoritmo fissato anche in verifica
  (niente confusione di algoritmi), cookie `httpOnly`, `secure`, `SameSite=strict`,
  elenco dei token revocati, ruoli riletti dal database a ogni richiesta.
- **Permessi.** Le rotte sugli utenti sono tutte dietro il ruolo amministratore;
  i documenti personali passano da `checkOwnershipOrSegreteria`; il magazzino ha
  i suoi due livelli. 130 controlli automatici lo verificano a ogni giro.
- **Limiti di frequenza** su accesso, password e operazioni amministrative.
  Per le API il limite (1500 richieste ogni quarto d'ora) vale per persona,
  dopo l'autenticazione: una sala operativa esce da un solo indirizzo, e non
  deve dividere un solo limite fra tutte le postazioni. Le rotte pubbliche
  (logo, impostazioni pubbliche) si contano per indirizzo, quindi per tutta la
  sala: per questo il tetto è alto, è una difesa contro un client impazzito e
  non contro chi lavora. I limiti stretti sono quelli su accesso, rinnovo e
  codici degli esterni (100 tentativi ogni quarto d'ora per indirizzo). Davanti c'e' una
  guardia per indirizzo, alta (5000), contro chi martella il server. Gli
  indirizzi IPv6 si contano per rete /64, per non aggirare i limiti cambiando
  indirizzo. Le posizioni delle squadre (`POST /api/location`) non contano.
  Prova: `npm run test:limiti`.
- **Segreti.** Nessuna chiave scritta nel codice: `setup.sh` le genera con
  `openssl rand`. Nessun segreto finisce nei log. Nessun `.env` e nessun dump
  nella storia di git (verificato su tutta la storia).
- **WebSocket** autenticato al momento dell'aggancio, non dopo.
- **Pacchetti di aggiornamento.** Un archivio che tenta di scrivere fuori dalla
  sua cartella (`../../`) o attraverso un collegamento simbolico viene rifiutato
  da tar, e l'aggiornamento si ferma. Provato con archivi costruiti apposta.

---

## Rischi accettati, e perché

- **Chi amministra può eseguire codice sul server.** È il senso della funzione
  di aggiornamento: l'amministratore indica una sorgente, e da quella sorgente
  arriva il programma che verrà eseguito. Le difese sono a monte (sorgente
  scelta da chi installa, impronta SHA-256, password e parola di conferma), non
  a valle. Chi controlla la sorgente degli aggiornamenti controlla
  l'installazione: è vero per ORION come per qualunque altro programma.
- **L'indirizzo del manifesto può puntare alla rete interna.** Un amministratore
  può far interrogare al server un indirizzo privato. Lo può già fare in mille
  altri modi avendo quel ruolo; vale la pena ricordarlo se un domani la
  configurazione diventasse accessibile a un ruolo più basso.
- **Lo scaricamento del pacchetto non ha un tetto di dimensione.** Una sorgente
  compromessa potrebbe riempire il disco. Da sistemare quando si toccherà quel
  file: non è un accesso indebito, è un disservizio.
- **La foto del tesserino è protetta dal nome del file.** È un indirizzo-segreto
  (24 byte casuali) perché deve funzionare anche nel tesserino pubblico durante
  un'emergenza. Chi ha il link vede la foto.

---

## Seconda revisione (24 settembre 2026)

Quattro punti chiusi, tutti verificati sul campo e coperti da `npm test`
(sezioni [7-bis], [8] e [8-ter] della batteria).

### Le pagine dell'applicazione si aprivano senza accesso

**Gravità: media.** Chiuso.

Centro operativo, segreteria, magazzino, profilo, stampa della segnalazione
ed etichette stanno in `public/` insieme alle pagine pubbliche, ed
`express.static` le serviva a chiunque prima che le rotte protette potessero
intervenire. I dati restavano dietro le API, ma la struttura di tutte le
pagine si leggeva da fuori. Adesso quelle sei pagine passano
dall'autenticazione prima dei file statici; accesso, tesserino e nuova
password restano pubbliche. Durante un ripristino basta un token valido,
perché il database può non rispondere.

### Le foto profilo erano pubbliche

**Gravità: media.** Chiuso.

`/api/photos` rispondeva a chiunque avesse il nome del file. Ora richiede
l'accesso. Il tesserino pubblico mostra la foto da
`/api/public/volunteer/:token/photo`, con le sue stesse condizioni
(emergenza in corso o verifica sempre attiva); fuori da quelle, 404.

### Le emergenze chiuse erano leggibili da tutti

**Gravità: media.** Chiuso.

Un'emergenza chiusa è archivio, e l'archivio è dell'amministratore: l'elenco
delle segnalazioni già lo diceva, ma il dettaglio di una segnalazione, i
documenti, gli eventi, i file dei documenti e le foto no. Bastava l'indirizzo.
Ora vale la stessa regola ovunque (`puoVedereEmergenza`): l'emergenza in
corso la vede chi ha fatto l'accesso, esterni compresi; le altre solo
l'amministratore. Un file che non appartiene a nessuna segnalazione o
documento lo apre solo l'amministratore.

Gli esterni (le funzioni comunali di protezione civile) restano come erano:
vedono l'emergenza in corso, scrivono nel diario e correggono la posizione di
una segnalazione; non modificano, non assegnano, non creano.

### Chi vede il tesserino

Con un'emergenza aperta chiunque, senza accesso: deve poterlo verificare
anche chi non fa parte dell'associazione. Fuori emergenza solo chi ha fatto
l'accesso, di qualunque livello; prima fuori emergenza non lo vedeva
nessuno. Resta l'interruttore dell'amministratore per aprirlo a tutti
(esercitazioni, fiere, controlli).

### Il WebSocket dell'app

Il web continua a ricevere tutto, perché in emergenza ogni postazione deve
vedere lo stesso quadro. L'app riceve solo gli eventi che riguardano la
persona e la sua squadra: sul telefono di un volontario, che si può perdere,
non passano più le posizioni di tutte le squadre né il diario di tutte le
segnalazioni. Dettagli in `docs/app-android.md`.

### Il resto

- **Esito delle visite mediche**: il server accettava qualunque testo, che
  poi finiva in pagina senza escape. Ora accetta solo "Idoneo" e "Non
  Idoneo", e le due pagine che lo mostravano lo scappano.
- **Idoneità nel dettaglio squadra**: bastava una visita qualsiasi ancora
  valida, anche se l'ultima diceva "Non Idoneo". Ora conta l'ultima visita di
  idoneità fisica, come nel tesserino e nelle assegnazioni.
- **bcrypt**: `create-admin.js` e `generate-password.js` usavano costo 10,
  il resto 12. Ora tutto 12, e le password salvate con un costo più basso si
  rafforzano da sole al primo accesso riuscito.

### Un'osservazione corretta

Nella prima analisi le foto delle segnalazioni (`/uploads/...`) risultavano
scaricabili senza accesso. Non era vero: la prova seguiva il rimando alla
pagina di accesso e contava come riuscita la pagina di accesso. Il server
rispondeva 302. Adesso in più guarda a quale emergenza appartiene la foto.

---

## Date senza ora

Non era sicurezza, ma è stato trovato qui. PostgreSQL restituiva le colonne
`DATE` (scadenze, visite, corsi, manutenzioni) come mezzanotte italiana, che
in JSON diventa "il giorno prima alle 22:00 UTC". Il web ne prendeva i primi
dieci caratteri: mostrava il giorno prima, e modificando una visita o un
corso la data salvata arretrava di un giorno a ogni salvataggio. Ora le date
viaggiano come "AAAA-MM-GG", così come sono nel database, e il server le
scrive all'italiana senza passare dal fuso orario (`src/date.js`).

---

## Terza revisione: app e web insieme (24 settembre 2026)

Tutte le rotte del server (138) lette una per una, i punti dubbi provati sul
server di collaudo con un utente per ruolo (esterno compreso), le dipendenze
controllate. Per l'app: manifest, archiviazione, rete, notifiche, file
lasciati sul telefono. Niente è stato corretto in questo giro: l'elenco serve a
decidere.

### Web: cosa è aperto

| # | Gravità | Cosa | Verificato |
|---|---|---|---|
| W1 | media | Un **esterno** può creare, modificare ed **eliminare squadre** (`POST/PUT/DELETE /api/squadre`), e caricare documenti nell'emergenza. Eliminare una squadra ne blocca anche il nome radio fino alla chiusura. | sì: creata ed eliminata una squadra, caricato un PDF |
| W2 | media | Cambiare o far reimpostare la password **non chiude le altre sessioni**: un token rubato resta valido fino a 24 ore. Vale anche per il reset fatto dall'amministratore. | sì: vecchio token ancora valido dopo il cambio |
| W3 | media | `multer` 1.4.5-lts.1: le versioni 1.x hanno difetti noti di negazione del servizio sui caricamenti (risolti in 2.x). Solo utenti autenticati, perché l'autenticazione viene prima. `npm audit` da qui non li segnala: da verificare aggiornando. | no (versione) |
| W4 | media-bassa | L'**idoneità medica** di tutti (`medical_ok`) arriva a qualunque utente, esterni compresi, da `/api/users/unassigned`, `/api/membri-disponibili/:id`, `/api/squadre/:id`. È un dato sanitario, anche se è un sì/no. | sì, come esterno |
| W5 | media-bassa | `GET /api/branding/settings` è pubblica e toglie solo le chiavi SMTP: in produzione include `segreteria_config`, con gli indirizzi email interni degli avvisi e il testo del modello. Ogni chiave futura sarà pubblica per default. | sì (codice) |
| W6 | bassa | WebSocket con `maxPayload` predefinito (100 MB) su un canale che non riceve nulla: un utente autenticato può mandare messaggi enormi. | codice |
| W7 | bassa | Un tesserino perso non si può invalidare: manca "rigenera QR" (`public_token`), resta solo sospendere la persona. | codice |
| W8 | bassa | Nelle email della segreteria il testo diventa HTML (`html: html \|\| text`) con nomi non scappati. | codice |
| W9 | bassa | `setup.sh` lascia i file a 644: certificati medici e documenti caricati sono leggibili da altri utenti della macchina. | codice |
| W10 | informativa | `uuid` vecchio dentro `exceljs` (npm audit, moderata): riguarda un uso (v3/v5/v6 con buffer) che qui non c'è. | npm audit |

**Una scelta da confermare, non un difetto.** Ogni utente interno, anche un
volontario dall'app o con una chiamata diretta, può modificare o chiudere
qualunque segnalazione e comporre o sciogliere squadre: è la "sala operativa
condivisa" voluta. Con l'app in tasca a tutti, un ruolo "operatore di sala"
restringerebbe la superficie senza togliere niente a chi lavora in sala.

**Aggiornamento, stesso giorno: W1-W9 chiusi.** Gli esterni non compongono,
modificano né sciolgono squadre, e non vedono l'idoneità dei volontari (W1,
W4); il caricamento di documenti resta loro permesso, per scelta. Cambiare o
reimpostare la password chiude tutte le altre sessioni e i token di rinnovo
(W2, colonna `sessioni_valide_dal`). `multer` 2.4 (W3). Impostazioni pubbliche
a elenco chiuso, e della segreteria solo acceso/spento e cosa blocca (W5).
WebSocket a 4 KB (W6). "Rigenera QR" in segreteria (W7). Email senza HTML
esplicito spedite come solo testo (W8). File creati dal programma a 640,
cartelle dei dati a 750 in installazione e aggiornamento (W9). Prove in
`npm test`, sezioni [7] e [8-quinquies].

### Web: guardato e a posto

Iniezione SQL (tutte parametrizzate; le due parti costruite a mano usano
elenchi chiusi), intestazioni (CSP senza script esterni, HSTS, frame, nosniff),
CORS con origini chiuse, cookie `httpOnly`/`secure`/`SameSite=strict`, JWT con
algoritmo fissato, revoca all'uscita e controllo dell'account a ogni richiesta,
limiti di frequenza, attraversamento dei percorsi, contenuto reale dei file
caricati, token di ripristino cifrati e validi un'ora, risposta uguale per
utenti esistenti e no (anche nei tempi), emergenze chiuse e pagine riservate,
foto e tesserino, WebSocket autenticato e filtrato per l'app, nessuna traccia
dello stack in produzione, nessun segreto nei log, `.env` a 600.

### App: cosa è aperto

| # | Gravità | Cosa |
|---|---|---|
| A1 | bassa-media | Le copie per il lavoro senza rete sono **in chiaro** nei file dell'app: `intervento.json` (nome e telefono del segnalante, indirizzo, diario), `consegna-catalogo.json` (nominativi dei volontari), `contesto.json`, `io.json`. Le proteggono la sandbox e la cifratura del telefono; non un telefono con i permessi di root o un'analisi forense. Il libretto sanitario invece non viene mai salvato. Si possono cifrare con la stessa chiave del token. |
| A2 | bassa | Le **foto in coda** di una persona restano sul telefono se entra qualcun altro: le azioni vengono scartate, i file no. |
| A3 | bassa | Emergenza e Consegna non bloccano screenshot e anteprima fra le app recenti (Io e Notifiche sì). In emergenza uno screenshot può servire: da decidere. |
| A4 | bassa | Con l'impronta si sblocca la **password** salvata (chiave hardware, impronta forte, annullata se cambiano le impronte). È fatto bene, ma il segreto sul telefono è la password. Un token di rinnovo revocabile dal server sarebbe meglio, e va di pari passo con W2. |
| A5 | informativa | La prima installazione si fida del server (HTTPS); gli aggiornamenti li protegge la firma Android. Conviene pubblicare l'impronta SHA-256 del certificato di firma. |

**Aggiornamento, stesso giorno.** A1: le copie per il lavoro senza rete e la
coda delle azioni sono cifrate con la chiave del portachiavi (i file in
chiaro delle versioni vecchie si leggono una volta e al primo salvataggio si
cifrano). A2: le foto in coda di chi era collegato prima si cancellano,
quando la coda scarta le sue azioni e all'avvio per quelle rimaste senza
invio. A3: lasciato com'è, per scelta. A4: l'impronta sblocca un token di
rinnovo revocabile (`/api/app/rinnovo`), non più la password; i dati delle
versioni vecchie passano al token al primo accesso. Nel farlo è emerso che la
proposta dell'impronta dopo l'accesso non si vedeva mai (l'app passava subito
alla home): sistemato. A5: `scripts/pubblica.sh` dell'app scrive l'impronta
SHA-256 del certificato in `versione.json`, e il web la mostra accanto a
"Scarica l'app".

### App: guardato e a posto

Solo HTTPS e solo certificati di sistema (quelli installati a mano solo nella
versione di prova), nessun backup né trasferimento dei dati, token cifrato
AES-GCM con chiave del portachiavi hardware, token mandato solo al proprio
server (anche su rinvii e indirizzi di immagini), QR aperti solo se del proprio
server, unico componente esportato l'avvio, FileProvider non esportato,
PendingIntent immutabili, notifiche con versione pubblica generica sulla
schermata di blocco, foto senza EXIF, log senza dati personali, codice
offuscato nella release, WebSocket ristretto a ciò che riguarda la persona.

### La vecchia app

Il repository Orion-Mobile resta con i difetti trovati a suo tempo (log delle
richieste in chiaro in debug, Gson vecchio). Va ritirata dai telefoni ora che
questa la sostituisce.

## Quarta revisione: la 1.1.0 (5 ottobre 2026)

Il controllo ha riguardato soprattutto quello che la 1.1.0 aggiunge (funzioni
di supporto, strade chiuse e zone sulla mappa, filtri del magazzino, punto di
situazione, rubrica, "Le mie attività" nell'app), ma è ripartito da tutto: ogni
rotta del server chiamata da anonimo, da esterno temporaneo membro di una
funzione e da volontario; i testi pericolosi seminati in ogni campo, vecchio e
nuovo, e cercati nel browser in tutte le pagine, popup della mappa compresi;
le dipendenze con npm audit; il manifest, i log e le parti nuove dell'app.

### Cosa è stato corretto

Con il modulo delle funzioni spento, o a incarico già concluso, un esterno
temporaneo che faceva parte della funzione poteva ancora scrivere note,
caricare foto e spostare il punto della segnalazione. Ora può farlo solo
finché la sua funzione ha su quella segnalazione un incarico da concludere, con
la funzione e il modulo accesi; dopo resta in sola lettura, come per tutto il
resto dell'emergenza.

Due "Concludi" sullo stesso incarico nello stesso istante passavano entrambi:
nel diario finivano due esiti e restava l'ultimo. La riga dell'incarico ora si
blocca dentro la transazione, e il secondo riceve "Incarico già concluso".

Il limite di 8 MB per le richieste della mappa (serve all'importazione dei
livelli da QGIS) valeva anche per chi non era collegato: il server leggeva
tutto il corpo prima di rispondere 401. Ora il limite alto vale solo con un
token valido; agli altri resta quello normale, e un corpo grande riceve subito
413.

I tipi degli elementi della mappa si controllavano con una ricerca che
accettava anche nomi come "constructor". Non c'era un danno (il database
rifiuta i tipi sconosciuti), ma ora valgono solo i tipi dichiarati.

DOMPurify è passato alla 3.4.16. La vulnerabilità segnalata riguarda
un'opzione che ORION non usa, quindi non era sfruttabile, ma l'aggiornamento
non cambia niente altro. Restano due segnalazioni moderate su uuid, che arriva
con exceljs: riguardano funzioni di uuid che exceljs non chiama (usa solo la
v4 senza buffer), e correggerle vorrebbe dire tornare a una exceljs di anni fa.

Ogni correzione ha la sua prova nella suite (398 controlli) e nel collaudo del
WebSocket.

### Guardato e a posto

I permessi delle funzioni tengono: un esterno non si aggiunge ad altre
funzioni, non si fa referente, non prende né conclude gli incarichi delle altre
funzioni, non assegna e non annulla, non scrive a nome di una funzione che non
è la sua e vede solo gli incarichi della propria; un volontario non crea né
spegne funzioni, non mette utenti fissi nelle funzioni (solo gli accessi
temporanei, a emergenza aperta) e non tocca il piano della mappa. Nessun testo
seminato è finito nelle pagine come HTML: punto di situazione, rubrica e sua
stampa, pagina delle funzioni, tavolo delle funzioni nel centro operativo,
etichette sulle schede e nel diario, popup degli elementi della mappa,
pannello del piano, filtri del magazzino. I link della rubrica partono sempre
da "tel:" e "mailto:", quindi un indirizzo scritto apposta non diventa uno
script. Il punto di situazione di un'emergenza chiusa lo vede solo
l'amministratore. Il ripristino dei backup continua a rifiutare i comandi di
psql nascosti nel file. Intestazioni di sicurezza, cookie di sessione
(HttpOnly, Secure, SameSite=Strict) e rifiuto dei token senza firma sono quelli
di prima. Nell'app i messaggi in tempo reale nuovi portano solo l'avviso di
rileggere, i dati li chiede l'app alle rotte che decidono cosa può vedere; le
mappe del telefono si aprono con indirizzi "geo:" costruiti con il testo
codificato; nessun dato personale nei log.

Le letture del magazzino da parte di ogni operatore interno (inventario,
registro, chi ha cosa) e quelle dell'emergenza da parte degli esterni
(segnalazioni con il contatto del segnalante, posizioni delle squadre) sono
scelte del progetto, non difetti: sono scritte nel codice e nel manuale.

## Protezioni aggiunte dopo la quarta revisione (ottobre 2026)

**Il primo amministratore** non si crea più dentro `setup.sh` ma dal browser,
con un codice monouso che ORION scrive in `PRIMO-ACCESSO.txt` (leggibile solo
dal suo utente e da root) e che `setup.sh` mostra alla fine. Senza codice,
il primo che arrivava all'indirizzo appena pubblicato poteva prendersi il
posto dell'amministratore. Il codice ha circa 80 bit di casualità, il
confronto avviene in tempo costante, i tentativi sono limitati e una
richiesta doppia crea un amministratore solo.

**Lo storico inalterabile.** Note, diario di sala, registro delle operazioni,
movimenti e registro delle squadre sono bloccati da trigger contro modifiche
e cancellazioni, e legati in una catena di impronte SHA-256 verificabile
dalla pagina Sistema. L'ultima impronta (il sigillo) esce dal server alla
chiusura di ogni emergenza (a schermo, per email, nel resoconto); un sigillo conservato smaschera anche chi, con il server in mano,
spegne i trigger e ricalcola tutta la catena. La prova la fa
`tests/integrita.mjs` nel ruolo dell'attaccante. La cancellazione delle
emergenze archiviate resta possibile, ma resta scritta nella catena.

**La cifratura** (AES-256-GCM) copre i file riservati, i backup e la password
della posta, che non torna più al browser. Protegge dalle copie che escono
dal server (backup, dischi), non da chi controlla il server mentre ORION
gira: lì la chiave è in memoria. I campi del database (esiti delle visite,
anagrafica) restano in chiaro dentro PostgreSQL: servono a cercare, ordinare
e contare, e nei backup sono comunque cifrati. Il rischio nuovo è perdere la
chiave: per questo la chiave di recupero, da conservare fuori dal server, e
il riquadro che lo ricorda finché non la si segna come conservata.

**La verifica in due passaggi** (TOTP, RFC 6238) è obbligatoria per gli
amministratori e per chi ha il permesso dei dati sanitari (visite mediche e
corsi), facoltativa per gli altri, esclusi gli accessi temporanei.
Una password rubata, indovinata o finita in una raccolta di password trapelate
da altri siti non basta più per entrare come amministratore, e quindi non
basta per vedere la chiave di recupero. La sessione d'amministratore senza
il contrassegno della verifica viene rifiutata a ogni richiesta, anche sul
WebSocket. Il segreto sta cifrato con la chiave dei dati, i codici di riserva
solo come impronta, lo stesso codice non vale due volte e la sfida cade dopo
cinque errori. Restano fuori, per come è fatta: chi ruba insieme password e
telefono sbloccato, chi inganna la persona facendosi dettare un codice (vale
30 secondi, ma vale), e chi controlla il server, che il segreto lo può
leggere. L'impronta dell'app vale come secondo passaggio, perché il token di
rinnovo sta nel portachiavi hardware del telefono dietro il sensore.

---

## Cosa NON è stato guardato

Onestà sul perimetro:

- i pacchetti vendorizzati in `public/vendor` (le dipendenze npm sì, nella terza revisione);
- nessuna prova di carico o di negazione del servizio;
- nessuna verifica della configurazione del server (nginx, firewall,
  aggiornamenti di sistema), che non sta nel codice;
- l'app Android su un telefono vero (la terza revisione è sul codice e sulle
  prove automatiche);
- l'app in esecuzione su un telefono con i permessi di root.

## Dai ruoli ai permessi (ottobre 2026)

Le rotte chiedono permessi (`src/permessi.js`) invece di ruoli. I permessi in
più li concede solo l'amministratore, che resta l'unico a gestire account,
ruoli e permessi: chi potesse darne se li darebbe tutti. Non si concedono agli
esterni (rifiuto 409, e comunque `permessiDi()` non ne dà a chi ha il ruolo
esterno). Ogni concessione e revoca va nel registro. Il permesso dei dati
sanitari porta con sé la verifica in due passaggi: concesso a chi non l'ha,
la sessione in corso cade (401 `mfa_richiesta`) e al nuovo accesso la si
attiva. Chi gestisce l'anagrafica legge il libretto degli altri senza visite
e corsi. Consegne e rientri del magazzino, prima aperti a ogni interno, ora
chiedono il loro permesso anche dal web.


## L'archivio dei documenti del gruppo (ottobre 2026)

Caricare, cambiare e togliere chiede `gruppo.documenti`; collegare un
documento a un bene anche `magazzino.gestione`. Chi vede un documento lo
decide il server per ogni richiesta, elenco e file compresi: un documento
riservato a certi ruoli, o non segnato per l'emergenza quando chiede un
esterno, risponde 404 come uno che non esiste, e un esterno non vede più
niente appena l'emergenza si chiude. Il file si accetta solo nei formati
ammessi e se il contenuto corrisponde all'estensione (un eseguibile
rinominato in .pdf si rifiuta), fino a 25 MB; il nome sul disco è casuale,
il file si cifra subito come gli altri caricamenti e si manda con
`X-Content-Type-Options: nosniff`, in linea solo PDF e immagini. Ogni
operazione va nel registro.

Sul telefono i documenti "sempre con me" stanno in chiaro nei file dell'app,
perché li deve aprire il visualizzatore: li proteggono la sandbox e la
cifratura del telefono, non un telefono con i permessi di root. Sono
documenti del gruppo, non dati personali; chi carica un documento riservato
non lo segna "sempre con me" se non vuole che stia sui telefoni. L'elenco è
cifrato come gli altri file, le copie restano fuori dai backup del telefono
e si cancellano all'uscita o quando entra un'altra persona. Una copia si
tiene solo se la sua impronta SHA-256 è quella che dice il server.


## Attività, calendario e presenze (ottobre 2026)

Organizzare chiede `gruppo.attivita`; il responsabile di un'attività la
gestisce senza il permesso, ma non può nominare un altro responsabile né
creare attività nuove. Chi vede un'attività lo decide il server a ogni
richiesta (chi organizza, il responsabile, i convocati, e tutti gli interni
solo per quelle "per tutti" o "aperte"): un'attività non visibile risponde
404 come una che non c'è, e gli esterni non vedono il calendario né hanno
presenze. Le scadenze nel calendario seguono i permessi dei moduli: quelle
di visite e corsi degli altri solo a chi ha `volontari.sanitario`, quelle
del magazzino a chi ha `magazzino.gestione`; a tutti gli altri le proprie.
Il calendario mostra solo il tipo e la data di una visita, mai l'esito.

Le email di convocazione ripuliscono ogni campo scritto da chi organizza, e
il collegamento porta al calendario, dove serve l'accesso. Il controllo dei
posti di un'attività aperta blocca la riga, così due adesioni insieme non
superano il limite. Le presenze in emergenza le scrive il server dal
registro delle squadre, che non si cambia; le correzioni chiedono il
permesso e restano nel registro delle operazioni con il prima e il dopo.
L'attestato lo scarica la persona stessa o chi vede tutte le presenze. Nel
CSV del riepilogo una cella che comincia con un segno di formula esce con un
apostrofo davanti, perché il foglio di calcolo non la esegua.

La squadra COC non manda posizioni (il server rifiuta con 409) e non si
assegna agli interventi; chi ne fa parte, esterni compresi, legge tutte le
segnalazioni dell'emergenza in corso, come già chi sta nel centro operativo,
e niente di più: chiusa l'emergenza l'esterno perde l'accesso come prima.

## Chiamata, simulazione e copione (ottobre 2026)

Chiamare le persone in emergenza chiede `emergenze.apertura` o
`gruppo.attivita`, e per un allertamento la gestione dell'attività; gli
esterni non chiamano e non sono chiamati. Una chiamata la legge chi è stato
chiamato e chi può chiamare; per gli altri risponde 404. Ognuno risponde
solo per sé, e "Sono arrivato" scrive solo la propria disponibilità; segnare
gli arrivi degli altri è della sala. Le assenze le scrive ognuno per sé, e
l'elenco con il motivo lo vede solo chi organizza o chiama. Ogni chiamata,
risposta, arrivo, congedo, turno e assenza resta nel registro delle
operazioni.

Il copione è della regia: chi organizza le attività, il responsabile e i
registi scelti. Agli altri le rotte del copione e della regia rispondono 403,
e il copione di un'attività che non si vede risponde 404 come le attività.
La risposta attesa e i tempi attesi non escono mai verso i partecipanti
finché la regia non pubblica copione e debriefing, e la pubblicazione vale
solo a sala chiusa. Il debriefing concluso non si cambia più.

Il foglio Excel si carica in memoria, fino a 2 MB, e non si salva su disco.
Si legge con ExcelJS solo come valori: una cella con una formula vale per il
risultato che vi è salvato, e niente viene eseguito. Il foglio si controlla
tutto prima di scrivere, con i limiti di lunghezza dei campi e i valori
ammessi, e se una riga è sbagliata non si carica niente. Il copione
scaricato scrive le celle come testo, così una riga che comincia con un
segno di formula non diventa una formula aprendolo. Le pagine del copione e
della regia mettono in pagina i testi scritti dagli utenti come testo, mai
come HTML.

Una simulazione non si confonde con un'emergenza vera: il segno è nel
database (`emergencies.simulazione`) e non in un nome che si possa
scrivere, e lo riportano stato, notifiche, stampe e app. Un regista che non
ha `emergenze.apertura` chiude la sua simulazione ma non apre emergenze vere
(403), e un'emergenza vera interrompe la simulazione solo con la conferma
esplicita di chi la apre.

## Aggiornamento dell'app e impronta (ottobre 2026)

L'app si aggiorna da sola dal server dell'associazione. Prima di passare
l'APK all'installatore di Android controlla che sia proprio ORION, la
versione annunciata e più recente, e firmato con la stessa chiave dell'app
installata; un APK diverso si butta. Android stesso rifiuta comunque un
aggiornamento firmato con un'altra chiave, quindi un server compromesso non
può far installare un'app sua al posto di ORION. Il permesso di installare
app lo dà la persona, una volta, dalle impostazioni di Android, e vale solo
per ORION.

Un'impronta registrata prima che la persona avesse la verifica in due
passaggi non apre più la porta da sola: il server chiede il codice, una volta,
subito dopo l'impronta, e solo con il codice giusto segna quel token come
verificato. Prima veniva cancellato, e bisognava rientrare con password e
codice e registrare di nuovo l'impronta. Il token resta legato al telefono e
dietro il sensore; il codice chiesto una volta sola chiude il caso di chi
avesse creato un token con la sola password prima che la verifica fosse
attiva. Chi deve ancora attivare la verifica la attiva dal browser, come
prima, e il suo token vecchio si cancella.

## Rete scarsa (ottobre 2026)

Il centro operativo tiene nel browser, in `localStorage`, l'ultima
situazione ricevuta (segnalazioni con i loro dettagli, squadre, posizioni,
mappa, eventi, rubrica), per mostrarla quando il server non risponde. Sono
dati che chi è davanti a quella postazione ha già visto, ma restano sul
disco del computer: ogni voce è legata all'utente che l'ha letta, e un
altro utente sullo stesso browser non la vede; l'uscita da ORION le
cancella tutte. Restano invece le operazioni in coda di chi è uscito senza
che partissero: ripartono solo quando rientra la stessa persona, con la sua
sessione, e mai con quella di un altro. Sui computer della sala condivisi
si esce da ORION a fine turno, come già si faceva.

Le chiavi di idempotenza sono per persona: la stessa chiave di un altro
utente è un'altra chiave, e una chiave non fa ripetere a nessuno una
risposta che non era sua. La stessa chiave con un corpo diverso è
rifiutata, così una chiave indovinata non serve a riscrivere niente.

La cartografia del territorio si carica e si toglie solo con il permesso
del piano (`emergenze.piano`); il file si apre in sola lettura con
`node:sqlite` e se ne leggono solo i tasselli e i metadati, con istruzioni
preparate. Prima di sostituire quella di prima il server controlla che sia
davvero un database SQLite con le tabelle di un MBTiles e tasselli raster.
I tasselli si leggono solo con l'accesso, come il resto della mappa; non
contano nei limiti di frequenza, ma passano comunque dall'autenticazione.
