// Esito delle visite cifrato nel database, posizioni cancellate alla chiusura dell'emergenza,
// scadenza del registro delle operazioni annotata nella catena.
// Crea ed elimina un utente, apre e chiude un'emergenza e scrive nel registro: va lanciata su
// un'istanza di collaudo senza emergenze aperte.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_USER=... ORION_ADMIN_PASSWORD=... node tests/protezione-dati.mjs

import 'dotenv/config';
import pg from 'pg';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token, form } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: form || (body ? JSON.stringify(body) : undefined),
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};

console.log('\nProtezione dei dati');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-6);
const segreteriaPrima = (await chiama('/api/branding/settings')).corpo?.segreteria_config;
await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { segreteria_config: JSON.stringify({ enabled: true }) } });
const persona = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `Esito${suffisso}`, cognome: `Prova${suffisso}`, role: 'volontario' } })).corpo;

try {
    let tipo = (await pool.query("SELECT id FROM medical_visit_types WHERE LOWER(name) = 'visita di idoneità fisica'")).rows[0]?.id;
    if (!tipo) tipo = (await chiama('/api/admin/medical-visit-types', { method: 'POST', token: admin, body: { name: 'Visita di idoneità fisica', validity_months: 12 } })).corpo?.id;
    const visita = (esito, data) => {
        const modulo = new FormData();
        modulo.append('visit_type_id', String(tipo));
        modulo.append('last_visit_date', data);
        modulo.append('expiry_date', '2099-01-01');
        modulo.append('status', esito);
        return chiama(`/api/admin/users/${persona.id}/medical-records`, { method: 'POST', token: admin, form: modulo });
    };

    let r = await visita('Idoneo', '2026-01-10');
    verifica('la visita si registra', r.stato === 201, r);
    let nelDb = (await pool.query('SELECT status FROM user_medical_records WHERE user_id = $1', [persona.id])).rows[0]?.status || '';
    verifica("nel database l'esito è cifrato", nelDb.startsWith('enc1:') && !nelDb.includes('Idoneo'), nelDb.slice(0, 12));
    r = await chiama(`/api/users/${persona.id}/libretto`, { token: admin });
    verifica("nel fascicolo l'esito si legge in chiaro", r.corpo?.medical_records?.[0]?.status === 'Idoneo', r.corpo?.medical_records);
    let liberi = (await chiama('/api/users/unassigned', { token: admin })).corpo || [];
    let io = (Array.isArray(liberi) ? liberi : liberi.users || []).find(u => u.id === persona.id);
    verifica('per le squadre risulta idoneo', io?.medical_ok === true, io);

    await visita('Non Idoneo', '2026-03-10');
    liberi = (await chiama('/api/users/unassigned', { token: admin })).corpo || [];
    io = (Array.isArray(liberi) ? liberi : liberi.users || []).find(u => u.id === persona.id);
    verifica("conta l'ultima visita: dopo un non idoneo non lo è più", io?.medical_ok === false, io);
    r = await chiama('/api/admin/segreteria/dashboard', { token: admin });
    verifica('il cruscotto della segreteria lo mostra da sistemare, con l\'esito in chiaro',
        (r.corpo?.expiring_medical || []).some(m => m.id === persona.id && m.ultimo_stato === 'Non Idoneo'), r.corpo?.expiring_medical?.slice?.(0, 3));
    r = await chiama('/api/admin/users', { token: admin });
    verifica("nessun elenco degli utenti espone l'esito cifrato", !JSON.stringify(r.corpo || '').includes('enc1:'), '');

    const aperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `DATI-${suffisso}`, name: 'Prova protezione dati' } })).corpo?.emergency;
    verifica("si apre un'emergenza di prova", !!aperta?.id, aperta);
    const squadra = (await pool.query('SELECT id FROM squadre LIMIT 1')).rows[0]?.id;
    if (squadra) {
        await pool.query(
            `INSERT INTO posizioni_squadre (squadra_id, latitude, longitude, last_update) VALUES ($1, 46.1, 12.2, NOW())
             ON CONFLICT (squadra_id) DO UPDATE SET last_update = NOW()`, [squadra]);
    }
    const prima = Number((await pool.query('SELECT count(*) FROM posizioni_squadre')).rows[0].count);
    r = await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    const dopo = Number((await pool.query('SELECT count(*) FROM posizioni_squadre')).rows[0].count);
    verifica("alla chiusura dell'emergenza le posizioni delle squadre si cancellano", r.stato === 200 && (squadra ? prima > 0 : true) && dopo === 0, { stato: r.stato, prima, dopo });

    const vecchia = (await pool.query(
        `INSERT INTO audit_log (username, action, entity_type, occurred_at) VALUES ('prova', 'prova.scadenza', 'prova', NOW() - INTERVAL '4000 days') RETURNING id`)).rows[0].id;
    const recente = (await pool.query(
        `INSERT INTO audit_log (username, action, entity_type) VALUES ('prova', 'prova.recente', 'prova') RETURNING id`)).rows[0].id;
    try {
        await pool.query('DELETE FROM audit_log WHERE id = $1', [vecchia]);
        verifica('senza dichiarazione il registro non si cancella', false, 'cancellata');
    } catch (e) {
        verifica('senza dichiarazione il registro non si cancella', /non si cancella/.test(e.message), e.message);
    }
    const verificaPrima = (await pool.query('SELECT orion_verifica() AS v')).rows[0].v;
    process.env.ORION_REGISTRO_GIORNI = '';
    const { scadenzaRegistro } = await import('../src/integrita.js');
    verifica('senza ORION_REGISTRO_GIORNI il registro non scade', await scadenzaRegistro() === 0);
    const uscite = await scadenzaRegistro(3650);
    const restano = (await pool.query('SELECT id FROM audit_log WHERE id = ANY($1::bigint[])', [[vecchia, recente]])).rows.map(x => Number(x.id));
    verifica('con la scadenza escono le voci più vecchie e restano le altre', uscite >= 1 && !restano.includes(Number(vecchia)) && restano.includes(Number(recente)), { uscite, restano });
    const anello = (await pool.query("SELECT dettagli FROM registro_integrita WHERE evento = 'scadenza_registro' ORDER BY id DESC LIMIT 1")).rows[0]?.dettagli;
    verifica('la catena annota quali voci sono uscite', anello?.righe?.audit_log?.includes(Number(vecchia)) && anello?.giorni === 3650, anello);
    const verificaDopo = (await pool.query('SELECT orion_verifica() AS v')).rows[0].v;
    verifica('la verifica non le conta come mancanti', verificaDopo.mancanti === verificaPrima.mancanti && verificaDopo.catena_rotta === verificaPrima.catena_rotta,
        { prima: verificaPrima.mancanti, dopo: verificaDopo.mancanti });
} finally {
    await chiama(`/api/users/${persona.id}`, { method: 'DELETE', token: admin });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { segreteria_config: typeof segreteriaPrima === 'string' ? segreteriaPrima : JSON.stringify(segreteriaPrima || { enabled: false }) } });
    await pool.end();
    const { pool: poolApp } = await import('../src/db.js');
    await poolApp.end().catch(() => {});
}

console.log(`\nProtezione dei dati: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
