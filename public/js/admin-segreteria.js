let brandingSettings = {
    association_name: 'Segreteria',
    card_district_label: '',
    card_regional_entity_name: ''
};
let brandingLogos = { logo2Url: null };

// RECUPERO IMPOSTAZIONI BRANDING E LOGO
async function loadAndApplyBranding() {
    try {
        const settings = await fetchApi('/api/branding/settings');
        if (settings && settings.association_name) {
            brandingSettings.association_name = settings.association_name;
            brandingSettings.nome_associazione = settings.association_name;
            if (document.title.includes('-')) {
                const parts = document.title.split('-');
                document.title = `${parts[0].trim()} - ${settings.association_name}`;
            }
        }
        if (settings) {
            brandingSettings.card_district_label = settings.card_district_label || '';
            brandingSettings.card_regional_entity_name = settings.card_regional_entity_name || '';
        }

        const logoInfo = await fetchApi('/api/branding');
        if (logoInfo && logoInfo.logoUrl) {
            const logoImg = document.getElementById('main-app-logo');
            if (logoImg) logoImg.src = `${logoInfo.logoUrl}?v=${logoInfo.logoVersion}`;
        }
        if (logoInfo && logoInfo.logo2Url) {
            brandingLogos.logo2Url = `${logoInfo.logo2Url}?v=${logoInfo.logo2Version}`;
        }
    } catch (error) {
        console.error("Errore caricamento branding:", error);
    }
}

if (ruoliUtente().length > 0 && !haRuolo('segreteria')) {
    // Al centro operativo, non all'accesso: la sessione è buona, manca il ruolo.
    notifica('Questa pagina è riservata alla segreteria.', 'errore');
    window.location.href = '/centro-operativo.html';
}

document.addEventListener('DOMContentLoaded', async () => {
    // L'area Amministrazione è riservata all'admin: mostriamo il link solo a lui,
    // così un utente di segreteria non finisce su una pagina che gli viene negata.
    if (haRuolo('admin')) {
        const sidebarSettings = document.getElementById('sidebar-settings');
        if (sidebarSettings) sidebarSettings.style.display = 'block';
    }

    await loadAndApplyBranding();
    loadDashboardAlerts();
    loadUsers();
    
    const searchInput = document.getElementById('search-volunteer');
    const filterTable = () => {
        const term = searchInput.value.toLowerCase();
        const rows = document.querySelectorAll('#segreteria-users-table tr');
        rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(term) ? '' : 'none';
        });
    };
    searchInput.addEventListener('keyup', filterTable);
    document.getElementById('btn-search').addEventListener('click', filterTable);
    // GESTIONE MODALE
    const modal = document.getElementById('medical-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const coursesModal = document.getElementById('courses-modal');
    const closeCoursesBtn = document.querySelector('.close-modal-courses');
    
    // Chiude dal pulsante (X)
    closeModalBtn.onclick = () => {
        modal.style.display = 'none';
    };

    closeCoursesBtn.onclick = () => { 
        coursesModal.style.display = 'none'; 
    };
    
    // Chiude cliccando fuori dal modale
    window.onclick = (event) => {
        if (event.target == document.getElementById('medical-modal')) document.getElementById('medical-modal').style.display = 'none';
        if (event.target == coursesModal) coursesModal.style.display = 'none';
    };
});

window.catalogsData = window.catalogsData || { courses: [], medicalVisits: [] };

function autoCalculateExpiry(startDateInputId, selectId, catalogArray, targetExpiryInputId) {
    const startDateInput = document.getElementById(startDateInputId);
    const selectInput = document.getElementById(selectId);
    const targetInput = document.getElementById(targetExpiryInputId);

    if (!startDateInput || !selectInput || !targetInput) return;

    const startDateVal = startDateInput.value;
    const selectedId = selectInput.value;

    if (!startDateVal || !selectedId) return;

    // Trova l'oggetto nel catalogo
    const selectedItem = catalogArray.find(item => item.id == selectedId);
    
    if (selectedItem && selectedItem.validity_months) {
        // Forza la conversione in numero intero per evitare errori matematici
        const monthsToAdd = parseInt(selectedItem.validity_months, 10);
        if (!isNaN(monthsToAdd)) {
            const d = new Date(startDateVal);
            d.setMonth(d.getMonth() + monthsToAdd);
            targetInput.value = d.toISOString().split('T')[0];
        }
    } else {
        // Se è NULL (nessuna scadenza, es. Corso Base) svuota il campo
        targetInput.value = ''; 
    }
}

// Agganciamo i listener (sia al 'change' che all'input per sicurezza)
function setupExpiryListeners() {
    const events = ['input', 'change', 'blur']; 
    
    const attachListeners = (elementId, callback) => {
        const el = document.getElementById(elementId);
        if (el) events.forEach(evt => el.addEventListener(evt, callback));
    };

    // Corsi (Creazione)
    attachListeners('acquisition_date', () => autoCalculateExpiry('acquisition_date', 'course_id', window.catalogsData.courses, 'course_expiry_date'));
    attachListeners('course_id', () => autoCalculateExpiry('acquisition_date', 'course_id', window.catalogsData.courses, 'course_expiry_date'));

    // Visite (Creazione)
    attachListeners('last_visit_date', () => autoCalculateExpiry('last_visit_date', 'visit_type_id', window.catalogsData.medicalVisits, 'expiry_date'));
    attachListeners('visit_type_id', () => autoCalculateExpiry('last_visit_date', 'visit_type_id', window.catalogsData.medicalVisits, 'expiry_date'));
    
    // Visite (Modifica)
    attachListeners('edit_last_visit_date', () => autoCalculateExpiry('edit_last_visit_date', 'edit_visit_type_id', window.catalogsData.medicalVisits, 'edit_expiry_date'));
    attachListeners('edit_visit_type_id', () => autoCalculateExpiry('edit_last_visit_date', 'edit_visit_type_id', window.catalogsData.medicalVisits, 'edit_expiry_date'));
}

document.addEventListener('DOMContentLoaded', setupExpiryListeners);

// CARICAMENTO DASHBOARD ALLARMI
async function loadDashboardAlerts() {
    try {
        const response = await fetch('/api/admin/segreteria/dashboard');

        if (!response.ok) throw new Error('Errore nel caricamento dashboard');
        const data = await response.json();

        renderAlerts(data.expiring_medical, data.expired_courses);
    } catch (error) {
        console.error("Errore Dashboard:", error);
    }
}

function formatScadenza(dateString) {
    if (!dateString) return '<span style="color: var(--danger-text); font-weight: bold;">Mai effettuata</span>';
    
    const pureDate = dateString.split('T')[0];
    
    // Forziamo entrambe le date a mezzanotte spaccata locale
    const expDate = new Date(pureDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0,0,0,0);

    const diffTime = expDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    const formattedDate = expDate.toLocaleDateString('it-IT');
    
    if (diffDays < 0) {
        return `<span style="color: var(--danger-text); font-weight: bold;">Scaduto il ${formattedDate} (${Math.abs(diffDays)} gg fa)</span>`;
    } else if (diffDays === 0) {
        return `<span style="color: var(--danger-text); font-weight: bold;">Scade OGGI</span>`;
    } else {
        return `<span style="color: var(--warning-text); font-weight: bold;">Scade il ${formattedDate} (tra ${diffDays} gg)</span>`;
    }
}

function renderAlerts(medicalAlerts, coursesAlerts) {
    const container = document.getElementById('alerts-container');
    container.innerHTML = ''; 

    if (medicalAlerts.length === 0 && coursesAlerts.length === 0) return;

    const grid = document.createElement('div');
    grid.className = 'alerts-grid';
    container.appendChild(grid);

    if (medicalAlerts.length > 0) {
        const namesList = medicalAlerts.map(a => {
            const name = (a.nome && a.cognome)
                ? `${escapeHTML(a.nome)} ${escapeHTML(a.cognome)}`
                : `Volontario ID: ${escapeHTML(a.user_id || a.id)}`;
            const scadenzaInfo = formatScadenza(a.scadenza);
            
            return `<li style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div style="line-height: 1.4;">
                            <strong>${name}</strong><br>
                            <small>${scadenzaInfo}</small>
                        </div> 
                        <i class="fas fa-heartbeat" style="color: var(--danger-text); opacity: 0.7; font-size: 1.2rem; margin-top: 4px;"></i>
                    </li>`;
        }).join('');

        const alertBox = document.createElement('div');
        alertBox.className = 'modern-alert-card danger-alert';
        alertBox.innerHTML = `
            <div class="alert-card-header">
                <div class="alert-icon"><i class="fas fa-heartbeat"></i></div>
                <div class="alert-info">
                    <h3>Visite Mediche da Rinnovare</h3>
                    <p><strong>${medicalAlerts.length}</strong> volontari segnalati</p>
                </div>
            </div>
            <div class="alert-card-actions">
                <button class="btn-toggle-list" type="button">
                    Vedi dettagli
                </button>
                <ul class="alert-names-list">
                    ${namesList}
                </ul>
            </div>
        `;
        grid.appendChild(alertBox);
    }

    if (coursesAlerts.length > 0) {
        const namesList = coursesAlerts.map(a => {
            const name = (a.nome && a.cognome)
                ? `${escapeHTML(a.nome)} ${escapeHTML(a.cognome)}`
                : `Volontario ID: ${escapeHTML(a.user_id || a.id)}`;
            const scadenzaInfo = formatScadenza(a.scadenza);
            const extraInfo = a.corso_scaduto ? ` - <span style="color: var(--text-color);">${escapeHTML(a.corso_scaduto)}</span>` : '';
            
            return `<li style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div style="line-height: 1.4;">
                            <strong>${name}</strong><small style="font-weight: normal; opacity: 0.8;">${extraInfo}</small><br>
                            <small>${scadenzaInfo}</small>
                        </div> 
                        <i class="fas fa-graduation-cap" style="color: var(--warning-text); opacity: 0.7; font-size: 1.2rem; margin-top: 4px;"></i>
                    </li>`;
        }).join('');

        const alertBox = document.createElement('div');
        alertBox.className = 'modern-alert-card warning-alert';
        alertBox.innerHTML = `
            <div class="alert-card-header">
                <div class="alert-icon"><i class="fas fa-graduation-cap"></i></div>
                <div class="alert-info">
                    <h3>Corsi in Scadenza</h3>
                    <p><strong>${coursesAlerts.length}</strong> certificati da aggiornare</p>
                </div>
            </div>
            <div class="alert-card-actions">
                <button class="btn-toggle-list" type="button">
                    Vedi dettagli
                </button>
                <ul class="alert-names-list">
                    ${namesList}
                </ul>
            </div>
        `;
        grid.appendChild(alertBox);
    }

    const toggleButtons = container.querySelectorAll('.btn-toggle-list');
    toggleButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const list = e.currentTarget.nextElementSibling;
            if (list) list.classList.toggle('show');
        });
    });
}

// CARICAMENTO UTENTI NELLA TABELLA
async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users'); 
        if (response.status === 401 || response.status === 403) return window.location.href = '/login.html';
        if (!response.ok) throw new Error('Errore nel caricamento utenti');
        
        let users = await response.json();
        users = users.filter(u => u.is_active !== false && u.role !== 'esterno');

        const tbody = document.getElementById('segreteria-users-table');
        tbody.innerHTML = '';

        users.forEach(user => {
            const tr = document.createElement('tr');
            
            // RENDIAMO LA RIGA CLICCABILE E PIÙ ELEGANTE
            tr.style.cursor = 'pointer';
            tr.title = "Clicca per aprire il fascicolo completo";
            tr.addEventListener('click', () => showUserDetailView(user));
            // Effetto hover per far capire che è cliccabile (funziona se non c'è già nel CSS)
            tr.addEventListener('mouseenter', () => tr.style.backgroundColor = 'var(--list-item-hover-bg, rgba(0,0,0,0.02))');
            tr.addEventListener('mouseleave', () => tr.style.backgroundColor = '');

            const infoTd = document.createElement('td');
            infoTd.innerHTML = `<strong>${escapeHTML(user.nome)} ${escapeHTML(user.cognome)}</strong><br><small>${escapeHTML(user.username)}</small>`;
            tr.appendChild(infoTd);

            const statusTd = document.createElement('td');
            statusTd.innerHTML = '<span class="status-badge" style="background: rgba(100,116,139,0.1); color: #64748b;"><i class="fas fa-spinner fa-spin"></i> Verifica...</span>';
            tr.appendChild(statusTd);

            fetch(`/api/users/${user.id}/libretto`).then(res => res.json()).then(data => {
                const medRecords = Array.isArray(data.medical_records) ? data.medical_records : (data.medical_record ? [data.medical_record] : []);
                const hasValidMed = medRecords.some(m => 
                    m.visit_name && m.visit_name.toLowerCase() === 'visita di idoneità fisica' && 
                    m.status === 'Idoneo' && 
                    new Date(m.expiry_date).setHours(23,59,59,999) >= new Date().getTime()
                );
                
                const courses = data.courses || [];
                const hasValidCourse = courses.some(c => {
                    const isBaseCourse = c.name.trim().toLowerCase() === 'corso base sicurezza';
                    const isNotExpired = !c.expiry_date || new Date(c.expiry_date).setHours(23,59,59,999) >= new Date().getTime();
                    return isBaseCourse && isNotExpired;
                });

                if (hasValidMed && hasValidCourse) {
                    statusTd.innerHTML = '<span class="status-badge active"><i class="fas fa-check-circle"></i> Operativo</span>';
                } else if (!hasValidMed && !hasValidCourse) {
                    statusTd.innerHTML = '<span class="status-badge suspended"><i class="fas fa-times-circle"></i> Non Operativo</span>';
                } else if (!hasValidMed) {
                    statusTd.innerHTML = '<span class="status-badge suspended" style="background: var(--warning-soft-bg); color: var(--warning-text);"><i class="fas fa-heartbeat"></i> Rinnovo Visita</span>';
                } else {
                    statusTd.innerHTML = '<span class="status-badge suspended" style="background: var(--warning-soft-bg); color: var(--warning-text);"><i class="fas fa-hard-hat"></i> Corso Base Mancante</span>';
                }
            }).catch(() => {
                statusTd.innerHTML = '<span class="status-badge suspended">Errore dati</span>';
            });

            const arrowTd = document.createElement('td');
            arrowTd.style.textAlign = "right";
            arrowTd.innerHTML = '<i class="fas fa-chevron-right" style="color: var(--border-color, #ccc);"></i>';
            tr.appendChild(arrowTd);

            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Errore Tabella Utenti:', error);
    }
}
// LOGICA DEL MODALE VISITA MEDICA
async function openMedicalModal(userId, userName) {
    document.getElementById('medical-user-id').value = userId;
    document.getElementById('medical-user-name').innerText = `Fascicolo Sanitario: ${userName}`;
    document.getElementById('medical-form').reset();

    const ul = document.getElementById('user-medical-ul');
    ul.innerHTML = '<li>Caricamento in corso...</li>';

    try {
        window.catalogsData.medicalVisits = await fetchApi('/api/admin/medical-visit-types');
        const selectType = document.getElementById('visit_type_id');
        if (selectType) {
            selectType.innerHTML = '<option value="">-- Seleziona tipo --</option>';
            window.catalogsData.medicalVisits.forEach(v => {
                selectType.innerHTML += `<option value="${escapeHTML(v.id)}">${escapeHTML(v.name)}</option>`;
            });
        }
    } catch(e) { console.error("Errore catalogo visite", e); }

    try {
        const data = await fetchApi(`/api/users/${userId}/libretto`);
        ul.innerHTML = '';
        
        const records = Array.isArray(data.medical_records) ? data.medical_records : (data.medical_record ? [data.medical_record] : []);

        if (records.length > 0) {
            records.forEach(m => {
                const vDate = new Date(m.last_visit_date).toLocaleDateString('it-IT');
                const eDate = new Date(m.expiry_date).toLocaleDateString('it-IT');
                const statusText = m.status ? m.status.toUpperCase() : 'SCONOSCIUTO';
                let statusColor = m.status === 'Idoneo' ? '#10b981' : '#ef4444'; 
                if (new Date(m.expiry_date) < new Date()) statusColor = '#f59e0b'; 

                // Cerca il nome della visita dal catalogo (se presente)
                const visitTypeObj = window.catalogsData.medicalVisits.find(v => v.id == m.visit_type_id);
                const visitName = visitTypeObj ? visitTypeObj.name : 'Visita di idoneità fisica all\'impiego';

                const li = document.createElement('li');
                li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border-color, #eee);';

                const leftDiv = document.createElement('div');
                leftDiv.style.lineHeight = '1.5';
                leftDiv.innerHTML = `
                    <strong style="font-size: 1.05rem;">${escapeHTML(visitName)}</strong>
                    <div class="history-date-text">
                        Sostenuta il: <strong>${vDate}</strong> | Scade il: <strong>${eDate}</strong> 
                        <strong style="color:${statusColor}; margin-left: 8px;">[${escapeHTML(statusText)}]</strong>
                    </div>
                `;

                const rightDiv = document.createElement('div');
                rightDiv.style.cssText = 'display: flex; gap: 12px; align-items: center; justify-content: flex-end;';

                if (m.document_url) {
                    rightDiv.innerHTML += `<a href="${escapeHTML(m.document_url)}" target="_blank" class="btn-icon-action btn-view-record" title="Vedi certificato"><i class="fas fa-paperclip"></i></a>`;
                } else {
                    rightDiv.innerHTML += `<span style="display:inline-block; width:24px;"></span>`;
                }

                const editBtn = document.createElement('button');
                editBtn.type = 'button'; editBtn.className = 'btn-icon-action btn-edit-record';
                editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                editBtn.addEventListener('click', () => loadEditMedicalRecord(m, userId, userName));
                
                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button'; deleteBtn.className = 'btn-icon-action btn-delete-record';
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                deleteBtn.addEventListener('click', () => deleteMedicalRecord(m.id, userId, userName));

                rightDiv.appendChild(editBtn);
                rightDiv.appendChild(deleteBtn);
                li.appendChild(leftDiv); li.appendChild(rightDiv);
                ul.appendChild(li);
            });
        } else {
            ul.innerHTML = '<li>Nessuna visita registrata.</li>';
        }
    } catch (error) {
        ul.innerHTML = '<li>Errore nel caricamento.</li>';
    }

    document.getElementById('medical-modal').style.display = 'block';
}

async function deleteMedicalRecord(recordId, userId, userName) {
    if (!confirm("Sei sicuro di voler eliminare questa visita medica? Il certificato allegato verrà perso.")) return;
    
    try {
        const res = await fetch(`/api/admin/medical-records/${recordId}`, { method: 'DELETE' });
        if (res.ok) {
            notifica('Visita eliminata.', 'successo');
            loadDashboardAlerts();
            loadUsers();
        } else {
            notifica('Errore durante l\'eliminazione.', 'errore');
        }
    } catch (err) {
        notifica('Errore di connessione.', 'errore');
    }
}

// UPLOAD SICURO DEL CERTIFICATO
document.getElementById('medical-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const userId = document.getElementById('medical-user-id').value;
    const fileInput = document.getElementById('medical_document');
    const file = fileInput.files[0];

    const visitDate = new Date(document.getElementById('last_visit_date').value);
    const expDate = new Date(document.getElementById('expiry_date').value);
    
    if (visitDate >= expDate) {
        notifica("Errore logico: La data di visita deve essere antecedente alla data di scadenza.", 'errore');
        return;
    }

    if (file && file.size > 52428800) {
        notifica("Errore di Sicurezza: Il file supera i 50MB consentiti.", 'errore'); fileInput.value = ''; return;
    }

    const formData = new FormData();
    formData.append('visit_type_id', document.getElementById('visit_type_id').value);
    formData.append('last_visit_date', document.getElementById('last_visit_date').value);
    formData.append('expiry_date', document.getElementById('expiry_date').value);
    formData.append('status', document.getElementById('medical_status').value);
    if (file) formData.append('document', file); 

    try {
        const submitBtn = document.getElementById('medical-submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';

        const response = await fetch(`/api/admin/users/${userId}/medical-records`, { method: 'POST', body: formData });
        
        if (response.ok) {
            document.getElementById('medical-modal').style.display = 'none';
            loadDashboardAlerts(); 
            loadUsers();
        } else {
            const result = await response.json(); notifica(`Errore: ${result.message}`, 'errore');
        }
    } catch (error) { notifica("Errore di connessione al server.", 'errore');
    } finally {
        document.getElementById('medical-submit-btn').disabled = false;
        document.getElementById('medical-submit-btn').innerHTML = 'Salva';
    }
});

// LOGICA DEL MODALE CORSI
async function openCoursesModal(userId, userName) {
    document.getElementById('course-user-id').value = userId;
    document.getElementById('courses-user-name').innerText = `Fascicolo Formativo: ${userName}`;
    document.getElementById('course-form').reset();
    
    const coursesModal = document.getElementById('courses-modal');
    coursesModal.style.display = 'block';

    try {
        catalogsData.courses = await fetchApi('/api/admin/courses-catalog'); 
        catalogsData.courses.sort((a, b) => a.name.localeCompare(b.name));
        
        const select = document.getElementById('course_id');
        select.innerHTML = '<option value="">-- Seleziona un corso --</option>';
        catalogsData.courses.forEach(course => {
            select.innerHTML += `<option value="${escapeHTML(course.id)}">${escapeHTML(course.name)}</option>`;
        });

        const librettoRes = await fetch(`/api/users/${userId}/libretto`);
        const libretto = await librettoRes.json();
        
        const ul = document.getElementById('user-courses-ul');
        ul.innerHTML = '';
        if (libretto.courses && libretto.courses.length > 0) {
            libretto.courses.forEach(c => {
                const acqDate = new Date(c.acquisition_date).toLocaleDateString('it-IT');
                const expDate = c.expiry_date ? new Date(c.expiry_date).toLocaleDateString('it-IT') : 'Nessuna scadenza';
                
                // CREAZIONE SICURA DELL'ELEMENTO LISTA (Stile coerente con le visite)
                const li = document.createElement('li');
                li.style.display = 'flex';
                li.style.justifyContent = 'space-between';
                li.style.alignItems = 'center';
                li.style.padding = '12px 0';
                li.style.borderBottom = '1px solid var(--border-light-color)';

                // PARTE SINISTRA: Testi e Date
                const leftDiv = document.createElement('div');
                leftDiv.style.lineHeight = '1.4';
                leftDiv.innerHTML = `
                    <strong style="font-size: 1.05rem; color: var(--text-color);">${escapeHTML(c.name)}</strong>
                    <div class="history-date-text">
                        Acquisito il: <strong>${acqDate}</strong> | Scadenza: <strong>${expDate}</strong>
                    </div>
                `;

                // PARTE DESTRA
                const rightDiv = document.createElement('div');
                rightDiv.style.display = 'flex';
                rightDiv.style.gap = '12px';
                rightDiv.style.alignItems = 'center';

                if (c.document_url) {
                    const docLink = document.createElement('a');
                    docLink.href = c.document_url;
                    docLink.target = '_blank';
                    docLink.className = 'btn-icon-action btn-view-record';
                    docLink.title = 'Vedi attestato';
                    docLink.innerHTML = '<i class="fas fa-paperclip"></i>';
                    rightDiv.appendChild(docLink);
                } else {
                    const ghostSpan = document.createElement('span');
                    ghostSpan.style.display = 'inline-block'; ghostSpan.style.width = '24px';
                    rightDiv.appendChild(ghostSpan);
                }

                // Bottone Modifica
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'btn-icon-action btn-edit-record';
                editBtn.title = 'Modifica Corso';
                editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                editBtn.addEventListener('click', () => loadEditCourseRecord(c, userId, userName));
                rightDiv.appendChild(editBtn);

                // Bottone Elimina
                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'btn-icon-action btn-delete-record';
                deleteBtn.title = 'Elimina Corso';
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                deleteBtn.addEventListener('click', () => deleteCourseRecord(c.id, userId, userName));
                rightDiv.appendChild(deleteBtn);

                li.appendChild(leftDiv);
                li.appendChild(rightDiv);
                ul.appendChild(li);
            });
        } else {
            ul.innerHTML = '<li style="padding: 10px 0; color: var(--text-muted, #666);">Nessun corso registrato.</li>';
        }

    } catch (error) {
        console.error("Errore caricamento modale corsi:", error);
    }
}

// UPLOAD SICURO DEL CORSO E ATTESTATO
document.getElementById('course-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const userId = document.getElementById('course-user-id').value;
    const fileInput = document.getElementById('course_document');
    const file = fileInput.files[0];

    // SECURITY LATO CLIENT: Verifica peso file (50MB limit)
    if (file && file.size > 52428800) {
        notifica("Errore di Sicurezza: L'attestato supera i 50MB consentiti.", 'errore');
        fileInput.value = '';
        return;
    }

    const editVisitDate = new Date(document.getElementById('edit_last_visit_date').value);
    const editExpDate = new Date(document.getElementById('edit_expiry_date').value);
    
    if (editVisitDate >= editExpDate) {
        notifica("Errore logico: La data di visita deve essere antecedente alla data di scadenza.", 'errore');
        return;
    }

    const formData = new FormData();
    formData.append('course_id', document.getElementById('course_id').value);
    formData.append('acquisition_date', document.getElementById('acquisition_date').value);
    
    const expiry = document.getElementById('course_expiry_date').value;
    if (expiry) {
        formData.append('expiry_date', expiry);
    }
    
    if (file) {
        formData.append('document', file); 
    }

    try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrazione...';

        const response = await fetch(`/api/admin/users/${userId}/courses`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            document.getElementById('courses-modal').style.display = 'none';
            loadDashboardAlerts();
            loadUsers();
        } else {
            notifica(`Errore: ${result.message}`, 'errore');
        }
    } catch (error) {
        console.error('Errore durante upload corso:', error);
        notifica("Errore di connessione al server.", 'errore');
    } finally {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Registra il corso';
    }
});

async function loadEditMedicalRecord(record, userId, userName) {
    document.getElementById('medical-modal').style.display = 'none';

    document.getElementById('edit-medical-user-id').value = userId;
    document.getElementById('edit-medical-record-id').value = record.id;
    document.getElementById('medical-edit-user-name').innerText = `Volontario: ${userName}`;
    
    try {
        if (!window.catalogsData.medicalVisits || window.catalogsData.medicalVisits.length === 0) {
            window.catalogsData.medicalVisits = await fetchApi('/api/admin/medical-visit-types');
        }
        const selectType = document.getElementById('edit_visit_type_id');
        if (selectType && window.catalogsData.medicalVisits) {
            selectType.innerHTML = '<option value="">-- Seleziona tipo --</option>';
            window.catalogsData.medicalVisits.forEach(v => {
                selectType.innerHTML += `<option value="${escapeHTML(v.id)}">${escapeHTML(v.name)}</option>`;
            });
            if (record.visit_type_id) selectType.value = record.visit_type_id;
        }
    } catch(e) { console.error("Errore catalogo visite in modifica", e); }

    document.getElementById('edit_last_visit_date').value = new Date(record.last_visit_date).toISOString().split('T')[0];
    document.getElementById('edit_expiry_date').value = new Date(record.expiry_date).toISOString().split('T')[0];
    document.getElementById('edit_medical_status').value = record.status;
    document.getElementById('edit_medical_document').value = ''; 

    document.getElementById('medical-edit-modal').style.display = 'block';
    
    const docContainer = document.getElementById('edit-delete-doc-container');
    const deleteCheckbox = document.getElementById('edit_delete_document');
    if (deleteCheckbox) deleteCheckbox.checked = false;
    if (docContainer) docContainer.style.display = record.document_url ? 'block' : 'none';
}

// Chiude la Modifica e riapre il Fascicolo
const closeEditModal = () => {
    document.getElementById('medical-edit-modal').style.display = 'none';
    
    const userId = document.getElementById('edit-medical-user-id').value;
    const userName = document.getElementById('medical-edit-user-name').innerText.replace('Volontario: ', '');
};

// Eventi di chiusura Modale Modifica
document.getElementById('medical-edit-cancel-btn').addEventListener('click', closeEditModal);
document.querySelector('.close-edit-modal').addEventListener('click', closeEditModal);

document.getElementById('medical-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const recordId = document.getElementById('edit-medical-record-id').value;
    const fileInput = document.getElementById('edit_medical_document');
    const file = fileInput.files[0];

    if (file && file.size > 52428800) {
        notifica("Errore: Il file supera i 50MB consentiti.", 'errore'); fileInput.value = ''; return;
    }

    const formData = new FormData();
    formData.append('visit_type_id', document.getElementById('edit_visit_type_id').value);
    formData.append('last_visit_date', document.getElementById('edit_last_visit_date').value);
    formData.append('expiry_date', document.getElementById('edit_expiry_date').value);
    formData.append('status', document.getElementById('edit_medical_status').value);
    if (document.getElementById('edit_delete_document').checked) {
        formData.append('delete_document', 'true');
    }
    if (file) formData.append('document', file); 

    try {
        const submitBtn = document.getElementById('medical-edit-submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Salvataggio...';

        const response = await fetch(`/api/admin/medical-records/${recordId}`, { method: 'PUT', body: formData });
        
        if (response.ok) {
            // Se va a buon fine, chiudiamo e riapriamo il fascicolo
            closeEditModal(); 
            loadDashboardAlerts(); 
            loadUsers();
        } else {
            const result = await response.json(); notifica(`Errore: ${result.message}`, 'errore');
        }
    } catch (error) { notifica("Errore di connessione al server.", 'errore');
    } finally {
        document.getElementById('medical-edit-submit-btn').disabled = false;
        document.getElementById('medical-edit-submit-btn').innerHTML = 'Salva';
    }
});

// GESTIONE CATALOGO CORSI (Impostazioni)

const catalogModal = document.getElementById('catalog-modal');
const btnManageCatalog = document.getElementById('btn-manage-catalog');
const closeCatalogBtn = document.querySelector('.close-catalog-modal');

// Apri e Chiudi Modale
btnManageCatalog.addEventListener('click', (e) => {
    e.preventDefault(); 
    catalogModal.style.display = 'block';
    loadCatalogList();
});
closeCatalogBtn.addEventListener('click', () => catalogModal.style.display = 'none');
window.addEventListener('click', (e) => { if (e.target == catalogModal) catalogModal.style.display = 'none'; });

async function loadCatalogList() {
    const listUl = document.getElementById('catalog-courses-list');
    listUl.innerHTML = '<li style="padding: 10px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Caricamento...</li>';
    try {
        const catalog = await fetchApi('/api/admin/courses-catalog');
        listUl.innerHTML = '';
        
        catalog.forEach(course => {
            const li = document.createElement('li');
            li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-bottom: 1px solid var(--border-light-color);';
            const isSystemCourse = course.id === 1;
            
            const nameStyle = isSystemCourse ? 'font-weight: bold; color: var(--primary-color, #3b82f6);' : 'color: var(--text-color);';
            const badge = isSystemCourse ? '<span style="font-size:0.7rem; background: var(--info-soft-bg); color:#0284c7; padding:2px 6px; border-radius:10px; margin-left:8px;">Sistema</span>' : '';
            
            const validityText = course.validity_months ? `<small style="color: var(--text-muted); display: block;">Validità: ${course.validity_months} mesi</small>` : '<small style="color: var(--text-muted); display: block;">Nessuna scadenza</small>';
            const codeBadge = course.course_code ? `<span style="font-size:0.7rem; background: var(--secondary-bg-color); border: 1px solid var(--border-color); padding:2px 6px; border-radius:4px; margin-right:8px; font-family: monospace;">${escapeHTML(course.course_code)}</span>` : '';

            li.innerHTML = `<div><span style="${nameStyle}">${codeBadge}${escapeHTML(course.name)} ${badge}</span>${validityText}</div>`;

            // Contenitore Pulsanti Azione
            const actionsDiv = document.createElement('div');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '10px';

            // Bottone Edit (Sempre Abilitato, anche per ID 1)
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-icon-action btn-edit-record';
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.title = 'Modifica Corso';
            editBtn.addEventListener('click', () => openCatalogEditModal(course));
            actionsDiv.appendChild(editBtn);

            // Bottone Delete (Disabilitato per ID 1)
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-icon-action btn-delete-record';
            if (isSystemCourse) {
                deleteBtn.innerHTML = '<i class="fas fa-lock" style="color: #cbd5e1; cursor: not-allowed;"></i>'; 
                deleteBtn.disabled = true;
                deleteBtn.title = 'Ineliminabile (Corso di Sistema)';
            } else {
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                deleteBtn.title = 'Elimina Corso';
                deleteBtn.addEventListener('click', async () => {
                    try {
                        await fetchApi(`/api/admin/courses-catalog/${course.id}`, { method: 'DELETE' });
                        loadCatalogList();
                    } catch (error) { 
                        notifica(`Impossibile eliminare:\n${error.message}`, 'errore'); 
                    }
                });
            }
            actionsDiv.appendChild(deleteBtn);

            li.appendChild(actionsDiv);
            listUl.appendChild(li);
        });
    } catch (error) { listUl.innerHTML = '<li style="padding: 10px; color: red;">Errore caricamento.</li>'; }
}

// LOGICA MODALE MODIFICA CATALOGO
const catalogEditModal = document.getElementById('catalog-edit-modal');
const closeCatalogEditBtn = document.querySelector('.close-catalog-edit-modal');

closeCatalogEditBtn.addEventListener('click', () => catalogEditModal.style.display = 'none');

function openCatalogEditModal(course) {
    document.getElementById('edit_catalog_course_id').value = course.id;
    const nameInput = document.getElementById('edit_catalog_course_name');
    nameInput.value = course.name;
    
    // Se è il corso ID 1, blocca il nome
    if (course.id === 1) {
        nameInput.readOnly = true;
        nameInput.style.opacity = '0.7';
        nameInput.title = 'Il nome del corso di sistema non è modificabile.';
    } else {
        nameInput.readOnly = false;
        nameInput.style.opacity = '1';
        nameInput.title = '';
    }

    document.getElementById('edit_catalog_course_code').value = course.course_code || '';
    document.getElementById('edit_catalog_course_validity').value = course.validity_months || '';
    
    catalogEditModal.style.display = 'block';
}

document.getElementById('catalog-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit_catalog_course_id').value;
    const name = document.getElementById('edit_catalog_course_name').value;
    const course_code = document.getElementById('edit_catalog_course_code').value;
    const validity_months = document.getElementById('edit_catalog_course_validity').value;

    try {
        await fetchApi(`/api/admin/courses-catalog/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name, validity_months, course_code })
        });
        catalogEditModal.style.display = 'none';
        loadCatalogList();
    } catch (error) { 
        notifica(`Errore: ${error.message}`, 'errore'); 
    }
});

// Aggiungi un nuovo corso
document.getElementById('catalog-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const course_code = document.getElementById('new_course_code').value;
    const name = document.getElementById('new_course_name').value;
    const validity_months = document.getElementById('new_course_validity').value;

    try {
        await fetchApi('/api/admin/courses-catalog', {
            method: 'POST',
            body: JSON.stringify({ name, validity_months, course_code })
        });
        document.getElementById('new_course_code').value = ''; 
        document.getElementById('new_course_name').value = ''; 
        document.getElementById('new_course_validity').value = ''; 
        loadCatalogList();
        
    } catch (error) { 
        notifica(`Errore: ${error.message}`, 'errore'); 
    }
});

// Apri Modale Modifica Corso
function loadEditCourseRecord(course, userId, userName) {
    document.getElementById('courses-modal').style.display = 'none';

    document.getElementById('edit-course-user-id').value = userId;
    document.getElementById('edit-course-record-id').value = course.id;
    document.getElementById('course-edit-user-name').innerText = `Volontario: ${userName}`;
    
    document.getElementById('edit_course_name').value = course.name;
    document.getElementById('edit_acquisition_date').value = new Date(course.acquisition_date).toISOString().split('T')[0];
    document.getElementById('edit_course_expiry_date').value = course.expiry_date ? new Date(course.expiry_date).toISOString().split('T')[0] : '';
    document.getElementById('edit_course_document').value = '';

    const docContainer = document.getElementById('edit-delete-course-doc-container');
    const deleteCheckbox = document.getElementById('edit_delete_course_document');
    deleteCheckbox.checked = false;
    
    docContainer.style.display = course.document_url ? 'block' : 'none';
    document.getElementById('course-edit-modal').style.display = 'block';
}

// Chiudi Modale Modifica Corso
const closeEditCourseModal = () => {
    document.getElementById('course-edit-modal').style.display = 'none';
    const userId = document.getElementById('edit-course-user-id').value;
    const userName = document.getElementById('course-edit-user-name').innerText.replace('Volontario: ', '');
};

document.getElementById('course-edit-cancel-btn').addEventListener('click', closeEditCourseModal);
document.querySelector('.close-edit-course-modal').addEventListener('click', closeEditCourseModal);

document.getElementById('course-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const recordId = document.getElementById('edit-course-record-id').value;
    const fileInput = document.getElementById('edit_course_document');
    const file = fileInput.files[0];

    if (file && file.size > 52428800) {
        notifica("Errore: Il file supera i 50MB consentiti.", 'errore'); fileInput.value = ''; return;
    }

    const formData = new FormData();
    formData.append('acquisition_date', document.getElementById('edit_acquisition_date').value);
    
    const expDate = document.getElementById('edit_course_expiry_date').value;
    if (expDate) formData.append('expiry_date', expDate);
    
    if (document.getElementById('edit_delete_course_document').checked) formData.append('delete_document', 'true');
    if (file) formData.append('document', file); 

    try {
        const submitBtn = document.getElementById('course-edit-submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Salvataggio...';

        const response = await fetch(`/api/admin/courses/${recordId}`, { method: 'PUT', body: formData });
        
        if (response.ok) {
            closeEditCourseModal(); 
            loadDashboardAlerts(); 
            loadUsers();
        } else {
            const result = await response.json(); notifica(`Errore: ${result.message}`, 'errore');
        }
    } catch (error) { notifica("Errore di connessione.", 'errore');
    } finally {
        document.getElementById('course-edit-submit-btn').disabled = false;
        document.getElementById('course-edit-submit-btn').innerHTML = 'Salva';
    }
});

// Elimina Corso (DELETE)
async function deleteCourseRecord(recordId, userId, userName) {
    if (!confirm("Sei sicuro di voler eliminare questo corso dal fascicolo? L'attestato verrà perso definitivamente.")) return;
    
    try {
        const res = await fetch(`/api/admin/courses/${recordId}`, { method: 'DELETE' });
        if (res.ok) {
            loadDashboardAlerts();
            loadUsers();
        } else {
            notifica('Errore durante l\'eliminazione.', 'errore');
        }
    } catch (err) {
        notifica('Errore di connessione.', 'errore');
    }
}

const FOTO_VUOTA = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

function mostraFotoDettaglio(url) {
    document.getElementById('detail-user-photo').src = url || FOTO_VUOTA;
}

function mostraQrDettaglio(token) {
    const qrContainer = document.getElementById('detail-qrcode-container');
    qrContainer.innerHTML = '';
    // QR spenti dall'amministrazione: niente riquadro e niente "Rigenera".
    document.getElementById('blocco-qr-dettaglio').hidden = !token;
    const rigenera = document.getElementById('btn-rigenera-qr');
    if (rigenera) rigenera.hidden = !token;
    if (!token) return;
    new QRCode(qrContainer, {
        text: `${window.location.origin}/badge.html?token=${token}`,
        width: 140, height: 140, colorDark : "#1e293b", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.H
    });
}

// La foto la cambia anche la segreteria: è lei che stampa il tesserino.
document.getElementById('detail-photo-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !currentUserViewId) return;
    if (file.size > 5 * 1024 * 1024) return notifica('La foto non può superare i 5MB.', 'errore');
    const dati = new FormData();
    dati.append('photo', file);
    try {
        const esito = await fetchApi(`/api/admin/users/${currentUserViewId}/photo`, { method: 'POST', body: dati });
        currentUserViewData.photo_url = esito.photo_url;
        mostraFotoDettaglio(`${esito.photo_url}?v=${Date.now()}`);
    } catch (err) {
        notifica(`Foto non caricata: ${err.message}`, 'errore');
    }
});

let currentUserViewId = null;
let currentUserViewName = null;
let currentUserViewData = null;
let currentLibrettoViewData = null;

const mainView = document.getElementById('main-dashboard-view');
const detailView = document.getElementById('user-detail-view');
const btnBack = document.getElementById('btn-back-to-list');

// Tasto Indietro
btnBack.addEventListener('click', () => {
    detailView.style.display = 'none';
    mainView.style.display = 'block';
    currentUserViewId = null;
    loadDashboardAlerts();
    loadUsers();
});

// Apre la schermata dell'utente
async function showUserDetailView(user) {
    currentUserViewId = user.id;
    currentUserViewName = `${user.nome} ${user.cognome}`;
    currentUserViewData = user;

    document.getElementById('detail-user-name').textContent = currentUserViewName;
    document.getElementById('detail-user-role').textContent = user.role;
    document.getElementById('detail-user-username').textContent = user.username;
    document.getElementById('detail-user-cf').textContent = user.codice_fiscale || 'Non inserito';
    document.getElementById('detail-user-phone').textContent = user.telefono || 'Non inserito';
    
    // Foto e QR non stanno nell'elenco degli utenti: si leggono qui, per
    // questa persona sola.
    const qrContainer = document.getElementById('detail-qrcode-container');
    qrContainer.innerHTML = '<span style="color: var(--text-muted); font-size:0.8rem;">Caricamento...</span>';
    mostraFotoDettaglio(user.photo_url);
    try {
        const tesserino = await fetchApi(`/api/admin/users/${user.id}/tesserino`);
        if (currentUserViewId !== user.id) return;
        Object.assign(currentUserViewData, { photo_url: tesserino.photo_url, public_token: tesserino.public_token, qr_attivo: tesserino.qr_attivo !== false });
        mostraFotoDettaglio(tesserino.photo_url);
        mostraQrDettaglio(tesserino.public_token);
    } catch (e) {
        qrContainer.innerHTML = `<span style="color: var(--danger-text); font-size:0.8rem;">${escapeHTML(e.message)}</span>`;
    }

    mainView.style.display = 'none';
    detailView.style.display = 'block';

    await refreshUserDetailLists();
}

function getStatusBadge(expiryDateStr) {
    if (!expiryDateStr) return '<span class="status-badge active" style="background: var(--info-soft-bg); color:#0284c7; border:none; margin-top:5px;">Senza Scadenza</span>';
    const diffDays = Math.round((new Date(expiryDateStr).getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return '<span class="status-badge suspended" style="background: var(--danger-soft-bg); color: var(--danger-text); border:none; margin-top:5px;">Scaduto</span>';
    if (diffDays <= 30) return '<span class="status-badge warning" style="background: var(--warning-soft-bg); color: var(--warning-text); border:none; margin-top:5px;">In Scadenza</span>';
    return '<span class="status-badge active" style="background: var(--success-soft-bg); color: var(--success-text); border:none; margin-top:5px;">Valido</span>';
}

async function refreshUserDetailLists() {
    if (!currentUserViewId) return;

    const medList = document.getElementById('detail-medical-list');
    const courseList = document.getElementById('detail-courses-list');
    
    medList.innerHTML = '<li style="justify-content:center;"><i class="fas fa-spinner fa-spin"></i> Caricamento...</li>';
    courseList.innerHTML = '<li style="justify-content:center;"><i class="fas fa-spinner fa-spin"></i> Caricamento...</li>';

    try {
        const data = await fetchApi(`/api/users/${currentUserViewId}/libretto`);
        currentLibrettoViewData = data;
        medList.innerHTML = '';
        const rawMedical = Array.isArray(data.medical_records) ? data.medical_records : (data.medical_record ? [data.medical_record] : []);
        
        // Raggruppamento: la prima visita che incontriamo per ogni tipo è quella "Attiva", le altre sono "Storico"
        const seenMedTypes = new Set();
        const medicalRecords = rawMedical.map(m => {
            const isLatest = !seenMedTypes.has(m.visit_type_id);
            if (isLatest) seenMedTypes.add(m.visit_type_id);
            return { ...m, isLatest };
        });
        
        if (medicalRecords.length > 0) {
            medicalRecords.forEach(m => {
                const visitDate = new Date(m.last_visit_date).toLocaleDateString('it-IT');
                const expDate = new Date(m.expiry_date).toLocaleDateString('it-IT');
                const badge = m.isLatest ? getStatusBadge(m.expiry_date) : '<span class="status-badge" style="background:#f1f5f9; color:#64748b; border:none; margin-top:5px;"><i class="fas fa-archive"></i> Storico</span>';

                const visitTypeObj = window.catalogsData?.medicalVisits?.find(v => v.id == m.visit_type_id);
                const visitName = visitTypeObj ? visitTypeObj.name : m.status;

                const li = document.createElement('li');
                li.style.borderBottom = '1px solid var(--border-light-color)';
                li.style.display = 'flex';
                li.style.justifyContent = 'space-between';
                li.style.padding = '12px 0';
                if (!m.isLatest) li.style.opacity = '0.6';
                
                const leftDiv = document.createElement('div');
                leftDiv.style.lineHeight = '1.4';
                leftDiv.innerHTML = `
                    <strong style="color: var(--text-color); font-size: 1.05rem;">Visita: ${escapeHTML(visitName)}</strong>
                    <div class="history-date-text">Data: ${visitDate} | Scade: <strong>${expDate}</strong></div>
                    ${badge}
                `;
                
                const rightDiv = document.createElement('div');
                rightDiv.style.display = 'flex';
                rightDiv.style.gap = '8px';
                rightDiv.style.alignItems = 'center';
                
                if (m.document_url) {
                    rightDiv.innerHTML += `<a href="${escapeHTML(m.document_url)}" target="_blank" class="btn-icon-action btn-view-record" title="Apri Certificato"><i class="fas fa-paperclip"></i></a>`;
                }

                // Tasto RINNOVA (Solo per l'ultimo record valido)
                if (m.isLatest) {
                    const renewBtn = document.createElement('button');
                    renewBtn.className = 'btn-icon-action';
                    renewBtn.style.color = '#f59e0b';
                    renewBtn.title = 'Rinnova Visita (Nuovo Record)';
                    renewBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
                    renewBtn.addEventListener('click', () => {
                        document.getElementById('btn-add-medical').click();
                        setTimeout(() => document.getElementById('visit_type_id').value = m.visit_type_id, 300);
                    });
                    rightDiv.appendChild(renewBtn);
                }

                const editBtn = document.createElement('button');
                editBtn.className = 'btn-icon-action btn-edit-record';
                editBtn.title = 'Modifica Dati Esistenti';
                editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                editBtn.addEventListener('click', () => loadEditMedicalRecord(m, currentUserViewId, currentUserViewName));

                const delBtn = document.createElement('button');
                delBtn.className = 'btn-icon-action btn-delete-record';
                delBtn.title = 'Elimina';
                delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                delBtn.addEventListener('click', () => deleteMedicalRecord(m.id, currentUserViewId, currentUserViewName));

                rightDiv.appendChild(editBtn);
                rightDiv.appendChild(delBtn);
                li.appendChild(leftDiv);
                li.appendChild(rightDiv);
                medList.appendChild(li);
            });
        } else {
            medList.innerHTML = '<li style="color: var(--text-muted); justify-content:center; padding: 12px 0;">Nessuna visita registrata.</li>';
        }

        courseList.innerHTML = '';
        const rawCourses = data.courses || [];
        
        // Raggruppamento Corsi
        const seenCourseTypes = new Set();
        const courses = rawCourses.map(c => {
            const isLatest = !seenCourseTypes.has(c.course_id);
            if (isLatest) seenCourseTypes.add(c.course_id);
            return { ...c, isLatest };
        });

        if (courses.length > 0) {
            courses.forEach(c => {
                const acqDate = new Date(c.acquisition_date).toLocaleDateString('it-IT');
                const expDate = c.expiry_date ? new Date(c.expiry_date).toLocaleDateString('it-IT') : 'Nessuna';
                const badge = c.isLatest ? getStatusBadge(c.expiry_date) : '<span class="status-badge" style="background:#f1f5f9; color:#64748b; border:none; margin-top:5px;"><i class="fas fa-archive"></i> Storico</span>';

                const li = document.createElement('li');
                li.style.borderBottom = '1px solid var(--border-light-color)';
                li.style.display = 'flex';
                li.style.justifyContent = 'space-between';
                li.style.padding = '12px 0';
                if (!c.isLatest) li.style.opacity = '0.6';
                
                const leftDiv = document.createElement('div');
                leftDiv.style.lineHeight = '1.4';
                leftDiv.innerHTML = `
                    <strong style="color: var(--text-color); font-size: 1.05rem;">${escapeHTML(c.name)}</strong>
                    <div class="history-date-text">Acquisito: ${acqDate} | Scade: <strong>${expDate}</strong></div>
                    ${badge}
                `;
                
                const rightDiv = document.createElement('div');
                rightDiv.style.display = 'flex';
                rightDiv.style.gap = '8px';
                rightDiv.style.alignItems = 'center';

                if (c.document_url) {
                    rightDiv.innerHTML += `<a href="${escapeHTML(c.document_url)}" target="_blank" class="btn-icon-action btn-view-record" title="Apri Attestato"><i class="fas fa-paperclip"></i></a>`;
                }

                // Tasto RINNOVA
                if (c.isLatest) {
                    const renewBtn = document.createElement('button');
                    renewBtn.className = 'btn-icon-action';
                    renewBtn.style.color = '#8b5cf6';
                    renewBtn.title = 'Rinnova Corso (Nuovo Record)';
                    renewBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
                    renewBtn.addEventListener('click', () => {
                        document.getElementById('btn-add-course').click();
                        setTimeout(() => document.getElementById('course_id').value = c.course_id, 300);
                    });
                    rightDiv.appendChild(renewBtn);
                }

                const editBtn = document.createElement('button');
                editBtn.className = 'btn-icon-action btn-edit-record';
                editBtn.title = 'Modifica Dati Esistenti';
                editBtn.innerHTML = '<i class="fas fa-edit"></i>';
                editBtn.addEventListener('click', () => loadEditCourseRecord(c, currentUserViewId, currentUserViewName));

                const delBtn = document.createElement('button');
                delBtn.className = 'btn-icon-action btn-delete-record';
                delBtn.title = 'Elimina';
                delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                delBtn.addEventListener('click', () => deleteCourseRecord(c.id, currentUserViewId, currentUserViewName));

                rightDiv.appendChild(editBtn);
                rightDiv.appendChild(delBtn);
                li.appendChild(leftDiv);
                li.appendChild(rightDiv);
                courseList.appendChild(li);
            });
        } else {
            courseList.innerHTML = '<li style="color: var(--text-muted); justify-content:center; padding: 12px 0;">Nessun corso registrato.</li>';
        }

        // I DPI, con la stessa funzione del profilo del volontario.
        const cardDpi = document.getElementById('card-dpi-volontario');
        if (cardDpi) {
            cardDpi.hidden = !data.magazzino_attivo;
            if (data.magazzino_attivo) {
                disegnaDpiInDotazione(document.getElementById('detail-dpi-list'), data.equipment);
                // Le consegne si registrano dal magazzino, non da qui: il
                // collegamento porta già sulla persona giusta.
                const vai = document.getElementById('btn-vai-magazzino');
                if (vai) vai.href = `/magazzino.html?persona=${currentUserViewId}`;
            }
        }

    } catch (error) {
        console.error("Errore ricaricamento liste dettaglio:", error);
    }
}

// Bottone Aggiungi Visita (nella vista dettaglio)
document.getElementById('btn-add-medical').addEventListener('click', async () => {
    document.getElementById('medical-user-id').value = currentUserViewId;
    document.getElementById('medical-user-name').innerText = `Nuova Visita: ${currentUserViewName}`;
    document.getElementById('medical-form').reset();
    document.getElementById('current-medical-list').style.display = 'none'; 

    // FIX: Scarichiamo il catalogo e lo salviamo nella memoria globale
    try {
        window.catalogsData.medicalVisits = await fetchApi('/api/admin/medical-visit-types');
        const selectType = document.getElementById('visit_type_id');
        if (selectType) {
            selectType.innerHTML = '<option value="">-- Seleziona tipo --</option>';
            window.catalogsData.medicalVisits.forEach(v => {
                selectType.innerHTML += `<option value="${escapeHTML(v.id)}">${escapeHTML(v.name)}</option>`;
            });
        }
    } catch(e) { console.error("Errore caricamento tipi visita", e); }

    document.getElementById('medical-modal').style.display = 'block';
});

// Bottone Aggiungi Corso (nella vista dettaglio)
document.getElementById('btn-add-course').addEventListener('click', async () => {
    document.getElementById('course-user-id').value = currentUserViewId;
    document.getElementById('courses-user-name').innerText = `Nuovo Corso: ${currentUserViewName}`;
    document.getElementById('course-form').reset();
    document.getElementById('current-courses-list').style.display = 'none'; 
    
    // FIX: Usiamo fetchApi e salviamo nella memoria globale per il calcolo delle date!
    try {
        window.catalogsData.courses = await fetchApi('/api/admin/courses-catalog');
        const select = document.getElementById('course_id');
        select.innerHTML = '<option value="">-- Seleziona un corso --</option>';
        window.catalogsData.courses.forEach(c => {
            select.innerHTML += `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`;
        });
    } catch(e) { console.error("Errore caricamento corsi", e); }

    document.getElementById('courses-modal').style.display = 'block';
});

// Intercettiamo i submit dei modali per ricaricare la pagina dinamica
document.getElementById('medical-form').addEventListener('submit', function() {
    setTimeout(() => { if (currentUserViewId) refreshUserDetailLists(); }, 500);
});
document.getElementById('course-form').addEventListener('submit', function() {
    setTimeout(() => { if (currentUserViewId) refreshUserDetailLists(); }, 500);
});
document.getElementById('medical-edit-form').addEventListener('submit', function() {
    setTimeout(() => { if (currentUserViewId) refreshUserDetailLists(); }, 500);
});
document.getElementById('course-edit-form').addEventListener('submit', function() {
    setTimeout(() => { if (currentUserViewId) refreshUserDetailLists(); }, 500);
});

// Sovrascriviamo le funzioni di eliminazione (già esistenti) per fare il refresh automatico
const originalDeleteMedical = deleteMedicalRecord;
deleteMedicalRecord = async function(recordId, userId, userName) {
    await originalDeleteMedical(recordId, userId, userName);
    if (currentUserViewId === userId) refreshUserDetailLists();
};

const originalDeleteCourse = deleteCourseRecord;
deleteCourseRecord = async function(recordId, userId, userName) {
    await originalDeleteCourse(recordId, userId, userName);
    if (currentUserViewId === userId) refreshUserDetailLists();
};

const medCatalogModal = document.getElementById('medical-catalog-modal');
const btnManageMedCatalog = document.getElementById('btn-manage-medical-catalog');
const closeMedCatalogBtn = document.querySelector('.close-medical-catalog-modal');

// Apri e Chiudi Modale Visite
if (btnManageMedCatalog) {
    btnManageMedCatalog.addEventListener('click', (e) => {
        e.preventDefault(); 
        medCatalogModal.style.display = 'block';
        loadMedicalCatalogList();
    });
}
if (closeMedCatalogBtn) closeMedCatalogBtn.addEventListener('click', () => medCatalogModal.style.display = 'none');
window.addEventListener('click', (e) => { if (e.target == medCatalogModal) medCatalogModal.style.display = 'none'; });

async function loadMedicalCatalogList() {
    const listUl = document.getElementById('catalog-medical-list');
    listUl.innerHTML = '<li style="padding: 10px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Caricamento...</li>';
    try {
        const catalog = await fetchApi('/api/admin/medical-visit-types');
        listUl.innerHTML = '';

        catalog.forEach(visit => {
            const li = document.createElement('li');
            li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-bottom: 1px solid var(--border-light-color);';
            const isSystemVisit = visit.name.toLowerCase() === 'visita di idoneità fisica';
            const nameStyle = isSystemVisit ? 'font-weight: bold; color: var(--success-text);' : 'color: var(--text-color);';
            const badge = isSystemVisit ? '<span style="font-size:0.7rem; background: var(--success-soft-bg); color: var(--success-text); padding:2px 6px; border-radius:10px; margin-left:8px;">Base</span>' : '';
            const validityText = visit.validity_months ? `<small style="color: var(--text-muted); display: block;">Validità: ${visit.validity_months} mesi</small>` : '<small style="color: var(--text-muted); display: block;">Nessuna scadenza</small>';

            li.innerHTML = `<div><span style="${nameStyle}">${escapeHTML(visit.name)} ${badge}</span>${validityText}</div>`;

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button'; deleteBtn.className = 'btn-icon-action btn-delete-record';
            if (isSystemVisit) {
                deleteBtn.innerHTML = '<i class="fas fa-lock" style="color: #cbd5e1; cursor: not-allowed;"></i>'; deleteBtn.disabled = true;
            } else {
                deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
                deleteBtn.addEventListener('click', async () => {
                    try {
                        await fetchApi(`/api/admin/medical-visit-types/${visit.id}`, { method: 'DELETE' });
                        loadMedicalCatalogList();
                    } catch (error) { 
                        notifica(`Impossibile eliminare:\n${error.message}`, 'errore'); 
                    }
                });
            }
            li.appendChild(deleteBtn);
            listUl.appendChild(li);
        });
    } catch (error) { listUl.innerHTML = '<li style="padding: 10px; color: red;">Errore caricamento.</li>'; }
}

// Aggiungi Nuova Visita al Catalogo
document.getElementById('medical-catalog-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new_visit_name').value;
    const validity_months = document.getElementById('new_visit_validity').value;
    
    try {
        await fetchApi('/api/admin/medical-visit-types', {
            method: 'POST',
            body: JSON.stringify({ name, validity_months })
        });
        
        document.getElementById('new_visit_name').value = ''; 
        document.getElementById('new_visit_validity').value = ''; 
        loadMedicalCatalogList(); 
        
    } catch (error) { 
        notifica(`Errore: ${error.message}`, 'errore'); 
    }
});

// GESTIONE ANAGRAFICA
const anagraficaModal = document.getElementById('anagrafica-modal');

document.getElementById('btn-edit-anagrafica').addEventListener('click', () => {
    document.getElementById('anagrafica-user-name').textContent = currentUserViewName;
    
    // Precompila con i dati attuali letti dall'interfaccia
    const currentCF = document.getElementById('detail-user-cf').textContent;
    const currentPhone = document.getElementById('detail-user-phone').textContent;
    
    document.getElementById('edit_cf').value = currentCF !== 'Non inserito' ? currentCF : '';
    document.getElementById('edit_telefono').value = currentPhone !== 'Non inserito' ? currentPhone : '';
    
    anagraficaModal.style.display = 'block';
});

document.querySelector('.close-anagrafica-modal').addEventListener('click', () => {
    anagraficaModal.style.display = 'none';
});

document.getElementById('anagrafica-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const codice_fiscale = document.getElementById('edit_cf').value;
    const telefono = document.getElementById('edit_telefono').value;
    const btn = document.getElementById('anagrafica-submit-btn');

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';

        const res = await fetchApi(`/api/admin/users/${currentUserViewId}/anagrafica`, {
            method: 'PUT',
            body: JSON.stringify({ codice_fiscale, telefono })
        });

        document.getElementById('detail-user-cf').textContent = res.user.codice_fiscale || 'Non inserito';
        document.getElementById('detail-user-phone').textContent = res.user.telefono || 'Non inserito';
        
        anagraficaModal.style.display = 'none';
        loadUsers();
        
    } catch (error) {
        notifica(`Errore: ${error.message}`, 'errore');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Salva';
    }
});

// GENERAZIONE PDF DALLA SEGRETERIA
document.getElementById('btn-print-user-badge')?.addEventListener('click', generateAdminPDFLibretto);

// La foto ritagliata in proporzione larghezza:altezza, al centro, come una
// fototessera: con "fit" una foto larga lasciava una fascia vuota sotto.
async function ritagliaFototessera(url, larghezza, altezza) {
    const dati = await getBase64ImageFromUrl(url);
    if (!dati) return null;
    try {
        const img = await new Promise((ok, ko) => {
            const i = new Image();
            i.onload = () => ok(i);
            i.onerror = ko;
            i.src = dati;
        });
        const scala = 8;
        const tela = document.createElement('canvas');
        tela.width = Math.round(larghezza * scala);
        tela.height = Math.round(altezza * scala);
        const rapporto = Math.max(tela.width / img.width, tela.height / img.height);
        const w = img.width * rapporto, h = img.height * rapporto;
        const ctx = tela.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tela.width, tela.height);
        ctx.drawImage(img, (tela.width - w) / 2, (tela.height - h) / 2, w, h);
        return tela.toDataURL('image/jpeg', 0.92);
    } catch {
        return dati;
    }
}

async function getBase64ImageFromUrl(imageUrl) {
    try {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error('Network error');
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        return null;
    }
}

async function generateAdminPDFLibretto() {
    if (!currentUserViewData || !currentLibrettoViewData) {
        notifica('Attendi il caricamento completo dei dati del volontario.', 'attenzione'); return;
    }

    const btn = document.getElementById('btn-print-user-badge');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generazione in corso...';

    try {
        const logoBase64 = await getBase64ImageFromUrl('/logo.png');
        const photoBase64 = currentUserViewData.photo_url ? await getBase64ImageFromUrl(currentUserViewData.photo_url) : null;

        const headerColumns = [];
        if (logoBase64) headerColumns.push({ image: logoBase64, width: 60, alignment: 'left' });
        
        headerColumns.push({
            text: [
                { text: (brandingSettings.association_name || 'Protezione Civile').toUpperCase() + '\n', style: 'headerTitle' },
                { text: 'Sistema Informativo ORION\n', style: 'headerSub' },
                { text: 'FASCICOLO PERSONALE VOLONTARIO', style: 'documentTitle' }
            ],
            alignment: logoBase64 ? 'right' : 'center',
            margin: [0, 5, 0, 0]
        });

        const profileColumns = [];
        if (photoBase64) {
            profileColumns.push({ width: 'auto', image: photoBase64, fit: [95, 95], margin: [0, 0, 35, 0] });
        }
        profileColumns.push({
            width: '*', 
            table: {
                widths: [110, '*'], 
                body: [
                    [{ text: 'Volontario:', bold: true, border: [false, false, false, false] }, { text: `${currentUserViewData.nome} ${currentUserViewData.cognome}`, border: [false, false, false, false] }],
                    [{ text: 'Codice Fiscale:', bold: true, border: [false, false, false, false] }, { text: currentUserViewData.codice_fiscale || 'N/D', border: [false, false, false, false] }],
                    [{ text: 'Recapito:', bold: true, border: [false, false, false, false] }, { text: currentUserViewData.telefono || 'N/D', border: [false, false, false, false] }],
                    [{ text: 'Data Stampa:', bold: true, border: [false, false, false, false] }, { text: new Date().toLocaleDateString('it-IT'), border: [false, false, false, false] }]
                ]
            },
            layout: 'noBorders', margin: [0, 5, 0, 0]
        });

        const docDefinition = {
            pageSize: 'A4',
            pageMargins: [40, 40, 40, 40],
            content: [
                { columns: headerColumns, margin: [0, 0, 0, 15] },
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: '#3b82f6' }], margin: [0, 0, 0, 20] },
                { columns: profileColumns, margin: [0, 0, 0, 30] },
                
                { text: 'SORVEGLIANZA SANITARIA', style: 'sectionHeader' },
                {
                    table: {
                        headerRows: 1,
                        widths: ['*', 'auto', 'auto', 'auto'],
                        body: [
                            [
                                { text: 'TIPO VISITA', style: 'tableHeader' }, 
                                { text: 'DATA ESECUZIONE', style: 'tableHeader' }, 
                                { text: 'DATA SCADENZA', style: 'tableHeader' }, 
                                { text: 'ESITO', style: 'tableHeader' }
                            ],
                            ...(Array.isArray(currentLibrettoViewData.medical_records) ? currentLibrettoViewData.medical_records : (currentLibrettoViewData.medical_record ? [currentLibrettoViewData.medical_record] : [])).map((m, index, arr) => {
                                const isLatest = arr.findIndex(x => x.visit_type_id === m.visit_type_id) === index;
                                const isExpired = new Date(m.expiry_date) < new Date();
                                const statoText = isLatest ? m.status.toUpperCase() : 'STORICO';
                                const statoColor = !isLatest ? '#94a3b8' : (m.status === 'Idoneo' ? '#10b981' : '#ef4444');
                                return [
                                    { text: m.visit_name || 'Visita di Idoneità', margin: [0, 5, 0, 5], color: !isLatest ? '#94a3b8' : '#000000' },
                                    { text: new Date(m.last_visit_date).toLocaleDateString('it-IT'), margin: [0, 5, 0, 5], color: !isLatest ? '#94a3b8' : '#000000' },
                                    { text: new Date(m.expiry_date).toLocaleDateString('it-IT'), color: (!isLatest) ? '#94a3b8' : (isExpired ? '#ef4444' : '#000000'), bold: isExpired && isLatest, margin: [0, 5, 0, 5] },
                                    { text: statoText, color: statoColor, bold: true, margin: [0, 5, 0, 5] }
                                ];
                            })
                        ]
                    },
                    layout: {
                        hLineWidth: function (i, node) { return (i === 0 || i === node.table.body.length) ? 0 : 1; },
                        vLineWidth: function () { return 0; },
                        hLineColor: function () { return '#e2e8f0'; },
                        paddingLeft: function() { return 8; },
                        paddingRight: function() { return 8; },
                        fillColor: function (rowIndex) { return (rowIndex % 2 === 0 && rowIndex !== 0) ? '#f8fafc' : null; }
                    },
                    margin: [0, 0, 0, 30]
                },

                { text: 'FORMAZIONE E SPECIALIZZAZIONI', style: 'sectionHeader' },
                {
                    table: {
                        headerRows: 1,
                        widths: ['*', 'auto', 'auto', 'auto'],
                        body: [
                            [
                                { text: 'CORSO FREQUENTATO', style: 'tableHeader' }, 
                                { text: 'ACQUISITO IL', style: 'tableHeader' }, 
                                { text: 'SCADENZA', style: 'tableHeader' },
                                { text: 'STATO', style: 'tableHeader' }
                            ],
                            ...(currentLibrettoViewData.courses || []).map((c, index, arr) => {
                                const isLatest = arr.findIndex(x => x.course_id === c.course_id) === index;
                                const isExpired = c.expiry_date && new Date(c.expiry_date) < new Date();
                                const statoText = isLatest ? (isExpired ? 'SCADUTO' : 'VALIDO') : 'STORICO';
                                const statoColor = !isLatest ? '#94a3b8' : (isExpired ? '#ef4444' : '#3b82f6');
                                return [
                                    { text: c.name, margin: [0, 5, 0, 5], color: !isLatest ? '#94a3b8' : '#000000' },
                                    { text: new Date(c.acquisition_date).toLocaleDateString('it-IT'), margin: [0, 5, 0, 5], color: !isLatest ? '#94a3b8' : '#000000' },
                                    { text: c.expiry_date ? new Date(c.expiry_date).toLocaleDateString('it-IT') : 'Nessuna', color: (!isLatest) ? '#94a3b8' : (isExpired ? '#ef4444' : '#000000'), bold: isExpired && isLatest, margin: [0, 5, 0, 5] },
                                    { text: statoText, color: statoColor, bold: true, margin: [0, 5, 0, 5] }
                                ];
                            })
                        ]
                    },
                    layout: {
                        hLineWidth: function (i, node) { return (i === 0 || i === node.table.body.length) ? 0 : 1; },
                        vLineWidth: function () { return 0; },
                        hLineColor: function () { return '#e2e8f0'; },
                        paddingLeft: function() { return 8; },
                        paddingRight: function() { return 8; },
                        fillColor: function (rowIndex) { return (rowIndex % 2 === 0 && rowIndex !== 0) ? '#f8fafc' : null; }
                    }
                }
            ],
            styles: {
                headerTitle: { fontSize: 18, bold: true, color: '#1e293b', letterSpacing: 1 },
                headerSub: { fontSize: 10, color: '#64748b', margin: [0, 2, 0, 10] },
                documentTitle: { fontSize: 14, bold: true, color: '#3b82f6' },
                sectionHeader: { fontSize: 12, bold: true, color: '#334155', margin: [0, 10, 0, 10] },
                tableHeader: { bold: true, fontSize: 9, color: '#64748b', fillColor: '#f1f5f9', margin: [0, 5, 0, 5] }
            },
            defaultStyle: { fontSize: 10, color: '#334155' }
        };

        pdfMake.createPdf(docDefinition).download(`Fascicolo_${currentUserViewData.cognome}_${currentUserViewData.nome}.pdf`);

    } catch (error) {
        console.error("Errore generazione PDF in Segreteria:", error);
        notifica("Si è verificato un errore durante la generazione del PDF. Riprova.", 'errore');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// GENERAZIONE SCHEDA STATO ATTUALE (solo requisiti validi ora, no storico)
document.getElementById('btn-print-status-card')?.addEventListener('click', generateSyntheticStatusCard);

// Ritorna, per ogni tipo di visita, solo il record più recente se è ancora valido (Idoneo, non scaduto).
// L'array arriva già ordinato per last_visit_date DESC dal backend (/api/users/:id/libretto).
function getCurrentValidMedicalRecords(data) {
    const raw = Array.isArray(data?.medical_records) ? data.medical_records : (data?.medical_record ? [data.medical_record] : []);
    const seenTypes = new Set();
    const current = [];
    for (const m of raw) {
        if (seenTypes.has(m.visit_type_id)) continue;
        seenTypes.add(m.visit_type_id);
        const isExpired = !m.expiry_date || new Date(m.expiry_date) < new Date();
        if (!isExpired && m.status === 'Idoneo') current.push(m);
    }
    return current;
}

function getCurrentValidCourses(data) {
    const raw = data?.courses || [];
    const seenCourses = new Set();
    const current = [];
    for (const c of raw) {
        if (seenCourses.has(c.course_id)) continue;
        seenCourses.add(c.course_id);
        const isExpired = c.expiry_date && new Date(c.expiry_date) < new Date();
        if (!isExpired) current.push(c);
    }
    return current;
}

async function generateSyntheticStatusCard() {
    if (!currentUserViewData || !currentLibrettoViewData) {
        notifica('Attendi il caricamento completo dei dati del volontario.', 'attenzione'); return;
    }

    const btn = document.getElementById('btn-print-status-card');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generazione...';

    try {
        const logoBase64 = await getBase64ImageFromUrl('/logo.png');
        const photoBase64 = currentUserViewData.photo_url ? await getBase64ImageFromUrl(currentUserViewData.photo_url) : null;

        const validMedical = getCurrentValidMedicalRecords(currentLibrettoViewData);
        const validCourses = getCurrentValidCourses(currentLibrettoViewData);

        // Stessa logica di operatività globale usata nel tesserino pubblico QR
        const isMedOk = validMedical.some(m => (m.visit_name || '').toLowerCase() === 'visita di idoneità fisica');
        const isCourseBaseOk = validCourses.some(c => c.course_id === 1);
        const isOperativo = isMedOk && isCourseBaseOk;

        const headerColumns = [];
        if (logoBase64) headerColumns.push({ image: logoBase64, width: 50, alignment: 'left' });
        headerColumns.push({
            text: [
                { text: (brandingSettings.association_name || 'Protezione Civile').toUpperCase() + '\n', style: 'headerTitle' },
                { text: 'SCHEDA VOLONTARIO - STATO ATTUALE', style: 'documentTitle' }
            ],
            alignment: logoBase64 ? 'right' : 'center',
            margin: [0, 5, 0, 0]
        });

        const profileColumns = [];
        if (photoBase64) profileColumns.push({ width: 'auto', image: photoBase64, fit: [75, 75], margin: [0, 0, 20, 0] });
        profileColumns.push({
            width: '*',
            stack: [
                { text: `${currentUserViewData.nome} ${currentUserViewData.cognome}`, fontSize: 15, bold: true, color: '#1e293b' },
                { text: (currentUserViewData.role || '').toUpperCase(), fontSize: 9, color: '#64748b', margin: [0, 2, 0, 8] },
                { text: isOperativo ? 'OPERATIVO' : 'NON OPERATIVO', bold: true, fontSize: 12, color: isOperativo ? '#10b981' : '#ef4444' }
            ]
        });

        const medicalRows = validMedical.map(m => [
            { text: m.visit_name || 'Visita di idoneità', margin: [0, 4, 0, 4] },
            { text: new Date(m.last_visit_date).toLocaleDateString('it-IT'), margin: [0, 4, 0, 4] },
            { text: new Date(m.expiry_date).toLocaleDateString('it-IT'), margin: [0, 4, 0, 4] }
        ]);
        const courseRows = validCourses.map(c => [
            { text: c.name, margin: [0, 4, 0, 4] },
            { text: new Date(c.acquisition_date).toLocaleDateString('it-IT'), margin: [0, 4, 0, 4] },
            { text: c.expiry_date ? new Date(c.expiry_date).toLocaleDateString('it-IT') : 'Senza scadenza', margin: [0, 4, 0, 4] }
        ]);

        const docDefinition = {
            pageSize: 'A5',
            pageMargins: [30, 30, 30, 30],
            content: [
                { columns: headerColumns, margin: [0, 0, 0, 12] },
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 355, y2: 0, lineWidth: 1.5, lineColor: '#3b82f6' }], margin: [0, 0, 0, 15] },
                { columns: profileColumns, margin: [0, 0, 0, 20] },

                { text: 'VISITA MEDICA VALIDA', style: 'sectionHeader' },
                medicalRows.length > 0
                    ? { table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: [[{ text: 'Tipo', style: 'tableHeader' }, { text: 'Data', style: 'tableHeader' }, { text: 'Scadenza', style: 'tableHeader' }], ...medicalRows] }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 20] }
                    : { text: 'Nessuna visita valida al momento.', italics: true, color: '#ef4444', margin: [0, 0, 0, 20] },

                { text: 'CORSI ATTIVI', style: 'sectionHeader' },
                courseRows.length > 0
                    ? { table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: [[{ text: 'Corso', style: 'tableHeader' }, { text: 'Acquisito', style: 'tableHeader' }, { text: 'Scadenza', style: 'tableHeader' }], ...courseRows] }, layout: 'lightHorizontalLines' }
                    : { text: 'Nessun corso attivo al momento.', italics: true, color: '#ef4444' },

                { text: `Documento generato il ${new Date().toLocaleDateString('it-IT')} - fotografia dello stato attuale, non sostituisce il fascicolo completo.`, fontSize: 7, color: '#94a3b8', margin: [0, 20, 0, 0] }
            ],
            styles: {
                headerTitle: { fontSize: 13, bold: true, color: '#1e293b' },
                documentTitle: { fontSize: 9, bold: true, color: '#3b82f6' },
                sectionHeader: { fontSize: 10, bold: true, color: '#334155', margin: [0, 8, 0, 6] },
                tableHeader: { bold: true, fontSize: 8, color: '#64748b', fillColor: '#f1f5f9' }
            },
            defaultStyle: { fontSize: 9, color: '#334155' }
        };

        pdfMake.createPdf(docDefinition).download(`Scheda_${currentUserViewData.cognome}_${currentUserViewData.nome}.pdf`);

    } catch (error) {
        console.error("Errore generazione scheda stato attuale:", error);
        notifica("Si è verificato un errore durante la generazione della scheda.", 'errore');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// GENERAZIONE TESSERINO DI RICONOSCIMENTO (BADGE CR80 Orizzontale)
document.getElementById('btn-print-id-card')?.addEventListener('click', generateIDCard);

// Tesserino perso: un QR nuovo, e quello vecchio non apre piu' niente.
document.getElementById('btn-rigenera-qr')?.addEventListener('click', async () => {
    if (!currentUserViewId || !currentUserViewData) return;
    if (!confirm(`Rigenerare il QR del tesserino di ${currentUserViewName}?\n\nIl tesserino stampato finora smette di funzionare e va ristampato.`)) return;
    try {
        const esito = await fetchApi(`/api/admin/users/${currentUserViewId}/rigenera-tesserino`, { method: 'POST' });
        currentUserViewData.public_token = esito.public_token;
        mostraQrDettaglio(esito.public_token);
        notifica(esito.message, 'successo');
    } catch (e) {
        notifica(`Errore: ${e.message}`, 'errore');
    }
});

async function generateIDCard() {
    if (!currentUserViewData) {
        notifica('Attendi il caricamento dei dati del volontario.', 'attenzione');
        return;
    }

    const btn = document.getElementById('btn-print-id-card');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generazione...';

    try {
        const logoBase64 = await getBase64ImageFromUrl('/logo.png');
        const regioneBase64 = brandingLogos.logo2Url ? await getBase64ImageFromUrl(brandingLogos.logo2Url) : null;
        // QR e foto non stanno nell'elenco degli utenti: se il fascicolo non
        // li aveva ancora letti, li si chiede adesso.
        if (currentUserViewData.qr_attivo === undefined) {
            const t = await fetchApi(`/api/admin/users/${currentUserViewData.id}/tesserino`);
            Object.assign(currentUserViewData, { public_token: t.public_token, photo_url: t.photo_url, qr_attivo: t.qr_attivo !== false });
        }
        // Senza token (QR spenti dall'amministrazione) il tesserino si stampa
        // senza QR, e lo spazio si ridistribuisce.
        const conQr = !!currentUserViewData.public_token;
        const qrUrl = conQr ? `${window.location.origin}/badge.html?token=${currentUserViewData.public_token}` : null;

        // Colori del modello fisico di riferimento (tesserino Protezione Civile)
        const navyBlue = '#0b1f3a';
        const gold = '#f4c430';
        const tealBand = '#0f505e';
        const pcYellow = '#FFCC00';

        // Formato CR80 orizzontale: 86x54 mm, cioè 243x153 punti PDF.
        const CARD_W = 243, CARD_H = 153;
        const NAVY_H = 32;
        const TEAL_Y = 104, TEAL_H = 18;
        const YELLOW_Y = 122;
        // La fascia bianca fra la banda blu e quella dell'ente: foto, QR e
        // loghi stanno tutti centrati qui dentro, in verticale.
        const BIANCO_Y = NAVY_H, BIANCO_H = TEAL_Y - NAVY_H;

        // La foto, ritagliata come una fototessera (riempie il riquadro senza
        // deformarsi) e centrata nella fascia bianca.
        const FOTO_W = 55, FOTO_H = 66;
        const FOTO_X = CARD_W - 8 - FOTO_W, FOTO_Y = BIANCO_Y + (BIANCO_H - FOTO_H) / 2;
        const photoBase64 = currentUserViewData.photo_url
            ? await ritagliaFototessera(currentUserViewData.photo_url, FOTO_W, FOTO_H)
            : null;

        // Le bandiere, disegnate secondo le proporzioni ufficiali (3:2).
        // Italiana: tre bande verticali uguali, verde, bianco e rosso.
        // Europea: dodici stelle d'oro a cinque punte su un cerchio di raggio
        // pari a un terzo dell'altezza; ogni stella è larga un nono
        // dell'altezza, con una punta verso l'alto.
        const BANDIERA_H = 18, BANDIERA_W = 27, BANDIERA_Y = YELLOW_Y + (CARD_H - YELLOW_Y - BANDIERA_H) / 2;
        const ITA_X = 10, UE_X = CARD_W - 10 - BANDIERA_W;
        const bandieraItaliana = [
            { type: 'rect', x: ITA_X, y: BANDIERA_Y, w: BANDIERA_W / 3, h: BANDIERA_H, color: '#009246' },
            { type: 'rect', x: ITA_X + BANDIERA_W / 3, y: BANDIERA_Y, w: BANDIERA_W / 3, h: BANDIERA_H, color: '#ffffff' },
            { type: 'rect', x: ITA_X + 2 * BANDIERA_W / 3, y: BANDIERA_Y, w: BANDIERA_W / 3, h: BANDIERA_H, color: '#ce2b37' }
        ];
        const stella = (cx, cy, r) => ({
            type: 'polyline', closePath: true, color: '#ffcc00', lineWidth: 0,
            points: Array.from({ length: 10 }, (_, k) => {
                const raggio = k % 2 === 0 ? r : r * 0.382;
                const angolo = -Math.PI / 2 + (k * Math.PI) / 5;
                return { x: cx + raggio * Math.cos(angolo), y: cy + raggio * Math.sin(angolo) };
            })
        });
        const bandieraEuropea = [
            { type: 'rect', x: UE_X, y: BANDIERA_Y, w: BANDIERA_W, h: BANDIERA_H, color: '#003399' },
            ...Array.from({ length: 12 }, (_, k) => {
                const angolo = (Math.PI * 2 * k) / 12 - Math.PI / 2;
                const cx = UE_X + BANDIERA_W / 2, cy = BANDIERA_Y + BANDIERA_H / 2, giro = BANDIERA_H / 3;
                return stella(cx + giro * Math.cos(angolo), cy + giro * Math.sin(angolo), BANDIERA_H / 18);
            })
        ];

        // Segnaposto della foto: una sagoma, così si vede che lo spazio è per
        // la foto e la si può incollare a mano.
        const segnapostoFoto = {
            canvas: [
                { type: 'rect', x: 0, y: 0, w: FOTO_W, h: FOTO_H, color: '#e2e8f0' },
                { type: 'ellipse', x: FOTO_W / 2, y: 24, r1: 11, r2: 12, color: '#94a3b8' },
                { type: 'ellipse', x: FOTO_W / 2, y: FOTO_H + 2, r1: 22, r2: 22, color: '#94a3b8' },
                // Copre la parte delle spalle che esce dal riquadro: sotto la
                // foto il tesserino è bianco, e la banda dell'ente è più in basso.
                { type: 'rect', x: 0, y: FOTO_H, w: FOTO_W, h: TEAL_Y - FOTO_Y - FOTO_H, color: '#ffffff' }
            ],
            absolutePosition: { x: FOTO_X, y: FOTO_Y }
        };

        // La colonna centrale: "PROTEZIONE CIVILE" e sotto i loghi, prima
        // quello dell'ente sovraordinato e poi quello dell'organizzazione.
        // Con il QR sta fra QR e foto; senza, si allarga a tutto lo spazio a
        // sinistra della foto e scritta e loghi crescono.
        const QR_LATO = 58, QR_X = 8, QR_Y = BIANCO_Y + (BIANCO_H - QR_LATO) / 2;
        const colonnaX = conQr ? QR_X + QR_LATO + 4 : 8;
        const colonnaW = FOTO_X - 6 - colonnaX;
        // Più grande possibile senza toccare QR e foto: in grassetto la
        // scritta è larga circa 9,3 volte la dimensione del carattere.
        const titoloSize = Math.min(conQr ? 12 : 15, colonnaW / 9.3);
        const LATO = conQr ? 36 : 42, SPAZIO = conQr ? 10 : 16;
        const simboli = [regioneBase64, logoBase64].filter(Boolean);
        const altezzaTitolo = titoloSize * 1.2;
        const altezzaColonna = altezzaTitolo + (simboli.length ? 5 + LATO : 0);
        const colonnaY = BIANCO_Y + (BIANCO_H - altezzaColonna) / 2;
        const inizioSimboli = colonnaX + (colonnaW - (simboli.length * LATO + (simboli.length - 1) * SPAZIO)) / 2;
        const rigaSimboli = simboli.map((immagine, i) => ({
            image: immagine, fit: [LATO, LATO],
            absolutePosition: { x: inizioSimboli + i * (LATO + SPAZIO), y: colonnaY + altezzaTitolo + 5 }
        }));

        // Un testo in una colonna larga "larghezza" a partire da x: pdfMake,
        // con la sola posizione assoluta, centrava sul resto della pagina.
        const testoIn = (x, y, larghezza, testo, opzioni = {}) => ({
            columns: [{ width: larghezza, text: testo, ...opzioni }],
            absolutePosition: { x, y }
        });
        const nomeCompleto = `${currentUserViewData.cognome || ''} ${currentUserViewData.nome || ''}`.trim().toUpperCase();
        const ente = (brandingSettings.card_regional_entity_name || '').trim();

        const docDefinition = {
            pageSize: { width: CARD_W, height: CARD_H },
            pageMargins: [0, 0, 0, 0],
            // Tutto lo sfondo in un disegno solo: pdfMake impila i disegni
            // separati uno sotto l'altro, e finirebbero fuori dal tesserino.
            background: function() {
                return {
                    canvas: [
                        { type: 'rect', x: 0, y: 0, w: CARD_W, h: NAVY_H, color: navyBlue },
                        ...(ente ? [{ type: 'rect', x: 0, y: TEAL_Y, w: CARD_W, h: TEAL_H, color: tealBand }] : []),
                        { type: 'rect', x: 0, y: YELLOW_Y, w: CARD_W, h: CARD_H - YELLOW_Y, color: pcYellow },
                        ...bandieraItaliana,
                        ...bandieraEuropea
                    ]
                };
            },
            content: [
                // Nome e distretto sulla banda blu: la foto ora è più in basso,
                // e la riga può usare tutta la larghezza.
                testoIn(8, nomeCompleto.length > 30 ? 7 : 5, CARD_W - 16, nomeCompleto, { fontSize: nomeCompleto.length > 30 ? 10 : 13, bold: true, color: gold, noWrap: true }),
                testoIn(8, 19.5, CARD_W - 16, brandingSettings.card_district_label || '', { fontSize: 7.5, color: '#ffffff' }),

                // Foto, o la sagoma se manca
                photoBase64
                    ? { image: photoBase64, width: FOTO_W, height: FOTO_H, absolutePosition: { x: FOTO_X, y: FOTO_Y } }
                    : segnapostoFoto,

                // QR di verifica, dal lato opposto alla foto, se i QR sono in uso
                ...(conQr ? [{ qr: qrUrl, fit: QR_LATO, absolutePosition: { x: QR_X, y: QR_Y } }] : []),

                testoIn(colonnaX, colonnaY, colonnaW, 'PROTEZIONE CIVILE', { fontSize: titoloSize, bold: true, color: navyBlue, alignment: 'center', noWrap: true }),
                ...rigaSimboli,

                // Banda dell'ente sovraordinato: il nome, il logo è già in alto
                ...(ente ? [testoIn(8, TEAL_Y + 4.5, CARD_W - 16, ente.toUpperCase(), { fontSize: 9, bold: true, color: '#ffffff', alignment: 'center' })] : []),

                // Banda gialla, fra le due bandiere: la qualifica. Il ruolo nel
                // programma (admin, segreteria...) non dice niente a chi guarda
                // il tesserino, e non ci va.
                testoIn(ITA_X + BANDIERA_W + 4, BANDIERA_Y + 1, UE_X - ITA_X - BANDIERA_W - 8, 'VOLONTARIO', {
                    fontSize: 15, bold: true, color: navyBlue, alignment: 'center', characterSpacing: 2
                })
            ]
        };

        pdfMake.createPdf(docDefinition).download(`Tesserino_PC_${currentUserViewData.cognome}_${currentUserViewData.nome}.pdf`);

    } catch (error) {
        console.error("Errore generazione Tesserino:", error);
        notifica("Errore durante la generazione del tesserino.", 'errore');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}
