// src/emergenze.js
//
// Apertura e chiusura delle emergenze, archivio, documenti ed eventi.

import fs from 'fs';
import logger from './logger.js';
import path from 'path';
import { registraAudit } from './audit.js';
import { authenticateToken, checkAdminRole, chiudiSessioni, haRuolo, nomeUtente, nonEsterni, puoVedereEmergenza } from './autenticazione.js';
import { eseguiBackupDatabase } from './backup.js';
import { protectedDocsDir, uploadDocumentMulter, verifyDocumentUpload } from './caricamenti.js';
import { ACTIVE_REPORT_STATUSES_BACKEND } from './costanti.js';
import { pool } from './db.js';
import { chiudiEsterniTemporanei } from './esterniTemporanei.js';
import { beniInCarico } from './magazzino.js';
import { uploadLimiter } from './middleware/rateLimiters.js';
import { CARTELLA_RESOCONTI, componiResocontoEmergenza, salvaResocontoEmergenza } from './resoconto.js';
import { annotaRegistroSquadre } from './squadre.js';
import { activeEmergency, impostaEmergenzaAttiva } from './statoEmergenza.js';
import { avvisaClienti, notifiche, wss } from './tempoReale.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Alla chiusura le squadre rimaste vuote si chiudono d'ufficio, tranne quelle
// con materiale in carico: lì decide una persona.
async function chiudiSquadreVuote(emergencyId, req) {
    const { rows } = await pool.query(`
        SELECT s.id, s.nome_radio, s.nome FROM squadre s
        WHERE NOT EXISTS (SELECT 1 FROM squadra_membri sm WHERE sm.squadra_id = s.id)`);
    const chiuse = [];
    for (const s of rows) {
        const inCarico = await beniInCarico(pool, 'squadra', s.id);
        if (inCarico.length > 0) {
            logger.info(`[Squadre] ${s.nome_radio} è vuota ma ha ${inCarico.length} beni in carico: resta aperta.`);
            continue;
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await annotaRegistroSquadre(client, [{
                squadra_id: s.id, nome_radio: s.nome_radio, squadra_nome: s.nome,
                azione: 'squadra_eliminata', motivo: 'chiusura_emergenza'
            }], req, emergencyId);

            await client.query('DELETE FROM squadre WHERE id = $1', [s.id]);
            await client.query('COMMIT');
            chiuse.push(s);
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error(`[Squadre] Chiusura d'ufficio di ${s.nome_radio} non riuscita:`, e);
        } finally {
            client.release();
        }
    }
    if (chiuse.length) {
        registraAudit(req, 'squadra.eliminata', {
            tipo: 'emergenza', id: emergencyId,
            dettagli: { d_ufficio: true, motivo: 'vuote alla chiusura', squadre: chiuse.map(s => s.nome_radio) }
        });
        avvisaClienti('reload_squadre');
        logger.info(`[Squadre] Chiuse d'ufficio ${chiuse.length} squadre vuote: ${chiuse.map(s => s.nome_radio).join(', ')}.`);
    }
    return chiuse;
}

export function registraRotteEmergenze(app) {

    app.get('/uploads/documents/:filename', async (req, res) => {
        const documentsDir = path.resolve(__dirname, '..', 'protected_uploads', 'documents');
        const safePath = path.resolve(documentsDir, req.params.filename);
        if (!safePath.startsWith(documentsDir + path.sep)) {
            return res.status(403).json({ message: 'Accesso negato' });
        }
        if (!fs.existsSync(safePath)) return res.status(404).json({ message: 'File non trovato' });
        try {
            // Di un'emergenza chiusa solo l'amministratore.
            const r = await pool.query('SELECT emergency_id FROM emergency_documents WHERE file_path = $1 LIMIT 1',
                [`/uploads/documents/${req.params.filename}`]);
            if (r.rowCount === 0 ? !haRuolo(req, 'admin') : !puoVedereEmergenza(req, r.rows[0].emergency_id)) {
                return res.status(403).json({ message: "Documento di un'emergenza chiusa: riservato all'amministratore." });
            }
        } catch (error) {
            logger.error('Errore controllo accesso documento:', error);
            return res.status(500).json({ message: 'Errore interno.' });
        }
        res.sendFile(safePath);
    });


    app.get('/api/emergencies/status', (req, res) => {
        if (activeEmergency) {
             res.status(200).json({ active: true, emergency: activeEmergency });
        } else {
             res.status(200).json({ active: false, emergency: null });
        }
    });

    app.post('/api/emergencies/open',  checkAdminRole, async (req, res) => {
        if (activeEmergency) {
            return res.status(409).json({ message: `Un'emergenza (ID: ${activeEmergency.id}, Codice: ${activeEmergency.code}) è già attiva.` });
        }

        // azzera_squadre: si sciolgono le squadre di prima. Se restano, i loro
        // membri risultano entrati all'apertura.
        const { external_code, name, azzera_squadre } = req.body;

        if (!external_code || String(external_code).trim() === '') {
            return res.status(400).json({ message: 'Il codice emergenza esterno è obbligatorio.' });
        }
        const sanitizedExternalCode = String(external_code).trim().toUpperCase(); 
        const emergencyName = name ? String(name).trim() : null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let squadreSciolte = 0;
            let collegamentiStoriciPersi = 0;
            if (azzera_squadre === true) {
                const daSciogliere = await client.query('SELECT id FROM squadre');
                squadreSciolte = daSciogliere.rowCount;
                // I collegamenti a segnalazioni di emergenze chiuse se ne vanno
                // con le squadre: si contano, per dirlo.
                const storici = await client.query('SELECT COUNT(*)::int AS quanti FROM report_team_assignments');
                collegamentiStoriciPersi = storici.rows[0].quanti;
                await client.query('DELETE FROM report_team_assignments WHERE squadra_id IN (SELECT id FROM squadre)');
                await client.query('DELETE FROM squadra_membri');
                await client.query('DELETE FROM squadre');
            }

            const result = await client.query(
                'INSERT INTO emergencies (code, name, status, start_time) VALUES ($1, $2, $3, NOW()) RETURNING *',
                [sanitizedExternalCode, emergencyName, 'ACTIVE']
            );
            const newEmergency = result.rows[0];


            const membriEreditati = (await client.query(`
            SELECT sm.username, sm.nome, sm.cognome, s.id AS squadra_id, s.nome_radio, s.nome AS squadra_nome
            FROM squadra_membri sm JOIN squadre s ON s.id = sm.squadra_id
            ORDER BY s.nome_radio, sm.cognome
        `)).rows;
            await annotaRegistroSquadre(client, membriEreditati.map(m => ({
                squadra_id: m.squadra_id, nome_radio: m.nome_radio, squadra_nome: m.squadra_nome,
                username: m.username, nome: m.nome, cognome: m.cognome,
                azione: 'membro_aggiunto', motivo: 'apertura_emergenza'
            })), req, newEmergency.id);

            await client.query('COMMIT');

            // Solo dopo il COMMIT.
            impostaEmergenzaAttiva({ id: newEmergency.id, code: newEmergency.code, name: newEmergency.name, start_time: newEmergency.start_time });
            logger.info(`EMERGENZA APERTA: ID=${activeEmergency.id}, Code=${activeEmergency.code}`);


            res.status(201).json({
                message: 'Emergenza aperta con successo.',
                emergency: activeEmergency,
                squadre_sciolte: squadreSciolte,
                collegamenti_storici_persi: collegamentiStoriciPersi,
                squadre_ereditate: new Set(membriEreditati.map(m => m.squadra_id)).size,
                volontari_ereditati: membriEreditati.length
            });
            // Nella coda di tutti gli interni, niente email. Scade con l'emergenza.
            pool.query(`SELECT u.id FROM users u WHERE COALESCE(u.is_active, true) = true
                    AND NOT EXISTS (SELECT 1 FROM utenti_ruoli ur WHERE ur.user_id = u.id AND ur.ruolo = 'esterno')`)
                .then(({ rows }) => notifiche.notificaA(rows.map(r => r.id), {
                    tipo: 'emergenza_aperta',
                    titolo: `Emergenza aperta: ${newEmergency.code}`,
                    testo: newEmergency.name || null,
                    riferimento: { tipo: 'emergenza', id: newEmergency.id },
                    chiave: `emergenza_aperta:${newEmergency.id}`,
                    oreValidita: 72
                }))
                .catch(e => logger.error("[Notifiche] Avviso di apertura dell'emergenza non riuscito:", e));
            registraAudit(req, 'emergenza.aperta', { tipo: 'emergenza', id: newEmergency.id, dettagli: { codice: newEmergency.code, nome: newEmergency.name, squadre_sciolte: squadreSciolte, collegamenti_storici_persi: collegamentiStoriciPersi, volontari_ereditati: membriEreditati.length } });


            wss.clients.forEach(wsClient => {
                 if (wsClient.readyState === 1) {
                     try { wsClient.send(JSON.stringify({ action: 'emergency_status_change', status: { active: true, emergency: activeEmergency } })); } catch(e){}
                 }
            });

        } catch (error) {
             await client.query('ROLLBACK');
             logger.error("Errore apertura emergenza:", error);

                 res.status(500).json({ message: "Errore interno durante l'apertura dell'emergenza." });

        } finally {
            client.release();
        }
    });

    app.post('/api/emergencies/close', checkAdminRole, async (req, res) => {
        if (!activeEmergency) {
            return res.status(400).json({ message: 'Nessuna emergenza attiva da chiudere.' });
        }

        const emergencyIdToClose = activeEmergency.id;
        const emergencyCodeToClose = activeEmergency.code;
        logger.info(`Admin ${req.user.username} sta chiudendo emergenza ID=${emergencyIdToClose}, Code=${emergencyCodeToClose}`);

        const client = await pool.connect();
        try {
             await client.query('BEGIN');
             const reportStatusesToClose = ACTIVE_REPORT_STATUSES_BACKEND; 
             const closeReportsQuery = `
              UPDATE reports
              SET status = 'Closed', updated_at = NOW()
              WHERE emergency_id = $1
              AND status = ANY($2::varchar[]) -- Confronta con l'array di stati
         `;
             const closeReportsResult = await client.query(closeReportsQuery, [emergencyIdToClose, reportStatusesToClose]);
             logger.info(`[DB] Chiusura automatica per ${closeReportsResult.rowCount} segnalazioni associate all'emergenza ${emergencyIdToClose}.`);
             // Nel registro tutti escono dalle squadre: l'impiego finisce qui.
             const membriInForza = (await client.query(`
             SELECT sm.username, sm.nome, sm.cognome, s.id AS squadra_id, s.nome_radio, s.nome AS squadra_nome
             FROM squadra_membri sm JOIN squadre s ON s.id = sm.squadra_id
             ORDER BY s.nome_radio, sm.cognome
         `)).rows;
             await annotaRegistroSquadre(client, membriInForza.map(m => ({
                 squadra_id: m.squadra_id, nome_radio: m.nome_radio, squadra_nome: m.squadra_nome,
                 username: m.username, nome: m.nome, cognome: m.cognome,
                 azione: 'membro_rimosso', motivo: 'chiusura_emergenza'
             })), req, emergencyIdToClose);


             const temporaneiChiusi = await chiudiEsterniTemporanei(client, emergencyIdToClose);

             const result = await client.query(
                 "UPDATE emergencies SET status = 'CLOSED', end_time = NOW() WHERE id = $1 AND status = 'ACTIVE' RETURNING id",
                 [emergencyIdToClose]
             );

             if (result.rowCount === 0) {
                  throw new Error(`Emergenza ID ${emergencyIdToClose} non trovata o non più attiva nel DB.`);
             }

             await client.query('COMMIT');
             const closedEmergency = { ...activeEmergency };
             impostaEmergenzaAttiva(null);
             for (const id of temporaneiChiusi) await chiudiSessioni(id).catch(e => logger.error('Chiusura sessioni temporanee:', e));

             await notifiche.scadi({ categoria: 'emergenza' });
             if (temporaneiChiusi.length) logger.info(`[Esterni temporanei] Chiusi ${temporaneiChiusi.length} accessi con l'emergenza.`);
             logger.info(`EMERGENZA CHIUSA: ID=${emergencyIdToClose}, Code=${emergencyCodeToClose}`);

             res.status(200).json({ message: `Emergenza '${emergencyCodeToClose}' chiusa con successo.` });
             registraAudit(req, 'emergenza.chiusa', { tipo: 'emergenza', id: emergencyIdToClose, dettagli: { codice: emergencyCodeToClose, segnalazioni_chiuse: closeReportsResult.rowCount } });

             // Prima il resoconto, poi il backup, che così lo contiene.
             salvaResocontoEmergenza(emergencyIdToClose, req.user.username)
                 .then(async nomeFile => {
                     if (nomeFile) registraAudit(req, 'emergenza.resoconto_generato', { tipo: 'emergenza', id: emergencyIdToClose, dettagli: { file: nomeFile } });
                     // Dopo il resoconto, che deve ancora vederle.
                     await chiudiSquadreVuote(emergencyIdToClose, req).catch(e => logger.error('[Squadre] Chiusura delle squadre vuote non riuscita:', e));
                     return eseguiBackupDatabase(`emergenza-${emergencyCodeToClose}`.replace(/[^A-Za-z0-9_-]/g, '_'));
                 })
                 .then(percorso => {
                     if (percorso) registraAudit(req, 'backup.eseguito', { tipo: 'emergenza', id: emergencyIdToClose, dettagli: { motivo: 'chiusura emergenza', file: path.basename(percorso) } });
                 });


             wss.clients.forEach(wsClient => {
                  if (wsClient.readyState === 1) {
                      try { wsClient.send(JSON.stringify({ action: 'emergency_status_change', status: { active: false, emergency: null } })); } catch(e){}
                  }
             });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.info("Errore chiusura emergenza:", error);
            res.status(500).json({ message: "Errore interno chiusura emergenza." });
        } finally {
            client.release();
        }
    });

    app.get('/api/admin/emergencies/closed', checkAdminRole, async (req, res) => {
        logger.debug(`Admin ${req.user.username} richiede lista emergenze chiuse.`);
        try {
            const result = await pool.query(
                "SELECT id, code, name, start_time, end_time, log_file_path, log_generated_at FROM emergencies WHERE status = 'CLOSED' ORDER BY end_time DESC, start_time DESC"
            );
            res.status(200).json(result.rows);
        } catch (error) {
            logger.error('Errore GET /api/admin/emergencies/closed:', error);
            res.status(500).json({ message: 'Errore nel recupero delle emergenze archiviate.' });
        }
    });

    // Il resoconto di un'emergenza archiviata; se il file manca si rigenera.
    app.get('/api/admin/emergencies/:id/resoconto', checkAdminRole, async (req, res) => {
        const emergencyId = parseInt(req.params.id, 10);
        if (isNaN(emergencyId)) return res.status(400).json({ message: 'ID Emergenza non valido.' });

        try {
            const { rows } = await pool.query('SELECT code, log_file_path FROM emergencies WHERE id = $1', [emergencyId]);
            if (rows.length === 0) return res.status(404).json({ message: 'Emergenza non trovata.' });

            const codiceSicuro = String(rows[0].code).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'emergenza';
            let nomeFile = rows[0].log_file_path;

            if (nomeFile) {
                // basename: un nome manomesso non esce dalla cartella.
                const percorso = path.join(CARTELLA_RESOCONTI, path.basename(nomeFile));
                try {
                    await fs.promises.access(percorso, fs.constants.R_OK);
                    registraAudit(req, 'emergenza.resoconto_scaricato', { tipo: 'emergenza', id: emergencyId, dettagli: { file: path.basename(nomeFile) } });
                    return res.download(percorso, `resoconto_${codiceSicuro}.txt`);
                } catch {
                    logger.warn(`[Resoconto] File ${nomeFile} non trovato su disco: lo rigenero.`);
                }
            }

            const risultato = await componiResocontoEmergenza(emergencyId, req.user.username);
            if (!risultato) return res.status(404).json({ message: 'Emergenza non trovata.' });
            registraAudit(req, 'emergenza.resoconto_scaricato', { tipo: 'emergenza', id: emergencyId, dettagli: { rigenerato: true } });
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="resoconto_${codiceSicuro}.txt"`);
            return res.send(risultato.testo);
        } catch (error) {
            logger.error(`Errore GET /api/admin/emergencies/${emergencyId}/resoconto:`, error);
            return res.status(500).json({ message: 'Errore nella generazione del resoconto.' });
        }
    });

    app.delete('/api/admin/emergencies/:id', checkAdminRole, async (req, res, next) => {
        const { id } = req.params;
        const emergencyId = parseInt(id, 10);
        if (isNaN(emergencyId)) {
            return res.status(400).json({ message: 'ID Emergenza non valido.' });
        }
        logger.info(`Admin ${req.user.username} (ID: ${req.user.id}) richiede eliminazione emergenza ID: ${emergencyId}`);

        const client = await pool.connect();
        let imageFilesToDelete = [];
        let documentFilesToDelete = [];

        try {
            await client.query('BEGIN');


            const emergencyCheck = await client.query(
                "SELECT code, status, log_file_path FROM emergencies WHERE id = $1 FOR UPDATE",
                [emergencyId]
            );
            if (emergencyCheck.rowCount === 0) {
                throw new Error('Emergenza non trovata.');
            }
            if (emergencyCheck.rows[0].status !== 'CLOSED') {
                throw new Error('Eliminazione permessa solo per emergenze con stato CLOSED.');
            }
            const emergencyCode = emergencyCheck.rows[0].code;
            const resocontoDaEliminare = emergencyCheck.rows[0].log_file_path;

            // I file si cancellano dopo il COMMIT: prima se ne raccolgono i percorsi.
            logger.debug(`[Delete EMG ${emergencyId}] Recupero URL immagini associate...`);
            const reportImageQuery = `SELECT image_url FROM report_images WHERE report_id IN (SELECT id FROM reports WHERE emergency_id = $1)`;

            const reportImageResult = await client.query(reportImageQuery, [emergencyId]);

            imageFilesToDelete = reportImageResult.rows.map(r => r.image_url);
            logger.debug(`[Delete EMG ${emergencyId}] Trovati ${imageFilesToDelete.length} URL immagine da eliminare dal filesystem.`);


            const documentQuery = `SELECT file_path FROM emergency_documents WHERE emergency_id = $1`;
            const documentResult = await client.query(documentQuery, [emergencyId]);
            documentFilesToDelete = documentResult.rows.map(r => r.file_path);
            logger.debug(`[Delete EMG ${emergencyId}] Trovati ${documentFilesToDelete.length} documenti da eliminare dal filesystem.`);


            logger.debug(`[Delete EMG ${emergencyId}] Eseguo DELETE su emergencies...`);
            const deleteResult = await client.query('DELETE FROM emergencies WHERE id = $1', [emergencyId]);

            if (deleteResult.rowCount === 0) {
                 throw new Error('Errore imprevisto durante eliminazione emergenza.');
            }
            logger.info(`[DB] Record emergenza ${emergencyId} eliminato (cascade atteso per i report collegati).`);


            await client.query('COMMIT');
            logger.debug(`[DB] Commit eseguito per eliminazione emergenza ${emergencyId}.`);


            logger.debug(`[FS Cleanup] Inizio eliminazione di ${imageFilesToDelete.length} file immagine...`);
            let filesDeletedCount = 0;
            for (const relativeUrl of imageFilesToDelete) {
                if (!relativeUrl || typeof relativeUrl !== 'string' || !relativeUrl.startsWith('/uploads/')) {
                    logger.warn(`[FS Cleanup] Skipping invalid or unexpected URL format: ${relativeUrl}`);
                    continue;
                }
                const filePath = path.join(__dirname, '..', 'protected_uploads', relativeUrl.replace('/uploads/', 'images/'));
                try {
                    await fs.promises.access(filePath); 
                    await fs.promises.unlink(filePath);
                    logger.debug(`[FS Cleanup] File eliminato: ${filePath}`);
                    filesDeletedCount++;
                } catch (fileError) {
                     if (fileError.code === 'ENOENT') {
                         logger.warn(`[FS Cleanup] File non trovato (forse già eliminato?): ${filePath}`);
                     } else {
                         logger.error(`[FS Cleanup] Errore eliminazione file ${filePath}:`, fileError);
                     }
                }
            }
            logger.debug(`[FS Cleanup] Eliminazione file completata (${filesDeletedCount}/${imageFilesToDelete.length}).`);

            // basename: un percorso manomesso non esce dalla cartella.
            let documentiEliminati = 0;
            for (const percorsoRelativo of documentFilesToDelete) {
                if (!percorsoRelativo || typeof percorsoRelativo !== 'string') continue;
                const filePath = path.join(protectedDocsDir, path.basename(percorsoRelativo));
                try {
                    await fs.promises.unlink(filePath);
                    logger.debug(`[FS Cleanup] Documento eliminato: ${filePath}`);
                    documentiEliminati++;
                } catch (fileError) {
                    if (fileError.code === 'ENOENT') {
                        logger.warn(`[FS Cleanup] Documento non trovato (forse già eliminato?): ${filePath}`);
                    } else {
                        logger.error(`[FS Cleanup] Errore eliminazione documento ${filePath}:`, fileError);
                    }
                }
            }
            logger.debug(`[FS Cleanup] Documenti eliminati (${documentiEliminati}/${documentFilesToDelete.length}).`);


            if (resocontoDaEliminare) {
                try {
                    await fs.promises.unlink(path.join(CARTELLA_RESOCONTI, path.basename(resocontoDaEliminare)));
                    logger.debug(`[FS Cleanup] Resoconto eliminato: ${resocontoDaEliminare}`);
                } catch (errResoconto) {
                    if (errResoconto.code !== 'ENOENT') logger.error(`[FS Cleanup] Errore eliminazione resoconto ${resocontoDaEliminare}:`, errResoconto);
                }
            }


            res.status(200).json({ message: `Emergenza '${emergencyCode}' (ID: ${emergencyId}) e tutti i dati associati sono stati eliminati con successo.` });
            registraAudit(req, 'emergenza.eliminata', { tipo: 'emergenza', id: emergencyId, dettagli: { codice: emergencyCode, immagini_rimosse: filesDeletedCount, documenti_rimossi: documentiEliminati } });
            logger.debug(`[HTTP Res] Inviato 200 OK per eliminazione emergenza ${emergencyId}.`);


            logger.debug(`[WS Send] Notifica eliminazione emergenza ${emergencyId}.`);
            wss.clients.forEach(wsClient => {
                if (wsClient.readyState === 1) { 
                    try {
                        wsClient.send(JSON.stringify({
                            action: 'emergency_deleted',
                            deletedEmergencyId: emergencyId
                        }));
                    } catch (e) { logger.error("WS Send Error DELETE Emergency:", e); }
                }
            });

        } catch (err) {
            await client.query('ROLLBACK');
            logger.error(`Errore DELETE /api/admin/emergencies/${emergencyId}:`, err);

             if (err.message.includes('non trovata')) {
                 res.status(404).json({ message: err.message });
             } else if (err.message.includes('permessa solo per emergenze con stato CLOSED')) {
                  res.status(403).json({ message: err.message });
             }
             else {
                 res.status(500).json({ message: err.message || 'Errore interno durante l\'eliminazione dell\'emergenza.' });
             }
        } finally {
            client.release();
            logger.debug(`[DB] Client rilasciato per DELETE /api/admin/emergencies/${emergencyId}.`);
        }
    });




    app.get('/api/emergencies/:id/documents', authenticateToken, async (req, res) => {
        const emergencyId = parseInt(req.params.id, 10);
        if (isNaN(emergencyId)) {
            return res.status(400).json({ message: 'ID Emergenza non valido.' });
        }
        if (!puoVedereEmergenza(req, emergencyId)) {
            return res.status(403).json({ message: "I documenti di un'emergenza chiusa sono riservati all'amministratore." });
        }

        try {
            const query = `
            SELECT 
                d.id, 
                d.original_filename, 
                d.file_path, 
                d.file_mime_type,
                d.uploaded_at, 
                CONCAT(u.nome, ' ', u.cognome) as uploader_fullname
            FROM emergency_documents d
            JOIN users u ON d.uploader_user_id = u.id
            WHERE d.emergency_id = $1
            ORDER BY d.uploaded_at DESC;
        `;
            const result = await pool.query(query, [emergencyId]);
            res.status(200).json(result.rows);
        } catch (error) {
            logger.error(`Errore GET /api/emergencies/${emergencyId}/documents:`, error);
            res.status(500).json({ message: 'Errore nel recupero dei documenti.' });
        }
    });

    // La colonna degli eventi del centro operativo: segnalazioni aperte, voci
    // dei diari, documenti e note di sala, in ordine di tempo.
    app.get('/api/emergencies/:id/eventi', authenticateToken, async (req, res) => {
        const emergencyId = parseInt(req.params.id, 10);
        if (isNaN(emergencyId)) return res.status(400).json({ message: 'ID Emergenza non valido.' });
        if (!puoVedereEmergenza(req, emergencyId)) return res.status(403).json({ message: 'Accesso Negato' });
        const quanti = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);

        try {
            const query = `
            (
                SELECT r.created_at AS quando, 'segnalazione_aperta' AS tipo,
                       CONCAT(u.nome, ' ', u.cognome) AS chi,
                       r.title AS testo, r.id AS report_id, r.emergency_report_number AS numero,
                       r.priority AS priorita
                FROM reports r LEFT JOIN users u ON r.creator_user_id = u.id
                WHERE r.emergency_id = $1
            )
            UNION ALL
            (
                SELECT ru.update_timestamp AS quando,
                       CASE WHEN ru.is_system THEN 'evento_sistema' ELSE 'nota' END AS tipo,
                       CONCAT(u.nome, ' ', u.cognome) AS chi,
                       ru.update_text AS testo, r.id AS report_id, r.emergency_report_number AS numero,
                       r.priority AS priorita
                FROM report_updates ru
                JOIN reports r ON ru.report_id = r.id
                LEFT JOIN users u ON ru.user_id = u.id
                WHERE r.emergency_id = $1
            )
            UNION ALL
            (
                SELECT d.uploaded_at AS quando, 'documento' AS tipo,
                       CONCAT(u.nome, ' ', u.cognome) AS chi,
                       d.original_filename AS testo, NULL::integer AS report_id, NULL::integer AS numero,
                       NULL::varchar AS priorita
                FROM emergency_documents d LEFT JOIN users u ON d.uploader_user_id = u.id
                WHERE d.emergency_id = $1
            )
            UNION ALL
            (
                SELECT s.creata_il AS quando, 'sala' AS tipo, s.autore_nome AS chi,
                       s.testo, NULL::integer AS report_id, NULL::integer AS numero,
                       NULL::varchar AS priorita
                FROM diario_sala s
                WHERE s.emergency_id = $1
            )
            ORDER BY quando DESC
            LIMIT $2
        `;
            const risultato = await pool.query(query, [emergencyId, quanti]);
            res.status(200).json(risultato.rows);
        } catch (error) {
            logger.error(`Errore GET /api/emergencies/${emergencyId}/eventi:`, error);
            res.status(500).json({ message: 'Errore nel recupero degli eventi.' });
        }
    });


    app.post('/api/emergencies/documents', authenticateToken, nonEsterni, uploadLimiter, uploadDocumentMulter.single('emergencyDocument'), async (req, res) => {
        if (!activeEmergency) {
            return res.status(403).json({ message: 'Operazione non permessa: nessuna emergenza attiva.' });
        }
        if (req.fileValidationError) {
            return res.status(400).json({ message: req.fileValidationError });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'Nessun file valido caricato.' });
        }
        if (!(await verifyDocumentUpload(req, res))) return;

        const uploader_user_id = req.user.id;
        const emergency_id = activeEmergency.id;
        
        const { originalname, mimetype, filename } = req.file;
        const file_path = `/uploads/documents/${filename}`;

        try {
            const query = `
            INSERT INTO emergency_documents 
            (emergency_id, uploader_user_id, file_path, original_filename, file_mime_type)
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING id, uploaded_at;
        `;
            const result = await pool.query(query, [emergency_id, uploader_user_id, file_path, originalname, mimetype || null]);
            
            const newDocument = {
                id: result.rows[0].id,
                emergency_id,
                uploader_user_id,
                file_path,
                original_filename: originalname,
                file_mime_type: mimetype,
                description: null,
                uploaded_at: result.rows[0].uploaded_at,

                uploader_fullname: nomeUtente(req.user)
            };

            res.status(201).json({ message: 'Documento caricato con successo.', document: newDocument });


            wss.clients.forEach(client => {
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ 
                        action: 'new_emergency_document', 
                        document: newDocument 
                    }));
                }
            });

        } catch (error) {
            logger.error('Errore POST /api/emergencies/documents:', error);

            fs.unlink(req.file.path, (err) => {
                if (err) logger.error("Errore durante la pulizia del file dopo un fallimento DB:", err);
            });
            res.status(500).json({ message: 'Errore interno durante il salvataggio del documento.' });
        }
    });


    app.delete('/api/documents/:id', authenticateToken, checkAdminRole, async (req, res) => {
        const documentId = parseInt(req.params.id, 10);
        if (isNaN(documentId)) {
            return res.status(400).json({ message: 'ID Documento non valido.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');


            const docResult = await client.query('SELECT file_path, emergency_id FROM emergency_documents WHERE id = $1 FOR UPDATE', [documentId]);
            if (docResult.rowCount === 0) {
                throw new Error('Documento non trovato.');
            }
            const { file_path, emergency_id } = docResult.rows[0];


            await client.query('DELETE FROM emergency_documents WHERE id = $1', [documentId]);
            
            await client.query('COMMIT');


            const fullPath = path.join(__dirname, '..', 'protected_uploads', file_path.replace('/uploads/', ''));
            fs.unlink(fullPath, (err) => {
                if (err) {

                    logger.error(`Errore eliminazione file fisico ${fullPath}:`, err);
                } else {
                    logger.debug(`File fisico eliminato: ${fullPath}`);
                }
            });

            res.status(200).json({ message: 'Documento eliminato con successo.' });
            registraAudit(req, 'documento.eliminato', { tipo: 'documento', id: documentId, dettagli: { emergenza_id: emergency_id } });


            wss.clients.forEach(client => {
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ 
                        action: 'deleted_emergency_document', 
                        documentId: documentId,
                        emergencyId: emergency_id 
                    }));
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error(`Errore DELETE /api/documents/${documentId}:`, error);
            res.status(error.message === 'Documento non trovato.' ? 404 : 500)
               .json({ message: error.message || 'Errore durante l\'eliminazione del documento.' });
        } finally {
            client.release();
        }
    });
}
