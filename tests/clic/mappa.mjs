// Mappa della sala con i clic: zona interdetta e strada chiusa disegnate, servizio delle strade giù, chiusura che chiede cosa tenere.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=...] [ORION_FOTO=cartella] node tests/clic/mappa.mjs (di solito da tests/clic-aree.mjs)
import { CARTELLA_FOTO, browser, contesto, entra, api, BASE } from './aiuto.mjs';
const OUT = CARTELLA_FOTO; const attendi = (ms) => new Promise(r => setTimeout(r, ms));
const esiti = []; const controlla = (d, ok, x = '') => { esiti.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); };
const b = await browser();
const ctx = await contesto(b);
await ctx.route(/tile\.openstreetmap\.org|arcgisonline/, r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
let osrmGiu = true;
await ctx.route(/router\.project-osrm\.org|osrm/, r => osrmGiu ? r.abort() : r.continue());
const { pagina: p, token: admin } = await entra(ctx, 'admin', process.env.ORION_ADMIN_PASSWORD);
p.on('dialog', d => d.accept());
const suf = Date.now().toString().slice(-5);
if ((await api(admin, '/api/emergencies/status')).corpo?.active) await api(admin, '/api/emergencies/close', { method: 'POST', body: {} });
await api(admin, '/api/emergencies/open', { method: 'POST', body: { external_code: `MAP-${suf}` } });
await p.goto(BASE + '/centro-operativo.html'); await attendi(3000);
const box = await p.locator('#map-segnalazioni').boundingBox();
const punto = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const elementi = async () => ((await api(admin, '/api/mappa/elementi')).corpo?.emergenza || []);

async function menu(voce) {
    await p.click('button[aria-label="Disegna sulla mappa"]'); await attendi(300);
    await p.locator('.lm-menu button').filter({ hasText: voce }).first().click(); await attendi(400);
}
await menu('Zona interdetta');
const vertici = [[0.35, 0.35], [0.55, 0.35], [0.55, 0.55], [0.35, 0.55]];
for (const [x, y] of vertici) { await p.mouse.click(...punto(x, y)); await attendi(250); }
await p.mouse.click(...punto(...vertici[0])); await attendi(800);
controlla('chiusa la zona si apre il modulo "Che cos\'è?"', await p.isVisible('.lm-finestra'));
await p.locator('.lm-finestra input[type=text]').first().fill(`Argine rotto ${suf}`);
await p.locator('.lm-finestra textarea').fill('Area evacuata, accesso solo VVF');
await p.screenshot({ path: `${OUT}/mp-zona.png` });
await p.locator('.lm-finestra button[type=submit]').click(); await attendi(1500);
let tutti = await elementi();
controlla('la zona interdetta è salvata nell\'emergenza', tutti.some(e => e.tipo === 'zona_interdetta' && e.nome === `Argine rotto ${suf}` && e.geometria?.type === 'Polygon'), tutti.map(e => `${e.tipo}:${e.nome}`));

await menu('Strada chiusa');
await p.mouse.click(...punto(0.2, 0.7)); await attendi(400);
await p.mouse.click(...punto(0.3, 0.75)); await attendi(2500);
const testo = await p.textContent('body');
controlla('con il servizio delle strade giù lo dice e propone il disegno a mano', /a mano|non risponde|non raggiungibile/i.test(testo), testo.replace(/\s+/g, ' ').match(/.{0,80}(a mano|non risponde).{0,80}/i)?.[0] || '');
await p.keyboard.press('Escape'); await attendi(300);
await p.locator('.lm-guida button, button').filter({ hasText: /^Annulla$/ }).first().click().catch(() => {});

await menu('Strada chiusa, a mano');
await p.mouse.click(...punto(0.2, 0.8)); await attendi(250);
await p.mouse.click(...punto(0.3, 0.82)); await attendi(250);
await p.mouse.dblclick(...punto(0.4, 0.8)); await attendi(800);
controlla('la strada a mano finisce con il doppio clic e chiede cos\'è', await p.isVisible('.lm-finestra'));
await p.locator('.lm-finestra input[type=text]').first().fill(`Via del Ponte ${suf}`);
await p.locator('.lm-finestra button[type=submit]').click(); await attendi(1500);
tutti = await elementi();
controlla('la strada chiusa è salvata come linea', tutti.some(e => e.tipo === 'strada_chiusa' && e.nome === `Via del Ponte ${suf}` && /Line/.test(e.geometria?.type)), tutti.map(e => `${e.tipo}:${e.nome}`));

await p.goto(BASE + '/parete.html'); await attendi(2500);
controlla('lo schermo a parete disegna strade e zone', await p.locator('#mappa-parete path.leaflet-interactive, #mappa-parete svg path').count() >= 2);
await p.goto(BASE + '/centro-operativo.html'); await attendi(2500);
await p.click('#close-emergency-btn'); await attendi(1000);
const finestra = await p.textContent('.chiusura-emergenza');
controlla('chiudendo, la sala chiede cosa tenere di strade e zone', finestra.includes(`Argine rotto ${suf}`) && finestra.includes(`Via del Ponte ${suf}`), finestra.slice(0, 300));
const casella = p.locator('.chiusura-emergenza label').filter({ hasText: `Argine rotto ${suf}` }).locator('input[type=checkbox]');
await casella.uncheck();
await p.screenshot({ path: `${OUT}/mp-chiusura.png` });
await p.locator('.chiusura-emergenza button').filter({ hasText: /Chiudi/ }).last().click(); await attendi(3500);
const dopo = (await api(admin, '/api/mappa/elementi')).corpo;
const visibili = JSON.stringify(dopo);
controlla('dopo la chiusura resta solo la strada spuntata', visibili.includes(`Via del Ponte ${suf}`) && !visibili.includes(`Argine rotto ${suf}`), visibili.slice(0, 300));
console.log('errori:', p.errori.slice(0, 6));
console.log(`\n${esiti.filter(Boolean).length}/${esiti.length} controlli superati`);
await b.close();
process.exit(esiti.every(Boolean) ? 0 : 1);
