# ORION, manuale d'uso operativo

Questo manuale è per chi usa ORION tutti i giorni: il volontario, chi sta in
sala operativa, la segreteria, chi tiene il magazzino, l'amministratore. Non
serve leggerlo tutto. Ognuno trova la sua parte, e chi fa più cose legge più
capitoli.

ORION ha due facce. La web app si apre dal browser, sul computer della sede o
sul telefono, ed è dove si configura, si amministra e si coordina. L'app
Android, Orion Mobile, è il telefono in tasca di chi agisce: il volontario in
squadra, il magazziniere che consegna, la segretaria che registra una visita
fuori sede. Le due parlano con lo stesso server e vedono gli stessi dati.
Quello che si fa da una parte si vede subito dall'altra.


## 1. Entrare in ORION

L'amministratore crea l'account e ORION prepara un link personale di
attivazione, valido 24 ore. Se la posta dell'associazione è configurata il
link arriva per email; altrimenti l'amministratore lo consegna a mano. Aprendo
il link si sceglie la propria password. Non esistono password predefinite
uguali per tutti.

Se la password si dimentica, dalla pagina d'accesso c'è "Password
dimenticata". Funziona solo se la posta è configurata; in caso contrario ci si
rivolge all'amministratore, che può azzerarla e dare un nuovo link.

Dal telefono Android, dopo il primo accesso al web, ORION propone di scaricare
l'app. Si può rispondere "Continua sul web" e la domanda non torna fino alla
versione successiva.


## 2. Il volontario

### Il proprio profilo

Da "Il mio profilo" ciascuno vede il suo fascicolo: le visite mediche, i corsi
con gli attestati, i DPI che ha in carico con la data di consegna e la
scadenza. Il fascicolo si stampa in PDF. Nello stesso profilo c'è il
tesserino elettronico, con il QR che i coordinatori possono verificare
durante un'emergenza, se l'associazione ha lasciato acceso il QR.

In cima al profilo, quando c'è, compare il riquadro "Materiale da
confermare": sono le consegne fatte dal magazzino che aspettano la conferma di
chi le ha ricevute. Confermare vale come firma.

### L'app sul telefono

Al primo avvio l'app chiede l'indirizzo del server dell'associazione (lo
stesso che si scrive nel browser), il nome utente e la password. Subito dopo
propone di usare l'impronta per le volte successive: conviene accettare. La
password non resta sul telefono.

Poi l'app chiede i permessi, uno alla volta. Le notifiche servono per sapere
quando la squadra viene mandata su un intervento. La fotocamera serve per le
foto degli interventi e dei documenti. La posizione serve alla sala
operativa per vedere dove si trova la squadra, e va concessa come "Consenti
sempre", altrimenti la sala vede la squadra solo finché l'app è aperta davanti
agli occhi. Se "sempre" manca, la schermata principale lo ricorda con un
pulsante.

La sezione Io è il fascicolo in tasca: il tesserino con il QR (funziona anche
senza rete), i DPI in carico con il dettaglio di ognuno, le consegne da
confermare, le visite e i corsi. Visite e corsi si aprono dopo l'impronta o il
PIN del telefono, perché sono dati sanitari. Toccando un corso si vedono il
codice, la validità, le volte in cui è stato fatto e l'attestato, che si apre
o si salva nella cartella Download.

Da Io si apre anche Il mio profilo, con tutto quello che sul web si fa dalla
pagina Profilo. Si cambia la foto del tesserino, scattandola o scegliendola
dalla galleria; si correggono codice fiscale, telefono, indirizzo, città e
CAP; si cambia la password. Dopo il cambio della password il telefono resta
collegato, mentre gli altri dispositivi devono rientrare con quella nuova, e
l'accesso con l'impronta si riattiva la volta successiva che si entra con la
password. Il pulsante del fascicolo prepara lo stesso PDF che il web stampa,
con dati, visite e corsi, e lo apre con il lettore del telefono; siccome
dentro ci sono le visite mediche, prima chiede l'impronta o il PIN.

Quando l'associazione mette sul server una versione nuova dell'app, la
schermata principale la propone con il pulsante Scarica, e anche ad app
chiusa arriva una notifica, una sola per ogni versione.

### Le notifiche

Le email restano quelle di sempre: gli avvisi delle proprie scadenze e,
per chi li riceve, i riepiloghi mensili. Tutto il resto arriva come notifica
dell'app, divisa in quattro gruppi. Emergenza: l'apertura di un'emergenza e
l'intervento assegnato alla propria squadra. Per te: i DPI da confermare e le
proprie scadenze. Segreteria e Magazzino: i riepiloghi del mattino, solo per
chi ha quei ruoli.

Sul telefono ogni gruppo è un canale a sé, e dalle impostazioni di Android si
può silenziare uno senza perdere gli altri. Chi fa segreteria e trova il
riepilogo quotidiano superfluo, per esempio, può togliergli il suono e
tenere a pieno volume quello dell'emergenza.

Le notifiche invecchiano e spariscono da sole quando non servono più: quella
dell'emergenza si toglie alla chiusura, quella del DPI quando lo si conferma,
il riepilogo quando arriva quello nuovo. Nella schermata delle notifiche, se
ci sono gruppi diversi, compaiono in alto i filtri per guardarne uno solo.
Toccando una notifica si arriva dove la cosa si guarda: l'intervento, la
segreteria, il fascicolo.

Ad app chiusa il telefono controlla la coda ogni ora, e ogni quarto d'ora
quando c'è un'emergenza aperta. Con l'app aperta le notifiche arrivano
subito. Se il telefono ha il risparmio energetico molto aggressivo, la
schermata principale dell'app lo segnala e porta alle impostazioni per
escludere Orion Mobile.


## 3. L'emergenza

### Aprire e chiudere

Dal centro operativo, "Apri emergenza". Se ci sono già squadre formate,
la finestra le elenca: di base entrano nell'emergenza così come sono, e i
loro membri risultano entrati in squadra in quel momento; spuntando la
casella si sciolgono e si parte da zero. Tutti gli operatori
interni ricevono sul telefono l'avviso che l'emergenza è aperta.

Alla chiusura ORION fa da solo tre cose. Salva un backup del database, perché
è il momento in cui il registro è completo. Scrive il resoconto
dell'intervento, che si scarica dall'Archivio Emergenze. Chiude d'ufficio le
squadre rimaste vuote, cioè senza più nessuno e senza materiale in carico:
sono di solito quelle nate per l'emergenza e svuotate strada facendo. Una
squadra vuota che ha ancora un mezzo o del materiale resta aperta, finché
quel materiale non rientra.

Chiudendo l'emergenza finiscono anche gli accessi esterni temporanei, e dal
telefono spariscono gli avvisi dell'emergenza.

Il centro operativo si apre anche dal browser del telefono, in una forma
ridotta: la mappa in alto e l'elenco delle segnalazioni sotto; toccando una
segnalazione il dettaglio prende tutto lo schermo, e la X riporta alla
mappa. Per lavorare in sala resta molto più comodo un computer.

### Il diario di sala

Nel centro operativo, sopra l'elenco degli eventi, c'è un campo per scrivere
nel diario di sala. Serve per quello che non appartiene a una segnalazione:
la telefonata con il sindaco, la decisione di chiudere una strada, la
richiesta arrivata dalla Prefettura. Si scrive e si preme Annota, oppure
Ctrl+Invio. La nota compare subito a tutte le postazioni, con
l'ora e il nome di chi l'ha scritta, e alla chiusura apre il resoconto. Chi
non lo usa può ignorarlo del tutto.

### Le segnalazioni

Una segnalazione si crea dal centro operativo con "Crea segnalazione":
indirizzo o punto sulla mappa, chi ha chiamato, cosa succede. Ogni cosa che
accade dopo finisce nel suo diario, in ordine di tempo, distinguendo le note
scritte dagli operatori dagli eventi registrati dal sistema.

Una segnalazione senza squadra, passato un certo tempo (di norma 15 minuti),
si accende in rosso con la scritta DA ASSEGNARE. Non tutte però aspettano una
squadra: dal pannello Gestisci si può dire che è gestita da un altro ente, che
va solo tenuta d'occhio, o che non serve intervenire. Da lì in poi non viene
più segnalata come in ritardo, e la scelta resta nel diario e nel resoconto.

### Le squadre

Ogni squadra ha un nome radio dell'alfabeto fonetico (Alfa, Bravo, Charlie) e
una descrizione libera. Le squadre le può formare e modificare qualunque
operatore interno, non solo l'amministratore: in emergenza si ricompongono di
continuo. Ogni modifica resta nel registro con il nome di chi l'ha fatta.

Una persona sta in una squadra sola, e chi è impegnato con la sua squadra su
un intervento non si sposta. Una squadra impegnata non si elimina: prima va
liberata. Mentre l'emergenza è aperta, ogni ingresso e ogni uscita da una
squadra viene annotato, e il resoconto finale ne riporta l'elenco. Il nome
radio di una squadra sciolta durante l'emergenza resta bloccato fino alla
chiusura, per non mandare due squadre diverse con lo stesso nome.

Mandando una squadra su un intervento, i suoi membri ricevono la notifica sul
telefono. Quando la squadra viene tolta o l'intervento chiuso, la notifica
sparisce.

Sulla mappa ogni squadra con il telefono acceso compare con la sua lettera.
Toccandola, o scegliendo "Trova sulla mappa" dal menu che si apre cliccando
la squadra nella barra in basso, la mappa la porta in vista e apre un
riquadro con l'essenziale: dove sta andando, quanto è recente la posizione
(se il telefono non trasmette da più di cinque minuti lo dice) e chi c'è
dentro. Se la squadra è assegnata a una segnalazione e non è ancora sul
posto, ORION disegna la strada che deve fare e ne indica lunghezza e tempo
in auto; la strada si ricalcola da sola mentre la squadra si muove, e quando
arriva lo dice. Se il servizio dei percorsi non risponde, al posto della
strada compare la linea d'aria, tratteggiata.

### La mappa

In basso a sinistra stanno la scelta fra mappa stradale e satellite e la
ricerca. La ricerca trova, mentre si scrive, le segnalazioni (per numero,
"#12", per titolo o indirizzo) e le squadre; con Invio cerca gli indirizzi,
dando la precedenza a quelli vicini alla zona inquadrata. Accetta anche le
coordinate come le detta chi chiama, per esempio "46.1405, 12.2168" o
"46,1405 12,2168". Con un modulo di segnalazione aperto, l'indirizzo scelto
ne diventa la posizione.

### In squadra con il telefono

Durante un'emergenza, chi è in una squadra trova nella schermata principale
l'intervento assegnato: indirizzo, pulsante per il navigatore, chiamata a chi
ha segnalato, eventuali rischi e il diario. Si possono aggiungere note e foto
anche senza rete: partono da sole appena torna il campo. Se il punto sulla
mappa è sbagliato, "Sposta qui" lo porta dove si trova il telefono, dopo una
conferma.

Mentre si è in squadra, con il permesso della posizione, l'app manda la
posizione alla sala ogni 15 secondi e lo dice con una notifica fissa. Smette
da sola quando si esce dalla squadra o l'emergenza si chiude.

### Gli esterni temporanei

Al COC si presenta spesso chi non è dell'associazione: la Croce Rossa con
un'ambulanza, un tecnico del Comune, un'altra associazione. Per farli
lavorare con ORION non serve un amministratore. Qualunque operatore interno,
anche un volontario, dal menu del centro operativo sceglie "Accesso esterno",
scrive il nome della persona e, se vuole, l'ente, la squadra (anche nuova) e
un indirizzo email.

ORION mostra un QR. La persona lo inquadra con il suo telefono ed è dentro,
senza password. Lo stesso link si può mandare per email, WhatsApp o SMS. Su
Android la pagina che si apre propone l'app: con l'app la posizione della
squadra arriva alla sala anche a schermo spento, e il COC vede l'ambulanza
sulla mappa. Dall'app si entra anche con "Accedi con un codice",
inquadrando lo stesso QR.

L'esterno vede solo l'emergenza e gli interventi della sua squadra. Può
scrivere note e, sugli interventi assegnati alla sua squadra, caricare foto.
Il suo accesso finisce da solo alla chiusura dell'emergenza. Dalla stessa
finestra "Accesso esterno" si vede chi è entrato, si rigenera il QR (il
vecchio smette di valere) o si revoca l'accesso subito. La persona resta in
anagrafica, disattivata, perché i registri la citano per nome.


## 4. La segreteria

La segreteria tiene il fascicolo di ogni volontario: visite mediche, corsi e
attestati, DPI. Il modulo si accende dalle impostazioni e si vede solo a chi
ha il ruolo.

I cataloghi, cioè i tipi di visita e i corsi con la loro validità, si
compilano una volta sola. Il cruscotto mostra tutto ciò che scade entro 30
giorni e tutto ciò che è già scaduto, con i casi più gravi in cima. Ogni
mattina chi ha il ruolo trova anche nell'app il riepilogo: quanti volontari
hanno qualcosa da sistemare. Il riepilogo si rinnova solo quando i numeri
cambiano.

Gli avvisi ai volontari partono da soli ai giorni di preavviso scelti nelle
impostazioni, di norma 30 e 15 giorni prima e il giorno stesso. Il report
mensile arriva a presidenza e segreteria per email. Se si vuole vedere subito
se la posta funziona, dalle impostazioni c'è "Invia ora il riepilogo".

Con i blocchi operativi accesi, chi non ha la visita valida o il corso base
non può entrare in una squadra, e il messaggio dice chi e perché.

### La segreteria sul telefono

Dall'app, sotto Strumenti, la voce Segreteria si apre con l'impronta o il PIN.
In alto c'è chi ha qualcosa da sistemare; sotto si cerca un volontario per nome
e se ne apre il fascicolo: contatti con la chiamata a un tocco, visite e corsi
con i documenti, DPI in carico. Si registra una visita o un corso scegliendo
dal catalogo; la scadenza viene proposta dalla validità e si può correggere; il
certificato si fotografa o si sceglie fra i file del telefono. Anagrafica,
cataloghi e tesserini restano sul web. Senza rete la segreteria dell'app non
si apre: sono dati sanitari e sul telefono non si tengono.

### Il tesserino

Il tesserino da divisa, formato carta di credito, si stampa dal fascicolo del
volontario. Distretto, nome e logo dell'ente si impostano una volta nelle
impostazioni. Da lì si possono anche spegnere i QR dei volontari: spariscono
ovunque e la verifica non risponde più, nemmeno per i tesserini già stampati.
Riaccendendoli tornano validi gli stessi.


## 5. Il magazzino

Il magazzino è un'anagrafica dei beni (DPI, attrezzature, veicoli) e un
registro dei movimenti. Le giacenze non si scrivono a mano: si calcolano dal
registro. Il modulo si accende dalle impostazioni.

La pagina Magazzino ha quattro azioni a portata di mano: Consegna, Rientro,
Chi ha cosa, Scade e manca. Chi ha il ruolo di magazziniere vede in più
l'Inventario, i Verbali e registro e le Impostazioni del magazzino.

### Consegna e rientro dal web

Sul web consegna e rientro li può registrare qualunque operatore interno:
in emergenza non si aspetta il magazziniere per prendere una pala, e ogni
movimento porta comunque il nome di chi l'ha fatto. Si sceglie la persona
a cui va, poi cosa esce: il materiale si consegna sempre a una persona, che
lo ha in carico finché non lo restituisce.
Di base non c'è carta: si sceglie e si registra. Chi vuole il verbale di
consegna lo accende nelle impostazioni del magazzino; da quel momento,
consegnando a una persona, compare la casella del verbale e ORION prepara il
foglio da firmare. Se è accesa la conferma dei DPI il verbale c'è sempre,
perché è proprio quello che il volontario conferma dal telefono.

Al rientro si sceglie da chi torna il materiale, si spunta cosa torna e
quanto. Se di un materiale sfuso ne torna meno di quanto era uscito, ORION
chiede cosa ne è del resto: resta in carico a chi l'aveva (i guanti che il
volontario tiene), è stato usato sul posto (i sacchi finiti nell'argine) o è
perso. Non c'è una risposta preimpostata, perché sarebbe sbagliata una volta
su due. Sui mezzi si possono scrivere i chilometri, se si vogliono tenere: non
sono obbligatori.

Di base il rientro finisce qui: si spunta e si registra. Chi vuole anche la
carta accende, nelle impostazioni del magazzino, il verbale di rientro: da
quel momento, quando rientra materiale da una persona, ORION propone il
verbale da far firmare a chi restituisce, e lo si può togliere per un
rientro in cui non serve.

### Consegna e rientro dal telefono

Dall'app, consegna e rientro sono di chi tiene il magazzino (magazziniere e
amministratore). La consegna va in tre passi: a chi, cosa, conferma. Il
materiale va sempre a una persona; si sceglie fra DPI, attrezzature e mezzi,
per nome e taglia oppure inquadrando l'etichetta QR. La
consegna funziona anche senza rete: resta sul telefono e parte appena c'è
campo; se nel frattempo il magazzino è cambiato e il server la rifiuta,
arriva un avviso.

Il rientro dall'app segue gli stessi passi del web: da chi, cosa torna,
conferma. Fra chi restituisce compaiono anche squadre e mezzi, ma solo se
hanno ancora materiale ricevuto prima che la consegna andasse solo alle
persone. Se ne torna meno, si sceglie cosa ne è del
resto; per un mezzo si possono scrivere i chilometri. Il rientro dal telefono
vuole la rete, perché il server deve ricontrollare chi ha cosa.

Dopo una consegna, o dopo un rientro da una persona quando il verbale di
rientro è acceso, l'app propone di fotografare il foglio firmato. La foto diventa il verbale, si vede dal web e sostituisce
la carta. Una seconda foto sostituisce la prima.

### Tutto il magazzino dal telefono

Chi tiene il magazzino può lavorarlo interamente dall'app, dalla voce
Magazzino della schermata iniziale. Ritrova le stesse schede del web:
l'inventario, chi ha cosa, le scadenze, il registro e le impostazioni. In
cima all'inventario restano a un tocco la consegna, il rientro e la lettura
di un'etichetta, che apre direttamente la scheda del bene inquadrato.

Nell'inventario si cerca per nome, matricola o codice dell'etichetta e si
filtra per DPI, attrezzature o veicoli. Da qui si crea un bene nuovo, con le
sue scadenze e ogni quanto si rinnovano, oppure un DPI a taglie con le
quantità già in casa. La scheda di un DPI a taglie mostra quanti pezzi ci
sono per taglia e accoglie il carico quando arriva la fornitura: si copia la
bolla, taglia per taglia.

La scheda di un bene dice dove si trova, cosa scade, le manutenzioni fatte e
tutta la sua storia. Da lì lo si corregge con la matita in alto e lo si
movimenta: un carico, l'uscita verso l'officina, lo smarrimento, la
dismissione e, per il materiale che si conta, la rettifica. La dismissione è
l'unica operazione che chiede conferma, perché non si annulla con un
movimento contrario. Anche un intervento di manutenzione si registra da qui,
con la fattura o il verbale fotografati o scelti fra i file del telefono.

Il registro mostra i verbali, con la possibilità di fotografare il foglio
firmato o di riaprirlo, e tutti i movimenti. Nelle impostazioni ogni scelta
si salva appena la si tocca: le opzioni del magazzino, le categorie, le
ubicazioni e i propri avvisi via email. Resta sul web soltanto la stampa
delle etichette, che è lavoro da scrivania. Il magazzino nell'app vuole la
rete: si lavora sui numeri di adesso.

### Le conferme dei DPI

Se l'associazione ha acceso la conferma dall'app, chi riceve un DPI trova sul
telefono la richiesta di conferma, che vale come firma. Chi non ha l'app
conferma dal riquadro in cima al profilo web, oppure firma il foglio
stampato.

### Etichette, scadenze e manutenzioni

Ogni bene nasce con un codice di sei caratteri e dall'inventario si stampano
le etichette QR, su un foglio libero da ritagliare o sui fogli adesivi A4 più
diffusi. Si può scegliere quante copie per bene, saltare le prime posizioni
di un foglio già usato e correggere di qualche millimetro se la stampante non
centra. Inquadrando il QR con un telefono qualsiasi si apre la scheda del
bene.

Le manutenzioni periodiche di attrezzature e veicoli si registrano con il
loro verbale o fattura, e la prossima data si calcola da sola. Chi tiene il
magazzino trova ogni mattina nell'app il riepilogo di quante scadenze cadono
entro un mese e quanti oggetti sono fuori da troppo tempo; toccandolo si apre
la scheda delle scadenze. Gli avvisi via
email, invece, sono a richiesta: ognuno li accende per sé dalle impostazioni
del magazzino e sceglie ogni quanto riceverli.

Quello che si conta (pezzi, paia, kit, sacchi) si muove sempre per numeri
interi: le frecce dei campi quantità scalano di uno, e mezzo casco non si
consegna. Si frazionano soltanto le misure, come i litri di gasolio, i chili
o i metri di corda.

Un bene non si cancella mai: si dismette, esce dagli elenchi e resta nella
storia. Quando i conti non tornano si fa una rettifica, che dice onestamente
"contati, sono 170 e non 172".


## 6. L'amministratore

L'amministratore può tutto. Crea gli utenti, assegna i ruoli spuntando le
caselle (una persona può essere volontaria, segretaria e magazziniera
insieme), sospende chi non deve più entrare. I cambi di ruolo valgono subito,
anche per chi è collegato in quel momento. Un amministratore non può togliersi
l'amministrazione da solo.

Per inserire molti volontari in una volta c'è l'importazione da un foglio
Excel (.xlsx) o CSV, anche quello salvato dall'Excel italiano con il punto e
virgola. Nella prima riga servono le colonne Nome e Cognome; se ci sono si
leggono anche Email, Telefono (o Cellulare) e Codice fiscale. Ognuno entra
come volontario, con il suo link di attivazione valido sette giorni: chi ha
l'email lo riceve per posta, per gli altri c'è il pulsante per copiarlo e
mandarlo a mano. Chi è già in ORION, con lo stesso codice fiscale, la stessa
email o lo stesso nome e cognome, non viene creato di nuovo, quindi lo stesso
foglio si può ricaricare dopo averlo corretto. Alla fine ORION elenca le
righe che ha lasciato fuori, con il numero di riga e il motivo.

Nelle impostazioni si accendono i moduli (Segreteria, Magazzino), si
configura la posta, si carica il logo dell'associazione, si decide se l'app
Android è a disposizione del personale, si impostano il tempo dopo cui una
segnalazione senza squadra diventa rossa e le regole del tesserino.

### La posta in uscita

ORION manda poche email: il link di attivazione ai nuovi utenti, il recupero
della password e gli avvisi delle scadenze della segreteria. Senza posta
funziona lo stesso, ma i link vanno copiati e mandati a mano. Basta un
account Gmail gratuito, meglio se creato apposta per l'associazione invece di
usare quello di una persona.

Google non accetta da ORION la password normale dell'account: vuole una
password per le app, che si crea solo con la verifica in due passaggi
attiva. Si entra nell'account Google, nella sezione Sicurezza si attiva la
verifica in due passaggi, poi si apre la pagina
myaccount.google.com/apppasswords, si dà un nome (per esempio ORION) e si
preme Crea. Google mostra un codice di 16 lettere, che va copiato senza spazi
nel campo Password delle impostazioni di ORION. Se in futuro si cambia la
password dell'account, Google revoca le password per le app e il codice va
creato di nuovo.

Negli altri campi si scrive `smtp.gmail.com` come host, la porta 465 con
sicurezza SSL/TLS su Sì, e l'indirizzo Gmail completo come email mittente.
Va bene anche la porta 587 con SSL/TLS su No: la connessione passa comunque
a TLS. Un account gratuito manda circa 500 email al giorno, molte più di
quante ne servano. Con un altro fornitore (Aruba, Libero, la posta del
Comune) i dati sono quelli che il fornitore indica per i programmi di posta.

Sotto i campi c'è "Manda una prova", che usa quello che è scritto in quel
momento, anche prima di salvare, e spedisce un'email all'indirizzo indicato
o, se il campo è vuoto, a quello dell'amministratore. Se qualcosa non va
ORION dice cosa: credenziali rifiutate (con Gmail quasi sempre la password
normale al posto di quella per le app), porta e SSL scambiati, server che
non risponde. Quando la prova arriva, si preme Salva. Se il server di ORION
sta presso un hosting che blocca le porte della posta in uscita, la prova
finisce con un errore di connessione e va chiesto al fornitore di aprirle.

### Sistema, backup e aggiornamenti

La pagina Sistema mostra i backup, permette di farne uno subito, scaricarlo,
verificarlo e ripristinarlo. Per ripristinare servono la propria password e
la parola RIPRISTINA scritta per intero; prima di ripristinare ORION fa un
backup di sicurezza dei dati attuali. I backup restano sulla stessa macchina
del server, quindi ogni tanto va scaricata una copia e tenuta altrove.

Sempre da Sistema, con "Controlla adesso", si vede se esiste una versione più
recente, e si aggiorna. Spuntando "Cerca aggiornamenti ogni giorno" il
controllo lo fa ORION una volta al giorno e, quando trova una versione nuova,
lo dice agli amministratori con una notifica sull'app e un'email. ORION non si
aggiorna mai da solo, e con un'emergenza aperta non si può aggiornare: si
aspetta di averla chiusa.


## 7. Quando qualcosa non va

Se l'app dice "Sessione scaduta" o chiede di rientrare, di solito la password
è stata cambiata o l'account sospeso: basta rientrare, o sentire
l'amministratore. Se un esterno temporaneo trova scritto che il suo accesso è
finito, l'emergenza è stata chiusa o l'accesso revocato.

Se le notifiche non arrivano ad app chiusa, si controlla che il permesso delle
notifiche sia concesso, che il canale giusto non sia silenziato nelle
impostazioni di Android e che il risparmio energetico non blocchi l'app. Un
controllo ogni ora vuol dire che una notifica può arrivare con qualche
minuto di ritardo; in emergenza il ritardo scende a un quarto d'ora al
massimo, e con l'app aperta è immediato.

Se la sala non vede una squadra sulla mappa, il telefono non ha la posizione
"Consenti sempre" oppure la persona non è in una squadra.

Se una consegna fatta senza rete non compare sul web, è ancora nella coda del
telefono: parte appena c'è campo, e l'app lo dice nella schermata della
consegna.

Se le email non partono, la prima cosa è "Manda una prova" nelle
impostazioni della posta, che dice il motivo; il registro del server tiene
anche gli errori degli invii automatici.
