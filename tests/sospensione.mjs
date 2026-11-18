// Una sospensione chiude tutte le vie d'ingresso della persona, e nessuno sospende se stesso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/sospensione.mjs
// Crea ed elimina un volontario; aspetta il controllo periodico dei collegamenti, un minuto o ORION_CONTROLLO_COLLEGAMENTI_MS del server.

import WebSocket from 'ws';
import { accediConFetch, prendiVisione } from './accesso-prova.mjs';

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

function collega(autorizzazione) {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws'), { headers: { Authorization: autorizzazione } });
    const esito = { aperto: false, chiuso: null, rifiutato: null };
    esito.pronto = new Promise(risolvi => {
        ws.on('open', () => { esito.aperto = true; risolvi(); });
        ws.on('unexpected-response', (_, r) => { esito.rifiutato = r.statusCode; risolvi(); });
        ws.on('error', () => risolvi());
    });
    ws.on('close', (codice) => { esito.chiuso = { codice, dopoMs: Date.now() - (esito.da || Date.now()) }; });
    esito.ws = ws;
    return esito;
}
async function chiusoEntro(collegamento, ms) {
    const fine = Date.now() + ms;
    while (Date.now() < fine && !collegamento.chiuso) await attesa(100);
    return collegamento.chiuso;
}

console.log('\nSospensione');
const accessoAdmin = await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD);
const admin = accessoAdmin.token;
const suffisso = Date.now().toString().slice(-5);
const password = `Sospeso!${suffisso}Lanterna1`;
let volontario = null;

async function accediVolontario() {
    const r = await chiama('/login', { method: 'POST', body: { username: volontario.username, password } });
    if (r.stato === 200) await prendiVisione(BASE, r.corpo.token);
    return r;
}

try {
    const sestesso = await chiama(`/api/admin/users/${accessoAdmin.userId}/toggle-status`, { method: 'PATCH', token: admin });
    verifica("l'amministratore non sospende se stesso -> 403", sestesso.stato === 403, `HTTP ${sestesso.stato}`);
    verifica('e resta dentro', (await chiama('/api/users', { token: admin })).stato === 200);

    const nuovo = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Sergio', cognome: `Sospeso${suffisso}`, role: 'volontario' } })).corpo;
    const q = new URL(nuovo.magicLink).searchParams;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    volontario = { id: nuovo.id, username: nuovo.username };

    const token = (await accediVolontario()).corpo.token;
    const rinnovo = (await chiama('/api/app/rinnovo', { method: 'POST', token, body: { dispositivo: 'prova' } })).corpo?.rinnovo;
    const avvisi = (await chiama('/api/app/avvisi', { method: 'POST', token, body: { dispositivo: 'prova' } })).corpo?.avvisi;
    verifica('il volontario ha un token di rinnovo e uno degli avvisi', !!rinnovo && !!avvisi);

    const sessione = collega(`Bearer ${token}`);
    const telefono = collega(`Avvisi ${avvisi}`);
    await Promise.all([sessione.pronto, telefono.pronto]);
    verifica('i due collegamenti in tempo reale si aprono', sessione.aperto && telefono.aperto, { sessione: sessione.rifiutato, telefono: telefono.rifiutato });

    sessione.da = telefono.da = Date.now();
    const sospeso = await chiama(`/api/admin/users/${volontario.id}/toggle-status`, { method: 'PATCH', token: admin });
    verifica('il volontario viene sospeso', sospeso.stato === 200 && sospeso.corpo?.user?.is_active === false, sospeso.corpo);
    const chiusoSessione = await chiusoEntro(sessione, 2000);
    const chiusoTelefono = await chiusoEntro(telefono, 2000);
    verifica('il collegamento della sessione si chiude entro due secondi', chiusoSessione?.codice === 4001, chiusoSessione);
    verifica('anche quello degli avvisi', chiusoTelefono?.codice === 4001, chiusoTelefono);
    const conRinnovo = await chiama('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo } });
    verifica('il token di rinnovo non fa più entrare', conRinnovo.stato !== 200, `HTTP ${conRinnovo.stato}`);
    const diNuovo = collega(`Avvisi ${avvisi}`);
    await diNuovo.pronto;
    verifica('il token degli avvisi non apre più il collegamento', !diNuovo.aperto && diNuovo.rifiutato === 401, diNuovo.rifiutato);
    diNuovo.ws.terminate();
    verifica('con la password non entra', (await accediVolontario()).stato !== 200);

    const riattivato = await chiama(`/api/admin/users/${volontario.id}/toggle-status`, { method: 'PATCH', token: admin });
    verifica('riattivato, rientra con la password', riattivato.corpo?.user?.is_active === true && (await accediVolontario()).stato === 200);

    const tokenNuovo = (await accediVolontario()).corpo.token;
    const dopoUscita = collega(`Bearer ${tokenNuovo}`);
    await dopoUscita.pronto;
    dopoUscita.da = Date.now();
    verifica("l'uscita risponde", (await chiama('/logout', { method: 'POST', token: tokenNuovo })).stato === 200);
    // Lo chiude il controllo periodico del server: un minuto, o quello di ORION_CONTROLLO_COLLEGAMENTI_MS se lo si è accorciato.
    const controllo = parseInt(process.env.ORION_CONTROLLO_COLLEGAMENTI_MS, 10) || 60000;
    const chiusoDopoUscita = await chiusoEntro(dopoUscita, controllo + 10000);
    verifica("dopo l'uscita il collegamento si chiude al controllo successivo", chiusoDopoUscita?.codice === 4001, chiusoDopoUscita);
} finally {
    if (volontario) await chiama(`/api/users/${volontario.id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}

console.log(falliti === 0 ? '\nSospensione: tutto a posto\n' : `\nSospensione: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
