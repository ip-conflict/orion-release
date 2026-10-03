document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const userId = urlParams.get('id');
    
    const form = document.getElementById('reset-password-form');
    const messageDiv = document.getElementById('reset-message');

    if (!token || !userId) {
        form.innerHTML = `
            <h2 style="color: #dc3545;">Accesso Negato</h2>
            <p>Link di sicurezza non valido o incompleto. Assicurati di aver copiato l'intero link.</p>
            <br>
            <a href="/" class="button-style" style="text-decoration: none;">Torna al Login</a>
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
        submitBtn.textContent = "Salvataggio in corso...";

        try {
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword, id: userId })
            });

            const data = await response.json();

            if (response.ok) {
                messageDiv.textContent = "Password impostata con successo! Reindirizzamento al login...";
                messageDiv.style.color = "green";
                setTimeout(() => { window.location.href = '/'; }, 2500);
            } else {
                messageDiv.textContent = data.message || "Errore durante il salvataggio.";
                messageDiv.style.color = "red";
                submitBtn.disabled = false;
                submitBtn.textContent = "Salva ed entra";
            }
        } catch (error) {
            messageDiv.textContent = "Errore di connessione al server.";
            messageDiv.style.color = "red";
            submitBtn.disabled = false;
            submitBtn.textContent = "Salva ed entra";
        }
    });
});
