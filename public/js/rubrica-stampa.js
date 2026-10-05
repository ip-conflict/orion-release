// public/js/rubrica-stampa.js
//
// La rubrica d'emergenza su carta (rubrica.html): intestazione, data e una
// tabella per gruppo. I contatti si aggiungono dal centro operativo.

(async function () {
    const foglio = document.getElementById('st-foglio');
    document.getElementById('st-stampa').addEventListener('click', () => window.print());
    const e = (v) => escapeHTML(v == null ? '' : String(v));
    try {
        const [contatti, marchio, impostazioni] = await Promise.all([
            fetchApi('/api/rubrica'),
            fetchApi('/api/branding').catch(() => null),
            fetchApi('/api/branding/settings').catch(() => null)
        ]);
        const logo = marchio?.logoUrl ? `${marchio.logoUrl}?v=${marchio.logoVersion}` : null;
        const associazione = impostazioni?.association_name || '';
        const oggi = new Date().toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        foglio.innerHTML = `
            <header class="st-testa">
                ${logo ? `<img src="${e(logo)}" alt="">` : ''}
                <div>
                    ${associazione ? `<p class="st-ente">${e(associazione)}</p>` : ''}
                    <h1>Rubrica d'emergenza</h1>
                </div>
            </header>
            <div class="st-meta"><span>Stampata il <strong>${e(oggi)}</strong></span><span><strong>${contatti.length}</strong> contatti</span></div>`;
        window.Rubrica.disegnaFoglio(contatti, foglio);
        foglio.insertAdjacentHTML('beforeend', '<p class="st-piede">Generata da ORION. I numeri cambiano: ristampala dopo ogni aggiornamento.</p>');
    } catch (err) {
        foglio.innerHTML = `<div class="st-errore"><p><strong>La rubrica non si è potuta caricare.</strong></p><p>${e(err.message)}</p></div>`;
    }
    foglio.setAttribute('aria-busy', 'false');
})();
