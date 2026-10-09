// Fin dove ciascuno ha letto le segnalazioni dell'emergenza in corso, tenuto
// sul server: ricaricando la pagina o cambiando postazione le novità non si
// perdono. Per ogni segnalazione già aperta almeno una volta il centro
// operativo riceve quante voci di altri sono arrivate dopo, e quante sono
// "forti" (una nota scritta da una persona, delle foto): quelle che fanno
// lampeggiare la scheda e saltare il segnaposto. Le modifiche di sistema
// fatte dai colleghi contano solo nel numero.

import logger from './logger.js';
import { pool } from './db.js';
import { activeEmergency } from './statoEmergenza.js';

export function registraRotteLetture(app) {
    app.get('/api/letture', async (req, res) => {
        if (!activeEmergency) return res.json({ letture: [] });
        try {
            const r = await pool.query(
                `SELECT l.report_id, l.letta_il,
                        COUNT(u.id)::int AS non_lette,
                        COUNT(u.id) FILTER (WHERE NOT COALESCE(u.is_system, false) OR u.update_text ILIKE '%immagin%')::int AS forti
                   FROM letture_segnalazioni l
                   JOIN reports r ON r.id = l.report_id AND r.emergency_id = $2
                   LEFT JOIN report_updates u ON u.report_id = l.report_id
                        -- Al millesimo, come le ore che manda il browser: l'ultima voce
                        -- letta non deve risultare più nuova di sé stessa.
                        AND date_trunc('milliseconds', u.update_timestamp) > l.letta_il
                        AND u.user_id IS DISTINCT FROM $1
                  WHERE l.user_id = $1
                  GROUP BY l.report_id, l.letta_il`, [req.user.id, activeEmergency.id]);
            res.json({ letture: r.rows });
        } catch (e) {
            logger.error('Errore lettura delle letture:', e);
            res.status(500).json({ message: 'Errore nel leggere le novità.' });
        }
    });

    // Letta fino a quell'ora: non si torna indietro e non si va oltre adesso.
    app.put('/api/letture/:reportId', async (req, res) => {
        const reportId = Number(req.params.reportId);
        const fino = req.body?.letta_il ? new Date(req.body.letta_il) : new Date();
        if (!Number.isInteger(reportId) || reportId <= 0 || isNaN(fino.getTime())) {
            return res.status(400).json({ message: 'Richiesta non valida.' });
        }
        if (!activeEmergency) return res.status(204).end();
        try {
            await pool.query(
                `INSERT INTO letture_segnalazioni (user_id, report_id, letta_il)
                 SELECT $1, r.id, LEAST($3::timestamptz, NOW()) FROM reports r WHERE r.id = $2 AND r.emergency_id = $4
                 ON CONFLICT (user_id, report_id) DO UPDATE SET letta_il = GREATEST(letture_segnalazioni.letta_il, EXCLUDED.letta_il)`,
                [req.user.id, reportId, fino.toISOString(), activeEmergency.id]);
            res.status(204).end();
        } catch (e) {
            logger.error('Errore salvataggio lettura:', e);
            res.status(500).json({ message: 'Errore nel segnare la lettura.' });
        }
    });
}
