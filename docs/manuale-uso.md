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
attivazione, valido sette giorni. Se la posta dell'associazione è configurata
il link arriva per email; altrimenti l'amministratore stampa il foglio di
attivazione e lo consegna a mano: c'è il nome, il nome utente e un QR da
inquadrare con la fotocamera del telefono. Aprendo il link si sceglie la
propria password, e la pagina d'accesso si apre con il nome utente già
scritto. Non esistono password predefinite uguali per tutti.

Dopo l'accesso ognuno arriva dove lavora. Con un'emergenza aperta si va tutti
al centro operativo. Senza, l'amministratore arriva al centro operativo (da lì
si apre l'emergenza), chi tiene la segreteria alla segreteria, il magazziniere
al magazzino e il volontario al suo profilo, con DPI, scadenze e tesserino.

Se la password si dimentica, dalla pagina d'accesso c'è "Password
dimenticata". Funziona solo se la posta è configurata; in caso contrario ci si
rivolge all'amministratore, che può azzerarla e dare un nuovo link.

### La verifica in due passaggi

Con la verifica in due passaggi, per entrare non basta la password: ORION
chiede anche un codice di sei cifre che un'app sul telefono cambia ogni 30
secondi. Chi scopre la password, da sola, non entra. L'app è una qualsiasi di
quelle per i codici a tempo: Google Authenticator, Microsoft Authenticator,
FreeOTP, Aegis. Funziona anche senza rete, perché il codice lo calcola il
telefono, e ORION non passa da nessun servizio esterno.

Per gli amministratori e per chi gestisce visite mediche e corsi, che vede
dati sanitari, è obbligatoria. La prima volta che entra con la password, ORION
gli mostra un QR: lo inquadra con l'app, scrive il codice che compare e la
verifica è attiva. Lo stesso succede a chi riceve quel ruolo o quel permesso,
che viene fatto rientrare subito anche se era già collegato.

Per tutti gli altri è facoltativa e si attiva da "Il mio profilo", sezione
Sicurezza, con "Attiva": ORION chiede la password, mostra il QR e aspetta il
primo codice. Da lì si passa anche a un telefono nuovo ("Cambia telefono": il
vecchio vale finché non si conferma il codice del nuovo) e, chi non è
amministratore, la toglie. Gli accessi esterni temporanei, che entrano con il
QR del centro operativo, non la usano.

Quando la si attiva, ORION mostra dieci codici di riserva. Ognuno vale una
volta, al posto del codice dell'app, quando il telefono non c'è. Si stampano o
si scrivono e si tengono lontano dal telefono, perché non si vedranno più; se
ne restano pochi, ORION lo dice all'accesso, e dal profilo se ne creano di
nuovi ("Nuovi codici di riserva", e i vecchi smettono di valere). Se il codice
dell'app viene rifiutato anche se è giusto, quasi sempre l'ora del telefono
non è impostata in automatico.

Chi ha perso il telefono e i codici chiede a un amministratore, che in
Gestione utenti azzera la sua verifica (il pulsante con il telefonino, accanto
alla chiave della password). Se l'unico amministratore perde sia il telefono
sia i codici, chi gestisce il server la toglie dalla console, come spiega il
manuale tecnico.

Nell'app Android, dopo la password compare il campo del codice. Chi usa
l'impronta la registra dopo un accesso con il codice, e da quel momento entra
con l'impronta senza codice: il telefono con l'impronta fa già da secondo
passaggio. Se l'impronta era stata registrata prima di attivare la verifica,
la prima volta dopo l'impronta l'app chiede il codice, una volta sola: da lì
l'impronta torna a bastare da sola, senza registrarla di nuovo. Un
amministratore che non ha ancora attivato la verifica la attiva una volta dal
browser, poi torna nell'app.

### Le condizioni d'uso

Al primo accesso, prima di qualunque altra cosa, ORION mostra le condizioni
d'uso. Si leggono, si spunta la casella (ho letto e accetto le condizioni,
in particolare l'impegno alla riservatezza) e si continua; senza, ORION non si
usa, e "Esci" chiude l'accesso. Lo stesso succede dall'app, e succede di nuovo
ogni volta che l'amministratore pubblica un testo nuovo. Una pagina già aperta
se ne accorge alla prima azione e porta alle condizioni, poi torna dov'era.
Il testo si rilegge quando si vuole dal link sotto il modulo di accesso, dalla
sezione Sicurezza del profilo e, nell'app, dal Mio profilo.

Le condizioni dicono che ORION lo installa e lo gestisce l'organizzazione che
lo usa, che ne risponde, e che il programma è fornito così com'è, senza
garanzie; che l'account è personale; che i dati visti in ORION sono riservati
e si usano solo per la protezione civile; che ogni operazione resta nel
registro; e quali dati restano quando una persona viene eliminata: solo nome
e cognome legati alle operazioni che ha svolto, per l'integrità dello storico.
Dicono anche che ORION usa solo cookie tecnici (la sessione, il nome utente)
e qualche preferenza salvata nel browser, senza cookie di profilazione, di
statistica o di pubblicità: per questo non c'è un banner dei cookie e non si
chiede un consenso.
Un'informativa sul trattamento dei dati per ora ORION non la propone: chi ne
ha bisogno può scriverla nelle proprie condizioni o tenerla fuori da ORION.

### L'app proposta dal browser

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

Dalla schermata principale si aprono anche i Documenti del gruppo (il
capitolo 6 dice come funzionano): il piano, le procedure, i libretti. Quelli
segnati con il simbolo verde stanno sul telefono e si aprono anche senza
rete. Si apre anche il Calendario (capitolo 7), con le attività, le
scadenze e il numero delle convocazioni che aspettano risposta; da lì si
risponde e si vedono le proprie presenze con gli attestati.

Quando l'associazione mette sul server una versione nuova dell'app, l'app si
aggiorna da sola, dalla versione 1.2.1 in poi. La scarica appena la vede, e la
installa quando la si lascia (uscendo dall'app o ad app chiusa), così non si
chiude sotto le mani di chi la sta usando; mentre si è in squadra con
un'emergenza aperta aspetta. La prima volta Android chiede due cose: il
permesso di installare app per ORION (la schermata principale porta alle
impostazioni con "Consenti": si attiva "Consenti da questa fonte") e la
conferma dell'aggiornamento. Da Android 12 in poi, dopo il primo
aggiornamento fatto così, i successivi non chiedono più niente. Nella
schermata principale un riquadro dice a che punto è (in scarica, pronta, in
installazione) e "Aggiorna ora" la installa subito. L'app controlla che il
file sia proprio ORION, più recente e firmato con la stessa chiave: un file
diverso non si installa. Chi ha ancora la 1.2.0 o una precedente aggiorna a
mano un'ultima volta, scaricandola dalla schermata principale.

### Le notifiche

Le email restano quelle di sempre: gli avvisi delle proprie scadenze e,
per chi li riceve, i riepiloghi mensili. Tutto il resto arriva come notifica
dell'app, divisa in quattro gruppi. Emergenza: l'ingresso in una squadra
durante un'emergenza e l'intervento assegnato alla propria squadra. Chi non è
in squadra non riceve niente dell'emergenza e non la vede nell'app. Per te: i DPI da confermare e le
proprie scadenze. Segreteria e Magazzino: i riepiloghi del mattino, solo per
chi ha quei ruoli.

Sul telefono ogni gruppo è un canale a sé, e dalle impostazioni di Android si
può silenziare uno senza perdere gli altri. Chi fa segreteria e trova il
riepilogo quotidiano superfluo, per esempio, può togliergli il suono e
tenere a pieno volume quello dell'emergenza.

Le notifiche invecchiano e spariscono da sole quando non servono più: quella
dell'emergenza si toglie alla chiusura o quando si esce dalla squadra, quella del DPI quando lo si conferma,
il riepilogo quando arriva quello nuovo. Nella schermata delle notifiche, se
ci sono gruppi diversi, compaiono in alto i filtri per guardarne uno solo.
Toccando una notifica si arriva dove la cosa si guarda: l'intervento, la
segreteria, il fascicolo.

Perché le notifiche arrivino subito anche ad app chiusa, gli avvisi sono
sempre attivi: l'app resta in ascolto del server dell'associazione, senza
passare da servizi esterni. Android lo segnala con un'icona fissa fra le
notifiche, che abbiamo reso la più discreta possibile: niente icona nella
barra in alto, niente suono, nascosta sulla schermata di blocco. La prima
volta l'app lo spiega; gli avvisi si possono spegnere quando si vuole da Io,
Il mio profilo, Avvisi sul telefono. Spenti, il telefono controlla la coda
solo ogni tanto (ogni ora, ogni quarto d'ora durante un'emergenza) e Android
può rimandare i controlli anche di ore: le notifiche possono arrivare in
ritardo o non arrivare.

Nella stessa schermata ci sono i controlli che decidono se gli avvisi
arrivano: il permesso per le notifiche, il canale Emergenza non silenziato,
l'esclusione dal risparmio energetico, il collegamento con il server. Ogni
voce da sistemare si tocca e porta dove si sistema. Su alcuni telefoni
(Xiaomi, Huawei, Samsung e altri) serve un passaggio in più, e la schermata
dice quale. "Manda una prova" fa arrivare una notifica dopo venti secondi: si
chiude l'app, si spegne lo schermo e si guarda se arriva. Conviene farla
appena installata l'app.

Gli avvisi continuano ad arrivare anche quando la sessione scade e per
rientrare serve l'impronta. Si fermano solo uscendo dall'app, cambiando la
password o se l'account viene sospeso. In Gestione utenti, accanto al nome di
ciascuno, l'icona del telefono è verde se in quel momento il suo telefono è
in ascolto, grigia se non si fa sentire da un po'.


## 3. L'emergenza

### Aprire e chiudere

Dal centro operativo, "Apri emergenza". Se ci sono già squadre formate,
la finestra le elenca: di base entrano nell'emergenza così come sono, e i
loro membri risultano entrati in squadra in quel momento; spuntando la
casella si sciolgono e si parte da zero. Nessuno riceve un avviso solo
perché l'emergenza è aperta: sul telefono l'emergenza compare a chi è in una
squadra. Chi è già in una squadra formata prima riceve l'avviso
all'apertura; gli altri lo ricevono quando il centro operativo li mette in
squadra, e lo perdono quando ne escono.

Per chiudere, "Chiudi emergenza". Se sulla mappa ci sono ancora strade
chiuse o zone interdette, la finestra le elenca, già spuntate: quelle
spuntate restano sulla mappa anche dopo la chiusura (una frana che tiene
chiusa una strada per mesi), le altre finiscono con l'emergenza. Una strada
rimasta chiusa si riapre dalla mappa quando riapre davvero, anche senza
emergenza aperta.

Alla chiusura ORION fa da solo tre cose. Salva un backup del database, perché
è il momento in cui il registro è completo. Scrive il resoconto
dell'intervento, che dall'Archivio Emergenze si stampa (o si salva in PDF)
con "Stampa resoconto", oppure si scarica come file di testo da allegare con
"Scarica .txt". Chiude d'ufficio le
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

Gli avvisi a comparsa del centro operativo (le novità arrivate da altre
postazioni e le conferme come "Segnalazione spostata" o un errore di rete)
compaiono in alto a destra sopra la mappa, accanto alla linguetta degli
eventi, uno sotto l'altro, e se ne vanno da soli; un clic li chiude prima.
Non coprono la barra delle squadre né l'elenco delle segnalazioni.

### Il diario di sala

Nel centro operativo, sopra l'elenco degli eventi, c'è un campo per scrivere
nel diario di sala. Serve per quello che non appartiene a una segnalazione:
la telefonata con il sindaco, la decisione di chiudere una strada, la
richiesta arrivata dalla Prefettura. Si scrive e si preme Annota, oppure
Ctrl+Invio. La nota compare subito a tutte le postazioni, con
l'ora e il nome di chi l'ha scritta, e alla chiusura apre il resoconto. Chi
non lo usa può ignorarlo del tutto.

### Il punto di situazione

Nell'intestazione del centro operativo, a emergenza aperta, il pulsante
"Situazione" apre in una scheda nuova il foglio con la situazione di quel
momento: quante segnalazioni sono aperte (e quante ad alta priorità o ancora
senza squadra), le segnalazioni aperte una per una con priorità, stato,
squadre e ultimo aggiornamento, le squadre con i loro componenti, dove sono
impegnate e da quanto non si sa la loro posizione, le segnalazioni già chiuse
con il loro esito e le ultime note del diario di sala. È fatto per il briefing
al cambio turno e per chi coordina da fuori: "Stampa o salva in PDF" lo
manda alla stampante, oppure lo salva come PDF da mandare per email, su un
foglio A4 con i margini e il numero di pagina. "Aggiorna" lo rifà con i dati
nuovi. Lo vedono gli operatori interni, non gli esterni. Per un'emergenza
chiusa lo stesso foglio è il resoconto, e lo stampa l'amministratore
dall'Archivio.

In cima al foglio, prima dei numeri delle segnalazioni, c'è il quadro della
situazione: quello che chi legge da fuori (Prefettura, Regione, il Comune)
cerca per primo e che ORION da solo non può sapere. Si compila con il
pulsante "Quadro della situazione" nella barra in alto: che cosa sta
succedendo e come evolve, la popolazione coinvolta (evacuati, assistiti,
isolati, feriti, dispersi, deceduti), i servizi essenziali interrotti, le
richieste di supporto agli enti, il recapito del COC attivo giorno e notte,
il responsabile e l'ora del prossimo aggiornamento. Nessun campo è
obbligatorio e quelli lasciati vuoti non compaiono sul foglio; nei numeri,
vuoto vuol dire "non indicato" e zero vuol dire nessuno. "Salva e aggiorna il
foglio" lo conserva per quell'emergenza, con l'ora e il nome di chi l'ha
scritto: alla stampa successiva si corregge solo quello che è cambiato. In una
nuova emergenza recapito e responsabile sono già proposti da quella
precedente. Finché il quadro è vuoto, a video compare un promemoria che non
finisce sulla carta. Le forze in campo (squadre impegnate e libere, volontari
in squadra) non si scrivono: le conta ORION. Il quadro resta nel resoconto
dell'emergenza chiusa, ma da lì non si modifica più.

### La rubrica

Accanto a "Situazione" c'è "Rubrica": i numeri che in sala servono subito,
divisi in gruppi (istituzioni ed enti, soccorso e forze dell'ordine,
reperibili, ditte e servizi, associazione, altri). Si cerca scrivendo un pezzo
di nome, di ente o di numero. Dal telefono o da un computer con un programma
per le chiamate, il numero si tocca e parte la chiamata. "Nuovo contatto"
aggiunge una voce, "Modifica" la corregge o la toglie; per ogni contatto
servono il nome e almeno un telefono o un'email. La tengono aggiornata tutti
gli operatori interni, come le squadre, e ogni modifica finisce nel registro
con il nome di chi l'ha fatta. Gli esterni la consultano e la stampano, ma
non la modificano. "Stampa" apre la
rubrica su un foglio da stampare: conviene tenerne una copia in sala, perché
se la rete cade i numeri restano sulla carta.

### Le segnalazioni

Una segnalazione si crea dal centro operativo con "Crea segnalazione":
indirizzo o punto sulla mappa, chi ha chiamato, cosa succede. Serve solo il
titolo, cioè cosa succede: nome e numero di chi chiama si scrivono quando ci
sono, ma una chiamata girata dal 112 o di un passante che riattacca si
registra lo stesso. Ogni cosa che
accade dopo finisce nel suo diario, in ordine di tempo, distinguendo le note
scritte dagli operatori dagli eventi registrati dal sistema.

Aprendo una segnalazione, la parte bassa del pannello è sempre il diario, con
le ultime note in vista: anche quando la descrizione è lunga o ci sono molte
squadre e funzioni, è la parte alta a scorrere, e il diario non sparisce. Così
basta aprirla per sapere a che punto è.

Il punto sulla mappa si sceglie (o si sposta, con l'icona del segnaposto nel
pannello) cliccando dove si vuole, anche dentro una zona o un'area già
disegnata: mentre si sceglie il punto, zone e strade non rispondono al clic.
Il segnaposto diventa una X finché la scelta è in corso; cliccandolo di nuovo
si annulla.

Se la segnalazione cade dentro una zona di pericolo della mappa (alluvione,
frana o altro pericolo), ORION lo scrive da solo nei rischi, con una riga che
comincia con "⚠" e dice il tipo, il nome e il livello della zona, per esempio
"⚠ Pericolo frana: Borgo Piave (livello P2)". Succede quando la segnalazione
si crea o si sposta, e anche quando una zona di pericolo si disegna, si
modifica o si toglie sopra segnalazioni già aperte. Se la segnalazione esce
dalla zona, o la zona viene tolta, la riga se ne va. Ogni cambio lascia una
nota di sistema nel diario. Il resto dei rischi, scritto a mano, non viene
mai toccato; le aree del piano (attesa, accoglienza, ammassamento) e le zone
interdette non contano, perché non sono un pericolo.

Una segnalazione senza squadra, passato un certo tempo (di norma 15 minuti),
si accende in rosso con la scritta DA ASSEGNARE. Non tutte però aspettano una
squadra: dal pannello Gestisci si può dire che è gestita da un altro ente, che
va solo tenuta d'occhio, o che non serve intervenire. Da lì in poi non viene
più segnalata come in ritardo, e la scelta resta nel diario e nel resoconto.

Assegnare la prima squadra a una segnalazione "Nuova" o "Aperta" la porta da
sola a "In corso"; togliendo l'ultima squadra un intervento "In corso" torna
"Aperta", perché aspetta di nuovo qualcuno. Il cambio resta nel diario come
ogni altro, e lo stato si può sempre correggere a mano.

### Seguire le segnalazioni durante l'emergenza

Ogni scheda dell'elenco porta, sotto l'indirizzo, l'ultima notizia scritta da
una persona: il testo, chi l'ha scritta e da quanto ("P. Zanella · 3 min fa").
Sta su una riga sola, così le schede restano basse e se ne vedono tante; il
testo intero compare passandoci sopra con il mouse e, naturalmente, aprendo la
scheda. Le note di sistema (squadre assegnate, cambi di stato) non la
sostituiscono: si leggono nel diario.

Sopra l'elenco c'è il riepilogo: quante segnalazioni sono aperte, quante da
assegnare, quante con una squadra, quante senza bisogno di squadra e quante
hanno novità non ancora viste. Un clic su una voce mostra solo quelle (per
esempio solo quelle da assegnare); un altro clic, o "Aperte", le rimostra
tutte. Il riepilogo si aggiorna da solo a ogni notizia.

Sulla mappa il colore del segnaposto dice la situazione: rosso da assegnare,
blu con una squadra, viola senza bisogno di squadra, verde risolta, grigio
chiusa. Le segnalazioni con priorità alta hanno il segnaposto più grande. I
pallini del riepilogo hanno gli stessi colori e fanno da legenda. Quando
arriva una novità che non hai ancora visto, la scheda lampeggia come sempre e
il suo segnaposto salta con un anello giallo attorno, qualunque sia il suo
colore; smette quando apri la segnalazione. Se più segnaposto vicini sono
raggruppati in un cerchio con il numero, il cerchio prende il colore della
situazione più urgente fra le sue e salta anche lui se una di loro ha
novità.

Le novità hanno due pesi. Sono forti una nota scritta da una persona (dal
campo o da un collega), delle foto, una segnalazione nuova e la priorità
alzata ad alta: la scheda lampeggia, il segnaposto salta e in alto a destra
compare un avviso. Sono deboli le modifiche fatte dai colleghi in sala (stato,
squadre, priorità, campi): la scheda prende solo il numero, senza lampeggio e
senza avviso, così le correzioni dei colleghi non coprono le notizie vere.
Quello che fai tu non è mai una novità per te. Sulla segnalazione che hai
aperta in quel momento non arriva niente: la stai già leggendo.

Gli avvisi restano finché non li chiudi con la crocetta, non premi "Vai" o
non apri la segnalazione a cui si riferiscono; quando sono più di due, in cima
compare "Chiudi tutti gli avvisi". Se sono tanti, la colonna scorre.

Fin dove hai letto ogni segnalazione lo ricorda il server, non il browser:
ricaricando la pagina o passando a un altro computer i numeri e il lampeggio
di quello che non hai ancora visto tornano come li avevi lasciati.

In alto, accanto a "Rubrica", il pulsante "Avvisi sul computer" (compare
finché non hai deciso) chiede al browser il permesso di mostrare gli avvisi
anche nell'angolo dello schermo, quando la finestra del centro operativo non
è in primo piano: mentre scrivi una PEC o sei su un altro programma. Un clic
sull'avviso riporta al centro operativo, sulla segnalazione. Quelli urgenti
restano finché non li chiudi. Serve l'indirizzo sicuro (https) del server; se
il permesso è stato negato si riattiva dalle impostazioni del sito nel
browser, il lucchetto accanto all'indirizzo.

### Le funzioni di supporto

Se l'amministratore ha acceso il modulo, il COC lavora per funzioni, come nel
metodo Augustus: sanità e assistenza sociale, viabilità, assistenza alla
popolazione e le altre del piano comunale. Una segnalazione non appartiene a
una funzione sola: a ogni funzione che deve fare qualcosa si dà un incarico,
con il perché.

Nel dettaglio della segnalazione c'è il riquadro "Funzioni di supporto". Un
operatore del COC tocca "Assegna a una funzione", sceglie la sigla (accanto
compare il referente) e scrive la motivazione, che è quello che leggerà chi
prende l'incarico: "Due persone allettate in via Roma 12, servono trasporto e
assistenza". Chi fa parte della funzione lo trova subito fra le notifiche,
anche sul telefono. Una funzione ha un solo incarico aperto per segnalazione;
se serve altro si aggiunge una nota.

Chi se ne occupa tocca "Prendo in carico", così il referente sa che qualcuno
ci sta lavorando. Le note di lavoro ("contattata la RSA, posto dalle 16") si
scrivono nel diario della segnalazione con "Nota per la F2": portano la sigla
della funzione e restano in ordine con tutto il resto. Quando il compito è
fatto si tocca "Concludi" e si scrive l'esito. Concludere un incarico non
chiude la segnalazione: l'assistenza sociale finisce il suo lavoro e la frana
resta aperta finché la viabilità non ha finito il suo. Un incarico dato per
sbaglio si annulla finché nessuno l'ha preso.

Sulla scheda della segnalazione, nell'elenco, le sigle dicono a colpo
d'occhio chi ci sta lavorando: piene finché c'è da fare, tratteggiate e con la
spunta a lavoro finito. Il pulsante "Funzioni" nell'intestazione apre il tavolo
di ogni funzione: in alto si sceglie la sigla (con il numero di incarichi
aperti), sotto ci sono gli incarichi da fare, dal più vecchio, con la
motivazione e i pulsanti per prenderli e concluderli, e un clic sul titolo
porta alla segnalazione sulla mappa. In fondo c'è chi fa parte della funzione.

Prendere in carico e concludere spetta ai membri della funzione e agli
operatori interni del COC; assegnare spetta agli operatori interni, come per
le squadre. Un esterno che fa parte di una funzione, per esempio l'operatrice
dei servizi sociali del Comune nella F2, vede nel pannello solo la sua
funzione, e può scrivere note, prendere e concludere gli incarichi della sua
funzione; sulle altre segnalazioni resta in sola lettura, e anche su quella
quando l'incarico della sua funzione è concluso o il modulo viene spento. I membri fissi li
indica l'amministratore; durante un'emergenza ogni operatore del COC aggiunge
gli accessi temporanei, scegliendo la funzione nella finestra "Accesso esterno"
o dal pannello Funzioni.

Il punto di situazione ha una sezione per ogni funzione con il referente, gli
incarichi da fare con la motivazione e quelli conclusi con l'esito: è il
foglio del giro di tavolo in riunione. Il resoconto riporta per ogni
segnalazione le funzioni coinvolte e, nel diario, motivazioni ed esiti.

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

### La squadra COC

All'apertura di un'emergenza ORION crea da sé la squadra COC, la sala
operativa: ci entrano il coordinatore e chi lavora in sala, come in
qualunque altra squadra, dal centro operativo o dalla gestione delle
squadre. Non ha un nome radio vero, non si manda sugli interventi e il
telefono di chi ne fa parte non manda la posizione. In compenso chi è nella
squadra COC, anche dall'app, vede tutte le segnalazioni aperte e non solo
quelle della sua squadra, e scrive nel loro diario. Il coordinatore che va
sul campo resta nella COC e segue tutto dal telefono. Nella barra delle
squadre del centro operativo la COC sta per prima, con il numero di persone
in sala. Possono entrarci anche gli esterni temporanei, per esempio il
tecnico del comune che siede in sala. La squadra non si elimina mentre
l'emergenza è aperta e si scioglie da sola alla chiusura; il tempo passato
in sala conta come presenza (capitolo 7).

### La chiamata dei volontari

Quando servono persone in sede, la sala le chiama da ORION invece di fare
il giro di telefonate. Il pulsante "Volontari" in alto nel centro operativo
apre il pannello della chiamata. Chiama chi può aprire le emergenze o
organizzare le attività; il pannello, con le risposte e gli arrivi, lo segue
chiunque lavori in sala.

Con "Chiama volontari" si sceglie chi: tutti i volontari, i reperibili del
giorno secondo i turni del calendario, chi ha un corso valido (per esempio
il corso motosega o idrovore) oppure le persone scelte a mano dall'elenco.
Restano sempre fuori chi è già in una squadra e chi sta già arrivando. Chi ha
segnato un'assenza per quel giorno, o ha già detto di non poter venire,
resta fuori anche lui, tranne quando la sala lo sceglie a mano: allora lo ha
deciso la sala, e la chiamata parte. Si scrive un messaggio breve, che
è quello che la persona legge sul telefono, e si sceglie come avvisare:
l'avviso nell'app, l'email o tutti e due. L'ultimo campo dice dopo quanti
minuti chi non ha risposto va chiamato a voce.

Chi è chiamato risponde con un tocco: "Arrivo", "Arrivo fra 30 minuti" (o
un'ora, o due) oppure "Non posso". Il pannello divide le persone per come
stanno. In cima ci sono quelle da chiamare a voce: non hanno risposto in
tempo, o non si raggiungono né dall'app né per email, e accanto c'è il
numero di telefono. Poi chi è in attesa di risposta, chi è in arrivo, con
l'ora prevista, e chi è in sede senza squadra. Chiude l'elenco chi non viene.
Quando qualcuno arriva lo dice lui dal telefono con "Sono arrivato", oppure
la sala lo segna con "È arrivato". Chi si presenta senza essere stato
chiamato si segna con "È arrivato qualcuno". Da quel momento conta come
presente, anche prima di entrare in una squadra, e nella composizione delle
squadre compare per primo con la scritta "In sede". "Congeda" lo rimanda a
casa e chiude la sua presenza. "Richiama chi non ha risposto" rimanda
l'avviso a chi tace.

### Rispondere alla chiamata dal telefono

La chiamata arriva come notifica d'emergenza e la notifica apre la schermata
"Chiamata". Lì ci sono il messaggio della sala e i pulsanti grandi per
rispondere. La stessa chiamata compare in cima alla schermata principale
finché non si risponde, con "Rispondi". Dopo la risposta resta lì "Sei in
arrivo", e il tocco porta a "Sono arrivato in sede". La risposta si può
cambiare finché non si è arrivati: chi aveva detto "fra un'ora" e invece è
libero subito tocca "Arrivo". Dalla stessa schermata si segnano le assenze
(capitolo 7).

### Il caposquadra

Ogni squadra può avere un caposquadra, uno solo; non è obbligatorio. Dal
centro operativo si clicca la squadra nella barra in basso, si sceglie
"Membri" e si tocca la stella accanto al nome: la stella piena è il
caposquadra, toccarla di nuovo lo toglie, toccare quella di un altro lo
cambia. Lo stesso si fa componendo o modificando la squadra, con la stella
accanto a ogni membro scelto. Chi viene nominato riceve una notifica
sull'app. Chi esce dalla squadra smette anche di esserne il caposquadra.

Con il modulo Segreteria acceso, il centro operativo vede di ogni
caposquadra il nome e il numero di telefono dell'anagrafica: nel menu della
squadra, nel riquadro sulla mappa e, nel dettaglio di una segnalazione,
accanto a ciascuna squadra assegnata. Il numero si tocca per chiamare, utile
quando la radio non va. Se il caposquadra non risponde, la finestra dei
membri della squadra ha il numero di ognuno. Senza la segreteria si vedono
solo i nomi. I numeri non li vedono gli esterni.

Durante l'emergenza il registro delle squadre annota anche le nomine, e il
resoconto finale le riporta; chi era caposquadra all'apertura risulta
nominato in quel momento. Il punto di situazione lo segna accanto al nome.

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

### Quando la rete non c'è

Le mappe stradale e satellite arrivano da internet. Se l'associazione ha
caricato la cartografia del suo territorio (Impostazioni › Livelli del
piano, più sotto nel capitolo dell'amministratore), fra i fondi c'è anche
"Territorio (dal server)", e quando le mappe da internet smettono di
arrivare la mappa ci passa da sola e lo dice con un avviso. Si può
sceglierla anche a mano, per esempio in una sala dove internet è lento.

Se invece è il server a non rispondere, il centro operativo non si svuota:
in alto compare una fascia rossa che dice "Il server non risponde" e l'ora
della situazione che si sta guardando, cioè l'ultima arrivata. In quel
momento non si ricarica la pagina, perché senza server non si riaprirebbe.
Si continua a lavorare: una segnalazione nuova, una nota, un cambio di
stato o di priorità, una voce del diario di sala restano in coda, e la
fascia dice quante sono e con "Vedi" le elenca, ciascuna con "Togli" per
non mandarla più. Il centro operativo riprova da solo ogni dieci secondi
(o subito con "Riprova ora"); quando il server risponde, la coda parte
nell'ordine in cui è stata fatta, senza doppioni anche se qualcosa era già
arrivato prima che la linea cadesse, e la situazione si rilegge tutta.

Un cambio di stato fatto senza rete porta con sé lo stato che si aveva
davanti. Se nel frattempo un altro collega ha già cambiato quella
segnalazione, il cambio non si fa: nella fascia compare "non inviata" con
il motivo ("Nel frattempo la segnalazione è passata a…"), e si guarda la
segnalazione per decidere di nuovo. Lo stesso vale per qualunque altra
cosa che il server rifiuta al ritorno: resta in vista finché non si preme
"Ho visto".

### Strade chiuse e zone sulla mappa

Sulla mappa del centro operativo ogni tipo di elemento è un livello con il
suo colore: strade chiuse in rosso pieno, con il simbolo del divieto ai due
capi; zone interdette in rosso, con un tratteggio incrociato; zone a pericolo
di alluvione in blu, di frana in marrone e le altre zone di pericolo in
arancione, con il bordo a trattini e righe diagonali dentro; aree di attesa, di
accoglienza e di ammassamento in verde, verde acqua e viola, con una fascia
colorata lungo il bordo. Ogni bordo ha sotto un alone bianco che lo stacca da
qualunque sfondo, anche dal satellite; dentro le zone il tratteggio e il velo
sono leggeri, così strade, nomi e segnaposti sotto restano leggibili e dove due
zone si sovrappongono si riconoscono entrambe. Il controllo dei livelli in
basso a sinistra fa da legenda.

Guardando tutto il comune da lontano (zoom 12 o 13) un campo sportivo o una
piazza sono grandi pochi pixel e non si vedrebbero. Per questo un'area troppo
piccola sullo schermo diventa un simbolo di misura fissa, nel colore del suo
tipo e con la sua icona: le persone per le aree di attesa, la tenda per
l'accoglienza, il camion per l'ammassamento, il triangolo per i pericoli, il
divieto per le zone interdette. Più aree dello stesso tipo vicine fra loro
diventano un solo simbolo con il numero, e toccarlo avvicina la mappa su di
loro; toccare un simbolo singolo apre la scheda dell'area. I simboli di tipi
diversi non si coprono: se il posto è già preso si spostano di poco. Il nome
delle aree raccolte compare passandoci sopra col mouse. Avvicinandosi, quando
l'area diventa abbastanza grande, il simbolo lascia il posto alla forma vera.

"Sfondo attenuato", in fondo al controllo dei livelli, toglie quasi tutto il
colore alla mappa di base: boschi, prati e strade non fanno più concorrenza a
zone, simboli, segnalazioni e squadre, che a colpo d'occhio risaltano. È spento
di base, con i colori pieni, e si accende con un clic; il browser ricorda la scelta. Vale anche per
il satellite. Segnalazioni e posizione delle squadre stanno in cima;
gli elementi disegnati sono raccolti in tre gruppi: "Viabilità e
interdizioni" (strade chiuse e zone interdette), "Pericoli" (alluvione, frana,
altri pericoli) e "Aree del piano di protezione civile" (attesa, accoglienza,
ammassamento). La casella del gruppo li accende o li spegne tutti insieme con
un clic; se ne è acceso solo qualcuno la casella si mostra a metà, e un clic
li riaccende tutti. La freccia accanto al gruppo apre i tipi uno per uno, per
accenderli e spegnerli singolarmente; il browser ricorda quali gruppi si
tengono aperti.

Avvicinandosi, dentro ogni zona e area compare un'etichetta con il nome e il
tipo (con il livello, se c'è), scritta nel colore della zona e contornata di
bianco, così si legge su qualunque sfondo e si capisce a quale zona appartiene
anche dove due zone si sovrappongono. L'etichetta sta nel punto più interno
della zona, non nel suo centro geometrico: in una zona a forma di C o di L
resta sopra la zona e non finisce nel vuoto in mezzo. Se la zona è più grande
dello schermo, o in parte coperta dal pannello di una segnalazione, l'etichetta
si sposta nella parte che si vede. Compare solo quando la zona sullo schermo è
abbastanza larga da contenerla e non si sovrappone a un'altra etichetta (le
zone più grandi hanno la precedenza); le etichette stanno sotto i segnaposti
delle segnalazioni e delle squadre, quindi non li coprono. Spegnendo un livello
spariscono anche le sue etichette.

Il pulsante con la matita, sopra i livelli, serve a disegnare. "Strada
chiusa" chiede di toccare l'inizio e la fine del tratto: la linea segue la
strada da sola, usando lo stesso servizio dei percorsi delle squadre. Se il
servizio non risponde, ORION lo dice e traccia una linea dritta, che si
corregge con "Sposta i punti"; c'è anche "Strada chiusa, a mano", per
disegnarla punto per punto. "Zona interdetta", "Zona di pericolo" e "Area
del piano" chiedono di toccare i vertici del contorno e di chiuderlo toccando
il primo; si può disegnare anche sopra zone che ci sono già. Poi si sceglie il
tipo, si scrive dove (o il nome) e, se serve, le note: perché è chiusa, la
deviazione, chi presidia. Per una zona di pericolo il tipo propone "Zona di
pericolo (altro)", per quello che non è alluvione o frana: un incendio, un
crollo, una valanga, una fuga di gas; che pericolo sia lo dicono il nome, il
livello e le note. Alluvione e frana restano scelte a parte.

Una zona non ferma i clic: dentro la zona la mappa si comporta come fuori, si
trascina, si sceglie un punto, si apre la segnalazione o la squadra che ci sta
sopra. I dati di una zona si aprono cliccando il suo bordo, che si ingrossa
quando il mouse ci passa sopra, oppure la sua etichetta; una strada chiusa o
un'area segnata con un punto si aprono cliccandole. Si leggono i dati, da
quando c'è e chi l'ha messo.
Chi lavora in sala può modificarlo, spostarne i punti e toglierlo: una strada
"riaperta" sparisce dalla mappa ma resta nel punto di situazione e nel
resoconto, con chi l'ha chiusa e riaperta e quando. Strade chiuse e zone
interdette appartengono all'emergenza e finiscono con lei; gli esterni le
vedono, per sapere quale strada non prendere, ma non le modificano. Durante
l'emergenza, dal riquadro di una strada chiusa o di una zona interdetta, "Resta
dopo l'emergenza" la segna perché resti sulla mappa anche dopo la chiusura; la
stessa scelta si fa anche al momento di chiudere. Il punto di
situazione ha la sezione "Strade chiuse e zone", con quelle in vigore e quelle
già tolte.

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

Se nella stessa squadra più persone hanno l'app, la sala riceve la posizione
di un telefono solo, così la squadra non salta sulla mappa quando le persone
si allontanano fra loro. Se c'è un caposquadra è il suo. Se non c'è, o se il
suo telefono smette di trasmettere per più di tre minuti (app chiusa,
batteria, niente campo), subentra uno degli altri, e la tiene finché il
caposquadra non torna o finché a sua volta non tace. Gli altri telefoni
restano pronti: la notifica fissa e la schermata dell'emergenza dicono chi
sta mandando la posizione della squadra. Il caposquadra vede scritto che la
manda il suo telefono. Anche da fermo, il telefono la rimanda ogni minuto,
così chi è fermo non sembra sparito. Nel riquadro della squadra sulla mappa
la sala legge da quale telefono arriva.

Nella stessa schermata, sotto l'intervento, c'è l'elenco "Strade chiuse e
zone" con quello che la sala ha disegnato sulla mappa per questa emergenza:
prima le strade chiuse, con la deviazione se è stata scritta, poi le zone
interdette. "Mappa" apre il punto nell'app di mappe del telefono. Se il luogo
dell'intervento cade dentro una zona di pericolo (alluvione, frana o altro),
del piano o disegnata in sala, o dentro una zona interdetta, un riquadro rosso in cima lo dice prima
di partire. L'elenco lo vede anche chi non è in una squadra, dal riquadro
dell'emergenza nella schermata principale. L'app non ha una mappa sua: per
vedere le zone disegnate serve il centro operativo sul web.

### Le mie attività: le funzioni di supporto sul telefono

Chi fa parte di una funzione di supporto, durante un'emergenza, trova nella
schermata principale la voce "Le mie attività", con quanti incarichi sono
aperti per la sua funzione. Ogni incarico mostra la segnalazione, il perché
scritto da chi l'ha assegnato, l'indirizzo con il pulsante per il navigatore
e tre azioni: "Prendo in carico", "Nota", che scrive nel diario della
segnalazione con la sigla della funzione, e "Concludi", che chiede l'esito.
Nota ed esito si scrivono dentro la scheda dell'incarico. Gli incarichi
conclusi restano in fondo, con l'esito, fino alla chiusura dell'emergenza. Un
incarico nuovo arriva con una notifica che, toccata, apre direttamente questa
schermata. Serve la rete: un esito deve arrivare subito al COC, non quando
torna il campo.

### Gli esterni temporanei

Al COC si presenta spesso chi non è dell'associazione: la Croce Rossa con
un'ambulanza, un tecnico del Comune, un'altra associazione. Per farli
lavorare con ORION non serve un amministratore. Qualunque operatore interno,
anche un volontario, dal menu del centro operativo sceglie "Accesso esterno",
scrive il nome della persona e, se vuole, l'ente, la squadra (anche nuova) e
un indirizzo email.

ORION mostra un QR. La persona lo inquadra con il suo telefono ed è dentro,
senza password. Se la persona non è lì, il link si manda per email da ORION
oppure si copia con "Copia il link" (o "Condividi", dove il telefono o il
browser lo permettono) e si incolla dove si vuole. Su
Android la pagina che si apre propone l'app: con l'app la posizione della
squadra arriva alla sala anche a schermo spento, e il COC vede l'ambulanza
sulla mappa. Dall'app si entra anche con "Accedi con un codice",
inquadrando lo stesso QR.

L'esterno vede solo l'emergenza e gli interventi della sua squadra. Può
scrivere note e, sugli interventi assegnati alla sua squadra, caricare foto.
Il suo accesso finisce da solo alla chiusura dell'emergenza. Dalla stessa
finestra "Accesso esterno" si vede chi è entrato e, sotto ogni nome, ci sono
tre pulsanti. "QR e link" rimostra il QR e il link di quella persona, per
farglielo inquadrare di nuovo o per rimandarglielo per email; da lì si può
anche generare un codice nuovo, e il vecchio smette di valere. "Cambia
persona" serve quando l'ambulanza cambia equipaggio: si scrive chi subentra,
e chi c'era prima esce subito mentre il nuovo riceve un QR suo, nella stessa
squadra. "Revoca" chiude l'accesso subito. Chi esce resta nei registri con il
suo nome, perché le note e le foto lo citano. Gli accessi creati prima della
versione 1.0.3 non si possono rivedere: il QR e link propone direttamente un
codice nuovo.

Sul telefono, la pagina che propone l'app spiega in cinque passi come si
installa, perché non arriva dal Play Store e Android chiede due conferme in
più: si scarica (e se Chrome avvisa si tocca «Scarica comunque»), si apre
orion.apk dalla notifica del download, la prima volta si consente
l'installazione da quella fonte nelle impostazioni, si tocca «Installa» (e
«Installa comunque» se Play Protect non conosce l'app) e infine si torna
alla pagina e si tocca «Apri nell'app». Lo stesso spiega la proposta che
compare ai volontari dopo l'accesso dal telefono, con l'ultimo passo diverso:
si apre Orion Mobile e si scrive l'indirizzo del server.


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

Nell'elenco dei fascicoli ognuno ha il suo stato: "Operativo" con visita e
corso base validi, "Rinnovo visita" o "Corso base mancante" quando manca una
delle due cose, "Non operativo" quando mancano entrambe. Chi non ha ancora
niente di registrato risulta "Dati da inserire": è il caso di tutti il primo
giorno, finché non si riporta in ORION il raccoglitore di carta. Nel modulo di
una visita la scadenza si calcola da sola dalla data e dalla validità del tipo
di visita; se il catalogo ha un solo tipo di visita o un solo corso, è già
scelto.

Quando più volontari hanno fatto la stessa visita o lo stesso corso nello
stesso giorno (la visita collettiva dal medico, il corso base fatto insieme),
non serve aprire i fascicoli uno per uno: nell'elenco si spuntano le persone
(la casella in cima le spunta tutte, anche solo quelle trovate con la
ricerca), poi "Registra una visita" o "Registra un corso". Si sceglie cosa,
la data e, per la visita, l'esito; la scadenza si calcola da sola. Il
certificato di ciascuno, se c'è, si allega dopo dal suo fascicolo.

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

Se nel fascicolo c'è il codice fiscale, il tesserino lo porta sul fronte,
sotto il QR e i loghi, come codice a barre (Code 128, lo legge qualunque
lettore, anche quello di un registro presenze) con lo stesso codice scritto
in chiaro sotto. Per fargli posto QR e loghi si rimpiccioliscono un poco; il
QR resta leggibile da qualunque telefono. Le barre sono calcolate per una
stampante per tesserini a 300 punti per pollice: conviene stampare il PDF al
100%, senza adattarlo alla pagina. Senza codice fiscale il tesserino resta
com'era. Il codice a barre si spegne nelle impostazioni del tesserino, alla
voce "Codice fiscale sul tesserino": va considerato che chi trova un
tesserino perso legge anche il codice fiscale.

#### L'aspetto del tesserino

Da Impostazioni, nel riquadro del tesserino, "Personalizza l'aspetto" apre il
configuratore. Al centro c'è il tesserino con dati di esempio, i vostri loghi,
il distretto e il nome dell'ente; lo disegna lo stesso programma che stampa,
quindi quello che si vede è quello che esce. Sopra si sceglie che cosa
mostrare nell'anteprima (con o senza QR, codice fiscale, ente), per vedere
come viene ogni caso.

Gli elementi si prendono con il mouse e si trascinano; i quadratini agli
angoli dell'elemento scelto ne cambiano la misura, e con le frecce della
tastiera si sposta di mezzo millimetro (con Maiuscole di due). A destra si
scrivono le misure precise in millimetri, si cambia il testo della scritta
centrale e della qualifica (per esempio "OPERATORE" al posto di
"VOLONTARIO"), si decide se un elemento compare. I colori delle tre fasce,
dello sfondo e di ogni scritta si scelgono nel riquadro Colori; "Colori
predefiniti" li riporta come erano. L'elenco degli elementi serve a scegliere
anche quelli piccoli o tolti dal tesserino.

Finché non si sposta niente la disposizione è automatica: si adatta a ogni
volontario, e senza QR o senza codice fiscale lo spazio si ridistribuisce. I
colori e i testi si cambiano senza perderla. Appena si sposta o si
ridimensiona un elemento la disposizione diventa personalizzata e gli
elementi restano dove sono messi, anche quando su un tesserino il QR o il
codice a barre non ci sono; "Torna alla disposizione automatica" la
ripristina.

Il QR non scende sotto i 13,4 mm di lato e il codice a barre sotto i 58,7
mm di larghezza: sono le misure che servono per leggerli. Tutti e due stanno
sempre su un fondo bianco, qualunque colore abbia il resto. Sotto
l'anteprima compaiono gli avvisi quando due elementi si sovrappongono, quando
una scritta diventa troppo piccola per leggerla stampata o quando il suo
colore si distingue poco dallo sfondo.

Le modifiche restano nel configuratore finché non si preme "Salva"; da quel
momento la segreteria stampa i tesserini così. "Stampa di prova" scarica il
PDF di un tesserino di esempio, utile per provare la stampante prima di
salvare. "Annulla le modifiche" torna a quello salvato, "Torna al tesserino
predefinito" a quello proposto da ORION.


## 5. Il magazzino

Il magazzino è un'anagrafica dei beni (DPI, attrezzature, veicoli) e un
registro dei movimenti. Le giacenze non si scrivono a mano: si calcolano dal
registro. Il modulo si accende dalle impostazioni.

La pagina Magazzino ha quattro azioni a portata di mano: Consegna, Rientro,
Chi ha cosa, Scade e manca. Consegna e Rientro sono di chi ha il permesso di
consegnare e far rientrare materiale (il magazziniere, o chi l'ha avuto in
più); gli altri vedono Chi ha cosa e Scade e manca. Chi gestisce il magazzino
vede in più l'Inventario, i Verbali e registro e le Impostazioni del
magazzino.

Nell'Inventario e in Chi ha cosa, accanto alla ricerca, c'è il filtro per
categoria. Per i DPI a taglie scende fino al modello: si può chiedere "tutte le
calzature" oppure solo "Scarpe antinfortunistiche", e il foglio delle etichette
segue il filtro. All'installazione ORION propone i DPI più comuni; quelli che
l'associazione non usa si mettono da parte con "Non lo usiamo", nella scheda
del modello, e spariscono dagli elenchi senza perdere lo storico. La casella
"Mostra anche quelli non usati" li fa ricomparire, con il loro numero.

### Consegna e rientro dal web

Sul web consegna e rientro li può registrare qualunque operatore interno:
in emergenza non si aspetta il magazziniere per prendere una pala, e ogni
movimento porta comunque il nome di chi l'ha fatto. Si sceglie la persona
a cui va, poi cosa esce: il materiale si consegna sempre a una persona, che
lo ha in carico finché non lo restituisce. Un DPI a taglie occupa un
riquadro solo, con il nome una volta e le taglie disponibili come pulsanti,
ciascuno con accanto quanti pezzi restano; si tocca la taglia e sotto compare
il campo per dire quanti. La ricerca prende tutte le parole scritte, così
"giacca xl" porta dritti alla giacca in XL.

ORION ricorda le taglie di ciascuno e il quaderno delle taglie non serve più.
Scelta la persona, sotto il nome compaiono le taglie dei DPI che ha già
ricevuto ("Giacca alta visibilità L · Scarpe antinfortunistiche 43") e nel
riquadro di quei DPI la sua taglia è in verde, con la scritta "Sua taglia".
Se nel tempo ha ricevuto taglie diverse dello stesso DPI vale quella che ha
ancora in carico; se le ha in carico entrambe, o le ha restituite tutte, vale
l'ultima consegnata. Così chi rende una XL perché grande e tiene la L torna
alla L, e chi passa dalla L alla XL ha la XL. Per un DPI che non ha mai
ricevuto ORION propone la taglia che la persona ha in un altro DPI dello
stesso gruppo, bordata in verde tratteggiato e con la scritta "Taglia
probabile". I gruppi sono tre: busto (giacche, polo, gilet, giubbotti),
pantaloni, scarpe e stivali. Chi ha la giacca XL si vede proporre la polo e il
gilet XL, chi ha le scarpe 43 gli stivali 43; fra gruppi diversi non si deduce
niente, e le scarpe 44 non dicono nulla dei pantaloni. Il gruppo si sceglie
nella scheda del DPI a taglie, alla voce "Taglia come", sul web e nell'app; i
DPI proposti all'installazione ci sono già, quelli creati dall'associazione
partono senza gruppo finché il magazziniere non lo sceglie. Un DPI senza
gruppo, come i guanti o l'elmetto, propone solo la taglia che la persona ha
già ricevuto di quel DPI. È solo una proposta, e si può sempre scegliere
un'altra taglia. In Chi ha cosa ogni capo riporta la sua
taglia.
Di base non c'è carta: si sceglie e si registra. Il verbale si accende nelle
impostazioni del magazzino, separato per i DPI e per attrezzature e mezzi,
perché di solito servono in casi diversi: la giacca e gli scarponi dati a un
volontario restano suoi per anni, la motosega presa per un intervento torna
la sera. Acceso, consegnando a una persona compare la casella del verbale, già
spuntata, e ORION prepara il foglio da firmare; chi consegna può toglierla
per una consegna in cui non serve. La casella compare solo se fra quello che
si consegna c'è qualcosa per cui il verbale è acceso.

Se è accesa la conferma dei DPI, per i DPI il verbale c'è sempre, perché è
proprio quello che il volontario conferma dal telefono. Attrezzature e mezzi
invece non lo impongono mai: consegnati insieme a dei DPI restano fuori dal
verbale, a meno che il verbale per attrezzature e mezzi sia acceso e chi
consegna lasci la casella ("Mettere nel verbale anche attrezzature e mezzi").

Al rientro si sceglie da chi torna il materiale, si spunta cosa torna e
quanto. Se di un materiale sfuso ne torna meno di quanto era uscito, ORION
chiede cosa ne è del resto: resta in carico a chi l'aveva (i guanti che il
volontario tiene), è stato usato sul posto (i sacchi finiti nell'argine) o è
perso. Non c'è una risposta preimpostata, perché sarebbe sbagliata una volta
su due. Sui mezzi si possono scrivere i chilometri, se si vogliono tenere: non
sono obbligatori.

Di base il rientro finisce qui: si spunta e si registra. Chi vuole anche la
carta accende, nelle impostazioni del magazzino, il verbale di rientro, anche
qui separato per i DPI e per attrezzature e mezzi: da quel momento, quando
rientra da una persona materiale per cui è acceso, ORION propone il verbale
da far firmare a chi restituisce, e lo si può togliere per un rientro in cui
non serve. Nel verbale finisce solo quel materiale.

### Consegna e rientro dal telefono

Dall'app, consegna e rientro sono di chi tiene il magazzino (magazziniere e
amministratore). La consegna va in tre passi: a chi, cosa, conferma. Il
materiale va sempre a una persona; si sceglie fra DPI, attrezzature e mezzi,
per nome e taglia oppure inquadrando l'etichetta QR. Come sul web, ogni DPI è
una riga sola che si apre sulle sue taglie; scelta la persona, sotto il nome
compaiono le taglie che ha già ricevuto, e aprendo un DPI la taglia proposta
è in verde, segnata "sua taglia" o "probabile" con le stesse regole del web;
se il telefono non riesce a chiederle al server si consegna come sempre. La
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

La conferma compila il verbale da sola. Aperto dal magazzino o dal profilo,
il foglio riporta il nome di chi ha confermato, la data e l'ora, da dove (l'app
o il profilo web) e, nello spazio della firma di chi riceve, la firma
elettronica: il nome e l'impronta della conferma, un codice calcolato su
verbale, persona, ora e oggetti. Se qualcuno cambiasse dopo uno di questi
dati l'impronta non tornerebbe più, e la conferma con la sua impronta resta
anche nel registro delle operazioni, che è sigillato. Il foglio si stampa o
si salva in PDF così com'è, senza firme a mano. Una conferma partita dal
telefono senza rete porta l'ora in cui è arrivata al server.

### Etichette, scadenze e manutenzioni

Ogni bene nasce con un codice di sei caratteri e dall'inventario si stampano
le etichette QR, su un foglio libero da ritagliare o sui fogli adesivi A4 più
diffusi. Si può scegliere quante copie per bene, saltare le prime posizioni
di un foglio già usato e correggere di qualche millimetro se la stampante non
centra. Inquadrando il QR con un telefono qualsiasi si apre la scheda del
bene.

La scheda di un'attrezzatura o di un mezzo ha la sezione "Libretti e
documenti": il libretto d'uso e manutenzione, il libretto di circolazione, le
istruzioni, che stanno nell'archivio dei documenti del gruppo (capitolo 6).
Chi gestisce il magazzino o l'archivio li sistema da lì. "Carica il libretto"
prende il file dal computer e lo mette nell'archivio, nella cartella dei
libretti d'uso e manutenzione (creata la prima volta), già collegato al bene;
il titolo è "Libretto" con il nome del bene, e si cambia dall'archivio.
"Collega un documento dell'archivio…" sceglie da un elenco a discesa un
documento che c'è già, cartella per cartella. Se in magazzino ci sono altri
beni uguali, cioè dello stesso tipo e con la stessa denominazione (le dieci
radio, le tre idrovore), la casella "Anche agli altri beni uguali" collega
il documento a tutti insieme. Il simbolo accanto a un documento lo scollega
da quel bene, e il documento resta nell'archivio. Chi inquadra l'etichetta
senza tenere l'inventario trova i libretti sotto la risposta "cos'è e chi ce
l'ha": il libretto della motosega è a un tocco dalla motosega.

Nell'app i libretti si aprono dalla scheda del bene, per chi tiene il
magazzino, e da "Io" toccando quello che si ha in carico: chi ha la
motosega in mano apre il suo libretto. I libretti di quello che una persona
ha in carico, lei o la sua squadra, l'app li tiene sul telefono da sola, come
i documenti sempre con me: si aprono anche senza rete, e nell'elenco dei
documenti lo dice la riga "resta sul telefono finché lo hai". Quando il bene
rientra in magazzino o passa a un altro, al primo aggiornamento con la rete
la copia sparisce. Il libretto arriva sul telefono appena la consegna è
fatta, se c'è campo, o alla prima apertura dell'app con la rete.

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


## 6. I documenti del gruppo

L'archivio dei documenti tiene in un posto solo quello che il gruppo deve
avere sotto mano: il piano comunale di protezione civile, le procedure
operative, i libretti d'uso e manutenzione delle attrezzature e dei mezzi, i
moduli da compilare, i verbali delle riunioni. Si apre da "Documenti" nel
menu laterale, da "Documenti del gruppo" nel menu del centro operativo e
dalla schermata principale dell'app.

Lo consultano tutti gli interni. I documenti stanno divisi in cartelle; la
casella in alto cerca nel titolo, nella descrizione e nel nome del file.
Toccando il titolo il documento si apre: i PDF e le immagini nel browser, gli
altri (Word, Excel, OpenDocument) si scaricano. Ogni documento dice il
formato, quanto pesa e quando è stato aggiornato; con "Dettagli" si vedono le
versioni precedenti, che restano consultabili, e le attrezzature a cui è
collegato.

Chi tiene l'archivio ha il permesso "Gestire l'archivio dei documenti", che
l'amministratore dà a chi serve senza dover dare un ruolo intero. Carica un
documento con "Carica un documento": titolo, cartella, descrizione e file.
Il file può essere un PDF, un'immagine, un documento d'ufficio o un testo,
fino a 25 MB: finisce in ogni backup, quindi un piano scansionato a
risoluzione altissima conviene ridurlo prima. Quando esce una revisione, da
"Gestisci" si carica una versione nuova con due parole su cosa cambia: diventa
quella che si apre, e le vecchie restano nello storico. "Modifica" cambia
titolo, cartella e il resto senza toccare il file; "Togli dall'archivio" lo
toglie con tutte le versioni, e i file si recuperano solo da un backup. Le
cartelle si creano, si rinominano con la matita e si tolgono quando sono
vuote. In alto si legge quanto pesa l'archivio intero.

Per ogni documento si decidono tre cose. Chi lo vede: tutti gli interni, o
solo alcuni ruoli (il verbale del direttivo ai coordinatori, per esempio);
chi tiene l'archivio e l'amministratore li vedono tutti. Se è consultabile in
emergenza: mentre un'emergenza è aperta lo vedono anche gli esterni,
dal web e dall'app, ed è il caso del piano comunale e della rubrica degli
enti; chiusa l'emergenza, per loro sparisce. Se è "sempre con me": l'app ne
tiene una copia sul telefono di ciascuno e lo apre anche senza rete, in
fondo a una valle o in un seminterrato.

Nella scheda di un documento chi tiene l'archivio, o chi gestisce il
magazzino, lo collega a un'attrezzatura o a un mezzo cercandolo per nome,
matricola o targa: il libretto si apre poi dalla scheda del bene e dal QR
della sua etichetta.

Nell'app la voce Documenti mostra le stesse cartelle del web, e ogni
documento compare una volta sola, nella sua cartella; il simbolo verde
accanto a un documento dice che è sul telefono. Le copie si aggiornano da
sole quando l'app si apre con la rete: se nel frattempo è uscita una
versione nuova, la scarica e butta la vecchia. Senza rete
gli altri non si aprono, e l'app lo dice; se di un documento sempre con me
c'è solo la versione precedente, si apre quella, avvisando che non è
l'ultima. Uscendo dall'app copie ed elenco si cancellano.

## 7. Attività, calendario e presenze

Fuori dall'emergenza il gruppo vive di esercitazioni, addestramenti, servizi,
riunioni e giornate di manutenzione. Il calendario le tiene tutte in un
posto, insieme alle emergenze, alle scadenze e ai turni di reperibilità, e
le presenze di ognuno, in attività come in emergenza, finiscono nel suo
libretto. Addestramenti ed esercitazioni possono avere una simulazione, con
la sala aperta e un copione, descritta nella seconda metà del capitolo. Il modulo è acceso
di partenza e si spegne dalle impostazioni (capitolo 8): spento, il
calendario sparisce dal menu e dall'app, e quello che c'era resta dov'è. Le
presenze in emergenza si registrano comunque, e ognuno continua a vederle
nel suo profilo.

### Il calendario

Si apre da "Calendario" nel menu laterale, dal menu del centro operativo e
dalla schermata principale dell'app. Sul computer è una griglia del mese,
sul telefono un'agenda giorno per giorno; le frecce cambiano mese. In alto
i filtri accendono e spengono quello che si vede: le attività, le
emergenze, e le scadenze per chi le può vedere. Ognuno vede le proprie
visite e i propri corsi in scadenza; chi gestisce visite e corsi vede quelle
di tutti i volontari, chi gestisce il magazzino le revisioni, le
manutenzioni e le altre scadenze dei beni. Le scadenze non riempiono il
calendario: in un giorno compare una sola voce con il loro numero, e
toccandola si apre l'elenco. Il browser ricorda i filtri scelti.

Le attività le vede chi le organizza, cioè chi ha il permesso "Organizzare
attività e presenze" (il Coordinatore lo ha nel pacchetto), il responsabile
indicato nell'attività e chi è convocato. Un'attività per tutti, o aperta,
la vedono tutti gli interni. Gli esterni il calendario non lo vedono.

### Organizzare un'attività

Con "Nuova attività" si scelgono il tipo (Esercitazione, Addestramento,
Servizio, Riunione, Manutenzione), il titolo, l'inizio e la fine, il luogo,
una descrizione e un responsabile. Di partenza l'attività è domani sera, dalle
20:30 alle 22:30; spostando l'inizio la fine si sposta con lui e la durata
resta quella. Il responsabile, anche senza il
permesso, gestisce quella sola attività: la cambia, chiude le presenze, la
annulla. Un addestramento può valere come corso del catalogo della
segreteria: alla chiusura il corso si scrive nel libretto dei presenti, con
la scadenza che il catalogo prevede.

La convocazione ha tre modi. "Tutti gli interni" convoca ognuno. "Solo
alcuni" convoca le persone scelte dall'elenco, e l'attività la vedono solo
loro. "Aperta" la mostra a tutti senza convocare nessuno: aderisce chi vuole,
fino ai posti indicati, e quando i posti sono finiti il sì non si può più
dare (il no sì). Due caselle dicono come arriva la convocazione: l'avviso
nell'app, l'email, tutte e due o nessuna, quando basta dirlo in riunione.

Le assemblee del gruppo sono riunioni come le altre. Si crea un'attività di
tipo Riunione (o di un tipo "Assemblea", se si preferisce vederle a parte:
si aggiunge dalla gestione dei tipi), con l'ordine del giorno nella
descrizione e la convocazione a tutti gli interni, con l'avviso nell'app e
l'email. Ognuno risponde se viene, e alla fine si segnano le presenze come
per qualunque attività. Il verbale, scritto come si è sempre fatto, si
carica nell'archivio dei documenti, in una cartella "Verbali": lì lo
ritrova chiunque abbia il permesso di leggerlo.

Chi conduce l'attività, cioè chi l'ha proposta, il responsabile e, per una
simulazione, la regia, non riceve la convocazione e non deve rispondere: nella
scheda c'è scritto, e alla chiusura è già spuntato fra i presenti. Gli altri
convocati rispondono dal calendario o dall'app con "Ci sono" o "Non
posso", con una nota facoltativa per chi organizza, e può cambiare idea
finché l'attività non è chiusa. Una fascia in cima al calendario ricorda le
convocazioni ancora senza risposta. Chi organizza vede nella scheda
dell'attività le risposte e i conteggi, e accanto a chi non ha risposto e
non è raggiungibile né dall'app né per email la scritta "Da chiamare": a
queste persone la convocazione non è arrivata, e va fatta a voce.

Un'attività programmata si cambia con "Modifica". Se è cambiato qualcosa che
conta, la casella "Avvisa del cambio" manda l'avviso a chi non ha già detto
di no; chi viene aggiunto fra i convocati riceve la convocazione. "Annulla
l'attività" la lascia nel calendario barrata, con il motivo, e avvisa i
convocati. "Elimina" la toglie del tutto, ma solo finché non ha presenze:
un'attività che si è svolta resta.

### Le presenze di un'attività

Finita l'attività, "Chiudi con i presenti" apre l'elenco delle persone: chi
aveva detto di sì è già spuntato, gli orari sono quelli dell'attività e si
correggono per chi è arrivato dopo o andato via prima. Si aggiunge anche chi
è venuto senza rispondere. Con "Salva le presenze" l'attività diventa
conclusa e le ore finiscono nelle presenze di ognuno. La chiusura si può
ripetere per correggere: chi viene tolto esce dalle presenze, e il corso che
l'attività gli aveva scritto nel libretto si toglie.

### Le presenze in emergenza

In emergenza nessuno deve ricordarsi di segnare le presenze. Ogni ingresso e
ogni uscita da una squadra è già nel registro delle squadre, e alla chiusura
dell'emergenza ORION ne ricava per ogni interno il periodo in cui è stato in
servizio: chi è passato da una squadra all'altra conta una volta sola, chi
era in una squadra già pronta all'apertura conta dall'apertura. Contano
anche i membri della squadra COC, la sala. Gli esterni temporanei non hanno
presenze: non sono volontari del gruppo.

Le presenze di un'emergenza chiusa le corregge chi ha il permesso delle
attività, dalla scheda dell'emergenza nel calendario: cambia gli orari,
toglie chi non c'era davvero, aggiunge chi ha dato una mano senza entrare in
nessuna squadra. Ogni correzione resta nel registro delle operazioni, con chi
l'ha fatta.

### Il libretto delle presenze e gli attestati

Ognuno vede le proprie presenze dell'anno nella pagina Profilo, nel
riquadro "Le mie presenze", e nell'app dal calendario: le attività e le emergenze, con
le ore di ognuna e il totale. Per ogni presenza c'è l'attestato in PDF, con i
dati del volontario, l'attività o l'emergenza e gli orari, da consegnare al
datore di lavoro. La segreteria trova le stesse presenze nella scheda del
volontario.

Chi organizza, e chi gestisce l'anagrafica, apre con "Presenze" il
riepilogo dell'anno: per ogni persona il numero di emergenze e di attività e
le ore, con il totale. Il riepilogo si scarica in CSV per il foglio di
calcolo, e cliccando una persona si vedono le sue presenze con gli
attestati.

### Il calendario sul telefono

Nell'app la voce Calendario della schermata principale mostra quante
convocazioni aspettano risposta. L'agenda è la stessa del web, con gli
stessi filtri; toccando un'attività si leggono i dettagli e si risponde.
L'avviso di una convocazione apre direttamente la sua scheda. Il simbolo
dell'orologio in alto apre "Le mie presenze", con le presenze dell'anno e gli
attestati da scaricare. Organizzare
e chiudere le attività si fa dal web.

### Reperibilità e assenze

Chi organizza mette le persone di turno con "Reperibilità", in alto nel
calendario. Sceglie le persone, il primo e l'ultimo giorno ed
eventualmente una nota. Nel calendario ogni giorno mostra quanti sono
reperibili, e nella scheda del giorno si leggono i nomi. In emergenza la sala
chiama con un clic solo loro. Un turno sbagliato si toglie dalla stessa
scheda, per una persona o per tutto il turno.

Ognuno segna i giorni in cui non c'è con "Segna un'assenza", sul web dal
calendario e nell'app dal calendario (il simbolo del calendario barrato in
alto) o dalla schermata della chiamata. Sul telefono non c'è un calendario
da sfogliare: le frecce spostano il primo giorno, il più e il meno dicono per
quanti giorni. Il motivo è facoltativo e lo vede solo chi organizza. Nei
giorni di assenza le chiamate per tutti, per i reperibili e per corso non
arrivano, mentre una chiamata a nome sì: se la sala sceglie proprio quella
persona, sa quello che fa. Chi organizza vede nel calendario quanti sono assenti in un
giorno.

### Addestramenti ed esercitazioni con la simulazione

Ogni tipo di attività ha una natura: generica, addestramento o
esercitazione. La natura si sceglie nella gestione dei tipi (il pulsante
accanto al tipo nella nuova attività). Riunione, Servizio e Manutenzione sono
generiche, Addestramento ed Esercitazione hanno la loro. La differenza
conta perché un'esercitazione di protezione civile, per essere tale, va
presentata alla Regione mesi prima e coinvolge di solito altri enti, mentre
un addestramento il gruppo lo organizza da sé. ORION dà a tutti e due gli
stessi strumenti. Nei documenti un addestramento resta un addestramento: le
presenze, gli attestati e il libretto lo chiamano così, anche se si è svolto
con la sala aperta come in un'esercitazione.

In un addestramento o in un'esercitazione il riquadro "Simulazione" offre
due possibilità. Con "Allertamento" si prova solo la chiamata dei
volontari, senza aprire la sala. Nella scheda dell'attività c'è il pulsante
"Chiamata per l'allertamento", che apre lo stesso pannello della sala, e
chi arriva in sede conta come presente all'attività. Con "Scenario in sala"
il giorno stesso si apre il centro operativo come in un'emergenza, con la
scritta SIMULAZIONE, e la regia fa uscire gli eventi del copione. Lo
scenario (cosa succede, in due righe, per i partecipanti), gli obiettivi e,
per un'esercitazione, gli enti coinvolti si scrivono qui.

La regia è chi muove lo scenario: il responsabile dell'attività, le persone
scelte nel campo "La regia" e chi ha il permesso di organizzare le attività.
Le persone si aggiungono una alla volta dall'elenco a discesa "Aggiungi una
persona alla regia…" e compaiono sotto come etichette; la x accanto al nome le
toglie. I registi vedono il copione, aprono la sala,
fanno uscire gli eventi, annotano e scrivono il debriefing. I partecipanti il
copione non lo vedono: in sala devono trovarsi davanti le cose come
arriverebbero davvero.

### Il copione

Il copione è la sequenza degli eventi della simulazione. Si apre dal
pulsante "Copione" nella scheda dell'attività, ed è fatto come il centro
operativo: la mappa occupa la pagina e gli eventi stanno in un elenco a
lato, in ordine di uscita. Chi conosce la sala ci si ritrova. La mappa ha gli
stessi livelli del centro operativo: le zone di pericolosità e le aree del
piano, le strade chiuse e le zone in vigore in quel momento, la mappa stradale
o il satellite. Si guardano e basta: il copione si scrive sopra la situazione
vera.

"Nuovo evento" chiede prima di tutto che cosa succede. Una segnalazione è
una richiesta di intervento, come quelle vere. Un aggravamento è una
segnalazione già uscita che peggiora (l'acqua sale, arriva un ferito). Una
comunicazione è un messaggio alla sala, per esempio dalla Prefettura. Un
imprevisto arriva sul telefono dei membri di una squadra (il mezzo in panne,
un volontario che si fa male). Una strada chiusa o una zona interdetta
compare sulla mappa della sala. Una zona di pericolo (alluvione, frana o
altro, per esempio un incendio o una fuga di gas) compare sulla mappa come
quelle del piano, e le segnalazioni che ci cadono dentro prendono il rischio. Poi si scrivono il titolo e il testo,
quello che si legge alla sala, e si dice quando esce: a un certo minuto
dall'avvio dello scenario oppure "Lo faccio uscire io, quando serve".

Una segnalazione può entrare da sola nel centro operativo, già sulla mappa,
oppure essere telefonata dalla regia, e allora la sala la deve inserire da
sé, come farebbe con una chiamata vera. Il posto si cerca scrivendo
l'indirizzo e toccando "Trova", oppure con "Metti sulla mappa" e un tocco nel
punto giusto. La strada chiusa si disegna come nel centro operativo,
toccando l'inizio e la fine del tratto: la linea segue la strada da sola
("A mano" la disegna punto per punto, quando il percorso sbaglia). Le zone si
disegnano toccandone i vertici. Il nome radio della squadra dell'imprevisto è
quello che avrà quel giorno. In fondo, la parte "Per la valutazione (solo la
regia)" dice cosa ci si aspetta dalla sala e entro quanti minuti: servirà
dopo, per misurare i tempi.

Il copione si cambia fino all'ultimo, anche a sala aperta. "Copia da
un'altra" prende il copione di un'attività passata, per rifare lo stesso
scenario o partire da lì.

### Il copione da Excel

Chi preferisce il foglio di calcolo usa "Excel". "Scarica il modello" dà un
foglio con le colonne giuste, le tendine per i campi a scelta, qualche riga
d'esempio e un secondo foglio di istruzioni. Si compila una riga per evento;
le righe che cominciano con ESEMPIO non contano. Il minuto si scrive come
numero (90) o come ore e minuti (1:30), e un aggravamento indica la riga
della segnalazione a cui si riferisce. "Carica il foglio compilato" lo
controlla tutto prima di caricare: se una riga ha un errore non si carica
niente, e ORION dice quale riga e cosa non va. Gli eventi si aggiungono a
quelli che ci sono, oppure li sostituiscono se si spunta la casella. Le
segnalazioni con l'indirizzo ma senza il punto si mettono poi sulla mappa una
per una, e le strade chiuse si disegnano dalla pagina. "Scarica il copione
attuale in Excel" serve per correggerlo con calma o tenerlo per l'anno dopo.

### Il giorno della simulazione: la regia

La sala si apre dalla scheda dell'attività con "Apri la sala", a partire
da tre ore prima dell'inizio. Il centro operativo si apre come per
un'emergenza, con il codice SIM seguito dalla data, e una fascia viola con
la scritta SIMULAZIONE resta in cima a ogni pagina, nel punto di situazione,
nelle stampe e nell'app. Anche gli avvisi sui telefoni cominciano con
[SIMULAZIONE]. Nessuno la scambia per un'emergenza vera. Le squadre già
formate entrano, la chiamata dei volontari funziona come sempre, e da lì in
avanti la sala lavora come farebbe davvero.

I registi trovano nel centro operativo il pulsante "Regia", che apre un
pannello a lato. In cima c'è l'orologio dello scenario: non parte da solo, si
avvia con "Avvia lo scenario" quando la sala è pronta, e "Pausa" ferma gli
eventi a tempo, per esempio durante un briefing. Sotto c'è il prossimo evento
con il conto alla rovescia, poi tutti quelli da uscire; di una comunicazione
si legge già il testo. Ognuno si fa uscire subito con "Fai uscire ora", si
sposta di cinque minuti con "+5'" o si salta. Gli eventi a tempo escono da
soli quando il conto alla rovescia arriva a zero. Quando esce una
segnalazione da telefonare, il pannello la mette in evidenza fra quelle "Da
telefonare alla sala", con il testo da leggere e il numero del finto
segnalante. Quando la sala l'ha inserita, "Collega alla segnalazione
inserita" la lega a quella vera, e da lì si misurano i tempi. Se serve
qualcosa che non era nel copione, "+ Invento un evento adesso" lo fa uscire
al momento; una segnalazione inventata prende anche il posto, scrivendo
l'indirizzo e toccando "Trova" oppure con "Sulla mappa" e un tocco sulla
mappa della sala. Quello che si sta scrivendo nel pannello non si perde
quando il pannello si aggiorna.

Le comunicazioni alla sala non restano solo nel diario: quando escono
compaiono in primo piano, in cima al centro operativo di tutti quelli in
sala, con il titolo, il testo e l'ora, e restano lì finché qualcuno davanti a
quello schermo non tocca "Letta". Chi apre il centro operativo dopo le trova
lo stesso.

Le osservazioni sono gli appunti della regia, con l'ora: "la sala non ha
richiamato il segnalante", "la squadra Alfa parte senza radio". Si scrivono
dal pannello oppure, per chi gira fra le squadre, dal telefono: nella
schermata principale dell'app i registi trovano "Regia: osservazioni" finché
la simulazione è aperta.

La simulazione si chiude dal centro operativo con "Chiudi la simulazione".
Chi ci era, in sala, in squadra o in sede, riceve le presenze nell'attività,
come addestramento o esercitazione, e non fra le emergenze. Le strade chiuse
e le zone disegnate per gioco spariscono dalla mappa.

### La simulazione al volo

Non sempre c'è il tempo di pianificare: per provare la sala in una serata
qualsiasi, senza passare dal calendario, il centro operativo ha il pulsante
"Simulazione", accanto ad "Apri emergenza", quando non c'è nessuna emergenza
aperta. Lo trova chi apre le emergenze o organizza le attività. La finestra
chiede poco: se è un addestramento o un'esercitazione, un titolo (vuoto
diventa "Addestramento del" e la data), quanto dura più o meno, se partire
dal copione di una simulazione già fatta, e due righe di scenario. "Apri la
simulazione" apre subito la sala, con la scritta SIMULAZIONE come sempre, e
la conduce chi l'ha aperta: la regia è nel pulsante viola, lo scenario si
avvia da lì, e gli eventi che non sono nel copione si inventano sul momento.
Nessuno viene convocato: chi serve si chiama con "Volontari", come in
un'emergenza. Dietro, ORION crea da sé l'attività nel calendario, che
comincia in quel momento: lì finiscono le presenze, e dopo la chiusura ci
sono la valutazione, il debriefing e l'archivio, come per una simulazione
pianificata.

### Se arriva un'emergenza vera

Durante una simulazione il pulsante per aprire un'emergenza diventa
"Emergenza reale", e chi apre le emergenze la apre da lì. ORION avverte che
la simulazione si fermerà e chiede conferma. Con la conferma la simulazione
si chiude, segnata come interrotta, e l'emergenza vera si apre subito. Le
squadre restano formate e la sala resta con chi c'era: la gente è già lì e
non deve rifare niente. Le presenze fino a quel momento vanno
all'attività, quelle da lì in poi all'emergenza.

### Dopo: valutazione e debriefing

A sala chiusa, nella pagina del copione, la scheda "Valutazione" mette
insieme per ogni segnalazione quando è uscita e dopo quanti minuti la sala
ha mandato una squadra, ha avuto la prima notizia dal campo e l'ha chiusa,
accanto alla risposta e al tempo attesi. Un'etichetta dice se la squadra è
partita in tempo, in ritardo o non è partita affatto. Una segnalazione
telefonata che la regia non ha collegato non ha tempi: lo dice. Seguono le osservazioni della regia in ordine
di ora. Il debriefing ha quattro campi: obiettivi raggiunti, cosa è andato
bene, cosa non ha funzionato, cosa migliorare. Lo scrivono tutti i registi,
ognuno quando può, e quando è finito "Concludi il debriefing" lo chiude:
dopo non si cambia più.

Copione e debriefing restano della regia. La casella "Copione e debriefing
visibili a chi ha partecipato" li apre ai partecipanti, che li trovano nella
scheda dell'attività: lo decide la regia, quando ha senso.

### Le simulazioni nell'archivio

L'archivio delle emergenze ha in alto tre pulsanti: "Emergenze", che è la
scelta di partenza, "Simulazioni" e "Tutte". Una simulazione porta il suo
segno e il nome dell'attività; quella interrotta dice da quale emergenza.
Il resoconto e la stampa completa sono gli stessi di un'emergenza, con la
scritta SIMULAZIONE su ogni pagina, e il pulsante "Copione" porta alla
valutazione.

## 8. L'amministratore

Al primo avvio conviene fare, in quest'ordine: in Impostazioni il nome
dell'associazione, il logo e il centro della mappa (con "Mappa" si cerca il
comune per nome e si clicca il punto), i moduli che servono; in Gestione
utenti l'importazione dei volontari dal foglio Excel e la stampa dei fogli di
attivazione; poi i ruoli di chi tiene segreteria e magazzino.

L'amministratore può tutto. Crea gli utenti, assegna i ruoli spuntando le
caselle (una persona può essere volontaria, segretaria e magazziniera
insieme), sospende chi non deve più entrare. I cambi di ruolo valgono subito,
anche per chi è collegato in quel momento. Un amministratore non può togliersi
l'amministrazione da solo.

### Ruoli e permessi

Ogni cosa che in ORION non fa qualunque volontario è legata a un permesso, e
i ruoli sono pacchetti di permessi già pronti. I permessi sono dieci, in
quattro gruppi. Per le emergenze: aprire e chiudere le emergenze, consultare le
emergenze passate (l'archivio con i resoconti), gestire il piano di emergenza
sulla mappa (le zone di pericolo e gli altri elementi permanenti),
organizzare le funzioni di supporto. Per i volontari: gestire anagrafica e
tesserini (e iscrivere i volontari nuovi), gestire visite mediche e corsi.
Per il magazzino: gestire il magazzino (l'inventario e le sue impostazioni),
consegnare e far rientrare materiale. Per il gruppo: gestire l'archivio dei
documenti, organizzare attività e presenze (il calendario, le convocazioni,
la chiusura delle attività, le correzioni delle presenze in emergenza e il
riepilogo dell'anno).

Il Coordinatore ha i quattro permessi delle emergenze e quello delle
attività; la Segreteria i due dei volontari; il Magazziniere i due del
magazzino; l'Amministratore tutti, e in più l'amministrazione del sistema
(account, ruoli e permessi, impostazioni, condizioni d'uso, registro, backup
e aggiornamenti), che non si delega. Il Volontario ha la base comune: il
centro operativo in emergenza, la rubrica, il punto di situazione, la
consultazione dei documenti del gruppo, il calendario con le sue
convocazioni e le sue presenze, i propri dati. Il permesso dei documenti non
sta in nessun pacchetto tranne quello dell'amministratore: si dà a chi tiene
l'archivio. L'Esterno solo l'emergenza in corso.

Quando a una persona serve un compito senza tutto il pacchetto, l'amministratore
le dà il solo permesso: in Gestione utenti, "Modifica", sezione "Permessi in
più". I permessi già compresi nei ruoli spuntati sono segnati e bloccati; gli
altri si spuntano. Si aggiungono soltanto, non tolgono niente ai ruoli, e
valgono subito anche per chi è collegato. Agli esterni non se ne danno. Ogni
concessione e ogni revoca finisce nel registro, con chi l'ha fatta. Nella
tabella, accanto ai ruoli, un "+1" o "+2" dice che la persona ha permessi in
più.

Chi gestisce anagrafica e tesserini senza essere amministratore vede la
pagina dei volontari e iscrive i nuovi, solo come volontari: ruoli e permessi
li assegna l'amministratore. In Segreteria apre il fascicolo con anagrafica,
foto, tesserino e DPI, senza visite e corsi. Chi ha un permesso lo vede, con i
suoi ruoli, nel proprio profilo dell'app.

In Gestione utenti la tabella ha due schede. Gli interni sono i volontari e
chi ha un ruolo nell'associazione. Gli esterni sono le persone di altri enti:
quelli permanenti hanno nome utente e password come tutti, quelli temporanei
sono nati dal centro operativo con il QR e riportano l'emergenza a cui
appartengono. I temporanei non si modificano, non si sospendono e non
ricevono una password da qui: si gestiscono dalla finestra "Accesso esterno"
e finiscono da soli con l'emergenza, mentre in Gestione utenti si possono solo
eliminare. Per ognuno la tabella dice quando è stato creato e quando ha usato
ORION l'ultima volta, sul web o con l'app ("Oggi, 14:32", "3 giorni fa",
"Mai"). Le colonne con le frecce si ordinano con un clic: ordinando per ultimo
accesso si trova subito chi non entra da mesi. La casella di ricerca filtra
per nome, nome utente, email ed ente. Per gli utenti che c'erano prima della
versione 1.0.3 la data di creazione è ricostruita dal registro e può mancare.

Sospendere e eliminare non sono la stessa cosa. Sospendere toglie l'accesso e
lascia tutto com'è: serve per chi si ferma per un periodo, e "Riattiva" lo fa
tornare. Eliminare cancella i dati personali della persona: anagrafica,
contatti, codice fiscale, foto, visite e corsi con i loro certificati, ruoli,
accessi dai telefoni. Se la persona non compare nello storico sparisce del
tutto. Se ha creato segnalazioni o loro aggiornamenti, o caricato documenti
di un'emergenza, di lei restano solo nome, cognome e nome utente legati a
quelle operazioni, perché lo storico deve restare integro e dire chi ha fatto
che cosa; non compare più negli elenchi, non entra e non si riattiva. Nel
registro delle operazioni, nel diario di sala, nei verbali di consegna e nei
movimenti del magazzino il nome resta scritto com'era. Il materiale che ha in
carico va sistemato prima, come sempre. Le copie di sicurezza contengono i
dati finché non vengono sovrascritte.
Lo scudo verde accanto al nome utente dice chi ha la verifica in due
passaggi; il pulsante con il telefonino la azzera a chi ha perso il telefono
(la propria si cambia dal profilo).

Per inserire molti volontari in una volta c'è l'importazione da un foglio
Excel (.xlsx) o CSV, anche quello salvato dall'Excel italiano con il punto e
virgola. Nella prima riga servono le colonne Nome e Cognome; se ci sono si
leggono anche Email, Telefono (o Cellulare) e Codice fiscale. Ognuno entra
come volontario, con il suo link di attivazione valido sette giorni: chi ha
l'email lo riceve per posta. Per gli altri c'è "Stampa i fogli di
attivazione": un foglio per persona, due per pagina, con il QR da inquadrare
e tre righe di istruzioni, da consegnare alla prima riunione. Si può anche
copiare il link e mandarlo a mano. Lo stesso foglio si stampa dalla finestra
che compare quando si crea un volontario a mano o gli si azzera la password. Chi è già in ORION, con lo stesso codice fiscale, la stessa
email o lo stesso nome e cognome, non viene creato di nuovo, quindi lo stesso
foglio si può ricaricare dopo averlo corretto. Alla fine ORION elenca le
righe che ha lasciato fuori, con il numero di riga e il motivo.

La pagina Funzioni prepara le funzioni di supporto. Nel menu
dell'amministratore compare solo con il modulo acceso; prima di accenderlo ci
si arriva dal collegamento accanto all'interruttore, nelle impostazioni. Parte con le
funzioni classiche del piano comunale, dall'unità di coordinamento alla F9:
si accendono solo quelle del vostro piano, si rinominano con le stesse sigle,
se ne aggiungono altre. Sotto ogni funzione si aggiungono i membri,
scrivendo nome, cognome o nome utente (anche esterni), e la stella segna il
referente.

Le zone di pericolosità e le aree d'emergenza del piano comunale si caricano
una volta e restano fra un'emergenza e l'altra. In Impostazioni, "Livelli del
piano sulla mappa" importa un file esportato da QGIS: tasto destro sul livello,
Esporta, Salva elementi come, formato GeoJSON (o KML) e sistema di riferimento
EPSG:4326 - WGS 84. ORION legge il file, dice quante forme ha trovato, chiede
che cosa rappresentano e quale campo del file contiene il nome e quale il
livello di pericolosità. Conviene un file per tipo. Un livello aggiornato si
reimporta dopo aver tolto quello vecchio, con "Togli" nell'elenco. Gli
elementi del piano l'amministratore li può anche disegnare dalla mappa,
spuntando "Del piano".

Nelle impostazioni si accendono i moduli (Segreteria, Magazzino, Funzioni di
supporto, Attività e calendario), si
configura la posta, si carica il logo dell'associazione, si decide se l'app
Android è a disposizione del personale, si impostano il tempo dopo cui una
segnalazione senza squadra diventa rossa e le regole del tesserino.

### Le condizioni d'uso

ORION propone un testo già scritto, che usa il nome dell'associazione. Nelle
Impostazioni, il riquadro "Condizioni d'uso" dice qual è la versione in vigore,
quante persone con un account attivo l'hanno accettata e, aprendo l'elenco,
chi manca. "Riscrivere il testo" lo apre in un campo: "Parti dal testo
proposto" lo copia per modificarlo, e il campo lasciato vuoto torna al testo
proposto. Il formato è semplice: una riga che inizia con "# " è il titolo, con
"## " un capitolo, una riga vuota separa i paragrafi.

"Pubblica" crea una versione nuova: tutti la accettano di nuovo al prossimo
accesso, tranne chi pubblica, che l'ha appena scritta. Ogni accettazione resta
registrata con la data, il canale (web o app) e l'impronta del testo
mostrato, così si può dimostrare che cosa ha accettato ciascuno anche dopo che
il testo è cambiato.

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

### La cartografia del territorio

In Impostazioni, nel riquadro dei livelli del piano, si carica la
cartografia del territorio per lavorare quando internet manca: un file
MBTiles a tasselli raster (immagini PNG, JPG o WEBP), che il server poi dà
a tutte le mappe di ORION come fondo "Territorio (dal server)". Si prepara
una volta con QGIS, con lo strumento "Genera tasselli raster XYZ
(MBTiles)", sull'estensione del comune e con gli zoom da 10 a 17 (fino a 18
per i centri abitati); come base vanno bene la carta tecnica regionale,
un'ortofoto o un'altra cartografia che l'associazione può usare. Non si
scaricano in blocco i tasselli di OpenStreetMap: le regole dei loro server
lo vietano.

Il file può essere grande: parte a pezzi, con una barra che dice a che
punto è, e un pezzo che non passa si rimanda da solo. Alla fine il server
lo controlla e dice cosa ha trovato (quanti tasselli, che zoom, che zona);
un file che non va (non è un MBTiles, o ha tasselli vettoriali) è rifiutato
con il motivo, e quello di prima resta. Caricarne uno nuovo sostituisce il
vecchio; "Togli la cartografia" la toglie.

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

### La cifratura e la chiave di recupero

Certificati medici, documenti delle emergenze, foto delle segnalazioni e dei
profili, verbali firmati, resoconti e backup del database sono cifrati con una
chiave che ORION crea da sé al primo avvio e tiene sul server, fuori dal
database e fuori dai backup. Anche la password della posta è cifrata, e il
pannello delle impostazioni non la mostra più: lasciando il campo vuoto resta
quella salvata. Per chi usa ORION non cambia niente: i file si aprono come
prima. Cambia per chi si portasse via un backup o una copia del disco, che
senza la chiave non legge niente.

Proprio per questo la chiave non deve andare persa. Nel riquadro "Cifratura"
della pagina Sistema l'amministratore, con la sua password, vede la chiave di
recupero: 52 caratteri a gruppi di quattro. Va stampata o ricopiata e messa in
un posto sicuro fuori dal server, una cassaforte e non una email; poi si tocca
"L'ho conservata". Finché non lo si fa, il riquadro lo ricorda.

Se il server si rompe e si reinstalla ORION altrove, o se la chiave sul server
va persa, il riquadro dice in rosso che file e backup cifrati non si leggono.
Con "Inserisci una chiave di recupero" e la propria password si rimette la
chiave conservata, e tutto torna leggibile; dopo si può ripristinare il backup
come sempre. Senza la chiave di recupero, i dati cifrati non si recuperano in
nessun modo.

### Lo storico che non si cambia

Le note delle segnalazioni, il diario di sala, il registro delle operazioni,
i movimenti del magazzino e il registro delle squadre non si modificano e non
si cancellano, nemmeno dall'amministratore: un errore si corregge scrivendo
una nuova nota, come su un registro di carta. Ogni voce ha un'impronta legata
a quella prima, come gli anelli di una catena, e il riquadro "Integrità dello
storico" della pagina Sistema dice se la catena è intatta. Se qualcuno
cambiasse o togliesse una voce lavorando direttamente sul database, il
riquadro lo mostrerebbe in rosso, con quali voci. La verifica si può ripetere
quante volte si vuole: non aggiunge anelli e non cambia il sigillo. Il sigillo
cambia solo quando c'è qualcosa di nuovo da sigillare (una nota, un movimento,
un'operazione registrata), e nel registro delle operazioni finisce soltanto la
verifica che trova lo storico alterato.

L'ultima impronta si chiama sigillo. Quando si chiude un'emergenza, ORION
mostra a chi la chiude il sigillo di quel momento, da copiare, e lo manda per
email agli amministratori che hanno un indirizzo, se la posta è configurata.
Lo stesso sigillo è stampato in fondo al resoconto e al punto di situazione
di quell'emergenza. In ogni momento se ne scarica uno aggiornato dalla pagina
Sistema. Conviene conservarli fuori dal server: incollando un sigillo di
allora nel riquadro, ORION dice se lo storico fino a quel giorno è ancora
quello, anche nel caso in cui qualcuno con il server in mano avesse riscritto
tutta la catena.

Dall'archivio, "Stampa resoconto" stampa il riepilogo dell'emergenza chiusa;
"Stampa tutto" aggiunge dopo il riepilogo ogni segnalazione per intero, con
i dati, le squadre, tutto il diario e le foto, senza doverle stampare una per
una.

Le emergenze archiviate si possono cancellare dall'archivio per fare spazio.
La cancellazione toglie note, diario, foto e documenti di quell'emergenza, ma
nella catena resta scritto chi l'ha fatta, quando e quali voci sono uscite, e
il riquadro elenca le emergenze cancellate. Prima di cancellarne una conviene
scaricarne il resoconto.


## 9. Quando qualcosa non va

Se l'app dice "Sessione scaduta" o chiede di rientrare, di solito la password
è stata cambiata o l'account sospeso: basta rientrare, o sentire
l'amministratore. Se il codice della verifica in due passaggi viene
rifiutato, si controlla che l'ora del telefono sia automatica; senza telefono
si usa un codice di riserva. Se un esterno temporaneo trova scritto che il suo accesso è
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

Se nel centro operativo compare la fascia rossa "Il server non risponde",
non si ricarica la pagina: si lavora sulla situazione salvata e le
operazioni partono da sole al ritorno (capitolo 3, "Quando la rete non
c'è"). Se la mappa resta grigia ma il resto funziona, è internet che manca:
con la cartografia del territorio caricata si passa al fondo "Territorio
(dal server)".

Se le email non partono, la prima cosa è "Manda una prova" nelle
impostazioni della posta, che dice il motivo; il registro del server tiene
anche gli errori degli invii automatici.
