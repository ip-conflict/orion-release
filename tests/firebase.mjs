// tests/firebase.mjs
//
// Le notifiche Firebase, facoltative: l'amministratore carica i due file del
// progetto, il telefono riceve gli identificativi pubblici e registra il suo,
// a ogni notifica il server manda a Google un segnale vuoto; spento Firebase
// si torna come prima. Google è finto (tests/google-finto.mjs), qui dentro.
//
// Il server va avviato con
//   ORION_GOOGLE_TOKEN_URL=http://127.0.0.1:3098/token ORION_FCM_URL=http://127.0.0.1:3098
// e poi
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/firebase.mjs

import 'dotenv/config';
import WebSocket from 'ws';
import { accediConFetch } from './accesso-prova.mjs';
import { creaAccount, creaGoogleServices, servi } from './google-finto.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const PORTA_GOOGLE = Number(process.env.ORION_GOOGLE_FINTO_PORTA || 3098);
const attesa = ms => new Promise(r => setTimeout(r, ms));
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token, avvisi } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(avvisi ? { Authorization: `Avvisi ${avvisi}` } : {})
        }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
async function aspetta(condizione, ms = 5000) {
    const fine = Date.now() + ms;
    while (Date.now() < fine) {
        if (condizione()) return true;
        await attesa(100);
    }
    return condizione();
}

console.log('\nLe notifiche Firebase');
const google = await servi(PORTA_GOOGLE);
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const PROGETTO = `orion-prova-${suffisso}`;
let persona = null, ws = null, configurato = false;
try {
    // Un'istanza lasciata configurata da una prova interrotta.
    await chiama('/api/admin/firebase', { method: 'DELETE', token: admin });
    verifica('di base Firebase è spento', (await chiama('/api/admin/firebase', { token: admin })).corpo?.configurato === false);

    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `Fcm${suffisso}`, cognome: 'Prova', role: 'volontario' } })).corpo;
    persona = n.id;
    const q = new URL(n.magicLink).searchParams;
    const password = `Fcm!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const sessione = (await accediConFetch(BASE, n.username, password)).token;
    const avvisi = (await chiama('/api/app/avvisi', { method: 'POST', token: sessione, body: { dispositivo: 'Telefono Firebase' } })).corpo?.avvisi;

    verifica('il telefono legge che Firebase è spento', (await chiama('/api/avvisi/configurazione', { avvisi })).corpo?.firebase === null);
    verifica('senza token degli avvisi la configurazione non si legge', (await chiama('/api/avvisi/configurazione')).stato === 401);
    const presto = await chiama('/api/avvisi/firebase', { method: 'PUT', avvisi, body: { token: 'telefono-ok-' + 'x'.repeat(40), progetto: PROGETTO } });
    verifica('con Firebase spento il telefono non si registra', presto.stato === 409 && presto.corpo?.firebase === null, presto);
    verifica('un volontario non vede la configurazione', (await chiama('/api/admin/firebase', { token: sessione })).stato === 403);
    verifica('un volontario non la cambia', (await chiama('/api/admin/firebase', { method: 'PUT', token: sessione, body: {} })).stato === 403);

    // I file sbagliati si rifiutano con un messaggio che dice cosa fare.
    const { account, pubblica } = creaAccount(PROGETTO);
    const altraApp = await chiama('/api/admin/firebase', { method: 'PUT', token: admin, body: { google_services: creaGoogleServices(PROGETTO, { pacchetto: 'it.altro.app' }), account } });
    verifica("senza l'app it.orion.app nel progetto si rifiuta", altraApp.stato === 400 && /it\.orion\.app/.test(altraApp.corpo?.message), altraApp);
    const altroProgetto = await chiama('/api/admin/firebase', { method: 'PUT', token: admin, body: { google_services: creaGoogleServices(PROGETTO), account: creaAccount('altro-progetto').account } });
    verifica('chiave e google-services.json di progetti diversi si rifiutano', altroProgetto.stato === 400 && /stesso progetto/.test(altroProgetto.corpo?.message), altroProgetto);
    const nonJson = await chiama('/api/admin/firebase', { method: 'PUT', token: admin, body: { google_services: 'non json', account } });
    verifica('un file che non è JSON si rifiuta', nonJson.stato === 400, nonJson);
    const sconosciuta = await chiama('/api/admin/firebase', { method: 'PUT', token: admin, body: { google_services: creaGoogleServices(PROGETTO), account } });
    verifica('una chiave che Google non accetta non si salva', sconosciuta.stato === 422 && /non funziona/.test(sconosciuta.corpo?.message), sconosciuta);
    verifica('e Firebase resta spento', (await chiama('/api/admin/firebase', { token: admin })).corpo?.configurato === false);

    // Il telefono in ascolto saprà subito che la configurazione è cambiata.
    const ricevuti = [];
    ws = new WebSocket(BASE.replace(/^http/, 'ws'), { headers: { Authorization: `Avvisi ${avvisi}`, 'X-Orion-Client': 'app' } });
    ws.on('message', m => ricevuti.push(JSON.parse(m)));
    await new Promise(ok => ws.on('open', ok));

    google.conosci(account.client_email, pubblica);
    const salvata = await chiama('/api/admin/firebase', { method: 'PUT', token: admin, body: { google_services: JSON.stringify(creaGoogleServices(PROGETTO)), account: JSON.stringify(account) } });
    configurato = salvata.stato === 200;
    verifica("con i file giusti Firebase si configura", configurato && salvata.corpo?.configurato === true && salvata.corpo?.progetto === PROGETTO
        && salvata.corpo?.account === account.client_email && !JSON.stringify(salvata.corpo).includes('PRIVATE KEY'), salvata);
    verifica('il telefono in ascolto viene avvisato del cambio', await aspetta(() => ricevuti.some(m => m.action === 'avvisi_configurazione')), ricevuti);

    const tutte = (await chiama('/api/branding/settings/full', { token: admin })).corpo || {};
    verifica('la chiave non esce dalle impostazioni', !('firebase_account' in tutte) && !('firebase_app' in tutte) && !JSON.stringify(tutte).includes('PRIVATE KEY'));
    const dalleImpostazioni = await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { firebase_account: 'x' } });
    verifica('e non si cambia dalle impostazioni generali', dalleImpostazioni.stato === 400, dalleImpostazioni);

    const conf = (await chiama('/api/avvisi/configurazione', { avvisi })).corpo?.firebase;
    verifica('il telefono riceve solo gli identificativi pubblici',
        conf?.progetto === PROGETTO && conf?.mittente === '987654321012' && /^1:987654321012:android:/.test(conf?.app_id) && conf?.api_key?.startsWith('AIza')
        && Object.keys(conf).length === 4, conf);

    const fcm = `telefono-ok-${suffisso}-${'a'.repeat(60)}`;
    verifica('un identificativo strano si rifiuta', (await chiama('/api/avvisi/firebase', { method: 'PUT', avvisi, body: { token: 'con spazi dentro e corto', progetto: PROGETTO } })).stato === 400);
    const vecchioProgetto = await chiama('/api/avvisi/firebase', { method: 'PUT', avvisi, body: { token: fcm, progetto: 'progetto-vecchio' } });
    verifica('registrato su un altro progetto, il telefono deve rileggere la configurazione', vecchioProgetto.stato === 409 && vecchioProgetto.corpo?.firebase?.progetto === PROGETTO, vecchioProgetto);
    const registrato = await chiama('/api/avvisi/firebase', { method: 'PUT', avvisi, body: { token: fcm, progetto: PROGETTO } });
    verifica('il telefono registra il suo identificativo Firebase', registrato.stato === 200 && registrato.corpo?.firebase === true, registrato);
    const telefoni = (await chiama('/api/avvisi/telefoni', { token: admin })).corpo?.telefoni?.[persona];
    verifica('la gestione utenti lo vede raggiungibile con Firebase', telefoni?.firebase === true, telefoni);
    verifica('lo stato di Firebase conta il telefono', (await chiama('/api/admin/firebase', { token: admin })).corpo?.telefoni >= 1);

    // Una notifica: a Google va un segnale vuoto, il contenuto resta sul server.
    google.messaggi.length = 0;
    await chiama('/api/notifiche/prova', { method: 'POST', token: sessione, body: { ritardo: 0 } });
    verifica('a ogni notifica parte il segnale per il telefono', await aspetta(() => google.messaggi.some(m => m.token === fcm)), google.messaggi);
    const segnale = google.messaggi.find(m => m.token === fcm);
    verifica('il segnale è vuoto: niente titolo, niente testo',
        segnale?.data?.orion === 'novita' && Object.keys(segnale.data).length === 1 && !segnale.notification && !JSON.stringify(segnale).includes('Prova degli avvisi'), segnale);
    verifica('ad alta priorità, con i doppioni raggruppati', segnale?.android?.priority === 'HIGH' && segnale?.android?.collapse_key === 'orion', segnale?.android);
    verifica('sul progetto giusto', segnale?.progetto === PROGETTO);
    const coda = (await chiama('/api/avvisi/notifiche', { avvisi })).corpo;
    verifica('la notifica si legge dal server col token degli avvisi', coda?.notifiche?.some(x => x.tipo === 'prova'));

    // Un secondo telefono che ha disinstallato l'app: Google dice UNREGISTERED e l'identificativo si toglie.
    const sessione2 = (await accediConFetch(BASE, n.username, password)).token;
    const avvisi2 = (await chiama('/api/app/avvisi', { method: 'POST', token: sessione2, body: { dispositivo: 'Telefono vecchio' } })).corpo?.avvisi;
    await chiama('/api/avvisi/firebase', { method: 'PUT', avvisi: avvisi2, body: { token: `morto-${suffisso}-${'b'.repeat(60)}`, progetto: PROGETTO } });
    const primaDelMorto = (await chiama('/api/admin/firebase', { token: admin })).corpo?.telefoni;
    google.messaggi.length = 0;
    await attesa(500);
    await chiama('/api/notifiche/prova', { method: 'POST', token: sessione, body: { ritardo: 0 } });
    await aspetta(() => google.messaggi.length >= 2);
    await attesa(300);
    const dopoIlMorto = (await chiama('/api/admin/firebase', { token: admin })).corpo?.telefoni;
    verifica('il telefono che Google non conosce più viene tolto, gli altri restano', dopoIlMorto === primaDelMorto - 1 && google.messaggi.some(m => m.token === fcm), { primaDelMorto, dopoIlMorto });

    // Il telefono che smette di usare Firebase (per esempio senza Google Play).
    const tolto = await chiama('/api/avvisi/firebase', { method: 'PUT', avvisi: avvisi2, body: { token: null } });
    verifica('il telefono può dire che non usa più Firebase', tolto.stato === 200 && tolto.corpo?.firebase === false, tolto);

    // Spento: i telefoni registrati ricevono il segnale di rileggere la configurazione.
    google.messaggi.length = 0;
    ricevuti.length = 0;
    const spento = await chiama('/api/admin/firebase', { method: 'DELETE', token: admin });
    configurato = false;
    verifica('Firebase si spegne', spento.stato === 200 && spento.corpo?.configurato === false, spento);
    verifica('prima di spegnere, i telefoni sono avvisati da Firebase', google.messaggi.some(m => m.token === fcm && m.data?.orion === 'configurazione'), google.messaggi);
    verifica('e quelli in ascolto dal collegamento', await aspetta(() => ricevuti.some(m => m.action === 'avvisi_configurazione')));
    verifica('il telefono legge che Firebase è spento', (await chiama('/api/avvisi/configurazione', { avvisi })).corpo?.firebase === null);
    verifica('la registrazione del telefono è cancellata', (await chiama('/api/avvisi/telefoni', { token: admin })).corpo?.telefoni?.[persona]?.firebase === false);
    google.messaggi.length = 0;
    await attesa(500);
    await chiama('/api/notifiche/prova', { method: 'POST', token: sessione, body: { ritardo: 0 } });
    await attesa(1200);
    verifica('spento Firebase, a Google non va più niente', google.messaggi.length === 0, google.messaggi);
} finally {
    ws?.close();
    if (configurato) await chiama('/api/admin/firebase', { method: 'DELETE', token: admin });
    if (persona) await chiama(`/api/users/${persona}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    google.server.close();
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
