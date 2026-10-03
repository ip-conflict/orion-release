// src/audit.js
//
// Il registro delle operazioni: chi ha modificato o eliminato dati condivisi.
// Se la scrittura fallisce lo si annota nel log, ma l'operazione dell'utente,
// già fatta, non fallisce per questo.

import logger from './logger.js';
import { pool } from './db.js';

export async function registraAudit(req, azione, { tipo = null, id = null, dettagli = null } = {}) {
    try {
        await pool.query(
            `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                req?.user?.id ?? null,
                req?.user?.username ?? null,
                azione,
                tipo,
                id === null || id === undefined ? null : String(id),
                dettagli ? JSON.stringify(dettagli) : null,
                req?.ip ?? null
            ]
        );
    } catch (error) {
        logger.error(`[Audit] Impossibile registrare l'operazione '${azione}':`, { error });
    }
}
