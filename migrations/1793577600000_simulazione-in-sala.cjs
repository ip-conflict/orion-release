// La simulazione in sala (src/simulazione.js, src/emergenze.js).
//
// Ogni tipo di attività ha una natura: generica (riunione, servizio,
// manutenzione), addestramento o esercitazione. Gli addestramenti e le
// esercitazioni possono avere una simulazione: "allertamento" (si prova solo
// la chiamata dei volontari) o "sala" (si apre la sala come in un'emergenza,
// segnata come simulazione dall'apertura alla stampa). La regia è chi muove
// lo scenario: il responsabile (il direttore) e le persone scelte.
//
// Un'emergenza simulata porta il segno, l'attività da cui nasce e, se una
// vera l'ha fermata, quando e quale.

exports.up = (pgm) => {
    pgm.addColumn('attivita_tipi', {
        natura: { type: 'text', notNull: true, default: 'generica', check: "natura IN ('generica', 'addestramento', 'esercitazione')" }
    }, { ifNotExists: true });
    pgm.sql("UPDATE attivita_tipi SET natura = 'addestramento' WHERE nome = 'Addestramento'");
    pgm.sql("UPDATE attivita_tipi SET natura = 'esercitazione' WHERE nome = 'Esercitazione'");

    pgm.addColumns('attivita', {
        simulazione: { type: 'text', check: "simulazione IS NULL OR simulazione IN ('allertamento', 'sala')" },
        // Lo scenario lo leggono i partecipanti; il copione resta della regia.
        scenario: { type: 'text' },
        obiettivi: { type: 'text' },
        enti: { type: 'text' }
    }, { ifNotExists: true });

    pgm.createTable('attivita_regia', {
        attivita_id: { type: 'integer', notNull: true, references: 'attivita', onDelete: 'CASCADE' },
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' }
    }, { ifNotExists: true });
    pgm.addConstraint('attivita_regia', 'attivita_regia_pkey', { primaryKey: ['attivita_id', 'user_id'] });
    pgm.createIndex('attivita_regia', 'user_id', { ifNotExists: true });

    pgm.addColumns('emergencies', {
        simulazione: { type: 'boolean', notNull: true, default: false },
        attivita_id: { type: 'integer', references: 'attivita', onDelete: 'SET NULL' },
        interrotta_il: { type: 'timestamptz' },
        interrotta_da: { type: 'integer', references: 'emergencies', onDelete: 'SET NULL' }
    }, { ifNotExists: true });
    pgm.createIndex('emergencies', 'attivita_id', { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropColumns('emergencies', ['simulazione', 'attivita_id', 'interrotta_il', 'interrotta_da'], { ifExists: true });
    pgm.dropTable('attivita_regia', { ifExists: true });
    pgm.dropColumns('attivita', ['simulazione', 'scenario', 'obiettivi', 'enti'], { ifExists: true });
    pgm.dropColumns('attivita_tipi', ['natura'], { ifExists: true });
};
