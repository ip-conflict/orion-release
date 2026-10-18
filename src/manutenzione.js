// Il ripristino è una transazione sola; prima di toccare qualcosa si fa un backup
// di sicurezza, e se non riesce ci si ferma; niente richiede root.

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { applicaMigrazioniMancanti, modificheDaAnnullare } from './migrazioni.js';
import { fetchEsterno, controllaIndirizzo } from './indirizziEsterni.js';
import { leggiNomeBackup, nomeDaScaricare } from './nomiBackup.js';
import { ripristinaDatabase as ripristinaDatabaseCon, verificaArchivio } from './ripristinoDb.js';

// Qualunque altro carattere è un tentativo di uscire dalla cartella.
const NOME_BACKUP_VALIDO = /^[A-Za-z0-9._-]+\.sql\.gz$/;

// Un "sei sicuro?" con due pulsanti lo si clicca per abitudine.
const PAROLA_CONFERMA = 'RIPRISTINA';

export function registraRotteManutenzione(app, ctx) {
    const {
        pool, logger, registraAudit, soloAdmin,
        eseguiBackup, cartellaApp, cartellaCron, cartellaFile,
        connessioneDb, cartellaDati, versioneInstallata,
        impostaManutenzione, avvisaClienti, caricaArchivio,
        emergenzaAttiva = () => null, notificaA = null, inviaEmail = null, cartellaAgente = null
    } = ctx;

    // L'applicazione si riavvia subito dopo il ripristino: l'esito non può restare in memoria.
    const FILE_ESITO = path.join(cartellaApp, 'ultimo-ripristino.json');

    // Il codice sta nell'immagine: aggiornamenti e ritorni li esegue l'agente sull'host
    // (scripts/docker/orion-agente.sh), qui si scrive solo la richiesta.
    const agente = cartellaAgente ? {
        richiesta: path.join(cartellaAgente, 'richieste', 'richiesta'),
        visto: path.join(cartellaAgente, 'richieste', 'visto'),
        stato: path.join(cartellaAgente, 'stato', 'agente.json'),
        operazione: path.join(cartellaAgente, 'stato', 'operazione.json'),
        versioni: path.join(cartellaAgente, 'stato', 'versioni.json'),
        disco: path.join(cartellaAgente, 'stato', 'disco.json')
    } : null;
    // Docker riavvia il container quando il processo esce; fuori dai container (sviluppo) no.
    const riavvioAutomatico = () => !!agente;

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

    const leggiJson = async (percorso) => {
        try {
            return JSON.parse(await fs.promises.readFile(percorso, 'utf8'));
        } catch {
            return null;
        }
    };

    // L'agente si fa vivo ogni minuto.
    async function statoAgente() {
        const letto = await leggiJson(agente.stato);
        const vivo = !!letto?.visto_il && Date.now() - new Date(letto.visto_il).getTime() < 3 * 60000;
        return { vivo, politica: letto?.politica || null };
    }

    const VALORE_RICHIESTA = /^[0-9A-Za-z._+-]{0,80}$/;
    async function chiediAllAgente(campi) {
        const id = crypto.randomBytes(8).toString('hex');
        const righe = Object.entries({ id, ...campi }).map(([chiave, valore]) => {
            if (!VALORE_RICHIESTA.test(String(valore))) throw new Error(`Valore non ammesso per ${chiave}.`);
            return `${chiave}=${valore}`;
        });
        const temporaneo = `${agente.richiesta}.${process.pid}.tmp`;
        await fs.promises.writeFile(temporaneo, righe.join('\n') + '\n', { mode: 0o640 });
        await fs.promises.rename(temporaneo, agente.richiesta);
        return id;
    }

    // L'operazione in memoria finisce quando la dichiara finita l'agente; se l'agente sparisce
    // prima di prendere la richiesta, la si chiude per non bloccare la pagina.
    async function operazioneDellAgente() {
        if (!agente) return null;
        const letta = await leggiJson(agente.operazione);
        if (operazione?.id) {
            if (letta?.id === operazione.id) {
                if (letta.finita) operazione = null;
                return letta;
            }
            const inAttesa = Date.now() - new Date(operazione.iniziata).getTime();
            if (inAttesa > 10 * 60000 && !(await statoAgente()).vivo) {
                await fs.promises.rm(agente.richiesta, { force: true }).catch(() => {});
                ultimoPasso('errore');
                operazione.finita = true;
                operazione.esito = 'errore';
                operazione.messaggio = 'L\'agente del server non ha preso la richiesta: non è cambiato niente. Avvisa chi gestisce il server.';
                const chiusa = operazione;
                operazione = null;
                return chiusa;
            }
            return operazione;
        }
        if (!letta?.id) return null;
        const visto = (await fs.promises.readFile(agente.visto, 'utf8').catch(() => '')).trim();
        return letta.id === visto ? null : letta;
    }

    // Quelli di cron li scrive root: si leggono e si ripristinano, non si cancellano.
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
                        motivo: descriviMotivo(nome)
                    });
                } catch { /* file sparito fra readdir e stat */ }
            }
        }
        return elenco.sort((a, b) => b.quando.localeCompare(a.quando));
    }

    function descriviMotivo(nome) {
        const motivo = leggiNomeBackup(nome)?.motivo;
        if (!motivo) return null;
        const tradotti = {
            notte: 'notturno',
            caricato: 'caricato da un file',
            'pre-ritorno': 'prima di tornare a una versione precedente',
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

    const ripristinaDatabase = (percorso) => ripristinaDatabaseCon(percorso, connessioneDb);

    // La copia dei file è quella dell'ultima notte, non del giorno del dump.
    async function ripristinaFileCaricati() {
        const origine = cartellaFile;
        const copiate = [];
        for (const nome of ['uploads', 'protected_uploads']) {
            const da = path.join(origine, nome);
            if (!fs.existsSync(da)) continue;
            const a = path.join(cartellaDati, nome);
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

    app.get('/api/sistema/backup', soloAdmin, async (req, res) => {
        try {
            res.json({
                backup: await elencoBackup(),
                copia_file: await dataCopiaFile(),
                copia_esterna: agente ? await leggiJson(agente.disco) : null,
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
        res.download(trovato.percorso, nomeDaScaricare(req.params.nome));
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

    app.get('/api/sistema/operazione', soloAdmin, async (req, res) => {
        if (agente && (!operazione || operazione.id)) {
            const dallAgente = await operazioneDellAgente();
            if (dallAgente) return res.json(dallAgente);
        }
        if (operazione) return res.json(operazione);
        try {
            const salvato = await fs.promises.readFile(FILE_ESITO, 'utf8');
            return res.json({ ...JSON.parse(salvato), ripresa_da_file: true });
        } catch {
            return res.json(null);
        }
    });

    app.delete('/api/sistema/operazione', soloAdmin, async (req, res) => {
        if (agente && (!operazione || operazione.id)) {
            const dallAgente = await operazioneDellAgente();
            if (dallAgente && !dallAgente.finita) return res.status(409).json({ message: "L'operazione è ancora in corso." });
            if (dallAgente?.id) await fs.promises.writeFile(agente.visto, dallAgente.id + '\n').catch(() => {});
        }
        if (operazione && !operazione.finita) return res.status(409).json({ message: "L'operazione è ancora in corso." });
        operazione = null;
        try {
            await fs.promises.rename(FILE_ESITO, FILE_ESITO.replace(/\.json$/, '-visto.json'));
        } catch (e) {
            if (e.code !== 'ENOENT') logger.error('[Manutenzione] Esito non messo da parte:', { error: e.message });
        }
        res.json({ message: 'Fatto.' });
    });

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

        res.json({ message: 'Ripristino avviato.', avviato: true });

        eseguiRipristino(trovato.percorso, { ripristinaFile: !!ripristina_file, chi: req.user.username })
            .catch(e => {
                ultimoPasso('errore');
                chiudiOperazione('errore', e.message);
                impostaManutenzione(null);
            });
    });

    async function eseguiRipristino(percorso, { ripristinaFile, chi }) {
        // Senza una via di ritorno non si comincia nemmeno.
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

        // Da qui nessuno deve scrivere: "in manutenzione" a tutti, anche a chi ha una pagina aperta.
        impostaManutenzione({ motivo: 'ripristino di un backup', iniziata: new Date().toISOString() });
        avvisaClienti('manutenzione', { attiva: true, motivo: 'ripristino di un backup' });

        try {
            passo('Ripristino del database');
            await ripristinaDatabase(percorso);
            ultimoPasso('fatto');
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
                // Il database è già tornato indietro: fermarsi non rimetterebbe le cose a posto.
                ultimoPasso('errore');
                logger.error('[Manutenzione] Copia dei file caricati non riuscita:', { error: e.message });
            }
        }

        const riavvioDaSolo = riavvioAutomatico();
        if (riavvioDaSolo) {
            passo('Riavvio dell\'applicazione', 'fatto');
        } else {
            passo('In attesa del riavvio manuale dell\'applicazione', 'saltato');
        }

        chiudiOperazione('fatto', riavvioDaSolo
            ? 'Ripristino completato. L\'applicazione si sta riavviando: ricarica la pagina fra qualche secondo e rifai l\'accesso, ' +
              'perché anche gli utenti e le password sono tornati a quelli del backup.'
            : 'Ripristino completato. L\'applicazione resta ferma finché qualcuno non la riavvia: la memoria del programma contiene ancora i dati di prima. ' +
              'Dopo il riavvio rifai l\'accesso, perché anche gli utenti e le password sono tornati a quelli del backup.');
        logger.warn(`[Manutenzione] Ripristino completato (richiesto da ${chi}). Riavvio del processo.`);

        // Lo stato in memoria non corrisponde più al database: si riparte. Fuori dai
        // container resta in manutenzione.
        if (riavvioDaSolo) {
            setTimeout(() => process.exit(0), 1500);
        } else {
            impostaManutenzione({
                motivo: 'ripristino completato: riavvia l\'applicazione',
                iniziata: new Date().toISOString(),
                riavvio_manuale: true
            });
        }
    }

    const CONFIG_AGGIORNAMENTI = {
        // Di base spento: da solo ORION non contatta nessuno.
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

    // 3.24.0 viene dopo 3.9.1, che fra stringhe non sarebbe vero.
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

    async function verificaRequisiti() {
        const problemi = [];
        const avvertenze = [];

        if (!agente) {
            problemi.push('Questa installazione non ha l\'agente degli aggiornamenti: ORION si aggiorna solo quando gira nei container (vedi il manuale tecnico).');
        } else {
            const { vivo, politica } = await statoAgente();
            if (!vivo) problemi.push('L\'agente degli aggiornamenti sul server non risponde: avvisa chi gestisce il server.');
            else if (politica === 'bloccati') problemi.push('Chi gestisce il server ha bloccato gli aggiornamenti di questa installazione.');
            else if (politica === 'chiedi') avvertenze.push('L\'aggiornamento parte quando lo approva chi gestisce il server.');
        }

        const emergenza = emergenzaAttiva();
        if (emergenza) {
            problemi.push(`C'è un'emergenza aperta (${emergenza.code}): si aggiorna dopo averla chiusa.`);
        }

        return { pronto: problemi.length === 0, problemi, avvertenze };
    }

    // Qui si sa solo che c'è una versione nuova: quale immagine scaricare lo decide l'agente.
    async function cercaVersione(config) {
        if (config.origine === 'manifesto') {
            if (!config.manifesto) throw new Error('Non e\' stato indicato l\'indirizzo del manifesto.');
            const risposta = await fetchEsterno(config.manifesto, { headers: { 'Accept': 'application/json', 'User-Agent': 'ORION' } });
            if (!risposta.ok) throw new Error(`Il manifesto ha risposto ${risposta.status}.`);
            const dati = await risposta.json();
            if (!dati.versione) throw new Error('Il manifesto non contiene "versione".');
            return { versione: String(dati.versione), note: dati.note || null, pubblicata_il: dati.pubblicata_il || null };
        }

        const indirizzo = `${config.api.replace(/\/$/, '')}/repos/${config.repo}/releases/latest`;
        const risposta = await fetchEsterno(indirizzo, {
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
            pubblicata_il: dati.published_at || null
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
        if (corpo.repo !== undefined && corpo.repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(corpo.repo))) {
            return res.status(400).json({ message: 'Il progetto si scrive come proprietario/nome (per esempio ip-conflict/orion-release).' });
        }
        for (const campo of ['api', 'manifesto']) {
            if (!corpo[campo]) continue;
            try {
                await controllaIndirizzo(String(corpo[campo]));
            } catch (e) {
                return res.status(400).json({ message: e.message });
            }
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

    async function controllaVersione(config) {
        const precedente = await leggiImpostazione('aggiornamenti_stato', {});
        try {
            const trovata = await cercaVersione(config);
            await scriviImpostazione('aggiornamenti_stato', {
                controllato_il: new Date().toISOString(),
                versione: trovata.versione,
                note: trovata.note,
                pubblicata_il: trovata.pubblicata_il,
                errore: null,
                avvisata: precedente.avvisata || null
            });
            return trovata;
        } catch (e) {
            // fetch senza rete dice solo "fetch failed".
            const errore = e instanceof TypeError
                ? 'Il server non riesce a raggiungere internet: controllate la sua connessione (o il proxy) e riprovate.'
                : e.message;
            await scriviImpostazione('aggiornamenti_stato', {
                controllato_il: new Date().toISOString(),
                versione: null, note: null, pubblicata_il: null,
                errore,
                avvisata: precedente.avvisata || null
            });
            throw new Error(errore);
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

    // Un server riavviato spesso non interroga GitHub a ogni avvio.
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

    async function passwordGiusta(req, password) {
        const utente = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        return utente.rowCount > 0 && await bcrypt.compare(password, utente.rows[0].password);
    }

    async function mandaAllAgente(res, tipo, campi, messaggio) {
        await operazioneDellAgente();
        if (!iniziaOperazione(tipo)) {
            return res.status(409).json({ message: 'C\'è già un\'operazione di manutenzione in corso.' });
        }
        try {
            operazione.id = await chiediAllAgente({ tipo, ...campi });
            passo('Richiesta mandata al server', 'fatto');
            return res.json({ message: messaggio, avviato: true });
        } catch (e) {
            operazione = null;
            logger.error('[Manutenzione] Richiesta all\'agente non scritta:', { error: e.message });
            return res.status(500).json({ message: `La richiesta al server non è partita: ${e.message}` });
        }
    }

    app.post('/api/sistema/aggiornamenti/applica', soloAdmin, async (req, res) => {
        const { password, conferma } = req.body || {};
        if (conferma !== 'AGGIORNA') {
            return res.status(400).json({ message: 'Per procedere scrivi AGGIORNA nella casella di conferma.' });
        }
        if (!password) return res.status(400).json({ message: 'Serve la tua password per confermare.' });
        if (!await passwordGiusta(req, password)) return res.status(403).json({ message: 'Password errata.' });

        const stato = await leggiImpostazione('aggiornamenti_stato', {});
        if (!stato.versione) {
            return res.status(400).json({ message: 'Prima bisogna controllare se c\'è una versione nuova.' });
        }
        if (!versionePiuRecente(stato.versione, versioneInstallata)) {
            return res.status(400).json({ message: `La versione installata (${versioneInstallata}) non è più vecchia di quella trovata (${stato.versione}).` });
        }
        const requisiti = await verificaRequisiti();
        if (!requisiti.pronto) {
            return res.status(409).json({ message: `Non si può aggiornare: ${requisiti.problemi.join(' ')}` });
        }
        registraAudit(req, 'sistema.aggiornamento', { dettagli: { da: versioneInstallata, a: stato.versione } });
        logger.warn(`[Manutenzione] AGGIORNAMENTO da ${versioneInstallata} a ${stato.versione} richiesto da ${req.user.username}.`);
        return mandaAllAgente(res, 'aggiornamento', { versione: stato.versione }, 'Aggiornamento chiesto al server.');
    });

    const PAROLA_RITORNO = 'TORNA';
    const descriviMigrazione = (n) => n.replace(/^\d+_/, '').replace(/[-_]/g, ' ');

    // Le versioni sono le immagini che l'agente ha già fatto girare qui.
    async function versioniPrecedenti() {
        const storia = agente ? await leggiJson(agente.versioni) : null;
        if (!Array.isArray(storia)) return [];
        const viste = new Set();
        const elenco = [];
        for (const v of [...storia].reverse()) {
            if (!v?.versione || v.versione === versioneInstallata || viste.has(v.versione) || !Array.isArray(v.migrazioni)) continue;
            viste.add(v.versione);
            const daAnnullare = await modificheDaAnnullare(v.migrazioni);
            const backup = v.backup && NOME_BACKUP_VALIDO.test(v.backup) && fs.existsSync(path.join(cartellaCron, v.backup)) ? v.backup : null;
            elenco.push({
                nome: `v${v.versione}`,
                versione: v.versione,
                modifiche: { annullabili: daAnnullare.annullabili, elenco: daAnnullare.nomi.map(descriviMigrazione) },
                lasciata_il: v.al || v.dal,
                dati: backup ? { nome: backup, del: v.al || v.dal } : null
            });
        }
        return elenco;
    }

    app.get('/api/sistema/versioni-precedenti', soloAdmin, async (req, res) => {
        try {
            res.json({ versione_installata: versioneInstallata, versioni: await versioniPrecedenti() });
        } catch (e) {
            logger.error('[Manutenzione] Elenco delle versioni precedenti non leggibile:', e);
            res.status(500).json({ message: 'Errore nel leggere le versioni precedenti.' });
        }
    });

    app.post('/api/sistema/versioni-precedenti/torna', soloAdmin, async (req, res) => {
        const { nome, dati, password, conferma } = req.body || {};
        if (conferma !== PAROLA_RITORNO) {
            return res.status(400).json({ message: `Per procedere scrivi ${PAROLA_RITORNO} nella casella di conferma.` });
        }
        if (!password) return res.status(400).json({ message: 'Serve la tua password per confermare.' });
        if (!await passwordGiusta(req, password)) return res.status(403).json({ message: 'Password errata.' });

        const scelta = (await versioniPrecedenti()).find(v => v.nome === nome);
        if (!scelta) return res.status(400).json({ message: 'Versione non trovata fra quelle passate di qui.' });
        if (!dati && !scelta.modifiche.annullabili) {
            return res.status(400).json({ message: 'Il database ha modifiche che quella versione non conosce e che non si possono annullare: si può tornare solo riportando anche i dati a com\'erano.' });
        }
        if (dati) {
            if (!scelta.dati) return res.status(400).json({ message: 'Per questa versione non c\'è il backup dei dati di allora: si può tornare solo al programma.' });
            const verifica = await verificaArchivio(path.join(cartellaCron, scelta.dati.nome));
            if (!verifica.valido) return res.status(400).json({ message: `Il backup dei dati di allora non si può usare: ${verifica.motivo}.` });
        }
        const requisiti = await verificaRequisiti();
        if (!requisiti.pronto) {
            return res.status(409).json({ message: `Non si può tornare indietro adesso: ${requisiti.problemi.join(' ')}` });
        }
        registraAudit(req, 'sistema.ritorno_versione', { dettagli: { da: versioneInstallata, a: scelta.versione, dati: !!dati } });
        logger.warn(`[Manutenzione] RITORNO dalla versione ${versioneInstallata} alla ${scelta.versione}${dati ? ' con i dati di allora' : ''}, richiesto da ${req.user.username}.`);
        return mandaAllAgente(res, 'ritorno',
            { versione: scelta.versione, dati: dati ? 'si' : 'no', backup: dati ? scelta.dati.nome : '' },
            'Ritorno chiesto al server.');
    });

    return { elencoBackup, verificaArchivio, statoOperazione: () => operazione, controlloAutomatico };
}
