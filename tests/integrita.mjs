// tests/integrita.mjs
//
// Lo storico inalterabile, provato da chi ha in mano il database: quello che
// il blocco ferma, quello che la verifica scopre, e la riscrittura di tutta la
// catena che solo un sigillo conservato smaschera.
//
// MODIFICA IL DATABASE (righe alterate e rimesse a posto, catena riscritta):
// si lancia solo su un'installazione di prova, con ORION_TEST_DISTRUTTIVO=1.
//
//   ORION_URL=http://localhost:3020 ORION_ADMIN_USER=admin ORION_ADMIN_PASSWORD=... \
//   ORION_TEST_DISTRUTTIVO=1 DB_DATABASE=orion_prova node tests/integrita.mjs
//
// Le credenziali del database arrivano dal .env, come per il server.

import 'dotenv/config';
import pg from 'pg';
import { accediConFetch } from './accesso-prova.mjs';

if (process.env.ORION_TEST_DISTRUTTIVO !== '1') {
    console.error('Questa prova riscrive lo storico: lanciala solo su un server di prova, con ORION_TEST_DISTRUTTIVO=1.');
    process.exit(2);
}
const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const pool = new pg.Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE
});

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};

const accesso = await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD);
const api = async (percorso, opzioni = {}) => {
    const r = await fetch(BASE + percorso, {
        ...opzioni, headers: { Authorization: `Bearer ${accesso.token}`, 'Content-Type': 'application/json' },
        body: opzioni.body ? JSON.stringify(opzioni.body) : undefined
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const rifiuta = async (sql, parametri) => {
    try { await pool.query(sql, parametri); return false; } catch (e) { return /storico|registro di integrità/i.test(e.message); }
};
// Chi ha l'accesso del proprietario delle tabelle può spegnere i trigger.
const daAttaccante = async (tabella, sql, parametri) => {
    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        await c.query(`ALTER TABLE ${tabella} DISABLE TRIGGER USER`);
        const r = await c.query(sql, parametri);
        await c.query(`ALTER TABLE ${tabella} ENABLE TRIGGER USER`);
        await c.query('COMMIT');
        return r;
    } catch (e) {
        await c.query('ROLLBACK');
        throw e;
    } finally {
        c.release();
    }
};

console.log('\nStorico inalterabile');

// Un po' di storico: emergenza, segnalazione, nota, diario.
if (!(await api('/api/emergencies/status')).corpo?.active) {
    await api('/api/emergencies/open', { method: 'POST', body: { external_code: `INT-${Date.now().toString().slice(-5)}`, name: 'Prova integrità' } });
}
const segnalazione = (await api('/api/reports', { method: 'POST', body: { title: 'Prova integrità', reporter_name: 'x', reporter_contact: 'x', priority: 'Low' } })).corpo;
const idSegnalazione = segnalazione?.id || segnalazione?.report?.id;
const nota = (await api(`/api/reports/${idSegnalazione}/updates`, { method: 'POST', body: { update_text: 'Testo originale della nota' } })).corpo;
await api('/api/emergencies/diario-sala', { method: 'POST', body: { testo: 'Voce di diario per la prova' } });

let stato = (await api('/api/sistema/integrita')).corpo;
verifica('all\'inizio lo storico è integro e tutto sigillato', stato?.integro === true && stato.non_sigillate === 0, stato);

// 1. Il blocco, per chi passa dal database senza spegnere i trigger.
verifica('una nota non si modifica', await rifiuta('UPDATE report_updates SET update_text = $2 WHERE id = $1', [nota.id, 'ritoccata']));
verifica('una nota non si cancella', await rifiuta('DELETE FROM report_updates WHERE id = $1', [nota.id]));
verifica('il registro delle operazioni non si svuota', await rifiuta('TRUNCATE audit_log'));
verifica('il registro di integrità non si tocca', await rifiuta('UPDATE registro_integrita SET impronta = impronta WHERE id = (SELECT min(id) FROM registro_integrita)'));

// 2. Chi spegne i trigger: la verifica lo scopre, e torna integro rimettendo a posto.
await daAttaccante('report_updates', 'UPDATE report_updates SET update_text = $2 WHERE id = $1', [nota.id, 'Testo cambiato di nascosto']);
stato = (await api('/api/sistema/integrita')).corpo;
verifica('una nota cambiata di nascosto: la verifica la trova',
    stato?.integro === false && stato.alterate === 1 && stato.esempi_alterate?.[0]?.righe?.includes(nota.id), stato);
await daAttaccante('report_updates', 'UPDATE report_updates SET update_text = $2 WHERE id = $1', [nota.id, 'Testo originale della nota']);
// La data come testo: un Date di JavaScript perderebbe i microsecondi, e la riga rimessa non sarebbe più quella.
const copia = (await pool.query('SELECT *, update_timestamp::text AS quando_testo FROM report_updates WHERE id = $1', [nota.id])).rows[0];
await daAttaccante('report_updates', 'DELETE FROM report_updates WHERE id = $1', [nota.id]);
stato = (await api('/api/sistema/integrita')).corpo;
verifica('una nota cancellata di nascosto: la verifica la trova', stato?.integro === false && stato.mancanti === 1, stato);
await daAttaccante('report_updates',
    'INSERT INTO report_updates (id, report_id, update_timestamp, update_text, user_id, is_system, funzione_id) VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7)',
    [copia.id, copia.report_id, copia.quando_testo, copia.update_text, copia.user_id, copia.is_system, copia.funzione_id]);
stato = (await api('/api/sistema/integrita')).corpo;
verifica('rimessa com\'era, lo storico torna integro', stato?.integro === true, stato);

// 3. Il sigillo: preso adesso, confrontato dopo una riscrittura completa.
const sigillo = stato.sigillo;
let confronto = (await api('/api/sistema/integrita/confronta', { method: 'POST', body: { sigillo } })).corpo;
verifica('il sigillo appena preso corrisponde', confronto?.ok === true, confronto);
// L'attaccante cambia la nota e ricostruisce da capo tutta la catena:
// per la verifica interna è tutto in ordine...
await daAttaccante('report_updates', 'UPDATE report_updates SET update_text = $2 WHERE id = $1', [nota.id, 'Riscritta, catena compresa']);
await daAttaccante('registro_integrita', 'DELETE FROM registro_integrita');
await pool.query('SELECT orion_sigilla()');
stato = (await api('/api/sistema/integrita')).corpo;
verifica('dopo la riscrittura completa la verifica interna non vede niente (lo sa fare solo il sigillo)', stato?.integro === true, stato);
// ...ma il sigillo conservato no.
confronto = (await api('/api/sistema/integrita/confronta', { method: 'POST', body: { sigillo } })).corpo;
verifica('il sigillo conservato smaschera la riscrittura', confronto?.ok === false, confronto);
await daAttaccante('report_updates', 'UPDATE report_updates SET update_text = $2 WHERE id = $1', [nota.id, 'Testo originale della nota']);
await daAttaccante('registro_integrita', 'DELETE FROM registro_integrita');
await pool.query('SELECT orion_sigilla()');

// 4. Cancellare un'emergenza archiviata: si può, e resta scritto.
const emergenza = (await api('/api/emergencies/status')).corpo?.emergency;
await api('/api/emergencies/close', { method: 'POST', body: {} });
const tolta = await api(`/api/admin/emergencies/${emergenza.id}`, { method: 'DELETE' });
stato = (await api('/api/sistema/integrita')).corpo;
const evento = stato?.cancellazioni?.[0];
verifica('l\'emergenza archiviata si cancella, la verifica resta integra e la cancellazione è registrata',
    tolta.stato === 200 && stato?.integro === true && evento?.emergenza?.id === emergenza.id && evento.righe >= 2,
    { tolta: tolta.stato, integro: stato?.integro, evento });

await pool.end();
console.log(`\nIntegrità: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
