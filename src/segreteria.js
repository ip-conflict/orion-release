// Il fascicolo dei volontari: visite, corsi, cataloghi, tesserino.

import crypto from 'crypto';
import fs from 'fs';
import logger from './logger.js';
import path from 'path';
import { leggiCampiAnagrafici } from './anagrafica.js';
import { registraAudit } from './audit.js';
import { checkAdminRole, checkOwnershipOrSegreteria, checkSegreteriaAccess } from './autenticazione.js';
import { haPermesso, richiedePermesso } from './permessi.js';
import { certDir, uploadCertificate, uploadPhoto, verifyCertificateUpload, verifySingleUploadedImage } from './caricamenti.js';
import { pool } from './db.js';
import { magazzino } from './istanze.js';
import { qrVolontariAttivi } from './pubbliche.js';
import { runDailyExpiryCheck } from './scadenze.js';
import { inviaFile, proteggiCaricati } from './cifratura.js';
import { cancellaFile, fileDaIndirizzi } from './eliminazionePersona.js';

// Gli esiti che la segreteria può scegliere.
const ESITI_VISITA = ['Idoneo', 'Non Idoneo'];

// Una persona, un corso o un tipo di visita che non esistono: il certificato
// appena caricato non resta orfano sul disco.
async function riferimentoInesistente(error, req) {
    if (error?.code !== '23503') return false;
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
    return true;
}

export function registraRotteSegreteria(app) {
    // Il libretto: suo, o di chi gestisce visite e corsi. Chi gestisce solo
    // l'anagrafica lo legge senza visite e corsi (dati_sanitari: false).
    app.get('/api/users/:userId/libretto', (req, res, next) => {
        if (haPermesso(req, 'volontari.anagrafica') && !haPermesso(req, 'volontari.sanitario')) {
            req.senzaDatiSanitari = Number(req.params.userId) !== req.user.id;
            return next();
        }
        return checkOwnershipOrSegreteria(req, res, next);
    }, async (req, res) => {
        const userId = parseInt(req.params.userId, 10);
        if (!Number.isInteger(userId)) return res.status(400).json({ message: 'ID utente non valido.' });
        const client = await pool.connect();
        
        try {
            const medicalRes = await client.query(
                `SELECT umr.id, umr.visit_type_id, mvt.name as visit_name, umr.last_visit_date, umr.expiry_date, umr.status, umr.document_url 
             FROM user_medical_records umr
             LEFT JOIN medical_visit_types mvt ON umr.visit_type_id = mvt.id
             WHERE umr.user_id = $1 
             ORDER BY umr.last_visit_date DESC`,
                [userId]
            );

            const coursesRes = await client.query(`
            SELECT uc.id, uc.course_id, cc.name, cc.course_code, cc.validity_months,
                   uc.acquisition_date, uc.expiry_date, uc.document_url
            FROM user_courses uc
            JOIN courses_catalog cc ON uc.course_id = cc.id
            WHERE uc.user_id = $1
            ORDER BY uc.acquisition_date DESC
        `, [userId]);

            // I DPI dal magazzino: i pezzi singoli da chi li ha adesso, quelli a
            // quantità dal conto per detentore (lo stesso bene può essere di più persone).
            const equipmentRes = await client.query(
                `SELECT b.id, b.denominazione AS item_name, b.taglia AS size,
                    s.ultimo_movimento_il AS delivery_date,
                    (SELECT sc.scadenza FROM beni_scadenze sc
                      WHERE sc.bene_id = b.id AND sc.tipo = 'scadenza_dpi') AS expiry_date,
                    b.note AS notes, b.matricola,
                    (SELECT m.verbale_id FROM movimenti m
                      WHERE m.bene_id = b.id AND m.destinatario_user_id = $1
                      ORDER BY m.quando DESC, m.id DESC LIMIT 1) AS verbale_id,
                    1::numeric AS quantita, b.gestione
             FROM beni b JOIN beni_situazione s ON s.bene_id = b.id
             WHERE b.tipo = 'dpi' AND b.dismesso_il IS NULL AND b.gestione = 'singolo'
               AND s.destinatario_tipo = 'persona' AND s.destinatario_user_id = $1
             UNION ALL
             SELECT b.id, b.denominazione, b.taglia,
                    MAX(d.quando),
                    (SELECT sc.scadenza FROM beni_scadenze sc
                      WHERE sc.bene_id = b.id AND sc.tipo = 'scadenza_dpi'),
                    b.note, b.matricola,
                    (SELECT m.verbale_id FROM movimenti m
                      WHERE m.bene_id = b.id AND m.destinatario_user_id = $1 AND m.tipo = 'consegna'
                      ORDER BY m.quando DESC, m.id DESC LIMIT 1),
                    SUM(d.variazione), b.gestione
             FROM detenzioni_sfusi d JOIN beni b ON b.id = d.bene_id
             WHERE b.tipo = 'dpi' AND b.dismesso_il IS NULL
               AND d.detentore_tipo = 'persona' AND d.user_id = $1
             GROUP BY b.id, b.denominazione, b.taglia, b.note, b.matricola, b.gestione
             HAVING SUM(d.variazione) > 0
             ORDER BY delivery_date DESC`,
                [userId]
            );

            // La sezione dei DPI compare solo a magazzino acceso.
            const magazzino = await client.query(
                "SELECT setting_value FROM branding_settings WHERE setting_key = 'magazzino_enabled'");
            const magazzinoAttivo = magazzino.rowCount > 0 && String(magazzino.rows[0].setting_value) === 'true';

            const nascondi = req.senzaDatiSanitari === true;
            res.json({
                medical_records: nascondi ? [] : medicalRes.rows,
                courses: nascondi ? [] : coursesRes.rows,
                dati_sanitari: !nascondi,
                equipment: magazzinoAttivo ? equipmentRes.rows : [],
                magazzino_attivo: magazzinoAttivo
            });

        } catch (error) {
            logger.error(`Errore GET /api/users/${userId}/libretto:`, error);
            res.status(500).json({ message: 'Errore durante il recupero del libretto.' });
        } finally {
            client.release();
        }
    });


    // Il QR e la foto per stampare il tesserino di un volontario.
    app.get('/api/admin/users/:id/tesserino', richiedePermesso('volontari.anagrafica'), async (req, res) => {
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) return res.status(400).json({ message: 'ID Utente non valido' });
        try {
            const r = await pool.query('SELECT id, nome, cognome, photo_url, public_token FROM users WHERE id = $1', [userId]);
            if (r.rowCount === 0) return res.status(404).json({ message: 'Utente non trovato' });
            const qrAttivo = await qrVolontariAttivi();
            res.json({ ...r.rows[0], public_token: qrAttivo ? r.rows[0].public_token : null, qr_attivo: qrAttivo });
        } catch (error) {
            logger.error('Errore lettura tesserino:', error);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    // La foto la carica anche la segreteria, che stampa i tesserini.
    app.post('/api/admin/users/:id/photo', richiedePermesso('volontari.anagrafica'), uploadPhoto.single('photo'), async (req, res) => {
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) return res.status(400).json({ message: 'ID Utente non valido' });
        if (!req.file) return res.status(400).json({ message: 'Nessuna immagine caricata.' });
        if (!(await verifySingleUploadedImage(req, res, ['image/jpeg', 'image/png', 'image/gif', 'image/webp']))) return;
        await proteggiCaricati(req.file);
        const photoUrl = `/api/photos/${req.file.filename}`;
        try {
            // La foto di prima non serve più: si toglie dal disco.
            const r = await pool.query(
                `UPDATE users u SET photo_url = $1 FROM (SELECT photo_url AS vecchia FROM users WHERE id = $2) v
                  WHERE u.id = $2 AND u.eliminato_il IS NULL RETURNING v.vecchia`, [photoUrl, userId]);
            if (r.rowCount === 0) {
                await fs.promises.unlink(req.file.path).catch(() => {});
                return res.status(404).json({ message: 'Utente non trovato' });
            }
            await cancellaFile(fileDaIndirizzi([r.rows[0].vecchia]));
            registraAudit(req, 'utente.foto_cambiata', { tipo: 'utente', id: userId });
            res.json({ message: 'Foto aggiornata.', photo_url: photoUrl });
        } catch (error) {
            logger.error('Errore salvataggio foto utente:', error);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });

    // Tesserino perso: un token nuovo, il vecchio QR non vale più.
    app.post('/api/admin/users/:id/rigenera-tesserino', richiedePermesso('volontari.anagrafica'), async (req, res) => {
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) return res.status(400).json({ message: 'ID Utente non valido' });
        try {
            const r = await pool.query('UPDATE users SET public_token = $1 WHERE id = $2 RETURNING public_token',
                [crypto.randomUUID(), userId]);
            if (r.rowCount === 0) return res.status(404).json({ message: 'Utente non trovato' });
            registraAudit(req, 'tesserino.rigenerato', { tipo: 'utente', id: userId });
            res.json({ message: 'QR del tesserino rigenerato: il vecchio non vale piu\'.', public_token: r.rows[0].public_token });
        } catch (error) {
            logger.error('Errore rigenerazione tesserino:', error);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.delete('/api/admin/medical-records/:id', checkSegreteriaAccess, async (req, res) => {
        const recordId = parseInt(req.params.id, 10);
        if (isNaN(recordId)) return res.status(400).json({ message: 'ID non valido.' });

        try {
            const result = await pool.query(
                'DELETE FROM user_medical_records WHERE id = $1 RETURNING id, document_url',
                [recordId]
            );
            
            if (result.rowCount === 0) {
                return res.status(404).json({ message: 'Visita non trovata.' });
            }
            // Con la visita se ne va il suo certificato.
            await cancellaFile(fileDaIndirizzi([result.rows[0].document_url]));
            
            res.json({ message: 'Visita eliminata con successo.' });
            registraAudit(req, 'libretto.visita_eliminata', { tipo: 'visita_medica', id: recordId });
        } catch (error) {
            logger.error(`Errore DELETE medical-records ${recordId}:`, error);
            res.status(500).json({ message: 'Errore durante l\'eliminazione.' });
        }
    });

    // Prima del caricamento: con un indirizzo sbagliato il file non va salvato.
    const idPersonaValido = (req, res, next) => (/^[1-9]\d{0,9}$/.test(req.params.userId)
        ? next() : res.status(400).json({ message: 'Persona non valida.' }));

    app.post('/api/admin/users/:userId/medical-records', 
        checkSegreteriaAccess, 
        idPersonaValido,
        uploadCertificate.single('document'), 
        async (req, res) => {
            if (!(await verifyCertificateUpload(req, res))) return;
            await proteggiCaricati(req.file);
            const { visit_type_id, last_visit_date, expiry_date, status } = req.body;

            const visitDate = new Date(last_visit_date);
            const expiryDate = new Date(expiry_date);
            if (!last_visit_date || !expiry_date || isNaN(visitDate.getTime()) || isNaN(expiryDate.getTime())) {
                return res.status(400).json({ message: 'Data della visita e data di scadenza sono obbligatorie e devono essere valide.' });
            }
            if (!ESITI_VISITA.includes(status)) {
                return res.status(400).json({ message: "L'esito della visita è obbligatorio: Idoneo o Non Idoneo." });
            }
            if (visitDate >= expiryDate) {
                return res.status(400).json({ message: 'La data di visita deve essere antecedente alla data di scadenza.' });
            }
            const userId = parseInt(req.params.userId, 10);

            const document_url = req.file ? `/api/documents/certificates/${req.file.filename}` : null;

            const client = await pool.connect();
            try {
                await client.query(
                    `INSERT INTO user_medical_records (user_id, visit_type_id, last_visit_date, expiry_date, status, document_url) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                    [userId, visit_type_id || 1, last_visit_date, expiry_date, status, document_url]
                );
                res.status(201).json({ message: 'Visita medica salvata con successo.', document_url });
            } catch (error) {
                if (await riferimentoInesistente(error, req)) {
                    return res.status(404).json({ message: 'La persona o il tipo di visita indicati non esistono.' });
                }
                logger.error(`Errore POST medical-records per utente ${userId}:`, error);
                res.status(500).json({ message: 'Errore salvataggio visita medica.' });
            } finally { client.release(); }
        });

    app.post('/api/admin/users/:userId/courses', 
        checkSegreteriaAccess, 
        idPersonaValido,
        uploadCertificate.single('document'),
        async (req, res) => {
            if (!(await verifyCertificateUpload(req, res))) return;
            await proteggiCaricati(req.file);
            const userId = parseInt(req.params.userId, 10);
            const { course_id, acquisition_date, expiry_date } = req.body;

            if (!course_id || !acquisition_date) {
                return res.status(400).json({ message: 'Corso e data di acquisizione sono obbligatori.' });
            }

            const document_url = req.file ? `/api/documents/certificates/${req.file.filename}` : null;
            const finalExpiry = expiry_date ? expiry_date : null;

            const client = await pool.connect();
            try {
                await client.query(
                    `INSERT INTO user_courses (user_id, course_id, acquisition_date, expiry_date, document_url) 
                 VALUES ($1, $2, $3, $4, $5)`,
                    [userId, course_id, acquisition_date, finalExpiry, document_url]
                );

                logger.info(`Segreteria ha registrato il corso ID ${course_id} per l'utente ${userId}`);
                res.status(201).json({ message: 'Corso registrato con successo.', document_url });
            } catch (error) {
                if (await riferimentoInesistente(error, req)) {
                    return res.status(404).json({ message: 'La persona o il corso indicati non esistono.' });
                }
                logger.error(`Errore POST courses per utente ${userId}:`, error);
                res.status(500).json({ message: 'Errore durante la registrazione del corso.' });
            } finally {
                client.release();
            }
    });



    app.get('/api/admin/segreteria/dashboard', checkSegreteriaAccess, async (req, res) => {
        const client = await pool.connect();
        
        try {
            // L'ultima visita di ciascuno.
            const medicalQuery = `
            SELECT * FROM (
                SELECT u.id, u.nome, u.cognome, 
                       (SELECT expiry_date::DATE FROM user_medical_records WHERE user_id = u.id ORDER BY last_visit_date DESC LIMIT 1) AS scadenza,
                       (SELECT status FROM user_medical_records WHERE user_id = u.id ORDER BY last_visit_date DESC LIMIT 1) AS ultimo_stato
                FROM users u
                WHERE (u.is_active = true OR u.is_active IS NULL) AND u.role != 'esterno'
            ) as subq
            WHERE (scadenza IS NULL)
               OR (scadenza <= CURRENT_DATE + INTERVAL '30 days')
               OR (ultimo_stato != 'Idoneo')
            -- Nessun limite verso il passato: prima c'era "e non scaduta da più
            -- di 7 giorni", che faceva sparire dal cruscotto proprio chi era
            -- fuori regola da più tempo. Un volontario con la visita scaduta da
            -- tre mesi non risultava da nessuna parte, mentre il blocco
            -- operativo continuava a escluderlo dalle squadre: la segreteria
            -- vedeva una persona non assegnabile senza una spiegazione.
            -- Le più urgenti in cima: mai registrata, poi la più scaduta.
            ORDER BY scadenza ASC NULLS FIRST, cognome ASC
        `;
            const medicalRes = await client.query(medicalQuery);

            // L'ultimo rinnovo di ciascun corso.
            const coursesQuery = `
            SELECT * FROM (
                SELECT DISTINCT ON (u.id, cc.id) 
                       u.id, u.nome, u.cognome, cc.name AS corso_scaduto, uc.expiry_date::DATE AS scadenza
                FROM users u
                JOIN user_courses uc ON u.id = uc.user_id
                JOIN courses_catalog cc ON cc.id = uc.course_id
                WHERE (u.is_active = true OR u.is_active IS NULL) AND u.role != 'esterno'
                AND uc.expiry_date IS NOT NULL
                ORDER BY u.id, cc.id, uc.expiry_date DESC
            ) AS latest_courses
            -- Come per le visite: un corso scaduto resta in elenco finché non
            -- viene rinnovato, non solo per una settimana.
            WHERE scadenza <= CURRENT_DATE + INTERVAL '30 days'
            ORDER BY scadenza ASC, cognome ASC
        `;
            const coursesRes = await client.query(coursesQuery);

            res.json({
                expiring_medical: medicalRes.rows,
                expired_courses: coursesRes.rows
            });

        } catch (error) {
            logger.error('Errore Dashboard Segreteria:', error);
            res.status(500).json({ message: 'Errore nel caricamento degli allarmi.' });
        } finally {
            client.release();
        }
    });

    app.get('/api/admin/medical-visit-types', richiedePermesso('volontari.sanitario'), async (req, res) => {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT id, name, validity_months FROM medical_visit_types ORDER BY name ASC');
            res.json(result.rows);
        } catch (error) {
            logger.error('Errore GET medical-visit-types:', error);
            res.status(500).json({ message: 'Errore nel caricamento del catalogo visite.' });
        } finally { client.release(); }
    });

    app.get('/api/admin/courses-catalog', richiedePermesso('volontari.sanitario'), async (req, res) => {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT id, name, validity_months, course_code FROM courses_catalog ORDER BY name ASC');
            res.json(result.rows);
        } catch (error) {
            logger.error('Errore GET courses-catalog:', error);
            res.status(500).json({ message: 'Errore nel caricamento del catalogo corsi.' });
        } finally { client.release(); }
    });

    app.post('/api/admin/courses-catalog', richiedePermesso('volontari.sanitario'), async (req, res) => {
        const { name, validity_months, course_code } = req.body;
        if (!name || name.trim() === '') {
            return res.status(400).json({ message: 'Il nome del corso non può essere vuoto.' });
        }
        const months = validity_months ? parseInt(validity_months, 10) : null;
        const code = course_code ? course_code.trim().toUpperCase() : null;

        try {
            const result = await pool.query(
                'INSERT INTO courses_catalog (name, validity_months, course_code) VALUES ($1, $2, $3) RETURNING *',
                [name.trim(), months, code]
            );
            res.status(201).json(result.rows[0]);
        } catch (error) {
            if (error.code === '23505') return res.status(400).json({ message: 'Esiste già un corso con questo nome o con questo codice.' });
            logger.error('Errore creazione corso:', error);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.post('/api/admin/medical-visit-types', richiedePermesso('volontari.sanitario'), async (req, res) => {
        const { name, validity_months } = req.body;
        if (!name || name.trim() === '') {
            return res.status(400).json({ message: 'Il nome della visita non può essere vuoto.' });
        }
        const months = validity_months ? parseInt(validity_months, 10) : null;

        try {
            const result = await pool.query(
                'INSERT INTO medical_visit_types (name, validity_months) VALUES ($1, $2) RETURNING *',
                [name.trim(), months]
            );
            res.status(201).json(result.rows[0]);
        } catch (error) {
            if (error.code === '23505') return res.status(400).json({ message: 'Questa visita esiste già nel catalogo.' });
            logger.error('Errore creazione visita medica:', error);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.delete('/api/admin/medical-visit-types/:id', richiedePermesso('volontari.sanitario'), async (req, res) => {
        const visitId = parseInt(req.params.id, 10);
        try {
            const visitCheck = await pool.query('SELECT name FROM medical_visit_types WHERE id = $1', [visitId]);
            if (visitCheck.rows.length === 0) return res.status(404).json({ message: 'Visita non trovata.' });
            
            if (visitCheck.rows[0].name.toLowerCase() === 'visita di idoneità fisica') {
                return res.status(403).json({ message: 'Operazione negata: La visita di base è un requisito di sistema e non può essere eliminata.' });
            }

            const usageCheck = await pool.query('SELECT count(*) FROM user_medical_records WHERE visit_type_id = $1', [visitId]);
            if (parseInt(usageCheck.rows[0].count) > 0) {
                return res.status(400).json({ message: `Impossibile eliminare: questa visita è già presente nel fascicolo di ${usageCheck.rows[0].count} volontari.` });
            }

            await pool.query('DELETE FROM medical_visit_types WHERE id = $1', [visitId]);
            res.json({ message: 'Visita eliminata dal catalogo.' });
        } catch (error) {
            logger.error(`Errore eliminazione visita catalogo ${visitId}:`, error);
            res.status(500).json({ message: 'Errore interno durante l\'eliminazione.' });
        }
    });

    app.put('/api/admin/courses-catalog/:id', richiedePermesso('volontari.sanitario'), async (req, res) => {
        const courseId = parseInt(req.params.id, 10);
        const { name, validity_months, course_code } = req.body;
        if (isNaN(courseId)) return res.status(400).json({ message: 'ID non valido.' });
        const months = validity_months ? parseInt(validity_months, 10) : null;
        const code = course_code ? course_code.trim().toUpperCase() : null;

        try {
            if (courseId === 1) {
                // Del corso base (id 1) si cambiano solo codice e validità.
                const result = await pool.query(
                    'UPDATE courses_catalog SET validity_months = $1, course_code = $2 WHERE id = $3 RETURNING *',
                    [months, code, courseId]
                );
                return res.json(result.rows[0]);
            } else {
                if (!name || name.trim() === '') return res.status(400).json({ message: 'Nome corso obbligatorio.' });
                const result = await pool.query(
                    'UPDATE courses_catalog SET name = $1, validity_months = $2, course_code = $3 WHERE id = $4 RETURNING *',
                    [name.trim(), months, code, courseId]
                );
                return res.json(result.rows[0]);
            }
        } catch (error) {

            if (error.code === '23505') return res.status(400).json({ message: 'Esiste già un corso con questo nome o con questo codice.' });
            logger.error('Errore aggiornamento corso catalogo:', error);
            res.status(500).json({ message: 'Errore interno.' });
        }
    });

    app.delete('/api/admin/courses-catalog/:id', checkSegreteriaAccess, async (req, res) => {
        const courseId = parseInt(req.params.id, 10);
        
        try {
            // Il corso base non si elimina, né un corso che qualcuno ha nel libretto.
            if (courseId === 1) {
                return res.status(403).json({ message: 'Operazione negata: Questo è un requisito di sistema e non può essere eliminato.' });
            }

            const courseCheck = await pool.query('SELECT id FROM courses_catalog WHERE id = $1', [courseId]);
            if (courseCheck.rows.length === 0) return res.status(404).json({ message: 'Corso non trovato.' });


            const usageCheck = await pool.query('SELECT count(*) FROM user_courses WHERE course_id = $1', [courseId]);
            if (parseInt(usageCheck.rows[0].count) > 0) {
                return res.status(400).json({ 
                    message: `Impossibile eliminare: questo corso è già presente nel fascicolo di ${usageCheck.rows[0].count} volontari.` 
                });
            }

            await pool.query('DELETE FROM courses_catalog WHERE id = $1', [courseId]);
            res.json({ message: 'Corso eliminato dal catalogo.' });

        } catch (error) {
            logger.error(`Errore eliminazione corso catalogo ${courseId}:`, error);
            res.status(500).json({ message: 'Errore interno durante l\'eliminazione.' });
        }
    });

    app.put('/api/admin/courses/:id', checkSegreteriaAccess, uploadCertificate.single('document'), async (req, res) => {
        if (!(await verifyCertificateUpload(req, res))) return;
        await proteggiCaricati(req.file);
        const recordId = parseInt(req.params.id, 10);
        const { acquisition_date, expiry_date, delete_document } = req.body;

        if (isNaN(recordId) || !acquisition_date) {
            return res.status(400).json({ message: 'Dati incompleti o ID non valido.' });
        }

        const client = await pool.connect();
        try {
            const expDate = expiry_date ? expiry_date : null;
            const delDoc = delete_document === 'true';
            // Il documento di prima, da togliere dal disco se viene sostituito o rimosso.
            const prima = (await client.query('SELECT document_url FROM user_courses WHERE id = $1', [recordId])).rows[0]?.document_url;

            if (req.file) {
                const new_document_url = `/api/documents/certificates/${req.file.filename}`;
                await client.query(
                    `UPDATE user_courses SET acquisition_date = $1, expiry_date = $2, document_url = $3 WHERE id = $4`,
                    [acquisition_date, expDate, new_document_url, recordId]
                );
            } else if (delDoc) {
                await client.query(
                    `UPDATE user_courses SET acquisition_date = $1, expiry_date = $2, document_url = NULL WHERE id = $3`,
                    [acquisition_date, expDate, recordId]
                );
            } else {
                await client.query(
                    `UPDATE user_courses SET acquisition_date = $1, expiry_date = $2 WHERE id = $3`,
                    [acquisition_date, expDate, recordId]
                );
            }

            if ((req.file || delDoc) && prima) await cancellaFile(fileDaIndirizzi([prima]));
            res.json({ message: 'Corso aggiornato con successo.' });
        } catch (error) {
            logger.error(`Errore PUT courses ${recordId}:`, error);
            res.status(500).json({ message: 'Errore durante l\'aggiornamento del corso.' });
        } finally {
            client.release();
        }
    });

    app.delete('/api/admin/courses/:id', checkSegreteriaAccess, async (req, res) => {
        const recordId = parseInt(req.params.id, 10);
        if (isNaN(recordId)) return res.status(400).json({ message: 'ID non valido.' });

        try {
            const result = await pool.query('DELETE FROM user_courses WHERE id = $1 RETURNING id, document_url', [recordId]);
            if (result.rowCount === 0) return res.status(404).json({ message: 'Corso non trovato nel libretto.' });
            // Con il corso se ne va il suo attestato.
            await cancellaFile(fileDaIndirizzi([result.rows[0].document_url]));
            
            res.json({ message: 'Corso eliminato dal libretto.' });
            registraAudit(req, 'libretto.corso_eliminato', { tipo: 'corso_utente', id: recordId });
        } catch (error) {
            logger.error(`Errore DELETE courses ${recordId}:`, error);
            res.status(500).json({ message: 'Errore durante l\'eliminazione del corso.' });
        }
    });

    app.get('/api/documents/certificates/:filename',
        // Il proprietario si legge dal database, dalla riga che punta a questo
        // file: il numero nel nome non è una prova (i certificati sostituiti
        // dalle rotte di modifica portano nel nome l'id della riga, non
        // dell'utente). Senza una riga che lo richiami, il file non esiste per
        // chi chiede.
        async (req, res, next) => {
            const filename = req.params.filename;
            if (!/^cert-\d+-[0-9a-f]+\.[a-z0-9]+$/i.test(filename)) {
                return res.status(400).json({ message: 'Nome file non valido.' });
            }
            const url = `/api/documents/certificates/${filename}`;
            try {
                const r = await pool.query(
                    `SELECT user_id FROM user_medical_records WHERE document_url = $1
                     UNION SELECT user_id FROM user_courses WHERE document_url = $1 LIMIT 1`, [url]);
                if (r.rowCount === 0) return res.status(404).json({ message: 'Il documento non è stato trovato.' });
                req.params.userId = String(r.rows[0].user_id);
                next();
            } catch (e) {
                logger.error('Errore nel controllo del proprietario del certificato:', e);
                res.status(500).json({ message: 'Errore interno.' });
            }
    }, checkOwnershipOrSegreteria, (req, res) => {
        const safePath = path.resolve(certDir, req.params.filename);
        if (!safePath.startsWith(certDir + path.sep)) {
            logger.warn(`[SECURITY] Tentativo di path traversal bloccato: ${safePath}`);
            return res.status(403).json({ message: 'Accesso negato al percorso.' });
        }
        if (!fs.existsSync(safePath)) {
            return res.status(404).json({ message: 'Il documento non è stato trovato.' });
        }
        inviaFile(res, safePath);
    });

    app.put('/api/admin/medical-records/:id', 
        checkSegreteriaAccess, 
        uploadCertificate.single('document'),
        async (req, res) => {
            if (!(await verifyCertificateUpload(req, res))) return;
            await proteggiCaricati(req.file);
            const recordId = parseInt(req.params.id, 10);
            const { last_visit_date, expiry_date, status } = req.body;
            // Prima i campi obbligatori, poi il confronto fra date.
            if (isNaN(recordId) || !last_visit_date || !expiry_date || !status) {
                return res.status(400).json({ message: 'Dati incompleti o ID non valido.' });
            }
            if (!ESITI_VISITA.includes(status)) {
                return res.status(400).json({ message: "L'esito della visita deve essere Idoneo o Non Idoneo." });
            }
            const visitDate = new Date(last_visit_date);
            const expiryDate = new Date(expiry_date);
            if (isNaN(visitDate.getTime()) || isNaN(expiryDate.getTime())) {
                return res.status(400).json({ message: 'Le date indicate non sono valide.' });
            }
            if (visitDate >= expiryDate) {
                return res.status(400).json({ message: 'La data di visita deve essere antecedente alla data di scadenza.' });
            }

            const client = await pool.connect();
            try {
                const delete_document = req.body.delete_document === 'true';
                // Il certificato di prima, da togliere dal disco se viene sostituito o rimosso.
                const prima = (await client.query('SELECT document_url FROM user_medical_records WHERE id = $1', [recordId])).rows[0]?.document_url;

                if (req.file) {
                    const new_document_url = `/api/documents/certificates/${req.file.filename}`;
                    await client.query(
                        `UPDATE user_medical_records SET last_visit_date = $1, expiry_date = $2, status = $3, document_url = $4 WHERE id = $5`,
                        [last_visit_date, expiry_date, status, new_document_url, recordId]
                    );
                } 

                else if (delete_document) {
                    await client.query(
                        `UPDATE user_medical_records SET last_visit_date = $1, expiry_date = $2, status = $3, document_url = NULL WHERE id = $4`,
                        [last_visit_date, expiry_date, status, recordId]
                    );
                } 

                else {
                    await client.query(
                        `UPDATE user_medical_records SET last_visit_date = $1, expiry_date = $2, status = $3 WHERE id = $4`,
                        [last_visit_date, expiry_date, status, recordId]
                    );
                }

                if ((req.file || delete_document) && prima) await cancellaFile(fileDaIndirizzi([prima]));
                res.json({ message: 'Visita medica aggiornata con successo.' });
            } catch (error) {
                logger.error(`Errore PUT medical-records ${recordId}:`, error);
                res.status(500).json({ message: 'Errore durante l\'aggiornamento.' });
            } finally {
                client.release();
            }
    });

    app.put('/api/admin/users/:id/anagrafica', richiedePermesso('volontari.anagrafica'), async (req, res) => {
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) return res.status(400).json({ message: 'ID non valido.' });
        const { valori, errore } = leggiCampiAnagrafici(
            { codice_fiscale: req.body?.codice_fiscale ?? null, telefono: req.body?.telefono ?? null }, ['codice_fiscale', 'telefono']);
        if (errore) return res.status(400).json({ message: errore });

        try {
            const result = await pool.query(
                'UPDATE users SET codice_fiscale = $1, telefono = $2 WHERE id = $3 RETURNING id, nome, cognome, codice_fiscale, telefono',
                [valori.codice_fiscale, valori.telefono, userId]
            );

            if (result.rowCount === 0) return res.status(404).json({ message: 'Utente non trovato.' });
            res.json({ message: 'Anagrafica aggiornata con successo.', user: result.rows[0] });

        } catch (error) {
            if (error.code === '23505') return res.status(409).json({ message: 'Questo Codice Fiscale è già associato a un altro utente.' });
            logger.error(`Errore aggiornamento anagrafica utente ${userId}:`, error);
            res.status(500).json({ message: 'Errore interno durante il salvataggio.' });
        }
    });


    // Il riepilogo alla segreteria subito, invece che il primo del mese.

    app.post('/api/admin/report-scadenze', checkAdminRole, async (req, res) => {
        try {
            const esito = await runDailyExpiryCheck(true, { soloReport: true });
            if (!esito) return res.status(500).json({ message: 'Il controllo delle scadenze non è andato a buon fine: vedi il registro del server.' });
            if (!esito.segreteria_attiva) return res.status(409).json({ message: 'Il modulo Segreteria è spento: il riepilogo non parte.' });
            if (!esito.destinatari) return res.status(409).json({ message: 'Nessun destinatario: accendi il Report Mensile Segreteria (arriva ad amministratori e segreteria che hanno un indirizzo email) oppure scrivi degli indirizzi aggiuntivi, e salva.' });
            if (!esito.elencati) return res.json({ ...esito, message: 'Nessuna scadenza fra tre mesi fa e fra tre mesi: non c\'era niente da mandare.' });
            if (esito.falliti) return res.status(502).json({ ...esito, message: `Riepilogo inviato a ${esito.inviati} indirizzi, non inviato a ${esito.falliti}: ${esito.errore}` });
            registraAudit(req, 'segreteria.report_inviato', { dettagli: { destinatari: esito.destinatari, voci: esito.elencati } });
            res.json({ ...esito, message: `Riepilogo con ${esito.elencati} scadenze inviato a ${esito.inviati} indirizz${esito.inviati === 1 ? 'o' : 'i'}.` });
        } catch (error) {
            logger.error('Errore invio report scadenze:', error);
            res.status(500).json({ message: 'Errore durante l\'invio del riepilogo.' });
        }
    });
}
