# Manutenzione dall'applicazione: backup, ripristino, aggiornamenti

Documento di lavoro. Racconta perché la pagina **Sistema** è fatta così, cosa
fa e cosa di proposito non fa.

## Il problema

ORION lo installa qualcuno che sa usare un terminale. Poi lo usa
un'associazione di volontari, dove quel qualcuno passa in sede il sabato, o ha
cambiato casa, o semplicemente non c'è più. Tutto quello che richiede SSH, in
un'associazione così, di fatto non esiste.

Le tre cose che finivano in quella categoria erano proprio quelle che servono
quando le cose vanno male:

- **ripristinare un backup**, cioè l'operazione che si fa nel momento peggiore,
  con i dati appena persi e il presidente al telefono;
- **portare i dati su un'altra macchina**, quando il server va sostituito;
- **aggiornare il programma**, che se diventa un'operazione rara diventa anche
  un'operazione rischiosa, e alla fine non si fa più.

## Cosa fa la pagina Sistema

La vede solo l'amministratore. Contiene, in quest'ordine:

1. lo **stato**: quando è stato fatto l'ultimo backup e quanti ce ne sono, con
   il colore che cambia se l'ultimo è vecchio;
2. la **versione installata** e, se il controllo è acceso, quella pubblicata,
   con le sue note e il pulsante per aggiornare;
3. i **backup disponibili**, di entrambe le cartelle (quelli notturni scritti
   da root e quelli che fa l'applicazione), con scarica / ripristina / elimina;
4. il **caricamento di un archivio da fuori**, per la chiavetta e per il
   trasloco su un'altra macchina.

## Le scelte che contano

### Il ripristino è una transazione sola

Il dump passa a `psql --single-transaction -v ON_ERROR_STOP=1`, preceduto da
`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`. O entra tutto, o non entra
niente.

Non è un dettaglio implementativo, è la ragione per cui questo pulsante può
esistere in un'applicazione web. Un ripristino che fallisce a metà lascia un
archivio peggiore di quello da cui si era partiti: tabelle nuove e dati vecchi,
o viceversa. In quel momento nessuno ha le energie per rimediare, e nessuno sa
nemmeno da dove cominciare. Con la transazione, il caso peggiore è "non è
successo niente, e c'è scritto perché".

Provato davvero, non per ragionamento: un dump tagliato a tre quarti lascia il
database identico a prima, e il messaggio lo dice.

### Prima si salva, poi si tocca

Prima di ogni ripristino l'applicazione fa un backup dei dati attuali
(`pre-ripristino`). Se quel backup **non riesce, il ripristino non parte**: è
l'unica operazione del programma che cancella dati di proposito, e deve essere
reversibile anche quando è stata chiesta per sbaglio.

### Le conferme deboli non contano

Per procedere servono tre cose: essere amministratore, **riscrivere la propria
password** e **scrivere la parola RIPRISTINA**. Un "sei sicuro?" con due
pulsanti lo si clicca per abitudine, e una sessione lasciata aperta sul computer
della sede non deve bastare a cancellare l'archivio dell'associazione.

### Durante il lavoro il portone è chiuso

Mentre il ripristino gira, tutte le API rispondono `503 manutenzione` e anche
l'accesso è chiuso: una sessione aperta in quel momento varrebbe per un database
che sta per essere sostituito. Le pagine già aperte mostrano un velo con scritto
cosa sta succedendo e si ricaricano da sole appena il server torna.

Qui è emersa una cosa che a leggere il codice non si vedeva: senza il velo, ogni
pagina interpretava il 503 come "sessione scaduta" e rimbalzava al login, che
durante la manutenzione è chiuso anche lui. L'utente girava in tondo senza
capire perché. Si è visto solo tenendo aperta una seconda scheda mentre il
ripristino lavorava.

### Niente comandi di psql nei dump

Il dump lo esegue psql, che oltre all'SQL esegue i suoi comandi con la barra
rovesciata: `\!` lancia un programma sul server con l'utente
dell'applicazione. Un archivio caricato da fuori con una riga così avrebbe
trasformato un amministratore web in qualcuno con una shell sulla macchina.
Un dump di pg_dump ne contiene solo tre: `\restrict` e `\unrestrict`, che
proteggono proprio da questo, e `\.` che chiude i dati di un COPY. Un
archivio con qualunque altro viene rifiutato già al caricamento e di nuovo
prima del ripristino; per sicurezza lo stesso controllo gira mentre il dump
scorre verso psql, che viene fermato prima di poter confermare la
transazione. psql parte inoltre senza leggere `.psqlrc`.

### Un backup vecchio va riallineato

Un backup fatto con una versione precedente riporta il database allo schema
di allora, e il codice nuovo non ci trova le colonne che si aspetta: prima
della 3.37 ogni richiesta rispondeva 503, pagina Sistema compresa, e
dall'interfaccia non si usciva. Adesso dopo il ripristino, e comunque a ogni
avvio, ORION applica le migrazioni che mancano.

### Alla fine si riavvia

Dopo un ripristino la memoria del processo (emergenza attiva, impostazioni
lette all'avvio, sessioni) non corrisponde più a quello che c'è nel database.
Sotto PM2 il processo esce e torna su da solo. Senza PM2 resta in manutenzione e
lo scrive, invece di fingere che sia tutto a posto.

### I file caricati sono un'altra cosa

Foto, certificati e documenti non stanno nel database. La loro copia la fa il
backup notturno ed è una copia **speculare**: è la situazione dell'ultima notte,
non quella del giorno del dump scelto. Si possono ripristinare insieme al
database, ma la casella lo dice esplicitamente e mostra la data della copia
disponibile, perché è una differenza che conta.

### Niente root

Tutto questo gira con l'utente dell'applicazione, che possiede la sua cartella,
il suo database e la sua copia dei backup. Le uniche cose che restano a root -
il cron notturno e i permessi delle cartelle - le prepara `setup.sh` una volta
sola.

## Cosa non fa, e perché

- **Non copia i backup fuori dalla macchina.** Restano dove sono: la pagina
  dice a chiare lettere che proteggono da un errore, non dalla rottura del
  disco, e che una copia va portata altrove. Automatizzare l'invio a un NAS o a
  un servizio remoto vuol dire credenziali di terzi dentro l'applicazione, ed è
  una decisione che va presa consapevolmente, non aggiunta di straforo.
- **Non ripristina un backup di un'altra installazione con un altro utente di
  database.** Il dump contiene i proprietari degli oggetti. Se il ruolo non
  esiste, psql si ferma e il messaggio lo spiega in italiano invece di lasciare
  l'errore originale.
- **Non cancella i backup notturni.** Sono scritti da root, li ruota il cron: un
  clic sbagliato in un'applicazione web non deve poterli far sparire.

## Gli aggiornamenti

Stessa pagina, stesso principio: quello che prima richiedeva SSH e `sudo
./update.sh` adesso si fa da un pulsante. Con un vincolo che ha guidato tutto il
resto: **niente root**. L'utente con cui gira l'applicazione possiede già la
cartella, il database e `node_modules`; le uniche cose che `update.sh` faceva da
root - il `chown` e la creazione del cron - o non servono (i file scritti
dall'utente sono già suoi) o si fanno una volta sola all'installazione.

### L'ordine è la cosa importante

1. **Backup del database.** Se non riesce, non si parte.
2. **Scaricamento** del pacchetto e controllo della sua impronta, se
   dichiarata.
3. **Verifica**: è davvero ORION? Il `package.json` dice il nome giusto e
   ci sono `src/server.js`, `migrations/`, `public/`? Un pacchetto sbagliato
   viene scartato qui, con l'installazione ancora intatta.
4. **Dipendenze installate nella cartella di lavoro**, accanto al pacchetto
   nuovo (`npm ci --omit=dev`), con lo stesso controllo di `update.sh`: npm può
   uscire senza errori senza aver installato davvero, quindi si verifica che un
   binario chiave ci sia. Fino alla 3.36 questo passo veniva dopo la
   sostituzione dei file, e un npm che falliva lasciava il codice nuovo con le
   dipendenze vecchie e il database già migrato.
5. **Migrazioni del database, lette dal pacchetto nuovo** e applicate con il
   suo `node-pg-migrate`. È l'ordine di `update.sh`, per la stessa ragione: se
   il database rifiuta la versione nuova, non è stato sostituito nessun file e
   l'applicazione vecchia continua a girare come se niente fosse.
6. **Copia di sicurezza del codice attuale** in un `.tar.gz` accanto ai backup
   del database. Il database aveva i suoi backup; il codice, fino a ieri, non
   aveva niente.
7. **Sostituzione dei file**, dipendenze comprese, con rsync e
   `--delete-after`. Non si toccano i file nascosti della cartella, che è
   anche la home dell'utente di sistema (`.env`, `.pm2` con la lista dei
   processi e i canali di controllo di PM2, `.npm`, `.npmrc`), `uploads/`,
   `protected_uploads/`, `logs/`, `app-android/` con l'APK e i loghi
   dell'associazione. Fino alla 3.36 l'elenco era più corto e `.pm2` veniva
   cancellata: PM2 restava acceso ma non rispondeva più ai comandi, e
   l'APK messo a mano spariva. Ai file copiati si toglie la scrittura per
   gruppo e altri.
8. **Riavvio**, o l'avviso che va fatto a mano.

La cartella di lavoro si cancella alla fine, anche dopo un errore.

### Il controllo è spento finché non lo si accende

Un'applicazione che contatta da sola un server esterno deve essere una scelta di
chi la installa, non una sorpresa che si scopre guardando i log del firewall. Di
base ORION non chiede niente a nessuno; da accesa, il controllo parte solo
quando si preme il pulsante.

Due origini possibili: le *release* di un progetto su GitHub (il caso normale) o
un **manifesto JSON** su un indirizzo qualunque, per chi distribuisce il
programma per conto proprio o per una rete di associazioni che tiene la sua
copia:

```json
{
  "versione": "3.24.0",
  "note": "Cosa cambia...",
  "pubblicata_il": "2026-09-21T10:00:00Z",
  "pacchetto": "https://esempio.it/orion-3.24.0.tar.gz",
  "sha256": "..."
}
```

Il manifesto è anche quello che ha reso collaudabile tutto il resto: la prova
completa dell'aggiornamento gira contro un servizio locale, senza dipendere da
GitHub.

### La numerazione delle versioni

Dalla 1.0 la versione è quella delle release pubbliche su
`ip-conflict/orion-release` (1.0.0, 1.0.1, 1.1.0...): il tag della release,
con o senza la "v" davanti, si confronta numero per numero con la versione in
`package.json`. Prima della 1.0 la numerazione interna seguiva le migrazioni
(`3.<ultima migrazione>.<ritocco>`): le versioni 3.x citate nei documenti sono
quelle. Lo schema del database non dipende dal numero di versione: lo
riallineano le migrazioni, a ogni aggiornamento e a ogni avvio.

### Cosa non fa

- **Non aggiorna da solo.** Nessun aggiornamento automatico: è
  l'amministratore che decide quando, perché durante un'emergenza
  l'applicazione non deve fermarsi mai.
- **Non torna indietro da solo.** La copia del codice c'è e il messaggio dice
  dov'è, ma il ritorno alla versione precedente si fa a mano: automatizzare un
  rollback significa scrivere un secondo percorso rischioso che si prova una
  volta ogni due anni, cioè mai.
- **Non aggiorna PostgreSQL, Node o il sistema.** Quelli restano
  dell'amministratore di sistema.

## Provato così

Su PostgreSQL vero, con il server in esecuzione:

- backup a richiesta, elenco, scaricamento, eliminazione;
- un archivio non compresso, uno compresso ma che non è un dump, e un dump vero
  caricato da fuori;
- un dump **troncato**: il ripristino parte, fallisce dentro la transazione e il
  database resta identico (contato prima e dopo);
- un ripristino **completo**, con un utente creato dopo il backup che deve
  sparire e l'amministratore che deve restare;
- i file caricati ripristinati insieme al database;
- i permessi: volontario e anonimo respinti su ogni rotta;
- i nomi di file che tentano di uscire dalla cartella;
- il velo di manutenzione su una seconda pagina aperta mentre il ripristino
  lavorava.

E per gli aggiornamenti, contro un servizio locale che pubblica un pacchetto
vero (una copia dell'installazione con la versione alzata, una migrazione in più
e un file riconoscibile):

- un aggiornamento **completo**: file sostituiti, migrazione nuova applicata,
  migrazioni vecchie non rifatte, `.env` e `node_modules` intatti, copia del
  codice prodotta;
- il controllo **spento**, che non contatta nessuno;
- l'aggiornamento chiesto **senza aver controllato**, e con una versione non più
  recente di quella installata;
- un pacchetto con l'**impronta sbagliata**;
- un pacchetto che **non è ORION**;
- un pacchetto con una **migrazione che fallisce**: l'applicazione resta in
  funzione, nessun file sostituito, nessuna migrazione registrata.
