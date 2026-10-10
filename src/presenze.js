// Le presenze: chi c'era, quando e per quante ore, a un'attività del gruppo o
// a un'emergenza. Finiscono nel libretto di ognuno, nel riepilogo annuale e
// negli attestati (per il datore di lavoro, per esempio).
//
// Quelle delle attività le scrive chi chiude l'attività (src/attivita.js).
// Quelle delle emergenze si calcolano alla chiusura dal registro delle
// squadre (emergency_team_log), che dice chi è entrato e uscito da quale
// squadra e quando: si sommano gli intervalli di ognuno, chi è passato da una
// squadra all'altra non conta due volte, chi era in una squadra già pronta
// conta dall'apertura. Contano solo gli interni: anche chi è nella squadra
// COC, la sala. Si scrivono da sole e si correggono dopo, con il registro
// delle operazioni; chi in sala non era in nessuna squadra si aggiunge a mano.
//
// Le correzioni e il riepilogo di tutti sono di chi ha gruppo.attivita; il
// riepilogo lo legge anche chi gestisce l'anagrafica. Ognuno vede le sue e ne
// scarica l'attestato.

import pdfmake from 'pdfmake';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { dataItaliana, dataOraItaliana, fusoOrario, oraItaliana } from './date.js';
import { pool } from './db.js';
import { haPermesso, richiedePermesso } from './permessi.js';
import { nomeUtente, ruoliDi } from './autenticazione.js';
import { intervalliInSede } from './chiamate.js';

const minutiTra = (inizio, fine) => Math.max(0, Math.round((fine - inizio) / 60000));
const comeData = (valore) => valore instanceof Date ? valore
    : new Date(String(valore).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));

function istante(valore) {
    if (typeof valore !== 'string' || !valore.trim()) return null;
    const d = new Date(valore);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function oreDa(minuti) {
    const h = Math.floor(minuti / 60), m = minuti % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// --- Le attività --------------------------------------------------------------

// I presenti di un'attività: [{ user_id, inizio?, fine? }], con gli orari
// dell'attività dove mancano. Sostituisce quelli di prima; un addestramento
// che vale come corso lo scrive nel libretto dei presenti (e lo toglie a chi
// non risulta più presente).
export async function registraPresenzeAttivita(attivitaId, presenze, req) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const a = (await client.query(
            `SELECT a.*, t.nome AS tipo, c.validity_months FROM attivita a
               LEFT JOIN attivita_tipi t ON t.id = a.tipo_id LEFT JOIN courses_catalog c ON c.id = a.corso_id
              WHERE a.id = $1 FOR UPDATE OF a`, [attivitaId])).rows[0];
        if (!a) { await client.query('ROLLBACK'); return { errore: 'Attività non trovata.', stato: 404 }; }
        if (a.stato === 'annullata') { await client.query('ROLLBACK'); return { errore: "Un'attività annullata non ha presenti.", stato: 409 }; }
        if (comeData(a.inizio) > new Date()) { await client.query('ROLLBACK'); return { errore: "L'attività non è ancora cominciata.", stato: 409 }; }

        const righe = [];
        for (const p of presenze) {
            const userId = parseInt(p?.user_id, 10);
            if (!Number.isInteger(userId)) { await client.query('ROLLBACK'); return { errore: 'Presente non valido.' }; }
            const inizio = p.inizio ? istante(p.inizio) : comeData(a.inizio);
            const fine = p.fine ? istante(p.fine) : comeData(a.fine);
            if (!inizio || !fine || fine < inizio) { await client.query('ROLLBACK'); return { errore: 'Orari non validi per uno dei presenti.' }; }
            if (fine - inizio > 31 * 24 * 3600000) { await client.query('ROLLBACK'); return { errore: 'Una presenza dura al massimo un mese.' }; }
            righe.push({ userId, inizio, fine });
        }
        const ids = [...new Set(righe.map(r => r.userId))];
        if (ids.length !== righe.length) { await client.query('ROLLBACK'); return { errore: 'Una persona compare due volte.' }; }
        if (ids.length) {
            const interni = await client.query(
                `SELECT u.id FROM users u WHERE u.id = ANY($1::int[]) AND u.eliminato_il IS NULL
                   AND NOT EXISTS (SELECT 1 FROM utenti_ruoli ur WHERE ur.user_id = u.id AND ur.ruolo = 'esterno')`, [ids]);
            if (interni.rowCount !== ids.length) { await client.query('ROLLBACK'); return { errore: "Fra i presenti c'è chi non è un interno." }; }
        }

        // Chi non c'è più: via la presenza e il corso che gli era stato scritto.
        const tolti = (await client.query(
            'DELETE FROM partecipazioni WHERE attivita_id = $1 AND NOT (user_id = ANY($2::int[])) RETURNING corso_utente_id', [attivitaId, ids])).rows;
        for (const t of tolti.filter(t => t.corso_utente_id)) await client.query('DELETE FROM user_courses WHERE id = $1', [t.corso_utente_id]);

        const titolo = a.titolo;
        const tipo = a.tipo || 'Attività';
        const chi = nomeUtente(req.user);
        let corsi = 0;
        for (const r of righe) {
            const salvata = (await client.query(
                `INSERT INTO partecipazioni (user_id, origine, attivita_id, titolo, tipo, inizio, fine, minuti, registrata_da)
                 VALUES ($1, 'attivita', $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (user_id, attivita_id) WHERE attivita_id IS NOT NULL
                 DO UPDATE SET inizio = EXCLUDED.inizio, fine = EXCLUDED.fine, minuti = EXCLUDED.minuti, titolo = EXCLUDED.titolo,
                               tipo = EXCLUDED.tipo, corretta_il = NOW(), corretta_da = EXCLUDED.registrata_da
                 RETURNING id, corso_utente_id`,
                [r.userId, attivitaId, titolo, tipo, r.inizio, r.fine, minutiTra(r.inizio, r.fine), chi])).rows[0];
            if (a.corso_id && !salvata.corso_utente_id) {
                const giorno = new Intl.DateTimeFormat('en-CA', { timeZone: fusoOrario(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(comeData(a.inizio));
                const corso = (await client.query(
                    `INSERT INTO user_courses (user_id, course_id, acquisition_date, expiry_date)
                     VALUES ($1, $2, $3::date, CASE WHEN $4::int IS NULL THEN NULL ELSE ($3::date + make_interval(months => $4::int))::date END)
                     RETURNING id`, [r.userId, a.corso_id, giorno, a.validity_months])).rows[0];
                await client.query('UPDATE partecipazioni SET corso_utente_id = $2 WHERE id = $1', [salvata.id, corso.id]);
                corsi++;
            }
        }
        await client.query(
            `UPDATE attivita SET stato = 'conclusa', conclusa_il = COALESCE(conclusa_il, NOW()), aggiornato_il = NOW() WHERE id = $1`, [attivitaId]);
        await client.query('COMMIT');
        return { presenti: righe.length, corsi };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

// --- Le emergenze --------------------------------------------------------------

// Gli intervalli di ognuno dal registro delle squadre, uniti dove si toccano.
// [inSede]: chi è arrivato in sede dopo una chiamata conta da quando è
// arrivato al congedo (o alla fine), anche fuori dalle squadre.
export function intervalliDalRegistro(righe, fineEmergenza, inSede = []) {
    const perPersona = new Map();
    const di = (username) => {
        if (!perPersona.has(username)) perPersona.set(username, { aperti: new Map(), intervalli: [], squadre: new Set() });
        return perPersona.get(username);
    };
    for (const r of righe) {
        if (!r.username) continue;
        const p = di(r.username);
        const quando = comeData(r.quando);
        // Ogni squadra ha il suo intervallo: entrare in Bravo prima di uscire
        // da Alfa non chiude il tempo in Alfa.
        const chiave = r.nome_radio || '';
        if (r.azione === 'membro_aggiunto') {
            p.squadre.add(r.nome_radio);
            if (!p.aperti.has(chiave)) p.aperti.set(chiave, quando);
        } else if (r.azione === 'membro_rimosso') {
            const da = p.aperti.has(chiave) ? chiave : (p.aperti.size === 1 ? [...p.aperti.keys()][0] : null);
            if (da === null) continue;
            p.intervalli.push([p.aperti.get(da), quando]);
            p.aperti.delete(da);
        }
    }
    for (const s of inSede) {
        if (!s.username || !s.arrivato_il) continue;
        const p = di(s.username);
        p.squadre.add('in sede');
        p.intervalli.push([comeData(s.arrivato_il), s.congedato_il ? comeData(s.congedato_il) : fineEmergenza]);
    }
    const esito = new Map();
    for (const [username, p] of perPersona) {
        for (const inizio of p.aperti.values()) p.intervalli.push([inizio, fineEmergenza]);
        const ordinati = p.intervalli.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
        const uniti = [];
        for (const [a, b] of ordinati) {
            const ultimo = uniti[uniti.length - 1];
            if (ultimo && a <= ultimo[1]) ultimo[1] = new Date(Math.max(ultimo[1], b));
            else uniti.push([a, b]);
        }
        if (!uniti.length) continue;
        esito.set(username, {
            inizio: uniti[0][0], fine: uniti[uniti.length - 1][1],
            minuti: uniti.reduce((t, [a, b]) => t + minutiTra(a, b), 0),
            squadre: [...p.squadre]
        });
    }
    return esito;
}

function dettaglioSquadre(squadre) {
    const vere = squadre.filter(s => s !== 'in sede');
    const parti = [];
    if (vere.length) parti.push(`Squadre: ${vere.join(', ')}`);
    if (vere.length < squadre.length) parti.push('in sede dopo la chiamata');
    return parti.join('; ');
}

// Chi era in servizio in un'emergenza (interni soltanto), dal registro delle
// squadre e dagli arrivi in sede: [{ id, username, inizio, fine, minuti, squadre }].
async function presentiDelRegistro(e) {
    const registro = (await pool.query(
        `SELECT username, nome_radio, azione, quando FROM emergency_team_log
          WHERE emergency_id = $1 AND azione IN ('membro_aggiunto', 'membro_rimosso') ORDER BY quando, id`, [e.id])).rows;
    const fine = e.end_time ? comeData(e.end_time) : new Date();
    const intervalli = intervalliDalRegistro(registro, fine, await intervalliInSede(e.id));
    if (!intervalli.size) return [];
    const persone = (await pool.query(
        `SELECT u.id, u.username FROM users u WHERE u.username = ANY($1::text[]) AND u.eliminato_il IS NULL
           AND NOT EXISTS (SELECT 1 FROM utenti_ruoli ur WHERE ur.user_id = u.id AND ur.ruolo = 'esterno')`, [[...intervalli.keys()]])).rows;
    return persone.map(p => ({ id: p.id, username: p.username, ...intervalli.get(p.username) }));
}

// Alla chiusura: le presenze degli interni che sono stati in una squadra o in sede.
export async function registraPresenzeEmergenza(emergencyId, req = null) {
    const e = (await pool.query('SELECT id, code, name, start_time, end_time FROM emergencies WHERE id = $1', [emergencyId])).rows[0];
    if (!e) return 0;
    const presenti = await presentiDelRegistro(e);
    const titolo = e.name ? `${e.code} - ${e.name}` : e.code;
    let scritte = 0;
    for (const i of presenti) {
        const r = await pool.query(
            `INSERT INTO partecipazioni (user_id, origine, emergency_id, titolo, tipo, inizio, fine, minuti, dettaglio, registrata_da)
             VALUES ($1, 'emergenza', $2, $3, 'Emergenza', $4, $5, $6, $7, 'ORION, dal registro delle squadre')
             ON CONFLICT (user_id, emergency_id) WHERE emergency_id IS NOT NULL DO NOTHING`,
            [i.id, emergencyId, titolo, i.inizio, i.fine, i.minuti, dettaglioSquadre(i.squadre)]);
        scritte += r.rowCount;
    }
    if (scritte) {
        logger.info(`[Presenze] Emergenza ${e.code}: ${scritte} presenze dal registro delle squadre.`);
        if (req) registraAudit(req, 'presenze.emergenza', { tipo: 'emergenza', id: emergencyId, dettagli: { presenze: scritte } });
    }
    return scritte;
}

// Alla chiusura di una simulazione in sala: le presenze vanno all'attività
// del calendario (che diventa conclusa), non fra le emergenze. Un
// addestramento che vale come corso lo scrive nel libretto dei presenti.
export async function registraPresenzeSimulazione(emergencyId, attivitaId, req) {
    const e = (await pool.query('SELECT id, code, name, start_time, end_time FROM emergencies WHERE id = $1', [emergencyId])).rows[0];
    if (!e) return 0;
    const presenti = await presentiDelRegistro(e);
    const esito = await registraPresenzeAttivita(attivitaId, presenti.map(i => ({ user_id: i.id, inizio: i.inizio.toISOString(), fine: i.fine.toISOString() })), req);
    if (esito.errore) {
        logger.warn(`[Presenze] Simulazione ${e.code}: presenze non scritte nell'attività ${attivitaId} (${esito.errore}).`);
        return 0;
    }
    logger.info(`[Presenze] Simulazione ${e.code}: ${esito.presenti} presenze nell'attività ${attivitaId}${esito.corsi ? `, ${esito.corsi} corsi nel libretto` : ''}.`);
    registraAudit(req, 'presenze.simulazione', { tipo: 'attivita', id: attivitaId, dettagli: { emergenza: emergencyId, presenze: esito.presenti, corsi: esito.corsi } });
    return esito.presenti;
}

// --- Rotte --------------------------------------------------------------------

const SELECT_PRESENZE = `
    SELECT p.id, p.user_id, p.origine, p.attivita_id, p.emergency_id, p.titolo, p.tipo, p.inizio, p.fine, p.minuti,
           p.dettaglio, p.nota, p.corso_utente_id IS NOT NULL AS corso, p.registrata_il, p.registrata_da, p.corretta_il, p.corretta_da
      FROM partecipazioni p`;

function annoDa(req) {
    const anno = parseInt(req.query.anno, 10);
    return Number.isInteger(anno) && anno > 1990 && anno < 2200 ? anno : new Date().getFullYear();
}

async function presenzeDi(userId, anno) {
    const fuso = fusoOrario();
    const [voci, anni] = await Promise.all([
        pool.query(`${SELECT_PRESENZE} WHERE p.user_id = $1 AND EXTRACT(YEAR FROM p.inizio AT TIME ZONE $3) = $2 ORDER BY p.inizio DESC`, [userId, anno, fuso]),
        pool.query(`SELECT DISTINCT EXTRACT(YEAR FROM inizio AT TIME ZONE $2)::int AS anno FROM partecipazioni WHERE user_id = $1 ORDER BY 1 DESC`, [userId, fuso])
    ]);
    const minuti = voci.rows.reduce((t, v) => t + v.minuti, 0);
    return {
        anno,
        anni: anni.rows.map(r => r.anno),
        minuti_totali: minuti,
        ore_totali: oreDa(minuti),
        emergenze: voci.rows.filter(v => v.origine === 'emergenza').length,
        attivita: voci.rows.filter(v => v.origine === 'attivita').length,
        voci: voci.rows.map(v => ({ ...v, ore: oreDa(v.minuti) }))
    };
}

// L'attestato in PDF: carta intestata con il nome dell'associazione.
async function attestatoPdf(p, persona) {
    const associazione = (await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'association_name'")).rows[0]?.setting_value || 'Associazione di protezione civile';
    const stessoGiorno = dataItaliana(p.inizio) === dataItaliana(p.fine);
    const periodo = stessoGiorno
        ? `il giorno ${dataItaliana(p.inizio)}, dalle ${oraItaliana(p.inizio)} alle ${oraItaliana(p.fine)}`
        : `dal ${dataOraItaliana(p.inizio)} al ${dataOraItaliana(p.fine)}`;
    const cosa = p.origine === 'emergenza'
        ? `all'emergenza ${p.titolo}`
        : `all'attività "${p.titolo}" (${p.tipo.toLowerCase()})`;
    const nome = `${persona.nome || ''} ${persona.cognome || ''}`.trim() || persona.username;
    const nato = persona.codice_fiscale ? `, codice fiscale ${persona.codice_fiscale},` : ',';
    pdfmake.setFonts({ Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } });
    // Nessuna immagine o carattere da internet né dal disco: il documento è
    // solo testo, con i caratteri standard del PDF.
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((percorso) => /^Helvetica(-Bold|-Oblique|-BoldOblique)?$/.test(percorso));
    return pdfmake.createPdf({
        pageSize: 'A4', pageMargins: [60, 70, 60, 70],
        defaultStyle: { font: 'Helvetica', fontSize: 11, lineHeight: 1.35 },
        info: { title: `Attestato di presenza - ${nome}` },
        content: [
            { text: associazione, fontSize: 16, bold: true, alignment: 'center' },
            { text: 'Attestato di presenza', fontSize: 13, alignment: 'center', margin: [0, 6, 0, 36] },
            { text: `Si attesta che ${nome}${nato} volontario di questa associazione, ha preso parte ${cosa} ${periodo}, per complessive ${oreDa(p.minuti)} di impiego.` },
            p.origine === 'emergenza' ? { text: 'Le ore risultano dal registro delle squadre tenuto dalla sala operativa durante l\'emergenza.', margin: [0, 12, 0, 0], color: '#444444' } : '',
            { text: "Si rilascia su richiesta dell'interessato per gli usi consentiti dalla legge.", margin: [0, 12, 0, 0] },
            { text: `Data: ${dataItaliana(new Date())}`, margin: [0, 48, 0, 0] },
            { columns: [{ text: '' }, { text: 'Il responsabile\n\n\n______________________________', alignment: 'center' }], margin: [0, 24, 0, 0] },
            { text: `Documento preparato con ORION. Rif. presenza n. ${p.id}.`, fontSize: 8, color: '#777777', margin: [0, 60, 0, 0] }
        ]
    }).getBuffer();
}

export function registraRottePresenze(app) {
    const correzione = richiedePermesso('gruppo.attivita');
    const vedeTutti = (req) => haPermesso(req, 'gruppo.attivita', 'volontari.anagrafica');
    const soloInterni = (req, res, next) => ruoliDi(req.user).includes('esterno')
        ? res.status(403).json({ message: 'Le presenze sono degli interni.' }) : next();

    app.get('/api/presenze/mie', soloInterni, async (req, res) => {
        try {
            res.json(await presenzeDi(req.user.id, annoDa(req)));
        } catch (e) {
            logger.error('Errore GET /api/presenze/mie:', e);
            res.status(500).json({ message: 'Errore nel leggere le presenze.' });
        }
    });

    app.get('/api/users/:id/presenze', soloInterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Persona non valida.' });
        if (id !== req.user.id && !vedeTutti(req)) return res.status(403).json({ message: 'Ti serve il permesso "Organizzare attività e presenze".' });
        try {
            res.json(await presenzeDi(id, annoDa(req)));
        } catch (e) {
            logger.error('Errore GET /api/users/:id/presenze:', e);
            res.status(500).json({ message: 'Errore nel leggere le presenze.' });
        }
    });

    // Il riepilogo dell'anno, persona per persona; con ?formato=csv da aprire nel foglio di calcolo.
    app.get('/api/presenze/riepilogo', soloInterni, async (req, res) => {
        if (!vedeTutti(req)) return res.status(403).json({ message: 'Ti serve il permesso "Organizzare attività e presenze".' });
        const anno = annoDa(req);
        try {
            const r = await pool.query(`
                SELECT u.id, u.nome, u.cognome,
                       COALESCE(SUM(p.minuti) FILTER (WHERE p.origine = 'emergenza'), 0)::int AS minuti_emergenze,
                       COALESCE(SUM(p.minuti) FILTER (WHERE p.origine = 'attivita'), 0)::int AS minuti_attivita,
                       COUNT(*) FILTER (WHERE p.origine = 'emergenza')::int AS emergenze,
                       COUNT(*) FILTER (WHERE p.origine = 'attivita')::int AS attivita
                  FROM partecipazioni p JOIN users u ON u.id = p.user_id
                 WHERE EXTRACT(YEAR FROM p.inizio AT TIME ZONE $2) = $1
                 GROUP BY u.id ORDER BY u.cognome, u.nome`, [anno, fusoOrario()]);
            const righe = r.rows.map(x => ({
                ...x, minuti_totali: x.minuti_emergenze + x.minuti_attivita,
                ore_emergenze: oreDa(x.minuti_emergenze), ore_attivita: oreDa(x.minuti_attivita), ore_totali: oreDa(x.minuti_emergenze + x.minuti_attivita)
            }));
            if (req.query.formato === 'csv') {
                // Un nome che comincia con = + - @ il foglio di calcolo lo eseguirebbe come formula.
                const cella = (v) => {
                    const s = String(v ?? '');
                    return `"${(typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
                };
                const csv = ['Cognome;Nome;Emergenze;Ore in emergenza;Attività;Ore in attività;Ore totali',
                    ...righe.map(x => [x.cognome, x.nome, x.emergenze, (x.minuti_emergenze / 60).toFixed(2).replace('.', ','),
                        x.attivita, (x.minuti_attivita / 60).toFixed(2).replace('.', ','), (x.minuti_totali / 60).toFixed(2).replace('.', ',')].map(cella).join(';'))
                ].join('\r\n');
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="presenze-${anno}.csv"`);
                return res.send('﻿' + csv);
            }
            res.json({ anno, persone: righe });
        } catch (e) {
            logger.error('Errore GET /api/presenze/riepilogo:', e);
            res.status(500).json({ message: 'Errore nel leggere il riepilogo.' });
        }
    });

    // Le presenze di un'emergenza, per correggerle o aggiungere chi manca.
    app.get('/api/emergencies/:id/presenze', soloInterni, correzione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Emergenza non valida.' });
        try {
            const r = await pool.query(`${SELECT_PRESENZE.replace('FROM partecipazioni p', ', u.nome, u.cognome FROM partecipazioni p JOIN users u ON u.id = p.user_id')}
                 WHERE p.emergency_id = $1 ORDER BY u.cognome, u.nome`, [id]);
            res.json(r.rows.map(v => ({ ...v, ore: oreDa(v.minuti) })));
        } catch (e) {
            logger.error('Errore GET /api/emergencies/:id/presenze:', e);
            res.status(500).json({ message: 'Errore nel leggere le presenze.' });
        }
    });

    // Chi in sala non era in nessuna squadra: si aggiunge a un'emergenza chiusa.
    app.post('/api/emergencies/:id/presenze', soloInterni, correzione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const userId = parseInt(req.body?.user_id, 10);
        const inizio = istante(req.body?.inizio), fine = istante(req.body?.fine);
        if (!Number.isInteger(id) || !Number.isInteger(userId)) return res.status(400).json({ message: 'Emergenza o persona non valide.' });
        if (!inizio || !fine || fine < inizio) return res.status(400).json({ message: 'Orari non validi.' });
        try {
            const e = (await pool.query("SELECT code, name, status FROM emergencies WHERE id = $1", [id])).rows[0];
            if (!e) return res.status(404).json({ message: 'Emergenza non trovata.' });
            if (e.status !== 'CLOSED') return res.status(409).json({ message: "Le presenze di un'emergenza si scrivono alla chiusura: finché è aperta conta la squadra (anche la COC)." });
            const interno = await pool.query(
                `SELECT 1 FROM users u WHERE u.id = $1 AND u.eliminato_il IS NULL
                   AND NOT EXISTS (SELECT 1 FROM utenti_ruoli ur WHERE ur.user_id = u.id AND ur.ruolo = 'esterno')`, [userId]);
            if (!interno.rowCount) return res.status(400).json({ message: 'Le presenze sono degli interni.' });
            const r = await pool.query(
                `INSERT INTO partecipazioni (user_id, origine, emergency_id, titolo, tipo, inizio, fine, minuti, nota, registrata_da)
                 VALUES ($1, 'emergenza', $2, $3, 'Emergenza', $4, $5, $6, $7, $8)
                 ON CONFLICT (user_id, emergency_id) WHERE emergency_id IS NOT NULL DO NOTHING RETURNING id`,
                [userId, id, e.name ? `${e.code} - ${e.name}` : e.code, inizio, fine, minutiTra(inizio, fine),
                 typeof req.body?.nota === 'string' ? req.body.nota.trim().slice(0, 300) || null : null, nomeUtente(req.user)]);
            if (!r.rowCount) return res.status(409).json({ message: 'Questa persona ha già la presenza di questa emergenza: correggila.' });
            registraAudit(req, 'presenza.aggiunta', { tipo: 'presenza', id: r.rows[0].id, dettagli: { emergenza: id, user_id: userId } });
            res.status(201).json({ id: r.rows[0].id });
        } catch (e) {
            logger.error('Errore POST /api/emergencies/:id/presenze:', e);
            res.status(500).json({ message: 'Errore nel salvare la presenza.' });
        }
    });

    // Correggere orari o nota di una presenza; resta scritto chi l'ha corretta.
    app.put('/api/presenze/:id', soloInterni, correzione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const inizio = istante(req.body?.inizio), fine = istante(req.body?.fine);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Presenza non valida.' });
        if (!inizio || !fine || fine < inizio) return res.status(400).json({ message: 'Orari non validi.' });
        // I minuti si possono dare a parte: chi è uscito per due ore a metà emergenza.
        const minuti = req.body?.minuti === undefined || req.body?.minuti === null || req.body?.minuti === '' ? minutiTra(inizio, fine) : parseInt(req.body.minuti, 10);
        if (!Number.isInteger(minuti) || minuti < 0 || minuti > minutiTra(inizio, fine)) return res.status(400).json({ message: 'Le ore non possono superare il tempo fra inizio e fine.' });
        try {
            const prima = (await pool.query('SELECT inizio, fine, minuti FROM partecipazioni WHERE id = $1', [id])).rows[0];
            if (!prima) return res.status(404).json({ message: 'Presenza non trovata.' });
            const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim().slice(0, 300) || null : null;
            await pool.query(
                `UPDATE partecipazioni SET inizio = $2, fine = $3, minuti = $4, nota = $5, corretta_il = NOW(), corretta_da = $6 WHERE id = $1`,
                [id, inizio, fine, minuti, nota, nomeUtente(req.user)]);
            registraAudit(req, 'presenza.corretta', { tipo: 'presenza', id, dettagli: { prima, dopo: { inizio, fine, minuti }, nota } });
            const r = await pool.query(`${SELECT_PRESENZE} WHERE p.id = $1`, [id]);
            res.json({ ...r.rows[0], ore: oreDa(r.rows[0].minuti) });
        } catch (e) {
            logger.error('Errore PUT /api/presenze/:id:', e);
            res.status(500).json({ message: 'Errore nel correggere la presenza.' });
        }
    });

    app.delete('/api/presenze/:id', soloInterni, correzione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Presenza non valida.' });
        try {
            const r = await pool.query('DELETE FROM partecipazioni WHERE id = $1 RETURNING user_id, titolo, minuti, corso_utente_id', [id]);
            if (!r.rowCount) return res.status(404).json({ message: 'Presenza non trovata.' });
            if (r.rows[0].corso_utente_id) await pool.query('DELETE FROM user_courses WHERE id = $1', [r.rows[0].corso_utente_id]);
            registraAudit(req, 'presenza.tolta', { tipo: 'presenza', id, dettagli: r.rows[0] });
            res.json({ message: 'Presenza tolta.' });
        } catch (e) {
            logger.error('Errore DELETE /api/presenze/:id:', e);
            res.status(500).json({ message: 'Errore nel togliere la presenza.' });
        }
    });

    // L'attestato: la persona per sé, chi organizza o gestisce l'anagrafica per tutti.
    app.get('/api/presenze/:id/attestato', soloInterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Presenza non valida.' });
        try {
            const p = (await pool.query(`${SELECT_PRESENZE} WHERE p.id = $1`, [id])).rows[0];
            if (!p || (p.user_id !== req.user.id && !vedeTutti(req))) return res.status(404).json({ message: 'Presenza non trovata.' });
            const persona = (await pool.query('SELECT username, nome, cognome, codice_fiscale FROM users WHERE id = $1', [p.user_id])).rows[0];
            const pdf = await attestatoPdf(p, persona);
            const nome = `attestato-${(persona.cognome || persona.username || 'presenza').replace(/[^\p{L}\p{N}-]/gu, '')}-${String(p.inizio).slice(0, 10)}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
            res.setHeader('Cache-Control', 'private, no-store');
            res.send(pdf);
        } catch (e) {
            logger.error('Errore GET /api/presenze/:id/attestato:', e);
            res.status(500).json({ message: "Errore nel preparare l'attestato." });
        }
    });
}
