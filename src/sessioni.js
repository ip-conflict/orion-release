
import crypto from 'crypto';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { authenticateToken } from './autenticazione.js';
import { pool } from './db.js';
import { GIORNI_RINNOVO, MAX_RINNOVI_PER_PERSONA, impronta } from './pubbliche.js';

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
        const dispositivo = typeof req.body?.dispositivo === 'string' ? req.body.dispositivo.slice(0, 100) : null;
        const rinnovo = crypto.randomBytes(32).toString('base64url');
        try {
            await pool.query(
                `INSERT INTO token_rinnovo (user_id, impronta, dispositivo, scade_il, mfa)
             VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 day'), $5)`,
                [req.user.id, impronta(rinnovo), dispositivo, GIORNI_RINNOVO, req.user.mfa === true]);
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
}
