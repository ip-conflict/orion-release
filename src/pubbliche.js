import { accessoRiuscito, attesaLinkRecupero, erroreAccesso, iniziaAccesso, linkRecuperoMandato, messaggioAttesa } from './tentativiAccesso.js';
import { registraAudit } from './audit.js';
import { controllaPassword } from './password.js';
import { idoneitaFisica } from './esitiVisite.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import logger from './logger.js';
import path from 'path';
import { appDistribuita } from './appMobile.js';
import { COSTO_BCRYPT, authenticateToken, chiudiSessioni, emettiSessione, permessiDellaPersona, ruoliDi, tokenSuperato } from './autenticazione.js';
import { verifyJwtToken } from './authHelper.js';
import { LOGO2_FILE_PATH, LOGO2_URL_PATH, LOGO_FILE_PATH, LOGO_URL_PATH, inviaFoto } from './caricamenti.js';
import { domainName } from './config.js';
import { pool } from './db.js';
import { sendEmailUtility } from './email.js';
import { registraAccessoTemporaneo } from './esterniTemporanei.js';
import { mfaObbligatoria, passoDopoLaPassword, registraRotteMfaPubbliche } from './mfa.js';
import { apiLimiter, chiaveIndirizzo, limitePerRete, passwordLimiter, recuperoLimiter } from './middleware/rateLimiters.js';
import { activeEmergency } from './statoEmergenza.js';
import { body, validationResult } from 'express-validator';
import { fileURLToPath } from 'url';
import { RADICE_DATI } from './percorsi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Con l'impronta il telefono tiene questo token, non la password; il server ne conserva
// solo l'impronta SHA-256.
export const GIORNI_RINNOVO = 90;
// Un token usato ogni giorno si allungherebbe per sempre: dopo questo tempo dall'accesso con la password si rifà.
export const GIORNI_MASSIMI_RINNOVO = 180;
export const MAX_RINNOVI_PER_PERSONA = 5;
export const impronta = (valore) => crypto.createHash('sha256').update(String(valore)).digest('hex');

const FORMATO_TOKEN_TESSERINO = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// badge_qr_enabled = 'false' zittisce la verifica anche per i QR già stampati.
export async function qrVolontariAttivi() {
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'badge_qr_enabled'");
    return !(r.rowCount > 0 && String(r.rows[0].setting_value) === 'false');
}

async function tesserinoConsultabile(req) {
    if (activeEmergency) return true;
    const overrideRes = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'badge_qr_always_on'");
    if (overrideRes.rowCount > 0 && overrideRes.rows[0].setting_value === 'true') return true;
    return !!(await utenteCollegato(req));
}

async function utenteCollegato(req) {
    const token = req.signedCookies?.['__Secure-token'] || req.headers['authorization']?.split(' ')[1];
    if (!token) return null;
    try {
        const utente = await verifyJwtToken(token);
        const stato = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM revoked_tokens WHERE token = $1) AS revocato,
                    (SELECT COALESCE(is_active, true) FROM users WHERE id = $2) AS attivo,
                    (SELECT (EXTRACT(EPOCH FROM sessioni_valide_dal) * 1000)::bigint FROM users WHERE id = $2) AS valide_dal`,
            [token, utente.id]);
        const { revocato, attivo, valide_dal } = stato.rows[0];
        return (!revocato && attivo === true && !tokenSuperato(utente, valide_dal)) ? utente : null;
    } catch (e) {
        return null;
    }
}

// Elenco chiuso: un'impostazione nuova resta privata finché non la si aggiunge qui.
const IMPOSTAZIONI_PUBBLICHE = [
    'association_name', 'map_center_lat', 'map_center_lon', 'map_zoom_level',
    'minuti_attesa_critica', 'magazzino_enabled', 'card_district_label',
    'card_regional_entity_name', 'badge_qr_always_on', 'badge_qr_enabled', 'badge_cf_barcode', 'badge_modello', 'app_android_enabled',
    'segreteria_config', 'funzioni_enabled', 'attivita_enabled', 'voce_enabled', 'voce_tasto', 'drone_enabled'
];
const CAMPI_SEGRETERIA_PUBBLICI = ['enabled', 'block_on_medical', 'block_on_course'];

// Senza accesso: chi installa l'app non ha ancora una sessione.
export const CARTELLA_APK = path.join(RADICE_DATI, 'app-android');

// Tanti errori da molte reti vogliono dire che qualcuno prova le password di questa persona.
function avvisaMoltiTentativi(req, user) {
    logger.warn(`[Login] Molti tentativi sbagliati da più reti sull'account ${user.username}: pausa per l'account intero.`);
    registraAudit({ ip: req.ip, user: { id: user.id, username: user.username } }, 'accesso.molti_tentativi', { tipo: 'utente', id: user.id });
    pool.query('SELECT email, nome FROM users WHERE id = $1', [user.id]).then(({ rows: [u] }) => {
        if (!u?.email) return;
        return sendEmailUtility(u.email, 'ORION: molti tentativi di accesso al tuo account',
            `Ciao ${u.nome || user.username},\n\nnell'ultima ora qualcuno ha provato molte volte ad accedere a ORION con il tuo nome utente, sbagliando la password.\nSe non eri tu, non serve fare niente per ora: l'accesso resta protetto. Se però hai il dubbio che la tua password sia nota ad altri, cambiala dal profilo e avvisa un amministratore.`);
    }).catch(e => logger.warn(`[Login] Avviso dei molti tentativi non mandato a ${user.username}: ${e.message}`));
}

export function registraRottePubbliche(app) {
    app.get('/', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'index.html')); });
    app.get('/login.html', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'index.html')); });
    app.get('/css/login.css', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public','css', 'login.css')); });
    app.get('/css/centro-operativo.css', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public','css', 'centro-operativo.css')); });
    app.get('/js/login.js', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public','js', 'login.js')); });


    app.get('/api/branding', apiLimiter, async (req, res) => {
        const response = { logoUrl: null, logoVersion: null, logo2Url: null, logo2Version: null };
        try {
            const stats = await fs.promises.stat(LOGO_FILE_PATH);
            response.logoUrl = LOGO_URL_PATH;
            response.logoVersion = stats.mtime.getTime().toString();
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error("Errore durante il recupero delle informazioni del logo:", error);
                return res.status(500).json({ message: "Errore interno del server." });
            }
            logger.debug("File logo non trovato, restituisco branding di default (null).");
        }
        try {
            const stats2 = await fs.promises.stat(LOGO2_FILE_PATH);
            response.logo2Url = LOGO2_URL_PATH;
            response.logo2Version = stats2.mtime.getTime().toString();
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error("Errore durante il recupero delle informazioni del logo2:", error);
                return res.status(500).json({ message: "Errore interno del server." });
            }
        }
        res.status(200).json(response);
    });


    app.post('/login', passwordLimiter, [ body('username').notEmpty(), body('password').notEmpty() ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const identificativo = String(req.body.username).trim().toLowerCase();
        const { password } = req.body;
        let fineTentativo = () => {};
        try {
          // Si entra con lo username o con l'email. Una stessa email scritta in due account
          // (maiuscole diverse) non apre nessuno dei due.
          const result = await pool.query(
            `SELECT u.id, u.username, u.password, u.role, COALESCE(u.is_active, true) AS is_active,
                u.temporaneo, u.mfa_attiva,
                ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli
         FROM users u WHERE u.username = $1 OR ($1 LIKE '%@%' AND lower(u.email) = $1)`,
            [identificativo]
          );
          const perUsername = result.rows.find(u => u.username === identificativo);
          const user = perUsername || (result.rows.length === 1 ? result.rows[0] : undefined);
          // I tentativi si contano sull'account, non su come lo si scrive: con username ed email
          // non si raddoppiano.
          const username = user?.username || identificativo;
          const rete = chiaveIndirizzo(req.ip);
          const tentativo = iniziaAccesso(username, rete);
          if (tentativo.attesa) {
            res.set('Retry-After', String(tentativo.attesa));
            return res.status(429).json({ message: messaggioAttesa(tentativo.attesa), attesa: tentativo.attesa });
          }
          fineTentativo = tentativo.fine;
          const dummyHash = '$2b$12$invalidhashforcomparisonpurposesonly123456789';
          const hashToCompare = user?.password || dummyHash;
          const isValid = await bcrypt.compare(password, hashToCompare);
            
          if (user && isValid) accessoRiuscito(username, rete);
          if (user && isValid && !user.is_active) {
            logger.warn(`[Login] Accesso rifiutato a ${user.username}: account sospeso.`);
            return res.status(403).json({ message: 'Il tuo account è sospeso. Contatta la segreteria.' });
          }

          if (user && isValid) {
            try {
              if (bcrypt.getRounds(user.password) < COSTO_BCRYPT) {
                const piuForte = await bcrypt.hash(password, COSTO_BCRYPT);
                await pool.query('UPDATE users SET password = $1 WHERE id = $2 AND password = $3', [piuForte, user.id, user.password]);
              }
            } catch (e) {
              logger.warn(`[Login] Impossibile rafforzare l'hash della password di ${user.username}: ${e.message}`);
            }
            const passo = await passoDopoLaPassword({ ...user, ruoli: user.ruoli?.length ? user.ruoli : [user.role] });
            if (passo) return res.status(401).json(passo);
            const { token, principale, ruoliUtente } = emettiSessione(res, user, user.ruoli);
            return res.json({ message: 'Login effettuato con successo', userId: user.id, username: user.username, role: principale, ruoli: ruoliUtente, permessi: await permessiDellaPersona(user.id, ruoliUtente), token: token });
          } else {
            const { attesa: pausa, sogliaSuperata } = erroreAccesso(username, rete);
            if (sogliaSuperata && user) avvisaMoltiTentativi(req, user);
            if (pausa) {
              logger.warn(`[Login] Troppi errori per l'account "${username.slice(0, 50)}": pausa di ${pausa} secondi.`);
              res.set('Retry-After', String(pausa));
              return res.status(429).json({ message: messaggioAttesa(pausa), attesa: pausa });
            }
            return res.status(401).json({ message: 'Credenziali non valide' });
          }
        } catch (err) {
          logger.error('Errore durante il login:', err);
          return res.status(500).json({ message: 'Errore interno del server' });
        } finally {
          fineTentativo();
        }
    });

    registraRotteMfaPubbliche(app);

    registraAccessoTemporaneo(app, {
        pool, logger, emettiSessione, emergenzaAttiva: () => activeEmergency, limitatore: passwordLimiter
    });

    app.post('/api/app/rinnovo/accesso', passwordLimiter, async (req, res) => {
        const rinnovo = req.body?.rinnovo;
        if (typeof rinnovo !== 'string' || rinnovo.length < 40 || rinnovo.length > 200) {
            return res.status(400).json({ message: 'Token di rinnovo mancante.' });
        }
        try {
            const r = await pool.query(
                `UPDATE token_rinnovo t
                SET usato_il = NOW(), scade_il = NOW() + ($2::int * INTERVAL '1 day')
              FROM users u
             WHERE t.impronta = $1 AND t.scade_il > NOW() AND u.id = t.user_id
               AND t.creato_il > NOW() - ($3::int * INTERVAL '1 day')
         RETURNING u.id, u.username, u.role, COALESCE(u.is_active, true) AS attivo, u.mfa_attiva, t.mfa AS rinnovo_mfa,
                   ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli`,
                [impronta(rinnovo), GIORNI_RINNOVO, GIORNI_MASSIMI_RINNOVO]);
            const utente = r.rows[0];
            // Un solo messaggio per inesistente, scaduto e revocato.
            if (!utente) return res.status(401).json({ message: "Accesso con l'impronta non piu' valido: accedi con la password.", rinnovo_non_valido: true });
            if (!utente.attivo) return res.status(403).json({ message: 'Il tuo account è sospeso. Contatta la segreteria.', motivo: 'account_non_attivo' });
            // L'impronta vale da secondo fattore. Un token nato prima della verifica in due passaggi
            // chiede il codice una volta, qui.
            const ruoli = utente.ruoli?.length ? utente.ruoli : [utente.role];
            if ((utente.mfa_attiva || mfaObbligatoria(ruoli, await permessiDellaPersona(utente.id, ruoli))) && !utente.rinnovo_mfa) {
                const passo = await passoDopoLaPassword({ ...utente, ruoli }, { rinnovo: impronta(rinnovo) });
                if (passo?.mfa === 'codice') {
                    return res.status(401).json({ ...passo, message: "Una volta sola: il codice della verifica in due passaggi, poi basta l'impronta." });
                }
                await pool.query('DELETE FROM token_rinnovo WHERE impronta = $1', [impronta(rinnovo)]);
                return res.status(401).json({ message: 'Serve la verifica in due passaggi: accedi con la password.', rinnovo_non_valido: true });
            }
            const { token, principale, ruoliUtente } = emettiSessione(res, utente, utente.ruoli, { mfa: utente.rinnovo_mfa, via: 'rinnovo' });
            res.json({ message: 'Accesso effettuato', userId: utente.id, username: utente.username, role: principale, ruoli: ruoliUtente, permessi: await permessiDellaPersona(utente.id, ruoliUtente), token });
        } catch (error) {
            logger.error('Errore accesso con token di rinnovo:', error);
            res.status(500).json({ message: 'Errore interno del server' });
        }
    });

    app.post('/api/auth/reset-password', apiLimiter, async (req, res) => {
        const { token, newPassword, id } = req.body;

        if (!token || !newPassword || !id) return res.status(400).json({ message: 'Dati mancanti o link non valido.' });

        // Un solo messaggio: distinguere "utente non trovato", "scaduto" e "non valido" direbbe quali id esistono.
        const linkNonValido = () => res.status(400).json({ message: 'Il link non è valido o è scaduto: chiedine uno nuovo.' });
        if (!Number.isInteger(Number(id)) || typeof token !== 'string') return linkNonValido();
        try {
            const result = await pool.query('SELECT username, nome, cognome, email, reset_token, reset_token_expires FROM users WHERE id = $1', [Number(id)]);
            const user = result.rows[0];
            if (!user?.reset_token || !user.reset_token_expires || new Date() > new Date(user.reset_token_expires)) return linkNonValido();
            if (!(await bcrypt.compare(token, user.reset_token))) return linkNonValido();


            const problemaPassword = controllaPassword(newPassword, user);
            if (problemaPassword) return res.status(400).json({ message: problemaPassword });


            const newPasswordHash = await bcrypt.hash(newPassword, COSTO_BCRYPT);
            await pool.query(
                'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
                [newPasswordHash, id]
            );
            await chiudiSessioni(id);

            res.status(200).json({ message: 'Password aggiornata con successo.', username: user.username });
        } catch (error) {
            logger.error('Errore reset password:', error);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    // La stessa risposta, e subito, in ogni caso: con la posta che impiega un secondo e mezzo il
    // tempo di risposta diceva se l'account esiste. Il lavoro vero si fa dopo aver risposto.
    app.post('/api/auth/forgot-password', apiLimiter, recuperoLimiter, (req, res) => {
        const { identificativo } = req.body;
        if (!identificativo) return res.status(400).json({ message: 'Inserisci username o email.' });
        res.status(200).json({ message: 'Se l\'account esiste ed ha un\'email associata, riceverai un link di ripristino. Se non arriva, guarda nella posta indesiderata: se ne possono chiedere al massimo tre all\'ora.' });
        mandaLinkDiRecupero(String(identificativo).toLowerCase()).catch(e => logger.error('Errore forgot password:', e));
    });

    async function mandaLinkDiRecupero(identificativo) {
        const result = await pool.query(
            `SELECT id, username, email, password IS NULL AND reset_token_expires > NOW() AS attivazione_valida
               FROM users WHERE username = $1 OR lower(email) = $1`, [identificativo]);
        const user = result.rows[0];
        if (!user) return;
        if (!user.email) {
            logger.warn(`[Forgot password] Richiesta per l'utente ${user.username} che non ha un'email associata.`);
            return;
        }
        // Il link nuovo prenderebbe il posto di quello d'attivazione, magari stampato col QR: chiunque sappia
        // il nome utente potrebbe renderlo inutile.
        if (user.attivazione_valida) {
            logger.warn(`[Forgot password] ${user.username} non ha ancora attivato l'account e il link di attivazione vale ancora: non lo sostituisco.`);
            return;
        }
        const attesa = attesaLinkRecupero(user.id);
        if (attesa) {
            logger.warn(`[Forgot password] Troppi link chiesti per l'utente ${user.username}: il prossimo fra ${Math.ceil(attesa / 60)} minuti.`);
            return;
        }
        linkRecuperoMandato(user.id);

        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = await bcrypt.hash(resetToken, 10);
        await pool.query('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
            [tokenHash, new Date(Date.now() + 3600000), user.id]);
        const resetLink = `https://${domainName}/reset-password.html?token=${resetToken}&id=${user.id}`;
        const emailResult = await sendEmailUtility(
            user.email,
            "Recupero Password ORION",
            `Hai richiesto il ripristino della password.\nClicca sul seguente link per impostare una nuova password (valido per 1 ora): \n\n${resetLink}`
        );
        if (!emailResult.success) {
            logger.error(`[Forgot password] Invio email fallito per l'utente ${user.username}: ${emailResult.error}`);
        }
    }

    app.get('/api/public/volunteer/:token', apiLimiter, async (req, res) => {
        const token = req.params.token;

        if (!FORMATO_TOKEN_TESSERINO.test(token)) {
            return res.status(400).json({ message: 'Token non valido' });
        }

        try {
            if (!await qrVolontariAttivi()) {
                return res.status(200).json({ available: false, message: 'La verifica dei tesserini con il QR è disattivata.' });
            }
            if (!await tesserinoConsultabile(req)) {
                return res.status(200).json({
                    available: false,
                    message: "Verifica non disponibile al momento: nessuna emergenza attiva. Chi ha fatto l'accesso a ORION la vede sempre."
                });
            }
        } catch (error) {
            logger.error('Errore lettura badge_qr_always_on:', error);
            return res.status(500).json({ message: 'Errore interno del server.' });
        }

        const client = await pool.connect();
        try {
            const userQuery = `SELECT id, nome, cognome, photo_url, role FROM users WHERE public_token = $1 AND (is_active = true OR is_active IS NULL)`;
            const userRes = await client.query(userQuery, [token]);
            if (userRes.rowCount === 0) return res.status(404).json({ message: 'Tesserino non valido.' });
            const user = userRes.rows[0];


            const isMedOk = (await idoneitaFisica([user.id], client)).get(user.id) === true;


            const baseCourseQuery = `
            SELECT TRUE
            FROM user_courses uc JOIN courses_catalog cc ON uc.course_id = cc.id
            WHERE uc.user_id = $1 
              AND uc.course_id = 1
              AND (uc.expiry_date IS NULL OR uc.expiry_date >= CURRENT_DATE)
            LIMIT 1
        `;
            const baseCourseRes = await client.query(baseCourseQuery, [user.id]);
            const isCourseBaseOk = baseCourseRes.rowCount > 0;

            const coursesQuery = `
            SELECT DISTINCT ON (cc.id) cc.name, cc.course_code, uc.expiry_date
            FROM user_courses uc JOIN courses_catalog cc ON uc.course_id = cc.id
            WHERE uc.user_id = $1 AND (uc.expiry_date IS NULL OR uc.expiry_date >= CURRENT_DATE)
            ORDER BY cc.id, uc.acquisition_date DESC
        `;
            const coursesRes = await client.query(coursesQuery, [user.id]);
            let appName = null;
            let allSettings = {};
            
            try {

                const brandRes = await client.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'association_name' LIMIT 1");
                
                if (brandRes.rowCount > 0) {
                    appName = brandRes.rows[0].setting_value;
                }
                
            } catch (e) {
                logger.error("Errore lettura branding badge:", e);
            }


            const isGlobalmenteOperativo = isMedOk && isCourseBaseOk;

            res.json({
                available: true,
                nome: user.nome,
                cognome: user.cognome,
                photo_url: user.photo_url ? `/api/public/volunteer/${token}/photo` : null,
                ruolo: user.role,
                operativita_globale: isGlobalmenteOperativo,
                idoneita_medica: isMedOk,
                corso_base: isCourseBaseOk, 
                corsi_attivi: coursesRes.rows,
                app_logo: '/logo.png', 
                app_name: appName
            });

        } catch (error) {
            logger.error('Errore lettura QR Code pubblico:', error);
            res.status(500).json({ message: 'Errore interno.' });
        } finally { client.release(); }
    });

    app.get('/api/photos/:filename', limitePerRete, authenticateToken, (req, res) => inviaFoto(res, req.params.filename));

    app.get('/api/public/volunteer/:token/photo', apiLimiter, async (req, res) => {
        const token = req.params.token;
        if (!FORMATO_TOKEN_TESSERINO.test(token)) return res.status(400).json({ message: 'Token non valido' });
        try {
            if (!await qrVolontariAttivi() || !await tesserinoConsultabile(req)) return res.status(404).json({ message: 'Foto non trovata.' });
            const r = await pool.query(
                'SELECT photo_url FROM users WHERE public_token = $1 AND (is_active = true OR is_active IS NULL)', [token]);
            const url = r.rows[0]?.photo_url;
            if (!url || !url.startsWith('/api/photos/')) return res.status(404).json({ message: 'Foto non trovata.' });
            inviaFoto(res, url.slice('/api/photos/'.length));
        } catch (error) {
            logger.error('Errore foto del tesserino pubblico:', error);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });


    app.get('/api/me/status', authenticateToken, (req, res) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader?.split(' ')[1];
        res.status(200).json({ 
            message: 'Token valido', 
            userId: req.user.id, 
            username: req.user.username, 
            role: req.user.role,
            ruoli: ruoliDi(req.user),
            permessi: req.user.permessi || [],
            token: token
        });
    });

    app.get('/api/branding/settings', apiLimiter, async (req, res) => {
        try {
            const result = await pool.query(
                'SELECT setting_key, setting_value FROM branding_settings WHERE setting_key = ANY($1::text[])', [IMPOSTAZIONI_PUBBLICHE]);


            const settings = result.rows.reduce((acc, row) => {
                acc[row.setting_key] = row.setting_value;
                return acc;
            }, {});
            if (settings.segreteria_config) {
                try {
                    const completa = typeof settings.segreteria_config === 'string' ? JSON.parse(settings.segreteria_config) : settings.segreteria_config;
                    const ridotta = Object.fromEntries(CAMPI_SEGRETERIA_PUBBLICI.filter(k => k in completa).map(k => [k, completa[k]]));
                    settings.segreteria_config = JSON.stringify(ridotta);
                } catch (e) {
                    delete settings.segreteria_config;
                }
            }

            res.status(200).json(settings);
        } catch (error) {
            logger.error("Errore durante il recupero delle impostazioni di branding:", error);
            res.status(500).json({ message: "Errore interno del server." });
        }
    });
    app.get('/app/orion.apk', apiLimiter, async (req, res) => {
        try {
            if (!await appDistribuita(pool)) return res.status(404).json({ message: "L'app non è disponibile su questo server." });
        } catch (e) {
            logger.error("Errore lettura dell'impostazione app_android_enabled:", e);
            return res.status(500).json({ message: 'Errore interno del server.' });
        }
        res.download(path.join(CARTELLA_APK, 'orion.apk'), 'orion.apk', {
            headers: { 'Content-Type': 'application/vnd.android.package-archive' }
        }, (err) => {
            if (err && !res.headersSent) res.status(404).json({ message: "L'app non è disponibile su questo server." });
        });
    });
}
