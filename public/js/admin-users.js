// /public/js/admin-users.js
let brandingSettings = {
    association_name: 'Archivio Emergenze' 
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
            if (vociMagazzino && String(settings.magazzino_enabled) === 'true' && haRuolo('magazziniere')) {
                vociMagazzino.style.display = 'block';
            }

            if (sidebarSegreteria && sConf.enabled && haRuolo('segreteria')) {
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

    const credentialsModal = document.getElementById('credentials-modal');
    const closeCredModalBtn = document.getElementById('close-credentials-modal-btn');
    const okCredBtn = document.getElementById('ok-credentials-btn');
    const copyCredBtn = document.getElementById('copy-credentials-btn');

    if (!userTableBody || !addUserBtn || !importUsersBtn || !addUserModal || !editUserModal || !addUserForm || !editUserForm) {
        console.error("Elementi HTML fondamentali (tabella, bottoni, modali, form) non trovati!");
        return;
    }

    async function loadUsers() {
        console.log("Caricamento lista utenti...");
        userTableBody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Caricamento...</td></tr>'; 

        // Recuperiamo il nostro ID per bloccare i tasti sulla nostra riga
        const currentAdminId = parseInt(localStorage.getItem('userId'), 10);

        try {
            const users = await fetchApi('/api/admin/users'); 
            userTableBody.innerHTML = ''; 

            if (!users || users.length === 0) {
                userTableBody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Nessun utente trovato.</td></tr>';
                return;
            }

            users.forEach(user => {
                const isMe = user.id === currentAdminId;
                const tr = document.createElement('tr');
                tr.dataset.userId = user.id;

                // Creazione Badge di Stato
                const statusBadge = user.is_active 
                    ? `<span class="status-badge active">Attivo</span>` 
                    : `<span class="status-badge inactive">Sospeso</span>`;

                tr.innerHTML = `
                    <td>${escapeHTML(user.nome)}</td>
                    <td>${escapeHTML(user.cognome)}</td>
                    <td>${escapeHTML(user.username)}</td>
                    <td>${escapeHTML(user.email)}</td>
                    <td>${escapeHTML((user.ruoli && user.ruoli.length ? user.ruoli : [user.role]).map(r => ETICHETTE_RUOLI[r] || r).join(', '))}</td>
                    <td style="text-align: center;">${statusBadge}</td>
                `;

                // Cella Azioni
                const actionTd = document.createElement('td');
                actionTd.className = 'action-buttons';

                // Bottone Modifica (Sempre visibile)
                const editBtn = document.createElement('button');
                editBtn.className = 'button-style button-small edit-user-btn';
                editBtn.title = `Modifica Utente ${user.username}`;
                editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                editBtn.addEventListener('click', () => openEditUserModal(user));
                actionTd.appendChild(editBtn);

                // Bottone Abilita/Disabilita
                const toggleBtn = document.createElement('button');
                toggleBtn.className = `button-style button-small ${user.is_active ? 'suspend-btn' : 'reactivate-btn'}`;
                toggleBtn.innerHTML = user.is_active ? '<i class="fas fa-user-slash"></i>' : '<i class="fas fa-user-check"></i>';
                
                if (isMe) {
                    toggleBtn.disabled = true;
                    toggleBtn.title = "Non puoi sospendere il tuo stesso account";
                } else {
                    toggleBtn.title = user.is_active ? 'Sospendi Utente' : 'Riattiva Utente';
                    toggleBtn.addEventListener('click', () => handleToggleStatus(user.id, user.username, user.is_active));
                }
                actionTd.appendChild(toggleBtn);

                // Bottone Reset Password
                const resetPwdBtn = document.createElement('button');
                resetPwdBtn.className = 'button-style button-small reset-pwd-btn';
                resetPwdBtn.innerHTML = '<i class="fas fa-key"></i>';
                if (isMe) {
                    resetPwdBtn.disabled = true;
                    resetPwdBtn.title = "Usa il 'Mio Profilo' per cambiare la tua password";
                } else {
                    resetPwdBtn.title = `Resetta Password Utente ${user.username}`;
                    resetPwdBtn.addEventListener('click', () => handleResetPassword(user.id, user.username));
                }
                actionTd.appendChild(resetPwdBtn);

                // Bottone Elimina
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'button-style button-small delete-user-btn';
                deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                if (isMe) {
                    deleteBtn.disabled = true;
                    deleteBtn.title = "Non puoi eliminare il tuo stesso account";
                } else {
                    deleteBtn.title = `Elimina Utente ${user.username}`;
                    deleteBtn.addEventListener('click', () => handleDeleteUser(user.id, user.username));
                }
                actionTd.appendChild(deleteBtn);

                tr.appendChild(actionTd);
                userTableBody.appendChild(tr);
            });
        } catch (error) {
            userTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: red;">Errore: ${escapeHTML(error.message)}</td></tr>`;
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
                showCredentialsModal(newUser.username, newUser.magicLink, false);
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
        if (!window.confirm(`Sei sicuro di voler eliminare l'utente '${username}' (ID: ${userId})?\nL'azione è irreversibile.`)) {
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
    function showCredentialsModal(username, magicLink, isReset = false) {
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
                 modalDesc.innerHTML = `La password dell'utente è stata resettata per motivi di sicurezza.<br><strong>Copia e invia privatamente le nuove credenziali all'utente</strong> per permettergli di accedere.`;
            } else {
                 modalDesc.innerHTML = `L'utente è stato creato e abilitato con successo.<br>Comunica all'utente il suo <strong>Username</strong> e la sua <strong>Password Temporanea</strong> generata dal sistema.`;
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
            const textToCopy = `Username: ${user}\nPassword Temporanea: ${pass}`;
            
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
