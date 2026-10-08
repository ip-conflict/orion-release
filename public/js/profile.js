// GESTIONE PROFILO VOLONTARIO (Anagrafica, QR Code, PDF)

let currentUserData = null;
let currentLibrettoData = null; 
let brandingSettings = {
    association_name: 'PROTEZIONE CIVILE'
};

async function loadAndApplyBranding() {
    try {
        const settings = await fetchApi('/api/branding/settings');
        if (settings && settings.association_name) {
            brandingSettings.association_name = settings.association_name;
        }
    } catch (error) {
        console.error("Errore caricamento branding:", error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadAndApplyBranding();
    
    setupNavigation();

    loadUserProfile();

    setupPasswordForm();
    
    setupPhotoUpload();
    
    document.getElementById('btn-print-badge').addEventListener('click', generatePDFLibretto);
});

// NAVIGAZIONE
function setupNavigation() {
    const navLibretto = document.getElementById('nav-libretto');
    const navPassword = document.getElementById('nav-password');
    const secLibretto = document.getElementById('section-libretto');
    const secPassword = document.getElementById('section-password');

    navLibretto.addEventListener('click', (e) => {
        e.preventDefault();
        navLibretto.classList.add('active'); navPassword.classList.remove('active');
        secLibretto.style.display = 'block'; secPassword.style.display = 'none';
    });

    navPassword.addEventListener('click', (e) => {
        e.preventDefault();
        navPassword.classList.add('active'); navLibretto.classList.remove('active');
        secPassword.style.display = 'block'; secLibretto.style.display = 'none';
    });
}

// CARICAMENTO DATI PROFILO
async function loadUserProfile() {
    try {
        const user = await fetchApi('/api/users/me');
        currentUserData = user;

        // Compila intestazione
        document.getElementById('profile-fullname').textContent = `${user.nome} ${user.cognome}`;
        document.getElementById('profile-role').textContent = user.role;
        if (user.photo_url) {
            document.getElementById('profile-photo').src = user.photo_url;
        }

        // Compila Modulo Anagrafica
        document.getElementById('prof_cf').value = user.codice_fiscale || '';
        document.getElementById('prof_telefono').value = user.telefono || '';
        document.getElementById('prof_indirizzo').value = user.indirizzo || '';
        document.getElementById('prof_citta').value = user.citta || '';
        document.getElementById('prof_cap').value = user.cap || '';

        generateQRCode(user.public_token);

        loadMioLibretto(user.id);
        caricaMiePresenze();

    } catch (error) {
        console.error("Errore caricamento profilo:", error);
        notifica("Impossibile caricare i dati del profilo.", 'errore');
    }
}

// GENERAZIONE QR CODE
function generateQRCode(token) {
    const container = document.getElementById('qrcode-container');
    container.innerHTML = '';
    // Niente token: l'associazione ha spento i QR dei tesserini, e il riquadro
    // non ha niente da mostrare.
    const blocco = document.getElementById('blocco-qr-profilo');
    if (blocco) blocco.hidden = !token;
    if (!token) return;

    // L'URL pubblico che chi scansiona il QR Code aprirà
    const verificationUrl = `${window.location.origin}/badge.html?token=${token}`;

    new QRCode(container, {
        text: verificationUrl,
        width: 140,
        height: 140,
        colorDark : "#1e293b",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

// SALVATAGGIO ANAGRAFICA
document.getElementById('profile-anagrafica-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-profile');
    
    const payload = {
        codice_fiscale: document.getElementById('prof_cf').value,
        telefono: document.getElementById('prof_telefono').value,
        indirizzo: document.getElementById('prof_indirizzo').value,
        citta: document.getElementById('prof_citta').value,
        cap: document.getElementById('prof_cap').value
    };

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';
        
        await fetchApi('/api/users/me/anagrafica', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        
        currentUserData = { ...currentUserData, ...payload };
        
        // Feedback visivo
        btn.style.background = '#10b981';
        btn.innerHTML = '<i class="fas fa-check"></i> Salvato!';
        setTimeout(() => {
            btn.style.background = '';
            btn.innerHTML = '<i class="fas fa-save"></i> Salva';
        }, 3000);

    } catch (error) {
        notifica(`Errore: ${error.message}`, 'errore');
        btn.innerHTML = '<i class="fas fa-save"></i> Salva';
    } finally {
        btn.disabled = false;
    }
});

// CARICAMENTO LIBRETTO (Corsi e Visite)
// Le presenze dell'anno: attività ed emergenze, con le ore e l'attestato di ognuna.
async function caricaMiePresenze() {
    const card = document.getElementById('card-mie-presenze');
    const lista = document.getElementById('my-presenze-list');
    if (!card || !lista) return;
    let dati;
    try { dati = await fetchApi('/api/presenze/mie'); } catch { return; }
    card.hidden = false;
    document.getElementById('titolo-mie-presenze').textContent = `Le mie presenze nel ${dati.anno}: ${dati.ore_totali}`;
    lista.replaceChildren();
    if (!dati.voci.length) {
        const li = document.createElement('li');
        li.textContent = "Nessuna presenza quest'anno.";
        lista.appendChild(li);
        return;
    }
    for (const v of dati.voci.slice(0, 15)) {
        const li = document.createElement('li');
        const quando = new Date(String(v.inizio).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toLocaleDateString('it-IT');
        const testo = document.createElement('span');
        testo.textContent = `${quando} · ${v.tipo}: ${v.titolo} · ${v.ore}`;
        const link = document.createElement('a');
        link.href = `/api/presenze/${v.id}/attestato`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Attestato';
        link.style.marginLeft = 'auto';
        li.append(testo, link);
        lista.appendChild(li);
    }
}

async function loadMioLibretto(userId) {
    const medList = document.getElementById('my-medical-list');
    const courseList = document.getElementById('my-courses-list');

    try {
        const data = await fetchApi(`/api/users/${userId}/libretto`);
        currentLibrettoData = data;
        
        medList.innerHTML = '';
        const rawRecords = Array.isArray(data.medical_records) ? data.medical_records : (data.medical_record ? [data.medical_record] : []);
        
        const seenMedTypes = new Set();
        const records = rawRecords.map(m => {
            const isLatest = !seenMedTypes.has(m.visit_type_id);
            if (isLatest) seenMedTypes.add(m.visit_type_id);
            return { ...m, isLatest };
        });

        if (records.length > 0) {
            records.forEach(m => {
                const visitName = m.visit_name || 'Visita Medica';
                const vDate = new Date(m.last_visit_date).toLocaleDateString('it-IT');
                const eDate = new Date(m.expiry_date).toLocaleDateString('it-IT');
                
                const scaduta = new Date(m.expiry_date) < new Date();
                const tono = scaduta ? 'attenzione' : (m.status === 'Idoneo' ? 'ok' : 'grave');
                
                const badgeHTML = m.isLatest ? `<span class="bollino ${tono}">${escapeHTML((m.status || '').toUpperCase())}${scaduta ? ' · SCADUTA' : ''}</span>` 
                                             : `<span class="bollino spento"><i class="fas fa-archive"></i> STORICO</span>`;

                let actionsHTML = '';
                if (m.document_url) {
                    actionsHTML = `<a href="${escapeHTML(m.document_url)}" target="_blank" class="btn-icon-action btn-view-record" title="Scarica Certificato Medico" style="margin-left: 10px;"><i class="fas fa-paperclip"></i></a>`;
                }

                medList.innerHTML += `
                    <li style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light-color); padding: 10px 0; ${!m.isLatest ? 'opacity:0.6;' : ''}">
                        <div>
                            <strong style="font-size: 1.05rem; color: var(--text-color);">${escapeHTML(visitName)}</strong>
                            <div style="font-size: 0.85rem; color: var(--text-muted);">Data: ${vDate} | Scadenza: <strong>${eDate}</strong></div>
                        </div>
                        <div style="display: flex; align-items: center;">
                            ${actionsHTML}
                            ${badgeHTML}
                        </div>
                    </li>`;
            });
        } else {
            medList.innerHTML = '<li style="color: var(--text-muted); padding: 10px 0;">Nessuna visita registrata.</li>';
        }

        courseList.innerHTML = '';
        const rawCourses = data.courses || [];
        const seenCourseTypes = new Set();
        const courses = rawCourses.map(c => {
            const isLatest = !seenCourseTypes.has(c.course_id);
            if (isLatest) seenCourseTypes.add(c.course_id);
            return { ...c, isLatest };
        });

        if (courses.length > 0) {
            courses.forEach(c => {
                const aDate = new Date(c.acquisition_date).toLocaleDateString('it-IT');
                const eDate = c.expiry_date ? new Date(c.expiry_date).toLocaleDateString('it-IT') : 'Nessuna Scadenza';
                
                const scaduto = !!c.expiry_date && new Date(c.expiry_date) < new Date();

                const badgeHTML = c.isLatest ? (scaduto
                                                 ? `<span class="bollino attenzione"><i class="fas fa-certificate"></i> SCADUTO</span>`
                                                 : `<span class="bollino info"><i class="fas fa-certificate"></i> VALIDO</span>`)
                                             : `<span class="bollino spento"><i class="fas fa-archive"></i> STORICO</span>`;

                let actionsHTML = '';
                if (c.document_url) {
                    actionsHTML = `<a href="${escapeHTML(c.document_url)}" target="_blank" class="btn-icon-action btn-view-record" title="Scarica Attestato" style="margin-left: 10px;"><i class="fas fa-paperclip"></i></a>`;
                }

                courseList.innerHTML += `
                    <li style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-light-color); padding: 10px 0; ${!c.isLatest ? 'opacity:0.6;' : ''}">
                        <div>
                            <strong style="font-size: 1.05rem; color: var(--text-color);">${escapeHTML(c.name)}</strong>
                            <div style="font-size: 0.85rem; color: var(--text-muted);">Acquisito: ${aDate} | Scadenza: <strong>${eDate}</strong></div>
                        </div>
                        <div style="display: flex; align-items: center;">
                            ${actionsHTML}
                            ${badgeHTML}
                        </div>
                    </li>`;
            });
        } else {
            courseList.innerHTML = '<li style="color: var(--text-muted); padding: 10px 0;">Nessun corso registrato.</li>';
        }

        // 3. DPI in dotazione. Il riquadro compare solo se il magazzino è
        // acceso: senza quel modulo sarebbe una scatola vuota per sempre.
        const cardDpi = document.getElementById('card-miei-dpi');
        if (cardDpi) {
            cardDpi.hidden = !data.magazzino_attivo;
            if (data.magazzino_attivo) {
                disegnaDpiInDotazione(document.getElementById('my-dpi-list'), data.equipment);
            }
        }
        if (data.magazzino_attivo) caricaDaConfermare();
    } catch (error) {
        medList.innerHTML = '<li style="color: red;">Errore nel caricamento.</li>';
        courseList.innerHTML = '<li style="color: red;">Errore nel caricamento.</li>';
    }
}

// MATERIALE DA CONFERMARE
// Le consegne del magazzino che aspettano la conferma di chi le ha ricevute.
// È la stessa conferma che si dà dall'app: chi non l'ha installata la dà da
// qui, e il verbale si può aprire e stampare.
async function caricaDaConfermare() {
    const box = document.getElementById('box-da-confermare');
    const elenco = document.getElementById('elenco-da-confermare');
    if (!box || !elenco) return;
    let verbali;
    try {
        verbali = await fetchApi('/api/magazzino/verbali/miei?stato=da_confermare');
    } catch {
        box.hidden = true;
        return;
    }
    elenco.innerHTML = '';
    box.hidden = verbali.length === 0;
    verbali.forEach(v => {
        const voce = document.createElement('div');
        voce.className = 'verbale-da-confermare';

        const titolo = document.createElement('div');
        titolo.className = 'intestazione-verbale';
        const quando = new Date(v.emesso_il).toLocaleDateString('it-IT');
        titolo.textContent = `Consegna del ${quando}${v.emesso_da ? ` da ${v.emesso_da}` : ''} (verbale n. ${v.id})`;

        const cose = document.createElement('ul');
        (v.righe || []).forEach(r => {
            const li = document.createElement('li');
            const n = Number(r.quantita);
            const quanti = n !== 1 ? ` x${n} ${r.unita_misura || ''}`.trimEnd() : '';
            const dettagli = [r.taglia ? `taglia ${r.taglia}` : '', r.matricola || ''].filter(Boolean).join(', ');
            li.textContent = `${r.bene_denominazione}${quanti}${dettagli ? ` (${dettagli})` : ''}`;
            cose.appendChild(li);
        });

        const azioni = document.createElement('div');
        azioni.className = 'azioni-verbale';
        const conferma = document.createElement('button');
        conferma.type = 'button';
        conferma.className = 'button-style';
        conferma.textContent = 'Confermo di averlo ricevuto';
        const apri = document.createElement('a');
        apri.href = `/magazzino-verbale.html?id=${v.id}&da=profilo`;
        apri.target = '_blank';
        apri.rel = 'noopener';
        apri.textContent = 'Vedi il verbale';
        conferma.addEventListener('click', async () => {
            conferma.disabled = true;
            try {
                await fetchApi(`/api/magazzino/verbali/${v.id}/conferma`, { method: 'POST' });
                voce.remove();
                if (!elenco.children.length) box.hidden = true;
            } catch (e) {
                notifica(e.message, 'errore');
                conferma.disabled = false;
            }
        });
        azioni.append(conferma, apri);

        voce.append(titolo, cose, azioni);
        elenco.appendChild(voce);
    });
}

// UPLOAD FOTO PROFILO
function setupPhotoUpload() {
    const photoInput = document.getElementById('photo-upload');
    photoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            notifica('La foto non può superare i 5MB.', 'errore');
            return;
        }

        const formData = new FormData();
        formData.append('photo', file);

        try {
            document.getElementById('profile-fullname').textContent = "Caricamento foto...";
            
            const response = await fetchApi('/api/users/me/photo', {
                method: 'POST',
                body: formData
            });

            document.getElementById('profile-photo').src = response.photo_url;
            currentUserData.photo_url = response.photo_url;
            
        } catch (error) {
            notifica(`Errore caricamento foto: ${error.message}`, 'errore');
        } finally {
            document.getElementById('profile-fullname').textContent = `${currentUserData.nome} ${currentUserData.cognome}`;
        }
    });
}

// HELPER: Converte un URL immagine in Base64 per il PDF
async function getBase64ImageFromUrl(imageUrl) {
    try {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error('Network response was not ok');
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("Impossibile caricare l'immagine per il PDF:", imageUrl);
        return null;
    }
}

// GENERAZIONE LIBRETTO PDF (pdfMake)
async function generatePDFLibretto() {
    if (!currentUserData || !currentLibrettoData) {
        notifica('Attendi il caricamento completo dei dati.', 'attenzione'); return;
    }

    const btn = document.getElementById('btn-print-badge');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generazione in corso...';

    try {
        const logoBase64 = await getBase64ImageFromUrl('/logo.png');
        const photoBase64 = currentUserData.photo_url ? await getBase64ImageFromUrl(currentUserData.photo_url) : null;

        const headerColumns = [];
        if (logoBase64) {
            headerColumns.push({ image: logoBase64, width: 60, alignment: 'left' });
        }
        headerColumns.push({
            text: [
                { text: brandingSettings.association_name.toUpperCase() + '\n', style: 'headerTitle' },
                { text: 'Sistema Informativo ORION\n', style: 'headerSub' },
                { text: 'FASCICOLO PERSONALE VOLONTARIO', style: 'documentTitle' }
            ],
            alignment: logoBase64 ? 'right' : 'center',
            margin: [0, 5, 0, 0]
        });

        const profileColumns = [];
        if (photoBase64) {
            profileColumns.push({
                width: 'auto',
                image: photoBase64,
                fit: [95, 95], 
                margin: [0, 0, 35, 0] 
            });
        }
        profileColumns.push({
            width: '*', 
            table: {
                widths: [110, '*'], 
                body: [
                    [{ text: 'Volontario:', bold: true, border: [false, false, false, false] }, { text: `${currentUserData.nome} ${currentUserData.cognome}`, border: [false, false, false, false] }],
                    [{ text: 'Codice Fiscale:', bold: true, border: [false, false, false, false] }, { text: currentUserData.codice_fiscale || 'N/D', border: [false, false, false, false] }],
                    [{ text: 'Recapito:', bold: true, border: [false, false, false, false] }, { text: currentUserData.telefono || 'N/D', border: [false, false, false, false] }],
                    [{ text: 'Data Stampa:', bold: true, border: [false, false, false, false] }, { text: new Date().toLocaleDateString('it-IT'), border: [false, false, false, false] }]
                ]
            },
            layout: 'noBorders',
            margin: [0, 5, 0, 0]
        });

        const docDefinition = {
            pageSize: 'A4',
            pageMargins: [40, 40, 40, 40],
            content: [
                // Header (Logo + Titolo)
                { columns: headerColumns, margin: [0, 0, 0, 15] },
                // Linea separatrice azzurra
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: '#3b82f6' }], margin: [0, 0, 0, 20] },
                
                // Sezione Profilo
                { columns: profileColumns, margin: [0, 0, 0, 30] },
                
                // TABELLA VISITE MEDICHE
                { text: 'SORVEGLIANZA SANITARIA', style: 'sectionHeader' },
                {
                    table: {
                        headerRows: 1,
                        widths: ['*', 'auto', 'auto', 'auto'],
                        body: [
                            // Intestazione tabella
                            [
                                { text: 'TIPO VISITA', style: 'tableHeader' }, 
                                { text: 'DATA ESECUZIONE', style: 'tableHeader' }, 
                                { text: 'DATA SCADENZA', style: 'tableHeader' }, 
                                { text: 'ESITO', style: 'tableHeader' }
                            ],
                            // Righe dati
                            ...(Array.isArray(currentLibrettoData.medical_records) ? currentLibrettoData.medical_records : (currentLibrettoData.medical_record ? [currentLibrettoData.medical_record] : [])).map((m, index, arr) => {
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
                    // Stile a righe alternate (zebra) per le tabelle
                    layout: {
                        hLineWidth: function (i, node) { return (i === 0 || i === node.table.body.length) ? 0 : 1; },
                        vLineWidth: function (i, node) { return 0; },
                        hLineColor: function (i, node) { return '#e2e8f0'; },
                        paddingLeft: function(i, node) { return 8; },
                        paddingRight: function(i, node) { return 8; },
                        fillColor: function (rowIndex, node, columnIndex) { return (rowIndex % 2 === 0 && rowIndex !== 0) ? '#f8fafc' : null; }
                    },
                    margin: [0, 0, 0, 30]
                },

                // TABELLA CORSI
                { text: 'FORMAZIONE E SPECIALIZZAZIONI', style: 'sectionHeader' },
                {
                    table: {
                        headerRows: 1,
                        widths: ['*', 'auto', 'auto', 'auto'],
                        body: [
                            // Intestazione tabella
                            [
                                { text: 'CORSO FREQUENTATO', style: 'tableHeader' }, 
                                { text: 'ACQUISITO IL', style: 'tableHeader' }, 
                                { text: 'SCADENZA', style: 'tableHeader' },
                                { text: 'STATO', style: 'tableHeader' }
                            ],
                            // Righe dati
                            ...(currentLibrettoData.courses || []).map((c, index, arr) => {
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
                        vLineWidth: function (i, node) { return 0; },
                        hLineColor: function (i, node) { return '#e2e8f0'; },
                        paddingLeft: function(i, node) { return 8; },
                        paddingRight: function(i, node) { return 8; },
                        fillColor: function (rowIndex, node, columnIndex) { return (rowIndex % 2 === 0 && rowIndex !== 0) ? '#f8fafc' : null; }
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

        pdfMake.createPdf(docDefinition).download(`Fascicolo_${currentUserData.cognome}_${currentUserData.nome}.pdf`);

    } catch (error) {
        console.error("Errore generazione PDF:", error);
        notifica("Si è verificato un errore durante la generazione del PDF. Riprova.", 'errore');
    } finally {
        // Ripristina il bottone
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}
// CAMBIO PASSWORD (Invariato)
function setupPasswordForm() {
    const pwdForm = document.getElementById('change-password-form');
    if (pwdForm) {
        pwdForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const curr = document.getElementById('current-password').value;
            const newP = document.getElementById('new-password').value;
            const confP = document.getElementById('confirm-password').value;
            const fb = document.getElementById('change-pwd-feedback');

            if (newP !== confP) {
                fb.style.color = 'red'; fb.textContent = 'Le nuove password non coincidono.'; return;
            }

            try {
                await fetchApi('/api/users/change-password', {
                    method: 'POST', body: JSON.stringify({ currentPassword: curr, newPassword: newP })
                });
                fb.style.color = 'green'; fb.textContent = 'Password aggiornata con successo!';
                pwdForm.reset();
            } catch (error) {
                fb.style.color = 'red'; fb.textContent = error.message || 'Errore durante l\'aggiornamento.';
            }
        });
    }
}
