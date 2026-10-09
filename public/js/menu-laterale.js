// La barra laterale comune a tutte le pagine di lavoro; le pagine aggiungono in
// fondo solo le proprie voci. Va caricato dopo apiHelper.js e prima dello
// script della pagina.
(function () {
    const menu = document.querySelector('.admin-sidebar .sidebar-menu');
    if (!menu || typeof haRuolo !== 'function') return;

    const ruoli = typeof ruoliUtente === 'function' ? ruoliUtente() : [];
    const admin = haRuolo('admin');
    const esterno = !admin && ruoli.includes('esterno');
    const puo = (...codici) => (typeof haPermesso === 'function' ? haPermesso(...codici) : admin);

    // [id, indirizzo, icona, testo, chi la vede]. "moduli" arriva dopo, dalle
    // impostazioni pubbliche: finché non si sa se il modulo è acceso, la voce
    // resta nascosta.
    const VOCI = [
        ['sidebar-centro', '/centro-operativo.html', 'fa-tachometer-alt', 'Centro Operativo', () => true],
        ['sidebar-segreteria', '/admin-segreteria.html', 'fa-folder-open', 'Segreteria', (m) => m.segreteria && puo('volontari.sanitario', 'volontari.anagrafica')],
        ['sidebar-magazzino', '/magazzino.html', 'fa-boxes-stacked', 'Magazzino', (m) => m.magazzino && !esterno],
        ['sidebar-teams', '/admin/squadre.html', 'fa-truck-pickup', 'Squadre', () => !esterno],
        ['sidebar-calendario', '/calendario.html', 'fa-calendar-days', 'Calendario', (m) => m.attivita && !esterno],
        ['sidebar-simulazioni', '/simulazioni.html', 'fa-clapperboard', 'Simulazioni', (m) => m.attivita && !esterno && puo('gruppo.attivita')],
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

    // I moduli accesi dell'ultima pagina, per non far lampeggiare il menu
    // mentre arrivano le impostazioni.
    const CHIAVE = 'orion.menu.moduli';
    let ricordati = null;
    try { ricordati = JSON.parse(localStorage.getItem(CHIAVE) || 'null'); } catch { /* niente */ }
    mostra(ricordati || { segreteria: false, magazzino: false, funzioni: false, attivita: true });
    menu.classList.add('pronto');

    const testa = document.querySelector('.admin-sidebar .sidebar-header');
    const barra = document.querySelector('.admin-sidebar');
    if (testa && barra && !testa.querySelector('.apri-menu')) {
        if (!menu.id) menu.id = 'menu-pagine';
        const apri = document.createElement('button');
        apri.type = 'button';
        apri.className = 'apri-menu';
        apri.setAttribute('aria-expanded', 'false');
        apri.setAttribute('aria-controls', menu.id);
        apri.innerHTML = '<i class="fas fa-bars" aria-hidden="true"></i> Menu';
        apri.addEventListener('click', () => {
            const aperto = barra.classList.toggle('menu-aperto');
            apri.setAttribute('aria-expanded', String(aperto));
            apri.innerHTML = aperto ? '<i class="fas fa-xmark" aria-hidden="true"></i> Chiudi' : '<i class="fas fa-bars" aria-hidden="true"></i> Menu';
        });
        testa.appendChild(apri);
    }
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
            // Ruoli e permessi possono essere cambiati dall'ultimo accesso.
            if (typeof fetchApi === 'function' && typeof salvaRuoliEPermessi === 'function') {
                fetchApi('/api/me/status').then(stato => { salvaRuoliEPermessi(stato); mostra(moduli); }).catch(() => {});
            }
        })
        .catch(() => { /* senza impostazioni restano le voci di base */ });
})();

// Sul telefono una tabella più larga dello schermo diventa un elenco di schede,
// così i pulsanti a destra restano visibili.
(function () {
    const stretto = window.matchMedia('(max-width: 700px)');
    let inAttesa = false;
    function aSchede(tabella) {
        if (tabella.id === 'user-table' || tabella.classList.contains('no-schede')) return;
        const contenitore = tabella.parentElement;
        if (!tabella.classList.contains('a-schede') && tabella.scrollWidth <= contenitore.clientWidth + 2) return;
        const titoli = [...tabella.querySelectorAll('thead th')].map(th => th.textContent.trim());
        if (!titoli.length) return;
        tabella.querySelectorAll('tbody tr').forEach(tr => [...tr.cells].forEach((td, i) => {
            if (titoli[i] && !td.dataset.etichetta) td.dataset.etichetta = titoli[i];
        }));
        tabella.classList.add('a-schede');
    }
    function controlla() {
        inAttesa = false;
        if (stretto.matches) document.querySelectorAll('table.admin-table').forEach(aSchede);
    }
    new MutationObserver(() => {
        if (!inAttesa) { inAttesa = true; requestAnimationFrame(controlla); }
    }).observe(document.body, { childList: true, subtree: true });
    controlla();
})();
