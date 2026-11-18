// Magazzino con i clic: consegna con verbale, chi ha cosa, conferma dal volontario, rientro, etichette, corner case.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=...] [ORION_FOTO=cartella] node tests/clic/magazzino.mjs (di solito da tests/clic-aree.mjs)
import { CARTELLA_FOTO, browser, contesto, entra, api, BASE, assesta } from './aiuto.mjs';
import { PASSWORD_PROVA } from '../accesso-prova.mjs';
const OUT = CARTELLA_FOTO;
const esiti = []; const controlla = (d, ok, x = '') => { esiti.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); };
const b = await browser();
const ctx = await contesto(b);
const { pagina: p, token: admin } = await entra(ctx, 'admin', process.env.ORION_ADMIN_PASSWORD);
p.on('dialog', d => d.accept());
const suf = Date.now().toString().slice(-5);
await api(admin, '/api/branding/settings', { method: 'PUT', body: { magazzino_enabled: 'true' } });
const configPrima = (await api(admin, '/api/magazzino/config')).corpo;
console.log('config:', (await api(admin, '/api/magazzino/config', { method: 'PUT', body: { ...configPrima, conferma_dpi: true } })).stato);
const n = (await api(admin, '/api/users', { method: 'POST', body: { nome: 'Marta', cognome: `Magaz${suf}`, role: 'volontario' } })).corpo;
const q = new URL(n.magicLink).searchParams; const pw = PASSWORD_PROVA;
await api(admin, '/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: pw } });
const elmetto = (await api(admin, '/api/magazzino/beni', { method: 'POST', body: { tipo: 'dpi', gestione: 'singolo', denominazione: `Elmetto ${suf}`, taglia: 'M' } })).corpo;
const sacchi = (await api(admin, '/api/magazzino/beni', { method: 'POST', body: { tipo: 'attrezzatura', gestione: 'quantita', denominazione: `Sacchi ${suf}`, unita_misura: 'sacchi', quantita_totale: 50 } })).corpo;
controlla('beni di prova creati', elmetto?.id && sacchi?.id, [elmetto, sacchi]);

async function scegliPersona(selectId, testo) {
    const campo = p.locator(`#${selectId}`).locator('xpath=preceding-sibling::input[contains(@class,"cerca-persona")][1]');
    await campo.fill(testo); await assesta(campo, 400);
    await p.locator(`#${selectId}-elenco li[role=option]`).filter({ hasText: testo }).first().dispatchEvent('mousedown'); await assesta(p, 600);
}
await p.goto(BASE + '/magazzino.html'); await assesta(p, 2500);
await scegliPersona('destinatario', `Magaz${suf}`);
controlla('la persona si sceglie scrivendo il nome', (await p.inputValue('#destinatario')) === String(n.id), await p.inputValue('#destinatario'));
await p.fill('#cerca-consegna', suf); await assesta(p, 500);
const righe = p.locator('#elenco-consegnabili .riga-bene');
controlla('la ricerca trova i due beni di prova', await righe.count() === 2, await righe.count());
await righe.filter({ hasText: 'Elmetto' }).locator('input[type=checkbox]').check();
const rigaSacchi = righe.filter({ hasText: 'Sacchi' });
await rigaSacchi.locator('input[type=checkbox]').check();
await rigaSacchi.locator('input[type=number]').fill('5'); await assesta(rigaSacchi, 300);
const riepilogo = await p.textContent('#riepilogo-consegna');
controlla('il riepilogo dice a chi e cosa', riepilogo.includes('Marta') && /Elmetto/.test(riepilogo) && /5 sacchi/.test(riepilogo), riepilogo);
controlla('con la conferma dei DPI accesa si spiega che il verbale si fa da sé', await p.isVisible('#nota-conferma-dpi'));
await p.screenshot({ path: `${OUT}/m-consegna.png` });
await p.click('#btn-consegna'); await assesta(p, 2000);
const avviso = await p.textContent('#avviso-magazzino');
controlla('consegna fatta con il verbale', /Consegnati 2 oggetti/.test(avviso) && /Verbale n\. \d+/.test(avviso), avviso);
const verbaleId = Number(avviso.match(/Verbale n\. (\d+)/)?.[1]);

await p.click('[data-scheda="chi-ha-cosa"]'); await assesta(p, 1500);
await p.fill('#cerca-detentori', `Magaz${suf}`); await assesta(p, 500);
const chi = await p.textContent('#elenco-detentori');
controlla('"Chi ha cosa" mostra la persona con elmetto e 5 sacchi', /Elmetto/.test(chi) && /5/.test(chi), chi.slice(0, 200));

const ctxV = await contesto(b);
const { pagina: v } = await entra(ctxV, n.username, pw);
await v.goto(BASE + '/profile.html'); await assesta(v, 2500);
const profilo = await v.textContent('body');
controlla('il volontario vede il materiale da confermare nel profilo', await v.isVisible('#box-da-confermare') && /Elmetto/.test(profilo), profilo.replace(/\s+/g, ' ').slice(0, 200));
await v.screenshot({ path: `${OUT}/m-conferma.png` });
const conferma = v.locator('#elenco-da-confermare button').filter({ hasText: /Confermo/ }).first();
if (await conferma.count()) {
    await conferma.click(); await assesta(conferma, 1500);
    await v.reload(); await assesta(v, 2000);
    controlla('confermato, il riquadro sparisce anche ricaricando', !(await v.isVisible('#box-da-confermare')));
} else controlla('nel profilo c\'è "Confermo di averlo ricevuto"', false);

const troppo = await api(admin, '/api/magazzino/consegna', { method: 'POST', body: { destinatario: { tipo: 'persona', id: n.id }, righe: [{ bene_id: sacchi.id, quantita: 100 }] } });
controlla('consegnare più di quanto c\'è -> rifiutato', troppo.stato >= 400 && troppo.stato < 500, troppo);
const doppio = await api(admin, '/api/magazzino/consegna', { method: 'POST', body: { destinatario: { tipo: 'persona', id: n.id }, righe: [{ bene_id: elmetto.id, quantita: 1 }] } });
controlla('consegnare un elmetto già fuori -> rifiutato', doppio.stato >= 400 && doppio.stato < 500, doppio);

await p.click('[data-scheda="rientro"]'); await assesta(p, 1200);
await scegliPersona('detentore-rientro', `Magaz${suf}`); await assesta(p, 1200);
const rientro = p.locator('#elenco-rientro .riga-bene');
controlla('nel rientro compaiono i due beni della persona', await rientro.count() === 2, await rientro.count());
for (const c of await rientro.locator('input[type=checkbox]').all()) await c.check();
await assesta(p, 300);
await p.screenshot({ path: `${OUT}/m-rientro.png` });
await p.click('#btn-rientro'); await assesta(p, 2000);
const avvisoR = await p.textContent('#avviso-magazzino');
controlla('rientro fatto', /Rientrat|rientr/i.test(avvisoR), avvisoR);
const beni = (await api(admin, '/api/magazzino/beni')).corpo || [];
controlla('dopo il rientro elmetto e sacchi sono di nuovo disponibili', beni.find(x => x.id === elmetto.id)?.disponibile && Number(beni.find(x => x.id === sacchi.id)?.quantita_disponibile ?? 50) === 50,
    [beni.find(x => x.id === elmetto.id), beni.find(x => x.id === sacchi.id)]);

await p.click('[data-scheda="inventario"]'); await assesta(p, 1500);
await p.fill('#cerca-inventario', suf); await assesta(p, 600);
controlla("l'inventario trova i beni", /Elmetto/.test(await p.textContent('#elenco-inventario')));
const [etichette] = await Promise.all([p.context().waitForEvent('page').catch(() => null), p.click('#btn-etichette')]);
if (etichette) { await etichette.waitForLoadState(); await assesta(etichette, 1500); controlla('le etichette si aprono con i QR', /etichett/i.test(await etichette.textContent('body'))); }
else { await assesta(p, 1500); controlla('le etichette si aprono con i QR', p.url().includes('etichette') && /etichett/i.test(await p.textContent('body')), p.url()); }

await p.goto(BASE + '/magazzino.html'); await assesta(p, 2000);
await p.click('[data-scheda="scadenze"]'); await assesta(p, 1500);
controlla('"Scade e manca" si apre', await p.isVisible('#elenco-scadenze'));
await p.click('[data-scheda="registro"]'); await assesta(p, 1500);
const registro = await p.textContent('#pannello-registro');
controlla('nel registro ci sono consegna e rientro', /Elmetto/.test(registro), registro.replace(/\s+/g, ' ').slice(0, 200));
console.log('errori admin:', p.errori.slice(0, 5), 'volontario:', v.errori.slice(0, 5));
await api(admin, `/api/users/${n.id}`, { method: 'DELETE', body: { beni: [] } });
await api(admin, '/api/magazzino/config', { method: 'PUT', body: configPrima });
console.log(`\n${esiti.filter(Boolean).length}/${esiti.length} controlli superati`);
await b.close();
process.exit(esiti.every(Boolean) ? 0 : 1);
