// Il server non deve diventare il modo per raggiungere la rete interna, nemmeno per un
// amministratore: solo https e indirizzi pubblici, a ogni reindirizzamento.

import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { Readable } from 'stream';

const REINDIRIZZAMENTI_MASSIMI = 5;
const ATTESA_MS = 30000;

function privatoIPv4(ip) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
        || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19))
        || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

const ipv4DaNumero = (n) => [24n, 16n, 8n, 0n].map(s => Number((n >> s) & 255n)).join('.');

// Come numero: il parser degli URL riscrive [::ffff:127.0.0.1] in ::ffff:7f00:1, e un
// confronto sul testo non lo riconoscerebbe più.
function ipv6InNumero(ip) {
    let testo = ip.toLowerCase().split('%')[0];
    const ultimo = testo.lastIndexOf(':');
    const coda = testo.slice(ultimo + 1);
    if (net.isIPv4(coda)) {
        const [a, b, c, d] = coda.split('.').map(Number);
        testo = `${testo.slice(0, ultimo + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }
    const [testa, resto] = testo.split('::');
    const gruppi = (s) => (s ? s.split(':') : []);
    const prima = gruppi(testa);
    const dopo = resto === undefined ? [] : gruppi(resto);
    const tutti = resto === undefined ? prima : [...prima, ...Array(8 - prima.length - dopo.length).fill('0'), ...dopo];
    return tutti.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16) || 0), 0n);
}

const dentro = (n, prefisso, bit) => (n >> BigInt(128 - bit)) === (ipv6InNumero(prefisso) >> BigInt(128 - bit));

function privatoIPv6(ip) {
    const n = ipv6InNumero(ip);
    const basso32 = n & 0xffffffffn;
    // Le forme che portano dentro un IPv4 (mappata, compatibile, NAT64, 6to4) valgono come quell'IPv4.
    if (dentro(n, '::ffff:0:0', 96) || dentro(n, '::', 96) || dentro(n, '64:ff9b::', 96)) {
        return n <= 1n || privatoIPv4(ipv4DaNumero(basso32));
    }
    if (dentro(n, '2002::', 16)) return privatoIPv4(ipv4DaNumero((n >> 80n) & 0xffffffffn));
    return dentro(n, 'fc00::', 7) || dentro(n, 'fe80::', 10) || dentro(n, 'fec0::', 10) || dentro(n, 'ff00::', 8)
        || dentro(n, '64:ff9b:1::', 48) || dentro(n, '100::', 64) || dentro(n, '2001::', 32) || dentro(n, '2001:db8::', 32);
}

export function indirizzoPrivato(ip) {
    if (net.isIPv4(ip)) return privatoIPv4(ip);
    if (net.isIPv6(ip)) return privatoIPv6(ip);
    return true;
}

const reteLocaleAmmessa = () => process.env.ORION_AGGIORNAMENTI_RETE_LOCALE === 'true';

const erroreInterno = (host) => new Error(`${host} è un indirizzo della rete interna: gli aggiornamenti vengono solo da indirizzi pubblici.`);

export async function controllaIndirizzo(indirizzo) {
    let url;
    try {
        url = new URL(indirizzo);
    } catch {
        throw new Error(`"${String(indirizzo).slice(0, 100)}" non è un indirizzo valido.`);
    }
    if (reteLocaleAmmessa()) {
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Sono ammessi solo indirizzi http o https.');
        return url;
    }
    if (url.protocol !== 'https:') throw new Error(`Gli aggiornamenti si scaricano solo in https (non da ${url.protocol}//${url.host}).`);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const indirizzi = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true, verbatim: true })
        .catch(() => { throw new Error(`Il nome ${host} non si risolve.`); });
    if (!indirizzi.length || indirizzi.some(a => indirizzoPrivato(a.address))) throw erroreInterno(host);
    return url;
}

// La connessione si apre sull'indirizzo che ha appena passato il controllo: risolvere il
// nome una seconda volta lascerebbe a chi governa il DNS il tempo di cambiarlo.
export function cercaSoloPubblici(nome, opzioni, richiamata) {
    dns.lookup(nome, { all: true, verbatim: true }, (errore, indirizzi) => {
        if (errore) return richiamata(errore);
        if (!indirizzi.length || indirizzi.some(a => indirizzoPrivato(a.address))) return richiamata(erroreInterno(nome));
        if (opzioni?.all) return richiamata(null, indirizzi);
        richiamata(null, indirizzi[0].address, indirizzi[0].family);
    });
}

function richiesta(url, { method = 'GET', headers = {}, body, signal } = {}) {
    return new Promise((risolvi, rifiuta) => {
        const modulo = url.protocol === 'https:' ? https : http;
        const req = modulo.request(url, {
            method, headers, signal, timeout: ATTESA_MS,
            lookup: reteLocaleAmmessa() ? undefined : cercaSoloPubblici
        }, (res) => {
            const intestazioni = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
                for (const valore of [v].flat()) if (valore != null) intestazioni.append(k, String(valore));
            }
            const senzaCorpo = method === 'HEAD' || [204, 205, 304].includes(res.statusCode);
            if (senzaCorpo) res.resume();
            risolvi(new Response(senzaCorpo ? null : Readable.toWeb(res), {
                status: res.statusCode, statusText: res.statusMessage, headers: intestazioni
            }));
        });
        req.on('timeout', () => req.destroy(new Error('Il server esterno non risponde.')));
        req.on('error', rifiuta);
        req.end(body);
    });
}

export async function fetchEsterno(indirizzo, opzioni = {}) {
    let attuale = indirizzo;
    for (let i = 0; i <= REINDIRIZZAMENTI_MASSIMI; i++) {
        const url = await controllaIndirizzo(attuale);
        const risposta = await richiesta(url, opzioni);
        if (risposta.status >= 300 && risposta.status < 400 && risposta.headers.get('location')) {
            await risposta.body?.cancel();
            attuale = new URL(risposta.headers.get('location'), attuale).toString();
            continue;
        }
        return risposta;
    }
    throw new Error('Troppi reindirizzamenti.');
}
