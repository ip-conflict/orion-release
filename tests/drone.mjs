// Il drone con un MediaMTX finto: chiavi per emergenza, chi può trasmettere e guardare, la diretta che passa
// da ORION senza mostrare la chiave, la registrazione raccolta, cifrata e legata all'emergenza.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... ORION_DRONE_SEGRETO=... ORION_DRONE_REGISTRAZIONI=... node tests/drone.mjs
// Il server va avviato con le stesse ORION_DRONE_* (API e WebRTC su http://127.0.0.1:3096), come fa batteria.mjs.
// Apre e chiude un'emergenza sua; crea ed elimina un volontario e un esterno temporaneo.

import fs from 'fs';
import path from 'path';
import { accediConFetch, prendiVisione, PASSWORD_PROVA } from './accesso-prova.mjs';
import { avviaMediaMtxFinto } from './mediamtx-finto.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const SEGRETO = process.env.ORION_DRONE_SEGRETO || '';
const REGISTRAZIONI = process.env.ORION_DRONE_REGISTRAZIONI || '';
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token, tipo = 'application/json', app = false } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        headers: { ...(body !== undefined ? { 'Content-Type': tipo } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(app ? { 'X-Orion-Client': 'app' } : {}) }
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
const squadreProva = [];
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
    const pw = PASSWORD_PROVA;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: pw } });
    const vol = (await chiama('/login', { method: 'POST', body: { username: n.username, password: pw } })).corpo.token;
    await prendiVisione(BASE, vol);
    const est = (await chiama('/api/esterni-temporanei', { method: 'POST', token: admin, body: { nome: `Ospite ${suffisso}`, qualifica: 'vvf' } })).corpo;
    if (est?.id) persone.push(est.id);
    const tokEst = (await chiama('/api/accesso-temporaneo', { method: 'POST', body: { codice: est.codice } })).corpo?.token;
    await prendiVisione(BASE, tokEst);

    const installazione = (await chiama('/api/sistema/drone', { token: admin })).corpo;
    verifica('con MediaMTX configurato la pagina non propone di installarlo', installazione?.configurato === true && installazione.installabile === false, installazione);
    verifica('e la richiesta all\'agente dice che c\'è già -> 409', (await chiama('/api/sistema/drone/installa', { method: 'POST', token: admin, body: { password: 'qualunque' } })).stato === 409);
    verifica('installare il drone è dell\'amministratore -> 403', (await chiama('/api/sistema/drone/installa', { method: 'POST', token: vol, body: { password: pw } })).stato === 403);
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
    verifica('un secondo collegamento con la chiave già in onda viene respinto', await finto.trasmetti(percorso) === 401 && finto.inOnda(percorso));
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { drone_max_dirette: '2' } });
    verifica('alzato il massimo, il secondo va in onda sulla stessa porta', await finto.trasmetti(`drone/${secondo.chiave}`) === 200);
    finto.smetti(`drone/${secondo.chiave}`);
    await chiama(`/api/drone/chiavi/${secondo.id}`, { method: 'DELETE', token: admin });

    const offerta = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
    const whep = await chiama(`/api/drone/dirette/${dirette.chiavi[0].id}/whep`, { method: 'POST', token: vol, body: offerta, tipo: 'application/sdp' });
    const richiestaWhep = finto.richieste.find(r => r.url === `/${percorso}/whep`);
    verifica('il volontario guarda: ORION gira la richiesta a MediaMTX e risponde con la sua sessione', whep.stato === 201 && whep.location?.startsWith('/api/drone/sessioni/') && String(whep.corpo).startsWith('v=0'), { stato: whep.stato, location: whep.location });
    verifica('verso MediaMTX va con le credenziali di ORION, il browser non le vede', richiestaWhep?.autorizzazione === `Basic ${Buffer.from(`orion:${SEGRETO}`).toString('base64')}`, richiestaWhep);

    // Dall'app: la sala e i caposquadra vedono ogni drone, gli altri solo quello della loro squadra.
    const idDrone = dirette.chiavi[0].id;
    const nuovaPersona = async (nome) => {
        const x = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome, cognome: `Drone${suffisso}`, role: 'volontario' } })).corpo;
        persone.push(x.id);
        const qx = new URL(x.magicLink).searchParams;
        await chiama('/api/auth/reset-password', { method: 'POST', body: { token: qx.get('token'), id: Number(qx.get('id')), newPassword: pw } });
        const t = (await chiama('/login', { method: 'POST', body: { username: x.username, password: pw } })).corpo.token;
        await prendiVisione(BASE, t);
        return { ...x, token: t };
    };
    const altro = await nuovaPersona('Bruno');
    const usati = new Set(((await chiama('/api/squadre', { token: admin })).corpo || []).map(s => s.nome_radio));
    const [radioA, radioB] = ['Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango'].filter(r => !usati.has(r));
    const squadraA = (await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: radioA, membri: [{ username: n.username }] } })).corpo?.squadraId;
    const squadraB = (await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: radioB, membri: [{ username: altro.username }] } })).corpo?.squadraId;
    squadreProva.push(squadraA, squadraB);
    const vedeInApp = async (token) => ((await chiama('/api/app/drone', { token, app: true })).corpo?.dirette || []).find(d => d.id === idDrone);
    verifica("senza pilota né squadra, dall'app il volontario non vede il drone", !(await vedeInApp(vol)));
    verifica('l\'app ha la capacità drone a emergenza aperta', ((await chiama('/api/app/contesto', { token: vol, app: true })).corpo?.capacita || []).includes('drone'));
    verifica('pilota e squadra li sceglie chi apre le emergenze -> 403', (await chiama(`/api/drone/chiavi/${idDrone}`, { method: 'PATCH', token: vol, body: { squadra_id: squadraA } })).stato === 403);
    verifica('un pilota che non c\'è -> 400', (await chiama(`/api/drone/chiavi/${idDrone}`, { method: 'PATCH', token: admin, body: { pilota_id: 99999999 } })).stato === 400);
    verifica('la sala lega il drone alla squadra A', (await chiama(`/api/drone/chiavi/${idDrone}`, { method: 'PATCH', token: admin, body: { squadra_id: squadraA } })).stato === 200);
    const visto = await vedeInApp(vol);
    verifica('chi è nella squadra A lo vede in onda, con la squadra', visto?.in_onda === true && visto.squadra?.nome_radio === radioA, visto);
    verifica("l'elenco dell'app non contiene la chiave", !JSON.stringify(visto || {}).includes(chiave));
    const playlist = await chiama(`/api/drone/dirette/${idDrone}/hls/index.m3u8`, { token: vol, app: true });
    const richiestaHls = finto.richieste.find(r => r.url === `/${percorso}/index.m3u8`);
    verifica('la playlist HLS passa da ORION', playlist.stato === 200 && String(playlist.corpo).startsWith('#EXTM3U') && !String(playlist.corpo).includes(chiave), { stato: playlist.stato });
    verifica('verso MediaMTX con le credenziali di ORION', richiestaHls?.autorizzazione === `Basic ${Buffer.from(`orion:${SEGRETO}`).toString('base64')}`, richiestaHls);
    const pezzo = await chiama(`/api/drone/dirette/${idDrone}/hls/prova_seg1.mp4?_HLS_msn=3&user=orion&pass=x&jwt=y`, { token: vol, app: true });
    verifica('anche i pezzi del video, con la loro domanda', pezzo.stato === 200 && pezzo.corpo.length === 4096 && finto.richieste.some(r => r.url === `/${percorso}/prova_seg1.mp4?_HLS_msn=3`));
    verifica('a MediaMTX non arrivano credenziali messe nella query', !finto.richieste.some(r => /user=|pass=|jwt=/.test(r.url)));
    verifica('un nome di file storto -> 400', (await chiama(`/api/drone/dirette/${idDrone}/hls/..%2F..%2Fv3%2Fpaths%2Flist`, { token: vol, app: true })).stato === 400);
    verifica("dall'app chi è in un'altra squadra non lo vede", !(await vedeInApp(altro.token)));
    verifica('e non ne apre il video -> 403', (await chiama(`/api/drone/dirette/${idDrone}/hls/index.m3u8`, { token: altro.token, app: true })).stato === 403);
    verifica('dal web resta come prima: ogni interno', (await chiama(`/api/drone/dirette/${idDrone}/hls/index.m3u8`, { token: altro.token })).stato === 200);
    await chiama(`/api/squadre/${squadraB}/caposquadra`, { method: 'PUT', token: admin, body: { username: altro.username } });
    verifica('il caposquadra di un\'altra squadra lo vede', !!(await vedeInApp(altro.token)));
    verifica('la sala lo vede sempre', !!(await vedeInApp(admin)));
    await chiama(`/api/drone/chiavi/${idDrone}`, { method: 'PATCH', token: admin, body: { pilota_id: altro.id, squadra_id: squadraA } });
    const colPilota = (await chiama('/api/drone/dirette', { token: admin })).corpo?.chiavi?.find(k => k.id === idDrone);
    verifica('con il pilota conta la squadra del pilota, non quella scelta', colPilota?.pilota?.id === altro.id && colPilota?.squadra?.nome_radio === radioB, colPilota);
    verifica('e la squadra A non lo vede più', !(await vedeInApp(vol)));
    verifica("l'esterno dall'app non ha droni", ((await chiama('/api/app/drone', { token: tokEst, app: true })).corpo?.dirette || []).length === 0);
    verifica("e non ne apre il video -> 403", (await chiama(`/api/drone/dirette/${idDrone}/hls/index.m3u8`, { token: tokEst, app: true })).stato === 403);
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
    const tratto = async (intervallo, token = vol, app = false) => {
        const r = await fetch(`${BASE}/api/drone/registrazioni/${riprese[0]?.id}/file`, { headers: { Authorization: `Bearer ${token}`, Range: intervallo, ...(app ? { 'X-Orion-Client': 'app' } : {}) } });
        return { stato: r.status, intervallo: r.headers.get('content-range'), corpo: Buffer.from(await r.arrayBuffer()) };
    };
    const pezzo10 = await tratto('bytes=10-19');
    verifica('un tratto della ripresa, per saltare avanti e indietro', pezzo10.stato === 206 && pezzo10.intervallo === `bytes 10-19/${contenuto.length}` && Buffer.compare(pezzo10.corpo, contenuto.subarray(10, 20)) === 0, { stato: pezzo10.stato, intervallo: pezzo10.intervallo });
    const coda = await tratto('bytes=-5');
    verifica('anche gli ultimi byte', coda.stato === 206 && Buffer.compare(coda.corpo, contenuto.subarray(contenuto.length - 5)) === 0, coda.stato);
    verifica('un tratto oltre la fine -> 416', (await tratto(`bytes=${contenuto.length + 10}-`)).stato === 416);
    const elencoSala = (await chiama('/api/drone/dirette', { token: admin })).corpo?.chiavi?.find(k => k.id === idDrone);
    verifica('la sala vede quanti pezzi ha il volo del drone', elencoSala?.registrazioni === 1, elencoSala);
    const pezziVolo = await chiama(`/api/drone/dirette/${idDrone}/registrazioni`, { token: vol });
    verifica('i pezzi del volo, in ordine, per rivederlo da subito', pezziVolo.stato === 200 && pezziVolo.corpo.length === 1 && pezziVolo.corpo[0].id === riprese[0]?.id, pezziVolo.corpo);
    verifica("dall'app chi non è della squadra del drone non lo rivede -> 403", (await chiama(`/api/drone/dirette/${idDrone}/registrazioni`, { token: vol, app: true })).stato === 403
        && (await tratto('bytes=0-9', vol, true)).stato === 403);
    verifica("il caposquadra sì, anche dall'app", (await chiama(`/api/drone/dirette/${idDrone}/registrazioni`, { token: altro.token, app: true })).stato === 200
        && (await tratto('bytes=0-9', altro.token, true)).stato === 206);
    verifica("l'esterno non rivede -> 403", (await chiama(`/api/drone/dirette/${idDrone}/registrazioni`, { token: tokEst })).stato === 403);
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
    verifica('nel registro: chiave data, in onda, raccolta, vista, chiave tolta', ['drone.chiave_creata', 'drone.in_onda', 'drone.registrazione_raccolta', 'drone.ripresa_vista', 'drone.chiave_revocata', 'drone.respinto', 'drone.chiave_modificata', 'drone.doppione_respinto'].every(a => registro.includes(a)));
} finally {
    if (aperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { drone_enabled: prima === 'true' ? 'true' : 'false', drone_max_dirette: '' } });
    for (const s of squadreProva) if (s) await chiama(`/api/squadre/${s}`, { method: 'DELETE', token: admin });
    for (const p of persone) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    await finto.chiudi();
}

console.log(falliti === 0 ? '\nDrone: tutto a posto\n' : `\nDrone: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
