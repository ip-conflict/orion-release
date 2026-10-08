// Il quadro della situazione: quello che chi legge il punto di situazione
// fuori dalla sala (Prefettura, Regione, Comune) cerca per primo e che i
// numeri delle segnalazioni non dicono: che cosa succede e come evolve, la
// popolazione coinvolta, i servizi interrotti, le richieste di supporto, chi
// risponde e quando arriva il prossimo aggiornamento. Uno per emergenza,
// scritto dalla sala e corretto a ogni giro.

exports.up = (pgm) => {
    pgm.createTable('quadro_situazione', {
        emergency_id: { type: 'integer', primaryKey: true, references: 'emergencies', onDelete: 'CASCADE' },
        dati: { type: 'jsonb', notNull: true },
        aggiornato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        aggiornato_da: { type: 'varchar(160)' }
    }, { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropTable('quadro_situazione', { ifExists: true });
};
