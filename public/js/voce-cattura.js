// Gira nel thread audio: porta il microfono a 16 kHz e lo consegna a blocchi di 60 ms.
// Firefox non collega il microfono a un AudioContext con una frequenza diversa da quella
// della scheda audio, quindi la conversione la fa questo nodo.

const FREQUENZA = 16000;
const CAMPIONI_BLOCCO = 960;

class CatturaVoce extends AudioWorkletProcessor {
    constructor() {
        super();
        this.passo = sampleRate / FREQUENZA;
        this.posizione = 0;
        this.somma = 0;
        this.contati = 0;
        this.blocco = new Float32Array(CAMPIONI_BLOCCO);
        this.riempiti = 0;
    }

    process(ingressi) {
        const canale = ingressi[0]?.[0];
        if (!canale) return true;
        // La media dei campioni che cadono in ogni passo fa anche da filtro contro l'aliasing.
        for (let i = 0; i < canale.length; i++) {
            this.somma += canale[i];
            this.contati++;
            this.posizione += 1;
            if (this.posizione < this.passo) continue;
            this.posizione -= this.passo;
            this.blocco[this.riempiti++] = this.somma / this.contati;
            this.somma = 0;
            this.contati = 0;
            if (this.riempiti === CAMPIONI_BLOCCO) {
                this.port.postMessage(this.blocco, [this.blocco.buffer]);
                this.blocco = new Float32Array(CAMPIONI_BLOCCO);
                this.riempiti = 0;
            }
        }
        return true;
    }
}

registerProcessor('cattura-voce', CatturaVoce);
