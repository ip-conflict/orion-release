// Le Regioni di cui ORION sa leggere il bollettino di allerta. Per
// aggiungerne una: una voce qui e il suo catalogo delle zone, generato con
// "node scripts/zone-allerta.mjs <regione>" (docs/manuale-tecnico.md).

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

/** Il catalogo delle zone d'allerta di una Regione: codice, nome, comuni e confine. */
export function zoneDi(regione) {
    if (!Object.hasOwn(REGIONI, regione)) return null;
    if (!cache.has(regione)) {
        cache.set(regione, JSON.parse(fs.readFileSync(path.join(CARTELLA_ZONE, `${regione}.json`), 'utf8')).zone);
    }
    return cache.get(regione);
}

// Un punto dentro un anello (raggi pari/dispari), coordinate [lon, lat].
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

/** La zona che contiene un punto, o null. */
export function zonaDelPunto(regione, lat, lon) {
    for (const z of zoneDi(regione) || []) {
        const g = z.geometria;
        const poligoni = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        if (poligoni.some(p => dentroPoligono(lon, lat, p))) return z;
    }
    return null;
}

/** La zona di un comune, o null. */
export function zonaDelComune(regione, comune) {
    const cercato = String(comune || '').trim().toLowerCase();
    if (!cercato) return null;
    return (zoneDi(regione) || []).find(z => z.comuni.some(c => c.toLowerCase() === cercato)) || null;
}

/** Tutti i comuni della Regione, in ordine alfabetico. */
export function comuniDi(regione) {
    return (zoneDi(regione) || []).flatMap(z => z.comuni).sort((a, b) => a.localeCompare(b, 'it'));
}
