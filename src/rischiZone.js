// I rischi di una segnalazione presi dalle zone di pericolo della mappa
// (alluvione, frana, altri pericoli; del piano o disegnate in sala). Quando
// una segnalazione nasce o si sposta, e quando una zona di pericolo si
// disegna, si modifica o si toglie, nel campo dei rischi compaiono (o
// spariscono) le righe che iniziano con PREFISSO. Il resto del campo,
// scritto a mano, non si tocca. Ogni cambio lascia una nota di sistema nel
// diario della segnalazione.

import logger from './logger.js';
import { pool } from './db.js';
import { wss } from './tempoReale.js';

export const PREFISSO = '⚠ ';
const ETICHETTA = {
    pericolo_alluvione: 'Pericolo alluvione',
    pericolo_frana: 'Pericolo frana',
    pericolo_generico: 'Zona di pericolo'
};
export const eTipoPericolo = (tipo) => Object.hasOwn(ETICHETTA, tipo);

// Un punto dentro un anello (raggio orizzontale, GeoJSON: [lon, lat]).
function dentroAnello(lon, lat, anello) {
    let dentro = false;
    for (let i = 0, j = anello.length - 1; i < anello.length; j = i++) {
        const [xi, yi] = anello[i];
        const [xj, yj] = anello[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
}

// Dentro il contorno e fuori dai buchi.
function dentroPoligono(lon, lat, anelli) {
    if (!Array.isArray(anelli) || !anelli.length || !dentroAnello(lon, lat, anelli[0])) return false;
    return !anelli.slice(1).some(buco => dentroAnello(lon, lat, buco));
}

export function contiene(geometria, lat, lon) {
    if (geometria?.type === 'Polygon') return dentroPoligono(lon, lat, geometria.coordinates);
    if (geometria?.type === 'MultiPolygon') return geometria.coordinates.some(p => dentroPoligono(lon, lat, p));
    return false;
}

const riga = (z) => `${PREFISSO}${ETICHETTA[z.tipo]}${z.nome ? `: ${z.nome}` : ''}${z.livello ? ` (livello ${z.livello})` : ''}`;

// Il campo dei rischi con le righe delle zone al posto di quelle di prima.
export function testoRischi(attuale, zone) {
    const scritte = String(attuale || '').split('\n').filter(l => l.trim() && !l.startsWith(PREFISSO));
    const testo = [...zone.map(riga), ...scritte].join('\n').trim();
    return testo || null;
}

async function zoneDiPericolo(esecutore, emergencyId) {
    const { rows } = await esecutore.query(
        `SELECT id, tipo, nome, livello, geometria FROM elementi_mappa
          WHERE rimosso_il IS NULL AND tipo = ANY($1::text[]) AND (emergency_id IS NULL OR emergency_id = $2)
          ORDER BY tipo, nome`, [Object.keys(ETICHETTA), emergencyId]);
    return rows;
}

function avvisa(reportId, nota) {
    wss.clients.forEach(c => {
        if (c.readyState !== 1) return;
        try {
            c.send(JSON.stringify({ action: 'reload_reports', updatedReportId: reportId }));
            if (nota) c.send(JSON.stringify({ action: 'new_report_update', reportId, update: nota }));
        } catch (e) { logger.error('WS Send Error (rischi dalle zone):', e); }
    });
}

// Ricalcola le segnalazioni indicate (o tutte quelle con coordinate
// dell'emergenza) e scrive solo dove qualcosa cambia. userId: chi ha
// provocato il cambio, per la nota nel diario.
export async function aggiornaRischi({ emergencyId, reportIds = null, userId }) {
    if (!emergencyId || !userId) return 0;
    const client = await pool.connect();
    const avvisi = [];
    try {
        await client.query('BEGIN');
        const zone = await zoneDiPericolo(client, emergencyId);
        const { rows: segnalazioni } = await client.query(
            `SELECT id, latitude, longitude, environmental_hazard FROM reports
              WHERE emergency_id = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL
                AND ($2::int[] IS NULL OR id = ANY($2::int[]))
              FOR UPDATE`, [emergencyId, reportIds]);
        for (const s of segnalazioni) {
            const lat = Number(s.latitude), lon = Number(s.longitude);
            const dentro = zone.filter(z => contiene(z.geometria, lat, lon));
            const nuovo = testoRischi(s.environmental_hazard, dentro);
            if ((nuovo || null) === (s.environmental_hazard || null)) continue;
            await client.query('UPDATE reports SET environmental_hazard = $2, updated_at = NOW() WHERE id = $1', [s.id, nuovo]);
            const testo = dentro.length
                ? `Rischi aggiornati in automatico: la segnalazione è in ${dentro.map(z => `${ETICHETTA[z.tipo].toLowerCase()}${z.nome ? ` «${z.nome}»` : ''}`).join(', ')}.`
                : 'Rischi aggiornati in automatico: la segnalazione non è più in una zona di pericolo della mappa.';
            const nota = (await client.query(
                `WITH inserted AS (
                     INSERT INTO report_updates (report_id, update_text, user_id, update_timestamp, is_system)
                     VALUES ($1, $2, $3, NOW(), true) RETURNING *)
                 SELECT i.*, CONCAT(u.nome, ' ', u.cognome) AS updater_fullname FROM inserted i JOIN users u ON i.user_id = u.id`,
                [s.id, testo, userId])).rows[0];
            avvisi.push([s.id, nota]);
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[Rischi] Aggiornamento dalle zone di pericolo non riuscito:', e);
        return 0;
    } finally {
        client.release();
    }
    avvisi.forEach(([id, nota]) => avvisa(id, nota));
    if (avvisi.length) logger.info(`[Rischi] Aggiornati i rischi di ${avvisi.length} segnalazioni dalle zone di pericolo.`);
    return avvisi.length;
}
