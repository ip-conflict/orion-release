// Zone e strade sulla mappa: quelle del piano (emergency_id NULL) restano fra le
// emergenze, quelle dell'emergenza finiscono con lei salvo oltre_emergenza.

import { aggiornaRischi, eTipoPericolo } from './rischiZone.js';
import { haPermesso, richiedePermesso } from './permessi.js';

export const TIPI_ELEMENTO = {
    strada_chiusa: { etichetta: 'Strada chiusa', forme: ['LineString', 'MultiLineString'] },
    zona_interdetta: { etichetta: 'Zona interdetta', forme: ['Polygon', 'MultiPolygon'] },
    pericolo_alluvione: { etichetta: 'Pericolo alluvione', forme: ['Polygon', 'MultiPolygon'] },
    pericolo_frana: { etichetta: 'Pericolo frana', forme: ['Polygon', 'MultiPolygon'] },
    pericolo_generico: { etichetta: 'Zona di pericolo', forme: ['Polygon', 'MultiPolygon'] },
    area_attesa: { etichetta: 'Area di attesa', forme: ['Polygon', 'MultiPolygon', 'Point'] },
    area_accoglienza: { etichetta: 'Area di accoglienza', forme: ['Polygon', 'MultiPolygon', 'Point'] },
    area_ammassamento: { etichetta: 'Area di ammassamento soccorritori', forme: ['Polygon', 'MultiPolygon', 'Point'] },
    altro: { etichetta: 'Altro', forme: ['Point', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'] }
};

// Solo le chiavi dichiarate: "constructor" o "__proto__" non sono tipi.
const tipoValido = (tipo) => typeof tipo === 'string' && Object.hasOwn(TIPI_ELEMENTO, tipo);

const MAX_PUNTI = 50000;
const MAX_IMPORT = 3000;

// Sei decimali: dieci centimetri.
export function leggiGeometria(g, tipo) {
    const ammesse = tipoValido(tipo) ? TIPI_ELEMENTO[tipo].forme : null;
    if (!g || typeof g !== 'object' || !ammesse) return { errore: 'Forma mancante.' };
    if (!ammesse.includes(g.type)) {
        return { errore: `Un elemento "${TIPI_ELEMENTO[tipo].etichetta}" deve essere ${ammesse.includes('LineString') ? 'una linea' : 'un\'area'} (ricevuto ${g.type || 'niente'}).` };
    }
    let punti = 0;
    let fuoriScala = false;
    const punto = (c) => {
        if (!Array.isArray(c) || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) throw new Error('coordinate');
        if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) { fuoriScala = true; throw new Error('scala'); }
        punti++;
        return [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
    };
    const linea = (l) => { if (!Array.isArray(l) || l.length < 2) throw new Error('coordinate'); return l.map(punto); };
    const anello = (a) => { if (!Array.isArray(a) || a.length < 4) throw new Error('coordinate'); return a.map(punto); };
    try {
        let coordinate;
        switch (g.type) {
            case 'Point': coordinate = punto(g.coordinates); break;
            case 'LineString': coordinate = linea(g.coordinates); break;
            case 'MultiLineString': coordinate = g.coordinates.map(linea); break;
            case 'Polygon': coordinate = g.coordinates.map(anello); break;
            case 'MultiPolygon': coordinate = g.coordinates.map(p => p.map(anello)); break;
            default: throw new Error('coordinate');
        }
        if (punti > MAX_PUNTI) return { errore: `Forma troppo dettagliata (${punti} punti, al massimo ${MAX_PUNTI}): semplificala in QGIS.` };
        return { geometria: { type: g.type, coordinates: coordinate } };
    } catch {
        if (fuoriScala) return { errore: 'Le coordinate non sono in gradi (WGS84). In QGIS esporta scegliendo il sistema di riferimento EPSG:4326.' };
        return { errore: 'Coordinate non valide.' };
    }
}

export function registraRotteMappaElementi(app, ctx) {
    const { pool, logger, haRuolo, ruoliDi, registraAudit, nomeUtente, avvisaClienti, emergenzaAttiva, checkAdminRole } = ctx;
    const interno = (req) => !ruoliDi(req.user).includes('esterno');
    const testo = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;
    const COLONNE = `id, emergency_id, tipo, nome, livello, note, geometria, origine, creato_il, creato_da,
                     modificato_il, modificato_da, rimosso_il, rimosso_da, oltre_emergenza`;
    const DURANO = ['strada_chiusa', 'zona_interdetta'];

    function leggiDati(corpo, { serveGeometria }) {
        const tipo = corpo?.tipo;
        if (!tipoValido(tipo)) return { errore: 'Tipo di elemento non valido.' };
        const dati = { tipo, nome: testo(corpo.nome, 150), livello: testo(corpo.livello, 40), note: testo(corpo.note, 2000) };
        if (serveGeometria || corpo.geometria) {
            const { geometria, errore } = leggiGeometria(corpo.geometria, tipo);
            if (errore) return { errore };
            dati.geometria = geometria;
        }
        return { dati };
    }

    function permesso(req, elemento) {
        if (elemento.oltre_emergenza) return interno(req) ? null : 'Strade chiuse e zone le gestiscono gli operatori del COC.';
        if (elemento.emergency_id == null) return haPermesso(req, 'emergenze.piano') ? null : "Gli elementi del piano li gestisce chi ha il permesso del piano di emergenza.";
        if (!interno(req)) return 'Strade chiuse e zone le gestiscono gli operatori del COC.';
        const attiva = emergenzaAttiva();
        if (!attiva || elemento.emergency_id !== attiva.id) return "L'elemento è di un'emergenza chiusa.";
        return null;
    }

    const avvisa = () => avvisaClienti('reload_mappa');
    const rivediRischi = (req, ...tipi) => {
        const attiva = emergenzaAttiva();
        if (attiva && tipi.some(eTipoPericolo)) aggiornaRischi({ emergencyId: attiva.id, userId: req.user.id });
    };

    app.get('/api/mappa/elementi', async (req, res) => {
        try {
            const attiva = emergenzaAttiva();
            const { rows } = await pool.query(`SELECT ${COLONNE} FROM elementi_mappa
                WHERE rimosso_il IS NULL AND (emergency_id IS NULL OR emergency_id = $1 OR oltre_emergenza)
                ORDER BY (emergency_id IS NULL AND NOT oltre_emergenza) DESC, creato_il`, [attiva?.id ?? null]);
            const delPiano = (r) => r.emergency_id == null && !r.oltre_emergenza;
            res.json({
                tipi: Object.fromEntries(Object.entries(TIPI_ELEMENTO).map(([k, v]) => [k, v.etichetta])),
                piano: rows.filter(delPiano),
                emergenza: rows.filter(r => !delPiano(r))
            });
        } catch (e) {
            logger.error('Errore GET /api/mappa/elementi:', e);
            res.status(500).json({ message: 'Errore nel leggere la mappa.' });
        }
    });

    app.post('/api/mappa/elementi', async (req, res) => {
        const { dati, errore } = leggiDati(req.body, { serveGeometria: true });
        if (errore) return res.status(400).json({ message: errore });
        const delPiano = req.body?.piano === true;
        const attiva = emergenzaAttiva();
        if (delPiano && !haPermesso(req, 'emergenze.piano')) return res.status(403).json({ message: "Gli elementi del piano li mette chi ha il permesso del piano di emergenza." });
        if (!delPiano) {
            if (!interno(req)) return res.status(403).json({ message: 'Strade chiuse e zone le disegnano gli operatori del COC.' });
            if (!attiva) return res.status(409).json({ message: "Senza un'emergenza aperta si disegnano solo elementi del piano." });
        }
        try {
            const { rows } = await pool.query(
                `INSERT INTO elementi_mappa (emergency_id, tipo, nome, livello, note, geometria, creato_da)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLONNE}`,
                [delPiano ? null : attiva.id, dati.tipo, dati.nome, dati.livello, dati.note, JSON.stringify(dati.geometria), nomeUtente(req.user)]);
            registraAudit(req, 'mappa.elemento_aggiunto', { tipo: 'elemento_mappa', id: rows[0].id, dettagli: { tipo: dati.tipo, nome: dati.nome, piano: delPiano } });
            avvisa();
            rivediRischi(req, dati.tipo);
            res.status(201).json(rows[0]);
        } catch (e) {
            logger.error('Errore POST /api/mappa/elementi:', e);
            res.status(500).json({ message: "Errore nel salvare l'elemento." });
        }
    });

    app.put('/api/mappa/elementi/:id', async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Elemento non valido.' });
        try {
            const prima = (await pool.query(`SELECT ${COLONNE} FROM elementi_mappa WHERE id = $1 AND rimosso_il IS NULL`, [id])).rows[0];
            if (!prima) return res.status(404).json({ message: 'Elemento non trovato.' });
            const negato = permesso(req, prima);
            if (negato) return res.status(403).json({ message: negato });
            const { dati, errore } = leggiDati({ ...prima, ...req.body, tipo: req.body?.tipo || prima.tipo, geometria: req.body?.geometria || prima.geometria }, { serveGeometria: true });
            if (errore) return res.status(400).json({ message: errore });
            const oltre = typeof req.body?.oltre_emergenza === 'boolean' ? req.body.oltre_emergenza : prima.oltre_emergenza;
            if (oltre && !DURANO.includes(dati.tipo)) {
                return res.status(400).json({ message: "Dopo l'emergenza restano in vigore solo strade chiuse e zone interdette." });
            }
            if (oltre !== prima.oltre_emergenza && prima.emergency_id == null && !prima.oltre_emergenza) {
                return res.status(400).json({ message: "Gli elementi del piano restano già, emergenza o no." });
            }
            const { rows } = await pool.query(
                `UPDATE elementi_mappa SET tipo = $2, nome = $3, livello = $4, note = $5, geometria = $6,
                        modificato_il = NOW(), modificato_da = $7, oltre_emergenza = $8
                 WHERE id = $1 RETURNING ${COLONNE}`,
                [id, dati.tipo, dati.nome, dati.livello, dati.note, JSON.stringify(dati.geometria), nomeUtente(req.user), oltre]);
            registraAudit(req, 'mappa.elemento_modificato', { tipo: 'elemento_mappa', id, dettagli: {
                tipo: dati.tipo, nome: dati.nome, forma: !!req.body?.geometria,
                ...(oltre !== prima.oltre_emergenza ? { oltre_emergenza: oltre } : {}) } });
            avvisa();
            rivediRischi(req, prima.tipo, dati.tipo);
            res.json(rows[0]);
        } catch (e) {
            logger.error('Errore PUT /api/mappa/elementi:', e);
            res.status(500).json({ message: "Errore nel salvare l'elemento." });
        }
    });

    // Una strada riaperta resta nel registro dell'emergenza; un elemento del piano si cancella.
    app.delete('/api/mappa/elementi/:id', async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Elemento non valido.' });
        try {
            const prima = (await pool.query(`SELECT ${COLONNE} FROM elementi_mappa WHERE id = $1 AND rimosso_il IS NULL`, [id])).rows[0];
            if (!prima) return res.status(404).json({ message: 'Elemento non trovato.' });
            const negato = permesso(req, prima);
            if (negato) return res.status(403).json({ message: negato });
            if (prima.emergency_id == null && !prima.oltre_emergenza) await pool.query('DELETE FROM elementi_mappa WHERE id = $1', [id]);
            else await pool.query('UPDATE elementi_mappa SET rimosso_il = NOW(), rimosso_da = $2 WHERE id = $1', [id, nomeUtente(req.user)]);
            registraAudit(req, 'mappa.elemento_tolto', { tipo: 'elemento_mappa', id, dettagli: {
                tipo: prima.tipo, nome: prima.nome, piano: prima.emergency_id == null && !prima.oltre_emergenza, oltre_emergenza: prima.oltre_emergenza } });
            avvisa();
            rivediRischi(req, prima.tipo);
            res.json({ message: prima.tipo === 'strada_chiusa' ? 'Strada riaperta.' : 'Elemento tolto.' });
        } catch (e) {
            logger.error('Errore DELETE /api/mappa/elementi:', e);
            res.status(500).json({ message: "Errore nel togliere l'elemento." });
        }
    });

    app.post('/api/mappa/importa', richiedePermesso('emergenze.piano'), async (req, res) => {
        const tipo = req.body?.tipo;
        const elementi = req.body?.elementi;
        if (!tipoValido(tipo)) return res.status(400).json({ message: 'Scegli che cosa rappresentano le forme del file.' });
        if (!Array.isArray(elementi) || !elementi.length) return res.status(400).json({ message: 'Il file non contiene forme da importare.' });
        if (elementi.length > MAX_IMPORT) return res.status(400).json({ message: `Troppe forme in un file solo (${elementi.length}, al massimo ${MAX_IMPORT}).` });
        const origine = testo(req.body?.origine, 150);
        const pronti = [];
        for (const [i, e] of elementi.entries()) {
            const { geometria, errore } = leggiGeometria(e?.geometria, tipo);
            if (errore) return res.status(400).json({ message: `Forma ${i + 1}: ${errore}` });
            pronti.push({ geometria, nome: testo(e.nome, 150), livello: testo(e.livello, 40), note: testo(e.note, 2000) });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const chi = nomeUtente(req.user);
            for (const p of pronti) {
                await client.query(
                    `INSERT INTO elementi_mappa (emergency_id, tipo, nome, livello, note, geometria, origine, creato_da)
                     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)`,
                    [tipo, p.nome, p.livello, p.note, JSON.stringify(p.geometria), origine, chi]);
            }
            await client.query('COMMIT');
            registraAudit(req, 'mappa.piano_importato', { tipo: 'elemento_mappa', dettagli: { tipo, quanti: pronti.length, origine } });
            avvisa();
            rivediRischi(req, tipo);
            res.status(201).json({ importati: pronti.length, message: `${pronti.length} ${pronti.length === 1 ? 'forma importata' : 'forme importate'} come "${TIPI_ELEMENTO[tipo].etichetta}".` });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore importazione piano:', e);
            res.status(500).json({ message: "Errore nell'importare il file." });
        } finally {
            client.release();
        }
    });

    app.delete('/api/mappa/piano', richiedePermesso('emergenze.piano'), async (req, res) => {
        const tipo = req.query.tipo;
        if (!tipoValido(tipo)) return res.status(400).json({ message: 'Tipo non valido.' });
        const origine = typeof req.query.origine === 'string' && req.query.origine ? req.query.origine : null;
        const disegnati = req.query.disegnati === '1';
        if (!origine && !disegnati) return res.status(400).json({ message: 'Indica il file importato o gli elementi disegnati a mano.' });
        try {
            const r = await pool.query(
                `DELETE FROM elementi_mappa WHERE emergency_id IS NULL AND NOT oltre_emergenza AND tipo = $1
                   AND (CASE WHEN $3 THEN origine IS NULL ELSE origine = $2 END)`, [tipo, origine, disegnati]);
            registraAudit(req, 'mappa.piano_svuotato', { tipo: 'elemento_mappa', dettagli: { tipo, origine, quanti: r.rowCount } });
            avvisa();
            rivediRischi(req, tipo);
            res.json({ tolti: r.rowCount, message: `${r.rowCount} elementi tolti.` });
        } catch (e) {
            logger.error('Errore DELETE /api/mappa/piano:', e);
            res.status(500).json({ message: 'Errore nel togliere gli elementi.' });
        }
    });
}
