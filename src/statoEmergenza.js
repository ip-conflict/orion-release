import logger from './logger.js';
import { pool } from './db.js';

export let activeEmergency = null;

export function impostaEmergenzaAttiva(emergenza) {
    activeEmergency = emergenza;
}

export async function loadActiveEmergency() {
    logger.debug("Controllo emergenza attiva all'avvio...");
    try {
        const result = await pool.query(
            "SELECT id, code, name, start_time, simulazione, attivita_id FROM emergencies WHERE status = 'ACTIVE' ORDER BY start_time DESC LIMIT 1;"
        );
        if (result.rowCount > 0) {
            activeEmergency = result.rows[0];
            logger.debug(`Emergenza attiva caricata: ID=${activeEmergency.id}, Code=${activeEmergency.code}`);
        } else {
            activeEmergency = null;
            logger.debug("Nessuna emergenza attiva trovata.");
        }
    } catch (error) {
        logger.error("Errore caricamento emergenza attiva:", error);
        activeEmergency = null;
    }
}

// Senza il blocco sulla riga dell'emergenza due creazioni insieme leggono lo stesso massimo e
// prendono lo stesso numero; dura fino al COMMIT. NO KEY: FOR UPDATE va in stallo con le
// transazioni che hanno già scritto una riga che rimanda all'emergenza (la regia lo fa).
export async function prossimoNumeroSegnalazione(client, emergenzaId) {
    await client.query('SELECT id FROM emergencies WHERE id = $1 FOR NO KEY UPDATE', [emergenzaId]);
    const { rows } = await client.query(
        'SELECT COALESCE(MAX(emergency_report_number), 0) + 1 AS n FROM reports WHERE emergency_id = $1', [emergenzaId]);
    return rows[0].n;
}
