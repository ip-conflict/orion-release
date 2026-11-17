// Il numero progressivo delle segnalazioni dentro un'emergenza non si ripete, anche con tante creazioni insieme.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/numeri-segnalazioni.mjs

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

console.log('\nNumeri delle segnalazioni');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;

let aperta = null;
const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
if (!stato?.active) {
    const r = await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `NUMERI-${Date.now().toString().slice(-6)}` } });
    verifica("si apre un'emergenza di prova", r.stato === 201, r.corpo);
    aperta = r.corpo?.emergency?.id ?? null;
}

async function insieme(quante) {
    const risposte = await Promise.all(Array.from({ length: quante }, (_, i) =>
        chiama('/api/reports', { method: 'POST', token: admin, body: { title: `Numeri ${quante}/${i + 1}` } })));
    const create = risposte.filter(r => r.stato === 201).map(r => r.corpo.emergency_report_number);
    verifica(`${quante} segnalazioni create insieme rispondono tutte 201`, create.length === quante, risposte.map(r => r.stato));
    const ordinati = [...create].sort((a, b) => a - b);
    verifica(`i ${quante} numeri sono tutti diversi`, new Set(create).size === create.length, ordinati);
    verifica(`i ${quante} numeri sono consecutivi`, ordinati.every((n, i) => i === 0 || n === ordinati[i - 1] + 1), ordinati);
}

try {
    await insieme(10);
    await insieme(20);
} finally {
    if (aperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
}

console.log(`\nNumeri delle segnalazioni: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
