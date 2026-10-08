// Il copione della simulazione e la regia (src/copione.js).
//
// Il copione è la sequenza degli eventi di scenario di un'attività:
// segnalazioni (che entrano da sole o arrivano per telefono), aggravamenti di
// una segnalazione già uscita, comunicazioni alla sala, imprevisti a una
// squadra, strade chiuse. Ognuno esce a un minuto dall'avvio o a mano, e ha
// la risposta attesa e il tempo atteso per la valutazione: li vede solo la
// regia.
//
// Gli esiti sono di ogni sala aperta (un'emergenza simulata): quando un evento
// è uscito, cosa ha creato, se è stato rimandato o saltato. L'orologio della
// regia parte con "Avvia" e si ferma con la pausa. Le osservazioni sono gli
// appunti della regia; il debriefing lo scrivono i registi dopo.

exports.up = (pgm) => {
    pgm.addColumn('attivita', {
        // La regia decide se, a simulazione chiusa, copione e debriefing li vedono i partecipanti.
        copione_pubblicato: { type: 'boolean', notNull: true, default: false }
    }, { ifNotExists: true });

    pgm.createTable('copione_eventi', {
        id: 'id',
        attivita_id: { type: 'integer', notNull: true, references: 'attivita', onDelete: 'CASCADE' },
        ordine: { type: 'integer', notNull: true, default: 0 },
        // Minuti dall'avvio; NULL: esce solo a mano.
        minuto: { type: 'integer', check: 'minuto IS NULL OR minuto BETWEEN 0 AND 10080' },
        tipo: { type: 'text', notNull: true, check: "tipo IN ('segnalazione', 'aggravamento', 'comunicazione', 'imprevisto', 'strada')" },
        titolo: { type: 'text', notNull: true },
        testo: { type: 'text' },
        // Una segnalazione entra da sola nel centro operativo o la regia la telefona.
        modo: { type: 'text', notNull: true, default: 'da_sola', check: "modo IN ('da_sola', 'telefono')" },
        indirizzo: { type: 'text' },
        lat: { type: 'double precision' },
        lng: { type: 'double precision' },
        priorita: { type: 'text', check: "priorita IS NULL OR priorita IN ('High', 'Medium', 'Low')" },
        segnalante: { type: 'text' },
        telefono: { type: 'text' },
        // L'aggravamento: a quale segnalazione del copione si riferisce.
        riferimento_id: { type: 'integer', references: 'copione_eventi', onDelete: 'SET NULL' },
        // L'imprevisto: il nome radio della squadra che lo riceve.
        squadra: { type: 'text' },
        // La strada chiusa o la zona interdetta, disegnata sulla mappa.
        elemento_tipo: { type: 'text', check: "elemento_tipo IS NULL OR elemento_tipo IN ('strada_chiusa', 'zona_interdetta')" },
        geometria: { type: 'jsonb' },
        risposta_attesa: { type: 'text' },
        minuti_attesi: { type: 'integer', check: 'minuti_attesi IS NULL OR minuti_attesi BETWEEN 1 AND 1440' },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        aggiornato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('copione_eventi', ['attivita_id', 'ordine'], { ifNotExists: true });

    pgm.createTable('copione_esiti', {
        emergency_id: { type: 'integer', notNull: true, references: 'emergencies', onDelete: 'CASCADE' },
        evento_id: { type: 'integer', notNull: true, references: 'copione_eventi', onDelete: 'CASCADE' },
        // NULL: ancora da uscire (magari rimandato).
        stato: { type: 'text', check: "stato IS NULL OR stato IN ('uscito', 'saltato')" },
        rimando_minuti: { type: 'integer', notNull: true, default: 0 },
        uscito_il: { type: 'timestamptz' },
        uscito_da: { type: 'text' },
        automatico: { type: 'boolean', notNull: true, default: false },
        report_id: { type: 'integer', references: 'reports', onDelete: 'SET NULL' },
        elemento_id: { type: 'integer', references: 'elementi_mappa', onDelete: 'SET NULL' },
        nota: { type: 'text' }
    }, { ifNotExists: true });
    pgm.addConstraint('copione_esiti', 'copione_esiti_pkey', { primaryKey: ['emergency_id', 'evento_id'] });

    pgm.createTable('regia_orologio', {
        emergency_id: { type: 'integer', primaryKey: true, references: 'emergencies', onDelete: 'CASCADE' },
        avviata_il: { type: 'timestamptz', notNull: true },
        avviata_da: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        pausa_dal: { type: 'timestamptz' },
        // I secondi di pausa già passati: l'orologio li toglie.
        pausa_secondi: { type: 'integer', notNull: true, default: 0 }
    }, { ifNotExists: true });

    pgm.createTable('osservazioni', {
        id: 'id',
        attivita_id: { type: 'integer', notNull: true, references: 'attivita', onDelete: 'CASCADE' },
        emergency_id: { type: 'integer', references: 'emergencies', onDelete: 'CASCADE' },
        evento_id: { type: 'integer', references: 'copione_eventi', onDelete: 'SET NULL' },
        report_id: { type: 'integer', references: 'reports', onDelete: 'SET NULL' },
        testo: { type: 'text', notNull: true },
        autore_id: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        autore_nome: { type: 'text' },
        creata_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    }, { ifNotExists: true });
    pgm.createIndex('osservazioni', 'attivita_id', { ifNotExists: true });

    pgm.createTable('debriefing', {
        attivita_id: { type: 'integer', primaryKey: true, references: 'attivita', onDelete: 'CASCADE' },
        obiettivi_raggiunti: { type: 'text' },
        punti_forza: { type: 'text' },
        criticita: { type: 'text' },
        miglioramenti: { type: 'text' },
        aggiornato_il: { type: 'timestamptz' },
        aggiornato_da: { type: 'text' },
        concluso_il: { type: 'timestamptz' },
        concluso_da: { type: 'text' }
    }, { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropTable('debriefing', { ifExists: true });
    pgm.dropTable('osservazioni', { ifExists: true });
    pgm.dropTable('regia_orologio', { ifExists: true });
    pgm.dropTable('copione_esiti', { ifExists: true });
    pgm.dropTable('copione_eventi', { ifExists: true });
    pgm.dropColumns('attivita', ['copione_pubblicato'], { ifExists: true });
};
