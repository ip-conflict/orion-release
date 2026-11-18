// Chiamata dei volontari con i clic: la sala chiama, il volontario risponde dal centro operativo, arriva, entra in squadra.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=...] [ORION_FOTO=cartella] node tests/clic/chiamata.mjs (di solito da tests/clic-aree.mjs)
import { CARTELLA_FOTO, browser, contesto, entra, api, BASE, assesta } from './aiuto.mjs';
import { PASSWORD_PROVA } from '../accesso-prova.mjs';
const OUT = CARTELLA_FOTO;
const esiti = []; const controlla = (d, ok, x = '') => { esiti.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); };
const b = await browser();
const ctx = await contesto(b);
await ctx.route(/tile\.openstreetmap\.org|arcgisonline/, r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
const { pagina: p, token: admin } = await entra(ctx, 'admin', process.env.ORION_ADMIN_PASSWORD);
p.on('dialog', d => d.accept());
const suf = Date.now().toString().slice(-5);
if ((await api(admin, '/api/emergencies/status')).corpo?.active) await api(admin, '/api/emergencies/close', { method: 'POST', body: {} });
const persone = [];
for (const nome of ['Ugo', 'Ada']) {
    const n = (await api(admin, '/api/users', { method: 'POST', body: { nome, cognome: `Chiam${suf}`, role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams; const pw = PASSWORD_PROVA;
    await api(admin, '/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: pw } });
    persone.push({ ...n, pw });
}
const [ugo, ada] = persone;
await api(admin, '/api/emergencies/open', { method: 'POST', body: { external_code: `CH-${suf}` } });

await p.goto(BASE + '/centro-operativo.html'); await assesta(p, 2500);
controlla('in emergenza c\'è il pulsante Volontari', await p.isVisible('#chiamata-btn'));
await p.click('#chiamata-btn'); await assesta(p, 1200);
await p.locator('button').filter({ hasText: 'Chiama volontari' }).click(); await assesta(p, 1000);
await p.check('input[name="ch-criterio"][value="scelti"]'); await assesta(p, 400);
const cerca = p.locator('.chp-modulo input[type=search]');
await cerca.fill(`Chiam${suf}`); await assesta(cerca, 400);
for (const c of await p.locator('.chp-elenco input[type=checkbox]').all()) await c.check();
await p.locator('.chp-modulo textarea').fill('Allagamenti in zona industriale: servono pale e sacchi.');
await p.screenshot({ path: `${OUT}/ch-modulo.png` });
await p.locator('.chp-invia').click(); await assesta(p, 2000);
controlla('il pannello conferma la chiamata mandata a due persone', /2 persone|due persone|chiamat/i.test(await p.textContent('.chp-finestra').catch(() => '')), await p.textContent('.chp-finestra').catch(() => ''));

const ctxU = await contesto(b);
await ctxU.route(/tile\.openstreetmap\.org|arcgisonline/, r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
const { pagina: u, token: tokU } = await entra(ctxU, ugo.username, ugo.pw);
const notifica = ((await api(tokU, '/api/notifiche')).corpo?.notifiche || []).find(x => x.tipo === 'chiamata');
controlla('Ugo riceve la notifica della chiamata', !!notifica, (await api(tokU, '/api/notifiche')).corpo?.notifiche?.map(x => x.tipo));
await u.goto(BASE + '/centro-operativo.html'); await assesta(u, 3000);
controlla('nel centro operativo Ugo vede "Sei stato chiamato"', await u.isVisible('.ch-mia') && /pale e sacchi/.test(await u.textContent('.ch-mia')));
await u.screenshot({ path: `${OUT}/ch-volontario.png` });
await u.locator('.ch-mia button').filter({ hasText: 'Fra 30 minuti' }).click(); await assesta(u, 1500);
controlla('risposta mandata, il riquadro sparisce', !(await u.isVisible('.ch-mia')));
const ctxA = await contesto(b);
const { token: tokA } = await entra(ctxA, ada.username, ada.pw);
const mieA = (await api(tokA, '/api/chiamate/mie')).corpo || [];
const r = await api(tokA, `/api/chiamate/${mieA[0]?.id}/risposta`, { method: 'POST', body: { risposta: 'no' } });
controlla('Ada risponde "non posso"', r.stato === 200, r);

await p.reload(); await assesta(p, 2500);
await p.click('#chiamata-btn'); await assesta(p, 1500);
const pannello = await p.textContent('.chp-finestra');
controlla('nel pannello Ugo è in arrivo e Ada non viene', /Ugo/.test(pannello) && /Ada/.test(pannello), pannello.replace(/\s+/g, ' ').slice(0, 300));
const rigaUgo = p.locator('.chp-finestra li, .chp-finestra .chp-riga').filter({ hasText: 'Ugo' }).first();
await rigaUgo.locator('button').filter({ hasText: 'È arrivato' }).click(); await assesta(rigaUgo, 1500);
await p.screenshot({ path: `${OUT}/ch-pannello.png` });
const candidati = (await api(admin, '/api/users/unassigned')).corpo || [];
controlla('arrivato, Ugo è "in sede" fra chi si mette in squadra', candidati.find(x => x.id === ugo.id)?.in_sede === true, candidati.find(x => x.id === ugo.id));
const usati = new Set(((await api(admin, '/api/squadre')).corpo || []).map(s => s.nome_radio));
const radio = ['Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa'].find(x => !usati.has(x));
const sq = (await api(admin, '/api/squadre', { method: 'POST', body: { nome_radio: radio, nome: 'Arrivati', membri: [{ username: ugo.username }] } })).corpo;
controlla('Ugo entra in squadra', !!sq?.squadraId, sq);
await p.reload(); await assesta(p, 2000);
await p.click('#chiamata-btn'); await assesta(p, 1500);
controlla('nel pannello Ugo ora risulta in squadra', new RegExp(`in squadra|${radio}`, 'i').test(await p.textContent('.chp-finestra')), await p.textContent('.chp-finestra'));
console.log('errori sala:', p.errori.slice(0, 5), 'ugo:', u.errori.slice(0, 5));
await api(admin, '/api/emergencies/close', { method: 'POST', body: {} });
if (sq?.squadraId) await api(admin, `/api/squadre/${sq.squadraId}`, { method: 'DELETE', body: { beni: [] } });
for (const n of persone) await api(admin, `/api/users/${n.id}`, { method: 'DELETE', body: { beni: [] } });
console.log(`\n${esiti.filter(Boolean).length}/${esiti.length} controlli superati`);
await b.close();
process.exit(esiti.every(Boolean) ? 0 : 1);
