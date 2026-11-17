const scappa = (testo) => String(testo ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Chi apre una pagina che non può vedere riceve una pagina del programma, non HTML nudo.
export function mandaPaginaNegata(res, messaggio) {
    res.status(403).type('html').send(`<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pagina non disponibile - ORION</title>
    <link rel="icon" href="/favicon.ico" type="image/x-icon">
    <link rel="stylesheet" href="/css/theme.css">
    <link rel="stylesheet" href="/css/componenti.css">
    <link rel="stylesheet" href="/css/login.css">
</head>
<body>
    <div class="login-container">
        <div class="login-box pagina-negata">
            <img src="/logo.png" alt="" class="pagina-negata-logo">
            <h2>Questa pagina non è per te</h2>
            <p class="messaggio messaggio-avviso">${scappa(messaggio)}</p>
            <p>Se pensi che dovresti poterla aprire, chiedi a un amministratore.</p>
            <a class="button-style" href="/centro-operativo.html">Torna al centro operativo</a>
        </div>
    </div>
</body>
</html>`);
}
