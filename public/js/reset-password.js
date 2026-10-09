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
                // Il nome utente arriva già scritto nell'accesso: basta la password.
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
