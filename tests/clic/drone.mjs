// Il drone nella sala, sulla parete e nell'archivio, con MediaMTX finto (il video vero lo dà solo MediaMTX).
//   ORION_URL=... ORION_ADMIN_PASSWORD=... ORION_DRONE_SEGRETO=... ORION_DRONE_REGISTRAZIONI=... node tests/clic/drone.mjs (di solito da tests/clic-aree.mjs)
import fs from 'fs';
import path from 'path';
import { CARTELLA_FOTO, browser, contesto, entra, api, BASE } from './aiuto.mjs';
import { avviaMediaMtxFinto } from '../mediamtx-finto.mjs';
const OUT = CARTELLA_FOTO; const attendi = (ms) => new Promise(r => setTimeout(r, ms));
const esiti = []; const controlla = (d, ok, x = '') => { esiti.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); };
const finto = await avviaMediaMtxFinto({ orion: BASE, segreto: process.env.ORION_DRONE_SEGRETO });
const b = await browser();
const ctx = await contesto(b);
await ctx.route(/tile\.openstreetmap\.org|arcgisonline/, r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
const { pagina: p, token: admin } = await entra(ctx, 'admin', process.env.ORION_ADMIN_PASSWORD);
p.on('dialog', d => d.accept());
if ((await api(admin, '/api/emergencies/status')).corpo?.active) await api(admin, '/api/emergencies/close', { method: 'POST', body: {} });
const droneAcceso = (await api(admin, '/api/branding/settings')).corpo?.drone_enabled === 'true';
await api(admin, '/api/branding/settings', { method: 'PUT', body: { drone_enabled: 'true' } });
const codice = `DRN-${Date.now().toString().slice(-5)}`;
await api(admin, '/api/emergencies/open', { method: 'POST', body: { external_code: codice } });
await p.goto(BASE + '/centro-operativo.html'); await attendi(3500);
controlla('in emergenza, con il modulo acceso, c\'è il pulsante Drone', await p.isVisible('#drone-btn'));
await p.click('#drone-btn'); await attendi(800);
controlla('il pannello dice che serve una chiave', /ha bisogno di una chiave/.test(await p.textContent('.dr-pannello')));
await p.fill('.dr-nuova input', 'Matrice 4E – Marco');
await p.click('.dr-nuova button[type=submit]'); await attendi(1500);
const scheda = await p.textContent('.dr-chiave');
const indirizzo = (await p.textContent('.dr-chiave code')).trim();
controlla('la chiave si vede con indirizzo RTMP e QR', /rtmp:\/\/.+\/drone\/[A-Za-z0-9_-]{24,}/.test(indirizzo) && await p.locator('.dr-qr canvas, .dr-qr img').count() >= 1, scheda);
await p.screenshot({ path: `${OUT}/dr-chiave.png` });
const chiave = indirizzo.split('/drone/')[1];
await finto.trasmetti(`drone/${chiave}`);
await attendi(13000);
controlla('quando il pilota va in onda il pulsante ha il pallino rosso', await p.locator('#drone-btn .drone-in-onda').count() === 1);
// Con MediaMTX finto il video non si apre: la vista si toglie e resta "Guarda" per riprovare.
controlla('nel pannello IN ONDA, e se il video non si apre si può riprovare', /IN ONDA/.test(await p.textContent('.dr-pannello'))
    && await p.locator('.dr-voce:has(.dr-stato.onda) button:text-is("Guarda")').count() === 1);
controlla('la sala ha chiesto la diretta a ORION', finto.richieste.some(r => r.url === `/drone/${chiave}/whep`));
await p.screenshot({ path: `${OUT}/dr-in-onda.png` });
// Il video finto non si apre con MediaMTX finto: da qui la pagina riceve un flusso disegnato, il resto è vero.
await p.evaluate(() => {
    window.DroneVideo.guarda = async (id, video) => {
        const tela = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
        const g = tela.getContext('2d'); let n = 0;
        const giro = setInterval(() => { g.fillStyle = `hsl(${(n++ * 9) % 360} 55% 35%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '36px sans-serif'; g.fillText(`drone ${id} · ${n}`, 30, 190); }, 100);
        video.srcObject = tela.captureStream(10);
        (window.sessioniDrone ||= new Set()).add(String(id));
        return { chiudi() { clearInterval(giro); video.srcObject = null; window.sessioniDrone.delete(String(id)); } };
    };
});
const secondo = (await api(admin, '/api/drone/chiavi', { method: 'POST', body: { nome: 'Mavic 3T – Luca' } })).corpo;
await finto.trasmetti(`drone/${secondo.chiave}`); await attendi(4000);
const guarda = p.locator('.dr-voce:has(.dr-stato.onda) button:text-is("Guarda")');
for (let giri = 0; giri < 3 && await guarda.count(); giri++) { await guarda.first().click(); await attendi(300); }
await attendi(800);
controlla('due droni insieme nel pannello, affiancati', await p.locator('.dr-pannello .dr-griglia .dr-vista video').count() === 2
    && await p.evaluate(() => document.querySelector('.dr-pannello').classList.contains('largo')));
await p.screenshot({ path: `${OUT}/dr-due.png` });
await p.locator(`.dr-griglia .dr-vista[data-chiave="${secondo.id}"] button[title="Staccala in una finestra"]`).click(); await attendi(500);
controlla('una diretta si stacca in una finestra e lascia l\'altra nel pannello', await p.locator('.dr-finestra video').count() === 1 && await p.locator('.dr-griglia video').count() === 1
    && /in una finestra a parte/.test(await p.textContent('.dr-pannello')));
const finestra = p.locator('.dr-finestra');
const prima = await finestra.boundingBox();
const testa = await p.locator('.dr-finestra .dr-vista-testa strong').boundingBox();
await p.mouse.move(testa.x + 5, testa.y + 5); await p.mouse.down(); await p.mouse.move(testa.x + 205, testa.y + 155, { steps: 8 }); await p.mouse.up();
const dopo = await finestra.boundingBox();
controlla('la finestra si sposta trascinandola per la testata', Math.abs(dopo.x - (prima.x + 200)) < 8 && Math.abs(dopo.y - (prima.y + 150)) < 8, { prima, dopo });
await p.screenshot({ path: `${OUT}/dr-finestra.png` });
await p.click('.dr-pannello .dr-chiudi'); await attendi(500);
controlla('chiuso il pannello la finestra resta, con la sua diretta', await p.locator('.dr-pannello').count() === 0 && await finestra.isVisible()
    && await p.evaluate(() => [...window.sessioniDrone].join()) === String(secondo.id));
await finestra.locator('button[title="Rimettila nel pannello"]').click(); await attendi(1500);
controlla('la finestra rientra nel pannello, che si riapre', await p.locator('.dr-finestra').count() === 0 && await p.locator(`.dr-griglia .dr-vista[data-chiave="${secondo.id}"] video`).count() === 1);
await p.locator(`.dr-griglia .dr-vista[data-chiave="${secondo.id}"] button[title="Staccala in una finestra"]`).click(); await attendi(300);
finto.smetti(`drone/${secondo.chiave}`); await attendi(13000);
controlla('quando il drone smette la sua finestra si chiude da sola, con la sessione', await p.locator('.dr-finestra').count() === 0
    && !(await p.evaluate(() => [...window.sessioniDrone])).includes(String(secondo.id)));
const richiestePrima = finto.richieste.filter(r => r.url === `/drone/${chiave}/whep`).length;
const pareteP = await ctx.newPage();
await pareteP.goto(BASE + '/parete.html'); await attendi(4000);
// Con MediaMTX finto il video non si apre e la parete nasconde il riquadro: qui si guarda che lo abbia chiesto.
controlla('lo schermo a parete chiede da solo la diretta del drone in onda', finto.richieste.filter(r => r.url === `/drone/${chiave}/whep`).length > richiestePrima
    && /Matrice/.test(await pareteP.textContent('#parete-drone-nome')));
await pareteP.screenshot({ path: `${OUT}/dr-parete.png` });
finto.smetti(`drone/${chiave}`);
const dir = path.join(process.env.ORION_DRONE_REGISTRAZIONI, 'drone', chiave);
fs.mkdirSync(dir, { recursive: true });
const f = path.join(dir, '2026-11-17_10-00-00-000000.mp4');
fs.writeFileSync(f, Buffer.alloc(2048, 1));
fs.utimesSync(f, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
await attendi(13000);
controlla('finita la diretta il pallino sparisce', await p.locator('#drone-btn .drone-in-onda').count() === 0);
await api(admin, '/api/emergencies/close', { method: 'POST', body: {} });
await p.goto(BASE + '/admin/archive.html'); await attendi(2500);
const opzione = p.locator(`option[data-code="${codice}"]`).first();
await opzione.locator('xpath=..').selectOption(await opzione.getAttribute('value')); await attendi(2500);
controlla('nell\'archivio la ripresa del drone', await p.isVisible('#archived-drone-section') && /Matrice 4E/.test(await p.textContent('#archived-drone-list')));
await p.screenshot({ path: `${OUT}/dr-archivio.png` });
controlla('il video che non si apre lo dice una volta sola, in italiano', (await p.locator('text=Il video non si apre').count()) <= 1);
await finto.chiudi();
await api(admin, '/api/branding/settings', { method: 'PUT', body: { drone_enabled: droneAcceso ? 'true' : 'false' } });
console.log(`\n${esiti.filter(Boolean).length}/${esiti.length} controlli superati`);
await b.close();
process.exit(esiti.every(Boolean) ? 0 : 1);
