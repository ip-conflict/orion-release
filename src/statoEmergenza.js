// src/statoEmergenza.js
//
// L'emergenza aperta, tenuta in memoria: la leggono quasi tutte le rotte.

import logger from './logger.js';
import { pool } from './db.js';

export let activeEmergency = null;

export function impostaEmergenzaAttiva(emergenza) {
    activeEmergency = emergenza;
}

// All'avvio: l'emergenza rimasta aperta prima del riavvio.
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
