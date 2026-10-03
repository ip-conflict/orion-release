// src/diarioSala.js
//
// Il diario di sala: le note del COC che non riguardano una segnalazione. Si
// leggono nella colonna degli eventi del centro operativo e nel resoconto.
// Non si modificano e non si cancellano: è il brogliaccio della sala.

const LUNGHEZZA_MASSIMA = 2000;

export async function vociDiarioSala(pool, emergencyId) {
    const { rows } = await pool.query(
        `SELECT id, testo, autore_nome, creata_il FROM diario_sala
         WHERE emergency_id = $1 ORDER BY creata_il ASC, id ASC`, [emergencyId]);
    return rows;
}

export function registraRotteDiarioSala(app, { pool, logger, nonEsterni, emergenzaAttiva, nomeUtente, avvisaClienti }) {
    app.post('/api/emergencies/diario-sala', nonEsterni, async (req, res) => {
        const emergenza = emergenzaAttiva();
        if (!emergenza) return res.status(409).json({ message: 'Nessuna emergenza aperta: il diario di sala vive dentro un\'emergenza.' });
        const testo = typeof req.body?.testo === 'string' ? req.body.testo.trim() : '';
        if (!testo) return res.status(400).json({ message: 'Scrivi qualcosa da annotare.' });
        if (testo.length > LUNGHEZZA_MASSIMA) {
            return res.status(400).json({ message: `Una nota sta in ${LUNGHEZZA_MASSIMA} caratteri: dividila in più note.` });
        }
        try {
            const chi = await pool.query('SELECT nome, cognome, username FROM users WHERE id = $1', [req.user.id]);
            const autore = nomeUtente(chi.rows[0]) || req.user.username;
            const { rows: [voce] } = await pool.query(
                `INSERT INTO diario_sala (emergency_id, testo, autore_id, autore_nome)
                 VALUES ($1, $2, $3, $4) RETURNING id, testo, autore_nome, creata_il`,
                [emergenza.id, testo, req.user.id, autore]);
            avvisaClienti('nota_sala', { emergency_id: emergenza.id, voce });
            res.status(201).json(voce);
        } catch (e) {
            logger.error('Errore POST diario di sala:', e);
            res.status(500).json({ message: 'Nota non salvata.' });
        }
    });
}
