// tests/stato-squadre.mjs
//
// Lo stato di una segnalazione segue le squadre: la prima squadra assegnata
// porta una segnalazione "Nuova" a "In corso", togliere l'ultima la riporta ad
// "Aperta", e il diario lo scrive. L'elenco porta l'ultima nota scritta da
// una persona, non quelle di sistema.
//
// Se non c'è un'emergenza aperta ne apre una e la chiude alla fine; crea una
// squadra e la toglie. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/stato-squadre.mjs

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

console.log('\nStato e squadre di una segnalazione');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
let emergenzaAperta = null, squadraId = null;
try {
    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (!(stato?.emergency || stato?.active)) {
        emergenzaAperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `STATO-${suffisso}`, name: 'Prova stato e squadre' } })).corpo?.emergency;
    }
    const squadre = (await chiama('/api/squadre', { token: admin })).corpo;
    const occupati = new Set((Array.isArray(squadre) ? squadre : squadre?.squadre || []).map(s => s.nome_radio));
    const radio = ['X-ray', 'Yankee', 'Zulu', 'Whiskey', 'Victor', 'Uniform', 'Tango'].find(n => !occupati.has(n)) || 'Zulu';
    squadraId = (await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: radio, nome: `Prova ${suffisso}`, membri: [] } })).corpo?.squadraId;
    verifica('squadra di prova creata', !!squadraId, radio);

    const titolo = `Prova stato ${suffisso}`;
    await chiama('/api/reports', { method: 'POST', token: admin, body: { title: titolo, priority: 'Medium' } });
    const elenco = async () => ((await chiama('/api/reports?limit=200', { token: admin })).corpo?.reports || []).find(r => r.title === titolo);
    const segn = await elenco();
    verifica('la segnalazione nasce "Nuova"', segn?.status === 'New', segn?.status);

    const assegna = await chiama(`/api/reports/${segn.id}/teams`, { method: 'POST', token: admin, body: { teamId: squadraId } });
    verifica('squadra assegnata', assegna.stato === 201, assegna);
    const dopo = await elenco();
    verifica('con la squadra passa da sola a "In corso"', dopo?.status === 'InProgress', dopo?.status);
    const voci = ((await chiama(`/api/reports/${segn.id}`, { token: admin })).corpo?.updates || []).map(u => u.update_text);
    verifica('il diario scrive il cambio di stato', voci.some(t => /'Nuova' a 'In corso' \(squadra assegnata\)/.test(t)), voci);

    await chiama(`/api/reports/${segn.id}/updates`, { method: 'POST', token: admin, body: { update_text: `Sul posto ${suffisso}` } });
    const conNota = await elenco();
    verifica("l'elenco porta l'ultima nota scritta da una persona", conNota?.ultima_nota?.testo === `Sul posto ${suffisso}` && !!conNota?.ultima_nota?.quando, conNota?.ultima_nota);

    const togli = await chiama(`/api/reports/${segn.id}/teams/${squadraId}`, { method: 'DELETE', token: admin });
    verifica('squadra tolta', togli.stato === 204, togli);
    const senza = await elenco();
    verifica('senza squadre torna "Aperta"', senza?.status === 'Open', senza?.status);
    verifica("le note di sistema non diventano l'ultima notizia", senza?.ultima_nota?.testo === `Sul posto ${suffisso}`, senza?.ultima_nota);

    await chiama(`/api/reports/${segn.id}`, { method: 'PUT', token: admin, body: { status: 'Closed' } });
} finally {
    if (squadraId) await chiama(`/api/squadre/${squadraId}`, { method: 'DELETE', token: admin });
    if (emergenzaAperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
