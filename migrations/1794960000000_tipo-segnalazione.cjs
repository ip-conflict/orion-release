// Il tipo della segnalazione: gli stessi codici di TIPI_SEGNALAZIONE in src/costanti.js.

const TIPI = ['allagamento', 'albero', 'frana', 'persona', 'viabilita', 'struttura', 'altro'];

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE reports ADD COLUMN IF NOT EXISTS tipo varchar(20) NOT NULL DEFAULT 'altro';
        ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_tipo_valido;
        ALTER TABLE reports ADD CONSTRAINT reports_tipo_valido CHECK (tipo IN (${TIPI.map(t => `'${t}'`).join(', ')}));
    `);
};

exports.down = (pgm) => {
    pgm.sql('ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_tipo_valido; ALTER TABLE reports DROP COLUMN IF EXISTS tipo;');
};
