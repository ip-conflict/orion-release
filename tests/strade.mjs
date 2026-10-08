// tests/strade.mjs
//
// Strade chiuse e zone interdette oltre l'emergenza: alla chiusura restano
// sulla mappa quelle indicate, le altre finiscono con l'emergenza; quelle
// rimaste si riaprono anche senza emergenza aperta, e il resoconto lo dice.
// Le zone di pericolo e gli elementi del piano non si segnano.
//
// Apre e chiude un'emergenza di prova (che resta in archivio): va lanciata su
// un'istanza di collaudo senza emergenze in corso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/strade.mjs

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
    const tipo = r.headers.get('content-type') || '';
    return { stato: r.status, corpo: tipo.includes('json') ? await r.json().catch(() => null) : await r.text() };
};

console.log('\nStrade chiuse oltre l\'emergenza');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
if (stato?.emergency || stato?.active) {
    console.log('  (saltato: c\'è un\'emergenza in corso, la prova ne apre una sua)');
    process.exit(0);
}
const suffisso = Date.now().toString().slice(-5);
const linea = (d) => ({ type: 'LineString', coordinates: [[12.40 + d, 46.30], [12.41 + d, 46.31]] });
const quadrato = { type: 'Polygon', coordinates: [[[12.5, 46.3], [12.51, 46.3], [12.51, 46.31], [12.5, 46.31], [12.5, 46.3]]] };
const daTogliere = [];
let aperta = null;
try {
    aperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `STRADE-${suffisso}`, name: 'Prova strade' } })).corpo?.emergency;
    const nuova = async (corpo) => (await chiama('/api/mappa/elementi', { method: 'POST', token: admin, body: corpo })).corpo;
    const frana = await nuova({ tipo: 'strada_chiusa', nome: `Via della Frana ${suffisso}`, geometria: linea(0) });
    const piena = await nuova({ tipo: 'strada_chiusa', nome: `Via del Ponte ${suffisso}`, geometria: linea(0.02) });
    const zona = await nuova({ tipo: 'zona_interdetta', nome: `Cantiere ${suffisso}`, geometria: quadrato });
    const pericolo = await nuova({ tipo: 'pericolo_generico', nome: `Incendio ${suffisso}`, geometria: quadrato });
    verifica('elementi disegnati', [frana, piena, zona, pericolo].every(x => x?.id), [frana, piena, zona, pericolo]);

    const segnaPericolo = await chiama(`/api/mappa/elementi/${pericolo.id}`, { method: 'PUT', token: admin, body: { oltre_emergenza: true } });
    verifica('una zona di pericolo non resta dopo l\'emergenza -> 400', segnaPericolo.stato === 400, segnaPericolo);
    const segnata = await chiama(`/api/mappa/elementi/${zona.id}`, { method: 'PUT', token: admin, body: { oltre_emergenza: true } });
    verifica('una zona interdetta si segna durante l\'emergenza', segnata.stato === 200 && segnata.corpo?.oltre_emergenza === true, segnata);

    // Alla chiusura si tiene solo la frana: la zona segnata prima si sgancia,
    // perché l'elenco della chiusura è quello che vale.
    const chiusa = await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: { tieni_in_vigore: [frana.id] } });
    verifica('emergenza chiusa', chiusa.stato === 200, chiusa);
    aperta = null;
    const dopo = (await chiama('/api/mappa/elementi', { token: admin })).corpo;
    const ids = (dopo?.emergenza || []).map(m => m.id);
    verifica('dopo la chiusura sulla mappa resta solo la strada tenuta', ids.includes(frana.id) && !ids.includes(piena.id) && !ids.includes(zona.id), ids);
    verifica('e non è fra gli elementi del piano', !(dopo?.piano || []).some(m => m.id === frana.id));

    const resoconto = await fetch(`${BASE}/api/admin/emergencies/${segnata.corpo?.emergency_id}/resoconto`, { headers: { Authorization: `Bearer ${admin}` } });
    const testo = await resoconto.text();
    verifica('il resoconto dice che resta in vigore dopo la chiusura', testo.includes('resta in vigore dopo la chiusura'), testo.slice(0, 200));

    const modifica = await chiama(`/api/mappa/elementi/${frana.id}`, { method: 'PUT', token: admin, body: { note: 'Frana sul versante, riapertura prevista a marzo' } });
    verifica('si aggiorna anche senza emergenza aperta', modifica.stato === 200, modifica);
    const riaperta = await chiama(`/api/mappa/elementi/${frana.id}`, { method: 'DELETE', token: admin });
    verifica('e si riapre quando riapre davvero', riaperta.stato === 200 && riaperta.corpo?.message === 'Strada riaperta.', riaperta);
    const finale = (await chiama('/api/mappa/elementi', { token: admin })).corpo;
    verifica('riaperta, sparisce dalla mappa', !(finale?.emergenza || []).some(m => m.id === frana.id));

    const piano = await nuova({ tipo: 'strada_chiusa', nome: `Piano ${suffisso}`, geometria: linea(0.04), piano: true });
    if (piano?.id) daTogliere.push(piano.id);
    const segnaPiano = await chiama(`/api/mappa/elementi/${piano?.id}`, { method: 'PUT', token: admin, body: { oltre_emergenza: true } });
    verifica('un elemento del piano non si segna -> 400', segnaPiano.stato === 400, segnaPiano);
} finally {
    for (const id of daTogliere) await chiama(`/api/mappa/elementi/${id}`, { method: 'DELETE', token: admin });
    if (aperta?.id) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
