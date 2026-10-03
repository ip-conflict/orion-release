// tests/websocket-app.mjs
//
// Il web riceve tutto; l'app (X-Orion-Client: app) solo quello che riguarda
// chi la usa. Lo stesso volontario si collega due volte, come web e come app,
// e si guarda chi riceve cosa.
//
// USO: ORION_URL=... ORION_ADMIN_PASSWORD=... ORION_VOLONTARIO=mbianchi \
//      ORION_VOLONTARIO_PASSWORD=... npm run test:websocket
//
// Serve un'emergenza aperta. Crea due segnalazioni e una squadra di prova:
// va eseguito su un'istanza di collaudo.

import WebSocket from 'ws';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const WS = BASE.replace(/^http/, 'ws');
const VOLONTARIO = process.env.ORION_VOLONTARIO || 'mbianchi';
const attesa = ms => new Promise(r => setTimeout(r, ms));
let falliti = 0;
const verifica = (descrizione, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descrizione}${ok ? '' : ` -> ${dettaglio}`}`);
    if (!ok) falliti++;
};

async function accedi(username, password) {
    const r = await fetch(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return (await r.json()).token;
}
async function api(token, percorso, opzioni = {}) {
    const r = await fetch(BASE + percorso, {
        ...opzioni,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: opzioni.body ? JSON.stringify(opzioni.body) : undefined
    });
    let corpo = null;
    try { corpo = await r.json(); } catch { /* vuoto */ }
    return { stato: r.status, corpo };
}
function ascolta(token, app) {
    const ricevuti = [];
    const ws = new WebSocket(WS, { headers: { Authorization: `Bearer ${token}`, ...(app ? { 'X-Orion-Client': 'app' } : {}) } });
    ws.on('message', m => ricevuti.push(JSON.parse(m)));
    return new Promise((ok, ko) => { ws.on('open', () => ok({ ws, ricevuti })); ws.on('error', ko); });
}
const riguarda = (m, id) => [m.reportId, m.createdReportId, m.updatedReportId, m.deletedReportId].includes(id);

const admin = await accedi(process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD);
const volontario = await accedi(VOLONTARIO, process.env.ORION_VOLONTARIO_PASSWORD || process.env.ORION_ADMIN_PASSWORD);
if (!admin || !volontario) { console.error('Accesso non riuscito.'); process.exit(2); }
if (!(await api(admin, '/api/emergencies/status')).corpo?.active) { console.error('Serve un\'emergenza aperta.'); process.exit(2); }

const web = await ascolta(volontario, false);
const app = await ascolta(volontario, true);
await attesa(300);

const nuova = async titolo => (await api(admin, '/api/reports', {
    method: 'POST', body: { title: titolo, reporter_name: 'Collaudo', reporter_contact: '000', priority: 'Low' }
})).corpo?.id;
const mia = await nuova('Collaudo WebSocket: della squadra');
const altrui = await nuova('Collaudo WebSocket: di nessuno');

let squadra = null;
for (const nome_radio of ['Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo']) {
    const r = await api(admin, '/api/squadre', { method: 'POST', body: { nome_radio, nome: 'Collaudo WebSocket', membri: [{ username: VOLONTARIO }] } });
    if (r.stato === 201) { squadra = r.corpo.squadraId; break; }
}
if (!mia || !altrui || !squadra) { console.error('Preparazione non riuscita (il volontario e\' gia\' in una squadra?).'); process.exit(2); }

await api(admin, `/api/reports/${altrui}/updates`, { method: 'POST', body: { update_text: 'nota altrui' } });
await api(admin, `/api/reports/${mia}/teams`, { method: 'POST', body: { teamId: squadra } });
await api(admin, `/api/reports/${mia}/updates`, { method: 'POST', body: { update_text: 'nota della squadra' } });
await api(volontario, '/api/location', { method: 'POST', body: { squadra_id: squadra, latitude: 46.1, longitude: 12.2 } });
await api(admin, `/api/reports/${mia}/teams/${squadra}`, { method: 'DELETE' });
await api(admin, `/api/reports/${mia}/updates`, { method: 'POST', body: { update_text: 'dopo la rimozione' } });
await attesa(800);

console.log('\nWebSocket: web e app');
verifica('il web riceve la segnalazione di nessuno', web.ricevuti.some(m => riguarda(m, altrui)));
verifica('il web riceve le posizioni delle squadre', web.ricevuti.some(m => m.action === 'team_location_update'));
verifica('l\'app non riceve la segnalazione di nessuno', !app.ricevuti.some(m => riguarda(m, altrui)));
verifica('l\'app non riceve le posizioni delle squadre', !app.ricevuti.some(m => m.action === 'team_location_update'));
verifica('l\'app riceve l\'assegnazione alla sua squadra',
    app.ricevuti.some(m => m.action === 'reload_reports' && riguarda(m, mia)));
verifica('l\'app riceve le note dell\'intervento della squadra',
    app.ricevuti.some(m => m.action === 'new_report_update' && m.update?.update_text === 'nota della squadra'));
verifica('l\'app sa anche quando la squadra viene tolta',
    app.ricevuti.some(m => m.action === 'new_report_update' && m.update?.update_text === 'dopo la rimozione'));
verifica('l\'app riceve i cambi delle squadre', app.ricevuti.some(m => m.action === 'reload_squadre'));

await api(admin, `/api/squadre/${squadra}`, { method: 'DELETE' });
web.ws.close();
app.ws.close();
console.log(`\nWebSocket: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
