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
| `utente` | Id, username, nome, cognome, ruoli. |
| `moduli` | Magazzino e Segreteria accesi o spenti. |
| `capacita` | Cosa mostrare: `io`, `emergenza`, `magazzino.consegna` e `magazzino.inventario` (dalla 3.32 solo magazziniere e amministratore, a magazzino acceso), `segreteria` (ruolo segreteria, a modulo acceso). |
| `magazzino` | `conferma_dpi`, `verbale_consegna` (dalla 3.35) e `verbale_rientro` (dalla 3.33), se il modulo è acceso. |
| `emergenza` | L'emergenza aperta, o `null`. |
| `squadra` | La squadra della persona, o `null`. |
| `notifiche` | Quante non lette, e ogni quanti minuti controllare la coda ad app chiusa. |

### Gli esterni nell'app

Un esterno (ruolo `esterno`) ha nell'app la sola capacità `emergenza`: vede
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

L'app le riceve in due modi:

- **ad app attiva** dal WebSocket, come messaggio `{ "action": "notifica", "notifica": {...} }`,
  mandato solo alle connessioni di quella persona;
- **ad app chiusa** controllando la coda da sola ogni `controllo_minuti`.

Il `titolo` finisce sulla schermata di blocco e non dice mai cosa riguarda
(nessun dato sanitario); il `testo` si mostra solo dentro l'app.

Ogni notifica ha una `categoria` e può avere una scadenza `scade_il`
(dalla 3.32): passata quella, non compare più né in `GET /api/notifiche` né
nel conteggio, e la pulizia la cancella il giorno dopo. Le lette si
cancellano dopo 30 giorni, le mai lette dopo 90.

| Tipo | Categoria | Quando | Riferimento | Vale fino |
|---|---|---|---|---|
| `emergenza_aperta` | `emergenza` | Apertura di un'emergenza, a tutti gli interni attivi | `emergenza` | chiusura dell'emergenza (al massimo 72 ore) |
| `intervento_assegnato` | `emergenza` | Squadra mandata su un intervento, ai suoi membri | `intervento` | squadra tolta, intervento chiuso, fine emergenza (al massimo 24 ore) |
| `dpi_da_confermare` | `personale` | Consegna con verbale a una persona, se `conferma_dpi` è acceso | `verbale` | conferma, o foto del foglio firmato |
| `scadenza` | `personale` | Controllo notturno delle scadenze, con la Segreteria accesa e l'avviso ai volontari attivo | `libretto` | 30 giorni, o l'avviso successivo per la stessa voce |
| `segreteria_riepilogo` | `segreteria` | Controllo del mattino, a segreteria e amministratori | `segreteria` | 7 giorni, o il riepilogo successivo con numeri diversi |
| `magazzino_riepilogo` | `magazzino` | Controllo del mattino, a magazzinieri e amministratori | `magazzino` | come sopra |

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

- sempre: `notifica` (le sue), `emergency_status_change`, `emergency_deleted`,
  `reload_squadre`, `branding_updated`;
- `reload_reports` e `new_report_update` solo per le segnalazioni assegnate
  alla sua squadra, e per quelle che ha gia' ricevuto (cosi' sa anche quando
  la squadra viene tolta o la segnalazione chiusa);
- niente posizioni delle squadre, niente documenti, niente segnalazioni altrui.

Un client che non manda l'intestazione riceve tutto, come il web. Prova:
`npm run test:websocket`.

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
- `POST /api/magazzino/consegna` a una persona produce il verbale se il
  magazzino ha acceso `conferma_dpi` (sempre) oppure `verbale_consegna` e la
  richiesta porta `verbale: true` (dalla 3.35; spento di base). Negli altri
  casi `verbale` viene ignorato e la risposta non ha `verbale_id`.
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

## APK

`GET /app/orion.apk` scarica l'app senza accesso. Vedi `app-android/README.md`.

L'amministratore decide se l'app è a disposizione del personale
(Impostazioni → App Android, chiave `app_android_enabled`; mai toccata vuol
dire sì). Spenta, l'APK risponde 404, il contesto riporta `app: null` (l'app
non propone aggiornamenti) e il web non la propone; chi l'ha già installata
continua a usarla.

Ad app aperta la home propone la versione nuova (`app.ultima` maggiore della
versione installata) e blocca l'app sotto `app.minima`. Ad app chiusa il
controllo in background chiede il contesto al massimo ogni 20 ore e, se c'è
una versione nuova, mostra una notifica locale, una sola per versione.

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
