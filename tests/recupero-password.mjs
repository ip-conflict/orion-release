// Il recupero della password trova l'email scritta in qualunque modo, e non rovina il link di attivazione.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/recupero-password.mjs
// Legge il database (DB_*) per vedere se il link è cambiato; crea ed elimina due volontari.

import 'dotenv/config';
import pg from 'pg';
import { accediConFetch, prendiVisione } from './accesso-prova.mjs';

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
const linkSalvato = async (id) => (await pool.query('SELECT reset_token FROM users WHERE id = $1', [id])).rows[0]?.reset_token;
// Il recupero risponde subito e lavora dopo: si aspetta che il link cambi, per al massimo tre secondi.
const linkDopo = async (id, prima) => {
    for (let i = 0; i < 30; i++) {
        const ora = await linkSalvato(id);
        if (ora !== prima) return ora;
        await new Promise(r => setTimeout(r, 100));
    }
    return prima;
};

console.log('\nRecupero della password');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-6);
const creati = [];
try {
    const nuovo = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Mario', cognome: `Recupero${suffisso}`, role: 'volontario' } })).corpo;
    creati.push(nuovo.id);
    const attivazione = await linkSalvato(nuovo.id);
    await chiama('/api/auth/forgot-password', { method: 'POST', body: { identificativo: nuovo.username } });
    verifica("con l'attivazione ancora valida il link non cambia", (await linkDopo(nuovo.id, attivazione)) === attivazione);
    const q = new URL(nuovo.magicLink).searchParams;
    const attivato = await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: `Recupero!${suffisso}Faro` } });
    verifica('e il link di attivazione funziona ancora', attivato.stato === 200, attivato.corpo);

    const nessuno = await chiama('/api/auth/reset-password', { method: 'POST', body: { token: 'a'.repeat(64), id: 99999999, newPassword: `Recupero!${suffisso}Faro` } });
    const sbagliato = await chiama('/api/auth/reset-password', { method: 'POST', body: { token: 'b'.repeat(64), id: nuovo.id, newPassword: `Recupero!${suffisso}Faro` } });
    verifica('il ripristino dà lo stesso messaggio per un id che non esiste e per un link sbagliato',
        nessuno.stato === 400 && sbagliato.stato === 400 && nessuno.corpo?.message === sbagliato.corpo?.message, [nessuno.corpo?.message, sbagliato.corpo?.message]);

    const sessione = (await chiama('/login', { method: 'POST', body: { username: nuovo.username, password: `Recupero!${suffisso}Faro` } })).corpo?.token;
    await prendiVisione(BASE, sessione);
    const cambia = (attuale) => chiama('/api/users/change-password', { method: 'POST', token: sessione,
        body: { currentPassword: attuale, newPassword: `Cambiata!${suffisso}Lince`, confirmPassword: `Cambiata!${suffisso}Lince` } });
    const esiti = [];
    for (let i = 0; i < 6; i++) esiti.push((await cambia(`Sbagliata!${i}Password`)).stato);
    verifica('dopo cinque password attuali sbagliate il cambio password si ferma come l\'accesso', esiti.slice(0, 4).every(s => s === 401) && esiti.at(-1) === 429, esiti);

    const conMaiuscole = `Mario.Recupero${suffisso}@Example.org`;
    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [conMaiuscole, nuovo.id]);
    const prima = await linkSalvato(nuovo.id);
    const chiesto = await chiama('/api/auth/forgot-password', { method: 'POST', body: { identificativo: conMaiuscole.toLowerCase() } });
    verifica("un'email salvata con le maiuscole riceve il link chiesto in minuscolo", chiesto.stato === 200 && (await linkDopo(nuovo.id, prima)) !== prima, chiesto.corpo);

    await pool.query("UPDATE users SET reset_token_expires = NOW() - INTERVAL '1 minute', password = NULL WHERE id = $1", [nuovo.id]);
    const scaduto = await linkSalvato(nuovo.id);
    await chiama('/api/auth/forgot-password', { method: 'POST', body: { identificativo: nuovo.username } });
    verifica("con l'attivazione scaduta arriva un link nuovo", (await linkDopo(nuovo.id, scaduto)) !== scaduto);
} finally {
    for (const id of creati) await chiama(`/api/users/${id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    await pool.end();
}

console.log(falliti === 0 ? '\nRecupero della password: tutto a posto\n' : `\nRecupero della password: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
