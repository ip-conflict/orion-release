// La chiamata dei volontari nel centro operativo (src/chiamate.js):
//   - il pulsante "Volontari" dell'intestazione, con quanti arrivano e un
//     segno rosso se c'è qualcuno da chiamare a voce;
//   - il pannello: chi è in sede senza squadra, chi sta arrivando, chi va
//     chiamato a voce (col numero), chi non ha ancora risposto, chi non viene;
//     "È arrivato", "Non viene", "Congeda"; le chiamate fatte, con "Richiama";
//   - "Chiama volontari": tutti, i reperibili di oggi, chi ha un corso o un
//     elenco, con il messaggio e il modo di avviso, e prima di mandare quante
//     persone partiranno e chi resta fuori;
//   - a chi è stato chiamato, una fascia per rispondere senza lasciare la sala.
//
// Il centro operativo chiama Chiamata.emergenza(emergenza) a ogni cambio.

(function () {
    const STILE = `
    .ch-badge { display: inline-block; min-width: 18px; padding: 0 5px; margin-left: 4px; border-radius: 9px; font-size: 0.72rem; font-weight: 800; background: var(--success-text, #166534); color: #fff; }
    .ch-badge.rosso { background: var(--danger-text, #b91c1c); }
    .chp-velo { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 5000; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 24px 12px; }
    .chp-finestra { background: var(--surface-color); color: var(--text-color); width: 100%; max-width: 760px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); display: flex; flex-direction: column; max-height: calc(100dvh - 48px); }
    .chp-testa { display: flex; align-items: center; gap: 10px; padding: 16px 20px 12px; border-bottom: 1px solid var(--border-color); }
    .chp-testa h2 { margin: 0; font-size: 1.2rem; flex: 1; }
    .chp-chiudi { border: 0; background: transparent; color: inherit; font-size: 1.6rem; line-height: 1; cursor: pointer; padding: 2px 8px; border-radius: 6px; }
    .chp-conti { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 20px; border-bottom: 1px solid var(--border-color); }
    .chp-conto { padding: 4px 10px; border-radius: 14px; font-size: 0.82rem; font-weight: 700; background: var(--secondary-bg-color); }
    .chp-conto.sede { background: var(--success-soft-bg); color: var(--success-text); }
    .chp-conto.arrivo { background: var(--info-soft-bg); color: var(--info-text); }
    .chp-conto.voce { background: var(--danger-soft-bg); color: var(--danger-text); }
    .chp-azioni { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px 20px 4px; }
    .chp-corpo { overflow-y: auto; padding: 4px 20px 18px; }
    .chp-corpo h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); margin: 16px 0 6px; display: flex; gap: 6px; align-items: center; }
    .chp-corpo h3.voce { color: var(--danger-text); }
    .chp-spiega { font-size: 0.8rem; color: var(--text-muted); margin: 0 0 6px; }
    .chp-riga { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; font-size: 0.88rem; }
    .chp-riga .chp-nome { font-weight: 700; flex: 1; min-width: 150px; }
    .chp-riga .chp-det { color: var(--text-muted); font-size: 0.8rem; width: 100%; }
    .chp-riga a.chp-tel { font-weight: 700; color: var(--danger-text); text-decoration: none; }
    .chp-riga button, .chp-azioni button, .chp-chiamate button { font: inherit; font-size: 0.8rem; font-weight: 600; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-color); cursor: pointer; }
    .chp-riga button.primario, .chp-azioni button.primario, .chp-invia { background: var(--button-bg); color: var(--button-text); border-color: transparent; }
    .chp-vuoto { color: var(--text-muted); font-style: italic; font-size: 0.85rem; padding: 4px 0; }
    .chp-chiamate { font-size: 0.82rem; }
    .chp-chiamate li { margin-bottom: 4px; }
    .chp-dettagli summary { cursor: pointer; font-size: 0.78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); margin: 16px 0 6px; }
    .chp-modulo { display: flex; flex-direction: column; gap: 12px; padding: 12px 20px 18px; overflow-y: auto; }
    .chp-carta { display: flex; gap: 10px; align-items: flex-start; border: 2px solid var(--border-color); border-radius: 10px; padding: 10px 12px; cursor: pointer; }
    .chp-carta:has(input:checked) { border-color: var(--button-bg); background: var(--info-soft-bg); }
    .chp-carta input { margin-top: 3px; }
    .chp-carta strong { display: block; }
    .chp-carta span { font-size: 0.82rem; color: var(--text-muted); }
    .chp-modulo textarea, .chp-modulo select, .chp-modulo input[type=search] { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); font: inherit; }
    .chp-elenco { max-height: 240px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; padding: 4px 8px; }
    .chp-elenco label { display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 0.88rem; }
    .chp-elenco label.spento { opacity: .55; }
    .chp-segno { font-size: 0.7rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: var(--secondary-bg-color); }
    .chp-segno.rep { background: var(--success-soft-bg); color: var(--success-text); }
    .chp-segno.ass { background: var(--warning-soft-bg); color: var(--warning-text); }
    .chp-riassunto { padding: 10px 12px; border-radius: 8px; background: var(--secondary-bg-color); font-size: 0.9rem; }
    .chp-riassunto strong { font-size: 1.05rem; }
    .chp-piede { display: flex; gap: 8px; justify-content: flex-end; }
    .chp-piede button { font: inherit; font-weight: 700; padding: 9px 16px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-color); cursor: pointer; }
    .chp-piede .chp-invia { border-color: transparent; }
    .chp-invia:disabled { opacity: .5; cursor: not-allowed; }
    .chp-velo [hidden] { display: none !important; }
    /* La fascia di chi è stato chiamato */
    .ch-mia { position: fixed; top: 70px; left: 50%; transform: translateX(-50%); z-index: 4500; background: var(--surface-color); border: 2px solid var(--danger-text); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.25); padding: 12px 16px; max-width: min(640px, calc(100vw - 24px)); display: flex; flex-direction: column; gap: 8px; }
    .ch-mia strong { color: var(--danger-text); }
    .ch-mia .ch-mia-azioni { display: flex; gap: 6px; flex-wrap: wrap; }
    .ch-mia button { font: inherit; font-weight: 700; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-color); cursor: pointer; }
    .ch-mia button.primario { background: var(--button-bg); color: var(--button-text); border-color: transparent; }
    `;

    const el = (tag, classe, testo) => {
        const e = document.createElement(tag);
        if (classe) e.className = classe;
        if (testo !== undefined && testo !== null) e.textContent = testo;
        return e;
    };
    const bottone = (testo, classe, azione) => {
        const b = el('button', classe || '', testo);
        b.type = 'button';
        b.addEventListener('click', azione);
        return b;
    };
    const data = (v) => v instanceof Date ? v : new Date(String(v).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    const ora = (v) => v ? data(v).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const nome = (p) => `${p.cognome || ''} ${p.nome || ''}`.trim() || p.username;

    let emergenza = null;
    // L'allertamento di un'attività del calendario: la chiamata senza sala.
    let attivitaCtx = null;
    let quadro = null;
    let velo = null;
    let timer = null;

    const esterno = () => (typeof ruoliUtente === 'function' ? ruoliUtente() : []).includes('esterno');

    // --- Il pulsante dell'intestazione ------------------------------------------------
    function aggiornaPulsante() {
        const btn = document.getElementById('chiamata-btn');
        if (!btn) return;
        btn.hidden = !emergenza || esterno();
        const badge = btn.querySelector('.ch-badge');
        if (!badge) return;
        const c = quadro?.conteggi;
        const n = c ? c.in_sede + c.in_arrivo : 0;
        badge.hidden = !c || (n === 0 && !c.da_chiamare);
        badge.textContent = c?.da_chiamare ? `${n} · ${c.da_chiamare}!` : String(n);
        badge.classList.toggle('rosso', !!c?.da_chiamare);
        btn.title = c ? `In sede senza squadra: ${c.in_sede}. In arrivo: ${c.in_arrivo}. Da chiamare a voce: ${c.da_chiamare}.` : 'La chiamata dei volontari';
    }

    const conCtx = (url) => attivitaCtx ? `${url}${url.includes('?') ? '&' : '?'}attivita_id=${attivitaCtx}` : url;
    const corpoCtx = (corpo = {}) => JSON.stringify(attivitaCtx ? { ...corpo, attivita_id: attivitaCtx } : corpo);

    async function caricaQuadro() {
        if ((!emergenza && !attivitaCtx) || esterno()) { quadro = null; aggiornaPulsante(); return; }
        try {
            quadro = await fetchApi(conCtx('/api/disponibilita'));
        } catch {
            quadro = null;
        }
        aggiornaPulsante();
        if (velo && !velo.dataset.modulo) disegnaPannello();
    }


    // --- Il pannello ------------------------------------------------------------------
    function chiudiPannello() {
        velo?.remove();
        velo = null;
        // Fuori dall'allertamento il pannello torna quello della sala.
        if (attivitaCtx) { attivitaCtx = null; caricaQuadro(); }
    }

    function apriPannello(opz = {}) {
        chiudiPannello();
        attivitaCtx = opz.attivitaId || null;
        velo = el('div', 'chp-velo');
        velo.addEventListener('click', (e) => { if (e.target === velo) chiudiPannello(); });
        document.body.appendChild(velo);
        disegnaPannello();
        caricaQuadro();
    }

    async function cambia(userId, stato, extra = {}) {
        try {
            await fetchApi(`/api/disponibilita/${userId}`, { method: 'PUT', body: corpoCtx({ stato, ...extra }) });
            await caricaQuadro();
        } catch (e) {
            notifica(e.message, 'errore');
        }
    }

    function riga(p, azioni, dettaglio) {
        const r = el('div', 'chp-riga');
        r.appendChild(el('span', 'chp-nome', nome(p)));
        if (p.telefono) {
            const a = el('a', 'chp-tel', p.telefono);
            a.href = `tel:${p.telefono.replace(/[^+\d]/g, '')}`;
            r.appendChild(a);
        }
        for (const b of azioni) r.appendChild(b);
        if (dettaglio) r.appendChild(el('span', 'chp-det', dettaglio));
        return r;
    }

    function sezione(corpo, titolo, persone, costruisci, { classe = '', spiega = '', vuoto = null } = {}) {
        if (!persone.length && vuoto === null) return;
        const h = el('h3', classe, `${titolo} (${persone.length})`);
        corpo.appendChild(h);
        if (spiega) corpo.appendChild(el('p', 'chp-spiega', spiega));
        if (!persone.length) corpo.appendChild(el('div', 'chp-vuoto', vuoto));
        for (const p of persone) corpo.appendChild(costruisci(p));
    }

    function disegnaPannello() {
        if (!velo) return;
        delete velo.dataset.modulo;
        const finestra = el('div', 'chp-finestra');
        finestra.setAttribute('role', 'dialog');
        finestra.setAttribute('aria-modal', 'true');
        const testa = el('div', 'chp-testa');
        testa.appendChild(el('h2', '', quadro?.contesto?.tipo === 'attivita' ? `Allertamento: ${quadro.contesto.titolo}`
            : `Volontari${quadro?.contesto?.simulazione ? ' (simulazione)' : ''}`));
        testa.appendChild(bottone('×', 'chp-chiudi', chiudiPannello));
        finestra.appendChild(testa);

        if (!quadro) {
            finestra.appendChild(el('div', 'chp-corpo', 'Caricamento...'));
            velo.replaceChildren(finestra);
            return;
        }
        const c = quadro.conteggi;
        const conti = el('div', 'chp-conti');
        conti.append(
            el('span', 'chp-conto sede', `In sede senza squadra: ${c.in_sede}`),
            el('span', 'chp-conto arrivo', `In arrivo: ${c.in_arrivo}`),
            el('span', `chp-conto${c.da_chiamare ? ' voce' : ''}`, `Da chiamare a voce: ${c.da_chiamare}`),
            el('span', 'chp-conto', `In attesa di risposta: ${c.senza_risposta - c.da_chiamare}`),
            el('span', 'chp-conto', `Non vengono: ${c.non_disponibili}`)
        );
        finestra.appendChild(conti);

        const azioni = el('div', 'chp-azioni');
        if (quadro.puo_chiamare) azioni.appendChild(bottone('📣 Chiama volontari', 'primario', apriModulo));
        azioni.appendChild(bottone('+ È arrivato qualcuno senza chiamata', '', apriArrivo));
        finestra.appendChild(azioni);

        const corpo = el('div', 'chp-corpo');
        const persone = quadro.persone;
        const daChiamare = persone.filter(p => p.da_chiamare);
        const inSede = persone.filter(p => p.stato === 'arrivato' && !p.squadra);
        const inSquadra = persone.filter(p => p.stato === 'arrivato' && p.squadra);
        const inArrivo = persone.filter(p => p.stato === 'in_arrivo');
        const attesa = persone.filter(p => p.stato === 'senza_risposta' && !p.da_chiamare);
        const no = persone.filter(p => p.stato === 'non_disponibile');
        const congedati = persone.filter(p => p.stato === 'congedato');

        sezione(corpo, 'Da chiamare a voce', daChiamare, p => riga(p, [
            bottone('Arriva', 'primario', () => cambia(p.id, 'in_arrivo')),
            bottone('Non viene', '', () => cambia(p.id, 'non_disponibile'))
        ], p.avvisato_app || p.avvisato_email
            ? `Chiamato alle ${ora(p.chiamato_il)}, nessuna risposta.`
            : 'Non ha né l\'app con gli avvisi né l\'email: la chiamata non gli è arrivata.'),
        { classe: 'voce', spiega: 'Telefona: non hanno risposto in tempo, o non si raggiungono dall\'app né per email.' });

        sezione(corpo, 'In sede, senza squadra', inSede, p => riga(p, [
            bottone('Congeda', '', () => cambia(p.id, 'congedato'))
        ], `Arrivato alle ${ora(p.arrivato_il)}.`),
        { spiega: 'Pronti da mettere in squadra: nella composizione delle squadre compaiono per primi.', vuoto: 'Nessuno in attesa in sede.' });

        sezione(corpo, 'In arrivo', inArrivo, p => riga(p, [
            bottone('È arrivato', 'primario', () => cambia(p.id, 'arrivato')),
            bottone('Non viene', '', () => cambia(p.id, 'non_disponibile'))
        ], [p.risposta === 'ritardo' && p.arrivo_previsto ? `Arriva verso le ${ora(p.arrivo_previsto)}` : 'Arriva appena può', p.nota].filter(Boolean).join(' · ')),
        { vuoto: 'Nessuno in arrivo.' });

        sezione(corpo, 'In attesa di risposta', attesa, p => riga(p, [
            bottone('È arrivato', '', () => cambia(p.id, 'arrivato'))
        ], `Chiamato alle ${ora(p.chiamato_il)}.`));

        sezione(corpo, 'In squadra', inSquadra, p => riga(p, [], `Squadra ${p.squadra}, arrivato alle ${ora(p.arrivato_il)}.`));

        sezione(corpo, 'Non vengono', no, p => riga(p, [
            bottone('Arriva lo stesso', '', () => cambia(p.id, 'in_arrivo'))
        ], p.nota || ''));

        if (congedati.length) {
            const det = el('details', 'chp-dettagli');
            det.appendChild(el('summary', '', `Congedati (${congedati.length})`));
            for (const p of congedati) det.appendChild(riga(p, [bottone('È tornato', '', () => cambia(p.id, 'arrivato'))], `Arrivato alle ${ora(p.arrivato_il)}, congedato alle ${ora(p.congedato_il)}.`));
            corpo.appendChild(det);
        }

        if (quadro.chiamate.length) {
            corpo.appendChild(el('h3', '', 'Chiamate fatte'));
            const ul = el('ul', 'chp-chiamate');
            const nomiCriteri = { tutti: 'Tutti', reperibili: 'Reperibili', corso: 'Per corso', scelti: 'Scelti a mano' };
            for (const ch of [...quadro.chiamate].reverse()) {
                const li = el('li', '', `${ora(ch.creata_il)} · ${nomiCriteri[ch.criterio]} · ${ch.chiamati} chiamati · da ${ch.creata_da_nome || '—'}${ch.messaggio ? ` · "${ch.messaggio}"` : ''} `);
                if (quadro.puo_chiamare) li.appendChild(bottone('Richiama chi non ha risposto', '', async () => {
                    try {
                        const r = await fetchApi(`/api/chiamate/${ch.id}/richiama`, { method: 'POST', body: '{}' });
                        notifica(r.richiamati === 1 ? 'Richiamata una persona.' : `Richiamate ${r.richiamati} persone.`, 'successo');
                        caricaQuadro();
                    } catch (e) { notifica(e.message, 'errore'); }
                }));
                ul.appendChild(li);
            }
            corpo.appendChild(ul);
        } else if (!persone.length) {
            corpo.appendChild(el('p', 'chp-vuoto', quadro.puo_chiamare
                ? 'Nessuna chiamata ancora. Con "Chiama volontari" avvisi chi serve sul telefono o per email.'
                : 'Nessuna chiamata ancora. Chiamare spetta a chi coordina.'));
        }
        finestra.appendChild(corpo);
        velo.replaceChildren(finestra);
    }

    // --- Chi arriva senza chiamata ------------------------------------------------------
    async function apriArrivo() {
        let dati;
        try { dati = await fetchApi(conCtx('/api/chiamate/candidati')); } catch (e) { return notifica(e.message, 'errore'); }
        velo.dataset.modulo = 'arrivo';
        const finestra = el('div', 'chp-finestra');
        const testa = el('div', 'chp-testa');
        testa.appendChild(el('h2', '', 'È arrivato qualcuno'));
        testa.appendChild(bottone('×', 'chp-chiudi', () => disegnaPannello()));
        finestra.appendChild(testa);
        const modulo = el('div', 'chp-modulo');
        modulo.appendChild(el('p', 'chp-spiega', 'Chi si presenta in sede senza essere stato chiamato: segnalo arrivato e conta come presente da adesso.'));
        const cerca = el('input');
        cerca.type = 'search';
        cerca.placeholder = 'Cerca per nome...';
        const lista = el('div', 'chp-elenco');
        const disegna = () => {
            const q = cerca.value.trim().toLowerCase();
            lista.replaceChildren();
            for (const p of dati.persone) {
                if (q && !`${p.nome} ${p.cognome}`.toLowerCase().includes(q)) continue;
                if (p.stato === 'arrivato' || p.squadra) continue;
                const r = el('label');
                r.append(el('span', '', nome(p)));
                r.style.justifyContent = 'space-between';
                r.appendChild(bottone('È arrivato', 'primario', async () => {
                    await cambia(p.id, 'arrivato');
                    notifica(`${nome(p)} è in sede.`, 'successo');
                    disegnaPannello();
                }));
                lista.appendChild(r);
            }
            if (!lista.children.length) lista.appendChild(el('div', 'chp-vuoto', 'Nessuno.'));
        };
        cerca.addEventListener('input', disegna);
        modulo.append(cerca, lista);
        const piede = el('div', 'chp-piede');
        piede.appendChild(bottone('Indietro', '', () => disegnaPannello()));
        modulo.appendChild(piede);
        finestra.appendChild(modulo);
        velo.replaceChildren(finestra);
        disegna();
        cerca.focus();
    }

    // --- Comporre la chiamata ----------------------------------------------------------
    async function apriModulo() {
        let dati;
        try { dati = await fetchApi(conCtx('/api/chiamate/candidati')); } catch (e) { return notifica(e.message, 'errore'); }
        velo.dataset.modulo = 'chiama';
        const scelti = new Set();
        const finestra = el('div', 'chp-finestra');
        const testa = el('div', 'chp-testa');
        testa.appendChild(el('h2', '', 'Chiama volontari'));
        testa.appendChild(bottone('×', 'chp-chiudi', () => disegnaPannello()));
        finestra.appendChild(testa);
        const modulo = el('div', 'chp-modulo');

        const liberi = (p) => !p.squadra && p.stato !== 'in_arrivo' && p.stato !== 'arrivato';
        const nRep = dati.persone.filter(p => p.reperibile).length;
        const carta = (valore, titolo, spiega, checked = false) => {
            const l = el('label', 'chp-carta');
            const r = el('input');
            r.type = 'radio'; r.name = 'ch-criterio'; r.value = valore; r.checked = checked;
            const t = el('div');
            t.append(el('strong', '', titolo), el('span', '', spiega));
            l.append(r, t);
            return l;
        };
        modulo.appendChild(el('strong', '', '1. Chi chiamare'));
        modulo.appendChild(carta('tutti', 'Tutti i volontari', 'Tranne chi è già in squadra, chi sta già arrivando e chi ha segnato un\'assenza oggi.', true));
        modulo.appendChild(carta('reperibili', `Solo i reperibili di oggi (${nRep})`, nRep ? 'Chi è di turno secondo il calendario.' : 'Oggi non c\'è nessuno di turno nel calendario.'));
        const cartaCorso = carta('corso', 'Chi ha un corso valido', 'Per esempio chi ha il corso motosega o idrovore.');
        const selCorso = el('select');
        for (const c of dati.corsi) selCorso.appendChild(new Option(c.nome, c.id));
        if (!dati.corsi.length) { cartaCorso.querySelector('input').disabled = true; selCorso.disabled = true; }
        cartaCorso.querySelector('div').appendChild(selCorso);
        modulo.appendChild(cartaCorso);
        const cartaScelti = carta('scelti', 'Scelgo io le persone', 'Anche chi ha segnato un\'assenza, se serve proprio lui.');
        modulo.appendChild(cartaScelti);
        const blocco = el('div');
        blocco.hidden = true;
        const cerca = el('input');
        cerca.type = 'search'; cerca.placeholder = 'Cerca per nome...';
        const lista = el('div', 'chp-elenco');
        blocco.append(cerca, lista);
        modulo.appendChild(blocco);

        modulo.appendChild(el('strong', '', '2. Il messaggio'));
        const testo = el('textarea');
        testo.rows = 2; testo.maxLength = 500;
        testo.placeholder = 'Es.: Allagamenti in zona industriale, ritrovo in sede alle 21. Portate gli stivali.';
        modulo.appendChild(testo);

        modulo.appendChild(el('strong', '', '3. Come avvisare'));
        const modi = el('div');
        const cApp = el('input'); cApp.type = 'checkbox'; cApp.checked = true;
        const cEmail = el('input'); cEmail.type = 'checkbox';
        const lApp = el('label'); lApp.append(cApp, " Avviso nell'app");
        const lEmail = el('label'); lEmail.append(cEmail, ' Email');
        lApp.style.marginRight = '16px';
        modi.append(lApp, lEmail);
        modulo.appendChild(modi);
        const attesaRiga = el('label');
        const selAttesa = el('select');
        for (const m of [5, 10, 15, 30, 60]) selAttesa.appendChild(new Option(`${m} minuti`, m));
        selAttesa.value = '10';
        selAttesa.style.width = 'auto';
        attesaRiga.append('Chi non risponde entro ', selAttesa, ' va chiamato a voce.');
        modulo.appendChild(attesaRiga);

        const riassunto = el('div', 'chp-riassunto');
        modulo.appendChild(riassunto);
        const piede = el('div', 'chp-piede');
        const invia = bottone('Chiama', 'chp-invia', () => manda());
        piede.append(bottone('Annulla', '', () => disegnaPannello()), invia);
        modulo.appendChild(piede);
        finestra.appendChild(modulo);
        velo.replaceChildren(finestra);

        const criterio = () => modulo.querySelector('input[name=ch-criterio]:checked')?.value;
        // Come il server: chi resta fuori e chi parte.
        function calcola() {
            const k = criterio();
            const idCorso = Number(selCorso.value);
            const scelta = dati.persone.filter(p => k === 'tutti' ? true : k === 'reperibili' ? p.reperibile : k === 'corso' ? p.corsi.includes(idCorso) : scelti.has(p.id));
            const fuori = { squadra: 0, arrivo: 0, no: 0, assenti: 0 };
            const partono = scelta.filter(p => {
                if (p.squadra) { fuori.squadra++; return false; }
                if (p.stato === 'in_arrivo' || p.stato === 'arrivato') { fuori.arrivo++; return false; }
                if (k !== 'scelti' && p.stato === 'non_disponibile') { fuori.no++; return false; }
                if (k !== 'scelti' && p.assente) { fuori.assenti++; return false; }
                return true;
            });
            const irraggiungibili = partono.filter(p => !(cApp.checked && p.app) && !(cEmail.checked && p.email)).length;
            return { partono, fuori, irraggiungibili };
        }
        function aggiorna() {
            blocco.hidden = criterio() !== 'scelti';
            const { partono, fuori, irraggiungibili } = calcola();
            riassunto.replaceChildren();
            riassunto.appendChild(el('strong', '', partono.length === 1 ? 'Chiamerai 1 persona.' : `Chiamerai ${partono.length} persone.`));
            const resto = [
                fuori.squadra && `${fuori.squadra} già in squadra`,
                fuori.arrivo && `${fuori.arrivo} già in arrivo o in sede`,
                fuori.no && `${fuori.no} hanno già detto di no`,
                fuori.assenti && `${fuori.assenti} assenti oggi`
            ].filter(Boolean);
            if (resto.length) riassunto.appendChild(el('div', '', `Restano fuori: ${resto.join(', ')}.`));
            if (irraggiungibili) riassunto.appendChild(el('div', '', `${irraggiungibili} non hanno l'app con gli avvisi${cEmail.checked ? ' né l\'email' : ''}: compariranno fra quelli da chiamare a voce.`));
            if (!cApp.checked && !cEmail.checked) riassunto.appendChild(el('div', '', 'Scegli almeno un modo di avviso.'));
            invia.disabled = !partono.length || (!cApp.checked && !cEmail.checked);
            invia.textContent = partono.length ? `Chiama (${partono.length})` : 'Chiama';
        }
        function disegnaLista() {
            const q = cerca.value.trim().toLowerCase();
            lista.replaceChildren();
            for (const p of dati.persone) {
                if (q && !`${p.nome} ${p.cognome}`.toLowerCase().includes(q)) continue;
                const l = el('label', liberi(p) ? '' : 'spento');
                const c = el('input');
                c.type = 'checkbox';
                c.checked = scelti.has(p.id);
                c.disabled = !liberi(p);
                c.addEventListener('change', () => { c.checked ? scelti.add(p.id) : scelti.delete(p.id); aggiorna(); });
                l.append(c, el('span', '', nome(p)));
                if (p.reperibile) l.appendChild(el('span', 'chp-segno rep', 'di turno'));
                if (p.assente) l.appendChild(el('span', 'chp-segno ass', 'assente'));
                if (p.squadra) l.appendChild(el('span', 'chp-segno', `in ${p.squadra}`));
                if (p.stato === 'in_arrivo' || p.stato === 'arrivato') l.appendChild(el('span', 'chp-segno', p.stato === 'arrivato' ? 'in sede' : 'in arrivo'));
                if (p.stato === 'non_disponibile') l.appendChild(el('span', 'chp-segno', 'ha detto no'));
                lista.appendChild(l);
            }
        }
        async function manda() {
            invia.disabled = true;
            const k = criterio();
            try {
                const r = await fetchApi('/api/chiamate', {
                    method: 'POST',
                    body: corpoCtx({
                        criterio: k, corso_id: k === 'corso' ? Number(selCorso.value) : undefined,
                        persone: k === 'scelti' ? [...scelti] : undefined,
                        messaggio: testo.value, avviso_app: cApp.checked, avviso_email: cEmail.checked,
                        minuti_attesa: Number(selAttesa.value)
                    })
                });
                notifica(r.chiamati === 1 ? 'Chiamata partita: 1 persona.' : `Chiamata partita: ${r.chiamati} persone.`, 'successo');
                await caricaQuadro();
                disegnaPannello();
            } catch (e) {
                notifica(e.message, 'errore');
                invia.disabled = false;
            }
        }
        modulo.addEventListener('change', aggiorna);
        cerca.addEventListener('input', disegnaLista);
        disegnaLista();
        aggiorna();
    }

    // --- La fascia di chi è stato chiamato ---------------------------------------------
    async function controllaMie() {
        document.querySelector('.ch-mia')?.remove();
        if (!emergenza || esterno()) return;
        let mie = [];
        try { mie = await fetchApi('/api/chiamate/mie'); } catch { return; }
        const c = mie.find(x => x.emergency_id === emergenza.id && x.stato === 'senza_risposta');
        if (!c) return;
        const box = el('div', 'ch-mia');
        box.setAttribute('role', 'alert');
        box.appendChild(el('strong', '', `${c.simulazione ? '[SIMULAZIONE] ' : ''}Sei stato chiamato`));
        if (c.messaggio) box.appendChild(el('div', '', c.messaggio));
        const az = el('div', 'ch-mia-azioni');
        const rispondi = async (risposta, minuti) => {
            try {
                await fetchApi(`/api/chiamate/${c.id}/risposta`, { method: 'POST', body: JSON.stringify({ risposta, minuti }) });
                notifica('Risposta mandata alla sala.', 'successo');
                box.remove();
            } catch (e) { notifica(e.message, 'errore'); }
        };
        az.append(
            bottone('Arrivo subito', 'primario', () => rispondi('arrivo')),
            bottone('Fra 30 minuti', '', () => rispondi('ritardo', 30)),
            bottone("Fra un'ora", '', () => rispondi('ritardo', 60)),
            bottone('Non posso', '', () => rispondi('no')),
            bottone('Dopo', '', () => box.remove())
        );
        box.appendChild(az);
        document.body.appendChild(box);
    }

    // --- Avvio ------------------------------------------------------------------------------
    const stile = document.createElement('style');
    stile.textContent = STILE;
    document.head.appendChild(stile);
    document.getElementById('chiamata-btn')?.addEventListener('click', apriPannello);
    document.addEventListener('ws:reload_disponibili', () => caricaQuadro());
    document.addEventListener('ws:notifica', (e) => { if (e.detail?.notifica?.tipo === 'chiamata') controllaMie(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && velo) chiudiPannello(); });

    window.Chiamata = {
        emergenza(nuova) {
            const cambiata = (nuova?.id || null) !== (emergenza?.id || null);
            emergenza = nuova || null;
            if (cambiata) {
                caricaQuadro();
                controllaMie();
                clearInterval(timer);
                // "Da chiamare" dipende dal tempo che passa: si rilegge ogni mezzo minuto.
                if (emergenza) timer = setInterval(caricaQuadro, 30000);
            }
            aggiornaPulsante();
        },
        apriPannello
    };
})();
