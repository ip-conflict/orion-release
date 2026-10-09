// L'accettazione delle condizioni d'uso. Si arriva qui dal controllo
// d'accesso (al primo accesso e quando il testo cambia), con ?redirect= la
// pagina da cui si veniva; oppure dal profilo e dalla pagina di accesso, solo
// per rileggere. Senza sessione il testo si legge e basta.

(function () {
    const $ = (id) => document.getElementById(id);
    const parametri = new URLSearchParams(location.search);
    // Solo un indirizzo di questo sito: un redirect verso fuori non si segue.
    const redirect = (() => {
        const r = parametri.get('redirect') || '';
        return r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/informativa.html') ? r : null;
    })();
    let versione = null;

    // Testo semplice: "# " titolo, "## " capitolo, righe vuote fra i paragrafi.
    // Il titolo va nella testata del riquadro.
    function impagina(testo, contenitore, testata) {
        contenitore.replaceChildren();
        String(testo || '').split(/\n\s*\n/).forEach(blocco => {
            const righe = blocco.trim();
            if (!righe) return;
            let nodo;
            if (righe.startsWith('## ')) { nodo = document.createElement('h3'); nodo.textContent = righe.slice(3); }
            else if (righe.startsWith('# ')) { testata.textContent = righe.slice(2); return; }
            else { nodo = document.createElement('p'); nodo.textContent = righe.replace(/\s*\n\s*/g, ' '); }
            contenitore.appendChild(nodo);
        });
    }

    function mostraTesto(dati) {
        versione = dati.versione;
        impagina(dati.condizioni, $('testo-condizioni'), $('titolo-condizioni'));
        $('versione').textContent = `versione ${dati.versione}`;
    }

    function errore(testo) {
        $('errore').textContent = testo;
        $('errore').hidden = !testo;
    }

    function soloLettura(nota) {
        $('pagina').classList.add('sola-lettura');
        $('presa-visione').hidden = true;
        $('solo-lettura').hidden = false;
        $('gia-vista').textContent = nota || '';
        $('torna').href = redirect || (document.referrer && new URL(document.referrer).origin === location.origin ? document.referrer : '/');
    }

    async function carica() {
        // Il nome dell'associazione nella testata, se c'è.
        fetch('/api/branding/settings').then(r => r.ok ? r.json() : null)
            .then(s => { if (s?.association_name) $('associazione').textContent = s.association_name; }).catch(() => {});
        fetch('/api/branding').then(r => r.ok ? r.json() : null)
            .then(l => { if (l?.logoUrl) $('logo').src = `${l.logoUrl}?v=${l.logoVersion || ''}`; }).catch(() => {});
        try {
            const dati = await fetchApi('/api/informativa');
            mostraTesto(dati);
            if (dati.presa_visione && !redirect) {
                soloLettura(`Le hai accettate il ${new Date(dati.presa_visione.il).toLocaleDateString('it-IT')}.`);
            } else {
                $('introduzione').hidden = false;
                $('presa-visione').hidden = false;
            }
        } catch (e) {
            // Senza sessione: il testo pubblico, da leggere.
            if (e.status === 401 || e.status === 403) {
                try {
                    const r = await fetch('/api/pubblico/informativa');
                    mostraTesto(await r.json());
                    soloLettura('');
                } catch { errore("Non è stato possibile leggere le condizioni d'uso. Riprova fra poco."); }
                return;
            }
            errore(e.message || "Non è stato possibile leggere le condizioni d'uso.");
        }
    }

    const aggiornaPulsante = () => { $('continua').disabled = !$('accetto-condizioni').checked; };
    $('accetto-condizioni').addEventListener('change', aggiornaPulsante);

    $('presa-visione').addEventListener('submit', async (e) => {
        e.preventDefault();
        errore('');
        $('continua').disabled = true;
        try {
            await fetchApi('/api/informativa/presa-visione', { method: 'POST', body: JSON.stringify({ versione }) });
            location.href = redirect || '/';
        } catch (err) {
            // Il testo è cambiato mentre si leggeva: si ricarica e si rilegge.
            if (err.status === 409) {
                $('accetto-condizioni').checked = false;
                await carica();
            }
            errore(err.message);
            aggiornaPulsante();
        }
    });

    // Chi non le accetta esce: senza, ORION non si usa.
    $('esci').addEventListener('click', async () => {
        try { await fetchApi('/logout', { method: 'POST' }); } catch { /* si esce comunque */ }
        try { localStorage.removeItem('userRole'); localStorage.removeItem('userRuoli'); localStorage.removeItem('userPermessi'); localStorage.removeItem('username'); } catch { /* niente */ }
        location.href = '/';
    });

    carica();
})();
