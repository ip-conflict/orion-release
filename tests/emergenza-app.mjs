// tests/emergenza-app.mjs
//
// Nell'app l'emergenza la vede solo chi è in una squadra. All'apertura non
// parte nessun avviso a tutti: chi non è in squadra non riceve né la notifica
// né, sull'app, l'apertura dal WebSocket (il web sì). Entrato in squadra
// riceve "in_squadra" e il contesto gli dà l'emergenza; uscito, l'avviso
// scade e l'emergenza sparisce dall'app.
//
// Crea un volontario e una squadra; se non c'è un'emergenza aperta ne apre
// una e la chiude alla fine. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/emergenza-app.mjs

import 'dotenv/config';
import WebSocket from 'ws';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const attesa = ms => new Promise(r => setTimeout(r, ms));
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
function ascolta(token, app) {
    const ricevuti = [];
    const ws = new WebSocket(BASE.replace(/^http/, 'ws'), { headers: { Authorization: `Bearer ${token}`, ...(app ? { 'X-Orion-Client': 'app' } : {}) } });
    ws.on('message', m => ricevuti.push(JSON.parse(m)));
    return new Promise((ok, ko) => { ws.on('open', () => ok({ ws, ricevuti })); ws.on('error', ko); });
}

console.log("\nL'emergenza nell'app solo a chi è in squadra");
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
let emergenzaAperta = false, persona = null, squadra = null, nomeRadio = null, pronto = null, squadraPronta = null;
const connessioni = [];
const nomiLiberi = async () => {
    const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
    return ['Zulu', 'Yankee', 'X-ray', 'Whiskey', 'Victor', 'Uniform', 'Tango', 'Sierra', 'Romeo', 'Quebec', 'Papa', 'Oscar'].filter(x => !usati.has(x));
};
async function nuovoVolontario(nome) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `${nome}${suffisso}`, cognome: 'Prova', role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = `${nome}!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    return { id: n.id, username: n.username, token: (await accediConFetch(BASE, n.username, password)).token };
}
try {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `Squadra${suffisso}`, cognome: 'Prova', role: 'volontario' } })).corpo;
    persona = n.id;
    const q = new URL(n.magicLink).searchParams;
    const password = `Squadra!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const io = (await accediConFetch(BASE, n.username, password)).token;
    const coda = async () => (await chiama('/api/notifiche', { token: io })).corpo?.notifiche || [];
    const contesto = async () => (await chiama('/api/app/contesto', { token: io })).corpo;

    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (!stato?.active) {
        // Una squadra preparata prima: all'apertura entra nell'emergenza.
        pronto = await nuovoVolontario('Pronto');
        for (const nome_radio of await nomiLiberi()) {
            const r = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio, nome: 'Pronta', membri: [{ username: pronto.username }] } });
            if (r.stato === 201) { squadraPronta = { id: r.corpo.squadraId, nome_radio }; break; }
        }
        const prontoPrima = (await chiama('/api/notifiche', { token: pronto.token })).corpo?.notifiche || [];
        verifica("senza emergenza, entrare in squadra non manda avvisi", !prontoPrima.some(x => x.tipo === 'in_squadra'), prontoPrima);
        const appPronto = await ascolta(pronto.token, true);
        connessioni.push(appPronto.ws);
        const app = await ascolta(io, true);
        const web = await ascolta(io, false);
        connessioni.push(app.ws, web.ws);
        await attesa(300);
        const aperta = await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `SQ-${suffisso}`, name: 'Prova emergenza in app' } });
        emergenzaAperta = aperta.stato === 201;
        await attesa(800);
        const apertura = (l) => l.some(m => m.action === 'emergency_status_change' && m.status?.active);
        verifica("il web riceve l'apertura", apertura(web.ricevuti));
        verifica("l'app di chi non è in squadra non la riceve", !apertura(app.ricevuti), app.ricevuti.map(m => m.action));
        verifica('nessun avviso in coda', !(await coda()).some(x => x.categoria === 'emergenza'), await coda());
        verifica("l'app di chi è già in squadra riceve l'apertura", apertura(appPronto.ricevuti), appPronto.ricevuti.map(m => m.action));
        const prontoDopo = ((await chiama('/api/notifiche', { token: pronto.token })).corpo?.notifiche || []).find(x => x.tipo === 'in_squadra');
        verifica("e l'avviso della sua squadra", prontoDopo?.titolo === `Sei in squadra ${squadraPronta?.nome_radio}` && /SQ-/.test(prontoDopo?.testo || ''), prontoDopo);
    } else {
        console.log("  (un'emergenza era già aperta: l'apertura non si prova)");
    }

    const fuori = await contesto();
    verifica("fuori squadra l'app non ha l'emergenza", !fuori.capacita.includes('emergenza') && fuori.capacita.includes('io') && fuori.squadra === null, fuori.capacita);
    verifica('in emergenza la coda si controlla ogni 15 minuti anche fuori squadra', fuori.notifiche?.controllo_minuti === 15, fuori.notifiche);

    for (const nome_radio of await nomiLiberi()) {
        const r = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio, nome: 'Prova app', membri: [{ username: n.username }] } });
        if (r.stato === 201) { squadra = r.corpo.squadraId; nomeRadio = nome_radio; break; }
    }
    verifica('messo in squadra', !!squadra);
    let avviso = null;
    for (let i = 0; i < 20 && !avviso; i++) { await attesa(150); avviso = (await coda()).find(x => x.tipo === 'in_squadra'); }
    verifica('riceve l\'avviso di ingresso in squadra', avviso?.categoria === 'emergenza' && avviso.titolo === `Sei in squadra ${nomeRadio}` && avviso.riferimento_id === squadra && !!avviso.scade_il, avviso);
    const dentro = await contesto();
    verifica("in squadra l'app ha l'emergenza", dentro.capacita.includes('emergenza') && dentro.squadra?.id === squadra && !!dentro.emergenza, { c: dentro.capacita, s: dentro.squadra });

    await chiama(`/api/squadre/${squadra}`, { method: 'PUT', token: admin, body: { nome_radio: nomeRadio, nome: 'Prova app', membri: [] } });
    await attesa(300);
    verifica("uscito dalla squadra, l'avviso scade", !(await coda()).some(x => x.tipo === 'in_squadra'), await coda());
    const dopo = await contesto();
    verifica("e l'emergenza sparisce dall'app", !dopo.capacita.includes('emergenza'), dopo.capacita);
} finally {
    connessioni.forEach(w => w.close());
    if (squadra) await chiama(`/api/squadre/${squadra}`, { method: 'DELETE', token: admin });
    if (squadraPronta) await chiama(`/api/squadre/${squadraPronta.id}`, { method: 'DELETE', token: admin });
    if (pronto) await chiama(`/api/users/${pronto.id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    if (emergenzaAperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    if (persona) await chiama(`/api/users/${persona}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
