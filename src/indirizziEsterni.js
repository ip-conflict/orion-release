// Il server non deve diventare il modo per raggiungere la rete interna, nemmeno per un
// amministratore: solo https e indirizzi pubblici, a ogni reindirizzamento.

import dns from 'dns';
import net from 'net';

const REINDIRIZZAMENTI_MASSIMI = 5;

function privatoIPv4(ip) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function indirizzoPrivato(ip) {
    if (net.isIPv4(ip)) return privatoIPv4(ip);
    const v = ip.toLowerCase();
    const mappato = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappato) return privatoIPv4(mappato[1]);
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
        || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

const reteLocaleAmmessa = () => process.env.ORION_AGGIORNAMENTI_RETE_LOCALE === 'true';

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
    if (!indirizzi.length || indirizzi.some(a => indirizzoPrivato(a.address))) {
        throw new Error(`${host} è un indirizzo della rete interna: gli aggiornamenti vengono solo da indirizzi pubblici.`);
    }
    return url;
}

export async function fetchEsterno(indirizzo, opzioni = {}) {
    let attuale = indirizzo;
    for (let i = 0; i <= REINDIRIZZAMENTI_MASSIMI; i++) {
        await controllaIndirizzo(attuale);
        const risposta = await fetch(attuale, { ...opzioni, redirect: 'manual' });
        if (risposta.status >= 300 && risposta.status < 400 && risposta.headers.get('location')) {
            attuale = new URL(risposta.headers.get('location'), attuale).toString();
            continue;
        }
        return risposta;
    }
    throw new Error('Troppi reindirizzamenti.');
}
