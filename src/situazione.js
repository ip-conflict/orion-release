// src/situazione.js
//
// Il punto di situazione: com'è messa l'emergenza adesso, su un foglio da
// leggere al cambio turno o da mandare a chi coordina. Segnalazioni aperte
// con il loro stato, quelle chiuse, le squadre e le ultime note di sala.
// Per un'emergenza chiusa è la situazione finale, il resoconto da stampare.

import { ACTIVE_REPORT_STATUSES_BACKEND, MOTIVI_SENZA_SQUADRA } from './costanti.js';

// Il diario di sala di un'emergenza in corso può essere lungo: sul foglio
// bastano le ultime voci. Di un'emergenza chiusa si stampa tutto.
const VOCI_DIARIO_IN_CORSO = 15;

export function registraRotteSituazione(app, { pool, logger, nonEsterni, haRuolo, emergenzaAttiva, registraAudit }) {
    app.get('/api/situazione', nonEsterni, async (req, res) => {
        const richiesta = req.query.emergenza;
        let emergenzaId;
        if (richiesta === undefined || richiesta === '') {
            emergenzaId = emergenzaAttiva()?.id;
            if (!emergenzaId) return res.status(404).json({ message: 'Nessuna emergenza aperta.' });
        } else {
            emergenzaId = Number.parseInt(richiesta, 10);
            if (!Number.isInteger(emergenzaId) || emergenzaId <= 0) return res.status(400).json({ message: 'Emergenza non valida.' });
        }

        try {
            const { rows: emergenze } = await pool.query(
                'SELECT id, code, name, start_time, end_time, status FROM emergencies WHERE id = $1', [emergenzaId]);
            const emergenza = emergenze[0];
            if (!emergenza) return res.status(404).json({ message: 'Emergenza non trovata.' });
            const chiusa = emergenza.status !== 'ACTIVE';
            // Come l'archivio: le emergenze chiuse le consulta l'amministratore.
            if (chiusa && !haRuolo(req, 'admin')) {
                return res.status(403).json({ message: "Il resoconto di un'emergenza chiusa lo vede l'amministratore, dall'archivio." });
            }

            const [segnalazioni, squadre, diario, associazione] = await Promise.all([
                pool.query(`
                    SELECT r.id, r.emergency_report_number AS numero, r.title, r.status, r.priority,
                           r.location_address, r.created_at, r.updated_at, r.no_team_reason,
                           NULLIF(TRIM(r.environmental_hazard), '') AS pericolo,
                           COALESCE((SELECT string_agg(COALESCE(s.nome_radio, a.nome_radio), ', ' ORDER BY COALESCE(s.nome_radio, a.nome_radio))
                                       FROM report_team_assignments a LEFT JOIN squadre s ON s.id = a.squadra_id
                                      WHERE a.report_id = r.id), '') AS squadre,
                           u.update_text AS ultimo_testo, u.update_timestamp AS ultimo_il, u.autore AS ultimo_autore, u.is_system AS ultimo_di_sistema
                    FROM reports r
                    -- L'ultima nota scritta da una persona; se non ce n'è, l'ultima del sistema.
                    LEFT JOIN LATERAL (
                        SELECT ru.update_text, ru.update_timestamp, ru.is_system, NULLIF(TRIM(CONCAT(us.nome, ' ', us.cognome)), '') AS autore
                        FROM report_updates ru LEFT JOIN users us ON us.id = ru.user_id
                        WHERE ru.report_id = r.id
                        ORDER BY ru.is_system ASC, ru.update_timestamp DESC, ru.id DESC
                        LIMIT 1
                    ) u ON TRUE
                    WHERE r.emergency_id = $1
                    ORDER BY COALESCE(r.emergency_report_number, r.id)`, [emergenzaId]),
                chiusa ? squadreImpiegate(pool, emergenzaId) : squadreInCampo(pool, emergenzaId),
                pool.query(
                    `SELECT testo, autore_nome, creata_il FROM (
                        SELECT id, testo, autore_nome, creata_il FROM diario_sala
                        WHERE emergency_id = $1 ORDER BY creata_il DESC, id DESC
                        ${chiusa ? '' : `LIMIT ${VOCI_DIARIO_IN_CORSO + 1}`}
                     ) d ORDER BY creata_il ASC, id ASC`, [emergenzaId]),
                pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'association_name'")
                    .then(r => r.rows[0]?.setting_value || null).catch(() => null)
            ]);

            const aperte = [], chiuse = [];
            for (const r of segnalazioni.rows) {
                const voce = { ...r, motivo_senza_squadra: MOTIVI_SENZA_SQUADRA[r.no_team_reason] || null };
                delete voce.no_team_reason;
                (ACTIVE_REPORT_STATUSES_BACKEND.includes(r.status) ? aperte : chiuse).push(voce);
            }
            // Prima la priorità, poi da quanto tempo aspettano.
            const pesoPriorita = { High: 0, Medium: 1, Low: 2 };
            aperte.sort((a, b) => (pesoPriorita[a.priority] ?? 3) - (pesoPriorita[b.priority] ?? 3)
                || new Date(a.created_at) - new Date(b.created_at));
            chiuse.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

            const voci = diario.rows;
            const diarioTroncato = !chiusa && voci.length > VOCI_DIARIO_IN_CORSO;

            registraAudit(req, 'emergenza.situazione_stampata', { tipo: 'emergenza', id: emergenzaId, dettagli: { code: emergenza.code, chiusa } });
            res.json({
                emergenza, chiusa, associazione,
                generato_il: new Date().toISOString(),
                generato_da: [req.user.nome, req.user.cognome].filter(Boolean).join(' ') || req.user.username,
                aperte, chiuse,
                squadre: squadre,
                diario: diarioTroncato ? voci.slice(-VOCI_DIARIO_IN_CORSO) : voci,
                diario_troncato: diarioTroncato
            });
        } catch (e) {
            logger.error('Errore GET /api/situazione:', e);
            res.status(500).json({ message: 'Errore nel comporre il punto di situazione.' });
        }
    });
}

// In corso: le squadre che oggi hanno qualcuno dentro o un intervento di
// questa emergenza, con chi c'è, dove sono impegnate e da quando non si sa
// la loro posizione.
async function squadreInCampo(pool, emergenzaId) {
    const { rows } = await pool.query(`
        SELECT s.id, s.nome_radio, s.nome,
               COALESCE((SELECT json_agg(json_build_object('nome', sm.nome, 'cognome', sm.cognome) ORDER BY sm.cognome, sm.nome)
                           FROM squadra_membri sm WHERE sm.squadra_id = s.id), '[]'::json) AS membri,
               (SELECT json_build_object('numero', r.emergency_report_number, 'id', r.id, 'title', r.title)
                  FROM report_team_assignments a JOIN reports r ON r.id = a.report_id
                 WHERE a.squadra_id = s.id AND r.emergency_id = $1 AND r.status = ANY($2::varchar[])
                 ORDER BY a.assigned_at DESC LIMIT 1) AS impegno,
               ps.last_update AS ultima_posizione
        FROM squadre s
        LEFT JOIN posizioni_squadre ps ON ps.squadra_id = s.id
        WHERE EXISTS (SELECT 1 FROM squadra_membri sm WHERE sm.squadra_id = s.id)
           OR EXISTS (SELECT 1 FROM report_team_assignments a JOIN reports r ON r.id = a.report_id
                       WHERE a.squadra_id = s.id AND r.emergency_id = $1)
        ORDER BY s.nome_radio`, [emergenzaId, ACTIVE_REPORT_STATUSES_BACKEND]);
    return rows;
}

// Chiusa: dal registro delle squadre, chi ne ha fatto parte, e quanti
// interventi ha avuto ciascuna. Le squadre di allora possono non esistere più.
async function squadreImpiegate(pool, emergenzaId) {
    const { rows } = await pool.query(`
        WITH persone AS (
            SELECT nome_radio, MAX(squadra_nome) AS nome,
                   json_agg(DISTINCT jsonb_build_object('nome', nome, 'cognome', cognome)) AS membri
            FROM emergency_team_log
            WHERE emergency_id = $1 AND azione = 'membro_aggiunto'
            GROUP BY nome_radio
        ), interventi AS (
            SELECT COALESCE(s.nome_radio, a.nome_radio) AS nome_radio, COUNT(DISTINCT a.report_id)::int AS quanti
            FROM report_team_assignments a JOIN reports r ON r.id = a.report_id LEFT JOIN squadre s ON s.id = a.squadra_id
            WHERE r.emergency_id = $1
            GROUP BY 1
        )
        SELECT COALESCE(p.nome_radio, i.nome_radio) AS nome_radio, p.nome,
               COALESCE(p.membri, '[]'::json) AS membri, COALESCE(i.quanti, 0) AS interventi
        FROM persone p FULL JOIN interventi i ON i.nome_radio = p.nome_radio
        ORDER BY 1`, [emergenzaId]);
    return rows;
}
