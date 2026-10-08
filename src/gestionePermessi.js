// src/gestionePermessi.js
//
// Il catalogo dei permessi, per chi deve mostrarlo, e i permessi in più di
// una persona, che dà e toglie solo l'amministratore (permessi.js).

import logger from './logger.js';
import { registraAudit } from './audit.js';
import { checkAdminRole } from './autenticazione.js';
import { pool } from './db.js';
import { CATEGORIE_PERMESSI, CODICI_PERMESSI, NOMI_RUOLI, PERMESSI, PERMESSI_DEI_RUOLI, mfaRichiesta, permessiDeiRuoli, permessiDi } from './permessi.js';

async function leggiPersona(id) {
    const r = await pool.query(
        `SELECT u.id, u.username, u.nome, u.cognome, u.temporaneo, u.mfa_attiva, u.eliminato_il,
                ARRAY(SELECT ruolo::text FROM utenti_ruoli WHERE user_id = u.id) AS ruoli
           FROM users u WHERE u.id = $1`, [id]);
    return r.rows[0] && !r.rows[0].eliminato_il ? r.rows[0] : null;
}

export function registraRotteGestionePermessi(app) {
    // Il catalogo: i nomi per il web e l'app, i pacchetti dei ruoli.
    app.get('/api/permessi/catalogo', (req, res) => {
        res.json({ categorie: CATEGORIE_PERMESSI, permessi: PERMESSI, ruoli: NOMI_RUOLI, pacchetti: PERMESSI_DEI_RUOLI });
    });

    app.get('/api/admin/users/:id/permessi', checkAdminRole, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const persona = await leggiPersona(id);
            if (!persona) return res.status(404).json({ message: 'Utente non trovato.' });
            const concessi = (await pool.query(
                `SELECT p.permesso, p.concesso_il, NULLIF(TRIM(COALESCE(c.nome, '') || ' ' || COALESCE(c.cognome, '')), '') AS concesso_da
                   FROM utenti_permessi p LEFT JOIN users c ON c.id = p.concesso_da
                  WHERE p.user_id = $1 ORDER BY p.permesso`, [id])).rows;
            res.json({
                ruoli: persona.ruoli,
                dai_ruoli: [...permessiDeiRuoli(persona.ruoli)],
                in_piu: concessi,
                effettivi: permessiDi(persona.ruoli, concessi.map(c => c.permesso))
            });
        } catch (e) {
            logger.error('Errore GET permessi di una persona:', e);
            res.status(500).json({ message: 'Errore nel leggere i permessi.' });
        }
    });

    // Sostituisce i permessi in più di una persona con quelli indicati.
    app.put('/api/admin/users/:id/permessi', checkAdminRole, async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'ID non valido.' });
        const richiesti = req.body?.in_piu;
        if (!Array.isArray(richiesti) || richiesti.some(p => typeof p !== 'string')) {
            return res.status(400).json({ message: 'Indica i permessi in più come elenco.' });
        }
        const sconosciuti = richiesti.filter(p => !CODICI_PERMESSI.includes(p));
        if (sconosciuti.length) return res.status(400).json({ message: `Permesso sconosciuto: ${sconosciuti.join(', ')}.` });
        const nuovi = [...new Set(richiesti)];
        const client = await pool.connect();
        try {
            const persona = await leggiPersona(id);
            if (!persona) return res.status(404).json({ message: 'Utente non trovato.' });
            if (nuovi.length && (persona.temporaneo || persona.ruoli.includes('esterno'))) {
                return res.status(409).json({ message: 'Agli esterni non si danno permessi: seguono solo l\'emergenza.' });
            }
            await client.query('BEGIN');
            const prima = (await client.query('SELECT permesso FROM utenti_permessi WHERE user_id = $1 FOR UPDATE', [id])).rows.map(r => r.permesso);
            const aggiunti = nuovi.filter(p => !prima.includes(p));
            const tolti = prima.filter(p => !nuovi.includes(p));
            if (tolti.length) await client.query('DELETE FROM utenti_permessi WHERE user_id = $1 AND permesso = ANY($2::text[])', [id, tolti]);
            for (const p of aggiunti) {
                await client.query('INSERT INTO utenti_permessi (user_id, permesso, concesso_da) VALUES ($1, $2, $3)', [id, p, req.user.id]);
            }
            await client.query('COMMIT');
            if (aggiunti.length || tolti.length) {
                registraAudit(req, 'utente.permessi', { tipo: 'utente', id, dettagli: { username: persona.username, aggiunti, tolti } });
            }
            const effettivi = permessiDi(persona.ruoli, nuovi);
            const serveVerifica = mfaRichiesta(persona.ruoli, effettivi) && !persona.mfa_attiva;
            res.json({
                message: (aggiunti.length || tolti.length ? 'Permessi aggiornati.' : 'Nessun cambiamento.') +
                    (serveVerifica ? ' Al prossimo accesso dovrà attivare la verifica in due passaggi.' : ''),
                in_piu: nuovi, effettivi
            });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore PUT permessi di una persona:', e);
            res.status(500).json({ message: 'Errore nel salvare i permessi.' });
        } finally {
            client.release();
        }
    });
}
