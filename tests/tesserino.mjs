// tests/tesserino.mjs
//
// Il modello del tesserino scelto dall'amministratore (badge_modello): il
// server lo salva solo ripulito, rifiuta colori, testi e misure assurdi, e
// vuoto vuol dire il tesserino predefinito. Le pagine lo leggono fra le
// impostazioni pubbliche. Alla fine rimette il modello com'era.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/tesserino.mjs

import 'dotenv/config';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};

console.log('\nModello del tesserino');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const prima = (await chiama('/api/branding/settings/full', { token: admin })).corpo?.badge_modello || '';
const salva = (valore) => chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { badge_modello: valore } });
const letto = async () => (await chiama('/api/branding/settings')).corpo?.badge_modello;

try {
    const buono = {
        colori: { fascia_alta: '#8B1A1A', qualifica: '#ffffff' },
        testi: { qualifica: '  OPERATORE ' },
        posizioni: { qr: { x: 10.123, y: 40, w: 44, h: 44 } },
        nascosti: ['bandiera_ue', 'foto', 'inventato'],
        estraneo: 'via'
    };
    const r = await salva(JSON.stringify(buono));
    verifica('un modello sensato si salva', r.stato === 200, r);
    const m = JSON.parse(await letto() || '{}');
    verifica('e si legge fra le impostazioni pubbliche, ripulito',
        m.colori?.fascia_alta === '#8b1a1a' && m.testi?.qualifica === 'OPERATORE' && m.posizioni?.qr?.x === 10.12
        && JSON.stringify(m.nascosti) === '["bandiera_ue"]' && !('estraneo' in m), m);

    for (const [descr, valore] of [
        ['un colore che non è esadecimale', { colori: { nome: 'red' } }],
        ['un testo troppo lungo', { testi: { qualifica: 'X'.repeat(41) } }],
        ['una misura assurda', { posizioni: { foto: { x: 0, y: 0, w: 1e6, h: 10 } } }],
        ['una misura che non è un numero', { posizioni: { foto: { x: 'a', y: 0, w: 10, h: 10 } } }]
    ]) {
        const no = await salva(JSON.stringify(valore));
        verifica(`rifiutato: ${descr}`, no.stato === 400, no);
    }
    const rotto = await salva('{non è json');
    verifica('rifiutato: un testo che non è JSON', rotto.stato === 400, rotto);
    verifica('dopo un rifiuto resta il modello di prima', (await letto()) === JSON.stringify(m));

    const vuoto = await salva('');
    verifica('vuoto torna al tesserino predefinito', vuoto.stato === 200 && (await letto()) === '', await letto());
} finally {
    await salva(prima);
}

console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
