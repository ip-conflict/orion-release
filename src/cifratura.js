// La cifratura dei dati che escono più facilmente dal server: i file caricati
// (certificati medici, documenti, foto, verbali firmati, resoconti), i backup
// del database e la password della posta.
//
// La chiave (AES-256) la genera ORION al primo avvio e la tiene in un file a
// sé, chiave-dati.key nella cartella dell'applicazione (o ORION_CHIAVE_FILE),
// leggibile solo dal suo utente: non sta nel database e non finisce nei
// backup, così un backup copiato o rubato non si legge. Gli aggiornamenti non
// la toccano.
//
// Persa la chiave, i dati cifrati sono persi: per questo l'amministratore
// scarica una volta la chiave di recupero (la stessa chiave, scritta in
// gruppi di lettere da stampare) e la mette in cassaforte. Con quella si
// rimette la chiave su una macchina nuova, dalla pagina Sistema.
//
// Nel database resta solo l'impronta della chiave (cifratura_impronta): dice
// se la chiave sul disco è quella giusta, senza rivelarla.
//
// Il formato dei file cifrati è in formatoCifrato.js. I file in chiaro di
// prima continuano a funzionare e si cifrano piano piano.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import bcrypt from 'bcrypt';
import { pool } from './db.js';
import {
    MAGIA, apriFileCon, cifraCon, decifraCon, eCifrato, flussoCifratoCon,
    leggiChiaveDiRecupero, leggiFileChiaveDa, scriviChiaveDiRecupero
} from './formatoCifrato.js';

export { eCifrato };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.join(__dirname, '..');
export const FILE_CHIAVE = process.env.ORION_CHIAVE_FILE || path.join(RADICE, 'chiave-dati.key');

const PREFISSO_TESTO = 'enc1:';

// Le cartelle dei file da proteggere. I loghi restano in chiaro: sono pubblici.
export const CARTELLE_PROTETTE = [
    path.join(RADICE, 'protected_uploads', 'certificates'),
    path.join(RADICE, 'protected_uploads', 'documents'),
    path.join(RADICE, 'protected_uploads', 'images'),
    path.join(RADICE, 'protected_uploads', 'magazzino'),
    path.join(RADICE, 'protected_uploads', 'documenti-gruppo'),
    path.join(RADICE, 'protected_uploads', 'emergency_logs'),
    path.join(RADICE, 'uploads', 'photos')
];

let chiave = null;
// pronta | mancante (dati cifrati ma nessuna chiave) | diversa (la chiave sul disco non è quella dei dati)
let stato = 'mancante';

const impronta = (k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 32);

async function leggiImpostazione(nome) {
    const r = await pool.query('SELECT setting_value FROM branding_settings WHERE setting_key = $1', [nome]);
    return r.rows[0]?.setting_value ?? null;
}
async function scriviImpostazione(nome, valore) {
    await pool.query(
        `INSERT INTO branding_settings (setting_key, setting_value) VALUES ($1, $2)
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`, [nome, valore]);
}

const leggiFileChiave = () => leggiFileChiaveDa(FILE_CHIAVE);

function scriviFileChiave(k) {
    const temporaneo = `${FILE_CHIAVE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaneo, k.toString('base64') + '\n', { mode: 0o600 });
    fs.renameSync(temporaneo, FILE_CHIAVE);
}

// All'avvio, dopo le migrazioni.
export async function preparaCifratura() {
    const registrata = await leggiImpostazione('cifratura_impronta');
    const suDisco = leggiFileChiave();
    if (suDisco) {
        if (!registrata) {
            await scriviImpostazione('cifratura_impronta', impronta(suDisco));
            chiave = suDisco; stato = 'pronta';
        } else if (registrata === impronta(suDisco)) {
            chiave = suDisco; stato = 'pronta';
        } else {
            chiave = null; stato = 'diversa';
            logger.error(`[Cifratura] La chiave in ${FILE_CHIAVE} non è quella con cui sono cifrati i dati (per esempio dopo un ripristino da un'altra installazione): inserisci la chiave di recupero dalla pagina Sistema.`);
        }
    } else if (registrata) {
        chiave = null; stato = 'mancante';
        logger.error(`[Cifratura] Manca la chiave dei dati (${FILE_CHIAVE}): i file e i backup cifrati non si leggono finché un amministratore non inserisce la chiave di recupero dalla pagina Sistema.`);
    } else {
        const nuova = crypto.randomBytes(32);
        scriviFileChiave(nuova);
        await scriviImpostazione('cifratura_impronta', impronta(nuova));
        await scriviImpostazione('cifratura_recupero_salvata', 'false');
        chiave = nuova; stato = 'pronta';
        logger.warn(`[Cifratura] Creata la chiave dei dati in ${FILE_CHIAVE}. L'amministratore deve scaricare la chiave di recupero dalla pagina Sistema.`);
    }
    if (stato === 'pronta') await cifraSegretiInChiaro().catch(e => logger.error('[Cifratura] Segreti non cifrati:', e));
    return stato;
}

export const cifraturaPronta = () => stato === 'pronta';
export const statoCifratura = () => stato;

export class ChiaveNonDisponibile extends Error {
    constructor() {
        super("La chiave di cifratura dei dati non è disponibile: un amministratore deve inserire la chiave di recupero dalla pagina Sistema.");
        this.statusCode = 503;
    }
}

// --- La chiave di recupero ---------------------------------------------------
export function chiaveDiRecupero() {
    if (!chiave) throw new ChiaveNonDisponibile();
    return scriviChiaveDiRecupero(chiave);
}

// La chiave di recupero rimette la chiave sul disco, se è quella dei dati.
export async function inserisciChiaveDiRecupero(testo) {
    const k = leggiChiaveDiRecupero(testo);
    if (!k) return { ok: false, message: 'La chiave di recupero ha 52 caratteri (lettere e cifre, a gruppi di quattro): controlla di averla copiata tutta.' };
    const registrata = await leggiImpostazione('cifratura_impronta');
    if (registrata && registrata !== impronta(k)) {
        return { ok: false, message: 'Questa chiave non è quella con cui sono cifrati i dati di questa installazione.' };
    }
    scriviFileChiave(k);
    if (!registrata) await scriviImpostazione('cifratura_impronta', impronta(k));
    await scriviImpostazione('cifratura_recupero_salvata', 'true');
    chiave = k; stato = 'pronta';
    logger.warn('[Cifratura] Chiave dei dati rimessa dalla chiave di recupero.');
    await cifraSegretiInChiaro().catch(e => logger.error('[Cifratura] Segreti non cifrati:', e));
    return { ok: true, message: 'Chiave rimessa: file e backup cifrati si leggono di nuovo.' };
}

export async function segnaRecuperoSalvato() {
    await scriviImpostazione('cifratura_recupero_salvata', 'true');
}
export async function recuperoSalvato() {
    return (await leggiImpostazione('cifratura_recupero_salvata')) !== 'false';
}

// --- Dati in memoria ---------------------------------------------------------
export function cifra(buf) {
    if (!chiave) throw new ChiaveNonDisponibile();
    return cifraCon(chiave, buf);
}

export function decifra(buf) {
    if (!eCifrato(buf)) return buf;
    if (!chiave) throw new ChiaveNonDisponibile();
    return decifraCon(chiave, buf);
}

// Un segreto da tenere nel database (la password della posta).
export function cifraTesto(testo) {
    if (testo == null || testo === '' || String(testo).startsWith(PREFISSO_TESTO) || !chiave) return testo;
    return PREFISSO_TESTO + cifra(Buffer.from(String(testo), 'utf8')).toString('base64');
}
export function decifraTesto(testo) {
    if (typeof testo !== 'string' || !testo.startsWith(PREFISSO_TESTO)) return testo;
    return decifra(Buffer.from(testo.slice(PREFISSO_TESTO.length), 'base64')).toString('utf8');
}

async function cifraSegretiInChiaro() {
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'smtp_pass'");
    const v = r.rows[0]?.setting_value;
    if (v && !v.startsWith(PREFISSO_TESTO)) {
        await scriviImpostazione('smtp_pass', cifraTesto(v));
        logger.info('[Cifratura] Password della posta cifrata nel database.');
    }
    // La chiave di Firebase salvata mentre mancava la chiave dei dati.
    const f = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'firebase_account'");
    const fv = f.rows[0]?.setting_value;
    if (fv && !fv.startsWith(PREFISSO_TESTO)) {
        await scriviImpostazione('firebase_account', cifraTesto(fv));
        logger.info('[Cifratura] Chiave di Firebase cifrata nel database.');
    }
    // I segreti della verifica in due passaggi salvati mentre mancava la chiave.
    const m = await pool.query("SELECT id, mfa_segreto FROM users WHERE mfa_segreto IS NOT NULL AND mfa_segreto NOT LIKE 'enc1:%'");
    for (const u of m.rows) {
        await pool.query('UPDATE users SET mfa_segreto = $2 WHERE id = $1 AND mfa_segreto = $3', [u.id, cifraTesto(u.mfa_segreto), u.mfa_segreto]);
    }
    if (m.rowCount) logger.info(`[Cifratura] Cifrati ${m.rowCount} segreti della verifica in due passaggi.`);
}

// --- File --------------------------------------------------------------------
// Cifra un file al suo posto (scrive accanto e poi rinomina: un'interruzione
// non lascia mezzo file). Senza chiave non fa niente.
export async function cifraFile(percorso) {
    if (!chiave) return false;
    const dati = await fs.promises.readFile(percorso);
    if (eCifrato(dati)) return false;
    const info = await fs.promises.stat(percorso);
    const temporaneo = `${percorso}.cifra-${process.pid}.tmp`;
    await fs.promises.writeFile(temporaneo, cifra(dati), { mode: info.mode & 0o777 });
    await fs.promises.rename(temporaneo, percorso);
    return true;
}

// I file appena caricati e controllati: si cifrano subito. Un errore non fa
// fallire il caricamento: il file resta in chiaro e lo prende il giro orario.
export async function proteggiCaricati(...file) {
    for (const f of file.flat().filter(Boolean)) {
        try {
            await cifraFile(f.path || f);
        } catch (e) {
            logger.error(`[Cifratura] File non cifrato al caricamento (${f.path || f}):`, e);
        }
    }
}

export async function leggiFile(percorso) {
    return decifra(await fs.promises.readFile(percorso));
}

// Al posto di res.sendFile: decifra e manda. Il tag GCM si controlla prima di
// mandare un solo byte, quindi un file alterato non arriva a metà.
export async function inviaFile(res, percorso, { headers = {} } = {}) {
    let dati;
    try {
        dati = await leggiFile(percorso);
    } catch (e) {
        if (e.code === 'ENOENT') return res.status(404).json({ message: 'File non trovato.' });
        if (e instanceof ChiaveNonDisponibile) return res.status(503).json({ message: e.message });
        return res.status(500).json({ message: 'Il file non si legge: è danneggiato o cifrato con un\'altra chiave.' });
    }
    Object.entries(headers).forEach(([k, v]) => res.set(k, v));
    res.type(path.extname(percorso) || 'application/octet-stream');
    res.send(dati);
}

// Il giro: cifra i file rimasti in chiaro (quelli di prima della cifratura, o
// un caricamento non andato a buon fine), lasciando stare gli ultimissimi.
export async function cifraFileInChiaro({ etaMinimaMs = 2 * 60 * 1000 } = {}) {
    if (!chiave) return 0;
    let cifrati = 0;
    const adesso = Date.now();
    const visita = async (cartella) => {
        let voci;
        try { voci = await fs.promises.readdir(cartella, { withFileTypes: true }); } catch { return; }
        for (const v of voci) {
            const p = path.join(cartella, v.name);
            if (v.isDirectory()) { await visita(p); continue; }
            if (!v.isFile() || v.name.endsWith('.tmp')) continue;
            try {
                const info = await fs.promises.stat(p);
                if (adesso - info.mtimeMs < etaMinimaMs) continue;
                const fd = await fs.promises.open(p, 'r');
                const testa = Buffer.alloc(MAGIA.length);
                await fd.read(testa, 0, MAGIA.length, 0);
                await fd.close();
                if (testa.equals(MAGIA)) continue;
                if (await cifraFile(p)) cifrati++;
            } catch (e) {
                logger.error(`[Cifratura] ${p} non cifrato:`, e);
            }
        }
    };
    for (const c of CARTELLE_PROTETTE) await visita(c);
    if (cifrati) logger.info(`[Cifratura] Cifrati ${cifrati} file rimasti in chiaro.`);
    return cifrati;
}

// --- Flussi (i backup) -------------------------------------------------------
export function flussoCifrato() {
    if (!chiave) throw new ChiaveNonDisponibile();
    return flussoCifratoCon(chiave);
}

// Il contenuto di un file (un backup) come flusso, cifrato o no.
export async function apriFile(percorso) {
    if (!chiave && await fileCifrato(percorso)) throw new ChiaveNonDisponibile();
    return apriFileCon(chiave, percorso);
}

export async function fileCifrato(percorso) {
    const fd = await fs.promises.open(percorso, 'r');
    try {
        const testa = Buffer.alloc(MAGIA.length);
        await fd.read(testa, 0, MAGIA.length, 0);
        return testa.equals(MAGIA);
    } finally {
        await fd.close();
    }
}

// --- Il riquadro "Cifratura" della pagina Sistema -----------------------------
export function registraRotteCifratura(app, { soloAdmin, registraAudit }) {
    async function passwordGiusta(req) {
        const r = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        return !!r.rows[0] && typeof req.body?.password === 'string' && await bcrypt.compare(req.body.password, r.rows[0].password);
    }

    app.get('/api/sistema/cifratura', soloAdmin, async (req, res) => {
        try {
            let inChiaro = 0;
            const conta = async (cartella) => {
                let voci;
                try { voci = await fs.promises.readdir(cartella, { withFileTypes: true }); } catch { return; }
                for (const v of voci) {
                    const p = path.join(cartella, v.name);
                    if (v.isDirectory()) await conta(p);
                    else if (v.isFile() && !v.name.endsWith('.tmp') && !(await fileCifrato(p).catch(() => true))) inChiaro++;
                }
            };
            for (const c of CARTELLE_PROTETTE) await conta(c);
            res.json({ stato, recupero_salvato: await recuperoSalvato(), file_in_chiaro: inChiaro, file_chiave: FILE_CHIAVE });
        } catch (e) {
            logger.error('Errore stato cifratura:', e);
            res.status(500).json({ message: 'Errore nel leggere lo stato della cifratura.' });
        }
    });

    // La chiave di recupero si mostra solo con la password di chi la chiede.
    app.post('/api/sistema/cifratura/recupero', soloAdmin, async (req, res) => {
        try {
            if (!(await passwordGiusta(req))) return res.status(403).json({ message: 'Password sbagliata.' });
            const testo = chiaveDiRecupero();
            registraAudit(req, 'cifratura.chiave_recupero_mostrata');
            res.json({ chiave: testo });
        } catch (e) {
            if (e instanceof ChiaveNonDisponibile) return res.status(503).json({ message: e.message });
            logger.error('Errore chiave di recupero:', e);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });

    app.post('/api/sistema/cifratura/recupero-salvato', soloAdmin, async (req, res) => {
        await segnaRecuperoSalvato();
        registraAudit(req, 'cifratura.chiave_recupero_conservata');
        res.json({ message: 'Bene: ORION non lo chiederà più.' });
    });

    // Rimettere la chiave (macchina nuova, file perso, ripristino da un'altra installazione).
    app.post('/api/sistema/cifratura/chiave', soloAdmin, async (req, res) => {
        try {
            if (!(await passwordGiusta(req))) return res.status(403).json({ message: 'Password sbagliata.' });
            const esito = await inserisciChiaveDiRecupero(req.body?.chiave);
            registraAudit(req, 'cifratura.chiave_inserita', { dettagli: { ok: esito.ok } });
            if (!esito.ok) return res.status(400).json({ message: esito.message });
            cifraFileInChiaro().catch(() => {});
            res.json(esito);
        } catch (e) {
            logger.error('Errore inserimento chiave:', e);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });
}
