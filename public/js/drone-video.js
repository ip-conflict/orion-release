// La diretta del drone in un <video>, in WebRTC (WHEP) passando da ORION: la usano la sala e la parete.
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

    window.DroneVideo = { guarda };
})();
