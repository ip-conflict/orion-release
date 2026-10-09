// Gli scenari delle simulazioni (src/scenari.js): preparati con calma, fuori
// dal calendario, con il loro copione; poi si pianificano (diventano
// un'attività con il copione copiato dentro) o si aprono al volo. Lo stesso
// scenario si usa più volte: ogni attività ha la sua copia del copione, e la
// regia la ritocca senza toccare lo scenario.

exports.up = (pgm) => {
    pgm.createTable('scenari', {
        id: 'id',
        titolo: { type: 'text', notNull: true },
        natura: { type: 'text', notNull: true, default: 'addestramento', check: "natura IN ('addestramento', 'esercitazione')" },
        durata_ore: { type: 'integer', notNull: true, default: 3, check: 'durata_ore BETWEEN 1 AND 72' },
        scenario: { type: 'text' },
        obiettivi: { type: 'text' },
        enti: { type: 'text' },
        creato_da: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        aggiornato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    });
    // Un evento del copione sta in un'attività o in uno scenario, mai in tutti e due.
    pgm.alterColumn('copione_eventi', 'attivita_id', { notNull: false });
    pgm.addColumn('copione_eventi', {
        scenario_id: { type: 'integer', references: 'scenari', onDelete: 'CASCADE' }
    });
    pgm.addConstraint('copione_eventi', 'copione_eventi_un_contenitore', {
        check: '(attivita_id IS NULL) <> (scenario_id IS NULL)'
    });
    pgm.createIndex('copione_eventi', ['scenario_id', 'ordine']);
    // Da quale scenario è nata un'attività: per dire quante volte è stato usato.
    pgm.addColumn('attivita', {
        scenario_id: { type: 'integer', references: 'scenari', onDelete: 'SET NULL' }
    });
};

exports.down = (pgm) => {
    pgm.dropColumn('attivita', 'scenario_id');
    pgm.sql('DELETE FROM copione_eventi WHERE scenario_id IS NOT NULL');
    pgm.dropConstraint('copione_eventi', 'copione_eventi_un_contenitore');
    pgm.dropColumn('copione_eventi', 'scenario_id');
    pgm.alterColumn('copione_eventi', 'attivita_id', { notNull: true });
    pgm.dropTable('scenari');
};
