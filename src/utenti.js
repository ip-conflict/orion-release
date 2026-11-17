import { controllaPassword } from './password.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import logger from './logger.js';
import { generateUsername, importUsersFromExcel, leggiCampiAnagrafici } from './anagrafica.js';
import { registraAudit } from './audit.js';
import { COSTO_BCRYPT, authenticateToken, checkAdminOrSegreteriaRole, checkAdminRole, chiudiSessioni, emettiSessione, haRuolo, ruoliDaRichiesta, ruoloPrincipale, scriviRuoli, validaRuoliAssegnabili } from './autenticazione.js';
import { richiedePermesso } from './permessi.js';
import { sistemaBeniInCarico } from './beniInUscita.js';
import { uploadExcelMulter, uploadPhoto, verifyExcelUpload, verifySingleUploadedImage } from './caricamenti.js';
import { domainName } from './config.js';
import { ACTIVE_REPORT_STATUSES_BACKEND, leggiQualifica } from './costanti.js';
import { pool } from './db.js';
import { sendEmailUtility } from './email.js';
import { adminLimiter, chiaveIndirizzo, passwordLimiter } from './middleware/rateLimiters.js';
import { accessoRiuscito, erroreAccesso, iniziaAccesso, messaggioAttesa } from './tentativiAccesso.js';
import { qrVolontariAttivi } from './pubbliche.js';
import { proteggiCaricati } from './cifratura.js';
import { cancellaFile, fileDaIndirizzi, fileDellaPersona, pseudonimizza } from './eliminazionePersona.js';

export function registraRotteUtenti(app) {

    app.get('/api/users', checkAdminOrSegreteriaRole, async (req, res) => {
        try {
           const result = await pool.query(`
           SELECT u.id, u.username, u.nome, u.cognome, u.email, u.role,
                  ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli
           FROM users u WHERE u.eliminato_il IS NULL ORDER BY u.cognome, u.nome`);
           res.json(result.rows);
         } catch (error) { logger.error('Errore GET /api/users:', error); res.status(500).json({ message: 'Errore recupero utenti' }); }
    });

    app.get('/api/users/me/team', authenticateToken, async (req, res) => {
        const userId = req.user.id;
        const username = req.user.username; 
        try {
            const query = `
            SELECT s.id, s.nome, s.nome_radio, s.coc,
                   (SELECT json_build_object('nome', c.nome, 'cognome', c.cognome, 'username', c.username)
                      FROM squadra_membri c WHERE c.squadra_id = s.id AND c.caposquadra LIMIT 1) AS caposquadra,
                   (SELECT json_build_object('report_id', r.id, 'numero', r.emergency_report_number, 'titolo', r.title,
                                             'indirizzo', r.location_address)
                      FROM report_team_assignments rta JOIN reports r ON r.id = rta.report_id
                     WHERE rta.squadra_id = s.id AND r.status = ANY($2::varchar[])
                     ORDER BY rta.assignment_id DESC LIMIT 1) AS intervento
            FROM squadre s
            JOIN squadra_membri sm ON s.id = sm.squadra_id
            WHERE sm.username = $1
            LIMIT 1;
        `;
            const result = await pool.query(query, [username, ACTIVE_REPORT_STATUSES_BACKEND]);
            // Senza squadra non è un errore: il centro operativo lo chiede a ogni apertura.
            res.status(200).json({ team: result.rows[0] || null });
        } catch (error) {
            logger.error(`Errore GET /api/users/me/team per user ${userId}:`, error);
            res.status(500).json({ message: 'Errore recupero assegnazione squadra.' });
        }
    });

    app.get('/api/users/me', authenticateToken, async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT u.id, u.username, u.nome, u.cognome, u.email, u.role, u.is_active, u.codice_fiscale, u.telefono,
                    u.indirizzo, u.citta, u.cap, u.photo_url, u.public_token,
                    ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli
             FROM users u WHERE u.id = $1`,
                [req.user.id]
            );
            if (result.rows.length === 0) return res.status(404).json({ message: 'Utente non trovato' });
            if (!await qrVolontariAttivi()) result.rows[0].public_token = null;
            res.json(result.rows[0]);
        } catch (error) { res.status(500).json({ message: 'Errore server' }); }
    });

    app.put('/api/users/me/anagrafica', authenticateToken, async (req, res) => {
        const { valori, errore } = leggiCampiAnagrafici(req.body, ['indirizzo', 'citta', 'cap', 'telefono', 'codice_fiscale']);
        if (errore) return res.status(400).json({ message: errore });
        const campi = Object.keys(valori);
        if (campi.length === 0) return res.json({ message: 'Niente da aggiornare.' });
        try {
            await pool.query(
                `UPDATE users SET ${campi.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${campi.length + 1}`,
                [...campi.map(c => valori[c]), req.user.id]
            );
            res.json({ message: 'Dati aggiornati con successo.' });
        } catch (error) {
            if (error.code === '23505') return res.status(409).json({ message: 'Questo Codice Fiscale è già associato a un altro utente.' });
            logger.error('Errore update profilo personale:', error);
            res.status(500).json({ message: 'Errore nel salvataggio.' });
        }
    });

    app.post('/api/users/me/photo', authenticateToken, uploadPhoto.single('photo'), async (req, res) => {
        if (!req.file) return res.status(400).json({ message: 'Nessuna immagine caricata.' });
        if (!(await verifySingleUploadedImage(req, res, ['image/jpeg', 'image/png', 'image/gif', 'image/webp']))) return;
        await proteggiCaricati(req.file);

        const photoUrl = `/api/photos/${req.file.filename}`;

        try {
            const r = await pool.query(
                `UPDATE users u SET photo_url = $1 FROM (SELECT photo_url AS vecchia FROM users WHERE id = $2) v
                  WHERE u.id = $2 RETURNING v.vecchia`, [photoUrl, req.user.id]);
            await cancellaFile(fileDaIndirizzi([r.rows[0]?.vecchia]));
            res.json({ message: 'Foto aggiornata con successo.', photo_url: photoUrl });
        } catch (error) {
            logger.error('Errore salvataggio URL foto:', error);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });

    app.post('/api/users/change-password', passwordLimiter, async (req, res) => {
        const userId = req.user.id;
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ message: "Tutti i campi password sono richiesti." });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: "La nuova password e la conferma non coincidono." });
        }
         if (newPassword === currentPassword) {
             return res.status(400).json({ message: "La nuova password non può essere uguale a quella attuale." });
         }

         const persona = (await pool.query('SELECT username, nome, cognome, email FROM users WHERE id = $1', [userId]).catch(() => ({ rows: [] }))).rows[0] || { username: req.user.username };
         const problemaPassword = controllaPassword(newPassword, persona);
         if (problemaPassword) return res.status(400).json({ message: problemaPassword });

          const forbiddenPasswordsExamples = [
              "Pr0t3z10n3C1v1l3!",
              "Dolomiti$Sicure_2025"
          ];
          if (forbiddenPasswordsExamples.includes(newPassword)) {
               return res.status(400).json({ message: "La nuova password non può essere uguale a una delle password di esempio fornite." });
          }

        logger.info(`Utente ${req.user.username} (ID: ${userId}) richiede cambio password.`);

        // Chi ha in mano per un momento la sessione di un altro non deve poter provare password a raffica:
        // gli errori si contano come quelli dell'accesso, sullo stesso account e sulla stessa rete.
        const rete = chiaveIndirizzo(req.ip);
        const tentativo = iniziaAccesso(req.user.username, rete);
        if (tentativo.attesa) {
            res.set('Retry-After', String(tentativo.attesa));
            return res.status(429).json({ message: messaggioAttesa(tentativo.attesa), attesa: tentativo.attesa });
        }
        try {

            const result = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
            if (result.rowCount === 0) {

                 return res.status(404).json({ message: "Utente non trovato." });
            }
            const storedHash = result.rows[0].password;
            const isMatch = !!storedHash && await bcrypt.compare(currentPassword, storedHash);

            if (!isMatch) {
                logger.warn(`Tentativo cambio password fallito per utente ${userId}: password attuale errata.`);
                const { attesa } = erroreAccesso(req.user.username, rete);
                if (attesa) {
                    res.set('Retry-After', String(attesa));
                    return res.status(429).json({ message: messaggioAttesa(attesa), attesa });
                }
                return res.status(401).json({ message: "La password attuale inserita non è corretta." });
            }
            accessoRiuscito(req.user.username, rete);

            const newPasswordHash = await bcrypt.hash(newPassword, COSTO_BCRYPT); 

            // Le altre sessioni si chiudono (la password poteva essere rubata); questa continua
            // con un token nuovo.
            await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newPasswordHash, userId]);
            await chiudiSessioni(userId);
            const { token } = emettiSessione(res, req.user, req.user.ruoli, { mfa: req.user.mfa });

            logger.info(`Password aggiornata con successo per utente ID: ${userId}; altre sessioni chiuse.`);
            res.status(200).json({ message: "Password aggiornata con successo! Le altre sessioni sono state chiuse.", token });

        } catch (error) {
             logger.error(`Errore cambio password per utente ${userId}:`, error);
             res.status(500).json({ message: "Errore interno durante l'aggiornamento della password." });
        } finally {
            tentativo.fine();
        }
    });

    app.get('/api/admin/users', checkAdminOrSegreteriaRole, async (req, res) => {
        try {
            const result = await pool.query(`
            SELECT u.id, u.username, u.nome, u.cognome, u.email, u.role, u.is_active, u.codice_fiscale, u.telefono,
                   u.temporaneo, u.ente, u.qualifica, e.code AS emergenza, e.status = 'ACTIVE' AS emergenza_aperta,
                   u.creato_il, u.ultimo_accesso, u.mfa_attiva,
                   ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli,
                   ARRAY(SELECT permesso FROM utenti_permessi WHERE user_id = u.id ORDER BY permesso) AS permessi_in_piu
            FROM users u LEFT JOIN emergencies e ON e.id = u.temporaneo_emergenza_id
            WHERE u.eliminato_il IS NULL
            ORDER BY u.cognome, u.nome`);
            res.json(result.rows);
        } catch (error) { logger.error('Errore GET /api/admin/users:', error); res.status(500).json({ message: 'Errore recupero utenti admin' }); }
    });

    // Gli accessi temporanei si gestiscono dal centro operativo: qui si possono solo eliminare.
    async function rifiutaSeTemporaneo(userId, res) {
        const r = await pool.query('SELECT temporaneo, eliminato_il FROM users WHERE id = $1', [userId]);
        if (r.rows[0]?.eliminato_il) {
            res.status(404).json({ message: 'Utente non trovato.' });
            return true;
        }
        if (r.rows[0]?.temporaneo !== true) return false;
        res.status(409).json({ message: "È un accesso esterno temporaneo: si gestisce dal centro operativo, in «Accesso esterno», e finisce da solo con l'emergenza." });
        return true;
    }

    // L'installazione resterebbe senza nessuno che possa rientrare: è già successo, chiamando la rotta a mano.
    async function ultimoAmministratore(client, userId) {
        const { rows } = await client.query(
            `SELECT EXISTS (SELECT 1 FROM utenti_ruoli WHERE user_id = $1 AND ruolo = 'admin') AS admin,
                    (SELECT count(*)::int FROM users u JOIN utenti_ruoli r ON r.user_id = u.id AND r.ruolo = 'admin'
                      WHERE u.id <> $1 AND COALESCE(u.is_active, false) AND u.eliminato_il IS NULL
                        AND COALESCE(u.temporaneo, false) = false) AS altri`, [userId]);
        return rows[0].admin && rows[0].altri === 0;
    }
    const MESSAGGIO_ULTIMO_AMMINISTRATORE = "È l'ultimo amministratore attivo: prima nominane un altro.";

    app.patch('/api/admin/users/:id/toggle-status', checkAdminRole, async (req, res) => {
        const userId = parseInt(req.params.id, 10);
        
        if (isNaN(userId)) {
            return res.status(400).json({ message: 'ID non valido.' });
        }
        if (userId === req.user.id) {
            return res.status(403).json({ message: 'Non puoi sospendere il tuo stesso account. Usa un altro account admin.' });
        }
        try {
            if (await rifiutaSeTemporaneo(userId, res)) return;
        } catch (error) {
            logger.error(`Errore lettura utente ${userId}:`, error);
            return res.status(500).json({ message: 'Errore interno del server.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // L'ordine conta: due amministratori che si sospendono a vicenda nello stesso istante passerebbero tutti e due il conteggio.
            await client.query("SELECT pg_advisory_xact_lock(hashtext('orion.amministratori'))");
            const attuale = (await client.query('SELECT COALESCE(is_active, false) AS attivo FROM users WHERE id = $1', [userId])).rows[0];
            if (!attuale) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Utente non trovato.' });
            }
            if (attuale.attivo && await ultimoAmministratore(client, userId)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: MESSAGGIO_ULTIMO_AMMINISTRATORE });
            }
            const result = await client.query(
                'UPDATE users SET is_active = NOT COALESCE(is_active, false) WHERE id = $1 RETURNING id, is_active', [userId]);
            if (!result.rows[0].is_active) await chiudiSessioni(userId, client);
            await client.query('COMMIT');

            res.json({ message: 'Stato aggiornato con successo.', user: result.rows[0] });
            registraAudit(req, result.rows[0].is_active ? 'utente.riattivato' : 'utente.sospeso', { tipo: 'utente', id: userId });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error(`Errore aggiornamento stato utente ${userId}:`, error);
            res.status(500).json({ message: 'Errore interno del server.' });
        } finally {
            client.release();
        }
    });

    // Ente e qualifica dicono da dove viene chi non è del gruppo: per gli altri restano vuoti.
    function enteEQualifica(corpo, ruoli) {
        if (!ruoli.includes('esterno')) return { ente: null, qualifica: null };
        const q = leggiQualifica(corpo?.qualifica);
        if (q.errore) return { errore: q.errore };
        const ente = corpo?.ente == null ? null : String(corpo.ente).trim().slice(0, 100) || null;
        return { ente, qualifica: q.valore };
    }

    app.post('/api/users', adminLimiter, richiedePermesso('volontari.anagrafica'), async (req, res) => {
        const { nome, cognome, email } = req.body;
        const ruoliRichiesti = ruoliDaRichiesta(req.body);
        if (!haRuolo(req, 'admin') && !(ruoliRichiesti.length === 1 && ruoliRichiesti[0] === 'volontario')) {
            return res.status(403).json({ message: "Puoi iscrivere solo volontari: gli altri ruoli li assegna l'amministratore." });
        }

        if (!nome || !cognome || ruoliRichiesti.length === 0) {
            return res.status(400).json({ message: 'Nome, Cognome e Ruolo sono obbligatori.' });
        }
        const erroreRuoli = validaRuoliAssegnabili(ruoliRichiesti);
        if (erroreRuoli) return res.status(400).json({ message: erroreRuoli });
        const controlloCampi = leggiCampiAnagrafici({ nome, cognome, email }, ['nome', 'cognome', 'email']);
        if (controlloCampi.errore) return res.status(400).json({ message: controlloCampi.errore });
        const provenienza = enteEQualifica(req.body, ruoliRichiesti);
        if (provenienza.errore) return res.status(400).json({ message: provenienza.errore });
        const role = ruoloPrincipale(ruoliRichiesti);
        const sanitizedEmail = email ? String(email).trim().toLowerCase() : null;
        const cleanNomeTrimmed = String(nome).trim();
        const cleanCognomeTrimmed = String(cognome).trim();

        const client = await pool.connect();
        try {
            await client.query('BEGIN'); 
            logger.debug(`[POST /api/users] Admin ${req.user.username} sta creando utente: ${cleanNomeTrimmed} ${cleanCognomeTrimmed}`);
            
            const finalUsername = await generateUsername(cleanNomeTrimmed, cleanCognomeTrimmed, client);
            
            // Il link si consegna anche a mano, stampato.
            const resetToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = await bcrypt.hash(resetToken, 10);
            const expireDate = new Date(Date.now() + 7 * 24 * 3600000);

            const result = await client.query(
                'INSERT INTO users (nome, cognome, username, email, role, reset_token, reset_token_expires, ente, qualifica) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, username, nome, cognome, email, role, ente, qualifica',
                [cleanNomeTrimmed, cleanCognomeTrimmed, finalUsername, sanitizedEmail, role, tokenHash, expireDate, provenienza.ente, provenienza.qualifica]
            );
            
            await scriviRuoli(client, result.rows[0].id, ruoliRichiesti);

            await client.query('COMMIT');
            const newUser = { ...result.rows[0], ruoli: ruoliRichiesti };
            
            const magicLink = `https://${domainName}/reset-password.html?token=${resetToken}&id=${newUser.id}`;
            
            let emailSent = false;
            let emailError = null;

            if (sanitizedEmail) {
                const emailResult = await sendEmailUtility(
                    sanitizedEmail,
                    "Benvenuto in ORION - Attiva il tuo account",
                    `Ciao ${newUser.nome},\n\nIl tuo account ORION è stato creato.\nUsername: ${newUser.username}\n\nClicca sul link sottostante per impostare la tua password e attivare l'account (valido per 7 giorni):\n\n${magicLink}`
                );
                emailSent = emailResult.success;
                emailError = emailResult.error;
            }
            
            logger.info(`Utente ${newUser.username} (ID: ${newUser.id}) creato. Email inviata: ${emailSent}`);
            
            res.status(201).json({ ...newUser, magicLink, emailSent, emailError });
            registraAudit(req, 'utente.creato', { tipo: 'utente', id: newUser.id, dettagli: { username: newUser.username, ruoli: ruoliRichiesti.join(', ') } });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Errore POST /api/users:', error.message, error.detail || '');
            
            if (error.customError) {
                return res.status(error.statusCode || 400).json({ message: error.message });
            }
            if (error.message.includes('Nome e Cognome forniti non contengono caratteri validi') || 
                error.message.includes('Impossibile generare uno username univoco') ||
                error.message.includes('Configurazione password di default mancante')) {
                return res.status(400).json({ message: error.message });
            }

            if (error.code === '23505') { 
                return res.status(409).json({ message: `Errore di conflitto: ${error.detail || 'Username o altro campo univoco già esistente.'}` });
            }

            return res.status(500).json({ message: 'Errore interno durante la creazione dell\'utente.' });
        } finally {
            client.release();
        }
    });

    app.put('/api/users/:id', adminLimiter, checkAdminRole, async (req, res) => {
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) return res.status(400).json({ message: 'ID Utente non valido'});
        const { nome, cognome, email } = req.body;
        const ruoliRichiesti = ruoliDaRichiesta(req.body);
        if (!nome || !cognome || ruoliRichiesti.length === 0) return res.status(400).json({ message: 'Dati mancanti (nome, cognome, ruoli)' });
        const erroreRuoli = validaRuoliAssegnabili(ruoliRichiesti);
        if (erroreRuoli) return res.status(400).json({ message: erroreRuoli });
        // Un amministratore che si toglie l'amministrazione resterebbe fuori.
        if (userId === req.user.id && !ruoliRichiesti.includes('admin')) {
            return res.status(403).json({ message: 'Non puoi toglierti il ruolo di amministratore. Chiedi a un altro amministratore di farlo.' });
        }
        const controlloCampi = leggiCampiAnagrafici({ nome, cognome, email }, ['nome', 'cognome', 'email']);
        if (controlloCampi.errore) return res.status(400).json({ message: controlloCampi.errore });
        const provenienza = enteEQualifica(req.body, ruoliRichiesti);
        if (provenienza.errore) return res.status(400).json({ message: provenienza.errore });
        const sanitizedEmail = email ? String(email).trim().toLowerCase() : null;
        try {
            if (await rifiutaSeTemporaneo(userId, res)) return;
        } catch (error) {
            logger.error(`Errore lettura utente ${userId}:`, error);
            return res.status(500).json({ message: 'Errore interno del server.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            if (!ruoliRichiesti.includes('admin')) {
                await client.query("SELECT pg_advisory_xact_lock(hashtext('orion.amministratori'))");
                const attivo = (await client.query('SELECT COALESCE(is_active, false) AS attivo FROM users WHERE id = $1', [userId])).rows[0]?.attivo;
                if (attivo && await ultimoAmministratore(client, userId)) {
                    throw { customError: true, statusCode: 409, message: MESSAGGIO_ULTIMO_AMMINISTRATORE };
                }
            }

            if (sanitizedEmail) {
                const currentUserEmailCheck = await client.query('SELECT email FROM users WHERE id = $1', [userId]);
                if (currentUserEmailCheck.rowCount > 0 && currentUserEmailCheck.rows[0].email !== sanitizedEmail) {
                    const emailExistsCheck = await client.query('SELECT 1 FROM users WHERE email = $1 AND id != $2', [sanitizedEmail, userId]);
                    if (emailExistsCheck.rowCount > 0) {
                         throw { customError: true, statusCode: 409, message: 'Indirizzo email già in uso da un altro utente.' };
                    }
                }
            }
            
            const result = await client.query(
                'UPDATE users SET nome = $1, cognome = $2, email = $3, ente = $4, qualifica = $5 WHERE id = $6 RETURNING id, username, nome, cognome, email, ente, qualifica',
                [String(nome).trim(), String(cognome).trim(), sanitizedEmail, provenienza.ente, provenienza.qualifica, userId]
            );
            
            if (result.rowCount === 0) {
                throw new Error('Utente non trovato.');
            }

            const { ruoli: ruoliSalvati, principale } = await scriviRuoli(client, userId, ruoliRichiesti);
            
            await client.query('COMMIT');
            const aggiornato = { ...result.rows[0], role: principale, ruoli: ruoliSalvati };
            res.json(aggiornato);
            registraAudit(req, 'utente.modificato', { tipo: 'utente', id: userId, dettagli: { username: aggiornato.username, ruoli: ruoliSalvati.join(', ') } });

        } catch (error) { 
            await client.query('ROLLBACK');
            logger.error(`Errore PUT /api/users/${userId}:`, error.message, error.detail || '');
            if (error.customError) {
                 return res.status(error.statusCode || 400).json({ message: error.message });
            }
            if (error.message === 'Utente non trovato.') {
                return res.status(404).json({ message: 'Utente non trovato' });
            }
            if (error.code === '23505') {
                 return res.status(409).json({ message: `Errore di conflitto: ${error.detail || 'Campo univoco già esistente.'}`});
            }
            return res.status(500).json({ message: 'Errore durante la modifica dell\'utente.' }); 
        } finally {
            client.release();
        }
    });

    app.delete('/api/users/:id', adminLimiter, checkAdminRole, async (req, res) => {
        const userIdToDelete = parseInt(req.params.id, 10);
        
        if (isNaN(userIdToDelete)) {
            return res.status(400).json({ message: 'ID Utente non valido.' });
        }

        if (userIdToDelete === req.user.id) {
            return res.status(403).json({ message: 'Non puoi eliminare il tuo stesso account. Usa un altro account admin.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const beniSistemati = await sistemaBeniInCarico(client, req, 'persona', userIdToDelete, req.body?.beni);

            const persona = (await client.query('SELECT username FROM users WHERE id = $1 AND eliminato_il IS NULL', [userIdToDelete])).rows[0];
            if (!persona) throw new Error('Utente non trovato.');
            const file = await fileDellaPersona(client, userIdToDelete);

            // Chi compare nello storico (23503) resta solo con nome e cognome.
            let modo = 'cancellato';
            await client.query('SAVEPOINT eliminazione');
            try {
                await client.query('DELETE FROM users WHERE id = $1', [userIdToDelete]);
            } catch (e) {
                if (e.code !== '23503') throw e;
                await client.query('ROLLBACK TO SAVEPOINT eliminazione');
                await pseudonimizza(client, userIdToDelete);
                modo = 'solo_nome';
            }

            await client.query('COMMIT');
            await chiudiSessioni(userIdToDelete).catch(() => {});
            await cancellaFile(file);
            logger.info(`Utente ${persona.username} (ID: ${userIdToDelete}) eliminato (${modo}) dall'admin ${req.user.username}.`);
            const avvisoBeni = beniSistemati.sistemati.length
                ? ` Materiale sistemato: ${beniSistemati.sistemati.map(b => `${b.denominazione} (${b.decisione.replace('_', ' ')})`).join(', ')}.`
                : '';
            const esito = modo === 'cancellato'
                ? `L'utente ${persona.username} è stato eliminato con tutti i suoi dati.`
                : `L'utente ${persona.username} è stato eliminato e i suoi dati personali cancellati. Compare in segnalazioni o documenti delle emergenze: lì resta solo il suo nome, per non alterare lo storico.`;
            res.status(200).json({ message: `${esito}${avvisoBeni}`, modo, beni: beniSistemati.sistemati });
            registraAudit(req, 'utente.eliminato', { tipo: 'utente', id: userIdToDelete, dettagli: { username: persona.username, modo, file: file.length, beni: beniSistemati.sistemati } });

        } catch (error) {
            await client.query('ROLLBACK');

            if (error.beniInCarico) {
                logger.warn(`[Magazzino] Cancellazione dell'utente ${userIdToDelete} sospesa: ${error.beniInCarico.length} beni da sistemare.`);
                return res.status(409).json({ message: error.message, beni_in_carico: error.beniInCarico });
            }

            logger.error(`Errore DELETE /api/users/${userIdToDelete}:`, error);

            if (error.message === 'Utente non trovato.') {
                return res.status(404).json({ message: 'Utente non trovato.' });
            }

            res.status(500).json({ message: 'Errore interno durante l\'eliminazione dell\'utente.' });
        } finally {
            client.release();
        }
    });

    app.post('/api/admin/users/:id/reset-password', passwordLimiter, checkAdminRole, async (req, res) => {
        const userIdToReset = parseInt(req.params.id, 10);
        if (isNaN(userIdToReset)) {
            return res.status(400).json({ message: 'ID Utente non valido.' });
        }

         if (userIdToReset === req.user.id) {
            return res.status(403).json({ message: 'Usa la funzione "Cambia Password" per modificare la tua password.' });
        }

        logger.info(`Admin ${req.user.username} (ID: ${req.user.id}) richiede reset password per utente ID: ${userIdToReset}`);

        try {
            if (await rifiutaSeTemporaneo(userIdToReset, res)) return;
            const resetToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = await bcrypt.hash(resetToken, 10);
            const expireDate = new Date(Date.now() + 7 * 24 * 3600000);

            const result = await pool.query(
                'UPDATE users SET password = NULL, reset_token = $1, reset_token_expires = $2 WHERE id = $3 RETURNING id, username, email', 
                [tokenHash, expireDate, userIdToReset]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({ message: 'Utente non trovato per il reset della password.' });
            }
            // Spesso è un account compromesso: le sessioni si chiudono subito.
            await chiudiSessioni(userIdToReset);

            const resetUser = result.rows[0];
            const magicLink = `https://${domainName}/reset-password.html?token=${resetToken}&id=${resetUser.id}`;
            
            let emailSent = false;
            let emailError = null;

            if (resetUser.email) {
                const emailResult = await sendEmailUtility(
                    resetUser.email,
                    "ORION - Ripristino Password",
                    `Ciao ${resetUser.username},\n\nUn amministratore ha resettato la tua password.\nClicca sul link sottostante per impostarne una nuova (valido per 7 giorni):\n\n${magicLink}`
                );
                emailSent = emailResult.success;
                emailError = emailResult.error;
            }

            registraAudit(req, 'utente.password_resettata', { tipo: 'utente', id: userIdToReset, dettagli: { username: resetUser.username } });
            res.status(200).json({ 
                message: `Magic Link generato con successo.`,
                magicLink: magicLink,
                emailSent: emailSent,
                emailError: emailError
            });

        } catch (error) {
            logger.error(`Errore reset password per utente ${userIdToReset}:`, error);
            res.status(500).json({ message: 'Errore interno durante il reset della password.' });
        }
    });

    app.post('/api/admin/import-users', authenticateToken, checkAdminRole, uploadExcelMulter.single('file'), async (req, res) => {
            if (req.fileValidationError) {

               if (req.file) {
                  fs.unlink(req.file.path, (err) => { if (err) logger.error("Errore rimozione file non valido:", err); });
               }
               return res.status(400).json({ message: req.fileValidationError });
           }
           if (!req.file) {
                return res.status(400).json({ message: req.multerError?.message || 'Nessun file Excel valido caricato.' });
           }
            if (!(await verifyExcelUpload(req.file.path, req.file.originalname))) {
                fs.unlink(req.file.path, (err) => { if (err) logger.error("Errore rimozione file Excel non valido:", err); });
                return res.status(400).json({ message: 'Il contenuto del file non corrisponde a un formato Excel/CSV valido.' });
            }
            logger.info(`${req.user.username} ha caricato il file: ${req.file.filename}`);

            try {
                const importResults = await importUsersFromExcel(req.file.path, req.file.originalname);

                let emailsSent = 0;
                for (const account of importResults.importati) {
                    account.email_inviata = false;
                    if (!account.email) continue;
                    const emailResult = await sendEmailUtility(
                        account.email,
                        "Benvenuto in ORION - Attiva il tuo account",
                        `Ciao,\n\nIl tuo account ORION è stato creato.\nUsername: ${account.username}\n\nClicca sul link sottostante per impostare la tua password e attivare l'account (valido per 7 giorni):\n\n${account.magicLink}`
                    );
                    if (emailResult.success) { emailsSent++; account.email_inviata = true; }
                }
                delete importResults.activation_links;
                importResults.email_inviate = emailsSent;

                const message = `Importati ${importResults.imported} su ${importResults.processed}` +
                    (importResults.skipped ? `, ${importResults.skipped} ${importResults.skipped === 1 ? 'riga saltata' : 'righe saltate'}` : '') +
                    `. Email di attivazione inviate: ${emailsSent}. Chi non l'ha ricevuta attiva l'account con il suo link, valido 7 giorni.`;
                res.status(200).json({ message, details: importResults });
                registraAudit(req, 'utenti.importati', { tipo: 'utente', dettagli: { importati: importResults.imported, username: importResults.importati.map(u => u.username) } });

            } catch (error) {
                if (error.richiestaNonValida) {
                    logger.warn(`Importazione utenti rifiutata: ${error.message}`);
                    return res.status(400).json({ message: error.message });
                }
                logger.error('Errore durante l\'importazione utenti da Excel:', error);
                res.status(500).json({ message: "Errore grave durante l'importazione del file." });
            } finally {

                fs.unlink(req.file.path, (err) => {
                    if (err && err.code !== 'ENOENT') logger.error('Errore rimozione file Excel temporaneo:', err);
                });
            }
        }
    );
}
