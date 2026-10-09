// La simulazione nel centro operativo:
//   - per tutti, la fascia SIMULAZIONE sotto l'intestazione e lo stato
//     viola: nessuno la scambia per un'emergenza vera;
//   - per chi apre le emergenze, "Emergenza reale": apre quella vera e
//     ferma la simulazione (le squadre restano);
//   - per la regia (src/copione.js), il pannello Regia a destra: l'orologio
//     dello scenario con Avvia, Pausa e Riprendi; il prossimo evento; gli
//     eventi con "Fai uscire ora", "+5 minuti", "Salta"; le segnalazioni da
//     telefonare con il testo da leggere e "Collega" quando la sala le ha
//     inserite; l'evento inventato al momento; le osservazioni.
//
// Il centro operativo chiama Regia.emergenza(emergenza) a ogni cambio.

(function () {
    const STILE = `
    #comunicazioni-sala { position: fixed; top: 96px; left: 50%; transform: translateX(-50%); z-index: 1200; width: min(560px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 8px; }
    .com-sala { background: var(--surface-color, #fff); color: var(--text-color, #111); border: 2px solid #6d28d9; border-left-width: 8px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 12px 14px; animation: com-entra .25s ease-out; }
    .com-sala .com-testa { display: flex; align-items: center; gap: 8px; font-size: .78rem; font-weight: 800; letter-spacing: .05em; color: #6d28d9; text-transform: uppercase; }
    .com-sala h3 { margin: 4px 0 2px; font-size: 1.1rem; }
    .com-sala p { margin: 0 0 8px; white-space: pre-wrap; }
    .com-sala .com-azioni { display: flex; justify-content: flex-end; }
    @keyframes com-entra { from { transform: translateY(-12px); opacity: 0; } to { transform: none; opacity: 1; } }
    #simulazione-btn { color: #6d28d9; border-color: #6d28d9; }
    @media (prefers-color-scheme: dark) {
        :root:not([data-theme="light"]) .com-sala .com-testa { color: #c4b5fd; }
        :root:not([data-theme="light"]) #simulazione-btn { color: #ede9fe; border-color: #a78bfa; background: rgba(167, 139, 250, .18); }
        :root:not([data-theme="light"]) .com-sala { border-color: #8b5cf6; }
    }
    :root[data-theme="dark"] .com-sala .com-testa { color: #c4b5fd; }
    :root[data-theme="dark"] #simulazione-btn { color: #ede9fe; border-color: #a78bfa; background: rgba(167, 139, 250, .18); }
    :root[data-theme="dark"] .com-sala { border-color: #8b5cf6; }
    .sv-velo { position: fixed; inset: 0; z-index: 5000; background: rgba(15, 23, 42, .45); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .sv-finestra { background: var(--surface-color, #fff); color: var(--text-color, #111); border-radius: 12px; border-top: 6px solid #6d28d9; width: min(520px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; padding: 18px 20px; box-shadow: 0 20px 50px rgba(0,0,0,.3); }
    .sv-finestra h2 { margin: 0 0 4px; font-size: 1.25rem; }
    .sv-finestra p.sv-nota { margin: 0 0 12px; font-size: .88rem; color: var(--text-muted, #64748b); }
    .sv-finestra label { display: block; margin: 10px 0 0; font-weight: 600; font-size: .9rem; }
    .sv-finestra label > input, .sv-finestra label > select, .sv-finestra label > textarea { display: block; width: 100%; margin-top: 4px; font-weight: 400; font: inherit; padding: 7px 9px; border: 1px solid var(--border-color, #cbd5e1); border-radius: 6px; background: var(--form-input-bg, #fff); color: inherit; box-sizing: border-box; }
    .sv-scelte { display: flex; gap: 8px; margin-top: 4px; }
    .sv-scelte label { flex: 1; margin: 0; display: flex; gap: 8px; align-items: center; font-weight: 400; border: 1px solid var(--border-color, #cbd5e1); border-radius: 8px; padding: 9px 12px; cursor: pointer; }
    .sv-scelte label > input { display: inline-block; width: auto; margin: 0; padding: 0; accent-color: #6d28d9; }
    .sv-scelte label:has(input:checked) { border-color: #6d28d9; background: rgba(109, 40, 217, .08); font-weight: 600; }
    .sv-azioni { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .sv-azioni .sv-apri { background: #6d28d9 !important; border-color: #6d28d9 !important; color: #fff !important; }
    body.in-simulazione header { border-bottom: 4px solid #6d28d9 !important; }
    #fascia-simulazione { position: fixed; top: 60px; left: 0; right: 0; z-index: 1100; height: 26px; display: flex; align-items: center; justify-content: center; gap: 10px;
        background: repeating-linear-gradient(45deg, #6d28d9, #6d28d9 12px, #7c3aed 12px, #7c3aed 24px); color: #fff; font-weight: 800; letter-spacing: .06em; font-size: .82rem; pointer-events: none; }
    body.in-simulazione #area-lavoro { margin-top: 26px; }
    #regia-btn { background: #6d28d9 !important; color: #fff !important; border-color: #6d28d9 !important; }
    .rg-pannello { position: fixed; top: 96px; right: 12px; bottom: 12px; width: 400px; max-width: calc(100vw - 24px); z-index: 4600; background: var(--surface-color); color: var(--text-color);
        border: 2px solid #6d28d9; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.3); display: flex; flex-direction: column; }
    .rg-testa { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border-color); }
    .rg-testa h2 { margin: 0; font-size: 1.05rem; flex: 1; }
    .rg-testa a { font-size: .8rem; }
    .rg-chiudi { border: 0; background: transparent; color: inherit; font-size: 1.5rem; cursor: pointer; }
    .rg-orologio { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: rgba(109, 40, 217, .07); border-bottom: 1px solid var(--border-color); }
    .rg-tempo { font-size: 2rem; font-weight: 800; font-variant-numeric: tabular-nums; color: #6d28d9; min-width: 120px; }
    .rg-stato { font-size: .8rem; color: var(--text-muted); flex: 1; }
    .rg-prossimo { padding: 8px 14px; font-size: .88rem; border-bottom: 1px solid var(--border-color); }
    .rg-corpo { flex: 1; overflow-y: auto; padding: 8px 12px 14px; }
    .rg-corpo h3 { font-size: .74rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); margin: 12px 0 6px; }
    .rg-ev { border: 1px solid var(--border-color); border-left: 5px solid var(--rg-colore, #6d28d9); border-radius: 8px; padding: 7px 9px; margin-bottom: 6px; font-size: .86rem; }
    .rg-ev.uscito { opacity: .7; }
    .rg-ev.telefona { opacity: 1; border-color: #c2410c; background: rgba(194, 65, 12, .07); }
    .rg-ev .rg-riga { display: flex; gap: 8px; align-items: baseline; }
    .rg-ev .rg-quando { font-weight: 800; min-width: 44px; color: var(--rg-colore); font-variant-numeric: tabular-nums; }
    .rg-ev .rg-titolo { font-weight: 700; flex: 1; }
    .rg-ev .rg-det { color: var(--text-muted); font-size: .8rem; margin-top: 2px; white-space: pre-line; }
    .rg-ev .rg-azioni { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; }
    .rg-pannello button.rg-b { font: inherit; font-size: .78rem; font-weight: 700; padding: 4px 9px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-color); cursor: pointer; }
    .rg-pannello button.rg-b.primario { background: #6d28d9; color: #fff; border-color: transparent; }
    .rg-pannello button.rg-b.grande { font-size: .95rem; padding: 8px 14px; }
    .rg-pill { font-size: .7rem; font-weight: 700; padding: 1px 7px; border-radius: 10px; background: var(--secondary-bg-color); }
    .rg-modulo { display: flex; flex-direction: column; gap: 6px; border: 1px dashed var(--border-color); border-radius: 8px; padding: 8px; }
    .rg-modulo input, .rg-modulo textarea, .rg-modulo select { width: 100%; box-sizing: border-box; margin: 0; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); font: inherit; font-size: .85rem; }
    .rg-oss { font-size: .82rem; border-left: 3px solid #a78bfa; padding: 3px 8px; margin-bottom: 5px; }
    .rg-oss small { color: var(--text-muted); display: block; }
    .rg-avviso-reale { background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; border-radius: 8px; padding: 8px 10px; margin: 8px 0; font-size: .9rem; }
    .rg-pannello [hidden] { display: none !important; }
    /* Gli avvisi a comparsa non finiscono sotto il pannello. */
    body.regia-aperta #contenitore-avvisi { right: 424px; }
    `;
    const COLORI = { segnalazione: '#c2410c', aggravamento: '#b91c1c', comunicazione: '#1d4ed8', imprevisto: '#a16207', strada: '#6d28d9', pericolo: '#be123c' };
    const NOMI = { segnalazione: 'Segnalazione', aggravamento: 'Aggravamento', comunicazione: 'Comunicazione', imprevisto: 'Imprevisto', strada: 'Strada chiusa', pericolo: 'Zona di pericolo' };

    const el = (tag, classe, testo) => {
        const e = document.createElement(tag);
        if (classe) e.className = classe;
        if (testo !== undefined && testo !== null) e.textContent = testo;
        return e;
    };
    const bottone = (testo, classe, azione) => {
        const b = el('button', `rg-b ${classe || ''}`, testo);
        b.type = 'button';
        b.addEventListener('click', azione);
        return b;
    };
    const minuti = (m) => {
        if (m === null || m === undefined) return 'a mano';
        const h = Math.floor(m / 60), r = Math.round(m % 60);
        return h ? `${h}:${String(r).padStart(2, '0')}` : `${r}'`;
    };
    const tempo = (m) => {
        const s = Math.max(0, Math.floor(m * 60));
        const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
        return `${h ? `${h}:` : ''}${String(mm).padStart(h ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
    };
    const data = (v) => new Date(String(v).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));

    let emergenza = null;
    let regia = null;          // GET /api/regia
    let letto = 0;             // quando è stata letta (per l'orologio che corre)
    let pannello = null;
    let ticchettio = null;
    let improvvisa = false;
    // Quello che si sta scrivendo nei moduli resta anche quando il pannello si ridisegna.
    const VUOTA = () => ({ tipo: 'comunicazione', titolo: '', testo: '', squadra: '', indirizzo: '', lat: null, lng: null });
    let bozza = VUOTA();
    let bozzaOss = '';
    let segnaposto = null;

    // --- Le comunicazioni alla sala ---------------------------------------------------
    // Escono dal copione e restano in primo piano finché chi è davanti allo
    // schermo non le segna lette (il browser ricorda quali).
    const CHIAVE_LETTE = 'orion.comunicazioniLette';
    const lette = () => { try { return new Set(JSON.parse(localStorage.getItem(CHIAVE_LETTE) || '[]')); } catch { return new Set(); } };
    function segnaLetta(chiave) {
        const s = lette();
        s.add(chiave);
        try { localStorage.setItem(CHIAVE_LETTE, JSON.stringify([...s].slice(-200))); } catch { /* niente */ }
    }
    function mostraComunicazione(c) {
        if (!emergenza?.simulazione || c.emergency_id && c.emergency_id !== emergenza.id) return;
        const chiave = `${emergenza.id}:${c.evento_id}`;
        if (lette().has(chiave) || document.querySelector(`.com-sala[data-chiave="${chiave}"]`)) return;
        let pila = document.getElementById('comunicazioni-sala');
        if (!pila) {
            pila = el('div', '');
            pila.id = 'comunicazioni-sala';
            pila.setAttribute('aria-live', 'assertive');
            document.body.appendChild(pila);
        }
        const card = el('div', 'com-sala');
        card.dataset.chiave = chiave;
        card.setAttribute('role', 'alert');
        const testa = el('div', 'com-testa');
        const icona = el('i', 'fas fa-envelope-open-text');
        const ora = c.ora || c.uscito_il;
        testa.append(icona, ` Comunicazione alla sala${ora ? ` · ${data(ora).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : ''}`);
        card.append(testa, el('h3', '', c.titolo));
        if (c.testo) card.appendChild(el('p', '', c.testo));
        const az = el('div', 'com-azioni');
        az.appendChild(bottone('Letta', 'primario', () => { segnaLetta(chiave); card.remove(); }));
        card.appendChild(az);
        pila.appendChild(card);
    }
    async function comunicazioniPerse() {
        if (!emergenza?.simulazione) { document.getElementById('comunicazioni-sala')?.replaceChildren(); return; }
        try {
            for (const c of await fetchApi('/api/regia/comunicazioni')) mostraComunicazione({ ...c, emergency_id: emergenza.id });
        } catch { /* le vedrà alla prossima */ }
    }
    document.addEventListener('ws:comunicazione_sala', (e) => mostraComunicazione(e.detail || {}));

    // --- La fascia e i pulsanti ----------------------------------------------------
    function fascia() {
        const sim = emergenza?.simulazione === true;
        document.body.classList.toggle('in-simulazione', sim);
        let f = document.getElementById('fascia-simulazione');
        if (sim && !f) {
            f = el('div', '');
            f.id = 'fascia-simulazione';
            f.setAttribute('role', 'status');
            document.body.appendChild(f);
        }
        if (f) {
            f.hidden = !sim;
            f.textContent = sim ? `SIMULAZIONE · ${emergenza.name || emergenza.code} · non è un'emergenza reale` : '';
        }
        const stato = document.getElementById('emergency-status-display');
        // Chiusa la simulazione, via il suo vestito: lo stato torna come lo disegna il centro operativo.
        if (!sim && stato?.dataset.simulazione) {
            stato.style.background = stato.style.color = stato.style.border = '';
            delete stato.dataset.simulazione;
        }
        if (sim && stato) {
            stato.dataset.simulazione = '1';
            stato.textContent = '';
            stato.append('Simulazione: ', el('strong', '', emergenza.code));
            stato.style.background = 'repeating-linear-gradient(45deg, #ede9fe, #ede9fe 8px, #ddd6fe 8px, #ddd6fe 16px)';
            stato.style.color = '#5b21b6';
            stato.style.border = '1px solid #6d28d9';
        }
        // Chi apre le emergenze: "Emergenza reale" ferma la simulazione.
        const apri = document.getElementById('open-emergency-btn');
        if (apri) {
            if (sim && haPermesso('emergenze.apertura')) {
                apri.style.display = 'inline-block';
                apri.textContent = 'Emergenza reale';
                apri.classList.add('btn-pericolo');
                apri.title = "Apre un'emergenza vera: la simulazione si ferma, le squadre restano.";
            } else {
                apri.textContent = 'Apri emergenza';
                apri.classList.remove('btn-pericolo');
                apri.title = '';
            }
        }
        const avviso = document.getElementById('avviso-simulazione-in-corso');
        if (avviso) avviso.hidden = !sim;
        const chiudi = document.getElementById('close-emergency-btn');
        if (chiudi && sim) {
            chiudi.textContent = 'Chiudi la simulazione';
            if (regia) chiudi.style.display = 'inline-block';
        } else if (chiudi) chiudi.textContent = 'Chiudi emergenza';
        const btn = document.getElementById('regia-btn');
        if (btn) btn.hidden = !(sim && regia);
        // Senza emergenza aperta, chi apre le emergenze o organizza le attività apre una simulazione al volo.
        const alVolo = document.getElementById('simulazione-btn');
        if (alVolo) {
            const esterno = typeof ruoliUtente === 'function' && ruoliUtente().includes('esterno');
            alVolo.hidden = !!emergenza || esterno || !(haPermesso('emergenze.apertura') || haPermesso('gruppo.attivita'));
        }
    }

    // --- La simulazione al volo ------------------------------------------------------
    // Senza passare dal calendario: un addestramento (o un'esercitazione) che
    // comincia adesso, con chi lo apre nella regia, il copione di uno scenario
    // preparato (pagina Simulazioni) o di una vecchia simulazione se si vuole,
    // e la sala aperta subito.
    async function apriAlVolo() {
        const velo = el('div', 'sv-velo');
        const f = el('form', 'sv-finestra');
        f.setAttribute('role', 'dialog');
        f.setAttribute('aria-modal', 'true');
        f.appendChild(el('h2', '', 'Apri una simulazione'));
        f.appendChild(el('p', 'sv-nota', "Si apre subito, come un'emergenza con la scritta SIMULAZIONE, e la conduci tu: trovi la regia nel pulsante viola. Per avere i volontari usa poi la chiamata. Le presenze vanno a un'attività che ORION crea adesso nel calendario."));
        const campo = (etichetta, input) => { const l = el('label', '', etichetta); l.appendChild(input); return l; };
        const scelte = el('div', 'sv-scelte');
        for (const [v, t] of [['addestramento', 'Addestramento'], ['esercitazione', 'Esercitazione']]) {
            const l = el('label');
            const r = document.createElement('input');
            r.type = 'radio'; r.name = 'sv-natura'; r.value = v; r.checked = v === 'addestramento';
            l.append(r, ` ${t}`);
            scelte.appendChild(l);
        }
        const titolo = el('input'); titolo.maxLength = 200; titolo.placeholder = "Lascia vuoto per \"Addestramento del\" e la data";
        const ore = el('select');
        for (const h of [1, 2, 3, 4, 6, 8, 12]) ore.appendChild(new Option(h === 1 ? '1 ora' : `${h} ore`, h));
        ore.value = '3';
        const copione = el('select');
        copione.appendChild(new Option('Nessuno: gli eventi li invento sul momento', ''));
        const scenario = el('textarea'); scenario.rows = 2; scenario.maxLength = 4000;
        scenario.placeholder = 'Due righe per chi partecipa: per esempio piena del torrente, allagamenti in zona industriale.';
        const tipo = el('div'); tipo.appendChild(el('strong', '', 'Che cos\'è')); tipo.appendChild(scelte);
        tipo.style.marginTop = '6px';
        f.append(tipo, campo('Titolo', titolo), campo('Quanto dura, più o meno', ore),
            campo('Parti dal copione di', copione), campo('Scenario (facoltativo)', scenario));
        const azioni = el('div', 'sv-azioni');
        const chiudi = () => velo.remove();
        const annulla = el('button', 'button-style button-secondary', 'Annulla');
        annulla.type = 'button';
        annulla.addEventListener('click', chiudi);
        const apri = el('button', 'button-style sv-apri', 'Apri la simulazione');
        apri.type = 'submit';
        azioni.append(annulla, apri);
        f.appendChild(azioni);
        velo.appendChild(f);
        velo.addEventListener('click', (e) => { if (e.target === velo) chiudi(); });
        document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { chiudi(); document.removeEventListener('keydown', esc); } });
        document.body.appendChild(velo);
        titolo.focus();
        // Le scelte: "s:N" uno scenario, "a:N" il copione di un'attività.
        const eventi = (n) => `${n} ${n === 1 ? 'evento' : 'eventi'}`;
        const scenariPronti = new Map();
        const [scenari, copioni] = await Promise.all([
            fetchApi('/api/simulazioni/scenari').catch(() => []),
            fetchApi('/api/simulazioni/copioni').catch(() => [])
        ]);
        if (scenari.length) {
            const g = document.createElement('optgroup'); g.label = 'Scenari preparati';
            for (const s of scenari) { scenariPronti.set(`s:${s.id}`, s); g.appendChild(new Option(`${s.titolo} (${eventi(s.eventi)})`, `s:${s.id}`)); }
            copione.appendChild(g);
        }
        if (copioni.length) {
            const g = document.createElement('optgroup'); g.label = 'Simulazioni già fatte';
            for (const c of copioni) g.appendChild(new Option(`${data(c.inizio).toLocaleDateString('it-IT')} · ${c.titolo} (${eventi(c.eventi)})`, `a:${c.id}`));
            copione.appendChild(g);
        }
        // Uno scenario porta con sé natura, durata e testo, se non sono già scritti.
        copione.addEventListener('change', () => {
            const s = scenariPronti.get(copione.value);
            if (!s) return;
            f.querySelector(`input[name="sv-natura"][value="${s.natura}"]`).checked = true;
            const h = String(Math.min(s.durata_ore, 24));
            if (![...ore.options].some(o => o.value === h)) ore.appendChild(new Option(`${h} ore`, h));
            ore.value = h;
            if (!titolo.value.trim()) titolo.value = s.titolo;
            if (!scenario.value.trim()) scenario.value = s.scenario || '';
        });
        f.addEventListener('submit', async (e) => {
            e.preventDefault();
            apri.disabled = true;
            try {
                const r = await fetchApi('/api/simulazioni/al-volo', { method: 'POST', body: JSON.stringify({
                    natura: f.querySelector('input[name="sv-natura"]:checked')?.value,
                    titolo: titolo.value, ore: Number(ore.value), scenario: scenario.value,
                    copia_da: copione.value.startsWith('a:') ? Number(copione.value.slice(2)) : null,
                    copia_scenario: copione.value.startsWith('s:') ? Number(copione.value.slice(2)) : null
                }) });
                chiudi();
                notifica(`Simulazione ${r.emergency?.code || ''} aperta${r.copiati ? `, con ${r.copiati} eventi nel copione` : ''}: avvia lo scenario dalla regia quando la sala è pronta.`, 'successo');
            } catch (err) {
                notifica(err.message, 'errore');
                apri.disabled = false;
            }
        });
    }

    // --- La regia -----------------------------------------------------------------------
    async function carica() {
        if (!emergenza?.simulazione || (typeof ruoliUtente === 'function' && ruoliUtente().includes('esterno'))) {
            regia = null;
            fascia();
            chiudiPannello();
            return;
        }
        try {
            regia = await fetchApi('/api/regia');
            letto = Date.now();
        } catch {
            regia = null;
        }
        fascia();
        if (!pannello) return;
        // Chi sta scrivendo in un modulo del pannello non perde il cursore: il
        // ridisegno aspetta che esca dal campo, intanto corre solo l'orologio.
        const attivo = document.activeElement;
        if (attivo && pannello.contains(attivo) && /^(INPUT|TEXTAREA|SELECT)$/.test(attivo.tagName)) {
            aggiornaOrologio();
            if (!ridisegnoRinviato) {
                ridisegnoRinviato = true;
                pannello.addEventListener('focusout', () => {
                    setTimeout(() => {
                        if (pannello && !pannello.contains(document.activeElement)) { ridisegnoRinviato = false; disegna(); }
                        else ridisegnoRinviato = false;
                    }, 200);
                }, { once: true });
            }
            return;
        }
        disegna();
    }
    let ridisegnoRinviato = false;

    const trascorsi = () => {
        const o = regia?.orologio;
        if (!o) return null;
        return o.in_pausa ? o.trascorsi : o.trascorsi + (Date.now() - letto) / 60000;
    };

    async function azione(url, corpo = {}, messaggio = null) {
        try {
            const r = await fetchApi(url, { method: 'POST', body: JSON.stringify(corpo) });
            if (messaggio) notifica(messaggio, 'successo');
            await carica();
            return r;
        } catch (e) {
            notifica(e.message, 'errore');
            return null;
        }
    }

    function chiudiPannello() {
        pannello?.remove();
        pannello = null;
        clearInterval(ticchettio);
        document.body.classList.remove('regia-aperta');
    }

    function apriPannello() {
        if (pannello) return chiudiPannello();
        pannello = el('aside', 'rg-pannello');
        pannello.setAttribute('aria-label', 'Regia della simulazione');
        document.body.appendChild(pannello);
        document.body.classList.add('regia-aperta');
        disegna();
        ticchettio = setInterval(aggiornaOrologio, 1000);
    }

    function aggiornaOrologio() {
        const t = pannello?.querySelector('.rg-tempo');
        if (!t || !regia) return;
        const m = trascorsi();
        t.textContent = m === null ? '--:--' : tempo(m);
        const p = pannello.querySelector('.rg-prossimo');
        const prossimo = regia.eventi.filter(e => e.stato === 'atteso' && e.previsto !== null).sort((a, b) => a.previsto - b.previsto)[0];
        if (p) {
            p.textContent = !regia.orologio ? 'Quando la sala è pronta, avvia lo scenario: gli eventi a tempo partono da lì.'
                : !prossimo ? 'Nessun altro evento a tempo.'
                : prossimo.previsto - m > 0 ? `Prossimo: "${prossimo.titolo}" fra ${tempo(prossimo.previsto - m)}`
                : `Esce adesso: "${prossimo.titolo}"`;
        }
        // Il server lo fa uscire allo zero e lo dice; se la notizia tarda, si rilegge.
        if (prossimo && !regia.orologio?.in_pausa && m - prossimo.previsto > 0.05 && Date.now() - letto > 3000) carica();
    }

    function disegna() {
        if (!pannello || !regia) return;
        pannello.replaceChildren();
        const testa = el('div', 'rg-testa');
        testa.appendChild(el('h2', '', 'Regia'));
        const link = el('a', '', 'Copione');
        link.href = `/copione.html?attivita=${regia.attivita.id}`;
        link.target = '_blank';
        link.rel = 'noopener';
        testa.append(link, bottone('×', 'rg-chiudi', chiudiPannello));
        pannello.appendChild(testa);

        const or = el('div', 'rg-orologio');
        or.appendChild(el('span', 'rg-tempo', '--:--'));
        const o = regia.orologio;
        or.appendChild(el('span', 'rg-stato', !o ? 'Scenario non avviato' : o.in_pausa ? 'In pausa: gli eventi a tempo aspettano' : 'Scenario in corso'));
        if (!o) or.appendChild(bottone('Avvia lo scenario', 'primario grande', () => azione('/api/regia/avvia', {}, 'Scenario avviato.')));
        else if (o.in_pausa) or.appendChild(bottone('Riprendi', 'primario', () => azione('/api/regia/pausa', { pausa: false })));
        else or.appendChild(bottone('Pausa', '', () => azione('/api/regia/pausa', { pausa: true })));
        pannello.appendChild(or);
        pannello.appendChild(el('div', 'rg-prossimo', ''));

        const corpo = el('div', 'rg-corpo');
        const eventi = regia.eventi;
        const telefonare = eventi.filter(e => e.tipo === 'segnalazione' && e.modo === 'telefono' && e.stato === 'uscito' && !e.report);
        if (telefonare.length) {
            corpo.appendChild(el('h3', '', 'Da telefonare alla sala'));
            for (const e of telefonare) corpo.appendChild(riga(e, true));
        }
        const attesi = eventi.filter(e => e.stato === 'atteso');
        corpo.appendChild(el('h3', '', `Da far uscire (${attesi.length})`));
        if (!attesi.length) corpo.appendChild(el('p', 'rg-det', 'Tutti gli eventi del copione sono usciti o saltati.'));
        for (const e of attesi.sort((a, b) => (a.previsto ?? 1e9) - (b.previsto ?? 1e9))) corpo.appendChild(riga(e));

        corpo.appendChild(el('h3', '', 'Un evento al momento'));
        corpo.appendChild(moduloImprovvisa());

        corpo.appendChild(el('h3', '', 'Osservazioni'));
        corpo.appendChild(moduloOsservazione());
        for (const o2 of regia.osservazioni.slice(0, 10)) {
            const d = el('div', 'rg-oss', o2.testo);
            d.appendChild(el('small', '', `${data(o2.creata_il).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · ${o2.autore_nome || ''}`));
            corpo.appendChild(d);
        }

        const usciti = eventi.filter(e => e.stato !== 'atteso' && !telefonare.includes(e));
        if (usciti.length) {
            corpo.appendChild(el('h3', '', `Già usciti (${usciti.length})`));
            for (const e of usciti.sort((a, b) => data(b.uscito_il || 0) - data(a.uscito_il || 0))) corpo.appendChild(riga(e));
        }
        pannello.appendChild(corpo);
        aggiornaOrologio();
    }

    function riga(e, telefona = false) {
        const d = el('div', `rg-ev${e.stato !== 'atteso' ? ' uscito' : ''}${telefona ? ' telefona' : ''}`);
        d.style.setProperty('--rg-colore', COLORI[e.tipo]);
        const r = el('div', 'rg-riga');
        r.append(el('span', 'rg-quando', e.stato === 'atteso' ? minuti(e.previsto) : e.stato === 'saltato' ? 'saltato' : data(e.uscito_il).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })),
            el('span', 'rg-titolo', e.titolo), el('span', 'rg-pill', NOMI[e.tipo]));
        d.appendChild(r);
        const det = [];
        if (telefona) {
            det.push(`Leggi alla sala: ${e.testo || e.titolo}`);
            if (e.indirizzo) det.push(`Dove: ${e.indirizzo}`);
            if (e.segnalante) det.push(`Chi chiama: ${e.segnalante}${e.telefono ? ` (${e.telefono})` : ''}`);
        } else if (e.stato === 'atteso') {
            if (e.tipo === 'imprevisto') det.push(`Alla squadra ${e.squadra}`);
            // La comunicazione si legge già qui: la regia sa cosa sta per arrivare alla sala.
            if (e.tipo === 'comunicazione' && e.testo) det.push(`Dirà: ${e.testo}`);
            if (e.indirizzo) det.push(e.indirizzo);
            if (e.modo === 'telefono') det.push('Per telefono: quando esce, la telefoni tu');
        } else {
            if (e.report) det.push(`Segnalazione n. ${e.report.numero}`);
            if (e.nota_esito) det.push(e.nota_esito);
        }
        if (e.risposta_attesa && e.stato === 'atteso') det.push(`Atteso: ${e.risposta_attesa}${e.minuti_attesi ? ` (entro ${e.minuti_attesi}')` : ''}`);
        if (det.length) d.appendChild(el('div', 'rg-det', det.join('\n')));
        const az = el('div', 'rg-azioni');
        if (e.stato === 'atteso') {
            az.appendChild(bottone('Fai uscire ora', 'primario', () => azione(`/api/regia/eventi/${e.id}/esci`, {}, `Uscito: ${e.titolo}`)));
            if (e.minuto !== null) az.appendChild(bottone("+5'", '', () => azione(`/api/regia/eventi/${e.id}/rimanda`, { minuti: 5 })));
            az.appendChild(bottone('Salta', '', () => { if (confirm(`Saltare "${e.titolo}"? Non uscirà più.`)) azione(`/api/regia/eventi/${e.id}/salta`); }));
        }
        if (telefona) az.appendChild(bottone("Collega alla segnalazione inserita", 'primario', () => collega(e, d)));
        if (az.children.length) d.appendChild(az);
        return d;
    }

    // La sala ha inserito la segnalazione telefonata: si sceglie quale.
    async function collega(e, dove) {
        let elenco = [];
        try { elenco = (await fetchApi(`/api/reports?limit=100&status_type=all&emergency_id=${emergenza.id}`)).reports || []; } catch (err) { return notifica(err.message, 'errore'); }
        const gia = new Set(regia.eventi.map(x => x.report?.id).filter(Boolean));
        const liberi = elenco.filter(r => !gia.has(r.id));
        if (!liberi.length) return notifica('La sala non ha ancora inserito segnalazioni da collegare.', 'attenzione');
        const scelta = el('select');
        for (const r of liberi) scelta.appendChild(new Option(`n. ${r.emergency_report_number}: ${r.title}`, r.id));
        const box = el('div', 'rg-modulo');
        box.append(scelta, bottone('Collega', 'primario', () => azione(`/api/regia/eventi/${e.id}/collega`, { report_id: Number(scelta.value) }, 'Collegata: i tempi si misurano da qui.')));
        dove.appendChild(box);
    }

    function moduloImprovvisa() {
        const box = el('div', 'rg-modulo');
        if (!improvvisa) {
            box.appendChild(bottone('+ Invento un evento adesso', '', () => { improvvisa = true; disegna(); }));
            return box;
        }
        const tipo = el('select');
        for (const [k, v] of [['comunicazione', 'Comunicazione alla sala'], ['segnalazione', 'Segnalazione (entra da sola)'], ['imprevisto', 'Imprevisto a una squadra']]) tipo.appendChild(new Option(v, k));
        tipo.value = bozza.tipo;
        const titolo = el('input'); titolo.placeholder = 'Titolo'; titolo.maxLength = 200; titolo.value = bozza.titolo;
        const testo = el('textarea'); testo.placeholder = 'Testo'; testo.rows = 2; testo.value = bozza.testo;
        const squadra = el('input'); squadra.placeholder = 'Squadra (nome radio)'; squadra.value = bozza.squadra;
        titolo.addEventListener('input', () => { bozza.titolo = titolo.value; });
        testo.addEventListener('input', () => { bozza.testo = testo.value; });
        squadra.addEventListener('input', () => { bozza.squadra = squadra.value; });

        // Dove: per la segnalazione, un indirizzo da cercare o un punto toccato sulla mappa.
        const dove = el('div', 'rg-dove');
        const indirizzo = el('input'); indirizzo.placeholder = 'Indirizzo (facoltativo)'; indirizzo.maxLength = 200; indirizzo.value = bozza.indirizzo;
        indirizzo.addEventListener('input', () => { bozza.indirizzo = indirizzo.value; });
        const punto = el('div', 'rg-det', '');
        const scriviPunto = () => {
            punto.textContent = bozza.lat !== null ? `Punto sulla mappa: ${bozza.lat.toFixed(5)}, ${bozza.lng.toFixed(5)}` : 'Senza punto entra in sala senza posizione.';
        };
        const metti = (lat, lng) => {
            bozza.lat = lat; bozza.lng = lng;
            mostraSegnaposto();
            scriviPunto();
        };
        const cerca = bottone('Trova', '', async () => {
            if (!indirizzo.value.trim()) return;
            try {
                const { cercaIndirizzi } = await import('/js/mappa-strumenti.js');
                const m = window.mappaCentroOperativo;
                const trovati = await cercaIndirizzi(indirizzo.value, m ? { centro: m.getCenter(), limiti: m.getBounds() } : {});
                if (!trovati?.length) return notifica('Indirizzo non trovato: tocca il punto sulla mappa.', 'attenzione');
                const t = trovati[0];
                metti(Number(t.lat), Number(t.lng));
                m?.setView([bozza.lat, bozza.lng], Math.max(m.getZoom(), 16));
            } catch {
                notifica('Il servizio degli indirizzi non risponde: tocca il punto sulla mappa.', 'attenzione');
            }
        });
        const sullaMappa = bottone('Sulla mappa', '', () => {
            const m = window.mappaCentroOperativo;
            if (!m) return;
            notifica("Tocca la mappa nel punto dell'evento.", 'info');
            m.getContainer().style.cursor = 'crosshair';
            m.once('click', (e) => {
                m.getContainer().style.cursor = '';
                metti(e.latlng.lat, e.latlng.lng);
            });
        });
        const riga = el('div', 'rg-azioni');
        riga.append(cerca, sullaMappa);
        dove.append(indirizzo, riga, punto);
        scriviPunto();

        const aggiornaCampi = () => {
            bozza.tipo = tipo.value;
            squadra.hidden = tipo.value !== 'imprevisto';
            dove.hidden = tipo.value !== 'segnalazione';
            mostraSegnaposto();
        };
        tipo.addEventListener('change', aggiornaCampi);
        aggiornaCampi();
        box.append(tipo, titolo, testo, squadra, dove, el('div', 'rg-azioni'));
        box.lastChild.append(
            bottone('Fai uscire', 'primario', async () => {
                const corpo = { tipo: bozza.tipo, titolo: bozza.titolo, testo: bozza.testo, squadra: bozza.squadra };
                if (bozza.tipo === 'segnalazione') Object.assign(corpo, { indirizzo: bozza.indirizzo, lat: bozza.lat, lng: bozza.lng });
                const r = await azione('/api/regia/improvvisa', corpo, 'Evento uscito.');
                if (r) { improvvisa = false; bozza = VUOTA(); mostraSegnaposto(); disegna(); }
            }),
            bottone('Annulla', '', () => { improvvisa = false; bozza = VUOTA(); mostraSegnaposto(); disegna(); }));
        return box;
    }

    // Il punto dell'evento improvvisato sulla mappa della sala, finché non esce.
    function mostraSegnaposto() {
        const m = window.mappaCentroOperativo;
        segnaposto?.remove();
        segnaposto = null;
        if (!m || !improvvisa || bozza.tipo !== 'segnalazione' || bozza.lat === null || typeof L === 'undefined') return;
        segnaposto = L.circleMarker([bozza.lat, bozza.lng], { radius: 9, color: '#6d28d9', weight: 3, fillColor: '#a78bfa', fillOpacity: .7 })
            .bindTooltip('Evento della regia', { permanent: false }).addTo(m);
    }

    function moduloOsservazione() {
        const box = el('div', 'rg-modulo');
        const testo = el('textarea');
        testo.rows = 2;
        testo.placeholder = 'Cosa hai visto: "la sala non ha richiamato il segnalante"...';
        testo.value = bozzaOss;
        testo.addEventListener('input', () => { bozzaOss = testo.value; });
        const su = el('select');
        su.appendChild(new Option('(in generale)', ''));
        for (const e of regia.eventi.filter(x => x.stato === 'uscito')) su.appendChild(new Option(e.titolo, e.id));
        box.append(testo, su, bottone('Annota', 'primario', async () => {
            if (!testo.value.trim()) return;
            try {
                await fetchApi(`/api/attivita/${regia.attivita.id}/osservazioni`, { method: 'POST', body: JSON.stringify({ testo: testo.value, evento_id: su.value ? Number(su.value) : null }) });
                notifica('Osservazione annotata.', 'successo');
                bozzaOss = '';
                await carica();
            } catch (e) { notifica(e.message, 'errore'); }
        }));
        return box;
    }

    // --- Avvio -------------------------------------------------------------------------------
    const stile = document.createElement('style');
    stile.textContent = STILE;
    document.head.appendChild(stile);
    document.getElementById('regia-btn')?.addEventListener('click', apriPannello);
    document.getElementById('simulazione-btn')?.addEventListener('click', apriAlVolo);
    document.addEventListener('ws:regia_aggiorna', () => { if (regia) carica(); });
    document.addEventListener('ws:reload_reports', () => { if (pannello) carica(); });
    setInterval(() => { if (regia) carica(); }, 20000);

    window.Regia = {
        emergenza(nuova) {
            const cambiata = (nuova?.id || null) !== (emergenza?.id || null);
            emergenza = nuova || null;
            if (cambiata) { chiudiPannello(); regia = null; carica(); comunicazioniPerse(); } else fascia();
        },
        apriPannello
    };
})();
