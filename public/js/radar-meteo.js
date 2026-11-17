// Pioggia e fulmini del Dipartimento della Protezione Civile (Radar-DPC, licenza CC BY-SA).

const API = 'https://radar-api.protezionecivile.it/findLastProductByType?type=SRI';
// L'archivio da cui legge la piattaforma radar.protezionecivile.it: non è documentato e può
// cambiare senza preavviso, quindi tutto quello che arriva da lì si controlla prima di usarlo.
const ARCHIVIO = 'https://s3-prod-dpc-radar-webp-cache.s3.eu-south-1.amazonaws.com';
const WMS = 'https://radar-geowebcache.protezionecivile.it/service/wms';
const PASSO_MS = 5 * 60_000;
const FOTOGRAMMI = 12;
const CONTROLLA_OGNI_MS = 2 * 60_000;
const FERMO_DOPO_MS = 30 * 60_000;
const RIPROVA_ARCHIVIO_MS = 10 * 60_000;
const ATTESA_RETE_MS = 10_000;
const FILE_FULMINI = 6;
const FOTOGRAMMO_MS = 600;
const PAUSA_ULTIMO_MS = 1800;
const TESSERE_IN_MEMORIA = 200;
// Le tessere dei dati esistono a due livelli di zoom e solo sopra l'Italia; la tessera di
// prova, sull'Italia centrale, c'è sempre.
const COPERTURA = { 6: { x: [32, 35], y: [21, 25] }, 7: { x: [65, 71], y: [43, 51] } };
const TESSERA_DI_PROVA = { z: 7, x: 68, y: 47 };
const CHIAVE_RADAR = 'orion.radar.acceso';
const CHIAVE_FULMINI = 'orion.fulmini.acceso';
const ATTRIBUZIONE = 'Pioggia e fulmini: <a href="https://radar.protezionecivile.it" target="_blank" rel="noopener">Radar-DPC</a> (CC BY-SA)';
const GUASTA = Symbol('guasta');

const liscio = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const misto = (p, q, f) => p.map((v, i) => v + (q[i] - v) * f);

// La scala della piattaforma del Dipartimento, da 0 a 100 mm/h, tranne la pioggia debole: là è
// verdina e quasi trasparente fino a 5 mm/h, sulla mappa chiara della sala non si vedrebbe.
export function colorePioggia(t) {
    const A = misto([0.45, 0.75, 1], [0, 0.8, 1], liscio(0, 0.08, t));
    const B = misto([0, 0.8, 0], [1, 1, 0], liscio(0.12, 0.3, t));
    const D = misto([1, 0.65, 0.3], [1, 0, 0.3], liscio(0.4, 0.7, t));
    const E = misto(D, [0.6, 0, 0.8], liscio(0.7, 1, t));
    const c = misto(t < 0.2 ? A : B, E, liscio(0.35, 1, t));
    return [...c.map(v => Math.round(v * 255)), Math.round(liscio(0.006, 0.02, t) * 255)];
}
const TAVOLOZZA = Array.from({ length: 256 }, (_, v) => colorePioggia(v / 255));

// Il dato sta nel rosso (0-255 per 0-100 mm/h); se arrivano colori veri il formato è cambiato.
export function coloraTessera(px, larghezza, altezza) {
    if (larghezza !== 256 || altezza !== 256 || px.length !== 256 * 256 * 4) return false;
    let pieni = 0;
    let colorati = 0;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i] || px[i + 1] || px[i + 2]) {
            pieni++;
            if (px[i + 1] > 24 || px[i + 2] > 24) colorati++;
        }
    }
    if (pieni > 200 && colorati > pieni * 0.05) return false;
    for (let i = 0; i < px.length; i += 4) {
        const [r, g, b, a] = px[i + 3] < 2 ? [0, 0, 0, 0] : TAVOLOZZA[px[i]];
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
    return true;
}

// Formato 2 dei file dei fulmini, come lo legge la piattaforma: null se non torna.
export function leggiFulmini(buffer) {
    const v = new DataView(buffer);
    if (v.byteLength < 3 || v.getUint8(0) !== 2) return null;
    const quanti = v.getUint16(1, false);
    const punti = [];
    let o = 3;
    for (let i = 0; i < quanti; i++) {
        if (o + 6 > v.byteLength) return null;
        const alti = v.getUint8(o + 4);
        const x = v.getUint16(o, false) + ((alti >> 6) & 3) * 65536;
        const y = v.getUint16(o + 2, false) + ((alti >> 4) & 3) * 65536;
        o += v.getUint8(o + 5) < 255 ? 6 : 8;
        const lon = x * (360 / 262144) - 180;
        const lat = y * (180 / 262144) - 90;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        punti.push([lat, lon]);
    }
    return o <= v.byteLength ? punti : null;
}

export function pezziDellaTessera({ x, y, z }) {
    const pezzi = [];
    if (z >= 7) {
        const k = 2 ** (z - 7);
        const tx = Math.floor(x / k);
        const ty = Math.floor(y / k);
        const lato = 256 / k;
        pezzi.push({ z: 7, x: tx, y: ty, sx: (x - tx * k) * lato, sy: (y - ty * k) * lato, sl: lato, dx: 0, dy: 0, dl: 256 });
    } else {
        const n = 2 ** (6 - z);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            pezzi.push({ z: 6, x: x * n + i, y: y * n + j, sx: 0, sy: 0, sl: 256, dx: i * 256 / n, dy: j * 256 / n, dl: 256 / n });
        }
    }
    return pezzi.filter(p => {
        const c = COPERTURA[p.z];
        return p.x >= c.x[0] && p.x <= c.x[1] && p.y >= c.y[0] && p.y <= c.y[1];
    });
}

const due = (n) => String(n).padStart(2, '0');
export function indirizzoTessera(istante, { z, x, y }) {
    const d = new Date(istante);
    return `${ARCHIVIO}/SRI/${d.getUTCFullYear()}/${due(d.getUTCMonth() + 1)}/${due(d.getUTCDate())}/${due(d.getUTCHours())}${due(d.getUTCMinutes())}/${z}/${x}/${y}/sri.webp`;
}

const ora = (ms) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

export function testoStato({ modo, ultimo, istante, adesso = Date.now(), raggiungibile = true }) {
    if (!raggiungibile) return { testo: Number.isFinite(ultimo) ? `Radar non raggiungibile: resta l'immagine delle ${ora(ultimo)}` : 'Radar non raggiungibile', grave: true };
    if (adesso - ultimo > FERMO_DOPO_MS) return { testo: `Radar fermo alle ${ora(ultimo)}`, grave: true };
    if (modo === 'diretta') return { testo: "Solo l'ultima immagine: l'archivio del radar non risponde come previsto.", grave: false };
    const minuti = Math.round((ultimo - istante) / 60_000);
    return { testo: minuti <= 0 ? "L'ultima immagine" : `${minuti} minuti prima dell'ultima`, grave: false };
}

async function scarica(url) {
    const fermo = new AbortController();
    const timer = setTimeout(() => fermo.abort(), ATTESA_RETE_MS);
    try {
        return await fetch(url, { signal: fermo.signal, mode: 'cors' });
    } finally {
        clearTimeout(timer);
    }
}

async function ultimoIstante() {
    try {
        const r = await scarica(API);
        if (!r.ok) return null;
        const t = Number((await r.json())?.lastProducts?.[0]?.time);
        return Number.isFinite(t) && t > 0 ? t : null;
    } catch {
        return null;
    }
}

async function caricaTessera(url) {
    const r = await scarica(url);
    if (r.status === 403 || r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    let immagine;
    try {
        immagine = await createImageBitmap(await r.blob());
    } catch {
        return GUASTA;
    }
    const tela = document.createElement('canvas');
    tela.width = immagine.width;
    tela.height = immagine.height;
    const g = tela.getContext('2d', { willReadFrequently: true });
    g.drawImage(immagine, 0, 0);
    immagine.close?.();
    const px = g.getImageData(0, 0, tela.width, tela.height);
    if (!coloraTessera(px.data, tela.width, tela.height)) return GUASTA;
    g.putImageData(px, 0, 0);
    return tela;
}

async function caricaFulmini(istante) {
    const r = await scarica(`${ARCHIVIO}/LGT/lgt_5min_${istante}.bin`);
    if (r.status === 403 || r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return leggiFulmini(await r.arrayBuffer()) ?? GUASTA;
}

const STILE = `
.radar-pannello { position: absolute; left: 10px; bottom: 24px; z-index: 1000; background: var(--surface-color, #fff); color: var(--text-color, #111); border: 1px solid var(--border-color, #ccc); border-radius: 10px; padding: 8px 10px; font-size: .8rem; box-shadow: 0 2px 8px rgba(0,0,0,.18); width: 240px; max-width: calc(100% - 20px); box-sizing: border-box; display: flex; flex-direction: column; gap: 5px; cursor: default; }
.radar-pannello[hidden], .radar-pannello [hidden] { display: none !important; }
.radar-riga { display: flex; align-items: center; gap: 8px; }
.radar-gioca { width: 32px; height: 32px; flex: none; border-radius: 8px; border: 1px solid var(--border-color, #ccc); background: var(--surface-color, #fff); color: inherit; cursor: pointer; font-size: .85rem; line-height: 1; }
.radar-gioca:hover { background: var(--secondary-bg-color, #eef2f7); }
.radar-scorri { flex: 1; min-width: 0; }
.radar-ora { font-weight: 700; font-size: .9rem; font-variant-numeric: tabular-nums; }
.radar-stato { color: var(--text-muted, #64748b); }
.radar-stato.grave { color: var(--danger-text, #b91c1c); font-weight: 600; }
.radar-barra { height: 8px; border-radius: 4px; }
.radar-tacche { display: flex; justify-content: space-between; color: var(--text-muted, #64748b); font-size: .7rem; }
.radar-diretta { filter: url(#radar-solo-pioggia); }
`;

// Il livello di riserva (WMS) vela di nero trasparente l'area coperta e non ha CORS: il filtro
// SVG toglie il nero (somma dei colori zero) e rende piena la pioggia.
const FILTRO = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">
<filter id="radar-solo-pioggia" color-interpolation-filters="sRGB">
<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0.4 0.4 0.4 1.5 -0.3"/>
</filter></svg>`;

const ricorda = (chiave, si) => { try { if (si) localStorage.setItem(chiave, '1'); else localStorage.removeItem(chiave); } catch { /* resta per questa pagina */ } };
const ricordato = (chiave) => { try { return localStorage.getItem(chiave) === '1'; } catch { return false; } };

export function aggiungiRadar(map, controllo) {
    if (!document.getElementById('radar-stile')) {
        const stile = document.createElement('style');
        stile.id = 'radar-stile';
        stile.textContent = STILE;
        document.head.append(stile);
        document.body.insertAdjacentHTML('beforeend', FILTRO);
    }

    const stato = { modo: null, ultimo: null, raggiungibile: true, istanti: [], indice: -1, provatoIl: 0, giocando: null, carico: null, corsa: 0 };
    const tessereDati = new Map();
    const tessereMappa = new Map();
    const fileFulmini = new Map();

    function tessera(istante, pezzo) {
        const chiave = `${istante}|${pezzo.z}/${pezzo.x}/${pezzo.y}`;
        let v = tessereDati.get(chiave);
        if (v) {
            tessereDati.delete(chiave);
        } else {
            v = caricaTessera(indirizzoTessera(istante, pezzo)).catch(() => {
                tessereDati.delete(chiave);
                return null;
            });
        }
        tessereDati.set(chiave, v);
        while (tessereDati.size > TESSERE_IN_MEMORIA) tessereDati.delete(tessereDati.keys().next().value);
        return v;
    }

    // Quelli che mancano possono arrivare dopo (escono con dieci minuti di ritardo): si richiedono.
    function fulminiDi(istante) {
        const v = fileFulmini.get(istante);
        if (v && (v.valore !== null || Date.now() - v.quando < CONTROLLA_OGNI_MS)) return v.promessa;
        const promessa = caricaFulmini(istante).catch(() => null).then(valore => {
            fileFulmini.set(istante, { promessa, valore, quando: Date.now() });
            return valore;
        });
        fileFulmini.set(istante, { promessa, valore: undefined, quando: Date.now() });
        for (const t of fileFulmini.keys()) if (t < istante - 2 * FOTOGRAMMI * PASSO_MS) fileFulmini.delete(t);
        return promessa;
    }

    const Griglia = L.GridLayer.extend({
        createTile(coords) {
            const tela = document.createElement('canvas');
            tela.width = tela.height = 256;
            const voce = { tela, coords, segno: 0 };
            tessereMappa.set(`${coords.z}/${coords.x}/${coords.y}`, voce);
            dipingi(voce);
            return tela;
        }
    });
    const griglia = new Griglia({ minZoom: 5, maxZoom: 20, opacity: 0.6, zIndex: 5, attribution: ATTRIBUZIONE });
    griglia.on('tileunload', (e) => tessereMappa.delete(`${e.coords.z}/${e.coords.x}/${e.coords.y}`));
    const diretta = L.tileLayer.wms(WMS, {
        layers: 'radar:sri', format: 'image/png', transparent: true, version: '1.1.1', tiled: true, agg: 0,
        opacity: 0.6, className: 'radar-diretta', zIndex: 5, maxZoom: 20, attribution: ATTRIBUZIONE
    });
    const radar = L.layerGroup();
    const fulmini = L.layerGroup();
    const disegnoFulmini = L.canvas({ padding: 0.2 });

    async function dipingi(voce) {
        const istante = stato.istanti[stato.indice];
        if (stato.modo !== 'archivio' || istante == null) return;
        const segno = ++voce.segno;
        const pezzi = pezziDellaTessera(voce.coords);
        const immagini = await Promise.all(pezzi.map(p => tessera(istante, p)));
        if (segno !== voce.segno) return;
        if (immagini.includes(GUASTA)) return guasto('una tessera del radar non è nel formato atteso');
        const g = voce.tela.getContext('2d');
        g.clearRect(0, 0, 256, 256);
        g.imageSmoothingEnabled = true;
        pezzi.forEach((p, i) => { if (immagini[i]) g.drawImage(immagini[i], p.sx, p.sy, p.sl, p.sl, p.dx, p.dy, p.dl, p.dl); });
    }

    function guasto(perche) {
        if (stato.modo !== 'archivio') return;
        console.warn(`[radar] passo all'ultima immagine: ${perche}`);
        ferma();
        usa('diretta');
        stato.provatoIl = Date.now();
        mostra(stato.istanti.length - 1);
    }

    function usa(modo) {
        if (stato.modo === modo) return;
        stato.modo = modo;
        if (modo === 'archivio') {
            radar.removeLayer(diretta);
            radar.addLayer(griglia);
        } else {
            radar.removeLayer(griglia);
            radar.addLayer(diretta);
            if (stato.ultimo) diretta.setParams({ agg: stato.ultimo });
        }
    }

    // L'ultima immagine dell'archivio può arrivare qualche minuto dopo l'annuncio dell'API.
    async function ultimoInArchivio(annunciato) {
        for (let k = 0; k < 3; k++) {
            const t = annunciato - k * PASSO_MS;
            const prova = await tessera(t, TESSERA_DI_PROVA);
            if (prova === GUASTA) return null;
            if (prova) return t;
        }
        return null;
    }

    async function aggiorna() {
        const annunciato = await ultimoIstante();
        stato.raggiungibile = annunciato !== null;
        if (annunciato !== null) {
            let ultimo = annunciato;
            if (map.hasLayer(radar)) {
                const daProvare = stato.modo !== 'diretta' || Date.now() - stato.provatoIl > RIPROVA_ARCHIVIO_MS;
                const inArchivio = daProvare ? await ultimoInArchivio(annunciato) : null;
                if (inArchivio !== null) {
                    usa('archivio');
                    ultimo = inArchivio;
                } else if (daProvare) {
                    if (stato.modo === 'archivio') console.warn("[radar] l'archivio non risponde come previsto: passo all'ultima immagine");
                    usa('diretta');
                    stato.provatoIl = Date.now();
                }
                if (stato.modo === 'diretta') diretta.setParams({ agg: annunciato });
            }
            const allUltimo = stato.indice < 0 || stato.indice === stato.istanti.length - 1;
            const prima = stato.istanti[stato.indice];
            stato.ultimo = ultimo;
            stato.istanti = Array.from({ length: FOTOGRAMMI }, (_, i) => ultimo - (FOTOGRAMMI - 1 - i) * PASSO_MS);
            const ritrovato = stato.istanti.indexOf(prima);
            stato.indice = allUltimo || ritrovato < 0 ? stato.istanti.length - 1 : ritrovato;
        }
        mostra(stato.indice);
    }

    function mostra(indice) {
        stato.indice = indice;
        if (stato.modo === 'archivio') tessereMappa.forEach(dipingi);
        disegnaFulmini();
        aggiornaPannello();
    }

    let segnoFulmini = 0;
    async function disegnaFulmini() {
        if (!map.hasLayer(fulmini)) return;
        const fine = stato.modo === 'archivio' && map.hasLayer(radar) ? stato.istanti[stato.indice] : stato.ultimo;
        if (fine == null) return;
        const segno = ++segnoFulmini;
        const file = await Promise.all(Array.from({ length: FILE_FULMINI }, (_, k) => fulminiDi(fine - k * PASSO_MS)));
        if (segno !== segnoFulmini) return;
        fulmini.clearLayers();
        const vista = map.getBounds();
        const limiti = vista.pad(0.2);
        let visti = 0;
        // I file escono con una decina di minuti di ritardo: i colori contano dall'ultimo arrivato.
        const primo = file.findIndex(Array.isArray);
        // Dal più vecchio al più recente, così i nuovi stanno sopra.
        for (let k = file.length - 1; k >= 0; k--) {
            if (!Array.isArray(file[k])) continue;
            const eta = k - primo;
            for (const punto of file[k]) {
                if (!limiti.contains(punto)) continue;
                if (vista.contains(punto)) visti++;
                L.circleMarker(punto, {
                    renderer: disegnoFulmini, interactive: false, radius: eta === 0 ? 5 : 4, weight: 1.5, color: '#422006',
                    fillColor: eta === 0 ? '#facc15' : eta < 3 ? '#fb923c' : '#d6d3d1', fillOpacity: 0.95, opacity: eta < 3 ? 1 : 0.6
                }).addTo(fulmini);
            }
        }
        stato.fulmini = { visti, dati: file.some(Array.isArray), guasti: file.some(f => f === GUASTA) };
        aggiornaPannello();
    }

    function ferma() {
        clearTimeout(stato.giocando);
        stato.giocando = null;
        stato.carico = null;
        stato.corsa++;
    }

    async function gioca() {
        if (stato.modo !== 'archivio' || stato.istanti.length < 2) return;
        const corsa = ++stato.corsa;
        stato.carico = 0;
        aggiornaPannello();
        const voci = [...tessereMappa.values()];
        for (const istante of stato.istanti) {
            await Promise.all(voci.flatMap(v => pezziDellaTessera(v.coords).map(p => tessera(istante, p))));
            if (corsa !== stato.corsa) return;
            stato.carico++;
            aggiornaPannello();
        }
        stato.carico = null;
        if (stato.modo !== 'archivio') return aggiornaPannello();
        const passo = () => {
            const prossimo = (stato.indice + 1) % stato.istanti.length;
            mostra(prossimo);
            stato.giocando = setTimeout(passo, prossimo === stato.istanti.length - 1 ? PAUSA_ULTIMO_MS : FOTOGRAMMO_MS);
        };
        stato.giocando = setTimeout(passo, 0);
        aggiornaPannello();
    }

    // Fuori dagli angoli di Leaflet: ogni pagina lo mette dove non copre i suoi comandi.
    const box = L.DomUtil.create('div', 'radar-pannello', map.getContainer());
    box.hidden = true;
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    box.innerHTML = `
        <div class="radar-riga radar-tempo">
            <button type="button" class="radar-gioca" aria-label="Fai scorrere l'ultima ora">▶</button>
            <input type="range" class="radar-scorri" min="0" max="${FOTOGRAMMI - 1}" step="1" aria-label="Ora dell'immagine del radar">
            <span class="radar-ora"></span>
        </div>
        <div class="radar-stato" role="status"></div>
        <div class="radar-legenda">
            <div class="radar-barra"></div>
            <div class="radar-tacche"><span>0</span><span>25</span><span>50</span><span>75</span><span>100 mm/h</span></div>
        </div>
        <div class="radar-fulmini"></div>`;
    const passi = Array.from({ length: 11 }, (_, i) => { const [r, g, b] = colorePioggia(Math.max(i / 10, 0.06)); return `rgb(${r},${g},${b}) ${i * 10}%`; });
    box.querySelector('.radar-barra').style.background = `linear-gradient(to right, ${passi.join(', ')})`;
    box.querySelector('.radar-gioca').addEventListener('click', () => {
        if (stato.giocando || stato.carico !== null) ferma(); else gioca();
        aggiornaPannello();
    });
    box.querySelector('.radar-scorri').addEventListener('input', (e) => {
        ferma();
        mostra(Number(e.target.value));
    });

    function aggiornaPannello() {
        const conRadar = map.hasLayer(radar);
        const conFulmini = map.hasLayer(fulmini);
        box.hidden = !conRadar && !conFulmini;
        if (box.hidden) return;
        const istante = stato.modo === 'archivio' ? stato.istanti[stato.indice] : stato.ultimo;
        const animabile = conRadar && stato.modo === 'archivio' && stato.istanti.length > 1;
        box.querySelector('.radar-gioca').hidden = !animabile;
        box.querySelector('.radar-scorri').hidden = !animabile;
        box.querySelector('.radar-legenda').hidden = !conRadar;
        box.querySelector('.radar-gioca').textContent = stato.giocando || stato.carico !== null ? '❚❚' : '▶';
        box.querySelector('.radar-scorri').value = String(Math.max(0, stato.indice));
        box.querySelector('.radar-ora').textContent = Number.isFinite(istante) ? ora(istante) : '';
        const riga = box.querySelector('.radar-stato');
        const { testo, grave } = stato.carico !== null
            ? { testo: `Carico l'ultima ora… ${stato.carico}/${stato.istanti.length}`, grave: false }
            : testoStato({ modo: conRadar ? stato.modo : null, ultimo: stato.ultimo, istante, raggiungibile: stato.raggiungibile });
        riga.textContent = stato.ultimo === null && stato.raggiungibile ? 'Chiedo al radar…' : testo;
        riga.classList.toggle('grave', grave);
        riga.hidden = !conRadar && !grave;
        const f = stato.fulmini;
        box.querySelector('.radar-fulmini').hidden = !conFulmini;
        box.querySelector('.radar-fulmini').textContent = !f ? 'Fulmini: li chiedo…'
            : f.guasti && !f.dati ? 'Fulmini non disponibili.'
            : !f.dati ? "Fulmini: nessun dato per quest'ora (si tengono mezz'ora)."
            : `⚡ ${f.visti === 0 ? 'Nessun fulmine' : f.visti === 1 ? '1 fulmine' : `${f.visti} fulmini`} sulla mappa nei 30 minuti fino alle ${ora(istante)}`;
    }

    let timer = null;
    function accesoOSpento() {
        const acceso = map.hasLayer(radar) || map.hasLayer(fulmini);
        if (acceso && !timer) {
            timer = setInterval(() => { if (!document.hidden) aggiorna(); }, CONTROLLA_OGNI_MS);
        } else if (!acceso && timer) {
            clearInterval(timer);
            timer = null;
        }
        if (acceso) aggiorna(); else aggiornaPannello();
    }
    radar.on('add', () => { ricorda(CHIAVE_RADAR, true); accesoOSpento(); });
    radar.on('remove', () => { ricorda(CHIAVE_RADAR, false); ferma(); accesoOSpento(); });
    fulmini.on('add', () => { ricorda(CHIAVE_FULMINI, true); accesoOSpento(); });
    fulmini.on('remove', () => { ricorda(CHIAVE_FULMINI, false); stato.fulmini = null; accesoOSpento(); });
    map.on('moveend', () => disegnaFulmini());
    document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) aggiorna(); });

    controllo.addOverlay(radar, 'Radar pioggia');
    controllo.addOverlay(fulmini, 'Fulmini');
    if (ricordato(CHIAVE_RADAR)) radar.addTo(map);
    if (ricordato(CHIAVE_FULMINI)) fulmini.addTo(map);
    return { radar, fulmini };
}
