// L'archivio dei documenti del gruppo: il piano di protezione civile, le
// procedure, i libretti d'uso e manutenzione, i moduli, i verbali.
//
// Li consultano tutti gli interni (dal web e dall'app); un documento si può
// riservare a certi ruoli. Gli esterni vedono solo quelli segnati come
// consultabili in emergenza, e solo mentre un'emergenza è aperta. Caricare,
// ordinare, sostituire e togliere è di chi ha il permesso gruppo.documenti.
//
// Ogni documento ha le sue versioni: caricarne una nuova conserva le vecchie,
// che restano consultabili. I file stanno in protected_uploads, cifrati come
// gli altri caricati, e finiscono nei backup: per questo c'è un tetto alla
// dimensione. L'impronta è quella del file in chiaro: il telefono la usa per
// sapere se la copia che tiene è ancora l'ultima. Un documento si collega ai
// beni del magazzino (il libretto della motosega), e dalla scheda del bene si apre.

import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileTypeFromFile } from 'file-type';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { nomeUtente, ruoliDi } from './autenticazione.js';
import { inviaFile, proteggiCaricati } from './cifratura.js';
import { pool } from './db.js';
import { haPermesso, richiedePermesso } from './permessi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const cartellaDocumenti = path.join(__dirname, '..', 'protected_uploads', 'documenti-gruppo');
fs.mkdirSync(cartellaDocumenti, { recursive: true });

// Un file al massimo così: finisce in ogni backup.
export const MB_MASSIMI = 25;
const LIMITE_TESTI = { titolo: 200, descrizione: 2000, nota: 500, cartella: 100 };
const RUOLI_RISERVABILI = ['admin', 'coordinatore', 'segreteria', 'magazziniere', 'volontario'];

// I formati ammessi, per estensione, con il tipo che ci si aspetta di
// riconoscere dal contenuto (null: testo semplice, senza firma).
export const FORMATI = {
    '.pdf': ['application/pdf'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'],
    '.doc': ['application/x-cfb'], '.xls': ['application/x-cfb'], '.ppt': ['application/x-cfb'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
    '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'],
    '.odt': ['application/vnd.oasis.opendocument.text', 'application/zip'],
    '.ods': ['application/vnd.oasis.opendocument.spreadsheet', 'application/zip'],
    '.odp': ['application/vnd.oasis.opendocument.presentation', 'application/zip'],
    '.txt': null
};
export const TIPO_DA_ESTENSIONE = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.odp': 'application/vnd.oasis.opendocument.presentation', '.txt': 'text/plain'
};

const carica = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, cartellaDocumenti),
        filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: MB_MASSIMI * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (Object.hasOwn(FORMATI, path.extname(file.originalname).toLowerCase())) return cb(null, true);
        req.erroreFile = 'Formato non ammesso: PDF, immagini (JPG, PNG, WEBP), Word, Excel, PowerPoint, OpenDocument o testo.';
        return cb(null, false);
    }
}).single('file');

// Il caricamento con i suoi errori detti chiaramente.
function caricaFile(req, res, next) {
    carica(req, res, (errore) => {
        if (errore?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: `Il file supera i ${MB_MASSIMI} MB.` });
        if (errore) return res.status(400).json({ message: 'Caricamento non riuscito.' });
        if (req.erroreFile) return res.status(400).json({ message: req.erroreFile });
        next();
    });
}

function togliFile(nome) {
    if (!nome) return;
    fs.promises.unlink(path.join(cartellaDocumenti, path.basename(nome))).catch(() => {});
}

// Il contenuto deve essere quello che l'estensione dice.
export async function contenutoValido(file) {
    const attesi = FORMATI[path.extname(file.originalname).toLowerCase()];
    const trovato = await fileTypeFromFile(file.path).catch(() => null);
    if (attesi === null) return !trovato;
    return !!trovato && attesi.includes(trovato.mime);
}

async function impronta(percorso) {
    const hash = crypto.createHash('sha256');
    for await (const pezzo of fs.createReadStream(percorso)) hash.update(pezzo);
    return hash.digest('hex');
}

function testo(valore, massimo) {
    if (valore === undefined || valore === null) return null;
    const t = String(valore).trim();
    return t ? t.slice(0, massimo) : null;
}

function vero(valore) {
    return valore === true || valore === 'true' || valore === '1' || valore === 'on';
}

// I campi del documento da una richiesta (JSON o modulo con il file).
function leggiCampi(corpo) {
    const ruoli = (() => {
        const grezzi = Array.isArray(corpo.ruoli) ? corpo.ruoli
            : typeof corpo.ruoli === 'string' && corpo.ruoli.trim() ? corpo.ruoli.split(',') : [];
        return [...new Set(grezzi.map(r => String(r).trim()))].filter(r => RUOLI_RISERVABILI.includes(r));
    })();
    const visibilita = corpo.visibilita === 'ruoli' && ruoli.length ? 'ruoli' : 'interni';
    const cartella = corpo.cartella_id === undefined || corpo.cartella_id === '' || corpo.cartella_id === null ? null : parseInt(corpo.cartella_id, 10);
    return {
        titolo: testo(corpo.titolo, LIMITE_TESTI.titolo),
        descrizione: testo(corpo.descrizione, LIMITE_TESTI.descrizione),
        cartella_id: Number.isInteger(cartella) ? cartella : null,
        visibilita,
        ruoli: visibilita === 'ruoli' ? ruoli : [],
        in_emergenza: vero(corpo.in_emergenza),
        sempre_con_me: vero(corpo.sempre_con_me)
    };
}

// Chi vede un documento.
export function puoVedere(req, documento, emergenzaAperta) {
    if (haPermesso(req, 'gruppo.documenti')) return true;
    const ruoli = ruoliDi(req.user);
    if (ruoli.includes('esterno')) return documento.in_emergenza === true && !!emergenzaAperta;
    if (documento.visibilita !== 'ruoli') return true;
    return ruoli.includes('admin') || (documento.ruoli || []).some(r => ruoli.includes(r));
}

const SELECT_DOCUMENTI = `
    SELECT d.id, d.cartella_id, d.titolo, d.descrizione, d.visibilita, d.ruoli, d.in_emergenza, d.sempre_con_me,
           d.creato_il, d.aggiornato_il,
           v.numero AS versione, v.nome_originale, v.tipo, v.dimensione::int AS dimensione, v.impronta, v.caricato_il, v.caricato_da_nome,
           (SELECT COUNT(*)::int FROM documenti_versioni x WHERE x.documento_id = d.id) AS versioni,
           COALESCE((SELECT json_agg(json_build_object('id', b.id, 'denominazione', b.denominazione, 'matricola', b.matricola) ORDER BY b.denominazione)
                       FROM documenti_beni db JOIN beni b ON b.id = db.bene_id WHERE db.documento_id = d.id), '[]') AS beni
      FROM documenti d
      JOIN LATERAL (SELECT * FROM documenti_versioni v WHERE v.documento_id = d.id ORDER BY v.numero DESC LIMIT 1) v ON true`;

// Collega un documento a un bene e, con [simili], agli altri beni dello stesso
// tipo e con la stessa denominazione ancora in servizio. Ritorna gli id collegati.
async function collegaBeni(esecutore, documentoId, beneId, simili) {
    const r = await esecutore.query(
        `INSERT INTO documenti_beni (documento_id, bene_id)
         SELECT $1, b.id FROM beni b, beni o
          WHERE o.id = $2 AND EXISTS (SELECT 1 FROM documenti WHERE id = $1)
            AND (b.id = o.id OR ($3::boolean AND b.tipo = o.tipo AND LOWER(b.denominazione) = LOWER(o.denominazione) AND b.dismesso_il IS NULL))
         ON CONFLICT DO NOTHING RETURNING bene_id`, [documentoId, beneId, simili === true]);
    // Anche quelli già collegati contano come collegati.
    if (r.rowCount) return r.rows.map(x => x.bene_id);
    const gia = await esecutore.query('SELECT bene_id FROM documenti_beni WHERE documento_id = $1 AND bene_id = $2', [documentoId, beneId]);
    return gia.rows.map(x => x.bene_id);
}

// Gli id dei beni che una persona ha in carico adesso, a sé o alla sua
// squadra: i pezzi singoli dalla situazione dei beni, gli sfusi dal saldo
// delle detenzioni (come beniInCarico in magazzino.js).
async function beniDi(utente) {
    if (!utente?.id) return new Set();
    try {
        const r = await pool.query(`
            WITH mie_squadre AS (
                SELECT sm.squadra_id FROM squadra_membri sm WHERE sm.username = $2
            )
            SELECT s.bene_id FROM beni_situazione s JOIN beni b ON b.id = s.bene_id
             WHERE b.dismesso_il IS NULL AND b.gestione = 'singolo'
               AND ((s.destinatario_tipo = 'persona' AND s.destinatario_user_id = $1)
                 OR (s.destinatario_tipo = 'squadra' AND s.destinatario_squadra_id IN (SELECT squadra_id FROM mie_squadre)))
            UNION
            SELECT d.bene_id FROM detenzioni_sfusi d JOIN beni b ON b.id = d.bene_id
             WHERE b.dismesso_il IS NULL AND b.gestione = 'quantita'
               AND ((d.detentore_tipo = 'persona' AND d.user_id = $1)
                 OR (d.detentore_tipo = 'squadra' AND d.squadra_id IN (SELECT squadra_id FROM mie_squadre)))
             GROUP BY d.bene_id, d.detentore_tipo, d.user_id, d.squadra_id
            HAVING SUM(d.variazione) > 0`, [utente.id, utente.username]);
        return new Set(r.rows.map(x => x.bene_id));
    } catch (e) {
        logger.warn('[Documenti] Beni in carico non letti:', { error: e.message });
        return new Set();
    }
}

export function registraRotteDocumenti(app, { emergenzaAttiva }) {
    const gestione = richiedePermesso('gruppo.documenti');

    async function leggiDocumento(id) {
        const r = await pool.query(`${SELECT_DOCUMENTI} WHERE d.id = $1`, [id]);
        return r.rows[0] || null;
    }

    // L'archivio, per quello che chi chiede può vedere. Con ?bene=ID solo i
    // documenti collegati a quel bene.
    app.get('/api/documenti', async (req, res) => {
        try {
            const bene = req.query.bene ? parseInt(req.query.bene, 10) : null;
            if (req.query.bene && !Number.isInteger(bene)) return res.status(400).json({ message: 'Bene non valido.' });
            const [cartelle, documenti] = await Promise.all([
                pool.query('SELECT id, nome, descrizione, ordine FROM documenti_cartelle ORDER BY ordine, nome'),
                pool.query(`${SELECT_DOCUMENTI}
                    WHERE ($1::int IS NULL OR EXISTS (SELECT 1 FROM documenti_beni db WHERE db.documento_id = d.id AND db.bene_id = $1))
                    ORDER BY d.titolo`, [bene])
            ]);
            const aperta = !!emergenzaAttiva();
            // I libretti di quello che la persona ha in carico (lei o la sua
            // squadra): l'app li tiene sul telefono finché lo ha.
            const mieiBeni = await beniDi(req.user);
            const visibili = documenti.rows.filter(d => puoVedere(req, d, aperta))
                .map(d => ({ ...d, in_carico: d.beni.some(b => mieiBeni.has(b.id)) }));
            const gestisce = haPermesso(req, 'gruppo.documenti');
            const esterno = ruoliDi(req.user).includes('esterno');
            res.json({
                cartelle: esterno ? cartelle.rows.filter(c => visibili.some(d => d.cartella_id === c.id)) : cartelle.rows,
                documenti: visibili,
                gestisce,
                mb_massimi: MB_MASSIMI,
                // Quanto pesa l'archivio nei backup, per chi lo tiene.
                byte_totali: gestisce ? Number((await pool.query('SELECT COALESCE(SUM(dimensione), 0) AS n FROM documenti_versioni')).rows[0].n) : undefined
            });
        } catch (e) {
            logger.error('Errore GET /api/documenti:', e);
            res.status(500).json({ message: "Errore nel leggere l'archivio dei documenti." });
        }
    });

    app.get('/api/documenti/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Documento non valido.' });
        try {
            const documento = await leggiDocumento(id);
            if (!documento || !puoVedere(req, documento, !!emergenzaAttiva())) return res.status(404).json({ message: 'Documento non trovato.' });
            const versioni = await pool.query(
                `SELECT numero, nome_originale, tipo, dimensione::int AS dimensione, impronta, nota, caricato_il, caricato_da_nome
                   FROM documenti_versioni WHERE documento_id = $1 ORDER BY numero DESC`, [id]);
            res.json({ ...documento, storico: versioni.rows });
        } catch (e) {
            logger.error('Errore GET /api/documenti/:id:', e);
            res.status(500).json({ message: 'Errore nel leggere il documento.' });
        }
    });

    // Il file: l'ultima versione, o quella chiesta con ?versione=N.
    app.get('/api/documenti/:id/file', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const numero = req.query.versione ? parseInt(req.query.versione, 10) : null;
        if (!Number.isInteger(id) || (req.query.versione && !Number.isInteger(numero))) return res.status(400).json({ message: 'Richiesta non valida.' });
        try {
            const documento = await leggiDocumento(id);
            if (!documento || !puoVedere(req, documento, !!emergenzaAttiva())) return res.status(404).json({ message: 'Documento non trovato.' });
            const v = (await pool.query(
                `SELECT file, nome_originale, tipo FROM documenti_versioni WHERE documento_id = $1 AND ($2::int IS NULL OR numero = $2)
                  ORDER BY numero DESC LIMIT 1`, [id, numero])).rows[0];
            if (!v) return res.status(404).json({ message: 'Versione non trovata.' });
            const percorso = path.join(cartellaDocumenti, path.basename(v.file));
            if (!fs.existsSync(percorso)) return res.status(404).json({ message: 'Il file non è più sul server.' });
            // PDF e immagini si aprono nel browser; il resto si scarica.
            const inLinea = v.tipo === 'application/pdf' || v.tipo.startsWith('image/');
            await inviaFile(res, percorso, { headers: {
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'private, no-store',
                'Content-Disposition': `${inLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(v.nome_originale)}`
            } });
        } catch (e) {
            logger.error('Errore GET /api/documenti/:id/file:', e);
            if (!res.headersSent) res.status(500).json({ message: 'Errore nel leggere il file.' });
        }
    });

    // Un documento nuovo, con il suo primo file.
    app.post('/api/documenti', gestione, caricaFile, async (req, res) => {
        if (!req.file) return res.status(400).json({ message: 'Scegli il file da caricare.' });
        const campi = leggiCampi(req.body || {});
        if (!campi.titolo) { togliFile(req.file.filename); return res.status(400).json({ message: 'Serve un titolo.' }); }
        if (!(await contenutoValido(req.file))) {
            togliFile(req.file.filename);
            return res.status(400).json({ message: 'Il contenuto del file non corrisponde al formato del suo nome.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const d = await client.query(
                `INSERT INTO documenti (cartella_id, titolo, descrizione, visibilita, ruoli, in_emergenza, sempre_con_me, creato_da)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
                [campi.cartella_id, campi.titolo, campi.descrizione, campi.visibilita, campi.ruoli, campi.in_emergenza, campi.sempre_con_me, req.user.id]);
            const id = d.rows[0].id;
            await aggiungiVersione(client, id, 1, req);
            await client.query('COMMIT');
            await proteggiCaricati(req.file);
            registraAudit(req, 'documento.caricato', { tipo: 'documento', id, dettagli: { titolo: campi.titolo, file: req.file.originalname } });
            res.status(201).json(await leggiDocumento(id));
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            togliFile(req.file.filename);
            if (e.code === '23503') return res.status(400).json({ message: 'Cartella inesistente.' });
            logger.error('Errore POST /api/documenti:', e);
            res.status(500).json({ message: 'Errore nel salvare il documento.' });
        } finally {
            client.release();
        }
    });

    async function aggiungiVersione(client, id, numero, req) {
        const estensione = path.extname(req.file.originalname).toLowerCase();
        await client.query(
            `INSERT INTO documenti_versioni (documento_id, numero, file, nome_originale, tipo, dimensione, impronta, nota, caricato_da, caricato_da_nome)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [id, numero, req.file.filename, req.file.originalname.slice(0, 200), TIPO_DA_ESTENSIONE[estensione] || 'application/octet-stream',
             req.file.size, await impronta(req.file.path), testo(req.body?.nota, LIMITE_TESTI.nota), req.user.id, nomeUtente(req.user)]);
    }

    // Una versione nuova: le vecchie restano.
    app.post('/api/documenti/:id/versioni', gestione, caricaFile, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!req.file) return res.status(400).json({ message: 'Scegli il file da caricare.' });
        if (!Number.isInteger(id)) { togliFile(req.file.filename); return res.status(400).json({ message: 'Documento non valido.' }); }
        if (!(await contenutoValido(req.file))) {
            togliFile(req.file.filename);
            return res.status(400).json({ message: 'Il contenuto del file non corrisponde al formato del suo nome.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const esiste = await client.query('SELECT id FROM documenti WHERE id = $1 FOR UPDATE', [id]);
            if (!esiste.rowCount) {
                await client.query('ROLLBACK');
                togliFile(req.file.filename);
                return res.status(404).json({ message: 'Documento non trovato.' });
            }
            const numero = (await client.query('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM documenti_versioni WHERE documento_id = $1', [id])).rows[0].n;
            await aggiungiVersione(client, id, numero, req);
            await client.query('UPDATE documenti SET aggiornato_il = NOW() WHERE id = $1', [id]);
            await client.query('COMMIT');
            await proteggiCaricati(req.file);
            registraAudit(req, 'documento.nuova_versione', { tipo: 'documento', id, dettagli: { versione: numero, file: req.file.originalname } });
            res.status(201).json(await leggiDocumento(id));
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            togliFile(req.file.filename);
            logger.error('Errore POST /api/documenti/:id/versioni:', e);
            res.status(500).json({ message: 'Errore nel salvare la versione.' });
        } finally {
            client.release();
        }
    });

    app.put('/api/documenti/:id', gestione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Documento non valido.' });
        const campi = leggiCampi(req.body || {});
        if (!campi.titolo) return res.status(400).json({ message: 'Serve un titolo.' });
        try {
            const r = await pool.query(
                `UPDATE documenti SET cartella_id = $2, titolo = $3, descrizione = $4, visibilita = $5, ruoli = $6,
                        in_emergenza = $7, sempre_con_me = $8, aggiornato_il = NOW()
                  WHERE id = $1`,
                [id, campi.cartella_id, campi.titolo, campi.descrizione, campi.visibilita, campi.ruoli, campi.in_emergenza, campi.sempre_con_me]);
            if (!r.rowCount) return res.status(404).json({ message: 'Documento non trovato.' });
            registraAudit(req, 'documento.modificato', { tipo: 'documento', id, dettagli: campi });
            res.json(await leggiDocumento(id));
        } catch (e) {
            if (e.code === '23503') return res.status(400).json({ message: 'Cartella inesistente.' });
            logger.error('Errore PUT /api/documenti/:id:', e);
            res.status(500).json({ message: 'Errore nel salvare il documento.' });
        }
    });

    // Via il documento con tutte le sue versioni e i loro file.
    app.delete('/api/documenti/:id', gestione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Documento non valido.' });
        try {
            const file = (await pool.query('SELECT file FROM documenti_versioni WHERE documento_id = $1', [id])).rows.map(r => r.file);
            const r = await pool.query('DELETE FROM documenti WHERE id = $1 RETURNING titolo', [id]);
            if (!r.rowCount) return res.status(404).json({ message: 'Documento non trovato.' });
            file.forEach(togliFile);
            registraAudit(req, 'documento.eliminato', { tipo: 'documento', id, dettagli: { titolo: r.rows[0].titolo, versioni: file.length } });
            res.json({ message: 'Documento tolto dall\'archivio.' });
        } catch (e) {
            logger.error('Errore DELETE /api/documenti/:id:', e);
            res.status(500).json({ message: 'Errore nel togliere il documento.' });
        }
    });

    // Le cartelle.
    app.post('/api/documenti-cartelle', gestione, async (req, res) => {
        const nome = testo(req.body?.nome, LIMITE_TESTI.cartella);
        if (!nome) return res.status(400).json({ message: 'Serve un nome.' });
        try {
            const r = await pool.query(
                `INSERT INTO documenti_cartelle (nome, descrizione, ordine)
                 VALUES ($1, $2, (SELECT COALESCE(MAX(ordine), 0) + 1 FROM documenti_cartelle)) RETURNING id, nome, descrizione, ordine`,
                [nome, testo(req.body?.descrizione, LIMITE_TESTI.descrizione)]);
            registraAudit(req, 'documenti.cartella_creata', { tipo: 'cartella', id: r.rows[0].id, dettagli: { nome } });
            res.status(201).json(r.rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ message: 'Una cartella con questo nome c\'è già.' });
            logger.error('Errore POST /api/documenti-cartelle:', e);
            res.status(500).json({ message: 'Errore nel creare la cartella.' });
        }
    });

    app.put('/api/documenti-cartelle/:id', gestione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const nome = testo(req.body?.nome, LIMITE_TESTI.cartella);
        if (!Number.isInteger(id) || !nome) return res.status(400).json({ message: 'Serve un nome.' });
        try {
            const r = await pool.query('UPDATE documenti_cartelle SET nome = $2, descrizione = $3 WHERE id = $1 RETURNING id, nome, descrizione, ordine',
                [id, nome, testo(req.body?.descrizione, LIMITE_TESTI.descrizione)]);
            if (!r.rowCount) return res.status(404).json({ message: 'Cartella non trovata.' });
            res.json(r.rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ message: 'Una cartella con questo nome c\'è già.' });
            logger.error('Errore PUT /api/documenti-cartelle:', e);
            res.status(500).json({ message: 'Errore nel salvare la cartella.' });
        }
    });

    // Si toglie solo vuota: i documenti non spariscono per sbaglio.
    app.delete('/api/documenti-cartelle/:id', gestione, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Cartella non valida.' });
        try {
            const dentro = (await pool.query('SELECT COUNT(*)::int AS n FROM documenti WHERE cartella_id = $1', [id])).rows[0].n;
            if (dentro) return res.status(409).json({ message: `Nella cartella ci sono ${dentro} documenti: spostali prima di toglierla.` });
            const r = await pool.query('DELETE FROM documenti_cartelle WHERE id = $1 RETURNING nome', [id]);
            if (!r.rowCount) return res.status(404).json({ message: 'Cartella non trovata.' });
            registraAudit(req, 'documenti.cartella_tolta', { tipo: 'cartella', id, dettagli: { nome: r.rows[0].nome } });
            res.json({ message: 'Cartella tolta.' });
        } catch (e) {
            logger.error('Errore DELETE /api/documenti-cartelle:', e);
            res.status(500).json({ message: 'Errore nel togliere la cartella.' });
        }
    });

    // Il collegamento ai beni del magazzino: lo fa chi tiene l'archivio o il magazzino.
    const collega = richiedePermesso('gruppo.documenti', 'magazzino.gestione');
    // [simili]: anche agli altri beni uguali (stesso tipo e stessa
    // denominazione, non dismessi): le dieci radio dello stesso modello hanno
    // lo stesso libretto.
    app.post('/api/documenti/:id/beni', collega, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const bene = parseInt(req.body?.bene_id, 10);
        if (!Number.isInteger(id) || !Number.isInteger(bene)) return res.status(400).json({ message: 'Documento o bene non validi.' });
        try {
            const collegati = await collegaBeni(pool, id, bene, req.body?.simili === true);
            if (!collegati.length) return res.status(404).json({ message: 'Documento o bene inesistenti.' });
            registraAudit(req, 'documento.collegato', { tipo: 'documento', id, dettagli: { bene_id: bene, beni: collegati.length } });
            res.status(201).json({ ...(await leggiDocumento(id)), collegati: collegati.length });
        } catch (e) {
            if (e.code === '23503') return res.status(404).json({ message: 'Documento o bene inesistenti.' });
            logger.error('Errore POST /api/documenti/:id/beni:', e);
            res.status(500).json({ message: 'Errore nel collegare il documento.' });
        }
    });

    // Il libretto di un bene caricato dalla sua scheda, senza passare
    // dall'archivio: un documento nuovo nella cartella dei libretti (creata la
    // prima volta), per tutti gli interni, collegato al bene (e se si vuole ai
    // beni uguali). Lo fa chi tiene l'archivio o il magazzino.
    app.post('/api/magazzino/beni/:id/libretto', collega, caricaFile, async (req, res) => {
        const bene = parseInt(req.params.id, 10);
        if (!req.file) return res.status(400).json({ message: 'Scegli il file del libretto.' });
        if (!Number.isInteger(bene)) { togliFile(req.file.filename); return res.status(400).json({ message: 'Bene non valido.' }); }
        if (!(await contenutoValido(req.file))) {
            togliFile(req.file.filename);
            return res.status(400).json({ message: 'Il contenuto del file non corrisponde al formato del suo nome.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const b = (await client.query('SELECT id, denominazione, matricola FROM beni WHERE id = $1', [bene])).rows[0];
            if (!b) { await client.query('ROLLBACK'); togliFile(req.file.filename); return res.status(404).json({ message: 'Bene inesistente.' }); }
            let cartella = (await client.query(`SELECT id FROM documenti_cartelle WHERE nome ILIKE 'Libretti%' ORDER BY id LIMIT 1`)).rows[0]?.id;
            if (!cartella) {
                cartella = (await client.query(
                    `INSERT INTO documenti_cartelle (nome, descrizione, ordine)
                     VALUES ('Libretti d''uso e manutenzione', 'I libretti di attrezzature e mezzi: si aprono anche dalla scheda del bene.',
                             (SELECT COALESCE(MAX(ordine), 0) + 1 FROM documenti_cartelle)) RETURNING id`)).rows[0].id;
            }
            const titolo = testo(req.body?.titolo, LIMITE_TESTI.titolo) || `Libretto ${b.denominazione}`;
            const d = await client.query(
                `INSERT INTO documenti (cartella_id, titolo, descrizione, visibilita, ruoli, in_emergenza, sempre_con_me, creato_da)
                 VALUES ($1, $2, $3, 'interni', '{}', $4, false, $5) RETURNING id`,
                [cartella, titolo, testo(req.body?.descrizione, LIMITE_TESTI.descrizione), vero(req.body?.in_emergenza), req.user.id]);
            const id = d.rows[0].id;
            await aggiungiVersione(client, id, 1, req);
            const collegati = await collegaBeni(client, id, bene, vero(req.body?.simili));
            await client.query('COMMIT');
            await proteggiCaricati(req.file);
            registraAudit(req, 'documento.caricato', { tipo: 'documento', id, dettagli: { titolo, file: req.file.originalname, bene_id: bene, beni: collegati.length } });
            res.status(201).json({ ...(await leggiDocumento(id)), collegati: collegati.length });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            togliFile(req.file.filename);
            logger.error('Errore POST /api/magazzino/beni/:id/libretto:', e);
            res.status(500).json({ message: 'Errore nel salvare il libretto.' });
        } finally {
            client.release();
        }
    });

    app.delete('/api/documenti/:id/beni/:beneId', collega, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const bene = parseInt(req.params.beneId, 10);
        if (!Number.isInteger(id) || !Number.isInteger(bene)) return res.status(400).json({ message: 'Documento o bene non validi.' });
        try {
            await pool.query('DELETE FROM documenti_beni WHERE documento_id = $1 AND bene_id = $2', [id, bene]);
            registraAudit(req, 'documento.scollegato', { tipo: 'documento', id, dettagli: { bene_id: bene } });
            res.json(await leggiDocumento(id));
        } catch (e) {
            logger.error('Errore DELETE /api/documenti/:id/beni:', e);
            res.status(500).json({ message: 'Errore nello scollegare il documento.' });
        }
    });
}
