// La chiamata dei volontari e la loro disponibilità (src/chiamate.js).
//
// Una chiamata è un avviso mandato dalla sala, o da chi organizza
// un'attività, a un gruppo di volontari: rispondono "arrivo", "arrivo fra..."
// o "non posso". La disponibilità è lo stato di ognuno in quel contesto (in
// arrivo, arrivato in sede, non disponibile, congedato): chi è arrivato in
// sede conta come presente anche prima di entrare in una squadra.
//
// Il contesto è un'emergenza (vera o simulata) o un'attività del calendario
// (l'allertamento senza sala): uno dei due, mai entrambi.
//
// Reperibilità e assenze: i turni della settimana, decisi da chi organizza, e
// i periodi in cui una persona ha detto di non esserci.

exports.up = (pgm) => {
    pgm.createTable('chiamate', {
        id: 'id',
        emergency_id: { type: 'integer', references: 'emergencies', onDelete: 'CASCADE' },
        attivita_id: { type: 'integer', references: 'attivita', onDelete: 'CASCADE' },
        messaggio: { type: 'text' },
        // Come sono stati scelti: tutti, i reperibili, chi ha un corso, un elenco.
        criterio: { type: 'text', notNull: true, check: "criterio IN ('tutti', 'reperibili', 'corso', 'scelti')" },
        corso_id: { type: 'integer', references: 'courses_catalog', onDelete: 'SET NULL' },
        avviso_app: { type: 'boolean', notNull: true, default: true },
        avviso_email: { type: 'boolean', notNull: true, default: false },
        // Dopo quanti minuti chi non ha risposto passa fra quelli da chiamare a voce.
        minuti_attesa: { type: 'integer', notNull: true, default: 10, check: 'minuti_attesa BETWEEN 1 AND 240' },
        creata_da: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        creata_da_nome: { type: 'text' },
        creata_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        richiamata_il: { type: 'timestamptz' }
    }, { ifNotExists: true });
    pgm.addConstraint('chiamate', 'chiamate_un_contesto', { check: '(emergency_id IS NULL) <> (attivita_id IS NULL)' });
    pgm.createIndex('chiamate', 'emergency_id', { ifNotExists: true });
    pgm.createIndex('chiamate', 'attivita_id', { ifNotExists: true });

    pgm.createTable('chiamate_persone', {
        chiamata_id: { type: 'integer', notNull: true, references: 'chiamate', onDelete: 'CASCADE' },
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        avvisato_app: { type: 'boolean', notNull: true, default: false },
        avvisato_email: { type: 'boolean', notNull: true, default: false },
        chiamato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.addConstraint('chiamate_persone', 'chiamate_persone_pkey', { primaryKey: ['chiamata_id', 'user_id'] });
    pgm.createIndex('chiamate_persone', 'user_id', { ifNotExists: true });

    pgm.createTable('disponibilita', {
        id: 'id',
        emergency_id: { type: 'integer', references: 'emergencies', onDelete: 'CASCADE' },
        attivita_id: { type: 'integer', references: 'attivita', onDelete: 'CASCADE' },
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        stato: { type: 'text', notNull: true, check: "stato IN ('in_arrivo', 'arrivato', 'non_disponibile', 'congedato')" },
        // La risposta data alla chiamata, se c'è stata.
        risposta: { type: 'text', check: "risposta IS NULL OR risposta IN ('arrivo', 'ritardo', 'no')" },
        minuti_ritardo: { type: 'integer' },
        risposto_il: { type: 'timestamptz' },
        arrivo_previsto: { type: 'timestamptz' },
        arrivato_il: { type: 'timestamptz' },
        congedato_il: { type: 'timestamptz' },
        nota: { type: 'text' },
        aggiornato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        aggiornato_da: { type: 'text' }
    }, { ifNotExists: true });
    pgm.addConstraint('disponibilita', 'disponibilita_un_contesto', { check: '(emergency_id IS NULL) <> (attivita_id IS NULL)' });
    pgm.sql('CREATE UNIQUE INDEX IF NOT EXISTS disponibilita_emergenza_unica ON disponibilita (emergency_id, user_id) WHERE emergency_id IS NOT NULL');
    pgm.sql('CREATE UNIQUE INDEX IF NOT EXISTS disponibilita_attivita_unica ON disponibilita (attivita_id, user_id) WHERE attivita_id IS NOT NULL');

    pgm.createTable('reperibilita', {
        id: 'id',
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        dal: { type: 'date', notNull: true },
        al: { type: 'date', notNull: true },
        nota: { type: 'text' },
        creato_da: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.addConstraint('reperibilita', 'reperibilita_periodo', { check: 'al >= dal' });
    pgm.createIndex('reperibilita', ['dal', 'al'], { ifNotExists: true });

    pgm.createTable('assenze', {
        id: 'id',
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        dal: { type: 'date', notNull: true },
        al: { type: 'date', notNull: true },
        nota: { type: 'text' },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.addConstraint('assenze', 'assenze_periodo', { check: 'al >= dal' });
    pgm.createIndex('assenze', ['user_id', 'dal'], { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropTable('assenze', { ifExists: true });
    pgm.dropTable('reperibilita', { ifExists: true });
    pgm.dropTable('disponibilita', { ifExists: true });
    pgm.dropTable('chiamate_persone', { ifExists: true });
    pgm.dropTable('chiamate', { ifExists: true });
};
