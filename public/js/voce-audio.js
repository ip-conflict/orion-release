// L'audio della voce in sala: microfono e codifica Opus, riproduzione dei messaggi uno alla
// volta, i toni. Il server non tocca l'audio: qui si codifica e si decodifica.

const FREQUENZA_CATTURA = 16000;
const BUFFER_INIZIALE_S = 0.35;
const ANTICIPO_S = 0.5;
const PESO = { normale: 0, alta: 1, emergenza: 2 };

const DURATE_SILK = [10, 20, 40, 60];
const DURATE_IBRIDO = [10, 20];
const DURATE_CELT = [2.5, 5, 10, 20];
function durataPacchettoUs(p) {
    if (!p?.length) return 0;
    const config = p[0] >> 3;
    const ms = config < 12 ? DURATE_SILK[config % 4] : config < 16 ? DURATE_IBRIDO[config % 2] : DURATE_CELT[config % 4];
    const codice = p[0] & 3;
    const trame = codice === 0 ? 1 : codice < 3 ? 2 : (p.length > 1 ? p[1] & 0x3f : 0);
    return ms * 1000 * trame;
}

const CONFIGURAZIONI_CODIFICA = [
    { codec: 'opus', sampleRate: FREQUENZA_CATTURA, numberOfChannels: 1, bitrate: 20000, opus: { frameDuration: 60000, application: 'voip', signal: 'voice' } },
    { codec: 'opus', sampleRate: FREQUENZA_CATTURA, numberOfChannels: 1, bitrate: 20000, opus: { frameDuration: 60000 } },
    { codec: 'opus', sampleRate: FREQUENZA_CATTURA, numberOfChannels: 1, bitrate: 20000 }
];

export class MotoreVoce {
    constructor() {
        this.ctx = null;
        this.uscita = null;
        this.configCodifica = null;
        this.coda = [];
        this.attuale = null;
        this.sorgenti = [];
        this.fineProgrammata = 0;
        this.sospeso = false;
        this.allarmeAttivo = null;
        this.alCambio = () => {};
        this.allaFine = () => {};
        this.allInizio = () => {};
        this.decodificaInDiretta = typeof AudioDecoder !== 'undefined';
    }

    get attivo() {
        return this.ctx?.state === 'running';
    }

    // Va chiamata da un gesto della persona: prima il browser non fa suonare niente.
    async attiva() {
        if (!this.ctx) {
            this.ctx = new AudioContext({ latencyHint: 'interactive' });
            this.uscita = this.ctx.createGain();
            this.uscita.connect(this.ctx.destination);
            this.ctx.onstatechange = () => this.alCambio();
            this.ritmo = setInterval(() => this.programma(), 50);
        }
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        if (this.configCodifica === null) this.configCodifica = await this.scegliCodifica();
        this.alCambio();
        return this.attivo;
    }

    async scegliCodifica() {
        if (typeof AudioEncoder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
        for (const config of CONFIGURAZIONI_CODIFICA) {
            try {
                if ((await AudioEncoder.isConfigSupported(config)).supported) return config;
            } catch { /* si prova la successiva */ }
        }
        return false;
    }

    get puoParlare() {
        return !!this.configCodifica;
    }

    impostaVolume(v) {
        if (this.uscita) this.uscita.gain.value = Math.max(0, Math.min(1.5, v));
    }

    async apriMicrofono({ suPacchetto, suLivello = () => {}, suErrore = () => {} }) {
        if (!this.puoParlare) throw new Error('Questo browser può solo ascoltare: per parlare serve Chrome, Edge o Firefox recente.');
        await this.attiva();
        if (!this.modulo) this.modulo = this.ctx.audioWorklet.addModule('/js/voce-cattura.js');
        await this.modulo;
        const flusso = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
        });
        const sorgente = this.ctx.createMediaStreamSource(flusso);
        const nodo = new AudioWorkletNode(this.ctx, 'cattura-voce');
        // Senza un'uscita collegata Chrome può non far girare il nodo.
        const muto = this.ctx.createGain();
        muto.gain.value = 0;
        const codificatore = new AudioEncoder({
            output: (pezzo) => {
                const dati = new Uint8Array(pezzo.byteLength);
                pezzo.copyTo(dati);
                suPacchetto(dati);
            },
            error: (e) => suErrore(e)
        });
        codificatore.configure(this.configCodifica);
        let tempo = 0;
        nodo.port.onmessage = ({ data: pcm }) => {
            let somma = 0;
            for (let i = 0; i < pcm.length; i++) somma += pcm[i] * pcm[i];
            suLivello(Math.sqrt(somma / pcm.length));
            if (codificatore.state !== 'configured') return;
            const blocco = new AudioData({ format: 'f32-planar', sampleRate: FREQUENZA_CATTURA, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: tempo, data: pcm });
            tempo += Math.round(pcm.length * 1e6 / FREQUENZA_CATTURA);
            codificatore.encode(blocco);
            blocco.close();
        };
        sorgente.connect(nodo).connect(muto).connect(this.ctx.destination);
        let chiuso = false;
        return {
            chiudi: async () => {
                if (chiuso) return;
                chiuso = true;
                flusso.getTracks().forEach(t => t.stop());
                nodo.port.onmessage = null;
                sorgente.disconnect();
                nodo.disconnect();
                try {
                    if (codificatore.state === 'configured') await codificatore.flush();
                } finally {
                    if (codificatore.state !== 'closed') codificatore.close();
                }
            }
        };
    }

    tono(nome) {
        if (!this.attivo) return;
        const note = {
            parla: [[1000, 0, 0.08]],
            occupato: [[300, 0, 0.35]],
            consegnato: [[1200, 0, 0.06], [1200, 0.1, 0.06]],
            interrotto: [[700, 0, 0.12], [500, 0.14, 0.18]],
            conto: [[800, 0, 0.05]],
            apertura: [[600, 0, 0.05]],
            errore: [[400, 0, 0.12], [300, 0.15, 0.2]]
        }[nome] || [];
        const t0 = this.ctx.currentTime + 0.01;
        for (const [frequenza, ritardo, durata] of note) this.nota(frequenza, t0 + ritardo, durata, 0.2, this.uscita);
    }

    nota(frequenza, inizio, durata, volume, uscita) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.frequency.value = frequenza;
        g.gain.setValueAtTime(0.0001, inizio);
        g.gain.exponentialRampToValueAtTime(volume, inizio + 0.01);
        g.gain.setValueAtTime(volume, inizio + Math.max(0.01, durata - 0.02));
        g.gain.exponentialRampToValueAtTime(0.0001, inizio + durata);
        o.connect(g).connect(uscita);
        o.start(inizio);
        o.stop(inizio + durata + 0.02);
    }

    // L'allarme dell'emergenza non segue il volume della voce: va sentito comunque.
    allarme(acceso, ogniMs = 1200) {
        if (!acceso || this.allarmeOgni !== ogniMs) {
            clearInterval(this.allarmeAttivo);
            this.allarmeAttivo = null;
            this.allarmeOgni = null;
        }
        if (!acceso || this.allarmeAttivo || !this.attivo) return;
        this.allarmeOgni = ogniMs;
        const suona = () => {
            const t = this.ctx.currentTime + 0.01;
            this.nota(950, t, 0.25, 0.35, this.ctx.destination);
            this.nota(650, t + 0.3, 0.25, 0.35, this.ctx.destination);
        };
        suona();
        this.allarmeAttivo = setInterval(suona, ogniMs);
    }

    // Un messaggio da ascoltare: arriva a pezzi in diretta, oppure intero da un file.
    nuovo(meta, { inDiretta = false } = {}) {
        const voce = { meta, id: meta.id, pcm: [], finito: !inDiretta, inDiretta, arrivatoIl: Date.now(), prossimo: 0, programmati: [], tempo: 0 };
        if (inDiretta && this.decodificaInDiretta) {
            voce.decodificatore = new AudioDecoder({
                output: (blocco) => {
                    const pcm = new Float32Array(blocco.numberOfFrames);
                    blocco.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
                    voce.pcm.push({ pcm, frequenza: blocco.sampleRate });
                    blocco.close();
                },
                error: () => { voce.rotto = true; }
            });
            voce.decodificatore.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
        }
        return voce;
    }

    pacchetto(voce, dati) {
        if (!voce.decodificatore || voce.decodificatore.state !== 'configured') return;
        const durata = durataPacchettoUs(dati);
        voce.decodificatore.decode(new EncodedAudioChunk({ type: 'key', timestamp: voce.tempo, duration: durata, data: dati }));
        voce.tempo += durata;
    }

    async concludi(voce) {
        if (voce.decodificatore?.state === 'configured') {
            try { await voce.decodificatore.flush(); } catch { /* resta quello che c'è */ }
            voce.decodificatore.close();
        }
        voce.finito = true;
    }

    async caricaFile(voce, url) {
        const risposta = await fetch(url, { credentials: 'same-origin' });
        if (!risposta.ok) throw new Error(`Audio non disponibile (errore ${risposta.status}).`);
        await this.attiva();
        const buffer = await this.ctx.decodeAudioData(await risposta.arrayBuffer());
        voce.pcm = [{ pcm: buffer.getChannelData(0), frequenza: buffer.sampleRate }];
        voce.prossimo = 0;
        voce.finito = true;
    }

    // Una voce alla volta, nell'ordine di arrivo; alta priorità ed emergenza passano davanti
    // e interrompono quella in corso, che riparte da dove era.
    accoda(voce) {
        if (this.attuale === voce || this.coda.includes(voce)) return;
        const peso = PESO[voce.meta.priorita] ?? 0;
        let posto = this.coda.findIndex(v => (PESO[v.meta.priorita] ?? 0) < peso);
        if (posto < 0) posto = this.coda.length;
        this.coda.splice(posto, 0, voce);
        if (this.attuale && peso > (PESO[this.attuale.meta.priorita] ?? 0)) this.ferma({ rimetti: true });
        this.alCambio();
    }

    togli(id) {
        this.coda = this.coda.filter(v => v.id !== id);
        if (this.attuale?.id === id) this.ferma({ rimetti: false });
        this.alCambio();
    }

    subito(id) {
        const voce = this.coda.find(v => v.id === id);
        if (!voce) return;
        this.coda = this.coda.filter(v => v !== voce);
        if (this.attuale) this.ferma({ rimetti: true });
        this.coda.unshift(voce);
        this.alCambio();
    }

    // Mentre la sala parla non suona niente: la voce rientrerebbe nel microfono.
    sospendi(si) {
        this.sospeso = si;
        if (si && this.attuale) this.ferma({ rimetti: true });
        this.alCambio();
    }

    ferma({ rimetti }) {
        const voce = this.attuale;
        if (!voce) return;
        const adesso = this.ctx.currentTime;
        const nonSentito = voce.programmati.find(p => p.fine > adesso);
        if (nonSentito) voce.prossimo = nonSentito.indice;
        voce.programmati = [];
        this.sorgenti.forEach(s => { try { s.stop(); } catch { /* già finita */ } });
        this.sorgenti = [];
        this.attuale = null;
        if (rimetti) this.coda.unshift(voce);
    }

    programma() {
        if (!this.attivo || this.sospeso) return;
        const adesso = this.ctx.currentTime;
        if (!this.attuale) {
            if (!this.coda.length) return;
            const voce = this.coda[0];
            const pronta = voce.pcm.length > voce.prossimo || voce.finito;
            if (!pronta) return;
            this.coda.shift();
            this.attuale = voce;
            voce.inDirettaAllInizio = voce.inDiretta && !voce.finito;
            this.tono('apertura');
            this.fineProgrammata = adesso + BUFFER_INIZIALE_S;
            this.allInizio(voce);
            this.alCambio();
        }
        const voce = this.attuale;
        while (voce.prossimo < voce.pcm.length && this.fineProgrammata - adesso < ANTICIPO_S) {
            const { pcm, frequenza } = voce.pcm[voce.prossimo];
            const buffer = this.ctx.createBuffer(1, pcm.length, frequenza);
            buffer.copyToChannel(pcm, 0);
            const s = this.ctx.createBufferSource();
            s.buffer = buffer;
            s.connect(this.uscita);
            // Un buco nella rete: si riparte con un po' di margine invece di andare a scatti.
            const inizio = Math.max(this.fineProgrammata, adesso + (this.fineProgrammata < adesso ? 0.15 : 0));
            s.start(inizio);
            this.fineProgrammata = inizio + buffer.duration;
            voce.programmati.push({ indice: voce.prossimo, fine: this.fineProgrammata });
            this.sorgenti.push(s);
            s.onended = () => { this.sorgenti = this.sorgenti.filter(x => x !== s); };
            voce.prossimo++;
        }
        if (voce.finito && voce.prossimo >= voce.pcm.length && adesso >= this.fineProgrammata) {
            this.attuale = null;
            voce.programmati = [];
            this.allaFine(voce);
            this.alCambio();
        }
    }
}
