// Aiuti comuni ai giri con i clic di tests/clic-aree.mjs: browser, contesti, accesso, chiamate alle API.
import 'dotenv/config';
import os from 'os';
import { chromium } from 'playwright';
import { accediConVerifica, prendiVisione } from '../accesso-prova.mjs';

export const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
export const CARTELLA_FOTO = process.env.ORION_FOTO || os.tmpdir();

export async function browser() {
    return chromium.launch({ executablePath: process.env.ORION_CHROMIUM || undefined });
}

export async function contesto(b, { larghezza = 1366, altezza = 800 } = {}) {
    return b.newContext({ viewport: { width: larghezza, height: altezza }, acceptDownloads: true });
}

export async function entra(ctx, username, password) {
    const chiama = async (p, { method, body }) => { const r = await ctx.request.fetch(BASE + p, { method, data: body }); return { stato: r.status(), corpo: await r.json().catch(() => null) }; };
    const r = await accediConVerifica(chiama, BASE, username, password);
    if (r.stato !== 200) throw new Error(`accesso di ${username}: ${r.stato} ${JSON.stringify(r.corpo)}`);
    await prendiVisione(BASE, r.corpo.token);
    const p = await ctx.newPage();
    p.errori = [];
    p.on('pageerror', e => p.errori.push(e.message));
    await p.goto(BASE + '/centro-operativo.html');
    await p.evaluate((d) => { localStorage.setItem('userId', String(d.userId)); localStorage.setItem('username', d.username); }, r.corpo);
    return { pagina: p, token: r.corpo.token, dati: r.corpo };
}

export async function api(token, percorso, { method = 'GET', body } = {}) {
    const r = await fetch(BASE + percorso, { method, body: body ? JSON.stringify(body) : undefined, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` } });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
}
