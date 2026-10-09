// La biblioteca degli scenari delle simulazioni (pagina Simulazioni): chi
// organizza le attività prepara con calma uno scenario (titolo, natura,
// durata, la situazione, gli obiettivi, gli enti coinvolti) e il suo copione,
// sulla stessa pagina del copione delle attività (src/copione.js, rotte
// /api/scenari/:id/copione...). Quando è pronto lo pianifica: dal calendario
// nasce un'attività con il copione copiato dentro (POST /api/attivita con
// scenario_id), oppure lo apre al volo dal centro operativo. Ogni uso ha la
// sua copia: la regia la ritocca senza cambiare lo scenario, che resta per la
// volta dopo.

import logger from './logger.js';
import { registraAudit } from './audit.js';
import { moduloAcceso } from './attivita.js';
import { ruoliDi } from './autenticazione.js';
import { copiaCopione } from './copione.js';
import { pool } from './db.js';
import { haPermesso } from './permessi.js';

const LIMITE = { titolo: 150, scenario: 4000, obiettivi: 4000, enti: 500 };
const NATURE = ['addestramento', 'esercitazione'];

const testo = (v, massimo) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, massimo) : null);

function leggiScenario(corpo) {
    const titolo = testo(corpo?.titolo, LIMITE.titolo);
    if (!titolo) return { errore: 'Lo scenario ha bisogno di un titolo.' };
    const natura = NATURE.includes(corpo.natura) ? corpo.natura : 'addestramento';
    const durata = corpo.durata_ore === undefined || corpo.durata_ore === null || corpo.durata_ore === '' ? 3 : Number(corpo.durata_ore);
    if (!Number.isInteger(durata) || durata < 1 || durata > 72) return { errore: 'La durata va da 1 a 72 ore.' };
    return {
        campi: {
            titolo, natura, durata_ore: durata,
            scenario: testo(corpo.scenario, LIMITE.scenario),
            obiettivi: testo(corpo.obiettivi, LIMITE.obiettivi),
            enti: testo(corpo.enti, LIMITE.enti)
        }
    };
}

// Gli scenari con quanti eventi hanno, quante volte sono stati usati e quando.
const SQL_SCENARI = `
    SELECT s.id, s.titolo, s.natura, s.durata_ore, s.scenario, s.obiettivi, s.enti, s.creato_il, s.aggiornato_il,
           NULLIF(TRIM(CONCAT(u.nome, ' ', u.cognome)), '') AS creato_da_nome,
           (SELECT COUNT(*)::int FROM copione_eventi e WHERE e.scenario_id = s.id) AS eventi,
           (SELECT COUNT(*)::int FROM attivita a WHERE a.scenario_id = s.id AND a.stato <> 'annullata') AS usi,
           (SELECT MAX(a.inizio) FROM attivita a WHERE a.scenario_id = s.id AND a.stato <> 'annullata' AND a.inizio <= NOW()) AS ultimo_uso,
           (SELECT MIN(a.inizio) FROM attivita a WHERE a.scenario_id = s.id AND a.stato = 'programmata' AND a.inizio > NOW()) AS prossimo_uso
      FROM scenari s LEFT JOIN users u ON u.id = s.creato_da`;

// Le simulazioni del calendario: quelle in programma e le ultime svolte.
const SQL_SIMULAZIONI = `
    SELECT a.id, a.titolo, a.inizio, a.fine, a.stato, a.simulazione, a.scenario_id, s.titolo AS scenario_titolo,
           t.nome AS tipo,
           (SELECT COUNT(*)::int FROM copione_eventi e WHERE e.attivita_id = a.id) AS eventi,
           (SELECT e.code FROM emergencies e WHERE e.attivita_id = a.id ORDER BY e.id DESC LIMIT 1) AS sala
      FROM attivita a
      LEFT JOIN attivita_tipi t ON t.id = a.tipo_id
      LEFT JOIN scenari s ON s.id = a.scenario_id
     WHERE a.simulazione IS NOT NULL AND a.stato <> 'annullata'`;

export function registraRotteScenari(app) {
    const id = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : null; };
    const esterno = (req) => ruoliDi(req.user).includes('esterno');
    const organizza = (req, res, next) => (!esterno(req) && haPermesso(req, 'gruppo.attivita'))
        ? next() : res.status(403).json({ message: 'Gli scenari li prepara chi organizza le attività.' });
    const base = [moduloAcceso, organizza];

    app.get('/api/scenari', ...base, async (req, res) => {
        try {
            const [scenari, programmate, svolte] = await Promise.all([
                pool.query(`${SQL_SCENARI} ORDER BY s.titolo, s.id`),
                pool.query(`${SQL_SIMULAZIONI} AND a.stato = 'programmata' AND a.fine >= NOW() ORDER BY a.inizio LIMIT 50`),
                pool.query(`${SQL_SIMULAZIONI} AND (a.stato <> 'programmata' OR a.fine < NOW()) ORDER BY a.inizio DESC LIMIT 30`)
            ]);
            res.json({ scenari: scenari.rows, programmate: programmate.rows, svolte: svolte.rows });
        } catch (e) {
            logger.error('Errore GET /api/scenari:', e);
            res.status(500).json({ message: 'Errore nel leggere gli scenari.' });
        }
    });

    app.get('/api/scenari/:id', ...base, async (req, res) => {
        const scenarioId = id(req.params.id);
        if (!scenarioId) return res.status(400).json({ message: 'Scenario non valido.' });
        try {
            const s = (await pool.query(`${SQL_SCENARI} WHERE s.id = $1`, [scenarioId])).rows[0];
            if (!s) return res.status(404).json({ message: 'Scenario non trovato.' });
            res.json(s);
        } catch (e) {
            logger.error('Errore GET /api/scenari/:id:', e);
            res.status(500).json({ message: 'Errore nel leggere lo scenario.' });
        }
    });

    app.post('/api/scenari', ...base, async (req, res) => {
        const { campi, errore } = leggiScenario(req.body);
        if (errore) return res.status(400).json({ message: errore });
        try {
            const r = await pool.query(
                `INSERT INTO scenari (titolo, natura, durata_ore, scenario, obiettivi, enti, creato_da)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [campi.titolo, campi.natura, campi.durata_ore, campi.scenario, campi.obiettivi, campi.enti, req.user.id]);
            const nuovo = (await pool.query(`${SQL_SCENARI} WHERE s.id = $1`, [r.rows[0].id])).rows[0];
            registraAudit(req, 'scenario.creato', { tipo: 'scenario', id: nuovo.id, dettagli: { titolo: nuovo.titolo } });
            res.status(201).json(nuovo);
        } catch (e) {
            logger.error('Errore POST /api/scenari:', e);
            res.status(500).json({ message: 'Errore nel creare lo scenario.' });
        }
    });

    app.put('/api/scenari/:id', ...base, async (req, res) => {
        const scenarioId = id(req.params.id);
        if (!scenarioId) return res.status(400).json({ message: 'Scenario non valido.' });
        const { campi, errore } = leggiScenario(req.body);
        if (errore) return res.status(400).json({ message: errore });
        try {
            const r = await pool.query(
                `UPDATE scenari SET titolo = $2, natura = $3, durata_ore = $4, scenario = $5, obiettivi = $6, enti = $7, aggiornato_il = NOW()
                  WHERE id = $1`,
                [scenarioId, campi.titolo, campi.natura, campi.durata_ore, campi.scenario, campi.obiettivi, campi.enti]);
            if (!r.rowCount) return res.status(404).json({ message: 'Scenario non trovato.' });
            registraAudit(req, 'scenario.modificato', { tipo: 'scenario', id: scenarioId, dettagli: { titolo: campi.titolo } });
            res.json((await pool.query(`${SQL_SCENARI} WHERE s.id = $1`, [scenarioId])).rows[0]);
        } catch (e) {
            logger.error('Errore PUT /api/scenari/:id:', e);
            res.status(500).json({ message: 'Errore nel salvare lo scenario.' });
        }
    });

    // Una copia da cui partire per una variante: stesso testo, stesso copione.
    app.post('/api/scenari/:id/duplica', ...base, async (req, res) => {
        const scenarioId = id(req.params.id);
        if (!scenarioId) return res.status(400).json({ message: 'Scenario non valido.' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const r = await client.query(
                `INSERT INTO scenari (titolo, natura, durata_ore, scenario, obiettivi, enti, creato_da)
                 SELECT LEFT('Copia di ' || titolo, ${LIMITE.titolo}), natura, durata_ore, scenario, obiettivi, enti, $2 FROM scenari WHERE id = $1
                 RETURNING id`, [scenarioId, req.user.id]);
            if (!r.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Scenario non trovato.' }); }
            const nuovoId = r.rows[0].id;
            await copiaCopione(client, scenarioId, nuovoId, { da: 'scenario_id', verso: 'scenario_id' });
            await client.query('COMMIT');
            const nuovo = (await pool.query(`${SQL_SCENARI} WHERE s.id = $1`, [nuovoId])).rows[0];
            registraAudit(req, 'scenario.duplicato', { tipo: 'scenario', id: nuovoId, dettagli: { da: scenarioId, titolo: nuovo.titolo } });
            res.status(201).json(nuovo);
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore POST /api/scenari/:id/duplica:', e);
            res.status(500).json({ message: 'Errore nel duplicare lo scenario.' });
        } finally {
            client.release();
        }
    });

    // Togliere uno scenario: le attività già nate da lui restano con la loro copia.
    app.delete('/api/scenari/:id', ...base, async (req, res) => {
        const scenarioId = id(req.params.id);
        if (!scenarioId) return res.status(400).json({ message: 'Scenario non valido.' });
        try {
            const r = await pool.query('DELETE FROM scenari WHERE id = $1 RETURNING titolo', [scenarioId]);
            if (!r.rowCount) return res.status(404).json({ message: 'Scenario non trovato.' });
            registraAudit(req, 'scenario.eliminato', { tipo: 'scenario', id: scenarioId, dettagli: { titolo: r.rows[0].titolo } });
            res.status(204).end();
        } catch (e) {
            logger.error('Errore DELETE /api/scenari/:id:', e);
            res.status(500).json({ message: 'Errore nel togliere lo scenario.' });
        }
    });

    // Gli scenari da cui aprire una simulazione al volo (src/emergenze.js):
    // per chi apre le emergenze o organizza le attività.
    app.get('/api/simulazioni/scenari', async (req, res) => {
        if (esterno(req) || !haPermesso(req, 'emergenze.apertura', 'gruppo.attivita')) {
            return res.status(403).json({ message: 'Una simulazione la apre chi apre le emergenze o organizza le attività.' });
        }
        try {
            const r = await pool.query(`${SQL_SCENARI} ORDER BY s.titolo, s.id`);
            res.json(r.rows.map(s => ({ id: s.id, titolo: s.titolo, natura: s.natura, durata_ore: s.durata_ore, scenario: s.scenario, eventi: s.eventi })));
        } catch (e) {
            logger.error('Errore GET /api/simulazioni/scenari:', e);
            res.status(500).json({ message: 'Errore nel leggere gli scenari.' });
        }
    });
}
