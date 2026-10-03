# Ruoli multipli e modulo Magazzino — architettura

Documento di progetto concordato prima dell'implementazione. Serve a chi
scriverà il codice (me compreso, fra qualche mese) per ritrovare **le decisioni
e soprattutto il perché**: le decisioni si deducono dal codice, le ragioni no.

---

## Parte 1 — Ruoli multipli

### Il problema

`users.role` è un valore solo. Serve che una persona possa essere, per dire,
segretaria **e** magazziniera. Il campo singolo è letto dal token di sessione,
da quattro middleware, da undici query e dalla barra laterale di ogni pagina:
non è una modifica del magazzino, è una modifica di come ORION decide chi può
fare cosa.

### Il modello

Tabella **`utenti_ruoli`** (utente, ruolo): i ruoli diventano capacità che si
sommano.

Due regole semantiche, non tecniche:

- **`admin` le comprende tutte.** A un amministratore non si assegnano ruoli:
  può già tutto. Evita che il presidente non apra una pagina perché nessuno gli
  ha spuntato una casella.
- **`esterno` è esclusivo.** Non è una capacità ma una limitazione: vede solo
  ciò che lo riguarda. "Esterno + magazziniere" non significa niente e va
  rifiutato, non lasciato configurare per sbaglio.

### Perché `users.role` resta

Non come seconda verità, ma come **ruolo principale derivato**: il più alto
secondo l'ordine fisso `admin › segreteria › magazziniere › volontario ›
esterno`. Viene ricalcolato dal codice a ogni modifica dei ruoli.

Serve a tre cose concrete:

1. **Compatibilità con l'app Android**, che legge `role` dalla risposta di
   login. Tenerlo costa una riga; toglierlo costerebbe una versione dell'app.
2. **Le dieci query `role != 'esterno'`** continuano a funzionare senza
   riscritture, perché `esterno` è esclusivo: se il ruolo principale è
   `esterno`, quello è l'unico ruolo.
3. **Visualizzazione**: negli elenchi serve una parola sola.

L'unica query che esprime una *capacità* (`role IN ('admin','segreteria')`, i
destinatari del report mensile) passa invece su `utenti_ruoli`.

> Regola da ricordare: `users.role` si legge, non si scrive mai a mano. La
> verità dei permessi sta in `utenti_ruoli`.

### Nel token di sessione

Il JWT porta `ruoli: ['segreteria','magazziniere']` **e** `role` con il
principale. Il web usa l'elenco, l'app continua col singolo.

In realtà i ruoli **si rileggono dal database a ogni richiesta**, dentro
`authenticateToken`, insieme ai due controlli che già si facevano (token
revocato, account attivo): è la stessa interrogazione, quindi non costa un
viaggio in più. Il motivo è la stessa lezione della sospensione degli account:
se la segreteria toglie un ruolo a qualcuno e la perdita di permessi arriva alla
scadenza del token, cioè fino a un giorno dopo, il pulsante non fa quello che
chi lo preme crede. Quello che sta nel token resta come ripiego per le sessioni
aperte prima dell'aggiornamento.

### I controlli

I quattro middleware attuali (`checkAdminRole`, `checkSegreteriaAccess`,
`checkAdminOrSegreteriaRole`, `checkOwnershipOrSegreteria`) diventano
espressioni di una funzione sola, che tiene conto dell'admin. È anche il punto
dove si possono introdurre buchi: va fatto con la batteria di controlli sotto,
verificando sia che nessuno perda accessi sia che nessuno ne guadagni.

### Chi assegna i ruoli

Solo l'amministratore, dalla schermata utenti (caselle al posto del menu a
tendina). La casella **Volontario** parte spuntata: in una associazione di
protezione civile quasi tutti sono volontari e chi fa segreteria o magazzino lo
fa *in più*, non *invece*.

Un amministratore non può togliersi l'amministrazione da solo: resterebbe fuori
dal pannello senza poterci rientrare. È la stessa protezione che esiste già
contro l'auto-eliminazione.

### Cosa è emerso realizzandolo

Tre cose che il progetto sulla carta non prevedeva, annotate perché
ricapiteranno:

1. **Il ruolo iniziale lo mette il database, non il programma.** Gli utenti si
   creano da quattro posti diversi (pannello admin, importazione da foglio,
   registrazione pubblica, console SQL): bastava dimenticarne uno per avere una
   persona senza nessun ruolo, cioè senza nessun accesso. Un trigger
   `AFTER INSERT ON users` copia `users.role` in `utenti_ruoli` e la garanzia
   vale per tutti e quattro i percorsi, compresi quelli che scriveremo domani.

2. **`ARRAY(SELECT ruolo …)` va castato a `::text`.** Per un tipo enumerato
   definito da noi la libreria `pg` non sa leggere un vettore e restituisce la
   stringa grezza di PostgreSQL (`{admin}`) invece di un elenco. Il programma
   partiva, il login rispondeva 200 e ogni pagina dava 403: il difetto si vede
   solo provandolo davvero.

3. **`esterno` era offerto dall'interfaccia e rifiutato dal server.** Il menu a
   tendina lo proponeva da sempre, il controllo lo scartava con "Ruolo non
   valido" su una voce che il programma stesso aveva offerto. Ora si può
   assegnare, da solo, e l'esclusività è scritta in tre punti: le caselle si
   spengono a vicenda, il server risponde con una frase comprensibile, il
   database rifiuta comunque la combinazione.

---

## Parte 2 — Magazzino

### L'idea di fondo

Non tre moduli (DPI, attrezzature, veicoli) ma **una anagrafica dei beni e un
registro dei movimenti**, con tre viste sopra. Le quattro domande sono le
stesse per tutti: *dov'è, chi ce l'ha, quando scade, quando torna.*

Il registro è la fonte della verità; lo stato attuale è calcolato, non scritto
a mano. Stesso schema del registro delle squadre dell'emergenza.

### Le famiglie e dove differiscono

|                 | DPI                     | Attrezzature              | Veicoli                              |
|-----------------|-------------------------|---------------------------|--------------------------------------|
| Destinatario    | persona                 | squadra o veicolo         | squadra                              |
| Durata          | mesi o anni             | ore o giorni              | ore o giorni                         |
| Identità        | taglia, a volte matricola | matricola *o* sfuso     | targa, sempre singolo                |
| Scadenze        | fine vita               | verifiche periodiche      | revisione, assicurazione, bollo, tagliando |
| Perché conta    | obbligo di legge sulla consegna | il pezzo che manca blocca l'intervento | senza revisione non esce dal cancello |

Due distinzioni decise, che se sbagliate ora si pagano dopo:

- **Singoli contro sfusi.** La motosega ha matricola e storia; i sacchi no: ne
  escono 40 e ne rientrano 12. Trattarli uguali costringe a inventare duecento
  finti "sacco #1". Il bene porta scritto come si gestisce.
- **Il veicolo è un contenitore.** L'idrovora *sta sul Daily*. Se il modello
  non lo prevede, qualcuno lo scrive nelle note e quell'informazione diventa
  inservibile.

### Tabelle

| Tabella | Contenuto |
|---|---|
| `beni` | tipo (dpi/attrezzatura/veicolo), gestione (singolo/quantità), categoria, denominazione, codice etichetta, matricola o targa, taglia, stato, ubicazione, quantità totale; per i veicoli km, patente richiesta, posti; facoltativi per la rendicontazione: data acquisto, valore, fornitore |
| `categorie_beni` | catalogo a nomi unici (senza distinzione di maiuscole né spazi ai bordi, come corsi e visite) |
| `ubicazioni` | sede, container, garage; i veicoli sono a loro volta contenitori |
| `beni_scadenze` | una riga per tipo di scadenza, con data, ultimo controllo, documento |
| `movimenti` | il registro (vedi sotto) |
| `verbali_consegna` | l'atto firmato: destinatario, elenco, stato, scansione |

Tipi di scadenza fissi: revisione, assicurazione, bollo, tagliando, verifica
periodica, scadenza DPI, collaudo. Renderli configurabili dopo costa poco;
farlo adesso aggiunge una schermata che forse nessuno aprirà.

### Vocabolario dei movimenti

| Movimento | Da → a | Note |
|---|---|---|
| `carico` | esterno → magazzino | acquisto, donazione, rientro dall'officina |
| `consegna` | magazzino → persona / squadra / veicolo | |
| `rientro` | chiunque → magazzino | |
| `trasferimento` | chiunque → chiunque | succede sul campo senza passare dal magazzino |
| `manutenzione` | → officina | esiste ma non è disponibile |
| `consumo` | esce e non torna | solo sfusi |
| `smarrimento` | esce e non torna | nota obbligatoria |
| `dismissione` | fine vita | esce dagli elenchi, resta nella storia |
| `rettifica` | correzione | dopo un inventario fisico |

Perché le ultime due esistono: **non si cancella mai** un bene (lezione della
squadra eliminata che si portava via tutti i suoi interventi), e senza un modo
onesto di dire «contati, sono 178 non 200» i numeri divergono, e appena
divergono nessuno li guarda più.

### Regole garantite

- Un bene singolo ha **un solo detentore** in ogni istante.
- Giacenza di uno sfuso = totale − in giro − consumato − smarrito ± rettifiche.
  Un calcolo, non un numero digitato.
- Ogni movimento porta chi, quando, e l'emergenza se ce n'era una.
- Nome del detentore e denominazione del bene sono **scritti dentro** al
  movimento, non solo collegati: deve restare leggibile quando il veicolo è
  stato venduto e il volontario non è più iscritto.

### Consegna dei DPI

Il magazziniere registra la consegna. Poi, a scelta dell'associazione:

- **conferma digitale** (attivabile dalle impostazioni): il volontario la trova
  nel fascicolo e la accetta; chi non conferma resta "in attesa";
- **verbale di consegna stampabile** con i dettagli degli oggetti, che il
  volontario firma su carta; il magazziniere lo fotografa o scansiona e lo
  carica, e resta allegato al verbale nel fascicolo.

Il verbale raggruppa più oggetti: un volontario riceve elmetto, giacca e
scarponi con un foglio solo. Per questo i movimenti puntano al verbale e non
viceversa.

Lo stesso verbale serve al **rientro** (`tipo = 'rientro'`): firma chi
restituisce, e nasce "da firmare" invece che "da confermare", perché chi riceve
è il magazzino e non c'è niente da accettare dal telefono. La foto del foglio
(`scansione_file`, in `protected_uploads/magazzino/verbali`) si serve solo da
`/api/magazzino/verbali/:id/scansione`, con i permessi del verbale; il nome del
file non esce mai dal server, e l'estensione la decide il tipo del file, non il
nome che aveva sul telefono.

### I quattro schermi

Per volontari poco pratici il modulo è utile solo se questi sono a un tocco:
**consegna** (chi → cosa → fatto), **rientro** (chi → spunta cosa torna),
**chi ha cosa**, **cosa manca e cosa scade**. Il resto è amministrazione e sta
in fondo a un menu.

Al rientro: sugli sfusi, se torna meno di quanto è uscito, chi registra dice
cosa ne è del resto (`resto`: `in_carico`, `consumo` o `perso`, che diventa uno
`smarrimento`). All'inizio la differenza diventava consumo da sola; per i DPI
personali era sbagliato (i guanti che il volontario tiene risultavano
"consumati"), e qualunque default lo sarebbe per metà dei casi: così un rientro
parziale senza la scelta è rifiutato. Sui veicoli si chiedono i km.

### Innesti su quello che esiste

- **Scadenze** → stesso cruscotto e stesse email della segreteria (che non
  perdono più le scadenze vecchie e recuperano i giorni di server spento).
- **Emergenza** → i movimenti si agganciano all'emergenza attiva; il resoconto
  guadagna *"Mezzi e materiali impiegati"*.
- **Fine emergenza** → ciò che non è rientrato **resta fuori** e finisce in
  *"da recuperare"*, con chi ce l'ha (e, se era una squadra sciolta, chi ne
  faceva parte). A differenza dei volontari, una motosega in giro è un problema
  vero, non una formalità. Avvisi al magazziniere dopo N giorni configurabili,
  con la stessa posta delle scadenze. La riga si chiude solo con un movimento
  esplicito: rientrata o dichiarata persa.
- **Blocco mezzi scaduti** → impostazione a tre stati (blocco / solo
  segnalazione / disattivato), come i vincoli della segreteria.
- **Roba orfana** → sciogliere una squadra o eliminare un volontario che ha
  beni in carico **si ferma** e chiede riga per riga: *rientrata*, *persa* o
  *da recuperare*. Ogni scelta genera il suo movimento col nome di chi ha
  deciso: fra un anno si saprà che quella motosega risulta persa perché
  qualcuno l'ha dichiarata persa, non perché è svanita da un elenco.
- **`user_equipment`** → migra dentro e sparisce. I DPI già consegnati
  diventano beni col loro movimento di consegna; il fascicolo continua a
  mostrarli leggendo dal registro.
- **Etichette QR** → come i tesserini (`qrcodejs` è già in casa): si inquadra e
  si apre la scheda del bene.
- **Registro operazioni** → carichi, dismissioni e smarrimenti nell'audit, come
  già fanno squadre e utenti.

### Permessi

| Operazione | Chi |
|---|---|
| consegna, rientro, trasferimento | qualunque operatore collegato |
| carico, dismissione, smarrimento, rettifiche, anagrafica beni | `magazziniere` (e `admin`) |

I movimenti operativi restano aperti perché in emergenza non si aspetta
nessuno, e ogni movimento porta il nome di chi l'ha fatto. Gli atti che
incidono sull'inventario da rendicontare no.

Il magazziniere non vede la segreteria e viceversa: i ruoli sono capacità
indipendenti.

### Fuori perimetro (per ora)

Ordini d'acquisto, fornitori, valorizzazione contabile, prenotazioni future,
manutenzione programmata a chilometri, consumi di carburante.

### Questione aperta

I veicoli possono richiedere una patente specifica (C, E, o l'abilitazione
interna alla guida). Oggi le patenti non esistono in ORION. Il requisito si può
**registrare e mostrare** al momento dell'assegnazione, ma **non verificare**
finché le abilitazioni dei volontari non stanno da qualche parte —
presumibilmente come corsi nel catalogo della segreteria, con scadenza.
Decisione rimandata.

---

## L'interruttore del modulo

Come la segreteria, il magazzino si accende dalle impostazioni e **parte
spento**: un'associazione che tiene l'inventario su un quaderno non deve
trovarsi una voce di menu che non userà mai.

La chiave `magazzino_enabled` è separata da `magazzino_config` di proposito.
L'interruttore lo decide l'amministratore dalla sua pagina, le opzioni di
funzionamento (blocco dei mezzi scaduti, conferma dei DPI, avvisi sul materiale
non rientrato) le decide il magazziniere dalla scheda *Impostazioni*. Se stessero
nello stesso oggetto JSON, chi salva per ultimo cancellerebbe le scelte
dell'altro senza accorgersene.

Il controllo sta in un `app.use('/api/magazzino', …)` solo, prima di tutte le
rotte: aggiungerne una domani e dimenticarsi il controllo lascerebbe una porta
aperta su un modulo che l'associazione crede chiuso. Le rotte rispondono 403 con
un contrassegno `modulo_spento`, che la pagina riconosce per mostrare una
schermata che spiega invece di riempirsi di errori.

---

## Cosa è emerso realizzando il magazzino

1. **La modale chiusa si mangiava tutti i clic.** L'attributo `hidden` vale
   `display: none`, ma qualunque regola di `display` lo batte: `\.modale
   { display: flex }` lasciava la finestra stesa sopra la pagina, invisibile e
   cliccabile. La pagina sembrava funzionare finché non la si toccava.

2. **Il nome di chi opera non stava nella sessione.** Il token porta id,
   username e ruoli, non nome e cognome: tutti i registri che dovrebbero dire
   *"Anna Rossi"* scrivevano *"rossia"*, e l'avviso del documento caricato
   annunciava *"undefined undefined"* a tutte le postazioni. Erano difetti
   preesistenti, trovati perché il magazzino scrive il nome in ogni movimento.
   Ora nome e cognome arrivano dalla stessa interrogazione che già controlla
   token revocato e account attivo, quindi senza un giro in più.

3. **Il magazziniere non poteva vedere l'elenco delle persone.** `/api/users` è
   di admin e segreteria: un magazziniere che non è né l'una né l'altra cosa
   non avrebbe potuto consegnare niente. Ha una rotta sua, che restituisce solo
   nome e cognome di chi può ricevere materiale — non email, codici fiscali e
   stato degli account.

4. **`hidden` non basta a nascondere, e costa caro.** L'attributo vale
   `display: none`, ma qualunque altra regola di `display` lo batte. La modale
   chiusa restava stesa sopra la pagina, invisibile, e si mangiava ogni clic;
   la scheda di un bene mostrava "Quantità in magazzino" su un pezzo unico e i
   chilometri su una motosega. Una riga `[hidden] { display: none !important }`
   in testa al foglio di stile risolve la categoria intera: nascondere qualcosa
   deve bastare a nasconderlo.

5. **Il registro come unica verità ha ripagato subito.** Giacenze e detentori
   non sono colonne: sono due viste SQL (`movimenti_effetti`,
   `beni_situazione`). La regola "un bene singolo ha un solo detentore" non ha
   avuto bisogno di nessun vincolo, perché il detentore è la destinazione
   dell'ultimo movimento e di ultimo movimento ce n'è uno solo.

---

## Correzioni dopo il primo uso

**I DPI non sono materiale in ritardo.** Il modello originale trattava allo
stesso modo una motosega uscita ieri e un elmetto in dotazione da tre anni: per
il registro sono entrambi "fuori". Ma la domanda che fa la lista *da recuperare*
è «cosa manca», e un elmetto addosso a un volontario non manca. Con tutti i DPI
dentro, quella lista diventa lunga di righe che non sono un problema, e una
lista così non la guarda più nessuno — insieme alle due righe che invece
contano.

Restano fuori dal filtro i DPI di un volontario **cancellato**: lì il
collegamento all'anagrafica è saltato (`destinatario_user_id` è NULL ma il nome
resta scritto nel movimento) e qualcuno deve decidere fra riconsegna e perdita.
È esattamente l'esito della scelta *"da recuperare"* nella cancellazione di un
utente.

**La provenienza dei movimenti** (update-22). Il registro resta a sola
destinazione, ma dismissione e smarrimento hanno bisogno di sapere da dove
tolgono il bene: dismettere un DPI che è in dotazione scalava la giacenza del
magazzino, dove quell'elmetto non era. La provenienza non si chiede a chi
scrive — la calcola il programma guardando dov'era il bene un istante prima — e
si congela nella riga perché serve anche dopo, nei conti.

**Le manutenzioni sono uno storico, non una riga.** `beni_scadenze` dice quando
scade la prossima; `interventi_manutenzione` tiene tutti quelli fatti, ognuno
col suo verbale. Sovrascrivere avrebbe buttato via il certificato precedente, e
per un'attrezzatura che deve dimostrare di essere stata revisionata quel foglio
è il punto. Il documento è **facoltativo** di proposito: obbligarlo significa
che chi non ce l'ha non registra l'intervento, e allora il registro è peggio di
prima.

**Le etichette QR** portano l'indirizzo della scheda, non un numero: si
inquadrano con la fotocamera di qualunque telefono e si apre ORION alla pagina
giusta, senza applicazioni. Dentro c'è il **codice** e non l'id, perché se un
giorno il magazzino viene ricostruito da un salvataggio gli id possono cambiare
e l'adesivo sulla motosega no.

**Le operazioni senza pulsante.** Carico, dismissione, smarrimento,
manutenzione e rettifica avevano l'API dal primo giorno e nessuna interfaccia:
il magazziniere non poteva buttare un DPI scaduto se non dal database. Stanno
sulla scheda del bene, che è dove uno le pensa.

---

## Idea parcheggiata: registrare le comunicazioni radio

*Non da fare adesso. Queste righe servono a ritrovare il ragionamento quando lo
si riprenderà in mano.*

### La domanda

Durante un'emergenza passa per radio la metà di quello che succede, e nel
fascicolo non ne resta niente. Si può registrare e trascrivere?

### Cosa è facile e cosa no

La parte **ORION** è facile e assomiglia a cose già fatte: una tabella
`comunicazioni_radio` agganciata a `emergency_id`, le voci nella colonna eventi
del centro operativo, una sezione nel resoconto. Un giorno di lavoro, tutto
terreno noto.

La parte difficile è **prendere l'audio**, e dipende dalla radio:

- **Analogico (VHF/UHF, PMR)** e **DMR non cifrato**: semplice. Si preleva
  l'audio dall'uscita altoparlante o dalla presa accessori della stazione base
  in sala radio. Un programma che taglia sul silenzio produce un file per ogni
  passaggio.
- **TETRA**: dipende interamente da *quale* rete. Se è la rete regionale di
  protezione civile, il traffico è quasi sempre cifrato sull'interfaccia radio e
  l'infrastruttura non è dell'associazione: non si intercetta, si passa da una
  **postazione operatore autorizzata** che abbia un'uscita audio o
  un'interfaccia verso un sistema di sala. Se è una rete propria, si torna al
  caso semplice.

> **Prima domanda da fare prima di scrivere una riga di codice**: su quale rete
> e con quali apparati lavorano davvero? Tutto il resto dipende da lì.

### L'architettura che regge indipendentemente dalla tecnologia

Non integrarsi con lo stack della radio, ma **prendere l'audio dov'è già
analogico**: alla stazione base della sala. Un programma piccolo su un
mini-computer (o sul PC della sala) che registra, taglia per passaggio, mette
l'ora, e consegna a ORION `{ora, durata, file, squadra se nota}` con una chiave
di servizio. ORION lo aggancia all'emergenza attiva.

Così funziona con qualunque apparato, e il giorno che cambiano radio non cambia
niente di ORION.

### La trascrizione: dove sta il rischio vero

Tecnicamente si fa in locale (Whisper o simili, senza mandare niente fuori). Ma
l'audio radio è banda 300-3400 Hz, compresso, rumoroso, con voci sovrapposte,
nomi di località, nomi propri e gergo. Il risultato è **una trascrizione grosso
modo giusta e sbagliata proprio sulle parole che contano**: il nome della via,
il numero delle persone, il nominativo della squadra.

Per un documento che va in procura **una trascrizione sbagliata è peggio di
nessuna trascrizione**. Quindi, se si farà:

- l'**audio** è il documento, e si conserva sempre;
- la **trascrizione** è un aiuto per cercare, marcata come automatica, e non
  entra mai nel fascicolo come se fosse una verbalizzazione.

### Il lato legale, che non è un dettaglio

Registrare il **proprio** traffico, sulla **propria** rete, con i volontari
informati, è normale amministrazione — molte sale lo fanno già. Ma la voce è
dato personale: serve una base giuridica, un periodo di conservazione dichiarato
e una cancellazione automatica alla scadenza. E registrare traffico che non è il
proprio, in Italia, è materia penale. Vale solo per il proprio, con una policy
scritta.

### Cosa converrebbe fare prima, che costa quasi niente

C'è una soluzione all'ottanta per cento che sta già mezza in casa: il
**brogliaccio radio**, cioè l'operatore che scrive una riga per ogni passaggio
importante. Molte sale lo fanno già su carta. Nella colonna eventi del centro
operativo, con ora e squadra precompilate, è mezza giornata di lavoro, è
giuridicamente solidissimo (l'ha scritto una persona, che se ne assume la
responsabilità) ed è esattamente quello che finisce nel fascicolo.

### Verdetto

**Attuabile, ma per gradi e non come prima cosa.**

1. *Brogliaccio radio a mano* nella colonna eventi. Poco lavoro, molta resa,
   nessun rischio.
2. *Registrazione audio* dalla sala, agganciata all'emergenza. Solo dopo aver
   saputo che radio usano.
3. *Trascrizione automatica*, e solo come aiuto alla ricerca.

Da **non** fare: integrarsi con l'infrastruttura TETRA, e presentare una
trascrizione automatica come il verbale delle comunicazioni.

---

## Piano di lavoro

Due commit separati nella stessa consegna:

1. **Ruoli multipli**, con la simulazione completa: utenti a ruolo singolo e
   doppio, verifica che nessuno perda accessi e che nessuno ne guadagni.
2. **Magazzino**, sul terreno stabilizzato.

La separazione serve a `git bisect`: se qualcosa si rompe nei permessi, si sa
in un minuto se è colpa dei ruoli o del magazzino.

Entrambi consegnati. Restano fuori, come previsto: ordini d'acquisto,
fornitori, valorizzazione contabile, prenotazioni, manutenzione programmata a
chilometri, consumi di carburante. E la **questione aperta** delle patenti, che
resta aperta: il requisito si registra e si mostra sulla scheda del veicolo, ma
non si verifica, perché le abilitazioni dei volontari non stanno ancora da
nessuna parte.

---

## Gli avvisi di scadenza: chi li riceve decide

Erano rimasti fuori di proposito; sono stati aggiunti dopo, con una differenza
rispetto alle notifiche della segreteria.

Le notifiche dei corsi e delle visite le configura la segreteria **per tutti**,
e ha senso: i destinatari sono i volontari, decine di persone, e la regola è
una sola. I magazzinieri sono una persona o due. Quello che per uno è «devo
saperlo il giorno stesso» per l'altro è posta da cestinare senza aprire, e un
avviso che si cestina senza aprire è peggio di nessun avviso: sposta anche
quello che contava nella cartella che non si guarda più.

Quindi:

- **Opt-in puro.** Nessuna riga nella tabella `avvisi_magazzino` significa
  nessuna email. Chi non è mai passato dalle impostazioni non riceve niente,
  nemmeno alla prima accensione del modulo.
- **La frequenza la sceglie chi riceve**: tutti i giorni, il lunedì, il primo
  del mese. Con il preavviso (quanti giorni guardare avanti) e la scelta se
  includere il materiale ancora fuori.
- **La data dell'ultimo invio sta sulla riga della persona**, non in una
  impostazione globale. È quello che fa funzionare il recupero: il periodo si
  misura su `ultimo_invio` di ciascuno, quindi una notte a server spento non
  salta la settimana di nessuno, e chi ha frequenze diverse non si disturba a
  vicenda. Si aggiorna **solo a email partita**: un invio fallito va ritentato,
  non dato per fatto.
- **Il ruolo si controlla al momento dell'invio.** Tolto il ruolo magazziniere,
  gli avvisi si fermano da soli: non c'è una seconda lista da ricordarsi di
  aggiornare.
- **C'è un pulsante per mandarsi una prova subito**, che non consuma il periodo.
  Una configurazione SMTP sbagliata si scopre così, in dieci secondi, invece che
  fra un mese quando una revisione è scaduta e l'email non è mai arrivata.

Innestato in `runDailyExpiryCheck`, che nel frattempo è stato corretto: si
fermava con un `return` se il modulo Segreteria era spento, e così avrebbe
zittito anche gli avvisi del magazzino di un'associazione che la segreteria non
la usa. Adesso le due sezioni sono indipendenti, come i due interruttori.
