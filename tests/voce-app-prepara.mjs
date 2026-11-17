// Prepara due volontari in una squadra, con la voce accesa, per la prova dell'app contro un server vero
// (VoceServerVeroTest in orion-app). "pulisci" toglie tutto. Su un'istanza di collaudo con un'emergenza aperta:
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/voce-app-prepara.mjs > prova.json
//   ORION_URL=... ORION_ADMIN_PASSWORD=... node tests/voce-app-prepara.mjs pulisci < prova.json
import fs from 'fs';
import { accediConFetch, prendiVisione } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const chiama = async (percorso, { method = 'GET', body, token } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;

if (process.argv[2] === 'pulisci') {
    const prova = JSON.parse(fs.readFileSync(0, 'utf8'));
    await chiama(`/api/squadre/${prova.squadra}`, { method: 'DELETE', token: admin });
    for (const p of prova.persone) await chiama(`/api/users/${p.id}`, { method: 'DELETE', token: admin });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { voce_enabled: prova.voceDiPrima } });
    process.exit(0);
}

if (!(await chiama('/api/emergencies/status', { token: admin })).corpo?.active) { console.error('Serve un\'emergenza aperta.'); process.exit(2); }
const voceDiPrima = (await chiama('/api/branding/settings', { token: admin })).corpo?.voce_enabled ?? 'false';
await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { voce_enabled: 'true' } });
const suffisso = Date.now().toString().slice(-5);
const persone = [];
for (const nome of ['Dario', 'Elena']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome, cognome: `App${suffisso}`, role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = `Turno!${suffisso}Lampione1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const token = (await chiama('/login', { method: 'POST', body: { username: n.username, password } })).corpo.token;
    await prendiVisione(BASE, token);
    persone.push({ id: n.id, username: n.username, nome, token });
}
let squadra = null;
for (const n of ['Kilo', 'Lima', 'Mike', 'November', 'Juliett', 'India', 'Hotel', 'Golf', 'Foxtrot', 'Echo']) {
    const r = await chiama('/api/squadre', { method: 'POST', token: admin, body: {
        nome_radio: n, nome: 'Prova app', caposquadra: persone[0].username, membri: persone.map(p => ({ username: p.username }))
    } });
    if (r.stato === 201) { squadra = r.corpo.squadraId; break; }
}
if (!squadra) { console.error('Nessun nome radio libero.'); process.exit(2); }
console.log(JSON.stringify({ url: BASE, squadra, voceDiPrima, persone }));
