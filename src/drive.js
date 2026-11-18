// La copia dei backup su Google Drive, facoltativa: l'account dell'associazione si collega una volta
// con OAuth, poi ORION copia quello che è già cifrato e tiene in ordine la sua cartella.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import logger from './logger.js';
import { pool } from './db.js';
import { cifraTesto, cifraturaPronta, decifraTesto, fileCifrato, flussoCifrato } from './cifratura.js';
import { CARTELLA_BACKUP_APP, CARTELLA_BACKUP_CRON } from './backup.js';
import { istanza, leggiNomeBackup, orarioNome } from './nomiBackup.js';
import { RADICE_DATI } from './percorsi.js';

// Gli indirizzi di Google sono fissi; le prove li puntano a un Google finto.
const URL_CONSENSO = process.env.ORION_DRIVE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_TOKEN = process.env.ORION_DRIVE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const URL_REVOCA = process.env.ORION_DRIVE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';
const URL_DRIVE = (process.env.ORION_DRIVE_URL || 'https://www.googleapis.com').replace(/\/$/, '');
// Il permesso più stretto: ORION vede solo i file che ha creato lui, non il resto del Drive.
const PERMESSO = 'https://www.googleapis.com/auth/drive.file';
// Drive vuole pezzi multipli di 256 KB; otto mega tengono la memoria bassa e le riprese corte.
const PEZZO = 8 * 1024 * 1024;
const CHIAVE_CONFIG = 'drive_config';
const CHIAVE_STATO = 'drive_stato';
export const CHIAVI_DRIVE = [CHIAVE_CONFIG, CHIAVE_STATO];
const GIORNALIERI_DI_SERIE = 14;
const SETTIMANALI_DI_SERIE = 8;

class ErroreDrive extends Error {
    constructor(tipo, messaggio) {
        super(messaggio);
        this.tipo = tipo;
    }
}

async function leggi(chiave) {
    const r = await pool.query('SELECT setting_value FROM branding_settings WHERE setting_key = $1', [chiave]);
    try { return r.rows[0]?.setting_value ? JSON.parse(r.rows[0].setting_value) : {}; } catch { return {}; }
}
async function scrivi(chiave, valore) {
    await pool.query(
        `INSERT INTO branding_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
        [chiave, JSON.stringify(valore)]);
}
async function aggiorna(chiave, cambi) {
    const attuale = await leggi(chiave);
    const nuovo = { ...attuale, ...cambi };
    await scrivi(chiave, nuovo);
    return nuovo;
}

let accesso = null; // { token, scade }
async function tokenAccesso(config) {
    if (accesso && accesso.scade > Date.now() + 60000) return accesso.token;
    let r;
    try {
        r = await fetch(URL_TOKEN, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000),
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decifraTesto(config.token), client_id: config.client_id, client_secret: decifraTesto(config.segreto) })
        });
    } catch (e) {
        throw new ErroreDrive('rete', `Google non risponde: ${e.message}.`);
    }
    const dati = await r.json().catch(() => ({}));
    if (!r.ok) {
        if (dati.error === 'invalid_grant') throw new ErroreDrive('token', 'Google non accetta più il collegamento, scaduto o revocato: ricollega Google Drive dalla pagina Sistema.');
        throw new ErroreDrive('google', `Google ha risposto ${r.status} al rinnovo dell'accesso${dati.error ? ` (${dati.error})` : ''}.`);
    }
    accesso = { token: dati.access_token, scade: Date.now() + (Number(dati.expires_in) || 3600) * 1000 };
    return accesso.token;
}

async function chiamaDrive(token, metodo, percorso, { corpo, intestazioni = {} } = {}) {
    let r;
    try {
        r = await fetch(`${URL_DRIVE}${percorso}`, {
            method: metodo, signal: AbortSignal.timeout(60000), body: corpo === undefined ? undefined : JSON.stringify(corpo),
            headers: { Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json; charset=UTF-8' }), ...intestazioni }
        });
    } catch (e) {
        throw new ErroreDrive('rete', `Google Drive non risponde: ${e.message}.`);
    }
    if (r.status === 401) {
        accesso = null;
        throw new ErroreDrive('token', 'Google Drive non accetta più l\'accesso di ORION: ricollega Google Drive dalla pagina Sistema.');
    }
    if (r.status === 403) {
        const dati = await r.json().catch(() => ({}));
        const motivo = dati.error?.errors?.[0]?.reason || dati.error?.status;
        if (motivo === 'storageQuotaExceeded') throw new ErroreDrive('spazio', 'Lo spazio di Google Drive è finito: liberalo, o tieni meno copie.');
        throw new ErroreDrive('google', `Google Drive ha rifiutato la richiesta${motivo ? ` (${motivo})` : ''}.`);
    }
    return r;
}

async function nomeAssociazione() {
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'association_name'");
    return String(r.rows[0]?.setting_value || '').replace(/^"|"$/g, '').trim() || istanza();
}

// La cartella si ricrea se qualcuno l'ha cancellata o messa nel cestino.
async function cartella(token, config) {
    if (config.cartella_id) {
        const r = await chiamaDrive(token, 'GET', `/drive/v3/files/${encodeURIComponent(config.cartella_id)}?fields=id,trashed`);
        if (r.ok && !(await r.json()).trashed) return config.cartella_id;
        if (!r.ok && r.status !== 404) throw new ErroreDrive('google', `Google Drive ha risposto ${r.status} cercando la cartella.`);
    }
    const r = await chiamaDrive(token, 'POST', '/drive/v3/files?fields=id', {
        corpo: { name: `ORION ${await nomeAssociazione()}`, mimeType: 'application/vnd.google-apps.folder', appProperties: { orion: 'cartella' } }
    });
    if (!r.ok) throw new ErroreDrive('google', `Google Drive non ha creato la cartella (${r.status}).`);
    const { id } = await r.json();
    await aggiorna(CHIAVE_CONFIG, { cartella_id: id });
    return id;
}

async function apriCaricamento(token, metadati, dimensione) {
    const r = await chiamaDrive(token, 'POST', '/upload/drive/v3/files?uploadType=resumable&fields=id,size', {
        corpo: metadati,
        intestazioni: { 'X-Upload-Content-Type': 'application/octet-stream', ...(dimensione === null ? {} : { 'X-Upload-Content-Length': String(dimensione) }) }
    });
    const sessione = r.headers.get('location');
    if (!r.ok || !sessione) throw new ErroreDrive('google', `Google Drive non ha aperto il caricamento (${r.status}).`);
    return new URL(sessione, URL_DRIVE).toString();
}

const ricevutiDa = (range) => { const m = /bytes=0-(\d+)/.exec(range || ''); return m ? Number(m[1]) + 1 : 0; };
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

// Se la rete cade o Google risponde 5xx si chiede a che punto è arrivato e si riparte da lì.
async function mandaPezzo(sessione, pezzo, inizio, totale) {
    let da = inizio;
    for (let tentativo = 0; ; tentativo++) {
        const parte = pezzo.subarray(da - inizio);
        let r = null;
        try {
            r = await fetch(sessione, {
                method: 'PUT', body: parte, signal: AbortSignal.timeout(120000),
                headers: { 'Content-Length': String(parte.length), 'Content-Range': parte.length ? `bytes ${da}-${da + parte.length - 1}/${totale}` : `bytes */${totale}` }
            });
        } catch { r = null; }
        if (r && (r.status === 200 || r.status === 201)) return { finito: true, file: await r.json().catch(() => ({})) };
        if (r && r.status === 308) {
            const ricevuti = ricevutiDa(r.headers.get('range'));
            if (ricevuti >= inizio + pezzo.length) return { finito: false };
            da = Math.max(inizio, ricevuti);
            continue;
        }
        if (r && r.status < 500 && r.status !== 429) throw new ErroreDrive('google', `Google Drive ha interrotto il caricamento (${r.status}).`);
        if (tentativo >= 5) throw new ErroreDrive('rete', 'Il caricamento su Google Drive si è interrotto troppe volte: si riprova al prossimo giro.');
        await pausa(Math.min(30000, 1000 * 2 ** tentativo));
        try {
            const stato = await fetch(sessione, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${totale}` }, signal: AbortSignal.timeout(30000) });
            if (stato.status === 200 || stato.status === 201) return { finito: true, file: await stato.json().catch(() => ({})) };
            if (stato.status === 308) da = Math.max(inizio, Math.min(ricevutiDa(stato.headers.get('range')), inizio + pezzo.length));
        } catch { /* si riprova con il pezzo intero da dove si era */ }
    }
}

async function caricaFile(token, percorso, metadati) {
    const { size } = await fs.promises.stat(percorso);
    const sessione = await apriCaricamento(token, metadati, size);
    const fd = await fs.promises.open(percorso, 'r');
    try {
        let esito = { finito: false };
        for (let inizio = 0; inizio < size; inizio += PEZZO) {
            const pezzo = Buffer.alloc(Math.min(PEZZO, size - inizio));
            await fd.read(pezzo, 0, pezzo.length, inizio);
            esito = await mandaPezzo(sessione, pezzo, inizio, size);
        }
        if (!esito.finito) throw new ErroreDrive('google', 'Google Drive non ha chiuso il caricamento.');
        return { ...esito.file, byte: size };
    } finally {
        await fd.close();
    }
}

// Per l'archivio dei file la grandezza non si sa prima: si manda a pezzi e la si dice con l'ultimo.
async function caricaFlusso(token, flusso, metadati) {
    const sessione = await apriCaricamento(token, metadati, null);
    let inizio = 0, accumulo = [], lunghezza = 0;
    for await (const pezzo of flusso) {
        accumulo.push(pezzo);
        lunghezza += pezzo.length;
        while (lunghezza >= PEZZO) {
            const tutto = Buffer.concat(accumulo);
            await mandaPezzo(sessione, tutto.subarray(0, PEZZO), inizio, '*');
            inizio += PEZZO;
            accumulo = [tutto.subarray(PEZZO)];
            lunghezza = accumulo[0].length;
        }
    }
    const ultimo = Buffer.concat(accumulo);
    const esito = await mandaPezzo(sessione, ultimo, inizio, inizio + ultimo.length);
    if (!esito.finito) throw new ErroreDrive('google', 'Google Drive non ha chiuso il caricamento.');
    return { ...esito.file, byte: inizio + ultimo.length };
}

// Le riprese del drone restano fuori: sono grandi e stanno già cifrate con i backup sul server e sul disco.
function archivioDeiFile() {
    const cartelle = ['uploads', 'protected_uploads', 'loghi'].filter(c => fs.existsSync(path.join(RADICE_DATI, c)));
    if (!cartelle.length) return null;
    const tar = spawn('tar', ['-cz', '--exclude=protected_uploads/drone', ...cartelle], { cwd: RADICE_DATI });
    let errori = '';
    tar.stderr.on('data', d => { errori += d; });
    // tar esce con 1 se un file cambia mentre lo legge: l'archivio c'è lo stesso.
    const fine = new Promise((ok, ko) => {
        tar.on('error', ko);
        tar.on('close', c => (c === 0 || c === 1 ? ok() : ko(new Error(`tar: ${errori.trim().slice(0, 200) || c}`))));
    });
    const cifrato = tar.stdout.pipe(flussoCifrato());
    return { flusso: cifrato, fine };
}

async function elencoInCartella(token, cartellaId) {
    const q = `'${cartellaId}' in parents and trashed = false`;
    const r = await chiamaDrive(token, 'GET', `/drive/v3/files?pageSize=1000&fields=${encodeURIComponent('files(id,name,size,createdTime,appProperties)')}&q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new ErroreDrive('google', `Google Drive non ha dato l'elenco dei file (${r.status}).`);
    return (await r.json()).files || [];
}

// Si cancellano solo i propri file, i più vecchi oltre il numero da tenere; quelli delle emergenze restano tutti.
async function pulisci(token, cartellaId, config) {
    const file = await elencoInCartella(token, cartellaId);
    const limiti = { giornaliero: config.giornalieri || GIORNALIERI_DI_SERIE, settimanale: config.settimanali || SETTIMANALI_DI_SERIE };
    for (const [tipo, tieni] of Object.entries(limiti)) {
        const suoi = file.filter(f => f.appProperties?.orion === tipo).sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
        for (const vecchio of suoi.slice(tieni)) {
            const r = await chiamaDrive(token, 'DELETE', `/drive/v3/files/${encodeURIComponent(vecchio.id)}`);
            if (r.ok || r.status === 404) logger.info(`[Drive] Tolta la copia vecchia ${vecchio.name}.`);
        }
    }
    const rimasti = await elencoInCartella(token, cartellaId);
    return rimasti.reduce((t, f) => t + Number(f.size || 0), 0);
}

let coda = Promise.resolve();
let lavoroInCorso = null;
function inCoda(lavoro) {
    const fatto = coda.then(lavoro, lavoro);
    coda = fatto.catch(() => {});
    return fatto;
}

async function copia({ percorso = null, tipo, archivio = false }) {
    const config = await leggi(CHIAVE_CONFIG);
    if (!config.token) return null;
    lavoroInCorso = { tipo, dal: new Date().toISOString() };
    try {
        if (!cifraturaPronta()) throw new ErroreDrive('copia', 'Manca la chiave dei dati: su Drive va solo materiale cifrato, quindi la copia aspetta che ci sia.');
        const nome = percorso ? path.basename(percorso) : `orion_${istanza()}_file_${orarioNome()}.tar.gz`;
        if (percorso && !(await fileCifrato(percorso))) throw new ErroreDrive('copia', `${nome} non è cifrato: su Drive non va.`);
        const token = await tokenAccesso(config);
        const cartellaId = await cartella(token, config);
        const metadati = { name: nome, parents: [cartellaId], appProperties: { orion: tipo, istanza: istanza() } };
        let file;
        if (archivio) {
            const a = archivioDeiFile();
            if (!a) return null;
            file = await caricaFlusso(token, a.flusso, metadati);
            try {
                await a.fine;
            } catch (e) {
                await chiamaDrive(token, 'DELETE', `/drive/v3/files/${encodeURIComponent(file.id)}`).catch(() => {});
                throw new ErroreDrive('copia', `L'archivio dei file non si è chiuso bene: ${e.message}.`);
            }
        } else {
            file = await caricaFile(token, percorso, metadati);
        }
        const usato = await pulisci(token, cartellaId, config);
        const { spazio } = await infoAccount(token);
        const stato = await leggi(CHIAVE_STATO);
        const adesso = new Date().toISOString();
        const copiati = [{ nome, id: file.id, tipo, il: adesso, byte: file.byte }, ...(stato.copiati || [])].slice(0, 200);
        await scrivi(CHIAVE_STATO, {
            ...stato, copiati, ultima_copia_il: adesso, esito: 'fatto', errore: null, errore_il: null, problema: null, usato_orion: usato, spazio: spazio || stato.spazio || null,
            [`ultimo_${tipo}_il`]: adesso,
            da_copiare: (stato.da_copiare || []).filter(d => d.percorso !== percorso)
        });
        logger.info(`[Drive] Copiato ${nome} (${tipo}, ${Math.round((file.byte || 0) / 1048576)} MB).`);
        return file;
    } catch (e) {
        const stato = await leggi(CHIAVE_STATO);
        const sparito = e.code === 'ENOENT';
        const daCopiare = (stato.da_copiare || []).filter(d => d.percorso !== percorso);
        if (percorso && tipo === 'emergenza' && !sparito) daCopiare.push({ percorso, tipo });
        await scrivi(CHIAVE_STATO, {
            ...stato, esito: 'errore', errore: sparito ? `Il backup ${path.basename(percorso)} non c'è più.` : e.message,
            errore_il: new Date().toISOString(), problema: e instanceof ErroreDrive ? e.tipo : 'copia', da_copiare: daCopiare.slice(-20)
        });
        logger.warn(`[Drive] Copia non riuscita (${tipo}): ${e.message}`);
        return null;
    } finally {
        lavoroInCorso = null;
    }
}

export function copiaSuDrive(percorso, tipo) {
    return inCoda(() => copia({ percorso, tipo })).catch(e => {
        logger.error('[Drive] Copia non riuscita:', e);
        return null;
    });
}

// Quelli delle emergenze li copia la chiusura; qui i notturni (dell'agente o dell'applicazione).
async function backupDelGiorno() {
    let migliore = null;
    for (const cartellaBackup of [CARTELLA_BACKUP_CRON, CARTELLA_BACKUP_APP]) {
        let nomi = [];
        try { nomi = await fs.promises.readdir(cartellaBackup); } catch { continue; }
        for (const nome of nomi) {
            const letto = leggiNomeBackup(nome);
            if (!letto || /^(emergenza|simulazione)-/.test(letto.motivo || '')) continue;
            const percorso = path.join(cartellaBackup, nome);
            const { mtimeMs } = await fs.promises.stat(percorso).catch(() => ({ mtimeMs: 0 }));
            if (!migliore || mtimeMs > migliore.mtimeMs) migliore = { percorso, mtimeMs };
        }
    }
    return migliore;
}

// Il controllo periodico: le copie delle emergenze rimaste indietro, il backup del giorno, l'archivio della settimana.
export async function controlloDrive({ fermo = () => false } = {}) {
    const config = await leggi(CHIAVE_CONFIG);
    if (!config.token || fermo()) return;
    const stato = await leggi(CHIAVE_STATO);
    for (const d of stato.da_copiare || []) await copiaSuDrive(d.percorso, d.tipo);
    const ultimoGiorno = Date.parse(stato.ultimo_giornaliero_il || 0) || 0;
    if (Date.now() - ultimoGiorno > 20 * 3600000) {
        const delGiorno = await backupDelGiorno();
        if (delGiorno && delGiorno.mtimeMs > ultimoGiorno) await copiaSuDrive(delGiorno.percorso, 'giornaliero');
    }
    const ultimaSettimana = Date.parse(stato.ultimo_settimanale_il || 0) || 0;
    if (Date.now() - ultimaSettimana > 7 * 24 * 3600000) await inCoda(() => copia({ tipo: 'settimanale', archivio: true })).catch(e => logger.error('[Drive] Archivio non riuscito:', e));
}

// Per gli avvisi agli amministratori: null se va tutto bene o Drive non è collegato.
export async function problemaDrive() {
    const [config, stato] = await Promise.all([leggi(CHIAVE_CONFIG), leggi(CHIAVE_STATO)]);
    if (!config.token || stato.esito !== 'errore') return null;
    return { tipo: stato.problema || 'copia', testo: stato.errore || 'La copia su Google Drive non è riuscita.' };
}

const indirizzoRitorno = (req) => `${req.protocol}://${req.get('host')}/api/sistema/drive/ritorno`;
const attese = new Map(); // state -> { verifier, utente, username, ritorno, scade }

async function infoAccount(token) {
    try {
        const r = await chiamaDrive(token, 'GET', `/drive/v3/about?fields=${encodeURIComponent('user(emailAddress),storageQuota(limit,usage)')}`);
        if (!r.ok) return {};
        const d = await r.json();
        return { account: d.user?.emailAddress || null, spazio: d.storageQuota ? { usato: Number(d.storageQuota.usage) || 0, limite: Number(d.storageQuota.limit) || null } : null };
    } catch {
        return {};
    }
}

// Google torna qui da un'altra origine: il cookie di sessione (SameSite strict) non arriva, quindi chi ha
// chiesto il collegamento si riconosce dallo state, casuale, a uso singolo, legato all'amministratore e valido dieci minuti.
export function registraRitornoDrive(app, { registraAudit }) {
    app.get('/api/sistema/drive/ritorno', async (req, res) => {
        const torna = (esito, motivo) => res.redirect(303, `/admin/sistema.html?drive=${esito}${motivo ? `&motivo=${encodeURIComponent(motivo)}` : ''}#pannello-drive`);
        const chiave = String(req.query.state || '');
        const attesa = attese.get(chiave);
        attese.delete(chiave);
        if (!attesa || attesa.scade < Date.now()) return torna('errore', 'Il collegamento è scaduto o non è partito dalla pagina Sistema: riprova da "Collega".');
        if (req.query.error) return torna('errore', req.query.error === 'access_denied' ? 'Su Google il permesso non è stato dato.' : `Google ha risposto: ${String(req.query.error).slice(0, 60)}.`);
        try {
            const config = await leggi(CHIAVE_CONFIG);
            const r = await fetch(URL_TOKEN, {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000),
                body: new URLSearchParams({
                    grant_type: 'authorization_code', code: String(req.query.code || ''), client_id: config.client_id,
                    client_secret: decifraTesto(config.segreto), redirect_uri: attesa.ritorno, code_verifier: attesa.verifier
                })
            });
            const dati = await r.json().catch(() => ({}));
            if (!r.ok) return torna('errore', `Google non ha dato l'accesso (${dati.error || r.status}).`);
            if (!dati.refresh_token) return torna('errore', 'Google non ha dato l\'accesso permanente: togli ORION dalle app collegate al tuo account Google e ricollega.');
            accesso = { token: dati.access_token, scade: Date.now() + (Number(dati.expires_in) || 3600) * 1000 };
            const info = await infoAccount(dati.access_token);
            await aggiorna(CHIAVE_CONFIG, { token: cifraTesto(dati.refresh_token), account: info.account || null, collegato_il: new Date().toISOString(), collegato_da: attesa.username });
            await aggiorna(CHIAVE_STATO, { esito: null, errore: null, errore_il: null, problema: null, spazio: info.spazio || null });
            registraAudit({ user: { id: attesa.utente, username: attesa.username }, ip: req.ip, headers: req.headers }, 'drive.collegato', { dettagli: { account: info.account || null } });
            logger.warn(`[Drive] Google Drive collegato da ${attesa.username}${info.account ? ` (${info.account})` : ''}.`);
            return torna('collegato');
        } catch (e) {
            logger.error('[Drive] Collegamento non riuscito:', e);
            return torna('errore', 'Il collegamento non è riuscito: riprova tra poco.');
        }
    });
}

export function registraRotteDrive(app, { soloAdmin, registraAudit, fermo = () => false }) {
    app.get('/api/sistema/drive', soloAdmin, async (req, res) => {
        try {
            const [config, stato] = await Promise.all([leggi(CHIAVE_CONFIG), leggi(CHIAVE_STATO)]);
            res.json({
                client_id: config.client_id || null, segreto_impostato: !!config.segreto, collegato: !!config.token,
                account: config.account || null, collegato_il: config.collegato_il || null,
                giornalieri: config.giornalieri || GIORNALIERI_DI_SERIE, settimanali: config.settimanali || SETTIMANALI_DI_SERIE,
                ritorno: indirizzoRitorno(req), in_corso: lavoroInCorso,
                ultima_copia_il: stato.ultima_copia_il || null, esito: stato.esito || null, errore: stato.errore || null, errore_il: stato.errore_il || null,
                usato_orion: stato.usato_orion ?? null, spazio: stato.spazio || null, in_attesa: (stato.da_copiare || []).length,
                copiati: (stato.copiati || []).slice(0, 10).map(({ nome, tipo, il, byte }) => ({ nome, tipo, il, byte }))
            });
        } catch (e) {
            logger.error('Errore GET /api/sistema/drive:', e);
            res.status(500).json({ message: 'Errore nel leggere lo stato di Google Drive.' });
        }
    });

    app.put('/api/sistema/drive/client', soloAdmin, async (req, res) => {
        const { client_id: clientId, client_secret: segreto, giornalieri, settimanali } = req.body || {};
        const cambi = {};
        if (clientId !== undefined) {
            if (!/^[A-Za-z0-9.-]{10,200}\.apps\.googleusercontent\.com$/.test(String(clientId).trim())) {
                return res.status(400).json({ message: 'L\'ID del client finisce con .apps.googleusercontent.com: copialo intero da Google Cloud.' });
            }
            cambi.client_id = String(clientId).trim();
        }
        if (segreto !== undefined && segreto !== '') {
            if (typeof segreto !== 'string' || segreto.trim().length < 10 || segreto.length > 200) return res.status(400).json({ message: 'Il segreto del client non sembra giusto: copialo intero da Google Cloud.' });
            cambi.segreto = cifraTesto(segreto.trim());
        }
        for (const [chiave, valore, massimo] of [['giornalieri', giornalieri, 60], ['settimanali', settimanali, 52]]) {
            if (valore === undefined || valore === '') continue;
            const n = Number(valore);
            if (!Number.isInteger(n) || n < 1 || n > massimo) return res.status(400).json({ message: `Le copie ${chiave} da tenere sono fra 1 e ${massimo}.` });
            cambi[chiave] = n;
        }
        try {
            const prima = await leggi(CHIAVE_CONFIG);
            // Un client nuovo non può usare l'accesso dato a quello vecchio.
            if (cambi.client_id && prima.client_id && cambi.client_id !== prima.client_id) Object.assign(cambi, { token: null, account: null, collegato_il: null });
            await aggiorna(CHIAVE_CONFIG, cambi);
            accesso = null;
            registraAudit(req, 'drive.configurato', { dettagli: { client: !!cambi.client_id, segreto: !!cambi.segreto, giornalieri: cambi.giornalieri, settimanali: cambi.settimanali } });
            res.json({ message: 'Impostazioni di Google Drive salvate.' });
        } catch (e) {
            logger.error('Errore PUT /api/sistema/drive/client:', e);
            res.status(500).json({ message: 'Errore nel salvare le impostazioni di Google Drive.' });
        }
    });

    app.post('/api/sistema/drive/collega', soloAdmin, async (req, res) => {
        const config = await leggi(CHIAVE_CONFIG);
        if (!config.client_id || !config.segreto) return res.status(409).json({ message: 'Prima salva l\'ID e il segreto del client OAuth.' });
        for (const [k, v] of attese) if (v.scade < Date.now()) attese.delete(k);
        const state = crypto.randomBytes(24).toString('base64url');
        const verifier = crypto.randomBytes(48).toString('base64url');
        const ritorno = indirizzoRitorno(req);
        attese.set(state, { verifier, utente: req.user.id, username: req.user.username, ritorno, scade: Date.now() + 10 * 60000 });
        const url = new URL(URL_CONSENSO);
        for (const [k, v] of Object.entries({
            client_id: config.client_id, redirect_uri: ritorno, response_type: 'code', scope: PERMESSO, access_type: 'offline', prompt: 'consent',
            code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state
        })) url.searchParams.set(k, v);
        res.json({ url: url.toString() });
    });

    app.post('/api/sistema/drive/copia', soloAdmin, async (req, res) => {
        const config = await leggi(CHIAVE_CONFIG);
        if (!config.token) return res.status(409).json({ message: 'Google Drive non è collegato.' });
        if (fermo()) return res.status(409).json({ message: 'C\'è una manutenzione in corso: la copia si fa dopo.' });
        const delGiorno = await backupDelGiorno();
        if (!delGiorno) return res.status(409).json({ message: 'Sul server non c\'è ancora un backup da copiare: fanne uno dalla sezione Backup.' });
        registraAudit(req, 'drive.copia_chiesta', { dettagli: { file: path.basename(delGiorno.percorso) } });
        copiaSuDrive(delGiorno.percorso, 'giornaliero');
        res.status(202).json({ message: `Copia di ${path.basename(delGiorno.percorso)} avviata: la pagina dice quando è finita.` });
    });

    app.delete('/api/sistema/drive', soloAdmin, async (req, res) => {
        try {
            const config = await leggi(CHIAVE_CONFIG);
            if (config.token) {
                await fetch(URL_REVOCA, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: decifraTesto(config.token) }), signal: AbortSignal.timeout(15000) })
                    .catch(e => logger.warn(`[Drive] Revoca presso Google non riuscita: ${e.message}`));
            }
            await aggiorna(CHIAVE_CONFIG, { token: null, account: null, collegato_il: null });
            await aggiorna(CHIAVE_STATO, { esito: null, errore: null, problema: null, da_copiare: [] });
            accesso = null;
            registraAudit(req, 'drive.scollegato', { dettagli: { account: config.account || null } });
            res.json({ message: 'Google Drive scollegato: le copie già fatte restano nella cartella su Drive.' });
        } catch (e) {
            logger.error('Errore DELETE /api/sistema/drive:', e);
            res.status(500).json({ message: 'Errore nello scollegare Google Drive.' });
        }
    });
}
