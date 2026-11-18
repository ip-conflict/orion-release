// Gli avvisi agli amministratori quando i backup non vanno: backup fermi da più di due giorni, disco
// esterno non collegato, spazio quasi finito, chiave di recupero mai conservata. Un avviso al giorno per
// problema; quando il problema si risolve lo si dimentica.
//
// Va lanciata sulla stessa macchina del server (cambia la data dei backup sul disco), con il controllo
// ogni due secondi, uno spazio minimo impossibile e una cartella dell'agente:
//   ORION_CONTROLLO_BACKUP_MS=2000 ORION_SPAZIO_MINIMO_MB=999999999 ORION_AGENTE_DIR=/tmp/agente-avvisi
// e poi
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... ORION_AGENTE_DIR=/tmp/agente-avvisi node tests/avvisi-backup.mjs

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { accediConFetch } from './accesso-prova.mjs';

const RADICE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATI = process.env.ORION_DATI_DIR ? path.resolve(process.env.ORION_DATI_DIR) : RADICE;
const CARTELLE_BACKUP = [process.env.ORION_BACKUP_DIR || path.join(DATI, 'backup', 'auto'), process.env.ORION_BACKUP_NOTTE_DIR || path.join(DATI, 'backup', 'notte')];
const AGENTE = process.env.ORION_AGENTE_DIR;
const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const attesa = ms => new Promise(r => setTimeout(r, ms));
async function aspetta(condizione, ms = 15000) {
    const fine = Date.now() + ms;
    while (Date.now() < fine) {
        if (await condizione()) return true;
        await attesa(300);
    }
    return !!(await condizione());
}
if (!AGENTE) {
    console.log('Serve ORION_AGENTE_DIR, la stessa del server.');
    process.exit(1);
}

const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const chiama = async (percorso, { method = 'GET', body } = {}) => {
    const r = await fetch(BASE + percorso, { method, body: body ? JSON.stringify(body) : undefined, headers: { Authorization: `Bearer ${admin}`, ...(body ? { 'Content-Type': 'application/json' } : {}) } });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const problemi = async () => ((await chiama('/api/sistema/avvisi')).corpo?.problemi || []).map(p => p.tipo);
const avvisati = async () => JSON.parse((await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'avvisi_sistema'")).rows[0]?.setting_value || '{}');
const mieiAvvisi = async (titolo) => ((await chiama('/api/notifiche')).corpo?.notifiche || []).filter(n => n.tipo === 'backup_problema' && n.titolo === titolo);
const backupSulDisco = () => CARTELLE_BACKUP.flatMap(c => { try { return fs.readdirSync(c).filter(n => n.endsWith('.sql.gz')).map(n => path.join(c, n)); } catch { return []; } });

console.log('\nAvvisi quando i backup non vanno');
const recuperoPrima = (await pool.query("SELECT setting_value, updated_at FROM branding_settings WHERE setting_key = 'cifratura_recupero_salvata'")).rows[0];
try {
    fs.mkdirSync(path.join(AGENTE, 'stato'), { recursive: true });
    verifica('un backup fresco', (await chiama('/api/sistema/backup', { method: 'POST' })).stato === 200);
    verifica('con un backup fresco i backup non sono fermi', !(await problemi()).includes('backup_vecchio'));

    const treGiorniFa = new Date(Date.now() - 3 * 86400000);
    for (const f of backupSulDisco()) fs.utimesSync(f, treGiorniFa, treGiorniFa);
    verifica('con l\'ultimo backup di tre giorni fa sono fermi', (await problemi()).includes('backup_vecchio'));
    verifica('gli amministratori lo sanno nell\'app', await aspetta(async () => (await mieiAvvisi('Backup del database fermi')).length === 1));
    await attesa(5000);
    verifica('una volta sola, non a ogni controllo', (await mieiAvvisi('Backup del database fermi')).length === 1);
    verifica('ricordando da quando', !!(await avvisati()).backup_vecchio?.dal);

    verifica('un altro backup', (await chiama('/api/sistema/backup', { method: 'POST' })).stato === 200);
    verifica('e il problema sparisce', !(await problemi()).includes('backup_vecchio'));
    verifica('anche dalla memoria degli avvisi, così se torna si riavvisa', await aspetta(async () => !(await avvisati()).backup_vecchio));

    fs.writeFileSync(path.join(AGENTE, 'stato', 'disco.json'), JSON.stringify({ configurato: true, ultima: new Date(Date.now() - 86400000).toISOString(), esito: 'assente' }));
    verifica('il disco esterno non collegato è un problema', (await problemi()).includes('disco'));
    verifica('con il suo avviso', await aspetta(async () => (await mieiAvvisi('Disco delle copie non collegato')).length === 1));
    fs.writeFileSync(path.join(AGENTE, 'stato', 'disco.json'), JSON.stringify({ configurato: true, ultima: new Date(Date.now() - 10 * 86400000).toISOString(), esito: 'fatta' }));
    verifica('anche se l\'ultima copia è di dieci giorni fa', (await problemi()).includes('disco'));
    fs.writeFileSync(path.join(AGENTE, 'stato', 'disco.json'), JSON.stringify({ configurato: true, ultima: new Date().toISOString(), esito: 'fatta' }));
    verifica('con la copia di stanotte il disco va bene', !(await problemi()).includes('disco'));

    verifica('lo spazio sotto il minimo è un problema', (await problemi()).includes('spazio'));
    verifica('con il suo avviso', await aspetta(async () => (await mieiAvvisi('Spazio sul server quasi finito')).length === 1));

    await pool.query(`INSERT INTO branding_settings (setting_key, setting_value, updated_at) VALUES ('cifratura_recupero_salvata', 'false', NOW() - INTERVAL '2 days')
        ON CONFLICT (setting_key) DO UPDATE SET setting_value = 'false', updated_at = NOW() - INTERVAL '2 days'`);
    verifica('la chiave di recupero non salvata da due giorni non è ancora un problema', !(await problemi()).includes('recupero'));
    await pool.query("UPDATE branding_settings SET updated_at = NOW() - INTERVAL '8 days' WHERE setting_key = 'cifratura_recupero_salvata'");
    verifica('dopo una settimana sì', (await problemi()).includes('recupero'));
    verifica('con il suo avviso', await aspetta(async () => (await mieiAvvisi('Chiave di recupero non salvata')).length === 1));

    const pagina = await fetch(`${BASE}/admin/sistema.html`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.text());
    verifica('la pagina Sistema ha il riquadro delle cose da sistemare', pagina.includes('id="pannello-avvisi"'));
} finally {
    if (recuperoPrima) {
        await pool.query('UPDATE branding_settings SET setting_value = $1, updated_at = $2 WHERE setting_key = \'cifratura_recupero_salvata\'', [recuperoPrima.setting_value, recuperoPrima.updated_at]);
    } else {
        await pool.query("DELETE FROM branding_settings WHERE setting_key = 'cifratura_recupero_salvata'");
    }
    fs.rmSync(path.join(AGENTE, 'stato', 'disco.json'), { force: true });
    await pool.end();
}

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutte le verifiche superate.');
process.exit(falliti ? 1 : 0);
