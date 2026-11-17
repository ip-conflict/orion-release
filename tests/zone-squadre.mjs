// La sala avvisata quando una squadra entra in una zona interdetta: una volta sola
// per ingresso, anche se il GPS balla sul bordo, e senza allarme se dentro la zona
// c'è l'intervento della squadra. Usa l'emergenza aperta o ne apre (e chiude) una sua.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/zone-squadre.mjs

import 'dotenv/config';
import { accediConFetch, prendiVisione } from './accesso-prova.mjs';
import { distanzaDalBordo, zoneAppenaEntrate } from '../src/zoneSquadre.js';

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
const quadrato = (lat, lon, d) => ({ type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });
// 0.001 gradi di latitudine sono circa 111 metri.
const LAT = 45.90, LON = 12.10;

console.log('\nIngressi nelle zone, senza server');
{
    const zona = { id: 1, geometria: quadrato(LAT, LON, 0.002) };
    const dentro = new Set();
    verifica('fuori: niente', zoneAppenaEntrate(dentro, [zona], LAT + 0.003, LON).length === 0);
    verifica('entrando: la zona', zoneAppenaEntrate(dentro, [zona], LAT, LON).length === 1);
    verifica('restando dentro: niente', zoneAppenaEntrate(dentro, [zona], LAT + 0.001, LON).length === 0);
    verifica('appena fuori dal bordo (10 m) non si è ancora usciti', zoneAppenaEntrate(dentro, [zona], LAT + 0.0021, LON).length === 0 && dentro.has(1));
    verifica('e rientrando non riscatta', zoneAppenaEntrate(dentro, [zona], LAT + 0.0019, LON).length === 0);
    zoneAppenaEntrate(dentro, [zona], LAT + 0.003, LON);
    verifica('lontani dal bordo si è usciti', !dentro.has(1));
    verifica('e rientrando riscatta', zoneAppenaEntrate(dentro, [zona], LAT, LON).length === 1);
    verifica('una zona tolta dalla mappa si dimentica', zoneAppenaEntrate(dentro, [], LAT, LON).length === 0 && !dentro.has(1));
    const d = distanzaDalBordo(zona.geometria, LAT + 0.003, LON);
    verifica('distanza dal bordo in metri', d > 100 && d < 125, d);
}

const ORION = process.env.ORION_ADMIN_PASSWORD;
if (!ORION) {
    console.log('  (la parte col server serve ORION_ADMIN_PASSWORD)');
    process.exit(falliti ? 1 : 0);
}

console.log('\nAvvisi alla sala');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', ORION)).token;
const suffisso = Date.now().toString().slice(-5);
let stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
let aperta = null;
if (!stato?.active) {
    aperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `ZONE-${suffisso}`, name: 'Prova zone interdette' } })).corpo?.emergency;
    stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
}
const emergenza = stato?.emergency?.id ?? aperta?.id;
const elementi = [];
const squadre = [];
const assegnazioni = [];
try {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Zona', cognome: `Prova${suffisso}`, role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = `Argine!${suffisso}Ponte7`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const volontario = (await chiama('/login', { method: 'POST', body: { username: n.username, password } })).corpo.token;
    await prendiVisione(BASE, volontario);

    async function nuovaSquadra() {
        for (const nome of ['Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray']) {
            const r = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: nome, nome: 'Prova zone', caposquadra: n.username, membri: [{ username: n.username }] } });
            if (r.stato === 201) { squadre.push(r.corpo.squadraId); return { id: r.corpo.squadraId, nome }; }
        }
        throw new Error('Nessun nome radio libero per la squadra di prova.');
    }
    const zona = (await chiama('/api/mappa/elementi', { method: 'POST', token: admin, body: { tipo: 'zona_interdetta', nome: `Argine ${suffisso}`, geometria: quadrato(LAT, LON, 0.002) } })).corpo;
    elementi.push(zona.id);
    const diario = async () => ((await chiama(`/api/emergencies/${emergenza}/eventi?limit=50`, { token: admin })).corpo || [])
        .filter(e => e.tipo === 'sala' && e.testo.includes(`Argine ${suffisso}`)).map(e => e.testo);

    const s = await nuovaSquadra();
    const posizione = (lat, lon) => chiama('/api/location', { method: 'POST', token: volontario, body: { squadra_id: s.id, latitude: lat, longitude: lon } });
    await posizione(LAT + 0.004, LON);
    await posizione(LAT, LON);
    await attendi(500);
    let righe = await diario();
    verifica('entrando, una riga nel diario di sala', righe.length === 1 && righe[0] === `La squadra ${s.nome} è entrata nella zona interdetta «Argine ${suffisso}».`, righe);
    await posizione(LAT + 0.0005, LON);
    await posizione(LAT + 0.00205, LON);
    await posizione(LAT + 0.0019, LON);
    await attendi(500);
    verifica('girando dentro e sul bordo nessuna riga in più', (await diario()).length === 1, await diario());
    await posizione(LAT + 0.004, LON);
    await posizione(LAT, LON);
    await attendi(500);
    verifica('uscita e rientrata: un secondo avviso', (await diario()).length === 2, await diario());
    const vecchia = await chiama('/api/location', { method: 'POST', token: volontario, body: { squadra_id: s.id, latitude: LAT + 0.004, longitude: LON, eta_ms: 1000 } });
    await chiama('/api/location', { method: 'POST', token: volontario, body: { squadra_id: s.id, latitude: LAT, longitude: LON, eta_ms: 600_000 } });
    await attendi(500);
    verifica('una posizione di dieci minuti fa arrivata adesso non è un ingresso', vecchia.stato === 200 && (await diario()).length === 2, await diario());

    await chiama(`/api/squadre/${s.id}`, { method: 'DELETE', token: admin });
    const t = await nuovaSquadra();
    const report = (await chiama('/api/reports', { method: 'POST', token: admin, body: { title: 'Dentro la zona', reporter_name: 'Prova', reporter_contact: '000', latitude: LAT, longitude: LON + 0.001 } })).corpo;
    await chiama(`/api/reports/${report.id}/teams`, { method: 'POST', token: admin, body: { teamId: t.id } });
    assegnazioni.push([report.id, t.id]);
    await chiama('/api/location', { method: 'POST', token: volontario, body: { squadra_id: t.id, latitude: LAT, longitude: LON } });
    await attendi(500);
    righe = await diario();
    verifica('con l\'intervento dentro la zona il diario lo dice', righe.some(r => r.startsWith(`La squadra ${t.nome} è entrata`) && r.includes('dove si trova l\'intervento n.')), righe);
} finally {
    for (const [r, sq] of assegnazioni) await chiama(`/api/reports/${r}/teams/${sq}`, { method: 'DELETE', token: admin });
    for (const id of elementi) await chiama(`/api/mappa/elementi/${id}`, { method: 'DELETE', token: admin });
    for (const id of squadre) await chiama(`/api/squadre/${id}`, { method: 'DELETE', token: admin });
    if (aperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
}

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutto bene.');
process.exit(falliti ? 1 : 0);
