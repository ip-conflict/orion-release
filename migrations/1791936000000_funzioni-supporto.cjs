// 1.1.0: le funzioni di supporto del COC (metodo Augustus). Un modulo che si
// accende dalle impostazioni (funzioni_enabled): le funzioni, chi ne fa
// parte e gli incarichi, cioè il compito che una segnalazione affida a una
// funzione, con il perché all'inizio e l'esito alla fine. Un incarico si
// conclude senza chiudere la segnalazione, e viceversa.

exports.up = (pgm) => {
    pgm.createTable('funzioni', {
        id: 'id',
        sigla: { type: 'varchar(10)', notNull: true },
        nome: { type: 'varchar(120)', notNull: true },
        descrizione: { type: 'text' },
        attiva: { type: 'boolean', notNull: true, default: true },
        ordine: { type: 'integer', notNull: true, default: 0 },
        creata_il: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') }
    }, { ifNotExists: true });

    pgm.createTable('funzione_membri', {
        funzione_id: { type: 'integer', notNull: true, references: 'funzioni', onDelete: 'CASCADE' },
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        referente: { type: 'boolean', notNull: true, default: false },
        aggiunto_il: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') },
        aggiunto_da: { type: 'varchar(150)' }
    }, { ifNotExists: true });
    pgm.addConstraint('funzione_membri', 'funzione_membri_pkey', { primaryKey: ['funzione_id', 'user_id'] });
    pgm.createIndex('funzione_membri', 'user_id', { ifNotExists: true });

    pgm.createTable('incarichi', {
        id: 'id',
        report_id: { type: 'integer', notNull: true, references: 'reports', onDelete: 'CASCADE' },
        funzione_id: { type: 'integer', notNull: true, references: 'funzioni', onDelete: 'RESTRICT' },
        motivazione: { type: 'text', notNull: true },
        stato: { type: 'varchar(12)', notNull: true, default: 'aperto' },
        assegnato_il: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') },
        assegnato_da: { type: 'varchar(150)' },
        in_carico_il: { type: 'timestamptz' },
        in_carico_da: { type: 'varchar(150)' },
        concluso_il: { type: 'timestamptz' },
        concluso_da: { type: 'varchar(150)' },
        esito: { type: 'text' }
    }, { ifNotExists: true });
    pgm.addConstraint('incarichi', 'incarichi_stato_check', { check: "stato IN ('aperto', 'in_corso', 'concluso')" });
    pgm.createIndex('incarichi', 'report_id', { ifNotExists: true });
    pgm.createIndex('incarichi', 'funzione_id', { ifNotExists: true });
    // Su una segnalazione, una funzione ha al massimo un incarico in corso.
    pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS incarichi_uno_aperto
             ON incarichi (report_id, funzione_id) WHERE stato <> 'concluso'`);

    // Le note scritte per conto di una funzione si riconoscono nel diario.
    pgm.addColumn('report_updates', {
        funzione_id: { type: 'integer', references: 'funzioni', onDelete: 'SET NULL' }
    }, { ifNotExists: true });

    // Le funzioni del piano comunale (metodo Augustus): si rinominano, si
    // spengono, se ne aggiungono, per farle coincidere con il proprio piano.
    pgm.sql(`
        INSERT INTO funzioni (sigla, nome, descrizione, ordine) VALUES
        ('UC', 'Unità di coordinamento', 'Coordina le funzioni e smista le segnalazioni.', 0),
        ('F1', 'Tecnica e pianificazione', 'Valutazione tecnica degli scenari, monitoraggio, cartografia.', 1),
        ('F2', 'Sanità, assistenza sociale e veterinaria', 'Persone fragili, assistenza sanitaria e sociale, animali.', 2),
        ('F3', 'Volontariato', 'Impiego delle organizzazioni di volontariato.', 3),
        ('F4', 'Materiali e mezzi', 'Risorse, mezzi e materiali disponibili e da reperire.', 4),
        ('F5', 'Servizi essenziali', 'Acqua, luce, gas, telefonia, scuole: ripristino e continuità.', 5),
        ('F6', 'Censimento danni a persone e cose', 'Rilievo dei danni e verifiche di agibilità.', 6),
        ('F7', 'Strutture operative e viabilità', 'Forze dell''ordine, vigili del fuoco, cancelli e chiusure stradali.', 7),
        ('F8', 'Telecomunicazioni', 'Collegamenti radio e reti di comunicazione d''emergenza.', 8),
        ('F9', 'Assistenza alla popolazione', 'Aree di attesa e accoglienza, informazione, pasti, alloggi.', 9);
    `);
};

exports.down = (pgm) => {
    pgm.dropColumn('report_updates', 'funzione_id', { ifExists: true });
    pgm.dropTable('incarichi', { ifExists: true });
    pgm.dropTable('funzione_membri', { ifExists: true });
    pgm.dropTable('funzioni', { ifExists: true });
};
