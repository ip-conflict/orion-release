// public/js/admin-mappa-piano.js
//
// Impostazioni › Livelli del piano sulla mappa: importare da QGIS le zone di
// pericolosità e le aree d'emergenza (GeoJSON o KML in WGS84), e vedere o
// togliere quelle già caricate. Il file si legge qui nel browser; al server
// arrivano solo le forme, con il tipo scelto e il nome.

(function () {
    const TIPI = {
        pericolo_alluvione: 'Zone a pericolo di alluvione', pericolo_frana: 'Zone a pericolo di frana',
        pericolo_generico: 'Altre zone di pericolo (incendio, crollo, valanga…)',
        area_attesa: 'Aree di attesa', area_accoglienza: 'Aree di accoglienza',
        area_ammassamento: 'Aree di ammassamento soccorritori', zona_interdetta: 'Zone interdette', altro: 'Altro'
    };
    const FORME_AREA = ['Polygon', 'MultiPolygon'];
    const AMMESSE = {
        pericolo_alluvione: FORME_AREA, pericolo_frana: FORME_AREA, pericolo_generico: FORME_AREA, zona_interdetta: FORME_AREA,
        area_attesa: [...FORME_AREA, 'Point'], area_accoglienza: [...FORME_AREA, 'Point'], area_ammassamento: [...FORME_AREA, 'Point'],
        altro: [...FORME_AREA, 'Point', 'LineString', 'MultiLineString']
    };
    const $ = (id) => document.getElementById(id);
    if (!$('pannello-piano')) return;

    let forme = [];
    let nomeFile = '';

    function errore(testo) {
        $('piano-errore').textContent = testo || '';
        $('piano-errore').hidden = !testo;
    }

    // Da QGIS arriva una FeatureCollection; si accettano anche Feature e geometrie sciolte.
    function featuresDa(geo) {
        if (!geo) return [];
        if (geo.type === 'FeatureCollection') return geo.features || [];
        if (geo.type === 'Feature') return [geo];
        if (geo.type && geo.coordinates) return [{ type: 'Feature', geometry: geo, properties: {} }];
        return [];
    }

    // Il primo numero che si incontra: se è più grande di 180 non sono gradi.
    function primaCoordinata(g) {
        let c = g?.coordinates;
        while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
        return Array.isArray(c) ? c : null;
    }

    $('piano-file').addEventListener('change', async () => {
        errore('');
        $('piano-anteprima').hidden = true;
        const file = $('piano-file').files[0];
        if (!file) return;
        nomeFile = file.name;
        try {
            const testo = await file.text();
            let geo;
            if (/\.kml$/i.test(file.name) || testo.trimStart().startsWith('<')) {
                geo = toGeoJSON.kml(new DOMParser().parseFromString(testo, 'text/xml'));
            } else {
                geo = JSON.parse(testo);
                const crs = geo?.crs?.properties?.name || '';
                if (crs && !/4326|CRS84/i.test(crs)) {
                    throw new Error(`Il file è nel sistema di riferimento ${crs}: in QGIS esportalo scegliendo EPSG:4326 - WGS 84.`);
                }
            }
            // Le geometrie multiple di un KML (GeometryCollection) si aprono in pezzi.
            forme = featuresDa(geo).flatMap(f => f.geometry?.type === 'GeometryCollection'
                ? f.geometry.geometries.map(g => ({ ...f, geometry: g })) : [f]).filter(f => f.geometry);
            if (!forme.length) throw new Error('Nel file non ho trovato forme.');
            const c = primaCoordinata(forme[0].geometry);
            if (c && (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)) {
                throw new Error('Le coordinate non sono in gradi: in QGIS esporta scegliendo il sistema di riferimento EPSG:4326 - WGS 84.');
            }
            const tipiForma = [...new Set(forme.map(f => f.geometry.type))];
            $('piano-letto').textContent = `${file.name}: ${forme.length} ${forme.length === 1 ? 'forma' : 'forme'} (${tipiForma.join(', ')}).`;
            const soloPunti = tipiForma.every(t => t === 'Point');
            $('piano-tipo').replaceChildren(...Object.entries(TIPI)
                .filter(([t]) => tipiForma.some(f => AMMESSE[t].includes(f)))
                .map(([t, n]) => new Option(n, t, false, soloPunti ? t === 'area_attesa' : t === 'pericolo_alluvione')));
            const campi = [...new Set(forme.flatMap(f => Object.keys(f.properties || {})))];
            const probabile = campi.find(k => /^(nome|name|denominaz|descr)/i.test(k)) || '';
            const probabileLivello = campi.find(k => /^(livello|classe|pericol|hazard|grado)/i.test(k)) || '';
            $('piano-campo-nome').replaceChildren(new Option('(nessuno)', ''), ...campi.map(k => new Option(k, k, false, k === probabile)));
            $('piano-campo-livello').replaceChildren(new Option('(nessuno)', ''), ...campi.map(k => new Option(k, k, false, k === probabileLivello)));
            $('piano-anteprima').hidden = false;
        } catch (e) {
            errore(e instanceof SyntaxError ? 'Il file non è un GeoJSON valido.' : e.message);
            $('piano-anteprima').hidden = false;
            $('piano-letto').textContent = file.name;
        }
    });

    $('piano-importa').addEventListener('click', async () => {
        errore('');
        const tipo = $('piano-tipo').value;
        if (!tipo || !forme.length) return;
        const campoNome = $('piano-campo-nome').value;
        const campoLivello = $('piano-campo-livello').value;
        const valide = forme.filter(f => AMMESSE[tipo].includes(f.geometry.type));
        const scartate = forme.length - valide.length;
        const elementi = valide.map(f => ({
            geometria: f.geometry,
            nome: campoNome ? String(f.properties?.[campoNome] ?? '') : '',
            livello: campoLivello ? String(f.properties?.[campoLivello] ?? '') : ''
        }));
        $('piano-importa').disabled = true;
        try {
            const r = await fetchApi('/api/mappa/importa', { method: 'POST', body: JSON.stringify({ tipo, elementi, origine: nomeFile }) });
            notifica(r.message + (scartate ? ` ${scartate} forme di un altro tipo (linee o punti) sono state lasciate fuori.` : ''), 'successo');
            $('piano-anteprima').hidden = true;
            $('piano-file').value = '';
            forme = [];
            elenco();
        } catch (e) {
            errore(e.message);
        } finally {
            $('piano-importa').disabled = false;
        }
    });

    // Quello che c'è già, per tipo e per file: un file aggiornato si reimporta
    // dopo aver tolto quello vecchio.
    async function elenco() {
        const box = $('piano-elenco');
        try {
            const dati = await fetchApi('/api/mappa/elementi');
            const gruppi = new Map();
            (dati.piano || []).forEach(m => {
                const chiave = `${m.tipo}|${m.origine || ''}`;
                if (!gruppi.has(chiave)) gruppi.set(chiave, { tipo: m.tipo, origine: m.origine, quanti: 0 });
                gruppi.get(chiave).quanti++;
            });
            if (!gruppi.size) {
                box.textContent = 'Nessun elemento del piano.';
                return;
            }
            box.replaceChildren(...[...gruppi.values()].map(g => {
                const riga = document.createElement('div');
                riga.style.cssText = 'display:flex; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border-light-color)';
                const testo = document.createElement('span');
                testo.style.flex = '1';
                testo.textContent = `${TIPI[g.tipo] || dati.tipi?.[g.tipo] || g.tipo}: ${g.quanti} ${g.origine ? `da ${g.origine}` : 'disegnati a mano'}`;
                const togli = document.createElement('button');
                togli.type = 'button';
                togli.className = 'button-style button-small btn-pericolo';
                togli.textContent = 'Togli';
                togli.addEventListener('click', async () => {
                    if (!window.confirm(`Togliere dal piano ${g.quanti} elementi "${TIPI[g.tipo] || g.tipo}"${g.origine ? ` importati da ${g.origine}` : ''}?`)) return;
                    try {
                        const q = new URLSearchParams({ tipo: g.tipo });
                        if (g.origine) q.set('origine', g.origine); else q.set('disegnati', '1');
                        const r = await fetchApi(`/api/mappa/piano?${q}`, { method: 'DELETE' });
                        notifica(r.message, 'successo');
                        elenco();
                    } catch (e) { notifica(e.message, 'errore'); }
                });
                riga.append(testo, togli);
                return riga;
            }));
        } catch (e) {
            box.textContent = e.message;
        }
    }
    elenco();
})();

// La cartografia del territorio (cartografia.js sul server): un file MBTiles
// che arriva a pezzi da 16 MB. Un pezzo che non passa si rimanda, tre volte,
// prima di arrendersi: con la linea lenta non si ricomincia da capo.
(function () {
    const $ = (id) => document.getElementById(id);
    if (!$('carto-file')) return;
    const PEZZO = 16 * 1024 * 1024;
    const mb = (b) => `${(b / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;

    function errore(testo) {
        $('carto-errore').textContent = testo || '';
        $('carto-errore').hidden = !testo;
    }

    function mostra(info) {
        const box = $('carto-stato');
        $('carto-togli').hidden = !info?.presente;
        if (!info?.presente) {
            box.textContent = 'Nessuna cartografia caricata: senza internet le mappe restano grigie.';
            return;
        }
        const quando = info.caricata_il ? new Date(info.caricata_il).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '';
        box.innerHTML = '';
        const riga = document.createElement('div');
        riga.textContent = `Caricata: ${info.nome || info.file_originale || 'cartografia'} — ${mb(info.dimensione || 0)}, ` +
            `${(info.tasselli || 0).toLocaleString('it-IT')} tasselli ${String(info.formato).toUpperCase()}, zoom da ${info.zoom_minimo} a ${info.zoom_massimo}` +
            `${quando ? `, il ${quando}` : ''}${info.caricata_da ? ` da ${info.caricata_da}` : ''}.`;
        box.append(riga);
        if (!info.limiti) {
            const nota = document.createElement('div');
            nota.style.color = 'var(--text-muted)';
            nota.textContent = "Il file non dice quale zona copre (manca \"bounds\"): fuori dal territorio la mappa resterà vuota.";
            box.append(nota);
        }
    }

    async function stato() {
        try { mostra(await fetchApi('/api/mappa/cartografia')); } catch (e) { $('carto-stato').textContent = e.message; }
    }

    async function inviaPezzo(blob, id, n) {
        const q = new URLSearchParams({ n: String(n) });
        if (id) q.set('id', id);
        const pausa = (t) => new Promise(r => setTimeout(r, 2000 * t));
        for (let tentativo = 1; tentativo <= 3; tentativo++) {
            let r;
            try {
                r = await fetch(`/api/mappa/cartografia/pezzi?${q}`, {
                    method: 'POST', body: blob, credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/octet-stream', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) }
                });
            } catch {
                if (tentativo === 3) throw new Error('La linea non regge: caricamento interrotto. Riprova più tardi.');
                await pausa(tentativo);
                continue;
            }
            const dati = await r.json().catch(() => ({}));
            if (r.ok) return dati;
            if (r.status < 500 || tentativo === 3) throw new Error(dati.message || `Errore ${r.status}`);
            await pausa(tentativo);
        }
    }

    $('carto-file').addEventListener('change', async () => {
        errore('');
        const file = $('carto-file').files[0];
        if (!file) return;
        if (!/\.mbtiles$/i.test(file.name)) { errore('Serve un file .mbtiles.'); return; }
        $('carto-file').disabled = true;
        $('carto-avanzamento').hidden = false;
        const pezzi = Math.max(1, Math.ceil(file.size / PEZZO));
        let id = null;
        try {
            for (let n = 0; n < pezzi; n++) {
                const r = await inviaPezzo(file.slice(n * PEZZO, (n + 1) * PEZZO), id, n);
                id = r.id;
                $('carto-barra').value = Math.round(((n + 1) / pezzi) * 100);
                $('carto-testo').textContent = `Caricati ${mb(r.byte)} di ${mb(file.size)}…`;
            }
            $('carto-testo').textContent = 'Controllo del file sul server…';
            const info = await fetchApi('/api/mappa/cartografia/fine', { method: 'POST', body: JSON.stringify({ id, byte: file.size, nome: file.name }) });
            mostra(info);
            notifica('Cartografia del territorio caricata: le mappe la useranno come fondo «Territorio (dal server)».', 'successo');
        } catch (e) {
            errore(e.message);
        } finally {
            $('carto-file').disabled = false;
            $('carto-file').value = '';
            $('carto-avanzamento').hidden = true;
        }
    });

    $('carto-togli').addEventListener('click', async () => {
        if (!window.confirm('Togliere la cartografia del territorio? Senza internet le mappe resteranno grigie.')) return;
        try {
            mostra(await fetchApi('/api/mappa/cartografia', { method: 'DELETE' }));
            notifica('Cartografia tolta.', 'successo');
        } catch (e) { notifica(e.message, 'errore'); }
    });

    stato();
})();
