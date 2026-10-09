// La pagina del copione di una simulazione (/copione.html?attivita=N),
// costruita come il centro operativo: a sinistra l'elenco degli eventi in
// ordine di tempo, a destra la mappa con i loro punti e le strade. "Nuovo
// evento" chiede il tipo con due parole di spiegazione; il modulo dell'evento
// si apre sopra la mappa e cambia secondo il tipo. Il punto si mette con un
// clic sulla mappa (o con "Trova" dall'indirizzo), la strada si disegna.
// Excel: il modello da scaricare, il foglio compilato da caricare, il
// copione attuale da scaricare. Dopo la simulazione, la scheda Valutazione:
// i tempi di ogni segnalazione, le osservazioni della regia, il debriefing,
// la pubblicazione ai partecipanti. Chi non è della regia, se il copione è
// stato pubblicato, vede tutto in sola lettura.
//
// La stessa pagina scrive il copione di uno scenario della biblioteca
// (/copione.html?scenario=N, dalla pagina Simulazioni): niente valutazione né
// pubblicazione, che sono delle simulazioni svolte, e un pulsante per
// pianificarlo nel calendario.

import { cercaIndirizzi, creaRicerca, calcolaPercorso } from './mappa-strumenti.js';
import { montaElementiMappa, creaControlloLivelli, aggiungiCartografia } from './mappa-elementi.js';

const $ = (id) => document.getElementById(id);
const el = (tag, classe, testo) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined && testo !== null) e.textContent = testo;
    return e;
};
const TIPI = {
    segnalazione: { nome: 'Segnalazione', icona: 'fa-triangle-exclamation', spiega: 'Arriva una richiesta di intervento' },
    aggravamento: { nome: 'Aggravamento', icona: 'fa-arrow-trend-up', spiega: 'Una segnalazione già uscita peggiora' },
    comunicazione: { nome: 'Comunicazione alla sala', icona: 'fa-envelope', spiega: 'Un messaggio, per esempio dalla Prefettura' },
    imprevisto: { nome: 'Imprevisto a una squadra', icona: 'fa-person-falling-burst', spiega: 'Arriva sul telefono dei suoi membri' },
    strada: { nome: 'Strada chiusa o zona', icona: 'fa-road-barrier', spiega: 'Compare sulla mappa della sala' },
    pericolo: { nome: 'Zona di pericolo', icona: 'fa-house-flood-water', spiega: 'Alluvione, frana o altro: le segnalazioni dentro prendono il rischio' }
};
const COLORI = { segnalazione: '#c2410c', aggravamento: '#b91c1c', comunicazione: '#1d4ed8', imprevisto: '#a16207', strada: '#6d28d9', pericolo: '#be123c' };
// Cosa disegna sulla mappa un evento, per tipo: la prima voce è quella di partenza.
const ELEMENTI = {
    strada: { etichetta: 'Cosa', voci: { strada_chiusa: 'Strada chiusa', zona_interdetta: 'Zona interdetta' } },
    pericolo: { etichetta: 'Che pericolo', voci: { pericolo_generico: 'Altro (incendio, crollo, fuga di gas...)', pericolo_alluvione: 'Alluvione', pericolo_frana: 'Frana' } }
};
const NOMI_ELEMENTI = { ...ELEMENTI.strada.voci, ...ELEMENTI.pericolo.voci, pericolo_generico: 'zona di pericolo' };
const disegnaArea = (tipoElemento) => tipoElemento !== 'strada_chiusa';
const PRIORITA = { High: 'Alta', Medium: 'Media', Low: 'Bassa' };
const NOMI_RADIO = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa'];

const parametri = new URLSearchParams(location.search);
const idScenario = Number(parametri.get('scenario')) || null;
const idAttivita = idScenario ? null : Number(parametri.get('attivita'));
const radice = idScenario ? `/api/scenari/${idScenario}` : `/api/attivita/${idAttivita}`;
let dati = null;          // la risposta di GET .../copione
let inModifica = null;    // l'evento nel modulo ({} se nuovo)
let tipoModulo = null;
let punto = null;         // { lat, lng } del modulo
let forma = null;         // la geometria del modulo
let map, strati, anteprima, annullaMappa = null;

const ora = (minuti) => {
    if (minuti === null || minuti === undefined) return 'a mano';
    const h = Math.floor(minuti / 60), m = minuti % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}` : `${m}'`;
};
const data = (v) => new Date(String(v).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
const oraDi = (v) => data(v).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

// --- Il caricamento ---------------------------------------------------------------

async function carica() {
    try {
        dati = await fetchApi(`${radice}/copione`);
    } catch (e) {
        document.querySelector('.cp-lavoro').replaceChildren(el('p', 'cp-pannello', e.message || 'Copione non disponibile.'));
        $('cp-azioni').hidden = true;
        return;
    }
    const a = dati.attivita;
    document.title = `Copione: ${a.titolo} - ORION`;
    $('cp-titolo').textContent = a.titolo;
    $('cp-sottotitolo').textContent = idScenario
        ? ['Scenario', a.tipo, dati.scenario.durata_ore === 1 ? 'circa 1 ora' : `circa ${dati.scenario.durata_ore} ore`].join(' · ')
        : [a.tipo, dati.sala ? (dati.sala.aperta ? `Sala aperta: ${dati.sala.codice}` : `Simulazione svolta: ${dati.sala.codice}`) : 'La sala non è ancora stata aperta'].filter(Boolean).join(' · ');
    $('cp-scenario').hidden = !a.scenario && !a.obiettivi;
    $('cp-scenario-testo').textContent = a.scenario || '';
    $('cp-obiettivi-testo').textContent = a.obiettivi ? `Obiettivi: ${a.obiettivi}` : '';
    const modifica = dati.puo_modificare;
    $('cp-azioni').hidden = !modifica;
    $('cp-nuovo').hidden = !modifica;
    disegnaElenco();
    disegnaMappa();
    if (!idScenario) disegnaValutazione();
}

// --- L'elenco -----------------------------------------------------------------------

function descrizione(e) {
    switch (e.tipo) {
        case 'segnalazione': return [e.indirizzo, e.modo === 'telefono' ? 'per telefono' : null, e.priorita ? `priorità ${PRIORITA[e.priorita].toLowerCase()}` : null].filter(Boolean).join(' · ');
        case 'aggravamento': {
            const rif = dati.eventi.find(x => x.id === e.riferimento_id);
            return rif ? `su "${rif.titolo}"${e.priorita ? `, diventa ${PRIORITA[e.priorita].toLowerCase()}` : ''}` : 'segnalazione non trovata';
        }
        case 'imprevisto': return `alla squadra ${e.squadra}`;
        case 'strada':
        case 'pericolo': return e.geometria ? (NOMI_ELEMENTI[e.elemento_tipo] || '').toLowerCase() : 'da disegnare sulla mappa';
        default: return e.testo || '';
    }
}

function disegnaElenco() {
    const ol = $('cp-elenco');
    ol.replaceChildren();
    const eventi = dati.eventi;
    const daMettere = eventi.filter(e => (e.tipo === 'segnalazione' && e.lat === null && e.modo !== 'telefono') || (ELEMENTI[e.tipo] && !e.geometria));
    $('cp-da-posizionare').hidden = !daMettere.length || !dati.puo_modificare;
    $('cp-da-posizionare').textContent = daMettere.length === 1
        ? '1 evento è da mettere sulla mappa: aprilo e tocca il punto.'
        : `${daMettere.length} eventi sono da mettere sulla mappa: aprili e tocca il punto.`;
    if (!eventi.length) {
        ol.appendChild(el('li', 'nota', dati.puo_modificare
            ? 'Il copione è vuoto. Con "Nuovo evento" si aggiunge un evento alla volta; con "Excel" si carica un foglio compilato.'
            : 'Il copione è vuoto.'));
        return;
    }
    eventi.forEach((e, i) => {
        const li = el('li', `cp-evento tipo-${e.tipo}${inModifica?.id === e.id ? ' scelto' : ''}`);
        const t = el('span', 'cp-ora', ora(e.previsto ?? e.minuto));
        t.appendChild(el('small', '', `n. ${i + 1}`));
        li.appendChild(t);
        li.appendChild(el('span', 'cp-tipo', TIPI[e.tipo].nome));
        li.appendChild(el('span', 'cp-nome', e.titolo));
        const det = descrizione(e);
        if (det) li.appendChild(el('span', 'cp-det', det));
        const segni = el('span', 'cp-segni');
        if (daMettere.includes(e)) segni.appendChild(el('span', 'cp-pill attenzione', '📍 da mettere sulla mappa'));
        if (e.stato === 'uscito') segni.appendChild(el('span', 'cp-pill ok', `uscito alle ${oraDi(e.uscito_il)}${e.automatico ? '' : ' (a mano)'}`));
        if (e.stato === 'saltato') segni.appendChild(el('span', 'cp-pill', 'saltato'));
        if (e.rimando_minuti) segni.appendChild(el('span', 'cp-pill', `rimandato di ${e.rimando_minuti}'`));
        if (e.minuti_attesi) segni.appendChild(el('span', 'cp-pill', `atteso in ${e.minuti_attesi}'`));
        if (segni.children.length) li.appendChild(segni);
        li.addEventListener('click', () => apriModulo(e));
        ol.appendChild(li);
    });
}

// --- La mappa -------------------------------------------------------------------------

async function preparaMappa() {
    let centro = [41.9, 12.5], zoom = 13;
    try {
        const s = await fetchApi('/api/branding/settings');
        if (parseFloat(s.map_center_lat)) centro = [parseFloat(s.map_center_lat), parseFloat(s.map_center_lon)];
        if (parseInt(s.map_zoom_level, 10)) zoom = parseInt(s.map_zoom_level, 10);
    } catch { /* il centro di partenza */ }
    map = L.map('cp-mappa', { zoomControl: false }).setView(centro, zoom);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const stradale = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    });
    strati = L.layerGroup().addTo(map);
    anteprima = L.layerGroup().addTo(map);
    // I livelli come nel centro operativo: le zone di pericolosità e le aree del
    // piano, le strade chiuse e le zone in vigore adesso. Qui si guardano soltanto:
    // il copione si scrive sopra la situazione vera.
    const controllo = creaControlloLivelli({ 'Mappa Stradale': stradale, 'Satellite': satellite }, { 'Eventi del copione': strati }, { position: 'bottomleft' }).addTo(map);
    aggiungiCartografia(map, controllo, [stradale, satellite]);
    try {
        montaElementiMappa(map, controllo, { calcolaPercorso: null, interno: false, admin: false, emergenzaAperta: () => false });
    } catch (e) {
        console.warn('[Copione] Livelli della mappa non caricati:', e.message);
    }
    creaRicerca(map, {
        cercaLocale: (t) => (dati?.eventi || []).filter(e => e.lat !== null && e.titolo.toLowerCase().includes(t.toLowerCase()))
            .map(e => ({ nome: e.titolo, dettaglio: TIPI[e.tipo].nome, lat: e.lat, lng: e.lng, fonte: 'segnalazione' })),
        suScelta: (v) => {
            map.setView([v.lat, v.lng], Math.max(map.getZoom(), 16));
            // Durante "metti sulla mappa" la ricerca mette anche il punto.
            if (annullaMappa && tipoModulo === 'segnalazione') impostaPunto({ lat: v.lat, lng: v.lng });
        }
    });
}

function segnaposto(numero, colore) {
    return L.divIcon({
        className: '',
        html: `<div class="cp-segnaposto" style="background:${colore}"><span>${numero}</span></div>`,
        iconSize: [30, 30], iconAnchor: [15, 30]
    });
}

function disegnaMappa() {
    strati.clearLayers();
    const confini = [];
    dati.eventi.forEach((e, i) => {
        if (e.lat !== null && e.lng !== null) {
            const m = L.marker([e.lat, e.lng], { icon: segnaposto(i + 1, COLORI[e.tipo]), title: e.titolo }).addTo(strati);
            m.on('click', () => apriModulo(e));
            confini.push([e.lat, e.lng]);
        }
        if (e.geometria) {
            const g = L.geoJSON(e.geometria, { style: { color: COLORI[e.tipo] || COLORI.strada, weight: disegnaArea(e.elemento_tipo) ? 3 : 6, dashArray: disegnaArea(e.elemento_tipo) ? null : '10 8', fillOpacity: e.tipo === 'pericolo' ? 0.25 : 0.15 } }).addTo(strati);
            g.on('click', () => apriModulo(e));
            const b = g.getBounds();
            if (b.isValid()) confini.push(b.getNorthEast(), b.getSouthWest());
        }
    });
    if (confini.length && !disegnaMappa.inquadrata) {
        map.fitBounds(L.latLngBounds(confini), { padding: [60, 60], maxZoom: 16 });
        disegnaMappa.inquadrata = true;
    }
}

function guida(testo, azioni = []) {
    const g = $('cp-guida');
    g.replaceChildren(el('span', '', testo), ...azioni);
    g.hidden = false;
}
function togliGuida() { $('cp-guida').hidden = true; }

function fermaMappa() {
    if (annullaMappa) annullaMappa();
    annullaMappa = null;
    togliGuida();
}

function impostaPunto(p) {
    punto = p;
    anteprima.clearLayers();
    if (p) L.marker([p.lat, p.lng], { icon: segnaposto('•', COLORI[tipoModulo] || '#6d28d9') }).addTo(anteprima);
    $('cp-posizione-testo').textContent = p ? `Punto sulla mappa: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'Nessun punto sulla mappa';
    $('cp-metti-punto').innerHTML = p ? '<i class="fas fa-location-dot"></i> Sposta il punto' : '<i class="fas fa-location-dot"></i> Metti sulla mappa';
    fermaMappa();
}

function mettiPunto() {
    fermaMappa();
    const tocco = (ev) => impostaPunto({ lat: ev.latlng.lat, lng: ev.latlng.lng });
    map.on('click', tocco);
    map.getContainer().style.cursor = 'crosshair';
    const annulla = el('button', '', 'Annulla');
    annulla.type = 'button';
    annulla.addEventListener('click', fermaMappa);
    guida('Tocca la mappa nel punto dell\'evento (o cerca l\'indirizzo con la lente)', [annulla]);
    annullaMappa = () => { map.off('click', tocco); map.getContainer().style.cursor = ''; };
}

function impostaForma(g) {
    forma = g;
    anteprima.clearLayers();
    if (g) L.geoJSON(g, { style: { color: COLORI[tipoModulo] || COLORI.strada, weight: disegnaArea($('cp-f-elemento').value) ? 3 : 6, dashArray: disegnaArea($('cp-f-elemento').value) ? null : '10 8', fillOpacity: 0.2 } }).addTo(anteprima);
    $('cp-forma-testo').textContent = g ? 'Disegnata sulla mappa' : 'Non ancora disegnata';
    $('cp-disegna').innerHTML = g ? '<i class="fas fa-pen"></i> Ridisegna' : '<i class="fas fa-pen"></i> Disegna sulla mappa';
}

// La strada chiusa come nel centro operativo: si toccano i due capi e la
// linea segue la strada. "A mano" resta per i casi in cui il percorso sbaglia.
function disegnaStrada() {
    fermaMappa();
    const punti = [];
    const segni = L.layerGroup().addTo(map);
    const tocco = async (ev) => {
        punti.push(ev.latlng);
        L.circleMarker(ev.latlng, { radius: 7, color: '#dc2626', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(segni);
        if (punti.length === 1) { guida('Ora tocca la fine del tratto chiuso', [annulla, aMano]); return; }
        map.off('click', tocco);
        map.getContainer().style.cursor = '';
        guida('Cerco la strada fra i due punti…', [annulla]);
        const p = await calcolaPercorso(punti[0], punti[1]);
        fermaMappa();
        impostaForma({ type: 'LineString', coordinates: p.punti.map(([lat, lng]) => [lng, lat]) });
        if (!p.stradale) notifica('Il servizio delle strade non risponde: è una linea dritta. Puoi ridisegnarla a mano.', 'attenzione');
    };
    const annulla = el('button', '', 'Annulla');
    annulla.type = 'button';
    annulla.addEventListener('click', fermaMappa);
    const aMano = el('button', '', 'A mano');
    aMano.type = 'button';
    aMano.addEventListener('click', () => disegnaForma(true));
    map.on('click', tocco);
    map.getContainer().style.cursor = 'crosshair';
    guida("Tocca l'inizio del tratto chiuso", [annulla, aMano]);
    annullaMappa = () => { map.off('click', tocco); map.getContainer().style.cursor = ''; segni.remove(); };
}

function disegnaForma(aMano = false) {
    if (!aMano && $('cp-f-elemento').value === 'strada_chiusa') return disegnaStrada();
    fermaMappa();
    const zona = disegnaArea($('cp-f-elemento').value);
    map.pm.enableDraw(zona ? 'Polygon' : 'Line', { finishOn: zona ? null : 'dblclick' });
    const creato = (ev) => {
        const g = ev.layer.toGeoJSON().geometry;
        ev.layer.remove();
        fermaMappa();
        impostaForma(g);
    };
    map.on('pm:create', creato);
    const annulla = el('button', '', 'Annulla');
    annulla.type = 'button';
    annulla.addEventListener('click', fermaMappa);
    guida(zona ? 'Tocca i vertici della zona; tocca il primo per chiuderla' : 'Tocca i punti della strada; doppio clic sull\'ultimo per finire', [annulla]);
    annullaMappa = () => { map.off('pm:create', creato); map.pm.disableDraw(); };
}

// --- Il modulo di un evento ---------------------------------------------------------------

function sceltaTipo() {
    const box = $('cp-scelta-tipo');
    if (!box.hidden) { box.hidden = true; return; }
    box.replaceChildren();
    for (const [k, t] of Object.entries(TIPI)) {
        const b = el('button', `tipo-${k}`);
        b.type = 'button';
        const i = el('i', `fas ${t.icona}`);
        i.style.color = COLORI[k];
        b.append(i, el('strong', '', t.nome), el('span', '', t.spiega));
        b.addEventListener('click', () => { box.hidden = true; apriModulo({ tipo: k }); });
        box.appendChild(b);
    }
    box.hidden = false;
}

function apriModulo(e) {
    fermaMappa();
    inModifica = e;
    tipoModulo = e.tipo;
    const nuovo = !e.id;
    const sola = !dati.puo_modificare || e.stato === 'uscito' || e.stato === 'saltato';
    const f = $('cp-modulo');
    f.className = `cp-modulo tipo-${e.tipo}`;
    $('cp-mod-icona').replaceChildren(el('i', `fas ${TIPI[e.tipo].icona}`));
    $('cp-mod-titolo').textContent = nuovo ? `Nuovo: ${TIPI[e.tipo].nome.toLowerCase()}` : TIPI[e.tipo].nome;
    f.querySelectorAll('[data-per]').forEach(d => { d.hidden = !d.dataset.per.split(' ').includes(e.tipo); });
    const aMano = !nuovo && e.minuto === null;
    f.querySelector(`input[name="cp-quando"][value="${aMano ? 'mano' : 'tempo'}"]`).checked = true;
    // Di partenza un evento nuovo esce 10 minuti dopo l'ultimo.
    const ultimo = Math.max(-10, ...dati.eventi.filter(x => x.minuto !== null).map(x => x.minuto));
    $('cp-minuto').value = nuovo ? Math.max(0, ultimo + 10) : (e.minuto ?? 0);
    $('cp-f-titolo').value = e.titolo || '';
    $('cp-f-testo').value = e.testo || '';
    $('riga-testo').firstChild.textContent = e.tipo === 'segnalazione' ? 'Cosa succede (quello che si legge alla sala) ' : e.tipo === 'imprevisto' ? 'Cosa arriva sul telefono ' : 'Testo ';
    f.querySelector(`input[name="cp-modo"][value="${e.modo || 'da_sola'}"]`).checked = true;
    $('cp-f-indirizzo').value = e.indirizzo || '';
    $('cp-f-priorita').value = e.priorita || 'Medium';
    $('cp-f-segnalante').value = e.segnalante || '';
    $('cp-f-telefono').value = e.telefono || '';
    const rif = $('cp-f-riferimento');
    rif.replaceChildren(...dati.eventi.filter(x => x.tipo === 'segnalazione').map(x => new Option(`${ora(x.minuto)} · ${x.titolo}`, x.id)));
    if (!rif.options.length) rif.appendChild(new Option('Prima aggiungi una segnalazione', ''));
    rif.value = e.riferimento_id || rif.options[0]?.value || '';
    $('cp-f-priorita-agg').value = e.tipo === 'aggravamento' ? (e.priorita || '') : '';
    $('cp-f-squadra').value = e.squadra || '';
    const elementi = ELEMENTI[e.tipo];
    if (elementi) {
        $('cp-elemento-etichetta').textContent = elementi.etichetta;
        $('cp-f-elemento').replaceChildren(...Object.entries(elementi.voci).map(([k, v]) => new Option(v, k)));
        $('cp-f-elemento').value = e.elemento_tipo && elementi.voci[e.elemento_tipo] ? e.elemento_tipo : Object.keys(elementi.voci)[0];
    }
    $('cp-f-risposta').value = e.risposta_attesa || '';
    $('cp-f-minuti-attesi').value = e.minuti_attesi || '';
    $('riga-minuti-attesi').firstChild.textContent = e.tipo === 'segnalazione' ? "Entro quanti minuti dall'uscita va assegnata una squadra " : 'Entro quanti minuti ';
    f.querySelector('.cp-attesa').open = !!(e.risposta_attesa || e.minuti_attesi);
    anteprima.clearLayers();
    punto = e.lat !== null && e.lat !== undefined ? { lat: e.lat, lng: e.lng } : null;
    impostaPunto(punto);
    impostaForma(e.geometria || null);
    if (punto) map.setView([punto.lat, punto.lng], Math.max(map.getZoom(), 15));
    $('cp-elimina').hidden = nuovo || sola;
    $('cp-salva').hidden = sola;
    f.querySelectorAll('input, select, textarea').forEach(x => { x.disabled = sola; });
    f.querySelectorAll('.cp-posizione button, #cp-cerca-indirizzo').forEach(x => { x.hidden = sola; });
    $('cp-annulla').textContent = sola ? 'Chiudi' : 'Annulla';
    f.hidden = false;
    disegnaElenco();
    if (!sola) $('cp-f-titolo').focus();
    // Una segnalazione nuova o senza punto: si comincia proprio dal punto.
    if (!sola && e.tipo === 'segnalazione' && !punto) mettiPunto();
    if (!sola && ELEMENTI[e.tipo] && !e.geometria) disegnaForma();
}

function chiudiModulo() {
    fermaMappa();
    anteprima.clearLayers();
    $('cp-modulo').hidden = true;
    inModifica = null;
    disegnaElenco();
}

function corpoModulo() {
    const t = tipoModulo;
    const aMano = document.querySelector('input[name="cp-quando"]:checked').value === 'mano';
    const corpo = {
        tipo: t,
        minuto: aMano ? null : Number($('cp-minuto').value || 0),
        titolo: $('cp-f-titolo').value.trim(),
        testo: $('cp-f-testo').value.trim(),
        risposta_attesa: $('cp-f-risposta').value.trim(),
        minuti_attesi: $('cp-f-minuti-attesi').value ? Number($('cp-f-minuti-attesi').value) : null
    };
    if (t === 'segnalazione') Object.assign(corpo, {
        modo: document.querySelector('input[name="cp-modo"]:checked').value,
        indirizzo: $('cp-f-indirizzo').value.trim(), lat: punto?.lat ?? null, lng: punto?.lng ?? null,
        priorita: $('cp-f-priorita').value, segnalante: $('cp-f-segnalante').value.trim(), telefono: $('cp-f-telefono').value.trim()
    });
    if (t === 'aggravamento') Object.assign(corpo, { riferimento_id: Number($('cp-f-riferimento').value) || null, priorita: $('cp-f-priorita-agg').value || null });
    if (t === 'imprevisto') corpo.squadra = $('cp-f-squadra').value.trim();
    if (ELEMENTI[t]) Object.assign(corpo, { elemento_tipo: $('cp-f-elemento').value, geometria: forma });
    return corpo;
}

async function salva(ev) {
    ev.preventDefault();
    const corpo = corpoModulo();
    try {
        if (inModifica?.id) await fetchApi(`/api/copione/eventi/${inModifica.id}`, { method: 'PUT', body: JSON.stringify(corpo) });
        else await fetchApi(`${radice}/copione/eventi`, { method: 'POST', body: JSON.stringify(corpo) });
        notifica('Evento salvato.', 'successo');
        chiudiModulo();
        await carica();
    } catch (e) { notifica(e.message, 'errore'); }
}

async function elimina() {
    if (!inModifica?.id || !confirm(`Togliere "${inModifica.titolo}" dal copione?`)) return;
    try {
        await fetchApi(`/api/copione/eventi/${inModifica.id}`, { method: 'DELETE' });
        chiudiModulo();
        await carica();
    } catch (e) { notifica(e.message, 'errore'); }
}

async function trovaIndirizzo() {
    const testo = $('cp-f-indirizzo').value.trim();
    if (!testo) return notifica("Scrivi l'indirizzo.", 'attenzione');
    try {
        const r = await cercaIndirizzi(testo, { centro: map.getCenter(), limiti: map.getBounds() });
        if (!r.length) return notifica('Indirizzo non trovato: metti il punto a mano sulla mappa.', 'attenzione');
        impostaPunto({ lat: r[0].lat, lng: r[0].lng });
        map.setView([r[0].lat, r[0].lng], 17);
        notifica(`Trovato: ${r[0].nome}. Se non è il punto giusto, spostalo.`, 'info');
    } catch { notifica('Il servizio degli indirizzi non risponde: metti il punto a mano.', 'attenzione'); }
}

// --- Excel e copia -----------------------------------------------------------------------------

function apriExcel() {
    $('excel-esito').replaceChildren();
    $('excel-scarica').href = `${radice}/copione.xlsx`;
    $('modale-excel').hidden = false;
}

async function caricaExcel() {
    const file = $('excel-file').files[0];
    if (!file) return;
    const esito = $('excel-esito');
    esito.replaceChildren(el('p', 'nota', 'Carico il foglio…'));
    const fd = new FormData();
    fd.append('file', file);
    fd.append('modo', $('excel-sostituisci').checked ? 'sostituisci' : 'aggiungi');
    try {
        const corpo = await fetchApi(`${radice}/copione/importa`, { method: 'POST', body: fd });
        esito.replaceChildren(el('p', '', `Caricati ${corpo.caricati} eventi.${corpo.da_posizionare ? ` ${corpo.da_posizionare} sono da mettere sulla mappa.` : ''}`));
        await carica();
    } catch (e) {
        const box = el('div', 'cp-errori', e.message || 'Il foglio non è stato caricato.');
        if (e.body?.errori?.length) {
            const ul = el('ul');
            for (const x of e.body.errori) ul.appendChild(el('li', '', x.riga ? `Riga ${x.riga}: ${x.messaggio}` : x.messaggio));
            box.appendChild(ul);
        }
        esito.replaceChildren(box);
    } finally {
        $('excel-file').value = '';
    }
}

async function apriCopia() {
    const ul = $('copia-elenco');
    ul.replaceChildren(el('li', 'nota', 'Cerco gli scenari e le attività con un copione…'));
    $('modale-copia').hidden = false;
    let attivita = [], scenari = [];
    try {
        const da = new Date(); da.setFullYear(da.getFullYear() - 3);
        const a = new Date(); a.setFullYear(a.getFullYear() + 1);
        const g = (d) => d.toISOString().slice(0, 10);
        attivita = (await fetchApi(`/api/attivita?da=${g(da)}&a=${g(a)}`)).filter(x => x.simulazione === 'sala' && x.regista && x.id !== idAttivita);
    } catch (e) { ul.replaceChildren(el('li', 'nota', e.message)); return; }
    // Gli scenari della biblioteca li vede chi apre le simulazioni o le organizza.
    try { scenari = (await fetchApi('/api/simulazioni/scenari')).filter(x => x.eventi && x.id !== idScenario); } catch { /* niente scenari */ }
    ul.replaceChildren();
    if (!attivita.length && !scenari.length) ul.appendChild(el('li', 'nota', 'Nessuno scenario e nessuna altra attività con la simulazione in sala di cui fai la regia.'));
    const voce = (testo, corpo) => {
        const b = el('button', 'button-style button-secondary', testo);
        b.type = 'button';
        b.addEventListener('click', async () => {
            try {
                const r = await fetchApi(`${radice}/copione/copia`, { method: 'POST', body: JSON.stringify(corpo) });
                notifica(`Copiati ${r.copiati} eventi.`, 'successo');
                $('modale-copia').hidden = true;
                await carica();
            } catch (e) { notifica(e.message, 'errore'); }
        });
        const li = el('li');
        li.appendChild(b);
        ul.appendChild(li);
    };
    if (scenari.length) ul.appendChild(el('li', 'cp-copia-gruppo', 'Scenari'));
    for (const x of scenari) voce(`${x.titolo} (${x.eventi} ${x.eventi === 1 ? 'evento' : 'eventi'})`, { da_scenario: x.id });
    if (scenari.length && attivita.length) ul.appendChild(el('li', 'cp-copia-gruppo', 'Attività'));
    for (const x of attivita.sort((p, q) => data(q.inizio) - data(p.inizio))) voce(`${data(x.inizio).toLocaleDateString('it-IT')} · ${x.titolo}`, { da: x.id });
}

// --- La valutazione ---------------------------------------------------------------------------------

function disegnaValutazione() {
    const box = $('cp-valutazione');
    box.replaceChildren();
    const sala = dati.sala;
    if (!sala || sala.aperta) {
        box.appendChild(el('p', 'nota', sala?.aperta
            ? 'La simulazione è in corso: i tempi si leggono qui quando la sala si chiude. Intanto la regia li segue nel centro operativo.'
            : 'Qui, dopo la simulazione, i tempi di ogni segnalazione, le osservazioni della regia e il debriefing.'));
    } else {
        const usciti = dati.eventi.filter(e => e.stato === 'uscito');
        const valutati = usciti.filter(e => e.valutazione);
        const conta = (v) => valutati.filter(e => e.valutazione === v).length;
        const riass = el('div', 'cp-riassunto-val');
        riass.append(
            el('span', 'cp-pill', `${usciti.length} eventi usciti su ${dati.eventi.length}`),
            el('span', 'cp-pill ok', `${conta('in_tempo')} in tempo`),
            el('span', 'cp-pill attenzione', `${conta('in_ritardo')} in ritardo`),
            el('span', 'cp-pill grave', `${conta('non_fatto')} senza risposta`)
        );
        box.appendChild(riass);
        for (const e of dati.eventi) {
            const d = el('div', `cp-val tipo-${e.tipo}`);
            d.appendChild(el('strong', '', `${ora(e.minuto)} · ${e.titolo}`));
            const stato = e.stato === 'uscito' ? `Uscito alle ${oraDi(e.uscito_il)}` : e.stato === 'saltato' ? 'Saltato' : 'Non uscito';
            const tempi = el('div', 'cp-tempi');
            tempi.appendChild(el('span', '', stato));
            if (e.report) tempi.appendChild(el('span', '', `segnalazione n. ${e.report.numero}`));
            if (e.misure) {
                if (e.misure.assegnata_dopo !== null) tempi.appendChild(el('span', '', `squadra dopo ${e.misure.assegnata_dopo}'`));
                if (e.misure.prima_notizia_dopo !== null) tempi.appendChild(el('span', '', `prima notizia dopo ${e.misure.prima_notizia_dopo}'`));
                if (e.misure.chiusa_dopo !== null) tempi.appendChild(el('span', '', `chiusa dopo ${e.misure.chiusa_dopo}'`));
            } else if (e.tipo === 'segnalazione' && e.stato === 'uscito' && e.modo === 'telefono') {
                tempi.appendChild(el('span', '', 'telefonata non collegata a una segnalazione: tempi non misurati'));
            }
            if (e.minuti_attesi) tempi.appendChild(el('span', '', `atteso: ${e.minuti_attesi}'`));
            if (e.valutazione) tempi.appendChild(el('span', `cp-pill ${e.valutazione === 'in_tempo' ? 'ok' : e.valutazione === 'in_ritardo' ? 'attenzione' : 'grave'}`,
                { in_tempo: 'in tempo', in_ritardo: 'in ritardo', non_fatto: 'senza squadra' }[e.valutazione]));
            d.appendChild(tempi);
            if (e.risposta_attesa) d.appendChild(el('div', 'nota', `Atteso: ${e.risposta_attesa}`));
            if (e.nota_esito) d.appendChild(el('div', 'nota', e.nota_esito));
            box.appendChild(d);
        }
    }

    const oss = $('cp-osservazioni');
    oss.replaceChildren();
    if (!dati.osservazioni.length) oss.appendChild(el('li', 'nota', 'Nessuna osservazione.'));
    for (const o of dati.osservazioni) {
        const li = el('li', '', o.testo);
        const ev = dati.eventi.find(e => e.id === o.evento_id);
        li.appendChild(el('small', '', `${oraDi(o.creata_il)} · ${o.autore_nome || ''}${ev ? ` · su "${ev.titolo}"` : ''}`));
        oss.appendChild(li);
    }

    const db = dati.debriefing || {};
    $('db-obiettivi').value = db.obiettivi_raggiunti || '';
    $('db-forza').value = db.punti_forza || '';
    $('db-criticita').value = db.criticita || '';
    $('db-miglioramenti').value = db.miglioramenti || '';
    const chiuso = !!db.concluso_il;
    const scrive = dati.puo_modificare && !chiuso;
    $('cp-debriefing').querySelectorAll('textarea').forEach(t => { t.readOnly = !scrive; });
    $('db-azioni').hidden = !scrive;
    $('db-stato').textContent = chiuso ? `Concluso il ${data(db.concluso_il).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })} da ${db.concluso_da}: non si cambia più.`
        : db.aggiornato_il ? `Ultima modifica di ${db.aggiornato_da}. Lo scrivono tutti i registi; quando è finito, si conclude.` : 'Lo scrivono tutti i registi; quando è finito, si conclude.';
    $('cp-pubblica-riga').hidden = !dati.puo_modificare;
    $('cp-pubblica').checked = !!dati.pubblicato;
}

async function salvaDebriefing(ev) {
    ev?.preventDefault();
    try {
        await fetchApi(`/api/attivita/${idAttivita}/debriefing`, {
            method: 'PUT', body: JSON.stringify({
                obiettivi_raggiunti: $('db-obiettivi').value, punti_forza: $('db-forza').value,
                criticita: $('db-criticita').value, miglioramenti: $('db-miglioramenti').value
            })
        });
        notifica('Debriefing salvato.', 'successo');
        await carica();
        return true;
    } catch (e) { notifica(e.message, 'errore'); return false; }
}

function scheda(quale) {
    const val = quale === 'valutazione';
    $('scheda-copione').setAttribute('aria-selected', String(!val));
    $('scheda-valutazione').setAttribute('aria-selected', String(val));
    $('pannello-copione').hidden = val;
    $('pannello-valutazione').hidden = !val;
}

// --- Avvio ---------------------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    if (!idScenario && (!Number.isInteger(idAttivita) || idAttivita <= 0)) {
        document.querySelector('.cp-lavoro').replaceChildren(el('p', 'cp-pannello', "Manca l'attività: apri il copione dal calendario."));
        return;
    }
    if (idScenario) {
        // Lo scenario: si torna alla biblioteca, niente valutazione, si pianifica.
        const indietro = document.querySelector('.cp-indietro');
        indietro.href = '/simulazioni.html';
        indietro.title = 'Torna alle simulazioni';
        $('cp-segno').textContent = 'SCENARIO';
        document.querySelector('.cp-schede').hidden = true;
        $('copia-titolo').textContent = 'Copia il copione di uno scenario o di un\'attività';
        const pianifica = el('a', 'button-style', '');
        pianifica.href = `/calendario.html?scenario=${idScenario}`;
        pianifica.innerHTML = '<i class="fas fa-calendar-plus"></i> Pianifica';
        $('cp-azioni').appendChild(pianifica);
    }
    $('nomi-radio').replaceChildren(...NOMI_RADIO.map(n => new Option(n)));
    await preparaMappa();
    $('cp-btn-nuovo').addEventListener('click', sceltaTipo);
    $('cp-modulo').addEventListener('submit', salva);
    $('cp-mod-chiudi').addEventListener('click', chiudiModulo);
    $('cp-annulla').addEventListener('click', chiudiModulo);
    $('cp-elimina').addEventListener('click', elimina);
    $('cp-metti-punto').addEventListener('click', mettiPunto);
    $('cp-cerca-indirizzo').addEventListener('click', trovaIndirizzo);
    $('cp-disegna').addEventListener('click', () => disegnaForma());
    // Da linea ad area (o viceversa) il disegno non vale più; fra due aree resta.
    $('cp-f-elemento').addEventListener('change', () => {
        const area = forma && /Polygon/.test(forma.type);
        if (forma && area !== disegnaArea($('cp-f-elemento').value)) impostaForma(null);
        else impostaForma(forma);
    });
    $('cp-btn-excel').addEventListener('click', apriExcel);
    $('cp-btn-copia').addEventListener('click', apriCopia);
    $('excel-file').addEventListener('change', caricaExcel);
    document.querySelectorAll('.cp-velo').forEach(v => v.addEventListener('click', (e) => {
        if (e.target === v || e.target.closest('[data-chiudi]')) v.hidden = true;
    }));
    $('scheda-copione').addEventListener('click', () => { scheda('copione'); history.replaceState(null, '', location.pathname + location.search); });
    $('scheda-valutazione').addEventListener('click', () => { scheda('valutazione'); history.replaceState(null, '', `${location.pathname}${location.search}#valutazione`); });
    $('cp-debriefing').addEventListener('submit', salvaDebriefing);
    $('db-concludi').addEventListener('click', async () => {
        if (!confirm('Concludere il debriefing? Dopo non si cambia più.')) return;
        if (!(await salvaDebriefing())) return;
        try {
            await fetchApi(`/api/attivita/${idAttivita}/debriefing/concludi`, { method: 'POST', body: '{}' });
            notifica('Debriefing concluso.', 'successo');
            await carica();
        } catch (e) { notifica(e.message, 'errore'); }
    });
    $('cp-pubblica').addEventListener('change', async () => {
        try {
            await fetchApi(`/api/attivita/${idAttivita}/copione/pubblica`, { method: 'PUT', body: JSON.stringify({ pubblicato: $('cp-pubblica').checked }) });
            notifica($('cp-pubblica').checked ? 'Ora chi ha partecipato vede copione e debriefing.' : 'Copione e debriefing tornano solo della regia.', 'successo');
        } catch (e) { notifica(e.message, 'errore'); $('cp-pubblica').checked = !$('cp-pubblica').checked; }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (annullaMappa) return fermaMappa();
        document.querySelectorAll('.cp-velo').forEach(v => { v.hidden = true; });
        if (!$('cp-modulo').hidden) chiudiModulo();
    });
    if (location.hash === '#valutazione' && !idScenario) scheda('valutazione');
    await carica();
});
