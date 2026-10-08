// js/centro-operativo.js

import DOMPurify from '/js/lib/purify.es.js';
import { creaRicerca, calcolaPercorso, distanzaMetri, distanzaLeggibile, durataLeggibile } from '/js/mappa-strumenti.js';
import { montaElementiMappa, creaControlloLivelli, aggiungiCartografia } from '/js/mappa-elementi.js';

// Strade chiuse e zone sulla mappa (mappa-elementi.js).
let elementiMappa = null;

// Rete scarsa (rete-scarsa.js): queste letture si tengono nel browser, così se
// il server non risponde la sala vede l'ultima situazione invece del vuoto.
window.OrionRete?.salvaLetture([
    /^\/api\/me\/status$/, /^\/api\/branding/, /^\/api\/emergencies\/status$/,
    /^\/api\/reports\?/, /^\/api\/reports\/\d+$/, /^\/api\/location$/, /^\/api\/squadre$/,
    /^\/api\/mappa\/elementi$/, /^\/api\/emergencies\/\d+\/eventi/, /^\/api\/letture$/,
    /^\/api\/rubrica$/, /^\/api\/funzioni$/, /^\/api\/regia\/comunicazioni/
]);
const restaInCoda = (esito, cosa) => {
    if (!esito?.in_coda) return false;
    notifica(`${cosa}: il server non risponde, resta in coda e parte da sola appena torna.`, 'attenzione', 7000);
    return true;
};

const reportListBody = document.getElementById('report-list-body');
const createNewReportBtn = document.getElementById('createNewReportBtn');
const reportImageUploadInput = document.getElementById('report-image-upload-input');
const reportsManagementDiv = document.getElementById('reports-inbox-sidebar');

const bottomPanel = document.getElementById('report-detail-side-panel'); 
const bottomPanelCloseBtn = document.getElementById('close-side-panel-btn');
const sidePanel = document.getElementById('report-detail-side-panel');
const bottomPanelReportIdSpan = document.getElementById('bottom-detail-report-id');
const bottomPanelMainContent = document.getElementById('bottom-detail-main');
const bottomPanelUpdatesList = document.getElementById('bottom-updates-list');
const bottomPanelAddUpdateForm = document.getElementById('bottom-add-update-form');
const bottomPanelNewUpdateText = document.getElementById('bottom-new-update-text');

const createReportModal = document.getElementById('createReportModal');
const closeCreateReportModalBtn = document.getElementById('closeCreateReportModal');
const cancelCreateReportBtn = document.getElementById('cancelCreateReportBtn');
const createReportForm = document.getElementById('createReportForm');
const createLatitudeInput = document.getElementById('create-latitude');
const createLongitudeInput = document.getElementById('create-longitude');
const createSelectOnMapBtn = document.getElementById('create-select-on-map-btn');
const mapSelectionFeedback = document.getElementById('map-selection-feedback');

const editReportModal = document.getElementById('editReportModal');
const closeEditReportModalBtn = document.getElementById('closeEditReportModal');
const cancelEditReportBtn = document.getElementById('cancelEditReportBtn');
const editReportForm = document.getElementById('editReportForm');
const editReportIdSpan = document.getElementById('edit-report-id');
const editLatitudeInput = document.getElementById('edit-latitude');
const editLongitudeInput = document.getElementById('edit-longitude');
const editSelectOnMapBtn = document.getElementById('edit-select-on-map-btn');
const editMapSelectionFeedback = document.getElementById('edit-map-selection-feedback');

const openEmergencyModalElement = document.getElementById('open-emergency-modal');
const openEmergencyForm = document.getElementById('open-emergency-form');
const emergencyExternalCodeInput = document.getElementById('emergency-external-code');
const closeOpenEmergencyModalBtn = document.getElementById('closeOpenEmergencyModalBtn');
const cancelOpenEmergencyBtn = document.getElementById('cancelOpenEmergencyBtn');
const openEmergencyBtn = document.getElementById('open-emergency-btn');
const closeEmergencyBtn = document.getElementById('close-emergency-btn');

const toggleDocsPanelBtn = document.getElementById('toggle-docs-panel-btn');
const emergencyDocsManagementDiv = document.getElementById('emergency-docs-management');
const emergencyDocsListContainer = document.getElementById('emergency-docs-list-container');
const uploadNewDocBtn = document.getElementById('uploadNewDocBtn');
const uploadDocModal = document.getElementById('uploadDocModal');
const closeUploadDocModalBtn = document.getElementById('closeUploadDocModalBtn');
const cancelUploadDocBtn = document.getElementById('cancelUploadDocBtn');
const uploadDocForm = document.getElementById('uploadDocForm');
const docFileInput = document.getElementById('doc-file-input');

const assignTeamModal = document.getElementById('assignTeamModal');
const closeAssignTeamModalBtn = document.getElementById('closeAssignTeamModal');
const doneAssignTeamBtn = document.getElementById('doneAssignTeamBtn');
const assignModalReportIdSpan = document.getElementById('assign-modal-report-id');
const assignModalReportTitleSpan = document.getElementById('assign-modal-report-title');
const assignedTeamsListUl = document.getElementById('assigned-teams-list');
const availableTeamsListUl = document.getElementById('available-teams-list');
const assignTeamSearchInput = document.getElementById('assign-team-search');

const teamMembersModal = document.getElementById('teamMembersModal');
const closeTeamMembersModalBtn = document.getElementById('closeTeamMembersModalBtn');
const okTeamMembersModalBtn = document.getElementById('okTeamMembersModalBtn');
const teamMembersModalTitle = document.getElementById('teamMembersModalTitle');
const teamMembersModalList = document.getElementById('teamMembersModalList');
const teamMembersModalLocation = document.getElementById('teamMembersModalLocation');
const teamMembersModalTimestamp = document.getElementById('teamMembersModalTimestamp');

const adminDashboardBtn = document.getElementById('admin-dashboard-btn');
const manageTeamsBtn = document.getElementById('manage-teams-btn');
document.getElementById('esterni-temporanei-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const menu = document.getElementById('top-menu-content');
    if (menu) menu.style.display = 'none';
    window.EsterniTemporanei?.apri();
});
document.getElementById('rubrica-btn')?.addEventListener('click', () => window.Rubrica?.apri());
document.getElementById('funzioni-btn')?.addEventListener('click', () => window.Funzioni?.apriPannello());
// Dal pannello Funzioni: apri la segnalazione e portala sulla mappa.
document.addEventListener('orion:apri-segnalazione', (ev) => {
    const id = Number(ev.detail?.id);
    if (!id) return;
    showReportDetails(id);
    const marker = reportMarkerReferences?.[id];
    if (marker && map) map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 });
});
// Arrivate le funzioni, le schede già disegnate prendono le loro etichette.
document.addEventListener('orion:funzioni-pronte', () => {
    // Solo le schede già nell'elenco: le chiuse nascoste restano nascoste.
    reportListBody?.querySelectorAll('.inbox-card').forEach(card => {
        const r = currentReports.find(x => String(x.id) === card.dataset.reportId);
        if (r) createOrUpdateReportRow(r);
    });
});
document.getElementById('situazione-btn')?.addEventListener('click', () => window.open('/situazione.html', '_blank', 'noopener'));
const profileBtn = document.getElementById('profile-btn');

const teamStatusContentDiv = document.getElementById('team-status-content');
const reportTableWrapper = document.getElementById('report-list-container');
const toggleClosedBtn = document.getElementById('toggle-closed-reports-btn');

const ACTIVE_REPORT_STATUSES = ['New', 'Open', 'InProgress'];
const TERMINAL_REPORT_STATUSES = ['Closed'];

// Dopo quanti minuti una segnalazione senza squadra diventa rossa: il valore
// viene dalle impostazioni, questo è il ripiego.
let MINUTI_ATTESA_CRITICA = 15;

// Motivi per cui una segnalazione non aspetta una squadra, ed etichette degli
// stati: gli stessi codici sono in src/costanti.js.
const ETICHETTA_STATO = { New: 'Nuova', Open: 'Aperta', InProgress: 'In corso', Closed: 'Chiusa', Resolved: 'Risolta' };
const ETICHETTA_PRIORITA = { High: 'Alta', Medium: 'Media', Low: 'Bassa' };

const MOTIVI_SENZA_SQUADRA = {
    altro_ente: { etichetta: 'ALTRO ENTE', descrizione: 'Gestita da altro ente' },
    monitoraggio: { etichetta: 'MONITORAGGIO', descrizione: 'Solo monitoraggio' },
    nessun_intervento: { etichetta: 'NESSUN INTERVENTO', descrizione: 'Nessun intervento necessario' }
};
const STALE_TIMESTAMP_THRESHOLD = 5 * 60 * 1000;

const defaultReportIcon = L.icon({
    iconUrl: '/leaflet/images/marker-icon.png',
    shadowUrl: '/leaflet/images/marker-shadow.png',
    iconSize:    [25, 41],
    iconAnchor:  [12, 41],
    popupAnchor: [1, -34],
    shadowSize:  [41, 41]
});

const iconNewVerified = L.icon({
    iconUrl: '/assets/icons/marker-icon-red.png', 
    shadowUrl: '/leaflet/images/marker-shadow.png', 
    iconSize:    [25, 41], 
    iconAnchor:  [12, 41], 
    popupAnchor: [1, -34],
    shadowSize:  [41, 41]
});

const iconAssignedInProgress = L.icon({
    iconUrl: '/leaflet/images/marker-icon.png', 
    shadowUrl: '/leaflet/images/marker-shadow.png',
    iconSize:    [25, 41],
    iconAnchor:  [12, 41],
    popupAnchor: [1, -34],
    shadowSize:  [41, 41]
});

const iconResolved = L.icon({
    iconUrl: '/assets/icons/marker-report-resolved.png',
    shadowUrl: '/leaflet/images/marker-shadow.png',
    iconSize:    [25, 41],
    iconAnchor:  [12, 41],
    popupAnchor: [1, -34],
    shadowSize:  [41, 41]
});

const iconClosedCancelled = L.icon({
    iconUrl: '/assets/icons/marker-icon-grey.png', 
    shadowUrl: '/leaflet/images/marker-shadow.png',
    iconSize:    [25, 41],
    iconAnchor:  [12, 41],
    popupAnchor: [1, -34],
    shadowSize:  [41, 41]
});

let map;
let reportMarkersLayer;
let teamMarkersLayer;
let currentReports = [];
let currentAvailableTeamsAssign  = [];
let currentlyDisplayedReportId = null;
let isSelectingOnMap = false;
let allTeamsList = [];
// Da quale telefono arriva la posizione di ogni squadra (il caposquadra, se c'è).
const mittentiPosizione = new Map();
// Le squadre della segnalazione aperta nel pannello: un caposquadra nominato
// intanto compare senza riaprirla.
let squadreSegnalazioneAperta = [];
let currentReportForAssignment = null;
let currentReportListPage = 1;
let totalReportPages = 1;
let isLoadingMore = false;
let reportMarkerReferences = {};
let activeEmergency = null;
let showOnlyClosedReports = false;
let teamMarkerReferences = {};
let isTogglingView = false;
const emergencyStatusDisplay = document.getElementById('emergency-status-display');
let teamLastUpdateTimestamps = new Map();
let currentUserRole = null;
let isUpdatingCoordsFromPanel = false;
let reportIdForCoordUpdate = null;
// Le segnalazioni con novità non ancora viste: lampeggiano nell'elenco e,
// con un anello giallo, anche sulla mappa. Ogni volta che l'insieme cambia
// il segnaposto si aggiorna da solo.
class InsiemeNovita extends Set {
    add(id) { const esito = super.add(id); queueMicrotask(() => aggiornaNovitaSegnaposto(id)); return esito; }
    delete(id) { const esito = super.delete(id); queueMicrotask(() => aggiornaNovitaSegnaposto(id)); return esito; }
}
let blinkingReportIds = new InsiemeNovita();
window.reportLastViewedLogTimestamp = new Map();
let currentlyDisplayedTeamIdInModal = null;
let reloadSquadreTimeout = null;
let tempSelectionMarker = null;

let brandingSettings = {
    association_name: 'Centro Operativo',
    // Finché le impostazioni non dicono dov'è l'associazione, l'Italia intera.
    map_center_lat: 41.9,
    map_center_lon: 12.5,
    map_zoom_level: 6,
    logoUrl: '/logo.png'
};

setInterval(() => {
    document.body.classList.toggle('sync-blink-state');
}, 800);

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Pagina Centro Operativo caricata.");
    const topMenuBtn = document.getElementById('top-menu-btn');
    const topMenuContent = document.getElementById('top-menu-content');
    if (topMenuBtn && topMenuContent) {
        topMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            topMenuContent.style.display = topMenuContent.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', (e) => {
            if (!topMenuBtn.contains(e.target) && !topMenuContent.contains(e.target)) {
                topMenuContent.style.display = 'none';
            }
        });
    }
    await loadAndApplyBranding();
    try {
        const meResponse = await fetchApi('/api/me/status');
        currentUserRole = meResponse.role; 
        

        localStorage.setItem('userRole', currentUserRole);
        localStorage.setItem('userRuoli', JSON.stringify(
            Array.isArray(meResponse.ruoli) && meResponse.ruoli.length ? meResponse.ruoli : [currentUserRole]
        ));
        localStorage.setItem('userPermessi', JSON.stringify(Array.isArray(meResponse.permessi) ? meResponse.permessi : []));
    } catch (error) {
        // In manutenzione il velo è già a schermo: niente rimando all'accesso.
        if (error?.manutenzione || window.__orionManutenzione) return;
        console.error("Errore verifica sessione, reindirizzamento al login...");
        window.location.href = '/login.html';
        return;
    }
    updateUserInterfaceForRole(currentUserRole);
    
    if (!reportListBody || !bottomPanel || !createReportModal || !editReportModal ) {
        console.error("ERRORE CRITICO: Uno o più elementi HTML fondamentali non trovati.");
        document.body.innerHTML = '<h1 style="color:red; text-align:center; margin-top: 50px;">Errore: Impossibile inizializzare la pagina.</h1>';
        return;
    }
    
    loadReadStatusFromStorage();
    initMap();

    try {
        const currentEmergencyId = await fetchEmergencyStatus();
        console.log(`[DOMContentLoaded] Stato emergenza caricato. ID Attivo: ${currentEmergencyId}`);

        await Promise.all([
            loadAllTeams(),
            loadTeamLocations()
        ]);
        
        await loadAllMapMarkers(currentEmergencyId);
        updateTeamStatusPanel();
        loadReports(1, 25, false, currentEmergencyId);

        console.log("Caricamento iniziale completato.");
    } catch (initialLoadError) {
        console.error("Errore grave durante il caricamento iniziale:", initialLoadError);
        loadReports(1, 25, false, activeEmergency?.id);
    }
    
    setupEventListeners();
});

// Il server è tornato: la situazione è andata avanti senza di noi, si rilegge tutto.
document.addEventListener('orion:rete', async (e) => {
    if (e.detail?.senzaRete) return;
    try {
        const id = await fetchEmergencyStatus();
        await Promise.all([loadAllTeams(), loadTeamLocations()]);
        await loadAllMapMarkers(id);
        updateTeamStatusPanel();
        loadReports(1, 25, showOnlyClosedReports, id);
        caricaEventi();
        if (currentlyDisplayedReportId) showReportDetails(currentlyDisplayedReportId);
    } catch (err) {
        console.error('Ricarica dopo il ritorno del server non riuscita:', err);
    }
});

async function loadAndApplyBranding() {
    console.log("Caricamento impostazioni di branding...");
    try {
        const settings = await fetchApi('/api/branding/settings');
        if (settings) {
            brandingSettings.association_name = settings.association_name || brandingSettings.association_name;
            brandingSettings.map_center_lat = parseFloat(settings.map_center_lat) || brandingSettings.map_center_lat;
            brandingSettings.map_center_lon = parseFloat(settings.map_center_lon) || brandingSettings.map_center_lon;
            brandingSettings.map_zoom_level = parseInt(settings.map_zoom_level, 10) || brandingSettings.map_zoom_level;
            brandingSettings.magazzino_enabled = settings.magazzino_enabled;
            try {
                const conf = typeof settings.segreteria_config === 'string'
                    ? JSON.parse(settings.segreteria_config) : settings.segreteria_config;
                brandingSettings.segreteria_attiva = !!conf?.enabled;
            } catch { brandingSettings.segreteria_attiva = false; }

            const minutiConfigurati = parseInt(settings.minuti_attesa_critica, 10);
            if (Number.isInteger(minutiConfigurati) && minutiConfigurati > 0 && minutiConfigurati <= 240) {
                MINUTI_ATTESA_CRITICA = minutiConfigurati;
            }
        }
        
        const logoInfo = await fetchApi('/api/branding');
        if (logoInfo && logoInfo.logoUrl) {
            brandingSettings.logoUrl = `${logoInfo.logoUrl}?v=${logoInfo.logoVersion}`;
            const logoImg = document.getElementById('main-app-logo');
            if (logoImg) logoImg.src = brandingSettings.logoUrl;
        }

        document.title = brandingSettings.association_name;
    } catch (error) {
        console.error("Errore branding:", error);
    }
}

function setupEventListeners() {
    if (reportTableWrapper) {
        reportTableWrapper.addEventListener('scroll', () => {
            const { scrollHeight, scrollTop, clientHeight } = reportTableWrapper;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 250;
            const hasMorePages = currentReportListPage < totalReportPages;
            if (isNearBottom && hasMorePages && !isLoadingMore) {
                loadMoreReports(showOnlyClosedReports, activeEmergency?.id);
            }
        });
    }

    if (bottomPanelCloseBtn) bottomPanelCloseBtn.addEventListener('click', closeBottomPanel);
    if (bottomPanelAddUpdateForm) bottomPanelAddUpdateForm.addEventListener('submit', handleAddUpdateSubmit);
    if (bottomPanelNewUpdateText) {
        bottomPanelNewUpdateText.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleAddUpdateSubmit(event);
            }
        });
    }

    if (createNewReportBtn) createNewReportBtn.addEventListener('click', openCreateModal);
    if (closeCreateReportModalBtn) closeCreateReportModalBtn.addEventListener('click', closeCreateModal);
    if (cancelCreateReportBtn) cancelCreateReportBtn.addEventListener('click', closeCreateModal);
    if (createReportForm) createReportForm.addEventListener('submit', handleCreateReportSubmit);
    if (createSelectOnMapBtn) createSelectOnMapBtn.addEventListener('click', toggleMapSelectionMode);

    if (closeEditReportModalBtn) closeEditReportModalBtn.addEventListener('click', closeEditModal);
    if (cancelEditReportBtn) cancelEditReportBtn.addEventListener('click', closeEditModal);
    if (editReportForm) editReportForm.addEventListener('submit', handleEditReportSubmit);
    if (editSelectOnMapBtn) editSelectOnMapBtn.addEventListener('click', toggleMapSelectionModeEdit);

    if (closeAssignTeamModalBtn) closeAssignTeamModalBtn.addEventListener('click', closeAssignTeamModal);
    if (doneAssignTeamBtn) doneAssignTeamBtn.addEventListener('click', closeAssignTeamModal);
    const selettoreMotivoSquadra = document.getElementById('no-team-reason-select');
    if (selettoreMotivoSquadra) {
        selettoreMotivoSquadra.addEventListener('change', async (e) => {
            if (!currentReportForAssignment) return;
            const reportId = currentReportForAssignment.id;
            const precedente = currentReportForAssignment.no_team_reason || '';
            const scelto = e.target.value;
            e.target.disabled = true;
            try {
                // Come una modifica normale: finisce nel diario e alle altre postazioni.
                restaInCoda(await fetchApi(`/api/reports/${reportId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ no_team_reason: scelto }),
                    coda: `Segnalazione n. ${reportId}: squadra non necessaria`
                }), 'La scelta');
                currentReportForAssignment.no_team_reason = scelto || null;
            } catch (error) {
                console.error('Errore impostazione motivo squadra non richiesta:', error);
                notifica(`Impossibile salvare la scelta: ${error.message}`, 'errore');
                e.target.value = precedente;
            } finally {
                e.target.disabled = false;
            }
        });
    }
    if (assignTeamSearchInput) {
        assignTeamSearchInput.addEventListener('input', (e) => {
            if (currentReportForAssignment) {
                const searchTerm = e.target.value;
                const filteredAvailable = (window.currentAvailableTeamsAssign || []).filter(team =>
                    team.nome.toLowerCase().includes(searchTerm.toLowerCase())
                );
                const assignedTeamIds = (currentReportForAssignment.assigned_teams || []).map(team => team.id);
                const trulyAvailableFiltered = filteredAvailable.filter(team => !assignedTeamIds.includes(team.id));
                populateTeamAssignmentList(availableTeamsListUl, trulyAvailableFiltered, 'add');
            }
        });
    }
    
    if (closeTeamMembersModalBtn) closeTeamMembersModalBtn.addEventListener('click', closeTeamMembersModal);
    if (okTeamMembersModalBtn) okTeamMembersModalBtn.addEventListener('click', closeTeamMembersModal);
    if (teamStatusContentDiv) {
        teamStatusContentDiv.addEventListener('click', (event) => {
            const teamItem = event.target.closest('.team-status-item');
            if (teamItem?.dataset.teamId) {
                const teamId = parseInt(teamItem.dataset.teamId, 10);
                const teamData = allTeamsList.find(t => t.id === teamId);
                if (teamData) apriMenuSquadra(teamData, teamItem);
            }
        });
    }

    if (openEmergencyBtn) openEmergencyBtn.addEventListener('click', openEmergencyModal);
    if (closeOpenEmergencyModalBtn) closeOpenEmergencyModalBtn.addEventListener('click', closeEmergencyModal);
    if (cancelOpenEmergencyBtn) cancelOpenEmergencyBtn.addEventListener('click', closeEmergencyModal);
    if (openEmergencyForm) openEmergencyForm.addEventListener('submit', handleOpenEmergencySubmit);
    if (closeEmergencyBtn) closeEmergencyBtn.addEventListener('click', handleCloseEmergencyClick);

    if (toggleDocsPanelBtn) toggleDocsPanelBtn.addEventListener('click', handleToggleDocsPanel);
    if (uploadNewDocBtn) uploadNewDocBtn.addEventListener('click', openUploadDocModal);
    if (closeUploadDocModalBtn) closeUploadDocModalBtn.addEventListener('click', closeUploadDocModal);
    if (cancelUploadDocBtn) cancelUploadDocBtn.addEventListener('click', closeUploadDocModal);
    if (uploadDocForm) uploadDocForm.addEventListener('submit', handleUploadDocSubmit);
    
    if (toggleClosedBtn) toggleClosedBtn.addEventListener('click', handleToggleClosedReports);

    if (reportImageUploadInput) {
        reportImageUploadInput.addEventListener('change', (event) => {
            if (currentlyDisplayedReportId && event.target.files && event.target.files.length > 0) {
                handleImageUpload(currentlyDisplayedReportId, event.target.files);
            }
            event.target.value = null;
        });
    } else {
        console.error("ERRORE CRITICO: Elemento input '#report-image-upload-input' non trovato!");
    }

    setupWebSocketListeners();
}

// WATCHDOG: Controllo periodico squadre "Stale"
setInterval(() => {
    if (!map || !teamMarkersLayer) return;
    
    const now = Date.now();
    
    teamLastUpdateTimestamps.forEach((lastUpdate, teamId) => {
        let isStale = false;
        
        if (lastUpdate) {
            const lastUpdateTs = new Date(lastUpdate).getTime();
            if (!isNaN(lastUpdateTs)) {
                isStale = (now - lastUpdateTs > STALE_TIMESTAMP_THRESHOLD); 
            }
        } else {
            isStale = true; 
        }

        const marker = teamMarkerReferences[teamId];
        if (marker) {
            const iconElement = marker.getElement(); 
            if (iconElement) {
                if (isStale) {
                    iconElement.classList.add('team-marker-stale');
                } else {
                    iconElement.classList.remove('team-marker-stale');
                }
            }
        }

        const panelSpan = document.getElementById('team-status-content')?.querySelector(`.team-status-item[data-team-id="${teamId}"]`);
        if (panelSpan) {
            if (isStale) {
                panelSpan.classList.add('team-marker-stale');
            } else {
                panelSpan.classList.remove('team-marker-stale');
            }
        }
    });
}, 30000); 

L.Control.Logo = L.Control.extend({
    options: {
        position: 'topleft'
    },

    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'leaflet-control-logo leaflet-bar');
        // Impedisce che i click sul logo interagiscano con la mappa sottostante
        L.DomEvent.disableClickPropagation(container);

        const logoImg = L.DomUtil.create('img', '', container);
        logoImg.src = brandingSettings.logoUrl;
        logoImg.alt = 'Logo';
        logoImg.style.maxWidth = '80px';
        logoImg.style.height = 'auto';
        logoImg.style.display = 'block';

        return container;
    },

    onRemove: function (map) {
        // Nulla da fare qui quando il controllo viene rimosso
    }
});

L.control.logo = function(opts) {
    return new L.Control.Logo(opts);
}

function updateUserInterfaceForRole(role) {
    currentUserRole = role;
    console.log(`[UI Update] Applicazione permessi per ruolo: ${currentUserRole}`);

    const isEsterno = currentUserRole === 'esterno';
    const isAdmin = currentUserRole === 'admin';
    const isSegreteria = currentUserRole === 'segreteria';

    if (createNewReportBtn) createNewReportBtn.style.display = isEsterno ? 'none' : 'inline-block';
    
    if (isEsterno) {
        if (openEmergencyBtn) openEmergencyBtn.style.display = 'none';
        if (closeEmergencyBtn) closeEmergencyBtn.style.display = 'none';
    }
    if (profileBtn) profileBtn.style.display = 'block';
    if (manageTeamsBtn) manageTeamsBtn.style.display = isEsterno ? 'none' : 'block';
    const rubricaBtn = document.getElementById('rubrica-btn');
    // La rubrica la vedono anche gli esterni, senza poterla modificare.
    if (rubricaBtn) rubricaBtn.style.display = '';
    // Le funzioni di supporto: il pulsante compare se il modulo è acceso.
    window.Funzioni?.inizia({ interno: !isEsterno });
    // Le scorciatoie della barra squadre, quando si sa chi è collegato.
    if (!isEsterno) preparaScorciatoieSquadre();
    if (adminDashboardBtn) adminDashboardBtn.style.display = (isEsterno || !isAdmin) ? 'none' : 'block';
    const segreteriaMenuBtn = document.getElementById('segreteria-menu-btn');
    if (segreteriaMenuBtn) {
        segreteriaMenuBtn.style.display = (haPermesso('volontari.sanitario', 'volontari.anagrafica') && brandingSettings.segreteria_attiva) ? 'block' : 'none';
    }
    // Archivio e volontari a chi ne ha il permesso, anche senza essere amministratore.
    const archivioMenuBtn = document.getElementById('archivio-menu-btn');
    if (archivioMenuBtn) archivioMenuBtn.style.display = !isEsterno && haPermesso('emergenze.archivio') ? 'block' : 'none';
    const volontariMenuBtn = document.getElementById('volontari-menu-btn');
    if (volontariMenuBtn) volontariMenuBtn.style.display = !isEsterno && haPermesso('volontari.anagrafica') ? 'block' : 'none';
    // Il calendario delle attività agli interni, a modulo acceso.
    const calendarioMenuBtn = document.getElementById('calendario-menu-btn');
    if (calendarioMenuBtn) calendarioMenuBtn.style.display = !isEsterno && String(brandingSettings?.attivita_enabled) !== 'false' ? 'block' : 'none';
    // Il magazzino a chiunque non sia esterno, se il modulo è acceso.
    const magazzinoMenuBtn = document.getElementById('magazzino-menu-btn');
    if (magazzinoMenuBtn) {
        const acceso = String(brandingSettings?.magazzino_enabled) === 'true';
        magazzinoMenuBtn.style.display = (acceso && !isEsterno) ? 'block' : 'none';
    }
    
}

function initMap() {
    map = L.map('map-segnalazioni', { zoomControl: false }).setView(
        [brandingSettings.map_center_lat, brandingSettings.map_center_lon], 
        brandingSettings.map_zoom_level
    );

    const osmLayer = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', 
        { 
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' 
        }
    );

    const satelliteLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 
        {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        }
    );

    osmLayer.addTo(map);
    // La regia della simulazione (regia-co.js) ci mette il punto di un evento improvvisato.
    window.mappaCentroOperativo = map;
    
    reportMarkersLayer = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false, 
        zoomToBoundsOnClick: true, 
        disableClusteringAtZoom: 16,
        iconCreateFunction: iconaGruppoSegnalazioni
    }).addTo(map);

    teamMarkersLayer = L.layerGroup().addTo(map);

    const baseMaps = {
        "Mappa Stradale": osmLayer,
        "Satellite": satelliteLayer
    };

    const overlayMaps = {
        "Segnalazioni": reportMarkersLayer,
        "Posizione Squadre": teamMarkersLayer
    };

    // Livelli e ricerca in basso a sinistra: in alto a destra stanno gli
    // eventi e gli avvisi a comparsa, e i comandi finivano coperti.
    L.control.logo({ position: 'topleft' }).addTo(map);
    creaRicerca(map, { cercaLocale: cercaSullaMappa, suScelta: usaRisultatoRicerca });
    const controlloLivelli = creaControlloLivelli(baseMaps, overlayMaps, { position: 'bottomleft' }).addTo(map);
    aggiungiCartografia(map, controlloLivelli, [osmLayer, satelliteLayer]);
    livelloPercorso = L.layerGroup().addTo(map);
    // Strade chiuse, zone interdette e zone del piano: ogni tipo un livello,
    // con il suo colore nel controllo dei livelli. Gli esterni le vedono e basta.
    elementiMappa = montaElementiMappa(map, controlloLivelli, {
        calcolaPercorso,
        interno: !ruoliUtente().includes('esterno'),
        // Gli elementi del piano li gestisce chi ha il permesso del piano di emergenza.
        admin: haPermesso('emergenze.piano'),
        emergenzaAperta: () => !!activeEmergency
    });
    // Il pannello della segnalazione copre la mappa: le etichette delle aree si spostano.
    sidePanel?.addEventListener('transitionend', (e) => { if (e.target === sidePanel) elementiMappa?.aggiornaEtichette(); });

    console.log("Mappa Segnalazioni inizializzata.");
}

// --------------------------------------------------------------------------
// Ricerca sulla mappa: segnalazioni e squadre di questa emergenza, poi gli
// indirizzi (in mappa-strumenti.js).
// --------------------------------------------------------------------------

const senzaAccenti = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function cercaSullaMappa(testo) {
    const cercato = senzaAccenti(testo).replace(/^#/, '').trim();
    if (!cercato) return [];
    const parole = cercato.split(/\s+/);
    const numero = /^\d+$/.test(cercato) ? cercato : null;
    const voci = [];
    Object.values(reportMarkerReferences).forEach(marker => {
        const d = marker.dati;
        if (!d) return;
        const testoReport = senzaAccenti(`${d.titolo} ${d.indirizzo || ''}`);
        const corrisponde = numero ? String(d.numero) === numero : parole.every(p => testoReport.includes(p));
        if (!corrisponde) return;
        const { lat, lng } = marker.getLatLng();
        voci.push({ nome: `#${d.numero} ${d.titolo}`, dettaglio: d.indirizzo || null, lat, lng, fonte: 'segnalazione', reportId: marker.reportId });
    });
    if (!numero) {
        allTeamsList.forEach(squadra => {
            const testoSquadra = senzaAccenti(`${squadra.nome_radio || ''} ${squadra.nome || ''}`);
            if (!parole.every(p => testoSquadra.includes(p))) return;
            const marker = teamMarkerReferences[squadra.id];
            const posizione = marker?.getLatLng();
            voci.push({
                nome: squadra.nome_radio || 'Squadra',
                dettaglio: [squadra.nome, posizione ? null : 'nessuna posizione ricevuta'].filter(Boolean).join(' · ') || null,
                lat: posizione?.lat, lng: posizione?.lng, fonte: 'squadra', teamId: squadra.id
            });
        });
    }
    return voci.slice(0, 6);
}

// Il punto trovato: dentro un modulo aperto diventa la sua posizione,
// altrimenti la mappa ci va e lo segna per qualche secondo.
let segnoRicerca = null;
function usaRisultatoRicerca(r) {
    if (r.fonte === 'squadra') return trovaSquadra(r.teamId);
    if (r.fonte === 'segnalazione') {
        const marker = reportMarkerReferences[r.reportId];
        if (marker) reportMarkersLayer.zoomToShowLayer(marker, () => marker.openPopup());
        return;
    }
    const centro = L.latLng(r.lat, r.lng);
    if (createReportModal && createReportModal.style.display !== 'none') {
        if (createLatitudeInput) createLatitudeInput.value = centro.lat.toFixed(6);
        if (createLongitudeInput) createLongitudeInput.value = centro.lng.toFixed(6);
        if (mapSelectionFeedback) mapSelectionFeedback.textContent = `Indirizzo: ${r.nome}`;
        if (isSelectingOnMap) deactivateMapSelectionMode();
        return;
    }
    if (editReportModal && editReportModal.style.display !== 'none') {
        if (editLatitudeInput) editLatitudeInput.value = centro.lat.toFixed(6);
        if (editLongitudeInput) editLongitudeInput.value = centro.lng.toFixed(6);
        if (editMapSelectionFeedback) editMapSelectionFeedback.textContent = `Indirizzo: ${r.nome}`;
        if (isSelectingOnMap) deactivateMapSelectionModeEdit();
        return;
    }
    map.setView(centro, Math.max(map.getZoom(), 16));
    if (segnoRicerca) segnoRicerca.remove();
    segnoRicerca = L.circleMarker(centro, { radius: 14, color: '#2477b3', weight: 3, fillColor: '#2477b3', fillOpacity: 0.15, className: 'segno-ricerca' })
        .bindTooltip(r.nome, { direction: 'top', offset: [0, -12] })
        .addTo(map);
    segnoRicerca.openTooltip();
    const questo = segnoRicerca;
    setTimeout(() => { if (segnoRicerca === questo) { questo.remove(); segnoRicerca = null; } }, 12000);
}

// --------------------------------------------------------------------------
// Le squadre sulla mappa: il riquadro, "trova", il percorso.
// --------------------------------------------------------------------------

// Sotto questa distanza la squadra e' sul posto: niente percorso.
const DISTANZA_SUL_POSTO = 150;
let livelloPercorso = null;
let percorsoAttivo = null; // { teamId, reportId, calcolatoIl }

function destinazioneSquadra(squadra) {
    const meta = squadra?.active_target_info;
    if (!meta) return null;
    const marker = reportMarkerReferences[meta.report_id];
    return {
        reportId: meta.report_id,
        numero: meta.target_report_progressive_number ?? meta.report_id,
        titolo: meta.target_report_title || '',
        posizione: marker ? marker.getLatLng() : null
    };
}

function quandoRelativo(iso) {
    if (!iso) return null;
    const minuti = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!Number.isFinite(minuti)) return null;
    if (minuti < 1) return 'adesso';
    if (minuti < 60) return `${minuti} min fa`;
    const ore = Math.floor(minuti / 60);
    return ore < 24 ? `${ore} h fa` : new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Il caposquadra: nome e, se il server lo manda (segreteria accesa), il
// telefono da toccare per chiamarlo quando la radio non va.
function nomePersona(p) {
    return p ? ([p.nome, p.cognome].filter(Boolean).join(' ') || p.username || '') : '';
}

function contattoCaposquadra(capo) {
    const span = document.createElement('span');
    span.className = 'contatto-caposquadra';
    const stella = document.createElement('i');
    stella.className = 'fas fa-star';
    stella.setAttribute('aria-hidden', 'true');
    span.append(stella, ` ${nomePersona(capo)}`);
    if (capo?.telefono) {
        const tel = document.createElement('a');
        tel.href = `tel:${capo.telefono.replace(/[^0-9+]/g, '')}`;
        tel.textContent = capo.telefono;
        tel.title = `Chiama ${nomePersona(capo)}`;
        span.append(' · ', tel);
    }
    return span;
}

// Il caposquadra si guarda sulla squadra, che si rilegge a ogni nomina.
// Le squadre sulla segnalazione, ognuna con il suo caposquadra e il
// telefono per chiamarlo (se il server lo manda: segreteria accesa).
function htmlSquadreAssegnate(assegnate) {
    if (!Array.isArray(assegnate) || assegnate.length === 0) {
        return '<span style="font-style: italic; color: var(--text-muted); font-size: 0.85rem;">Nessuna squadra assegnata</span>';
    }
    return assegnate.map(t => {
        const capo = allTeamsList.find(s => s.id === t.id)?.caposquadra;
        const contatto = capo ? `<span class="contatto-caposquadra squadra-assegnata-capo"><i class="fas fa-star" aria-hidden="true"></i> ${escapeHTML(nomePersona(capo))}` +
            (capo.telefono ? ` · <a href="tel:${escapeHTML(capo.telefono.replace(/[^0-9+]/g, ''))}" title="Chiama ${escapeHTML(nomePersona(capo))}">${escapeHTML(capo.telefono)}</a>` : '') + '</span>' : '';
        return `<span class="squadra-assegnata"><span style="background: rgba(139, 92, 246, 0.15); color: #6d28d9; padding: 4px 10px; border-radius: 50px; border: 1px solid rgba(139, 92, 246, 0.3); font-size: 0.85rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;"><i class="fas fa-truck-pickup"></i> ${escapeHTML(t.nome_radio || t.nome || '?')}</span>${contatto}</span>`;
    }).join(' ');
}

function testoMittente(teamId, squadra) {
    const da = mittentiPosizione.get(teamId);
    if (!da) return '';
    const capo = squadra?.caposquadra ? squadra.caposquadra.username === da.username : da.caposquadra;
    return ` · dal telefono di ${nomePersona(da)}${capo ? ' (caposquadra)' : ''}`;
}

// Il riquadro di una squadra sulla mappa: chi e', dove deve andare, quanto
// e' fresca la posizione, chi c'e' dentro. Si costruisce all'apertura, cosi'
// e' sempre aggiornato.
function riquadroSquadra(teamId) {
    const squadra = allTeamsList.find(t => t.id === teamId) || {};
    const marker = teamMarkerReferences[teamId];
    const posizione = marker?.getLatLng();
    const meta = destinazioneSquadra(squadra);
    const ultimo = teamLastUpdateTimestamps.get(teamId) || squadra.last_update;
    const ferma = !ultimo || (Date.now() - new Date(ultimo).getTime() > STALE_TIMESTAMP_THRESHOLD);

    const box = document.createElement('div');
    box.className = 'riquadro-squadra';
    const testa = document.createElement('div');
    testa.className = 'rs-testa';
    const lettera = document.createElement('span');
    lettera.className = 'rs-lettera';
    lettera.textContent = (squadra.nome_radio || '?').charAt(0).toUpperCase();
    const nomi = document.createElement('div');
    const nome = document.createElement('strong');
    nome.textContent = squadra.nome_radio || `Squadra ${teamId}`;
    nomi.appendChild(nome);
    if (squadra.nome) {
        const desc = document.createElement('span');
        desc.textContent = squadra.nome;
        nomi.appendChild(desc);
    }
    testa.append(lettera, nomi);
    box.appendChild(testa);

    const stato = document.createElement('div');
    if (!meta) {
        stato.className = 'rs-stato libera';
        stato.textContent = 'Libera';
    } else {
        const distanza = posizione && meta.posizione ? distanzaMetri(posizione, meta.posizione) : null;
        const sulPosto = distanza != null && distanza <= DISTANZA_SUL_POSTO;
        stato.className = 'rs-stato ' + (sulPosto ? 'sul-posto' : 'in-viaggio');
        stato.textContent = `${sulPosto ? 'Sul posto' : 'Verso'} #${meta.numero}${meta.titolo ? ' · ' + meta.titolo : ''}`;
        if (distanza != null && !sulPosto) {
            const d = document.createElement('span');
            d.className = 'rs-distanza';
            d.textContent = `${distanzaLeggibile(distanza)} in linea d'aria`;
            stato.appendChild(d);
        }
    }
    box.appendChild(stato);

    const righe = document.createElement('dl');
    righe.className = 'rs-righe';
    const riga = (etichetta, valore, classe) => {
        const dt = document.createElement('dt');
        dt.textContent = etichetta;
        const dd = document.createElement('dd');
        dd.textContent = valore;
        if (classe) dd.className = classe;
        righe.append(dt, dd);
    };
    riga('Posizione', posizione ? (quandoRelativo(ultimo) || '—') + (ferma ? ' · non si aggiorna' : '') + testoMittente(teamId, squadra) : 'mai ricevuta', ferma ? 'attenzione' : null);
    if (squadra.caposquadra) {
        const dt = document.createElement('dt');
        dt.textContent = 'Caposquadra';
        const dd = document.createElement('dd');
        dd.appendChild(contattoCaposquadra(squadra.caposquadra));
        righe.append(dt, dd);
    }
    const membri = (squadra.membri || []).filter(m => !m.caposquadra).map(m => [m.cognome, m.nome].filter(Boolean).join(' ') || m.username);
    riga(squadra.caposquadra ? 'Con lui' : 'Membri', membri.length ? (membri.slice(0, 3).join(', ') + (membri.length > 3 ? ` e altri ${membri.length - 3}` : '')) : (squadra.caposquadra ? 'nessun altro' : 'nessuno'));
    box.appendChild(righe);

    const azioni = document.createElement('div');
    azioni.className = 'rs-azioni';
    if (meta) {
        const apri = document.createElement('button');
        apri.type = 'button';
        apri.className = 'button-style button-secondary button-small';
        apri.textContent = `Apri #${meta.numero}`;
        apri.addEventListener('click', () => { map.closePopup(); showReportDetails(meta.reportId); });
        azioni.appendChild(apri);
        if (posizione && meta.posizione && percorsoAttivo?.teamId !== teamId && distanzaMetri(posizione, meta.posizione) > DISTANZA_SUL_POSTO) {
            const strada = document.createElement('button');
            strada.type = 'button';
            strada.className = 'button-style button-small';
            strada.textContent = 'Percorso';
            strada.addEventListener('click', () => trovaSquadra(teamId));
            azioni.appendChild(strada);
        }
    }
    if (azioni.children.length) box.appendChild(azioni);
    return box;
}

/**
 * Porta la squadra in vista. Se e' assegnata a una segnalazione e non e'
 * ancora li', disegna la strada che deve fare e inquadra entrambe.
 */
async function trovaSquadra(teamId) {
    const squadra = allTeamsList.find(t => t.id === teamId);
    const nome = squadra?.nome_radio || 'La squadra';
    const marker = teamMarkerReferences[teamId];
    if (!marker) {
        notifica(`${nome} non ha ancora mandato la sua posizione: serve l'app aperta da almeno un membro.`, 'attenzione');
        return;
    }
    if (!map.hasLayer(teamMarkersLayer)) teamMarkersLayer.addTo(map);
    // Il dettaglio di una segnalazione copre la mappa sul telefono.
    if (document.body.classList.contains('dettaglio-aperto')) closeBottomPanel?.();
    const posizione = marker.getLatLng();
    const meta = destinazioneSquadra(squadra);
    evidenziaSquadra(marker);
    if (meta?.posizione && distanzaMetri(posizione, meta.posizione) > DISTANZA_SUL_POSTO) {
        await mostraPercorso(squadra, meta, { inquadra: true });
        // Sulla mappa bassa del telefono il riquadro coprirebbe il percorso:
        // basta la barra con distanza e tempo.
        if (map.getSize().y < 500) return;
    } else {
        togliPercorso();
        map.flyTo(posizione, Math.max(map.getZoom(), 16), { duration: 0.6 });
        if (meta && !meta.posizione) notifica(`La segnalazione #${meta.numero} non ha una posizione sulla mappa: il percorso non si può disegnare.`, 'info');
    }
    marker.openPopup();
}

function evidenziaSquadra(marker) {
    const el = marker.getElement();
    if (!el) return;
    el.classList.remove('team-marker-cercato');
    void el.offsetWidth; // riparte l'animazione
    el.classList.add('team-marker-cercato');
    setTimeout(() => el.classList.remove('team-marker-cercato'), 3200);
}

async function mostraPercorso(squadra, meta, { inquadra }) {
    const marker = teamMarkerReferences[squadra.id];
    if (!marker || !meta?.posizione) return;
    const da = marker.getLatLng();
    percorsoAttivo = { teamId: squadra.id, reportId: meta.reportId, calcolatoIl: Date.now() };
    const questo = percorsoAttivo;
    mostraInfoPercorso(squadra, meta, null);
    const percorso = await calcolaPercorso(da, meta.posizione);
    if (percorsoAttivo !== questo) return; // nel frattempo se ne e' chiesto un altro
    livelloPercorso.clearLayers();
    const opzioni = percorso.stradale ? {} : { dashArray: '8 10' };
    L.polyline(percorso.punti, { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(livelloPercorso);
    const linea = L.polyline(percorso.punti, { color: '#2477b3', weight: 5, opacity: 0.95, interactive: false, ...opzioni }).addTo(livelloPercorso);
    L.circleMarker(meta.posizione, { radius: 18, color: '#d4453c', weight: 3, fill: false, interactive: false, className: 'meta-percorso' }).addTo(livelloPercorso);
    mostraInfoPercorso(squadra, meta, percorso);
    if (inquadra) {
        const aperti = document.body.classList.contains('eventi-aperti') ? 330 : 40;
        // In alto resta spazio per il riquadro della squadra, che si apre sopra
        // al suo segno; sulla mappa bassa del telefono quanto basta.
        const alta = map.getSize().y >= 500;
        map.fitBounds(linea.getBounds().extend(da), {
            paddingTopLeft: alta ? [60, 250] : [70, 70],
            paddingBottomRight: alta ? [aperti + 60, 110] : [30, 70],
            maxZoom: 17
        });
    }
}

function togliPercorso() {
    percorsoAttivo = null;
    livelloPercorso?.clearLayers();
    document.getElementById('info-percorso')?.remove();
}

function mostraInfoPercorso(squadra, meta, percorso) {
    let info = document.getElementById('info-percorso');
    if (!info) {
        info = document.createElement('div');
        info.id = 'info-percorso';
        info.setAttribute('role', 'status');
        document.getElementById('map-container')?.appendChild(info);
    }
    info.innerHTML = '';
    const testo = document.createElement('span');
    const titolo = document.createElement('strong');
    titolo.textContent = `${squadra.nome_radio} → #${meta.numero}`;
    const dettaglio = document.createElement('span');
    dettaglio.className = 'dettaglio-percorso';
    if (!percorso) dettaglio.textContent = 'calcolo del percorso…';
    else if (percorso.stradale) dettaglio.textContent = `${distanzaLeggibile(percorso.metri)} su strada · circa ${durataLeggibile(percorso.secondi)}`;
    else dettaglio.textContent = `${distanzaLeggibile(percorso.metri)} in linea d'aria · percorso stradale non disponibile`;
    testo.append(titolo, dettaglio);
    const chiudi = document.createElement('button');
    chiudi.type = 'button';
    chiudi.setAttribute('aria-label', 'Nascondi il percorso');
    chiudi.title = 'Nascondi il percorso';
    chiudi.innerHTML = '&times;';
    chiudi.addEventListener('click', togliPercorso);
    info.append(testo, chiudi);
}

// La squadra si e' mossa mentre se ne guarda il percorso: si ricalcola, al
// massimo ogni 30 secondi, senza spostare la mappa.
function aggiornaPercorsoSeServe(teamId) {
    if (!percorsoAttivo || percorsoAttivo.teamId !== teamId) return;
    if (Date.now() - percorsoAttivo.calcolatoIl < 30000) return;
    const squadra = allTeamsList.find(t => t.id === teamId);
    const meta = destinazioneSquadra(squadra);
    const marker = teamMarkerReferences[teamId];
    if (!meta?.posizione || meta.reportId !== percorsoAttivo.reportId || !marker) return togliPercorso();
    if (distanzaMetri(marker.getLatLng(), meta.posizione) <= DISTANZA_SUL_POSTO) {
        togliPercorso();
        notifica(`${squadra.nome_radio} e' arrivata alla segnalazione #${meta.numero}.`, 'successo');
        return;
    }
    mostraPercorso(squadra, meta, { inquadra: false });
}

function updateEmergencyStatusUI(emergencyData) {
    activeEmergency = emergencyData ? emergencyData.emergency : null;

    // Strade chiuse e zone sono dell'emergenza: cambia lei, cambiano loro.
    elementiMappa?.carica();
    // L'accesso esterno temporaneo nasce e finisce con l'emergenza.
    const esterniBtn = document.getElementById('esterni-temporanei-btn');
    if (esterniBtn) esterniBtn.style.display = activeEmergency && !ruoliUtente().includes('esterno') ? 'block' : 'none';
    const situazioneBtn = document.getElementById('situazione-btn');
    if (situazioneBtn) situazioneBtn.style.display = activeEmergency && !ruoliUtente().includes('esterno') ? '' : 'none';
    // La chiamata dei volontari e la fascia di chi è stato chiamato.
    window.Chiamata?.emergenza(activeEmergency);

    const isAdmin = haRuolo('admin');
    const canUpload = !ruoliUtente().includes('esterno');

    console.log(`[UI Update] Emergenza Attiva: ${!!activeEmergency}, Utente Admin: ${isAdmin}`);

    if (emergencyStatusDisplay) {
        if (activeEmergency) {
            const startTime = new Date(activeEmergency.start_time).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            emergencyStatusDisplay.innerHTML = 'Emergenza Attiva: <strong>' + escapeHTML(activeEmergency.code) + '</strong> (Aperta da: ' + escapeHTML(startTime) + ')';
            emergencyStatusDisplay.style.backgroundColor = 'var(--danger-soft-bg)';
            emergencyStatusDisplay.style.color = 'var(--danger-text)';
            emergencyStatusDisplay.style.border = '1px solid var(--danger-text)';
        } else {
            emergencyStatusDisplay.innerHTML = '<span>Nessuna Emergenza Attiva</span>';
            emergencyStatusDisplay.style.backgroundColor = 'var(--success-soft-bg)';
            emergencyStatusDisplay.style.color = 'var(--success-text)';
            emergencyStatusDisplay.style.border = '1px solid var(--success-text)';
        }
    } else {
        console.error("Elemento #emergency-status-display non trovato.");
    }

    // Aprire e chiudere: chi ne ha il permesso (src/permessi.js).
    const apreEChiude = haPermesso('emergenze.apertura');
    if (openEmergencyBtn) {
        openEmergencyBtn.style.display = !activeEmergency && apreEChiude ? 'inline-block' : 'none';
    }
    if (closeEmergencyBtn) {
        closeEmergencyBtn.style.display = activeEmergency && apreEChiude ? 'inline-block' : 'none';
    }

    if (uploadNewDocBtn) {
        uploadNewDocBtn.style.display = activeEmergency && canUpload ? 'inline-block' : 'none';
    }
    if (toggleDocsPanelBtn) {
        if (activeEmergency) {
            toggleDocsPanelBtn.style.display = 'inline-flex';
        } else {
            toggleDocsPanelBtn.style.display = 'none';
            if (emergencyDocsManagementDiv) {
                reportsManagementDiv.classList.remove('showing-docs'); 
            }
            toggleDocsPanelBtn.classList.remove('is-active');
            toggleDocsPanelBtn.style.display = 'none';
            toggleDocsPanelBtn.innerHTML = '<i class="fas fa-folder"></i>';
        }
    }
    loadEmergencyDocuments(activeEmergency ? activeEmergency.id : null);
    // e il flusso degli eventi già accaduti, così chi arriva ora si allinea
    if (pannelloEventi) {
        pannelloEventi.style.display = activeEmergency ? 'flex' : 'none';
        if (activeEmergency) caricaEventi();
    }

    showOnlyClosedReports = false;
    if (toggleClosedBtn) {
        toggleClosedBtn.textContent = 'Mostra chiuse';
        toggleClosedBtn.disabled = !activeEmergency;
    }
    toggleReportActions(!!activeEmergency); 
    // La simulazione: fascia, "Emergenza reale", pannello della regia. Per ultima: corregge i pulsanti.
    window.Regia?.emergenza(activeEmergency);
}

async function fetchEmergencyStatus() {
    console.log("Recupero stato emergenza iniziale...");
    try {
        const statusData = await fetchApi('/api/emergencies/status');
        console.log("Stato emergenza ricevuto:", statusData);
        updateEmergencyStatusUI(statusData);
        return activeEmergency?.id;
    } catch (error) {
        console.error("Errore recupero stato emergenza:", error);
        updateEmergencyStatusUI({ active: false, emergency: null });
        return null;
    }
}

function toggleReportActions(enable) {
    const disabledState = !enable;
    const targetOpacity = enable ? '1' : '0.5';
    const targetPointerEvents = enable ? 'auto' : 'none';

    // Pulsante Nuova Segnalazione
    if (createNewReportBtn) createNewReportBtn.disabled = disabledState;

    // Pulsanti nel pannello dettagli inferiore
    const editBtn = document.getElementById('bottom-panel-edit-btn');
    const assignBtn = document.getElementById('bottom-panel-assign-btn');
    const addImgBtn = document.getElementById('details-panel-add-images-btn');
    const printLink = document.getElementById('generate-print-link');
    const saveStatusBtn = document.getElementById('detail-save-status-btn');
    const statusSelect = document.getElementById('detail-status-select');

    if (editBtn) editBtn.disabled = disabledState;
    if (assignBtn) assignBtn.disabled = disabledState;
    if (addImgBtn) addImgBtn.disabled = disabledState;
    if (saveStatusBtn) saveStatusBtn.disabled = disabledState;
    if (statusSelect) statusSelect.disabled = disabledState;
    // Il link di stampa lo nascondiamo/mostriamo ma non ha senso disabilitarlo

    // Form Aggiornamenti
    if (bottomPanelAddUpdateForm) {
         if (bottomPanelNewUpdateText) bottomPanelNewUpdateText.disabled = disabledState;
         bottomPanelAddUpdateForm.style.opacity = targetOpacity;
         bottomPanelAddUpdateForm.style.pointerEvents = targetPointerEvents;
    }

     document.querySelectorAll('#report-detail-side-panel button:not(#close-bottom-panel-btn), #createNewReportBtn').forEach(btn => {
         if(btn) btn.style.opacity = targetOpacity;
     });

}

// Le letture tenute dal server: fin dove ho letto ogni segnalazione, quante
// voci di altri sono arrivate dopo e quante di queste sono forti. Ricaricando
// la pagina tornano i contatori e il lampeggio di quello che non ho visto.
async function caricaLettureServer() {
    let letture;
    try { letture = (await fetchApi('/api/letture'))?.letture || []; } catch { return; }
    letture.forEach(l => {
        const id = Number(l.report_id);
        const locale = window.reportLastViewedLogTimestamp.get(String(id));
        if (!locale || new Date(l.letta_il) > new Date(locale)) window.reportLastViewedLogTimestamp.set(String(id), l.letta_il);
        if (id === currentlyDisplayedReportId) return;
        if (l.non_lette > (nonLettiPerSegnalazione.get(id) || 0)) nonLettiPerSegnalazione.set(id, l.non_lette);
        if (l.forti > 0) blinkingReportIds.add(id);
    });
    reportListBody?.querySelectorAll('.inbox-card').forEach(card => {
        const id = Number(card.dataset.reportId);
        const vista = window.reportLastViewedLogTimestamp.get(String(id));
        const modificata = card.dataset.modificata;
        card.dataset.maiAperta = (card.dataset.terminale !== 'si' && modificata && (!vista || new Date(modificata) > new Date(vista))) ? 'si' : 'no';
        card.classList.toggle('unread-blink', blinkingReportIds.has(id));
        disegnaSegnalatoreCard(id);
    });
    aggiornaTitoloScheda();
}

function getCurrentUserId() {
    return localStorage.getItem('userId');
}

function loadReadStatusFromStorage() {
    const userId = getCurrentUserId();
    if (!userId) return;
    try {
        const storedTimestamps = localStorage.getItem(`unreadLogTimestamps_${userId}`);
        if (storedTimestamps) {
            const parsedTimestamps = JSON.parse(storedTimestamps);
            window.reportLastViewedLogTimestamp = new Map(Object.entries(parsedTimestamps));
            console.log('Stato lettura log caricato da localStorage.');
        }
    } catch (e) {
        console.error('Errore caricamento stato lettura log:', e);
        window.reportLastViewedLogTimestamp = new Map();
    }
}

function saveReadStatusToStorage(reportId, timestamp) {
    const userId = getCurrentUserId();
    if (!userId || reportId === null || timestamp === undefined) return;
    
    const precedente = window.reportLastViewedLogTimestamp.get(String(reportId));
    if (precedente && new Date(precedente) >= new Date(timestamp)) return;
    window.reportLastViewedLogTimestamp.set(String(reportId), timestamp);
    // Anche sul server: le novità restano giuste ricaricando o cambiando postazione.
    fetchApi(`/api/letture/${reportId}`, { method: 'PUT', body: JSON.stringify({ letta_il: timestamp }) }).catch(() => {});
    
    try {
        const objectToStore = Object.fromEntries(window.reportLastViewedLogTimestamp);
        localStorage.setItem(`unreadLogTimestamps_${userId}`, JSON.stringify(objectToStore));
    } catch (e) {
        console.error('Errore salvataggio stato lettura log:', e);
    }
}

// La situazione di una segnalazione, a colpo d'occhio: sulla mappa è il
// colore del segnaposto, nell'elenco il riepilogo in alto.
function situazioneSegnalazione(report) {
    if (report.status === 'Closed') return 'chiusa';
    if (report.status === 'Resolved') return 'risolta';
    if (Array.isArray(report.assigned_teams) && report.assigned_teams.length > 0) return 'con_squadra';
    if (report.no_team_reason) return 'senza_squadra';
    return 'da_assegnare';
}

// Le novità forti, quelle che lampeggiano (vedi ws:new_report_update).
function haNovita(id) {
    return blinkingReportIds.has(Number(id));
}

// Il segnaposto: una goccia colorata secondo la situazione (rosso da
// assegnare, blu con squadra, viola senza bisogno di squadra, verde risolta,
// grigio chiusa), più grande se la priorità è alta. Le novità non viste
// prevalgono su tutto: un anello giallo pulsa attorno e il segnaposto salta.
function createReportDivIcon(report) {
    if (!report?.id) return defaultReportIcon;
    const alta = report.priority === 'High';
    const [w, h] = alta ? [34, 47] : [28, 39];
    const classi = ['pin-segnalazione', `sit-${situazioneSegnalazione(report)}`];
    if (alta) classi.push('prio-alta');
    if (haNovita(report.id)) classi.push('con-novita');
    const numero = report.emergency_report_number ?? report.id ?? '?';
    const html = `<div class="${escapeHTML(classi.join(' '))}"><span class="anello-novita"></span>`
        + '<svg viewBox="0 0 30 42" aria-hidden="true"><path d="M15 1.5C7.5 1.5 1.5 7.4 1.5 14.8 1.5 24.9 15 40.5 15 40.5S28.5 24.9 28.5 14.8C28.5 7.4 22.5 1.5 15 1.5z"/></svg>'
        + `<span class="marker-id">${escapeHTML(String(numero))}</span></div>`;
    return L.divIcon({
        className: 'custom-leaflet-div-icon',
        html,
        iconSize: [w, h],
        iconAnchor: [w / 2, h],
        popupAnchor: [0, -h - 3]
    });
}

// Le novità cambiano: il segnaposto e il gruppo che lo contiene si ridisegnano.
function aggiornaNovitaSegnaposto(id) {
    const marker = reportMarkerReferences[id] || reportMarkerReferences[Number(id)];
    if (!marker?.datiReport) return;
    marker.setIcon(createReportDivIcon(marker.datiReport));
    reportMarkersLayer?.refreshClusters?.(marker);
}

// Un gruppo di segnaposto vicini prende il colore della situazione più
// urgente fra le sue, e pulsa se una di loro ha novità.
const ORDINE_SITUAZIONI = ['da_assegnare', 'con_squadra', 'senza_squadra', 'risolta', 'chiusa'];
function iconaGruppoSegnalazioni(gruppo) {
    const figli = gruppo.getAllChildMarkers();
    const piuUrgente = ORDINE_SITUAZIONI.find(sit => figli.some(m => m.situazione === sit)) || 'chiusa';
    const classi = ['gruppo-segnalazioni', `sit-${piuUrgente}`];
    if (figli.some(m => haNovita(m.reportId))) classi.push('con-novita');
    return L.divIcon({
        className: 'custom-leaflet-div-icon',
        html: `<div class="${escapeHTML(classi.join(' '))}"><span class="anello-novita"></span><span class="gruppo-numero">${escapeHTML(String(gruppo.getChildCount()))}</span></div>`,
        iconSize: [38, 38]
    });
}

function createTeamDivIcon(teamData, isStale = false) {
    const prefix = teamData?.nome_radio || '';
    const letter = prefix ? prefix.charAt(0).toUpperCase() : '?';
    const letterClass = `prefix-letter-${letter}`;
    const staleClass = isStale ? ' team-marker-stale' : '';

    const iconHtml = `<span class="marker-letter">${letter}</span>`;
    const iconWidth = 30;
    const iconHeight = 30;

    return L.divIcon({
        // Aggiunge la classe staleClass se necessario
        className: `team-marker-div-icon ${letterClass}${staleClass}`,
        html: iconHtml,
        iconSize: [iconWidth, iconHeight],
        iconAnchor: [iconWidth / 2, iconHeight / 2],
        popupAnchor: [0, -iconHeight / 2 - 5] 
    });
}

function updateSingleTeamMarker(teamData) {
    if (!teamMarkersLayer || !map || !teamData) return;

    const { squadra_id: teamId, nome_radio: prefix, latitude: lat, longitude: lon, last_update: lastUpdate } = teamData;
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    
    if (teamId == null || isNaN(parsedLat) || isNaN(parsedLon)) {
        console.warn(`[Coordinate invalide] Squadra ${teamId} ignorata. Lat: ${lat}, Lon: ${lon}`);
        return;
    }

    if (lastUpdate) {
        teamLastUpdateTimestamps.set(teamId, lastUpdate);
    }
    if (teamData.inviata_da) mittentiPosizione.set(teamId, teamData.inviata_da);

    const position = [parsedLat, parsedLon];
    
    const now = Date.now();
    const isStale = lastUpdate && (now - new Date(lastUpdate).getTime() > STALE_TIMESTAMP_THRESHOLD);
    
    const existingMarker = teamMarkerReferences[teamId];

    if (existingMarker) {
        existingMarker.setLatLng(position);
        if (existingMarker.isPopupOpen()) existingMarker.setPopupContent(riquadroSquadra(teamId));
        
        const iconElement = existingMarker.getElement();
        if (iconElement && !isStale) iconElement.classList.remove('team-marker-stale');
        
    } else {
        const icon = createTeamDivIcon(teamData, isStale); 
        teamMarkersLayer.addLayer(nuovoMarkerSquadra(teamId, position, icon));
    }
    aggiornaPercorsoSeServe(teamId);
}

// Il riquadro si costruisce all'apertura; il clic porta in vista la squadra
// e, se sta andando a una segnalazione, ne disegna la strada.
function nuovoMarkerSquadra(teamId, position, icon) {
    const marker = L.marker(position, { icon })
        .bindPopup(() => riquadroSquadra(teamId), { className: 'popup-orion', minWidth: 240, maxWidth: 300, autoPan: false });
    marker.off('click', marker._openPopup);
    marker.on('click', () => trovaSquadra(teamId));
    teamMarkerReferences[teamId] = marker;
    return marker;
}

function updateTeamMarkers(teamLocations) {
    if (!teamMarkersLayer || !map) return;
    console.log(`[updateTeamMarkers] Ricevute ${teamLocations?.length || 0} posizioni squadra.`);
    const receivedTeamIds = new Set();
    const now = Date.now();

    if (Array.isArray(teamLocations)) {
        teamLocations.forEach(loc => {
            const { squadra_id: teamId, nome_radio: prefix, latitude: lat, longitude: lon, last_update: lastUpdate } = loc;
            const parsedLat = parseFloat(lat);
            const parsedLon = parseFloat(lon);
    
            if (teamId == null || isNaN(parsedLat) || isNaN(parsedLon)) {
                console.warn(`[Coordinate invalide] Squadra ${teamId} ignorata. Lat: ${lat}, Lon: ${lon}`);
                return;
            }

            receivedTeamIds.add(teamId);
            if (loc.inviata_da) mittentiPosizione.set(teamId, loc.inviata_da);

            let isStale = true;
            if (lastUpdate) {
                try {
                    const lastUpdateTs = new Date(lastUpdate).getTime();
                    if (!isNaN(lastUpdateTs)) isStale = (now - lastUpdateTs > STALE_TIMESTAMP_THRESHOLD);
                    else console.warn(`[updateTeamMarkers] Timestamp non valido per team ${teamId}: ${lastUpdate}`);
                } catch (e) { console.error(`[updateTeamMarkers] Errore parsing timestamp per team ${teamId}: ${lastUpdate}`, e); }
            }
            console.log(`[updateTeamMarkers] Team ${teamId} - Timestamp: ${lastUpdate}, Is Stale: ${isStale}`);

            const icon = createTeamDivIcon(loc, isStale);
            const position = [parsedLat, parsedLon];
            const existingMarker = teamMarkerReferences[teamId];

            if (lastUpdate) {
                teamLastUpdateTimestamps.set(teamId, lastUpdate);
                console.log(`[updateTeamMarkers] Timestamp per team ${teamId} salvato/aggiornato in teamLastUpdateTimestamps:`, lastUpdate);
            } else {
                teamLastUpdateTimestamps.delete(teamId);
                console.log(`[updateTeamMarkers] Timestamp per team ${teamId} rimosso da teamLastUpdateTimestamps (valore nullo).`);
            }
            console.log(`[updateTeamMarkers] Stato attuale teamLastUpdateTimestamps:`, new Map(teamLastUpdateTimestamps));

            if (existingMarker) {
                existingMarker.setLatLng(position).setIcon(icon);
                if (existingMarker.isPopupOpen()) existingMarker.setPopupContent(riquadroSquadra(teamId));
            } else {
                teamMarkersLayer.addLayer(nuovoMarkerSquadra(teamId, position, icon));
            }
            aggiornaPercorsoSeServe(teamId);
        });
    }
    if (percorsoAttivo && !receivedTeamIds.has(percorsoAttivo.teamId)) togliPercorso();

    Object.keys(teamMarkerReferences).forEach(teamIdStr => {
        const teamId = parseInt(teamIdStr, 10);
        if (!receivedTeamIds.has(teamId)) {
            console.log(`--- Rimuovo marker e timestamp squadra ${teamId}`);
            if(teamMarkersLayer && teamMarkerReferences[teamId]) {
                try { teamMarkersLayer.removeLayer(teamMarkerReferences[teamId]); }
                catch(removeErr) { console.error(`Errore rimozione layer team ${teamId}:`, removeErr); }
            }
            delete teamMarkerReferences[teamId];
            teamLastUpdateTimestamps.delete(teamId);
        }
    });
    console.log(`[updateTeamMarkers] Fine. Marker attivi: ${Object.keys(teamMarkerReferences).length}. Timestamp salvati: ${teamLastUpdateTimestamps.size}`);
}

async function loadTeamLocations() {
    console.log("Caricamento posizioni squadre...");
    try {
        const locations = await fetchApi('/api/location');
        updateTeamMarkers(locations || []);
    } catch (error) {
        console.error("Errore caricamento posizioni squadre:", error);

    }
}

function openEmergencyModal() {
    if (openEmergencyModalElement && openEmergencyForm) {
        openEmergencyForm.reset();
        openEmergencyModalElement.style.display = 'flex';
        if(emergencyExternalCodeInput) emergencyExternalCodeInput.focus();
        mostraSquadreEsistenti();
    } else { console.error("Elementi modale apertura emergenza non trovati."); }
}

// Le squadre già formate: di base entrano nell'emergenza così come sono, e
// una casella permette di scioglierle per partire da capo.
async function mostraSquadreEsistenti() {
    const blocco = document.getElementById('blocco-squadre-esistenti');
    if (!blocco) return;
    blocco.hidden = true;
    // Interrompendo una simulazione le squadre restano: niente scelta.
    if (activeEmergency?.simulazione) return;
    const squadre = await fetchApi('/api/squadre').catch(() => []);
    if (!Array.isArray(squadre) || squadre.length === 0) return;
    document.getElementById('testo-squadre-esistenti').textContent = squadre.length === 1
        ? 'C\'è già una squadra formata: entra nell\'emergenza così com\'è.'
        : `Ci sono già ${squadre.length} squadre formate: entrano nell'emergenza così come sono.`;
    const elenco = document.getElementById('elenco-squadre-esistenti');
    elenco.innerHTML = '';
    squadre.forEach(s => {
        const quanti = (s.membri || []).length;
        const li = document.createElement('li');
        li.textContent = `${s.nome_radio}${s.nome ? ' - ' + s.nome : ''} (${quanti} ${quanti === 1 ? 'volontario' : 'volontari'})`;
        elenco.appendChild(li);
    });
    document.getElementById('sciogli-squadre-esistenti').checked = false;
    blocco.hidden = false;
}

function closeEmergencyModal() {
    if (openEmergencyModalElement) {
        openEmergencyModalElement.style.display = 'none';
    }
}

async function loadAllMapMarkers(emergencyId) {
    console.log(`[loadAllMapMarkers] Inizio caricamento marker per Emergency ID: ${emergencyId}`);
    if (!reportMarkersLayer || !map) {
        console.error("[loadAllMapMarkers] Mappa o layer marker non inizializzati.");
        return;
    }

    reportMarkersLayer.clearLayers();
    reportMarkerReferences = {};
    console.log("[loadAllMapMarkers] Layer e riferimenti marker puliti.");

    // Se non c'è un ID emergenza, non c'è nulla da caricare sulla mappa
    if (emergencyId === null || emergencyId === undefined) {
        console.log("[loadAllMapMarkers] Nessun ID emergenza fornito, mappa marker vuota.");
        return;
    }

    try {
        const apiUrl = `/api/reports?limit=1000&status_type=all&emergency_id=${emergencyId}`;
        console.log(`[loadAllMapMarkers] Chiamata API: ${apiUrl}`);
        const data = await fetchApi(apiUrl);

        if (!data?.reports) {
            console.warn("[loadAllMapMarkers] Nessun report ricevuto dall'API per i marker.");
            return;
        }

        const allReports = data.reports;
        console.log(`[loadAllMapMarkers] Ricevuti ${allReports.length} report totali per emergenza ${emergencyId}.`);

        addReportMarkers(allReports);
        console.log("[loadAllMapMarkers] Caricamento marker iniziali completato.");

    } catch (error) {
        console.error(`[loadAllMapMarkers] Errore durante caricamento marker iniziali per emergenza ${emergencyId}:`, error);
    }
}

async function loadReports(page = 1, limit = 25, showClosed = false, emergencyId = null) {
    const statusFilter = showClosed ? 'closed' : 'active';
    console.log(`[loadReports - INBOX] Caricamento pagina ${page}, filtro: ${statusFilter}, Emergenza ID: ${emergencyId}`);

    const tableBody = reportListBody;
    const tableWrapper = reportTableWrapper;
    if (!tableBody || !tableWrapper) { console.error("Elementi lista report mancanti!"); return; }

    isLoadingMore = true;
    tableWrapper.classList.add('loading-data');

    if (page === 1) {
        tableBody.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Caricamento segnalazioni ${statusFilter}...</div>`;
    }

    if (emergencyId === null || emergencyId === undefined) {
        console.log("[loadReports - INBOX] Nessun ID emergenza, lista vuota.");
        if (page === 1) tableBody.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">Nessuna emergenza attiva.</div>`;
        isLoadingMore = false;
        tableWrapper.classList.remove('loading-data');
        return;
    }

    try {
        const apiUrl = `/api/reports?page=${page}&limit=${limit}&status_type=${statusFilter}&emergency_id=${emergencyId}`;
        const data = await fetchApi(apiUrl);

        if (!data?.reports || !data.pagination) throw new Error('Formato dati API non corretto.');

        const { reports: tableReports, pagination: paginationInfo } = data;

        currentReportListPage = paginationInfo.currentPage || 1;
        totalReportPages = paginationInfo.totalPages || 1;

        if (page === 1) tableBody.innerHTML = '';
        appendReportRows(tableReports);
        if (!showClosed) caricaLettureServer();

    } catch (error) {
        console.error(`[loadReports - INBOX] Errore caricamento reports:`, error);
        if (page === 1) tableBody.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--danger-text);">Errore: ${escapeHTML(error.message)}</div>`;
        else document.getElementById('loading-more-row')?.remove();
    } finally {
        isLoadingMore = false;
        tableWrapper.classList.remove('loading-data');
    }
}

function highlightTableRow(reportId) {
    if (!reportListBody) return;
    const rows = reportListBody.querySelectorAll('.inbox-card');
    rows.forEach(row => row.classList.remove('selected-row'));
    if (reportId !== null) {
         const rowToSelect = reportListBody.querySelector(`.inbox-card[data-report-id="${reportId}"]`);
         if (rowToSelect) {
             rowToSelect.classList.add('selected-row');
         }
    }
}

function closeBottomPanel() {
    if (!sidePanel) return;
    const closedReportId = currentlyDisplayedReportId;
    if (closedReportId !== null) {
        if (blinkingReportIds.has(closedReportId)) {
            blinkingReportIds.delete(closedReportId);
            const reportCard = reportListBody?.querySelector(`.inbox-card[data-report-id="${closedReportId}"]`);
            if (reportCard) {
                reportCard.classList.remove('unread-blink');
            }
        }
        if (bottomPanelUpdatesList) {
            const logItems = bottomPanelUpdatesList.querySelectorAll('li[data-log-timestamp]');
            if (logItems.length > 0) {
                const latestTimestamp = logItems[logItems.length - 1].dataset.logTimestamp;
                if (latestTimestamp) saveReadStatusToStorage(closedReportId, latestTimestamp);
            }
        }
    }
    
    sidePanel.style.left = '-100%'; 
    // Sul telefono il dettaglio prende tutta l'area: chiuso, tornano mappa ed elenco.
    document.body.classList.remove('dettaglio-aperto');
    highlightTableRow(null);
    currentlyDisplayedReportId = null;
    
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 300);
}

async function showReportDetails(reportId) {
    if (!bottomPanel || !reportListBody || !bottomPanelMainContent || !bottomPanelUpdatesList || !bottomPanelReportIdSpan) {
        console.error("Elementi pannello dettagli mancanti!");
        return;
    }

    const previousReportId = currentlyDisplayedReportId;
    if (previousReportId !== null && previousReportId !== reportId) {
        if (isUpdatingCoordsFromPanel && reportIdForCoordUpdate === previousReportId) {
            cancelCoordinateUpdateFromPanel();
        }
        if (bottomPanelUpdatesList) {
            const logItems = bottomPanelUpdatesList.querySelectorAll('li[data-log-timestamp]');
            if (logItems.length > 0) {
                const latestTimestamp = logItems[logItems.length - 1].dataset.logTimestamp;
                if (latestTimestamp) saveReadStatusToStorage(previousReportId, latestTimestamp);
            }
        }
        if (blinkingReportIds.has(previousReportId)) {
            blinkingReportIds.delete(previousReportId);
            reportListBody?.querySelector(`.inbox-card[data-report-id="${previousReportId}"]`)?.classList.remove('report-updated-blink', 'report-updated-flash');
        }
    }

    currentlyDisplayedReportId = reportId;
    highlightTableRow(reportId);
    chiudiAvvisiDi(reportId);
    bottomPanelMainContent.innerHTML = '<p style="text-align: center; padding: 20px;">Caricamento dettagli...</p>';
    bottomPanelUpdatesList.innerHTML = '<li>Caricamento aggiornamenti...</li>';
    if (bottomPanelNewUpdateText) bottomPanelNewUpdateText.value = '';
    bottomPanel.style.display = 'flex';
    if (sidePanel) sidePanel.style.left = '0px'; 
    document.body.classList.add('dettaglio-aperto');

    try {
        const data = await fetchApi(`/api/reports/${reportId}`);
        if (!data?.report) throw new Error(`Dati report ${reportId} non trovati.`);

        const report = data.report;
        const updates = data.updates || [];

        const reportIndex = currentReports.findIndex(r => r.id === report.id);
        if (reportIndex > -1) currentReports[reportIndex] = report;
        else currentReports.push(report);

        const reportIsModifiableByCurrentUser = activeEmergency && report.emergency_id === activeEmergency.id;

        const displayValue = report.emergency_report_number ?? report.id;
        bottomPanelReportIdSpan.textContent = displayValue;
        bottomPanelMainContent.innerHTML = '';

        let priorityColor = '#10b981';
        let priorityIcon = 'fa-arrow-down';
        if (report.priority === 'High') { priorityColor = '#ef4444'; priorityIcon = 'fa-exclamation-triangle'; }
        else if (report.priority === 'Medium') { priorityColor = '#f59e0b'; priorityIcon = 'fa-arrow-up'; }

        let statusBadgeClass = 'active';
        if (['New', 'Open'].includes(report.status)) statusBadgeClass = 'suspended';
        else if (['Closed', 'Cancelled'].includes(report.status)) statusBadgeClass = 'warning';

        const createdAt = report.created_at ? new Date(report.created_at).toLocaleString('it-IT') : 'N/D';
        squadreSegnalazioneAperta = report.assigned_teams || [];
        const teamNames = htmlSquadreAssegnate(report.assigned_teams);
        const coordsText = report.latitude ? `${parseFloat(report.latitude).toFixed(5)}, ${parseFloat(report.longitude).toFixed(5)}` : 'Non presenti';

        // Sempre presente (nascosto se vuoto): i rischi possono arrivare dopo,
        // dalle zone di pericolo della mappa, e li rinfresca l'aggiornamento via WS.
        const hazardHTML = `
            <div id="dyn-hazard" ${report.environmental_hazard ? '' : 'hidden'} style="background: var(--danger-soft-bg); color: var(--danger-text, #991b1b); padding: 6px 10px; border-radius: 4px; border-left: 4px solid #ef4444; font-size: 0.85rem; font-weight: 600; display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                <i class="fas fa-biohazard"></i> <span style="flex: 1; white-space: pre-line;">PERICOLO: <span id="dyn-hazard-testo">${escapeHTML(report.environmental_hazard || '')}</span></span>
            </div>
        `;

        const detailsWrapper = document.createElement('div');
        detailsWrapper.style.display = 'flex';
        detailsWrapper.style.flexDirection = 'column';

        detailsWrapper.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
                <h2 style="margin: 0; font-size: 1.15rem; line-height: 1.2; color: var(--text-color); font-weight: 700;">
                    ${escapeHTML(report.title || 'N/D')}
                </h2>
                <div id="action-bar-icons" style="display: flex; gap: 6px; flex-shrink: 0;">
                    </div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.75rem; flex-wrap: wrap; margin-bottom: 12px;">
                <div id="quick-status-area" style="display: flex; align-items: center;">
                    <span class="status-badge ${statusBadgeClass}" style="box-sizing: border-box; height: 26px; display: inline-flex; align-items: center; padding: 0 8px; margin: 0; border: 1px solid transparent; border-radius: 4px;" id="dyn-status"><i class="fas fa-info-circle" style="margin-right: 4px;"></i> ${escapeHTML(ETICHETTA_STATO[report.status] || report.status || 'N/D')}</span>
                </div>
                <div id="quick-priority-area" style="display: flex; align-items: center;">
                    <span style="box-sizing: border-box; height: 26px; display: inline-flex; align-items: center; color: ${priorityColor}; font-weight: 600; padding: 0 8px; border: 1px solid ${priorityColor}40; border-radius: 4px; background: ${priorityColor}10;" id="dyn-priority"><i class="fas ${priorityIcon}" style="margin-right: 4px;"></i> Priorità ${escapeHTML(ETICHETTA_PRIORITA[report.priority] || report.priority || 'N/D')}</span>
                </div>
                <span style="color: var(--text-muted); margin-left: auto; display: inline-flex; align-items: center; height: 26px;"><i class="far fa-clock" style="margin-right: 4px;"></i> <span id="dyn-updated">${createdAt}</span> - ${escapeHTML(report.creator_fullname || 'Sconosciuto')}</span>
            </div>

            ${hazardHTML}

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px 15px; font-size: 0.8rem; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; margin-bottom: 10px;">
                <div style="display: flex; gap: 8px; align-items: flex-start;">
                    <i class="fas fa-map-marker-alt" style="color: var(--info-text); margin-top: 2px; width: 14px; text-align: center;"></i>
                    <div style="flex: 1; min-width: 0;">
                        <div id="dyn-address" style="font-weight: 600; line-height: 1.2;">${escapeHTML(report.location_address || 'Indirizzo N/D')}</div>
                        <div id="dyn-coords" style="color: var(--text-muted); font-size: 0.7rem; margin-top: 2px;">${coordsText}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px; align-items: flex-start;">
                    <i class="fas fa-user" style="color: var(--warning-text); margin-top: 2px; width: 14px; text-align: center;"></i>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 600; line-height: 1.2;">${escapeHTML(report.reporter_name || 'N/D')}</div>
                        <div style="font-weight: 600; color: var(--success-text); margin-top: 2px;"><i class="fas fa-phone-alt" style="font-size: 0.7rem;"></i> ${escapeHTML(report.reporter_contact || 'N/D')}</div>
                    </div>
                </div>
                <div style="display: flex; gap: 12px; align-items: center; grid-column: 1 / -1; border-top: 1px solid var(--border-light-color); padding-top: 12px;">
                    <i class="fas fa-truck-pickup" style="color: #8b5cf6; width: 14px; text-align: center; font-size: 1.1rem;"></i>
                    <div style="flex: 1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span style="font-weight: 700; color: var(--text-muted); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">Squadre Assegnate:</span>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;" id="dyn-teams">${teamNames}</div>
                    </div>
                    ${(currentUserRole !== 'esterno' && reportIsModifiableByCurrentUser) ? `<button id="bottom-panel-assign-btn" class="button-style">Gestisci</button>` : ''}
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px;">
                <div style="background: var(--bg-color); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.8rem; max-height: 70px; overflow-y: auto; line-height: 1.4;">
                    <!-- L'unico campo in cui vogliamo del markup: gli a capo. La lista
                         degli attributi e' VUOTA di proposito: con la sola lista dei tag,
                         un <br style="position:fixed;inset:0"> resta un <br> valido e
                         copre lo schermo della sala operativa. -->
                    ${DOMPurify.sanitize(report.description || '<em style="color:var(--text-muted);">Nessuna descrizione.</em>', { ALLOWED_TAGS: ['br'], ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false })}
                </div>
                <div id="dynamic-image-gallery" style="display: flex; gap: 5px; overflow-x: auto; padding-bottom: 2px;"></div>
            </div>
        `;
        bottomPanelMainContent.appendChild(detailsWrapper);
        // Le funzioni di supporto al lavoro su questa segnalazione (modulo acceso).
        const sezioneFunzioni = document.createElement('div');
        detailsWrapper.querySelector('#dynamic-image-gallery')?.parentElement?.before(sezioneFunzioni);
        window.Funzioni?.montaIncarichi(sezioneFunzioni, report, { modificabile: reportIsModifiableByCurrentUser });

        const actionBarIcons = detailsWrapper.querySelector('#action-bar-icons');
        const quickStatusArea = detailsWrapper.querySelector('#quick-status-area');
        const quickPriorityArea = detailsWrapper.querySelector('#quick-priority-area');
        const imageGallery = detailsWrapper.querySelector('#dynamic-image-gallery');

        const assignBtn = document.getElementById('bottom-panel-assign-btn');
        if (assignBtn) {
            assignBtn.onclick = () => openAssignTeamModal(report);
        }

        if (currentUserRole !== 'esterno' && reportIsModifiableByCurrentUser) {
            quickStatusArea.innerHTML = `
                <select id="detail-status-select" style="box-sizing: border-box; height: 26px; margin: 0; padding: 0 4px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; outline: none; transition: all 0.2s;">
                    <option value="New" class="tono-rosso">Nuova</option>
                    <option value="Open" class="tono-rosso">Aperta</option>
                    <option value="InProgress" class="tono-verde">In corso</option>
                    <option value="Closed" class="tono-grigio">Chiusa</option>
                </select>
            `;
            const statusSelect = quickStatusArea.querySelector('#detail-status-select');
            statusSelect.value = report.status || 'New';
            
            // Il menu chiuso ha il colore della voce scelta; aperto, ogni voce
            // ha il suo (le classi tono-* sulle option, in centro-operativo.css).
            const updateStatusColor = () => coloraScelta(statusSelect);
            updateStatusColor();

            statusSelect.addEventListener('change', () => { 
                updateStatusColor();
                const fakeFeedback = document.createElement('span');
                handleSaveStatus(report, statusSelect.value, fakeFeedback, statusSelect, report.status);
            });

            quickPriorityArea.innerHTML = `
                <select id="detail-priority-select" style="box-sizing: border-box; height: 26px; margin: 0; padding: 0 4px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; outline: none; transition: all 0.2s;">
                    <option value="Low" class="tono-verde">Bassa</option>
                    <option value="Medium" class="tono-ambra">Media</option>
                    <option value="High" class="tono-rosso">Alta</option>
                </select>
            `;
            const prioritySelect = quickPriorityArea.querySelector('#detail-priority-select');
            prioritySelect.value = report.priority || 'Medium';

            const updatePriorityColor = () => coloraScelta(prioritySelect);
            updatePriorityColor();

            prioritySelect.addEventListener('change', async () => { 
                updatePriorityColor();
                prioritySelect.disabled = true;
                try {
                    restaInCoda(await fetchApi('/api/reports/' + report.id, {
                        method: 'PUT',
                        body: JSON.stringify({ priority: prioritySelect.value }),
                        coda: `Segnalazione n. ${report.id}: priorità ${prioritySelect.selectedOptions[0]?.textContent || prioritySelect.value}`
                    }), 'La priorità');
                    // L'interfaccia (lista laterale, mappa, ecc) si aggiornerà automaticamente via WebSocket!
                } catch (error) {
                    console.error('Errore aggiornamento priorità:', error);
                    prioritySelect.value = report.priority;
                    updatePriorityColor();
                    notifica('Errore durante l\'aggiornamento della priorità: ' + error.message, 'errore');
                } finally {
                    prioritySelect.disabled = false;
                }
            });
        }

        if (report.image_urls?.length > 0) {
            report.image_urls.forEach(imageUrl => {
                const imgLink = document.createElement('a');
                imgLink.href = imageUrl; imgLink.target = '_blank';
                imgLink.innerHTML = `<img src="${imageUrl}" alt="Img" style="height: 40px; width: 40px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);">`;
                imageGallery.appendChild(imgLink);
            });
        }

        const btnStyle = "width: 26px; height: 26px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 0.85rem;";
        
        if (reportIsModifiableByCurrentUser) {
            const updateCoordsBtn = document.createElement('button');
            updateCoordsBtn.id = 'details-panel-update-coords-btn';
            updateCoordsBtn.className = 'button-style button-secondary';
            updateCoordsBtn.style.cssText = btnStyle;
            updateCoordsBtn.title = 'Mappa';
            updateCoordsBtn.innerHTML = isUpdatingCoordsFromPanel && reportIdForCoordUpdate === report.id ? '<i class="fas fa-times" style="color: var(--danger-text);"></i>' : '<i class="fas fa-map-marker-alt"></i>';
            updateCoordsBtn.addEventListener('click', () => {
                if (isUpdatingCoordsFromPanel && reportIdForCoordUpdate === report.id) cancelCoordinateUpdateFromPanel();
                else initiateCoordinateUpdateFromPanel(report.id);
            });
            actionBarIcons.appendChild(updateCoordsBtn);
        }

        if (currentUserRole !== 'esterno' && reportIsModifiableByCurrentUser) {
            const editBtn = document.createElement('button');
            editBtn.id = 'bottom-panel-edit-btn';
            editBtn.className = 'button-style button-secondary';
            editBtn.style.cssText = btnStyle;
            editBtn.title = 'Modifica';
            editBtn.innerHTML = '<i class="fas fa-pencil-alt"></i>';
            editBtn.addEventListener('click', () => openEditModal(report.id));
            actionBarIcons.appendChild(editBtn);

            const addImgBtn = document.createElement('button');
            addImgBtn.id = 'details-panel-add-images-btn';
            addImgBtn.className = 'button-style button-secondary';
            addImgBtn.style.cssText = btnStyle;
            addImgBtn.title = 'Foto';
            addImgBtn.innerHTML = '<i class="fas fa-camera"></i>';
            addImgBtn.onclick = () => { if (reportImageUploadInput) reportImageUploadInput.click(); };
            actionBarIcons.appendChild(addImgBtn);
        }
        
        const printLink = document.createElement('a');
        printLink.href = `/print-report.html?id=${reportId}`;
        printLink.target = '_blank';
        printLink.className = 'button-style button-secondary';
        printLink.style.cssText = btnStyle;
        printLink.title = 'Stampa';
        printLink.innerHTML = '<i class="fas fa-print"></i>';
        actionBarIcons.appendChild(printLink);

        bottomPanelUpdatesList.innerHTML = '';
        let lastViewedTimestampStr = window.reportLastViewedLogTimestamp.get(String(reportId));
        let lastViewedDate = null;
        if(lastViewedTimestampStr) { try { lastViewedDate = new Date(lastViewedTimestampStr); } catch(e) {} }
        const currentUserIdInt = parseInt(getCurrentUserId(), 10);

        if (updates.length > 0) {
            // Da quale voce comincia il "nuovo", per il separatore.
            const nonLette = updates.filter(u => {
                if (!u?.update_timestamp) return false;
                if (u.user_id === currentUserIdInt) return false;
                const quando = new Date(u.update_timestamp);
                return !lastViewedDate || quando > lastViewedDate;
            });
            const primaNonLetta = nonLette.length > 0 ? nonLette[0].id : null;

            updates.forEach(update => {
                if (!update?.id || !update.update_timestamp) return;

                if (update.id === primaNonLetta) {
                    bottomPanelUpdatesList.appendChild(creaSeparatoreNuovi(nonLette.length));
                }

                const isMyOwnUpdate = update.user_id === currentUserIdInt;
                const quando = new Date(update.update_timestamp);
                const nuova = !isMyOwnUpdate && (!lastViewedDate || quando > lastViewedDate);
                bottomPanelUpdatesList.appendChild(creaVoceLog(update, isMyOwnUpdate, nuova));
            });

            // Aprirla vuol dire averla letta fin qui (anche per il server).
            const ultimaVoce = updates[updates.length - 1]?.update_timestamp;
            if (ultimaVoce) saveReadStatusToStorage(reportId, ultimaVoce);

            // Con delle novità si parte da lì, non dal fondo.
            setTimeout(() => {
                const separatore = bottomPanelUpdatesList.querySelector('.separatore-nuovi');
                if (separatore) separatore.scrollIntoView({ block: 'center' });
                else bottomPanelUpdatesList.scrollTop = bottomPanelUpdatesList.scrollHeight;
            }, 50);
        } else {
            bottomPanelUpdatesList.innerHTML = '<li class="chat-bubble chat-system placeholder-log">Nessun aggiornamento. Inizia la conversazione.</li>';
            setTimeout(() => { bottomPanelUpdatesList.scrollTop = bottomPanelUpdatesList.scrollHeight; }, 50);
        }

        if (bottomPanelNewUpdateText) {
            bottomPanelNewUpdateText.value = '';
            const myUsername = localStorage.getItem('username') || 'Te';
            bottomPanelNewUpdateText.placeholder = `Scrivi nota come ${myUsername} e premi Invio...`;
        }
        
        bottomPanel.style.display = 'flex';

        toggleReportActions(!!activeEmergency && report.emergency_id === activeEmergency.id);

    } catch (error) {
        console.error(`Errore nel caricare i dettagli per report ${reportId}:`, error);
        bottomPanelMainContent.innerHTML = `<p style="color: red;">Impossibile caricare i dettagli: ${escapeHTML(error.message)}</p>`;
        bottomPanelUpdatesList.innerHTML = '<li>Errore caricamento aggiornamenti.</li>';
        toggleReportActions(false);
    }
}

function initiateCoordinateUpdateFromPanel(reportId) {
    if (isUpdatingCoordsFromPanel) { 
        cancelCoordinateUpdateFromPanel();
        return;
    }

    if (!map || !activeEmergency) {
        showTemporaryFeedback("Impossibile attivare la selezione sulla mappa. Emergenza non attiva.", "error");
        return;
    }
    
    reportIdForCoordUpdate = reportId;
    isUpdatingCoordsFromPanel = true; 

    const coordButton = document.getElementById('details-panel-update-coords-btn');
    if (coordButton) {
        coordButton.innerHTML = '<i class="fas fa-times" style="color: var(--danger-text);"></i>'; 
        coordButton.title = 'Annulla Selezione Coordinate';
    }

    map.on('click', handleMapClickForPanelCoordUpdate); 
    sceltaPunto(true);
    
    toggleActionButtonsAvailability(false, 'details-panel-update-coords-btn');
}

// Mentre si sceglie il punto di una segnalazione sulla mappa, le zone e le
// strade disegnate non prendono il clic: un punto dentro un'area apriva il
// riquadro dell'area invece di essere scelto.
function sceltaPunto(si) {
    if (!map) return;
    map.getContainer().style.cursor = si ? 'crosshair' : '';
    map.getContainer().classList.toggle('lm-disegnando', si);
    if (si) map.closePopup();
}

function cancelCoordinateUpdateFromPanel() {
    if (!isUpdatingCoordsFromPanel) return; 

    isUpdatingCoordsFromPanel = false;
    map.off('click', handleMapClickForPanelCoordUpdate); 
    sceltaPunto(false);
    
    const coordButton = document.getElementById('details-panel-update-coords-btn');
    if (coordButton) { 
        coordButton.innerHTML = '<i class="fas fa-map-marker-alt"></i>';
        coordButton.title = 'Modifica Coordinate Mappa';
    }
    
    reportIdForCoordUpdate = null; 
    toggleActionButtonsAvailability(true);
}

async function handleMapClickForPanelCoordUpdate(e) { 
    if (!reportIdForCoordUpdate || !isUpdatingCoordsFromPanel) {
        cancelCoordinateUpdateFromPanel();
        return;
    }
    const { lat, lng } = e.latlng;
    const reportObject = currentReports.find(r => r.id === reportIdForCoordUpdate);
    const reportIdentifier = reportObject?.emergency_report_number || reportIdForCoordUpdate;

    // Il clic sulla mappa è già la scelta: niente conferma, e un punto
    // sbagliato si sposta di nuovo allo stesso modo.
    map.off('click', handleMapClickForPanelCoordUpdate);
    sceltaPunto(false);
    if (await submitCoordinatesFromPanel(reportIdForCoordUpdate, lat, lng)) {
        notifica(`Segnalazione #${reportIdentifier} spostata.`, 'successo');
    }
    // La modalità la chiude cancelCoordinateUpdateFromPanel.
    cancelCoordinateUpdateFromPanel(); 
}

async function submitCoordinatesFromPanel(reportId, latitude, longitude) { 
    console.log(`[PanelCoordUpdate] Invio nuove coordinate per report ${reportId}: Lat ${latitude}, Lon ${longitude}`);
    const updateCoordsBtn = document.getElementById('details-panel-update-coords-btn'); 
    if (updateCoordsBtn) {
        updateCoordsBtn.innerHTML = '<i class="fas fa-spinner la-spin"></i>';
        updateCoordsBtn.disabled = true;
    }

    try {
        await fetchApi(`/api/reports/${reportId}/coordinates`, {
            method: 'PUT',
            body: JSON.stringify({ latitude, longitude })
        });
        return true;
    } catch (error) {
        console.error(`[PanelCoordUpdate] Errore API aggiornamento coordinate per report ${reportId}:`, error);
        showTemporaryFeedback(`Errore aggiornamento coordinate: ${error.message}`, "error");
        return false;
    } finally {

        if (updateCoordsBtn && updateCoordsBtn.disabled) {
             updateCoordsBtn.disabled = false;
             // Lo stato dell'icona/testo verrà gestito da cancelCoordinateUpdateFromPanel
        }

    }
}

function toggleActionButtonsAvailability(enable, excludeButtonId = null) {
    const actionBarIcons = document.getElementById('action-bar-icons');
    if (actionBarIcons) {
        const buttons = actionBarIcons.querySelectorAll('button, a');
        buttons.forEach(button => {
            if (button.id !== excludeButtonId) { 
                button.disabled = !enable;
                button.style.opacity = enable ? '1' : '0.5';
                button.style.pointerEvents = enable ? 'auto' : 'none';
            }
        });
    }
}

async function handleSaveStatus(report, newStatus, feedbackElement, buttonElement, originalStatus) {
    const reportId = report.id;
    console.log(`Salvo stato '${newStatus}' per report ${reportId}`);
    if (!reportId || !newStatus || !feedbackElement || !buttonElement) return;

    feedbackElement.textContent = 'Salvataggio...';
    feedbackElement.style.color = '';
    buttonElement.disabled = true;

    const isClosingReport = TERMINAL_REPORT_STATUSES.includes(newStatus);
    const isReopeningReport = TERMINAL_REPORT_STATUSES.includes(originalStatus) && ACTIVE_REPORT_STATUSES.includes(newStatus);

    try {
        // Lo stato che avevo davanti: se arriva tardi e intanto è cambiato, il server non scrive.
        const updatedReportData = await fetchApi(`/api/reports/${reportId}`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus, stato_atteso: originalStatus }),
            coda: `Segnalazione n. ${reportId}: stato "${newStatus}"`
        });
        if (restaInCoda(updatedReportData, 'Il cambio di stato')) {
            feedbackElement.textContent = 'In coda: parte quando torna il server.';
            feedbackElement.style.color = '';
            return;
        }

        console.log(`Stato report ${reportId} aggiornato a ${newStatus} nel backend.`);
        feedbackElement.textContent = 'Stato salvato!';
        feedbackElement.style.color = 'green';

        if (reportMarkerReferences[reportId]) {
            const reportToUpdate = currentReports.find(r => r.id === reportId);
            if (reportToUpdate) {
                reportToUpdate.status = newStatus;
                const selectedIcon = createReportDivIcon(reportToUpdate);
                reportMarkerReferences[reportId].setIcon(selectedIcon);
            }
        } else { 
            console.warn(`Marker mappa per report ${reportId} non trovato.`); 
        }

        if (isClosingReport && !showOnlyClosedReports) {
            console.log(`Report ${reportId} (${newStatus}) chiuso/risolto e vista attiva. Rimuovo riga da UI.`);
            const reportRow = reportListBody?.querySelector(`.inbox-card[data-report-id="${reportId}"]`);
            if (reportRow) { reportRow.remove(); console.log(` - Riga tabella rimossa.`); }
            else { console.warn(` - Riga tabella per report ${reportId} non trovata.`); }
            if (currentlyDisplayedReportId === parseInt(reportId, 10)) {
                 console.log(" - Chiudo pannello dettagli perché il report è stato chiuso/risolto.");
                 closeBottomPanel();
            }
        }
        else if (currentlyDisplayedReportId === parseInt(reportId, 10)) {
             console.log(" - Ricarico dettagli pannello.");
             showReportDetails(parseInt(reportId, 10));
        }

        // Chiudendo o riaprendo, le squadre di questa segnalazione tornano libere;
        // il server lo conferma con reload_squadre.
        if (isClosingReport || isReopeningReport) {
             console.log(`Aggiornamento stato locale squadre per report ${reportId} (nuovo stato: ${newStatus})`);
             const teamIdsAffected = (report.assigned_teams || []).map(t => t.id);

             teamIdsAffected.forEach(teamId => {
                 const teamIndex = allTeamsList.findIndex(t => t.id === teamId);
                 if (teamIndex > -1) {

                     allTeamsList[teamIndex].active_target_info = null;
                     console.log(`  -> Stato locale team ${teamId} aggiornato: active_target_info = null (report ${isClosingReport ? 'chiuso' : 'riaperto'})`);
                 } else {
                     console.warn(`  -> Team ${teamId} (precedentemente assegnato a report ${reportId}) non trovato in allTeamsList.`);
                 }
             });
             updateTeamStatusPanel();
        }

        setTimeout(() => { feedbackElement.textContent = ''; feedbackElement.style.color = ''; }, 3000);

    } catch (error) {
        console.error(`Errore salvataggio stato report ${reportId}:`, error);
        feedbackElement.textContent = `Errore: ${error.message}`;
        feedbackElement.style.color = 'red';
        const statusSelect = document.getElementById('detail-status-select');
        if(statusSelect && typeof originalStatus !== 'undefined') statusSelect.value = originalStatus;
    } finally {
        buttonElement.disabled = false;
    }
}

function openCreateModal() {
    if (!createReportModal || !createReportForm) return;
    createReportForm.reset();
    mapSelectionFeedback.textContent = '';
    deactivateMapSelectionMode();
    createReportModal.style.display = 'flex';
    console.log("Modale creazione aperto.");
}

function closeCreateModal() {
    if (!createReportModal) return;
    if (isSelectingOnMap) { deactivateMapSelectionMode(); }
    createReportModal.style.display = 'none';
    if (tempSelectionMarker) {
        map.removeLayer(tempSelectionMarker);
        tempSelectionMarker = null;
    }
}

function toggleMapSelectionMode() {
     if (!map) return;
     isSelectingOnMap = !isSelectingOnMap;
     if (isSelectingOnMap) { activateMapSelectionMode(); }
     else { deactivateMapSelectionMode(); }
}

function activateMapSelectionMode(){
    if (!createReportModal || !map) return;
    isSelectingOnMap = true;
    createReportModal.style.display = 'none';
    map.on('click', onMapClickSelectCoord);
    sceltaPunto(true);
    mapSelectionFeedback.textContent = 'Clicca sulla mappa per scegliere le coordinate...';
    if(createSelectOnMapBtn) createSelectOnMapBtn.textContent = 'Annulla Selezione';
    console.log("Modalità selezione su mappa ATTIVATA, modale nascosto.");
}

function deactivateMapSelectionMode() {
    if (!map) return;
    isSelectingOnMap = false;
    map.off('click', onMapClickSelectCoord);
    sceltaPunto(false);
    if(createSelectOnMapBtn) createSelectOnMapBtn.textContent = 'Mappa';
    console.log("Modalità selezione su mappa DISATTIVATA");
}

function onMapClickSelectCoord(e) {
    if (!createLatitudeInput || !createLongitudeInput || !createReportModal) return;
    const { lat, lng } = e.latlng;
    createLatitudeInput.value = lat.toFixed(6);
    createLongitudeInput.value = lng.toFixed(6);
    mapSelectionFeedback.textContent = `Coordinate selezionate: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (tempSelectionMarker) {
        tempSelectionMarker.setLatLng(e.latlng);
    } else {
        tempSelectionMarker = L.marker(e.latlng, { icon: defaultReportIcon }).addTo(map);
    }
    createReportModal.style.display = 'flex';
    deactivateMapSelectionMode();
    console.log("Coordinate selezionate su mappa, modale ri-mostrato (nessun marker aggiunto).");
}

async function handleCreateReportSubmit(event) {
    event.preventDefault();
    const title = document.getElementById('create-title').value.trim();
    const latitudeStr = document.getElementById('create-latitude').value;
    const longitudeStr = document.getElementById('create-longitude').value;
    const reporterName = document.getElementById('create-reporter-name').value.trim();
    const reporterContact = document.getElementById('create-reporter-contact').value.trim();

    if (!title) { notifica('Scrivi almeno cosa succede (il titolo).', 'attenzione'); return; }

    // Prova a convertirle in numeri, saranno null se non valide/vuote
    const latNum = latitudeStr ? parseFloat(latitudeStr) : null;
    const lonNum = longitudeStr ? parseFloat(longitudeStr) : null;
    
    let finalLat = null;
    let finalLon = null;
    if (latNum !== null && lonNum !== null && !isNaN(latNum) && !isNaN(lonNum)) {
         finalLat = latNum;
         finalLon = lonNum;
    } else if (latNum !== null || lonNum !== null) {

         notifica('Inserire entrambe le coordinate (Latitudine e Longitudine) o nessuna delle due. Assicurarsi siano numeri validi.', 'attenzione');
         return;
    }

    const reportData = {
        title,
        description: document.getElementById('create-description').value.trim() || null,
        priority: document.getElementById('create-priority').value,
        location_address: document.getElementById('create-location').value.trim() || null,
        latitude: finalLat,
        longitude: finalLon,
        reporter_name: reporterName,
        reporter_contact: reporterContact
    };
    const submitButton = event.target.querySelector('button[type="submit"]');
    try {
        if(submitButton) submitButton.disabled = true; submitButton.textContent = 'Creazione...';
        const newReport = await fetchApi('/api/reports', {
            method: 'POST', body: JSON.stringify(reportData), coda: `Nuova segnalazione "${reportData.title}"`
        });
        restaInCoda(newReport, 'La segnalazione');
        console.log('Segnalazione creata:', newReport);
        closeCreateModal();
    } catch (error) {
        console.error("Errore creazione segnalazione:", error);
        showTemporaryFeedback(`Errore creazione: ${error.message}`);
    } finally {
         if(submitButton) submitButton.disabled = false; submitButton.textContent = 'Crea segnalazione';
    }
}

async function openEditModal(reportId) {
    if (!editReportModal || !editReportForm || !reportId) { console.error("Elementi modale modifica o ID report mancanti."); return; }
    console.log(`Apertura modale modifica per report ${reportId}`);

    try {
        editReportForm.reset();
        if(editReportIdSpan) editReportIdSpan.textContent = `${reportId} (Caricamento...)`;
        editReportModal.style.display = 'flex';

        const data = await fetchApi(`/api/reports/${reportId}`);
        const report = data?.report;
        if (!report) throw new Error(`Dati report ${reportId} non trovati.`);

        const displayValue = report.emergency_report_number ?? report.id;
        if(editReportIdSpan) editReportIdSpan.textContent = displayValue;
        document.getElementById('edit-reportId-hidden').value = report.id;
        document.getElementById('edit-title').value = report.title || '';
        document.getElementById('edit-description').value = report.description || '';
        document.getElementById('edit-priority').value = report.priority || 'Medium';
        const editStatusSelect = document.getElementById('edit-status');
        if (editStatusSelect) {
            editStatusSelect.innerHTML = `
                <option value="New">New</option>
                <option value="Open">Open</option>
                <option value="InProgress">In Progress</option>
                <option value="Closed">Closed</option>
            `;
            editStatusSelect.value = report.status || 'New';
            editStatusSelect.dataset.statoAtteso = report.status || '';
        }
        // Fine aggiornamento select
        document.getElementById('edit-location').value = report.location_address || '';
        document.getElementById('edit-reporter-name').value = report.reporter_name || '';
        document.getElementById('edit-reporter-contact').value = report.reporter_contact || '';
        document.getElementById('edit-environmental-hazard').value = report.environmental_hazard || '';
        if(editLatitudeInput) editLatitudeInput.value = report.latitude ?? '';
        if(editLongitudeInput) editLongitudeInput.value = report.longitude ?? '';
        if(editMapSelectionFeedback) editMapSelectionFeedback.textContent = '';
        deactivateMapSelectionModeEdit();

    } catch (error) {
        console.error(`Errore apertura modale modifica report ${reportId}:`, error);
      //  // showTemporaryFeedback(`Impossibile caricare dati: ${error.message}`, 'error');
        closeEditModal();
    }
}

// NUOVE Funzioni per Selezione Mappa nel MODALE MODIFICA
function toggleMapSelectionModeEdit() {
     if (!map) return;
     isSelectingOnMap = !isSelectingOnMap;
     if (isSelectingOnMap) { activateMapSelectionModeEdit(); }
     else { deactivateMapSelectionModeEdit(); }
}

function activateMapSelectionModeEdit(){
    if (!editReportModal || !map) return;
    isSelectingOnMap = true;
    editReportModal.style.display = 'none';
    map.on('click', onMapClickSelectCoordEdit);
    sceltaPunto(true);
    if(editMapSelectionFeedback) editMapSelectionFeedback.textContent = 'Clicca sulla mappa per scegliere le coordinate...';
    if(editSelectOnMapBtn) editSelectOnMapBtn.textContent = 'Annulla Selezione';
    console.log("Modalità selezione su mappa ATTIVATA (Edit), modale nascosto.");
}

function deactivateMapSelectionModeEdit() {
    if (!map) return;
    isSelectingOnMap = false;
    map.off('click', onMapClickSelectCoordEdit); 
    sceltaPunto(false);
    if(editSelectOnMapBtn) editSelectOnMapBtn.textContent = 'Seleziona su Mappa';
    console.log("Modalità selezione su mappa DISATTIVATA (Edit)");
}

function onMapClickSelectCoordEdit(e) { 
    if (!editLatitudeInput || !editLongitudeInput || !editReportModal) return;
    const { lat, lng } = e.latlng;
    editLatitudeInput.value = lat.toFixed(6);
    editLongitudeInput.value = lng.toFixed(6); 
    if(editMapSelectionFeedback) editMapSelectionFeedback.textContent = `Coordinate selezionate: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    if (tempSelectionMarker) {
        tempSelectionMarker.setLatLng(e.latlng);
    } else {
        tempSelectionMarker = L.marker(e.latlng, { icon: defaultReportIcon }).addTo(map);
    }

    editReportModal.style.display = 'flex';
    deactivateMapSelectionModeEdit();
    console.log("Coordinate selezionate su mappa (Edit), modale ri-mostrato.");
}

function closeEditModal() {
    if (!editReportModal) return;
    if (isSelectingOnMap) { 
       deactivateMapSelectionModeEdit();
    }
    editReportModal.style.display = 'none';
    if (tempSelectionMarker) {
        map.removeLayer(tempSelectionMarker);
        tempSelectionMarker = null;
    }
}

async function handleEditReportSubmit(event) {
    event.preventDefault();
    if (!editReportForm) return;
    const reportId = document.getElementById('edit-reportId-hidden').value;
    if (!reportId) { notifica("Errore: ID report mancante.", 'errore'); return; }
    const reporterName = document.getElementById('edit-reporter-name').value.trim();
    const reporterContact = document.getElementById('edit-reporter-contact').value.trim();
    const latitudeStr = editLatitudeInput.value.trim();
    const longitudeStr = editLongitudeInput.value.trim();
    let finalLat = null;
    let finalLon = null;

    // Valida coordinate: o entrambe valide, o entrambe nulle/vuote
    if (latitudeStr !== '' || longitudeStr !== '') {
         const parsedLat = parseFloat(latitudeStr);
         const parsedLon = parseFloat(longitudeStr);
         if (!isNaN(parsedLat) && !isNaN(parsedLon)) {
              finalLat = parsedLat;
              finalLon = parsedLon;
         } else {
              notifica('Se inserite, entrambe le coordinate devono essere numeri validi.', 'attenzione');
              return;
         }
    }

    // Raccogli gli altri dati aggiornati
    const updatedData = {
        title: document.getElementById('edit-title').value.trim(),
        description: document.getElementById('edit-description').value.trim(),
        priority: document.getElementById('edit-priority').value,
        status: document.getElementById('edit-status').value,
        stato_atteso: document.getElementById('edit-status').dataset.statoAtteso || undefined,
        location_address: document.getElementById('edit-location').value.trim(),
        reporter_name: reporterName,
        reporter_contact: reporterContact,
        environmental_hazard: document.getElementById('edit-environmental-hazard').value.trim() || null,
        latitude: finalLat,
        longitude: finalLon
    };

    if (!updatedData.title) { notifica('Il titolo è obbligatorio.', 'attenzione'); return; }

    const submitButton = editReportForm.querySelector('button[type="submit"]');
    console.log(`Salvataggio modifiche (incluse coordinate?) per report ${reportId}:`, updatedData);

    try {
        if(submitButton) submitButton.disabled = true; submitButton.textContent = 'Salvataggio...';
        const savedReport = await fetchApi(`/api/reports/${reportId}`, {
            method: 'PUT', body: JSON.stringify(updatedData), coda: `Segnalazione n. ${reportId}: modifiche alla scheda`
        });
        console.log('Report aggiornato:', savedReport);
        closeEditModal();
        if (restaInCoda(savedReport, 'La modifica')) return;
        if (currentlyDisplayedReportId === parseInt(reportId, 10)) {
            showReportDetails(parseInt(reportId, 10));
        }
        // Il reload via WS ('reload_reports' e 'reload_poi') aggiornerà la lista e la mappa per tutti
    } catch (error) {
        console.error(`Errore aggiornamento report ${reportId}:`, error);
        showTemporaryFeedback(`Errore salvataggio: ${error.message}`);
    } finally {
        if(submitButton) submitButton.disabled = false; submitButton.textContent = 'Salva';
    }
}

async function loadAllTeams() {

    try {
        console.log("Caricamento lista globale squadre...");
        const teams = await fetchApi('/api/squadre');
        allTeamsList = teams || [];
        console.log(`Caricate ${allTeamsList.length} squadre.`);
    } catch (error) {
        console.error("Errore caricamento lista globale squadre:", error);
        allTeamsList = [];
    }
}

// Apre il modale per assegnare/rimuovere squadre

// Apre il modale per assegnare/rimuovere squadre
async function openAssignTeamModal(report) {
    const modal = assignTeamModal;
    const assignedListUl = assignedTeamsListUl;
    const availableListUl = availableTeamsListUl;
    const reportIdSpan = assignModalReportIdSpan;
    const reportTitleSpan = assignModalReportTitleSpan;
    const searchInput = assignTeamSearchInput;

    if (!modal || !report || !assignedListUl || !availableListUl || !reportIdSpan || !reportTitleSpan || !searchInput) {
        console.error("Elementi modale assegnazione o dati report mancanti.");
        return;
    }
    console.log(`Apertura modale assegnazione per report ${report.id}. Dati report:`, JSON.parse(JSON.stringify(report)));
    currentReportForAssignment = report;

    const displayValue = report.emergency_report_number ?? report.id;
    reportIdSpan.textContent = displayValue;
    // assignModalReportIdSpan.textContent = displayValue; // Duplicato? Rimuovere se non serve
    reportTitleSpan.textContent = report.title;

    searchInput.value = '';
    assignedListUl.innerHTML = '';
    availableListUl.innerHTML = '<li>Caricamento disponibili...</li>';

    // "Richiede una squadra?": si imposta qui, cioè nel punto in cui si sta già
    // ragionando di squadre per questa segnalazione.
    const selettoreMotivo = document.getElementById('no-team-reason-select');
    if (selettoreMotivo) {
        selettoreMotivo.value = report.no_team_reason || '';
        selettoreMotivo.disabled = false;
    }


    const assignedTeamEntries = report.assigned_teams || [];
    console.log(`[openAssignTeamModal] Squadre da visualizzare come assegnate (da report.assigned_teams):`, JSON.parse(JSON.stringify(assignedTeamEntries)));
    populateTeamAssignmentList(assignedListUl, assignedTeamEntries, 'remove');

    modal.style.display = 'flex';

    try {
        console.log("Chiamata API per squadre disponibili (/api/squadre/disponibili)...");
        const availableTeamsFullData = await fetchApi(`/api/squadre/disponibili`);
        currentAvailableTeamsAssign = availableTeamsFullData || [];
        console.log(`[openAssignTeamModal] Squadre disponibili ricevute da API: ${currentAvailableTeamsAssign.length}`);

        // Filtra ulteriormente currentAvailableTeamsAssign per non mostrare quelle già in assignedTeamEntries
        const assignedTeamIds = new Set(assignedTeamEntries.map(t => t.id));
        const trulyAvailableTeams = currentAvailableTeamsAssign.filter(team => !assignedTeamIds.has(team.id));

        populateTeamAssignmentList(availableListUl, trulyAvailableTeams, 'add');
        console.log("Lista squadre disponibili popolata.");

    } catch (error) {
        console.error("Errore caricamento squadre disponibili:", error);
        availableListUl.innerHTML = '<li>Errore caricamento squadre disponibili.</li>';
        currentAvailableTeamsAssign = [];
    }
}

function populateAvailableTeamsList(assignedTeamIds = [], searchTerm = '') {
     if (!availableTeamsListUl) return;
     availableTeamsListUl.innerHTML = '';
     const lowerSearchTerm = searchTerm.toLowerCase();

     const availableTeams = allTeamsList.filter(team =>
         // Non è tra quelle già assegnate a questo report
         !assignedTeamIds.includes(team.id) &&
         // Corrisponde al termine di ricerca (se presente)
         (team.nome.toLowerCase().includes(lowerSearchTerm))
     );

     if (availableTeams.length === 0) {
         availableTeamsListUl.innerHTML = '<li>Nessuna squadra disponibile trovata.</li>';
         return;
     }

     availableTeams.forEach(team => {
         const li = document.createElement('li');
         li.innerHTML = `
             <span>${escapeHTML(team.nome)} (ID: ${escapeHTML(team.id)})</span>
             <button class="assign-team-btn" data-team-id="${escapeHTML(team.id)}">Assegna</button>
         `;
         li.querySelector('.assign-team-btn').addEventListener('click', (e) => {
             const teamIdToAdd = parseInt(e.currentTarget.dataset.teamId, 10);
             handleAddOrRemoveTeamAssignment(currentReportForAssignment.id, teamIdToAdd, 'add', e.currentTarget);
         });
         availableTeamsListUl.appendChild(li);
     });
}

// Chiude il modale di assegnazione squadre
function closeAssignTeamModal() {
    if (!assignTeamModal) return;
    assignTeamModal.style.display = 'none';
    currentReportForAssignment = null;
    console.log("Modale assegnazione chiuso.");
    if (currentlyDisplayedReportId) {
         showReportDetails(currentlyDisplayedReportId);
    }
}

async function updateTeamStatusPanel() {
    if (!teamStatusContentDiv) {
        console.error("Elemento #team-status-content non trovato!");
        return;
    }
    console.log("[updateTeamStatusPanel] Aggiornamento pannello UI...");
    teamStatusContentDiv.innerHTML = '';

    if (!allTeamsList || !allTeamsList.length) {
        teamStatusContentDiv.innerHTML = '<span>Nessuna squadra configurata.</span>';
        console.log("[updateTeamStatusPanel] Nessuna squadra in allTeamsList.");
        return;
    }

    const now = Date.now();
    const currentTeamIdsOnPanel = new Set();
    
    allTeamsList.forEach((team) => {
        try {
            if (!team || team.id == null) {
                console.warn("[updateTeamStatusPanel] Saltato oggetto squadra non valido:", team);
                return;
            }
            const teamId = team.id;
            currentTeamIdsOnPanel.add(teamId);

            // Cerca se esiste già uno span per questa squadra
            let teamSpan = teamStatusContentDiv.querySelector(`.team-status-item[data-team-id="${teamId}"]`);

            const lastUpdate = teamLastUpdateTimestamps.get(teamId);
            let isStale = true;
            if (lastUpdate) {
                 try {
                     const lastUpdateTs = new Date(lastUpdate).getTime();
                     if (!isNaN(lastUpdateTs)) isStale = (now - lastUpdateTs > STALE_TIMESTAMP_THRESHOLD);
                 } catch(e) { /* ignora */ }
            }

            let statusText = '';
            let statusClass = 'team-available';
            const targetInfo = team.active_target_info;
            const prefix = team.nome_radio || 'N/D';
            const optionalName = team.nome && !team.coc ? ` (${team.nome})` : '';

            if (team.coc) {
                // La sala: chi c'è, non dove è.
                statusClass = 'team-coc';
                statusText = `(${team.membri?.length || 0} in sala)`;
                isStale = false;
            } else if (!targetInfo) {
                statusText = '(Libera)';
            } else {
                statusClass = 'team-assigned';
                // MODIFICA: Usa target_report_progressive_number da targetInfo
                const progressiveNumber = targetInfo.target_report_progressive_number;
                const reportTitle = targetInfo.target_report_title;

                if (progressiveNumber !== null && progressiveNumber !== undefined) {
                    statusText = `(Assegnata &rarr; #${progressiveNumber})`;
                } else {
                    // Fallback all'ID globale se il numero progressivo non è disponibile
                    statusText = `(Assegnata &rarr; ID: ${targetInfo.report_id})`;
                    console.warn(`[updateTeamStatusPanel] Num. progressivo per report ${targetInfo.report_id} non trovato in active_target_info. Mostro ID.`);
                }
            }

            const newInnerHTML = `<strong>${escapeHTML(prefix)}</strong>${escapeHTML(optionalName)} <span class="team-current-status">${statusText}</span>`;
            const capo = team.caposquadra ? `\nCaposquadra: ${nomePersona(team.caposquadra)}${team.caposquadra.telefono ? ' · ' + team.caposquadra.telefono : ''}` : '';
            const newTitle = `Squadra: ${prefix}${optionalName}\nID: ${team.id}\nStato: ${statusText.replace('&rarr;', '→')}\nMembri: ${team.membri?.length || 0}${capo}`;
            const newClassName = `team-status-item ${statusClass}${isStale ? ' team-marker-stale' : ''}`;

            if (teamSpan) {
                if (teamSpan.innerHTML !== newInnerHTML) teamSpan.innerHTML = newInnerHTML;
                if (teamSpan.title !== newTitle) teamSpan.title = newTitle;
                if (teamSpan.className !== newClassName) teamSpan.className = newClassName;
            } else {
                console.log(`[updateTeamStatusPanel] Creo nuovo span per team ${teamId}`);
                teamSpan = document.createElement('span');
                teamSpan.dataset.teamId = teamId;
                teamSpan.className = newClassName;
                teamSpan.innerHTML = newInnerHTML;
                teamSpan.title = newTitle;
                teamStatusContentDiv.appendChild(teamSpan);
            }

        } catch (loopError) {
            console.error(`[updateTeamStatusPanel] Errore durante elaborazione team ${team?.id} nel loop:`, loopError);
        }
    });
    const spansToRemove = [];
    teamStatusContentDiv.querySelectorAll('.team-status-item').forEach(span => {
        const spanTeamId = parseInt(span.dataset.teamId, 10);
        if (!currentTeamIdsOnPanel.has(spanTeamId)) {
            spansToRemove.push(span);
        }
    });
    spansToRemove.forEach(span => {
        console.log(`[updateTeamStatusPanel] Rimuovo span obsoleto per team ID ${span.dataset.teamId}`);
        span.remove();
    });

    if (teamStatusContentDiv.children.length === 0 && allTeamsList.length > 0) {
         teamStatusContentDiv.innerHTML = '<span>Errore: nessuna squadra da visualizzare?</span>';
    } else if (allTeamsList.length === 0){
         teamStatusContentDiv.innerHTML = '<span>Nessuna squadra configurata.</span>';
    }

    console.log("[updateTeamStatusPanel] Pannello UI aggiornato.");
}

async function handleAddOrRemoveTeamAssignment(reportId, teamId, action, buttonElement) {
    if (!reportId || !teamId || !buttonElement) return;
    const isAssigning = action === 'add';
    const apiUrl = '/api/reports/' + reportId + '/teams' + (isAssigning ? '' : '/' + teamId);
    const apiMethod = isAssigning ? 'POST' : 'DELETE';
    const apiBody = isAssigning ? JSON.stringify({ teamId }) : null;

    const originalButtonText = buttonElement.textContent;
    buttonElement.disabled = true;
    buttonElement.textContent = '...';

    try {
        await fetchApi(apiUrl, { method: apiMethod, body: apiBody });

        updateLocalReportAssignment(reportId, teamId, isAssigning);
        const teamIndex = allTeamsList.findIndex(t => t.id === teamId);
        if (teamIndex > -1) {
            allTeamsList[teamIndex].active_target_info = isAssigning 
                ? { report_id: reportId, emergency_code: activeEmergency?.code || null } 
                : null;
        }

        const listItem = buttonElement.closest('li');
        if (listItem) {
            const targetList = isAssigning ? document.getElementById('assigned-teams-list') : document.getElementById('available-teams-list');
            const newAction = isAssigning ? 'remove' : 'add';
            
            const placeholder = targetList.querySelector('li:not([data-team-id])');
            if (placeholder) placeholder.remove();

            // Ricrea il bottone con il nuovo colore e la nuova azione
            const newButton = document.createElement('button');
            newButton.dataset.teamId = teamId;
            newButton.innerHTML = isAssigning ? '<i class="fas fa-minus"></i> Rimuovi' : '<i class="fas fa-plus"></i> Assegna';
            newButton.style.cssText = isAssigning 
                ? 'background: #ef4444; color: white; border: none; border-radius: 50px; padding: 6px 14px; font-size: 0.75rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(239,68,68,0.2); transition: transform 0.1s;'
                : 'background: #10b981; color: white; border: none; border-radius: 50px; padding: 6px 14px; font-size: 0.75rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(16,185,129,0.2); transition: transform 0.1s;';
            
            newButton.addEventListener('mouseover', () => newButton.style.transform = 'scale(1.05)');
            newButton.addEventListener('mouseout', () => newButton.style.transform = 'scale(1)');
            newButton.addEventListener('click', (e) => {
                e.stopPropagation();
                handleAddOrRemoveTeamAssignment(reportId, teamId, newAction, e.currentTarget);
            });

            // Scambia il vecchio bottone col nuovo e sposta l'elemento di lista
            listItem.replaceChild(newButton, buttonElement);
            targetList.appendChild(listItem);

            const sourceList = isAssigning ? document.getElementById('available-teams-list') : document.getElementById('assigned-teams-list');
            if (sourceList.children.length === 0) {
                const emptyMsg = isAssigning ? 'Nessuna squadra disponibile.' : 'Nessuna squadra assegnata.';
                sourceList.innerHTML = `<li style="text-align: center; color: var(--text-muted); font-style: italic; padding: 15px; font-size: 0.9rem; border: none; background: transparent;">${emptyMsg}</li>`;
            }
        }

        updateTeamStatusPanel();

    } catch (error) {
        console.error(`Errore durante '${action}' team ${teamId} per report ${reportId}:`, error);
        showTemporaryFeedback(`Errore ${action === 'add' ? 'assegnazione' : 'rimozione'} squadra: ${error.message}`);
        buttonElement.disabled = false;
        buttonElement.textContent = originalButtonText;
    }
}

async function handleImageUpload(reportId, fileList) {
    if (!reportId || !fileList || fileList.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) {
        formData.append('reportImages', fileList[i]);
    }

    const addImgBtnInPanel = document.getElementById('details-panel-add-images-btn');
    if (addImgBtnInPanel) {
        addImgBtnInPanel.disabled = true;
        addImgBtnInPanel.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }

    try {
        await fetchApi(`/api/reports/${reportId}/images`, {
            method: 'POST',
            body: formData
        });
        showReportDetails(reportId);
    } catch (error) {
        console.error(`Errore upload immagini per report ${reportId}:`, error);
        showTemporaryFeedback(`Errore upload: ${error.message}`);
    } finally {
        if (addImgBtnInPanel) {
            addImgBtnInPanel.disabled = false;
            addImgBtnInPanel.innerHTML = '<i class="fas fa-images"></i>';
        }
    }
}

// Il sigillo dello storico preso alla chiusura: a schermo, da copiare e
// conservare fuori da ORION. Arriva anche per email agli amministratori.
function mostraSigilloChiusura(codice, sigillo) {
    const finestra = document.createElement('dialog');
    finestra.className = 'sigillo-chiusura';
    const titolo = document.createElement('h2');
    titolo.textContent = codice ? `Emergenza ${codice} chiusa` : 'Emergenza chiusa';
    const spiega = document.createElement('p');
    spiega.textContent = "Questo è il sigillo dello storico alla chiusura: con questa riga si potrà dimostrare, anche fra anni, che diario e note dell'emergenza non sono stati cambiati. Copialo e conservalo fuori da ORION. Gli amministratori lo ricevono anche per email, se la posta è configurata, ed è stampato nel resoconto.";
    const testo = document.createElement('code');
    testo.textContent = sigillo;
    const esito = document.createElement('span');
    esito.className = 'sigillo-esito';
    esito.setAttribute('role', 'status');
    const copia = document.createElement('button');
    copia.type = 'button';
    copia.className = 'button-style';
    copia.textContent = 'Copia il sigillo';
    copia.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(sigillo);
            esito.textContent = 'Copiato.';
        } catch {
            const intervallo = document.createRange();
            intervallo.selectNodeContents(testo);
            const selezione = getSelection();
            selezione.removeAllRanges();
            selezione.addRange(intervallo);
            esito.textContent = 'Selezionato: copialo con Ctrl+C.';
        }
    });
    const chiudi = document.createElement('button');
    chiudi.type = 'button';
    chiudi.className = 'button-style button-secondary';
    chiudi.textContent = 'Chiudi';
    chiudi.addEventListener('click', () => finestra.close());
    finestra.addEventListener('close', () => finestra.remove());
    const azioni = document.createElement('div');
    azioni.className = 'sigillo-azioni';
    azioni.append(copia, chiudi, esito);
    finestra.append(titolo, spiega, testo, azioni);
    document.body.append(finestra);
    finestra.showModal();
}

// Le strade chiuse e le zone interdette ancora in vigore: alla chiusura si
// sceglie quali restano sulla mappa (spuntate di base: una strada che non è
// stata riaperta di solito è ancora chiusa). Restituisce gli id da tenere,
// [] se non ce ne sono, null se si rinuncia a chiudere.
async function chiediChiusuraEmergenza(codice) {
    let inVigore = [];
    try {
        const mappa = await fetchApi('/api/mappa/elementi');
        inVigore = (mappa?.emergenza || []).filter(m => m.emergency_id === activeEmergency?.id
            && ['strada_chiusa', 'zona_interdetta'].includes(m.tipo));
    } catch { /* senza l'elenco si chiude come sempre */ }
    return new Promise(risolvi => {
        const finestra = document.createElement('dialog');
        finestra.className = 'sigillo-chiusura chiusura-emergenza';
        const titolo = document.createElement('h2');
        titolo.textContent = `Chiudere l'emergenza ${codice}?`;
        const spiega = document.createElement('p');
        spiega.textContent = 'Le segnalazioni aperte vengono chiuse e archiviate, le squadre sciolte e gli accessi esterni chiusi.';
        finestra.append(titolo, spiega);
        const caselle = [];
        if (inVigore.length) {
            const domanda = document.createElement('p');
            domanda.textContent = 'Queste strade chiuse e zone interdette non sono state tolte. Quelle spuntate restano sulla mappa anche dopo la chiusura, finché qualcuno non le toglie; le altre finiscono con l\'emergenza.';
            const elenco = document.createElement('div');
            elenco.className = 'chiusura-elenco';
            inVigore.forEach(m => {
                const riga = document.createElement('label');
                const casella = document.createElement('input');
                casella.type = 'checkbox';
                casella.checked = true;
                casella.value = m.id;
                const nome = document.createElement('span');
                nome.textContent = `${m.tipo === 'strada_chiusa' ? 'Strada chiusa' : 'Zona interdetta'}: ${m.nome || 'senza nome'}`;
                riga.append(casella, nome);
                elenco.append(riga);
                caselle.push(casella);
            });
            finestra.append(domanda, elenco);
        }
        const azioni = document.createElement('div');
        azioni.className = 'sigillo-azioni';
        const chiudi = document.createElement('button');
        chiudi.type = 'button';
        chiudi.className = 'button-style btn-pericolo';
        chiudi.textContent = 'Chiudi l\'emergenza';
        const annulla = document.createElement('button');
        annulla.type = 'button';
        annulla.className = 'button-style button-secondary';
        annulla.textContent = 'Annulla';
        azioni.append(chiudi, annulla);
        finestra.append(azioni);
        let scelta = null;
        chiudi.addEventListener('click', () => { scelta = caselle.filter(c => c.checked).map(c => Number(c.value)); finestra.close(); });
        annulla.addEventListener('click', () => finestra.close());
        finestra.addEventListener('close', () => { finestra.remove(); risolvi(scelta); });
        document.body.append(finestra);
        finestra.showModal();
        annulla.focus();
    });
}

async function handleCloseEmergencyClick() {
    if (!activeEmergency) {
        console.warn("Nessuna emergenza attiva da chiudere.");
        return;
    }
    const tieni = await chiediChiusuraEmergenza(activeEmergency.code);
    if (tieni) {
        if (closeEmergencyBtn) {
            closeEmergencyBtn.disabled = true;
            closeEmergencyBtn.textContent = 'Chiusura...';
        }
        try {
            // Il codice prima: il WebSocket può azzerare l'emergenza attiva prima della risposta.
            const codice = activeEmergency.code;
            const esito = await fetchApi('/api/emergencies/close', { method: 'POST', body: JSON.stringify({ tieni_in_vigore: tieni }) });
            if (esito?.sigillo) mostraSigilloChiusura(codice, esito.sigillo);
        } catch (error) {
            console.error("Errore durante la chiusura dell'emergenza:", error);
            showTemporaryFeedback(`Errore chiusura emergenza: ${error.message}`);
            if (closeEmergencyBtn) {
                closeEmergencyBtn.disabled = false;
                closeEmergencyBtn.innerHTML = '<i class="las la-door-closed"></i> Chiudi emergenza';
            }
        }
    }
}

function handleToggleDocsPanel() {
    if (!reportsManagementDiv) return;

    // Alterna una classe sul contenitore principale
    const isShowingDocs = reportsManagementDiv.classList.toggle('showing-docs');
    
    if (toggleDocsPanelBtn) {
        toggleDocsPanelBtn.classList.toggle('is-active', isShowingDocs);
        // L'etichetta la scrive aggiornaBadgeSezioni, insieme al contatore.
    }
}

async function handleToggleClosedReports() {
    if (isTogglingView) {
        console.log("Toggle view bloccato: un altro caricamento è in corso.");
        return;
    }
    if (!activeEmergency) {
        console.warn("Toggle filtro ignorato: nessuna emergenza attiva.");
        return;
    }

    isTogglingView = true;
    if (toggleClosedBtn) toggleClosedBtn.disabled = true;

    try {
        showOnlyClosedReports = !showOnlyClosedReports;
        if (toggleClosedBtn) {
            toggleClosedBtn.textContent = showOnlyClosedReports ? 'Mostra attive' : 'Mostra chiuse';
        }
        await loadReports(1, 25, showOnlyClosedReports, activeEmergency?.id);
    } catch (error) {
        console.error("Errore durante il cambio di vista dei report:", error);
    } finally {
        isTogglingView = false;
        if (toggleClosedBtn) toggleClosedBtn.disabled = false;
    }
}

/*
*/

function addReportMarkers(reports) {
    console.log(`[${new Date().toISOString()}] ==> addReportMarkers CALLED with ${reports.length} reports`);
    if (!reportMarkersLayer || !map || !Array.isArray(reports)) return;

    console.log(`[addReportMarkers] Processing ${reports.length} reports...`);

    reports.forEach(report => {

        let isValidCoord = false;
        let latNum = null;
        let lonNum = null;

        if (report.latitude != null && report.longitude != null) {
            latNum = parseFloat(report.latitude);
            lonNum = parseFloat(report.longitude);
            if (!isNaN(latNum) && !isNaN(lonNum)) {
                isValidCoord = true;
            }
        }

        // AGGIUNGI MARKER SOLO SE LE COORDINATE SONO VALIDE
        if (isValidCoord) {
            
            let selectedIcon = createReportDivIcon(report);
            const reportId = report.id;
            const emergencyReportNumber = report.emergency_report_number;
            const displayValue = (emergencyReportNumber !== null && emergencyReportNumber !== undefined)
                                 ? emergencyReportNumber
                                 : reportId;
            const markerOptions = { icon: selectedIcon };
            
            const existingMarker = reportMarkerReferences[reportId];
            
            if (!existingMarker) {
                const marker = L.marker([latNum, lonNum], markerOptions);
                marker.reportId = reportId;
                marker.datiReport = report;
                marker.situazione = situazioneSegnalazione(report);
                marker.dati = { numero: displayValue, titolo: report.title || '', indirizzo: report.location_address || '' };
                marker.bindPopup(`<b>#${escapeHTML(displayValue)}: ${escapeHTML(report.title)}</b><br>Stato: ${escapeHTML(report.status)}`);
                marker.on('click', (e) => {
                    if (isUpdatingCoordsFromPanel) {
                        handleMapClickForPanelCoordUpdate(e);
                        return;
                    }
                    
                    if (isSelectingOnMap) {
                        // Capiamo da quale modale arriviamo in base a quale è nascosto
                        if (createReportModal && createReportModal.style.display === 'none') {
                             onMapClickSelectCoord(e);
                        } else if (editReportModal && editReportModal.style.display === 'none') {
                             onMapClickSelectCoordEdit(e);
                        }
                        return;
                    }
                
                    showReportDetails(reportId);
                });
                reportMarkersLayer.addLayer(marker);
                console.log(`[${new Date().toISOString()}] +++ Added NEW Marker for report ${reportId}`);
                reportMarkerReferences[reportId] = marker;
            } else {
                console.log(`[${new Date().toISOString()}] ~~~ Updated Existing Marker for report ${reportId}`);
                existingMarker.setLatLng([latNum, lonNum]);
                existingMarker.datiReport = report;
                existingMarker.situazione = situazioneSegnalazione(report);
                existingMarker.setIcon(selectedIcon);
                reportMarkersLayer.refreshClusters?.(existingMarker);
                existingMarker.dati = { numero: displayValue, titolo: report.title || '', indirizzo: report.location_address || '' };
                existingMarker.setPopupContent(`<b>#${escapeHTML(displayValue)}: ${escapeHTML(report.title)}</b><br>Stato: ${escapeHTML(report.status)}`);
            }

        } else {
            
            if (reportMarkerReferences[report.id]) {
                console.log(`[addReportMarkers] Removing obsolete marker for report ${report.id} due to invalid/missing coordinates.`);
                reportMarkersLayer.removeLayer(reportMarkerReferences[report.id]);
                delete reportMarkerReferences[report.id];
            }
        }
    });

    console.log(`[addReportMarkers] Processing complete. Current marker references: ${Object.keys(reportMarkerReferences).length}`);
}

async function loadMoreReports(showClosed, emergencyId) { 
    if (isLoadingMore || currentReportListPage >= totalReportPages) return;
    isLoadingMore = true;
    const nextPage = currentReportListPage + 1;
    console.log(`Scroll Infinito: Carico INBOX pagina ${nextPage}...`);

    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-more-row';
    loadingDiv.innerHTML = `<div style="text-align: center; padding: 15px; font-style: italic; color: var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Caricamento...</div>`;
    if (reportListBody) reportListBody.appendChild(loadingDiv);

    try {
        await loadReports(nextPage, 25, showClosed, emergencyId); 
    } catch (error) {
        console.error("Errore nel caricare pagina successiva:", error);
    } finally {
         document.getElementById('loading-more-row')?.remove();
    }
}

function getTeamDataFromLi(listItem) {
     const teamId = parseInt(listItem.dataset.teamId, 10);
     // Estrai nome, magari da uno span interno o ricostruiscilo
     const nameSpan = listItem.querySelector('span');
     const teamName = nameSpan ? nameSpan.textContent.split(' (ID:')[0] : `Squadra ${teamId}`;
     return { id: teamId, nome: teamName };
}

function updateLocalReportAssignment(reportId, teamId, isAssigning) {
    if (!currentReportForAssignment || currentReportForAssignment.id !== reportId) {
        console.warn("[updateLocalReportAssignment] currentReportForAssignment non valido o ID non corrispondente. Report:", currentReportForAssignment, "Report ID richiesto:", reportId);
        return;
    }

    if (!Array.isArray(currentReportForAssignment.assigned_teams)) {
        console.log(`[updateLocalReportAssignment] Inizializzo currentReportForAssignment.assigned_teams per report ${reportId} come array vuoto.`);
        currentReportForAssignment.assigned_teams = [];
    }

    if (isAssigning) {
        if (!currentReportForAssignment.assigned_teams.some(t => t.id === teamId)) {
            currentReportForAssignment.assigned_teams.push({ id: teamId });
            console.log(`[updateLocalReportAssignment] Aggiunto team ID ${teamId} a report ${reportId}. assigned_teams ora:`, JSON.parse(JSON.stringify(currentReportForAssignment.assigned_teams)));
        } else {
            console.log(`[updateLocalReportAssignment] Team ID ${teamId} già presente in assigned_teams per report ${reportId}.`);
        }
    } else {
        currentReportForAssignment.assigned_teams = currentReportForAssignment.assigned_teams.filter(t => t.id !== teamId);
        console.log(`[updateLocalReportAssignment] Rimosso team ID ${teamId} da report ${reportId}. assigned_teams ora:`, JSON.parse(JSON.stringify(currentReportForAssignment.assigned_teams)));
    }
}

// NUOVA Funzione per gestire l'invio del form Apri Emergenza
async function handleOpenEmergencySubmit(event) {
    event.preventDefault();
    if (!emergencyExternalCodeInput) return;

    const externalCode = emergencyExternalCodeInput.value.trim();

    if (!externalCode) {
        notifica("Inserire il codice emergenza esterno.", 'attenzione');
        return;
    }

    const submitButton = openEmergencyForm.querySelector('button[type="submit"]');
    console.log(`Tentativo di apertura emergenza con codice esterno: ${externalCode}`);

    try {
        if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Apertura..."; }

        const blocco = document.getElementById('blocco-squadre-esistenti');
        const azzeraSquadre = !!blocco && !blocco.hidden && document.getElementById('sciogli-squadre-esistenti').checked;

        // Prepara il codice esterno e la scelta sulle squadre
        // Durante una simulazione l'emergenza vera la ferma: squadre e sala restano.
        const interrompi = activeEmergency?.simulazione === true;
        const requestBody = {
            external_code: externalCode,
            azzera_squadre: interrompi ? false : azzeraSquadre,
            interrompi_simulazione: interrompi
        };

        const result = await fetchApi('/api/emergencies/open', {
             method: 'POST',
             body: JSON.stringify(requestBody)
        });
        closeEmergencyModal();
        if (result?.squadre_sciolte > 0) {
            showTemporaryFeedback(`Emergenza aperta. Sciolte ${result.squadre_sciolte} squadre preesistenti.`);
        } else if (result?.volontari_ereditati > 0) {
            const q = result.squadre_ereditate;
            const v = result.volontari_ereditati;
            showTemporaryFeedback(`Emergenza aperta con ${q} ${q === 1 ? 'squadra già formata' : 'squadre già formate'} (${v} ${v === 1 ? 'volontario' : 'volontari'}).`);
        }

        // Il resto lo aggiorna il messaggio WebSocket emergency_status_change.

    } catch (error) {
         console.error("Errore durante l'apertura dell'emergenza:", error);
         showTemporaryFeedback(`Errore apertura emergenza: ${error.message}`);
          if (submitButton) { submitButton.disabled = false; submitButton.textContent = "Apri emergenza"; }
    }
    // Non riabilitiamo il bottone nel finally perché ci pensa il catch o chiudiamo il modale
}

/**
 * Apre il modale per caricare un nuovo documento.
 */
function openUploadDocModal() {
    if (!uploadDocModal || !uploadDocForm) return;
    uploadDocForm.reset();
    uploadDocModal.style.display = 'flex';
}

/**
 * Chiude il modale di upload documenti.
 */
function closeUploadDocModal() {
    if (!uploadDocModal) return;
    uploadDocModal.style.display = 'none';
}

/**
 * Carica e visualizza i documenti per un'emergenza specifica.
 * @param {number|null} emergencyId L'ID dell'emergenza o null per pulire la lista.
 */
async function loadEmergencyDocuments(emergencyId) {
    if (!emergencyDocsListContainer) return;
    
    // Se non c'è ID, pulisce la lista e esce.
    if (!emergencyId) {
        renderEmergencyDocuments([]);
        return;
    }

    emergencyDocsListContainer.innerHTML = '<p class="placeholder-text">Caricamento documenti...</p>';
    try {
        const documents = await fetchApi(`/api/emergencies/${emergencyId}/documents`);
        renderEmergencyDocuments(documents || []);
    } catch (error) {
        console.error("Errore caricamento documenti emergenza:", error);
        emergencyDocsListContainer.innerHTML = '<p class="placeholder-text error-message">Errore nel caricamento dei documenti.</p>';
    }
}

/**
 * Disegna la lista dei documenti nel pannello.
 * @param {Array} documents Array di oggetti documento dal backend.
 */
function renderEmergencyDocuments(documents) {
    if (!emergencyDocsListContainer) return;
    emergencyDocsListContainer.innerHTML = '';

    if (!documents || documents.length === 0) {
        emergencyDocsListContainer.innerHTML = '<p class="placeholder-text">Nessun documento per questa emergenza.</p>';
        return;
    }

    const isAdmin = currentUserRole === 'admin';

    documents.forEach(doc => {
        const docElement = document.createElement('div');
        docElement.className = 'doc-list-item';
        docElement.dataset.docId = doc.id;

        const uploadedAt = new Date(doc.uploaded_at).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        
        // Il nome del file è testo, mai markup.
        docElement.innerHTML = `
            <a href="${escapeHTML(doc.file_path)}" target="_blank" class="doc-link" title="Apri ${escapeHTML(doc.original_filename)}">
                <i class="las la-file-alt doc-icon"></i>
                <div class="doc-info">
                    <span class="doc-filename">${escapeHTML(doc.original_filename)}</span>
                    <small class="doc-meta">Caricato da ${escapeHTML(doc.uploader_fullname)} il ${escapeHTML(uploadedAt)}</small>
                </div>
            </a>
            ${isAdmin ? `<button class="delete-doc-btn" title="Elimina documento">&times;</button>` : ''}
        `;

        // Aggiunge il listener per il pulsante di cancellazione solo se l'utente è admin
        if (isAdmin) {
            docElement.querySelector('.delete-doc-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                handleDeleteDocClick(doc.id, doc.original_filename);
            });
        }
        emergencyDocsListContainer.appendChild(docElement);
    });
}

/**
 * Gestisce il click sul pulsante di eliminazione di un documento.
 * @param {number} docId L'ID del documento da eliminare.
 * @param {string} filename Il nome del file per il messaggio di conferma.
 */
async function handleDeleteDocClick(docId, filename) {
    if (!confirm(`Sei sicuro di voler eliminare il documento "${filename}"? L'azione è irreversibile.`)) {
        return;
    }

    try {
        await fetchApi(`/api/documents/${docId}`, { method: 'DELETE' });
        // L'aggiornamento dell'interfaccia è gestito dal messaggio WebSocket 'deleted_emergency_document'
        showTemporaryFeedback('Documento eliminato con successo.', 'success');
    } catch (error) {
        console.error(`Errore eliminazione documento ${docId}:`, error);
        showTemporaryFeedback(`Errore: ${error.message}`, 'error');
    }
}

/**
 * Gestisce la sottomissione del form di upload.
 * @param {Event} event L'evento di submit del form.
 */
async function handleUploadDocSubmit(event) {
    event.preventDefault();
    if (!docFileInput.files || docFileInput.files.length === 0) {
        notifica('Seleziona un file da caricare.', 'attenzione');
        return;
    }

    const formData = new FormData();
    formData.append('emergencyDocument', docFileInput.files[0]);

    const submitButton = uploadDocForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Caricamento...';

    try {
        await fetchApi('/api/emergencies/documents', {
            method: 'POST',
            body: formData
        });
        // L'aggiornamento UI è gestito dal messaggio WebSocket 'new_emergency_document'
        closeUploadDocModal();
        showTemporaryFeedback('Documento caricato con successo.', 'success');
    } catch (error) {
        console.error('Errore upload documento:', error);
        showTemporaryFeedback(`Errore upload: ${error.message}`);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Carica';
    }
}

function setupWebSocketListeners() {
    // Ascolta l'evento per ricaricare la lista report
    document.addEventListener('ws:reload_reports', async (event) => {
        console.log(`[${new Date().toISOString()}] ==> WS:reload_reports received:`, event.detail);
        const messageData = event.detail || {};
        const updatedReportId = messageData.updatedReportId;
        const createdReportId = messageData.createdReportId;
        const deletedReportId = messageData.deletedReportId;
        const reportIdToProcess = updatedReportId || createdReportId;
        // La modifica l'ho fatta io: per me non è una novità.
        const mia = messageData.daUtente != null && Number(messageData.daUtente) === parseInt(getCurrentUserId(), 10);

        if (deletedReportId) {
            console.log(`WS: Removing report row and marker for deleted ID: ${deletedReportId}`);
            reportListBody?.querySelector(`.inbox-card[data-report-id="${deletedReportId}"]`)?.remove();
            blinkingReportIds.delete(deletedReportId);
            if (reportMarkerReferences[deletedReportId]) {
                reportMarkersLayer?.removeLayer(reportMarkerReferences[deletedReportId]);
                delete reportMarkerReferences[deletedReportId];
            }
            if (currentlyDisplayedReportId === deletedReportId) closeBottomPanel();
            return;
        }

        if (reportIdToProcess) {
            try {
                console.log(`WS: Fetching updated/created report data for ID: ${reportIdToProcess}`);
                const data = await fetchApi(`/api/reports/${reportIdToProcess}`);
                if (data?.report) {
                    const updatedReport = data.report;
                    console.log(`WS: Dati report ${reportIdToProcess} ricevuti. Nuovo Stato: ${updatedReport.status}`);

                    addReportMarkers([updatedReport]);

                    // Negli eventi per tutti, anche per chi l'ha aperta.
                    if (createdReportId) {
                        aggiungiEvento({
                            quando: updatedReport.created_at,
                            tipo: 'segnalazione_aperta',
                            chi: updatedReport.creator_fullname,
                            testo: updatedReport.title,
                            report_id: updatedReport.id,
                            numero: updatedReport.emergency_report_number,
                            priorita: updatedReport.priority
                        });
                    }

                    if (mia && updatedReport.updated_at) saveReadStatusToStorage(updatedReport.id, updatedReport.updated_at);
                    const rowElement = createOrUpdateReportRow(updatedReport, false);
                    const newStatus = updatedReport.status;
                    const terminalStatuses = ['Resolved', 'Closed', 'Cancelled'];
                    const shouldBeVisible = (showOnlyClosedReports && TERMINAL_REPORT_STATUSES.includes(newStatus)) || (!showOnlyClosedReports && ACTIVE_REPORT_STATUSES.includes(newStatus));

                    if (shouldBeVisible) {
                        if (rowElement) {
                             // Il posto nella coda l'ha già deciso createOrUpdateReportRow.
                             inserisciCardInOrdine(reportListBody, rowElement);
                             // Le modifiche arrivano anche come voce del diario, che
                             // decide da sé quanto pesano: qui lampeggia solo una
                             // segnalazione nuova aperta da un altro.
                             if (createdReportId && !mia) triggerReportHighlight(reportIdToProcess);

                             if (createdReportId && updatedReport.creator_user_id !== parseInt(getCurrentUserId(), 10)) {
                                 const urgente = updatedReport.priority === 'High';
                                 mostraAvviso({
                                     titolo: urgente ? 'NUOVA SEGNALAZIONE · PRIORITÀ ALTA' : 'Nuova segnalazione',
                                     testo: `#${updatedReport.emergency_report_number ?? updatedReport.id} ${updatedReport.title || ''}`,
                                     urgente,
                                     reportId: reportIdToProcess
                                 });
                                 aggiornaContatoreNonLetti(reportIdToProcess, +1);
                             }
                        }
                    } else {
                        const existingRow = reportListBody.querySelector(`.inbox-card[data-report-id="${reportIdToProcess}"]`);
                        if (existingRow) {
                             console.log(`WS: Rimuovo riga ${reportIdToProcess} dalla vista corrente (filtro: ${showOnlyClosedReports?'chiusi':'attivi'}, stato: ${newStatus}).`);
                             existingRow.remove();
                             blinkingReportIds.delete(reportIdToProcess);
                        }
                    }

                    if (currentlyDisplayedReportId === reportIdToProcess) {
                        console.log(`WS: Aggiornamento chirurgico UI per report ${currentlyDisplayedReportId}`);
                        
                        const elStatus = document.getElementById('dyn-status');
                        if (elStatus) {
                            elStatus.className = `status-${updatedReport.status?.toLowerCase().replace(/\s+/g, '-')}`;
                            elStatus.textContent = ETICHETTA_STATO[updatedReport.status] || updatedReport.status || 'N/D';
                        }

                        const elPriority = document.getElementById('dyn-priority');
                        if (elPriority) {
                            elPriority.className = `priority-${updatedReport.priority?.toLowerCase()}`;
                            elPriority.textContent = `Priorità ${ETICHETTA_PRIORITA[updatedReport.priority] || updatedReport.priority || 'N/D'}`;
                        }

                        const elTeams = document.getElementById('dyn-teams');
                        squadreSegnalazioneAperta = updatedReport.assigned_teams || [];
                        if (elTeams) elTeams.innerHTML = htmlSquadreAssegnate(updatedReport.assigned_teams);

                        const elUpdated = document.getElementById('dyn-updated');
                        if (elUpdated) {
                            elUpdated.textContent = updatedReport.updated_at ? new Date(updatedReport.updated_at).toLocaleString('it-IT') : 'N/D';
                        }

                        // Posizione e rischi: cambiano spostando la segnalazione o
                        // disegnando una zona di pericolo sopra di lei.
                        const elHazard = document.getElementById('dyn-hazard');
                        if (elHazard) {
                            elHazard.hidden = !updatedReport.environmental_hazard;
                            document.getElementById('dyn-hazard-testo').textContent = updatedReport.environmental_hazard || '';
                        }
                        const elAddress = document.getElementById('dyn-address');
                        if (elAddress) elAddress.textContent = updatedReport.location_address || 'Indirizzo N/D';
                        const elCoords = document.getElementById('dyn-coords');
                        if (elCoords) elCoords.textContent = updatedReport.latitude ? `${parseFloat(updatedReport.latitude).toFixed(5)}, ${parseFloat(updatedReport.longitude).toFixed(5)}` : 'Non presenti';

                        const statusSelect = document.getElementById('detail-status-select');
                        if (statusSelect && updatedReport.status) {
                            statusSelect.value = updatedReport.status;
                            coloraScelta(statusSelect);
                        }
                        const prioritySelect = document.getElementById('detail-priority-select');
                        if (prioritySelect && updatedReport.priority) {
                            prioritySelect.value = updatedReport.priority;
                            coloraScelta(prioritySelect);
                        }
                    }
                } else {
                    // Se non trovo più il report, rimuovo riga e marker
                    console.warn(`WS: Dati non trovati per report ID ${reportIdToProcess}. Rimuovo riga/marker.`);
                    reportListBody?.querySelector(`.inbox-card[data-report-id="${reportIdToProcess}"]`)?.remove();
                    blinkingReportIds.delete(reportIdToProcess);
                    if (reportMarkerReferences[reportIdToProcess]) {
                         reportMarkersLayer?.removeLayer(reportMarkerReferences[reportIdToProcess]);
                         delete reportMarkerReferences[reportIdToProcess];
                    }
                }
            } catch(error) {
                console.error(`WS: Errore nel gestire reload_reports per ID ${reportIdToProcess}:`, error);
            }
        } else {
            console.log(`[${new Date().toISOString()}] !!! WS:reload_reports fallback: Ricarico TABELLA pagina ${currentReportListPage || 1}`);
            loadReports(currentReportListPage || 1, 25, showOnlyClosedReports, activeEmergency?.id);
        }
    });
    
    // Ascolta l'evento per un nuovo aggiornamento specifico
    document.addEventListener('ws:new_report_update', (event) => {
    const message = event.detail; 
    console.log('[WS Event] Ricevuto: new_report_update', message);

    if (!message || !message.reportId || !message.update || !message.update.update_timestamp || !message.update.update_text) {
        console.warn("Messaggio 'new_report_update' incompleto:", message);
        return; 
    }

    const reportId = message.reportId;
    const newUpdateData = message.update;
    const isMyOwnUpdate = newUpdateData.user_id === parseInt(localStorage.getItem('userId'), 10);

    // Una nota scritta da una persona diventa l'ultima notizia della scheda.
    if (!voceDiSistema(newUpdateData)) {
        impostaUltimaNota(reportId, { testo: newUpdateData.update_text, quando: newUpdateData.update_timestamp, autore: newUpdateData.updater_fullname });
    }

    // Due pesi. Forti: una nota scritta da una persona, delle foto, la
    // priorità alzata ad ALTA: lampeggio, segnaposto che salta, avviso. Deboli:
    // le modifiche di sistema dei colleghi (stato, squadre, campi): solo il
    // numero sulla scheda. Sulla segnalazione aperta in quel momento non c'è
    // niente da segnalare: la si sta già leggendo.
    const reportRow = reportListBody?.querySelector(`.inbox-card[data-report-id="${reportId}"]`);
    const forte = !voceDiSistema(newUpdateData) || /immagin/i.test(newUpdateData.update_text || '') || !!message.priorityRaisedToHigh;
    if (!isMyOwnUpdate && currentlyDisplayedReportId === reportId) {
        saveReadStatusToStorage(reportId, newUpdateData.update_timestamp);
        if (message.priorityRaisedToHigh) suonaAvvisoUrgente();
    } else if (!isMyOwnUpdate) {
        try {
            aggiornaContatoreNonLetti(reportId, +1);
            if (forte) {
                triggerReportHighlight(reportId);
                const titoloReport = reportRow?.querySelector('.inbox-id-title')?.textContent?.trim() || `Segnalazione #${reportId}`;
                mostraAvviso(message.priorityRaisedToHigh
                    ? { titolo: 'PRIORITÀ ALZATA AD ALTA', testo: titoloReport, urgente: true, reportId }
                    : { titolo: 'Aggiornamento', testo: `${titoloReport} — ${newUpdateData.update_text || ''}`.slice(0, 110), urgente: false, reportId });
            }
        } catch(err) { console.error(`Errore aggiornamento riga ${reportId}:`, err); }
    }

    // AGGIORNAMENTO PANNELLO DETTAGLI (SE APERTO)
    aggiungiEvento({
        quando: newUpdateData.update_timestamp,
        tipo: voceDiSistema(newUpdateData) ? 'evento_sistema' : 'nota',
        chi: newUpdateData.updater_fullname,
        testo: newUpdateData.update_text,
        report_id: reportId,
        numero: reportRow?.querySelector('.inbox-id-title')?.textContent?.trim().match(/#(\d+)/)?.[1] || reportId
    });

    if (currentlyDisplayedReportId === reportId && bottomPanelUpdatesList) {
    try {

            bottomPanelUpdatesList.querySelector('.placeholder-log')?.remove();

            bottomPanelUpdatesList.appendChild(creaVoceLog(newUpdateData, isMyOwnUpdate, !isMyOwnUpdate));
            bottomPanelUpdatesList.scrollTop = bottomPanelUpdatesList.scrollHeight;

        } catch(err) { console.error("Errore aggiunta log a pannello:", err); }
    }
});
    
    document.addEventListener('ws:reload_squadre', async (event) => {
        const detail = event.detail || {};
        console.log('Evento WS ricevuto: reload_squadre', detail);
        if (reloadSquadreTimeout) {
            clearTimeout(reloadSquadreTimeout);
        }
        
        reloadSquadreTimeout = setTimeout(async () => {
            try {
                await loadAllTeams(); 
                updateTeamStatusPanel(); 
                const elTeams = document.getElementById('dyn-teams');
                if (elTeams) elTeams.innerHTML = htmlSquadreAssegnate(squadreSegnalazioneAperta);

            } catch (error) {
                console.error("Errore durante gestione ws:reload_squadre:", error);
            }
        }, 300); 
    });

    document.addEventListener('ws:emergency_status_change', async (event) => {
        console.log('Evento WS ricevuto: emergency_status_change', event.detail);
        const statusData = event.detail?.status;
        if (statusData) {
            console.log("Aggiorno UI e stato emergenza da WS...");
            updateEmergencyStatusUI(statusData);
            // MODIFICA: Ricarica marker e tabella per nuova emergenza
            await loadAllMapMarkers(activeEmergency?.id);
            loadReports(1, 25, false, activeEmergency?.id);
            if (!statusData.active && bottomPanel.style.display !== 'none') {
                console.log("Emergenza chiusa via WS, chiudo pannello dettagli.");
                closeBottomPanel();
            }
        } else {
            console.warn("Messaggio ws:emergency_status_change non contiene dati status validi.");
        }
    });

    document.addEventListener('ws:team_location_update', (event) => {
        const teamData = event.detail?.teamData;
        if (!teamData?.squadra_id || teamData.latitude == null || teamData.longitude == null ) return;
        
        const updatedTeamId = teamData.squadra_id;

        updateSingleTeamMarker(teamData);

        const panelSpan = document.getElementById('team-status-content')?.querySelector(`.team-status-item[data-team-id="${updatedTeamId}"]`);
        if (panelSpan) {
            panelSpan.classList.remove('team-marker-stale');
        }

        if (teamMembersModal.style.display === 'flex' && currentlyDisplayedTeamIdInModal === updatedTeamId) {
            const marker = teamMarkerReferences[updatedTeamId];
            let locationString = "Posizione non disponibile.";
            if (marker) {
                const latLng = marker.getLatLng();
                if (latLng) locationString = `Coordinate: ${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)}`;
            }
            const timestamp = teamLastUpdateTimestamps.get(updatedTeamId); 
            let timestampString = "Nessun orario disponibile.";
            if (timestamp) {
                const dateObject = new Date(timestamp);
                if (!isNaN(dateObject.getTime())) timestampString = `Ultimo aggiornamento: ${dateObject.toLocaleString('it-IT', {dateStyle: 'short', timeStyle: 'medium'})}`;
            }
            if(teamMembersModalLocation) teamMembersModalLocation.textContent = locationString;
            if(teamMembersModalTimestamp) teamMembersModalTimestamp.textContent = timestampString;
        }
    });

    // Logica per mostrare link admin (MODIFICATA per includere Archivio)
    try {
        // Log per debug: vediamo cosa leggiamo
        console.log("[Auth Check] Ruoli utente letti da localStorage:", ruoliUtente().join(', '));

        const isAdmin = haRuolo('admin');

        // Gestione Squadre a tutto il personale, non agli esterni.
        if (manageTeamsBtn) {
            manageTeamsBtn.style.display = haRuolo('esterno') && !isAdmin ? 'none' : 'block';
            console.log("[Auth Check] Link Gestione Squadre VISIBILE (per tutti).");
        } else {
            console.warn("Link Admin Squadre ('admin-link-squadre') non trovato");
        }

        if (adminDashboardBtn) {
            adminDashboardBtn.style.display = isAdmin ? 'block' : 'none';
            console.log(`[Auth Check] Link Gestione Utenti ${isAdmin ? 'VISIBILE' : 'NASCOSTO'}.`);
        } else {
             // Se non hai un link specifico per gestione utenti, ignora questo blocco
             console.warn("Link Admin Utenti ('admin-link-users') non trovato. Verifica l'ID nell'HTML.");
        }

    } catch (e) {
        console.error("Errore nel gestire visibilità link admin:", e);
        /*
        const adminLinkSquadre = document.getElementById('admin-link-squadre');
        const adminLinkArchive = document.getElementById('admin-link-archive');
        const adminLinkUsers = document.getElementById('admin-link-users'); // Usa lo stesso ID ipotizzato
        if(adminLinkSquadre) adminLinkSquadre.style.display = 'none';
        if(adminLinkArchive) adminLinkArchive.style.display = 'none';
        if(adminLinkUsers) adminLinkUsers.style.display = 'none';*/
    }

    const logoutButton = document.getElementById('logout-button'); 

    if (logoutButton) {
        logoutButton.addEventListener('click', async (event) => {
            event.preventDefault();

            try {
                await fetchApi('/logout', { method: 'POST' });
                
                // Pulizia
                localStorage.removeItem('userRole');
                localStorage.removeItem('userRuoli');
                localStorage.removeItem('userPermessi');
                localStorage.removeItem('username');   
                const userId = getCurrentUserId();
                if (userId) { 
                    localStorage.removeItem(`unreadLogTimestamps_${userId}`); 
                }

                // Nessun avviso: il redirect è immediato.
                window.location.href = '/'; 

            } catch (error) {
                console.error("Errore durante il logout:", error);
                // In caso di errore forziamo comunque l'uscita per sicurezza
                localStorage.clear();
                window.location.href = '/'; 
            }
        });
    }

// Aggiungi questi nuovi listener per i messaggi WebSocket
document.addEventListener('ws:new_emergency_document', (event) => {
    const { document: newDoc } = event.detail;
    console.log('[WS Event] Ricevuto: new_emergency_document', newDoc);
    if (!newDoc || !emergencyDocsListContainer) return;

    const placeholder = emergencyDocsListContainer.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    // Con il pannello documenti nascosto, il nuovo documento si conta come novità.
    if (emergencyDocsManagementDiv?.style.display !== 'flex') {
        novitaDocumenti++;
        aggiornaTitoloScheda();
        mostraAvviso({
            titolo: 'Nuovo documento',
            testo: newDoc.original_filename || 'Documento caricato',
            urgente: false
        });
    }

    aggiungiEvento({
        quando: newDoc.uploaded_at,
        tipo: 'documento',
        chi: newDoc.uploader_fullname,
        testo: newDoc.original_filename
    });

    const docElement = document.createElement('div');
    docElement.className = 'doc-list-item new-item-flash';
    docElement.dataset.docId = newDoc.id;
    const uploadedAt = new Date(newDoc.uploaded_at).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const isAdmin = currentUserRole === 'admin';

    docElement.innerHTML = `
        <a href="${escapeHTML(newDoc.file_path)}" target="_blank" class="doc-link" title="Apri ${escapeHTML(newDoc.original_filename)}">
            <i class="las la-file-alt doc-icon"></i>
            <div class="doc-info">
                <span class="doc-filename">${escapeHTML(newDoc.original_filename)}</span>
                <small class="doc-meta">Caricato da ${escapeHTML(newDoc.uploader_fullname)} il ${escapeHTML(uploadedAt)}</small>
            </div>
        </a>
        ${isAdmin ? `<button class="delete-doc-btn" title="Elimina documento">&times;</button>` : ''}
    `;

    if (isAdmin) {
        docElement.querySelector('.delete-doc-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteDocClick(newDoc.id, newDoc.original_filename);
        });
    }
    
    emergencyDocsListContainer.prepend(docElement);
});

document.addEventListener('ws:deleted_emergency_document', (event) => {
    const { documentId } = event.detail;
    console.log('[WS Event] Ricevuto: deleted_emergency_document', documentId);
    if (!documentId || !emergencyDocsListContainer) return;

    const docElement = emergencyDocsListContainer.querySelector(`.doc-list-item[data-doc-id="${documentId}"]`);
    if (docElement) {
        docElement.remove();
    }

    if (emergencyDocsListContainer.children.length === 0) {
        emergencyDocsListContainer.innerHTML = '<p class="placeholder-text">Nessun documento per questa emergenza.</p>';
    }
});

    if (toggleDocsPanelBtn) {
        toggleDocsPanelBtn.addEventListener('click', () => {
            if (!emergencyDocsManagementDiv) return;
            const reportListContainer = document.getElementById('report-list-container');

            const isVisible = emergencyDocsManagementDiv.style.display === 'flex';
            
            if (!isVisible) {
                // APRI DOCUMENTI, NASCONDI LISTA
                emergencyDocsManagementDiv.style.display = 'flex';
                if (reportListContainer) reportListContainer.style.display = 'none';

                toggleDocsPanelBtn.classList.add('is-active');
                // I documenti sono ora sotto gli occhi: le loro novità sono viste.
                novitaDocumenti = 0;
                aggiornaTitoloScheda();
            } else {
                // CHIUDI DOCUMENTI, MOSTRA LISTA
                emergencyDocsManagementDiv.style.display = 'none';
                if (reportListContainer) reportListContainer.style.display = 'block';

                toggleDocsPanelBtn.classList.remove('is-active');
                aggiornaTitoloScheda();
            }
        });
    }
}

function triggerReportHighlight(reportId) {
    if (!reportListBody || reportId === null || reportId === undefined) return;
    const reportRow = reportListBody.querySelector(`.inbox-card[data-report-id="${reportId}"]`);

    if (reportRow) {
        // Evita loop di lampeggio se la riga è già aperta
        if (reportRow.classList.contains('selected-row')) return;
        if (reportRow.classList.contains('selected-row')) return;
        blinkingReportIds.add(reportId); 
        reportRow.classList.add('unread-blink');
    } else {
        blinkingReportIds.add(reportId);
    }
}

function populateTeamAssignmentList(ulElement, teamsDataArray, actionType) {
    if (!ulElement) return;
    ulElement.innerHTML = '';

    const isAdd = actionType === 'add';
    const buttonText = isAdd ? 'Assegna' : 'Rimuovi';
    const buttonIcon = isAdd ? '<i class="fas fa-plus"></i>' : '<i class="fas fa-minus"></i>';
    // Stili dinamici per i bottoni
    const buttonStyle = isAdd 
        ? 'background: #10b981; color: white; border: none; border-radius: 50px; padding: 6px 14px; font-size: 0.75rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(16,185,129,0.2); transition: transform 0.1s;'
        : 'background: #ef4444; color: white; border: none; border-radius: 50px; padding: 6px 14px; font-size: 0.75rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(239,68,68,0.2); transition: transform 0.1s;';

    if (!teamsDataArray || teamsDataArray.length === 0) {
        const li = document.createElement('li');
        li.textContent = `Nessuna squadra ${isAdd ? 'disponibile.' : 'assegnata.'}`;
        li.style.cssText = 'text-align: center; color: var(--text-muted); font-style: italic; padding: 15px; font-size: 0.9rem; background: transparent; border: none;';
        ulElement.appendChild(li);
        return;
    }

    teamsDataArray.forEach(teamEntry => {
        const teamFullData = allTeamsList.find(t => t.id === teamEntry.id);
        if (!teamFullData) return;

        const teamNameDisplay = teamFullData.nome || "Nessun nome"; 
        const teamPrefixDisplay = teamFullData.nome_radio || 'N/P'; 
        const initial = teamPrefixDisplay.charAt(0).toUpperCase();

        const li = document.createElement('li');
        li.dataset.teamId = teamFullData.id;
        li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--surface-color); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); transition: border-color 0.2s;';

        li.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: var(--text-color); font-size: 0.9rem; flex-shrink: 0;">
                    ${escapeHTML(initial)}
                </div>
                <div style="display: flex; flex-direction: column;">
                    <strong style="font-size: 0.9rem; color: var(--text-color);">${escapeHTML(teamPrefixDisplay)}</strong>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHTML(teamNameDisplay)}</span>
                </div>
            </div>
            <button data-team-id="${teamFullData.id}" style="${buttonStyle}">
                ${buttonIcon} ${buttonText}
            </button>
        `;

        const button = li.querySelector('button');
        if (button) {
            button.addEventListener('mouseover', () => button.style.transform = 'scale(1.05)');
            button.addEventListener('mouseout', () => button.style.transform = 'scale(1)');
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const reportId = currentReportForAssignment?.id;
                const teamId = parseInt(e.currentTarget.dataset.teamId, 10);
                if (reportId && teamId) {
                    handleAddOrRemoveTeamAssignment(reportId, teamId, actionType, e.currentTarget);
                }
            });
        }
        ulElement.appendChild(li);
    });
}

function showTemporaryFeedback(message, type = 'info', duration = 3000) { 
    const feedbackElement = document.getElementById('global-feedback-message'); 
    if (feedbackElement) { 
        feedbackElement.textContent = message; 
        feedbackElement.className = `feedback-message feedback-${type} show`; 
        setTimeout(() => { 
            feedbackElement.classList.remove('show');
        }, duration); 
    } else { 
        notifica(message, type === 'error' ? 'errore' : type === 'success' ? 'successo' : 'info');
    } 
}

// Il menu di una squadra dalla barra in basso: assegnarla, spostarla,
// liberarla, vedere chi c'è.
let menuSquadraAperto = null;

function puoGestireSquadre() {
    return !(ruoliUtente().includes('esterno') && !haRuolo('admin'));
}

function chiudiMenuSquadra() {
    menuSquadraAperto?.remove();
    menuSquadraAperto = null;
}

document.addEventListener('click', (e) => {
    if (menuSquadraAperto && !menuSquadraAperto.contains(e.target) && !e.target.closest('.team-status-item')) chiudiMenuSquadra();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') chiudiMenuSquadra(); });

function voceMenuSquadra(testo, azione, classe = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `voce-menu-squadra ${classe}`.trim();
    b.textContent = testo;
    b.addEventListener('click', azione);
    return b;
}

async function apriMenuSquadra(squadra, ancora) {
    const giaAperto = menuSquadraAperto?.dataset.teamId === String(squadra.id);
    chiudiMenuSquadra();
    if (giaAperto) return;

    const menu = document.createElement('div');
    menu.className = 'menu-squadra';
    menu.dataset.teamId = squadra.id;
    menu.setAttribute('role', 'menu');

    const destinazione = squadra.active_target_info;
    const titolo = document.createElement('div');
    titolo.className = 'titolo-menu-squadra';
    const nome = document.createElement('strong');
    nome.textContent = squadra.nome_radio || 'Squadra';
    const stato = document.createElement('span');
    stato.textContent = destinazione
        ? `su #${destinazione.target_report_progressive_number ?? destinazione.report_id}${destinazione.target_report_title ? ' · ' + destinazione.target_report_title : ''}`
        : 'libera';
    titolo.append(nome, stato);
    menu.appendChild(titolo);
    if (squadra.caposquadra) {
        const capo = document.createElement('div');
        capo.className = 'caposquadra-menu-squadra';
        capo.appendChild(contattoCaposquadra(squadra.caposquadra));
        menu.appendChild(capo);
    }

    // La squadra COC è la sala: non sta sulla mappa e non va sugli interventi.
    if (squadra.coc) stato.textContent = "sala operativa: chi c'è risulta presente";
    if (!squadra.coc) menu.appendChild(voceMenuSquadra(destinazione ? 'Trova sulla mappa e mostra il percorso' : 'Trova sulla mappa', () => {
        chiudiMenuSquadra();
        trovaSquadra(squadra.id);
    }));

    if (destinazione) {
        menu.appendChild(voceMenuSquadra(`Apri la segnalazione #${destinazione.target_report_progressive_number ?? destinazione.report_id}`, () => {
            chiudiMenuSquadra();
            showReportDetails(destinazione.report_id);
        }));
    }

    const gestisce = puoGestireSquadre() && !!activeEmergency && !squadra.coc;
    if (gestisce && destinazione) {
        menu.appendChild(voceMenuSquadra('Libera la squadra', () => liberaSquadra(squadra), 'pericolo'));
    }

    if (gestisce) {
        const sezione = document.createElement('div');
        sezione.className = 'sezione-menu-squadra';
        sezione.textContent = destinazione ? 'Sposta su' : 'Assegna a';
        menu.appendChild(sezione);
        const elenco = document.createElement('div');
        elenco.className = 'elenco-menu-squadra';
        elenco.innerHTML = '<span class="nota-menu-squadra">Carico le segnalazioni aperte...</span>';
        menu.appendChild(elenco);
        caricaDestinazioni(squadra, elenco);
    }

    menu.appendChild(voceMenuSquadra(puoGestireSquadre() && !squadra.caposquadra && squadra.membri?.length
        ? `Membri (${squadra.membri.length}) e caposquadra` : `Membri (${squadra.membri?.length || 0})`, () => {
        chiudiMenuSquadra();
        openTeamMembersModal(squadra);
    }));
    if (puoGestireSquadre()) {
        menu.appendChild(voceMenuSquadra('Modifica la squadra', () => {
            window.location.href = `/admin/squadre.html?squadra=${squadra.id}&da=centro`;
        }));
    }

    document.body.appendChild(menu);
    menuSquadraAperto = menu;
    // Sopra la voce cliccata, dentro lo schermo.
    const r = ancora.getBoundingClientRect();
    const larghezza = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - larghezza - 8))}px`;
    menu.style.bottom = `${window.innerHeight - r.top + 8}px`;
}

async function caricaDestinazioni(squadra, elenco) {
    try {
        const dati = await fetchApi(`/api/reports?status_type=active&limit=200&emergency_id=${activeEmergency.id}`);
        const attuale = squadra.active_target_info?.report_id;
        const segnalazioni = (dati.reports || []).filter(r => r.id !== attuale);
        elenco.innerHTML = '';
        if (!segnalazioni.length) {
            elenco.innerHTML = '<span class="nota-menu-squadra">Nessun\'altra segnalazione aperta.</span>';
            return;
        }
        // Prima le più urgenti, come nella coda a sinistra.
        const peso = { High: 0, Medium: 1, Low: 2 };
        segnalazioni.sort((a, b) => (peso[a.priority] ?? 1) - (peso[b.priority] ?? 1) || a.id - b.id);
        segnalazioni.forEach(r => {
            const voce = voceMenuSquadra(`#${r.emergency_report_number ?? r.id} ${r.title || ''}`, () => assegnaSquadra(squadra, r),
                r.priority === 'High' ? 'urgente' : '');
            const assegnate = (r.assigned_teams || []).map(t => t.nome_radio).filter(Boolean);
            if (assegnate.length) voce.title = `Già sul posto: ${assegnate.join(', ')}`;
            elenco.appendChild(voce);
        });
    } catch (e) {
        elenco.innerHTML = '';
        const errore = document.createElement('span');
        errore.className = 'nota-menu-squadra';
        errore.textContent = `Non riesco a leggere le segnalazioni: ${e.message}`;
        elenco.appendChild(errore);
    }
}

async function liberaSquadra(squadra) {
    const destinazione = squadra.active_target_info;
    if (!destinazione) return;
    chiudiMenuSquadra();
    try {
        await fetchApi(`/api/reports/${destinazione.report_id}/teams/${squadra.id}`, { method: 'DELETE' });
        showTemporaryFeedback(`${squadra.nome_radio} è libera.`, 'success');
    } catch (e) {
        showTemporaryFeedback(`Non riesco a liberare ${squadra.nome_radio}: ${e.message}`, 'error', 6000);
    }
}

// Spostare è togliere e rimettere: se la seconda chiamata fallisce, la squadra
// torna dov'era.
async function assegnaSquadra(squadra, segnalazione) {
    const da = squadra.active_target_info?.report_id;
    chiudiMenuSquadra();
    try {
        if (da) await fetchApi(`/api/reports/${da}/teams/${squadra.id}`, { method: 'DELETE' });
        try {
            await fetchApi(`/api/reports/${segnalazione.id}/teams`, { method: 'POST', body: JSON.stringify({ teamId: squadra.id }) });
        } catch (e) {
            if (da) await fetchApi(`/api/reports/${da}/teams`, { method: 'POST', body: JSON.stringify({ teamId: squadra.id }) }).catch(() => {});
            throw e;
        }
        showTemporaryFeedback(`${squadra.nome_radio} → #${segnalazione.emergency_report_number ?? segnalazione.id}`, 'success');
    } catch (e) {
        showTemporaryFeedback(`${squadra.nome_radio} non assegnata: ${e.message}`, 'error', 6000);
    }
}


function preparaScorciatoieSquadre() {
    const pannello = document.getElementById('team-status-panel');
    if (!pannello || !puoGestireSquadre() || document.getElementById('scorciatoie-squadre')) return;
    const gruppo = document.createElement('div');
    gruppo.id = 'scorciatoie-squadre';
    const nuova = document.createElement('a');
    nuova.href = '/admin/squadre.html?nuova=1&da=centro';
    nuova.className = 'scorciatoia-squadre';
    nuova.title = 'Crea una squadra';
    nuova.innerHTML = '<i class="fas fa-plus"></i> Nuova';
    const tutte = document.createElement('a');
    tutte.href = '/admin/squadre.html';
    tutte.className = 'scorciatoia-squadre';
    tutte.title = 'Tutte le squadre';
    tutte.innerHTML = '<i class="fas fa-list"></i>';
    gruppo.append(nuova, tutte);
    pannello.appendChild(gruppo);
}

async function openTeamMembersModal (teamData) { 
    if (!teamMembersModal || !teamMembersModalTitle || !teamMembersModalList || !teamMembersModalLocation || !teamMembersModalTimestamp || !teamData) {
        console.error("Elementi modale membri o dati squadra mancanti."); return;
    }
    const teamId = teamData.id;
    console.log(`Apro modale membri per squadra ${teamData.nome_radio} (ID: ${teamId})`);
    currentlyDisplayedTeamIdInModal = teamId;

    teamMembersModalTitle.textContent = `${teamData.nome_radio || 'N/D'} ${teamData.nome ? '(' + teamData.nome + ')' : ''}`;

    disegnaMembriSquadra(teamData);

    const marker = teamMarkerReferences[teamId];
    let locationString = "Posizione non disponibile.";
    if (marker) {
        const latLng = marker.getLatLng();
        if (latLng) {
            locationString = `Coordinate: ${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)}`;
        }
    }
    teamMembersModalLocation.textContent = locationString;

    let timestampString = "Caricamento orario...";
    teamMembersModalTimestamp.textContent = timestampString; 

    const timestamp = teamLastUpdateTimestamps.get(teamId); 
    console.log(`[openTeamMembersModal] Timestamp letto da teamLastUpdateTimestamps per team ${teamId}:`, timestamp, `(Tipo: ${typeof timestamp})`);

    if (timestamp && typeof timestamp === 'string') {
        try {
            const dateObject = new Date(timestamp);
            if (!isNaN(dateObject.getTime())) {
                 timestampString = `Ultimo aggiornamento: ${dateObject.toLocaleString('it-IT', {dateStyle: 'short', timeStyle: 'medium'})}`;
            } else {
                 console.warn("Timestamp non valido (parsing fallito):", timestamp);
                 timestampString = "Orario aggiornamento non valido.";
            }
        } catch (e) {
            console.error("Errore formattazione timestamp:", timestamp, e);
            timestampString = "Errore formattazione orario.";
        }
    } else {
        timestampString = "Nessun orario di aggiornamento disponibile.";
        console.log("[openTeamMembersModal] Timestamp non disponibile o non valido nella Map.");
    }
    teamMembersModalTimestamp.textContent = timestampString; 

    teamMembersModal.style.display = 'flex';
}

// I membri, con la stella del caposquadra: chi gestisce le squadre la tocca
// per nominarlo (o per toglierlo, toccando la sua). Il telefono accanto, se
// il server lo manda.
function disegnaMembriSquadra(teamData) {
    teamMembersModalList.innerHTML = '';
    const membri = teamData.membri || [];
    if (!membri.length) {
        teamMembersModalList.innerHTML = '<li>Nessun membro assegnato.</li>';
        return;
    }
    const gestisce = puoGestireSquadre();
    if (gestisce) {
        const nota = document.createElement('li');
        nota.className = 'nota-caposquadra';
        nota.textContent = teamData.caposquadra
            ? 'La stella piena è il caposquadra: la posizione della squadra la manda il suo telefono.'
            : 'Tocca la stella per nominare il caposquadra (facoltativo): la posizione della squadra la manderà il suo telefono.';
        teamMembersModalList.appendChild(nota);
    }
    membri.forEach(member => {
        const li = document.createElement('li');
        li.className = 'membro-squadra' + (member.caposquadra ? ' caposquadra' : '');
        const stella = document.createElement(gestisce ? 'button' : 'span');
        stella.className = 'stella-caposquadra';
        stella.innerHTML = `<i class="${member.caposquadra ? 'fas' : 'far'} fa-star" aria-hidden="true"></i>`;
        const chi = nomePersona(member);
        if (gestisce) {
            stella.type = 'button';
            stella.title = member.caposquadra ? `Togli ${chi} da caposquadra` : `Nomina ${chi} caposquadra`;
            stella.setAttribute('aria-label', stella.title);
            stella.setAttribute('aria-pressed', String(member.caposquadra === true));
            stella.addEventListener('click', () => nominaCaposquadra(teamData, member.caposquadra ? null : member.username, stella));
        } else if (!member.caposquadra) {
            stella.style.visibility = 'hidden';
        }
        const nome = document.createElement('span');
        nome.className = 'nome-membro';
        nome.textContent = `${chi} (${member.username || 'N/D'})`;
        li.append(stella, nome);
        // Il numero di ognuno: se il caposquadra non risponde si chiama un altro.
        const telefono = member.telefono || (member.caposquadra ? teamData.caposquadra?.telefono : null);
        if (telefono) {
            const tel = document.createElement('a');
            tel.href = `tel:${telefono.replace(/[^0-9+]/g, '')}`;
            tel.textContent = telefono;
            tel.title = `Chiama ${chi}`;
            li.append(' ', tel);
        }
        teamMembersModalList.appendChild(li);
    });
}

async function nominaCaposquadra(teamData, username, pulsante) {
    pulsante.disabled = true;
    try {
        const r = await fetchApi(`/api/squadre/${teamData.id}/caposquadra`, { method: 'PUT', body: JSON.stringify({ username }) });
        showTemporaryFeedback(r.message, 'success');
        await loadAllTeams();
        updateTeamStatusPanel();
        const aggiornata = allTeamsList.find(t => t.id === teamData.id);
        if (aggiornata && currentlyDisplayedTeamIdInModal === teamData.id) disegnaMembriSquadra(aggiornata);
    } catch (e) {
        showTemporaryFeedback(`Caposquadra non cambiato: ${e.message}`, 'error', 6000);
        pulsante.disabled = false;
    }
}

function closeTeamMembersModal () { 
    if (teamMembersModal) {
        teamMembersModal.style.display = 'none';
    }
    currentlyDisplayedTeamIdInModal = null;
    console.log("Modale membri chiuso.");
}

async function handleAddUpdateSubmit(event) {
    if (event) event.preventDefault();
    if (!currentlyDisplayedReportId || !bottomPanelNewUpdateText) return;

    const updateText = bottomPanelNewUpdateText.value.trim();
    if (!updateText) return;

    const reportId = currentlyDisplayedReportId;
    bottomPanelNewUpdateText.disabled = true;

    try {
        const funzioneId = window.Funzioni?.notaPer(reportId) || null;
        const newUpdate = await fetchApi(`/api/reports/${reportId}/updates`, {
            method: 'POST',
            body: JSON.stringify(funzioneId ? { update_text: updateText, funzione_id: funzioneId } : { update_text: updateText }),
            coda: `Nota sulla segnalazione n. ${reportId}: "${updateText.length > 60 ? updateText.slice(0, 60) + '…' : updateText}"`
        });
        restaInCoda(newUpdate, 'La nota');
        bottomPanelNewUpdateText.value = '';
        if (funzioneId) window.Funzioni.smettiNotaPer();
    } catch (error) {
        console.error(`Errore nell'aggiungere l'aggiornamento:`, error);
        showTemporaryFeedback(`Errore: ${error.message}`);
    } finally {
        bottomPanelNewUpdateText.disabled = false;
        bottomPanelNewUpdateText.focus();
    }
}

// Funzione per creare o aggiornare una CARD nella Inbox laterale
// Un menu colorato: prende il tono della voce scelta, mentre ogni voce,
// aperto il menu, mostra il proprio.
const TONI_SCELTA = ['tono-rosso', 'tono-ambra', 'tono-verde', 'tono-grigio'];
function coloraScelta(select) {
    select.classList.add('scelta-colorata');
    select.classList.remove(...TONI_SCELTA);
    const tono = select.selectedOptions[0]?.className.split(' ').find(c => TONI_SCELTA.includes(c));
    if (tono) select.classList.add(tono);
}

function createOrUpdateReportRow(report, appendToEnd = false) {
    if (!report || report.id === undefined) return null;
    const container = reportListBody; 
    if (!container) return null;

    let card = container.querySelector(`.inbox-card[data-report-id="${report.id}"]`);
    const isNewCard = !card;

    if (isNewCard) {
        card = document.createElement('div');
        card.className = 'inbox-card';
        card.dataset.reportId = report.id;
        
        card.addEventListener('click', (event) => {
            const clickedCard = event.currentTarget;
            const clickedReportId = parseInt(clickedCard.dataset.reportId, 10);
            
            clickedCard.classList.remove('unread-blink');
            if (blinkingReportIds.has(clickedReportId)) {
                blinkingReportIds.delete(clickedReportId);
            }
            // Solo aprirla azzera i segnalatori.
            clickedCard.dataset.maiAperta = 'no';
            azzeraNonLetti(clickedReportId);

            if (sidePanel) sidePanel.style.left = '0px';
            showReportDetails(clickedReportId);
        });
    } else {
        card.innerHTML = '';
    }

    // Dati per la card
    const emergencyReportNumber = report.emergency_report_number;
    const displayValue = (emergencyReportNumber !== null && emergencyReportNumber !== undefined) ? emergencyReportNumber : report.id;

    // Status Badge (Mini)
    let tonoStato = 'spento';
    if (['New', 'Open'].includes(report.status)) tonoStato = 'grave';
    else if (['InProgress'].includes(report.status)) tonoStato = 'ok';

    const squadreAssegnate = Array.isArray(report.assigned_teams) && report.assigned_teams.length > 0
                  ? report.assigned_teams.map(t => t.nome_radio || '?').join(', ')
                  : null;


    const prio = PRIORITA_CARD[report.priority] || PRIORITA_CARD.Medium;
    card.classList.remove('prio-alta', 'prio-media', 'prio-bassa');
    card.classList.add(prio.classe);


    const attesa = calcolaAttesa(report);
    const terminale = TERMINAL_REPORT_STATUSES.includes(report.status);
    // Una segnalazione che non richiede squadra non è mai in ritardo.
    const motivoSenzaSquadra = MOTIVI_SENZA_SQUADRA[report.no_team_reason] || null;
    const attesaCritica = !terminale && !squadreAssegnate && !motivoSenzaSquadra && attesa.minuti >= MINUTI_ATTESA_CRITICA;

    card.dataset.chiaveOrdine = chiaveOrdinamentoReport(report);
    card.dataset.aperta = report.created_at || '';
    card.dataset.situazione = situazioneSegnalazione(report);
    card.dataset.modificata = report.updated_at || '';
    card.dataset.terminale = terminale ? 'si' : 'no';

    // "Mai aperta da quando è cambiata": l'ultima modifica contro l'ultima
    // lettura di questo operatore, che resta anche ricaricando la pagina.
    const vistaIl = window.reportLastViewedLogTimestamp?.get(String(report.id));
    const modificataIl = report.updated_at ? new Date(report.updated_at) : null;
    card.dataset.maiAperta = (!terminale && modificataIl && (!vistaIl || modificataIl > new Date(vistaIl))) ? 'si' : 'no';

    if (blinkingReportIds.has(report.id)) card.classList.add('unread-blink');
    card.innerHTML = `
        <div class="inbox-header">
            <span class="inbox-id-title" title="${escapeHTML(report.title || '')}">
                <span style="color: var(--info-text);">#${displayValue}</span> ${escapeHTML(report.title || 'N/A')}
            </span>
            <span class="inbox-time${attesaCritica ? ' attesa-critica' : ''}" title="Aperta ${attesa.testo} fa">${attesa.testo}</span>
        </div>
        <div class="inbox-preview">
            <i class="fas fa-map-marker-alt" style="font-size:0.7rem; opacity:0.7;"></i> ${escapeHTML(report.location_address || 'Posizione non indicata')}
        </div>
        ${htmlUltimaNota(ultimaNotaDi(report))}
        ${window.Funzioni?.etichette(report.incarichi) ? `<div class="inbox-funzioni">${window.Funzioni.etichette(report.incarichi)}</div>` : ''}
        <div class="inbox-footer">
            <span class="prio-tag ${prio.classeTag}">${prio.etichetta}</span>
            ${squadreAssegnate
                ? `<span class="squadra-tag"><i class="fas fa-truck-pickup" style="font-size:0.65rem;"></i> ${escapeHTML(squadreAssegnate)}</span>`
                : (motivoSenzaSquadra
                    ? `<span class="squadra-tag squadra-non-richiesta" title="${escapeHTML(motivoSenzaSquadra.descrizione)}"><i class="fas fa-hand-paper" style="font-size:0.6rem;"></i> ${motivoSenzaSquadra.etichetta}</span>`
                    : (terminale ? '' : `<span class="squadra-tag squadra-mancante${attesaCritica ? ' attesa-critica' : ''}">DA ASSEGNARE</span>`))}
            <span class="bollino piccolo ${tonoStato}">
                ${escapeHTML(ETICHETTA_STATO[report.status] || report.status || 'N/D')}
            </span>
            ${report.latitude === null ? '<i class="fas fa-exclamation-circle" style="color: var(--danger-text); font-size: 0.8rem;" title="Coordinate Mancanti"></i>' : ''}
        </div>
    `;

    if (!container.contains(card)) {
        const placeholder = container.querySelector('div[style*="Caricamento"]');
        if (placeholder) placeholder.remove();

        const messaggioVuoto = container.querySelector('.no-reports-msg');
        if (messaggioVuoto) messaggioVuoto.remove();

        if (appendToEnd) container.appendChild(card);
        else inserisciCardInOrdine(container, card);
    } else if (!appendToEnd) {
        inserisciCardInOrdine(container, card);
    }

    disegnaSegnalatoreCard(report.id);
    return card;
}

// Il tempo di attesa sulle card avanza da solo.
function aggiornaTempiAttesa() {
    if (!reportListBody) return;
    reportListBody.querySelectorAll('.inbox-card').forEach(card => {
        const aperta = card.dataset.aperta;
        const campoTempo = card.querySelector('.inbox-time');
        if (!aperta || !campoTempo) return;
        const attesa = calcolaAttesa({ created_at: aperta });
        campoTempo.textContent = attesa.testo;
        campoTempo.title = `Aperta ${attesa.testo} fa`;
        const badgeSquadra = card.querySelector('.squadra-mancante');
        const critica = !!badgeSquadra && attesa.minuti >= MINUTI_ATTESA_CRITICA;
        campoTempo.classList.toggle('attesa-critica', critica);

        badgeSquadra?.classList.toggle('attesa-critica', critica);
        const meta = card.querySelector('.inbox-ultima-meta');
        if (meta) meta.textContent = testoMetaNota({ autore: meta.dataset.autore, quando: meta.dataset.quando });
    });
}
setInterval(aggiornaTempiAttesa, 60000);

// Segnalatori di novità: il lampeggio per quello che arriva adesso, il
// contatore per gli aggiornamenti non aperti, il pallino per le segnalazioni
// mai aperte da quando sono cambiate.
const nonLettiPerSegnalazione = new Map();
const TITOLO_BASE = document.title;

function aggiornaContatoreNonLetti(reportId, delta) {
    const attuale = nonLettiPerSegnalazione.get(reportId) || 0;
    const nuovo = Math.max(0, attuale + delta);
    if (nuovo === 0) nonLettiPerSegnalazione.delete(reportId);
    else nonLettiPerSegnalazione.set(reportId, nuovo);
    disegnaSegnalatoreCard(reportId);
    aggiornaTitoloScheda();
    aggiornaNovitaSegnaposto(reportId);
}

function azzeraNonLetti(reportId) {
    nonLettiPerSegnalazione.delete(reportId);
    disegnaSegnalatoreCard(reportId);
    aggiornaTitoloScheda();
    aggiornaNovitaSegnaposto(reportId);
}

// L'ultima notizia scritta da una persona, su una riga sola: un messaggio
// lungo si tronca (intero al passaggio del mouse e aprendo la scheda), così
// la scheda resta della stessa altezza e le altre restano in vista. Quella
// arrivata in tempo reale vale finché il server non ne manda una più nuova.
const ultimeNote = new Map();

function ultimaNotaDi(report) {
    const candidate = [report.ultima_nota, ultimeNote.get(report.id)].filter(n => n?.quando && n?.testo);
    const piuRecente = candidate.sort((a, b) => new Date(b.quando) - new Date(a.quando))[0] || null;
    if (piuRecente) ultimeNote.set(report.id, piuRecente);
    return piuRecente;
}

// "P. Zanella · 3 min fa": l'iniziale del nome lascia spazio al testo.
function testoMetaNota(nota) {
    const parti = String(nota.autore || '').trim().split(/\s+/).filter(Boolean);
    const autore = parti.length > 1 ? `${parti[0][0]}. ${parti.slice(1).join(' ')}` : parti.join('');
    return [autore, quandoRelativo(nota.quando)].filter(Boolean).join(' · ');
}

function htmlUltimaNota(nota) {
    if (!nota) return '';
    const testo = String(nota.testo).replace(/\s+/g, ' ').trim();
    return `<div class="inbox-ultima" title="${escapeHTML(testo)}">`
        + '<i class="fas fa-comment-dots" aria-hidden="true"></i>'
        + `<span class="inbox-ultima-testo">${escapeHTML(testo)}</span>`
        + `<span class="inbox-ultima-meta" data-autore="${escapeHTML(nota.autore || '')}" data-quando="${escapeHTML(nota.quando)}">${escapeHTML(testoMetaNota(nota))}</span>`
        + '</div>';
}

function impostaUltimaNota(reportId, nota) {
    const precedente = ultimeNote.get(reportId);
    if (precedente && new Date(precedente.quando) > new Date(nota.quando)) return;
    ultimeNote.set(reportId, nota);
    const card = reportListBody?.querySelector(`.inbox-card[data-report-id="${reportId}"]`);
    if (!card) return;
    const contenitore = document.createElement('div');
    contenitore.innerHTML = htmlUltimaNota(nota);
    const nuova = contenitore.firstElementChild;
    const vecchia = card.querySelector('.inbox-ultima');
    if (vecchia) vecchia.replaceWith(nuova);
    else card.querySelector('.inbox-preview')?.after(nuova);
}

function disegnaSegnalatoreCard(reportId) {
    const card = reportListBody?.querySelector(`.inbox-card[data-report-id="${reportId}"]`);
    if (!card) return;
    const intestazione = card.querySelector('.inbox-header');
    if (!intestazione) return;

    let segnalatore = intestazione.querySelector('.segnalatore-novita');
    const quanti = nonLettiPerSegnalazione.get(reportId) || 0;
    const maiAperta = card.dataset.maiAperta === 'si';

    if (quanti === 0 && !maiAperta) {
        segnalatore?.remove();
        return;
    }
    if (!segnalatore) {
        segnalatore = document.createElement('span');
        segnalatore.className = 'segnalatore-novita';

        intestazione.insertBefore(segnalatore, intestazione.querySelector('.inbox-time'));
    }
    if (quanti > 0) {
        segnalatore.textContent = quanti > 9 ? '9+' : String(quanti);
        segnalatore.classList.remove('solo-pallino');
        segnalatore.title = quanti === 1 ? '1 aggiornamento non letto' : `${quanti} aggiornamenti non letti`;
    } else {
        segnalatore.textContent = '';
        segnalatore.classList.add('solo-pallino');
        segnalatore.title = 'Non ancora aperta da quando è cambiata';
    }
}

// Le novità nel titolo della scheda del browser.
let novitaDocumenti = 0;

function aggiornaTitoloScheda() {
    let totale = 0;
    nonLettiPerSegnalazione.forEach(n => { totale += n; });
    totale += novitaDocumenti;
    document.title = totale > 0 ? `(${totale}) ${TITOLO_BASE}` : TITOLO_BASE;
    aggiornaBadgeSezioni();
}

// La colonna degli eventi: chi ha fatto cosa e quando, per chi arriva a metà turno.
const pannelloEventi = document.getElementById('pannello-eventi');
const listaEventi = document.getElementById('lista-eventi');
const toggleEventiBtn = document.getElementById('toggle-eventi-btn');
const badgeEventi = document.getElementById('badge-eventi');
let eventiNonVisti = 0;

const ETICHETTE_EVENTO = {
    segnalazione_aperta: 'ha aperto',
    nota: 'ha annotato su',
    evento_sistema: '',
    documento: 'ha caricato'
};

function descriviEvento(evento) {
    const riferimento = evento.numero ?? evento.report_id;
    switch (evento.tipo) {
        case 'segnalazione_aperta': return `ha aperto #${riferimento} — ${evento.testo || ''}`;
        case 'nota': return `#${riferimento}: ${evento.testo || ''}`;
        case 'evento_sistema': return `#${riferimento}: ${evento.testo || ''}`;
        case 'documento': return `ha caricato ${evento.testo || 'un documento'}`;
        case 'sala': return evento.testo || '';
        default: return evento.testo || '';
    }
}

function creaRigaEvento(evento, nuovo) {
    const li = document.createElement('li');
    if (nuovo) li.classList.add('evento-nuovo');
    if (evento.priorita === 'High' && evento.tipo === 'segnalazione_aperta') li.classList.add('evento-urgente');
    if (evento.tipo === 'sala') li.classList.add('evento-sala');

    const quando = evento.quando ? new Date(evento.quando) : new Date();
    const meta = document.createElement('span');
    meta.className = 'evento-meta';
    const ora = document.createElement('span');
    ora.className = 'evento-ora';
    ora.textContent = quando.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const chi = document.createElement('span');
    chi.className = 'evento-chi';
    chi.textContent = evento.chi || 'Sistema';
    meta.append(ora, chi);

    const testo = document.createElement('span');
    testo.className = 'evento-testo';
    testo.textContent = descriviEvento(evento);

    li.append(meta, testo);

    if (evento.report_id) {
        li.classList.add('evento-cliccabile');
        li.addEventListener('click', () => {
            reportListBody?.querySelector(`.inbox-card[data-report-id="${evento.report_id}"]`)?.click();
        });
    }
    return li;
}

function aggiungiEvento(evento) {
    if (!listaEventi) return;
    listaEventi.querySelector('.evento-vuoto')?.remove();
    listaEventi.insertBefore(creaRigaEvento(evento, true), listaEventi.firstChild);
    while (listaEventi.children.length > 80) listaEventi.lastElementChild.remove();

    if (pannelloEventi?.classList.contains('chiuso')) {
        eventiNonVisti++;
        if (badgeEventi) {
            badgeEventi.textContent = eventiNonVisti > 9 ? '9+' : String(eventiNonVisti);
            badgeEventi.style.display = 'inline-flex';
        }
    }
}

// Il diario di sala: le note che non riguardano una segnalazione. Si scrive
// dalla colonna degli eventi e arriva a tutte le postazioni.
const formDiarioSala = document.getElementById('form-diario-sala');
const testoDiarioSala = document.getElementById('testo-diario-sala');

function aggiornaFormDiarioSala() {
    if (formDiarioSala) formDiarioSala.hidden = !activeEmergency || ruoliUtente().includes('esterno');
}

formDiarioSala?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const testo = testoDiarioSala.value.trim();
    if (!testo) return;
    const bottone = formDiarioSala.querySelector('button');
    bottone.disabled = true;
    try {
        restaInCoda(await fetchApi('/api/emergencies/diario-sala', {
            method: 'POST', body: JSON.stringify({ testo }),
            coda: `Diario di sala: "${testo.length > 60 ? testo.slice(0, 60) + '…' : testo}"`
        }), 'La nota del diario');
        testoDiarioSala.value = '';
    } catch (err) {
        showTemporaryFeedback(err.message || 'Nota non salvata.');
    } finally {
        bottone.disabled = false;
    }
});

testoDiarioSala?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) formDiarioSala.requestSubmit();
});

document.addEventListener('ws:nota_sala', (event) => {
    const messaggio = event.detail || {};
    if (!activeEmergency || messaggio.emergency_id !== activeEmergency.id || !messaggio.voce) return;
    aggiungiEvento({ quando: messaggio.voce.creata_il, tipo: 'sala', chi: messaggio.voce.autore_nome, testo: messaggio.voce.testo });
});

async function caricaEventi() {
    aggiornaFormDiarioSala();
    if (!listaEventi || !activeEmergency) return;
    try {
        const eventi = await fetchApi(`/api/emergencies/${activeEmergency.id}/eventi?limit=60`);
        listaEventi.innerHTML = '';
        if (!eventi || eventi.length === 0) {
            listaEventi.innerHTML = '<li class="evento-vuoto">Nessun evento registrato.</li>';
            return;
        }
        eventi.forEach(e => listaEventi.appendChild(creaRigaEvento(e, false)));
    } catch (error) {
        console.error('Errore caricamento eventi:', error);
        listaEventi.innerHTML = '<li class="evento-vuoto">Impossibile caricare gli eventi.</li>';
    }
}

// La classe sul body sposta avvisi e comandi della mappa a sinistra della colonna.
function impostaPannelloEventi(apri) {
    if (!pannelloEventi) return;
    pannelloEventi.classList.toggle('chiuso', !apri);
    document.body.classList.toggle('eventi-aperti', apri);
    if (apri) {
        eventiNonVisti = 0;
        if (badgeEventi) badgeEventi.style.display = 'none';
    }
}

if (toggleEventiBtn && pannelloEventi) {
    toggleEventiBtn.addEventListener('click', () => impostaPannelloEventi(pannelloEventi.classList.contains('chiuso')));
    document.getElementById('chiudi-eventi-btn')?.addEventListener('click', () => impostaPannelloEventi(false));
    impostaPannelloEventi(!pannelloEventi.classList.contains('chiuso'));
}

// Avviso a comparsa e suono, generato dal browser (funziona senza Internet).
// Suona solo per l'alta priorità, e non più di una volta ogni mezzo minuto.
let contestoAudio = null;
let ultimoSuono = 0;
const PAUSA_MINIMA_SUONO_MS = 30000;

function preparaAudio() {
    // Il browser suona solo dopo un gesto dell'utente.
    if (contestoAudio) return;
    try {
        const Costruttore = window.AudioContext || window.webkitAudioContext;
        if (!Costruttore) return;
        contestoAudio = new Costruttore();
        if (contestoAudio.state === 'suspended') contestoAudio.resume();
    } catch (e) {
        console.warn('Audio non disponibile su questo browser:', e);
    }
}
document.addEventListener('click', preparaAudio, { once: true });
document.addEventListener('keydown', preparaAudio, { once: true });

function suonaAvvisoUrgente() {
    if (!contestoAudio || Date.now() - ultimoSuono < PAUSA_MINIMA_SUONO_MS) return;
    ultimoSuono = Date.now();
    try {
        // Due note discendenti: si distingue dai suoni di sistema di Windows.
        [[880, 0], [660, 0.18]].forEach(([frequenza, ritardo]) => {
            const oscillatore = contestoAudio.createOscillator();
            const volume = contestoAudio.createGain();
            oscillatore.type = 'sine';
            oscillatore.frequency.value = frequenza;
            const inizio = contestoAudio.currentTime + ritardo;
            volume.gain.setValueAtTime(0.0001, inizio);
            volume.gain.exponentialRampToValueAtTime(0.25, inizio + 0.02);
            volume.gain.exponentialRampToValueAtTime(0.0001, inizio + 0.16);
            oscillatore.connect(volume).connect(contestoAudio.destination);
            oscillatore.start(inizio);
            oscillatore.stop(inizio + 0.18);
        });
    } catch (e) {
        console.warn('Riproduzione avviso sonora non riuscita:', e);
    }
}

// Gli avvisi restano finché qualcuno li chiude o apre la segnalazione a cui
// si riferiscono: in sala un avviso che sparisce da solo può passare
// inosservato. Con più di due avvisi compare "Chiudi tutti".
function chiudiAvvisiDi(reportId) {
    document.querySelectorAll(`#contenitore-avvisi .avviso-novita[data-report-id="${Number(reportId)}"]`).forEach(a => a.remove());
    aggiornaChiudiTutti();
}

function aggiornaChiudiTutti() {
    const contenitore = document.getElementById('contenitore-avvisi');
    if (!contenitore) return;
    const quanti = contenitore.querySelectorAll('.avviso-novita').length;
    let tutti = contenitore.querySelector('.avvisi-chiudi-tutti');
    if (quanti < 3) { tutti?.remove(); return; }
    if (!tutti) {
        tutti = document.createElement('button');
        tutti.type = 'button';
        tutti.className = 'avvisi-chiudi-tutti';
        tutti.addEventListener('click', () => {
            contenitore.querySelectorAll('.avviso-novita').forEach(a => a.remove());
            aggiornaChiudiTutti();
        });
        contenitore.prepend(tutti);
    }
    tutti.textContent = `Chiudi tutti gli avvisi (${quanti})`;
}

function mostraAvviso({ titolo, testo, urgente, reportId }) {
    const contenitore = document.getElementById('contenitore-avvisi');

    const avviso = document.createElement('div');
    avviso.className = 'avviso-novita' + (urgente ? ' avviso-urgente' : '');
    if (reportId) avviso.dataset.reportId = String(Number(reportId));
    avviso.innerHTML = `
        <div class="avviso-testo">
            <span class="avviso-titolo">${escapeHTML(titolo)}</span>
            <span class="avviso-dettaglio">${escapeHTML(testo)}</span>
        </div>
    `;

    if (reportId) {
        const vai = document.createElement('button');
        vai.type = 'button';
        vai.className = 'avviso-vai';
        vai.textContent = 'Vai';
        vai.addEventListener('click', () => {
            reportListBody?.querySelector(`.inbox-card[data-report-id="${reportId}"]`)?.click();
            avviso.remove();
            aggiornaChiudiTutti();
        });
        avviso.appendChild(vai);
    }

    const chiudi = document.createElement('button');
    chiudi.type = 'button';
    chiudi.className = 'avviso-chiudi';
    chiudi.setAttribute('aria-label', 'Chiudi avviso');
    chiudi.innerHTML = '&times;';
    chiudi.addEventListener('click', () => { avviso.remove(); aggiornaChiudiTutti(); });
    avviso.appendChild(chiudi);

    contenitore.appendChild(avviso);
    aggiornaChiudiTutti();

    if (urgente) suonaAvvisoUrgente();
    notificaComputer({ titolo, testo, urgente, reportId });
}

// Le notifiche del computer: quando la finestra del centro operativo non è
// in primo piano (l'operatore sta scrivendo una PEC o è su un'altra scheda)
// l'avviso compare anche nell'angolo dello schermo. Un clic riporta qui,
// sulla segnalazione. Servono il permesso, chiesto con il pulsante "Avvisi
// sul computer", e una connessione sicura (https).
function notificaComputer({ titolo, testo, urgente, reportId }) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    try {
        const n = new Notification(titolo, {
            body: testo,
            tag: reportId ? `orion-segnalazione-${reportId}` : undefined,
            renotify: !!reportId,
            requireInteraction: !!urgente,
            icon: '/logo.png'
        });
        n.onclick = () => {
            window.focus();
            if (reportId) reportListBody?.querySelector(`.inbox-card[data-report-id="${reportId}"]`)?.click();
            n.close();
        };
    } catch (e) {
        console.warn('Notifica del computer non riuscita:', e);
    }
}

function preparaAvvisiComputer() {
    const pulsante = document.getElementById('avvisi-computer-btn');
    if (!pulsante || !('Notification' in window) || !window.isSecureContext) return;
    const aggiorna = () => { pulsante.hidden = Notification.permission !== 'default'; };
    aggiorna();
    pulsante.addEventListener('click', async () => {
        try { await Notification.requestPermission(); } catch { /* il browser non lo chiede */ }
        aggiorna();
        if (Notification.permission === 'granted') {
            notifica('Avvisi sul computer attivi: arriveranno anche con la finestra in secondo piano.', 'successo');
        } else if (Notification.permission === 'denied') {
            notifica('Avvisi sul computer non permessi: si riattivano dalle impostazioni del sito nel browser (il lucchetto accanto all\'indirizzo).', 'attenzione');
        }
    });
}
preparaAvvisiComputer();

// Il contatore sulla sezione che non è in vista (segnalazioni o documenti).
function aggiornaBadgeSezioni() {
    if (!toggleDocsPanelBtn) return;
    const documentiInVista = emergencyDocsManagementDiv?.style.display === 'flex';

    let quanti;
    if (documentiInVista) {
        quanti = 0;
        nonLettiPerSegnalazione.forEach(n => { quanti += n; });
    } else {
        quanti = novitaDocumenti;
    }


    const etichetta = documentiInVista
        ? '<i class="fas fa-arrow-left"></i> Elenco'
        : '<i class="fas fa-folder"></i> Documenti';
    toggleDocsPanelBtn.title = documentiInVista ? 'Torna alle segnalazioni' : 'Documenti dell\'emergenza';
    const titolo = document.getElementById('titolo-colonna');
    if (titolo) titolo.textContent = documentiInVista ? 'Documenti' : 'Segnalazioni';
    // "Mostra chiuse" riguarda le segnalazioni: con i documenti aperti non fa niente.
    const mostraChiuse = document.getElementById('toggle-closed-reports-btn');
    if (mostraChiuse) mostraChiuse.style.display = documentiInVista ? 'none' : '';
    const badge = quanti > 0
        ? `<span class="badge-sezione">${quanti > 9 ? '9+' : quanti}</span>`
        : '';
    toggleDocsPanelBtn.innerHTML = etichetta + badge;
}

// Una voce del diario, al caricamento come dal WebSocket.

function voceDiSistema(update) {
    // Senza is_system (voci vecchie) si riconosce dal testo.
    if (typeof update.is_system === 'boolean') return update.is_system;
    const testo = update.update_text || '';
    return /modificat|assegnat|disassociate|immagin.*caricat|^Coordinate aggiornate/i.test(testo);
}

function creaVoceLog(update, isMyOwnUpdate, nuova) {
    const li = document.createElement('li');
    li.dataset.logTimestamp = update.update_timestamp;
    const quando = new Date(update.update_timestamp);
    const orario = quando.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const autore = update.updater_fullname || 'Sconosciuto';
    const testo = update.update_text || '';
    const sigla = update.funzione_sigla ? `<span class="fz-tag">${escapeHTML(update.funzione_sigla)}</span> ` : '';

    if (voceDiSistema(update)) {
        li.className = 'chat-system';
        li.innerHTML = (sigla || '<i class="fas fa-info-circle"></i> ') + escapeHTML(testo) +
            ' <span style="opacity:0.7;">(' + escapeHTML(autore) + ', ' + escapeHTML(orario) + ')</span>';
        li.style.cssText = 'font-size: 0.75rem; text-align: center; margin: 4px 0;';
    } else {
        li.className = 'chat-bubble ' + (isMyOwnUpdate ? 'chat-me' : 'chat-others');
        li.innerHTML = `
            <div style="font-size: 0.85rem; line-height: 1.3;">
                <strong style="font-size: 0.75rem; opacity: 0.8; margin-right: 4px;">[${orario} - ${isMyOwnUpdate ? 'Tu' : escapeHTML(autore)}]</strong>
                ${sigla}${escapeHTML(testo)}
            </div>
        `;
        li.style.cssText = 'padding: 6px 10px; border-radius: 6px; max-width: 95%; margin-bottom: 4px;';
    }

    if (nuova) {
        li.classList.add('new-log-blink');
        li.addEventListener('click', (e) => e.currentTarget.classList.remove('new-log-blink'), { once: true });
    }
    return li;
}

function creaSeparatoreNuovi(quante) {
    const li = document.createElement('li');
    li.className = 'separatore-nuovi';
    li.textContent = quante === 1 ? '1 nuovo aggiornamento' : `${quante} nuovi aggiornamenti`;
    return li;
}

// La coda: prima l'urgenza, poi l'attesa più lunga.
const PRIORITA_CARD = {
    High:   { classe: 'prio-alta',  classeTag: 'prio-tag-alta',  etichetta: 'ALTA',  rango: 0 },
    Medium: { classe: 'prio-media', classeTag: 'prio-tag-media', etichetta: 'MEDIA', rango: 1 },
    Low:    { classe: 'prio-bassa', classeTag: 'prio-tag-bassa', etichetta: 'BASSA', rango: 2 }
};

function calcolaAttesa(report) {
    const apertura = report.created_at ? new Date(report.created_at) : null;
    if (!apertura || isNaN(apertura.getTime())) return { minuti: 0, testo: '—' };
    const minuti = Math.max(0, Math.floor((Date.now() - apertura.getTime()) / 60000));
    if (minuti < 60) return { minuti, testo: `${minuti} min` };
    const ore = Math.floor(minuti / 60);
    if (ore < 24) return { minuti, testo: `${ore}h ${String(minuti % 60).padStart(2, '0')}m` };
    return { minuti, testo: `${Math.floor(ore / 24)}g ${ore % 24}h` };
}

// Chiave ordinabile: rango della priorità e istante di apertura.

function chiaveOrdinamentoReport(report) {
    const rango = (PRIORITA_CARD[report.priority] || PRIORITA_CARD.Medium).rango;
    const apertura = report.created_at ? new Date(report.created_at).getTime() : Date.now();
    return `${rango}-${String(apertura).padStart(16, '0')}`;
}

function inserisciCardInOrdine(container, card) {
    const chiave = card.dataset.chiaveOrdine || '';
    const esistenti = [...container.querySelectorAll('.inbox-card')].filter(c => c !== card);
    const successiva = esistenti.find(c => (c.dataset.chiaveOrdine || '') > chiave);
    if (successiva) container.insertBefore(card, successiva);
    else container.appendChild(card);
}

function appendReportRows(reports) {
    if (!reportListBody || !Array.isArray(reports)) return;

    if (reports.length > 0) {
        const placeholder = reportListBody.querySelector('div[style*="Caricamento"]');
        if (placeholder) placeholder.remove();
        
        const noReportsMsg = reportListBody.querySelector('.no-reports-msg');
        if (noReportsMsg) noReportsMsg.remove();
    } else if (reportListBody.children.length === 0) {
        reportListBody.innerHTML = '<div class="no-reports-msg" style="padding: 20px; text-align: center; color: var(--text-muted);">Nessuna segnalazione trovata.</div>';
    }
    reports.forEach(report => createOrUpdateReportRow(report, true));
}


// --- Riepilogo sopra l'elenco ---------------------------------------------
// Quante segnalazioni aperte ci sono in ogni situazione, con i colori dei
// segnaposto (fa anche da legenda della mappa). Un clic su una voce mostra
// solo quelle; un altro clic, o "Aperte", le rimostra tutte. Si ricalcola da
// solo a ogni cambiamento dell'elenco.
const VOCI_RIEPILOGO = [
    { id: 'tutte', etichetta: 'Aperte', prova: () => true },
    { id: 'da_assegnare', etichetta: 'Da assegnare', prova: (c) => c.dataset.situazione === 'da_assegnare' },
    { id: 'con_squadra', etichetta: 'Con squadra', prova: (c) => c.dataset.situazione === 'con_squadra' },
    { id: 'senza_squadra', etichetta: 'Senza squadra', titolo: 'Squadra non necessaria: monitoraggio, altro ente, nessun intervento', prova: (c) => c.dataset.situazione === 'senza_squadra', soloSePresenti: true },
    { id: 'risolta', etichetta: 'Risolte', prova: (c) => c.dataset.situazione === 'risolta', soloSePresenti: true },
    { id: 'novita', etichetta: 'Con novità', prova: (c) => c.classList.contains('unread-blink') || !!c.querySelector('.segnalatore-novita') }
];
let filtroRiepilogo = 'tutte';

function aggiornaRiepilogo() {
    const box = document.getElementById('riepilogo-segnalazioni');
    if (!box || !reportListBody) return;
    if (showOnlyClosedReports) filtroRiepilogo = 'tutte';
    const schede = [...reportListBody.querySelectorAll('.inbox-card')];
    box.hidden = showOnlyClosedReports || schede.length === 0;
    const voce = VOCI_RIEPILOGO.find(v => v.id === filtroRiepilogo) || VOCI_RIEPILOGO[0];
    schede.forEach(c => { c.hidden = !voce.prova(c); });

    box.replaceChildren(...VOCI_RIEPILOGO.flatMap(v => {
        const quante = schede.filter(v.prova).length;
        if (v.soloSePresenti && quante === 0 && filtroRiepilogo !== v.id) return [];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `voce-riepilogo voce-${v.id}${filtroRiepilogo === v.id ? ' attiva' : ''}${v.id === 'novita' && quante > 0 ? ' con-novita' : ''}`;
        b.setAttribute('aria-pressed', String(filtroRiepilogo === v.id));
        if (v.titolo) b.title = v.titolo;
        const pallino = document.createElement('span');
        pallino.className = 'pallino-riepilogo';
        const numero = document.createElement('strong');
        numero.textContent = String(quante);
        b.append(pallino, numero, document.createTextNode(` ${v.etichetta}`));
        b.addEventListener('click', () => {
            filtroRiepilogo = (filtroRiepilogo === v.id || v.id === 'tutte') ? 'tutte' : v.id;
            aggiornaRiepilogo();
        });
        return [b];
    }));
}

if (reportListBody) {
    let inAttesaRiepilogo = false;
    new MutationObserver(() => {
        if (inAttesaRiepilogo) return;
        inAttesaRiepilogo = true;
        requestAnimationFrame(() => { inAttesaRiepilogo = false; aggiornaRiepilogo(); });
    }).observe(reportListBody, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-situazione'] });
}
