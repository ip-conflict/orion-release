// tests/rete.mjs
//
// Rete scarsa: le scritture del centro operativo rimandate con la stessa
// Idempotency-Key non scrivono due volte (segnalazione, nota, diario di sala,
// cambio di stato), la stessa chiave per una richiesta diversa è rifiutata,
// una chiave non valida pure; il cambio di stato rimandato che trova la
// segnalazione cambiata da qualcun altro non scrive sopra (409 conflitto);
// la posizione di una squadra che parte in ritardo porta la sua età e non
// copre una più recente.
//
// Apre e chiude un'emergenza sua: va lanciata su un'istanza di collaudo senza
// emergenze in corso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/rete.mjs

import 'dotenv/config';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token, chiave } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(chiave ? { 'Idempotency-Key': chiave } : {})
        }
    });
    const tipo = r.headers.get('content-type') || '';
    return { stato: r.status, ripetuta: r.headers.get('idempotent-replayed') === 'true', corpo: tipo.includes('json') ? await r.json().catch(() => null) : await r.text() };
};

console.log('\nRete scarsa: idempotenza e conflitti');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
if (stato?.active) {
    console.log("  (saltato: c'è un'emergenza in corso, la prova ne apre una sua)");
    process.exit(0);
}
const suffisso = Date.now().toString().slice(-6);
const k = (nome) => `prova-${nome}-${suffisso}`;
let squadraId = null;

try {
    const aperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `RETE-${suffisso}`, name: 'Prova rete scarsa' } })).corpo?.emergency;
    verifica('emergenza aperta', !!aperta?.id, aperta);

    // Segnalazione: due invii, una sola scheda.
    const corpo = { title: `Allagamento ${suffisso}`, priority: 'Medium' };
    const prima = await chiama('/api/reports', { method: 'POST', token: admin, body: corpo, chiave: k('seg') });
    const seconda = await chiama('/api/reports', { method: 'POST', token: admin, body: corpo, chiave: k('seg') });
    verifica('la prima crea la segnalazione', prima.stato === 201 && prima.corpo?.id, prima);
    verifica('la seconda restituisce la stessa risposta', seconda.stato === 201 && seconda.corpo?.id === prima.corpo?.id && seconda.ripetuta, seconda);
    const elenco = (await chiama(`/api/reports?limit=100&status_type=all&emergency_id=${aperta.id}`, { token: admin })).corpo?.reports || [];
    verifica('una sola segnalazione con quel titolo', elenco.filter(r => r.title === corpo.title).length === 1, elenco.map(r => r.title));
    const id = prima.corpo.id;

    const diversa = await chiama('/api/reports', { method: 'POST', token: admin, body: { ...corpo, title: 'Altro' }, chiave: k('seg') });
    verifica('stessa chiave per una richiesta diversa: 422', diversa.stato === 422, diversa);
    const storta = await chiama('/api/reports', { method: 'POST', token: admin, body: corpo, chiave: 'no' });
    verifica('chiave non valida: 400', storta.stato === 400, storta);

    // Nota sulla segnalazione.
    const nota = { update_text: `Arrivati sul posto ${suffisso}` };
    await chiama(`/api/reports/${id}/updates`, { method: 'POST', token: admin, body: nota, chiave: k('nota') });
    const notaDoppia = await chiama(`/api/reports/${id}/updates`, { method: 'POST', token: admin, body: nota, chiave: k('nota') });
    verifica('nota rimandata: risposta ripetuta', notaDoppia.ripetuta && notaDoppia.stato < 300, notaDoppia);
    const scheda = (await chiama(`/api/reports/${id}`, { token: admin })).corpo;
    const note = (scheda?.updates || scheda?.report?.updates || []).filter(u => (u.update_text || '').includes(nota.update_text));
    verifica('una sola nota', note.length === 1, note.length);

    // Diario di sala.
    const voce = { testo: `Sala: ponte chiuso ${suffisso}` };
    await chiama('/api/emergencies/diario-sala', { method: 'POST', token: admin, body: voce, chiave: k('diario') });
    await chiama('/api/emergencies/diario-sala', { method: 'POST', token: admin, body: voce, chiave: k('diario') });
    const eventi = (await chiama(`/api/emergencies/${aperta.id}/eventi?limit=60`, { token: admin })).corpo || [];
    verifica('una sola voce di diario', eventi.filter(e => (e.testo || '').includes(voce.testo)).length === 1, eventi.length);

    // Cambio di stato con lo stato atteso.
    const avvia = await chiama(`/api/reports/${id}`, { method: 'PUT', token: admin, body: { status: 'InProgress', stato_atteso: 'New' }, chiave: k('stato1') });
    verifica('cambio di stato con lo stato atteso giusto', avvia.stato === 200, avvia);
    const vecchio = await chiama(`/api/reports/${id}`, { method: 'PUT', token: admin, body: { status: 'Closed', stato_atteso: 'New' }, chiave: k('stato2') });
    verifica('cambio rimandato su uno stato superato: 409 conflitto', vecchio.stato === 409 && vecchio.corpo?.conflitto && vecchio.corpo?.stato_attuale === 'InProgress', vecchio);
    const ancora = (await chiama(`/api/reports/${id}`, { token: admin })).corpo;
    verifica('lo stato resta quello di chi è arrivato prima', (ancora?.status || ancora?.report?.status) === 'InProgress', ancora?.status);
    const ripetuto = await chiama(`/api/reports/${id}`, { method: 'PUT', token: admin, body: { status: 'Closed', stato_atteso: 'New' }, chiave: k('stato2') });
    verifica('il conflitto rimandato resta un conflitto (risposta ripetuta)', ripetuto.stato === 409 && ripetuto.ripetuta, ripetuto);
    const stesso = await chiama(`/api/reports/${id}`, { method: 'PUT', token: admin, body: { status: 'InProgress', stato_atteso: 'New' } });
    verifica('stesso stato già raggiunto da altri: nessun conflitto', stesso.stato === 200, stesso);
    const senza = await chiama(`/api/reports/${id}`, { method: 'PUT', token: admin, body: { status: 'Open' } });
    verifica('senza stato atteso si scrive come prima', senza.stato === 200, senza);

    // La posizione che parte in ritardo arriva vecchia com'è, e non copre una più recente.
    const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(x => x.nome_radio));
    const nomeRadio = ['Sierra', 'Romeo', 'Quebec', 'Papa', 'Oscar', 'November'].find(n => !usati.has(n));
    squadraId = (await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: nomeRadio, nome: 'Prova rete', membri: [] } })).corpo?.squadraId;
    verifica('squadra creata', !!squadraId);
    const pos = (lat, eta) => chiama('/api/location', { method: 'POST', token: admin, body: { squadra_id: squadraId, latitude: lat, longitude: 12.2, ...(eta != null ? { eta_ms: eta } : {}) } });
    const dov = async () => ((await chiama('/api/location', { token: admin })).corpo || []).find(p => p.squadra_id === squadraId);
    const anni = (p) => (Date.now() - new Date(p.last_update).getTime()) / 1000;
    let pr = await pos(46.10, 120000);
    let ora = await dov();
    verifica('posizione rilevata 2 minuti fa: sulla mappa ha 2 minuti', pr.corpo?.accettata && ora && anni(ora) > 100 && anni(ora) < 140, [pr.corpo, ora && anni(ora)]);
    pr = await pos(46.11, 0);
    ora = await dov();
    verifica('quella appena rilevata la sostituisce', pr.corpo?.accettata && Number(ora.latitude) === 46.11 && anni(ora) < 10, ora);
    pr = await pos(46.12, 300000);
    ora = await dov();
    verifica('una rimasta indietro non copre la più recente', pr.corpo?.accettata && pr.corpo?.superata && Number(ora.latitude) === 46.11, [pr.corpo, ora]);
    pr = await pos(46.13);
    ora = await dov();
    verifica('senza età vale adesso, come prima', pr.corpo?.accettata && Number(ora.latitude) === 46.13 && anni(ora) < 10, ora);
} catch (e) {
    verifica('nessuna eccezione', false, e.stack || e.message);
} finally {
    if (squadraId) await chiama(`/api/squadre/${squadraId}`, { method: 'DELETE', token: admin });
    const s = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (s?.active) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
}

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutto bene.');
process.exit(falliti ? 1 : 0);
