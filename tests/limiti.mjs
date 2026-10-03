// tests/limiti.mjs
//
// I limiti di frequenza, provati da soli: un'app Express minima con i
// limitatori veri e un'autenticazione finta, niente database.
//
// USO: node tests/limiti.mjs
//
// Il caso che conta: in una sala operativa tutte le postazioni escono dalla
// stessa rete. Il limite per persona deve essere davvero per persona, non
// uno solo diviso fra tutti.

import express from 'express';
import { apiLimiter, limitePerRete, passwordLimiter, chiaveIndirizzo } from '../src/middleware/rateLimiters.js';

let superati = 0;
let falliti = 0;
function verifica(descrizione, condizione, dettaglio = '') {
    if (condizione) { superati++; console.log(`  OK   ${descrizione}`); }
    else { falliti++; console.log(`  FAIL ${descrizione}${dettaglio ? ' -> ' + dettaglio : ''}`); }
}

// Stesso ordine di server.js: guardia per rete, autenticazione, limite per persona.
const app = express();
app.set('trust proxy', 1);
app.post('/login', passwordLimiter, (req, res) => res.json({ ok: true }));
app.use('/api/', limitePerRete);
app.use((req, res, next) => {
    const utente = req.get('X-Utente-Finto');
    if (utente) req.user = { id: Number(utente) };
    next();
});
app.use('/api/', apiLimiter);
app.get('/api/qualcosa', (req, res) => res.json({ ok: true }));
app.post('/api/location', (req, res) => res.json({ ok: true }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function chiedi(percorso, { utente, ip = '203.0.113.7', metodo = 'GET' } = {}) {
    const headers = { 'X-Forwarded-For': ip };
    if (utente) headers['X-Utente-Finto'] = String(utente);
    const r = await fetch(base + percorso, { method: metodo, headers });
    await r.text();
    return r.status;
}

async function raffica(n, opzioni, percorso = '/api/qualcosa') {
    const stati = [];
    for (let i = 0; i < n; i++) stati.push(await chiedi(percorso, opzioni));
    return stati;
}

try {
    console.log('[1] Chiavi degli indirizzi');
    verifica('IPv4 resta com\'e\'', chiaveIndirizzo('203.0.113.7') === '203.0.113.7');
    verifica('IPv4 scritto come IPv6 torna IPv4', chiaveIndirizzo('::ffff:203.0.113.7') === '203.0.113.7');
    verifica('due indirizzi della stessa rete IPv6 /64 contano come uno',
        chiaveIndirizzo('2001:db8:1:2::1') === chiaveIndirizzo('2001:db8:1:2:ffff:eeee:dddd:cccc'),
        `${chiaveIndirizzo('2001:db8:1:2::1')} / ${chiaveIndirizzo('2001:db8:1:2:ffff:eeee:dddd:cccc')}`);
    verifica('reti IPv6 diverse restano diverse',
        chiaveIndirizzo('2001:db8:1:2::1') !== chiaveIndirizzo('2001:db8:1:3::1'));

    console.log('\n[2] Una sala operativa: due persone dietro la stessa rete');
    const LIMITE = 1500;
    const primo = await raffica(LIMITE, { utente: 1 });
    verifica('la prima persona usa tutto il suo limite', primo.every(s => s === 200), `${primo.filter(s => s !== 200).length} rifiutate`);
    verifica('oltre il limite si ferma', (await chiedi('/api/qualcosa', { utente: 1 })) === 429);
    verifica('la seconda persona, stessa rete, lavora ancora', (await chiedi('/api/qualcosa', { utente: 2 })) === 200);

    console.log('\n[3] Chi non e\' collegato si conta per rete');
    const anonimi = await raffica(LIMITE, { ip: '198.51.100.1' });
    verifica('fino al limite passano', anonimi.every(s => s === 200));
    verifica('una di più no', (await chiedi('/api/qualcosa', { ip: '198.51.100.1' })) === 429);
    verifica('cambiare indirizzo nella stessa rete IPv6 non aggira il limite', await (async () => {
        await raffica(LIMITE, { ip: '2001:db8:aa:bb::1' });
        return (await chiedi('/api/qualcosa', { ip: '2001:db8:aa:bb::9999' })) === 429;
    })());

    console.log('\n[4] Le posizioni delle squadre non contano');
    const posizioni = await raffica(LIMITE + 10, { utente: 3, metodo: 'POST' }, '/api/location');
    verifica('più posizioni del limite, di fila, passano tutte', posizioni.every(s => s === 200), `${posizioni.filter(s => s !== 200).length} rifiutate`);
    verifica('e il limite della persona e\' intatto', (await chiedi('/api/qualcosa', { utente: 3 })) === 200);

    console.log('\n[5] Il login si conta per rete, anche IPv6');
    const tentativi = [];
    for (let i = 0; i < 100; i++) {
        tentativi.push((await fetch(`${base}/login`, { method: 'POST', headers: { 'X-Forwarded-For': `2001:db8:cc:dd::${(i + 1).toString(16)}` } })).status);
    }
    const oltre = (await fetch(`${base}/login`, { method: 'POST', headers: { 'X-Forwarded-For': '2001:db8:cc:dd::abcd' } })).status;
    verifica('cento tentativi da indirizzi diversi della stessa rete, poi stop',
        tentativi.every(s => s === 200) && oltre === 429, `ultimo ${oltre}`);
} finally {
    server.close();
}

console.log(`\nLimiti: ${superati} superati, ${falliti} falliti`);
process.exit(falliti > 0 ? 1 : 0);
