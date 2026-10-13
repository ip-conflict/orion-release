// Verifica in due passaggi: telefono collegato (telefoniChiave.js) o codici TOTP (RFC 6238),
// con i codici di riserva. Vedi il manuale tecnico.

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { checkAdminRole, chiudiSessioni, emettiSessione, permessiDellaPersona, ruoliDi } from './autenticazione.js';
import { mfaRichiesta, permessiDeiRuoli } from './permessi.js';
import { ChiaveNonDisponibile, cifraTesto, decifraTesto } from './cifratura.js';
import { pool } from './db.js';
import { ALFABETO_RECUPERO } from './formatoCifrato.js';
import { passwordLimiter } from './middleware/rateLimiters.js';

export const PERIODO = 30;
const CIFRE = 6;
const NUMERO_CODICI_RISERVA = 10;
const DURATA_SFIDA = 5 * 60 * 1000;
const DURATA_PREPARAZIONE = 10 * 60 * 1000;
const MAX_TENTATIVI = 5;
const MAX_SFIDE = 10000;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf) {
    let bit = '';
    for (const b of buf) bit += b.toString(2).padStart(8, '0');
    let testo = '';
    for (let i = 0; i < bit.length; i += 5) testo += BASE32[parseInt(bit.slice(i, i + 5).padEnd(5, '0'), 2)];
    return testo;
}

export function daBase32(testo) {
    const pulito = String(testo || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bit = '';
    for (const c of pulito) bit += BASE32.indexOf(c).toString(2).padStart(5, '0');
    const byte = [];
    for (let i = 0; i + 8 <= bit.length; i += 8) byte.push(parseInt(bit.slice(i, i + 8), 2));
    return Buffer.from(byte);
}

export const passoAttuale = (ora = Date.now()) => Math.floor(ora / 1000 / PERIODO);

export function codiceTotp(segreto, passo) {
    const contatore = Buffer.alloc(8);
    contatore.writeBigUInt64BE(BigInt(passo));
    const h = crypto.createHmac('sha1', segreto).update(contatore).digest();
    const o = h[h.length - 1] & 0x0f;
    const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 10 ** CIFRE).padStart(CIFRE, '0');
}

// Si accetta anche il passo prima e quello dopo: l'orologio del telefono può essere
// fuori di qualche secondo.
export function passoDelCodice(segreto, codice, ora = Date.now()) {
    if (!/^\d{6}$/.test(codice)) return null;
    const p = passoAttuale(ora);
    for (const d of [0, -1, 1]) {
        if (crypto.timingSafeEqual(Buffer.from(codiceTotp(segreto, p + d)), Buffer.from(codice))) return p + d;
    }
    return null;
}

async function uriOtp(username, segreto) {
    let emittente = 'ORION';
    try {
        const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'association_name'");
        const nome = String(r.rows[0]?.setting_value || '').trim();
        if (nome) emittente = `ORION ${nome}`.slice(0, 60);
    } catch { /* il nome di serie va bene */ }
    const etichetta = encodeURIComponent(`${emittente}:${username}`);
    return `otpauth://totp/${etichetta}?secret=${base32(segreto)}&issuer=${encodeURIComponent(emittente)}&algorithm=SHA1&digits=${CIFRE}&period=${PERIODO}`;
}

// Senza lettere ambigue.
function nuovoCodiceRiserva() {
    const byte = crypto.randomBytes(10);
    const c = [...byte].map(b => ALFABETO_RECUPERO[b & 31]).join('');
    return `${c.slice(0, 5)}-${c.slice(5)}`;
}

function normalizzaRiserva(testo) {
    const pulito = String(testo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (pulito.length !== 10 || [...pulito].some(c => !ALFABETO_RECUPERO.includes(c))) return null;
    return pulito;
}

const improntaRiserva = (userId, codice) => crypto.createHash('sha256').update(`${userId}:${codice}`).digest('hex');

export async function nuoviCodiciRiserva(esecutore, userId) {
    const codici = Array.from({ length: NUMERO_CODICI_RISERVA }, nuovoCodiceRiserva);
    await esecutore.query('DELETE FROM mfa_codici_riserva WHERE user_id = $1', [userId]);
    await esecutore.query(
        'INSERT INTO mfa_codici_riserva (user_id, impronta) SELECT $1, unnest($2::text[])',
        [userId, codici.map(c => improntaRiserva(userId, normalizzaRiserva(c)))]);
    return codici;
}

async function codiciRimasti(userId) {
    const r = await pool.query('SELECT count(*)::int AS n FROM mfa_codici_riserva WHERE user_id = $1 AND usato_il IS NULL', [userId]);
    return r.rows[0].n;
}

export const mfaObbligatoria = (ruoli, permessi = null) => mfaRichiesta(ruoli, permessi ?? [...permessiDeiRuoli(ruoli)]);

export async function leggiUtente(userId) {
    const r = await pool.query(
        `SELECT u.id, u.username, u.nome, u.email, u.role, u.password, COALESCE(u.is_active, true) AS is_active, u.temporaneo,
                u.mfa_attiva, u.mfa_segreto, u.mfa_attivata_il,
                (SELECT count(*)::int FROM telefoni_chiave WHERE user_id = u.id) AS telefoni,
                ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli
           FROM users u WHERE u.id = $1`, [userId]);
    const u = r.rows[0];
    if (u && (!u.ruoli || u.ruoli.length === 0)) u.ruoli = [u.role];
    return u || null;
}

async function verificaCodice(utente, codice) {
    const pulito = String(codice || '').replace(/\s/g, '');
    if (/^\d{6}$/.test(pulito)) {
        if (!utente.mfa_segreto) return { ok: false, message: 'Non hai un\'app di codici collegata: conferma dal telefono o usa un codice di riserva.' };
        let segreto;
        try {
            segreto = daBase32(decifraTesto(utente.mfa_segreto));
        } catch (e) {
            if (e instanceof ChiaveNonDisponibile) {
                return { ok: false, message: "Il codice dell'app ora non si può controllare: sul server manca la chiave dei dati. Usa uno dei codici di riserva." };
            }
            throw e;
        }
        const passo = passoDelCodice(segreto, pulito);
        if (passo == null) return { ok: false, message: "Codice non valido. Se è giusto, controlla che l'ora del telefono sia automatica." };
        // Lo stesso codice non vale due volte, nemmeno da due richieste insieme.
        const r = await pool.query(
            'UPDATE users SET mfa_ultimo_passo = $2 WHERE id = $1 AND (mfa_ultimo_passo IS NULL OR mfa_ultimo_passo < $2)',
            [utente.id, passo]);
        if (r.rowCount === 0) return { ok: false, message: 'Questo codice è già stato usato: aspetta il prossimo.' };
        return { ok: true };
    }
    const riserva = normalizzaRiserva(pulito);
    if (!riserva) return { ok: false, message: "Scrivi le sei cifre dell'app, oppure un codice di riserva (dieci caratteri)." };
    const r = await pool.query(
        'UPDATE mfa_codici_riserva SET usato_il = NOW() WHERE user_id = $1 AND impronta = $2 AND usato_il IS NULL RETURNING id',
        [utente.id, improntaRiserva(utente.id, riserva)]);
    if (r.rowCount === 0) return { ok: false, message: 'Codice di riserva non valido o già usato.' };
    return { ok: true, riserva: true, rimasti: await codiciRimasti(utente.id) };
}

async function salvaAttivazione(userId, segreto, passo) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE users SET mfa_attiva = true, mfa_segreto = $2, mfa_attivata_il = NOW(), mfa_ultimo_passo = $3 WHERE id = $1`,
            [userId, cifraTesto(base32(segreto)), passo]);
        const codici = await nuoviCodiciRiserva(client, userId);
        await client.query('COMMIT');
        return codici;
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

async function togli(userId) {
    await pool.query(
        'UPDATE users SET mfa_attiva = false, mfa_segreto = NULL, mfa_attivata_il = NULL, mfa_ultimo_passo = NULL WHERE id = $1', [userId]);
    await pool.query('DELETE FROM mfa_codici_riserva WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM telefoni_chiave WHERE user_id = $1', [userId]);
}

// In memoria: un riavvio del server le perde, e si rifà l'accesso.
const sfide = new Map();
const inPreparazione = new Map();

function pulisci(mappa) {
    const ora = Date.now();
    for (const [k, v] of mappa) if (v.scade < ora) mappa.delete(k);
}

export function sfidaValida(id) {
    const sfida = typeof id === 'string' ? sfide.get(id) : null;
    if (!sfida || sfida.scade < Date.now()) {
        if (sfida) sfide.delete(id);
        return null;
    }
    return sfida;
}

export const chiudiSfida = (id) => sfide.delete(id);

// Conta ogni tentativo, con qualunque secondo fattore.
export function troppiTentativi(id, sfida) {
    if (++sfida.tentativi <= MAX_TENTATIVI) return false;
    sfide.delete(id);
    return true;
}

function nuovaSfida(dati) {
    pulisci(sfide);
    if (sfide.size >= MAX_SFIDE) sfide.delete(sfide.keys().next().value);
    const id = crypto.randomBytes(24).toString('base64url');
    sfide.set(id, { ...dati, scade: Date.now() + DURATA_SFIDA, tentativi: 0 });
    return id;
}

// 401 con la sfida: un'app vecchia che non conosce il passo mostra almeno il messaggio.
export async function passoDopoLaPassword(utente, extra = {}) {
    if (utente.temporaneo === true) return null;
    if (utente.mfa_attiva) {
        const r = await pool.query(
            `SELECT (SELECT count(*)::int FROM telefoni_chiave WHERE user_id = $1) AS telefoni,
                    (SELECT mfa_segreto IS NOT NULL FROM users WHERE id = $1) AS totp`, [utente.id]);
        return {
            mfa: 'codice',
            sfida: nuovaSfida({ userId: utente.id, tipo: 'codice', ...extra }),
            telefoni: r.rows[0].telefoni,
            totp: r.rows[0].totp === true,
            message: "Serve la verifica in due passaggi. Se l'app non te la chiede, aggiornala."
        };
    }
    if (mfaObbligatoria(utente.ruoli, await permessiDellaPersona(utente.id, utente.ruoli))) {
        const segreto = crypto.randomBytes(20);
        return {
            mfa: 'attivazione',
            sfida: nuovaSfida({ userId: utente.id, tipo: 'attivazione', segreto, ...extra }),
            segreto: base32(segreto),
            uri: await uriOtp(utente.username, segreto),
            message: "Per il tuo ruolo serve la verifica in due passaggi: collega il telefono dall'app o attivala dal browser."
        };
    }
    return null;
}

const rispostaAccesso = async (utente, { token, principale, ruoliUtente }, extra = {}) => ({
    message: 'Login effettuato con successo', userId: utente.id, username: utente.username,
    role: principale, ruoli: ruoliUtente, permessi: await permessiDellaPersona(utente.id, ruoliUtente), token, ...extra
});

async function promuoviRinnovo(req, sfida, utente) {
    if (!sfida.rinnovo) return;
    const r = await pool.query('UPDATE token_rinnovo SET mfa = true WHERE impronta = $1 AND user_id = $2', [sfida.rinnovo, utente.id]);
    if (r.rowCount) registraAudit(req, 'sessione.rinnovo_verificato', { tipo: 'utente', id: utente.id });
}

export async function accessoVerificato(req, res, sfida, utente, extra = {}) {
    await promuoviRinnovo(req, sfida, utente);
    const sessione = emettiSessione(res, utente, utente.ruoli, { mfa: true });
    return res.json(await rispostaAccesso(utente, sessione, extra));
}

export function registraRotteMfaPubbliche(app) {
    app.post('/api/accesso/mfa', passwordLimiter, async (req, res) => {
        const id = typeof req.body?.sfida === 'string' ? req.body.sfida : '';
        const sfida = sfidaValida(id);
        if (!sfida) return res.status(401).json({ message: "Tempo scaduto: rifai l'accesso con la password.", sfida_scaduta: true });
        if (troppiTentativi(id, sfida)) {
            return res.status(401).json({ message: "Troppi codici sbagliati: rifai l'accesso con la password.", sfida_scaduta: true });
        }
        try {
            const utente = await leggiUtente(sfida.userId);
            if (!utente || !utente.is_active) {
                sfide.delete(id);
                return res.status(403).json({ message: 'Il tuo account è sospeso. Contatta la segreteria.' });
            }
            req.user = { id: utente.id, username: utente.username };
            const codice = String(req.body?.codice || '').trim();

            if (sfida.tipo === 'attivazione') {
                const passo = passoDelCodice(sfida.segreto, codice.replace(/\s/g, ''));
                if (passo == null) {
                    return res.status(401).json({ message: "Il codice non corrisponde. Controlla di aver inquadrato il QR di questa pagina e che l'ora del telefono sia automatica." });
                }
                sfide.delete(id);
                const codici = await salvaAttivazione(utente.id, sfida.segreto, passo);
                await chiudiSessioni(utente.id);
                registraAudit(req, 'mfa.attivata', { tipo: 'utente', id: utente.id, dettagli: { al_primo_accesso: true } });
                logger.info(`[MFA] ${utente.username} ha attivato la verifica in due passaggi.`);
                return accessoVerificato(req, res, sfida, utente, { codici_riserva: codici });
            }

            if (!utente.mfa_attiva) {
                sfide.delete(id);
                return res.status(401).json({ message: "La verifica in due passaggi è stata tolta nel frattempo: rifai l'accesso.", sfida_scaduta: true });
            }
            const esito = await verificaCodice(utente, codice);
            if (!esito.ok) return res.status(401).json({ message: esito.message });
            sfide.delete(id);
            if (esito.riserva) {
                registraAudit(req, 'mfa.codice_riserva', { tipo: 'utente', id: utente.id, dettagli: { rimasti: esito.rimasti } });
            }
            return accessoVerificato(req, res, sfida, utente, esito.riserva ? { codici_riserva_rimasti: esito.rimasti } : {});
        } catch (e) {
            logger.error('[MFA] Errore nel secondo passo dell\'accesso:', e);
            return res.status(500).json({ message: 'Errore interno del server' });
        }
    });
}

async function passwordGiusta(utente, password) {
    return typeof password === 'string' && password.length > 0 && !!utente.password && bcrypt.compare(password, utente.password);
}

export function registraRotteMfa(app) {
    app.get('/api/mfa', async (req, res) => {
        try {
            const u = await leggiUtente(req.user.id);
            res.json({
                attiva: u.mfa_attiva === true,
                obbligatoria: mfaObbligatoria(ruoliDi(req.user), req.user.permessi),
                disponibile: req.user.temporaneo !== true,
                attivata_il: u.mfa_attivata_il,
                totp: !!u.mfa_segreto,
                telefoni: u.telefoni,
                codici_rimasti: u.mfa_attiva ? await codiciRimasti(u.id) : 0
            });
        } catch (e) {
            logger.error('[MFA] Errore lettura stato:', e);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    // Vale solo dopo la conferma con un codice.
    app.post('/api/mfa/prepara', passwordLimiter, async (req, res) => {
        if (req.user.temporaneo) return res.status(403).json({ message: 'Gli accessi temporanei non usano la verifica in due passaggi.' });
        try {
            const u = await leggiUtente(req.user.id);
            if (!(await passwordGiusta(u, req.body?.password))) return res.status(403).json({ message: 'Password non corretta.' });
            pulisci(inPreparazione);
            const segreto = crypto.randomBytes(20);
            inPreparazione.set(u.id, { segreto, scade: Date.now() + DURATA_PREPARAZIONE });
            res.json({ segreto: base32(segreto), uri: await uriOtp(u.username, segreto) });
        } catch (e) {
            logger.error('[MFA] Errore preparazione:', e);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    app.post('/api/mfa/attiva', passwordLimiter, async (req, res) => {
        const preparata = inPreparazione.get(req.user.id);
        if (!preparata || preparata.scade < Date.now()) {
            return res.status(409).json({ message: 'Tempo scaduto: ricomincia dalla password.' });
        }
        const passo = passoDelCodice(preparata.segreto, String(req.body?.codice || '').replace(/\s/g, ''));
        if (passo == null) return res.status(400).json({ message: "Il codice non corrisponde. Controlla di aver inquadrato il QR di questa pagina e che l'ora del telefono sia automatica." });
        try {
            const prima = await leggiUtente(req.user.id);
            inPreparazione.delete(req.user.id);
            if (prima.mfa_attiva && !prima.mfa_segreto) {
                await pool.query('UPDATE users SET mfa_segreto = $2, mfa_ultimo_passo = $3 WHERE id = $1',
                    [req.user.id, cifraTesto(base32(preparata.segreto)), passo]);
                registraAudit(req, 'mfa.app_codici_aggiunta', { tipo: 'utente', id: req.user.id });
                return res.json({ message: 'App dei codici collegata.' });
            }
            const giaAttiva = prima.mfa_attiva === true;
            const codici = await salvaAttivazione(req.user.id, preparata.segreto, passo);
            await chiudiSessioni(req.user.id);
            const { token } = emettiSessione(res, req.user, req.user.ruoli, { mfa: true });
            registraAudit(req, giaAttiva ? 'mfa.telefono_cambiato' : 'mfa.attivata', { tipo: 'utente', id: req.user.id });
            res.json({
                message: giaAttiva ? 'Telefono cambiato: il codice vecchio non vale più.' : 'Verifica in due passaggi attivata.',
                codici_riserva: codici, token
            });
        } catch (e) {
            logger.error('[MFA] Errore attivazione:', e);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    app.post('/api/mfa/codici', passwordLimiter, async (req, res) => {
        try {
            const u = await leggiUtente(req.user.id);
            if (!u.mfa_attiva) return res.status(409).json({ message: 'La verifica in due passaggi non è attiva.' });
            if (!(await passwordGiusta(u, req.body?.password))) return res.status(403).json({ message: 'Password non corretta.' });
            const codici = await nuoviCodiciRiserva(pool, u.id);
            registraAudit(req, 'mfa.codici_rigenerati', { tipo: 'utente', id: u.id });
            res.json({ message: 'Codici di riserva nuovi: quelli di prima non valgono più.', codici_riserva: codici });
        } catch (e) {
            logger.error('[MFA] Errore codici di riserva:', e);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    app.post('/api/mfa/disattiva', passwordLimiter, async (req, res) => {
        if (mfaObbligatoria(ruoliDi(req.user), req.user.permessi)) {
            return res.status(403).json({ message: 'Per il tuo ruolo la verifica in due passaggi è obbligatoria.' });
        }
        try {
            const u = await leggiUtente(req.user.id);
            if (!u.mfa_attiva) return res.status(409).json({ message: 'La verifica in due passaggi non è attiva.' });
            if (!(await passwordGiusta(u, req.body?.password))) return res.status(403).json({ message: 'Password non corretta.' });
            await togli(u.id);
            registraAudit(req, 'mfa.disattivata', { tipo: 'utente', id: u.id });
            res.json({ message: 'Verifica in due passaggi disattivata.' });
        } catch (e) {
            logger.error('[MFA] Errore disattivazione:', e);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    app.post('/api/admin/users/:id/mfa/azzera', checkAdminRole, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID utente non valido.' });
        if (id === req.user.id) {
            return res.status(409).json({ message: "La tua la cambi dal profilo («Cambia app dei codici» o i telefoni collegati); azzerarla la può solo un altro amministratore." });
        }
        try {
            const u = await leggiUtente(id);
            if (!u) return res.status(404).json({ message: 'Utente non trovato.' });
            if (!u.mfa_attiva) return res.status(409).json({ message: 'Questa persona non ha la verifica in due passaggi attiva.' });
            await togli(id);
            await chiudiSessioni(id);
            registraAudit(req, 'mfa.azzerata', { tipo: 'utente', id, dettagli: { username: u.username } });
            logger.warn(`[MFA] ${req.user.username} ha azzerato la verifica in due passaggi di ${u.username}.`);
            res.json({
                message: mfaObbligatoria(u.ruoli, await permessiDellaPersona(id, u.ruoli))
                    ? `Verifica azzerata: ${u.username} la riattiva al prossimo accesso.`
                    : `Verifica azzerata: ${u.username} entra con la sola password finché non la riattiva.`
            });
        } catch (e) {
            logger.error('[MFA] Errore azzeramento:', e);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });
}

export { togli as togliMfa };
