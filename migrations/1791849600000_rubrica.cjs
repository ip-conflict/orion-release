// 1.0.3: la rubrica d'emergenza. I numeri che in sala servono subito
// (Prefettura, reperibili del Comune, la ditta col camion gru) in un posto
// solo, dal centro operativo, e stampabile per quando la rete non c'è.

exports.up = (pgm) => {
    pgm.createTable('rubrica', {
        id: 'id',
        nome: { type: 'varchar(150)', notNull: true },
        ruolo: { type: 'varchar(150)' },
        ente: { type: 'varchar(150)' },
        categoria: { type: 'varchar(20)', notNull: true, default: 'altro' },
        telefono: { type: 'varchar(40)' },
        telefono_alt: { type: 'varchar(40)' },
        email: { type: 'varchar(150)' },
        note: { type: 'text' },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') },
        aggiornato_il: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') },
        aggiornato_da: { type: 'varchar(150)' }
    }, { ifNotExists: true });
    pgm.addConstraint('rubrica', 'rubrica_categoria_check', {
        check: "categoria IN ('istituzioni', 'soccorso', 'reperibili', 'ditte', 'associazione', 'altro')"
    });
};

exports.down = (pgm) => {
    pgm.dropTable('rubrica', { ifExists: true });
};
