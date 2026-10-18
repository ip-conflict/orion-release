// Istanza in container: aggiornamento e ritorno chiesti dalla pagina Sistema ed eseguiti
// dall'agente, versione che non parte, separazione da un'altra istanza. Come root, con due
// istanze appena create da scripts/docker/nuova-istanza.sh e le immagini <nuova> e <rotta>.
//   ORION_BASE=... PROVA_ISTANZA=alfa PROVA_ALTRA=beta PROVA_NUOVA=1.2.4 PROVA_ROTTA=1.2.5 node tests/container.mjs

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = process.env.ORION_BASE || '/srv/orion';
const ISTANZA = process.env.PROVA_ISTANZA || 'alfa';
const ALTRA = process.env.PROVA_ALTRA || 'beta';
const NUOVA = process.env.PROVA_NUOVA;
const ROTTA = process.env.PROVA_ROTTA;
const AGENTE = process.env.ORION_AGENTE || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'docker', 'orion-agente.sh');
const DIR = path.join(BASE, ISTANZA);
const leggiEnv = (dir, nome) => fs.readFileSync(path.join(dir, '.env'), 'utf8').match(new RegExp(`^${nome}=(.*)$`, 'm'))?.[1];
const URL_ISTANZA = `http://127.0.0.1:${leggiEnv(DIR, 'ORION_PORTA')}`;

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token } = {}) => {
    try {
        const r = await fetch(URL_ISTANZA + percorso, {
            method, body: body ? JSON.stringify(body) : undefined,
            headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
        });
        return { stato: r.status, corpo: await r.json().catch(() => null) };
    } catch {
        return { stato: 0, corpo: null };
    }
};
const compose = (dir, ...argomenti) => execFileSync('docker', ['compose', '-f', path.join(dir, 'compose.yaml'), ...argomenti], { encoding: 'utf8' });
const sql = (q) => compose(DIR, 'exec', '-T', 'db', 'psql', '-U', 'orion_db_user', '-d', 'orion_db', '-tAc', q).trim();
const giro = () => execFileSync(AGENTE, ['giro'], { encoding: 'utf8', env: process.env });
const aspetta = (ms) => new Promise(r => setTimeout(r, ms));

async function attendiServer() {
    for (let i = 0; i < 60; i++) {
        if ((await chiama('/api/salute')).stato === 200) return true;
        await aspetta(2000);
    }
    return false;
}

async function operazioneFinita(token) {
    for (let i = 0; i < 60; i++) {
        const r = await chiama('/api/sistema/operazione', { token });
        if (r.corpo?.finita) return r.corpo;
        await aspetta(2000);
    }
    return null;
}

console.log(`\nContainer: istanza ${ISTANZA}`);

const password = `Turno!${Date.now().toString().slice(-6)}Lampione1`;
const codice = fs.readFileSync(path.join(DIR, 'dati', 'PRIMO-ACCESSO.txt'), 'utf8').match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){3}/)?.[0];
let r = await chiama('/api/primo-accesso', { method: 'POST', body: { codice, nome: 'Prova', cognome: 'Container', username: 'admin', password } });
verifica('il primo amministratore si crea con il codice scritto nella cartella dei dati', r.stato === 201 || r.stato === 200, r);
const { token } = await accediConFetch(URL_ISTANZA, 'admin', password);

const versionePrima = (await chiama('/api/sistema/versione', { token })).corpo;
verifica('la pagina Sistema vede l\'agente e non chiede npm né tar', versionePrima?.requisiti?.pronto === true, versionePrima?.requisiti);

r = await chiama('/api/sistema/backup', { token });
verifica('i backup notturni e quelli dell\'applicazione stanno nelle cartelle dell\'istanza',
    r.corpo?.cartella_notturni === '/backup/notte' && r.corpo?.cartella_applicazione === '/backup/auto', r.corpo);

sql(`INSERT INTO branding_settings (setting_key, setting_value) VALUES ('aggiornamenti_stato', '{"versione":"${NUOVA}","pacchetto":"immagine","controllato_il":"${new Date().toISOString()}"}')
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`);
r = await chiama('/api/sistema/aggiornamenti/applica', { method: 'POST', token, body: { password, conferma: 'AGGIORNA' } });
verifica('l\'aggiornamento diventa una richiesta all\'agente', r.stato === 200 && /chiesto al server/.test(r.corpo?.message), r);
const richiesta = compose(DIR, 'exec', '-T', 'app', 'cat', '/agente/richieste/richiesta');
verifica('la richiesta contiene solo id, tipo e versione', /^id=[0-9a-f]{16}\ntipo=aggiornamento\nversione=[\d.]+\n$/.test(richiesta), richiesta);
r = await chiama('/api/sistema/operazione', { token });
verifica('la pagina mostra l\'operazione in corso', r.corpo && !r.corpo.finita, r.corpo);

giro();
await attendiServer();
let op = await operazioneFinita(token);
verifica(`aggiornamento alla ${NUOVA} completato`, op?.esito === 'fatto', op);
verifica('i passi arrivano dall\'agente', (op?.passi || []).map(p => p.testo).join('|').includes('Backup del database'), op?.passi);
r = await chiama('/api/sistema/versione', { token });
verifica(`gira la ${NUOVA}`, r.corpo?.versione_installata === NUOVA, r.corpo?.versione_installata);
verifica('la migrazione della versione nuova è applicata', sql("SELECT to_regclass('prova_container') IS NOT NULL") === 't');
const notte = fs.readdirSync(path.join(DIR, 'backup', 'notte'));
verifica('il backup di prima è fra i notturni, di root, con il nome dell\'istanza', notte.some(n => new RegExp(`^orion_${ISTANZA}_db_\\d{8}_\\d{6}_pre-aggiornamento\\.sql\\.gz$`).test(n))
    && fs.statSync(path.join(DIR, 'backup', 'notte', notte.find(n => /pre-aggiornamento/.test(n)))).uid === 0, notte);
r = await chiama('/api/sistema/operazione', { method: 'DELETE', token });
verifica('"Ho capito" chiude il resoconto', r.stato === 200 && (await chiama('/api/sistema/operazione', { token })).corpo === null);

r = await chiama('/api/sistema/versioni-precedenti', { token });
const precedente = r.corpo?.versioni?.[0];
verifica('fra le versioni precedenti c\'è quella di prima, con la modifica annullabile e i suoi dati',
    precedente?.versione === versionePrima.versione_installata && precedente?.modifiche?.annullabili === true
    && precedente.modifiche.elenco.includes('prova container') && !!precedente.dati, r.corpo);

r = await chiama('/api/sistema/versioni-precedenti/torna', { method: 'POST', token, body: { nome: precedente?.nome, dati: false, password, conferma: 'TORNA' } });
verifica('il ritorno diventa una richiesta all\'agente', r.stato === 200, r);
giro();
await attendiServer();
op = await operazioneFinita(token);
verifica(`ritorno alla ${versionePrima.versione_installata} completato tenendo i dati`, op?.esito === 'fatto', op);
r = await chiama('/api/sistema/versione', { token });
verifica('gira di nuovo la versione di prima', r.corpo?.versione_installata === versionePrima.versione_installata, r.corpo?.versione_installata);
verifica('la tabella della versione nuova è stata tolta', sql("SELECT to_regclass('prova_container') IS NULL") === 't');
verifica('l\'amministratore c\'è ancora', sql("SELECT count(*) FROM users WHERE username = 'admin'") === '1');
await chiama('/api/sistema/operazione', { method: 'DELETE', token });

sql(`UPDATE branding_settings SET setting_value = '{"versione":"${ROTTA}","pacchetto":"immagine"}' WHERE setting_key = 'aggiornamenti_stato'`);
r = await chiama('/api/sistema/aggiornamenti/applica', { method: 'POST', token, body: { password, conferma: 'AGGIORNA' } });
verifica(`chiesta la ${ROTTA}, che non parte`, r.stato === 200, r);
giro();
await attendiServer();
op = await operazioneFinita(token);
verifica('l\'agente se ne accorge e torna alla versione di prima', op?.esito === 'errore' && /non è partita/.test(op?.messaggio) && /database com'era/.test(op?.messaggio), op);
r = await chiama('/api/sistema/versione', { token });
verifica('gira ancora la versione di prima, sana', r.corpo?.versione_installata === versionePrima.versione_installata && (await chiama('/api/salute')).stato === 200, r.corpo?.versione_installata);
verifica('le migrazioni della versione rotta sono state annullate', sql("SELECT to_regclass('prova_container') IS NULL") === 't');
await chiama('/api/sistema/operazione', { method: 'DELETE', token });

sql(`UPDATE branding_settings SET setting_value = '{"versione":"${NUOVA}","pacchetto":"immagine"}' WHERE setting_key = 'aggiornamenti_stato'`);
await chiama('/api/sistema/aggiornamenti/applica', { method: 'POST', token, body: { password, conferma: 'AGGIORNA' } });
giro();
await attendiServer();
op = await operazioneFinita(token);
await chiama('/api/sistema/operazione', { method: 'DELETE', token });
sql("INSERT INTO prova_container (nota) VALUES ('scritta con la versione nuova')");
const conDati = (await chiama('/api/sistema/versioni-precedenti', { token })).corpo?.versioni?.[0];
r = await chiama('/api/sistema/versioni-precedenti/torna', { method: 'POST', token, body: { nome: conDati?.nome, dati: true, password, conferma: 'TORNA' } });
giro();
await attendiServer();
op = await operazioneFinita(token);
verifica('ritorno con i dati di allora: database com\'era prima dell\'aggiornamento', op?.esito === 'fatto'
    && sql("SELECT to_regclass('prova_container') IS NULL") === 't' && sql("SELECT count(*) FROM users WHERE username = 'admin'") === '1', op);
await chiama('/api/sistema/operazione', { method: 'DELETE', token });

const logo = new FormData();
logo.append('logoFile', new Blob([fs.readFileSync(new URL('../public/logo.png', import.meta.url))], { type: 'image/png' }), 'logo.png');
r = await fetch(`${URL_ISTANZA}/api/branding/logo`, { method: 'POST', body: logo, headers: { Authorization: `Bearer ${token}` } });
const servito = Buffer.from(await (await fetch(`${URL_ISTANZA}/logo.png`)).arrayBuffer());
verifica('il logo caricato va nella cartella dei dati e si serve da lì', r.ok
    && servito.equals(fs.readFileSync(path.join(DIR, 'dati', 'loghi', 'logo.png'))), r.status);

r = await chiama('/api/sistema/backup', { method: 'POST', token });
verifica('il backup dalla pagina si scrive nella cartella dell\'applicazione', r.stato === 200 && fs.existsSync(path.join(DIR, 'backup', 'auto', r.corpo?.file || '-')), r);
const oraDi = (d) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(d).replace(':', '');
const oraNelNome = (r.corpo?.file || '').match(/_db_\d{8}_(\d{4})\d{2}_manuale\.sql\.gz$/)?.[1];
verifica('il suo nome dice istanza, ora italiana e motivo', (r.corpo?.file || '').startsWith(`orion_${ISTANZA}_db_`)
    && [oraDi(new Date()), oraDi(new Date(Date.now() - 60000))].includes(oraNelNome), r.corpo?.file);
fs.copyFileSync(path.join(DIR, 'backup', 'auto', r.corpo.file), path.join(DIR, 'backup', 'auto', 'db_20200101_000000_manuale.sql.gz'));
const vecchio = (await chiama('/api/sistema/backup', { token })).corpo?.backup?.find(b => b.nome === 'db_20200101_000000_manuale.sql.gz');
const scaricato = await fetch(`${URL_ISTANZA}/api/sistema/backup/app/db_20200101_000000_manuale.sql.gz`, { headers: { Authorization: `Bearer ${token}` } });
verifica('un backup col nome di prima si legge ancora, e scaricato prende il nome dell\'istanza', vecchio?.motivo === 'richiesto a mano'
    && (scaricato.headers.get('content-disposition') || '').includes(`orion_${ISTANZA}_db_20200101_000000_manuale.sql.gz`), { vecchio, intestazione: scaricato.headers.get('content-disposition') });
await scaricato.arrayBuffer();
fs.rmSync(path.join(DIR, 'backup', 'auto', 'db_20200101_000000_manuale.sql.gz'));
execFileSync(AGENTE, ['backup', ISTANZA], { encoding: 'utf8', env: process.env });
const notturno = fs.readdirSync(path.join(DIR, 'backup', 'notte')).filter(n => new RegExp(`^orion_${ISTANZA}_db_\\d{8}_\\d{6}_notte\\.sql\\.gz$`).test(n)).sort().at(-1);
verifica('il backup notturno scrive dump cifrato e copia dei file', !!notturno
    && fs.readFileSync(path.join(DIR, 'backup', 'notte', notturno)).subarray(0, 8).toString() === 'ORIONCF1'
    && fs.existsSync(path.join(DIR, 'backup', 'file', 'protected_uploads')), notturno);
sql("INSERT INTO audit_log (username, action, entity_type) VALUES ('prova', 'prova.dopo-il-backup', 'prova')");
r = await chiama('/api/sistema/ripristino', { method: 'POST', token, body: { cartella: 'notte', nome: notturno, password, conferma: 'RIPRISTINA', ripristina_file: true } });
verifica('il ripristino dalla pagina parte anche nel container', r.stato === 200, r);
await aspetta(4000);
await attendiServer();
op = await operazioneFinita(token);
verifica('ripristino completato e programma ripartito da solo', op?.esito === 'fatto'
    && sql("SELECT count(*) FROM audit_log WHERE action = 'prova.dopo-il-backup'") === '0', op);
await chiama('/api/sistema/operazione', { method: 'DELETE', token });

fs.writeFileSync(path.join(DIR, '.env'), fs.readFileSync(path.join(DIR, '.env'), 'utf8').replace(/^ORION_AGGIORNAMENTI=.*$/m, 'ORION_AGGIORNAMENTI=chiedi'));
giro();
r = await chiama('/api/sistema/versione', { token });
verifica('con "chiedi" la pagina avvisa che serve l\'approvazione', (r.corpo?.requisiti?.avvertenze || []).some(a => /approva/.test(a)), r.corpo?.requisiti);
sql(`UPDATE branding_settings SET setting_value = '{"versione":"${NUOVA}","pacchetto":"immagine"}' WHERE setting_key = 'aggiornamenti_stato'`);
await chiama('/api/sistema/aggiornamenti/applica', { method: 'POST', token, body: { password, conferma: 'AGGIORNA' } });
giro();
r = await chiama('/api/sistema/operazione', { token });
verifica('la richiesta resta in attesa del gestore', r.corpo && !r.corpo.finita && /approvazione/.test(r.corpo.passi?.at(-1)?.testo), r.corpo);
execFileSync(AGENTE, ['rifiuta', ISTANZA], { encoding: 'utf8', env: process.env });
op = await operazioneFinita(token);
verifica('rifiutata dal gestore, non cambia niente', op?.esito === 'errore' && (await chiama('/api/sistema/versione', { token })).corpo?.versione_installata === versionePrima.versione_installata, op);
await chiama('/api/sistema/operazione', { method: 'DELETE', token });
fs.writeFileSync(path.join(DIR, '.env'), fs.readFileSync(path.join(DIR, '.env'), 'utf8').replace(/^ORION_AGGIORNAMENTI=.*$/m, 'ORION_AGGIORNAMENTI=automatici'));

const disco = fs.mkdtempSync(path.join(BASE, 'disco-'));
execFileSync(AGENTE, ['disco', 'copia'], { encoding: 'utf8', env: { ...process.env, ORION_DISCO_CARTELLA: disco } });
const archivi = fs.readdirSync(path.join(disco, ISTANZA, 'file'));
const sulDisco = fs.readdirSync(path.join(disco, ISTANZA, 'db'));
verifica('sul disco esterno vanno i dump e un archivio dei file, cifrati e con il nome dell\'istanza', sulDisco.length > 0 && archivi.length === 1
    && new RegExp(`^orion_${ISTANZA}_file_\\d{8}_\\d{6}\\.tar\\.gz$`).test(archivi[0]) && sulDisco.every(n => n.startsWith(`orion_${ISTANZA}_db_`))
    && [...sulDisco.map(n => path.join(disco, ISTANZA, 'db', n)), path.join(disco, ISTANZA, 'file', archivi[0])]
        .every(f => fs.readFileSync(f).subarray(0, 8).toString() === 'ORIONCF1'), { sulDisco, archivi });
const tarChiaro = path.join(disco, 'prova.tar.gz');
execFileSync('node', [new URL('../scripts/decifra-backup.mjs', import.meta.url).pathname, path.join(disco, ISTANZA, 'file', archivi[0]), tarChiaro,
    path.join(DIR, 'chiave', 'chiave-dati.key')]);
verifica('con la chiave dell\'istanza l\'archivio dei file si riapre', /protected_uploads\//.test(execFileSync('tar', ['-tzf', tarChiaro], { encoding: 'utf8' })));
r = await chiama('/api/sistema/backup', { token });
verifica('la pagina Sistema mostra l\'ultima copia su disco', r.corpo?.copia_esterna?.configurato === true && !!r.corpo.copia_esterna.ultima, r.corpo?.copia_esterna);
execFileSync(AGENTE, ['backup'], { encoding: 'utf8', env: { ...process.env, ORION_DISCO_CARTELLA: path.join(disco, 'scollegato') } });
r = await chiama('/api/sistema/backup', { token });
verifica('con il disco scollegato la copia salta, e l\'ultima resta quella vera', r.corpo?.copia_esterna?.esito === 'assente' && !!r.corpo.copia_esterna.ultima, r.corpo?.copia_esterna);
fs.rmSync(disco, { recursive: true, force: true });

const app = compose(DIR, 'ps', '-q', 'app').trim();
const prova = (codiceJs) => {
    try {
        return execFileSync('docker', ['exec', app, 'node', '-e', codiceJs], { encoding: 'utf8', timeout: 20000 }).trim();
    } catch (e) {
        return `errore: ${e.stderr || e.message}`;
    }
};
verifica('il programma non può scrivere il proprio codice', /EROFS|EACCES/.test(prova("require('fs').writeFileSync('/app/src/server.js', 'x')")));
verifica('il programma non vede il database dell\'altra istanza',
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/.test(prova(`const s = require('net').connect(5432, 'orion-${ALTRA}-db-1'); s.on('connect', () => { console.log('collegato'); process.exit(0); }); s.on('error', e => { console.log(e.code); process.exit(0); }); setTimeout(() => { console.log('ETIMEDOUT'); process.exit(0); }, 5000);`)));
verifica('il programma gira con l\'utente dell\'istanza', prova('console.log(process.getuid())') === leggiEnv(DIR, 'ORION_UID'));
verifica('una richiesta che punta a un file di sistema si legge nel container, non sull\'host: nessuna operazione', (() => {
    const prima = fs.readFileSync(path.join(DIR, 'agente', 'stato', 'operazione.json'), 'utf8');
    execFileSync('docker', ['exec', app, 'sh', '-c', 'ln -sf /etc/shadow /agente/richieste/richiesta']);
    giro();
    execFileSync('docker', ['exec', app, 'rm', '-f', '/agente/richieste/richiesta']);
    return fs.readFileSync(path.join(DIR, 'agente', 'stato', 'operazione.json'), 'utf8') === prima;
})());

console.log(`\nContainer: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
