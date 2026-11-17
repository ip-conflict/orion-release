// Il primo amministratore si crea dalla pagina di accesso con un codice monouso, scritto in
// PRIMO-ACCESSO.txt: senza, l'indirizzo appena pubblicato sarebbe di chi arriva per primo.

import { controllaPassword } from './password.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { pool } from './db.js';
import { registraAudit } from './audit.js';
import { COSTO_BCRYPT, emettiSessione, permessiDellaPersona, scriviRuoli } from './autenticazione.js';
import { generateUsername } from './anagrafica.js';
import { passwordLimiter } from './middleware/rateLimiters.js';
import { RADICE_DATI } from './percorsi.js';

export const FILE_CODICE = path.join(RADICE_DATI, 'PRIMO-ACCESSO.txt');

export { REGOLA_PASSWORD } from './password.js';

let codiceAttivo = null;

async function esisteAmministratore(esecutore = pool) {
    const r = await esecutore.query("SELECT 1 FROM utenti_ruoli WHERE ruolo = 'admin' LIMIT 1");
    return r.rowCount > 0;
}

// Senza lettere che si confondono: si copia da un terminale.
function nuovoCodice() {
    const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const byte = crypto.randomBytes(16);
    const caratteri = [...byte].map(b => alfabeto[b % alfabeto.length]).join('');
    return `${caratteri.slice(0, 4)}-${caratteri.slice(4, 8)}-${caratteri.slice(8, 12)}-${caratteri.slice(12, 16)}`;
}

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
        const email = testo(c.email, 150)?.toLowerCase() || null;
        const password = typeof c.password === 'string' ? c.password : '';

        if (!codiceAttivo) return res.status(409).json({ message: "La configurazione iniziale è già stata fatta: accedi con l'amministratore." });
        if (!codiceGiusto(c.codice)) {
            logger.warn(`[Primo accesso] Codice sbagliato da ${req.ip}.`);
            return res.status(403).json({ message: 'Il codice non è giusto. Lo trovi alla fine dell\'installazione, o sul server in PRIMO-ACCESSO.txt.' });
        }
        if (!nome || !cognome) return res.status(400).json({ message: 'Servono nome e cognome.' });
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "L'indirizzo email non è valido." });
        const problemaPassword = controllaPassword(password, { nome, cognome, email });
        if (problemaPassword) return res.status(400).json({ message: problemaPassword });

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
            const doppione = await client.query('SELECT 1 FROM users WHERE $1::text IS NOT NULL AND lower(email) = lower($1)', [email]);
            if (doppione.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Questa email è già usata.' }); }
            const username = await generateUsername(nome, cognome, client);
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
            // Il codice letto sul server e la password sono già due fattori: la verifica in due
            // passaggi si attiva al prossimo accesso, non mentre si sta ancora installando.
            const utente = { id: nuovo.rows[0].id, username, role: 'admin' };
            const { token, principale, ruoliUtente } = emettiSessione(res, utente, ['admin'], { mfa: true });
            res.status(201).json({
                message: `Fatto: ${nome} ${cognome} è l'amministratore, con nome utente ${username}.`,
                avviso: `Sei dentro come ${username} (puoi entrare anche con l'email). Al prossimo accesso ORION ti farà collegare il telefono per la verifica in due passaggi.`,
                userId: utente.id, username, role: principale, ruoli: ruoliUtente,
                permessi: await permessiDellaPersona(utente.id, ruoliUtente), token
            });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore POST /api/primo-accesso:', e);
            res.status(500).json({ message: "Errore nel creare l'amministratore." });
        } finally {
            client.release();
        }
    });
}
