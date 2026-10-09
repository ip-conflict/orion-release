// tests/scenari.mjs
//
// La biblioteca degli scenari (pagina Simulazioni): solo chi organizza le
// attività li vede e li scrive; il copione di uno scenario si scrive, si
// corregge, si toglie, si carica dal foglio Excel e si scarica come quello di
// un'attività; si copia da un'attività; si duplica; pianificandolo nasce
// un'attività con la sua copia del copione, che si ritocca senza cambiare lo
// scenario; l'elenco dice quante volte è stato usato e le simulazioni in
// programma; si apre al volo dal centro operativo; togliendolo le attività
// restano.
//
// Apre e chiude una simulazione sua: va lanciata su un'istanza di collaudo
// senza emergenze in corso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/scenari.mjs

import 'dotenv/config';
import ExcelJS from 'exceljs';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
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
const fra = (ore) => new Date(Date.now() + ore * 3600000).toISOString();

console.log('\nScenari delle simulazioni');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const persone = [];
const attivita = [];
const scenari = [];
async function nuovo(nome, ruoli = ['volontario']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `${nome}${suffisso}`, cognome: 'Scenari', ruoli } })).corpo;
    persone.push(n.id);
    const q = new URL(n.magicLink).searchParams;
    const password = `${nome}!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    return { id: n.id, token: (await accediConFetch(BASE, n.username, password)).token };
}
async function chiudiSeAperta() {
    const s = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (s?.active) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
}

try {
    const org = await nuovo('Org');
    const vol = await nuovo('Vol');
    await chiama(`/api/admin/users/${org.id}/permessi`, { method: 'PUT', token: admin, body: { in_piu: ['gruppo.attivita'] } });

    verifica('un volontario non vede gli scenari -> 403', (await chiama('/api/scenari', { token: vol.token })).stato === 403);
    verifica('né li crea -> 403', (await chiama('/api/scenari', { method: 'POST', token: vol.token, body: { titolo: 'No' } })).stato === 403);
    verifica('senza titolo -> 400', (await chiama('/api/scenari', { method: 'POST', token: org.token, body: { titolo: ' ' } })).stato === 400);
    verifica('durata fuori misura -> 400', (await chiama('/api/scenari', { method: 'POST', token: org.token, body: { titolo: 'X', durata_ore: 100 } })).stato === 400);
    const nuovoS = await chiama('/api/scenari', {
        method: 'POST', token: org.token,
        body: { titolo: `Piena del torrente ${suffisso}`, natura: 'esercitazione', durata_ore: 4, scenario: 'Allerta rossa, il torrente esce', obiettivi: 'Tempi di risposta', enti: 'Vigili del fuoco' }
    });
    const s = nuovoS.corpo;
    if (s?.id) scenari.push(s.id);
    verifica('uno scenario nasce', nuovoS.stato === 201 && s?.natura === 'esercitazione' && s?.durata_ore === 4 && s?.eventi === 0 && s?.usi === 0, nuovoS);
    const mod = await chiama(`/api/scenari/${s.id}`, { method: 'PUT', token: org.token, body: { ...s, obiettivi: 'Tempi di risposta e comunicazioni' } });
    verifica('si corregge', mod.stato === 200 && /comunicazioni/.test(mod.corpo?.obiettivi), mod);

    // Il copione dello scenario.
    verifica('un volontario non legge il copione dello scenario -> 403', (await chiama(`/api/scenari/${s.id}/copione`, { token: vol.token })).stato === 403);
    const ev = (corpo) => chiama(`/api/scenari/${s.id}/copione/eventi`, { method: 'POST', token: org.token, body: corpo });
    const cantina = (await ev({ tipo: 'segnalazione', minuto: 5, titolo: 'Cantina allagata', indirizzo: 'Via Roma 1', lat: 46.14, lng: 12.21 })).corpo;
    const sale = (await ev({ tipo: 'aggravamento', minuto: 20, titolo: "L'acqua sale", riferimento_id: cantina?.id })).corpo;
    const togliere = (await ev({ tipo: 'comunicazione', titolo: 'Da togliere' })).corpo;
    verifica('gli eventi entrano nello scenario', cantina?.scenario_id === s.id && cantina?.attivita_id === null && sale?.riferimento_id === cantina?.id, [cantina, sale]);
    verifica("un aggravamento di un'altra segnalazione -> 400", (await ev({ tipo: 'aggravamento', titolo: 'No', riferimento_id: 999999 })).stato === 400);
    const corr = await chiama(`/api/copione/eventi/${cantina.id}`, { method: 'PUT', token: org.token, body: { ...cantina, testo: 'Un metro d\'acqua' } });
    verifica('un evento dello scenario si corregge', corr.stato === 200 && /metro/.test(corr.corpo?.testo || ''), corr);
    verifica('un volontario non lo tocca -> 403', (await chiama(`/api/copione/eventi/${cantina.id}`, { method: 'PUT', token: vol.token, body: cantina })).stato === 403);
    verifica('si toglie', (await chiama(`/api/copione/eventi/${togliere.id}`, { method: 'DELETE', token: org.token })).stato === 204);
    let copione = (await chiama(`/api/scenari/${s.id}/copione`, { token: org.token })).corpo;
    verifica('il copione si legge come quello di un\'attività', copione?.puo_modificare === true && copione?.sala === null && copione?.eventi?.length === 2
        && copione.eventi.every(e => e.stato === 'atteso') && copione?.scenario?.titolo === s.titolo, copione);

    // Excel: si scarica e si ricarica in un altro scenario.
    const xlsx = await chiama(`/api/scenari/${s.id}/copione.xlsx`, { token: org.token });
    verifica('il copione dello scenario si scarica in Excel', xlsx.stato === 200 && /spreadsheetml/.test(xlsx.tipo));
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(xlsx.corpo);
    const righe = [];
    libro.getWorksheet('Copione').eachRow((r, n) => { if (n > 1 && !/^ESEMPIO/.test(String(r.getCell(3).value))) righe.push(String(r.getCell(3).value)); });
    verifica('con i suoi eventi', righe.includes('Cantina allagata') && righe.includes("L'acqua sale"), righe);
    const altro = (await chiama('/api/scenari', { method: 'POST', token: org.token, body: { titolo: `Variante ${suffisso}` } })).corpo;
    scenari.push(altro.id);
    const fd = new FormData();
    fd.append('file', new Blob([xlsx.corpo]), 'copione.xlsx');
    const imp = await chiama(`/api/scenari/${altro.id}/copione/importa`, { method: 'POST', token: org.token, form: fd });
    verifica('il foglio si carica in un altro scenario', imp.stato === 201 && imp.corpo?.caricati === 2, imp);

    // Copiare in uno scenario il copione di un'attività.
    const tipi = (await chiama('/api/attivita/tipi', { token: org.token })).corpo || [];
    const tipo = (n) => tipi.find(t => t.nome === n);
    const vecchia = (await chiama('/api/attivita', { method: 'POST', token: org.token, body: { tipo_id: tipo('Addestramento').id, titolo: `Vecchia ${suffisso}`, inizio: fra(-48), fine: fra(-46), avviso_app: false, simulazione: 'sala' } })).corpo;
    attivita.push(vecchia.id);
    await chiama(`/api/attivita/${vecchia.id}/copione/eventi`, { method: 'POST', token: org.token, body: { tipo: 'comunicazione', minuto: 0, titolo: 'Bollettino' } });
    const daAtt = await chiama(`/api/scenari/${altro.id}/copione/copia`, { method: 'POST', token: org.token, body: { da: vecchia.id } });
    verifica("in uno scenario si copia il copione di un'attività", daAtt.stato === 201 && daAtt.corpo?.copiati === 1, daAtt);

    // Duplicare.
    const dup = await chiama(`/api/scenari/${s.id}/duplica`, { method: 'POST', token: org.token });
    if (dup.corpo?.id) scenari.push(dup.corpo.id);
    verifica('si duplica con il copione', dup.stato === 201 && dup.corpo?.titolo === `Copia di ${s.titolo}` && dup.corpo?.eventi === 2, dup);

    // Pianificare: dal calendario nasce un'attività con la sua copia.
    verifica('uno scenario si pianifica come simulazione -> 400 senza',
        (await chiama('/api/attivita', { method: 'POST', token: org.token, body: { tipo_id: tipo('Esercitazione').id, titolo: 'No', inizio: fra(24), fine: fra(28), avviso_app: false, scenario_id: s.id } })).stato === 400);
    const pian = await chiama('/api/attivita', {
        method: 'POST', token: org.token,
        body: { tipo_id: tipo('Esercitazione').id, titolo: s.titolo, inizio: fra(24), fine: fra(28), avviso_app: false, simulazione: 'sala', scenario: s.scenario, scenario_id: s.id }
    });
    if (pian.corpo?.id) attivita.push(pian.corpo.id);
    verifica("pianificato: nasce l'attività", pian.stato === 201 && pian.corpo?.scenario_id === s.id, pian);
    const suo = (await chiama(`/api/attivita/${pian.corpo.id}/copione`, { token: org.token })).corpo;
    const suaCantina = suo?.eventi?.find(e => e.titolo === 'Cantina allagata');
    verifica("con la sua copia del copione, aggravamento legato", suo?.eventi?.length === 2 && suaCantina?.id !== cantina.id
        && suo.eventi.some(e => e.tipo === 'aggravamento' && e.riferimento_id === suaCantina?.id), suo?.eventi);
    await chiama(`/api/copione/eventi/${suaCantina.id}`, { method: 'PUT', token: org.token, body: { ...suaCantina, titolo: 'Cantina ritoccata' } });
    copione = (await chiama(`/api/scenari/${s.id}/copione`, { token: org.token })).corpo;
    verifica("ritoccare l'attività non cambia lo scenario", copione?.eventi?.some(e => e.titolo === 'Cantina allagata') && !copione.eventi.some(e => e.titolo === 'Cantina ritoccata'));
    const elenco = (await chiama('/api/scenari', { token: org.token })).corpo;
    const inElenco = elenco?.scenari?.find(x => x.id === s.id);
    verifica("l'elenco dice usato una volta e quando", inElenco?.usi === 1 && !!inElenco?.prossimo_uso && inElenco?.eventi === 2, inElenco);
    verifica('fra le simulazioni in programma con lo scenario', elenco?.programmate?.some(a => a.id === pian.corpo.id && a.scenario_titolo === s.titolo && a.eventi === 2), elenco?.programmate);
    verifica('e fra le svolte quella vecchia', elenco?.svolte?.some(a => a.id === vecchia.id), elenco?.svolte);

    // Al volo dal centro operativo.
    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (stato?.active) {
        console.log("  (salto la parte al volo: c'è un'emergenza in corso)");
    } else {
        const perVolo = (await chiama('/api/simulazioni/scenari', { token: org.token })).corpo || [];
        verifica('gli scenari si offrono al volo', perVolo.some(x => x.id === s.id && x.eventi === 2), perVolo);
        verifica('ma non a un volontario -> 403', (await chiama('/api/simulazioni/scenari', { token: vol.token })).stato === 403);
        verifica('scenario e attività insieme -> 400', (await chiama('/api/simulazioni/al-volo', { method: 'POST', token: org.token, body: { copia_scenario: s.id, copia_da: vecchia.id } })).stato === 400);
        const volo = await chiama('/api/simulazioni/al-volo', { method: 'POST', token: org.token, body: { copia_scenario: s.id } });
        if (volo.corpo?.attivita_id) attivita.push(volo.corpo.attivita_id);
        verifica('si apre al volo da uno scenario', volo.stato === 201 && volo.corpo?.copiati === 2, volo.corpo);
        const nata = (await chiama(`/api/attivita/${volo.corpo?.attivita_id}`, { token: org.token })).corpo;
        verifica('con titolo, natura e scenario dello scenario', nata?.titolo === s.titolo && nata?.natura === 'esercitazione' && nata?.scenario_id === s.id && nata?.scenario === s.scenario, nata);
        await chiudiSeAperta();
    }

    // Togliere lo scenario: le attività restano, con il loro copione.
    verifica('si toglie', (await chiama(`/api/scenari/${s.id}`, { method: 'DELETE', token: org.token })).stato === 204);
    scenari.splice(scenari.indexOf(s.id), 1);
    const resta = (await chiama(`/api/attivita/${pian.corpo.id}/copione`, { token: org.token })).corpo;
    verifica("l'attività pianificata resta con il suo copione", resta?.eventi?.length === 2, resta);
    verifica('lo scenario tolto non si trova più -> 404', (await chiama(`/api/scenari/${s.id}/copione`, { token: org.token })).stato === 404);
} catch (e) {
    verifica('nessuna eccezione', false, e.stack || e.message);
} finally {
    await chiudiSeAperta();
    for (const id of scenari) await chiama(`/api/scenari/${id}`, { method: 'DELETE', token: admin });
    for (const id of attivita) await chiama(`/api/attivita/${id}`, { method: 'DELETE', token: admin });
    for (const p of persone.reverse()) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
