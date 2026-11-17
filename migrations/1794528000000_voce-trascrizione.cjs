// La trascrizione dei messaggi vocali, fatta sul server, e l'indice per cercarla. Sta sul
// messaggio e non nella nota del diario: le note sono storico inalterabile.

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE voce_messaggi
            ADD COLUMN IF NOT EXISTS trascrizione text,
            ADD COLUMN IF NOT EXISTS trascrizione_stato varchar(8) CHECK (trascrizione_stato IN ('fatta', 'vuota', 'errore')),
            ADD COLUMN IF NOT EXISTS trascritto_il timestamptz,
            ADD COLUMN IF NOT EXISTS trascrizione_ms integer,
            ADD COLUMN IF NOT EXISTS ricerca tsvector GENERATED ALWAYS AS (to_tsvector('italian', coalesce(trascrizione, ''))) STORED;
        CREATE INDEX IF NOT EXISTS voce_messaggi_ricerca ON voce_messaggi USING gin (ricerca);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS voce_messaggi_ricerca;
        ALTER TABLE voce_messaggi
            DROP COLUMN IF EXISTS ricerca,
            DROP COLUMN IF EXISTS trascrizione_ms,
            DROP COLUMN IF EXISTS trascritto_il,
            DROP COLUMN IF EXISTS trascrizione_stato,
            DROP COLUMN IF EXISTS trascrizione;
    `);
};
