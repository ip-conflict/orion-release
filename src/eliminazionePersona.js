// Chi compare nello storico resta con nome, cognome e nome utente, il resto si cancella;
// chi non compare si cancella del tutto. Vedi il manuale tecnico.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARTELLE = {
    '/api/photos/': path.join(RADICE, 'uploads', 'photos'),
    '/api/documents/certificates/': path.join(RADICE, 'protected_uploads', 'certificates')
};

// Solo dentro le cartelle note.
function fileDi(url) {
    for (const [prefisso, cartella] of Object.entries(CARTELLE)) {
        if (typeof url !== 'string' || !url.startsWith(prefisso)) continue;
        const percorso = path.resolve(cartella, path.basename(url.slice(prefisso.length)));
        if (percorso.startsWith(cartella + path.sep)) return percorso;
    }
    return null;
}

export async function fileDellaPersona(client, id) {
    const r = await client.query(
        `SELECT photo_url AS url FROM users WHERE id = $1
         UNION ALL SELECT document_url FROM user_medical_records WHERE user_id = $1
         UNION ALL SELECT document_url FROM user_courses WHERE user_id = $1`, [id]);
    return r.rows.map(x => fileDi(x.url)).filter(Boolean);
}

export const fileDaIndirizzi = (indirizzi) => indirizzi.map(fileDi).filter(Boolean);

// Un file che non si riesce a togliere resta nel log, ma non blocca l'eliminazione.
export async function cancellaFile(percorsi) {
    for (const p of percorsi) {
        await fs.promises.unlink(p).catch(e => { if (e.code !== 'ENOENT') logger.error(`File di una persona eliminata non cancellato: ${p}`, e); });
    }
}

export async function pseudonimizza(client, id) {
    for (const tabella of ['user_medical_records', 'user_courses', 'utenti_ruoli', 'token_rinnovo', 'token_avvisi', 'mfa_codici_riserva', 'telefoni_chiave',
        'notifiche', 'funzione_membri', 'avvisi_magazzino', 'richieste_idempotenti', 'accessi_temporanei', 'letture_segnalazioni',
        'attivita_persone', 'partecipazioni', 'chiamate_persone', 'disponibilita', 'reperibilita', 'assenze']) {
        await client.query(`DELETE FROM ${tabella} WHERE user_id = $1`, [id]);
    }
    await client.query(
        `UPDATE squadra_membri SET left_at = NOW()
          WHERE left_at IS NULL AND username = (SELECT username FROM users WHERE id = $1)`, [id]);
    await client.query(
        `UPDATE users SET
            password = NULL, email = NULL, reset_token = NULL, reset_token_expires = NULL,
            codice_fiscale = NULL, telefono = NULL, indirizzo = NULL, citta = NULL, cap = NULL,
            photo_url = NULL, public_token = gen_random_uuid(), ente = NULL,
            mfa_attiva = false, mfa_segreto = NULL, mfa_attivata_il = NULL, mfa_ultimo_passo = NULL,
            ultimo_accesso = NULL, is_active = false, sessioni_valide_dal = NOW(), eliminato_il = NOW()
          WHERE id = $1`, [id]);
}
