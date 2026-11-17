// Il radar e i fulmini nella mappa della sala, con il servizio del Dipartimento simulato: dati
// buoni, formato cambiato, archivio sparito, API ferma, fulmini illeggibili. In ogni caso la
// pagina non deve rompersi e deve dire cosa succede.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=/percorso/chrome] node tests/radar-sala.mjs

import 'dotenv/config';
import zlib from 'zlib';
import { chromium } from 'playwright';
import { accediConVerifica } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (d, ok, x = '') => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); if (!ok) falliti++; };
const attesa = ms => new Promise(r => setTimeout(r, ms));

function png(pixel) {
    const righe = Buffer.alloc(256 * (1 + 256 * 4));
    for (let y = 0; y < 256; y++) {
        righe[y * 1025] = 0;
        for (let x = 0; x < 256; x++) pixel(x, y).forEach((v, i) => { righe[y * 1025 + 1 + x * 4 + i] = v; });
    }
    const pezzo = (tipo, dati) => {
        const lunghezza = Buffer.alloc(4);
        lunghezza.writeUInt32BE(dati.length);
        const corpo = Buffer.concat([Buffer.from(tipo), dati]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(corpo));
        return Buffer.concat([lunghezza, corpo, crc]);
    };
    const testa = Buffer.alloc(13);
    testa.writeUInt32BE(256, 0);
    testa.writeUInt32BE(256, 4);
    testa.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pezzo('IHDR', testa), pezzo('IDAT', zlib.deflateSync(righe)), pezzo('IEND', Buffer.alloc(0))]);
}
// Un acquazzone al centro della tessera, che si sposta di fotogramma in fotogramma.
const datoPioggia = (spostamento) => png((x, y) => [Math.hypot(x - 128 - spostamento, y - 128) < 60 ? 40 : 0, 0, 0, 255]);
const giaColorata = png(() => [200, 120, 40, 255]);
const vuota = png(() => [0, 0, 0, 0]);

function fileFulmini(punti) {
    const v = new DataView(new ArrayBuffer(3 + punti.length * 6));
    v.setUint8(0, 2);
    v.setUint16(1, punti.length, false);
    punti.forEach(([lat, lon], i) => {
        const x = Math.round((lon + 180) * 262144 / 360);
        const y = Math.round((lat + 90) * 262144 / 180);
        v.setUint16(3 + i * 6, x & 0xffff, false);
        v.setUint16(5 + i * 6, y & 0xffff, false);
        v.setUint8(7 + i * 6, ((x >> 16) << 6) | ((y >> 16) << 4));
        v.setUint8(8 + i * 6, 3);
    });
    return Buffer.from(v.buffer);
}

const ULTIMO = Math.floor(Date.now() / 300000) * 300000 - 300000;
let scenario = 'buono';
const richieste = { wms: 0, archivio: 0 };
const CORS = { 'Access-Control-Allow-Origin': '*' };

async function simula(pagina) {
    await pagina.route('https://radar-api.protezionecivile.it/**', r => scenario === 'api-ferma'
        ? r.fulfill({ status: 503, headers: CORS, body: 'giù' })
        : r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ total: 1, lastProducts: [{ productType: 'SRI', time: ULTIMO, period: 'PT5M' }] }) }));
    await pagina.route('https://s3-prod-dpc-radar-webp-cache.s3.eu-south-1.amazonaws.com/**', r => {
        richieste.archivio++;
        const url = r.request().url();
        const fulmini = url.match(/lgt_5min_(\d+)\.bin$/);
        if (fulmini) {
            const quanto = (ULTIMO - Number(fulmini[1])) / 300000;
            if (scenario === 'fulmini-rotti') return r.fulfill({ status: 200, headers: CORS, body: Buffer.from('<html>cambiato</html>') });
            if (quanto > 5) return r.fulfill({ status: 403, headers: CORS, body: '' });
            return r.fulfill({ status: 200, headers: CORS, body: fileFulmini([[41.85, 12.45 + quanto * 0.02], [41.75, 12.6]]) });
        }
        const pezzi = url.match(/\/SRI\/(\d{4})\/(\d\d)\/(\d\d)\/(\d\d)(\d\d)\/(\d+)\/(\d+)\/(\d+)\/sri\.webp$/);
        if (!pezzi || scenario === 'archivio-sparito') return r.fulfill({ status: 403, headers: CORS, body: '' });
        if (scenario === 'formato-cambiato') return r.fulfill({ status: 200, headers: CORS, contentType: 'image/webp', body: giaColorata });
        const istante = Date.UTC(+pezzi[1], +pezzi[2] - 1, +pezzi[3], +pezzi[4], +pezzi[5]);
        return r.fulfill({ status: 200, headers: CORS, contentType: 'image/webp', body: datoPioggia((istante - ULTIMO) / 300000 * 6) });
    });
    await pagina.route('https://radar-geowebcache.protezionecivile.it/**', r => { richieste.wms++; return r.fulfill({ status: 200, contentType: 'image/png', body: vuota }); });
    await pagina.route(/tile\.openstreetmap\.org|arcgisonline/, r => r.fulfill({ status: 200, contentType: 'image/png', body: vuota }));
}

const browser = await chromium.launch({ executablePath: process.env.ORION_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } });
const chiama = async (p, { method, body }) => { const r = await ctx.request.fetch(BASE + p, { method, data: body }); return { stato: r.status(), corpo: await r.json().catch(() => null) }; };
const accesso = await accediConVerifica(chiama, BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD);
if (accesso.stato !== 200) { console.error('Accesso non riuscito.'); process.exit(2); }
const pagina = await ctx.newPage();
const errori = [];
pagina.on('pageerror', e => errori.push(e.message));
await simula(pagina);

const pannello = () => pagina.evaluate(() => {
    const b = document.querySelector('.radar-pannello');
    const vista = (s) => { const e = b?.querySelector(s); return !!e && !e.hidden; };
    return b && { visibile: !b.hidden, stato: b.querySelector('.radar-stato').textContent, grave: b.querySelector('.radar-stato').classList.contains('grave'),
        gioca: vista('.radar-gioca'), scorri: vista('.radar-scorri'), valore: b.querySelector('.radar-scorri').value, ora: b.querySelector('.radar-ora').textContent,
        fulmini: vista('.radar-fulmini') ? b.querySelector('.radar-fulmini').textContent : null };
});
const pioggiaDisegnata = () => pagina.evaluate(() => [...document.querySelectorAll('#map-segnalazioni canvas')].some(c => {
    if (c.width !== 256 || c.height !== 256) return false;
    const d = c.getContext('2d').getImageData(0, 0, 256, 256).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 200 && d[i - 1] > 150) return true;
    return false;
}));
async function apri() {
    await pagina.goto(BASE + '/centro-operativo.html');
    await pagina.waitForSelector('#map-segnalazioni .leaflet-control-layers', { timeout: 15000 });
    await pagina.evaluate(() => window.mappaCentroOperativo.setView([41.8, 12.5], 8));
}
async function accendi(nome) {
    await pagina.hover('.leaflet-control-layers');
    const casella = pagina.locator('.leaflet-control-layers-overlays label', { hasText: nome }).locator('input');
    if (!(await casella.isChecked())) await casella.check();
    await pagina.mouse.move(700, 300);
}
const aspetta = async (prova, ms = 8000) => { const fine = Date.now() + ms; while (Date.now() < fine) { const p = await pannello(); if (prova(p)) return p; await attesa(200); } return pannello(); };

try {
    console.log('\nCon il servizio che funziona');
    await pagina.goto(BASE + '/centro-operativo.html');
    await pagina.evaluate(() => { localStorage.removeItem('orion.radar.acceso'); localStorage.removeItem('orion.fulmini.acceso'); });
    await apri();
    await accendi('Radar pioggia');
    let p = await aspetta(p => p?.stato === "L'ultima immagine");
    verifica('acceso il radar: ultima immagine, con Play e la barra del tempo', p?.stato === "L'ultima immagine" && p.gioca && p.scorri && p.valore === '11', p);
    await attesa(800);
    verifica('la pioggia è disegnata sulla mappa', await pioggiaDisegnata());
    verifica('nessuna richiesta al servizio di riserva', richieste.wms === 0, richieste);
    await pagina.click('.radar-gioca');
    p = await aspetta(p => p?.stato.includes("prima dell'ultima"), 10000);
    verifica('Play fa scorrere l\'ultima ora', /\d+ minuti prima dell'ultima/.test(p?.stato || ''), p);
    await pagina.click('.radar-gioca');
    const fermo = (await pannello()).valore;
    await attesa(1500);
    verifica('Pausa la ferma', (await pannello()).valore === fermo);
    await pagina.locator('.radar-scorri').fill('11');
    await accendi('Fulmini');
    p = await aspetta(p => /⚡/.test(p?.fulmini || ''));
    verifica('i fulmini dell\'ultima mezz\'ora contati sulla mappa', /⚡ \d+ fulmini sulla mappa/.test(p?.fulmini || ''), p);

    console.log('\nSe il Dipartimento cambia il formato delle tessere');
    scenario = 'formato-cambiato';
    richieste.wms = 0;
    await apri();
    p = await aspetta(p => /Solo l'ultima immagine/.test(p?.stato || ''));
    verifica('si passa all\'ultima immagine e lo si dice, senza Play', /Solo l'ultima immagine/.test(p?.stato || '') && !p.gioca && !p.scorri, p);
    await attesa(1000);
    verifica('e la si chiede al servizio di riserva', richieste.wms > 0, richieste);
    verifica('i colori sbagliati non arrivano sulla mappa', !(await pioggiaDisegnata()));

    console.log('\nSe l\'archivio sparisce');
    scenario = 'archivio-sparito';
    richieste.wms = 0;
    await apri();
    p = await aspetta(p => /Solo l'ultima immagine/.test(p?.stato || ''));
    verifica('stessa cosa: ultima immagine dal servizio di riserva', /Solo l'ultima immagine/.test(p?.stato || '') && richieste.wms > 0, { p, richieste });

    console.log('\nSe i fulmini arrivano illeggibili');
    scenario = 'fulmini-rotti';
    await apri();
    p = await aspetta(p => /non disponibili/.test(p?.fulmini || ''));
    verifica('lo si dice, e il radar va avanti', p?.fulmini === 'Fulmini non disponibili.' && p.stato === "L'ultima immagine", p);

    console.log('\nSe l\'API del radar è ferma');
    scenario = 'api-ferma';
    await apri();
    p = await aspetta(p => p?.stato === 'Radar non raggiungibile');
    verifica('"Radar non raggiungibile", in rosso', p?.stato === 'Radar non raggiungibile' && p.grave, p);

    verifica('nessun errore nella pagina in tutti i casi', errori.length === 0, errori);
} finally {
    await pagina.evaluate(() => { localStorage.removeItem('orion.radar.acceso'); localStorage.removeItem('orion.fulmini.acceso'); }).catch(() => {});
    await browser.close();
}

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutto bene.');
process.exit(falliti ? 1 : 0);
