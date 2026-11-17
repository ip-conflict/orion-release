import fs from 'fs';
import logger from './logger.js';
import multer from 'multer';
import path from 'path';
import { authenticateToken, haRuolo, nomeUtente, puoVedereEmergenza, ruoliDi } from './autenticazione.js';
import { haPermesso } from './permessi.js';
import { uploadImageMulter, verifyMultipleUploadedImages } from './caricamenti.js';
import { ACTIVE_REPORT_STATUSES_BACKEND, ETICHETTA_PRIORITA, ETICHETTA_STATO, ETICHETTA_STATO_SQUADRA, MOTIVI_SENZA_SQUADRA, STATI_SQUADRA, TIPI_SEGNALAZIONE, TERMINAL_REPORT_STATUSES_BACKEND, VALID_REPORT_STATUSES, erroreConflitto, erroreNonTrovato, erroreRichiesta } from './costanti.js';
import { pool } from './db.js';
import { reportCreationLimiter, uploadLimiter } from './middleware/rateLimiters.js';
import { avvisaSquadra } from './squadre.js';
import { activeEmergency, prossimoNumeroSegnalazione } from './statoEmergenza.js';
import { avvisaClienti, notifiche, wss } from './tempoReale.js';
import { inviaFile, proteggiCaricati } from './cifratura.js';
import { aggiornaRischi } from './rischiZone.js';
import { controllaZoneSquadra } from './zoneSquadre.js';
import { avvisaSala } from './avvisiSala.js';
import { RADICE_DATI } from './percorsi.js';


// Il centro operativo segna ferma una posizione dopo cinque minuti.
export const MINUTI_SUBENTRO = 3;

export function registraRotteSegnalazioni(app) {

    // Un esterno legge tutta l'emergenza ma scrive solo sulle segnalazioni della sua
    // squadra o di una sua funzione con un incarico aperto.
    async function esternoFuoriDallaSuaSquadra(req, reportId) {
        if (!ruoliDi(req.user).includes('esterno')) return false;
        const inSala = await pool.query(
            'SELECT 1 FROM squadra_membri sm JOIN squadre s ON s.id = sm.squadra_id WHERE s.coc AND sm.username = $1', [req.user.username]);
        if (inSala.rowCount) return false;
        const suo = await pool.query(
            `SELECT 1 FROM report_team_assignments rta
             JOIN squadra_membri sm ON sm.squadra_id = rta.squadra_id
             WHERE rta.report_id = $1 AND sm.username = $2
             UNION ALL
             SELECT 1 FROM incarichi i JOIN funzione_membri fm ON fm.funzione_id = i.funzione_id
                                       JOIN funzioni f ON f.id = i.funzione_id AND f.attiva
             WHERE i.report_id = $1 AND fm.user_id = $3 AND i.stato <> 'concluso'
               AND EXISTS (SELECT 1 FROM branding_settings b WHERE b.setting_key = 'funzioni_enabled' AND b.setting_value = 'true')`,
            [reportId, req.user.username, req.user.id]);
        return suo.rowCount === 0;
    }

    app.get('/uploads/:filename', async (req, res) => {
        const imagesDir = path.resolve(RADICE_DATI, 'protected_uploads', 'images');
        const safePath = path.resolve(imagesDir, req.params.filename);
        // Con il separatore finale: una cartella "images_old" non passa.
        if (!safePath.startsWith(imagesDir + path.sep)) {
            return res.status(403).json({ message: 'Accesso negato' });
        }
        if (!fs.existsSync(safePath)) return res.status(404).json({ message: 'File non trovato' });
        try {
            const r = await pool.query(
                `SELECT r.emergency_id FROM report_images ri JOIN reports r ON r.id = ri.report_id
             WHERE ri.image_url = $1 LIMIT 1`, [`/uploads/${req.params.filename}`]);
            if (r.rowCount === 0 ? !haPermesso(req, 'emergenze.archivio') : !puoVedereEmergenza(req, r.rows[0].emergency_id)) {
                return res.status(403).json({ message: 'Accesso negato' });
            }
        } catch (error) {
            logger.error('Errore controllo accesso immagine:', error);
            return res.status(500).json({ message: 'Errore interno.' });
        }
        inviaFile(res, safePath);
    });


    app.post('/api/reports', reportCreationLimiter, authenticateToken, async (req, res) => {
        if (!activeEmergency) {
            return res.status(403).json({ message: 'Operazione non permessa: nessuna emergenza attiva.' });
        }
        if (req.user.role === 'esterno') {
            logger.warn(`[API POST /api/reports] Tentativo creazione report da utente ESTERNO bloccato: ${req.user.username}`);
            return res.status(403).json({ message: 'Gli utenti Esterni non sono autorizzati a creare nuove segnalazioni.' });
        }
        const currentEmergencyId = activeEmergency.id;
        const {
            title, description, location_address, priority, reporter_name, reporter_contact,
            latitude, 
            longitude 
        } = req.body;
        const tipo = req.body.tipo == null || req.body.tipo === '' ? 'altro' : String(req.body.tipo);
        if (!Object.hasOwn(TIPI_SEGNALAZIONE, tipo)) return res.status(400).json({ message: `Il tipo è uno fra: ${Object.keys(TIPI_SEGNALAZIONE).join(', ')}.` });
        const creator_user_id = req.user.id;
        // Una chiamata girata dal 112 non ha sempre un nome o un numero, e non si inventano.
        if (!title || String(title).trim() === '') {
            return res.status(400).json({ message: 'Scrivi almeno cosa succede (il titolo).' });
        }
        let reportLatitude = null;
        let reportLongitude = null;
        let coordinatesProvided = false;
        if (latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null && String(latitude).trim() !== '' && String(longitude).trim() !== '') {
             reportLatitude = parseFloat(latitude);
             reportLongitude = parseFloat(longitude);
             if (isNaN(reportLatitude) || isNaN(reportLongitude)) {
                  reportLatitude = null;
                  reportLongitude = null;
                  coordinatesProvided = false;
             } else {
                  coordinatesProvided = true;
             }
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const emergencyReportNumber = await prossimoNumeroSegnalazione(client, currentEmergencyId);
            logger.debug(`[POST /api/reports] Prossimo numero progressivo per emergenza ${currentEmergencyId}: ${emergencyReportNumber}`);
            const reportInsertQuery = `
            INSERT INTO reports (title, description, location_address, priority, creator_user_id, reporter_name, reporter_contact, status, emergency_id, emergency_report_number, latitude, longitude, tipo, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()) RETURNING *;
        `;
            const reportValues = [title, description || null, location_address || null, priority || 'Medium', creator_user_id, String(reporter_name ?? '').trim() || null, String(reporter_contact ?? '').trim() || null, 'New', currentEmergencyId, emergencyReportNumber, reportLatitude, reportLongitude, tipo];
            const reportResult = await client.query(reportInsertQuery, reportValues);
            const newReport = reportResult.rows[0];
            const newReportId = newReport.id;
            logger.debug(`Report ${newReportId} (Prog: ${emergencyReportNumber}) creato da user ${creator_user_id}.`);

            await client.query('COMMIT');
            wss.clients.forEach(wsClient => {
                 if (wsClient.readyState === 1) {
                     try {
                         wsClient.send(JSON.stringify({ action: 'reload_reports', createdReportId: newReportId, daUtente: req.user.id }));

                     } catch (e) { logger.error("WS Send Error:", e); }
                 }
            });
            res.status(201).json(newReport);
            if (coordinatesProvided) aggiornaRischi({ emergencyId: currentEmergencyId, reportIds: [newReportId], userId: creator_user_id });
            if (newReport.priority === 'High') {
                avvisaSala({ titolo: `Nuova segnalazione ad alta priorità: #${emergencyReportNumber}`, testo: [title, location_address].filter(Boolean).join(' · '),
                    chiave: `alta:${newReportId}`, riferimento: { tipo: 'segnalazione', id: newReportId }, escludi: creator_user_id });
            }
        } catch (err) {
            await client.query('ROLLBACK');
            logger.error('Error creating report:', err);
            res.status(500).json({ message: 'Internal server error while creating report.' });
        } finally {
            client.release();
        }
    });

    app.get('/api/reports', authenticateToken, async (req, res) => {
        const page = parseInt(req.query.page, 10) || 1;
        const requestedLimit = parseInt(req.query.limit, 10);
        const limit = !isNaN(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 1000) : 25;
        const offset = (page - 1) * limit;
        const ALLOWED_STATUS_TYPES = ['active', 'closed', 'all'];
        const statusType = ALLOWED_STATUS_TYPES.includes(req.query.status_type) 
            ? req.query.status_type 
            : 'active';
        const requestedEmergencyId = req.query.emergency_id ? parseInt(req.query.emergency_id, 10) : null;
        if (requestedEmergencyId &&
            (!activeEmergency || requestedEmergencyId !== activeEmergency.id)) {
            if (!haPermesso(req, 'emergenze.archivio')) {
                return res.status(403).json({
                    message: 'Accesso Negato'
                });
            }
        }

        let filterEmergencyId = requestedEmergencyId ?? (activeEmergency ? activeEmergency.id : null);
        const logPrefix = `[GET /api/reports P:${page} L:${limit} E:${filterEmergencyId ?? 'N/A'} S:${statusType}]`;
        let mainWhereClause = "";
        const queryParams = [];
        if (filterEmergencyId !== null) {
            queryParams.push(filterEmergencyId);
            mainWhereClause = ` WHERE r.emergency_id = $${queryParams.length}`;
        } else {
            return res.status(200).json({ reports: [], pagination: { currentPage: 1, totalPages: 0, totalReports: 0, limit: limit } });
        }
        if (statusType === 'closed') {
            queryParams.push(TERMINAL_REPORT_STATUSES_BACKEND);
            mainWhereClause += ` AND r.status = ANY($${queryParams.length}::varchar[])`;
        } else if (statusType === 'active') {
            queryParams.push(ACTIVE_REPORT_STATUSES_BACKEND);
            mainWhereClause += ` AND r.status = ANY($${queryParams.length}::varchar[])`;
        }
        const assignedTeamIdFilter = req.query.assigned_team_id ? parseInt(req.query.assigned_team_id, 10) : null;
        if (assignedTeamIdFilter && !isNaN(assignedTeamIdFilter)) {
            queryParams.push(assignedTeamIdFilter);
            mainWhereClause += ` AND EXISTS (SELECT 1 FROM report_team_assignments rta_filter WHERE rta_filter.report_id = r.id AND rta_filter.squadra_id = $${queryParams.length})`;
        }
        const clausolaOrdinamento = statusType === 'closed'
            ? 'r.updated_at DESC NULLS LAST, r.created_at DESC'
            : `CASE r.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END ASC, r.created_at ASC`;

        try {
            let totalReports = 0;
            let totalPages = 0;
            let reportsData = [];
            const countQueryParams = [...queryParams];
            const countQuery = `SELECT COUNT(*) FROM reports r ${mainWhereClause}`;
            const countResult = await pool.query(countQuery, countQueryParams);
            totalReports = parseInt(countResult.rows[0].count, 10);
            totalPages = Math.ceil(totalReports / limit);
            if (totalReports > 0 && page <= totalPages) {
                const limitParamIndex = queryParams.length + 1;
                const offsetParamIndex = queryParams.length + 2;
                const finalQueryParamsForSelect = [...queryParams, limit, offset];

                const sqlQuery = `
                SELECT
                    r.id, e.code AS emergency_code, r.emergency_report_number, -- <<< Seleziona il campo memorizzato
                    r.title, r.status, r.priority, r.location_address,
                    r.created_at, r.updated_at, r.creator_user_id, r.emergency_id, r.reporter_name, r.reporter_contact,
                    r.latitude, r.longitude, r.description, r.environmental_hazard,
                    r.no_team_reason, r.tipo,
                    CONCAT(u.nome, ' ', u.cognome) AS creator_fullname,
                    COALESCE(rt.assigned_teams, '[]'::json) AS assigned_teams,
                    -- Le funzioni con un incarico, per le etichette sulla scheda.
                    COALESCE((SELECT json_agg(json_build_object('sigla', f.sigla, 'stato', i.stato, 'funzione_id', f.id) ORDER BY f.ordine, f.sigla)
                                FROM incarichi i JOIN funzioni f ON f.id = i.funzione_id WHERE i.report_id = r.id), '[]'::json) AS incarichi,
                    COALESCE(ri.image_count, 0)::integer AS image_count,
                    -- L'ultima notizia scritta da una persona: sulla scheda dice
                    -- a che punto è l'intervento senza doverla aprire.
                    (SELECT json_build_object('testo', ru.update_text, 'quando', ru.update_timestamp, 'autore', TRIM(CONCAT(uu.nome, ' ', uu.cognome)))
                       FROM report_updates ru LEFT JOIN users uu ON uu.id = ru.user_id
                      WHERE ru.report_id = r.id AND NOT COALESCE(ru.is_system, false)
                      ORDER BY ru.update_timestamp DESC, ru.id DESC LIMIT 1) AS ultima_nota
                FROM reports r
                LEFT JOIN emergencies e ON r.emergency_id = e.id
                LEFT JOIN users u ON r.creator_user_id = u.id
                LEFT JOIN (
                     SELECT rta.report_id,
                            json_agg(json_build_object('id', rta.squadra_id,
                                                       'nome_radio', COALESCE(s.nome_radio, rta.nome_radio),
                                                       'nome', COALESCE(s.nome, rta.squadra_nome, rta.nome_radio),
                                                       'stato', rta.stato, 'stato_il', rta.stato_il,
                                                       'qualifica', COALESCE(s.qualifica, rta.qualifica))
                                     ORDER BY COALESCE(s.nome, rta.squadra_nome, rta.nome_radio)) AS assigned_teams
                     -- Anche le squadre sciolte dopo l'intervento, con il nome di allora.
                     FROM report_team_assignments rta LEFT JOIN squadre s ON rta.squadra_id = s.id
                     GROUP BY rta.report_id
                ) rt ON r.id = rt.report_id
                LEFT JOIN (
                     SELECT ri.report_id, COUNT(*) AS image_count
                     FROM report_images ri
                     GROUP BY ri.report_id
                ) ri ON r.id = ri.report_id
                ${mainWhereClause}
                ORDER BY ${clausolaOrdinamento}
                LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex};
            `;
                const result = await pool.query(sqlQuery, finalQueryParamsForSelect);
                reportsData = result.rows;
            }
            res.status(200).json({
                reports: reportsData,
                pagination: { currentPage: page, totalPages: totalPages, totalReports: totalReports, limit: limit }
            });
        } catch (err) {
            logger.error(logPrefix, 'Errore:', err);
            if (!res.headersSent) {
                res.status(500).json({ message: 'Errore nel recupero dei report.' });
            }
        }
    });

    // Due telefonate per lo stesso albero: prima di creare, la sala vede le aperte entro 100 metri.
    // Emisenoverso in SQL: a queste distanze basta, senza estensioni del database.
    app.get('/api/reports/vicine', async (req, res) => {
        if (ruoliDi(req.user).includes('esterno')) return res.status(403).json({ message: 'Gli utenti Esterni non creano segnalazioni.' });
        const lat = Number(req.query.lat), lon = Number(req.query.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            return res.status(400).json({ message: 'Servono latitudine e longitudine.' });
        }
        if (!activeEmergency) return res.json([]);
        try {
            const { rows } = await pool.query(
                `SELECT * FROM (
                    SELECT r.id, r.emergency_report_number AS numero, r.title, r.created_at, r.location_address,
                           2 * 6371000 * asin(sqrt(power(sin(radians(r.latitude - $1) / 2), 2)
                               + cos(radians($1)) * cos(radians(r.latitude)) * power(sin(radians(r.longitude - $2) / 2), 2))) AS metri
                      FROM reports r
                     WHERE r.emergency_id = $3 AND r.status = ANY($4::varchar[])
                       AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
                 ) v WHERE v.metri <= 100 ORDER BY v.metri LIMIT 5`,
                [lat, lon, activeEmergency.id, ACTIVE_REPORT_STATUSES_BACKEND]);
            res.json(rows.map(r => ({ ...r, metri: Math.round(Number(r.metri)) })));
        } catch (e) {
            logger.error('Errore GET /api/reports/vicine:', e);
            res.status(500).json({ message: 'Errore nel cercare le segnalazioni vicine.' });
        }
    });

    app.get('/api/reports/:id', authenticateToken, async (req, res) => {
        const { id } = req.params;
        const reportId = parseInt(id, 10);
        if (isNaN(reportId)) { return res.status(400).json({ message: 'ID Report non valido.' }); }
        const client = await pool.connect();
        try {
            const reportDetailQuery = `
            SELECT
                r.*,
                e.code as emergency_code,
                e.name as emergency_name,
                CONCAT(u.nome, ' ', u.cognome) AS creator_fullname,
                COALESCE(json_agg(DISTINCT jsonb_build_object('id', rta.squadra_id,
                                                              'nome', COALESCE(s.nome, rta.squadra_nome, rta.nome_radio),
                                                              'nome_radio', COALESCE(s.nome_radio, rta.nome_radio),
                                                              'stato', rta.stato, 'stato_il', rta.stato_il,
                                                              'qualifica', COALESCE(s.qualifica, rta.qualifica)))
                         FILTER (WHERE rta.assignment_id IS NOT NULL), '[]'::json) AS assigned_teams,
                COALESCE((SELECT json_agg(json_build_object('sigla', f.sigla, 'stato', i.stato, 'funzione_id', f.id) ORDER BY f.ordine, f.sigla)
                            FROM incarichi i JOIN funzioni f ON f.id = i.funzione_id WHERE i.report_id = r.id), '[]'::json) AS incarichi,
                COALESCE(json_agg(DISTINCT ri.image_url) FILTER (WHERE ri.image_id IS NOT NULL), '[]'::json) AS image_urls,
                (SELECT json_build_object('testo', ru.update_text, 'quando', ru.update_timestamp, 'autore', TRIM(CONCAT(uu.nome, ' ', uu.cognome)))
                       FROM report_updates ru LEFT JOIN users uu ON uu.id = ru.user_id
                      WHERE ru.report_id = r.id AND NOT COALESCE(ru.is_system, false)
                      ORDER BY ru.update_timestamp DESC, ru.id DESC LIMIT 1) AS ultima_nota
            FROM
                reports r
            LEFT JOIN emergencies e ON r.emergency_id = e.id
            LEFT JOIN users u ON r.creator_user_id = u.id
            LEFT JOIN report_team_assignments rta ON r.id = rta.report_id
            LEFT JOIN squadre s ON rta.squadra_id = s.id
            LEFT JOIN report_images ri ON r.id = ri.report_id
            WHERE r.id = $1
            GROUP BY r.id, e.id, u.id; -- Rimosso rr.rn dal group by
        `;
            const reportResult = await client.query(reportDetailQuery, [reportId]);
            if (reportResult.rowCount === 0) {
                return res.status(404).json({ message: 'Report not found.' });
            }
            if (!puoVedereEmergenza(req, reportResult.rows[0].emergency_id)) {
                return res.status(403).json({ message: "Le segnalazioni di un'emergenza chiusa sono riservate all'amministratore." });
            }
            const reportDetails = reportResult.rows[0];

            if (!haPermesso(req, 'emergenze.archivio')) {
                if (!activeEmergency || reportDetails.emergency_id !== activeEmergency.id) {
                    logger.warn(`[IDOR Attempt] User ${req.user.username} (role: ${req.user.role}) tried to access report ${reportId} from inactive/closed emergency ${reportDetails.emergency_id}.`);
                    // 404: non si rivela che esiste.
                    return res.status(404).json({ message: 'Report not found.' }); 
                }
            }
            
            const reportUpdatesQuery = `
            SELECT
                ru.id,
                ru.update_timestamp,
                ru.update_text,
                ru.is_system,
                ru.user_id,
                ru.voce_id,
                vm.trascrizione AS voce_trascrizione,
                CONCAT(upd_u.nome, ' ', upd_u.cognome) AS updater_fullname,
                f.sigla AS funzione_sigla
            FROM
                report_updates ru
            LEFT JOIN
                users upd_u ON ru.user_id = upd_u.id
            LEFT JOIN voce_messaggi vm ON vm.id = ru.voce_id
            LEFT JOIN funzioni f ON f.id = ru.funzione_id
            WHERE
                ru.report_id = $1
            ORDER BY
                ru.update_timestamp ASC;
        `;
            const updatesResult = await client.query(reportUpdatesQuery, [reportId]);
            const reportUpdates = updatesResult.rows;
            const responsePayload = {
                report: reportDetails,
                updates: reportUpdates
            };
            res.status(200).json(responsePayload);
        } catch (err) {
            logger.error(`Errore GET /api/reports/${reportId}:`, err);
            res.status(500).json({ message: 'Errore recupero dettagli report.' });
        } finally {
            client.release();
        }
    });

    app.put('/api/reports/:id', async (req, res) => {
        const { id } = req.params;
        const reportId = parseInt(id, 10);
        if (isNaN(reportId)) return res.status(400).json({ message: 'ID Report non valido.' });
        if (req.user.role === 'esterno') {
            return res.status(403).json({ message: 'Permesso negato per modificare le segnalazioni.' });
        }
        const userId = req.user.id;
        logger.debug(`[PUT /api/reports/${reportId}] User ${req.user.username} (ID: ${userId}) attempting update.`);
        const receivedUpdates = req.body;

        const ALLOWED_UPDATE_FIELDS = new Set([
            'title', 'description', 'location_address', 'status', 'priority', 
            'reporter_name', 'reporter_contact', 'environmental_hazard', 'latitude', 'longitude',
            'no_team_reason', 'tipo'
        ]);
        
        const allowedReportFields = ['title','description','location_address','status','priority','reporter_name', 'reporter_contact','environmental_hazard', 'latitude', 'longitude', 'no_team_reason', 'tipo'];
        if ('tipo' in receivedUpdates && !Object.hasOwn(TIPI_SEGNALAZIONE, String(receivedUpdates.tipo))) {
            return res.status(400).json({ message: `Il tipo è uno fra: ${Object.keys(TIPI_SEGNALAZIONE).join(', ')}.` });
        }

        const client = await pool.connect();
        let statusChangedAffectingTeams = false;
        try {
            await client.query('BEGIN');
            const currentReportResult = await client.query('SELECT * FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
            if (currentReportResult.rowCount === 0) throw erroreNonTrovato();
            const currentReport = currentReportResult.rows[0];
            const oldStatus = currentReport.status;
            if (!activeEmergency || currentReport.emergency_id !== activeEmergency.id) {

                await client.query('ROLLBACK');
                logger.warn(`Tentativo modifica report ${reportId} fuori emergenza attiva.`);
                return res.status(403).json({ message: 'Operazione permessa solo per report dell\'emergenza attiva.' });
            }
            // Cambio rimandato dopo un buco di rete: se qualcun altro l'ha cambiato nel frattempo,
            // non si scrive sopra alla cieca.
            const statoAtteso = receivedUpdates.stato_atteso;
            if (statoAtteso !== undefined && receivedUpdates.status !== undefined
                && receivedUpdates.status !== oldStatus && statoAtteso !== oldStatus) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    conflitto: true,
                    stato_attuale: oldStatus,
                    message: `Nel frattempo la segnalazione è passata a "${oldStatus}": il cambio a "${receivedUpdates.status}" non è stato fatto. Guardala e decidi di nuovo.`
                });
            }

            let lastNewUpdate = null;
            let priorityRaisedToHigh = false;
            const reportUpdatesToApply = {};
            const logEntries = [];
            let hasReportUpdates = false;
            let newStatus = oldStatus;
            const fieldNamesMap = {
            title: 'Titolo',
            description: 'Descrizione',
            location_address: 'Indirizzo/Luogo',
            status: 'Stato',
            priority: 'Priorità',
            reporter_name: 'Nome Segnalante', 
            reporter_contact: 'Contatto Segnalante', 
            environmental_hazard: 'Pericoli Ambientali',
            latitude: 'Latitudine', 
            longitude: 'Longitudine',
            no_team_reason: 'Squadra non necessaria'
            };
            for (const key of allowedReportFields) {
                const hasProperty = receivedUpdates.hasOwnProperty(key);
                const receivedValue = receivedUpdates[key];
                const currentValue = currentReport[key];
                let valuesDiffer = false;
                let parsedReceivedValue = receivedValue;
                if (key === 'latitude' || key === 'longitude') {
                    let currentFloat = null;
                    let receivedFloat = null;
                    if (currentValue !== null && currentValue !== undefined) {
                       const parsedCurrent = parseFloat(currentValue);
                       if (!isNaN(parsedCurrent)) currentFloat = parsedCurrent;
                    }
                    if (receivedValue !== null && receivedValue !== undefined && String(receivedValue).trim() !== '') {
                        const parsedReceived = parseFloat(receivedValue);
                        if (!isNaN(parsedReceived)) {
                           receivedFloat = parsedReceived;
                           parsedReceivedValue = receivedFloat; 
                        } else {
                           receivedFloat = null;
                           parsedReceivedValue = null;
                        }
                    } else if (receivedValue === null || String(receivedValue).trim() === '') {
                       receivedFloat = null;
                       parsedReceivedValue = null;
                    }
                    valuesDiffer = currentFloat !== receivedFloat;
                } else {
                    valuesDiffer = receivedValue !== currentValue;
                }
                if (hasProperty && valuesDiffer) {
                     if (!(key === 'latitude' || key === 'longitude') && String(currentValue ?? '').trim() === '' && String(receivedValue ?? '').trim() === '') {
                         continue;
                     }
                     if (key === 'status') {
                         if (!VALID_REPORT_STATUSES.includes(receivedUpdates[key])) {
                             throw erroreRichiesta(`Stato non valido: ${receivedUpdates[key]}. Stati permessi: ${VALID_REPORT_STATUSES.join(', ')}`);
                         }
                         newStatus = receivedUpdates[key]; 
                         const wasTerminal = TERMINAL_REPORT_STATUSES_BACKEND.includes(oldStatus);
                         const isTerminal = TERMINAL_REPORT_STATUSES_BACKEND.includes(newStatus);
                         if (wasTerminal !== isTerminal) {
                             statusChangedAffectingTeams = true;
                             logger.debug(`[PUT Report] Cambio stato (${oldStatus} -> ${newStatus}) influenzerà disponibilità squadre.`);
                         }
                     }
                     if (key === 'priority') {
                         const validPriorities = ['Low', 'Medium', 'High'];
                         if (!validPriorities.includes(receivedUpdates[key])) throw erroreRichiesta(`Priorità non valida: ${receivedUpdates[key]}`);
                         if (receivedUpdates[key] === 'High' && currentValue !== 'High') priorityRaisedToHigh = true;
                     }
                     if (key === 'no_team_reason') {
                         if (parsedReceivedValue === '' || parsedReceivedValue === undefined) parsedReceivedValue = null;
                         if (parsedReceivedValue !== null && !MOTIVI_SENZA_SQUADRA[parsedReceivedValue]) {
                             throw erroreRichiesta(`Motivo non valido per la squadra non necessaria: ${parsedReceivedValue}`);
                         }
                     }
                     if (key === 'title' && (!parsedReceivedValue || String(parsedReceivedValue).trim() === '')) {
                         throw erroreRichiesta(`Il campo '${fieldNamesMap[key] || key}' non può essere vuoto.`);
                     }
                     if ((key === 'reporter_name' || key === 'reporter_contact') && String(parsedReceivedValue ?? '').trim() === '') parsedReceivedValue = null;
                    reportUpdatesToApply[key] = parsedReceivedValue;
                    hasReportUpdates = true;
                    const fieldName = fieldNamesMap[key] || key;
                const leggibile = (valore) => {
                    if (!valore) return valore;
                    if (key === 'no_team_reason') return MOTIVI_SENZA_SQUADRA[valore] || valore;
                    if (key === 'status') return ETICHETTA_STATO[valore] || valore;
                    if (key === 'priority') return ETICHETTA_PRIORITA[valore] || valore;
                    return valore;
                };
                const oldDisplay = currentValue === null || currentValue === undefined || String(currentValue).trim() === '' ? 'non impostato' : `'${String(leggibile(currentValue))}'`;
                const newDisplay = parsedReceivedValue === null || parsedReceivedValue === undefined || String(parsedReceivedValue).trim() === '' ? 'non impostato' : `'${String(leggibile(parsedReceivedValue))}'`;
                const logText = `Campo '${fieldName}' modificato da ${oldDisplay} a ${newDisplay}.`;
                logEntries.push(logText);
                logger.debug(`[Log Generated] Report ${reportId}: ${logText}`);
                }
            }
            if (!hasReportUpdates) {

                await client.query('ROLLBACK');
                return res.status(200).json(currentReport);
            }

            let assignmentsRemoved = false;
            if (TERMINAL_REPORT_STATUSES_BACKEND.includes(oldStatus) && ACTIVE_REPORT_STATUSES_BACKEND.includes(newStatus)) {
                logger.debug(`[DB] Report ${reportId} riaperto (da ${oldStatus} a ${newStatus}). Rimuovo assegnazioni squadre...`);
                const deleteAssignmentsQuery = `DELETE FROM report_team_assignments WHERE report_id = $1 RETURNING squadra_id`;
                const deleteResult = await client.query(deleteAssignmentsQuery, [reportId]);
                if (deleteResult.rowCount > 0) {
                    assignmentsRemoved = true;
                    const removedTeamIds = deleteResult.rows.map(r => r.squadra_id);
                    logger.info(`[DB] Rimosse ${deleteResult.rowCount} assegnazioni per report ${reportId} (Squadre: ${removedTeamIds.join(', ')}).`);
                    const teamRemovalLogText = `Tutte le squadre sono state disassociate a seguito della riapertura del report.`;
                    logEntries.push(teamRemovalLogText);
                    logger.debug(`[Log Generated] Report ${reportId}: ${teamRemovalLogText}`);
                } else {
                     logger.debug(`[DB] Nessuna assegnazione da rimuovere per report ${reportId}.`);
                }
            }

            for (const key in reportUpdatesToApply) {
                if (!ALLOWED_UPDATE_FIELDS.has(key)) {
                    logger.warn(`[PUT /api/reports/${reportId}] Tentativo di aggiornare campo non valido: ${key}`);
                    throw new Error(`Campo non valido per l'aggiornamento: ${key}`);
                }
            }
            
            let reportAfterUpdate = currentReport; 
            const setClauses = []; const values = []; let valueIndex = 1;
            for (const key in reportUpdatesToApply) {
                if (!ALLOWED_UPDATE_FIELDS.has(key)) continue;
                setClauses.push(`${key} = $${valueIndex}`);
                values.push(reportUpdatesToApply[key]);
                valueIndex++;
            }
            values.push(reportId); const reportIdPlaceholder = `$${valueIndex}`;
            const setClauseString = setClauses.join(', '); 
            const sqlUpdateQuery = `UPDATE reports SET ${setClauseString}, updated_at = NOW() WHERE id = ${reportIdPlaceholder} RETURNING *;`;
            const result = await client.query(sqlUpdateQuery, values);
            if (result.rowCount === 0) throw new Error('Report not found during final update.');
            reportAfterUpdate = result.rows[0];
            // Alla chiusura le assegnazioni restano: sono la traccia di chi è intervenuto dove.
            if (logEntries.length > 0) {
                    const insertLogQuery = `WITH inserted AS (INSERT INTO report_updates (report_id, update_text, user_id, update_timestamp, is_system) VALUES ($1, $2, $3, NOW(), true) RETURNING *) SELECT i.*, CONCAT(u.nome, ' ', u.cognome) as updater_fullname FROM inserted i JOIN users u ON i.user_id = u.id;`;
                    for (const logText of logEntries) {
                        const logResult = await client.query(insertLogQuery, [reportId, logText, userId]);
                        lastNewUpdate = logResult.rows[0];
                    }
                }
                await client.query('COMMIT');
                res.status(200).json(reportAfterUpdate); 
                if ('latitude' in receivedUpdates || 'longitude' in receivedUpdates) {
                    aggiornaRischi({ emergencyId: reportAfterUpdate?.emergency_id, reportIds: [reportId], userId });
                }

                if (reportAfterUpdate?.status && !ACTIVE_REPORT_STATUSES_BACKEND.includes(reportAfterUpdate.status)) {
                    notifiche.scadi({ tipo: 'intervento_assegnato', riferimento: { tipo: 'intervento', id: reportId } });
                }
                wss.clients.forEach(wsClient => {
                 if (wsClient.readyState === 1) {
                     try {
                         wsClient.send(JSON.stringify({ action: 'reload_reports', updatedReportId: reportId, daUtente: req.user.id }));
                         if (lastNewUpdate) {
                             wsClient.send(JSON.stringify({
                                 action: 'new_report_update',
                                 reportId: reportId,
                                 update: lastNewUpdate,
                                 priorityRaisedToHigh
                             }));
                         }
                          if (statusChangedAffectingTeams) {
                              logger.debug(`[WS Send] Invio reload_squadre a causa cambio stato report ${reportId}.`);
                              wsClient.send(JSON.stringify({ action: 'reload_squadre' }));
                         }
                     } catch (e) { logger.error("WS Send Error PUT Report:", e); }
                 }
            });
        } catch (err) {
            await client.query('ROLLBACK');
            logger.error(`Errore PUT /api/reports/${reportId}:`, err);

            const stato = err.nonTrovato ? 404
                : (err.richiestaNonValida || err.message === 'Nessun dato valido per l\'aggiornamento fornito.' ? 400 : 500);
            res.status(stato).json({ message: err.message || 'Errore durante l\'aggiornamento del report.' });
        } finally {
            client.release();
        }
    });

    app.put('/api/reports/:id/coordinates', authenticateToken, async (req, res) => {
        const reportId = parseInt(req.params.id, 10);
        const { latitude, longitude } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;


        logger.debug(`[API /api/reports/${reportId}/coordinates] Ricevuta richiesta da user: ${req.user.username} (ID: ${userId}, Ruolo: ${userRole})`);
        logger.debug(`[API /api/reports/${reportId}/coordinates] Body ricevuto:`, req.body);

        if (isNaN(reportId)) {
            logger.warn(`[API /api/reports/${reportId}/coordinates] Errore: ID Report non valido.`);
            return res.status(400).json({ message: 'ID Report non valido.' });
        }


        if (await esternoFuoriDallaSuaSquadra(req, reportId)) {
            logger.warn(`[API /api/reports/${reportId}/coordinates] Esterno ${req.user.username} su una segnalazione non della sua squadra.`);
            return res.status(403).json({ message: 'Puoi aggiornare solo le segnalazioni della tua squadra.' });
        }

        const latNum = parseFloat(latitude);
        const lonNum = parseFloat(longitude);

        if (isNaN(latNum) || isNaN(lonNum)) {
            logger.warn(`[API /api/reports/${reportId}/coordinates] Errore: Coordinate non valide (Lat: ${latitude}, Lon: ${longitude}).`);
            return res.status(400).json({ message: 'Coordinate non valide.' });
        }
        logger.debug(`[API /api/reports/${reportId}/coordinates] Coordinate parse: Lat=${latNum}, Lon=${lonNum}`);

        const client = await pool.connect();
        logger.debug(`[API /api/reports/${reportId}/coordinates] Client DB connesso.`);

        try {
            const beginQuery = 'BEGIN;';
            logger.debug('[DB Query Log] Eseguo:', beginQuery);
            await client.query(beginQuery);
            logger.debug('[DB Query Log] BEGIN completato.');

            const reportCheckQueryString = 'SELECT emergency_id, title FROM reports WHERE id = $1 FOR UPDATE;';
            logger.debug('[DB Query Log] Eseguo:', reportCheckQueryString, 'PARAMETRI:', [reportId]);
            const reportCheck = await client.query(reportCheckQueryString, [reportId]);
            logger.debug('[DB Query Log] SELECT FOR UPDATE completato, righe:', reportCheck.rowCount);
            
            if (reportCheck.rowCount === 0) {
                logger.warn(`[API /api/reports/${reportId}/coordinates] Report non trovato nel DB.`);
                await client.query('ROLLBACK;');
                return res.status(404).json({ message: 'Report non trovato.' });
            }
            const currentReportData = reportCheck.rows[0];
            logger.debug(`[API /api/reports/${reportId}/coordinates] Dati report attuale:`, currentReportData);

            if (!activeEmergency || currentReportData.emergency_id !== activeEmergency.id) {
                logger.warn(`[API /api/reports/${reportId}/coordinates] Tentativo modifica report fuori emergenza attiva. Attiva ID: ${activeEmergency?.id}, Report EID: ${currentReportData.emergency_id}`);
                await client.query('ROLLBACK;');
                return res.status(403).json({ message: 'Operazione permessa solo per report dell\'emergenza attiva.' });
            }

            const updateQueryString = `
          UPDATE reports 
          SET latitude = $1, longitude = $2, updated_at = NOW()
          WHERE id = $3 RETURNING *;
        `;
            logger.debug('[DB Query Log] Eseguo:', updateQueryString.trim(), 'PARAMETRI:', [latNum, lonNum, reportId]);
            const updatedReportResult = await client.query(updateQueryString, [latNum, lonNum, reportId]);
            const updatedReport = updatedReportResult.rows[0];
            logger.debug('[DB Query Log] UPDATE reports completato. Report aggiornato:', updatedReport);

            const logText = `Posizione corretta sulla mappa da ${nomeUtente(req.user)} (${latNum.toFixed(5)}, ${lonNum.toFixed(5)}).`;
            const insertLogQueryString = `
            WITH inserted AS (
                INSERT INTO report_updates (report_id, update_text, user_id, update_timestamp, is_system) 
                VALUES ($1, $2, $3, NOW(), true) RETURNING *
            )
            SELECT i.*, CONCAT(u.nome, ' ', u.cognome) as updater_fullname 
            FROM inserted i JOIN users u ON i.user_id = u.id;
        `; 
            logger.debug('[DB Query Log] Eseguo:', insertLogQueryString.trim(), 'PARAMETRI:', [reportId, logText, userId]);
            const logResult = await client.query(insertLogQueryString, [reportId, logText, userId]);
            const newUpdateLog = logResult.rows[0];
            logger.debug('[DB Query Log] INSERT report_updates completato. Log creato:', newUpdateLog);

            const commitQuery = 'COMMIT;';
            logger.debug('[DB Query Log] Eseguo:', commitQuery);
            await client.query(commitQuery);
            logger.debug('[DB Query Log] COMMIT completato.');
            
            res.status(200).json({ message: 'Coordinate aggiornate con successo.', report: updatedReport });
            aggiornaRischi({ emergencyId: updatedReport.emergency_id, reportIds: [reportId], userId });


            wss.clients.forEach(wsClient => {
                if (wsClient.readyState === 1) { 
                    try {
                        wsClient.send(JSON.stringify({ action: 'reload_reports', updatedReportId: reportId, daUtente: req.user.id }));
                        if (newUpdateLog) {
                            wsClient.send(JSON.stringify({ action: 'new_report_update', reportId: reportId, update: newUpdateLog }));
                        }
                    } catch (e) { logger.error("WS Send Error (update coords):", e); }
                }
            });

        } catch (error) {
            logger.error(`[API /api/reports/${reportId}/coordinates] ERRORE CATTURATO NEL BLOCCO TRY-CATCH:`, error); 
            try {
                const rollbackQuery = 'ROLLBACK;';
                logger.debug('[DB Query Log] Eseguo su errore:', rollbackQuery);
                await client.query(rollbackQuery);
                logger.debug('[DB Query Log] ROLLBACK completato.');
            } catch (rbError) {
                logger.error("[API /api/reports/${reportId}/coordinates] ERRORE DURANTE ROLLBACK:", rbError);
            }
            res.status(500).json({ message: 'Errore interno durante l\'aggiornamento delle coordinate.' });
        } finally {
            if (client) {
                client.release();
                logger.debug(`[API /api/reports/${reportId}/coordinates] Client DB rilasciato.`);
            }
        }
    });

    app.post('/api/reports/:id/updates', async (req, res) => {
        const { id } = req.params; const reportId = parseInt(id, 10);
        if (isNaN(reportId)) return res.status(400).json({ message: 'ID Report non valido.' });
        const { update_text } = req.body;
        if (!update_text || typeof update_text !== 'string' || update_text.trim() === '') return res.status(400).json({ message: 'Testo aggiornamento richiesto.' });
        const trimmedUpdateText = update_text.trim();
        const userId = req.user.id;
        const funzioneNota = Number.isInteger(req.body.funzione_id) && req.body.funzione_id > 0 ? req.body.funzione_id : null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
             const currentReportResult = await client.query('SELECT * FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
             if (currentReportResult.rowCount === 0) throw erroreNonTrovato();
             const currentReport = currentReportResult.rows[0];
             if (!activeEmergency || currentReport.emergency_id !== activeEmergency.id) {
                  await client.query('ROLLBACK');
                  logger.warn(`Tentativo modifica report ${reportId} fuori dall'emergenza attiva (Attiva: ${activeEmergency?.id}, Report: ${currentReport.emergency_id}) da utente ${req.user.username}`);
                  return res.status(403).json({ message: 'Operazione permessa solo per report appartenenti all\'emergenza attiva.' });
             }
             if (await esternoFuoriDallaSuaSquadra(req, reportId)) {
                  await client.query('ROLLBACK');
                  logger.warn(`Esterno ${req.user.username} ha tentato una nota sulla segnalazione ${reportId}, non della sua squadra.`);
                  return res.status(403).json({ message: 'Puoi aggiungere note solo alle segnalazioni della tua squadra.' });
             }
            const checkReportQuery = 'SELECT id FROM reports WHERE id = $1 FOR UPDATE';
            const reportCheckResult = await client.query(checkReportQuery, [reportId]);
            if (reportCheckResult.rowCount === 0) throw erroreNonTrovato();
            if (funzioneNota) {
                const ammessa = await client.query(
                    `SELECT 1 FROM incarichi i WHERE i.report_id = $1 AND i.funzione_id = $2
                       AND ($3::boolean OR EXISTS (SELECT 1 FROM funzione_membri m WHERE m.funzione_id = i.funzione_id AND m.user_id = $4))`,
                    [reportId, funzioneNota, !ruoliDi(req.user).includes('esterno'), userId]);
                if (ammessa.rowCount === 0) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ message: 'Puoi scrivere per conto di una funzione solo se ne fai parte e ha un incarico su questa segnalazione.' });
                }
            }
            const insertUpdateQuery = `
            WITH inserted AS (
                INSERT INTO report_updates (report_id, update_text, user_id, funzione_id) VALUES ($1, $2, $3, $4) RETURNING *
            )
            SELECT i.*, CONCAT(u.nome, ' ', u.cognome) as updater_fullname, f.sigla AS funzione_sigla
            FROM inserted i JOIN users u ON i.user_id = u.id LEFT JOIN funzioni f ON f.id = i.funzione_id;
        `;
            const insertResult = await client.query(insertUpdateQuery, [reportId, trimmedUpdateText, userId, funzioneNota]);
            const newUpdate = insertResult.rows[0]; 
            await client.query(`UPDATE reports SET updated_at = NOW() WHERE id = $1;`, [reportId]);
            await client.query('COMMIT');
            res.status(201).json(newUpdate); 
            wss.clients.forEach(wsClient => {
             if (wsClient.readyState === 1) {
                  try {
                      wsClient.send(JSON.stringify({ action: 'new_report_update', reportId: reportId, update: newUpdate }));
                  } catch (e) {
                       logger.error(`[WS Send Error] Add Update Report ${reportId}:`, e);
                  }
             }
         });
        } catch (err) { await client.query('ROLLBACK'); logger.error(`Errore POST /api/reports/${reportId}/updates:`, err); res.status(err.nonTrovato ? 404 : 500).json({ message: err.message || 'Errore aggiunta aggiornamento.' });
        } finally { client.release(); }
    });

    app.post('/api/reports/:id/teams', async (req, res) => {
        const { id } = req.params;
        const reportId = parseInt(id, 10);
        if (isNaN(reportId)) {
            return res.status(400).json({ message: 'ID Report non valido.' });
        }
        const { teamId } = req.body;
        if (req.user.role === 'esterno') {
          return res.status(403).json({ message: 'Permesso negato per assegnare squadre.' });
        }
        if (typeof teamId !== 'number' || !Number.isInteger(teamId) || teamId <= 0) {
            return res.status(400).json({ message: 'ID Team non valido fornito.' });
        }
        const userId = req.user.id;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
             const currentReportResult = await client.query('SELECT * FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
             if (currentReportResult.rowCount === 0) throw erroreNonTrovato();
             const currentReport = currentReportResult.rows[0];
             if (!activeEmergency || currentReport.emergency_id !== activeEmergency.id) {
                  await client.query('ROLLBACK'); 
                  logger.warn(`Tentativo modifica report ${reportId} fuori dall'emergenza attiva (Attiva: ${activeEmergency?.id}, Report: ${currentReport.emergency_id}) da utente ${req.user.username}`);
                  return res.status(403).json({ message: 'Operazione permessa solo per report appartenenti all\'emergenza attiva.' });
             }
            const checkReport = await client.query('SELECT status FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
            if (checkReport.rowCount === 0) throw erroreNonTrovato();
            const reportStatus = currentReport.status;
            if (TERMINAL_REPORT_STATUSES_BACKEND.includes(reportStatus)) {

                 throw erroreConflitto(`Impossibile assegnare la squadra: la segnalazione e' ${ETICHETTA_STATO[reportStatus] || reportStatus}.`);
            }
            // FOR UPDATE anche sulla squadra: due assegnazioni della stessa squadra si mettono in
            // fila. Ordine dei blocchi: reports, poi squadre.
            const checkTeam = await client.query('SELECT nome, nome_radio, coc FROM squadre WHERE id = $1 FOR UPDATE', [teamId]);

            if (checkTeam.rowCount === 0) throw erroreNonTrovato('Squadra non trovata.');
            if (checkTeam.rows[0].coc) throw erroreConflitto('La squadra COC è la sala operativa: non va sugli interventi.');
            const teamPrefix = checkTeam.rows[0].nome_radio || `ID ${teamId}`;
            const checkConstraintQuery = `SELECT rta.report_id FROM report_team_assignments rta JOIN reports r ON rta.report_id = r.id WHERE rta.squadra_id = $1 AND r.id != $2 AND r.status = ANY($3::varchar[]) LIMIT 1;`;
            const constraintCheckResult = await client.query(checkConstraintQuery, [teamId, reportId, ACTIVE_REPORT_STATUSES_BACKEND]);
            if (constraintCheckResult.rowCount > 0) {
                 throw erroreConflitto(`Vincolo violato: Squadra ${teamId} ('${teamPrefix}') già assegnata al report attivo #${constraintCheckResult.rows[0].report_id}.`);
            }
            const insertQuery = `INSERT INTO report_team_assignments (report_id, squadra_id) VALUES ($1, $2) ON CONFLICT (report_id, squadra_id) DO NOTHING;`;
            await client.query(insertQuery, [reportId, teamId]);
            const logTextAssign = `Squadra '${teamPrefix}' assegnata.`;
            const insertLogQuery = `WITH inserted AS (INSERT INTO report_updates (report_id, update_text, user_id, update_timestamp, is_system) VALUES ($1, $2, $3, NOW(), true) RETURNING *) SELECT i.*, CONCAT(u.nome, ' ', u.cognome) as updater_fullname FROM inserted i JOIN users u ON i.user_id = u.id;`;
            const logResultAssign = await client.query(insertLogQuery, [reportId, logTextAssign, userId]);
            const newUpdateAssign = logResultAssign.rows[0];
            let newReportStatus = reportStatus;
            let newUpdateStato = null;
            if (['New', 'Open'].includes(reportStatus)) {
                newReportStatus = 'InProgress';
                newUpdateStato = (await client.query(insertLogQuery, [reportId,
                    `Campo 'Stato' modificato da '${ETICHETTA_STATO[reportStatus]}' a '${ETICHETTA_STATO.InProgress}' (squadra assegnata).`, userId])).rows[0];
            }
            await client.query(
                `UPDATE reports SET status = $1, updated_at = NOW() WHERE id = $2;`,
                [newReportStatus, reportId]
            );
            await client.query('COMMIT');
            res.status(201).json({ message: 'Team assegnato con successo al report.' });
            // Sulla schermata di blocco numero e squadra, non l'indirizzo.
            pool.query('SELECT emergency_report_number FROM reports WHERE id = $1', [reportId])
                .then(({ rows }) => avvisaSquadra(teamId, {
                    tipo: 'intervento_assegnato',
                    titolo: `Squadra ${teamPrefix}: intervento #${rows[0]?.emergency_report_number ?? reportId}`,
                    riferimento: { tipo: 'intervento', id: reportId },
                    chiave: `intervento:${reportId}:${teamId}:${Date.now()}`,
                    oreValidita: 24
                }))
                .catch(e => logger.error('[Notifiche] Avviso di assegnazione non riuscito:', e));
            wss.clients.forEach(wsClient => {
                if (wsClient.readyState === 1) {
                    try {
                        wsClient.send(JSON.stringify({ action: 'reload_reports', updatedReportId: reportId, daUtente: req.user.id }));
                        if (newUpdateAssign) {
                             wsClient.send(JSON.stringify({ action: 'new_report_update', reportId: reportId, update: newUpdateAssign }));
                        }
                        if (newUpdateStato) {
                             wsClient.send(JSON.stringify({ action: 'new_report_update', reportId: reportId, update: newUpdateStato }));
                        }
                        wsClient.send(JSON.stringify({ action: 'reload_squadre', updatedTeamId: teamId }));
                    } catch (e) { logger.error("WS Send Error Assign Team:", e); }
                }
            });
        } catch (err) {
            await client.query('ROLLBACK');
            logger.error(`Errore POST /api/reports/${reportId}/teams (Team ${teamId}):`, err);
            res.status(err.conflitto ? 409 : (err.nonTrovato ? 404 : 500)).json({ message: err.message || 'Errore durante l\'assegnazione del team.' });
        } finally {
            client.release();
        }
    });

    // Lo stato della squadra lo cambia chi ne fa parte, anche un esterno, dall'app o dal web; indietro lo
    // corregge la sala. Dalla coda senza rete arriva con l'ora del tocco, accettata fino a sei ore prima.
    // Le etichette stanno nel server: le pagine e l'app le leggono da qui.
    app.get('/api/segnalazioni/tipi', (req, res) => res.json(TIPI_SEGNALAZIONE));

    app.post('/api/reports/:id/teams/:teamId/stato', async (req, res) => {
        const reportId = parseInt(req.params.id, 10), teamId = parseInt(req.params.teamId, 10);
        const stato = String(req.body?.stato || '');
        if (!Number.isInteger(reportId) || !Number.isInteger(teamId)) return res.status(400).json({ message: 'Richiesta non valida.' });
        if (!STATI_SQUADRA.includes(stato)) return res.status(400).json({ message: `Lo stato è uno fra: ${STATI_SQUADRA.join(', ')}.` });
        let quando = new Date();
        if (req.body?.quando) {
            const dato = new Date(req.body.quando);
            const scarto = Date.now() - dato.getTime();
            if (!Number.isNaN(dato.getTime()) && scarto >= -2 * 60 * 1000 && scarto <= 6 * 60 * 60 * 1000) quando = dato;
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const a = (await client.query(
                `SELECT rta.assignment_id, rta.stato, COALESCE(s.nome_radio, rta.nome_radio) AS nome_radio, r.emergency_id,
                        EXISTS (SELECT 1 FROM squadra_membri m WHERE m.squadra_id = rta.squadra_id AND m.username = $3) AS membro
                   FROM report_team_assignments rta JOIN reports r ON r.id = rta.report_id
                   LEFT JOIN squadre s ON s.id = rta.squadra_id
                  WHERE rta.report_id = $1 AND rta.squadra_id = $2 FOR UPDATE OF rta`, [reportId, teamId, req.user.username])).rows[0];
            if (!a || !puoVedereEmergenza(req, a.emergency_id)) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Squadra non assegnata a questa segnalazione.' }); }
            const sala = !ruoliDi(req.user).includes('esterno');
            if (!a.membro && !sala) { await client.query('ROLLBACK'); return res.status(403).json({ message: 'Lo stato lo cambia chi è nella squadra, o la sala.' }); }
            const prima = STATI_SQUADRA.indexOf(a.stato), dopo = STATI_SQUADRA.indexOf(stato);
            if (dopo === prima) { await client.query('ROLLBACK'); return res.status(409).json({ message: `La squadra è già ${ETICHETTA_STATO_SQUADRA[stato]}.`, stato }); }
            if (dopo < prima && !sala) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Dal campo lo stato va solo avanti: per correggerlo chiedi alla sala.', stato: a.stato }); }
            await client.query('UPDATE report_team_assignments SET stato = $2, stato_il = $3 WHERE assignment_id = $1', [a.assignment_id, stato, quando]);
            await client.query(
                `INSERT INTO stati_squadra (report_id, squadra_id, nome_radio, stato, quando, user_id, autore_nome) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [reportId, teamId, a.nome_radio, stato, quando, req.user.id, nomeUtente(req.user)]);
            const ora = quando.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
            const nota = `${a.nome_radio || 'Squadra'} ${ETICHETTA_STATO_SQUADRA[stato]}, ${ora}${dopo < prima ? ' (corretto dalla sala)' : ''}`;
            const voce = (await client.query('INSERT INTO report_updates (report_id, update_text, user_id, update_timestamp, is_system) VALUES ($1, $2, $3, NOW(), true) RETURNING *',
                [reportId, nota, req.user.id])).rows[0];
            await client.query('COMMIT');
            avvisaClienti('reload_reports', { updatedReportId: reportId, daUtente: req.user.id });
            // Come le altre note di sistema: il diario aperto in sala la mostra senza riaprire la scheda.
            avvisaClienti('new_report_update', { reportId, update: { ...voce, updater_fullname: nomeUtente(req.user) } });
            avvisaClienti('reload_squadre', { squadraId: teamId });
            res.json({ stato, quando, nota });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error(`Errore POST /api/reports/${reportId}/teams/${teamId}/stato:`, e);
            res.status(500).json({ message: 'Errore nel cambiare lo stato della squadra.' });
        } finally {
            client.release();
        }
    });

    app.delete('/api/reports/:id/teams/:teamId', async (req, res) => {
        const { id, teamId } = req.params; const reportId = parseInt(id, 10); const squadraId = parseInt(teamId, 10);
        if (isNaN(reportId) || isNaN(squadraId)) return res.status(400).json({ message: 'ID Report o Team non valido.' });
        const userId = req.user.id;
        if (req.user.role === 'esterno') {
          return res.status(403).json({ message: 'Permesso negato per rimuovere squadre.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
             const currentReportResult = await client.query('SELECT * FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
             if (currentReportResult.rowCount === 0) throw erroreNonTrovato();
             const currentReport = currentReportResult.rows[0];
             if (!activeEmergency || currentReport.emergency_id !== activeEmergency.id) {
                  await client.query('ROLLBACK'); 
                  logger.warn(`Tentativo modifica report ${reportId} fuori dall'emergenza attiva (Attiva: ${activeEmergency?.id}, Report: ${currentReport.emergency_id}) da utente ${req.user.username}`);
                  return res.status(403).json({ message: 'Operazione permessa solo per report appartenenti all\'emergenza attiva.' });
             }
            const teamNameResult = await client.query('SELECT nome_radio FROM squadre WHERE id = $1', [squadraId]);
            const teamPrefix = teamNameResult.rows[0]?.nome_radio || `ID ${squadraId}`;
            const deleteQuery = `DELETE FROM report_team_assignments WHERE report_id = $1 AND squadra_id = $2;`;
            const result = await client.query(deleteQuery, [reportId, squadraId]);
            if (result.rowCount === 0) throw new Error('Assegnazione non trovata.');
            const logTextRemove = `Assegnazione Squadra '${teamPrefix}' rimossa.`;
            const insertLogQuery = `WITH inserted AS (INSERT INTO report_updates (report_id, update_text, user_id, update_timestamp, is_system) VALUES ($1, $2, $3, NOW(), true) RETURNING *) SELECT i.*, CONCAT(u.nome, ' ', u.cognome) as updater_fullname FROM inserted i JOIN users u ON i.user_id = u.id;`;
            const logResultRemove = await client.query(insertLogQuery, [reportId, logTextRemove, userId]);
            const newUpdateRemove = logResultRemove.rows[0];
            let newUpdateStatoRimozione = null;
            const restano = (await client.query('SELECT 1 FROM report_team_assignments WHERE report_id = $1 LIMIT 1', [reportId])).rowCount > 0;
            if (!restano && currentReport.status === 'InProgress' && !currentReport.no_team_reason) {
                await client.query(`UPDATE reports SET status = 'Open' WHERE id = $1`, [reportId]);
                newUpdateStatoRimozione = (await client.query(insertLogQuery, [reportId,
                    `Campo 'Stato' modificato da '${ETICHETTA_STATO.InProgress}' a '${ETICHETTA_STATO.Open}' (nessuna squadra assegnata).`, userId])).rows[0];
            }
            await client.query(`UPDATE reports SET updated_at = NOW() WHERE id = $1;`, [reportId]);
            await client.query('COMMIT');
            res.sendStatus(204);

            pool.query('SELECT u.id FROM squadra_membri sm JOIN users u ON u.username = sm.username WHERE sm.squadra_id = $1', [squadraId])
                .then(({ rows }) => Promise.all(rows.map(r => notifiche.scadi({
                    tipo: 'intervento_assegnato', riferimento: { tipo: 'intervento', id: reportId }, userId: r.id
                }))))
                .catch(e => logger.error('[Notifiche] Scadenza avvisi intervento non riuscita:', e));
            wss.clients.forEach(wsClient => {
                if (wsClient.readyState === 1) {
                    try {
                        wsClient.send(JSON.stringify({ action: 'reload_reports', updatedReportId: reportId, daUtente: req.user.id }));
                        if (newUpdateRemove) {
                            wsClient.send(JSON.stringify({ action: 'new_report_update', reportId: reportId, update: newUpdateRemove }));
                        }
                        if (newUpdateStatoRimozione) {
                            wsClient.send(JSON.stringify({ action: 'new_report_update', reportId: reportId, update: newUpdateStatoRimozione }));
                        }
                        wsClient.send(JSON.stringify({ action: 'reload_squadre', updatedTeamId: squadraId }));
                    } catch (e) { logger.error("WS Send Error Unassign Team:", e); }
                }
            });
        } catch (err) { await client.query('ROLLBACK'); logger.error(`Errore DELETE /api/reports/${reportId}/teams/${squadraId}:`, err); res.status(err.nonTrovato || err.message === 'Assegnazione non trovata.' ? 404 : 500).json({ message: err.message || 'Errore rimozione assegnazione.' });
        } finally { client.release(); }
    });

    app.post('/api/reports/:id/images', uploadLimiter, authenticateToken, (req, res, next) => {
          uploadImageMulter.array('reportImages', 5)(req, res, (err) => {
            if (err instanceof multer.MulterError) {
              logger.warn(`Errore Multer upload immagini report ${req.params.id}:`, err);
              return res.status(400).json({ message: `Errore Multer: ${err.message}` });
            } else if (err) {
              logger.error(`Errore inatteso durante upload immagini report ${req.params.id}:`, err);
              return res.status(500).json({ message: 'Errore durante il caricamento delle immagini.' });
            }
            if (req.fileValidationError) {
              logger.warn(`Validazione fallita per upload immagini report ${req.params.id}: ${req.fileValidationError}`);
              const filesToDelete = req.files || [];
              if (filesToDelete.length > 0) {
                  filesToDelete.forEach(file => {
                      fs.unlink(file.path, (unlinkErr) => {
                          if (unlinkErr) logger.error(`Errore pulizia file rifiutato ${file.path}:`, unlinkErr);
                      });
                  });
              }
              return res.status(400).json({ message: req.fileValidationError });
            }
            next();
          });
        },
        async (req, res) => {
          const { id } = req.params;
          const reportId = parseInt(id, 10);
            if (req.user.role === 'esterno') {
                if (await esternoFuoriDallaSuaSquadra(req, parseInt(req.params.id, 10) || 0)) {
                    (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
                    return res.status(403).json({ message: 'Permesso negato per caricare immagini.' });
                }
            }
          const files = req.files;
          if (isNaN(reportId)) return res.status(400).json({ message: 'ID Report non valido.' });
          if (!files || files.length === 0) return res.status(400).json({ message: 'Nessun file immagine inviato.' });
          if (!(await verifyMultipleUploadedImages(req, res, ['image/jpeg', 'image/png', 'image/gif']))) return;
          await proteggiCaricati(files);
          const userId = req.user.id;
          logger.debug(`[POST /api/reports/${reportId}/images] Ricevute ${files.length} immagini da user ${req.user.id}`);
          const client = await pool.connect();
          try {
              await client.query('BEGIN');
               const currentReportResult = await client.query('SELECT * FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
               if (currentReportResult.rowCount === 0) throw erroreNonTrovato();
               const currentReport = currentReportResult.rows[0];
               if (!activeEmergency || currentReport.emergency_id !== activeEmergency.id) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ message: 'Operazione permessa solo per report appartenenti all\'emergenza attiva.' });
               }
              const checkReport = await client.query('SELECT id FROM reports WHERE id = $1 FOR UPDATE', [reportId]);
              if (checkReport.rowCount === 0) throw erroreNonTrovato();
              const insertQuery = 'INSERT INTO report_images (report_id, image_url) VALUES ($1, $2) RETURNING image_id, image_url';
              const uploadedImagesInfo = [];

              for (const file of files) {
                  const imageUrl = `/uploads/${file.filename}`;
                  const result = await client.query(insertQuery, [reportId, imageUrl]);
                  uploadedImagesInfo.push(result.rows[0]);
                  logger.info(`[DB] Immagine inserita: ${imageUrl} per report ${reportId}`);
              }
              let newUpdateLog = null;
                  if (files.length > 0) {
                      const logText = files.length === 1
                          ? `1 immagine caricata.`
                          : `${files.length} immagini caricate.`;
                      const insertLogQuery = `
                      WITH inserted AS (
                          INSERT INTO report_updates (report_id, update_text, user_id, update_timestamp, is_system)
                          VALUES ($1, $2, $3, NOW(), true) RETURNING *
                      )
                      SELECT i.*, CONCAT(u.nome, ' ', u.cognome) as updater_fullname
                      FROM inserted i JOIN users u ON i.user_id = u.id;
                  `;
                      const logResult = await client.query(insertLogQuery, [reportId, logText, userId]);
                      if (logResult.rows.length > 0) {
                           newUpdateLog = logResult.rows[0];
                      }
                  }
              await client.query('UPDATE reports SET updated_at = NOW() WHERE id = $1', [reportId]);
              await client.query('COMMIT');
              res.status(201).json({
                  message: `${files.length} immagini caricate con successo.`,
                  uploadedImages: uploadedImagesInfo
              });
              wss.clients.forEach(wsClient => {
                       if (wsClient.readyState === 1) {
                           try {
                                wsClient.send(JSON.stringify({ action: 'reload_reports', updatedReportId: reportId, daUtente: req.user.id }));
                                if (newUpdateLog) {
                                     wsClient.send(JSON.stringify({ action: 'new_report_update', reportId: reportId, update: newUpdateLog }));
                                }
                           } catch(e){ logger.error("WS Send Error Upload Img:", e); }
                       }
                  });
          } catch (error) {
              await client.query('ROLLBACK');
              logger.error(`Errore upload immagini per report ${reportId}:`, error);
              res.status(error.nonTrovato ? 404 : 500).json({ message: error.message || 'Errore durante l\'upload delle immagini.' });
          } finally {
              client.release();
          }
      });


    app.post('/api/location', async (req, res) => {
        const { squadra_id, latitude, longitude } = req.body;
        if (squadra_id == null || latitude == null || longitude == null ) {
             if (!req.body || Object.keys(req.body).length === 0) {
                 logger.error('[POST /api/location] Errore: il corpo della richiesta JSON è vuoto o non valido.');
                 return res.status(400).json({ error: 'Corpo richiesta JSON non valido o vuoto.' });
             }
             return res.status(400).json({ error: 'Campi squadra_id, latitude, longitude mancanti o nulli nel JSON.' });
        }
        try {
            const lat = parseFloat(latitude);
            const lon = parseFloat(longitude);
            const teamId = parseInt(squadra_id);
            if (isNaN(lat) || isNaN(lon) || isNaN(teamId)) {
                 return res.status(400).json({ error: 'Formato dati invalido nel JSON (ID, Lat, Lon devono essere numerici).' });
            }
            const squadraCoc = await pool.query('SELECT 1 FROM squadre WHERE id = $1 AND coc', [teamId]);
            if (squadraCoc.rowCount) return res.status(409).json({ error: 'La squadra COC non manda la posizione.', squadra_coc: true });
            const membro = (await pool.query(
                'SELECT caposquadra FROM squadra_membri WHERE squadra_id = $1 AND username = $2', [teamId, req.user.username])).rows[0];
            if (!membro && !haPermesso(req, 'volontari.anagrafica')) {
                logger.warn(`[SECURITY] L'utente ${req.user.username} ha tentato di inviare la posizione per la squadra ${teamId} senza farne parte.`);
                return res.status(403).json({ error: 'Non sei autorizzato ad aggiornare la posizione di questa squadra.' });
            }
            const caposquadra = membro?.caposquadra === true;
            // Un'età e non un'ora: l'orologio del telefono non conta. Con la rete che va e viene
            // la posizione deve arrivare in sala vecchia com'è.
            const eta = Number(req.body.eta_ms);
            const etaSecondi = Number.isFinite(eta) && eta > 0 ? Math.min(eta, 3600000) / 1000 : 0;
            // La posizione la manda un telefono solo, se no la squadra salta fra un membro e
            // l'altro: il caposquadra, o chi la sta già mandando finché non tace.
            const upsertQuery = `
            INSERT INTO posizioni_squadre (squadra_id, latitude, longitude, last_update, inviata_da)
            VALUES ($1, $2, $3, NOW() - make_interval(secs => $7::float8), $4)
            ON CONFLICT (squadra_id)
            -- NOW() e basta: la colonna è timestamptz e sa già a che istante si
            -- riferisce. Con "NOW() AT TIME ZONE 'Europe/Rome'" il valore veniva
            -- prima convertito in ora locale e poi riletto come se fosse UTC,
            -- cioè salvato due ore nel futuro (in ora legale). La prima posizione
            -- di una squadra era giusta, tutte le successive no: il centro
            -- operativo non vedeva più invecchiare nessuna posizione, perché il
            -- confronto "più vecchia di 5 minuti" dava sempre un numero negativo.
            -- Una squadra con l'app spenta da un'ora restava indicata come viva.
            DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, last_update = EXCLUDED.last_update, inviata_da = EXCLUDED.inviata_da
            -- Una posizione arrivata in ritardo non copre una più recente.
            WHERE posizioni_squadre.last_update <= EXCLUDED.last_update AND ($5::boolean
               OR posizioni_squadre.inviata_da IS NULL
               OR posizioni_squadre.inviata_da = EXCLUDED.inviata_da
               OR posizioni_squadre.last_update < NOW() - make_interval(mins => $6::int)
               OR NOT EXISTS (SELECT 1 FROM squadra_membri m
                               WHERE m.squadra_id = posizioni_squadre.squadra_id AND m.username = posizioni_squadre.inviata_da))
            RETURNING squadra_id, latitude, longitude, last_update, inviata_da;
        `;
            const upsertResult = await pool.query(upsertQuery, [teamId, lat, lon, req.user.username, caposquadra, MINUTI_SUBENTRO, etaSecondi]);
            if (upsertResult.rowCount === 0) {
                const chi = (await pool.query(
                    `SELECT u.username, u.nome, u.cognome, COALESCE(m.caposquadra, false) AS caposquadra
                       FROM posizioni_squadre ps JOIN users u ON u.username = ps.inviata_da
                       LEFT JOIN squadra_membri m ON m.squadra_id = ps.squadra_id AND m.username = ps.inviata_da
                      WHERE ps.squadra_id = $1`, [teamId])).rows[0] || null;
                if (chi?.username === req.user.username) {
                    return res.status(200).json({ message: 'C\'è già una posizione più recente.', accettata: true, superata: true, caposquadra });
                }
                if (chi) delete chi.username;
                return res.status(200).json({ message: 'La posizione della squadra la sta mandando un altro membro.', accettata: false, inviata_da: chi });
            }
            const updatedLocation = upsertResult.rows[0];
            let teamDetails = null;
            try {
                 const teamQuery = 'SELECT nome_radio, nome FROM squadre WHERE id = $1';
                 const teamResult = await pool.query(teamQuery, [teamId]);
                 if (teamResult.rowCount > 0) teamDetails = teamResult.rows[0];
                 else logger.warn(`[POST /api/location] Dettagli squadra non trovati per ID ${teamId}.`);
            } catch (teamQueryError) {
                 logger.error(`[POST /api/location] Errore recupero dettagli squadra ${teamId}:`, teamQueryError);
            }
            res.status(200).json({ message: 'Location updated', accettata: true, caposquadra });
            const wsDataPayload = {
                 squadra_id: updatedLocation.squadra_id,
                 latitude: updatedLocation.latitude,
                 longitude: updatedLocation.longitude,
                 last_update: updatedLocation.last_update,
                 inviata_da: { username: req.user.username, nome: req.user.nome || null, cognome: req.user.cognome || null, caposquadra },
                 nome_radio: teamDetails?.nome_radio || null,
                 squadra_nome_descrittivo: teamDetails?.nome || null
            };
            wss.clients.forEach(wsClient => {
                 if (wsClient.readyState === 1) {
                     try { wsClient.send(JSON.stringify({ action: 'team_location_update', teamData: wsDataPayload })); }
                     catch (e) { logger.error("WS Send Error (team_location_update):", e); }
                 }
            });
            // Una posizione vecchia arrivata col ritorno della rete non è un ingresso di adesso.
            if (etaSecondi <= 300) controllaZoneSquadra({ emergencyId: activeEmergency?.id, squadraId: teamId, lat, lon });
        } catch (err) {
            logger.error("Errore POST /api/location:", err);
            if (!res.headersSent) {
                 res.status(500).json({ error: 'Errore aggiornamento posizione squadra' });
            }
        }
    });

    app.get('/api/location', async (req, res) => { 
        try {
            const query = `
            SELECT 
                ps.squadra_id, 
                ps.latitude, 
                ps.longitude, 
                ps.last_update,
                s.nome_radio,                 
                s.nome as squadra_nome_descrittivo,
                (SELECT json_build_object('username', u.username, 'nome', u.nome, 'cognome', u.cognome,
                                          'caposquadra', COALESCE(m.caposquadra, false))
                   FROM users u LEFT JOIN squadra_membri m ON m.squadra_id = ps.squadra_id AND m.username = u.username
                  WHERE u.username = ps.inviata_da) AS inviata_da
            FROM posizioni_squadre ps
            LEFT JOIN squadre s ON ps.squadra_id = s.id
            ORDER BY ps.squadra_id;
        `;
            const result = await pool.query(query);
            res.status(200).json(result.rows);
        } catch (err) { logger.error("Errore GET /api/location", err); res.status(500).json({ error: 'Errore recupero posizioni' }); }
    });
}
