
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

            if (settings.segreteria_config) {
                const sConf = typeof settings.segreteria_config === 'string' ? JSON.parse(settings.segreteria_config) : settings.segreteria_config;

                const sidebarSegreteria = document.getElementById('sidebar-segreteria');
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

quandoPronto(async () => {
    if (!haPermesso('emergenze.archivio')) {
        notifica('Accesso negato: ti serve il permesso "Consultare le emergenze passate".', 'errore');
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
    const printResocontoLink = document.getElementById('print-resoconto-link');
    const printTuttoLink = document.getElementById('print-tutto-link');
    const azioniEmergenza = document.getElementById('ar-azioni');

    let selectedArchivedEmergency = null;
    let tutteLeChiuse = [];
    let filtro = 'emergenze';

let brandingSettings = {
    association_name: 'Archivio Emergenze'
};

    if (!emergencySelect || !reportsTableBody || !reportsSection || !emergencyDetailsDisplay) {
        console.error("Elementi HTML necessari non trovati nella pagina archivio.");
        return;
    }

    function descriviPeriodo(inizio, fine) {
        if (!inizio) return '';
        const f = (d) => new Date(d).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        if (!fine) return `Aperta il ${f(inizio)}`;
        const ore = Math.max(0, Math.round((new Date(fine) - new Date(inizio)) / 3600000));
        const durata = ore < 1 ? "meno di un'ora" : ore < 48 ? `${ore} ${ore === 1 ? 'ora' : 'ore'}` : `${Math.round(ore / 24)} giorni`;
        return `Dal ${f(inizio)} al ${f(fine)} · ${durata}`;
    }

    const formatDate = (dtString) => dtString ? new Date(dtString).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short'}) : 'N/A';

    async function loadClosedEmergencies() {
        selectedArchivedEmergency = null;
        if (azioniEmergenza) azioniEmergenza.hidden = true;
        emergencyDetailsDisplay.textContent = '';
        reportsSection.style.display = 'none';
        reportsTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Seleziona un\'emergenza.</td></tr>';

        try {
            tutteLeChiuse = await fetchApi('/api/admin/emergencies/closed') || [];
            riempiScelta();
        } catch (error) {
            console.error("Errore caricamento emergenze archiviate:", error);
             emergencySelect.innerHTML = '<option value="">Errore caricamento</option>';
        }
    }

    function riempiScelta() {
        const elenco = tutteLeChiuse.filter(e => filtro === 'tutte' || (filtro === 'simulazioni') === !!e.simulazione);
        const nome = filtro === 'simulazioni' ? 'una simulazione' : "un'emergenza";
        emergencySelect.innerHTML = '';
        emergencySelect.appendChild(new Option(elenco.length ? `-- Seleziona ${nome} archiviata --` : (filtro === 'simulazioni' ? 'Nessuna simulazione archiviata.' : 'Nessuna emergenza archiviata trovata.'), ''));
        for (const em of elenco) {
            const option = document.createElement('option');
            option.value = em.id;
            const endDate = em.end_time ? `Chiusa: ${formatDate(em.end_time)}` : 'Data chiusura non disp.';
            const segno = em.simulazione ? (em.interrotta_il ? '[SIMULAZIONE INTERROTTA] ' : '[SIMULAZIONE] ') : '';
            option.textContent = `${segno}${em.code} ${em.name ? '- ' + em.name : ''} (${endDate})`;
            option.dataset.code = em.code;
            option.dataset.name = em.name || '';
            option.dataset.inizio = em.start_time || '';
            option.dataset.fine = em.end_time || '';
            option.dataset.simulazione = em.simulazione ? '1' : '';
            option.dataset.attivita = em.attivita_id || '';
            option.dataset.interrotta = em.interrotta_da_codice || (em.interrotta_il ? '?' : '');
            emergencySelect.appendChild(option);
        }
    }
    document.querySelectorAll('.ar-filtro [data-filtro]').forEach(b => b.addEventListener('click', () => {
        filtro = b.dataset.filtro;
        document.querySelectorAll('.ar-filtro [data-filtro]').forEach(x => {
            const su = x === b;
            x.setAttribute('aria-pressed', String(su));
            x.classList.toggle('button-secondary', !su);
        });
        emergencySelect.value = '';
        emergencySelect.dispatchEvent(new Event('change'));
        riempiScelta();
    }));

    // L'audio si scarica solo quando si preme play: ogni ascolto dall'archivio finisce nel registro.
    function lettoreVoce(id) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.src = `/api/voce/messaggi/${id}/audio`;
        audio.className = 'ar-voce-audio';
        return audio;
    }

    function trascrizioneVoce(testo) {
        const p = document.createElement('p');
        p.className = 'ar-voce-trascrizione';
        p.title = 'Trascrizione automatica: può contenere errori';
        p.textContent = `«${testo}»`;
        return p;
    }

    let attesaRicercaVoce = null;
    // Un volo per drone, rivisto di seguito come un video solo; i pezzi da un minuto si scaricano uno per uno.
    // Ogni apertura finisce nel registro delle operazioni.
    let lettoreDrone = null;
    async function caricaRipreseDrone(emergencyId) {
        const sezione = document.getElementById('archived-drone-section');
        const elenco = document.getElementById('archived-drone-list');
        const posto = document.getElementById('archived-drone-lettore');
        if (!sezione || !elenco || !posto) return;
        sezione.hidden = true;
        lettoreDrone?.chiudi();
        lettoreDrone = null;
        posto.replaceChildren();
        posto.hidden = true;
        let riprese = [];
        try { riprese = await fetchApi(`/api/drone/registrazioni?emergenza=${encodeURIComponent(emergencyId)}`); } catch { return; }
        if (!riprese.length) return;
        const ora = (d) => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const voli = new Map();
        for (const r of riprese) {
            const chiave = r.chiave_id ?? `nome:${r.nome_drone}`;
            if (!voli.has(chiave)) voli.set(chiave, []);
            voli.get(chiave).push(r);
        }
        const crea = (tag, classe, testo) => { const e = document.createElement(tag); if (classe) e.className = classe; if (testo !== undefined) e.textContent = testo; return e; };
        elenco.replaceChildren(...[...voli.values()].map(pezzi => {
            const li = crea('li');
            li.style.cssText = 'padding: 10px 0; border-top: 1px solid var(--border-color);';
            const riga = crea('div');
            riga.style.cssText = 'display: flex; gap: 10px; align-items: center; flex-wrap: wrap;';
            const secondi = pezzi.reduce((t, r) => t + Math.max(1, (new Date(r.finita_il) - new Date(r.iniziata_il)) / 1000), 0);
            const mb = pezzi.reduce((t, r) => t + Number(r.dimensione || 0), 0) / 1048576;
            const testo = crea('span', null, `${pezzi[0].nome_drone} · dalle ${ora(pezzi[0].iniziata_il)} alle ${ora(pezzi[pezzi.length - 1].finita_il)} · ${Math.max(1, Math.round(secondi / 60))} min registrati · ${Math.round(mb)} MB`);
            testo.style.flex = '1';
            const guarda = crea('button', 'button-style button-small', 'Rivedi');
            guarda.type = 'button';
            guarda.addEventListener('click', () => {
                lettoreDrone?.chiudi();
                lettoreDrone = DroneVideo.rivedi(pezzi, { suErrore: (m) => notifica(m, 'errore') });
                posto.replaceChildren(lettoreDrone.nodo);
                posto.hidden = false;
                posto.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
            riga.append(testo, guarda);
            const dettagli = crea('details');
            dettagli.append(crea('summary', null, `Scarica i pezzi da un minuto (${pezzi.length})`));
            const lista = crea('div');
            lista.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; padding-top: 6px;';
            for (const r of pezzi) {
                const a = crea('a', 'button-style button-small button-secondary', new Date(r.iniziata_il).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));
                a.href = `/api/drone/registrazioni/${encodeURIComponent(r.id)}/file?scarica=1`;
                lista.append(a);
            }
            dettagli.append(lista);
            li.append(riga, dettagli);
            return li;
        }));
        sezione.hidden = false;
    }

    async function caricaVoceArchiviata(emergencyId, cercato = '') {
        const sezione = document.getElementById('archived-voce-section');
        const elenco = document.getElementById('archived-voce-list');
        const ricerca = document.getElementById('archived-voce-cerca');
        if (!sezione || !elenco) return;
        if (!cercato) {
            sezione.hidden = true;
            if (ricerca) ricerca.value = '';
        }
        if (!emergencyId) return;
        if (ricerca) ricerca.oninput = () => {
            clearTimeout(attesaRicercaVoce);
            attesaRicercaVoce = setTimeout(() => caricaVoceArchiviata(emergencyId, ricerca.value.trim()), 300);
        };
        let messaggi;
        try {
            ({ messaggi } = await fetchApi(`/api/voce/archivio/${emergencyId}${cercato ? `?q=${encodeURIComponent(cercato)}` : ''}`));
        } catch {
            return;
        }
        if (!messaggi?.length && !cercato) return;
        sezione.hidden = false;
        const perCanale = {};
        messaggi.forEach(m => {
            const nome = m.nome_radio || (m.tipo === 'avviso' ? 'Avvisi a tutti' : m.tipo === 'generale' ? 'Generale' : 'Diretti');
            perCanale[nome] = (perCanale[nome] || 0) + 1;
        });
        document.getElementById('archived-voce-riepilogo').textContent = cercato ? `${messaggi.length} messaggi trovati.` :
            `${messaggi.length} messaggi: ` + Object.entries(perCanale).map(([n, q]) => `${n} ${q}`).join(', ') + '.';
        elenco.innerHTML = '';
        messaggi.forEach(m => {
            const li = document.createElement('li');
            const testo = document.createElement('span');
            const quando = new Date(m.registrato_il).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
            const canale = m.nome_radio || (m.tipo === 'avviso' ? 'avviso a tutti' : m.tipo);
            const segni = [m.priorita !== 'normale' ? m.priorita : '', m.differito ? 'differito' : '', m.stato === 'interrotto' ? 'interrotto' : '',
                m.ricevuto_da ? `ricevuto da ${m.ricevuto_da}` : '', m.presa_da ? `presa in carico da ${m.presa_da}` : ''].filter(Boolean);
            testo.textContent = `${quando} · ${canale} · ${m.autore.nome}${m.autore.squadra && !m.da_sala ? ` (${m.autore.squadra})` : ''} · ${Math.max(1, Math.round(m.durata_ms / 1000))} s${segni.length ? ` · ${segni.join(', ')}` : ''}`;
            const scarica = document.createElement('a');
            scarica.href = `/api/voce/messaggi/${m.id}/audio`;
            scarica.download = `voce-${m.id}.ogg`;
            scarica.className = 'button-style button-small button-secondary';
            scarica.innerHTML = '<i class="fas fa-download"></i>';
            scarica.title = 'Scarica l\'audio';
            li.append(testo, lettoreVoce(m.id), scarica);
            if (m.trascrizione) li.append(trascrizioneVoce(m.trascrizione));
            elenco.appendChild(li);
        });
    }

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
                    <i class="far fa-file-lines doc-icon"></i>
                    <div class="doc-info">
                        <span class="doc-filename">${escapeHTML(doc.original_filename)}</span>
                        <small class="doc-meta">Caricato da ${escapeHTML(doc.uploader_fullname)} il ${escapeHTML(uploadedAt)}</small>
                    </div>
                </a>
            `;
            docsListContainer.appendChild(docElement);
        });
    }

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
                            <a href="/print-report.html?id=${report.id}" target="_blank" rel="noopener" class="button-style button-small button-secondary" title="Stampa la segnalazione #${escapeHTML(displayValue)}">
                                <i class="fas fa-print"></i> Stampa
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
            const sim = selectedOption.dataset.simulazione === '1';
            const interrotta = selectedOption.dataset.interrotta;
            emergencyDetailsDisplay.textContent = (sim ? `Simulazione${interrotta ? `, interrotta${interrotta !== '?' ? ` dall'emergenza ${interrotta}` : ''}` : ''}. ` : '')
                + descriviPeriodo(selectedOption.dataset.inizio, selectedOption.dataset.fine);
            const copione = document.getElementById('copione-link');
            if (copione) {
                copione.hidden = !(sim && selectedOption.dataset.attivita);
                copione.href = `/copione.html?attivita=${encodeURIComponent(selectedOption.dataset.attivita)}#valutazione`;
            }
            console.log("[Select Change] Emergenza selezionata:", selectedArchivedEmergency);
            loadArchivedReports(selectedArchivedEmergency.id);
            loadArchivedDocuments(selectedArchivedEmergency.id);
            caricaVoceArchiviata(selectedArchivedEmergency.id);
            caricaRipreseDrone(selectedArchivedEmergency.id);
            // Basta un link: il cookie di sessione viaggia da solo.
            if (downloadResocontoLink) {
                downloadResocontoLink.href = `/api/admin/emergencies/${selectedArchivedEmergency.id}/resoconto`;
                downloadResocontoLink.title = `Il resoconto di ${selectedArchivedEmergency.code} come file di testo, da allegare`;
            }
            const csv = document.getElementById('esporta-csv-link');
            const geo = document.getElementById('esporta-geojson-link');
            if (csv) csv.href = `/api/admin/emergencies/${encodeURIComponent(selectedArchivedEmergency.id)}/segnalazioni.csv`;
            if (geo) geo.href = `/api/admin/emergencies/${encodeURIComponent(selectedArchivedEmergency.id)}/mappa.geojson`;
            if (printResocontoLink) printResocontoLink.href = `/situazione.html?emergenza=${encodeURIComponent(selectedArchivedEmergency.id)}`;
            if (printTuttoLink) printTuttoLink.href = `/situazione.html?emergenza=${encodeURIComponent(selectedArchivedEmergency.id)}&completo=1`;
            if (azioniEmergenza) azioniEmergenza.hidden = false;
        } else {
            selectedArchivedEmergency = null;
            loadArchivedReports(null);
            loadArchivedDocuments(null);
            caricaVoceArchiviata(null);
            if (azioniEmergenza) azioniEmergenza.hidden = true;
            emergencyDetailsDisplay.textContent = '';
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
                   deleteSelectedEmergencyBtn.disabled = false;
                   deleteSelectedEmergencyBtn.innerHTML = '<i class="fas fa-trash-can"></i> Elimina Selezionata';
             }
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
              if (selectedArchivedEmergency && selectedArchivedEmergency.id == deletedId) {
                   loadArchivedReports(null);
                   emergencyDetailsDisplay.textContent = '';
                   if (azioniEmergenza) azioniEmergenza.hidden = true;
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
            populateArchivedElement('archived-detail-env-hazard', report.environmental_hazard, '');
            const riquadroPericolo = document.getElementById('archived-detail-env-hazard-box');
            if (riquadroPericolo) riquadroPericolo.hidden = !String(report.environmental_hazard || '').trim();
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

                                const updaterName = update.updater_fullname || 'Sistema/Sconosciuto';
                                const updateDate = new Date(update.update_timestamp).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });

                                const small = document.createElement('small');
                                small.textContent = `Da: ${updaterName} - ${updateDate}`;
                                
                                li.appendChild(p);
                                li.appendChild(small);
                                if (update.voce_id) li.appendChild(lettoreVoce(update.voce_id));
                                if (update.voce_trascrizione) li.appendChild(trascrizioneVoce(update.voce_trascrizione));
                                
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

    function closeArchivedDetailModal() {
         if (archivedDetailModal) archivedDetailModal.style.display = 'none';
    }

    if(closeArchivedDetailModalBtn) closeArchivedDetailModalBtn.addEventListener('click', closeArchivedDetailModal);
    if(cancelArchivedDetailModalBtn) cancelArchivedDetailModalBtn.addEventListener('click', closeArchivedDetailModal);

    loadClosedEmergencies();

});
