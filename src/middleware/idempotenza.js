// Con la rete che va e viene una richiesta può arrivare al server e la
// risposta perdersi per strada: chi la rimanda non deve creare due volte la
// stessa segnalazione o la stessa nota. Chi scrive manda un'intestazione
// Idempotency-Key, sempre la stessa per lo stesso invio: la prima volta la
// richiesta si esegue e la risposta si tiene da parte, le volte dopo si
// restituisce quella senza rifare niente.
//
// Vale per tutte le scritture che portano la chiave, tranne il magazzino che
// la gestisce dentro le sue transazioni (stessa tabella, stesse regole, e
// la sua pulizia settimanale vale anche per queste chiavi).

import crypto from 'crypto';

const FORMATO_CHIAVE = /^[A-Za-z0-9_-]{8,100}$/;
const METODI = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Una richiesta rimasta "in corso" più di così è morta con il server: si rifà.
const ABBANDONATA_DOPO_SECONDI = 120;

export function creaIdempotenza({ pool, logger, escluse = [] }) {
    async function middleware(req, res, next) {
        const chiave = req.get('Idempotency-Key');
        if (chiave === undefined || !METODI.has(req.method) || !req.user?.id) return next();
        if (escluse.some(p => req.path.startsWith(p))) return next();
        if (!FORMATO_CHIAVE.test(chiave)) {
            return res.status(400).json({ message: 'Idempotency-Key non valida: da 8 a 100 caratteri fra lettere, cifre, - e _.' });
        }
        const rotta = `${req.method} ${req.baseUrl}${req.path}`.slice(0, 60);
        const impronta = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
        try {
            // Una richiesta in corso da troppo tempo non finirà più: via la chiave.
            await pool.query(
                `DELETE FROM richieste_idempotenti WHERE user_id = $1 AND chiave = $2
                 AND stato_risposta IS NULL AND creata_il < NOW() - make_interval(secs => $3)`,
                [req.user.id, chiave, ABBANDONATA_DOPO_SECONDI]);
            const presa = await pool.query(
                `INSERT INTO richieste_idempotenti (user_id, chiave, rotta, impronta)
                 VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, chiave) DO NOTHING RETURNING 1`,
                [req.user.id, chiave, rotta, impronta]);
            if (presa.rowCount === 0) {
                const { rows: [riga] } = await pool.query(
                    `SELECT rotta, impronta, stato_risposta, risposta FROM richieste_idempotenti
                     WHERE user_id = $1 AND chiave = $2`, [req.user.id, chiave]);
                if (!riga) return middleware(req, res, next); // sparita nel frattempo: si riprova
                if (riga.rotta !== rotta || riga.impronta !== impronta) {
                    return res.status(422).json({ message: 'Questa Idempotency-Key è già stata usata per una richiesta diversa.' });
                }
                if (riga.stato_risposta === null) {
                    res.set('Retry-After', '3');
                    return res.status(409).json({ message: 'La stessa richiesta è ancora in corso: riprova fra poco.', in_corso: true });
                }
                res.set('Idempotent-Replayed', 'true');
                return res.status(riga.stato_risposta).json(riga.risposta ?? {});
            }
        } catch (e) {
            logger.error('[Idempotenza] Chiave non registrata:', { error: e.message });
            return res.status(500).json({ message: 'Errore interno.' });
        }

        // La risposta si tiene da parte appena il gestore la scrive, anche se
        // chi l'ha chiesta nel frattempo ha perso la rete: rimandando la
        // ritrova. Un errore del server libera la chiave: si riprova davvero.
        let registrata = false;
        const registra = async (stato, corpo) => {
            if (registrata) return;
            registrata = true;
            try {
                if (stato >= 500) {
                    await pool.query('DELETE FROM richieste_idempotenti WHERE user_id = $1 AND chiave = $2', [req.user.id, chiave]);
                } else {
                    await pool.query(
                        `UPDATE richieste_idempotenti SET stato_risposta = $3, risposta = $4
                         WHERE user_id = $1 AND chiave = $2`,
                        [req.user.id, chiave, stato, JSON.stringify(corpo ?? {})]);
                }
            } catch (e) {
                logger.error('[Idempotenza] Risposta non registrata:', { error: e.message });
            }
        };
        const json = res.json.bind(res);
        res.json = (dati) => { registra(res.statusCode, dati); return json(dati); };
        // Risposte senza corpo JSON; se la connessione cade prima che il
        // gestore risponda, la chiave resta "in corso" finché non risponde
        // o non scade.
        res.on('finish', () => registra(res.statusCode, {}));
        next();
    }
    return middleware;
}
