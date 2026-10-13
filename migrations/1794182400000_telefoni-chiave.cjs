// Il telefono come secondo fattore: si tiene solo la chiave pubblica creata nel telefono.

exports.up = (pgm) => {
    pgm.createTable('telefoni_chiave', {
        id: 'id',
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        chiave_pubblica: { type: 'text', notNull: true, unique: true },
        nome: { type: 'varchar(100)' },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        usato_il: { type: 'timestamptz' }
    }, { ifNotExists: true });
    pgm.createIndex('telefoni_chiave', ['user_id'], { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropTable('telefoni_chiave', { ifExists: true });
};
