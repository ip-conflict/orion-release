// Il drone in diretta: il pilota trasmette in RTMP a MediaMTX con una chiave dell'emergenza, la sala guarda
// in WebRTC passando da ORION, le registrazioni diventano file cifrati dell'emergenza. Vedi "Il drone" nel
// manuale tecnico.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import express from 'express';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { puoVedereEmergenza, ruoliDi } from './autenticazione.js';
import { apriFile, cifraTesto, cifraturaPronta, decifraTesto, flussoCifrato } from './cifratura.js';
import { pool } from './db.js';
import { RADICE_DATI } from './percorsi.js';
import { haPermesso } from './permessi.js';
import { activeEmergency } from './statoEmergenza.js';
import { avvisaClienti } from './tempoReale.js';

const CARTELLA = path.join(RADICE_DATI, 'protected_uploads', 'drone');
const PERCORSO = /^drone\/([A-Za-z0-9_-]{24,64})$/;

const impostazione = () => ({
    segreto: process.env.ORION_DRONE_SEGRETO || '',
    api: (process.env.ORION_DRONE_API || 'http://drone:9997').replace(/\/$/, ''),
    webrtc: (process.env.ORION_DRONE_WEBRTC || 'http://drone:8889').replace(/\/$/, ''),
    host: process.env.ORION_DRONE_HOST || process.env.DOMAIN_NAME || 'localhost',
    porta: parseInt(process.env.ORION_DRONE_RTMP_PORTA, 10) || 1935,
    portaWebrtc: parseInt(process.env.ORION_DRONE_WEBRTC_PORTA, 10) || 8189,
    registrazioni: process.env.ORION_DRONE_REGISTRAZIONI || '/drone-registrazioni',
    riposoMs: parseInt(process.env.ORION_DRONE_RIPOSO_MS, 10) || 90000
});
export const droneConfigurato = () => impostazione().segreto.length >= 16;

export const DRONE_MAX_DIRETTE_LIMITE = 20;
const DRONE_MAX_DIRETTE_DI_SERIE = 3;
async function maxDirette() {
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'drone_max_dirette'");
    return parseInt(r.rows[0]?.setting_value, 10) || DRONE_MAX_DIRETTE_DI_SERIE;
}
// Il pilota respinto vede solo "connessione fallita": la sala deve sapere perché.
let ultimoRespinto = null;

async function moduloAcceso() {
    if (!droneConfigurato()) return false;
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'drone_enabled'");
    return r.rows[0]?.setting_value === 'true';
}

const impronta = (chiave) => crypto.createHash('sha256').update(chiave).digest('hex');
const uguali = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const basic = () => `Basic ${Buffer.from(`orion:${impostazione().segreto}`).toString('base64')}`;
const esterno = (req) => ruoliDi(req.user).includes('esterno');

async function chiamaMediaMtx(percorso, opzioni = {}) {
    const ferma = new AbortController();
    const tempo = setTimeout(() => ferma.abort(), 8000);
    try {
        return await fetch(impostazione().api + percorso, { ...opzioni, signal: ferma.signal });
    } finally {
        clearTimeout(tempo);
    }
}

// Le dirette in corso, per impronta della chiave: MediaMTX conosce solo il percorso con la chiave dentro.
async function diretteInCorso() {
    const r = await chiamaMediaMtx('/v3/paths/list?itemsPerPage=1000');
    if (!r.ok) throw new Error(`MediaMTX risponde ${r.status}`);
    const elenco = (await r.json())?.items || [];
    const inCorso = new Map();
    for (const p of elenco) {
        const m = PERCORSO.exec(p.name || '');
        if (m && p.ready) inCorso.set(impronta(m[1]), { da: p.readyTime || null, ricevuti: p.bytesReceived || 0 });
    }
    return inCorso;
}

async function chiudiDiretta(chiave) {
    try {
        const r = await chiamaMediaMtx('/v3/rtmpconns/list?itemsPerPage=1000');
        if (!r.ok) return;
        for (const c of (await r.json())?.items || []) {
            if (c.path === `drone/${chiave}` && c.state === 'publish') await chiamaMediaMtx(`/v3/rtmpconns/kick/${encodeURIComponent(c.id)}`, { method: 'POST' });
        }
    } catch (e) {
        logger.warn(`[Drone] Diretta non interrotta: ${e.message}`);
    }
}

// Alla chiusura dell'emergenza le chiavi smettono di valere da sole; qui si stacca chi sta ancora trasmettendo.
export async function chiudiDiretteEmergenza(emergencyId) {
    if (!droneConfigurato()) return;
    const { rows } = await pool.query('SELECT chiave_cifrata FROM chiavi_drone WHERE emergency_id = $1', [emergencyId]);
    for (const r of rows) await chiudiDiretta(decifraTesto(r.chiave_cifrata));
    avvisaClienti('reload_drone');
}

export async function eliminaRegistrazioniDrone(emergencyId) {
    await fs.promises.rm(path.join(CARTELLA, String(Number(emergencyId))), { recursive: true, force: true });
}

// Un file è finito quando MediaMTX non ci scrive più da un po': la diretta in corso aggiorna il suo ogni secondo.
export async function raccogliRegistrazioni() {
    if (!droneConfigurato()) return 0;
    if (!cifraturaPronta()) return 0;
    const { registrazioni, riposoMs } = impostazione();
    const radice = path.join(registrazioni, 'drone');
    let cartelle;
    try { cartelle = await fs.promises.readdir(radice, { withFileTypes: true }); } catch { return 0; }
    let raccolte = 0;
    for (const c of cartelle) {
        if (!c.isDirectory() || !/^[A-Za-z0-9_-]{24,64}$/.test(c.name)) continue;
        const chiave = (await pool.query('SELECT id, emergency_id, nome FROM chiavi_drone WHERE impronta = $1', [impronta(c.name)])).rows[0];
        const dir = path.join(radice, c.name);
        for (const nome of await fs.promises.readdir(dir)) {
            if (!nome.endsWith('.mp4')) continue;
            const origine = path.join(dir, nome);
            try {
                const info = await fs.promises.stat(origine);
                if (Date.now() - info.mtimeMs < riposoMs) continue;
                // Una chiave che ORION non conosce più (emergenza eliminata): la registrazione non ha dove andare.
                if (!chiave) { await fs.promises.rm(origine, { force: true }); continue; }
                const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(nome);
                const inizio = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : new Date(info.birthtimeMs || info.mtimeMs);
                const destDir = path.join(CARTELLA, String(chiave.emergency_id));
                await fs.promises.mkdir(destDir, { recursive: true });
                const destinazione = path.join(destDir, `${crypto.randomUUID()}.mp4`);
                await pipeline(fs.createReadStream(origine), flussoCifrato(), fs.createWriteStream(`${destinazione}.tmp`));
                await fs.promises.rename(`${destinazione}.tmp`, destinazione);
                const { rows } = await pool.query(
                    `INSERT INTO registrazioni_drone (emergency_id, chiave_id, nome_drone, iniziata_il, finita_il, dimensione, file)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                    [chiave.emergency_id, chiave.id, chiave.nome, inizio, new Date(info.mtimeMs), info.size, path.relative(CARTELLA, destinazione)]);
                await fs.promises.rm(origine, { force: true });
                registraAudit(null, 'drone.registrazione_raccolta', { tipo: 'emergenza', id: chiave.emergency_id, dettagli: { registrazione: rows[0].id, drone: chiave.nome, byte: info.size } });
                raccolte++;
            } catch (e) {
                logger.error(`[Drone] Registrazione ${origine} non raccolta:`, e);
            }
        }
    }
    if (raccolte) avvisaClienti('reload_drone');
    return raccolte;
}

let ultimeInCorso = '';
// Dalla fine di una diretta MediaMTX non avvisa: le postazioni lo sanno da questo giro.
export async function controllaDirette() {
    if (!activeEmergency || !(await moduloAcceso().catch(() => false))) return;
    try {
        const adesso = [...(await diretteInCorso()).keys()].sort().join(',');
        if (adesso !== ultimeInCorso) { ultimeInCorso = adesso; avvisaClienti('reload_drone'); }
    } catch { /* MediaMTX giù: lo dice il pannello quando lo si apre */ }
}

// MediaMTX chiede qui chi può trasmettere e guardare: sta prima dell'accesso, con il suo segreto nell'indirizzo.
export function registraRotteDronePubbliche(app) {
    app.post('/api/drone/autorizza', express.json({ limit: '8kb' }), async (req, res) => {
        const { segreto } = impostazione();
        if (!droneConfigurato() || !uguali(req.query.s || '', segreto)) return res.status(403).end();
        const { action, path: percorso, protocol, user, password, ip } = req.body || {};
        try {
            if (action === 'read') return uguali(user || '', 'orion') && uguali(password || '', segreto) ? res.status(200).end() : res.status(401).end();
            if (action !== 'publish' || !['rtmp', 'srt'].includes(protocol)) return res.status(401).end();
            const m = PERCORSO.exec(percorso || '');
            if (!m || !activeEmergency || !(await moduloAcceso())) return res.status(401).end();
            const { rows } = await pool.query(
                'SELECT id, nome FROM chiavi_drone WHERE impronta = $1 AND emergency_id = $2 AND revocata_il IS NULL', [impronta(m[1]), activeEmergency.id]);
            if (!rows.length) {
                logger.warn(`[Drone] Trasmissione rifiutata da ${ip || '?'}: chiave sconosciuta, revocata o di un'altra emergenza.`);
                return res.status(401).end();
            }
            const massimo = await maxDirette();
            // Se MediaMTX non dice chi è in onda si lascia passare: il limite protegge la banda, non l'accesso.
            const altre = await diretteInCorso().then(d => [...d.keys()].filter(i => i !== impronta(m[1])).length).catch(() => 0);
            if (altre >= massimo) {
                logger.warn(`[Drone] ${rows[0].nome} respinto: già ${altre} droni in onda, il massimo è ${massimo}.`);
                ultimoRespinto = { emergenza: activeEmergency.id, nome: rows[0].nome, il: new Date().toISOString(), massimo };
                registraAudit({ ip }, 'drone.respinto', { tipo: 'emergenza', id: activeEmergency.id, dettagli: { drone: rows[0].nome, chiave: rows[0].id, massimo } });
                avvisaClienti('reload_drone');
                return res.status(401).end();
            }
            await pool.query('UPDATE chiavi_drone SET ultima_diretta_il = now() WHERE id = $1', [rows[0].id]);
            registraAudit({ ip }, 'drone.in_onda', { tipo: 'emergenza', id: activeEmergency.id, dettagli: { drone: rows[0].nome, chiave: rows[0].id } });
            setTimeout(() => avvisaClienti('reload_drone'), 2000);
            res.status(200).end();
        } catch (e) {
            logger.error('[Drone] Autorizzazione non riuscita:', e);
            res.status(500).end();
        }
    });
}

export function registraRotteDrone(app) {
    const sessioni = new Map();

    const prontoPerLaSala = async (req, res) => {
        if (esterno(req)) { res.status(403).json({ message: 'Le riprese del drone le vede la sala.' }); return false; }
        if (!(await moduloAcceso())) { res.status(404).json({ message: 'Il drone non è attivo: si accende dalle Impostazioni, con MediaMTX configurato sul server.', spento: true }); return false; }
        return true;
    };

    app.get('/api/drone/stato', async (req, res) => {
        try {
            const { porta, portaWebrtc } = impostazione();
            res.json({
                configurato: droneConfigurato(), attivo: !esterno(req) && await moduloAcceso(), puo_creare: haPermesso(req, 'emergenze.apertura'),
                ...(esterno(req) ? {} : { porte: { rtmp: porta, webrtc: portaWebrtc }, max_dirette: await maxDirette() })
            });
        } catch (e) {
            logger.error('Errore GET /api/drone/stato:', e);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });

    app.get('/api/drone/dirette', async (req, res) => {
        if (!(await prontoPerLaSala(req, res))) return;
        if (!activeEmergency) return res.json({ chiavi: [], mediamtx: true, max_dirette: await maxDirette() });
        try {
            const { rows } = await pool.query(
                `SELECT id, nome, creata_il, revocata_il, ultima_diretta_il, impronta FROM chiavi_drone
                  WHERE emergency_id = $1 ORDER BY revocata_il IS NOT NULL, creata_il`, [activeEmergency.id]);
            let inCorso = new Map(), mediamtx = true;
            try { inCorso = await diretteInCorso(); } catch (e) { mediamtx = false; logger.warn(`[Drone] MediaMTX non risponde: ${e.message}`); }
            const respinto = ultimoRespinto?.emergenza === activeEmergency.id && Date.now() - Date.parse(ultimoRespinto.il) < 10 * 60000 ? ultimoRespinto : null;
            res.json({
                mediamtx,
                max_dirette: await maxDirette(),
                respinto: respinto && { nome: respinto.nome, il: respinto.il, massimo: respinto.massimo },
                chiavi: rows.map(({ impronta: imp, ...k }) => ({ ...k, in_onda: !k.revocata_il && inCorso.has(imp), in_onda_da: inCorso.get(imp)?.da || null }))
            });
        } catch (e) {
            logger.error('Errore GET /api/drone/dirette:', e);
            res.status(500).json({ message: 'Errore nel leggere le dirette.' });
        }
    });

    // La chiave si vede una volta sola, qui: dopo resta solo per costruire la diretta, mai nelle risposte.
    app.post('/api/drone/chiavi', async (req, res) => {
        if (!(await prontoPerLaSala(req, res))) return;
        if (!haPermesso(req, 'emergenze.apertura')) return res.status(403).json({ message: 'Le chiavi del drone le dà chi apre le emergenze.' });
        if (!activeEmergency) return res.status(409).json({ message: "Le chiavi del drone valgono per un'emergenza o una simulazione aperta." });
        const nome = String(req.body?.nome || '').trim().slice(0, 80);
        if (!nome) return res.status(400).json({ message: 'Scrivi un nome per il drone o il pilota, per esempio "Matrice 4E – Marco".' });
        try {
            const chiave = crypto.randomBytes(24).toString('base64url');
            const { rows } = await pool.query(
                `INSERT INTO chiavi_drone (emergency_id, nome, impronta, chiave_cifrata, creata_da) VALUES ($1, $2, $3, $4, $5) RETURNING id, nome, creata_il`,
                [activeEmergency.id, nome, impronta(chiave), cifraTesto(chiave), req.user.id]);
            const { host, porta } = impostazione();
            registraAudit(req, 'drone.chiave_creata', { tipo: 'emergenza', id: activeEmergency.id, dettagli: { chiave: rows[0].id, nome } });
            avvisaClienti('reload_drone');
            res.status(201).json({
                ...rows[0],
                indirizzo: `rtmp://${host}${porta === 1935 ? '' : `:${porta}`}/drone/${chiave}`,
                server: `rtmp://${host}${porta === 1935 ? '' : `:${porta}`}/drone`,
                chiave
            });
        } catch (e) {
            logger.error('Errore POST /api/drone/chiavi:', e);
            res.status(500).json({ message: 'Errore nel creare la chiave.' });
        }
    });

    app.delete('/api/drone/chiavi/:id', async (req, res) => {
        if (!(await prontoPerLaSala(req, res))) return;
        if (!haPermesso(req, 'emergenze.apertura')) return res.status(403).json({ message: 'Le chiavi del drone le toglie chi apre le emergenze.' });
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Chiave non valida.' });
        try {
            const { rows } = await pool.query(
                'UPDATE chiavi_drone SET revocata_il = now() WHERE id = $1 AND revocata_il IS NULL RETURNING id, nome, chiave_cifrata, emergency_id', [id]);
            if (!rows.length) return res.status(404).json({ message: 'Chiave non trovata o già tolta.' });
            await chiudiDiretta(decifraTesto(rows[0].chiave_cifrata));
            registraAudit(req, 'drone.chiave_revocata', { tipo: 'emergenza', id: rows[0].emergency_id, dettagli: { chiave: id, nome: rows[0].nome } });
            avvisaClienti('reload_drone');
            res.json({ message: `La chiave di ${rows[0].nome} non vale più.` });
        } catch (e) {
            logger.error('Errore DELETE /api/drone/chiavi:', e);
            res.status(500).json({ message: 'Errore nel togliere la chiave.' });
        }
    });

    // WHEP passando da ORION: chi guarda è una sessione della sala, e la chiave non esce mai dal server.
    app.post('/api/drone/dirette/:id/whep', express.text({ type: 'application/sdp', limit: '64kb' }), async (req, res) => {
        if (!(await prontoPerLaSala(req, res))) return;
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || typeof req.body !== 'string' || !req.body.startsWith('v=0')) return res.status(400).json({ message: 'Richiesta non valida.' });
        try {
            const k = (await pool.query(
                'SELECT chiave_cifrata, nome FROM chiavi_drone WHERE id = $1 AND emergency_id = $2 AND revocata_il IS NULL', [id, activeEmergency?.id ?? null])).rows[0];
            if (!k) return res.status(404).json({ message: 'Questo drone non trasmette per l\'emergenza in corso.' });
            const r = await fetch(`${impostazione().webrtc}/drone/${decifraTesto(k.chiave_cifrata)}/whep`, {
                method: 'POST', body: req.body, headers: { 'Content-Type': 'application/sdp', Authorization: basic() }
            });
            if (r.status === 404) return res.status(404).json({ message: `${k.nome} non sta trasmettendo.` });
            if (!r.ok) return res.status(502).json({ message: `MediaMTX ha risposto ${r.status}.` });
            const sessione = crypto.randomUUID();
            sessioni.set(sessione, { remota: new URL(r.headers.get('location') || '', impostazione().webrtc).toString(), userId: req.user.id, creata: Date.now() });
            for (const [s, v] of sessioni) if (Date.now() - v.creata > 12 * 3600000) sessioni.delete(s);
            res.status(201).set({ 'Content-Type': 'application/sdp', Location: `/api/drone/sessioni/${sessione}` }).send(await r.text());
        } catch (e) {
            logger.error('Errore WHEP drone:', e);
            res.status(502).json({ message: 'MediaMTX non risponde.' });
        }
    });

    const inoltra = (metodo) => async (req, res) => {
        const s = sessioni.get(req.params.sessione);
        if (!s || s.userId !== req.user.id) return res.status(404).end();
        try {
            const r = await fetch(s.remota, {
                method: metodo, headers: { Authorization: basic(), ...(metodo === 'PATCH' ? { 'Content-Type': 'application/trickle-ice-sdpfrag' } : {}) },
                body: metodo === 'PATCH' ? req.body : undefined
            });
            if (metodo === 'DELETE') sessioni.delete(req.params.sessione);
            res.status(r.status).end();
        } catch {
            res.status(502).end();
        }
    };
    app.patch('/api/drone/sessioni/:sessione', express.text({ type: 'application/trickle-ice-sdpfrag', limit: '16kb' }), inoltra('PATCH'));
    app.delete('/api/drone/sessioni/:sessione', inoltra('DELETE'));

    app.get('/api/drone/registrazioni', async (req, res) => {
        const emergenza = parseInt(req.query.emergenza, 10);
        if (!Number.isInteger(emergenza)) return res.status(400).json({ message: 'Indica l\'emergenza.' });
        if (esterno(req) || !puoVedereEmergenza(req, emergenza)) return res.status(403).json({ message: 'Non puoi vedere le riprese di questa emergenza.' });
        try {
            const { rows } = await pool.query(
                `SELECT id, nome_drone, iniziata_il, finita_il, dimensione::float8 AS dimensione FROM registrazioni_drone WHERE emergency_id = $1 ORDER BY iniziata_il`, [emergenza]);
            res.json(rows);
        } catch (e) {
            logger.error('Errore GET /api/drone/registrazioni:', e);
            res.status(500).json({ message: 'Errore nel leggere le riprese.' });
        }
    });

    app.get('/api/drone/registrazioni/:id/file', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Ripresa non valida.' });
        try {
            const r = (await pool.query('SELECT emergency_id, nome_drone, iniziata_il, file FROM registrazioni_drone WHERE id = $1', [id])).rows[0];
            if (!r) return res.status(404).json({ message: 'Ripresa non trovata.' });
            if (esterno(req) || !puoVedereEmergenza(req, r.emergency_id)) return res.status(403).json({ message: 'Non puoi vedere le riprese di questa emergenza.' });
            const percorso = path.join(CARTELLA, r.file);
            if (!percorso.startsWith(CARTELLA + path.sep)) return res.status(400).json({ message: 'Ripresa non valida.' });
            // Troppo grande da decifrare tutto prima: un file alterato si interrompe a metà invece di non partire.
            const flusso = await apriFile(percorso);
            const nome = `drone-${String(r.nome_drone).replace(/[^A-Za-z0-9_-]+/g, '_')}-${new Date(r.iniziata_il).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp4`;
            res.set({
                'Content-Type': 'video/mp4', 'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "default-src 'none'; sandbox",
                'Content-Disposition': `${req.query.scarica ? 'attachment' : 'inline'}; filename="${nome}"`
            });
            registraAudit(req, 'drone.ripresa_vista', { tipo: 'emergenza', id: r.emergency_id, dettagli: { registrazione: id, scaricata: !!req.query.scarica } });
            await pipeline(flusso, res);
        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Il file della ripresa non c\'è più.' });
            if (!res.headersSent) res.status(500).json({ message: 'La ripresa non si legge.' });
            else logger.error('[Drone] Ripresa interrotta:', e);
        }
    });
}
