// tests/attivita.mjs
//
// Attività, calendario e presenze (src/attivita.js, src/presenze.js) e la
// squadra COC. Le attività: chi le crea (gruppo.attivita, anche il
// Coordinatore), chi le vede secondo la convocazione, le risposte, i posti
// delle attività aperte, l'annullamento, la conclusione con i presenti e il
// corso nel libretto, l'attestato. Il calendario e il modulo spento. In
// emergenza: la squadra COC nasce all'apertura, non va sugli interventi né
// manda la posizione, chi ne fa parte (anche un esterno) segue tutte le
// segnalazioni; alla chiusura le presenze si scrivono dal registro delle
// squadre e si correggono.
//
// Crea persone, attività, squadre e un'emergenza sua (se non ce n'è una
// aperta) e li toglie alla fine. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/attivita.mjs

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
const attesa = (ms) => new Promise(r => setTimeout(r, ms));
const fra = (ore) => new Date(Date.now() + ore * 3600000).toISOString();
const oggi = (giorni = 0) => new Date(Date.now() + giorni * 86400000).toISOString().slice(0, 10);

console.log('\nAttività, presenze e squadra COC');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const persone = [];
const attivita = [];
const squadre = [];
let emergenza = null;
async function nuovo(nome, ruoli = ['volontario']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `${nome}${suffisso}`, cognome: 'Attivita', ruoli } })).corpo;
    persone.push(n.id);
    const q = new URL(n.magicLink).searchParams;
    const password = `${nome}!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    return { id: n.id, username: n.username, token: (await accediConFetch(BASE, n.username, password)).token };
}
async function crea(token, corpo) {
    const r = await chiama('/api/attivita', { method: 'POST', token, body: corpo });
    if (r.corpo?.id) attivita.push(r.corpo.id);
    return r;
}

try {
    const catalogo = (await chiama('/api/permessi/catalogo', { token: admin })).corpo;
    verifica('il permesso gruppo.attivita è nel catalogo', catalogo?.permessi?.some(p => p.codice === 'gruppo.attivita' && p.categoria === 'Gruppo'));
    verifica('e nel pacchetto del Coordinatore', catalogo?.pacchetti?.coordinatore?.includes('gruppo.attivita'), catalogo?.pacchetti?.coordinatore);

    const org = await nuovo('Org');
    const a = await nuovo('Anna');
    const b = await nuovo('Bruno');
    const est = await nuovo('Est', ['esterno']);
    await chiama(`/api/admin/users/${org.id}/permessi`, { method: 'PUT', token: admin, body: { in_piu: ['gruppo.attivita'] } });

    const contesto = (await chiama('/api/app/contesto', { token: a.token })).corpo;
    verifica("l'app di un volontario ha il calendario", contesto?.capacita?.includes('calendario') && contesto?.moduli?.attivita === true, contesto?.capacita);
    verifica('un esterno no', !(await chiama('/api/app/contesto', { token: est.token })).corpo?.capacita?.includes('calendario'));
    verifica('un esterno non legge le attività -> 403', (await chiama('/api/attivita', { token: est.token })).stato === 403);

    const tipi = (await chiama('/api/attivita/tipi', { token: a.token })).corpo || [];
    verifica('i tipi di partenza', ['Esercitazione', 'Addestramento', 'Servizio', 'Riunione', 'Manutenzione'].every(n => tipi.some(t => t.nome === n)), tipi);
    const tipo = (n) => tipi.find(t => t.nome === n)?.id;

    verifica('un volontario non crea attività -> 403',
        (await crea(a.token, { titolo: 'No', inizio: fra(24), fine: fra(26) })).stato === 403);

    // Convocati scelti.
    const riunione = await crea(org.token, {
        tipo_id: tipo('Riunione'), titolo: `Riunione squadra ${suffisso}`, luogo: 'Sede', inizio: fra(48), fine: fra(50),
        convocazione: 'scelti', persone: [a.id], avviso_app: true, avviso_email: true
    });
    verifica('attività con convocati scelti creata', riunione.stato === 201 && riunione.corpo?.convocazione === 'scelti', riunione);
    const idRiunione = riunione.corpo?.id;
    verifica('il convocato la vede', (await chiama(`/api/attivita/${idRiunione}`, { token: a.token })).corpo?.sono_convocato === true);
    verifica('chi non è convocato no -> 404', (await chiama(`/api/attivita/${idRiunione}`, { token: b.token })).stato === 404);
    let avviso = null;
    for (let i = 0; i < 20 && !avviso; i++) {
        await attesa(150);
        avviso = ((await chiama('/api/notifiche', { token: a.token })).corpo?.notifiche || []).find(n => n.tipo === 'convocazione' && n.riferimento_id === idRiunione);
    }
    verifica("la convocazione arriva nell'app", avviso?.categoria === 'personale' && /Convocazione/.test(avviso?.titolo || ''), avviso);
    const daRispondere = (await chiama('/api/attivita/da-rispondere', { token: a.token })).corpo || [];
    verifica('è fra quelle da rispondere', daRispondere.some(x => x.id === idRiunione));
    const vistaOrg = (await chiama(`/api/attivita/${idRiunione}`, { token: org.token })).corpo;
    verifica("chi la propone la conduce: non deve rispondere", vistaOrg?.conduco === true && vistaOrg?.puo_rispondere === false, vistaOrg);
    verifica('e non è fra le sue da rispondere', !((await chiama('/api/attivita/da-rispondere', { token: org.token })).corpo || []).some(x => x.id === idRiunione));
    const dettaglioOrg = (await chiama(`/api/attivita/${idRiunione}`, { token: org.token })).corpo;
    const rigaA = dettaglioOrg?.persone?.find(p => p.id === a.id);
    verifica("chi organizza vede i convocati e se li raggiunge", dettaglioOrg?.gestisce && rigaA && rigaA.raggiungibile === false && rigaA.app === false, rigaA);
    verifica('chi non è convocato non risponde -> 404', (await chiama(`/api/attivita/${idRiunione}/risposta`, { method: 'POST', token: b.token, body: { risposta: 'si' } })).stato === 404);
    const risposta = await chiama(`/api/attivita/${idRiunione}/risposta`, { method: 'POST', token: a.token, body: { risposta: 'si', nota: 'arrivo alle 20:45' } });
    verifica('il convocato risponde "ci sono"', risposta.stato === 200 && risposta.corpo?.mia_risposta === 'si', risposta);
    verifica('e non è più da rispondere', !((await chiama('/api/attivita/da-rispondere', { token: a.token })).corpo || []).some(x => x.id === idRiunione));
    const notificheDopo = (await chiama('/api/notifiche', { token: a.token })).corpo?.notifiche || [];
    verifica('la convocazione scade con la risposta', !notificheDopo.some(n => n.tipo === 'convocazione' && n.riferimento_id === idRiunione), notificheDopo.map(n => n.tipo));
    verifica('chi organizza vede la risposta', (await chiama(`/api/attivita/${idRiunione}`, { token: org.token })).corpo?.si === 1);

    // Tutti.
    const esercitazione = await crea(org.token, { tipo_id: tipo('Esercitazione'), titolo: `Esercitazione ${suffisso}`, inizio: fra(72), fine: fra(76), convocazione: 'tutti', avviso_app: true });
    verifica('con "tutti" la vede ogni interno', (await chiama(`/api/attivita/${esercitazione.corpo?.id}`, { token: b.token })).corpo?.sono_convocato === true);
    let avvisoTutti = null;
    for (let i = 0; i < 20 && !avvisoTutti; i++) {
        await attesa(150);
        avvisoTutti = ((await chiama('/api/notifiche', { token: b.token })).corpo?.notifiche || []).find(n => n.tipo === 'convocazione' && n.riferimento_id === esercitazione.corpo?.id);
    }
    verifica('e la convocazione "a tutti" arriva', !!avvisoTutti);
    verifica('un volontario non la cambia -> 403', (await chiama(`/api/attivita/${esercitazione.corpo?.id}`, { method: 'PUT', token: b.token, body: { titolo: 'X', inizio: fra(72), fine: fra(76) } })).stato === 403);
    const spostata = await chiama(`/api/attivita/${esercitazione.corpo?.id}`, { method: 'PUT', token: org.token, body: { tipo_id: tipo('Esercitazione'), titolo: `Esercitazione ${suffisso}`, inizio: fra(96), fine: fra(100), convocazione: 'tutti', avviso_app: false, avvisa: true } });
    verifica('chi organizza la sposta', spostata.stato === 200, spostata);
    verifica('la fine prima dell\'inizio -> 400', (await crea(org.token, { titolo: 'Storta', inizio: fra(10), fine: fra(5) })).stato === 400);

    // Aperta, con un posto.
    const servizio = await crea(org.token, { tipo_id: tipo('Servizio'), titolo: `Assistenza gara ${suffisso}`, inizio: fra(120), fine: fra(124), convocazione: 'aperta', posti: 1, avviso_app: false });
    const idServizio = servizio.corpo?.id;
    verifica('aperta: aderisce il primo', (await chiama(`/api/attivita/${idServizio}/risposta`, { method: 'POST', token: a.token, body: { risposta: 'si' } })).corpo?.posti_liberi === 0);
    const pieno = await chiama(`/api/attivita/${idServizio}/risposta`, { method: 'POST', token: b.token, body: { risposta: 'si' } });
    verifica('il secondo trova i posti esauriti -> 409', pieno.stato === 409 && pieno.corpo?.posti_esauriti === true, pieno);
    verifica('ma può dire di no', (await chiama(`/api/attivita/${idServizio}/risposta`, { method: 'POST', token: b.token, body: { risposta: 'no' } })).stato === 200);

    // Annullata.
    const annullata = await chiama(`/api/attivita/${idServizio}/annulla`, { method: 'POST', token: org.token, body: { motivo: 'gara rinviata' } });
    verifica('annullata', annullata.corpo?.stato === 'annullata' && annullata.corpo?.motivo_annullamento === 'gara rinviata', annullata);
    verifica('e non si risponde più -> 409', (await chiama(`/api/attivita/${idServizio}/risposta`, { method: 'POST', token: a.token, body: { risposta: 'si' } })).stato === 409);
    verifica('una futura non si conclude -> 409',
        (await chiama(`/api/attivita/${idRiunione}/concludi`, { method: 'POST', token: org.token, body: { presenze: [{ user_id: a.id }] } })).stato === 409);

    // Un addestramento fatto, che vale come corso.
    const corsi = (await chiama('/api/admin/courses-catalog', { token: admin })).corpo || [];
    const corso = corsi.find(c => c.validity_months) || corsi[0];
    const addestramento = await crea(org.token, {
        tipo_id: tipo('Addestramento'), titolo: `Addestramento motosega ${suffisso}`, inizio: fra(-5), fine: fra(-1),
        convocazione: 'scelti', persone: [a.id, b.id], corso_id: corso?.id, avviso_app: false
    });
    const idAdd = addestramento.corpo?.id;
    verifica('un volontario non lo chiude -> 403',
        (await chiama(`/api/attivita/${idAdd}/concludi`, { method: 'POST', token: b.token, body: { presenze: [] } })).stato === 403);
    const chiusa = await chiama(`/api/attivita/${idAdd}/concludi`, { method: 'POST', token: org.token, body: { presenze: [{ user_id: a.id }, { user_id: b.id, inizio: fra(-5), fine: fra(-3) }] } });
    verifica('concluso con due presenti e i loro corsi', chiusa.stato === 200 && chiusa.corpo?.stato === 'conclusa' && chiusa.corpo?.presenti === 2 && chiusa.corpo?.corsi === (corso ? 2 : 0), chiusa.corpo);
    const mie = (await chiama('/api/presenze/mie', { token: b.token })).corpo;
    const presenzaB = mie?.voci?.find(v => v.attivita_id === idAdd);
    verifica('nelle presenze di Bruno, con le sue due ore', presenzaB?.minuti === 120 && presenzaB?.tipo === 'Addestramento' && mie.ore_totali === '2 h', mie);
    if (corso) {
        const libretto = (await chiama(`/api/users/${b.id}/libretto`, { token: admin })).corpo;
        verifica('e il corso nel suo libretto', (libretto?.courses || libretto?.corsi || []).some(c => c.course_id === corso.id || c.name === corso.name), libretto?.courses);
    }
    const pdf = await fetch(`${BASE}/api/presenze/${presenzaB?.id}/attestato`, { headers: { Authorization: `Bearer ${b.token}` } });
    const testa = Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString();
    verifica("l'attestato in PDF", pdf.status === 200 && testa === '%PDF-', `${pdf.status} ${testa}`);
    verifica("quello di un altro non si scarica -> 404", (await chiama(`/api/presenze/${presenzaB?.id}/attestato`, { token: a.token })).stato === 404);
    verifica('Anna non vede le presenze di Bruno -> 403', (await chiama(`/api/users/${b.id}/presenze`, { token: a.token })).stato === 403);
    const ricorretta = await chiama(`/api/attivita/${idAdd}/concludi`, { method: 'POST', token: org.token, body: { presenze: [{ user_id: a.id }] } });
    verifica('ricorretta: Bruno esce dai presenti', ricorretta.corpo?.presenti === 1 && !((await chiama('/api/presenze/mie', { token: b.token })).corpo?.voci || []).some(v => v.attivita_id === idAdd));
    const riepilogo = (await chiama('/api/presenze/riepilogo', { token: org.token })).corpo;
    verifica('il riepilogo dell\'anno per chi organizza', riepilogo?.persone?.some(p => p.id === a.id && p.minuti_attivita === 240), riepilogo?.persone?.find(p => p.id === a.id));
    const csv = await fetch(`${BASE}/api/presenze/riepilogo?formato=csv`, { headers: { Authorization: `Bearer ${org.token}` } });
    verifica('anche in CSV', csv.status === 200 && (await csv.text()).includes('Ore totali'));
    verifica('un volontario non lo vede -> 403', (await chiama('/api/presenze/riepilogo', { token: a.token })).stato === 403);
    verifica("un'attività con presenze non si elimina -> 409", (await chiama(`/api/attivita/${idAdd}`, { method: 'DELETE', token: org.token })).stato === 409);

    // Il calendario.
    const cal = (await chiama(`/api/calendario?da=${oggi(-2)}&a=${oggi(10)}`, { token: a.token })).corpo;
    verifica('il calendario porta le attività del periodo', cal?.attivita?.some(x => x.id === idRiunione) && cal?.attivita?.some(x => x.id === idAdd), cal?.attivita?.map(x => x.titolo));
    verifica('a un volontario niente scadenze degli altri', cal?.filtri?.segreteria === false && cal?.filtri?.magazzino === false, cal?.filtri);
    verifica('Bruno nel calendario non vede la riunione di Anna',
        !((await chiama(`/api/calendario?da=${oggi(-2)}&a=${oggi(10)}`, { token: b.token })).corpo?.attivita || []).some(x => x.id === idRiunione));
    verifica('un periodo troppo lungo -> 400', (await chiama(`/api/calendario?da=${oggi(0)}&a=${oggi(500)}`, { token: a.token })).stato === 400);

    // Il modulo spento.
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { attivita_enabled: 'false' } });
    const spento = await chiama('/api/attivita', { token: a.token });
    verifica('modulo spento: le rotte rispondono 404', spento.stato === 404 && spento.corpo?.modulo_spento === true, spento);
    verifica("e l'app non ha il calendario", !(await chiama('/api/app/contesto', { token: a.token })).corpo?.capacita?.includes('calendario'));
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { attivita_enabled: 'true' } });
    verifica('riacceso, tutto torna', (await chiama(`/api/attivita/${idRiunione}`, { token: a.token })).stato === 200);

    // L'emergenza: la squadra COC e le presenze.
    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (stato?.active) {
        console.log("  (un'emergenza era già aperta: squadra COC e presenze non si provano)");
    } else {
        const aperta = await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `ATT-${suffisso}`, name: 'Prova presenze' } });
        emergenza = aperta.corpo?.emergency?.id;
        const elenco = (await chiama('/api/squadre', { token: admin })).corpo || [];
        const coc = elenco.find(s => s.coc);
        verifica("all'apertura nasce la squadra COC", coc?.nome_radio === 'COC', elenco.map(s => s.nome_radio));
        const inSala = await chiama(`/api/squadre/${coc?.id}`, { method: 'PUT', token: admin, body: { nome_radio: 'Alfa', nome: 'Altro nome', membri: [{ username: a.username }, { username: est.username }] } });
        verifica('si compone come le altre, ma tiene il suo nome', inSala.stato === 200 && ((await chiama('/api/squadre', { token: admin })).corpo || []).find(s => s.id === coc?.id)?.nome_radio === 'COC', inSala);
        const ctxSala = (await chiama('/api/app/contesto', { token: a.token })).corpo;
        verifica("nell'app chi è in sala segue tutte le segnalazioni", ctxSala?.capacita?.includes('emergenza.sala') && ctxSala?.squadra?.coc === true, ctxSala?.capacita);
        verifica('la squadra COC non manda la posizione -> 409',
            (await chiama('/api/location', { method: 'POST', token: a.token, body: { squadra_id: coc?.id, latitude: 46.1, longitude: 12.2 } })).stato === 409);
        verifica('non è fra le disponibili per gli interventi', !((await chiama('/api/squadre/disponibili', { token: admin })).corpo || []).some(s => s.id === coc?.id));
        const segnalazione = await chiama('/api/reports', { method: 'POST', token: admin, body: { title: `Albero caduto ${suffisso}` } });
        const idReport = segnalazione.corpo?.id ?? segnalazione.corpo?.report?.id;
        verifica('non va sugli interventi -> 409',
            (await chiama(`/api/reports/${idReport}/teams`, { method: 'POST', token: admin, body: { teamId: coc?.id } })).stato === 409);
        const nota = await chiama(`/api/reports/${idReport}/updates`, { method: 'POST', token: est.token, body: { update_text: 'Dalla sala: avvisato il 118' } });
        verifica("un esterno in sala scrive note su ogni segnalazione", nota.stato === 201 || nota.stato === 200, nota);
        verifica('durante l\'emergenza non si scioglie -> 409', (await chiama(`/api/squadre/${coc?.id}`, { method: 'DELETE', token: admin })).stato === 409);
        // Bruno in una squadra di campo.
        const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
        const radio = ['Zulu', 'Yankee', 'Whiskey', 'Victor', 'Uniform', 'Tango'].find(x => !usati.has(x));
        const campo = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: radio, nome: 'Campo', membri: [{ username: b.username }] } });
        if (campo.corpo?.squadraId) squadre.push(campo.corpo.squadraId);
        await attesa(1200);
        await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
        const chiusaId = emergenza;
        emergenza = null;
        await attesa(1500);
        const presenze = (await chiama(`/api/emergencies/${chiusaId}/presenze`, { token: org.token })).corpo || [];
        const pa = presenze.find(p => p.user_id === a.id), pb = presenze.find(p => p.user_id === b.id);
        verifica('alla chiusura le presenze di chi era in sala e in squadra', !!pa && !!pb && /COC/.test(pa.dettaglio) && pa.tipo === 'Emergenza', presenze);
        verifica("l'esterno no", !presenze.some(p => p.user_id === est.id));
        verifica('la squadra COC si scioglie', !((await chiama('/api/squadre', { token: admin })).corpo || []).some(s => s.coc));
        const corretta = await chiama(`/api/presenze/${pa?.id}`, { method: 'PUT', token: org.token, body: { inizio: fra(-3), fine: fra(-1), minuti: 90, nota: 'uscita per un\'ora' } });
        verifica('chi organizza la corregge', corretta.stato === 200 && corretta.corpo?.minuti === 90 && !!corretta.corpo?.corretta_da, corretta);
        verifica('un volontario no -> 403', (await chiama(`/api/presenze/${pa?.id}`, { method: 'PUT', token: a.token, body: { inizio: fra(-3), fine: fra(-1) } })).stato === 403);
        const aggiunta = await chiama(`/api/emergencies/${chiusaId}/presenze`, { method: 'POST', token: org.token, body: { user_id: org.id, inizio: fra(-2), fine: fra(-1), nota: 'in sala senza squadra' } });
        verifica('chi era in sala senza squadra si aggiunge a mano', aggiunta.stato === 201, aggiunta);
        verifica('una seconda volta no -> 409', (await chiama(`/api/emergencies/${chiusaId}/presenze`, { method: 'POST', token: org.token, body: { user_id: org.id, inizio: fra(-2), fine: fra(-1) } })).stato === 409);
        verifica("un esterno non si aggiunge -> 400", (await chiama(`/api/emergencies/${chiusaId}/presenze`, { method: 'POST', token: org.token, body: { user_id: est.id, inizio: fra(-2), fine: fra(-1) } })).stato === 400);
        const pdfEm = await fetch(`${BASE}/api/presenze/${pa?.id}/attestato`, { headers: { Authorization: `Bearer ${a.token}` } });
        verifica("l'attestato dell'emergenza", pdfEm.status === 200 && pdfEm.headers.get('content-type') === 'application/pdf');
    }
} finally {
    if (emergenza) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { attivita_enabled: 'true' } });
    for (const s of squadre) await chiama(`/api/squadre/${s}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    for (const p of persone.reverse()) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    // Dopo le persone: con loro se ne vanno le presenze che tenevano le attività.
    for (const id of attivita) await chiama(`/api/attivita/${id}`, { method: 'DELETE', token: admin });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
