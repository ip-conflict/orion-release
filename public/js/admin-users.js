// /public/js/admin-users.js
let brandingSettings = {
    association_name: ''
};

async function loadAndApplyBranding() {
    console.log("Caricamento impostazioni di branding e permessi...");
    try {
        const settings = await fetchApi('/api/branding/settings');
        if (settings) {
            if (settings.association_name) {
                brandingSettings.association_name = settings.association_name;
                if (document.title.includes('-')) {
                    const parts = document.title.split('-');
                    document.title = `${parts[0].trim()} - ${settings.association_name}`;
                }
            }
            
            const logoInfo = await fetchApi('/api/branding');
            if (logoInfo && logoInfo.logoUrl) {
                const logoImg = document.getElementById('main-app-logo');
                if (logoImg) logoImg.src = `${logoInfo.logoUrl}?v=${logoInfo.logoVersion}`;
            }

            if (haRuolo('admin')) {
                const sidebarSettings = document.getElementById('sidebar-settings');
                const sidebarUsers = document.getElementById('sidebar-users');
                const sidebarArchive = document.getElementById('sidebar-archive');
                const sidebarSistema = document.getElementById('sidebar-sistema');
                
                if (sidebarSettings) sidebarSettings.style.display = 'block';
                if (sidebarUsers) sidebarUsers.style.display = 'block';
                if (sidebarArchive) sidebarArchive.style.display = 'block';
                if (sidebarSistema) sidebarSistema.style.display = 'block';
            }

            if (settings.segreteria_config) {
                const sConf = typeof settings.segreteria_config === 'string' ? JSON.parse(settings.segreteria_config) : settings.segreteria_config;

                const sidebarSegreteria = document.getElementById('sidebar-segreteria');
                // Il magazzino a chi lo usa, se il modulo è acceso.
            const vociMagazzino = document.getElementById('sidebar-magazzino');
            if (vociMagazzino && String(settings.magazzino_enabled) === 'true' && haPermesso('magazzino.gestione', 'magazzino.consegne')) {
                vociMagazzino.style.display = 'block';
            }

            if (sidebarSegreteria && sConf.enabled && haPermesso('volontari.sanitario', 'volontari.anagrafica')) {
                    sidebarSegreteria.style.display = 'block';
                }
            }
        }
    } catch (error) {
        console.error("Errore durante il caricamento del branding/permessi:", error);
    }
}

if (typeof fetchApi !== 'function' || typeof getToken !== 'function') {
    console.error("ERRORE: Le funzioni helper getToken o fetchApi non sono state caricate prima di admin-users.js!");
    notifica("Errore critico nella configurazione della pagina. Contattare l'amministratore.", 'errore');
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Pagina Gestione Utenti: DOM caricato e script avviato.");
    await loadAndApplyBranding();

    // Selezione Elementi DOM
    const userTableBody = document.getElementById('user-table-body');
    const addUserBtn = document.getElementById('add-user-btn');
    const importUsersBtn = document.getElementById('import-users-btn');
    const importFileInput = document.getElementById('import-file-input');
    const importFeedbackDiv = document.getElementById('import-feedback');

    const addUserModal = document.getElementById('add-user-modal');
    const addUserForm = document.getElementById('add-user-form');
    const closeAddModalBtn = document.getElementById('close-add-modal-btn');
    const cancelAddModalBtn = document.getElementById('cancel-add-modal-btn');
    const addNomeInput = document.getElementById('add-nome');
    const addCognomeInput = document.getElementById('add-cognome');
    const addEmailInput = document.getElementById('add-email');
    const addRuoliBox = document.getElementById('add-ruoli');

    const editUserModal = document.getElementById('edit-user-modal');
    const editUserForm = document.getElementById('edit-user-form');
    const closeEditModalBtn = document.getElementById('close-edit-modal-btn');
    const cancelEditModalBtn = document.getElementById('cancel-edit-modal-btn');
    const editUserIdInput = document.getElementById('edit-user-id');
    const editNomeInput = document.getElementById('edit-nome');
    const editCognomeInput = document.getElementById('edit-cognome');
    const editEmailInput = document.getElementById('edit-email');
    const editRuoliBox = document.getElementById('edit-ruoli');

    // Ruoli
    // I ruoli si sommano: una persona può essere segretaria e magazziniera
    // insieme. "Esterno" fa eccezione, è una limitazione e non si combina con
    // nulla: spuntandolo si spengono gli altri, e spuntando un altro si spegne
    // lui. La stessa regola è scritta nel server e nel database; qui serve solo
    // a non far arrivare il volontario a un messaggio d'errore evitabile.
    const ETICHETTE_RUOLI = {
        admin: 'Amministratore',
        coordinatore: 'Coordinatore',
        segreteria: 'Segreteria',
        magazziniere: 'Magazziniere',
        volontario: 'Volontario',
        esterno: 'Esterno'
    };

    function caselleRuoli(box) {
        return box ? Array.from(box.querySelectorAll('input[type="checkbox"]')) : [];
    }

    function leggiRuoliSelezionati(box) {
        return caselleRuoli(box).filter(c => c.checked).map(c => c.value);
    }

    function impostaRuoliSelezionati(box, ruoli) {
        const scelti = Array.isArray(ruoli) && ruoli.length ? ruoli : ['volontario'];
        caselleRuoli(box).forEach(c => { c.checked = scelti.includes(c.value); });
    }

    function collegaEsclusivitaEsterno(box) {
        caselleRuoli(box).forEach(casella => {
            casella.addEventListener('change', () => {
                if (!casella.checked) return;
                if (casella.value === 'esterno') {
                    caselleRuoli(box).forEach(a => { if (a.value !== 'esterno') a.checked = false; });
                } else {
                    const esterno = caselleRuoli(box).find(a => a.value === 'esterno');
                    if (esterno) esterno.checked = false;
                }
            });
        });
    }

    collegaEsclusivitaEsterno(addRuoliBox);
    collegaEsclusivitaEsterno(editRuoliBox);

    // Chi gestisce l'anagrafica senza essere amministratore vede l'elenco e
    // iscrive i volontari; ruoli, permessi e account restano all'amministratore.
    const amministra = haRuolo('admin');
    if (!amministra) {
        if (importUsersBtn) importUsersBtn.hidden = true;
        const casellaRuoli = addRuoliBox?.parentElement;
        if (casellaRuoli) casellaRuoli.hidden = true;
        const titoloNuovo = addUserModal?.querySelector('h2');
        if (titoloNuovo) titoloNuovo.textContent = 'Nuovo volontario';
    }

    // Permessi in più (src/permessi.js): il catalogo si legge una volta.
    const permessiBox = document.getElementById('edit-permessi');
    const permessiElenco = document.getElementById('edit-permessi-elenco');
    let catalogoPermessi = null;
    async function leggiCatalogo() {
        if (!catalogoPermessi) catalogoPermessi = await fetchApi('/api/permessi/catalogo');
        return catalogoPermessi;
    }

    function permessiDaiRuoli(ruoli) {
        const pacchetti = catalogoPermessi?.pacchetti || {};
        return new Set(ruoli.flatMap(r => pacchetti[r] || []));
    }

    // Le caselle dei permessi: quelle comprese nei ruoli spuntati sono bloccate.
    function aggiornaCasellePermessi() {
        if (!permessiElenco || !catalogoPermessi) return;
        const ruoli = leggiRuoliSelezionati(editRuoliBox);
        const esterno = ruoli.includes('esterno');
        const dalRuolo = permessiDaiRuoli(ruoli);
        permessiElenco.querySelectorAll('input[type="checkbox"]').forEach(c => {
            const compreso = dalRuolo.has(c.value);
            const etichetta = c.closest('label');
            c.disabled = compreso || esterno;
            if (compreso) c.checked = true;
            else if (c.dataset.inPiu !== '1') c.checked = false;
            if (esterno) c.checked = false;
            etichetta?.classList.toggle('dal-ruolo', compreso || esterno);
            etichetta.title = compreso ? 'Compreso nei ruoli' : esterno ? 'Agli esterni non si danno permessi' : '';
        });
    }

    async function preparaPermessi(user) {
        if (!permessiBox || !amministra) return;
        permessiBox.hidden = true;
        try {
            const catalogo = await leggiCatalogo();
            const stato = await fetchApi(`/api/admin/users/${user.id}/permessi`);
            const inPiu = new Set((stato.in_piu || []).map(p => p.permesso));
            permessiElenco.replaceChildren();
            catalogo.categorie.forEach(categoria => {
                const titolo = document.createElement('h4');
                titolo.textContent = categoria;
                permessiElenco.appendChild(titolo);
                catalogo.permessi.filter(p => p.categoria === categoria).forEach(p => {
                    const etichetta = document.createElement('label');
                    const casella = document.createElement('input');
                    casella.type = 'checkbox';
                    casella.value = p.codice;
                    casella.dataset.inPiu = inPiu.has(p.codice) ? '1' : '0';
                    casella.checked = inPiu.has(p.codice);
                    casella.addEventListener('change', () => { casella.dataset.inPiu = casella.checked ? '1' : '0'; });
                    const testo = document.createElement('span');
                    const nome = document.createElement('strong');
                    nome.textContent = p.nome;
                    const descrizione = document.createElement('small');
                    descrizione.textContent = p.descrizione;
                    testo.append(nome, descrizione);
                    etichetta.append(casella, testo);
                    permessiElenco.appendChild(etichetta);
                });
            });
            aggiornaCasellePermessi();
            permessiBox.hidden = false;
        } catch (e) {
            console.error('Permessi non letti:', e);
        }
    }

    // I permessi in più spuntati, senza quelli che arrivano già dai ruoli.
    function permessiInPiuScelti() {
        if (!permessiElenco || permessiBox?.hidden) return null;
        return [...permessiElenco.querySelectorAll('input[type="checkbox"]')].filter(c => c.checked && !c.disabled).map(c => c.value);
    }

    caselleRuoli(editRuoliBox).forEach(c => c.addEventListener('change', aggiornaCasellePermessi));

    const credentialsModal = document.getElementById('credentials-modal');
    const closeCredModalBtn = document.getElementById('close-credentials-modal-btn');
    const okCredBtn = document.getElementById('ok-credentials-btn');
    const copyCredBtn = document.getElementById('copy-credentials-btn');

    if (!userTableBody || !addUserBtn || !importUsersBtn || !addUserModal || !editUserModal || !addUserForm || !editUserForm) {
        console.error("Elementi HTML fondamentali (tabella, bottoni, modali, form) non trovati!");
        return;
    }

    // Interni ed esterni in due schede; fra gli esterni, i temporanei (nati
    // dal centro operativo con il QR) si distinguono dai permanenti.
    const testaTabella = document.getElementById('user-table-head');
    const schede = Array.from(document.querySelectorAll('.gu-scheda'));
    const cercaInput = document.getElementById('cerca-utenti');
    const filtroEsterni = document.getElementById('filtro-esterni');
    const notaEsterni = document.getElementById('nota-esterni');

    let tuttiUtenti = [];
    // Gli avvisi sul telefono di ciascuno: in ascolto adesso, o l'ultimo contatto.
    let telefoni = {};
    let gruppo = 'interni';
    try { if (localStorage.getItem('gestione-utenti-gruppo') === 'esterni') gruppo = 'esterni'; } catch (e) { /* senza memoria si parte dagli interni */ }
    let ordine = { chiave: 'cognome', verso: 1 };

    const eEsterno = (u) => u.temporaneo === true || (u.ruoli && u.ruoli.length ? u.ruoli : [u.role]).includes('esterno');
    const ruoliTesto = (u) => (u.ruoli && u.ruoli.length ? u.ruoli : [u.role]).map(r => ETICHETTE_RUOLI[r] || r).join(', ');

    const COLONNE = {
        interni: [
            { titolo: 'Persona', chiave: 'cognome' }, { titolo: 'Email' }, { titolo: 'Ruoli' }, { titolo: 'Stato', centro: true },
            { titolo: 'Creato il', chiave: 'creato_il' }, { titolo: 'Ultimo accesso', chiave: 'ultimo_accesso' },
            { titolo: 'Azioni', destra: true }
        ],
        esterni: [
            { titolo: 'Persona', chiave: 'cognome' },
            { titolo: 'Ente', chiave: 'ente' }, { titolo: 'Tipo' }, { titolo: 'Stato', centro: true },
            { titolo: 'Creato il', chiave: 'creato_il' }, { titolo: 'Ultimo accesso', chiave: 'ultimo_accesso' },
            { titolo: 'Azioni', destra: true }
        ]
    };

    function dataBreve(valore) {
        if (!valore) return '—';
        return new Date(valore).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function dataCompleta(valore) {
        return valore ? new Date(valore).toLocaleString('it-IT', { dateStyle: 'full', timeStyle: 'short' }) : '';
    }

    // "Oggi, 14:32", "Ieri, 09:10", "3 giorni fa": in sala conta quanto è recente.
    function accessoRelativo(valore) {
        if (!valore) return 'Mai';
        const quando = new Date(valore);
        const minuti = Math.round((Date.now() - quando.getTime()) / 60000);
        if (minuti < 2) return 'Adesso';
        if (minuti < 60) return `${minuti} min fa`;
        const ora = quando.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        const inizioOggi = new Date(); inizioOggi.setHours(0, 0, 0, 0);
        if (quando >= inizioOggi) return `Oggi, ${ora}`;
        const giorni = Math.ceil((inizioOggi - quando) / 86400000);
        if (giorni === 1) return `Ieri, ${ora}`;
        if (giorni < 7) return `${giorni} giorni fa`;
        return dataBreve(valore);
    }

    // Il telefono riceve gli avvisi? Verde: in ascolto adesso. Grigio: registrato,
    // ma non si fa sentire da un po' (spento, senza rete, o avvisi sempre attivi spenti).
    function iconaTelefono(t) {
        if (!t) return '';
        const titolo = t.collegato
            ? 'Avvisi: il telefono è in ascolto adesso'
            : `Avvisi: telefono non in ascolto, ultimo contatto ${accessoRelativo(t.ultimo).toLowerCase()}`;
        return ` <i class="fas fa-mobile-screen gu-telefono${t.collegato ? ' in-ascolto' : ''}" title="${escapeHTML(titolo)}" aria-label="${escapeHTML(titolo)}"></i>`;
    }

    function disegnaTesta() {
        testaTabella.innerHTML = '';
        COLONNE[gruppo].forEach(c => {
            const th = document.createElement('th');
            th.textContent = c.titolo;
            if (c.centro) th.style.textAlign = 'center';
            if (c.destra) th.style.textAlign = 'right';
            if (c.chiave) {
                th.classList.add('gu-ordina');
                if (ordine.chiave === c.chiave) th.classList.add(ordine.verso > 0 ? 'gu-su' : 'gu-giu');
                th.title = 'Ordina';
                th.tabIndex = 0;
                const ordina = () => {
                    // Le date si guardano di solito dalla più recente.
                    const verso = ordine.chiave === c.chiave ? -ordine.verso : (c.chiave.endsWith('_il') || c.chiave === 'ultimo_accesso' ? -1 : 1);
                    ordine = { chiave: c.chiave, verso };
                    disegna();
                };
                th.addEventListener('click', ordina);
                th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ordina(); } });
            }
            testaTabella.appendChild(th);
        });
    }

    function confronta(a, b) {
        const k = ordine.chiave;
        let va = a[k], vb = b[k];
        // I vuoti ("mai", "non si sa") in fondo, in entrambi i versi.
        if (va == null || va === '') return (vb == null || vb === '') ? 0 : 1;
        if (vb == null || vb === '') return -1;
        if (k === 'creato_il' || k === 'ultimo_accesso') return (new Date(va) - new Date(vb)) * ordine.verso;
        const r = String(va).localeCompare(String(vb), 'it', { sensitivity: 'base' });
        return (r || String(a.nome || '').localeCompare(String(b.nome || ''), 'it', { sensitivity: 'base' })) * ordine.verso;
    }

    function disegna() {
        const interni = tuttiUtenti.filter(u => !eEsterno(u));
        const esterni = tuttiUtenti.filter(eEsterno);
        document.getElementById('conta-interni').textContent = `(${interni.length})`;
        document.getElementById('conta-esterni').textContent = `(${esterni.length})`;
        schede.forEach(b => {
            const attiva = b.dataset.gruppo === gruppo;
            b.classList.toggle('attiva', attiva);
            b.setAttribute('aria-selected', String(attiva));
        });
        filtroEsterni.hidden = gruppo !== 'esterni';
        notaEsterni.hidden = gruppo !== 'esterni';
        disegnaTesta();

        let elenco = gruppo === 'esterni' ? esterni : interni;
        if (gruppo === 'esterni' && filtroEsterni.value !== 'tutti') {
            const voglioTemporanei = filtroEsterni.value === 'temporanei';
            elenco = elenco.filter(u => (u.temporaneo === true) === voglioTemporanei);
        }
        const cerca = cercaInput.value.trim().toLowerCase();
        if (cerca) {
            elenco = elenco.filter(u => [u.nome, u.cognome, u.username, u.email, u.ente, u.emergenza]
                .some(v => v && String(v).toLowerCase().includes(cerca)));
        }
        elenco = elenco.slice().sort(confronta);

        const colonne = COLONNE[gruppo].length;
        userTableBody.innerHTML = '';
        if (elenco.length === 0) {
            const vuoto = cerca ? 'Nessun utente corrisponde alla ricerca.'
                : gruppo === 'esterni' ? 'Nessun esterno. I temporanei si creano dal centro operativo, in «Accesso esterno».' : 'Nessun utente trovato.';
            userTableBody.innerHTML = `<tr><td colspan="${colonne}" style="text-align: center;">${escapeHTML(vuoto)}</td></tr>`;
            return;
        }
        elenco.forEach(user => userTableBody.appendChild(rigaUtente(user)));
    }

    function bottone(classe, icona, titolo, azione) {
        const b = document.createElement('button');
        b.className = `button-style button-small ${classe}`;
        b.innerHTML = `<i class="fas ${icona}"></i>`;
        b.title = titolo;
        b.setAttribute('aria-label', titolo);
        if (azione) b.addEventListener('click', azione); else b.disabled = true;
        return b;
    }

    function rigaUtente(user) {
        const currentAdminId = parseInt(localStorage.getItem('userId'), 10);
        const isMe = user.id === currentAdminId;
        const temporaneo = user.temporaneo === true;
        const tr = document.createElement('tr');
        tr.dataset.userId = user.id;

        // Un temporaneo non si sospende: il suo accesso finisce con l'emergenza.
        let stato;
        if (temporaneo) {
            stato = user.is_active && user.emergenza_aperta
                ? '<span class="status-badge active">Attivo</span>'
                : '<span class="status-badge finito" title="Emergenza chiusa o accesso revocato">Finito</span>';
        } else {
            stato = user.is_active ? '<span class="status-badge active">Attivo</span>' : '<span class="status-badge inactive">Sospeso</span>';
        }
        const date = `
            <td class="gu-data" title="${escapeHTML(dataCompleta(user.creato_il))}">${escapeHTML(dataBreve(user.creato_il))}</td>
            <td class="gu-data" title="${escapeHTML(dataCompleta(user.ultimo_accesso))}">${escapeHTML(accessoRelativo(user.ultimo_accesso))}</td>`;

        // Cognome e nome insieme, il nome utente sotto: la tabella resta larga
        // quanto lo schermo anche con le date.
        // Il temporaneo il nome utente non lo usa mai (entra col QR), e dopo un
        // "Cambia persona" sarebbe ancora quello di prima: non lo si mostra.
        const persona = `<td><strong>${escapeHTML([user.cognome, user.nome].filter(Boolean).join(' '))}</strong>` +
            (temporaneo ? '' : `<span class="gu-sotto">${escapeHTML(user.username)}` +
                (user.mfa_attiva ? ' <i class="fas fa-shield-halved gu-mfa" title="Verifica in due passaggi attiva" aria-label="Verifica in due passaggi attiva"></i>' : '') +
                iconaTelefono(telefoni[user.id]) +
                '</span>') + '</td>';
        if (gruppo === 'esterni') {
            const tipo = temporaneo
                ? `<span class="gu-tipo temporaneo">Temporaneo</span>${user.emergenza ? `<span class="gu-sotto">emergenza ${escapeHTML(user.emergenza)}</span>` : ''}`
                : '<span class="gu-tipo">Permanente</span>';
            tr.innerHTML = `
                ${persona}
                <td>${escapeHTML(user.ente || '—')}</td>
                <td>${tipo}</td>
                <td style="text-align: center;">${stato}</td>${date}`;
        } else {
            tr.innerHTML = `
                ${persona}
                <td>${escapeHTML(user.email || '—')}</td>
                <td>${escapeHTML(ruoliTesto(user))}${(user.permessi_in_piu || []).length ? `<span class="gu-permessi-extra" title="${escapeHTML(`Permessi in più: ${user.permessi_in_piu.length}`)}">+${user.permessi_in_piu.length}</span>` : ''}</td>
                <td style="text-align: center;">${stato}</td>${date}`;
        }

        const actionTd = document.createElement('td');
        actionTd.className = 'action-buttons';
        actionTd.style.textAlign = 'right';
        // Senza essere amministratore l'elenco si consulta e basta.
        if (!haRuolo('admin')) {
            tr.appendChild(actionTd);
            return tr;
        }
        if (!temporaneo) {
            actionTd.appendChild(bottone('edit-user-btn', 'fa-edit', `Modifica ${user.username}`, () => openEditUserModal(user)));
            actionTd.appendChild(isMe
                ? bottone(user.is_active ? 'suspend-btn' : 'reactivate-btn', 'fa-user-slash', 'Non puoi sospendere il tuo stesso account')
                : bottone(user.is_active ? 'suspend-btn' : 'reactivate-btn', user.is_active ? 'fa-user-slash' : 'fa-user-check',
                    user.is_active ? `Sospendi ${user.username}` : `Riattiva ${user.username}`,
                    () => handleToggleStatus(user.id, user.username, user.is_active)));
            actionTd.appendChild(isMe
                ? bottone('reset-pwd-btn', 'fa-key', "Usa il 'Mio Profilo' per cambiare la tua password")
                : bottone('reset-pwd-btn', 'fa-key', `Azzera la password di ${user.username}`, () => handleResetPassword(user.id, user.username)));
            // Telefono perso e codici di riserva finiti: la verifica si toglie, e
            // la persona la riattiva.
            if (user.mfa_attiva && !isMe && haRuolo('admin')) {
                actionTd.appendChild(bottone('reset-mfa-btn', 'fa-mobile-screen-button',
                    `Azzera la verifica in due passaggi di ${user.username}`, () => handleAzzeraMfa(user.id, user.username)));
            }
        }
        actionTd.appendChild(isMe
            ? bottone('delete-user-btn', 'fa-trash-alt', 'Non puoi eliminare il tuo stesso account')
            : bottone('delete-user-btn', 'fa-trash-alt', `Elimina ${user.username}`, () => handleDeleteUser(user.id, user.username)));
        tr.appendChild(actionTd);
        return tr;
    }

    schede.forEach(b => b.addEventListener('click', () => {
        gruppo = b.dataset.gruppo;
        try { localStorage.setItem('gestione-utenti-gruppo', gruppo); } catch (e) { /* non indispensabile */ }
        disegna();
    }));
    cercaInput.addEventListener('input', disegna);
    filtroEsterni.addEventListener('change', disegna);

    async function loadUsers() {
        userTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center;">Caricamento...</td></tr>`;
        try {
            const [utenti, statoTelefoni] = await Promise.all([
                fetchApi('/api/admin/users'),
                fetchApi('/api/avvisi/telefoni').catch(() => null)
            ]);
            tuttiUtenti = utenti || [];
            telefoni = statoTelefoni?.telefoni || {};
            disegna();
        } catch (error) {
            userTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: red;">Errore: ${escapeHTML(error.message)}</td></tr>`;
        }
    }

    async function handleToggleStatus(userId, username, currentStatus) {
        // Sospendere chiude subito le sue sessioni: si chiede. Riattivare no.
        if (currentStatus && !window.confirm(`Sospendere ${username}? Esce subito da ORION, sul web e sull'app.`)) return;

        try {
            await fetchApi(`/api/admin/users/${userId}/toggle-status`, { method: 'PATCH' });
            loadUsers();
        } catch (error) {
            console.error(`Errore cambio stato utente ${userId}:`, error);
            notifica(`Errore: ${error.message}`, 'errore');
        }
    }

    async function handleAzzeraMfa(userId, username) {
        if (!window.confirm(`Azzerare la verifica in due passaggi di ${username}? Serve quando ha perso il telefono e i codici di riserva. Esce subito da ORION e, al prossimo accesso, la riattiva (se è amministratore, è obbligato a farlo).`)) return;
        try {
            const r = await fetchApi(`/api/admin/users/${userId}/mfa/azzera`, { method: 'POST' });
            notifica(r.message, 'successo');
            loadUsers();
        } catch (error) {
            notifica(`Errore: ${error.message}`, 'errore');
        }
    }

    async function handleResetPassword(userId, username) {
        if (!userId) return;

        // Chiedi conferma
        if (!window.confirm(`Sei sicuro di voler resettare la password per l'utente '${username}' (ID: ${userId})?\nIl suo accesso attuale verrà bloccato finché non imposterà una nuova password.`)) {
             return;
        }

        console.log(`Richiesta reset password per utente ID: ${userId}`);

        try {
            const result = await fetchApi(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
            
            if (result.emailSent) {
                notifica(`Reset effettuato.\nUn'email con il link di ripristino è stata inviata a ${username}.`, 'successo');
            } else {
                if (result.emailError) {
                    notifica(`Reset effettuato, ma ERRORE EMAIL:\n${result.emailError}\n\nCopia il Magic Link manualmente.`, 'attenzione', 12000);
                }
                // Passa il magicLink al modale
                showCredentialsModal(username, result.magicLink, true);
            }

        } catch (error) {
            console.error(`Errore reset password per utente ${userId}:`, error);
            notifica(`Errore durante il reset della password: ${error.message}`, 'errore');
        } 
    }

    function openAddUserModal() {
        if (addUserForm) addUserForm.reset();
        impostaRuoliSelezionati(addRuoliBox, ['volontario']);
        if(addUserModal) addUserModal.style.display = 'flex';
        if(addNomeInput) addNomeInput.focus();
    }
    function closeAddUserModal() {
        if (addUserModal) addUserModal.style.display = 'none';
    }

    function openEditUserModal(user) {
        if (!editUserModal || !editUserForm || !user) {
             console.error("Impossibile aprire modale modifica: elementi mancanti o utente non fornito.");
             return;
        }
        console.log("Apertura modale modifica per utente:", user);
        editUserIdInput.value = user.id;
        editNomeInput.value = user.nome || '';
        editCognomeInput.value = user.cognome || '';
        editEmailInput.value = user.email || '';
        impostaRuoliSelezionati(editRuoliBox, user.ruoli && user.ruoli.length ? user.ruoli : (user.role ? [user.role] : []));
        preparaPermessi(user);

        editUserModal.style.display = 'flex';
        if(editNomeInput) editNomeInput.focus();
    }
    function closeEditUserModal() {
        if (editUserModal) editUserModal.style.display = 'none';
    }

    // Gestori Submit Form

    async function handleAddUserSubmit(event) {
        event.preventDefault();
        const submitButton = addUserForm.querySelector('button[type="submit"]');
        const ruoli = leggiRuoliSelezionati(addRuoliBox);
        if (ruoli.length === 0) { notifica('Scegli almeno un ruolo.', 'attenzione'); return; }
        const userData = { nome: addNomeInput.value.trim(), cognome: addCognomeInput.value.trim(), email: addEmailInput.value.trim(), ruoli };

        try {
            if(submitButton) { submitButton.disabled = true; submitButton.textContent = "Aggiungo..."; }

            const newUser = await fetchApi('/api/users', { method: 'POST', body: JSON.stringify(userData) });
            closeAddUserModal();
            loadUsers();

            if (newUser.emailSent) {
                notifica(`Utente ${newUser.username} creato.\nEmail con il link di attivazione inviata con successo.`, 'successo');
            } else {
                if (newUser.emailError) {
                    notifica(`Utente creato, ma ERRORE EMAIL:\n${newUser.emailError}\n\nCopia il Magic Link manualmente.`, 'attenzione', 12000);
                }
                // Passa il magicLink al modale
                showCredentialsModal(newUser.username, newUser.magicLink, false, `${userData.nome} ${userData.cognome}`);
            }
        } catch (error) { notifica(`Errore: ${error.message}`, 'errore'); } 
        finally { if(submitButton) { submitButton.disabled = false; submitButton.textContent = "Aggiungi Utente"; } }
    }

    async function handleEditUserSubmit(event) {
        event.preventDefault();
        if (!editUserIdInput || !editNomeInput || !editCognomeInput || !editEmailInput || !editRuoliBox) return;

        const userId = editUserIdInput.value;
        const nome = editNomeInput.value.trim();
        const cognome = editCognomeInput.value.trim();
        const email = editEmailInput.value.trim();
        const ruoli = leggiRuoliSelezionati(editRuoliBox);

        if (!userId || !nome || !cognome || ruoli.length === 0) {
            notifica("Nome, cognome e almeno un ruolo sono obbligatori.", 'attenzione');
            return;
        }

        const updatedUserData = { nome, cognome, email, ruoli };
        console.log(`Invio modifiche per utente ID ${userId}:`, updatedUserData);
        const submitButton = editUserForm.querySelector('button[type="submit"]');

        try {
            if(submitButton) { submitButton.disabled = true; submitButton.textContent = "Salvo..."; }

            const updatedUser = await fetchApi(`/api/users/${userId}`, {
                method: 'PUT',
                body: JSON.stringify(updatedUserData)
            });
            const inPiu = permessiInPiuScelti();
            if (inPiu) {
                const esito = await fetchApi(`/api/admin/users/${userId}/permessi`, { method: 'PUT', body: JSON.stringify({ in_piu: inPiu }) });
                if (esito?.message && esito.message !== 'Nessun cambiamento.') notifica(esito.message, 'successo');
            }
            closeEditUserModal();
            loadUsers();

        } catch (error) {
            console.error(`Errore modifica utente ${userId}:`, error);
            notifica(`Errore durante la modifica dell'utente: ${error.message}\n${error.detail ? error.detail : ''}`, 'errore');
        } finally {
             if(submitButton) { submitButton.disabled = false; submitButton.textContent = "Salva"; }
        }
    }

    // Gestore Eliminazione
    async function handleDeleteUser(userId, username) {
        if (!userId) return;
        // Eliminare cancella i dati personali: per togliere l'accesso solo per
        // un periodo c'è "Sospendi".
        if (!window.confirm(`Eliminare l'utente '${username}'?\n\nSi cancellano i suoi dati personali, la foto e i certificati di visite e corsi. Se compare nello storico delle emergenze, lì resta solo il suo nome.\nNon si torna indietro: per togliergli l'accesso solo per un periodo usa "Sospendi".`)) {
             return;
        }

        console.log(`Richiesta eliminazione utente ID: ${userId}`);

        try {
            const result = await fetchApi(`/api/users/${userId}`, {
                method: 'DELETE'
            });
            
            notifica(result.message || "Utente eliminato con successo.", 'successo');
            loadUsers(); 

        } catch (error) {
            console.error(`Errore eliminazione utente ${userId}:`, error);
            notifica(`Errore durante l'eliminazione dell'utente: ${error.message}`, 'errore');
        }
    }

    // Gestore Importazione

    async function handleImportUsers() {
        if (!importFileInput || !importFeedbackDiv) return;
        const file = importFileInput.files ? importFileInput.files[0] : null;
        if (!file) return notifica('Seleziona un file Excel o CSV.', 'attenzione');

        const formData = new FormData(); formData.append('file', file);
        importUsersBtn.disabled = true; importUsersBtn.textContent = "Importo...";
        importFeedbackDiv.replaceChildren();

        try {
            const result = await fetchApi('/api/admin/import-users', { method: 'POST', body: formData });
            mostraEsitoImport(result);
            importFileInput.value = '';
            loadUsers();
        } catch (error) {
            const p = document.createElement('p');
            p.className = 'esito-import-errore';
            p.textContent = error.message;
            importFeedbackDiv.replaceChildren(p);
        } finally { importUsersBtn.disabled = false; importUsersBtn.textContent = "Importa da file"; }
    }

    // Il resoconto dell'importazione: chi è entrato (con il link da
    // consegnare a mano a chi non ha ricevuto l'email) e quali righe sono
    // rimaste fuori, con il motivo.
    function mostraEsitoImport(result) {
        const d = result.details || {};
        const parti = [];
        const sintesi = document.createElement('p');
        sintesi.className = 'esito-import-sintesi';
        sintesi.textContent = result.message;
        parti.push(sintesi);

        if (d.importati?.length) {
            const titolo = document.createElement('h3');
            titolo.textContent = `Importati (${d.importati.length})`;
            const tabella = document.createElement('table');
            tabella.className = 'tabella-esito-import';
            const intestazione = tabella.insertRow();
            ['Riga', 'Persona', 'Username', 'Attivazione'].forEach(t => {
                const th = document.createElement('th'); th.textContent = t; intestazione.appendChild(th);
            });
            d.importati.forEach(u => {
                const riga = tabella.insertRow();
                riga.insertCell().textContent = u.riga;
                riga.insertCell().textContent = `${u.nome} ${u.cognome}`;
                riga.insertCell().textContent = u.username;
                const cella = riga.insertCell();
                if (u.email_inviata) {
                    cella.textContent = `Email inviata a ${u.email}`;
                } else {
                    const copia = document.createElement('button');
                    copia.type = 'button';
                    copia.className = 'button-style button-secondary';
                    copia.textContent = 'Copia il link';
                    copia.addEventListener('click', async () => {
                        try {
                            await navigator.clipboard.writeText(u.magicLink);
                            copia.textContent = 'Copiato';
                        } catch {
                            notifica(u.magicLink, 'info', 20000);
                        }
                    });
                    cella.appendChild(copia);
                }
            });
            parti.push(titolo, tabella);
            // Senza email: i fogli da consegnare in mano, tutti insieme.
            const daConsegnare = d.importati.filter(u => !u.email_inviata && u.magicLink);
            if (daConsegnare.length) {
                const stampa = document.createElement('button');
                stampa.type = 'button';
                stampa.className = 'button-style';
                stampa.textContent = `Stampa i fogli di attivazione (${daConsegnare.length})`;
                stampa.title = 'Un foglio per persona, con il QR da inquadrare per scegliere la password';
                stampa.addEventListener('click', () => stampaFogliAttivazione(
                    daConsegnare.map(u => ({ nome: u.nome, cognome: u.cognome, username: u.username, link: u.magicLink })),
                    { associazione: brandingSettings.association_name }));
                parti.push(stampa);
            }
        }

        if (d.righe_saltate?.length) {
            const titolo = document.createElement('h3');
            titolo.textContent = `Righe saltate (${d.righe_saltate.length})`;
            const elenco = document.createElement('ul');
            elenco.className = 'righe-saltate-import';
            d.righe_saltate.forEach(r => {
                const li = document.createElement('li');
                li.textContent = `Riga ${r.riga}, ${r.persona}: ${r.motivo}`;
                elenco.appendChild(li);
            });
            parti.push(titolo, elenco);
        }
        importFeedbackDiv.replaceChildren(...parti);
    }


// FUNZIONE PER MOSTRARE IL MODALE CREDENZIALI
    // Il foglio di attivazione della finestra aperta: chi, e il suo link.
    let foglioAperto = null;
    document.getElementById('stampa-credentials-btn')?.addEventListener('click', () => {
        if (foglioAperto) stampaFogliAttivazione([foglioAperto], { associazione: brandingSettings.association_name });
    });

    function showCredentialsModal(username, magicLink, isReset = false, nomeCompleto = '') {
        foglioAperto = magicLink ? { nome: nomeCompleto, cognome: '', username, link: magicLink } : null;
        const stampa = document.getElementById('stampa-credentials-btn');
        if (stampa) stampa.hidden = !magicLink;
        document.getElementById('new-user-username').textContent = username;
        
        const passSpan = document.getElementById('new-user-password');
        
        // Selezioniamo la label in modo sicuro saltando il div contenitore
        const codeContainer = passSpan.parentElement;
        const labelElement = codeContainer.previousElementSibling;
        if (labelElement && labelElement.tagName === 'P') {
            labelElement.innerHTML = `<strong>${magicLink ? 'Link Attivazione:' : 'Password Iniziale:'}</strong>`;
        }
        
        // Se c'è un magic link lo mostra, altrimenti avvisa che si usa la password di default
        passSpan.textContent = magicLink || "Password standard di default";
        passSpan.style.wordBreak = 'break-all';
        passSpan.style.fontSize = '0.9em';
        
        document.getElementById('credentials-modal-title').textContent = isReset ? 'Password Resettata' : 'Utente Creato';
        
        const modalDesc = document.querySelector('#credentials-modal p');
        if (modalDesc) {
            if (isReset) {
                 modalDesc.innerHTML = `La vecchia password non vale più. Con questo link la persona ne sceglie una nuova (vale 7 giorni):<br><strong>stampa il foglio e consegnalo</strong>, oppure copia il link e mandalo privatamente.`;
            } else {
                 modalDesc.innerHTML = `L'utente è stato creato. Con questo link sceglie la sua password (vale 7 giorni):<br><strong>stampa il foglio e consegnalo</strong>, oppure copia il link e mandalo privatamente.`;
            }
        }
        
        const credentialsModal = document.getElementById('credentials-modal');
        if (credentialsModal) credentialsModal.style.display = 'flex';
    }

    // GESTIONE CHIUSURA MODALE CREDENZIALI
    function closeCredentialsModal() {
        if (credentialsModal) credentialsModal.style.display = 'none';
    }
    if (closeCredModalBtn) closeCredModalBtn.addEventListener('click', closeCredentialsModal);
    if (okCredBtn) okCredBtn.addEventListener('click', closeCredentialsModal);

    // Pulsante Aggiungi Utente
    addUserBtn.addEventListener('click', openAddUserModal);

    // Pulsanti Chiusura/Annulla Modali
    if (closeAddModalBtn) closeAddModalBtn.addEventListener('click', closeAddUserModal);
    if (cancelAddModalBtn) cancelAddModalBtn.addEventListener('click', closeAddUserModal);
    if (closeEditModalBtn) closeEditModalBtn.addEventListener('click', closeEditUserModal);
    if (cancelEditModalBtn) cancelEditModalBtn.addEventListener('click', closeEditUserModal);

    // Submit Forms Modali
    if (addUserForm) addUserForm.addEventListener('submit', handleAddUserSubmit);
    if (editUserForm) editUserForm.addEventListener('submit', handleEditUserSubmit);

    // Pulsante Importa
    if (importUsersBtn) importUsersBtn.addEventListener('click', handleImportUsers);

    // GESTIONE PULSANTE COPIA
    if (copyCredBtn) {
        copyCredBtn.addEventListener('click', () => {
            const user = document.getElementById('new-user-username').textContent;
            const pass = document.getElementById('new-user-password').textContent;
            const textToCopy = `Username: ${user}\nLink per scegliere la password (vale 7 giorni): ${pass}`;
            
            navigator.clipboard.writeText(textToCopy).then(() => {
                const originalHtml = copyCredBtn.innerHTML;
                copyCredBtn.innerHTML = '<i class="las la-check"></i> Copiato!';
                copyCredBtn.style.backgroundColor = '#1e7e34';
                
                setTimeout(() => {
                    copyCredBtn.innerHTML = originalHtml;
                    copyCredBtn.style.backgroundColor = '#28a745';
                }, 2000);
            }).catch(err => {
                console.error('Errore nella copia:', err);
                notifica('Il tuo browser impedisce la copia automatica. Seleziona il testo manualmente.', 'attenzione');
            });
        });
    }

    // Caricamento Iniziale
    loadUsers();

    console.log("Setup pagina Gestione Utenti completato.");
});
