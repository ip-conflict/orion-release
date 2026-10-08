// src/funzioni.js
//
// Le funzioni di supporto del COC (metodo Augustus). Si accendono dalle
// impostazioni (funzioni_enabled); spente, le rotte rispondono 404 e le
// pagine non mostrano niente.
//
// Un incarico affida a una funzione un compito su una segnalazione: si
// assegna con la motivazione, si prende in carico, si conclude con l'esito.
// Concluderlo non chiude la segnalazione, e chiudere la segnalazione non
// conclude gli incarichi. Ogni passaggio finisce nel diario della
// segnalazione, con l'etichetta della funzione.
//
// Chi fa cosa:
//   assegnare e annullare      gli operatori interni (come per le squadre);
//   prendere in carico e       i membri della funzione, anche esterni o
//   concludere                 temporanei, e gli operatori interni;
//   membri fissi               chi organizza le funzioni (permessi.js);
//   membri temporanei          a emergenza aperta, ogni operatore interno.

import { haPermesso, richiedePermesso } from './permessi.js';

const LIMITE_TESTO = 2000;

export function registraRotteFunzioni(app, ctx) {
    const { pool, logger, haRuolo, ruoliDi, registraAudit, nomeUtente, avvisaClienti, notificaA, emergenzaAttiva, checkAdminRole } = ctx;

    const interno = (req) => !ruoliDi(req.user).includes('esterno');

    async function moduloAcceso() {
        const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'funzioni_enabled'");
        return String(r.rows[0]?.setting_value) === 'true';
    }

    // Davanti a tutte le rotte del modulo: spento, non esiste.
    async function soloSeAcceso(req, res, next) {
        try {
            if (await moduloAcceso()) return next();
            res.status(404).json({ message: 'Il modulo delle funzioni di supporto non è attivo.', modulo_spento: true });
        } catch (e) {
            logger.error('Errore lettura funzioni_enabled:', e);
            res.status(500).json({ message: 'Errore interno.' });
        }
    }

    const testo = (v, max = LIMITE_TESTO) => (typeof v === 'string' ? v.trim() : '').slice(0, max);
    const intero = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

    async function membroDi(userId, funzioneId, esecutore = pool) {
        const r = await esecutore.query('SELECT 1 FROM funzione_membri WHERE user_id = $1 AND funzione_id = $2', [userId, funzioneId]);
        return r.rowCount > 0;
    }

    async function leggiMembri(funzioneIds) {
        if (!funzioneIds.length) return new Map();
        const { rows } = await pool.query(`
            SELECT m.funzione_id, m.user_id, m.referente, u.nome, u.cognome, u.ente, u.temporaneo,
                   EXISTS (SELECT 1 FROM utenti_ruoli r WHERE r.user_id = u.id AND r.ruolo = 'esterno') AS esterno
            FROM funzione_membri m JOIN users u ON u.id = m.user_id
            WHERE m.funzione_id = ANY($1::int[]) AND COALESCE(u.is_active, true)
            ORDER BY m.referente DESC, u.cognome, u.nome`, [funzioneIds]);
        const mappa = new Map();
        rows.forEach(r => {
            if (!mappa.has(r.funzione_id)) mappa.set(r.funzione_id, []);
            mappa.get(r.funzione_id).push(r);
        });
        return mappa;
    }

    // L'incarico con quello che serve a chi lo guarda: funzione e segnalazione.
    const SELECT_INCARICO = `
        SELECT i.*, f.sigla, f.nome AS funzione_nome,
               r.emergency_report_number AS numero, r.title AS report_titolo, r.location_address,
               r.status AS report_stato, r.priority AS report_priorita, r.latitude, r.longitude, r.emergency_id
        FROM incarichi i JOIN funzioni f ON f.id = i.funzione_id JOIN reports r ON r.id = i.report_id`;

    // Con blocca, dentro una transazione: la riga resta ferma finché non si
    // chiude, così due "Concludi" nello stesso istante non passano entrambi.
    async function leggiIncarico(id, esecutore = pool, { blocca = false } = {}) {
        const { rows } = await esecutore.query(`${SELECT_INCARICO} WHERE i.id = $1${blocca ? ' FOR UPDATE OF i' : ''}`, [id]);
        return rows[0] || null;
    }

    // Una riga nel diario della segnalazione, con l'etichetta della funzione,
    // e l'avviso alle postazioni aperte.
    async function annota(client, req, reportId, funzioneId, testoNota) {
        const { rows } = await client.query(
            `WITH nuova AS (
                INSERT INTO report_updates (report_id, update_text, user_id, is_system, funzione_id)
                VALUES ($1, $2, $3, true, $4) RETURNING *
             )
             SELECT n.*, CONCAT(u.nome, ' ', u.cognome) AS updater_fullname, f.sigla AS funzione_sigla
             FROM nuova n JOIN users u ON u.id = n.user_id LEFT JOIN funzioni f ON f.id = n.funzione_id`,
            [reportId, testoNota, req.user.id, funzioneId]);
        await client.query('UPDATE reports SET updated_at = NOW() WHERE id = $1', [reportId]);
        return rows[0];
    }

    // daUtente: chi ha fatto la modifica, che sul suo schermo non la vede come novità.
    function avvisaPostazioni(reportId, nota, daUtente) {
        if (nota) avvisaClienti('new_report_update', { reportId, update: nota });
        avvisaClienti('reload_incarichi', { reportId });
        avvisaClienti('reload_reports', { updatedReportId: reportId, daUtente });
    }

    // L'incarico si tocca solo dentro l'emergenza in corso.
    function nellEmergenzaAttiva(incarico) {
        const attiva = emergenzaAttiva();
        return !!attiva && incarico.emergency_id === attiva.id;
    }

    // ------------------------------------------------------------------
    // Funzioni e membri

    // L'elenco per chi lavora: le funzioni accese, i membri (non agli
    // esterni, che vedono solo le proprie) e quanti incarichi aperti hanno.
    app.get('/api/funzioni', soloSeAcceso, async (req, res) => {
        try {
            const attiva = emergenzaAttiva();
            const { rows } = await pool.query(`
                SELECT f.id, f.sigla, f.nome, f.descrizione, f.ordine,
                       EXISTS (SELECT 1 FROM funzione_membri m WHERE m.funzione_id = f.id AND m.user_id = $1) AS mia,
                       (SELECT COUNT(*)::int FROM incarichi i JOIN reports r ON r.id = i.report_id
                         WHERE i.funzione_id = f.id AND i.stato <> 'concluso' AND r.emergency_id = $2) AS aperti
                FROM funzioni f WHERE f.attiva
                ORDER BY f.ordine, f.sigla`, [req.user.id, attiva?.id ?? null]);
            const membri = await leggiMembri(rows.map(f => f.id));
            const eInterno = interno(req);
            res.json({
                attivo: true,
                funzioni: rows.map(f => ({ ...f, membri: (eInterno || f.mia) ? (membri.get(f.id) || []) : [] }))
            });
        } catch (e) {
            logger.error('Errore GET /api/funzioni:', e);
            res.status(500).json({ message: 'Errore nel leggere le funzioni.' });
        }
    });

    // Per l'amministratore: tutte, anche quelle spente. Risponde anche a
    // modulo spento, perché le funzioni si preparano prima di accenderlo.
    app.get('/api/admin/funzioni', richiedePermesso('emergenze.funzioni'), async (req, res) => {
        try {
            const { rows } = await pool.query('SELECT id, sigla, nome, descrizione, attiva, ordine FROM funzioni ORDER BY ordine, sigla');
            const membri = await leggiMembri(rows.map(f => f.id));
            res.json({ attivo: await moduloAcceso(), funzioni: rows.map(f => ({ ...f, membri: membri.get(f.id) || [] })) });
        } catch (e) {
            logger.error('Errore GET /api/admin/funzioni:', e);
            res.status(500).json({ message: 'Errore nel leggere le funzioni.' });
        }
    });

    function leggiFunzione(corpo) {
        const sigla = testo(corpo?.sigla, 10);
        const nome = testo(corpo?.nome, 120);
        if (!sigla || !nome) return { errore: 'Servono la sigla (F1, F2…) e il nome della funzione.' };
        return { dati: { sigla, nome, descrizione: testo(corpo?.descrizione) || null, attiva: corpo?.attiva !== false, ordine: Number.isInteger(corpo?.ordine) ? corpo.ordine : null } };
    }

    app.post('/api/admin/funzioni', richiedePermesso('emergenze.funzioni'), async (req, res) => {
        const { dati, errore } = leggiFunzione(req.body);
        if (errore) return res.status(400).json({ message: errore });
        try {
            const { rows } = await pool.query(
                `INSERT INTO funzioni (sigla, nome, descrizione, attiva, ordine)
                 VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(MAX(ordine), 0) + 1 FROM funzioni)))
                 RETURNING id, sigla, nome, descrizione, attiva, ordine`,
                [dati.sigla, dati.nome, dati.descrizione, dati.attiva, dati.ordine]);
            registraAudit(req, 'funzione.creata', { tipo: 'funzione', id: rows[0].id, dettagli: { sigla: dati.sigla, nome: dati.nome } });
            avvisaClienti('reload_funzioni');
            res.status(201).json({ ...rows[0], membri: [] });
        } catch (e) {
            logger.error('Errore POST /api/admin/funzioni:', e);
            res.status(500).json({ message: 'Errore nel creare la funzione.' });
        }
    });

    app.put('/api/admin/funzioni/:id', richiedePermesso('emergenze.funzioni'), async (req, res) => {
        const id = intero(req.params.id);
        const { dati, errore } = leggiFunzione(req.body);
        if (!id) return res.status(400).json({ message: 'Funzione non valida.' });
        if (errore) return res.status(400).json({ message: errore });
        try {
            const { rows } = await pool.query(
                `UPDATE funzioni SET sigla = $2, nome = $3, descrizione = $4, attiva = $5, ordine = COALESCE($6, ordine)
                 WHERE id = $1 RETURNING id, sigla, nome, descrizione, attiva, ordine`,
                [id, dati.sigla, dati.nome, dati.descrizione, dati.attiva, dati.ordine]);
            if (!rows[0]) return res.status(404).json({ message: 'Funzione non trovata.' });
            registraAudit(req, 'funzione.modificata', { tipo: 'funzione', id, dettagli: dati });
            avvisaClienti('reload_funzioni');
            res.json(rows[0]);
        } catch (e) {
            logger.error('Errore PUT /api/admin/funzioni:', e);
            res.status(500).json({ message: 'Errore nel salvare la funzione.' });
        }
    });

    // Chi può toccare i membri: l'amministratore sempre e per chiunque; a
    // emergenza aperta ogni operatore interno, ma solo per gli accessi
    // temporanei (le persone arrivate per l'emergenza).
    async function puoGestireMembro(req, userId) {
        if (haPermesso(req, 'emergenze.funzioni')) return { ok: true };
        if (!interno(req)) return { ok: false, stato: 403, message: 'I membri delle funzioni li gestiscono gli operatori del COC.' };
        if (!emergenzaAttiva()) return { ok: false, stato: 403, message: "Fuori emergenza i membri delle funzioni li gestisce l'amministratore." };
        const r = await pool.query('SELECT temporaneo FROM users WHERE id = $1', [userId]);
        if (!r.rows[0]) return { ok: false, stato: 404, message: 'Utente non trovato.' };
        if (r.rows[0].temporaneo !== true) return { ok: false, stato: 403, message: "Gli utenti fissi li assegna alle funzioni l'amministratore: a emergenza aperta si aggiungono gli accessi temporanei." };
        return { ok: true };
    }

    app.post('/api/funzioni/:id/membri', soloSeAcceso, async (req, res) => {
        const funzioneId = intero(req.params.id);
        const userId = intero(req.body?.user_id);
        if (!funzioneId || !userId) return res.status(400).json({ message: 'Funzione o utente non validi.' });
        try {
            const permesso = await puoGestireMembro(req, userId);
            if (!permesso.ok) return res.status(permesso.stato).json({ message: permesso.message });
            const esiste = await pool.query(`SELECT f.sigla, u.nome, u.cognome FROM funzioni f, users u
                WHERE f.id = $1 AND u.id = $2 AND COALESCE(u.is_active, true)`, [funzioneId, userId]);
            if (!esiste.rows[0]) return res.status(404).json({ message: 'Funzione o utente non trovati.' });
            await pool.query(
                `INSERT INTO funzione_membri (funzione_id, user_id, referente, aggiunto_da) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (funzione_id, user_id) DO UPDATE SET referente = EXCLUDED.referente`,
                [funzioneId, userId, req.body?.referente === true, nomeUtente(req.user)]);
            registraAudit(req, 'funzione.membro_aggiunto', { tipo: 'funzione', id: funzioneId, dettagli: { user_id: userId, sigla: esiste.rows[0].sigla, referente: req.body?.referente === true } });
            avvisaClienti('reload_funzioni');
            res.status(201).json({ message: `${esiste.rows[0].nome || ''} ${esiste.rows[0].cognome || ''}`.trim() + ` è nella ${esiste.rows[0].sigla}.` });
        } catch (e) {
            logger.error('Errore POST membri funzione:', e);
            res.status(500).json({ message: "Errore nell'aggiungere il membro." });
        }
    });

    app.patch('/api/funzioni/:id/membri/:userId', soloSeAcceso, async (req, res) => {
        const funzioneId = intero(req.params.id);
        const userId = intero(req.params.userId);
        if (!funzioneId || !userId) return res.status(400).json({ message: 'Funzione o utente non validi.' });
        try {
            const permesso = await puoGestireMembro(req, userId);
            if (!permesso.ok) return res.status(permesso.stato).json({ message: permesso.message });
            const r = await pool.query('UPDATE funzione_membri SET referente = $3 WHERE funzione_id = $1 AND user_id = $2',
                [funzioneId, userId, req.body?.referente === true]);
            if (!r.rowCount) return res.status(404).json({ message: 'Non è un membro di questa funzione.' });
            registraAudit(req, 'funzione.referente', { tipo: 'funzione', id: funzioneId, dettagli: { user_id: userId, referente: req.body?.referente === true } });
            avvisaClienti('reload_funzioni');
            res.json({ message: 'Fatto.' });
        } catch (e) {
            logger.error('Errore PATCH membri funzione:', e);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });

    app.delete('/api/funzioni/:id/membri/:userId', soloSeAcceso, async (req, res) => {
        const funzioneId = intero(req.params.id);
        const userId = intero(req.params.userId);
        if (!funzioneId || !userId) return res.status(400).json({ message: 'Funzione o utente non validi.' });
        try {
            const permesso = await puoGestireMembro(req, userId);
            if (!permesso.ok) return res.status(permesso.stato).json({ message: permesso.message });
            const r = await pool.query('DELETE FROM funzione_membri WHERE funzione_id = $1 AND user_id = $2', [funzioneId, userId]);
            if (!r.rowCount) return res.status(404).json({ message: 'Non è un membro di questa funzione.' });
            registraAudit(req, 'funzione.membro_tolto', { tipo: 'funzione', id: funzioneId, dettagli: { user_id: userId } });
            avvisaClienti('reload_funzioni');
            res.json({ message: 'Tolto dalla funzione.' });
        } catch (e) {
            logger.error('Errore DELETE membri funzione:', e);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });

    // ------------------------------------------------------------------
    // Incarichi

    // Gli incarichi dell'emergenza in corso. ?funzione=ID per un tavolo solo,
    // ?stato=tutti per vedere anche i conclusi. Un esterno vede solo quelli
    // delle sue funzioni.
    app.get('/api/incarichi', soloSeAcceso, async (req, res) => {
        const attiva = emergenzaAttiva();
        if (!attiva) return res.json([]);
        const funzione = intero(req.query.funzione);
        const tutti = req.query.stato === 'tutti';
        try {
            const { rows } = await pool.query(`${SELECT_INCARICO}
                WHERE r.emergency_id = $1
                  AND ($2::int IS NULL OR i.funzione_id = $2)
                  AND ($3::boolean OR i.stato <> 'concluso')
                  AND ($4::boolean OR EXISTS (SELECT 1 FROM funzione_membri m WHERE m.funzione_id = i.funzione_id AND m.user_id = $5))
                ORDER BY (i.stato = 'concluso'), i.assegnato_il`,
                [attiva.id, funzione, tutti, interno(req), req.user.id]);
            res.json(rows);
        } catch (e) {
            logger.error('Errore GET /api/incarichi:', e);
            res.status(500).json({ message: 'Errore nel leggere gli incarichi.' });
        }
    });

    // Gli incarichi di una segnalazione: li vede chi vede la segnalazione.
    app.get('/api/reports/:id/incarichi', soloSeAcceso, async (req, res) => {
        const reportId = intero(req.params.id);
        if (!reportId) return res.status(400).json({ message: 'Segnalazione non valida.' });
        try {
            const { rows } = await pool.query(`${SELECT_INCARICO} WHERE i.report_id = $1 ORDER BY i.assegnato_il`, [reportId]);
            const attiva = emergenzaAttiva();
            if (rows[0] && !(attiva && rows[0].emergency_id === attiva.id) && !haPermesso(req, 'emergenze.archivio')) {
                return res.status(403).json({ message: "Gli incarichi di un'emergenza chiusa li vede l'amministratore." });
            }
            // Per ogni incarico: chi lo sta guardando può prenderlo o concluderlo?
            const mie = new Set((await pool.query('SELECT funzione_id FROM funzione_membri WHERE user_id = $1', [req.user.id])).rows.map(r => r.funzione_id));
            res.json(rows.map(i => ({ ...i, posso_agire: i.stato !== 'concluso' && (interno(req) || mie.has(i.funzione_id)) })));
        } catch (e) {
            logger.error('Errore GET incarichi segnalazione:', e);
            res.status(500).json({ message: 'Errore nel leggere gli incarichi.' });
        }
    });

    app.post('/api/reports/:id/incarichi', soloSeAcceso, async (req, res) => {
        if (!interno(req)) return res.status(403).json({ message: 'Gli incarichi alle funzioni li assegnano gli operatori del COC.' });
        const reportId = intero(req.params.id);
        const funzioneId = intero(req.body?.funzione_id);
        const motivazione = testo(req.body?.motivazione);
        if (!reportId || !funzioneId) return res.status(400).json({ message: 'Segnalazione o funzione non valide.' });
        if (!motivazione) return res.status(400).json({ message: 'Scrivi perché la funzione deve occuparsene: è quello che leggerà chi prende l\'incarico.' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const rep = await client.query('SELECT id, emergency_id, emergency_report_number, title FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
            if (!rep.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Segnalazione non trovata.' }); }
            const attiva = emergenzaAttiva();
            if (!attiva || rep.rows[0].emergency_id !== attiva.id) { await client.query('ROLLBACK'); return res.status(403).json({ message: "Si assegna solo sulle segnalazioni dell'emergenza in corso." }); }
            const fun = await client.query('SELECT id, sigla, nome FROM funzioni WHERE id = $1 AND attiva', [funzioneId]);
            if (!fun.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Funzione non trovata o spenta.' }); }
            const chi = nomeUtente(req.user);
            let nuovo;
            try {
                nuovo = await client.query(
                    `INSERT INTO incarichi (report_id, funzione_id, motivazione, assegnato_da) VALUES ($1, $2, $3, $4) RETURNING id`,
                    [reportId, funzioneId, motivazione, chi]);
            } catch (e) {
                if (e.code === '23505') {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ message: `La ${fun.rows[0].sigla} ha già un incarico aperto su questa segnalazione: aggiungi lì una nota.` });
                }
                throw e;
            }
            const { sigla, nome } = fun.rows[0];
            const nota = await annota(client, req, reportId, funzioneId, `Incarico alla funzione ${sigla} ${nome}: ${motivazione}`);
            await client.query('COMMIT');

            const incarico = await leggiIncarico(nuovo.rows[0].id);
            registraAudit(req, 'incarico.assegnato', { tipo: 'incarico', id: incarico.id, dettagli: { report_id: reportId, sigla, motivazione } });
            avvisaPostazioni(reportId, nota, req.user.id);
            // Chi è nella funzione lo sa subito, anche sul telefono.
            const membri = (await pool.query('SELECT user_id FROM funzione_membri WHERE funzione_id = $1 AND user_id <> $2', [funzioneId, req.user.id])).rows.map(r => r.user_id);
            const numero = rep.rows[0].emergency_report_number ?? reportId;
            notificaA(membri, {
                tipo: 'incarico_funzione', categoria: 'emergenza',
                titolo: `${sigla}: incarico sulla segnalazione #${numero}`,
                testo: `${rep.rows[0].title} — ${motivazione}`.slice(0, 500),
                riferimento: { tipo: 'intervento', id: reportId },
                chiave: `incarico-${incarico.id}`, oreValidita: 72
            }).catch(e => logger.warn(`[Funzioni] Notifica incarico non accodata: ${e.message}`));
            res.status(201).json(incarico);
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore POST incarichi:', e);
            res.status(500).json({ message: "Errore nell'assegnare l'incarico." });
        } finally {
            client.release();
        }
    });

    // Prendere in carico o concludere: i membri della funzione e gli operatori interni.
    async function aggiornaIncarico(req, res, azione) {
        const id = intero(req.params.id);
        if (!id) return res.status(400).json({ message: 'Incarico non valido.' });
        const esito = testo(req.body?.esito);
        if (azione === 'concludi' && !esito) return res.status(400).json({ message: "Scrivi com'è andata: l'esito resta nel diario e nel resoconto." });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const incarico = await leggiIncarico(id, client, { blocca: true });
            if (!incarico) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Incarico non trovato.' }); }
            if (!nellEmergenzaAttiva(incarico)) { await client.query('ROLLBACK'); return res.status(403).json({ message: "L'incarico è di un'emergenza chiusa." }); }
            if (!interno(req) && !(await membroDi(req.user.id, incarico.funzione_id, client))) {
                await client.query('ROLLBACK');
                return res.status(403).json({ message: `Questo incarico è della ${incarico.sigla}: lo gestiscono i suoi membri e gli operatori del COC.` });
            }
            if (incarico.stato === 'concluso') { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Incarico già concluso.' }); }
            const chi = nomeUtente(req.user);
            let nota;
            if (azione === 'presa') {
                await client.query(`UPDATE incarichi SET stato = 'in_corso', in_carico_il = NOW(), in_carico_da = $2 WHERE id = $1`, [id, chi]);
                nota = await annota(client, req, incarico.report_id, incarico.funzione_id, `${incarico.sigla}: preso in carico da ${chi}.`);
            } else {
                await client.query(
                    `UPDATE incarichi SET stato = 'concluso', concluso_il = NOW(), concluso_da = $2, esito = $3,
                            in_carico_il = COALESCE(in_carico_il, NOW()), in_carico_da = COALESCE(in_carico_da, $2)
                     WHERE id = $1`, [id, chi, esito]);
                nota = await annota(client, req, incarico.report_id, incarico.funzione_id, `${incarico.sigla}: incarico concluso. ${esito}`);
            }
            await client.query('COMMIT');
            registraAudit(req, azione === 'presa' ? 'incarico.preso_in_carico' : 'incarico.concluso', { tipo: 'incarico', id, dettagli: { report_id: incarico.report_id, sigla: incarico.sigla, esito: esito || undefined } });
            avvisaPostazioni(incarico.report_id, nota, req.user.id);
            res.json(await leggiIncarico(id));
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error(`Errore ${azione} incarico:`, e);
            res.status(500).json({ message: "Errore nell'aggiornare l'incarico." });
        } finally {
            client.release();
        }
    }

    app.post('/api/incarichi/:id/presa', soloSeAcceso, (req, res) => aggiornaIncarico(req, res, 'presa'));
    app.post('/api/incarichi/:id/concludi', soloSeAcceso, (req, res) => aggiornaIncarico(req, res, 'concludi'));

    // Annullare un incarico dato per sbaglio: solo se nessuno l'ha ancora preso.
    app.delete('/api/incarichi/:id', soloSeAcceso, async (req, res) => {
        if (!interno(req)) return res.status(403).json({ message: 'Gli incarichi li annullano gli operatori del COC.' });
        const id = intero(req.params.id);
        if (!id) return res.status(400).json({ message: 'Incarico non valido.' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const incarico = await leggiIncarico(id, client, { blocca: true });
            if (!incarico) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Incarico non trovato.' }); }
            if (!nellEmergenzaAttiva(incarico)) { await client.query('ROLLBACK'); return res.status(403).json({ message: "L'incarico è di un'emergenza chiusa." }); }
            if (incarico.stato !== 'aperto') { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Qualcuno lo ha già preso in carico: si conclude, con un esito, non si annulla.' }); }
            await client.query('DELETE FROM incarichi WHERE id = $1', [id]);
            const nota = await annota(client, req, incarico.report_id, incarico.funzione_id, `${incarico.sigla}: incarico annullato da ${nomeUtente(req.user)}.`);
            await client.query('COMMIT');
            registraAudit(req, 'incarico.annullato', { tipo: 'incarico', id, dettagli: { report_id: incarico.report_id, sigla: incarico.sigla, motivazione: incarico.motivazione } });
            avvisaPostazioni(incarico.report_id, nota, req.user.id);
            res.json({ message: 'Incarico annullato.' });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore DELETE incarico:', e);
            res.status(500).json({ message: "Errore nell'annullare l'incarico." });
        } finally {
            client.release();
        }
    });

    return { moduloAcceso, membroDi };
}
