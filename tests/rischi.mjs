// tests/rischi.mjs
//
// I rischi di una segnalazione dalle zone di pericolo della mappa: una
// segnalazione creata o spostata dentro una zona di pericolo riceve la riga
// "⚠ …" nei rischi (e una nota di sistema nel diario), uscendo la perde, e una
// zona disegnata o tolta sopra segnalazioni già aperte le aggiorna. Il testo
// scritto a mano resta, e le zone che non sono di pericolo non contano.
//
// Apre e chiude un'emergenza di prova (che resta in archivio): va lanciata su
// un'istanza di collaudo senza emergenze in corso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/rischi.mjs

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
const attendi = (ms) => new Promise(r => setTimeout(r, ms));

console.log('\nRischi dalle zone di pericolo');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
if (stato?.emergency || stato?.active) {
    console.log('  (saltato: c\'è un\'emergenza in corso, la prova ne apre una sua)');
    process.exit(0);
}

const suffisso = Date.now().toString().slice(-5);
// Un quadrato attorno a (lat, lon) di lato 2·d gradi.
const quadrato = (lat, lon, d) => ({ type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });
// Una C: il quadrato senza la fascia destra centrale.
const ciC = (lat, lon, d) => ({ type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat - d / 3], [lon, lat - d / 3], [lon, lat + d / 3], [lon + d, lat + d / 3], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });
const LAT = 46.30, LON = 12.40;
const zone = [];
const zona = async (corpo) => {
    const r = await chiama('/api/mappa/elementi', { method: 'POST', token: admin, body: corpo });
    if (r.corpo?.id) zone.push(r.corpo.id);
    return r;
};
const dettaglio = async (id) => (await chiama(`/api/reports/${id}`, { token: admin })).corpo || {};
const rischi = async (id) => (await dettaglio(id)).report?.environmental_hazard || '';
const note = async (id) => ((await dettaglio(id)).updates || []).map(n => n.update_text);
const nuova = async (titolo, lat, lon) => (await chiama('/api/reports', { method: 'POST', token: admin, body: {
    title: titolo, reporter_name: 'Prova', reporter_contact: '000', ...(lat != null ? { latitude: lat, longitude: lon } : {})
} })).corpo;

let aperta = null;
try {
    aperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `RISCHI-${suffisso}`, name: 'Prova rischi dalle zone' } })).corpo?.emergency;
    verifica('emergenza di prova aperta', !!aperta?.id, aperta);

    const frana = await zona({ tipo: 'pericolo_frana', nome: `Borgo ${suffisso}`, livello: 'P2', geometria: quadrato(LAT, LON, 0.01) });
    verifica('zona di frana disegnata', frana.stato === 201 || frana.stato === 200, frana);
    await zona({ tipo: 'area_ammassamento', nome: `Campo ${suffisso}`, geometria: quadrato(LAT + 0.05, LON, 0.01) });
    await attendi(400);

    // Creata dentro la frana.
    const a = await nuova('Dentro la frana', LAT, LON);
    await attendi(600);
    const ra = await rischi(a.id);
    verifica('creata dentro: riga ⚠ con tipo, nome e livello', ra === `⚠ Pericolo frana: Borgo ${suffisso} (livello P2)`, ra);
    verifica('creata dentro: nota di sistema nel diario', (await note(a.id)).some(t => t.startsWith('Rischi aggiornati in automatico') && t.includes(`«Borgo ${suffisso}»`)), await note(a.id));

    // Creata in un'area che non è di pericolo: niente.
    const b = await nuova('Nel campo', LAT + 0.05, LON);
    await attendi(600);
    verifica('area non di pericolo: rischi vuoti', (await rischi(b.id)) === '', await rischi(b.id));

    // Testo scritto a mano e poi spostata fuori: resta solo quello scritto.
    await chiama(`/api/reports/${a.id}`, { method: 'PUT', token: admin, body: { environmental_hazard: `${ra}\nCavi elettrici a terra` } });
    await chiama(`/api/reports/${a.id}/coordinates`, { method: 'PUT', token: admin, body: { latitude: LAT + 0.2, longitude: LON } });
    await attendi(600);
    verifica('spostata fuori: resta il testo scritto a mano', (await rischi(a.id)) === 'Cavi elettrici a terra', await rischi(a.id));
    verifica('spostata fuori: nota di uscita', (await note(a.id)).some(t => t.includes('non è più in una zona di pericolo')), await note(a.id));

    // Rimessa dentro con la modifica della segnalazione: la riga torna sopra il testo.
    await chiama(`/api/reports/${a.id}`, { method: 'PUT', token: admin, body: { latitude: LAT + 0.001, longitude: LON + 0.001 } });
    await attendi(600);
    verifica('rimessa dentro dalla modifica: riga ⚠ in cima', (await rischi(a.id)) === `⚠ Pericolo frana: Borgo ${suffisso} (livello P2)\nCavi elettrici a terra`, await rischi(a.id));

    // Una zona nuova disegnata sopra una segnalazione già aperta (a forma di C).
    const c = await nuova('Prima della zona', LAT + 0.1, LON - 0.005);
    const d = await nuova('Nella bocca della C', LAT + 0.1, LON + 0.008);
    await attendi(500);
    verifica('prima della zona: rischi vuoti', (await rischi(c.id)) === '', await rischi(c.id));
    const alluvione = await zona({ tipo: 'pericolo_alluvione', nome: `Golena ${suffisso}`, geometria: ciC(LAT + 0.1, LON, 0.01) });
    await attendi(800);
    verifica('zona nuova sopra: rischi aggiornati', (await rischi(c.id)) === `⚠ Pericolo alluvione: Golena ${suffisso}`, await rischi(c.id));
    verifica('nella bocca della C: fuori dalla zona', (await rischi(d.id)) === '', await rischi(d.id));

    // Due zone sovrapposte: due righe.
    await zona({ tipo: 'pericolo_generico', nome: `Incendio ${suffisso}`, geometria: quadrato(LAT + 0.1, LON - 0.005, 0.002) });
    await attendi(800);
    verifica('due zone sovrapposte: due righe', (await rischi(c.id)).split('\n').length === 2 && (await rischi(c.id)).includes(`⚠ Zona di pericolo: Incendio ${suffisso}`), await rischi(c.id));

    // Zona tolta: la riga se ne va.
    await chiama(`/api/mappa/elementi/${alluvione.corpo.id}`, { method: 'DELETE', token: admin });
    await attendi(800);
    verifica('zona tolta: resta solo l\'altra', (await rischi(c.id)) === `⚠ Zona di pericolo: Incendio ${suffisso}`, await rischi(c.id));

    // Senza coordinate: niente da calcolare.
    const e = await nuova('Senza coordinate');
    await attendi(400);
    verifica('senza coordinate: rischi vuoti', (await rischi(e.id)) === '', await rischi(e.id));
} finally {
    for (const id of zone) await chiama(`/api/mappa/elementi/${id}`, { method: 'DELETE', token: admin });
    if (aperta?.id) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
}

console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
