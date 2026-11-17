// Il blocco per account, dal vivo: dopo cinque password sbagliate sullo stesso
// nome l'accesso risponde 429 con Retry-After, anche se il nome non esiste;
// gli altri nomi e le altre reti non sono toccati; con la password dell'amministratore, i
// tentativi mandati tutti insieme non scavalcano il conto; le richieste di recupero della
// password hanno un tetto per rete. L'altra rete si finge con X-Forwarded-For,
// che il server crede perché si aspetta nginx davanti.
//
//   ORION_URL=http://localhost:3010 [ORION_ADMIN_USER=admin ORION_ADMIN_PASSWORD=...] node tests/tentativi-accesso.mjs

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const accedi = async (username, rete, password = 'Sbagliata-123!') => {
    const intestazioni = { 'Content-Type': 'application/json', ...(rete ? { 'X-Forwarded-For': rete } : {}) };
    const r = await fetch(`${BASE}/login`, { method: 'POST', headers: intestazioni, body: JSON.stringify({ username, password }) });
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
const altraRete = await accedi(nome, '198.51.100.20');
verifica('da un\'altra rete lo stesso nome si può ancora provare', altraRete.stato === 401, altraRete);

// Le risposte dopo il quinto errore sono 429 comunque: conta se la password giusta, mandata per
// ultima insieme alle altre, arriva al controllo. Prima ci arrivava, e l'accesso passava.
if (process.env.ORION_ADMIN_PASSWORD) {
    const ADMIN = process.env.ORION_ADMIN_USER || 'admin';
    const rete = `198.51.100.${40 + Math.floor(Math.random() * 50)}`;
    const insieme = await Promise.all([
        ...Array.from({ length: 9 }, () => accedi(ADMIN, rete)),
        accedi(ADMIN, rete, process.env.ORION_ADMIN_PASSWORD)
    ]);
    verifica('dieci tentativi mandati insieme: la password giusta, ultima, non arriva al controllo',
        insieme.every(e => e.stato === 429 || (e.stato === 401 && !e.corpo?.mfa && !e.corpo?.token)), insieme.map(e => `${e.stato}${e.corpo?.mfa ? '+mfa' : ''}`));
}

const RETE_RECUPERO = '198.51.100.30';
const recupero = async () => (await fetch(`${BASE}/api/auth/forgot-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': RETE_RECUPERO },
    body: JSON.stringify({ identificativo: `${nome}-recupero` })
})).status;
const statiRecupero = [];
for (let i = 0; i < 11; i++) statiRecupero.push(await recupero());
verifica('dieci richieste di recupero dalla stessa rete passano, l\'undicesima no (429)',
    statiRecupero.slice(0, 10).every(s => s === 200) && statiRecupero[10] === 429, statiRecupero);

console.log(falliti ? `\n${falliti} controlli falliti.` : '\nTutto a posto.');
process.exit(falliti ? 1 : 0);
