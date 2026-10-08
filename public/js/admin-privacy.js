// public/js/admin-privacy.js
//
// Impostazioni › Condizioni d'uso: il testo (vuoto = quello proposto da
// ORION) e chi non ha ancora accettato la versione in vigore. "Pubblica" crea
// una versione nuova, che tutti accettano di nuovo.

(function () {
    const $ = (id) => document.getElementById(id);
    if (!$('pannello-privacy')) return;
    let predefinite = '';

    function mostra(stato) {
        predefinite = stato.predefiniti.condizioni;
        $('privacy-testo-condizioni').value = stato.testi.condizioni;
        if (stato.testi.condizioni) $('privacy-testi').open = true;

        const riquadro = $('privacy-stato');
        riquadro.replaceChildren();
        const riga = (testo) => {
            const p = document.createElement('div');
            p.textContent = testo;
            riquadro.appendChild(p);
        };
        riga(`Versione in vigore: ${stato.versione}${stato.pubblicata_il ? `, pubblicata il ${new Date(stato.pubblicata_il).toLocaleDateString('it-IT')}` : ' (quella proposta da ORION)'}.`);
        riga(`${stato.con_presa_visione === 1 ? "Le ha accettate 1 persona" : `Le hanno accettate ${stato.con_presa_visione} persone`} su ${stato.attivi} con un account attivo.`);
        const elenco = $('privacy-elenco-mancanti');
        elenco.replaceChildren(...stato.senza_presa_visione.map(u => {
            const li = document.createElement('li');
            li.textContent = `${u.cognome || ''} ${u.nome || ''}`.trim() || u.username;
            return li;
        }));
        $('privacy-mancanti').hidden = stato.senza_presa_visione.length === 0;
        $('privacy-mancanti').querySelector('summary').textContent =
            `Chi non le ha ancora accettate (${stato.attivi - stato.con_presa_visione})`;
    }

    async function carica() {
        try { mostra(await fetchApi('/api/admin/informativa')); }
        catch (e) { $('privacy-stato').textContent = `Impossibile leggere le condizioni d'uso: ${e.message}`; }
    }

    $('privacy-usa-predefinite').addEventListener('click', () => { $('privacy-testo-condizioni').value = predefinite; });

    $('privacy-pubblica').addEventListener('click', async () => {
        if (!confirm("Pubblicare questa versione? Al prossimo accesso tutti dovranno rileggere e accettare le condizioni d'uso.")) return;
        const bottone = $('privacy-pubblica');
        bottone.disabled = true;
        // Un testo uguale a quello proposto si salva vuoto: così segue gli aggiornamenti di ORION.
        const v = $('privacy-testo-condizioni').value.trim();
        try {
            const esito = await fetchApi('/api/admin/informativa', {
                method: 'PUT',
                body: JSON.stringify({ testi: { condizioni: v === predefinite.trim() ? '' : v } })
            });
            mostra(esito);
            notifica(esito.message, 'successo');
        } catch (e) {
            notifica(e.message, 'errore');
        } finally {
            bottone.disabled = false;
        }
    });

    carica();
})();
