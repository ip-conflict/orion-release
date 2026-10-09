// Eliminare una persona da ORION vuol dire cancellarne i dati personali. Se
// la persona non compare nello storico la si cancella del tutto. Se compare
// in segnalazioni, aggiornamenti o documenti delle emergenze, il registro deve
// restare integro e non ripudiabile (chi ha fatto che cosa, e quando): allora
// di lei restano solo nome, cognome e nome utente, legati a quelle
// operazioni, e tutto il resto si cancella. In entrambi i casi spariscono
// dal disco la foto e i certificati di visite e corsi.
//
// Restano per forza di cose, perché sono lo storico: il registro delle
// operazioni, il diario di sala, i verbali di consegna, i movimenti del
// magazzino e la composizione delle squadre nelle emergenze, che riportano il
// nome per esteso.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARTELLE = {
    '/api/photos/': path.join(RADICE, 'uploads', 'photos'),
    '/api/documents/certificates/': path.join(RADICE, 'protected_uploads', 'certificates')
};

// Dal suo indirizzo al file sul disco, solo dentro le cartelle note.
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

// I file di questi indirizzi (foto o certificati), per toglierli quando la
// riga che li indicava è cancellata o li ha sostituiti.
export const fileDaIndirizzi = (indirizzi) => indirizzi.map(fileDi).filter(Boolean);

// Dopo il COMMIT: un file che non si riesce a togliere resta nel registro del
// server, ma non blocca l'eliminazione.
export async function cancellaFile(percorsi) {
    for (const p of percorsi) {
        await fs.promises.unlink(p).catch(e => { if (e.code !== 'ENOENT') logger.error(`File di una persona eliminata non cancellato: ${p}`, e); });
    }
}

// Quando la cancellazione vera non si può fare: resta la riga con nome,
// cognome e nome utente, il resto si svuota. Dentro la transazione del chiamante.
export async function pseudonimizza(client, id) {
    for (const tabella of ['user_medical_records', 'user_courses', 'utenti_ruoli', 'token_rinnovo', 'token_avvisi', 'mfa_codici_riserva',
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
