// Funzioni di supporto, per l'amministratore: quali sono accese, come si
// chiamano e chi ne fa parte (con il referente). La stessa pagina vale prima
// di accendere il modulo: le funzioni si preparano in tempo di pace.

(function () {
    const elenco = document.getElementById('fz-elenco');
    const listaUtenti = document.getElementById('fz-utenti');
    let funzioni = [];
    let utenti = [];

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

    // "Rossi Mario · rossim (Croce Rossa, temporaneo)": quello che si scrive
    // nella casella e che si ritrova nel datalist.
    const etichettaUtente = (u) => {
        const extra = [u.ente, u.temporaneo ? 'temporaneo' : null].filter(Boolean).join(', ');
        return `${[u.cognome, u.nome].filter(Boolean).join(' ')} · ${u.username}${extra ? ` (${extra})` : ''}`;
    };

    async function carica() {
        try {
            const [dati, tutti] = await Promise.all([fetchApi('/api/admin/funzioni'), fetchApi('/api/admin/funzioni/persone')]);
            document.getElementById('fz-spento').hidden = dati.attivo;
            funzioni = dati.funzioni;
            // Si propongono le persone attive: interne, esterne e temporanee.
            utenti = tutti.filter(u => u.is_active);
            listaUtenti.replaceChildren(...utenti.map(u => el('option', { value: etichettaUtente(u) })));
            disegna();
        } catch (e) {
            elenco.replaceChildren(el('p', { class: 'fz-vuoto', testo: e.message }));
        }
    }

    function disegna() {
        elenco.replaceChildren(...funzioni.map(schedaFunzione));
    }

    function schedaFunzione(f) {
        const interruttore = el('input', { type: 'checkbox', checked: f.attiva, 'aria-label': `Funzione ${f.sigla} accesa` });
        interruttore.addEventListener('change', () => salva(f, { ...f, attiva: interruttore.checked }));
        const membri = el('div', { class: 'fz-membri' },
            f.membri.length ? f.membri.map(m => chipMembro(f, m)) : el('span', { class: 'fz-vuoto', testo: 'Nessun membro.' }));
        const casella = el('input', { type: 'text', list: 'fz-utenti', placeholder: 'Scrivi un nome per aggiungerlo', 'aria-label': `Aggiungi un membro alla ${f.sigla}` });
        const aggiungi = el('button', { type: 'button', class: 'button-style button-small button-secondary', testo: 'Aggiungi', suClick: () => aggiungiMembro(f, casella) });
        casella.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); aggiungiMembro(f, casella); } });
        const scheda = el('div', { class: `fz-funzione${f.attiva ? '' : ' spenta'}` },
            el('div', { class: 'fz-testa' },
                el('span', { class: 'fz-sigla', testo: f.sigla }),
                el('div', { class: 'fz-nome' }, el('strong', { testo: f.nome }), f.descrizione ? el('span', { testo: f.descrizione }) : null),
                el('label', { class: 'fz-interruttore' }, interruttore, f.attiva ? 'Accesa' : 'Spenta'),
                el('button', { type: 'button', class: 'button-style button-small button-secondary', testo: 'Modifica', suClick: () => modifica(scheda, f) })),
            membri,
            el('div', { class: 'fz-aggiungi' }, casella, aggiungi));
        return scheda;
    }

    function chipMembro(f, m) {
        const nome = [m.cognome, m.nome].filter(Boolean).join(' ');
        const extra = [m.ente, m.temporaneo ? 'temporaneo' : m.esterno ? 'esterno' : null].filter(Boolean).join(', ');
        return el('span', { class: `fz-membro${m.referente ? ' referente' : ''}` },
            nome, extra ? el('small', { testo: `(${extra})` }) : null,
            el('button', { type: 'button', class: m.referente ? 'attivo' : null, title: m.referente ? 'Referente: tocca per toglierlo' : 'Rendi referente',
                'aria-label': `${m.referente ? 'Togli' : 'Segna'} ${nome} come referente`, testo: m.referente ? '★' : '☆',
                suClick: () => azioneMembro(`/api/funzioni/${f.id}/membri/${m.user_id}`, 'PATCH', { referente: !m.referente }) }),
            el('button', { type: 'button', title: `Togli ${nome} dalla ${f.sigla}`, 'aria-label': `Togli ${nome} dalla ${f.sigla}`, testo: '×',
                suClick: () => azioneMembro(`/api/funzioni/${f.id}/membri/${m.user_id}`, 'DELETE') }));
    }

    async function azioneMembro(url, method, corpo) {
        try {
            await fetchApi(url, { method, body: corpo ? JSON.stringify(corpo) : undefined });
            await carica();
        } catch (e) {
            notifica(e.message, 'errore');
        }
    }

    async function aggiungiMembro(f, casella) {
        const scritto = casella.value.trim();
        const u = utenti.find(x => etichettaUtente(x) === scritto)
            || (scritto && utenti.filter(x => etichettaUtente(x).toLowerCase().includes(scritto.toLowerCase())).length === 1
                ? utenti.find(x => etichettaUtente(x).toLowerCase().includes(scritto.toLowerCase())) : null);
        if (!u) { notifica('Scegli la persona dall\'elenco che compare scrivendo.', 'attenzione'); return; }
        await azioneMembro(`/api/funzioni/${f.id}/membri`, 'POST', { user_id: u.id });
    }

    async function salva(f, dati) {
        try {
            if (f) await fetchApi(`/api/admin/funzioni/${f.id}`, { method: 'PUT', body: JSON.stringify(dati) });
            else await fetchApi('/api/admin/funzioni', { method: 'POST', body: JSON.stringify(dati) });
            await carica();
            return true;
        } catch (e) {
            notifica(e.message, 'errore');
            return false;
        }
    }

    // La modifica (o la creazione) di sigla, nome e descrizione, al posto della scheda.
    function modulo(f, suAnnulla) {
        const sigla = el('input', { type: 'text', maxlength: 10, required: true, value: f?.sigla || '', placeholder: 'F10' });
        const nome = el('input', { type: 'text', maxlength: 120, required: true, value: f?.nome || '' });
        const descrizione = el('textarea', { rows: 2, maxlength: 2000 });
        descrizione.value = f?.descrizione || '';
        const form = el('form', { class: 'fz-modulo' },
            el('label', {}, 'Sigla', sigla),
            el('label', {}, 'Nome', nome),
            el('label', { class: 'fz-largo' }, 'Di cosa si occupa', descrizione),
            el('div', { class: 'fz-pulsanti' },
                el('button', { type: 'button', class: 'button-style button-secondary', testo: 'Annulla', suClick: suAnnulla }),
                el('button', { type: 'submit', class: 'button-style', testo: 'Salva' })));
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const fatto = await salva(f, { sigla: sigla.value, nome: nome.value, descrizione: descrizione.value, attiva: f ? f.attiva : true });
            if (fatto && !f) suAnnulla();
        });
        setTimeout(() => (f ? nome : sigla).focus(), 0);
        return form;
    }

    function modifica(scheda, f) {
        scheda.replaceChildren(el('div', { class: 'fz-testa' }, el('span', { class: 'fz-sigla', testo: f.sigla }), el('strong', { testo: `Modifica ${f.nome}` })),
            modulo(f, disegna));
    }

    document.getElementById('fz-nuova').addEventListener('click', () => {
        const box = document.getElementById('fz-nuova-box');
        const chiudi = () => box.replaceChildren();
        box.replaceChildren(el('div', { class: 'fz-funzione', style: 'margin-bottom: 14px; max-width: 980px' },
            el('strong', { testo: 'Nuova funzione' }), modulo(null, chiudi)));
    });

    carica();
})();
