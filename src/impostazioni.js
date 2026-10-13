import fs from 'fs';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { checkAdminRole } from './autenticazione.js';
import { LOGO2_FILE_PATH, LOGO_FILE_PATH, cleanupRejectedFiles, uploadLogo2Multer, uploadLogoMulter, verifySingleUploadedImage } from './caricamenti.js';
import { MINUTI_ATTESA_CRITICA_MAX } from './costanti.js';
import { pool } from './db.js';
import { inviaEmailProva } from './email.js';
import { wss } from './tempoReale.js';
import { cifraTesto } from './cifratura.js';
import { CHIAVI_FIREBASE } from './firebase.js';
import { ModelloNonValido, validaModelloTesserino } from './modelloTesserino.js';
import { controlla as controllaAllerta, controllaImpostazioniAllerta } from './allerta.js';

export function registraRotteImpostazioni(app) {

    app.post('/api/branding/logo', checkAdminRole, uploadLogoMulter.single('logoFile'), async (req, res) => {

        if (req.fileValidationError) {
            return res.status(400).json({ message: req.fileValidationError });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Nessun file immagine valido caricato.' });
        }
        if (!(await verifySingleUploadedImage(req, res, ['image/jpeg', 'image/png', 'image/gif']))) return;

        try {
            await fs.promises.rename(req.file.path, LOGO_FILE_PATH);
        } catch (error) {
            logger.error('Errore sostituzione del file logo:', error);
            cleanupRejectedFiles([req.file]);
            return res.status(500).json({ message: 'Errore interno durante il salvataggio del logo.' });
        }

        logger.info(`Admin ${req.user.username} ha aggiornato il logo del cliente.`);

        res.status(200).json({ message: 'Logo aggiornato con successo.' });


        wss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                try {
                    client.send(JSON.stringify({ action: 'branding_updated' }));
                } catch (e) { logger.error('WS Send Error (branding_updated):', e); }
            }
        });
    });

    app.post('/api/branding/logo2', checkAdminRole, uploadLogo2Multer.single('logoFile'), async (req, res) => {
        if (req.fileValidationError) {
            return res.status(400).json({ message: req.fileValidationError });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'Nessun file immagine valido caricato.' });
        }
        if (!(await verifySingleUploadedImage(req, res, ['image/jpeg', 'image/png', 'image/gif']))) return;

        try {
            await fs.promises.rename(req.file.path, LOGO2_FILE_PATH);
        } catch (error) {
            logger.error('Errore sostituzione del file logo2:', error);
            cleanupRejectedFiles([req.file]);
            return res.status(500).json({ message: 'Errore interno durante il salvataggio del logo.' });
        }

        logger.info(`Admin ${req.user.username} ha aggiornato il logo secondario (ente sovraordinato).`);

        res.status(200).json({ message: 'Logo secondario aggiornato con successo.' });

        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                try {
                    client.send(JSON.stringify({ action: 'branding_updated' }));
                } catch (e) { logger.error('WS Send Error (branding_updated):', e); }
            }
        });
    });

    app.get('/api/branding/settings/full', checkAdminRole, async (req, res) => {
        try {
            const result = await pool.query('SELECT setting_key, setting_value FROM branding_settings');
            const settings = result.rows.reduce((acc, row) => {
                acc[row.setting_key] = row.setting_value;
                return acc;
            }, {});
            // La password della posta non torna al browser.
            settings.smtp_pass_impostata = !!settings.smtp_pass;
            delete settings.smtp_pass;
            for (const k of CHIAVI_FIREBASE) delete settings[k];
            res.status(200).json(settings);
        } catch (error) {
            logger.error("Errore durante il recupero delle impostazioni complete di branding:", error);
            res.status(500).json({ message: "Errore interno del server." });
        }
    });

    // Lo stato degli aggiornamenti porta l'indirizzo del pacchetto: lo scrive solo la pagina Sistema.
    const CHIAVI_INTERNE = new Set(['aggiornamenti_config', 'aggiornamenti_stato', 'cifratura_impronta', 'cifratura_recupero_salvata',
        'smtp_pass_impostata', 'privacy_versione', 'privacy_pubblicata_il', ...CHIAVI_FIREBASE]);

    app.put('/api/branding/settings', checkAdminRole, async (req, res) => {
        const settingsToUpdate = req.body;
        if (!settingsToUpdate || typeof settingsToUpdate !== 'object' || Array.isArray(settingsToUpdate)) {
            return res.status(400).json({ message: 'Impostazioni non valide.' });
        }
        const chiaviRifiutate = Object.keys(settingsToUpdate)
            .filter(k => CHIAVI_INTERNE.has(k) || !/^[a-z0-9_]{1,64}$/.test(k));
        if (chiaviRifiutate.length > 0) {
            return res.status(400).json({ message: `Impostazioni non modificabili da qui: ${chiaviRifiutate.join(', ')}.` });
        }
        const regioneSalvata = (await pool.query(
            "SELECT setting_value FROM branding_settings WHERE setting_key = 'allerta_regione'").catch(() => ({ rows: [] }))).rows[0]?.setting_value || '';
        const erroreAllerta = controllaImpostazioniAllerta(settingsToUpdate, regioneSalvata);
        if (erroreAllerta) return res.status(400).json({ message: erroreAllerta });
        const client = await pool.connect();

        try {
            await client.query('BEGIN');


            for (const key in settingsToUpdate) {
                if (Object.hasOwnProperty.call(settingsToUpdate, key)) {
                    let value = settingsToUpdate[key];
                    if (key === 'smtp_pass') {
                        if (value == null || String(value).trim() === '') continue;
                        value = cifraTesto(String(value));
                    }
                    if (key === 'badge_modello') {
                        try {
                            value = validaModelloTesserino(value);
                        } catch (e) {
                            if (!(e instanceof ModelloNonValido)) throw e;
                            await client.query('ROLLBACK');
                            return res.status(400).json({ message: e.message });
                        }
                    }
                    // Un valore assurdo spegnerebbe il segnale di ritardo in sala.
                    if (key === 'minuti_attesa_critica' && String(value).trim() !== '') {
                        const minuti = Number(value);
                        if (!Number.isInteger(minuti) || minuti < 1 || minuti > MINUTI_ATTESA_CRITICA_MAX) {
                            await client.query('ROLLBACK');
                            return res.status(400).json({ message: `I minuti di attesa prima della segnalazione in ritardo devono essere un numero intero fra 1 e ${MINUTI_ATTESA_CRITICA_MAX}.` });
                        }
                    }
                    const upsertQuery = `
                    INSERT INTO branding_settings (setting_key, setting_value, updated_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (setting_key)
                    DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW();
                `;
                    await client.query(upsertQuery, [key, value]);
                }
            }

            await client.query('COMMIT');
            
            logger.info(`Admin ${req.user.username} ha aggiornato le impostazioni di branding.`);

            res.status(200).json({ message: 'Impostazioni aggiornate con successo.' });
            // Non si registrano i valori: fra le impostazioni ci sono le credenziali SMTP.
            registraAudit(req, 'impostazioni.modificate', { tipo: 'impostazioni', dettagli: { chiavi: Object.keys(settingsToUpdate) } });
            if (settingsToUpdate.allerta_regione && settingsToUpdate.allerta_regione !== regioneSalvata) controllaAllerta({ forza: true });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error("Errore durante l'aggiornamento delle impostazioni di branding:", error);
            res.status(500).json({ message: "Errore interno durante l'aggiornamento." });
        } finally {
            client.release();
        }
    });
    app.post('/api/admin/email-prova', checkAdminRole, async (req, res) => {
        const corpo = (req.body && typeof req.body === 'object') ? req.body : {};
        let a = typeof corpo.a === 'string' ? corpo.a.trim() : '';
        if (a && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) {
            return res.status(400).json({ message: "L'indirizzo a cui mandare la prova non è valido." });
        }
        try {
            if (!a) {
                const r = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
                a = r.rows[0]?.email || '';
            }
            const esito = await inviaEmailProva(corpo, a);
            logger.info(`Admin ${req.user.username}: email di prova a ${esito.a || '-'} ${esito.success ? 'partita' : 'fallita'}.`);
            if (!esito.success) return res.status(422).json({ message: esito.error, dettaglio: esito.dettaglio });
            res.json({ message: `Email di prova inviata a ${esito.a}. Controlla la casella, anche nello spam.` });
        } catch (error) {
            logger.error("Errore durante l'email di prova:", error);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.get('/api/admin/audit-log', checkAdminRole, async (req, res) => {
        const pagina = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const perPagina = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = (pagina - 1) * perPagina;

        const condizioni = [];
        const parametri = [];
        if (req.query.action) {
            parametri.push(String(req.query.action));
            condizioni.push(`action = $${parametri.length}`);
        }
        if (req.query.username) {
            parametri.push(String(req.query.username));
            condizioni.push(`username = $${parametri.length}`);
        }
        const dove = condizioni.length > 0 ? `WHERE ${condizioni.join(' AND ')}` : '';

        try {
            const conteggio = await pool.query(`SELECT COUNT(*) FROM audit_log ${dove}`, parametri);
            const totale = parseInt(conteggio.rows[0].count, 10);

            const risultato = await pool.query(
                `SELECT id, occurred_at, user_id, username, action, entity_type, entity_id, details, ip_address
             FROM audit_log ${dove}
             ORDER BY occurred_at DESC, id DESC
             LIMIT $${parametri.length + 1} OFFSET $${parametri.length + 2}`,
                [...parametri, perPagina, offset]
            );

            res.status(200).json({
                entries: risultato.rows,
                pagination: { currentPage: pagina, totalPages: Math.ceil(totale / perPagina), totalEntries: totale, limit: perPagina }
            });
        } catch (error) {
            logger.error('Errore GET /api/admin/audit-log:', error);
            res.status(500).json({ message: 'Errore nel recupero del registro operazioni.' });
        }
    });
}
