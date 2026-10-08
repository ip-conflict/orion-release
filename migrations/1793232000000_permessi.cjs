// Dai ruoli ai permessi (src/permessi.js): il ruolo Coordinatore, pacchetto
// dei permessi delle emergenze, e i permessi in più dati a una persona oltre
// a quelli dei suoi ruoli. Si aggiungono soltanto: chi, cosa, chi l'ha dato e quando.

exports.up = (pgm) => {
    pgm.sql("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'coordinatore' AFTER 'admin'");
    pgm.createTable('utenti_permessi', {
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        permesso: { type: 'text', notNull: true },
        concesso_da: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        concesso_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.addConstraint('utenti_permessi', 'utenti_permessi_pkey', { primaryKey: ['user_id', 'permesso'] });
};

exports.down = (pgm) => {
    // Un valore di un tipo enumerato non si toglie: il ruolo resta, inutilizzato.
    pgm.dropTable('utenti_permessi', { ifExists: true });
};
