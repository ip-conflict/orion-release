// La verifica in due passaggi nel profilo, sezione Sicurezza: attivarla,
// passare a un telefono nuovo, rifare i codici di riserva, toglierla (solo chi
// non è amministratore). Ogni operazione chiede prima la password.

(function () {
    const scheda = document.getElementById('mfa-profilo');
    if (!scheda) return;
    const $ = (id) => document.getElementById(id);
    let azione = null;

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
        if (stato.attiva) {
            const dal = stato.attivata_il ? new Date(stato.attivata_il).toLocaleDateString('it-IT') : null;
            const rimasti = stato.codici_rimasti;
            $('mfa-stato').textContent =
                `Attiva${dal ? ` dal ${dal}` : ''}: per entrare servono la password e il codice dell'app sul telefono. ` +
                (rimasti === 0 ? 'Non ti restano codici di riserva: creane di nuovi.'
                    : `Ti ${rimasti === 1 ? 'resta 1 codice' : `restano ${rimasti} codici`} di riserva.`) +
                (stato.obbligatoria ? ' Per gli amministratori è obbligatoria.' : '');
            azioni.append(pulsante('Cambia telefono', 'cambia'), pulsante('Nuovi codici di riserva', 'codici'));
            if (!stato.obbligatoria) azioni.append(pulsante('Disattiva', 'disattiva'));
        } else {
            $('mfa-stato').textContent = 'Non attiva. Con la verifica, per entrare servono la password e un codice ' +
                "che l'app sul tuo telefono cambia ogni 30 secondi: chi scopre la password, da sola, non entra.";
            azioni.append(pulsante('Attiva', 'attiva', false));
        }
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
        const percorso = { attiva: '/api/mfa/prepara', cambia: '/api/mfa/prepara', codici: '/api/mfa/codici', disattiva: '/api/mfa/disattiva' }[azione];
        try {
            const r = await fetchApi(percorso, { method: 'POST', body: JSON.stringify({ password }) });
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
