// /public/js/admin-archive.js

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

document.addEventListener('DOMContentLoaded', async () => {
    if (!haRuolo('admin')) {
        notifica('Accesso negato. Questa sezione è riservata agli amministratori.', 'errore');
        window.location.href = '/centro-operativo.html';
        return;
    }
    
    console.log("Pagina Archivio Emergenze caricata.");
    await loadAndApplyBranding();

    const emergencySelect = document.getElementById('closed-emergency-select');
    const emergencyDetailsDisplay = document.getElementById('emergency-details-display');
    const reportsSection = document.getElementById('archived-reports-section');
    const reportsTableBody = document.getElementById('archived-report-list-body');

    const archivedDetailModal = document.getElementById('archived-report-detail-modal');
    const closeArchivedDetailModalBtn = document.getElementById('closeArchivedDetailModalBtn');
    const cancelArchivedDetailModalBtn = document.getElementById('cancelArchivedDetailModalBtn');
    const archivedPrintLink = document.getElementById('archived-print-link');

    const docsSection = document.getElementById('archived-docs-section');
    const docsListContainer = document.getElementById('archived-docs-list-container');

    const deleteSelectedEmergencyBtn = document.getElementById('delete-selected-emergency-btn');
    const downloadResocontoLink = document.getElementById('download-resoconto-link');

    let selectedArchivedEmergency = null;

let brandingSettings = {
    association_name: 'Archivio Emergenze'
};

    if (!emergencySelect || !reportsTableBody || !reportsSection || !emergencyDetailsDisplay) {
        console.error("Elementi HTML necessari non trovati nella pagina archivio.");
        return;
    }

    const formatDate = (dtString) => dtString ? new Date(dtString).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short'}) : 'N/A';

    async function loadClosedEmergencies() {
        selectedArchivedEmergency = null;
        if(deleteSelectedEmergencyBtn) deleteSelectedEmergencyBtn.style.display = 'none';
        if(downloadResocontoLink) downloadResocontoLink.style.display = 'none';
        emergencyDetailsDisplay.textContent = '';
        reportsSection.style.display = 'none';
        reportsTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Seleziona un\'emergenza.</td></tr>';

        try {
            const closedEmergencies = await fetchApi('/api/admin/emergencies/closed');
            emergencySelect.innerHTML = '<option value="">-- Seleziona un\'emergenza archiviata --</option>';

            if (closedEmergencies && closedEmergencies.length > 0) {
                closedEmergencies.forEach(em => {
                    const option = document.createElement('option');
                    option.value = em.id;
                    const endDate = em.end_time ? `Chiusa: ${formatDate(em.end_time)}` : 'Data chiusura non disp.';
                    option.textContent = `${em.code} ${em.name ? '- ' + em.name : ''} (${endDate})`;
                    option.dataset.code = em.code;
                    option.dataset.name = em.name || '';
                    emergencySelect.appendChild(option);
                });
            } else {
                 emergencySelect.innerHTML = '<option value="">Nessuna emergenza archiviata trovata.</option>';
            }
        } catch (error) {
            console.error("Errore caricamento emergenze archiviate:", error);
             emergencySelect.innerHTML = '<option value="">Errore caricamento</option>';
        }
    }

    // NUOVA Funzione per caricare i documenti
    async function loadArchivedDocuments(emergencyId) {
        if (!docsListContainer || !docsSection) return;

        if (!emergencyId) {
            docsSection.style.display = 'none';
            return;
        }

        console.log('Caricamento documenti per emergenza archiviata ID:', emergencyId);
        docsSection.style.display = 'block';
        docsListContainer.innerHTML = '<p class="placeholder-text">Caricamento documenti...</p>';

        try {
            const documents = await fetchApi(`/api/emergencies/${emergencyId}/documents`);
            renderArchivedDocuments(documents || []);
        } catch (error) {
            console.error("Errore caricamento documenti archiviati:", error);
            docsListContainer.innerHTML = '<p class="placeholder-text error-message">Errore nel caricamento dei documenti.</p>';
        }
    }

    // MODIFICATA: Funzione per renderizzare i documenti (senza pulsante elimina)
    function renderArchivedDocuments(documents) {
        if (!docsListContainer) return;
        docsListContainer.innerHTML = '';

        if (!documents || documents.length === 0) {
            docsListContainer.innerHTML = '<p class="placeholder-text">Nessun documento trovato per questa emergenza.</p>';
            return;
        }

        documents.forEach(doc => {
            const docElement = document.createElement('div');
            docElement.className = 'doc-list-item';
            docElement.dataset.docId = doc.id;
            const uploadedAt = formatDate(doc.uploaded_at);

            // Nome file e autore come testo, non come HTML.
            docElement.innerHTML = `
                <a href="${escapeHTML(doc.file_path)}" target="_blank" class="doc-link" title="Apri ${escapeHTML(doc.original_filename)}">
                    <i class="las la-file-alt doc-icon"></i>
                    <div class="doc-info">
                        <span class="doc-filename">${escapeHTML(doc.original_filename)}</span>
                        <small class="doc-meta">Caricato da ${escapeHTML(doc.uploader_fullname)} il ${escapeHTML(uploadedAt)}</small>
                    </div>
                </a>
            `;
            // Rimosso il listener per il pulsante non più esistente
            docsListContainer.appendChild(docElement);
        });
    }

// Etichette italiane dei codici interni: nell'archivio le schede vengono
    // rilette a distanza di mesi, spesso da chi non ha mai visto il codice.
    const ETICHETTA_STATO = { New: 'Nuova', Open: 'Aperta', InProgress: 'In corso', Closed: 'Chiusa', Resolved: 'Risolta' };
    const ETICHETTA_PRIORITA = { High: 'Alta', Medium: 'Media', Low: 'Bassa' };

    function getStatusBadgeHTML(value, type) {
        let bgColor = '#f1f5f9', color = '#64748b';
        
        if (type === 'status') {
            if (['New', 'Open'].includes(value)) { bgColor = '#fee2e2'; color = '#ef4444'; }
            else if (value === 'InProgress') { bgColor = '#d1fae5'; color = '#10b981'; }
        } else if (type === 'priority') {
            if (value === 'High') { bgColor = '#fee2e2'; color = '#ef4444'; }
            else if (value === 'Medium') { bgColor = '#fef3c7'; color = '#d97706'; }
            else if (value === 'Low') { bgColor = '#d1fae5'; color = '#10b981'; }
        }

        const etichetta = type === 'status' ? (ETICHETTA_STATO[value] || value)
                        : type === 'priority' ? (ETICHETTA_PRIORITA[value] || value)
                        : value;
        return `<span style="background: ${bgColor}; color: ${color}; padding: 4px 10px; border-radius: 50px; font-size: 0.85rem; font-weight: 700; text-transform: uppercase;">${escapeHTML(etichetta || 'N/D')}</span>`;
    }

    async function loadArchivedReports(emergencyId) {
        const reportsSection = document.getElementById('archived-reports-section');
        const reportsTableBody = document.getElementById('archived-report-list-body');
        const emergencyDetailsDisplay = document.getElementById('emergency-details-display');

        if (!reportsTableBody || !reportsSection || !emergencyDetailsDisplay) return;

        if (!emergencyId || emergencyId === "") {
            reportsSection.style.display = 'none';
            reportsTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Seleziona un\'emergenza.</td></tr>';
            emergencyDetailsDisplay.textContent = '';
            return;
        }

        reportsSection.style.display = 'block';
        reportsTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Caricamento segnalazioni...</td></tr>';
        emergencyDetailsDisplay.textContent = '(ID Emergenza Selezionata: ' + emergencyId + ')';

        try {
            const apiUrl = '/api/reports?emergency_id=' + emergencyId + '&page=1&limit=1000&status_type=closed';
            const data = await fetchApi(apiUrl);
            reportsTableBody.innerHTML = '';

            if (data && data.reports && data.reports.length > 0) {
                 data.reports.forEach(report => {
                     const tr = document.createElement('tr');
                     tr.style.cursor = 'pointer';
                     tr.dataset.reportId = report.id;
                     
                     tr.addEventListener('click', (e) => {
                        // Impedisci al click del bottone "Stampa" di aprire anche il modale
                        if (e.target.closest('a.button-style')) return;
                        openArchivedDetailModal(e.currentTarget.dataset.reportId);
                     });

                     const displayValue = report.emergency_report_number ?? report.id;
                     const teamNames = Array.isArray(report.assigned_teams) && report.assigned_teams.length > 0 ? report.assigned_teams.map(t => t.nome).join(', ') : '-';
                     
                     tr.innerHTML = `
                        <td style="font-weight: 600; color: var(--info-text);">#${escapeHTML(displayValue)}</td>
                        <td>${escapeHTML(report.title || 'N/A')}</td>
                        <td>${getStatusBadgeHTML(report.status, 'status')}</td>
                        <td>${getStatusBadgeHTML(report.priority, 'priority')}</td>
                        <td><small>${escapeHTML(teamNames)}</small></td>
                        <td><small>${escapeHTML(formatDate(report.updated_at))}</small></td>
                        <td class="action-buttons" style="text-align: right;">
                            <a href="/print-report.html?id=${report.id}" target="_blank" class="button-style button-small" style="background: #64748b; color: white; border-radius: 50px; padding: 6px 12px; border: none; text-decoration: none;" title="Stampa Report #${escapeHTML(displayValue)}">
                                Stampa
                            </a>
                        </td>
                     `;

                     reportsTableBody.appendChild(tr);
                 });
            } else {
                 reportsTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Nessuna segnalazione trovata per questa emergenza.</td></tr>';
            }
        } catch (error) {
             reportsTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: red; padding: 20px;">Errore caricamento: ' + escapeHTML(error.message) + '</td></tr>';
        }
    }
    emergencySelect.addEventListener('change', (event) => {
        const selectedValue = event.target.value;
        const selectedIndex = event.target.selectedIndex;

        if (selectedValue && selectedValue !== "") {
            const selectedOption = event.target.options[selectedIndex];
            selectedArchivedEmergency = {
                id: selectedValue,
                code: selectedOption.dataset.code,
                name: selectedOption.dataset.name
            };
            emergencyDetailsDisplay.textContent = `(ID: ${selectedArchivedEmergency.id}, Codice: ${selectedArchivedEmergency.code})`;
            console.log("[Select Change] Emergenza selezionata:", selectedArchivedEmergency);
            loadArchivedReports(selectedArchivedEmergency.id);
            loadArchivedDocuments(selectedArchivedEmergency.id);
            // Il resoconto è un semplice file di testo servito dal backend:
            // basta un link, il cookie di sessione viaggia da solo.
            if (downloadResocontoLink) {
                downloadResocontoLink.href = `/api/admin/emergencies/${selectedArchivedEmergency.id}/resoconto`;
                downloadResocontoLink.title = `Scarica il resoconto testuale di ${selectedArchivedEmergency.code}`;
                downloadResocontoLink.style.display = 'inline-block';
            }
            if(deleteSelectedEmergencyBtn) deleteSelectedEmergencyBtn.style.display = 'inline-block';
        } else {
            // Se l'utente ha selezionato "-- Seleziona --"
            selectedArchivedEmergency = null;
            loadArchivedReports(null);
            loadArchivedDocuments(null);
            if(downloadResocontoLink) downloadResocontoLink.style.display = 'none';
            if(deleteSelectedEmergencyBtn) deleteSelectedEmergencyBtn.style.display = 'none';
        }
    });

    if (deleteSelectedEmergencyBtn) {
         deleteSelectedEmergencyBtn.addEventListener('click', async () => {
             if (!selectedArchivedEmergency || !selectedArchivedEmergency.id) {
                  notifica("Nessuna emergenza selezionata per l'eliminazione.", 'attenzione');
                  return;
             }

             const emergencyIdToDelete = selectedArchivedEmergency.id;
             const emergencyCodeToDelete = selectedArchivedEmergency.code;

             // Una conferma sola, che dice tutto: è irreversibile.
             if (!window.confirm(
                 `Eliminare per sempre l'emergenza ${emergencyCodeToDelete}?\n\n` +
                 `Segnalazioni, diari, immagini e documenti collegati vengono cancellati e non si recuperano.`
             )) return;

             console.log(`Richiesta eliminazione definitiva per emergenza ID: ${emergencyIdToDelete}`);
             deleteSelectedEmergencyBtn.disabled = true;
             deleteSelectedEmergencyBtn.textContent = 'Elimino...';

             try {
                  const result = await fetchApi(`/api/admin/emergencies/${emergencyIdToDelete}`, { method: 'DELETE' });

                  console.log("Risposta API eliminazione emergenza:", result);
                  notifica(result.message || `Emergenza ${emergencyCodeToDelete} eliminata con successo.`, 'successo');

                  loadClosedEmergencies();

             } catch (error) {
                  console.error(`Errore durante l'eliminazione dell'emergenza ${emergencyIdToDelete}:`, error);
                  notifica(`Errore eliminazione: ${error.message}`, 'errore');
                   // Riabilita il bottone in caso di errore
                   deleteSelectedEmergencyBtn.disabled = false;
                   deleteSelectedEmergencyBtn.innerHTML = '<i class="las la-trash-alt"></i> Elimina Selezionata';
             }
             // Non serve riabilitare il bottone in caso di successo, perché loadClosedEmergencies() lo nasconderà
         });
         console.log("Listener aggiunto a 'Elimina Emergenza Selezionata' button.");
    } else {
         console.warn("Pulsante #delete-selected-emergency-btn non trovato.");
    }

    document.addEventListener('ws:emergency_deleted', (event) => {
         const message = event.detail;
         console.log('Evento WS ricevuto: emergency_deleted', message);
         const deletedId = message?.deletedEmergencyId;

         if (deletedId) {
              console.log(`Emergenza ID ${deletedId} eliminata (notifica WS), aggiorno lista emergenze chiuse.`);
              // Se l'emergenza eliminata era quella attualmente selezionata, resetta la vista
              if (selectedArchivedEmergency && selectedArchivedEmergency.id == deletedId) {
                   loadArchivedReports(null);
                   emergencyDetailsDisplay.textContent = '';
                   if(deleteSelectedEmergencyBtn) deleteSelectedEmergencyBtn.style.display = 'none';
              }
              loadClosedEmergencies();
         }
    });

    const populateArchivedElement = (id, value, defaultValue = 'N/D') => {
         const element = archivedDetailModal.querySelector(`#${id}`);
         if (element) {
              element.textContent = value !== null && value !== undefined && String(value).trim() !== '' ? String(value) : defaultValue;
         } else { console.warn(`Elemento modale archivio non trovato: #${id}`); }
    };
    const formatArchivedDate = (dt) => dt ? new Date(dt).toLocaleString('it-IT', {dateStyle: 'medium', timeStyle: 'short'}) : 'N/D';
    const formatArchivedCoord = (c) => c !== null && c !== undefined ? parseFloat(c).toFixed(5) : 'N/D';

    // NUOVA Funzione per aprire e popolare il modale dettaglio
    async function openArchivedDetailModal(reportId) {
        if (!archivedDetailModal || !reportId) return;
        console.log(`Apertura dettagli per report archiviato ID: ${reportId}`);

        populateArchivedElement('archived-detail-report-id', reportId + ' (Caricamento...)');
        document.getElementById('archived-detail-main').querySelectorAll('span[id^="archived-detail-"]').forEach(span => span.textContent = '...');
         document.getElementById('archived-detail-image-gallery').innerHTML = '<span>Caricamento...</span>';
        document.getElementById('archived-log-list').innerHTML = '<li>Caricamento...</li>';

        archivedDetailModal.style.display = 'flex';

        try {
            const data = await fetchApi(`/api/reports/${reportId}`);
            if (!data || !data.report) throw new Error('Dati report non trovati.');
            const report = data.report;
            const displayValue = report.emergency_report_number ?? report.id;
            
            const updates = data.updates || [];

            populateArchivedElement('archived-detail-report-id', displayValue);
            populateArchivedElement('archived-detail-title', report.title);
            populateArchivedElement('archived-detail-reporter-name', report.reporter_name);
            populateArchivedElement('archived-detail-reporter-contact', report.reporter_contact);
            document.getElementById('archived-detail-status').innerHTML = getStatusBadgeHTML(report.status, 'status');
            document.getElementById('archived-detail-priority').innerHTML = getStatusBadgeHTML(report.priority, 'priority');
            populateArchivedElement('archived-detail-location', report.location_address);
            populateArchivedElement('archived-detail-coords', `Lat: ${formatArchivedCoord(report.latitude)} / Lon: ${formatArchivedCoord(report.longitude)}`);
            populateArchivedElement('archived-detail-description', report.description, 'Nessuna');
            populateArchivedElement('archived-detail-env-hazard', report.environmental_hazard, 'Nessuno specificato');
            populateArchivedElement('archived-detail-creator', `${report.creator_fullname || 'Sconosciuto'} il ${formatArchivedDate(report.created_at)}`);
            populateArchivedElement('archived-detail-updated-at', formatArchivedDate(report.updated_at));
            const teamNames = Array.isArray(report.assigned_teams) && report.assigned_teams.length > 0 ? report.assigned_teams.map(t => t.nome).join(', ') : 'Nessuna';
            populateArchivedElement('archived-detail-teams', teamNames);

             const imageGallery = document.getElementById('archived-detail-image-gallery');
             const imageSection = document.getElementById('archived-detail-images-section');
             if (imageGallery && imageSection) {
                  imageGallery.innerHTML = '';
                  if (Array.isArray(report.image_urls) && report.image_urls.length > 0) {
                      report.image_urls.forEach(imageUrl => {
                            try {
                                 const imgLink = document.createElement('a');
                                 imgLink.href = imageUrl;
                                 imgLink.target = '_blank';
                                 imgLink.rel = 'noopener noreferrer';

                                 const img = document.createElement('img');
                                 img.src = imageUrl;
                                 img.alt = 'Immagine allegata alla segnalazione ' + report.id;
                                 img.className = 'report-image-thumbnail';

                                 imgLink.appendChild(img);
                                 imageGallery.appendChild(imgLink);
                            } catch (imgErr) {
                                 console.error("Errore creazione anteprima per URL:", imageUrl, imgErr);
                            }
                       });
                      imageSection.style.display = 'block';
                  } else {
                       imageGallery.innerHTML = '<span>Nessuna immagine.</span>';
                       imageSection.style.display = 'block';
                  }
             }

             const logList = document.getElementById('archived-log-list');
             if (logList) {
                 logList.innerHTML = ''; 
                 if (Array.isArray(updates) && updates.length > 0) {
                      updates.forEach(update => {
                           try {
                                const li = document.createElement('li');

                                const p = document.createElement('p');
                                p.style.marginBottom = '2px';
                                p.textContent = update.update_text || ''; 

                                // FIX: Aggiunte variabili mancanti
                                const updaterName = update.updater_fullname || 'Sistema/Sconosciuto';
                                const updateDate = new Date(update.update_timestamp).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });

                                const small = document.createElement('small');
                                small.textContent = `Da: ${updaterName} - ${updateDate}`;
                                
                                li.appendChild(p);
                                li.appendChild(small);
                                
                                // FIX: Inserimento materiale nella lista
                                logList.appendChild(li);
                           } catch (logErr) {
                                 console.error('Errore creazione elemento log:', update, logErr);
                           }
                      });
                 } else {
                      logList.innerHTML = '<li>Nessun aggiornamento trovato.</li>';
                 }
             } else { console.warn("Elemento lista log (#archived-log-list) non trovato nel modale."); }

             if(archivedPrintLink) archivedPrintLink.href = `/print-report.html?id=${reportId}`;

        } catch (error) {
             console.error("Errore caricamento dettagli report archiviato:", error);
             document.getElementById('archived-detail-main').innerHTML = `<p style="color: red;">Errore caricamento: ${escapeHTML(error.message)}</p>`;
        }
    }

    // NUOVA Funzione per chiudere il modale dettaglio
    function closeArchivedDetailModal() {
         if (archivedDetailModal) archivedDetailModal.style.display = 'none';
    }

    // Aggiungi listener ai pulsanti chiusura modale
    if(closeArchivedDetailModalBtn) closeArchivedDetailModalBtn.addEventListener('click', closeArchivedDetailModal);
    if(cancelArchivedDetailModalBtn) cancelArchivedDetailModalBtn.addEventListener('click', closeArchivedDetailModal);

    loadClosedEmergencies();

});
