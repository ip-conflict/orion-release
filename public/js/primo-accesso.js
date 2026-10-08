// public/js/primo-accesso.js
//
// La configurazione iniziale nella pagina di accesso: finché il server non ha
// un amministratore, al posto dell'accesso compare il modulo per crearlo.

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

    // Lo username proposto da nome e cognome, finché non lo si scrive a mano.
    let usernameToccato = false;
    $('pa-username').addEventListener('input', () => { usernameToccato = true; });
    const proponi = () => {
        if (usernameToccato) return;
        const pulisci = (v) => v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
        const proposta = [pulisci($('pa-nome').value), pulisci($('pa-cognome').value)].filter(Boolean).join('.');
        $('pa-username').value = proposta;
    };
    $('pa-nome').addEventListener('input', proponi);
    $('pa-cognome').addEventListener('input', proponi);

    modulo.addEventListener('submit', async (e) => {
        e.preventDefault();
        messaggio('');
        const dati = {
            codice: $('pa-codice').value, nome: $('pa-nome').value, cognome: $('pa-cognome').value,
            username: $('pa-username').value.trim().toLowerCase(), email: $('pa-email').value, password: $('pa-password').value
        };
        if (!dati.codice.trim() || !dati.nome.trim() || !dati.cognome.trim() || !dati.username || !dati.password) {
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
            mostra(false);
            $('username').value = corpo.username || dati.username;
            const esito = $('login-message');
            if (esito) { esito.textContent = corpo.message; esito.style.color = 'green'; }
            $('password').focus();
        } catch {
            messaggio('Il server non risponde. Riprova.', true);
        } finally {
            pulsante.disabled = false;
        }
    });
})();
