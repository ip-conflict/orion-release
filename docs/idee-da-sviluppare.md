# Idee da sviluppare o da approfondire

Il promemoria di quello che è stato discusso e non è ancora fatto, con le
scelte già prese. Si aggiorna quando un'idea entra in ORION (e allora si
toglie da qui) o quando cambia.

## In corso di verifica

### Avvisi sul telefono ad app chiusa

Fatti il token degli avvisi e il servizio "Avvisi attivi" (app 1.2.0), ma
non ancora provati su telefoni veri. Le prove da fare sono nel collaudo,
passi 22-bis e 22-ter: la prova ad app chiusa e schermo spento, la notte col
telefono fermo, il riavvio. Conviene farle su più marche, soprattutto Xiaomi
e Samsung. Da misurare il consumo della batteria: il server manda un ping ai
collegamenti degli avvisi ogni due minuti (`INTERVALLO_PING_AVVISI` in
`src/tempoReale.js`), che si può allungare se consuma troppo.

Restano due rifiniture. Sospendendo una persona il suo collegamento già
aperto non si chiude subito (il token non vale più, ma il collegamento cade
solo al primo ritorno): si può chiuderlo dal server. E nel centro operativo,
quando si compone una squadra, si può mostrare accanto a ciascuno se il suo
telefono è in ascolto, come già in Gestione utenti; magari anche un avviso
nella home dell'app quando gli avvisi sempre attivi sono spenti.

### APK 1.2.1 e 1.2.2, aggiornamento automatico

La 1.2.0 è pubblicata. La 1.2.1 (aggiornamento automatico, impronta con il
codice una volta, libretti dei beni nell'app e sul telefono finché si hanno
in carico) e la 1.2.2 (note e foto con la chiave d'idempotenza, posizione
con l'età del rilevamento) vanno compilate dal branch dell'app, firmate con
la chiave dello sviluppatore e caricate su master con il loro
versione.json; basta pubblicare la 1.2.2, che contiene la 1.2.1. Chi ha la
1.2.0 la installa a mano un'ultima volta; da lì in poi l'app si aggiorna da
sola. Da provare su telefoni veri: il permesso di installare, la prima
conferma, e che da Android 12 la seconda non la chieda più.

### Rete scarsa alla prima prova vera

Fatta in ottobre 2026: le scritture con la chiave d'idempotenza, il centro
operativo che senza server mostra l'ultima situazione e mette in coda
segnalazioni, note, stati, priorità e diario di sala, il conflitto sul
cambio di stato, la cartografia del territorio sul server, la posizione dal
telefono con l'età del rilevamento. Le prove sono nel collaudo (83-bis e
seguenti). Restano da vedere in una sala vera: quanto pesa un MBTiles del
comune agli zoom utili e se il server lo regge bene con più postazioni;
se in coda servono anche le assegnazioni delle squadre (oggi no: senza
server non si sa quali squadre sono davvero libere); se conviene una
copia della pagina nel browser (service worker) per poterla riaprire anche
senza server, che oggi non si riapre.

### Chiamata e simulazione alla prima prova vera

Il quarto livello delle attività è entrato in ORION in ottobre 2026 (server,
web e app 1.2.0): la chiamata dei volontari con reperibilità e assenze, la
simulazione in sala per addestramenti ed esercitazioni, il copione con la
mappa e da Excel, la regia nel centro operativo e sul telefono, la
valutazione e il debriefing. Fuori, per scelta, solo i benefici di legge,
qui sotto. Poi sono arrivati la simulazione al volo dal centro operativo,
gli eventi che escono allo zero del conto alla rovescia, le zone di
pericolo, le comunicazioni in primo piano. Le prove sono nel collaudo;
resta da vederlo in un addestramento vero, con la sala piena: se i registi
meno pratici trovano da soli "Avvia lo scenario" e "Collega", e se le misure
della valutazione (squadra, prima notizia, chiusura) sono quelle che servono
al debriefing o ne manca qualcuna.

## Proposto, da confermare

### Benefici di legge

Lasciati fuori dal quarto livello, per ora. L'attestato di presenza per il datore di lavoro (articolo 39 del Codice
della protezione civile) e il rendiconto delle spese dell'emergenza
(articolo 40: chilometri dei mezzi, carburante, materiali consumati), dai
dati che ORION ha già: presenze in squadra, chilometri dei verbali,
magazzino.

### Registro dei volontari e assicurazione

Ricavati dall'anagrafica, con data di ingresso e di uscita e scadenza della
copertura assicurativa. Quote e contabilità fuori: le fanno meglio i
gestionali dedicati.

### Abilitazioni e patenti

Le abilitazioni (motosega, piattaforme di lavoro elevabili) restano corsi
con validità. Le patenti (B, C, di servizio di protezione civile, nautica)
in una sezione nuova del fascicolo, con numero, scadenza e foto facoltativa,
controllate di notte come le visite. Sui modelli del magazzino i requisiti
si scelgono da un elenco (oggi la patente dei mezzi è testo libero). Alla
consegna di un mezzo o di un'attrezzatura un avviso se manca il requisito,
senza bloccare: si procede indicando il motivo, che resta nel registro.
Nella composizione delle squadre ogni persona mostra le sue abilitazioni, e
un avviso se la squadra ha un mezzo che nessuno può guidare.

### Comunicazioni al gruppo

Circolari con presa visione ("nuova procedura motosega, letta da 18 su
25"), appoggiate all'archivio dei documenti, che c'è: un documento nuovo o
una versione nuova potrebbero chiedere la presa visione a chi deve leggerli,
con l'avviso sul telefono.

### Archivio dei documenti: rifiniture

L'archivio c'è, e i libretti si caricano e si collegano dalla scheda del
bene, anche a tutti i beni uguali, si aprono nell'app e stanno sul telefono
finché il bene è in carico. Restano da valutare: una scadenza di revisione
per i documenti (il piano va rivisto ogni tanto) con un avviso a chi tiene
l'archivio; il collegamento di un libretto a un modello di DPI a taglie
oltre che ai singoli beni.

### Centro operativo: due punti rimasti delle notifiche

Il punto 4, "chi la sta seguendo" sulla scheda di una segnalazione, e il
punto 6, un richiamo sonoro per le segnalazioni urgenti che nessuno apre.

### Una prova sul campo

Un'esercitazione vera con un gruppo, usando ORION dall'inizio alla fine: è
lì che escono le cose che sulla simulazione non si vedono.
