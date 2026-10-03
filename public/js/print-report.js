let brandingSettings = {
    association_name: 'Gruppo di Protezione Civile',
    logoUrl: 'logo.png'
};

async function loadAndApplyBranding() {
    try {
        const settings = await fetchApi('/api/branding/settings');
        if (settings && settings.association_name) {
            brandingSettings.association_name = settings.association_name;
        }
        const logoInfo = await fetchApi('/api/branding');
        if (logoInfo && logoInfo.logoUrl) {
            brandingSettings.logoUrl = `${logoInfo.logoUrl}?v=${logoInfo.logoVersion}`;
        }
    } catch (error) {
        console.error("Errore nel caricamento del branding:", error);
    }
}

function populateElement(elementId, value, defaultValue = 'N/D') {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value !== null && value !== undefined && String(value).trim() !== '' ? String(value) : defaultValue;
    }
}

// Etichette italiane: questo foglio è il documento che finisce agli atti e in
// procura, "InProgress" e "High" non ci devono comparire.
const ETICHETTA_STATO = { New: 'Nuova', Open: 'Aperta', InProgress: 'In corso', Closed: 'Chiusa', Resolved: 'Risolta' };
const ETICHETTA_PRIORITA = { High: 'Alta', Medium: 'Media', Low: 'Bassa' };

function formatBadge(elementId, value, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const safeValue = value || 'N/D';
    const etichetta = type === 'status' ? (ETICHETTA_STATO[safeValue] || safeValue)
                    : type === 'priority' ? (ETICHETTA_PRIORITA[safeValue] || safeValue)
                    : safeValue;
    el.textContent = etichetta;
    
    // Logica colori
    let bgColor = '#f1f5f9', color = '#64748b', borderColor = '#cbd5e1';
    
    if (type === 'status') {
        if (['New', 'Open'].includes(safeValue)) { bgColor = '#fee2e2'; color = '#ef4444'; borderColor = '#fca5a5'; }
        else if (safeValue === 'InProgress') { bgColor = '#d1fae5'; color = '#10b981'; borderColor = '#6ee7b7'; }
    } else if (type === 'priority') {
        if (safeValue === 'High') { bgColor = '#fee2e2'; color = '#ef4444'; borderColor = '#fca5a5'; }
        else if (safeValue === 'Medium') { bgColor = '#fef3c7'; color = '#d97706'; borderColor = '#fde68a'; }
        else if (safeValue === 'Low') { bgColor = '#d1fae5'; color = '#10b981'; borderColor = '#6ee7b7'; }
    }

    el.style.backgroundColor = bgColor;
    el.style.color = color;
    el.style.borderColor = borderColor;
}

function formatPrintDate(dtString) {
    return dtString ? new Date(dtString).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' }) : 'N/D';
}

function formatPrintCoord(coord) {
     return coord !== null && coord !== undefined ? parseFloat(coord).toFixed(5) : 'N/D';
}

async function generatePrintPage() {
    await loadAndApplyBranding();

    populateElement('print-association-name', brandingSettings.association_name);
    if (brandingSettings.logoUrl) {
        const logoEl = document.getElementById('print-app-logo');
        logoEl.src = brandingSettings.logoUrl;
        logoEl.style.display = 'block';
        
        const watermarkEl = document.getElementById('print-watermark');
        watermarkEl.style.backgroundImage = `url('${brandingSettings.logoUrl}')`;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const reportId = urlParams.get('id');

    if (!reportId || isNaN(parseInt(reportId))) {
        document.body.innerHTML = '<h1>Errore: ID Segnalazione mancante.</h1>';
        return;
    }

    populateElement('print-generation-date', new Date().toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' }));

    try {
        const data = await fetchApi('/api/reports/' + reportId);
        if (!data || !data.report) throw new Error('Dati report non trovati.');

        const report = data.report;
        const updates = data.updates || [];
        const displayValue = report.emergency_report_number ?? report.id;

        document.title = 'Stampa Segnalazione #' + displayValue;
        populateElement('print-report-id', displayValue);
        populateElement('print-emergency-name', report.emergency_code, '-');

        // Dati Principali
        populateElement('print-title', report.title);
        formatBadge('print-status', report.status, 'status');
        formatBadge('print-priority', report.priority, 'priority');

        // Localizzazione
        populateElement('print-location', report.location_address);
        populateElement('print-coords', `Lat: ${formatPrintCoord(report.latitude)} / Lon: ${formatPrintCoord(report.longitude)}`);
        populateElement('print-reporter-name', report.reporter_name);
        populateElement('print-reporter-contact', report.reporter_contact);

        // Operativi
        populateElement('print-description', report.description, 'Nessuna descrizione fornita.');
        
        if (report.environmental_hazard) {
            document.getElementById('hazard-container').style.display = 'block';
            populateElement('print-environmental-hazard', report.environmental_hazard);
        }

        // Se nessuna squadra è intervenuta, il motivo va scritto: su un documento
        // che finisce agli atti "Nessuna squadra assegnata" da solo si legge come
        // una dimenticanza, anche quando era una decisione presa e registrata.
        const MOTIVI_SENZA_SQUADRA = {
            altro_ente: 'Nessuna squadra: gestita da altro ente',
            monitoraggio: 'Nessuna squadra: solo monitoraggio',
            nessun_intervento: 'Nessuna squadra: nessun intervento necessario'
        };
        const teamNames = Array.isArray(report.assigned_teams) && report.assigned_teams.length > 0
            ? report.assigned_teams.map(t => t.nome).join(', ')
            : (MOTIVI_SENZA_SQUADRA[report.no_team_reason] || 'Nessuna squadra assegnata');
        populateElement('print-assigned-teams', teamNames);
        populateElement('print-creator', `${report.creator_fullname || 'Sconosciuto'} il ${formatPrintDate(report.created_at)}`);
        populateElement('print-updated-at', formatPrintDate(report.updated_at));

        // Immagini
        const imageGallery = document.getElementById('print-image-gallery');
        const imageSection = document.getElementById('print-images-section');
        if (report.image_urls && report.image_urls.length > 0) {
            report.image_urls.forEach(url => {
                const img = document.createElement('img');
                img.src = url;
                img.className = 'report-image-thumbnail';
                imageGallery.appendChild(img);
            });
            imageSection.style.display = 'block';
        }

        // Log (Diario Operativo)
        const logList = document.getElementById('print-log-list');
        logList.innerHTML = '';
        if (updates.length > 0) {
            updates.forEach(update => {
                const li = document.createElement('li');
                const p = document.createElement('p');
                p.textContent = update.update_text || ''; 
                const updaterName = update.updater_fullname || 'Sistema/Sconosciuto';
                const updateDate = new Date(update.update_timestamp).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
                const small = document.createElement('small');
                small.textContent = `Inserito da: ${updaterName} - ${updateDate}`;
                
                li.appendChild(p);
                li.appendChild(small);
                logList.appendChild(li);
            });
        } else {
            logList.innerHTML = '<li><p>Nessun aggiornamento operativo registrato.</p></li>';
        }

        // Ritardo leggermente maggiore (800ms) per permettere il caricamento del logo e delle foto in alta risoluzione
        setTimeout(window.print, 800);

    } catch (error) {
        document.body.innerHTML = `<h1>Errore</h1><p>${escapeHTML(error.message)}</p>`;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', generatePrintPage);
} else {
    generatePrintPage();
}
