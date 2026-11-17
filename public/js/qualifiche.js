// Come si riconoscono a colpo d'occhio le squadre e le persone che vengono da fuori. I codici sono quelli
// di QUALIFICHE in src/costanti.js; i nomi arrivano da /api/qualifiche, qui ci sono sigla e colori.
(function () {
    // Solo sigle e colori: gli stemmi degli enti, e la croce rossa su fondo bianco, sono protetti e non si usano.
    const STILI = {
        vvf: { sigla: 'VVF', colore: '#c62828', testo: '#fff', anello: '#5b0f0f' },
        pc_esterno: { sigla: 'PC', colore: '#fdd835', testo: '#1a1a1a', anello: '#0B233F' },
        polizia_locale: { sigla: 'PL', colore: '#00796b', testo: '#fff', anello: '#003d33' },
        polizia: { sigla: 'PS', colore: '#1565c0', testo: '#fff', anello: '#0a2f5c' },
        carabinieri: { sigla: 'CC', colore: '#1f2937', testo: '#fff', anello: '#c62828' },
        sanitario: { sigla: '118', colore: '#ad1457', testo: '#fff', anello: '#4a0828' },
        croce_rossa: { sigla: 'CRI', colore: '#fff', testo: '#c62828', anello: '#c62828' },
        soccorso_alpino: { sigla: 'CNSAS', colore: '#2e7d32', testo: '#fff', anello: '#123d16' },
        forze_armate: { sigla: 'FA', colore: '#556b2f', testo: '#fff', anello: '#232d12' },
        altro_ente: { sigla: 'EN', colore: '#6d4c41', testo: '#fff', anello: '#2e1f1a' }
    };
    let nomi = null;

    async function carica() {
        if (nomi) return nomi;
        try {
            const r = await fetch('/api/qualifiche', { credentials: 'same-origin' });
            nomi = r.ok ? await r.json() : {};
        } catch { nomi = {}; }
        return nomi;
    }

    function stile(codice) { return codice && STILI[codice] ? STILI[codice] : null; }
    function nome(codice) { return (nomi && nomi[codice]) || stile(codice)?.sigla || ''; }
    // Il bianco della Croce Rossa come bordo sparirebbe sullo sfondo chiaro.
    function bordo(codice) { const s = stile(codice); return s && (s.colore === '#fff' ? s.anello : s.colore); }

    // Colore dell'ente, anello bianco e bordo scuro: la stessa veste per il cerchio sulla mappa e per l'etichetta.
    function vesti(e, s) {
        e.style.background = s.colore;
        e.style.color = s.testo;
        e.style.setProperty('--anello-ente', s.anello);
        return e;
    }
    function span(classe, testo) {
        const e = document.createElement('span');
        e.className = classe;
        if (testo !== undefined) e.textContent = testo;
        return e;
    }
    function etichetta(codice, testo = stile(codice).sigla) {
        const e = vesti(span('bollino-qualifica', testo), stile(codice));
        e.title = nome(codice);
        return e;
    }

    // Restituiscono markup già scappato, per chi compone con innerHTML; vuoto per le squadre del gruppo.
    function bollino(codice, { conNome = false } = {}) {
        if (!stile(codice)) return '';
        return etichetta(codice, conNome ? nome(codice) : stile(codice).sigla).outerHTML;
    }
    function cartellino(codice, nomeRadio) {
        if (!stile(codice)) return '';
        const e = span('cartellino-squadra esterna');
        e.style.borderColor = bordo(codice);
        e.append(etichetta(codice), document.createTextNode(` ${nomeRadio}`));
        return e.outerHTML;
    }
    // Sulla mappa la lettera resta quella della squadra, unica come il nome radio; la sigla sta sotto.
    function segnaposto(codice, lettera) {
        if (!stile(codice)) return '';
        const e = vesti(span('marker-ente'), stile(codice));
        e.title = nome(codice);
        e.append(span('marker-letter', lettera), etichetta(codice));
        e.lastChild.className = 'bollino-qualifica marker-ente-sigla';
        return e.outerHTML;
    }

    async function riempiScelta(select, scelto = '', vuota = 'Nessuna') {
        const elenco = await carica();
        select.replaceChildren(new Option(vuota, ''));
        for (const [codice, n] of Object.entries(elenco)) select.add(new Option(n, codice));
        select.value = scelto || '';
    }

    carica();
    window.Qualifiche = { STILI, carica, stile, nome, bordo, bollino, cartellino, segnaposto, riempiScelta };
})();
