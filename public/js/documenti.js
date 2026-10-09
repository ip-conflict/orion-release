// L'archivio dei documenti del gruppo (src/documenti.js). Tutti gli interni lo
// consultano: cartelle, ricerca, apertura del file, versioni vecchie. Chi ha
// il permesso gruppo.documenti carica, cambia, sostituisce con una versione
// nuova, toglie e ordina le cartelle; chi tiene il magazzino collega i
// libretti ai beni. Il server decide comunque chi vede cosa: la pagina mostra
// quello che riceve.
document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const RUOLI = [['volontario', 'Volontari'], ['coordinatore', 'Coordinatori'], ['segreteria', 'Segreteria'], ['magazziniere', 'Magazzinieri'], ['admin', 'Amministratori']];
    const NOMI_RUOLI = Object.fromEntries(RUOLI);
    const FORMATI = {
        'application/pdf': ['PDF', 'fa-file-pdf'], 'image/jpeg': ['Immagine', 'fa-file-image'], 'image/png': ['Immagine', 'fa-file-image'],
        'image/webp': ['Immagine', 'fa-file-image'], 'text/plain': ['Testo', 'fa-file-lines'],
        'application/msword': ['Word', 'fa-file-word'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['Word', 'fa-file-word'],
        'application/vnd.oasis.opendocument.text': ['Testo', 'fa-file-word'],
        'application/vnd.ms-excel': ['Foglio di calcolo', 'fa-file-excel'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['Foglio di calcolo', 'fa-file-excel'],
        'application/vnd.oasis.opendocument.spreadsheet': ['Foglio di calcolo', 'fa-file-excel'],
        'application/vnd.ms-powerpoint': ['Presentazione', 'fa-file-powerpoint'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['Presentazione', 'fa-file-powerpoint'],
        'application/vnd.oasis.opendocument.presentation': ['Presentazione', 'fa-file-powerpoint']
    };

    let archivio = { cartelle: [], documenti: [], gestisce: false };
    let magazzinoAcceso = false;
    let documentoAperto = null;
    let inModifica = null;
    const puoCollegare = () => magazzinoAcceso && (archivio.gestisce || haPermesso('magazzino.gestione'));

    const peso = (byte) => {
        const n = Number(byte) || 0;
        if (n < 1024) return `${n} byte`;
        if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
        return `${(n / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
    };
    const data = (d) => (d ? new Date(d).toLocaleDateString('it-IT') : '');
    const urlFile = (id, versione) => `/api/documenti/${id}/file${versione ? `?versione=${versione}` : ''}`;
    const elemento = (tag, classe, testo) => {
        const e = document.createElement(tag);
        if (classe) e.className = classe;
        if (testo !== undefined) e.textContent = testo;
        return e;
    };

    function segni(doc) {
        const box = elemento('span', 'segni');
        if (doc.visibilita === 'ruoli') box.appendChild(elemento('span', 'pastiglia neutra', `Solo ${doc.ruoli.map(r => NOMI_RUOLI[r] || r).join(', ')}`));
        if (doc.in_emergenza) box.appendChild(elemento('span', 'pastiglia attesa', 'In emergenza'));
        if (doc.sempre_con_me) box.appendChild(elemento('span', 'pastiglia ok', 'Sempre con me'));
        return box;
    }

    // --- L'elenco -------------------------------------------------------------
    function disegna() {
        const box = $('elenco-documenti');
        box.replaceChildren();
        const cerca = $('cerca-documenti').value.trim().toLowerCase();
        const trovati = archivio.documenti.filter(d => !cerca
            || [d.titolo, d.descrizione, d.nome_originale].some(t => (t || '').toLowerCase().includes(cerca)));

        const gruppi = archivio.cartelle.map(c => ({ cartella: c, documenti: trovati.filter(d => d.cartella_id === c.id) }));
        const sciolti = trovati.filter(d => !archivio.cartelle.some(c => c.id === d.cartella_id));
        if (sciolti.length) gruppi.push({ cartella: null, documenti: sciolti });

        let mostrati = 0;
        for (const { cartella, documenti } of gruppi) {
            // Cercando, le cartelle vuote non servono; chi tiene l'archivio le vede sempre.
            if (!documenti.length && (cerca || !archivio.gestisce)) continue;
            mostrati += documenti.length;
            const sezione = elemento('section', 'cartella');
            const testa = elemento('div', 'testa-cartella');
            const nomi = elemento('div');
            nomi.appendChild(elemento('h2', '', cartella ? cartella.nome : 'Senza cartella'));
            if (cartella?.descrizione) nomi.appendChild(elemento('p', 'nota', cartella.descrizione));
            testa.appendChild(nomi);
            if (cartella && archivio.gestisce) {
                const azioni = elemento('div', 'gruppo-azioni');
                const rinomina = elemento('button', 'btn-icona');
                rinomina.type = 'button';
                rinomina.title = 'Rinomina la cartella';
                rinomina.setAttribute('aria-label', `Rinomina ${cartella.nome}`);
                rinomina.innerHTML = '<i class="fas fa-pen"></i>';
                rinomina.addEventListener('click', () => rinominaCartella(cartella));
                azioni.appendChild(rinomina);
                if (!documenti.length) {
                    const togli = elemento('button', 'btn-icona');
                    togli.type = 'button';
                    togli.title = 'Togli la cartella vuota';
                    togli.setAttribute('aria-label', `Togli ${cartella.nome}`);
                    togli.innerHTML = '<i class="fas fa-trash"></i>';
                    togli.addEventListener('click', () => togliCartella(cartella));
                    azioni.appendChild(togli);
                }
                testa.appendChild(azioni);
            }
            sezione.appendChild(testa);

            const lista = elemento('ul', 'lista-documenti');
            if (!documenti.length) lista.appendChild(elemento('li', 'nota vuota', 'Nessun documento.'));
            for (const d of documenti) lista.appendChild(riga(d));
            sezione.appendChild(lista);
            box.appendChild(sezione);
        }
        if (!mostrati && !box.children.length) {
            box.appendChild(elemento('p', 'nota', cerca ? 'Nessun documento corrisponde alla ricerca.'
                : 'Non ci sono ancora documenti che puoi consultare.'));
        }
    }

    function riga(d) {
        const li = elemento('li', 'riga-documento');
        const [formato, icona] = FORMATI[d.tipo] || ['File', 'fa-file'];
        const link = elemento('a', 'titolo-documento');
        link.href = urlFile(d.id);
        link.target = '_blank';
        link.rel = 'noopener';
        const i = elemento('i', `fas ${icona}`);
        i.setAttribute('aria-hidden', 'true');
        link.append(i, ` ${d.titolo}`);
        const corpo = elemento('div', 'corpo-documento');
        corpo.appendChild(link);
        if (d.descrizione) corpo.appendChild(elemento('p', 'descrizione', d.descrizione));
        const meta = elemento('p', 'meta');
        meta.textContent = `${formato} · ${peso(d.dimensione)} · ${d.versioni > 1 ? `versione ${d.versione}, ` : ''}aggiornato il ${data(d.caricato_il)}`
            + (d.beni?.length ? ` · ${d.beni.map(b => b.denominazione).join(', ')}` : '');
        meta.appendChild(segni(d));
        corpo.appendChild(meta);
        const dettagli = elemento('button', 'button-style button-secondary btn-piccolo', archivio.gestisce ? 'Gestisci' : 'Dettagli');
        dettagli.type = 'button';
        dettagli.addEventListener('click', () => apriDettaglio(d.id));
        li.append(corpo, dettagli);
        return li;
    }

    async function carica() {
        try {
            archivio = await fetchApi('/api/documenti');
        } catch (e) {
            $('elenco-documenti').replaceChildren(elemento('p', 'nota', e.message));
            return;
        }
        document.querySelectorAll('.solo-gestione').forEach(e => { e.hidden = !archivio.gestisce; });
        if (archivio.gestisce) {
            $('spazio-occupato').textContent = `L'archivio occupa ${peso(archivio.byte_totali)}, versioni vecchie comprese, e finisce in ogni backup. `
                + `Un file al massimo ${archivio.mb_massimi} MB.`;
        }
        if (ruoliUtente().includes('esterno')) {
            $('sottotitolo').textContent = "I documenti che il gruppo mette a disposizione durante l'emergenza.";
        }
        disegna();
    }

    $('cerca-documenti').addEventListener('input', disegna);

    // --- Le modali --------------------------------------------------------------
    function chiudi(modale) { modale.hidden = true; }
    document.querySelectorAll('.modale').forEach(m => {
        m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-chiudi]')) chiudi(m); });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.querySelectorAll('.modale').forEach(chiudi);
    });

    // --- Caricare e modificare -----------------------------------------------------
    function riempiCartelle(scelta) {
        const select = $('doc-cartella');
        select.replaceChildren(new Option('(nessuna cartella)', ''));
        archivio.cartelle.forEach(c => select.appendChild(new Option(c.nome, c.id)));
        select.value = scelta ?? '';
    }

    function riempiRuoli(scelti = []) {
        const box = $('scelta-ruoli');
        box.replaceChildren();
        for (const [codice, nome] of RUOLI.filter(([c]) => c !== 'admin')) {
            const l = elemento('label', 'scelta');
            const c = document.createElement('input');
            c.type = 'checkbox';
            c.value = codice;
            c.checked = scelti.includes(codice);
            l.append(c, ` ${nome}`);
            box.appendChild(l);
        }
    }

    function aggiornaVisibilita() {
        $('scelta-ruoli').hidden = document.querySelector('input[name="visibilita"]:checked').value !== 'ruoli';
    }
    document.querySelectorAll('input[name="visibilita"]').forEach(r => r.addEventListener('change', aggiornaVisibilita));

    function apriModulo(doc = null) {
        inModifica = doc;
        $('form-documento').reset();
        $('titolo-modale-documento').textContent = doc ? 'Modifica il documento' : 'Carica un documento';
        $('salva-documento').textContent = doc ? 'Salva' : 'Carica';
        $('campo-file').hidden = !!doc;
        $('doc-file').required = !doc;
        riempiCartelle(doc?.cartella_id);
        riempiRuoli(doc?.ruoli || []);
        $('doc-titolo').value = doc?.titolo || '';
        $('doc-descrizione').value = doc?.descrizione || '';
        document.querySelector(`input[name="visibilita"][value="${doc?.visibilita === 'ruoli' ? 'ruoli' : 'interni'}"]`).checked = true;
        $('doc-emergenza').checked = !!doc?.in_emergenza;
        $('doc-sempre').checked = !!doc?.sempre_con_me;
        aggiornaVisibilita();
        $('modale-documento').hidden = false;
        $('doc-titolo').focus();
    }

    // Il titolo proposto dal nome del file, se non è già stato scritto.
    $('doc-file').addEventListener('change', () => {
        const file = $('doc-file').files[0];
        if (file && !$('doc-titolo').value.trim()) $('doc-titolo').value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    });

    $('btn-carica').addEventListener('click', () => apriModulo());

    $('form-documento').addEventListener('submit', async (e) => {
        e.preventDefault();
        const visibilita = document.querySelector('input[name="visibilita"]:checked').value;
        const ruoli = [...$('scelta-ruoli').querySelectorAll('input:checked')].map(c => c.value);
        if (visibilita === 'ruoli' && !ruoli.length) return notifica('Scegli almeno un ruolo, o lascialo a tutti gli interni.', 'attenzione');
        const campi = {
            titolo: $('doc-titolo').value.trim(), descrizione: $('doc-descrizione').value.trim(),
            cartella_id: $('doc-cartella').value || null, visibilita, ruoli,
            in_emergenza: $('doc-emergenza').checked, sempre_con_me: $('doc-sempre').checked
        };
        const pulsante = $('salva-documento');
        pulsante.disabled = true;
        try {
            if (inModifica) {
                await fetchApi(`/api/documenti/${inModifica.id}`, { method: 'PUT', body: JSON.stringify(campi) });
                notifica('Documento aggiornato.', 'successo');
            } else {
                const file = $('doc-file').files[0];
                if (!file) return notifica('Scegli il file da caricare.', 'attenzione');
                if (file.size > archivio.mb_massimi * 1024 * 1024) return notifica(`Il file supera i ${archivio.mb_massimi} MB: riducilo prima di caricarlo.`, 'attenzione');
                const modulo = new FormData();
                Object.entries(campi).forEach(([k, v]) => modulo.append(k, Array.isArray(v) ? v.join(',') : (v ?? '')));
                modulo.append('file', file);
                await fetchApi('/api/documenti', { method: 'POST', body: modulo });
                notifica('Documento caricato.', 'successo');
            }
            chiudi($('modale-documento'));
            const riaprire = inModifica?.id;
            await carica();
            if (riaprire) apriDettaglio(riaprire);
        } catch (errore) {
            notifica(errore.message, 'errore');
        } finally {
            pulsante.disabled = false;
        }
    });

    // --- Le cartelle -------------------------------------------------------------
    $('btn-nuova-cartella').addEventListener('click', async () => {
        const nome = prompt('Nome della cartella nuova:');
        if (!nome?.trim()) return;
        try {
            await fetchApi('/api/documenti-cartelle', { method: 'POST', body: JSON.stringify({ nome: nome.trim() }) });
            await carica();
        } catch (e) { notifica(e.message, 'errore'); }
    });

    async function rinominaCartella(cartella) {
        const nome = prompt('Nuovo nome della cartella:', cartella.nome);
        if (!nome?.trim() || nome.trim() === cartella.nome) return;
        try {
            await fetchApi(`/api/documenti-cartelle/${cartella.id}`, { method: 'PUT', body: JSON.stringify({ nome: nome.trim(), descrizione: cartella.descrizione }) });
            await carica();
        } catch (e) { notifica(e.message, 'errore'); }
    }

    async function togliCartella(cartella) {
        try {
            await fetchApi(`/api/documenti-cartelle/${cartella.id}`, { method: 'DELETE' });
            notifica(`Cartella "${cartella.nome}" tolta.`, 'successo');
            await carica();
        } catch (e) { notifica(e.message, 'errore'); }
    }

    // --- La scheda di un documento ------------------------------------------------
    async function apriDettaglio(id) {
        let doc;
        try {
            doc = await fetchApi(`/api/documenti/${id}`);
        } catch (e) { return notifica(e.message, 'errore'); }
        documentoAperto = doc;
        $('titolo-dettaglio').textContent = doc.titolo;
        $('descrizione-dettaglio').textContent = doc.descrizione || '';
        $('descrizione-dettaglio').hidden = !doc.descrizione;
        const s = segni(doc);
        $('segni-dettaglio').replaceChildren(...(s.children.length ? [s] : []));
        $('apri-dettaglio').href = urlFile(doc.id);
        $('form-versione').hidden = true;
        document.querySelectorAll('#modale-dettaglio .solo-gestione').forEach(e => { e.hidden = !archivio.gestisce; });

        const versioni = $('versioni-dettaglio');
        versioni.replaceChildren();
        for (const v of doc.storico) {
            const li = elemento('li');
            const a = elemento('a', '', `Versione ${v.numero}`);
            a.href = urlFile(doc.id, v.numero);
            a.target = '_blank';
            a.rel = 'noopener';
            li.appendChild(a);
            li.append(` · ${v.nome_originale} · ${peso(v.dimensione)} · ${data(v.caricato_il)}${v.caricato_da_nome ? `, ${v.caricato_da_nome}` : ''}`);
            if (v.nota) li.appendChild(elemento('div', 'nota', v.nota));
            versioni.appendChild(li);
        }
        disegnaBeni(doc);
        $('modale-dettaglio').hidden = false;
    }

    function disegnaBeni(doc) {
        const collega = puoCollegare();
        $('sezione-beni').hidden = !magazzinoAcceso || (!doc.beni.length && !collega);
        $('collega-bene').hidden = !collega;
        $('cerca-bene').value = '';
        $('risultati-bene').replaceChildren();
        const lista = $('beni-dettaglio');
        lista.replaceChildren();
        if (!doc.beni.length) lista.appendChild(elemento('li', 'nota', 'Nessuno.'));
        for (const b of doc.beni) {
            const li = elemento('li', 'riga-bene', `${b.denominazione}${b.matricola ? ` (${b.matricola})` : ''}`);
            if (collega) {
                const togli = elemento('button', 'btn-icona');
                togli.type = 'button';
                togli.title = 'Scollega';
                togli.setAttribute('aria-label', `Scollega ${b.denominazione}`);
                togli.innerHTML = '<i class="fas fa-link-slash"></i>';
                togli.addEventListener('click', async () => {
                    try {
                        const agg = await fetchApi(`/api/documenti/${doc.id}/beni/${b.id}`, { method: 'DELETE' });
                        documentoAperto = { ...documentoAperto, beni: agg.beni };
                        disegnaBeni(documentoAperto);
                        carica();
                    } catch (e) { notifica(e.message, 'errore'); }
                });
                li.appendChild(togli);
            }
            lista.appendChild(li);
        }
    }

    let attesaRicerca = null;
    $('cerca-bene').addEventListener('input', () => {
        clearTimeout(attesaRicerca);
        attesaRicerca = setTimeout(async () => {
            const q = $('cerca-bene').value.trim();
            const box = $('risultati-bene');
            box.replaceChildren();
            if (q.length < 2) return;
            try {
                const beni = (await fetchApi(`/api/magazzino/beni?q=${encodeURIComponent(q)}`)).filter(b => !b.modello_id).slice(0, 8);
                if (!beni.length) box.appendChild(elemento('li', 'nota', 'Nessun bene trovato.'));
                for (const b of beni) {
                    if (documentoAperto.beni.some(x => x.id === b.id)) continue;
                    const li = elemento('li');
                    const scegli = elemento('button', 'button-style button-secondary btn-piccolo', `Collega ${b.denominazione}${b.matricola ? ` (${b.matricola})` : ''}`);
                    scegli.type = 'button';
                    scegli.addEventListener('click', async () => {
                        try {
                            const agg = await fetchApi(`/api/documenti/${documentoAperto.id}/beni`, { method: 'POST', body: JSON.stringify({ bene_id: b.id }) });
                            documentoAperto = { ...documentoAperto, beni: agg.beni };
                            disegnaBeni(documentoAperto);
                            carica();
                        } catch (e) { notifica(e.message, 'errore'); }
                    });
                    li.appendChild(scegli);
                    box.appendChild(li);
                }
            } catch (e) { notifica(e.message, 'errore'); }
        }, 250);
    });

    $('btn-modifica').addEventListener('click', () => {
        chiudi($('modale-dettaglio'));
        apriModulo(documentoAperto);
    });

    $('btn-versione').addEventListener('click', () => {
        $('form-versione').reset();
        $('form-versione').hidden = false;
        $('versione-file').focus();
    });
    $('annulla-versione').addEventListener('click', () => { $('form-versione').hidden = true; });

    $('form-versione').addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = $('versione-file').files[0];
        if (!file) return;
        if (file.size > archivio.mb_massimi * 1024 * 1024) return notifica(`Il file supera i ${archivio.mb_massimi} MB: riducilo prima di caricarlo.`, 'attenzione');
        const modulo = new FormData();
        modulo.append('nota', $('versione-nota').value.trim());
        modulo.append('file', file);
        try {
            const agg = await fetchApi(`/api/documenti/${documentoAperto.id}/versioni`, { method: 'POST', body: modulo });
            notifica(`Caricata la versione ${agg.versione}.`, 'successo');
            await carica();
            apriDettaglio(documentoAperto.id);
        } catch (errore) { notifica(errore.message, 'errore'); }
    });

    $('btn-togli').addEventListener('click', async () => {
        const d = documentoAperto;
        const quante = d.storico.length > 1 ? ` con le sue ${d.storico.length} versioni` : '';
        if (!confirm(`Togliere "${d.titolo}"${quante} dall'archivio? I file si cancellano e non si recuperano, se non da un backup.`)) return;
        try {
            await fetchApi(`/api/documenti/${d.id}`, { method: 'DELETE' });
            chiudi($('modale-dettaglio'));
            notifica('Documento tolto.', 'successo');
            await carica();
        } catch (e) { notifica(e.message, 'errore'); }
    });

    // --- Avvio -------------------------------------------------------------------
    fetch('/api/branding/settings', { credentials: 'same-origin' })
        .then(r => (r.ok ? r.json() : {}))
        .then(impostazioni => { magazzinoAcceso = String(impostazioni.magazzino_enabled) === 'true'; })
        .catch(() => {})
        .finally(async () => {
            await carica();
            // Arrivo da un collegamento (?documento=ID): si apre la sua scheda.
            const chiesto = parseInt(new URLSearchParams(window.location.search).get('documento'), 10);
            if (chiesto) apriDettaglio(chiesto);
        });
});
