// Le notifiche Firebase, facoltative: ogni associazione che le vuole crea
// un suo progetto Firebase e ne carica qui i due file. Senza configurazione
// non cambia niente: il telefono resta in ascolto del server come sempre.
//
// Con Firebase il server non manda il contenuto delle notifiche a Google:
// manda solo un segnale vuoto ("ci sono novità") al telefono, che si sveglia
// e legge la coda dal server dell'associazione col token degli avvisi. A
// Google arrivano l'identificativo Firebase del telefono e l'ora.
//
// I file del progetto: google-services.json (gli identificativi pubblici
// dell'app, che il telefono riceve dal server) e la chiave dell'account di
// servizio (segreta, cifrata nel database, serve al server per mandare).

import crypto from 'crypto';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { checkAdminRole } from './autenticazione.js';
import { tokenAvvisiDa, utenteDaTokenAvvisi } from './avvisi.js';
import { cifraTesto, decifraTesto } from './cifratura.js';
import { pool } from './db.js';

export const PACCHETTO_APP = 'it.orion.app';
// Gli indirizzi di Google; le prove li sostituiscono con un Google finto.
const URL_TOKEN = process.env.ORION_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const URL_FCM = process.env.ORION_FCM_URL || 'https://fcm.googleapis.com';
const AMBITO = 'https://www.googleapis.com/auth/firebase.messaging';
const CHIAVE_APP = 'firebase_app';
const CHIAVE_ACCOUNT = 'firebase_account';
export const CHIAVI_FIREBASE = [CHIAVE_APP, CHIAVE_ACCOUNT];
// Più notifiche di fila alla stessa persona: un segnale solo.
const ATTESA_RAGGRUPPAMENTO_MS = 300;

class ConfigurazioneNonValida extends Error {}

// --- Lettura dei file del progetto -------------------------------------------

function comeOggetto(valore, nome) {
    if (valore && typeof valore === 'object' && !Array.isArray(valore)) return valore;
    if (typeof valore === 'string' && valore.length <= 100_000) {
        try {
            const o = JSON.parse(valore);
            if (o && typeof o === 'object' && !Array.isArray(o)) return o;
        } catch { /* sotto */ }
    }
    throw new ConfigurazioneNonValida(`Il file ${nome} non è un JSON valido.`);
}

/** Da google-services.json: gli identificativi dell'app ORION nel progetto. */
export function leggiGoogleServices(valore) {
    const g = comeOggetto(valore, 'google-services.json');
    const progetto = g.project_info?.project_id;
    const mittente = g.project_info?.project_number;
    if (typeof progetto !== 'string' || !/^[a-z0-9-]{4,40}$/.test(progetto) || !/^\d{4,20}$/.test(String(mittente || ''))) {
        throw new ConfigurazioneNonValida('Il file google-services.json non ha i dati del progetto: scaricalo dalle impostazioni del progetto Firebase.');
    }
    const cliente = (Array.isArray(g.client) ? g.client : [])
        .find(c => c?.client_info?.android_client_info?.package_name === PACCHETTO_APP);
    if (!cliente) {
        throw new ConfigurazioneNonValida(`Nel progetto Firebase manca l'app Android "${PACCHETTO_APP}": aggiungila e scarica di nuovo google-services.json.`);
    }
    const appId = cliente.client_info?.mobilesdk_app_id;
    const apiKey = (Array.isArray(cliente.api_key) ? cliente.api_key : []).map(k => k?.current_key).find(k => typeof k === 'string');
    if (typeof appId !== 'string' || !/^1:\d+:android:[0-9a-f]+$/.test(appId) || !apiKey || !/^[A-Za-z0-9_-]{20,100}$/.test(apiKey)) {
        throw new ConfigurazioneNonValida('Il file google-services.json è incompleto (identificativo dell\'app o chiave API).');
    }
    return { progetto, mittente: String(mittente), appId, apiKey };
}

/** La chiave dell'account di servizio: solo quello che serve per mandare. */
export function leggiAccount(valore, progetto) {
    const a = comeOggetto(valore, "della chiave dell'account di servizio");
    if (a.type !== 'service_account' || typeof a.client_email !== 'string' || typeof a.private_key !== 'string') {
        throw new ConfigurazioneNonValida("Il file non è la chiave di un account di servizio: in Firebase, Impostazioni progetto > Account di servizio > Genera nuova chiave privata.");
    }
    if (a.project_id !== progetto) {
        throw new ConfigurazioneNonValida(`La chiave è del progetto "${a.project_id}", google-services.json del progetto "${progetto}": devono essere dello stesso progetto.`);
    }
    try {
        crypto.createPrivateKey(a.private_key);
    } catch {
        throw new ConfigurazioneNonValida('La chiave privata nel file non è leggibile.');
    }
    return { client_email: a.client_email, private_key: a.private_key, project_id: a.project_id };
}

// --- Configurazione salvata ----------------------------------------------------

let memoria; // undefined: da leggere; null: non configurato
let accesso = null; // { token, scade, email }
let ultimoInvio = null;
let ultimoErrore = null;

async function leggi(chiave) {
    const r = await pool.query('SELECT setting_value FROM branding_settings WHERE setting_key = $1', [chiave]);
    return r.rows[0]?.setting_value || null;
}

async function configurazione() {
    if (memoria !== undefined) return memoria;
    try {
        const [app, account] = await Promise.all([leggi(CHIAVE_APP), leggi(CHIAVE_ACCOUNT)]);
        memoria = app && account ? { app: JSON.parse(app), account: JSON.parse(decifraTesto(account)) } : null;
    } catch (e) {
        logger.error(`[Firebase] Configurazione illeggibile: ${e.message}`);
        memoria = null;
    }
    return memoria;
}

function dimentica() {
    memoria = undefined;
    accesso = null;
    ultimoErrore = null;
}

/** Quello che il telefono deve sapere per collegarsi al progetto; null se Firebase è spento. */
export async function configurazionePubblica() {
    const c = await configurazione();
    if (!c) return null;
    return { progetto: c.app.progetto, app_id: c.app.appId, api_key: c.app.apiKey, mittente: c.app.mittente };
}

// --- Google ------------------------------------------------------------------

async function tokenDiAccesso(account, { nuovo = false } = {}) {
    if (!nuovo && accesso && accesso.email === account.client_email && accesso.scade > Date.now() + 60_000) return accesso.token;
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const ora = Math.floor(Date.now() / 1000);
    const dati = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: account.client_email, scope: AMBITO, aud: URL_TOKEN, iat: ora, exp: ora + 3600 })}`;
    const firma = crypto.sign('RSA-SHA256', Buffer.from(dati), account.private_key).toString('base64url');
    const risposta = await fetch(URL_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${dati}.${firma}` }),
        signal: AbortSignal.timeout(15_000)
    });
    const corpo = await risposta.json().catch(() => ({}));
    if (!risposta.ok || typeof corpo.access_token !== 'string') {
        throw new Error(`Google non ha accettato la chiave (${risposta.status}${corpo.error_description ? `: ${corpo.error_description}` : corpo.error ? `: ${corpo.error}` : ''}).`);
    }
    accesso = { token: corpo.access_token, scade: Date.now() + (Number(corpo.expires_in) || 3600) * 1000, email: account.client_email };
    return accesso.token;
}

/**
 * Un segnale a un telefono. Restituisce 'ok', 'non_valido' (il telefono non
 * è più registrato: l'identificativo si toglie) o lancia per gli altri errori.
 */
async function manda(conf, fcmToken, dati) {
    for (let tentativo = 0; tentativo < 2; tentativo++) {
        const token = await tokenDiAccesso(conf.account, { nuovo: tentativo > 0 });
        const risposta = await fetch(`${URL_FCM}/v1/projects/${encodeURIComponent(conf.app.progetto)}/messages:send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                message: {
                    token: fcmToken,
                    data: dati,
                    // Alta priorità: il telefono si sveglia anche in risparmio
                    // energetico. Più segnali in attesa diventano uno.
                    android: { priority: 'HIGH', ttl: '86400s', collapse_key: 'orion' }
                }
            }),
            signal: AbortSignal.timeout(15_000)
        });
        if (risposta.ok) return 'ok';
        const corpo = await risposta.json().catch(() => ({}));
        const codici = (corpo.error?.details || []).map(d => d?.errorCode).filter(Boolean);
        if (risposta.status === 401 && tentativo === 0) continue; // token di accesso scaduto prima del previsto
        if (risposta.status === 404 || codici.includes('UNREGISTERED') || (risposta.status === 400 && codici.includes('INVALID_ARGUMENT'))) return 'non_valido';
        throw new Error(`Firebase ha risposto ${risposta.status}${corpo.error?.message ? `: ${corpo.error.message}` : ''}.`);
    }
    throw new Error('Firebase non accetta il token di accesso.');
}

async function mandaATutti(conf, righe, dati) {
    let mandati = 0;
    for (const r of righe) {
        try {
            const esito = await manda(conf, r.fcm_token, dati);
            if (esito === 'ok') mandati++;
            else await pool.query('UPDATE token_avvisi SET fcm_token = NULL, fcm_progetto = NULL, fcm_il = NULL WHERE id = $1 AND fcm_token = $2', [r.id, r.fcm_token]);
        } catch (e) {
            ultimoErrore = { il: new Date(), messaggio: e.message };
            logger.warn(`[Firebase] Segnale non mandato: ${e.message}`);
        }
    }
    if (mandati) ultimoInvio = new Date();
    return mandati;
}

// --- Il segnale delle notifiche ----------------------------------------------

const inAttesa = new Set();

/**
 * Una notifica nuova per la persona: se Firebase è configurato si svegliano
 * i suoi telefoni registrati. Non lancia e non fa aspettare chi notifica.
 */
export function svegliaTelefoni(userId) {
    if (!userId || inAttesa.has(userId)) return;
    inAttesa.add(userId);
    setTimeout(async () => {
        inAttesa.delete(userId);
        try {
            const conf = await configurazione();
            if (!conf) return;
            const r = await pool.query(
                `SELECT id, fcm_token FROM token_avvisi
                  WHERE user_id = $1 AND fcm_token IS NOT NULL AND fcm_progetto = $2 AND scade_il > NOW()`,
                [userId, conf.app.progetto]);
            if (r.rowCount) await mandaATutti(conf, r.rows, { orion: 'novita' });
        } catch (e) {
            logger.warn(`[Firebase] Telefoni di ${userId} non svegliati: ${e.message}`);
        }
    }, ATTESA_RAGGRUPPAMENTO_MS).unref?.();
}

// Prima di spegnere o cambiare progetto: i telefoni registrati rileggono la
// configurazione e tornano ad ascoltare il server da soli.
async function avvisaCambio(conf) {
    if (!conf) return 0;
    const r = await pool.query('SELECT id, fcm_token FROM token_avvisi WHERE fcm_token IS NOT NULL AND fcm_progetto = $1 AND scade_il > NOW()', [conf.app.progetto]);
    return r.rowCount ? mandaATutti(conf, r.rows, { orion: 'configurazione' }) : 0;
}

// --- Rotte -------------------------------------------------------------------

/** Col token degli avvisi, prima della sessione: la configurazione e la registrazione del telefono. */
export function registraRotteFirebaseTelefono(app) {
    async function utenteDa(req, res) {
        const utente = await utenteDaTokenAvvisi(tokenAvvisiDa(req.headers.authorization));
        if (!utente) res.status(401).json({ message: 'Token degli avvisi non valido.', avvisi_revocati: true });
        return utente;
    }

    app.get('/api/avvisi/configurazione', async (req, res) => {
        try {
            if (!(await utenteDa(req, res))) return;
            res.json({ firebase: await configurazionePubblica() });
        } catch (e) {
            logger.error('Errore GET /api/avvisi/configurazione:', e);
            res.status(500).json({ message: 'Errore nel leggere la configurazione degli avvisi.' });
        }
    });

    // Il telefono dice il suo identificativo Firebase (o null: non lo usa più).
    app.put('/api/avvisi/firebase', async (req, res) => {
        const fcm = req.body?.token ?? null;
        const progetto = req.body?.progetto ?? null;
        if (fcm !== null && (typeof fcm !== 'string' || fcm.length < 20 || fcm.length > 4096 || /\s/.test(fcm))) {
            return res.status(400).json({ message: 'Identificativo Firebase non valido.' });
        }
        try {
            const utente = await utenteDa(req, res);
            if (!utente) return;
            if (fcm === null) {
                await pool.query('UPDATE token_avvisi SET fcm_token = NULL, fcm_progetto = NULL, fcm_il = NULL WHERE id = $1', [utente.token_id]);
                return res.json({ firebase: false });
            }
            const conf = await configurazionePubblica();
            // Il progetto è cambiato o Firebase è spento: il telefono rilegge la configurazione.
            if (!conf || conf.progetto !== progetto) return res.status(409).json({ message: 'La configurazione di Firebase è cambiata.', firebase: conf });
            // Lo stesso telefono con l'app reinstallata: un identificativo, una riga.
            await pool.query('UPDATE token_avvisi SET fcm_token = NULL, fcm_progetto = NULL, fcm_il = NULL WHERE fcm_token = $1 AND id <> $2', [fcm, utente.token_id]);
            await pool.query('UPDATE token_avvisi SET fcm_token = $2, fcm_progetto = $3, fcm_il = NOW() WHERE id = $1', [utente.token_id, fcm, progetto]);
            res.json({ firebase: true });
        } catch (e) {
            logger.error('Errore PUT /api/avvisi/firebase:', e);
            res.status(500).json({ message: "Errore nel registrare il telefono su Firebase." });
        }
    });
}

/** Per l'amministratore: lo stato, la configurazione, lo spegnimento. */
export function registraRotteFirebase(app, { avvisaTelefoni = () => {} } = {}) {
    async function stato() {
        const conf = await configurazione();
        if (!conf) return { configurato: false };
        const r = await pool.query(
            'SELECT COUNT(*)::int AS n FROM token_avvisi WHERE fcm_token IS NOT NULL AND fcm_progetto = $1 AND scade_il > NOW()', [conf.app.progetto]);
        const quando = await pool.query('SELECT updated_at FROM branding_settings WHERE setting_key = $1', [CHIAVE_APP]);
        return {
            configurato: true,
            progetto: conf.app.progetto,
            app_id: conf.app.appId,
            account: conf.account.client_email,
            configurato_il: quando.rows[0]?.updated_at || null,
            telefoni: r.rows[0].n,
            ultimo_invio: ultimoInvio,
            ultimo_errore: ultimoErrore
        };
    }

    app.get('/api/admin/firebase', checkAdminRole, async (req, res) => {
        try {
            res.json(await stato());
        } catch (e) {
            logger.error('Errore GET /api/admin/firebase:', e);
            res.status(500).json({ message: 'Errore nel leggere lo stato di Firebase.' });
        }
    });

    app.put('/api/admin/firebase', checkAdminRole, async (req, res) => {
        let nuova;
        try {
            const appFirebase = leggiGoogleServices(req.body?.google_services);
            nuova = { app: appFirebase, account: leggiAccount(req.body?.account, appFirebase.progetto) };
        } catch (e) {
            if (e instanceof ConfigurazioneNonValida) return res.status(400).json({ message: e.message });
            throw e;
        }
        try {
            // Prima di salvare: Google deve accettare la chiave.
            try {
                await tokenDiAccesso(nuova.account, { nuovo: true });
            } catch (e) {
                accesso = null;
                return res.status(422).json({ message: `La chiave non funziona: ${e.message}` });
            }
            const precedente = await configurazione();
            if (precedente && precedente.app.progetto !== nuova.app.progetto) await avvisaCambio(precedente).catch(() => {});
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const scrivi = (k, v) => client.query(
                    `INSERT INTO branding_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, NOW())
                     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`, [k, v]);
                await scrivi(CHIAVE_APP, JSON.stringify(nuova.app));
                await scrivi(CHIAVE_ACCOUNT, cifraTesto(JSON.stringify(nuova.account)));
                // I telefoni registrati su un altro progetto si registrano di nuovo.
                await client.query('UPDATE token_avvisi SET fcm_token = NULL, fcm_progetto = NULL, fcm_il = NULL WHERE fcm_progetto IS DISTINCT FROM $1', [nuova.app.progetto]);
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                throw e;
            } finally {
                client.release();
            }
            dimentica();
            registraAudit(req, 'firebase.configurato', { tipo: 'impostazioni', dettagli: { progetto: nuova.app.progetto, account: nuova.account.client_email } });
            logger.info(`Admin ${req.user.username} ha configurato Firebase (progetto ${nuova.app.progetto}).`);
            avvisaTelefoni();
            res.json({ message: 'Firebase configurato: i telefoni passano alle notifiche Firebase la prossima volta che si collegano.', ...(await stato()) });
        } catch (e) {
            logger.error('Errore PUT /api/admin/firebase:', e);
            res.status(500).json({ message: 'Errore nel salvare la configurazione di Firebase.' });
        }
    });

    app.delete('/api/admin/firebase', checkAdminRole, async (req, res) => {
        try {
            const precedente = await configurazione();
            if (!precedente) return res.json({ message: 'Firebase non era configurato.', configurato: false });
            const avvisati = await avvisaCambio(precedente).catch(() => 0);
            await pool.query('DELETE FROM branding_settings WHERE setting_key = ANY($1::text[])', [CHIAVI_FIREBASE]);
            await pool.query('UPDATE token_avvisi SET fcm_token = NULL, fcm_progetto = NULL, fcm_il = NULL WHERE fcm_token IS NOT NULL');
            dimentica();
            ultimoInvio = null;
            registraAudit(req, 'firebase.spento', { tipo: 'impostazioni', dettagli: { progetto: precedente.app.progetto } });
            logger.info(`Admin ${req.user.username} ha spento Firebase.`);
            avvisaTelefoni();
            res.json({ message: `Firebase spento: i telefoni tornano ad ascoltare il server${avvisati ? ` (${avvisati} avvisati subito)` : ''}.`, configurato: false });
        } catch (e) {
            logger.error('Errore DELETE /api/admin/firebase:', e);
            res.status(500).json({ message: 'Errore nello spegnere Firebase.' });
        }
    });
}
