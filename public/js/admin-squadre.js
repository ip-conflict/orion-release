// /public/js/admin-squadre.js

// Gli id con "prefisso" sono il nome radio (nome_radio nell'API).
const newTeamBtn = document.getElementById('admin-new-team-btn');
const squadreTableBody = document.getElementById('admin-squadre-tbody');

const adminCreateModal = document.getElementById('adminCreateSquadraModal');
const closeAdminCreateBtn = document.getElementById('closeAdminCreateSquadraModal');
const cancelAdminCreateBtn = document.getElementById('cancelAdminCreateSquadraBtn');
const adminCreateForm = document.getElementById('adminCreateSquadraForm');
const adminCreatePrefixSelect = document.getElementById('admin-create-squadra-prefisso'); 
const adminCreateNameInput = document.getElementById('admin-create-squadra-nome');    
const adminCreateSearchInput = document.getElementById('admin-create-member-search');
const adminAvailableList = document.getElementById('admin-create-membri-disponibili');
const adminSelectedList = document.getElementById('admin-create-membri-selezionati');
const adminAddBtn = document.getElementById('admin-add-member-btn');
const adminRemoveBtn = document.getElementById('admin-remove-member-btn');

const adminEditModal = document.getElementById('adminEditSquadraModal');
const closeAdminEditBtn = document.getElementById('closeAdminEditSquadraModal');
const cancelAdminEditBtn = document.getElementById('cancelAdminEditSquadraBtn');
const adminEditForm = document.getElementById('adminEditSquadraForm');
const adminEditPrefixSelect = document.getElementById('admin-edit-squadra-prefisso'); 
const adminEditNameInput = document.getElementById('admin-edit-squadra-nome');    
const adminEditSearchInput = document.getElementById('admin-edit-member-search');
const adminEditAvailableList = document.getElementById('admin-edit-membri-disponibili');
const adminEditCurrentList = document.getElementById('admin-edit-membri-attuali');
const adminEditAddBtn = document.getElementById('admin-edit-add-member-btn');
const adminEditRemoveBtn = document.getElementById('admin-edit-remove-member-btn');
const adminEditTeamIdHidden = document.getElementById('admin-edit-team-id-hidden');
const adminEditTeamIdDisplay = document.getElementById('admin-edit-team-id-display');
const adminEditTeamPrefixDisplay = document.getElementById('admin-edit-team-prefix-display'); 

const adminTeamDetailPanel = document.getElementById('admin-team-detail-panel');
const closeTeamDetailBtn = document.getElementById('close-team-detail-btn');
const teamDetailPrefixSpan = document.getElementById('team-detail-prefix');           
const teamDetailOptionalNameSpan = document.getElementById('team-detail-optional-name'); 
const teamDetailMemberListUl = document.getElementById('team-detail-member-list');

let currentEditingTeamData = null; 
let currentAvailableMembersCreate = [];
let currentAvailableMembersEdit = [];
let currentlyShownTeamIdAdmin = null; 
let usedPrefixes = new Set(); 

let brandingSettings = {
    association_name: 'Amministrazione Squadre'
};
let segreteriaConfig = { enabled: false, block_on_medical: false, block_on_course: false };

// NOMI RADIO DELLE SQUADRE (alfabeto fonetico)
const NOMI_RADIO = [
    'Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 
    'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 
    'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 
    'X-ray', 'Yankee', 'Zulu'
];

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

            const puoAmministrare = haRuolo('admin');
            
            // Svela i link base dell'Admin
            if (puoAmministrare) {
                const sidebarSettings = document.getElementById('sidebar-settings');
                const sidebarUsers = document.getElementById('sidebar-users');
                const sidebarArchive = document.getElementById('sidebar-archive');
                const sidebarSistema = document.getElementById('sidebar-sistema');
                
                if (sidebarSettings) sidebarSettings.style.display = 'block';
                if (sidebarUsers) sidebarUsers.style.display = 'block';
                if (sidebarArchive) sidebarArchive.style.display = 'block';
                if (sidebarSistema) sidebarSistema.style.display = 'block';
            }

            // Svela il link Segreteria (Solo se Modulo Attivo + Ruolo Corretto)
            if (settings.segreteria_config) {
                const sConf = typeof settings.segreteria_config === 'string' ? JSON.parse(settings.segreteria_config) : settings.segreteria_config;
                
                if (typeof segreteriaConfig !== 'undefined') {
                    segreteriaConfig = sConf;
                }

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

function populateSelectList(selectElement, usersArray) {
    if (!selectElement) {
         console.error("Elemento Select non fornito a populateSelectList");
         return;
    }
    selectElement.innerHTML = '';

    if (!usersArray || usersArray.length === 0) {
        return;
    }

    usersArray.forEach(user => {
        const option = document.createElement('option');
        option.value = user.username || '';

        const userText = `${user.nome || ''} ${user.cognome || ''} (${user.username || ''})`;
        // Fine definizione corretta

        option.textContent = userText;


         option.dataset.userId = user.id || '';
         option.dataset.nome = user.nome || '';
         option.dataset.cognome = user.cognome || '';
        selectElement.appendChild(option);
    });
}

function populatePrefixDropdown(selectElement, usedPrefixesSet, currentPrefixForEdit = null) {
    if (!selectElement) return;
    while (selectElement.options.length > 1) {
         selectElement.remove(1);
    } 
    let firstAvailable = null;
    let shouldAddCurrentPrefixOption = false;
    // Aggiungi i nomi radio disponibili
    NOMI_RADIO.forEach(prefix => {
        const isUsed = usedPrefixesSet.has(prefix);
        const isCurrentPrefix = (prefix === currentPrefixForEdit);

        // NASCONDI (non aggiungere) se è usato E NON è quello attualmente modificato
        if (!isUsed || isCurrentPrefix) { 
            const option = document.createElement('option');
            option.value = prefix;
            option.textContent = prefix + (isCurrentPrefix ? ' (attuale)' : '');
            selectElement.appendChild(option);

            // Se non è usato, potrebbe essere il primo disponibile
            if (!isUsed && firstAvailable === null) {
                firstAvailable = prefix;
            }
        } 
    });
// Logica di Pre-selezione
    let valueToSelect = "";

    if (currentPrefixForEdit) {
        // Siamo in MODIFICA: seleziona il nome radio attuale della squadra
        valueToSelect = currentPrefixForEdit;
    } else if (firstAvailable) {
        // Siamo in CREAZIONE e abbiamo trovato un nome radio libero: suggeriscilo
        valueToSelect = firstAvailable; 
        console.log(`Suggerito primo nome radio disponibile: ${firstAvailable}`);
    }

    selectElement.value = valueToSelect;
}

function populateUserSelectList(selectElement, usersArray) {
    if (!selectElement) return;
    selectElement.innerHTML = ''; 
    if (!usersArray || usersArray.length === 0) return;

    usersArray.forEach(user => {
        const option = document.createElement('option');
        option.value = user.username || ''; 
        option.textContent = `${user.nome || ''} ${user.cognome || ''} (${user.username || ''})`;
        option.dataset.userId = user.id || '';
        option.dataset.nome = user.nome || '';
        option.dataset.cognome = user.cognome || '';
        selectElement.appendChild(option);
    });
}
// Fine Funzioni Helper

// L'ultimo elenco caricato: serve ad aprire una squadra dall'indirizzo.
let ultimeSquadre = [];

// Arrivo dal Centro Operativo (?da=centro): chiusa la finestra di creazione o
// di modifica si torna là, dove si stava lavorando.
const parametriPagina = new URLSearchParams(window.location.search);
function tornaAlCentroSeRichiesto() {
    if (parametriPagina.get('da') === 'centro') window.location.href = '/centro-operativo.html';
}

async function loadSquadreAdmin() {
    if (!squadreTableBody) {
        console.error("Elemento tbody '#admin-squadre-tbody' non trovato.");
        return;
    }
    squadreTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">Caricamento squadre...</td></tr>';

    try {
        const squadre = await fetchApi('/api/squadre');

        usedPrefixes.clear();
        if (squadre && squadre.length > 0) {
            squadre.forEach(s => {
                if (s.nome_radio) {
                    usedPrefixes.add(s.nome_radio);
                }
            });
        }
        console.log("Nomi attualmente in uso:", usedPrefixes); 
        
        squadreTableBody.innerHTML = '';
        ultimeSquadre = squadre || [];

        if (!squadre || squadre.length === 0) {
            squadreTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">Nessuna squadra trovata.</td></tr>';
            return;
        }

        // Itera su ogni squadra ricevuta
        squadre.forEach(squadra => {
            const tr = document.createElement('tr');
            tr.dataset.teamId = squadra.id;
            tr.style.cursor = 'pointer';
            
            // Cliccando la riga si apre direttamente il modale di modifica
            tr.addEventListener('click', () => {
                openEditModalAdmin(squadra);
            });

            const memberCount = squadra.membri ? squadra.membri.length : 0;
            const prefixChar = squadra.nome_radio ? squadra.nome_radio.charAt(0).toUpperCase() : '?';

            // HTML della riga in stile Moderno
            tr.innerHTML = `
                <td>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: var(--text-color); font-size: 1rem; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                            ${escapeHTML(prefixChar)}
                        </div>
                        <strong style="font-size: 1rem; color: var(--text-color);">${escapeHTML(squadra.nome_radio || 'N/D')}</strong>
                    </div>
                </td>
                <td style="color: var(--text-muted); font-weight: 500;">
                    ${squadra.nome ? escapeHTML(squadra.nome) : '<em style="opacity: 0.6;">Nessuna descrizione</em>'}
                </td>
                <td>
                    <span class="bollino info">
                        <i class="fas fa-users"></i> ${memberCount} Volontari
                    </span>
                </td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="btn-icon-action btn-delete-record delete-btn" title="Elimina" data-team-id="${squadra.id}"><i class="fas fa-trash"></i></button>
                </td>
            `;

            // Agganciamo solo l'evento per eliminare, la modifica scatta cliccando la riga intera
            const deleteBtn = tr.querySelector('.delete-btn');
            if (deleteBtn) {
                const currentTeamId = squadra.id;
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteSquadraAdmin(currentTeamId, squadra.nome_radio);
                });
            }

            squadreTableBody.appendChild(tr);
        });

    } catch (error) {
        console.error("Errore caricamento squadre:", error);
        squadreTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: red; padding: 20px;">Errore caricamento: ${escapeHTML(error.message)}</td></tr>`;
    }
} 
async function deleteSquadraAdmin(teamId, teamPrefix) {
    if (!teamId) return;
    const confirmMsg = `Sei sicuro di voler eliminare la squadra ${teamPrefix || ''} (ID: ${teamId})? \nATTENZIONE: Verranno rimosse anche le assegnazioni dei membri e le eventuali assegnazioni a segnalazioni!`;
    
    if (confirm(confirmMsg)) {
        console.log(`Tentativo di eliminare squadra ${teamPrefix} (ID: ${teamId})`);
        try { 
            await fetchApi(`/api/squadre/${teamId}`, { method: 'DELETE' });
            loadSquadreAdmin();
             // Chiudi pannello dettagli se era aperta questa squadra
            if(currentlyShownTeamIdAdmin === teamId) {
                closeTeamDetailsPanel();
            }
        } catch (error) { 
            console.error(`Errore durante l'eliminazione della squadra ${teamId}:`, error);
            notifica(`Errore durante l'eliminazione: ${error.message}`, 'errore');
        } 
    } else {
        console.log(`Eliminazione squadra ${teamId} annullata.`);
    }
}

// Apre il modale di creazione e carica gli utenti
async function openCreateModalAdmin() {
    if (!adminCreateModal || !adminCreateForm) return;
    adminCreateForm.reset(); 
    window.currentSelectedMembersCreate = [];
    adminSelectedList.innerHTML = ''; 
    adminAvailableList.innerHTML = '<li style="padding: 15px; text-align: center;">Caricamento utenti...</li>'; 
    populatePrefixDropdown(adminCreatePrefixSelect, usedPrefixes); 

    adminCreateModal.style.display = 'flex';
    
    currentAvailableMembersCreate = await fetchApi('/api/users/unassigned') || [];
    filterAvailableMembersCreate();
    renderUserList(adminSelectedList, window.currentSelectedMembersCreate, false, 'create');
}

// Chiude il modale di creazione
function closeCreateModalAdmin() {
    if (!adminCreateModal) return;
    adminCreateModal.style.display = 'none';
    console.log("Modale creazione chiuso.");
    tornaAlCentroSeRichiesto();
}

async function loadAvailableUsersForCreateModal() { 
    console.log("Caricamento utenti NON ASSEGNATI da API per modale creazione...");
    if (!adminAvailableList) return; 
    adminAvailableList.innerHTML = '<option>Caricamento utenti...</option>'; 
    try {
        currentAvailableMembersCreate = await fetchApi('/api/users/unassigned') || [];
        console.log(`Caricati ${currentAvailableMembersCreate.length} utenti non assegnati.`);
        populateUserSelectList(adminAvailableList, currentAvailableMembersCreate);
        // Filtra subito se c'è già del testo nel campo ricerca
        filterAvailableMembersCreate(); 
    } catch (error) {
        console.error("Errore caricamento utenti non assegnati:", error);
        if(adminAvailableList) adminAvailableList.innerHTML = '<option>Errore caricamento</option>';
        currentAvailableMembersCreate = []; 
    }
}

// Filtra utenti disponibili nel modale CREAZIONE
function filterAvailableMembersCreate() {
    const searchTerm = adminCreateSearchInput.value.toLowerCase();
    const filteredAvailable = currentAvailableMembersCreate.filter(user => 
         `${user.nome} ${user.cognome} ${user.username}`.toLowerCase().includes(searchTerm)
    );
    renderUserList(adminAvailableList, filteredAvailable, true, 'create');
}

function populateAvailableMembersList(listElementId, selectedMemberUsernames = [], searchTerm = '') {
    const listElement = document.getElementById(listElementId);
    if (!listElement) return;

    listElement.innerHTML = '';
    const lowerSearchTerm = searchTerm.toLowerCase();

    allUsersAdmin
        .filter(user => {
            // Filtra per termine di ricerca (su nome, cognome, username)
            const nameMatch = `${user.nome} ${user.cognome} ${user.username}`.toLowerCase().includes(lowerSearchTerm);
            // Filtra per escludere quelli già nell'altra lista (CONFRONTA USERNAME TESTUALE)
            const isNotSelected = !selectedMemberUsernames.includes(user.username);
            return nameMatch && isNotSelected;
        })
        .forEach(user => {
            const option = document.createElement('option');
            option.value = user.username;
            option.textContent = `${user.nome} ${user.cognome} (${user.username})`;
             option.dataset.userId = user.id;
             option.dataset.nome = user.nome;
             option.dataset.cognome = user.cognome;
            listElement.appendChild(option);
        });
}

function addSelectedMembers() {
    if (!adminAvailableList || !adminSelectedList) return;
    const selectedOptions = Array.from(adminAvailableList.selectedOptions);
    selectedOptions.forEach(option => {
        adminSelectedList.appendChild(option);
    });
}

function removeSelectedMembers() {
    if (!adminAvailableList || !adminSelectedList) return;
    const selectedOptions = Array.from(adminSelectedList.selectedOptions);
    selectedOptions.forEach(option => {
        option.remove();
    });
    // Ripopola/Filtra la lista disponibili basata sulla ricerca corrente e i membri rimasti selezionati
    filterAvailableMembersCreate(); 
}

async function handleCreateSquadraSubmit(event) {
    event.preventDefault();
    if (!adminCreateForm || !adminCreatePrefixSelect || !adminSelectedList) return;

    const prefisso = adminCreatePrefixSelect.value;
    const nomeOpzionale = adminCreateNameInput.value.trim();
    const membriSelect = adminSelectedList;
    const selectedMembri = window.currentSelectedMembersCreate || [];

    if (!prefisso) { notifica("Seleziona un Nome", 'attenzione'); return; }

    const dataToSend = {
        nome_radio: prefisso,
        nome: nomeOpzionale || null, 
        membri: selectedMembri || null
    };

    console.log("Creazione squadra con dati:", dataToSend);
    const submitButton = adminCreateForm.querySelector('button[type="submit"]');
    try {
        if (submitButton) submitButton.disabled = true; submitButton.textContent = 'Creazione...';
        const result = await fetchApi('/api/squadre', { method: 'POST', body: JSON.stringify(dataToSend) });
        console.log("Risposta creazione squadra:", result);
        closeCreateModalAdmin();
        loadSquadreAdmin();
    } catch (error) { 
        console.error("Errore creazione squadra:", error); 
        notifica(`Errore creazione: ${error.message}`, 'errore');
    } finally { 
        if (submitButton) submitButton.disabled = false; submitButton.textContent = 'Crea squadra'; 
    }
}

// Apre il modale di modifica e popola con dati squadra e membri disponibili/attuali
async function openEditModalAdmin(squadraDallaLista) {
    let newData;
    try {
        // Questa chiamata finalmente eseguirà la tua API /api/squadre/:id !
        newData = await fetchApi(`/api/squadre/${squadraDallaLista.id}`);
    } catch (error) {
        console.error("Errore recupero dettagli squadra:", error);
        notifica("Impossibile caricare i dettagli della squadra.", 'errore');
        return;
    }

    const squadra = newData.squadra;
    const membriAttuali = newData.membri; 

    currentEditingTeamData = squadra;
    adminEditForm.reset(); 
    adminEditTeamIdHidden.value = squadra.id;
    adminEditTeamPrefixDisplay.textContent = squadra.nome_radio;
    adminEditNameInput.value = squadra.nome || '';
    
    window.currentSelectedMembersEdit = [...membriAttuali]; 

    populatePrefixDropdown(adminEditPrefixSelect, usedPrefixes, squadra.nome_radio); 
    adminEditModal.style.display = 'flex';

    renderUserList(adminEditCurrentList, window.currentSelectedMembersEdit, false, 'edit');
    adminEditAvailableList.innerHTML = '<li style="padding: 15px; text-align: center;">Caricamento disponibili...</li>';

    currentAvailableMembersEdit = await fetchApi(`/api/membri-disponibili/${squadra.id}`) || []; 
    filterAvailableMembersEdit(); 
}

// Aggiungi funzione per chiudere Modale Modifica
function closeEditModalAdmin() {
    if (!adminEditModal) return;
    adminEditModal.style.display = 'none';
    currentEditingTeamData = null;
    console.log("Modale modifica chiuso.");
    tornaAlCentroSeRichiesto();
}

// Filtra utenti disponibili nel modale MODIFICA
function filterAvailableMembersEdit() {
    const searchTerm = adminEditSearchInput.value.toLowerCase();
    const filteredAvailable = currentAvailableMembersEdit.filter(user => 
         `${user.nome} ${user.cognome} ${user.username}`.toLowerCase().includes(searchTerm)
    );
    renderUserList(adminEditAvailableList, filteredAvailable, true, 'edit');
}

function addSelectedMembersEdit() {
    if (!adminEditAvailableList || !adminEditCurrentList) return;
    const selectedOptions = Array.from(adminEditAvailableList.selectedOptions);
    selectedOptions.forEach(option => {
        adminEditCurrentList.appendChild(option);
    });
}

function removeSelectedMembersEdit() {
    if (!adminEditAvailableList || !adminEditCurrentList) return;
    const selectedOptions = Array.from(adminEditCurrentList.selectedOptions);
    selectedOptions.forEach(option => {
        adminEditAvailableList.appendChild(option);
    });
     // Ripopola/Filtra la lista disponibili basata sulla ricerca corrente
    filterAvailableMembersEdit(); 
    // Ordina alfabeticamente la lista disponibili dopo lo spostamento
    sortSelectOptions(adminEditAvailableList); 
}

function sortSelectOptions(selectElement) {
    if (!selectElement) return;
    Array.from(selectElement.options)
        .sort((a, b) => a.text.localeCompare(b.text))
        .forEach(option => selectElement.appendChild(option));
}

async function handleEditSquadraSubmit(event) {
    event.preventDefault();
    if (!adminEditForm || !adminEditPrefixSelect || !adminEditCurrentList || !currentEditingTeamData) return;

    const teamId = currentEditingTeamData.id; 
    const prefisso = adminEditPrefixSelect.value;
    const nomeOpzionale = adminEditNameInput.value.trim();
    const membriAttuali = window.currentSelectedMembersEdit || [];

    if (!prefisso || !teamId) { notifica("ID Squadra o Prefisso mancante.", 'attenzione'); return; }

    const body = {
        nome_radio: prefisso,
        nome: nomeOpzionale || null,
        membri: membriAttuali || null
    };

    console.log(`Salvataggio modifiche per squadra ${teamId}:`, body);
    const submitButton = adminEditForm.querySelector('button[type="submit"]');

    try {
        if (submitButton) submitButton.disabled = true; submitButton.textContent = 'Salvataggio...';
        const result = await fetchApi(`/api/squadre/${teamId}`, { method: 'PUT', body: JSON.stringify(body) });
        console.log("Risposta aggiornamento squadra:", result);
        closeEditModalAdmin(); 
        loadSquadreAdmin();
        if(currentlyShownTeamIdAdmin === teamId) {
            // Ricrea oggetto squadra aggiornato per il pannello
            const updatedSquadraForPanel = { ...currentEditingTeamData, ...body }; 
            showTeamDetailsPanel(updatedSquadraForPanel);
        }
    } catch (error) {
        console.error(`Errore durante l'aggiornamento squadra ${teamId}:`, error);
        notifica(`Errore durante l'aggiornamento: ${error.message}`, 'errore');
    } finally {
        if (submitButton) submitButton.disabled = false; submitButton.textContent = 'Salva';
    }
}

// Evidenzia la riga della tabella admin corrispondente all'ID
function highlightAdminTableRow(teamId) {
    if (!squadreTableBody) return;
    const rows = squadreTableBody.querySelectorAll('tr');
    rows.forEach(row => row.classList.remove('selected-row'));
    if (teamId !== null) {
         const rowToSelect = squadreTableBody.querySelector(`tr[data-team-id="${teamId}"]`);
         if (rowToSelect) {
             rowToSelect.classList.add('selected-row');
         }
    }
}

function showTeamDetailsPanel(squadra) {
    if (!adminTeamDetailPanel || !teamDetailPrefixSpan || !teamDetailOptionalNameSpan || !teamDetailMemberListUl || !squadra) {
        console.error("Elementi pannello dettagli squadra o dati squadra mancanti.");
        return;
    }
    console.log(`Mostro dettagli per squadra ${squadra.nome_radio} (ID: ${squadra.id}) nel pannello inferiore.`);

    currentlyShownTeamIdAdmin = squadra.id; 
    highlightAdminTableRow(squadra.id); 

    teamDetailPrefixSpan.textContent = squadra.nome_radio || 'N/D';
    teamDetailOptionalNameSpan.textContent = squadra.nome ? `(${squadra.nome})` : '';
    teamDetailMemberListUl.innerHTML = ''; 

    if (squadra.membri && squadra.membri.length > 0) {
        squadra.membri.forEach(membro => {
            const li = document.createElement('li');
            li.textContent = `${membro.nome || ''} ${membro.cognome || ''} (${membro.username || 'N/D'})`;
            teamDetailMemberListUl.appendChild(li);
        });
    } else {
        teamDetailMemberListUl.innerHTML = '<li>Nessun membro assegnato.</li>';
    }

    adminTeamDetailPanel.style.display = 'flex'; 
}

// Chiude il pannello dettagli inferiore
function closeTeamDetailsPanel() {
    if (!adminTeamDetailPanel) return;
    adminTeamDetailPanel.style.display = 'none';
    highlightAdminTableRow(null);
    currentlyShownTeamIdAdmin = null;
    console.log("Pannello dettagli squadra chiuso.");
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Pagina Admin Squadre caricata.");
    await loadAndApplyBranding();
    
    // Setup Pulsante Nuova Squadra
    if (newTeamBtn) newTeamBtn.addEventListener('click', openCreateModalAdmin);
    else console.error("Pulsante 'Nuova squadra' non trovato.");

    // Setup Modale Creazione
    if (closeAdminCreateBtn) closeAdminCreateBtn.addEventListener('click', closeCreateModalAdmin);
    if (cancelAdminCreateBtn) cancelAdminCreateBtn.addEventListener('click', closeCreateModalAdmin);
    if (adminCreateForm) adminCreateForm.addEventListener('submit', handleCreateSquadraSubmit);
    if (adminCreateSearchInput) adminCreateSearchInput.addEventListener('input', filterAvailableMembersCreate);
    if (adminAddBtn) adminAddBtn.addEventListener('click', addSelectedMembers);
    if (adminRemoveBtn) adminRemoveBtn.addEventListener('click', removeSelectedMembers);

    // Setup Modale Modifica
    if (closeAdminEditBtn) closeAdminEditBtn.addEventListener('click', closeEditModalAdmin);
    if (cancelAdminEditBtn) cancelAdminEditBtn.addEventListener('click', closeEditModalAdmin);
    if (adminEditForm) adminEditForm.addEventListener('submit', handleEditSquadraSubmit);
    if (adminEditSearchInput) adminEditSearchInput.addEventListener('input', filterAvailableMembersEdit);
    if (adminEditAddBtn) adminEditAddBtn.addEventListener('click', addSelectedMembersEdit);
    if (adminEditRemoveBtn) adminEditRemoveBtn.addEventListener('click', removeSelectedMembersEdit);

    // Setup Pannello Dettagli Inferiore
    if (closeTeamDetailBtn) closeTeamDetailBtn.addEventListener('click', closeTeamDetailsPanel);
    else console.error("Pulsante chiusura pannello dettagli squadra non trovato!");

    // Setup WebSocket Listener (se necessario in questa pagina)
    document.addEventListener('ws:reload_squadre', (event) => {
        console.log('Evento WS ricevuto: reload_squadre', event.detail);
        loadSquadreAdmin();
        const updatedTeamId = event.detail?.updatedTeamId;
        const deletedTeamId = event.detail?.deletedTeamId;
        if (currentlyShownTeamIdAdmin && (currentlyShownTeamIdAdmin === updatedTeamId || currentlyShownTeamIdAdmin === deletedTeamId)) {
            // Se eliminata chiudi, se modificata ricarica (ma loadSquadreAdmin già lo fa implicitamente)
            if(deletedTeamId === currentlyShownTeamIdAdmin) {
                 closeTeamDetailsPanel();
            }

        }
    });

    await loadSquadreAdmin();

    // Scorciatoie dal Centro Operativo: ?nuova=1 apre la creazione,
    // ?squadra=ID la modifica di quella squadra.
    if (parametriPagina.get('nuova') === '1') {
        openCreateModalAdmin();
    } else if (parametriPagina.get('squadra')) {
        const scelta = ultimeSquadre.find(s => s.id === parseInt(parametriPagina.get('squadra'), 10));
        if (scelta) openEditModalAdmin(scelta);
    }
});

function renderUserList(ulElement, usersArray, isAvailableList, listType) {
    if (!ulElement) return;
    ulElement.innerHTML = '';
    
    if (!usersArray || usersArray.length === 0) {
        ulElement.innerHTML = `<li style="text-align: center; color: var(--text-muted); font-style: italic; padding: 15px; font-size: 0.9rem;">Nessun volontario trovato.</li>`;
        return;
    }

    usersArray.forEach(user => {
        const li = document.createElement('li');
        li.dataset.username = user.username;
        
        let isBlocking = false;
        let warningHtml = '';
        let roleBadge = '';

        if (user.role === 'esterno') {
            roleBadge = `<span style="background: #3b82f6; color: white; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; margin-left: 5px;">ESTERNO</span>`;
        } 
        else if (segreteriaConfig.enabled) {
            let warnings = [];
            if (!user.medical_ok) {
                warnings.push("Visita");
                if (segreteriaConfig.block_on_medical) isBlocking = true;
            }
            if (!user.course_ok) {
                warnings.push("Corso Base");
                if (segreteriaConfig.block_on_course) isBlocking = true;
            }
            
            if (warnings.length > 0) {
                const color = isBlocking ? '#ef4444' : '#f59e0b';
                const icon = isBlocking ? 'fa-ban' : 'fa-exclamation-triangle';
                warningHtml = `<div style="font-size: 0.7rem; color: ${color}; margin-top: 3px; font-weight: 600;"><i class="fas ${icon}"></i> Manca: ${warnings.join(', ')}</div>`;
            }
        }

        // Se bloccante E siamo nella lista di sinistra (Aggiungi), disabilita il tasto e ingrigisci la riga
        const applyBlock = isBlocking && isAvailableList;
        
        li.style.cssText = `display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); ${applyBlock ? 'opacity: 0.5; background: #f8717110;' : ''}`;

        // Bottone. Le classi vengono da componenti.css: aggiungere è l'azione
        // normale (pieno), rimuovere è quella che toglie qualcosa (contorno
        // rosso). Niente icone: una parola sola dice già tutto.
        const buttonText = applyBlock ? 'Bloccato' : (isAvailableList ? 'Aggiungi' : 'Rimuovi');
        const buttonClass = applyBlock
            ? 'button-style button-small'
            : (isAvailableList ? 'button-style button-small' : 'button-style button-small btn-pericolo');

        li.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <strong style="font-size: 0.9rem; color: var(--text-color);">${escapeHTML(user.nome)} ${escapeHTML(user.cognome)} ${roleBadge}</strong>
                <span style="font-size: 0.75rem; color: var(--text-muted);">@${escapeHTML(user.username)}</span>
                ${warningHtml}
            </div>
            <button type="button" class="${buttonClass}" ${applyBlock ? 'disabled title="Requisiti non soddisfatti"' : ''}>${buttonText}</button>
        `;

        if (!applyBlock) {
            li.querySelector('button').addEventListener('click', () => {
                if (listType === 'create') {
                    if (isAvailableList) {
                        currentAvailableMembersCreate = currentAvailableMembersCreate.filter(u => u.username !== user.username);
                        window.currentSelectedMembersCreate = window.currentSelectedMembersCreate || [];
                        window.currentSelectedMembersCreate.push(user);
                    } else {
                        window.currentSelectedMembersCreate = window.currentSelectedMembersCreate.filter(u => u.username !== user.username);
                        currentAvailableMembersCreate.push(user);
                    }
                    filterAvailableMembersCreate();
                    renderUserList(adminSelectedList, window.currentSelectedMembersCreate, false, 'create');
                } 
                else if (listType === 'edit') {
                    if (isAvailableList) {
                        currentAvailableMembersEdit = currentAvailableMembersEdit.filter(u => u.username !== user.username);
                        window.currentSelectedMembersEdit = window.currentSelectedMembersEdit || [];
                        window.currentSelectedMembersEdit.push(user);
                    } else {
                        window.currentSelectedMembersEdit = window.currentSelectedMembersEdit.filter(u => u.username !== user.username);
                        currentAvailableMembersEdit.push(user);
                    }
                    filterAvailableMembersEdit();
                    renderUserList(adminEditCurrentList, window.currentSelectedMembersEdit, false, 'edit');
                }
            });
        }
        ulElement.appendChild(li);
    });
}
