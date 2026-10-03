# ORION

Applicazione web e app Android per la gestione delle attività di un gruppo o di un'associazione di protezione civile: emergenze e sala operativa, squadre, segreteria
dei volontari, magazzino.

Questo documento descrive la procedura di installazione automatizzata su un server Ubuntu pulito.

---

## Prerequisiti

Prima di iniziare, assicurati di avere a disposizione i seguenti elementi:

 Server Ubuntu: Un server (fisico o virtuale) con un'installazione pulita di Ubuntu.
     Testato su Ubuntu 24.04 LTS.
 Indirizzo IP Statico: Un indirizzo IP pubblico statico associato al tuo server.
 Dominio: Un nome di dominio (es. `orion.miaassociazione.it`) con un record DNS (tipo A) che punta all'IP statico del server.

---

## Installazione

L'installazione è gestita da uno script automatizzato.

1.  Accedi al tuo server
    Connettiti al tuo server Ubuntu tramite SSH.

2.  Clona il Repository
    Clona questo repository nella tua home directory (o in un percorso a tua scelta):
    git clone https://github.com/ip-conflict/orion-release.git

3.  Entra nella Directory
    cd orion-release

4.  Imposta i Permessi
    Rendi eseguibile lo script di setup:
    chmod +x ./setup.sh

5.  Esegui lo Script
    Esegui lo script con i privilegi di `sudo`:
    sudo ./setup.sh

---


Lo script `setup.sh` è interattivo e automatizza l'intera configurazione del server e dell'applicazione.

Nello specifico, lo script si occupa di:

 Installare le dipendenze: Installa Nginx, Node.js, npm, PM2 (process manager) e altri requisiti di sistema.
 Copiare i file: Sposta i file dell'applicazione nella directory di produzione (es. `/var/www/tuo.dominio.it`).
 Configurare il Database: Installa e configura il database.
 Creare il Servizio (Demone): Configura PM2 per avviare l'applicazione con un utente di sistema dedicato (non root) e farla ripartire automaticamente al riavvio del server.

Durante l'esecuzione, lo script ti chiederà di inserire:

1.  Credenziali Database: I nomi e le password sicure per l'utente del database.
2.  Utente PM2: Il nome di un utente di sistema (che verrà creato se non esiste) per eseguire l'applicazione in modo sicuro.
3.  Credenziali Admin: Un nome utente (o email) e una password per il primo account Amministratore dell'applicazione web.

### Gestione SSL (HTTPS)

Per garantire la sicurezza (HTTPS), lo script gestirà i certificati SSL in due modi:

1.  Certbot (Automatico): Tenterà di usare Certbot per generare e installare automaticamente un certificato gratuito da Let's Encrypt per il dominio specificato.
2.  Manuale: Se Certbot fallisce o se preferisci, ti chiederà di caricare manualmente i tuoi file del certificato ( `.crt` e `.key`) in un percorso specifico.

---

##

Se la procedura di setup è terminata con successo, l'applicazione sarà immediatamente disponibile all'indirizzo del dominio che hai configurato.

1.  Apri il tuo browser e naviga su:
    > `https://tuo.dominio.it`

2.  Effettua il login utilizzando le credenziali dell'utente Amministratore che hai impostato durante l'esecuzione dello script.


### Segnalazioni che non aspettano una squadra

Nella coda del centro operativo una segnalazione ancora senza squadra
assegnata, passato un certo tempo, si accende in rosso: l'orario e il
cartellino *DA ASSEGNARE*. È l'unico campanello che il sistema può suonare da
solo, perché priorità e stato in pratica restano spesso ai valori predefiniti.

Non tutte le segnalazioni però aspettano una squadra: una frana di competenza
dei Vigili del Fuoco, il livello di un fiume da tenere d'occhio, una chiamata
che si chiude con una telefonata. Dal pannello **Gestisci** delle squadre si
risponde alla domanda *"Questa segnalazione richiede una squadra?"* scegliendo
uno dei motivi:

- **Gestita da altro ente**
- **Solo monitoraggio**
- **Nessun intervento necessario**

Da quel momento la segnalazione non viene più segnalata come in ritardo e in
coda mostra un cartellino neutro con il motivo. La scelta viene registrata nel
diario della segnalazione e compare nel resoconto finale dell'emergenza, così
fra sei mesi si capisce che non è stata dimenticata.

Il tempo dopo il quale scatta la segnalazione si imposta in **Impostazioni →
Centro Operativo** (valore predefinito: 15 minuti). Se in sala operativa il
rosso diventa rumore di fondo, il valore va alzato.

### Squadre

Ogni squadra ha un **nome radio** preso dall'alfabeto fonetico (Alfa, Bravo,
Charlie...): si capisce anche con la radio che gracchia, dove "Squadra 1" e
"Squadra 3" si confondono. Il nome radio è unico e si affianca a una
descrizione libera ("Ricerca dispersi", "Taglio piante").

La gestione delle squadre è **aperta a tutti gli operatori**, non solo agli
amministratori: in emergenza le squadre si formano e si ricompongono di
continuo, e aspettare un amministratore costerebbe tempo. La contropartita è
la tracciabilità: ogni creazione, modifica ed eliminazione finisce nel registro
delle operazioni con nome e cognome di chi l'ha fatta.

Regole che il sistema fa rispettare:

- **una persona sta in una squadra sola**: inserirla in una seconda viene
  rifiutato dicendo in quale squadra si trova già;
- **i nominativi vengono dall'anagrafica**: non si possono inserire persone
  inesistenti, e nome e cognome mostrati sono quelli veri anche se la richiesta
  ne conteneva altri;
- **una squadra impegnata su un intervento non si elimina**: prima va liberata.
  Eliminandola quando è libera, la risposta dice quanti collegamenti a
  interventi già chiusi vengono rimossi con lei (la narrazione resta comunque
  nel diario delle segnalazioni e nei resoconti già prodotti);
- un volontario **impegnato con la sua squadra** su un intervento attivo non
  può essere spostato in un'altra squadra.

### Diario di sala

Dal centro operativo, mentre un'emergenza è aperta, chi è in sala può scrivere
una nota nel **diario di sala**: una telefonata con il sindaco, una decisione
presa, un'informazione che non riguarda una segnalazione precisa. Ogni nota
porta l'ora e il nome di chi l'ha scritta, compare a tutte le postazioni
nell'elenco degli eventi e apre il resoconto finale. Non è obbligatorio: chi
non lo usa non se ne accorge. Gli esterni temporanei non possono scriverci.

### Registro delle squadre durante un'emergenza

Mentre un'emergenza è aperta, ogni entrata e ogni uscita da una squadra viene
annotata, e il **resoconto finale** ne riporta l'elenco in ordine di tempo. Per
la relazione da consegnare serve poter dire chi ha fatto parte di quale squadra
e per quanto: fuori da un'emergenza, invece, i movimenti di squadra sono
normale amministrazione e non vengono registrati.

- **All'apertura**, se ci sono già squadre formate, la finestra le elenca con
  una casella per scioglierle e partire con la situazione pulita; di base si
  tengono. Se le si tiene, i loro membri
  risultano nel registro come entrati **in quel momento**: l'emergenza comincia
  lì. Se si sceglie di scioglierle, la risposta dice quante squadre sono state
  eliminate e quanti collegamenti a interventi passati se ne sono andati con
  loro.
- **Alla chiusura**, tutti i volontari risultano usciti contestualmente, anche
  se fisicamente la squadra resta composta com'era: il loro impiego in
  *quell'intervento* finisce con l'emergenza.
- Sempre **alla chiusura**, le squadre rimaste **vuote** (nessun membro e
  niente materiale in carico) si chiudono d'ufficio: sono quelle nate per
  l'emergenza e svuotate strada facendo, per esempio dagli esterni temporanei
  disattivati. La chiusura è scritta nel registro delle squadre e in quello
  delle operazioni. Una squadra vuota che ha ancora un mezzo o del materiale
  resta, perché prima quel materiale deve rientrare.
- Se una squadra viene **sciolta durante l'emergenza**, il suo nome radio resta
  bloccato fino alla chiusura: riassegnare "Alfa" a una squadra diversa mentre
  la radio è accesa è un ottimo modo per mandare i soccorsi nel posto
  sbagliato. Alla chiusura il nome torna libero.

### Ciclo di vita di un account

Gli account nascono **senza password**: alla creazione ORION produce un link
personale di attivazione, valido 24 ore, con cui il volontario sceglie da sé la
propria password. Non esiste nessuna password predefinita condivisa.

- Se la posta è configurata, il link parte per email; **se non lo è, il link
  viene mostrato all'amministratore**, che può consegnarlo a voce o su carta.
  La stessa cosa vale per l'azzeramento della password fatto da un
  amministratore. In altre parole, ORION resta usabile anche senza SMTP.
- *Password dimenticata* funziona solo con la posta configurata, per ovvie
  ragioni: senza SMTP la richiesta viene accettata ma non arriva nulla, e il
  fallimento è scritto nel registro del server. In quel caso la via è
  l'azzeramento da parte di un amministratore.
- La risposta a *password dimenticata* è sempre la stessa, che l'account esista
  o no: serve a non rivelare quali username o indirizzi sono registrati.
- Ogni link di ripristino vale **una volta sola** e scade (24 ore per
  l'attivazione, 1 ora per il recupero password).
- **Sospendere un utente lo mette fuori subito**: non può più accedere e la
  sessione eventualmente già aperta smette di funzionare alla richiesta
  successiva. Lo stesso vale per un account eliminato.

### Ruoli e menu

La barra laterale è la stessa in tutte le pagine di lavoro e mostra solo quello
che si può aprire: *Utenti*, *Archivio*, *Impostazioni* e *Sistema* agli
amministratori, *Segreteria* a chi ne ha il ruolo quando il modulo è acceso,
*Magazzino* e *Squadre* a tutti tranne gli esterni. *Il mio profilo* ed *Esci*
ci sono sempre.

Una persona può avere **più ruoli insieme**: segretaria *e* magazziniera, o
volontaria *e* segretaria. I permessi sono la somma dei ruoli, e si assegnano
dal pannello **Gestione Utenti**, spuntando le caselle. Solo un amministratore
può farlo.

- **Amministratore** può tutto: non serve spuntargli altro.
- **Esterno** non si somma a nulla: è una limitazione, non una capacità.
  Spuntandolo si spengono gli altri ruoli, e viceversa.
- **Volontario** parte spuntato sui nuovi utenti, perché chi fa segreteria o
  magazzino di norma lo fa *in più*, non *invece*.
- Un amministratore **non può togliersi l'amministrazione da solo**: resterebbe
  chiuso fuori.
- Aggiungere o togliere un ruolo vale **subito**, anche a chi è collegato in quel
  momento: non serve che rifaccia l'accesso, e chi perde un ruolo lo perde
  all'istante.

### Magazzino: DPI, attrezzature e veicoli

Modulo opzionale: si accende da **Amministrazione → Impostazioni → Modulo
Magazzino**, come la Segreteria, e parte spento. Spegnendolo la pagina sparisce
dal menu e nessuno può più registrare movimenti, ma niente viene cancellato:
beni, giacenze e registro tornano appena lo si riaccende.

Non tre elenchi separati ma **una anagrafica dei beni e un registro dei
movimenti**. Le domande sono le stesse per tutti: dov'è, chi ce l'ha, quando
scade, quando torna.

La pagina **Magazzino** ha quattro cose a portata di dito — *Consegna*,
*Rientro*, *Chi ha cosa*, *Scade e manca* — e tre schede che vede solo chi ha
il ruolo **magazziniere**: *Inventario* (l'anagrafica dei beni), *Verbali e
registro* (i verbali di consegna e l'elenco di tutti i movimenti) e
*Impostazioni* (le regole del magazzino, le categorie, le ubicazioni e i propri
avvisi via email).

- **Consegna e rientro** li registra qualunque operatore collegato: in
  emergenza non si aspetta il magazziniere per prendere una pala, e ogni
  movimento porta comunque il nome di chi l'ha fatto. **Carichi, dismissioni,
  smarrimenti, rettifiche e anagrafica** restano al magazziniere, perché
  toccano l'inventario da rendicontare.
- **Le giacenze si calcolano dal registro**, non si scrivono a mano. Un pezzo
  unico ha un solo detentore per costruzione; per il materiale sfuso la
  giacenza è carichi meno uscite più rientri, più o meno le rettifiche.
- **Al rientro**, se di un materiale sfuso torna meno di quanto è uscito, si
  sceglie cosa ne è del resto: *resta in carico* (i guanti che il volontario
  tiene), *usato sul posto* (i sacchi finiti nell'argine) o *perso*. Non c'è
  una scelta preimpostata e il server rifiuta un rientro parziale senza: un
  default sarebbe sbagliato una volta su due. Si può anche indicare che non
  torna niente (quantità zero) e dire soltanto cosa ne è stato.
  Sui veicoli si possono scrivere i chilometri (facoltativi): è l'unico
  momento in cui qualcuno li ha sotto gli occhi.
- **Non si cancella mai un bene**: si dismette. Esce dagli elenchi e resta nella
  storia. La dismissione vale anche su un bene che è in mano a qualcuno, perché
  un DPI scade dove si trova e lì si butta: farlo prima rientrare significherebbe
  scrivere una cosa che non è successa. Per la stessa ragione esiste la
  *rettifica*: senza un modo onesto di dire «contati, sono 170 e non 172», i
  numeri divergono in silenzio.
- **I DPI in dotazione non sono materiale in ritardo.** Elmetto, giacca e
  scarponi restano al volontario per anni: si vedono in *Chi ha cosa*, non in
  *Scade e manca*. L'eccezione è il DPI di un volontario che non è più iscritto:
  lì serve decidere se rientra o si dichiara perso, e infatti ci compare.
- **Manutenzioni periodiche** su attrezzature e veicoli: si dice ogni quanti mesi
  va rifatta e, registrando un intervento, la prossima data si calcola da sola.
  Ogni intervento tiene il suo verbale o la sua fattura (facoltativi) e resta
  nello storico, che non si sovrascrive.
- **Etichette QR stampabili**: ogni bene nasce con un codice di sei caratteri,
  e dall'inventario si stampa il foglio di adesivi. Inquadrando il QR con la
  fotocamera di un telefono si apre la scheda di quell'oggetto — senza bisogno
  di nessuna applicazione; l'app Android apre la scheda del bene o lo mette
  nella consegna. Il codice è stampato anche in chiaro, perché un adesivo
  graffiato si ribatte a mano. Si stampa in formato libero (da ritagliare) o
  sulle fustelle dei fogli adesivi A4 più diffusi (3×8 da 70×37, 3×7 da
  70×42,3, 2×7 da 99,1×38,1, 2×4 da 99,1×67,7, 4×10 da 45,7×25,4 mm), con le
  copie per ogni bene, le prime posizioni da saltare su un foglio già usato,
  una correzione in millimetri per la stampante e la possibilità di togliere
  dal foglio le etichette che non servono. Si stampa quello che si stava
  guardando nell'inventario, un bene solo (*Stampa l'etichetta* dalla sua
  scheda) o tutte le taglie di un DPI (*Etichette* dal suo riquadro). Se la
  pagina è aperta da un indirizzo locale (localhost, 192.168…) avvisa: è
  l'indirizzo che finisce nei QR, e l'app scarta quelli di un altro server.
- **Il materiale si consegna a una persona.** Non a una squadra né a un mezzo:
  ognuno ha in carico quello che ha preso, ed è lui che lo restituisce. Il
  materiale che squadre e mezzi avevano già in carico prima resta visibile e
  rientra come sempre.
- **Tutto il magazzino anche dall'app Android**, per magazziniere e
  amministratore: inventario, schede dei beni con movimenti e manutenzioni,
  DPI a taglie, chi ha cosa, scadenze, registro e impostazioni, con le stesse
  rotte del web. Sul web resta solo la stampa delle etichette.
- **Mezzi con revisione o assicurazione scadute**: dalle impostazioni si sceglie
  se non possono uscire, se escono con un avviso, o se non si controlla nulla.
- **Verbale di consegna e di rientro.** Sono due opzioni delle impostazioni del
  magazzino, entrambe spente di base: consegna e rientro sono solo spunta e
  registra. Chi già li usava li ritrova accesi dopo l'aggiornamento. Con il **verbale di
  consegna** acceso, consegnando a una persona compare la casella del verbale, e
  l'avviso di consegna riuscita porta al foglio: un A4 con logo, destinatario,
  oggetti, taglie e matricole e gli spazi per le firme. Se è accesa la
  **conferma dei DPI** il verbale c'è sempre, perché è quello che il volontario
  conferma. Con il **verbale di rientro** acceso, lo stesso vale per il rientro
  da una persona: firma chi restituisce, le voci non tornate compaiono come usate sul posto o
  perse, e quello che resta in carico è scritto nelle note del verbale. I verbali si ritrovano in *Verbali e registro*, con il loro stato.
  Chi ha ricevuto il materiale può confermare una consegna dall'app o dal
  riquadro *Materiale da confermare* in cima al suo profilo web.
- **La foto del foglio firmato è il verbale.** Per chi preferisce la carta:
  dalla pagina del verbale il magazziniere allega la foto (o il PDF) del foglio
  firmato — dal telefono si scatta direttamente — e il verbale passa a
  *Firmato su carta*; dall'app Android si fotografa subito dopo la consegna.
  Una seconda foto sostituisce la prima. Il file si legge solo da chi ha
  firmato e dal magazziniere, e il server controlla che sia davvero una foto o
  un PDF.
- **DPI a taglie.** Guanti, scarpe, divise: un DPI con le sue taglie, ognuna
  un bene a quantità con la sua etichetta e le sue scadenze. Nella scheda
  *Inventario* ogni DPI è un riquadro con quanti pezzi ci sono per taglia (e
  quanti sono fuori); «Carica» registra una fornitura intera, per esempio 4 L
  e 5 XL. Si parte con i DPI più comuni della protezione civile e le loro
  taglie solite (elmetto, guanti, scarpe, stivali, occhiali, otoprotettori,
  FFP2, giacca e gilet alta visibilità, pantaloni, polo, giubbotto
  antipioggia): si caricano, si correggono o si nascondono, e se ne creano
  altri, come una divisa estiva. Una taglia si toglie solo quando è vuota; il
  nome cambiato passa a tutte le taglie. Consegna, rientro e app non cambiano:
  si sceglie il DPI, poi la taglia.
- **Categorie e ubicazioni** si aggiungono, si rinominano e si eliminano (solo
  se vuote) dalla scheda *Impostazioni*. Un'ubicazione che contiene ancora dei
  beni si può segnare come non più in uso: non viene più proposta per i beni
  nuovi. La categoria *Da smistare* (era *Da riordinare*) esiste solo dove sono
  stati trasferiti i DPI del vecchio fascicolo, che non avevano categoria.
- **Avvisi via email delle scadenze, a richiesta.** Nella scheda *Impostazioni*
  ogni magazziniere decide per sé: se riceverli, ogni quanto (tutti i giorni,
  il lunedì, il primo del mese), quanto guardare avanti e se includere il
  materiale ancora fuori. Chi non li accende non riceve niente, e c'è un
  pulsante per mandarsi una prova subito, invece di scoprire fra un mese che
  la posta non era configurata. Se il server resta spento nel giorno previsto,
  il riepilogo parte alla prima accensione utile.
- **Sciogliere una squadra o eliminare un volontario che ha roba in carico si
  ferma** e chiede riga per riga: rientrata, persa o da recuperare. Ogni scelta
  genera il suo movimento col nome di chi ha deciso, così fra un anno si saprà
  che quella motosega risulta persa perché qualcuno l'ha dichiarata persa.
- **A fine emergenza** il resoconto guadagna la sezione *Mezzi e materiali
  impiegati*, con l'elenco di cosa è ancora fuori e presso chi. I **DPI** non
  ci sono in nessuna parte del resoconto: sono la dotazione personale dei
  volontari, non materiale dell'emergenza. Le consegne di DPI fatte mentre
  un'emergenza è aperta non vengono legate all'emergenza, e il registro delle
  operazioni del resoconto salta schede, DPI a taglie, categorie e verbali che
  riguardano solo DPI.
- **I DPI** si consegnano da qui e compaiono nel **fascicolo del volontario**:
  li vede lui dal suo profilo, e li vedono segreteria e amministratori dalla
  stessa scheda, con la data di consegna e la scadenza. Il riquadro appare solo
  a modulo acceso. Si
  può stampare un **verbale di consegna** che raggruppa più oggetti — elmetto,
  giacca e scarponi con un foglio solo — da far firmare e fotografare, e in
  alternativa attivare la conferma dall'applicazione.

### Accesso esterno temporaneo

Durante un'emergenza al COC si presenta chi non è dell'associazione: la Croce
Rossa con un'ambulanza, un tecnico del Comune. Dal menu del centro operativo,
**Accesso esterno** (lo può fare qualunque operatore interno, anche un
volontario, perché al COC non sempre c'è un amministratore): un nome (e se serve l'ente, la squadra, anche nuova, e
un'email). ORION crea un utente esterno e mostra un **QR**: la persona lo
inquadra con il telefono ed è dentro, senza password. Lo stesso link si manda
per email, WhatsApp o SMS. Sul telefono Android la pagina propone l'app, che
in squadra manda la posizione anche con lo schermo spento: il COC vede
l'ambulanza sulla mappa.

L'accesso finisce da solo alla **chiusura dell'emergenza**: l'utente si
disattiva, esce dalla squadra, QR e sessioni non valgono più. Dalla stessa
finestra si vede chi è entrato, si rigenera il QR (il vecchio smette di
valere) o si revoca subito. L'utente resta in anagrafica, disattivato, perché
i registri lo citano per nome.

Un esterno vede l'emergenza, ma agisce solo dentro la sua squadra: scrive note,
manda foto e sposta il punto soltanto sulle segnalazioni assegnate a lei. Non
scrive nel diario di sala, non carica documenti, non consulta il magazzino
dell'associazione (gli restano il materiale che ha in carico lui e i suoi
verbali) e non usa l'impronta: per rientrare usa di nuovo il codice.

### Notifiche nell'app

Le email restano quelle di sempre (avvisi di scadenza ai volontari, report
mensile, avvisi del magazzino a chi li ha chiesti). Tutto il resto va nella
coda delle notifiche dell'app, sul server dell'associazione, senza servizi
esterni:

- **Emergenza**: l'apertura di un'emergenza (a tutti gli interni) e
  l'intervento assegnato alla propria squadra. Spariscono da sole quando
  l'emergenza si chiude, quando la squadra viene tolta o l'intervento chiuso.
- **Per te**: i DPI da confermare (spariscono con la conferma) e le proprie
  scadenze (valgono un mese, e la più recente sostituisce le precedenti).
- **Segreteria**: ogni mattina chi ha il ruolo trova quanti volontari hanno
  visite o corsi da sistemare.
- **Magazzino**: ogni mattina chi tiene il magazzino trova quante scadenze
  cadono entro un mese e quanti oggetti sono fuori da troppo tempo.

I due riepiloghi si rinnovano solo se i numeri cambiano, così non suonano
ogni giorno per dire la stessa cosa, e spariscono quando non c'è più niente
da sistemare. La coda si pulisce da sola: le notifiche scadute si cancellano
dopo un giorno, le lette dopo 30 giorni, le mai lette dopo 90.

Ad app chiusa il telefono controlla la coda **ogni ora**, e **ogni quarto
d'ora durante un'emergenza**. Quindici minuti è il minimo che Android concede
a questi controlli, e li raggruppa con quelli delle altre app: la batteria non
ne risente e il sistema non li considera un abuso. Con l'app aperta le
notifiche arrivano subito.

### Segreteria: corsi, visite e scadenze

Il modulo Segreteria si accende da **Impostazioni** e tiene il fascicolo di ogni
volontario: visite mediche, corsi e attestati, DPI consegnati.

- I **cataloghi** (tipi di visita e corsi) si compilano una volta sola. Un nome
  già in elenco viene rifiutato, senza badare a maiuscole o spazi: "Corso Base",
  "corso base" e " Corso Base " sono la stessa cosa.
- Il **cruscotto** elenca ciò che scade entro 30 giorni **e tutto ciò che è già
  scaduto**, per quanto tempo sia passato, con i casi più gravi in cima.
- Gli **avvisi automatici** ai volontari partono ai giorni di preavviso
  scelti nelle impostazioni (di norma 30, 15 e il giorno stesso). Se il server resta spento,
  alla riaccensione vengono recuperati gli avvisi dei giorni saltati.
- Il **report mensile** riepiloga a presidenza e segreteria i requisiti scaduti
  negli ultimi tre mesi e quelli in scadenza nei prossimi tre. Dalle
  impostazioni si può anche mandarlo subito (*Invia ora il riepilogo*), per
  vedere se arriva: parte solo il report, non si ripetono gli avvisi ai
  volontari.
- Gli invii riusciti e falliti finiscono nel registro del server: se la posta
  non è configurata, lo si legge lì invece di scoprirlo mesi dopo.
- Con i **blocchi operativi** attivi, chi non ha la visita valida o il corso base
  non può essere inserito in una squadra; il messaggio dice chi e perché. Un
  requisito vale fino a tutto il giorno di scadenza.

Ogni volontario vede il proprio fascicolo dal profilo, se lo stampa in PDF e ha
un tesserino elettronico con QR che i coordinatori possono verificare durante
un'emergenza.

Il **tesserino da divisa** (formato carta di credito) si stampa dal fascicolo
della segreteria: nome, distretto, foto (o una sagoma se manca), i loghi
dell'ente sovraordinato e dell'associazione, il nome dell'ente, la scritta
VOLONTARIO fra la bandiera italiana e quella europea, e il QR di verifica.
Distretto, nome e logo dell'ente si impostano in **Impostazioni → Tesserino**.
Da lì si possono anche **spegnere i QR dei volontari**: spariscono da profili,
fascicoli, app e tesserini stampati da quel momento, la pagina di verifica non
risponde più nemmeno per quelli già stampati, e il tesserino ridistribuisce lo
spazio. Riaccesi, tornano validi gli stessi.

### Dopo la chiusura di un'emergenza

Alla chiusura di un'emergenza l'applicazione produce, senza che sia necessario
chiederlo, due cose:

1.  un **backup del database**, perché è il momento in cui il registro
    dell'intervento è completo e non si può contare sul fatto che il server sia
    acceso all'orario del backup notturno;
2.  un **resoconto testuale** dell'intero intervento, salvato in
    `protected_uploads/emergency_logs/`.

Il resoconto è un file `.txt` a larghezza fissa, pensato anche per essere
stampato e allegato alla relazione. Contiene i dati dell'emergenza, il diario di sala, ogni
segnalazione con il suo diario completo (distinguendo le note scritte dagli
operatori dagli eventi registrati dal sistema), le squadre impiegate, i
documenti allegati, i mezzi e i materiali impiegati (senza i DPI) e il
registro delle operazioni amministrative avvenute nella finestra temporale
dell'emergenza (anche questo senza le operazioni sui DPI).

Si scarica dalla pagina **Archivio Emergenze** con il pulsante *Scarica
Resoconto*. Se il file non si trova più sul disco viene rigenerato al momento
leggendo il database, quindi anche le emergenze chiuse prima dell'introduzione
di questa funzione hanno il loro resoconto.

### Backup e ripristino

La pagina **Sistema**, riservata all'amministratore, mostra i backup disponibili
e permette di farne uno subito, scaricarlo, **verificarlo** (è un file
integro? contiene davvero un database di ORION?), caricarne uno da un file e
ripristinarlo — senza collegarsi al server.

Un ripristino cancella e riscrive il database, quindi:

- prima parte un **backup di sicurezza** dei dati attuali; se quello non riesce,
  il ripristino non comincia nemmeno;
- il dump entra in **una transazione sola**: se qualcosa va storto a metà file,
  il database resta esattamente com'era e il motivo è scritto a schermo;
- per confermare servono la **propria password** e la parola **RIPRISTINA**
  scritta per esteso: una sessione lasciata aperta in sede non basta;
- durante l'operazione l'applicazione risponde *in manutenzione* a tutti e le
  pagine già aperte lo mostrano, ricaricandosi da sole quando è finita;
- al termine il programma si riavvia, perché utenti, password e impostazioni
  sono tornati quelli del backup;
- un backup fatto con una **versione precedente** si ripristina senza problemi:
  subito dopo, e a ogni avvio, ORION applica le migrazioni che mancano e porta
  il database allo schema della versione installata. Vale anche per un
  ripristino fatto a mano con `psql`;
- un archivio caricato da fuori viene letto per intero prima di accettarlo:
  se contiene comandi di psql (le righe con la barra rovesciata, come `\!`
  che esegue un programma sul server) viene rifiutato, perché un backup fatto
  da ORION non ne ha.

I file caricati (foto, certificati, documenti) non stanno nel database: la loro
copia la fa il backup notturno ed è **speculare**, cioè la situazione
dell'ultima notte. Si possono ripristinare insieme al database spuntando la
casella, che mostra la data della copia disponibile.

I backup contengono tutto il database e i certificati medici: sulla macchina
li leggono solo root e, in sola lettura, l'utente dell'applicazione. Le
installazioni precedenti li avevano leggibili a tutti; il backup notturno
sistema i permessi dei file già presenti.

Questi backup restano sulla stessa macchina dell'applicazione: proteggono da un
errore o da una cancellazione, **non dalla rottura del server**. Ogni tanto va
scaricata una copia e tenuta altrove.

### Aggiornamenti

Sempre dalla pagina **Sistema**: si vede la versione installata e, se il
controllo è acceso, se ne esiste una più recente, con le note di quella versione.

- **Di base il controllo è spento**: finché non lo si accende, ORION non
  contatta nessun servizio esterno. Le versioni si possono cercare fra le
  *release* del progetto su GitHub oppure su un indirizzo proprio, indicando un
  piccolo manifesto JSON.
- **L'ordine dell'aggiornamento è pensato perché un guasto non lasci
  l'installazione a metà**: backup del database, scaricamento e verifica del
  pacchetto, installazione delle dipendenze accanto al pacchetto nuovo,
  migrazioni del database lette dal pacchetto nuovo, copia di sicurezza del
  codice attuale, sostituzione dei file, riavvio. Se le dipendenze o le
  migrazioni falliscono nessun file è stato ancora toccato e il programma sta
  ancora girando nella versione di prima.
- La sostituzione non tocca quello che non appartiene al programma: i file
  nascosti della cartella (che è anche la home dell'utente di sistema, con la
  configurazione di PM2 e di npm), i dati caricati, i loghi, i registri e la
  cartella `app-android` con l'APK.
- **Non si aggiorna da solo**: decide l'amministratore, che sa se c'è
  un'emergenza in corso.
- Il numero di versione è quello delle release pubbliche, dalla 1.0.0 in poi.
  Le versioni 3.x citate nella documentazione sono la numerazione interna di
  sviluppo, precedente alla 1.0.

Resta valido anche `sudo ./update.sh` dal server, per chi preferisce la riga di
comando o deve aggiornare un'installazione che non parte più.

Le installazioni di prova precedenti alla 1.0 (numerate 3.x) non vedono la
1.0.0 come un aggiornamento, perché il numero è più basso: si reinstallano da
zero, oppure si aggiornano una volta con `sudo ./update.sh`. Fino alla 3.36,
inoltre, l'aggiornamento dalla pagina Sistema cancellava la cartella `.pm2`;
`update.sh` se ne accorge e riavvia ORION da capo.

Il dettaglio delle scelte è in `docs/manutenzione-backup-e-aggiornamenti.md`.

### Documentazione

Il manuale d'uso operativo, per chi usa ORION ogni giorno, è in
`docs/manuale-uso.md`. Il manuale tecnico, per chi installa, mantiene e
sviluppa, è in `docs/manuale-tecnico.md`. La lista delle prove da fare su
telefoni veri prima di una messa in produzione è in `docs/collaudo.md`.

---

Copyright (c) 2025-2026 Francesco Luongo.

ORION è distribuito con la licenza PolyForm Noncommercial 1.0.0: si può usare,
modificare e condividere per scopi non commerciali, e lo possono usare
liberamente associazioni di volontariato, enti di pubblica sicurezza e
istituzioni pubbliche. Non se ne può fare un uso commerciale, compresa la
vendita. Il testo completo è in `LICENSE.md`.
