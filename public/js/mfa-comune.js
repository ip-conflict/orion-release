// I pezzi della verifica in due passaggi che servono sia alla pagina d'accesso
// sia al profilo: il QR da inquadrare con l'app e i codici di riserva da
// mettere da parte.

window.OrionMfa = (function () {
    // Il QR con l'indirizzo otpauth:// che le app di autenticazione leggono, e
    // sotto la chiave da scrivere a mano per chi non può inquadrarlo.
    function disegnaQr(contenitore, uri, segreto) {
        contenitore.replaceChildren();
        const riquadro = document.createElement('div');
        riquadro.className = 'mfa-qr';
        contenitore.append(riquadro);
        if (typeof QRCode === 'function') {
            new QRCode(riquadro, { text: uri, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
        }
        const chiave = document.createElement('p');
        chiave.className = 'mfa-chiave';
        chiave.append('Non riesci a inquadrarlo? Nell\'app scegli di inserire la chiave a mano e scrivi: ');
        const codice = document.createElement('code');
        codice.textContent = (segreto || '').match(/.{1,4}/g)?.join(' ') || '';
        chiave.append(codice);
        contenitore.append(chiave);
    }

    function testoCodici(codici) {
        return 'ORION - codici di riserva della verifica in due passaggi\n' +
            'Ognuno vale una volta sola, quando non hai il telefono.\n\n' +
            codici.map((c, i) => `${String(i + 1).padStart(2, ' ')}. ${c}`).join('\n') + '\n';
    }

    // L'elenco dei codici con Copia e Scarica.
    function mostraCodici(contenitore, codici) {
        contenitore.replaceChildren();
        const elenco = document.createElement('ol');
        elenco.className = 'mfa-codici-elenco';
        for (const c of codici) {
            const li = document.createElement('li');
            li.textContent = c;
            elenco.append(li);
        }
        const azioni = document.createElement('div');
        azioni.className = 'mfa-codici-azioni';
        const copia = document.createElement('button');
        copia.type = 'button';
        copia.className = 'button-style button-secondary';
        copia.textContent = 'Copia';
        copia.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(testoCodici(codici));
                copia.textContent = 'Copiati';
            } catch {
                copia.textContent = 'Copia non riuscita: selezionali a mano';
            }
        });
        const scarica = document.createElement('button');
        scarica.type = 'button';
        scarica.className = 'button-style button-secondary';
        scarica.textContent = 'Scarica';
        scarica.addEventListener('click', () => {
            const url = URL.createObjectURL(new Blob([testoCodici(codici)], { type: 'text/plain;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'orion-codici-di-riserva.txt';
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        azioni.append(copia, scarica);
        contenitore.append(elenco, azioni);
    }

    return { disegnaQr, mostraCodici };
})();
