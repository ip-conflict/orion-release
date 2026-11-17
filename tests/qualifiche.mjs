// La qualifica di chi viene da fuori e delle sue squadre: si sceglie, si eredita, si conserva nello storico.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/qualifiche.mjs
// Apre un'emergenza di prova se non ce n'è una e la chiude alla fine; crea ed elimina persone e squadre.

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

console.log('\nQualifiche di esterni e squadre');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const persone = [], squadre = [];
let aperta = null;
const radioLiberi = async () => {
    const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
    return ['Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu', 'Tango', 'Sierra'].filter(n => !usati.has(n));
};
const squadra = async (id) => ((await chiama('/api/squadre', { token: admin })).corpo || []).find(s => s.id === id);
try {
    const elenco = (await chiama('/api/qualifiche', { token: admin })).corpo || {};
    verifica('le qualifiche hanno Vigili del Fuoco, Polizia Locale e Croce Rossa', elenco.vvf === 'Vigili del Fuoco' && !!elenco.polizia_locale && elenco.croce_rossa === 'Croce Rossa Italiana', elenco);
    verifica('senza accesso niente elenco', (await chiama('/api/qualifiche')).stato === 401);

    const [r1, r2, r3] = await radioLiberi();
    const vvf = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: r1, nome: 'APS Feltre', qualifica: 'vvf', membri: [] } });
    if (vvf.corpo?.squadraId) squadre.push(vvf.corpo.squadraId);
    verifica('una squadra dei Vigili del Fuoco si crea con la sua qualifica', (await squadra(vvf.corpo?.squadraId))?.qualifica === 'vvf', vvf.corpo);
    const sbagliata = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: r2, qualifica: 'pompieri', membri: [] } });
    verifica('una qualifica inventata -> 400', sbagliata.stato === 400, sbagliata);
    await chiama(`/api/squadre/${vvf.corpo.squadraId}`, { method: 'PUT', token: admin, body: { nome_radio: r1, nome: 'APS Feltre 2', membri: [] } });
    verifica('una modifica che non la nomina la lascia com\'era (l\'app non la manda)', (await squadra(vvf.corpo.squadraId))?.qualifica === 'vvf');
    await chiama(`/api/squadre/${vvf.corpo.squadraId}`, { method: 'PUT', token: admin, body: { nome_radio: r1, membri: [], qualifica: 'polizia_locale' } });
    verifica('si cambia', (await squadra(vvf.corpo.squadraId))?.qualifica === 'polizia_locale');
    await chiama(`/api/squadre/${vvf.corpo.squadraId}`, { method: 'PUT', token: admin, body: { nome_radio: r1, membri: [], qualifica: '' } });
    verifica('vuota torna una squadra del gruppo', (await squadra(vvf.corpo.squadraId))?.qualifica === null);
    await chiama(`/api/squadre/${vvf.corpo.squadraId}`, { method: 'PUT', token: admin, body: { nome_radio: r1, membri: [], qualifica: 'croce_rossa' } });
    verifica('la Croce Rossa ha una qualifica sua, accettata dal database', (await squadra(vvf.corpo.squadraId))?.qualifica === 'croce_rossa');
    await chiama(`/api/squadre/${vvf.corpo.squadraId}`, { method: 'PUT', token: admin, body: { nome_radio: r1, membri: [], qualifica: 'vvf' } });

    const esterno = await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Piero', cognome: `Fuori${suffisso}`, ruoli: ['esterno'], ente: 'Comando VVF Belluno', qualifica: 'vvf' } });
    if (esterno.corpo?.id) persone.push(esterno.corpo.id);
    const volontario = await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Gemma', cognome: `Dentro${suffisso}`, ruoli: ['volontario'], ente: 'Altro', qualifica: 'vvf' } });
    if (volontario.corpo?.id) persone.push(volontario.corpo.id);
    const utenti = (await chiama('/api/admin/users', { token: admin })).corpo || [];
    const e = utenti.find(u => u.id === esterno.corpo?.id), v = utenti.find(u => u.id === volontario.corpo?.id);
    verifica('un esterno permanente ha ente e qualifica', e?.qualifica === 'vvf' && e?.ente === 'Comando VVF Belluno', e);
    verifica('a un volontario del gruppo ente e qualifica non si danno', v?.qualifica === null && v?.ente === null, v);
    const modifica = await chiama(`/api/users/${esterno.corpo.id}`, { method: 'PUT', token: admin, body: { nome: 'Piero', cognome: `Fuori${suffisso}`, ruoli: ['esterno'], ente: 'Distaccamento Feltre', qualifica: 'vvf' } });
    verifica('si correggono con la modifica', modifica.corpo?.ente === 'Distaccamento Feltre', modifica.corpo);
    verifica('una qualifica inventata per una persona -> 400', (await chiama(`/api/users/${esterno.corpo.id}`, { method: 'PUT', token: admin, body: { nome: 'Piero', cognome: 'X', ruoli: ['esterno'], qualifica: 'marziani' } })).stato === 400);

    if (!(await chiama('/api/emergencies/status', { token: admin })).corpo?.active) {
        aperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `QUAL-${suffisso}` } })).corpo?.emergency?.id ?? null;
    }
    const temporaneo = await chiama('/api/esterni-temporanei', { method: 'POST', token: admin, body: { nome: 'Agente Rossi', ente: 'Polizia Locale Feltre', qualifica: 'polizia_locale', nuova_squadra: { nome_radio: r2, nome: 'Pattuglia' } } });
    if (temporaneo.corpo?.id) persone.push(temporaneo.corpo.id);
    const squadraTemp = (((await chiama('/api/squadre', { token: admin })).corpo) || []).find(s => s.nome_radio === r2);
    if (squadraTemp) squadre.push(squadraTemp.id);
    verifica("la squadra nuova dell'esterno temporaneo prende la sua qualifica", squadraTemp?.qualifica === 'polizia_locale', squadraTemp);
    const elencoTemp = ((await chiama('/api/esterni-temporanei', { token: admin })).corpo || []).find(x => x.id === temporaneo.corpo?.id);
    verifica('l\'elenco degli accessi temporanei porta la qualifica', elencoTemp?.qualifica === 'polizia_locale' && elencoTemp?.squadra_qualifica === 'polizia_locale', elencoTemp);
    const subentro = await chiama(`/api/esterni-temporanei/${temporaneo.corpo.id}/persona`, { method: 'PUT', token: admin, body: { nome: 'Agente Bianchi', qualifica: 'carabinieri' } });
    verifica('al cambio turno si aggiorna', subentro.stato === 200 && ((await chiama('/api/esterni-temporanei', { token: admin })).corpo || []).find(x => x.id === temporaneo.corpo.id)?.qualifica === 'carabinieri', subentro);
    const temporaneoDiverso = await chiama('/api/esterni-temporanei', { method: 'POST', token: admin, body: { nome: 'Volontario ANA', qualifica: 'pc_esterno', nuova_squadra: { nome_radio: r3, qualifica: 'altro_ente' } } });
    if (temporaneoDiverso.corpo?.id) persone.push(temporaneoDiverso.corpo.id);
    const sqDiversa = ((await chiama('/api/squadre', { token: admin })).corpo || []).find(s => s.nome_radio === r3);
    if (sqDiversa) squadre.push(sqDiversa.id);
    verifica('la squadra nuova può avere una qualifica sua', sqDiversa?.qualifica === 'altro_ente', sqDiversa);

    const seg = (await chiama('/api/reports', { method: 'POST', token: admin, body: { title: `Incendio tetto ${suffisso}` } })).corpo;
    await chiama(`/api/reports/${seg.id}/teams`, { method: 'POST', token: admin, body: { teamId: vvf.corpo.squadraId } });
    const dettaglio = (await chiama(`/api/reports/${seg.id}`, { token: admin })).corpo;
    verifica('la scheda della segnalazione dice la qualifica della squadra', dettaglio?.report?.assigned_teams?.[0]?.qualifica === 'vvf', dettaglio?.report?.assigned_teams);
    await chiama(`/api/reports/${seg.id}/teams/${vvf.corpo.squadraId}`, { method: 'DELETE', token: admin });
    await chiama(`/api/reports/${seg.id}/teams`, { method: 'POST', token: admin, body: { teamId: vvf.corpo.squadraId } });
    await chiama(`/api/reports/${seg.id}`, { method: 'PUT', token: admin, body: { status: 'Closed' } });
    await chiama(`/api/squadre/${vvf.corpo.squadraId}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    squadre.splice(squadre.indexOf(vvf.corpo.squadraId), 1);
    const dopo = (await chiama(`/api/reports/${seg.id}`, { token: admin })).corpo;
    verifica('sciolta la squadra, la segnalazione ricorda che erano i Vigili del Fuoco', dopo?.report?.assigned_teams?.some(t => t.qualifica === 'vvf'), dopo?.report?.assigned_teams);

    const coc = ((await chiama('/api/squadre', { token: admin })).corpo || []).find(s => s.coc);
    if (coc) {
        await chiama(`/api/squadre/${coc.id}`, { method: 'PUT', token: admin, body: { nome_radio: coc.nome_radio, membri: [], qualifica: 'vvf' } });
        verifica('la squadra COC resta del gruppo', (await squadra(coc.id))?.qualifica === null);
    }
} finally {
    if (aperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    for (const s of squadre) await chiama(`/api/squadre/${s}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    for (const p of persone) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}

console.log(falliti === 0 ? '\nQualifiche: tutto a posto\n' : `\nQualifiche: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
