// La rubrica d'emergenza. Rubrica.apri() mostra la finestra del centro
// operativo: si cerca, si chiama (sul telefono il numero è un link), si
// aggiunge e si corregge. Rubrica.disegnaFoglio(contenitore) la scrive come
// foglio da stampare, per rubrica.html: quando la rete non c'è, la carta sì.

(function () {
    const CATEGORIE = {
        istituzioni: 'Istituzioni ed enti',
        soccorso: "Soccorso e forze dell'ordine",
        reperibili: 'Reperibili',
        ditte: 'Ditte e servizi',
        associazione: 'Associazione',
        altro: 'Altri'
    };

    const STILE = `
    .rb-velo { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 5000; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 24px 12px; }
    .rb-finestra { background: var(--surface-color, #fff); color: var(--text-color, #111); width: 100%; max-width: 680px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); box-sizing: border-box; display: flex; flex-direction: column; max-height: calc(100dvh - 48px); }
    .rb-testa { display: flex; align-items: center; gap: 10px; padding: 16px 20px 12px; border-bottom: 1px solid var(--border-color, #ddd); }
    .rb-testa h2 { margin: 0; font-size: 1.2rem; flex: 1; }
    .rb-chiudi { border: 0; background: transparent; color: inherit; font-size: 1.6rem; line-height: 1; cursor: pointer; padding: 2px 8px; border-radius: 6px; }
    .rb-chiudi:hover { background: var(--secondary-bg-color, #eef2f7); }
    .rb-barra { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 12px 20px; }
    .rb-barra input { flex: 1; min-width: 180px; height: 38px; margin: 0; padding: 0 10px; box-sizing: border-box; border-radius: 8px; border: 1px solid var(--border-color, #ccc); background: var(--bg-color, #fff); color: inherit; font-size: .95rem; }
    .rb-corpo { overflow-y: auto; padding: 0 20px 18px; }
    .rb-gruppo { margin: 12px 0 4px; font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted, #64748b); }
    .rb-voce { display: flex; gap: 10px; align-items: flex-start; padding: 9px 0; border-bottom: 1px solid var(--border-light-color, #eee); }
    .rb-chi { flex: 1; min-width: 0; }
    .rb-chi strong { display: block; }
    .rb-chi span { display: block; font-size: .82rem; color: var(--text-muted, #64748b); }
    .rb-numeri { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
    .rb-numeri a { font-weight: 600; text-decoration: none; color: var(--info-text, #1d4ed8); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .rb-numeri a.rb-email { font-weight: 400; font-size: .82rem; }
    .rb-modifica { border: 1px solid var(--border-color, #ccc); background: transparent; color: inherit; border-radius: 6px; cursor: pointer; padding: 5px 8px; font-size: .8rem; }
    .rb-vuoto { color: var(--text-muted, #64748b); padding: 12px 0; line-height: 1.45; }
    .rb-modulo { padding: 4px 20px 18px; overflow-y: auto; }
    .rb-campo { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: .85rem; font-weight: 600; }
    .rb-campo input, .rb-campo select, .rb-campo textarea { padding: 9px 10px; border-radius: 8px; border: 1px solid var(--border-color, #ccc); background: var(--bg-color, #fff); color: inherit; font: inherit; font-weight: 400; }
    .rb-riga { display: flex; gap: 10px; flex-wrap: wrap; }
    .rb-riga > * { flex: 1; min-width: 160px; }
    .rb-pulsanti { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
    .rb-pulsanti .rb-spazio { flex: 1; }
    .rb-errore { color: var(--danger-text, #b91c1c); font-size: .9rem; margin: 6px 0; }
    .rb-velo [hidden] { display: none !important; }
    `;

    function el(tag, attributi = {}, ...figli) {
        const e = document.createElement(tag);
        Object.entries(attributi).forEach(([k, v]) => {
            if (k === 'testo') e.textContent = v;
            else if (k.startsWith('su')) e.addEventListener(k.slice(2).toLowerCase(), v);
            else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
        });
        figli.flat().forEach(f => f && e.append(f));
        return e;
    }

    // Il numero come link "tel:": sul telefono chiama, sul PC lo passa al programma delle chiamate.
    const linkTelefono = (n) => el('a', { href: `tel:${n.replace(/[^0-9+]/g, '')}`, testo: n, title: `Chiama ${n}` });
    const descrizione = (c) => [c.ruolo, c.ente].filter(Boolean).join(' · ');
    const corrisponde = (c, cerca) => !cerca || [c.nome, c.ruolo, c.ente, c.telefono, c.telefono_alt, c.email, c.note, CATEGORIE[c.categoria]]
        .some(v => v && String(v).toLowerCase().includes(cerca));

    let finestraAperta = null;

    async function apri() {
        if (finestraAperta) return;
        if (!document.getElementById('rb-stile')) document.head.append(el('style', { id: 'rb-stile', testo: STILE }));

        let contatti = [];
        const cerca = el('input', { type: 'search', placeholder: 'Cerca nome, ente, numero…', 'aria-label': 'Cerca nella rubrica' });
        const corpo = el('div', { class: 'rb-corpo' });
        const modulo = el('div', { class: 'rb-modulo', hidden: true });
        // Gli esterni la consultano soltanto.
        const scrive = typeof haRuolo === 'function' && (haRuolo('admin') || !(typeof ruoliUtente === 'function' && ruoliUtente().includes('esterno')));
        const barra = el('div', { class: 'rb-barra' },
            cerca,
            scrive ? el('button', { type: 'button', class: 'button-style', testo: 'Nuovo contatto', suClick: () => mostraModulo(null) }) : null,
            el('button', { type: 'button', class: 'button-style button-secondary', testo: 'Stampa', suClick: () => window.open('/rubrica.html', '_blank', 'noopener') }));

        const chiudi = () => {
            velo.remove();
            document.removeEventListener('keydown', suTasto);
            document.removeEventListener('ws:reload_rubrica', ricarica);
            finestraAperta = null;
        };
        const suTasto = (ev) => { if (ev.key === 'Escape') chiudi(); };
        const finestra = el('div', { class: 'rb-finestra', role: 'dialog', 'aria-modal': 'true', 'aria-label': "Rubrica d'emergenza" },
            el('div', { class: 'rb-testa' },
                el('h2', { testo: "Rubrica d'emergenza" }),
                el('button', { type: 'button', class: 'rb-chiudi', 'aria-label': 'Chiudi', title: 'Chiudi', testo: '×', suClick: chiudi })),
            barra, corpo, modulo);
        const velo = el('div', { class: 'rb-velo', suClick: (ev) => { if (ev.target === velo) chiudi(); } }, finestra);
        document.body.append(velo);
        document.addEventListener('keydown', suTasto);
        finestraAperta = velo;

        function disegnaElenco() {
            corpo.innerHTML = '';
            const filtro = cerca.value.trim().toLowerCase();
            const visibili = contatti.filter(c => corrisponde(c, filtro));
            if (!contatti.length) {
                corpo.append(el('p', { class: 'rb-vuoto', testo: scrive
                    ? 'La rubrica è vuota. Aggiungi i numeri che in sala servono subito: Prefettura, sindaco e reperibili del Comune, 118, Vigili del fuoco, le ditte con mezzi e attrezzature.'
                    : 'La rubrica è vuota.' }));
                return;
            }
            if (!visibili.length) {
                corpo.append(el('p', { class: 'rb-vuoto', testo: 'Nessun contatto corrisponde alla ricerca.' }));
                return;
            }
            let gruppo = null;
            visibili.forEach(c => {
                if (c.categoria !== gruppo) {
                    gruppo = c.categoria;
                    corpo.append(el('div', { class: 'rb-gruppo', testo: CATEGORIE[gruppo] || gruppo }));
                }
                corpo.append(el('div', { class: 'rb-voce' },
                    el('div', { class: 'rb-chi' },
                        el('strong', { testo: c.nome }),
                        descrizione(c) ? el('span', { testo: descrizione(c) }) : null,
                        c.note ? el('span', { testo: c.note }) : null),
                    el('div', { class: 'rb-numeri' },
                        c.telefono ? linkTelefono(c.telefono) : null,
                        c.telefono_alt ? linkTelefono(c.telefono_alt) : null,
                        c.email ? el('a', { class: 'rb-email', href: `mailto:${c.email}`, testo: c.email }) : null),
                    scrive ? el('button', { type: 'button', class: 'rb-modifica', title: `Modifica ${c.nome}`, 'aria-label': `Modifica ${c.nome}`, testo: 'Modifica', suClick: () => mostraModulo(c) }) : null));
            });
        }

        function mostraModulo(c) {
            const campo = (nome, etichetta, attributi = {}) => {
                const input = el('input', { type: 'text', name: nome, value: c?.[nome] ?? '', ...attributi });
                return el('label', { class: 'rb-campo' }, etichetta, input);
            };
            const categoria = el('select', { name: 'categoria' },
                Object.entries(CATEGORIE).map(([v, t]) => el('option', { value: v, testo: t, selected: (c?.categoria || 'istituzioni') === v })));
            const note = el('textarea', { name: 'note', rows: 2, maxlength: 2000 });
            note.value = c?.note || '';
            const errore = el('p', { class: 'rb-errore', hidden: true });
            const salva = el('button', { type: 'submit', class: 'button-style', testo: 'Salva' });
            const torna = () => { modulo.hidden = true; barra.hidden = false; corpo.hidden = false; cerca.focus(); };
            const form = el('form', {},
                campo('nome', 'Nome *', { required: true, maxlength: 150, placeholder: 'Mario Bianchi, o Sala operativa Prefettura' }),
                el('div', { class: 'rb-riga' },
                    campo('ruolo', 'Ruolo', { maxlength: 150, placeholder: 'Reperibile viabilità' }),
                    campo('ente', 'Ente', { maxlength: 150, placeholder: 'Comune di …' })),
                el('div', { class: 'rb-riga' },
                    campo('telefono', 'Telefono', { type: 'tel', maxlength: 40 }),
                    campo('telefono_alt', 'Altro telefono', { type: 'tel', maxlength: 40 })),
                el('div', { class: 'rb-riga' },
                    campo('email', 'Email', { type: 'email', maxlength: 150 }),
                    el('label', { class: 'rb-campo' }, 'Gruppo', categoria)),
                el('label', { class: 'rb-campo' }, 'Note', note),
                errore,
                el('div', { class: 'rb-pulsanti' },
                    c ? el('button', { type: 'button', class: 'button-style button-secondary btn-pericolo', testo: 'Elimina', suClick: elimina }) : null,
                    el('span', { class: 'rb-spazio' }),
                    el('button', { type: 'button', class: 'button-style button-secondary', testo: 'Annulla', suClick: torna }),
                    salva));
            form.addEventListener('submit', async (ev) => {
                ev.preventDefault();
                errore.hidden = true;
                const dati = Object.fromEntries(new FormData(form).entries());
                salva.disabled = true;
                try {
                    await fetchApi(c ? `/api/rubrica/${c.id}` : '/api/rubrica', { method: c ? 'PUT' : 'POST', body: JSON.stringify(dati) });
                    await carica();
                    torna();
                } catch (e) {
                    errore.textContent = e.message;
                    errore.hidden = false;
                } finally {
                    salva.disabled = false;
                }
            });
            async function elimina() {
                if (!window.confirm(`Togliere ${c.nome} dalla rubrica?`)) return;
                try {
                    await fetchApi(`/api/rubrica/${c.id}`, { method: 'DELETE' });
                    await carica();
                    torna();
                } catch (e) {
                    errore.textContent = e.message;
                    errore.hidden = false;
                }
            }
            modulo.innerHTML = '';
            modulo.append(el('p', { class: 'rb-gruppo', testo: c ? `Modifica ${c.nome}` : 'Nuovo contatto' }), form);
            barra.hidden = true; corpo.hidden = true; modulo.hidden = false;
            form.querySelector('input[name="nome"]').focus();
        }

        async function carica() {
            contatti = await fetchApi('/api/rubrica');
            disegnaElenco();
        }
        async function ricarica() {
            try { await carica(); } catch { /* la prossima volta */ }
        }

        cerca.addEventListener('input', disegnaElenco);
        document.addEventListener('ws:reload_rubrica', ricarica);
        corpo.append(el('p', { class: 'rb-vuoto', testo: 'Carico la rubrica…' }));
        try {
            await carica();
        } catch (e) {
            corpo.innerHTML = '';
            corpo.append(el('p', { class: 'rb-errore', testo: e.message }));
        }
        cerca.focus();
    }

    // Il foglio da stampare: una tabella per gruppo.
    function disegnaFoglio(contatti, contenitore) {
        const gruppi = new Map();
        contatti.forEach(c => {
            if (!gruppi.has(c.categoria)) gruppi.set(c.categoria, []);
            gruppi.get(c.categoria).push(c);
        });
        if (!contatti.length) {
            contenitore.append(el('p', { class: 'st-vuoto', testo: 'La rubrica è vuota: i contatti si aggiungono dal centro operativo.' }));
            return;
        }
        gruppi.forEach((voci, categoria) => {
            // Sul telefono il numero si tocca per chiamare; sulla carta è testo.
            const numero = (n, classe) => n ? el('a', { href: `tel:${String(n).replace(/[^\d+]/g, '')}`, class: classe, testo: n }) : null;
            const corpo = el('tbody', {}, voci.map(c => el('tr', {},
                el('td', {}, el('strong', { testo: c.nome }), descrizione(c) ? el('span', { class: 'st-piccolo', testo: descrizione(c) }) : null),
                el('td', { class: 'st-stretta', 'data-etichetta': 'Telefono' }, numero(c.telefono, 'st-numero'), c.telefono_alt ? numero(c.telefono_alt, 'st-piccolo st-numero') : null),
                el('td', { 'data-etichetta': 'Email', testo: c.email || '' }),
                el('td', { 'data-etichetta': 'Note', testo: c.note || '' }))));
            contenitore.append(el('section', { class: 'st-sezione' },
                el('h2', {}, CATEGORIE[categoria] || categoria, ' ', el('span', { class: 'st-conta', testo: `(${voci.length})` })),
                el('table', { class: 'st-tabella st-rubrica' },
                    el('thead', {}, el('tr', {}, ['Nome', 'Telefono', 'Email', 'Note'].map(t => el('th', { testo: t })))),
                    corpo)));
        });
    }

    window.Rubrica = { apri, disegnaFoglio, CATEGORIE };
})();
