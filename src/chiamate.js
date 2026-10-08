// src/chiamate.js
//
// La chiamata dei volontari e la loro disponibilità.
//
// La sala (o chi organizza un'attività di allertamento) sceglie chi chiamare:
// tutti gli interni, i reperibili di oggi, chi ha un corso valido o un elenco.
// Restano fuori chi è già in squadra, chi sta già arrivando e chi ha detto di
// essere assente oggi (salvo sceglierlo a mano). L'avviso parte nell'app,
// per email o in tutti e due i modi; dal telefono si risponde "arrivo",
// "arrivo fra..." o "non posso". Chi non risponde entro i minuti stabiliti, o
// non si raggiunge in nessun modo, passa fra quelli da chiamare a voce.
//
// La disponibilità è lo stato di ognuno nel contesto: in arrivo, arrivato in
// sede, non disponibile, congedato. Chi è arrivato conta come presente da
// quel momento al congedo (o alla chiusura), anche prima di entrare in una
// squadra: lo legge src/presenze.js.
//
// Il contesto è l'emergenza aperta (vera o simulata) oppure un'attività del
// calendario. Reperibilità e assenze: i turni li decide chi organizza, le
// assenze le dichiara ognuno per sé.

import logger from './logger.js';
import { registraAudit } from './audit.js';
import { nomeUtente, ruoliDi } from './autenticazione.js';
import { domainName } from './config.js';
import { fusoOrario, oggiLocale } from './date.js';
import { pool } from './db.js';
import { escapeHtmlForEmail, sendEmailUtility } from './email.js';
import { haPermesso } from './permessi.js';
import { mostraTelefonoCaposquadra } from './squadre.js';
import { activeEmergency } from './statoEmergenza.js';
import { avvisaClienti, notifiche } from './tempoReale.js';

const LIMITE = { messaggio: 500, nota: 300 };
const RISPOSTE = ['arrivo', 'ritardo', 'no'];
const STATI = ['in_arrivo', 'arrivato', 'non_disponibile', 'congedato'];

// Gli interni attivi: quelli che si possono chiamare. I temporanei hanno il ruolo esterno.
const SQL_INTERNI = `
    SELECT u.id, u.username, u.nome, u.cognome, NULLIF(TRIM(u.email), '') AS email, u.telefono
      FROM users u
     WHERE COALESCE(u.is_active, true) = true AND u.eliminato_il IS NULL
       AND NOT EXISTS (SELECT 1 FROM utenti_ruoli ur WHERE ur.user_id = u.id AND ur.ruolo = 'esterno')`;

const esterno = (req) => ruoliDi(req.user).includes('esterno');

function testo(valore, massimo) {
    if (valore === undefined || valore === null) return null;
    const t = String(valore).trim();
    return t ? t.slice(0, massimo) : null;
}

function giorno(valore) {
    return typeof valore === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valore) && !Number.isNaN(Date.parse(valore)) ? valore : null;
}

const nomeDi = nomeUtente;

// Il contesto di una richiesta: un'attività (?attivita_id o nel corpo) o
// l'emergenza aperta. null se non c'è nessuno dei due.
async function contestoDa(req) {
    const grezzo = req.body?.attivita_id ?? req.query?.attivita_id;
    if (grezzo !== undefined && grezzo !== null && grezzo !== '') {
        const id = parseInt(grezzo, 10);
        if (!Number.isInteger(id)) return null;
        const a = (await pool.query('SELECT id, titolo, stato, fine, responsabile_id FROM attivita WHERE id = $1', [id])).rows[0];
        return a ? { tipo: 'attivita', id: a.id, attivita: a, aperto: a.stato === 'programmata', simulazione: false } : null;
    }
    if (!activeEmergency) return null;
    return { tipo: 'emergenza', id: activeEmergency.id, emergenza: activeEmergency, aperto: true, simulazione: activeEmergency.simulazione === true };
}

const colonna = (ctx) => ctx.tipo === 'attivita' ? 'attivita_id' : 'emergency_id';

// Chiamare: in emergenza chi apre le emergenze o organizza le attività; per
// un'attività chi organizza o il suo responsabile.
function puoChiamare(req, ctx) {
    if (esterno(req)) return false;
    if (ctx.tipo === 'emergenza') return haPermesso(req, 'emergenze.apertura', 'gruppo.attivita');
    return haPermesso(req, 'gruppo.attivita') || ctx.attivita.responsabile_id === req.user.id;
}

// Seguire le risposte e segnare arrivi e congedi: in emergenza ogni interno
// della sala, come per le squadre; per un'attività chi la gestisce.
function puoSeguire(req, ctx) {
    if (esterno(req)) return false;
    if (ctx.tipo === 'emergenza') return true;
    return puoChiamare(req, ctx);
}

// Tutti gli interni con quello che serve per scegliere chi chiamare.
async function candidati(req, ctx) {
    const telefono = await mostraTelefonoCaposquadra(req);
    const r = await pool.query(`
        WITH chi AS (${SQL_INTERNI}), oggi AS (SELECT (NOW() AT TIME ZONE $2)::date AS g)
        SELECT chi.id, chi.username, chi.nome, chi.cognome, (chi.email IS NOT NULL) AS email,
               CASE WHEN $3 THEN NULLIF(TRIM(chi.telefono), '') END AS telefono,
               EXISTS (SELECT 1 FROM token_avvisi t WHERE t.user_id = chi.id AND t.scade_il > NOW()) AS app,
               EXISTS (SELECT 1 FROM assenze a, oggi WHERE a.user_id = chi.id AND oggi.g BETWEEN a.dal AND a.al) AS assente,
               EXISTS (SELECT 1 FROM reperibilita p, oggi WHERE p.user_id = chi.id AND oggi.g BETWEEN p.dal AND p.al) AS reperibile,
               (SELECT s.nome_radio FROM squadra_membri sm JOIN squadre s ON s.id = sm.squadra_id WHERE sm.username = chi.username LIMIT 1) AS squadra,
               COALESCE((SELECT array_agg(DISTINCT c.course_id) FROM user_courses c, oggi
                          WHERE c.user_id = chi.id AND (c.expiry_date IS NULL OR c.expiry_date >= oggi.g)), '{}') AS corsi,
               d.stato
          FROM chi LEFT JOIN disponibilita d ON d.${colonna(ctx)} = $1 AND d.user_id = chi.id
         ORDER BY chi.cognome, chi.nome`, [ctx.id, fusoOrario(), telefono]);
    // Fuori dall'emergenza le squadre non contano: sono quelle preparate.
    return r.rows.map(p => ctx.tipo === 'emergenza' ? p : { ...p, squadra: null });
}

// Il testo e il titolo di una chiamata.
function testiChiamata(ctx, messaggio) {
    const segno = ctx.simulazione ? '[SIMULAZIONE] ' : '';
    const dove = ctx.tipo === 'emergenza'
        ? `${ctx.emergenza.code}${ctx.emergenza.name ? ` - ${ctx.emergenza.name}` : ''}`
        : ctx.attivita.titolo;
    return {
        titolo: `${segno}Chiamata: ${dove}`.slice(0, 120),
        testo: messaggio || (ctx.tipo === 'emergenza' ? 'La sala operativa ti chiama: puoi venire?' : 'Ti chiamano per l\'attività: puoi venire?'),
        oggetto: `${segno}Chiamata ORION: ${dove}`
    };
}

// Gli avvisi di una chiamata, dopo la risposta alla sala.
async function avvisa(ctx, chiamata, persone) {
    const { titolo, testo: corpo, oggetto } = testiChiamata(ctx, chiamata.messaggio);
    const indirizzo = `https://${domainName}/chiamata.html?id=${chiamata.id}`;
    for (const p of persone) {
        if (chiamata.avviso_app) {
            await notifiche.scadi({ tipo: 'chiamata', riferimento: { tipo: 'chiamata', id: chiamata.id }, userId: p.id });
            await notifiche.notifica(p.id, {
                tipo: 'chiamata', categoria: ctx.tipo === 'emergenza' ? 'emergenza' : 'personale', titolo, testo: corpo,
                riferimento: { tipo: 'chiamata', id: chiamata.id },
                chiave: `chiamata:${chiamata.id}:${p.id}:${Date.now()}`,
                oreValidita: 12
            });
        }
        if (chiamata.avviso_email && p.email) {
            const html = `<p>Ciao ${escapeHtmlForEmail(p.nome || '')},</p>
                <p><strong>${escapeHtmlForEmail(titolo)}</strong></p>
                <p>${escapeHtmlForEmail(corpo)}</p>
                <p><a href="${indirizzo}">Rispondi da ORION</a>: arrivo, arrivo più tardi o non posso. Dall'app si risponde dalla notifica.</p>`;
            await sendEmailUtility(p.email, oggetto, `${corpo}\n\nRispondi da ORION: ${indirizzo}`, html)
                .catch(e => logger.warn(`[Chiamata] Email a ${p.email} non inviata: ${e.message}`));
        }
    }
}

// Chi è stato chiamato e chi ha una disponibilità nel contesto, con lo stato
// di ognuno: quello che vede la sala.
async function quadroDisponibilita(req, ctx) {
    const col = colonna(ctx);
    const telefono = await mostraTelefonoCaposquadra(req);
    const [chiamate, persone] = await Promise.all([
        pool.query(`
            SELECT c.id, c.messaggio, c.criterio, c.corso_id, c.avviso_app, c.avviso_email, c.minuti_attesa,
                   c.creata_da_nome, c.creata_il, c.richiamata_il,
                   (SELECT COUNT(*)::int FROM chiamate_persone cp WHERE cp.chiamata_id = c.id) AS chiamati
              FROM chiamate c WHERE c.${col} = $1 ORDER BY c.creata_il`, [ctx.id]),
        pool.query(`
            WITH ultime AS (
                SELECT DISTINCT ON (cp.user_id) cp.user_id, cp.chiamata_id, cp.chiamato_il, cp.avvisato_app, cp.avvisato_email, c.minuti_attesa
                  FROM chiamate_persone cp JOIN chiamate c ON c.id = cp.chiamata_id
                 WHERE c.${col} = $1 ORDER BY cp.user_id, cp.chiamato_il DESC),
            chi AS (SELECT user_id FROM ultime UNION SELECT user_id FROM disponibilita WHERE ${col} = $1)
            SELECT u.id, u.username, u.nome, u.cognome,
                   CASE WHEN $2 THEN NULLIF(TRIM(u.telefono), '') END AS telefono,
                   d.stato, d.risposta, d.minuti_ritardo, d.risposto_il, d.arrivo_previsto, d.arrivato_il, d.congedato_il, d.nota,
                   d.aggiornato_da, l.chiamata_id, l.chiamato_il, l.avvisato_app, l.avvisato_email,
                   (l.chiamato_il IS NOT NULL AND d.stato IS NULL
                    AND (NOT (l.avvisato_app OR l.avvisato_email) OR l.chiamato_il < NOW() - make_interval(mins => l.minuti_attesa))) AS da_chiamare,
                   (SELECT s.nome_radio FROM squadra_membri sm JOIN squadre s ON s.id = sm.squadra_id WHERE sm.username = u.username LIMIT 1) AS squadra
              FROM chi JOIN users u ON u.id = chi.user_id
              LEFT JOIN disponibilita d ON d.${col} = $1 AND d.user_id = u.id
              LEFT JOIN ultime l ON l.user_id = u.id
             ORDER BY CASE COALESCE(d.stato, 'senza_risposta')
                      WHEN 'arrivato' THEN 0 WHEN 'in_arrivo' THEN 1 WHEN 'senza_risposta' THEN 2 WHEN 'non_disponibile' THEN 3 ELSE 4 END,
                      d.arrivo_previsto NULLS LAST, u.cognome, u.nome`, [ctx.id, telefono])
    ]);
    const elenco = persone.rows.map(p => ({ ...p, stato: p.stato || 'senza_risposta', squadra: ctx.tipo === 'emergenza' ? p.squadra : null }));
    const conta = (f) => elenco.filter(f).length;
    return {
        contesto: ctx.tipo === 'emergenza'
            ? { tipo: 'emergenza', id: ctx.id, codice: ctx.emergenza.code, nome: ctx.emergenza.name, simulazione: ctx.simulazione }
            : { tipo: 'attivita', id: ctx.id, titolo: ctx.attivita.titolo, simulazione: false },
        puo_chiamare: puoChiamare(req, ctx),
        chiamate: chiamate.rows,
        persone: elenco,
        conteggi: {
            arrivati: conta(p => p.stato === 'arrivato'),
            in_sede: conta(p => p.stato === 'arrivato' && !p.squadra),
            in_arrivo: conta(p => p.stato === 'in_arrivo'),
            senza_risposta: conta(p => p.stato === 'senza_risposta'),
            da_chiamare: conta(p => p.da_chiamare),
            non_disponibili: conta(p => p.stato === 'non_disponibile'),
            congedati: conta(p => p.stato === 'congedato')
        }
    };
}

// Scrive la disponibilità di una persona nel contesto (crea o aggiorna).
async function scriviDisponibilita(ctx, userId, campi, chi, esecutore = pool) {
    const col = colonna(ctx);
    const r = await esecutore.query(`
        INSERT INTO disponibilita (${col}, user_id, stato, risposta, minuti_ritardo, risposto_il, arrivo_previsto, arrivato_il, congedato_il, nota, aggiornato_da)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (${col}, user_id) WHERE ${col} IS NOT NULL DO UPDATE SET
            stato = EXCLUDED.stato,
            risposta = COALESCE(EXCLUDED.risposta, disponibilita.risposta),
            minuti_ritardo = CASE WHEN EXCLUDED.risposta IS NOT NULL THEN EXCLUDED.minuti_ritardo ELSE disponibilita.minuti_ritardo END,
            risposto_il = COALESCE(EXCLUDED.risposto_il, disponibilita.risposto_il),
            arrivo_previsto = CASE WHEN EXCLUDED.risposta IS NOT NULL OR EXCLUDED.stato = 'in_arrivo' THEN EXCLUDED.arrivo_previsto ELSE disponibilita.arrivo_previsto END,
            -- Il primo arrivo resta: chi torna dopo un congedo riparte da adesso.
            arrivato_il = CASE WHEN EXCLUDED.stato = 'arrivato'
                               THEN CASE WHEN disponibilita.stato = 'arrivato' THEN disponibilita.arrivato_il ELSE EXCLUDED.arrivato_il END
                               ELSE disponibilita.arrivato_il END,
            congedato_il = CASE WHEN EXCLUDED.stato = 'congedato' THEN EXCLUDED.congedato_il
                                WHEN EXCLUDED.stato = 'arrivato' THEN NULL ELSE disponibilita.congedato_il END,
            nota = COALESCE(EXCLUDED.nota, disponibilita.nota),
            aggiornato_il = NOW(), aggiornato_da = EXCLUDED.aggiornato_da
        RETURNING *`,
        [ctx.id, userId, campi.stato, campi.risposta ?? null, campi.minuti_ritardo ?? null, campi.risposto_il ?? null,
         campi.arrivo_previsto ?? null, campi.arrivato_il ?? null, campi.congedato_il ?? null, campi.nota ?? null, chi]);
    return r.rows[0];
}

// Gli intervalli in sede dei presenti di un'emergenza, per le presenze: da
// quando sono arrivati al congedo, o alla fine.
export async function intervalliInSede(emergencyId, esecutore = pool) {
    const r = await esecutore.query(
        `SELECT u.username, d.arrivato_il, d.congedato_il FROM disponibilita d JOIN users u ON u.id = d.user_id
          WHERE d.emergency_id = $1 AND d.arrivato_il IS NOT NULL`, [emergencyId]);
    return r.rows;
}

export function registraRotteChiamate(app) {
    const soloInterni = (req, res, next) => esterno(req)
        ? res.status(403).json({ message: 'La chiamata è degli interni.' }) : next();

    // Il contesto, o la risposta che dice perché manca.
    async function contesto(req, res) {
        const ctx = await contestoDa(req);
        if (!ctx) {
            res.status(409).json({ message: 'Nessuna emergenza aperta (o attività inesistente).', nessun_contesto: true });
            return null;
        }
        return ctx;
    }

    // Chi si può chiamare, per comporre la chiamata o segnare chi arriva senza.
    app.get('/api/chiamate/candidati', soloInterni, async (req, res) => {
        try {
            const ctx = await contesto(req, res);
            if (!ctx) return;
            if (!puoSeguire(req, ctx)) return res.status(403).json({ message: "Le risposte le segue chi gestisce l'attività." });
            const persone = await candidati(req, ctx);
            // I corsi che qualcuno ha validi: le scelte per "chi ha il corso".
            const ids = [...new Set(persone.flatMap(p => p.corsi))];
            const corsi = ids.length
                ? (await pool.query('SELECT id, name AS nome FROM courses_catalog WHERE id = ANY($1::int[]) ORDER BY name', [ids])).rows : [];
            res.json({ persone, corsi, puo_chiamare: puoChiamare(req, ctx) });
        } catch (e) {
            logger.error('Errore GET /api/chiamate/candidati:', e);
            res.status(500).json({ message: 'Errore nel leggere i volontari.' });
        }
    });

    app.post('/api/chiamate', soloInterni, async (req, res) => {
        const corpo = req.body || {};
        const criterio = corpo.criterio;
        if (!['tutti', 'reperibili', 'corso', 'scelti'].includes(criterio)) return res.status(400).json({ message: 'Scegli chi chiamare.' });
        const avvisoApp = corpo.avviso_app !== false;
        const avvisoEmail = corpo.avviso_email === true;
        if (!avvisoApp && !avvisoEmail) return res.status(400).json({ message: "Scegli almeno un modo: l'app o l'email." });
        const minuti = corpo.minuti_attesa === undefined ? 10 : parseInt(corpo.minuti_attesa, 10);
        if (!Number.isInteger(minuti) || minuti < 1 || minuti > 240) return res.status(400).json({ message: "L'attesa va da 1 a 240 minuti." });
        const corsoId = criterio === 'corso' ? parseInt(corpo.corso_id, 10) : null;
        if (criterio === 'corso' && !Number.isInteger(corsoId)) return res.status(400).json({ message: 'Scegli il corso.' });
        const scelti = criterio === 'scelti' && Array.isArray(corpo.persone)
            ? new Set(corpo.persone.map(n => parseInt(n, 10)).filter(Number.isInteger)) : new Set();
        if (criterio === 'scelti' && !scelti.size) return res.status(400).json({ message: 'Scegli le persone.' });
        try {
            const ctx = await contesto(req, res);
            if (!ctx) return;
            if (!puoChiamare(req, ctx)) return res.status(403).json({ message: 'Chiamare i volontari spetta a chi coordina.' });
            if (!ctx.aperto) return res.status(409).json({ message: "L'attività non è più programmata." });

            const tutti = await candidati(req, ctx);
            const scelta = tutti.filter(p =>
                criterio === 'tutti' ? true
                    : criterio === 'reperibili' ? p.reperibile
                        : criterio === 'corso' ? p.corsi.includes(corsoId)
                            : scelti.has(p.id));
            if (criterio === 'scelti' && scelta.length !== scelti.size) return res.status(400).json({ message: 'Fra le persone scelte c\'è chi non è un interno attivo.' });
            const saltati = { in_squadra: 0, gia_in_arrivo: 0, non_disponibili: 0, assenti: 0 };
            const daChiamare = scelta.filter(p => {
                if (p.squadra) { saltati.in_squadra++; return false; }
                if (p.stato === 'in_arrivo' || p.stato === 'arrivato') { saltati.gia_in_arrivo++; return false; }
                // Chi è scelto a mano si chiama comunque: lo ha deciso la sala.
                if (criterio !== 'scelti' && p.stato === 'non_disponibile') { saltati.non_disponibili++; return false; }
                if (criterio !== 'scelti' && p.assente) { saltati.assenti++; return false; }
                return true;
            });
            if (!daChiamare.length) return res.status(400).json({ message: 'Con questa scelta non resta nessuno da chiamare.', saltati });

            const messaggio = testo(corpo.messaggio, LIMITE.messaggio);
            const client = await pool.connect();
            let chiamata;
            try {
                await client.query('BEGIN');
                chiamata = (await client.query(
                    `INSERT INTO chiamate (${colonna(ctx)}, messaggio, criterio, corso_id, avviso_app, avviso_email, minuti_attesa, creata_da, creata_da_nome)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                    [ctx.id, messaggio, criterio, corsoId, avvisoApp, avvisoEmail, minuti, req.user.id, nomeDi(req.user)])).rows[0];
                await client.query(
                    `INSERT INTO chiamate_persone (chiamata_id, user_id, avvisato_app, avvisato_email)
                     SELECT $1, x.id, x.app, x.email FROM json_to_recordset($2::json) AS x(id int, app boolean, email boolean)`,
                    [chiamata.id, JSON.stringify(daChiamare.map(p => ({ id: p.id, app: avvisoApp && p.app, email: avvisoEmail && p.email })))]);
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                throw e;
            } finally {
                client.release();
            }
            const irraggiungibili = daChiamare.filter(p => !(avvisoApp && p.app) && !(avvisoEmail && p.email))
                .map(p => ({ id: p.id, nome: p.nome, cognome: p.cognome, telefono: p.telefono }));
            registraAudit(req, 'chiamata.inviata', {
                tipo: ctx.tipo, id: ctx.id,
                dettagli: { chiamata: chiamata.id, criterio, chiamati: daChiamare.length, saltati, app: avvisoApp, email: avvisoEmail }
            });
            res.status(201).json({ chiamata, chiamati: daChiamare.length, saltati, irraggiungibili });
            avvisaClienti('reload_disponibili');
            const persone = (await pool.query(`${SQL_INTERNI} AND u.id = ANY($1::int[])`, [daChiamare.map(p => p.id)])).rows;
            avvisa(ctx, chiamata, persone).catch(e => logger.error('[Chiamata] Avvisi non inviati:', e));
        } catch (e) {
            logger.error('Errore POST /api/chiamate:', e);
            if (!res.headersSent) res.status(500).json({ message: 'Errore nel mandare la chiamata.' });
        }
    });

    // Richiamare chi non ha ancora risposto a una chiamata.
    app.post('/api/chiamate/:id/richiama', soloInterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Chiamata non valida.' });
        try {
            const c = (await pool.query('SELECT * FROM chiamate WHERE id = $1', [id])).rows[0];
            if (!c) return res.status(404).json({ message: 'Chiamata non trovata.' });
            const ctx = await contestoDa({ body: {}, query: c.attivita_id ? { attivita_id: c.attivita_id } : {} });
            if (!ctx || (ctx.tipo === 'emergenza' && ctx.id !== c.emergency_id)) return res.status(409).json({ message: 'La chiamata è di un\'emergenza chiusa.' });
            if (!puoChiamare(req, ctx)) return res.status(403).json({ message: 'Chiamare i volontari spetta a chi coordina.' });
            if (!ctx.aperto) return res.status(409).json({ message: "L'attività non è più programmata." });
            const col = colonna(ctx);
            const r = await pool.query(`
                UPDATE chiamate_persone cp SET chiamato_il = NOW()
                 WHERE cp.chiamata_id = $1
                   AND NOT EXISTS (SELECT 1 FROM disponibilita d WHERE d.${col} = $2 AND d.user_id = cp.user_id)
                RETURNING cp.user_id`, [id, ctx.id]);
            if (!r.rowCount) return res.status(409).json({ message: 'Hanno già risposto tutti.' });
            await pool.query('UPDATE chiamate SET richiamata_il = NOW() WHERE id = $1', [id]);
            registraAudit(req, 'chiamata.richiamata', { tipo: ctx.tipo, id: ctx.id, dettagli: { chiamata: id, richiamati: r.rowCount } });
            res.json({ richiamati: r.rowCount });
            avvisaClienti('reload_disponibili');
            const persone = (await pool.query(`${SQL_INTERNI} AND u.id = ANY($1::int[])`, [r.rows.map(x => x.user_id)])).rows;
            avvisa(ctx, c, persone).catch(e => logger.error('[Chiamata] Richiamo non inviato:', e));
        } catch (e) {
            logger.error('Errore POST /api/chiamate/:id/richiama:', e);
            if (!res.headersSent) res.status(500).json({ message: 'Errore nel richiamare.' });
        }
    });

    // Le chiamate a me ancora aperte, con la mia risposta: per l'app e per il web.
    app.get('/api/chiamate/mie', soloInterni, async (req, res) => {
        try {
            const r = await pool.query(`
                SELECT DISTINCT ON (COALESCE(c.emergency_id, -c.attivita_id))
                       c.id, c.messaggio, c.creata_il, c.emergency_id, c.attivita_id,
                       e.code AS emergenza_codice, e.name AS emergenza_nome, a.titolo AS attivita_titolo,
                       d.stato, d.risposta, d.minuti_ritardo, d.arrivo_previsto, d.arrivato_il
                  FROM chiamate_persone cp JOIN chiamate c ON c.id = cp.chiamata_id
                  LEFT JOIN emergencies e ON e.id = c.emergency_id
                  LEFT JOIN attivita a ON a.id = c.attivita_id
                  LEFT JOIN disponibilita d ON d.user_id = cp.user_id
                       AND ((c.emergency_id IS NOT NULL AND d.emergency_id = c.emergency_id) OR (c.attivita_id IS NOT NULL AND d.attivita_id = c.attivita_id))
                 WHERE cp.user_id = $1
                   AND ((c.emergency_id IS NOT NULL AND e.status = 'ACTIVE') OR (c.attivita_id IS NOT NULL AND a.stato = 'programmata'))
                 ORDER BY COALESCE(c.emergency_id, -c.attivita_id), c.creata_il DESC`, [req.user.id]);
            res.json(r.rows.map(x => ({
                ...x,
                simulazione: x.emergency_id && activeEmergency?.id === x.emergency_id ? activeEmergency.simulazione === true : false,
                stato: x.stato || 'senza_risposta'
            })));
        } catch (e) {
            logger.error('Errore GET /api/chiamate/mie:', e);
            res.status(500).json({ message: 'Errore nel leggere le chiamate.' });
        }
    });

    // Una chiamata, per chi l'ha ricevuta (la pagina della risposta) o per la sala.
    app.get('/api/chiamate/:id', soloInterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Chiamata non valida.' });
        try {
            const c = (await pool.query(`
                SELECT c.id, c.messaggio, c.creata_il, c.creata_da_nome, c.emergency_id, c.attivita_id,
                       e.code AS emergenza_codice, e.name AS emergenza_nome, e.status AS emergenza_stato,
                       a.titolo AS attivita_titolo, a.stato AS attivita_stato,
                       EXISTS (SELECT 1 FROM chiamate_persone cp WHERE cp.chiamata_id = c.id AND cp.user_id = $2) AS chiamato
                  FROM chiamate c LEFT JOIN emergencies e ON e.id = c.emergency_id LEFT JOIN attivita a ON a.id = c.attivita_id
                 WHERE c.id = $1`, [id, req.user.id])).rows[0];
            if (!c || (!c.chiamato && !haPermesso(req, 'emergenze.apertura', 'gruppo.attivita'))) return res.status(404).json({ message: 'Chiamata non trovata.' });
            const d = (await pool.query(
                `SELECT stato, risposta, minuti_ritardo, arrivo_previsto, arrivato_il, nota FROM disponibilita
                  WHERE user_id = $1 AND ${c.emergency_id ? 'emergency_id' : 'attivita_id'} = $2`,
                [req.user.id, c.emergency_id || c.attivita_id])).rows[0];
            const aperta = c.emergency_id ? c.emergenza_stato === 'ACTIVE' : c.attivita_stato === 'programmata';
            res.json({
                id: c.id, messaggio: c.messaggio, creata_il: c.creata_il, creata_da_nome: c.creata_da_nome,
                emergency_id: c.emergency_id, attivita_id: c.attivita_id,
                emergenza_codice: c.emergenza_codice, emergenza_nome: c.emergenza_nome, attivita_titolo: c.attivita_titolo,
                simulazione: c.emergency_id && activeEmergency?.id === c.emergency_id ? activeEmergency.simulazione === true : false,
                aperta, chiamato: c.chiamato,
                stato: d?.stato || 'senza_risposta', risposta: d?.risposta || null, minuti_ritardo: d?.minuti_ritardo ?? null,
                arrivo_previsto: d?.arrivo_previsto || null, arrivato_il: d?.arrivato_il || null, nota: d?.nota || null
            });
        } catch (e) {
            logger.error('Errore GET /api/chiamate/:id:', e);
            res.status(500).json({ message: 'Errore nel leggere la chiamata.' });
        }
    });

    // La risposta di chi è stato chiamato.
    app.post('/api/chiamate/:id/risposta', soloInterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const risposta = req.body?.risposta;
        if (!Number.isInteger(id) || !RISPOSTE.includes(risposta)) return res.status(400).json({ message: 'Rispondi "arrivo", "ritardo" o "no".' });
        const minuti = risposta === 'ritardo' ? parseInt(req.body?.minuti, 10) : null;
        if (risposta === 'ritardo' && (!Number.isInteger(minuti) || minuti < 5 || minuti > 720)) return res.status(400).json({ message: 'Indica fra quanti minuti arrivi (da 5 a 720).' });
        try {
            const c = (await pool.query(
                `SELECT c.* FROM chiamate c JOIN chiamate_persone cp ON cp.chiamata_id = c.id AND cp.user_id = $2 WHERE c.id = $1`,
                [id, req.user.id])).rows[0];
            if (!c) return res.status(404).json({ message: 'Chiamata non trovata.' });
            const ctx = await contestoDa({ body: {}, query: c.attivita_id ? { attivita_id: c.attivita_id } : {} });
            if (!ctx || !ctx.aperto || (ctx.tipo === 'emergenza' && ctx.id !== c.emergency_id)) {
                return res.status(409).json({ message: 'La chiamata è chiusa: l\'emergenza o l\'attività è finita.' });
            }
            const prima = (await pool.query(`SELECT stato FROM disponibilita WHERE ${colonna(ctx)} = $1 AND user_id = $2`, [ctx.id, req.user.id])).rows[0];
            // Chi è già in sede resta in sede: la risposta si annota e basta.
            const stato = prima?.stato === 'arrivato' ? 'arrivato' : (risposta === 'no' ? 'non_disponibile' : 'in_arrivo');
            const d = await scriviDisponibilita(ctx, req.user.id, {
                stato, risposta, minuti_ritardo: minuti, risposto_il: new Date(),
                arrivo_previsto: risposta === 'ritardo' ? new Date(Date.now() + minuti * 60000) : null,
                nota: testo(req.body?.nota, LIMITE.nota)
            }, nomeDi(req.user));
            await notifiche.scadi({ tipo: 'chiamata', riferimento: { tipo: 'chiamata', id }, userId: req.user.id });
            registraAudit(req, 'chiamata.risposta', { tipo: ctx.tipo, id: ctx.id, dettagli: { chiamata: id, risposta, minuti } });
            avvisaClienti('reload_disponibili');
            res.json({ stato: d.stato, risposta: d.risposta, minuti_ritardo: d.minuti_ritardo, arrivo_previsto: d.arrivo_previsto, arrivato_il: d.arrivato_il });
        } catch (e) {
            logger.error('Errore POST /api/chiamate/:id/risposta:', e);
            res.status(500).json({ message: 'Errore nel salvare la risposta.' });
        }
    });

    // "Sono arrivato in sede", detto da chi è stato chiamato.
    app.post('/api/disponibilita/arrivato', soloInterni, async (req, res) => {
        try {
            const ctx = await contesto(req, res);
            if (!ctx) return;
            if (!ctx.aperto) return res.status(409).json({ message: "L'attività non è più programmata." });
            const col = colonna(ctx);
            const chiamato = await pool.query(
                `SELECT 1 FROM chiamate_persone cp JOIN chiamate c ON c.id = cp.chiamata_id WHERE c.${col} = $1 AND cp.user_id = $2
                 UNION SELECT 1 FROM disponibilita WHERE ${col} = $1 AND user_id = $2`, [ctx.id, req.user.id]);
            if (!chiamato.rowCount) return res.status(403).json({ message: 'Non risulti chiamato: lo segna la sala quando arrivi.' });
            const d = await scriviDisponibilita(ctx, req.user.id, { stato: 'arrivato', arrivato_il: new Date() }, nomeDi(req.user));
            registraAudit(req, 'disponibilita.arrivato', { tipo: ctx.tipo, id: ctx.id, dettagli: { da_se: true } });
            avvisaClienti('reload_disponibili');
            res.json({ stato: d.stato, arrivato_il: d.arrivato_il });
        } catch (e) {
            logger.error('Errore POST /api/disponibilita/arrivato:', e);
            res.status(500).json({ message: "Errore nel segnare l'arrivo." });
        }
    });

    // Il quadro delle disponibilità, per la sala.
    app.get('/api/disponibilita', soloInterni, async (req, res) => {
        try {
            const ctx = await contesto(req, res);
            if (!ctx) return;
            if (!puoSeguire(req, ctx)) return res.status(403).json({ message: "Le risposte le segue chi gestisce l'attività." });
            res.json(await quadroDisponibilita(req, ctx));
        } catch (e) {
            logger.error('Errore GET /api/disponibilita:', e);
            res.status(500).json({ message: 'Errore nel leggere le disponibilità.' });
        }
    });

    // La sala segna lo stato di una persona: arrivata (anche senza chiamata),
    // congedata, non disponibile o in arrivo.
    app.put('/api/disponibilita/:userId', soloInterni, async (req, res) => {
        const userId = parseInt(req.params.userId, 10);
        const stato = req.body?.stato;
        if (!Number.isInteger(userId) || !STATI.includes(stato)) return res.status(400).json({ message: 'Stato non valido.' });
        try {
            const ctx = await contesto(req, res);
            if (!ctx) return;
            if (!puoSeguire(req, ctx)) return res.status(403).json({ message: "Le risposte le segue chi gestisce l'attività." });
            if (!ctx.aperto) return res.status(409).json({ message: "L'attività non è più programmata." });
            const persona = (await pool.query(`${SQL_INTERNI} AND u.id = $1`, [userId])).rows[0];
            if (!persona) return res.status(400).json({ message: 'Solo i volontari interni hanno una disponibilità.' });
            const prima = (await pool.query(`SELECT stato FROM disponibilita WHERE ${colonna(ctx)} = $1 AND user_id = $2`, [ctx.id, userId])).rows[0];
            if (stato === 'congedato' && prima?.stato !== 'arrivato') return res.status(409).json({ message: 'Si congeda solo chi è in sede.' });
            const adesso = new Date();
            const minuti = stato === 'in_arrivo' && req.body?.minuti !== undefined ? parseInt(req.body.minuti, 10) : null;
            const d = await scriviDisponibilita(ctx, userId, {
                stato,
                arrivato_il: stato === 'arrivato' ? adesso : null,
                congedato_il: stato === 'congedato' ? adesso : null,
                arrivo_previsto: Number.isInteger(minuti) && minuti > 0 ? new Date(adesso.getTime() + minuti * 60000) : null,
                nota: testo(req.body?.nota, LIMITE.nota)
            }, nomeDi(req.user));
            registraAudit(req, `disponibilita.${stato}`, { tipo: ctx.tipo, id: ctx.id, dettagli: { user_id: userId, persona: nomeDi(persona), prima: prima?.stato || null } });
            avvisaClienti('reload_disponibili');
            res.json(d);
        } catch (e) {
            logger.error('Errore PUT /api/disponibilita/:userId:', e);
            res.status(500).json({ message: 'Errore nel salvare la disponibilità.' });
        }
    });

    // --- Reperibilità ---------------------------------------------------------------

    const organizza = (req) => haPermesso(req, 'gruppo.attivita');

    // I turni di un periodo: tutti per chi organizza, i propri per gli altri.
    app.get('/api/reperibilita', soloInterni, async (req, res) => {
        const da = giorno(req.query.da) || oggiLocale(), a = giorno(req.query.a) || da;
        try {
            const r = await pool.query(`
                SELECT p.id, p.user_id, p.dal, p.al, p.nota, u.nome, u.cognome
                  FROM reperibilita p JOIN users u ON u.id = p.user_id
                 WHERE p.al >= $1 AND p.dal <= $2 AND ($3 OR p.user_id = $4)
                 ORDER BY p.dal, u.cognome, u.nome`, [da, a, organizza(req), req.user.id]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET /api/reperibilita:', e);
            res.status(500).json({ message: 'Errore nel leggere la reperibilità.' });
        }
    });

    app.post('/api/reperibilita', soloInterni, async (req, res) => {
        if (!organizza(req)) return res.status(403).json({ message: 'Ti serve il permesso "Organizzare attività e presenze".' });
        const dal = giorno(req.body?.dal), al = giorno(req.body?.al);
        const persone = Array.isArray(req.body?.persone) ? [...new Set(req.body.persone.map(n => parseInt(n, 10)).filter(Number.isInteger))] : [];
        if (!dal || !al || al < dal) return res.status(400).json({ message: 'Indica il periodo (dal, al).' });
        if ((new Date(al) - new Date(dal)) / 86400000 > 92) return res.status(400).json({ message: 'Un turno dura al massimo tre mesi.' });
        if (!persone.length) return res.status(400).json({ message: 'Scegli chi è reperibile.' });
        try {
            const ok = await pool.query(`${SQL_INTERNI} AND u.id = ANY($1::int[])`, [persone]);
            if (ok.rowCount !== persone.length) return res.status(400).json({ message: "Fra le persone c'è chi non è un interno attivo." });
            const r = await pool.query(
                `INSERT INTO reperibilita (user_id, dal, al, nota, creato_da) SELECT unnest($1::int[]), $2, $3, $4, $5 RETURNING id`,
                [persone, dal, al, testo(req.body?.nota, LIMITE.nota), req.user.id]);
            registraAudit(req, 'reperibilita.aggiunta', { tipo: 'reperibilita', id: r.rows[0].id, dettagli: { dal, al, persone } });
            res.status(201).json({ aggiunti: r.rowCount });
        } catch (e) {
            logger.error('Errore POST /api/reperibilita:', e);
            res.status(500).json({ message: 'Errore nel salvare la reperibilità.' });
        }
    });

    app.delete('/api/reperibilita/:id', soloInterni, async (req, res) => {
        if (!organizza(req)) return res.status(403).json({ message: 'Ti serve il permesso "Organizzare attività e presenze".' });
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Turno non valido.' });
        try {
            const r = await pool.query('DELETE FROM reperibilita WHERE id = $1 RETURNING user_id, dal, al', [id]);
            if (!r.rowCount) return res.status(404).json({ message: 'Turno non trovato.' });
            registraAudit(req, 'reperibilita.tolta', { tipo: 'reperibilita', id, dettagli: r.rows[0] });
            res.status(204).end();
        } catch (e) {
            logger.error('Errore DELETE /api/reperibilita/:id:', e);
            res.status(500).json({ message: 'Errore nel togliere il turno.' });
        }
    });

    // --- Assenze --------------------------------------------------------------------

    // Le mie assenze da oggi in poi.
    app.get('/api/assenze/mie', soloInterni, async (req, res) => {
        try {
            const r = await pool.query(
                'SELECT id, dal, al, nota FROM assenze WHERE user_id = $1 AND al >= $2 ORDER BY dal', [req.user.id, oggiLocale()]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET /api/assenze/mie:', e);
            res.status(500).json({ message: 'Errore nel leggere le assenze.' });
        }
    });

    // Le assenze di tutti in un periodo, per chi chiama o organizza.
    app.get('/api/assenze', soloInterni, async (req, res) => {
        if (!haPermesso(req, 'gruppo.attivita', 'emergenze.apertura')) return res.status(403).json({ message: 'Ti serve il permesso "Organizzare attività e presenze".' });
        const da = giorno(req.query.da) || oggiLocale(), a = giorno(req.query.a) || da;
        try {
            const r = await pool.query(`
                SELECT s.id, s.user_id, s.dal, s.al, s.nota, u.nome, u.cognome
                  FROM assenze s JOIN users u ON u.id = s.user_id
                 WHERE s.al >= $1 AND s.dal <= $2 ORDER BY s.dal, u.cognome`, [da, a]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET /api/assenze:', e);
            res.status(500).json({ message: 'Errore nel leggere le assenze.' });
        }
    });

    app.post('/api/assenze', soloInterni, async (req, res) => {
        const dal = giorno(req.body?.dal), al = giorno(req.body?.al);
        if (!dal || !al || al < dal) return res.status(400).json({ message: 'Indica il periodo (dal, al).' });
        if (al < oggiLocale()) return res.status(400).json({ message: 'Un periodo già passato non serve.' });
        if ((new Date(al) - new Date(dal)) / 86400000 > 366) return res.status(400).json({ message: "Un'assenza dura al massimo un anno." });
        try {
            const r = await pool.query(
                'INSERT INTO assenze (user_id, dal, al, nota) VALUES ($1, $2, $3, $4) RETURNING id, dal, al, nota',
                [req.user.id, dal, al, testo(req.body?.nota, LIMITE.nota)]);
            registraAudit(req, 'assenza.dichiarata', { tipo: 'assenza', id: r.rows[0].id, dettagli: { dal, al } });
            res.status(201).json(r.rows[0]);
        } catch (e) {
            logger.error('Errore POST /api/assenze:', e);
            res.status(500).json({ message: "Errore nel salvare l'assenza." });
        }
    });

    app.delete('/api/assenze/:id', soloInterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Assenza non valida.' });
        try {
            const r = await pool.query(
                'DELETE FROM assenze WHERE id = $1 AND (user_id = $2 OR $3) RETURNING user_id, dal, al',
                [id, req.user.id, organizza(req)]);
            if (!r.rowCount) return res.status(404).json({ message: 'Assenza non trovata.' });
            registraAudit(req, 'assenza.tolta', { tipo: 'assenza', id, dettagli: r.rows[0] });
            res.status(204).end();
        } catch (e) {
            logger.error('Errore DELETE /api/assenze/:id:', e);
            res.status(500).json({ message: "Errore nel togliere l'assenza." });
        }
    });
}

