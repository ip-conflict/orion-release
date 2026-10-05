// public/js/mappa-strumenti.js
//
// La ricerca sulla mappa e il percorso stradale delle squadre, per il centro
// operativo.
//
// La ricerca mette insieme tre fonti: le coordinate scritte a mano, le
// segnalazioni e le squadre di questa emergenza, e gli indirizzi. Per gli
// indirizzi si chiede a Photon (OpenStreetMap, tollera le parole a metà e
// gli errori di battitura) con la zona della mappa come preferenza, e a
// Nominatim limitato all'Italia e alla zona visibile: in valle una "Via
// Roma" generica trovava prima quella di un'altra regione.
//
// Il percorso lo calcola OSRM (OpenStreetMap). Se il servizio non risponde
// si disegna la linea d'aria e lo si dice: la sala vede comunque dove deve
// andare la squadra.

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

// --------------------------------------------------------------------------
// Utilità
// --------------------------------------------------------------------------

/** Distanza in metri fra due punti {lat, lng} (formula dell'emisenoverso). */
export function distanzaMetri(a, b) {
    const r = 6371000;
    const rad = (g) => g * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(h));
}

export function distanzaLeggibile(metri) {
    if (metri < 1000) return `${Math.round(metri / 10) * 10} m`;
    return `${(metri / 1000).toFixed(metri < 10000 ? 1 : 0).replace('.', ',')} km`;
}

export function durataLeggibile(secondi) {
    const minuti = Math.max(1, Math.round(secondi / 60));
    if (minuti < 60) return `${minuti} min`;
    return `${Math.floor(minuti / 60)} h ${String(minuti % 60).padStart(2, '0')}`;
}

/**
 * "46.1405, 12.2168", "46,1405 12,2168", "46.1405;12.2168": le coordinate
 * come le detta chi chiama. Null se il testo non lo è.
 */
export function leggiCoordinate(testo) {
    const t = String(testo || '').trim();
    // Con la virgola decimale le due cifre si separano con spazio o punto e virgola.
    let m = t.match(/^(-?\d{1,2}[.,]\d+)\s*[;\s]\s*(-?\d{1,3}[.,]\d+)$/) || t.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    if (!m) return null;
    const lat = parseFloat(m[1].replace(',', '.'));
    const lng = parseFloat(m[2].replace(',', '.'));
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
    return { lat, lng };
}

function normalizza(testo) {
    return String(testo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// --------------------------------------------------------------------------
// Indirizzi
// --------------------------------------------------------------------------

function nomePhoton(p) {
    const via = [p.street, p.housenumber].filter(Boolean).join(' ');
    const luogo = p.city || p.town || p.village || p.county;
    const principale = p.name && p.name !== p.street ? p.name : null;
    return [principale, via, luogo, p.state].filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i).join(', ') || p.name || 'Senza nome';
}

async function daPhoton(testo, centro, segnale) {
    const url = new URL(PHOTON);
    url.searchParams.set('q', testo);
    url.searchParams.set('limit', '6');
    if (centro) {
        url.searchParams.set('lat', centro.lat.toFixed(5));
        url.searchParams.set('lon', centro.lng.toFixed(5));
        url.searchParams.set('location_bias_scale', '0.5');
    }
    const r = await fetch(url, { signal: segnale });
    if (!r.ok) throw new Error(`Photon ${r.status}`);
    const dati = await r.json();
    return (dati.features || []).map(f => ({
        nome: nomePhoton(f.properties || {}),
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        fonte: 'indirizzo'
    }));
}

async function daNominatim(testo, limiti, segnale) {
    const url = new URL(NOMINATIM);
    url.searchParams.set('q', testo);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '6');
    url.searchParams.set('countrycodes', 'it');
    url.searchParams.set('accept-language', 'it');
    if (limiti) {
        // La zona visibile, allargata: preferita, non obbligatoria.
        const b = limiti.pad ? limiti.pad(1.5) : limiti;
        url.searchParams.set('viewbox', [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(n => n.toFixed(4)).join(','));
    }
    const r = await fetch(url, { signal: segnale, headers: { 'Accept-Language': 'it' } });
    if (!r.ok) throw new Error(`Nominatim ${r.status}`);
    const dati = await r.json();
    return dati.map(d => ({ nome: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon), fonte: 'indirizzo' }));
}

/**
 * Gli indirizzi per [testo], i piu' vicini al centro della mappa per primi.
 * Due servizi in parallelo: se uno non risponde basta l'altro.
 */
export async function cercaIndirizzi(testo, { centro, limiti, segnale } = {}) {
    const esiti = await Promise.allSettled([daPhoton(testo, centro, segnale), daNominatim(testo, limiti, segnale)]);
    const trovati = [];
    for (const e of esiti) if (e.status === 'fulfilled') trovati.push(...e.value);
    if (!trovati.length && esiti.every(e => e.status === 'rejected')) {
        throw new Error('Il servizio degli indirizzi non risponde.');
    }
    // Lo stesso posto dai due servizi: si tiene il primo.
    const unici = [];
    for (const t of trovati) {
        if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng)) continue;
        if (unici.some(u => distanzaMetri(u, t) < 40)) continue;
        unici.push(t);
    }
    if (centro) unici.sort((a, b) => distanzaMetri(centro, a) - distanzaMetri(centro, b));
    return unici.slice(0, 8);
}

// --------------------------------------------------------------------------
// Il controllo di ricerca
// --------------------------------------------------------------------------

/**
 * Il pulsante con la lente: si apre in un campo, cerca mentre si scrive fra
 * segnalazioni e squadre, e con Invio fra gli indirizzi. I risultati stanno
 * sopra al campo (il controllo sta in basso).
 *
 * @param cercaLocale (testo) => [{nome, dettaglio, lat, lng, fonte}]: segnalazioni e squadre.
 * @param suScelta (risultato) => void
 */
export function creaRicerca(map, { cercaLocale, suScelta, position = 'bottomleft' }) {
    const Controllo = L.Control.extend({
        options: { position },
        onAdd() {
            const box = L.DomUtil.create('div', 'leaflet-bar ricerca-mappa');
            L.DomEvent.disableClickPropagation(box);
            L.DomEvent.disableScrollPropagation(box);
            box.innerHTML = `
                <div class="ricerca-risultati" role="listbox" hidden></div>
                <div class="ricerca-riga">
                    <button type="button" class="ricerca-apri" title="Cerca un indirizzo, una segnalazione o una squadra" aria-label="Cerca">
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
                    </button>
                    <input type="search" class="ricerca-campo" placeholder="Indirizzo, #numero, squadra o coordinate" autocomplete="off" spellcheck="false" hidden>
                </div>`;
            const apri = box.querySelector('.ricerca-apri');
            const campo = box.querySelector('.ricerca-campo');
            const elenco = box.querySelector('.ricerca-risultati');
            let risultati = [];
            let scelto = -1;
            let controllore = null;

            const chiudi = () => {
                campo.hidden = true;
                elenco.hidden = true;
                box.classList.remove('aperta');
                controllore?.abort();
            };
            const disegna = (voci, nota) => {
                risultati = voci;
                scelto = voci.length ? 0 : -1;
                elenco.innerHTML = '';
                voci.forEach((v, i) => {
                    const riga = document.createElement('button');
                    riga.type = 'button';
                    riga.className = 'ricerca-voce' + (i === 0 ? ' scelta' : '');
                    riga.setAttribute('role', 'option');
                    const tipo = document.createElement('span');
                    tipo.className = `ricerca-tipo tipo-${v.fonte}`;
                    tipo.textContent = { segnalazione: 'Segnalazione', squadra: 'Squadra', indirizzo: 'Indirizzo', coordinate: 'Coordinate' }[v.fonte] || '';
                    const nome = document.createElement('span');
                    nome.className = 'ricerca-nome';
                    nome.textContent = v.nome;
                    riga.append(tipo, nome);
                    if (v.dettaglio) {
                        const d = document.createElement('span');
                        d.className = 'ricerca-dettaglio';
                        d.textContent = v.dettaglio;
                        riga.appendChild(d);
                    }
                    riga.addEventListener('click', () => { chiudi(); suScelta(v); });
                    elenco.appendChild(riga);
                });
                if (nota) {
                    const n = document.createElement('div');
                    n.className = 'ricerca-nota';
                    n.textContent = nota;
                    elenco.appendChild(n);
                }
                elenco.hidden = !voci.length && !nota;
            };
            const locali = (testo) => {
                const coord = leggiCoordinate(testo);
                const voci = coord ? [{ nome: `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`, ...coord, fonte: 'coordinate' }] : [];
                return voci.concat(testo.trim().length >= 1 ? cercaLocale(testo.trim()) : []).slice(0, 8);
            };

            apri.addEventListener('click', () => {
                if (!campo.hidden) return chiudi();
                campo.hidden = false;
                box.classList.add('aperta');
                campo.focus();
                campo.select();
            });
            campo.addEventListener('input', () => {
                const testo = campo.value;
                disegna(locali(testo), testo.trim().length >= 3 ? 'Invio per cercare fra gli indirizzi' : null);
            });
            campo.addEventListener('keydown', async (e) => {
                if (e.key === 'Escape') return chiudi();
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!risultati.length) return;
                    scelto = (scelto + (e.key === 'ArrowDown' ? 1 : -1) + risultati.length) % risultati.length;
                    elenco.querySelectorAll('.ricerca-voce').forEach((r, i) => r.classList.toggle('scelta', i === scelto));
                    return;
                }
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const testo = campo.value.trim();
                if (!testo) return;
                // Invio su una voce scelta con le frecce, su un numero ("#2") o
                // su delle coordinate: quella, senza chiedere indirizzi.
                const diretta = scelto > 0 || /^#?\d+$/.test(testo) || risultati[0]?.fonte === 'coordinate';
                if (diretta && risultati[scelto]) { const v = risultati[scelto]; chiudi(); return suScelta(v); }
                const giaTrovati = locali(testo);
                controllore?.abort();
                controllore = new AbortController();
                disegna(giaTrovati, 'Cerco fra gli indirizzi…');
                try {
                    const indirizzi = await cercaIndirizzi(testo, { centro: map.getCenter(), limiti: map.getBounds(), segnale: controllore.signal });
                    const tutti = giaTrovati.concat(indirizzi).slice(0, 10);
                    disegna(tutti, tutti.length ? null : 'Nessun risultato. Prova con via e comune, o con le coordinate.');
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    disegna(giaTrovati, 'Il servizio degli indirizzi non risponde: serve la rete.');
                }
            });
            return box;
        }
    });
    return new Controllo().addTo(map);
}

// --------------------------------------------------------------------------
// Percorso
// --------------------------------------------------------------------------

/**
 * Il percorso in auto da [da] ad [a] ({lat, lng}). Restituisce i punti, la
 * lunghezza e il tempo; stradale=false se si e' dovuto ripiegare sulla linea
 * d'aria.
 */
export async function calcolaPercorso(da, a, { segnale } = {}) {
    try {
        const url = `${OSRM}${da.lng.toFixed(6)},${da.lat.toFixed(6)};${a.lng.toFixed(6)},${a.lat.toFixed(6)}?overview=full&geometries=geojson`;
        const r = await fetch(url, { signal: segnale });
        if (!r.ok) throw new Error(`OSRM ${r.status}`);
        const dati = await r.json();
        const strada = dati.routes?.[0];
        if (dati.code !== 'Ok' || !strada) throw new Error(dati.message || 'nessun percorso');
        return {
            stradale: true,
            punti: strada.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
            metri: strada.distance,
            secondi: strada.duration
        };
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return { stradale: false, punti: [[da.lat, da.lng], [a.lat, a.lng]], metri: distanzaMetri(da, a), secondi: null };
    }
}
