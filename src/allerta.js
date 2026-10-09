// Il bollettino di allerta meteo-idro per la zona del Comune. Si accende
// scegliendo la Regione nelle impostazioni: prima di allora ORION non chiede
// niente a nessuno. Da lì, ogni quarto d'ora, guarda se il Dipartimento ha
// pubblicato un bollettino nuovo (bollettinoDpc.js) e ne tiene i livelli
// delle zone della Regione.
//
// La zona è quella del comune scelto, o quella che contiene il centro della
// mappa. Con un'emergenza aperta ogni versione del bollettino, compresa
// quella in vigore all'apertura, entra nei documenti dell'emergenza (il PDF)
// e nel diario di sala (i livelli della zona): restano nel resoconto e nello
// storico sigillato. Chi apre le emergenze riceve un avviso quando la zona
// arriva al livello scelto.
//
// Vale come informazione: l'allerta ufficiale è quella che la Regione
// comunica al Comune per i canali stabiliti dal piano.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import { pool } from './db.js';
import { dataItaliana, oggiLocale } from './date.js';
import { cifraFile, inviaFile } from './cifratura.js';
import { LIVELLI, RISCHI, leggiBollettino, livelloMassimo } from './bollettinoDpc.js';
import { REGIONI, comuniDi, zonaDelComune, zonaDelPunto } from './allertaRegioni.js';
import { checkAdminRole } from './autenticazione.js';
import { protectedDocsDir } from './caricamenti.js';
import { sqlHaPermesso } from './permessi.js';
import { activeEmergency } from './statoEmergenza.js';
import { avvisaClienti, notifiche } from './tempoReale.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARTELLA_PDF = path.join(__dirname, '..', 'protected_uploads', 'bollettini');

const INDIRIZZO = process.env.ORION_ALLERTA_URL
    || 'https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/files/all/latest_all.zip';
const OGNI = 15 * 60 * 1000;
// I PDF dei bollettini più recenti; quelli allegati alle emergenze sono copie a parte.
const PDF_TENUTI = 3;
const SOGLIE = ['gialla', 'arancione', 'mai'];
const IMPOSTAZIONI_ALLERTA = ['allerta_regione', 'allerta_comune', 'allerta_avvisa_da'];

const NOMI_RISCHI = { idrogeologico: 'idrogeologico', idraulico: 'idraulico', temporali: 'temporali' };

const stato = { etag: null, ultimoControllo: null, ultimoNuovo: null, errore: null };
let inCorso = null;

async function impostazioni(chiavi) {
    const { rows } = await pool.query(
        'SELECT setting_key, setting_value FROM branding_settings WHERE setting_key = ANY($1::text[])', [chiavi]);
    return Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value]));
}

/** Regione, zona e da dove viene la zona (comune scelto o centro della mappa); null se spento. */
export async function riferimento() {
    const s = await impostazioni([...IMPOSTAZIONI_ALLERTA, 'map_center_lat', 'map_center_lon']);
    const regione = Object.hasOwn(REGIONI, s.allerta_regione || '') ? s.allerta_regione : null;
    if (!regione) return null;
    const comune = (s.allerta_comune || '').trim() || null;
    let zona = null;
    if (comune) {
        zona = zonaDelComune(regione, comune);
    } else {
        const lat = parseFloat(s.map_center_lat), lon = parseFloat(s.map_center_lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) zona = zonaDelPunto(regione, lat, lon);
    }
    return {
        regione, comune,
        modo: comune ? 'comune' : 'centro_mappa',
        soglia: SOGLIE.includes(s.allerta_avvisa_da) ? s.allerta_avvisa_da : 'arancione',
        zona: zona ? { codice: zona.codice, nome: zona.nome } : null
    };
}

/** Le impostazioni dell'allerta che si possono salvare; un messaggio se una non va. */
export function controllaImpostazioniAllerta(valori, regioneSalvata) {
    if ('allerta_regione' in valori && valori.allerta_regione && !Object.hasOwn(REGIONI, valori.allerta_regione)) {
        return 'Regione del bollettino non prevista.';
    }
    if ('allerta_avvisa_da' in valori && valori.allerta_avvisa_da && !SOGLIE.includes(valori.allerta_avvisa_da)) {
        return 'Livello degli avvisi non valido.';
    }
    if (valori.allerta_comune) {
        const regione = valori.allerta_regione ?? regioneSalvata;
        if (!Object.hasOwn(REGIONI, regione || '') || !zonaDelComune(regione, valori.allerta_comune)) {
            return 'Il comune scelto non è fra quelli della Regione del bollettino.';
        }
    }
    return null;
}

// I giorni ancora utili di un bollettino per una zona: oggi e domani se è di
// oggi, solo oggi (il suo "domani") se è di ieri, niente se è più vecchio.
function giorniValidi(riga, codice, oggi = oggiLocale()) {
    const z = riga?.zone?.[codice];
    if (!z) return [];
    const domani = oggiLocale(new Date(new Date(`${oggi}T12:00:00Z`).getTime() + 86400000));
    const ieri = oggiLocale(new Date(new Date(`${oggi}T12:00:00Z`).getTime() - 86400000));
    const giorno = String(riga.giorno).slice(0, 10);
    const conMassimo = (data, l) => ({ data, ...l, massimo: livelloMassimo(l) });
    if (giorno === oggi) return [conMassimo(oggi, z.oggi), conMassimo(domani, z.domani)];
    if (giorno === ieri) return [conMassimo(oggi, z.domani)];
    return [];
}

// Tutti e due i giorni del bollettino, con le date sue: per le note e lo storico.
function giorniDelBollettino(riga, codice) {
    const z = riga?.zone?.[codice];
    if (!z) return [];
    const giorno = String(riga.giorno).slice(0, 10);
    const domani = oggiLocale(new Date(new Date(`${giorno}T12:00:00Z`).getTime() + 86400000));
    return [{ data: giorno, ...z.oggi, massimo: livelloMassimo(z.oggi) }, { data: domani, ...z.domani, massimo: livelloMassimo(z.domani) }];
}

function testoGiorno(g) {
    const allerte = RISCHI.filter(r => g[r] && g[r] !== 'verde').map(r => `${NOMI_RISCHI[r]} ${g[r]}`);
    const quale = g.massimo ? (g.massimo === 'verde' ? 'nessuna allerta' : `allerta ${g.massimo}`) : 'valutazione non trasmessa';
    return `${dataItaliana(g.data)} ${quale}${allerte.length && g.massimo !== 'verde' ? ` (${allerte.join(', ')})` : ''}`;
}

/** "Zona Vene-E1: 09/10/2026 allerta gialla (idraulico gialla); 10/10/2026 nessuna allerta". */
function riassunto(riga, zona) {
    const giorni = giorniDelBollettino(riga, zona.codice);
    return `Zona ${zona.codice} (${zona.nome}): ${giorni.map(testoGiorno).join('; ')}.`;
}

function rigaPubblica(riga, codice) {
    return {
        id: riga.id, titolo: riga.titolo, emesso_il: riga.emesso_il, tipo: riga.tipo,
        pdf: !!riga.pdf_file,
        giorni: giorniDelBollettino(riga, codice)
    };
}

async function salvaPdf(bollettino, chiave) {
    if (!bollettino.pdf) return null;
    fs.mkdirSync(CARTELLA_PDF, { recursive: true });
    const file = path.join(CARTELLA_PDF, `${chiave.replace(/[^0-9a-z_-]/gi, '')}.pdf`);
    await fs.promises.writeFile(file, bollettino.pdf);
    await cifraFile(file).catch(e => logger.error('[Allerta] PDF del bollettino non cifrato:', e));
    return path.basename(file);
}

// Tiene solo i PDF degli ultimi bollettini.
async function sfoltisciPdf() {
    await pool.query(
        `UPDATE bollettini_allerta SET pdf_file = NULL
         WHERE pdf_file IS NOT NULL AND id NOT IN (SELECT id FROM bollettini_allerta ORDER BY emesso_il DESC, id DESC LIMIT $1)`, [PDF_TENUTI]);
    const tenuti = new Set((await pool.query('SELECT pdf_file FROM bollettini_allerta WHERE pdf_file IS NOT NULL')).rows.map(r => r.pdf_file));
    for (const nome of await fs.promises.readdir(CARTELLA_PDF).catch(() => [])) {
        if (!tenuti.has(nome)) await fs.promises.unlink(path.join(CARTELLA_PDF, nome)).catch(() => {});
    }
}

/**
 * Allega un bollettino all'emergenza aperta: il PDF fra i documenti e i
 * livelli della zona nel diario di sala. Una volta sola per bollettino; mai
 * a una simulazione, che non ha un cielo vero.
 */
export async function allegaAllEmergenza(riga, rif = null) {
    const emergenza = activeEmergency;
    if (!emergenza || emergenza.simulazione || !riga) return false;
    rif = rif || await riferimento();
    if (!rif?.zona || rif.regione !== riga.regione) return false;
    const gia = await pool.query('SELECT 1 FROM emergency_documents WHERE emergency_id = $1 AND bollettino_id = $2', [emergenza.id, riga.id]);
    if (gia.rowCount) return false;
    const testo = riassunto(riga, rif.zona);

    let documento = null;
    if (riga.pdf_file) {
        try {
            fs.mkdirSync(protectedDocsDir, { recursive: true });
            const nome = `${crypto.randomBytes(16).toString('hex')}.pdf`;
            await fs.promises.copyFile(path.join(CARTELLA_PDF, riga.pdf_file), path.join(protectedDocsDir, nome));
            const { rows: [d] } = await pool.query(
                `INSERT INTO emergency_documents (emergency_id, uploader_user_id, file_path, original_filename, file_mime_type, description, bollettino_id)
                 VALUES ($1, NULL, $2, $3, 'application/pdf', $4, $5)
                 ON CONFLICT (emergency_id, bollettino_id) DO NOTHING
                 RETURNING id, emergency_id, file_path, original_filename, file_mime_type, description, uploaded_at`,
                [emergenza.id, `/uploads/documents/${nome}`, `${riga.titolo}.pdf`, testo, riga.id]);
            if (!d) {
                await fs.promises.unlink(path.join(protectedDocsDir, nome)).catch(() => {});
                return false;
            }
            documento = { ...d, uploader_user_id: null, uploader_fullname: 'ORION' };
        } catch (e) {
            logger.error('[Allerta] Bollettino non allegato ai documenti:', e);
        }
    }
    const { rows: [voce] } = await pool.query(
        `INSERT INTO diario_sala (emergency_id, testo, autore_id, autore_nome)
         VALUES ($1, $2, NULL, 'ORION') RETURNING id, testo, autore_nome, creata_il`,
        [emergenza.id, `${riga.titolo}. ${testo}`]);
    if (documento) avvisaClienti('new_emergency_document', { document: documento });
    avvisaClienti('nota_sala', { emergency_id: emergenza.id, voce });
    return true;
}

/** All'apertura di un'emergenza: il bollettino ancora valido, se c'è. */
export async function allegaBollettinoInVigore() {
    try {
        const rif = await riferimento();
        if (!rif?.zona) return;
        const { rows: [riga] } = await pool.query(
            `SELECT * FROM bollettini_allerta WHERE regione = $1 ORDER BY emesso_il DESC, id DESC LIMIT 1`, [rif.regione]);
        if (riga && giorniValidi(riga, rif.zona.codice).length) await allegaAllEmergenza(riga, rif);
    } catch (e) {
        logger.error("[Allerta] Bollettino in vigore non allegato all'emergenza:", e);
    }
}

async function avvisaChiCoordina(riga, rif) {
    if (rif.soglia === 'mai' || !rif.zona) return;
    const giorni = giorniValidi(riga, rif.zona.codice);
    const peggiore = giorni.map(g => g.massimo).filter(Boolean)
        .reduce((a, b) => (LIVELLI.indexOf(b) > LIVELLI.indexOf(a) ? b : a), 'verde');
    if (LIVELLI.indexOf(peggiore) < LIVELLI.indexOf(rif.soglia)) return;
    const chi = sqlHaPermesso('emergenze.apertura', 1);
    const { rows } = await pool.query(
        `SELECT u.id FROM users u WHERE COALESCE(u.is_active, true) = true AND u.eliminato_il IS NULL AND ${chi.condizione}`, chi.parametri);
    const titolo = `Allerta ${peggiore} nella zona ${rif.zona.codice}`;
    const testo = giorni.filter(g => g.massimo && g.massimo !== 'verde').map(testoGiorno).join('; ');
    for (const { id } of rows) {
        await notifiche.notifica(id, {
            tipo: 'allerta_meteo', titolo, testo: `${testo}. ${riga.titolo}.`,
            riferimento: { tipo: 'bollettino', id: riga.id }, chiave: `allerta:${riga.chiave}`, oreValidita: 48
        });
    }
}

/**
 * Guarda se c'è un bollettino nuovo e, se sì, lo tiene. forza: anche se il
 * server dice che non è cambiato niente. Non lancia: l'esito finisce in stato.
 */
export function controlla({ forza = false } = {}) {
    if (!inCorso) {
        inCorso = controllaDavvero(forza).finally(() => { inCorso = null; });
    }
    return inCorso;
}

async function controllaDavvero(forza) {
    const rif = await riferimento().catch(() => null);
    if (!rif) return statoPubblico();
    stato.ultimoControllo = new Date();
    try {
        const intestazioni = (!forza && stato.etag) ? { 'If-None-Match': stato.etag } : {};
        const risposta = await fetch(INDIRIZZO, { headers: intestazioni, signal: AbortSignal.timeout(90000) });
        if (risposta.status === 304) {
            stato.errore = null;
            return statoPubblico();
        }
        if (!risposta.ok) throw new Error(`il server del bollettino risponde ${risposta.status}`);
        const bollettino = leggiBollettino(Buffer.from(await risposta.arrayBuffer()));
        stato.etag = risposta.headers.get('etag');
        stato.errore = null;

        const prefisso = REGIONI[rif.regione].prefisso;
        const zone = {};
        for (const [codice, oggi] of Object.entries(bollettino.oggi)) {
            if (!codice.startsWith(prefisso)) continue;
            const pulisci = l => Object.fromEntries(RISCHI.map(r => [r, l?.[r] ?? null]));
            zone[codice] = { oggi: pulisci(oggi), domani: pulisci(bollettino.domani[codice]) };
        }
        if (!Object.keys(zone).length) throw new Error(`nel bollettino non ci sono zone della Regione ${REGIONI[rif.regione].nome}`);

        const chiave = `${bollettino.chiave}-${bollettino.tipo}`;
        const esiste = await pool.query('SELECT id FROM bollettini_allerta WHERE chiave = $1', [chiave]);
        if (esiste.rowCount) return statoPubblico();
        const pdfFile = await salvaPdf(bollettino, chiave);
        const { rows: [riga] } = await pool.query(
            `INSERT INTO bollettini_allerta (chiave, regione, emesso_il, giorno, tipo, titolo, zone, pdf_file, pdf_nome)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (chiave) DO NOTHING RETURNING *`,
            [chiave, rif.regione, bollettino.emesso, bollettino.giorno, bollettino.tipo, bollettino.titolo,
                JSON.stringify(zone), pdfFile, bollettino.pdfNome]);
        if (!riga) return statoPubblico();
        stato.ultimoNuovo = new Date();
        logger.info(`[Allerta] Nuovo bollettino: ${riga.titolo}.`);
        await sfoltisciPdf().catch(e => logger.error('[Allerta] Pulizia dei PDF non riuscita:', e));
        await allegaAllEmergenza(riga, rif).catch(e => logger.error("[Allerta] Bollettino non allegato all'emergenza:", e));
        await avvisaChiCoordina(riga, rif).catch(e => logger.error('[Allerta] Avvisi non mandati:', e));
        avvisaClienti('allerta_aggiornata', { id: riga.id });
    } catch (e) {
        // Una rete che manca non riempie il log: si dice una volta finché dura.
        const messaggio = e.name === 'TimeoutError' ? 'il server del bollettino non ha risposto in tempo' : (e.cause?.code || e.message);
        if (stato.errore !== messaggio) logger.warn(`[Allerta] Bollettino non letto: ${messaggio}`);
        stato.errore = messaggio;
    }
    return statoPubblico();
}

function statoPubblico() {
    return { ultimo_controllo: stato.ultimoControllo, ultimo_nuovo: stato.ultimoNuovo, errore: stato.errore };
}

export function avviaAllerta() {
    setTimeout(() => controlla(), 30 * 1000);
    setInterval(() => controlla(), OGNI);
}

export function registraRotteAllerta(app) {
    // Quello che serve al centro operativo: la zona, i livelli dei giorni
    // ancora validi e gli aggiornamenti (dall'apertura dell'emergenza, o degli
    // ultimi tre giorni).
    app.get('/api/allerta', async (req, res) => {
        try {
            const rif = await riferimento();
            if (!rif) return res.json({ attiva: false });
            const info = REGIONI[rif.regione];
            const base = {
                attiva: true,
                regione: { codice: rif.regione, nome: info.nome, ente: info.ente, pagina_ufficiale: info.paginaUfficiale },
                riferimento: { modo: rif.modo, comune: rif.comune },
                zona: rif.zona,
                in_emergenza: !!(activeEmergency && !activeEmergency.simulazione),
                stato: statoPubblico()
            };
            if (!rif.zona) return res.json({ ...base, bollettino: null, aggiornamenti: [] });
            const dal = activeEmergency && !activeEmergency.simulazione ? activeEmergency.start_time : null;
            const { rows } = await pool.query(
                `SELECT * FROM bollettini_allerta
                 WHERE regione = $1 AND emesso_il >= COALESCE(
                     (SELECT MAX(emesso_il) FROM bollettini_allerta WHERE regione = $1 AND emesso_il <= $2::timestamptz),
                     $2::timestamptz, NOW() - INTERVAL '3 days')
                 ORDER BY emesso_il DESC, id DESC LIMIT 30`, [rif.regione, dal]);
            let ultima = rows[0];
            if (!ultima) {
                ultima = (await pool.query(
                    'SELECT * FROM bollettini_allerta WHERE regione = $1 ORDER BY emesso_il DESC, id DESC LIMIT 1', [rif.regione])).rows[0];
            }
            const giorni = ultima ? giorniValidi(ultima, rif.zona.codice) : [];
            res.json({
                ...base,
                bollettino: ultima ? { ...rigaPubblica(ultima, rif.zona.codice), validi: giorni } : null,
                aggiornamenti: rows.map(r => rigaPubblica(r, rif.zona.codice))
            });
        } catch (e) {
            logger.error('Errore GET /api/allerta:', e);
            res.status(500).json({ message: 'Bollettino non disponibile.' });
        }
    });

    app.get('/api/allerta/bollettini/:id/pdf', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Bollettino non valido.' });
        try {
            const { rows: [r] } = await pool.query('SELECT titolo, pdf_file FROM bollettini_allerta WHERE id = $1', [id]);
            if (!r) return res.status(404).json({ message: 'Bollettino non trovato.' });
            if (!r.pdf_file) return res.status(410).json({ message: "Il PDF di questo bollettino non è più sul server: resta fra i documenti dell'emergenza in cui è stato allegato." });
            const nome = `${r.titolo.replace(/[^\w ./-]+/g, '').trim()}.pdf`.replace(/\//g, '-');
            inviaFile(res, path.join(CARTELLA_PDF, r.pdf_file), { headers: { 'Content-Disposition': `inline; filename="${nome}"` } });
        } catch (e) {
            logger.error('Errore PDF del bollettino:', e);
            res.status(500).json({ message: 'PDF non disponibile.' });
        }
    });

    // Per le impostazioni: le Regioni, i comuni di una e la zona del centro della mappa.
    app.get('/api/allerta/regioni', checkAdminRole, async (req, res) => {
        const regione = String(req.query.regione || '');
        const elenco = Object.entries(REGIONI).map(([codice, r]) => ({ codice, nome: r.nome }));
        if (!Object.hasOwn(REGIONI, regione)) return res.json({ regioni: elenco });
        try {
            const s = await impostazioni(['map_center_lat', 'map_center_lon']);
            const lat = parseFloat(s.map_center_lat), lon = parseFloat(s.map_center_lon);
            const z = Number.isFinite(lat) && Number.isFinite(lon) ? zonaDelPunto(regione, lat, lon) : null;
            res.json({
                regioni: elenco,
                comuni: comuniDi(regione),
                centro_mappa: z ? { codice: z.codice, nome: z.nome } : null
            });
        } catch (e) {
            logger.error('Errore GET /api/allerta/regioni:', e);
            res.status(500).json({ message: 'Elenco non disponibile.' });
        }
    });

    app.post('/api/allerta/controlla', checkAdminRole, async (req, res) => {
        const esito = await controlla({ forza: true });
        res.json(esito);
    });
}
