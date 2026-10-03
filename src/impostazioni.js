// src/impostazioni.js
//
// Loghi, impostazioni dell'associazione e registro delle operazioni.

import fs from 'fs';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { checkAdminRole } from './autenticazione.js';
import { LOGO2_FILE_PATH, LOGO_FILE_PATH, cleanupRejectedFiles, uploadLogo2Multer, uploadLogoMulter, verifySingleUploadedImage } from './caricamenti.js';
import { MINUTI_ATTESA_CRITICA_MAX } from './costanti.js';
import { pool } from './db.js';
import { wss } from './tempoReale.js';

export function registraRotteImpostazioni(app) {

    app.post('/api/branding/logo', checkAdminRole, uploadLogoMulter.single('logoFile'), async (req, res) => {

        if (req.fileValidationError) {
            return res.status(400).json({ message: req.fileValidationError });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Nessun file immagine valido caricato.' });
        }
        if (!(await verifySingleUploadedImage(req, res, ['image/jpeg', 'image/png', 'image/gif']))) return;

        // Solo ora, verificato, sostituisce il logo in uso.
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

    // Tutte le impostazioni, credenziali SMTP comprese: solo per l'amministratore.
    app.get('/api/branding/settings/full', checkAdminRole, async (req, res) => {
        try {
            const result = await pool.query('SELECT setting_key, setting_value FROM branding_settings');
            const settings = result.rows.reduce((acc, row) => {
                acc[row.setting_key] = row.setting_value;
                return acc;
            }, {});
            res.status(200).json(settings);
        } catch (error) {
            logger.error("Errore durante il recupero delle impostazioni complete di branding:", error);
            res.status(500).json({ message: "Errore interno del server." });
        }
    });

    // Le chiavi che scrive solo il programma: lo stato degli aggiornamenti porta
    // l'indirizzo del pacchetto e la sua impronta, e si cambia solo dalla pagina
    // Sistema, che li verifica.
    const CHIAVI_INTERNE = new Set(['aggiornamenti_config', 'aggiornamenti_stato']);

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
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');


            for (const key in settingsToUpdate) {
                if (Object.hasOwnProperty.call(settingsToUpdate, key)) {
                    const value = settingsToUpdate[key];
                    // Un valore assurdo spegnerebbe il segnale di ritardo in sala.
                    if (key === 'minuti_attesa_critica' && String(value).trim() !== '') {
                        const minuti = Number(value);
                        if (!Number.isInteger(minuti) || minuti < 1 || minuti > MINUTI_ATTESA_CRITICA_MAX) {
                            // Il client lo rilascia il finally.
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
            // Non registriamo i valori: fra le impostazioni ci sono le credenziali SMTP.
            registraAudit(req, 'impostazioni.modificate', { tipo: 'impostazioni', dettagli: { chiavi: Object.keys(settingsToUpdate) } });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error("Errore durante l'aggiornamento delle impostazioni di branding:", error);
            res.status(500).json({ message: "Errore interno durante l'aggiornamento." });
        } finally {
            client.release();
        }
    });
    // Il registro delle operazioni, per l'amministratore.

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
