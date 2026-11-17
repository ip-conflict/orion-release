// "I miei dispositivi" nel profilo: gli accessi con l'impronta e i telefoni della verifica in due passaggi.
(function () {
    const scheda = document.getElementById('dispositivi');
    if (!scheda) return;
    const $ = (id) => document.getElementById(id);

    function messaggio(testo, errore = false) {
        $('dispositivi-messaggio').textContent = testo || '';
        $('dispositivi-messaggio').classList.toggle('errore', !!errore);
    }

    function quando(data) {
        if (!data) return 'mai';
        const d = new Date(data);
        const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        const giorno = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const giorni = Math.round((giorno(new Date()) - giorno(d)) / 86400000);
        if (giorni === 0) return `oggi alle ${ora}`;
        if (giorni === 1) return `ieri alle ${ora}`;
        return `${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} alle ${ora}`;
    }

    function riga(nome, dettaglio, scollega) {
        const li = document.createElement('li');
        const testo = document.createElement('span');
        testo.textContent = nome;
        const sotto = document.createElement('span');
        sotto.className = 'dispositivo-quando';
        sotto.textContent = dettaglio;
        testo.append(sotto);
        li.append(testo);
        if (scollega) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'button-style button-secondary';
            b.textContent = 'Scollega';
            b.addEventListener('click', scollega);
            li.append(b);
        }
        return li;
    }

    async function carica() {
        let dati;
        try {
            dati = await fetchApi('/api/sessioni/dispositivi');
        } catch {
            scheda.hidden = true;
            return;
        }
        const rinnovi = dati?.rinnovi || [];
        const telefoni = dati?.telefoni || [];
        $('dispositivi-rinnovi').replaceChildren(...rinnovi.map(r => riga(r.dispositivo || 'Telefono',
            `Ultimo uso ${quando(r.usato_il || r.creato_il)} · collegato ${quando(r.creato_il)}`,
            async () => {
                try {
                    const esito = await fetchApi(`/api/app/rinnovo/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
                    await carica();
                    messaggio(esito.message);
                } catch (err) {
                    messaggio(err.message || 'Non riuscito.', true);
                }
            })));
        $('dispositivi-rinnovi-vuoto').hidden = rinnovi.length > 0;
        $('dispositivi-telefoni').replaceChildren(...telefoni.map(t => riga(t.nome || 'Telefono', `Ultimo uso ${quando(t.usato_il || t.creato_il)}`)));
        $('dispositivi-telefoni-vuoto').hidden = telefoni.length > 0;
        $('dispositivi-telefoni-nota').hidden = telefoni.length === 0;
    }

    $('dispositivi-altri-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = $('dispositivi-password').value;
        if (!password) return messaggio('Scrivi la password.', true);
        try {
            const esito = await fetchApi('/api/sessioni/chiudi-le-altre', { method: 'POST', body: JSON.stringify({ password }) });
            $('dispositivi-password').value = '';
            await carica();
            messaggio(esito.message);
        } catch (err) {
            messaggio(err.message || 'Non riuscito.', true);
        }
    });

    carica();

    (async () => {
        const scheda = $('avvisi-sala');
        const spunta = $('avvisi-sala-attivo');
        let stato;
        try { stato = await fetchApi('/api/users/me/avvisi-sala'); } catch { return; }
        if (!stato?.disponibile) return;
        spunta.checked = stato.attivo;
        scheda.hidden = false;
        spunta.addEventListener('change', async () => {
            try {
                await fetchApi('/api/users/me/avvisi-sala', { method: 'PUT', body: JSON.stringify({ attivo: spunta.checked }) });
                $('avvisi-sala-messaggio').textContent = spunta.checked ? 'Avvisi della sala accesi.' : 'Avvisi della sala spenti.';
            } catch (err) {
                spunta.checked = !spunta.checked;
                $('avvisi-sala-messaggio').textContent = err.message;
            }
        });
    })();
})();
