// Come si installa Orion Mobile: un APK dal sito dell'associazione, non dal
// Play Store, quindi Android fa qualche domanda in più. I passi dicono le
// scritte esatte che compaiono sul telefono (Android 8 e successivi, Chrome).
//
// La usano la proposta dopo l'accesso (login.js) e la pagina degli accessi
// temporanei (accesso.js).

(function () {
    /**
     * L'elenco numerato dei passi.
     * @param ultimo l'ultimo passo, che cambia: "accedi" o "torna qui e apri nell'app".
     */
    function passiInstallaApp(ultimo) {
        const server = window.location.host;
        const passi = [
            "Tocca il pulsante qui sotto per scaricarla. Se Chrome avvisa che il file potrebbe essere dannoso, tocca «Scarica comunque»: è l'app della tua associazione, solo che non passa dal Play Store.",
            "Apri il file orion.apk dalla notifica del download (o dall'app File, cartella Download).",
            "La prima volta Android dice che per sicurezza non può installare app da questa fonte: tocca «Impostazioni», attiva «Consenti da questa fonte» e torna indietro.",
            "Tocca «Installa». Se Play Protect dice che non conosce l'app, tocca «Installa comunque» (oppure «Altri dettagli» e poi «Installa comunque»).",
            ultimo === 'codice'
                ? "Torna in questa pagina e tocca «Apri nell'app»: entri senza password."
                : `Apri Orion Mobile, scrivi l'indirizzo del server, ${server}, e accedi con il tuo nome utente e la tua password.`
        ];
        const ol = document.createElement('ol');
        ol.className = 'passi-installa-app';
        passi.forEach(t => {
            const li = document.createElement('li');
            li.textContent = t;
            ol.appendChild(li);
        });
        return ol;
    }

    if (!document.getElementById('stile-installa-app')) {
        const stile = document.createElement('style');
        stile.id = 'stile-installa-app';
        stile.textContent = `
.passi-installa-app { margin: 0.25rem 0 0.75rem; padding-left: 1.3rem; font-size: 0.88rem; line-height: 1.45; }
.passi-installa-app li { margin-bottom: 0.4rem; }
.passi-installa-app li.ora { font-weight: 600; }`;
        document.head.appendChild(stile);
    }

    window.passiInstallaApp = passiInstallaApp;
})();
