// Il telefono come secondo fattore e l'attivazione dell'account dall'app. Vedi il manuale tecnico.

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { appDistribuita } from './appMobile.js';
import { registraAudit } from './audit.js';
import { COSTO_BCRYPT, chiudiSessioni, emettiSessione, permessiDellaPersona } from './autenticazione.js';
import { tokenAvvisiDa, utenteDaTokenAvvisi } from './avvisi.js';
import { pool } from './db.js';
import { sendEmailUtility } from './email.js';
import { testiInVigore } from './informativa.js';
import {
    accessoVerificato, chiudiSfida, leggiUtente, mfaObbligatoria, nuoviCodiciRiserva, sfidaValida, troppiTentativi
} from './mfa.js';
import { apiLimiter, passwordLimiter } from './middleware/rateLimiters.js';
import { controllaPassword } from './password.js';
import { versioneInformativa } from './statoInformativa.js';

const DURATA_CONFERMA = 2 * 60 * 1000;
const CONFERME_PER_SFIDA = 3;
const MAX_TELEFONI = 5;
const MAX_CONFERME = 5000;

// I testi firmati cominciano ognuno in modo diverso: una firma non vale per un'altra operazione.
export const testoCollega = (chiave) => `orion-collega:${chiave}`;
export const testoAccesso = (sfida) => `orion-accesso:${sfida}`;
export const testoConferma = (id, numero) => `orion-conferma:${id}:${numero}`;

export function chiavePubblica(testo) {
    if (typeof testo !== 'string' || testo.length > 400) return null;
    try {
        const k = crypto.createPublicKey({ key: Buffer.from(testo, 'base64'), format: 'der', type: 'spki' });
        if (k.asymmetricKeyType !== 'ec' || k.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
        return k.export({ format: 'der', type: 'spki' }).toString('base64');
    } catch {
        return null;
    }
}

export function firmaValida(chiave, testo, firma) {
    if (typeof firma !== 'string' || firma.length > 200) return false;
    try {
        const k = crypto.createPublicKey({ key: Buffer.from(chiave, 'base64'), format: 'der', type: 'spki' });
        return crypto.verify('sha256', Buffer.from(testo, 'utf8'), k, Buffer.from(firma, 'base64'));
    } catch {
        return false;
    }
}

const nomeTelefono = (nome) => (typeof nome === 'string' && nome.trim() ? nome.trim().slice(0, 100) : 'Telefono');

async function telefonoDi(userId, id) {
    const r = await pool.query('SELECT id, chiave_pubblica, nome FROM telefoni_chiave WHERE id = $1 AND user_id = $2', [Number(id) || 0, userId]);
    return r.rows[0] || null;
}

// Senza transazione esterna apre la sua; con esecutore la fa il chiamante.
async function collegaTelefono(esecutore, utente, { chiave, nome, firma }) {
    const pubblica = chiavePubblica(chiave);
    if (!pubblica) return { errore: 'Chiave del telefono non valida: aggiorna l\'app.' };
    if (!firmaValida(pubblica, testoCollega(pubblica), firma)) return { errore: 'Il telefono non ha confermato la chiave: riprova.' };
    const n = await esecutore.query('SELECT count(*)::int AS n FROM telefoni_chiave WHERE user_id = $1', [utente.id]);
    if (n.rows[0].n >= MAX_TELEFONI) return { errore: `Hai già ${MAX_TELEFONI} telefoni collegati: togline uno dal profilo.` };
    const r = await esecutore.query(
        `INSERT INTO telefoni_chiave (user_id, chiave_pubblica, nome) VALUES ($1, $2, $3)
         ON CONFLICT (chiave_pubblica) DO NOTHING RETURNING id`, [utente.id, pubblica, nomeTelefono(nome)]);
    if (!r.rowCount) return { errore: 'Questo telefono è già collegato.' };
    let codici = null;
    if (!utente.mfa_attiva) {
        await esecutore.query('UPDATE users SET mfa_attiva = true, mfa_attivata_il = NOW() WHERE id = $1', [utente.id]);
        codici = await nuoviCodiciRiserva(esecutore, utente.id);
    }
    return { id: r.rows[0].id, codici };
}

async function inTransazione(lavoro) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const esito = await lavoro(client);
        await client.query(esito?.errore ? 'ROLLBACK' : 'COMMIT');
        return esito;
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

// Chi ha solo la password non deve poter aggiungere un telefono senza che la persona lo sappia.
function avvisaNuovoTelefono(notifiche, utente, nome) {
    notifiche?.notifica(utente.id, {
        tipo: 'telefono_collegato', titolo: 'Nuovo telefono collegato',
        testo: `${nomeTelefono(nome)} ora conferma i tuoi accessi. Se non sei stato tu, avvisa subito un amministratore.`
    });
    if (utente.email) {
        sendEmailUtility(utente.email, 'ORION: nuovo telefono collegato',
            `Ciao ${utente.nome || utente.username},\n\n${nomeTelefono(nome)} ora conferma i tuoi accessi a ORION.\nSe non sei stato tu, avvisa subito un amministratore.`)
            .catch(e => logger.warn(`[Telefoni] Email di avviso non mandata a ${utente.username}: ${e.message}`));
    }
}

function descriviBrowser(agente = '') {
    const a = String(agente);
    const browser = /Edg\//.test(a) ? 'Edge' : /OPR\//.test(a) ? 'Opera' : /Firefox\//.test(a) ? 'Firefox'
        : /Chrome\//.test(a) ? 'Chrome' : /Safari\//.test(a) ? 'Safari' : 'un browser';
    const sistema = /Windows/.test(a) ? 'Windows' : /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iPhone'
        : /Mac OS X/.test(a) ? 'Mac' : /Linux/.test(a) ? 'Linux' : null;
    return sistema ? `${browser} su ${sistema}` : browser;
}

const conferme = new Map();

function pulisciConferme() {
    const ora = Date.now();
    for (const [k, v] of conferme) if (v.scade + DURATA_CONFERMA < ora) conferme.delete(k);
    while (conferme.size >= MAX_CONFERME) conferme.delete(conferme.keys().next().value);
}

function scelteCon(numero) {
    const insieme = new Set([numero]);
    while (insieme.size < 3) insieme.add(crypto.randomInt(10, 100));
    const scelte = [...insieme];
    for (let i = scelte.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [scelte[i], scelte[j]] = [scelte[j], scelte[i]];
    }
    return scelte;
}

async function utenteDelLink(id, token) {
    if (typeof token !== 'string' || !token || token.length > 200 || !Number.isInteger(Number(id))) return null;
    const r = await pool.query(
        `SELECT id, username, nome, cognome, email, role, reset_token, reset_token_expires, mfa_attiva,
                COALESCE(is_active, true) AS is_active, temporaneo,
                ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = users.id) AS ruoli
           FROM users WHERE id = $1 AND eliminato_il IS NULL`, [Number(id)]);
    const u = r.rows[0];
    if (!u || !u.reset_token || !u.reset_token_expires || new Date() > new Date(u.reset_token_expires)) return null;
    if (!await bcrypt.compare(token, u.reset_token)) return null;
    if (!u.ruoli?.length) u.ruoli = [u.role];
    return u;
}

async function associazione() {
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'association_name'");
    return String(r.rows[0]?.setting_value || '').trim() || null;
}

async function apkPresente(cartellaApk) {
    try {
        return await appDistribuita(pool) && fs.existsSync(path.join(cartellaApk, 'orion.apk'));
    } catch {
        return false;
    }
}

export function registraRotteTelefoniPubbliche(app, { notifiche, cartellaApk }) {
    app.get('/api/attivazione', passwordLimiter, async (req, res) => {
        try {
            const u = await utenteDelLink(req.query.id, req.query.token);
            if (!u) return res.status(400).json({ message: 'Il link è scaduto o è già stato usato: chiedi a chi ti ha iscritto di mandartene uno nuovo.' });
            const obbligatoria = mfaObbligatoria(u.ruoli, await permessiDellaPersona(u.id, u.ruoli));
            res.json({
                nome: u.nome, cognome: u.cognome, username: u.username,
                associazione: await associazione(),
                verifica: u.mfa_attiva ? 'attiva' : obbligatoria ? 'obbligatoria' : 'facoltativa',
                condizioni: versioneInformativa,
                app: await apkPresente(cartellaApk)
            });
        } catch (e) {
            logger.error('[Attivazione] Errore lettura del link:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    // Un link di ripristino non collega un telefono a chi ha già la verifica: varrebbe
    // a scavalcarla con la sola email.
    app.post('/api/attivazione', passwordLimiter, async (req, res) => {
        const { id, token, password, condizioni, telefono } = req.body || {};
        try {
            const u = await utenteDelLink(id, token);
            if (!u) return res.status(400).json({ message: 'Il link è scaduto o è già stato usato: chiedi a chi ti ha iscritto di mandartene uno nuovo.' });
            if (!u.is_active || u.temporaneo) return res.status(403).json({ message: 'Questo account non si può attivare. Chiedi alla segreteria.' });
            const problema = controllaPassword(password, u);
            if (problema) return res.status(400).json({ message: problema, campo: 'password' });
            if (Number(condizioni) !== versioneInformativa) {
                return res.status(409).json({ message: "Le condizioni d'uso sono cambiate: rileggile.", versione: versioneInformativa });
            }
            const obbligatoria = mfaObbligatoria(u.ruoli, await permessiDellaPersona(u.id, u.ruoli));
            const conTelefono = !u.mfa_attiva && telefono && typeof telefono === 'object';
            if (obbligatoria && !u.mfa_attiva && !conTelefono) {
                return res.status(400).json({ message: 'Per il tuo ruolo serve collegare il telefono.', campo: 'telefono' });
            }
            const hash = await bcrypt.hash(password, COSTO_BCRYPT);
            const { impronta } = await testiInVigore();
            req.user = { id: u.id, username: u.username };
            const esito = await inTransazione(async (client) => {
                const r = await client.query(
                    `UPDATE users SET password = $2, reset_token = NULL, reset_token_expires = NULL,
                            presa_visione_versione = $3, presa_visione_il = NOW()
                      WHERE id = $1 AND reset_token = $4`, [u.id, hash, versioneInformativa, u.reset_token]);
                if (!r.rowCount) return { errore: 'Il link è già stato usato.' };
                await client.query(
                    `INSERT INTO prese_visione (user_id, persona, versione, impronta_testi, canale) VALUES ($1, $2, $3, $4, 'app')`,
                    [u.id, `${[u.nome, u.cognome].filter(Boolean).join(' ') || u.username} (${u.username})`, versioneInformativa, impronta]);
                await chiudiSessioni(u.id, client);
                return conTelefono ? collegaTelefono(client, u, telefono) : {};
            });
            if (esito.errore) return res.status(400).json({ message: esito.errore, campo: conTelefono ? 'telefono' : undefined });
            registraAudit(req, 'utente.attivato', { tipo: 'utente', id: u.id, dettagli: { canale: 'app', telefono: !!esito.id } });
            registraAudit(req, 'condizioni.accettate', { tipo: 'utente', id: u.id, dettagli: { versione: versioneInformativa, canale: 'app' } });
            if (esito.id) registraAudit(req, 'mfa.telefono_collegato', { tipo: 'utente', id: u.id, dettagli: { telefono: esito.id, attivazione: true } });
            logger.info(`[Attivazione] ${u.username} ha attivato l'account dall'app${esito.id ? ' collegando il telefono' : ''}.`);
            if (u.mfa_attiva) return res.json({ username: u.username, accedi: true, message: 'Password salvata: ora accedi.' });
            const { token: sessione, principale, ruoliUtente } = emettiSessione(res, u, u.ruoli, { mfa: !!esito.id });
            res.json({
                message: 'Account attivato', userId: u.id, username: u.username, role: principale, ruoli: ruoliUtente,
                permessi: await permessiDellaPersona(u.id, ruoliUtente), token: sessione,
                telefono: esito.id || null, codici_riserva: esito.codici || null
            });
        } catch (e) {
            logger.error('[Attivazione] Errore:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.post('/api/accesso/telefono', passwordLimiter, async (req, res) => {
        const id = req.body?.sfida;
        const sfida = sfidaValida(id);
        if (!sfida || sfida.tipo !== 'codice') return res.status(401).json({ message: "Tempo scaduto: rifai l'accesso con la password.", sfida_scaduta: true });
        try {
            const utente = await leggiUtente(sfida.userId);
            if (!utente?.telefoni) return res.status(409).json({ message: 'Non hai telefoni collegati: usa il codice.' });
            if ((sfida.conferme = (sfida.conferme || 0) + 1) > CONFERME_PER_SFIDA) {
                chiudiSfida(id);
                return res.status(401).json({ message: "Troppe richieste: rifai l'accesso con la password.", sfida_scaduta: true });
            }
            pulisciConferme();
            const numero = crypto.randomInt(10, 100);
            const conferma = crypto.randomBytes(18).toString('base64url');
            conferme.set(conferma, {
                userId: utente.id, numero, scelte: scelteCon(numero), stato: 'attesa',
                creata: Date.now(), scade: Date.now() + DURATA_CONFERMA,
                browser: descriviBrowser(req.get('user-agent')), indirizzo: req.ip
            });
            if (sfida.conferma) conferme.delete(sfida.conferma);
            sfida.conferma = conferma;
            notifiche?.notifica(utente.id, {
                tipo: 'conferma_accesso', titolo: 'Stai entrando in ORION?', testo: 'Tocca per confermare.',
                chiave: `conferma:${conferma}`, categoria: 'personale', oreValidita: 1
            });
            res.json({ numero, secondi: DURATA_CONFERMA / 1000 });
        } catch (e) {
            logger.error('[Telefoni] Errore nella richiesta di conferma:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.post('/api/accesso/telefono/stato', apiLimiter, async (req, res) => {
        const id = req.body?.sfida;
        const sfida = sfidaValida(id);
        if (!sfida) return res.status(401).json({ message: "Tempo scaduto: rifai l'accesso con la password.", sfida_scaduta: true });
        const c = sfida.conferma && conferme.get(sfida.conferma);
        if (!c) return res.status(409).json({ message: 'Nessuna conferma in corso.' });
        if (c.stato === 'rifiutata') {
            chiudiSfida(id);
            conferme.delete(sfida.conferma);
            return res.status(401).json({ message: 'Accesso rifiutato dal telefono.', rifiutata: true, sfida_scaduta: true });
        }
        if (c.stato === 'attesa') {
            if (c.scade < Date.now()) return res.status(410).json({ message: 'Il telefono non ha risposto in tempo.', scaduta: true });
            return res.status(202).json({ stato: 'attesa' });
        }
        try {
            chiudiSfida(id);
            conferme.delete(sfida.conferma);
            const utente = await leggiUtente(sfida.userId);
            if (!utente?.is_active) return res.status(403).json({ message: 'Il tuo account è sospeso. Contatta la segreteria.' });
            req.user = { id: utente.id, username: utente.username };
            registraAudit(req, 'accesso.confermato_dal_telefono', { tipo: 'utente', id: utente.id, dettagli: { telefono: c.telefono } });
            return accessoVerificato(req, res, sfida, utente);
        } catch (e) {
            logger.error('[Telefoni] Errore nel completare l\'accesso:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    // L'app sul telefono collegato risponde da sé alla sfida, con la chiave.
    app.post('/api/accesso/chiave', passwordLimiter, async (req, res) => {
        const { sfida: id, telefono, firma } = req.body || {};
        const sfida = sfidaValida(id);
        if (!sfida || sfida.tipo !== 'codice') return res.status(401).json({ message: "Tempo scaduto: rifai l'accesso con la password.", sfida_scaduta: true });
        if (troppiTentativi(id, sfida)) return res.status(401).json({ message: "Troppi tentativi: rifai l'accesso con la password.", sfida_scaduta: true });
        try {
            const t = await telefonoDi(sfida.userId, telefono);
            if (!t || !firmaValida(t.chiave_pubblica, testoAccesso(id), firma)) {
                return res.status(401).json({ message: 'Questo telefono non è più collegato: usa il codice o conferma da un altro telefono.', telefono_scollegato: !t });
            }
            chiudiSfida(id);
            const utente = await leggiUtente(sfida.userId);
            if (!utente?.is_active) return res.status(403).json({ message: 'Il tuo account è sospeso. Contatta la segreteria.' });
            await pool.query('UPDATE telefoni_chiave SET usato_il = NOW() WHERE id = $1', [t.id]);
            return accessoVerificato(req, res, sfida, utente);
        } catch (e) {
            logger.error('[Telefoni] Errore nell\'accesso con la chiave:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    // Chi deve avere la verifica e non ce l'ha ancora: dopo la password collega il telefono,
    // come farebbe con l'app dei codici dal browser.
    app.post('/api/accesso/mfa/telefono', passwordLimiter, async (req, res) => {
        const { sfida: id, telefono } = req.body || {};
        const sfida = sfidaValida(id);
        if (!sfida || sfida.tipo !== 'attivazione') return res.status(401).json({ message: "Tempo scaduto: rifai l'accesso con la password.", sfida_scaduta: true });
        if (troppiTentativi(id, sfida)) return res.status(401).json({ message: "Troppi tentativi: rifai l'accesso con la password.", sfida_scaduta: true });
        try {
            const utente = await leggiUtente(sfida.userId);
            if (!utente?.is_active) return res.status(403).json({ message: 'Il tuo account è sospeso. Contatta la segreteria.' });
            if (utente.mfa_attiva) return res.status(409).json({ message: "La verifica è già attiva: rifai l'accesso.", sfida_scaduta: true });
            const esito = await inTransazione(async (client) => {
                const collegato = await collegaTelefono(client, utente, telefono || {});
                if (!collegato.errore) await chiudiSessioni(utente.id, client);
                return collegato;
            });
            if (esito.errore) return res.status(400).json({ message: esito.errore });
            chiudiSfida(id);
            req.user = { id: utente.id, username: utente.username };
            registraAudit(req, 'mfa.telefono_collegato', { tipo: 'utente', id: utente.id, dettagli: { telefono: esito.id, al_primo_accesso: true } });
            avvisaNuovoTelefono(notifiche, utente, telefono?.nome);
            return accessoVerificato(req, res, sfida, utente, { telefono: esito.id, codici_riserva: esito.codici });
        } catch (e) {
            logger.error('[Telefoni] Errore nel collegare il telefono all\'accesso:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });
}

// Il telefono legge e risponde con il token degli avvisi, che ha anche ad app chiusa.
export function registraRotteConfermeTelefono(app, { notifiche }) {
    async function utenteDa(req, res) {
        const utente = await utenteDaTokenAvvisi(tokenAvvisiDa(req.headers.authorization));
        if (!utente) res.status(401).json({ message: 'Token degli avvisi non valido.', avvisi_revocati: true });
        return utente;
    }

    app.get('/api/avvisi/conferme', async (req, res) => {
        try {
            const utente = await utenteDa(req, res);
            if (!utente) return;
            const ora = Date.now();
            res.json([...conferme.entries()]
                .filter(([, c]) => c.userId === utente.id && c.stato === 'attesa' && c.scade > ora)
                .map(([id, c]) => ({
                    id, scelte: c.scelte, browser: c.browser, indirizzo: c.indirizzo,
                    creata_il: new Date(c.creata).toISOString(), secondi: Math.round((c.scade - ora) / 1000)
                })));
        } catch (e) {
            logger.error('[Telefoni] Errore lettura delle conferme:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.post('/api/avvisi/conferme/:id', passwordLimiter, async (req, res) => {
        try {
            const utente = await utenteDa(req, res);
            if (!utente) return;
            const c = conferme.get(req.params.id);
            if (!c || c.userId !== utente.id || c.stato !== 'attesa' || c.scade < Date.now()) {
                return res.status(410).json({ message: 'Richiesta scaduta.' });
            }
            req.user = { id: utente.id, username: utente.username };
            const chiudi = () => notifiche?.scadi({ userId: utente.id, prefissoChiave: `conferma:${req.params.id}` });
            if (req.body?.risposta !== 'si') {
                c.stato = 'rifiutata';
                chiudi();
                registraAudit(req, 'accesso.rifiutato_dal_telefono', { tipo: 'utente', id: utente.id, dettagli: { browser: c.browser, indirizzo: c.indirizzo } });
                return res.json({ message: 'Accesso bloccato.' });
            }
            const t = await telefonoDi(utente.id, req.body?.telefono);
            const numero = Number(req.body?.numero);
            if (!t || !firmaValida(t.chiave_pubblica, testoConferma(req.params.id, numero), req.body?.firma)) {
                return res.status(401).json({ message: 'Questo telefono non è più collegato.', telefono_scollegato: !t });
            }
            chiudi();
            if (numero !== c.numero) {
                c.stato = 'rifiutata';
                registraAudit(req, 'accesso.numero_sbagliato', { tipo: 'utente', id: utente.id, dettagli: { browser: c.browser, indirizzo: c.indirizzo } });
                return res.status(409).json({ message: 'Numero sbagliato: accesso bloccato.' });
            }
            c.stato = 'approvata';
            c.telefono = t.id;
            await pool.query('UPDATE telefoni_chiave SET usato_il = NOW() WHERE id = $1', [t.id]);
            res.json({ message: 'Accesso confermato.' });
        } catch (e) {
            logger.error('[Telefoni] Errore nella risposta alla conferma:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });
}

async function passwordGiusta(userId, password) {
    if (typeof password !== 'string' || !password) return false;
    const r = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
    return !!r.rows[0]?.password && bcrypt.compare(password, r.rows[0].password);
}

export function registraRotteTelefoni(app, { notifiche }) {
    app.get('/api/telefoni', async (req, res) => {
        try {
            const r = await pool.query(
                'SELECT id, nome, creato_il, usato_il FROM telefoni_chiave WHERE user_id = $1 ORDER BY creato_il', [req.user.id]);
            res.json(r.rows);
        } catch (e) {
            logger.error('[Telefoni] Errore elenco:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.post('/api/telefoni', passwordLimiter, async (req, res) => {
        if (req.user.temporaneo) return res.status(403).json({ message: 'Gli accessi temporanei non usano la verifica in due passaggi.' });
        try {
            if (!await passwordGiusta(req.user.id, req.body?.password)) return res.status(403).json({ message: 'Password non corretta.' });
            const utente = await leggiUtente(req.user.id);
            const esito = await inTransazione(client => collegaTelefono(client, utente, req.body?.telefono || {}));
            if (esito.errore) return res.status(400).json({ message: esito.errore });
            registraAudit(req, 'mfa.telefono_collegato', { tipo: 'utente', id: req.user.id, dettagli: { telefono: esito.id } });
            avvisaNuovoTelefono(notifiche, utente, req.body?.telefono?.nome);
            let token = null;
            // Come all'attivazione con l'app dei codici: le altre sessioni sono nate senza verifica.
            if (esito.codici) {
                await chiudiSessioni(req.user.id);
                token = emettiSessione(res, req.user, req.user.ruoli, { mfa: true }).token;
            }
            res.status(201).json({ message: 'Telefono collegato.', telefono: esito.id, codici_riserva: esito.codici, token });
        } catch (e) {
            logger.error('[Telefoni] Errore nel collegare il telefono:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.delete('/api/telefoni/:id', passwordLimiter, async (req, res) => {
        try {
            if (!await passwordGiusta(req.user.id, req.body?.password)) return res.status(403).json({ message: 'Password non corretta.' });
            const utente = await leggiUtente(req.user.id);
            const t = await telefonoDi(req.user.id, req.params.id);
            if (!t) return res.status(404).json({ message: 'Telefono non trovato.' });
            const ultimo = utente.telefoni <= 1 && !utente.mfa_segreto;
            if (ultimo && mfaObbligatoria(req.user.ruoli, req.user.permessi)) {
                return res.status(409).json({ message: 'È il tuo unico secondo fattore e per il tuo ruolo serve: collega prima un altro telefono o un\'app di codici.' });
            }
            await pool.query('DELETE FROM telefoni_chiave WHERE id = $1', [t.id]);
            if (ultimo) {
                await pool.query('UPDATE users SET mfa_attiva = false, mfa_attivata_il = NULL WHERE id = $1', [req.user.id]);
                await pool.query('DELETE FROM mfa_codici_riserva WHERE user_id = $1', [req.user.id]);
            }
            registraAudit(req, 'mfa.telefono_scollegato', { tipo: 'utente', id: req.user.id, dettagli: { telefono: t.id, nome: t.nome, verifica_tolta: ultimo } });
            res.json({ message: ultimo ? 'Telefono scollegato: la verifica in due passaggi è spenta.' : 'Telefono scollegato.' });
        } catch (e) {
            logger.error('[Telefoni] Errore nello scollegare il telefono:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });
}
