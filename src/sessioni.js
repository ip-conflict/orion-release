
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { authenticateToken, chiudiSessioni, emettiSessione } from './autenticazione.js';
import { pool } from './db.js';
import { passwordLimiter } from './middleware/rateLimiters.js';
import { GIORNI_RINNOVO, MAX_RINNOVI_PER_PERSONA, impronta } from './pubbliche.js';

const MINUTI_PER_IMPRONTA = 5;

export function registraRotteSessioni(app) {
    app.post('/logout', authenticateToken, async (req, res) => {

        let token = req.signedCookies['__Secure-token'];
        if (!token) {
            const authHeader = req.headers['authorization'];
            token = authHeader?.split(' ')[1];
        }
        if (token) await pool.query('INSERT INTO revoked_tokens (token) VALUES ($1) ON CONFLICT DO NOTHING', [token]);
        res.clearCookie('__Secure-token', { path: '/' });
        res.clearCookie('username', { path: '/' });
        res.status(200).json({ message: 'Logout effettuato.' });
    });

    app.post('/api/app/rinnovo', async (req, res) => {
        // Un token che dura novanta giorni non serve a chi finisce con l'emergenza.
        if (req.user.temporaneo) {
            return res.status(403).json({ message: 'Un accesso temporaneo non usa l\'impronta: si rientra con il codice.' });
        }
        // Chi ruba per un momento una sessione non deve poterla trasformare in un accesso di mesi:
        // il token nasce solo da un accesso con la password appena fatto, uno per sessione.
        const appenaEntrato = Number.isInteger(req.user.ems) && Date.now() - req.user.ems < MINUTI_PER_IMPRONTA * 60 * 1000;
        if (req.user.via === 'rinnovo' || !appenaEntrato || !req.user.jti) {
            return res.status(403).json({ message: "Il token per l'impronta si crea solo subito dopo l'accesso con la password." });
        }
        const dispositivo = typeof req.body?.dispositivo === 'string' ? req.body.dispositivo.slice(0, 100) : null;
        const rinnovo = crypto.randomBytes(32).toString('base64url');
        try {
            const inserito = await pool.query(
                `INSERT INTO token_rinnovo (user_id, impronta, dispositivo, scade_il, mfa, sessione)
             VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 day'), $5, $6)
             ON CONFLICT (sessione) WHERE sessione IS NOT NULL DO NOTHING`,
                [req.user.id, impronta(rinnovo), dispositivo, GIORNI_RINNOVO, req.user.mfa === true, req.user.jti]);
            if (!inserito.rowCount) return res.status(409).json({ message: "Questa sessione ha già un token per l'impronta." });
            // Un telefono che reinstalla l'app non li accumula.
            await pool.query(
                `DELETE FROM token_rinnovo WHERE user_id = $1 AND id NOT IN
               (SELECT id FROM token_rinnovo WHERE user_id = $1 ORDER BY creato_il DESC LIMIT $2)`,
                [req.user.id, MAX_RINNOVI_PER_PERSONA]);
            registraAudit(req, 'sessione.rinnovo_creato', { tipo: 'utente', id: req.user.id, dettagli: { dispositivo } });
            res.status(201).json({ rinnovo, giorni: GIORNI_RINNOVO });
        } catch (error) {
            logger.error('Errore creazione token di rinnovo:', error);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    app.delete('/api/app/rinnovo', async (req, res) => {
        const rinnovo = req.body?.rinnovo;
        if (typeof rinnovo !== 'string') return res.status(400).json({ message: 'Token di rinnovo mancante.' });
        try {
            await pool.query('DELETE FROM token_rinnovo WHERE impronta = $1 AND user_id = $2', [impronta(rinnovo), req.user.id]);
            res.json({ message: 'Accesso con l\'impronta revocato.' });
        } catch (error) {
            logger.error('Errore revoca token di rinnovo:', error);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    app.get('/api/sessioni/dispositivi', async (req, res) => {
        try {
            const [rinnovi, telefoni] = await Promise.all([
                pool.query(`SELECT id, dispositivo, creato_il, usato_il, scade_il FROM token_rinnovo
                             WHERE user_id = $1 AND scade_il > NOW() ORDER BY COALESCE(usato_il, creato_il) DESC`, [req.user.id]),
                pool.query('SELECT id, nome, creato_il, usato_il FROM telefoni_chiave WHERE user_id = $1 ORDER BY creato_il', [req.user.id])
            ]);
            res.json({ rinnovi: rinnovi.rows, telefoni: telefoni.rows });
        } catch (error) {
            logger.error('Errore GET /api/sessioni/dispositivi:', error);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    app.delete('/api/app/rinnovo/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const r = await pool.query('DELETE FROM token_rinnovo WHERE id = $1 AND user_id = $2 RETURNING dispositivo', [id, req.user.id]);
            if (!r.rowCount) return res.status(404).json({ message: 'Dispositivo non trovato.' });
            registraAudit(req, 'sessione.rinnovo_revocato', { tipo: 'utente', id: req.user.id, dettagli: { dispositivo: r.rows[0].dispositivo } });
            res.json({ message: "Dispositivo scollegato: per rientrare servirà la password." });
        } catch (error) {
            logger.error('Errore DELETE /api/app/rinnovo/:id:', error);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    app.post('/api/sessioni/chiudi-le-altre', passwordLimiter, async (req, res) => {
        const password = req.body?.password;
        if (typeof password !== 'string' || !password) return res.status(400).json({ message: 'Scrivi la password.' });
        try {
            const salvata = (await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id])).rows[0]?.password;
            if (!salvata || !(await bcrypt.compare(password, salvata))) return res.status(403).json({ message: 'Password non corretta.' });
            await chiudiSessioni(req.user.id);
            const { token } = emettiSessione(res, req.user, req.user.ruoli, { mfa: req.user.mfa, via: req.user.via });
            registraAudit(req, 'sessione.altre_chiuse', { tipo: 'utente', id: req.user.id });
            res.json({ message: 'Sei uscito da tutti gli altri dispositivi. Qui resti dentro.', token });
        } catch (error) {
            logger.error('Errore POST /api/sessioni/chiudi-le-altre:', error);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });
}
