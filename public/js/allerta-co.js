// Il bollettino di allerta nel centro operativo: una pastiglia discreta
// accanto allo stato dell'emergenza, con il colore di oggi e di domani nella
// zona del Comune. Si apre la finestra con i tre rischi, il PDF, la pagina
// ufficiale della Regione e gli aggiornamenti. Spenta se nelle impostazioni
// non c'è la Regione.

(function () {
    const STILE = `
    .al-pastiglia { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 50px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-muted); font: inherit; font-size: .8rem; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
    .al-pastiglia:hover { background: var(--secondary-bg-color); color: var(--text-color); }
    .al-punto { width: 10px; height: 10px; border-radius: 50%; display: inline-block; background: #94a3b8; flex-shrink: 0; }
    .al-punto.verde { background: #16a34a; } .al-punto.gialla { background: #eab308; } .al-punto.arancione { background: #f97316; } .al-punto.rossa { background: #dc2626; }
    .al-velo { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 5000; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 24px 12px; }
    .al-finestra { background: var(--surface-color); color: var(--text-color); width: 100%; max-width: 640px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); display: flex; flex-direction: column; max-height: calc(100dvh - 48px); }
    .al-testa { display: flex; align-items: center; gap: 10px; padding: 16px 20px 12px; border-bottom: 1px solid var(--border-color); }
    .al-testa h2 { margin: 0; font-size: 1.2rem; flex: 1; }
    .al-chiudi { border: 0; background: transparent; color: inherit; font-size: 1.6rem; line-height: 1; cursor: pointer; padding: 2px 8px; border-radius: 6px; }
    .al-corpo { overflow-y: auto; padding: 14px 20px 18px; }
    .al-zona { margin: 0 0 12px; font-size: .9rem; color: var(--text-muted); line-height: 1.4; }
    .al-zona strong { color: var(--text-color); }
    .al-tabella { width: 100%; border-collapse: collapse; font-size: .9rem; margin-bottom: 10px; }
    .al-tabella th, .al-tabella td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border-light-color); }
    .al-tabella th { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); }
    .al-livello { display: inline-flex; align-items: center; gap: 6px; }
    .al-fonte { font-size: .8rem; color: var(--text-muted); margin: 6px 0 12px; line-height: 1.45; }
    .al-azioni { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    .al-azioni a { text-decoration: none; }
    .al-corpo h3 { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); margin: 14px 0 6px; }
    .al-versione { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--border-light-color); font-size: .85rem; }
    .al-versione span.al-titolo { flex: 1; min-width: 0; }
    .al-versione a { font-size: .8rem; }
    .al-vuoto { color: var(--text-muted); font-size: .9rem; line-height: 1.45; }
    @media (max-width: 768px) { .al-pastiglia .al-testo { display: none; } }
    `;
    const NOMI = { verde: 'nessuna allerta', gialla: 'gialla', arancione: 'arancione', rossa: 'rossa' };
    const RISCHI = [['idrogeologico', 'Idrogeologico'], ['idraulico', 'Idraulico'], ['temporali', 'Temporali']];

    let dati = null;
    let pastiglia = null;
    let velo = null;

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
    const punto = (livello) => el('span', { class: `al-punto ${livello || ''}`, 'aria-hidden': 'true' });
    const livello = (l) => el('span', { class: 'al-livello' }, punto(l), l ? NOMI[l] : 'non trasmessa');
    const giornoBreve = (data) => new Date(`${data}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'numeric' });
    const quando = (iso) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

    function disegnaPastiglia() {
        if (!dati?.attiva) { if (pastiglia) pastiglia.hidden = true; return; }
        if (!pastiglia) {
            pastiglia = el('button', { type: 'button', class: 'al-pastiglia', id: 'allerta-btn', suClick: apri });
            document.getElementById('emergency-status-display')?.after(pastiglia);
        }
        pastiglia.hidden = false;
        pastiglia.replaceChildren();
        const giorni = dati.bollettino?.validi || [];
        if (!dati.zona) {
            pastiglia.append(punto(null), el('span', { class: 'al-testo', testo: 'Allerta: zona da scegliere' }));
            pastiglia.title = 'Il centro della mappa non cade in una zona della Regione: scegli il comune nelle impostazioni.';
            return;
        }
        if (!giorni.length) {
            pastiglia.append(punto(null), el('span', { class: 'al-testo', testo: 'Allerta: nessun bollettino di oggi' }));
            pastiglia.title = `Zona ${dati.zona.codice}: ${dati.stato?.errore ? `bollettino non letto (${dati.stato.errore})` : 'il bollettino di oggi non è ancora arrivato'}.`;
            return;
        }
        const etichette = ['oggi', 'domani'];
        pastiglia.append(el('span', { class: 'al-testo', testo: 'Allerta' }));
        giorni.forEach((g, i) => pastiglia.append(punto(g.massimo), el('span', { class: 'al-testo', testo: etichette[i] })));
        pastiglia.title = `Zona ${dati.zona.codice} - ${giorni.map((g, i) => `${etichette[i]}: ${g.massimo ? NOMI[g.massimo] : 'non trasmessa'}`).join(', ')}. Clic per il bollettino.`;
    }

    async function carica() {
        try {
            dati = await fetchApi('/api/allerta');
        } catch {
            return;
        }
        disegnaPastiglia();
        if (velo) disegnaFinestra();
    }

    function chiudi() {
        velo?.remove();
        velo = null;
    }

    function disegnaFinestra() {
        const corpo = velo.querySelector('.al-corpo');
        corpo.replaceChildren();
        const b = dati.bollettino;
        const r = dati.regione;
        if (!dati.zona) {
            corpo.append(el('p', { class: 'al-vuoto', testo: `Il centro della mappa non cade in una zona d'allerta della Regione ${r.nome}. Scegli il comune di riferimento in Impostazioni › Bollettino di allerta.` }));
            return;
        }
        corpo.append(el('p', { class: 'al-zona' },
            'Zona ', el('strong', { testo: `${dati.zona.codice} ${dati.zona.nome}` }),
            dati.riferimento?.comune ? ` (comune di ${dati.riferimento.comune})` : ' (dal centro della mappa)'));
        if (!b) {
            corpo.append(el('p', { class: 'al-vuoto', testo: dati.stato?.errore ? `Il bollettino non si è potuto leggere: ${dati.stato.errore}.` : 'Nessun bollettino letto finora.' }));
        } else {
            const giorni = b.validi?.length ? b.validi : [];
            if (giorni.length) {
                corpo.append(el('table', { class: 'al-tabella' },
                    el('thead', {}, el('tr', {}, el('th', { testo: 'Rischio' }), ...giorni.map(g => el('th', { testo: giornoBreve(g.data) })))),
                    el('tbody', {}, ...RISCHI.map(([k, nome]) => el('tr', {}, el('td', { testo: nome }), ...giorni.map(g => el('td', {}, livello(g[k]))))))));
            } else {
                corpo.append(el('p', { class: 'al-vuoto', testo: "L'ultimo bollettino letto non vale più per oggi: quello nuovo esce di norma entro le 16." }));
            }
            corpo.append(el('p', { class: 'al-fonte', testo: `${b.titolo}, emesso ${quando(b.emesso_il)}. Sintesi delle valutazioni del ${r.ente}, pubblicata dal Dipartimento della Protezione Civile. Vale come informazione: l'allerta ufficiale è quella che la Regione comunica al Comune.` }));
        }
        corpo.append(el('div', { class: 'al-azioni' },
            b?.pdf ? el('a', { class: 'button-style', href: `/api/allerta/bollettini/${b.id}/pdf`, target: '_blank', rel: 'noopener', testo: 'Apri il bollettino (PDF)' }) : null,
            el('a', { class: 'button-style button-secondary', href: r.pagina_ufficiale, target: '_blank', rel: 'noopener noreferrer', testo: `Avvisi della Regione ${r.nome}` })));

        const versioni = dati.aggiornamenti || [];
        if (versioni.length > 1 || (versioni.length && versioni[0].id !== b?.id)) {
            corpo.append(el('h3', { testo: dati.in_emergenza ? "Versioni dall'apertura dell'emergenza" : 'Versioni degli ultimi giorni' }));
            versioni.forEach(v => corpo.append(el('div', { class: 'al-versione' },
                ...v.giorni.map(g => punto(g.massimo)),
                el('span', { class: 'al-titolo', testo: v.titolo }),
                v.pdf ? el('a', { href: `/api/allerta/bollettini/${v.id}/pdf`, target: '_blank', rel: 'noopener', testo: 'PDF' }) : null)));
        }
        if (dati.in_emergenza) {
            corpo.append(el('p', { class: 'al-fonte', testo: "Ogni versione entra da sola nei documenti dell'emergenza e nel diario di sala." }));
        }
    }

    function apri() {
        if (velo) return;
        velo = el('div', { class: 'al-velo', suClick: (e) => { if (e.target === velo) chiudi(); } },
            el('div', { class: 'al-finestra', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Bollettino di allerta' },
                el('div', { class: 'al-testa' },
                    el('h2', { testo: 'Bollettino di allerta' }),
                    el('button', { type: 'button', class: 'al-chiudi', title: 'Chiudi', 'aria-label': 'Chiudi', testo: '×', suClick: chiudi })),
                el('div', { class: 'al-corpo' })));
        document.body.append(velo);
        disegnaFinestra();
        carica();
    }

    document.head.append(el('style', { testo: STILE }));
    document.addEventListener('ws:allerta_aggiornata', carica);
    document.addEventListener('ws:emergency_status_change', carica);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && velo) chiudi(); });
    // Il giorno cambia anche a pagina aperta: "oggi" e "domani" si rileggono ogni mezz'ora.
    setInterval(carica, 30 * 60 * 1000);
    window.Allerta = { carica, apri };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', carica);
    else carica();
})();
