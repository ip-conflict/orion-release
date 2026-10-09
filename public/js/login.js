
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
            document.title = `Accesso - ${settings.association_name}`;
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

const ULTIMO_UTENTE = 'orion.ultimoUtente';

// Accesso riuscito (con la password, o dopo la verifica in due passaggi):
// si salvano i dati della persona e si va al centro operativo.
async function entra(data, username, avviso = '') {
    const messageDiv = document.getElementById('login-message');
    if (!data || !data.userId || !data.role) {
        console.error("ERRORE CRITICO: La risposta API di login non contiene userId o userRole!", data);
        mostraVista(loginForm);
        if (messageDiv) {
            messageDiv.textContent = 'Errore: Dati utente incompleti ricevuti dal server. Contattare assistenza.';
            messageDiv.style.color = 'red';
        }
        abilitaAccesso(true);
        return;
    }
    try {
        localStorage.setItem('userId', data.userId.toString());
        localStorage.setItem('userRole', data.role);
        localStorage.setItem('userRuoli', JSON.stringify(Array.isArray(data.ruoli) && data.ruoli.length ? data.ruoli : [data.role]));
        localStorage.setItem('userPermessi', JSON.stringify(Array.isArray(data.permessi) ? data.permessi : []));
        localStorage.setItem('username', data.username || username.toLowerCase());
        // Il nome che si propone al prossimo accesso da questo browser: "Esci"
        // non lo toglie, "Non sei tu?" sì.
        localStorage.setItem(ULTIMO_UTENTE, data.username || username.toLowerCase());
    } catch (storageError) {
        console.error("Errore durante il salvataggio in localStorage:", storageError);
        avviso = avviso || "Attenzione: impossibile salvare le informazioni utente. Alcune funzionalità potrebbero non essere disponibili.";
    }
    mostraVista(loginForm);
    if (messageDiv) {
        messageDiv.textContent = avviso || 'Accesso riuscito: apro ORION…';
        messageDiv.style.color = avviso ? 'var(--warning-color, #b45309)' : 'green';
    }
    // Da un telefono Android, prima si propone l'app, se c'e'. Poi la prima
    // pagina: il centro operativo, ma per chi è solo volontario, quando non
    // c'è un'emergenza, il suo profilo (DPI, scadenze, tesserino).
    const destinazione = paginaChiesta() || await primaPagina(data);
    const vaiAlCentroOperativo = () => { window.location.href = destinazione; };
    const proposta = await proponiApp(data.token, vaiAlCentroOperativo);
    if (!proposta) setTimeout(vaiAlCentroOperativo, avviso ? 4000 : 500);
}

// Mandati qui da una pagina riservata (il QR di un'etichetta del magazzino
// aperto con la fotocamera, un collegamento in una email): dopo l'accesso si
// torna lì, non alla prima pagina. Solo indirizzi di questo stesso server.
function paginaChiesta() {
    const chiesta = new URLSearchParams(window.location.search).get('redirect');
    if (!chiesta || !chiesta.startsWith('/') || chiesta.startsWith('//') || chiesta.startsWith('/\\')) return null;
    try {
        const url = new URL(chiesta, window.location.origin);
        if (url.origin !== window.location.origin) return null;
        if (url.pathname === '/' || url.pathname === '/login.html' || url.pathname === '/index.html') return null;
        return url.pathname + url.search + url.hash;
    } catch { return null; }
}

// Con un'emergenza aperta si va tutti in sala. Senza, ognuno dove lavora:
// l'amministratore in sala (da lì apre l'emergenza), la segreteria alla
// segreteria, il magazziniere al magazzino, il volontario al suo profilo.
async function primaPagina(data) {
    const ruoli = Array.isArray(data.ruoli) && data.ruoli.length ? data.ruoli : [data.role];
    if (ruoli.includes('admin') || ruoli.includes('esterno')) return '/centro-operativo.html';
    try {
        const r = await fetch('/api/emergencies/status', { headers: { Authorization: `Bearer ${data.token}` } });
        const stato = await r.json();
        if (stato?.active || stato?.emergency) return '/centro-operativo.html';
    } catch { return '/centro-operativo.html'; }
    // Solo se il modulo è acceso: spento, la sua pagina non serve.
    const moduli = await fetch('/api/branding/settings').then(r => r.json()).catch(() => ({}));
    const segreteria = (() => { try { const c = moduli.segreteria_config; return (typeof c === 'string' ? JSON.parse(c) : c)?.enabled === true; } catch { return false; } })();
    if (ruoli.includes('segreteria') && segreteria) return '/admin-segreteria.html';
    if (ruoli.includes('magazziniere') && String(moduli.magazzino_enabled) === 'true') return '/magazzino.html';
    return '/profile.html';
}

function abilitaAccesso(si) {
    document.getElementById('username').disabled = !si;
    document.getElementById('password').disabled = !si;
    loginForm.querySelector('button[type=submit]').disabled = !si;
}

// Una sola vista alla volta nel riquadro d'accesso.
const VISTE = ['login-form', 'forgot-password-form', 'mfa-form', 'mfa-attiva-form', 'mfa-codici'];
function mostraVista(vista) {
    for (const id of VISTE) {
        const el = document.getElementById(id);
        if (!el) continue;
        const si = el === vista;
        if (id === 'login-form' || id === 'forgot-password-form') el.style.display = si ? '' : 'none';
        else el.hidden = !si;
    }
}

// --- Verifica in due passaggi ---------------------------------------------------
let sfidaMfa = null;
let usernameMfa = '';

function messaggioMfa(id, testo, errore = true) {
    const el = document.getElementById(id);
    el.textContent = testo || '';
    el.classList.toggle('errore', !!errore);
}

function tornaAllAccesso(testo) {
    sfidaMfa = null;
    mostraVista(loginForm);
    abilitaAccesso(true);
    document.getElementById('password').value = '';
    const messageDiv = document.getElementById('login-message');
    if (messageDiv) {
        messageDiv.textContent = testo || '';
        messageDiv.style.color = 'red';
    }
    document.getElementById('password').focus();
}

function chiediMfa(data, username) {
    sfidaMfa = data.sfida;
    usernameMfa = username;
    if (data.mfa === 'attivazione') {
        OrionMfa.disegnaQr(document.getElementById('mfa-attiva-qr'), data.uri, data.segreto);
        document.getElementById('mfa-attiva-codice').value = '';
        messaggioMfa('mfa-attiva-messaggio', '');
        mostraVista(document.getElementById('mfa-attiva-form'));
        document.getElementById('mfa-attiva-codice').focus();
    } else {
        document.getElementById('mfa-codice').value = '';
        messaggioMfa('mfa-messaggio', '');
        mostraVista(document.getElementById('mfa-form'));
        document.getElementById('mfa-codice').focus();
    }
}

async function inviaCodiceMfa(modulo, campo, idMessaggio) {
    const codice = document.getElementById(campo).value.trim();
    if (!codice) return messaggioMfa(idMessaggio, 'Scrivi il codice.');
    const pulsante = modulo.querySelector('button[type=submit]');
    pulsante.disabled = true;
    messaggioMfa(idMessaggio, '');
    try {
        const r = await fetch('/api/accesso/mfa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sfida: sfidaMfa, codice })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            if (data.sfida_scaduta) return tornaAllAccesso(data.message);
            messaggioMfa(idMessaggio, data.message || `Errore ${r.status}`);
            document.getElementById(campo).select();
            return;
        }
        sfidaMfa = null;
        if (Array.isArray(data.codici_riserva) && data.codici_riserva.length) {
            OrionMfa.mostraCodici(document.getElementById('mfa-codici-contenuto'), data.codici_riserva);
            mostraVista(document.getElementById('mfa-codici'));
            document.getElementById('mfa-codici-continua').onclick = () => entra(data, usernameMfa);
            return;
        }
        let avviso = '';
        if (Number.isInteger(data.codici_riserva_rimasti) && data.codici_riserva_rimasti <= 3) {
            avviso = data.codici_riserva_rimasti === 0
                ? 'Hai usato l\'ultimo codice di riserva: creane di nuovi dal profilo, in Sicurezza.'
                : `Ti restano ${data.codici_riserva_rimasti} codici di riserva: creane di nuovi dal profilo, in Sicurezza.`;
        }
        entra(data, usernameMfa, avviso);
    } catch {
        messaggioMfa(idMessaggio, 'Il server non risponde. Riprova.');
    } finally {
        pulsante.disabled = false;
    }
}

document.getElementById('mfa-form').addEventListener('submit', (e) => {
    e.preventDefault();
    inviaCodiceMfa(e.currentTarget, 'mfa-codice', 'mfa-messaggio');
});
document.getElementById('mfa-attiva-form').addEventListener('submit', (e) => {
    e.preventDefault();
    inviaCodiceMfa(e.currentTarget, 'mfa-attiva-codice', 'mfa-attiva-messaggio');
});
document.querySelectorAll('[data-mfa-indietro]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    tornaAllAccesso('');
}));

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const messageDiv = document.getElementById('login-message');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (messageDiv) messageDiv.textContent = '';
    abilitaAccesso(false);

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username.toLowerCase(), password })
        });

        const data = await response.json().catch(e => {
            console.error("Risposta non JSON dal server:", e);
            throw new Error(response.status === 429
                ? 'Troppi tentativi in poco tempo: aspetta un quarto d\'ora e riprova.'
                : `Il server non ha risposto come doveva (errore ${response.status}): riprova fra poco.`);
        });

        if (response.ok) {
            await entra(data, username);
        } else if (data?.mfa && data?.sfida) {
            // Password giusta: ora il codice (o l'attivazione, per un amministratore).
            passwordInput.value = '';
            chiediMfa(data, username);
        } else {
            const errorMessage = data?.message || data?.errors?.[0]?.msg || `Errore ${response.status}`;
            console.warn("Login fallito:", errorMessage);
            if (messageDiv) {
                messageDiv.textContent = `Accesso non riuscito: ${errorMessage}`;
                messageDiv.style.color = 'red';
            }
            abilitaAccesso(true);
        }
    } catch (error) {
        console.error('Errore grave durante il login:', error);
        if (messageDiv) {
            // Senza rete il browser dice "Failed to fetch": si dice in italiano cosa fare.
            messageDiv.textContent = error instanceof TypeError
                ? 'Il server non si raggiunge: controlla la connessione a internet e riprova.'
                : error.message;
            messageDiv.style.color = 'red';
        }
        abilitaAccesso(true);
    }
});

// Rimandati qui da una pagina: si dice perché.
(function () {
    const errore = new URLSearchParams(location.search).get('error');
    const messageDiv = document.getElementById('login-message');
    if (!messageDiv || !errore) return;
    const testi = {
        mfa_richiesta: 'Per gli amministratori serve la verifica in due passaggi: accedi di nuovo.',
        account_sospeso: 'Il tuo accesso a ORION non è più attivo. Chiedi alla segreteria.'
    };
    if (testi[errore]) {
        messageDiv.textContent = testi[errore];
        messageDiv.style.color = 'red';
    }
})();

document.addEventListener('DOMContentLoaded', async () => {
    loadLoginBranding();
    // Appena attivato l'account: il nome utente è già scritto, manca la password.
    const utente = new URLSearchParams(window.location.search).get('utente');
    if (utente) {
        document.getElementById('username').value = utente;
        document.getElementById('password').focus();
        return;
    }
    // Chi è entrato l'ultima volta da questo browser trova il suo nome già
    // scritto; sui computer della sala, "Non sei tu?" lo cancella.
    let ultimo = null;
    try { ultimo = localStorage.getItem(ULTIMO_UTENTE); } catch { /* niente */ }
    if (!ultimo) return;
    const campo = document.getElementById('username');
    const nonSeiTu = document.getElementById('non-sei-tu');
    campo.value = ultimo;
    nonSeiTu.hidden = false;
    document.getElementById('password').focus();
    campo.addEventListener('input', () => { nonSeiTu.hidden = true; }, { once: true });
    document.getElementById('cambia-utente').addEventListener('click', (e) => {
        e.preventDefault();
        try { localStorage.removeItem(ULTIMO_UTENTE); } catch { /* niente */ }
        campo.value = '';
        nonSeiTu.hidden = true;
        campo.focus();
    });
});

if (showForgotBtn && showLoginBtn) {
    // Cambia vista: mostra "Recupero"
    showForgotBtn.addEventListener('click', (e) => {
        e.preventDefault();
        mostraVista(forgotForm);
    });

    // Cambia vista: torna al "Login"
    showLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        mostraVista(loginForm);
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
    testo.textContent = "Sul telefono c'è l'app: notifiche, tesserino e intervento della squadra, anche quando manca il campo. Si installa così:";
    // I passi si vedono subito: chi non ha mai installato un'app fuori dal
    // Play Store si ferma alla prima domanda di Android.
    const passi = typeof passiInstallaApp === 'function' ? passiInstallaApp('accedi') : null;

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
        // Il download parte da se': si evidenzia il passo successivo.
        testo.textContent = 'Download avviato. Ora:';
        passi?.querySelectorAll('li').forEach((li, i) => li.classList.toggle('ora', i === 1));
        scarica.textContent = 'Scarica di nuovo';
        scarica.classList.add('button-secondary');
    });

    scheda.append(titolo, testo, ...(passi ? [passi] : []), versione, scarica, web, ...(offerta.certificato_sha256 ? [certificato] : []));
    velo.append(scheda);
    document.body.append(velo);
    scarica.focus();
    return true;
}
