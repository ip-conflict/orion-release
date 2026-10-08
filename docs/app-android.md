# L'app Android: cosa le serve dal server

L'app usa le stesse rotte del web. Queste sono le sole che esistono per lei,
in `src/appMobile.js`.

## Contesto: `GET /api/app/contesto`

Una chiamata sola dice all'app chi è la persona e cosa può fare. L'app disegna
quello che trova qui e niente altro; le singole rotte restano comunque l'ultima
parola.

| Campo | Contenuto |
|---|---|
| `contratto` | Versione del formato di queste risposte. Cambia solo per modifiche che rompono. |
| `server` | Versione del server e nome dell'associazione. |
| `app` | Ultima versione dell'APK ospitata dal server e minima accettata (`null` se la cartella `app-android` è vuota). |
| `utente` | Id, username, nome, cognome, ruoli e `permessi` (dai ruoli e in più), che l'app mostra in "Il mio profilo". `magazzino.consegna` viene da `magazzino.consegne`, `magazzino.inventario` da `magazzino.gestione`, `segreteria` da `volontari.sanitario`. |
| `moduli` | Magazzino, Segreteria e Attività (`attivita`) accesi o spenti. |
| `capacita` | Cosa mostrare, ricavato dai permessi (src/permessi.js): `io`, `emergenza` (solo a chi è in una squadra; agli esterni sempre), `magazzino.consegna` e `magazzino.inventario` (dalla 3.32 solo magazziniere e amministratore, a magazzino acceso), `segreteria` (ruolo segreteria, a modulo acceso), `documenti` (l'archivio dei documenti del gruppo: agli interni sempre, agli esterni a emergenza aperta), `calendario` (agli interni, con il modulo Attività acceso), `emergenza.sala` (a chi è nella squadra COC, esterni compresi), `regia` (a chi conduce la simulazione aperta: organizzatori, responsabile e registi dell'attività). |
| `magazzino` | `conferma_dpi`, `verbale_consegna` (dalla 3.35) e `verbale_rientro` (dalla 3.33) per i DPI, `verbale_consegna_attrezzature` e `verbale_rientro_attrezzature` per attrezzature e mezzi, se il modulo è acceso. |
| `emergenza` | L'emergenza aperta, o `null`. C'è anche per chi non è in squadra (serve a "Le mie attività"): l'app la mostra solo con la capacità `emergenza`. `simulazione: true` per una simulazione in sala, con `attivita_id` dell'attività da cui nasce. |
| `squadra` | La squadra della persona, o `null`; `coc: true` per la squadra della sala. |
| `funzioni` | Dalla 1.1.0: `{ "mie": [{ id, sigla, nome, referente, aperti }] }`, le funzioni di supporto attive di cui la persona fa parte, con gli incarichi non conclusi dell'emergenza aperta; `null` a modulo spento. |
| `notifiche` | Quante non lette, e ogni quanti minuti controllare la coda ad app chiusa. |

### Gli esterni nell'app

Un esterno (ruolo `esterno`) ha nell'app la capacità `emergenza`, e a
emergenza aperta `documenti` per quelli segnati come consultabili in
emergenza: vede
l'emergenza e, se è in una squadra, ne manda la posizione e ne riceve gli
interventi. Note, foto e "sposta qui" solo sugli interventi assegnati alla sua
squadra (dalla 3.37 anche note e coordinate; prima lo erano solo le foto):
sugli altri `403`. Del magazzino gli restano `in-carico/persona/<sé>` e i
propri verbali; le altre rotte `/api/magazzino` rispondono `403`.
Il contesto dice se è un **esterno temporaneo** (`utente.temporaneo`, con
`utente.ente`).

### Esterni temporanei (dalla 3.32)

Creati dal centro operativo durante un'emergenza con un nome (e se si vuole
ente, squadra, email): vedi `src/esterniTemporanei.js`.

- `POST /api/accesso-temporaneo` `{ codice }` (pubblica, come il login): la
  stessa risposta del login. Il codice arriva come QR o link
  `https://<server>/accesso.html?c=<codice>`; l'app lo legge dal QR
  («Accedi con un codice») o dal link `orionmobile://accesso?server=...&c=...`
  che la pagina d'accesso propone sui telefoni Android.
- Alla chiusura dell'emergenza (o a una revoca) l'utente si disattiva, esce
  dalla squadra, codice e sessioni non valgono più; le richieste rispondono
  `403` con `sessione_terminata: true` e `motivo: "accesso_temporaneo_finito"`.
- Dalla 1.0.3 del server: `GET /api/esterni-temporanei/:id/codice` rimostra
  codice e link (`409` con `rigenera: true` se non si può), `POST .../:id/invia`
  `{ email }` lo rimanda per email, `PUT .../:id/persona` `{ nome, ente, email }`
  cambia la persona: il codice vecchio smette di valere e le sessioni di chi
  c'era prima si chiudono (`401`). Solo operatori interni.
- L'app non propone il collegamento col logo agli accessi temporanei.

## Libretto: i corsi

`GET /api/users/:id/libretto` restituisce per ogni corso anche `course_code` e
`validity_months` (dalla 3.32). L'attestato (`document_url`) si scarica da
`/api/documents/certificates/...` con la sessione della persona a cui appartiene.

## Notifiche

Una coda per persona, sul server dell'associazione: nessun servizio esterno,
nessun account altrove.

- `GET /api/notifiche?dopo=<id>`: le notifiche dopo l'ultima vista, in ordine
  crescente. Senza `dopo`, le ultime 50.
- `POST /api/notifiche/lette` con `{ "fino_a": id }` oppure `{ "ids": [...] }`.

L'app le riceve in tre modi:

- **ad app attiva** dal WebSocket, come messaggio `{ "action": "notifica", "notifica": {...} }`,
  mandato solo alle connessioni di quella persona;
- **ad app chiusa, con gli avvisi sempre attivi** (di base) dal collegamento
  del servizio "Avvisi attivi", aperto con il token degli avvisi;
- **comunque** controllando la coda da sola ogni `controllo_minuti`, con lo
  stesso token: e' la rete di sicurezza, che Android puo' rimandare.

### Il token degli avvisi

- `POST /api/app/avvisi` `{ dispositivo, precedente }` (con la sessione):
  `{ avvisi, giorni }`. `precedente` e' il token di prima, che smette di valere.
- `DELETE /api/app/avvisi` `{ avvisi }`: all'uscita dall'app.
- `GET /api/avvisi/notifiche?dopo=<id>` con `Authorization: Avvisi <token>`:
  come `GET /api/notifiche`. Un token non valido da' `401` con
  `avvisi_revocati: true`, mai `sessione_terminata`: la sessione non c'entra.
- WebSocket con `Authorization: Avvisi <token>`: passano solo i messaggi
  `notifica`; il server manda un ping ogni due minuti.
- `GET /api/app/avvisi/stato` (con la sessione): `{ collegato, ultimo, telefoni }`.
- `POST /api/notifiche/prova` `{ ritardo }` (secondi, fino a 120): una
  notifica `prova` a se stessi; `409` se un'altra e' gia' in arrivo.

Il token resta valido a sessione scaduta: e' quello che fa arrivare gli
avvisi a chi non apre l'app da giorni. Smette di valere con l'uscita, con il
cambio password (chiusura delle sessioni) e con la sospensione della persona;
l'app allora lo dimentica e, alla prossima sessione, ne chiede un altro.

Il `titolo` finisce sulla schermata di blocco e non dice mai cosa riguarda
(nessun dato sanitario); il `testo` si mostra solo dentro l'app.

Ogni notifica ha una `categoria` e può avere una scadenza `scade_il`
(dalla 3.32): passata quella, non compare più né in `GET /api/notifiche` né
nel conteggio, e la pulizia la cancella il giorno dopo. Le lette si
cancellano dopo 30 giorni, le mai lette dopo 90.

| Tipo | Categoria | Quando | Riferimento | Vale fino |
|---|---|---|---|---|
| `in_squadra` | `emergenza` | Ingresso in una squadra durante un'emergenza, o apertura di un'emergenza per chi è già in squadra (non c'è più l'avviso a tutti, `emergenza_aperta`) | `squadra` | uscita dalla squadra, cambio di squadra, chiusura dell'emergenza (al massimo 72 ore) |
| `intervento_assegnato` | `emergenza` | Squadra mandata su un intervento, ai suoi membri | `intervento` | squadra tolta, intervento chiuso, fine emergenza (al massimo 24 ore) |
| `dpi_da_confermare` | `personale` | Consegna con verbale a una persona, se `conferma_dpi` è acceso | `verbale` | conferma, o foto del foglio firmato |
| `scadenza` | `personale` | Controllo notturno delle scadenze, con la Segreteria accesa e l'avviso ai volontari attivo | `libretto` | 30 giorni, o l'avviso successivo per la stessa voce |
| `segreteria_riepilogo` | `segreteria` | Controllo del mattino, a segreteria e amministratori | `segreteria` | 7 giorni, o il riepilogo successivo con numeri diversi |
| `magazzino_riepilogo` | `magazzino` | Controllo del mattino, a magazzinieri e amministratori | `magazzino` | come sopra |
| `incarico_funzione` | `emergenza` | Incarico dato a una funzione di supporto, ai suoi membri (dalla 1.1.0) | `intervento` | chiusura dell'emergenza |
| `prova` | `personale` | "Manda una prova" dall'app (`POST /api/notifiche/prova`), a sé stessi | — | un'ora |

`notifiche.controllo_minuti` nel contesto vale 60, e 15 mentre un'emergenza è
aperta: l'app ripianifica il controllo quando cambia.

Sul telefono ogni categoria ha il suo canale Android (Emergenza, Avvisi,
Segreteria, Magazzino), che la persona può silenziare a parte. Gli avvisi di
emergenza presi dalla coda sostituiscono quello che l'app ha già dato da sé,
e toccando una notifica si apre la schermata dove la cosa si guarda.

## WebSocket: cosa arriva all'app

Il web riceve tutto: in emergenza tutte le postazioni devono vedere lo stesso
quadro. L'app si presenta con l'intestazione `X-Orion-Client: app` e riceve
solo quello che riguarda chi la usa:

- sempre: `notifica` (le sue), `emergency_status_change` (l'apertura solo a chi
  è in una squadra e agli esterni, la chiusura a tutti), `emergency_deleted`,
  `reload_squadre`, `branding_updated`, e dalla 1.1.0 `reload_incarichi`,
  `reload_funzioni`, `reload_mappa` (solo "rileggi": i dati li chiede l'app);
- `reload_reports` e `new_report_update` solo per le segnalazioni assegnate
  alla sua squadra, e per quelle che ha gia' ricevuto (cosi' sa anche quando
  la squadra viene tolta o la segnalazione chiusa);
- niente posizioni delle squadre, niente documenti, niente segnalazioni altrui.

Un client che non manda l'intestazione riceve tutto, come il web. Prova:
`npm run test:websocket`.

## Documenti del gruppo (app 1.2.0)

Con la capacità `documenti` la home ha la voce Documenti. L'app legge
`GET /api/documenti` (cartelle, documenti con l'ultima versione, impronta
SHA-256 e beni collegati: il server manda solo quelli che la persona può
vedere) e apre il file da `GET /api/documenti/{id}/file` con il
visualizzatore del telefono. I documenti con `sempre_con_me` li scarica a
ogni aggiornamento con la rete in `files/documenti-gruppo/<id>-<impronta>/`,
tenendoli solo se l'impronta del file scaricato è quella dell'elenco; una
versione nuova ha un'altra impronta, quindi un'altra cartella, e la vecchia
si toglie quando la nuova è arrivata. L'elenco si salva cifrato con il nome
di chi l'ha scaricato; tutto si cancella all'uscita e quando entra un'altra
persona, non con la sessione scaduta. Caricare e organizzare si fa dal web.

I libretti collegati a un bene (`GET /api/documenti?bene=ID`) si vedono nella
scheda del bene del magazzino e in quella di un bene in carico in Io, e si
aprono con `Contenitore.apriDocumentoGruppo()`: la copia sul telefono se è
l'ultima, altrimenti dal server, e senza rete la copia vecchia se c'è.
I documenti con `in_carico` (collegati a qualcosa che la persona o la sua
squadra ha in carico) si scaricano come quelli `sempre_con_me` e si cancellano
quando il server non li segna più; l'elenco si rilegge anche alla notifica di
una consegna (`dpi_da_confermare`) e alla messa in squadra.

## Calendario, convocazioni e presenze (app 1.2.0)

Con la capacità `calendario` la home ha la voce Calendario, con il numero
delle convocazioni senza risposta (`GET /api/attivita/da-rispondere`, riletto
all'avvio e a ogni notifica con riferimento `attivita`). L'agenda legge
`GET /api/calendario?da&a` un mese alla volta, con gli stessi filtri del web
(`filtri` dice quali scadenze la persona può vedere); la scheda di
un'attività viene da `GET /api/attivita/{id}` e la risposta va a
`POST /api/attivita/{id}/risposta` (`{ risposta: "si" | "no", nota }`; il 409
con `posti_esauriti` diventa un messaggio). Le notifiche `convocazione`,
`attivita_cambiata` e `attivita_annullata` aprono il calendario sulla scheda
dell'attività. "Le mie presenze" legge `GET /api/presenze/mie?anno` e scarica
l'attestato da `GET /api/presenze/{id}/attestato` come gli altri PDF.
Niente di tutto questo si salva sul telefono. Organizzare e chiudere le
attività si fa dal web.

## Chiamata, assenze, simulazione e regia (app 1.2.0)

La chiamata della sala arriva come notifica `chiamata`, categoria
`emergenza`, con riferimento `chiamata`: il tocco apre la schermata Chiamata
e non quella dell'emergenza. L'app tiene le chiamate aperte
(`GET /api/chiamate/mie`) e le rilegge all'avvio, a ogni notifica con quel
riferimento e quando cambia l'emergenza. Una chiamata senza risposta, o in
arrivo, sta in cima alla home. La risposta va a
`POST /api/chiamate/{id}/risposta` (`{ risposta: "arrivo" | "ritardo" | "no",
minuti }`), l'arrivo a `POST /api/disponibilita/arrivato` (vuoto in
emergenza, con `attivita_id` per un allertamento). Le assenze si leggono da
`GET /api/assenze/mie`, si segnano con `POST /api/assenze` (`{ dal, al,
nota }`, date ISO) e si tolgono con `DELETE /api/assenze/{id}`; la schermata
si apre dalla chiamata e dal simbolo in alto nel calendario.

Con `emergenza.simulazione` la fascia dell'emergenza diventa viola e dice
SIMULAZIONE con il codice; i titoli delle notifiche arrivano già con
`[SIMULAZIONE]` dal server. Con la capacità `regia` la home ha "Regia:
osservazioni": la schermata legge `GET /api/regia` (l'attività, l'orologio
dello scenario e le osservazioni) e scrive con
`POST /api/attivita/{id}/osservazioni` (`{ testo }`). Il resto della regia
(il copione, gli eventi, la valutazione) è del web.

## Squadra COC: la sala sul telefono (app 1.2.0)

Con la capacità `emergenza.sala` la voce Emergenza apre la sala operativa
invece della scheda dell'intervento: tutte le segnalazioni aperte
(`GET /api/reports?emergency_id&status_type=active`), le alte prima, e per
ognuna il dettaglio con il diario, la navigazione, la chiamata al segnalante
e le note, che senza rete vanno in coda come le altre. L'elenco si rilegge
ogni minuto e con il pulsante in alto. Assegnare le squadre resta del centro
operativo. Chi è nella squadra COC non manda la posizione: il tracciamento
non parte, e il server risponderebbe comunque 409 `squadra_coc`.

## Funzioni di supporto e strade chiuse (dalla 1.1.0)

L'app non ha rotte sue per le funzioni: usa quelle del web. "Le mie attività"
legge `GET /api/incarichi?stato=tutti` (a un operatore interno arrivano tutti,
e l'app tiene solo quelli delle funzioni del contesto), prende con
`POST /api/incarichi/:id/presa`, conclude con `POST /api/incarichi/:id/concludi`
e `{ "esito": "..." }`, e scrive nel diario con
`POST /api/reports/:id/updates` e `{ "update_text", "funzione_id" }`. La
notifica `incarico_funzione` apre questa schermata; `reload_incarichi` fa
rileggere l'elenco e il contesto, `reload_funzioni` solo il contesto.

La schermata Emergenza legge `GET /api/mappa/elementi`: elenca le strade
chiuse e le zone dell'emergenza (aprendole nelle mappe del telefono con un
indirizzo `geo:`) e avvisa se il punto dell'intervento cade dentro una zona di
pericolo del piano o una zona interdetta. `reload_mappa` la fa rileggere.

## Impronta: token di rinnovo

Con l'impronta l'app non sblocca la password (che non tiene più), ma un token
di rinnovo legato a quel telefono.

- `POST /api/app/rinnovo` (con la sessione): crea un token di rinnovo, lo
  restituisce una volta sola (`{ rinnovo, giorni }`); il server ne tiene solo
  l'impronta SHA-256. Al massimo cinque per persona. Un accesso temporaneo
  riceve `403` (dalla 3.37): rientra con il codice.
- `POST /api/app/rinnovo/accesso` (senza sessione, limitata come il login):
  `{ rinnovo }` in cambio di una sessione, con la stessa risposta del login.
  Ogni uso sposta la scadenza di novanta giorni. Token sconosciuto, scaduto o
  revocato: 401 con `rinnovo_non_valido: true`.
- `DELETE /api/app/rinnovo` (con la sessione): `{ rinnovo }`, lo revoca.

Cambiare o reimpostare la password cancella tutti i token di rinnovo e chiude
tutte le sessioni (tranne quella di chi la cambia, che riceve un token nuovo).

## Caposquadra e posizione della squadra (dalla 1.1.0, app 1.2.0)

Nel contesto, `squadra` ha anche `caposquadra` (`{ username, nome, cognome }`
o null) e `sono_caposquadra`. Nominato, il caposquadra riceve la notifica
`caposquadra` (categoria emergenza).

`POST /api/location` risponde `{ accettata: true }` quando la posizione è
stata presa, e `{ accettata: false, inviata_da: { nome, cognome, caposquadra } }`
quando la squadra la sta mandando un altro telefono. Il server prende quella
del caposquadra, poi quella di chi la sta già mandando, e fa subentrare un
altro membro dopo tre minuti di silenzio. Per questo l'app continua a
mandarla anche quando non è presa, e rimanda l'ultima posizione ogni minuto
anche da ferma.

## Verifica in due passaggi (dalla 1.1.0, app 1.2.0)

A chi ha la verifica attiva, `POST /login` con la password giusta risponde 401
con `{ mfa: "codice", sfida, message }` e nessun token. L'app chiede il codice
(sei cifre, o un codice di riserva di dieci caratteri) e lo manda a
`POST /api/accesso/mfa` con `{ sfida, codice }`: la risposta riuscita è quella
del login, più `codici_riserva_rimasti` se si è usato un codice di riserva. Un
codice sbagliato dà 401 con il messaggio e la sfida resta buona; dopo cinque
errori, o dopo cinque minuti, il 401 porta `sfida_scaduta: true` e si rifà
l'accesso con la password. Un amministratore che non ha ancora attivato la
verifica riceve `mfa: "attivazione"`: l'app gli dice di farlo dal browser.

Un token di rinnovo creato da una sessione nata con la verifica fa entrare
senza codice. Uno nato senza, per chi la deve fare, dà 401 con
`rinnovo_non_valido`. Un amministratore la cui sessione non porta la
verifica riceve, su qualsiasi rotta, 401 con `sessione_terminata` e motivo
`mfa_richiesta`.

## Condizioni d'uso (app 1.2.0)

Finché la persona non ha accettato la versione in vigore delle condizioni
d'uso, ogni rotta risponde `428` con `informativa_da_vedere: true` (e
`versione`), tranne `GET /api/informativa` e `POST /api/informativa/presa-visione`.
L'app lo riconosce in `IntercettoreSessione`, che non chiude la sessione ma
avvisa `GestoreSessione.informativaDaVedere` (solo se la risposta riguardava
il token di adesso): al posto dell'app compare la schermata delle condizioni,
con la casella per accettarle. L'accettazione manda `{ "versione": n }` (un
409 vuol dire che è uscita una versione nuova: si ricarica il testo e si
rilegge); poi l'app riparte e rilegge contesto, notifiche e il resto con
`aggiornaTutto()`. Dal Mio profilo il testo si rilegge in sola lettura. È
testo semplice: `# ` titolo, `## ` capitolo, una riga vuota fra i paragrafi.
I nomi vengono da quando c'era anche l'informativa sul trattamento dei dati:
se un server la manda (`informativa` non vuota) l'app la mostra sopra le
condizioni, con una seconda casella.

L'app 1.1.0 non conosce il `428`: chi la usa e non ha ancora accettato vede
solo errori. Il server non la distingue dalla 1.2.0, perché `X-Orion-Client`
non porta la versione, e non le fa eccezioni. Per questo il server con le
condizioni d'uso si aggiorna insieme all'APK 1.2.0, e ai volontari si chiede
di aggiornare l'app; chi non può farlo subito accetta una volta dal browser, e
da lì anche la 1.1.0 torna a funzionare.

## Tesserino

`GET /api/public/volunteer/:token` risponde a chiunque durante un'emergenza
aperta (o se l'amministratore ha acceso la verifica sempre attiva); fuori da
quelle condizioni solo a chi ha una sessione valida, di qualunque livello.
L'app la chiama con il suo token e mostra il tesserino senza aprire il
browser.

## Magazzino: le rotte in piu' per l'app

- `GET /api/magazzino/verbali/miei` (anche `?stato=da_confermare`): i verbali
  di consegna della persona collegata, con le loro righe. Solo i propri: la
  rotta non accetta identificativi, quindi non c'e' modo di chiedere quelli di
  un altro.
- `POST /api/magazzino/consegna` a una persona produce il verbale riga per
  riga, secondo il tipo di bene. I DPI ci entrano con `conferma_dpi` acceso
  (sempre) oppure con `verbale_consegna` e `verbale: true` nella richiesta;
  attrezzature e mezzi solo con `verbale_consegna_attrezzature` e
  `verbale: true`, mai per la sola conferma dei DPI. `verbale` e' quindi la
  scelta di chi consegna, non serve mandarlo per la conferma. Se nessuna riga
  ci entra la risposta ha `verbale_id: null`. Il rientro fa lo stesso con
  `verbale_rientro` e `verbale_rientro_attrezzature`.
- `POST /api/magazzino/verbali/:id/conferma` compila il verbale: lo salva con
  `confermato_da` (nome e cognome), `confermato_il`, `conferma_canale`
  (`app` se la richiesta porta `X-Orion-Client: app`, che l'app manda su
  tutte le richieste al suo server, altrimenti `web`) e `conferma_impronta`
  (SHA-256 di verbale, persona, ora e righe), e risponde con questi dati.
- `POST /api/magazzino/consegna` accetta l'intestazione `Idempotency-Key`
  (8-100 caratteri fra lettere, cifre, `-` e `_`). La stessa chiave con lo
  stesso corpo restituisce la stessa risposta senza registrare di nuovo;
  con un corpo diverso risponde 422. La chiave e' della persona che la usa e
  si conserva 7 giorni. Senza intestazione, come prima.
- `POST /api/magazzino/verbali/:id/scansione` (dalla 3.32, solo magazziniere):
  la foto o il PDF del foglio firmato, nel campo multipart `scansione`, fino a
  20 MB. Il verbale passa a `firmato_cartaceo` (uno gia' `confermato` resta
  tale); una seconda foto sostituisce la prima. Si rilegge da
  `GET /api/magazzino/verbali/:id/scansione`, con i permessi del verbale.
  L'app la offre subito dopo una consegna riuscita (non a una consegna ancora
  in coda: non ha ancora un numero di verbale).
- `GET /api/magazzino/in-carico/{persona|squadra|veicolo}/:id` e
  `POST /api/magazzino/rientro` servono al rientro dall'app (magazziniere e
  amministratore): `{ da: { tipo, id }, verbale, righe: [{ bene_id, quantita,
  resto, km }] }`, con `resto` (`in_carico`, `consumo`, `perso`) obbligatorio
  quando di un materiale a quantità ne torna meno di quanto era fuori, e `km`
  sempre facoltativo. `verbale: true` produce il verbale solo se il magazzino
  ha acceso `verbale_rientro` (dalla 3.33, spento di base; il contesto lo
  riporta in `magazzino.verbale_rientro`); spento, la richiesta lo ignora.
- I verbali hanno un `tipo` (`consegna` o `rientro`). Quelli di rientro nascono
  `da_firmare` e non si confermano dal telefono.
- Dalla 3.38 la consegna va solo a una persona: `destinatario.tipo` diverso
  da `persona` risponde 400, anche su `POST /api/magazzino/movimenti` per
  `consegna` e `trasferimento`. `GET /api/magazzino/destinatari` elenca
  squadre e mezzi solo se hanno ancora materiale in carico, che deve poter
  rientrare. L'app consegna ogni tipo di bene (`GET /api/magazzino/beni?disponibili=1`).
- Scelta la persona, l'app chiede `GET /api/magazzino/taglie/persona/:id`
  (dalla 1.2.0): una riga per DPI a taglie con `modello_id`, `taglia`,
  `modello`, `dedotta` e, per le dedotte, `da_modello`. Per un DPI ricevuto
  la taglia è quella ancora in carico o, se non ne ha, l'ultima consegnata;
  per uno mai ricevuto è dedotta da un DPI dello stesso `gruppo_taglia`
  (`busto`, `pantaloni`, `scarpe`; senza gruppo niente), se quella taglia
  esiste anche per lui. Il gruppo si legge in `GET /api/magazzino/modelli` e
  si scrive in `POST` e `PUT /api/magazzino/modelli` (nel `PUT`, `""` lo
  toglie, assente lo lascia). La variante del catalogo con lo
  stesso `modello_id` e la stessa `taglia` (senza badare a maiuscole) è in
  verde; sotto il nome si elencano solo le non dedotte. Se la rotta non
  risponde la consegna procede senza.
- Il modulo Magazzino dell'app (capacità `magazzino.inventario`) usa le
  stesse rotte della pagina web, senza rotte proprie: `beni`, `beni/:id`,
  `beni/:id/interventi`, `movimenti`, `modelli` (con `modelli/:id/carico`),
  `chi-ha-cosa`, `scadenze`, `da-recuperare`, `verbali`, `config`,
  `categorie`, `ubicazioni`, `avvisi` e `avvisi/prova`. Le richieste portano
  sempre tutti i campi: un campo assente, per queste rotte, vuol dire "lascia
  com'è". Per togliere la categoria a un DPI a taglie l'app manda
  `categoria_id: 0`, che il server legge come nessuna.
- Il riepilogo del mattino (`magazzino_riepilogo`) nell'app apre le scadenze
  del magazzino, per chi ha l'inventario; gli altri lo aprono sul web.

## Materiale a quantita': chi ha cosa

Dalla migrazione 25 i rientri, i consumi, gli smarrimenti e le dismissioni
dal campo dicono da quale detentore escono (`proveniva_user_id`,
`proveniva_squadra_id`, `proveniva_bene_id`), e la vista `detenzioni_sfusi`
somma per detentore. `POST /api/magazzino/rientro` accetta `da: { tipo, id }`
(il web lo manda); senza, se il bene e' in mano a piu' detentori risponde 400.

## Rete scarsa (app 1.2.2)

Le note e le foto dell'intervento partono con `Idempotency-Key`: la nota
prima prova subito con una chiave nuova e, se la rete cade, va in coda con
la stessa; le foto in coda usano la chiave dell'azione. Il server riconosce
il reinvio e non scrive due volte, anche quando la prima richiesta era
arrivata e si era persa solo la risposta.

La posizione della squadra porta `eta_ms`, da quanto il GPS l'ha rilevata
(da `elapsedRealtimeNanos`, non dall'orologio del telefono). Se l'invio non
riesce, `ServizioPosizione` la segna come rimasta indietro e la manda appena
Android dice che la rete è tornata (`registerDefaultNetworkCallback`), oltre
al segnale di ogni minuto. Il server la scrive con l'ora vera del
rilevamento e non la fa passare sopra a una più recente.

## APK

`GET /app/orion.apk` scarica l'app senza accesso. Vedi `app-android/README.md`.

L'amministratore decide se l'app è a disposizione del personale
(Impostazioni → App Android, chiave `app_android_enabled`; mai toccata vuol
dire sì). Spenta, l'APK risponde 404, il contesto riporta `app: null` (l'app
non propone aggiornamenti) e il web non la propone; chi l'ha già installata
continua a usarla.

Dalla 1.2.1 l'app si aggiorna da sola (`aggiornamento/Aggiornatore.kt`).
Quando il contesto porta `app.ultima` maggiore della versione installata,
scarica `app.scarica` con il client dell'app in `files/aggiornamento`, e
prima di tenerlo controlla con il PackageManager che sia `it.orion.app`, che
il `versionCode` sia quello annunciato e più recente, e che la firma attuale
sia la stessa dell'app installata; altrimenti lo butta e lo dice. Poi lo
passa a una sessione di `PackageInstaller` con `USER_ACTION_NOT_REQUIRED`
(Android 12 e oltre): la prima volta Android chiede la conferma, e da lì in
poi, essendo ORION l'installatore di se stessa, non chiede più niente. Serve
il permesso `REQUEST_INSTALL_PACKAGES`, che la persona concede una volta nelle
impostazioni ("Consenti" nella home porta lì). La risposta dell'installatore
arriva a `RicevitoreInstallazione`: se serve la conferma, con l'app davanti si
apre subito, altrimenti arriva una notifica da toccare.

Quando si installa: mai con l'app davanti (la home propone "Aggiorna ora"),
ma appena la si lascia o al controllo ad app chiusa, e mai mentre la persona
è in una squadra con l'emergenza aperta. L'app resta bloccata sotto
`app.minima`. Ad app chiusa il controllo in background chiede il contesto al
massimo ogni 20 ore; la notifica locale "È disponibile ORION", una sola per
versione, resta per chi non ha ancora dato il permesso di installare.

## Il mio profilo

L'app usa le stesse rotte della pagina Profilo del web: `GET /api/users/me`
(con i dati anagrafici), `PUT /api/users/me/anagrafica`, `POST
/api/users/me/photo` (campo `photo`) e `POST /api/users/change-password`. Il
cambio password risponde 401 anche alla password attuale sbagliata: l'app lì
chiude la sessione solo se la risposta porta `sessione_terminata`. Andato a
buon fine, l'app tiene il token nuovo della risposta e dimentica il token di
rinnovo dell'impronta, che il server ha cancellato con `chiudiSessioni`. Il
fascicolo in PDF si scrive sul telefono con il libretto (`GET
/api/users/:id/libretto`); il server non ha rotte apposta.

## Proposta dopo l'accesso dal telefono

Chi accede al web da un telefono Android, dopo il login, si vede proporre
l'app: "Scarica l'app" o "Continua sul web". Il web chiede prima
`GET /api/app/offerta`, che risponde `disponibile: true` (con versione e
indirizzo dell'APK) solo se l'app è a disposizione, l'APK c'è e la persona
non è un esterno. Chi sceglie il web non la rivede fino alla versione
successiva. Da iPhone e dal computer non compare niente.
