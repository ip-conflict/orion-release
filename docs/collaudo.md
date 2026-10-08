# Lista di collaudo

Le prove automatiche (`npm test` sul server, i test Gradle sull'app) coprono
la logica e le risposte del server. Non vedono un telefono vero, una
stampante vera, una rete che va e viene, il risparmio energetico di un
Samsung o la luce del sole su uno schermo. Questa lista serve a quello.

Conviene farla su un'istanza di collaudo con dati finti, con almeno due
telefoni Android di marche diverse (uno recente e uno vecchio, Android 8 o 9)
e un computer con il web aperto accanto. Servono cinque account: un
amministratore, una segretaria, un magazziniere, due volontari. Ogni punto
dice cosa fare e cosa si deve vedere. Quello che non va si annota con il
numero del punto, il telefono e l'ora.


## A. Installazione e aggiornamento

1. Installare da zero con `setup.sh` su una macchina Ubuntu pulita. Il sito
   risponde in HTTPS, l'amministratore entra, in `/var/backups/orion` c'è il
   primo backup, e un utente qualsiasi della macchina non riesce a leggerlo.
2. Riavviare la macchina. ORION torna su da solo.
3. Dalla pagina Sistema fare un backup, scaricarlo, verificarlo.
4. Ripristinare quel backup (password più RIPRISTINA). Durante il lavoro le
   pagine aperte mostrano "in manutenzione" e poi si ricaricano; alla fine i
   dati sono quelli del backup. Ripetere con il backup fatto prima di un
   aggiornamento (versione precedente): ORION riparte e funziona, la pagina
   Sistema mostra il passo "Allineamento del database".
5. Aggiornare dalla pagina Sistema a una versione nuova. Il numero di
   versione cambia e i dati ci sono tutti. Sul server `sudo -u orion_app pm2
   list` mostra ancora Orion, e l'APK in `app-android` è ancora al suo posto.
6. Aggiornare con `sudo ./update.sh`. Stesso risultato.
7. Lasciare il server spento una notte e riaccenderlo la mattina dopo. Entro
   poche ore compare il backup di recupero e partono gli avvisi del giorno.


## B. Account e ruoli

8. Creare un utente senza posta configurata. ORION mostra il link di
   attivazione; aperto su un altro browser, si sceglie la password.
9. Configurare la posta e creare un altro utente. Il link arriva per email.
10. Password dimenticata con la posta configurata: arriva il link, vale una
    volta sola, dopo un'ora non vale più.
11. Dare a una persona i ruoli segreteria e magazziniere insieme. Vede
    entrambe le voci nel menu, subito, senza rientrare.
12. Togliere un ruolo a chi è collegato. Alla richiesta successiva la pagina
    non si apre più. Poi importare un elenco di volontari salvato da Excel
    come CSV (punto e virgola) e come .xlsx, con una riga senza nome e una
    persona già presente: entrano gli altri, l'elenco dice riga e motivo
    delle escluse; ricaricare lo stesso file non crea doppioni.
13. Sospendere un utente collegato sul web e sull'app. Entrambi escono.
14. Un amministratore prova a togliersi l'amministrazione: non può.

14 bis. Verifica in due passaggi dell'amministratore. Il primo accesso dopo
    l'aggiornamento chiede di attivarla: inquadrare il QR con Google
    Authenticator (o un'app simile), scrivere il codice, salvare i dieci
    codici di riserva con "Scarica". Uscire e rientrare: dopo la password
    serve il codice. Lo stesso codice, riusato subito, viene rifiutato. Un
    codice di riserva fa entrare una volta sola.

14 ter. Verifica facoltativa di un volontario: dal profilo, Sicurezza,
    "Attiva"; poi "Cambia telefono" con un secondo telefono (il primo smette
    di valere solo dopo il codice del secondo) e "Disattiva". Dare a quel
    volontario il ruolo di amministratore mentre è collegato: viene fatto
    rientrare e deve attivarla. Da un altro amministratore, in Gestione
    utenti, il telefonino accanto alla chiave la azzera.


## C. App: primo avvio e accesso

15. Scaricare l'app dal web dal telefono (il web la propone dopo l'accesso).
    L'impronta del certificato mostrata dal web coincide con quella
    pubblicata.
16. Installare, scrivere l'indirizzo del server: compaiono logo e nome
    dell'associazione.
17. Accedere con password, accettare l'impronta. Chiudere l'app, riaprirla,
    entrare con l'impronta.

17 bis. Con la verifica in due passaggi attiva: dopo la password l'app chiede
    il codice, poi propone l'impronta; con l'impronta si rientra senza
    codice. Provare anche "Non ho il telefono: uso un codice di riserva". Un
    amministratore senza verifica viene mandato ad attivarla dal browser.
18. I permessi arrivano uno alla volta: notifiche, fotocamera, posizione, e
    per ultima la posizione "Consenti sempre" con la spiegazione.
19. Negare "sempre": la home mostra il promemoria e il pulsante porta alle
    impostazioni.
20. Cambiare la password dal web. L'app, alla prossima apertura, chiede di
    rientrare e l'impronta va riattivata.
21. Aggiungere il collegamento con il logo alla schermata home, se proposto.
    Si apre ORION.
22. Mettere sul server una versione nuova dell'APK. L'app propone
    l'aggiornamento; con la minima alzata, si ferma e chiede di aggiornare.


## D. Notifiche

22-bis. Al primo accesso con l'app 1.2.0, dopo i permessi, compare la
    spiegazione degli avvisi sempre attivi; con "Va bene" fra le notifiche
    resta l'icona fissa "Avvisi attivi", senza icona nella barra di stato e
    senza suono. In Io › Il mio profilo › Avvisi sul telefono i controlli sono
    tutti OK (o dicono cosa sistemare) e "Manda una prova" fa arrivare la
    prova dopo 20 secondi anche con l'app chiusa e lo schermo spento.
22-ter. Lasciare il telefono fermo una notte senza aprire l'app, poi mandare
    una prova dal web o mettere la persona in una squadra: la notifica arriva
    in pochi secondi. In Gestione utenti l'icona del telefono accanto al nome
    è verde. Riavviare il telefono senza aprire l'app: l'icona fissa torna da
    sola. Spegnere gli avvisi sempre attivi: l'icona fissa sparisce.

23. Aprire un'emergenza dal web, senza squadre già formate. Sui telefoni
    dei volontari non arriva niente e l'app non mostra l'emergenza.
24. Mettere un volontario in una squadra, con l'app chiusa sul suo telefono.
    Entro un quarto d'ora (di solito meno) arriva "Sei in squadra ..." sul
    canale Emergenza, con il suono; toccandola si apre la schermata
    dell'emergenza. Con l'app aperta la home cambia subito, e in secondo
    piano arriva una sola notifica, non due.
25. Toglierlo dalla squadra: la notifica sparisce dall'elenco e l'emergenza
    dalla home. Una squadra formata prima di aprire l'emergenza riceve
    l'avviso al momento dell'apertura.
26. Assegnare una squadra a un intervento. I membri ricevono "Squadra ...:
    intervento #N". Togliere la squadra: la notifica sparisce dall'elenco
    dell'app.
27. Chiudere l'emergenza. Dall'elenco delle notifiche spariscono quelle
    dell'emergenza, e dal telefono la notifica di sistema.
28. Consegnare un DPI con verbale a un volontario, con la conferma dall'app
    accesa. Arriva "Hai ricevuto dei DPI da confermare" sul canale Avvisi;
    toccandola si apre Io. Dopo la conferma sparisce dall'elenco.
29. La mattina dopo, la segretaria trova "Segreteria: N volontari da
    sistemare" e il magazziniere "Magazzino: N cose da guardare". Toccando
    quello della segreteria si apre la Segreteria dell'app; quello del
    magazzino apre il magazzino nel browser.
30. Il giorno dopo ancora, se i numeri non sono cambiati, il riepilogo non
    suona di nuovo.
31. Con tre categorie diverse in elenco, compaiono i filtri; scegliendone uno
    si vedono solo quelle. Con una categoria sola i filtri non ci sono.
32. Dalle impostazioni di Android silenziare il canale Magazzino. Gli altri
    suonano ancora.
33. Lasciare il telefono fermo e con lo schermo spento per un'ora fuori
    emergenza. La notifica arriva entro l'ora successiva. Annotare quanto
    batteria ha consumato l'app nelle statistiche di Android.
34. Stessa prova durante un'emergenza, per due ore. Annotare il consumo.
35. Su un telefono con risparmio energetico aggressivo (Xiaomi, Huawei,
    Samsung) verificare che la home segnali il risparmio e che, escludendo
    l'app, le notifiche arrivino.
36. Sulla schermata di blocco con i contenuti nascosti compare solo "Hai una
    novità su ORION". L'icona piccola è il triangolo arancione.
37. Le email di sempre partono ancora: avviso di scadenza al volontario,
    report mensile (con "Invia ora il riepilogo"), avviso del magazzino a chi
    l'ha chiesto. Non arrivano email per le cose che ora stanno nell'app.


## E. Emergenza in squadra

38. Volontario in una squadra con intervento assegnato: la home mostra
    l'intervento con indirizzo, navigatore, chiamata e diario.
39. Aggiungere una nota e una foto in modalità aereo. Tolta la modalità
    aereo, partono da sole e compaiono sul web.
40. "Sposta qui": dopo la conferma il punto si sposta sulla mappa del web.
41. La posizione della squadra si muove sulla mappa del web ogni 15 secondi,
    anche con lo schermo spento e l'app chiusa, con la notifica fissa
    visibile.
42. Togliere il volontario dalla squadra: la posizione smette di partire e la
    notifica fissa sparisce.
43. Chiudere l'intervento dal web: sul telefono arriva l'avviso e la home
    torna in attesa.
43 bis. Caposquadra con due telefoni nella stessa squadra. Dal centro operativo,
    Membri, toccare la stella di uno dei due: diventa caposquadra, riceve la
    notifica e, con la segreteria accesa, il suo numero compare nel menu
    della squadra e si chiama toccandolo. Allontanare i due telefoni: sulla
    mappa la squadra segue il caposquadra e non salta; sull'altro telefono
    la notifica fissa dice chi la sta mandando. Chiudere l'app del
    caposquadra: entro tre o quattro minuti la squadra segue l'altro telefono.
    Riaprirla: torna subito al caposquadra. Togliere la stella: la tiene chi
    la stava mandando.


## F. Esterni temporanei

44. Un volontario (non amministratore) crea un accesso esterno dal centro
    operativo con nome, ente e una squadra nuova.
45. Dal telefono dell'esterno, con la fotocamera di sistema, inquadrare il
    QR: si apre la pagina, che su Android propone l'app.
46. "Apri nell'app": l'app mostra il server e chiede conferma, poi entra.
    La home dice per chi si è dentro e che l'accesso finisce con
    l'emergenza.
47. Dall'app già installata, "Accedi con un codice" e inquadrare lo stesso
    QR: stessa cosa.
48. L'esterno vede solo l'emergenza. Assegnata la sua squadra a un
    intervento, può scrivere note e caricare foto; su un intervento non suo
    le foto sono rifiutate.
49. La posizione dell'esterno compare sulla mappa del COC.
50. Rigenerare il QR: il vecchio non vale più, il nuovo sì.
51. Revocare l'accesso: l'app dell'esterno dice che l'accesso è finito, non
    "sessione scaduta".
51-bis. "QR e link" sotto un accesso: mostra lo stesso QR di prima, si
    rimanda per email. "Cambia persona": chi c'era esce, il suo QR non vale
    più, chi subentra entra con il QR nuovo e compare nella squadra. L'app
    di un accesso temporaneo non propone il collegamento col logo.
51-ter. Gestione utenti: le schede Interni ed Esterni, il filtro dei
    temporanei, l'emergenza sotto ogni temporaneo, le colonne Creato il e
    Ultimo accesso (che per chi è appena entrato dice "Adesso"); su un
    temporaneo ci sono solo il cestino e nessun pulsante di password o
    sospensione.
52. Chiudere l'emergenza con un esterno ancora dentro: viene disattivato,
    esce dalla squadra, l'app lo dice. La squadra rimasta vuota viene chiusa
    d'ufficio; una squadra vuota con un mezzo in carico resta.


## G. Segreteria

53. Sul web, registrare una visita e un corso con il certificato. Il
    cruscotto si aggiorna.
54. Nell'app, la segretaria apre Segreteria con l'impronta. Vede chi ha
    qualcosa da sistemare, cerca un volontario, apre il fascicolo, chiama con
    un tocco.
55. Dall'app registrare una visita fotografando il certificato, e un corso
    scegliendo un PDF dal telefono. Sul web compaiono con i file giusti.
56. Senza rete la Segreteria dell'app non si apre e lo spiega.
57. Un volontario nell'app apre un corso: vede codice, validità, storico,
    apre l'attestato e lo salva in Download (su Android 8 e 9 passa dal
    foglio di condivisione).
58. Spegnere il modulo Segreteria: la voce sparisce dall'app e dal web.
59. Stampare un tesserino da divisa. Spegnere i QR: spariscono da profilo,
    app e tesserino, la verifica non risponde; riaccesi, tornano gli stessi.


## H. Magazzino

60. Stampare etichette su un foglio adesivo A4 vero (almeno due formati),
    con copie, posizioni saltate e correzione in millimetri. Le etichette
    cadono nelle caselle.
61. Inquadrare un'etichetta stampata con la fotocamera di sistema: si apre la
    scheda del bene.
62. Consegna dall'app a un volontario, scegliendo per taglia e scansionando
    un'etichetta, con verbale di consegna e conferma DPI spenti (come di
    base): nessun verbale. Accendere il verbale di consegna, ripetere con la
    casella spuntata: il verbale c'è; fotografare il foglio firmato: il
    verbale passa a "Firmato su carta" sul web. Con la conferma DPI accesa
    la casella sparisce e il verbale c'è sempre.
63. Consegna dall'app in modalità aereo. La consegna resta in coda; tolta la
    modalità aereo parte, e sul web compare una volta sola.
64. Consegna in coda che il server rifiuta (svuotare la giacenza dal web
    prima che parta): arriva l'avviso e la schermata della consegna la
    mostra.
65. Rientro dall'app da una persona con il verbale di rientro spento (come
    di base): un pezzo singolo, spunta e registra, nessun verbale. Poi
    accendere il verbale di rientro nelle impostazioni del magazzino e
    ripetere con metà di un materiale sfuso e "Resta in carico": la scelta
    del verbale compare già spuntata, il verbale riporta quello che resta,
    si fotografa il foglio.
66. Consegna a un volontario di un mezzo e di un sacco di materiale; rientro
    dall'app: il mezzo con i chilometri, il materiale in parte con "Usato sul
    posto". Sul web i chilometri del mezzo sono aggiornati e il consumo è
    registrato. Né il web né l'app propongono di consegnare a una squadra o a
    un mezzo. Le frecce del campo quantità scalano di uno sui sacchi e di un
    centesimo solo su un materiale a litri; mezzo sacco viene rifiutato.
67. Rientro parziale senza scegliere cosa ne è del resto: l'app non va
    avanti e lo dice.
68. Un volontario senza ruolo di magazziniere non vede Consegna e Rientro
    nell'app; sul web li vede e può registrarli.
69. Chiudere un'emergenza con materiale fuori: il resoconto riporta mezzi e
    materiali impiegati e non contiene DPI.
70. Dall'app, come magazziniere, aprire Magazzino: inventario, chi ha cosa,
    scadenze, registro e impostazioni mostrano gli stessi dati del web.
    Cercare un bene per matricola e filtrare per veicoli.
71. Dall'app creare un'attrezzatura con una scadenza ogni 6 mesi e un DPI a
    taglie con le quantità iniziali; caricare due taglie con una nota. Sul web
    compaiono uguali. Inquadrare l'etichetta di un bene con il pulsante
    Etichetta: si apre la sua scheda.
72. Dalla scheda di un bene nell'app: correggere la nota, mandarlo in
    officina e ricaricarlo, registrare un intervento con la fattura
    fotografata (la prossima scadenza si sposta), dismetterlo. Solo la
    dismissione chiede conferma e vuole una spiegazione; su un pezzo unico la
    rettifica non c'è.
73. Dalle impostazioni nell'app spegnere e riaccendere il verbale di rientro,
    aggiungere ed eliminare una categoria vuota, mettere a riposo
    un'ubicazione: sul web si vede subito. Eliminare una categoria con dei
    beni: l'app riporta il motivo del server.
74. Toccare il riepilogo del magazzino fra le notifiche dell'app: si aprono le
    scadenze. Un volontario senza ruolo di magazziniere non vede la voce
    Magazzino.


## I. Web in sala operativa

75. Aprire un'emergenza con squadre già formate e scegliere di tenerle; poi
    di scioglierle. Il registro delle squadre del resoconto è coerente.
76. Creare una segnalazione e lasciarla senza squadra oltre il tempo
    impostato: diventa rossa. Segnarla "Solo monitoraggio": torna neutra.
77. Due postazioni aperte: quello che si fa su una compare sull'altra senza
    ricaricare.
78. Scrivere due note nel diario di sala da una postazione: compaiono
    sull'altra senza ricaricare, con ora e nome. Un esterno temporaneo non
    trova il campo per scrivere.
79. Chiudere l'emergenza e scaricare il resoconto dall'Archivio. Il diario
    di sala è la prima sezione.
80. Aprire il web da un telefono piccolo: menu, centro operativo e magazzino
    si usano con il dito.
81. A emergenza aperta, "Situazione" nell'intestazione: il foglio riporta le
    segnalazioni aperte con stato e squadre, le squadre con i componenti, le
    chiuse e le ultime note di sala. Stampato o salvato in PDF ha i margini e
    il numero di pagina. Un esterno non vede il pulsante.
82. "Rubrica": aggiungere un contatto, cercarlo, correggerlo, toglierlo. Da
    un'altra postazione la rubrica aperta si aggiorna da sola. "Stampa" dà il
    foglio con i gruppi.
83. Chiudere un'emergenza in cui una squadra nata per l'occasione ha fatto un
    intervento: la squadra si chiude d'ufficio, ma nell'Archivio, in "Stampa
    resoconto" e nel dettaglio della segnalazione la squadra intervenuta c'è.
84. Funzioni di supporto spente: in sala non compare niente. Accese dalle
    impostazioni, nella pagina Funzioni spegnerne una, rinominarne una,
    aggiungere un membro e segnarlo referente.
85. Su una segnalazione assegnare la F2 con una motivazione: il membro della
    F2 riceve la notifica (anche sul telefono), la scheda mostra "F2". Una
    seconda assegnazione alla F2 sulla stessa segnalazione è rifiutata.
86. Un accesso temporaneo creato con la funzione F2: vede nel pannello solo
    la F2, prende in carico, scrive "Nota per la F2", conclude con l'esito. La
    segnalazione resta aperta. Su una segnalazione senza incarichi della F2
    non scrive.
87. Il punto di situazione ha la sezione delle funzioni; il resoconto alla
    chiusura riporta le funzioni coinvolte.
88. Magazzino: il filtro per categoria e per modello ("Scarpe
    antinfortunistiche") in Inventario e Chi ha cosa; un DPI "Non lo usiamo"
    sparisce e ricompare con la casella.
89. Impostazioni, Livelli del piano: importare un GeoJSON esportato da QGIS in
    EPSG:4326 (e uno in un altro sistema, che va rifiutato con la
    spiegazione). Nel centro operativo le zone compaiono come livello, con il
    loro colore nel controllo dei livelli.
90. Disegnare una strada chiusa con i due tocchi (con la rete la linea segue
    la strada), una zona interdetta a mano; da un'altra postazione compaiono
    senza ricaricare. Riaprire la strada: sparisce dalla mappa, resta nel
    punto di situazione con chi e quando.
91. Un esterno vede strade chiuse e zone ma non ha la matita.


## L. Senza rete e con rete scarsa

81. Aprire l'app senza rete: il contesto, il tesserino e l'ultimo
    intervento ci sono.
82. Rete che va e viene (ascensore, cantina): note, foto e conferme partono
    da sole, senza doppioni.
83. Server spento mentre l'app è aperta: l'app non si blocca e riprende
    quando il server torna.
83-bis. Centro operativo aperto, server spento (o cavo staccato): compare la
    fascia rossa con l'ora della situazione, la lista e la mappa restano.
    Creare una segnalazione, scrivere una nota e una voce del diario,
    cambiare uno stato: la fascia dice quante cose sono in coda e "Vedi" le
    elenca. Riaccendere il server: partono da sole, una volta sola, e la
    situazione si rilegge.
83-ter. Con il server spento cambiare lo stato di una segnalazione; da
    un'altra postazione (con il server acceso solo per lei, o prima di
    spegnerlo) cambiarla diversamente. Al ritorno il primo cambio compare fra
    le "non inviate" con il motivo, e lo stato resta quello dell'altra
    postazione.
83-quater. Caricare una cartografia MBTiles dalle impostazioni (anche di
    qualche centinaio di MB: va a pezzi, con la barra). Con internet
    staccato dal server ma la rete della sala funzionante, il centro
    operativo e il copione passano da soli al fondo "Territorio (dal
    server)" con un avviso.
83-quinquies. Telefono in squadra in una zona senza campo per qualche
    minuto: al ritorno la posizione parte subito, e in sala la squadra
    risulta ferma da quando il telefono ha perso il campo, non "aggiornata
    adesso".


## M. Uscita e pulizia

84. Uscire dall'app: spariscono le notifiche di sistema, i documenti
    scaricati nella cache, la posizione si ferma.
85. Entrare sullo stesso telefono con un altro utente: non vede niente del
    precedente, né notifiche né coda.
86. Disinstallare e reinstallare: si riparte da zero, l'impronta va
    riattivata.

## Documenti del gruppo

1. Da amministratore dare a un volontario il solo permesso "Gestire
   l'archivio dei documenti": senza rifare l'accesso, in Documenti compaiono
   "Carica un documento" e "Nuova cartella" e accanto a ogni documento
   "Gestisci".
2. Caricare il piano comunale in PDF nella sua cartella, segnato "in
   emergenza" e "sempre con me". Un file oltre i 25 MB, o un file rinominato
   in .pdf che PDF non è, viene rifiutato con un messaggio chiaro.
3. Da un altro volontario aprirlo dal web e dall'app: nel browser si apre in
   linea; nell'app, dopo un aggiornamento con la rete, ha il simbolo verde.
   Mettere il telefono in modalità aereo e aprirlo di nuovo: si apre. Un
   documento non "sempre con me" senza rete non si apre e l'app lo dice.
4. Caricare una versione nuova del piano con una nota: dal web la vecchia si
   apre ancora dallo storico; nell'app, riaprendola con la rete, la copia
   diventa quella nuova.
5. Riservare un verbale ai coordinatori: un volontario non lo vede né sul
   web né nell'app, un coordinatore sì.
6. Collegare il libretto della motosega alla motosega del magazzino:
   compare nella scheda del bene, e inquadrando l'etichetta con il telefono
   di un volontario sotto "cos'è e chi ce l'ha" c'è il collegamento al
   libretto.
7. Con un'emergenza aperta, un esterno temporaneo trova nel menu "Documenti
   del gruppo" solo il piano e i documenti per l'emergenza, sul web e
   nell'app; chiusa l'emergenza non ne vede più.
8. Uscire dall'app: i documenti sul telefono spariscono; rientrare con la
   rete li riscarica.

## Attività, calendario e presenze

1. Da coordinatore, in Calendario, creare un addestramento "Solo alcuni" con
   tre volontari, che vale come corso, con avviso nell'app ed email: i tre
   ricevono la notifica sul telefono e l'email con il collegamento; un
   quarto volontario non vede l'attività né sul web né nell'app. Accanto a
   chi non ha né l'app né l'email compare "Da chiamare".
2. Dal telefono di uno dei tre toccare la notifica: si apre la scheda
   dell'attività; rispondere "Ci sono". Il numero sulla voce Calendario
   della home cala, e sul web il coordinatore vede la risposta.
3. Creare un servizio "Aperta" con due posti: due volontari aderiscono, il
   terzo riceve "I posti sono esauriti"; uno dei due dice "Non posso" e il
   terzo ora riesce ad aderire.
4. Cambiare l'orario dell'addestramento con "Avvisa del cambio": arriva
   l'avviso a chi non ha detto di no. Annullare il servizio con un motivo:
   resta nel calendario barrato e i convocati ricevono l'avviso.
5. Chiudere l'addestramento con i presenti, togliendo mezz'ora a uno: le ore
   compaiono in "Le mie presenze" del profilo e nell'app, il corso nel
   libretto dei presenti; l'attestato in PDF si apre e riporta orari e dati
   giusti. "Elimina" ora rifiuta, perché ci sono presenze.
6. Con un volontario che gestisce visite e corsi e uno che non le gestisce,
   aprire lo stesso mese: il primo vede le scadenze della segreteria
   raggruppate per giorno, il secondo solo le proprie. Lo stesso con il
   magazzino.
7. Spegnere il modulo Attività nelle impostazioni: Calendario sparisce dal
   menu e dall'app, mentre "Le mie presenze" resta nel profilo web.
   Riaccenderlo: le attività sono ancora lì.

## Squadra COC

1. Aprire un'emergenza: nella barra delle squadre del centro operativo la
   COC c'è già, per prima. Metterci il coordinatore e un esterno temporaneo.
2. Dal telefono del coordinatore: la voce Emergenza apre la sala operativa
   con tutte le segnalazioni aperte; scrivere una nota nel diario di una
   segnalazione di un'altra squadra, e vederla dal web. Il telefono non manda
   la posizione e la COC non compare sulla mappa.
3. Provare ad assegnare la COC a una segnalazione o a eliminarla:
   entrambe rifiutate con un messaggio chiaro.
4. Spostare un volontario da Alfa a Bravo durante l'emergenza, poi chiudere
   l'emergenza: la COC sparisce, nel calendario l'emergenza ha le presenze
   degli interni (il volontario spostato una volta sola, con tutto il
   tempo), l'esterno no. Correggere un orario e aggiungere chi ha aiutato
   senza stare in squadra: le correzioni compaiono nel registro delle
   operazioni.
5. Da Presenze nel calendario, il riepilogo dell'anno: i totali tornano, e il
   CSV si apre nel foglio di calcolo con le colonne giuste.

## Chiamata, reperibilità e assenze

1. Da coordinatore, in Calendario, mettere di turno due volontari per la
   settimana con "Reperibilità": i giorni mostrano i reperibili e la scheda
   del giorno i nomi. Un terzo volontario, dal telefono, segna un'assenza di
   tre giorni da domani con le frecce: il calendario del coordinatore la
   conta fra gli assenti.
2. Aprire un'emergenza e, da "Volontari", chiamare i reperibili con un
   messaggio e due minuti di attesa: arriva la notifica sul telefono, e
   toccandola si apre la schermata Chiamata, non quella dell'emergenza. La
   home mostra la chiamata in cima.
3. Uno risponde "Fra 30'": nel pannello passa fra gli in arrivo con l'ora
   prevista. L'altro non risponde: dopo due minuti sale fra i "da chiamare a
   voce", con il telefono. "Richiama chi non ha risposto" gli rimanda
   l'avviso.
4. Chiamare "Tutti i volontari": quello assente non riceve niente. Chiamarlo
   scegliendolo a mano: la chiamata gli arriva.
5. Dal telefono "Sono arrivato in sede": nel pannello passa fra chi è in
   sede, e nella composizione delle squadre compare per primo con "In
   sede". Segnare con "È arrivato qualcuno" una persona non chiamata,
   congedarne un'altra dopo mezz'ora, chiudere l'emergenza: nelle presenze
   contano anche il tempo in sede senza squadra e chi si è presentato da sé,
   e chi è stato congedato conta fino al congedo.

## Simulazione, copione e regia

1. In "Tipi" controllare la natura: Addestramento e Esercitazione hanno la
   loro, Riunione è generica e non offre la simulazione. Creare un
   addestramento per oggi con "Scenario in sala", lo scenario, gli obiettivi
   e un volontario nella regia.
2. Dal volontario della regia aprire "Copione": aggiungere una segnalazione
   che entra da sola al minuto 2, cercata per indirizzo; una telefonata al
   minuto 4; un aggravamento della prima al minuto 6; un imprevisto alla
   squadra Alfa; una strada chiusa disegnata, a mano. Un volontario
   qualunque non vede il copione.
3. In "Excel" scaricare il modello, aggiungere due righe e una sbagliata,
   caricarlo: non carica niente e dice la riga. Correggere e ricaricare: le
   due righe ci sono, gli esempi no. Scaricare il copione attuale e
   aprirlo.
4. Dalla scheda dell'attività "Apri la sala": il centro operativo ha la
   fascia viola SIMULAZIONE, il codice SIM, e nell'app di chi è in squadra
   la fascia è viola. La regia apre il pannello con "Regia" e avvia lo
   scenario: al minuto 2 la segnalazione entra da sola; al minuto 4 la
   telefonata compare fra "Da telefonare alla sala" e il regista riceve la
   notifica. La sala la inserisce, il regista la collega.
5. "Pausa" per tre minuti: gli eventi a tempo aspettano e ripartono con
   "Riprendi". Rimandare un evento di cinque minuti, saltarne uno,
   inventarne uno al momento. L'imprevisto arriva sui telefoni di Alfa con
   [SIMULAZIONE] davanti.
6. Dal telefono del regista "Regia: osservazioni": scrivere
   un'osservazione, che compare subito nel pannello del web.
7. "Chiudi la simulazione": le presenze vanno nell'attività, che è
   conclusa, e nel libretto risultano come addestramento; la strada chiusa
   simulata non è più sulla mappa. Nella pagina del copione, "Valutazione"
   mostra i tempi della segnalazione e se la squadra è partita in tempo.
   Due registi scrivono il debriefing, uno lo conclude; spuntare "Copione e
   debriefing visibili a chi ha partecipato" e controllare che un
   partecipante li veda.
8. In Archivio, "Simulazioni" mostra solo questa, con il segno; il
   resoconto ha la scritta SIMULAZIONE su ogni pagina.
9. Aprire un'altra simulazione e, da un coordinatore, "Emergenza reale":
   dopo la conferma la simulazione è chiusa come interrotta, l'emergenza
   vera è aperta con le stesse squadre e la stessa sala. L'archivio dice da
   quale emergenza è stata interrotta.
10. Con un addestramento "Allertamento", "Chiamata per l'allertamento" dalla
    scheda: chi risponde e arriva risulta presente all'attività, senza che
    si apra nessuna sala.

## Ritocchi alla simulazione e aggiornamento dell'app

1. Creare un addestramento con "Scenario in sala": la regia si sceglie
   dall'elenco a discesa, le persone compaiono come etichette con la x. Chi
   l'ha creato apre la scheda e legge "La conduci tu", senza "Ci sono" e
   "Non posso"; non riceve la convocazione. Spostando l'inizio, la fine segue
   con la stessa durata.
2. Nel copione la mappa ha il controllo dei livelli con le zone del piano e
   le strade in vigore. Aggiungere una "Zona di pericolo" (alluvione) e una
   strada chiusa toccando i due capi: la linea segue la strada.
3. Aprire la sala e avviare lo scenario con una comunicazione al minuto 0 e
   una segnalazione al minuto 1: la comunicazione compare in primo piano in
   cima al centro operativo, anche su un secondo computer, e resta finché non
   si tocca "Letta"; la segnalazione esce quando il conto alla rovescia
   arriva a zero, non qualche secondo dopo. La zona di pericolo dà il rischio
   alle segnalazioni dentro.
4. "+ Invento un evento adesso", segnalazione, "Sulla mappa" e un tocco: la
   segnalazione entra in sala nel punto scelto. Mentre si scrive, il
   pannello non perde il testo.
5. Chiudere la simulazione: lo stato in alto torna normale, senza strisce
   viola. Lo sfondo della mappa è a colori pieni; "Sfondo attenuato" si
   accende dai livelli.
6. Con l'app 1.2.1 installata, pubblicare sul server un APK più recente:
   all'apertura la home dice che si sta scaricando, poi chiede "Consenti"
   (la prima volta) e "Aggiorna ora". Uscendo dall'app si installa; la prima
   volta Android chiede la conferma, la volta dopo (Android 12 e oltre) no.
   Un APK firmato con un'altra chiave non si installa e la home lo dice.
7. Senza emergenze aperte, da coordinatore, "Simulazione" nel centro
   operativo: scegliere il copione di una simulazione passata e aprire. La
   sala si apre con la fascia viola e la regia; nessuno riceve convocazioni;
   nel calendario c'è l'addestramento di oggi. Un volontario non vede il
   pulsante. Chiusa la simulazione, le presenze sono nell'attività.
8. Da magazziniere, nella scheda di un'attrezzatura con un'altra uguale
   (stessa denominazione): spuntare "Anche all'altro bene uguale" e
   "Carica il libretto" con un PDF. Il libretto compare nella scheda, in
   quella del bene uguale e in Documenti del gruppo nella cartella dei
   libretti. Collegare un documento già in archivio dall'elenco a discesa,
   poi scollegarlo con il simbolo accanto: resta nell'archivio. Da un
   volontario che ha in carico quel bene, nell'app, aprire Io e toccare il
   bene: il libretto si apre. Mettere il telefono in modalità aereo: il
   libretto si apre lo stesso, e in Documenti ha il simbolo verde con "resta
   sul telefono finché lo hai". Far rientrare il bene in magazzino e
   riaprire l'app con la rete: il libretto non è più sul telefono.
9. Con un'impronta registrata prima di attivare la verifica in due
   passaggi: dopo l'impronta l'app chiede il codice una volta; all'accesso
   successivo basta l'impronta.

## Ruoli e permessi

1. Da amministratore, in Gestione utenti, dare a un volontario il ruolo
   Coordinatore: senza rifare l'accesso, nel centro operativo vede Apri e
   Chiudi emergenza e nel menu l'Archivio emergenze; non vede Gestione utenti
   né Impostazioni.
2. Togliere il ruolo e dare, nella sezione "Permessi in più", il solo
   "Consegnare e far rientrare materiale": nel Magazzino, ricaricando la
   pagina, compaiono Consegna e Rientro; senza il permesso restano Chi ha cosa
   e Scade e manca. Lo stesso nell'app: la consegna c'è solo con il permesso.
3. Dare "Gestire anagrafica e tesserini": compare la voce Volontari; con
   "Nuovo volontario" si iscrive una persona (solo come volontario); in
   Segreteria il fascicolo mostra anagrafica, tesserino e DPI, e al posto di
   visite e corsi la nota del permesso che manca.
4. Dare "Gestire visite mediche e corsi" a chi non ha la verifica in due
   passaggi: la sessione cade e al nuovo accesso ORION chiede di attivarla.
5. Nel registro delle operazioni ogni concessione compare con chi l'ha fatta;
   nell'app, in Il mio profilo, compaiono ruoli e permessi.
6. Dare a un volontario il solo "Organizzare attività e presenze": in
   Calendario compaiono "Nuova attività" e "Presenze"; toglierlo e indicarlo
   come responsabile di un'attività: gestisce quella sola.

