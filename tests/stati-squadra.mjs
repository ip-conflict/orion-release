// Lo stato della squadra su un intervento: i membri vanno avanti, la sala corregge, diario e resoconto lo riportano.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/stati-squadra.mjs
// Apre un'emergenza di prova se non ce n'è una e la chiude alla fine; crea ed elimina persone e squadre.

import { accediConFetch, prendiVisione } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    const tipo = r.headers.get('content-type') || '';
    return { stato: r.status, corpo: tipo.includes('json') ? await r.json().catch(() => null) : await r.text() };
};

console.log('\nStato delle squadre');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const persone = [], squadre = [];
let aperta = null;
async function persona(nome) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome, cognome: `Stato${suffisso}`, role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = `Stato!${suffisso}Lanterna1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const token = (await chiama('/login', { method: 'POST', body: { username: n.username, password } })).corpo.token;
    await prendiVisione(BASE, token);
    persone.push(n.id);
    return { ...n, token };
}
try {
    if (!(await chiama('/api/emergencies/status', { token: admin })).corpo?.active) {
        const r = await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `STATI-${suffisso}` } });
        aperta = r.corpo?.emergency?.id ?? null;
    }
    const emergenza = (await chiama('/api/emergencies/status', { token: admin })).corpo?.emergency;
    const alfa = await persona('Alfio'), beta = await persona('Bea');
    const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
    const [r1, r2] = ['Sierra', 'Romeo', 'Quebec', 'Papa', 'Oscar', 'Lima'].filter(n => !usati.has(n));
    const sqA = (await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: r1, nome: 'Prova A', caposquadra: alfa.username, membri: [{ username: alfa.username }] } })).corpo.squadraId;
    const sqB = (await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: r2, nome: 'Prova B', caposquadra: beta.username, membri: [{ username: beta.username }] } })).corpo.squadraId;
    squadre.push(sqA, sqB);
    const seg = (await chiama('/api/reports', { method: 'POST', token: admin, body: { title: `Allagamento ${suffisso}` } })).corpo;
    await chiama(`/api/reports/${seg.id}/teams`, { method: 'POST', token: admin, body: { teamId: sqA } });
    await chiama(`/api/reports/${seg.id}/teams`, { method: 'POST', token: admin, body: { teamId: sqB } });
    const stato = (chi, sq, s, extra = {}) => chiama(`/api/reports/${seg.id}/teams/${sq}/stato`, { method: 'POST', token: chi, body: { stato: s, ...extra } });

    verifica('un membro mette la sua squadra "partita"', (await stato(alfa.token, sqA, 'partita')).stato === 200);
    // Un interno corregge come la sala; il limite vale per chi viene da fuori, l'esterno in squadra.
    const ospite = (await chiama('/api/esterni-temporanei', { method: 'POST', token: admin, body: { nome: `Ospite ${suffisso}`, ente: 'VVF', squadra_id: sqB } })).corpo;
    if (ospite?.id) persone.push(ospite.id);
    const tokenOspite = (await chiama('/api/accesso-temporaneo', { method: 'POST', body: { codice: ospite?.codice } })).corpo?.token;
    await prendiVisione(BASE, tokenOspite);
    verifica("l'esterno della squadra la manda avanti", (await stato(tokenOspite, sqB, 'sul_posto')).stato === 200);
    verifica("l'esterno non cambia lo stato di un'altra squadra -> 403", (await stato(tokenOspite, sqA, 'sul_posto')).stato === 403);
    const indietroEsterno = await stato(tokenOspite, sqB, 'partita');
    verifica("dal campo non si torna indietro -> 409", indietroEsterno.stato === 409, `HTTP ${indietroEsterno.stato}`);
    verifica('può saltare uno stato (sul posto)', (await stato(alfa.token, sqA, 'sul_posto')).stato === 200);
    const indietro = await stato(alfa.token, sqA, 'partita');
    verifica('come interno può correggere anche all\'indietro (la sala)', indietro.stato === 200, `HTTP ${indietro.stato}`);
    verifica('uno stato inventato -> 400', (await stato(alfa.token, sqA, 'in_pausa')).stato === 400);
    verifica('lo stesso stato due volte -> 409', (await stato(alfa.token, sqA, 'partita')).stato === 409);
    const unOraFa = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dallaCoda = await stato(alfa.token, sqA, 'sul_posto', { quando: unOraFa });
    verifica("dalla coda senza rete registra l'ora del tocco (un'ora fa)", dallaCoda.stato === 200 && Math.abs(new Date(dallaCoda.corpo?.quando) - new Date(unOraFa)) < 1000, dallaCoda.corpo);
    const futuro = await stato(admin, sqA, 'conclusa', { quando: new Date(Date.now() + 3600 * 1000).toISOString() });
    verifica("un'ora nel futuro non si accetta: vale adesso", futuro.stato === 200 && Math.abs(new Date(futuro.corpo?.quando) - Date.now()) < 60000, futuro.corpo);

    const dettaglio = (await chiama(`/api/reports/${seg.id}`, { token: admin })).corpo;
    const note = (dettaglio?.updates || dettaglio?.report_updates || []).map(u => u.update_text || u.testo || '');
    const testoDiario = JSON.stringify(dettaglio);
    verifica('la nota di sistema compare nel diario', new RegExp(`${r1} sul posto`).test(testoDiario), note.slice(-3));
    const squadraNellaScheda = (dettaglio?.report?.assigned_teams || dettaglio?.assigned_teams || []).find(t => t.id === sqA);
    verifica('la scheda dice lo stato della squadra', squadraNellaScheda?.stato === 'conclusa', squadraNellaScheda);
    const barra = ((await chiama('/api/squadre', { token: admin })).corpo || []).find(s => s.id === sqA);
    verifica('la barra delle squadre dice lo stato', barra?.active_target_info?.stato === 'conclusa', barra?.active_target_info);

    await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    const resoconto = await chiama(`/api/admin/emergencies/${emergenza.id}/resoconto`, { token: admin });
    verifica('il resoconto ha i tempi della squadra e le durate', resoconto.stato === 200 && new RegExp(`Tempi ${r1}`).test(resoconto.corpo) && /arrivo in \d+ min/.test(resoconto.corpo),
        String(resoconto.corpo).split('\n').filter(r => /Tempi/.test(r)).join(' / ') || `HTTP ${resoconto.stato}`);
    aperta = null;
    const integrita = await chiama('/api/sistema/integrita', { token: admin });
    const toccate = JSON.stringify([integrita.corpo?.esempi_alterate, integrita.corpo?.esempi_mancanti]);
    if (integrita.stato === 200) verifica('gli stati entrano nello storico sigillato senza romperlo', integrita.corpo?.catena_rotta == null && !toccate.includes('stati_squadra'), integrita.corpo);
} finally {
    if (aperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    for (const s of squadre) await chiama(`/api/squadre/${s}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    for (const p of persone) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}

console.log(falliti === 0 ? '\nStato delle squadre: tutto a posto\n' : `\nStato delle squadre: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
