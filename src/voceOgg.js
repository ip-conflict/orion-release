// I pacchetti Opus arrivano già codificati dal telefono o dal browser: qui si mettono solo
// nel contenitore Ogg (RFC 7845), che il browser riproduce senza conversioni. Si decodificano
// soltanto per la trascrizione.

import { OpusDecoder } from 'opus-decoder';

const TABELLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
        t[i] = r >>> 0;
    }
    return t;
})();

export function crcOgg(buf) {
    let crc = 0;
    for (let i = 0; i < buf.length; i++) crc = ((crc << 8) ^ TABELLA_CRC[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
    return crc >>> 0;
}

// Il codificatore di libopus anticipa 6,5 ms: il lettore li scarta all'inizio.
export const PRE_SKIP = 312;
const DURATE_SILK = [10, 20, 40, 60];
const DURATE_IBRIDO = [10, 20];
const DURATE_CELT = [2.5, 5, 10, 20];

export function campioniPacchetto(pacchetto) {
    if (!pacchetto || pacchetto.length < 1) return 0;
    const config = pacchetto[0] >> 3;
    const ms = config < 12 ? DURATE_SILK[config % 4] : config < 16 ? DURATE_IBRIDO[config % 2] : DURATE_CELT[config % 4];
    const codice = pacchetto[0] & 3;
    let trame = codice === 0 ? 1 : codice < 3 ? 2 : (pacchetto.length > 1 ? pacchetto[1] & 0x3f : 0);
    return Math.round(ms * 48) * trame;
}

function pagina({ tipo, granulo, seriale, numero, pacchetti }) {
    const segmenti = [];
    for (const p of pacchetti) {
        let resto = p.length;
        while (resto >= 255) { segmenti.push(255); resto -= 255; }
        segmenti.push(resto);
    }
    const testa = Buffer.alloc(27 + segmenti.length);
    testa.write('OggS', 0, 'ascii');
    testa[4] = 0;
    testa[5] = tipo;
    testa.writeBigInt64LE(BigInt(granulo), 6);
    testa.writeUInt32LE(seriale, 14);
    testa.writeUInt32LE(numero, 18);
    testa[26] = segmenti.length;
    segmenti.forEach((s, i) => { testa[27 + i] = s; });
    const intera = Buffer.concat([testa, ...pacchetti]);
    intera.writeUInt32LE(crcOgg(intera), 22);
    return intera;
}

function testaOpus(frequenzaIngresso) {
    const b = Buffer.alloc(19);
    b.write('OpusHead', 0, 'ascii');
    b[8] = 1;
    b[9] = 1;
    b.writeUInt16LE(PRE_SKIP, 10);
    b.writeUInt32LE(frequenzaIngresso, 12);
    b.writeInt16LE(0, 16);
    b[18] = 0;
    return b;
}

function etichetteOpus(etichette) {
    const fornitore = Buffer.from('ORION', 'utf8');
    const voci = Object.entries(etichette).map(([k, v]) => Buffer.from(`${k}=${v}`, 'utf8'));
    const b = Buffer.alloc(8 + 4 + fornitore.length + 4 + voci.reduce((n, v) => n + 4 + v.length, 0));
    let i = b.write('OpusTags', 0, 'ascii');
    i = b.writeUInt32LE(fornitore.length, i);
    i += fornitore.copy(b, i);
    i = b.writeUInt32LE(voci.length, i);
    for (const v of voci) {
        i = b.writeUInt32LE(v.length, i);
        i += v.copy(b, i);
    }
    return b;
}

// Più pacchetti per pagina: con una pagina ciascuno l'intestazione peserebbe un quarto dell'audio.
const SEGMENTI_PER_PAGINA = 250;
const CAMPIONI_PER_PAGINA = 48000;

export function scriviOggOpus(pacchetti, { seriale = 1, frequenzaIngresso = 16000, etichette = {} } = {}) {
    const pagine = [
        pagina({ tipo: 0x02, granulo: 0, seriale, numero: 0, pacchetti: [testaOpus(frequenzaIngresso)] }),
        pagina({ tipo: 0x00, granulo: 0, seriale, numero: 1, pacchetti: [etichetteOpus(etichette)] })
    ];
    let numero = 2;
    let granulo = PRE_SKIP;
    let inPagina = [];
    let segmentiInPagina = 0;
    let campioniInPagina = 0;
    const chiudi = (ultima) => {
        pagine.push(pagina({ tipo: ultima ? 0x04 : 0x00, granulo, seriale, numero: numero++, pacchetti: inPagina }));
        inPagina = [];
        segmentiInPagina = 0;
        campioniInPagina = 0;
    };
    pacchetti.forEach((p, i) => {
        const segmenti = Math.floor(p.length / 255) + 1;
        if (inPagina.length && segmentiInPagina + segmenti > SEGMENTI_PER_PAGINA) chiudi(false);
        inPagina.push(p);
        segmentiInPagina += segmenti;
        const campioni = campioniPacchetto(p);
        granulo += campioni;
        campioniInPagina += campioni;
        if (i < pacchetti.length - 1 && campioniInPagina >= CAMPIONI_PER_PAGINA) chiudi(false);
    });
    if (inPagina.length || pacchetti.length === 0) chiudi(true);
    return Buffer.concat(pagine);
}

export function leggiOggOpus(buf) {
    const pacchetti = [];
    let corrente = [];
    let i = 0;
    let testa = null;
    while (i + 27 <= buf.length) {
        if (buf.toString('ascii', i, i + 4) !== 'OggS') throw new Error(`Pagina Ogg non valida a ${i}.`);
        const n = buf[i + 26];
        const segmenti = buf.subarray(i + 27, i + 27 + n);
        const lunghezza = segmenti.reduce((a, s) => a + s, 0);
        const fine = i + 27 + n + lunghezza;
        const copia = Buffer.from(buf.subarray(i, fine));
        const crc = copia.readUInt32LE(22);
        copia.writeUInt32LE(0, 22);
        if (crcOgg(copia) !== crc) throw new Error(`CRC sbagliato nella pagina a ${i}.`);
        let p = i + 27 + n;
        for (const s of segmenti) {
            corrente.push(buf.subarray(p, p + s));
            p += s;
            if (s < 255) {
                const intero = Buffer.concat(corrente);
                corrente = [];
                if (!testa) testa = intero;
                else if (!intero.subarray(0, 8).equals(Buffer.from('OpusTags'))) pacchetti.push(intero);
            }
        }
        i = fine;
    }
    return { testa, pacchetti };
}

// La frequenza che whisper vuole.
const FREQUENZA_WAV = 16_000;

function wav(campioni) {
    const dati = Buffer.alloc(campioni.length * 2);
    for (let i = 0; i < campioni.length; i++) dati.writeInt16LE(Math.round(Math.max(-1, Math.min(1, campioni[i])) * 32767), i * 2);
    const testa = Buffer.alloc(44);
    testa.write('RIFF', 0);
    testa.writeUInt32LE(36 + dati.length, 4);
    testa.write('WAVEfmt ', 8);
    testa.writeUInt32LE(16, 16);
    testa.writeUInt16LE(1, 20);
    testa.writeUInt16LE(1, 22);
    testa.writeUInt32LE(FREQUENZA_WAV, 24);
    testa.writeUInt32LE(FREQUENZA_WAV * 2, 28);
    testa.writeUInt16LE(2, 32);
    testa.writeUInt16LE(16, 34);
    testa.write('data', 36);
    testa.writeUInt32LE(dati.length, 40);
    return Buffer.concat([testa, dati]);
}

export async function oggInWav(ogg) {
    const { pacchetti } = leggiOggOpus(ogg);
    const decodificatore = new OpusDecoder({ sampleRate: FREQUENZA_WAV, channels: 1 });
    await decodificatore.ready;
    try {
        return wav(decodificatore.decodeFrames(pacchetti.map(p => new Uint8Array(p))).channelData[0]);
    } finally {
        decodificatore.free();
    }
}
