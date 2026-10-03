// src/squadre.js
//
// Le squadre e il loro registro durante un'emergenza.

import logger from './logger.js';
import { registraAudit } from './audit.js';
import { checkAdminRole, nomeUtente, nonEsterni, ruoliDi } from './autenticazione.js';
import { sistemaBeniInCarico } from './beniInUscita.js';
import { ACTIVE_REPORT_STATUSES_BACKEND, NOMI_RADIO, erroreNonTrovato, erroreRichiesta } from './costanti.js';
import { pool } from './db.js';
import { activeEmergency } from './statoEmergenza.js';
import { notifiche, wss } from './tempoReale.js';

// Le persone di una squadra, per le notifiche che la riguardano.
export async function avvisaSquadra(squadraId, dati) {
    try {
        const { rows } = await pool.query(
            `SELECT u.id FROM squadra_membri sm JOIN users u ON u.username = sm.username
             WHERE sm.squadra_id = $1 AND COALESCE(u.is_active, true) = true`, [squadraId]);
        return await notifiche.notificaA(rows.map(r => r.id), dati);
    } catch (e) {
        logger.error(`[Notifiche] Avviso alla squadra ${squadraId} non riuscito:`, e);
        return 0;
    }
}

// Gli utenti con lo stato di visita e corso base, per comporre le squadre.
async function getAvailableUsersQuery(client) {
    const query = `
        SELECT u.id, u.username, u.nome, u.cognome, u.role,
        COALESCE((
            SELECT (umr.status = 'Idoneo' AND umr.expiry_date >= CURRENT_DATE) 
            FROM user_medical_records umr 
            JOIN medical_visit_types mvt ON umr.visit_type_id = mvt.id
            WHERE umr.user_id = u.id AND LOWER(mvt.name) = 'visita di idoneità fisica'
            ORDER BY umr.last_visit_date DESC 
            LIMIT 1
        ), FALSE) AS medical_ok,
        COALESCE((
            SELECT TRUE 
            FROM user_courses uc 
            WHERE uc.user_id = u.id AND uc.course_id = 1 AND (uc.expiry_date IS NULL OR uc.expiry_date >= CURRENT_DATE) 
            LIMIT 1
        ), FALSE) AS course_ok
        FROM users u
        WHERE (u.is_active = true OR u.is_active IS NULL)
        AND NOT EXISTS (SELECT 1 FROM squadra_membri sm WHERE sm.username = u.username)
        ORDER BY u.cognome, u.nome;
    `;
    const result = await client.query(query);
    return result.rows;
}

// Durante un'emergenza ogni entrata e uscita da una squadra si annota, per la
// relazione finale; fuori emergenza no. Un errore qui non ferma l'operazione.
export async function annotaRegistroSquadre(client, righe, req = null, emergencyId = null) {
    // All'apertura l'emergenza si passa: lo stato globale cambia solo dopo il COMMIT.
    const idEmergenza = emergencyId ?? activeEmergency?.id ?? null;
    if (!idEmergenza || !Array.isArray(righe) || righe.length === 0) return;
    try {

        const esecutore = nomeUtente(req?.user);
        for (const r of righe) {
            await client.query(
                `INSERT INTO emergency_team_log
                   (emergency_id, squadra_id, nome_radio, squadra_nome, username, nome, cognome, azione, motivo, eseguita_da)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [idEmergenza, r.squadra_id ?? null, r.nome_radio, r.squadra_nome ?? null,
                 r.username ?? null, r.nome ?? null, r.cognome ?? null,
                 r.azione, r.motivo || 'operazione', esecutore]
            );
        }
    } catch (errore) {
        logger.error('[Registro squadre] Annotazione non riuscita:', errore);
    }
}

// Chi è entrato e chi è uscito fra la composizione vecchia e la nuova.
function differenzaMembri(prima, dopo, datiSquadra, motivo = 'operazione') {
    const chiaviPrima = new Map(prima.map(m => [m.username, m]));
    const chiaviDopo = new Map(dopo.map(m => [m.username, m]));
    const righe = [];
    for (const [username, m] of chiaviDopo) {
        if (!chiaviPrima.has(username)) righe.push({ ...datiSquadra, username, nome: m.nome, cognome: m.cognome, azione: 'membro_aggiunto', motivo });
    }
    for (const [username, m] of chiaviPrima) {
        if (!chiaviDopo.has(username)) righe.push({ ...datiSquadra, username, nome: m.nome, cognome: m.cognome, azione: 'membro_rimosso', motivo });
    }
    return righe;
}

// I nomi radio di squadre sciolte durante l'emergenza: bloccati fino alla chiusura.
export async function nomiRadioBloccati(client) {
    if (!activeEmergency) return new Set();
    const { rows } = await client.query(
        `SELECT DISTINCT nome_radio FROM emergency_team_log
          WHERE emergency_id = $1 AND azione = 'squadra_eliminata'`,
        [activeEmergency.id]
    );
    return new Set(rows.map(r => r.nome_radio));
}

// I membri di una squadra verificati sull'anagrafica: esistono, il nome è
// quello vero, e nessuno sta già in un'altra squadra (il messaggio dice chi e dove).
async function risolviMembriSquadra(client, membri, squadraIdCorrente = null) {
    if (!Array.isArray(membri) || membri.length === 0) return [];
    const usernames = [...new Set(
        membri.map(m => String(m?.username || '').trim().toLowerCase()).filter(Boolean)
    )];
    if (usernames.length === 0) return [];

    const { rows } = await client.query(`
        SELECT u.username, u.nome, u.cognome,
               sm.squadra_id AS squadra_attuale,
               s.nome_radio  AS nome_radio_attuale,
               (SELECT r.emergency_report_number
                  FROM report_team_assignments rta
                  JOIN reports r ON r.id = rta.report_id
                 WHERE rta.squadra_id = sm.squadra_id
                   AND r.status = ANY($2::varchar[])
                 LIMIT 1) AS impegnata_su
        FROM users u
        LEFT JOIN squadra_membri sm ON sm.username = u.username
        LEFT JOIN squadre s ON s.id = sm.squadra_id
        WHERE u.username = ANY($1::text[])
          AND COALESCE(u.is_active, true) = true
    `, [usernames, ACTIVE_REPORT_STATUSES_BACKEND]);

    const trovati = new Map();
    for (const r of rows) {
        if (!trovati.has(r.username)) trovati.set(r.username, r);
        // Con dati vecchi una persona può risultare in più squadre: conta l'altra.
        else if (r.squadra_attuale && r.squadra_attuale !== squadraIdCorrente) trovati.set(r.username, r);
    }

    const mancanti = usernames.filter(u => !trovati.has(u));
    if (mancanti.length > 0) {
        throw erroreRichiesta(`Questi nominativi non esistono o non sono più attivi: ${mancanti.join(', ')}.`);
    }

    for (const r of trovati.values()) {
        if (r.squadra_attuale && r.squadra_attuale !== squadraIdCorrente) {
            const dove = r.nome_radio_attuale || `squadra ${r.squadra_attuale}`;
            const impegno = r.impegnata_su ? `, che è impegnata sulla segnalazione #${r.impegnata_su}` : '';
            throw erroreRichiesta(`${r.nome} ${r.cognome} fa già parte della squadra ${dove}${impegno}. Toglilo da quella squadra prima di inserirlo in questa.`);
        }
    }


    return [...trovati.values()].map(r => ({ username: r.username, nome: r.nome, cognome: r.cognome }));
}

// I blocchi operativi della segreteria: senza visita valida o corso base non
// si entra in squadra. Un requisito vale fino a tutto il giorno di scadenza.
async function validateTeamMembers(client, usernames) {
    if (!usernames || usernames.length === 0) return [];


    const confRes = await client.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'segreteria_config'");
    if (confRes.rowCount === 0 || !confRes.rows[0].setting_value) return [];
    
    const config = typeof confRes.rows[0].setting_value === 'string' ? JSON.parse(confRes.rows[0].setting_value) : confRes.rows[0].setting_value;
    

    if (!config.enabled || (!config.block_on_medical && !config.block_on_course)) return [];


    const checkQuery = `
        SELECT u.username, u.nome, u.cognome,
            COALESCE((
            SELECT (umr.status = 'Idoneo' AND umr.expiry_date >= CURRENT_DATE) 
            FROM user_medical_records umr 
            JOIN medical_visit_types mvt ON umr.visit_type_id = mvt.id
            WHERE umr.user_id = u.id AND LOWER(mvt.name) = 'visita di idoneità fisica'
            ORDER BY umr.last_visit_date DESC 
            LIMIT 1
        ), FALSE) AS medical_ok,
            COALESCE((SELECT TRUE FROM user_courses uc WHERE uc.user_id = u.id AND uc.course_id = 1 AND (uc.expiry_date IS NULL OR uc.expiry_date >= CURRENT_DATE) LIMIT 1), FALSE) AS course_ok
        FROM users u
        WHERE u.username = ANY($1::text[]) AND u.role != 'esterno'
    `;
    
    const res = await client.query(checkQuery, [usernames]);
    const invalidUsers = [];


    for (const user of res.rows) {
        if (config.block_on_medical && !user.medical_ok) {
            invalidUsers.push(`${user.nome} ${user.cognome} (Visita)`);
        } else if (config.block_on_course && !user.course_ok) {
            invalidUsers.push(`${user.nome} ${user.cognome} (Corso)`);
        }
    }

    return invalidUsers;
}

export function registraRotteSquadre(app) {


    app.get('/api/squadre', async (req, res) => {
        logger.debug(`User ${req.user.id} requesting team list.`);
        try {

            const query = `
            SELECT
                s.id,
                s.nome_radio,
                s.nome,
                (SELECT json_build_object(
                            'report_id', r.id,
                            'emergency_code', e.code,
                            'target_report_progressive_number', r.emergency_report_number, -- <<< AGGIUNTO
                            'target_report_title', r.title                         -- <<< AGGIUNTO
                        )
                   FROM report_team_assignments rta
                   JOIN reports r ON rta.report_id = r.id
                   JOIN emergencies e ON r.emergency_id = e.id
                  WHERE rta.squadra_id = s.id
                    AND r.status = ANY($1::varchar[])
                  LIMIT 1
                ) AS active_target_info,
                COALESCE(
                    json_agg(
                        json_build_object('username', sm.username, 'nome', sm.nome, 'cognome', sm.cognome)
                    ) FILTER (WHERE sm.username IS NOT NULL),
                    '[]'::json
                ) AS membri,
                ps.last_update
            FROM squadre s
            LEFT JOIN squadra_membri sm ON s.id = sm.squadra_id
            LEFT JOIN posizioni_squadre ps ON s.id = ps.squadra_id
            GROUP BY s.id, ps.last_update
            ORDER BY s.nome_radio;
        `;

            const result = await pool.query(query, [ACTIVE_REPORT_STATUSES_BACKEND]);
            logger.debug(`Recuperate ${result.rowCount} squadre con dettagli posizione.`);
            res.status(200).json(result.rows);
        } catch (err) {
            logger.error('Errore GET /api/squadre:', err);
            res.status(500).json({ error: `Errore recupero squadre: ${err.message}` });
        }
    });

    app.get('/api/squadre/disponibili', async (req, res) => {
        logger.debug(`User ${req.user.id} requesting available teams.`);
        try {
            // "Impegnata" come nell'assegnazione: stessa costante degli stati attivi.
            const query = `
            SELECT s.id, s.nome, s.nome_radio
            FROM squadre s
            WHERE NOT EXISTS (
                SELECT 1
                FROM report_team_assignments rta
                JOIN reports r ON rta.report_id = r.id
                WHERE rta.squadra_id = s.id
                  AND r.status = ANY($1::varchar[])
            )
            ORDER BY s.nome;
        `;
            const result = await pool.query(query, [ACTIVE_REPORT_STATUSES_BACKEND]);
            res.status(200).json(result.rows);
        } catch (error) {
            logger.error('Errore recupero squadre disponibili:', error);
            res.status(500).json({ message: 'Errore nel recupero delle squadre disponibili.' });
        }
    });

    app.get('/api/squadre/:id', async (req, res) => { 
        const { id } = req.params;
        const squadraId = parseInt(id, 10);
        if (isNaN(squadraId)) return res.status(400).json({ message: 'ID Squadra non valido'});

        try {
            const squadraQuery = `SELECT id, nome_radio, nome, created_at, target FROM squadre WHERE id = $1`;
            const squadraResult = await pool.query(squadraQuery, [squadraId]);
            if (squadraResult.rowCount === 0) return res.status(404).json({ error: 'Squadra non trovata' });
            const squadra = squadraResult.rows[0];
            const membriQuery = `
            SELECT u.id, u.username, u.nome, u.cognome, u.role,
            -- Conta l'ULTIMA visita di idoneita' fisica, come il tesserino e le
            -- assegnazioni: prima bastava una visita qualsiasi ancora valida, e
            -- chi era stato giudicato non idoneo dopo risultava idoneo qui.
            COALESCE((
                SELECT (umr.status = 'Idoneo' AND umr.expiry_date >= CURRENT_DATE)
                FROM user_medical_records umr
                JOIN medical_visit_types mvt ON umr.visit_type_id = mvt.id
                WHERE umr.user_id = u.id AND LOWER(mvt.name) = 'visita di idoneità fisica'
                ORDER BY umr.last_visit_date DESC
                LIMIT 1
            ), FALSE) AS medical_ok,
            COALESCE((SELECT TRUE FROM user_courses uc WHERE uc.user_id = u.id AND uc.course_id = 1 AND (uc.expiry_date IS NULL OR uc.expiry_date >= CURRENT_DATE) LIMIT 1), FALSE) AS course_ok
            FROM squadra_membri sm
            JOIN users u ON sm.username = u.username 
            WHERE sm.squadra_id = $1
            ORDER BY u.cognome, u.nome;
        `;
            const membriResult = await pool.query(membriQuery, [squadraId]);
            // L'idoneità medica è un dato sanitario: agli esterni no.
            const esterno = ruoliDi(req.user).includes('esterno');
            const membri = membriResult.rows.map(m => ({ 
                 id: m.id,
                 username: m.username, 
                 nome: m.nome,
                 cognome: m.cognome,
                 role: m.role,
                 ...(esterno ? {} : { medical_ok: m.medical_ok, course_ok: m.course_ok })
            }));
            res.json({ squadra, membri });
        } catch (error) {
            logger.error(`Errore GET /api/squadre/${squadraId}:`, error);
            res.status(500).json({ error: 'Errore recupero dettagli squadra.' });
        }
    });

    app.post('/api/squadre', nonEsterni, async (req, res) => {
        const { nome_radio, nome, membri } = req.body; 

        if (!nome_radio || !NOMI_RADIO.includes(nome_radio)) { 
             return res.status(400).json({ error: 'Serve un nome radio valido (Alfa, Bravo, Charlie...).' });
        }
        if (!Array.isArray(membri)) { 
             return res.status(400).json({ error: 'Array membri richiesto.' });
        }
        const nomeDescrittivo = nome ? String(nome).trim() : null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const insertSquadraQuery = `INSERT INTO squadre (nome_radio, nome, created_at) VALUES ($1, $2, NOW()) RETURNING id`;
            const result = await client.query(insertSquadraQuery, [nome_radio, nomeDescrittivo]);
            const squadraId = result.rows[0].id;
            const bloccati = await nomiRadioBloccati(client);
            if (bloccati.has(nome_radio)) {
                throw erroreRichiesta(`Il nome radio ${nome_radio} apparteneva a una squadra sciolta durante questa emergenza e non può essere riassegnato fino alla chiusura: alla radio si farebbe confusione fra due squadre diverse con lo stesso nome.`);
            }
            const membriRisolti = await risolviMembriSquadra(client, membri, null);
            const invalidMembers = await validateTeamMembers(client, membriRisolti.map(m => m.username));
            if (invalidMembers.length > 0) {
                 throw erroreRichiesta(`Vincoli operativi di sicurezza non rispettati per: ${invalidMembers.join(', ')}`);
            }
            const insertMembroQuery = `INSERT INTO squadra_membri (squadra_id, username, nome, cognome) VALUES ($1, $2, $3, $4)`;
            for (const membro of membriRisolti) {
                await client.query(insertMembroQuery, [squadraId, membro.username, membro.nome, membro.cognome]);
            }

            await annotaRegistroSquadre(client, membriRisolti.map(m => ({
                squadra_id: squadraId, nome_radio, squadra_nome: nomeDescrittivo,
                username: m.username, nome: m.nome, cognome: m.cognome,
                azione: 'membro_aggiunto', motivo: 'operazione'
            })), req);

            await client.query('COMMIT');
            res.status(201).json({ message: 'Squadra creata con successo.', squadraId });
            registraAudit(req, 'squadra.creata', { tipo: 'squadra', id: squadraId, dettagli: { nome_radio, nome: nomeDescrittivo, membri: membri.map(m => m.username) } });
            if (typeof wss !== 'undefined' && wss) {
                if (wss.clients && wss.clients instanceof Set) {
                     wss.clients.forEach(client => {
                         if (client.readyState === 1) {
                              try {
                                  const messageToSend = JSON.stringify({ action: 'reload_squadre', createdTeamId: squadraId });
                                  client.send(messageToSend);
                              } catch (sendError) {
                                   logger.error('[WS Send Error] Impossibile inviare a client:', sendError);
                              }
                         }
                     });
                }
            }
        } catch (error) {

            try { await client.query('ROLLBACK'); } catch (rbErr) { logger.error("Errore durante il rollback:", rbErr); }
            logger.error('Errore POST /api/squadre:', error);
            if (error.code === '23505' && error.constraint?.includes('nome_radio')) {
                 return res.status(409).json({ error: `Il nome radio '${nome_radio}' è già assegnato a un'altra squadra.` });
             }
            if (!res.headersSent && error.richiestaNonValida) {
                return res.status(400).json({ error: error.message });
            }
            if (!res.headersSent) {
                res.status(500).json({ error: 'Errore creazione squadra.' });
            } else {
                 logger.error("Errore DOPO invio risposta HTTP, impossibile inviare errore al client.");
            }
        } finally {
            client.release();
        }
    });

    app.put('/api/squadre/:id', nonEsterni, async (req, res) => {
        const { id } = req.params;
        const squadraId = parseInt(id, 10);
        if (isNaN(squadraId)) return res.status(400).json({ message: 'ID Squadra non valido'});
        const { nome_radio, nome, membri } = req.body; 
        if (!nome_radio || !NOMI_RADIO.includes(nome_radio)) {
            return res.status(400).json({ error: 'Serve un nome radio valido (Alfa, Bravo, Charlie...).' });
        }
         if (!Array.isArray(membri)) { 
             return res.status(400).json({ error: 'Array membri richiesto.' });
         }
        const nomeDescrittivo = nome ? String(nome).trim() : null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');


            const esiste = await client.query('SELECT id, nome_radio FROM squadre WHERE id = $1 FOR UPDATE', [squadraId]);
            if (esiste.rowCount === 0) throw erroreNonTrovato('Squadra non trovata.');

            const membriPrima = (await client.query(
                'SELECT username, nome, cognome FROM squadra_membri WHERE squadra_id = $1', [squadraId]
            )).rows;
            // Cambiare nome radio vale come crearne una nuova: stessi blocchi.
            if (nome_radio !== esiste.rows[0].nome_radio) {
                const bloccatiPut = await nomiRadioBloccati(client);
                if (bloccatiPut.has(nome_radio)) {
                    throw erroreRichiesta(`Il nome radio ${nome_radio} apparteneva a una squadra sciolta durante questa emergenza e non può essere riassegnato fino alla chiusura.`);
                }
            }
            if (membri && membri.length > 0) {
                const invalidMembers = await validateTeamMembers(client, membri.map(m => m.username));
                if (invalidMembers.length > 0) {
                     throw erroreRichiesta(`Vincoli operativi di sicurezza non rispettati per: ${invalidMembers.join(', ')}`);
                }
            }

            const membriRisolti = await risolviMembriSquadra(client, membri, squadraId);
            await client.query('UPDATE squadre SET nome_radio = $1, nome = $2 WHERE id = $3', [nome_radio, nomeDescrittivo, squadraId]);

            await client.query('DELETE FROM squadra_membri WHERE squadra_id = $1', [squadraId]);
            if (membriRisolti.length > 0) {
                const insertMembroQuery = `INSERT INTO squadra_membri (squadra_id, username, nome, cognome) VALUES ($1, $2, $3, $4)`;
                for (const membro of membriRisolti) {
                    await client.query(insertMembroQuery, [squadraId, membro.username, membro.nome, membro.cognome]);
                }
            }


            await annotaRegistroSquadre(client, differenzaMembri(
                membriPrima, membriRisolti,
                { squadra_id: squadraId, nome_radio, squadra_nome: nomeDescrittivo }
            ), req);

            await client.query('COMMIT');
            res.status(200).json({ message: 'Squadra aggiornata con successo.' });
            registraAudit(req, 'squadra.modificata', { tipo: 'squadra', id: squadraId, dettagli: { nome_radio, nome: nomeDescrittivo, membri: membri.map(m => m.username) } });
            wss.clients.forEach(client => client.send(JSON.stringify({ action: 'reload_squadre', updatedTeamId: squadraId })));
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error(`Errore PUT /api/squadre/${squadraId}:`, error);
            if (error.code === '23505' && error.constraint?.includes('nome_radio')) {
                 return res.status(409).json({ message: `Il nome radio '${nome_radio}' è già assegnato a un'altra squadra.` });
             }
            if (error.nonTrovato) return res.status(404).json({ message: error.message });
            if (error.richiestaNonValida) return res.status(400).json({ message: error.message });
            res.status(error.message.startsWith('Vincolo violato') ? 409 : 500).json({ message: error.message || 'Errore aggiornamento squadra.' });
        } finally {
            client.release();
        }
    });

    app.delete('/api/squadre/:id', nonEsterni, async (req, res) => {
        const { id } = req.params;
        const squadraId = parseInt(id, 10);
        if (isNaN(squadraId)) return res.status(400).json({ message: 'ID Squadra non valido'});
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const datiSquadra = await client.query('SELECT nome_radio, nome FROM squadre WHERE id = $1 FOR UPDATE', [squadraId]);
            if (datiSquadra.rowCount === 0) throw new Error('Squadra non trovata');
            const { nome_radio: nomeRadio, nome: nomeSquadra } = datiSquadra.rows[0];

            // Una squadra sul posto non si scioglie.
            const impegni = await client.query(`
            SELECT r.emergency_report_number, r.id
            FROM report_team_assignments rta
            JOIN reports r ON r.id = rta.report_id
            WHERE rta.squadra_id = $1 AND r.status = ANY($2::varchar[])
            ORDER BY r.emergency_report_number LIMIT 3
        `, [squadraId, ACTIVE_REPORT_STATUSES_BACKEND]);
            if (impegni.rowCount > 0) {
                const elenco = impegni.rows.map(r => `#${r.emergency_report_number ?? r.id}`).join(', ');
                throw erroreRichiesta(`La squadra ${nomeRadio} è impegnata sulla segnalazione ${elenco}. Liberala dall'intervento prima di eliminarla.`);
            }

            // Le assegnazioni a interventi chiusi se ne vanno con lei: si contano e si dice.
            const storico = await client.query('SELECT COUNT(*)::int AS quante FROM report_team_assignments WHERE squadra_id = $1', [squadraId]);
            const interventiStorici = storico.rows[0].quante;

            // Il registro annota l'uscita dei membri e blocca il nome radio; il
            // materiale in carico si decide riga per riga (beniInUscita.js).
            const beniSistemati = await sistemaBeniInCarico(client, req, 'squadra', squadraId, req.body?.beni);

            const membriUscenti = (await client.query(
                'SELECT username, nome, cognome FROM squadra_membri WHERE squadra_id = $1', [squadraId]
            )).rows;
            const emergenzaInCorso = !!activeEmergency;
            const riferimentoSquadra = { squadra_id: squadraId, nome_radio: nomeRadio, squadra_nome: nomeSquadra };
            await annotaRegistroSquadre(client, [
                ...membriUscenti.map(m => ({ ...riferimentoSquadra, username: m.username, nome: m.nome, cognome: m.cognome, azione: 'membro_rimosso', motivo: 'squadra_eliminata' })),
                { ...riferimentoSquadra, azione: 'squadra_eliminata', motivo: 'squadra_eliminata' }
            ], req);

            await client.query('DELETE FROM report_team_assignments WHERE squadra_id = $1', [squadraId]);
            await client.query('DELETE FROM squadra_membri WHERE squadra_id = $1', [squadraId]);
            const deleteResult = await client.query('DELETE FROM squadre WHERE id = $1', [squadraId]);
            if (deleteResult.rowCount === 0) throw new Error('Squadra non trovata');
            await client.query('COMMIT');
            const avvisoStorico = interventiStorici > 0
                ? ` Con lei sono stati rimossi i collegamenti a ${interventiStorici} intervento/i già chiuso/i: restano nel diario delle segnalazioni e nei resoconti già prodotti.`
                : '';
            const avvisoNomeRadio = emergenzaInCorso
                ? ` Il nome radio ${nomeRadio} resta bloccato fino alla chiusura dell'emergenza.`
                : '';
            const avvisoBeni = beniSistemati.sistemati.length
                ? ` Materiale sistemato: ${beniSistemati.sistemati.map(b => `${b.denominazione} (${b.decisione.replace('_', ' ')})`).join(', ')}.`
                : '';
            res.status(200).json({ message: `Squadra ${nomeRadio} rimossa.${avvisoStorico}${avvisoNomeRadio}${avvisoBeni}`, beni: beniSistemati.sistemati });
            registraAudit(req, 'squadra.eliminata', { tipo: 'squadra', id: squadraId, dettagli: { nome_radio: nomeRadio, nome: nomeSquadra, interventi_storici_rimossi: interventiStorici, beni: beniSistemati.sistemati } });
            wss.clients.forEach(client => client.send(JSON.stringify({ action: 'reload_squadre', deletedTeamId: squadraId })));
        } catch (error) {
            await client.query('ROLLBACK');
            // Con materiale in carico la risposta porta l'elenco da decidere.
            if (error.beniInCarico) {
                logger.warn(`[Magazzino] Scioglimento della squadra ${squadraId} sospeso: ${error.beniInCarico.length} beni da sistemare.`);
                return res.status(409).json({ error: error.message, beni_in_carico: error.beniInCarico });
            }
            logger.error('Errore DELETE /api/squadre/:id:', error);
            const stato = error.message === 'Squadra non trovata' ? 404 : (error.richiestaNonValida ? 409 : 500);
            res.status(stato).json({ error: error.message || 'Errore rimozione squadra.' });
        } finally { client.release(); }
    });

    // Per comporre le squadre, e con l'idoneità medica di tutti: non agli esterni.

    app.get('/api/users/unassigned', nonEsterni, async (req, res) => {
        const client = await pool.connect();
        try {
            const users = await getAvailableUsersQuery(client);
            res.status(200).json(users);
        } catch (error) {
            res.status(500).json({ message: 'Errore nel recupero utenti.' });
        } finally { client.release(); }
    });

    app.get('/api/users/:id', checkAdminRole, async (req, res) => { 
        const userId = parseInt(req.params.id, 10);
        if (isNaN(userId)) return res.status(400).json({ message: 'ID Utente non valido'});
         try {
           const result = await pool.query(`
           SELECT u.id, u.username, u.nome, u.cognome, u.email, u.role,
                  ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli
           FROM users u WHERE u.id = $1`, [userId]);
           if (result.rowCount === 0) return res.status(404).json({ message: 'Utente non trovato' });
           res.json(result.rows[0]);
         } catch (error) { logger.error('Errore GET /api/users/:id:', error); res.status(500).json({ message: 'Errore recupero utente' }); }
    });

    app.get('/api/membri-disponibili/:id', nonEsterni, async (req, res) => {
        const client = await pool.connect();
        try {
            const users = await getAvailableUsersQuery(client);
            res.status(200).json(users);
        } catch (error) {
            res.status(500).json({ error: 'Errore recupero membri' });
        } finally { client.release(); }
    });
}
