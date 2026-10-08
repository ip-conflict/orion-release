// tests/copione.mjs
//
// Il copione e la regia (src/copione.js): chi lo vede e lo scrive, gli
// eventi e i loro controlli, il modello Excel e il caricamento (tutto o
// niente), la copia da un'altra attività; in sala l'orologio, l'uscita a
// tempo e a mano di ogni tipo di evento, rimandare, saltare, collegare la
// segnalazione telefonata, improvvisare, le osservazioni; dopo la chiusura i
// tempi misurati, il debriefing e la pubblicazione ai partecipanti.
//
// Apre e chiude una simulazione sua: va lanciata su un'istanza di collaudo
// senza emergenze in corso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/copione.mjs

import 'dotenv/config';
import ExcelJS from 'exceljs';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio).slice(0, 600)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token, form } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: form || (body ? JSON.stringify(body) : undefined),
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    const tipo = r.headers.get('content-type') || '';
    return { stato: r.status, tipo, corpo: tipo.includes('json') ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer()) };
};
const attesa = (ms) => new Promise(r => setTimeout(r, ms));
const fra = (ore) => new Date(Date.now() + ore * 3600000).toISOString();
const linea = { type: 'LineString', coordinates: [[12.21, 46.14], [12.22, 46.15]] };
async function aspetta(f, volte = 25) {
    for (let i = 0; i < volte; i++) { const v = await f(); if (v) return v; await attesa(200); }
    return null;
}

console.log('\nCopione e regia');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
if ((await chiama('/api/emergencies/status', { token: admin })).corpo?.active) {
    console.log("  (saltato: c'è un'emergenza in corso, la prova apre una simulazione sua)");
    process.exit(0);
}
const suffisso = Date.now().toString().slice(-5);
const persone = [], attivita = [], squadre = [];
async function nuovo(nome, ruoli = ['volontario']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `${nome}${suffisso}`, cognome: 'Copione', ruoli } })).corpo;
    persone.push(n.id);
    const q = new URL(n.magicLink).searchParams;
    const password = `${nome}!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    return { id: n.id, username: n.username, token: (await accediConFetch(BASE, n.username, password)).token };
}

try {
    const dir = await nuovo('Direttore');
    const reg = await nuovo('Regista');
    const a = await nuovo('Anna');
    const b = await nuovo('Bruno');
    const tipi = (await chiama('/api/attivita/tipi', { token: admin })).corpo || [];
    const add = (await chiama('/api/attivita', { method: 'POST', token: admin, body: {
        tipo_id: tipi.find(t => t.nome === 'Addestramento').id, titolo: `Addestramento sala ${suffisso}`, inizio: fra(-0.2), fine: fra(3),
        convocazione: 'tutti', avviso_app: false, simulazione: 'sala', responsabile_id: dir.id, regia: [reg.id], scenario: 'Piena del torrente.'
    } })).corpo;
    attivita.push(add.id);

    verifica('un volontario non vede il copione -> 403', (await chiama(`/api/attivita/${add.id}/copione`, { token: a.token })).stato === 403);
    const vuoto = await chiama(`/api/attivita/${add.id}/copione`, { token: reg.token });
    verifica('il regista sì, vuoto e modificabile', vuoto.stato === 200 && vuoto.corpo?.eventi?.length === 0 && vuoto.corpo?.puo_modificare === true, vuoto);

    const nuovoEv = (corpo, token = reg.token) => chiama(`/api/attivita/${add.id}/copione/eventi`, { method: 'POST', token, body: corpo });
    verifica('un volontario non scrive eventi -> 403', (await nuovoEv({ tipo: 'segnalazione', titolo: 'X' }, a.token)).stato === 403);
    verifica('senza titolo -> 400', (await nuovoEv({ tipo: 'segnalazione' })).stato === 400);
    verifica('un tipo inventato -> 400', (await nuovoEv({ tipo: 'boh', titolo: 'X' })).stato === 400);
    const cantina = (await nuovoEv({ tipo: 'segnalazione', minuto: 0, titolo: `Cantina allagata ${suffisso}`, testo: 'Acqua alta 40 cm', indirizzo: 'Via Roma 12',
        lat: 46.14, lng: 12.21, priorita: 'Medium', segnalante: 'Mario', telefono: '333', risposta_attesa: 'Una squadra con pompa', minuti_attesi: 10 })).corpo;
    verifica('una segnalazione a tempo', cantina?.id && cantina.minuto === 0);
    verifica("l'aggravamento senza riferimento -> 400", (await nuovoEv({ tipo: 'aggravamento', titolo: 'Sale' })).stato === 400);
    verifica("l'aggravamento di una segnalazione che non c'è -> 400", (await nuovoEv({ tipo: 'aggravamento', titolo: 'Sale', riferimento_id: 999999 })).stato === 400);
    const sale = (await nuovoEv({ tipo: 'aggravamento', titolo: "L'acqua sale", testo: 'Arrivata alla caldaia', priorita: 'High', riferimento_id: cantina.id })).corpo;
    const anziana = (await nuovoEv({ tipo: 'segnalazione', titolo: `Anziana isolata ${suffisso}`, modo: 'telefono', segnalante: 'La vicina', minuti_attesi: 15 })).corpo;
    const bollettino = (await nuovoEv({ tipo: 'comunicazione', titolo: 'Allerta rossa', testo: 'Dalle 14' })).corpo;
    verifica("l'imprevisto vuole la squadra -> 400", (await nuovoEv({ tipo: 'imprevisto', titolo: 'Avaria' })).stato === 400);
    const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
    const radio = ['Zulu', 'Yankee', 'Whiskey', 'Victor', 'Uniform', 'Tango'].find(x => !usati.has(x));
    const avaria = (await nuovoEv({ tipo: 'imprevisto', titolo: 'Mezzo in avaria', testo: 'Il furgone non riparte', squadra: radio })).corpo;
    verifica('una geometria sbagliata -> 400', (await nuovoEv({ tipo: 'strada', titolo: 'Frana', geometria: { type: 'Point', coordinates: [500, 500] } })).stato === 400);
    const frana = (await nuovoEv({ tipo: 'strada', titolo: `Frana SP2 ${suffisso}`, geometria: linea })).corpo;
    const area = { type: 'Polygon', coordinates: [[[12.20, 46.13], [12.23, 46.13], [12.23, 46.15], [12.20, 46.15], [12.20, 46.13]]] };
    verifica('una zona di pericolo vuole un\'area -> 400', (await nuovoEv({ tipo: 'pericolo', titolo: 'No', elemento_tipo: 'pericolo_frana', geometria: linea })).stato === 400);
    const pericolo = (await nuovoEv({ tipo: 'pericolo', titolo: `Esondazione ${suffisso}`, elemento_tipo: 'pericolo_alluvione', geometria: area })).corpo;
    verifica('la zona di pericolo entra nel copione', pericolo?.tipo === 'pericolo' && pericolo?.elemento_tipo === 'pericolo_alluvione', pericolo);
    const daSaltare = (await nuovoEv({ tipo: 'comunicazione', minuto: 600, titolo: 'Da saltare' })).corpo;
    const daRimandare = (await nuovoEv({ tipo: 'comunicazione', minuto: 300, titolo: 'Da rimandare' })).corpo;
    const mod = await chiama(`/api/copione/eventi/${anziana.id}`, { method: 'PUT', token: reg.token, body: { ...anziana, testo: 'Non riesce a uscire, ha 85 anni' } });
    verifica('un evento si corregge', mod.stato === 200 && /85 anni/.test(mod.corpo?.testo || ''), mod);

    // Excel: il modello, il caricamento con un errore (niente), poi giusto.
    const modello = await chiama('/api/copione/modello.xlsx', { token: reg.token });
    verifica('il modello Excel si scarica', modello.stato === 200 && /spreadsheetml/.test(modello.tipo) && modello.corpo.length > 3000);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(modello.corpo);
    const foglio = libro.getWorksheet('Copione');
    verifica('con gli esempi e le istruzioni', foglio?.getRow(2).getCell(3).value?.toString().startsWith('ESEMPIO') && !!libro.getWorksheet('Istruzioni'));
    foglio.addRow(['1:30', 'Segnalazione', 'Albero sulla strada', 'Blocca la carreggiata', 'Da sola', 'Via Feltre', '', '', 'Alta', '', '', '', '', 'Squadra con motosega', 20]);
    foglio.addRow([100, 'Aggravamento', 'Arriva un\'auto', '', '', '', '', '', '', '', '', foglio.rowCount, '', '', '']);
    foglio.addRow(['dopo', 'Segnalazione', 'Riga sbagliata', '', '', '', '', '', 'Urgentissima', '', '', '', '', '', '']);
    const carica = async (buffer, modo = 'aggiungi') => {
        const fd = new FormData();
        fd.append('file', new Blob([buffer]), 'copione.xlsx');
        fd.append('modo', modo);
        return chiama(`/api/attivita/${add.id}/copione/importa`, { method: 'POST', token: reg.token, form: fd });
    };
    const sbagliato = await carica(await libro.xlsx.writeBuffer());
    verifica('con righe sbagliate non carica niente e dice quali', sbagliato.stato === 400 && sbagliato.corpo?.errori?.some(e => e.riga === foglio.rowCount), sbagliato.corpo);
    foglio.spliceRows(foglio.rowCount, 1);
    const giusto = await carica(await libro.xlsx.writeBuffer());
    verifica('corretto, carica le righe (non gli esempi)', giusto.stato === 201 && giusto.corpo?.caricati === 2 && giusto.corpo?.da_posizionare === 1, giusto.corpo);
    let copione = (await chiama(`/api/attivita/${add.id}/copione`, { token: reg.token })).corpo;
    const albero = copione.eventi.find(e => e.titolo === 'Albero sulla strada');
    verifica('il minuto 1:30 diventa 90 e l\'aggravamento trova la sua riga',
        albero?.minuto === 90 && copione.eventi.some(e => e.tipo === 'aggravamento' && e.riferimento_id === albero?.id), copione.eventi.map(e => [e.titolo, e.minuto, e.riferimento_id]));
    const esportato = await chiama(`/api/attivita/${add.id}/copione.xlsx`, { token: reg.token });
    verifica('il copione si scarica in Excel', esportato.stato === 200 && esportato.corpo.length > 3000);
    const nonFile = new FormData();
    nonFile.append('file', new Blob([Buffer.from('ciao')]), 'copione.xlsx');
    verifica('un file che non è Excel -> 400', (await chiama(`/api/attivita/${add.id}/copione/importa`, { method: 'POST', token: reg.token, form: nonFile })).stato === 400);

    const altra = (await chiama('/api/attivita', { method: 'POST', token: admin, body: { tipo_id: tipi.find(t => t.nome === 'Esercitazione').id, titolo: `Altra ${suffisso}`, inizio: fra(48), fine: fra(50), simulazione: 'sala', avviso_app: false } })).corpo;
    attivita.push(altra.id);
    const copiato = await chiama(`/api/attivita/${altra.id}/copione/copia`, { method: 'POST', token: admin, body: { da: add.id } });
    verifica("il copione si copia in un'altra attività", copiato.stato === 201 && copiato.corpo?.copiati === copione.eventi.length, copiato.corpo);

    // In sala.
    const sq = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: radio, nome: 'Pompe', membri: [{ username: b.username }] } });
    if (sq.corpo?.squadraId) squadre.push(sq.corpo.squadraId);
    verifica('senza sala la regia non c\'è -> 409', (await chiama('/api/regia', { token: reg.token })).stato === 409);
    const sala = await chiama(`/api/attivita/${add.id}/apri-sala`, { method: 'POST', token: dir.token, body: {} });
    verifica('il direttore apre la sala', sala.stato === 201, sala.corpo);
    verifica('un volontario non vede la regia -> 403', (await chiama('/api/regia', { token: a.token })).stato === 403);
    let r = (await chiama('/api/regia', { token: reg.token })).corpo;
    verifica('prima di avviare, orologio fermo e niente uscito', r?.orologio === null && r?.eventi?.every(e => e.stato === 'atteso'), r?.orologio);
    verifica('lo scenario si avvia', (await chiama('/api/regia/avvia', { method: 'POST', token: reg.token, body: {} })).stato === 201);
    verifica('una volta sola -> 409', (await chiama('/api/regia/avvia', { method: 'POST', token: reg.token, body: {} })).stato === 409);
    const uscita = await aspetta(async () => (await chiama('/api/regia', { token: reg.token })).corpo?.eventi?.find(e => e.id === cantina.id && e.stato === 'uscito'));
    verifica("l'evento al minuto 0 esce da solo e crea la segnalazione", uscita?.automatico === true && !!uscita?.report?.id, uscita);
    const report = (await chiama(`/api/reports/${uscita?.report?.id}`, { token: admin })).corpo;
    verifica('la segnalazione è quella del copione', (report?.report || report)?.title === `Cantina allagata ${suffisso}`, report);
    verifica('un evento uscito non si toglie dal copione -> 409', (await chiama(`/api/copione/eventi/${cantina.id}`, { method: 'DELETE', token: reg.token })).stato === 409);

    const esci = (ev) => chiama(`/api/regia/eventi/${ev.id}/esci`, { method: 'POST', token: reg.token, body: {} });
    verifica('un evento uscito non esce due volte -> 409', (await esci(cantina)).stato === 409);
    const telefonata = await esci(anziana);
    verifica('la segnalazione per telefono non crea niente', telefonata.stato === 200 && !telefonata.corpo?.creata, telefonata.corpo);
    const prom = await aspetta(async () => ((await chiama('/api/notifiche', { token: dir.token })).corpo?.notifiche || []).find(n => n.tipo === 'regia_telefona'));
    verifica('e alla regia arriva il promemoria di telefonare', /Telefona alla sala/.test(prom?.titolo || ''), prom);
    const inserita = (await chiama('/api/reports', { method: 'POST', token: admin, body: { title: 'Signora anziana bloccata in casa', priority: 'High' } })).corpo;
    verifica('la sala la inserisce e la regia la collega', (await chiama(`/api/regia/eventi/${anziana.id}/collega`, { method: 'POST', token: reg.token, body: { report_id: inserita.id } })).stato === 200);
    const agg = await esci(sale);
    const dopoAgg = (await chiama(`/api/reports/${uscita?.report?.id}`, { token: admin })).corpo;
    verifica("l'aggravamento alza la priorità e scrive nel diario", agg.stato === 200 && (dopoAgg?.report || dopoAgg)?.priority === 'High', dopoAgg);
    await esci(bollettino);
    const diario = await aspetta(async () => ((await chiama(`/api/emergencies/${sala.corpo?.emergency?.id}/eventi`, { token: admin })).corpo || []));
    verifica('la comunicazione entra nel diario di sala', JSON.stringify(diario).includes('Allerta rossa'), JSON.stringify(diario).slice(0, 300));
    await esci(avaria);
    const imprevisto = await aspetta(async () => ((await chiama('/api/notifiche', { token: b.token })).corpo?.notifiche || []).find(n => n.tipo === 'imprevisto'));
    verifica("l'imprevisto arriva sul telefono della squadra", /^\[SIMULAZIONE\] Mezzo in avaria/.test(imprevisto?.titolo || ''), imprevisto);
    await esci(frana);
    const mappa = (await chiama('/api/mappa/elementi', { token: admin })).corpo;
    verifica('la strada chiusa compare sulla mappa', (mappa?.emergenza || []).some(m => m.nome === `Frana SP2 ${suffisso}`));
    await esci(pericolo);
    const tutti = Object.values((await chiama('/api/mappa/elementi', { token: admin })).corpo || {}).flat();
    verifica('la zona di pericolo compare sulla mappa con il suo tipo', tutti.some(m => m?.nome === `Esondazione ${suffisso}` && m.tipo === 'pericolo_alluvione'), tutti.map(m => m?.tipo));
    const comunicazioni = (await chiama('/api/regia/comunicazioni', { token: b.token })).corpo || [];
    verifica('le comunicazioni uscite le legge chi è in sala, non solo la regia', comunicazioni.some(c => /Allerta rossa/.test(c.titolo)), comunicazioni);
    const rim = await chiama(`/api/regia/eventi/${daRimandare.id}/rimanda`, { method: 'POST', token: reg.token, body: { minuti: 15 } });
    verifica('un evento si rimanda', rim.corpo?.rimando_minuti === 15, rim);
    verifica('un evento si salta', (await chiama(`/api/regia/eventi/${daSaltare.id}/salta`, { method: 'POST', token: reg.token, body: {} })).stato === 200);
    verifica('e poi non esce -> 409', (await esci(daSaltare)).stato === 409);
    verifica('la pausa', (await chiama('/api/regia/pausa', { method: 'POST', token: reg.token, body: { pausa: true } })).stato === 200);
    r = (await chiama('/api/regia', { token: reg.token })).corpo;
    verifica("l'orologio dice in pausa", r?.orologio?.in_pausa === true);
    verifica('la ripresa', (await chiama('/api/regia/pausa', { method: 'POST', token: reg.token, body: { pausa: false } })).stato === 200);
    const impro = await chiama('/api/regia/improvvisa', { method: 'POST', token: reg.token, body: { tipo: 'comunicazione', titolo: 'Il sindaco chiede un punto di situazione' } });
    verifica('un evento improvvisato esce subito', impro.stato === 201 && impro.corpo?.evento?.minuto === null, impro.corpo);
    const oss = await chiama(`/api/attivita/${add.id}/osservazioni`, { method: 'POST', token: reg.token, body: { testo: 'La sala non ha richiamato il segnalante', evento_id: cantina.id } });
    verifica("un'osservazione della regia", oss.stato === 201 && oss.corpo?.evento_id === cantina.id, oss);
    verifica('un volontario non scrive osservazioni -> 403', (await chiama(`/api/attivita/${add.id}/osservazioni`, { method: 'POST', token: a.token, body: { testo: 'x' } })).stato === 403);

    // La sala assegna una squadra alla cantina e la chiude.
    await chiama(`/api/reports/${uscita?.report?.id}/teams`, { method: 'POST', token: admin, body: { teamId: sq.corpo?.squadraId } });
    await chiama(`/api/reports/${uscita?.report?.id}`, { method: 'PUT', token: admin, body: { status: 'Closed' } });
    await chiama('/api/emergencies/close', { method: 'POST', token: dir.token, body: {} });
    await attesa(1500);

    copione = (await chiama(`/api/attivita/${add.id}/copione`, { token: reg.token })).corpo;
    const c = copione?.eventi?.find(e => e.id === cantina.id);
    verifica('dopo: i tempi della segnalazione e la valutazione', c?.misure?.assegnata_dopo !== null && c?.misure?.chiusa_dopo !== null && c?.valutazione === 'in_tempo', c);
    verifica('quella telefonata, collegata, ha i suoi tempi', copione?.eventi?.find(e => e.id === anziana.id)?.report?.id === inserita.id);
    verifica('le osservazioni restano', copione?.osservazioni?.length === 1);

    const deb = await chiama(`/api/attivita/${add.id}/debriefing`, { method: 'PUT', token: reg.token, body: { punti_forza: 'Assegnazioni rapide', criticita: 'Nessuno ha richiamato il segnalante', miglioramenti: 'Scheda di richiamata' } });
    verifica('il debriefing lo scrive un regista', deb.stato === 200 && deb.corpo?.aggiornato_da, deb);
    verifica('anche il direttore', (await chiama(`/api/attivita/${add.id}/debriefing`, { method: 'PUT', token: dir.token, body: { punti_forza: 'Assegnazioni rapide', obiettivi_raggiunti: 'Sì' } })).stato === 200);
    verifica('un volontario no -> 403', (await chiama(`/api/attivita/${add.id}/debriefing`, { method: 'PUT', token: a.token, body: { punti_forza: 'x' } })).stato === 403);
    verifica('concluso', (await chiama(`/api/attivita/${add.id}/debriefing/concludi`, { method: 'POST', token: reg.token, body: {} })).stato === 200);
    verifica('e non si cambia più -> 409', (await chiama(`/api/attivita/${add.id}/debriefing`, { method: 'PUT', token: reg.token, body: { punti_forza: 'x' } })).stato === 409);

    verifica('non pubblicato, un partecipante non lo vede -> 403', (await chiama(`/api/attivita/${add.id}/copione`, { token: a.token })).stato === 403);
    verifica('la regia lo pubblica', (await chiama(`/api/attivita/${add.id}/copione/pubblica`, { method: 'PUT', token: reg.token, body: { pubblicato: true } })).corpo?.pubblicato === true);
    const letto = await chiama(`/api/attivita/${add.id}/copione`, { token: a.token });
    verifica('pubblicato, il partecipante lo legge con il debriefing, senza poterlo cambiare', letto.stato === 200 && letto.corpo?.puo_modificare === false && !!letto.corpo?.debriefing?.concluso_il, letto.corpo?.puo_modificare);
    verifica('ma non lo scrive -> 403', (await nuovoEv({ tipo: 'comunicazione', titolo: 'x' }, a.token)).stato === 403);
    const riservata = (await chiama('/api/attivita', { method: 'POST', token: admin, body: {
        tipo_id: tipi.find(t => t.nome === 'Addestramento').id, titolo: `Riservata ${suffisso}`, inizio: fra(48), fine: fra(50),
        convocazione: 'scelti', persone: [b.id], avviso_app: false, simulazione: 'sala' } })).corpo;
    if (riservata?.id) attivita.push(riservata.id);
    await chiama(`/api/attivita/${riservata?.id}/copione/pubblica`, { method: 'PUT', token: admin, body: { pubblicato: true } });
    verifica("pubblicato, chi non vede l'attività non lo trova -> 404", (await chiama(`/api/attivita/${riservata?.id}/copione`, { token: a.token })).stato === 404);
    verifica('il convocato, a sala mai aperta, ancora no -> 403', (await chiama(`/api/attivita/${riservata?.id}/copione`, { token: b.token })).stato === 403);
} finally {
    if ((await chiama('/api/emergencies/status', { token: admin })).corpo?.active) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    for (const s of squadre) await chiama(`/api/squadre/${s}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    for (const p of persone.reverse()) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    for (const id of attivita) await chiama(`/api/attivita/${id}`, { method: 'DELETE', token: admin });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
