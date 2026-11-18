// La diretta del drone in un <video>, in WebRTC (WHEP) passando da ORION, e il volo registrato da rivedere: li usano
// la sala, la parete e l'archivio.
(function () {
    // Senza trickle ICE: la proposta parte con tutti i candidati, così basta una richiesta sola.
    async function attendiCandidati(pc) {
        if (pc.iceGatheringState === 'complete') return;
        await new Promise(fatto => {
            const fine = () => { if (pc.iceGatheringState === 'complete') fatto(); };
            pc.addEventListener('icegatheringstatechange', fine);
            setTimeout(fatto, 2500);
        });
    }

    async function guarda(chiaveId, video, { suFine = () => {} } = {}) {
        const pc = new RTCPeerConnection();
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.addEventListener('track', (e) => { if (e.streams[0] && video.srcObject !== e.streams[0]) video.srcObject = e.streams[0]; });
        pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) suFine(pc.connectionState); });
        await pc.setLocalDescription(await pc.createOffer());
        await attendiCandidati(pc);
        const r = await fetch(`/api/drone/dirette/${encodeURIComponent(chiaveId)}/whep`, {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp
        });
        if (!r.ok) {
            pc.close();
            const dati = await r.json().catch(() => ({}));
            throw new Error(dati.message || `La diretta non parte (errore ${r.status}).`);
        }
        const sessione = r.headers.get('Location');
        try {
            await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
        } catch {
            pc.close();
            if (sessione) fetch(sessione, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
            throw new Error('Il video non si apre: il browser non si accorda con il server delle dirette (MediaMTX).');
        }
        return {
            chiudi() {
                pc.close();
                video.srcObject = null;
                if (sessione) fetch(sessione, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
            }
        };
    }

    // I pezzi da un minuto di un volo, uno dopo l'altro come un video solo, con una barra per tutto il volo e l'ora vera.
    // Le pause del pilota fra un pezzo e l'altro non ci sono: la barra conta solo il tempo registrato.
    const STILE_RIVEDI = `
        .dr-rivedi { display: flex; flex-direction: column; background: #000; min-width: 0; }
        .dr-rivedi .dr-video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
        .dr-rivedi-comandi { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 8px; background: #111827; color: #fff; font-size: .8rem; }
        .dr-rivedi-barra { flex: 1; min-width: 120px; accent-color: #dc2626; }
        .dr-tasto-chiaro { background: none; border: 1px solid rgba(255,255,255,.35); color: #fff; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: .8rem; }
        .dr-rivedi-tempo { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .dr-rivedi-fine { color: #fca5a5; }
        .dr-finestra .dr-rivedi { flex: 1; min-height: 0; }
        .dr-finestra .dr-rivedi .dr-video { flex: 1; min-height: 0; aspect-ratio: auto; height: auto; object-fit: contain; }
    `;
    function rivedi(primi, { aggiorna = null, suErrore = () => {} } = {}) {
        if (!document.getElementById('dr-stile-rivedi')) {
            const stile = document.createElement('style');
            stile.id = 'dr-stile-rivedi';
            stile.textContent = STILE_RIVEDI;
            document.head.append(stile);
        }
        let pezzi = [];
        let partenze = [], durate = [], totale = 0, attuale = -1, trascina = false;
        const el = (tag, attr = {}, testo) => { const e = document.createElement(tag); Object.assign(e, attr); if (testo) e.textContent = testo; return e; };
        const video = el('video', { className: 'dr-video', playsInline: true, muted: true, preload: 'auto' });
        const barra = el('input', { type: 'range', min: 0, max: 1, step: 1, value: 0, className: 'dr-rivedi-barra' });
        barra.setAttribute('aria-label', 'Punto del volo');
        const pulsante = el('button', { type: 'button', className: 'dr-tasto-chiaro' }, '⏸');
        pulsante.setAttribute('aria-label', 'Pausa');
        const tempo = el('span', { className: 'dr-rivedi-tempo' });
        const daCapo = el('button', { type: 'button', className: 'dr-tasto-chiaro', title: 'Ripeti il volo dall\'inizio' }, '⏮ Ripeti');
        const fine = el('span', { className: 'dr-rivedi-fine', hidden: true }, 'Fine del registrato');
        const nodo = el('div', { className: 'dr-rivedi' });
        nodo.append(video, el('div', { className: 'dr-rivedi-comandi' }));
        nodo.lastChild.append(pulsante, barra, tempo, daCapo, fine);

        const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        const oraVera = (i, s) => new Date(new Date(pezzi[i].iniziata_il).getTime() + s * 1000).toLocaleTimeString('it-IT');
        function misura(elenco) {
            pezzi = elenco;
            durate = pezzi.map(p => Math.max(1, (new Date(p.finita_il) - new Date(p.iniziata_il)) / 1000));
            partenze = []; totale = 0;
            for (const d of durate) { partenze.push(totale); totale += d; }
            barra.max = String(Math.max(1, Math.round(totale)));
        }
        function mostra() {
            if (attuale < 0) return;
            const posizione = partenze[attuale] + (video.currentTime || 0);
            if (!trascina) barra.value = String(Math.round(posizione));
            tempo.textContent = `${mmss(posizione)} / ${mmss(totale)} · ${oraVera(attuale, video.currentTime || 0)}`;
        }
        function carica(i, secondi = 0) {
            attuale = i;
            fine.hidden = true;
            video.src = `/api/drone/registrazioni/${encodeURIComponent(pezzi[i].id)}/file`;
            video.addEventListener('loadedmetadata', () => {
                if (secondi > 0) video.currentTime = Math.min(secondi, (video.duration || durate[i]) - 0.2);
                video.play().catch(() => {});
            }, { once: true });
        }
        function vaiA(secondi) {
            let i = partenze.findIndex((p, k) => secondi >= p && secondi < p + durate[k]);
            if (i < 0) i = pezzi.length - 1;
            if (i === attuale && video.readyState > 0) { video.currentTime = Math.max(0, secondi - partenze[i]); video.play().catch(() => {}); } else carica(i, secondi - partenze[i]);
        }
        // In fondo al registrato si chiede se nel frattempo sono arrivati pezzi nuovi (il drone è ancora in volo).
        video.addEventListener('ended', async () => {
            if (attuale + 1 < pezzi.length) return carica(attuale + 1);
            if (aggiorna) {
                const nuovi = await aggiorna().catch(() => null);
                if (nuovi && nuovi.length > pezzi.length) { misura(nuovi); return carica(attuale + 1); }
            }
            fine.hidden = false;
        });
        video.addEventListener('timeupdate', mostra);
        video.addEventListener('play', () => { pulsante.textContent = '⏸'; pulsante.setAttribute('aria-label', 'Pausa'); });
        video.addEventListener('pause', () => { pulsante.textContent = '▶'; pulsante.setAttribute('aria-label', 'Riprendi'); });
        video.addEventListener('error', () => suErrore('Questo pezzo della ripresa non si apre.'));
        pulsante.addEventListener('click', () => (video.paused ? video.play().catch(() => {}) : video.pause()));
        barra.addEventListener('input', () => { trascina = true; tempo.textContent = `${mmss(Number(barra.value))} / ${mmss(totale)}`; });
        barra.addEventListener('change', () => { trascina = false; vaiA(Number(barra.value)); });
        daCapo.addEventListener('click', () => carica(0));

        misura(primi);
        if (pezzi.length) carica(0);
        return {
            nodo, video,
            chiudi() { video.pause(); video.removeAttribute('src'); video.load(); }
        };
    }

    window.DroneVideo = { guarda, rivedi };
})();
