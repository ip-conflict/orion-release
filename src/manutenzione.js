// src/manutenzione.js
//
// Backup, ripristino e aggiornamenti dalla pagina Sistema, senza SSH. Tre
// scelte reggono tutto: il ripristino è una transazione sola (o entra tutto o
// niente); prima di toccare qualcosa si fa un backup di sicurezza, e se non
// riesce ci si ferma; niente richiede i permessi di root.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import bcrypt from 'bcrypt';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { applicaMigrazioniMancanti } from './migrazioni.js';
import { allineaMigrazioni } from './allineaMigrazioni.js';
import readline from 'readline';
import { PassThrough, Transform } from 'stream';
import { StringDecoder } from 'string_decoder';
import { apriFile, cifraturaPronta, fileCifrato } from './cifratura.js';

// Il nome di un file di backup: lettere, cifre, punto, trattino e underscore.
// Tutto il resto è un tentativo di uscire dalla cartella.
const NOME_BACKUP_VALIDO = /^[A-Za-z0-9._-]+\.sql\.gz$/;

// La parola che l'amministratore deve scrivere per confermare il ripristino.
// Un "sei sicuro?" con due pulsanti lo si clicca per abitudine.
const PAROLA_CONFERMA = 'RIPRISTINA';

export function registraRotteManutenzione(app, ctx) {
    const {
        pool, logger, registraAudit, soloAdmin,
        eseguiBackup, cartellaApp, cartellaCron, cartellaFile,
        connessioneDb, cartellaApplicazione, versioneInstallata,
        impostaManutenzione, avvisaClienti, caricaArchivio,
        emergenzaAttiva = () => null, notificaA = null, inviaEmail = null
    } = ctx;

    // Dove finisce il resoconto dell'ultimo ripristino: l'applicazione si
    // riavvia subito dopo, quindi l'esito non può restare in memoria.
    const FILE_ESITO = path.join(cartellaApp, 'ultimo-ripristino.json');

    // Stato dell'operazione in corso, per la pagina che guarda.
    let operazione = null; // { tipo, iniziata, passi: [], finita, esito, messaggio }

    function iniziaOperazione(tipo) {
        if (operazione && !operazione.finita) return null;
        operazione = { tipo, iniziata: new Date().toISOString(), passi: [], finita: false, esito: null, messaggio: null };
        return operazione;
    }

    function passo(testo, stato = 'corso') {
        if (!operazione) return;
        operazione.passi.push({ testo, stato, quando: new Date().toISOString() });
        logger.info(`[Manutenzione] ${testo}`);
    }

    function ultimoPasso(stato) {
        if (operazione?.passi.length) operazione.passi[operazione.passi.length - 1].stato = stato;
    }

    function chiudiOperazione(esito, messaggio) {
        if (!operazione) return;
        operazione.finita = true;
        operazione.esito = esito;
        operazione.messaggio = messaggio;
        operazione.conclusa = new Date().toISOString();
        try {
            fs.writeFileSync(FILE_ESITO, JSON.stringify(operazione, null, 2));
        } catch (e) {
            logger.error('[Manutenzione] Esito non salvato su file:', { error: e.message });
        }
    }

    // I backup dell'applicazione e quelli di cron (scritti da root): questi
    // ultimi si leggono e si ripristinano, ma da qui non si cancellano.
    const CARTELLE = [
        { chiave: 'app', percorso: cartellaApp, etichetta: 'Applicazione', cancellabile: true },
        { chiave: 'notte', percorso: cartellaCron, etichetta: 'Backup notturno', cancellabile: false }
    ];

    async function elencoBackup() {
        const elenco = [];
        for (const cartella of CARTELLE) {
            let nomi = [];
            try {
                nomi = await fs.promises.readdir(cartella.percorso);
            } catch {
                continue; // cartella assente o non leggibile: semplicemente non ha backup
            }
            for (const nome of nomi) {
                if (!NOME_BACKUP_VALIDO.test(nome)) continue;
                try {
                    const info = await fs.promises.stat(path.join(cartella.percorso, nome));
                    if (!info.isFile()) continue;
                    elenco.push({
                        nome,
                        cartella: cartella.chiave,
                        origine: cartella.etichetta,
                        cancellabile: cartella.cancellabile,
                        dimensione: info.size,
                        quando: info.mtime.toISOString(),
                        // Il motivo sta nel nome: db_<data>_<motivo>.sql.gz.
                        motivo: descriviMotivo(nome)
                    });
                } catch { /* file sparito fra readdir e stat */ }
            }
        }
        return elenco.sort((a, b) => b.quando.localeCompare(a.quando));
    }

    function descriviMotivo(nome) {
        const pezzi = nome.replace(/\.sql\.gz$/, '').split('_');
        if (pezzi.length < 4) return null;
        const motivo = pezzi.slice(3).join('_');
        const tradotti = {
            recupero: 'recupero dopo un fermo',
            manuale: 'richiesto a mano',
            'pre-ripristino': 'prima di un ripristino',
            'pre-aggiornamento': 'prima di un aggiornamento'
        };
        if (tradotti[motivo]) return tradotti[motivo];
        if (motivo.startsWith('emergenza-')) return `chiusura emergenza ${motivo.slice(10).replace(/_/g, ' ')}`;
        return motivo.replace(/_/g, ' ');
    }

    function risolviBackup(nomeCartella, nomeFile) {
        if (!NOME_BACKUP_VALIDO.test(nomeFile || '')) return null;
        const cartella = CARTELLE.find(c => c.chiave === nomeCartella);
        if (!cartella) return null;
        const percorso = path.resolve(cartella.percorso, nomeFile);
        // Cintura e bretelle: anche con il nome già filtrato, il file deve
        // stare dentro la cartella dichiarata.
        if (!percorso.startsWith(path.resolve(cartella.percorso) + path.sep)) return null;
        return { cartella, percorso };
    }

    // Un archivio può essere troncato o di un altro programma: lo si scopre prima.
    async function verificaArchivio(percorso) {
        const info = await fs.promises.stat(percorso).catch(() => null);
        if (!info || !info.isFile()) return { valido: false, motivo: 'il file non esiste' };
        if (info.size < 1000) return { valido: false, motivo: `il file è troppo piccolo (${info.size} byte)` };

        // Un backup cifrato si legge solo con la chiave dei dati: il controllo
        // del contenuto (e del tag di autenticità) si fa sul flusso decifrato.
        const cifrato = await fileCifrato(percorso);
        if (cifrato && !cifraturaPronta()) {
            return { valido: false, motivo: 'è cifrato e la chiave dei dati non è disponibile: inserisci prima la chiave di recupero (riquadro Cifratura)' };
        }
        if (!cifrato) {
            const magici = Buffer.alloc(2);
            const handle = await fs.promises.open(percorso, 'r');
            try {
                await handle.read(magici, 0, 2, 0);
            } finally {
                await handle.close();
            }
            if (magici[0] !== 0x1f || magici[1] !== 0x8b) {
                return { valido: false, motivo: 'non è un file compresso con gzip' };
            }
        }

        // Basta l'inizio per riconoscere un dump di PostgreSQL.
        const inizio = await new Promise(async (risolvi, rifiuta) => {
            let letto = '';
            const decompressore = zlib.createGunzip();
            let lettura;
            try { lettura = await apriFile(percorso); } catch (e) { return rifiuta(e); }
            decompressore.on('data', pezzo => {
                letto += pezzo.toString('utf8');
                if (letto.length > 4000) {
                    lettura.destroy();
                    decompressore.destroy();
                    risolvi(letto);
                }
            });
            decompressore.on('end', () => risolvi(letto));
            decompressore.on('error', e => (letto ? risolvi(letto) : rifiuta(e)));
            lettura.on('error', rifiuta);
            lettura.pipe(decompressore);
        }).catch(() => null);

        if (inizio === null) return { valido: false, motivo: 'il file è compresso male o troncato' };
        if (!/PostgreSQL database dump/i.test(inizio)) {
            return { valido: false, motivo: 'non sembra un backup del database di ORION' };
        }
        const comando = await primoComandoPsql(percorso);
        if (comando === false) return { valido: false, motivo: cifrato ? 'il file è troncato, alterato o cifrato con un\'altra chiave' : 'il file è compresso male o troncato' };
        if (comando) {
            logger.warn(`[Manutenzione] Archivio ${path.basename(percorso)} rifiutato: contiene un comando di psql alla riga ${comando.riga}.`);
            return { valido: false, motivo: `contiene un comando di psql che un backup di ORION non ha (riga ${comando.riga})` };
        }
        return { valido: true, dimensione: info.size };
    }

    // Un dump viene eseguito da psql, e psql esegue anche i suoi comandi con
    // la barra rovesciata: "\! comando" lancia un programma sul server. Un
    // backup fatto da pg_dump ne ha solo tre: \restrict e \unrestrict, che
    // proteggono proprio da questo, e \. che chiude i dati di un COPY. Qualunque
    // altro è un archivio manomesso.
    function esaminaRiga(stato, riga) {
        if (stato.inCopy) {
            if (riga === '\\.') stato.inCopy = false;
            return null;
        }
        if (/^COPY\s.+\sFROM\s+stdin;\s*$/i.test(riga)) {
            stato.inCopy = true;
            return null;
        }
        const pulita = riga.trimStart();
        if (pulita.startsWith('\\') && !/^\\(restrict|unrestrict)(\s|$)/.test(pulita)) return pulita.slice(0, 40);
        return null;
    }

    async function primoComandoPsql(percorso) {
        const stato = { inCopy: false };
        let numero = 0;
        try {
            // .pipe() non passa gli errori: un tag di autenticità sbagliato
            // (backup cifrato alterato) deve far fallire la lettura.
            const sorgente = await apriFile(percorso);
            const decompresso = zlib.createGunzip();
            sorgente.on('error', e => decompresso.destroy(e));
            const righe = readline.createInterface({
                input: sorgente.pipe(decompresso),
                crlfDelay: Infinity
            });
            for await (const riga of righe) {
                numero++;
                const trovato = esaminaRiga(stato, riga);
                if (trovato) {
                    righe.close();
                    return { riga: numero, testo: trovato };
                }
            }
            return null;
        } catch {
            return false;
        }
    }

    // Lo stesso controllo mentre il dump scorre verso psql: se il file fosse
    // cambiato dopo la verifica, il flusso si interrompe e la transazione unica
    // non lascia niente a metà.
    function filtroComandiPsql(alRifiuto) {
        const stato = { inCopy: false };
        const decodifica = new StringDecoder('utf8');
        let resto = '';
        const controlla = (riga) => {
            if (!esaminaRiga(stato, riga)) return;
            // Prima di tutto si ferma psql: se vedesse chiudersi il flusso
            // farebbe COMMIT di quello che ha già letto.
            alRifiuto();
            throw new Error('il backup contiene un comando di psql non ammesso: ripristino interrotto.');
        };
        return new Transform({
            transform(pezzo, _codifica, fatto) {
                try {
                    const testo = resto + decodifica.write(pezzo);
                    const righe = testo.split('\n');
                    resto = righe.pop();
                    righe.forEach(controlla);
                    fatto(null, pezzo);
                } catch (e) {
                    fatto(e);
                }
            },
            flush(fatto) {
                try {
                    resto += decodifica.end();
                    if (resto) controlla(resto);
                    fatto();
                } catch (e) {
                    fatto(e);
                }
            }
        });
    }

    // Il ripristino: cancellazione dello schema e dump in un'unica transazione.
    async function ripristinaDatabase(percorso) {
        const prefisso =
            '-- Preparato da ORION prima del ripristino\n' +
            'DROP SCHEMA IF EXISTS public CASCADE;\n' +
            'CREATE SCHEMA public;\n';

        const processo = spawn('psql', [
            '-h', connessioneDb.host,
            '-p', String(connessioneDb.porta),
            '-U', connessioneDb.utente,
            '-d', connessioneDb.database,
            '--no-password',
            '--no-psqlrc',
            '--quiet',
            '--single-transaction',
            '-v', 'ON_ERROR_STOP=1',
            '-f', '-'
        ], {
            // La password passa dall'ambiente, non dagli argomenti: la riga di
            // comando la legge chiunque con 'ps'.
            env: { ...process.env, PGPASSWORD: connessioneDb.password || '' }
        });

        let errori = '';
        processo.stderr.on('data', pezzo => { errori += pezzo.toString(); });
        processo.stdout.on('data', () => {});

        const uscita = new Promise((risolvi, rifiuta) => {
            processo.on('error', rifiuta);
            processo.on('close', codice => codice === 0
                ? risolvi()
                : rifiuta(new Error(spiegaErrorePsql(errori, codice))));
        });

        const flusso = new PassThrough();
        flusso.write(prefisso);
        // Se psql si ferma, EPIPE non aggiunge niente al suo messaggio.
        let erroreFiltro = null;
        const fermaPsql = () => processo.kill('SIGKILL');
        const invio = pipeline(await apriFile(percorso), zlib.createGunzip(), filtroComandiPsql(fermaPsql), flusso)
            .catch(e => { erroreFiltro = e; });
        const scrittura = pipeline(flusso, processo.stdin).catch(() => {});

        try {
            await Promise.all([uscita, invio, scrittura]);
        } catch (e) {
            if (erroreFiltro) throw new Error(`${erroreFiltro.message} Il database NON è stato modificato.`);
            throw e;
        }
        if (erroreFiltro) throw new Error(`${erroreFiltro.message} Il database NON è stato modificato.`);
    }

    // psql è preciso ma parla in inglese e per tecnici. Le due o tre cause
    // ricorrenti meritano una frase in italiano che dica anche cosa fare.
    function spiegaErrorePsql(errori, codice) {
        const testo = (errori || '').trim();
        if (/role .* does not exist/i.test(testo)) {
            const ruolo = (testo.match(/role "([^"]+)" does not exist/i) || [])[1] || 'quello indicato';
            return `il backup viene da un'installazione il cui utente di database si chiama "${ruolo}", che qui non esiste. ` +
                   `Un backup si ripristina su un'installazione con lo stesso utente di database. Dettaglio: ${testo.slice(0, 300)}`;
        }
        if (/permission denied|must be owner/i.test(testo)) {
            return `l'utente del database non ha i permessi per rifare lo schema. Dettaglio: ${testo.slice(0, 300)}`;
        }
        if (/could not connect|connection refused/i.test(testo)) {
            return `il database non risponde. Dettaglio: ${testo.slice(0, 300)}`;
        }
        return `psql è terminato con codice ${codice}. Il database NON è stato modificato. Dettaglio: ${testo.slice(0, 400)}`;
    }

    // I file caricati si ripristinano dalla copia del backup notturno, che è
    // speculare: la situazione dell'ultima notte, non del giorno del dump.
    async function ripristinaFileCaricati() {
        const origine = cartellaFile;
        const copiate = [];
        for (const nome of ['uploads', 'protected_uploads']) {
            const da = path.join(origine, nome);
            if (!fs.existsSync(da)) continue;
            const a = path.join(cartellaApplicazione, nome);
            await fs.promises.cp(da, a, { recursive: true, force: true });
            copiate.push(nome);
        }
        return copiate;
    }

    async function dataCopiaFile() {
        try {
            let piuRecente = 0;
            for (const nome of ['uploads', 'protected_uploads']) {
                const percorso = path.join(cartellaFile, nome);
                const info = await fs.promises.stat(percorso).catch(() => null);
                if (info && info.mtimeMs > piuRecente) piuRecente = info.mtimeMs;
            }
            return piuRecente ? new Date(piuRecente).toISOString() : null;
        } catch {
            return null;
        }
    }

    // Rotte
    app.get('/api/sistema/backup', soloAdmin, async (req, res) => {
        try {
            res.json({
                backup: await elencoBackup(),
                copia_file: await dataCopiaFile(),
                cartella_applicazione: cartellaApp,
                cartella_notturni: cartellaCron
            });
        } catch (e) {
            logger.error('[Manutenzione] Elenco backup non riuscito:', e);
            res.status(500).json({ message: 'Errore nel leggere i backup disponibili.' });
        }
    });

    app.post('/api/sistema/backup', soloAdmin, async (req, res) => {
        try {
            const percorso = await eseguiBackup('manuale');
            if (!percorso) {
                return res.status(500).json({
                    message: 'Il backup non è riuscito. Il registro del server dice perché: di solito è pg_dump non installato o la cartella dei backup non scrivibile.'
                });
            }
            registraAudit(req, 'backup.eseguito', { tipo: 'manuale', dettagli: { file: path.basename(percorso) } });
            res.json({ message: 'Backup completato.', file: path.basename(percorso) });
        } catch (e) {
            logger.error('[Manutenzione] Backup a richiesta non riuscito:', e);
            res.status(500).json({ message: 'Errore durante il backup.' });
        }
    });

    app.get('/api/sistema/backup/:cartella/:nome', soloAdmin, async (req, res) => {
        const trovato = risolviBackup(req.params.cartella, req.params.nome);
        if (!trovato) return res.status(400).json({ message: 'Nome del backup non valido.' });
        if (!fs.existsSync(trovato.percorso)) return res.status(404).json({ message: 'Backup non trovato.' });

        // Un dump contiene l'anagrafica completa dei volontari: chi lo scarica
        // resta scritto.
        registraAudit(req, 'backup.scaricato', { dettagli: { file: req.params.nome, cartella: req.params.cartella } });
        res.download(trovato.percorso, req.params.nome);
    });

    app.delete('/api/sistema/backup/:cartella/:nome', soloAdmin, async (req, res) => {
        const trovato = risolviBackup(req.params.cartella, req.params.nome);
        if (!trovato) return res.status(400).json({ message: 'Nome del backup non valido.' });
        if (!trovato.cartella.cancellabile) {
            return res.status(403).json({
                message: 'I backup notturni li scrive e li ruota il sistema: non si cancellano dall\'applicazione.'
            });
        }
        try {
            await fs.promises.unlink(trovato.percorso);
            registraAudit(req, 'backup.eliminato', { dettagli: { file: req.params.nome } });
            res.json({ message: 'Backup eliminato.' });
        } catch (e) {
            logger.error('[Manutenzione] Eliminazione backup non riuscita:', e);
            res.status(500).json({ message: 'Errore nell\'eliminare il backup.' });
        }
    });

    // Caricare un backup da fuori serve quando si sposta l'installazione su
    // un'altra macchina, o quando l'unica copia buona è su una chiavetta.
    app.post('/api/sistema/backup/carica', soloAdmin, caricaArchivio.single('archivio'), async (req, res) => {
        if (!req.file) return res.status(400).json({ message: 'Nessun file ricevuto.' });
        const percorso = req.file.path;
        try {
            const verifica = await verificaArchivio(percorso);
            if (!verifica.valido) {
                await fs.promises.unlink(percorso).catch(() => {});
                return res.status(400).json({ message: `File rifiutato: ${verifica.motivo}.` });
            }
            registraAudit(req, 'backup.caricato', { dettagli: { file: path.basename(percorso) } });
            res.json({ message: 'Archivio caricato e verificato.', file: path.basename(percorso) });
        } catch (e) {
            await fs.promises.unlink(percorso).catch(() => {});
            logger.error('[Manutenzione] Caricamento archivio non riuscito:', e);
            res.status(500).json({ message: 'Errore nel caricare l\'archivio.' });
        }
    });

    app.post('/api/sistema/backup/:cartella/:nome/verifica', soloAdmin, async (req, res) => {
        const trovato = risolviBackup(req.params.cartella, req.params.nome);
        if (!trovato) return res.status(400).json({ message: 'Nome del backup non valido.' });
        try {
            res.json(await verificaArchivio(trovato.percorso));
        } catch (e) {
            logger.error('[Manutenzione] Verifica archivio non riuscita:', e);
            res.status(500).json({ message: 'Errore nella verifica dell\'archivio.' });
        }
    });

    // Lo stato dell'operazione in corso, o l'esito dell'ultima.
    app.get('/api/sistema/operazione', soloAdmin, async (req, res) => {
        if (operazione) return res.json(operazione);
        try {
            const salvato = await fs.promises.readFile(FILE_ESITO, 'utf8');
            return res.json({ ...JSON.parse(salvato), ripresa_da_file: true });
        } catch {
            return res.json(null);
        }
    });

    // Il ripristino vero e proprio
    app.post('/api/sistema/ripristino', soloAdmin, async (req, res) => {
        const { cartella, nome, password, conferma, ripristina_file } = req.body || {};

        if (conferma !== PAROLA_CONFERMA) {
            return res.status(400).json({ message: `Per procedere scrivi ${PAROLA_CONFERMA} nella casella di conferma.` });
        }
        // La password di nuovo: una sessione lasciata aperta non basta.
        if (!password) return res.status(400).json({ message: 'Serve la tua password per confermare.' });
        const utente = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const passwordGiusta = utente.rowCount > 0 && await bcrypt.compare(password, utente.rows[0].password);
        if (!passwordGiusta) {
            logger.warn(`[Manutenzione] Password errata nel tentativo di ripristino di ${req.user.username}.`);
            return res.status(403).json({ message: 'Password errata.' });
        }

        const trovato = risolviBackup(cartella, nome);
        if (!trovato) return res.status(400).json({ message: 'Backup non valido.' });

        const verifica = await verificaArchivio(trovato.percorso);
        if (!verifica.valido) {
            return res.status(400).json({ message: `Questo archivio non si può ripristinare: ${verifica.motivo}.` });
        }

        if (!iniziaOperazione('ripristino')) {
            return res.status(409).json({ message: 'C\'è già un\'operazione di manutenzione in corso.' });
        }

        registraAudit(req, 'sistema.ripristino', {
            dettagli: { file: nome, cartella, file_caricati: !!ripristina_file }
        });
        logger.warn(`[Manutenzione] RIPRISTINO richiesto da ${req.user.username} dal file ${nome}.`);

        // La risposta parte subito: il ripristino dura dei secondi e la pagina
        // segue i passi interrogando /api/sistema/operazione.
        res.json({ message: 'Ripristino avviato.', avviato: true });

        eseguiRipristino(trovato.percorso, { ripristinaFile: !!ripristina_file, chi: req.user.username })
            .catch(e => {
                ultimoPasso('errore');
                chiudiOperazione('errore', e.message);
                impostaManutenzione(null);
            });
    });

    async function eseguiRipristino(percorso, { ripristinaFile, chi }) {
        // 1. Backup di sicurezza. Se non riesce, ci si ferma qui: senza una via
        //    di ritorno non si comincia nemmeno.
        passo('Backup di sicurezza dei dati attuali');
        const sicurezza = await eseguiBackup('pre-ripristino');
        if (!sicurezza) {
            ultimoPasso('errore');
            chiudiOperazione('errore',
                'Il backup di sicurezza non è riuscito, quindi il ripristino non è stato avviato: i dati attuali sono intatti. ' +
                'Controlla il registro del server (di solito è pg_dump mancante o la cartella dei backup non scrivibile).');
            return;
        }
        ultimoPasso('fatto');
        operazione.backup_sicurezza = path.basename(sicurezza);

        // 2. Da qui in avanti nessuno deve scrivere: l'applicazione risponde
        //    "in manutenzione" a tutti, compreso chi ha una pagina aperta.
        impostaManutenzione({ motivo: 'ripristino di un backup', iniziata: new Date().toISOString() });
        avvisaClienti('manutenzione', { attiva: true, motivo: 'ripristino di un backup' });

        try {
            passo('Ripristino del database');
            await ripristinaDatabase(percorso);
            ultimoPasso('fatto');
            // Un backup di una versione precedente riporta lo schema di allora.
            passo('Allineamento del database a questa versione');
            const applicate = await applicaMigrazioniMancanti();
            ultimoPasso(applicate < 0 ? 'errore' : applicate > 0 ? 'fatto' : 'saltato');
        } catch (e) {
            ultimoPasso('errore');
            impostaManutenzione(null);
            avvisaClienti('manutenzione', { attiva: false });
            chiudiOperazione('errore',
                `Ripristino non riuscito: ${e.message} I dati precedenti sono rimasti come erano (il ripristino avviene in una transazione sola).`);
            return;
        }

        if (ripristinaFile) {
            try {
                passo('Ripristino dei file caricati');
                const copiate = await ripristinaFileCaricati();
                ultimoPasso(copiate.length ? 'fatto' : 'saltato');
                if (!copiate.length) {
                    passo('Nessuna copia dei file trovata: i documenti restano quelli attuali', 'saltato');
                }
            } catch (e) {
                // Il database è già tornato indietro: fermarsi adesso non
                // rimetterebbe le cose a posto. Si segnala e si va avanti.
                ultimoPasso('errore');
                logger.error('[Manutenzione] Copia dei file caricati non riuscita:', { error: e.message });
            }
        }


        const sottoPm2 = process.env.pm_id !== undefined || process.env.PM2_HOME;
        if (sottoPm2) {
            passo('Riavvio dell\'applicazione', 'fatto');
        } else {
            passo('In attesa del riavvio manuale dell\'applicazione', 'saltato');
        }

        chiudiOperazione('fatto', sottoPm2
            ? 'Ripristino completato. L\'applicazione si sta riavviando: ricarica la pagina fra qualche secondo e rifai l\'accesso, ' +
              'perché anche gli utenti e le password sono tornati a quelli del backup.'
            : 'Ripristino completato. L\'applicazione resta ferma finché qualcuno non la riavvia sul server ' +
              '(pm2 restart Orion, oppure il comando con cui è stata avviata): la memoria del programma contiene ancora i dati di prima. ' +
              'Dopo il riavvio rifai l\'accesso, perché anche gli utenti e le password sono tornati a quelli del backup.');
        logger.warn(`[Manutenzione] Ripristino completato (richiesto da ${chi}). Riavvio del processo.`);

        // Lo stato in memoria non corrisponde più al database: si riparte.
        // Sotto PM2 il processo torna su da solo; senza, resta in manutenzione.
        if (sottoPm2) {
            setTimeout(() => process.exit(0), 1500);
        } else {
            impostaManutenzione({
                motivo: 'ripristino completato: riavvia l\'applicazione',
                iniziata: new Date().toISOString(),
                riavvio_manuale: true
            });
        }
    }

    // Aggiornamenti. Le migrazioni si applicano prima di toccare i file,
    // leggendole dal pacchetto nuovo: se falliscono, gira ancora la versione
    // di prima. Prima di sostituire i file si mette da parte il codice attuale.
    const CONFIG_AGGIORNAMENTI = {
        // attivo: il controllo giornaliero automatico, con l'avviso agli
        // amministratori. Di base spento: da solo ORION non contatta nessuno.
        // "Controlla adesso" funziona sempre, perché lo preme una persona.
        attivo: false,
        origine: 'github',
        repo: 'ip-conflict/orion-release',
        api: 'https://api.github.com',
        manifesto: null
    };

    async function leggiImpostazione(chiave, predefinita) {
        try {
            const r = await pool.query('SELECT setting_value FROM branding_settings WHERE setting_key = $1', [chiave]);
            if (r.rowCount === 0 || !r.rows[0].setting_value) return predefinita;
            const grezza = r.rows[0].setting_value;
            const letta = typeof grezza === 'string' ? JSON.parse(grezza) : grezza;
            return { ...predefinita, ...letta };
        } catch (e) {
            logger.error(`[Manutenzione] Impostazione ${chiave} illeggibile:`, { error: e.message });
            return predefinita;
        }
    }

    async function scriviImpostazione(chiave, valore) {
        await pool.query(
            `INSERT INTO branding_settings (setting_key, setting_value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
            [chiave, JSON.stringify(valore)]);
    }

    // Confronto fra numeri di versione: 3.24.0 viene dopo 3.9.1, che
    // confrontando le stringhe non sarebbe vero.
    function versionePiuRecente(candidata, riferimento) {
        const pezzi = (v) => String(v).replace(/^v/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
        const a = pezzi(candidata);
        const b = pezzi(riferimento);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if ((a[i] || 0) > (b[i] || 0)) return true;
            if ((a[i] || 0) < (b[i] || 0)) return false;
        }
        return false;
    }

    // Cosa sa dire l'applicazione di se stessa, e cosa serve sapere prima di
    // premere "aggiorna".
    async function statoAggiornamenti() {
        const config = await leggiImpostazione('aggiornamenti_config', CONFIG_AGGIORNAMENTI);
        const ultimo = await leggiImpostazione('aggiornamenti_stato', {
            controllato_il: null, versione: null, note: null, pubblicata_il: null, errore: null
        });
        const requisiti = await verificaRequisiti();

        return {
            versione_installata: versioneInstallata,
            aggiornamenti: {
                attivo: config.attivo,
                origine: config.origine,
                repo: config.repo,
                manifesto: config.manifesto
            },
            ultimo_controllo: ultimo,
            disponibile: ultimo.versione && versionePiuRecente(ultimo.versione, versioneInstallata)
                ? ultimo.versione : null,
            requisiti
        };
    }

    // I motivi per cui l'aggiornamento non puo' partire vanno detti PRIMA, non
    // a meta' strada: a meta' strada l'installazione e' gia' stata toccata.
    async function verificaRequisiti() {
        const problemi = [];
        const avvertenze = [];

        try {
            await fs.promises.access(cartellaApplicazione, fs.constants.W_OK);
        } catch {
            problemi.push(`La cartella dell'applicazione (${cartellaApplicazione}) non e' scrivibile dall'utente con cui gira il programma: l'aggiornamento non puo' sostituire i file.`);
        }

        if (!eseguibilePresente('tar')) problemi.push('Il comando tar non e\' disponibile sul server.');
        if (!eseguibilePresente('npm')) problemi.push('Il comando npm non e\' disponibile sul server.');

        try {
            const spazio = await fs.promises.statfs(cartellaApplicazione);
            const liberiMb = Math.floor((spazio.bavail * spazio.bsize) / 1024 / 1024);
            if (liberiMb < 600) {
                problemi.push(`Sul disco restano ${liberiMb} MB: troppo pochi per scaricare il pacchetto e installare le sue dipendenze accanto a quelle attuali.`);
            }
        } catch { /* statfs non disponibile: si prosegue, il download fallira' semmai da solo */ }

        // In emergenza l'applicazione non si ferma, nemmeno per pochi minuti.
        const emergenza = emergenzaAttiva();
        if (emergenza) {
            problemi.push(`C'è un'emergenza aperta (${emergenza.code}): si aggiorna dopo averla chiusa.`);
        }

        if (process.env.pm_id === undefined && !process.env.PM2_HOME) {
            avvertenze.push('L\'applicazione non risulta avviata con PM2: al termine dell\'aggiornamento resterà ferma finché qualcuno non la riavvia sul server.');
        }

        return { pronto: problemi.length === 0, problemi, avvertenze };
    }

    function eseguibilePresente(nome) {
        const cartelle = (process.env.PATH || '').split(path.delimiter);
        return cartelle.some(c => {
            try {
                fs.accessSync(path.join(c, nome), fs.constants.X_OK);
                return true;
            } catch {
                return false;
            }
        });
    }

    // La versione pubblicata: dalle release di GitHub o da un manifesto JSON.
    async function cercaVersione(config) {
        if (config.origine === 'manifesto') {
            if (!config.manifesto) throw new Error('Non e\' stato indicato l\'indirizzo del manifesto.');
            const risposta = await fetch(config.manifesto, { headers: { 'Accept': 'application/json' } });
            if (!risposta.ok) throw new Error(`Il manifesto ha risposto ${risposta.status}.`);
            const dati = await risposta.json();
            if (!dati.versione || !dati.pacchetto) {
                throw new Error('Il manifesto non contiene "versione" e "pacchetto".');
            }
            return {
                versione: String(dati.versione),
                note: dati.note || null,
                pubblicata_il: dati.pubblicata_il || null,
                pacchetto: dati.pacchetto,
                sha256: dati.sha256 || null
            };
        }

        const indirizzo = `${config.api.replace(/\/$/, '')}/repos/${config.repo}/releases/latest`;
        const risposta = await fetch(indirizzo, {
            headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'ORION' }
        });
        if (risposta.status === 404) {
            throw new Error('Il progetto non ha ancora nessuna versione pubblicata (nessuna release).');
        }
        if (!risposta.ok) throw new Error(`Il servizio degli aggiornamenti ha risposto ${risposta.status}.`);
        const dati = await risposta.json();
        return {
            versione: String(dati.tag_name || '').replace(/^v/, ''),
            note: dati.body || null,
            pubblicata_il: dati.published_at || null,
            pacchetto: dati.tarball_url,
            sha256: null
        };
    }

    app.get('/api/sistema/versione', soloAdmin, async (req, res) => {
        try {
            res.json(await statoAggiornamenti());
        } catch (e) {
            logger.error('[Manutenzione] Stato della versione non leggibile:', e);
            res.status(500).json({ message: 'Errore nel leggere lo stato dell\'installazione.' });
        }
    });

    app.put('/api/sistema/aggiornamenti/config', soloAdmin, async (req, res) => {
        const corpo = req.body || {};
        const origini = ['github', 'manifesto'];
        if (corpo.origine && !origini.includes(corpo.origine)) {
            return res.status(400).json({ message: `L'origine puo' valere ${origini.join(' o ')}.` });
        }
        const attuale = await leggiImpostazione('aggiornamenti_config', CONFIG_AGGIORNAMENTI);
        const nuova = {
            attivo: corpo.attivo === undefined ? attuale.attivo : !!corpo.attivo,
            origine: corpo.origine || attuale.origine,
            repo: corpo.repo || attuale.repo,
            api: corpo.api || attuale.api,
            manifesto: corpo.manifesto === undefined ? attuale.manifesto : (corpo.manifesto || null)
        };
        await scriviImpostazione('aggiornamenti_config', nuova);
        registraAudit(req, 'sistema.aggiornamenti.configurazione', { dettagli: nuova });
        res.json(nuova);
    });

    // Un controllo: chiede l'ultima versione e ne salva l'esito. Lancia se il
    // servizio non risponde, dopo aver salvato l'errore.
    async function controllaVersione(config) {
        const precedente = await leggiImpostazione('aggiornamenti_stato', {});
        try {
            const trovata = await cercaVersione(config);
            await scriviImpostazione('aggiornamenti_stato', {
                controllato_il: new Date().toISOString(),
                versione: trovata.versione,
                note: trovata.note,
                pubblicata_il: trovata.pubblicata_il,
                pacchetto: trovata.pacchetto,
                sha256: trovata.sha256,
                errore: null,
                // L'ultima versione già annunciata: un avviso per versione.
                avvisata: precedente.avvisata || null
            });
            return trovata;
        } catch (e) {
            await scriviImpostazione('aggiornamenti_stato', {
                controllato_il: new Date().toISOString(),
                versione: null, note: null, pubblicata_il: null,
                errore: e.message,
                avvisata: precedente.avvisata || null
            });
            throw e;
        }
    }

    app.post('/api/sistema/aggiornamenti/controlla', soloAdmin, async (req, res) => {
        const config = await leggiImpostazione('aggiornamenti_config', CONFIG_AGGIORNAMENTI);
        try {
            await controllaVersione(config);
            res.json(await statoAggiornamenti());
        } catch (e) {
            logger.error('[Manutenzione] Controllo aggiornamenti non riuscito:', { error: e.message });
            res.status(502).json({ message: `Controllo non riuscito: ${e.message}` });
        }
    });

    // Il controllo giornaliero, se acceso. Il server lo chiama ogni ora e
    // parte solo quando l'ultimo controllo ha più di un giorno: un server
    // riavviato spesso non interroga GitHub a ogni avvio.
    const ORE_TRA_CONTROLLI = 24;
    async function controlloAutomatico() {
        try {
            const config = await leggiImpostazione('aggiornamenti_config', CONFIG_AGGIORNAMENTI);
            if (!config.attivo) return;
            const stato = await leggiImpostazione('aggiornamenti_stato', {});
            const ultimo = stato.controllato_il ? new Date(stato.controllato_il).getTime() : 0;
            if (Date.now() - ultimo < (ORE_TRA_CONTROLLI - 0.5) * 3600000) return;
            const trovata = await controllaVersione(config);
            if (versionePiuRecente(trovata.versione, versioneInstallata)) await avvisaAmministratori(trovata.versione);
        } catch (e) {
            logger.warn('[Manutenzione] Controllo automatico degli aggiornamenti non riuscito:', { error: e.message });
        }
    }

    // Una notifica sull'app e un'email agli amministratori, una volta sola
    // per versione.
    async function avvisaAmministratori(nuova) {
        const stato = await leggiImpostazione('aggiornamenti_stato', {});
        if (stato.avvisata === nuova) return;
        const { rows } = await pool.query(
            `SELECT DISTINCT u.id, u.email FROM users u JOIN utenti_ruoli ur ON ur.user_id = u.id
             WHERE COALESCE(u.is_active, true) = true AND ur.ruolo = 'admin'`);
        const titolo = `ORION ${nuova} disponibile`;
        const testo = `Installata la ${versioneInstallata}. Si aggiorna dalla pagina Sistema, a emergenza chiusa.`;
        if (typeof notificaA === 'function') {
            await notificaA(rows.map(r => r.id), { tipo: 'aggiornamento_disponibile', titolo, testo, chiave: `aggiornamento:${nuova}` });
        }
        if (typeof inviaEmail === 'function') {
            for (const { email } of rows) {
                if (!email) continue;
                const esito = await inviaEmail(email, `[ORION] ${titolo}`, `${testo}\n`);
                // Senza posta configurata è inutile riprovare con gli altri.
                if (!esito?.success) break;
            }
        }
        await scriviImpostazione('aggiornamenti_stato', { ...stato, avvisata: nuova });
        logger.info(`[Manutenzione] Avvisati ${rows.length} amministratori della versione ${nuova}.`);
    }

    app.post('/api/sistema/aggiornamenti/applica', soloAdmin, async (req, res) => {
        const { password, conferma } = req.body || {};
        if (conferma !== 'AGGIORNA') {
            return res.status(400).json({ message: 'Per procedere scrivi AGGIORNA nella casella di conferma.' });
        }
        if (!password) return res.status(400).json({ message: 'Serve la tua password per confermare.' });
        const utente = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const passwordGiusta = utente.rowCount > 0 && await bcrypt.compare(password, utente.rows[0].password);
        if (!passwordGiusta) return res.status(403).json({ message: 'Password errata.' });

        const stato = await leggiImpostazione('aggiornamenti_stato', {});
        if (!stato.pacchetto || !stato.versione) {
            return res.status(400).json({ message: 'Prima bisogna controllare se c\'e\' una versione nuova.' });
        }
        if (!versionePiuRecente(stato.versione, versioneInstallata)) {
            return res.status(400).json({ message: `La versione installata (${versioneInstallata}) non e\' piu\' vecchia di quella trovata (${stato.versione}).` });
        }
        const requisiti = await verificaRequisiti();
        if (!requisiti.pronto) {
            return res.status(409).json({ message: `Non si puo\' aggiornare: ${requisiti.problemi.join(' ')}` });
        }
        if (!iniziaOperazione('aggiornamento')) {
            return res.status(409).json({ message: 'C\'e\' gia\' un\'operazione di manutenzione in corso.' });
        }

        registraAudit(req, 'sistema.aggiornamento', { dettagli: { da: versioneInstallata, a: stato.versione } });
        logger.warn(`[Manutenzione] AGGIORNAMENTO da ${versioneInstallata} a ${stato.versione} richiesto da ${req.user.username}.`);
        res.json({ message: 'Aggiornamento avviato.', avviato: true });

        eseguiAggiornamento(stato).catch(e => {
            ultimoPasso('errore');
            impostaManutenzione(null);
            chiudiOperazione('errore', e.message);
        });
    });

    async function eseguiAggiornamento(stato) {
        const lavoro = path.join(cartellaApp, 'aggiornamento');
        await fs.promises.rm(lavoro, { recursive: true, force: true });
        await fs.promises.mkdir(lavoro, { recursive: true });
        try {
            await aggiornaDaCartella(stato, lavoro);
        } finally {
            // La cartella di lavoro pesa quanto le dipendenze: non resta in
            // mezzo ai backup, né dopo un errore né dopo un successo.
            await fs.promises.rm(lavoro, { recursive: true, force: true }).catch(() => {});
        }
    }

    async function aggiornaDaCartella(stato, lavoro) {
        // 1. Backup del database. Come per il ripristino: se non riesce, non si
        //    comincia nemmeno.
        passo('Backup del database');
        const sicurezza = await eseguiBackup('pre-aggiornamento');
        if (!sicurezza) {
            ultimoPasso('errore');
            chiudiOperazione('errore', 'Il backup non e\' riuscito, quindi l\'aggiornamento non e\' partito: l\'installazione e\' intatta.');
            return;
        }
        ultimoPasso('fatto');
        operazione.backup_sicurezza = path.basename(sicurezza);

        // 2. Scarica il pacchetto
        passo(`Scaricamento della versione ${stato.versione}`);
        const archivio = path.join(lavoro, 'pacchetto.tar.gz');
        await scaricaFile(stato.pacchetto, archivio);
        if (stato.sha256) {
            const impronta = await improntaFile(archivio);
            if (impronta !== stato.sha256.toLowerCase()) {
                ultimoPasso('errore');
                chiudiOperazione('errore', 'Il pacchetto scaricato non corrisponde all\'impronta dichiarata: scaricamento interrotto, niente e\' stato toccato.');
                return;
            }
        }
        ultimoPasso('fatto');

        // 3. Scompatta e controlla che sia davvero ORION
        passo('Verifica del pacchetto');
        const radice = await scompattaPacchetto(archivio, lavoro);
        const descrizione = JSON.parse(await fs.promises.readFile(path.join(radice, 'package.json'), 'utf8'));
        if (String(descrizione.name).toLowerCase() !== 'orion') {
            ultimoPasso('errore');
            chiudiOperazione('errore', `Il pacchetto scaricato non e\' ORION (si chiama "${descrizione.name}"). Niente e\' stato toccato.`);
            return;
        }
        for (const richiesto of ['src/server.js', 'migrations', 'public']) {
            if (!fs.existsSync(path.join(radice, richiesto))) {
                ultimoPasso('errore');
                chiudiOperazione('errore', `Il pacchetto scaricato e\' incompleto (manca ${richiesto}). Niente e\' stato toccato.`);
                return;
            }
        }
        ultimoPasso('fatto');

        // 4. Le dipendenze si installano nella cartella di lavoro, accanto al
        //    codice nuovo: se npm non ce la fa, il database e i file sono
        //    ancora quelli di prima e l'applicazione continua a girare.
        passo('Installazione delle dipendenze della versione nuova');
        try {
            await installaDipendenze(radice);
            ultimoPasso('fatto');
        } catch (e) {
            ultimoPasso('errore');
            chiudiOperazione('errore', `${e.message} Niente e\' stato toccato: database e file sono quelli di prima.`);
            return;
        }

        // 5. Migrazioni prima dei file.
        passo('Aggiornamento del database');
        try {
            await applicaMigrazioni(radice);
            ultimoPasso('fatto');
        } catch (e) {
            ultimoPasso('errore');
            chiudiOperazione('errore',
                `Le migrazioni del database non sono riuscite: ${e.message} Nessun file e\' stato sostituito, l\'applicazione sta ancora girando nella versione di prima.`);
            return;
        }

        // 6. Copia di sicurezza del codice attuale: il database ha i suoi
        //    backup, il codice fino a ieri non aveva niente.
        passo('Copia di sicurezza della versione attuale');
        const copiaCodice = await archiviaCodice();
        ultimoPasso(copiaCodice ? 'fatto' : 'errore');
        if (!copiaCodice) {
            chiudiOperazione('errore', 'Non e\' stato possibile mettere da parte una copia del codice attuale: l\'aggiornamento si ferma qui. Il database e\' gia\' stato aggiornato, quindi conviene riprovare o aggiornare a mano.');
            return;
        }
        operazione.copia_codice = path.basename(copiaCodice);

        // 7. Da qui in avanti si tocca l'installazione: porte chiuse.
        impostaManutenzione({ motivo: 'aggiornamento del programma in corso', iniziata: new Date().toISOString() });
        avvisaClienti('manutenzione', { attiva: true, motivo: 'aggiornamento' });

        try {
            passo('Sostituzione dei file');
            await copiaVersione(radice);
            if (!fs.existsSync(path.join(cartellaApplicazione, 'node_modules', '.bin', 'node-pg-migrate'))) {
                throw new Error('Dopo la copia le dipendenze non risultano al loro posto.');
            }
            ultimoPasso('fatto');
            await aggiornaAppAndroid(radice);
        } catch (e) {
            ultimoPasso('errore');
            impostaManutenzione(null);
            avvisaClienti('manutenzione', { attiva: false });
            chiudiOperazione('errore',
                `${e.message} La copia della versione precedente e\' in ${copiaCodice}: si puo\' tornare indietro scompattandola sopra la cartella dell\'applicazione.`);
            return;
        }

        const sottoPm2 = process.env.pm_id !== undefined || process.env.PM2_HOME;
        passo(sottoPm2 ? 'Riavvio dell\'applicazione' : 'In attesa del riavvio manuale dell\'applicazione',
              sottoPm2 ? 'fatto' : 'saltato');
        chiudiOperazione('fatto', sottoPm2
            ? `Aggiornamento alla versione ${stato.versione} completato. L'applicazione si sta riavviando: ricarica la pagina fra qualche secondo.`
            : `Aggiornamento alla versione ${stato.versione} completato. Adesso l'applicazione va riavviata sul server (pm2 restart Orion, o il comando con cui e' stata avviata).`);

        logger.warn(`[Manutenzione] Aggiornamento alla versione ${stato.versione} completato.`);
        if (sottoPm2) setTimeout(() => process.exit(0), 1500);
        else impostaManutenzione({
            motivo: `aggiornamento completato: riavvia l'applicazione`,
            iniziata: new Date().toISOString(),
            riavvio_manuale: true
        });
    }

    async function scaricaFile(indirizzo, destinazione) {
        const risposta = await fetch(indirizzo, { headers: { 'User-Agent': 'ORION' }, redirect: 'follow' });
        if (!risposta.ok) throw new Error(`Scaricamento non riuscito: il server ha risposto ${risposta.status}.`);
        await pipeline(risposta.body, fs.createWriteStream(destinazione));
        const info = await fs.promises.stat(destinazione);
        if (info.size < 10000) throw new Error(`Il pacchetto scaricato e' troppo piccolo (${info.size} byte): non e' un aggiornamento valido.`);
    }

    async function improntaFile(percorso) {
        const { createHash } = await import('crypto');
        const somma = createHash('sha256');
        await pipeline(fs.createReadStream(percorso), somma);
        return somma.digest('hex');
    }

    // I pacchetti di GitHub hanno una cartella con la revisione nel nome.
    async function scompattaPacchetto(archivio, lavoro) {
        const destinazione = path.join(lavoro, 'contenuto');
        await fs.promises.mkdir(destinazione, { recursive: true });
        await eseguiComando('tar', ['-xzf', archivio, '-C', destinazione]);
        const voci = await fs.promises.readdir(destinazione, { withFileTypes: true });
        const cartelle = voci.filter(v => v.isDirectory());
        if (voci.some(v => v.isFile() && v.name === 'package.json')) return destinazione;
        if (cartelle.length === 1) return path.join(destinazione, cartelle[0].name);
        throw new Error('Il pacchetto non ha la forma attesa: non si capisce quale sia la cartella del programma.');
    }

    // Le migrazioni si leggono dal pacchetto nuovo, con il suo node-pg-migrate.
    async function applicaMigrazioni(radice) {
        const binario = [radice, cartellaApplicazione]
            .map(c => path.join(c, 'node_modules', '.bin', 'node-pg-migrate'))
            .find(b => fs.existsSync(b));
        if (!binario) throw new Error('node-pg-migrate non e\' installato.');
        const url = `postgres://${connessioneDb.utente}:${encodeURIComponent(connessioneDb.password)}` +
                    `@${connessioneDb.host}:${connessioneDb.porta}/${connessioneDb.database}`;
        // Un database nato prima della 1.0 si allinea alla base della 1.0.
        await allineaMigrazioni(url);
        await eseguiComando(binario, ['up', '-m', path.join(radice, 'migrations')], {
            cwd: radice,
            env: { ...process.env, DATABASE_URL: url }
        });
    }

    async function archiviaCodice() {
        const orario = new Date().toISOString().replace(/[:-]/g, '').replace(/\..+/, '').replace('T', '_');
        const destinazione = path.join(cartellaApp, `codice_${orario}_v${versioneInstallata}.tar.gz`);
        try {
            await eseguiComando('tar', [
                '-czf', destinazione,
                '-C', cartellaApplicazione,
                '--exclude=node_modules', '--exclude=.git', '--exclude=uploads',
                '--exclude=protected_uploads', '--exclude=logs', '--exclude=.env',
                '--exclude=.pm2', '--exclude=.npm', '--exclude=.cache', '--exclude=app-android',
                // La chiave dei dati non va mai accanto ai backup che apre.
                '--exclude=chiave-dati.key', '--exclude=PRIMO-ACCESSO.txt',
                '.'
            ]);
            await fs.promises.chmod(destinazione, 0o640).catch(() => {});
            return destinazione;
        } catch (e) {
            logger.error('[Manutenzione] Copia del codice non riuscita:', { error: e.message });
            return null;
        }
    }

    // Cosa non si sovrascrive né si cancella. La cartella dell'applicazione è
    // anche la home dell'utente di sistema: lì dentro stanno .pm2 (la lista dei
    // processi e i suoi canali di controllo), la cache e la configurazione di
    // npm. Tutto ciò che comincia col punto resta com'è, e così i dati, i
    // loghi e l'app Android messa a mano in app-android.
    // chiave-dati.key: con --delete-after l'aggiornamento la cancellerebbe, e
    // senza chiave file e backup cifrati non si leggono più.
    const ESCLUSIONI = ['/.*', '/uploads', '/protected_uploads', '/logs', '/app-android',
                        '/public/uploads', '/public/logo.png', '/public/logo2.png',
                        '/chiave-dati.key', '/PRIMO-ACCESSO.txt'];

    // L'app Android arriva con la release. app-android resta fuori dalla
    // sostituzione (un APK messo a mano non si perde), ma l'APK del pacchetto
    // si copia quando e' piu' nuovo di quello installato e firmato con la
    // stessa chiave: senza, i telefoni non vedrebbero mai la versione nuova.
    // Un APK firmato da altri o piu' nuovo resta com'e'. Un errore qui non
    // ferma l'aggiornamento del server.
    async function aggiornaAppAndroid(radice) {
        const leggi = async (cartella) => {
            try {
                return JSON.parse(await fs.promises.readFile(path.join(cartella, 'versione.json'), 'utf8'));
            } catch {
                return null;
            }
        };
        const origine = path.join(radice, 'app-android');
        const destinazione = path.join(cartellaApplicazione, 'app-android');
        const nuova = await leggi(origine);
        if (!Number.isInteger(nuova?.codice) || !fs.existsSync(path.join(origine, 'orion.apk'))) return;
        const attuale = await leggi(destinazione);
        const apkPresente = fs.existsSync(path.join(destinazione, 'orion.apk'));
        let motivo = null;
        if (attuale && apkPresente) {
            if (Number.isInteger(attuale.codice) && attuale.codice >= nuova.codice) return;
            if (attuale.certificato_sha256 && nuova.certificato_sha256 && attuale.certificato_sha256 !== nuova.certificato_sha256) {
                motivo = 'l\'APK installato e\' firmato con un\'altra chiave';
            }
        }
        if (motivo) {
            passo(`App Android ${nuova.nome || nuova.codice}: lasciata quella installata (${motivo})`, 'saltato');
            return;
        }
        passo(`App Android ${nuova.nome || nuova.codice}`);
        try {
            await fs.promises.mkdir(destinazione, { recursive: true });
            // Prima l'APK, poi versione.json: un telefono non deve vedere
            // annunciata una versione che non si scarica ancora.
            const temporaneo = path.join(destinazione, `.orion.apk.${process.pid}`);
            await fs.promises.copyFile(path.join(origine, 'orion.apk'), temporaneo);
            await fs.promises.rename(temporaneo, path.join(destinazione, 'orion.apk'));
            await fs.promises.copyFile(path.join(origine, 'versione.json'), path.join(destinazione, 'versione.json'));
            for (const nome of ['orion.apk', 'versione.json']) await fs.promises.chmod(path.join(destinazione, nome), 0o644).catch(() => {});
            ultimoPasso('fatto');
        } catch (e) {
            await fs.promises.rm(path.join(destinazione, `.orion.apk.${process.pid}`), { force: true }).catch(() => {});
            logger.error('[Manutenzione] Copia dell\'app Android non riuscita:', { error: e.message });
            ultimoPasso('errore');
        }
    }

    async function copiaVersione(radice) {
        if (eseguibilePresente('rsync')) {
            // --delete-after toglie i file che la versione nuova non ha più,
            // node_modules compreso; --chmod toglie la scrittura a gruppo e altri.
            const argomenti = ['-a', '--delete-after', '--chmod=Dgo-w,Fgo-w'];
            ESCLUSIONI.forEach(e => argomenti.push(`--exclude=${e}`));
            argomenti.push(`${radice}/`, `${cartellaApplicazione}/`);
            await eseguiComando('rsync', argomenti, {}, 15 * 60 * 1000);
            return;
        }
        // Senza rsync si copia a mano: i file nuovi coprono i vecchi, e
        // node_modules si sostituisce per intero.
        const protette = new Set(ESCLUSIONI.filter(e => !e.slice(1).includes('/')).map(e => e.slice(1)));
        for (const voce of await fs.promises.readdir(radice)) {
            if (voce.startsWith('.') || protette.has(voce)) continue;
            const destinazione = path.join(cartellaApplicazione, voce);
            if (voce === 'node_modules') await fs.promises.rm(destinazione, { recursive: true, force: true });
            await fs.promises.cp(path.join(radice, voce), destinazione, {
                recursive: true, force: true,
                filter: origine => !['public/uploads', 'public/logo.png', 'public/logo2.png']
                    .some(p => origine === path.join(radice, p) || origine.startsWith(path.join(radice, p) + path.sep))
            });
        }
    }

    async function installaDipendenze(radice) {
        const conLock = fs.existsSync(path.join(radice, 'package-lock.json'));
        try {
            await eseguiComando('npm', [conLock ? 'ci' : 'install', '--omit=dev', '--no-audit', '--no-fund'], {
                cwd: radice,
                env: { ...process.env, npm_config_update_notifier: 'false' }
            }, 15 * 60 * 1000);
        } catch (e) {
            throw new Error(`L'installazione delle dipendenze non e' riuscita: ${e.message}`);
        }
        // npm a volte esce con successo senza aver installato davvero: si
        // controlla che un binario chiave ci sia, come fa update.sh.
        if (!fs.existsSync(path.join(radice, 'node_modules', '.bin', 'node-pg-migrate'))) {
            throw new Error('npm e\' terminato senza errori ma le dipendenze non risultano installate.');
        }
    }

    function eseguiComando(comando, argomenti, opzioni = {}, tempoMassimo = 5 * 60 * 1000) {
        return new Promise((risolvi, rifiuta) => {
            const processo = spawn(comando, argomenti, opzioni);
            let errori = '';
            let uscita = '';
            processo.stderr?.on('data', p => { errori += p.toString(); });
            processo.stdout?.on('data', p => { uscita += p.toString(); });
            const scadenza = setTimeout(() => {
                processo.kill('SIGKILL');
                rifiuta(new Error(`${comando} non ha risposto entro ${Math.round(tempoMassimo / 60000)} minuti.`));
            }, tempoMassimo);
            processo.on('error', e => { clearTimeout(scadenza); rifiuta(e); });
            processo.on('close', codice => {
                clearTimeout(scadenza);
                if (codice === 0) return risolvi(uscita);
                rifiuta(new Error(`${comando} e' terminato con codice ${codice}: ${(errori || uscita).trim().slice(0, 400)}`));
            });
        });
    }

    return { elencoBackup, verificaArchivio, statoOperazione: () => operazione, controlloAutomatico };
}
