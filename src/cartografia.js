// La cartografia del territorio sul server. Le mappe di OpenStreetMap e il
// satellite arrivano da internet: se in sala la linea cade ma la rete locale
// verso il server regge (o il server è in sala), la mappa resta grigia.
// L'associazione può caricare una volta la cartografia del proprio territorio
// in un file MBTiles (preparato con QGIS, "Genera tasselli raster XYZ", o
// scaricato da chi la distribuisce con licenza che lo permette: i server di
// OpenStreetMap non consentono di scaricarne in blocco), e il server la dà
// alle mappe come un livello qualsiasi.
//
// Il file è un database SQLite: si legge con node:sqlite, in sola lettura.
// Arriva a pezzi da 32 MB, così passa anche dal limite di nginx e una linea
// lenta non deve ricominciare da capo un file di un giga.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { richiedePermesso } from './permessi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CARTELLA_CARTOGRAFIA = process.env.ORION_CARTOGRAFIA_DIR || path.join(__dirname, '..', 'protected_uploads', 'cartografia');
const FILE = () => path.join(CARTELLA_CARTOGRAFIA, 'territorio.mbtiles');
const INFO = () => path.join(CARTELLA_CARTOGRAFIA, 'territorio.json');

const PEZZO_MASSIMO = 32 * 1024 * 1024;
const DIMENSIONE_MASSIMA = Number(process.env.ORION_CARTOGRAFIA_MAX_MB || 4096) * 1024 * 1024;
const FORMATI = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const CARICAMENTO_SCADE_MS = 6 * 3600 * 1000;

let sqlite = null;
async function moduloSqlite() {
    if (sqlite) return sqlite;
    try {
        sqlite = await import('node:sqlite');
    } catch {
        sqlite = false;
    }
    return sqlite;
}

/**
 * Apre un MBTiles e ne legge quello che serve; un errore leggibile se non va.
 * Solo raster: i tasselli vettoriali (pbf) servirebbero un motore di stile.
 */
export async function leggiMbtiles(file) {
    const modulo = await moduloSqlite();
    if (!modulo) throw new Error('Questo server non sa leggere i file MBTiles: serve Node.js 22.13 o più recente.');
    // I primi 16 byte di un database SQLite sono sempre questi.
    const testa = Buffer.alloc(16);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, testa, 0, 16, 0); } finally { fs.closeSync(fd); }
    if (testa.toString('latin1') !== 'SQLite format 3\u0000') {
        throw new Error('Il file non è un MBTiles leggibile (non è un database SQLite).');
    }
    let db;
    try {
        db = new modulo.DatabaseSync(file, { readOnly: true });
    } catch {
        throw new Error('Il file non è un MBTiles leggibile (non è un database SQLite).');
    }
    try {
        const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map(r => r.name);
        if (!tabelle.includes('tiles') || !tabelle.includes('metadata')) {
            throw new Error('Il file non è un MBTiles: mancano le tabelle "tiles" e "metadata".');
        }
        const meta = Object.fromEntries(db.prepare('SELECT name, value FROM metadata').all().map(r => [String(r.name).toLowerCase(), r.value]));
        let formato = String(meta.format || '').toLowerCase();
        const primo = db.prepare('SELECT tile_data FROM tiles LIMIT 1').get();
        if (!primo) throw new Error('Il file non contiene tasselli.');
        if (!formato) formato = formatoDai(primo.tile_data);
        if (formato === 'pbf' || formato === 'mvt') {
            throw new Error('Il file contiene tasselli vettoriali (pbf): servono tasselli raster, PNG, JPG o WEBP. In QGIS: "Genera tasselli raster XYZ (MBTiles)".');
        }
        if (!FORMATI[formato]) throw new Error(`Formato dei tasselli non gestito: "${formato || 'sconosciuto'}". Servono PNG, JPG o WEBP.`);
        const zoom = db.prepare('SELECT MIN(zoom_level) AS minimo, MAX(zoom_level) AS massimo, COUNT(*) AS quanti FROM tiles').get();
        let limiti = null;
        if (meta.bounds) {
            const b = String(meta.bounds).split(',').map(Number);
            if (b.length === 4 && b.every(Number.isFinite)) limiti = b; // ovest, sud, est, nord
        }
        return {
            nome: meta.name || null,
            descrizione: meta.description || null,
            attribuzione: meta.attribution || null,
            formato,
            zoom_minimo: Number(zoom.minimo),
            zoom_massimo: Number(zoom.massimo),
            tasselli: Number(zoom.quanti),
            limiti
        };
    } finally {
        db.close();
    }
}

function formatoDai(byte) {
    if (!byte || byte.length < 4) return '';
    if (byte[0] === 0x89 && byte[1] === 0x50) return 'png';
    if (byte[0] === 0xff && byte[1] === 0xd8) return 'jpg';
    if (byte[0] === 0x52 && byte[1] === 0x49 && byte[8] === 0x57) return 'webp';
    if (byte[0] === 0x1f && byte[1] === 0x8b) return 'pbf';
    return '';
}

export function registraRotteCartografia(app, { logger, registraAudit }) {
    let db = null;        // il file aperto, per servire i tasselli
    let info = null;      // quello che se ne sa
    let tasselloPrep = null;
    const caricamenti = new Map(); // id -> { utente, file, pezzi, byte, inizio }

    async function apri() {
        chiudi();
        try {
            if (!fs.existsSync(FILE())) return;
            info = JSON.parse(fs.readFileSync(INFO(), 'utf8'));
            const modulo = await moduloSqlite();
            if (!modulo) {
                logger.warn('[Cartografia] node:sqlite non disponibile: la cartografia del territorio non si serve.');
                return;
            }
            db = new modulo.DatabaseSync(FILE(), { readOnly: true });
            tasselloPrep = db.prepare('SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?');
        } catch (e) {
            logger.error('[Cartografia] File del territorio non leggibile:', { error: e.message });
            chiudi();
        }
    }
    function chiudi() {
        try { db?.close(); } catch { /* già chiuso */ }
        db = null;
        tasselloPrep = null;
        info = null;
    }
    apri();

    // Caricamenti lasciati a metà: via i pezzi.
    setInterval(() => {
        const ora = Date.now();
        for (const [id, c] of caricamenti) {
            if (ora - c.ultimo > CARICAMENTO_SCADE_MS) {
                fs.rm(c.file, { force: true }, () => {});
                caricamenti.delete(id);
            }
        }
    }, 3600 * 1000).unref();

    app.get('/api/mappa/cartografia', (req, res) => {
        if (!db || !info) return res.json({ presente: false });
        res.json({ presente: true, ...info, url: '/api/mappa/cartografia/{z}/{x}/{y}' });
    });

    app.get('/api/mappa/cartografia/:z/:x/:y', (req, res) => {
        if (!tasselloPrep) return res.status(404).end();
        const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
        if (!Number.isInteger(z) || z < 0 || z > 24) return res.status(400).end();
        // MBTiles numera le righe dal basso (TMS), le mappe dall'alto (XYZ).
        const riga = (2 ** z) - 1 - y;
        try {
            const t = tasselloPrep.get(z, x, riga);
            if (!t) return res.status(404).end();
            res.set('Content-Type', FORMATI[info.formato] || 'application/octet-stream');
            res.set('Cache-Control', 'private, max-age=604800');
            res.send(Buffer.from(t.tile_data));
        } catch (e) {
            logger.error('[Cartografia] Tassello non letto:', { error: e.message });
            res.status(500).end();
        }
    });

    // Un pezzo del file: in ordine, n = 0, 1, 2...
    app.post('/api/mappa/cartografia/pezzi', richiedePermesso('emergenze.piano'), (req, res) => {
        let id = typeof req.query.id === 'string' ? req.query.id : '';
        const n = Number(req.query.n);
        if (!Number.isInteger(n) || n < 0) return res.status(400).json({ message: 'Numero del pezzo non valido.' });
        if (n === 0) {
            fs.mkdirSync(CARTELLA_CARTOGRAFIA, { recursive: true });
            id = crypto.randomUUID();
            caricamenti.set(id, { utente: req.user.id, file: path.join(CARTELLA_CARTOGRAFIA, `caricamento-${id}.part`), pezzi: 0, byte: 0, ultimo: Date.now() });
        }
        const c = caricamenti.get(id);
        if (!c || c.utente !== req.user.id) return res.status(404).json({ message: 'Caricamento non trovato: ricomincia da capo.' });
        // Il pezzo già arrivato (la risposta si era persa): va bene così.
        if (n === c.pezzi - 1) return res.json({ id, pezzi: c.pezzi, byte: c.byte });
        if (n !== c.pezzi) return res.status(409).json({ message: `Aspettavo il pezzo ${c.pezzi}, è arrivato il ${n}.`, pezzi: c.pezzi });
        const chunks = [];
        let letti = 0;
        let troppo = false;
        req.on('data', (d) => {
            letti += d.length;
            if (letti > PEZZO_MASSIMO || c.byte + letti > DIMENSIONE_MASSIMA) { troppo = true; return; }
            chunks.push(d);
        });
        req.on('end', () => {
            if (troppo) {
                return res.status(413).json({ message: `File troppo grande: al massimo ${Math.round(DIMENSIONE_MASSIMA / 1048576)} MB, a pezzi da ${PEZZO_MASSIMO / 1048576} MB.` });
            }
            if (!letti) return res.status(400).json({ message: 'Pezzo vuoto.' });
            fs.appendFile(c.file, Buffer.concat(chunks), (err) => {
                if (err) {
                    logger.error('[Cartografia] Pezzo non salvato:', { error: err.message });
                    return res.status(500).json({ message: 'Pezzo non salvato sul server (spazio su disco?).' });
                }
                c.pezzi++;
                c.byte += letti;
                c.ultimo = Date.now();
                res.json({ id, pezzi: c.pezzi, byte: c.byte });
            });
        });
        req.on('error', () => { /* connessione caduta: si rimanda lo stesso pezzo */ });
    });

    // Tutti i pezzi arrivati: si controlla il file e prende il posto del vecchio.
    app.post('/api/mappa/cartografia/fine', richiedePermesso('emergenze.piano'), async (req, res) => {
        const id = req.body?.id;
        const c = caricamenti.get(id);
        if (!c || c.utente !== req.user.id) return res.status(404).json({ message: 'Caricamento non trovato: ricomincia da capo.' });
        if (Number(req.body?.byte) !== c.byte) {
            return res.status(400).json({ message: `Il file è arrivato a metà (${c.byte} byte su ${req.body?.byte}): ricomincia.` });
        }
        caricamenti.delete(id);
        let letto;
        try {
            letto = await leggiMbtiles(c.file);
        } catch (e) {
            fs.rm(c.file, { force: true }, () => {});
            return res.status(400).json({ message: e.message });
        }
        try {
            const dati = {
                ...letto,
                file_originale: typeof req.body?.nome === 'string' ? req.body.nome.slice(0, 200) : null,
                dimensione: c.byte,
                caricata_il: new Date().toISOString(),
                caricata_da: req.user.username
            };
            chiudi();
            fs.renameSync(c.file, FILE());
            fs.writeFileSync(INFO(), JSON.stringify(dati, null, 2));
            await apri();
            registraAudit(req, 'mappa.cartografia_caricata', { tipo: 'cartografia', dettagli: {
                nome: dati.nome, file: dati.file_originale, dimensione: dati.dimensione, zoom: [dati.zoom_minimo, dati.zoom_massimo], tasselli: dati.tasselli } });
            res.json({ presente: true, ...dati });
        } catch (e) {
            logger.error('[Cartografia] File non messo al suo posto:', { error: e.message });
            fs.rm(c.file, { force: true }, () => {});
            await apri();
            res.status(500).json({ message: 'Cartografia non salvata sul server.' });
        }
    });

    app.delete('/api/mappa/cartografia', richiedePermesso('emergenze.piano'), (req, res) => {
        const prima = info;
        chiudi();
        fs.rmSync(FILE(), { force: true });
        fs.rmSync(INFO(), { force: true });
        registraAudit(req, 'mappa.cartografia_tolta', { tipo: 'cartografia', dettagli: { nome: prima?.nome || null } });
        res.json({ presente: false });
    });
}
