// tests/letture.mjs
//
// Le letture delle segnalazioni tenute dal server: fin dove una persona ha
// letto, quante voci di altri sono arrivate dopo e quante sono "forti" (note
// scritte da una persona, foto). Le proprie voci non contano; segnare la
// lettura azzera; un'ora nel futuro non va oltre adesso.
//
// Crea un volontario e una segnalazione; se non c'è un'emergenza aperta ne
// apre una e la chiude alla fine. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/letture.mjs

import 'dotenv/config';
import { accediConFetch } from './accesso-prova.mjs';

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
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};

console.log('\nLetture delle segnalazioni');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
let emergenzaAperta = null, persona = null;
try {
    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (!(stato?.emergency || stato?.active)) {
        emergenzaAperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `LETT-${suffisso}`, name: 'Prova letture' } })).corpo?.emergency;
    }
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `Lettura${suffisso}`, cognome: 'Prova', role: 'volontario' } })).corpo;
    persona = n.id;
    const q = new URL(n.magicLink).searchParams;
    const password = `Lettura!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const io = (await accediConFetch(BASE, n.username, password)).token;

    const titolo = `Prova letture ${suffisso}`;
    await chiama('/api/reports', { method: 'POST', token: admin, body: { title: titolo, priority: 'Medium' } });
    const id = ((await chiama('/api/reports?limit=200', { token: admin })).corpo?.reports || []).find(r => r.title === titolo)?.id;
    const mia = async () => ((await chiama('/api/letture', { token: io })).corpo?.letture || []).find(l => l.report_id === id);

    verifica('mai aperta: nessuna lettura', !(await mia()));
    const segna = await chiama(`/api/letture/${id}`, { method: 'PUT', token: io, body: { letta_il: new Date().toISOString() } });
    verifica('aprirla segna la lettura', segna.stato === 204 && (await mia())?.non_lette === 0, await mia());

    await new Promise(r => setTimeout(r, 30));
    await chiama(`/api/reports/${id}/updates`, { method: 'POST', token: admin, body: { update_text: `Sul posto ${suffisso}` } });
    await chiama(`/api/reports/${id}`, { method: 'PUT', token: admin, body: { priority: 'Low' } });
    await chiama(`/api/reports/${id}/updates`, { method: 'POST', token: io, body: { update_text: 'La mia nota' } });
    const dopo = await mia();
    verifica('contano le voci degli altri, non le mie', dopo?.non_lette === 2, dopo);
    verifica('forte è solo la nota scritta da una persona', dopo?.forti === 1, dopo);

    await chiama(`/api/letture/${id}`, { method: 'PUT', token: io, body: { letta_il: new Date(Date.now() + 3600e3).toISOString() } });
    const letta = await mia();
    verifica('segnata di nuovo, azzera; il futuro non va oltre adesso', letta?.non_lette === 0 && new Date(letta.letta_il) <= new Date(), letta);
    await chiama(`/api/letture/${id}`, { method: 'PUT', token: io, body: { letta_il: '2000-01-01T00:00:00Z' } });
    verifica('una lettura più vecchia non torna indietro', (await mia())?.non_lette === 0);

    await chiama(`/api/reports/${id}`, { method: 'PUT', token: admin, body: { status: 'Closed' } });
} finally {
    if (persona) await chiama(`/api/users/${persona}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    if (emergenzaAperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
