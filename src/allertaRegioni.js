// Per aggiungere una Regione: una voce qui e il catalogo delle zone generato con
// "node scripts/zone-allerta.mjs <regione>".

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CARTELLA_ZONE = path.join(__dirname, 'dati', 'zone-allerta');

// Nome dell'ente e pagina ufficiale solo dove li si è letti dal sito della Regione: senza, la sala
// dice "Centro Funzionale competente" e non mostra il collegamento.
export const REGIONI = {
    abruzzo: { nome: 'Abruzzo', prefisso: 'Abru-' },
    basilicata: { nome: 'Basilicata', prefisso: 'Basi-' },
    calabria: { nome: 'Calabria', prefisso: 'Cala-' },
    campania: { nome: 'Campania', prefisso: 'Camp-' },
    'emilia-romagna': { nome: 'Emilia-Romagna', prefisso: 'Emil-' },
    'friuli-venezia-giulia': { nome: 'Friuli Venezia Giulia', prefisso: 'Friu-' },
    lazio: { nome: 'Lazio', prefisso: 'Lazi-' },
    liguria: { nome: 'Liguria', prefisso: 'Ligu-' },
    lombardia: { nome: 'Lombardia', prefisso: 'Lomb-' },
    marche: { nome: 'Marche', prefisso: 'Marc-' },
    molise: { nome: 'Molise', prefisso: 'Moli-' },
    piemonte: { nome: 'Piemonte', prefisso: 'Piem-' },
    puglia: { nome: 'Puglia', prefisso: 'Pugl-' },
    sardegna: { nome: 'Sardegna', prefisso: 'Sard-' },
    sicilia: { nome: 'Sicilia', prefisso: 'Sici-' },
    toscana: { nome: 'Toscana', prefisso: 'Tosc-' },
    // Nei dati del Dipartimento le due Province autonome sono le due zone della stessa "Regione".
    'trentino-alto-adige': { nome: 'Trentino-Alto Adige', prefisso: 'Tren-' },
    umbria: { nome: 'Umbria', prefisso: 'Umbr-' },
    'valle-d-aosta': { nome: "Valle d'Aosta", prefisso: 'VDAo-' },
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

function zoneDelComune(regione, comune) {
    const cercato = String(comune || '').trim().toLowerCase();
    if (!cercato) return [];
    return (zoneDi(regione) || []).filter(z => z.comuni.some(c => c.toLowerCase() === cercato));
}

// Un comune diviso fra due bacini sta in più zone: decide il punto (il centro della mappa) se cade in una di loro.
export function zonaDelComune(regione, comune, punto = null) {
    const zone = zoneDelComune(regione, comune);
    if (zone.length <= 1 || !punto) return zone[0] || null;
    return zone.find(z => zonaDelPunto(regione, punto[0], punto[1])?.codice === z.codice) || zone[0];
}

export function comuniDivisi(regione) {
    const divisi = {};
    for (const z of zoneDi(regione) || []) {
        for (const c of z.comuni) (divisi[c] ||= []).push({ codice: z.codice, nome: z.nome });
    }
    return Object.fromEntries(Object.entries(divisi).filter(([, zone]) => zone.length > 1));
}

export function comuniDi(regione) {
    return [...new Set((zoneDi(regione) || []).flatMap(z => z.comuni))].sort((a, b) => a.localeCompare(b, 'it'));
}
