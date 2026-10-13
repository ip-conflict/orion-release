// Per aggiungere una Regione: una voce qui e il catalogo delle zone generato con
// "node scripts/zone-allerta.mjs <regione>".

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CARTELLA_ZONE = path.join(__dirname, 'dati', 'zone-allerta');

export const REGIONI = {
    veneto: {
        nome: 'Veneto',
        prefisso: 'Vene-',
        ente: 'Centro Funzionale Decentrato della Regione del Veneto',
        paginaUfficiale: 'https://www.regione.veneto.it/web/protezione-civile/cfd'
    }
};

const cache = new Map();

export function zoneDi(regione) {
    if (!Object.hasOwn(REGIONI, regione)) return null;
    if (!cache.has(regione)) {
        cache.set(regione, JSON.parse(fs.readFileSync(path.join(CARTELLA_ZONE, `${regione}.json`), 'utf8')).zone);
    }
    return cache.get(regione);
}

function dentroAnello(lon, lat, anello) {
    let dentro = false;
    for (let i = 0, j = anello.length - 1; i < anello.length; j = i++) {
        const [xi, yi] = anello[i];
        const [xj, yj] = anello[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
}

function dentroPoligono(lon, lat, anelli) {
    return dentroAnello(lon, lat, anelli[0]) && !anelli.slice(1).some(buco => dentroAnello(lon, lat, buco));
}

export function zonaDelPunto(regione, lat, lon) {
    for (const z of zoneDi(regione) || []) {
        const g = z.geometria;
        const poligoni = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        if (poligoni.some(p => dentroPoligono(lon, lat, p))) return z;
    }
    return null;
}

export function zonaDelComune(regione, comune) {
    const cercato = String(comune || '').trim().toLowerCase();
    if (!cercato) return null;
    return (zoneDi(regione) || []).find(z => z.comuni.some(c => c.toLowerCase() === cercato)) || null;
}

export function comuniDi(regione) {
    return (zoneDi(regione) || []).flatMap(z => z.comuni).sort((a, b) => a.localeCompare(b, 'it'));
}
