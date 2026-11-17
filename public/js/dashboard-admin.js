quandoPronto(() => {
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
    
    const smtpHostInput = document.getElementById('smtp-host');
    const smtpPortInput = document.getElementById('smtp-port');
    const smtpSecureInput = document.getElementById('smtp-secure');
    const smtpUserInput = document.getElementById('smtp-user');
    const smtpPassInput = document.getElementById('smtp-pass');

    // Le porte le sceglie il server (attiva-drone.sh), non questa pagina: qui si vedono per aprirle sul router.
    function mostraPorteDrone(stato) {
        const blocco = document.getElementById('drone-porte-blocco');
        const campo = document.getElementById('drone-max-dirette');
        if (!blocco || !campo || !stato?.porte) return;
        campo.value = stato.max_dirette;
        campo.dataset.caricato = 'si';
        const quanti = () => parseInt(campo.value, 10) || 3;
        const scrivi = () => {
            document.getElementById('drone-porte').textContent = stato.configurato
                ? `Porte da aprire in ingresso verso questo server, le stesse per tutti i droni: ${stato.porte.rtmp}/TCP (RTMP, dal drone) e ${stato.porte.webrtc}/UDP (WebRTC, verso la sala). Banda in ingresso da prevedere: circa ${quanti() * 4} Mbit/s con ${quanti()} droni in onda; oltre il massimo il drone in più viene respinto e la sala lo vede nel pannello.`
                : 'Le porte le assegna attiva-drone.sh quando si installa MediaMTX su questo server.';
        };
        campo.addEventListener('input', scrivi);
        scrivi();
        blocco.hidden = false;
    }
    const maxDroneCaricato = () => document.getElementById('drone-max-dirette')?.dataset.caricato === 'si';

    const enableSegBtn = document.getElementById('enable-segreteria');
    const constraintsDiv = document.getElementById('segreteria-constraints');
    const enableMagBtn = document.getElementById('enable-magazzino');
    const enableFunzioniBtn = document.getElementById('enable-funzioni');
    const magazzinoNote = document.getElementById('magazzino-note');
    const blockMed = document.getElementById('block-on-medical');
    const blockCourse = document.getElementById('block-on-course');

    const badgeAlwaysOnInput = document.getElementById('badge-qr-always-on');
    const badgeQrEnabledInput = document.getElementById('badge-qr-enabled');
    const aggiornaRigaSempreAttivo = () => {
        const riga = document.getElementById('riga-badge-always-on');
        if (riga && badgeQrEnabledInput) riga.style.opacity = badgeQrEnabledInput.checked ? '' : '0.45';
        if (badgeAlwaysOnInput && badgeQrEnabledInput) badgeAlwaysOnInput.disabled = !badgeQrEnabledInput.checked;
    };
    badgeQrEnabledInput?.addEventListener('change', aggiornaRigaSempreAttivo);
    const appAndroidInput = document.getElementById('app-android-enabled');

    const cardDistrictLabelInput = document.getElementById('card-district-label');
    const cardRegionalEntityNameInput = document.getElementById('card-regional-entity-name');
    const logo2Input = document.getElementById('app-logo2');

    const settingsFeedback = document.getElementById('settings-feedback');
    const logoUploadFeedback = document.getElementById('logo-upload-feedback');
    const logo2UploadFeedback = document.getElementById('logo2-upload-feedback');

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

    // Vuoto o illeggibile restano i giorni di sempre: meglio un preavviso di troppo che nessuno.
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
                // La password non torna dal server: il campo vuoto la lascia com'è.
                if (smtpPassInput) {
                    smtpPassInput.value = '';
                    smtpPassInput.placeholder = settings.smtp_pass_impostata ? 'Salvata: lascia vuoto per non cambiarla' : 'Password o App Password';
                }
                if (badgeAlwaysOnInput) badgeAlwaysOnInput.checked = settings.badge_qr_always_on === 'true';
                if (badgeQrEnabledInput) badgeQrEnabledInput.checked = settings.badge_qr_enabled !== 'false';
                const cfSulTesserino = document.getElementById('badge-cf-barcode');
                if (cfSulTesserino) cfSulTesserino.checked = settings.badge_cf_barcode !== 'false';
                aggiornaRigaSempreAttivo();
                if (appAndroidInput) appAndroidInput.checked = settings.app_android_enabled !== 'false';
                if (cardDistrictLabelInput) cardDistrictLabelInput.value = settings.card_district_label || '';
                if (cardRegionalEntityNameInput) cardRegionalEntityNameInput.value = settings.card_regional_entity_name || '';
                await caricaAllerta(settings);

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
                        if (sidebarSegreteria && sConf.enabled && haPermesso('volontari.sanitario', 'volontari.anagrafica')) {
                            sidebarSegreteria.style.display = 'block';
                        }
                    } catch(e) { console.error("Errore parse segreteria_config"); }
                }

                // Una chiave a sé, non dentro magazzino_config: quella la salva il magazziniere, e due form che
                // scrivono lo stesso oggetto si cancellano a vicenda.
                if (enableMagBtn) {
                    enableMagBtn.checked = String(settings.magazzino_enabled) === 'true';
                    if (enableFunzioniBtn) enableFunzioniBtn.checked = String(settings.funzioni_enabled) === 'true';
                    const enableAttivitaBtn = document.getElementById('enable-attivita');
                    if (enableAttivitaBtn) enableAttivitaBtn.checked = String(settings.attivita_enabled) !== 'false';
                    const enableVoceBtn = document.getElementById('enable-voce');
                    if (enableVoceBtn) enableVoceBtn.checked = String(settings.voce_enabled) === 'true';
                    const enableDroneBtn = document.getElementById('enable-drone');
                    if (enableDroneBtn) enableDroneBtn.checked = String(settings.drone_enabled) === 'true';
                    fetchApi('/api/drone/stato').then(d => {
                        mostraPorteDrone(d);
                        const nota = document.getElementById('drone-configurazione');
                        if (!nota || d?.configurato) return;
                        nota.textContent = 'MediaMTX non è configurato su questo server: anche acceso, il drone non funziona finché non lo si installa.';
                        nota.className = 'messaggio messaggio-avviso';
                        nota.hidden = false;
                    }).catch(() => {});
                    const tastoVoce = document.getElementById('voce-tasto');
                    if (tastoVoce && settings.voce_tasto) tastoVoce.value = settings.voce_tasto;
                    const vociMagazzinoMenu = document.getElementById('sidebar-magazzino');
                    if (vociMagazzinoMenu) {
                        vociMagazzinoMenu.style.display =
                            (enableMagBtn.checked && haPermesso('magazzino.gestione', 'magazzino.consegne')) ? 'block' : 'none';
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
            notifica("Impostazioni non lette: ricarica la pagina prima di cambiarle.", 'errore');
        }
    }

    const allertaRegione = document.getElementById('allerta-regione');
    const allertaComune = document.getElementById('allerta-comune');
    const allertaAvvisa = document.getElementById('allerta-avvisa-da');
    const allertaZona = document.getElementById('allerta-zona');
    const allertaEsito = document.getElementById('allerta-esito');
    let centroMappaAllerta = null;

    let comuniDivisiAllerta = {};
    function scriviZonaAllerta() {
        if (!allertaZona) return;
        const divise = comuniDivisiAllerta[allertaComune.value];
        if (divise) {
            const scelta = divise.find(z => z.codice === centroMappaAllerta?.codice) || divise[0];
            allertaZona.textContent = `${allertaComune.value} è diviso fra le zone ${divise.map(z => z.codice).join(' e ')}: vale ${scelta.codice} (${scelta.nome}), ` +
                (scelta.codice === centroMappaAllerta?.codice ? 'quella in cui cade il centro della mappa.' : 'perché il centro della mappa non cade in nessuna delle due. Sposta il centro della mappa nella parte giusta del comune.');
            return;
        }
        allertaZona.textContent = allertaComune.value
            ? ''
            : centroMappaAllerta
                ? `Il centro della mappa cade nella zona ${centroMappaAllerta.codice} (${centroMappaAllerta.nome}).`
                : 'Il centro della mappa non cade in una zona di questa Regione: scegli il comune.';
    }

    async function caricaComuniAllerta(regione, scelto = '') {
        document.getElementById('allerta-dettagli').hidden = !regione;
        allertaComune.replaceChildren(new Option('Dal centro della mappa', ''));
        if (!regione) return;
        const r = await fetchApi(`/api/allerta/regioni?regione=${encodeURIComponent(regione)}`);
        (r.comuni || []).forEach(c => allertaComune.add(new Option(c, c)));
        allertaComune.value = (r.comuni || []).includes(scelto) ? scelto : '';
        centroMappaAllerta = r.centro_mappa;
        comuniDivisiAllerta = r.comuni_divisi || {};
        scriviZonaAllerta();
    }

    async function caricaAllerta(settings) {
        if (!allertaRegione) return;
        try {
            const r = await fetchApi('/api/allerta/regioni');
            allertaRegione.replaceChildren(new Option('Spento', ''));
            (r.regioni || []).forEach(x => allertaRegione.add(new Option(x.nome, x.codice)));
            allertaRegione.value = settings.allerta_regione || '';
            allertaAvvisa.value = settings.allerta_avvisa_da || 'arancione';
            await caricaComuniAllerta(allertaRegione.value, settings.allerta_comune || '');
        } catch (e) {
            if (allertaEsito) allertaEsito.textContent = e.message;
        }
    }

    function valoriAllerta() {
        if (!allertaRegione) return {};
        return {
            allerta_regione: allertaRegione.value,
            allerta_comune: allertaRegione.value ? allertaComune.value : '',
            allerta_avvisa_da: allertaAvvisa.value
        };
    }

    allertaRegione?.addEventListener('change', () => caricaComuniAllerta(allertaRegione.value).catch(e => { allertaEsito.textContent = e.message; }));
    allertaComune?.addEventListener('change', scriviZonaAllerta);
    document.getElementById('allerta-leggi')?.addEventListener('click', async (e) => {
        const bottone = e.currentTarget;
        bottone.disabled = true;
        allertaEsito.textContent = 'Lettura in corso…';
        try {
            // Prima si salva, poi si legge: il bollettino è per la zona salvata.
            await fetchApi('/api/branding/settings', { method: 'PUT', body: JSON.stringify(valoriAllerta()) });
            const stato = await fetchApi('/api/allerta/controlla', { method: 'POST' });
            const a = await fetchApi('/api/allerta');
            const giorni = a.bollettino?.validi || [];
            const nomi = { verde: 'nessuna allerta', gialla: 'gialla', arancione: 'arancione', rossa: 'rossa' };
            allertaEsito.textContent = stato.errore
                ? `Bollettino non letto: ${stato.errore}.`
                : !a.zona ? 'Letto, ma manca la zona: scegli il comune.'
                : giorni.length
                    ? `Zona ${a.zona.codice}: ${giorni.map((g, i) => `${i ? 'domani' : 'oggi'} ${g.massimo ? nomi[g.massimo] : 'non trasmessa'}`).join(', ')} (${a.bollettino.titolo}).`
                    : `Zona ${a.zona.codice}: nessun bollettino valido per oggi.`;
        } catch (err) {
            allertaEsito.textContent = err.message;
        } finally {
            bottone.disabled = false;
        }
    });

    // I campi vuoti vogliono dire "valore predefinito"; la virgola all'italiana diventa punto.
    function controllaMappa() {
        const leggi = (input) => (input?.value ?? '').trim().replace(',', '.');
        const fuori = (testo, minimo, massimo, intero) => {
            if (testo === '') return false;
            const n = Number(testo);
            return !Number.isFinite(n) || n < minimo || n > massimo || (intero && !Number.isInteger(n));
        };
        const lat = leggi(mapCenterLatInput), lon = leggi(mapCenterLonInput), zoom = leggi(mapZoomInput);
        const erroreCentro = [fuori(lat, -90, 90) && 'la latitudine va da -90 a 90', fuori(lon, -180, 180) && 'la longitudine va da -180 a 180']
            .filter(Boolean).join('; ');
        const erroreZoom = fuori(zoom, 1, 18, true) ? 'Lo zoom è un numero intero da 1 a 18.' : '';
        const scrivi = (id, testo) => { const e = document.getElementById(id); if (e) { e.textContent = testo; e.hidden = !testo; } };
        scrivi('map-center-errore', erroreCentro ? `Non va: ${erroreCentro} (per esempio 45.4064 oppure 45,4064).` : '');
        scrivi('map-zoom-errore', erroreZoom);
        if (erroreCentro || erroreZoom) return null;
        if (mapCenterLatInput) mapCenterLatInput.value = lat;
        if (mapCenterLonInput) mapCenterLonInput.value = lon;
        return { lat, lon, zoom };
    }

    // I valori come li mostra la pagina, nella forma in cui si salvano. La password della posta non c'è:
    // non torna dal server, si manda solo se scritta.
    function valoriPagina() {
        const spunta = (id) => (document.getElementById(id)?.checked ? 'true' : 'false');
        const testo = (input) => input?.value?.trim() || '';
        return {
            association_name: testo(associationNameInput),
            map_center_lat: testo(mapCenterLatInput).replace(',', '.'),
            map_center_lon: testo(mapCenterLonInput).replace(',', '.'),
            map_zoom_level: testo(mapZoomInput),
            minuti_attesa_critica: testo(minutiAttesaInput),
            smtp_host: testo(smtpHostInput),
            smtp_port: testo(smtpPortInput),
            smtp_secure: smtpSecureInput?.value || 'true',
            smtp_user: testo(smtpUserInput),
            badge_qr_always_on: spunta('badge-qr-always-on'),
            badge_qr_enabled: spunta('badge-qr-enabled'),
            badge_cf_barcode: spunta('badge-cf-barcode'),
            app_android_enabled: spunta('app-android-enabled'),
            magazzino_enabled: spunta('enable-magazzino'),
            funzioni_enabled: spunta('enable-funzioni'),
            attivita_enabled: spunta('enable-attivita'),
            voce_enabled: spunta('enable-voce'),
            drone_enabled: spunta('enable-drone'),
            ...(maxDroneCaricato() ? { drone_max_dirette: testo(document.getElementById('drone-max-dirette')) } : {}),
            voce_tasto: document.getElementById('voce-tasto')?.value || 'F9',
            ...valoriAllerta(),
            card_district_label: testo(cardDistrictLabelInput),
            card_regional_entity_name: testo(cardRegionalEntityNameInput),
            segreteria_config: JSON.stringify({
                enabled: enableSegBtn?.checked || false,
                block_on_medical: blockMed?.checked || false,
                block_on_course: blockCourse?.checked || false,
                notify_user: notifyUserBtn?.checked || false,
                notify_admin: notifyAdminsBtn?.checked || false,
                custom_emails: testo(customEmailsInput),
                notice_days: leggiGiorniPreavviso(),
                custom_user_email_template: testo(customEmailTemplateInput)
            })
        };
    }

    // Si manda solo quello che è cambiato rispetto a quanto letto: salvare la mappa non deve toccare
    // i moduli, e due amministratori non devono cancellarsi le scelte a vicenda.
    let copia = null;
    function cambiati() {
        if (!copia) return {};
        const ora = valoriPagina();
        const diversi = Object.fromEntries(Object.entries(ora).filter(([k, v]) => copia[k] !== v));
        if (smtpPassInput?.value?.trim()) diversi.smtp_pass = smtpPassInput.value.trim();
        return diversi;
    }
    const barraSalva = document.getElementById('barra-salva');
    function aggiornaBarra() {
        const quanti = Object.keys(cambiati()).length;
        barraSalva.hidden = quanti === 0;
        if (quanti) {
            settingsFeedback.textContent = 'Hai modifiche non salvate';
            settingsFeedback.classList.remove('errore');
        }
    }
    window.addEventListener('beforeunload', (e) => {
        if (Object.keys(cambiati()).length) { e.preventDefault(); e.returnValue = ''; }
    });

    // Gli interruttori dei moduli valgono subito, ognuno con la sua sola chiave.
    const MODULI = {
        'enable-segreteria': ['segreteria_config', 'Segreteria'], 'enable-magazzino': ['magazzino_enabled', 'Magazzino'],
        'enable-funzioni': ['funzioni_enabled', 'Funzioni di supporto'], 'enable-attivita': ['attivita_enabled', 'Attività e calendario'],
        'enable-voce': ['voce_enabled', 'Orion Voice'], 'enable-drone': ['drone_enabled', 'Drone'], 'badge-qr-enabled': ['badge_qr_enabled', 'QR dei volontari'],
        'app-android-enabled': ['app_android_enabled', 'App Android']
    };
    function esitoModulo(interruttore) {
        const contenitore = interruttore.closest('.option-card')?.parentElement || interruttore.closest('.form-group');
        let esito = contenitore.querySelector(':scope > .esito-modulo');
        if (!esito) {
            esito = document.createElement('span');
            esito.className = 'esito-modulo';
            esito.setAttribute('role', 'status');
            contenitore.appendChild(esito);
        }
        return esito;
    }
    for (const [id, [chiave, nome]] of Object.entries(MODULI)) {
        const interruttore = document.getElementById(id);
        interruttore?.addEventListener('change', async () => {
            const acceso = interruttore.checked;
            let valore = acceso ? 'true' : 'false';
            if (chiave === 'segreteria_config') {
                const conf = JSON.parse(copia?.segreteria_config || '{}');
                conf.enabled = acceso;
                valore = JSON.stringify(conf);
            }
            const esito = esitoModulo(interruttore);
            interruttore.disabled = true;
            try {
                await fetchApi('/api/branding/settings', { method: 'PUT', body: JSON.stringify({ [chiave]: valore }) });
                if (copia) copia[chiave] = valore;
                esito.textContent = `${nome} ${acceso ? 'acceso' : 'spento'}.`;
                esito.className = 'esito-modulo ok';
            } catch (err) {
                interruttore.checked = !acceso;
                if (constraintsDiv && enableSegBtn) constraintsDiv.style.display = enableSegBtn.checked ? 'block' : 'none';
                if (magazzinoNote && enableMagBtn) magazzinoNote.style.display = enableMagBtn.checked ? 'block' : 'none';
                esito.textContent = `Non salvato: ${err.message}`;
                esito.className = 'esito-modulo errore';
            } finally {
                interruttore.disabled = false;
                aggiornaBarra();
            }
        });
    }

    async function handleSettingsSubmit(event) {
        event.preventDefault();
        const mappa = controllaMappa();
        if (!mappa) {
            settingsFeedback.textContent = 'Correggi i valori della mappa segnati in rosso.';
            settingsFeedback.classList.add('errore');
            return;
        }
        const daSalvare = cambiati();
        if (!Object.keys(daSalvare).length) { aggiornaBarra(); return; }
        const submitButton = settingsForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        try {
            await fetchApi('/api/branding/settings', { method: 'PUT', body: JSON.stringify(daSalvare) });
            const { smtp_pass: _password, ...salvati } = daSalvare;
            Object.assign(copia, salvati);
            if (smtpPassInput && daSalvare.smtp_pass) {
                smtpPassInput.value = '';
                smtpPassInput.placeholder = 'Salvata: lascia vuoto per non cambiarla';
            }
            if ('association_name' in daSalvare) document.title = `Pannello Amministrazione - ${daSalvare.association_name || 'ORION'}`;
            aggiornaBarra();
            notifica('Impostazioni salvate.', 'successo');
        } catch (error) {
            settingsFeedback.textContent = `Non salvato: ${error.message}`;
            settingsFeedback.classList.add('errore');
        } finally {
            submitButton.disabled = false;
        }
    }

    document.getElementById('annulla-modifiche')?.addEventListener('click', async () => {
        if (smtpPassInput) smtpPassInput.value = '';
        await loadAndApplySettings();
        copia = valoriPagina();
        aggiornaBarra();
    });
    settingsForm?.addEventListener('input', (e) => { if (!MODULI[e.target.id]) aggiornaBarra(); });
    settingsForm?.addEventListener('change', (e) => { if (!MODULI[e.target.id]) aggiornaBarra(); });

    const indice = document.querySelectorAll('.impostazioni-indice a');
    const osservatore = new IntersectionObserver((voci) => {
        for (const v of voci) {
            if (!v.isIntersecting) continue;
            indice.forEach(a => a.classList.toggle('in-vista', a.getAttribute('href') === `#${v.target.id}`));
            const tendina = document.getElementById('impostazioni-vai');
            if (tendina) tendina.value = v.target.id;
        }
    }, { rootMargin: '-15% 0px -70% 0px' });
    document.querySelectorAll('.sezione-impostazioni, .sezione-esterna').forEach(s => osservatore.observe(s));
    document.getElementById('impostazioni-vai')?.addEventListener('change', (e) => {
        document.getElementById(e.target.value)?.scrollIntoView({ behavior: 'smooth' });
    });

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
        import('/js/mappa-strumenti.js').then(({ creaRicerca }) => creaRicerca(pickerMap, {
            position: 'topright',
            cercaLocale: () => [],
            suScelta: (r) => {
                if (!Number.isFinite(r?.lat) || !Number.isFinite(r?.lng)) return;
                pickerMap.setView([r.lat, r.lng], Math.max(pickerMap.getZoom(), 13));
                onPickerMapClick({ latlng: L.latLng(r.lat, r.lng) });
            }
        })).catch(e => console.warn('Ricerca non disponibile nella scelta del centro:', e.message));
    }

    function openMapPicker() {
        if (!mapPickerModal) return;
        mapPickerModal.style.display = 'flex';
        initPickerMap();

        const lat = parseFloat(mapCenterLatInput.value);
        const lon = parseFloat(mapCenterLonInput.value);
        const salvato = Number.isFinite(lat) && Number.isFinite(lon);
        const zoom = parseInt(mapZoomInput.value, 10) || 10;

        // Leaflet ha bisogno di un attimo prima di ridimensionarsi in un modale.
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
        'libretto.corso_eliminato': 'Corso eliminato dal libretto',
        'esterno_temporaneo.codice_riletto': 'Codice di un esterno riletto',
        'esterno_temporaneo.invito_rimandato': 'Codice di un esterno mandato per email'
    };

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
    if (confirmMapSelectionBtn) confirmMapSelectionBtn.addEventListener('click', () => { confirmMapSelection(); aggiornaBarra(); });

    loadAndApplySettings().then(() => { copia = valoriPagina(); aggiornaBarra(); });
    caricaRegistro();
});

// La trascrizione si sceglie a parte dal salvataggio: un modello nuovo fa partire uno scaricamento lungo.
document.addEventListener('DOMContentLoaded', () => {
    const scelta = document.getElementById('voce-trascrizione-modello');
    const stato = document.getElementById('voce-trascrizione-stato');
    const applica = document.getElementById('voce-trascrizione-applica');
    if (!scelta || !stato || !applica) return;
    let attesa = null;

    function mostra(d) {
        clearTimeout(attesa);
        scelta.replaceChildren(new Option('Spenta', ''), ...d.modelli.map(m =>
            new Option(`${m.nome}: ${m.mb} MB, circa ${m.memoria_mb} MB di memoria${m.memoria_sufficiente ? '' : ' (non bastano)'}${m.scaricato ? '' : ', da scaricare'}`, m.id)));
        scelta.value = d.modello || '';
        const inCorso = d.modelli.find(m => m.scaricamento && !m.scaricamento.errore);
        const fallito = d.modelli.find(m => m.scaricamento?.errore && m.id === d.modello);
        const scelto = d.modelli.find(m => m.id === d.modello);
        if (!d.programma) stato.textContent = 'Questa installazione non ha il programma di trascrizione: serve l\'immagine Docker di ORION.';
        else if (inCorso) stato.textContent = `Scarico il modello ${inCorso.nome}: ${inCorso.scaricamento.ricevuti_mb} di ${inCorso.scaricamento.totale_mb} MB...`;
        else if (fallito) stato.textContent = `Scaricamento del modello ${fallito.nome} non riuscito: ${fallito.scaricamento.errore}.`;
        else if (scelto) {
            stato.textContent = `Attiva con il modello ${scelto.nome}` +
                (d.rapporto != null ? `: ${String(d.rapporto).replace('.', ',')} s di calcolo per ogni secondo di voce` : '') +
                (d.in_coda ? `, ${d.in_coda} messaggi in coda.` : '.') +
                (d.rapporto > 1 ? ' Più lenta del parlato: in un\'emergenza intensa la coda cresce, meglio un modello più veloce.' : '') +
                (d.ultimo_errore ? ` L'ultimo messaggio non è stato trascritto: ${d.ultimo_errore.messaggio}.` : '');
        } else stato.textContent = 'Spenta.';
        if (d.programma && d.come_alzare_la_memoria && d.modelli.some(m => !m.memoria_sufficiente)) {
            stato.textContent += ` Memoria libera per la trascrizione: ${d.memoria_libera_mb} MB. ${d.come_alzare_la_memoria}`;
        }
        if (inCorso) attesa = setTimeout(aggiorna, 2000);
    }

    async function aggiorna() {
        try {
            mostra(await fetchApi('/api/voce/trascrizione'));
        } catch (e) {
            stato.textContent = e.message;
        }
    }

    applica.addEventListener('click', async () => {
        try {
            mostra(await fetchApi('/api/voce/trascrizione', { method: 'POST', body: JSON.stringify({ modello: scelta.value || null }) }));
        } catch (e) {
            stato.textContent = e.message;
        }
    });
    aggiorna();
});
