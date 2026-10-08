// src/situazione.js
//
// Il punto di situazione: com'è messa l'emergenza adesso, su un foglio da
// leggere al cambio turno o da mandare a chi coordina. Segnalazioni aperte
// con il loro stato, quelle chiuse, le squadre e le ultime note di sala.
// Per un'emergenza chiusa è la situazione finale, il resoconto da stampare.

import { ACTIVE_REPORT_STATUSES_BACKEND, MOTIVI_SENZA_SQUADRA } from './costanti.js';
import { sigilloAttuale, testoSigillo } from './integrita.js';
import { haPermesso } from './permessi.js';

// Il diario di sala di un'emergenza in corso può essere lungo: sul foglio
// bastano le ultime voci. Di un'emergenza chiusa si stampa tutto.
const VOCI_DIARIO_IN_CORSO = 15;

// Il quadro della situazione: i campi e quanto possono essere lunghi. I
// numeri della popolazione sono facoltativi: vuoto vuol dire "non indicato",
// zero vuol dire zero.
const TESTI_QUADRO = { descrizione: 3000, servizi: 1500, richieste: 1500, recapito: 300, responsabile: 200 };
const NUMERI_QUADRO = ['evacuati', 'assistiti', 'isolati', 'feriti', 'dispersi', 'deceduti'];

export function normalizzaQuadro(corpo) {
    const q = {};
    for (const [k, max] of Object.entries(TESTI_QUADRO)) {
        const v = corpo?.[k];
        if (v === undefined || v === null || v === '') continue;
        if (typeof v !== 'string' || v.length > max) throw new Error(`Testo non valido o troppo lungo: ${k}.`);
        if (v.trim()) q[k] = v.trim();
    }
    for (const k of NUMERI_QUADRO) {
        const v = corpo?.[k];
        if (v === undefined || v === null || v === '') continue;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 1000000) throw new Error(`Numero non valido: ${k}.`);
        q[k] = n;
    }
    // Il prossimo aggiornamento: data e ora come le dà il campo del browser.
    const p = corpo?.prossimo;
    if (p) {
        if (typeof p !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p)) throw new Error("Ora del prossimo aggiornamento non valida.");
        q.prossimo = p;
    }
    return q;
}

async function leggiQuadro(pool, emergenzaId) {
    const r = await pool.query('SELECT dati, aggiornato_il, aggiornato_da FROM quadro_situazione WHERE emergency_id = $1', [emergenzaId]);
    return r.rows[0] ? { ...r.rows[0].dati, aggiornato_il: r.rows[0].aggiornato_il, aggiornato_da: r.rows[0].aggiornato_da } : null;
}

export function registraRotteSituazione(app, { pool, logger, nonEsterni, haRuolo, emergenzaAttiva, registraAudit }) {
    // Il quadro dell'emergenza in corso, da compilare. Se non c'è ancora,
    // recapito e responsabile si propongono dall'ultima emergenza: di solito
    // restano gli stessi.
    app.get('/api/situazione/quadro', nonEsterni, async (req, res) => {
        const emergenza = emergenzaAttiva();
        if (!emergenza) return res.status(404).json({ message: 'Nessuna emergenza aperta.' });
        try {
            const quadro = await leggiQuadro(pool, emergenza.id);
            if (quadro) return res.json({ quadro });
            const prima = await pool.query(
                `SELECT dati->>'recapito' AS recapito, dati->>'responsabile' AS responsabile FROM quadro_situazione
                  WHERE emergency_id <> $1 ORDER BY aggiornato_il DESC LIMIT 1`, [emergenza.id]);
            const proposta = Object.fromEntries(Object.entries(prima.rows[0] || {}).filter(([, v]) => v));
            res.json({ quadro: null, proposta });
        } catch (e) {
            logger.error('Errore GET /api/situazione/quadro:', e);
            res.status(500).json({ message: 'Errore nel leggere il quadro della situazione.' });
        }
    });

    app.put('/api/situazione/quadro', nonEsterni, async (req, res) => {
        const emergenza = emergenzaAttiva();
        if (!emergenza) return res.status(409).json({ message: "Il quadro si scrive solo durante un'emergenza aperta." });
        let dati;
        try { dati = normalizzaQuadro(req.body); } catch (e) { return res.status(400).json({ message: e.message }); }
        const chi = [req.user.nome, req.user.cognome].filter(Boolean).join(' ') || req.user.username;
        try {
            await pool.query(
                `INSERT INTO quadro_situazione (emergency_id, dati, aggiornato_il, aggiornato_da) VALUES ($1, $2, NOW(), $3)
                 ON CONFLICT (emergency_id) DO UPDATE SET dati = EXCLUDED.dati, aggiornato_il = NOW(), aggiornato_da = EXCLUDED.aggiornato_da`,
                [emergenza.id, JSON.stringify(dati), chi]);
            registraAudit(req, 'emergenza.quadro_aggiornato', { tipo: 'emergenza', id: emergenza.id, dettagli: dati });
            res.json({ message: 'Quadro della situazione salvato.', quadro: await leggiQuadro(pool, emergenza.id) });
        } catch (e) {
            logger.error('Errore PUT /api/situazione/quadro:', e);
            res.status(500).json({ message: 'Errore nel salvare il quadro della situazione.' });
        }
    });

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
                'SELECT id, code, name, start_time, end_time, status, sigillo_chiusura, simulazione FROM emergencies WHERE id = $1', [emergenzaId]);
            const emergenza = emergenze[0];
            const sigilloChiusura = emergenza?.sigillo_chiusura || null;
            if (emergenza) delete emergenza.sigillo_chiusura;
            // ?completo=1: ogni segnalazione per intero (dati, diario, foto),
            // per stampare tutta l'emergenza in una volta.
            const completo = req.query.completo === '1';
            if (!emergenza) return res.status(404).json({ message: 'Emergenza non trovata.' });
            const chiusa = emergenza.status !== 'ACTIVE';
            // Come l'archivio: le emergenze chiuse le consulta chi ha il permesso.
            if (chiusa && !haPermesso(req, 'emergenze.archivio')) {
                return res.status(403).json({ message: "Il resoconto di un'emergenza chiusa lo vede l'amministratore, dall'archivio." });
            }

            const [segnalazioni, squadre, diario, associazione, funzioni, elementiMappa] = await Promise.all([
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
                    .then(r => r.rows[0]?.setting_value || null).catch(() => null),
                incarichiPerFunzione(pool, emergenzaId),
                // Strade chiuse e zone dell'emergenza, anche quelle già tolte.
                pool.query(`SELECT id, tipo, nome, livello, note, creato_il, creato_da, rimosso_il, rimosso_da, oltre_emergenza
                            FROM elementi_mappa WHERE emergency_id = $1
                            ORDER BY (rimosso_il IS NOT NULL), tipo, creato_il`, [emergenzaId]).then(r => r.rows)
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

            // Il sigillo dello storico in fondo al foglio: per un'emergenza chiusa
            // quello preso alla chiusura, altrimenti quello di adesso. Chi lo
            // conserva può dimostrare poi che diario e note non sono stati cambiati.
            const sigillo = chiusa && sigilloChiusura
                ? { testo: sigilloChiusura, alla_chiusura: true }
                : await sigilloAttuale().then(s => ({ testo: testoSigillo(s), alla_chiusura: false })).catch(() => null);
            const schede = completo ? await schedeComplete(pool, emergenzaId) : undefined;
            const quadro = await leggiQuadro(pool, emergenzaId);
            registraAudit(req, 'emergenza.situazione_stampata', { tipo: 'emergenza', id: emergenzaId, dettagli: { code: emergenza.code, chiusa } });
            res.json({
                emergenza, chiusa, associazione, quadro,
                generato_il: new Date().toISOString(),
                generato_da: [req.user.nome, req.user.cognome].filter(Boolean).join(' ') || req.user.username,
                aperte, chiuse,
                squadre: squadre,
                diario: diarioTroncato ? voci.slice(-VOCI_DIARIO_IN_CORSO) : voci,
                diario_troncato: diarioTroncato,
                funzioni,
                mappa: elementiMappa,
                sigillo,
                schede
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
               COALESCE((SELECT json_agg(json_build_object('nome', sm.nome, 'cognome', sm.cognome, 'caposquadra', sm.caposquadra)
                                         ORDER BY sm.caposquadra DESC, sm.cognome, sm.nome)
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
        WITH capi AS (
            SELECT DISTINCT nome_radio, username FROM emergency_team_log
            WHERE emergency_id = $1 AND azione = 'caposquadra_nominato'
        ), persone AS (
            SELECT l.nome_radio, MAX(l.squadra_nome) AS nome,
                   json_agg(DISTINCT jsonb_build_object('nome', l.nome, 'cognome', l.cognome,
                       'caposquadra', EXISTS (SELECT 1 FROM capi c WHERE c.nome_radio = l.nome_radio AND c.username = l.username))) AS membri
            FROM emergency_team_log l
            WHERE l.emergency_id = $1 AND l.azione = 'membro_aggiunto'
            GROUP BY l.nome_radio
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

// Le funzioni di supporto con un incarico in questa emergenza: referenti e
// incarichi (prima gli aperti, dal più vecchio). Modulo spento: niente.
async function incarichiPerFunzione(pool, emergenzaId) {
    const acceso = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'funzioni_enabled'");
    if (String(acceso.rows[0]?.setting_value) !== 'true') return null;
    const { rows } = await pool.query(`
        SELECT f.id, f.sigla, f.nome,
               COALESCE((SELECT string_agg(TRIM(CONCAT(u.nome, ' ', u.cognome)), ', ' ORDER BY u.cognome)
                           FROM funzione_membri m JOIN users u ON u.id = m.user_id
                          WHERE m.funzione_id = f.id AND m.referente AND COALESCE(u.is_active, true)), '') AS referenti,
               json_agg(json_build_object(
                   'id', i.id, 'stato', i.stato, 'motivazione', i.motivazione, 'esito', i.esito,
                   'assegnato_il', i.assegnato_il, 'assegnato_da', i.assegnato_da,
                   'in_carico_da', i.in_carico_da, 'concluso_il', i.concluso_il, 'concluso_da', i.concluso_da,
                   'report_id', r.id, 'numero', r.emergency_report_number, 'titolo', r.title, 'indirizzo', r.location_address
               ) ORDER BY (i.stato = 'concluso'), i.assegnato_il) AS incarichi
        FROM incarichi i
        JOIN funzioni f ON f.id = i.funzione_id
        JOIN reports r ON r.id = i.report_id
        WHERE r.emergency_id = $1
        GROUP BY f.id
        ORDER BY f.ordine, f.sigla`, [emergenzaId]);
    return rows;
}

// Ogni segnalazione per intero, per la stampa completa: dati, squadre, tutto
// il diario (con la sigla della funzione, se c'è) e le foto.
async function schedeComplete(pool, emergenzaId) {
    const { rows } = await pool.query(`
        SELECT r.id, r.emergency_report_number AS numero, r.title, r.description, r.status, r.priority,
               r.location_address, r.latitude, r.longitude, NULLIF(TRIM(r.environmental_hazard), '') AS pericolo,
               r.reporter_name, r.reporter_contact, r.no_team_reason, r.created_at, r.updated_at,
               NULLIF(TRIM(CONCAT(c.nome, ' ', c.cognome)), '') AS creata_da,
               COALESCE((SELECT string_agg(COALESCE(s.nome_radio, a.nome_radio), ', ' ORDER BY COALESCE(s.nome_radio, a.nome_radio))
                           FROM report_team_assignments a LEFT JOIN squadre s ON s.id = a.squadra_id
                          WHERE a.report_id = r.id), '') AS squadre,
               COALESCE((SELECT json_agg(json_build_object(
                                 'quando', ru.update_timestamp, 'testo', ru.update_text, 'sistema', ru.is_system, 'funzione', f.sigla,
                                 'autore', NULLIF(TRIM(CONCAT(us.nome, ' ', us.cognome)), '')) ORDER BY ru.update_timestamp, ru.id)
                           FROM report_updates ru LEFT JOIN users us ON us.id = ru.user_id LEFT JOIN funzioni f ON f.id = ru.funzione_id
                          WHERE ru.report_id = r.id), '[]'::json) AS diario,
               COALESCE((SELECT json_agg(ri.image_url ORDER BY ri.image_id) FROM report_images ri WHERE ri.report_id = r.id), '[]'::json) AS foto
        FROM reports r LEFT JOIN users c ON c.id = r.creator_user_id
        WHERE r.emergency_id = $1
        ORDER BY COALESCE(r.emergency_report_number, r.id)`, [emergenzaId]);
    return rows.map(r => {
        const scheda = { ...r, motivo_senza_squadra: MOTIVI_SENZA_SQUADRA[r.no_team_reason] || null };
        delete scheda.no_team_reason;
        return scheda;
    });
}
