// public/js/admin-tesserino.js
//
// Impostazioni › Aspetto del tesserino: il configuratore. L'anteprima è
// disegnata dallo stesso motore della stampa (tesserino.js), con dati di
// esempio e i loghi veri; si trascinano gli elementi, si cambiano misure,
// colori e i due testi fissi. Le modifiche restano qui finché non si salva:
// "Salva" scrive il modello nelle impostazioni (badge_modello) e da quel
// momento la segreteria stampa così.

(function () {
    const T = window.Tesserino;
    const $ = (id) => document.getElementById(id);
    const svg = $('tz-svg');
    const MM = 72 / 25.4;               // punti in un millimetro
    const PASSO = 0.5 * MM;             // la griglia aggancia al mezzo millimetro
    const BORDO = 6;                    // spazio attorno al tesserino nell'anteprima

    let salvato = T.normalizza('');      // com'è nelle impostazioni
    let modello = T.normalizza('');      // com'è adesso, qui
    let scelto = null;
    let esempio = { nome: 'Rossi Maria', distretto: '', ente: '', loghi: [], qr: null, cf: null };
    let enteImpostato = '';
    let qrImmagine = null;
    let disegno = null;

    const copia = (x) => JSON.parse(JSON.stringify(x));
    const uguali = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const mm = (pt) => Math.round(pt / MM * 10) / 10;

    // ---- I dati dell'anteprima ------------------------------------------------

    function datiAnteprima() {
        return {
            ...esempio,
            qr: $('tz-con-qr').checked ? `${location.origin}/badge.html?token=esempio-di-tesserino` : null,
            qrImmagine,
            cf: $('tz-con-cf').checked ? 'RSSMRA85T41H501Z' : null,
            ente: $('tz-con-ente').checked ? (enteImpostato || 'Ente sovraordinato') : ''
        };
    }

    async function immagine(url) {
        try {
            const r = await fetch(url);
            if (!r.ok) return null;
            const b = await r.blob();
            return await new Promise((ok) => { const f = new FileReader(); f.onloadend = () => ok(f.result); f.readAsDataURL(b); });
        } catch { return null; }
    }

    // Il QR dell'anteprima: lo stesso indirizzo che avrebbe un tesserino vero.
    function preparaQr() {
        try {
            const tela = $('tz-qr-tela');
            tela.replaceChildren();
            new QRCode(tela, { text: `${location.origin}/badge.html?token=esempio-di-tesserino`, width: 264, height: 264, correctLevel: QRCode.CorrectLevel.L });
            const c = tela.querySelector('canvas');
            qrImmagine = c ? c.toDataURL('image/png') : null;
        } catch { qrImmagine = null; }
    }

    // ---- Il disegno -------------------------------------------------------------

    const crea = (nome, attributi = {}) => T.nodo(nome, attributi);

    function griglia() {
        const g = crea('g', { 'stroke-width': '0.2' });
        if (!$('tz-griglia').checked) return g;
        const linea = (i, x1, y1, x2, y2) => g.appendChild(crea('line', { x1, y1, x2, y2, stroke: i % 5 ? 'rgba(37,99,235,.10)' : 'rgba(37,99,235,.25)' }));
        for (let i = 1; i * MM < T.LARGHEZZA; i++) linea(i, i * MM, 0, i * MM, T.ALTEZZA);
        for (let i = 1; i * MM < T.ALTEZZA; i++) linea(i, 0, i * MM, T.LARGHEZZA, i * MM);
        return g;
    }

    function ridisegna() {
        disegno = T.componi(modello, datiAnteprima());
        // Gli angoli arrotondati del CR80 (3,18 mm) e un'ombra, per riconoscerlo.
        svg.setAttribute('viewBox', `${-BORDO} ${-BORDO} ${T.LARGHEZZA + 2 * BORDO} ${T.ALTEZZA + 2 * BORDO}`);
        const angoli = crea('clipPath', { id: 'tz-angoli' });
        angoli.appendChild(crea('rect', { x: 0, y: 0, width: T.LARGHEZZA, height: T.ALTEZZA, rx: 9, ry: 9 }));
        const ombra = crea('filter', { id: 'tz-ombra', x: '-5%', y: '-5%', width: '110%', height: '115%' });
        ombra.appendChild(crea('feDropShadow', { dx: 0, dy: 1.2, stdDeviation: 1.6, 'flood-opacity': 0.25 }));
        const defs = crea('defs');
        defs.append(angoli, ombra);
        const carta = crea('g', { 'clip-path': 'url(#tz-angoli)' });
        carta.append(T.inSvg(disegno), griglia());
        svg.replaceChildren(defs, crea('rect', { x: 0, y: 0, width: T.LARGHEZZA, height: T.ALTEZZA, rx: 9, ry: 9, fill: '#fff', filter: 'url(#tz-ombra)' }), carta);

        // Sopra il disegno, un riquadro trasparente per ogni elemento: si
        // prende e si trascina. Le fasce stanno sotto, così si prende prima
        // quello che c'è sopra.
        const disegnati = new Set(disegno.forme.map(f => f.elemento).filter(Boolean));
        const livello = crea('g');
        for (const e of T.ELEMENTI) {
            const p = disegno.posizioni[e.id];
            if (!p || !disegnati.has(e.id)) continue;
            const r = crea('rect', { x: p.x, y: p.y, width: p.w, height: p.h, class: `tz-scelta${scelto === e.id ? ' scelto' : ''}`, 'data-id': e.id });
            const titolo = crea('title');
            titolo.textContent = e.nome;
            r.appendChild(titolo);
            livello.appendChild(r);
        }
        if (scelto && disegno.posizioni[scelto] && disegnati.has(scelto)) {
            const p = disegno.posizioni[scelto];
            for (const [angolo, x, y] of [['nw', p.x, p.y], ['ne', p.x + p.w, p.y], ['sw', p.x, p.y + p.h], ['se', p.x + p.w, p.y + p.h]]) {
                livello.appendChild(crea('rect', { x: x - 2, y: y - 2, width: 4, height: 4, class: 'tz-maniglia', 'data-angolo': angolo,
                    style: `cursor: ${angolo === 'nw' || angolo === 'se' ? 'nwse' : 'nesw'}-resize` }));
            }
        }
        svg.appendChild(livello);
        aggiornaPannello();
        aggiornaAvvisi();
        aggiornaStato();
    }

    // ---- Spostare e ridimensionare ---------------------------------------------

    function inPunti(evento) {
        const p = svg.createSVGPoint();
        p.x = evento.clientX; p.y = evento.clientY;
        return p.matrixTransform(svg.getScreenCTM().inverse());
    }
    const aggancia = (v) => $('tz-griglia').checked ? Math.round(v / PASSO) * PASSO : v;

    // Spostando qualcosa le posizioni diventano personalizzate: si parte da
    // quelle che si vedono in quel momento.
    function personalizza() {
        if (modello.posizioni) return;
        modello.posizioni = copia(disegno.posizioni);
    }

    // Una posizione nuova, dentro il tesserino e mai sotto la misura minima.
    function imposta(id, p) {
        const e = T.PER_ID[id];
        let w = Math.max(e.min[0], Math.min(T.LARGHEZZA, p.w));
        let h = Math.max(e.min[1], Math.min(T.ALTEZZA, p.h));
        if (e.quadrato) w = h = Math.max(w, h);
        const x = Math.max(0, Math.min(T.LARGHEZZA - w, p.x));
        const y = Math.max(0, Math.min(T.ALTEZZA - h, p.y));
        personalizza();
        modello.posizioni[id] = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 };
    }

    let trascina = null;
    let inAttesa = false;
    svg.addEventListener('pointerdown', (ev) => {
        const t = ev.target;
        const angolo = t.getAttribute?.('data-angolo');
        const id = angolo ? scelto : t.getAttribute?.('data-id');
        if (!id) { if (scelto) { scelto = null; ridisegna(); } return; }
        ev.preventDefault();
        if (scelto !== id) { scelto = id; ridisegna(); }
        svg.setPointerCapture(ev.pointerId);
        trascina = { id, angolo, inizio: inPunti(ev), p: { ...disegno.posizioni[id] }, mosso: false };
    });
    svg.addEventListener('pointermove', (ev) => {
        if (!trascina) return;
        const q = inPunti(ev);
        const dx = q.x - trascina.inizio.x, dy = q.y - trascina.inizio.y;
        if (!trascina.mosso && Math.hypot(dx, dy) < 1) return;
        trascina.mosso = true;
        const p = trascina.p;
        let n;
        if (!trascina.angolo) {
            n = { x: aggancia(p.x + dx), y: aggancia(p.y + dy), w: p.w, h: p.h };
        } else {
            // L'angolo opposto resta fermo.
            const a = trascina.angolo;
            let x1 = p.x, y1 = p.y, x2 = p.x + p.w, y2 = p.y + p.h;
            if (a.includes('w')) x1 = aggancia(x1 + dx); else x2 = aggancia(x2 + dx);
            if (a.includes('n')) y1 = aggancia(y1 + dy); else y2 = aggancia(y2 + dy);
            const e = T.PER_ID[trascina.id];
            let w = Math.max(e.min[0], x2 - x1), h = Math.max(e.min[1], y2 - y1);
            if (e.quadrato) w = h = Math.max(w, h);
            n = { x: a.includes('w') ? p.x + p.w - w : p.x, y: a.includes('n') ? p.y + p.h - h : p.y, w, h };
        }
        imposta(trascina.id, n);
        if (!inAttesa) { inAttesa = true; requestAnimationFrame(() => { inAttesa = false; ridisegna(); }); }
    });
    const fine = () => { trascina = null; };
    svg.addEventListener('pointerup', fine);
    svg.addEventListener('pointercancel', fine);

    // Con le frecce l'elemento scelto si sposta di mezzo millimetro (con
    // Maiuscole di due).
    document.addEventListener('keydown', (ev) => {
        if (!scelto || !disegno?.posizioni[scelto]) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
        const passo = (ev.shiftKey ? 2 : 0.5) * MM;
        const d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[ev.key];
        if (!d) { if (ev.key === 'Escape') { scelto = null; ridisegna(); } return; }
        ev.preventDefault();
        const p = disegno.posizioni[scelto];
        imposta(scelto, { ...p, x: p.x + d[0], y: p.y + d[1] });
        ridisegna();
    });

    // ---- Il pannello dell'elemento scelto -------------------------------------

    function rigaColore(chiave) {
        const riga = document.createElement('div');
        riga.className = 'tz-riga';
        const nome = document.createElement('span');
        nome.textContent = T.NOMI_COLORI[chiave];
        const scelta = document.createElement('input');
        scelta.type = 'color';
        scelta.value = modello.colori[chiave];
        scelta.setAttribute('aria-label', `Colore: ${T.NOMI_COLORI[chiave]}`);
        scelta.addEventListener('input', () => { modello.colori[chiave] = scelta.value.toLowerCase(); ridisegna(); });
        riga.append(nome, scelta);
        return riga;
    }

    function aggiornaPannello() {
        const e = scelto ? T.PER_ID[scelto] : null;
        $('tz-scelto').hidden = !e;
        $('tz-scelto-vuoto').hidden = !!e;
        $('tz-scelto-nome').textContent = e ? e.nome : 'Nessun elemento scelto';
        if (e) {
            const p = disegno.posizioni[e.id];
            for (const [campo, k] of [['tz-x', 'x'], ['tz-y', 'y'], ['tz-w', 'w'], ['tz-h', 'h']]) {
                if (document.activeElement !== $(campo)) $(campo).value = mm(p[k]);
            }
            const extra = $('tz-scelto-extra');
            if (extra.dataset.per !== e.id) {
                extra.dataset.per = e.id;
                extra.replaceChildren();
                if (e.testo) {
                    const l = document.createElement('label');
                    l.textContent = 'Testo';
                    const i = document.createElement('input');
                    i.type = 'text'; i.maxLength = 40; i.id = 'tz-testo';
                    i.value = modello.testi[e.testo];
                    i.addEventListener('input', () => {
                        if (i.value.trim()) { modello.testi[e.testo] = i.value.trim(); ridisegna(); }
                    });
                    l.appendChild(i);
                    extra.appendChild(l);
                }
                e.colori.forEach(k => extra.appendChild(rigaColore(k)));
                if (e.nascondibile) {
                    const riga = document.createElement('div');
                    riga.className = 'tz-riga';
                    const l = document.createElement('label');
                    const c = document.createElement('input');
                    c.type = 'checkbox'; c.id = 'tz-mostra';
                    c.addEventListener('change', () => { mostra(e.id, c.checked); });
                    l.append(c, document.createTextNode(' Sul tesserino'));
                    riga.appendChild(l);
                    extra.appendChild(riga);
                }
                if (e.id === 'qr' || e.id === 'codice') {
                    const nota = document.createElement('p');
                    nota.className = 'tz-vuoto';
                    nota.textContent = e.id === 'qr'
                        ? 'Non scende sotto i 13,4 mm di lato, la misura che un telefono legge senza fatica. Si toglie spegnendo i QR nelle Impostazioni.'
                        : `Non scende sotto i ${mm(T.LARGHEZZA_MINIMA_CODICE).toLocaleString('it-IT')} mm di larghezza: ogni barra resta di almeno 0,254 mm. Si toglie spegnendo il codice fiscale nelle Impostazioni.`;
                    extra.appendChild(nota);
                }
            }
            if ($('tz-mostra')) $('tz-mostra').checked = !modello.nascosti.includes(e.id);
            extra.querySelectorAll('input[type=color]').forEach((c, i) => { c.value = modello.colori[e.colori[i]]; });
        }
        aggiornaColori();
        aggiornaElenco();
    }

    for (const [campo, k] of [['tz-x', 'x'], ['tz-y', 'y'], ['tz-w', 'w'], ['tz-h', 'h']]) {
        $(campo).addEventListener('change', () => {
            if (!scelto) return;
            const v = Number(String($(campo).value).replace(',', '.'));
            if (!Number.isFinite(v)) return;
            imposta(scelto, { ...disegno.posizioni[scelto], [k]: v * MM });
            ridisegna();
        });
    }

    function mostra(id, si) {
        modello.nascosti = si ? modello.nascosti.filter(x => x !== id) : [...new Set([...modello.nascosti, id])];
        ridisegna();
    }

    function aggiornaColori() {
        const box = $('tz-colori');
        if (!box.childElementCount) Object.keys(T.COLORI).forEach(k => box.appendChild(rigaColore(k)));
        box.querySelectorAll('input[type=color]').forEach((c, i) => { c.value = modello.colori[Object.keys(T.COLORI)[i]]; });
    }

    // L'elenco: per scegliere anche gli elementi piccoli o nascosti.
    function aggiornaElenco() {
        const v = disegno.varianti;
        const assente = { qr: !v.qr && 'senza QR', codice: !v.codice && 'senza codice fiscale', fascia_ente: !v.ente && "senza l'ente", ente: !v.ente && "senza l'ente" };
        $('tz-elenco').replaceChildren(...T.ELEMENTI.map(e => {
            const riga = document.createElement('div');
            riga.className = `tz-voce${scelto === e.id ? ' attivo' : ''}${modello.nascosti.includes(e.id) ? ' nascosto' : ''}`;
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = e.nome + (assente[e.id] ? ` (non c'è nell'anteprima ${assente[e.id]})` : '');
            b.addEventListener('click', () => { scelto = e.id; ridisegna(); });
            riga.appendChild(b);
            if (e.nascondibile) {
                const c = document.createElement('input');
                c.type = 'checkbox';
                c.checked = !modello.nascosti.includes(e.id);
                c.title = 'Sul tesserino';
                c.setAttribute('aria-label', `${e.nome} sul tesserino`);
                c.addEventListener('change', () => mostra(e.id, c.checked));
                riga.appendChild(c);
            }
            return riga;
        }));
    }

    // ---- Avvisi: sovrapposizioni, scritte minuscole, poco contrasto -------------

    function luminanza(hex) {
        const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const contrasto = (a, b) => { const [x, y] = [luminanza(a), luminanza(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

    function aggiornaAvvisi() {
        const avvisi = [];
        const disegnati = new Set(disegno.forme.map(f => f.elemento).filter(Boolean));
        const pos = disegno.posizioni;
        const pieni = T.ELEMENTI.filter(e => !e.fascia && disegnati.has(e.id));
        for (let i = 0; i < pieni.length; i++) {
            for (let j = i + 1; j < pieni.length; j++) {
                const a = pos[pieni[i].id], b = pos[pieni[j].id];
                const sx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
                const sy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
                if (sx > 1.5 && sy > 1.5) avvisi.push(`${pieni[i].nome} e ${pieni[j].nome.toLowerCase()} si sovrappongono.`);
            }
        }
        // Lo sfondo di una scritta: la fascia più in alto che la contiene, se no lo sfondo.
        const fasce = disegno.forme.filter(f => f.tipo === 'rett' && f.sfondo);
        for (const f of disegno.forme.filter(f => f.tipo === 'testo' && f.elemento && f.elemento !== 'codice')) {
            const e = T.PER_ID[f.elemento];
            if (f.corpo < 5) avvisi.push(`${e.nome}: la scritta è di ${f.corpo.toFixed(1).replace('.', ',')} punti, sul tesserino stampato si legge a fatica.`);
            const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
            const sotto = [...fasce].reverse().find(r => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
            if (sotto && contrasto(f.colore, sotto.colore) < 3) avvisi.push(`${e.nome}: il colore della scritta si distingue poco dal suo sfondo.`);
        }
        $('tz-avvisi').replaceChildren(...avvisi.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
    }

    // ---- Stato, salvataggio --------------------------------------------------------

    function aggiornaStato() {
        $('tz-disposizione').textContent = modello.posizioni
            ? 'Disposizione personalizzata: gli elementi restano dove li hai messi, anche quando un volontario non ha il QR o il codice fiscale.'
            : 'Disposizione automatica: si adatta a QR, codice fiscale e nome dell\'ente di ogni volontario.';
        $('tz-automatiche').hidden = !modello.posizioni;
        const modificato = !uguali(modello, salvato);
        $('tz-salva').disabled = !modificato;
        $('tz-annulla').disabled = !modificato;
        $('tz-salvato').textContent = modificato ? 'Modifiche non salvate.' : 'Nessuna modifica da salvare.';
        $('tz-salvato').className = modificato ? 'tz-modificato' : 'tz-vuoto';
    }

    $('tz-automatiche').addEventListener('click', () => { modello.posizioni = null; ridisegna(); });
    $('tz-colori-predefiniti').addEventListener('click', () => { modello.colori = { ...T.COLORI }; ridisegna(); });
    $('tz-annulla').addEventListener('click', () => { modello = copia(salvato); scelto = null; $('tz-scelto-extra').dataset.per = ''; ridisegna(); });
    $('tz-predefinito').addEventListener('click', () => { modello = T.normalizza(''); scelto = null; $('tz-scelto-extra').dataset.per = ''; ridisegna(); });
    ['tz-con-qr', 'tz-con-cf', 'tz-con-ente', 'tz-griglia'].forEach(id => $(id).addEventListener('change', ridisegna));

    $('tz-salva').addEventListener('click', async () => {
        $('tz-salva').disabled = true;
        // Il tesserino predefinito si salva vuoto: segue gli aggiornamenti di ORION.
        const valore = uguali(modello, T.normalizza('')) ? '' : JSON.stringify(modello);
        try {
            await fetchApi('/api/branding/settings', { method: 'PUT', body: JSON.stringify({ badge_modello: valore }) });
            salvato = copia(modello);
            notifica('Salvato: i prossimi tesserini usciranno così.', 'successo');
        } catch (e) {
            notifica(e.message, 'errore');
        }
        aggiornaStato();
    });

    $('tz-prova').addEventListener('click', () => {
        const dati = datiAnteprima();
        delete dati.qrImmagine;
        pdfMake.createPdf(T.inPdf(T.componi(modello, dati))).download('Tesserino_di_prova.pdf');
    });

    window.addEventListener('beforeunload', (ev) => {
        if (!uguali(modello, salvato)) { ev.preventDefault(); ev.returnValue = ''; }
    });

    // ---- Avvio ------------------------------------------------------------------

    (async () => {
        const [impostazioni, logo, logo2] = await Promise.all([
            fetchApi('/api/branding/settings/full').catch(() => ({})),
            immagine('/logo.png'),
            immagine('/logo2.png'),
            T.caratteri()
        ]);
        salvato = T.normalizza(impostazioni.badge_modello || '');
        modello = copia(salvato);
        enteImpostato = impostazioni.card_regional_entity_name || '';
        esempio = { ...esempio, distretto: impostazioni.card_district_label || '', loghi: [logo2, logo] };
        $('tz-con-qr').checked = impostazioni.badge_qr_enabled !== 'false';
        $('tz-con-cf').checked = impostazioni.badge_cf_barcode !== 'false';
        $('tz-con-ente').checked = !!enteImpostato;
        preparaQr();
        ridisegna();
    })();
})();
