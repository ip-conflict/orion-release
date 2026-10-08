// src/emergenze.js
//
// Apertura e chiusura delle emergenze, archivio, documenti ed eventi.

import fs from 'fs';
import logger from './logger.js';
import path from 'path';
import { registraAudit } from './audit.js';
import { authenticateToken, checkAdminRole, chiudiSessioni, haRuolo, nomeUtente, nonEsterni, puoVedereEmergenza, ruoliDi } from './autenticazione.js';
import { haPermesso, richiedePermesso } from './permessi.js';
import { eseguiBackupDatabase } from './backup.js';
import { protectedDocsDir, uploadDocumentMulter, verifyDocumentUpload } from './caricamenti.js';
import { ACTIVE_REPORT_STATUSES_BACKEND } from './costanti.js';
import { pool } from './db.js';
import { chiudiEsterniTemporanei } from './esterniTemporanei.js';
import { beniInCarico } from './magazzino.js';
import { uploadLimiter } from './middleware/rateLimiters.js';
import { CARTELLA_RESOCONTI, componiResocontoEmergenza, salvaResocontoEmergenza } from './resoconto.js';
import { annotaRegistroSquadre, avvisaEntratiInSquadra } from './squadre.js';
import { registraPresenzeEmergenza, registraPresenzeSimulazione } from './presenze.js';
import { activeEmergency, impostaEmergenzaAttiva } from './statoEmergenza.js';
import { avvisaClienti, notifiche, wss } from './tempoReale.js';
import { fileURLToPath } from 'url';
import { inviaFile, leggiFile, proteggiCaricati } from './cifratura.js';
import { sigillaChiusura } from './integrita.js';
import { copiaCopione, copioniDisponibili } from './copione.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Alla chiusura le squadre rimaste vuote si chiudono d'ufficio, tranne quelle
// con materiale in carico: lì decide una persona.
// La squadra COC finisce con l'emergenza: i suoi membri sono già usciti nel
// registro alla chiusura, qui si scioglie.
async function sciogliSquadraCoc(emergencyId, req) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const coc = (await client.query('SELECT id, nome_radio, nome FROM squadre WHERE coc FOR UPDATE')).rows;
        for (const s of coc) {
            await annotaRegistroSquadre(client, [{
                squadra_id: s.id, nome_radio: s.nome_radio, squadra_nome: s.nome,
                azione: 'squadra_eliminata', motivo: 'chiusura_emergenza'
            }], req, emergencyId);
            await client.query('DELETE FROM squadra_membri WHERE squadra_id = $1', [s.id]);
            await client.query('DELETE FROM squadre WHERE id = $1', [s.id]);
        }
        await client.query('COMMIT');
        if (coc.length) avvisaClienti('reload_squadre');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[Squadre] Scioglimento della squadra COC non riuscito:', e);
    } finally {
        client.release();
    }
}

async function chiudiSquadreVuote(emergencyId, req) {
    const { rows } = await pool.query(`
        SELECT s.id, s.nome_radio, s.nome FROM squadre s
        WHERE NOT s.coc AND NOT EXISTS (SELECT 1 FROM squadra_membri sm WHERE sm.squadra_id = s.id)`);
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

// La sala di una simulazione si apre al più tre ore prima dell'inizio.
const ORE_PRIMA_SALA = 3;

// Un errore con il suo stato HTTP, per apriEmergenza e chiudiEmergenza.
class ErroreEmergenza extends Error {
    constructor(stato, message, extra = {}) {
        super(message);
        this.stato = stato;
        this.extra = extra;
    }
}

// Chi conduce una simulazione: chi organizza le attività, il responsabile, la regia.
async function conduceSimulazione(req, attivitaId) {
    if (!attivitaId || ruoliDi(req.user).includes('esterno')) return false;
    if (haPermesso(req, 'gruppo.attivita')) return true;
    const r = await pool.query(
        `SELECT 1 FROM attivita a WHERE a.id = $1 AND (a.responsabile_id = $2
            OR EXISTS (SELECT 1 FROM attivita_regia g WHERE g.attivita_id = a.id AND g.user_id = $2))`, [attivitaId, req.user.id]);
    return r.rowCount > 0;
}

function annunciaStatoEmergenza() {
    const stato = activeEmergency ? { active: true, emergency: activeEmergency } : { active: false, emergency: null };
    wss.clients.forEach(wsClient => {
        if (wsClient.readyState === 1) {
            try { wsClient.send(JSON.stringify({ action: 'emergency_status_change', status: stato })); } catch { /* il client si riconnette */ }
        }
    });
}

// Apre un'emergenza, vera o simulata. Lancia ErroreEmergenza se ce n'è già una.
export async function apriEmergenza(req, { codice, nome = null, azzeraSquadre = false, simulazione = false, attivitaId = null }) {
    if (activeEmergency) throw new ErroreEmergenza(409, `Un'emergenza (${activeEmergency.code}) è già aperta.`);
    const client = await pool.connect();
    let nuova, squadreSciolte = 0, membriEreditati = [];
    try {
        await client.query('BEGIN');
        if (azzeraSquadre) {
            const daSciogliere = await client.query('SELECT id FROM squadre');
            squadreSciolte = daSciogliere.rowCount;
            // Le assegnazioni delle emergenze passate restano, con il nome
            // radio di allora: il database mette squadra_id a NULL.
            await client.query('DELETE FROM squadra_membri');
            await client.query('DELETE FROM squadre');
        }
        nuova = (await client.query(
            `INSERT INTO emergencies (code, name, status, start_time, simulazione, attivita_id)
             VALUES ($1, $2, 'ACTIVE', NOW(), $3, $4) RETURNING *`,
            [codice, nome, simulazione, attivitaId])).rows[0];

        // La squadra della sala: niente nome radio vero, niente posizione,
        // niente interventi. Chi lavora in sala ci entra e risulta presente.
        // Una rimasta da prima (una simulazione interrotta) si riusa.
        const gia = await client.query('SELECT id FROM squadre WHERE coc LIMIT 1');
        if (!gia.rowCount) {
            await client.query(
                "INSERT INTO squadre (nome_radio, nome, coc, created_at) VALUES ('COC', 'Sala operativa', true, NOW()) ON CONFLICT (nome_radio) DO NOTHING");
        }

        membriEreditati = (await client.query(`
            SELECT sm.username, sm.nome, sm.cognome, sm.caposquadra, s.id AS squadra_id, s.nome_radio, s.nome AS squadra_nome
            FROM squadra_membri sm JOIN squadre s ON s.id = sm.squadra_id
            ORDER BY s.nome_radio, sm.cognome`)).rows;
        const voce = (m, azione) => ({
            squadra_id: m.squadra_id, nome_radio: m.nome_radio, squadra_nome: m.squadra_nome,
            username: m.username, nome: m.nome, cognome: m.cognome,
            azione, motivo: 'apertura_emergenza'
        });
        await annotaRegistroSquadre(client, [
            ...membriEreditati.map(m => voce(m, 'membro_aggiunto')),
            ...membriEreditati.filter(m => m.caposquadra).map(m => voce(m, 'caposquadra_nominato'))
        ], req, nuova.id);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }

    // Solo dopo il COMMIT.
    impostaEmergenzaAttiva({
        id: nuova.id, code: nuova.code, name: nuova.name, start_time: nuova.start_time,
        simulazione: nuova.simulazione === true, attivita_id: nuova.attivita_id ?? null
    });
    logger.info(`${simulazione ? 'SIMULAZIONE' : 'EMERGENZA'} APERTA: ID=${activeEmergency.id}, Code=${activeEmergency.code}`);
    // Nessun avviso a tutti: lo riceve solo chi è già in una squadra,
    // perché le squadre preparate prima entrano nell'emergenza. Gli
    // altri lo ricevono quando il centro operativo li mette in squadra.
    const aperta = activeEmergency;
    (async () => {
        const perSquadra = new Map();
        for (const m of membriEreditati) {
            if (!perSquadra.has(m.squadra_id)) perSquadra.set(m.squadra_id, { squadra: { id: m.squadra_id, nome_radio: m.nome_radio, nome: m.squadra_nome }, membri: [] });
            perSquadra.get(m.squadra_id).membri.push(m.username);
        }
        for (const { squadra, membri } of perSquadra.values()) await avvisaEntratiInSquadra(membri, [], squadra, aperta);
    })().catch(e => logger.error("[Notifiche] Avviso alle squadre all'apertura non riuscito:", e));
    registraAudit(req, 'emergenza.aperta', {
        tipo: 'emergenza', id: nuova.id,
        dettagli: { codice: nuova.code, nome: nuova.name, simulazione, attivita: attivitaId, squadre_sciolte: squadreSciolte, volontari_ereditati: membriEreditati.length }
    });
    annunciaStatoEmergenza();
    return {
        emergency: activeEmergency,
        squadre_sciolte: squadreSciolte,
        squadre_ereditate: new Set(membriEreditati.map(m => m.squadra_id)).size,
        volontari_ereditati: membriEreditati.length
    };
}

// Chiude l'emergenza aperta. [tieni]: gli id di strade chiuse e zone che
// restano in vigore (una simulazione non ne lascia nessuna). [interrotta]: una
// simulazione fermata da un'emergenza vera che si apre subito dopo: la sala e
// le squadre restano per quella.
export async function chiudiEmergenza(req, { tieni = null, interrotta = false } = {}) {
    if (!activeEmergency) throw new ErroreEmergenza(400, 'Nessuna emergenza attiva da chiudere.');
    const chiusa = { ...activeEmergency };
    const simulazione = chiusa.simulazione === true;
    const client = await pool.connect();
    let segnalazioniChiuse = 0, temporaneiChiusi = [];
    try {
        await client.query('BEGIN');
        const r = await client.query(
            `UPDATE reports SET status = 'Closed', updated_at = NOW()
              WHERE emergency_id = $1 AND status = ANY($2::varchar[])`, [chiusa.id, ACTIVE_REPORT_STATUSES_BACKEND]);
        segnalazioniChiuse = r.rowCount;
        logger.info(`[DB] Chiusura automatica per ${segnalazioniChiuse} segnalazioni associate all'emergenza ${chiusa.id}.`);
        // Nel registro tutti escono dalle squadre: l'impiego finisce qui.
        const membriInForza = (await client.query(`
            SELECT sm.username, sm.nome, sm.cognome, s.id AS squadra_id, s.nome_radio, s.nome AS squadra_nome
            FROM squadra_membri sm JOIN squadre s ON s.id = sm.squadra_id
            ORDER BY s.nome_radio, sm.cognome`)).rows;
        await annotaRegistroSquadre(client, membriInForza.map(m => ({
            squadra_id: m.squadra_id, nome_radio: m.nome_radio, squadra_nome: m.squadra_nome,
            username: m.username, nome: m.nome, cognome: m.cognome,
            azione: 'membro_rimosso', motivo: 'chiusura_emergenza'
        })), req, chiusa.id);

        temporaneiChiusi = await chiudiEsterniTemporanei(client, chiusa.id);

        // Strade chiuse e zone interdette ancora in vigore: restano sulla
        // mappa quelle indicate, le altre finiscono con l'emergenza. Senza
        // l'elenco resta quello già segnato. Quelle simulate finiscono tutte.
        const daTenere = simulazione ? [] : tieni;
        if (daTenere) {
            const t = await client.query(
                `UPDATE elementi_mappa SET oltre_emergenza = (id = ANY($2::int[]))
                  WHERE emergency_id = $1 AND rimosso_il IS NULL AND tipo IN ('strada_chiusa', 'zona_interdetta')
                  RETURNING id, tipo, nome, oltre_emergenza`, [chiusa.id, daTenere]);
            const tenute = t.rows.filter(x => x.oltre_emergenza);
            if (tenute.length) logger.info(`[Mappa] Restano in vigore dopo la chiusura: ${tenute.map(x => x.nome || x.tipo).join(', ')}.`);
        }

        const fatto = await client.query(
            `UPDATE emergencies SET status = 'CLOSED', end_time = NOW(), interrotta_il = CASE WHEN $2 THEN NOW() END
              WHERE id = $1 AND status = 'ACTIVE' RETURNING id`, [chiusa.id, interrotta]);
        if (fatto.rowCount === 0) throw new Error(`Emergenza ID ${chiusa.id} non trovata o non più attiva nel DB.`);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }

    impostaEmergenzaAttiva(null);
    for (const id of temporaneiChiusi) await chiudiSessioni(id).catch(e => logger.error('Chiusura sessioni temporanee:', e));
    await notifiche.scadi({ categoria: 'emergenza' });
    // Le presenze dal registro delle squadre, prima del resoconto e del backup:
    // di una simulazione vanno all'attività del calendario.
    if (simulazione && chiusa.attivita_id) {
        await registraPresenzeSimulazione(chiusa.id, chiusa.attivita_id, req).catch(e => logger.error('[Presenze] Presenze della simulazione non registrate:', e));
    } else {
        await registraPresenzeEmergenza(chiusa.id, req).catch(e => logger.error('[Presenze] Presenze dell\'emergenza non registrate:', e));
    }
    avvisaClienti?.('reload_mappa');
    if (temporaneiChiusi.length) logger.info(`[Esterni temporanei] Chiusi ${temporaneiChiusi.length} accessi con l'emergenza.`);
    logger.info(`${simulazione ? 'SIMULAZIONE' : 'EMERGENZA'} CHIUSA: ID=${chiusa.id}, Code=${chiusa.code}${interrotta ? ' (interrotta)' : ''}`);

    // Il sigillo dello storico a emergenza chiusa: torna qui, per mostrarlo
    // e copiarlo, e parte per email agli amministratori.
    let sigillo = null;
    try {
        sigillo = await sigillaChiusura({ id: chiusa.id, code: chiusa.code, name: chiusa.name });
    } catch (e) {
        logger.error('[Integrità] Sigillo di chiusura non preso:', e);
    }
    registraAudit(req, 'emergenza.chiusa', { tipo: 'emergenza', id: chiusa.id, dettagli: { codice: chiusa.code, segnalazioni_chiuse: segnalazioniChiuse, simulazione, interrotta } });

    // Interrotta, il resoconto aspetta l'emergenza vera, che deve nominare:
    // lo fa partire chi l'ha aperta.
    if (!interrotta) completaChiusura(chiusa, req, false);
    annunciaStatoEmergenza();
    return { chiusa, sigillo, segnalazioni_chiuse: segnalazioniChiuse };
}

// Dopo la chiusura: prima il resoconto, poi il backup, che così lo contiene.
function completaChiusura(chiusa, req, interrotta) {
    const simulazione = chiusa.simulazione === true;
    salvaResocontoEmergenza(chiusa.id, req.user.username)
        .then(async nomeFile => {
            if (nomeFile) registraAudit(req, 'emergenza.resoconto_generato', { tipo: 'emergenza', id: chiusa.id, dettagli: { file: nomeFile } });
            // Dopo il resoconto, che deve ancora vederle. Interrotta da
            // un'emergenza vera, sala e squadre servono a quella.
            if (!interrotta) {
                await sciogliSquadraCoc(chiusa.id, req);
                await chiudiSquadreVuote(chiusa.id, req).catch(e => logger.error('[Squadre] Chiusura delle squadre vuote non riuscita:', e));
            }
            return eseguiBackupDatabase(`${simulazione ? 'simulazione' : 'emergenza'}-${chiusa.code}`.replace(/[^A-Za-z0-9_-]/g, '_'));
        })
        .then(percorso => {
            if (percorso) registraAudit(req, 'backup.eseguito', { tipo: 'emergenza', id: chiusa.id, dettagli: { motivo: 'chiusura emergenza', file: path.basename(percorso) } });
        })
        .catch(e => logger.error('[Chiusura] Resoconto o backup non riusciti:', e));
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
            // Di un'emergenza chiusa solo chi consulta le emergenze passate.
            const r = await pool.query('SELECT emergency_id FROM emergency_documents WHERE file_path = $1 LIMIT 1',
                [`/uploads/documents/${req.params.filename}`]);
            if (r.rowCount === 0 ? !haPermesso(req, 'emergenze.archivio') : !puoVedereEmergenza(req, r.rows[0].emergency_id)) {
                return res.status(403).json({ message: "Documento di un'emergenza chiusa: riservato all'amministratore." });
            }
        } catch (error) {
            logger.error('Errore controllo accesso documento:', error);
            return res.status(500).json({ message: 'Errore interno.' });
        }
        inviaFile(res, safePath);
    });


    app.get('/api/emergencies/status', (req, res) => {
        if (activeEmergency) {
             res.status(200).json({ active: true, emergency: activeEmergency });
        } else {
             res.status(200).json({ active: false, emergency: null });
        }
    });

    app.post('/api/emergencies/open', richiedePermesso('emergenze.apertura'), async (req, res) => {
        // azzera_squadre: si sciolgono le squadre di prima. Se restano, i loro
        // membri risultano entrati all'apertura.
        // interrompi_simulazione: c'è una simulazione in sala e arriva
        // un'emergenza vera. La simulazione si chiude come interrotta e le
        // squadre restano come sono: la gente è già in sala.
        const { external_code, name, azzera_squadre, interrompi_simulazione } = req.body;
        if (!external_code || String(external_code).trim() === '') {
            return res.status(400).json({ message: 'Il codice emergenza esterno è obbligatorio.' });
        }
        if (activeEmergency && !(activeEmergency.simulazione && interrompi_simulazione === true)) {
            return activeEmergency.simulazione
                ? res.status(409).json({ message: `È in corso la simulazione ${activeEmergency.code}: per aprire un'emergenza vera va interrotta.`, simulazione_in_corso: true, emergency: activeEmergency })
                : res.status(409).json({ message: `Un'emergenza (ID: ${activeEmergency.id}, Codice: ${activeEmergency.code}) è già attiva.` });
        }
        try {
            let interrotta = null;
            if (activeEmergency?.simulazione) {
                logger.warn(`[Simulazione] ${req.user.username} interrompe la simulazione ${activeEmergency.code} per un'emergenza vera.`);
                interrotta = await chiudiEmergenza(req, { interrotta: true });
            }
            const esito = await apriEmergenza(req, {
                codice: String(external_code).trim().toUpperCase(),
                nome: name ? String(name).trim() : null,
                azzeraSquadre: !interrotta && azzera_squadre === true
            });
            if (interrotta) {
                await pool.query('UPDATE emergencies SET interrotta_da = $2 WHERE id = $1', [interrotta.chiusa.id, esito.emergency.id]);
                completaChiusura(interrotta.chiusa, req, true);
                registraAudit(req, 'simulazione.interrotta', { tipo: 'emergenza', id: interrotta.chiusa.id, dettagli: { simulazione: interrotta.chiusa.code, emergenza: esito.emergency.code } });
            }
            res.status(201).json({
                message: 'Emergenza aperta con successo.', ...esito,
                simulazione_interrotta: interrotta ? { id: interrotta.chiusa.id, codice: interrotta.chiusa.code } : null
            });
        } catch (e) {
            if (e instanceof ErroreEmergenza) return res.status(e.stato).json({ message: e.message, ...e.extra });
            logger.error('Errore apertura emergenza:', e);
            res.status(500).json({ message: "Errore interno durante l'apertura dell'emergenza." });
        }
    });

    // Chiude l'emergenza aperta: chi apre le emergenze; una simulazione anche
    // chi la conduce (chi organizza le attività, il responsabile, la regia).
    app.post('/api/emergencies/close', async (req, res) => {
        if (!activeEmergency) return res.status(400).json({ message: 'Nessuna emergenza attiva da chiudere.' });
        const puo = haPermesso(req, 'emergenze.apertura')
            || (activeEmergency.simulazione && await conduceSimulazione(req, activeEmergency.attivita_id));
        if (!puo) return res.status(403).json({ message: 'Ti serve il permesso "Aprire e chiudere le emergenze".' });
        logger.info(`${req.user.username} sta chiudendo emergenza ID=${activeEmergency.id}, Code=${activeEmergency.code}`);
        try {
            const esito = await chiudiEmergenza(req, {
                tieni: Array.isArray(req.body?.tieni_in_vigore) ? req.body.tieni_in_vigore.map(Number).filter(Number.isInteger) : null
            });
            res.status(200).json({ message: `Emergenza '${esito.chiusa.code}' chiusa con successo.`, sigillo: esito.sigillo });
        } catch (e) {
            if (e instanceof ErroreEmergenza) return res.status(e.stato).json({ message: e.message, ...e.extra });
            logger.error('Errore chiusura emergenza:', e);
            res.status(500).json({ message: 'Errore interno chiusura emergenza.' });
        }
    });

    // Aprire la sala di una simulazione: dall'attività del calendario, il giorno
    // stesso. Chi la conduce, anche senza il permesso delle emergenze vere.
    app.post('/api/attivita/:id/apri-sala', nonEsterni, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Attività non valida.' });
        try {
            const a = (await pool.query(
                `SELECT a.id, a.titolo, a.stato, a.simulazione, a.inizio, a.fine FROM attivita a WHERE a.id = $1`, [id])).rows[0];
            if (!a) return res.status(404).json({ message: 'Attività non trovata.' });
            if (!(await conduceSimulazione(req, id))) return res.status(403).json({ message: 'La sala la apre chi conduce la simulazione.' });
            if (a.simulazione !== 'sala') return res.status(409).json({ message: "Questa attività non ha la simulazione in sala." });
            if (a.stato !== 'programmata') return res.status(409).json({ message: "L'attività è conclusa o annullata." });
            const ora = Date.now();
            const inizio = new Date(String(a.inizio).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).getTime();
            const fine = new Date(String(a.fine).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).getTime();
            if (ora < inizio - ORE_PRIMA_SALA * 3600000 || ora > fine) {
                return res.status(409).json({ message: `La sala si apre durante l'attività, o fino a ${ORE_PRIMA_SALA} ore prima dell'inizio.` });
            }
            if (activeEmergency) {
                return res.status(409).json({ message: activeEmergency.simulazione ? `È già aperta la simulazione ${activeEmergency.code}.` : "C'è un'emergenza vera aperta: la simulazione aspetta." });
            }
            const giorno = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'Europe/Rome' }).format(new Date()).replace(/-/g, '');
            const esito = await apriEmergenza(req, {
                codice: `SIM-${giorno}-${id}`, nome: a.titolo,
                azzeraSquadre: req.body?.azzera_squadre === true, simulazione: true, attivitaId: id
            });
            registraAudit(req, 'simulazione.aperta', { tipo: 'attivita', id, dettagli: { emergenza: esito.emergency.id, codice: esito.emergency.code } });
            res.status(201).json(esito);
        } catch (e) {
            if (e instanceof ErroreEmergenza) return res.status(e.stato).json({ message: e.message, ...e.extra });
            logger.error('Errore POST /api/attivita/:id/apri-sala:', e);
            res.status(500).json({ message: 'Errore nell\'aprire la sala.' });
        }
    });

    // La simulazione al volo, dal centro operativo: un'attività che comincia
    // adesso (addestramento o esercitazione, con chi la apre come responsabile
    // e regia), il copione di una vecchia se si vuole, e la sala aperta subito.
    // Niente convocazioni: chi serve si chiama con la chiamata dei volontari.
    const apreAlVolo = (req) => haPermesso(req, 'emergenze.apertura', 'gruppo.attivita');

    app.get('/api/simulazioni/copioni', nonEsterni, async (req, res) => {
        if (!apreAlVolo(req)) return res.status(403).json({ message: 'Una simulazione la apre chi apre le emergenze o organizza le attività.' });
        try {
            res.json(await copioniDisponibili(req));
        } catch (e) {
            logger.error('Errore GET /api/simulazioni/copioni:', e);
            res.status(500).json({ message: 'Errore nel leggere i copioni.' });
        }
    });

    app.post('/api/simulazioni/al-volo', nonEsterni, async (req, res) => {
        if (!apreAlVolo(req)) return res.status(403).json({ message: 'Una simulazione la apre chi apre le emergenze o organizza le attività.' });
        const corpo = req.body || {};
        const natura = corpo.natura === 'esercitazione' ? 'esercitazione' : 'addestramento';
        const ore = Number(corpo.ore ?? 3);
        if (!Number.isInteger(ore) || ore < 1 || ore > 24) return res.status(400).json({ message: 'La durata va da 1 a 24 ore.' });
        const titolo = typeof corpo.titolo === 'string' ? corpo.titolo.trim().slice(0, 200) : '';
        const scenario = typeof corpo.scenario === 'string' && corpo.scenario.trim() ? corpo.scenario.trim().slice(0, 4000) : null;
        const copiaDa = corpo.copia_da === undefined || corpo.copia_da === null || corpo.copia_da === '' ? null : Number(corpo.copia_da);
        if (copiaDa !== null && !Number.isInteger(copiaDa)) return res.status(400).json({ message: 'Copione non valido.' });
        if (activeEmergency) {
            return res.status(409).json({ message: activeEmergency.simulazione ? `È già aperta la simulazione ${activeEmergency.code}.` : "C'è un'emergenza vera aperta: la simulazione aspetta." });
        }
        let attivitaId = null;
        const client = await pool.connect();
        try {
            if (copiaDa !== null && !(await copioniDisponibili(req)).some(c => c.id === copiaDa)) {
                return res.status(403).json({ message: 'Si parte dal copione di un\'attività di cui si fa la regia.' });
            }
            const tipo = (await client.query(
                `SELECT id, nome FROM attivita_tipi WHERE natura = $1 AND attivo ORDER BY (nome ILIKE $1) DESC, ordine, id LIMIT 1`, [natura])).rows[0];
            if (!tipo) return res.status(409).json({ message: `Non c'è nessun tipo di attività di natura ${natura}: crealo nel calendario.` });
            const quando = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', timeZone: process.env.TZ || 'Europe/Rome' }).format(new Date());
            await client.query('BEGIN');
            attivitaId = (await client.query(
                `INSERT INTO attivita (tipo_id, titolo, inizio, fine, convocazione, avviso_app, avviso_email, responsabile_id, creato_da, simulazione, scenario)
                 VALUES ($1, $2, NOW(), NOW() + ($3::int * INTERVAL '1 hour'), 'scelti', false, false, $4, $4, 'sala', $5) RETURNING id`,
                [tipo.id, titolo || `${tipo.nome} del ${quando}`, ore, req.user.id, scenario])).rows[0].id;
            const copiati = copiaDa !== null ? await copiaCopione(client, copiaDa, attivitaId) : 0;
            await client.query('COMMIT');
            const giorno = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'Europe/Rome' }).format(new Date()).replace(/-/g, '');
            const esito = await apriEmergenza(req, {
                codice: `SIM-${giorno}-${attivitaId}`, nome: titolo || `${tipo.nome} del ${quando}`,
                azzeraSquadre: corpo.azzera_squadre === true, simulazione: true, attivitaId
            });
            registraAudit(req, 'simulazione.aperta', { tipo: 'attivita', id: attivitaId, dettagli: { emergenza: esito.emergency.id, codice: esito.emergency.code, al_volo: true, copiati } });
            res.status(201).json({ ...esito, attivita_id: attivitaId, copiati });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            // La sala non si è aperta: l'attività appena creata non resta a metà.
            if (attivitaId) await pool.query("DELETE FROM attivita WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM emergencies WHERE attivita_id = $1)", [attivitaId]).catch(() => {});
            if (e instanceof ErroreEmergenza) return res.status(e.stato).json({ message: e.message, ...e.extra });
            logger.error('Errore POST /api/simulazioni/al-volo:', e);
            res.status(500).json({ message: 'Errore nell\'aprire la simulazione.' });
        } finally {
            client.release();
        }
    });

    app.get('/api/admin/emergencies/closed', richiedePermesso('emergenze.archivio'), async (req, res) => {
        logger.debug(`Admin ${req.user.username} richiede lista emergenze chiuse.`);
        try {
            const result = await pool.query(
                `SELECT e.id, e.code, e.name, e.start_time, e.end_time, e.log_file_path, e.log_generated_at,
                        e.simulazione, e.attivita_id, a.titolo AS attivita_titolo, e.interrotta_il, v.code AS interrotta_da_codice
                   FROM emergencies e LEFT JOIN attivita a ON a.id = e.attivita_id LEFT JOIN emergencies v ON v.id = e.interrotta_da
                  WHERE e.status = 'CLOSED' ORDER BY e.end_time DESC, e.start_time DESC`
            );
            res.status(200).json(result.rows);
        } catch (error) {
            logger.error('Errore GET /api/admin/emergencies/closed:', error);
            res.status(500).json({ message: 'Errore nel recupero delle emergenze archiviate.' });
        }
    });

    // Il resoconto di un'emergenza archiviata; se il file manca si rigenera.
    app.get('/api/admin/emergencies/:id/resoconto', richiedePermesso('emergenze.archivio'), async (req, res) => {
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
                    const contenuto = await leggiFile(percorso);
                    registraAudit(req, 'emergenza.resoconto_scaricato', { tipo: 'emergenza', id: emergencyId, dettagli: { file: path.basename(nomeFile) } });
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.setHeader('Content-Disposition', `attachment; filename="resoconto_${codiceSicuro}.txt"`);
                    return res.send(contenuto);
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
                "SELECT code, name, start_time, end_time, status, log_file_path FROM emergencies WHERE id = $1 FOR UPDATE",
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


            // Lo storico è inalterabile, ma un'emergenza archiviata si può
            // togliere per fare spazio: prima si sigilla tutto quello che
            // c'è, poi si dichiara al database la cancellazione (solo per
            // questa transazione), e la catena registra quali righe sono
            // uscite, quando e per mano di chi. La verifica non le conta
            // come mancanti; chi conserva un sigillo di prima sa che c'erano.
            await client.query('SELECT orion_sigilla()');
            const righeTolte = (await client.query(
                `SELECT jsonb_build_object(
                    'report_updates', COALESCE((SELECT jsonb_agg(u.id ORDER BY u.id) FROM report_updates u JOIN reports r ON r.id = u.report_id WHERE r.emergency_id = $1), '[]'::jsonb),
                    'diario_sala', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM diario_sala WHERE emergency_id = $1), '[]'::jsonb),
                    'emergency_team_log', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM emergency_team_log WHERE emergency_id = $1), '[]'::jsonb)
                 ) AS righe`, [emergencyId])).rows[0].righe;
            await client.query("SELECT set_config('orion.cancellazione_emergenza', $1, true)", [String(emergencyId)]);

            // Le strade ancora chiuse oltre l'emergenza restano sulla mappa:
            // si staccano dall'emergenza che se ne va.
            await client.query(
                'UPDATE elementi_mappa SET emergency_id = NULL WHERE emergency_id = $1 AND oltre_emergenza AND rimosso_il IS NULL', [emergencyId]);

            logger.debug(`[Delete EMG ${emergencyId}] Eseguo DELETE su emergencies...`);
            const deleteResult = await client.query('DELETE FROM emergencies WHERE id = $1', [emergencyId]);
            const e0 = emergencyCheck.rows[0];
            await client.query('SELECT orion_annota_evento($1, $2::jsonb)', ['cancellazione_emergenza', JSON.stringify({
                emergenza: { id: emergencyId, codice: e0.code, nome: e0.name, inizio: e0.start_time, fine: e0.end_time },
                eseguita_da: nomeUtente(req.user),
                righe: righeTolte
            })]);
            await client.query("SELECT set_config('orion.cancellazione_emergenza', '', true)");

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
        await proteggiCaricati(req.file);

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
