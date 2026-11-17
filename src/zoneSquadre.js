// La sala sa quando una squadra entra in una zona interdetta; la squadra lo sa dal suo telefono.

import logger from './logger.js';
import { pool } from './db.js';
import { contiene } from './rischiZone.js';
import { avvisaClienti } from './tempoReale.js';
import { TERMINAL_REPORT_STATUSES_BACKEND } from './costanti.js';
import { avvisaSala } from './avvisiSala.js';

// Il GPS sbaglia di qualche decina di metri: per uscire dalla zona bisogna allontanarsi dal
// bordo, se no chi ci cammina accanto fa scattare un ingresso a ogni posizione.
const USCITA_M = 30;
const METRI_PER_GRADO = 111_320;

const dentroPerSquadra = new Map();

function distanzaDaSegmento(lat, lon, [lon1, lat1], [lon2, lat2]) {
    const k = Math.cos(lat * Math.PI / 180);
    const ax = (lon1 - lon) * k, ay = lat1 - lat, bx = (lon2 - lon) * k, by = lat2 - lat;
    const dx = bx - ax, dy = by - ay;
    const lungo = dx * dx + dy * dy;
    const t = lungo ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lungo)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy) * METRI_PER_GRADO;
}

export function distanzaDalBordo(geometria, lat, lon) {
    const poligoni = geometria?.type === 'Polygon' ? [geometria.coordinates]
        : geometria?.type === 'MultiPolygon' ? geometria.coordinates : [];
    let minima = Infinity;
    for (const anelli of poligoni) for (const anello of anelli) {
        for (let i = 1; i < anello.length; i++) minima = Math.min(minima, distanzaDaSegmento(lat, lon, anello[i - 1], anello[i]));
    }
    return minima;
}

export function zoneAppenaEntrate(dentro, zone, lat, lon) {
    const nuove = [];
    const esistenti = new Set(zone.map(z => z.id));
    for (const id of [...dentro]) if (!esistenti.has(id)) dentro.delete(id);
    for (const z of zone) {
        if (contiene(z.geometria, lat, lon)) {
            if (!dentro.has(z.id)) nuove.push(z);
            dentro.add(z.id);
        } else if (dentro.has(z.id) && distanzaDalBordo(z.geometria, lat, lon) > USCITA_M) {
            dentro.delete(z.id);
        }
    }
    return nuove;
}

export function dimenticaSquadra(squadraId) {
    dentroPerSquadra.delete(squadraId);
}

export async function controllaZoneSquadra({ emergencyId, squadraId, lat, lon }) {
    if (!emergencyId) return;
    try {
        const { rows: zone } = await pool.query(
            `SELECT id, nome, geometria FROM elementi_mappa
              WHERE rimosso_il IS NULL AND tipo = 'zona_interdetta'
                AND (emergency_id IS NULL OR emergency_id = $1 OR oltre_emergenza)`, [emergencyId]);
        if (!dentroPerSquadra.has(squadraId)) dentroPerSquadra.set(squadraId, new Set());
        const nuove = zoneAppenaEntrate(dentroPerSquadra.get(squadraId), zone, lat, lon);
        if (!nuove.length) return;
        const { rows: [squadra] } = await pool.query('SELECT nome_radio, nome FROM squadre WHERE id = $1', [squadraId]);
        const { rows: interventi } = await pool.query(
            `SELECT r.id, r.emergency_report_number AS numero, r.latitude, r.longitude
               FROM report_team_assignments a JOIN reports r ON r.id = a.report_id
              WHERE a.squadra_id = $1 AND r.emergency_id = $2 AND r.status <> ALL($3::text[])
                AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL`,
            [squadraId, emergencyId, TERMINAL_REPORT_STATUSES_BACKEND]);
        const chi = squadra?.nome_radio || squadra?.nome || `n. ${squadraId}`;
        for (const zona of nuove) {
            const intervento = interventi.find(r => contiene(zona.geometria, Number(r.latitude), Number(r.longitude))) || null;
            const nomeZona = zona.nome ? `«${zona.nome}»` : 'senza nome';
            const testo = `La squadra ${chi} è entrata nella zona interdetta ${nomeZona}` +
                (intervento ? `, dove si trova l'intervento n. ${intervento.numero}.` : '.');
            const { rows: [voce] } = await pool.query(
                `INSERT INTO diario_sala (emergency_id, testo, autore_id, autore_nome)
                 VALUES ($1, $2, NULL, 'ORION') RETURNING id, testo, autore_nome, creata_il`, [emergencyId, testo]);
            avvisaClienti('nota_sala', { emergency_id: emergencyId, voce });
            avvisaClienti('squadra_in_zona', {
                emergency_id: emergencyId, squadra_id: squadraId, squadra: chi,
                zona: { id: zona.id, nome: zona.nome }, intervento: intervento ? { id: intervento.id, numero: intervento.numero } : null
            });
            avvisaSala({ titolo: `${chi} in zona interdetta`, testo, chiave: `zona:${voce.id}` });
        }
    } catch (e) {
        logger.error(`Controllo delle zone interdette per la squadra ${squadraId} non riuscito:`, e);
    }
}
