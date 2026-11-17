// Il drone con un MediaMTX finto: chiavi per emergenza, chi può trasmettere e guardare, la diretta che passa
// da ORION senza mostrare la chiave, la registrazione raccolta, cifrata e legata all'emergenza.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... ORION_DRONE_SEGRETO=... ORION_DRONE_REGISTRAZIONI=... node tests/drone.mjs
// Il server va avviato con le stesse ORION_DRONE_* (API e WebRTC su http://127.0.0.1:3096), come fa batteria.mjs.
// Apre e chiude un'emergenza sua; crea ed elimina un volontario e un esterno temporaneo.

import fs from 'fs';
import path from 'path';
import { accediConFetch, prendiVisione } from './accesso-prova.mjs';
import { avviaMediaMtxFinto } from './mediamtx-finto.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const SEGRETO = process.env.ORION_DRONE_SEGRETO || '';
const REGISTRAZIONI = process.env.ORION_DRONE_REGISTRAZIONI || '';
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token, tipo = 'application/json' } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        headers: { ...(body !== undefined ? { 'Content-Type': tipo } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    const ct = r.headers.get('content-type') || '';
    const corpo = ct.includes('json') ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer());
    return { stato: r.status, corpo, location: r.headers.get('location') };
};
const attendi = (ms) => new Promise(r => setTimeout(r, ms));

console.log('\nDrone');
if (SEGRETO.length < 16 || !REGISTRAZIONI) {
    console.log('  FAIL servono ORION_DRONE_SEGRETO (almeno 16 caratteri) e ORION_DRONE_REGISTRAZIONI, gli stessi del server');
    process.exit(1);
}
const finto = await avviaMediaMtxFinto({ orion: BASE, segreto: SEGRETO });
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const persone = [];
let aperta = null;
const prima = (await chiama('/api/branding/settings', { token: admin })).corpo?.drone_enabled;
try {
    if ((await chiama('/api/emergencies/status', { token: admin })).corpo?.active) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { drone_enabled: 'false' } });
    const spento = await chiama('/api/drone/stato', { token: admin });
    verifica('a modulo spento il drone non c\'è, ma il server dice che è configurato', spento.corpo?.configurato === true && spento.corpo?.attivo === false, spento.corpo);
    verifica('a modulo spento le dirette rispondono 404', (await chiama('/api/drone/dirette', { token: admin })).stato === 404);
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { drone_enabled: 'true' } });
    verifica('senza emergenza non si danno chiavi -> 409', (await chiama('/api/drone/chiavi', { method: 'POST', token: admin, body: { nome: 'Matrice 4E' } })).stato === 409);

    aperta = (await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `DRONE-${suffisso}` } })).corpo?.emergency?.id;
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Vale', cognome: `Drone${suffisso}`, role: 'volontario' } })).corpo;
    persone.push(n.id);
    const q = new URL(n.magicLink).searchParams;
    const pw = `Faro!${suffisso}Lanterna9`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: pw } });
    const vol = (await chiama('/login', { method: 'POST', body: { username: n.username, password: pw } })).corpo.token;
    await prendiVisione(BASE, vol);
    const est = (await chiama('/api/esterni-temporanei', { method: 'POST', token: admin, body: { nome: `Ospite ${suffisso}`, qualifica: 'vvf' } })).corpo;
    if (est?.id) persone.push(est.id);
    const tokEst = (await chiama('/api/accesso-temporaneo', { method: 'POST', body: { codice: est.codice } })).corpo?.token;
    await prendiVisione(BASE, tokEst);

    verifica('il volontario non dà chiavi -> 403', (await chiama('/api/drone/chiavi', { method: 'POST', token: vol, body: { nome: 'Il mio' } })).stato === 403);
    verifica('senza nome -> 400', (await chiama('/api/drone/chiavi', { method: 'POST', token: admin, body: { nome: '  ' } })).stato === 400);
    const nuova = await chiama('/api/drone/chiavi', { method: 'POST', token: admin, body: { nome: 'Matrice 4E – Marco' } });
    const chiave = nuova.corpo?.chiave;
    const percorso = `drone/${chiave}`;
    verifica('la chiave nuova dà l\'indirizzo RTMP completo, una volta', nuova.stato === 201 && nuova.corpo.indirizzo.endsWith(`/drone/${chiave}`) && nuova.corpo.indirizzo.startsWith('rtmp://') && chiave.length >= 24, nuova.corpo);
    let dirette = (await chiama('/api/drone/dirette', { token: vol })).corpo;
    const testo = JSON.stringify(dirette);
    verifica('l\'elenco delle dirette non contiene mai la chiave né la sua impronta', !testo.includes(chiave) && !testo.includes('impronta') && dirette.chiavi?.length === 1, dirette);
    verifica('l\'esterno non vede il drone -> 403', (await chiama('/api/drone/dirette', { token: tokEst })).stato === 403);

    verifica('una chiave inventata non trasmette', await finto.trasmetti(`drone/${'x'.repeat(32)}`) === 401);
    verifica('la chiave giusta in WebRTC non trasmette (solo RTMP o SRT)', await finto.trasmetti(percorso, { protocollo: 'webrtc' }) === 401);
    const sbagliato = await fetch(`${BASE}/api/drone/autorizza?s=sbagliato`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', path: percorso, protocol: 'rtmp' }) });
    verifica('MediaMTX con il segreto sbagliato -> 403', sbagliato.status === 403);
    verifica('il pilota con la chiave giusta va in onda', await finto.trasmetti(percorso) === 200 && finto.inOnda(percorso));
    dirette = (await chiama('/api/drone/dirette', { token: vol })).corpo;
    verifica('la sala lo vede in onda', dirette.chiavi?.[0]?.in_onda === true && !!dirette.chiavi[0].in_onda_da, dirette);

    verifica('i droni insieme vanno da 1 a 20 -> 400', (await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { drone_max_dirette: '0' } })).stato === 400);
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { drone_max_dirette: '1' } });
    const stato = (await chiama('/api/drone/stato', { token: admin })).corpo;
    verifica('lo stato dice le porte da aprire e il massimo', stato?.porte?.rtmp > 0 && stato?.porte?.webrtc > 0 && stato?.max_dirette === 1, stato);
    verifica('l\'esterno non vede le porte', !('porte' in ((await chiama('/api/drone/stato', { token: tokEst })).corpo || {})));
    const secondo = (await chiama('/api/drone/chiavi', { method: 'POST', token: admin, body: { nome: 'Mavic – Luca' } })).corpo;
    verifica('oltre il massimo il secondo drone viene respinto', await finto.trasmetti(`drone/${secondo.chiave}`) === 401);
    const respinto = (await chiama('/api/drone/dirette', { token: vol })).corpo?.respinto;
    verifica('la sala sa chi è stato respinto e perché', respinto?.nome === 'Mavic – Luca' && respinto?.massimo === 1, respinto);
    verifica('il drone già in onda che si ricollega non conta contro sé stesso', await finto.trasmetti(percorso) === 200);
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { drone_max_dirette: '2' } });
    verifica('alzato il massimo, il secondo va in onda sulla stessa porta', await finto.trasmetti(`drone/${secondo.chiave}`) === 200);
    finto.smetti(`drone/${secondo.chiave}`);
    await chiama(`/api/drone/chiavi/${secondo.id}`, { method: 'DELETE', token: admin });

    const offerta = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
    const whep = await chiama(`/api/drone/dirette/${dirette.chiavi[0].id}/whep`, { method: 'POST', token: vol, body: offerta, tipo: 'application/sdp' });
    const richiestaWhep = finto.richieste.find(r => r.url === `/${percorso}/whep`);
    verifica('il volontario guarda: ORION gira la richiesta a MediaMTX e risponde con la sua sessione', whep.stato === 201 && whep.location?.startsWith('/api/drone/sessioni/') && String(whep.corpo).startsWith('v=0'), { stato: whep.stato, location: whep.location });
    verifica('verso MediaMTX va con le credenziali di ORION, il browser non le vede', richiestaWhep?.autorizzazione === `Basic ${Buffer.from(`orion:${SEGRETO}`).toString('base64')}`, richiestaWhep);
    const lettura = await fetch(`${BASE}/api/drone/autorizza?s=${encodeURIComponent(SEGRETO)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', path: percorso, protocol: 'webrtc', user: 'curioso', password: 'x' }) });
    verifica('guardare direttamente da MediaMTX senza ORION -> 401', lettura.status === 401);
    verifica('un\'offerta che non è SDP -> 400', (await chiama(`/api/drone/dirette/${dirette.chiavi[0].id}/whep`, { method: 'POST', token: vol, body: 'ciao', tipo: 'application/sdp' })).stato === 400);
    verifica('l\'esterno non guarda -> 403', (await chiama(`/api/drone/dirette/${dirette.chiavi[0].id}/whep`, { method: 'POST', token: tokEst, body: offerta, tipo: 'application/sdp' })).stato === 403);
    verifica('la sessione di un altro non si chiude -> 404', (await chiama(whep.location, { method: 'DELETE', token: admin })).stato === 404);
    verifica('chi guarda chiude la sua sessione', (await chiama(whep.location, { method: 'DELETE', token: vol })).stato === 200 && finto.sessioni.size === 0);

    const dir = path.join(REGISTRAZIONI, 'drone', chiave);
    fs.mkdirSync(dir, { recursive: true });
    const contenuto = Buffer.concat([Buffer.from('....ftypisom'), Buffer.alloc(4096, 7)]);
    const file = path.join(dir, '2026-11-17_10-00-00-000000.mp4');
    fs.writeFileSync(file, contenuto);
    const vecchio = new Date(Date.now() - 60000);
    fs.utimesSync(file, vecchio, vecchio);
    const orfano = path.join(REGISTRAZIONI, 'drone', 'y'.repeat(32));
    fs.mkdirSync(orfano, { recursive: true });
    fs.writeFileSync(path.join(orfano, '2026-11-17_09-00-00-000000.mp4'), 'nessuno');
    fs.utimesSync(path.join(orfano, '2026-11-17_09-00-00-000000.mp4'), vecchio, vecchio);
    let riprese = [];
    for (let i = 0; i < 15 && !riprese.length; i++) { await attendi(1000); riprese = (await chiama(`/api/drone/registrazioni?emergenza=${aperta}`, { token: vol })).corpo || []; }
    verifica('la registrazione finita viene raccolta e legata all\'emergenza', riprese.length === 1 && riprese[0].nome_drone === 'Matrice 4E – Marco' && riprese[0].dimensione === contenuto.length, riprese);
    verifica('il file di MediaMTX non resta in chiaro sul disco', !fs.existsSync(file));
    verifica('una registrazione di una chiave sconosciuta non resta', !fs.existsSync(path.join(orfano, '2026-11-17_09-00-00-000000.mp4')));
    const video = await chiama(`/api/drone/registrazioni/${riprese[0]?.id}/file`, { token: vol });
    verifica('si riguarda com\'era, decifrata al volo', video.stato === 200 && Buffer.compare(video.corpo, contenuto) === 0, video.stato);
    verifica('l\'esterno non la riguarda -> 403', (await chiama(`/api/drone/registrazioni/${riprese[0]?.id}/file`, { token: tokEst })).stato === 403);

    verifica('togliere la chiave stacca il pilota', (await chiama(`/api/drone/chiavi/${dirette.chiavi[0].id}`, { method: 'DELETE', token: admin })).stato === 200 && !finto.inOnda(percorso));
    verifica('con la chiave tolta non si torna in onda', await finto.trasmetti(percorso) === 401);
    const seconda = (await chiama('/api/drone/chiavi', { method: 'POST', token: admin, body: { nome: 'Riserva' } })).corpo;
    await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    aperta = null;
    verifica('chiusa l\'emergenza, la sua chiave non vale più', await finto.trasmetti(`drone/${seconda.chiave}`) === 401);
    verifica('a emergenza chiusa il volontario non riguarda le riprese (archivio) -> 403', (await chiama(`/api/drone/registrazioni/${riprese[0]?.id}/file`, { token: vol })).stato === 403);
    verifica('chi consulta l\'archivio sì', (await chiama(`/api/drone/registrazioni/${riprese[0]?.id}/file`, { token: admin })).stato === 200);
    const registro = JSON.stringify((await chiama('/api/admin/audit-log?limit=50', { token: admin })).corpo || '');
    verifica('nel registro: chiave data, in onda, raccolta, vista, chiave tolta', ['drone.chiave_creata', 'drone.in_onda', 'drone.registrazione_raccolta', 'drone.ripresa_vista', 'drone.chiave_revocata', 'drone.respinto'].every(a => registro.includes(a)));
} finally {
    if (aperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { drone_enabled: prima === 'true' ? 'true' : 'false', drone_max_dirette: '' } });
    for (const p of persone) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    await finto.chiudi();
}

console.log(falliti === 0 ? '\nDrone: tutto a posto\n' : `\nDrone: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
