(function () {
    const scheda = document.getElementById('mfa-profilo');
    if (!scheda) return;
    const $ = (id) => document.getElementById(id);
    let azione = null;
    let telefonoScelto = null;

    function messaggio(testo, errore = false) {
        $('mfa-profilo-messaggio').textContent = testo || '';
        $('mfa-profilo-messaggio').classList.toggle('errore', !!errore);
    }

    function soloPannello(id) {
        for (const p of ['mfa-password-form', 'mfa-conferma-form', 'mfa-codici-pannello']) $(p).hidden = p !== id;
        $('mfa-azioni').hidden = id !== null;
    }

    function pulsante(testo, nome, secondario = true) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = secondario ? 'button-style button-secondary' : 'button-style';
        b.textContent = testo;
        b.addEventListener('click', () => {
            azione = nome;
            telefonoScelto = b.dataset.telefono || null;
            messaggio('');
            $('mfa-password').value = '';
            soloPannello('mfa-password-form');
            $('mfa-password').focus();
        });
        return b;
    }

    async function carica() {
        let stato;
        try {
            stato = await fetchApi('/api/mfa');
        } catch {
            return;
        }
        if (!stato?.disponibile) { scheda.hidden = true; return; }
        scheda.hidden = false;
        soloPannello(null);
        const azioni = $('mfa-azioni');
        azioni.replaceChildren();
        await caricaTelefoni(stato);
        if (stato.attiva) {
            const dal = stato.attivata_il ? new Date(stato.attivata_il).toLocaleDateString('it-IT') : null;
            const rimasti = stato.codici_rimasti;
            const come = stato.telefoni && stato.totp ? 'conferma dal telefono o codice dell\'app'
                : stato.telefoni ? 'conferma dal telefono' : 'codice dell\'app sul telefono';
            $('mfa-stato').textContent =
                `Attiva${dal ? ` dal ${dal}` : ''}: per entrare servono la password e la ${come}. ` +
                (rimasti === 0 ? 'Non ti restano codici di riserva: creane di nuovi.'
                    : `Ti ${rimasti === 1 ? 'resta 1 codice' : `restano ${rimasti} codici`} di riserva.`) +
                (stato.obbligatoria ? ' Per il tuo ruolo è obbligatoria.' : '');
            azioni.append(stato.totp ? pulsante('Cambia app dei codici', 'cambia') : pulsante('Aggiungi app dei codici', 'attiva'),
                pulsante('Nuovi codici di riserva', 'codici'));
            if (!stato.obbligatoria) azioni.append(pulsante('Disattiva', 'disattiva'));
        } else {
            $('mfa-stato').textContent = 'Non attiva. Con la verifica, per entrare servono la password e un codice ' +
                "che l'app sul tuo telefono cambia ogni 30 secondi: chi scopre la password, da sola, non entra.";
            azioni.append(pulsante('Attiva', 'attiva', false));
        }
    }

    async function caricaTelefoni(stato) {
        const elenco = $('mfa-telefoni');
        elenco.replaceChildren();
        let telefoni = [];
        if (stato.telefoni) {
            try { telefoni = await fetchApi('/api/telefoni'); } catch { /* resta vuoto */ }
        }
        for (const t of telefoni) {
            const li = document.createElement('li');
            const nome = document.createElement('span');
            const quando = t.usato_il || t.creato_il;
            nome.textContent = `${t.nome || 'Telefono'}${quando ? ` · ${new Date(quando).toLocaleDateString('it-IT')}` : ''}`;
            const b = pulsante('Scollega', 'scollega');
            b.dataset.telefono = t.id;
            li.append(nome, b);
            elenco.append(li);
        }
        elenco.hidden = telefoni.length === 0;
        $('mfa-telefoni-nota').hidden = stato.disponibile !== true;
    }

    function mostraCodici(codici, testo) {
        OrionMfa.mostraCodici($('mfa-profilo-codici'), codici);
        soloPannello('mfa-codici-pannello');
        messaggio(testo || '');
    }

    $('mfa-password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = $('mfa-password').value;
        if (!password) return messaggio('Scrivi la password.', true);
        const percorso = { attiva: '/api/mfa/prepara', cambia: '/api/mfa/prepara', codici: '/api/mfa/codici', disattiva: '/api/mfa/disattiva',
            scollega: `/api/telefoni/${encodeURIComponent(telefonoScelto)}` }[azione];
        try {
            const r = await fetchApi(percorso, { method: azione === 'scollega' ? 'DELETE' : 'POST', body: JSON.stringify({ password }) });
            $('mfa-password').value = '';
            if (azione === 'attiva' || azione === 'cambia') {
                OrionMfa.disegnaQr($('mfa-profilo-qr'), r.uri, r.segreto);
                $('mfa-profilo-codice').value = '';
                soloPannello('mfa-conferma-form');
                messaggio(azione === 'cambia' ? 'Il telefono di prima continua a valere finché non confermi il codice di quello nuovo.' : '');
                $('mfa-profilo-codice').focus();
            } else if (azione === 'codici') {
                mostraCodici(r.codici_riserva, r.message);
            } else {
                await carica();
                messaggio(r.message);
            }
        } catch (err) {
            messaggio(err.message || 'Operazione non riuscita.', true);
        }
    });

    $('mfa-conferma-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const codice = $('mfa-profilo-codice').value.trim();
        if (!codice) return messaggio('Scrivi il codice che vedi nell\'app.', true);
        try {
            const r = await fetchApi('/api/mfa/attiva', { method: 'POST', body: JSON.stringify({ codice }) });
            if (!r.codici_riserva) { await carica(); return messaggio(r.message); }
            mostraCodici(r.codici_riserva, `${r.message} Le altre sessioni aperte sono state chiuse.`);
        } catch (err) {
            messaggio(err.message || 'Codice non valido.', true);
            if (err.status === 409) { await carica(); messaggio(err.message, true); }
        }
    });

    $('mfa-codici-fatto').addEventListener('click', async () => {
        await carica();
        messaggio('');
    });
    scheda.querySelectorAll('[data-mfa-annulla]').forEach(b => b.addEventListener('click', () => {
        azione = null;
        soloPannello(null);
        messaggio('');
    }));

    carica();
})();
