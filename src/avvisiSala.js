// Il coordinatore fuori sala riceve un avviso per le cose che chiedono una decisione.
import logger from './logger.js';
import { ACTIVE_REPORT_STATUSES_BACKEND } from './costanti.js';
import { pool } from './db.js';
import { haPermesso, sqlHaPermesso } from './permessi.js';
import { activeEmergency } from './statoEmergenza.js';
import { notifiche } from './tempoReale.js';

const MINUTI_CRITICI_PREDEFINITI = 15;

async function destinatari(escludi = null) {
    const chi = sqlHaPermesso('emergenze.apertura', 1);
    const { rows } = await pool.query(
        `SELECT u.id FROM users u
          WHERE ${chi.condizione} AND COALESCE(u.is_active, true) AND u.eliminato_il IS NULL
            AND COALESCE(u.temporaneo, false) = false AND COALESCE(u.avvisi_sala, true)
            AND u.id IS DISTINCT FROM $3`, [...chi.parametri, escludi]);
    return rows.map(r => r.id);
}

// La chiave rende l'avviso unico per persona: lo stesso fatto non arriva due volte.
export async function avvisaSala({ titolo, testo, chiave, riferimento = null, escludi = null }) {
    try {
        for (const id of await destinatari(escludi)) {
            await notifiche.notifica(id, { tipo: 'avviso_sala', categoria: 'emergenza', titolo, testo, chiave, riferimento, oreValidita: 24 });
        }
    } catch (e) {
        logger.error('[Avvisi sala] Avviso non mandato:', e);
    }
}

export async function controllaSegnalazioniInRitardo() {
    const emergenza = activeEmergency;
    if (!emergenza) return;
    try {
        const impostato = parseInt((await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'minuti_attesa_critica'")).rows[0]?.setting_value, 10);
        const minuti = Number.isInteger(impostato) && impostato > 0 ? impostato : MINUTI_CRITICI_PREDEFINITI;
        const { rows } = await pool.query(
            `SELECT r.id, r.emergency_report_number AS numero, r.title FROM reports r
              WHERE r.emergency_id = $1 AND r.status = ANY($2::varchar[]) AND r.no_team_reason IS NULL
                AND r.created_at < NOW() - make_interval(mins => $3::int)
                AND NOT EXISTS (SELECT 1 FROM report_team_assignments a WHERE a.report_id = r.id)`,
            [emergenza.id, ACTIVE_REPORT_STATUSES_BACKEND, minuti]);
        for (const r of rows) {
            await avvisaSala({
                titolo: `#${r.numero ?? r.id} senza squadra da più di ${minuti} minuti`,
                testo: r.title, chiave: `ritardo:${r.id}`, riferimento: { tipo: 'segnalazione', id: r.id }
            });
        }
    } catch (e) {
        logger.error('[Avvisi sala] Controllo delle segnalazioni in ritardo non riuscito:', e);
    }
}

export function registraRotteAvvisiSala(app) {
    app.get('/api/users/me/avvisi-sala', async (req, res) => {
        try {
            const salvato = (await pool.query('SELECT avvisi_sala FROM users WHERE id = $1', [req.user.id])).rows[0]?.avvisi_sala;
            res.json({ disponibile: haPermesso(req, 'emergenze.apertura'), attivo: salvato !== false });
        } catch (e) {
            logger.error('Errore GET /api/users/me/avvisi-sala:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });
    app.put('/api/users/me/avvisi-sala', async (req, res) => {
        if (!haPermesso(req, 'emergenze.apertura')) return res.status(403).json({ message: 'Gli avvisi della sala sono per chi apre le emergenze.' });
        if (typeof req.body?.attivo !== 'boolean') return res.status(400).json({ message: 'attivo vale vero o falso.' });
        try {
            await pool.query('UPDATE users SET avvisi_sala = $2 WHERE id = $1', [req.user.id, req.body.attivo]);
            res.json({ disponibile: true, attivo: req.body.attivo });
        } catch (e) {
            logger.error('Errore PUT /api/users/me/avvisi-sala:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });
}
