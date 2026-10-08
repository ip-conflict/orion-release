// src/utenti.js
//
// Profilo personale e gestione degli utenti.

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
import { pool } from './db.js';
import { sendEmailUtility } from './email.js';
import { adminLimiter, passwordLimiter } from './middleware/rateLimiters.js';
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
            SELECT s.id, s.nome, s.nome_radio
            FROM squadre s
            JOIN squadra_membri sm ON s.id = sm.squadra_id
            WHERE sm.username = $1
            LIMIT 1;
        `;
            const result = await pool.query(query, [username]);
            if (result.rowCount > 0) {
                res.status(200).json({ team: result.rows[0] }); 
            } else {
                res.status(404).json({ message: 'Utente non assegnato a nessuna squadra.' });
            }
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
            // QR spenti: il profilo (web e app) non ha niente da mostrare.
            if (!await qrVolontariAttivi()) result.rows[0].public_token = null;
            res.json(result.rows[0]);
        } catch (error) { res.status(500).json({ message: 'Errore server' }); }
    });


    app.put('/api/users/me/anagrafica', authenticateToken, async (req, res) => {
        // Solo i campi inviati: prima uno mancante veniva cancellato.
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
            // La foto di prima non serve più: si toglie dal disco.
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


         const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|\\;:'",.<>\/?~]).{12,}$/;
         if (newPassword.length < 12 || !passwordRegex.test(newPassword)) {
             return res.status(400).json({ message: "La nuova password non rispetta i criteri di complessità minimi (min. 12 caratteri, maiuscola, minuscola, numero, carattere speciale)." });
         }


          const forbiddenPasswordsExamples = [
              "Pr0t3z10n3C1v1l3!",
              "Dolomiti$Sicure_2025"
          ];
          if (forbiddenPasswordsExamples.includes(newPassword)) {
               return res.status(400).json({ message: "La nuova password non può essere uguale a una delle password di esempio fornite." });
          }

        logger.info(`Utente ${req.user.username} (ID: ${userId}) richiede cambio password.`);

        try {

            const result = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
            if (result.rowCount === 0) {

                 return res.status(404).json({ message: "Utente non trovato." });
            }
            const storedHash = result.rows[0].password;
            const isMatch = await bcrypt.compare(currentPassword, storedHash);

            if (!isMatch) {
                logger.warn(`Tentativo cambio password fallito per utente ${userId}: password attuale errata.`);
                return res.status(401).json({ message: "La password attuale inserita non è corretta." });
            }


            const newPasswordHash = await bcrypt.hash(newPassword, COSTO_BCRYPT); 

            // Le altre sessioni si chiudono (la password poteva essere rubata);
            // questa continua con un token nuovo.
            await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newPasswordHash, userId]);
            await chiudiSessioni(userId);
            const { token } = emettiSessione(res, req.user, req.user.ruoli, { mfa: req.user.mfa });

            logger.info(`Password aggiornata con successo per utente ID: ${userId}; altre sessioni chiuse.`);
            res.status(200).json({ message: "Password aggiornata con successo! Le altre sessioni sono state chiuse.", token });

        } catch (error) {
             logger.error(`Errore cambio password per utente ${userId}:`, error);
             res.status(500).json({ message: "Errore interno durante l'aggiornamento della password." });
        }
    });


    app.get('/api/admin/users', checkAdminOrSegreteriaRole, async (req, res) => {
        try {
            const result = await pool.query(`
            SELECT u.id, u.username, u.nome, u.cognome, u.email, u.role, u.is_active, u.codice_fiscale, u.telefono,
                   u.temporaneo, u.ente, e.code AS emergenza, e.status = 'ACTIVE' AS emergenza_aperta,
                   u.creato_il, u.ultimo_accesso, u.mfa_attiva,
                   ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli,
                   ARRAY(SELECT permesso FROM utenti_permessi WHERE user_id = u.id ORDER BY permesso) AS permessi_in_piu
            FROM users u LEFT JOIN emergencies e ON e.id = u.temporaneo_emergenza_id
            WHERE u.eliminato_il IS NULL
            ORDER BY u.cognome, u.nome`);
            res.json(result.rows);
        } catch (error) { logger.error('Errore GET /api/admin/users:', error); res.status(500).json({ message: 'Errore recupero utenti admin' }); }
    });

    // Gli accessi esterni temporanei nascono e finiscono con l'emergenza:
    // password, sospensione e dati si gestiscono dal centro operativo
    // ("Accesso esterno"), non da qui. Si possono solo eliminare.
    async function rifiutaSeTemporaneo(userId, res) {
        const r = await pool.query('SELECT temporaneo, eliminato_il FROM users WHERE id = $1', [userId]);
        // Chi è stato eliminato non si riattiva e non si modifica: di lui restano
        // solo nome e cognome nello storico.
        if (r.rows[0]?.eliminato_il) {
            res.status(404).json({ message: 'Utente non trovato.' });
            return true;
        }
        if (r.rows[0]?.temporaneo !== true) return false;
        res.status(409).json({ message: "È un accesso esterno temporaneo: si gestisce dal centro operativo, in «Accesso esterno», e finisce da solo con l'emergenza." });
        return true;
    }

    app.patch('/api/admin/users/:id/toggle-status', checkAdminRole, async (req, res) => {
        const userId = parseInt(req.params.id, 10);
        
        if (isNaN(userId)) {
            return res.status(400).json({ message: 'ID non valido.' });
        }
        try {
            if (await rifiutaSeTemporaneo(userId, res)) return;
        } catch (error) {
            logger.error(`Errore lettura utente ${userId}:`, error);
            return res.status(500).json({ message: 'Errore interno del server.' });
        }

        try {
            const result = await pool.query(
                `UPDATE users 
             SET is_active = NOT COALESCE(is_active, false) 
             WHERE id = $1 
             RETURNING id, is_active`,
                [userId]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({ message: 'Utente non trovato.' });
            }

            res.json({ message: 'Stato aggiornato con successo.', user: result.rows[0] });
            registraAudit(req, result.rows[0].is_active ? 'utente.riattivato' : 'utente.sospeso', { tipo: 'utente', id: userId });
        } catch (error) {
            logger.error(`Errore aggiornamento stato utente ${userId}:`, error);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    // Iscrive una persona. Chi gestisce l'anagrafica iscrive i volontari;
    // ruoli diversi (e permessi) li assegna solo l'amministratore.
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
        const role = ruoloPrincipale(ruoliRichiesti);
        const sanitizedEmail = email ? String(email).trim().toLowerCase() : null;
        const cleanNomeTrimmed = String(nome).trim();
        const cleanCognomeTrimmed = String(cognome).trim();

        const client = await pool.connect();
        try {
            await client.query('BEGIN'); 
            logger.debug(`[POST /api/users] Admin ${req.user.username} sta creando utente: ${cleanNomeTrimmed} ${cleanCognomeTrimmed}`);
            
            const finalUsername = await generateUsername(cleanNomeTrimmed, cleanCognomeTrimmed, client);
            
            // L'utente nasce senza password, con un link di attivazione di 7 giorni (si consegna anche a mano, stampato),
            // mandato per email se si può e comunque restituito all'amministratore.
            const resetToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = await bcrypt.hash(resetToken, 10);
            const expireDate = new Date(Date.now() + 7 * 24 * 3600000);


            const result = await client.query(
                'INSERT INTO users (nome, cognome, username, email, role, reset_token, reset_token_expires) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, nome, cognome, email, role',
                [cleanNomeTrimmed, cleanCognomeTrimmed, finalUsername, sanitizedEmail, role, tokenHash, expireDate]
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


            if (sanitizedEmail) {
                const currentUserEmailCheck = await client.query('SELECT email FROM users WHERE id = $1', [userId]);
                if (currentUserEmailCheck.rowCount > 0 && currentUserEmailCheck.rows[0].email !== sanitizedEmail) {
                    const emailExistsCheck = await client.query('SELECT 1 FROM users WHERE email = $1 AND id != $2', [sanitizedEmail, userId]);
                    if (emailExistsCheck.rowCount > 0) {
                         throw { customError: true, statusCode: 409, message: 'Indirizzo email già in uso da un altro utente.' };
                    }
                }
            }
            
            // Lo username non cambia; il ruolo lo scrive scriviRuoli().
            const result = await client.query(
                'UPDATE users SET nome = $1, cognome = $2, email = $3 WHERE id = $4 RETURNING id, username, nome, cognome, email', 
                [String(nome).trim(), String(cognome).trim(), sanitizedEmail, userId]
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

            // Prima il materiale che ha in carico (vedi beniInUscita.js).
            const beniSistemati = await sistemaBeniInCarico(client, req, 'persona', userIdToDelete, req.body?.beni);

            const persona = (await client.query('SELECT username FROM users WHERE id = $1 AND eliminato_il IS NULL', [userIdToDelete])).rows[0];
            if (!persona) throw new Error('Utente non trovato.');
            const file = await fileDellaPersona(client, userIdToDelete);

            // Si cancella del tutto, con visite e corsi. Chi compare nello
            // storico (segnalazioni, aggiornamenti, documenti: 23503) resta
            // solo con nome e cognome, e il resto dei suoi dati si cancella.
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

            // Materiale da sistemare è un esito normale: avviso, non errore.
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

                // I link per email dove c'è un indirizzo; gli altri si consegnano a mano.
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
                // Un file illeggibile è un 400, con la frase che spiega cosa fare.
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
