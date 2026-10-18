# ORION, modello di valutazione d'impatto (DPIA)

Questo è il punto di partenza per la valutazione d'impatto sulla protezione dei
dati (art. 35 del Regolamento UE 2016/679) di un'associazione che usa ORION.
Le parti che descrivono il software sono già scritte e corrispondono a come
ORION funziona davvero; le parti che decide l'associazione sono segnate con
**[DA COMPILARE]**, spesso con una proposta da confermare o cambiare. La
valutazione resta dell'associazione, che è titolare del trattamento: questo
modello non è un parere legale e va riletto con il proprio DPO o consulente.
Chi preferisce uno strumento guidato può riportare questi contenuti nel
software PIA della CNIL, gratuito e in italiano, indicato anche dal Garante.

Quando ORION cambia in modo che tocchi i dati (una funzione nuova, un servizio
esterno in più), il manuale tecnico lo dice e la DPIA va riletta.


## 0. Il documento

| Voce | Valore |
|---|---|
| Titolare del trattamento | [DA COMPILARE: nome dell'associazione, sede, codice fiscale] |
| Legale rappresentante | [DA COMPILARE] |
| Responsabile della protezione dei dati (DPO) | [DA COMPILARE: nome e contatto, oppure "non designato" con il motivo] |
| Chi ha redatto la valutazione | [DA COMPILARE] |
| Versione di ORION valutata | [DA COMPILARE: si legge nella pagina Sistema] |
| Data | [DA COMPILARE] |
| Prossima revisione | [DA COMPILARE: proposta, entro un anno o al primo cambiamento importante] |


## 1. Perché serve

Le linee guida europee sulla DPIA (WP248, fatte proprie dal Garante) la
chiedono quando un trattamento presenta almeno due dei criteri elencati.
ORION ne presenta più di due.

| Criterio | In ORION |
|---|---|
| Dati di categorie particolari (art. 9) | Visite mediche, idoneità e certificati dei volontari |
| Monitoraggio sistematico | La posizione delle squadre durante un'emergenza |
| Interessati in posizione di debolezza verso il titolare | Volontari rispetto all'associazione che ne organizza il servizio |
| Uso combinato di tecnologie | Web app, app per telefono, geolocalizzazione, notifiche, verifica in due passaggi con il telefono |
| Larga scala | [DA COMPILARE: numero di volontari e di persone nelle segnalazioni; per un'associazione piccola di solito no] |

Conclusione proposta: la DPIA si fa. [DA COMPILARE: confermare]


## 2. Descrizione del trattamento

### 2.1 Finalità e basi giuridiche

La base giuridica la sceglie l'associazione; quelle indicate sono le più
frequenti e vanno confermate.

| Finalità | Dati principali | Base giuridica |
|---|---|---|
| Tenere l'anagrafica dei volontari e il loro tesserino | Nome, cognome, codice fiscale, contatti, indirizzo, foto, ruoli | [DA COMPILARE: proposta, art. 6.1.b, rapporto associativo] |
| Verificare l'idoneità al servizio e la formazione | Visite mediche, idoneità, certificati, corsi | [DA COMPILARE: proposta, art. 6.1.c e art. 9.2.b, obblighi di sicurezza dei volontari di protezione civile] |
| Coordinare le emergenze e le esercitazioni | Squadre, interventi, segnalazioni, posizione delle squadre, diario di sala | [DA COMPILARE: proposta, art. 6.1.e o 6.1.d, compiti di protezione civile e interessi vitali] |
| Gestire il materiale consegnato | DPI e attrezzature in carico, taglie, verbali di consegna | [DA COMPILARE: proposta, art. 6.1.b e 6.1.c] |
| Organizzare attività, chiamate e presenze | Calendario, risposte alle convocazioni, disponibilità, presenze | [DA COMPILARE: proposta, art. 6.1.b] |
| Proteggere il sistema e ricostruire chi ha fatto cosa | Registro delle operazioni con indirizzo IP, storico inalterabile, accessi | [DA COMPILARE: proposta, art. 6.1.f, interesse legittimo alla sicurezza] |

### 2.2 Interessati

| Chi | Come entra in ORION |
|---|---|
| Volontari e personale dell'associazione | Iscritti dalla segreteria; accedono con un account personale |
| Esterni temporanei | Persone di altri enti aggiunte durante un'emergenza, con un accesso che finisce con l'emergenza |
| Persone che segnalano o sono coinvolte in un intervento | Nome e contatto del segnalante, indirizzo e descrizione dell'evento scritti dalla sala |
| Contatti della rubrica d'emergenza | Riferimenti di enti e persone utili in emergenza |

### 2.3 Dati trattati e chi li vede

ORION mostra a ciascuno solo quello che il suo ruolo concede. I ruoli sono
amministratore, coordinatore, segreteria, magazziniere, volontario ed esterno;
l'amministratore può aggiungere singoli permessi a una persona.

| Dati | Chi li vede | Protezione particolare |
|---|---|---|
| Anagrafica e contatti | La persona stessa e chi ha il permesso di gestire l'anagrafica (segreteria, amministratori); il telefono dei membri delle squadre a chi lavora al centro operativo, se il modulo Segreteria è acceso | Nessuna oltre ai permessi |
| Foto del tesserino | La persona, l'anagrafica; chi inquadra il QR del tesserino, se i QR sono accesi | File cifrato; i QR si possono spegnere |
| Visite, idoneità, corsi e certificati | La persona e chi ha il permesso sanitario (segreteria sanitaria, amministratori) | Certificati ed esito della visita cifrati, anche nel database; nell'app si aprono solo dopo impronta o PIN e non restano sul telefono; per chi li gestisce la verifica in due passaggi è obbligatoria |
| Posizione delle squadre | Il centro operativo durante l'emergenza | Si tiene solo l'ultima posizione di ogni squadra, non il percorso, e si cancella alla chiusura dell'emergenza |
| Segnalazioni, interventi, diario di sala | Chi lavora all'emergenza; l'archivio solo a chi ha il permesso | Storico inalterabile |
| Materiale in carico | La persona, il magazzino | Verbali firmati cifrati |
| Registro delle operazioni | Gli amministratori | Non si modifica dall'applicazione |

### 2.4 Dove stanno i dati e chi altro li tocca

I dati stanno sul server dell'associazione: database PostgreSQL, file caricati
e backup. ORION non ha un servizio centrale: lo sviluppatore non riceve né
vede i dati delle associazioni.

Sui telefoni l'app tiene, cifrati con una chiave del portachiavi hardware,
quello che serve per lavorare senza rete (contesto, intervento in corso,
profilo, materiale in carico, coda delle azioni). Visite, corsi e segreteria
non si tengono sul telefono. I documenti del gruppo segnati "sempre con me"
restano in chiaro nei file dell'app, perché li apre il visualizzatore del
telefono, e si cancellano all'uscita.

| Destinatario esterno | Cosa riceve | Ruolo | Necessario |
|---|---|---|---|
| Chi ospita il server | Tutto, a livello di macchina | Responsabile del trattamento (art. 28): [DA COMPILARE: nome e contratto] | Sì, se il server non è dell'associazione |
| Fornitore della posta (SMTP) | Indirizzi email e testo dei messaggi (attivazione, recupero password, avvisi di scadenza) | [DA COMPILARE: nome e ruolo] | Facoltativo; senza, i link si consegnano a mano |
| Google Firebase | L'identificativo del telefono e un segnale "c'è una novità", mai il contenuto delle notifiche | [DA COMPILARE: valutare se attivarlo] | Facoltativo, spento di base |
| Servizi di mappa (OpenStreetMap, ArcGIS per il satellitare) | Le zone di mappa visualizzate e l'indirizzo IP di chi guarda | Fornitori indipendenti | Sì per la mappa; la cartografia del territorio si può scaricare sul server |
| Ricerca indirizzi (Photon, Nominatim) | Gli indirizzi scritti nella ricerca della mappa | Fornitori indipendenti | Sì per la ricerca |
| Calcolo del percorso (OSRM) | Le coordinate di partenza e di arrivo di un percorso chiesto in sala | Fornitore indipendente | Facoltativo, solo quando si chiede il percorso |
| GitHub | Nessun dato personale: il server controlla se c'è una versione nuova | Nessuno | Facoltativo |
| Bollettino di allerta DPC | Nessun dato personale | Nessuno | Facoltativo |

Ai servizi di mappa e di ricerca non arrivano nomi di persone: solo luoghi e
l'indirizzo IP del computer della sala. [DA COMPILARE: valutare se è
accettabile o se servono alternative]

### 2.5 Conservazione

| Dati | Cosa fa il software | Decisione dell'associazione |
|---|---|---|
| Anagrafica, sanitari, materiale | Restano finché un amministratore non elimina la persona; allora si cancellano dati personali e file e resta solo il nome dove serve allo storico | [DA COMPILARE: proposta, eliminazione entro un anno dall'uscita dall'associazione] |
| Visite e certificati scaduti | Restano nel fascicolo | [DA COMPILARE: per quanto tenerli] |
| Emergenze, segnalazioni, diario, registro squadre | Restano nell'archivio, inalterabili | [DA COMPILARE: proposta, il tempo richiesto dalla documentazione di protezione civile] |
| Ultima posizione di ogni squadra | Si cancella alla chiusura dell'emergenza | Confermare |
| Registro delle operazioni (con indirizzo IP) | Non scade, finché non si imposta `ORION_REGISTRO_GIORNI`; allora le voci più vecchie escono ogni notte, e la catena d'integrità annota quali | [DA COMPILARE: proposta, 730 giorni] |
| Notifiche | Lette 30 giorni, non lette 90 | Confermare |
| Backup del database | 30 giorni (`ORION_BACKUP_RETENTION_DAYS`) | Confermare; le copie tenute altrove seguono la stessa regola |
| Accesso con impronta sul telefono | 90 giorni dall'ultimo uso | Confermare |
| Ricezione degli avvisi sul telefono | 180 giorni dall'ultimo uso | Confermare |
| Accessi esterni temporanei | Finiscono con l'emergenza | Confermare |
| Link di attivazione e di recupero | 7 giorni e 1 ora, validi una volta | Confermare |
| Richieste di conferma d'accesso al telefono | 2 minuti, solo in memoria | Confermare |


## 3. Necessità e proporzionalità

**Minimizzazione.** La posizione si raccoglie solo durante un'emergenza aperta,
solo da chi è in una squadra, e se ne tiene l'ultima per squadra, non lo
storico dei movimenti. I dati sanitari non si tengono sul telefono. Gli esterni
vedono solo quello che serve all'emergenza e il loro accesso finisce con essa.
I QR dei tesserini si possono spegnere. [DA COMPILARE: indicare quali campi
dell'anagrafica l'associazione usa davvero; quelli che non servono si lasciano
vuoti]

**Informazione.** Al primo accesso, e a ogni loro modifica, ORION mostra le
condizioni d'uso e registra chi le ha accettate, quando e su quale testo
(l'impronta del testo resta nel registro). [DA COMPILARE: l'informativa
dell'associazione, dove si trova e come si consegna a chi non usa ORION, come
i segnalanti]

**Diritti.**

| Diritto | Come si esercita |
|---|---|
| Accesso | Il profilo mostra i propri dati; il fascicolo in PDF li raccoglie |
| Rettifica | I dati anagrafici si modificano dal profilo; il resto lo corregge la segreteria |
| Cancellazione | Eliminazione della persona da Gestione utenti, con le eccezioni dello storico |
| Limitazione | Sospensione dell'account |
| Opposizione e portabilità | [DA COMPILARE: chi riceve la richiesta e come risponde] |

Contatto per le richieste: [DA COMPILARE]


## 4. Rischi

Per ogni evento la gravità e la probabilità si valutano su quattro livelli
(trascurabile, limitata, importante, massima), prima e dopo le misure. I
valori sono proposte da confermare.

| Evento | Da dove può venire | Cosa subisce la persona | Prima delle misure | Dopo le misure |
|---|---|---|---|---|
| Accesso illegittimo ai dati sanitari | Password rubata o indovinata, telefono perso, amministratore infedele, server violato | Discriminazione, imbarazzo, perdita di fiducia | Gravità importante, probabilità importante | [DA COMPILARE: proposta, gravità importante, probabilità limitata] |
| Accesso illegittimo ad anagrafica e posizioni | Le stesse, più un esterno che resta dentro | Contatti indesiderati, sapere dove si trova una persona | Gravità limitata, probabilità importante | [DA COMPILARE: proposta, limitata e limitata] |
| Modifica indesiderata | Errore o abuso di chi ha i permessi, attacco | Idoneità sbagliata, registro dell'emergenza falsato | Gravità importante, probabilità limitata | [DA COMPILARE: proposta, importante e trascurabile] |
| Perdita dei dati | Guasto del disco, ripristino sbagliato, chiave dei dati persa, ransomware | Storia di servizio e certificati persi | Gravità importante, probabilità limitata | [DA COMPILARE: dipende dai backup fuori sede] |


## 5. Misure

### 5.1 Misure del software

| Misura | Contro quale rischio |
|---|---|
| Password di almeno 12 caratteri, rifiutate se comuni o legate al nome; pausa per account dopo cinque errori | Password indovinate |
| Verifica in due passaggi (telefono collegato o codici a tempo, con codici di riserva), obbligatoria per amministratori e segreteria sanitaria | Password rubata |
| Ruoli e permessi controllati a ogni richiesta; sospensione e cambio password chiudono subito le sessioni | Accesso oltre il proprio ruolo |
| Cifratura AES-256 di certificati, documenti, foto, verbali, backup e, nel database, dell'esito delle visite; la chiave sta fuori dal database e dai backup, con una chiave di recupero | Furto di disco, di backup o di una copia del database |
| Posizioni delle squadre cancellate alla chiusura dell'emergenza; registro delle operazioni con scadenza configurabile | Conservazione oltre il necessario |
| Dati sul telefono cifrati con il portachiavi hardware; dati sanitari solo dopo impronta o PIN | Telefono perso |
| HTTPS, e TLS verso il database se è su un'altra macchina | Intercettazione |
| Registro delle operazioni e storico inalterabile con catena e sigilli | Modifiche nascoste |
| Avviso alla persona per ogni telefono nuovo collegato al suo account | Furto dell'account |
| Backup automatici prima di ogni aggiornamento e ripristino, e notturni con rotazione | Perdita |
| Eliminazione della persona con cancellazione di dati personali e file | Conservazione oltre il necessario |

### 5.2 Misure organizzative

| Misura | Chi se ne occupa | Stato |
|---|---|---|
| Server con sistema aggiornato, accesso SSH solo con chiave, firewall | [DA COMPILARE] | [DA COMPILARE] |
| Aggiornamenti di ORION applicati entro [DA COMPILARE: giorni] dall'uscita | [DA COMPILARE] | [DA COMPILARE] |
| Copia dei backup fuori dal server, con cadenza [DA COMPILARE] | [DA COMPILARE] | [DA COMPILARE] |
| Chiave di recupero stampata e custodita lontano dal server | [DA COMPILARE] | [DA COMPILARE] |
| Amministratori pochi e nominati, anche come amministratori di sistema | [DA COMPILARE] | [DA COMPILARE] |
| Revisione periodica di ruoli e account, con eliminazione di chi è uscito | [DA COMPILARE] | [DA COMPILARE] |
| Telefoni dei volontari con blocco schermo | [DA COMPILARE] | [DA COMPILARE] |
| Procedura per le violazioni: chi rileva, chi decide, chi notifica al Garante entro 72 ore | [DA COMPILARE] | [DA COMPILARE] |
| Contratti con chi ospita il server e con il fornitore della posta | [DA COMPILARE] | [DA COMPILARE] |
| Formazione di chi ha accesso ai dati sanitari | [DA COMPILARE] | [DA COMPILARE] |


## 6. Punti aperti trovati compilando

Questi punti nascono da come ORION funziona oggi. Per ciascuno l'associazione
decide se il rischio è accettabile, se servono misure organizzative o se
chiedere una modifica al software.

**Tipo e date delle visite in chiaro nel database.** L'esito (idoneo o no) e
i certificati sono cifrati; tipo di visita e date restano in chiaro perché
servono a calcolare le scadenze. Dicono che una persona ha fatto una visita, non
come è andata. Misura possibile in più: cifratura del disco del server.
[DA COMPILARE]

**Storico delle emergenze senza scadenza.** Note degli interventi, diario di
sala, registro delle squadre e movimenti del magazzino sono la documentazione
delle emergenze e non scadono da soli; si cancellano cancellando l'emergenza
dall'archivio. Il registro delle operazioni invece scade con
`ORION_REGISTRO_GIORNI`. [DA COMPILARE: tempo di conservazione dell'archivio
delle emergenze e chi lo applica]

**Servizi di mappa esterni.** Ricevono luoghi e l'indirizzo IP della sala.
[DA COMPILARE]

**Telefoni senza blocco schermo.** Su questi telefoni la chiave del telefono
non può chiedere impronta o PIN. [DA COMPILARE: richiedere il blocco schermo a
chi usa l'app]

**Integrità degli aggiornamenti.** ORION si aggiorna dalle release pubblicate
su GitHub, protette dall'account dello sviluppatore e da HTTPS, senza una
firma propria. [DA COMPILARE: accettare, oppure usare il manifesto con
l'impronta SHA-256 del pacchetto, o aggiornare solo dopo un controllo]


## 7. Conclusione

| Voce | Valore |
|---|---|
| Rischio residuo complessivo | [DA COMPILARE: proposta, accettabile con le misure indicate] |
| Serve la consultazione preventiva del Garante (art. 36) | [DA COMPILARE: proposta, no] |
| Parere del DPO | [DA COMPILARE] |
| Parere degli interessati o dei loro rappresentanti, se raccolto | [DA COMPILARE] |
| Approvazione del titolare (nome, data, firma) | [DA COMPILARE] |
