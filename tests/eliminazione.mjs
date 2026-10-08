// tests/eliminazione.mjs
//
// Eliminare una persona cancella i suoi dati personali. Chi non compare nello
// storico sparisce del tutto, con foto e certificati sul disco. Chi ha creato
// una segnalazione resta solo con nome e cognome, legati a quella
// segnalazione: anagrafica, contatti, ruoli, visite, foto e certificati se ne
// vanno, non entra più, non si riattiva e non compare negli elenchi.
//
// Crea due volontari; se non c'è un'emergenza aperta ne apre una e la chiude
// alla fine. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/eliminazione.mjs

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
// Un PNG di un punto: va bene come foto e come certificato.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token, modulo } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: modulo || (body ? JSON.stringify(body) : undefined),
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const fileSulDisco = (url) => {
    if (!url) return null;
    if (url.startsWith('/api/photos/')) return path.join(RADICE, 'uploads', 'photos', path.basename(url));
    if (url.startsWith('/api/documents/certificates/')) return path.join(RADICE, 'protected_uploads', 'certificates', path.basename(url));
    return null;
};

console.log('\nEliminazione di una persona');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const segreteriaPrima = (await chiama('/api/branding/settings')).corpo?.segreteria_config;
await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { segreteria_config: JSON.stringify({ enabled: true }) } });

// Un volontario con password, codice fiscale, telefono, foto e una visita con certificato.
async function volontario(nome, cf) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome, cognome: `Elimina${suffisso}`, role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = `Elimina!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    await chiama(`/api/admin/users/${n.id}/anagrafica`, { method: 'PUT', token: admin, body: { codice_fiscale: cf, telefono: '3331234567' } });
    const foto = new FormData();
    foto.append('photo', new Blob([PNG], { type: 'image/png' }), 'foto.png');
    await chiama(`/api/admin/users/${n.id}/photo`, { method: 'POST', token: admin, modulo: foto });
    const visita = new FormData();
    visita.append('document', new Blob([PNG], { type: 'image/png' }), 'certificato.png');
    for (const [k, v] of Object.entries({ visit_type_id: '1', last_visit_date: '2026-01-10', expiry_date: '2027-01-10', status: 'Idoneo' })) visita.append(k, v);
    await chiama(`/api/admin/users/${n.id}/medical-records`, { method: 'POST', token: admin, modulo: visita });
    const r = await pool.query(
        `SELECT u.photo_url, (SELECT document_url FROM user_medical_records WHERE user_id = u.id LIMIT 1) AS certificato
           FROM users u WHERE u.id = $1`, [n.id]);
    return { id: n.id, username: n.username, password, file: [r.rows[0].photo_url, r.rows[0].certificato].map(fileSulDisco) };
}

let emergenzaAperta = null;
const daTogliere = [];
try {
    // 1. Chi non compare nello storico sparisce del tutto.
    const anna = await volontario('Anna', `ANNELM${suffisso}A001`.slice(0, 16).padEnd(16, 'X'));
    daTogliere.push(anna.id);
    verifica('i suoi file sono sul disco', anna.file.length === 2 && anna.file.every(f => f && fs.existsSync(f)), anna.file);
    const viaAnna = await chiama(`/api/users/${anna.id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    verifica('eliminata del tutto', viaAnna.stato === 200 && viaAnna.corpo?.modo === 'cancellato', viaAnna);
    verifica('la riga non c\'è più', (await pool.query('SELECT 1 FROM users WHERE id = $1', [anna.id])).rowCount === 0);
    verifica('foto e certificato tolti dal disco', anna.file.every(f => !fs.existsSync(f)), anna.file.filter(f => fs.existsSync(f)));

    // 2. Chi ha creato una segnalazione resta solo con il nome.
    const bruno = await volontario('Bruno', `BRNELM${suffisso}B002`.slice(0, 16).padEnd(16, 'X'));
    daTogliere.push(bruno.id);
    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (!(stato?.emergency || stato?.active)) {
        emergenzaAperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `ELIM-${suffisso}`, name: 'Prova eliminazione' } })).corpo?.emergency;
    }
    const tokenBruno = (await accediConFetch(BASE, bruno.username, bruno.password)).token;
    const segnalazione = await chiama('/api/reports', { method: 'POST', token: tokenBruno, body: { title: `Albero caduto ${suffisso}` } });
    verifica('Bruno crea una segnalazione', segnalazione.stato === 201 || segnalazione.stato === 200, segnalazione);
    const viaBruno = await chiama(`/api/users/${bruno.id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    verifica('eliminato, con il solo nome nello storico', viaBruno.stato === 200 && viaBruno.corpo?.modo === 'solo_nome', viaBruno);
    const riga = (await pool.query(
        `SELECT nome, cognome, username, password, email, codice_fiscale, telefono, indirizzo, photo_url, mfa_segreto, is_active, eliminato_il,
                (SELECT COUNT(*)::int FROM utenti_ruoli WHERE user_id = u.id) AS ruoli,
                (SELECT COUNT(*)::int FROM user_medical_records WHERE user_id = u.id) AS visite,
                (SELECT COUNT(*)::int FROM token_rinnovo WHERE user_id = u.id) AS rinnovi
           FROM users u WHERE id = $1`, [bruno.id])).rows[0];
    verifica('restano nome, cognome e nome utente', riga?.nome === 'Bruno' && riga?.cognome === `Elimina${suffisso}` && riga?.username === bruno.username, riga);
    verifica('il resto è cancellato', riga && [riga.password, riga.email, riga.codice_fiscale, riga.telefono, riga.indirizzo, riga.photo_url, riga.mfa_segreto].every(v => v === null)
        && riga.ruoli === 0 && riga.visite === 0 && riga.rinnovi === 0 && riga.is_active === false && !!riga.eliminato_il, riga);
    verifica('foto e certificato tolti dal disco', bruno.file.every(f => !fs.existsSync(f)), bruno.file.filter(f => fs.existsSync(f)));
    const autore = (await pool.query(
        `SELECT u.nome, u.cognome FROM reports r JOIN users u ON u.id = r.creator_user_id WHERE r.title = $1`, [`Albero caduto ${suffisso}`])).rows[0];
    verifica('la segnalazione dice ancora chi l\'ha creata', autore?.nome === 'Bruno', autore);
    const elenco = (await chiama('/api/admin/users', { token: admin })).corpo || [];
    verifica('non compare più fra gli utenti', !elenco.some(u => u.id === bruno.id));
    const accesso = await chiama('/login', { method: 'POST', body: { username: bruno.username, password: bruno.password } });
    verifica('non entra più', !accesso.corpo?.token, accesso.stato);
    const riattiva = await chiama(`/api/admin/users/${bruno.id}/toggle-status`, { method: 'PATCH', token: admin });
    verifica('non si riattiva', riattiva.stato === 404, riattiva);
    const ancora = await chiama(`/api/users/${bruno.id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    verifica('eliminarlo di nuovo non trova nessuno', ancora.stato === 404, ancora);
} finally {
    if (emergenzaAperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    for (const id of daTogliere) await chiama(`/api/users/${id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { segreteria_config: typeof segreteriaPrima === 'string' ? segreteriaPrima : JSON.stringify(segreteriaPrima || { enabled: false }) } });
    await pool.end();
}

console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
