// La copia dei backup su Google Drive, con un Google finto (tests/drive-finto.mjs) qui dentro: il
// collegamento con PKCE e state, i segreti cifrati e mai al browser, la copia del giorno, quella della
// chiusura di un'emergenza e l'archivio settimanale, la ripresa dopo una connessione caduta, la pulizia
// che tocca solo le copie di ORION, gli errori di spazio e di accesso revocato, lo scollegamento.
//
// Il server va avviato con gli indirizzi del finto e un controllo ogni pochi secondi:
//   ORION_DRIVE_AUTH_URL=http://127.0.0.1:3095/o/oauth2/v2/auth ORION_DRIVE_TOKEN_URL=http://127.0.0.1:3095/token
//   ORION_DRIVE_REVOKE_URL=http://127.0.0.1:3095/revoke ORION_DRIVE_URL=http://127.0.0.1:3095 ORION_DRIVE_CONTROLLO_MS=3000
// e poi
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/drive.mjs

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { accediConFetch } from './accesso-prova.mjs';
import { ACCOUNT, servi } from './drive-finto.mjs';

const RADICE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATI = process.env.ORION_DATI_DIR ? path.resolve(process.env.ORION_DATI_DIR) : RADICE;
const CARTELLA_BACKUP = process.env.ORION_BACKUP_DIR || path.join(DATI, 'backup', 'auto');
const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const CLIENT_ID = '123456789-prova.apps.googleusercontent.com';
const SEGRETO = 'GOCSPX-segreto-di-prova-123';
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const attesa = ms => new Promise(r => setTimeout(r, ms));
async function aspetta(condizione, ms = 20000) {
    const fine = Date.now() + ms;
    while (Date.now() < fine) {
        if (await condizione()) return true;
        await attesa(250);
    }
    return !!(await condizione());
}

const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const chiama = async (percorso, { method = 'GET', body, token = admin } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, redirect: 'manual', body: body ? JSON.stringify(body) : undefined,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    return { stato: r.status, posizione: r.headers.get('location'), corpo: await r.json().catch(() => null) };
};
const impostazione = async (chiave) => (await pool.query('SELECT setting_value FROM branding_settings WHERE setting_key = $1', [chiave])).rows[0]?.setting_value || '';
const copieDi = (google, tipo) => [...google.file.values()].filter(f => f.appProperties?.orion === tipo);
const cifrato = (buf) => buf.subarray(0, 8).toString() === 'ORIONCF1';

console.log('\nLa copia dei backup su Google Drive');
const google = await servi(3095, { clientId: CLIENT_ID, segreto: SEGRETO });
try {
    await chiama('/api/sistema/drive', { method: 'DELETE' });
    await pool.query("DELETE FROM branding_settings WHERE setting_key IN ('drive_config', 'drive_stato')");

    let d = (await chiama('/api/sistema/drive')).corpo;
    verifica('di base Drive non è collegato', d?.collegato === false && d.segreto_impostato === false, d);
    verifica('la pagina dice l\'indirizzo di ritorno da dare a Google', d?.ritorno === `${BASE}/api/sistema/drive/ritorno`, d?.ritorno);
    verifica('senza client non si collega', (await chiama('/api/sistema/drive/collega', { method: 'POST' })).stato === 409);
    verifica('un ID del client sbagliato è rifiutato', (await chiama('/api/sistema/drive/client', { method: 'PUT', body: { client_id: 'qualcosa' } })).stato === 400);
    verifica('le copie da tenere vanno da 1 in su', (await chiama('/api/sistema/drive/client', { method: 'PUT', body: { giornalieri: 0 } })).stato === 400);
    verifica('ID e segreto del client si salvano',
        (await chiama('/api/sistema/drive/client', { method: 'PUT', body: { client_id: CLIENT_ID, client_secret: SEGRETO } })).stato === 200);
    d = (await chiama('/api/sistema/drive')).corpo;
    verifica('il segreto non torna al browser', d?.segreto_impostato === true && !JSON.stringify(d).includes(SEGRETO), d);
    verifica('nel database il segreto è cifrato', !(await impostazione('drive_config')).includes(SEGRETO));
    const tutte = (await chiama('/api/branding/settings/full')).corpo || {};
    verifica('le impostazioni di Drive non escono con le altre', !('drive_config' in tutte) && !('drive_stato' in tutte), Object.keys(tutte));
    verifica('e non si scrivono da Impostazioni',
        (await chiama('/api/branding/settings', { method: 'PUT', body: { drive_config: '{}' } })).stato === 400);

    const collega = (await chiama('/api/sistema/drive/collega', { method: 'POST' })).corpo;
    const consenso = new URL(collega?.url || 'http://x');
    verifica('il consenso chiede solo drive.file, con PKCE e accesso permanente',
        consenso.searchParams.get('scope') === 'https://www.googleapis.com/auth/drive.file'
        && consenso.searchParams.get('code_challenge_method') === 'S256' && consenso.searchParams.get('access_type') === 'offline'
        && consenso.searchParams.get('prompt') === 'consent' && consenso.searchParams.get('state')?.length >= 30, collega);
    const falso = await chiama('/api/sistema/drive/ritorno?code=4/qualcosa&state=inventato', { token: null });
    verifica('un ritorno con uno state inventato non collega', falso.stato === 303 && /drive=errore/.test(falso.posizione || ''), falso);

    const daGoogle = await fetch(consenso, { redirect: 'manual' });
    const ritorno = daGoogle.headers.get('location') || '';
    const finito = await chiama(ritorno.replace(BASE, ''), { token: null });
    verifica('Google torna con il codice e ORION si collega senza cookie, dallo state', finito.stato === 303 && /drive=collegato/.test(finito.posizione || ''), finito);
    verifica('lo stesso ritorno non vale due volte', /drive=errore/.test((await chiama(ritorno.replace(BASE, ''), { token: null })).posizione || ''));
    d = (await chiama('/api/sistema/drive')).corpo;
    verifica('collegato, con l\'account di Google', d?.collegato === true && d.account === ACCOUNT, d);
    verifica('il token di Google nel database è cifrato', !/1\/\/finto-/.test(await impostazione('drive_config')));

    google.interrompi(1);
    const backup = await chiama('/api/sistema/backup', { method: 'POST' });
    verifica('un backup sul server da copiare', backup.stato === 200, backup);
    verifica('Copia adesso parte', (await chiama('/api/sistema/drive/copia', { method: 'POST' })).stato === 202);
    verifica('il backup del giorno arriva su Drive, anche con la connessione caduta a metà',
        await aspetta(() => copieDi(google, 'giornaliero').some(f => f.name === backup.corpo?.file)), [...google.file.values()].map(f => f.name));
    const copiato = copieDi(google, 'giornaliero').find(f => f.name === backup.corpo?.file);
    const locale = fs.readFileSync(path.join(CARTELLA_BACKUP, backup.corpo?.file || 'x'));
    verifica('la copia è identica al backup, e cifrata', copiato && copiato.contenuto.equals(locale) && cifrato(copiato.contenuto));
    const cartella = copieDi(google, 'cartella')[0];
    verifica('sta nella cartella "ORION …" creata da ORION', cartella && /^ORION /.test(cartella.name) && copiato?.parents?.includes(cartella.id), cartella);

    verifica('una volta alla settimana l\'archivio dei file, cifrato',
        await aspetta(() => copieDi(google, 'settimanale').length === 1, 30000) && cifrato(copieDi(google, 'settimanale')[0].contenuto));

    const estraneo = google.aggiungi({ name: 'foto della gita.jpg', parents: [cartella?.id] });
    for (let i = 1; i <= 3; i++) {
        google.aggiungi({ name: `vecchio-${i}.sql.gz`, parents: [cartella?.id], appProperties: { orion: 'giornaliero' }, createdTime: new Date(Date.now() - i * 86400000 * 2).toISOString() });
    }
    google.aggiungi({ name: 'emergenza-antica.sql.gz', parents: [cartella?.id], appProperties: { orion: 'emergenza' }, createdTime: '2020-01-01T00:00:00.000Z' });
    verifica('si tengono due copie del giorno', (await chiama('/api/sistema/drive/client', { method: 'PUT', body: { giornalieri: 2 } })).stato === 200);

    const emergenza = await chiama('/api/emergencies/open', { method: 'POST', body: { external_code: `DRIVE-${Date.now().toString().slice(-6)}`, name: 'Prova Drive' } });
    verifica('aperta un\'emergenza', emergenza.stato === 201, emergenza);
    verifica('e chiusa', (await chiama('/api/emergencies/close', { method: 'POST', body: {} })).stato === 200);
    verifica('alla chiusura il suo backup va su Drive', await aspetta(() => copieDi(google, 'emergenza').length === 2, 30000), copieDi(google, 'emergenza').map(f => f.name));
    verifica('la pulizia lascia due copie del giorno, le più recenti', await aspetta(() => copieDi(google, 'giornaliero').length === 2)
        && !copieDi(google, 'giornaliero').some(f => /^vecchio-[23]/.test(f.name)), copieDi(google, 'giornaliero').map(f => f.name));
    verifica('e non tocca i file non suoi né le copie delle emergenze', google.file.has(estraneo) && copieDi(google, 'emergenza').some(f => f.name === 'emergenza-antica.sql.gz'));

    google.pieno(true);
    await chiama('/api/sistema/drive/copia', { method: 'POST' });
    verifica('con lo spazio finito la pagina lo dice', await aspetta(async () => /spazio/i.test((await chiama('/api/sistema/drive')).corpo?.errore || '')));
    const avvisi = (await chiama('/api/sistema/avvisi')).corpo?.problemi || [];
    verifica('ed è fra le cose da sistemare', avvisi.some(p => p.tipo === 'drive'), avvisi);
    google.pieno(false);

    google.revocaTutto();
    await chiama('/api/sistema/drive/copia', { method: 'POST' });
    verifica('se l\'accesso è stato tolto da Google, chiede di ricollegare',
        await aspetta(async () => /ricollega/i.test((await chiama('/api/sistema/drive')).corpo?.errore || '')));

    const scollega = await chiama('/api/sistema/drive', { method: 'DELETE' });
    d = (await chiama('/api/sistema/drive')).corpo;
    verifica('Scollega revoca l\'accesso presso Google e dimentica il token',
        scollega.stato === 200 && d?.collegato === false && google.revocati.length >= 1 && JSON.parse(await impostazione('drive_config')).token === null, d);
    verifica('scollegato, la copia non parte', (await chiama('/api/sistema/drive/copia', { method: 'POST' })).stato === 409);
    verifica('e le cose da sistemare non parlano più di Drive',
        !((await chiama('/api/sistema/avvisi')).corpo?.problemi || []).some(p => p.tipo === 'drive'));
} finally {
    await chiama('/api/sistema/drive', { method: 'DELETE' }).catch(() => {});
    await pool.query("DELETE FROM branding_settings WHERE setting_key IN ('drive_config', 'drive_stato')").catch(() => {});
    await pool.end();
    google.server.close();
}

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutte le verifiche superate.');
process.exit(falliti ? 1 : 0);
