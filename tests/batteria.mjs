// Tutte le prove del server in un colpo, su un'istanza di collaudo che la batteria avvia e riavvia da sé.
//   npm run test:tutto                     (tutte)
//   npm run test:tutto -- voce allerta     (solo quelle nominate)
//   npm run test:tutto -- --rapida         (senza le quattro lente: i giri con i clic, mfa e sospensione)
// Vuole le variabili del server (DB_*, JWT_SECRET, COOKIE_SECRET, PORT, ORION_DATI_DIR), anche da .env,
// e ORION_ADMIN_PASSWORD. Gli esiti vanno in ORION_BATTERIA_DIR, o in una cartella temporanea nuova.

import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { accediConFetch } from './accesso-prova.mjs';

dotenv.config({ quiet: true });

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARTELLA_PROVE = path.join(RADICE, 'tests');
const NON_SUITE = new Set(['accesso-prova', 'batteria', 'bollettino-finto', 'container', 'drive-finto', 'google-finto', 'mediamtx-finto', 'posta-finta', 'voce-app-prepara']);
const CON_EMERGENZA = new Set(['voce', 'voce-sala', 'voce-trascrizione', 'websocket-app']);
const TEMPO_MASSIMO_MS = 7 * 60 * 1000;
// Insieme fanno due terzi del tempo e aspettano davvero (pagine nel browser, codici e sessioni che scadono):
// a ogni modifica si saltano, prima di pubblicare un'immagine girano sempre.
const LENTE = new Set(['clic-aree', 'clic-sala', 'mfa', 'sospensione']);
// I giri con i clic aprono il browser su tutte le aree, e sulle macchine di GitHub ci mettono più di 7 minuti.
const TEMPO_MASSIMO_LUNGHE_MS = { 'clic-aree': 20 * 60 * 1000, 'clic-sala': 12 * 60 * 1000 };
const aspetta = (ms) => new Promise(r => setTimeout(r, ms));

function fermati(messaggio) {
    console.error(messaggio);
    process.exit(2);
}

const mancanti = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE', 'JWT_SECRET', 'ORION_ADMIN_PASSWORD'].filter(v => !process.env[v]);
if (mancanti.length) fermati(`Mancano le variabili ${mancanti.join(', ')} (vedi docs/manuale-tecnico.md, "Provare").`);
// orion_db è il database delle istanze in container: le prove cancellano e ripristinano dati.
if (process.env.DB_DATABASE === 'orion_db') fermati('DB_DATABASE è orion_db, il database di un\'istanza vera: la batteria si lancia solo su un database di prova.');

const PORTA = Number(process.env.PORT || 3010);
const BASE = `http://localhost:${PORTA}`;
const ADMIN = process.env.ORION_ADMIN_USER || 'admin';
const PASSWORD = process.env.ORION_ADMIN_PASSWORD;

const tutte = fs.readdirSync(CARTELLA_PROVE).filter(f => f.endsWith('.mjs')).map(f => f.slice(0, -4)).filter(n => !NON_SUITE.has(n)).sort();
const rapida = process.argv.includes('--rapida');
const chieste = process.argv.slice(2).filter(a => a !== '--rapida');
const sconosciute = chieste.filter(n => !tutte.includes(n));
if (sconosciute.length) fermati(`Prove sconosciute: ${sconosciute.join(', ')}. Ci sono: ${tutte.join(', ')}.`);
const suite = (chieste.length ? chieste : tutte).filter(n => !rapida || !LENTE.has(n));

const USCITA = process.env.ORION_BATTERIA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'orion-batteria-'));
fs.mkdirSync(USCITA, { recursive: true });
const LOG_SERVER = path.join(USCITA, 'server.log');

const ambiente = {
    ...process.env,
    PORT: String(PORTA),
    ORION_URL: BASE,
    ORION_ADMIN_USER: ADMIN,
    // I servizi finti li avviano le prove stesse (allerta.mjs e firebase.mjs): qui solo gli indirizzi.
    ORION_ALLERTA_URL: process.env.ORION_ALLERTA_URL || 'http://127.0.0.1:3099/latest_all.zip',
    ORION_GOOGLE_TOKEN_URL: process.env.ORION_GOOGLE_TOKEN_URL || 'http://127.0.0.1:3098/token',
    ORION_FCM_URL: process.env.ORION_FCM_URL || 'http://127.0.0.1:3098',
    ORION_DRIVE_AUTH_URL: 'http://127.0.0.1:3095/o/oauth2/v2/auth',
    ORION_DRIVE_TOKEN_URL: 'http://127.0.0.1:3095/token',
    ORION_DRIVE_REVOKE_URL: 'http://127.0.0.1:3095/revoke',
    ORION_DRIVE_URL: 'http://127.0.0.1:3095',
    ORION_WHISPER: process.env.ORION_WHISPER || path.join(CARTELLA_PROVE, 'whisper-finto.sh'),
    // MediaMTX finto, avviato da drone.mjs: segreto, indirizzi e cartella delle registrazioni sono le stesse due parti.
    ORION_DRONE_SEGRETO: process.env.ORION_DRONE_SEGRETO || 'segreto-di-prova-del-drone',
    ORION_DRONE_API: process.env.ORION_DRONE_API || 'http://127.0.0.1:3096',
    ORION_DRONE_WEBRTC: process.env.ORION_DRONE_WEBRTC || 'http://127.0.0.1:3096',
    ORION_DRONE_HLS: process.env.ORION_DRONE_HLS || 'http://127.0.0.1:3096',
    ORION_DRONE_REGISTRAZIONI: process.env.ORION_DRONE_REGISTRAZIONI || path.join(USCITA, 'drone-registrazioni'),
    ORION_DRONE_RIPOSO_MS: '1500',
    ORION_DRONE_RACCOLTA_MS: '2000',
    ORION_DRONE_CONTROLLO_MS: '2000',
    ORION_CONTROLLO_COLLEGAMENTI_MS: '3000',
    // smoke.mjs prova il controllo degli aggiornamenti contro 127.0.0.1: senza, andrebbe davvero su GitHub.
    ORION_AGGIORNAMENTI_RETE_LOCALE: 'true',
    // La prova dell'integrità riscrive lo storico e lo chiede esplicitamente: qui il database è di prova per forza.
    ORION_TEST_DISTRUTTIVO: '1'
};
// I controlli orari che queste prove guardano girano ogni pochi secondi solo per loro: nelle altre manderebbero avvisi veri.
const AMBIENTE_DELLA_PROVA = {
    'avvisi-backup': { ORION_CONTROLLO_BACKUP_MS: '2000', ORION_SPAZIO_MINIMO_MB: '999999999', ORION_AGENTE_DIR: path.join(USCITA, 'agente-avvisi') },
    drive: { ORION_DRIVE_CONTROLLO_MS: '3000' }
};

async function salute() {
    try {
        return (await fetch(`${BASE}/api/salute`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
        return false;
    }
}

let server = null;

async function fermaServer() {
    if (!server) return;
    const figlio = server;
    server = null;
    if (figlio.exitCode === null) {
        const finito = new Promise(r => figlio.once('exit', r));
        figlio.kill('SIGTERM');
        await Promise.race([finito, aspetta(10000)]);
        if (figlio.exitCode === null) figlio.kill('SIGKILL');
    }
    for (let i = 0; i < 20 && await salute(); i++) await aspetta(250);
}

// I limiti di frequenza stanno in memoria: un server nuovo per ogni prova li azzera.
async function avviaServer(prova = null) {
    await fermaServer();
    const log = fs.openSync(LOG_SERVER, 'a');
    server = spawn(process.execPath, ['src/server.js'], { cwd: RADICE, env: { ...ambiente, ...AMBIENTE_DELLA_PROVA[prova] }, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    for (let i = 0; i < 120; i++) {
        if (await salute()) return;
        if (server.exitCode !== null) throw new Error(`il server si è fermato all'avvio (codice ${server.exitCode}): vedi ${LOG_SERVER}`);
        await aspetta(500);
    }
    throw new Error(`il server non risponde dopo un minuto: vedi ${LOG_SERVER}`);
}

async function chiama(token, metodo, percorso, corpo) {
    const r = await fetch(BASE + percorso, {
        method: metodo,
        headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
}

function node(argomenti, inPiu = {}) {
    return execFileSync(process.execPath, argomenti, { cwd: RADICE, env: { ...ambiente, ...inPiu }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Ogni accesso dell'amministratore consuma un codice a tempo, e il successivo aspetta il passo di 30 secondi
// dopo: il token si tiene per tutto il giro (sopravvive ai riavvii) e si rifà solo quando il server lo rifiuta.
let tokenTenuto = null;

async function tokenAmministratore() {
    try {
        return (await accediConFetch(BASE, ADMIN, PASSWORD)).token;
    } catch (e) {
        // Un database di prova riusato può avere la verifica attivata da un giro di cui si è perso il segreto.
        if (!/non ne conosce il segreto/.test(e.message)) throw e;
        console.log(`  la verifica in due passaggi di ${ADMIN} ha un segreto che la batteria non conosce: la azzero`);
        node(['scripts/mfa-azzera.mjs', ADMIN]);
        await avviaServer();
        return (await accediConFetch(BASE, ADMIN, PASSWORD)).token;
    }
}

async function preparaAmministratore() {
    const r = await chiama(null, 'POST', '/login', { username: ADMIN, password: PASSWORD });
    if (r.stato === 401 && !r.corpo?.mfa) {
        const esiste = await chiama(null, 'GET', '/api/primo-accesso');
        if (!esiste.corpo?.necessario) fermati(`L'accesso di ${ADMIN} con ORION_ADMIN_PASSWORD non riesce, e il database ha già un amministratore.`);
        console.log(`  creo l'amministratore ${ADMIN}`);
        node(['create-admin.js'], { ADMIN_USERNAME: ADMIN, ADMIN_PASSWORD: PASSWORD, ADMIN_NOME: 'Ada', ADMIN_COGNOME: 'Collaudo', ADMIN_EMAIL: 'collaudo@example.org' });
        await avviaServer();
    }
    return tokenAmministratore();
}

// websocket-app vuole un volontario con una password nota: si rifà a ogni giro, così vale sempre quella di adesso.
async function preparaVolontario(token) {
    const persone = (await chiama(token, 'GET', '/api/admin/users')).corpo || [];
    let persona = persone.find(p => p.nome === 'Vale' && p.cognome === 'Batteria' && p.is_active !== false);
    let link;
    if (persona) {
        link = (await chiama(token, 'POST', `/api/admin/users/${persona.id}/reset-password`, {})).corpo?.magicLink;
    } else {
        const nuovo = await chiama(token, 'POST', '/api/users', { nome: 'Vale', cognome: 'Batteria', ruoli: ['volontario'] });
        if (nuovo.stato !== 201) throw new Error(`volontario di prova non creato: ${JSON.stringify(nuovo.corpo)}`);
        persona = nuovo.corpo;
        link = nuovo.corpo.magicLink;
    }
    const indirizzo = new URL(link);
    const fatto = await chiama(null, 'POST', '/api/auth/reset-password', {
        token: indirizzo.searchParams.get('token'), id: indirizzo.searchParams.get('id'), newPassword: PASSWORD
    });
    if (fatto.stato !== 200) throw new Error(`password del volontario di prova non impostata: ${JSON.stringify(fatto.corpo)}`);
    ambiente.ORION_VOLONTARIO = persona.username;
    ambiente.ORION_VOLONTARIO_PASSWORD = PASSWORD;
}

// Alcune prove vogliono un'emergenza aperta, molte altre un'istanza senza: una prova caduta a metà non deve rovinare le successive.
async function comeAmministratore(metodo, percorso, corpo) {
    if (!tokenTenuto) tokenTenuto = await tokenAmministratore();
    let r = await chiama(tokenTenuto, metodo, percorso, corpo);
    if (r.stato === 401 || r.corpo?.sessione_terminata) {
        tokenTenuto = await tokenAmministratore();
        r = await chiama(tokenTenuto, metodo, percorso, corpo);
    }
    return r;
}

async function sistemaEmergenza(serveAperta) {
    const stato = (await comeAmministratore('GET', '/api/emergencies/status')).corpo;
    if (serveAperta && !stato?.active) {
        const r = await comeAmministratore('POST', '/api/emergencies/open', { external_code: `BATTERIA-${Date.now().toString().slice(-6)}` });
        if (r.stato !== 201) throw new Error(`emergenza di prova non aperta: ${JSON.stringify(r.corpo)}`);
        return 'aperta un\'emergenza di prova';
    }
    if (!serveAperta && stato?.active) {
        await comeAmministratore('POST', '/api/emergencies/close', {});
        return 'chiusa l\'emergenza rimasta aperta';
    }
    return '';
}

function lanciaSuite(nome) {
    return new Promise((risolvi) => {
        const file = path.join(USCITA, `${nome}.log`);
        const uscita = fs.createWriteStream(file);
        const figlio = spawn(process.execPath, [path.join(CARTELLA_PROVE, `${nome}.mjs`)], { cwd: RADICE, env: { ...ambiente, ...AMBIENTE_DELLA_PROVA[nome] } });
        let testo = '';
        const raccogli = (d) => { testo += d; uscita.write(d); };
        figlio.stdout.on('data', raccogli);
        figlio.stderr.on('data', raccogli);
        const timer = setTimeout(() => { testo += '\n[batteria] tempo scaduto\n'; figlio.kill('SIGKILL'); }, TEMPO_MASSIMO_LUNGHE_MS[nome] ?? TEMPO_MASSIMO_MS);
        figlio.on('close', (codice) => {
            clearTimeout(timer);
            uscita.end();
            risolvi({ codice: codice ?? 'interrotta', testo });
        });
    });
}

process.on('SIGINT', async () => {
    await fermaServer();
    process.exit(130);
});

if (await salute()) fermati(`Sulla porta ${PORTA} risponde già un server: fermalo, la batteria avvia e riavvia il suo.`);
console.log(`Batteria${rapida ? ' rapida, senza ' + [...LENTE].join(', ') : ''}: ${suite.length} prove su ${BASE}. Esiti in ${USCITA}\n`);

const esiti = [];
const motivi = new Map();
function motivoDellaRottura(testo) {
    const righe = testo.split('\n');
    const falliti = righe.filter(r => /^\s*FAIL\b/.test(r));
    return (falliti.length ? falliti : righe.filter(r => r.trim()).slice(-15)).join('\n');
}
try {
    await avviaServer();
    tokenTenuto = await preparaAmministratore();
    await preparaVolontario(tokenTenuto);
    for (const nome of suite) {
        const inizio = Date.now();
        let nota = '';
        let risultato;
        try {
            await avviaServer(nome);
            nota = await sistemaEmergenza(CON_EMERGENZA.has(nome));
            risultato = await lanciaSuite(nome);
        } catch (e) {
            risultato = { codice: 'preparazione', testo: e.message };
            nota = e.message;
        }
        const superati = (risultato.testo.match(/^\s*OK\b/gm) || []).length;
        const falliti = (risultato.testo.match(/^\s*FAIL\b/gm) || []).length;
        const esito = { nome, codice: risultato.codice, superati, falliti, secondi: Math.round((Date.now() - inizio) / 1000), nota };
        esiti.push(esito);
        if (esito.codice !== 0) motivi.set(nome, motivoDellaRottura(risultato.testo));
        console.log(`${esito.codice === 0 ? 'ok   ' : 'ROTTA'} ${nome.padEnd(22)} ${String(superati).padStart(4)} superati ${String(falliti).padStart(3)} falliti ${String(esito.secondi).padStart(4)} s${nota ? `  (${nota})` : ''}`);
    }
    await sistemaEmergenza(false).catch(() => {});
} finally {
    await fermaServer();
}

fs.writeFileSync(path.join(USCITA, 'riepilogo.json'), JSON.stringify(esiti, null, 2));
const rotte = esiti.filter(e => e.codice !== 0);
const totale = esiti.reduce((t, e) => t + e.superati, 0);
console.log(`\n${esiti.length - rotte.length} prove su ${esiti.length} verdi, ${totale} controlli superati.`);
if (rotte.length) {
    console.log(`Rotte: ${rotte.map(e => e.nome).join(', ')}. L'uscita di ognuna è in ${USCITA}.`);
    for (const { nome } of rotte) console.log(`\n--- ${nome}\n${motivi.get(nome)}`);
}
process.exit(rotte.length ? 1 : 0);
