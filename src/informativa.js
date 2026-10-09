// Le condizioni d'uso: chi usa ORION le accetta al primo accesso e ogni volta
// che cambiano (il controllo sta in authenticateToken). L'amministratore può
// riscriverle; pubblicandole ne nasce una versione nuova. Ogni accettazione
// resta nel registro con l'impronta del testo mostrato.
//
// Gli indirizzi (/api/informativa, informativa_da_vedere, /informativa.html)
// sono rimasti quelli di quando c'era anche l'informativa sul trattamento dei
// dati, tolta per ora: l'app li usa già. I campi "informativa" e "breve" delle
// risposte restano vuoti per lo stesso motivo.

import crypto from 'crypto';
import logger from './logger.js';
import { pool } from './db.js';
import { registraAudit } from './audit.js';
import { checkAdminRole } from './autenticazione.js';
import { condizioniPredefinite, datiOrganizzazione } from './testiCondizioni.js';
import { impostaVersioneInformativa, versioneInformativa } from './statoInformativa.js';

const LUNGHEZZA_TESTO = 60000;

async function leggiImpostazioni(esecutore = pool) {
    const r = await esecutore.query(
        'SELECT setting_key, setting_value FROM branding_settings WHERE setting_key = ANY($1::text[])',
        [['association_name', 'privacy_pubblicata_il', 'privacy_testo_condizioni']]);
    return Object.fromEntries(r.rows.map(x => [x.setting_key, x.setting_value]));
}

// Il testo in vigore: quello scritto dall'amministratore o, se non c'è,
// quello predefinito. L'impronta lega l'accettazione a quello che è stato
// mostrato davvero.
export async function testiInVigore(esecutore = pool) {
    const imp = await leggiImpostazioni(esecutore);
    const d = datiOrganizzazione(imp);
    const condizioni = String(imp.privacy_testo_condizioni || '').trim() || condizioniPredefinite(d);
    const impronta = crypto.createHash('sha256').update(condizioni).digest('hex');
    return { condizioni, impronta, imp, d };
}

const perChiLegge = (t) => ({ condizioni: t.condizioni, informativa: '', breve: '', link_ente: null });

// Senza accesso: le condizioni si leggono anche dalla pagina di accesso.
export function registraRotteInformativaPubblica(app) {
    app.get('/api/pubblico/informativa', async (req, res) => {
        try {
            res.json({ versione: versioneInformativa, ...perChiLegge(await testiInVigore()) });
        } catch (e) {
            logger.error('Errore lettura condizioni pubbliche:', e);
            res.status(500).json({ message: "Errore nel leggere le condizioni d'uso." });
        }
    });
}

export function registraRotteInformativa(app) {
    app.get('/api/informativa', async (req, res) => {
        try {
            const [testi, utente] = await Promise.all([
                testiInVigore(),
                pool.query('SELECT presa_visione_versione, presa_visione_il FROM users WHERE id = $1', [req.user.id])
            ]);
            const u = utente.rows[0] || {};
            res.json({
                versione: versioneInformativa, ...perChiLegge(testi),
                presa_visione: u.presa_visione_versione === versioneInformativa ? { il: u.presa_visione_il } : null
            });
        } catch (e) {
            logger.error('Errore lettura condizioni:', e);
            res.status(500).json({ message: "Errore nel leggere le condizioni d'uso." });
        }
    });

    app.post('/api/informativa/presa-visione', async (req, res) => {
        const versione = Number(req.body?.versione);
        // Se il testo è cambiato mentre la persona leggeva, rilegge quello nuovo.
        if (versione !== versioneInformativa) {
            return res.status(409).json({ message: "Nel frattempo le condizioni d'uso sono state aggiornate: rileggi il testo nuovo.", versione: versioneInformativa });
        }
        const canale = req.get('X-Orion-Client') === 'app' ? 'app' : 'web';
        try {
            const { impronta } = await testiInVigore();
            const persona = [req.user.nome, req.user.cognome].filter(Boolean).join(' ') || req.user.username;
            await pool.query(
                `INSERT INTO prese_visione (user_id, persona, versione, impronta_testi, canale) VALUES ($1, $2, $3, $4, $5)`,
                [req.user.id, `${persona} (${req.user.username})`, versione, impronta, canale]);
            const r = await pool.query(
                'UPDATE users SET presa_visione_versione = $1, presa_visione_il = NOW() WHERE id = $2 RETURNING presa_visione_il',
                [versione, req.user.id]);
            registraAudit(req, 'condizioni.accettate', { tipo: 'utente', id: req.user.id, dettagli: { versione, canale } });
            res.json({ message: 'Grazie: puoi continuare.', versione, il: r.rows[0]?.presa_visione_il });
        } catch (e) {
            logger.error('Errore accettazione condizioni:', e);
            res.status(500).json({ message: "Errore nel registrare l'accettazione." });
        }
    });

    // Per l'amministratore: il testo e chi l'ha accettato.
    async function statoAmministrazione() {
        const { imp, d } = await testiInVigore();
        const [conteggi, mancano] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int AS attivi, COUNT(*) FILTER (WHERE presa_visione_versione = $1)::int AS con_presa_visione
                 FROM users WHERE COALESCE(is_active, true) AND NOT COALESCE(temporaneo, false) AND eliminato_il IS NULL`, [versioneInformativa]),
            pool.query(
                `SELECT nome, cognome, username FROM users
                 WHERE COALESCE(is_active, true) AND NOT COALESCE(temporaneo, false) AND eliminato_il IS NULL
                   AND presa_visione_versione IS DISTINCT FROM $1
                 ORDER BY cognome, nome LIMIT 100`, [versioneInformativa])
        ]);
        return {
            versione: versioneInformativa,
            pubblicata_il: imp.privacy_pubblicata_il || null,
            testi: { condizioni: imp.privacy_testo_condizioni || '' },
            predefiniti: { condizioni: condizioniPredefinite(d) },
            ...conteggi.rows[0],
            senza_presa_visione: mancano.rows
        };
    }

    app.get('/api/admin/informativa', checkAdminRole, async (req, res) => {
        try {
            res.json(await statoAmministrazione());
        } catch (e) {
            logger.error('Errore lettura condizioni (amministrazione):', e);
            res.status(500).json({ message: "Errore nel leggere le condizioni d'uso." });
        }
    });

    // Pubblicare: si salva il testo e nasce una versione nuova, che tutti
    // accettano di nuovo al prossimo accesso. Chi pubblica l'ha già accettata.
    app.put('/api/admin/informativa', checkAdminRole, async (req, res) => {
        const v = req.body?.testi?.condizioni;
        if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > LUNGHEZZA_TESTO)) {
            return res.status(400).json({ message: 'Testo non valido o troppo lungo.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const nuova = versioneInformativa + 1;
            const scrivi = (k, valore) => client.query(
                `INSERT INTO branding_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, NOW())
                 ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`, [k, valore]);
            // Vuoto vuol dire "torna al testo predefinito".
            if (v !== undefined) await scrivi('privacy_testo_condizioni', (v || '').trim());
            await scrivi('privacy_versione', String(nuova));
            await scrivi('privacy_pubblicata_il', new Date().toISOString());
            const { impronta } = await testiInVigore(client);
            const persona = [req.user.nome, req.user.cognome].filter(Boolean).join(' ') || req.user.username;
            await client.query(
                'INSERT INTO prese_visione (user_id, persona, versione, impronta_testi, canale) VALUES ($1, $2, $3, $4, $5)',
                [req.user.id, `${persona} (${req.user.username})`, nuova, impronta, 'web']);
            await client.query('UPDATE users SET presa_visione_versione = $1, presa_visione_il = NOW() WHERE id = $2', [nuova, req.user.id]);
            await client.query('COMMIT');
            impostaVersioneInformativa(nuova);
            registraAudit(req, 'condizioni.pubblicate', { tipo: 'impostazioni', dettagli: { versione: nuova } });
            res.json({ message: `Versione ${nuova} pubblicata: tutti la accetteranno di nuovo al prossimo accesso.`, ...(await statoAmministrazione()) });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore pubblicazione condizioni:', e);
            res.status(500).json({ message: "Errore nel pubblicare le condizioni d'uso." });
        } finally {
            client.release();
        }
    });
}
