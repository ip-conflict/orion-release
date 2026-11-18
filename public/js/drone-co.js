// Il drone nel centro operativo: chi trasmette, la diretta da guardare, le chiavi da dare al pilota.
(function () {
    const STILE = `
        #drone-btn .drone-in-onda { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #dc2626; margin-left: 6px; animation: dr-pulsa 1.2s infinite; }
        @keyframes dr-pulsa { 50% { opacity: .35; } }
        .dr-pannello { position: fixed; right: 16px; top: 76px; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 100px); overflow-y: auto; z-index: 2600;
            background: var(--surface-color); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.25); padding: 14px 16px; }
        .dr-testa { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .dr-testa h2 { margin: 0; font-size: 1.15rem; }
        .dr-chiudi { border: none; background: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted); }
        .dr-pannello.largo { width: min(1000px, calc(100vw - 32px)); }
        .dr-griglia { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin: 10px 0 4px; }
        .dr-vista { display: flex; flex-direction: column; background: #000; border-radius: 8px; overflow: hidden; min-width: 0; }
        .dr-vista-testa { display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 10px; background: #111827; color: #fff; font-size: .85rem; user-select: none; }
        .dr-vista-testa strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        .dr-punto { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #dc2626; animation: dr-pulsa 1.2s infinite; }
        .dr-comandi { margin-left: auto; display: flex; flex: none; }
        .dr-tasto { background: none; border: none; color: #fff; cursor: pointer; padding: 5px 7px; border-radius: 4px; font-size: .9rem; }
        .dr-tasto:hover, .dr-tasto:focus-visible { background: rgba(255,255,255,.18); }
        .dr-video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
        .dr-finestra { position: fixed; z-index: 2610; min-width: 240px; min-height: 170px; max-width: 100vw; max-height: 100vh; resize: both; overflow: hidden;
            display: flex; flex-direction: column; border-radius: 10px; box-shadow: 0 14px 36px rgba(0,0,0,.45); border: 1px solid #374151; background: #000; }
        .dr-finestra .dr-vista { flex: 1; min-height: 0; border-radius: 0; }
        .dr-finestra .dr-vista-testa { cursor: move; touch-action: none; }
        .dr-finestra .dr-video { flex: 1; min-height: 0; aspect-ratio: auto; height: auto; object-fit: contain; }
        .dr-voce { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border-color); }
        .dr-voce .dr-nome { flex: 1; }
        .dr-voce small { display: block; color: var(--text-muted); }
        .dr-stato { font-size: .8rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--secondary-bg-color); }
        .dr-stato.onda { background: #dc2626; color: #fff; }
        .dr-nuova { display: grid; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color); }
        .dr-chiave { display: grid; gap: 6px; padding: 10px; border: 1px dashed var(--border-color); border-radius: 8px; margin-top: 8px; }
        .dr-chiave code { word-break: break-all; font-size: .85rem; background: var(--secondary-bg-color); padding: 4px 6px; border-radius: 4px; }
        .dr-qr { display: flex; justify-content: center; padding: 6px; background: #fff; border-radius: 6px; width: fit-content; }
        .dr-nota { font-size: .85rem; color: var(--text-muted); margin: 6px 0; }
        .dr-legame { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .dr-legame label { display: grid; gap: 3px; font-size: .85rem; }
        .dr-modifica { display: grid; gap: 8px; padding: 8px 0 10px; }
    `;
    const $ = (id) => document.getElementById(id);
    function el(tag, attr = {}, ...figli) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attr)) {
            if (k === 'testo') e.textContent = v;
            else if (k.startsWith('su')) e.addEventListener(k.slice(2).toLowerCase(), v);
            else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
        }
        figli.flat().forEach(f => f && e.append(f));
        return e;
    }
    const ora = (d) => (d ? new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '');
    const stile = () => { if (!$('dr-stile')) document.head.append(el('style', { id: 'dr-stile', testo: STILE })); };

    let stato = null, pannello = null, chiaveMostrata = null, ultimiDati = null, squadreSala = [], inModifica = null;
    let primoPiano = 2610, cascata = 0;
    // Ogni drone guardato ha la sua sessione WebRTC: nel pannello o in una finestra sua, mai in due posti.
    const visioni = new Map();
    // Dopo un errore, o se l'operatore l'ha chiusa, una diretta non si riapre da sola: la si riapre con "Guarda".
    const nonDaSoli = new Set();

    function pulsante() {
        let b = $('drone-btn');
        if (!b) {
            const vicino = $('funzioni-btn');
            if (!vicino) return null;
            b = el('button', { type: 'button', id: 'drone-btn', class: 'button-style button-secondary', title: 'Le riprese del drone in diretta', suClick: apri },
                el('i', { class: 'fas fa-helicopter', 'aria-hidden': 'true' }), el('span', { class: 'etichetta-testata', testo: ' Drone' }));
            vicino.after(b);
        }
        return b;
    }

    async function aggiorna() {
        const b = pulsante();
        if (!b) return;
        let aperta = false;
        try {
            stato = await fetchApi('/api/drone/stato');
            aperta = !!(await fetchApi('/api/emergencies/status'))?.active;
        } catch { stato = null; }
        const visibile = !!(stato?.attivo && aperta);
        b.style.display = visibile ? '' : 'none';
        if (!visibile) { chiudi(); for (const id of [...visioni.keys()]) smetti(id); return; }
        let dati = null;
        try { dati = await fetchApi('/api/drone/dirette'); } catch { dati = null; }
        if (pannello && stato?.puo_creare) squadreSala = await fetchApi('/api/squadre').catch(() => squadreSala);
        const inOnda = (dati?.chiavi || []).filter(k => k.in_onda);
        if (dati) {
            ultimiDati = dati;
            for (const id of [...visioni.keys()]) if (!inOnda.some(k => k.id === id)) smetti(id);
        }
        b.querySelector('.drone-in-onda')?.remove();
        if (inOnda.length) b.append(el('span', { class: 'drone-in-onda', title: `${inOnda.length} in onda` }));
        if (pannello) disegna(dati);
    }

    function chiudi() {
        // Prima via il pannello: ridisegnandosi a ogni vista tolta riaprirebbe da solo una diretta.
        pannello?.remove();
        pannello = null;
        for (const v of [...visioni.values()]) if (v.dove === 'pannello') smetti(v.id);
        chiaveMostrata = null;
        nonDaSoli.clear();
    }

    async function apri() {
        if (pannello) { chiudi(); return; }
        stile();
        pannello = el('div', { class: 'dr-pannello', role: 'dialog', 'aria-label': 'Drone' });
        document.body.append(pannello);
        if (stato?.puo_creare) squadreSala = await fetchApi('/api/squadre').catch(() => []);
        try { disegna(await fetchApi('/api/drone/dirette')); } catch (e) { pannello.replaceChildren(el('p', { testo: e.message })); }
    }

    function guarda(k, dove = 'pannello') {
        if (visioni.has(k.id)) { sposta(visioni.get(k.id), dove); return; }
        nonDaSoli.delete(k.id);
        const v = { id: k.id, nome: k.nome, dove, video: el('video', { class: 'dr-video', autoplay: true, muted: true, playsinline: true }), sessione: null, chiusa: false };
        visioni.set(k.id, v);
        DroneVideo.guarda(k.id, v.video, { suFine: () => { smetti(k.id); setTimeout(aggiorna, 1500); } })
            .then(sessione => { if (v.chiusa) sessione.chiudi(); else v.sessione = sessione; })
            .catch(e => { if (v.chiusa) return; nonDaSoli.add(k.id); smetti(k.id); notifica(e.message, 'errore'); });
        colloca(v);
    }

    function smetti(id, { scelta = false } = {}) {
        const v = visioni.get(id);
        if (!v) return;
        v.chiusa = true;
        visioni.delete(id);
        v.sessione?.chiudi();
        v.finestra?.remove();
        v.riquadro?.remove();
        if (scelta) nonDaSoli.add(id);
        if (pannello) disegna(ultimiDati);
    }

    function sposta(v, dove) {
        v.dove = dove;
        colloca(v);
        // Spostato da un contenitore all'altro il video può restare fermo: si fa ripartire.
        v.video.play?.().catch(() => {});
    }

    function colloca(v) {
        riquadro(v);
        if (v.dove === 'finestra') {
            if (!v.finestra) v.finestra = finestra(v);
            v.finestra.append(v.riquadro);
            if (pannello) disegna(ultimiDati);
            return;
        }
        v.finestra?.remove();
        v.finestra = null;
        if (pannello) disegna(ultimiDati); else apri();
    }

    function riquadro(v) {
        if (!v.riquadro) {
            v.comandi = el('span', { class: 'dr-comandi' });
            v.testa = el('div', { class: 'dr-vista-testa' }, el('span', { class: 'dr-punto', 'aria-hidden': 'true', title: 'In onda' }), el('strong', { testo: v.nome }), v.comandi);
            v.riquadro = el('div', { class: 'dr-vista', 'data-chiave': v.id }, v.testa, v.video);
            trascinabile(v);
        }
        const tasto = (icona, titolo, azione) => el('button', { type: 'button', class: 'dr-tasto', title: titolo, 'aria-label': titolo, suClick: azione },
            el('i', { class: `fas ${icona}`, 'aria-hidden': 'true' }));
        v.comandi.replaceChildren(...[
            v.dove === 'pannello' ? tasto('fa-up-right-from-square', 'Staccala in una finestra', () => sposta(v, 'finestra'))
                : tasto('fa-table-cells-large', 'Rimettila nel pannello', () => sposta(v, 'pannello')),
            document.pictureInPictureEnabled ? tasto('fa-clone', 'Sopra tutte le finestre, anche fuori dal browser', () => v.video.requestPictureInPicture().catch(() => {})) : null,
            tasto('fa-expand', 'Schermo intero', () => v.video.requestFullscreen?.().catch(() => {})),
            tasto('fa-xmark', 'Smetti di guardarla', () => smetti(v.id, { scelta: true }))
        ].filter(Boolean));
        return v.riquadro;
    }

    function finestra(v) {
        stile();
        const larghezza = Math.min(480, innerWidth - 16);
        const f = el('div', { class: 'dr-finestra', role: 'dialog', 'aria-label': `Drone: ${v.nome}` });
        Object.assign(f.style, {
            width: `${larghezza}px`, height: `${Math.round(larghezza * 9 / 16) + 34}px`,
            left: `${Math.max(8, (pannello ? pannello.getBoundingClientRect().left : innerWidth) - larghezza - 16 - cascata * 30)}px`,
            top: `${Math.max(8, Math.min(innerHeight - 200, 90 + cascata * 30))}px`,
            zIndex: ++primoPiano
        });
        cascata = (cascata + 1) % 6;
        f.addEventListener('pointerdown', () => { f.style.zIndex = ++primoPiano; });
        document.body.append(f);
        return f;
    }

    function trascinabile(v) {
        v.testa.addEventListener('pointerdown', (e) => {
            if (v.dove !== 'finestra' || !v.finestra || e.target.closest('button') || e.button !== 0) return;
            const f = v.finestra, r = f.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
            v.testa.setPointerCapture(e.pointerId);
            const muovi = (m) => {
                f.style.left = `${Math.min(Math.max(0, m.clientX - dx), innerWidth - 80)}px`;
                f.style.top = `${Math.min(Math.max(0, m.clientY - dy), innerHeight - 40)}px`;
            };
            const fine = () => { v.testa.removeEventListener('pointermove', muovi); v.testa.removeEventListener('pointerup', fine); v.testa.removeEventListener('pointercancel', fine); };
            v.testa.addEventListener('pointermove', muovi);
            v.testa.addEventListener('pointerup', fine);
            v.testa.addEventListener('pointercancel', fine);
            e.preventDefault();
        });
    }

    function disegna(dati) {
        if (!pannello) return;
        ultimiDati = dati;
        const chiavi = dati?.chiavi || [];
        const inOnda = chiavi.filter(k => k.in_onda);
        const daGuardare = inOnda.find(k => !nonDaSoli.has(k.id));
        if (!visioni.size && daGuardare) { guarda(daGuardare); return; }
        const posto = (v) => { const i = chiavi.findIndex(k => k.id === v.id); return i < 0 ? chiavi.length : i; };
        const nelPannello = [...visioni.values()].filter(v => v.dove === 'pannello').sort((a, b) => posto(a) - posto(b));
        const inFinestra = visioni.size - nelPannello.length;
        const parti = [el('div', { class: 'dr-testa' }, el('h2', { testo: 'Drone' }),
            el('button', { type: 'button', class: 'dr-chiudi', 'aria-label': 'Chiudi', testo: '×', suClick: chiudi }))];
        if (dati && dati.mediamtx === false) parti.push(el('p', { class: 'messaggio messaggio-errore', testo: 'Il server delle dirette (MediaMTX) non risponde: le chiavi restano valide, la diretta torna quando riparte.' }));
        if (dati?.respinto) parti.push(el('p', { class: 'messaggio messaggio-avviso', testo: `Alle ${ora(dati.respinto.il)} ${dati.respinto.nome} ha provato a trasmettere, ma c'erano già ${dati.respinto.massimo} droni in onda, il massimo per questa istanza (si cambia in Impostazioni, Moduli, Drone).` }));
        if (nelPannello.length) parti.push(el('div', { class: 'dr-griglia' }, nelPannello.map(riquadro)));
        else if (!inOnda.length) parti.push(el('p', { class: 'dr-nota', testo: chiavi.some(k => !k.revocata_il) ? 'Nessun drone sta trasmettendo adesso.' : 'Per trasmettere il pilota ha bisogno di una chiave per questa emergenza.' }));
        if (inFinestra) parti.push(el('p', { class: 'dr-nota', testo: inFinestra === 1 ? 'Una diretta è in una finestra a parte.' : `${inFinestra} dirette sono in finestre a parte.` }));
        if (inOnda.length > 1 || visioni.size) parti.push(el('p', { class: 'dr-nota', testo: 'Ogni diretta guardata pesa sulla rete della sala, circa 3 Mbit/s l\'una.' }));
        for (const k of chiavi) {
            let statoTesto = k.revocata_il ? 'tolta' : k.in_onda ? `in onda dalle ${ora(k.in_onda_da)}` : k.ultima_diretta_il ? `ultima diretta alle ${ora(k.ultima_diretta_il)}` : 'mai trasmesso';
            const guardata = visioni.get(k.id);
            const legame = [k.squadra ? `squadra ${k.squadra.nome_radio}` : null, k.pilota ? `pilota ${k.pilota.nome || ''}`.trim() : null].filter(Boolean).join(' · ');
            if (legame) statoTesto = `${statoTesto} · ${legame}`;
            parti.push(el('div', { class: 'dr-voce', 'data-chiave': k.id },
                el('span', { class: `dr-stato${k.in_onda ? ' onda' : ''}`, testo: k.in_onda ? 'IN ONDA' : k.revocata_il ? 'TOLTA' : 'SPENTO' }),
                el('span', { class: 'dr-nome' }, el('strong', { testo: k.nome }), el('small', { testo: guardata ? `${statoTesto} · ${guardata.dove === 'finestra' ? 'in finestra' : 'nel pannello'}` : statoTesto })),
                k.in_onda && !guardata ? el('button', { type: 'button', class: 'button-style button-small', testo: 'Guarda', title: 'Nel pannello, accanto alle altre', suClick: () => guarda(k) }) : null,
                k.in_onda && !guardata ? el('button', { type: 'button', class: 'button-style button-secondary button-small', title: 'In una finestra da spostare sopra la mappa', 'aria-label': `Guarda ${k.nome} in una finestra`, suClick: () => guarda(k, 'finestra') },
                    el('i', { class: 'fas fa-up-right-from-square', 'aria-hidden': 'true' })) : null,
                stato?.puo_creare && !k.revocata_il ? el('button', { type: 'button', class: 'button-style button-secondary button-small', testo: 'Squadra',
                    title: "Chi lo vede dall'app oltre alla sala e ai caposquadra: la squadra del pilota, o una squadra scelta",
                    suClick: () => { inModifica = inModifica === k.id ? null : k.id; disegna(ultimiDati); } }) : null,
                stato?.puo_creare && !k.revocata_il ? el('button', { type: 'button', class: 'button-style button-secondary button-small', testo: 'Togli', title: 'La chiave smette di valere e la diretta si ferma',
                    suClick: () => togli(k) }) : null));
            if (inModifica === k.id && !k.revocata_il) parti.push(moduloLegame(k));
        }
        if (stato?.puo_creare) parti.push(moduloNuova());
        if (chiaveMostrata) parti.push(chiaveMostrata);
        pannello.classList.toggle('largo', nelPannello.length > 1);
        pannello.replaceChildren(...parti);
        for (const v of nelPannello) if (v.video.paused && v.video.srcObject) v.video.play().catch(() => {});
    }

    async function togli(k) {
        if (!confirm(`Togliere la chiave di ${k.nome}? Se sta trasmettendo la diretta si ferma, e per riprendere serve una chiave nuova.`)) return;
        try {
            await fetchApi(`/api/drone/chiavi/${k.id}`, { method: 'DELETE' });
            chiaveMostrata = null;
            aggiorna();
        } catch (e) { notifica(e.message, 'errore'); }
    }

    // Pilota tra i membri delle squadre (conta la sua squadra), oppure una squadra scelta: decide chi lo vede dall'app.
    function sceltaLegame(k = null) {
        const pilota = el('select', { 'aria-label': 'Pilota' }, el('option', { value: '', testo: 'Nessuno' }));
        for (const s of squadreSala.filter(s => (s.membri || []).length)) {
            const gruppo = el('optgroup', { label: s.nome_radio || s.nome || 'Squadra' });
            for (const m of s.membri) gruppo.append(el('option', { value: m.username, testo: `${m.nome || ''} ${m.cognome || ''}`.trim() || m.username }));
            pilota.append(gruppo);
        }
        const squadra = el('select', { 'aria-label': 'Squadra' }, el('option', { value: '', testo: 'Nessuna' }),
            squadreSala.filter(s => !s.coc).map(s => el('option', { value: String(s.id), testo: s.nome_radio || s.nome })));
        pilota.value = k?.pilota?.username || '';
        squadra.value = !k?.pilota && k?.squadra ? String(k.squadra.id) : '';
        const allinea = () => { squadra.disabled = !!pilota.value; };
        pilota.addEventListener('change', allinea);
        allinea();
        return {
            nodo: el('div', { class: 'dr-legame' }, el('label', {}, el('span', { testo: 'Pilota (facoltativo)' }), pilota), el('label', {}, el('span', { testo: 'Squadra, se non c\'è il pilota' }), squadra)),
            valore: () => (pilota.value ? { pilota: pilota.value, squadra_id: null } : { pilota_id: null, squadra_id: squadra.value ? Number(squadra.value) : null })
        };
    }

    function moduloLegame(k) {
        const scelta = sceltaLegame(k);
        const salva = el('button', { type: 'submit', class: 'button-style button-small', testo: 'Salva' });
        const f = el('form', { class: 'dr-modifica' },
            el('p', { class: 'dr-nota', testo: "Dall'app lo vedono sempre la sala e i caposquadra; con un pilota anche la sua squadra, altrimenti la squadra scelta." }),
            scelta.nodo, salva);
        f.addEventListener('submit', async (e) => {
            e.preventDefault();
            salva.disabled = true;
            try {
                await fetchApi(`/api/drone/chiavi/${k.id}`, { method: 'PATCH', body: JSON.stringify(scelta.valore()) });
                inModifica = null;
                await aggiorna();
            } catch (err) { notifica(err.message, 'errore'); salva.disabled = false; }
        });
        return f;
    }

    function moduloNuova() {
        const nome = el('input', { type: 'text', maxlength: 80, placeholder: 'Matrice 4E – Marco', 'aria-label': 'Nome del drone o del pilota' });
        const legame = sceltaLegame();
        const crea = el('button', { type: 'submit', class: 'button-style', testo: 'Dai una chiave al pilota' });
        const f = el('form', { class: 'dr-nuova' }, el('strong', { testo: 'Nuovo collegamento' }),
            el('p', { class: 'dr-nota', testo: "Vale per questa emergenza (o simulazione) e smette di valere alla chiusura. Il pilota la inserisce una volta in DJI Pilot 2. Dall'app lo vedono la sala, i caposquadra e la squadra del pilota o quella scelta." }),
            nome, legame.nodo, crea);
        f.addEventListener('submit', async (e) => {
            e.preventDefault();
            crea.disabled = true;
            try {
                const k = await fetchApi('/api/drone/chiavi', { method: 'POST', body: JSON.stringify({ nome: nome.value, ...legame.valore() }) });
                chiaveMostrata = schedaChiave(k);
                await aggiorna();
            } catch (err) { notifica(err.message, 'errore'); crea.disabled = false; }
        });
        return f;
    }

    function schedaChiave(k) {
        const qr = el('div', { class: 'dr-qr' });
        if (typeof QRCode !== 'undefined') new QRCode(qr, { text: k.indirizzo, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
        const copia = (testo) => navigator.clipboard?.writeText(testo).then(() => notifica('Copiato.', 'successo')).catch(() => {});
        return el('div', { class: 'dr-chiave' },
            el('strong', { testo: `Chiave per ${k.nome}` }),
            el('p', { class: 'dr-nota', testo: 'Si vede solo adesso. In DJI Pilot 2: Diretta (Live Stream) › RTMP personalizzato, e si incolla l\'indirizzo completo, o lo si inquadra.' }),
            qr,
            el('span', { testo: 'Indirizzo completo' }), el('code', { testo: k.indirizzo }),
            el('button', { type: 'button', class: 'button-style button-secondary button-small', testo: 'Copia l\'indirizzo', suClick: () => copia(k.indirizzo) }),
            el('span', { testo: 'Se l\'app chiede server e chiave separati' }), el('code', { testo: `${k.server}  ·  ${k.chiave}` }),
            el('p', { class: 'dr-nota', testo: 'Nel drone: video H.264 (non H.265), 720p o 1080p, 2-4 Mbit/s.' }));
    }

    document.addEventListener('DOMContentLoaded', () => setTimeout(aggiorna, 1200));
    for (const ev of ['reload_drone', 'emergency_status_change']) document.addEventListener(`ws:${ev}`, () => setTimeout(aggiorna, 400));
    window.droneCo = { aggiorna };
})();
