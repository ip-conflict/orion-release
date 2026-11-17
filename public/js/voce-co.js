// Orion Voice nel centro operativo: la linguetta, la barra delle squadre, PARLA da
// schermo, da tastiera e da pedale, le conferme, l'emergenza. Il protocollo è nel manuale tecnico.

import { MotoreVoce } from '/js/voce-audio.js';

const DURATA_MASSIMA_MS = 60_000;
const INIZIO_CONTO_MS = 50_000;
const DURATA_MINIMA_MS = 500;
const RECENTE_MS = 2 * 60_000;
const DURATA_PACCHETTO_MS = 60;
// Senza risposta la postazione resterebbe su "attendi" o "invio" fino a ricaricare la pagina.
const ATTESA_VIA_MS = 6_000;
const ATTESA_SALVATO_MS = 15_000;
const CHIAVE_CUFFIE = 'orion.voce.cuffie-spente';
const CHIAVE_VOLUME = 'orion.voce.volume';
const CHIAVE_ATTIVATA = 'orion.voce.attivata';
const CHIAVE_RIPIEGATO = 'orion.voce.ripiegato';
// Chi ha già ascoltato l'emergenza la sta gestendo: l'allarme continuo copriva la voce e il
// telefono; fino alla presa in carico resta solo un richiamo.
const RICHIAMO_EMERGENZA_MS = 30_000;

const motore = new MotoreVoce();
const stato = {
    disponibile: false,
    collegato: false,
    ws: null,
    tentativi: 0,
    riapertura: null,
    utente: null,
    emergenza: null,
    canali: new Map(),
    parola: {},
    presenze: {},
    selezionato: null,
    messaggi: new Map(),
    vive: new Map(),
    emergenze: new Map(),
    tx: null,
    ultimoAscoltato: null,
    filtroCanale: '',
    filtroPersona: '',
    filtroTesto: '',
    aperto: false,
    versione: 0
};

const leggi = (chiave, base) => {
    try { return JSON.parse(localStorage.getItem(chiave)) ?? base; } catch { return base; }
};
const scrivi = (chiave, valore) => {
    try { localStorage.setItem(chiave, JSON.stringify(valore)); } catch { /* resta per questa pagina */ }
};
const cuffieSpente = new Set(leggi(CHIAVE_CUFFIE, []));
// Senza scelta per postazione: il tasto lo decide l'amministratore per tutti (voce_tasto).
const tasti = { parla: 'F9', ricevuto: 'F8' };

function el(tag, attributi = {}, ...figli) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attributi)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'testo') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of figli.flat()) if (f != null && f !== false) e.append(f);
    return e;
}
const icona = (nome) => el('i', { class: `fas fa-${nome}`, 'aria-hidden': 'true' });
const ora = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const secondi = (ms) => `${Math.max(1, Math.round((ms || 0) / 1000))} s`;
const colore = (testo) => {
    let h = 0;
    for (const c of String(testo)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 65% 45%)`;
};
const feedback = (testo, tipo = 'info', durata = 4000) => window.orionCentro?.feedback?.(testo, tipo, durata);
const diSala = () => stato.utente?.sala || stato.utente?.coordinatore;
const nomeCanale = (id) => stato.canali.get(id)?.nome || (id === 'avvisi' ? 'Avvisi a tutti' : id);
const squadraDelCanale = (id) => (/^squadra:(\d+)$/.exec(id || '') || [])[1];
const cuffiaAccesa = (id) => id === 'avvisi' || !cuffieSpente.has(id);

function nonAscoltati(canale = null) {
    let n = 0;
    for (const m of stato.messaggi.values()) {
        if ((canale === null || m.canale === canale) && !m.da_sala && !m.riprodotto_in_sala && m.autore?.id !== stato.utente?.id) n++;
    }
    return n;
}

// La verifica dice se per chi guarda la voce c'è: modulo acceso, emergenza aperta, almeno un canale.
async function verifica() {
    let risposta;
    try {
        risposta = await fetch('/api/voce/stato', { credentials: 'same-origin' });
    } catch {
        return;
    }
    const dati = risposta.ok ? await risposta.json().catch(() => null) : null;
    const disponibile = !!dati?.attiva;
    if (disponibile && !stato.disponibile) {
        stato.disponibile = true;
        stato.utente = { ...dati.ruolo };
        preparaPannello();
        caricaCronologia();
        caricaEmergenze();
        collega();
    } else if (!disponibile && stato.disponibile) {
        stato.disponibile = false;
        chiudiCollegamento();
        smonta();
    }
}

function collega() {
    clearTimeout(stato.riapertura);
    if (!stato.disponibile || (stato.ws && stato.ws.readyState <= 1)) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/voce`);
    ws.binaryType = 'arraybuffer';
    stato.ws = ws;
    ws.onopen = () => {
        stato.collegato = true;
        stato.tentativi = 0;
        const ultimo = Math.max(0, ...[...stato.messaggi.keys()]);
        invia({ t: 'ciao', ultimo });
        disegna();
    };
    ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
            try { gestisci(JSON.parse(e.data)); } catch (errore) { console.error('[Voce] Messaggio non gestito:', errore); }
            return;
        }
        const vista = new DataView(e.data);
        const voce = stato.vive.get(vista.getUint32(0));
        if (voce) motore.pacchetto(voce, new Uint8Array(e.data, 6));
    };
    ws.onclose = (e) => {
        if (stato.ws === ws) stato.ws = null;
        stato.collegato = false;
        if (stato.tx) chiudiTrasmissione('Collegamento perso: il messaggio non è partito. Usa la radio se è urgente.');
        disegna();
        if (!stato.disponibile || e.code === 4000 || e.code === 4002) {
            verifica();
            return;
        }
        const attesa = Math.min(10_000, 500 * 2 ** stato.tentativi++);
        stato.riapertura = setTimeout(async () => {
            await verifica();
            collega();
        }, attesa);
    };
}

function chiudiCollegamento() {
    clearTimeout(stato.riapertura);
    if (stato.ws) {
        const ws = stato.ws;
        stato.ws = null;
        ws.close();
    }
    stato.collegato = false;
}

function invia(dati) {
    if (stato.ws?.readyState === 1) stato.ws.send(JSON.stringify(dati));
}

function mandaCuffie() {
    invia({ t: 'cuffie', canali: [...stato.canali.keys()].filter(cuffiaAccesa) });
}

function ricordaMessaggio(m) {
    stato.versione++;
    const prima = stato.messaggi.get(m.id);
    stato.messaggi.set(m.id, { ...prima, ...m });
    return stato.messaggi.get(m.id);
}

// La cronologia si ridisegna solo quando cambia la versione: un evento che la tocca e manca qui non si vede.
const COMANDI_DELLA_STORIA = new Set(['fine', 'annullato', 'riprodotto', 'ricevuto', 'trascritto', 'stato', 'canali']);

function gestisci(m) {
    if (COMANDI_DELLA_STORIA.has(m.t)) stato.versione++;
    switch (m.t) {
        case 'stato':
            stato.utente = { ...stato.utente, ...m.utente };
            stato.emergenza = m.emergenza;
            stato.canali = new Map(m.canali.map(c => [c.id, c]));
            stato.parola = m.parola || {};
            if (!stato.selezionato || !stato.canali.has(stato.selezionato)) stato.selezionato = primoCanale();
            mandaCuffie();
            if (pannello && fisso() !== document.body.classList.contains('voce-fissa')) apriPannello(fisso() || stato.aperto);
            break;
        case 'canali':
            stato.canali = new Map(m.canali.map(c => [c.id, c]));
            if (!stato.canali.has(stato.selezionato)) stato.selezionato = primoCanale();
            mandaCuffie();
            break;
        case 'persi':
            for (const meta of m.messaggi) {
                const nuovo = !stato.messaggi.has(meta.id);
                ricordaMessaggio(meta);
                if (nuovo && Date.now() - new Date(meta.registrato_il).getTime() < RECENTE_MS) ascoltaDaFile(meta);
            }
            break;
        case 'parola':
            if (m.da) stato.parola[m.canale] = m.da;
            else delete stato.parola[m.canale];
            pulsaSullaMappa(m.canale, !!m.da);
            break;
        case 'inizio': {
            const meta = ricordaMessaggio(m.messaggio);
            if (meta.priorita === 'emergenza') apriEmergenza(meta);
            if (meta.autore?.id === stato.utente?.id) break;
            if (!cuffiaAccesa(meta.canale) && meta.priorita !== 'emergenza') break;
            const voce = motore.nuovo(meta, { inDiretta: true });
            stato.vive.set(meta.id, voce);
            if (motore.decodificaInDiretta) motore.accoda(voce);
            break;
        }
        case 'fine': {
            const meta = stato.messaggi.get(m.id);
            if (meta) Object.assign(meta, { durata_ms: m.durata_ms ?? meta.durata_ms, stato: m.stato === 'in_ritardo' ? 'in_arrivo' : m.stato });
            const voce = stato.vive.get(m.id);
            if (voce) {
                stato.vive.delete(m.id);
                if (motore.decodificaInDiretta) motore.concludi(voce);
                else if (m.stato !== 'in_ritardo') ascoltaDaFile(meta);
            }
            break;
        }
        case 'messaggio': {
            const meta = ricordaMessaggio(m.messaggio);
            if (meta.priorita === 'emergenza') apriEmergenza(meta);
            if (meta.autore?.id !== stato.utente?.id && Date.now() - new Date(meta.registrato_il).getTime() < RECENTE_MS) ascoltaDaFile(meta);
            break;
        }
        case 'annullato':
            if (m.id) {
                stato.messaggi.delete(m.id);
                stato.vive.delete(m.id);
                motore.togli(m.id);
            } else if (m.uuid === stato.tx?.uuid) {
                if (m.motivo === 'breve') feedback('Troppo breve: tieni premuto mentre parli.', 'info');
                fineTrasmissione();
            }
            break;
        case 'riprodotto':
            if (stato.messaggi.has(m.id)) stato.messaggi.get(m.id).riprodotto_in_sala = true;
            break;
        case 'ricevuto':
            if (stato.messaggi.has(m.id)) stato.messaggi.get(m.id).ricevuto_da = m.da;
            break;
        case 'trascritto':
            if (stato.messaggi.has(m.id)) stato.messaggi.get(m.id).trascrizione = m.testo;
            document.querySelectorAll(`.voce-nota-testo[data-voce="${m.id}"]`).forEach(n => { n.textContent = m.testo; n.hidden = false; });
            break;
        case 'presenze':
            stato.presenze = m.canali;
            break;
        case 'presa_in_carico':
            chiudiEmergenza(m.id, m.da);
            break;
        case 'parla_ok':
            if (m.uuid === stato.tx?.uuid) concessa();
            break;
        case 'occupato':
            if (m.uuid === stato.tx?.uuid) {
                motore.tono('occupato');
                chiudiTrasmissione(`Canale occupato: sta parlando ${m.da?.nome || 'qualcuno'}${m.da?.squadra ? ` (${m.da.squadra})` : ''}.`);
            }
            break;
        case 'negato':
            if (m.uuid === stato.tx?.uuid) {
                motore.tono('errore');
                chiudiTrasmissione(m.messaggio || 'Non puoi parlare su questo canale.');
            }
            break;
        case 'interrotto':
            if (m.uuid === stato.tx?.uuid) {
                motore.tono('interrotto');
                chiudiTrasmissione(`${m.da?.nome || 'La sala'} ha preso la parola: il tuo messaggio è salvato fin lì.`);
            }
            break;
        case 'salvato':
            if (m.uuid === stato.tx?.uuid) {
                motore.tono('consegnato');
                fineTrasmissione();
            }
            break;
        case 'manca':
            if (m.uuid === stato.tx?.uuid) {
                stato.tx.inviati = m.ricevuti;
                svuota(stato.tx);
                invia({ t: 'fine', uuid: stato.tx.uuid, pacchetti: stato.tx.pacchetti.length });
            }
            break;
        case 'chiuso':
            if (m.messaggio) feedback(m.messaggio, 'info', 6000);
            break;
        case 'errore':
            feedback(m.messaggio, 'error', 6000);
            break;
    }
    disegna();
}

// F9 e il pedale parlano sull'ultimo canale usato con PARLA; all'inizio sul primo su cui si può parlare.
function primoCanale() {
    const ordine = ordineCanali();
    return (ordine.find(c => c.parla) || ordine[0])?.id || null;
}

function ordineCanali() {
    const peso = { generale: 0, squadra: 1, diretto: 2, avviso: 3 };
    return [...stato.canali.values()]
        .filter(c => c.tipo !== 'avviso')
        .sort((a, b) => peso[a.tipo] - peso[b.tipo] || String(a.nome).localeCompare(String(b.nome), 'it'));
}

function ascoltaDaFile(meta) {
    if (!meta || !cuffiaAccesa(meta.canale) && meta.priorita !== 'emergenza') return;
    if (motore.attuale?.id === meta.id || motore.coda.some(v => v.id === meta.id)) return;
    const voce = motore.nuovo(meta);
    voce.finito = false;
    motore.caricaFile(voce, `/api/voce/messaggi/${meta.id}/audio`)
        .then(() => motore.accoda(voce))
        .catch(e => console.warn('[Voce] Messaggio non scaricato:', e.message));
}

function riascolta(meta) {
    const voce = motore.nuovo(meta);
    voce.finito = false;
    voce.riascolto = true;
    motore.caricaFile(voce, `/api/voce/messaggi/${meta.id}/audio`)
        .then(() => {
            motore.accoda(voce);
            motore.subito(voce.id);
        })
        .catch(e => feedback(e.message, 'error'));
}

motore.allInizio = () => {
    stato.versione++;
    aggiornaAllarme();
    disegna();
};
motore.allaFine = (voce) => {
    stato.versione++;
    aggiornaAllarme();
    const meta = stato.messaggi.get(voce.id);
    if (meta && meta.autore?.id !== stato.utente?.id) {
        invia({ t: 'ascoltato', id: voce.id, in_diretta: voce.inDirettaAllInizio === true });
        if (!meta.da_sala) stato.ultimoAscoltato = voce.id;
    }
    disegna();
};
motore.alCambio = () => { aggiornaAllarme(); disegna(); };

// Si parla appena si preme: la richiesta della parola e l'apertura del microfono vanno insieme,
// il bip arriva quando il server dice di sì.
async function iniziaTrasmissione(canale, { priorita } = {}) {
    if (stato.tx || !canale) return;
    if (!stato.collegato) {
        motore.tono('errore');
        feedback('Orion Voice non è collegata: usa la radio.', 'error', 5000);
        return;
    }
    if (!motore.puoParlare) {
        await motore.attiva().catch(() => {});
        if (!motore.puoParlare) {
            feedback('Questo browser può solo ascoltare: per parlare serve Chrome, Edge o Firefox recente.', 'error', 6000);
            return;
        }
    }
    const info = stato.canali.get(canale);
    if (!info?.parla) return;
    const tx = {
        uuid: crypto.randomUUID(), canale, pacchetti: [], inviati: 0, concesso: false, rilasciato: false,
        priorita: canale === 'avvisi' ? 'alta' : (priorita || 'normale'),
        dal: Date.now()
    };
    stato.tx = tx;
    motore.sospendi(true);
    tx.timer = setInterval(controllaDurata, 250);
    // La prima volta il browser chiede il permesso del microfono: si chiede la parola dopo, se no il
    // server vede secondi senza audio mentre l'operatore legge la domanda e libera il canale.
    const permesso = await navigator.permissions?.query({ name: 'microphone' }).then(p => p.state).catch(() => null);
    if (permesso === 'granted') chiediLaParola(tx);
    disegna();
    try {
        tx.microfono = await motore.apriMicrofono({
            suPacchetto: (p) => { tx.pacchetti.push(p); svuota(tx); },
            suLivello: (l) => { tx.livello = l; },
            suErrore: (e) => console.error('[Voce] Codifica:', e)
        });
    } catch (e) {
        if (stato.tx === tx) {
            invia({ t: 'annulla', uuid: tx.uuid });
            motore.tono('errore');
            chiudiTrasmissione(e.name === 'NotAllowedError' ? 'Il browser non lascia usare il microfono: consentilo dall\'icona accanto all\'indirizzo.' : `Microfono non disponibile: ${e.message}`);
        }
        return;
    }
    if (stato.tx !== tx) {
        tx.microfono.chiudi();
        return;
    }
    if (!tx.chiesta) chiediLaParola(tx);
    if (tx.rilasciato) rilascia();
}

function chiediLaParola(tx) {
    tx.chiesta = true;
    invia({ t: 'parla', uuid: tx.uuid, canale: tx.canale, priorita: tx.priorita });
    tx.guardia = setTimeout(() => {
        if (stato.tx !== tx || tx.concesso) return;
        invia({ t: 'annulla', uuid: tx.uuid });
        motore.tono('errore');
        chiudiTrasmissione('Il server non risponde: il messaggio non è partito. Riprova, o usa la radio.');
    }, ATTESA_VIA_MS);
}

function concessa() {
    const tx = stato.tx;
    tx.concesso = true;
    tx.concessoIl = Date.now();
    motore.tono('parla');
    svuota(tx);
    if (tx.chiuso) concludi(tx);
}

function svuota(tx) {
    if (!tx.concesso || stato.ws?.readyState !== 1) return;
    while (tx.inviati < tx.pacchetti.length) {
        const p = tx.pacchetti[tx.inviati];
        const trama = new Uint8Array(2 + p.length);
        trama[0] = tx.inviati >> 8;
        trama[1] = tx.inviati & 0xff;
        trama.set(p, 2);
        stato.ws.send(trama);
        tx.inviati++;
    }
}

async function rilascia() {
    const tx = stato.tx;
    if (!tx || tx.chiusura) return;
    tx.rilasciato = true;
    if (!tx.microfono) return;
    tx.chiusura = true;
    clearInterval(tx.timer);
    await tx.microfono.chiudi().catch(() => {});
    tx.chiuso = true;
    if (tx.concesso) concludi(tx);
    disegna();
}

function concludi(tx) {
    if (tx.pacchetti.length * DURATA_PACCHETTO_MS < DURATA_MINIMA_MS) {
        invia({ t: 'annulla', uuid: tx.uuid });
        fineTrasmissione();
        return;
    }
    svuota(tx);
    invia({ t: 'fine', uuid: tx.uuid, pacchetti: tx.pacchetti.length });
    clearTimeout(tx.guardia);
    tx.guardia = setTimeout(() => {
        if (stato.tx === tx) chiudiTrasmissione('Il server non ha confermato il messaggio: guarda nella cronologia se è arrivato, se no ripetilo.');
    }, ATTESA_SALVATO_MS);
}

function controllaDurata() {
    const tx = stato.tx;
    if (!tx) return;
    const trascorso = Date.now() - tx.dal;
    if (trascorso >= DURATA_MASSIMA_MS) rilascia();
    else if (trascorso >= INIZIO_CONTO_MS && Math.floor(trascorso / 1000) !== tx.ultimoConto) {
        tx.ultimoConto = Math.floor(trascorso / 1000);
        motore.tono('conto');
    }
    disegnaTrasmissione();
}

function chiudiTrasmissione(messaggio) {
    const tx = stato.tx;
    if (!tx) return;
    tx.microfono?.chiudi().catch(() => {});
    if (messaggio) feedback(messaggio, 'error', 6000);
    fineTrasmissione();
}

function fineTrasmissione() {
    const tx = stato.tx;
    if (tx) {
        clearInterval(tx.timer);
        clearTimeout(tx.guardia);
    }
    stato.tx = null;
    motore.sospendi(false);
    disegna();
}

// Il rilascio del tasto non arriva se la finestra perde il fuoco mentre lo si tiene premuto:
// senza questo il messaggio andrebbe avanti fino al limite di un minuto.
window.addEventListener('blur', () => rilascia());
document.addEventListener('visibilitychange', () => { if (document.hidden) rilascia(); });

document.addEventListener('keydown', (e) => {
    if (!stato.disponibile || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === tasti.parla) {
        e.preventDefault();
        if (!e.repeat) iniziaTrasmissione(stato.selezionato);
    } else if (e.key === tasti.ricevuto && diSala()) {
        e.preventDefault();
        if (!e.repeat && stato.ultimoAscoltato) confermaRicevuto(stato.ultimoAscoltato);
    }
});
document.addEventListener('keyup', (e) => {
    if (e.key === tasti.parla && stato.tx) {
        e.preventDefault();
        rilascia();
    }
});

function confermaRicevuto(id) {
    const meta = stato.messaggi.get(id);
    if (!meta || meta.ricevuto_da) return;
    invia({ t: 'ricevuto', id });
    feedback(`Ricevuto: ${meta.autore?.nome || ''}${meta.nome_radio ? ` (${meta.nome_radio})` : ''} lo vede sul telefono.`, 'success', 2500);
}

function tastoParla(canale, testo, classe = '', opzioni = {}) {
    const b = el('button', { type: 'button', class: `voce-parla ${classe}`.trim(), title: 'Tieni premuto e parla' }, icona('microphone'), ' ', testo);
    // Il rilascio si ascolta sul documento: mentre si tiene premuto il pannello si ridisegna e il
    // pulsante sotto il dito può non esserci più.
    b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        stato.selezionato = canale;
        const lascia = () => {
            document.removeEventListener('pointerup', lascia, true);
            document.removeEventListener('pointercancel', lascia, true);
            rilascia();
        };
        document.addEventListener('pointerup', lascia, true);
        document.addEventListener('pointercancel', lascia, true);
        iniziaTrasmissione(canale, opzioni);
    });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    if (stato.tx?.canale === canale) b.classList.add('in-trasmissione');
    if (!stato.collegato || !motore.puoParlare && motore.configCodifica === false) b.disabled = true;
    return b;
}

let pannello = null;
let fasciaAttiva = null;
let fasciaEmergenze = null;

function preparaPannello() {
    if (pannello) return;
    const mappa = document.getElementById('map-container');
    if (!mappa) return;
    pannello = el('aside', { id: 'pannello-voce', class: 'chiuso' },
        el('button', { type: 'button', id: 'toggle-voce-btn', 'aria-label': 'Mostra o nascondi la voce', onclick: () => apriPannello(!stato.aperto) },
            icona('headset'), el('span', { class: 'etichetta-voce', testo: 'Orion Voice' }), el('span', { id: 'badge-voce', class: 'badge-sezione', hidden: true })),
        el('div', { id: 'contenuto-voce' }));
    mappa.appendChild(pannello);
    if (fisso()) apriPannello(true);
    const giaAttivata = leggi(CHIAVE_ATTIVATA, false);
    fasciaAttiva = el('div', { id: 'voce-fascia-attiva', hidden: true },
        icona('volume-xmark'),
        el('span', { testo: giaAttivata ? 'Cambiando pagina il browser mette in pausa l\'audio: un clic qualsiasi sulla pagina lo riaccende.' : 'Orion Voice è muta finché non la attivi.' }),
        el('button', { type: 'button', class: 'button-style', onclick: attivaVoce }, icona('headset'), giaAttivata ? ' Riaccendi' : ' Attiva Orion Voice'));
    fasciaEmergenze = el('div', { id: 'voce-emergenze' });
    const area = document.getElementById('area-lavoro');
    area?.parentNode.insertBefore(fasciaAttiva, area);
    area?.parentNode.insertBefore(fasciaEmergenze, area);
    document.getElementById('toggle-eventi-btn')?.addEventListener('click', () => { if (!fisso()) apriPannello(false); });
    const volume = leggi(CHIAVE_VOLUME, 1);
    motore.impostaVolume(volume);
    // Il browser fa suonare solo dopo un gesto: il primo clic o tasto sulla pagina riaccende l'ascolto.
    const alPrimoGesto = () => { if (stato.disponibile && !motore.attivo) motore.attiva().then(ricordaAttivata).then(disegna).catch(() => {}); };
    document.addEventListener('pointerdown', alPrimoGesto, { capture: true });
    document.addEventListener('keydown', alPrimoGesto, { capture: true });
    // Chi l'ha già attivata non deve rifarlo a ogni pagina: spesso il browser lo concede da sé, e
    // se non lo concede la promessa resta in sospeso fino al primo gesto, quindi non la si aspetta.
    if (giaAttivata) Promise.race([motore.attiva(), new Promise(r => setTimeout(r, 800))]).then(disegna).catch(() => {});
    disegna();
}

function smonta() {
    pannello?.remove();
    fasciaAttiva?.remove();
    fasciaEmergenze?.remove();
    pannello = fasciaAttiva = fasciaEmergenze = null;
    motore.allarme(false);
    document.body.classList.remove('voce-aperta', 'voce-fissa');
}

// Chi è in sala ascolta e risponde tutto il turno: per lui il pannello resta aperto e gli eventi
// si aprono accanto. Gli altri lo aprono quando serve, al posto degli eventi.
const fisso = () => diSala();

function apriPannello(apri) {
    if (fisso()) apri = true;
    stato.aperto = apri;
    document.body.classList.toggle('voce-fissa', fisso());
    if (apri && !fisso() && !document.getElementById('pannello-eventi')?.classList.contains('chiuso')) document.getElementById('chiudi-eventi-btn')?.click();
    pannello?.classList.toggle('chiuso', !apri);
    document.body.classList.toggle('voce-aperta', apri);
    disegna();
}

function ricordaAttivata() {
    if (motore.attivo) scrivi(CHIAVE_ATTIVATA, true);
}

async function attivaVoce() {
    try {
        await motore.attiva();
        ricordaAttivata();
        if (motore.puoParlare) {
            // La prima volta il browser chiede il permesso del microfono: meglio qui che alla prima chiamata vera.
            const flusso = await navigator.mediaDevices.getUserMedia({ audio: true });
            flusso.getTracks().forEach(t => t.stop());
        }
        motore.tono('consegnato');
        feedback(motore.puoParlare ? 'Orion Voice attiva: senti le squadre e puoi parlare.' : 'Orion Voice attiva in solo ascolto: questo browser non può parlare.', 'success');
    } catch (e) {
        feedback(e.name === 'NotAllowedError' ? 'Ascolto attivo, ma il microfono è bloccato: consentilo dall\'icona accanto all\'indirizzo.' : `Voce non attivata: ${e.message}`, 'error', 7000);
    }
    disegna();
}

let disegnoInAttesa = false;
function disegna() {
    if (disegnoInAttesa) return;
    disegnoInAttesa = true;
    requestAnimationFrame(() => {
        disegnoInAttesa = false;
        if (!pannello) return;
        disegnaPannello();
        disegnaBarraSquadre();
        disegnaEmergenze();
    });
}

function presenzaCanale(c) {
    const p = stato.presenze[c.id];
    if (!p) return null;
    if (c.tipo === 'squadra' && p.membri != null) return el('span', { class: 'voce-presenze', title: 'Telefoni con la voce accesa / membri della squadra' }, icona('mobile-screen'), ` ${p.in_ascolto}/${p.membri}`);
    if (c.tipo === 'diretto') return el('span', { class: 'voce-presenze', title: p.in_ascolto ? 'Ha la voce accesa' : 'Non ha la voce accesa' }, icona(p.in_ascolto ? 'mobile-screen' : 'mobile-screen-button'));
    return null;
}

function ultimoDi(canale) {
    let ultimo = null;
    for (const m of stato.messaggi.values()) if (m.canale === canale && (!ultimo || m.id > ultimo.id)) ultimo = m;
    return ultimo;
}

function rigaCanale(c) {
    const parla = stato.parola[c.id];
    const inCoda = motore.coda.find(v => v.meta.canale === c.id);
    const inAscolto = motore.attuale?.meta.canale === c.id;
    const p = stato.presenze[c.id];
    const nessunaPostazione = diSala() && p && p.postazioni === 0 && (p.in_ascolto > 0 || parla);
    const ultimo = ultimoDi(c.id);
    const daSentire = nonAscoltati(c.id);
    const cuffia = cuffiaAccesa(c.id);
    const riga = el('li', {
        class: ['voce-canale', parla && 'parla-ora', inCoda && 'in-attesa', nessunaPostazione && 'nessuno-ascolta', !cuffia && 'muto'].filter(Boolean).join(' '),
        dataset: { canale: c.id },
        style: `--colore-canale: ${colore(c.nome)}`
    });
    const stato2 = parla
        ? el('span', { class: 'voce-chi-parla' }, el('span', { class: 'voce-onda', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), ` ${parla.nome}${parla.squadra && c.tipo !== 'squadra' ? ` (${parla.squadra})` : ''}`)
        : inAscolto ? el('span', { class: 'voce-chi-parla' }, icona('volume-high'), ` ${motore.attuale.meta.autore?.nome || ''}`)
        : inCoda ? el('button', { type: 'button', class: 'voce-in-attesa', title: 'Ascolta subito', onclick: () => motore.subito(inCoda.id) }, `in attesa, ${Math.round((Date.now() - inCoda.arrivatoIl) / 1000)} s`)
        : ultimo ? el('button', { type: 'button', class: 'voce-ultimo', title: 'Riascolta', onclick: () => riascolta(ultimo) }, icona('play'), ` ${ora(ultimo.registrato_il)} · ${secondi(ultimo.durata_ms)} · ${ultimo.autore?.nome || ''}`)
        : null;
    riga.append(
        el('div', { class: 'voce-corpo' },
            el('div', { class: 'voce-testa' },
                el('strong', { testo: c.nome }),
                daSentire ? el('span', { class: 'voce-da-sentire', title: 'Messaggi che nessuna postazione ha ascoltato', testo: String(daSentire) }) : null,
                presenzaCanale(c),
                el('button', { type: 'button', class: `voce-cuffia${cuffia ? ' accesa' : ''}`, 'aria-pressed': String(cuffia), title: cuffia ? 'Questa postazione ascolta il canale: clic per smettere' : 'Questa postazione non ascolta il canale: clic per ascoltarlo',
                    onclick: () => { cuffia ? cuffieSpente.add(c.id) : cuffieSpente.delete(c.id); scrivi(CHIAVE_CUFFIE, [...cuffieSpente]); mandaCuffie(); disegna(); } }, icona(cuffia ? 'headphones' : 'headphones-simple')),
                c.tipo === 'diretto' && stato.utente?.sala ? el('button', { type: 'button', class: 'voce-chiudi-diretto', title: 'Chiudi il canale diretto', onclick: () => chiudiDiretto(c.id) }, icona('xmark')) : null),
            el('div', { class: 'voce-stato' }, stato2),
            nessunaPostazione ? el('div', { class: 'voce-nessuno', testo: `Nessuna postazione ascolta ${c.nome}` }) : null),
        c.parla ? tastoParla(c.id, 'PARLA') : null);
    return riga;
}

function scheletroPannello(contenuto) {
    const volume = el('input', { type: 'range', min: '0', max: '1.5', step: '0.05', value: String(leggi(CHIAVE_VOLUME, 1)), title: 'Volume della voce', 'aria-label': 'Volume della voce' });
    volume.addEventListener('input', () => { motore.impostaVolume(Number(volume.value)); scrivi(CHIAVE_VOLUME, Number(volume.value)); });
    contenuto.replaceChildren(
        el('div', { class: 'intestazione-eventi' },
            el('span', {}, 'ORION VOICE ', el('span', { class: 'spia-diretta', id: 'voce-spia' })),
            el('span', { class: 'voce-comandi' }, icona('volume-low'), volume,
                el('button', { type: 'button', id: 'ripiega-voce-btn', 'aria-label': 'Ripiega il pannello della voce', title: 'Ripiega: resta una colonna stretta e la voce continua', onclick: () => ripiega(true) }, icona('angles-right')),
                fisso() ? null : el('button', { type: 'button', id: 'chiudi-voce-btn', 'aria-label': 'Chiudi Orion Voice', title: 'Chiudi', onclick: () => apriPannello(false) }, '×'))),
        el('div', { id: 'voce-compatta', class: 'voce-compatta' }),
        el('div', { id: 'voce-avvisi-pannello' }),
        el('div', { id: 'voce-trasmissione', hidden: true }),
        el('ul', { class: 'voce-canali', id: 'voce-canali' }),
        el('div', { class: 'voce-tutti', id: 'voce-tutti' }),
        el('div', { class: 'voce-cronologia', id: 'voce-cronologia' }));
    contenuto.dataset.pronto = '1';
    stato.versioneDisegnata = -1;
}

// Ripiegato il pannello lascia la mappa alla sala: per ogni canale la sigla, chi parla e i messaggi da
// sentire, più il PARLA del canale generale. La voce e il tasto della tastiera funzionano come prima.
function ripiega(si) {
    scrivi(CHIAVE_RIPIEGATO, si);
    disegna();
    setTimeout(() => window.mappaCentroOperativo?.invalidateSize?.(), 50);
}

function sigla(nome) {
    const parole = String(nome || '?').trim().split(/\s+/).filter(Boolean);
    return (parole.length > 1 ? parole[0][0] + parole[1][0] : String(nome || '?').slice(0, 2)).toUpperCase();
}

function disegnaCompatta() {
    const box = document.getElementById('voce-compatta');
    if (!box) return;
    const tessere = ordineCanali().map(c => {
        const parla = stato.parola[c.id];
        const daSentire = nonAscoltati(c.id);
        return el('li', {
            class: ['voce-tessera', parla && 'parla-ora', !cuffiaAccesa(c.id) && 'muto'].filter(Boolean).join(' '),
            title: `${c.nome}${parla ? ` · parla ${parla.nome}` : ''}${daSentire ? ` · ${daSentire} da sentire` : ''}`,
            style: `--colore-canale: ${colore(c.nome)}`
        },
            el('span', { class: 'voce-sigla', testo: sigla(c.nome) }),
            parla ? el('span', { class: 'voce-onda', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')) : null,
            daSentire ? el('span', { class: 'voce-da-sentire', testo: String(daSentire) }) : null);
    });
    const generale = ordineCanali().find(c => c.tipo === 'generale' && c.parla);
    box.replaceChildren(
        el('button', { type: 'button', class: 'voce-espandi', 'aria-label': 'Apri il pannello della voce', title: 'Apri il pannello', onclick: () => ripiega(false) }, icona('angles-left')),
        el('span', { class: 'spia-diretta' + (stato.collegato ? '' : ' spenta'), title: stato.collegato ? 'Collegata' : 'Non collegata: usa la radio' }),
        el('ul', { class: 'voce-tessere' }, ...tessere),
        generale ? tastoParla(generale.id, 'PARLA', 'voce-parla-compatto') : null);
}

function disegnaPannello() {
    const contenuto = document.getElementById('contenuto-voce');
    const linguetta = document.getElementById('toggle-voce-btn');
    const badge = document.getElementById('badge-voce');
    const totale = nonAscoltati();
    linguetta.classList.toggle('voce-muta', !motore.attivo);
    linguetta.classList.toggle('voce-in-onda', Object.keys(stato.parola).length > 0);
    badge.hidden = !totale;
    badge.textContent = String(totale);
    fasciaAttiva.hidden = motore.attivo;
    if (!stato.aperto) return;
    if (!contenuto.dataset.pronto) scheletroPannello(contenuto);
    const ripiegato = leggi(CHIAVE_RIPIEGATO, false) === true;
    contenuto.classList.toggle('ripiegato', ripiegato);
    document.body.classList.toggle('voce-ripiegata', ripiegato);
    if (ripiegato) {
        disegnaCompatta();
        disegnaTrasmissione();
        return;
    }

    const spia = document.getElementById('voce-spia');
    spia.classList.toggle('spenta', !stato.collegato);
    spia.title = stato.collegato ? 'Collegata' : 'Non collegata: usa la radio';
    const avvisi = [];
    if (!stato.collegato) avvisi.push(el('div', { class: 'voce-scollegata' }, icona('triangle-exclamation'), ' Voce non collegata: si riprova da sola. Intanto usa la radio.'));
    if (motore.configCodifica === false) avvisi.push(el('div', { class: 'voce-nota', testo: 'Questo browser può solo ascoltare. Per parlare serve Chrome, Edge o Firefox recente.' }));
    document.getElementById('voce-avvisi-pannello').replaceChildren(...avvisi);
    document.getElementById('voce-canali').replaceChildren(...ordineCanali().map(rigaCanale));

    const avviso = stato.canali.get('avvisi');
    document.getElementById('voce-tutti').replaceChildren(...(diSala() && avviso?.parla ? [tastoParla('avvisi', 'Avviso a tutti', 'voce-avviso', { priorita: 'alta' })] : []));

    if (stato.versioneDisegnata !== stato.versione) {
        stato.versioneDisegnata = stato.versione;
        const box = document.getElementById('voce-cronologia');
        const storia = box.querySelector('.voce-storia');
        const scorrimento = storia?.scrollTop;
        box.replaceChildren(...cronologia());
        if (scorrimento != null) box.querySelector('.voce-storia').scrollTop = scorrimento;
    }
    disegnaTrasmissione();
}

function disegnaTrasmissione() {
    const box = document.getElementById('voce-trasmissione');
    const tx = stato.tx;
    if (!box) return;
    box.hidden = !tx;
    if (!tx) return;
    const trascorso = Date.now() - tx.dal;
    const resto = Math.ceil((DURATA_MASSIMA_MS - trascorso) / 1000);
    box.className = trascorso >= INIZIO_CONTO_MS ? 'ultimi-secondi' : '';
    box.replaceChildren(
        icona(tx.concesso ? 'microphone' : 'hourglass-half'),
        ` ${tx.concesso ? 'Parli' : 'Chiedo la parola'} su ${nomeCanale(tx.canale)}${tx.priorita === 'alta' ? ' (priorità alta)' : ''}`,
        el('span', { class: 'voce-secondi', testo: tx.concesso ? `${Math.floor(trascorso / 1000)} s${resto <= 10 ? ` · ancora ${resto}` : ''}` : '' }),
        el('span', { class: 'voce-livello', style: `--livello: ${Math.min(1, (tx.livello || 0) * 6)}` }));
}

function cronologia() {
    // Per ora in cui è stato detto: un messaggio registrato senza rete arriva dopo altri più recenti.
    const detto = (m) => new Date(m.registrato_il).getTime() || Infinity;
    const tutti = [...stato.messaggi.values()].sort((a, b) => detto(b) - detto(a) || b.id - a.id);
    const persone = [...new Set(tutti.map(m => m.autore?.nome).filter(Boolean))].sort();
    const filtroCanale = el('select', { 'aria-label': 'Filtra per canale', onchange: (e) => { stato.filtroCanale = e.target.value; stato.versione++; disegna(); } },
        el('option', { value: '', testo: 'Tutti i canali' }),
        [...stato.canali.values()].map(c => el('option', { value: c.id, testo: c.nome, selected: stato.filtroCanale === c.id })));
    const filtroPersona = el('select', { 'aria-label': 'Filtra per persona', onchange: (e) => { stato.filtroPersona = e.target.value; stato.versione++; disegna(); } },
        el('option', { value: '', testo: 'Tutte le persone' }),
        persone.map(p => el('option', { value: p, testo: p, selected: stato.filtroPersona === p })));
    const cercato = stato.filtroTesto.trim().toLowerCase();
    const scelti = tutti.filter(m => (!stato.filtroCanale || m.canale === stato.filtroCanale) && (!stato.filtroPersona || m.autore?.nome === stato.filtroPersona)
        && (!cercato || [m.trascrizione, m.autore?.nome, m.nome_radio].some(t => t?.toLowerCase().includes(cercato))));
    const ricerca = el('input', { type: 'search', class: 'voce-cerca', placeholder: 'Cerca nel testo o per nome', 'aria-label': 'Cerca nei messaggi', value: stato.filtroTesto });
    // Si ridisegna solo l'elenco: ricostruendo il campo si perderebbe il cursore a metà parola.
    ricerca.addEventListener('input', () => {
        stato.filtroTesto = ricerca.value;
        const nuovo = cronologia()[2];
        ricerca.closest('.voce-cronologia')?.querySelector('.voce-storia')?.replaceWith(nuovo);
    });
    return [
        el('div', { class: 'voce-filtri' }, filtroCanale, filtroPersona),
        el('div', { class: 'voce-filtri' }, ricerca),
        el('ul', { class: 'voce-storia' }, scelti.length ? scelti.slice(0, 200).map(rigaStoria) : el('li', { class: 'evento-vuoto', testo: 'Nessun messaggio.' }))
    ];
}

function rigaStoria(m) {
    const segni = [];
    if (m.priorita === 'emergenza') segni.push(el('span', { class: 'voce-segno emergenza', testo: 'EMERGENZA' }));
    else if (m.priorita === 'alta') segni.push(el('span', { class: 'voce-segno alta', testo: 'alta' }));
    if (m.differito) segni.push(el('span', { class: 'voce-segno', title: 'Registrato senza rete e arrivato dopo', testo: `registrato alle ${ora(m.registrato_il)}` }));
    if (m.stato === 'interrotto') segni.push(el('span', { class: 'voce-segno', testo: 'interrotto' }));
    if (m.stato === 'in_arrivo') segni.push(el('span', { class: 'voce-segno', testo: 'in arrivo' }));
    if (m.ricevuto_da) segni.push(el('span', { class: 'voce-segno ok', title: 'Ricevuto, confermato dalla sala', testo: `ricevuto da ${m.ricevuto_da}` }));
    else if (m.riprodotto_in_sala) segni.push(el('span', { class: 'voce-segno ok', title: 'Riprodotto in almeno una postazione', testo: 'riprodotto in sala' }));
    else if (!m.da_sala) segni.push(el('span', { class: 'voce-segno da-sentire', testo: 'non ascoltato' }));
    const azioni = [el('button', { type: 'button', class: 'voce-icona', title: 'Ascolta', 'aria-label': 'Ascolta', onclick: () => riascolta(m), disabled: m.stato === 'in_arrivo' }, icona('play'))];
    if (diSala() && !m.da_sala && !m.ricevuto_da) azioni.push(el('button', { type: 'button', class: 'voce-ricevuto', title: `Conferma a chi ha parlato che la sala ha ricevuto (tasto ${tasti.ricevuto})`, onclick: () => confermaRicevuto(m.id) }, icona('check'), ' Ricevuto'));
    if (diSala() && m.tipo === 'squadra' && m.stato !== 'in_arrivo') azioni.push(el('button', { type: 'button', class: 'voce-icona', title: 'Sposta su un\'altra segnalazione', 'aria-label': 'Sposta su un\'altra segnalazione', onclick: (e) => spostaMessaggio(m, e.currentTarget) }, icona('right-left')));
    if (m.report_id) azioni.push(el('button', { type: 'button', class: 'voce-icona', title: 'Apri la segnalazione', 'aria-label': 'Apri la segnalazione', onclick: () => window.orionCentro?.apriSegnalazione(m.report_id) }, icona('file-lines')));
    return el('li', { class: `voce-messaggio${motore.attuale?.id === m.id ? ' in-ascolto' : ''}`, style: `--colore-canale: ${colore(nomeCanale(m.canale))}` },
        el('div', { class: 'evento-meta' },
            el('span', { class: 'evento-ora', testo: ora(m.registrato_il) }),
            el('span', { class: 'voce-canale-chip', testo: m.tipo === 'squadra' ? (m.nome_radio || nomeCanale(m.canale)) : nomeCanale(m.canale) }),
            el('span', { testo: secondi(m.durata_ms) })),
        el('div', { class: 'voce-autore' }, el('strong', { testo: m.autore?.nome || 'Sconosciuto' }), m.autore?.squadra && !m.da_sala ? ` · ${m.autore.squadra}` : (m.da_sala ? ' · sala' : '')),
        m.trascrizione ? el('div', { class: 'voce-trascrizione', title: 'Trascrizione automatica: può contenere errori', testo: m.trascrizione }) : null,
        el('div', { class: 'voce-segni' }, segni),
        el('div', { class: 'voce-azioni' }, azioni));
}

async function spostaMessaggio(m, ancora) {
    document.querySelector('.voce-sposta')?.remove();
    const box = el('div', { class: 'voce-sposta' }, el('span', { class: 'nota-menu-squadra', testo: 'Carico le segnalazioni aperte...' }));
    ancora.closest('li').append(box);
    try {
        const dati = await fetchApi(`/api/reports?status_type=active&limit=200&emergency_id=${stato.emergenza.id}`);
        const elenco = (dati.reports || []).filter(r => r.id !== m.report_id);
        box.replaceChildren(el('span', { class: 'nota-menu-squadra', testo: elenco.length ? 'Sposta su:' : 'Nessun\'altra segnalazione aperta.' }),
            ...elenco.map(r => el('button', { type: 'button', class: 'voce-menu-squadra', onclick: async () => {
                try {
                    await fetchApi(`/api/voce/messaggi/${m.id}/segnalazione`, { method: 'POST', body: JSON.stringify({ report_id: r.id }) });
                    m.report_id = r.id;
                    stato.versione++;
                    feedback(`Messaggio spostato su #${r.emergency_report_number ?? r.id}: resta scritto in tutte e due le segnalazioni.`, 'success');
                } catch (e) {
                    feedback(e.message, 'error');
                }
                box.remove();
            } }, `#${r.emergency_report_number ?? r.id} ${r.title || ''}`)),
            el('button', { type: 'button', class: 'voce-menu-squadra', onclick: () => box.remove() }, 'Annulla'));
    } catch (e) {
        box.replaceChildren(el('span', { class: 'nota-menu-squadra', testo: e.message }));
    }
}

async function caricaCronologia() {
    try {
        const { messaggi } = await fetchApi('/api/voce/messaggi?limite=200');
        for (const m of messaggi) ricordaMessaggio(m);
    } catch (e) {
        console.warn('[Voce] Cronologia non caricata:', e.message);
    }
    disegna();
}

async function caricaEmergenze() {
    try {
        const { emergenze } = await fetchApi('/api/voce/emergenze');
        for (const m of emergenze) apriEmergenza(ricordaMessaggio(m), m);
    } catch (e) {
        console.warn('[Voce] Emergenze non caricate:', e.message);
    }
}

async function apriEmergenza(meta, dettagli = null) {
    if (!diSala() || meta.presa_da || stato.emergenze.has(meta.id)) return;
    stato.emergenze.set(meta.id, { meta, dettagli, ascoltata: false });
    aggiornaAllarme();
    disegna();
    if (!dettagli) {
        try {
            const { emergenze } = await fetchApi('/api/voce/emergenze');
            const trovata = emergenze.find(e => e.id === meta.id);
            if (trovata && stato.emergenze.has(meta.id)) stato.emergenze.get(meta.id).dettagli = trovata;
            disegna();
        } catch { /* restano i dati del messaggio */ }
    }
}

function aggiornaAllarme() {
    const aperte = [...stato.emergenze.values()];
    if (!aperte.length) return motore.allarme(false);
    // Mentre suona la voce di un'emergenza l'allarme tace: altrimenti non si capisce cosa dice.
    if (motore.attuale?.meta?.priorita === 'emergenza') return motore.allarme(false);
    motore.allarme(true, aperte.some(e => !e.ascoltata) ? 1200 : RICHIAMO_EMERGENZA_MS);
}

function silenziaEmergenza(id) {
    const e = stato.emergenze.get(id);
    if (e) e.ascoltata = true;
    aggiornaAllarme();
}

function chiudiEmergenza(id, da) {
    if (!stato.emergenze.delete(id)) return;
    aggiornaAllarme();
    if (da) feedback(`Emergenza presa in carico da ${da}.`, 'success', 5000);
    disegna();
}

function disegnaEmergenze() {
    if (!fasciaEmergenze) return;
    fasciaEmergenze.replaceChildren(...[...stato.emergenze.values()].map(({ meta, dettagli }) => {
        const posizione = dettagli?.posizione || meta.posizione;
        return el('div', { class: 'voce-emergenza', role: 'alert' },
            icona('triangle-exclamation'),
            el('div', { class: 'voce-emergenza-testo' },
                el('strong', { testo: `EMERGENZA · ${meta.autore?.nome || 'Sconosciuto'}${meta.autore?.squadra ? ` (${meta.autore.squadra})` : ''}` }),
                el('span', { testo: ` alle ${ora(meta.registrato_il)}${meta.durata_ms ? ` · ${secondi(meta.durata_ms)}` : ' · sta parlando'}` }),
                dettagli?.telefono ? el('a', { href: `tel:${dettagli.telefono.replace(/[^0-9+]/g, '')}`, testo: ` · ${dettagli.telefono}` }) : null),
            el('button', { type: 'button', class: 'button-style', onclick: () => { silenziaEmergenza(meta.id); riascolta(meta); }, disabled: !meta.durata_ms }, icona('play'), ' Ascolta'),
            stato.emergenze.get(meta.id)?.ascoltata ? null : el('button', { type: 'button', class: 'button-style', title: 'Ferma l\'allarme di questa postazione: resta un richiamo ogni 30 secondi finché qualcuno la prende in carico', onclick: () => { silenziaEmergenza(meta.id); disegna(); } }, icona('bell-slash'), ' Silenzia'),
            posizione ? el('button', { type: 'button', class: 'button-style', title: posizione.della_squadra ? 'L\'ultima posizione della squadra' : 'La posizione mandata con il messaggio',
                onclick: () => window.orionCentro?.mostraPunto(posizione.lat, posizione.lon, `${meta.autore?.nome || ''}: emergenza`) }, icona('location-dot'), ' Sulla mappa') : null,
            el('button', { type: 'button', class: 'button-style voce-prendo', onclick: async (e) => {
                e.currentTarget.disabled = true;
                try {
                    await fetchApi(`/api/voce/messaggi/${meta.id}/presa-in-carico`, { method: 'POST' });
                } catch (err) {
                    feedback(err.message, 'error', 6000);
                }
                chiudiEmergenza(meta.id);
            } }, icona('hand'), ' Prendo in carico'));
    }));
}

function chiudiDiretto(canale) {
    const id = canale.split(':')[1];
    fetchApi(`/api/voce/diretti/${id}`, { method: 'DELETE' }).catch(e => feedback(e.message, 'error'));
}

async function apriDiretto(membro) {
    try {
        const { canale } = await fetchApi('/api/voce/diretti', { method: 'POST', body: JSON.stringify({ username: membro.username }) });
        stato.selezionato = canale;
        apriPannello(true);
        feedback(`Canale diretto con ${membro.nome || membro.username} aperto: lo trovi nel pannello Orion Voice.`, 'success');
    } catch (e) {
        feedback(e.message, 'error', 6000);
    }
}

function disegnaBarraSquadre() {
    document.querySelectorAll('#team-status-content .team-status-item[data-team-id]').forEach(decoraSquadra);
}

function decoraSquadra(span) {
    const canale = `squadra:${span.dataset.teamId}`;
    if (!stato.canali.has(canale)) return;
    const parla = stato.parola[canale];
    const daSentire = nonAscoltati(canale);
    let segno = span.querySelector('.voce-barra');
    if (!segno) {
        segno = el('span', { class: 'voce-barra' });
        span.append(segno);
    }
    span.classList.toggle('voce-parla-ora', !!parla);
    segno.replaceChildren(
        el('i', { class: `fas fa-volume-${parla ? 'high' : 'off'}`, 'aria-hidden': 'true' }),
        daSentire ? el('span', { class: 'voce-da-sentire', title: 'Messaggi che nessuna postazione ha ascoltato', testo: String(daSentire) }) : '',
        parla ? el('span', { class: 'voce-nome-barra', testo: parla.nome }) : '');
}

function pulsaSullaMappa(canale, acceso) {
    const id = squadraDelCanale(canale);
    if (!id) return;
    window.orionCentro?.markerSquadra(Number(id))?.getElement()?.classList.toggle('voce-parla-ora', acceso);
}

// Gli agganci che centro-operativo.js chiama dove la voce si innesta in quello che c'è già.
window.voceSala = {
    decoraBarraSquadre: () => { if (stato.disponibile) disegnaBarraSquadre(); },

    decoraMenuSquadra(menu, squadra) {
        const canale = `squadra:${squadra.id}`;
        const info = stato.canali.get(canale);
        if (!stato.disponibile || !info) return;
        const ultimi = [...stato.messaggi.values()].filter(m => m.canale === canale).sort((a, b) => b.id - a.id).slice(0, 3);
        const sezione = el('div', { class: 'voce-menu-squadra' },
            info.parla ? tastoParla(canale, `Parla ad ${squadra.nome_radio}`, 'voce-parla-grande') : null,
            ultimi.map(m => el('button', { type: 'button', class: 'voce-menu-squadra voce-ultimo', onclick: () => riascolta(m) },
                icona('play'), ` ${ora(m.registrato_il)} · ${m.autore?.nome || ''} · ${secondi(m.durata_ms)}${m.riprodotto_in_sala || m.da_sala ? '' : ' · non ascoltato'}`)));
        menu.querySelector('.titolo-menu-squadra')?.after(sezione);
    },

    decoraMembro(li, membro) {
        if (!stato.disponibile || !diSala() || !membro.username) return;
        li.append(el('button', { type: 'button', class: 'voce-diretto-membro', title: `Apri un canale voce solo fra la sala e ${membro.nome || membro.username}`,
            onclick: () => apriDiretto(membro) }, icona('headset'), ' Diretto'));
    },

    decoraNotaVocale(li, nota) {
        if (!nota.voce_id) return;
        const meta = stato.messaggi.get(nota.voce_id) || { id: nota.voce_id, registrato_il: nota.update_timestamp, autore: { nome: nota.updater_fullname } };
        const orario = ora(nota.update_timestamp);
        li.classList.add('nota-vocale');
        const testo = nota.voce_trascrizione || meta.trascrizione;
        li.append(el('div', { class: 'voce-nota-testo', dataset: { voce: String(nota.voce_id) }, hidden: !testo, title: 'Trascrizione automatica: può contenere errori', testo: testo || '' }));
        li.append(el('span', { class: 'voce-nota-azioni' },
            el('button', { type: 'button', class: 'voce-icona', title: 'Ascolta il messaggio', 'aria-label': 'Ascolta il messaggio', onclick: () => riascolta(meta) }, icona('play')),
            el('button', { type: 'button', class: 'voce-icona', title: 'Scrivi come nota: ora e autore sono già messi, tu scrivi il contenuto',
                onclick: () => window.orionCentro?.scriviNota(`[${orario}, ${nota.updater_fullname || ''} a voce] `) }, icona('pen'))));
    },

    attiva: () => attivaVoce()
};

document.addEventListener('ws:emergency_status_change', () => setTimeout(verifica, 800));
document.addEventListener('ws:reload_squadre', () => { if (!stato.disponibile) setTimeout(verifica, 800); });
setInterval(() => { if (stato.disponibile && (motore.coda.length || stato.tx)) disegna(); }, 1000);

async function prepara() {
    try {
        const impostazioni = await fetch('/api/branding/settings').then(r => r.json());
        if (impostazioni?.voce_tasto) tasti.parla = impostazioni.voce_tasto;
    } catch { /* resta F9 */ }
    verifica();
}
prepara();
