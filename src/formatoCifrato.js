// Il formato dei dati cifrati di ORION, senza database e senza stato: lo usa
// il server (cifratura.js) e lo usano gli script lanciati a mano o dal backup
// notturno (scripts/cifra-backup.mjs, scripts/decifra-backup.mjs).
//
// AES-256-GCM: "ORIONCF1" (8 byte), IV casuale (12), dati cifrati, tag (16).
// Il tag garantisce anche che il file non sia stato alterato.

import crypto from 'crypto';
import fs from 'fs';
import { Transform } from 'stream';

export const MAGIA = Buffer.from('ORIONCF1');
export const LUNGHEZZA_IV = 12;
export const LUNGHEZZA_TAG = 16;
export const TESTA = MAGIA.length + LUNGHEZZA_IV;

export function eCifrato(buf) {
    return Buffer.isBuffer(buf) && buf.length >= TESTA + LUNGHEZZA_TAG && buf.subarray(0, MAGIA.length).equals(MAGIA);
}

export function cifraCon(chiave, buf) {
    const iv = crypto.randomBytes(LUNGHEZZA_IV);
    const c = crypto.createCipheriv('aes-256-gcm', chiave, iv);
    return Buffer.concat([MAGIA, iv, c.update(buf), c.final(), c.getAuthTag()]);
}

export function decifraCon(chiave, buf) {
    const d = crypto.createDecipheriv('aes-256-gcm', chiave, buf.subarray(MAGIA.length, TESTA));
    d.setAuthTag(buf.subarray(buf.length - LUNGHEZZA_TAG));
    return Buffer.concat([d.update(buf.subarray(TESTA, buf.length - LUNGHEZZA_TAG)), d.final()]);
}

export function flussoCifratoCon(chiave) {
    const iv = crypto.randomBytes(LUNGHEZZA_IV);
    const c = crypto.createCipheriv('aes-256-gcm', chiave, iv);
    let testaScritta = false;
    return new Transform({
        transform(pezzo, _codifica, fatto) {
            if (!testaScritta) { this.push(Buffer.concat([MAGIA, iv])); testaScritta = true; }
            fatto(null, c.update(pezzo));
        },
        flush(fatto) {
            if (!testaScritta) this.push(Buffer.concat([MAGIA, iv]));
            this.push(c.final());
            fatto(null, c.getAuthTag());
        }
    });
}

// Un file come flusso in chiaro: decifrato se è cifrato, così com'è se no.
// Il tag si legge prima dalla coda: se il file è stato alterato il flusso
// finisce con un errore (e un ripristino in una sola transazione non applica
// niente).
export async function apriFileCon(chiave, percorso) {
    const fd = await fs.promises.open(percorso, 'r');
    try {
        const { size } = await fd.stat();
        const testa = Buffer.alloc(TESTA);
        await fd.read(testa, 0, TESTA, 0);
        if (size < TESTA + LUNGHEZZA_TAG || !testa.subarray(0, MAGIA.length).equals(MAGIA)) return fs.createReadStream(percorso);
        const tag = Buffer.alloc(LUNGHEZZA_TAG);
        await fd.read(tag, 0, LUNGHEZZA_TAG, size - LUNGHEZZA_TAG);
        const d = crypto.createDecipheriv('aes-256-gcm', chiave, testa.subarray(MAGIA.length));
        d.setAuthTag(tag);
        const lettura = fs.createReadStream(percorso, { start: TESTA, end: size - LUNGHEZZA_TAG - 1 });
        lettura.on('error', e => d.destroy(e));
        return lettura.pipe(d);
    } finally {
        await fd.close();
    }
}

// La chiave di recupero: la chiave in base32 senza lettere ambigue (52
// caratteri), a gruppi di quattro, da stampare e ricopiare a mano.
export const ALFABETO_RECUPERO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function scriviChiaveDiRecupero(chiave) {
    let bit = '';
    for (const b of chiave) bit += b.toString(2).padStart(8, '0');
    let testo = '';
    for (let i = 0; i < bit.length; i += 5) testo += ALFABETO_RECUPERO[parseInt(bit.slice(i, i + 5).padEnd(5, '0'), 2)];
    return testo.match(/.{1,4}/g).join('-');
}

export function leggiChiaveDiRecupero(testo) {
    const pulito = String(testo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (pulito.length !== 52 || [...pulito].some(c => !ALFABETO_RECUPERO.includes(c))) return null;
    let bit = '';
    for (const c of pulito) bit += ALFABETO_RECUPERO.indexOf(c).toString(2).padStart(5, '0');
    const byte = [];
    for (let i = 0; i + 8 <= 256; i += 8) byte.push(parseInt(bit.slice(i, i + 8), 2));
    return Buffer.from(byte);
}

export function leggiFileChiaveDa(percorso) {
    try {
        const k = Buffer.from(fs.readFileSync(percorso, 'utf8').trim(), 'base64');
        return k.length === 32 ? k : null;
    } catch {
        return null;
    }
}
