// Le difese che non hanno bisogno del server: regole delle password, pausa dopo i
// tentativi sbagliati e i codici sbagliati, tetto ai link di recupero, indirizzi
// esterni, TLS del database, segreto dei cookie.
//
//   node tests/sicurezza.mjs

import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { controllaPassword } from '../src/password.js';
import {
    attesaPerAccount, erroreAccesso, accessoRiuscito, iniziaAccesso, attesaCodici, codiceSbagliato, azzeraCodiciSbagliati, iniziaCodice,
    attesaLinkRecupero, linkRecuperoMandato, _azzeraTentativi
} from '../src/tentativiAccesso.js';
import { cercaSoloPubblici, indirizzoPrivato, controllaIndirizzo } from '../src/indirizziEsterni.js';
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
const SALA = '203.0.113.7', FUORI = '198.51.100.9';
let t = 1_000_000;
for (let i = 1; i <= 4; i++) erroreAccesso('Mario', FUORI, t++);
verificaCaso('quattro errori: si può ancora provare', attesaPerAccount('mario', FUORI, t) === 0);
const prima = erroreAccesso('mario', FUORI, t).attesa;
verificaCaso('il quinto ferma quella rete per un minuto', prima === 60 && attesaPerAccount('MARIO', FUORI, t) === 60, prima);
verificaCaso('dalla sala lo stesso account entra', attesaPerAccount('mario', SALA, t) === 0);
verificaCaso('un altro account non è toccato', attesaPerAccount('luigi', FUORI, t) === 0);
t += 61_000;
const seconda = erroreAccesso('mario', FUORI, t).attesa;
verificaCaso('l\'errore dopo la pausa la raddoppia', seconda === 120, seconda);
for (let i = 0; i < 10; i++) { t += 3_600_000 - 1; erroreAccesso('mario', FUORI, t); }
verificaCaso('la pausa non supera i 15 minuti', attesaPerAccount('mario', FUORI, t) <= 900, attesaPerAccount('mario', FUORI, t));
accessoRiuscito('mario', FUORI);
verificaCaso('un accesso riuscito azzera il conto di quella rete', attesaPerAccount('mario', FUORI, t) === 0 && erroreAccesso('mario', FUORI, t).attesa === 0);

// Il caso che teneva fuori la persona: un tentativo a ogni fine pausa, per sei ore, da una rete sola.
_azzeraTentativi();
let bloccataDallaSala = 0, controlli = 0;
for (let ora = 0; ora < 6 * 3_600_000; ora += 10_000) {
    if (!attesaPerAccount('coordinatore', FUORI, ora)) erroreAccesso('coordinatore', FUORI, ora);
    controlli++;
    if (attesaPerAccount('coordinatore', SALA, ora)) bloccataDallaSala++;
}
verificaCaso('chi insiste da una rete non tiene fuori la persona dalla sala', bloccataDallaSala === 0, `${bloccataDallaSala} su ${controlli}`);

_azzeraTentativi();
t = 5_000_000;
let avvisi = 0, ultima = null;
for (let i = 0; i < 30; i++) { ultima = erroreAccesso('anna', `10.0.${i}.1`, t + i); if (ultima.sogliaSuperata) avvisi++; }
verificaCaso('trenta errori da trenta reti fermano l\'account intero per cinque minuti', ultima.attesa === 300 && attesaPerAccount('anna', SALA, t + 30) === 300, ultima);
verificaCaso('e la persona si avvisa una volta', avvisi === 1, avvisi);
t += 300_000;
verificaCaso('passati i cinque minuti si entra di nuovo', attesaPerAccount('anna', SALA, t + 30) === 0);
const dopo = erroreAccesso('anna', '10.0.99.1', t + 31);
verificaCaso('un errore solo, appena finita la pausa, non la rimette', dopo.attesa === 0 && attesaPerAccount('anna', SALA, t + 31) === 0, dopo);

// Il caso che teneva fuori la persona anche dalla soglia dell'account: otto reti, poi un tentativo a ogni fine pausa.
_azzeraTentativi();
t = 1e12;
accessoRiuscito('coordinatore', SALA, t);
for (let r = 0; r < 8; r++) for (let i = 0; i < 4; i++) erroreAccesso('coordinatore', `203.0.113.${r}`, t++);
verificaCaso('trentadue errori da otto reti fermano l\'account per le reti nuove', attesaPerAccount('coordinatore', '192.0.2.50', t) === 300);
verificaCaso('ma non per la rete da cui la persona è già entrata', attesaPerAccount('coordinatore', SALA, t) === 0);
let fermaFuori = 0;
for (let minuto = 0; minuto < 60; minuto++) {
    t += 60_000;
    if (attesaPerAccount('coordinatore', '192.0.2.50', t)) fermaFuori++;
    else erroreAccesso('coordinatore', `198.51.100.${minuto}`, t);
}
// Prima la pausa ripartiva a ogni errore e la rete nuova restava ferma 48 minuti su 60.
verificaCaso('un tentativo a ogni minuto non la tiene accesa: per rimetterla servono altri trenta errori', fermaFuori <= 10, `${fermaFuori} minuti su 60`);

_azzeraTentativi();
t = 2e12;
const insieme = Array.from({ length: 20 }, () => iniziaAccesso('bruno', FUORI, t));
verificaCaso('venti tentativi partiti insieme dalla stessa rete: ne passano cinque', insieme.filter(x => !x.attesa).length === 5, insieme.map(x => x.attesa));
insieme.forEach(x => { if (x.fine) { erroreAccesso('bruno', FUORI, t); x.fine(); } });
verificaCaso('e poi la rete si ferma', iniziaAccesso('bruno', FUORI, t).attesa > 0);
verificaCaso('dalla sala intanto si prova', !iniziaAccesso('bruno', SALA, t).attesa);
_azzeraTentativi();
const daMolteReti = Array.from({ length: 40 }, (_, i) => iniziaAccesso('carla', `10.1.${i}.1`, t));
verificaCaso('quaranta da quaranta reti insieme: ne passano trenta, la soglia dell\'account', daMolteReti.filter(x => !x.attesa).length === 30);
_azzeraTentativi();

console.log('Codici della verifica in due passaggi');
t = 5_000_000;
let esitoCodice;
for (let i = 1; i <= 9; i++) esitoCodice = codiceSbagliato(7, t++);
verificaCaso('nove codici sbagliati non fermano niente', esitoCodice.attesa === 0 && attesaCodici(7, t) === 0, esitoCodice);
esitoCodice = codiceSbagliato(7, t);
verificaCaso('al decimo i codici si fermano cinque minuti e si avvisa la persona', esitoCodice.attesa === 300 && esitoCodice.primaPausa, esitoCodice);
verificaCaso('la pausa è per quella persona sola', attesaCodici(8, t) === 0);
t += 300_000;
esitoCodice = codiceSbagliato(7, t);
verificaCaso('dopo la pausa ogni errore la raddoppia, senza un secondo avviso', esitoCodice.attesa === 600 && !esitoCodice.primaPausa, esitoCodice);
for (let i = 0; i < 10; i++) { t += 3_600_000; esitoCodice = codiceSbagliato(7, t); }
verificaCaso('la pausa non supera un\'ora', esitoCodice.attesa === 3600, esitoCodice);
azzeraCodiciSbagliati(7);
verificaCaso('un codice giusto azzera il conto', attesaCodici(7, t) === 0 && codiceSbagliato(7, t).attesa === 0);
_azzeraTentativi();
const codiciInsieme = Array.from({ length: 30 }, () => iniziaCodice(9, t));
verificaCaso('trenta codici partiti insieme: ne passano dieci', codiciInsieme.filter(x => !x.attesa).length === 10);
codiciInsieme.forEach(x => x.fine?.());
verificaCaso('finiti quelli, se ne riprova', !iniziaCodice(9, t).attesa);
_azzeraTentativi();

console.log('Link di recupero della password');
t = 9_000_000;
for (let i = 0; i < 3; i++) { verificaCaso(`il link ${i + 1} parte`, attesaLinkRecupero(3, t) === 0); linkRecuperoMandato(3, t); t += 60_000; }
verificaCaso('il quarto nella stessa ora no', attesaLinkRecupero(3, t) > 0, attesaLinkRecupero(3, t));
verificaCaso('un\'altra persona ne chiede quanti vuole', attesaLinkRecupero(4, t) === 0);
verificaCaso('passata l\'ora dal primo, se ne può chiedere un altro', attesaLinkRecupero(3, 9_000_000 + 3_600_000) === 0);
_azzeraTentativi();

console.log('Indirizzi esterni');
for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1',
    // Le stesse in altre forme: il parser degli URL scrive [::ffff:127.0.0.1] come ::ffff:7f00:1.
    '::ffff:7f00:1', '0:0:0:0:0:ffff:a9fe:a9fe', '::7f00:1', '64:ff9b::a9fe:a9fe', '2002:c0a8:101::1', 'fec0::1', '198.18.0.5']) {
    verificaCaso(`${ip} è interno`, indirizzoPrivato(ip));
}
for (const ip of ['8.8.8.8', '140.82.112.3', '2606:4700::1111', '::ffff:8.8.8.8']) verificaCaso(`${ip} è pubblico`, !indirizzoPrivato(ip));
delete process.env.ORION_AGGIORNAMENTI_RETE_LOCALE;
verificaCaso('http rifiutato', !!await lancia(() => controllaIndirizzo('http://8.8.8.8/x')));
verificaCaso('file:// rifiutato', !!await lancia(() => controllaIndirizzo('file:///etc/passwd')));
verificaCaso('https verso la rete interna rifiutato', !!await lancia(() => controllaIndirizzo('https://169.254.169.254/latest')));
verificaCaso('https verso localhost rifiutato', !!await lancia(() => controllaIndirizzo('https://[::1]:5432/')));
verificaCaso('https verso un IPv4 mappato in IPv6 rifiutato', !!await lancia(() => controllaIndirizzo('https://[::ffff:169.254.169.254]/latest')));
verificaCaso('anche alla connessione un nome interno è rifiutato',
    !!await new Promise(fatto => cercaSoloPubblici('localhost', {}, (errore) => fatto(errore))));
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
