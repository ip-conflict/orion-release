// src/appMobile.js
//
// Quello che serve solo all'app Android: il contesto (chi sono, cosa posso
// fare) e la coda di notifiche per persona. Per il resto l'app usa le rotte del web.

import fs from 'fs';
import path from 'path';
import { haPermesso } from './permessi.js';

// Il formato delle risposte: si incrementa solo per cambi che rompono l'app.
export const VERSIONE_CONTRATTO = 1;

// Ogni quanto l'app chiusa controlla la coda: un'ora, un quarto d'ora durante
// un'emergenza (il minimo di Android, che raggruppa questi controlli).
const MINUTI_CONTROLLO_PERIODICO = 60;
const MINUTI_CONTROLLO_IN_EMERGENZA = 15;

// Le lette restano un mese, le mai lette tre; chi ha una scadenza sparisce prima.
const GIORNI_TENUTA_LETTE = 30;
const GIORNI_TENUTA_NON_LETTE = 90;

// La categoria di ogni tipo: sul telefono ognuna ha il suo canale.
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
    dpi_da_confermare: 'personale',
    scadenza: 'personale',
    segreteria_riepilogo: 'segreteria',
    magazzino_riepilogo: 'magazzino',
    aggiornamento_disponibile: 'personale',
    prova: 'personale'
};

// Una notifica che non è ancora scaduta.
const VALIDA = '(scade_il IS NULL OR scade_il > NOW())';

// La coda di notifiche, separata dalle rotte: la usano anche magazzino e scadenze.
export function creaNotifiche({ pool, logger, avvisaUtente, inSimulazione = () => false }) {

    // Mette una notifica nella coda e la consegna subito a chi è collegato.
    // Non lancia: restituisce la notifica o null (doppione o errore).
    // oreValidita: dopo quante ore non ha più senso.
    async function notifica(userId, { tipo, titolo, testo = null, riferimento = null, chiave = null, categoria = null, oreValidita = null }, esecutore = pool) {
        if (!userId || !tipo || !titolo) {
            logger.error('[Notifiche] Notifica incompleta, scartata:', { userId, tipo, titolo });
            return null;
        }
        const cat = CATEGORIE_NOTIFICHE.includes(categoria) ? categoria : (CATEGORIA_DEL_TIPO[tipo] || 'personale');
        // Durante una simulazione in sala ogni avviso dell'emergenza lo dice nel titolo.
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
    }


    async function notificaA(userIds, dati) {
        let n = 0;
        for (const id of new Set(userIds)) if (await notifica(id, dati)) n++;
        return n;
    }

    // Fa scadere subito quello che ha perso significato, per tipo, categoria,
    // riferimento o persona.
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

// La coda di una persona: le ultime 50, o quelle dopo "dopo" in ordine
// crescente. La leggono l'app con la sessione e il telefono col token degli avvisi.
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

// L'APK nella cartella app-android, con versione.json: la versione e la più
// vecchia che questo server accetta.
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

// app_android_enabled: se l'app è a disposizione del personale (di base sì).
export async function appDistribuita(pool) {
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'app_android_enabled'");
    return r.rowCount === 0 || String(r.rows[0].setting_value) !== 'false';
}

// Rotte
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

    // Cosa può fare questa persona: l'app mostra solo questo, ma decidono le rotte.
    // L'emergenza la vede nell'app solo chi è in una squadra: gli altri non
    // c'entrano finché il centro operativo non li mette in squadra. Gli esterni
    // esistono solo per l'emergenza e la vedono sempre, anche in attesa di squadra.
    // L'archivio dei documenti lo consultano tutti gli interni.
    function capacita(req, moduli, inSquadra, inSala = false, regia = false) {
        const esterno = ruoliDi(req.user).includes('esterno');
        const elenco = [];
        // La squadra COC: in sala si seguono tutte le segnalazioni, anche dall'app.
        if (inSala) elenco.push('emergenza.sala');
        // La regia di una simulazione in sala: dal telefono annota le osservazioni.
        if (regia) elenco.push('regia');
        if (esterno) {
            elenco.push('emergenza');
            // I documenti del gruppo segnati per l'emergenza (il piano comunale).
            if (emergenzaAttiva()) elenco.push('documenti');
        } else {
            elenco.push('io', 'documenti');
            if (inSquadra) elenco.push('emergenza');
            // Il calendario con le attività e le scadenze, a modulo acceso.
            if (moduli.attivita) elenco.push('calendario');
            // Dai permessi (permessi.js): consegna e rientro a chi ha quello delle
            // consegne, l'inventario a chi gestisce il magazzino, la segreteria a
            // chi gestisce visite e corsi.
            if (moduli.magazzino && haPermesso(req, 'magazzino.consegne')) elenco.push('magazzino.consegna');
            if (moduli.magazzino && haPermesso(req, 'magazzino.gestione')) elenco.push('magazzino.inventario');
            if (moduli.segreteria && haPermesso(req, 'volontari.sanitario')) elenco.push('segreteria');
        }
        return elenco;
    }

    // Il web, dopo un accesso da Android, chiede se proporre l'app.
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
                    // Con il caposquadra: l'app dice chi manda la posizione della squadra.
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
            // Le funzioni di supporto di cui fa parte, con gli incarichi ancora
            // aperti in questa emergenza: l'app mostra "Le mie attività".
            const funzioniAccese = String(funzioniAcceso) === 'true';
            const mieFunzioni = funzioniAccese ? (await pool.query(`
                SELECT f.id, f.sigla, f.nome, m.referente,
                       (SELECT COUNT(*)::int FROM incarichi i JOIN reports r ON r.id = i.report_id
                         WHERE i.funzione_id = f.id AND i.stato <> 'concluso' AND r.emergency_id = $2) AS aperti
                FROM funzione_membri m JOIN funzioni f ON f.id = m.funzione_id
                WHERE m.user_id = $1 AND f.attiva ORDER BY f.ordine, f.sigla`, [req.user.id, emergenza?.id ?? null])).rows : [];
            const versioneApp = await appDistribuita(pool) ? leggiVersioneApp(cartellaApk, logger) : null;
            const ruoli = ruoliDi(req.user);
            // Chi conduce la simulazione aperta: chi organizza, il responsabile, la regia.
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
                    // Cosa può fare oltre alla base (permessi.js): l'app lo mostra nel profilo.
                    permessi: req.user.permessi || [],
                    // Gli esterni temporanei: l'app dice fino a quando vale.
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
                    // Una simulazione in sala: l'app la segna su ogni schermata.
                    simulazione: emergenza.simulazione === true,
                    attivita_id: emergenza.attivita_id ?? null
                } : null,
                squadra: squadra.rows[0] || null,
                funzioni: funzioniAccese ? { mie: mieFunzioni } : null,
                notifiche: {
                    non_lette: nonLette.rows[0].n,
                    // In emergenza più spesso per tutti: chi viene messo in
                    // squadra lo deve sapere presto anche ad app chiusa.
                    controllo_minuti: emergenza ? MINUTI_CONTROLLO_IN_EMERGENZA : MINUTI_CONTROLLO_PERIODICO
                }
            });
        } catch (e) {
            logger.error('Errore GET /api/app/contesto:', e);
            res.status(500).json({ message: 'Errore nel leggere il contesto.' });
        }
    });

    // Le proprie notifiche: con "dopo" solo le nuove, senza le ultime 50; in ordine crescente.
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

    // Segna come lette, per "ids" o "fino_a". Solo le proprie.

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
