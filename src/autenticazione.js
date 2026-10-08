// src/autenticazione.js
//
// Sessioni, ruoli e i controlli che le rotte mettono davanti a sé.

import './config.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import logger from './logger.js';
import { verifyJwtToken } from './authHelper.js';
import { pool } from './db.js';
import { activeEmergency } from './statoEmergenza.js';
import { esenteDaPresaVisione, versioneInformativa } from './statoInformativa.js';
import { ORDINE_RUOLI, haPermesso, mfaRichiesta, permessiDi } from './permessi.js';

// Chi fa la richiesta: il token, poi revoca, account attivo e ruoli letti dal
// database a ogni richiesta, perché sospensioni e ruoli tolti valgano subito.
export async function authenticateToken(req, res, next) {
    let token = req.signedCookies['__Secure-token'];
    if (!token) {
        const authHeader = req.headers['authorization'];
        token = authHeader?.split(' ')[1];
    }

    try {
        const user = await verifyJwtToken(token);

        // Revoca e account attivo in una query. Se fallisce si risponde
        // comunque: Express 4 non lo farebbe da sé.
        let stato;
        try {
            stato = await pool.query(
                `SELECT EXISTS (SELECT 1 FROM revoked_tokens WHERE token = $1) AS revocato,
                        (SELECT COALESCE(is_active, true) FROM users WHERE id = $2) AS attivo,
                        -- Nome e cognome viaggiano con la sessione perché finiscono
                        -- scritti dentro ai registri (squadre, magazzino, documenti)
                        -- e quei registri devono dire "Anna Rossi", non "rossia".
                        -- Nel token non ci sono, e leggerli qui non costa un giro
                        -- in più: è la stessa interrogazione.
                        (SELECT nome FROM users WHERE id = $2) AS nome,
                        (SELECT cognome FROM users WHERE id = $2) AS cognome,
                        -- ::text e non il tipo enumerato: senza il cast la libreria
                        -- restituisce la stringa grezza di PostgreSQL ("{admin}")
                        -- invece di un elenco, perché per i tipi definiti da noi
                        -- non sa come leggere un vettore.
                        ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = $2) AS ruoli,
                        (SELECT (EXTRACT(EPOCH FROM sessioni_valide_dal) * 1000)::bigint FROM users WHERE id = $2) AS valide_dal,
                        (SELECT temporaneo FROM users WHERE id = $2) AS temporaneo,
                        (SELECT presa_visione_versione FROM users WHERE id = $2) AS presa_visione,
                        -- I permessi dati in più, oltre a quelli dei ruoli (permessi.js).
                        ARRAY(SELECT permesso FROM utenti_permessi WHERE user_id = $2) AS permessi_in_piu`,
                [token, user.id]
            );
        } catch (dbError) {
            logger.error('[Auth] Impossibile verificare sessione e stato account:', { error: dbError });
            return res.status(503).json({ message: 'Servizio temporaneamente non disponibile. Riprova tra poco.' });
        }

        const { revocato, attivo, ruoli, nome, cognome, valide_dal, temporaneo, presa_visione, permessi_in_piu } = stato.rows[0];
        // L'esterno temporaneo non è sospeso: il suo accesso è finito con
        // l'emergenza o è stato revocato, e glielo si dice così.
        if (temporaneo === true && attivo === false && req.originalUrl.startsWith('/api/')) {
            res.clearCookie('__Secure-token', { path: '/' });
            return res.status(403).json({
                message: "L'accesso temporaneo è terminato: l'emergenza è chiusa o l'accesso è stato revocato.",
                sessione_terminata: true, motivo: 'accesso_temporaneo_finito'
            });
        }
        if (revocato || tokenSuperato(user, valide_dal)) {
            return res.status(401).json({ message: 'Sessione scaduta. Effettua nuovamente il login.', sessione_terminata: true });
        }
        // Sospeso, o eliminato mentre era collegato (attivo === null): fuori subito.
        if (attivo === null || attivo === false) {
            logger.warn(`[Auth] Sessione rifiutata per ${user.username}: account ${attivo === null ? 'eliminato' : 'sospeso'}.`);
            res.clearCookie('__Secure-token', { path: '/' });
            res.clearCookie('username', { path: '/' });
            const messaggio = 'Il tuo account non è più attivo. Contatta la segreteria.';
            // sessione_terminata distingue questo 403 da quelli che negano una
            // sola operazione: il client riporta all'accesso. motivo è un codice,
            // così il client sa cosa dire.
            if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ message: messaggio, sessione_terminata: true, motivo: 'account_non_attivo' });
            if (req.accepts('html')) return res.redirect('/login.html?error=account_sospeso');
            return res.sendStatus(403);
        }

        // Senza righe in utenti_ruoli vale il ruolo scritto nel token.
        const ruoliEffettivi = (ruoli && ruoli.length > 0) ? ruoli : ruoliDi(user);
        const permessi = permessiDi(ruoliEffettivi, permessi_in_piu);
        // L'amministratore, e chi vede i dati sanitari, lavora solo con una
        // sessione nata dalla verifica in due passaggi: anche chi lo è diventato
        // mentre era collegato, o chi aveva una sessione di prima che fosse obbligatoria.
        if (mfaRichiesta(ruoliEffettivi, permessi) && user.mfa !== true) {
            res.clearCookie('__Secure-token', { path: '/' });
            const messaggio = 'Per il tuo ruolo serve la verifica in due passaggi: rifai l\'accesso.';
            if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ message: messaggio, sessione_terminata: true, motivo: 'mfa_richiesta' });
            if (req.accepts('html')) return res.redirect('/login.html?error=mfa_richiesta&redirect=' + encodeURIComponent(req.originalUrl));
            return res.sendStatus(401);
        }
        req.user = { ...user, nome, cognome, ruoli: ruoliEffettivi, role: ruoloPrincipale(ruoliEffettivi), temporaneo: temporaneo === true, permessi };
        segnaAccesso(user.id);
        // Prima di lavorare si accettano le condizioni d'uso in vigore: al
        // primo accesso e ogni volta che cambiano. Fino ad allora si legge solo
        // il testo; l'app e il browser riconoscono il 428 e mostrano la pagina.
        if (presa_visione !== versioneInformativa && !esenteDaPresaVisione(req.path)) {
            const messaggio = "Prima di continuare leggi e accetta le condizioni d'uso.";
            if (req.originalUrl.startsWith('/api/')) return res.status(428).json({ message: messaggio, informativa_da_vedere: true, motivo: 'informativa', versione: versioneInformativa });
            if (req.method === 'GET' && req.accepts('html')) return res.redirect('/informativa.html?redirect=' + encodeURIComponent(req.originalUrl));
            return res.status(428).json({ message: messaggio, informativa_da_vedere: true, motivo: 'informativa' });
        }
        logger.debug(`[Auth OK] Utente: ${user.username}, Ruoli: ${ruoliEffettivi.join(', ')}, Path: ${req.originalUrl}`);
        next();
    } catch (err) {
        logger.warn(`[Auth Failed] Tentativo accesso a ${req.originalUrl}: ${err.message}`);

        res.clearCookie('__Secure-token', { path: '/' });
        res.clearCookie('username', { path: '/' });

        if (req.originalUrl.startsWith('/api/')) {
            // Token assente: 401. Scaduto o non valido: 403, il caso più
            // frequente; sessione_terminata dice al client di rifare l'accesso.
            const status = (err.name === 'MissingTokenError' || err.message.includes('not found')) ? 401 : 403;
            return res.status(status).json({ message: `Autenticazione fallita: ${err.message}`, sessione_terminata: true });
        } else if (req.accepts('html')) {
            const redirectUrl = '/login.html?redirect=' + encodeURIComponent(req.originalUrl);
            const finalUrl = (err.name !== 'MissingTokenError') ? `${redirectUrl}&error=invalid_token` : redirectUrl;
            logger.info(`[Auth Failed] Redirecting HTML request to: ${finalUrl}`);
            return res.redirect(finalUrl);
        } else {

            const status = (err.name === 'MissingTokenError' || err.message.includes('not found')) ? 401 : 403;
            return res.sendStatus(status);
        }
    }
}

// L'ultimo accesso in Gestione utenti: si scrive all'ingresso e, mentre la
// persona usa ORION (il web resta aperto per ore, l'app rinnova da sé), al
// massimo una volta ogni INTERVALLO_ACCESSO, senza far aspettare la richiesta.
const INTERVALLO_ACCESSO = 5 * 60 * 1000;
const ultimiAccessiScritti = new Map();

export function segnaAccesso(userId, subito = false) {
    const ora = Date.now();
    if (!subito && ora - (ultimiAccessiScritti.get(userId) || 0) < INTERVALLO_ACCESSO) return;
    ultimiAccessiScritti.set(userId, ora);
    pool.query('UPDATE users SET ultimo_accesso = NOW() WHERE id = $1', [userId])
        .catch(e => logger.warn(`[Auth] Ultimo accesso di ${userId} non registrato: ${e.message}`));
}

// I ruoli si sommano e stanno in utenti_ruoli. users.role è il più alto
// dell'ordine (permessi.js), per gli elenchi e l'app: si legge, e lo scrive
// solo scriviRuoli().

export function ruoloPrincipale(ruoli) {
    return ORDINE_RUOLI.find(r => ruoli.includes(r)) || 'volontario';
}

// I ruoli di chi fa la richiesta.
export function ruoliDi(utente) {
    if (!utente) return [];
    if (Array.isArray(utente.ruoli) && utente.ruoli.length > 0) return utente.ruoli;
    return utente.role ? [utente.role] : [];
}

export const COSTO_BCRYPT = 12;

// Una sessione nuova: il token firmato e il cookie per il browser. jwtid rende
// unici due accessi nello stesso secondo, che altrimenti si chiuderebbero a vicenda.
// mfa: la sessione è nata con la verifica in due passaggi (mfa.js).
export function emettiSessione(res, utente, ruoli, { mfa = false } = {}) {
    const ruoliUtente = (ruoli && ruoli.length > 0) ? ruoli : [utente.role];
    const principale = ruoloPrincipale(ruoliUtente);
    // ems: l'emissione al millisecondo (iat conta i secondi), per tokenSuperato.
    const token = jwt.sign({ id: utente.id, role: principale, ruoli: ruoliUtente, username: utente.username, ems: Date.now(), mfa: mfa === true },
        process.env.JWT_SECRET, { expiresIn: '1d', algorithm: 'HS256', jwtid: crypto.randomUUID() });
    res.cookie('__Secure-token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000,
        signed: true,
        path: '/'
    });
    segnaAccesso(utente.id, true);
    res.cookie('username', utente.username, { httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
    return { token, principale, ruoliUtente };
}

// Chiude tutte le sessioni di una persona e cancella i suoi token di rinnovo
// (cambio password, revoca). L'ora è quella di questo processo, lo stesso
// orologio che firma i token, non quella del database.
export async function chiudiSessioni(userId, esecutore = pool) {
    await esecutore.query('UPDATE users SET sessioni_valide_dal = to_timestamp($2::double precision / 1000) WHERE id = $1',
        [userId, Date.now()]);
    await esecutore.query('DELETE FROM token_rinnovo WHERE user_id = $1', [userId]);
    await esecutore.query('DELETE FROM token_avvisi WHERE user_id = $1', [userId]);
}

// Il token è stato emesso prima di una chiusura delle sessioni? Senza ems si
// usa iat, in secondi: nel dubbio il token cade.
export function tokenSuperato(utente, valideDal) {
    if (valideDal == null) return false;
    const soglia = Number(valideDal);
    if (Number.isInteger(utente?.ems)) return utente.ems < soglia;
    return Number.isInteger(utente?.iat) && utente.iat * 1000 < soglia;
}

// L'amministratore ha tutti i ruoli.
export function haRuolo(req, ...richiesti) {
    const ruoli = ruoliDi(req.user);
    if (ruoli.includes('admin')) return true;
    return richiesti.some(r => ruoli.includes(r));
}

// L'emergenza in corso la vede chiunque abbia una sessione, esterni compresi.
// Una chiusa è archivio, per chi consulta le emergenze passate; una
// segnalazione senza emergenza conta come chiusa.
export function puoVedereEmergenza(req, emergencyId) {
    if (activeEmergency && emergencyId != null && Number(emergencyId) === activeEmergency.id) return true;
    return haPermesso(req, 'emergenze.archivio');
}

// I permessi dati in più a una persona, per le risposte d'accesso.
export async function permessiDellaPersona(userId, ruoli, esecutore = pool) {
    const { rows } = await esecutore.query('SELECT permesso FROM utenti_permessi WHERE user_id = $1', [userId]);
    return permessiDi(ruoli, rows.map(r => r.permesso));
}

async function leggiRuoli(esecutore, userId) {
    const { rows } = await esecutore.query('SELECT ruolo FROM utenti_ruoli WHERE user_id = $1', [userId]);
    return rows.map(r => r.ruolo);
}

// Sostituisce i ruoli di una persona e riallinea users.role. Prima cancella,
// poi inserisce: il vincolo sull'esterno esclusivo lo richiede. I ruoli che
// restano non si toccano, e conservano la data di assegnazione.
export async function scriviRuoli(client, userId, ruoli) {
    const puliti = [...new Set((ruoli || []).map(r => String(r).trim()))].filter(r => ORDINE_RUOLI.includes(r));
    if (puliti.length === 0) {
        throw { customError: true, statusCode: 400, message: 'Serve almeno un ruolo.' };
    }
    if (puliti.includes('esterno') && puliti.length > 1) {
        throw { customError: true, statusCode: 400, message: 'Il ruolo esterno non si può combinare con altri ruoli.' };
    }
    await client.query('DELETE FROM utenti_ruoli WHERE user_id = $1 AND ruolo <> ALL($2::user_role[])', [userId, puliti]);
    await client.query(
        'INSERT INTO utenti_ruoli (user_id, ruolo) SELECT $1, unnest($2::user_role[]) ON CONFLICT DO NOTHING',
        [userId, puliti]
    );
    const principale = ruoloPrincipale(puliti);
    await client.query('UPDATE users SET role = $1 WHERE id = $2', [principale, userId]);
    return { ruoli: puliti, principale };
}

// I ruoli che si possono assegnare dal pannello utenti.
const RUOLI_ASSEGNABILI = ORDINE_RUOLI;

export function validaRuoliAssegnabili(ruoli) {
    const sconosciuti = ruoli.filter(r => !RUOLI_ASSEGNABILI.includes(r));
    if (sconosciuti.length > 0) {
        return `Ruolo non valido: ${sconosciuti.join(', ')}. Scegli tra ${RUOLI_ASSEGNABILI.join(', ')}.`;
    }
    // Il messaggio si dà qui: il vincolo del database direbbe "violazione di trigger".
    if (ruoli.includes('esterno') && ruoli.length > 1) {
        return 'Il ruolo esterno non si può combinare con altri ruoli.';
    }
    return null;
}

// I ruoli da una richiesta: "ruoli" (elenco) o "role" (uno solo).
export function ruoliDaRichiesta(corpo) {
    if (Array.isArray(corpo.ruoli)) return corpo.ruoli;
    if (typeof corpo.ruoli === 'string' && corpo.ruoli.trim()) return [corpo.ruoli.trim()];
    if (corpo.role) return [corpo.role];
    return [];
}

// Il nome per esteso, per i registri; lo username se manca.
export function nomeUtente(utente) {
    if (!utente) return null;
    const intero = `${utente.nome || ''} ${utente.cognome || ''}`.trim();
    return intero || utente.username || null;
}

// Gli esterni seguono l'emergenza ma non la gestiscono.
export function nonEsterni(req, res, next) {
    if (!ruoliDi(req.user).includes('esterno')) return next();
    logger.warn(`[Permessi] ${req.user?.username} (esterno) ha tentato ${req.method} ${req.originalUrl}`);
    return res.status(403).json({ message: 'Gli utenti esterni non possono comporre o gestire le squadre.' });
}

export function checkAdminRole(req, res, next) {

    if (haRuolo(req, 'admin')) {
        next(); // L'utente è admin, procedi
    } else {
        logger.warn(`[Admin Auth Failed] Utente ${req.user?.username || 'sconosciuto'} (ruoli: ${ruoliDi(req.user).join(', ') || 'nessuno'}) ha tentato accesso a risorsa admin: ${req.originalUrl}`);
        if (req.originalUrl.startsWith('/api')) {
            res.status(403).json({ message: 'Accesso negato: Permessi di amministratore richiesti.' });
        } else {

            res.status(403).send('<h1>Accesso Negato</h1><p>Permessi di amministratore richiesti.</p><p><a href="/centro-operativo.html">Torna al Centro Operativo</a></p>');
        }
    }
}

export async function checkSegreteriaAccess(req, res, next) {
    if (!req.user) return res.status(401).json({ message: 'Non autenticato.' });
    
    try {
        const confRes = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'segreteria_config'");
        let isEnabled = false;
        if (confRes.rowCount > 0 && confRes.rows[0].setting_value) {
            const config = typeof confRes.rows[0].setting_value === 'string' ? JSON.parse(confRes.rows[0].setting_value) : confRes.rows[0].setting_value;
            isEnabled = config.enabled === true;
        }

        if (!isEnabled) {
            return res.status(403).json({ message: 'Modulo Segreteria attualmente disabilitato dalle impostazioni.' });
        }

        if (haPermesso(req, 'volontari.sanitario')) {
            next();
        } else {
            logger.warn(`[SECURITY] Accesso negato area segreteria per ${req.user.username}`);
            res.status(403).json({ message: 'Privilegi insufficienti.' });
        }
    } catch(e) {
        return res.status(500).json({ message: 'Errore verifica configurazione.' });
    }
}

export function checkOwnershipOrSegreteria(req, res, next) {
    if (!req.user) return res.status(401).json({ message: 'Non autenticato.' });

    const targetUserId = parseInt(req.params.userId || req.params.id, 10);
    
    if (isNaN(targetUserId)) {
        return res.status(400).json({ message: 'ID utente non valido.' });
    }

    if (haPermesso(req, 'volontari.sanitario') || req.user.id === targetUserId) {
        next();
    } else {
        logger.warn(`[SECURITY IDOR] L'utente ${req.user.username} ha tentato di leggere/modificare i dati medici dell'utente ID ${targetUserId}. Accesso bloccato.`);
        res.status(403).json({ message: 'Accesso negato. Non sei autorizzato a visualizzare o modificare i documenti di un altro utente.' });
    }
}

// Anagrafica o dati sanitari: per le rotte che servono a entrambi (l'elenco dei volontari).
export function checkAdminOrSegreteriaRole(req, res, next) {
    if (haPermesso(req, 'volontari.anagrafica', 'volontari.sanitario')) {
        next(); 
    } else {
        logger.warn(`[Auth Failed] L'utente ${req.user?.username || 'sconosciuto'} (ruoli: ${ruoliDi(req.user).join(', ') || 'nessuno'}) ha tentato l'accesso a una risorsa admin/segreteria: ${req.originalUrl}`);
        res.status(403).json({ message: 'Accesso negato: Privilegi insufficienti.' });
    }
}
