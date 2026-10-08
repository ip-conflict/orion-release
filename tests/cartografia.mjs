// tests/cartografia.mjs
//
// La cartografia del territorio sul server: un MBTiles costruito qui (tre
// tasselli PNG) arriva a pezzi, un pezzo rimandato non si somma due volte,
// un pezzo fuori ordine è rifiutato; i tasselli si leggono con la riga
// girata (TMS -> XYZ), quelli che mancano danno 404, senza accesso 401; un
// file che non è un MBTiles, o a tasselli vettoriali, è rifiutato con un
// messaggio chiaro; i tasselli non consumano il limite di richieste; si
// toglie.
//
// Se sull'istanza c'è già una cartografia caricata la prova non la tocca.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/cartografia.mjs

import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};

console.log('\nCartografia del territorio');
let sqlite;
try { sqlite = await import('node:sqlite'); } catch {
    console.log('  (saltato: questo Node non ha node:sqlite)');
    process.exit(0);
}
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const auth = { Authorization: `Bearer ${admin}` };
const json = async (percorso, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + percorso, { method, headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const pezzo = async (dati, n, id) => {
    const q = new URLSearchParams({ n: String(n) });
    if (id) q.set('id', id);
    const r = await fetch(`${BASE}/api/mappa/cartografia/pezzi?${q}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: dati });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
async function carica(buffer, nome, taglio = Math.ceil(buffer.length / 2)) {
    const parti = [];
    for (let i = 0; i < buffer.length; i += taglio) parti.push(buffer.subarray(i, i + taglio));
    let id = null;
    for (const [n, p] of parti.entries()) {
        const r = await pezzo(p, n, id);
        if (r.stato !== 200) return r;
        id = r.corpo.id;
    }
    return json('/api/mappa/cartografia/fine', { method: 'POST', body: { id, byte: buffer.length, nome } });
}

// Un PNG da 1x1 (rosso) e uno da 1x1 (blu): basta che siano diversi.
const PNG_ROSSO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const PNG_BLU = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-carto-'));
function mbtiles(nome, formato, tasselli) {
    const file = path.join(cartella, nome);
    const db = new sqlite.DatabaseSync(file);
    db.exec('CREATE TABLE metadata (name text, value text); CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);');
    const m = db.prepare('INSERT INTO metadata VALUES (?, ?)');
    m.run('name', 'Territorio di prova');
    m.run('format', formato);
    m.run('bounds', '12.3,46.2,12.5,46.4');
    m.run('attribution', 'Prova');
    const t = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
    tasselli.forEach(([z, x, y, dati]) => t.run(z, x, y, dati));
    db.close();
    return fs.readFileSync(file);
}

const prima = (await json('/api/mappa/cartografia')).corpo;
if (prima?.presente) {
    console.log("  (saltato: sull'istanza c'è già una cartografia caricata, non la tocco)");
    process.exit(0);
}
verifica('senza cartografia: presente = false', prima?.presente === false, prima);

try {
    // z=10, x=550, riga TMS 700 -> riga XYZ 1023-700 = 323.
    const file = mbtiles('t.mbtiles', 'png', [[10, 550, 700, PNG_ROSSO], [11, 1100, 1400, PNG_BLU], [12, 2200, 2800, PNG_ROSSO]]);

    // I pezzi: fuori ordine, ripetuto, poi la fine.
    const p0 = await pezzo(file.subarray(0, 4096), 0);
    verifica('primo pezzo accettato', p0.stato === 200 && p0.corpo?.id && p0.corpo.byte === 4096, p0);
    const salto = await pezzo(file.subarray(8192), 2, p0.corpo.id);
    verifica('pezzo fuori ordine: 409', salto.stato === 409 && salto.corpo?.pezzi === 1, salto);
    const p1 = await pezzo(file.subarray(4096), 1, p0.corpo.id);
    const p1bis = await pezzo(file.subarray(4096), 1, p0.corpo.id);
    verifica('pezzo rimandato non si somma due volte', p1.corpo?.byte === file.length && p1bis.stato === 200 && p1bis.corpo?.byte === file.length, [p1.corpo, p1bis.corpo]);
    const corta = await json('/api/mappa/cartografia/fine', { method: 'POST', body: { id: p0.corpo.id, byte: file.length + 10 } });
    verifica('fine con il conto dei byte sbagliato: 400', corta.stato === 400, corta);

    const ok = await carica(file, 'territorio-prova.mbtiles');
    verifica('caricata: dati letti dal file', ok.stato === 200 && ok.corpo?.presente && ok.corpo.tasselli === 3 && ok.corpo.zoom_minimo === 10
        && ok.corpo.zoom_massimo === 12 && ok.corpo.formato === 'png' && ok.corpo.limiti?.length === 4 && ok.corpo.file_originale === 'territorio-prova.mbtiles', ok);
    const info = (await json('/api/mappa/cartografia')).corpo;
    verifica('info con l\'indirizzo dei tasselli', info?.presente && info.url === '/api/mappa/cartografia/{z}/{x}/{y}' && info.nome === 'Territorio di prova', info);

    const t = await fetch(`${BASE}/api/mappa/cartografia/10/550/323`, { headers: auth });
    const byte = Buffer.from(await t.arrayBuffer());
    verifica('tassello letto con la riga girata', t.status === 200 && t.headers.get('content-type') === 'image/png' && byte.equals(PNG_ROSSO), t.status);
    const t2 = await fetch(`${BASE}/api/mappa/cartografia/11/1100/${2047 - 1400}`, { headers: auth });
    verifica('secondo tassello', Buffer.from(await t2.arrayBuffer()).equals(PNG_BLU), t2.status);
    const manca = await fetch(`${BASE}/api/mappa/cartografia/10/550/700`, { headers: auth });
    verifica('tassello che non c\'è: 404', manca.status === 404, manca.status);
    const anonimo = await fetch(`${BASE}/api/mappa/cartografia/10/550/323`);
    verifica('senza accesso: 401', anonimo.status === 401, anonimo.status);

    // Il limite di richieste (1500 ogni 15 minuti) non conta i tasselli.
    let troppi = 0;
    for (let giro = 0; giro < 32; giro++) {
        const esiti = await Promise.all(Array.from({ length: 50 }, () => fetch(`${BASE}/api/mappa/cartografia/10/550/323`, { headers: auth }).then(r => { r.body?.cancel(); return r.status; })));
        troppi += esiti.filter(s => s === 429).length;
    }
    verifica('1600 tasselli di fila senza 429', troppi === 0, troppi);
    const dopo = await json('/api/mappa/cartografia');
    verifica('e le altre richieste passano ancora', dopo.stato === 200, dopo.stato);

    // File sbagliati: il vecchio resta.
    const testo = await carica(Buffer.from('non sono un database '.repeat(50)), 'finto.mbtiles');
    verifica('non è un MBTiles: 400 con il motivo', testo.stato === 400 && /SQLite|MBTiles/.test(testo.corpo?.message), testo);
    const vettoriale = await carica(mbtiles('v.mbtiles', 'pbf', [[10, 1, 1, Buffer.from([0x1f, 0x8b, 0, 0])]]), 'v.mbtiles');
    verifica('tasselli vettoriali: 400 con il motivo', vettoriale.stato === 400 && /vettorial/.test(vettoriale.corpo?.message), vettoriale);
    const ancora = (await json('/api/mappa/cartografia')).corpo;
    verifica('dopo un file sbagliato resta quella di prima', ancora?.presente && ancora.tasselli === 3, ancora);
} catch (e) {
    verifica('nessuna eccezione', false, e.stack || e.message);
} finally {
    const via = await json('/api/mappa/cartografia', { method: 'DELETE' });
    verifica('tolta', via.corpo?.presente === false, via);
    const t = await fetch(`${BASE}/api/mappa/cartografia/10/550/323`, { headers: auth });
    verifica('dopo averla tolta i tasselli non ci sono', t.status === 404, t.status);
    fs.rmSync(cartella, { recursive: true, force: true });
}

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutto bene.');
process.exit(falliti ? 1 : 0);
