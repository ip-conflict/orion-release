// La presa visione dell'informativa sul trattamento dei dati e delle
// condizioni d'uso. Sull'utente la versione vista (il controllo a ogni
// richiesta costa niente); nel registro ogni presa visione, con l'impronta dei
// testi mostrati: è la prova di che cosa ha letto e quando, anche dopo che i
// testi sono cambiati o la persona non c'è più.

exports.up = (pgm) => {
    pgm.addColumns('users', {
        presa_visione_versione: { type: 'integer' },
        presa_visione_il: { type: 'timestamptz' }
    }, { ifNotExists: true });
    pgm.createTable('prese_visione', {
        id: 'id',
        user_id: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        // Chi era, scritto per esteso: la riga resta leggibile anche se l'utente si elimina.
        persona: { type: 'varchar(160)', notNull: true },
        versione: { type: 'integer', notNull: true },
        impronta_testi: { type: 'varchar(64)', notNull: true },
        canale: { type: 'varchar(10)', notNull: true, default: 'web' },
        quando: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('prese_visione', ['user_id', 'versione'], { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropTable('prese_visione', { ifExists: true });
    pgm.dropColumns('users', ['presa_visione_versione', 'presa_visione_il'], { ifExists: true });
};
