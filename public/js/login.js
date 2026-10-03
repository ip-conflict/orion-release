// login.js

// GESTIONE "PASSWORD DIMENTICATA"
const loginForm = document.getElementById('login-form');
const forgotForm = document.getElementById('forgot-password-form');
const showForgotBtn = document.getElementById('show-forgot-password');
const showLoginBtn = document.getElementById('show-login');

async function loadLoginBranding() {
    console.log("Caricamento branding per la pagina di login...");
    try {
        const settings = await fetch('/api/branding/settings').then(res => res.json());
        const associationNameElement = document.getElementById('association-name-display');
        if (associationNameElement && settings && settings.association_name) {
            associationNameElement.textContent = settings.association_name;
            document.title = `Login - ${settings.association_name}`;
        }

        const logoInfo = await fetch('/api/branding').then(res => res.json());
        const logoElement = document.getElementById('login-logo');
        if (logoElement && logoInfo && logoInfo.logoUrl) {
            // Aggiunge la versione come query string per evitare problemi di cache
            logoElement.src = `${logoInfo.logoUrl}?v=${logoInfo.logoVersion}`;
            logoElement.style.display = 'block';
        } else if (logoElement) {
            logoElement.style.display = 'none';
        }

    } catch (error) {
        console.error("Errore nel caricamento del branding per il login:", error);
        // In caso di errore, la pagina userà i valori di default presenti nell'HTML.
    }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log("Inizio processo di login...");

    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const messageDiv = document.getElementById('login-message');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    // Reset messaggio precedente
    if(messageDiv) messageDiv.textContent = '';
    usernameInput.disabled = true;
    passwordInput.disabled = true;
    e.submitter?.setAttribute('disabled', 'disabled');

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: username.toLowerCase(), password })
        });

        const data = await response.json().catch(e => {
            console.error("Risposta non JSON dal server:", e);
            // Lancia un errore che verrà catturato dal blocco catch esterno
            throw new Error(`Risposta non valida dal server (Status: ${response.status})`);
        });

        if (response.ok) {
            // === LOGIN RIUSCITO ===
            if(messageDiv) {
                 messageDiv.textContent = 'Login effettuato con successo! Reindirizzamento...';
                 messageDiv.style.color = 'green';
            }

            // SALVATAGGIO DATI UTENTE IN LOCALSTORAGE
            if (data && data.userId && data.role) {
                try {
                    // > MODIFICA CHIAVE: Salva userId in localStorage <
                    localStorage.setItem('userId', data.userId.toString());

                    localStorage.setItem('userRole', data.role);
                    localStorage.setItem('userRuoli', JSON.stringify(Array.isArray(data.ruoli) && data.ruoli.length ? data.ruoli : [data.role]));

                    if (data.username) {
                        localStorage.setItem('username', data.username);
                    } else {
                        // Se il backend non manda username, usa quello inserito (già in minuscolo)
                        localStorage.setItem('username', username.toLowerCase());
                    }

                    console.log("Dati utente (userId, userRole, username) salvati in localStorage.");

                } catch (storageError) {
                    console.error("Errore durante il salvataggio in localStorage:", storageError);
                    // Avvisa l'utente che alcune funzionalità potrebbero non andare
                    notifica("Attenzione: Impossibile salvare le informazioni utente. Alcune funzionalità potrebbero non essere disponibili.", 'attenzione');
                    // Non interrompere il reindirizzamento, ma l'utente è avvisato.
                }
            } else {
                // Se mancano dati FONDAMENTALI come userId o role, è un problema grave
                console.error("ERRORE CRITICO: La risposta API di login non contiene userId o userRole!", data);
                if(messageDiv) {
                    messageDiv.textContent = 'Errore: Dati utente incompleti ricevuti dal server. Contattare assistenza.';
                    messageDiv.style.color = 'red';
                }
                // Blocca il reindirizzamento e riabilita il form
                usernameInput.disabled = false;
                passwordInput.disabled = false;
                e.submitter?.removeAttribute('disabled');
                return;
            }

            // Reindirizza al Centro Operativo dopo un breve ritardo. Da un
            // telefono Android, prima si propone l'app, se c'e'.
            const vaiAlCentroOperativo = () => { window.location.href = '/centro-operativo.html'; };
            const proposta = await proponiApp(data.token, vaiAlCentroOperativo);
            if (!proposta) setTimeout(vaiAlCentroOperativo, 500);

        } else {
            const errorMessage = data?.message || data?.errors?.[0]?.msg || `Errore ${response.status}`;
            console.warn("Login fallito:", errorMessage);
            if(messageDiv) {
                messageDiv.textContent = `Login fallito: ${errorMessage}`;
                messageDiv.style.color = 'red';
            }
            // Riabilita subito i campi in caso di errore
            usernameInput.disabled = false;
            passwordInput.disabled = false;
            e.submitter?.removeAttribute('disabled');
        }
    } catch (error) {
        // Errore fetch (rete) o JSON parse fallito o errore lanciato da !response.ok
        console.error('Errore grave durante il login:', error);
        if(messageDiv) {
            messageDiv.textContent = `Errore: ${error.message}`;
            messageDiv.style.color = 'red';
        }
        // Riabilita i campi
        usernameInput.disabled = false;
        passwordInput.disabled = false;
        e.submitter?.removeAttribute('disabled');
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    loadLoginBranding();
});

if (showForgotBtn && showLoginBtn) {
    // Cambia vista: mostra "Recupero"
    showForgotBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'none';
        forgotForm.style.display = 'block';
    });

    // Cambia vista: torna al "Login"
    showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        forgotForm.style.display = 'none';
        loginForm.style.display = 'block';
    });
}

if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const identificativo = document.getElementById('forgot-identificativo').value.trim();
        const messageDiv = document.getElementById('forgot-message');
        const submitBtn = forgotForm.querySelector('button[type="submit"]');

        messageDiv.textContent = '';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Invio in corso...';

        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identificativo })
            });
            const data = await response.json();

            if (response.ok || response.status === 200) {
                messageDiv.textContent = data.message;
                messageDiv.style.color = 'green';
            } else {
                messageDiv.textContent = data.message || "Errore durante la richiesta.";
                messageDiv.style.color = 'red';
            }
        } catch (error) {
            messageDiv.textContent = "Errore di connessione al server.";
            messageDiv.style.color = 'red';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Invia il link';
        }
    });
}

// Proposta dell'app Android dopo l'accesso
// Solo dai telefoni Android (l'APK su iPhone non si installa), solo se il
// server la mette a disposizione e la persona non e' un esterno: lo decide
// /api/app/offerta. Chi risponde "Continua sul web" non la rivede finche'
// non esce una versione nuova. Restituisce true se la proposta e' a schermo:
// allora il passaggio al centro operativo lo fa lei.
async function proponiApp(token, continua) {
    if (!/Android/i.test(navigator.userAgent || '')) return false;
    let offerta;
    try {
        const risposta = await fetch('/api/app/offerta', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!risposta.ok) return false;
        offerta = await risposta.json();
    } catch (e) {
        return false;
    }
    if (!offerta?.disponibile || !offerta.scarica) return false;

    const chiave = `orion.appProposta.${offerta.codice ?? offerta.versione ?? ''}`;
    try {
        if (localStorage.getItem(chiave) === 'no') return false;
    } catch (e) { /* senza localStorage la si propone ogni volta */ }

    const velo = document.createElement('div');
    velo.className = 'proposta-app';
    velo.setAttribute('role', 'dialog');
    velo.setAttribute('aria-modal', 'true');
    velo.setAttribute('aria-labelledby', 'proposta-app-titolo');

    const scheda = document.createElement('div');
    scheda.className = 'proposta-app-scheda';

    const titolo = document.createElement('h3');
    titolo.id = 'proposta-app-titolo';
    titolo.textContent = "ORION per Android";

    const testo = document.createElement('p');
    testo.textContent = "Sul telefono c'è l'app: notifiche, tesserino e intervento della squadra, anche quando manca il campo.";

    const versione = document.createElement('p');
    versione.className = 'proposta-app-versione';
    versione.textContent = offerta.versione ? `Versione ${offerta.versione}` : '';

    // L'impronta del certificato di firma: chi vuole, la confronta con quella
    // pubblicata. Android poi accetta gli aggiornamenti solo con la stessa firma.
    const certificato = document.createElement('p');
    certificato.className = 'proposta-app-certificato';
    if (offerta.certificato_sha256) certificato.textContent = `Impronta del certificato (SHA-256): ${offerta.certificato_sha256}`;

    const scarica = document.createElement('a');
    scarica.className = 'button-style proposta-app-scarica';
    scarica.href = offerta.scarica;
    scarica.setAttribute('download', 'orion.apk');
    scarica.textContent = "Scarica l'app";

    const web = document.createElement('button');
    web.type = 'button';
    web.className = 'proposta-app-web';
    web.textContent = 'Continua sul web';
    web.addEventListener('click', () => {
        try { localStorage.setItem(chiave, 'no'); } catch (e) { /* pazienza */ }
        continua();
    });

    scarica.addEventListener('click', () => {
        // Il download parte da se'; qui si spiega cosa fare dopo.
        testo.textContent = "Download avviato. Apri il file scaricato per installarla: la prima volta Android chiede di consentire l'installazione da questa fonte. Poi accedi con le stesse credenziali.";
        scarica.style.display = 'none';
        web.textContent = 'Continua sul web';
    });

    scheda.append(titolo, testo, versione, ...(offerta.certificato_sha256 ? [certificato] : []), scarica, web);
    velo.append(scheda);
    document.body.append(velo);
    scarica.focus();
    return true;
}
