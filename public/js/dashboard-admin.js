document.addEventListener('DOMContentLoaded', () => {
    console.log("Pagina Dashboard Admin caricata.");

    const settingsForm = document.getElementById('settings-form');
    const associationNameInput = document.getElementById('association-name');
    const logoInput = document.getElementById('app-logo');
    const mapCenterLatInput = document.getElementById('map-center-lat');
    const mapCenterLonInput = document.getElementById('map-center-lon');
    const mapZoomInput = document.getElementById('map-zoom');
    const minutiAttesaInput = document.getElementById('minuti-attesa-critica');
    const notifyUserBtn = document.getElementById('notify-user');
    const notifyAdminsBtn = document.getElementById('notify-admins');
    const customEmailsInput = document.getElementById('notify-custom-emails');
    const noticeDaysInput = document.getElementById('notify-notice-days');
    const customEmailTemplateInput = document.getElementById('custom-user-email-template');
    
    // Selettori SMTP
    const smtpHostInput = document.getElementById('smtp-host');
    const smtpPortInput = document.getElementById('smtp-port');
    const smtpSecureInput = document.getElementById('smtp-secure');
    const smtpUserInput = document.getElementById('smtp-user');
    const smtpPassInput = document.getElementById('smtp-pass');

    // Selettori Segreteria
    const enableSegBtn = document.getElementById('enable-segreteria');
    const constraintsDiv = document.getElementById('segreteria-constraints');
    const enableMagBtn = document.getElementById('enable-magazzino');
    const magazzinoNote = document.getElementById('magazzino-note');
    const blockMed = document.getElementById('block-on-medical');
    const blockCourse = document.getElementById('block-on-course');

    const badgeAlwaysOnInput = document.getElementById('badge-qr-always-on');
    const badgeQrEnabledInput = document.getElementById('badge-qr-enabled');
    // "Forza sempre attivo" non vuol dire niente se i QR sono spenti.
    const aggiornaRigaSempreAttivo = () => {
        const riga = document.getElementById('riga-badge-always-on');
        if (riga && badgeQrEnabledInput) riga.style.opacity = badgeQrEnabledInput.checked ? '' : '0.45';
        if (badgeAlwaysOnInput && badgeQrEnabledInput) badgeAlwaysOnInput.disabled = !badgeQrEnabledInput.checked;
    };
    badgeQrEnabledInput?.addEventListener('change', aggiornaRigaSempreAttivo);
    const appAndroidInput = document.getElementById('app-android-enabled');

    // Selettori Tesserino di Riconoscimento
    const cardDistrictLabelInput = document.getElementById('card-district-label');
    const cardRegionalEntityNameInput = document.getElementById('card-regional-entity-name');
    const logo2Input = document.getElementById('app-logo2');

    // Selettori Feedback
    const settingsFeedback = document.getElementById('settings-feedback');
    const logoUploadFeedback = document.getElementById('logo-upload-feedback');
    const logo2UploadFeedback = document.getElementById('logo2-upload-feedback');

    // Selettori Mappa Picker
    const mapPickerBtn = document.getElementById('map-picker-btn');
    const mapPickerModal = document.getElementById('mapPickerModal');
    const closeMapPickerModalBtn = document.getElementById('closeMapPickerModal');
    const confirmMapSelectionBtn = document.getElementById('confirmMapSelectionBtn');
    const cancelMapSelectionBtn = document.getElementById('cancelMapSelectionBtn');

    let pickerMap = null;
    let pickerMarker = null;

    function showFeedback(element, message, type) {
        if (!element) return;
        element.textContent = message;
        element.style.color = type === 'success' ? 'var(--success-text)' : type === 'error' ? 'var(--danger-text)' : 'var(--info-text)';
        
        setTimeout(() => {
            element.textContent = '';
        }, 4000);
    }

    // "30, 15, 0" -> [30, 15, 0]. Vuoto o illeggibile, restano i giorni di
    // sempre: meglio un preavviso di troppo che nessuno.
    function leggiGiorniPreavviso() {
        const giorni = String(noticeDaysInput?.value || '').split(/[\s,;]+/)
            .map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n >= 0 && n <= 365);
        return giorni.length ? [...new Set(giorni)].sort((a, b) => b - a) : [30, 15, 0];
    }

    const btnReportOra = document.getElementById('btn-report-ora');
    if (btnReportOra) {
        btnReportOra.addEventListener('click', async () => {
            const esito = document.getElementById('report-ora-esito');
            btnReportOra.disabled = true;
            esito.style.color = 'var(--text-muted)';
            esito.textContent = 'Invio in corso...';
            try {
                const r = await fetchApi('/api/admin/report-scadenze', { method: 'POST' });
                esito.style.color = 'var(--success-text)';
                esito.textContent = r.message;
            } catch (e) {
                esito.style.color = 'var(--danger-text)';
                esito.textContent = e.message;
            } finally {
                btnReportOra.disabled = false;
            }
        });
    }

    async function loadAndApplySettings() {
        try {
            // Endpoint completo (solo admin): serve anche per precompilare le credenziali SMTP.
            const settings = await fetchApi('/api/branding/settings/full');
            
            if (settings) {
                if (associationNameInput) associationNameInput.value = settings.association_name || '';
                if (mapCenterLatInput) mapCenterLatInput.value = settings.map_center_lat || '';
                if (mapCenterLonInput) mapCenterLonInput.value = settings.map_center_lon || '';
                if (mapZoomInput) mapZoomInput.value = settings.map_zoom_level || '';
                if (minutiAttesaInput) minutiAttesaInput.value = settings.minuti_attesa_critica || '';
                if (smtpHostInput) smtpHostInput.value = settings.smtp_host || '';
                if (smtpPortInput) smtpPortInput.value = settings.smtp_port || '';
                if (smtpSecureInput) smtpSecureInput.value = settings.smtp_secure || 'true';
                if (smtpUserInput) smtpUserInput.value = settings.smtp_user || '';
                if (smtpPassInput) smtpPassInput.value = settings.smtp_pass || '';
                if (badgeAlwaysOnInput) badgeAlwaysOnInput.checked = settings.badge_qr_always_on === 'true';
                if (badgeQrEnabledInput) badgeQrEnabledInput.checked = settings.badge_qr_enabled !== 'false';
                aggiornaRigaSempreAttivo();
                // Mai toccata vuol dire disponibile: l'APK arriva con il server.
                if (appAndroidInput) appAndroidInput.checked = settings.app_android_enabled !== 'false';
                if (cardDistrictLabelInput) cardDistrictLabelInput.value = settings.card_district_label || '';
                if (cardRegionalEntityNameInput) cardRegionalEntityNameInput.value = settings.card_regional_entity_name || '';

                document.title = `Pannello Amministrazione - ${settings.association_name || 'ORION'}`;

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

                if (settings.segreteria_config && enableSegBtn && blockMed && blockCourse) {
                    try {
                        const sConf = typeof settings.segreteria_config === 'string' ? JSON.parse(settings.segreteria_config) : settings.segreteria_config;
                        enableSegBtn.checked = sConf.enabled === true;
                        blockMed.checked = sConf.block_on_medical === true;
                        blockCourse.checked = sConf.block_on_course === true;
                        if (notifyUserBtn) notifyUserBtn.checked = sConf.notify_user === true;
                        if (notifyAdminsBtn) notifyAdminsBtn.checked = sConf.notify_admin === true;
                        if (customEmailsInput) customEmailsInput.value = sConf.custom_emails || '';
                        if (noticeDaysInput) {
                            noticeDaysInput.value = (Array.isArray(sConf.notice_days) && sConf.notice_days.length
                                ? sConf.notice_days : [30, 15, 0]).join(', ');
                        }
                        if (customEmailTemplateInput) customEmailTemplateInput.value = sConf.custom_user_email_template || "Ciao {NOME},\n\nTi informiamo che il tuo requisito '{REQUISITO}' è in scadenza il giorno {SCADENZA}.\n\nTi preghiamo di contattare il coordinatore o la segreteria per organizzare il rinnovo.\n\nSaluti,\nLa Segreteria";
                        const sidebarSegreteria = document.getElementById('sidebar-segreteria');
                        if (sidebarSegreteria && sConf.enabled && haRuolo('segreteria')) {
                            sidebarSegreteria.style.display = 'block';
                        }
                    } catch(e) { console.error("Errore parse segreteria_config"); }
                }

                // Interruttore del magazzino. La chiave è una riga a sé e non un
                // campo dentro magazzino_config: le opzioni di funzionamento le
                // salva il magazziniere dalla sua pagina, e due form che
                // scrivono lo stesso oggetto si cancellano a vicenda.
                if (enableMagBtn) {
                    enableMagBtn.checked = String(settings.magazzino_enabled) === 'true';
                    const vociMagazzinoMenu = document.getElementById('sidebar-magazzino');
                    if (vociMagazzinoMenu) {
                        vociMagazzinoMenu.style.display =
                            (enableMagBtn.checked && haRuolo('magazziniere')) ? 'block' : 'none';
                    }
                    if (magazzinoNote) {
                        magazzinoNote.style.display = enableMagBtn.checked ? 'block' : 'none';
                        enableMagBtn.addEventListener('change', () => {
                            magazzinoNote.style.display = enableMagBtn.checked ? 'block' : 'none';
                        });
                    }
                }

                if (constraintsDiv && enableSegBtn) {
                    constraintsDiv.style.display = enableSegBtn.checked ? 'block' : 'none';
                    enableSegBtn.addEventListener('change', () => {
                        constraintsDiv.style.display = enableSegBtn.checked ? 'block' : 'none';
                    });
                }
            }
        } catch (error) {
            console.error("Errore nel caricamento delle impostazioni:", error);
            showFeedback(settingsFeedback, "Errore nel caricamento delle impostazioni.", 'error');
        }
    }

    async function handleSettingsSubmit(event) {
        event.preventDefault();
        const submitButton = settingsForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';

        // Creazione dell'oggetto sicuro con Optional Chaining (?.)
        const settingsToUpdate = {
            association_name: associationNameInput?.value?.trim() || '',
            map_center_lat: mapCenterLatInput?.value?.trim() || '',
            map_center_lon: mapCenterLonInput?.value?.trim() || '',
            map_zoom_level: mapZoomInput?.value?.trim() || '',
            minuti_attesa_critica: minutiAttesaInput?.value?.trim() || '',
            smtp_host: smtpHostInput?.value?.trim() || '',
            smtp_port: smtpPortInput?.value?.trim() || '',
            smtp_secure: smtpSecureInput?.value || 'true',
            smtp_user: smtpUserInput?.value?.trim() || '',
            smtp_pass: smtpPassInput?.value?.trim() || '',
            badge_qr_always_on: badgeAlwaysOnInput?.checked ? 'true' : 'false',
            ...(badgeQrEnabledInput ? { badge_qr_enabled: badgeQrEnabledInput.checked ? 'true' : 'false' } : {}),
            ...(appAndroidInput ? { app_android_enabled: appAndroidInput.checked ? 'true' : 'false' } : {}),
            magazzino_enabled: enableMagBtn?.checked ? 'true' : 'false',
            card_district_label: cardDistrictLabelInput?.value?.trim() || '',
            card_regional_entity_name: cardRegionalEntityNameInput?.value?.trim() || '',
            segreteria_config: JSON.stringify({
                enabled: enableSegBtn?.checked || false,
                block_on_medical: blockMed?.checked || false,
                block_on_course: blockCourse?.checked || false,
                notify_user: notifyUserBtn?.checked || false,
                notify_admin: notifyAdminsBtn?.checked || false,
                custom_emails: customEmailsInput?.value?.trim() || '',
                notice_days: leggiGiorniPreavviso(),
                custom_user_email_template: customEmailTemplateInput?.value?.trim() || ''
            })
        };

        try {
            await fetchApi('/api/branding/settings', {
                method: 'PUT',
                body: JSON.stringify(settingsToUpdate)
            });
            showFeedback(settingsFeedback, 'Impostazioni salvate con successo!', 'success');
            document.title = `Pannello Amministrazione - ${settingsToUpdate.association_name || 'ORION'}`;
        } catch (error) {
            showFeedback(settingsFeedback, `Errore: ${error.message}`, 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = '<i class="fas fa-save"></i> Salva';
        }
    }

    async function handleLogoUpload() {
        if (!logoInput.files || logoInput.files.length === 0) return;

        const file = logoInput.files[0];
        const formData = new FormData();
        formData.append('logoFile', file);
        
        showFeedback(logoUploadFeedback, 'Caricamento logo in corso...', 'info');

        try {
            await fetchApi('/api/branding/logo', {
                method: 'POST',
                body: formData
            });
            showFeedback(logoUploadFeedback, 'Logo aggiornato con successo! Apparirà al prossimo ricaricamento.', 'success');
            
            const sidebarLogo = document.getElementById('main-app-logo');
            if (sidebarLogo) {
                sidebarLogo.src = URL.createObjectURL(file);
            }
        } catch (error) {
            console.error("Errore caricamento logo:", error);
            showFeedback(logoUploadFeedback, `Errore: ${error.message}`, 'error');
        } finally {
            logoInput.value = '';
        }
    }

    // 5bis. CARICAMENTO LOGO SECONDARIO (Ente sovraordinato, per il tesserino)
    async function handleLogo2Upload() {
        if (!logo2Input.files || logo2Input.files.length === 0) return;

        const file = logo2Input.files[0];
        const formData = new FormData();
        formData.append('logoFile', file);

        showFeedback(logo2UploadFeedback, 'Caricamento logo in corso...', 'info');

        try {
            await fetchApi('/api/branding/logo2', {
                method: 'POST',
                body: formData
            });
            showFeedback(logo2UploadFeedback, 'Logo secondario aggiornato con successo!', 'success');
        } catch (error) {
            console.error("Errore caricamento logo secondario:", error);
            showFeedback(logo2UploadFeedback, `Errore: ${error.message}`, 'error');
        } finally {
            logo2Input.value = '';
        }
    }

    function initPickerMap() {
        if (pickerMap) return; 

        pickerMap = L.map('picker-map').setView([41.9, 12.5], 6);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(pickerMap);

        pickerMap.on('click', onPickerMapClick);
    }

    function openMapPicker() {
        if (!mapPickerModal) return;
        mapPickerModal.style.display = 'flex';
        initPickerMap();

        // Senza un centro salvato si parte dall'Italia intera e senza puntatore:
        // il punto lo mette chi configura, con un clic.
        const lat = parseFloat(mapCenterLatInput.value);
        const lon = parseFloat(mapCenterLonInput.value);
        const salvato = Number.isFinite(lat) && Number.isFinite(lon);
        const zoom = parseInt(mapZoomInput.value, 10) || 10;

        // Leaflet ha bisogno di un attimo prima di ridimensionarsi in un modale
        setTimeout(() => {
            pickerMap.invalidateSize();
            if (pickerMarker) { pickerMarker.remove(); pickerMarker = null; }
            if (salvato) {
                pickerMap.setView([lat, lon], zoom);
                pickerMarker = L.marker([lat, lon], { draggable: true }).addTo(pickerMap);
            } else {
                pickerMap.setView([41.9, 12.5], 6);
            }
        }, 150);
    }
    
    function closeMapPicker() {
        if (mapPickerModal) mapPickerModal.style.display = 'none';
    }

    function onPickerMapClick(e) {
        if (!pickerMarker) {
            pickerMarker = L.marker(e.latlng, { draggable: true }).addTo(pickerMap);
        } else {
            pickerMarker.setLatLng(e.latlng);
        }
    }

    function confirmMapSelection() {
        if (pickerMarker) {
            const { lat, lng } = pickerMarker.getLatLng();
            if (mapCenterLatInput) mapCenterLatInput.value = lat.toFixed(6);
            if (mapCenterLonInput) mapCenterLonInput.value = lng.toFixed(6);
            
            if (mapZoomInput) mapZoomInput.value = pickerMap.getZoom();
        }
        closeMapPicker();
    }

    const auditBody = document.getElementById('audit-log-body');
    const auditFiltroUtente = document.getElementById('audit-filter-username');
    const auditFiltroAzione = document.getElementById('audit-filter-action');
    const auditAggiorna = document.getElementById('audit-refresh');
    const auditAltre = document.getElementById('audit-load-more');
    const auditConteggio = document.getElementById('audit-count');
    let auditPagina = 1;

    const etichetteAzioni = {
        'squadra.creata': 'Squadra creata',
        'squadra.modificata': 'Squadra modificata',
        'squadra.eliminata': 'Squadra eliminata',
        'utente.creato': 'Utente creato',
        'utente.modificato': 'Utente modificato',
        'utente.eliminato': 'Utente eliminato',
        'utente.sospeso': 'Utente sospeso',
        'utente.riattivato': 'Utente riattivato',
        'utente.password_resettata': 'Password resettata',
        'utenti.importati': 'Utenti importati',
        'emergenza.aperta': 'Emergenza aperta',
        'emergenza.chiusa': 'Emergenza chiusa',
        'emergenza.eliminata': 'Emergenza eliminata',
        'documento.eliminato': 'Documento eliminato',
        'impostazioni.modificate': 'Impostazioni modificate',
        'libretto.visita_eliminata': 'Visita eliminata dal libretto',
        'libretto.corso_eliminato': 'Corso eliminato dal libretto'
    };

    // Le operazioni distruttive vanno riconosciute a colpo d'occhio
    const azioneDistruttiva = (azione) => /eliminat|sospeso|resettata/.test(azione);

    function creaCella(testo, stile = '') {
        const td = document.createElement('td');
        if (stile) td.style.cssText = stile;
        td.textContent = testo;
        return td;
    }

    async function caricaRegistro(aggiungi = false) {
        if (!auditBody) return;
        if (!aggiungi) {
            auditPagina = 1;
            auditBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color: var(--text-muted);">Caricamento...</td></tr>';
        }

        const parametri = new URLSearchParams({ page: String(auditPagina), limit: '50' });
        if (auditFiltroUtente?.value.trim()) parametri.set('username', auditFiltroUtente.value.trim());
        if (auditFiltroAzione?.value) parametri.set('action', auditFiltroAzione.value);

        try {
            const dati = await fetchApi(`/api/admin/audit-log?${parametri.toString()}`);
            if (!aggiungi) auditBody.innerHTML = '';

            const voci = dati?.entries || [];
            if (voci.length === 0 && !aggiungi) {
                auditBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color: var(--text-muted);">Nessuna operazione registrata.</td></tr>';
            }

            voci.forEach(voce => {
                const tr = document.createElement('tr');
                const quando = voce.occurred_at ? new Date(voce.occurred_at).toLocaleString('it-IT') : '';
                const oggetto = voce.entity_type ? `${voce.entity_type}${voce.entity_id ? ' #' + voce.entity_id : ''}` : '';
                let dettagli = '';
                if (voce.details) {
                    try {
                        const d = typeof voce.details === 'string' ? JSON.parse(voce.details) : voce.details;
                        dettagli = Object.entries(d)
                            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                            .join(' · ');
                    } catch { dettagli = ''; }
                }

                tr.appendChild(creaCella(quando, 'white-space: nowrap; font-size: 0.85rem;'));
                tr.appendChild(creaCella(voce.username || '(utente rimosso)', 'font-weight: 600;'));
                tr.appendChild(creaCella(
                    etichetteAzioni[voce.action] || voce.action,
                    azioneDistruttiva(voce.action) ? 'color: var(--danger-text); font-weight: 600;' : ''
                ));
                tr.appendChild(creaCella(oggetto, 'font-size: 0.85rem; color: var(--text-muted);'));
                tr.appendChild(creaCella(dettagli, 'font-size: 0.8rem; color: var(--text-muted); max-width: 320px; overflow-wrap: anywhere;'));
                auditBody.appendChild(tr);
            });

            const paginazione = dati?.pagination;
            if (auditConteggio && paginazione) {
                auditConteggio.textContent = `${paginazione.totalEntries} operazioni registrate`;
            }
            if (auditAltre && paginazione) {
                auditAltre.style.display = paginazione.currentPage < paginazione.totalPages ? 'inline-block' : 'none';
            }
        } catch (error) {
            console.error('Errore caricamento registro operazioni:', error);
            if (!aggiungi) {
                auditBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color: var(--danger-text);">Impossibile caricare il registro.</td></tr>';
            }
        }
    }

    if (auditAggiorna) auditAggiorna.addEventListener('click', () => caricaRegistro(false));
    if (auditFiltroAzione) auditFiltroAzione.addEventListener('change', () => caricaRegistro(false));
    if (auditFiltroUtente) auditFiltroUtente.addEventListener('keyup', (e) => { if (e.key === 'Enter') caricaRegistro(false); });
    if (auditAltre) auditAltre.addEventListener('click', () => { auditPagina++; caricaRegistro(true); });

    // L'email di prova: l'esito resta a schermo, chi configura deve poterlo leggere.
    const emailProvaBtn = document.getElementById('email-prova-btn');
    const emailProvaA = document.getElementById('email-prova-a');
    const emailProvaEsito = document.getElementById('email-prova-esito');
    async function mandaEmailProva() {
        emailProvaBtn.disabled = true;
        emailProvaEsito.style.color = 'var(--info-text)';
        emailProvaEsito.textContent = 'Invio in corso...';
        try {
            const r = await fetchApi('/api/admin/email-prova', {
                method: 'POST',
                body: JSON.stringify({
                    a: emailProvaA?.value?.trim() || '',
                    smtp_host: smtpHostInput?.value?.trim() || '',
                    smtp_port: smtpPortInput?.value?.trim() || '',
                    smtp_secure: smtpSecureInput?.value || 'true',
                    smtp_user: smtpUserInput?.value?.trim() || '',
                    smtp_pass: smtpPassInput?.value?.trim() || ''
                })
            });
            emailProvaEsito.style.color = 'var(--success-text)';
            emailProvaEsito.textContent = r.message;
        } catch (error) {
            emailProvaEsito.style.color = 'var(--danger-text)';
            emailProvaEsito.textContent = error.message;
            if (error.body?.dettaglio) {
                const d = document.createElement('div');
                d.style.cssText = 'margin-top: 4px; font-size: 0.8rem; color: var(--text-muted); font-family: monospace; word-break: break-word;';
                d.textContent = `Risposta del server: ${error.body.dettaglio}`;
                emailProvaEsito.appendChild(d);
            }
        } finally {
            emailProvaBtn.disabled = false;
        }
    }
    emailProvaBtn?.addEventListener('click', mandaEmailProva);

    if (settingsForm) settingsForm.addEventListener('submit', handleSettingsSubmit);
    if (logoInput) logoInput.addEventListener('change', handleLogoUpload);
    if (logo2Input) logo2Input.addEventListener('change', handleLogo2Upload);

    if (mapPickerBtn) mapPickerBtn.addEventListener('click', openMapPicker);
    if (closeMapPickerModalBtn) closeMapPickerModalBtn.addEventListener('click', closeMapPicker);
    if (cancelMapSelectionBtn) cancelMapSelectionBtn.addEventListener('click', closeMapPicker);
    if (confirmMapSelectionBtn) confirmMapSelectionBtn.addEventListener('click', confirmMapSelection);

    loadAndApplySettings();
    caricaRegistro();
});
