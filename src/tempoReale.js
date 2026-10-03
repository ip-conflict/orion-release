// src/tempoReale.js
//
// Il WebSocket: dal server ai client, mai il contrario. Il web riceve tutto,
// l'app solo quello che riguarda la persona e la sua squadra.

import cookie from 'cookie';
import cookieParser from 'cookie-parser';
import logger from './logger.js';
import { creaNotifiche } from './appMobile.js';
import { tokenSuperato } from './autenticazione.js';
import { verifyJwtToken } from './authHelper.js';
import { cookieSecret } from './config.js';
import { pool } from './db.js';
import { WebSocketServer } from 'ws';

// Il canale va solo dal server ai client: messaggi in arrivo piccoli e ignorati.
export const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

// Le connessioni dell'app (X-Orion-Client: app) ricevono solo quello che
// riguarda la persona: le posizioni di tutte le squadre e il diario di ogni
// segnalazione consumano batteria e su un telefono perso non devono esserci.
const AZIONI_APP_SEMPRE = new Set(['notifica', 'emergency_status_change', 'emergency_deleted', 'reload_squadre', 'branding_updated']);
const AZIONI_APP_INTERVENTO = new Set(['reload_reports', 'new_report_update']);

// Le segnalazioni assegnate adesso alla squadra di questa persona.
async function interventiDellaPersona(userId, reportId = null) {
    const r = await pool.query(
        `SELECT DISTINCT rta.report_id
         FROM report_team_assignments rta
         JOIN squadra_membri sm ON sm.squadra_id = rta.squadra_id
         JOIN users u ON u.username = sm.username
         WHERE u.id = $1 AND ($2::int IS NULL OR rta.report_id = $2)`, [userId, reportId]);
    return r.rows.map(x => x.report_id);
}

async function interessaAllApp(ws, messaggio, visti) {
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

// Il filtro sta qui, davanti all'invio: il resto del server manda a tutti. Gli
// invii passano uno alla volta, così l'ordine resta quello di partenza.
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

wss.on('connection', (ws, request) => {

    logger.info(`Nuova connessione WebSocketServer da utente: ${ws.user?.username || 'sconosciuto'}${ws.app ? ' (app)' : ''}`);
    if (ws.app) filtraPerApp(ws);

    // Quello che manda un client non si inoltra a nessuno: chiunque potrebbe
    // spedire a tutte le postazioni eventi falsi.
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

// Avvisa tutte le postazioni collegate che qualcosa è cambiato.
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

// Come avvisaClienti, ma solo alle connessioni di una persona: il web aperto
// su un computer e l'app sul telefono ricevono entrambi. Chi non è collegato
// troverà la stessa cosa nella coda di notifiche.
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

// La coda di notifiche per persona, letta dall'app.
export const notifiche = creaNotifiche({ pool, logger, avvisaUtente });

export function avviaTempoReale(server) {
    // Il WebSocket si apre solo con una sessione valida.
    server.on('upgrade', async (request, socket, head) => {
        let token = null;
        // Dal cookie (web) o dall'intestazione Authorization (app).
        try {
            const rawCookies = request.headers.cookie;
            if (rawCookies) {
                const parsedCookies = cookie.parse(rawCookies);
                let rawTokenCookie = parsedCookies['__Secure-token'];
                if (rawTokenCookie && cookieSecret) {
                    const unsignedToken = cookieParser.signedCookie(rawTokenCookie, cookieSecret);
                    token = (unsignedToken !== false) ? unsignedToken : null;
                } else {
                    token = rawTokenCookie;
                }
                if(token) logger.debug("WS Upgrade: Token trovato nel cookie.");
            }
        } catch (e) { logger.error("WS Upgrade: Errore parsing cookies:", e); }


        if (!token) {
            const authHeader = request.headers['authorization'];
            if (authHeader?.toLowerCase().startsWith('bearer ')) {
                token = authHeader.substring(7);
                if(token) logger.debug("WS Upgrade: Token trovato nell'header Authorization.");
            }
        }


        if (!token) {
            logger.warn("WS Upgrade: Token non trovato. Connessione rifiutata.");
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        try {
            const decodedUser = await verifyJwtToken(token);
            // Gli stessi controlli di authenticateToken: token revocato, account sospeso.

            const stato = await pool.query(
                `SELECT EXISTS (SELECT 1 FROM revoked_tokens WHERE token = $1) AS revocato,
                    (SELECT COALESCE(is_active, true) FROM users WHERE id = $2) AS attivo,
                    (SELECT (EXTRACT(EPOCH FROM sessioni_valide_dal) * 1000)::bigint FROM users WHERE id = $2) AS valide_dal`,
                [token, decodedUser.id]);
            const { revocato, attivo, valide_dal } = stato.rows[0];
            if (revocato || attivo !== true || tokenSuperato(decodedUser, valide_dal)) {
                logger.warn(`WS Upgrade: sessione non più valida per ${decodedUser.username} (${revocato ? 'token revocato' : 'account non attivo'}).`);
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            logger.info(`WS Upgrade: Autenticazione OK per ${decodedUser.username}. Procedo.`);
            wss.handleUpgrade(request, socket, head, (ws) => {
                ws.user = decodedUser;
                ws.app = request.headers['x-orion-client'] === 'app';
                wss.emit('connection', ws, request);
            });
        } catch (err) {
            logger.warn("WS Upgrade: Autenticazione fallita:", err.message);
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
        }
    });
}
