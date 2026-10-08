// tests/mfa.mjs
//
// La verifica in due passaggi: attivarla dal profilo, entrare con il codice o
// con un codice di riserva, lo stesso codice che non vale due volte, la sfida
// che cade dopo troppi errori, l'impronta dell'app, l'amministratore che deve
// averla (anche chi lo diventa mentre è collegato) e che la azzera a un altro.
//
// Crea ed elimina un utente di prova: va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/mfa.mjs

import 'dotenv/config';
import pg from 'pg';
import crypto from 'crypto';
import { accediConFetch, codiceNuovo, codiceTotp, dimenticaSegreto, passoAttuale, prendiVisione } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN = process.env.ORION_ADMIN_USER || 'admin';

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
const login = (username, password) => chiama('/login', { method: 'POST', body: { username, password } });
const secondoPasso = (sfida, codice) => chiama('/api/accesso/mfa', { method: 'POST', body: { sfida, codice } });

console.log('\nVerifica in due passaggi');

const admin = await accediConFetch(BASE, ADMIN, process.env.ORION_ADMIN_PASSWORD);
verifica("l'amministratore entra solo con il codice", !!admin.token);
const tokenAdmin = admin.token;

// Una persona di prova, con la password.
const suffisso = Date.now().toString().slice(-6);
const nuovo = await chiama('/api/users', { method: 'POST', token: tokenAdmin, body: { nome: `Mfa${suffisso}`, cognome: `Prova${suffisso}`, role: 'volontario' } });
const parametri = new URL(nuovo.corpo.magicLink).searchParams;
const password = `Verifica!${suffisso}Aa1`;
await chiama('/api/auth/reset-password', { method: 'POST', body: { token: parametri.get('token'), id: Number(parametri.get('id')), newPassword: password } });
const username = nuovo.corpo.username;
const id = nuovo.corpo.id;
dimenticaSegreto(BASE, username);

try {
    // 1. Senza verifica si entra con la password.
    let r = await login(username, password);
    verifica('un volontario senza verifica entra con la sola password', r.stato === 200 && !!r.corpo?.token, r);
    const primaSessione = r.corpo.token;
    // L'informativa, come alla prima entrata vera: vale per tutte le sue sessioni.
    await prendiVisione(BASE, primaSessione);
    r = await chiama('/api/mfa', { token: primaSessione });
    verifica('lo stato dice: non attiva, non obbligatoria', r.corpo?.attiva === false && r.corpo?.obbligatoria === false && r.corpo?.disponibile === true, r.corpo);

    // 2. Attivazione dal profilo.
    r = await chiama('/api/mfa/prepara', { method: 'POST', token: primaSessione, body: { password: 'sbagliata' } });
    verifica('preparare senza la password giusta -> 403', r.stato === 403, r.stato);
    r = await chiama('/api/mfa/prepara', { method: 'POST', token: primaSessione, body: { password } });
    const segreto = r.corpo?.segreto;
    verifica('preparare dà il segreto e il QR (otpauth)', /^[A-Z2-7]{32}$/.test(segreto || '') && r.corpo?.uri?.startsWith('otpauth://totp/'), r.corpo);
    r = await chiama('/api/mfa/attiva', { method: 'POST', token: primaSessione, body: { codice: '000000' === codiceTotp(segreto) ? '111111' : '000000' } });
    verifica('un codice sbagliato non la attiva', r.stato === 400, r.stato);
    r = await chiama('/api/mfa/attiva', { method: 'POST', token: primaSessione, body: { codice: await codiceNuovo(BASE, username, segreto) } });
    const codiciRiserva = r.corpo?.codici_riserva || [];
    verifica('con il codice giusto si attiva e dà dieci codici di riserva', r.stato === 200 && codiciRiserva.length === 10 && codiciRiserva.every(c => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)), r.corpo);
    const sessioneDopo = r.corpo?.token;
    r = await chiama('/api/users/me', { token: primaSessione });
    verifica("attivarla chiude le altre sessioni", r.stato === 401, r.stato);
    r = await chiama('/api/users/me', { token: sessioneDopo });
    verifica('e lascia aperta quella da cui la si è attivata', r.stato === 200, r.stato);

    // 3. L'accesso ora chiede il codice.
    r = await login(username, password);
    verifica('la password da sola non basta più: 401 con la sfida', r.stato === 401 && r.corpo?.mfa === 'codice' && !!r.corpo?.sfida && !r.corpo?.token, r.corpo);
    let sfida = r.corpo.sfida;
    r = await secondoPasso(sfida, '12345');
    verifica('un codice malformato è rifiutato', r.stato === 401 && !r.corpo?.token, r.corpo);
    const giaUsato = codiceTotp(segreto, passoAttuale());
    r = await secondoPasso(sfida, giaUsato);
    verifica("il codice già usato per l'attivazione non vale di nuovo", r.stato === 401 && /già stato usato/.test(r.corpo?.message || ''), r.corpo);
    r = await secondoPasso(sfida, await codiceNuovo(BASE, username, segreto));
    verifica('il codice nuovo apre la sessione', r.stato === 200 && !!r.corpo?.token, r.corpo);
    const sessioneConCodice = r.corpo?.token;
    r = await secondoPasso(sfida, codiceRiserva(0));
    verifica('la sfida usata non vale una seconda volta', r.stato === 401 && r.corpo?.sfida_scaduta === true, r.corpo);

    // 4. Un codice di riserva, una volta sola.
    sfida = (await login(username, password)).corpo.sfida;
    r = await secondoPasso(sfida, codiceRiserva(0).toLowerCase().replace('-', ' '));
    verifica('un codice di riserva apre la sessione (anche scritto minuscolo)', r.stato === 200 && r.corpo?.codici_riserva_rimasti === 9, r.corpo);
    sfida = (await login(username, password)).corpo.sfida;
    r = await secondoPasso(sfida, codiceRiserva(0));
    verifica('lo stesso codice di riserva non vale due volte', r.stato === 401, r.corpo);

    // 5. Troppi errori: la sfida cade.
    for (let i = 0; i < 4; i++) await secondoPasso(sfida, 'AAAAA-AAAAA');
    r = await secondoPasso(sfida, 'AAAAA-AAAAA');
    verifica('dopo cinque codici sbagliati la sfida cade', r.stato === 401 && r.corpo?.sfida_scaduta === true, r.corpo);

    // 6. L'impronta dell'app: vale se il token è nato da un accesso con la verifica.
    r = await chiama('/api/app/rinnovo', { method: 'POST', token: sessioneConCodice, body: { dispositivo: 'prova' } });
    const rinnovo = r.corpo?.rinnovo;
    r = await chiama('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo } });
    verifica("con l'impronta si rientra senza codice (il telefono è il secondo fattore)", r.stato === 200 && !!r.corpo?.token, r.corpo);

    // 7. Nuovi codici di riserva: i vecchi non valgono più.
    r = await chiama('/api/mfa/codici', { method: 'POST', token: sessioneConCodice, body: { password } });
    const nuoviCodici = r.corpo?.codici_riserva || [];
    verifica('si rifanno i codici di riserva', r.stato === 200 && nuoviCodici.length === 10, r.corpo);
    sfida = (await login(username, password)).corpo.sfida;
    r = await secondoPasso(sfida, codiceRiserva(1));
    verifica('un codice della serie vecchia non vale più', r.stato === 401, r.corpo);

    // 8. Chi diventa amministratore mentre è collegato deve rifare l'accesso con la verifica.
    r = await chiama('/api/mfa/disattiva', { method: 'POST', token: sessioneConCodice, body: { password } });
    verifica('un volontario la può togliere', r.stato === 200, r.corpo);
    r = await login(username, password);
    verifica('e poi entra di nuovo con la sola password', r.stato === 200, r.corpo);
    const senzaVerifica = r.corpo.token;
    const rinnovoSenzaVerifica = (await chiama('/api/app/rinnovo', { method: 'POST', token: senzaVerifica, body: { dispositivo: 'prova' } })).corpo?.rinnovo;
    r = await chiama(`/api/users/${id}`, { method: 'PUT', token: tokenAdmin, body: { ruoli: ['admin'], nome: `Mfa${suffisso}`, cognome: `Prova${suffisso}` } });
    verifica('reso amministratore', r.stato < 300, r);
    r = await chiama('/api/users/me', { token: senzaVerifica });
    verifica('la sua sessione senza verifica non vale più (401, mfa_richiesta)', r.stato === 401 && r.corpo?.motivo === 'mfa_richiesta', r.corpo);
    r = await chiama('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: rinnovoSenzaVerifica } });
    verifica("l'impronta nata senza verifica non fa entrare un amministratore", r.stato === 401 && r.corpo?.rinnovo_non_valido === true, r.corpo);
    r = await login(username, password);
    verifica("all'accesso un amministratore senza verifica deve attivarla", r.stato === 401 && r.corpo?.mfa === 'attivazione' && /^[A-Z2-7]{32}$/.test(r.corpo?.segreto || ''), r.corpo);
    const segretoAdmin = r.corpo.segreto;
    r = await secondoPasso(r.corpo.sfida, await codiceNuovo(BASE, username, segretoAdmin));
    verifica('la attiva al primo accesso, con i codici di riserva', r.stato === 200 && r.corpo?.codici_riserva?.length === 10 && !!r.corpo?.token, r.corpo);
    const tokenSecondoAdmin = r.corpo.token;
    const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
    const nelDb = (await pool.query('SELECT mfa_segreto FROM users WHERE id = $1', [id])).rows[0]?.mfa_segreto || '';
    const impronte = (await pool.query('SELECT impronta FROM mfa_codici_riserva WHERE user_id = $1', [id])).rows.map(x => x.impronta);
    // Un'impronta nata prima della verifica: il codice una volta, poi basta l'impronta.
    const vecchia = crypto.randomBytes(32).toString('base64url');
    await pool.query(`INSERT INTO token_rinnovo (user_id, impronta, dispositivo, scade_il, mfa) VALUES ($1, $2, 'vecchio', NOW() + INTERVAL '1 day', false)`,
        [id, crypto.createHash('sha256').update(vecchia).digest('hex')]);
    r = await chiama('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: vecchia } });
    verifica("l'impronta nata senza verifica chiede il codice una volta", r.stato === 401 && r.corpo?.mfa === 'codice' && !!r.corpo?.sfida, r.corpo);
    r = await secondoPasso(r.corpo.sfida, await codiceNuovo(BASE, username, segretoAdmin));
    verifica('dato il codice si entra', r.stato === 200 && !!r.corpo?.token, r.corpo);
    r = await chiama('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: vecchia } });
    verifica("e da lì basta l'impronta, senza codice", r.stato === 200 && !!r.corpo?.token, r.corpo);
    await pool.end();
    verifica('nel database il segreto è cifrato', nelDb.startsWith('enc1:') && !nelDb.includes(segretoAdmin), nelDb.slice(0, 12));
    verifica('e dei codici di riserva c\'è solo l\'impronta', impronte.length === 10 && impronte.every(h => /^[0-9a-f]{64}$/.test(h)), impronte.length);
    r = await chiama('/api/mfa/disattiva', { method: 'POST', token: tokenSecondoAdmin, body: { password } });
    verifica('un amministratore non la può togliere', r.stato === 403, r.corpo);

    // 9. Un altro amministratore la azzera (telefono perso).
    r = await chiama(`/api/admin/users/${admin.userId}/mfa/azzera`, { method: 'POST', token: tokenAdmin });
    verifica('la propria non si azzera da Gestione utenti', r.stato === 409, r.corpo);
    r = await chiama(`/api/admin/users/${id}/mfa/azzera`, { method: 'POST', token: tokenAdmin });
    verifica('un amministratore la azzera a un altro', r.stato === 200, r.corpo);
    r = await chiama('/api/users/me', { token: tokenSecondoAdmin });
    verifica('e la sua sessione si chiude', r.stato === 401, r.stato);
    r = await login(username, password);
    verifica('al prossimo accesso la deve riattivare', r.stato === 401 && r.corpo?.mfa === 'attivazione', r.corpo);

    // 10. Il segreto non torna mai indietro.
    r = await chiama('/api/admin/users', { token: tokenAdmin });
    const riga = (r.corpo || []).find(u => u.id === id);
    verifica("l'elenco utenti dice chi ce l'ha, senza segreti", riga && 'mfa_attiva' in riga && !('mfa_segreto' in riga), riga);

    function codiceRiserva(i) { return codiciRiserva[i]; }
} finally {
    await chiama(`/api/users/${id}`, { method: 'DELETE', token: tokenAdmin });
    dimenticaSegreto(BASE, username);
}

console.log(`\nVerifica in due passaggi: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
