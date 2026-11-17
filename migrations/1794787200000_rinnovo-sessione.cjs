// Un token per l'impronta per ogni sessione: l'indice parziale lascia stare i token creati prima.

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE token_rinnovo ADD COLUMN IF NOT EXISTS sessione varchar(64);
        CREATE UNIQUE INDEX IF NOT EXISTS token_rinnovo_sessione ON token_rinnovo (sessione) WHERE sessione IS NOT NULL;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS token_rinnovo_sessione;
        ALTER TABLE token_rinnovo DROP COLUMN IF EXISTS sessione;
    `);
};
