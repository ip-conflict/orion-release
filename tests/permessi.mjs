// tests/permessi.mjs
//
// Dai ruoli ai permessi (src/permessi.js). Il catalogo, il ruolo
// Coordinatore, i permessi in più: concessi valgono subito sulla stessa
// sessione, revocati si chiudono subito; li dà solo l'amministratore, mai a
// un esterno; chi gestisce l'anagrafica iscrive solo volontari e legge il
// libretto senza visite e corsi; chi riceve i dati sanitari deve fare la
// verifica in due passaggi.
//
// Crea qualche volontario e li elimina alla fine. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/permessi.mjs

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

console.log('\nPermessi');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const daTogliere = [];
async function nuovo(nome, ruoli = ['volontario']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `${nome}${suffisso}`, cognome: 'Permessi', ruoli } })).corpo;
    daTogliere.push(n.id);
    const q = new URL(n.magicLink).searchParams;
    const password = `${nome}!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    return { id: n.id, username: n.username, password, token: ruoli.includes('esterno') ? null : (await accediConFetch(BASE, n.username, password)).token };
}
const concedi = (id, inPiu) => chiama(`/api/admin/users/${id}/permessi`, { method: 'PUT', token: admin, body: { in_piu: inPiu } });

try {
    const catalogo = (await chiama('/api/permessi/catalogo', { token: admin })).corpo;
    verifica('il catalogo ha dieci permessi in quattro categorie', catalogo?.permessi?.length === 10 && catalogo.categorie.length === 4, catalogo?.categorie);
    verifica('il coordinatore ha i quattro permessi delle emergenze e le attività',
        JSON.stringify(catalogo?.pacchetti?.coordinatore) === JSON.stringify(['emergenze.apertura', 'emergenze.archivio', 'emergenze.piano', 'emergenze.funzioni', 'gruppo.attivita']));

    const v = await nuovo('Vol');
    const me = (await chiama('/api/me/status', { token: v.token })).corpo;
    verifica('un volontario non ha permessi', Array.isArray(me?.permessi) && me.permessi.length === 0, me?.permessi);
    verifica("l'archivio delle emergenze gli è chiuso", (await chiama('/api/admin/emergencies/closed', { token: v.token })).stato === 403);

    const dato = await concedi(v.id, ['emergenze.archivio']);
    verifica('concesso un permesso in più', dato.stato === 200 && dato.corpo?.effettivi?.includes('emergenze.archivio'), dato);
    verifica('vale subito, sulla stessa sessione', (await chiama('/api/admin/emergencies/closed', { token: v.token })).stato === 200);
    const contesto = (await chiama('/api/app/contesto', { token: v.token })).corpo;
    verifica("l'app lo sa dal contesto", contesto?.utente?.permessi?.includes('emergenze.archivio'), contesto?.utente);
    const elenco = (await chiama('/api/admin/users', { token: admin })).corpo || [];
    verifica('la gestione utenti lo mostra', elenco.find(u => u.id === v.id)?.permessi_in_piu?.includes('emergenze.archivio'));
    await concedi(v.id, []);
    verifica('revocato, si richiude subito', (await chiama('/api/admin/emergencies/closed', { token: v.token })).stato === 403);

    verifica('un permesso inventato -> 400', (await concedi(v.id, ['tutto.quanto'])).stato === 400);
    const daSe = await chiama(`/api/admin/users/${v.id}/permessi`, { method: 'PUT', token: v.token, body: { in_piu: ['emergenze.archivio'] } });
    verifica('chi non è amministratore non se li dà -> 403', daSe.stato === 403, daSe.stato);
    const esterno = await nuovo('Est', ['esterno']);
    verifica('a un esterno non si danno -> 409', (await concedi(esterno.id, ['emergenze.archivio'])).stato === 409);

    // Il coordinatore.
    await chiama(`/api/users/${v.id}`, { method: 'PUT', token: admin, body: { nome: `Vol${suffisso}`, cognome: 'Permessi', ruoli: ['volontario', 'coordinatore'] } });
    const coord = (await chiama('/api/me/status', { token: v.token })).corpo;
    verifica('diventato coordinatore, ha i permessi delle emergenze', coord?.role === 'coordinatore' && coord.permessi?.length === 5, coord);
    verifica("e consulta l'archivio", (await chiama('/api/admin/emergencies/closed', { token: v.token })).stato === 200);
    verifica('ma non la gestione degli account', (await chiama(`/api/users/${esterno.id}`, { method: 'PUT', token: v.token, body: { nome: 'X', cognome: 'Y', ruoli: ['volontario'] } })).stato === 403);
    await chiama(`/api/users/${v.id}`, { method: 'PUT', token: admin, body: { nome: `Vol${suffisso}`, cognome: 'Permessi', ruoli: ['volontario'] } });

    // Anagrafica: iscrive volontari, legge il libretto senza dati sanitari.
    await concedi(v.id, ['volontari.anagrafica']);
    verifica("con l'anagrafica vede l'elenco dei volontari", (await chiama('/api/admin/users', { token: v.token })).stato === 200);
    const iscritto = await chiama('/api/users', { method: 'POST', token: v.token, body: { nome: `Nuovo${suffisso}`, cognome: 'Iscritto', ruoli: ['volontario'] } });
    verifica('iscrive un volontario', iscritto.stato === 201, iscritto);
    if (iscritto.corpo?.id) daTogliere.push(iscritto.corpo.id);
    const troppo = await chiama('/api/users', { method: 'POST', token: v.token, body: { nome: `Altro${suffisso}`, cognome: 'Iscritto', ruoli: ['segreteria'] } });
    verifica('ma non con altri ruoli -> 403', troppo.stato === 403, troppo.stato);
    const libretto = await chiama(`/api/users/${esterno.id}/libretto`, { token: v.token });
    verifica('il libretto degli altri senza visite e corsi', libretto.stato === 200 && libretto.corpo?.dati_sanitari === false
        && libretto.corpo.medical_records.length === 0, libretto.corpo);
    verifica('il catalogo delle visite resta chiuso', (await chiama('/api/admin/medical-visit-types', { token: v.token })).stato === 403);

    // Dati sanitari: serve la verifica in due passaggi.
    const sanitario = await concedi(v.id, ['volontari.sanitario']);
    verifica('chi riceve i dati sanitari è avvisato della verifica', /verifica in due passaggi/.test(sanitario.corpo?.message || ''), sanitario.corpo);
    const senzaVerifica = await chiama('/api/me/status', { token: v.token });
    verifica('e la sessione senza verifica non vale più -> 401', senzaVerifica.stato === 401 && senzaVerifica.corpo?.motivo === 'mfa_richiesta', senzaVerifica);
    const riaccesso = await fetch(BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: v.username, password: v.password }) });
    const passo = await riaccesso.json().catch(() => null);
    verifica("al nuovo accesso gli chiede di attivarla", riaccesso.status === 401 && passo?.mfa === 'attivazione', passo);
} finally {
    for (const id of daTogliere.reverse()) await chiama(`/api/users/${id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
