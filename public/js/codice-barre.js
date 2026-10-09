// Il codice a barre Code 128 (set B) di un testo: lettere, cifre e
// punteggiatura ASCII. Serve al retro del tesserino, per il codice fiscale:
// 16 caratteri in 211 moduli, che ogni lettore di codici a barre legge.
// Nessuna libreria esterna: la tabella è quella della norma (ISO/IEC 15417).
//
// window.codice128(testo) -> [{ x, w }] le barre, in moduli dall'inizio
// (zona di rispetto esclusa), e il totale dei moduli in .moduli.

(function () {
    // Le larghezze di barra, spazio, barra, spazio, barra, spazio di ogni
    // simbolo, da 0 a 105; 106 è lo stop (con la barra finale in più).
    const SIMBOLI = [
        '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
        '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
        '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
        '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
        '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
        '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
        '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
        '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
        '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
        '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
        '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
    ];
    const INIZIO_B = 104, STOP = 106;

    function codice128(testo) {
        const valori = [...String(testo)].map(c => {
            const v = c.charCodeAt(0) - 32;
            if (v < 0 || v > 94) throw new Error(`Carattere non codificabile: ${c}`);
            return v;
        });
        // Il carattere di controllo: inizio + somma pesata, modulo 103.
        const controllo = valori.reduce((t, v, i) => t + v * (i + 1), INIZIO_B) % 103;
        const sequenza = [INIZIO_B, ...valori, controllo, STOP];
        const barre = [];
        let x = 0;
        sequenza.forEach(s => [...SIMBOLI[s]].forEach((w, i) => {
            const larghezza = Number(w);
            if (i % 2 === 0) barre.push({ x, w: larghezza });
            x += larghezza;
        }));
        barre.moduli = x;
        return barre;
    }

    window.codice128 = codice128;
})();
