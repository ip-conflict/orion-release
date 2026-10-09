// "Accesso esterno": chi si presenta al COC durante un'emergenza (la Croce
// Rossa con un'ambulanza, un tecnico del Comune) entra in ORION con un nome e
// un QR, senza passare dalla segreteria. Finisce da solo con l'emergenza.
//
// La finestra si costruisce da sé: la usano il centro operativo e la pagina
// delle squadre, e basta includere questo file e chiamare
// EsterniTemporanei.apri().

(function () {
    const NOMI_RADIO = [
        'Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
        'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa',
        'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey',
        'X-ray', 'Yankee', 'Zulu'
    ];
    const ENTI = ['Croce Rossa', '118', 'Vigili del fuoco', 'Polizia locale', 'Carabinieri', 'Comune', 'ANPAS', 'Misericordia'];

    const STILE = `
    .et-velo { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 5000; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 24px 12px; }
    .et-finestra { background: var(--surface-color, #fff); color: var(--text-color, #111); width: 100%; max-width: 560px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 20px; box-sizing: border-box; }
    .et-finestra h2 { margin: 0 0 4px; font-size: 1.2rem; }
    .et-finestra h3 { margin: 18px 0 8px; font-size: 1rem; }
    .et-nota { font-size: .85rem; opacity: .75; margin: 0 0 12px; line-height: 1.4; }
    .et-campo { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-size: .85rem; font-weight: 600; }
    .et-campo input, .et-campo select { padding: 9px 10px; border-radius: 8px; border: 1px solid var(--border-color, #ccc); background: var(--bg-color, #fff); color: inherit; font-size: .95rem; font-weight: 400; }
    .et-riga { display: flex; gap: 10px; flex-wrap: wrap; }
    .et-riga > * { flex: 1; min-width: 140px; }
    .et-pulsanti { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-top: 8px; }
    .et-pulsanti button, .et-pulsanti a { padding: 9px 14px; border-radius: 8px; border: 1px solid var(--border-color, #ccc); background: transparent; color: inherit; font-weight: 600; cursor: pointer; text-decoration: none; font-size: .9rem; }
    .et-pulsanti .et-principale { background: #2563eb; color: #fff; border-color: transparent; }
    .et-esito { text-align: center; padding: 12px; border: 1px solid var(--border-color, #ccc); border-radius: 10px; margin-top: 12px; }
    .et-esito .et-qr, .et-centrato .et-qr { display: inline-block; background: #fff; padding: 10px; border-radius: 8px; line-height: 0; }
    .et-esito .et-link, .et-centrato .et-link { word-break: break-all; font-family: ui-monospace, monospace; font-size: .8rem; margin: 10px 0; }
    .et-errore { color: var(--danger-text); font-size: .9rem; margin: 6px 0; }
    .et-elenco { display: flex; flex-direction: column; gap: 8px; }
    .et-voce { padding: 10px 12px; border: 1px solid var(--border-color, #ccc); border-radius: 10px; }
    .et-voce-testa { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .et-voce .et-chi { flex: 1; min-width: 160px; }
    .et-voce .et-chi strong { display: block; }
    .et-voce .et-chi span { font-size: .8rem; opacity: .75; }
    .et-voce.revocato { opacity: .5; }
    .et-azioni { display: flex; gap: 6px; flex-wrap: wrap; }
    .et-azioni button { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color, #ccc); background: transparent; color: inherit; cursor: pointer; font-size: .8rem; font-weight: 600; }
    .et-azioni button.attivo { background: var(--secondary-bg-color, #eef2f7); }
    .et-azioni .et-pericolo { color: var(--danger-text); }
    .et-pannello { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-color, #ccc); }
    .et-pannello.et-centrato { text-align: center; }
    .et-pannello .et-esito { margin-top: 0; }
    .et-invio { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .et-invio input { flex: 1; min-width: 180px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color, #ccc); background: var(--bg-color, #fff); color: inherit; }
    .et-invio button, .et-secondario { padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-color, #ccc); background: transparent; color: inherit; font-weight: 600; cursor: pointer; font-size: .85rem; }
    .et-secondario { display: block; margin: 12px auto 0; font-weight: 500; font-size: .8rem; opacity: .85; }
    .et-ok { color: var(--success-text); font-size: .85rem; margin: 6px 0 0; }
    .et-finestra [hidden] { display: none !important; }
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

    function dataOra(v) {
        return v ? new Date(v).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    }

    // Il QR, il link e i modi per farlo arrivare: inquadrarlo sul posto è il
    // più rapido, il link va bene per chi è già ripartito. Con [id] anche
    // l'email e il codice nuovo.
    function mostraCodice(contenitore, dati, nome, id = null, suNuovo = null) {
        contenitore.innerHTML = '';
        contenitore.classList.add('et-centrato');
        const qr = el('div', { class: 'et-qr' });
        const testoInvito = `Accesso a ORION per ${nome}: ${dati.link}`;
        const pulsanti = el('div', { class: 'et-pulsanti', style: 'justify-content: center' },
            el('button', { type: 'button', testo: 'Copia il link', suClick: async (ev) => {
                try { await navigator.clipboard.writeText(dati.link); ev.target.textContent = 'Copiato'; } catch { window.prompt('Copia il link:', dati.link); }
            } }),
            navigator.share ? el('button', { type: 'button', testo: 'Condividi', suClick: () => navigator.share({ title: 'Accesso a ORION', text: testoInvito }).catch(() => {}) }) : null
        );
        const stato = dati.usato_il ? ` Già usato alle ${dataOra(dati.usato_il)}: chi lo apre di nuovo entra come ${nome}.` : '';
        contenitore.append(
            el('p', { class: 'et-nota', testo: `Fai inquadrare il QR con la fotocamera del telefono (o dall'app Orion Mobile: «Accedi con un codice»). Vale fino alla chiusura dell'emergenza${dati.scade_il ? `, al massimo fino al ${dataOra(dati.scade_il)}` : ''}.${stato}` }),
            qr,
            el('div', { class: 'et-link', testo: dati.link }),
            pulsanti
        );
        if (dati.email_inviata === true) contenitore.append(el('p', { class: 'et-ok', testo: 'Il link è stato mandato anche per email.' }));
        if (dati.email_inviata === false && dati.email_chiesta) contenitore.append(el('p', { class: 'et-errore', testo: "L'email non è partita (posta non configurata?): usa il QR o il link." }));
        if (id) {
            const email = el('input', { type: 'email', maxlength: 100, placeholder: 'Email a cui mandare il link' });
            const esitoInvio = el('p', { class: 'et-nota', hidden: true });
            const invia = el('button', { type: 'button', testo: 'Manda per email', suClick: async () => {
                esitoInvio.hidden = true;
                invia.disabled = true;
                try {
                    const r = await fetchApi(`/api/esterni-temporanei/${id}/invia`, { method: 'POST', body: JSON.stringify({ email: email.value }) });
                    esitoInvio.className = 'et-ok';
                    esitoInvio.textContent = r.message;
                } catch (e) {
                    esitoInvio.className = 'et-errore';
                    esitoInvio.textContent = e.message;
                } finally {
                    esitoInvio.hidden = false;
                    invia.disabled = false;
                }
            } });
            contenitore.append(el('div', { class: 'et-invio' }, email, invia), esitoInvio);
            if (suNuovo) {
                contenitore.append(el('button', { type: 'button', class: 'et-secondario', testo: 'Codice perso o girato a chi non doveva? Genera un codice nuovo (il vecchio smette di valere)', suClick: suNuovo }));
            }
        }
        if (typeof QRCode !== 'undefined') {
            new QRCode(qr, { text: dati.link, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
        }
    }

    async function apri() {
        if (!document.getElementById('et-stile')) {
            document.head.append(el('style', { id: 'et-stile', testo: STILE }));
        }
        const errore = el('div', { class: 'et-errore', hidden: true });
        const nome = el('input', { type: 'text', maxlength: 100, required: true, placeholder: 'Mario Rossi, o Ambulanza CRI 1' });
        const ente = el('input', { type: 'text', maxlength: 100, list: 'et-enti', placeholder: 'Croce Rossa, 118...' });
        const enti = el('datalist', { id: 'et-enti' }, ENTI.map(e => el('option', { value: e })));
        const squadra = el('select', {}, el('option', { value: '', testo: 'Nessuna, per ora' }));
        const nomeRadio = el('select');
        const nomeSquadra = el('input', { type: 'text', maxlength: 100, placeholder: 'es. Ambulanza CRI' });
        const bloccoNuova = el('div', { class: 'et-riga', hidden: true },
            el('label', { class: 'et-campo' }, 'Nome radio', nomeRadio),
            el('label', { class: 'et-campo' }, 'Nome della squadra', nomeSquadra));
        const email = el('input', { type: 'email', maxlength: 100, placeholder: 'facoltativa' });
        // La funzione di supporto per cui arriva (il medico nella F2), se il modulo è acceso.
        const funzione = el('select', {}, el('option', { value: '', testo: 'Nessuna' }));
        const campoFunzione = el('label', { class: 'et-campo', hidden: true }, 'Funzione di supporto', funzione);
        fetchApi('/api/funzioni').then(dati => {
            if (!dati?.attivo || !dati.funzioni?.length) return;
            dati.funzioni.forEach(f => funzione.append(el('option', { value: f.id, testo: `${f.sigla} ${f.nome}` })));
            campoFunzione.hidden = false;
        }).catch(() => { /* modulo spento */ });
        const esito = el('div', { class: 'et-esito', hidden: true });
        const elenco = el('div', { class: 'et-elenco' });
        const crea = el('button', { type: 'submit', class: 'et-principale', testo: 'Crea accesso' });

        const chiudi = () => velo.remove();
        const modulo = el('form', {},
            el('label', { class: 'et-campo' }, 'Nome *', nome),
            el('label', { class: 'et-campo' }, 'Ente', ente, enti),
            el('label', { class: 'et-campo' }, 'Squadra', squadra),
            bloccoNuova,
            campoFunzione,
            el('label', { class: 'et-campo' }, 'Email per mandargli il link', email),
            errore,
            el('div', { class: 'et-pulsanti' }, el('button', { type: 'button', testo: 'Chiudi', suClick: chiudi }), crea)
        );
        const finestra = el('div', { class: 'et-finestra', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Accesso esterno temporaneo' },
            el('h2', { testo: 'Accesso esterno temporaneo' }),
            el('p', { class: 'et-nota', testo: "Per chi non è dell'associazione e serve in questa emergenza: entra come esterno, vede l'emergenza e, se è in una squadra, condivide la posizione. Tutto finisce con la chiusura dell'emergenza." }),
            modulo, esito,
            el('h3', { testo: 'Accessi di questa emergenza' }),
            elenco);
        const velo = el('div', { class: 'et-velo', suClick: (e) => { if (e.target === velo) chiudi(); } }, finestra);
        document.body.append(velo);
        nome.focus();

        // Le squadre esistenti, e i nomi radio ancora liberi per una nuova.
        try {
            const squadre = await fetchApi('/api/squadre');
            const usati = new Set(squadre.map(s => s.nome_radio));
            squadre.forEach(s => squadra.append(el('option', { value: String(s.id), testo: s.nome ? `${s.nome_radio} - ${s.nome}` : s.nome_radio })));
            squadra.append(el('option', { value: 'nuova', testo: 'Nuova squadra…' }));
            NOMI_RADIO.filter(n => !usati.has(n)).forEach(n => nomeRadio.append(el('option', { value: n, testo: n })));
        } catch { /* senza elenco si crea l'accesso senza squadra */ }
        squadra.addEventListener('change', () => { bloccoNuova.hidden = squadra.value !== 'nuova'; });

        async function aggiornaElenco() {
            let voci = [];
            try { voci = await fetchApi('/api/esterni-temporanei'); } catch (e) { elenco.textContent = e.message; return; }
            elenco.innerHTML = '';
            if (!voci.length) { elenco.append(el('p', { class: 'et-nota', testo: 'Nessuno, finora.' })); return; }
            voci.forEach(v => elenco.append(schedaAccesso(v)));
        }

        // Una persona dell'elenco: chi è, a che punto è, e cosa si può fare.
        // I pannelli si aprono sotto la scheda, uno alla volta.
        function schedaAccesso(v) {
            const chi = `${v.nome || ''} ${v.cognome || ''}`.trim() || v.username;
            const dettagli = [v.ente, v.nome_radio ? `squadra ${v.nome_radio}` : 'senza squadra',
                v.attivo ? (v.usato_il ? `entrato alle ${dataOra(v.usato_il)}` : 'non ancora entrato') : 'revocato'].filter(Boolean).join(' · ');
            const voce = el('div', { class: `et-voce${v.attivo ? '' : ' revocato'}` });
            const pannello = el('div', { class: 'et-pannello', hidden: true });
            const azioni = el('div', { class: 'et-azioni' });
            voce.append(el('div', { class: 'et-voce-testa' },
                el('div', { class: 'et-chi' }, el('strong', { testo: chi }), el('span', { testo: dettagli })), azioni), pannello);
            if (!v.attivo) return voce;

            let aperto = null;
            const apriPannello = (nome, riempi) => {
                azioni.querySelectorAll('button').forEach(b => b.classList.toggle('attivo', b.dataset.pannello === nome && aperto !== nome));
                if (aperto === nome) { aperto = null; pannello.hidden = true; return; }
                aperto = nome;
                pannello.hidden = false;
                pannello.innerHTML = '';
                pannello.classList.remove('et-centrato');
                riempi();
            };

            const nuovoCodice = async () => {
                try {
                    const dati = await fetchApi(`/api/esterni-temporanei/${v.id}/codice`, { method: 'POST' });
                    mostraCodice(pannello, { ...dati, usato_il: null }, chi, v.id, nuovoCodice);
                    pannello.prepend(el('p', { class: 'et-ok', testo: 'Codice nuovo: quello di prima non vale più.' }));
                    aggiornaStato();
                } catch (e) { notifica(e.message, 'info'); }
            };
            const mostraQr = async () => {
                pannello.append(el('p', { class: 'et-nota', testo: 'Carico il codice…' }));
                try {
                    const dati = await fetchApi(`/api/esterni-temporanei/${v.id}/codice`);
                    mostraCodice(pannello, dati, chi, v.id, nuovoCodice);
                } catch (e) {
                    pannello.innerHTML = '';
                    pannello.append(el('p', { class: 'et-errore', testo: e.message }));
                    if (e.body?.rigenera) pannello.append(el('div', { class: 'et-pulsanti', style: 'justify-content: center' },
                        el('button', { type: 'button', class: 'et-principale', testo: 'Genera un codice nuovo', suClick: nuovoCodice })));
                }
            };
            const cambiaPersona = () => {
                const nome = el('input', { type: 'text', maxlength: 100, required: true, placeholder: 'Nome e cognome di chi subentra' });
                const ente = el('input', { type: 'text', maxlength: 100, list: 'et-enti', value: v.ente || '' });
                const email = el('input', { type: 'email', maxlength: 100, placeholder: 'facoltativa' });
                const err = el('p', { class: 'et-errore', hidden: true });
                const conferma = el('button', { type: 'submit', class: 'et-principale', testo: 'Cambia e crea il codice' });
                const f = el('form', {},
                    el('p', { class: 'et-nota', testo: `Per un cambio turno: ${chi} esce subito dall'app e il suo codice smette di valere. Chi subentra resta ${v.nome_radio ? `nella squadra ${v.nome_radio}` : 'senza squadra'} e riceve un codice nuovo.` }),
                    el('label', { class: 'et-campo' }, 'Chi subentra *', nome),
                    el('div', { class: 'et-riga' },
                        el('label', { class: 'et-campo' }, 'Ente', ente),
                        el('label', { class: 'et-campo' }, 'Email per il link', email)),
                    err,
                    el('div', { class: 'et-pulsanti' }, conferma));
                f.addEventListener('submit', async (ev) => {
                    ev.preventDefault();
                    err.hidden = true;
                    conferma.disabled = true;
                    try {
                        const dati = await fetchApi(`/api/esterni-temporanei/${v.id}/persona`, {
                            method: 'PUT', body: JSON.stringify({ nome: nome.value, ente: ente.value, email: email.value })
                        });
                        const nuovo = `${dati.nome} ${dati.cognome || ''}`.trim();
                        mostraCodice(pannello, { ...dati, email_chiesta: !!email.value.trim() }, nuovo, v.id, nuovoCodice);
                        pannello.prepend(el('p', { class: 'et-ok', testo: `Ora l'accesso è di ${nuovo}: dagli questo codice.` }));
                        aperto = 'qr';
                        azioni.querySelectorAll('button').forEach(b => b.classList.toggle('attivo', b.dataset.pannello === 'qr'));
                        aggiornaStato();
                    } catch (e2) {
                        err.textContent = e2.message;
                        err.hidden = false;
                    } finally {
                        conferma.disabled = false;
                    }
                });
                pannello.append(f);
                nome.focus();
            };
            // Dopo un cambio la riga in cima si aggiorna, il pannello resta aperto.
            const aggiornaStato = async () => {
                try {
                    const tutte = await fetchApi('/api/esterni-temporanei');
                    const nuova = tutte.find(x => x.id === v.id);
                    if (!nuova) return;
                    const testa = voce.querySelector('.et-chi');
                    testa.innerHTML = '';
                    const n = `${nuova.nome || ''} ${nuova.cognome || ''}`.trim() || nuova.username;
                    testa.append(el('strong', { testo: n }), el('span', { testo: [nuova.ente, nuova.nome_radio ? `squadra ${nuova.nome_radio}` : 'senza squadra', nuova.usato_il ? `entrato alle ${dataOra(nuova.usato_il)}` : 'non ancora entrato'].filter(Boolean).join(' · ') }));
                } catch { /* resta com'era */ }
            };

            azioni.append(
                el('button', { type: 'button', 'data-pannello': 'qr', testo: 'QR e link', suClick: () => apriPannello('qr', mostraQr) }),
                el('button', { type: 'button', 'data-pannello': 'persona', testo: 'Cambia persona', suClick: () => apriPannello('persona', cambiaPersona) }),
                el('button', { type: 'button', class: 'et-pericolo', testo: 'Revoca', suClick: async () => {
                    if (!confirm(`Revocare l'accesso di ${chi}? Esce dalla squadra e non può più entrare.`)) return;
                    try { await fetchApi(`/api/esterni-temporanei/${v.id}`, { method: 'DELETE' }); aggiornaElenco(); } catch (e) { notifica(e.message, 'info'); }
                } })
            );
            return voce;
        }
        aggiornaElenco();

        modulo.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            errore.hidden = true;
            const corpo = { nome: nome.value, ente: ente.value, email: email.value };
            if (squadra.value === 'nuova') corpo.nuova_squadra = { nome_radio: nomeRadio.value, nome: nomeSquadra.value };
            if (funzione.value) corpo.funzione_id = Number(funzione.value);
            else if (squadra.value) corpo.squadra_id = Number(squadra.value);
            crea.disabled = true;
            try {
                const dati = await fetchApi('/api/esterni-temporanei', { method: 'POST', body: JSON.stringify(corpo) });
                esito.hidden = false;
                mostraCodice(esito, { ...dati, email_chiesta: !!email.value.trim() }, `${dati.nome} ${dati.cognome || ''}`.trim(), dati.id);
                modulo.reset();
                bloccoNuova.hidden = true;
                esito.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                aggiornaElenco();
            } catch (e) {
                errore.textContent = e.message;
                errore.hidden = false;
            } finally {
                crea.disabled = false;
            }
        });
    }

    window.EsterniTemporanei = { apri };
})();
