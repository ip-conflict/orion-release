// src/esterniTemporanei.js
//
// Gli esterni temporanei: chi si presenta al COC durante un'emergenza senza
// essere dell'associazione (un'ambulanza, un tecnico del Comune). Basta un
// nome: ORION crea un esterno e un codice da inquadrare come QR o da mandare
// come link. Tutto finisce alla chiusura dell'emergenza; l'utente resta in
// anagrafica, disattivato, perché i registri lo citano.

import crypto from 'crypto';

// Il codice vale al massimo una settimana, poi se ne genera uno nuovo.
const GIORNI_CODICE = 7;
const impronta = (valore) => crypto.createHash('sha256').update(String(valore)).digest('hex');
const testo = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CODICE_NON_VALIDO = 'Codice non valido o scaduto: chiedine uno nuovo al centro operativo.';

// Uno username leggibile da chi guarda gli elenchi: "est.mario.rossi.4f2a".
function usernameDa(nome) {
    const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30) || 'ospite';
    return `est.${base}.${crypto.randomBytes(2).toString('hex')}`;
}

// Il codice si tiene anche cifrato, per farlo rivedere dal centro operativo
// a chi non l'ha ancora usato. La chiave viene da JWT_SECRET: chi la conosce
// puo' gia' firmare qualunque sessione, quindi non si aggiunge rischio. Si
// entra comunque solo con l'impronta.
function chiaveCodici() {
    return crypto.createHash('sha256').update(`orion-accessi-temporanei:${process.env.JWT_SECRET || ''}`).digest();
}

function cifra(codice) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', chiaveCodici(), iv);
    const dati = Buffer.concat([c.update(codice, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), dati].map(b => b.toString('base64url')).join('.');
}

// Null se non si legge (segreto cambiato, accesso nato prima della 1.0.3).
function decifra(testoCifrato) {
    try {
        const [iv, tag, dati] = String(testoCifrato || '').split('.').map(p => Buffer.from(p, 'base64url'));
        const d = crypto.createDecipheriv('aes-256-gcm', chiaveCodici(), iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(dati), d.final()]).toString('utf8');
    } catch {
        return null;
    }
}

async function nuovoCodice(client, userId, creatoDa) {
    const codice = crypto.randomBytes(18).toString('base64url');
    const r = await client.query(
        `INSERT INTO accessi_temporanei (user_id, impronta, codice_cifrato, creato_da, scade_il)
         VALUES ($1, $2, $3, $4, NOW() + ($5::int * INTERVAL '1 day'))
         ON CONFLICT (user_id) DO UPDATE
            SET impronta = EXCLUDED.impronta, codice_cifrato = EXCLUDED.codice_cifrato,
                creato_il = NOW(), creato_da = EXCLUDED.creato_da,
                scade_il = EXCLUDED.scade_il, usato_il = NULL
         RETURNING scade_il`,
        [userId, impronta(codice), cifra(codice), creatoDa, GIORNI_CODICE]);
    return { codice, scade_il: r.rows[0].scade_il };
}

/**
 * Chiude gli esterni temporanei di un'emergenza, dentro la transazione di
 * chiusura. Restituisce gli id, per chiudere le sessioni dopo il COMMIT.
 */
export async function chiudiEsterniTemporanei(client, emergencyId) {
    const { rows } = await client.query(
        `SELECT id, username FROM users
         WHERE temporaneo = true AND temporaneo_emergenza_id = $1 AND COALESCE(is_active, true) = true`,
        [emergencyId]);
    if (rows.length === 0) return [];
    const ids = rows.map(r => r.id);
    await client.query('DELETE FROM squadra_membri WHERE username = ANY($1::text[])', [rows.map(r => r.username)]);
    await client.query('UPDATE users SET is_active = false WHERE id = ANY($1::int[])', [ids]);
    await client.query('DELETE FROM accessi_temporanei WHERE user_id = ANY($1::int[])', [ids]);
    return ids;
}

/**
 * L'accesso con il codice: pubblica come il login.
 */
export function registraAccessoTemporaneo(app, ctx) {
    const { pool, logger, emettiSessione, emergenzaAttiva, limitatore } = ctx;

    app.post('/api/accesso-temporaneo', limitatore, async (req, res) => {
        const codice = typeof req.body?.codice === 'string' ? req.body.codice.trim() : '';
        if (codice.length < 20 || codice.length > 64) return res.status(400).json({ message: CODICE_NON_VALIDO });
        try {
            const r = await pool.query(
                `SELECT u.id, u.username, u.role, u.nome, u.cognome, u.ente, u.temporaneo_emergenza_id,
                        COALESCE(u.is_active, true) AS attivo, a.scade_il > NOW() AS valido,
                        ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli
                 FROM accessi_temporanei a JOIN users u ON u.id = a.user_id
                 WHERE a.impronta = $1`, [impronta(codice)]);
            const utente = r.rows[0];
            const emergenza = emergenzaAttiva();
            // Un solo messaggio per ogni caso.
            if (!utente || !utente.valido || !utente.attivo || !emergenza || utente.temporaneo_emergenza_id !== emergenza.id) {
                return res.status(401).json({ message: CODICE_NON_VALIDO });
            }
            await pool.query('UPDATE accessi_temporanei SET usato_il = NOW() WHERE user_id = $1', [utente.id]);
            const { token, principale, ruoliUtente } = emettiSessione(res, utente, utente.ruoli);
            logger.info(`[Accesso temporaneo] Entrato ${utente.username} (${utente.ente || 'esterno'}).`);
            res.json({
                message: 'Accesso effettuato',
                userId: utente.id, username: utente.username, role: principale, ruoli: ruoliUtente, token,
                nome: utente.nome, cognome: utente.cognome, ente: utente.ente, temporaneo: true
            });
        } catch (e) {
            logger.error('Errore accesso temporaneo:', e);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });
}

/** La gestione, per chi sta al centro operativo. */
export function registraRotteEsterniTemporanei(app, ctx) {
    const {
        pool, logger, registraAudit, nomeUtente, emergenzaAttiva, erroreRichiesta, nonEsterni,
        scriviRuoli, annotaRegistroSquadre, nomiRadioBloccati, NOMI_RADIO, avvisaClienti,
        inviaEmail, dominio, chiudiSessioni
    } = ctx;

    const indirizzo = (codice) => `https://${dominio}/accesso.html?c=${encodeURIComponent(codice)}`;

    async function inviaInvito(email, nome, link, emergenza) {
        if (!email || typeof inviaEmail !== 'function') return false;
        try {
            const oggetto = `Accesso a ORION per l'emergenza ${emergenza.code}`;
            const corpo = `Ciao ${nome},\n\nper l'emergenza ${emergenza.code} puoi entrare in ORION da questo link:\n${link}\n\n` +
                "Vale fino alla chiusura dell'emergenza. Non inoltrarlo: chi lo apre entra al posto tuo.";
            const esito = await inviaEmail(email, oggetto, corpo,
                `<p>Ciao ${nome.replace(/[<>&"]/g, '')},</p><p>per l'emergenza <strong>${String(emergenza.code).replace(/[<>&"]/g, '')}</strong> puoi entrare in ORION da questo link:</p>` +
                `<p><a href="${link}">${link}</a></p><p>Vale fino alla chiusura dell'emergenza. Non inoltrarlo: chi lo apre entra al posto tuo.</p>`);
            return esito?.success !== false;
        } catch (e) {
            logger.warn(`[Esterni temporanei] Email a ${email} non inviata: ${e.message}`);
            return false;
        }
    }

    // Nuovo esterno: un nome, e se si vuole l'ente, la squadra e un'email.
    app.post('/api/esterni-temporanei', nonEsterni, async (req, res) => {
        const emergenza = emergenzaAttiva();
        if (!emergenza) {
            return res.status(409).json({ message: "Gli accessi temporanei si creano durante un'emergenza, e finiscono con lei." });
        }
        const nome = testo(req.body?.nome, 100);
        const ente = testo(req.body?.ente, 100) || null;
        const email = testo(req.body?.email, 100);
        if (!nome) return res.status(400).json({ message: 'Serve almeno un nome.' });
        if (email && !EMAIL.test(email)) return res.status(400).json({ message: "L'indirizzo email non sembra valido." });

        const [primo, ...resto] = nome.split(' ');
        const nomeU = primo.slice(0, 50);
        const cognomeU = (resto.join(' ') || ente || '').slice(0, 50);
        const chi = nomeUtente(req.user) || req.user.username;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            let username = usernameDa(nome);
            for (let i = 0; i < 3 && (await client.query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount; i++) {
                username = usernameDa(nome);
            }
            const u = await client.query(
                `INSERT INTO users (username, password, role, nome, cognome, is_active, temporaneo, ente, temporaneo_emergenza_id)
                 VALUES ($1, NULL, 'esterno', $2, $3, true, true, $4, $5) RETURNING id`,
                [username, nomeU, cognomeU, ente, emergenza.id]);
            const userId = u.rows[0].id;
            await scriviRuoli(client, userId, ['esterno']);

            // In una squadra esistente o in una nuova.

            let squadra = null;
            const squadraId = parseInt(req.body?.squadra_id, 10);
            const nuova = req.body?.nuova_squadra;
            if (Number.isInteger(squadraId) && squadraId > 0) {
                const s = await client.query('SELECT id, nome_radio, nome FROM squadre WHERE id = $1', [squadraId]);
                if (s.rowCount === 0) throw erroreRichiesta('La squadra scelta non esiste più.');
                squadra = s.rows[0];
            } else if (nuova && typeof nuova === 'object') {
                const nomeRadio = testo(nuova.nome_radio, 20);
                if (!NOMI_RADIO.includes(nomeRadio)) throw erroreRichiesta('Serve un nome radio valido (Alfa, Bravo, Charlie...).');
                if ((await nomiRadioBloccati(client)).has(nomeRadio)) {
                    throw erroreRichiesta(`Il nome radio ${nomeRadio} apparteneva a una squadra sciolta durante questa emergenza: scegline un altro.`);
                }
                const usato = await client.query('SELECT 1 FROM squadre WHERE nome_radio = $1', [nomeRadio]);
                if (usato.rowCount) throw erroreRichiesta(`Il nome radio ${nomeRadio} è già di un'altra squadra.`);
                const s = await client.query(
                    'INSERT INTO squadre (nome_radio, nome, created_at) VALUES ($1, $2, NOW()) RETURNING id, nome_radio, nome',
                    [nomeRadio, testo(nuova.nome, 100) || ente || null]);
                squadra = s.rows[0];
            }
            if (squadra) {
                await client.query('INSERT INTO squadra_membri (squadra_id, username, nome, cognome) VALUES ($1, $2, $3, $4)',
                    [squadra.id, username, nomeU, cognomeU]);
                await annotaRegistroSquadre(client, [{
                    squadra_id: squadra.id, nome_radio: squadra.nome_radio, squadra_nome: squadra.nome,
                    username, nome: nomeU, cognome: cognomeU, azione: 'membro_aggiunto', motivo: 'operazione'
                }], req);
            }

            // Nella funzione di supporto che lo ha chiamato (il medico nella F2),
            // se il modulo è acceso: un accesso temporaneo lo può mettere ogni operatore.
            let funzione = null;
            const funzioneId = parseInt(req.body?.funzione_id, 10);
            if (Number.isInteger(funzioneId) && funzioneId > 0) {
                const f = await client.query(
                    `SELECT f.id, f.sigla, f.nome FROM funzioni f
                     WHERE f.id = $1 AND f.attiva
                       AND EXISTS (SELECT 1 FROM branding_settings b WHERE b.setting_key = 'funzioni_enabled' AND b.setting_value = 'true')`,
                    [funzioneId]);
                if (f.rowCount === 0) throw erroreRichiesta('La funzione scelta non è attiva.');
                funzione = f.rows[0];
                await client.query('INSERT INTO funzione_membri (funzione_id, user_id, aggiunto_da) VALUES ($1, $2, $3)',
                    [funzione.id, userId, chi]);
            }

            const { codice, scade_il } = await nuovoCodice(client, userId, chi);
            await client.query('COMMIT');

            const link = indirizzo(codice);
            registraAudit(req, 'esterno_temporaneo.creato', {
                tipo: 'utente', id: userId,
                dettagli: { username, nome, ente, squadra: squadra?.nome_radio || null, funzione: funzione?.sigla || null, emergenza: emergenza.code }
            });
            if (squadra && typeof avvisaClienti === 'function') avvisaClienti('reload_squadre');
            if (funzione && typeof avvisaClienti === 'function') avvisaClienti('reload_funzioni');
            const emailInviata = email ? await inviaInvito(email, nomeU, link, emergenza) : false;
            res.status(201).json({
                id: userId, username, nome: nomeU, cognome: cognomeU, ente,
                squadra: squadra ? { id: squadra.id, nome_radio: squadra.nome_radio, nome: squadra.nome } : null,
                funzione,
                codice, link, scade_il, email_inviata: emailInviata
            });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
            if (e.customError) return res.status(e.statusCode || 400).json({ message: e.message });
            logger.error('Errore creazione esterno temporaneo:', e);
            res.status(500).json({ message: "Errore nel creare l'accesso temporaneo." });
        } finally {
            client.release();
        }
    });

    // Quelli dell'emergenza in corso, attivi e revocati.
    app.get('/api/esterni-temporanei', nonEsterni, async (req, res) => {
        const emergenza = emergenzaAttiva();
        if (!emergenza) return res.json([]);
        try {
            const r = await pool.query(
                `SELECT u.id, u.username, u.nome, u.cognome, u.ente, COALESCE(u.is_active, true) AS attivo,
                        s.id AS squadra_id, s.nome_radio, s.nome AS squadra_nome,
                        a.creato_il, a.creato_da, a.scade_il, a.usato_il
                 FROM users u
                 LEFT JOIN accessi_temporanei a ON a.user_id = u.id
                 LEFT JOIN squadra_membri sm ON sm.username = u.username
                 LEFT JOIN squadre s ON s.id = sm.squadra_id
                 WHERE u.temporaneo = true AND u.temporaneo_emergenza_id = $1 AND u.eliminato_il IS NULL
                 ORDER BY COALESCE(u.is_active, true) DESC, u.id DESC`, [emergenza.id]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore elenco esterni temporanei:', e);
            res.status(500).json({ message: 'Errore nel leggere gli accessi temporanei.' });
        }
    });

    async function temporaneoAttivo(id) {
        const emergenza = emergenzaAttiva();
        const r = await pool.query(
            `SELECT id, username, nome, cognome, ente, temporaneo_emergenza_id FROM users
             WHERE id = $1 AND temporaneo = true AND COALESCE(is_active, true) = true`, [id]);
        const u = r.rows[0];
        return u && emergenza && u.temporaneo_emergenza_id === emergenza.id ? u : null;
    }

    // Un codice nuovo: il vecchio smette di valere (perso, inoltrato, scaduto).
    app.post('/api/esterni-temporanei/:id/codice', nonEsterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const u = await temporaneoAttivo(id);
            if (!u) return res.status(404).json({ message: "Accesso temporaneo non trovato, revocato o di un'altra emergenza." });
            const { codice, scade_il } = await nuovoCodice(pool, id, nomeUtente(req.user) || req.user.username);
            registraAudit(req, 'esterno_temporaneo.nuovo_codice', { tipo: 'utente', id, dettagli: { username: u.username } });
            res.json({ codice, link: indirizzo(codice), scade_il });
        } catch (e) {
            logger.error('Errore nuovo codice temporaneo:', e);
            res.status(500).json({ message: 'Errore nel generare il codice.' });
        }
    });

    // Il codice di adesso, per mostrarlo di nuovo: il QR sul posto o il link
    // da rimandare. Se non si legge (accesso nato prima della 1.0.3, segreto
    // cambiato) lo dice, e se ne genera uno nuovo.
    app.get('/api/esterni-temporanei/:id/codice', nonEsterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const u = await temporaneoAttivo(id);
            if (!u) return res.status(404).json({ message: "Accesso temporaneo non trovato, revocato o di un'altra emergenza." });
            const r = await pool.query('SELECT codice_cifrato, scade_il, usato_il FROM accessi_temporanei WHERE user_id = $1', [id]);
            const codice = r.rowCount ? decifra(r.rows[0].codice_cifrato) : null;
            if (!codice) return res.status(409).json({ message: 'Questo codice non si può rivedere: generane uno nuovo.', rigenera: true });
            if (new Date(r.rows[0].scade_il) <= new Date()) return res.status(409).json({ message: 'Il codice è scaduto: generane uno nuovo.', rigenera: true });
            res.json({ codice, link: indirizzo(codice), scade_il: r.rows[0].scade_il, usato_il: r.rows[0].usato_il });
        } catch (e) {
            logger.error('Errore lettura codice temporaneo:', e);
            res.status(500).json({ message: 'Errore nel leggere il codice.' });
        }
    });

    // Il link di adesso, di nuovo per email.
    app.post('/api/esterni-temporanei/:id/invia', nonEsterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const email = testo(req.body?.email, 100);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID non valido.' });
        if (!EMAIL.test(email)) return res.status(400).json({ message: "L'indirizzo email non sembra valido." });
        try {
            const u = await temporaneoAttivo(id);
            if (!u) return res.status(404).json({ message: "Accesso temporaneo non trovato, revocato o di un'altra emergenza." });
            const r = await pool.query('SELECT codice_cifrato FROM accessi_temporanei WHERE user_id = $1 AND scade_il > NOW()', [id]);
            const codice = r.rowCount ? decifra(r.rows[0].codice_cifrato) : null;
            if (!codice) return res.status(409).json({ message: 'Questo codice non si può rimandare: generane uno nuovo.', rigenera: true });
            const inviata = await inviaInvito(email, u.nome, indirizzo(codice), emergenzaAttiva());
            if (!inviata) return res.status(502).json({ message: "L'email non è partita: controlla la posta nelle Impostazioni, o usa il QR o il link." });
            registraAudit(req, 'esterno_temporaneo.invito_rimandato', { tipo: 'utente', id, dettagli: { username: u.username, email } });
            res.json({ message: `Link mandato a ${email}.` });
        } catch (e) {
            logger.error('Errore invio codice temporaneo:', e);
            res.status(500).json({ message: "Errore nel mandare l'email." });
        }
    });

    // Un'altra persona al posto di questa (cambio turno sull'ambulanza): nome
    // ed ente nuovi, codice nuovo, e chi c'era prima esce dall'app. Squadra e
    // registri restano quelli di questo accesso.
    app.put('/api/esterni-temporanei/:id/persona', nonEsterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID non valido.' });
        const nome = testo(req.body?.nome, 100);
        const ente = testo(req.body?.ente, 100) || null;
        const email = testo(req.body?.email, 100);
        if (!nome) return res.status(400).json({ message: 'Serve il nome di chi subentra.' });
        if (email && !EMAIL.test(email)) return res.status(400).json({ message: "L'indirizzo email non sembra valido." });
        const [primo, ...resto] = nome.split(' ');
        const nomeU = primo.slice(0, 50);
        const cognomeU = (resto.join(' ') || ente || '').slice(0, 50);
        const client = await pool.connect();
        try {
            const u = await temporaneoAttivo(id);
            if (!u) return res.status(404).json({ message: "Accesso temporaneo non trovato, revocato o di un'altra emergenza." });
            await client.query('BEGIN');
            await client.query('UPDATE users SET nome = $1, cognome = $2, ente = $3 WHERE id = $4', [nomeU, cognomeU, ente, id]);
            const membro = await client.query(
                `UPDATE squadra_membri sm SET nome = $1, cognome = $2 FROM squadre s
                 WHERE sm.username = $3 AND s.id = sm.squadra_id RETURNING s.id, s.nome_radio, s.nome`,
                [nomeU, cognomeU, u.username]);
            if (membro.rowCount) {
                // Nel registro della squadra: esce chi c'era, entra chi subentra.
                const sq = membro.rows[0];
                const voce = { squadra_id: sq.id, nome_radio: sq.nome_radio, squadra_nome: sq.nome, username: u.username, motivo: 'operazione' };
                await annotaRegistroSquadre(client, [
                    { ...voce, nome: u.nome, cognome: u.cognome, azione: 'membro_rimosso' },
                    { ...voce, nome: nomeU, cognome: cognomeU, azione: 'membro_aggiunto' }
                ], req);
            }
            const { codice, scade_il } = await nuovoCodice(client, id, nomeUtente(req.user) || req.user.username);
            await chiudiSessioni(id, client);
            await client.query('COMMIT');
            const link = indirizzo(codice);
            registraAudit(req, 'esterno_temporaneo.persona_cambiata', {
                tipo: 'utente', id, dettagli: { username: u.username, prima: `${u.nome || ''} ${u.cognome || ''}`.trim(), dopo: nome, ente }
            });
            if (membro.rowCount && typeof avvisaClienti === 'function') avvisaClienti('reload_squadre');
            const emailInviata = email ? await inviaInvito(email, nomeU, link, emergenzaAttiva()) : false;
            res.json({ id, nome: nomeU, cognome: cognomeU, ente, codice, link, scade_il, email_inviata: emailInviata });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore cambio persona accesso temporaneo:', e);
            res.status(500).json({ message: 'Errore nel cambiare la persona.' });
        } finally {
            client.release();
        }
    });

    // Revoca subito: esce dalla squadra, il codice e le sessioni non valgono più.
    app.delete('/api/esterni-temporanei/:id', nonEsterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID non valido.' });
        const client = await pool.connect();
        try {
            const u = await temporaneoAttivo(id);
            if (!u) return res.status(404).json({ message: 'Accesso temporaneo non trovato o già revocato.' });
            await client.query('BEGIN');
            const membro = await client.query(
                `DELETE FROM squadra_membri sm USING squadre s
                 WHERE sm.username = $1 AND s.id = sm.squadra_id
                 RETURNING s.id, s.nome_radio, s.nome`, [u.username]);
            if (membro.rowCount) {
                const s = membro.rows[0];
                await annotaRegistroSquadre(client, [{
                    squadra_id: s.id, nome_radio: s.nome_radio, squadra_nome: s.nome,
                    username: u.username, nome: u.nome, cognome: u.cognome, azione: 'membro_rimosso', motivo: 'operazione'
                }], req);
            }
            await client.query('UPDATE users SET is_active = false WHERE id = $1', [id]);
            await client.query('DELETE FROM accessi_temporanei WHERE user_id = $1', [id]);
            await chiudiSessioni(id, client);
            await client.query('COMMIT');
            registraAudit(req, 'esterno_temporaneo.revocato', { tipo: 'utente', id, dettagli: { username: u.username } });
            if (membro.rowCount && typeof avvisaClienti === 'function') avvisaClienti('reload_squadre');
            res.json({ message: 'Accesso revocato.' });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore revoca esterno temporaneo:', e);
            res.status(500).json({ message: "Errore nel revocare l'accesso." });
        } finally {
            client.release();
        }
    });
}
