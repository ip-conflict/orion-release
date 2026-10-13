// Le difese che non hanno bisogno del server: regole delle password, pausa dopo i
// tentativi sbagliati, indirizzi esterni, TLS del database, segreto dei cookie.
//
//   node tests/sicurezza.mjs

import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { controllaPassword } from '../src/password.js';
import { attesaPerAccount, erroreAccesso, accessoRiuscito, _azzeraTentativi } from '../src/tentativiAccesso.js';
import { indirizzoPrivato, controllaIndirizzo } from '../src/indirizziEsterni.js';
import { opzioniSslDatabase } from '../src/sslDatabase.js';

const RADICE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let falliti = 0;
const verificaCaso = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const lancia = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };

console.log('Password');
const persona = { username: 'mrossi', nome: 'Mario', cognome: 'Rossi', email: 'mario.rossi@example.org' };
for (const [pw, buona, descr] of [
    ['Password2025!', false, 'parola comune con numeri e simbolo'],
    ['P@ssw0rd2025!', false, 'con le sostituzioni (@ 0)'],
    ['Juventus1897!', false, 'squadra di calcio'],
    ['CiaoCiao2025!', false, 'parola comune ripetuta'],
    ['Protezionecivile1!', false, 'quasi tutta una parola comune'],
    ['Aaaaaaaaaaa1!', false, 'stesso carattere ripetuto'],
    ['MarioRossi2025!', false, 'il proprio nome'],
    ['Mrossi!Lampada7', false, 'il proprio nome utente'],
    ['corta1!A', false, 'troppo corta'],
    ['Lampada-Verde-Nuvola7', true, 'tre parole che non stanno insieme'],
    ['Gatto5!Treno-Orologio', true, 'parole comuni mescolate ad altre'],
]) {
    const esito = controllaPassword(pw, persona);
    verificaCaso(`${buona ? 'accettata' : 'rifiutata'}: ${descr}`, buona ? esito === null : typeof esito === 'string', esito);
}

console.log('Tentativi per account');
_azzeraTentativi();
let t = 1_000_000;
for (let i = 1; i <= 4; i++) erroreAccesso('Mario', t++);
verificaCaso('quattro errori: si può ancora provare', attesaPerAccount('mario', t) === 0);
const prima = erroreAccesso('mario', t);
verificaCaso('il quinto ferma l\'account per un minuto', prima === 60 && attesaPerAccount('MARIO', t) === 60, prima);
verificaCaso('un altro account non è toccato', attesaPerAccount('luigi', t) === 0);
t += 61_000;
const seconda = erroreAccesso('mario', t);
verificaCaso('l\'errore dopo la pausa la raddoppia', seconda === 120, seconda);
for (let i = 0; i < 10; i++) { t += 3_600_000 - 1; erroreAccesso('mario', t); }
verificaCaso('la pausa non supera i 15 minuti', attesaPerAccount('mario', t) <= 900, attesaPerAccount('mario', t));
accessoRiuscito('mario');
verificaCaso('un accesso riuscito azzera il conto', attesaPerAccount('mario', t) === 0 && erroreAccesso('mario', t) === 0);
_azzeraTentativi();

console.log('Indirizzi esterni');
for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    verificaCaso(`${ip} è interno`, indirizzoPrivato(ip));
}
for (const ip of ['8.8.8.8', '140.82.112.3', '2606:4700::1111']) verificaCaso(`${ip} è pubblico`, !indirizzoPrivato(ip));
delete process.env.ORION_AGGIORNAMENTI_RETE_LOCALE;
verificaCaso('http rifiutato', !!await lancia(() => controllaIndirizzo('http://8.8.8.8/x')));
verificaCaso('file:// rifiutato', !!await lancia(() => controllaIndirizzo('file:///etc/passwd')));
verificaCaso('https verso la rete interna rifiutato', !!await lancia(() => controllaIndirizzo('https://169.254.169.254/latest')));
verificaCaso('https verso localhost rifiutato', !!await lancia(() => controllaIndirizzo('https://[::1]:5432/')));
verificaCaso('https pubblico ammesso', !await lancia(() => controllaIndirizzo('https://8.8.8.8/x')));
process.env.ORION_AGGIORNAMENTI_RETE_LOCALE = 'true';
verificaCaso('con ORION_AGGIORNAMENTI_RETE_LOCALE la rete interna è ammessa', !await lancia(() => controllaIndirizzo('http://127.0.0.1:8080/manifesto.json')));
delete process.env.ORION_AGGIORNAMENTI_RETE_LOCALE;

console.log('TLS del database');
verificaCaso('senza DB_SSL niente TLS', opzioniSslDatabase({}) === false);
verificaCaso('con DB_SSL il certificato si verifica', opzioniSslDatabase({ DB_SSL: 'true' }).rejectUnauthorized === true);
verificaCaso('DB_SSL_STRICT=false lo spegne solo se chiesto', opzioniSslDatabase({ DB_SSL: 'true', DB_SSL_STRICT: 'false' }).rejectUnauthorized === false);

console.log('Segreto dei cookie');
const cookie = (env) => spawnSync('node', ['--input-type=module', '-e', "const c = await import('./src/config.js'); process.stdout.write(String(c.cookieSecret))"],
    { cwd: RADICE, encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test', ...env } }).stdout;
const derivato = cookie({ JWT_SECRET: 'x'.repeat(64) });
verificaCaso('senza COOKIE_SECRET non si usa JWT_SECRET', derivato && derivato !== 'x'.repeat(64), derivato);
verificaCaso('con COOKIE_SECRET si usa quella', cookie({ JWT_SECRET: 'x'.repeat(64), COOKIE_SECRET: 'y'.repeat(64) }) === 'y'.repeat(64));

console.log(falliti ? `\n${falliti} controlli falliti.` : '\nTutto a posto.');
process.exit(falliti ? 1 : 0);
