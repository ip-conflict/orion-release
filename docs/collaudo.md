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


## C. App: primo avvio e accesso

15. Scaricare l'app dal web dal telefono (il web la propone dopo l'accesso).
    L'impronta del certificato mostrata dal web coincide con quella
    pubblicata.
16. Installare, scrivere l'indirizzo del server: compaiono logo e nome
    dell'associazione.
17. Accedere con password, accettare l'impronta. Chiudere l'app, riaprirla,
    entrare con l'impronta.
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

23. Aprire un'emergenza dal web con l'app chiusa sul telefono dei volontari.
    Entro un quarto d'ora (di solito meno) arriva "Emergenza aperta" sul
    canale Emergenza, con il suono. Toccandola si apre la schermata
    dell'emergenza.
24. Con l'app aperta in primo piano, stessa prova: niente notifica di sistema
    doppia, la home cambia subito.
25. Con l'app aperta ma in secondo piano: una sola notifica dell'emergenza,
    non due.
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


## L. Senza rete e con rete scarsa

81. Aprire l'app senza rete: il contesto, il tesserino e l'ultimo
    intervento ci sono.
82. Rete che va e viene (ascensore, cantina): note, foto e conferme partono
    da sole, senza doppioni.
83. Server spento mentre l'app è aperta: l'app non si blocca e riprende
    quando il server torna.


## M. Uscita e pulizia

84. Uscire dall'app: spariscono le notifiche di sistema, i documenti
    scaricati nella cache, la posizione si ferma.
85. Entrare sullo stesso telefono con un altro utente: non vede niente del
    precedente, né notifiche né coda.
86. Disinstallare e reinstallare: si riparte da zero, l'impronta va
    riattivata.
