// src/primoAccesso.js
//
// La configurazione iniziale: il primo amministratore si crea dalla pagina di
// accesso, non da setup.sh. Finché nel database non c'è un amministratore, la
// pagina di accesso mostra il modulo "Configurazione iniziale".
//
// Il modulo chiede un codice monouso. Senza, chiunque arrivasse per primo
// all'indirizzo appena pubblicato (fra la fine dell'installazione e il primo
// accesso di chi l'ha fatta) diventerebbe amministratore. Il codice lo genera
// ORION all'avvio e lo scrive in PRIMO-ACCESSO.txt nella cartella
// dell'applicazione, leggibile solo dal suo utente e da root: setup.sh lo
// mostra alla fine, e chi ha installato lo ritrova con
//   sudo cat <cartella dell'app>/PRIMO-ACCESSO.txt
// Creato l'amministratore, il file sparisce e le rotte rispondono 409.

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import { pool } from './db.js';
import { registraAudit } from './audit.js';
import { COSTO_BCRYPT, scriviRuoli } from './autenticazione.js';
import { passwordLimiter } from './middleware/rateLimiters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FILE_CODICE = path.join(__dirname, '..', 'PRIMO-ACCESSO.txt');

// Le stesse regole del cambio password.
export const REGOLA_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|\\;:'",.<>\/?~]).{12,}$/;
const USERNAME = /^[a-z0-9._-]{3,50}$/;

let codiceAttivo = null;

async function esisteAmministratore(esecutore = pool) {
    const r = await esecutore.query("SELECT 1 FROM utenti_ruoli WHERE ruolo = 'admin' LIMIT 1");
    return r.rowCount > 0;
}

// Senza lettere che si confondono (0/O, 1/I/L): si copia da un terminale.
function nuovoCodice() {
    const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const byte = crypto.randomBytes(16);
    const caratteri = [...byte].map(b => alfabeto[b % alfabeto.length]).join('');
    return `${caratteri.slice(0, 4)}-${caratteri.slice(4, 8)}-${caratteri.slice(8, 12)}-${caratteri.slice(12, 16)}`;
}

// All'avvio: se manca un amministratore, il codice c'è (quello già scritto, se
// il server si riavvia prima del primo accesso, altrimenti uno nuovo).
export async function preparaPrimoAccesso() {
    try {
        if (await esisteAmministratore()) {
            codiceAttivo = null;
            if (fs.existsSync(FILE_CODICE)) fs.rmSync(FILE_CODICE, { force: true });
            return false;
        }
        let codice = null;
        try {
            codice = /CODICE:\s*([A-Z0-9-]{19})/.exec(fs.readFileSync(FILE_CODICE, 'utf8'))?.[1] || null;
        } catch { /* non c'è ancora */ }
        if (!codice) {
            codice = nuovoCodice();
            fs.writeFileSync(FILE_CODICE,
                `Configurazione iniziale di ORION\n\n` +
                `Apri l'indirizzo di ORION nel browser: la pagina di accesso chiede\n` +
                `questo codice per creare il primo amministratore.\n\n` +
                `CODICE: ${codice}\n\n` +
                `Il file si cancella da solo quando l'amministratore è creato.\n`,
                { mode: 0o600 });
        }
        codiceAttivo = codice;
        logger.warn(`[Primo accesso] Nessun amministratore: la configurazione iniziale si completa dalla pagina di accesso con il codice in ${FILE_CODICE}.`);
        return true;
    } catch (e) {
        logger.error('[Primo accesso] Impossibile preparare la configurazione iniziale:', e);
        return false;
    }
}

function codiceGiusto(dato) {
    if (!codiceAttivo || typeof dato !== 'string') return false;
    const a = Buffer.from(dato.trim().toUpperCase().replace(/\s+/g, ''));
    const b = Buffer.from(codiceAttivo);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function registraRottePrimoAccesso(app) {
    // La pagina di accesso chiede se mostrare il modulo.
    app.get('/api/primo-accesso', async (req, res) => {
        try {
            res.json({ necessario: !!codiceAttivo && !(await esisteAmministratore()) });
        } catch (e) {
            logger.error('Errore GET /api/primo-accesso:', e);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });

    app.post('/api/primo-accesso', passwordLimiter, async (req, res) => {
        const c = req.body || {};
        const testo = (v, max) => (typeof v === 'string' ? v.trim() : '').slice(0, max);
        const nome = testo(c.nome, 100);
        const cognome = testo(c.cognome, 100);
        const username = testo(c.username, 50).toLowerCase();
        const email = testo(c.email, 150) || null;
        const password = typeof c.password === 'string' ? c.password : '';

        if (!codiceAttivo) return res.status(409).json({ message: "La configurazione iniziale è già stata fatta: accedi con l'amministratore." });
        if (!codiceGiusto(c.codice)) {
            logger.warn(`[Primo accesso] Codice sbagliato da ${req.ip}.`);
            return res.status(403).json({ message: 'Il codice non è giusto. Lo trovi alla fine dell\'installazione, o sul server in PRIMO-ACCESSO.txt.' });
        }
        if (!nome || !cognome) return res.status(400).json({ message: 'Servono nome e cognome.' });
        if (!USERNAME.test(username)) return res.status(400).json({ message: 'Lo username va da 3 a 50 caratteri: lettere minuscole, cifre, punto, trattino o trattino basso.' });
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "L'indirizzo email non è valido." });
        if (!REGOLA_PASSWORD.test(password)) {
            return res.status(400).json({ message: 'La password deve avere almeno 12 caratteri, con maiuscole, minuscole, un numero e un simbolo.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Due richieste insieme: una sola crea l'amministratore.
            await client.query("SELECT pg_advisory_xact_lock(hashtext('orion-primo-accesso'))");
            if (await esisteAmministratore(client)) {
                await client.query('ROLLBACK');
                codiceAttivo = null;
                return res.status(409).json({ message: "La configurazione iniziale è già stata fatta: accedi con l'amministratore." });
            }
            const doppione = await client.query('SELECT 1 FROM users WHERE username = $1 OR ($2::text IS NOT NULL AND lower(email) = lower($2))', [username, email]);
            if (doppione.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Username o email già usati.' }); }
            const hash = await bcrypt.hash(password, COSTO_BCRYPT);
            const nuovo = await client.query(
                `INSERT INTO users (username, password, role, nome, cognome, email) VALUES ($1, $2, 'admin', $3, $4, $5) RETURNING id`,
                [username, hash, nome, cognome, email]);
            await scriviRuoli(client, nuovo.rows[0].id, ['admin']);
            await client.query('COMMIT');
            codiceAttivo = null;
            fs.rmSync(FILE_CODICE, { force: true });
            registraAudit({ ip: req.ip, user: { id: nuovo.rows[0].id, username } }, 'configurazione_iniziale.amministratore_creato', { tipo: 'utente', id: nuovo.rows[0].id, dettagli: { username } });
            logger.info(`[Primo accesso] Amministratore '${username}' creato dalla pagina di accesso.`);
            res.status(201).json({ message: `Fatto: ${nome} ${cognome} è l'amministratore. Ora accedi con ${username} e la password scelta.`, username });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore POST /api/primo-accesso:', e);
            res.status(500).json({ message: "Errore nel creare l'amministratore." });
        } finally {
            client.release();
        }
    });
}
