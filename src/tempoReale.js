// Il WebSocket va solo dal server ai client. Il web riceve tutto, l'app solo quello
// che riguarda la persona e la sua squadra.

import cookie from 'cookie';
import cookieParser from 'cookie-parser';
import logger from './logger.js';
import { creaNotifiche } from './appMobile.js';
import { svegliaTelefoni } from './firebase.js';
import { quandoSiChiudonoLeSessioni, ruoliDi, tokenSuperato } from './autenticazione.js';
import { mfaRichiesta, permessiDi } from './permessi.js';
import { verifyJwtToken } from './authHelper.js';
import { telefonoCollegato, telefonoScollegato, tokenAvvisiDa, utenteDaTokenAvvisi } from './avvisi.js';
import { cookieSecret } from './config.js';
import { allowedOrigins } from './costanti.js';
import { pool } from './db.js';
import { activeEmergency } from './statoEmergenza.js';
import { WebSocketServer } from 'ws';

export const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

// Posizioni di tutte le squadre e diari consumano batteria e su un telefono perso non
// devono esserci. Gli avvisi di funzioni e mappa portano solo "rileggi".
const AZIONI_APP_SEMPRE = new Set(['notifica', 'emergency_status_change', 'emergency_deleted', 'reload_squadre', 'branding_updated',
    'reload_incarichi', 'reload_funzioni', 'reload_mappa']);
const AZIONI_APP_INTERVENTO = new Set(['reload_reports', 'new_report_update']);

async function interventiDellaPersona(userId, reportId = null) {
    const r = await pool.query(
        `SELECT DISTINCT rta.report_id
         FROM report_team_assignments rta
         JOIN squadra_membri sm ON sm.squadra_id = rta.squadra_id
         JOIN users u ON u.username = sm.username
         WHERE u.id = $1 AND ($2::int IS NULL OR rta.report_id = $2)`, [userId, reportId]);
    return r.rows.map(x => x.report_id);
}

async function inSquadra(userId) {
    const r = await pool.query(
        'SELECT 1 FROM squadra_membri sm JOIN users u ON u.username = sm.username WHERE u.id = $1 LIMIT 1', [userId]);
    return r.rowCount > 0;
}

async function interessaAllApp(ws, messaggio, visti) {
    // L'apertura arriva solo a chi è già in squadra (gli altri ricevono in_squadra quando
    // ci entrano); la chiusura a tutti.
    if (messaggio.action === 'emergency_status_change' && messaggio.status?.active) {
        return ruoliDi(ws.user).includes('esterno') || await inSquadra(ws.user.id);
    }
    if (AZIONI_APP_SEMPRE.has(messaggio.action)) return true;
    if (!AZIONI_APP_INTERVENTO.has(messaggio.action)) return false;
    const id = Number(messaggio.reportId ?? messaggio.updatedReportId ?? messaggio.createdReportId ?? messaggio.deletedReportId);
    if (!Number.isInteger(id) || id <= 0) return false;
    // Anche quelle già viste: l'app deve sapere che la squadra è stata tolta.
    if (visti.has(id)) return true;
    if ((await interventiDellaPersona(ws.user.id, id)).length > 0) {
        visti.add(id);
        return true;
    }
    return false;
}

// Gli invii passano uno alla volta, così l'ordine resta quello di partenza.
function filtraPerApp(ws) {
    const inviaDavvero = ws.send.bind(ws);
    const visti = new Set();
    let coda = interventiDellaPersona(ws.user.id)
        .then(ids => ids.forEach(id => visti.add(id)))
        .catch(e => logger.error('[WS app] Lettura degli interventi della squadra non riuscita:', e));
    ws.send = (dati, ...resto) => {
        coda = coda.then(async () => {
            let messaggio;
            try {
                messaggio = JSON.parse(dati);
            } catch {
                return;
            }
            if (!(await interessaAllApp(ws, messaggio, visti))) return;
            if (ws.readyState === 1) inviaDavvero(dati, ...resto);
        }).catch(e => logger.error(`[WS app ${ws.user?.username}] Invio non riuscito:`, e));
    };
}

// Il ping tiene aperta la strada nella rete mobile (che chiude i collegamenti muti) e
// fa cadere quelli morti. Più spesso costerebbe batteria.
const INTERVALLO_PING_AVVISI = 2 * 60 * 1000;
const AZIONI_AVVISI = new Set(['notifica', 'avvisi_configurazione']);

function soloAvvisi(ws) {
    const inviaDavvero = ws.send.bind(ws);
    ws.send = (dati, ...resto) => {
        try {
            if (!AZIONI_AVVISI.has(JSON.parse(dati).action)) return;
        } catch {
            return;
        }
        if (ws.readyState === 1) inviaDavvero(dati, ...resto);
    };
    telefonoCollegato(ws.avvisi);
    ws.vivo = true;
    ws.on('pong', () => { ws.vivo = true; });
    ws.on('ping', () => { ws.vivo = true; });
    ws.on('close', () => telefonoScollegato(ws.avvisi));
}

setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.avvisi) return;
        if (!ws.vivo) return ws.terminate();
        ws.vivo = false;
        try { ws.ping(); } catch { /* chiusa nel frattempo */ }
    });
}, INTERVALLO_PING_AVVISI).unref();

wss.on('connection', (ws, request) => {

    logger.info(`Nuova connessione WebSocketServer da utente: ${ws.user?.username || 'sconosciuto'}${ws.avvisi ? ' (avvisi)' : ws.app ? ' (app)' : ''}`);
    if (ws.avvisi) soloAvvisi(ws);
    else if (ws.app) filtraPerApp(ws);

    // Quello che manda un client non si inoltra: chiunque potrebbe spedire eventi falsi
    // a tutte le postazioni.
    ws.on('message', (message) => {
        try {
            const preview = (Buffer.isBuffer(message) ? message.toString('utf8') : String(message)).substring(0, 100);
            logger.debug(`[WS ${ws.user?.username || '??'}] Messaggio in ingresso ignorato (canale di sola notifica):`, { message: preview });
        } catch (e) {
            logger.error(`[WS ${ws.user?.username || '??'}] Errore lettura messaggio in ingresso:`, { error: e });
        }
    });

     ws.on('close', (code, reason) => {
         const reasonString = reason ? reason.toString() : 'Nessuna ragione specificata';
         logger.info(`Connessione WebSocket chiusa per utente ${ws.user?.username || 'sconosciuto'}. Codice: ${code}, Ragione: ${reasonString}`);
     });
     ws.on('error', (error) => logger.error(`Errore WebSocket per utente ${ws.user?.username || 'sconosciuto'}:`, error));
});

export function avvisaClienti(azione, dati = {}) {
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            try {
                client.send(JSON.stringify({ action: azione, ...dati }));
            } catch (e) {
                logger.error(`WS Send Error (${azione}):`, e);
            }
        }
    });
}

// Chi non è collegato troverà la stessa cosa nella coda di notifiche.
function avvisaUtente(userId, azione, dati = {}) {
    wss.clients.forEach(client => {
        if (client.readyState === 1 && client.user?.id === userId) {
            try {
                client.send(JSON.stringify({ action: azione, ...dati }));
            } catch (e) {
                logger.error(`WS Send Error (${azione} a utente ${userId}):`, e);
            }
        }
    });
}

export const notifiche = creaNotifiche({ pool, logger, avvisaUtente, svegliaTelefoni, inSimulazione: () => activeEmergency?.simulazione === true });

export function avvisaTelefoniInAscolto(azione = 'avvisi_configurazione') {
    wss.clients.forEach(client => {
        if (client.readyState === 1 && client.avvisi) {
            try {
                client.send(JSON.stringify({ action: azione }));
            } catch (e) {
                logger.error(`WS Send Error (${azione}):`, e);
            }
        }
    });
}

// Il cookie lo manda il browser anche quando il collegamento lo apre la pagina di un altro sito
// dello stesso dominio (SameSite guarda il dominio, non il sottodominio): conta da dove viene.
function origineAmmessa(request) {
    const origine = request.headers.origin;
    if (!origine || allowedOrigins.includes(origine)) return true;
    logger.warn(`WS Upgrade: origine '${String(origine).slice(0, 100)}' non ammessa per un collegamento con il cookie.`);
    return false;
}

function tokenDellaRichiesta(request) {
    try {
        const rawCookies = request.headers.cookie;
        if (rawCookies) {
            const rawTokenCookie = cookie.parse(rawCookies)['__Secure-token'];
            let daCookie = null;
            if (rawTokenCookie && cookieSecret) {
                const unsignedToken = cookieParser.signedCookie(rawTokenCookie, cookieSecret);
                if (unsignedToken !== false && unsignedToken) daCookie = unsignedToken;
            } else if (rawTokenCookie) {
                daCookie = rawTokenCookie;
            }
            if (daCookie) return origineAmmessa(request) ? daCookie : null;
        }
    } catch (e) { logger.error("WS Upgrade: Errore parsing cookies:", e); }
    const authHeader = request.headers['authorization'];
    if (authHeader?.toLowerCase().startsWith('bearer ')) return authHeader.substring(7) || null;
    return null;
}

// Gli stessi controlli di authenticateToken: un collegamento aperto con una sessione revocata
// continuerebbe a ricevere tutto.
const STATO_DELLA_SESSIONE = `
    EXISTS (SELECT 1 FROM revoked_tokens WHERE token = x.token) AS revocato,
    (SELECT COALESCE(is_active, true) FROM users WHERE id = x.uid) AS attivo,
    (SELECT (EXTRACT(EPOCH FROM sessioni_valide_dal) * 1000)::bigint FROM users WHERE id = x.uid) AS valide_dal,
    ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = x.uid) AS ruoli,
    ARRAY(SELECT permesso FROM utenti_permessi WHERE user_id = x.uid) AS permessi_in_piu`;

function motivoSessioneNonValida(utente, { revocato, attivo, valide_dal, ruoli, permessi_in_piu }) {
    if (revocato) return 'token revocato';
    if (attivo !== true) return 'account non attivo';
    if (tokenSuperato(utente, valide_dal)) return 'sessioni chiuse';
    if (mfaRichiesta(ruoli, permessiDi(ruoli, permessi_in_piu)) && utente.mfa !== true) return 'verifica in due passaggi mancante';
    if (Number.isInteger(utente.exp) && utente.exp * 1000 <= Date.now()) return 'token scaduto';
    return null;
}

export async function utenteDiSessione(request) {
    const token = tokenDellaRichiesta(request);
    if (!token) {
        logger.warn("WS Upgrade: Token non trovato. Connessione rifiutata.");
        return null;
    }
    try {
        const decodedUser = await verifyJwtToken(token);
        const stato = await pool.query(`SELECT ${STATO_DELLA_SESSIONE} FROM (SELECT $1::text AS token, $2::int AS uid) x`, [token, decodedUser.id]);
        const motivo = motivoSessioneNonValida(decodedUser, stato.rows[0]);
        if (motivo) {
            logger.warn(`WS Upgrade: sessione non più valida per ${decodedUser.username} (${motivo}).`);
            return null;
        }
        logger.info(`WS Upgrade: Autenticazione OK per ${decodedUser.username}. Procedo.`);
        return { utente: decodedUser, token };
    } catch (err) {
        logger.warn("WS Upgrade: Autenticazione fallita:", err.message);
        return null;
    }
}

export function chiudiCollegamentiDi(userId) {
    for (const ws of wss.clients) {
        if (Number(ws.user?.id) === Number(userId)) ws.close(4001, 'Sessione chiusa');
    }
}
quandoSiChiudonoLeSessioni(chiudiCollegamentiDi);

// Uscita, scadenza o revoca di un solo token non passano da chiudiSessioni: qui si ritrovano entro un minuto.
async function controllaCollegamenti() {
    const conSessione = [], conAvvisi = [];
    for (const ws of wss.clients) {
        if (ws.avvisi) conAvvisi.push(ws);
        else if (ws.token) conSessione.push(ws);
    }
    if (conSessione.length) {
        const { rows } = await pool.query(
            `SELECT x.i, ${STATO_DELLA_SESSIONE} FROM unnest($1::text[], $2::int[]) WITH ORDINALITY AS x(token, uid, i)`,
            [conSessione.map(ws => ws.token), conSessione.map(ws => ws.user.id)]);
        for (const riga of rows) {
            const ws = conSessione[Number(riga.i) - 1];
            const motivo = motivoSessioneNonValida(ws.user, riga);
            if (motivo) {
                logger.warn(`WS: chiudo il collegamento di ${ws.user.username} (${motivo}).`);
                ws.close(4001, 'Sessione non più valida');
            }
        }
    }
    if (conAvvisi.length) {
        const { rows } = await pool.query(
            `SELECT t.id FROM token_avvisi t JOIN users u ON u.id = t.user_id
              WHERE t.id = ANY($1::int[]) AND t.scade_il > NOW() AND COALESCE(u.is_active, true) = true AND u.eliminato_il IS NULL`,
            [conAvvisi.map(ws => ws.avvisi.token_id)]);
        const validi = new Set(rows.map(r => r.id));
        for (const ws of conAvvisi) {
            if (!validi.has(ws.avvisi.token_id)) ws.close(4001, 'Token degli avvisi non più valido');
        }
    }
}

const percorsiUpgrade = new Map();

export function aggiungiPercorsoUpgrade(percorso, gestore) {
    percorsiUpgrade.set(percorso, gestore);
}

export function avviaTempoReale(server) {
    // Le prove lo accorciano con ORION_CONTROLLO_COLLEGAMENTI_MS, per non aspettare un minuto la chiusura dopo l'uscita.
    const ogni = parseInt(process.env.ORION_CONTROLLO_COLLEGAMENTI_MS, 10) || 60 * 1000;
    setInterval(() => controllaCollegamenti().catch(e => logger.error('WS: controllo dei collegamenti non riuscito:', e)), ogni).unref();
    server.on('upgrade', async (request, socket, head) => {
        let percorso = '/';
        try { percorso = new URL(request.url, 'http://orion').pathname; } catch { /* resta la radice */ }
        const altro = percorsiUpgrade.get(percorso);
        if (altro) return altro(request, socket, head);
        const tokenAvvisi = tokenAvvisiDa(request.headers['authorization']);
        if (tokenAvvisi) {
            try {
                const utente = await utenteDaTokenAvvisi(tokenAvvisi);
                if (!utente) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }
                wss.handleUpgrade(request, socket, head, (ws) => {
                    ws.user = { id: utente.id, username: utente.username };
                    ws.avvisi = utente;
                    ws.app = true;
                    wss.emit('connection', ws, request);
                });
            } catch (e) {
                logger.error('WS Upgrade: verifica del token degli avvisi non riuscita:', e);
                socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
                socket.destroy();
            }
            return;
        }
        const sessione = await utenteDiSessione(request);
        if (!sessione) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            ws.user = sessione.utente;
            ws.token = sessione.token;
            ws.app = request.headers['x-orion-client'] === 'app';
            wss.emit('connection', ws, request);
        });
    });
}
