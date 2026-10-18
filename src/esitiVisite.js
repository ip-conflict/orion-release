// L'esito di una visita è un dato sanitario: nel database sta cifrato (enc1:), e il confronto con
// "Idoneo" si fa qui, non in SQL.

import { ChiaveNonDisponibile, cifraTesto, decifraTesto } from './cifratura.js';
import { pool } from './db.js';

export const IDONEO = 'Idoneo';
export const ESITI_VISITA = [IDONEO, 'Non Idoneo'];
const VISITA_IDONEITA = 'visita di idoneità fisica';

export const cifraEsito = (esito) => cifraTesto(esito);

// Senza la chiave dei dati l'esito non si legge: null, e chi lo usa lo tratta come non idoneo.
export function esitoInChiaro(valore) {
    try {
        return decifraTesto(valore);
    } catch (e) {
        if (e instanceof ChiaveNonDisponibile) return null;
        throw e;
    }
}

export const conEsitoInChiaro = (riga) => (riga && 'status' in riga ? { ...riga, status: esitoInChiaro(riga.status) } : riga);

// Conta l'ultima visita di idoneità fisica: idoneo se l'esito è "Idoneo" e non è scaduta.
export async function idoneitaFisica(userIds, esecutore = pool) {
    const ids = [...new Set((userIds || []).map(Number).filter(Number.isInteger))];
    const esito = new Map(ids.map(id => [id, false]));
    if (!ids.length) return esito;
    const r = await esecutore.query(
        `SELECT DISTINCT ON (umr.user_id) umr.user_id, umr.status, umr.expiry_date >= CURRENT_DATE AS valida
           FROM user_medical_records umr JOIN medical_visit_types mvt ON mvt.id = umr.visit_type_id
          WHERE umr.user_id = ANY($1::int[]) AND LOWER(mvt.name) = $2
          ORDER BY umr.user_id, umr.last_visit_date DESC`, [ids, VISITA_IDONEITA]);
    for (const riga of r.rows) esito.set(riga.user_id, riga.valida === true && esitoInChiaro(riga.status) === IDONEO);
    return esito;
}

export async function conIdoneitaFisica(righe, esecutore = pool) {
    const idonei = await idoneitaFisica(righe.map(r => r.id), esecutore);
    return righe.map(r => ({ ...r, medical_ok: idonei.get(Number(r.id)) === true }));
}
