// Il token degli avvisi apre solo la ricezione delle proprie notifiche e dura dall'ultimo
// uso: arrivano anche a chi non apre l'app da giorni. Vedi il manuale tecnico.

import crypto from 'crypto';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { leggiNotifiche } from './appMobile.js';
import { nonEsterni } from './autenticazione.js';
import { pool } from './db.js';
import { impronta } from './pubbliche.js';

export const GIORNI_AVVISI = 180;
const MAX_TELEFONI_PER_PERSONA = 3;
const INTERVALLO_USO = 5 * 60 * 1000;
const RITARDO_MASSIMO_PROVA = 120;

// Un'intestazione sua, così non si confonde con la sessione.
export function tokenAvvisiDa(intestazione) {
    if (typeof intestazione !== 'string' || !intestazione.startsWith('Avvisi ')) return null;
    const token = intestazione.slice(7).trim();
    return token && token.length <= 200 ? token : null;
}

const ultimiUsi = new Map();

function segnaUso(tokenId, subito = false) {
    const ora = Date.now();
    if (!subito && ora - (ultimiUsi.get(tokenId) || 0) < INTERVALLO_USO) return;
    ultimiUsi.set(tokenId, ora);
    pool.query(
        `UPDATE token_avvisi SET usato_il = NOW(), scade_il = NOW() + ($2::int * INTERVAL '1 day') WHERE id = $1`,
        [tokenId, GIORNI_AVVISI]
    ).catch(e => logger.warn(`[Avvisi] Uso del token ${tokenId} non registrato: ${e.message}`));
}

export async function utenteDaTokenAvvisi(token) {
    if (!token) return null;
    const r = await pool.query(
        `SELECT t.id AS token_id, u.id, u.username, u.nome, u.cognome
           FROM token_avvisi t JOIN users u ON u.id = t.user_id
          WHERE t.impronta = $1 AND t.scade_il > NOW()
            AND COALESCE(u.is_active, true) = true AND u.eliminato_il IS NULL`, [impronta(token)]);
    const riga = r.rows[0];
    if (!riga) return null;
    segnaUso(riga.token_id);
    return riga;
}

const collegati = new Map();

export function telefonoCollegato(utente) {
    collegati.set(utente.id, (collegati.get(utente.id) || 0) + 1);
    segnaUso(utente.token_id, true);
}

export function telefonoScollegato(utente) {
    const n = (collegati.get(utente.id) || 1) - 1;
    if (n <= 0) collegati.delete(utente.id); else collegati.set(utente.id, n);
    segnaUso(utente.token_id, true);
}

export async function statoTelefoni(userIds = null) {
    const r = await pool.query(
        `SELECT user_id, MAX(COALESCE(usato_il, creato_il)) AS ultimo, COUNT(*)::int AS telefoni,
                BOOL_OR(fcm_token IS NOT NULL) AS firebase
           FROM token_avvisi WHERE scade_il > NOW() AND ($1::int[] IS NULL OR user_id = ANY($1::int[]))
          GROUP BY user_id`, [userIds]);
    const stato = {};
    for (const riga of r.rows) {
        stato[riga.user_id] = { collegato: collegati.has(riga.user_id), firebase: riga.firebase === true, ultimo: riga.ultimo, telefoni: riga.telefoni };
    }
    return stato;
}

export async function revocaAvvisiDi(userId, esecutore = pool) {
    await esecutore.query('DELETE FROM token_avvisi WHERE user_id = $1', [userId]);
}

export async function pulisciTokenAvvisi() {
    const r = await pool.query('DELETE FROM token_avvisi WHERE scade_il < NOW()');
    if (r.rowCount > 0) logger.info(`[Manutenzione] Rimossi ${r.rowCount} token degli avvisi scaduti.`);
}

export function registraRotteAvvisiTelefono(app) {
    app.get('/api/avvisi/notifiche', async (req, res) => {
        const dopo = req.query.dopo === undefined ? null : parseInt(req.query.dopo, 10);
        if (dopo !== null && (!Number.isInteger(dopo) || dopo < 0)) {
            return res.status(400).json({ message: 'Il parametro "dopo" deve essere un numero intero.' });
        }
        try {
            const utente = await utenteDaTokenAvvisi(tokenAvvisiDa(req.headers.authorization));
            // Niente "sessione_terminata": la sessione dell'app è un'altra cosa.
            if (!utente) return res.status(401).json({ message: 'Token degli avvisi non valido.', avvisi_revocati: true });
            res.json(await leggiNotifiche(pool, utente.id, dopo));
        } catch (e) {
            logger.error('Errore GET /api/avvisi/notifiche:', e);
            res.status(500).json({ message: 'Errore nel leggere le notifiche.' });
        }
    });
}

export function registraRotteAvvisi(app, { notifiche }) {
    app.post('/api/app/avvisi', async (req, res) => {
        const dispositivo = typeof req.body?.dispositivo === 'string' ? req.body.dispositivo.slice(0, 100) : null;
        const precedente = typeof req.body?.precedente === 'string' ? req.body.precedente : null;
        const token = crypto.randomBytes(32).toString('base64url');
        try {
            if (precedente) await pool.query('DELETE FROM token_avvisi WHERE impronta = $1 AND user_id = $2', [impronta(precedente), req.user.id]);
            await pool.query(
                `INSERT INTO token_avvisi (user_id, impronta, dispositivo, scade_il)
                 VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 day'))`,
                [req.user.id, impronta(token), dispositivo, GIORNI_AVVISI]);
            // Un telefono che reinstalla l'app non li accumula.
            await pool.query(
                `DELETE FROM token_avvisi WHERE user_id = $1 AND id NOT IN
                   (SELECT id FROM token_avvisi WHERE user_id = $1 ORDER BY creato_il DESC LIMIT $2)`,
                [req.user.id, MAX_TELEFONI_PER_PERSONA]);
            registraAudit(req, 'avvisi.telefono_registrato', { tipo: 'utente', id: req.user.id, dettagli: { dispositivo } });
            res.status(201).json({ avvisi: token, giorni: GIORNI_AVVISI });
        } catch (e) {
            logger.error('Errore POST /api/app/avvisi:', e);
            res.status(500).json({ message: 'Errore nel registrare il telefono per gli avvisi.' });
        }
    });

    app.delete('/api/app/avvisi', async (req, res) => {
        const token = req.body?.avvisi;
        if (typeof token !== 'string') return res.status(400).json({ message: 'Token degli avvisi mancante.' });
        try {
            await pool.query('DELETE FROM token_avvisi WHERE impronta = $1 AND user_id = $2', [impronta(token), req.user.id]);
            res.json({ message: 'Avvisi spenti su questo telefono.' });
        } catch (e) {
            logger.error('Errore DELETE /api/app/avvisi:', e);
            res.status(500).json({ message: 'Errore nello spegnere gli avvisi.' });
        }
    });

    app.get('/api/app/avvisi/stato', async (req, res) => {
        try {
            res.json((await statoTelefoni([req.user.id]))[req.user.id] || { collegato: false, firebase: false, ultimo: null, telefoni: 0 });
        } catch (e) {
            logger.error('Errore GET /api/app/avvisi/stato:', e);
            res.status(500).json({ message: 'Errore nel leggere lo stato degli avvisi.' });
        }
    });

    const proveInCorso = new Set();
    app.post('/api/notifiche/prova', (req, res) => {
        const ritardo = Math.min(RITARDO_MASSIMO_PROVA, Math.max(0, parseInt(req.body?.ritardo ?? 0, 10) || 0));
        const id = req.user.id;
        if (proveInCorso.has(id)) return res.status(409).json({ message: 'Una prova è già in arrivo: aspettala.' });
        proveInCorso.add(id);
        setTimeout(() => {
            notifiche.notifica(id, {
                tipo: 'prova', categoria: 'personale',
                titolo: 'Prova degli avvisi ORION',
                testo: 'Se la vedi, gli avvisi arrivano su questo telefono.',
                oreValidita: 1
            }).catch(() => {}).finally(() => proveInCorso.delete(id));
        }, ritardo * 1000);
        res.status(202).json({ message: ritardo ? `La prova arriva fra ${ritardo} secondi.` : 'Prova mandata.', ritardo });
    });

    app.get('/api/avvisi/telefoni', nonEsterni, async (req, res) => {
        try {
            res.json({ telefoni: await statoTelefoni() });
        } catch (e) {
            logger.error('Errore GET /api/avvisi/telefoni:', e);
            res.status(500).json({ message: 'Errore nel leggere lo stato dei telefoni.' });
        }
    });
}
