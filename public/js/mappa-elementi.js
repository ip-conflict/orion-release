// public/js/mappa-elementi.js
//
// Strade chiuse, zone interdette, zone di pericolosità e aree del piano sulla
// mappa del centro operativo. Ogni tipo è un livello che si accende e si
// spegne dal controllo dei livelli, con il suo colore come legenda.
//
// Disegnare (chi lavora in sala, a emergenza aperta; l'amministratore anche
// gli elementi del piano):
//   - strada chiusa: si tocca l'inizio e la fine del tratto e la linea segue
//     la strada (OSRM, lo stesso servizio dei percorsi); senza rete si
//     disegna a mano;
//   - zone e aree: si disegna il contorno, poi si sceglie il tipo.
// Cliccando un elemento: i suoi dati, e per chi può "Modifica", "Sposta i
// punti" e "Togli" (una strada chiusa si "riapre": resta nel registro).

const STILI = {
    strada_chiusa: { color: '#dc2626', weight: 7, opacity: 0.9, lineCap: 'round' },
    // Le zone: bordo pieno con un alone bianco sotto, che lo stacca da
    // qualunque mappa; dentro un velo leggero e, per interdizioni e pericoli,
    // un tratteggio (incrociato per le interdette) che si riconosce anche dove
    // le zone si sovrappongono e lascia leggere strade e nomi sotto.
    zona_interdetta: { color: '#b91c1c', weight: 3, fillColor: '#ef4444', fillOpacity: 0.12, tratteggio: 'incrociato' },
    pericolo_alluvione: { color: '#1d4ed8', weight: 2.5, fillColor: '#3b82f6', fillOpacity: 0.1, dashArray: '9 5', tratteggio: 'righe' },
    pericolo_frana: { color: '#92400e', weight: 2.5, fillColor: '#b45309', fillOpacity: 0.1, dashArray: '9 5', tratteggio: 'righe' },
    pericolo_generico: { color: '#c2410c', weight: 2.5, fillColor: '#f97316', fillOpacity: 0.1, dashArray: '9 5', tratteggio: 'righe' },
    area_attesa: { color: '#15803d', weight: 3, fillColor: '#22c55e', fillOpacity: 0.16 },
    area_accoglienza: { color: '#0f766e', weight: 3, fillColor: '#14b8a6', fillOpacity: 0.16 },
    area_ammassamento: { color: '#6d28d9', weight: 3, fillColor: '#8b5cf6', fillOpacity: 0.16 },
    altro: { color: '#475569', weight: 2.5, fillColor: '#94a3b8', fillOpacity: 0.14 }
};
// I tratteggi come motivi SVG, una volta per pagina: il riempimento di una
// zona li richiama con url(#lm-t-tipo). Righe a 45 gradi del colore del bordo
// sopra il velo del colore di riempimento.
function definisciTratteggi() {
    if (document.getElementById('lm-tratteggi')) return;
    const ns = 'http://www.w3.org/2000/svg';
    const nodo = (tag, attributi) => { const n = document.createElementNS(ns, tag); Object.entries(attributi).forEach(([k, v]) => n.setAttribute(k, v)); return n; };
    const svg = nodo('svg', { id: 'lm-tratteggi', width: 0, height: 0, 'aria-hidden': 'true' });
    svg.style.position = 'absolute';
    const defs = nodo('defs', {});
    Object.entries(STILI).filter(([, s]) => s.tratteggio).forEach(([tipo, s]) => {
        const motivo = nodo('pattern', { id: `lm-t-${tipo}`, patternUnits: 'userSpaceOnUse', width: 10, height: 10, patternTransform: 'rotate(45)' });
        motivo.append(nodo('rect', { width: 10, height: 10, fill: s.fillColor, 'fill-opacity': s.fillOpacity }));
        motivo.append(nodo('line', { x1: 5, y1: 0, x2: 5, y2: 10, stroke: s.color, 'stroke-width': 2.2, 'stroke-opacity': 0.5 }));
        if (s.tratteggio === 'incrociato') motivo.append(nodo('line', { x1: 0, y1: 5, x2: 10, y2: 5, stroke: s.color, 'stroke-width': 2.2, 'stroke-opacity': 0.5 }));
        defs.append(motivo);
    });
    svg.append(defs);
    document.body.append(svg);
}
// Lo stile di un'area: il riempimento col tratteggio, se il tipo ne ha uno.
function stileArea(s, tipo) {
    return {
        color: s.color, weight: s.weight, opacity: 1, dashArray: s.dashArray, lineJoin: 'round',
        fillColor: s.tratteggio ? `url(#lm-t-${tipo})` : s.fillColor, fillOpacity: s.tratteggio ? 1 : s.fillOpacity
    };
}
const ETICHETTE = {
    strada_chiusa: 'Strade chiuse', zona_interdetta: 'Zone interdette', pericolo_alluvione: 'Pericolo alluvione',
    pericolo_frana: 'Pericolo frana', pericolo_generico: 'Altre zone di pericolo', area_attesa: 'Aree di attesa', area_accoglienza: 'Aree di accoglienza',
    area_ammassamento: 'Aree di ammassamento', altro: 'Altri elementi'
};
const SINGOLARE = {
    strada_chiusa: 'Strada chiusa', zona_interdetta: 'Zona interdetta', pericolo_alluvione: 'Zona a pericolo di alluvione',
    pericolo_frana: 'Zona a pericolo di frana', pericolo_generico: 'Zona di pericolo (altro)', area_attesa: 'Area di attesa', area_accoglienza: 'Area di accoglienza',
    area_ammassamento: 'Area di ammassamento soccorritori', altro: 'Altro'
};
const TIPI_AREA = ['zona_interdetta', 'pericolo_alluvione', 'pericolo_frana', 'pericolo_generico', 'area_attesa', 'area_accoglienza', 'area_ammassamento', 'altro'];
// I gruppi del controllo dei livelli: un clic sul gruppo accende o spegne
// tutti i suoi tipi, la freccia apre i tipi uno per uno.
const GRUPPI = [
    { chiave: 'viabilita', titolo: 'Viabilità e interdizioni', tipi: ['strada_chiusa', 'zona_interdetta'] },
    { chiave: 'pericoli', titolo: 'Pericoli', tipi: ['pericolo_alluvione', 'pericolo_frana', 'pericolo_generico'] },
    { chiave: 'piano', titolo: 'Aree del piano di protezione civile', tipi: ['area_attesa', 'area_accoglienza', 'area_ammassamento'] }
];
// Questi possono restare in vigore dopo la chiusura dell'emergenza.
const DURANO = ['strada_chiusa', 'zona_interdetta'];
// Questi di solito appartengono al piano, non all'emergenza.
const DEL_PIANO = ['pericolo_alluvione', 'pericolo_frana', 'area_attesa', 'area_accoglienza', 'area_ammassamento'];

const STILE = `
.lm-campione { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: middle; border: 2px solid; box-sizing: border-box; }
.lm-campione.linea { height: 0; border-width: 3px 0 0; border-radius: 0; }
.lm-gruppo-riga { display: flex; align-items: center; gap: 2px; }
.lm-gruppo-testa { flex: 1; font-weight: 700; cursor: pointer; }
.lm-gruppo-apri { width: 20px; height: 20px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 12px; line-height: 1; transition: transform .15s; }
.lm-gruppo-apri[aria-expanded="true"] { transform: rotate(90deg); }
.lm-gruppo-voci { padding-left: 22px; }
.lm-gruppo-voci[hidden] { display: none; }
.lm-gruppo + .lm-gruppo, .leaflet-control-layers-overlays > label + .lm-gruppo { margin-top: 4px; }
/* Il controllo dei livelli con i colori del tema, anche scuro, su tutte le mappe che lo montano. */
.leaflet-bottom.leaflet-left .leaflet-control-layers { border-radius: 10px; border: 1px solid var(--border-color, #ccc); box-shadow: 0 2px 8px rgba(0,0,0,.18); background: var(--surface-color, #fff); color: var(--text-color, #111); }
.leaflet-bottom.leaflet-left .leaflet-control-layers-toggle { width: 38px !important; height: 38px !important; border-radius: 10px; background-position: center center !important; }
.leaflet-control-layers-separator { border-top-color: var(--border-color, #ddd); }
.lm-disegna { position: relative; }
.lm-disegna > button { width: 40px; height: 40px; border: 0; background: var(--surface-color, #fff); color: var(--text-color, #111); cursor: pointer; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
.lm-menu { position: absolute; left: 48px; bottom: 0; background: var(--surface-color, #fff); color: var(--text-color, #111); border: 1px solid var(--border-color, #ccc); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.18); padding: 6px; min-width: 250px; display: flex; flex-direction: column; }
.lm-menu button { text-align: left; border: 0; background: transparent; color: inherit; font: inherit; font-size: .88rem; padding: 8px 10px; border-radius: 6px; cursor: pointer; display: flex; gap: 8px; align-items: center; }
.lm-menu button:hover { background: var(--secondary-bg-color, #eef2f7); }
.lm-menu small { color: var(--text-muted, #64748b); display: block; font-size: .75rem; }
.lm-guida { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 1000; background: #0f172a; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: .9rem; display: flex; gap: 12px; align-items: center; box-shadow: 0 4px 12px rgba(0,0,0,.3); }
.lm-guida button { border: 1px solid #475569; background: transparent; color: #fff; border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; font-size: .85rem; }
.lm-guida button.lm-ok { background: #2563eb; border-color: #2563eb; }
.lm-popup { font-size: .85rem; min-width: 200px; }
.lm-popup strong { display: block; font-size: .95rem; }
.lm-popup .lm-tipo { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; }
.lm-popup .lm-meta { color: var(--text-muted, #64748b); font-size: .75rem; margin-top: 4px; }
.lm-popup .lm-azioni { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.lm-popup .lm-azioni button { font: inherit; font-size: .78rem; font-weight: 600; padding: 4px 8px; border-radius: 5px; border: 1px solid var(--border-color, #cbd5e1); background: var(--bg-color, #fff); color: var(--text-color, #0f172a); cursor: pointer; }
.lm-popup .lm-azioni button.lm-pericolo { color: var(--danger-text, #b91c1c); }
/* Col tema scuro i colori dei tipi (blu, marrone, viola) sul fondo blu notte
   si leggevano male: più chiari. */
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .lm-popup .lm-tipo, :root:not([data-theme="light"]) .lm-campione-testo { filter: brightness(1.9) saturate(1.1); } }
:root[data-theme="dark"] .lm-popup .lm-tipo { filter: brightness(1.9) saturate(1.1); }
.lm-velo { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 5000; display: flex; align-items: flex-start; justify-content: center; padding: 60px 12px; overflow-y: auto; }
.lm-finestra { background: var(--surface-color, #fff); color: var(--text-color, #111); width: 100%; max-width: 440px; border-radius: 12px; padding: 18px 20px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.lm-finestra h2 { margin: 0 0 12px; font-size: 1.1rem; }
.lm-campo { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: .85rem; font-weight: 600; }
.lm-campo input, .lm-campo select, .lm-campo textarea { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color, #ccc); background: var(--bg-color, #fff); color: inherit; font: inherit; font-weight: 400; margin: 0; }
.lm-spunta { display: flex; gap: 8px; align-items: flex-start; font-size: .85rem; margin-bottom: 10px; }
.lm-pulsanti { display: flex; gap: 8px; justify-content: flex-end; }
.lm-errore { color: var(--danger-text, #b91c1c); font-size: .85rem; margin: 4px 0 8px; }
.lm-finestra [hidden], .lm-menu[hidden] { display: none !important; }
.lm-disegnando .leaflet-lm-zone-pane .leaflet-interactive, .lm-disegnando .leaflet-lm-strade-pane .leaflet-interactive { pointer-events: none; }
.lm-disegnando .lm-etichetta { pointer-events: none; }
.lm-estremo { filter: drop-shadow(0 1px 1px rgba(0,0,0,.45)); }
.lm-estremo svg { display: block; }
/* Il nome e il tipo di un'area, nel suo punto più interno, quando lo zoom lo
   permette. Niente riquadro bianco: il testo ha il colore del bordo dell'area
   (così si capisce di quale area è, anche dove si sovrappongono) e un alone
   bianco che lo stacca dalla mappa. */
.lm-etichetta { pointer-events: auto; cursor: pointer; transform: translate(-50%, -50%); width: max-content !important; height: auto !important;
    max-width: 190px; text-align: center; font: 700 14px/1.2 system-ui, sans-serif; color: var(--lm-colore, #0f172a);
    text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 4px #fff, 0 0 6px rgba(255,255,255,.9);
    overflow-wrap: anywhere; }
.lm-etichetta small { display: block; font-weight: 600; font-size: 12px; opacity: .92; }
.lm-simbolo { width: 26px !important; height: 26px !important; margin: -13px 0 0 -13px !important; border-radius: 7px; background: var(--lm-colore);
    border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; cursor: pointer; box-sizing: border-box; }
.lm-simbolo svg { width: 17px; height: 17px; fill: #fff; display: block; }
.lm-simbolo.lm-pericolo-simbolo { border-radius: 50%; }
.lm-simbolo b { position: absolute; top: -8px; right: -9px; min-width: 16px; height: 16px; padding: 0 3px; border-radius: 8px; background: #0f172a; color: #fff;
    font: 700 11px/16px system-ui, sans-serif; text-align: center; box-sizing: border-box; border: 1.5px solid #fff; }
.lm-disegnando .lm-simbolo { pointer-events: none; }
/* Sfondo attenuato: la mappa di base perde colore, le zone e i segnaposti risaltano. */
.lm-sfondo-attenuato .leaflet-tile-pane { filter: saturate(.25) brightness(1.08) contrast(.88); }
.lm-etichetta.lm-punto { transform: translate(12px, -50%); text-align: left; }
.lm-etichetta[hidden] { display: none !important; }
`;

function el(tag, attributi = {}, ...figli) {
    const e = document.createElement(tag);
    Object.entries(attributi).forEach(([k, v]) => {
        if (k === 'testo') e.textContent = v;
        else if (k.startsWith('su')) e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
    });
    figli.flat().forEach(f => f != null && f !== false && e.append(f));
    return e;
}

// Il cartello di divieto di transito: rosso con la barra bianca, uguale su ogni sistema.
// Le icone dei simboli che prendono il posto delle aree troppo piccole sullo
// schermo: bianche, su un quadrato del colore del tipo.
const ICONE = {
    area_attesa: '<circle cx="8" cy="6" r="2.4"/><circle cx="16" cy="6" r="2.4"/><path d="M4.5 19v-6.5a3.5 3.5 0 0 1 7 0V19zM12.5 19v-6.5a3.5 3.5 0 0 1 7 0V19z"/>',
    area_accoglienza: '<path d="M12 3 2.5 19h19zM12 10.5 8.6 19h6.8z" fill-rule="evenodd"/>',
    area_ammassamento: '<path d="M2 6h11v10H2zM14 9h4.5l3.5 4v3h-8z"/><circle cx="6" cy="17.5" r="2.2"/><circle cx="17.5" cy="17.5" r="2.2"/>',
    zona_interdetta: '<path d="M4.5 10h15v4h-15z"/>',
    pericolo_alluvione: '<path d="M12 2.5 22 20H2z"/><path d="M11 9h2v6h-2zM11 16.2h2v2h-2z" style="fill:var(--lm-colore)"/>',
    pericolo_frana: '<path d="M12 2.5 22 20H2z"/><path d="M11 9h2v6h-2zM11 16.2h2v2h-2z" style="fill:var(--lm-colore)"/>',
    pericolo_generico: '<path d="M12 2.5 22 20H2z"/><path d="M11 9h2v6h-2zM11 16.2h2v2h-2z" style="fill:var(--lm-colore)"/>',
    altro: '<circle cx="12" cy="12" r="5"/>'
};
// Sotto questa misura sullo schermo (il lato più lungo, in pixel) un'area
// diventa un simbolo.
const AREA_PICCOLA = 34;
const DIVIETO = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#dc2626" stroke="#fff" stroke-width="2"/><rect x="4.5" y="8.3" width="11" height="3.4" rx="0.6" fill="#fff"/></svg>';

const quando = (v) => v ? new Date(v).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

// Il punto più interno di un'area (il "polo di inaccessibilità", come fa
// polylabel di Mapbox): il centro del cerchio più grande che ci sta dentro.
// Il baricentro di una forma a C o a L cade fuori dall'area; questo no.
// Restituisce { lat, lng, raggio } con il raggio in metri, o null.
// Con vista ({ ovest, sud, est, nord }) conta solo la parte d'area dentro
// quel rettangolo: è il punto per un'area più grande dello schermo.
function puntoInterno(geometria, vista = null) {
    const poligoni = geometria.type === 'Polygon' ? [geometria.coordinates] : geometria.type === 'MultiPolygon' ? geometria.coordinates : [];
    if (!poligoni.length) return null;
    const lat0 = poligoni[0][0][0][1];
    const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    let migliore = null;
    for (const anelli of poligoni) {
        let piani = anelli.map(a => a.map(([lng, lat]) => [lng * kx, lat * ky]));
        if (vista) {
            piani = piani.map(a => ritaglia(a, vista.ovest * kx, vista.sud * ky, vista.est * kx, vista.nord * ky));
            if (piani[0].length < 3) continue;
            piani = piani.filter(a => a.length >= 3);
        }
        const r = poloInterno(piani);
        if (r && (!migliore || r.d > migliore.d)) migliore = r;
    }
    return migliore ? { lng: migliore.x / kx, lat: migliore.y / ky, raggio: Math.max(0, migliore.d) } : null;
}

// Un anello tagliato su un rettangolo (Sutherland-Hodgman): resta la parte dentro.
function ritaglia(anello, x0, y0, x1, y1) {
    const lati = [
        [p => p[0] >= x0, (a, b) => [x0, a[1] + (x0 - a[0]) * (b[1] - a[1]) / (b[0] - a[0])]],
        [p => p[0] <= x1, (a, b) => [x1, a[1] + (x1 - a[0]) * (b[1] - a[1]) / (b[0] - a[0])]],
        [p => p[1] >= y0, (a, b) => [a[0] + (y0 - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), y0]],
        [p => p[1] <= y1, (a, b) => [a[0] + (y1 - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), y1]]
    ];
    let punti = anello;
    for (const [dentro, taglio] of lati) {
        const prima = punti;
        punti = [];
        prima.forEach((p, i) => {
            const q = prima[(i + prima.length - 1) % prima.length];
            if (dentro(p)) {
                if (!dentro(q)) punti.push(taglio(q, p));
                punti.push(p);
            } else if (dentro(q)) punti.push(taglio(q, p));
        });
        if (!punti.length) break;
    }
    return punti;
}

function distanzaDalBordo(x, y, anelli) {
    let dentro = false;
    let minimo = Infinity;
    for (const anello of anelli) {
        for (let i = 0, j = anello.length - 1; i < anello.length; j = i++) {
            const [ax, ay] = anello[i], [bx, by] = anello[j];
            if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) dentro = !dentro;
            let dx = bx - ax, dy = by - ay, px = ax, py = ay;
            if (dx || dy) {
                const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
                px = ax + t * dx; py = ay + t * dy;
            }
            minimo = Math.min(minimo, (x - px) ** 2 + (y - py) ** 2);
        }
    }
    return (dentro ? 1 : -1) * Math.sqrt(minimo);
}

function poloInterno(anelli) {
    const esterno = anelli[0];
    if (!esterno?.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    esterno.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const lato = Math.min(x1 - x0, y1 - y0);
    if (!(lato > 0)) return { x: x0, y: y0, d: 0 };
    const cella = (x, y, h) => { const d = distanzaDalBordo(x, y, anelli); return { x, y, h, d, max: d + h * Math.SQRT2 }; };
    // Una coda con priorità (heap): prima le celle che promettono di più.
    const coda = [];
    const metti = (c) => {
        coda.push(c);
        for (let i = coda.length - 1; i > 0;) {
            const p = (i - 1) >> 1;
            if (coda[p].max >= coda[i].max) break;
            [coda[p], coda[i]] = [coda[i], coda[p]]; i = p;
        }
    };
    const togli = () => {
        const cima = coda[0], ultimo = coda.pop();
        if (coda.length) {
            coda[0] = ultimo;
            for (let i = 0; ;) {
                const a = 2 * i + 1, b = a + 1;
                let g = i;
                if (a < coda.length && coda[a].max > coda[g].max) g = a;
                if (b < coda.length && coda[b].max > coda[g].max) g = b;
                if (g === i) break;
                [coda[g], coda[i]] = [coda[i], coda[g]]; i = g;
            }
        }
        return cima;
    };
    const h0 = lato / 2;
    for (let x = x0; x < x1; x += lato) for (let y = y0; y < y1; y += lato) metti(cella(x + h0, y + h0, h0));
    let migliore = cella((x0 + x1) / 2, (y0 + y1) / 2, 0);
    const precisione = Math.max(lato / 100, 1); // un metro basta
    for (let giri = 0; coda.length && giri < 3000; giri++) {
        const c = togli();
        if (c.d > migliore.d) migliore = c;
        if (c.max - migliore.d <= precisione) continue;
        const h = c.h / 2;
        [cella(c.x - h, c.y - h, h), cella(c.x + h, c.y - h, h), cella(c.x - h, c.y + h, h), cella(c.x + h, c.y + h, h)].forEach(metti);
    }
    return migliore;
}

// La cartografia del territorio caricata sul server (cartografia.js sul
// server): un fondo in più fra quelli della mappa. Se le mappe da internet
// non arrivano (la linea è caduta ma il server si raggiunge) la mappa ci
// passa da sola e lo dice; senza cartografia caricata dice dove si carica.
const ERRORI_PRIMA_DI_CAMBIARE = 4;
export async function aggiungiCartografia(map, controllo, daInternet = []) {
    let info = null;
    try { info = await fetchApi('/api/mappa/cartografia'); } catch { /* il server non risponde: niente da aggiungere */ }
    let territorio = null;
    if (info?.presente) {
        const [o, s, e, n] = info.limiti || [];
        territorio = L.tileLayer('/api/mappa/cartografia/{z}/{x}/{y}', {
            minZoom: 0,
            maxZoom: 20,
            minNativeZoom: info.zoom_minimo,
            maxNativeZoom: info.zoom_massimo,
            bounds: info.limiti ? L.latLngBounds([s, o], [n, e]) : undefined,
            attribution: info.attribuzione || 'Cartografia del territorio'
        });
        controllo.addBaseLayer(territorio, 'Territorio (dal server)');
    }
    let detto = false;
    daInternet.filter(Boolean).forEach(fondo => {
        let errori = 0;
        fondo.on('tileload', () => { errori = 0; });
        fondo.on('tileerror', () => {
            if (++errori < ERRORI_PRIMA_DI_CAMBIARE || detto || !map.hasLayer(fondo)) return;
            detto = true;
            if (territorio) {
                map.removeLayer(fondo);
                territorio.addTo(map);
                notifica('Le mappe da internet non arrivano: passo alla cartografia del territorio salvata sul server.', 'attenzione', 9000);
            } else if (typeof haPermesso === 'function' && haPermesso('emergenze.piano')) {
                notifica('Le mappe da internet non arrivano. Per avere la mappa anche senza internet si può caricare la cartografia del territorio: Impostazioni › Livelli del piano.', 'attenzione', 9000);
            } else {
                notifica('Le mappe da internet non arrivano: la linea verso internet è lenta o assente.', 'attenzione', 9000);
            }
        });
    });
    return territorio;
}

// Il controllo dei livelli di Leaflet con i gruppi. Leaflet ricostruisce
// l'elenco a ogni cambio; subito dopo le voci di un gruppo si spostano sotto
// la sua intestazione, con la casella che accende o spegne tutto il gruppo
// (piena, vuota o a metà) e la freccia che apre o chiude il dettaglio. Quali
// gruppi sono aperti lo ricorda il browser.
const CHIAVE_APERTI = 'orion.livelli.aperti';
const leggiAperti = () => {
    try { return new Set(JSON.parse(localStorage.getItem(CHIAVE_APERTI) || '[]')); } catch { return new Set(); }
};
export function creaControlloLivelli(base, sovrapposti, opzioni) {
    const Gruppi = L.Control.Layers.extend({
        initialize(b, o, opz) {
            L.Control.Layers.prototype.initialize.call(this, b, o, opz);
            this._gruppi = [];
            this._aperti = leggiAperti();
        },
        gruppo(chiave, titolo, strati) {
            this._gruppi.push({ chiave, titolo, strati: strati.filter(Boolean) });
            this._update();
            return this;
        },
        onAdd(map) {
            const contenitore = L.Control.Layers.prototype.onAdd.call(this, map);
            // Una voce cliccata non ricostruisce l'elenco: le caselle dei gruppi sì.
            map.on('overlayadd overlayremove', this._statoGruppi, this);
            return contenitore;
        },
        onRemove(map) {
            map.off('overlayadd overlayremove', this._statoGruppi, this);
            L.Control.Layers.prototype.onRemove.call(this, map);
        },
        _update() {
            L.Control.Layers.prototype._update.call(this);
            if (this._container && this._gruppi?.length) this._raggruppa();
            return this;
        },
        _raggruppa() {
            const etichetta = new Map(); // strato -> <label>
            this._layerControlInputs.forEach(input => {
                const voce = this._getLayer(input.layerId);
                if (voce?.overlay) etichetta.set(voce.layer, input.closest('label'));
            });
            const nelGruppo = new Set(this._gruppi.flatMap(g => g.strati));
            // I gruppi vanno dove stava la prima voce raggruppata.
            const prima = [...this._overlaysList.children].find(l => [...etichetta].some(([strato, lab]) => lab === l && nelGruppo.has(strato)));
            const segnaposto = document.createComment('gruppi');
            this._overlaysList.insertBefore(segnaposto, prima || null);
            this._caselleGruppi = [];
            this._gruppi.forEach(g => {
                const voci = g.strati.map(st => etichetta.get(st)).filter(Boolean);
                if (!voci.length) return;
                const casella = L.DomUtil.create('input', 'leaflet-control-layers-selector');
                casella.type = 'checkbox';
                const nome = L.DomUtil.create('span');
                nome.textContent = ` ${g.titolo}`;
                const testa = L.DomUtil.create('label', 'lm-gruppo-testa');
                testa.append(casella, nome);
                const aperto = this._aperti.has(g.chiave);
                const freccia = L.DomUtil.create('button', 'lm-gruppo-apri');
                freccia.type = 'button';
                freccia.setAttribute('aria-expanded', String(aperto));
                freccia.setAttribute('aria-label', `${aperto ? 'Chiudi' : 'Apri'} ${g.titolo}`);
                freccia.textContent = '▸';
                const elenco = L.DomUtil.create('div', 'lm-gruppo-voci');
                elenco.hidden = !aperto;
                elenco.append(...voci);
                const riga = L.DomUtil.create('div', 'lm-gruppo-riga');
                riga.append(freccia, testa);
                const blocco = L.DomUtil.create('div', 'lm-gruppo');
                blocco.append(riga, elenco);
                this._overlaysList.insertBefore(blocco, segnaposto);
                L.DomEvent.on(freccia, 'click', (e) => {
                    L.DomEvent.stop(e);
                    const ora = elenco.hidden;
                    elenco.hidden = !ora;
                    freccia.setAttribute('aria-expanded', String(ora));
                    freccia.setAttribute('aria-label', `${ora ? 'Chiudi' : 'Apri'} ${g.titolo}`);
                    if (ora) this._aperti.add(g.chiave); else this._aperti.delete(g.chiave);
                    try { localStorage.setItem(CHIAVE_APERTI, JSON.stringify([...this._aperti])); } catch { /* resta per questa pagina */ }
                });
                L.DomEvent.on(casella, 'click', () => this._commutaGruppo(g));
                this._caselleGruppi.push({ g, casella });
            });
            segnaposto.remove();
            this._statoGruppi();
        },
        // Tutto acceso, tutto spento o a metà.
        _statoGruppi() {
            (this._caselleGruppi || []).forEach(({ g, casella }) => {
                const accesi = g.strati.filter(st => this._map?.hasLayer(st)).length;
                casella.checked = accesi === g.strati.length;
                casella.indeterminate = accesi > 0 && accesi < g.strati.length;
            });
        },
        // Se ne manca anche uno si accende tutto il gruppo, se no si spegne.
        _commutaGruppo(g) {
            const accendi = g.strati.some(st => !this._map.hasLayer(st));
            this._handlingClick = true;
            g.strati.forEach(st => {
                if (accendi && !this._map.hasLayer(st)) this._map.addLayer(st);
                if (!accendi && this._map.hasLayer(st)) this._map.removeLayer(st);
            });
            this._handlingClick = false;
            // Senza ricostruire l'elenco (si richiuderebbe sotto il mouse): solo le caselle.
            this._layerControlInputs.forEach(input => {
                const voce = this._getLayer(input.layerId);
                if (voce) input.checked = this._map.hasLayer(voce.layer);
            });
            this._statoGruppi();
        }
    });
    return new Gruppi(base, sovrapposti, opzioni);
}

export function montaElementiMappa(map, controlloLivelli, { calcolaPercorso, interno, admin, emergenzaAperta }) {
    if (!document.getElementById('lm-stile')) {
        // I campioni della legenda: un colore per tipo, dalla stessa tabella degli stili.
        const campioni = Object.entries(STILI).map(([t, s]) =>
            `.lm-campione.t-${t} { border-color: ${s.color}; background: ${t === 'strada_chiusa' ? 'transparent'
                : s.tratteggio ? `repeating-linear-gradient(45deg, ${s.color}99 0 2px, transparent 2px 5px)` : s.fillColor}; }`).join('\n');
        document.head.append(el('style', { id: 'lm-stile', testo: STILE + campioni }));
    }
    definisciTratteggi();
    // Le zone sotto i marcatori, le strade sopra le zone.
    map.createPane('lm-zone').style.zIndex = 380;
    map.createPane('lm-strade').style.zIndex = 420;
    // I divieti ai capi delle strade chiuse sopra la linea rossa: nello stesso
    // riquadro un segnaposto più a nord finiva sotto la linea e spariva.
    map.createPane('lm-divieti').style.zIndex = 425;
    // Le etichette delle aree sotto i segnaposti delle segnalazioni e delle squadre.
    const etichettePane = map.createPane('lm-etichette');
    etichettePane.style.zIndex = 390;
    etichettePane.style.pointerEvents = 'none';
    if (map.pm) {
        map.pm.setLang('it');
        map.pm.setGlobalOptions({ snappable: true, pinning: false, templineStyle: { color: '#2563eb' }, hintlineStyle: { color: '#2563eb', dashArray: '4 4' } });
    }

    // I simboli delle aree piccole: sopra zone e strade, sotto i segnaposti.
    map.createPane('lm-simboli').style.zIndex = 450;

    const livelli = {};
    Object.keys(STILI).forEach(tipo => {
        livelli[tipo] = L.layerGroup().addTo(map);
        const campione = `<span class="lm-campione t-${tipo}${tipo === 'strada_chiusa' ? ' linea' : ''}"></span>`;
        controlloLivelli?.addOverlay(livelli[tipo], `${campione}${ETICHETTE[tipo]}`);
    });
    GRUPPI.forEach(g => controlloLivelli?.gruppo?.(g.chiave, g.titolo, g.tipi.map(t => livelli[t])));
    // Lo sfondo attenuato, spento di base (i colori pieni si leggono meglio): il
    // browser ricorda la scelta. La chiave è nuova, così chi l'aveva acceso di
    // base riparte con i colori pieni.
    const sfondo = L.layerGroup();
    sfondo.on('add', () => { map.getContainer().classList.add('lm-sfondo-attenuato'); ricorda('1'); });
    sfondo.on('remove', () => { map.getContainer().classList.remove('lm-sfondo-attenuato'); ricorda('0'); });
    function ricorda(v) { try { localStorage.setItem('orion.mappa.sfondoAttenuato2', v); } catch { /* niente */ } }
    let attenuato = false;
    try { attenuato = localStorage.getItem('orion.mappa.sfondoAttenuato2') === '1'; } catch { /* niente */ }
    if (attenuato) sfondo.addTo(map);
    controlloLivelli?.addOverlay(sfondo, 'Sfondo attenuato');

    let elementi = [];
    // [{ marcatore, strato, m }]: le etichette delle aree, che si accendono
    // solo quando l'area sullo schermo è abbastanza grande da contenerle.
    let etichette = [];
    // [{ m, presa, polo, limiti }]: le aree, per il simbolo quando sono piccole.
    let aree = [];
    let simboli = [];

    // Una strada rimasta chiusa dopo l'emergenza la gestisce chi lavora in
    // sala anche senza emergenza aperta: va riaperta quando riapre davvero.
    function puoModificare(m) {
        if (m.oltre_emergenza) return interno;
        if (m.emergency_id == null) return admin;
        return interno && emergenzaAperta();
    }

    // Un'area non ferma i clic: dentro passano alla mappa (un punto da
    // scegliere, un segnaposto, la mappa da trascinare). Si apre toccando il
    // bordo, che ha una presa larga e invisibile e si ingrossa sotto il
    // mouse, oppure il nome. Strade chiuse e aree puntiformi si toccano come prima.
    function disegnaElemento(m) {
        const s = STILI[m.tipo] || STILI.altro;
        const pane = m.tipo === 'strada_chiusa' ? 'lm-strade' : 'lm-zone';
        const gruppo = livelli[m.tipo] || livelli.altro;
        const forma = { type: 'Feature', geometry: m.geometria, properties: {} };
        const area = /Polygon/.test(m.geometria.type);
        const compagni = [];
        if (area) {
            compagni.push(L.geoJSON(forma, {
                pane, interactive: false,
                style: () => ({ color: '#fff', weight: s.weight + 4, opacity: 0.9, fill: false, lineJoin: 'round' })
            }).addTo(gruppo));
            // Le aree a tinta unita (quelle del piano) hanno in più una fascia
            // larga e trasparente del loro colore lungo il bordo: si vedono da
            // lontano senza coprirne l'interno. Le tratteggiate non ne hanno bisogno.
            if (!s.tratteggio) compagni.push(L.geoJSON(forma, {
                pane, interactive: false,
                style: () => ({ color: s.color, weight: 12, opacity: 0.22, fill: false, lineJoin: 'round' })
            }).addTo(gruppo));
        }
        const strato = L.geoJSON(forma, {
            pane, interactive: !area,
            style: () => area ? stileArea(s, m.tipo) : s,
            pointToLayer: (_, latlng) => L.circleMarker(latlng, { ...s, radius: 9, fillOpacity: 0.6, pane })
        });
        strato.addTo(gruppo);
        let presa = strato;
        if (area) {
            presa = L.geoJSON(forma, { pane, style: () => ({ color: '#000', opacity: 0, weight: 16, fill: false }) }).addTo(gruppo);
            presa.on('mouseover', () => strato.setStyle({ weight: s.weight + 2.5 }));
            presa.on('mouseout', () => strato.setStyle({ weight: s.weight }));
            compagni.push(presa);
        }
        presa.bindPopup(() => schedaPopup(m, strato), { maxWidth: 320 });
        if (area) {
            const polo = puntoInterno(m.geometria);
            if (polo) aree.push({ m, presa, polo: L.latLng(polo.lat, polo.lng), limiti: strato.getBounds() });
        }
        // Per spostare i punti l'alone e la presa si tolgono: tornano col ridisegno.
        strato.lmCompagni = compagni;
        // Ai due capi di una strada chiusa il simbolo del divieto, visibile anche da lontano.
        if (m.tipo === 'strada_chiusa') {
            const linee = m.geometria.type === 'LineString' ? [m.geometria.coordinates] : m.geometria.coordinates;
            linee.forEach(l => [l[0], l[l.length - 1]].forEach(([lng, lat]) => {
                L.marker([lat, lng], {
                    pane: 'lm-divieti', interactive: false, keyboard: false,
                    icon: L.divIcon({ className: 'lm-estremo', html: DIVIETO, iconSize: [20, 20], iconAnchor: [10, 10] })
                }).addTo(livelli.strada_chiusa);
            }));
        }
        // Il nome e il tipo delle aree (non delle strade: le dice già il divieto).
        if (m.tipo !== 'strada_chiusa' && /Polygon|Point/.test(m.geometria.type)) {
            const punto = m.geometria.type === 'Point';
            const polo = punto ? null : puntoInterno(m.geometria);
            const centro = punto ? L.latLng(m.geometria.coordinates[1], m.geometria.coordinates[0]) : polo && L.latLng(polo.lat, polo.lng);
            if (centro) {
                const tipo = [SINGOLARE[m.tipo] || m.tipo, m.livello].filter(Boolean).join(' · ');
                const html = el('div', {}, m.nome ? el('span', { testo: m.nome }) : null, el('small', { testo: tipo })).innerHTML;
                const marcatore = L.marker(centro, {
                    pane: 'lm-etichette', keyboard: false, bubblingMouseEvents: false,
                    icon: L.divIcon({ className: `lm-etichetta${punto ? ' lm-punto' : ''}`, html, iconSize: null })
                }).addTo(gruppo);
                // Il nome apre la scheda dell'area, come il bordo.
                marcatore.on('click', () => presa.openPopup(marcatore.getLatLng()));
                etichette.push({ marcatore, strato, m, polo, raggio: polo?.raggio ?? null });
                marcatore.getElement()?.style.setProperty('--lm-colore', s.color);
                marcatore.on('add', () => marcatore.getElement()?.style.setProperty('--lm-colore', s.color));
            }
        }
        return strato;
    }

    // Un'etichetta si vede da vicino (zoom 14 in su), se l'area la contiene
    // intorno al suo punto più interno, e se non si sovrappone a un'altra già
    // messa: prima quelle delle aree più grandi. Così non copre la mappa né i
    // segnaposti, e una forma a C non la manda fuori dall'area. Si rifà a ogni
    // spostamento: un'area più grande dello schermo tiene il nome in vista.
    function aggiornaEtichette() {
        const zoom = map.getZoom();
        const occupati = [];
        // Metri per pixel a questa latitudine e a questo zoom.
        const metriPixel = (lat) => 40075016.686 * Math.cos(lat * Math.PI / 180) / 2 ** (zoom + 8);
        const dimensioni = map.getSize();
        // La parte di mappa a sinistra sotto un pannello aperto (data-copre-mappa) non conta.
        const riquadro = map.getContainer().getBoundingClientRect();
        let sinistra = 0;
        document.querySelectorAll('[data-copre-mappa]').forEach(e => {
            const r = e.getBoundingClientRect();
            if (r.width && r.right > riquadro.left && r.left <= riquadro.left + 5) sinistra = Math.max(sinistra, Math.min(r.right - riquadro.left, dimensioni.x));
        });
        const b = map.getBounds();
        const vista = { ovest: map.containerPointToLatLng([sinistra, 0]).lng, sud: b.getSouth(), est: b.getEast(), nord: b.getNorth() };
        etichette
            .slice()
            .sort((x, y) => (y.raggio ?? 0) - (x.raggio ?? 0))
            .forEach(({ marcatore, m, polo, raggio }) => {
                const nodo = marcatore.getElement();
                if (!nodo) return;
                const punto = m.geometria.type === 'Point';
                let vede = zoom >= (punto ? 16 : 14);
                if (vede && !punto) {
                    // Il punto più interno di tutta l'area, se l'etichetta ci sta
                    // dentro lo schermo; se no quello della parte d'area visibile.
                    marcatore.setLatLng([polo.lat, polo.lng]);
                    nodo.hidden = false;
                    const c = map.latLngToContainerPoint(marcatore.getLatLng());
                    const mw = nodo.offsetWidth / 2 + 4, mh = nodo.offsetHeight / 2 + 4;
                    if (c.x < sinistra + mw || c.y < mh || c.x > dimensioni.x - mw || c.y > dimensioni.y - mh) {
                        const visibile = puntoInterno(m.geometria, vista);
                        if (visibile && visibile.raggio > 0) {
                            marcatore.setLatLng([visibile.lat, visibile.lng]);
                            raggio = visibile.raggio;
                        } else vede = false;
                    }
                }
                if (vede) {
                    nodo.hidden = false;
                    const w = nodo.offsetWidth, h = nodo.offsetHeight;
                    if (!punto) {
                        // Il cerchio più grande dentro l'area, in pixel: deve
                        // contenere l'altezza della scritta e buona parte della larghezza.
                        const diametro = 2 * raggio / metriPixel(marcatore.getLatLng().lat);
                        if (diametro < h + 6 || diametro < w * 0.75) vede = false;
                    }
                    if (vede) {
                        const c = map.latLngToContainerPoint(marcatore.getLatLng());
                        const r = { x1: c.x - w / 2 - 4, x2: c.x + w / 2 + 4, y1: c.y - h / 2 - 2, y2: c.y + h / 2 + 2 };
                        if (occupati.some(o => r.x1 < o.x2 && r.x2 > o.x1 && r.y1 < o.y2 && r.y2 > o.y1)) vede = false;
                        else occupati.push(r);
                    }
                }
                nodo.hidden = !vede;
            });
    }
    // Un'area più piccola di AREA_PICCOLA pixel sullo schermo diventa un
    // simbolo di misura fissa, col colore e l'icona del tipo: a zoom 12-13 un
    // campo sportivo è di pochi pixel e non lo si vedrebbe. I simboli dello
    // stesso tipo che si toccano diventano uno solo, con il numero; toccarlo
    // avvicina la mappa su quelle aree, toccare un simbolo singolo ne apre la
    // scheda. Avvicinandosi il simbolo lascia il posto alla forma.
    function aggiornaSimboli() {
        simboli.forEach(({ marcatore, gruppo }) => gruppo.removeLayer(marcatore));
        simboli = [];
        const gruppi = new Map();
        const vista = map.getBounds().pad(0.2);
        aree.forEach(a => {
            const gruppo = livelli[a.m.tipo] || livelli.altro;
            if (!map.hasLayer(gruppo) || !vista.intersects(a.limiti)) return;
            const nw = map.latLngToContainerPoint(a.limiti.getNorthWest()), se = map.latLngToContainerPoint(a.limiti.getSouthEast());
            if (Math.max(Math.abs(se.x - nw.x), Math.abs(se.y - nw.y)) >= AREA_PICCOLA) return;
            const punto = map.latLngToContainerPoint(a.polo);
            const tipo = a.m.tipo in ICONE ? a.m.tipo : 'altro';
            if (!gruppi.has(tipo)) gruppi.set(tipo, []);
            // Accanto a un simbolo già messo dello stesso tipo: si unisce.
            const vicino = gruppi.get(tipo).find(g => g.punto.distanceTo(punto) < 26);
            if (vicino) vicino.aree.push(a);
            else gruppi.get(tipo).push({ punto, aree: [a] });
        });
        // Simboli di tipi diversi non si coprono: chi trova il posto occupato
        // si sposta di poco, sul primo posto libero attorno al suo punto.
        const occupati = [];
        const libero = (p) => occupati.every(q => q.distanceTo(p) >= 27);
        const giri = [[0, 0]];
        [[28, 8], [48, 12], [68, 16]].forEach(([r, n]) => { for (let i = 0; i < n; i++) giri.push([r * Math.cos(2 * Math.PI * i / n - Math.PI / 2), r * Math.sin(2 * Math.PI * i / n - Math.PI / 2)]); });
        gruppi.forEach((elenco, tipo) => elenco.forEach(({ aree: insieme }) => {
            const s = STILI[tipo] || STILI.altro;
            const gruppo = livelli[tipo] || livelli.altro;
            const centro = map.latLngToContainerPoint(insieme.length === 1 ? insieme[0].polo
                : L.latLng(insieme.reduce((t, a) => t + a.polo.lat, 0) / insieme.length, insieme.reduce((t, a) => t + a.polo.lng, 0) / insieme.length));
            const posto = giri.map(([dx, dy]) => centro.add([dx, dy])).find(libero) || centro;
            occupati.push(posto);
            const dove = map.containerPointToLatLng(posto);
            const pericolo = tipo.startsWith('pericolo');
            const html = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONE[tipo]}</svg>${insieme.length > 1 ? `<b>${insieme.length}</b>` : ''}`;
            const marcatore = L.marker(dove, {
                pane: 'lm-simboli', keyboard: false, bubblingMouseEvents: false,
                title: insieme.map(a => a.m.nome || SINGOLARE[a.m.tipo]).join(', '),
                icon: L.divIcon({ className: `lm-simbolo${pericolo ? ' lm-pericolo-simbolo' : ''}`, html, iconSize: null })
            });
            marcatore.on('add', () => marcatore.getElement()?.style.setProperty('--lm-colore', s.color));
            marcatore.on('click', () => {
                if (insieme.length === 1) insieme[0].presa.openPopup(insieme[0].polo);
                else map.fitBounds(insieme.reduce((b, a) => b.extend(a.limiti), L.latLngBounds(insieme[0].limiti.getSouthWest(), insieme[0].limiti.getNorthEast())), { padding: [80, 80], maxZoom: 17 });
            });
            gruppo.addLayer(marcatore);
            simboli.push({ marcatore, gruppo });
        }));
    }
    map.on('moveend resize overlayadd overlayremove', aggiornaEtichette);
    map.on('zoomend moveend resize overlayadd overlayremove', aggiornaSimboli);

    function schedaPopup(m, strato) {
        const s = STILI[m.tipo] || STILI.altro;
        const azioni = el('div', { class: 'lm-azioni' });
        if (puoModificare(m)) {
            azioni.append(
                el('button', { type: 'button', testo: 'Modifica', suClick: () => { map.closePopup(); apriModulo({ elemento: m }); } }),
                el('button', { type: 'button', testo: 'Sposta i punti', suClick: () => { map.closePopup(); modificaForma(m, strato); } }),
                el('button', { type: 'button', class: 'lm-pericolo', testo: m.tipo === 'strada_chiusa' ? 'Riapri la strada' : 'Togli', suClick: () => togli(m) }));
            // Durante l'emergenza si decide se resterà anche dopo la chiusura.
            if (DURANO.includes(m.tipo) && m.emergency_id != null && emergenzaAperta()) {
                azioni.append(el('button', {
                    type: 'button',
                    testo: m.oltre_emergenza ? 'Finisce con l\'emergenza' : 'Resta dopo l\'emergenza',
                    title: m.oltre_emergenza ? 'Alla chiusura dell\'emergenza sparisce dalla mappa' : 'Resta sulla mappa anche dopo la chiusura, finché non la si toglie',
                    suClick: () => oltreEmergenza(m, !m.oltre_emergenza)
                }));
            }
        }
        const delPiano = m.emergency_id == null && !m.oltre_emergenza;
        return el('div', { class: 'lm-popup' },
            el('span', { class: 'lm-tipo', style: `color:${s.color}`, testo: `${SINGOLARE[m.tipo] || m.tipo}${delPiano ? ' · piano' : ''}` }),
            m.oltre_emergenza ? el('div', { class: 'lm-meta', testo: emergenzaAperta() && m.emergency_id != null
                ? 'Resta in vigore anche dopo la chiusura dell\'emergenza.' : 'In vigore da un\'emergenza chiusa: si toglie quando riapre.' }) : null,
            el('strong', { testo: m.nome || '(senza nome)' }),
            m.livello ? el('div', { testo: `Livello: ${m.livello}` }) : null,
            m.note ? el('div', { testo: m.note }) : null,
            el('div', { class: 'lm-meta', testo: [m.creato_da ? `${delPiano ? 'Inserito' : 'Dalle'} ${quando(m.creato_il)} · ${m.creato_da}` : null,
                m.modificato_il ? `modificato ${quando(m.modificato_il)}` : null, m.origine ? `da ${m.origine}` : null].filter(Boolean).join(' · ') }),
            azioni.childNodes.length ? azioni : null);
    }

    async function carica() {
        try {
            const dati = await fetchApi('/api/mappa/elementi');
            elementi = [...(dati.piano || []), ...(dati.emergenza || [])];
        } catch (e) {
            console.warn('[Mappa] Elementi non caricati:', e.message);
            return;
        }
        Object.values(livelli).forEach(l => l.clearLayers());
        etichette = [];
        aree = [];
        simboli = [];
        elementi.forEach(disegnaElemento);
        aggiornaEtichette();
        aggiornaSimboli();
    }

    async function oltreEmergenza(m, si) {
        try {
            await fetchApi(`/api/mappa/elementi/${m.id}`, { method: 'PUT', body: JSON.stringify({ oltre_emergenza: si }) });
            map.closePopup();
            notifica(si ? 'Resterà sulla mappa anche dopo la chiusura dell\'emergenza.' : 'Finirà con l\'emergenza.', 'successo');
            await carica();
        } catch (e) { notifica(e.message, 'errore'); }
    }

    async function togli(m) {
        const domanda = m.tipo === 'strada_chiusa' ? `Riaprire "${m.nome || 'la strada'}"? Resta nel registro dell'emergenza.`
            : m.emergency_id == null && !m.oltre_emergenza ? `Togliere "${m.nome || 'l\'elemento'}" dal piano?` : `Togliere "${m.nome || 'l\'elemento'}"?`;
        if (!window.confirm(domanda)) return;
        try {
            const r = await fetchApi(`/api/mappa/elementi/${m.id}`, { method: 'DELETE' });
            map.closePopup();
            notifica(r.message, 'successo');
            await carica();
        } catch (e) { notifica(e.message, 'errore'); }
    }

    // --- Guida in alto: cosa fare adesso, e come annullare ------------------
    let guida = null;
    function mostraGuida(testo, pulsanti = []) {
        togliGuida();
        guida = el('div', { class: 'lm-guida', role: 'status' }, el('span', { testo }), pulsanti);
        map.getContainer().append(guida);
    }
    function togliGuida() { guida?.remove(); guida = null; }

    // Mentre si disegna, le forme che ci sono già non prendono i tocchi: una
    // zona disegnata dentro un'altra apriva il riquadro di quella sotto.
    function inDisegno(si) {
        if (si) map.closePopup();
        map.getContainer().classList.toggle('lm-disegnando', si);
    }

    let annullaCorrente = null;
    function annulla() {
        annullaCorrente?.();
        annullaCorrente = null;
        togliGuida();
    }
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && annullaCorrente) annulla(); });

    // --- Strada chiusa: inizio e fine, la linea segue la strada --------------
    function stradaDaDueTocchi() {
        annulla();
        const punti = [];
        const segni = L.layerGroup().addTo(map);
        map.getContainer().style.cursor = 'crosshair';
        inDisegno(true);
        const fine = () => { map.off('click', tocco); map.getContainer().style.cursor = ''; segni.remove(); inDisegno(false); };
        annullaCorrente = fine;
        mostraGuida('Tocca l\'inizio del tratto chiuso', [el('button', { type: 'button', testo: 'Annulla', suClick: annulla })]);
        async function tocco(ev) {
            punti.push(ev.latlng);
            L.circleMarker(ev.latlng, { radius: 7, color: '#dc2626', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(segni);
            if (punti.length === 1) {
                mostraGuida('Ora tocca la fine del tratto', [el('button', { type: 'button', testo: 'Annulla', suClick: annulla })]);
                return;
            }
            map.off('click', tocco);
            map.getContainer().style.cursor = '';
            mostraGuida('Cerco la strada fra i due punti…');
            const percorso = await calcolaPercorso(punti[0], punti[1]);
            const anteprima = L.polyline(percorso.punti, { ...STILI.strada_chiusa, opacity: 0.6 }).addTo(segni);
            const coordinate = percorso.punti.map(([lat, lng]) => [lng, lat]);
            const nota = percorso.stradale ? `Il tratto segue la strada (${Math.round(percorso.metri)} m).` : 'Il servizio delle strade non risponde: è una linea dritta, puoi correggerla dopo con "Sposta i punti".';
            mostraGuida(nota, [
                el('button', { type: 'button', testo: 'Annulla', suClick: annulla }),
                el('button', { type: 'button', class: 'lm-ok', testo: 'Va bene', suClick: () => {
                    const geometria = { type: 'LineString', coordinates: coordinate };
                    annulla();
                    apriModulo({ tipo: 'strada_chiusa', geometria });
                } })]);
            map.fitBounds(anteprima.getBounds(), { padding: [60, 60], maxZoom: 17 });
        }
        map.on('click', tocco);
    }

    // --- A mano: una linea o un'area con Geoman -------------------------------
    function disegnaAMano(forma, tipo) {
        annulla();
        if (!map.pm) { notifica('Lo strumento di disegno non è caricato.', 'errore'); return; }
        const quale = forma === 'linea' ? 'Line' : 'Polygon';
        inDisegno(true);
        map.pm.enableDraw(quale, { finishOn: forma === 'linea' ? 'dblclick' : null });
        mostraGuida(forma === 'linea' ? 'Tocca i punti della strada; doppio clic sull\'ultimo per finire' : 'Tocca i vertici della zona; tocca il primo per chiuderla',
            [el('button', { type: 'button', testo: 'Annulla', suClick: annulla })]);
        const creato = (ev) => {
            const geometria = ev.layer.toGeoJSON().geometry;
            ev.layer.remove();
            annullaCorrente = null;
            pulisci();
            togliGuida();
            apriModulo({ tipo, geometria });
        };
        const pulisci = () => { map.off('pm:create', creato); map.pm.disableDraw(); inDisegno(false); };
        annullaCorrente = pulisci;
        map.on('pm:create', creato);
    }

    // --- Spostare i punti di un elemento esistente ---------------------------
    function modificaForma(m, strato) {
        annulla();
        const forme = [];
        strato.lmCompagni?.forEach(l => l.remove());
        strato.eachLayer(l => { if (l.pm) { l.pm.enable({ allowSelfIntersection: false }); forme.push(l); } });
        if (!forme.length) { notifica('Questa forma non si modifica a mano.', 'attenzione'); return; }
        inDisegno(true);
        // La forma che si modifica resta toccabile: i suoi punti si trascinano.
        forme.forEach(l => l.getElement?.()?.style.setProperty('pointer-events', 'auto'));
        const fine = () => { forme.forEach(l => { l.pm.disable(); l.getElement?.()?.style.removeProperty('pointer-events'); }); inDisegno(false); };
        annullaCorrente = () => { fine(); carica(); };
        mostraGuida('Trascina i punti; poi salva', [
            el('button', { type: 'button', testo: 'Annulla', suClick: annulla }),
            el('button', { type: 'button', class: 'lm-ok', testo: 'Salva la forma', suClick: async () => {
                const geometria = forme[0].toGeoJSON().geometry;
                fine();
                annullaCorrente = null;
                togliGuida();
                try {
                    await fetchApi(`/api/mappa/elementi/${m.id}`, { method: 'PUT', body: JSON.stringify({ tipo: m.tipo, geometria }) });
                    notifica('Forma salvata.', 'successo');
                } catch (e) { notifica(e.message, 'errore'); }
                carica();
            } })]);
    }

    // --- Il modulo dei dati: tipo, nome, livello, note, piano o emergenza ----
    function apriModulo({ elemento = null, tipo = null, geometria = null }) {
        const forma = (elemento?.geometria || geometria).type;
        const ammessi = forma.includes('Line') ? ['strada_chiusa', 'altro'] : forma === 'Point' ? ['area_attesa', 'area_accoglienza', 'area_ammassamento', 'altro'] : TIPI_AREA;
        const sceltaTipo = el('select', {}, ammessi.map(t => el('option', { value: t, testo: SINGOLARE[t], selected: (elemento?.tipo || tipo) === t })));
        const nome = el('input', { type: 'text', maxlength: 150, value: elemento?.nome || '', placeholder: forma.includes('Line') ? 'Via Col di Salce, dal ponte al bivio' : 'Nome della zona o dell\'area' });
        const livello = el('input', { type: 'text', maxlength: 40, value: elemento?.livello || '', placeholder: 'P1, P2, P3, elevata…' });
        const campoLivello = el('label', { class: 'lm-campo' }, 'Livello di pericolosità', livello);
        const note = el('textarea', { rows: 3, maxlength: 2000, placeholder: forma.includes('Line') ? 'Perché è chiusa, deviazioni, chi presidia' : '' });
        note.value = elemento?.note || '';
        const piano = el('input', { type: 'checkbox' });
        const rigaPiano = el('label', { class: 'lm-spunta' }, piano, el('span', {}, 'Del piano: resta anche dopo l\'emergenza (zone di pericolosità, aree d\'emergenza).'));
        const errore = el('p', { class: 'lm-errore', hidden: true });
        const aggiornaCampi = () => {
            const t = sceltaTipo.value;
            campoLivello.hidden = !t.startsWith('pericolo');
            // Nuovo elemento: l'amministratore sceglie; un operatore disegna solo per l'emergenza.
            rigaPiano.hidden = !!elemento || !admin;
            if (!elemento && admin) piano.checked = DEL_PIANO.includes(t) || !emergenzaAperta();
        };
        sceltaTipo.addEventListener('change', aggiornaCampi);
        aggiornaCampi();
        const salva = el('button', { type: 'submit', class: 'button-style', testo: 'Salva' });
        const chiudi = () => velo.remove();
        const form = el('form', {},
            el('h2', { testo: elemento ? `Modifica: ${SINGOLARE[elemento.tipo]}` : 'Che cos\'è?' }),
            el('label', { class: 'lm-campo' }, 'Tipo', sceltaTipo),
            el('label', { class: 'lm-campo' }, 'Dove / nome', nome),
            campoLivello,
            el('label', { class: 'lm-campo' }, 'Note', note),
            rigaPiano, errore,
            el('div', { class: 'lm-pulsanti' }, el('button', { type: 'button', class: 'button-style button-secondary', testo: 'Annulla', suClick: chiudi }), salva));
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            errore.hidden = true;
            const corpo = { tipo: sceltaTipo.value, nome: nome.value, livello: campoLivello.hidden ? '' : livello.value, note: note.value };
            if (!elemento) { corpo.geometria = geometria; corpo.piano = admin && piano.checked; }
            if (!elemento && !corpo.piano && !emergenzaAperta()) {
                errore.textContent = 'Senza un\'emergenza aperta si salvano solo elementi del piano.';
                errore.hidden = false;
                return;
            }
            salva.disabled = true;
            try {
                await fetchApi(elemento ? `/api/mappa/elementi/${elemento.id}` : '/api/mappa/elementi', { method: elemento ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
                chiudi();
                await carica();
                // Il livello appena usato si accende, se era spento.
                if (!map.hasLayer(livelli[corpo.tipo])) livelli[corpo.tipo].addTo(map);
            } catch (e) {
                errore.textContent = e.message;
                errore.hidden = false;
                salva.disabled = false;
            }
        });
        const velo = el('div', { class: 'lm-velo', suClick: (ev) => { if (ev.target === velo) chiudi(); } },
            el('div', { class: 'lm-finestra', role: 'dialog', 'aria-modal': 'true' }, form));
        document.body.append(velo);
        nome.focus();
    }

    // --- Il pulsante "Disegna" in basso a sinistra -----------------------------
    if (interno || admin) {
        const Controllo = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd() {
                const box = L.DomUtil.create('div', 'leaflet-bar lm-disegna');
                L.DomEvent.disableClickPropagation(box);
                L.DomEvent.disableScrollPropagation(box);
                const menu = el('div', { class: 'lm-menu', hidden: true, role: 'menu' });
                const voce = (titolo, sotto, azione) => el('button', { type: 'button', role: 'menuitem', suClick: () => { menu.hidden = true; azione(); } },
                    el('span', {}, titolo, sotto ? el('small', { testo: sotto }) : null));
                const riempi = () => {
                    const aperta = emergenzaAperta();
                    // replaceChildren non salta i null come el(): li scriverebbe come testo.
                    menu.replaceChildren(...[
                        aperta ? voce('Strada chiusa', 'Tocca l\'inizio e la fine: la linea segue la strada', stradaDaDueTocchi) : null,
                        aperta ? voce('Strada chiusa, a mano', 'Se il servizio delle strade non risponde', () => disegnaAMano('linea', 'strada_chiusa')) : null,
                        aperta ? voce('Zona interdetta', 'Disegna il contorno', () => disegnaAMano('area', 'zona_interdetta')) : null,
                        voce('Zona di pericolo', 'Alluvione, frana o altro pericolo (incendio, crollo, gas…)', () => disegnaAMano('area', 'pericolo_generico')),
                        voce('Area del piano', 'Attesa, accoglienza, ammassamento soccorritori', () => disegnaAMano('area', 'area_attesa'))
                    ].filter(Boolean));
                    if (!aperta && !admin) menu.replaceChildren(el('div', { class: 'lm-meta', style: 'padding:8px', testo: 'Senza un\'emergenza aperta non c\'è niente da disegnare.' }));
                };
                const apri = el('button', { type: 'button', title: 'Disegna sulla mappa: strade chiuse e zone', 'aria-label': 'Disegna sulla mappa',
                    suClick: () => { riempi(); menu.hidden = !menu.hidden; } });
                apri.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 6l3 3" stroke="currentColor" stroke-width="2"/></svg>';
                document.addEventListener('click', (ev) => { if (!box.contains(ev.target)) menu.hidden = true; });
                box.append(apri, menu);
                return box;
            }
        });
        new Controllo().addTo(map);
    }

    document.addEventListener('ws:reload_mappa', carica);
    carica();
    return { carica, aggiornaEtichette };
}
