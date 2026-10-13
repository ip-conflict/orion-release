document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const userId = urlParams.get('id');
    
    const form = document.getElementById('reset-password-form');
    const messageDiv = document.getElementById('reset-message');

    if (!token || !userId) {
        form.innerHTML = `
            <h2 style="color: #dc3545;">Collegamento non valido</h2>
            <p>Il collegamento è incompleto: aprilo di nuovo dal messaggio o dal foglio ricevuto, tutto intero. Se non funziona, chiedi a chi ti ha iscritto di mandartene uno nuovo.</p>
            <br>
            <a href="/" class="button-style" style="text-decoration: none;">Vai all'accesso</a>
        `;
        return;
    }

    proponiApp(token, userId, form);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;

        if (newPassword !== confirmPassword) {
            messageDiv.textContent = "Le password non coincidono.";
            messageDiv.style.color = "red";
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = "Salvo la password…";

        try {
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword, id: userId })
            });

            const data = await response.json();

            if (response.ok) {
                const verso = data.username ? `/?utente=${encodeURIComponent(data.username)}` : '/';
                messageDiv.textContent = data.username
                    ? `Password salvata. Il tuo nome utente è ${data.username}: tienilo a mente. Fra un attimo si apre l'accesso, con il nome già scritto: metti la password appena scelta.`
                    : "Password salvata. Fra un attimo si apre l'accesso.";
                messageDiv.style.color = "green";
                submitBtn.textContent = "Password salvata";
                setTimeout(() => { window.location.href = verso; }, 4000);
            } else {
                messageDiv.textContent = data.message || "Errore durante il salvataggio.";
                messageDiv.style.color = "red";
                submitBtn.disabled = false;
                submitBtn.textContent = "Salva la password";
            }
        } catch (error) {
            messageDiv.textContent = "Il server non si raggiunge: controlla la connessione e riprova.";
            messageDiv.style.color = "red";
            submitBtn.disabled = false;
            submitBtn.textContent = "Salva la password";
        }
    });
});

// Su Android l'attivazione si fa nell'app. Il link con package=it.orion.app consegna il token solo
// all'app vera; senza app installata Chrome apre l'indirizzo di riserva, che mostra come installarla.
async function proponiApp(token, userId, form) {
    if (!/Android/i.test(navigator.userAgent)) return;
    let dati;
    try {
        const r = await fetch(`/api/attivazione?id=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`);
        if (!r.ok) return;
        dati = await r.json();
    } catch (e) {
        return;
    }
    if (!dati.app) return;
    const parametri = new URLSearchParams(window.location.search);
    const daInstallare = parametri.get('installa') === '1';
    parametri.set('installa', '1');
    const riserva = `${window.location.origin}${window.location.pathname}?${parametri}`;
    const dentro = `attiva?server=${encodeURIComponent(window.location.origin)}&id=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;

    const blocco = document.getElementById('continua-app');
    document.getElementById('continua-app-titolo').textContent = dati.nome ? `Ciao ${dati.nome}` : 'Benvenuto in ORION';
    document.getElementById('continua-app-apri').href =
        `intent://${dentro}#Intent;scheme=orionmobile;package=it.orion.app;S.browser_fallback_url=${encodeURIComponent(riserva)};end`;
    if (daInstallare && typeof passiInstallaApp === 'function') {
        const installa = document.getElementById('continua-app-installa');
        const scarica = document.createElement('a');
        scarica.className = 'button-style';
        scarica.href = '/app/orion.apk';
        scarica.setAttribute('download', 'orion.apk');
        scarica.style.cssText = 'display: block; text-decoration: none; margin-top: 8px;';
        scarica.textContent = "Scarica l'app";
        installa.append(passiInstallaApp('attiva'), scarica);
        installa.hidden = false;
    }
    document.getElementById('continua-app-browser').addEventListener('click', () => {
        blocco.hidden = true;
        form.hidden = false;
    });
    form.hidden = true;
    blocco.hidden = false;
}
