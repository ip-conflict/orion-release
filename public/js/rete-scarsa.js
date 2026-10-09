// Il centro operativo con la rete che va e viene. Tre cose:
//
// la situazione salvata: le letture principali (segnalazioni, squadre, mappa,
// eventi) si tengono nel browser, e se il server non risponde la pagina
// mostra l'ultima situazione ricevuta, con l'ora, invece di svuotarsi;
//
// la coda: le scritture che contano (nuova segnalazione, nota, cambio di
// stato, priorità, diario di sala) partono con una chiave di idempotenza; se
// la risposta non arriva restano in coda e si rimandano da sole quando il
// server torna, senza doppioni (il server riconosce la chiave);
//
// i conflitti: un cambio di stato rimandato porta lo stato che aveva davanti
// chi l'ha deciso; se nel frattempo qualcun altro l'ha cambiato, il server
// non scrive e la coda lo dice.
//
// Avvolge fetchApi di apiHelper.js: chi non chiede niente non vede differenze.

(function () {
    const fetchOriginale = window.fetchApi;
    if (typeof fetchOriginale !== 'function' || window.OrionRete) return;

    const PREFISSO = 'orion.salvato:';
    const INDICE = 'orion.salvato.indice';
    const CODA = 'orion.coda';
    const ESITI = 'orion.coda.esiti';
    const MASSIMO_SALVATI = 80;
    const ATTESA_LETTURA_MS = 15000;
    const ATTESA_SCRITTURA_MS = 20000;
    const PROVA_OGNI_MS = 10000;

    let salvabili = [];
    let senzaRete = false;
    let datiDel = null;   // ora della situazione mostrata quando manca il server
    let prova = null;
    let invioInCorso = false;
    let elencoAperto = false;

    const utente = () => String(typeof getCurrentUserId === 'function' ? (getCurrentUserId() ?? '') : '');

    function leggi(chiave, predefinito) {
        try { return JSON.parse(localStorage.getItem(chiave)) ?? predefinito; } catch { return predefinito; }
    }
    function scrivi(chiave, valore) {
        try { localStorage.setItem(chiave, JSON.stringify(valore)); return true; } catch { return false; }
    }

    // Il server non c'è (o non risponde in tempo): da non confondere con un
    // "no" del server, che è una risposta e va mostrata com'è.
    function irraggiungibile(e) {
        if (!e) return false;
        if (e.manutenzione) return false;
        if (e.status === undefined) return true;
        return e.status === 502 || e.status === 503 || e.status === 504;
    }

    function chiaveNuova() {
        if (window.crypto?.randomUUID) return crypto.randomUUID();
        const a = new Uint8Array(16);
        crypto.getRandomValues(a);
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }

    async function conAttesa(url, opzioni, ms) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        try {
            return await fetchOriginale(url, { ...opzioni, signal: ctrl.signal });
        } catch (e) {
            if (e?.name === 'AbortError') {
                const err = new Error('Il server non ha risposto in tempo.');
                throw err; // senza status: conta come irraggiungibile
            }
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }

    // --- Situazione salvata -------------------------------------------------

    function salva(url, dati) {
        const indice = leggi(INDICE, []).filter(v => v.url !== url);
        indice.push({ url, quando: Date.now() });
        while (indice.length > MASSIMO_SALVATI) {
            const via = indice.shift();
            try { localStorage.removeItem(PREFISSO + via.url); } catch { /* niente */ }
        }
        const voce = { utente: utente(), quando: Date.now(), dati };
        if (!scrivi(PREFISSO + url, voce)) {
            // Spazio finito: via la metà più vecchia e un altro tentativo.
            indice.splice(0, Math.floor(indice.length / 2)).forEach(v => {
                try { localStorage.removeItem(PREFISSO + v.url); } catch { /* niente */ }
            });
            if (!scrivi(PREFISSO + url, voce)) return;
        }
        scrivi(INDICE, indice);
    }

    function salvato(url) {
        const voce = leggi(PREFISSO + url, null);
        if (!voce || voce.utente !== utente()) return null;
        return voce;
    }

    function dimenticaTutto() {
        leggi(INDICE, []).forEach(v => { try { localStorage.removeItem(PREFISSO + v.url); } catch { /* niente */ } });
        try { localStorage.removeItem(INDICE); } catch { /* niente */ }
    }

    // --- Stato della rete ---------------------------------------------------

    function persa(quando) {
        if (quando && (!datiDel || quando < datiDel)) datiDel = quando;
        if (!senzaRete) {
            senzaRete = true;
            document.dispatchEvent(new CustomEvent('orion:rete', { detail: { senzaRete: true } }));
        }
        if (!prova) prova = setInterval(provaServer, PROVA_OGNI_MS);
        disegna();
    }

    function tornata() {
        if (!senzaRete) { inviaCoda(); return; }
        senzaRete = false;
        datiDel = null;
        clearInterval(prova);
        prova = null;
        disegna();
        inviaCoda().finally(() => {
            // Chi mostra la situazione la ricarica: è cambiata mentre mancava.
            document.dispatchEvent(new CustomEvent('orion:rete', { detail: { senzaRete: false } }));
        });
    }

    async function provaServer() {
        try {
            await conAttesa('/api/emergencies/status', {}, ATTESA_LETTURA_MS);
            tornata();
        } catch (e) {
            if (!irraggiungibile(e)) tornata(); // risponde, anche se dice di no
        }
    }

    window.addEventListener('online', provaServer);
    window.addEventListener('offline', () => persa());

    // --- Coda ---------------------------------------------------------------

    function coda() { return leggi(CODA, []).filter(v => v.utente === utente()); }
    function salvaCoda(elenco) {
        const altri = leggi(CODA, []).filter(v => v.utente !== utente());
        scrivi(CODA, [...altri, ...elenco]);
    }
    function esiti() { return leggi(ESITI, []).filter(v => v.utente === utente()); }
    function aggiungiEsito(voce, messaggio) {
        const tutti = leggi(ESITI, []);
        tutti.push({ id: voce.id, utente: voce.utente, descrizione: voce.descrizione, messaggio, quando: Date.now() });
        scrivi(ESITI, tutti.slice(-30));
    }

    function mettiInCoda(url, opzioni, chiave, descrizione) {
        const elenco = coda();
        elenco.push({
            id: chiave, utente: utente(), url, metodo: opzioni.method || 'POST',
            corpo: typeof opzioni.body === 'string' ? opzioni.body : null,
            chiave, descrizione, quando: Date.now()
        });
        salvaCoda(elenco);
        disegna();
    }

    async function inviaCoda() {
        if (invioInCorso) return;
        invioInCorso = true;
        let inviate = 0;
        try {
            for (const voce of coda()) {
                try {
                    await conAttesa(voce.url, {
                        method: voce.metodo,
                        body: voce.corpo ?? undefined,
                        headers: { 'Idempotency-Key': voce.chiave }
                    }, ATTESA_SCRITTURA_MS);
                    inviate++;
                } catch (e) {
                    if (irraggiungibile(e)) { persa(); return; }
                    // "La stessa richiesta è ancora in corso": si riprova al giro dopo.
                    if (e.status === 409 && e.body?.in_corso) return;
                    // Sessione scaduta: resta in coda, partirà dopo il nuovo accesso.
                    if (e.status === 401) return;
                    // Il server ha detto di no (un conflitto, un dato non più valido):
                    // non si insiste, si lascia scritto perché qualcuno guardi.
                    aggiungiEsito(voce, e.message || `Errore ${e.status}`);
                    notifica(`Non inviato: ${voce.descrizione}.\n${e.message || ''}`, 'errore', 12000);
                }
                salvaCoda(coda().filter(v => v.id !== voce.id));
                disegna();
            }
        } finally {
            invioInCorso = false;
            if (inviate > 0) notifica(inviate === 1 ? 'Inviata la cosa rimasta in coda.' : `Inviate le ${inviate} cose rimaste in coda.`, 'successo');
            disegna();
        }
    }

    // --- fetchApi avvolta ---------------------------------------------------

    window.fetchApi = async function (url, opzioni = {}) {
        const metodo = (opzioni.method || 'GET').toUpperCase();
        const { coda: descrizione, ...resto } = opzioni;

        if (url === '/logout') { dimenticaTutto(); }

        if (metodo === 'GET') {
            const daSalvare = salvabili.some(r => r.test(url));
            try {
                const dati = await conAttesa(url, resto, ATTESA_LETTURA_MS);
                if (daSalvare) salva(url, dati);
                if (senzaRete) tornata();
                return dati;
            } catch (e) {
                if (!irraggiungibile(e)) throw e;
                const voce = daSalvare ? salvato(url) : null;
                persa(voce?.quando);
                if (voce) return voce.dati;
                throw e;
            }
        }

        if (!descrizione) {
            const dati = await fetchOriginale(url, opzioni);
            if (senzaRete) tornata();
            return dati;
        }

        // Una scrittura che può aspettare: con la chiave, e in coda se non passa.
        const chiave = chiaveNuova();
        const conChiave = { ...resto, headers: { ...(resto.headers || {}), 'Idempotency-Key': chiave } };
        // Con altre cose già in coda si mette in fila dietro di loro: l'ordine conta.
        if (senzaRete || coda().length > 0) {
            mettiInCoda(url, conChiave, chiave, descrizione);
            if (!senzaRete) inviaCoda();
            return { in_coda: true };
        }
        try {
            const dati = await conAttesa(url, conChiave, ATTESA_SCRITTURA_MS);
            return dati;
        } catch (e) {
            if (!irraggiungibile(e)) throw e;
            mettiInCoda(url, conChiave, chiave, descrizione);
            persa();
            return { in_coda: true };
        }
    };

    // --- Fascia in alto -----------------------------------------------------

    function ora(ms) {
        return new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }

    function disegna() {
        if (!document.body) return;
        let fascia = document.getElementById('rete-scarsa');
        const inCoda = coda();
        const falliti = esiti();
        if (!senzaRete && inCoda.length === 0 && falliti.length === 0) { fascia?.remove(); return; }
        if (!fascia) {
            fascia = document.createElement('div');
            fascia.id = 'rete-scarsa';
            fascia.setAttribute('role', 'status');
            document.body.appendChild(fascia);
        }
        fascia.className = senzaRete ? 'senza-rete' : (inCoda.length ? 'in-coda' : 'non-inviati');
        const parti = [];
        if (senzaRete) {
            parti.push(`<strong>Il server non risponde.</strong> ${datiDel ? `Stai vedendo la situazione delle ${ora(datiDel)}.` : ''} Non ricaricare la pagina: senza server non si riaprirebbe. Riprovo da solo ogni ${PROVA_OGNI_MS / 1000} secondi.`);
        }
        if (inCoda.length) parti.push(`${inCoda.length === 1 ? '1 cosa in attesa' : `${inCoda.length} cose in attesa`} di invio.`);
        if (falliti.length) parti.push(`${falliti.length === 1 ? '1 cosa non inviata' : `${falliti.length} cose non inviate`}: da guardare.`);
        fascia.innerHTML = `<span>${parti.join(' ')}</span>
            <button type="button" class="rete-dettagli">Vedi</button>
            ${senzaRete ? '<button type="button" class="rete-riprova">Riprova ora</button>' : ''}
            <div class="rete-elenco" ${elencoAperto ? '' : 'hidden'}></div>`;
        fascia.querySelector('.rete-riprova')?.addEventListener('click', provaServer);
        const elenco = fascia.querySelector('.rete-elenco');
        if (elencoAperto) disegnaElenco(elenco);
        fascia.querySelector('.rete-dettagli').addEventListener('click', () => {
            elencoAperto = elenco.hidden;
            elenco.hidden = !elencoAperto;
            if (elencoAperto) disegnaElenco(elenco);
        });
    }

    function disegnaElenco(box) {
        const inCoda = coda();
        const falliti = esiti();
        box.innerHTML = `
            ${inCoda.length ? `<h4>In attesa di invio</h4><ul>${inCoda.map(v =>
                `<li>${escapeHTML(v.descrizione)} <small>dalle ${ora(v.quando)}</small>
                 <button type="button" data-togli="${escapeHTML(v.id)}" title="Non mandarla più">Togli</button></li>`).join('')}</ul>` : ''}
            ${falliti.length ? `<h4>Non inviate: il server ha detto di no</h4><ul>${falliti.map(v =>
                `<li>${escapeHTML(v.descrizione)}<br><small>${escapeHTML(v.messaggio)}</small>
                 <button type="button" data-visto="${escapeHTML(v.id)}">Ho visto</button></li>`).join('')}</ul>` : ''}
            ${!inCoda.length && !falliti.length ? '<p>Niente in coda.</p>' : ''}`;
        box.querySelectorAll('[data-togli]').forEach(b => b.addEventListener('click', () => {
            salvaCoda(coda().filter(v => v.id !== b.dataset.togli));
            disegna();
        }));
        box.querySelectorAll('[data-visto]').forEach(b => b.addEventListener('click', () => {
            scrivi(ESITI, leggi(ESITI, []).filter(v => v.id !== b.dataset.visto));
            disegna();
        }));
    }

    window.OrionRete = {
        /** Le letture (espressioni sull'indirizzo) da tenere per quando manca il server. */
        salvaLetture(espressioni) { salvabili = espressioni; },
        get senzaRete() { return senzaRete; },
        coda,
        inviaCoda,
        dimenticaTutto
    };

    // Rimasta in coda da prima di chiudere la pagina: si prova subito.
    document.addEventListener('DOMContentLoaded', () => {
        disegna();
        if (coda().length) inviaCoda();
    });
})();
