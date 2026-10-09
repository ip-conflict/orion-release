// La versione in vigore delle condizioni d'uso, tenuta in memoria: il controllo
// d'accesso la confronta a ogni richiesta con quella accettata dall'utente.

import logger from './logger.js';
import { pool } from './db.js';

export let versioneInformativa = 1;

export function impostaVersioneInformativa(versione) {
    versioneInformativa = versione;
}

export async function caricaVersioneInformativa() {
    try {
        const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'privacy_versione'");
        versioneInformativa = Number(r.rows[0]?.setting_value) || 1;
    } catch (e) {
        logger.error('Versione dell\'informativa non letta, resta la 1:', e);
    }
}

// Le richieste che si fanno anche prima di accettare: leggere il testo,
// accettarlo, uscire. La pagina del testo è pubblica.
export function esenteDaPresaVisione(percorso) {
    return percorso === '/api/informativa' || percorso === '/api/informativa/presa-visione'
        || percorso === '/logout' || percorso === '/informativa.html';
}
