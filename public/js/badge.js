document.addEventListener('DOMContentLoaded', async () => {
    // Estrae il token dall'URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    const loading = document.getElementById('loading');
    const errorMsg = document.getElementById('error-msg');
    const unavailableMsg = document.getElementById('unavailable-msg');
    const badgeContent = document.getElementById('badge-content');
    const watermark = document.getElementById('watermark');

    if (!token) {
        loading.style.display = 'none';
        errorMsg.style.display = 'block';
        return;
    }

    try {
        const response = await fetch(`/api/public/volunteer/${token}`);
        if (!response.ok) throw new Error('Badge non valido');

        const data = await response.json();

        // LOG DI DEBUG: Premi F12 nel browser per vedere questi dati!
        console.log("Dati ricevuti dal server ORION:", data);

        // Il tesserino è disattivato (nessuna emergenza attiva): non mostrare alcun dato personale.
        if (data.available === false) {
            loading.style.display = 'none';
            unavailableMsg.style.display = 'block';
            return;
        }

        document.getElementById('b-name').textContent = `${data.nome} ${data.cognome}`;
        if (data.photo_url) {
            document.getElementById('b-photo').src = data.photo_url;
        }

        if (data.app_name && data.app_name.trim() !== '') {
            document.getElementById('b-app-name').textContent = data.app_name.toUpperCase();
        }

        const statusBox = document.getElementById('b-status');
        if (data.operativita_globale) {
            statusBox.className = 'status-box status-ok';
            statusBox.innerHTML = '<i class="fas fa-check-circle"></i> IDONEO OPERATIVO';
        } else {
            statusBox.className = 'status-box status-ko';
            let motivo = 'NON OPERATIVO';
            if (!data.idoneita_medica && !data.corso_base) motivo += ' (Requisiti Mancanti)';
            else if (!data.idoneita_medica) motivo += ' (Rinnovo Visita)';
            else if (!data.corso_base) motivo += ' (Corso Base Scaduto)';
            statusBox.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${motivo}`;
        }

        const coursesUl = document.getElementById('b-courses');
        if (data.corsi_attivi && data.corsi_attivi.length > 0) {
            coursesUl.innerHTML = data.corsi_attivi.map(c => {
                let textScadenza = 'Nessuna Scadenza';
                if (c.expiry_date) {
                    // Forza il formato Europeo: gg/mm/aaaa
                    const d = new Date(c.expiry_date);
                    textScadenza = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
                }
                
                return `<li class="course-item"><i class="fas fa-check"></i> 
                    <div>
                        <strong>${c.name}</strong>
                        ${c.course_code ? `<span style="font-size:0.75rem; color:#64748b; display:inline-block; margin-right: 10px;">Cod: ${c.course_code}</span>` : ''}
                        <span style="font-size:0.75rem; color:var(--text-muted); display:inline-block;">Scadenza: ${textScadenza}</span>
                    </div>
                </li>`;
            }).join('');
        } else {
            coursesUl.innerHTML = '<li class="course-item" style="color: var(--danger-text);"><i class="fas fa-times"></i> Nessuna specializzazione in validità.</li>';
        }

        // Timestamp di verifica
        document.getElementById('verify-time').textContent = new Date().toLocaleString('it-IT');

        loading.style.display = 'none';
        badgeContent.style.display = 'block';
        watermark.style.display = 'block';

    } catch (error) {
        console.error("Errore verifica tesserino:", error);
        loading.style.display = 'none';
        errorMsg.style.display = 'block';
    }
});
