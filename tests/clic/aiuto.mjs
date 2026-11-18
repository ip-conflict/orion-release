// Aiuti comuni ai giri con i clic di tests/clic-aree.mjs: browser, contesti, accesso, chiamate alle API.
import 'dotenv/config';
import os from 'os';
import { chromium } from 'playwright';
import { accediConVerifica, prendiVisione, salvaSessione, sessioneValida } from '../accesso-prova.mjs';

export const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
export const CARTELLA_FOTO = process.env.ORION_FOTO || os.tmpdir();

export async function browser() {
    return chromium.launch({ executablePath: process.env.ORION_CHROMIUM || undefined });
}

export async function contesto(b, { larghezza = 1366, altezza = 800 } = {}) {
    return seguiRichieste(await b.newContext({ viewport: { width: larghezza, height: altezza }, acceptDownloads: true }));
}

// Le richieste ancora aperte di ogni pagina, per sapere quando ha finito di lavorare (vedi assesta).
const aperte = new WeakMap();
const CHE_CONTANO = new Set(['document', 'fetch', 'xhr', 'script']);
export function seguiRichieste(ctx) {
    const di = (r) => { try { return CHE_CONTANO.has(r.resourceType()) ? r.frame().page() : null; } catch { return null; } };
    const conta = (r, quanto) => { const p = di(r); if (p) aperte.set(p, Math.max(0, (aperte.get(p) || 0) + quanto)); };
    ctx.on('request', r => conta(r, 1));
    ctx.on('requestfinished', r => conta(r, -1));
    ctx.on('requestfailed', r => conta(r, -1));
    return ctx;
}

// Al posto di un'attesa fissa: si aspetta finché la pagina chiede dati o cambia, e ci si ferma dopo un attimo
// di calma, ma mai oltre il massimo, che è l'attesa fissa di prima. Basta la pagina o un suo locator.
const CALMA_MS = 350;
const pausa = (ms) => new Promise(r => setTimeout(r, ms));
export async function assesta(dove, massimo = 3000) {
    const p = typeof dove.page === 'function' ? dove.page() : dove;
    const fine = Date.now() + massimo;
    let ultime = null, calmaDal = Date.now();
    while (Date.now() < fine) {
        await pausa(100);
        // Il contatore dei cambiamenti vive nella pagina: dopo una navigazione riparte da capo.
        const cambiamenti = await p.evaluate(() => {
            if (window.cambiamentiProva === undefined) {
                window.cambiamentiProva = 0;
                new MutationObserver(() => { window.cambiamentiProva++; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
            }
            return window.cambiamentiProva;
        }).catch(() => null);
        if (cambiamenti === null || cambiamenti !== ultime || (aperte.get(p) || 0) > 0) { ultime = cambiamenti; calmaDal = Date.now(); continue; }
        if (Date.now() - calmaDal >= CALMA_MS) return;
    }
}

// L'accesso nel browser: si rimettono i cookie della sessione salvata, se il server li accetta ancora,
// altrimenti si entra con password e verifica e si salvano.
export async function accediNelContesto(ctx, username, password) {
    const chiama = async (p, { method, body }) => { const r = await ctx.request.fetch(BASE + p, { method, data: body }); return { stato: r.status(), corpo: await r.json().catch(() => null) }; };
    const salvata = await sessioneValida(BASE, username, async (s) => {
        if (!s.cookie?.length) return false;
        await ctx.addCookies(s.cookie);
        const r = await ctx.request.fetch(BASE + '/api/users/me');
        if (r.status() === 200 && !(await r.json().catch(() => ({}))).sessione_terminata) return true;
        await ctx.clearCookies();
        return false;
    });
    if (salvata) return salvata.corpo;
    const r = await accediConVerifica(chiama, BASE, username, password);
    if (r.stato !== 200) throw new Error(`accesso di ${username}: ${r.stato} ${JSON.stringify(r.corpo)}`);
    await prendiVisione(BASE, r.corpo.token);
    salvaSessione(BASE, username, { corpo: r.corpo, cookie: await ctx.cookies() });
    return r.corpo;
}

export async function entra(ctx, username, password) {
    const dati = await accediNelContesto(ctx, username, password);
    const p = await ctx.newPage();
    p.errori = [];
    p.on('pageerror', e => p.errori.push(e.message));
    await p.goto(BASE + '/centro-operativo.html');
    await p.evaluate((d) => { localStorage.setItem('userId', String(d.userId)); localStorage.setItem('username', d.username); }, dati);
    return { pagina: p, token: dati.token, dati };
}

export async function api(token, percorso, { method = 'GET', body } = {}) {
    const r = await fetch(BASE + percorso, { method, body: body ? JSON.stringify(body) : undefined, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` } });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
}
