// Le impostazioni si scrivono solo dall'elenco chiuso, ognuna con il suo tipo, e un valore guasto già salvato non rompe niente.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/impostazioni.mjs
// Scrive un segreteria_config guasto direttamente nel database (DB_*) e alla fine rimette tutto com'era.

import 'dotenv/config';
import pg from 'pg';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
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
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};

console.log('\nImpostazioni');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const salva = (valori) => chiama('/api/branding/settings', { method: 'PUT', token: admin, body: valori });
const salvate = (await pool.query('SELECT setting_key, setting_value FROM branding_settings')).rows;

const CASI = [
    ['magazzino_enabled', 'true', 'forse'],
    ['voce_enabled', 'false', 'acceso'],
    ['badge_qr_always_on', 'false', 'si'],
    ['smtp_secure', 'true', 'ssl'],
    ['association_name', 'Gruppo Comunale di Prova', 'x'.repeat(5000)],
    ['card_district_label', 'Distretto Feltrino', 'x'.repeat(151)],
    ['map_center_lat', '46,02', '91'],
    ['map_center_lon', '11.9', '-181'],
    ['map_zoom_level', '13', '13.5'],
    ['minuti_attesa_critica', '30', '0'],
    ['voce_tasto', 'F8', 'F12'],
    ['smtp_host', 'smtp.esempio.it', 'smtp esempio.it'],
    ['smtp_port', '587', 'abc'],
    ['smtp_user', 'sala@esempio.it', `${'x'.repeat(250)}@esempio.it`],
    ['segreteria_config', JSON.stringify({ enabled: false, notify_user: true, custom_emails: 'a@esempio.it, b@esempio.it', notice_days: [30, 0] }),
        JSON.stringify({ enabled: 'sì' })],
    ['segreteria_config', JSON.stringify({ enabled: false }), JSON.stringify({ enabled: false, custom_emails: 'non-una-email' })],
    ['segreteria_config', JSON.stringify({ enabled: false }), JSON.stringify({ enabled: false, campo_inventato: 1 })],
    ['segreteria_config', JSON.stringify({ enabled: false }), '{ non è JSON']
];

try {
    for (const [chiave, buono, storto] of CASI) {
        const ok = await salva({ [chiave]: buono });
        const no = await salva({ [chiave]: storto });
        verifica(`${chiave}: "${String(buono).slice(0, 30)}" passa, "${String(storto).slice(0, 30)}" -> 400`, ok.stato === 200 && no.stato === 400,
            `${ok.stato} ${ok.corpo?.message || ''} / ${no.stato}`);
    }
    const virgola = (await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'map_center_lat'")).rows[0]?.setting_value;
    verifica('la virgola della latitudine si salva come punto', virgola === '46.02', virgola);
    const inventata = await salva({ colore_preferito: 'blu' });
    verifica('una chiave inventata -> 400 che la nomina', inventata.stato === 400 && /sconosciuta: colore_preferito/.test(inventata.corpo?.message || ''), inventata.corpo);
    verifica('un valore vuoto vuol dire predefinito', (await salva({ smtp_port: '', voce_tasto: '' })).stato === 200);
    const insieme = await salva({ association_name: 'Buono', smtp_port: 'abc' });
    const nome = (await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'association_name'")).rows[0]?.setting_value;
    verifica('con un valore storto non si salva niente, nemmeno quelli buoni', insieme.stato === 400 && nome !== 'Buono', nome);

    await pool.query(`INSERT INTO branding_settings (setting_key, setting_value, updated_at) VALUES ('segreteria_config', '{ guasto', NOW())
                      ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`);
    for (const percorso of ['/api/admin/segreteria/dashboard', '/api/branding/settings', '/api/branding/settings/full', '/api/squadre', '/api/attivita']) {
        const r = await chiama(percorso, { token: admin });
        verifica(`con segreteria_config guasto ${percorso} non risponde 500`, r.stato < 500, `HTTP ${r.stato}`);
    }
} finally {
    await pool.query('DELETE FROM branding_settings');
    for (const { setting_key, setting_value } of salvate) {
        await pool.query('INSERT INTO branding_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, NOW())', [setting_key, setting_value]);
    }
    await pool.end();
}

console.log(falliti === 0 ? '\nImpostazioni: tutto a posto\n' : `\nImpostazioni: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
