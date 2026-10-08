// Le attività del gruppo e le presenze (src/attivita.js, src/presenze.js).
//
// Un'attività è un evento del calendario (esercitazione, addestramento,
// servizio, riunione, manutenzione) con chi è convocato e chi ha risposto.
// Le presenze sono le partecipazioni di ognuno, a un'attività conclusa o a
// un'emergenza (queste calcolate dal registro delle squadre alla chiusura):
// le ore finiscono nel libretto personale e negli attestati.
//
// La squadra COC è la squadra della sala: una per emergenza, senza nome radio
// vero, senza posizione e senza interventi.

exports.up = (pgm) => {
    pgm.createTable('attivita_tipi', {
        id: 'id',
        nome: { type: 'text', notNull: true, unique: true },
        ordine: { type: 'integer', notNull: true, default: 0 },
        attivo: { type: 'boolean', notNull: true, default: true }
    }, { ifNotExists: true });
    pgm.sql(`INSERT INTO attivita_tipi (nome, ordine) VALUES
        ('Esercitazione', 1), ('Addestramento', 2), ('Servizio', 3), ('Riunione', 4), ('Manutenzione', 5)
        ON CONFLICT (nome) DO NOTHING`);

    pgm.createTable('attivita', {
        id: 'id',
        tipo_id: { type: 'integer', references: 'attivita_tipi', onDelete: 'SET NULL' },
        titolo: { type: 'text', notNull: true },
        descrizione: { type: 'text' },
        luogo: { type: 'text' },
        inizio: { type: 'timestamptz', notNull: true },
        fine: { type: 'timestamptz', notNull: true },
        // tutti: tutti gli interni; scelti: solo i convocati; aperta: la vede
        // ognuno e aderisce chi vuole, fino ai posti se ci sono.
        convocazione: { type: 'text', notNull: true, default: 'tutti', check: "convocazione IN ('tutti', 'scelti', 'aperta')" },
        posti: { type: 'integer', check: 'posti IS NULL OR posti > 0' },
        avviso_app: { type: 'boolean', notNull: true, default: true },
        avviso_email: { type: 'boolean', notNull: true, default: false },
        responsabile_id: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        // Un addestramento che vale come corso: alla conclusione va nel libretto dei presenti.
        corso_id: { type: 'integer', references: 'courses_catalog', onDelete: 'SET NULL' },
        stato: { type: 'text', notNull: true, default: 'programmata', check: "stato IN ('programmata', 'annullata', 'conclusa')" },
        motivo_annullamento: { type: 'text' },
        conclusa_il: { type: 'timestamptz' },
        creato_da: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        aggiornato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.addConstraint('attivita', 'attivita_fine_dopo_inizio', { check: 'fine >= inizio' });
    pgm.createIndex('attivita', 'inizio', { ifNotExists: true });

    // Convocati e risposte: per "scelti" la riga c'è dall'inizio (convocato);
    // per "tutti" e "aperta" nasce con la risposta.
    pgm.createTable('attivita_persone', {
        attivita_id: { type: 'integer', notNull: true, references: 'attivita', onDelete: 'CASCADE' },
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        convocato: { type: 'boolean', notNull: true, default: false },
        risposta: { type: 'text', check: "risposta IS NULL OR risposta IN ('si', 'no')" },
        risposto_il: { type: 'timestamptz' },
        nota: { type: 'text' }
    }, { ifNotExists: true });
    pgm.addConstraint('attivita_persone', 'attivita_persone_pkey', { primaryKey: ['attivita_id', 'user_id'] });
    pgm.createIndex('attivita_persone', 'user_id', { ifNotExists: true });

    pgm.createTable('partecipazioni', {
        id: 'id',
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        origine: { type: 'text', notNull: true, check: "origine IN ('attivita', 'emergenza')" },
        attivita_id: { type: 'integer', references: 'attivita', onDelete: 'CASCADE' },
        emergency_id: { type: 'integer', references: 'emergencies', onDelete: 'CASCADE' },
        // Quello che c'era scritto allora: il nome dell'attività o il codice dell'emergenza.
        titolo: { type: 'text', notNull: true },
        tipo: { type: 'text', notNull: true },
        inizio: { type: 'timestamptz', notNull: true },
        fine: { type: 'timestamptz', notNull: true },
        minuti: { type: 'integer', notNull: true, check: 'minuti >= 0' },
        // Le squadre in cui è stato, per le emergenze.
        dettaglio: { type: 'text' },
        nota: { type: 'text' },
        corso_utente_id: { type: 'integer', references: 'user_courses', onDelete: 'SET NULL' },
        registrata_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        registrata_da: { type: 'text' },
        corretta_il: { type: 'timestamptz' },
        corretta_da: { type: 'text' }
    }, { ifNotExists: true });
    pgm.addConstraint('partecipazioni', 'partecipazioni_fine_dopo_inizio', { check: 'fine >= inizio' });
    pgm.addConstraint('partecipazioni', 'partecipazioni_origine_coerente', {
        check: "(origine = 'attivita' AND attivita_id IS NOT NULL AND emergency_id IS NULL) OR (origine = 'emergenza' AND emergency_id IS NOT NULL AND attivita_id IS NULL)"
    });
    pgm.sql('CREATE UNIQUE INDEX IF NOT EXISTS partecipazioni_attivita_unica ON partecipazioni (user_id, attivita_id) WHERE attivita_id IS NOT NULL');
    pgm.sql('CREATE UNIQUE INDEX IF NOT EXISTS partecipazioni_emergenza_unica ON partecipazioni (user_id, emergency_id) WHERE emergency_id IS NOT NULL');
    pgm.createIndex('partecipazioni', ['user_id', 'inizio'], { ifNotExists: true });

    pgm.addColumn('squadre', { coc: { type: 'boolean', notNull: true, default: false } }, { ifNotExists: true });

    // Il modulo nasce acceso.
    pgm.sql(`INSERT INTO branding_settings (setting_key, setting_value) VALUES ('attivita_enabled', 'true')
             ON CONFLICT (setting_key) DO NOTHING`);
};

exports.down = (pgm) => {
    pgm.dropColumn('squadre', 'coc', { ifExists: true });
    pgm.dropTable('partecipazioni', { ifExists: true });
    pgm.dropTable('attivita_persone', { ifExists: true });
    pgm.dropTable('attivita', { ifExists: true });
    pgm.dropTable('attivita_tipi', { ifExists: true });
    pgm.sql("DELETE FROM branding_settings WHERE setting_key = 'attivita_enabled'");
};
