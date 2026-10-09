// Il bollettino di allerta (src/allerta.js) con un bollettino di prova servito
// da questa stessa prova: zona dal comune e dal centro della mappa, livelli di
// oggi e domani, PDF, allegato all'emergenza con ogni aggiornamento, nota nel
// diario di sala, avviso a chi apre le emergenze, impostazioni sbagliate
// rifiutate. Le parti senza server (zip, DBF, zone) si provano comunque.
//
// Il server va avviato con il bollettino di prova al posto di quello vero:
//   ORION_ALLERTA_URL=http://127.0.0.1:3099/latest_all.zip node src/server.js
// Apre e chiude un'emergenza di prova: va lanciata su un'istanza di collaudo
// senza emergenze in corso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/allerta.mjs

import 'dotenv/config';
import { accediConFetch } from './accesso-prova.mjs';
import { ESEMPIO, creaBollettino, servi } from './bollettino-finto.mjs';
import { leggiBollettino, livelloMassimo } from '../src/bollettinoDpc.js';
import { comuniDi, zonaDelComune, zonaDelPunto } from '../src/allertaRegioni.js';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const PORTA = Number(process.env.ORION_ALLERTA_PORTA || 3099);

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
    return { stato: r.status, tipo, corpo: tipo.includes('json') ? await r.json().catch(() => null) : await r.arrayBuffer() };
};

console.log('\nBollettino di allerta: lettura e zone');
const letto = leggiBollettino(creaBollettino({ ora: '15:21', livelli: ESEMPIO }).zip);
verifica('dallo zip si leggono le 25 zone del Veneto', Object.keys(letto.oggi).length === 25, Object.keys(letto.oggi).length);
verifica('i livelli di oggi e domani della zona', letto.oggi['Vene-E1'].idraulico === 'gialla' && letto.domani['Vene-E1'].idrogeologico === 'arancione', letto.oggi['Vene-E1']);
verifica('il livello più alto dei tre rischi', livelloMassimo(letto.domani['Vene-E1']) === 'arancione');
verifica('il titolo con data e ora', /del \d{2}\/\d{2}\/\d{4} ore 15:21$/.test(letto.titolo), letto.titolo);
verifica('il PDF è dentro', letto.pdf?.subarray(0, 5).toString() === '%PDF-');
verifica('Padova sta nella zona Vene-E1, dal comune e dal punto',
    zonaDelComune('veneto', 'padova')?.codice === 'Vene-E1' && zonaDelPunto('veneto', 45.4064, 11.8768)?.codice === 'Vene-E1');
verifica('Cortina e Rovigo nelle loro zone', zonaDelPunto('veneto', 46.5405, 12.1357)?.codice === 'Vene-A2' && zonaDelComune('veneto', 'Rovigo')?.codice === 'Vene-D1');
verifica('un punto fuori dal Veneto non ha zona', zonaDelPunto('veneto', 60.17, 24.94) === null);
verifica('i comuni del Veneto sono 560', comuniDi('veneto').length === 560, comuniDi('veneto').length);

console.log('\nBollettino di allerta: server');
// Le ore di adesso: a ogni giro i bollettini di prova sono più recenti di quelli dei giri prima.
const ora = (piuMinuti = 0) => new Date(Date.now() + piuMinuti * 60000).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
const primaOra = ora(), secondaOra = ora(1);
const fonte = await servi(PORTA, creaBollettino({ ora: primaOra, livelli: ESEMPIO }));
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const prima = (await chiama('/api/branding/settings/full', { token: admin })).corpo || {};
const ripristina = {
    allerta_regione: prima.allerta_regione || '', allerta_comune: prima.allerta_comune || '', allerta_avvisa_da: prima.allerta_avvisa_da || ''
};
let aperta = null;
try {
    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (stato?.active) throw new Error("c'è un'emergenza in corso, la prova ne apre una sua");

    let r = await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { allerta_regione: '' } });
    r = await chiama('/api/allerta', { token: admin });
    verifica('senza Regione il bollettino è spento', r.stato === 200 && r.corpo?.attiva === false, r.corpo);

    r = await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { allerta_regione: 'lombardia' } });
    verifica('una Regione non prevista è rifiutata', r.stato === 400, r);
    r = await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { allerta_regione: 'veneto', allerta_comune: 'Milano' } });
    verifica('un comune fuori dalla Regione è rifiutato', r.stato === 400, r);
    r = await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { allerta_avvisa_da: 'sempre' } });
    verifica('un livello degli avvisi sbagliato è rifiutato', r.stato === 400, r);

    r = await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { allerta_regione: 'veneto', allerta_comune: 'Padova', allerta_avvisa_da: 'gialla' } });
    verifica('Regione Veneto e comune di Padova salvati', r.stato === 200, r);
    r = await chiama('/api/allerta/regioni?regione=veneto', { token: admin });
    verifica('le impostazioni hanno i comuni della Regione', r.corpo?.comuni?.includes('Padova') && r.corpo.regioni.some(x => x.codice === 'veneto'), r.corpo?.regioni);

    r = await chiama('/api/allerta/controlla', { method: 'POST', token: admin });
    verifica('il bollettino si legge', r.stato === 200 && !r.corpo?.errore, r.corpo);
    r = await chiama('/api/allerta', { token: admin });
    const a = r.corpo || {};
    verifica('zona del comune scelto', a.zona?.codice === 'Vene-E1' && a.riferimento?.modo === 'comune', a.zona);
    verifica('oggi gialla per rischio idraulico', a.bollettino?.validi?.[0]?.idraulico === 'gialla' && a.bollettino.validi[0].massimo === 'gialla', a.bollettino?.validi);
    verifica('domani arancione', a.bollettino?.validi?.[1]?.massimo === 'arancione', a.bollettino?.validi);
    verifica('la pagina ufficiale della Regione', /regione\.veneto\.it/.test(a.regione?.pagina_ufficiale || ''), a.regione);
    const pdf = await chiama(`/api/allerta/bollettini/${a.bollettino?.id}/pdf`, { token: admin });
    verifica('il PDF del bollettino si apre', pdf.stato === 200 && Buffer.from(pdf.corpo).subarray(0, 5).toString() === '%PDF-', pdf.stato);
    const pdfAnonimo = await fetch(`${BASE}/api/allerta/bollettini/${a.bollettino?.id}/pdf`);
    verifica('il PDF senza accesso no', pdfAnonimo.status === 401 || pdfAnonimo.status === 403, pdfAnonimo.status);

    r = await chiama('/api/allerta/controlla', { method: 'POST', token: admin });
    r = await chiama('/api/allerta', { token: admin });
    verifica('lo stesso bollettino non si conta due volte', r.corpo?.aggiornamenti?.filter(x => x.id === a.bollettino?.id).length === 1, r.corpo?.aggiornamenti?.length);

    const notifiche = (await chiama('/api/notifiche', { token: admin })).corpo;
    const elenco = notifiche?.notifiche || notifiche || [];
    verifica("a chi apre le emergenze arriva l'avviso", elenco.some?.(n => n.tipo === 'allerta_meteo' && /Vene-E1/.test(n.titolo)), elenco.slice?.(0, 3));

    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { allerta_comune: '' } });
    r = await chiama('/api/allerta', { token: admin });
    verifica('senza comune la zona viene dal centro della mappa', r.corpo?.riferimento?.modo === 'centro_mappa', r.corpo?.riferimento);
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { allerta_comune: 'Padova' } });

    // Con l'emergenza aperta: dentro il bollettino in vigore e ogni aggiornamento.
    const codice = `ALLERTA-${Date.now().toString().slice(-6)}`;
    r = await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: codice, name: 'Prova bollettino' } });
    aperta = r.corpo?.emergency;
    verifica("si apre un'emergenza di prova", r.stato === 201 && aperta?.id, r.corpo);
    await new Promise(x => setTimeout(x, 800));
    let documenti = (await chiama(`/api/emergencies/${aperta.id}/documents`, { token: admin })).corpo || [];
    const delBollettino = documenti.filter(d => /^Bollettino di criticità/.test(d.original_filename));
    verifica("il bollettino in vigore entra nei documenti all'apertura", delBollettino.length === 1 && delBollettino[0].uploader_fullname === 'ORION', documenti);
    const file = await chiama(delBollettino[0]?.file_path || '/x', { token: admin });
    verifica("il PDF fra i documenti dell'emergenza si apre", file.stato === 200 && Buffer.from(file.corpo).subarray(0, 5).toString() === '%PDF-', file.stato);
    let eventi = (await chiama(`/api/emergencies/${aperta.id}/eventi`, { token: admin })).corpo || [];
    verifica('i livelli della zona nel diario di sala', eventi.some(e => e.tipo === 'sala' && e.chi === 'ORION' && /Vene-E1/.test(e.testo) && /allerta gialla/.test(e.testo)), eventi.slice(0, 3));

    fonte.pubblica({ ora: secondaOra, tipo: 'update', livelli: { oggi: { 'Vene-E1': { idraulico: 'arancione' } }, domani: { 'Vene-E1': { idraulico: 'rossa' } } } });
    await chiama('/api/allerta/controlla', { method: 'POST', token: admin });
    documenti = (await chiama(`/api/emergencies/${aperta.id}/documents`, { token: admin })).corpo || [];
    verifica("l'aggiornamento entra anche lui nei documenti", documenti.filter(d => /^Bollettino di criticità/.test(d.original_filename)).length === 2
        && documenti.some(d => d.original_filename.endsWith(`ore ${secondaOra} (aggiornamento).pdf`)), documenti.map(d => d.original_filename));
    r = await chiama('/api/allerta', { token: admin });
    verifica("durante l'emergenza si vedono tutte le versioni", r.corpo?.aggiornamenti?.length >= 2 && r.corpo.bollettino.validi[1]?.massimo === 'rossa', r.corpo?.aggiornamenti?.length);
    eventi = (await chiama(`/api/emergencies/${aperta.id}/eventi`, { token: admin })).corpo || [];
    verifica("l'aggiornamento nel diario di sala", eventi.some(e => e.tipo === 'sala' && /aggiornamento/.test(e.testo) && /allerta rossa/.test(e.testo)));

    r = await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    verifica("l'emergenza di prova si chiude", r.stato === 200, r.corpo);
    if (r.stato === 200) aperta = null;
} catch (e) {
    verifica('prova completata', false, e.message);
} finally {
    if (aperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: ripristina });
    fonte.server.close();
}

console.log(falliti ? `\n${falliti} prove fallite.` : '\nTutte le prove superate.');
process.exit(falliti ? 1 : 0);
