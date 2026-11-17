(function () {
    const modulo = document.getElementById('primo-accesso-form');
    const accesso = document.getElementById('login-form');
    if (!modulo || !accesso) return;
    const $ = (id) => document.getElementById(id);

    function mostra(si) {
        modulo.hidden = !si;
        accesso.style.display = si ? 'none' : '';
        if (si) $('pa-codice').focus();
    }

    function messaggio(testo, errore) {
        $('pa-messaggio').textContent = testo || '';
        $('pa-messaggio').classList.toggle('errore', !!errore);
    }

    fetch('/api/primo-accesso')
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d?.necessario) mostra(true); })
        .catch(() => { /* il server risponde all'accesso normale */ });

    const spiegazione = $('pa-username').textContent;
    const proponi = () => {
        const pulisci = (v) => v.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
        const proposta = pulisci($('pa-cognome').value) + pulisci($('pa-nome').value).slice(0, 1);
        $('pa-username').textContent = proposta ? `Il tuo nome utente sarà ${proposta}: cognome e iniziale del nome, come per tutti. Si entra anche con l'email.` : spiegazione;
    };
    $('pa-nome').addEventListener('input', proponi);
    $('pa-cognome').addEventListener('input', proponi);

    modulo.addEventListener('submit', async (e) => {
        e.preventDefault();
        messaggio('');
        const dati = {
            codice: $('pa-codice').value, nome: $('pa-nome').value, cognome: $('pa-cognome').value,
            email: $('pa-email').value, password: $('pa-password').value
        };
        if (!dati.codice.trim() || !dati.nome.trim() || !dati.cognome.trim() || !dati.password) {
            return messaggio('Compila tutti i campi (l\'email è facoltativa).', true);
        }
        if (dati.password !== $('pa-conferma').value) return messaggio('Le due password non coincidono.', true);
        const pulsante = modulo.querySelector('button[type=submit]');
        pulsante.disabled = true;
        try {
            const r = await fetch('/api/primo-accesso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dati) });
            const corpo = await r.json().catch(() => ({}));
            if (!r.ok) {
                messaggio(corpo.message || `Errore ${r.status}`, true);
                if (r.status === 409) setTimeout(() => mostra(false), 2500);
                return;
            }
            modulo.reset();
            modulo.hidden = true;
            $('username').value = corpo.username;
            // Entra subito: la verifica in due passaggi la chiederà l'accesso successivo.
            entra(corpo, corpo.username, corpo.avviso, { conferma: true });
        } catch {
            messaggio('Il server non risponde. Riprova.', true);
        } finally {
            pulsante.disabled = false;
        }
    });
})();
