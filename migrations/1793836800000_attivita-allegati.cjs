// Gli allegati di un'attività (src/attivita.js): il programma, la scheda
// dell'esercitazione, il volantino, la circolare. Li vede chi vede
// l'attività; li carica e li toglie chi la gestisce. I file stanno in
// protected_uploads/attivita, cifrati come gli altri caricati.

exports.up = (pgm) => {
    pgm.createTable('attivita_allegati', {
        id: 'id',
        attivita_id: { type: 'integer', notNull: true, references: 'attivita', onDelete: 'CASCADE' },
        file: { type: 'text', notNull: true },
        nome_originale: { type: 'text', notNull: true },
        tipo: { type: 'text', notNull: true },
        dimensione: { type: 'integer', notNull: true },
        caricato_da: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        caricato_da_nome: { type: 'text' },
        caricato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    });
    pgm.createIndex('attivita_allegati', 'attivita_id');
};

exports.down = (pgm) => {
    pgm.dropTable('attivita_allegati');
};
