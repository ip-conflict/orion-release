// Le funzioni di supporto nel centro operativo:
//   - nel dettaglio di una segnalazione, gli incarichi alle funzioni, con
//     "Assegna a una funzione" (motivazione), "Prendo in carico", "Concludi"
//     (esito) e "Nota per la funzione";
//   - sulle schede dell'elenco, le sigle delle funzioni al lavoro;
//   - il pannello "Funzioni" dell'intestazione: il tavolo di ogni funzione,
//     con i suoi incarichi e i suoi membri.
// Con il modulo spento non compare niente: Funzioni.attivo resta false.
//
// Il centro operativo chiama Funzioni.inizia(), Funzioni.montaIncarichi(),
// Funzioni.etichette() e Funzioni.notaPer(); per aprire una segnalazione
// questo file manda l'evento "orion:apri-segnalazione".

(function () {
    const STATO = { aperto: 'Aperto', in_corso: 'In corso', concluso: 'Concluso' };

    const STILE = `
    .fz-tag { display: inline-flex; align-items: center; gap: 3px; font-size: 0.68rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--info-text, #1d4ed8); color: var(--info-text, #1d4ed8); letter-spacing: .02em; }
    .fz-tag.concluso { opacity: .55; border-style: dashed; }
    .fz-tag.concluso::after { content: '✓'; font-weight: 700; }
    .fz-sezione { border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-color); margin-bottom: 10px; font-size: 0.8rem; }
    .fz-sez-testa { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--border-light-color, var(--border-color)); }
    .fz-sez-testa strong { flex: 1; font-size: 0.75rem; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); }
    .fz-sez-corpo { max-height: 230px; overflow-y: auto; }
    .fz-inc { padding: 8px 10px; border-bottom: 1px solid var(--border-light-color, var(--border-color)); }
    .fz-inc:last-child { border-bottom: 0; }
    .fz-inc-testa { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .fz-inc-testa .fz-nome-f { font-weight: 700; flex: 1; min-width: 120px; }
    .fz-stato { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; }
    .fz-stato.aperto { background: var(--danger-soft-bg, #fee2e2); color: var(--danger-text, #b91c1c); }
    .fz-stato.in_corso { background: var(--warning-soft-bg, #fef3c7); color: var(--warning-text, #92400e); }
    .fz-stato.concluso { background: var(--success-soft-bg, #dcfce7); color: var(--success-text, #166534); }
    .fz-motivo { margin: 4px 0 2px; line-height: 1.35; }
    .fz-esito { margin: 4px 0 2px; padding: 4px 8px; border-left: 3px solid var(--success-text, #166534); line-height: 1.35; }
    .fz-meta { color: var(--text-muted); font-size: 0.72rem; }
    .fz-azioni { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .fz-azioni button, .fz-sez-testa button, .fz-modulo-inc button { font: inherit; font-size: 0.75rem; font-weight: 600; padding: 4px 9px; border-radius: 5px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-color); cursor: pointer; }
    .fz-azioni button.fz-primario, .fz-modulo-inc button.fz-primario { background: var(--button-bg); color: var(--button-text); border-color: transparent; }
    .fz-azioni button.fz-pericolo { color: var(--danger-text, #b91c1c); }
    .fz-modulo-inc { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
    .fz-scelte { display: flex; gap: 5px; flex-wrap: wrap; }
    .fz-scelte button { min-width: 38px; }
    .fz-scelte button[aria-pressed="true"] { background: var(--button-bg); color: var(--button-text); border-color: transparent; }
    .fz-modulo-inc textarea { width: 100%; box-sizing: border-box; margin: 0; padding: 6px 8px; border-radius: 5px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-color); font: inherit; font-size: 0.8rem; resize: vertical; }
    .fz-modulo-inc .fz-riga { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
    .fz-modulo-inc .fz-riga span { flex: 1; color: var(--text-muted); font-size: 0.72rem; }
    .fz-errore { color: var(--danger-text, #b91c1c); font-size: 0.75rem; }
    .fz-vuoto { color: var(--text-muted); padding: 8px 10px; font-style: italic; }
    .fz-nota-per { display: flex; align-items: center; gap: 6px; padding: 4px 15px; font-size: 0.75rem; background: var(--surface-color); border-top: 1px solid var(--border-color); }
    .fz-nota-per button { border: 0; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 0.9rem; }
    /* Il pannello Funzioni */
    .fzp-velo { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 5000; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 24px 12px; }
    .fzp-finestra { background: var(--surface-color); color: var(--text-color); width: 100%; max-width: 760px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); display: flex; flex-direction: column; max-height: calc(100dvh - 48px); }
    .fzp-testa { display: flex; align-items: center; gap: 10px; padding: 16px 20px 12px; border-bottom: 1px solid var(--border-color); }
    .fzp-testa h2 { margin: 0; font-size: 1.2rem; flex: 1; }
    .fzp-chiudi { border: 0; background: transparent; color: inherit; font-size: 1.6rem; line-height: 1; cursor: pointer; padding: 2px 8px; border-radius: 6px; }
    .fzp-scelte { display: flex; gap: 6px; flex-wrap: wrap; padding: 12px 20px 4px; }
    .fzp-scelte button { font: inherit; font-size: 0.85rem; font-weight: 700; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-color); cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
    .fzp-scelte button[aria-pressed="true"] { background: var(--button-bg); color: var(--button-text); border-color: transparent; }
    .fzp-scelte .fzp-conta { font-weight: 400; font-size: 0.75rem; opacity: .85; }
    .fzp-info { padding: 6px 20px 10px; font-size: 0.85rem; color: var(--text-muted); border-bottom: 1px solid var(--border-color); }
    .fzp-info strong { color: var(--text-color); }
    .fzp-corpo { overflow-y: auto; padding: 4px 20px 18px; }
    .fzp-corpo h3 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); margin: 14px 0 6px; }
    .fzp-inc { border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; font-size: 0.85rem; }
    .fzp-inc .fzp-titolo { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    .fzp-inc .fzp-titolo a { font-weight: 700; color: var(--info-text, #1d4ed8); text-decoration: none; cursor: pointer; }
    .fzp-membri { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .fzp-membro { padding: 3px 9px; border: 1px solid var(--border-color); border-radius: 14px; font-size: 0.8rem; }
    .fzp-membro.referente { border-color: var(--info-text, #1d4ed8); font-weight: 600; }
    .fzp-aggiungi { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .fzp-aggiungi select { flex: 1; min-width: 200px; height: 32px; margin: 0; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color); }
    .fzp-velo [hidden], .fz-sezione [hidden] { display: none !important; }
    `;

    const stato = { attivo: false, funzioni: [], interno: false, notaPer: null };
    const quando = (v) => {
        if (!v) return '';
        const d = new Date(v);
        const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        return d.toDateString() === new Date().toDateString() ? ora : `${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} ${ora}`;
    };
    const daQuanto = (v) => {
        const m = Math.max(0, Math.round((Date.now() - new Date(v)) / 60000));
        return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} g`;
    };

    function el(tag, attributi = {}, ...figli) {
        const e = document.createElement(tag);
        Object.entries(attributi).forEach(([k, v]) => {
            if (k === 'testo') e.textContent = v;
            else if (k.startsWith('su')) e.addEventListener(k.slice(2).toLowerCase(), v);
            else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
        });
        figli.flat().forEach(f => f != null && f !== false && e.append(f));
        return e;
    }

    async function inizia({ interno }) {
        stato.interno = !!interno;
        if (!document.getElementById('fz-stile')) document.head.append(el('style', { id: 'fz-stile', testo: STILE }));
        await ricarica();
        document.addEventListener('ws:reload_funzioni', () => ricarica().then(() => aggiornaAperti()));
        // Un incarico nuovo o concluso cambia anche i conteggi delle funzioni.
        document.addEventListener('ws:reload_incarichi', (ev) => ricarica().then(() => aggiornaAperti(ev.detail?.reportId)));
    }

    async function ricarica() {
        try {
            const dati = await fetchApi('/api/funzioni');
            stato.attivo = !!dati?.attivo;
            stato.funzioni = dati?.funzioni || [];
        } catch {
            // 404 a modulo spento: non c'è niente da mostrare.
            stato.attivo = false;
            stato.funzioni = [];
        }
        const btn = document.getElementById('funzioni-btn');
        if (btn) btn.style.display = stato.attivo && (stato.interno || stato.funzioni.some(f => f.mia)) ? '' : 'none';
        document.dispatchEvent(new CustomEvent('orion:funzioni-pronte', { detail: { attivo: stato.attivo } }));
    }

    // Le sigle sulla scheda dell'elenco: piene finché c'è lavoro, tratteggiate con la spunta a lavoro fatto.
    function etichette(incarichi) {
        if (!stato.attivo || !Array.isArray(incarichi) || !incarichi.length) return '';
        // Una sigla per funzione: "al lavoro" se almeno un suo incarico è ancora aperto.
        const perSigla = new Map();
        incarichi.forEach(i => {
            const prima = perSigla.get(i.sigla);
            if (!prima || prima === 'concluso') perSigla.set(i.sigla, i.stato);
        });
        return [...perSigla].map(([sigla, st]) => `<span class="fz-tag${st === 'concluso' ? ' concluso' : ''}" title="${escapeHTML(STATO[st] || st)}">${escapeHTML(sigla)}</span>`).join(' ');
    }

    // La funzione per conto di cui si sta scrivendo una nota su quella segnalazione.
    function notaPer(reportId) {
        return stato.notaPer && stato.notaPer.reportId === reportId ? stato.notaPer.funzioneId : null;
    }
    function smettiNotaPer() {
        stato.notaPer = null;
        document.querySelector('.fz-nota-per')?.remove();
    }
    function iniziaNotaPer(incarico) {
        smettiNotaPer();
        stato.notaPer = { reportId: incarico.report_id, funzioneId: incarico.funzione_id };
        const form = document.getElementById('bottom-add-update-form');
        const area = document.getElementById('bottom-new-update-text');
        if (!form || !area) return;
        form.before(el('div', { class: 'fz-nota-per' },
            el('span', {}, 'La prossima nota la scrivi per conto della ', el('span', { class: 'fz-tag', testo: incarico.sigla })),
            el('button', { type: 'button', title: 'Scrivi una nota normale', 'aria-label': 'Annulla la nota per la funzione', testo: '×', suClick: smettiNotaPer })));
        area.focus();
    }

    // ---------------------------------------------------------------
    // Nel dettaglio della segnalazione

    let montato = null; // { contenitore, report, modificabile }

    async function montaIncarichi(contenitore, report, { modificabile }) {
        smettiNotaPer();
        montato = { contenitore, report, modificabile };
        if (!stato.attivo) { contenitore.replaceChildren(); return; }
        await disegnaIncarichi();
    }

    async function aggiornaAperti(reportId) {
        if (montato && (!reportId || reportId === montato.report.id) && document.body.contains(montato.contenitore)) {
            await disegnaIncarichi();
        }
        if (pannello) pannello.ridisegna();
    }

    async function disegnaIncarichi() {
        const { contenitore, report, modificabile } = montato;
        let incarichi = [];
        try {
            incarichi = await fetchApi(`/api/reports/${report.id}/incarichi`);
        } catch (e) {
            contenitore.replaceChildren(el('div', { class: 'fz-errore', testo: e.message }));
            return;
        }
        if (montato?.report.id !== report.id) return;
        const puoAssegnare = modificabile && stato.interno;
        if (!incarichi.length && !puoAssegnare) { contenitore.replaceChildren(); return; }

        const corpo = el('div', { class: 'fz-sez-corpo' },
            incarichi.length ? incarichi.map(i => rigaIncarico(i, modificabile)) : el('div', { class: 'fz-vuoto', testo: 'Nessuna funzione coinvolta.' }));
        const modulo = el('div', { class: 'fz-modulo-inc', hidden: true });
        const assegna = puoAssegnare ? el('button', { type: 'button', testo: '+ Assegna a una funzione', suClick: () => {
            modulo.hidden = !modulo.hidden;
            if (!modulo.hidden) moduloAssegna(modulo, report, incarichi);
        } }) : null;
        contenitore.replaceChildren(el('div', { class: 'fz-sezione' },
            el('div', { class: 'fz-sez-testa' }, el('i', { class: 'fas fa-sitemap', 'aria-hidden': 'true' }), el('strong', { testo: 'Funzioni di supporto' }), assegna),
            modulo, corpo));
    }

    function rigaIncarico(i, modificabile) {
        const azioni = el('div', { class: 'fz-azioni' });
        const sotto = el('div');
        if (modificabile && i.posso_agire) {
            if (i.stato === 'aperto') azioni.append(el('button', { type: 'button', class: 'fz-primario', testo: 'Prendo in carico', suClick: () => agisci(`/api/incarichi/${i.id}/presa`, 'POST') }));
            azioni.append(el('button', { type: 'button', class: i.stato === 'in_corso' ? 'fz-primario' : null, testo: 'Concludi', suClick: () => moduloConcludi(sotto, i) }));
            azioni.append(el('button', { type: 'button', testo: `Nota per la ${i.sigla}`, suClick: () => iniziaNotaPer(i) }));
            if (i.stato === 'aperto' && stato.interno) {
                azioni.append(el('button', { type: 'button', class: 'fz-pericolo', testo: 'Annulla', title: 'Assegnato per sbaglio: toglilo', suClick: () => {
                    if (window.confirm(`Annullare l'incarico alla ${i.sigla}?`)) agisci(`/api/incarichi/${i.id}`, 'DELETE');
                } }));
            }
        }
        const meta = [`assegnato da ${i.assegnato_da || '—'} ${quando(i.assegnato_il)}`,
            i.in_carico_da && i.stato !== 'aperto' ? `in carico a ${i.in_carico_da}` : null,
            i.stato === 'concluso' ? `concluso da ${i.concluso_da || '—'} ${quando(i.concluso_il)}` : null].filter(Boolean).join(' · ');
        return el('div', { class: 'fz-inc' },
            el('div', { class: 'fz-inc-testa' },
                el('span', { class: `fz-tag${i.stato === 'concluso' ? ' concluso' : ''}`, testo: i.sigla }),
                el('span', { class: 'fz-nome-f', testo: i.funzione_nome }),
                el('span', { class: `fz-stato ${i.stato}`, testo: STATO[i.stato] || i.stato })),
            el('div', { class: 'fz-motivo', testo: i.motivazione }),
            i.stato === 'concluso' && i.esito ? el('div', { class: 'fz-esito', testo: i.esito }) : null,
            el('div', { class: 'fz-meta', testo: meta }),
            azioni.childNodes.length ? azioni : null,
            sotto);
    }

    function moduloAssegna(modulo, report, incarichi) {
        const occupate = new Set(incarichi.filter(i => i.stato !== 'concluso').map(i => i.funzione_id));
        let scelta = null;
        const errore = el('div', { class: 'fz-errore', hidden: true });
        const referente = el('span');
        const motivazione = el('textarea', { rows: 2, maxlength: 2000, placeholder: 'Perché se ne deve occupare: è quello che leggerà chi prende l\'incarico' });
        const scelte = el('div', { class: 'fz-scelte', role: 'group', 'aria-label': 'Funzione' }, stato.funzioni.map(f => {
            const b = el('button', { type: 'button', 'aria-pressed': 'false', title: f.nome, disabled: occupate.has(f.id), testo: f.sigla, suClick: () => {
                scelta = f;
                scelte.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
                const ref = (f.membri || []).filter(m => m.referente).map(m => [m.nome, m.cognome].filter(Boolean).join(' '));
                referente.textContent = `${f.sigla} ${f.nome}${ref.length ? ` · referente ${ref.join(', ')}` : ''}`;
                motivazione.focus();
            } });
            return b;
        }));
        const invia = el('button', { type: 'button', class: 'fz-primario', testo: 'Assegna', suClick: async () => {
            errore.hidden = true;
            if (!scelta) { errore.textContent = 'Scegli la funzione.'; errore.hidden = false; return; }
            invia.disabled = true;
            try {
                await fetchApi(`/api/reports/${report.id}/incarichi`, { method: 'POST', body: JSON.stringify({ funzione_id: scelta.id, motivazione: motivazione.value }) });
                modulo.hidden = true;
                await disegnaIncarichi();
            } catch (e) {
                errore.textContent = e.message;
                errore.hidden = false;
            } finally {
                invia.disabled = false;
            }
        } });
        modulo.replaceChildren(scelte, motivazione, errore,
            el('div', { class: 'fz-riga' }, referente, el('button', { type: 'button', testo: 'Annulla', suClick: () => { modulo.hidden = true; } }), invia));
    }

    function moduloConcludi(sotto, i) {
        if (sotto.childNodes.length) { sotto.replaceChildren(); return; }
        const esito = el('textarea', { rows: 2, maxlength: 2000, placeholder: `Com'è andata: cosa ha fatto la ${i.sigla}. La segnalazione resta com'è.` });
        const errore = el('div', { class: 'fz-errore', hidden: true });
        const conferma = el('button', { type: 'button', class: 'fz-primario', testo: 'Concludi l\'incarico', suClick: async () => {
            conferma.disabled = true;
            try {
                await fetchApi(`/api/incarichi/${i.id}/concludi`, { method: 'POST', body: JSON.stringify({ esito: esito.value }) });
                await disegnaIncarichi();
            } catch (e) {
                errore.textContent = e.message;
                errore.hidden = false;
                conferma.disabled = false;
            }
        } });
        sotto.replaceChildren(el('div', { class: 'fz-modulo-inc', style: 'padding: 6px 0 0' }, esito, errore,
            el('div', { class: 'fz-riga' }, el('span'), el('button', { type: 'button', testo: 'Annulla', suClick: () => sotto.replaceChildren() }), conferma)));
        esito.focus();
    }

    async function agisci(url, method) {
        try {
            await fetchApi(url, { method });
            if (montato) await disegnaIncarichi();
            if (pannello) pannello.aggiorna();
        } catch (e) {
            notifica(e.message, 'errore');
        }
    }

    // ---------------------------------------------------------------
    // Il pannello "Funzioni": il tavolo di una funzione

    let pannello = null;

    function apriPannello() {
        if (pannello || !stato.attivo) return;
        const visibili = stato.interno ? stato.funzioni : stato.funzioni.filter(f => f.mia);
        if (!visibili.length) return;
        // Si parte dalla propria funzione, se se ne ha una sola; altrimenti dalla prima con lavoro aperto.
        const mie = visibili.filter(f => f.mia);
        let scelta = (mie.length === 1 ? mie[0] : null) || visibili.find(f => f.aperti) || visibili[0];
        let conclusi = false;

        const scelte = el('div', { class: 'fzp-scelte', role: 'group', 'aria-label': 'Funzione' });
        const info = el('div', { class: 'fzp-info' });
        const corpo = el('div', { class: 'fzp-corpo' });
        const chiudi = () => {
            velo.remove();
            document.removeEventListener('keydown', suTasto);
            pannello = null;
        };
        const suTasto = (ev) => { if (ev.key === 'Escape') chiudi(); };
        const velo = el('div', { class: 'fzp-velo', suClick: (ev) => { if (ev.target === velo) chiudi(); } },
            el('div', { class: 'fzp-finestra', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Funzioni di supporto' },
                el('div', { class: 'fzp-testa' }, el('h2', { testo: 'Funzioni di supporto' }),
                    el('button', { type: 'button', class: 'fzp-chiudi', 'aria-label': 'Chiudi', title: 'Chiudi', testo: '×', suClick: chiudi })),
                scelte, info, corpo));
        document.body.append(velo);
        document.addEventListener('keydown', suTasto);

        function disegnaScelte() {
            const elenco = stato.interno ? stato.funzioni : stato.funzioni.filter(f => f.mia);
            scelte.replaceChildren(...elenco.map(f => el('button', {
                type: 'button', 'aria-pressed': String(f.id === scelta.id), title: f.nome,
                suClick: () => { scelta = f; aggiorna(); }
            }, f.sigla, f.aperti ? el('span', { class: 'fzp-conta', testo: `(${f.aperti})` }) : null)));
        }

        async function aggiorna() {
            scelta = stato.funzioni.find(f => f.id === scelta.id) || scelta;
            disegnaScelte();
            const referenti = (scelta.membri || []).filter(m => m.referente).map(m => [m.nome, m.cognome].filter(Boolean).join(' '));
            info.replaceChildren(...[el('strong', { testo: `${scelta.sigla} ${scelta.nome}` }),
                referenti.length ? ` · referente ${referenti.join(', ')}` : ' · nessun referente indicato',
                scelta.descrizione ? el('div', { testo: scelta.descrizione }) : null].filter(Boolean));
            let incarichi = [];
            try {
                incarichi = await fetchApi(`/api/incarichi?funzione=${scelta.id}${conclusi ? '&stato=tutti' : ''}`);
            } catch (e) {
                corpo.replaceChildren(el('p', { class: 'fz-errore', testo: e.message }));
                return;
            }
            const aperti = incarichi.filter(i => i.stato !== 'concluso');
            const fatti = incarichi.filter(i => i.stato === 'concluso');
            corpo.replaceChildren(...[
                el('h3', { testo: `Da fare (${aperti.length})` }),
                aperti.length ? aperti.map(schedaIncarico) : el('p', { class: 'fz-vuoto', testo: 'Nessun incarico aperto.' }),
                conclusi ? el('h3', { testo: `Conclusi (${fatti.length})` }) : null,
                conclusi ? (fatti.length ? fatti.map(schedaIncarico) : el('p', { class: 'fz-vuoto', testo: 'Ancora nessuno.' })) : null,
                el('div', { class: 'fz-azioni' }, el('button', { type: 'button', testo: conclusi ? 'Nascondi i conclusi' : 'Mostra anche i conclusi', suClick: () => { conclusi = !conclusi; aggiorna(); } })),
                sezioneMembri()].flat().filter(Boolean));
        }

        function schedaIncarico(i) {
            const apri = el('a', { href: '#', testo: `#${i.numero ?? i.report_id} ${i.report_titolo}`, suClick: (ev) => {
                ev.preventDefault();
                document.dispatchEvent(new CustomEvent('orion:apri-segnalazione', { detail: { id: i.report_id } }));
                chiudi();
            } });
            const azioni = el('div', { class: 'fz-azioni' });
            const sotto = el('div');
            if (i.stato === 'aperto') azioni.append(el('button', { type: 'button', class: 'fz-primario', testo: 'Prendo in carico', suClick: () => agisci(`/api/incarichi/${i.id}/presa`, 'POST') }));
            if (i.stato !== 'concluso') azioni.append(el('button', { type: 'button', testo: 'Concludi', suClick: () => moduloConcludiPannello(sotto, i) }));
            return el('div', { class: 'fzp-inc' },
                el('div', { class: 'fzp-titolo' }, apri, el('span', { class: `fz-stato ${i.stato}`, testo: STATO[i.stato] || i.stato }),
                    i.stato !== 'concluso' ? el('span', { class: 'fz-meta', testo: `da ${daQuanto(i.assegnato_il)}` }) : null),
                i.location_address ? el('div', { class: 'fz-meta', testo: i.location_address }) : null,
                el('div', { class: 'fz-motivo', testo: i.motivazione }),
                i.esito ? el('div', { class: 'fz-esito', testo: i.esito }) : null,
                el('div', { class: 'fz-meta', testo: [`assegnato da ${i.assegnato_da || '—'} ${quando(i.assegnato_il)}`, i.in_carico_da ? `in carico a ${i.in_carico_da}` : null].filter(Boolean).join(' · ') }),
                azioni.childNodes.length ? azioni : null, sotto);
        }

        function moduloConcludiPannello(sotto, i) {
            if (sotto.childNodes.length) { sotto.replaceChildren(); return; }
            const esito = el('textarea', { rows: 2, maxlength: 2000, placeholder: `Com'è andata. La segnalazione resta com'è.` });
            const errore = el('div', { class: 'fz-errore', hidden: true });
            const conferma = el('button', { type: 'button', class: 'fz-primario', testo: 'Concludi l\'incarico', suClick: async () => {
                try {
                    await fetchApi(`/api/incarichi/${i.id}/concludi`, { method: 'POST', body: JSON.stringify({ esito: esito.value }) });
                    await ricarica();
                    aggiorna();
                } catch (e) { errore.textContent = e.message; errore.hidden = false; }
            } });
            sotto.replaceChildren(el('div', { class: 'fz-modulo-inc', style: 'padding: 6px 0 0' }, esito, errore,
                el('div', { class: 'fz-riga' }, el('span'), el('button', { type: 'button', testo: 'Annulla', suClick: () => sotto.replaceChildren() }), conferma)));
            esito.focus();
        }

        // Chi c'è nella funzione; in emergenza gli operatori aggiungono gli accessi temporanei.
        function sezioneMembri() {
            const blocco = el('div', {}, el('h3', { testo: 'Chi ne fa parte' }),
                el('div', { class: 'fzp-membri' }, (scelta.membri || []).length
                    ? scelta.membri.map(m => el('span', { class: `fzp-membro${m.referente ? ' referente' : ''}`,
                        testo: `${m.referente ? '★ ' : ''}${[m.nome, m.cognome].filter(Boolean).join(' ')}${m.ente ? ` (${m.ente})` : ''}` }))
                    : el('span', { class: 'fz-vuoto', testo: "Nessuno: i membri fissi li indica l'amministratore." })));
            if (stato.interno) aggiuntaTemporanei(blocco);
            return blocco;
        }

        async function aggiuntaTemporanei(blocco) {
            let temporanei = [];
            try { temporanei = await fetchApi('/api/esterni-temporanei'); } catch { return; }
            const giaDentro = new Set((scelta.membri || []).map(m => m.user_id));
            const candidati = temporanei.filter(t => t.attivo && !giaDentro.has(t.id));
            if (!candidati.length) return;
            const scelta2 = el('select', { 'aria-label': 'Accesso temporaneo da aggiungere' },
                el('option', { value: '', testo: 'Aggiungi un accesso temporaneo…' }),
                candidati.map(t => el('option', { value: t.id, testo: `${[t.nome, t.cognome].filter(Boolean).join(' ')}${t.ente ? ` (${t.ente})` : ''}` })));
            const aggiungi = el('button', { type: 'button', testo: 'Aggiungi', suClick: async () => {
                if (!scelta2.value) return;
                try {
                    await fetchApi(`/api/funzioni/${scelta.id}/membri`, { method: 'POST', body: JSON.stringify({ user_id: Number(scelta2.value) }) });
                    await ricarica();
                    aggiorna();
                } catch (e) { notifica(e.message, 'errore'); }
            } });
            blocco.append(el('div', { class: 'fzp-aggiungi' }, scelta2, aggiungi));
        }

        pannello = { aggiorna: () => ricarica().then(aggiorna), ridisegna: aggiorna };
        aggiorna();
    }

    window.Funzioni = {
        inizia, montaIncarichi, etichette, notaPer, smettiNotaPer, apriPannello,
        get attivo() { return stato.attivo; },
        get funzioni() { return stato.funzioni; }
    };
})();
