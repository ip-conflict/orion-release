// Il calendario del gruppo (src/attivita.js): il mese con le attività, le
// emergenze e le scadenze; la scheda di un'attività con la risposta ("Ci
// sono", "Non posso"); per chi organizza la creazione, le convocazioni, chi
// ha risposto e chi non si raggiunge, la chiusura con i presenti; le presenze
// delle emergenze da correggere e il riepilogo dell'anno (src/presenze.js).
// Sul telefono il mese diventa un elenco di giorni.
document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    const NOMI_FILTRI = { attivita: 'Attività', emergenze: 'Emergenze', mie: 'Le mie scadenze', segreteria: 'Scadenze segreteria', magazzino: 'Scadenze magazzino', reperibili: 'Reperibilità', assenti: 'Assenze' };
    const CHIAVE_FILTRI = 'orion.calendario.filtri';

    let mese = new Date(); mese.setDate(1); mese.setHours(12, 0, 0, 0);
    let dati = null;
    let tipi = [];
    let persone = null;
    let corsi = null;
    let aperta = null;
    let inModifica = null;
    let daScenario = null;   // lo scenario della biblioteca che si sta pianificando
    let spenti = new Set();
    try { spenti = new Set(JSON.parse(localStorage.getItem(CHIAVE_FILTRI) || '[]')); } catch { /* niente */ }

    // --- Date ---------------------------------------------------------------------
    // I timestamp arrivano da PostgreSQL ("2026-10-12 18:30:00+00").
    const data = (v) => v instanceof Date ? v : new Date(String(v).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    const due = (n) => String(n).padStart(2, '0');
    const chiaveGiorno = (d) => `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;
    const oraDi = (v) => data(v).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const giornoDi = (v) => data(v).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
    const perInput = (v) => { const d = data(v); return `${chiaveGiorno(d)}T${due(d.getHours())}:${due(d.getMinutes())}`; };
    const daInput = (v) => (v ? new Date(v).toISOString() : null);
    function quando(a) {
        const i = data(a.inizio), f = data(a.fine);
        return chiaveGiorno(i) === chiaveGiorno(f)
            ? `${giornoDi(i)}, ${oraDi(i)}-${oraDi(f)}`
            : `${giornoDi(i)} ${oraDi(i)} - ${giornoDi(f)} ${oraDi(f)}`;
    }
    const ore = (minuti) => { const h = Math.floor(minuti / 60), m = minuti % 60; return m ? `${h} h ${due(m)}` : `${h} h`; };

    const el = (tag, classe, testo) => {
        const e = document.createElement(tag);
        if (classe) e.className = classe;
        if (testo !== undefined && testo !== null) e.textContent = testo;
        return e;
    };

    // --- Modali -----------------------------------------------------------------------
    const chiudi = (m) => { m.hidden = true; };
    document.querySelectorAll('.modale').forEach(m => m.addEventListener('click', (e) => {
        if (e.target === m || e.target.closest('[data-chiudi]')) chiudi(m);
    }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.modale').forEach(chiudi); });

    // --- Il mese ------------------------------------------------------------------------
    function periodo() {
        const primo = new Date(mese);
        const inizio = new Date(primo);
        inizio.setDate(1 - ((primo.getDay() + 6) % 7));
        const fine = new Date(inizio);
        fine.setDate(inizio.getDate() + 41);
        return { inizio, fine };
    }

    async function carica() {
        const { inizio, fine } = periodo();
        $('titolo-mese').textContent = `${MESI[mese.getMonth()]} ${mese.getFullYear()}`;
        $('griglia').setAttribute('aria-busy', 'true');
        try {
            dati = await fetchApi(`/api/calendario?da=${chiaveGiorno(inizio)}&a=${chiaveGiorno(fine)}`);
        } catch (e) {
            if (e.body?.modulo_spento) {
                $('modulo-spento').hidden = false;
                $('griglia').replaceChildren();
                return;
            }
            notifica(e.message, 'errore');
            return;
        }
        $('btn-nuova').hidden = !dati.organizza;
        $('btn-turno').hidden = !dati.organizza;
        $('btn-presenze').hidden = !(dati.organizza || haPermesso('volontari.anagrafica'));
        disegnaFiltri();
        disegna();
        $('griglia').setAttribute('aria-busy', 'false');
    }

    function disegnaFiltri() {
        const box = $('filtri');
        box.replaceChildren();
        const disponibili = ['attivita', 'emergenze', ...['mie', 'segreteria', 'magazzino'].filter(k => dati.filtri[k]),
            ...['reperibili', 'assenti'].filter(k => dati.organizza || (dati.turni || []).some(t => t.categoria === k))];
        for (const k of disponibili) {
            const b = el('button', `filtro filtro-${k}${spenti.has(k) ? '' : ' acceso'}`, NOMI_FILTRI[k]);
            b.type = 'button';
            b.setAttribute('aria-pressed', String(!spenti.has(k)));
            b.addEventListener('click', () => {
                spenti.has(k) ? spenti.delete(k) : spenti.add(k);
                try { localStorage.setItem(CHIAVE_FILTRI, JSON.stringify([...spenti])); } catch { /* niente */ }
                disegnaFiltri();
                disegna();
            });
            box.appendChild(b);
        }
    }

    // Le voci di un giorno: attività ed emergenze che lo toccano, scadenze del giorno.
    function vociDel(giorno) {
        const voci = [];
        const inizioG = new Date(`${giorno}T00:00:00`), fineG = new Date(`${giorno}T23:59:59`);
        if (!spenti.has('attivita')) {
            for (const a of dati.attivita) if (data(a.inizio) <= fineG && data(a.fine) >= inizioG) voci.push({ genere: 'attivita', a });
        }
        if (!spenti.has('emergenze')) {
            for (const e of dati.emergenze) if (data(e.inizio) <= fineG && (e.fine ? data(e.fine) : new Date()) >= inizioG) voci.push({ genere: 'emergenza', e });
        }
        for (const s of dati.scadenze) if (s.giorno === giorno && !spenti.has(s.categoria)) voci.push({ genere: 'scadenze', s });
        for (const t of dati.turni || []) if (t.giorno === giorno && !spenti.has(t.categoria)) voci.push({ genere: 'turni', t });
        return voci;
    }

    function chip(v) {
        const b = el('button', 'voce');
        b.type = 'button';
        if (v.genere === 'attivita') {
            const a = v.a;
            b.classList.add('voce-attivita', `stato-${a.stato}`);
            if (a.mia_risposta === 'si') b.classList.add('risposto-si');
            else if (a.mia_risposta === 'no') b.classList.add('risposto-no');
            else if (a.puo_rispondere && a.convocazione !== 'aperta') b.classList.add('da-rispondere');
            const segno = a.mia_risposta === 'si' ? '✓ ' : a.mia_risposta === 'no' ? '✗ ' : '';
            b.textContent = `${segno}${oraDi(a.inizio)} ${a.titolo}`;
            b.title = `${a.tipo || 'Attività'}: ${a.titolo}\n${quando(a)}${a.stato === 'annullata' ? '\nAnnullata' : ''}`;
            b.addEventListener('click', () => apriAttivita(a.id));
        } else if (v.genere === 'emergenza') {
            b.classList.add(v.e.simulazione ? 'voce-simulazione' : 'voce-emergenza');
            b.textContent = v.e.simulazione ? `Simulazione ${v.e.name || v.e.code}` : `Emergenza ${v.e.code}`;
            b.addEventListener('click', () => apriEmergenza(v.e));
        } else if (v.genere === 'turni') {
            const t = v.t;
            b.classList.add('voce-turni', `cat-${t.categoria}`);
            const solo = t.voci.length === 1 && t.voci[0].mio;
            b.textContent = t.categoria === 'reperibili'
                ? (solo ? 'Sei reperibile' : `Reperibili: ${t.conteggio}`)
                : (solo ? 'Sei assente' : `Assenti: ${t.conteggio}`);
            b.addEventListener('click', () => apriTurni(t));
        } else {
            b.classList.add('voce-scadenze', `cat-${v.s.categoria}`);
            const nome = { mie: 'mie', segreteria: 'segreteria', magazzino: 'magazzino' }[v.s.categoria];
            b.textContent = v.s.categoria === 'mie' && v.s.conteggio === 1 ? v.s.voci[0].titolo : `${v.s.conteggio} scad. ${nome}`;
            b.addEventListener('click', () => apriScadenze(v.s));
        }
        return b;
    }

    function disegna() {
        const { inizio } = periodo();
        const oggi = chiaveGiorno(new Date());
        const griglia = $('griglia');
        griglia.replaceChildren();
        GIORNI.forEach(g => griglia.appendChild(el('div', 'intestazione-giorno', g)));
        const agenda = $('agenda');
        agenda.replaceChildren();
        // Sul telefono, nel mese in corso, i giorni già passati stanno chiusi in
        // cima: l'elenco comincia da oggi, che è quello che si cerca.
        const passati = el('details', 'giorni-passati');
        const titoloPassati = el('summary', '', '');
        passati.appendChild(titoloPassati);
        let quantiPassati = 0;
        for (let i = 0; i < 42; i++) {
            const d = new Date(inizio); d.setDate(inizio.getDate() + i);
            const g = chiaveGiorno(d);
            const fuori = d.getMonth() !== mese.getMonth();
            const cella = el('div', `giorno${fuori ? ' fuori-mese' : ''}${g === oggi ? ' oggi' : ''}${dati?.organizza ? ' cliccabile' : ''}`);
            cella.appendChild(el('span', 'numero-giorno', String(d.getDate())));
            // Chi organizza tocca il giorno (non una voce) e l'attività nuova è già lì.
            if (dati?.organizza) {
                const quel = new Date(d);
                cella.title = `Nuova attività ${quel.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}`;
                cella.addEventListener('click', (e) => { if (!e.target.closest('button, a')) apriForm(null, quel); });
            }
            const voci = vociDel(g);
            // Un giorno pieno non allunga tutta la settimana: le prime voci e "+N altre".
            const MASSIMO = 5;
            const visibili = voci.length > MASSIMO ? voci.slice(0, MASSIMO - 1) : voci;
            visibili.forEach(v => cella.appendChild(chip(v)));
            if (visibili.length < voci.length) {
                const altre = el('button', 'altre-voci', `+${voci.length - visibili.length} altre`);
                altre.type = 'button';
                altre.addEventListener('click', () => {
                    altre.remove();
                    voci.slice(visibili.length).forEach(v => cella.appendChild(chip(v)));
                });
                cella.appendChild(altre);
            }
            griglia.appendChild(cella);
            // L'elenco per il telefono: solo i giorni del mese con qualcosa.
            if (!fuori && voci.length) {
                const riga = el('section', `giorno-agenda${g === oggi ? ' oggi' : ''}`);
                const data = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
                riga.appendChild(el('h3', '', g === oggi ? `Oggi, ${data}` : data));
                voci.forEach(v => riga.appendChild(chip(v)));
                if (g < oggi) { passati.appendChild(riga); quantiPassati++; } else agenda.appendChild(riga);
            }
        }
        if (quantiPassati) {
            titoloPassati.textContent = quantiPassati === 1 ? 'Un giorno già passato' : `${quantiPassati} giorni già passati`;
            agenda.prepend(passati);
        }
        if (!agenda.children.length) agenda.appendChild(el('p', 'nota', 'Niente in calendario questo mese.'));
        else if (agenda.children.length === 1 && quantiPassati) agenda.appendChild(el('p', 'nota', 'Da oggi alla fine del mese non c\'è niente in calendario.'));
        agenda.hidden = false;
    }

    async function caricaDaRispondere() {
        const box = $('da-rispondere');
        try {
            const elenco = await fetchApi('/api/attivita/da-rispondere');
            box.replaceChildren();
            if (!elenco.length) { box.hidden = true; return; }
            box.appendChild(el('strong', '', elenco.length === 1 ? 'Una convocazione aspetta la tua risposta: ' : `${elenco.length} convocazioni aspettano la tua risposta: `));
            elenco.forEach((a, i) => {
                const link = el('a', '', `${a.titolo} (${giornoDi(a.inizio)})`);
                link.href = '#';
                link.addEventListener('click', (e) => { e.preventDefault(); apriAttivita(a.id); });
                if (i) box.append(', ');
                box.appendChild(link);
            });
            box.hidden = false;
        } catch { box.hidden = true; }
    }

    $('mese-prima').addEventListener('click', () => { mese.setMonth(mese.getMonth() - 1); carica(); });
    $('mese-dopo').addEventListener('click', () => { mese.setMonth(mese.getMonth() + 1); carica(); });
    $('mese-oggi').addEventListener('click', () => { mese = new Date(); mese.setDate(1); mese.setHours(12, 0, 0, 0); carica(); });

    // --- La scheda di un'attività --------------------------------------------------------
    function riga(lista, etichetta, valore) {
        if (!valore) return;
        lista.append(el('dt', '', etichetta), el('dd', '', valore));
    }

    async function apriAttivita(id) {
        let a;
        try { a = await fetchApi(`/api/attivita/${id}`); } catch (e) { return notifica(e.message, 'errore'); }
        aperta = a;
        const segni = $('att-segni');
        segni.replaceChildren(el('span', 'pastiglia neutra', a.tipo || 'Attività'));
        if (a.stato === 'annullata') segni.appendChild(el('span', 'pastiglia grave', 'Annullata'));
        if (a.stato === 'conclusa') segni.appendChild(el('span', 'pastiglia ok', 'Conclusa'));
        if (a.corso_nome) segni.appendChild(el('span', 'pastiglia attesa', `Vale come corso: ${a.corso_nome}`));
        if (a.simulazione) segni.appendChild(el('span', 'pastiglia simulazione', a.simulazione === 'sala' ? 'Scenario in sala' : 'Allertamento'));
        $('att-titolo').textContent = a.titolo;
        const dl = $('att-dati');
        dl.replaceChildren();
        riga(dl, 'Quando', quando(a));
        riga(dl, 'Dove', a.luogo);
        riga(dl, 'Responsabile', a.responsabile_nome);
        riga(dl, 'Convocazione', a.convocazione === 'tutti' ? 'Tutti gli interni'
            : a.convocazione === 'scelti' ? (a.gestisce ? `${a.convocati} persone scelte` : 'Persone scelte, fra cui tu')
            : `Aperta: aderisce chi vuole${a.posti ? ` (posti ${a.posti}, liberi ${a.posti_liberi})` : ''}`);
        if (a.stato === 'annullata') riga(dl, 'Motivo', a.motivo_annullamento || 'non indicato');
        riga(dl, 'Scenario', a.scenario);
        riga(dl, 'Obiettivi', a.obiettivi);
        riga(dl, 'Enti', a.enti);
        if (a.simulazione && a.regia?.length) riga(dl, 'Regia', a.regia.map(p => `${p.nome || ''} ${p.cognome || ''}`.trim()).join(', '));
        if (a.sala) riga(dl, 'Sala', `${a.sala.codice}${a.sala.aperta ? ', aperta adesso' : a.sala.interrotta ? ', interrotta da un\'emergenza vera' : ', chiusa'}`);
        $('att-descrizione').textContent = a.descrizione || '';
        $('att-descrizione').hidden = !a.descrizione;
        const allegati = a.allegati || [];
        $('att-allegati').hidden = !allegati.length;
        $('att-allegati-elenco').replaceChildren(...allegati.map(x => rigaAllegato(x.nome_originale, pesoLeggibile(x.dimensione), {
            href: `/api/attivita/${a.id}/allegati/${x.id}`, tipo: x.tipo })));

        // La propria risposta.
        const risposta = $('att-risposta');
        risposta.hidden = !a.puo_rispondere;
        // Chi la conduce non risponde: lo dice, così nessuno si chiede perché.
        $('att-conduci').hidden = !a.conduco || a.stato !== 'programmata';
        $('att-conduci').textContent = a.simulazione && a.sono_regia ? 'Sei nella regia: la convocazione è per i partecipanti, tu non devi rispondere.'
            : 'La conduci tu: la convocazione è per gli altri, tu non devi rispondere. Alla chiusura sei già fra i presenti.';
        if (a.puo_rispondere) {
            const apertaA = a.convocazione === 'aperta';
            $('att-domanda').textContent = apertaA ? 'Partecipi?' : 'Ci sei?';
            $('att-si').textContent = apertaA ? 'Partecipo' : 'Ci sono';
            $('att-no').textContent = apertaA ? 'Non partecipo' : 'Non posso';
            $('att-si').disabled = apertaA && a.posti && a.posti_liberi === 0 && a.mia_risposta !== 'si';
            $('att-risposta-attuale').textContent = a.mia_risposta === 'si' ? 'Hai risposto che ci sei. Puoi cambiare idea fino alla fine.'
                : a.mia_risposta === 'no' ? 'Hai risposto che non puoi.' : 'Non hai ancora risposto.';
            $('att-nota').value = a.mia_nota || '';
        }

        disegnaSimulazione(a);

        // Chi organizza.
        const gestione = $('att-gestione');
        gestione.hidden = !a.gestisce;
        $('form-presenze').hidden = true;
        if (a.gestisce) {
            const cominciata = data(a.inizio) <= new Date();
            $('att-concludi').hidden = !cominciata || a.stato === 'annullata';
            $('att-concludi').textContent = a.stato === 'conclusa' ? 'Correggi i presenti' : 'Chiudi con i presenti';
            $('att-modifica').hidden = a.stato !== 'programmata';
            $('att-annulla').hidden = a.stato !== 'programmata';
            $('att-elimina').hidden = !dati?.organizza || a.presenti > 0;
            disegnaPersone(a);
        }
        $('modale-attivita').hidden = false;
    }

    // I comandi della simulazione: copione, sala, allertamento.
    function disegnaSimulazione(a) {
        const box = $('att-sim-azioni');
        box.replaceChildren();
        const link = (testo, href, classe = 'button-secondary') => { const x = el('a', `button-style ${classe}`, testo); x.href = href; box.appendChild(x); };
        const bottone = (testo, classe, azione) => { const x = el('button', `button-style ${classe}`, testo); x.type = 'button'; x.addEventListener('click', azione); box.appendChild(x); };
        if (a.simulazione === 'sala' && a.regista) {
            link('Copione', `/copione.html?attivita=${a.id}`);
            if (a.sala?.aperta) link('Vai alla sala', '/centro-operativo.html', '');
            else if (a.stato === 'programmata') {
                const inizio = data(a.inizio).getTime(), fine = data(a.fine).getTime(), ora = Date.now();
                if (ora >= inizio - 3 * 3600000 && ora <= fine) bottone('Apri la sala', '', apriSala);
                else box.appendChild(el('span', 'nota', "La sala si apre il giorno dell'attività, da tre ore prima dell'inizio."));
            }
            if (a.sala && !a.sala.aperta) link('Valutazione e debriefing', `/copione.html?attivita=${a.id}#valutazione`);
        } else if (a.simulazione === 'sala' && a.sala && !a.sala.aperta) {
            // Chi ha partecipato: se la regia l'ha pubblicato.
            link('Copione e debriefing', `/copione.html?attivita=${a.id}#valutazione`);
        }
        if (a.simulazione === 'allertamento' && a.regista && a.stato === 'programmata') {
            bottone("Chiamata per l'allertamento", '', () => window.Chiamata?.apriPannello({ attivitaId: a.id }));
        }
        $('att-simulazione').hidden = !box.children.length;
    }

    async function apriSala() {
        if (!confirm(`Aprire la sala per "${aperta.titolo}"?\n\nIl centro operativo si apre come in un'emergenza, con la scritta SIMULAZIONE dappertutto. Le squadre già formate entrano. Se arriva un'emergenza vera, chi apre le emergenze la apre e la simulazione si ferma.`)) return;
        try {
            await fetchApi(`/api/attivita/${aperta.id}/apri-sala`, { method: 'POST', body: '{}' });
            notifica('Sala aperta: la simulazione è cominciata.', 'successo');
            location.href = '/centro-operativo.html';
        } catch (e) { notifica(e.message, 'errore'); }
    }

    function disegnaPersone(a) {
        const lista = $('att-persone');
        lista.replaceChildren();
        const persone = a.persone || [];
        const attesa = persone.filter(p => !p.risposta).length;
        const irraggiungibili = persone.filter(p => !p.risposta && !p.raggiungibile).length;
        $('att-titolo-persone').textContent = a.stato === 'conclusa' ? `Presenti: ${a.presenti}` : (a.convocazione === 'aperta' ? 'Adesioni' : 'Convocati');
        $('att-conteggi').textContent = a.stato !== 'programmata' ? `Avevano risposto: ${a.si} sì, ${a.no} no.` : a.convocazione === 'aperta'
            ? `${a.si} aderiscono, ${a.no} non partecipano.`
            : `${a.si} ci sono, ${a.no} non possono, ${attesa} non hanno risposto${irraggiungibili ? `; ${irraggiungibili} non si raggiungono né con l'app né per email: vanno chiamati` : ''}.`;
        const presenti = new Map((a.presenze || []).map(p => [p.user_id, p]));
        for (const p of persone) {
            const li = el('li', `persona risposta-${p.risposta || 'attesa'}`);
            li.appendChild(el('span', 'nome-persona', `${p.cognome || ''} ${p.nome || ''}`.trim()));
            const stato = p.risposta === 'si' ? 'Ci sono' : p.risposta === 'no' ? 'Non posso' : 'Nessuna risposta';
            li.appendChild(el('span', `pastiglia ${p.risposta === 'si' ? 'ok' : p.risposta === 'no' ? 'grave' : 'neutra'}`, stato));
            if (!p.risposta && !p.raggiungibile && a.stato === 'programmata') li.appendChild(el('span', 'pastiglia attesa', 'Da chiamare'));
            if (presenti.has(p.id)) li.appendChild(el('span', 'pastiglia ok', `Presente ${ore(presenti.get(p.id).minuti)}`));
            if (p.nota) li.appendChild(el('span', 'nota-persona', `"${p.nota}"`));
            lista.appendChild(li);
        }
        if (!persone.length) lista.appendChild(el('li', 'nota', a.convocazione === 'aperta' ? 'Ancora nessuna adesione.' : 'Nessuno.'));
    }

    async function rispondi(valore) {
        try {
            await fetchApi(`/api/attivita/${aperta.id}/risposta`, { method: 'POST', body: JSON.stringify({ risposta: valore, nota: $('att-nota').value.trim() }) });
            notifica(valore === 'si' ? 'Risposta mandata: ci sei.' : 'Risposta mandata: non puoi.', 'successo');
            await apriAttivita(aperta.id);
            carica();
            caricaDaRispondere();
        } catch (e) { notifica(e.message, 'errore'); }
    }
    $('att-si').addEventListener('click', () => rispondi('si'));
    $('att-no').addEventListener('click', () => rispondi('no'));

    $('att-annulla').addEventListener('click', async () => {
        const motivo = prompt(`Annullare "${aperta.titolo}"? Chi è convocato riceve l'avviso. Il motivo (facoltativo):`, '');
        if (motivo === null) return;
        try {
            await fetchApi(`/api/attivita/${aperta.id}/annulla`, { method: 'POST', body: JSON.stringify({ motivo }) });
            notifica('Attività annullata: i convocati sono avvisati.', 'successo');
            await apriAttivita(aperta.id);
            carica();
        } catch (e) { notifica(e.message, 'errore'); }
    });

    $('att-elimina').addEventListener('click', async () => {
        if (!confirm(`Eliminare "${aperta.titolo}"? Sparisce anche dal calendario di chi era convocato.`)) return;
        try {
            await fetchApi(`/api/attivita/${aperta.id}`, { method: 'DELETE' });
            chiudi($('modale-attivita'));
            notifica('Attività eliminata.', 'successo');
            carica();
        } catch (e) { notifica(e.message, 'errore'); }
    });

    // --- I presenti ---------------------------------------------------------------------------
    async function personeInterne() {
        if (!persone) persone = await fetchApi('/api/attivita-persone');
        return persone;
    }

    $('att-concludi').addEventListener('click', async () => {
        const a = aperta;
        let tutti;
        try { tutti = await personeInterne(); } catch (e) { return notifica(e.message, 'errore'); }
        const gia = new Map((a.presenze || []).map(p => [p.user_id, p]));
        const risposte = new Map((a.persone || []).map(p => [p.id, p.risposta]));
        // Chi l'ha condotta (chi l'ha proposta, il responsabile, la regia) c'era: già spuntato.
        const conduttori = new Set([a.creato_da, a.responsabile_id, ...(a.regia || []).map(p => p.id)].filter(Boolean));
        const lista = $('elenco-presenti');
        lista.replaceChildren();
        // Prima chi aveva detto di sì o era già presente, poi gli altri.
        const ordinati = [...tutti].sort((x, y) => {
            const px = gia.has(x.id) || risposte.get(x.id) === 'si' ? 0 : 1;
            const py = gia.has(y.id) || risposte.get(y.id) === 'si' ? 0 : 1;
            return px - py || `${x.cognome} ${x.nome}`.localeCompare(`${y.cognome} ${y.nome}`);
        });
        for (const p of ordinati) {
            const li = el('li', 'riga-presente');
            li.dataset.nome = `${p.nome} ${p.cognome}`.toLowerCase();
            const presente = gia.get(p.id);
            const scelto = a.stato === 'conclusa' ? !!presente : risposte.get(p.id) === 'si' || conduttori.has(p.id);
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.value = p.id;
            check.checked = scelto;
            check.setAttribute('aria-label', `${p.nome} ${p.cognome} presente`);
            const nome = el('label', 'nome-presente');
            nome.append(check, ` ${p.cognome} ${p.nome}`);
            if (risposte.get(p.id) === 'si') nome.appendChild(el('span', 'nota', ' (aveva detto sì)'));
            const inizio = document.createElement('input');
            inizio.type = 'datetime-local';
            inizio.value = perInput(presente?.inizio || a.inizio);
            inizio.className = 'orario-presente';
            inizio.setAttribute('aria-label', 'Arrivo');
            const fine = document.createElement('input');
            fine.type = 'datetime-local';
            fine.value = perInput(presente?.fine || a.fine);
            fine.className = 'orario-presente';
            fine.setAttribute('aria-label', 'Uscita');
            li.append(nome, inizio, fine);
            lista.appendChild(li);
        }
        $('presenze-corso').textContent = a.corso_nome ? `, e il corso "${a.corso_nome}" nel libretto dei presenti` : '';
        $('cerca-presenti').value = '';
        $('form-presenze').hidden = false;
        $('form-presenze').scrollIntoView({ behavior: 'smooth' });
    });

    $('cerca-presenti').addEventListener('input', () => {
        const q = $('cerca-presenti').value.trim().toLowerCase();
        document.querySelectorAll('#elenco-presenti .riga-presente').forEach(li => { li.hidden = q && !li.dataset.nome.includes(q); });
    });
    $('annulla-presenze').addEventListener('click', () => { $('form-presenze').hidden = true; });

    $('form-presenze').addEventListener('submit', async (e) => {
        e.preventDefault();
        const presenze = [...document.querySelectorAll('#elenco-presenti .riga-presente')]
            .filter(li => li.querySelector('input[type=checkbox]').checked)
            .map(li => {
                const [inizio, fine] = li.querySelectorAll('.orario-presente');
                return { user_id: Number(li.querySelector('input[type=checkbox]').value), inizio: daInput(inizio.value), fine: daInput(fine.value) };
            });
        try {
            const esito = await fetchApi(`/api/attivita/${aperta.id}/concludi`, { method: 'POST', body: JSON.stringify({ presenze }) });
            notifica(`Presenze salvate: ${esito.presenti}${esito.corsi ? `, ${esito.corsi} corsi nei libretti` : ''}.`, 'successo');
            await apriAttivita(aperta.id);
            carica();
        } catch (err) { notifica(err.message, 'errore'); }
    });

    // --- Creare e cambiare ---------------------------------------------------------------------
    function convocazioneScelta() { return document.querySelector('input[name="convocazione"]:checked').value; }
    function aggiornaConvocazione() {
        const c = convocazioneScelta();
        $('campo-posti').hidden = c !== 'aperta';
        $('scelta-persone').hidden = c !== 'scelti';
    }
    document.querySelectorAll('input[name="convocazione"]').forEach(r => r.addEventListener('change', aggiornaConvocazione));

    let scelti = new Set();
    function disegnaScelta() {
        const q = $('cerca-persone').value.trim().toLowerCase();
        const lista = $('elenco-scelta');
        lista.replaceChildren();
        for (const p of persone || []) {
            if (q && !`${p.nome} ${p.cognome}`.toLowerCase().includes(q)) continue;
            const li = el('li');
            const l = el('label', 'scelta');
            const c = document.createElement('input');
            c.type = 'checkbox';
            c.checked = scelti.has(p.id);
            c.addEventListener('change', () => { c.checked ? scelti.add(p.id) : scelti.delete(p.id); contaScelti(); });
            l.append(c, ` ${p.cognome} ${p.nome}`);
            li.appendChild(l);
            lista.appendChild(li);
        }
        contaScelti();
    }
    function contaScelti() { $('conta-scelti').textContent = scelti.size === 1 ? '1 persona scelta' : `${scelti.size} persone scelte`; }
    $('cerca-persone').addEventListener('input', disegnaScelta);

    // L'orario dell'ultima attività creata da questo browser: chi fa sempre le
    // riunioni alle 21 non deve correggerlo ogni volta. La prima volta, sera.
    const CHIAVE_ORARIO = 'orion.attivita.orario';
    function orarioProposto() {
        try {
            const o = JSON.parse(localStorage.getItem(CHIAVE_ORARIO));
            if (/^\d{2}:\d{2}$/.test(o?.ora) && o.minuti > 0 && o.minuti <= 24 * 60 * 7) return o;
        } catch { /* niente di salvato */ }
        return { ora: '20:30', minuti: 120 };
    }
    function ricordaOrario(inizio, fine) {
        const i = new Date(inizio), f = new Date(fine);
        if (Number.isNaN(i.getTime()) || !(f > i)) return;
        try { localStorage.setItem(CHIAVE_ORARIO, JSON.stringify({ ora: `${String(i.getHours()).padStart(2, '0')}:${String(i.getMinutes()).padStart(2, '0')}`, minuti: Math.round((f - i) / 60000) })); } catch { /* pazienza */ }
    }

    async function apriForm(a = null, giorno = null, scenario = null) {
        inModifica = a;
        daScenario = a ? null : scenario;
        try {
            [tipi, corsi] = await Promise.all([fetchApi('/api/attivita/tipi'), corsi ? corsi : fetchApi('/api/attivita/corsi').catch(() => [])]);
            await personeInterne();
        } catch (e) { return notifica(e.message, 'errore'); }
        $('form-attivita').reset();
        $('form-titolo').textContent = a ? "Modifica l'attività" : 'Nuova attività';
        $('salva-attivita').textContent = a ? 'Salva' : 'Crea e convoca';
        const tipo = $('f-tipo');
        tipo.replaceChildren(...tipi.filter(t => t.attivo || t.id === a?.tipo_id).map(t => new Option(t.nome, t.id)));
        tipo.value = a?.tipo_id ?? tipi[0]?.id ?? '';
        const resp = $('f-responsabile');
        resp.replaceChildren(new Option('(nessuno)', ''), ...persone.map(p => new Option(`${p.cognome} ${p.nome}`, p.id)));
        resp.value = a?.responsabile_id ?? '';
        const corso = $('f-corso');
        corso.replaceChildren(new Option('(no)', ''), ...corsi.map(c => new Option(c.nome, c.id)));
        corso.value = a?.corso_id ?? '';
        $('f-titolo').value = a?.titolo || '';
        $('f-luogo').value = a?.luogo || '';
        $('f-descrizione').value = a?.descrizione || '';
        if (a) {
            $('f-inizio').value = perInput(a.inizio);
            $('f-fine').value = perInput(a.fine);
        } else {
            // Di partenza il giorno toccato (o domani), all'orario dell'ultima volta.
            const { ora, minuti } = orarioProposto();
            const d = giorno ? new Date(giorno) : new Date();
            if (!giorno) d.setDate(d.getDate() + 1);
            const [h, m] = ora.split(':').map(Number);
            d.setHours(h, m, 0, 0);
            $('f-inizio').value = perInput(d);
            $('f-fine').value = perInput(new Date(d.getTime() + minuti * 60000));
        }
        document.querySelector(`input[name="convocazione"][value="${a?.convocazione || 'tutti'}"]`).checked = true;
        $('f-posti').value = a?.posti || '';
        $('f-app').checked = a ? a.avviso_app : true;
        $('f-email').checked = a ? a.avviso_email : false;
        $('campo-avvisa').hidden = !a;
        scelti = new Set((a?.persone || []).filter(p => p.convocato).map(p => p.id));
        $('cerca-persone').value = '';
        disegnaScelta();
        aggiornaConvocazione();
        document.querySelector(`input[name="simulazione"][value="${a?.simulazione || ''}"]`).checked = true;
        $('f-scenario').value = a?.scenario || '';
        $('f-obiettivi').value = a?.obiettivi || '';
        $('f-enti').value = a?.enti || '';
        regiaScelta = new Set((a?.regia || []).map(p => p.id));
        disegnaRegia();
        aggiornaSimulazione();
        allegatiNuovi = [];
        allegatiEsistenti = a?.allegati ? [...a.allegati] : [];
        disegnaAllegatiForm();
        if (daScenario) riempiDaScenario(daScenario);
        $('form-scenario').hidden = !daScenario;
        $('gestisci-tipi').hidden = !dati?.organizza;
        $('modale-form').hidden = false;
        $('f-titolo').focus();
    }

    // Gli allegati: quelli già caricati (in modifica) si tolgono subito, quelli
    // nuovi partono dopo il salvataggio dell'attività.
    let allegatiNuovi = [];
    let allegatiEsistenti = [];
    const MB_ALLEGATO = 25;
    const pesoLeggibile = (b) => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
    const iconaFile = (nome, tipo) => /pdf$/i.test(tipo || nome) ? 'fa-file-pdf' : /^image\//.test(tipo || '') || /\.(jpe?g|png|webp)$/i.test(nome) ? 'fa-file-image'
        : /\.(xlsx?|ods)$/i.test(nome) ? 'fa-file-excel' : /\.(docx?|odt)$/i.test(nome) ? 'fa-file-word' : 'fa-file';
    function rigaAllegato(nome, dettaglio, { href, tipo, togli, inAttesa } = {}) {
        const li = el('li', inAttesa ? 'in-attesa' : '');
        const icona = document.createElement('i');
        icona.className = `fas ${iconaFile(nome, tipo)}`;
        icona.setAttribute('aria-hidden', 'true');
        li.appendChild(icona);
        if (href) {
            const a = el('a', 'nome-allegato', nome);
            a.href = href; a.target = '_blank'; a.rel = 'noopener';
            li.appendChild(a);
        } else li.appendChild(el('span', 'nome-allegato', nome));
        if (dettaglio) li.appendChild(el('small', '', dettaglio));
        if (togli) {
            const b = el('button', 'button-style button-secondary button-small', 'Togli');
            b.type = 'button';
            b.addEventListener('click', togli);
            li.appendChild(b);
        }
        return li;
    }
    function disegnaAllegatiForm() {
        const ul = $('f-allegati');
        ul.replaceChildren(
            ...allegatiEsistenti.map(x => rigaAllegato(x.nome_originale, pesoLeggibile(x.dimensione), {
                href: `/api/attivita/${inModifica.id}/allegati/${x.id}`, tipo: x.tipo,
                togli: async () => {
                    try {
                        await fetchApi(`/api/attivita/${inModifica.id}/allegati/${x.id}`, { method: 'DELETE' });
                        allegatiEsistenti = allegatiEsistenti.filter(y => y.id !== x.id);
                        disegnaAllegatiForm();
                    } catch (e) { notifica(e.message, 'errore'); }
                }
            })),
            ...allegatiNuovi.map((f, i) => rigaAllegato(f.name, `${pesoLeggibile(f.size)}, si carica al salvataggio`, {
                inAttesa: true, togli: () => { allegatiNuovi.splice(i, 1); disegnaAllegatiForm(); }
            }))
        );
    }
    $('f-file').addEventListener('change', () => {
        for (const f of $('f-file').files) {
            if (f.size > MB_ALLEGATO * 1024 * 1024) { notifica(`"${f.name}" supera i ${MB_ALLEGATO} MB.`, 'attenzione'); continue; }
            allegatiNuovi.push(f);
        }
        $('f-file').value = '';
        disegnaAllegatiForm();
    });
    // Dopo il salvataggio: uno per volta; quello che non passa si dice e non ferma gli altri.
    async function caricaAllegati(id) {
        const falliti = [];
        for (const f of allegatiNuovi) {
            const fd = new FormData();
            fd.append('file', f);
            try { await fetchApi(`/api/attivita/${id}/allegati`, { method: 'POST', body: fd }); }
            catch (e) { falliti.push(`${f.name}: ${e.message}`); }
        }
        allegatiNuovi = [];
        if (falliti.length) notifica(`Non allegati:\n${falliti.join('\n')}`, 'errore', 12000);
    }

    // Pianificare uno scenario della biblioteca (/calendario.html?scenario=N,
    // dalla pagina Simulazioni): tipo, titolo, testi e durata vengono dallo
    // scenario, la simulazione è in sala; il copione lo copia il server.
    function riempiDaScenario(sc) {
        const tipo = tipi.find(t => t.attivo && t.natura === sc.natura && t.nome.toLowerCase() === sc.natura)
            || tipi.find(t => t.attivo && t.natura === sc.natura);
        if (tipo) $('f-tipo').value = tipo.id;
        $('f-titolo').value = sc.titolo;
        const inizio = new Date(daInput($('f-inizio').value));
        $('f-fine').value = perInput(new Date(inizio.getTime() + sc.durata_ore * 3600000));
        document.querySelector('input[name="simulazione"][value="sala"]').checked = true;
        $('f-scenario').value = sc.scenario || '';
        $('f-obiettivi').value = sc.obiettivi || '';
        $('f-enti').value = sc.enti || '';
        $('form-scenario').textContent = `Dallo scenario "${sc.titolo}": il suo copione (${sc.eventi === 1 ? '1 evento' : `${sc.eventi} eventi`}) si copia nell'attività, e la regia lo può ritoccare senza cambiare lo scenario.`;
        aggiornaSimulazione();
    }

    // La simulazione si sceglie solo per addestramenti ed esercitazioni.
    let regiaScelta = new Set();
    const naturaScelta = () => tipi.find(t => String(t.id) === $('f-tipo').value)?.natura || 'generica';
    function aggiornaSimulazione() {
        const natura = naturaScelta();
        const puo = natura === 'addestramento' || natura === 'esercitazione';
        $('campo-simulazione').hidden = !puo;
        if (!puo) document.querySelector('input[name="simulazione"][value=""]').checked = true;
        const sim = document.querySelector('input[name="simulazione"]:checked')?.value || '';
        $('dettagli-simulazione').hidden = !sim;
        // Gli enti sono delle esercitazioni vere e proprie.
        $('campo-enti').hidden = natura !== 'esercitazione';
    }
    $('f-tipo').addEventListener('change', aggiornaSimulazione);
    document.querySelectorAll('input[name="simulazione"]').forEach(r => r.addEventListener('change', aggiornaSimulazione));
    // La regia: si aggiunge una persona alla volta dall'elenco a discesa, si toglie con la x.
    function disegnaRegia() {
        const sel = $('aggiungi-regia');
        const restanti = (persone || []).filter(p => !regiaScelta.has(p.id));
        sel.replaceChildren(new Option(restanti.length ? 'Aggiungi una persona alla regia…' : 'Tutti sono già nella regia', ''),
            ...restanti.map(p => new Option(`${p.cognome} ${p.nome}`, p.id)));
        sel.disabled = !restanti.length;
        const lista = $('elenco-regia');
        lista.replaceChildren();
        for (const p of (persone || []).filter(x => regiaScelta.has(x.id))) {
            const li = el('li', '', `${p.cognome} ${p.nome}`);
            const x = el('button', 'btn-icona', '');
            x.type = 'button';
            x.title = `Togli ${p.nome} ${p.cognome} dalla regia`;
            x.setAttribute('aria-label', x.title);
            x.appendChild(el('i', 'fas fa-xmark'));
            x.addEventListener('click', () => { regiaScelta.delete(p.id); disegnaRegia(); });
            li.appendChild(x);
            lista.appendChild(li);
        }
        if (!regiaScelta.size) lista.appendChild(el('li', 'vuota', 'Nessuno oltre al responsabile.'));
    }
    $('aggiungi-regia').addEventListener('change', (e) => {
        const id = Number(e.target.value);
        if (id) { regiaScelta.add(id); disegnaRegia(); }
    });

    // I tipi di attività e la loro natura.
    const NATURE = { generica: 'Generica', addestramento: 'Addestramento', esercitazione: 'Esercitazione' };
    async function disegnaTipi() {
        try { tipi = await fetchApi('/api/attivita/tipi'); } catch (e) { return notifica(e.message, 'errore'); }
        const corpo = $('tipi-corpo');
        corpo.replaceChildren();
        for (const t of tipi) {
            const tr = el('tr');
            const nome = el('input'); nome.type = 'text'; nome.value = t.nome; nome.maxLength = 60;
            const natura = el('select');
            for (const [k, v] of Object.entries(NATURE)) natura.appendChild(new Option(v, k));
            natura.value = t.natura;
            const attivo = el('input'); attivo.type = 'checkbox'; attivo.checked = t.attivo;
            const salva = el('button', 'button-style button-secondary btn-piccolo', 'Salva'); salva.type = 'button';
            salva.addEventListener('click', async () => {
                try {
                    await fetchApi(`/api/attivita/tipi/${t.id}`, { method: 'PUT', body: JSON.stringify({ nome: nome.value, natura: natura.value, attivo: attivo.checked }) });
                    notifica('Tipo salvato.', 'successo');
                    disegnaTipi();
                } catch (e) { notifica(e.message, 'errore'); }
            });
            for (const x of [nome, natura, attivo, salva]) { const td = el('td'); td.appendChild(x); tr.appendChild(td); }
            corpo.appendChild(tr);
        }
    }
    $('gestisci-tipi').addEventListener('click', () => { disegnaTipi(); $('modale-tipi').hidden = false; });
    $('form-tipo').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await fetchApi('/api/attivita/tipi', { method: 'POST', body: JSON.stringify({ nome: $('nuovo-tipo-nome').value, natura: $('nuovo-tipo-natura').value }) });
            $('nuovo-tipo-nome').value = '';
            disegnaTipi();
        } catch (err) { notifica(err.message, 'errore'); }
    });
    // Chiusa la finestra dei tipi, il modulo si aggiorna con i nomi nuovi.
    $('modale-tipi').addEventListener('click', (e) => {
        if (!(e.target === $('modale-tipi') || e.target.closest('[data-chiudi]'))) return;
        const scelto = $('f-tipo').value;
        $('f-tipo').replaceChildren(...tipi.filter(t => t.attivo).map(t => new Option(t.nome, t.id)));
        $('f-tipo').value = scelto;
        aggiornaSimulazione();
    });

    $('btn-nuova').addEventListener('click', () => apriForm());
    $('att-modifica').addEventListener('click', () => { chiudi($('modale-attivita')); apriForm(aperta); });

    // Spostando l'inizio, la fine si sposta con lui e la durata resta quella.
    let inizioPrima = null;
    $('f-inizio').addEventListener('focus', () => { inizioPrima = $('f-inizio').value; });
    $('f-inizio').addEventListener('change', () => {
        const ini = new Date($('f-inizio').value);
        if (Number.isNaN(ini.getTime())) return;
        const vecchio = new Date(inizioPrima || $('f-inizio').value), fine = new Date($('f-fine').value);
        const durata = !Number.isNaN(fine.getTime()) && !Number.isNaN(vecchio.getTime()) && fine > vecchio ? fine - vecchio : 2 * 3600000;
        $('f-fine').value = perInput(new Date(ini.getTime() + durata));
        inizioPrima = $('f-inizio').value;
    });

    $('form-attivita').addEventListener('submit', async (e) => {
        e.preventDefault();
        const convocazione = convocazioneScelta();
        if (convocazione === 'scelti' && !scelti.size) return notifica('Scegli chi convocare.', 'attenzione');
        const corpo = {
            tipo_id: $('f-tipo').value || null,
            titolo: $('f-titolo').value.trim(),
            luogo: $('f-luogo').value.trim(),
            descrizione: $('f-descrizione').value.trim(),
            inizio: daInput($('f-inizio').value),
            fine: daInput($('f-fine').value),
            convocazione,
            posti: convocazione === 'aperta' ? ($('f-posti').value || null) : null,
            persone: [...scelti],
            avviso_app: $('f-app').checked,
            avviso_email: $('f-email').checked,
            responsabile_id: $('f-responsabile').value || null,
            corso_id: $('f-corso').value || null,
            avvisa: !!inModifica && $('f-avvisa').checked,
            simulazione: document.querySelector('input[name="simulazione"]:checked')?.value || null,
            scenario: $('f-scenario').value.trim(),
            obiettivi: $('f-obiettivi').value.trim(),
            enti: $('f-enti').value.trim(),
            regia: [...regiaScelta],
            scenario_id: daScenario?.id ?? null
        };
        const pulsante = $('salva-attivita');
        pulsante.disabled = true;
        try {
            const a = inModifica
                ? await fetchApi(`/api/attivita/${inModifica.id}`, { method: 'PUT', body: JSON.stringify(corpo) })
                : await fetchApi('/api/attivita', { method: 'POST', body: JSON.stringify(corpo) });
            if (!inModifica) ricordaOrario(corpo.inizio, corpo.fine);
            if (allegatiNuovi.length) {
                pulsante.textContent = 'Carico gli allegati…';
                await caricaAllegati(a.id);
            }
            chiudi($('modale-form'));
            notifica(inModifica ? 'Attività salvata.' : (corpo.avviso_app || corpo.avviso_email ? 'Attività creata: le convocazioni partono.' : 'Attività creata.'), 'successo');
            const g = data(a.inizio);
            mese = new Date(g.getFullYear(), g.getMonth(), 1, 12);
            await carica();
            apriAttivita(a.id);
        } catch (err) {
            notifica(err.message, 'errore');
        } finally {
            pulsante.disabled = false;
        }
    });

    // --- Scadenze ed emergenze ----------------------------------------------------------------
    function apriScadenze(s) {
        const nomi = { mie: 'Le tue scadenze', segreteria: 'Scadenze di visite e corsi', magazzino: 'Scadenze del magazzino' };
        $('info-titolo').textContent = `${nomi[s.categoria]} del ${new Date(`${s.giorno}T12:00:00`).toLocaleDateString('it-IT')}`;
        const ul = el('ul', 'elenco-semplice');
        for (const v of s.voci) ul.appendChild(el('li', '', v.chi ? `${v.chi}: ${v.titolo}` : v.titolo));
        const corpo = $('info-corpo');
        corpo.replaceChildren(ul);
        const link = { segreteria: ['/admin-segreteria.html', 'Apri la segreteria'], magazzino: ['/magazzino.html?scheda=scadenze', 'Apri le scadenze del magazzino'], mie: ['/profile.html', 'Apri il tuo profilo'] }[s.categoria];
        const a = el('a', 'button-style button-secondary btn-piccolo', link[1]);
        a.href = link[0];
        corpo.appendChild(a);
        $('modale-info').hidden = false;
    }

    // Reperibili o assenti di un giorno; chi organizza toglie i turni, ognuno le sue assenze.
    function apriTurni(t) {
        $('info-titolo').textContent = `${t.categoria === 'reperibili' ? 'Reperibili' : 'Assenti'} il ${new Date(`${t.giorno}T12:00:00`).toLocaleDateString('it-IT')}`;
        const ul = el('ul', 'elenco-semplice');
        for (const v of t.voci) {
            const li = el('li', '', `${v.chi || 'Senza nome'}${v.nota ? ` (${v.nota})` : ''}`);
            const puoTogliere = t.categoria === 'reperibili' ? dati.organizza : (v.mio || dati.organizza);
            if (puoTogliere) {
                const x = el('button', 'btn-icona', '');
                x.type = 'button';
                x.title = t.categoria === 'reperibili' ? 'Togli tutto il turno' : "Togli tutta l'assenza";
                x.innerHTML = '<i class="fas fa-trash"></i>';
                x.addEventListener('click', async () => {
                    try {
                        await fetchApi(t.categoria === 'reperibili' ? `/api/reperibilita/${v.id}` : `/api/assenze/${v.id}`, { method: 'DELETE' });
                        chiudi($('modale-info'));
                        notifica('Tolto.', 'successo');
                        carica();
                    } catch (err) { notifica(err.message, 'errore'); }
                });
                li.append(' ', x);
            }
            ul.appendChild(li);
        }
        $('info-corpo').replaceChildren(ul);
        $('modale-info').hidden = false;
    }

    // --- Assenze e turni ------------------------------------------------------------------
    async function disegnaMieAssenze() {
        const ul = $('as-elenco');
        ul.replaceChildren();
        let mie = [];
        try { mie = await fetchApi('/api/assenze/mie'); } catch { /* niente */ }
        if (!mie.length) ul.appendChild(el('li', 'nota', 'Nessuna assenza in programma.'));
        for (const a of mie) {
            const li = el('li', '', `Dal ${new Date(`${a.dal}T12:00:00`).toLocaleDateString('it-IT')} al ${new Date(`${a.al}T12:00:00`).toLocaleDateString('it-IT')}${a.nota ? ` (${a.nota})` : ''} `);
            const x = el('button', 'btn-icona', '');
            x.type = 'button'; x.title = 'Togli'; x.innerHTML = '<i class="fas fa-trash"></i>';
            x.addEventListener('click', async () => {
                try { await fetchApi(`/api/assenze/${a.id}`, { method: 'DELETE' }); disegnaMieAssenze(); carica(); } catch (err) { notifica(err.message, 'errore'); }
            });
            li.appendChild(x);
            ul.appendChild(li);
        }
    }
    $('btn-assenza').addEventListener('click', () => {
        const oggi = chiaveGiorno(new Date());
        $('as-dal').value = oggi; $('as-al').value = oggi; $('as-nota').value = '';
        disegnaMieAssenze();
        $('modale-assenza').hidden = false;
    });
    $('form-assenza').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await fetchApi('/api/assenze', { method: 'POST', body: JSON.stringify({ dal: $('as-dal').value, al: $('as-al').value, nota: $('as-nota').value }) });
            notifica('Assenza segnata.', 'successo');
            $('as-nota').value = '';
            disegnaMieAssenze();
            carica();
        } catch (err) { notifica(err.message, 'errore'); }
    });

    const turnoScelti = new Set();
    function disegnaTurno() {
        const q = $('tu-cerca').value.trim().toLowerCase();
        const lista = $('tu-elenco');
        lista.replaceChildren();
        for (const p of persone || []) {
            if (q && !`${p.nome} ${p.cognome}`.toLowerCase().includes(q)) continue;
            const li = el('li');
            const l = el('label', 'scelta');
            const c = document.createElement('input');
            c.type = 'checkbox';
            c.checked = turnoScelti.has(p.id);
            c.addEventListener('change', () => { c.checked ? turnoScelti.add(p.id) : turnoScelti.delete(p.id); contaTurno(); });
            l.append(c, ` ${p.cognome} ${p.nome}`);
            li.appendChild(l);
            lista.appendChild(li);
        }
        contaTurno();
    }
    function contaTurno() { $('tu-conta').textContent = turnoScelti.size === 1 ? '1 persona scelta' : `${turnoScelti.size} persone scelte`; }
    $('tu-cerca').addEventListener('input', disegnaTurno);
    $('btn-turno').addEventListener('click', async () => {
        try { if (!persone) persone = await fetchApi('/api/attivita-persone'); } catch (err) { return notifica(err.message, 'errore'); }
        // Di partenza la settimana da lunedì.
        const lun = new Date(); lun.setDate(lun.getDate() - ((lun.getDay() + 6) % 7));
        const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
        $('tu-dal').value = chiaveGiorno(lun); $('tu-al').value = chiaveGiorno(dom); $('tu-nota').value = '';
        turnoScelti.clear();
        $('tu-cerca').value = '';
        disegnaTurno();
        $('modale-turno').hidden = false;
    });
    $('form-turno').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const r = await fetchApi('/api/reperibilita', { method: 'POST', body: JSON.stringify({ dal: $('tu-dal').value, al: $('tu-al').value, nota: $('tu-nota').value, persone: [...turnoScelti] }) });
            notifica(r.aggiunti === 1 ? 'Una persona di turno.' : `${r.aggiunti} persone di turno.`, 'successo');
            chiudi($('modale-turno'));
            carica();
        } catch (err) { notifica(err.message, 'errore'); }
    });

    async function apriEmergenza(e) {
        $('info-titolo').textContent = `${e.simulazione ? 'Simulazione' : 'Emergenza'} ${e.code}${e.name ? ` - ${e.name}` : ''}`;
        const corpo = $('info-corpo');
        corpo.replaceChildren(el('p', '', `Dal ${data(e.inizio).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}${e.fine ? ` al ${data(e.fine).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}` : ', ancora aperta'}.`));
        if (dati.organizza && e.status === 'CLOSED') await disegnaPresenzeEmergenza(e, corpo);
        else if (e.status !== 'CLOSED') corpo.appendChild(el('p', 'nota', "Le presenze si scrivono alla chiusura, dal registro delle squadre (sala COC compresa)."));
        if (e.simulazione) {
            corpo.appendChild(el('p', 'nota', `Le presenze di una simulazione vanno all'attività del calendario${e.interrotta_il ? '. Interrotta da un\'emergenza vera.' : '.'}`));
            if (e.attivita_id) {
                const b = el('button', 'button-style button-secondary btn-piccolo', "Apri l'attività");
                b.type = 'button';
                b.addEventListener('click', () => { chiudi($('modale-info')); apriAttivita(e.attivita_id); });
                corpo.appendChild(b);
            }
        }
        $('modale-info').hidden = false;
    }

    async function disegnaPresenzeEmergenza(e, corpo) {
        let elenco;
        try { elenco = await fetchApi(`/api/emergencies/${e.id}/presenze`); } catch (err) { return corpo.appendChild(el('p', 'nota', err.message)); }
        corpo.appendChild(el('h3', '', `Presenze (${elenco.length})`));
        corpo.appendChild(el('p', 'nota', 'Calcolate dal registro delle squadre. Si correggono qui: chi è uscito per qualche ora, chi era in sala senza essere in una squadra.'));
        const tabella = el('div', 'tabella-presenze');
        for (const p of elenco) tabella.appendChild(rigaPresenza(p, () => apriEmergenza(e)));
        corpo.appendChild(tabella);
        // Aggiungere chi manca.
        let tutti = [];
        try { tutti = await personeInterne(); } catch { /* senza elenco niente aggiunta */ }
        const mancanti = tutti.filter(p => !elenco.some(x => x.user_id === p.id));
        if (!mancanti.length) return;
        const form = el('form', 'aggiungi-presenza');
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', 'Chi aggiungere');
        sel.replaceChildren(...mancanti.map(p => new Option(`${p.cognome} ${p.nome}`, p.id)));
        const ini = document.createElement('input'); ini.type = 'datetime-local'; ini.value = perInput(e.inizio); ini.setAttribute('aria-label', 'Arrivo');
        const fin = document.createElement('input'); fin.type = 'datetime-local'; fin.value = perInput(e.fine || new Date()); fin.setAttribute('aria-label', 'Uscita');
        const b = el('button', 'button-style btn-piccolo', 'Aggiungi');
        b.type = 'submit';
        form.append(el('strong', '', 'Aggiungi chi c\'era: '), sel, ini, fin, b);
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try {
                await fetchApi(`/api/emergencies/${e.id}/presenze`, { method: 'POST', body: JSON.stringify({ user_id: Number(sel.value), inizio: daInput(ini.value), fine: daInput(fin.value) }) });
                notifica('Presenza aggiunta.', 'successo');
                apriEmergenza(e);
            } catch (err) { notifica(err.message, 'errore'); }
        });
        corpo.appendChild(form);
    }

    // Una presenza con i suoi orari e le ore, correggibili da chi organizza.
    function rigaPresenza(p, dopo) {
        const r = el('form', 'riga-presenza');
        r.appendChild(el('span', 'nome-persona', `${p.cognome || ''} ${p.nome || ''}`.trim() || p.titolo));
        const ini = document.createElement('input'); ini.type = 'datetime-local'; ini.value = perInput(p.inizio); ini.setAttribute('aria-label', 'Inizio');
        const fin = document.createElement('input'); fin.type = 'datetime-local'; fin.value = perInput(p.fine); fin.setAttribute('aria-label', 'Fine');
        const h = document.createElement('input'); h.type = 'number'; h.min = '0'; h.step = '0.25'; h.value = (p.minuti / 60).toFixed(2).replace(/\.00$/, ''); h.className = 'ore-presenza';
        h.setAttribute('aria-label', 'Ore');
        const nota = document.createElement('input'); nota.type = 'text'; nota.maxLength = 300; nota.placeholder = 'nota'; nota.value = p.nota || '';
        const salva = el('button', 'button-style button-secondary btn-piccolo', 'Salva'); salva.type = 'submit';
        const togli = el('button', 'btn-icona', ''); togli.type = 'button'; togli.title = 'Togli'; togli.innerHTML = '<i class="fas fa-trash"></i>';
        togli.setAttribute('aria-label', 'Togli la presenza');
        r.append(ini, fin, h, el('span', 'nota', 'h'), nota, salva, togli);
        if (p.dettaglio) r.appendChild(el('span', 'nota dettaglio-presenza', p.dettaglio + (p.corretta_da ? ` · corretta da ${p.corretta_da}` : '')));
        r.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try {
                await fetchApi(`/api/presenze/${p.id}`, { method: 'PUT', body: JSON.stringify({ inizio: daInput(ini.value), fine: daInput(fin.value), minuti: Math.round(Number(h.value) * 60), nota: nota.value }) });
                notifica('Presenza corretta.', 'successo');
                dopo();
            } catch (err) { notifica(err.message, 'errore'); }
        });
        togli.addEventListener('click', async () => {
            if (!confirm('Togliere questa presenza?')) return;
            try { await fetchApi(`/api/presenze/${p.id}`, { method: 'DELETE' }); dopo(); } catch (err) { notifica(err.message, 'errore'); }
        });
        // Cambiando gli orari le ore seguono.
        const ricalcola = () => { const m = (new Date(fin.value) - new Date(ini.value)) / 3600000; if (m >= 0) h.value = m.toFixed(2).replace(/\.00$/, ''); };
        ini.addEventListener('change', ricalcola);
        fin.addEventListener('change', ricalcola);
        return r;
    }

    // --- Il riepilogo dell'anno ---------------------------------------------------------------------
    async function apriRiepilogo(anno = new Date().getFullYear()) {
        const sel = $('pres-anno');
        if (!sel.options.length) {
            const quest = new Date().getFullYear();
            for (let a = quest; a >= quest - 6; a--) sel.appendChild(new Option(a, a));
        }
        sel.value = anno;
        $('pres-csv').href = `/api/presenze/riepilogo?anno=${anno}&formato=csv`;
        const corpo = $('pres-corpo');
        corpo.replaceChildren(el('p', 'nota', 'Carico...'));
        $('modale-presenze').hidden = false;
        try {
            const r = await fetchApi(`/api/presenze/riepilogo?anno=${anno}`);
            corpo.replaceChildren();
            if (!r.persone.length) return corpo.appendChild(el('p', 'nota', `Nessuna presenza nel ${anno}.`));
            const t = el('table', 'tabella-riepilogo');
            const testa = el('tr');
            ['Volontario', 'Emergenze', 'Ore', 'Attività', 'Ore', 'Totale'].forEach(x => testa.appendChild(el('th', '', x)));
            t.appendChild(testa);
            for (const p of r.persone) {
                const tr = el('tr');
                const nome = el('td');
                const a = el('a', '', `${p.cognome} ${p.nome}`); a.href = '#';
                a.addEventListener('click', (e) => { e.preventDefault(); apriPersona(p, anno); });
                nome.appendChild(a);
                tr.append(nome, el('td', '', p.emergenze), el('td', '', p.ore_emergenze), el('td', '', p.attivita), el('td', '', p.ore_attivita), el('td', 'totale', p.ore_totali));
                t.appendChild(tr);
            }
            corpo.appendChild(t);
        } catch (e) { corpo.replaceChildren(el('p', 'nota', e.message)); }
    }

    async function apriPersona(persona, anno) {
        const corpo = $('pres-corpo');
        corpo.replaceChildren(el('p', 'nota', 'Carico...'));
        try {
            const r = await fetchApi(`/api/users/${persona.id}/presenze?anno=${anno}`);
            const indietro = el('a', 'button-style button-secondary btn-piccolo', '← Tutti');
            indietro.href = '#';
            indietro.addEventListener('click', (e) => { e.preventDefault(); apriRiepilogo(anno); });
            corpo.replaceChildren(indietro, el('h3', '', `${persona.cognome} ${persona.nome}: ${r.ore_totali} nel ${anno}`));
            const ul = el('ul', 'elenco-semplice');
            for (const v of r.voci) {
                const li = el('li', '', `${giornoDi(v.inizio)} · ${v.tipo}: ${v.titolo} · ${v.ore}${v.corretta_da ? ` (corretta da ${v.corretta_da})` : ''} `);
                const att = el('a', '', 'attestato'); att.href = `/api/presenze/${v.id}/attestato`; att.target = '_blank'; att.rel = 'noopener';
                li.appendChild(att);
                ul.appendChild(li);
            }
            corpo.appendChild(ul);
        } catch (e) { corpo.replaceChildren(el('p', 'nota', e.message)); }
    }

    $('btn-presenze').addEventListener('click', () => apriRiepilogo());
    $('pres-anno').addEventListener('change', () => apriRiepilogo(Number($('pres-anno').value)));

    // --- Avvio ------------------------------------------------------------------------------------
    (async () => {
        await carica();
        caricaDaRispondere();
        const parametri = new URLSearchParams(window.location.search);
        const chiesta = parseInt(parametri.get('attivita'), 10);
        if (chiesta) apriAttivita(chiesta);
        const scenario = parseInt(parametri.get('scenario'), 10);
        if (scenario && dati?.organizza) {
            try { apriForm(null, null, await fetchApi(`/api/scenari/${scenario}`)); } catch (e) { notifica(e.message, 'errore'); }
        }
    })();
});
