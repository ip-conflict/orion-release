// Solo per l'app Android: il contesto e la coda di notifiche per persona.

import fs from 'fs';
import path from 'path';
import { haPermesso } from './permessi.js';

// Si incrementa solo per cambi che rompono l'app.
export const VERSIONE_CONTRATTO = 1;

// Un quarto d'ora è il minimo di Android, che raggruppa questi controlli.
const MINUTI_CONTROLLO_PERIODICO = 60;
const MINUTI_CONTROLLO_IN_EMERGENZA = 15;

const GIORNI_TENUTA_LETTE = 30;
const GIORNI_TENUTA_NON_LETTE = 90;

const CATEGORIE_NOTIFICHE = ['emergenza', 'personale', 'segreteria', 'magazzino'];
const CATEGORIA_DEL_TIPO = {
    emergenza_aperta: 'emergenza',
    in_squadra: 'emergenza',
    intervento_assegnato: 'emergenza',
    incarico_funzione: 'emergenza',
    caposquadra: 'emergenza',
    chiamata: 'emergenza',
    imprevisto: 'emergenza',
    regia_telefona: 'emergenza',
    allerta_meteo: 'personale',
    dpi_da_confermare: 'personale',
    scadenza: 'personale',
    segreteria_riepilogo: 'segreteria',
    magazzino_riepilogo: 'magazzino',
    aggiornamento_disponibile: 'personale',
    prova: 'personale'
};

const VALIDA = '(scade_il IS NULL OR scade_il > NOW())';

export function creaNotifiche({ pool, logger, avvisaUtente, svegliaTelefoni = null, inSimulazione = () => false }) {

    // Non lancia: restituisce la notifica o null (doppione o errore).
    async function notifica(userId, { tipo, titolo, testo = null, riferimento = null, chiave = null, categoria = null, oreValidita = null }, esecutore = pool) {
        if (!userId || !tipo || !titolo) {
            logger.error('[Notifiche] Notifica incompleta, scartata:', { userId, tipo, titolo });
            return null;
        }
        const cat = CATEGORIE_NOTIFICHE.includes(categoria) ? categoria : (CATEGORIA_DEL_TIPO[tipo] || 'personale');
        if (cat === 'emergenza' && inSimulazione() && !String(titolo).startsWith('[SIMULAZIONE]')) titolo = `[SIMULAZIONE] ${titolo}`;
        try {
            const r = await esecutore.query(
                `INSERT INTO notifiche (user_id, tipo, titolo, testo, riferimento_tipo, riferimento_id, chiave, categoria, scade_il)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                         CASE WHEN $9::int IS NULL THEN NULL ELSE NOW() + make_interval(hours => $9::int) END)
                 ON CONFLICT (user_id, chiave) DO NOTHING
                 RETURNING id, tipo, categoria, titolo, testo, riferimento_tipo, riferimento_id, creata_il, letta_il, scade_il`,
                [userId, tipo, String(titolo).slice(0, 120), testo,
                 riferimento?.tipo || null, riferimento?.id || null, chiave, cat, oreValidita]);
            if (r.rowCount === 0) return null; // già in coda: stessa chiave
            const creata = r.rows[0];
            // In una transazione la consegna la fa il chiamante, dopo il COMMIT.
            if (esecutore === pool) consegna(userId, creata);
            return creata;
        } catch (e) {
            logger.error('[Notifiche] Impossibile accodare la notifica:', { userId, tipo, error: e.message });
            return null;
        }
    }

    function consegna(userId, creata) {
        if (typeof avvisaUtente === 'function' && creata) {
            avvisaUtente(userId, 'notifica', { notifica: creata });
        }
        if (typeof svegliaTelefoni === 'function' && creata) svegliaTelefoni(userId);
    }


    async function notificaA(userIds, dati) {
        let n = 0;
        for (const id of new Set(userIds)) if (await notifica(id, dati)) n++;
        return n;
    }

    async function scadi({ tipo = null, categoria = null, riferimento = null, userId = null, prefissoChiave = null } = {}) {
        try {
            const r = await pool.query(
                `UPDATE notifiche SET scade_il = NOW()
                 WHERE ${VALIDA}
                   AND ($1::text IS NULL OR tipo = $1)
                   AND ($2::text IS NULL OR categoria = $2)
                   AND ($3::text IS NULL OR riferimento_tipo = $3)
                   AND ($4::int IS NULL OR riferimento_id = $4)
                   AND ($5::int IS NULL OR user_id = $5)
                   AND ($6::text IS NULL OR chiave LIKE $6 || '%')`,
                [tipo, categoria, riferimento?.tipo || null, riferimento?.id ?? null, userId, prefissoChiave]);
            return r.rowCount;
        } catch (e) {
            logger.error('[Notifiche] Impossibile far scadere le notifiche:', { error: e.message });
            return 0;
        }
    }

    async function pulisci() {
        try {
            const r = await pool.query(
                `DELETE FROM notifiche
                 WHERE (letta_il IS NOT NULL AND letta_il < NOW() - make_interval(days => $1))
                    OR (letta_il IS NULL AND creata_il < NOW() - make_interval(days => $2))
                    OR (scade_il IS NOT NULL AND scade_il < NOW() - INTERVAL '1 day')`,
                [GIORNI_TENUTA_LETTE, GIORNI_TENUTA_NON_LETTE]);
            if (r.rowCount > 0) logger.info(`[Notifiche] Rimosse ${r.rowCount} notifiche vecchie.`);
        } catch (e) {
            logger.error('[Notifiche] Pulizia non riuscita:', { error: e.message });
        }
    }

    return { notifica, notificaA, scadi, consegna, pulisci };
}

export async function leggiNotifiche(pool, userId, dopo = null) {
    const elenco = dopo === null
        ? await pool.query(
            `SELECT * FROM (
                SELECT id, tipo, categoria, titolo, testo, riferimento_tipo, riferimento_id, creata_il, letta_il, scade_il
                FROM notifiche WHERE user_id = $1 AND ${VALIDA} ORDER BY id DESC LIMIT 50
             ) ultime ORDER BY id`, [userId])
        : await pool.query(
            `SELECT id, tipo, categoria, titolo, testo, riferimento_tipo, riferimento_id, creata_il, letta_il, scade_il
             FROM notifiche WHERE user_id = $1 AND id > $2 AND ${VALIDA} ORDER BY id LIMIT 100`, [userId, dopo]);
    const nonLette = await pool.query(
        `SELECT COUNT(*)::int AS n FROM notifiche WHERE user_id = $1 AND letta_il IS NULL AND ${VALIDA}`, [userId]);
    return { notifiche: elenco.rows, non_lette: nonLette.rows[0].n };
}

export function leggiVersioneApp(cartella, logger) {
    try {
        const grezzo = fs.readFileSync(path.join(cartella, 'versione.json'), 'utf8');
        const v = JSON.parse(grezzo);
        const codice = Number.isInteger(v.codice) ? v.codice : null;
        return {
            codice,
            nome: typeof v.nome === 'string' ? v.nome : null,
            minima: Number.isInteger(v.minima) ? v.minima : codice,

            certificato: typeof v.certificato_sha256 === 'string' && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(v.certificato_sha256)
                ? v.certificato_sha256 : null,
            presente: fs.existsSync(path.join(cartella, 'orion.apk'))
        };
    } catch (e) {
        if (e.code !== 'ENOENT') logger.warn('[App] versione.json illeggibile:', { error: e.message });
        return null;
    }
}

export async function appDistribuita(pool) {
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'app_android_enabled'");
    return r.rowCount === 0 || String(r.rows[0].setting_value) !== 'false';
}

export function registraRotteApp(app, ctx) {
    const {
        pool, logger, haRuolo, ruoliDi, ruoloPrincipale,
        emergenzaAttiva, versioneServer, cartellaApk, leggiConfigMagazzino
    } = ctx;

    async function impostazione(chiave) {
        const r = await pool.query('SELECT setting_value FROM branding_settings WHERE setting_key = $1', [chiave]);
        if (r.rowCount === 0) return null;
        const grezzo = r.rows[0].setting_value;
        if (typeof grezzo !== 'string') return grezzo;
        try { return JSON.parse(grezzo); } catch { return grezzo; }
    }

    // L'app mostra solo questo, ma decidono le rotte. L'emergenza la vede solo chi è in
    // squadra; gli esterni sempre, anche in attesa di squadra.
    function capacita(req, moduli, inSquadra, inSala = false, regia = false) {
        const esterno = ruoliDi(req.user).includes('esterno');
        const elenco = [];
        if (inSala) elenco.push('emergenza.sala');
        if (regia) elenco.push('regia');
        if (esterno) {
            elenco.push('emergenza');
            if (emergenzaAttiva()) elenco.push('documenti');
        } else {
            elenco.push('io', 'documenti');
            if (inSquadra) elenco.push('emergenza');
            if (moduli.attivita) elenco.push('calendario');
            if (moduli.magazzino && haPermesso(req, 'magazzino.consegne')) elenco.push('magazzino.consegna');
            if (moduli.magazzino && haPermesso(req, 'magazzino.gestione')) elenco.push('magazzino.inventario');
            if (moduli.segreteria && haPermesso(req, 'volontari.sanitario')) elenco.push('segreteria');
        }
        return elenco;
    }

    app.get('/api/app/offerta', async (req, res) => {
        try {
            const versione = leggiVersioneApp(cartellaApk, logger);
            const disponibile = !!versione?.presente && await appDistribuita(pool);
            res.json(disponibile
                ? { disponibile: true, versione: versione.nome, codice: versione.codice, scarica: '/app/orion.apk', certificato_sha256: versione.certificato }
                : { disponibile: false });
        } catch (e) {
            logger.error('Errore GET /api/app/offerta:', e);
            res.status(500).json({ message: "Errore nel verificare la disponibilita' dell'app." });
        }
    });

    app.get('/api/app/contesto', async (req, res) => {
        try {
            const [magazzinoAcceso, configSegreteria, nomeAssociazione, squadra, nonLette, qrTesserini, anagrafica, funzioniAcceso, attivitaAcceso] = await Promise.all([
                impostazione('magazzino_enabled'),
                impostazione('segreteria_config'),
                impostazione('association_name'),
                pool.query(
                    `SELECT s.id, s.nome, s.nome_radio, s.coc, sm.caposquadra AS sono_caposquadra,
                            (SELECT json_build_object('username', c.username, 'nome', c.nome, 'cognome', c.cognome)
                               FROM squadra_membri c WHERE c.squadra_id = s.id AND c.caposquadra LIMIT 1) AS caposquadra
                     FROM squadre s JOIN squadra_membri sm ON s.id = sm.squadra_id
                     WHERE sm.username = $1 LIMIT 1`, [req.user.username]),
                pool.query(`SELECT COUNT(*)::int AS n FROM notifiche WHERE user_id = $1 AND letta_il IS NULL AND ${VALIDA}`, [req.user.id]),
                impostazione('badge_qr_enabled'),
                pool.query('SELECT temporaneo, ente FROM users WHERE id = $1', [req.user.id]),
                impostazione('funzioni_enabled'),
                impostazione('attivita_enabled')
            ]);

            const moduli = {
                magazzino: String(magazzinoAcceso) === 'true',
                segreteria: configSegreteria?.enabled === true,

                tesserini_qr: String(qrTesserini) !== 'false',
                attivita: String(attivitaAcceso ?? 'true') !== 'false'
            };
            const configMagazzino = moduli.magazzino ? await leggiConfigMagazzino() : null;
            const emergenza = emergenzaAttiva();
            const funzioniAccese = String(funzioniAcceso) === 'true';
            const mieFunzioni = funzioniAccese ? (await pool.query(`
                SELECT f.id, f.sigla, f.nome, m.referente,
                       (SELECT COUNT(*)::int FROM incarichi i JOIN reports r ON r.id = i.report_id
                         WHERE i.funzione_id = f.id AND i.stato <> 'concluso' AND r.emergency_id = $2) AS aperti
                FROM funzione_membri m JOIN funzioni f ON f.id = m.funzione_id
                WHERE m.user_id = $1 AND f.attiva ORDER BY f.ordine, f.sigla`, [req.user.id, emergenza?.id ?? null])).rows : [];
            const versioneApp = await appDistribuita(pool) ? leggiVersioneApp(cartellaApk, logger) : null;
            const ruoli = ruoliDi(req.user);
            const regia = emergenza?.simulazione === true && emergenza.attivita_id && !ruoli.includes('esterno')
                && (haPermesso(req, 'gruppo.attivita') || (await pool.query(
                    `SELECT 1 FROM attivita a WHERE a.id = $1 AND (a.responsabile_id = $2
                        OR EXISTS (SELECT 1 FROM attivita_regia g WHERE g.attivita_id = a.id AND g.user_id = $2))`,
                    [emergenza.attivita_id, req.user.id])).rowCount > 0);

            res.json({
                contratto: VERSIONE_CONTRATTO,
                server: {
                    versione: versioneServer,
                    associazione: typeof nomeAssociazione === 'string' ? nomeAssociazione : null
                },
                app: versioneApp ? {
                    ultima: versioneApp.codice,
                    ultima_nome: versioneApp.nome,
                    minima: versioneApp.minima,
                    scarica: versioneApp.presente ? '/app/orion.apk' : null
                } : null,
                utente: {
                    id: req.user.id,
                    username: req.user.username,
                    nome: req.user.nome || null,
                    cognome: req.user.cognome || null,
                    ruoli,
                    ruolo_principale: ruoloPrincipale(ruoli),
                    permessi: req.user.permessi || [],
                    temporaneo: anagrafica.rows[0]?.temporaneo === true,
                    ente: anagrafica.rows[0]?.ente || null
                },
                moduli,
                capacita: capacita(req, moduli, squadra.rowCount > 0, squadra.rows[0]?.coc === true && !!emergenza, regia),
                magazzino: configMagazzino ? {
                    conferma_dpi: !!configMagazzino.conferma_dpi,
                    verbale_consegna: !!configMagazzino.verbale_consegna,
                    verbale_rientro: !!configMagazzino.verbale_rientro,
                    verbale_consegna_attrezzature: !!configMagazzino.verbale_consegna_attrezzature,
                    verbale_rientro_attrezzature: !!configMagazzino.verbale_rientro_attrezzature
                } : null,
                emergenza: emergenza ? {
                    id: emergenza.id,
                    codice: emergenza.code,
                    nome: emergenza.name || null,
                    inizio: emergenza.start_time || null,
                    simulazione: emergenza.simulazione === true,
                    attivita_id: emergenza.attivita_id ?? null
                } : null,
                squadra: squadra.rows[0] || null,
                funzioni: funzioniAccese ? { mie: mieFunzioni } : null,
                notifiche: {
                    non_lette: nonLette.rows[0].n,
                    // In emergenza più spesso: chi viene messo in squadra lo deve sapere presto anche ad app chiusa.
                    controllo_minuti: emergenza ? MINUTI_CONTROLLO_IN_EMERGENZA : MINUTI_CONTROLLO_PERIODICO
                }
            });
        } catch (e) {
            logger.error('Errore GET /api/app/contesto:', e);
            res.status(500).json({ message: 'Errore nel leggere il contesto.' });
        }
    });

    app.get('/api/notifiche', async (req, res) => {
        const dopo = req.query.dopo === undefined ? null : parseInt(req.query.dopo, 10);
        if (dopo !== null && (!Number.isInteger(dopo) || dopo < 0)) {
            return res.status(400).json({ message: 'Il parametro "dopo" deve essere un numero intero.' });
        }
        try {
            res.json(await leggiNotifiche(pool, req.user.id, dopo));
        } catch (e) {
            logger.error('Errore GET /api/notifiche:', e);
            res.status(500).json({ message: 'Errore nel leggere le notifiche.' });
        }
    });

    app.post('/api/notifiche/lette', async (req, res) => {
        const corpo = req.body || {};
        const ids = Array.isArray(corpo.ids)
            ? corpo.ids.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0)
            : null;
        const finoA = corpo.fino_a === undefined ? null : parseInt(corpo.fino_a, 10);
        if ((!ids || ids.length === 0) && !(Number.isInteger(finoA) && finoA > 0)) {
            return res.status(400).json({ message: 'Indica quali notifiche segnare come lette ("ids" oppure "fino_a").' });
        }
        try {
            const r = ids && ids.length > 0
                ? await pool.query(
                    `UPDATE notifiche SET letta_il = NOW()
                     WHERE user_id = $1 AND letta_il IS NULL AND id = ANY($2::int[])`, [req.user.id, ids])
                : await pool.query(
                    `UPDATE notifiche SET letta_il = NOW()
                     WHERE user_id = $1 AND letta_il IS NULL AND id <= $2`, [req.user.id, finoA]);
            const nonLette = await pool.query(
                `SELECT COUNT(*)::int AS n FROM notifiche WHERE user_id = $1 AND letta_il IS NULL AND ${VALIDA}`, [req.user.id]);
            res.json({ segnate: r.rowCount, non_lette: nonLette.rows[0].n });
        } catch (e) {
            logger.error('Errore POST /api/notifiche/lette:', e);
            res.status(500).json({ message: 'Errore nel segnare le notifiche.' });
        }
    });
}
