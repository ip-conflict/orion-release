// Il token degli avvisi: uno per telefono, vale solo per ricevere le proprie
// notifiche (la coda e il collegamento in ascolto). Dura molto più della
// sessione, così gli avvisi arrivano anche a chi non apre l'app da giorni;
// ogni uso lo prolunga. Si conserva solo l'impronta, come per il rinnovo.

exports.up = (pgm) => {
    pgm.createTable('token_avvisi', {
        id: 'id',
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        impronta: { type: 'text', notNull: true, unique: true },
        dispositivo: { type: 'text' },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        usato_il: { type: 'timestamptz' },
        scade_il: { type: 'timestamptz', notNull: true }
    }, { ifNotExists: true });
    pgm.createIndex('token_avvisi', 'user_id', { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropTable('token_avvisi', { ifExists: true });
};
