// tests/avvisi.mjs
//
// Il token degli avvisi: il telefono lo chiede con la sessione e poi, anche
// a sessione finita, legge le sue notifiche e resta in ascolto. Non apre
// nient'altro, dal collegamento passano solo le sue notifiche, e smette di
// valere quando lo si restituisce, quando si chiudono le sessioni o quando
// la persona viene sospesa.
//
// Crea un volontario. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/avvisi.mjs

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
const chiama = async (percorso, { method = 'GET', body, token, avvisi } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(avvisi ? { Authorization: `Avvisi ${avvisi}` } : {})
        }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
function ascolta(intestazione) {
    const ricevuti = [];
    const ws = new WebSocket(BASE.replace(/^http/, 'ws'), { headers: { Authorization: intestazione, 'X-Orion-Client': 'app' } });
    ws.on('message', m => ricevuti.push(JSON.parse(m)));
    return new Promise((ok) => {
        ws.on('open', () => ok({ ws, ricevuti, aperto: true }));
        ws.on('unexpected-response', (_, risposta) => ok({ ws, ricevuti, aperto: false, stato: risposta.statusCode }));
        ws.on('error', () => ok({ ws, ricevuti, aperto: false }));
    });
}

console.log('\nIl token degli avvisi');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
let persona = null, squadra = null;
const connessioni = [];
try {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `Avvisi${suffisso}`, cognome: 'Prova', role: 'volontario' } })).corpo;
    persona = n.id;
    const q = new URL(n.magicLink).searchParams;
    const password = `Avvisi!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const sessione = (await accediConFetch(BASE, n.username, password)).token;

    const creato = await chiama('/api/app/avvisi', { method: 'POST', token: sessione, body: { dispositivo: 'Telefono di prova' } });
    const avvisi = creato.corpo?.avvisi;
    verifica('il telefono riceve il suo token', creato.stato === 201 && typeof avvisi === 'string' && avvisi.length >= 40 && creato.corpo.giorni > 30, creato);

    const coda = await chiama('/api/avvisi/notifiche', { avvisi });
    verifica('col token legge la sua coda', coda.stato === 200 && Array.isArray(coda.corpo?.notifiche), coda);
    const falso = await chiama('/api/avvisi/notifiche', { avvisi: 'x'.repeat(43) });
    verifica('un token inventato -> 401, senza chiudere la sessione', falso.stato === 401 && falso.corpo?.avvisi_revocati === true && !falso.corpo?.sessione_terminata, falso);
    const conSessione = await chiama('/api/avvisi/notifiche', { token: sessione });
    verifica('la sessione non basta: serve il token degli avvisi', conSessione.stato === 401, conSessione);
    const altrove = await chiama('/api/notifiche', { avvisi });
    verifica('il token non apre le altre rotte', altrove.stato === 401 || altrove.stato === 403, altrove);
    const altrove2 = await chiama('/api/app/contesto', { avvisi });
    verifica('nemmeno il contesto', altrove2.stato === 401 || altrove2.stato === 403, altrove2);

    const telefono = await ascolta(`Avvisi ${avvisi}`);
    connessioni.push(telefono.ws);
    verifica('il telefono resta in ascolto col token', telefono.aperto);
    const intruso = await ascolta(`Avvisi ${'y'.repeat(43)}`);
    verifica('con un token inventato il collegamento è rifiutato', !intruso.aperto && intruso.stato === 401, intruso.stato);
    await attesa(200);
    const stato = await chiama('/api/app/avvisi/stato', { token: sessione });
    verifica('il server lo vede collegato', stato.corpo?.collegato === true && stato.corpo?.telefoni === 1, stato.corpo);
    const telefoni = await chiama('/api/avvisi/telefoni', { token: admin });
    verifica('e lo dice anche alla sala', telefoni.corpo?.telefoni?.[persona]?.collegato === true, telefoni.corpo?.telefoni?.[persona]);

    const prova = await chiama('/api/notifiche/prova', { method: 'POST', token: sessione, body: { ritardo: 1 } });
    verifica('la prova parte con un ritardo', prova.stato === 202 && prova.corpo?.ritardo === 1, prova);
    const doppia = await chiama('/api/notifiche/prova', { method: 'POST', token: sessione, body: {} });
    verifica('una seconda prova mentre la prima è in arrivo -> 409', doppia.stato === 409, doppia);
    // Qualcosa che va a tutti: al telefono non deve arrivare.
    const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
    for (const nome_radio of ['Zulu', 'Yankee', 'X-ray', 'Whiskey', 'Victor', 'Uniform', 'Tango'].filter(x => !usati.has(x))) {
        const r = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio, nome: 'Prova avvisi', membri: [] } });
        if (r.stato === 201) { squadra = r.corpo.squadraId; break; }
    }
    await attesa(1800);
    const arrivata = telefono.ricevuti.find(m => m.action === 'notifica' && m.notifica?.tipo === 'prova');
    verifica('la prova arriva dal collegamento degli avvisi', !!arrivata && arrivata.notifica.categoria === 'personale', telefono.ricevuti);
    verifica('dal collegamento passano solo le notifiche', telefono.ricevuti.every(m => m.action === 'notifica'), telefono.ricevuti.map(m => m.action));

    // La sessione finisce (qui con l'uscita): gli avvisi no.
    await chiama('/logout', { method: 'POST', token: sessione });
    const dopoUscita = await chiama('/api/avvisi/notifiche', { avvisi });
    verifica('finita la sessione, il token degli avvisi vale ancora', dopoUscita.stato === 200 && dopoUscita.corpo.notifiche.some(x => x.tipo === 'prova'), dopoUscita.stato);

    // Restituito, non vale più.
    const sessione2 = (await accediConFetch(BASE, n.username, password)).token;
    const secondo = (await chiama('/api/app/avvisi', { method: 'POST', token: sessione2, body: { precedente: avvisi } })).corpo?.avvisi;
    verifica('chiedendone uno nuovo, il precedente smette di valere',
        (await chiama('/api/avvisi/notifiche', { avvisi })).stato === 401 && (await chiama('/api/avvisi/notifiche', { avvisi: secondo })).stato === 200);
    await chiama('/api/app/avvisi', { method: 'DELETE', token: sessione2, body: { avvisi: secondo } });
    verifica('restituito, non vale più', (await chiama('/api/avvisi/notifiche', { avvisi: secondo })).stato === 401);

    // Sospesa la persona, nemmeno.
    const terzo = (await chiama('/api/app/avvisi', { method: 'POST', token: sessione2, body: {} })).corpo?.avvisi;
    await chiama(`/api/admin/users/${persona}/toggle-status`, { method: 'PATCH', token: admin });
    verifica('sospesa la persona, non vale più', (await chiama('/api/avvisi/notifiche', { avvisi: terzo })).stato === 401);
    await chiama(`/api/admin/users/${persona}/toggle-status`, { method: 'PATCH', token: admin });
    verifica('riattivata, torna a valere', (await chiama('/api/avvisi/notifiche', { avvisi: terzo })).stato === 200);
} finally {
    connessioni.forEach(w => w.close());
    if (squadra) await chiama(`/api/squadre/${squadra}`, { method: 'DELETE', token: admin });
    if (persona) await chiama(`/api/users/${persona}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
