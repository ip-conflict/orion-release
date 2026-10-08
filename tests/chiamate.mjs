// tests/chiamate.mjs
//
// La chiamata dei volontari e la disponibilità (src/chiamate.js): chi può
// chiamare, chi resta fuori (in squadra, assente), le risposte dal telefono,
// chi va chiamato a voce, l'arrivo in sede e il congedo, la presenza di chi
// è arrivato anche senza entrare in squadra; poi reperibilità e assenze, nel
// calendario, e la chiamata per un'attività di allertamento.
//
// Apre e chiude un'emergenza sua (se non ce n'è una aperta) e toglie quello
// che crea. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/chiamate.mjs

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
const giorno = (giorni = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(Date.now() + giorni * 86400000));

console.log('\nChiamata e disponibilità');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const persone = [];
const squadre = [];
const attivita = [];
let emergenza = null;
async function nuovo(nome, ruoli = ['volontario']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `${nome}${suffisso}`, cognome: 'Chiamata', ruoli } })).corpo;
    persone.push(n.id);
    const q = new URL(n.magicLink).searchParams;
    const password = `${nome}!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    return { id: n.id, username: n.username, token: (await accediConFetch(BASE, n.username, password)).token };
}

try {
    const coord = await nuovo('Coord', ['volontario', 'coordinatore']);
    const a = await nuovo('Anna');
    const b = await nuovo('Bruno');
    const c = await nuovo('Carla');
    const d = await nuovo('Dario');
    const est = await nuovo('Est', ['esterno']);

    // Assenze e reperibilità, prima dell'emergenza.
    const assenza = await chiama('/api/assenze', { method: 'POST', token: d.token, body: { dal: giorno(0), al: giorno(3), nota: 'ferie' } });
    verifica('un volontario dichiara la sua assenza', assenza.stato === 201, assenza);
    verifica('e la ritrova fra le sue', ((await chiama('/api/assenze/mie', { token: d.token })).corpo || []).some(x => x.id === assenza.corpo?.id));
    verifica('un periodo già passato -> 400', (await chiama('/api/assenze', { method: 'POST', token: d.token, body: { dal: giorno(-5), al: giorno(-2) } })).stato === 400);
    verifica("un volontario non vede le assenze di tutti -> 403", (await chiama('/api/assenze', { token: a.token })).stato === 403);
    verifica('il coordinatore sì', ((await chiama(`/api/assenze?da=${giorno(0)}&a=${giorno(1)}`, { token: coord.token })).corpo || []).some(x => x.user_id === d.id));
    verifica('un esterno non dichiara assenze -> 403', (await chiama('/api/assenze', { method: 'POST', token: est.token, body: { dal: giorno(0), al: giorno(1) } })).stato === 403);

    verifica('un volontario non decide i turni -> 403',
        (await chiama('/api/reperibilita', { method: 'POST', token: a.token, body: { dal: giorno(0), al: giorno(6), persone: [a.id] } })).stato === 403);
    const turno = await chiama('/api/reperibilita', { method: 'POST', token: coord.token, body: { dal: giorno(0), al: giorno(6), persone: [b.id, c.id], nota: 'settimana 1' } });
    verifica('il coordinatore mette di turno due persone', turno.stato === 201 && turno.corpo?.aggiunti === 2, turno);
    const turniB = (await chiama(`/api/reperibilita?da=${giorno(0)}&a=${giorno(6)}`, { token: b.token })).corpo || [];
    verifica('chi è di turno vede solo il suo', turniB.length >= 1 && turniB.every(t => t.user_id === b.id), turniB);
    const cal = (await chiama(`/api/calendario?da=${giorno(0)}&a=${giorno(6)}`, { token: b.token })).corpo;
    verifica('nel calendario la reperibilità di ogni giorno', (cal?.turni || []).filter(t => t.categoria === 'reperibili' && t.voci.some(v => v.mio)).length === 7, cal?.turni);
    const calCoord = (await chiama(`/api/calendario?da=${giorno(0)}&a=${giorno(0)}`, { token: coord.token })).corpo;
    verifica('chi organizza vede reperibili e assenti di tutti', calCoord?.turni?.some(t => t.categoria === 'reperibili' && t.conteggio >= 2) && calCoord?.turni?.some(t => t.categoria === 'assenti' && t.voci.some(v => v.user_id === d.id)), calCoord?.turni);

    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (stato?.active) {
        console.log("  (un'emergenza era già aperta: la chiamata in emergenza non si prova)");
    } else {
        verifica('senza emergenza non si chiama -> 409', (await chiama('/api/chiamate', { method: 'POST', token: coord.token, body: { criterio: 'tutti' } })).stato === 409);
        emergenza = (await chiama('/api/emergencies/open', { method: 'POST', token: coord.token, body: { external_code: `CHI-${suffisso}`, name: 'Prova chiamata' } })).corpo?.emergency?.id;
        verifica("l'emergenza si apre", !!emergenza);

        // Anna è già in squadra: non si chiama.
        const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
        const radio = ['Zulu', 'Yankee', 'Whiskey', 'Victor', 'Uniform', 'Tango'].find(x => !usati.has(x));
        const sq = await chiama('/api/squadre', { method: 'POST', token: coord.token, body: { nome_radio: radio, nome: 'Campo', membri: [{ username: a.username }] } });
        if (sq.corpo?.squadraId) squadre.push(sq.corpo.squadraId);

        verifica('un volontario non chiama -> 403', (await chiama('/api/chiamate', { method: 'POST', token: b.token, body: { criterio: 'tutti' } })).stato === 403);
        verifica('un esterno non chiama -> 403', (await chiama('/api/chiamate', { method: 'POST', token: est.token, body: { criterio: 'tutti' } })).stato === 403);
        const cand = (await chiama('/api/chiamate/candidati', { token: coord.token })).corpo?.persone || [];
        const cB = cand.find(p => p.id === b.id), cD = cand.find(p => p.id === d.id), cA = cand.find(p => p.id === a.id);
        verifica('fra i candidati: reperibili, assenti e chi è in squadra', cB?.reperibile && cD?.assente && cA?.squadra === radio, { cB, cD, cA });
        verifica('gli esterni non sono candidati', !cand.some(p => p.id === est.id));

        const nessuno = await chiama('/api/chiamate', { method: 'POST', token: coord.token, body: { criterio: 'scelti', persone: [a.id], avviso_app: true } });
        verifica('chi è già in squadra non si chiama -> 400', nessuno.stato === 400 && nessuno.corpo?.saltati?.in_squadra === 1, nessuno);
        verifica('senza nessun modo di avviso -> 400', (await chiama('/api/chiamate', { method: 'POST', token: coord.token, body: { criterio: 'tutti', avviso_app: false } })).stato === 400);

        const rep = await chiama('/api/chiamate', { method: 'POST', token: coord.token, body: { criterio: 'reperibili', messaggio: 'Allagamenti in via Roma, servono braccia', minuti_attesa: 1 } });
        verifica('chiamati i reperibili', rep.stato === 201 && rep.corpo?.chiamati === 2, rep);
        verifica('senza app né email sono da chiamare a voce', rep.corpo?.irraggiungibili?.length === 2, rep.corpo?.irraggiungibili);
        const idRep = rep.corpo?.chiamata?.id;
        let avviso = null;
        for (let i = 0; i < 20 && !avviso; i++) {
            await attesa(150);
            avviso = ((await chiama('/api/notifiche', { token: b.token })).corpo?.notifiche || []).find(n => n.tipo === 'chiamata' && n.riferimento_id === idRep);
        }
        verifica("la chiamata arriva nell'app, fra quelle dell'emergenza", avviso?.categoria === 'emergenza' && /Chiamata/.test(avviso?.titolo || ''), avviso);
        verifica('chi non è chiamato non la vede -> 404', (await chiama(`/api/chiamate/${idRep}`, { token: a.token })).stato === 404);
        const vista = (await chiama(`/api/chiamate/${idRep}`, { token: b.token })).corpo;
        verifica('chi è chiamato la legge', vista?.aperta === true && vista?.stato === 'senza_risposta' && /via Roma/.test(vista?.messaggio || ''), vista);
        verifica('è fra le sue chiamate aperte', ((await chiama('/api/chiamate/mie', { token: b.token })).corpo || []).some(x => x.id === idRep));

        const tutti = await chiama('/api/chiamate', { method: 'POST', token: coord.token, body: { criterio: 'scelti', persone: [d.id], avviso_app: true } });
        verifica("chi è scelto a mano si chiama anche se assente", tutti.stato === 201 && tutti.corpo?.chiamati === 1, tutti);
        const tutti2 = await chiama('/api/chiamate', { method: 'POST', token: coord.token, body: { criterio: 'tutti' } });
        const saltati = tutti2.corpo?.saltati || {};
        verifica('con "tutti" restano fuori chi è in squadra e chi è già chiamato non risponde ancora', tutti2.stato === 201 && saltati.in_squadra >= 1, tutti2.corpo);

        verifica('una risposta sbagliata -> 400', (await chiama(`/api/chiamate/${idRep}/risposta`, { method: 'POST', token: b.token, body: { risposta: 'forse' } })).stato === 400);
        verifica('il ritardo vuole i minuti -> 400', (await chiama(`/api/chiamate/${idRep}/risposta`, { method: 'POST', token: c.token, body: { risposta: 'ritardo' } })).stato === 400);
        const rb = await chiama(`/api/chiamate/${idRep}/risposta`, { method: 'POST', token: b.token, body: { risposta: 'arrivo' } });
        verifica('Bruno: arrivo', rb.stato === 200 && rb.corpo?.stato === 'in_arrivo', rb);
        const rc = await chiama(`/api/chiamate/${idRep}/risposta`, { method: 'POST', token: c.token, body: { risposta: 'ritardo', minuti: 60, nota: 'esco dal lavoro' } });
        verifica("Carla: arrivo fra un'ora", rc.stato === 200 && rc.corpo?.stato === 'in_arrivo' && !!rc.corpo?.arrivo_previsto, rc);
        const rd = await chiama(`/api/chiamate/${tutti.corpo?.chiamata?.id}/risposta`, { method: 'POST', token: d.token, body: { risposta: 'no' } });
        verifica('Dario: non posso', rd.corpo?.stato === 'non_disponibile', rd);
        const notifB = (await chiama('/api/notifiche', { token: b.token })).corpo?.notifiche || [];
        verifica('la notifica scade con la risposta', !notifB.some(n => n.tipo === 'chiamata' && n.riferimento_id === idRep));
        verifica('chi non è chiamato non risponde -> 404', (await chiama(`/api/chiamate/${idRep}/risposta`, { method: 'POST', token: a.token, body: { risposta: 'arrivo' } })).stato === 404);

        verifica('un esterno non vede le disponibilità -> 403', (await chiama('/api/disponibilita', { token: est.token })).stato === 403);
        let quadro = (await chiama('/api/disponibilita', { token: b.token })).corpo;
        verifica('la sala vede chi arriva e chi no', quadro?.conteggi?.in_arrivo === 2 && quadro?.conteggi?.non_disponibili === 1, quadro?.conteggi);
        verifica('un volontario della sala non può chiamare', quadro?.puo_chiamare === false);

        verifica('Bruno arriva in sede da sé', (await chiama('/api/disponibilita/arrivato', { method: 'POST', token: b.token, body: {} })).corpo?.stato === 'arrivato');
        verifica('chi non è chiamato non si segna da sé -> 403', (await chiama('/api/disponibilita/arrivato', { method: 'POST', token: a.token, body: {} })).stato === 403);
        const walkin = await chiama(`/api/disponibilita/${a.id}`, { method: 'PUT', token: b.token, body: { stato: 'arrivato' } });
        verifica('la sala segna arrivato anche chi viene senza chiamata', walkin.stato === 200 && walkin.corpo?.stato === 'arrivato', walkin);
        verifica('un esterno non ha disponibilità -> 400', (await chiama(`/api/disponibilita/${est.id}`, { method: 'PUT', token: coord.token, body: { stato: 'arrivato' } })).stato === 400);
        verifica('si congeda solo chi è in sede -> 409', (await chiama(`/api/disponibilita/${c.id}`, { method: 'PUT', token: coord.token, body: { stato: 'congedato' } })).stato === 409);
        quadro = (await chiama('/api/disponibilita', { token: coord.token })).corpo;
        const qa = quadro?.persone?.find(p => p.id === a.id), qb = quadro?.persone?.find(p => p.id === b.id);
        verifica('in sede Bruno senza squadra; Anna in squadra', quadro?.conteggi?.in_sede === 1 && qa?.squadra === radio && qb?.stato === 'arrivato', quadro?.conteggi);

        // Chi non risponde passa fra quelli da chiamare (attesa di un minuto, ma
        // senza app né email lo è subito).
        const senza = quadro?.persone?.filter(p => p.stato === 'senza_risposta') || [];
        verifica('chi non risponde ed è irraggiungibile è da chiamare', senza.length > 0 && senza.every(p => p.da_chiamare), senza.map(p => [p.id, p.da_chiamare]));
        const ri = await chiama(`/api/chiamate/${idRep}/richiama`, { method: 'POST', token: coord.token, body: {} });
        verifica('quando hanno risposto tutti non si richiama -> 409', ri.stato === 409, ri);

        // Carla arriva e poi viene congedata.
        await chiama(`/api/disponibilita/${c.id}`, { method: 'PUT', token: coord.token, body: { stato: 'arrivato' } });
        await attesa(1200);
        const cong = await chiama(`/api/disponibilita/${c.id}`, { method: 'PUT', token: coord.token, body: { stato: 'congedato' } });
        verifica('Carla congedata', cong.corpo?.stato === 'congedato' && !!cong.corpo?.congedato_il, cong);

        await attesa(1200);
        await chiama('/api/emergencies/close', { method: 'POST', token: coord.token, body: {} });
        const chiusa = emergenza;
        emergenza = null;
        await attesa(1500);
        verifica('a emergenza chiusa non si risponde più -> 409', (await chiama(`/api/chiamate/${idRep}/risposta`, { method: 'POST', token: b.token, body: { risposta: 'no' } })).stato === 409);
        verifica('e non è più fra le chiamate aperte', !((await chiama('/api/chiamate/mie', { token: b.token })).corpo || []).some(x => x.id === idRep));
        const pres = (await chiama(`/api/emergencies/${chiusa}/presenze`, { token: coord.token })).corpo || [];
        const pb = pres.find(p => p.user_id === b.id), pc = pres.find(p => p.user_id === c.id), pd = pres.find(p => p.user_id === d.id);
        verifica('Bruno, in sede senza squadra, risulta presente', !!pb && /in sede/.test(pb.dettaglio || ''), pres);
        verifica('Carla presente fino al congedo', !!pc && new Date(pc.fine) < new Date(pb?.fine || 0), { pc, pb });
        verifica('Dario, che non è venuto, no', !pd);
        const pa = pres.find(p => p.user_id === a.id);
        verifica("Anna, in squadra e segnata in sede, conta una volta", !!pa && /Squadre:/.test(pa.dettaglio || ''), pa);
    }

    // Allertamento per un'attività: la chiamata senza sala.
    const tipi = (await chiama('/api/attivita/tipi', { token: coord.token })).corpo || [];
    const att = await chiama('/api/attivita', { method: 'POST', token: coord.token, body: { tipo_id: tipi[0]?.id, titolo: `Allertamento ${suffisso}`, inizio: fra(-0.5), fine: fra(2), convocazione: 'tutti', avviso_app: false } });
    if (att.corpo?.id) attivita.push(att.corpo.id);
    const ch = await chiama('/api/chiamate', { method: 'POST', token: coord.token, body: { attivita_id: att.corpo?.id, criterio: 'scelti', persone: [b.id, c.id] } });
    verifica("la chiamata per un'attività", ch.stato === 201 && ch.corpo?.chiamati === 2, ch);
    const rispA = await chiama(`/api/chiamate/${ch.corpo?.chiamata?.id}/risposta`, { method: 'POST', token: b.token, body: { risposta: 'arrivo' } });
    verifica('si risponde come in emergenza', rispA.corpo?.stato === 'in_arrivo', rispA);
    verifica("un volontario non vede le risposte dell'attività -> 403", (await chiama(`/api/disponibilita?attivita_id=${att.corpo?.id}`, { token: c.token })).stato === 403);
    const qAtt = (await chiama(`/api/disponibilita?attivita_id=${att.corpo?.id}`, { token: coord.token })).corpo;
    verifica('chi la organizza sì', qAtt?.contesto?.tipo === 'attivita' && qAtt?.conteggi?.in_arrivo === 1, qAtt?.conteggi);

    verifica('chi ha dichiarato l\'assenza la toglie', (await chiama(`/api/assenze/${assenza.corpo?.id}`, { method: 'DELETE', token: d.token })).stato === 204);
    verifica('non quella degli altri -> 404', (await chiama(`/api/reperibilita/0`, { method: 'DELETE', token: coord.token })).stato === 404);
} finally {
    if (emergenza) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    for (const s of squadre) await chiama(`/api/squadre/${s}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    for (const p of persone.reverse()) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    for (const id of attivita) await chiama(`/api/attivita/${id}`, { method: 'DELETE', token: admin });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
