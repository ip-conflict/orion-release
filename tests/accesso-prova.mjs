// tests/accesso-prova.mjs
//
// L'accesso dei test, anche con la verifica in due passaggi. Un
// amministratore la deve avere: la prima volta il test la attiva da sé e
// tiene il segreto in un file nella cartella temporanea della macchina
// (orion-test-mfa/), oppure lo prende da ORION_ADMIN_TOTP. Lo stesso codice
// non vale due volte: se l'ultimo passo di 30 secondi è già stato usato si
// aspetta il prossimo.

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const aspetta = (ms) => new Promise(r => setTimeout(r, ms));
export const passoAttuale = () => Math.floor(Date.now() / 30000);

export function codiceTotp(segreto, passo = passoAttuale()) {
    let bit = '';
    for (const c of String(segreto).toUpperCase().replace(/[^A-Z2-7]/g, '')) bit += BASE32.indexOf(c).toString(2).padStart(5, '0');
    const chiave = Buffer.from(bit.match(/.{8}/g).map(b => parseInt(b, 2)));
    const contatore = Buffer.alloc(8);
    contatore.writeBigUInt64BE(BigInt(passo));
    const h = crypto.createHmac('sha1', chiave).update(contatore).digest();
    const o = h[h.length - 1] & 0x0f;
    return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
}

function fileSegreto(base, username) {
    const cartella = path.join(os.tmpdir(), 'orion-test-mfa');
    fs.mkdirSync(cartella, { recursive: true, mode: 0o700 });
    const nome = crypto.createHash('sha256').update(`${base}|${username}`).digest('hex').slice(0, 16);
    return path.join(cartella, `${nome}.json`);
}
const leggi = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const scrivi = (file, dati) => fs.writeFileSync(file, JSON.stringify(dati), { mode: 0o600 });

// Un codice nuovo per questa persona, aspettando se l'ultimo è già stato usato.
export async function codiceNuovo(base, username, segreto) {
    const file = fileSegreto(base, username);
    const ultimo = leggi(file)?.ultimo || 0;
    if (passoAttuale() <= ultimo) await aspetta((ultimo + 1) * 30000 - Date.now() + 300);
    const passo = passoAttuale();
    scrivi(file, { segreto, ultimo: passo });
    return codiceTotp(segreto, passo);
}

export function segretoSalvato(base, username) {
    return leggi(fileSegreto(base, username))?.segreto || null;
}
export function dimenticaSegreto(base, username) {
    fs.rmSync(fileSegreto(base, username), { force: true });
}

// chiama(percorso, { method, body }) -> { stato, corpo }, con il body da
// mandare come JSON. Restituisce la risposta finale dell'accesso.
export async function accediConVerifica(chiama, base, username, password) {
    const r = await chiama('/login', { method: 'POST', body: { username, password } });
    if (r.stato !== 401 || !r.corpo?.mfa) return r;
    let segreto = r.corpo.mfa === 'attivazione' ? r.corpo.segreto : (process.env.ORION_ADMIN_TOTP || segretoSalvato(base, username));
    if (!segreto) {
        throw new Error(`${username} ha la verifica in due passaggi ma il test non ne conosce il segreto: impostalo in ORION_ADMIN_TOTP, oppure azzerala con node scripts/mfa-azzera.mjs ${username}.`);
    }
    for (let i = 0; i < 3; i++) {
        const m = await chiama('/api/accesso/mfa', { method: 'POST', body: { sfida: r.corpo.sfida, codice: await codiceNuovo(base, username, segreto) } });
        if (m.stato === 200 || !/già stato usato/.test(m.corpo?.message || '')) return m;
    }
    throw new Error('Codice rifiutato tre volte.');
}

// Con fetch, per i test che usano solo il token.
export async function accediConFetch(base, username, password) {
    const chiama = async (percorso, { method, body }) => {
        const r = await fetch(base + percorso, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { stato: r.status, corpo: await r.json().catch(() => null) };
    };
    const r = await accediConVerifica(chiama, base, username, password);
    if (r.stato !== 200) throw new Error(`Accesso di ${username} non riuscito: HTTP ${r.stato} ${r.corpo?.message || ''}`);
    await prendiVisione(base, r.corpo.token);
    return r.corpo;
}

// Come farebbe la persona alla prima entrata: legge l'informativa in vigore e
// ne prende visione. Senza, ogni richiesta risponde 428.
export async function prendiVisione(base, token) {
    const intestazioni = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const dati = await (await fetch(`${base}/api/informativa`, { headers: intestazioni })).json().catch(() => null);
    if (!dati?.versione || dati.presa_visione) return;
    const r = await fetch(`${base}/api/informativa/presa-visione`, { method: 'POST', headers: intestazioni, body: JSON.stringify({ versione: dati.versione }) });
    if (!r.ok) throw new Error(`Presa visione non registrata: HTTP ${r.status}`);
}
