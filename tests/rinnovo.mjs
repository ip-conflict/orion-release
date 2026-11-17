// Il token per l'impronta nasce solo da un accesso con la password appena fatto, uno per sessione, e non dura per sempre.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... JWT_SECRET=... node tests/rinnovo.mjs
// Firma da sé una sessione "vecchia" con il JWT_SECRET dell'istanza di prova e legge il database (DB_*).

import 'dotenv/config';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
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

console.log("\nToken per l'impronta");
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-6);
const password = `Impronta!${suffisso}Faro`;
let persona = null;
try {
    persona = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Rino', cognome: `Rinnovo${suffisso}`, role: 'volontario' } })).corpo;
    const q = new URL(persona.magicLink).searchParams;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const sessione = (await chiama('/login', { method: 'POST', body: { username: persona.username, password } })).corpo.token;
    await prendiVisione(BASE, sessione);

    const primo = await chiama('/api/app/rinnovo', { method: 'POST', token: sessione, body: { dispositivo: 'prova' } });
    verifica("subito dopo l'accesso con la password il token si crea", primo.stato === 201 && !!primo.corpo?.rinnovo, primo.corpo);
    const secondo = await chiama('/api/app/rinnovo', { method: 'POST', token: sessione, body: { dispositivo: 'prova' } });
    verifica('la stessa sessione non ne crea un secondo -> 409', secondo.stato === 409, `HTTP ${secondo.stato}`);

    // L'attivazione ha chiuso le sessioni nate prima di lei: una sessione di sei minuti fa deve esserle successiva.
    await pool.query("UPDATE users SET sessioni_valide_dal = NOW() - INTERVAL '10 minutes' WHERE id = $1", [persona.id]);
    const { iat, exp, jti, ...dati } = jwt.decode(sessione);
    const vecchia = jwt.sign({ ...dati, ems: Date.now() - 6 * 60 * 1000 }, process.env.JWT_SECRET, { expiresIn: '1d', algorithm: 'HS256', jwtid: crypto.randomUUID() });
    const daVecchia = await chiama('/api/app/rinnovo', { method: 'POST', token: vecchia, body: {} });
    verifica('da una sessione di sei minuti fa no -> 403', daVecchia.stato === 403, `HTTP ${daVecchia.stato}`);

    const rientro = await chiama('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: primo.corpo?.rinnovo } });
    verifica("con il token si rientra", rientro.stato === 200 && !!rientro.corpo?.token, rientro.corpo);
    const daRinnovo = await chiama('/api/app/rinnovo', { method: 'POST', token: rientro.corpo?.token, body: {} });
    verifica('una sessione nata dal token non ne crea un altro -> 403', daRinnovo.stato === 403, `HTTP ${daRinnovo.stato}`);

    const elenco = await chiama('/api/sessioni/dispositivi', { token: sessione });
    const mio = elenco.corpo?.rinnovi?.[0];
    verifica('"I miei dispositivi" elenca il token, senza impronta', elenco.stato === 200 && mio?.dispositivo === 'prova' && !JSON.stringify(elenco.corpo).includes('impronta'), elenco.corpo);
    verifica("il token di un altro non si toglie -> 404", (await chiama(`/api/app/rinnovo/${mio?.id}`, { method: 'DELETE', token: admin })).stato === 404);

    const altra = (await chiama('/login', { method: 'POST', body: { username: persona.username, password } })).corpo.token;
    const nuovoToken = (await chiama('/api/app/rinnovo', { method: 'POST', token: altra, body: { dispositivo: 'secondo' } })).corpo?.rinnovo;
    const daTogliere = (await chiama('/api/sessioni/dispositivi', { token: sessione })).corpo?.rinnovi?.find(r => r.dispositivo === 'secondo');
    verifica('il proprio si toglie', (await chiama(`/api/app/rinnovo/${daTogliere?.id}`, { method: 'DELETE', token: sessione })).stato === 200);
    verifica('e non fa più entrare', (await chiama('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: nuovoToken } })).stato === 401);

    verifica('"Esci da tutti gli altri" vuole la password giusta -> 403',
        (await chiama('/api/sessioni/chiudi-le-altre', { method: 'POST', token: sessione, body: { password: 'sbagliata' } })).stato === 403);
    const chiuse = await chiama('/api/sessioni/chiudi-le-altre', { method: 'POST', token: sessione, body: { password } });
    verifica('con la password chiude le altre e dà a questa un token nuovo', chiuse.stato === 200 && !!chiuse.corpo?.token, chiuse.corpo);
    verifica("l'altra sessione non vale più", (await chiama('/api/users/me', { token: altra })).stato === 401);
    verifica('quella nuova sì', (await chiama('/api/users/me', { token: chiuse.corpo?.token })).stato === 200);
    verifica("e i token per l'impronta sono tolti", (await chiama('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: primo.corpo?.rinnovo } })).stato === 401);

    const ancora = (await chiama('/login', { method: 'POST', body: { username: persona.username, password } })).corpo.token;
    const ultimo = (await chiama('/api/app/rinnovo', { method: 'POST', token: ancora, body: { dispositivo: 'terzo' } })).corpo?.rinnovo;
    await pool.query("UPDATE token_rinnovo SET creato_il = NOW() - INTERVAL '181 days' WHERE user_id = $1", [persona.id]);
    const troppoVecchio = await chiama('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: ultimo } });
    verifica('un token creato 181 giorni fa non fa entrare, anche se usato di continuo',
        troppoVecchio.stato === 401 && troppoVecchio.corpo?.rinnovo_non_valido === true, troppoVecchio.corpo);
} finally {
    if (persona?.id) await chiama(`/api/users/${persona.id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    await pool.end();
}

console.log(falliti === 0 ? "\nToken per l'impronta: tutto a posto\n" : `\nToken per l'impronta: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
