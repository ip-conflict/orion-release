// src/rubrica.js
//
// La rubrica d'emergenza: i numeri che in sala servono subito, per chi lavora
// al centro operativo. La tengono aggiornata tutti gli operatori interni,
// come le squadre: è un lavoro di sala, e ogni modifica finisce nel registro.

export const CATEGORIE_RUBRICA = ['istituzioni', 'soccorso', 'reperibili', 'ditte', 'associazione', 'altro'];

const LIMITI = { nome: 150, ruolo: 150, ente: 150, telefono: 40, telefono_alt: 40, email: 150, note: 2000 };

// I campi della richiesta, ripuliti e controllati; { errore } se qualcosa non va.
function leggiContatto(corpo) {
    const c = {};
    for (const [campo, massimo] of Object.entries(LIMITI)) {
        const v = corpo?.[campo];
        if (v != null && typeof v !== 'string') return { errore: `Il campo ${campo} non è valido.` };
        const pulito = (v || '').trim();
        if (pulito.length > massimo) return { errore: `Il campo ${campo} è troppo lungo (al massimo ${massimo} caratteri).` };
        c[campo] = pulito || null;
    }
    if (!c.nome) return { errore: 'Serve almeno il nome (della persona o dell\'ufficio).' };
    if (!c.telefono && !c.telefono_alt && !c.email) return { errore: 'Serve almeno un numero di telefono o un indirizzo email.' };
    for (const campo of ['telefono', 'telefono_alt']) {
        if (c[campo] && !/^[0-9+()./\s-]{3,40}$/.test(c[campo])) return { errore: 'Il numero di telefono può contenere solo cifre, spazi, +, -, / e parentesi.' };
    }
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return { errore: "L'indirizzo email non è valido." };
    c.categoria = CATEGORIE_RUBRICA.includes(corpo?.categoria) ? corpo.categoria : 'altro';
    return { contatto: c };
}

export function registraRotteRubrica(app, { pool, logger, nonEsterni, registraAudit, nomeUtente, avvisaClienti }) {
    const COLONNE = 'id, nome, ruolo, ente, categoria, telefono, telefono_alt, email, note, aggiornato_il, aggiornato_da';

    app.get('/api/rubrica', nonEsterni, async (req, res) => {
        try {
            const { rows } = await pool.query(`SELECT ${COLONNE} FROM rubrica
                ORDER BY array_position($1::text[], categoria::text), lower(COALESCE(ente, '')), lower(nome)`, [CATEGORIE_RUBRICA]);
            res.json(rows);
        } catch (e) {
            logger.error('Errore GET /api/rubrica:', e);
            res.status(500).json({ message: 'Errore nel leggere la rubrica.' });
        }
    });

    app.post('/api/rubrica', nonEsterni, async (req, res) => {
        const { contatto: c, errore } = leggiContatto(req.body);
        if (errore) return res.status(400).json({ message: errore });
        try {
            const { rows } = await pool.query(
                `INSERT INTO rubrica (nome, ruolo, ente, categoria, telefono, telefono_alt, email, note, aggiornato_da)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLONNE}`,
                [c.nome, c.ruolo, c.ente, c.categoria, c.telefono, c.telefono_alt, c.email, c.note, nomeUtente(req.user)]);
            registraAudit(req, 'rubrica.contatto_aggiunto', { tipo: 'rubrica', id: rows[0].id, dettagli: { nome: c.nome, ente: c.ente } });
            avvisaClienti('reload_rubrica');
            res.status(201).json(rows[0]);
        } catch (e) {
            logger.error('Errore POST /api/rubrica:', e);
            res.status(500).json({ message: 'Errore nel salvare il contatto.' });
        }
    });

    app.put('/api/rubrica/:id', nonEsterni, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Contatto non valido.' });
        const { contatto: c, errore } = leggiContatto(req.body);
        if (errore) return res.status(400).json({ message: errore });
        try {
            const { rows } = await pool.query(
                `UPDATE rubrica SET nome = $2, ruolo = $3, ente = $4, categoria = $5, telefono = $6, telefono_alt = $7,
                        email = $8, note = $9, aggiornato_il = NOW(), aggiornato_da = $10
                 WHERE id = $1 RETURNING ${COLONNE}`,
                [id, c.nome, c.ruolo, c.ente, c.categoria, c.telefono, c.telefono_alt, c.email, c.note, nomeUtente(req.user)]);
            if (!rows[0]) return res.status(404).json({ message: 'Contatto non trovato.' });
            registraAudit(req, 'rubrica.contatto_modificato', { tipo: 'rubrica', id, dettagli: { nome: c.nome, ente: c.ente } });
            avvisaClienti('reload_rubrica');
            res.json(rows[0]);
        } catch (e) {
            logger.error('Errore PUT /api/rubrica:', e);
            res.status(500).json({ message: 'Errore nel salvare il contatto.' });
        }
    });

    app.delete('/api/rubrica/:id', nonEsterni, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'Contatto non valido.' });
        try {
            const { rows } = await pool.query('DELETE FROM rubrica WHERE id = $1 RETURNING nome, ente, telefono', [id]);
            if (!rows[0]) return res.status(404).json({ message: 'Contatto non trovato.' });
            // Nel registro anche il numero: se lo si è tolto per sbaglio, lo si ritrova.
            registraAudit(req, 'rubrica.contatto_eliminato', { tipo: 'rubrica', id, dettagli: rows[0] });
            avvisaClienti('reload_rubrica');
            res.json({ message: 'Contatto eliminato.' });
        } catch (e) {
            logger.error('Errore DELETE /api/rubrica:', e);
            res.status(500).json({ message: "Errore nell'eliminare il contatto." });
        }
    });
}
