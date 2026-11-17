// I dati di un'emergenza chiusa per Regione e Prefettura: le segnalazioni in CSV per Excel, la mappa in GeoJSON.
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { ETICHETTA_PRIORITA, ETICHETTA_STATO, TIPI_SEGNALAZIONE } from './costanti.js';
import { pool } from './db.js';
import { richiedePermesso } from './permessi.js';

// Excel interpreta come formula una cella che comincia con = + - @: l'apostrofo la lascia testo.
function cella(valore) {
    let testo = valore == null ? '' : String(valore);
    if (/^[=+\-@]/.test(testo)) testo = `'${testo}`;
    return /[;"\r\n]/.test(testo) ? `"${testo.replace(/"/g, '""')}"` : testo;
}
const dataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : '');
const nomeFile = (codice, estensione) => `${String(codice || 'emergenza').replace(/[^A-Za-z0-9_-]/g, '_')}-${estensione}`;

async function emergenzaChiusa(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) { res.status(400).json({ message: 'ID non valido.' }); return null; }
    const e = (await pool.query('SELECT id, code, name, status FROM emergencies WHERE id = $1', [id])).rows[0];
    if (!e) { res.status(404).json({ message: 'Emergenza non trovata.' }); return null; }
    if (e.status === 'ACTIVE') { res.status(409).json({ message: "Si esportano le emergenze chiuse: questa è ancora aperta." }); return null; }
    return e;
}

export function registraRotteEsportazioni(app) {
    app.get('/api/admin/emergencies/:id/segnalazioni.csv', richiedePermesso('emergenze.archivio'), async (req, res) => {
        try {
            const e = await emergenzaChiusa(req, res);
            if (!e) return;
            const { rows } = await pool.query(
                `SELECT r.emergency_report_number AS numero, r.tipo, r.title, r.location_address, r.latitude, r.longitude,
                        r.priority, r.status, r.created_at,
                        CASE WHEN r.status = 'Closed' THEN r.updated_at END AS chiusa_il,
                        COALESCE((SELECT string_agg(DISTINCT COALESCE(a.nome_radio, a.squadra_nome), ', ') FROM report_team_assignments a WHERE a.report_id = r.id), '') AS squadre,
                        (SELECT count(*) FROM report_updates u WHERE u.report_id = r.id AND NOT COALESCE(u.is_system, false))::int AS note
                   FROM reports r WHERE r.emergency_id = $1
                  ORDER BY COALESCE(r.emergency_report_number, r.id)`, [e.id]);
            const intestazione = ['Numero', 'Tipo', 'Titolo', 'Indirizzo', 'Latitudine', 'Longitudine', 'Priorità', 'Stato finale', 'Squadre', 'Apertura', 'Chiusura', 'Note'];
            const righe = rows.map(r => [r.numero, TIPI_SEGNALAZIONE[r.tipo] || r.tipo, r.title, r.location_address,
                r.latitude ?? '', r.longitude ?? '', ETICHETTA_PRIORITA[r.priority] || r.priority, ETICHETTA_STATO[r.status] || r.status,
                r.squadre, dataOra(r.created_at), dataOra(r.chiusa_il), r.note].map(cella).join(';'));
            registraAudit(req, 'emergenza.esportata', { tipo: 'emergenza', id: e.id, dettagli: { code: e.code, formato: 'csv', segnalazioni: rows.length } });
            res.set('Content-Type', 'text/csv; charset=utf-8');
            res.set('Content-Disposition', `attachment; filename="${nomeFile(e.code, 'segnalazioni.csv')}"`);
            // Il BOM fa riconoscere a Excel italiano l'UTF-8 (e il punto e virgola come separatore).
            res.send(`﻿${[intestazione.map(cella).join(';'), ...righe].join('\r\n')}\r\n`);
        } catch (err) {
            logger.error('Errore esportazione CSV:', err);
            res.status(500).json({ message: "Errore nell'esportare le segnalazioni." });
        }
    });

    app.get('/api/admin/emergencies/:id/mappa.geojson', richiedePermesso('emergenze.archivio'), async (req, res) => {
        try {
            const e = await emergenzaChiusa(req, res);
            if (!e) return;
            const [segnalazioni, elementi] = await Promise.all([
                pool.query(`SELECT r.emergency_report_number AS numero, r.tipo, r.title, r.location_address, r.priority, r.status, r.created_at, r.latitude, r.longitude
                              FROM reports r WHERE r.emergency_id = $1 AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
                             ORDER BY COALESCE(r.emergency_report_number, r.id)`, [e.id]),
                pool.query(`SELECT tipo, nome, livello, note, geometria, creato_il, rimosso_il FROM elementi_mappa WHERE emergency_id = $1 ORDER BY creato_il`, [e.id])
            ]);
            const caratteristiche = [
                ...segnalazioni.rows.map(r => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [Number(r.longitude), Number(r.latitude)] },
                    properties: { tipo_elemento: 'segnalazione', numero: r.numero, tipo: TIPI_SEGNALAZIONE[r.tipo] || r.tipo, titolo: r.title,
                        indirizzo: r.location_address, priorita: ETICHETTA_PRIORITA[r.priority] || r.priority, stato: ETICHETTA_STATO[r.status] || r.status,
                        apertura: r.created_at }
                })),
                ...elementi.rows.filter(m => m.geometria).map(m => ({
                    type: 'Feature',
                    geometry: m.geometria,
                    properties: { tipo_elemento: m.tipo, nome: m.nome, livello: m.livello, note: m.note, creato_il: m.creato_il, rimosso_il: m.rimosso_il }
                }))
            ];
            registraAudit(req, 'emergenza.esportata', { tipo: 'emergenza', id: e.id, dettagli: { code: e.code, formato: 'geojson', elementi: caratteristiche.length } });
            res.set('Content-Type', 'application/geo+json; charset=utf-8');
            res.set('Content-Disposition', `attachment; filename="${nomeFile(e.code, 'mappa.geojson')}"`);
            res.send(JSON.stringify({ type: 'FeatureCollection', name: `${e.code}${e.name ? ` - ${e.name}` : ''}`, features: caratteristiche }));
        } catch (err) {
            logger.error('Errore esportazione GeoJSON:', err);
            res.status(500).json({ message: "Errore nell'esportare la mappa." });
        }
    });
}
