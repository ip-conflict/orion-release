// Il drone in diretta: il pilota trasmette in RTMP a MediaMTX con una chiave dell'emergenza, la sala guarda
// in WebRTC passando da ORION, le registrazioni diventano file cifrati dell'emergenza. Vedi "Il drone" nel
// manuale tecnico.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
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
    hls: (process.env.ORION_DRONE_HLS || 'http://drone:8888').replace(/\/$/, ''),
    host: process.env.ORION_DRONE_HOST || process.env.DOMAIN_NAME || 'localhost',
    porta: parseInt(process.env.ORION_DRONE_RTMP_PORTA, 10) || 1935,
    portaWebrtc: parseInt(process.env.ORION_DRONE_WEBRTC_PORTA, 10) || 8189,
    registrazioni: process.env.ORION_DRONE_REGISTRAZIONI || '/drone-registrazioni',
    riposoMs: parseInt(process.env.ORION_DRONE_RIPOSO_MS, 10) || 20000
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
const dallApp = (req) => req.get('x-orion-client') === 'app';

// La squadra del drone è quella del pilota, se c'è un pilota (e lo segue se cambia squadra), altrimenti quella scelta.
const CHIAVI_EMERGENZA = `
    SELECT k.id, k.nome, k.creata_il, k.revocata_il, k.ultima_diretta_il, k.impronta,
           (SELECT count(*)::int FROM registrazioni_drone r WHERE r.chiave_id = k.id) AS registrazioni,
           p.id AS pilota_id, p.username AS pilota_username, NULLIF(trim(concat_ws(' ', p.nome, p.cognome)), '') AS pilota_nome,
           s.id AS squadra_id, s.nome_radio AS squadra_nome_radio, s.nome AS squadra_nome
      FROM chiavi_drone k
      LEFT JOIN users p ON p.id = k.pilota_id
      LEFT JOIN squadra_membri pm ON pm.username = p.username
      LEFT JOIN squadre s ON s.id = CASE WHEN k.pilota_id IS NOT NULL THEN pm.squadra_id ELSE k.squadra_id END
     WHERE k.emergency_id = $1`;
const conSquadraEPilota = ({ pilota_id, pilota_username, pilota_nome, squadra_id, squadra_nome_radio, squadra_nome, ...k }) => ({
    ...k,
    pilota: pilota_id ? { id: pilota_id, username: pilota_username, nome: pilota_nome } : null,
    squadra: squadra_id ? { id: squadra_id, nome_radio: squadra_nome_radio, nome: squadra_nome } : null
});

// Dall'app la sala (chi apre le emergenze, la squadra COC) e i caposquadra vedono ogni drone; gli altri solo quello della
// loro squadra. Dal web resta com'è: il centro operativo lo apre ogni interno.
async function chiVedeDallApp(req) {
    const { rows } = await pool.query(
        `SELECT sm.squadra_id, sm.caposquadra, s.coc FROM squadra_membri sm JOIN squadre s ON s.id = sm.squadra_id WHERE sm.username = $1`, [req.user.username]);
    return {
        tutto: haPermesso(req, 'emergenze.apertura') || rows.some(r => r.coc || r.caposquadra),
        squadre: new Set(rows.map(r => r.squadra_id))
    };
}
const vedeDallApp = (chi, k) => chi.tutto || (!!k.squadra && chi.squadre.has(k.squadra.id));

async function leggiPilotaESquadra(corpo) {
    const numero = (v) => (v === null || v === undefined || v === '' ? null : parseInt(v, 10));
    let pilota = numero(corpo?.pilota_id);
    const squadra = numero(corpo?.squadra_id);
    if (Number.isNaN(pilota) || Number.isNaN(squadra)) return { errore: 'Pilota e squadra si indicano con il loro numero.' };
    // Il pannello conosce i membri delle squadre per nome utente.
    if (pilota === null && corpo?.pilota) {
        pilota = (await pool.query('SELECT id FROM users WHERE username = $1', [String(corpo.pilota).trim().toLowerCase()])).rows[0]?.id ?? NaN;
        if (Number.isNaN(pilota)) return { errore: 'Il pilota indicato non c\'è.' };
    }
    if (pilota !== null && !(await pool.query('SELECT 1 FROM users WHERE id = $1 AND is_active', [pilota])).rowCount) return { errore: 'Il pilota indicato non c\'è o è sospeso.' };
    if (pilota === null && squadra !== null && !(await pool.query('SELECT 1 FROM squadre WHERE id = $1', [squadra])).rowCount) return { errore: 'La squadra indicata non c\'è.' };
    return { pilota, squadra: pilota === null ? squadra : null };
}

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
                logger.error(`[Drone] Registrazione ${nome} della chiave ${chiave?.id ?? 'sconosciuta'} non raccolta:`, e);
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
            const inCorso = await diretteInCorso().catch(() => new Map());
            if (inCorso.has(impronta(m[1]))) {
                logger.warn(`[Drone] ${rows[0].nome}: un secondo collegamento da ${ip || '?'} con la chiave già in onda, respinto.`);
                registraAudit({ ip }, 'drone.doppione_respinto', { tipo: 'emergenza', id: activeEmergency.id, dettagli: { drone: rows[0].nome, chiave: rows[0].id } });
                return res.status(401).end();
            }
            const massimo = await maxDirette();
            // Se MediaMTX non dice chi è in onda si lascia passare: il limite protegge la banda, non l'accesso.
            const altre = inCorso.size;
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

// Il file è cifrato in un flusso solo: per servire un tratto si decifra dall'inizio e si scarta il resto.
// Basta per pezzi da un minuto, e permette al lettore di saltare avanti e indietro.
function trattoChiesto(intestazione, dimensione) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(intestazione || '').trim());
    if (!m || !Number.isFinite(dimensione) || dimensione <= 0) return undefined;
    let da, a;
    if (m[1] === '') { da = Math.max(0, dimensione - Number(m[2])); a = dimensione - 1; } else { da = Number(m[1]); a = m[2] === '' ? dimensione - 1 : Math.min(Number(m[2]), dimensione - 1); }
    if (!(da <= a) || da >= dimensione) return null;
    return { da, a };
}
function ritaglio(da, a) {
    let posizione = 0;
    return new Transform({
        transform(pezzo, _, fatto) {
            const inizio = posizione, fine = posizione + pezzo.length;
            posizione = fine;
            if (fine <= da || inizio > a) return fatto();
            fatto(null, pezzo.subarray(Math.max(0, da - inizio), Math.min(pezzo.length, a - inizio + 1)));
        }
    });
}
// Rivedere un volo sono decine di richieste di pezzi: nel registro una voce per persona e drone ogni mezz'ora.
const ultimaVista = new Map();
function visteDiRecente(utente, chiave) {
    const voce = `${utente}:${chiave}`, ora = Date.now();
    const recente = ora - (ultimaVista.get(voce) || 0) < 30 * 60000;
    if (!recente) ultimaVista.set(voce, ora);
    if (ultimaVista.size > 10000) ultimaVista.clear();
    return recente;
}

export function registraRotteDrone(app) {
    const sessioni = new Map();

    // Il video in HLS arriva a pezzi da un secondo: la decisione su chi guarda si tiene qualche secondo, non si rifà a ogni pezzo.
    const visibilita = new Map();
    async function chiavePerGuardare(req, res, id) {
        const memoria = `${req.user.id}:${id}:${dallApp(req)}`;
        const tenuta = visibilita.get(memoria);
        if (tenuta && tenuta.scade > Date.now() && tenuta.emergenza === activeEmergency?.id) return tenuta.chiave;
        const riga = (await pool.query(`${CHIAVI_EMERGENZA} AND k.id = $2 AND k.revocata_il IS NULL`, [activeEmergency?.id ?? null, id])).rows[0];
        if (!riga) { res.status(404).json({ message: 'Questo drone non trasmette per l\'emergenza in corso.' }); return null; }
        const k = conSquadraEPilota(riga);
        if (dallApp(req) && !vedeDallApp(await chiVedeDallApp(req), k)) {
            res.status(403).json({ message: 'Questo drone lo vedono la sua squadra, la sala e i caposquadra.' });
            return null;
        }
        const segreto = decifraTesto((await pool.query('SELECT chiave_cifrata FROM chiavi_drone WHERE id = $1', [id])).rows[0].chiave_cifrata);
        const chiave = { id: k.id, nome: k.nome, segreto };
        visibilita.set(memoria, { chiave, scade: Date.now() + 10000, emergenza: activeEmergency?.id });
        if (visibilita.size > 5000) visibilita.clear();
        return chiave;
    }

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
            const { rows } = await pool.query(`${CHIAVI_EMERGENZA} ORDER BY k.revocata_il IS NOT NULL, k.creata_il`, [activeEmergency.id]);
            let inCorso = new Map(), mediamtx = true;
            try { inCorso = await diretteInCorso(); } catch (e) { mediamtx = false; logger.warn(`[Drone] MediaMTX non risponde: ${e.message}`); }
            const respinto = ultimoRespinto?.emergenza === activeEmergency.id && Date.now() - Date.parse(ultimoRespinto.il) < 10 * 60000 ? ultimoRespinto : null;
            res.json({
                mediamtx,
                max_dirette: await maxDirette(),
                respinto: respinto && { nome: respinto.nome, il: respinto.il, massimo: respinto.massimo },
                chiavi: rows.map(({ impronta: imp, ...k }) => ({ ...conSquadraEPilota(k), in_onda: !k.revocata_il && inCorso.has(imp), in_onda_da: inCorso.get(imp)?.da || null }))
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
            const legame = await leggiPilotaESquadra(req.body);
            if (legame.errore) return res.status(400).json({ message: legame.errore });
            const chiave = crypto.randomBytes(24).toString('base64url');
            const { rows } = await pool.query(
                `INSERT INTO chiavi_drone (emergency_id, nome, impronta, chiave_cifrata, creata_da, pilota_id, squadra_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nome, creata_il`,
                [activeEmergency.id, nome, impronta(chiave), cifraTesto(chiave), req.user.id, legame.pilota, legame.squadra]);
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

    app.patch('/api/drone/chiavi/:id', async (req, res) => {
        if (!(await prontoPerLaSala(req, res))) return;
        if (!haPermesso(req, 'emergenze.apertura')) return res.status(403).json({ message: 'Pilota e squadra del drone li sceglie chi apre le emergenze.' });
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Chiave non valida.' });
        try {
            const legame = await leggiPilotaESquadra(req.body);
            if (legame.errore) return res.status(400).json({ message: legame.errore });
            const { rows } = await pool.query(
                `UPDATE chiavi_drone SET pilota_id = $3, squadra_id = $4 WHERE id = $1 AND emergency_id = $2 AND revocata_il IS NULL RETURNING nome`,
                [id, activeEmergency?.id ?? null, legame.pilota, legame.squadra]);
            if (!rows.length) return res.status(404).json({ message: 'Questa chiave non vale per l\'emergenza in corso.' });
            visibilita.clear();
            registraAudit(req, 'drone.chiave_modificata', { tipo: 'emergenza', id: activeEmergency.id, dettagli: { chiave: id, pilota: legame.pilota, squadra: legame.squadra } });
            avvisaClienti('reload_drone');
            res.json({ id, ...legame });
        } catch (e) {
            logger.error('Errore PATCH /api/drone/chiavi:', e);
            res.status(500).json({ message: 'Errore nel cambiare pilota o squadra.' });
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
            const k = await chiavePerGuardare(req, res, id);
            if (!k) return;
            const r = await fetch(`${impostazione().webrtc}/drone/${k.segreto}/whep`, {
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

    // I droni che chi usa l'app può guardare, in onda o pronti: il video si apre solo quando la persona lo chiede.
    app.get('/api/app/drone', async (req, res) => {
        try {
            if (esterno(req) || !activeEmergency || !(await moduloAcceso())) return res.json({ attivo: false, mediamtx: true, dirette: [] });
            const chi = await chiVedeDallApp(req);
            const { rows } = await pool.query(`${CHIAVI_EMERGENZA} AND k.revocata_il IS NULL ORDER BY k.creata_il`, [activeEmergency.id]);
            let inCorso = new Map(), mediamtx = true;
            try { inCorso = await diretteInCorso(); } catch (e) { mediamtx = false; logger.warn(`[Drone] MediaMTX non risponde: ${e.message}`); }
            const dirette = rows.map(r => ({ ...conSquadraEPilota(r), onda: inCorso.get(r.impronta) })).filter(k => vedeDallApp(chi, k))
                .map(k => ({ id: k.id, nome: k.nome, in_onda: !!k.onda, in_onda_da: k.onda?.da || null, ultima_diretta_il: k.ultima_diretta_il, registrazioni: k.registrazioni, squadra: k.squadra, pilota: k.pilota }));
            res.json({ attivo: true, mediamtx, dirette });
        } catch (e) {
            logger.error('Errore GET /api/app/drone:', e);
            res.status(500).json({ message: 'Errore nel leggere i droni.' });
        }
    });

    // HLS passando da ORION, per l'app: solo la porta 443 e la sessione di chi guarda, nessun indirizzo di MediaMTX fuori.
    const FILE_HLS = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,120}$/;
    app.get('/api/drone/dirette/:id/hls/:file', async (req, res) => {
        if (!(await prontoPerLaSala(req, res))) return;
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || !FILE_HLS.test(req.params.file) || req.params.file.includes('..')) return res.status(400).json({ message: 'Richiesta non valida.' });
        const ferma = new AbortController();
        res.on('close', () => ferma.abort());
        try {
            const k = await chiavePerGuardare(req, res, id);
            if (!k) return;
            // Passano solo le domande di LL-HLS: MediaMTX legge dalla query anche credenziali e token.
            const domanda = new URLSearchParams();
            for (const [k, v] of new URL(req.originalUrl, 'http://orion').searchParams) if (/^_HLS_(msn|part|skip)$/.test(k) && /^[A-Za-z0-9]{1,12}$/.test(v)) domanda.append(k, v);
            const query = domanda.size ? `?${domanda}` : '';
            const r = await fetch(`${impostazione().hls}/drone/${k.segreto}/${req.params.file}${query}`, { headers: { Authorization: basic() }, signal: ferma.signal });
            if (r.status === 404) return res.status(404).json({ message: `${k.nome} non sta trasmettendo.` });
            if (!r.ok || !r.body) return res.status(502).json({ message: `MediaMTX ha risposto ${r.status}.` });
            res.status(200).set({ 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
            await pipeline(Readable.fromWeb(r.body), res);
        } catch (e) {
            if (ferma.signal.aborted) return;
            logger.warn(`[Drone] HLS non riuscito: ${e.message}`);
            if (!res.headersSent) res.status(502).json({ message: 'MediaMTX non risponde.' });
            else res.destroy();
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

    // I pezzi del volo di un drone dell'emergenza in corso, anche a chiave tolta: dall'app con la regola di chi lo vede.
    async function droneDaRivedere(req, res, emergenza, chiaveId) {
        const riga = (await pool.query(`${CHIAVI_EMERGENZA} AND k.id = $2`, [emergenza, chiaveId])).rows[0];
        if (!riga) { res.status(404).json({ message: 'Questo drone non c\'è in questa emergenza.' }); return false; }
        if (dallApp(req) && !vedeDallApp(await chiVedeDallApp(req), conSquadraEPilota(riga))) {
            res.status(403).json({ message: 'Questo drone lo vedono la sua squadra, la sala e i caposquadra.' });
            return false;
        }
        return true;
    }

    app.get('/api/drone/dirette/:id/registrazioni', async (req, res) => {
        if (!(await prontoPerLaSala(req, res))) return;
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Drone non valido.' });
        if (!activeEmergency) return res.status(404).json({ message: 'Non c\'è un\'emergenza aperta.' });
        try {
            if (!(await droneDaRivedere(req, res, activeEmergency.id, id))) return;
            const { rows } = await pool.query(
                `SELECT id, iniziata_il, finita_il, dimensione::float8 AS dimensione FROM registrazioni_drone
                  WHERE chiave_id = $1 AND emergency_id = $2 ORDER BY iniziata_il`, [id, activeEmergency.id]);
            res.json(rows);
        } catch (e) {
            logger.error('Errore GET /api/drone/dirette/:id/registrazioni:', e);
            res.status(500).json({ message: 'Errore nel leggere le riprese.' });
        }
    });

    app.get('/api/drone/registrazioni', async (req, res) => {
        const emergenza = parseInt(req.query.emergenza, 10);
        if (!Number.isInteger(emergenza)) return res.status(400).json({ message: 'Indica l\'emergenza.' });
        if (esterno(req) || !puoVedereEmergenza(req, emergenza)) return res.status(403).json({ message: 'Non puoi vedere le riprese di questa emergenza.' });
        try {
            const { rows } = await pool.query(
                `SELECT id, chiave_id, nome_drone, iniziata_il, finita_il, dimensione::float8 AS dimensione FROM registrazioni_drone WHERE emergency_id = $1 ORDER BY chiave_id, iniziata_il`, [emergenza]);
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
            const r = (await pool.query('SELECT emergency_id, chiave_id, nome_drone, iniziata_il, file, dimensione::float8 AS dimensione FROM registrazioni_drone WHERE id = $1', [id])).rows[0];
            if (!r) return res.status(404).json({ message: 'Ripresa non trovata.' });
            if (esterno(req) || !puoVedereEmergenza(req, r.emergency_id)) return res.status(403).json({ message: 'Non puoi vedere le riprese di questa emergenza.' });
            if (dallApp(req) && !(await droneDaRivedere(req, res, r.emergency_id, r.chiave_id))) return;
            const percorso = path.join(CARTELLA, r.file);
            if (!percorso.startsWith(CARTELLA + path.sep)) return res.status(400).json({ message: 'Ripresa non valida.' });
            // Troppo grande da decifrare tutto prima: un file alterato si interrompe a metà invece di non partire.
            const flusso = await apriFile(percorso);
            const nome = `drone-${String(r.nome_drone).replace(/[^A-Za-z0-9_-]+/g, '_')}-${new Date(r.iniziata_il).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp4`;
            res.set({
                'Content-Type': 'video/mp4', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes',
                'Content-Security-Policy': "default-src 'none'; sandbox",
                'Content-Disposition': `${req.query.scarica ? 'attachment' : 'inline'}; filename="${nome}"`
            });
            if (req.query.scarica || !visteDiRecente(req.user.id, r.chiave_id)) {
                registraAudit(req, 'drone.ripresa_vista', { tipo: 'emergenza', id: r.emergency_id, dettagli: { registrazione: id, drone: r.nome_drone, scaricata: !!req.query.scarica } });
            }
            const tratto = trattoChiesto(req.get('range'), r.dimensione);
            if (tratto === null) {
                flusso.destroy();
                return res.status(416).set('Content-Range', `bytes */${r.dimensione}`).end();
            }
            if (tratto) {
                res.status(206).set({ 'Content-Range': `bytes ${tratto.da}-${tratto.a}/${r.dimensione}`, 'Content-Length': String(tratto.a - tratto.da + 1) });
                await pipeline(flusso, ritaglio(tratto.da, tratto.a), res);
            } else {
                res.set('Content-Length', String(r.dimensione));
                await pipeline(flusso, res);
            }
        } catch (e) {
            if (e.code === 'ENOENT') return res.status(404).json({ message: 'Il file della ripresa non c\'è più.' });
            if (!res.headersSent) res.status(500).json({ message: 'La ripresa non si legge.' });
            else logger.error('[Drone] Ripresa interrotta:', e);
        }
    });
}
