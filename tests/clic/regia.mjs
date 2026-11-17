// Copione e regia con i clic: simulazione con eventi a tempo e a mano, avvio, uscita da sola, "Fai uscire ora", pausa.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=...] [ORION_FOTO=cartella] node tests/clic/regia.mjs (di solito da tests/clic-aree.mjs)
import { CARTELLA_FOTO, browser, contesto, entra, api, BASE } from './aiuto.mjs';
const OUT = CARTELLA_FOTO; const attendi = (ms) => new Promise(r => setTimeout(r, ms));
const esiti = []; const controlla = (d, ok, x = '') => { esiti.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); };
const b = await browser();
const ctx = await contesto(b);
await ctx.route(/tile\.openstreetmap\.org|arcgisonline/, r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
const { pagina: p, token: admin } = await entra(ctx, 'admin', process.env.ORION_ADMIN_PASSWORD);
p.on('dialog', d => d.accept());
const suf = Date.now().toString().slice(-5);
await api(admin, '/api/branding/settings', { method: 'PUT', body: { attivita_enabled: 'true' } });
if ((await api(admin, '/api/emergencies/status')).corpo?.active) await api(admin, '/api/emergencies/close', { method: 'POST', body: {} });
const sim = await api(admin, '/api/simulazioni/al-volo', { method: 'POST', body: { natura: 'esercitazione', titolo: `Piena ${suf}`, ore: 2 } });
const attivitaId = sim.corpo?.attivita_id ?? sim.corpo?.attivita?.id ?? (await api(admin, '/api/emergencies/status')).corpo?.emergency?.attivita_id;
controlla('simulazione aperta con la sua attività', sim.stato < 300 && !!attivitaId, sim.corpo);
const ev1 = await api(admin, `/api/attivita/${attivitaId}/copione/eventi`, { method: 'POST', body: { tipo: 'segnalazione', minuto: 0, titolo: `Scantinato allagato ${suf}`, modo: 'da_sola', lat: 46.03, lng: 11.92, indirizzo: 'Via Roma 3' } });
const ev2 = await api(admin, `/api/attivita/${attivitaId}/copione/eventi`, { method: 'POST', body: { tipo: 'segnalazione', minuto: null, titolo: `Albero sulla strada ${suf}`, modo: 'telefono', lat: 46.04, lng: 11.93, segnalante: 'Sig. Rossi', telefono: '333 0000000' } });
controlla('due eventi nel copione: uno a tempo, uno a mano', ev1.stato === 201 && ev2.stato === 201, [ev1.corpo, ev2.corpo]);

await p.goto(BASE + '/centro-operativo.html'); await attendi(3000);
controlla('in simulazione c\'è il pulsante della regia', await p.isVisible('#regia-btn'));
await p.click('#regia-btn'); await attendi(1500);
await p.screenshot({ path: `${OUT}/rg-pannello.png` });
await p.locator('button').filter({ hasText: 'Avvia lo scenario' }).click(); await attendi(1500);
let regia = (await api(admin, '/api/regia')).corpo;
controlla("l'orologio dello scenario parte", !!regia?.orologio && !regia.orologio.in_pausa, regia?.orologio);
let uscito = false;
for (let i = 0; i < 12 && !uscito; i++) {
    await attendi(2500);
    uscito = ((await api(admin, '/api/reports?status_type=active&limit=50')).corpo?.reports || []).some(r => r.title.includes(`Scantinato allagato ${suf}`));
}
controlla("l'evento del minuto 0 esce da solo come segnalazione", uscito);
await p.locator('button').filter({ hasText: 'Fai uscire ora' }).first().click(); await attendi(2000);
const telefonata = await p.textContent('body');
const segnalazioni = (await api(admin, '/api/reports?status_type=active&limit=50')).corpo?.reports || [];
controlla('"Fai uscire ora" fa uscire l\'evento a mano (per telefono: arriva come chiamata da registrare o come segnalazione)',
    segnalazioni.some(r => r.title.includes(`Albero sulla strada ${suf}`)) || /Albero sulla strada|Sig\. Rossi/.test(telefonata), segnalazioni.map(r => r.title));
await p.screenshot({ path: `${OUT}/rg-uscito.png` });
await p.locator('button').filter({ hasText: /^Pausa$/ }).first().click(); await attendi(1200);
regia = (await api(admin, '/api/regia')).corpo;
controlla('pausa: l\'orologio si ferma', regia?.orologio?.in_pausa === true, regia?.orologio);
await p.locator('button').filter({ hasText: /^Riprendi$/ }).first().click(); await attendi(1200);
regia = (await api(admin, '/api/regia')).corpo;
controlla('riprende', regia?.orologio?.in_pausa === false, regia?.orologio);
console.log('errori:', p.errori.slice(0, 6));
await api(admin, '/api/emergencies/close', { method: 'POST', body: {} });
console.log(`\n${esiti.filter(Boolean).length}/${esiti.length} controlli superati`);
await b.close();
process.exit(esiti.every(Boolean) ? 0 : 1);
