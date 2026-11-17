// Il pannello Voce nel browser vero: due postazioni di sala in Chromium con il microfono finto
// e un telefono simulato. La sala parla, il telefono riceve; poi il telefono rimanda lo stesso
// audio (Opus vero, codificato dal browser) e la sala lo sente, conferma, prende in carico.
// Playwright non è fra le dipendenze di ORION: si installa a parte, senza salvarlo.
// Crea ed elimina tre persone e una squadra; serve un'emergenza aperta e un'istanza di collaudo.
//   npm install --no-save playwright
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=/percorso/chrome] [ORION_FOTO=cartella] node tests/voce-sala.mjs
// Con il server avviato con ORION_WHISPER=tests/whisper-finto.sh ORION_WHISPER_ATTESA=6, sulla stessa macchina, e
// ORION_PROVA_TRASCRIZIONE=1 prova anche che la trascrizione compare da sola nel pannello.

import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { accediConFetch, prendiVisione } from './accesso-prova.mjs';
import { RADICE_DATI } from '../src/percorsi.js';
import { leggiOggOpus } from '../src/voceOgg.js';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD_ADMIN = process.env.ORION_ADMIN_PASSWORD;
const attesa = ms => new Promise(r => setTimeout(r, ms));
let falliti = 0;
const verifica = (d, ok, x = '') => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); if (!ok) falliti++; };
const chiama = async (p, { method = 'GET', body, token } = {}) => {
    const r = await fetch(BASE + p, { method, body: body ? JSON.stringify(body) : undefined, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    const t = r.headers.get('content-type') || '';
    return { stato: r.status, corpo: t.includes('json') ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer()) };
};

const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', PASSWORD_ADMIN)).token;
if (!(await chiama('/api/emergencies/status', { token: admin })).corpo?.active) { console.error('Serve un\'emergenza aperta.'); process.exit(2); }
const voceDiPrima = (await chiama('/api/branding/settings')).corpo?.voce_enabled ?? 'false';
await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { voce_enabled: 'true' } });
await attesa(5500);
const provaTrascrizione = process.env.ORION_PROVA_TRASCRIZIONE === '1';
const modelloDiPrima = (await chiama('/api/voce/trascrizione', { token: admin })).corpo?.modello ?? null;
const modelloFinto = path.join(RADICE_DATI, 'modelli', 'ggml-base.bin');
const modelloMesso = provaTrascrizione && !fs.existsSync(modelloFinto);
if (modelloMesso) {
    fs.mkdirSync(path.dirname(modelloFinto), { recursive: true });
    fs.writeFileSync(modelloFinto, 'modello finto per le prove');
}
if (provaTrascrizione) await chiama('/api/voce/trascrizione', { method: 'POST', token: admin, body: { modello: 'base' } });
const suffisso = Date.now().toString().slice(-5);
const persone = {};
for (const nome of ['Carla', 'Davide', 'Mario']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome, cognome: `Sala${suffisso}`, role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = `Turno!${suffisso}Lampione1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const token = (await chiama('/login', { method: 'POST', body: { username: n.username, password } })).corpo.token;
    await prendiVisione(BASE, token);
    persone[nome] = { id: n.id, username: n.username, password, token };
}
const squadre = (await chiama('/api/squadre', { token: admin })).corpo;
const coc = squadre.find(s => s.coc);
if (!coc) { console.error('Manca la squadra COC dell\'emergenza: riapri l\'emergenza, la crea l\'apertura.'); process.exit(2); }
await chiama(`/api/squadre/${coc.id}`, { method: 'PUT', token: admin, body: { membri: [...coc.membri.map(m => ({ username: m.username })), { username: persone.Carla.username }, { username: persone.Davide.username }] } });
let squadraId, nomeRadio;
for (const n of ['India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Hotel', 'Golf', 'Foxtrot', 'Echo', 'Delta']) {
    const r = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: n, nome: 'Prova sala', caposquadra: persone.Mario.username, membri: [{ username: persone.Mario.username }] } });
    if (r.stato === 201) { squadraId = r.corpo.squadraId; nomeRadio = n; break; }
}
const canale = `squadra:${squadraId}`;
console.log(`\nPannello Voce nel browser (squadra ${nomeRadio})`);

const tokenVoce = (await chiama('/api/voce/token', { method: 'POST', token: persone.Mario.token, body: {} })).corpo.voce;
const telefono = new WebSocket(BASE.replace('http', 'ws') + '/voce', { headers: { Authorization: `Voce ${tokenVoce}` } });
const alTelefono = [];
const binariTelefono = [];
telefono.on('message', (d, b) => b ? binariTelefono.push(d) : alTelefono.push(JSON.parse(d.toString())));
await new Promise(r => telefono.on('open', r));
const aspettaTelefono = async (f, ms = 8000) => { const fine = Date.now() + ms; while (Date.now() < fine) { const m = alTelefono.find(f); if (m) return m; await attesa(100); } return null; };
let pacchettiVeri = [];
async function parlaDalTelefono(extra = {}) {
    const uuid = crypto.randomUUID();
    telefono.send(JSON.stringify({ t: 'parla', uuid, canale, ...extra }));
    const ok = await aspettaTelefono(m => m.uuid === uuid && m.t === 'parla_ok');
    for (let i = 0; i < pacchettiVeri.length; i++) {
        telefono.send(Buffer.concat([Buffer.from([i >> 8, i & 255]), pacchettiVeri[i]]));
        await attesa(60);
    }
    telefono.send(JSON.stringify({ t: 'fine', uuid, pacchetti: pacchettiVeri.length }));
    const salvato = await aspettaTelefono(m => m.uuid === uuid && m.t === 'salvato');
    return { uuid, id: ok?.id, salvato };
}

const browser = await chromium.launch({
    executablePath: process.env.ORION_CHROMIUM || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=user-gesture-required']
});
async function postazione(nome) {
    const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1500, height: 900 }, bypassCSP: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log(`   [${nome}] errore pagina: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|404|tile|Failed to load resource/.test(m.text())) console.log(`   [${nome}] console: ${m.text()}`); });
    await page.goto(BASE + '/login.html');
    await page.fill('#username', persone[nome].username);
    await page.fill('#password', persone[nome].password);
    await page.click('#login-form button[type=submit]');
    await page.waitForURL(u => !String(u).includes('login'), { timeout: 15000 });
    if (!page.url().includes('centro-operativo')) await page.goto(BASE + '/centro-operativo.html');
    await page.waitForSelector('#toggle-voce-btn', { state: 'attached', timeout: 15000 });
    return page;
}

try {
    const A = await postazione('Carla');
    const B = await postazione('Davide');
    verifica('la linguetta Orion Voice c\'è ed è gialla finché la voce non è attiva', await A.locator('#toggle-voce-btn.voce-muta').count() === 1);
    verifica('la fascia "Attiva la voce della sala" è visibile', await A.locator('#voce-fascia-attiva').isVisible());
    await A.click('#voce-fascia-attiva button');
    // Chrome lascia suonare chi ha già toccato il sito (qui, al login): allora la fascia non serve.
    if (await B.locator('#voce-fascia-attiva').isVisible()) await B.click('#voce-fascia-attiva button');
    await attesa(800);
    verifica('un clic e la voce è attiva: la linguetta non è più gialla', await A.locator('#toggle-voce-btn.voce-muta').count() === 0 && !(await A.locator('#voce-fascia-attiva').isVisible()));
    await A.goto(BASE + '/rubrica.html');
    await A.goto(BASE + '/centro-operativo.html');
    await A.waitForSelector('#toggle-voce-btn', { state: 'attached', timeout: 15000 });
    await attesa(1500);
    const fascia = A.locator('#voce-fascia-attiva');
    const testoFascia = (await fascia.isVisible()) ? await fascia.textContent() : '';
    console.log(`   tornando: ${testoFascia ? `"${testoFascia.trim()}"` : 'audio ripartito da solo'}`);
    verifica('cambiando pagina non si riattiva a mano: l\'audio riparte da solo o al primo clic qualsiasi',
        !(await fascia.isVisible()) || testoFascia.includes('clic qualsiasi'), testoFascia);
    if (await fascia.isVisible()) await A.click('#voce-fascia-attiva span');
    await attesa(300);
    verifica('e dopo quel clic la voce è attiva', await A.locator('#toggle-voce-btn.voce-muta').count() === 0);
    verifica('per chi è in sala il pannello è già aperto, senza linguetta né chiusura',
        await A.locator('body.voce-fissa #pannello-voce:not(.chiuso) #contenuto-voce').isVisible()
        && !(await A.locator('#toggle-voce-btn').isVisible()) && await A.locator('#chiudi-voce-btn').count() === 0);
    await A.click('#toggle-eventi-btn');
    await attesa(300);
    const voceBox = await A.locator('#contenuto-voce').boundingBox();
    const eventiBox = await A.locator('#contenuto-eventi').boundingBox();
    verifica('gli eventi si aprono accanto, a sinistra, e il pannello resta aperto',
        voceBox && eventiBox && eventiBox.x + eventiBox.width <= voceBox.x + 1 && await A.locator('#contenuto-voce').isVisible(), { voceBox, eventiBox });
    await A.click('#chiudi-eventi-btn');
    await attesa(500);
    const righe = await A.locator('.voce-canale strong').allTextContents();
    verifica('il pannello ha una riga per il generale e una per la squadra', righe.includes('Generale') && righe.includes(nomeRadio), righe);
    await A.waitForSelector(`.voce-canale[data-canale="${canale}"] .voce-presenze`, { timeout: 10000 }).catch(() => {});
    verifica('la sala vede quanti telefoni della squadra hanno la voce accesa', (await A.locator(`.voce-canale[data-canale="${canale}"] .voce-presenze`).textContent())?.includes('1/1'));

    verifica('il pannello è essenziale: niente riga scelta, niente tasto F9 a vista, niente spiegazioni',
        await A.locator('.voce-canale.selezionato, .voce-tasto-qui, .voce-guida, .voce-tasti, #voce-canali ~ .voce-nota').count() === 0
        && !(await A.locator('#contenuto-voce').textContent()).includes('F9'));
    const tasto = A.locator(`.voce-canale[data-canale="${canale}"] .voce-parla`);
    alTelefono.length = 0;
    binariTelefono.length = 0;
    await tasto.hover();
    const primaDiPremere = await tasto.boundingBox();
    await A.mouse.down();
    await attesa(2600);
    verifica('mentre la sala parla, il pannello mostra "Parli su..."', (await A.locator('#voce-trasmissione').textContent())?.includes('Parli su'));
    const mentrePremuto = await A.locator(`.voce-canale[data-canale="${canale}"] .voce-parla`).boundingBox();
    verifica('e il tasto premuto resta sotto il dito', mentrePremuto && Math.abs(mentrePremuto.y - primaDiPremere.y) < 1, { primaDiPremere, mentrePremuto });
    await A.mouse.up();
    const inizio = await aspettaTelefono(m => m.t === 'inizio');
    const fine = await aspettaTelefono(m => m.t === 'fine' && m.id === inizio?.messaggio?.id);
    verifica('il telefono riceve la voce della sala in diretta', !!inizio && binariTelefono.length >= 25, `${binariTelefono.length} pacchetti`);
    verifica('con la durata giusta', fine?.durata_ms >= 2000 && fine.durata_ms <= 3200, fine);
    const audio = await chiama(`/api/voce/messaggi/${inizio?.messaggio?.id}/audio`, { token: persone.Mario.token });
    try { pacchettiVeri = leggiOggOpus(audio.corpo).pacchetti; } catch { /* resta vuoto */ }
    verifica('l\'archivio ha l\'audio Opus codificato dal browser', pacchettiVeri.length >= 25 && pacchettiVeri[0].length > 10, pacchettiVeri.length);

    const primo = parlaDalTelefono();
    await attesa(900);
    verifica('mentre Mario parla la riga mostra chi parla', (await A.locator(`.voce-canale[data-canale="${canale}"].parla-ora`).count()) === 1);
    verifica('e la barra delle squadre accende l\'altoparlante', (await A.locator(`.team-status-item[data-team-id="${squadraId}"].voce-parla-ora`).count()) === 1);
    const m1 = await primo;
    verifica('il messaggio del telefono è salvato', !!m1.salvato);
    if (provaTrascrizione) {
        verifica('la trascrizione compare da sola nella cronologia, senza ricaricare',
            await A.locator('.voce-storia .voce-trascrizione', { hasText: 'motopompa' }).first().waitFor({ timeout: 20000 }).then(() => true, () => false));
    }
    const riprodotto = await aspettaTelefono(m => m.t === 'riprodotto' && m.id === m1.id, 12000);
    verifica('la sala lo riproduce in diretta e Mario vede "riprodotto in sala"', !!riprodotto);
    const ascolti = (await chiama(`/api/voce/messaggi?canale=${canale}`, { token: persone.Carla.token })).corpo.messaggi.find(m => m.id === m1.id);
    verifica('e il messaggio non è più fra i non ascoltati', ascolti?.riprodotto_in_sala === true, ascolti);

    alTelefono.length = 0;
    await A.keyboard.down('F9');
    await attesa(1500);
    await A.keyboard.up('F9');
    verifica('F9 parla sull\'ultimo canale usato con PARLA', !!(await aspettaTelefono(m => m.t === 'fine' && m.stato === 'completo')));
    await A.keyboard.down('F9');
    await attesa(300);
    await A.evaluate(() => window.dispatchEvent(new Event('blur')));
    await attesa(800);
    verifica('se la finestra perde il fuoco mentre si tiene F9, la trasmissione si chiude', await A.locator('#voce-trasmissione').isHidden());
    await A.keyboard.up('F9');

    const ricevuto = A.locator('.voce-ricevuto').first();
    await ricevuto.click();
    verifica('"Ricevuto" dalla sala arriva sul telefono di Mario', !!(await aspettaTelefono(m => m.t === 'ricevuto' && m.id === m1.id)));

    await A.click(`.voce-canale[data-canale="${canale}"] .voce-cuffia`);
    await B.click(`.voce-canale[data-canale="${canale}"] .voce-cuffia`);
    await attesa(1500);
    verifica('se nessuna postazione ascolta la squadra la riga lo dice', (await A.locator(`.voce-canale[data-canale="${canale}"] .voce-nessuno`).textContent())?.includes('Nessuna postazione'));
    await A.click(`.voce-canale[data-canale="${canale}"] .voce-cuffia`);
    await B.click(`.voce-canale[data-canale="${canale}"] .voce-cuffia`);

    const sos = parlaDalTelefono({ priorita: 'emergenza', posizione: { lat: 46.1, lon: 12.2 } });
    await attesa(1500);
    verifica('l\'emergenza apre la fascia rossa in tutte e due le postazioni', await A.locator('.voce-emergenza').count() === 1 && await B.locator('.voce-emergenza').count() === 1);
    await sos;
    await B.click('.voce-emergenza button:has-text("Silenzia")');
    await attesa(300);
    verifica('"Silenzia" ferma l\'allarme solo di quella postazione', await B.locator('.voce-emergenza button:has-text("Silenzia")').count() === 0
        && await A.locator('.voce-emergenza button:has-text("Silenzia")').count() === 1 && await B.locator('.voce-emergenza').count() === 1);
    await A.click('.voce-emergenza .voce-prendo');
    await attesa(1500);
    verifica('"Prendo in carico" la ferma per tutte le postazioni', await B.locator('.voce-emergenza').count() === 0);
    verifica('e Mario sa che la sala l\'ha presa', !!(await aspettaTelefono(m => m.t === 'presa_in_carico')));

    await A.click(`.team-status-item[data-team-id="${squadraId}"]`);
    await attesa(400);
    verifica('nel menu della squadra c\'è il tasto "Parla ad..."', (await A.locator('.menu-squadra .voce-parla-grande').textContent())?.includes(`Parla ad ${nomeRadio}`));
    await A.click('.menu-squadra .voce-menu-squadra button:has-text("Membri")').catch(() => A.locator('.menu-squadra button:has-text("Membri")').click());
    await attesa(500);
    await A.click('.voce-diretto-membro');
    await attesa(4500);
    verifica('dai membri si apre un canale diretto, che compare nel pannello', await A.locator(`.voce-canale[data-canale="diretto:${persone.Mario.id}"]`).count() === 1);
    await A.keyboard.press('Escape');
    await A.click('#okTeamMembersModalBtn').catch(() => {});
    await attesa(300);
    // Le foto per il manuale, se richieste: ORION_FOTO=cartella.
    if (process.env.ORION_FOTO) {
        await A.click('#toggle-eventi-btn');
        await attesa(800);
        await A.screenshot({ path: `${process.env.ORION_FOTO}/14-co-voce.png` });
        await A.click('#chiudi-eventi-btn');
    }
} finally {
    telefono.close();
    await browser.close();
    await chiama(`/api/voce/diretti/${persone.Mario.id}`, { method: 'DELETE', token: persone.Carla.token }).catch(() => {});
    const c = (await chiama('/api/squadre', { token: admin })).corpo.find(s => s.coc);
    await chiama(`/api/squadre/${c.id}`, { method: 'PUT', token: admin, body: { membri: c.membri.filter(m => ![persone.Carla.username, persone.Davide.username].includes(m.username)).map(m => ({ username: m.username })) } });
    if (squadraId) await chiama(`/api/squadre/${squadraId}`, { method: 'DELETE', token: admin });
    for (const p of Object.values(persone)) await chiama(`/api/users/${p.id}`, { method: 'DELETE', token: admin });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { voce_enabled: voceDiPrima } });
    if (provaTrascrizione) await chiama('/api/voce/trascrizione', { method: 'POST', token: admin, body: { modello: modelloDiPrima } });
    if (modelloMesso) fs.rmSync(modelloFinto, { force: true });
}
console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutto a posto.');
process.exit(falliti ? 1 : 0);
