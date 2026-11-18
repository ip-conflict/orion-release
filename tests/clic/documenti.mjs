// Documenti con i clic: carica, "Sempre con me", nuova versione, visibilità per ruolo, file non ammesso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=...] [ORION_FOTO=cartella] node tests/clic/documenti.mjs (di solito da tests/clic-aree.mjs)
import fs from 'fs';
import { CARTELLA_FOTO, browser, contesto, entra, api, BASE, assesta } from './aiuto.mjs';
import { PASSWORD_PROVA } from '../accesso-prova.mjs';
const OUT = CARTELLA_FOTO;
const esiti = []; const controlla = (d, ok, x = '') => { esiti.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); };
const b = await browser();
const { pagina: p, token: admin } = await entra(await contesto(b), 'admin', process.env.ORION_ADMIN_PASSWORD);
p.on('dialog', d => d.accept());
const suf = Date.now().toString().slice(-5);
const cartella = `${OUT}/doc-${suf}`; fs.mkdirSync(cartella, { recursive: true });
const pdf = (testo) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${testo}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
fs.writeFileSync(`${cartella}/piano.pdf`, pdf('versione 1'));
fs.writeFileSync(`${cartella}/piano-v2.pdf`, pdf('versione 2'));
fs.writeFileSync(`${cartella}/script.html`, '<script>alert(1)</script>');
const n = (await api(admin, '/api/users', { method: 'POST', body: { nome: 'Dora', cognome: `Doc${suf}`, role: 'volontario' } })).corpo;
const q = new URL(n.magicLink).searchParams; const pw = PASSWORD_PROVA;
await api(admin, '/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: pw } });

await p.goto(BASE + '/documenti.html'); await assesta(p, 2500);
await p.click('#btn-carica'); await assesta(p, 600);
await p.fill('#doc-titolo', `Piano comunale ${suf}`);
await p.setInputFiles('#doc-file', `${cartella}/piano.pdf`);
await p.fill('#doc-descrizione', 'Il piano approvato dal consiglio');
await p.check('#doc-sempre');
await p.check('#doc-emergenza');
await p.screenshot({ path: `${OUT}/doc-carica.png` });
await p.click('#salva-documento'); await assesta(p, 2000);
const riga = p.locator('.riga-documento').filter({ hasText: `Piano comunale ${suf}` });
controlla('il documento caricato compare nell\'elenco', await riga.count() === 1);
await riga.locator('button').click(); await assesta(riga, 1200);
await p.click('#btn-versione'); await assesta(p, 400);
await p.setInputFiles('#versione-file', `${cartella}/piano-v2.pdf`);
await p.fill('#versione-nota', 'Aggiornate le aree di attesa');
await p.locator('#form-versione button[type=submit]').click(); await assesta(p, 2000);
controlla('la nuova versione si aggiunge, la vecchia resta nello storico', /Aggiornate le aree di attesa/.test(await p.textContent('#versioni-dettaglio')) && (await p.locator('#versioni-dettaglio li').count()) >= 2,
    await p.textContent('#versioni-dettaglio'));
await p.screenshot({ path: `${OUT}/doc-versioni.png` });
await p.keyboard.press('Escape');

await p.click('#btn-carica'); await assesta(p, 600);
await p.fill('#doc-titolo', `Solo segreteria ${suf}`);
await p.setInputFiles('#doc-file', `${cartella}/piano.pdf`);
await p.check('input[name="visibilita"][value="ruoli"]'); await assesta(p, 300);
await p.locator('#scelta-ruoli input[type=checkbox]').filter({ has: p.locator('xpath=.') }).first();
const segreteria = p.locator('#scelta-ruoli label').filter({ hasText: /Segreteria/ }).locator('input');
await segreteria.check();
await p.click('#salva-documento'); await assesta(p, 2000);
controlla('il documento riservato compare per chi tiene l\'archivio', await p.locator('.riga-documento').filter({ hasText: `Solo segreteria ${suf}` }).count() === 1);

await p.click('#btn-carica'); await assesta(p, 600);
await p.fill('#doc-titolo', `Pagina web ${suf}`);
await p.setInputFiles('#doc-file', `${cartella}/script.html`);
await p.click('#salva-documento'); await assesta(p, 1500);
controlla('un file .html non si carica', await p.locator('.riga-documento').filter({ hasText: `Pagina web ${suf}` }).count() === 0);
await p.keyboard.press('Escape');

const ctxV = await contesto(b);
const { pagina: v, token: tokV } = await entra(ctxV, n.username, pw);
await v.goto(BASE + '/documenti.html'); await assesta(v, 2500);
const visti = await v.textContent('#elenco-documenti');
controlla('il volontario vede il piano e non il documento della segreteria', visti.includes(`Piano comunale ${suf}`) && !visti.includes(`Solo segreteria ${suf}`), visti.slice(0, 200));
controlla('il volontario non ha "Carica"', !(await v.isVisible('#btn-carica')));
const elenco = (await api(tokV, '/api/documenti')).corpo;
const doc = (elenco?.documenti || elenco || []).find?.(d => d.titolo === `Piano comunale ${suf}`);
controlla('per il volontario è "Sempre con me" (l\'app lo tiene sul telefono)', doc?.sempre_con_me === true, doc);
const file = await fetch(`${BASE}/api/documenti/${doc?.id}/file`, { headers: { Authorization: `Bearer ${tokV}` } });
const contenuto = Buffer.from(await file.arrayBuffer()).toString();
controlla('scaricando si riceve l\'ultima versione', file.status === 200 && contenuto.includes('versione 2'), file.status);
console.log('errori admin:', p.errori.slice(0, 5), 'volontario:', v.errori.slice(0, 5));
await api(admin, `/api/users/${n.id}`, { method: 'DELETE', body: { beni: [] } });
console.log(`\n${esiti.filter(Boolean).length}/${esiti.length} controlli superati`);
await b.close();
process.exit(esiti.every(Boolean) ? 0 : 1);
