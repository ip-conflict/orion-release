// tests/caposquadra.mjs
//
// Il caposquadra: si nomina componendo la squadra o con un clic dal centro
// operativo, uno solo per squadra, e il suo telefono si vede al centro
// operativo con la segreteria accesa. Con più telefoni nella stessa squadra
// la posizione la manda il caposquadra; senza di lui chi la sta già
// mandando, e un altro subentra solo quando quello tace.
//
// Crea ed elimina tre utenti e una squadra, e invecchia a mano le posizioni
// nel database: va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/caposquadra.mjs

import 'dotenv/config';
import pg from 'pg';
import { accediConFetch, prendiVisione } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};

console.log('\nCaposquadra');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const segreteria = (await chiama('/api/branding/settings')).corpo?.segreteria_config;
const segreteriaAccesa = (typeof segreteria === 'string' ? JSON.parse(segreteria) : segreteria)?.enabled === true;

// Tre persone con la password, una con il telefono.
const suffisso = Date.now().toString().slice(-5);
const persone = [];
for (const nome of ['Anna', 'Bruno', 'Carla']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome, cognome: `Capo${suffisso}`, role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = `Squadra!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const token = (await chiama('/login', { method: 'POST', body: { username: n.username, password } })).corpo.token;
    await prendiVisione(BASE, token);
    persone.push({ id: n.id, username: n.username, nome, token });
}
const [anna, bruno, carla] = persone;
await pool.query("UPDATE users SET telefono = '333 1234567' WHERE id = $1", [bruno.id]);
// Un nome radio libero.
const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
const nomeRadio = ['Zulu', 'Yankee', 'X-Ray', 'Whiskey', 'Victor', 'Uniform', 'Tango'].find(n => !usati.has(n));
let squadraId = null;

const squadra = async () => ((await chiama('/api/squadre', { token: admin })).corpo || []).find(s => s.id === squadraId);
const posizione = (chi) => chiama('/api/location', { method: 'POST', token: chi.token, body: { squadra_id: squadraId, latitude: 46.1, longitude: 12.2 } });
const invecchia = () => pool.query("UPDATE posizioni_squadre SET last_update = NOW() - INTERVAL '4 minutes' WHERE squadra_id = $1", [squadraId]);

try {
    // 1. Nominato componendo la squadra.
    let r = await chiama('/api/squadre', { method: 'POST', token: admin, body: {
        nome_radio: nomeRadio, nome: 'Prova caposquadra', caposquadra: anna.username,
        membri: persone.map(p => ({ username: p.username }))
    } });
    squadraId = r.corpo?.squadraId;
    verifica('la squadra si crea con il caposquadra', r.stato === 201, r);
    let s = await squadra();
    verifica('il caposquadra è segnato, e in testa ai membri', s?.caposquadra?.username === anna.username && s.membri[0].username === anna.username && s.membri[0].caposquadra === true, s);

    // 2. Il clic dal centro operativo.
    r = await chiama(`/api/squadre/${squadraId}/caposquadra`, { method: 'PUT', token: admin, body: { username: bruno.username } });
    verifica('si cambia con un clic', r.stato === 200 && r.corpo?.caposquadra?.username === bruno.username, r);
    s = await squadra();
    verifica('ce n\'è uno solo', s.membri.filter(m => m.caposquadra).length === 1 && s.caposquadra.username === bruno.username, s.membri);
    verifica(segreteriaAccesa ? 'con la segreteria accesa il centro operativo vede il suo telefono' : 'senza segreteria il telefono non si vede',
        segreteriaAccesa ? s.caposquadra.telefono === '333 1234567' : s.caposquadra.telefono == null, s.caposquadra);
    const conTelefono = s.membri.find(m => m.username === bruno.username);
    verifica(segreteriaAccesa ? 'fra i membri c\'è il telefono di ognuno, per chiamare un altro se il caposquadra non risponde' : 'senza segreteria i membri non hanno il telefono',
        segreteriaAccesa ? conTelefono?.telefono === '333 1234567' && s.membri.find(m => m.username === anna.username)?.telefono == null
            : s.membri.every(m => m.telefono == null), s.membri);
    r = await chiama(`/api/squadre/${squadraId}/caposquadra`, { method: 'PUT', token: admin, body: { username: 'non-esiste' } });
    verifica('chi non è nella squadra non può esserlo', r.stato === 400, r);
    r = await chiama(`/api/squadre/${squadraId}/caposquadra`, { method: 'PUT', token: carla.token, body: { username: carla.username } });
    verifica('un volontario può nominarlo (gestisce le squadre come prima)', r.stato === 200, r);
    await chiama(`/api/squadre/${squadraId}/caposquadra`, { method: 'PUT', token: admin, body: { username: bruno.username } });
    const notifica = (await chiama('/api/notifiche', { token: bruno.token })).corpo?.notifiche?.find(n => n.tipo === 'caposquadra');
    verifica('il caposquadra lo sa dalla notifica', !!notifica && notifica.titolo.includes(nomeRadio), notifica);
    const contesto = (await chiama('/api/app/contesto', { token: bruno.token })).corpo?.squadra;
    verifica("l'app sa chi è il caposquadra", contesto?.sono_caposquadra === true && contesto?.caposquadra?.username === bruno.username, contesto);

    // 3. Modificare la squadra senza dire niente del caposquadra lo lascia com'è.
    r = await chiama(`/api/squadre/${squadraId}`, { method: 'PUT', token: admin, body: { nome_radio: nomeRadio, nome: 'Prova', membri: persone.map(p => ({ username: p.username })) } });
    s = await squadra();
    verifica('salvare la squadra senza "caposquadra" non lo toglie', r.stato === 200 && s.caposquadra?.username === bruno.username, s.caposquadra);

    // 4. La posizione: la manda il caposquadra.
    await pool.query('DELETE FROM posizioni_squadre WHERE squadra_id = $1', [squadraId]);
    r = await posizione(anna);
    verifica('senza posizioni la prima arriva da chiunque', r.corpo?.accettata === true, r.corpo);
    r = await posizione(bruno);
    verifica('il caposquadra la prende subito', r.corpo?.accettata === true && r.corpo?.caposquadra === true, r.corpo);
    r = await posizione(anna);
    verifica('poi gli altri telefoni vengono ignorati, e sanno chi la manda', r.stato === 200 && r.corpo?.accettata === false && r.corpo?.inviata_da?.caposquadra === true, r.corpo);
    r = await posizione(carla);
    verifica('tutti gli altri', r.corpo?.accettata === false, r.corpo);

    // 5. Il caposquadra tace: subentra un altro, e solo uno.
    await invecchia();
    r = await posizione(carla);
    verifica('dopo qualche minuto di silenzio del caposquadra subentra un altro', r.corpo?.accettata === true, r.corpo);
    r = await posizione(anna);
    verifica('e la squadra non salta fra due telefoni', r.corpo?.accettata === false, r.corpo);
    r = await posizione(bruno);
    verifica('quando il caposquadra torna, la riprende lui', r.corpo?.accettata === true, r.corpo);
    const loc = ((await chiama('/api/location', { token: admin })).corpo || []).find(p => p.squadra_id === squadraId);
    verifica('il centro operativo sa da quale telefono arriva', loc?.inviata_da?.username === bruno.username && loc.inviata_da.caposquadra === true, loc);

    // 6. Senza caposquadra: chi la manda la tiene finché non tace.
    await chiama(`/api/squadre/${squadraId}/caposquadra`, { method: 'PUT', token: admin, body: { username: null } });
    s = await squadra();
    verifica('il caposquadra si toglie', s.caposquadra == null && !s.membri.some(m => m.caposquadra), s);
    r = await posizione(anna);
    verifica('senza caposquadra chi la sta mandando la tiene', r.corpo?.accettata === false, r.corpo);
    await invecchia();
    r = await posizione(anna);
    verifica('finché non tace', r.corpo?.accettata === true, r.corpo);

    // 7. Nel registro dell'emergenza e nel resoconto: il caposquadra che la
    // squadra aveva all'apertura, e le nomine durante.
    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (stato?.emergency || stato?.active) {
        console.log("  --   un'emergenza è già aperta: controllo del registro saltato");
    } else {
        await chiama(`/api/squadre/${squadraId}/caposquadra`, { method: 'PUT', token: admin, body: { username: anna.username } });
        const aperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `CAPO-${suffisso}`, name: 'Prova caposquadra' } })).corpo?.emergency;
        await chiama(`/api/squadre/${squadraId}/caposquadra`, { method: 'PUT', token: admin, body: { username: carla.username } });
        const registro = (await pool.query(
            `SELECT username, azione, motivo FROM emergency_team_log WHERE emergency_id = $1 AND squadra_id = $2 AND azione LIKE 'caposquadra%' ORDER BY id`,
            [aperta.id, squadraId])).rows;
        verifica("il registro dell'emergenza ha il caposquadra dell'apertura, la revoca e la nomina nuova",
            JSON.stringify(registro) === JSON.stringify([
                { username: anna.username, azione: 'caposquadra_nominato', motivo: 'apertura_emergenza' },
                { username: anna.username, azione: 'caposquadra_tolto', motivo: 'operazione' },
                { username: carla.username, azione: 'caposquadra_nominato', motivo: 'operazione' }
            ]), registro);
        await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
        const r2 = await fetch(`${BASE}/api/admin/emergencies/${aperta.id}/resoconto`, { headers: { Authorization: `Bearer ${admin}` } });
        const testo = await r2.text();
        verifica('il resoconto dice chi è stato caposquadra', testo.includes(`Carla Capo${suffisso} caposquadra di ${nomeRadio}`) && testo.includes(`Anna Capo${suffisso} non è più caposquadra`), testo.split('\n').filter(l => l.includes('caposquadra')).join(' | '));
        // La chiusura toglie i membri dalle squadre: si rimettono per l'ultima prova.
        await chiama(`/api/squadre/${squadraId}`, { method: 'PUT', token: admin, body: { nome_radio: nomeRadio, nome: 'Prova', membri: persone.map(p => ({ username: p.username })) } });
        await pool.query("UPDATE posizioni_squadre SET inviata_da = $2, last_update = NOW() WHERE squadra_id = $1", [squadraId, anna.username]);
    }

    // 8. Chi la manda esce dalla squadra: gli altri subentrano subito.
    await chiama(`/api/squadre/${squadraId}`, { method: 'PUT', token: admin, body: { nome_radio: nomeRadio, nome: 'Prova', membri: [bruno, carla].map(p => ({ username: p.username })) } });
    r = await posizione(carla);
    verifica('se chi la mandava esce dalla squadra, un altro subentra subito', r.corpo?.accettata === true, r.corpo);
    r = await posizione(anna);
    verifica('e chi è uscito non la manda più', r.stato === 403, r.stato);
} finally {
    if (squadraId) await chiama(`/api/squadre/${squadraId}`, { method: 'DELETE', token: admin });
    for (const p of persone) await chiama(`/api/users/${p.id}`, { method: 'DELETE', token: admin });
    await pool.end();
}

console.log(`\nCaposquadra: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
