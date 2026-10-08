// tests/simulazione.mjs
//
// La simulazione in sala: la natura dei tipi di attività, i campi della
// simulazione e la regia; l'apertura della sala dall'attività (chi, quando);
// il segno di simulazione dappertutto (stato, app, notifiche, chiamata); la
// chiusura che scrive le presenze nell'attività e toglie le strade chiuse
// simulate; l'emergenza vera che interrompe la simulazione tenendo squadre e
// sala; l'archivio con il segno.
//
// Apre e chiude emergenze sue: va lanciata su un'istanza di collaudo senza
// emergenze in corso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/simulazione.mjs

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
    const tipo = r.headers.get('content-type') || '';
    return { stato: r.status, corpo: tipo.includes('json') ? await r.json().catch(() => null) : await r.text() };
};
const attesa = (ms) => new Promise(r => setTimeout(r, ms));
const fra = (ore) => new Date(Date.now() + ore * 3600000).toISOString();
const linea = (d) => ({ type: 'LineString', coordinates: [[12.40 + d, 46.30], [12.41 + d, 46.31]] });

console.log('\nSimulazione in sala');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
if (stato?.active) {
    console.log("  (saltato: c'è un'emergenza in corso, la prova ne apre di sue)");
    process.exit(0);
}
const suffisso = Date.now().toString().slice(-5);
const persone = [];
const attivita = [];
const squadre = [];
async function nuovo(nome, ruoli = ['volontario']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `${nome}${suffisso}`, cognome: 'Simulazione', ruoli } })).corpo;
    persone.push(n.id);
    const q = new URL(n.magicLink).searchParams;
    const password = `${nome}!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    return { id: n.id, username: n.username, token: (await accediConFetch(BASE, n.username, password)).token };
}
async function chiudiSeAperta() {
    const s = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (s?.active) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
}

try {
    const org = await nuovo('Org');
    const regista = await nuovo('Regista');
    const a = await nuovo('Anna');
    const b = await nuovo('Bruno');
    const coord = await nuovo('Coord', ['volontario', 'coordinatore']);
    await chiama(`/api/admin/users/${org.id}/permessi`, { method: 'PUT', token: admin, body: { in_piu: ['gruppo.attivita'] } });

    const tipi = (await chiama('/api/attivita/tipi', { token: org.token })).corpo || [];
    const tipo = (n) => tipi.find(t => t.nome === n);
    verifica('i tipi hanno la natura', tipo('Addestramento')?.natura === 'addestramento' && tipo('Esercitazione')?.natura === 'esercitazione' && tipo('Riunione')?.natura === 'generica', tipi);
    const nuovoTipo = await chiama('/api/attivita/tipi', { method: 'POST', token: org.token, body: { nome: `Prova evacuazione ${suffisso}`, natura: 'esercitazione' } });
    verifica('un tipo nuovo nasce con la sua natura', nuovoTipo.corpo?.natura === 'esercitazione', nuovoTipo);
    await chiama(`/api/attivita/tipi/${nuovoTipo.corpo?.id}`, { method: 'PUT', token: org.token, body: { nome: nuovoTipo.corpo?.nome, attivo: false } });

    const riunione = await chiama('/api/attivita', { method: 'POST', token: org.token, body: { tipo_id: tipo('Riunione').id, titolo: 'No', inizio: fra(1), fine: fra(2), simulazione: 'sala', avviso_app: false } });
    verifica('una riunione non ha la simulazione -> 400', riunione.stato === 400, riunione);

    const add = await chiama('/api/attivita', {
        method: 'POST', token: org.token, body: {
            tipo_id: tipo('Addestramento').id, titolo: `Addestramento alluvione ${suffisso}`, inizio: fra(-0.5), fine: fra(3),
            convocazione: 'tutti', avviso_app: false, simulazione: 'sala',
            scenario: 'Piena del torrente, allagamenti nella zona industriale.', obiettivi: 'Provare la sala e le squadre idrovore.',
            regia: [regista.id]
        }
    });
    const idAdd = add.corpo?.id;
    if (idAdd) attivita.push(idAdd);
    verifica("l'addestramento con la simulazione in sala", add.stato === 201 && add.corpo?.simulazione === 'sala' && add.corpo?.natura === 'addestramento', add);
    verifica('con lo scenario e la regia', /Piena/.test(add.corpo?.scenario || '') && add.corpo?.regia?.some(x => x.id === regista.id), add.corpo);
    const vistoRegista = (await chiama(`/api/attivita/${idAdd}`, { token: regista.token })).corpo;
    verifica('il regista la vede e conduce', vistoRegista?.regista === true && vistoRegista?.gestisce === false, vistoRegista);
    verifica('un volontario non conduce', (await chiama(`/api/attivita/${idAdd}`, { token: a.token })).corpo?.regista === false);

    const futura = await chiama('/api/attivita', { method: 'POST', token: org.token, body: { tipo_id: tipo('Esercitazione').id, titolo: `Futura ${suffisso}`, inizio: fra(48), fine: fra(50), simulazione: 'sala', avviso_app: false } });
    if (futura.corpo?.id) attivita.push(futura.corpo.id);
    verifica('la sala non si apre giorni prima -> 409', (await chiama(`/api/attivita/${futura.corpo?.id}/apri-sala`, { method: 'POST', token: org.token, body: {} })).stato === 409);
    verifica('un volontario non apre la sala -> 403', (await chiama(`/api/attivita/${idAdd}/apri-sala`, { method: 'POST', token: a.token, body: {} })).stato === 403);

    // Bruno in una squadra preparata prima.
    const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
    const radio = ['Zulu', 'Yankee', 'Whiskey', 'Victor', 'Uniform', 'Tango'].find(x => !usati.has(x));
    const sq = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: radio, nome: 'Idrovore', membri: [{ username: b.username }] } });
    if (sq.corpo?.squadraId) squadre.push(sq.corpo.squadraId);

    const sala = await chiama(`/api/attivita/${idAdd}/apri-sala`, { method: 'POST', token: regista.token, body: {} });
    verifica('il regista apre la sala', sala.stato === 201 && sala.corpo?.emergency?.simulazione === true && /^SIM-\d{8}-/.test(sala.corpo?.emergency?.code || ''), sala);
    const idSim = sala.corpo?.emergency?.id;
    verifica('lo stato dice simulazione', (await chiama('/api/emergencies/status', { token: a.token })).corpo?.emergency?.simulazione === true);
    verifica("l'app la segna", (await chiama('/api/app/contesto', { token: b.token })).corpo?.emergenza?.simulazione === true);
    const ctxRegista = (await chiama('/api/app/contesto', { token: regista.token })).corpo;
    verifica("all'app del regista la regia, con l'attività", ctxRegista?.capacita?.includes('regia') && ctxRegista?.emergenza?.attivita_id === idAdd, ctxRegista?.capacita);
    verifica('a un volontario no', !(await chiama('/api/app/contesto', { token: b.token })).corpo?.capacita?.includes('regia'));
    verifica('una seconda sala no -> 409', (await chiama(`/api/attivita/${idAdd}/apri-sala`, { method: 'POST', token: org.token, body: {} })).stato === 409);
    verifica("l'attività sa della sua sala", (await chiama(`/api/attivita/${idAdd}`, { token: org.token })).corpo?.sala?.aperta === true);

    let avvisoSquadra = null;
    for (let i = 0; i < 20 && !avvisoSquadra; i++) {
        await attesa(150);
        avvisoSquadra = ((await chiama('/api/notifiche', { token: b.token })).corpo?.notifiche || []).find(n => n.categoria === 'emergenza');
    }
    verifica("gli avvisi dell'emergenza dicono [SIMULAZIONE]", /^\[SIMULAZIONE\]/.test(avvisoSquadra?.titolo || ''), avvisoSquadra);
    const ch = await chiama('/api/chiamate', { method: 'POST', token: org.token, body: { criterio: 'scelti', persone: [a.id] } });
    let avvisoChiamata = null;
    for (let i = 0; i < 20 && !avvisoChiamata; i++) {
        await attesa(150);
        avvisoChiamata = ((await chiama('/api/notifiche', { token: a.token })).corpo?.notifiche || []).find(n => n.tipo === 'chiamata');
    }
    verifica('anche la chiamata, una volta sola', ch.stato === 201 && /^\[SIMULAZIONE\] Chiamata/.test(avvisoChiamata?.titolo || '') && !/SIMULAZIONE\].*SIMULAZIONE/.test(avvisoChiamata?.titolo || ''), avvisoChiamata);
    await chiama(`/api/chiamate/${ch.corpo?.chiamata?.id}/risposta`, { method: 'POST', token: a.token, body: { risposta: 'arrivo' } });
    await chiama(`/api/disponibilita/${a.id}`, { method: 'PUT', token: org.token, body: { stato: 'arrivato' } });

    const strada = (await chiama('/api/mappa/elementi', { method: 'POST', token: admin, body: { tipo: 'strada_chiusa', nome: `Frana simulata ${suffisso}`, geometria: linea(0.06) } })).corpo;
    await chiama(`/api/mappa/elementi/${strada?.id}`, { method: 'PUT', token: admin, body: { oltre_emergenza: true } });

    verifica('un volontario non la chiude -> 403', (await chiama('/api/emergencies/close', { method: 'POST', token: a.token, body: {} })).stato === 403);
    await attesa(1200);
    const chiusa = await chiama('/api/emergencies/close', { method: 'POST', token: regista.token, body: { tieni_in_vigore: [strada?.id] } });
    verifica('il regista la chiude', chiusa.stato === 200, chiusa);
    await attesa(1500);
    const dopo = (await chiama('/api/mappa/elementi', { token: admin })).corpo;
    verifica('le strade chiuse simulate non restano sulla mappa', !(dopo?.emergenza || []).some(m => m.id === strada?.id));
    const concl = (await chiama(`/api/attivita/${idAdd}`, { token: org.token })).corpo;
    const pa = concl?.presenze?.find(p => p.user_id === a.id), pb = concl?.presenze?.find(p => p.user_id === b.id);
    verifica("le presenze vanno all'attività, che è conclusa", concl?.stato === 'conclusa' && !!pa && !!pb, concl?.presenze);
    verifica('e non fra le emergenze', ((await chiama(`/api/emergencies/${idSim}/presenze`, { token: org.token })).corpo || []).length === 0);
    const mie = (await chiama('/api/presenze/mie', { token: b.token })).corpo;
    verifica('nel libretto risulta un addestramento', mie?.voci?.some(v => v.attivita_id === idAdd && v.tipo === 'Addestramento' && v.origine === 'attivita'), mie?.voci);
    const archivio = (await chiama('/api/admin/emergencies/closed', { token: admin })).corpo || [];
    const inArchivio = archivio.find(e => e.id === idSim);
    verifica("nell'archivio con il segno e l'attività", inArchivio?.simulazione === true && inArchivio?.attivita_id === idAdd && !inArchivio?.interrotta_il, inArchivio);

    // Un'emergenza vera durante una simulazione.
    const add2 = await chiama('/api/attivita', { method: 'POST', token: org.token, body: { tipo_id: tipo('Esercitazione').id, titolo: `Esercitazione sala ${suffisso}`, inizio: fra(-0.2), fine: fra(2), simulazione: 'sala', avviso_app: false } });
    if (add2.corpo?.id) attivita.push(add2.corpo.id);
    const sala2 = await chiama(`/api/attivita/${add2.corpo?.id}/apri-sala`, { method: 'POST', token: org.token, body: {} });
    const idSim2 = sala2.corpo?.emergency?.id;
    const elenco = (await chiama('/api/squadre', { token: admin })).corpo || [];
    const coc = elenco.find(s => s.coc);
    await chiama(`/api/squadre/${coc?.id}`, { method: 'PUT', token: admin, body: { nome_radio: 'COC', nome: 'Sala operativa', membri: [{ username: coord.username }] } });
    const vera = await chiama('/api/emergencies/open', { method: 'POST', token: coord.token, body: { external_code: `VERA-${suffisso}`, name: 'Alluvione vera' } });
    verifica('senza conferma la vera non si apre -> 409', vera.stato === 409 && vera.corpo?.simulazione_in_corso === true, vera);
    verifica('chi conduce la simulazione non apre emergenze vere -> 403',
        (await chiama('/api/emergencies/open', { method: 'POST', token: regista.token, body: { external_code: 'X', interrompi_simulazione: true } })).stato === 403);
    await attesa(1200);
    const interrompi = await chiama('/api/emergencies/open', { method: 'POST', token: coord.token, body: { external_code: `VERA-${suffisso}`, name: 'Alluvione vera', interrompi_simulazione: true } });
    verifica("con la conferma: simulazione interrotta, emergenza vera aperta", interrompi.stato === 201 && interrompi.corpo?.simulazione_interrotta?.id === idSim2 && interrompi.corpo?.emergency?.simulazione === false, interrompi);
    await attesa(1500);
    const squadreDopo = (await chiama('/api/squadre', { token: admin })).corpo || [];
    verifica('le squadre restano formate', squadreDopo.some(s => s.nome_radio === radio && s.membri.some(m => m.username === b.username)), squadreDopo.map(s => s.nome_radio));
    verifica('la sala resta, con chi c\'era', squadreDopo.find(s => s.coc)?.membri?.some(m => m.username === coord.username), squadreDopo.find(s => s.coc));
    await chiama('/api/emergencies/close', { method: 'POST', token: coord.token, body: {} });
    await attesa(1500);
    const archivio2 = (await chiama('/api/admin/emergencies/closed', { token: admin })).corpo || [];
    const sim2 = archivio2.find(e => e.id === idSim2);
    verifica("l'archivio dice interrotta e da quale emergenza", !!sim2?.interrotta_il && sim2?.interrotta_da_codice === `VERA-${suffisso}`, sim2);
    const pres2 = (await chiama(`/api/attivita/${add2.corpo?.id}`, { token: org.token })).corpo;
    verifica('le presenze della parte simulata vanno alla sua attività', pres2?.presenze?.some(p => p.user_id === b.id), pres2?.presenze);

    // La simulazione al volo dal centro operativo: niente calendario prima.
    verifica('un volontario non apre una simulazione al volo -> 403', (await chiama('/api/simulazioni/al-volo', { method: 'POST', token: a.token, body: {} })).stato === 403);
    await chiama(`/api/attivita/${idAdd}/copione/eventi`, { method: 'POST', token: org.token, body: { tipo: 'comunicazione', minuto: 0, titolo: 'Allerta gialla' } });
    const copioni = (await chiama('/api/simulazioni/copioni', { token: org.token })).corpo || [];
    verifica('fra i copioni da cui partire c\'è quello dell\'addestramento', copioni.some(c => c.id === idAdd && c.eventi >= 1), copioni);
    const volo = await chiama('/api/simulazioni/al-volo', { method: 'POST', token: org.token, body: { ore: 2, copia_da: idAdd, scenario: 'Prova improvvisa' } });
    if (volo.corpo?.attivita_id) attivita.push(volo.corpo.attivita_id);
    verifica('si apre al volo, con il copione copiato', volo.stato === 201 && volo.corpo?.emergency?.simulazione === true && volo.corpo?.copiati === 1, volo.corpo);
    const nuova = (await chiama(`/api/attivita/${volo.corpo?.attivita_id}`, { token: org.token })).corpo;
    verifica("dietro c'è un addestramento che comincia adesso, condotto da chi l'ha aperto", nuova?.natura === 'addestramento' && nuova?.simulazione === 'sala' && nuova?.responsabile_id === org.id && nuova?.conduco === true && nuova?.sala?.aperta === true, nuova);
    verifica('nessuno riceve convocazioni', !(((await chiama('/api/notifiche', { token: a.token })).corpo?.notifiche || []).some(n => n.tipo === 'convocazione' && n.riferimento_id === volo.corpo?.attivita_id)));
    verifica('una seconda no -> 409', (await chiama('/api/simulazioni/al-volo', { method: 'POST', token: org.token, body: {} })).stato === 409);
    await chiudiSeAperta();
} finally {
    await chiudiSeAperta();
    for (const s of squadre) await chiama(`/api/squadre/${s}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    for (const p of persone.reverse()) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    for (const id of attivita) await chiama(`/api/attivita/${id}`, { method: 'DELETE', token: admin });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
