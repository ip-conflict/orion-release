// public/js/menu-laterale.js
//
// La barra laterale delle pagine di lavoro, uguale dappertutto.
//
// Prima ogni pagina aveva la sua copia scritta a mano, e le copie si erano
// allontanate: da Sistema non si arrivava alla Segreteria né al Magazzino, da
// Gestione utenti non si arrivava alla Segreteria, dal Magazzino non si
// arrivava alle Squadre. Adesso le voci comuni stanno qui, con una regola sola
// per chi le vede; le pagine tengono in fondo solo le proprie voci (i
// cataloghi della segreteria, le sezioni del profilo).
//
// Gli id delle voci (sidebar-settings, sidebar-magazzino...) restano quelli
// di prima, perché gli script delle pagine li usano ancora.
//
// Va caricato dopo apiHelper.js (serve haRuolo) e prima dello script della
// pagina.
(function () {
    const menu = document.querySelector('.admin-sidebar .sidebar-menu');
    if (!menu || typeof haRuolo !== 'function') return;

    const ruoli = typeof ruoliUtente === 'function' ? ruoliUtente() : [];
    const admin = haRuolo('admin');
    const esterno = !admin && ruoli.includes('esterno');
    // I permessi (src/permessi.js); senza apiHelper aggiornato, come prima: solo l'amministratore.
    const puo = (...codici) => (typeof haPermesso === 'function' ? haPermesso(...codici) : admin);

    // [id, indirizzo, icona, testo, chi la vede]. "moduli" arriva dopo, dalle
    // impostazioni pubbliche: finché non si sa se il modulo è acceso, la voce
    // resta nascosta.
    const VOCI = [
        ['sidebar-centro', '/centro-operativo.html', 'fa-tachometer-alt', 'Centro Operativo', () => true],
        ['sidebar-segreteria', '/admin-segreteria.html', 'fa-folder-open', 'Segreteria', (m) => m.segreteria && puo('volontari.sanitario', 'volontari.anagrafica')],
        ['sidebar-magazzino', '/magazzino.html', 'fa-boxes-stacked', 'Magazzino', (m) => m.magazzino && !esterno],
        ['sidebar-teams', '/admin/squadre.html', 'fa-truck-pickup', 'Squadre', () => !esterno],
        // Gli esterni ci trovano i documenti segnati per l'emergenza.
        ['sidebar-calendario', '/calendario.html', 'fa-calendar-days', 'Calendario', (m) => m.attivita && !esterno],
        ['sidebar-documenti', '/documenti.html', 'fa-book', 'Documenti', () => true],
        ['sidebar-users', '/admin/admin.html', 'fa-users', 'Utenti', () => puo('volontari.anagrafica')],
        ['sidebar-archive', '/admin/archive.html', 'fa-archive', 'Archivio emergenze', () => puo('emergenze.archivio')],
        ['sidebar-funzioni', '/admin/funzioni.html', 'fa-sitemap', 'Funzioni', (m) => m.funzioni && puo('emergenze.funzioni')],
        ['sidebar-settings', '/admin/dashboard-admin.html', 'fa-cogs', 'Impostazioni', () => admin],
        ['sidebar-sistema', '/admin/sistema.html', 'fa-shield-halved', 'Sistema', () => admin],
        ['sidebar-profilo', '/profile.html', 'fa-user-circle', 'Il mio profilo', () => true]
    ];
    const indirizzi = new Set(VOCI.map(v => v[1]));
    const ids = new Set(VOCI.map(v => v[0]));

    // Via le voci comuni scritte a mano nella pagina: restano solo le sue.
    const proprie = [...menu.children].filter(li => {
        if (ids.has(li.id)) return false;
        const link = li.querySelector('a[href]');
        return !(link && indirizzi.has(link.getAttribute('href')));
    });
    menu.replaceChildren();

    const qui = window.location.pathname;
    const voci = VOCI.map(([id, href, icona, testo, vede]) => {
        const li = document.createElement('li');
        li.id = id;
        li.style.display = 'none';
        const a = document.createElement('a');
        a.href = href;
        if (href === qui) {
            a.classList.add('active', 'attivo');
            a.setAttribute('aria-current', 'page');
        }
        const i = document.createElement('i');
        i.className = `fas ${icona}`;
        i.style.width = '20px';
        a.append(i, ` ${testo}`);
        li.appendChild(a);
        menu.appendChild(li);
        return { li, vede };
    });

    if (proprie.length) {
        const separatore = document.createElement('li');
        separatore.className = 'separatore-menu';
        separatore.setAttribute('role', 'separator');
        menu.appendChild(separatore);
        proprie.forEach(li => menu.appendChild(li));
    }

    // Uscire si poteva solo dal Centro Operativo: da qualunque altra pagina
    // bisognava tornare lì per farlo.
    const esci = document.createElement('li');
    esci.id = 'sidebar-esci';
    const linkEsci = document.createElement('a');
    linkEsci.href = '#';
    linkEsci.style.color = 'var(--danger-text)';
    const iconaEsci = document.createElement('i');
    iconaEsci.className = 'fas fa-sign-out-alt';
    iconaEsci.style.width = '20px';
    linkEsci.append(iconaEsci, ' Esci');
    linkEsci.addEventListener('click', async (evento) => {
        evento.preventDefault();
        try { await fetchApi('/logout', { method: 'POST' }); } catch { /* si esce comunque */ }
        ['userRole', 'userRuoli', 'userPermessi', 'username'].forEach(k => { try { localStorage.removeItem(k); } catch { /* niente */ } });
        window.location.href = '/';
    });
    esci.appendChild(linkEsci);
    const separatoreEsci = document.createElement('li');
    separatoreEsci.className = 'separatore-menu';
    separatoreEsci.setAttribute('role', 'separator');
    menu.append(separatoreEsci, esci);

    function mostra(moduli) {
        voci.forEach(({ li, vede }) => { li.style.display = vede(moduli) ? 'block' : 'none'; });
    }

    // I moduli accesi si ricordano dall'ultima pagina: il menu è giusto al
    // primo colpo, invece di comparire con le voci di base e poi allungarsi
    // quando arrivano le impostazioni (passando da una pagina all'altra
    // lampeggiava). Il foglio di stile lo tiene nascosto finché non è pronto.
    const CHIAVE = 'orion.menu.moduli';
    let ricordati = null;
    try { ricordati = JSON.parse(localStorage.getItem(CHIAVE) || 'null'); } catch { /* niente */ }
    mostra(ricordati || { segreteria: false, magazzino: false, funzioni: false, attivita: true });
    menu.classList.add('pronto');
    fetch('/api/branding/settings', { credentials: 'same-origin' })
        .then(r => (r.ok ? r.json() : {}))
        .then(impostazioni => {
            let segreteria = false;
            try {
                const conf = typeof impostazioni.segreteria_config === 'string'
                    ? JSON.parse(impostazioni.segreteria_config) : impostazioni.segreteria_config;
                segreteria = !!conf?.enabled;
            } catch { /* configurazione illeggibile: la voce resta nascosta */ }
            const moduli = {
                segreteria,
                magazzino: String(impostazioni.magazzino_enabled) === 'true',
                funzioni: String(impostazioni.funzioni_enabled) === 'true',
                attivita: String(impostazioni.attivita_enabled) !== 'false'
            };
            mostra(moduli);
            try { localStorage.setItem(CHIAVE, JSON.stringify(moduli)); } catch { /* niente */ }
            // Ruoli e permessi possono essere cambiati dall'ultimo accesso: si
            // rileggono, e il menu si riallinea.
            if (typeof fetchApi === 'function' && typeof salvaRuoliEPermessi === 'function') {
                fetchApi('/api/me/status').then(stato => { salvaRuoliEPermessi(stato); mostra(moduli); }).catch(() => {});
            }
        })
        .catch(() => { /* senza impostazioni restano le voci di base */ });
})();
