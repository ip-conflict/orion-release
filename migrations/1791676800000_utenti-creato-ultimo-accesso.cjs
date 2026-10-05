// 1.0.3: per ogni utente la data di creazione e l'ultimo accesso, per la
// tabella di Gestione utenti.
//
// creato_il: da qui in avanti la scrive il database. Per chi c'era già si
// ricostruisce dal registro (creazione, importazione, accesso esterno) o, in
// mancanza, dalla prima cosa che la persona ha fatto; se non c'è traccia
// resta vuota.
//
// ultimo_accesso: lo aggiorna il server agli accessi e, al massimo ogni
// qualche minuto, mentre la persona usa ORION. Per chi c'era già si parte
// dall'ultima traccia nel registro e nei token dell'app.

exports.up = (pgm) => {
    pgm.addColumns('users', {
        creato_il: { type: 'timestamptz' },
        ultimo_accesso: { type: 'timestamptz' }
    }, { ifNotExists: true });

    pgm.sql(`
        UPDATE users u SET creato_il = d.quando
        FROM (
            SELECT u2.id, LEAST(
                (SELECT MIN(a.occurred_at) FROM audit_log a
                  WHERE a.action IN ('utente.creato', 'esterno_temporaneo.creato') AND a.entity_id = u2.id::text),
                (SELECT MIN(a.occurred_at) FROM audit_log a
                  WHERE a.action = 'utenti.importati' AND a.details->'username' ? u2.username),
                (SELECT MIN(t.creato_il) FROM accessi_temporanei t WHERE t.user_id = u2.id),
                (SELECT MIN(a.occurred_at) FROM audit_log a WHERE a.user_id = u2.id)
            ) AS quando
            FROM users u2
        ) d
        WHERE d.id = u.id AND u.creato_il IS NULL AND d.quando IS NOT NULL;

        UPDATE users u SET ultimo_accesso = d.quando
        FROM (
            SELECT u2.id, GREATEST(
                (SELECT MAX(t.usato_il) FROM token_rinnovo t WHERE t.user_id = u2.id),
                (SELECT MAX(t.usato_il) FROM accessi_temporanei t WHERE t.user_id = u2.id),
                (SELECT MAX(a.occurred_at) FROM audit_log a WHERE a.user_id = u2.id)
            ) AS quando
            FROM users u2
        ) d
        WHERE d.id = u.id AND u.ultimo_accesso IS NULL AND d.quando IS NOT NULL;
    `);

    pgm.alterColumn('users', 'creato_il', { default: pgm.func('CURRENT_TIMESTAMP') });
};

exports.down = (pgm) => {
    pgm.dropColumns('users', ['creato_il', 'ultimo_accesso'], { ifExists: true });
};
