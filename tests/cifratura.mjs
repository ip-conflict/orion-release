// tests/cifratura.mjs
//
// La cifratura vista dal disco: un certificato caricato non è in chiaro ma si
// riscarica uguale; un backup è cifrato, si verifica, e una sua copia alterata
// viene rifiutata; la chiave di recupero si mostra solo con la password e
// decifra davvero i backup; la password della posta nel database è cifrata.
//
// Va lanciata sulla stessa macchina del server (guarda i file sul disco), su
// un'istanza di collaudo:
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/cifratura.mjs

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import pg from 'pg';
import { accediConFetch } from './accesso-prova.mjs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const RADICE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.ORION_ADMIN_PASSWORD;
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const accesso = await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', PASSWORD);
const intestazioni = { Authorization: `Bearer ${accesso.token}` };
const api = async (percorso, opzioni = {}) => {
    const corpo = opzioni.body && !(opzioni.body instanceof FormData) ? JSON.stringify(opzioni.body) : opzioni.body;
    const r = await fetch(BASE + percorso, { ...opzioni, body: corpo, headers: { ...intestazioni, ...(corpo && !(opzioni.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) } });
    const tipo = r.headers.get('content-type') || '';
    return { stato: r.status, corpo: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const cifrato = (percorso) => fs.readFileSync(percorso).subarray(0, 8).toString() === 'ORIONCF1';

console.log('\nCifratura');

let stato = (await api('/api/sistema/cifratura')).corpo;
verifica('la cifratura è attiva', stato?.stato === 'pronta', stato);

// 1. Un certificato: cifrato sul disco, uguale quando si riscarica.
const pdf = Buffer.from('%PDF-1.4\n% certificato di prova per la cifratura\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const tipi = (await api('/api/admin/medical-visit-types')).corpo;
let tipoVisita = tipi?.[0]?.id;
if (!tipoVisita) tipoVisita = (await api('/api/admin/medical-visit-types', { method: 'POST', body: { name: `Visita cifratura ${Date.now()}`, validity_months: 12 } })).corpo?.id;
const modulo = new FormData();
modulo.append('visit_type_id', String(tipoVisita));
modulo.append('last_visit_date', '2026-01-10');
modulo.append('expiry_date', '2027-01-10');
modulo.append('status', 'Idoneo');
modulo.append('document', new Blob([pdf], { type: 'application/pdf' }), 'certificato.pdf');
const caricato = await api(`/api/admin/users/${accesso.userId}/medical-records`, { method: 'POST', body: modulo });
const visita = (await pool.query('SELECT id, document_url FROM user_medical_records WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [accesso.userId])).rows[0];
const nomeFile = path.basename(visita?.document_url || '');
const suDisco = path.join(RADICE, 'protected_uploads', 'certificates', nomeFile);
verifica('il certificato sul disco è cifrato', caricato.stato < 300 && fs.existsSync(suDisco) && cifrato(suDisco) && !fs.readFileSync(suDisco).includes('certificato di prova'), { stato: caricato.stato, nomeFile });
const scaricato = await api(visita.document_url);
verifica('e si riscarica identico', scaricato.stato === 200 && Buffer.compare(scaricato.corpo, pdf) === 0, { stato: scaricato.stato, lunghezza: scaricato.corpo?.length });
await api(`/api/admin/medical-records/${visita.id}`, { method: 'DELETE' });

// 2. Un backup: cifrato, si verifica; una copia alterata no.
const fatto = await api('/api/sistema/backup', { method: 'POST' });
const elenco = (await api('/api/sistema/backup')).corpo.backup;
const backup = elenco.find(b => b.cartella === 'app');
const cartella = process.env.ORION_BACKUP_DIR || '/var/backups/orion/auto';
const fileBackup = path.join(cartella, backup.nome);
verifica('il backup è cifrato', fatto.stato === 200 && cifrato(fileBackup), backup);
let v = (await api(`/api/sistema/backup/app/${backup.nome}/verifica`, { method: 'POST' })).corpo;
verifica('il backup cifrato si verifica', v?.valido === true, v);
const dati = fs.readFileSync(fileBackup);
dati[Math.floor(dati.length / 2)] ^= 0xff;
const alterato = backup.nome.replace('.sql.gz', '_alterato.sql.gz');
fs.writeFileSync(path.join(cartella, alterato), dati);
v = (await api(`/api/sistema/backup/app/${alterato}/verifica`, { method: 'POST' })).corpo;
verifica('una copia alterata del backup viene rifiutata', v?.valido === false, v);
fs.rmSync(path.join(cartella, alterato), { force: true });

// 3. La chiave di recupero: solo con la password, e decifra davvero i backup.
let r = await api('/api/sistema/cifratura/recupero', { method: 'POST', body: { password: 'sbagliata' } });
verifica('la chiave di recupero non si mostra con la password sbagliata', r.stato === 403, r.stato);
r = await api('/api/sistema/cifratura/recupero', { method: 'POST', body: { password: PASSWORD } });
const recupero = r.corpo?.chiave;
verifica('con la password giusta sì (52 caratteri a gruppi di quattro)', /^([A-Z2-9]{4}-){12}[A-Z2-9]{4}$/.test(recupero || ''), r.corpo);
r = await api('/api/sistema/cifratura/chiave', { method: 'POST', body: { password: PASSWORD, chiave: 'AAAA-'.repeat(12) + 'AAAA' } });
verifica('una chiave di recupero di un\'altra installazione viene rifiutata', r.stato === 400, r);
const uscita = path.join(fs.mkdtempSync('/tmp/orion-cifratura-'), 'dump.sql.gz');
execFileSync('node', [path.join(RADICE, 'scripts', 'decifra-backup.mjs'), fileBackup, uscita], { env: { ...process.env, ORION_CHIAVE_RECUPERO: recupero } });
const testo = zlib.gunzipSync(fs.readFileSync(uscita)).toString('utf8', 0, 2000);
verifica('con la chiave di recupero il backup si decifra fuori da ORION', /PostgreSQL database dump/.test(testo), testo.slice(0, 80));
fs.rmSync(path.dirname(uscita), { recursive: true, force: true });

// 4. La password della posta: cifrata nel database, mai al browser.
const prima = (await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'smtp_pass'")).rows[0]?.setting_value ?? null;
await api('/api/branding/settings', { method: 'PUT', body: { smtp_pass: 'segreta-di-prova' } });
const nelDb = (await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'smtp_pass'")).rows[0]?.setting_value;
verifica('la password della posta nel database è cifrata', typeof nelDb === 'string' && nelDb.startsWith('enc1:') && !nelDb.includes('segreta'), nelDb?.slice(0, 20));
await api('/api/branding/settings', { method: 'PUT', body: { smtp_pass: '' } });
const invariata = (await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'smtp_pass'")).rows[0]?.setting_value;
verifica('salvare con il campo vuoto la lascia com\'è', invariata === nelDb);
if (prima === null) await pool.query("DELETE FROM branding_settings WHERE setting_key = 'smtp_pass'");
else await pool.query("UPDATE branding_settings SET setting_value = $1 WHERE setting_key = 'smtp_pass'", [prima]);

await pool.end();
console.log(`\nCifratura: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
