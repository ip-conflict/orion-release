// Calendario con i clic: attività con convocazione, risposta del volontario, presenze, assenza, corner case.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=...] [ORION_FOTO=cartella] node tests/clic/calendario.mjs (di solito da tests/clic-aree.mjs)
import { CARTELLA_FOTO, browser, contesto, entra, api, BASE, assesta } from './aiuto.mjs';
import { PASSWORD_PROVA } from '../accesso-prova.mjs';
const OUT = CARTELLA_FOTO;
const esiti = []; const controlla = (d, ok, x = '') => { esiti.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); };
const b = await browser();
const { pagina: p, token: admin } = await entra(await contesto(b), 'admin', process.env.ORION_ADMIN_PASSWORD);
p.on('dialog', d => d.accept());
const suf = Date.now().toString().slice(-5);
await api(admin, '/api/branding/settings', { method: 'PUT', body: { attivita_enabled: 'true' } });
const n = (await api(admin, '/api/users', { method: 'POST', body: { nome: 'Carla', cognome: `Cal${suf}`, role: 'volontario' } })).corpo;
const q = new URL(n.magicLink).searchParams; const pw = PASSWORD_PROVA;
await api(admin, '/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: pw } });
const locale = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

await p.goto(BASE + '/calendario.html'); await assesta(p, 2500);
await p.click('#btn-nuova'); await assesta(p, 800);
const tipi = await p.locator('#f-tipo option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
await p.selectOption('#f-tipo', tipi[0]);
await p.fill('#f-titolo', `Esercitazione argini ${suf}`);
await p.fill('#f-inizio', await p.evaluate(() => { const d = new Date(Date.now() - 3600000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }));
await p.fill('#f-fine', await p.evaluate(() => { const d = new Date(Date.now() + 3600000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }));
await p.fill('#f-luogo', 'Argine del Piave');
await p.check('input[name="convocazione"][value="scelti"]'); await assesta(p, 400);
await p.fill('#cerca-persone', `Cal${suf}`); await assesta(p, 400);
await p.locator('#elenco-scelta input[type=checkbox]').first().check();
controlla('scelta una persona da convocare', /1 persona scelta/.test(await p.textContent('#conta-scelti')), await p.textContent('#conta-scelti'));
await p.screenshot({ path: `${OUT}/cal-nuova.png` });
await p.click('#salva-attivita'); await assesta(p, 2500);
const elenco = (await api(admin, `/api/attivita?da=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}&a=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`)).corpo;
const att = (elenco?.attivita || elenco || []).find?.(a => a.titolo === `Esercitazione argini ${suf}`);
controlla("l'attività è creata", !!att, JSON.stringify(elenco).slice(0, 200));
controlla("compare nel calendario", await p.locator('.voce-attivita').filter({ hasText: `argini ${suf}` }).count() >= 1);

const ctxV = await contesto(b);
const { pagina: v } = await entra(ctxV, n.username, pw);
await v.goto(BASE + '/calendario.html'); await assesta(v, 2500);
controlla('il volontario convocato vede "aspetta la tua risposta"', await v.isVisible('#da-rispondere') && /argini/.test(await v.textContent('#da-rispondere')));
await v.locator('#da-rispondere a').first().click(); await assesta(v, 1200);
await v.click('#att-si'); await assesta(v, 1500);
controlla('risponde "sì" e la risposta resta', /sì|si\b/i.test(await v.textContent('#att-risposta-attuale').catch(() => '')) || (await api(admin, `/api/attivita/${att?.id}`)).corpo?.persone?.find(x => x.id === n.id)?.risposta === 'si');
await v.screenshot({ path: `${OUT}/cal-risposta.png` });
await v.keyboard.press('Escape');
await v.click('#btn-assenza'); await assesta(v, 600);
const dopodomani = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
await v.fill('#as-dal', dopodomani); await v.fill('#as-al', dopodomani); await v.fill('#as-nota', 'Turno di lavoro');
await v.locator('#form-assenza button[type=submit]').click(); await assesta(v, 1500);
controlla("l'assenza si segna e compare nell'elenco", /Turno di lavoro|\d{2}\/\d{2}/.test(await v.textContent('#as-elenco')), await v.textContent('#as-elenco'));

await p.reload(); await assesta(p, 2500);
await p.locator('.voce-attivita').filter({ hasText: `argini ${suf}` }).first().click(); await assesta(p, 1500);
controlla('nella scheda i conteggi dicono un sì', /1/.test(await p.textContent('#att-conteggi')), await p.textContent('#att-conteggi'));
controlla('iniziata, si può chiudere con i presenti', await p.isVisible('#att-concludi'));
await p.click('#att-concludi'); await assesta(p, 1000);
const spuntata = await p.locator('#elenco-presenti .riga-presente').filter({ hasText: `Cal${suf}` }).locator('input[type=checkbox]').isChecked();
controlla('chi ha detto sì è già spuntato fra i presenti', spuntata);
await p.locator('#form-presenze button[type=submit]').click(); await assesta(p, 2000);
const chiusa = (await api(admin, `/api/attivita/${att?.id}`)).corpo;
controlla("l'attività è conclusa con un presente", chiusa?.stato === 'conclusa' && (chiusa?.presenze || []).some(x => x.user_id === n.id), { stato: chiusa?.stato, presenze: chiusa?.presenze?.length });
await p.screenshot({ path: `${OUT}/cal-presenze.png` });

const invertita = await api(admin, '/api/attivita', { method: 'POST', body: { tipo_id: Number(tipi[0]), titolo: 'Al contrario', inizio: new Date(Date.now() + 7200000).toISOString(), fine: new Date().toISOString(), convocazione: 'tutti' } });
controlla('fine prima dell\'inizio -> rifiutata', invertita.stato === 400, invertita);
console.log('errori admin:', p.errori.slice(0, 5), 'volontario:', v.errori.slice(0, 5));
await api(admin, `/api/users/${n.id}`, { method: 'DELETE', body: { beni: [] } });
console.log(`\n${esiti.filter(Boolean).length}/${esiti.length} controlli superati`);
await b.close();
process.exit(esiti.every(Boolean) ? 0 : 1);
