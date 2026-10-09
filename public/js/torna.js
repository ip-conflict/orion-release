// "Torna a ORION" sui fogli da stampare (rubrica, punto di situazione): si
// aprono in una scheda nuova, e sul telefono chi non lo sa non trova la via
// del ritorno. Si chiude la scheda, o si torna indietro, o si va al centro
// operativo.
document.getElementById('st-torna')?.addEventListener('click', () => {
    if (window.history.length > 1) { window.history.back(); return; }
    window.close();
    setTimeout(() => { window.location.href = '/centro-operativo.html'; }, 300);
});
