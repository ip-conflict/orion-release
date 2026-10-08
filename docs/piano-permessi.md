# Dai ruoli ai permessi: il piano

Oggi ORION decide chi può fare cosa guardando il ruolo: amministratore,
segreteria, magazziniere, volontario, esterno. Funziona, ma ogni compito
nuovo che non coincide con un ruolo (chi tiene l'archivio dei documenti, chi
organizza gli addestramenti) costringe a scegliere fra darlo a un ruolo che
non c'entra o crearne uno nuovo per una cosa piccola.

Il piano: dentro ORION ogni controllo chiede un permesso, non un ruolo; i
ruoli restano, come pacchetti di permessi già pronti; l'amministratore può
dare a una persona anche singoli permessi in più. Per chi usa ORION non
cambia niente finché non si concede qualcosa in più a qualcuno.

## Le regole

I ruoli restano quelli di oggi e si assegnano come oggi. Ogni ruolo è un
insieme fisso di permessi, scritto nel codice e uguale in tutte le
associazioni: un magazziniere è un magazziniere ovunque.

I permessi in più si aggiungono e basta. Non si toglie a nessuno un pezzo
del suo ruolo: se una persona non deve avere tutto il pacchetto, le si dà
un ruolo più basso e i soli permessi che servono.

L'elenco è corto e pensato: dieci permessi, ognuno con un nome che dice
cosa permette di fare. Niente caselle per singole operazioni.

L'amministrazione del sistema non si delega: account, ruoli e permessi,
impostazioni, backup restano dell'amministratore. Chi può dare permessi
potrebbe darseli tutti.

Agli esterni non si concedono permessi: sono ospiti dell'emergenza.

Ogni concessione e ogni revoca finiscono nel registro delle operazioni, con
chi l'ha fatta e quando.

## Quello che ogni volontario fa già, senza permessi

Il ruolo Volontario è la base comune degli interni e resta com'è: lavorare
nel centro operativo durante un'emergenza (segnalazioni, squadre e
caposquadra, diario di sala, strade chiuse e zone dell'emergenza, accessi
esterni temporanei), il punto di situazione con il suo quadro, la rubrica
(leggerla e tenerla aggiornata), consegnare e far rientrare materiale dal
web, i propri dati (profilo, fascicolo, DPI in carico, verbali propri, app),
la consultazione dell'archivio dei documenti.

## Il catalogo dei permessi

### Emergenze

| Permesso | Nome | Cosa permette | Oggi |
|---|---|---|---|
| `emergenze.apertura` | Aprire e chiudere le emergenze | Aprire un'emergenza (con la scelta delle squadre da tenere) e chiuderla (con le strade da lasciare chiuse). Non eliminarla. | Amministratore |
| `emergenze.archivio` | Consultare le emergenze passate | L'archivio delle emergenze chiuse: resoconti, punto di situazione finale, segnalazioni, foto e documenti di emergenze non più aperte. | Amministratore |
| `emergenze.piano` | Gestire il piano di emergenza sulla mappa | Le zone di pericolo e gli altri elementi permanenti della mappa: metterli, cambiarli, importarli, cancellarli. | Amministratore |
| `emergenze.funzioni` | Organizzare le funzioni di supporto | Creare e cambiare le funzioni, decidere chi ne fa parte e chi è il referente. | Amministratore |

### Volontari

| Permesso | Nome | Cosa permette | Oggi |
|---|---|---|---|
| `volontari.anagrafica` | Gestire anagrafica e tesserini | L'elenco completo dei volontari con i contatti, i dati anagrafici, la foto, il tesserino; iscrivere i volontari nuovi. | Segreteria |
| `volontari.sanitario` | Gestire visite mediche e corsi | Visite e idoneità (dati sanitari), corsi e attestati, i cataloghi delle visite e dei corsi, il cruscotto delle scadenze e il suo riepilogo del mattino. | Segreteria |

Anagrafica e dati sanitari stanno separati di proposito: chi stampa i
tesserini non ha bisogno di vedere le visite mediche.

### Magazzino

| Permesso | Nome | Cosa permette | Oggi |
|---|---|---|---|
| `magazzino.gestione` | Gestire il magazzino | L'inventario: beni, modelli, categorie e ubicazioni, carichi, manutenzioni, dismissioni e rettifiche, le opzioni del modulo, i verbali di tutti, gli avvisi per email e il riepilogo del mattino. | Magazziniere |
| `magazzino.consegne` | Consegnare e far rientrare materiale | Consegne, rientri e trasferimenti, dal web e dall'app, con i loro verbali. | Magazziniere |

### Gruppo

Nascono con le funzioni nuove e non hanno un "oggi".

| Permesso | Nome | Cosa permette |
|---|---|---|
| `gruppo.documenti` | Gestire l'archivio dei documenti | Caricare, ordinare, sostituire e togliere i documenti, decidere chi li vede e quali sono consultabili in emergenza o "sempre con me" sul telefono. |
| `gruppo.attivita` | Organizzare attività e presenze | Creare le attività, convocare, registrare presenze e ore, chiuderle (con l'eventuale corso nel libretto), correggere le presenze in emergenza, leggere il riepilogo dell'anno. |

## I ruoli come pacchetti

| Ruolo | Permessi |
|---|---|
| Volontario | La base comune, nessun permesso del catalogo. |
| Coordinatore | Base, i quattro permessi delle emergenze, `gruppo.attivita`. |
| Segreteria | Base, `volontari.anagrafica`, `volontari.sanitario`. |
| Magazziniere | Base, `magazzino.gestione`, `magazzino.consegne`. |
| Amministratore | Tutti i permessi, più l'amministrazione del sistema. |
| Esterno | Nessuno: solo l'emergenza in corso, come oggi. |

I ruoli si sommano come oggi (una persona può essere segreteria e
magazziniere), e i permessi in più si sommano ai ruoli.

## Quello che resta all'amministratore

Non sono permessi del catalogo e non si concedono: creare e sospendere gli
account, assegnare ruoli e permessi, azzerare la verifica in due passaggi,
le impostazioni e i moduli, l'aspetto del tesserino, le condizioni d'uso,
la posta in uscita, il registro delle operazioni, la pagina Sistema (backup,
ripristino, aggiornamenti), eliminare un'emergenza.

## Decisioni prese

Consegne e rientri li fa il magazziniere o chi ha il permesso, dal web e
dall'app: prima dal web li faceva ogni volontario. Chi gestisce
l'anagrafica iscrive i volontari nuovi (solo come volontari) e legge il
libretto senza visite e corsi. La verifica in due passaggi è obbligatoria
anche per chi gestisce visite e corsi. C'è un ruolo Coordinatore con i
quattro permessi delle emergenze.

Fatto in ottobre 2026: server, web e app. `gruppo.documenti` è arrivato con
l'archivio dei documenti, ed è solo nel pacchetto dell'amministratore: agli
altri si dà come permesso in più. `gruppo.attivita` è arrivato con le
Attività, nel pacchetto del Coordinatore: così "il coordinatore" e "chi ha
il permesso" sono la stessa regola.

## Come si fa, a passi

Primo passo, il catalogo. Un modulo `src/permessi.js` con l'elenco dei
permessi (codice, nome, categoria, descrizione), i pacchetti dei ruoli e
`haPermesso(req, permesso)`; una tabella `utenti_permessi` (persona,
permesso, chi l'ha concesso e quando) per quelli in più. `authenticateToken`
legge i permessi in più nella stessa interrogazione dei ruoli, quindi una
concessione vale dalla richiesta successiva, senza rifare l'accesso.

Secondo passo, i controlli del server, uno per uno, senza cambiare il
comportamento: `checkAdminRole`, `checkSegreteriaAccess`,
`checkAdminOrSegreteriaRole`, `soloMagazziniere` e gli `haRuolo` sparsi
diventano `richiedePermesso(...)` o `haPermesso(...)`; quelli che riguardano
l'amministrazione del sistema diventano `soloAmministratore`. Sono circa 23
`haRuolo`, 50 `checkAdminRole`, una ventina di controlli di segreteria e
magazzino. Anche le interrogazioni che scelgono i destinatari per ruolo (i
riepiloghi del mattino, gli avvisi del magazzino per email) passano ai
permessi. Lo smoke test deve restare identico: è la prova che non è cambiato
niente.

Terzo passo, il web. L'accesso restituisce anche i permessi; menu, pagine e
pulsanti si mostrano per permesso invece che per ruolo. In Gestione utenti,
nella scheda di una persona, una sezione "Permessi in più" con le caselle
divise per categoria, accanto ai ruoli; per ogni casella si vede se il
permesso arriva già dal ruolo.

Quarto passo, l'app. Le capacità del contesto vengono dai permessi
(`magazzino.consegne`, `volontari.anagrafica` per la segreteria e così
via): l'app non cambia e non serve una versione nuova.

Quinto passo, prove e documenti. Un test nuovo (`tests/permessi.mjs`): per
ogni permesso, concederlo apre esattamente le sue rotte e revocarlo le
richiude; chi non è amministratore non concede niente, nemmeno a sé stesso;
a un esterno non si concede niente. Poi manuale d'uso, manuale tecnico,
collaudo e sicurezza.

Dopo questo, l'archivio dei documenti nasce già con `gruppo.documenti` e le
Attività con `gruppo.attivita`.
