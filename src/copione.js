// src/copione.js
//
// Il copione della simulazione e la regia.
//
// Prima: la regia (il responsabile dell'attività, i registi scelti e chi
// organizza le attività) scrive gli eventi di scenario sulla pagina del
// copione, con la mappa sotto, oppure li carica da un foglio Excel compilato
// sul modello. Ogni evento esce a un minuto dall'avvio o a mano:
//   - segnalazione: entra da sola nel centro operativo, oppure la regia
//     riceve il promemoria di telefonarla alla sala (che la inserisce lei);
//   - aggravamento: una nota, e se serve la priorità, su una segnalazione già
//     uscita;
//   - comunicazione: un messaggio che arriva alla sala (nel diario di sala);
//   - imprevisto: un avviso sul telefono dei membri di una squadra;
//   - strada: una strada chiusa o una zona interdetta sulla mappa.
//
// Durante: con la sala aperta, la regia avvia l'orologio, mette in pausa, fa
// uscire, rimanda o salta gli eventi, ne improvvisa di nuovi, collega alla
// segnalazione inserita dalla sala quella telefonata, scrive osservazioni. Gli
// eventi a tempo escono da soli (un controllo ogni 15 secondi).
//
// Dopo: per ogni segnalazione i tempi (assegnata dopo, chiusa dopo) contro
// quelli attesi; il debriefing scritto dai registi; la regia decide se copione
// e debriefing li vedono anche i partecipanti.

import ExcelJS from 'exceljs';
import multer from 'multer';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { nomeUtente, ruoliDi } from './autenticazione.js';
import { pool } from './db.js';
import { leggiGeometria } from './mappaElementi.js';
import { haPermesso } from './permessi.js';
import { aggiornaRischi } from './rischiZone.js';
import { activeEmergency } from './statoEmergenza.js';
import { avvisaClienti, notifiche, wss } from './tempoReale.js';

const TIPI = ['segnalazione', 'aggravamento', 'comunicazione', 'imprevisto', 'strada', 'pericolo'];
const NOMI_TIPI = {
    segnalazione: 'Segnalazione', aggravamento: 'Aggravamento', comunicazione: 'Comunicazione alla sala',
    imprevisto: 'Imprevisto a una squadra', strada: 'Strada chiusa o zona', pericolo: 'Zona di pericolo'
};
// Le forme che un evento disegna sulla mappa, per tipo; la prima è quella di partenza.
const ELEMENTI_DI = {
    strada: ['strada_chiusa', 'zona_interdetta'],
    pericolo: ['pericolo_generico', 'pericolo_alluvione', 'pericolo_frana']
};
// Nel foglio Excel la zona di pericolo dice anche di che pericolo è.
const PERICOLI_EXCEL = {
    pericolo_alluvione: 'Zona di pericolo (alluvione)', pericolo_frana: 'Zona di pericolo (frana)', pericolo_generico: 'Zona di pericolo (altro)'
};
const nomeExcel = (e) => e.tipo === 'pericolo' ? PERICOLI_EXCEL[e.elemento_tipo] || PERICOLI_EXCEL.pericolo_generico : NOMI_TIPI[e.tipo];
const NOMI_EXCEL = [...Object.values(NOMI_TIPI).filter(n => n !== NOMI_TIPI.pericolo), ...Object.values(PERICOLI_EXCEL)];
const PRIORITA = { alta: 'High', media: 'Medium', bassa: 'Low' };
const NOMI_PRIORITA = { High: 'Alta', Medium: 'Media', Low: 'Bassa' };
const LIMITE = { titolo: 200, testo: 2000, breve: 200, nota: 2000 };
const MAX_EVENTI = 500;
const INTERVALLO_CONTROLLO_MS = 15000;

const caricaFoglio = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /\.xlsx$/i.test(file.originalname || ''))
});

const esterno = (req) => ruoliDi(req.user).includes('esterno');

function testo(valore, massimo) {
    if (valore === undefined || valore === null) return null;
    const t = String(valore).trim();
    return t ? t.slice(0, massimo) : null;
}

function intero(valore) {
    if (valore === undefined || valore === null || valore === '') return null;
    const n = Number(valore);
    return Number.isInteger(n) ? n : NaN;
}

function numero(valore) {
    if (valore === undefined || valore === null || valore === '') return null;
    const n = Number(String(valore).replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
}

// Chi fa la regia di un'attività: chi organizza le attività, il responsabile, i registi.
async function regia(req, attivitaId) {
    if (esterno(req)) return null;
    const r = await pool.query(
        `SELECT a.id, a.titolo, a.stato, a.simulazione, a.scenario, a.obiettivi, a.responsabile_id, a.copione_pubblicato,
                t.nome AS tipo,
                EXISTS (SELECT 1 FROM attivita_regia g WHERE g.attivita_id = a.id AND g.user_id = $2) AS regista,
                -- Chi può leggere copione e debriefing pubblicati: chi vede l'attività o c'era.
                (a.convocazione IN ('tutti', 'aperta')
                    OR EXISTS (SELECT 1 FROM attivita_persone p WHERE p.attivita_id = a.id AND p.user_id = $2 AND p.convocato)
                    OR EXISTS (SELECT 1 FROM partecipazioni x WHERE x.attivita_id = a.id AND x.user_id = $2)) AS partecipa
           FROM attivita a LEFT JOIN attivita_tipi t ON t.id = a.tipo_id WHERE a.id = $1`, [attivitaId, req.user.id]);
    const a = r.rows[0];
    if (!a) return null;
    a.conduce = haPermesso(req, 'gruppo.attivita') || a.responsabile_id === req.user.id || a.regista;
    return a;
}

// Le persone della regia, per i promemoria: il responsabile e i registi.
async function personeRegia(attivitaId) {
    const r = await pool.query(
        `SELECT responsabile_id AS id FROM attivita WHERE id = $1 AND responsabile_id IS NOT NULL
         UNION SELECT user_id FROM attivita_regia WHERE attivita_id = $1`, [attivitaId]);
    return r.rows.map(x => x.id);
}

// --- Gli eventi ------------------------------------------------------------------------

// I campi di un evento, controllati. [rifValidi]: gli id delle segnalazioni del copione.
function leggiEvento(corpo, rifValidi = null) {
    const tipo = corpo?.tipo;
    if (!TIPI.includes(tipo)) return { errore: 'Tipo di evento non valido.' };
    const e = {
        tipo,
        minuto: intero(corpo.minuto),
        titolo: testo(corpo.titolo, LIMITE.titolo),
        testo: testo(corpo.testo, LIMITE.testo),
        modo: corpo.modo === 'telefono' ? 'telefono' : 'da_sola',
        indirizzo: testo(corpo.indirizzo, LIMITE.breve),
        lat: numero(corpo.lat),
        lng: numero(corpo.lng),
        priorita: ['High', 'Medium', 'Low'].includes(corpo.priorita) ? corpo.priorita : null,
        segnalante: testo(corpo.segnalante, 120),
        telefono: testo(corpo.telefono, 40),
        riferimento_id: intero(corpo.riferimento_id),
        squadra: testo(corpo.squadra, 30),
        elemento_tipo: (ELEMENTI_DI[tipo] || []).includes(corpo.elemento_tipo) ? corpo.elemento_tipo : null,
        geometria: null,
        risposta_attesa: testo(corpo.risposta_attesa, LIMITE.testo),
        minuti_attesi: intero(corpo.minuti_attesi)
    };
    if (!e.titolo) return { errore: 'Ogni evento ha bisogno di un titolo.' };
    if (Number.isNaN(e.minuto) || (e.minuto !== null && (e.minuto < 0 || e.minuto > 10080))) return { errore: 'Il minuto va da 0 a 10080 (una settimana), o vuoto per "a mano".' };
    if (Number.isNaN(e.minuti_attesi) || (e.minuti_attesi !== null && (e.minuti_attesi < 1 || e.minuti_attesi > 1440))) return { errore: 'I minuti attesi vanno da 1 a 1440.' };
    if (Number.isNaN(e.lat) || Number.isNaN(e.lng) || (e.lat === null) !== (e.lng === null)
        || (e.lat !== null && (Math.abs(e.lat) > 90 || Math.abs(e.lng) > 180))) return { errore: 'Coordinate non valide.' };
    if (Number.isNaN(e.riferimento_id)) return { errore: 'Riferimento non valido.' };
    if (tipo === 'aggravamento') {
        if (!e.riferimento_id) return { errore: "L'aggravamento dice a quale segnalazione del copione si riferisce." };
        if (rifValidi && !rifValidi.has(e.riferimento_id)) return { errore: "L'aggravamento si riferisce a una segnalazione che non è nel copione." };
    } else {
        e.riferimento_id = null;
    }
    if (tipo === 'imprevisto' && !e.squadra) return { errore: "Per l'imprevisto scrivi il nome radio della squadra che lo riceve (per esempio Alfa)." };
    if (ELEMENTI_DI[tipo]) {
        e.elemento_tipo = e.elemento_tipo || ELEMENTI_DI[tipo][0];
        if (corpo.geometria) {
            const { geometria, errore } = leggiGeometria(corpo.geometria, e.elemento_tipo);
            if (errore) return { errore };
            e.geometria = geometria;
        }
    }
    if (tipo !== 'segnalazione') e.modo = 'da_sola';
    return { evento: e };
}

const COLONNE_EVENTO = ['minuto', 'tipo', 'titolo', 'testo', 'modo', 'indirizzo', 'lat', 'lng', 'priorita', 'segnalante', 'telefono',
    'riferimento_id', 'squadra', 'elemento_tipo', 'geometria', 'risposta_attesa', 'minuti_attesi'];

async function inserisciEvento(client, attivitaId, e, ordine) {
    const valori = COLONNE_EVENTO.map(k => k === 'geometria' ? (e.geometria ? JSON.stringify(e.geometria) : null) : e[k]);
    const r = await client.query(
        `INSERT INTO copione_eventi (attivita_id, ordine, ${COLONNE_EVENTO.join(', ')})
         VALUES ($1, $2, ${COLONNE_EVENTO.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING *`,
        [attivitaId, ordine, ...valori]);
    return r.rows[0];
}

async function eventiDi(attivitaId, esecutore = pool) {
    const r = await esecutore.query(
        `SELECT * FROM copione_eventi WHERE attivita_id = $1 ORDER BY minuto NULLS LAST, ordine, id`, [attivitaId]);
    return r.rows;
}

// --- Le misure ----------------------------------------------------------------------------

const minutiTra = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null);

// Per ogni evento uscito di una sala: quando è uscito e, per le segnalazioni,
// dopo quanto è stata assegnata una squadra, è arrivata la prima notizia, è
// stata chiusa; e se rispetta il tempo atteso.
async function esitiDi(emergencyId, eventi) {
    const esiti = (await pool.query(`
        SELECT x.*, r.emergency_report_number AS numero, r.status,
               (SELECT MIN(a.assigned_at) FROM report_team_assignments a WHERE a.report_id = x.report_id) AS assegnata_il,
               (SELECT MIN(u.update_timestamp) FROM report_updates u WHERE u.report_id = x.report_id AND NOT u.is_system
                   AND u.update_timestamp > x.uscito_il) AS prima_notizia_il,
               (SELECT MIN(u.update_timestamp) FROM report_updates u WHERE u.report_id = x.report_id AND u.is_system
                   AND u.update_text LIKE '%a ''Chiusa''%') AS chiusa_il
          FROM copione_esiti x LEFT JOIN reports r ON r.id = x.report_id
         WHERE x.emergency_id = $1`, [emergencyId])).rows;
    const perEvento = new Map(esiti.map(x => [x.evento_id, x]));
    return eventi.map(e => {
        const x = perEvento.get(e.id);
        const stato = x?.stato || 'atteso';
        const misure = x?.report_id ? {
            assegnata_dopo: minutiTra(x.uscito_il, x.assegnata_il),
            prima_notizia_dopo: minutiTra(x.uscito_il, x.prima_notizia_il),
            chiusa_dopo: minutiTra(x.uscito_il, x.chiusa_il)
        } : null;
        let valutazione = null;
        if (e.minuti_attesi && stato === 'uscito' && e.tipo === 'segnalazione') {
            const fatto = misure?.assegnata_dopo;
            valutazione = fatto === null || fatto === undefined ? 'non_fatto' : fatto <= e.minuti_attesi ? 'in_tempo' : 'in_ritardo';
        }
        return {
            ...e,
            stato,
            rimando_minuti: x?.rimando_minuti || 0,
            previsto: e.minuto === null ? null : e.minuto + (x?.rimando_minuti || 0),
            uscito_il: x?.uscito_il || null,
            uscito_da: x?.uscito_da || null,
            automatico: x?.automatico || false,
            report: x?.report_id ? { id: x.report_id, numero: x.numero, stato: x.status } : null,
            elemento_id: x?.elemento_id || null,
            nota_esito: x?.nota || null,
            misure,
            valutazione
        };
    });
}

// --- L'orologio --------------------------------------------------------------------------------

async function orologio(emergencyId, esecutore = pool) {
    return (await esecutore.query('SELECT * FROM regia_orologio WHERE emergency_id = $1', [emergencyId])).rows[0] || null;
}

// I minuti di scenario trascorsi: dall'avvio, tolte le pause.
function trascorsi(o, adesso = Date.now()) {
    if (!o) return null;
    const avvio = new Date(o.avviata_il).getTime();
    const pausaInCorso = o.pausa_dal ? adesso - new Date(o.pausa_dal).getTime() : 0;
    return Math.max(0, (adesso - avvio - o.pausa_secondi * 1000 - pausaInCorso) / 60000);
}

// --- L'uscita di un evento -------------------------------------------------------------------

// Fa uscire un evento nella sala aperta. [chi]: { id, nome } di chi lo fa
// uscire (per gli automatici: chi ha avviato l'orologio).
async function esci(emergenza, evento, chi, { automatico = false } = {}) {
    const client = await pool.connect();
    let creata = null, elemento = null, nota = null, promemoria = false, notaSala = null, avvisoSquadra = null;
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO copione_esiti (emergency_id, evento_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [emergenza.id, evento.id]);
        const esito = (await client.query(
            'SELECT * FROM copione_esiti WHERE emergency_id = $1 AND evento_id = $2 FOR UPDATE', [emergenza.id, evento.id])).rows[0];
        if (esito.stato) { await client.query('ROLLBACK'); return { gia: true }; }

        switch (evento.tipo) {
            case 'segnalazione':
                if (evento.modo === 'telefono') {
                    promemoria = true;
                    nota = 'Da telefonare alla sala: la segnalazione la inserisce chi risponde.';
                } else {
                    const n = (await client.query(
                        'SELECT COALESCE(MAX(emergency_report_number), 0) + 1 AS n FROM reports WHERE emergency_id = $1', [emergenza.id])).rows[0].n;
                    creata = (await client.query(
                        `INSERT INTO reports (title, description, location_address, priority, creator_user_id, reporter_name, reporter_contact,
                                              status, emergency_id, emergency_report_number, latitude, longitude, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, 'New', $8, $9, $10, $11, NOW(), NOW()) RETURNING id, emergency_report_number`,
                        [evento.titolo, evento.testo, evento.indirizzo, evento.priorita || 'Medium', chi.id, evento.segnalante, evento.telefono,
                         emergenza.id, n, evento.lat, evento.lng])).rows[0];
                }
                break;
            case 'aggravamento': {
                const rif = (await client.query(
                    'SELECT report_id FROM copione_esiti WHERE emergency_id = $1 AND evento_id = $2', [emergenza.id, evento.riferimento_id])).rows[0];
                if (!rif?.report_id) {
                    if (!automatico) {
                        await client.query('ROLLBACK');
                        return { errore: "La segnalazione a cui si riferisce non è ancora uscita (o, se telefonata, non è stata collegata)." };
                    }
                    nota = 'Non applicato: la segnalazione di riferimento non era nella sala.';
                    break;
                }
                await client.query(
                    `INSERT INTO report_updates (report_id, update_text, user_id, update_timestamp, is_system) VALUES ($1, $2, $3, NOW(), false)`,
                    [rif.report_id, `${evento.titolo}${evento.testo ? `: ${evento.testo}` : ''}`, chi.id]);
                if (evento.priorita) await client.query('UPDATE reports SET priority = $2, updated_at = NOW() WHERE id = $1', [rif.report_id, evento.priorita]);
                else await client.query('UPDATE reports SET updated_at = NOW() WHERE id = $1', [rif.report_id]);
                creata = { id: rif.report_id, aggravata: true };
                break;
            }
            case 'comunicazione':
                notaSala = (await client.query(
                    `INSERT INTO diario_sala (emergency_id, testo, autore_id, autore_nome) VALUES ($1, $2, $3, 'Messaggio in arrivo')
                     RETURNING id, testo, autore_nome, creata_il`,
                    [emergenza.id, `${evento.titolo}${evento.testo ? `: ${evento.testo}` : ''}`, chi.id])).rows[0];
                break;
            case 'imprevisto': {
                const membri = (await client.query(
                    `SELECT u.id FROM squadre s JOIN squadra_membri sm ON sm.squadra_id = s.id JOIN users u ON u.username = sm.username
                      WHERE LOWER(s.nome_radio) = LOWER($1)`, [evento.squadra])).rows.map(r => r.id);
                if (!membri.length) nota = `La squadra ${evento.squadra} non c'era o era vuota: avviso non mandato.`;
                avvisoSquadra = membri;
                break;
            }
            case 'strada':
            case 'pericolo':
                if (!evento.geometria) {
                    nota = 'Non disegnata sul copione: niente sulla mappa.';
                    break;
                }
                elemento = (await client.query(
                    `INSERT INTO elementi_mappa (emergency_id, tipo, nome, note, geometria, creato_da) VALUES ($1, $2, $3, $4, $5, 'Regia')
                     RETURNING id`, [emergenza.id, evento.elemento_tipo || ELEMENTI_DI[evento.tipo][0], evento.titolo, evento.testo, JSON.stringify(evento.geometria)])).rows[0];
                break;
        }
        await client.query(
            `UPDATE copione_esiti SET stato = 'uscito', uscito_il = NOW(), uscito_da = $3, automatico = $4,
                    report_id = $5, elemento_id = $6, nota = $7
              WHERE emergency_id = $1 AND evento_id = $2`,
            [emergenza.id, evento.id, chi.nome, automatico, creata?.id ?? null, elemento?.id ?? null, nota]);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }

    // Dopo il COMMIT: chi deve sapere lo sa.
    if (creata && !creata.aggravata) {
        wss.clients.forEach(c => { if (c.readyState === 1) { try { c.send(JSON.stringify({ action: 'reload_reports', createdReportId: creata.id })); } catch { /* si riconnette */ } } });
        if (evento.lat !== null) aggiornaRischi({ emergencyId: emergenza.id, reportIds: [creata.id], userId: chi.id });
    } else if (creata?.aggravata) {
        avvisaClienti('reload_reports', { updatedReportId: creata.id });
    }
    if (notaSala) avvisaClienti('nota_sala', { emergency_id: emergenza.id, voce: notaSala });
    if (elemento) avvisaClienti('reload_mappa');
    // Una zona di pericolo nuova: le segnalazioni che ci cadono dentro prendono il rischio.
    if (elemento && evento.tipo === 'pericolo') aggiornaRischi({ emergencyId: emergenza.id, userId: chi.id });
    // Una comunicazione alla sala non resta solo nel diario: compare in grande a chi è in sala.
    if (evento.tipo === 'comunicazione') {
        avvisaClienti('comunicazione_sala', {
            emergency_id: emergenza.id, evento_id: evento.id, titolo: evento.titolo, testo: evento.testo || '', ora: new Date().toISOString()
        });
    }
    if (avvisoSquadra?.length) {
        for (const id of avvisoSquadra) {
            await notifiche.notifica(id, {
                tipo: 'imprevisto', categoria: 'emergenza', titolo: evento.titolo, testo: evento.testo,
                chiave: `imprevisto:${emergenza.id}:${evento.id}:${id}`, oreValidita: 12
            });
        }
    }
    if (promemoria) {
        for (const id of await personeRegia(emergenza.attivita_id)) {
            await notifiche.notifica(id, {
                tipo: 'regia_telefona', categoria: 'emergenza', titolo: `Telefona alla sala: ${evento.titolo}`,
                testo: [evento.testo, evento.indirizzo && `Dove: ${evento.indirizzo}`, evento.segnalante && `Chi chiama: ${evento.segnalante}${evento.telefono ? ` (${evento.telefono})` : ''}`].filter(Boolean).join('\n'),
                chiave: `regia_telefona:${emergenza.id}:${evento.id}:${id}`, oreValidita: 12
            });
        }
    }
    regiaCambiata();
    return { creata, elemento, nota };
}

// Ogni cambio della regia: le pagine si aggiornano e la prossima uscita si
// ripianifica al millisecondo, così un evento esce quando il conto alla
// rovescia arriva a zero e non al giro di controllo dopo.
function regiaCambiata() {
    avvisaClienti('regia_aggiorna');
    pianifica().catch(e => logger.error('[Regia] Pianificazione della prossima uscita non riuscita:', e));
}

let prossimaUscita = null;
async function pianifica() {
    clearTimeout(prossimaUscita);
    prossimaUscita = null;
    const emergenza = activeEmergency;
    if (!emergenza?.simulazione || !emergenza.attivita_id) return;
    const o = await orologio(emergenza.id);
    if (!o || o.pausa_dal) return;
    const m = (await pool.query(`
        SELECT MIN(e.minuto + COALESCE(x.rimando_minuti, 0)) AS m FROM copione_eventi e
          LEFT JOIN copione_esiti x ON x.evento_id = e.id AND x.emergency_id = $1
         WHERE e.attivita_id = $2 AND e.minuto IS NOT NULL AND x.stato IS NULL`, [emergenza.id, emergenza.attivita_id])).rows[0]?.m;
    if (m === null || m === undefined) return;
    const attesa = Math.max(0, (Number(m) - trascorsi(o)) * 60000);
    // Il massimo di setTimeout è poco meno di 25 giorni: oltre, ci pensa il controllo periodico.
    if (attesa > 2 ** 31 - 1000) return;
    prossimaUscita = setTimeout(controllaUscite, attesa + 20);
    prossimaUscita.unref?.();
}

// Un controllo alla volta: se ne arriva un altro mentre uno gira, si ripete alla fine.
let inControllo = false, daRipetere = false;
async function controllaUscite() {
    if (inControllo) { daRipetere = true; return; }
    inControllo = true;
    try {
        await uscite();
    } finally {
        inControllo = false;
        if (daRipetere) { daRipetere = false; controllaUscite(); }
        else pianifica().catch(e => logger.error('[Regia] Pianificazione della prossima uscita non riuscita:', e));
    }
}

// Il controllo: gli eventi a tempo il cui momento è arrivato.
async function uscite() {
    const emergenza = activeEmergency;
    if (!emergenza?.simulazione || !emergenza.attivita_id) return;
    try {
        const o = await orologio(emergenza.id);
        if (!o || o.pausa_dal) return;
        const minuti = trascorsi(o);
        const dovuti = (await pool.query(`
            SELECT e.* FROM copione_eventi e
              LEFT JOIN copione_esiti x ON x.evento_id = e.id AND x.emergency_id = $1
             WHERE e.attivita_id = $2 AND e.minuto IS NOT NULL AND x.stato IS NULL
               AND e.minuto + COALESCE(x.rimando_minuti, 0) <= $3::float8
             ORDER BY e.minuto, e.ordine, e.id`, [emergenza.id, emergenza.attivita_id, minuti])).rows;
        if (!dovuti.length) return;
        const avvio = (await pool.query('SELECT id, nome, cognome, username FROM users WHERE id = $1', [o.avviata_da])).rows[0];
        const chi = { id: avvio?.id, nome: `${nomeUtente(avvio) || 'Regia'} (a tempo)` };
        if (!chi.id) return;
        for (const e of dovuti) {
            const r = await esci(emergenza, e, chi, { automatico: true });
            if (!r.gia) logger.info(`[Regia] ${emergenza.code}: uscito a tempo l'evento "${e.titolo}" (minuto ${e.minuto}).`);
        }
    } catch (e) {
        logger.error('[Regia] Controllo degli eventi a tempo non riuscito:', e);
    }
}

// --- Excel --------------------------------------------------------------------------------------

const INTESTAZIONI = [
    ['Minuto', 12], ['Tipo', 26], ['Titolo', 40], ['Testo', 50], ['Come arriva', 14], ['Indirizzo', 30],
    ['Latitudine', 12], ['Longitudine', 12], ['Priorità', 10], ['Chi chiama', 20], ['Telefono di chi chiama', 18],
    ['Riferito alla riga', 12], ['Squadra', 12], ['Risposta attesa', 45], ['Minuti attesi', 12]
];

const ESEMPI = [
    [0, 'Comunicazione alla sala', 'ESEMPIO: bollettino di allerta rossa', 'La Regione dirama allerta rossa per rischio idraulico dalle 14.', '', '', '', '', '', '', '', '', '', 'La sala avvisa le squadre e prepara le idrovore.', 15],
    [10, 'Segnalazione', 'ESEMPIO: cantina allagata', "Acqua alta 40 cm nella cantina, c'è una caldaia.", 'Da sola', 'Via Roma 12', 46.1427, 12.2167, 'Media', 'Mario Rossi', '333 1234567', '', '', 'Assegnare una squadra con pompa.', 10],
    [25, 'Aggravamento', "ESEMPIO: l'acqua sale", "L'acqua è arrivata alla caldaia, il proprietario ha staccato la corrente.", '', '', '', '', 'Alta', '', '', 3, '', 'Alzare la priorità e mandare rinforzi.', 10],
    [40, 'Segnalazione', 'ESEMPIO: anziana isolata', 'Una signora di 85 anni non riesce a uscire di casa.', 'Per telefono', 'Località Ponte', '', '', 'Alta', 'La vicina', '', '', '', 'Raccogliere i dati, mandare una squadra, avvisare il 118.', 15],
    ['', 'Imprevisto a una squadra', 'ESEMPIO: mezzo in avaria', 'Il furgone non riparte: siete fermi.', '', '', '', '', '', '', '', '', 'Alfa', 'Il caposquadra avvisa la sala, la sala manda un altro mezzo.', 20]
];

async function modelloExcel(eventi = null) {
    const libro = new ExcelJS.Workbook();
    libro.creator = 'ORION';
    const foglio = libro.addWorksheet('Copione', { views: [{ state: 'frozen', ySplit: 1 }] });
    foglio.columns = INTESTAZIONI.map(([header, width]) => ({ header, width }));
    const testa = foglio.getRow(1);
    testa.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    testa.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } };
    testa.alignment = { vertical: 'middle', wrapText: true };
    testa.height = 30;
    if (eventi) {
        const riga = new Map(eventi.map((e, i) => [e.id, i + 2]));
        for (const e of eventi) {
            foglio.addRow([e.minuto ?? '', nomeExcel(e), e.titolo, e.testo || '', e.tipo === 'segnalazione' ? (e.modo === 'telefono' ? 'Per telefono' : 'Da sola') : '',
                e.indirizzo || '', e.lat ?? '', e.lng ?? '', e.priorita ? NOMI_PRIORITA[e.priorita] : '', e.segnalante || '', e.telefono || '',
                e.riferimento_id ? riga.get(e.riferimento_id) || '' : '', e.squadra || '', e.risposta_attesa || '', e.minuti_attesi ?? '']);
        }
    } else {
        for (const r of ESEMPI) {
            const riga = foglio.addRow(r);
            riga.font = { italic: true, color: { argb: 'FF6B7280' } };
        }
    }
    const elenco = (lista) => ({ type: 'list', allowBlank: true, formulae: [`"${lista.join(',')}"`] });
    for (let r = 2; r <= MAX_EVENTI + 1; r++) {
        foglio.getCell(`B${r}`).dataValidation = elenco(NOMI_EXCEL);
        foglio.getCell(`E${r}`).dataValidation = elenco(['Da sola', 'Per telefono']);
        foglio.getCell(`I${r}`).dataValidation = elenco(['Alta', 'Media', 'Bassa']);
    }
    foglio.eachRow(r => { r.alignment = { ...(r.alignment || {}), vertical: 'top', wrapText: true }; });

    const istr = libro.addWorksheet('Istruzioni');
    istr.getColumn(1).width = 110;
    const righe = [
        ['Come compilare il copione', true],
        ["Ogni riga del foglio Copione è un evento dello scenario. Le righe che cominciano con ESEMPIO sono solo d'esempio: ORION le salta, puoi cancellarle o lasciarle."],
        ["Minuto: dopo quanti minuti dall'avvio dello scenario l'evento esce da solo (0 = subito). Vuoto: esce solo quando la regia preme il pulsante. Si può scrivere anche 1:30 per un'ora e mezza."],
        ['Tipo: scegli dalla tendina. Segnalazione (arriva una richiesta di intervento), Aggravamento (una segnalazione già uscita peggiora), Comunicazione alla sala (un messaggio, per esempio dalla Prefettura), Imprevisto a una squadra (arriva sul telefono dei suoi membri), Strada chiusa o zona (si disegna poi sulla mappa del copione).'],
        ['Titolo: quello che compare nel centro operativo. Testo: i dettagli, o quello che chi telefona legge alla sala.'],
        ["Come arriva (solo per le segnalazioni): Da sola entra direttamente nel centro operativo; Per telefono la regia riceve un promemoria e telefona alla sala, che la deve inserire da sé."],
        ["Indirizzo, Latitudine e Longitudine: dove succede. Se mancano le coordinate, nella pagina del copione l'evento compare fra quelli da mettere sulla mappa: basta un clic sul punto."],
        ["Priorità: Alta, Media o Bassa. Per un aggravamento è la nuova priorità della segnalazione (vuota: resta com'era)."],
        ["Riferito alla riga (solo per gli aggravamenti): il numero della riga di questo foglio con la segnalazione che peggiora (per esempio 3)."],
        ['Squadra (solo per gli imprevisti): il nome radio della squadra, per esempio Alfa.'],
        ["Risposta attesa e Minuti attesi: cosa ci si aspetta dalla sala e in quanto tempo. Li vede solo la regia, servono alla valutazione finale (per le segnalazioni conta il tempo fino all'assegnazione di una squadra)."],
        ['Quando hai finito, nella pagina del copione scegli "Carica da Excel". Se qualche riga ha un errore ORION non carica niente e ti dice quali righe correggere.']
    ];
    for (const [t, grassetto] of righe) {
        const r = istr.addRow([t]);
        r.alignment = { wrapText: true, vertical: 'top' };
        if (grassetto) r.font = { bold: true, size: 14 };
    }
    return libro.xlsx.writeBuffer();
}

function valoreCella(cella) {
    const v = cella?.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
        if (v.richText) return v.richText.map(p => p.text).join('');
        if (v.text !== undefined) return String(v.text);
        if (v.result !== undefined) return String(v.result);
        if (v instanceof Date) return `${v.getUTCHours()}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
        return '';
    }
    return String(v);
}

// "90", "1:30", "1.30" -> minuti.
function minutoDa(testoCella) {
    const t = testoCella.trim().toLowerCase();
    if (!t || t === 'a mano') return null;
    const ore = /^(\d{1,3})[:.](\d{2})$/.exec(t);
    if (ore) return Number(ore[1]) * 60 + Number(ore[2]);
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n) : NaN;
}

// Le righe del foglio Copione, già tradotte in eventi; tutti o nessuno.
async function leggiExcel(buffer) {
    const libro = new ExcelJS.Workbook();
    try {
        await libro.xlsx.load(buffer);
    } catch {
        return { errori: [{ riga: null, messaggio: 'Il file non è un foglio Excel (.xlsx) leggibile.' }] };
    }
    const foglio = libro.getWorksheet('Copione') || libro.worksheets[0];
    if (!foglio) return { errori: [{ riga: null, messaggio: 'Nel file non c\'è nessun foglio.' }] };
    const intestazione = INTESTAZIONI.map((_, i) => valoreCella(foglio.getRow(1).getCell(i + 1)).trim().toLowerCase());
    if (intestazione[1] !== 'tipo' || intestazione[2] !== 'titolo') {
        return { errori: [{ riga: 1, messaggio: 'La prima riga non è quella del modello (Minuto, Tipo, Titolo...): parti dal modello scaricato da ORION.' }] };
    }
    const tipoDa = Object.fromEntries(Object.entries(NOMI_TIPI).map(([k, v]) => [v.toLowerCase(), k]));
    Object.assign(tipoDa, { segnalazione: 'segnalazione', aggravamento: 'aggravamento', comunicazione: 'comunicazione', imprevisto: 'imprevisto', strada: 'strada', 'strada chiusa': 'strada' });
    const pericoloDa = Object.fromEntries(Object.entries(PERICOLI_EXCEL).map(([k, v]) => [v.toLowerCase(), k]));
    Object.assign(pericoloDa, { 'zona di pericolo': 'pericolo_generico', pericolo: 'pericolo_generico' });
    const righe = [];
    const errori = [];
    foglio.eachRow({ includeEmpty: false }, (riga, n) => {
        if (n === 1) return;
        const c = INTESTAZIONI.map((_, i) => valoreCella(riga.getCell(i + 1)).trim());
        if (c.every(x => !x)) return;
        if (/^esempio/i.test(c[2])) return;
        const elementoPericolo = pericoloDa[c[1].toLowerCase()];
        const tipo = elementoPericolo ? 'pericolo' : tipoDa[c[1].toLowerCase()];
        if (!tipo) { errori.push({ riga: n, messaggio: `Tipo "${c[1]}" non riconosciuto: scegli dalla tendina.` }); return; }
        const minuto = minutoDa(c[0]);
        if (Number.isNaN(minuto)) { errori.push({ riga: n, messaggio: `Minuto "${c[0]}" non valido: un numero, o 1:30, o vuoto.` }); return; }
        const prio = c[8] ? PRIORITA[c[8].toLowerCase()] : null;
        if (c[8] && !prio) { errori.push({ riga: n, messaggio: `Priorità "${c[8]}" non valida: Alta, Media o Bassa.` }); return; }
        const rif = c[11] ? Number(c[11]) : null;
        if (c[11] && !Number.isInteger(rif)) { errori.push({ riga: n, messaggio: 'Riferito alla riga: scrivi il numero della riga.' }); return; }
        righe.push({
            n, rif,
            corpo: {
                tipo, elemento_tipo: elementoPericolo, minuto, titolo: c[2], testo: c[3], modo: /telefono/i.test(c[4]) ? 'telefono' : 'da_sola', indirizzo: c[5],
                lat: c[6], lng: c[7], priorita: prio, segnalante: c[9], telefono: c[10], squadra: c[12],
                risposta_attesa: c[13], minuti_attesi: c[14] ? Math.round(Number(c[14].replace(',', '.'))) : null,
                riferimento_id: rif ? -1 : null
            }
        });
    });
    // I riferimenti puntano a righe del foglio: devono essere segnalazioni.
    const perRiga = new Map(righe.map(r => [r.n, r]));
    for (const r of righe) {
        const { errore } = leggiEvento(r.corpo);
        if (errore) { errori.push({ riga: r.n, messaggio: errore }); continue; }
        if (r.corpo.tipo === 'aggravamento' && perRiga.get(r.rif)?.corpo.tipo !== 'segnalazione') {
            errori.push({ riga: r.n, messaggio: `La riga ${r.rif} non è una segnalazione di questo foglio.` });
        }
    }
    if (righe.length > MAX_EVENTI) errori.push({ riga: null, messaggio: `Al massimo ${MAX_EVENTI} eventi.` });
    if (!righe.length && !errori.length) errori.push({ riga: null, messaggio: 'Nessun evento nel foglio (le righe ESEMPIO non contano).' });
    return { righe, errori };
}

// Il copione di un'attività in coda a quello di un'altra, con gli aggravamenti
// legati alle segnalazioni copiate. Dentro la transazione di chi chiama.
export async function copiaCopione(client, daId, attivitaId) {
    const eventi = await eventiDi(daId);
    let ordine = (await client.query('SELECT COALESCE(MAX(ordine), 0) AS m FROM copione_eventi WHERE attivita_id = $1', [attivitaId])).rows[0].m;
    const nuovi = new Map();
    for (const e of [...eventi].sort((x, y) => (x.tipo === 'aggravamento') - (y.tipo === 'aggravamento'))) {
        const copia = { ...e, riferimento_id: e.riferimento_id ? nuovi.get(e.riferimento_id) ?? null : null };
        if (copia.tipo === 'aggravamento' && !copia.riferimento_id) continue;
        const creato = await inserisciEvento(client, attivitaId, copia, ++ordine);
        nuovi.set(e.id, creato.id);
    }
    return nuovi.size;
}

// I copioni da cui partire per una simulazione aperta al volo: quelli delle
// attività di cui la persona fa la regia (tutti, per chi organizza le attività).
export async function copioniDisponibili(req) {
    const r = await pool.query(`
        SELECT a.id, a.titolo, a.inizio, t.nome AS tipo, COUNT(e.id)::int AS eventi
          FROM attivita a
          JOIN copione_eventi e ON e.attivita_id = a.id
          LEFT JOIN attivita_tipi t ON t.id = a.tipo_id
         WHERE $2::boolean OR a.responsabile_id = $1 OR a.creato_da = $1
            OR EXISTS (SELECT 1 FROM attivita_regia g WHERE g.attivita_id = a.id AND g.user_id = $1)
         GROUP BY a.id, t.nome ORDER BY a.inizio DESC LIMIT 50`, [req.user.id, haPermesso(req, 'gruppo.attivita')]);
    return r.rows;
}

// --- Le rotte ------------------------------------------------------------------------------------

export function registraRotteCopione(app) {
    const id = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : null; };
    const soloInterni = (req, res, next) => esterno(req) ? res.status(403).json({ message: 'La regia è degli interni.' }) : next();

    // La regia dell'attività, o la risposta che dice perché no.
    async function serveRegia(req, res, attivitaId) {
        const a = await regia(req, attivitaId);
        if (!a) { res.status(404).json({ message: 'Attività non trovata.' }); return null; }
        if (!a.conduce) { res.status(403).json({ message: 'Il copione lo vede e lo scrive solo la regia.' }); return null; }
        return a;
    }

    // La sala più recente dell'attività.
    const salaDi = async (attivitaId) => (await pool.query(
        'SELECT id, code, status, start_time, end_time FROM emergencies WHERE attivita_id = $1 ORDER BY id DESC LIMIT 1', [attivitaId])).rows[0] || null;

    // Il modello da compilare, con le righe d'esempio e le istruzioni.
    app.get('/api/copione/modello.xlsx', soloInterni, async (req, res) => {
        try {
            const buffer = await modelloExcel();
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="copione-modello.xlsx"');
            res.send(Buffer.from(buffer));
        } catch (e) {
            logger.error('Errore GET /api/copione/modello.xlsx:', e);
            res.status(500).json({ message: 'Errore nel preparare il modello.' });
        }
    });

    // Il copione di un'attività: per la regia tutto; per gli altri, se la regia
    // l'ha pubblicato a simulazione chiusa, in sola lettura.
    app.get('/api/attivita/:id/copione', soloInterni, async (req, res) => {
        const attivitaId = id(req.params.id);
        if (!attivitaId) return res.status(400).json({ message: 'Attività non valida.' });
        try {
            const a = await regia(req, attivitaId);
            if (!a) return res.status(404).json({ message: 'Attività non trovata.' });
            const sala = await salaDi(attivitaId);
            const chiusa = sala && sala.status !== 'ACTIVE';
            if (!a.conduce && !a.partecipa) return res.status(404).json({ message: 'Attività non trovata.' });
            if (!a.conduce && !(a.copione_pubblicato && chiusa)) return res.status(403).json({ message: 'Il copione lo vede solo la regia.' });
            const eventi = await eventiDi(attivitaId);
            const [esiti, osservazioni, debriefing] = await Promise.all([
                sala ? esitiDi(sala.id, eventi) : eventi.map(e => ({ ...e, stato: 'atteso', previsto: e.minuto })),
                pool.query('SELECT id, emergency_id, evento_id, report_id, testo, autore_nome, creata_il FROM osservazioni WHERE attivita_id = $1 ORDER BY creata_il', [attivitaId]),
                pool.query('SELECT * FROM debriefing WHERE attivita_id = $1', [attivitaId])
            ]);
            res.json({
                attivita: { id: a.id, titolo: a.titolo, tipo: a.tipo, scenario: a.scenario, obiettivi: a.obiettivi, simulazione: a.simulazione, stato: a.stato },
                puo_modificare: a.conduce && a.stato !== 'annullata',
                pubblicato: a.copione_pubblicato,
                sala: sala ? { id: sala.id, codice: sala.code, aperta: sala.status === 'ACTIVE', inizio: sala.start_time, fine: sala.end_time } : null,
                eventi: esiti,
                osservazioni: osservazioni.rows,
                debriefing: debriefing.rows[0] || null
            });
        } catch (e) {
            logger.error('Errore GET /api/attivita/:id/copione:', e);
            res.status(500).json({ message: 'Errore nel leggere il copione.' });
        }
    });

    // Il copione in Excel, nello stesso formato del modello: si corregge e si ricarica.
    app.get('/api/attivita/:id/copione.xlsx', soloInterni, async (req, res) => {
        const attivitaId = id(req.params.id);
        if (!attivitaId) return res.status(400).json({ message: 'Attività non valida.' });
        try {
            const a = await serveRegia(req, res, attivitaId);
            if (!a) return;
            const buffer = await modelloExcel(await eventiDi(attivitaId));
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="copione-${attivitaId}.xlsx"`);
            res.send(Buffer.from(buffer));
        } catch (e) {
            logger.error('Errore GET /api/attivita/:id/copione.xlsx:', e);
            res.status(500).json({ message: 'Errore nel preparare il file.' });
        }
    });

    app.post('/api/attivita/:id/copione/eventi', soloInterni, async (req, res) => {
        const attivitaId = id(req.params.id);
        if (!attivitaId) return res.status(400).json({ message: 'Attività non valida.' });
        try {
            const a = await serveRegia(req, res, attivitaId);
            if (!a) return;
            const presenti = await eventiDi(attivitaId);
            if (presenti.length >= MAX_EVENTI) return res.status(409).json({ message: `Al massimo ${MAX_EVENTI} eventi.` });
            const { evento, errore } = leggiEvento(req.body, new Set(presenti.filter(e => e.tipo === 'segnalazione').map(e => e.id)));
            if (errore) return res.status(400).json({ message: errore });
            const ordine = presenti.reduce((m, e) => Math.max(m, e.ordine), 0) + 1;
            const creato = await inserisciEvento(pool, attivitaId, evento, ordine);
            registraAudit(req, 'copione.evento_aggiunto', { tipo: 'attivita', id: attivitaId, dettagli: { evento: creato.id, tipo: creato.tipo, titolo: creato.titolo } });
            regiaCambiata();
            res.status(201).json(creato);
        } catch (e) {
            logger.error('Errore POST /api/attivita/:id/copione/eventi:', e);
            res.status(500).json({ message: "Errore nel salvare l'evento." });
        }
    });

    app.put('/api/copione/eventi/:id', soloInterni, async (req, res) => {
        const eventoId = id(req.params.id);
        if (!eventoId) return res.status(400).json({ message: 'Evento non valido.' });
        try {
            const prima = (await pool.query('SELECT * FROM copione_eventi WHERE id = $1', [eventoId])).rows[0];
            if (!prima) return res.status(404).json({ message: 'Evento non trovato.' });
            const a = await serveRegia(req, res, prima.attivita_id);
            if (!a) return;
            const presenti = await eventiDi(prima.attivita_id);
            const { evento, errore } = leggiEvento(req.body, new Set(presenti.filter(e => e.tipo === 'segnalazione' && e.id !== eventoId).map(e => e.id)));
            if (errore) return res.status(400).json({ message: errore });
            const r = await pool.query(
                `UPDATE copione_eventi SET ${COLONNE_EVENTO.map((k, i) => `${k} = $${i + 2}`).join(', ')}, aggiornato_il = NOW()
                  WHERE id = $1 RETURNING *`,
                [eventoId, ...COLONNE_EVENTO.map(k => k === 'geometria' ? (evento.geometria ? JSON.stringify(evento.geometria) : null) : evento[k])]);
            registraAudit(req, 'copione.evento_modificato', { tipo: 'attivita', id: prima.attivita_id, dettagli: { evento: eventoId, titolo: evento.titolo } });
            regiaCambiata();
            res.json(r.rows[0]);
        } catch (e) {
            logger.error('Errore PUT /api/copione/eventi/:id:', e);
            res.status(500).json({ message: "Errore nel salvare l'evento." });
        }
    });

    app.delete('/api/copione/eventi/:id', soloInterni, async (req, res) => {
        const eventoId = id(req.params.id);
        if (!eventoId) return res.status(400).json({ message: 'Evento non valido.' });
        try {
            const prima = (await pool.query('SELECT * FROM copione_eventi WHERE id = $1', [eventoId])).rows[0];
            if (!prima) return res.status(404).json({ message: 'Evento non trovato.' });
            const a = await serveRegia(req, res, prima.attivita_id);
            if (!a) return;
            const uscito = await pool.query("SELECT 1 FROM copione_esiti WHERE evento_id = $1 AND stato = 'uscito'", [eventoId]);
            if (uscito.rowCount) return res.status(409).json({ message: 'Un evento già uscito in sala resta: serve alla valutazione.' });
            await pool.query('DELETE FROM copione_eventi WHERE id = $1', [eventoId]);
            registraAudit(req, 'copione.evento_tolto', { tipo: 'attivita', id: prima.attivita_id, dettagli: { evento: eventoId, titolo: prima.titolo } });
            regiaCambiata();
            res.status(204).end();
        } catch (e) {
            logger.error('Errore DELETE /api/copione/eventi/:id:', e);
            res.status(500).json({ message: "Errore nel togliere l'evento." });
        }
    });

    // Caricare il copione dal foglio Excel: si aggiunge a quello che c'è, o lo
    // sostituisce (modo=sostituisci). Tutto o niente: con un errore non si carica nulla.
    app.post('/api/attivita/:id/copione/importa', soloInterni, (req, res, next) => {
        caricaFoglio.single('file')(req, res, (err) => {
            if (err) return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Il file supera i 2 MB.' : 'File non valido.' });
            next();
        });
    }, async (req, res) => {
        const attivitaId = id(req.params.id);
        if (!attivitaId) return res.status(400).json({ message: 'Attività non valida.' });
        if (!req.file) return res.status(400).json({ message: 'Scegli il file Excel (.xlsx) compilato sul modello.' });
        try {
            const a = await serveRegia(req, res, attivitaId);
            if (!a) return;
            const { righe, errori } = await leggiExcel(req.file.buffer);
            if (errori.length) return res.status(400).json({ message: 'Nel foglio ci sono righe da correggere: non ho caricato niente.', errori });
            const sostituisci = req.body?.modo === 'sostituisci';
            const client = await pool.connect();
            let caricati = 0, daPosizionare = 0;
            try {
                await client.query('BEGIN');
                if (sostituisci) {
                    const usciti = await client.query(
                        "SELECT 1 FROM copione_esiti x JOIN copione_eventi e ON e.id = x.evento_id WHERE e.attivita_id = $1 AND x.stato = 'uscito' LIMIT 1", [attivitaId]);
                    if (usciti.rowCount) {
                        await client.query('ROLLBACK');
                        return res.status(409).json({ message: 'Il copione è già stato usato in sala: si può solo aggiungere.' });
                    }
                    await client.query('DELETE FROM copione_eventi WHERE attivita_id = $1', [attivitaId]);
                }
                let ordine = (await client.query('SELECT COALESCE(MAX(ordine), 0) AS m FROM copione_eventi WHERE attivita_id = $1', [attivitaId])).rows[0].m;
                const idPerRiga = new Map();
                // Prima le segnalazioni, così gli aggravamenti trovano a chi riferirsi.
                const ordinate = [...righe].sort((x, y) => (x.corpo.tipo === 'aggravamento') - (y.corpo.tipo === 'aggravamento') || x.n - y.n);
                for (const r of ordinate) {
                    if (r.corpo.tipo === 'aggravamento') r.corpo.riferimento_id = idPerRiga.get(r.rif);
                    const { evento } = leggiEvento(r.corpo);
                    const creato = await inserisciEvento(client, attivitaId, evento, ++ordine);
                    idPerRiga.set(r.n, creato.id);
                    caricati++;
                    if ((evento.tipo === 'segnalazione' && evento.lat === null) || (ELEMENTI_DI[evento.tipo] && !evento.geometria)) daPosizionare++;
                }
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                throw e;
            } finally {
                client.release();
            }
            registraAudit(req, 'copione.importato', { tipo: 'attivita', id: attivitaId, dettagli: { eventi: caricati, sostituito: sostituisci } });
            regiaCambiata();
            res.status(201).json({ caricati, da_posizionare: daPosizionare });
        } catch (e) {
            logger.error('Errore POST /api/attivita/:id/copione/importa:', e);
            res.status(500).json({ message: 'Errore nel caricare il foglio.' });
        }
    });

    // Copiare il copione di un'altra attività (lo scenario dell'anno scorso).
    app.post('/api/attivita/:id/copione/copia', soloInterni, async (req, res) => {
        const attivitaId = id(req.params.id), daId = id(req.body?.da);
        if (!attivitaId || !daId || attivitaId === daId) return res.status(400).json({ message: "Scegli l'attività da cui copiare." });
        try {
            const a = await serveRegia(req, res, attivitaId);
            if (!a) return;
            const origine = await regia(req, daId);
            if (!origine?.conduce && !haPermesso(req, 'gruppo.attivita')) return res.status(403).json({ message: 'Si copia il copione di un\'attività di cui si fa la regia.' });
            const eventi = await eventiDi(daId);
            if (!eventi.length) return res.status(409).json({ message: "L'altra attività non ha copione." });
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const copiati = await copiaCopione(client, daId, attivitaId);
                await client.query('COMMIT');
                registraAudit(req, 'copione.copiato', { tipo: 'attivita', id: attivitaId, dettagli: { da: daId, eventi: copiati } });
                res.status(201).json({ copiati });
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                throw e;
            } finally {
                client.release();
            }
        } catch (e) {
            logger.error('Errore POST /api/attivita/:id/copione/copia:', e);
            res.status(500).json({ message: 'Errore nel copiare il copione.' });
        }
    });

    // Pubblicare copione e debriefing ai partecipanti (o ritirarli).
    app.put('/api/attivita/:id/copione/pubblica', soloInterni, async (req, res) => {
        const attivitaId = id(req.params.id);
        if (!attivitaId) return res.status(400).json({ message: 'Attività non valida.' });
        try {
            const a = await serveRegia(req, res, attivitaId);
            if (!a) return;
            const pubblicato = req.body?.pubblicato === true;
            await pool.query('UPDATE attivita SET copione_pubblicato = $2 WHERE id = $1', [attivitaId, pubblicato]);
            registraAudit(req, pubblicato ? 'copione.pubblicato' : 'copione.ritirato', { tipo: 'attivita', id: attivitaId });
            res.json({ pubblicato });
        } catch (e) {
            logger.error('Errore PUT /api/attivita/:id/copione/pubblica:', e);
            res.status(500).json({ message: 'Errore nel pubblicare.' });
        }
    });

    // --- Debriefing e osservazioni ---------------------------------------------------------

    app.put('/api/attivita/:id/debriefing', soloInterni, async (req, res) => {
        const attivitaId = id(req.params.id);
        if (!attivitaId) return res.status(400).json({ message: 'Attività non valida.' });
        try {
            const a = await serveRegia(req, res, attivitaId);
            if (!a) return;
            const prima = (await pool.query('SELECT concluso_il FROM debriefing WHERE attivita_id = $1', [attivitaId])).rows[0];
            if (prima?.concluso_il) return res.status(409).json({ message: 'Il debriefing è concluso: non si cambia più.' });
            const campi = ['obiettivi_raggiunti', 'punti_forza', 'criticita', 'miglioramenti'].map(k => testo(req.body?.[k], 8000));
            const r = await pool.query(
                `INSERT INTO debriefing (attivita_id, obiettivi_raggiunti, punti_forza, criticita, miglioramenti, aggiornato_il, aggiornato_da)
                 VALUES ($1, $2, $3, $4, $5, NOW(), $6)
                 ON CONFLICT (attivita_id) DO UPDATE SET obiettivi_raggiunti = $2, punti_forza = $3, criticita = $4, miglioramenti = $5,
                        aggiornato_il = NOW(), aggiornato_da = $6
                 RETURNING *`, [attivitaId, ...campi, nomeUtente(req.user)]);
            registraAudit(req, 'debriefing.scritto', { tipo: 'attivita', id: attivitaId });
            res.json(r.rows[0]);
        } catch (e) {
            logger.error('Errore PUT /api/attivita/:id/debriefing:', e);
            res.status(500).json({ message: 'Errore nel salvare il debriefing.' });
        }
    });

    app.post('/api/attivita/:id/debriefing/concludi', soloInterni, async (req, res) => {
        const attivitaId = id(req.params.id);
        if (!attivitaId) return res.status(400).json({ message: 'Attività non valida.' });
        try {
            const a = await serveRegia(req, res, attivitaId);
            if (!a) return;
            const r = await pool.query(
                `UPDATE debriefing SET concluso_il = NOW(), concluso_da = $2 WHERE attivita_id = $1 AND concluso_il IS NULL RETURNING *`,
                [attivitaId, nomeUtente(req.user)]);
            if (!r.rowCount) return res.status(409).json({ message: 'Niente da concludere: il debriefing è vuoto o già concluso.' });
            registraAudit(req, 'debriefing.concluso', { tipo: 'attivita', id: attivitaId, dettagli: r.rows[0] });
            res.json(r.rows[0]);
        } catch (e) {
            logger.error('Errore POST /api/attivita/:id/debriefing/concludi:', e);
            res.status(500).json({ message: 'Errore nel concludere il debriefing.' });
        }
    });

    app.post('/api/attivita/:id/osservazioni', soloInterni, async (req, res) => {
        const attivitaId = id(req.params.id);
        const t = testo(req.body?.testo, LIMITE.nota);
        if (!attivitaId) return res.status(400).json({ message: 'Attività non valida.' });
        if (!t) return res.status(400).json({ message: "Scrivi l'osservazione." });
        try {
            const a = await serveRegia(req, res, attivitaId);
            if (!a) return;
            const sala = activeEmergency?.attivita_id === attivitaId ? activeEmergency.id : null;
            const r = await pool.query(
                `INSERT INTO osservazioni (attivita_id, emergency_id, evento_id, report_id, testo, autore_id, autore_nome)
                 VALUES ($1, $2, (SELECT id FROM copione_eventi WHERE id = $3 AND attivita_id = $1),
                         (SELECT id FROM reports WHERE id = $4 AND emergency_id = $2), $5, $6, $7)
                 RETURNING id, emergency_id, evento_id, report_id, testo, autore_nome, creata_il`,
                [attivitaId, sala, id(req.body?.evento_id), id(req.body?.report_id), t, req.user.id, nomeUtente(req.user)]);
            regiaCambiata();
            res.status(201).json(r.rows[0]);
        } catch (e) {
            logger.error('Errore POST /api/attivita/:id/osservazioni:', e);
            res.status(500).json({ message: "Errore nel salvare l'osservazione." });
        }
    });

    // --- La regia in sala -----------------------------------------------------------------------

    // La simulazione aperta e chi la conduce, o la risposta che dice perché no.
    async function regiaInSala(req, res) {
        const e = activeEmergency;
        if (!e?.simulazione || !e.attivita_id) { res.status(409).json({ message: 'Nessuna simulazione aperta in sala.' }); return null; }
        const a = await regia(req, e.attivita_id);
        if (!a?.conduce) { res.status(403).json({ message: 'La regia la fa chi conduce la simulazione.' }); return null; }
        return { emergenza: e, attivita: a };
    }

    app.get('/api/regia', soloInterni, async (req, res) => {
        try {
            const r = await regiaInSala(req, res);
            if (!r) return;
            const o = await orologio(r.emergenza.id);
            const eventi = await esitiDi(r.emergenza.id, await eventiDi(r.attivita.id));
            const osservazioni = (await pool.query(
                'SELECT id, evento_id, report_id, testo, autore_nome, creata_il FROM osservazioni WHERE attivita_id = $1 AND emergency_id = $2 ORDER BY creata_il DESC',
                [r.attivita.id, r.emergenza.id])).rows;
            const minuti = trascorsi(o);
            const prossimo = eventi.filter(e => e.stato === 'atteso' && e.previsto !== null).sort((x, y) => x.previsto - y.previsto)[0] || null;
            res.json({
                attivita: { id: r.attivita.id, titolo: r.attivita.titolo, tipo: r.attivita.tipo, scenario: r.attivita.scenario, obiettivi: r.attivita.obiettivi },
                emergenza: { id: r.emergenza.id, codice: r.emergenza.code },
                orologio: o ? { avviata_il: o.avviata_il, in_pausa: !!o.pausa_dal, trascorsi: minuti } : null,
                prossimo: prossimo ? { id: prossimo.id, fra_minuti: Math.max(0, prossimo.previsto - (minuti ?? 0)) } : null,
                eventi,
                osservazioni
            });
        } catch (e) {
            logger.error('Errore GET /api/regia:', e);
            res.status(500).json({ message: 'Errore nel leggere la regia.' });
        }
    });

    app.post('/api/regia/avvia', soloInterni, async (req, res) => {
        try {
            const r = await regiaInSala(req, res);
            if (!r) return;
            const fatto = await pool.query(
                `INSERT INTO regia_orologio (emergency_id, avviata_il, avviata_da) VALUES ($1, NOW(), $2) ON CONFLICT DO NOTHING RETURNING *`,
                [r.emergenza.id, req.user.id]);
            if (!fatto.rowCount) return res.status(409).json({ message: 'Lo scenario è già avviato.' });
            registraAudit(req, 'regia.avviata', { tipo: 'emergenza', id: r.emergenza.id });
            regiaCambiata();
            res.status(201).json(fatto.rows[0]);
            controllaUscite();
        } catch (e) {
            logger.error('Errore POST /api/regia/avvia:', e);
            res.status(500).json({ message: "Errore nell'avviare lo scenario." });
        }
    });

    app.post('/api/regia/pausa', soloInterni, async (req, res) => {
        try {
            const r = await regiaInSala(req, res);
            if (!r) return;
            const pausa = req.body?.pausa === true;
            const fatto = pausa
                ? await pool.query('UPDATE regia_orologio SET pausa_dal = NOW() WHERE emergency_id = $1 AND pausa_dal IS NULL RETURNING *', [r.emergenza.id])
                : await pool.query(
                    `UPDATE regia_orologio SET pausa_secondi = pausa_secondi + EXTRACT(EPOCH FROM NOW() - pausa_dal)::int, pausa_dal = NULL
                      WHERE emergency_id = $1 AND pausa_dal IS NOT NULL RETURNING *`, [r.emergenza.id]);
            if (!fatto.rowCount) return res.status(409).json({ message: pausa ? 'Lo scenario non è avviato o è già in pausa.' : 'Lo scenario non è in pausa.' });
            registraAudit(req, pausa ? 'regia.pausa' : 'regia.ripresa', { tipo: 'emergenza', id: r.emergenza.id });
            regiaCambiata();
            res.json(fatto.rows[0]);
            if (!pausa) controllaUscite();
        } catch (e) {
            logger.error('Errore POST /api/regia/pausa:', e);
            res.status(500).json({ message: 'Errore nella pausa.' });
        }
    });

    // Un evento del copione della simulazione aperta, o la risposta che dice perché no.
    async function eventoInSala(req, res) {
        const r = await regiaInSala(req, res);
        if (!r) return null;
        const evento = (await pool.query('SELECT * FROM copione_eventi WHERE id = $1 AND attivita_id = $2', [id(req.params.id), r.attivita.id])).rows[0];
        if (!evento) { res.status(404).json({ message: 'Evento non trovato nel copione.' }); return null; }
        return { ...r, evento };
    }

    app.post('/api/regia/eventi/:id/esci', soloInterni, async (req, res) => {
        try {
            const r = await eventoInSala(req, res);
            if (!r) return;
            const esito = await esci(r.emergenza, r.evento, { id: req.user.id, nome: nomeUtente(req.user) });
            if (esito.gia) return res.status(409).json({ message: "L'evento è già uscito (o è stato saltato)." });
            if (esito.errore) return res.status(409).json({ message: esito.errore });
            registraAudit(req, 'regia.evento_uscito', { tipo: 'emergenza', id: r.emergenza.id, dettagli: { evento: r.evento.id, titolo: r.evento.titolo } });
            res.json(esito);
        } catch (e) {
            logger.error('Errore POST /api/regia/eventi/:id/esci:', e);
            res.status(500).json({ message: "Errore nel far uscire l'evento." });
        }
    });

    app.post('/api/regia/eventi/:id/rimanda', soloInterni, async (req, res) => {
        const minuti = parseInt(req.body?.minuti, 10);
        if (!Number.isInteger(minuti) || minuti < 1 || minuti > 600) return res.status(400).json({ message: 'Di quanti minuti? Da 1 a 600.' });
        try {
            const r = await eventoInSala(req, res);
            if (!r) return;
            if (r.evento.minuto === null) return res.status(409).json({ message: 'Un evento a mano non ha un orario da rimandare.' });
            const fatto = await pool.query(
                `INSERT INTO copione_esiti (emergency_id, evento_id, rimando_minuti) VALUES ($1, $2, $3)
                 ON CONFLICT (emergency_id, evento_id) DO UPDATE SET rimando_minuti = copione_esiti.rimando_minuti + EXCLUDED.rimando_minuti
                 WHERE copione_esiti.stato IS NULL RETURNING rimando_minuti`, [r.emergenza.id, r.evento.id, minuti]);
            if (!fatto.rowCount) return res.status(409).json({ message: "L'evento è già uscito (o è stato saltato)." });
            registraAudit(req, 'regia.evento_rimandato', { tipo: 'emergenza', id: r.emergenza.id, dettagli: { evento: r.evento.id, minuti } });
            regiaCambiata();
            res.json(fatto.rows[0]);
        } catch (e) {
            logger.error('Errore POST /api/regia/eventi/:id/rimanda:', e);
            res.status(500).json({ message: "Errore nel rimandare l'evento." });
        }
    });

    app.post('/api/regia/eventi/:id/salta', soloInterni, async (req, res) => {
        try {
            const r = await eventoInSala(req, res);
            if (!r) return;
            const fatto = await pool.query(
                `INSERT INTO copione_esiti (emergency_id, evento_id, stato, uscito_da) VALUES ($1, $2, 'saltato', $3)
                 ON CONFLICT (emergency_id, evento_id) DO UPDATE SET stato = 'saltato', uscito_da = EXCLUDED.uscito_da
                 WHERE copione_esiti.stato IS NULL RETURNING *`, [r.emergenza.id, r.evento.id, nomeUtente(req.user)]);
            if (!fatto.rowCount) return res.status(409).json({ message: "L'evento è già uscito (o è stato saltato)." });
            registraAudit(req, 'regia.evento_saltato', { tipo: 'emergenza', id: r.emergenza.id, dettagli: { evento: r.evento.id } });
            regiaCambiata();
            res.json(fatto.rows[0]);
        } catch (e) {
            logger.error('Errore POST /api/regia/eventi/:id/salta:', e);
            res.status(500).json({ message: "Errore nel saltare l'evento." });
        }
    });

    // La segnalazione telefonata, inserita dalla sala: la regia la collega
    // all'evento, così i tempi si misurano e gli aggravamenti la trovano.
    app.post('/api/regia/eventi/:id/collega', soloInterni, async (req, res) => {
        const reportId = id(req.body?.report_id);
        if (!reportId) return res.status(400).json({ message: 'Scegli la segnalazione.' });
        try {
            const r = await eventoInSala(req, res);
            if (!r) return;
            if (r.evento.tipo !== 'segnalazione') return res.status(409).json({ message: 'Si collegano solo le segnalazioni.' });
            const rep = await pool.query('SELECT id FROM reports WHERE id = $1 AND emergency_id = $2', [reportId, r.emergenza.id]);
            if (!rep.rowCount) return res.status(404).json({ message: 'Segnalazione non trovata in questa simulazione.' });
            const fatto = await pool.query(
                `UPDATE copione_esiti SET report_id = $3 WHERE emergency_id = $1 AND evento_id = $2 AND stato = 'uscito' RETURNING *`,
                [r.emergenza.id, r.evento.id, reportId]);
            if (!fatto.rowCount) return res.status(409).json({ message: "Prima l'evento deve essere uscito." });
            registraAudit(req, 'regia.evento_collegato', { tipo: 'emergenza', id: r.emergenza.id, dettagli: { evento: r.evento.id, report: reportId } });
            regiaCambiata();
            res.json(fatto.rows[0]);
        } catch (e) {
            logger.error('Errore POST /api/regia/eventi/:id/collega:', e);
            res.status(500).json({ message: 'Errore nel collegare la segnalazione.' });
        }
    });

    // Un evento inventato al momento: entra nel copione (a mano) ed esce subito.
    // Le comunicazioni uscite nella simulazione aperta, per chi è in sala (non solo la regia, esterni compresi):
    // il centro operativo le mostra in primo piano finché non si segnano lette.
    app.get('/api/regia/comunicazioni', async (req, res) => {
        const emergenza = activeEmergency;
        if (!emergenza?.simulazione || !emergenza.attivita_id) return res.json([]);
        try {
            const r = await pool.query(`
                SELECT e.id AS evento_id, e.titolo, e.testo, x.uscito_il
                  FROM copione_esiti x JOIN copione_eventi e ON e.id = x.evento_id
                 WHERE x.emergency_id = $1 AND x.stato = 'uscito' AND e.tipo = 'comunicazione'
                 ORDER BY x.uscito_il`, [emergenza.id]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET /api/regia/comunicazioni:', e);
            res.status(500).json({ message: 'Errore nel leggere le comunicazioni.' });
        }
    });

    app.post('/api/regia/improvvisa', soloInterni, async (req, res) => {
        try {
            const r = await regiaInSala(req, res);
            if (!r) return;
            const presenti = await eventiDi(r.attivita.id);
            const { evento, errore } = leggiEvento({ ...req.body, minuto: null }, new Set(presenti.filter(e => e.tipo === 'segnalazione').map(e => e.id)));
            if (errore) return res.status(400).json({ message: errore });
            const creato = await inserisciEvento(pool, r.attivita.id, evento, presenti.reduce((m, e) => Math.max(m, e.ordine), 0) + 1);
            const esito = await esci(r.emergenza, creato, { id: req.user.id, nome: nomeUtente(req.user) });
            registraAudit(req, 'regia.evento_improvvisato', { tipo: 'emergenza', id: r.emergenza.id, dettagli: { evento: creato.id, titolo: creato.titolo } });
            res.status(201).json({ evento: creato, ...esito });
        } catch (e) {
            logger.error('Errore POST /api/regia/improvvisa:', e);
            res.status(500).json({ message: "Errore nell'evento improvvisato." });
        }
    });

    setInterval(controllaUscite, INTERVALLO_CONTROLLO_MS).unref();
    // Dopo un riavvio con una simulazione in corso, la prossima uscita si ripianifica subito.
    setTimeout(controllaUscite, 3000).unref();
}
