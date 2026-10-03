// public/js/accesso.js
//
// L'accesso degli esterni temporanei: la pagina che si apre inquadrando il QR
// dato dal centro operativo (o toccando il link arrivato per email o
// WhatsApp). Il codice è nell'indirizzo; il server lo scambia con una
// sessione da esterno che vale fino alla chiusura dell'emergenza.
//
// Sul telefono Android propone l'app: in squadra, è lei che manda la
// posizione al centro operativo anche con lo schermo spento.

document.addEventListener('DOMContentLoaded', async () => {
    const $ = (id) => document.getElementById(id);
    const contenuto = $('contenuto');
    const codice = new URLSearchParams(window.location.search).get('c') || '';

    const aggiungi = (tag, testo, classe) => {
        const e = document.createElement(tag);
        if (testo) e.textContent = testo;
        if (classe) e.className = classe;
        contenuto.appendChild(e);
        return e;
    };

    try {
        const marchio = await fetch('/api/branding').then(r => r.json());
        if (marchio.logoUrl) { $('logo').src = `${marchio.logoUrl}?v=${marchio.logoVersion}`; $('logo').hidden = false; }
    } catch { /* senza logo si entra lo stesso */ }

    if (!codice) {
        $('titolo').textContent = 'Manca il codice';
        aggiungi('p', 'Inquadra di nuovo il QR che ti hanno dato al centro operativo, o apri il link completo.', 'errore');
        return;
    }

    let dati;
    try {
        const risposta = await fetch('/api/accesso-temporaneo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codice })
        });
        dati = await risposta.json().catch(() => ({}));
        if (!risposta.ok) throw new Error(dati.message || `Errore ${risposta.status}`);
    } catch (e) {
        $('titolo').textContent = 'Accesso non riuscito';
        aggiungi('p', e.message, 'errore');
        return;
    }

    // Gli stessi dati che salva la pagina di login: le altre pagine li leggono.
    try {
        localStorage.setItem('userId', String(dati.userId));
        localStorage.setItem('userRole', dati.role);
        localStorage.setItem('userRuoli', JSON.stringify(dati.ruoli || [dati.role]));
        localStorage.setItem('username', dati.username);
    } catch { /* senza localStorage alcune pagine chiedono di nuovo l'accesso */ }

    const nome = [dati.nome, dati.cognome].filter(Boolean).join(' ');
    $('titolo').textContent = `Ciao ${dati.nome || nome || ''}`.trim();
    aggiungi('p', `Sei dentro ORION${dati.ente ? ` come ${dati.ente}` : ''} per l'emergenza in corso. ` +
        "L'accesso finisce da solo quando l'emergenza viene chiusa.");
    const mappa = aggiungi('a', 'Apri la mappa del centro operativo', 'pulsante');
    mappa.href = '/centro-operativo.html';

    // L'app, sui telefoni Android e se l'associazione la distribuisce.
    if (!/Android/i.test(navigator.userAgent || '')) return;
    let offerta = null;
    try {
        const r = await fetch('/api/app/offerta', { headers: { Authorization: `Bearer ${dati.token}` } });
        if (r.ok) offerta = await r.json();
    } catch { /* senza app si usa il web */ }
    if (!offerta?.disponibile) return;

    const app = aggiungi('div', null, 'app');
    const titolo = document.createElement('strong');
    titolo.textContent = "Meglio con l'app Orion Mobile";
    app.appendChild(titolo);
    const perche = document.createElement('p');
    perche.className = 'piccolo';
    perche.textContent = 'Se sei in una squadra, il centro operativo ti vede sulla mappa anche con il telefono in tasca, e ricevi gli interventi.';
    app.appendChild(perche);
    const passi = document.createElement('ol');
    ['Scarica e installa l\'app (Android chiede di consentire l\'installazione dal browser).',
     'Torna qui e tocca «Apri nell\'app»: entri senza password.'].forEach(t => {
        const li = document.createElement('li');
        li.textContent = t;
        passi.appendChild(li);
    });
    app.appendChild(passi);
    const scarica = document.createElement('a');
    scarica.className = 'pulsante secondario';
    scarica.href = offerta.scarica;
    scarica.textContent = `Scarica Orion Mobile${offerta.versione ? ` ${offerta.versione}` : ''}`;
    app.appendChild(scarica);
    // L'app riconosce questo indirizzo: server e codice, e chiede conferma
    // prima di entrare.
    const apri = document.createElement('a');
    apri.className = 'pulsante';
    apri.href = `orionmobile://accesso?server=${encodeURIComponent(window.location.origin)}&c=${encodeURIComponent(codice)}`;
    apri.textContent = "Apri nell'app";
    app.appendChild(apri);
});
