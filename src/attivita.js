// src/attivita.js
//
// Le attività del gruppo fuori emergenza e il calendario.
//
// Un'attività (esercitazione, addestramento, servizio, riunione,
// manutenzione) ha un modo di convocare: tutti gli interni, solo alcuni
// scelti, oppure "aperta" (la vedono tutti e aderisce chi vuole, fino ai
// posti). La convocazione arriva con l'avviso nell'app, con l'email, con
// entrambi o con niente; chi la riceve risponde "Ci sono" o "Non posso". Chi
// organizza vede le risposte e chi non è raggiungibile né dall'app né per
// email, da chiamare a voce. Alla fine la si chiude con i presenti e gli
// orari: le ore vanno nelle presenze di ognuno (src/presenze.js), e un
// addestramento che vale come corso lo scrive nel libretto dei presenti.
//
// Chi vede un'attività: chi ha gruppo.attivita (il Coordinatore lo ha nel
// pacchetto), il responsabile, e i convocati; con "tutti" e "aperta" ogni
// interno. Gli esterni no.
//
// Il calendario mette insieme le attività, le emergenze e le scadenze: le
// proprie (visite e corsi) per ognuno, quelle della segreteria a chi gestisce
// visite e corsi, quelle del magazzino a chi lo gestisce. Le scadenze
// arrivano raggruppate per giorno, per non riempire il calendario.
//
// Il modulo si spegne dalle impostazioni (attivita_enabled): spento, le rotte
// rispondono 404 e le attività restano dove sono.

import logger from './logger.js';
import { registraAudit } from './audit.js';
import { domainName } from './config.js';
import { dataItaliana, dataOraItaliana, fusoOrario, oraItaliana } from './date.js';
import { pool } from './db.js';
import { escapeHtmlForEmail, sendEmailUtility } from './email.js';
import { haPermesso, richiedePermesso } from './permessi.js';
import { ruoliDi } from './autenticazione.js';
import { notifiche } from './tempoReale.js';
import { registraPresenzeAttivita } from './presenze.js';

const LIMITE = { titolo: 150, descrizione: 4000, luogo: 200, nota: 300, motivo: 300, scenario: 4000, enti: 500 };
const NATURE = ['generica', 'addestramento', 'esercitazione'];
const GIORNI_MASSIMI_CALENDARIO = 400;

export async function attivitaAccese(esecutore = pool) {
    const r = await esecutore.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'attivita_enabled'");
    return String(r.rows[0]?.setting_value ?? 'true') !== 'false';
}

// Gli interni attivi: quelli che si possono convocare.
const SQL_INTERNI = `
    SELECT u.id, u.username, u.nome, u.cognome, NULLIF(TRIM(u.email), '') AS email
      FROM users u
     WHERE COALESCE(u.is_active, true) = true AND u.eliminato_il IS NULL
       AND NOT EXISTS (SELECT 1 FROM utenti_ruoli ur WHERE ur.user_id = u.id AND ur.ruolo = 'esterno')`;

function testo(valore, massimo) {
    if (valore === undefined || valore === null) return null;
    const t = String(valore).trim();
    return t ? t.slice(0, massimo) : null;
}

function istante(valore) {
    if (typeof valore !== 'string' || !valore.trim()) return null;
    const d = new Date(valore);
    return Number.isNaN(d.getTime()) ? null : d;
}

function giorno(valore) {
    return typeof valore === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valore) ? valore : null;
}

function interoOpzionale(valore) {
    if (valore === undefined || valore === null || valore === '') return null;
    const n = parseInt(valore, 10);
    return Number.isInteger(n) ? n : NaN;
}

const sonoEsterno = (req) => ruoliDi(req.user).includes('esterno');
const organizza = (req) => haPermesso(req, 'gruppo.attivita');

function soloInterni(req, res, next) {
    if (!sonoEsterno(req)) return next();
    return res.status(403).json({ message: 'Le attività del gruppo sono riservate agli interni.' });
}

async function moduloAcceso(req, res, next) {
    try {
        if (await attivitaAccese()) return next();
        return res.status(404).json({ message: 'Il modulo Attività è spento.', modulo_spento: true });
    } catch (e) {
        logger.error('Errore lettura attivita_enabled:', e);
        return res.status(500).json({ message: 'Errore interno.' });
    }
}

// L'attività con il suo tipo, i conteggi delle risposte e la riga di chi chiede.
const SELECT_ATTIVITA = `
    SELECT a.id, a.tipo_id, t.nome AS tipo, a.titolo, a.descrizione, a.luogo, a.inizio, a.fine,
           a.convocazione, a.posti, a.avviso_app, a.avviso_email, a.responsabile_id,
           NULLIF(TRIM(CONCAT(r.nome, ' ', r.cognome)), '') AS responsabile_nome,
           a.corso_id, c.name AS corso_nome, a.stato, a.motivo_annullamento, a.conclusa_il, a.creato_il, a.creato_da,
           (SELECT COUNT(*)::int FROM attivita_persone p WHERE p.attivita_id = a.id AND p.risposta = 'si') AS si,
           (SELECT COUNT(*)::int FROM attivita_persone p WHERE p.attivita_id = a.id AND p.risposta = 'no') AS no,
           (SELECT COUNT(*)::int FROM attivita_persone p WHERE p.attivita_id = a.id AND p.convocato) AS convocati,
           (SELECT COUNT(*)::int FROM partecipazioni x WHERE x.attivita_id = a.id) AS presenti,
           mia.convocato AS sono_convocato, mia.risposta AS mia_risposta, mia.nota AS mia_nota,
           t.natura, a.simulazione, a.scenario, a.obiettivi, a.enti,
           COALESCE((SELECT json_agg(json_build_object('id', u.id, 'nome', u.nome, 'cognome', u.cognome) ORDER BY u.cognome, u.nome)
                       FROM attivita_regia g JOIN users u ON u.id = g.user_id WHERE g.attivita_id = a.id), '[]'::json) AS regia,
           EXISTS (SELECT 1 FROM attivita_regia g WHERE g.attivita_id = a.id AND g.user_id = $1) AS sono_regia,
           -- La sala della simulazione: l'ultima aperta per questa attività.
           (SELECT json_build_object('id', e.id, 'codice', e.code, 'aperta', e.status = 'ACTIVE',
                                     'inizio', e.start_time, 'fine', e.end_time, 'interrotta', e.interrotta_il IS NOT NULL)
              FROM emergencies e WHERE e.attivita_id = a.id ORDER BY e.id DESC LIMIT 1) AS sala
      FROM attivita a
      LEFT JOIN attivita_tipi t ON t.id = a.tipo_id
      LEFT JOIN users r ON r.id = a.responsabile_id
      LEFT JOIN courses_catalog c ON c.id = a.corso_id
      LEFT JOIN attivita_persone mia ON mia.attivita_id = a.id AND mia.user_id = $1`;

// La condizione di visibilità, con $1 = chi chiede e $2 = se organizza.
const VISIBILE = `($2::boolean OR a.convocazione IN ('tutti', 'aperta') OR a.responsabile_id = $1 OR mia.convocato
    OR EXISTS (SELECT 1 FROM attivita_regia g WHERE g.attivita_id = a.id AND g.user_id = $1))`;

// Chi conduce un'attività (chi l'ha proposta, il responsabile, la regia) non
// deve dire se c'è: la convocazione è per gli altri.
const conduceLei = (riga, userId) => riga.creato_da === userId || riga.responsabile_id === userId || !!riga.sono_regia;

function forma(riga, req) {
    const gestisce = organizza(req) || riga.responsabile_id === req.user.id;
    const conduco = conduceLei(riga, req.user.id);
    return {
        ...riga,
        gestisce,
        // La regia (e chi gestisce) prepara il copione e conduce la simulazione.
        regista: gestisce || !!riga.sono_regia,
        // Chi non organizza vede quanti hanno aderito solo per le attività aperte (i posti).
        si: gestisce || riga.convocazione === 'aperta' ? riga.si : undefined,
        no: gestisce ? riga.no : undefined,
        convocati: gestisce ? riga.convocati : undefined,
        sono_convocato: riga.convocazione === 'scelti' ? !!riga.sono_convocato : riga.convocazione === 'tutti',
        posti_liberi: riga.convocazione === 'aperta' && riga.posti ? Math.max(0, riga.posti - riga.si) : null,
        conduco,
        puo_rispondere: !conduco && riga.stato === 'programmata' && new Date(String(riga.fine).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')) > new Date()
            && (riga.convocazione !== 'scelti' || !!riga.sono_convocato)
    };
}

async function leggiAttivita(req, id, esecutore = pool) {
    const r = await esecutore.query(`${SELECT_ATTIVITA} WHERE a.id = $3 AND ${VISIBILE}`, [req.user.id, organizza(req), id]);
    return r.rows[0] ? forma(r.rows[0], req) : null;
}

// Le persone di un'attività, per chi la organizza: chi è convocato, chi ha
// risposto e come, e se lo si raggiunge (app con gli avvisi accesi, email).
async function personeDi(attivita) {
    const base = attivita.convocazione === 'tutti'
        ? `${SQL_INTERNI}`
        : `${SQL_INTERNI} AND EXISTS (SELECT 1 FROM attivita_persone p WHERE p.attivita_id = $1 AND p.user_id = u.id)`;
    const r = await pool.query(`
        WITH chi AS (${base})
        SELECT chi.id, chi.username, chi.nome, chi.cognome, (chi.email IS NOT NULL) AS email,
               EXISTS (SELECT 1 FROM token_avvisi t WHERE t.user_id = chi.id AND t.scade_il > NOW()) AS app,
               p.convocato, p.risposta, p.risposto_il, p.nota
          FROM chi LEFT JOIN attivita_persone p ON p.attivita_id = $1 AND p.user_id = chi.id
         ORDER BY CASE p.risposta WHEN 'si' THEN 0 WHEN 'no' THEN 2 ELSE 1 END, chi.cognome, chi.nome`, [attivita.id]);
    return r.rows.map(p => ({ ...p, raggiungibile: (attivita.avviso_app && p.app) || (attivita.avviso_email && p.email) }));
}

// Chi riceve gli avvisi di un'attività: i convocati, o tutti gli interni.
// [soloInteressati] toglie chi ha già detto di no (per modifiche e annullamenti).
async function destinatari(attivita, { soloInteressati = false } = {}) {
    const filtro = attivita.convocazione === 'scelti'
        ? 'AND EXISTS (SELECT 1 FROM attivita_persone p WHERE p.attivita_id = $1 AND p.user_id = u.id AND p.convocato)'
        : '';
    // Chi la conduce non riceve la convocazione.
    const nonConduce = `AND NOT EXISTS (SELECT 1 FROM attivita x WHERE x.id = $1 AND (x.creato_da = u.id OR x.responsabile_id = u.id))
        AND NOT EXISTS (SELECT 1 FROM attivita_regia g WHERE g.attivita_id = $1 AND g.user_id = u.id)`;
    const noNo = soloInteressati
        ? "AND NOT EXISTS (SELECT 1 FROM attivita_persone p WHERE p.attivita_id = $1 AND p.user_id = u.id AND p.risposta = 'no')"
        : '';
    return (await pool.query(`${SQL_INTERNI} ${filtro} ${nonConduce} ${noNo}`, [attivita.id])).rows;
}

function quando(attivita) {
    const inizio = dataOraItaliana(attivita.inizio);
    const stessoGiorno = dataItaliana(attivita.inizio) === dataItaliana(attivita.fine);
    return stessoGiorno ? `${inizio}-${oraItaliana(attivita.fine)}` : `dal ${inizio} al ${dataOraItaliana(attivita.fine)}`;
}

// Gli avvisi di un'attività, con i canali scelti per lei. Dopo la risposta
// alla richiesta: una posta lenta non fa aspettare chi organizza.
async function avvisa(attivita, persone, { tipo, titolo, testo, oggetto }) {
    const indirizzo = `https://${domainName}/calendario.html?attivita=${attivita.id}`;
    if (attivita.avviso_app) {
        // Valida fino alla fine dell'attività.
        const ore = Math.max(1, Math.ceil((new Date(String(attivita.fine).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')) - Date.now()) / 3600000));
        for (const p of persone) {
            await notifiche.scadi({ tipo: 'convocazione', riferimento: { tipo: 'attivita', id: attivita.id }, userId: p.id });
            await notifiche.notifica(p.id, {
                tipo, categoria: 'personale', titolo, testo,
                riferimento: { tipo: 'attivita', id: attivita.id },
                chiave: `${tipo}:${attivita.id}:${p.id}:${Date.now()}`,
                oreValidita: Math.min(ore, 24 * 90)
            });
        }
    }
    if (attivita.avviso_email) {
        for (const p of persone.filter(x => x.email)) {
            const html = `<p>Ciao ${escapeHtmlForEmail(p.nome || '')},</p>
                <p>${escapeHtmlForEmail(testo)}</p>
                ${attivita.luogo ? `<p><strong>Dove:</strong> ${escapeHtmlForEmail(attivita.luogo)}</p>` : ''}
                ${attivita.descrizione ? `<p>${escapeHtmlForEmail(attivita.descrizione).replace(/\n/g, '<br>')}</p>` : ''}
                <p><a href="${indirizzo}">Rispondi da ORION</a> (o dall'app, nel calendario).</p>`;
            await sendEmailUtility(p.email, oggetto, `${testo}\n\nRispondi da ORION: ${indirizzo}`, html)
                .catch(e => logger.warn(`[Attività] Email a ${p.email} non inviata: ${e.message}`));
        }
    }
}

function convocazioneTesto(a) {
    const che = `${a.tipo ? `${a.tipo}: ` : ''}${a.titolo}`;
    if (a.convocazione === 'aperta') {
        return { titolo: `Nuova attività: ${a.tipo || a.titolo}`, testo: `${che}, ${quando(a)}. Se ci sei, aderisci da ORION${a.posti ? ` (posti: ${a.posti})` : ''}.` };
    }
    return { titolo: `Convocazione: ${a.tipo || a.titolo}`, testo: `${che}, ${quando(a)}${a.luogo ? `, ${a.luogo}` : ''}. Rispondi "Ci sono" o "Non posso".` };
}

// I campi di un'attività dalla richiesta, controllati.
async function leggiCampi(corpo, client) {
    const campi = {
        tipo_id: interoOpzionale(corpo.tipo_id),
        titolo: testo(corpo.titolo, LIMITE.titolo),
        descrizione: testo(corpo.descrizione, LIMITE.descrizione),
        luogo: testo(corpo.luogo, LIMITE.luogo),
        inizio: istante(corpo.inizio),
        fine: istante(corpo.fine),
        convocazione: ['tutti', 'scelti', 'aperta'].includes(corpo.convocazione) ? corpo.convocazione : 'tutti',
        posti: interoOpzionale(corpo.posti),
        avviso_app: corpo.avviso_app !== false,
        avviso_email: corpo.avviso_email === true,
        responsabile_id: interoOpzionale(corpo.responsabile_id),
        corso_id: interoOpzionale(corpo.corso_id),
        simulazione: ['allertamento', 'sala'].includes(corpo.simulazione) ? corpo.simulazione : null,
        scenario: testo(corpo.scenario, LIMITE.scenario),
        obiettivi: testo(corpo.obiettivi, LIMITE.scenario),
        enti: testo(corpo.enti, LIMITE.enti)
    };
    if (!campi.titolo) return { errore: 'Serve un titolo.' };
    if (!campi.inizio || !campi.fine) return { errore: 'Servono inizio e fine.' };
    if (campi.fine < campi.inizio) return { errore: "La fine viene prima dell'inizio." };
    if (campi.fine - campi.inizio > 31 * 24 * 3600 * 1000) return { errore: 'Un\'attività dura al massimo un mese.' };
    for (const k of ['tipo_id', 'posti', 'responsabile_id', 'corso_id']) if (Number.isNaN(campi[k])) return { errore: `Valore non valido: ${k}.` };
    if (campi.posti !== null && campi.posti < 1) return { errore: 'I posti devono essere almeno uno.' };
    if (campi.convocazione !== 'aperta') campi.posti = null;
    if (campi.responsabile_id !== null) {
        const r = await client.query(`${SQL_INTERNI} AND u.id = $1`, [campi.responsabile_id]);
        if (!r.rowCount) return { errore: 'Il responsabile deve essere un interno attivo.' };
    }
    const persone = Array.isArray(corpo.persone) ? [...new Set(corpo.persone.map(n => parseInt(n, 10)).filter(Number.isInteger))] : [];
    if (campi.convocazione === 'scelti') {
        if (!persone.length) return { errore: 'Scegli chi convocare.' };
        const r = await client.query(`${SQL_INTERNI} AND u.id = ANY($1::int[])`, [persone]);
        if (r.rowCount !== persone.length) return { errore: 'Fra i convocati c\'è chi non è un interno attivo.' };
    }
    // La simulazione è degli addestramenti e delle esercitazioni.
    const natura = campi.tipo_id ? (await client.query('SELECT natura FROM attivita_tipi WHERE id = $1', [campi.tipo_id])).rows[0]?.natura : null;
    if (campi.simulazione && !['addestramento', 'esercitazione'].includes(natura)) {
        return { errore: 'La simulazione si fa negli addestramenti e nelle esercitazioni.' };
    }
    const regia = Array.isArray(corpo.regia) ? [...new Set(corpo.regia.map(n => parseInt(n, 10)).filter(Number.isInteger))] : [];
    if (regia.length) {
        const r = await client.query(`${SQL_INTERNI} AND u.id = ANY($1::int[])`, [regia]);
        if (r.rowCount !== regia.length) return { errore: "Nella regia c'è chi non è un interno attivo." };
    }
    return { campi, persone, regia: campi.simulazione ? regia : [] };
}

export function registraRotteAttivita(app) {
    const gestione = richiedePermesso('gruppo.attivita');
    const base = [moduloAcceso, soloInterni];

    // Chi organizza o il responsabile di quell'attività.
    async function puoGestire(req, id) {
        if (organizza(req)) return true;
        const r = await pool.query('SELECT 1 FROM attivita WHERE id = $1 AND responsabile_id = $2', [id, req.user.id]);
        return r.rowCount > 0;
    }

    app.get('/api/attivita/tipi', ...base, async (req, res) => {
        try {
            const r = await pool.query('SELECT id, nome, ordine, attivo, natura FROM attivita_tipi ORDER BY ordine, nome');
            res.json(r.rows.filter(t => t.attivo || organizza(req)));
        } catch (e) {
            logger.error('Errore GET /api/attivita/tipi:', e);
            res.status(500).json({ message: 'Errore nel leggere i tipi di attività.' });
        }
    });

    app.post('/api/attivita/tipi', ...base, gestione, async (req, res) => {
        const nome = testo(req.body?.nome, 60);
        if (!nome) return res.status(400).json({ message: 'Serve un nome.' });
        const natura = NATURE.includes(req.body?.natura) ? req.body.natura : 'generica';
        try {
            const r = await pool.query(
                'INSERT INTO attivita_tipi (nome, ordine, natura) VALUES ($1, (SELECT COALESCE(MAX(ordine), 0) + 1 FROM attivita_tipi), $2) RETURNING id, nome, ordine, attivo, natura', [nome, natura]);
            registraAudit(req, 'attivita.tipo_creato', { tipo: 'attivita_tipo', id: r.rows[0].id, dettagli: { nome } });
            res.status(201).json(r.rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ message: 'Un tipo con questo nome c\'è già.' });
            logger.error('Errore POST /api/attivita/tipi:', e);
            res.status(500).json({ message: 'Errore nel creare il tipo.' });
        }
    });

    app.put('/api/attivita/tipi/:id', ...base, gestione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const nome = testo(req.body?.nome, 60);
        if (!Number.isInteger(id) || !nome) return res.status(400).json({ message: 'Serve un nome.' });
        try {
            const r = await pool.query(
                'UPDATE attivita_tipi SET nome = $2, attivo = $3, natura = COALESCE($4, natura) WHERE id = $1 RETURNING id, nome, ordine, attivo, natura',
                [id, nome, req.body?.attivo !== false, NATURE.includes(req.body?.natura) ? req.body.natura : null]);
            if (!r.rowCount) return res.status(404).json({ message: 'Tipo non trovato.' });
            res.json(r.rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ message: 'Un tipo con questo nome c\'è già.' });
            logger.error('Errore PUT /api/attivita/tipi:', e);
            res.status(500).json({ message: 'Errore nel salvare il tipo.' });
        }
    });

    // Le attività di un periodo, quelle che chi chiede può vedere.
    app.get('/api/attivita', ...base, async (req, res) => {
        const da = giorno(req.query.da), a = giorno(req.query.a);
        if ((req.query.da && !da) || (req.query.a && !a)) return res.status(400).json({ message: 'Date non valide (AAAA-MM-GG).' });
        try {
            const r = await pool.query(`${SELECT_ATTIVITA}
                 WHERE ${VISIBILE}
                   AND ($3::date IS NULL OR a.fine >= ($3::date)::timestamp AT TIME ZONE $5)
                   AND ($4::date IS NULL OR a.inizio < ($4::date + 1)::timestamp AT TIME ZONE $5)
                 ORDER BY a.inizio`, [req.user.id, organizza(req), da, a, fusoOrario()]);
            res.json(r.rows.map(x => forma(x, req)));
        } catch (e) {
            logger.error('Errore GET /api/attivita:', e);
            res.status(500).json({ message: 'Errore nel leggere le attività.' });
        }
    });

    // Le attività a cui la persona deve ancora rispondere: la home dell'app le conta.
    app.get('/api/attivita/da-rispondere', ...base, async (req, res) => {
        try {
            const r = await pool.query(`${SELECT_ATTIVITA}
                 WHERE ${VISIBILE} AND a.stato = 'programmata' AND a.fine > NOW()
                   AND a.convocazione <> 'aperta' AND mia.risposta IS NULL
                   AND (a.convocazione = 'tutti' OR mia.convocato)
                 ORDER BY a.inizio`, [req.user.id, false]);
            res.json(r.rows.map(x => forma(x, req)).filter(x => !x.conduco));
        } catch (e) {
            logger.error('Errore GET /api/attivita/da-rispondere:', e);
            res.status(500).json({ message: 'Errore nel leggere le convocazioni.' });
        }
    });

    // I corsi del catalogo, per l'addestramento che vale come corso.
    app.get('/api/attivita/corsi', ...base, gestione, async (req, res) => {
        try {
            res.json((await pool.query('SELECT id, name AS nome, validity_months AS mesi FROM courses_catalog ORDER BY name')).rows);
        } catch (e) {
            logger.error('Errore GET /api/attivita/corsi:', e);
            res.status(500).json({ message: 'Errore nel leggere i corsi.' });
        }
    });

    app.get('/api/attivita/:id', ...base, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Attività non valida.' });
        try {
            const a = await leggiAttivita(req, id);
            if (!a) return res.status(404).json({ message: 'Attività non trovata.' });
            if (a.gestisce) {
                a.persone = await personeDi(a);
                a.presenze = (await pool.query(
                    `SELECT p.id, p.user_id, u.nome, u.cognome, p.inizio, p.fine, p.minuti, p.corso_utente_id IS NOT NULL AS corso
                       FROM partecipazioni p JOIN users u ON u.id = p.user_id WHERE p.attivita_id = $1 ORDER BY u.cognome, u.nome`, [id])).rows;
            }
            res.json(a);
        } catch (e) {
            logger.error('Errore GET /api/attivita/:id:', e);
            res.status(500).json({ message: "Errore nel leggere l'attività." });
        }
    });

    app.post('/api/attivita', ...base, gestione, async (req, res) => {
        const client = await pool.connect();
        try {
            const letto = await leggiCampi(req.body || {}, client);
            if (letto.errore) return res.status(400).json({ message: letto.errore });
            const { campi, persone } = letto;
            await client.query('BEGIN');
            const r = await client.query(
                `INSERT INTO attivita (tipo_id, titolo, descrizione, luogo, inizio, fine, convocazione, posti, avviso_app, avviso_email,
                                       responsabile_id, corso_id, creato_da, simulazione, scenario, obiettivi, enti)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
                [campi.tipo_id, campi.titolo, campi.descrizione, campi.luogo, campi.inizio, campi.fine, campi.convocazione, campi.posti,
                 campi.avviso_app, campi.avviso_email, campi.responsabile_id, campi.corso_id, req.user.id,
                 campi.simulazione, campi.scenario, campi.obiettivi, campi.enti]);
            const id = r.rows[0].id;
            if (letto.regia.length) {
                await client.query('INSERT INTO attivita_regia (attivita_id, user_id) SELECT $1, unnest($2::int[])', [id, letto.regia]);
            }
            if (campi.convocazione === 'scelti') {
                await client.query(
                    'INSERT INTO attivita_persone (attivita_id, user_id, convocato) SELECT $1, unnest($2::int[]), true', [id, persone]);
            }
            await client.query('COMMIT');
            const a = await leggiAttivita(req, id);
            registraAudit(req, 'attivita.creata', { tipo: 'attivita', id, dettagli: { titolo: campi.titolo, convocazione: campi.convocazione, convocati: persone.length || null } });
            res.status(201).json(a);
            destinatari(a).then(chi => avvisa(a, chi, { tipo: 'convocazione', ...convocazioneTesto(a), oggetto: convocazioneTesto(a).titolo }))
                .catch(e => logger.error('[Attività] Convocazioni non inviate:', e));
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.code === '23503') return res.status(400).json({ message: 'Tipo o corso inesistente.' });
            logger.error('Errore POST /api/attivita:', e);
            res.status(500).json({ message: "Errore nel creare l'attività." });
        } finally {
            client.release();
        }
    });

    // Cambiare un'attività. Con "avvisa" chi è convocato (e non ha detto di no)
    // riceve l'avviso del cambio; i convocati nuovi la convocazione.
    app.put('/api/attivita/:id', ...base, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Attività non valida.' });
        if (!(await puoGestire(req, id))) return res.status(403).json({ message: 'Ti serve il permesso "Organizzare attività e presenze".' });
        const client = await pool.connect();
        try {
            const prima = (await client.query('SELECT * FROM attivita WHERE id = $1', [id])).rows[0];
            if (!prima) return res.status(404).json({ message: 'Attività non trovata.' });
            if (prima.stato !== 'programmata') return res.status(409).json({ message: 'Un\'attività conclusa o annullata non si cambia (le presenze si correggono a parte).' });
            const letto = await leggiCampi(req.body || {}, client);
            if (letto.errore) return res.status(400).json({ message: letto.errore });
            const { campi, persone } = letto;
            // Il responsabile non diventa organizzatore di sé stesso: cambia solo chi ha il permesso.
            if (!organizza(req)) campi.responsabile_id = prima.responsabile_id;
            await client.query('BEGIN');
            await client.query(
                `UPDATE attivita SET tipo_id = $2, titolo = $3, descrizione = $4, luogo = $5, inizio = $6, fine = $7, convocazione = $8,
                        posti = $9, avviso_app = $10, avviso_email = $11, responsabile_id = $12, corso_id = $13,
                        simulazione = $14, scenario = $15, obiettivi = $16, enti = $17, aggiornato_il = NOW()
                  WHERE id = $1`,
                [id, campi.tipo_id, campi.titolo, campi.descrizione, campi.luogo, campi.inizio, campi.fine, campi.convocazione,
                 campi.posti, campi.avviso_app, campi.avviso_email, campi.responsabile_id, campi.corso_id,
                 campi.simulazione, campi.scenario, campi.obiettivi, campi.enti]);
            await client.query('DELETE FROM attivita_regia WHERE attivita_id = $1', [id]);
            if (letto.regia.length) {
                await client.query('INSERT INTO attivita_regia (attivita_id, user_id) SELECT $1, unnest($2::int[])', [id, letto.regia]);
            }
            let nuovi = [];
            if (campi.convocazione === 'scelti') {
                const gia = (await client.query('SELECT user_id FROM attivita_persone WHERE attivita_id = $1 AND convocato', [id])).rows.map(r => r.user_id);
                nuovi = persone.filter(p => !gia.includes(p));
                await client.query('UPDATE attivita_persone SET convocato = (user_id = ANY($2::int[])) WHERE attivita_id = $1', [id, persone]);
                await client.query(
                    `INSERT INTO attivita_persone (attivita_id, user_id, convocato) SELECT $1, unnest($2::int[]), true
                     ON CONFLICT (attivita_id, user_id) DO UPDATE SET convocato = true`, [id, persone]);
                // Chi non è più convocato e non aveva risposto esce del tutto.
                await client.query('DELETE FROM attivita_persone WHERE attivita_id = $1 AND NOT convocato', [id]);
            } else {
                await client.query('UPDATE attivita_persone SET convocato = false WHERE attivita_id = $1', [id]);
                await client.query('DELETE FROM attivita_persone WHERE attivita_id = $1 AND risposta IS NULL', [id]);
            }
            await client.query('COMMIT');
            const a = await leggiAttivita(req, id);
            registraAudit(req, 'attivita.modificata', { tipo: 'attivita', id, dettagli: { titolo: campi.titolo, avvisa: req.body?.avvisa === true } });
            res.json(a);
            (async () => {
                if (req.body?.avvisa === true) {
                    const chi = (await destinatari(a, { soloInteressati: true })).filter(p => !nuovi.includes(p.id));
                    const t = `${a.tipo ? `${a.tipo}: ` : ''}${a.titolo}, ${quando(a)}${a.luogo ? `, ${a.luogo}` : ''}. Controlla i dettagli.`;
                    await avvisa(a, chi, { tipo: 'attivita_cambiata', titolo: `Attività cambiata: ${a.tipo || a.titolo}`, testo: t, oggetto: `Attività cambiata: ${a.titolo}` });
                }
                if (nuovi.length) {
                    const chi = (await destinatari(a)).filter(p => nuovi.includes(p.id));
                    await avvisa(a, chi, { tipo: 'convocazione', ...convocazioneTesto(a), oggetto: convocazioneTesto(a).titolo });
                }
            })().catch(e => logger.error('[Attività] Avvisi della modifica non inviati:', e));
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.code === '23503') return res.status(400).json({ message: 'Tipo o corso inesistente.' });
            logger.error('Errore PUT /api/attivita/:id:', e);
            res.status(500).json({ message: "Errore nel salvare l'attività." });
        } finally {
            client.release();
        }
    });

    app.post('/api/attivita/:id/annulla', ...base, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Attività non valida.' });
        if (!(await puoGestire(req, id))) return res.status(403).json({ message: 'Ti serve il permesso "Organizzare attività e presenze".' });
        try {
            const motivo = testo(req.body?.motivo, LIMITE.motivo);
            const r = await pool.query(
                `UPDATE attivita SET stato = 'annullata', motivo_annullamento = $2, aggiornato_il = NOW()
                  WHERE id = $1 AND stato = 'programmata' RETURNING id`, [id, motivo]);
            if (!r.rowCount) return res.status(409).json({ message: 'Si annulla solo un\'attività programmata.' });
            const a = await leggiAttivita(req, id);
            registraAudit(req, 'attivita.annullata', { tipo: 'attivita', id, dettagli: { titolo: a.titolo, motivo } });
            res.json(a);
            (async () => {
                await notifiche.scadi({ riferimento: { tipo: 'attivita', id } });
                const chi = await destinatari(a, { soloInteressati: true });
                const t = `${a.tipo ? `${a.tipo}: ` : ''}${a.titolo} del ${dataItaliana(a.inizio)} è annullata${motivo ? `: ${motivo}` : '.'}`;
                await avvisa({ ...a, fine: new Date(Date.now() + 48 * 3600000).toISOString() }, chi,
                    { tipo: 'attivita_annullata', titolo: `Annullata: ${a.tipo || a.titolo}`, testo: t, oggetto: `Annullata: ${a.titolo}` });
            })().catch(e => logger.error("[Attività] Avvisi dell'annullamento non inviati:", e));
        } catch (e) {
            logger.error('Errore POST /api/attivita/:id/annulla:', e);
            res.status(500).json({ message: "Errore nell'annullare l'attività." });
        }
    });

    // Via del tutto: solo se nessuno risulta presente.
    app.delete('/api/attivita/:id', ...base, gestione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Attività non valida.' });
        try {
            const presenti = (await pool.query('SELECT COUNT(*)::int AS n FROM partecipazioni WHERE attivita_id = $1', [id])).rows[0].n;
            if (presenti) return res.status(409).json({ message: `Ci sono ${presenti} presenze registrate: un'attività fatta resta nello storico.` });
            const r = await pool.query('DELETE FROM attivita WHERE id = $1 RETURNING titolo', [id]);
            if (!r.rowCount) return res.status(404).json({ message: 'Attività non trovata.' });
            await notifiche.scadi({ riferimento: { tipo: 'attivita', id } });
            registraAudit(req, 'attivita.eliminata', { tipo: 'attivita', id, dettagli: { titolo: r.rows[0].titolo } });
            res.json({ message: 'Attività eliminata.' });
        } catch (e) {
            logger.error('Errore DELETE /api/attivita/:id:', e);
            res.status(500).json({ message: "Errore nell'eliminare l'attività." });
        }
    });

    // La risposta di chi è convocato: "si" (ci sono, o aderisco) o "no".
    app.post('/api/attivita/:id/risposta', ...base, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const risposta = req.body?.risposta;
        if (!Number.isInteger(id) || !['si', 'no'].includes(risposta)) return res.status(400).json({ message: 'Rispondi "si" o "no".' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Chi aderisce per ultimo a un'attività aperta non supera i posti.
            await client.query('SELECT id FROM attivita WHERE id = $1 FOR UPDATE', [id]);
            const a = await leggiAttivita(req, id, client);
            if (!a) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Attività non trovata.' }); }
            if (!a.puo_rispondere) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: a.stato === 'annullata' ? "L'attività è stata annullata." : 'Non si risponde più: l\'attività è finita o non sei convocato.' });
            }
            if (risposta === 'si' && a.convocazione === 'aperta' && a.posti && a.mia_risposta !== 'si' && a.si >= a.posti) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: 'I posti sono esauriti.', posti_esauriti: true });
            }
            await client.query(
                `INSERT INTO attivita_persone (attivita_id, user_id, risposta, risposto_il, nota) VALUES ($1, $2, $3, NOW(), $4)
                 ON CONFLICT (attivita_id, user_id) DO UPDATE SET risposta = EXCLUDED.risposta, risposto_il = NOW(), nota = EXCLUDED.nota`,
                [id, req.user.id, risposta, testo(req.body?.nota, LIMITE.nota)]);
            await client.query('COMMIT');
            // Risposto: la convocazione non chiede più niente.
            await notifiche.scadi({ tipo: 'convocazione', riferimento: { tipo: 'attivita', id }, userId: req.user.id });
            res.json(await leggiAttivita(req, id));
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore POST /api/attivita/:id/risposta:', e);
            res.status(500).json({ message: 'Errore nel salvare la risposta.' });
        } finally {
            client.release();
        }
    });

    // Chiudere l'attività con i presenti e gli orari (di partenza quelli
    // dell'attività). Si può ripetere per correggere: chi non c'è più esce
    // dalle presenze, e il corso che l'attività gli aveva scritto si toglie.
    app.post('/api/attivita/:id/concludi', ...base, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Attività non valida.' });
        if (!(await puoGestire(req, id))) return res.status(403).json({ message: 'Ti serve il permesso "Organizzare attività e presenze".' });
        const presenze = Array.isArray(req.body?.presenze) ? req.body.presenze : null;
        if (!presenze) return res.status(400).json({ message: 'Indica i presenti.' });
        try {
            const esito = await registraPresenzeAttivita(id, presenze, req);
            if (esito.errore) return res.status(esito.stato || 400).json({ message: esito.errore });
            registraAudit(req, 'attivita.conclusa', { tipo: 'attivita', id, dettagli: { presenti: esito.presenti, corsi: esito.corsi } });
            await notifiche.scadi({ tipo: 'convocazione', riferimento: { tipo: 'attivita', id } });
            res.json({ ...(await leggiAttivita(req, id)), ...esito });
        } catch (e) {
            logger.error('Errore POST /api/attivita/:id/concludi:', e);
            res.status(500).json({ message: "Errore nel chiudere l'attività." });
        }
    });

    // Il calendario di un periodo: attività, emergenze e scadenze per chi le può vedere.
    app.get('/api/calendario', ...base, async (req, res) => {
        const da = giorno(req.query.da), a = giorno(req.query.a);
        if (!da || !a) return res.status(400).json({ message: 'Servono "da" e "a" (AAAA-MM-GG).' });
        if (a < da || (new Date(a) - new Date(da)) / 86400000 > GIORNI_MASSIMI_CALENDARIO) {
            return res.status(400).json({ message: `Un periodo di al massimo ${GIORNI_MASSIMI_CALENDARIO} giorni.` });
        }
        try {
            const fuso = fusoOrario();
            const [attivita, emergenze, impostazioni] = await Promise.all([
                pool.query(`${SELECT_ATTIVITA}
                     WHERE ${VISIBILE} AND a.fine >= ($3::date)::timestamp AT TIME ZONE $5 AND a.inizio < ($4::date + 1)::timestamp AT TIME ZONE $5
                     ORDER BY a.inizio`, [req.user.id, organizza(req), da, a, fuso]),
                pool.query(`SELECT id, code, name, start_time AS inizio, end_time AS fine, status, simulazione, attivita_id, interrotta_il FROM emergencies
                     WHERE COALESCE(end_time, NOW()) >= ($1::date)::timestamp AT TIME ZONE $3 AND start_time < ($2::date + 1)::timestamp AT TIME ZONE $3
                     ORDER BY start_time`, [da, a, fuso]),
                pool.query("SELECT setting_key, setting_value FROM branding_settings WHERE setting_key IN ('segreteria_config', 'magazzino_enabled')")
            ]);
            const imp = Object.fromEntries(impostazioni.rows.map(r => [r.setting_key, r.setting_value]));
            let segreteria = false;
            try { segreteria = JSON.parse(imp.segreteria_config || '{}').enabled === true; } catch { /* spenta */ }
            const magazzino = String(imp.magazzino_enabled) === 'true';
            const vedeSegreteria = segreteria && haPermesso(req, 'volontari.sanitario');
            const vedeMagazzino = magazzino && haPermesso(req, 'magazzino.gestione');

            const scadenze = [];
            const aggiungi = (categoria, righe) => {
                const perGiorno = new Map();
                for (const r of righe) {
                    if (!perGiorno.has(r.giorno)) perGiorno.set(r.giorno, []);
                    perGiorno.get(r.giorno).push({ titolo: r.titolo, chi: r.chi || null, user_id: r.user_id ?? null, bene_id: r.bene_id ?? null });
                }
                for (const [g, voci] of perGiorno) scadenze.push({ giorno: g, categoria, conteggio: voci.length, voci });
            };
            // L'ultima visita di ogni tipo e l'ultimo corso di ogni tipo: quelli che contano.
            const sqlVisite = (soloMe) => `
                SELECT DISTINCT ON (v.user_id, v.visit_type_id) v.user_id, v.expiry_date::text AS giorno, t.name AS titolo,
                       NULLIF(TRIM(CONCAT(u.nome, ' ', u.cognome)), '') AS chi
                  FROM user_medical_records v JOIN medical_visit_types t ON t.id = v.visit_type_id JOIN users u ON u.id = v.user_id
                 WHERE ${soloMe ? 'v.user_id = $3' : 'COALESCE(u.is_active, true) AND u.eliminato_il IS NULL'}
                 ORDER BY v.user_id, v.visit_type_id, v.last_visit_date DESC`;
            const sqlCorsi = (soloMe) => `
                SELECT DISTINCT ON (c.user_id, c.course_id) c.user_id, c.expiry_date::text AS giorno, k.name AS titolo,
                       NULLIF(TRIM(CONCAT(u.nome, ' ', u.cognome)), '') AS chi
                  FROM user_courses c JOIN courses_catalog k ON k.id = c.course_id JOIN users u ON u.id = c.user_id
                 WHERE c.expiry_date IS NOT NULL AND ${soloMe ? 'c.user_id = $3' : 'COALESCE(u.is_active, true) AND u.eliminato_il IS NULL'}
                 ORDER BY c.user_id, c.course_id, c.acquisition_date DESC`;
            const nelPeriodo = (sql, soloMe) => pool.query(
                `SELECT * FROM (${sql}) x WHERE x.giorno >= $1 AND x.giorno <= $2`, soloMe ? [da, a, req.user.id] : [da, a]);
            if (segreteria) {
                const [v, c] = await Promise.all([nelPeriodo(sqlVisite(true), true), nelPeriodo(sqlCorsi(true), true)]);
                aggiungi('mie', [...v.rows.map(r => ({ ...r, titolo: `Scade: ${r.titolo}`, chi: null })), ...c.rows.map(r => ({ ...r, titolo: `Scade: ${r.titolo}`, chi: null }))]);
            }
            if (vedeSegreteria) {
                const [v, c] = await Promise.all([nelPeriodo(sqlVisite(false), false), nelPeriodo(sqlCorsi(false), false)]);
                aggiungi('segreteria', [...v.rows, ...c.rows]);
            }
            if (vedeMagazzino) {
                const m = await pool.query(
                    `SELECT s.scadenza::text AS giorno, b.id AS bene_id, s.tipo,
                            CONCAT(b.denominazione, CASE WHEN b.matricola IS NOT NULL THEN CONCAT(' (', b.matricola, ')') ELSE '' END) AS chi
                       FROM beni_scadenze s JOIN beni b ON b.id = s.bene_id
                      WHERE b.dismesso_il IS NULL AND s.scadenza BETWEEN $1 AND $2`, [da, a]);
                aggiungi('magazzino', m.rows.map(r => ({ ...r, titolo: r.tipo.replace(/_/g, ' ') })));
            }
            scadenze.sort((x, y) => x.giorno.localeCompare(y.giorno) || x.categoria.localeCompare(y.categoria));

            // Reperibilità e assenze, giorno per giorno: le proprie per tutti,
            // quelle di tutti per chi organizza.
            const turniRighe = (await pool.query(`
                SELECT g::date::text AS giorno, x.categoria, x.id, x.user_id, x.nota,
                       NULLIF(TRIM(CONCAT(u.nome, ' ', u.cognome)), '') AS chi
                  FROM (SELECT 'reperibili' AS categoria, id, user_id, dal, al, nota FROM reperibilita
                        UNION ALL SELECT 'assenti', id, user_id, dal, al, NULL FROM assenze) x
                  JOIN users u ON u.id = x.user_id
                  CROSS JOIN LATERAL generate_series(GREATEST(x.dal, $1::date), LEAST(x.al, $2::date), INTERVAL '1 day') g
                 WHERE x.al >= $1 AND x.dal <= $2 AND ($3 OR x.user_id = $4)
                 ORDER BY 1, 2, u.cognome, u.nome`, [da, a, organizza(req), req.user.id])).rows;
            const turni = [];
            for (const r of turniRighe) {
                let voce = turni.find(v => v.giorno === r.giorno && v.categoria === r.categoria);
                if (!voce) turni.push(voce = { giorno: r.giorno, categoria: r.categoria, conteggio: 0, voci: [] });
                voce.conteggio++;
                voce.voci.push({ id: r.id, user_id: r.user_id, chi: r.chi, nota: r.nota, mio: r.user_id === req.user.id });
            }
            res.json({
                da, a,
                organizza: organizza(req),
                filtri: { mie: segreteria, segreteria: vedeSegreteria, magazzino: vedeMagazzino },
                attivita: attivita.rows.map(x => forma(x, req)),
                emergenze: emergenze.rows,
                scadenze,
                turni
            });
        } catch (e) {
            logger.error('Errore GET /api/calendario:', e);
            res.status(500).json({ message: 'Errore nel leggere il calendario.' });
        }
    });

    // Gli interni, per scegliere i convocati e il responsabile.
    app.get('/api/attivita-persone', ...base, async (req, res) => {
        if (!organizza(req)) {
            const r = await pool.query('SELECT 1 FROM attivita WHERE responsabile_id = $1 LIMIT 1', [req.user.id]);
            if (!r.rowCount) return res.status(403).json({ message: 'Ti serve il permesso "Organizzare attività e presenze".' });
        }
        try {
            const r = await pool.query(`${SQL_INTERNI} ORDER BY u.cognome, u.nome`);
            res.json(r.rows.map(({ email, ...p }) => ({ ...p, email: !!email })));
        } catch (e) {
            logger.error('Errore GET /api/attivita-persone:', e);
            res.status(500).json({ message: 'Errore nel leggere le persone.' });
        }
    });
}

