
function getToken() {
    if (typeof Cookies === 'undefined') {
        console.error("Libreria Cookies (js-cookie) non trovata.");
        return undefined;
    }
    return Cookies.get('token');
}

async function fetchApi(url, options = {}) {
    const token = getToken();
    const headers = { ...options.headers };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData)) {
        if (options.body) {
            headers['Content-Type'] = 'application/json';
        }
    } else {
        // Il Content-Type di FormData lo imposta il browser.
        delete headers['Content-Type'];
    }

    console.log(`API Helper: Chiamando ${options.method || 'GET'} ${url}`);

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            credentials: 'same-origin'
        });

        console.log(`API Helper: Ricevuto status ${response.status} per ${url}`);

        if (!response.ok) {
            let errorMsg = `Errore API ${response.status}`;
            let errorDetail = null;
            let errorData;

            try {
                errorData = await response.json();
                console.warn(`API Helper: Risposta errore JSON ricevuta:`, errorData);
                errorMsg = errorData?.message || errorData?.error || errorMsg;
                errorDetail = errorData?.detail;
            } catch (jsonError) {
                console.warn(`API Helper: Impossibile parsare risposta errore come JSON per ${url}. Status: ${response.status}`);
                // statusText è in inglese ("Bad Gateway").
                errorMsg = response.status === 429 ? 'Troppe richieste in poco tempo: aspetta qualche minuto e riprova.'
                    : response.status >= 500 ? `Il server non ha risposto come doveva (errore ${response.status}): riprova fra poco.`
                    : `Richiesta non riuscita (errore ${response.status}).`;
                // Il corpo è già stato consumato.
            }

            console.error(`API Helper Error ${response.status}: ${errorMsg}${errorDetail ? ' - ' + errorDetail : ''} per ${url}`);
            const errorToThrow = new Error(errorMsg);
            errorToThrow.status = response.status;
            // I contrassegni (modulo_spento...) servono a chi chiama.
            if (typeof errorData !== 'undefined') errorToThrow.body = errorData;
            if (errorDetail) errorToThrow.detail = errorDetail;

            // Una pagina aperta da ore se ne accorge alla prima chiamata.
            if (response.status === 428 && errorData?.informativa_da_vedere && !location.pathname.startsWith('/informativa.html')) {
                errorToThrow.informativa = true;
                location.href = '/informativa.html?redirect=' + encodeURIComponent(location.pathname + location.search);
            }

            if (response.status === 503 && errorData?.manutenzione) {
                errorToThrow.manutenzione = true;
                window.__orionManutenzione = true;
                mostraSchermataManutenzione(errorMsg);
            }

            throw errorToThrow;
        }

        if (response.status === 204) {
            return null;
        }

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            return response.json();
        } else {
            return response.text();
        }

    } catch (networkError) {
        console.error(`API Helper: Errore durante chiamata a ${url}:`, networkError);
        // Chi chiama mostra il messaggio così com'è: "Failed to fetch" va detto in italiano.
        if (networkError instanceof TypeError && !networkError.status) {
            const senzaRete = new Error('Il server non si raggiunge: controlla la connessione e riprova.');
            senzaRete.rete = true;
            senzaRete.cause = networkError;
            throw senzaRete;
        }
        throw networkError;
    }
}

// Non cancella niente di quello che c'è sotto: quando il server torna basta ricaricare.
function mostraSchermataManutenzione(messaggio) {
    // Una chiamata partita prima che la pagina fosse pronta non diventa un secondo errore.
    if (!document.body || document.getElementById('orion-manutenzione')) return;

    const velo = document.createElement('div');
    velo.id = 'orion-manutenzione';
    velo.setAttribute('role', 'status');
    velo.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
        'justify-content:center;background:rgba(15,23,42,0.88);color:#f8fafc;' +
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;';

    const riquadro = document.createElement('div');
    riquadro.style.cssText = 'max-width:460px;text-align:center;line-height:1.6;';

    const titolo = document.createElement('h2');
    titolo.textContent = 'Manutenzione in corso';
    titolo.style.cssText = 'margin:0 0 12px 0;font-size:1.4rem;';

    const testo = document.createElement('p');
    testo.textContent = messaggio || 'Il sistema sta lavorando. Riprova fra poco.';
    testo.style.cssText = 'margin:0 0 20px 0;font-size:0.98rem;opacity:0.9;';

    const attesa = document.createElement('p');
    attesa.textContent = 'La pagina si ricarica da sola appena il sistema torna disponibile.';
    attesa.style.cssText = 'margin:0;font-size:0.85rem;opacity:0.7;';

    riquadro.append(titolo, testo, attesa);
    velo.appendChild(riquadro);
    document.body.appendChild(velo);

    const riprova = setInterval(async () => {
        try {
            const risposta = await fetch('/api/branding/settings', { credentials: 'same-origin' });
            if (risposta.status !== 503) {
                clearInterval(riprova);
                window.location.reload();
            }
        } catch { /* server ancora giù: si riprova al giro dopo */ }
    }, 5000);
}

function getCurrentUserId() {
    try {
        const userIdStr = localStorage.getItem('userId');
        if (userIdStr) {
            const userId = parseInt(userIdStr, 10);
            return !isNaN(userId) ? userId : null;
        }
    } catch (e) {
        console.error("Errore accesso a localStorage per userId:", e);
    }
    return null;
}

function loadReadStatusFromStorage() {
    const userId = getCurrentUserId();
    console.log(`[ReadStatus] Caricamento stato lettura per User ID: ${userId}`);

    if (!(window.reportLastViewedLogTimestamp instanceof Map)) {
        console.error("[ReadStatus] ERRORE CRITICO: La mappa globale 'window.reportLastViewedLogTimestamp' non è stata inizializzata correttamente prima di chiamare loadReadStatusFromStorage!");
        window.reportLastViewedLogTimestamp = new Map();
    }
    window.reportLastViewedLogTimestamp.clear();
    console.log("[ReadStatus] Mappa in memoria svuotata prima del caricamento.");

    if (!userId) {
        console.warn('[ReadStatus] Impossibile caricare: User ID mancante.');
        return;
    }

    const storageKey = `unreadLogTimestamps_${userId}`;
    console.log(`[ReadStatus] Caricamento da localStorage (chiave: ${storageKey})`);

    try {
        const storedTimestampsJson = localStorage.getItem(storageKey);

        if (storedTimestampsJson) {
            const storedTimestamps = JSON.parse(storedTimestampsJson);

            if (typeof storedTimestamps === 'object' && storedTimestamps !== null) {
                for (const reportIdStr in storedTimestamps) {
                    if (Object.prototype.hasOwnProperty.call(storedTimestamps, reportIdStr)) {
                        const reportId = parseInt(reportIdStr, 10);
                        const timestampValue = storedTimestamps[reportIdStr];

                        if (!isNaN(reportId) && typeof timestampValue === 'string' && timestampValue) {
                            window.reportLastViewedLogTimestamp.set(reportId, timestampValue);
                        } else {
                            console.warn(`[ReadStatus] Ignoro entry non valida da localStorage: ID='${reportIdStr}', Valore='${timestampValue}'`);
                        }
                    }
                }
                console.log("[ReadStatus] Mappa timestamp caricata da localStorage:", window.reportLastViewedLogTimestamp);
            } else {
                console.warn("[ReadStatus] Dati caricati da localStorage non sono un oggetto:", storedTimestamps);
            }
        } else {
            console.log("[ReadStatus] Nessun dato trovato in localStorage per questa chiave.");
        }
    } catch (e) {
        console.error("[ReadStatus] Errore durante caricamento/parsing da localStorage:", e);
    }
}

function saveReadStatusToStorage(reportId, timestampString) {
    const userId = getCurrentUserId();
    console.log(`[ReadStatus] Tentativo salvataggio per User ID: ${userId}, Report ID: ${reportId}, Timestamp: ${timestampString}`);

    if (!userId) {
        console.warn('[ReadStatus] Salvataggio fallito: User ID mancante.');
        return;
    }
    if (reportId == null) {
        console.warn('[ReadStatus] Salvataggio fallito: Report ID mancante.');
        return;
    }
    if (!timestampString || typeof timestampString !== 'string') {
        console.warn('[ReadStatus] Salvataggio fallito: Timestamp string mancante o non valido.');
        return;
    }

    try {
        if (!(window.reportLastViewedLogTimestamp instanceof Map)) {
             console.error("[ReadStatus] ERRORE CRITICO: window.reportLastViewedLogTimestamp non è una Map valida!");
             window.reportLastViewedLogTimestamp = new Map();
        }
        window.reportLastViewedLogTimestamp.set(reportId, timestampString);
        console.log(`[ReadStatus] Timestamp aggiornato in memoria Map per report ${reportId}. Dimensione Map: ${window.reportLastViewedLogTimestamp.size}`);
    } catch (mapError) {
        console.error(`[ReadStatus] ERRORE CRITICO durante aggiornamento Map per report ${reportId}:`, mapError);
        return;
    }

    const storageKey = `unreadLogTimestamps_${userId}`;
    let storedTimestamps = {};

    try {
        const storedTimestampsJson = localStorage.getItem(storageKey);
        if (storedTimestampsJson) {
            try {
                const parsedData = JSON.parse(storedTimestampsJson);
                if (typeof parsedData === 'object' && parsedData !== null) {
                    storedTimestamps = parsedData;
                } else {
                     console.warn('[ReadStatus] Dati esistenti in localStorage non sono un oggetto, verranno sovrascritti.');
                }
            } catch (parseError) {
                console.error("[ReadStatus] Errore parsing JSON esistente prima del salvataggio, verrà sovrascritto:", parseError);
            }
        }

        storedTimestamps[reportId] = timestampString;

        localStorage.setItem(storageKey, JSON.stringify(storedTimestamps));
        console.log(`[ReadStatus] Timestamp '${timestampString}' persistito in localStorage per report ${reportId}.`);

    } catch (storageError) {
        console.error("[ReadStatus] Errore durante salvataggio in localStorage:", storageError);
    }
}

function ruoliUtente() {
    try {
        const salvati = JSON.parse(localStorage.getItem('userRuoli') || '[]');
        if (Array.isArray(salvati) && salvati.length > 0) return salvati;
    } catch (e) { /* elenco illeggibile: si ripiega sul ruolo singolo */ }
    const singolo = localStorage.getItem('userRole');
    return singolo ? [singolo] : [];
}

// La stessa regola del server.
function haRuolo(...richiesti) {
    const miei = ruoliUtente();
    if (miei.includes('admin')) return true;
    return richiesti.some(r => miei.includes(r));
}

// Decide comunque il server.
function permessiUtente() {
    try {
        const salvati = JSON.parse(localStorage.getItem('userPermessi') || '[]');
        return Array.isArray(salvati) ? salvati : [];
    } catch (e) {
        return [];
    }
}

function haPermesso(...codici) {
    if (haRuolo('admin')) return true;
    const miei = permessiUtente();
    return codici.some(c => miei.includes(c));
}

function salvaRuoliEPermessi(dati) {
    try {
        if (dati?.role) localStorage.setItem('userRole', dati.role);
        if (Array.isArray(dati?.ruoli) && dati.ruoli.length) localStorage.setItem('userRuoli', JSON.stringify(dati.ruoli));
        if (Array.isArray(dati?.permessi)) localStorage.setItem('userPermessi', JSON.stringify(dati.permessi));
    } catch (e) { /* senza memoria si rilegge a ogni pagina */ }
}

function disegnaDpiInDotazione(elenco, dpi) {
    if (!elenco) return;
    elenco.innerHTML = '';

    if (!Array.isArray(dpi) || dpi.length === 0) {
        elenco.innerHTML = '<li style="color: var(--text-muted); padding: 10px 0;">Nessun DPI in dotazione.</li>';
        return;
    }

    const oggi = new Date();
    dpi.forEach(d => {
        const consegna = d.delivery_date ? new Date(d.delivery_date).toLocaleDateString('it-IT') : '—';
        const scadenza = d.expiry_date ? new Date(d.expiry_date) : null;
        const scaduto = scadenza && scadenza < oggi;
        const inScadenza = scadenza && !scaduto &&
            (scadenza - oggi) / 86400000 <= 30;

        const testoScadenza = scadenza
            ? `Scade il <strong>${scadenza.toLocaleDateString('it-IT')}</strong>`
            : 'Senza scadenza';

        // Contrasto 4,5 con il testo bianco.
        const colore = scaduto ? '#c62828' : (inScadenza ? '#9a5b00' : '#047857');
        const parola = scaduto ? 'SCADUTO' : (inScadenza ? 'IN SCADENZA' : 'IN DOTAZIONE');
        const icona = scaduto ? 'triangle-exclamation' : (inScadenza ? 'clock' : 'shield-halved');

        const dettagli = [];
        if (d.size) dettagli.push(`taglia ${d.size}`);
        if (d.matricola) dettagli.push(d.matricola);

        const li = document.createElement('li');
        // In una colonna stretta la pastiglia scende sotto invece di schiacciare il nome.
        li.style.cssText = 'display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light-color); padding: 10px 0; gap: 8px;';
        li.innerHTML = `
            <div style="min-width: 0; flex: 1 1 170px;">
                <strong style="font-size: 1.05rem; color: var(--text-color);">${escapeHTML(d.item_name || '')}</strong>
                ${dettagli.length ? `<span style="font-size: 0.85rem; color: var(--text-muted);"> · ${escapeHTML(dettagli.join(' · '))}</span>` : ''}
                <div style="font-size: 0.85rem; color: var(--text-muted);">Consegnato il ${consegna} | ${testoScadenza}</div>
            </div>
            <span style="background: ${colore}; color: white; padding: 4px 10px; border-radius: 50px; font-size: 0.8rem; font-weight: bold; white-space: nowrap;">
                <i class="fas fa-${icona}"></i> ${parola}
            </span>`;
        elenco.appendChild(li);
    });
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function notifica(testo, tipo = 'info', durata) {
    if (!testo) return;
    if (!document.getElementById('stile-avvisi-orion')) {
        const stile = document.createElement('style');
        stile.id = 'stile-avvisi-orion';
        stile.textContent = `
#avvisi-orion { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 100000;
  display: flex; flex-direction: column; gap: 8px; width: min(520px, calc(100vw - 32px)); pointer-events: none; }
.avviso-orion { pointer-events: auto; cursor: pointer; padding: 12px 16px; border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25); font-size: 0.95rem; line-height: 1.35; white-space: pre-line;
  color: #fff; background: #334155; border-left: 5px solid #94a3b8; }
.avviso-orion.successo { background: #14532d; border-left-color: #22c55e; }
.avviso-orion.errore { background: #7f1d1d; border-left-color: #f87171; }
.avviso-orion.attenzione { background: #78350f; border-left-color: #fbbf24; }`;
        document.head.appendChild(stile);
    }
    let contenitore = document.querySelector('[data-avvisi]') || document.getElementById('avvisi-orion');
    if (!contenitore) {
        contenitore = document.createElement('div');
        contenitore.id = 'avvisi-orion';
        document.body.appendChild(contenitore);
    }
    const avviso = document.createElement('div');
    avviso.className = `avviso-orion ${tipo}`;
    avviso.setAttribute('role', tipo === 'errore' ? 'alert' : 'status');
    avviso.textContent = testo;
    const togli = () => avviso.remove();
    avviso.addEventListener('click', togli);
    contenitore.appendChild(avviso);
    const vecchi = contenitore.querySelectorAll('.avviso-orion');
    for (let i = 0; i < vecchi.length - 3; i++) vecchi[i].remove();
    setTimeout(togli, durata ?? (tipo === 'errore' ? 8000 : 4500));
}
