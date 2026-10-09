// I fogli di attivazione da stampare: uno per volontario, con nome, username,
// il QR del suo link e tre righe di istruzioni. Per i gruppi senza posta
// configurata, o per chi non ha un'email: si consegnano in mano alla prima
// riunione, e chi riceve il foglio inquadra il QR e sceglie la password.
// Il link vale 7 giorni: scaduto, dalla pagina Utenti "Reset password" ne fa
// uno nuovo, da ristampare.

(function () {
    const testo = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Il QR come immagine: la libreria lo disegna in un elemento nascosto.
    function qrImmagine(link) {
        const scatola = document.createElement('div');
        scatola.style.cssText = 'position:absolute;left:-9999px;top:0';
        document.body.append(scatola);
        try {
            new QRCode(scatola, { text: link, width: 300, height: 300, correctLevel: QRCode.CorrectLevel.M });
            const tela = scatola.querySelector('canvas');
            return tela ? tela.toDataURL('image/png') : scatola.querySelector('img')?.src || '';
        } finally {
            scatola.remove();
        }
    }

    // persone: [{ nome, cognome, username, link }]
    window.stampaFogliAttivazione = function (persone, { associazione = '' } = {}) {
        const conLink = (persone || []).filter(p => p.link);
        if (!conLink.length) return;
        const finestra = window.open('', '_blank');
        if (!finestra) { notifica('Il browser ha bloccato la finestra di stampa: consenti i popup per ORION.', 'attenzione'); return; }
        const scade = new Date(Date.now() + 7 * 24 * 3600000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
        const fogli = conLink.map(p => `
            <section class="foglio">
                <div class="testa">${testo(associazione)}</div>
                <h1>Benvenuto in ORION, ${testo(p.nome || '')} ${testo(p.cognome || '')}</h1>
                <div class="corpo">
                    <img src="${qrImmagine(p.link)}" alt="QR di attivazione">
                    <ol>
                        <li>Inquadra il QR con la fotocamera del telefono e tocca il link che compare.</li>
                        <li>Scegli la tua password (almeno 12 caratteri, con maiuscole, minuscole, un numero e un simbolo).</li>
                        <li>Da quel momento entri con il nome utente <strong>${testo(p.username)}</strong> e la tua password. Su Android ORION ti propone l'app Orion Mobile: installala.</li>
                    </ol>
                </div>
                <p class="nota">Il QR vale fino al ${scade} e una volta sola: non darlo ad altri. Se scade, chiedi un foglio nuovo a chi gestisce ORION.</p>
                <p class="link">${testo(p.link)}</p>
            </section>`).join('');
        finestra.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8">
            <title>Fogli di attivazione</title>
            <style>
                @page { size: A4; margin: 14mm; }
                body { font: 15px/1.45 system-ui, sans-serif; color: #111; margin: 0; }
                .foglio { border: 1px dashed #999; border-radius: 8px; padding: 18px 22px; margin: 0 0 14mm; page-break-inside: avoid; break-inside: avoid; }
                .foglio:nth-child(2n) { page-break-after: always; break-after: page; }
                .testa { font-size: 0.85rem; text-transform: uppercase; letter-spacing: .05em; color: #555; }
                h1 { font-size: 1.3rem; margin: 4px 0 12px; }
                .corpo { display: flex; gap: 18px; align-items: center; }
                .corpo img { width: 150px; height: 150px; flex: none; }
                ol { margin: 0; padding-left: 20px; }
                li { margin-bottom: 6px; }
                .nota { font-size: 0.85rem; color: #444; margin: 12px 0 4px; }
                .link { font: 0.7rem monospace; color: #666; word-break: break-all; margin: 0; }
            </style></head><body>${fogli}</body></html>`);
        finestra.document.close();
        finestra.addEventListener('load', () => finestra.print());
        setTimeout(() => { try { finestra.print(); } catch { /* già stampato */ } }, 600);
    };
})();
