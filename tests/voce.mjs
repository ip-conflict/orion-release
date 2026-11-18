// Orion Voice: canali, parola, precedenza della sala, inoltro in diretta, archivio, diario,
// conferme, messaggi differiti e ripresi dopo una caduta di rete, un telefono per persona.
// Tre persone nuove: un caposquadra e un volontario in una squadra di prova, e un operatore
// messo nella squadra COC. I telefoni parlano con pacchetti Opus finti, il server non li decodifica.
//
// Serve un'emergenza aperta; accende la voce e poi la rimette com'era. Crea ed elimina
// persone e squadra: va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/voce.mjs

import 'dotenv/config';
import crypto from 'crypto';
import pg from 'pg';
import WebSocket from 'ws';
import { accediConFetch, prendiVisione, PASSWORD_PROVA } from './accesso-prova.mjs';
import { leggiOggOpus } from '../src/voceOgg.js';

const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const WS = BASE.replace(/^http/, 'ws') + '/voce';
const attesa = ms => new Promise(r => setTimeout(r, ms));
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
    return { stato: r.status, corpo: tipo.includes('json') ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer()) };
};

// SILK a banda larga, 60 ms, una trama: quello che manda il telefono.
const pacchettoFinto = () => Buffer.concat([Buffer.from([11 << 3]), crypto.randomBytes(110)]);
const conSeq = (seq, p) => Buffer.concat([Buffer.from([seq >> 8, seq & 0xff]), p]);

function collega(intestazioni) {
    const ws = new WebSocket(WS, { headers: intestazioni });
    const ricevuti = [];
    const binari = [];
    const attese = [];
    ws.on('message', (dati, binario) => {
        if (binario) return binari.push(dati);
        const m = JSON.parse(dati.toString());
        ricevuti.push(m);
        for (const a of [...attese]) if (a.filtro(m)) { attese.splice(attese.indexOf(a), 1); a.ok(m); }
    });
    const persona = {
        ws, ricevuti, binari,
        manda: (c) => ws.send(JSON.stringify(c)),
        aspetta: (filtro, ms = 5000) => {
            const gia = ricevuti.find(filtro);
            if (gia) return Promise.resolve(gia);
            return new Promise((ok) => {
                const a = { filtro, ok };
                attese.push(a);
                setTimeout(() => { if (attese.includes(a)) { attese.splice(attese.indexOf(a), 1); ok(null); } }, ms);
            });
        },
        svuota: () => { ricevuti.length = 0; binari.length = 0; }
    };
    return new Promise((ok, ko) => {
        ws.on('open', () => ok(persona));
        ws.on('unexpected-response', (req, res) => ko(new Error(`HTTP ${res.statusCode}`)));
        ws.on('error', ko);
    });
}

async function parla(chi, canale, n, extra = {}) {
    const uuid = crypto.randomUUID();
    chi.manda({ t: 'parla', uuid, canale, ...extra });
    const r = await chi.aspetta(m => m.uuid === uuid && ['parla_ok', 'occupato', 'negato'].includes(m.t));
    if (r?.t !== 'parla_ok') return { uuid, risposta: r };
    for (let i = 0; i < n; i++) chi.ws.send(conSeq(i, pacchettoFinto()));
    return { uuid, risposta: r, id: r.id };
}
async function finisci(chi, uuid, pacchetti) {
    chi.manda({ t: 'fine', uuid, pacchetti });
    return chi.aspetta(m => m.uuid === uuid && ['salvato', 'annullato', 'manca'].includes(m.t));
}

console.log('\nOrion Voice');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
if (!(await chiama('/api/emergencies/status', { token: admin })).corpo?.active) { console.error('Serve un\'emergenza aperta.'); process.exit(2); }
const impostazioni = (await chiama('/api/branding/settings', { token: admin })).corpo || {};
const voceDiPrima = impostazioni.voce_enabled ?? 'false';

const suffisso = Date.now().toString().slice(-5);
const persone = [];
let squadraId = null;
let cocId = null;
let membriCoc = [];
let segnalazione = null;
const aperti = [];

try {
    for (const nome of ['Anna', 'Bruno', 'Carla']) {
        const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome, cognome: `Voce${suffisso}`, role: 'volontario' } })).corpo;
        const q = new URL(n.magicLink).searchParams;
        const password = PASSWORD_PROVA;
        await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
        const token = (await chiama('/login', { method: 'POST', body: { username: n.username, password } })).corpo.token;
        await prendiVisione(BASE, token);
        persone.push({ id: n.id, username: n.username, nome, token });
    }
    const [anna, bruno, carla] = persone;

    const squadre = (await chiama('/api/squadre', { token: admin })).corpo || [];
    let nomeRadio = null;
    // Un nome radio sciolto durante l'emergenza non si riusa fino alla chiusura: se ne prova un altro.
    for (const n of ['Zulu', 'Yankee', 'X-ray', 'Whiskey', 'Victor', 'Uniform', 'Tango', 'Sierra', 'Romeo', 'Quebec', 'Papa', 'Oscar']) {
        const r = await chiama('/api/squadre', { method: 'POST', token: admin, body: {
            nome_radio: n, nome: 'Prova voce', caposquadra: anna.username, membri: [{ username: anna.username }, { username: bruno.username }]
        } });
        if (r.stato === 201) { squadraId = r.corpo.squadraId; nomeRadio = n; break; }
    }
    const coc = squadre.find(s => s.coc);
    if (!coc) throw new Error('Manca la squadra COC dell\'emergenza: riapri l\'emergenza, la crea l\'apertura.');
    cocId = coc?.id;
    membriCoc = (coc?.membri || []).map(m => ({ username: m.username }));
    const r0 = await chiama(`/api/squadre/${cocId}`, { method: 'PUT', token: admin, body: { nome_radio: coc.nome_radio, nome: coc.nome, membri: [...membriCoc, { username: carla.username }] } });
    if (!squadraId || r0.stato !== 200) throw new Error(`Preparazione delle squadre non riuscita: ${JSON.stringify(r0)}`);
    segnalazione = (await chiama('/api/reports', { method: 'POST', token: admin, body: { title: 'Collaudo voce', reporter_name: 'Collaudo', reporter_contact: '000', priority: 'Low' } })).corpo?.id;
    await chiama(`/api/reports/${segnalazione}/teams`, { method: 'POST', token: admin, body: { teamId: squadraId } });
    const canaleSquadra = `squadra:${squadraId}`;

    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { voce_enabled: 'false' } });
    await attesa(5500);
    const statoSpento = await chiama('/api/voce/stato', { token: bruno.token });
    verifica('a voce spenta lo stato risponde senza errore e dice che è spenta', statoSpento.stato === 200 && statoSpento.corpo?.modulo_spento === true && statoSpento.corpo?.attiva === false);
    verifica('e le altre rotte rispondono 404', (await chiama('/api/voce/token', { method: 'POST', token: bruno.token, body: {} })).stato === 404);
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { voce_enabled: 'true' } });
    await attesa(5500);

    const stato = async (chi) => (await chiama('/api/voce/stato', { token: chi.token })).corpo;
    const sB = await stato(bruno), sA = await stato(anna), sC = await stato(carla);
    const ids = s => (s?.canali || []).map(c => `${c.id}${c.parla ? '+' : ''}`).sort().join(' ');
    verifica('il volontario parla sulla sua squadra, sente avvisi e generale', ids(sB) === `avvisi generale ${canaleSquadra}+`, ids(sB));
    verifica('il caposquadra ha anche il generale', ids(sA) === `avvisi generale+ ${canaleSquadra}+`, ids(sA));
    verifica('la sala parla su tutto', sC?.canali?.some(c => c.id === canaleSquadra && c.parla) && sC.canali.some(c => c.id === 'avvisi' && c.parla) && sC.ruolo?.sala === true, ids(sC));
    const contesto = (await chiama('/api/app/contesto', { token: bruno.token })).corpo;
    verifica('il contesto dell\'app annuncia la voce', contesto?.moduli?.voce === true && contesto.capacita.includes('voce'), contesto?.capacita);

    const tokenVoce = async (chi) => (await chiama('/api/voce/token', { method: 'POST', token: chi.token, body: { dispositivo: 'collaudo' } })).corpo?.voce;
    const tB = await tokenVoce(bruno), tA = await tokenVoce(anna);
    verifica('il telefono riceve il suo token voce', typeof tB === 'string' && tB.length > 20);
    verifica('il token voce non vale come sessione', [401, 403].includes((await chiama('/api/voce/stato', { token: tB })).stato));

    const B = await collega({ Authorization: `Voce ${tB}` });
    const A = await collega({ Authorization: `Voce ${tA}` });
    const C = await collega({ Authorization: `Bearer ${carla.token}` });
    aperti.push(A, B, C);
    verifica('collegandosi arriva lo stato con i canali', (await B.aspetta(m => m.t === 'stato'))?.canali?.length === 3);
    let rifiutato = null;
    try { await collega({ Authorization: 'Voce sbagliato' }); } catch (e) { rifiutato = e.message; }
    verifica('un token voce sbagliato non entra', rifiutato === 'HTTP 401', rifiutato);

    const m1 = await parla(B, canaleSquadra, 20);
    verifica('canale libero: Bruno ha la parola', m1.risposta?.t === 'parla_ok', m1.risposta);
    verifica('Anna sente l\'inizio, con chi parla', (await A.aspetta(m => m.t === 'inizio'))?.messaggio?.autore?.nome?.startsWith('Bruno'));
    verifica('Anna vede chi ha la parola', (await A.aspetta(m => m.t === 'parola' && m.da))?.da?.nome?.startsWith('Bruno'));
    const occupato = await parla(A, canaleSquadra, 0);
    verifica('canale occupato: Anna sente chi parla, non parte nulla', occupato.risposta?.t === 'occupato' && occupato.risposta.da?.nome?.startsWith('Bruno'), occupato.risposta);
    await attesa(300);
    verifica('i pacchetti arrivano in diretta a squadra e sala', A.binari.length === 20 && C.binari.length === 20, `${A.binari.length} / ${C.binari.length}`);
    verifica('ogni pacchetto porta il numero del messaggio', A.binari[0]?.readUInt32BE(0) === m1.id);
    const s1 = await finisci(B, m1.uuid, 20);
    verifica('al rilascio il messaggio è salvato', s1?.t === 'salvato' && s1.id === m1.id, s1);
    verifica('chi ascolta riceve la fine', !!(await A.aspetta(m => m.t === 'fine' && m.id === m1.id)));

    const audio = await chiama(`/api/voce/messaggi/${m1.id}/audio`, { token: anna.token });
    let pacchettiLetti = -1;
    try { pacchettiLetti = leggiOggOpus(audio.corpo).pacchetti.length; } catch { /* resta -1 */ }
    verifica('il file è un Ogg Opus con tutti i pacchetti', audio.stato === 200 && pacchettiLetti === 20, `${audio.stato} ${pacchettiLetti}`);
    const elenco = (await chiama(`/api/voce/messaggi?canale=${canaleSquadra}`, { token: anna.token })).corpo?.messaggi || [];
    verifica('la cronologia ha il messaggio, con la durata', elenco.some(m => m.id === m1.id && m.durata_ms === 1200), elenco.map(m => m.durata_ms));
    await attesa(300);
    const nota = (await pool.query('SELECT update_text FROM report_updates WHERE report_id = $1 AND voce_id = $2', [segnalazione, m1.id])).rows[0];
    verifica('il messaggio entra nel diario della segnalazione della squadra', /^Messaggio vocale da \S+, 1 s$/.test(nota?.update_text || ''), nota);

    C.manda({ t: 'ascoltato', id: m1.id, in_diretta: true });
    verifica('la sala lo riproduce: Bruno vede "riprodotto in sala"', !!(await B.aspetta(m => m.t === 'riprodotto' && m.id === m1.id)));
    C.manda({ t: 'ricevuto', id: m1.id });
    verifica('la sala conferma: Bruno vede chi ha ricevuto', (await B.aspetta(m => m.t === 'ricevuto' && m.id === m1.id))?.da?.startsWith('Carla'));
    A.manda({ t: 'ricevuto', id: m1.id });
    await attesa(300);
    verifica('la conferma esplicita la dà solo la sala', B.ricevuti.filter(m => m.t === 'ricevuto').length === 1);

    B.svuota(); A.svuota();
    const m2 = await parla(B, canaleSquadra, 10);
    await A.aspetta(m => m.t === 'inizio');
    const sala = await parla(C, canaleSquadra, 10);
    verifica('la sala prende la parola anche con il canale occupato', sala.risposta?.t === 'parla_ok', sala.risposta);
    verifica('Bruno sente l\'interruzione', !!(await B.aspetta(m => m.t === 'interrotto' && m.uuid === m2.uuid)));
    verifica('il messaggio interrotto resta salvato', (await B.aspetta(m => m.t === 'salvato' && m.uuid === m2.uuid))?.stato === 'interrotto');
    await finisci(C, sala.uuid, 10);

    const breve = await parla(B, canaleSquadra, 5);
    verifica('sotto il mezzo secondo non parte nulla', (await finisci(B, breve.uuid, 5))?.t === 'annullato');

    verifica('il volontario non parla sul generale', (await parla(B, 'generale', 0)).risposta?.t === 'negato');
    verifica('nemmeno con un\'emergenza: arriverebbe a tutti', (await parla(B, 'generale', 0, { priorita: 'emergenza' })).risposta?.t === 'negato');
    B.svuota();
    const generale = await parla(A, 'generale', 10);
    verifica('il caposquadra parla sul generale e il volontario lo sente', (await B.aspetta(m => m.t === 'inizio' && m.messaggio.canale === 'generale'))?.messaggio?.id === generale.id);
    await finisci(A, generale.uuid, 10);
    verifica('il volontario non manda avvisi a tutti', (await parla(B, 'avvisi', 0, { priorita: 'alta' })).risposta?.t === 'negato');
    verifica('la priorità alta non è per il volontario', (await parla(B, canaleSquadra, 0, { priorita: 'alta' })).risposta?.t === 'negato');

    B.svuota();
    const avviso = await parla(C, 'avvisi', 10);
    verifica('la sala manda un avviso a tutti, in priorità alta', (await B.aspetta(m => m.t === 'inizio' && m.messaggio.canale === 'avvisi'))?.messaggio?.priorita === 'alta');
    await finisci(C, avviso.uuid, 10);
    await attesa(500);
    const eventi = await pool.query("SELECT 1 FROM diario_sala WHERE autore_id = $1 AND testo LIKE 'Avviso vocale a tutti%'", [carla.id]);
    verifica('l\'avviso entra nel diario di sala', eventi.rowCount === 1, eventi.rowCount);

    A.svuota();
    const diff = await parla(B, canaleSquadra, 12, { differito: true, eta_ms: 180000 });
    verifica('un messaggio registrato senza rete non chiede la parola', diff.risposta?.t === 'parla_ok');
    await finisci(B, diff.uuid, 12);
    const arrivato = await A.aspetta(m => m.t === 'messaggio' && m.messaggio.uuid === diff.uuid);
    const ritardo = arrivato ? Date.now() - new Date(arrivato.messaggio.registrato_il).getTime() : 0;
    verifica('chi ascolta lo riceve segnato come differito, con l\'ora vera', arrivato?.messaggio?.differito === true && ritardo > 170000 && ritardo < 200000, ritardo);
    verifica('i differiti non arrivano a pezzi in diretta', A.binari.length === 0, A.binari.length);

    A.svuota();
    const rotto = await parla(B, canaleSquadra, 8);
    await A.aspetta(m => m.t === 'inizio');
    B.ws.terminate();
    verifica('la rete cade a metà: chi ascolta sa che arriverà in ritardo', (await A.aspetta(m => m.t === 'fine' && m.stato === 'in_ritardo'))?.id === rotto.id);
    const libero = await parla(A, canaleSquadra, 0);
    verifica('e il canale torna libero', libero.risposta?.t === 'parla_ok', libero.risposta);
    A.manda({ t: 'annulla', uuid: libero.uuid });
    const B2 = await collega({ Authorization: `Voce ${tB}` });
    aperti.push(B2);
    B2.manda({ t: 'parla', uuid: rotto.uuid, canale: canaleSquadra });
    const ripresa = await B2.aspetta(m => m.uuid === rotto.uuid && m.t === 'parla_ok');
    verifica('al ritorno il server dice da dove riprendere', ripresa?.ricevuti === 8, ripresa);
    for (let i = 8; i < 20; i++) B2.ws.send(conSeq(i, pacchettoFinto()));
    await finisci(B2, rotto.uuid, 20);
    const intero = await A.aspetta(m => m.t === 'messaggio' && m.messaggio.uuid === rotto.uuid);
    verifica('il messaggio arriva intero', intero?.messaggio?.durata_ms === 1200, intero?.messaggio);

    A.svuota();
    const muto = await parla(B2, canaleSquadra, 3);
    verifica('un telefono che smette di mandare audio senza chiudere lascia il canale dopo pochi secondi',
        !!(await A.aspetta(m => m.t === 'fine' && m.id === muto.id && m.stato === 'in_ritardo', 12000)));
    const dopoIlMuto = await parla(A, canaleSquadra, 0);
    verifica('e la squadra torna a parlare', dopoIlMuto.risposta?.t === 'parla_ok', dopoIlMuto.risposta);
    A.manda({ t: 'annulla', uuid: dopoIlMuto.uuid });
    for (let i = 3; i < 12; i++) B2.ws.send(conSeq(i, pacchettoFinto()));
    await finisci(B2, muto.uuid, 12);
    const completato = await A.aspetta(m => m.t === 'messaggio' && m.messaggio.uuid === muto.uuid);
    verifica('quando il telefono torna il messaggio arriva intero, dopo', completato?.messaggio?.durata_ms === 720, completato?.messaggio);
    A.svuota();
    const ripensato = await parla(B2, canaleSquadra, 3);
    await A.aspetta(m => m.t === 'fine' && m.id === ripensato.id && m.stato === 'in_ritardo', 12000);
    B2.manda({ t: 'annulla', uuid: ripensato.uuid });
    verifica('annullato dopo aver perso la diretta, chi aveva sentito l\'inizio lo toglie', !!(await A.aspetta(m => m.t === 'annullato' && m.id === ripensato.id)));

    const B3 = await collega({ Authorization: `Voce ${tB}` });
    aperti.push(B3);
    verifica('un secondo telefono butta fuori il primo, con un avviso', (await B2.aspetta(m => m.t === 'chiuso'))?.motivo === 'altro_telefono');
    const Cweb2 = await collega({ Authorization: `Bearer ${carla.token}` });
    aperti.push(Cweb2);
    await attesa(300);
    verifica('le postazioni web non si buttano fuori a vicenda', C.ws.readyState === 1);

    const prova = await parla(B3, 'prova', 15);
    await finisci(B3, prova.uuid, 15);
    verifica('Prova voce: il server rimanda indietro la registrazione', !!(await B3.aspetta(m => m.t === 'eco_fine', 4000)) && B3.binari.length === 15, B3.binari.length);

    verifica('la sala vede quanti telefoni della squadra ascoltano', (await C.aspetta(m => m.t === 'presenze' && m.canali[canaleSquadra]?.in_ascolto === 2, 5000))?.canali?.[canaleSquadra]?.membri === 2);

    const diretto = await chiama('/api/voce/diretti', { method: 'POST', token: carla.token, body: { user_id: bruno.id } });
    verifica('la sala apre un canale diretto con una persona', diretto.stato === 201);
    verifica('la persona lo vede comparire', !!(await B3.aspetta(m => m.t === 'canali' && m.canali.some(c => c.id === `diretto:${bruno.id}` && c.parla), 6000)));
    verifica('il volontario non apre canali diretti', (await chiama('/api/voce/diretti', { method: 'POST', token: bruno.token, body: { user_id: anna.id } })).stato === 403);

    C.manda({ t: 'cuffie', canali: [canaleSquadra, 'avvisi'] });
    verifica('la sala dice quali canali ascolta: le postazioni si contano', !!(await C.aspetta(m => m.t === 'presenze' && m.canali[canaleSquadra]?.postazioni === 1 && m.canali.generale?.postazioni === 0, 5000)));

    C.svuota();
    const sos = await parla(B3, canaleSquadra, 10, { priorita: 'emergenza', posizione: { lat: 46.1, lon: 12.2 } });
    verifica('il volontario può mandare un messaggio di emergenza', sos.risposta?.t === 'parla_ok', sos.risposta);
    verifica('la sala lo sente in priorità emergenza', (await C.aspetta(m => m.t === 'inizio' && m.messaggio.uuid === sos.uuid))?.messaggio?.priorita === 'emergenza');
    await finisci(B3, sos.uuid, 10);
    const aperte = (await chiama('/api/voce/emergenze', { token: carla.token })).corpo?.emergenze || [];
    verifica('la sala ritrova le emergenze non prese in carico, con la posizione', aperte.some(e => e.id === sos.id && e.posizione?.lat === 46.1), aperte);
    const presa = await chiama(`/api/voce/messaggi/${sos.id}/presa-in-carico`, { method: 'POST', token: carla.token });
    verifica('la sala la prende in carico', presa.stato === 200);
    verifica('chi l\'ha mandata sa che la sala l\'ha presa', (await B3.aspetta(m => m.t === 'presa_in_carico' && m.uuid === sos.uuid))?.da?.startsWith('Carla'));
    verifica('una seconda presa in carico non passa', (await chiama(`/api/voce/messaggi/${sos.id}/presa-in-carico`, { method: 'POST', token: carla.token })).stato === 409);
    verifica('la presa in carico entra nel diario di sala', (await pool.query("SELECT 1 FROM diario_sala WHERE testo LIKE '%prende in carico l''emergenza vocale%' AND autore_id = $1", [carla.id])).rowCount === 1);

    const altra = (await chiama('/api/reports', { method: 'POST', token: admin, body: { title: 'Collaudo voce 2', reporter_name: 'Collaudo', reporter_contact: '000', priority: 'Low' } })).corpo?.id;
    const sposta = await chiama(`/api/voce/messaggi/${m1.id}/segnalazione`, { method: 'POST', token: carla.token, body: { report_id: altra } });
    verifica('la sala sposta un messaggio su un\'altra segnalazione', sposta.stato === 200, sposta);
    const tracce = (await pool.query('SELECT report_id, voce_id, update_text FROM report_updates WHERE report_id = ANY($1::int[]) AND update_text LIKE $2', [[segnalazione, altra], '%spostato%'])).rows;
    verifica('e lo spostamento resta scritto in tutte e due', tracce.length === 2 && tracce.some(t => t.report_id === altra && t.voce_id === m1.id), tracce);
    verifica('il volontario non sposta messaggi', (await chiama(`/api/voce/messaggi/${m1.id}/segnalazione`, { method: 'POST', token: bruno.token, body: { report_id: segnalazione } })).stato === 403);
    await chiama(`/api/reports/${altra}`, { method: 'DELETE', token: admin }).catch(() => {});

    const numeri = (await chiama('/api/voce/statistiche', { token: admin })).corpo;
    verifica('la pagina Sistema ha i numeri della voce', numeri?.messaggi > 0 && numeri.in_differita >= 2 && Number.isInteger(numeri.ritardo_medio_ms), numeri);
    verifica('i numeri della voce sono per gli amministratori', (await chiama('/api/voce/statistiche', { token: carla.token })).stato === 403);
    const archivio = await chiama(`/api/voce/archivio/${sB.emergenza.id}`, { token: carla.token });
    verifica('l\'elenco per l\'archivio chiede il permesso dell\'archivio', archivio.stato === 403);

    let negati = 0;
    for (let i = 0; i < 15; i++) {
        const tocco = await parla(B3, canaleSquadra, 0);
        if (tocco.risposta?.t !== 'parla_ok') negati++;
        else { B3.manda({ t: 'annulla', uuid: tocco.uuid }); await B3.aspetta(m => m.t === 'annullato' && m.uuid === tocco.uuid); }
    }
    const dopoITocchi = await parla(B3, canaleSquadra, 10);
    verifica('i tocchi a vuoto non contano nel limite al minuto', negati === 0 && (await finisci(B3, dopoITocchi.uuid, 10))?.t === 'salvato', { negati, risposta: dopoITocchi.risposta });

    // Collegamenti web, che non buttano fuori il telefono B3: servono ancora dopo.
    const lasciati = [];
    for (let i = 0; i < 3; i++) {
        const web = await collega({ Authorization: `Bearer ${bruno.token}` });
        aperti.push(web);
        await web.aspetta(m => m.t === 'stato');
        lasciati.push((await parla(web, canaleSquadra, 3, { differito: true, eta_ms: 1000 })).uuid);
        web.ws.terminate();
    }
    const ancora = await collega({ Authorization: `Bearer ${bruno.token}` });
    aperti.push(ancora);
    await ancora.aspetta(m => m.t === 'stato');
    const oltre = await parla(ancora, canaleSquadra, 0, { differito: true, eta_ms: 1000 });
    verifica('i messaggi rimasti a metà hanno un tetto per persona', oltre.risposta?.t === 'negato' && oltre.risposta.motivo === 'frequenza', oltre.risposta);
    let ripresi = 0;
    for (const uuid of lasciati) {
        ancora.manda({ t: 'parla', uuid, canale: canaleSquadra, differito: true, eta_ms: 1000 });
        if ((await ancora.aspetta(m => m.uuid === uuid && m.t === 'parla_ok'))?.ricevuti === 3) ripresi++;
        ancora.manda({ t: 'annulla', uuid });
        await ancora.aspetta(m => m.uuid === uuid && m.t === 'annullato');
    }
    verifica('quelli rimasti a metà si riprendono lo stesso', ripresi === 3, ripresi);
    const ripartito = await parla(ancora, canaleSquadra, 0, { differito: true, eta_ms: 1000 });
    verifica('chiusi quelli, si riparte', ripartito.risposta?.t === 'parla_ok', ripartito.risposta);
    if (ripartito.risposta?.t === 'parla_ok') ancora.manda({ t: 'annulla', uuid: ripartito.uuid });

    await chiama(`/api/squadre/${squadraId}`, { method: 'PUT', token: admin, body: { nome_radio: nomeRadio, nome: 'Prova voce', caposquadra: anna.username, membri: [{ username: anna.username }] } });
    const tolto = await B3.aspetta(m => m.t === 'canali' && !m.canali.some(c => c.id === canaleSquadra), 6000);
    verifica('tolto dalla squadra, Bruno esce dal canale', !!tolto, tolto);
    const estraneo = await chiama(`/api/voce/messaggi/${m1.id}/audio`, { token: bruno.token });
    verifica('e non riascolta più i messaggi della squadra', estraneo.stato === 403, estraneo.stato);
} finally {
    for (const p of aperti) try { p.ws.terminate(); } catch { /* già chiusa */ }
    if (persone[1] && persone[2]) await chiama(`/api/voce/diretti/${persone[1].id}`, { method: 'DELETE', token: persone[2].token }).catch(() => {});
    if (cocId) await chiama(`/api/squadre/${cocId}`, { method: 'PUT', token: admin, body: { membri: membriCoc } }).catch(() => {});
    if (segnalazione && squadraId) await chiama(`/api/reports/${segnalazione}/teams/${squadraId}`, { method: 'DELETE', token: admin }).catch(() => {});
    if (squadraId) await chiama(`/api/squadre/${squadraId}`, { method: 'DELETE', token: admin });
    for (const p of persone) await chiama(`/api/users/${p.id}`, { method: 'DELETE', token: admin });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { voce_enabled: voceDiPrima } });
    await pool.end();
}

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutto a posto.');
process.exit(falliti ? 1 : 0);
