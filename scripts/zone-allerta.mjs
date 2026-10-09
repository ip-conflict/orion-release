// Genera il catalogo delle zone d'allerta di una Regione (codice, nome,
// comuni, confine semplificato) dai dati aperti del Dipartimento della
// Protezione Civile. Da rilanciare quando la Regione ridisegna le sue zone.
//
//   node scripts/zone-allerta.mjs veneto
//
// Scrive src/dati/zone-allerta/<regione>.json. La Regione deve essere già
// fra quelle di src/allertaRegioni.js.

import fs from 'fs';
import path from 'path';
import { leggiDbf, leggiZip } from '../src/bollettinoDpc.js';
import { CARTELLA_ZONE, REGIONI } from '../src/allertaRegioni.js';

const BASE = 'https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/files';
const TOLLERANZA = 0.0008; // gradi: circa 70 metri

const regione = process.argv[2];
if (!REGIONI[regione]) {
    console.error(`Regione sconosciuta. Quelle previste: ${Object.keys(REGIONI).join(', ')}.`);
    process.exit(1);
}

async function scarica(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}

// Douglas-Peucker su un anello, tenendo chiuso il giro.
function semplifica(punti) {
    if (punti.length <= 4) return punti;
    const tieni = new Array(punti.length).fill(false);
    tieni[0] = tieni[punti.length - 1] = true;
    const pila = [[0, punti.length - 1]];
    while (pila.length) {
        const [a, b] = pila.pop();
        const [x1, y1] = punti[a];
        const [x2, y2] = punti[b];
        const dx = x2 - x1, dy = y2 - y1;
        const l = Math.hypot(dx, dy);
        let massimo = 0, indice = -1;
        for (let i = a + 1; i < b; i++) {
            // Agli estremi dello stesso punto (l'anello chiuso) conta la distanza da lì.
            const d = l < 1e-12 ? Math.hypot(punti[i][0] - x1, punti[i][1] - y1)
                : Math.abs(dy * punti[i][0] - dx * punti[i][1] + x2 * y1 - y2 * x1) / l;
            if (d > massimo) { massimo = d; indice = i; }
        }
        if (massimo > TOLLERANZA) {
            tieni[indice] = true;
            pila.push([a, indice], [indice, b]);
        }
    }
    const fuori = punti.filter((_, i) => tieni[i]).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
    return fuori.length >= 4 ? fuori : punti;
}

function semplificaGeometria(g) {
    const anelli = p => p.map(semplifica);
    if (g.type === 'Polygon') return { type: 'Polygon', coordinates: anelli(g.coordinates) };
    if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map(anelli) };
    throw new Error(`Geometria inattesa: ${g.type}`);
}

const zip = leggiZip(await scarica(`${BASE}/all/latest_all.zip`));
const dbf = Object.keys(zip).find(n => /_today\.dbf$/.test(n));
const chiave = dbf.slice(0, 13);
const codici = new Map(leggiDbf(zip[dbf]).map(r => [r.Nome_zona, r.Zona_all]));
const geo = JSON.parse((await scarica(`${BASE}/geojson/${chiave}_today.json`)).toString('utf8'));

const zone = geo.features
    .map(f => ({ codice: codici.get(f.properties['Nome zona']), f }))
    .filter(({ codice }) => codice?.startsWith(REGIONI[regione].prefisso))
    .map(({ codice, f }) => ({
        codice,
        nome: f.properties['Nome zona'],
        comuni: [...(f.properties.Comuni || [])].sort((a, b) => a.localeCompare(b, 'it')),
        geometria: semplificaGeometria(f.geometry)
    }))
    .sort((a, b) => a.codice.localeCompare(b.codice, 'it', { numeric: true }));

if (!zone.length) throw new Error(`Nessuna zona con il prefisso ${REGIONI[regione].prefisso}.`);
fs.mkdirSync(CARTELLA_ZONE, { recursive: true });
const uscita = path.join(CARTELLA_ZONE, `${regione}.json`);
fs.writeFileSync(uscita, JSON.stringify({
    regione,
    fonte: `Dipartimento della Protezione Civile, bollettino ${chiave} (CC-BY 4.0)`,
    zone
}) + '\n');
console.log(`${uscita}: ${zone.length} zone, ${zone.reduce((n, z) => n + z.comuni.length, 0)} comuni.`);
