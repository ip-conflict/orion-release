// Segreteria con i clic: fascicolo, visita e corso, registrazione multipla, blocco in squadra senza visita.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=...] [ORION_FOTO=cartella] node tests/clic/segreteria.mjs (di solito da tests/clic-aree.mjs)
import { CARTELLA_FOTO, browser, contesto, entra, api, BASE, assesta } from './aiuto.mjs';
const OUT = CARTELLA_FOTO;
const esiti = []; const controlla = (d, ok, x = '') => { esiti.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${d}${ok ? '' : ` -> ${typeof x === 'string' ? x : JSON.stringify(x)}`}`); };
const b = await browser();
const ctx = await contesto(b);
const { pagina: p, token: admin } = await entra(ctx, 'admin', process.env.ORION_ADMIN_PASSWORD);
p.on('dialog', d => d.accept());
const suf = Date.now().toString().slice(-5);
const prima = (await api(admin, '/api/branding/settings')).corpo?.segreteria_config;
await api(admin, '/api/branding/settings', { method: 'PUT', body: { segreteria_config: JSON.stringify({ enabled: true, block_on_medical: true, block_on_course: false }) } });
const persone = [];
for (const nome of ['Gino', 'Lia']) {
    const n = (await api(admin, '/api/users', { method: 'POST', body: { nome, cognome: `Segr${suf}`, role: 'volontario' } })).corpo;
    persone.push(n);
}
const [gino, lia] = persone;
const oggi = new Date().toISOString().slice(0, 10);

await p.goto(BASE + '/admin-segreteria.html'); await assesta(p, 2500);
controlla('a modulo acceso niente avviso di modulo spento', !(await p.isVisible('#segreteria-spenta')));
await p.fill('#search-volunteer', `Segr${suf}`); await p.press('#search-volunteer', 'Enter'); await assesta(p, 600);
const righe = p.locator('#segreteria-users-table tr:visible');
controlla('la ricerca trova i due volontari', await righe.count() === 2, await righe.count());

const usati = new Set(((await api(admin, '/api/squadre')).corpo || []).map(s => s.nome_radio));
const radio = ['Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa'].find(r => !usati.has(r));
const bloccata = await api(admin, '/api/squadre', { method: 'POST', body: { nome_radio: radio, nome: 'Prova blocco', membri: [{ username: gino.username }] } });
controlla('senza visita valida non entra in squadra (blocco acceso)', bloccata.stato === 400 && /visita|idone/i.test(JSON.stringify(bloccata.corpo)), bloccata);

await righe.filter({ hasText: 'Gino' }).first().click(); await assesta(righe, 1500);
controlla('si apre il fascicolo', await p.isVisible('#user-detail-view') && /Gino/.test(await p.textContent('#detail-user-name')));
await p.click('#btn-add-medical'); await assesta(p, 800);
const tipi = await p.locator('#visit_type_id option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
controlla('ci sono tipi di visita nel catalogo', tipi.length > 0, tipi);
await p.selectOption('#visit_type_id', tipi[0]);
await p.fill('#last_visit_date', oggi); await p.dispatchEvent('#last_visit_date', 'change'); await assesta(p, 300);
const scadenza = await p.inputValue('#expiry_date');
controlla('la scadenza si calcola da sola dalla data', scadenza > oggi, scadenza);
await p.selectOption('#medical_status', 'Idoneo');
await p.screenshot({ path: `${OUT}/sg-visita.png` });
await p.click('#medical-submit-btn'); await assesta(p, 2000);
const visite = await p.textContent('#detail-medical-list');
controlla('la visita compare nel fascicolo', /Idoneo/i.test(visite), visite.replace(/\s+/g, ' ').slice(0, 200));
await p.keyboard.press('Escape');
const ora = await api(admin, '/api/squadre', { method: 'POST', body: { nome_radio: radio, nome: 'Prova blocco', membri: [{ username: gino.username }] } });
controlla('con la visita valida entra in squadra', ora.stato === 201 || ora.stato === 200, ora);
if (ora.corpo?.squadraId) await api(admin, `/api/squadre/${ora.corpo.squadraId}`, { method: 'DELETE', body: { beni: [] } });

await p.goto(BASE + '/admin-segreteria.html'); await assesta(p, 2500);
await p.fill('#search-volunteer', `Segr${suf}`); await p.press('#search-volunteer', 'Enter'); await assesta(p, 600);
await p.locator('#segreteria-users-table tr:visible').filter({ hasText: 'Lia' }).first().click(); await assesta(p, 1500);
await p.click('#btn-add-course'); await assesta(p, 800);
const corsi = await p.locator('#course_id option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
if (corsi.length) {
    await p.selectOption('#course_id', corsi[0]);
    await p.fill('#acquisition_date', oggi); await p.dispatchEvent('#acquisition_date', 'change'); await assesta(p, 300);
    await p.locator('#course-form button[type=submit]').click(); await assesta(p, 2000);
    controlla('il corso compare nel fascicolo', (await p.textContent('#detail-courses-list')).trim().length > 0 && !/Nessun/i.test(await p.textContent('#detail-courses-list')), await p.textContent('#detail-courses-list'));
} else controlla('ci sono corsi nel catalogo', false);
await p.keyboard.press('Escape');

await p.goto(BASE + '/admin-segreteria.html'); await assesta(p, 2500);
await p.fill('#search-volunteer', `Segr${suf}`); await p.press('#search-volunteer', 'Enter'); await assesta(p, 600);
for (const c of await p.locator('#segreteria-users-table tr:visible .scelta-volontario').all()) await c.check();
controlla('scelti due, compaiono le azioni multiple', await p.isVisible('#azioni-multiple') && /2/.test(await p.textContent('#quanti-scelti')), await p.textContent('#quanti-scelti').catch(() => ''));
await p.click('#btn-visita-multipla'); await assesta(p, 800);
const voci = await p.locator('#multipla-voce option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
await p.selectOption('#multipla-voce', voci[0]);
await p.fill('#multipla-data', oggi); await p.dispatchEvent('#multipla-data', 'change'); await assesta(p, 300);
await p.screenshot({ path: `${OUT}/sg-multipla.png` });
await p.click('#salva-multipla'); await assesta(p, 2000);
const lib = (await api(admin, `/api/users/${lia.id}/libretto`)).corpo;
controlla('la visita multipla arriva anche a Lia', JSON.stringify(lib).match(/Idoneo/gi)?.length >= 1, JSON.stringify(lib).slice(0, 200));

console.log('errori:', p.errori.slice(0, 6));
for (const n of persone) await api(admin, `/api/users/${n.id}`, { method: 'DELETE', body: { beni: [] } });
await api(admin, '/api/branding/settings', { method: 'PUT', body: { segreteria_config: typeof prima === 'string' ? prima : JSON.stringify(prima || { enabled: false }) } });
console.log(`\n${esiti.filter(Boolean).length}/${esiti.length} controlli superati`);
await b.close();
process.exit(esiti.every(Boolean) ? 0 : 1);
