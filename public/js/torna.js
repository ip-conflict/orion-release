// I fogli da stampare si aprono in una scheda nuova: sul telefono chi non lo sa non trova la
// via del ritorno.
document.getElementById('st-torna')?.addEventListener('click', () => {
    if (window.history.length > 1) { window.history.back(); return; }
    window.close();
    setTimeout(() => { window.location.href = '/centro-operativo.html'; }, 300);
});
