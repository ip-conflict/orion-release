// Utenti e Sistema con i clic: iscrizione, primo accesso, ruoli, sospensione, eliminazione; backup, integrità, sigillo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=...] [ORION_FOTO=cartella] node tests/clic/utenti.mjs (di solito da tests/clic-aree.mjs)
import { CARTELLA_FOTO, browser, contesto, entra, api, BASE } from './aiuto.mjs';
const OUT = CARTELLA_FOTO; const attendi = (ms) => new Promise(r => setTimeout(r, ms));
const esiti = []; const controlla = (d, ok, x = '') => { esiti.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); };
const b = await browser();
const { pagina: p, token: admin } = await entra(await contesto(b), 'admin', process.env.ORION_ADMIN_PASSWORD);
p.on('dialog', d => d.accept());
const suf = Date.now().toString().slice(-5);

await p.goto(BASE + '/admin/admin.html'); await attendi(2500);
await p.click('#add-user-btn'); await attendi(500);
await p.fill('#add-nome', 'Nora'); await p.fill('#add-cognome', `Utente${suf}`);
await p.check('#add-ruoli input.add-ruolo[value="volontario"]');
await p.locator('#add-user-form button[type=submit]').click(); await attendi(2000);
controlla('iscritta: compaiono le credenziali da consegnare', await p.isVisible('#credentials-modal'));
const username = (await p.textContent('#new-user-username')).trim();
const link = (await p.textContent('#new-user-password')).trim();
await p.screenshot({ path: `${OUT}/ut-credenziali.png` });
await p.click('#ok-credentials-btn'); await attendi(500);
const utente = ((await api(admin, '/api/admin/users')).corpo || []).find(u => u.username === username);
controlla('la persona è nell\'elenco con il ruolo Volontario', !!utente && (utente.ruoli || [utente.role]).includes('volontario'), utente);

const ctxN = await contesto(b);
const n = await ctxN.newPage();
await n.goto(BASE + new URL(link, BASE).pathname + new URL(link, BASE).search); await attendi(2000);
const campiPw = n.locator('input[type=password]');
controlla('il link del primo accesso chiede la password nuova', await campiPw.count() >= 1, n.url());
const pw = `Faro!${suf}Lanterna9`;
for (const c of await campiPw.all()) await c.fill(pw);
await n.locator('button[type=submit]').first().click(); await attendi(2500);
const accesso = await fetch(BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: pw }) });
controlla('con la password scelta entra', accesso.status === 200, accesso.status);

await p.reload(); await attendi(2000);
await p.fill('#cerca-utenti', `Utente${suf}`); await attendi(600);
const riga = p.locator('#user-table-body tr').filter({ hasText: username });
await riga.locator('.edit-user-btn').click(); await attendi(800);
await p.locator('#edit-ruoli input[value="magazziniere"]').check();
await p.locator('#edit-user-form button[type=submit]').click(); await attendi(1500);
const dopo = ((await api(admin, '/api/admin/users')).corpo || []).find(u => u.username === username);
controlla('aggiunto il ruolo Magazziniere', (dopo?.ruoli || []).includes('magazziniere'), dopo?.ruoli);

await riga.locator('.suspend-btn').click(); await attendi(1500);
const sospesa = await fetch(BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: pw }) });
controlla('sospesa, non entra più', sospesa.status !== 200, sospesa.status);
await p.reload(); await attendi(1500);
await p.fill('#cerca-utenti', `Utente${suf}`); await attendi(600);
await p.locator('#user-table-body tr').filter({ hasText: username }).locator('.reactivate-btn').click(); await attendi(1500);
const riattivata = await fetch(BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: pw }) });
controlla('riattivata, entra di nuovo', riattivata.status === 200, riattivata.status);
const io = p.locator('#user-table-body tr').filter({ hasText: 'admin' }).first();
await p.fill('#cerca-utenti', 'admin'); await attendi(600);
controlla('il proprio account non si sospende né si elimina dalla tabella', await p.locator('#user-table-body tr').first().locator('.suspend-btn[title^="Non puoi"], .delete-user-btn[title^="Non puoi"]').count() >= 1);

await p.fill('#cerca-utenti', `Utente${suf}`); await attendi(600);
await p.locator('#user-table-body tr').filter({ hasText: username }).locator('.delete-user-btn').click(); await attendi(2000);
controlla('eliminata, sparisce dall\'elenco', !((await api(admin, '/api/admin/users')).corpo || []).some(u => u.username === username));

await p.goto(BASE + '/admin/sistema.html'); await attendi(3000);
controlla('Sistema mostra versione e stato', (await p.textContent('#stato-versione')).trim().length > 0);
await p.click('#btn-verifica-integrita'); await attendi(6000);
const integrita = await p.textContent('#stato-integrita');
controlla('la verifica dello storico dice che è integro', /integr|intatt|nessuna/i.test(integrita) && !/alterat[ea] \d|rotta/i.test(integrita), integrita.replace(/\s+/g, ' ').slice(0, 200));
const sigillo = (await p.textContent('#sigillo-attuale')).trim();
controlla('c\'è il sigillo attuale da conservare', sigillo.length > 20, sigillo);
if (sigillo.length > 20) {
    await p.fill('#sigillo-da-confrontare', sigillo);
    await p.click('#btn-confronta-sigillo'); await attendi(2000);
    controlla('il sigillo appena letto corrisponde', /corrispond|coincide|uguale|valido/i.test(await p.textContent('#esito-confronto')), await p.textContent('#esito-confronto'));
}
await p.screenshot({ path: `${OUT}/ut-sistema.png` });
const primaBackup = await p.locator('#elenco-backup li, #elenco-backup tr').count();
await p.click('#btn-backup-adesso'); await attendi(12000);
const dopoBackup = await p.locator('#elenco-backup li, #elenco-backup tr').count();
controlla('"Backup adesso" aggiunge un backup all\'elenco', dopoBackup > primaBackup, `${primaBackup} -> ${dopoBackup}`);
console.log('errori:', p.errori.slice(0, 6), 'nuova:', n.url());
console.log(`\n${esiti.filter(Boolean).length}/${esiti.length} controlli superati`);
await b.close();
process.exit(esiti.every(Boolean) ? 0 : 1);
