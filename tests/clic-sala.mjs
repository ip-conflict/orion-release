// La sala usata con i clic, come la usa una persona: emergenza vera, simulazione interrotta da
// un'emergenza vera, accesso esterno dal QR, moduli accesi e spenti uno per volta.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=/percorso/chrome] node tests/clic-sala.mjs
// Chiude l'emergenza aperta, se c'è; crea ed elimina persone e squadre; rimette i moduli tutti accesi.

import 'dotenv/config';
import fs from 'fs';
import { chromium } from 'playwright';
import { accediConFetch, PASSWORD_PROVA } from './accesso-prova.mjs';
import { accediNelContesto, assesta, seguiRichieste } from './clic/aiuto.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (d, ok, x = '') => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); if (!ok) falliti++; };
const attesa = ms => new Promise(r => setTimeout(r, ms));
const suf = Date.now().toString().slice(-5);

const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const api = async (percorso, { method = 'GET', body, token = admin } = {}) => {
    const r = await fetch(BASE + percorso, { method, body: body ? JSON.stringify(body) : undefined, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` } });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const chiudiSeAperta = async () => { if ((await api('/api/emergencies/status')).corpo?.active) await api('/api/emergencies/close', { method: 'POST', body: {} }); };
const persone = [], squadre = [];
async function persona(nome) {
    const n = (await api('/api/users', { method: 'POST', body: { nome, cognome: `Clic${suf}`, role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = PASSWORD_PROVA;
    await api('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    persone.push(n.id);
    return { ...n, token: (await accediConFetch(BASE, n.username, password)).token };
}
async function squadra(nome, membri = []) {
    const usati = new Set(((await api('/api/squadre')).corpo || []).map(s => s.nome_radio));
    const radio = ['Tango', 'Uniform', 'Victor', 'Whiskey', 'Yankee', 'Zulu', 'Kilo', 'Lima'].find(r => !usati.has(r));
    const id = (await api('/api/squadre', { method: 'POST', body: { nome_radio: radio, nome, membri: membri.map(username => ({ username })) } })).corpo.squadraId;
    squadre.push(id);
    return { id, radio };
}

const browser = await chromium.launch({ executablePath: process.env.ORION_CHROMIUM || undefined });
async function contesto(larghezza = 1366, altezza = 800) {
    const ctx = seguiRichieste(await browser.newContext({ viewport: { width: larghezza, height: altezza }, acceptDownloads: true }));
    await ctx.route(/tile\.openstreetmap\.org|arcgisonline/, r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
    await ctx.route(/photon\.komoot\.io|nominatim/, r => r.fulfill({ json: r.request().url().includes('photon') ? { features: [] } : [] }));
    return ctx;
}
async function entraComeAdmin() {
    const ctx = await contesto();
    await accediNelContesto(ctx, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD);
    const p = await ctx.newPage();
    p.errori = [];
    p.on('pageerror', e => p.errori.push(e.message));
    p.on('dialog', d => d.accept());
    return p;
}
const p = await entraComeAdmin();

async function chiudiDalPulsante() {
    await p.goto(BASE + '/centro-operativo.html'); await assesta(p, 2000);
    await p.click('#close-emergency-btn'); await assesta(p, 800);
    await p.locator('.chiusura-emergenza button').filter({ hasText: /Chiudi/ }).last().click(); await assesta(p, 3000);
}

async function emergenzaVera() {
    console.log('\nEmergenza vera');
    const codice = `CLIC-${suf}`;
    await p.goto(BASE + '/centro-operativo.html'); await assesta(p, 2500);
    await p.click('#open-emergency-btn'); await assesta(p, 400);
    await p.fill('#emergency-external-code', codice);
    await p.click('#open-emergency-form button[type=submit]'); await assesta(p, 3000);
    verifica('aperta dal pulsante, la fascia ha il codice', (await p.textContent('#emergency-status-display')).includes(codice));

    const crea = async ({ titolo, tipo, lat, lon, priorita }) => {
        if (await p.evaluate(() => document.body.classList.contains('dettaglio-aperto') && document.body.classList.contains('dettaglio-in-colonna'))) {
            await p.click('#torna-elenco-btn'); await assesta(p, 500);
        }
        await p.click('#createNewReportBtn'); await assesta(p, 500);
        await p.fill('#create-title', titolo);
        if (tipo) await p.click(`#create-tipo .tipo-scelta[data-tipo="${tipo}"]`);
        if (priorita) await p.selectOption('#create-priority', priorita);
        if (lat != null) { await p.fill('#create-latitude', String(lat)); await p.fill('#create-longitude', String(lon)); }
        await p.click('#createReportForm button[type=submit]'); await assesta(p, 1800);
    };
    const aperte = async () => (await api('/api/reports?status_type=active&limit=100')).corpo?.reports || [];
    verifica('i pulsanti del tipo sono sette', await p.locator('#create-tipo .tipo-scelta').count() === 7);
    await crea({ titolo: `Cantina allagata ${suf}`, tipo: 'allagamento', lat: 46.0300, lon: 11.9200, priorita: 'High' });
    const prima = (await aperte()).find(r => r.title === `Cantina allagata ${suf}`);
    verifica('creata con il tipo scelto con i pulsanti', prima?.tipo === 'allagamento', prima);
    verifica("nell'elenco la scheda ha l'icona del tipo", await p.locator(`.inbox-card[data-report-id="${prima?.id}"] .icona-tipo`).count() === 1);

    await crea({ titolo: `Seconda telefonata ${suf}`, tipo: 'allagamento', lat: 46.0303, lon: 11.9201 });
    verifica('a 35 metri il modulo mostra la segnalazione vicina invece di creare', await p.isVisible('#vicine-avviso'));
    await p.click('#vicine-avviso button:has-text("Apri quella")'); await assesta(p, 1500);
    verifica('"Apri quella" apre la scheda con il testo pronto come nota', /Seconda telefonata/.test(await p.inputValue('#bottom-new-update-text').catch(() => '')));
    verifica('e non crea il doppione', !(await aperte()).some(r => r.title.includes('Seconda telefonata')));
    await crea({ titolo: `Altra cantina ${suf}`, lat: 46.0303, lon: 11.9201 });
    await p.click('#vicine-avviso button:has-text("Crea comunque")'); await assesta(p, 1800);
    verifica('"Crea comunque" la crea', (await aperte()).some(r => r.title.includes('Altra cantina')));
    await crea({ titolo: `Pino sulla provinciale ${suf}`, tipo: 'albero', lat: 46.05, lon: 11.95 });
    await crea({ titolo: `Senza punto ${suf}` });
    verifica('senza punto si crea senza chiedere niente', (await aperte()).some(r => r.title.includes('Senza punto')));

    await p.reload(); await assesta(p, 2500);
    const filtro = p.locator('select.filtro-tipo');
    if (await filtro.count()) {
        await filtro.selectOption('albero'); await assesta(filtro, 600);
        verifica('il filtro "Albero" lascia una scheda sola', await p.locator('#report-list-body .inbox-card:visible').count() === 1);
        await filtro.selectOption(''); await assesta(filtro, 400);
    } else verifica("c'è il filtro per tipo", false);

    const sq = await squadra('Pompe');
    await api(`/api/reports/${prima.id}/teams`, { method: 'POST', body: { teamId: sq.id } });
    await p.reload(); await assesta(p, 2500);
    await p.click(`.inbox-card[data-report-id="${prima.id}"]`); await assesta(p, 1500);
    const scelta = p.locator(`select.stato-squadra[data-team-id="${sq.id}"]`);
    verifica('nella scheda la squadra ha la tendina dello stato', await scelta.count() === 1);
    if (await scelta.count()) {
        await scelta.selectOption('sul_posto'); await assesta(scelta, 1500);
        const d = (await api(`/api/reports/${prima.id}`)).corpo;
        verifica('la tendina cambia lo stato', d.report.assigned_teams[0]?.stato === 'sul_posto', d.report.assigned_teams);
        verifica('il diario aperto mostra la nota senza riaprire la scheda', new RegExp(`${sq.radio} sul posto`).test(await p.textContent('#report-detail-side-panel')));
        verifica('la barra delle squadre dice "sul posto"', /sul posto/i.test(await p.textContent('#team-status-content').catch(() => '')));
    }

    await chiudiDalPulsante();
    verifica('chiusa dal pulsante', !(await api('/api/emergencies/status')).corpo?.active);
    await p.goto(BASE + '/admin/archive.html'); await assesta(p, 2500);
    const opzione = p.locator(`option[data-code="${codice}"]`).first();
    await opzione.locator('xpath=..').selectOption(await opzione.getAttribute('value')); await assesta(opzione, 2500);
    verifica('nell\'archivio ci sono "Foglio di calcolo" e "Mappa (GeoJSON)"', await p.isVisible('#esporta-csv-link') && await p.isVisible('#esporta-geojson-link'));
    if (await p.isVisible('#esporta-csv-link')) {
        const [scarico] = await Promise.all([p.waitForEvent('download'), p.click('#esporta-csv-link')]);
        const righe = fs.readFileSync(await scarico.path(), 'utf8').trim().split('\r\n');
        verifica('il CSV si scarica con il codice nel nome e una riga per segnalazione', scarico.suggestedFilename().startsWith(codice) && righe.length === 5, `${scarico.suggestedFilename()} ${righe.length}`);
    }
}

async function simulazioneInterrotta() {
    console.log('\nSimulazione al volo, poi emergenza vera');
    const vol = await persona('Sim');
    const sq = await squadra('Sim', [vol.username]);
    await p.goto(BASE + '/centro-operativo.html'); await assesta(p, 2500);
    verifica('in pace: "Nessuna emergenza" e il pulsante Simulazione', /Nessuna/i.test(await p.textContent('#emergency-status-display')) && await p.isVisible('#simulazione-btn'));
    await p.click('#simulazione-btn'); await assesta(p, 800);
    await p.fill('.sv-finestra input:not([type=radio])', `Prova piena ${suf}`);
    await p.click('.sv-finestra .sv-apri'); await assesta(p, 3500);
    const st = (await api('/api/emergencies/status')).corpo;
    verifica('la simulazione si apre dal pulsante', st?.active && st.emergency?.simulazione === true, st?.emergency);
    verifica('"Chiudi la simulazione" al posto di "Chiudi emergenza"', /simulazione/i.test(await p.textContent('#close-emergency-btn')));
    const seg = (await api('/api/reports', { method: 'POST', body: { title: `Allagamento simulato ${suf}` } })).corpo;
    await api(`/api/reports/${seg.id}/teams`, { method: 'POST', body: { teamId: sq.id } });
    await attesa(800);
    const assegnata = ((await api('/api/notifiche', { token: vol.token })).corpo?.notifiche || []).find(x => x.tipo === 'intervento_assegnato');
    verifica("il volontario riceve l'intervento con [SIMULAZIONE] davanti", assegnata?.titolo.startsWith('[SIMULAZIONE]'), assegnata);

    await p.reload(); await assesta(p, 2500);
    verifica('durante la simulazione "Apri emergenza" diventa "Emergenza reale"', /reale/i.test(await p.textContent('#open-emergency-btn')));
    await p.click('#open-emergency-btn'); await assesta(p, 500);
    await p.fill('#emergency-external-code', `VERA-${suf}`);
    await p.click('#open-emergency-form button[type=submit]'); await assesta(p, 3500);
    const vera = (await api('/api/emergencies/status')).corpo;
    verifica("l'emergenza vera prende il posto della simulazione", vera?.active && !vera.emergency?.simulazione, vera?.emergency);
    verifica("le segnalazioni simulate non entrano nell'emergenza vera", !((await api('/api/reports?status_type=active&limit=50')).corpo?.reports || []).some(r => r.title.includes('simulato')));
    verifica('la squadra resta formata e libera', !((await api('/api/squadre')).corpo || []).find(s => s.id === sq.id)?.active_target_info);
    verifica("l'avviso dell'intervento simulato non resta fra le notifiche", !((await api('/api/notifiche', { token: vol.token })).corpo?.notifiche || []).some(x => x.titolo.startsWith('[SIMULAZIONE]') && x.tipo === 'intervento_assegnato'));
    await chiudiDalPulsante();
    await p.reload(); await assesta(p, 2500);
    verifica('chiusa, si torna alla pace con il pulsante Simulazione', !(await api('/api/emergencies/status')).corpo?.active && await p.isVisible('#simulazione-btn'));
}

async function esterno() {
    console.log('\nAccesso esterno dal QR');
    await api('/api/emergencies/open', { method: 'POST', body: { external_code: `EST-${suf}` } });
    const est = (await api('/api/esterni-temporanei', { method: 'POST', body: { nome: 'Ospite Vigili', ente: 'VVF' } })).corpo;
    if (est?.id) persone.push(est.id);
    const ctx = await contesto(390, 800);
    const e = await ctx.newPage();
    e.errori = [];
    e.on('pageerror', x => e.errori.push(x.message));
    await e.goto(`${BASE}/accesso.html#c=${est.codice}`); await assesta(e, 2000);
    verifica("l'indirizzo del QR saluta e porta alla mappa", /Ciao/.test(await e.textContent('#titolo')));
    await e.click('a.pulsante'); await assesta(e, 2500);
    verifica("al primo ingresso chiede le condizioni d'uso", e.url().includes('informativa'), e.url());
    for (const c of await e.locator('input[type=checkbox]').all()) await c.check();
    await e.locator('button').filter({ hasText: /Continua/ }).first().click(); await assesta(e, 2500);
    verifica('accettate, arriva al centro operativo', e.url().includes('centro-operativo'), e.url());
    for (const pg of ['/admin/admin.html', '/admin/dashboard-admin.html', '/admin/sistema.html', '/admin/archive.html', '/admin/funzioni.html',
        '/admin/tesserino.html', '/admin/squadre.html', '/admin-segreteria.html', '/magazzino.html', '/magazzino-etichette.html', '/simulazioni.html', '/copione.html']) {
        const r = await e.goto(BASE + pg); await assesta(e, 1200);
        const testo = await e.textContent('body');
        verifica(`l'esterno non usa ${pg}`, r.status() === 403 && /non è per te/.test(testo) || e.url().includes('centro-operativo'), `HTTP ${r.status()} ${e.url()}`);
    }
    verifica("nessun errore nel browser dell'esterno", e.errori.length === 0, e.errori);
    await ctx.close();
    await chiudiSeAperta();
}

async function moduli() {
    console.log('\nModuli accesi e spenti');
    const segreteriaPrima = (await api('/api/branding/settings')).corpo?.segreteria_config;
    const confSegreteria = (acceso) => { let c = {}; try { c = typeof segreteriaPrima === 'string' ? JSON.parse(segreteriaPrima) : (segreteriaPrima || {}); } catch { c = {}; } return JSON.stringify({ ...c, enabled: acceso }); };
    const MODULI = ['magazzino', 'attivita', 'funzioni', 'voce', 'segreteria'];
    const imposta = async (a) => api('/api/branding/settings', { method: 'PUT', body: {
        magazzino_enabled: String(a.magazzino), attivita_enabled: String(a.attivita), funzioni_enabled: String(a.funzioni), voce_enabled: String(a.voce), segreteria_config: confSegreteria(a.segreteria) } });
    const VOCE_MENU = { magazzino: 'Magazzino', attivita: 'Calendario', funzioni: 'Funzioni', segreteria: 'Segreteria' };
    const PAGINA = { magazzino: '/magazzino.html', attivita: '/calendario.html', funzioni: '/admin/funzioni.html', segreteria: '/admin-segreteria.html' };
    const combinazioni = [['tutti accesi', Object.fromEntries(MODULI.map(m => [m, true]))],
        ...MODULI.map(m => [`${m} spento`, Object.fromEntries(MODULI.map(x => [x, x !== m]))]),
        ['tutti spenti', Object.fromEntries(MODULI.map(m => [m, false]))]];
    try {
        for (const [nome, accesi] of combinazioni) {
            await imposta(accesi);
            await api('/api/emergencies/open', { method: 'POST', body: { external_code: `MOD-${Date.now().toString().slice(-6)}` } });
            await p.goto(BASE + '/centro-operativo.html'); await assesta(p, 3000);
            await p.click('#top-menu-btn'); await assesta(p, 400);
            const voci = (await p.locator('#menu-scorrevole .sidebar-menu li:visible a').allTextContents()).map(t => t.trim());
            await p.keyboard.press('Escape');
            const sbagliate = Object.entries(VOCE_MENU).filter(([m, etichetta]) => voci.includes(etichetta) !== accesi[m]).map(([, e]) => e);
            verifica(`${nome}: il menu ha solo le voci dei moduli accesi`, sbagliate.length === 0, voci.join('|'));
            verifica(`${nome}: pulsante Funzioni della sala`, await p.isVisible('#funzioni-btn') === accesi.funzioni);
            verifica(`${nome}: Orion Voice in sala`, (await p.locator('#pannello-voce').count() > 0) === accesi.voce);
            for (const [m, pg] of Object.entries(PAGINA)) {
                if (accesi[m]) continue;
                const r = await p.goto(BASE + pg); await assesta(p, 1800);
                const testo = (await p.textContent('body')).replace(/\s+/g, ' ');
                verifica(`${nome}: aprendo ${pg} si capisce che il modulo è spento`,
                    /spent|disabilitat|disattivat/i.test(testo) || p.url().includes('centro-operativo') || r.status() === 403, `HTTP ${r.status()} ${testo.slice(0, 120)}`);
            }
            const app = (await api('/api/app/contesto')).corpo?.moduli || {};
            verifica(`${nome}: l'app riceve i moduli giusti`, ['magazzino', 'attivita', 'voce', 'segreteria'].every(m => (app[m] === true) === accesi[m]), app);
            await api('/api/emergencies/close', { method: 'POST', body: {} });
        }
    } finally {
        await imposta(Object.fromEntries(MODULI.map(m => [m, true])));
    }
}

console.log('\nLa sala con i clic');
try {
    await chiudiSeAperta();
    await emergenzaVera();
    await simulazioneInterrotta();
    await esterno();
    await moduli();
    verifica("nessun errore nel browser dell'amministratore", p.errori.length === 0, p.errori.slice(0, 5));
} finally {
    await chiudiSeAperta();
    for (const s of squadre) await api(`/api/squadre/${s}`, { method: 'DELETE', body: { beni: [] } });
    for (const id of persone) await api(`/api/users/${id}`, { method: 'DELETE', body: { beni: [] } });
    await browser.close();
}

console.log(falliti === 0 ? '\nLa sala con i clic: tutto a posto\n' : `\nLa sala con i clic: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
