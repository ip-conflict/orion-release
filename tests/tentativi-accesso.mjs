// Il blocco per account, dal vivo: dopo cinque password sbagliate sullo stesso
// nome l'accesso risponde 429 con Retry-After, anche se il nome non esiste;
// gli altri nomi non sono toccati.
//
//   ORION_URL=http://localhost:3010 node tests/tentativi-accesso.mjs

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const accedi = async (username) => {
    const r = await fetch(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Sbagliata-123!' }) });
    return { stato: r.status, attendi: r.headers.get('retry-after'), corpo: await r.json().catch(() => null) };
};

const nome = `prova-blocco-${Date.now()}`;
const esiti = [];
for (let i = 0; i < 5; i++) esiti.push(await accedi(nome));
verifica('i primi quattro errori rispondono 401', esiti.slice(0, 4).every(e => e.stato === 401), esiti.map(e => e.stato));
verifica('il quinto ferma l\'account: 429 con Retry-After', esiti[4].stato === 429 && Number(esiti[4].attendi) > 0, esiti[4]);
verifica('il messaggio dice quanto aspettare', /riprova fra/.test(esiti[4].corpo?.message || ''), esiti[4].corpo);
const dopo = await accedi(nome.toUpperCase());
verifica('anche scritto in maiuscolo resta fermo', dopo.stato === 429, dopo);
const altro = await accedi(`${nome}-altro`);
verifica('un altro nome non è toccato', altro.stato === 401, altro);

console.log(falliti ? `\n${falliti} controlli falliti.` : '\nTutto a posto.');
process.exit(falliti ? 1 : 0);
