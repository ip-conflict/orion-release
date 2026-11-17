// Lo schermo a parete: legge e basta, si aggiorna da solo con gli eventi della sala.
(function () {
    const $ = (id) => document.getElementById(id);
    let mappa = null, livelloSegnalazioni = null, livelloSquadre = null, livelloElementi = null;
    let impostazioni = {};
    let emergenza = null;
    let inAttesa = null;

    const COLORI_ELEMENTI = { strada_chiusa: '#dc2626', zona_interdetta: '#b91c1c' };

    function ora() {
        $('parete-ora').textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }

    function preparaMappa() {
        const centro = [Number(impostazioni.map_center_lat) || 42.5, Number(impostazioni.map_center_lon) || 12.5];
        mappa = L.map('mappa-parete', { zoomControl: false, attributionControl: true }).setView(centro, Number(impostazioni.map_zoom_level) || 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(mappa);
        livelloElementi = L.layerGroup().addTo(mappa);
        livelloSegnalazioni = L.layerGroup().addTo(mappa);
        livelloSquadre = L.layerGroup().addTo(mappa);
    }

    function disegnaSegnalazioni(segnalazioni) {
        livelloSegnalazioni.clearLayers();
        const aperte = segnalazioni.filter(r => r.status !== 'Closed');
        const conSquadra = aperte.filter(r => (r.assigned_teams || []).length > 0);
        const daAssegnare = aperte.filter(r => !(r.assigned_teams || []).length && !r.no_team_reason);
        $('conto-aperte').textContent = aperte.length;
        $('conto-con-squadra').textContent = conSquadra.length;
        $('conto-da-assegnare').textContent = daAssegnare.length;
        const punti = [];
        for (const r of aperte) {
            const lat = Number(r.latitude), lon = Number(r.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
            const classi = ['parete-segnaposto', (r.assigned_teams || []).length ? 'con-squadra' : '', r.priority === 'High' ? 'alta' : ''].filter(Boolean).join(' ');
            const numero = document.createElement('div');
            numero.className = classi;
            numero.textContent = String(r.emergency_report_number ?? r.id);
            const lato = r.priority === 'High' ? 46 : 38;
            L.marker([lat, lon], { icon: L.divIcon({ className: '', html: numero.outerHTML, iconSize: [lato, lato], iconAnchor: [lato / 2, lato / 2] }), interactive: false })
                .addTo(livelloSegnalazioni);
            punti.push([lat, lon]);
        }
        return punti;
    }

    function disegnaSquadre(squadre, posizioni) {
        const barra = $('parete-squadre');
        const gruppo = (s) => (s.coc ? 0 : s.active_target_info ? 1 : 2);
        const ordinate = [...squadre].sort((a, b) => gruppo(a) - gruppo(b) || String(a.nome_radio).localeCompare(String(b.nome_radio), 'it'));
        barra.replaceChildren(...ordinate.map(s => {
            const voce = document.createElement('span');
            voce.className = `parete-squadra${s.coc ? ' coc' : s.active_target_info ? ' impegnata' : ''}${s.qualifica ? ' esterna' : ''}`;
            voce.textContent = s.nome_radio || '?';
            const esterna = window.Qualifiche?.stile(s.qualifica);
            if (esterna) {
                voce.style.borderColor = Qualifiche.bordo(s.qualifica);
                voce.insertAdjacentHTML('afterbegin', Qualifiche.bollino(s.qualifica));
            }
            const dove = document.createElement('small');
            dove.textContent = s.coc ? 'in sala' : s.active_target_info ? `→ #${s.active_target_info.target_report_progressive_number ?? s.active_target_info.report_id}` : 'libera';
            voce.append(dove);
            return voce;
        }));
        livelloSquadre.clearLayers();
        const qualificaDi = new Map(squadre.map(s => [s.id, s.qualifica]));
        for (const p of posizioni) {
            const lat = Number(p.latitude), lon = Number(p.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            const etichetta = document.createElement('div');
            etichetta.className = 'parete-mezzo';
            etichetta.textContent = p.nome_radio || '?';
            const esterna = window.Qualifiche?.stile(qualificaDi.get(p.squadra_id));
            if (esterna) {
                etichetta.classList.add('esterna');
                etichetta.style.background = esterna.colore;
                etichetta.style.color = esterna.testo;
                etichetta.style.setProperty('--anello-ente', esterna.anello);
                etichetta.textContent = `${esterna.sigla} ${p.nome_radio || '?'}`;
            }
            L.marker([lat, lon], { icon: L.divIcon({ className: '', html: etichetta.outerHTML, iconSize: null }), interactive: false }).addTo(livelloSquadre);
        }
    }

    function disegnaElementi(elementi) {
        livelloElementi.clearLayers();
        for (const e of elementi) {
            if (!e.geometria) continue;
            const colore = COLORI_ELEMENTI[e.tipo] || '#7c3aed';
            L.geoJSON(e.geometria, {
                style: { color: colore, weight: e.tipo === 'strada_chiusa' ? 7 : 3, fillOpacity: 0.15, dashArray: e.tipo === 'strada_chiusa' ? '10 8' : null },
                pointToLayer: (_, punto) => L.circleMarker(punto, { radius: 8, color: colore }),
                interactive: false
            }).addTo(livelloElementi);
        }
    }

    // Il primo drone in onda va nel riquadro: la parete non ha pulsanti, sceglie da sé.
    let droneVisto = null, droneVisione = null;
    async function aggiornaDrone() {
        const box = $('parete-drone');
        let inOnda = null;
        try {
            const stato = emergenza ? await fetchApi('/api/drone/stato') : null;
            if (stato?.attivo) inOnda = ((await fetchApi('/api/drone/dirette'))?.chiavi || []).find(k => k.in_onda) || null;
        } catch { inOnda = null; }
        if (inOnda?.id === droneVisto) return;
        droneVisione?.chiudi();
        droneVisione = null;
        droneVisto = inOnda?.id ?? null;
        box.hidden = !inOnda;
        if (!inOnda || !window.DroneVideo) return;
        $('parete-drone-nome').textContent = inOnda.nome;
        try {
            droneVisione = await DroneVideo.guarda(inOnda.id, $('parete-drone-video'), { suFine: () => { droneVisto = null; setTimeout(aggiornaDrone, 3000); } });
        } catch (e) {
            // Resta segnato come visto: la parete non riprova a ogni evento, ma al prossimo cambio di drone.
            console.error('[Parete] Drone non visibile:', e);
            box.hidden = true;
        }
    }

    async function aggiorna() {
        try {
            const stato = await fetchApi('/api/emergencies/status');
            emergenza = stato?.active ? stato.emergency : null;
            const nome = impostazioni.association_name || 'ORION';
            $('parete-emergenza').textContent = emergenza ? `${emergenza.code}${emergenza.name ? ` · ${emergenza.name}` : ''}` : nome;
            $('parete-conti').hidden = !emergenza;
            $('parete-vuota').hidden = !!emergenza;
            $('parete-vuota').textContent = `${nome}\nNessuna emergenza aperta`;
            const [squadre, posizioni, elementi, segnalazioni] = await Promise.all([
                fetchApi('/api/squadre').catch(() => []),
                emergenza ? fetchApi('/api/location').catch(() => []) : [],
                fetchApi('/api/mappa/elementi').catch(() => ({ emergenza: [] })),
                emergenza ? fetchApi(`/api/reports?status_type=active&limit=1000&emergency_id=${encodeURIComponent(emergenza.id)}`).catch(() => ({ reports: [] })) : { reports: [] }
            ]);
            disegnaSquadre(Array.isArray(squadre) ? squadre : [], Array.isArray(posizioni) ? posizioni : []);
            disegnaElementi(elementi?.emergenza || []);
            const punti = disegnaSegnalazioni(segnalazioni?.reports || []);
            aggiornaDrone();
            if (punti.length && !mappa._adattata) {
                mappa.fitBounds(punti, { padding: [60, 60], maxZoom: 15 });
                mappa._adattata = true;
            }
        } catch (e) {
            console.error('[Parete] Aggiornamento non riuscito:', e);
        }
    }

    // Tanti eventi in fila (una squadra che si muove) diventano un aggiornamento solo.
    function aggiornaPresto() {
        clearTimeout(inAttesa);
        inAttesa = setTimeout(aggiorna, 700);
    }

    document.addEventListener('DOMContentLoaded', async () => {
        ora();
        setInterval(ora, 15000);
        impostazioni = await fetch('/api/branding/settings', { credentials: 'same-origin' }).then(r => r.json()).catch(() => ({}));
        try {
            const logo = await fetch('/api/branding', { credentials: 'same-origin' }).then(r => r.json());
            if (logo?.logoUrl) $('parete-logo').src = `${logo.logoUrl}?v=${logo.logoVersion}`;
        } catch { /* resta il logo di serie */ }
        preparaMappa();
        await aggiorna();
        for (const evento of ['reload_reports', 'new_report_update', 'reload_squadre', 'team_location_update', 'reload_mappa', 'emergency_status_change', 'branding_updated', 'reload_drone']) {
            document.addEventListener(`ws:${evento}`, aggiornaPresto);
        }
        setInterval(aggiorna, 60000);
    });
})();
