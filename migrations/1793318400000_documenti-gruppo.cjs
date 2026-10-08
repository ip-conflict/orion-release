// L'archivio dei documenti del gruppo (src/documenti.js): cartelle,
// documenti con le loro versioni (caricarne una nuova conserva le vecchie) e
// il collegamento ai beni del magazzino, per i libretti d'uso e manutenzione.

exports.up = (pgm) => {
    pgm.createTable('documenti_cartelle', {
        id: 'id',
        nome: { type: 'text', notNull: true, unique: true },
        descrizione: { type: 'text' },
        ordine: { type: 'integer', notNull: true, default: 0 }
    }, { ifNotExists: true });

    pgm.createTable('documenti', {
        id: 'id',
        cartella_id: { type: 'integer', references: 'documenti_cartelle', onDelete: 'SET NULL' },
        titolo: { type: 'text', notNull: true },
        descrizione: { type: 'text' },
        // Chi lo vede: tutti gli interni, o solo chi ha uno dei ruoli indicati.
        visibilita: { type: 'text', notNull: true, default: 'interni', check: "visibilita IN ('interni', 'ruoli')" },
        ruoli: { type: 'text[]', notNull: true, default: pgm.func("'{}'") },
        // Consultabile anche dagli esterni, mentre un'emergenza è aperta.
        in_emergenza: { type: 'boolean', notNull: true, default: false },
        // Sul telefono resta consultabile senza rete.
        sempre_con_me: { type: 'boolean', notNull: true, default: false },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        creato_da: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        aggiornato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    }, { ifNotExists: true });

    pgm.createTable('documenti_versioni', {
        id: 'id',
        documento_id: { type: 'integer', notNull: true, references: 'documenti', onDelete: 'CASCADE' },
        numero: { type: 'integer', notNull: true },
        file: { type: 'text', notNull: true },
        nome_originale: { type: 'text', notNull: true },
        tipo: { type: 'text', notNull: true },
        dimensione: { type: 'bigint', notNull: true },
        impronta: { type: 'text', notNull: true },
        nota: { type: 'text' },
        caricato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
        caricato_da: { type: 'integer', references: 'users', onDelete: 'SET NULL' },
        // Il nome resta anche se la persona viene eliminata.
        caricato_da_nome: { type: 'text' }
    }, { ifNotExists: true });
    pgm.addConstraint('documenti_versioni', 'documenti_versioni_numero_unico', { unique: ['documento_id', 'numero'] });

    pgm.createTable('documenti_beni', {
        documento_id: { type: 'integer', notNull: true, references: 'documenti', onDelete: 'CASCADE' },
        bene_id: { type: 'integer', notNull: true, references: 'beni', onDelete: 'CASCADE' }
    }, { ifNotExists: true });
    pgm.addConstraint('documenti_beni', 'documenti_beni_pkey', { primaryKey: ['documento_id', 'bene_id'] });
    pgm.createIndex('documenti_beni', 'bene_id', { ifNotExists: true });

    // Le cartelle di partenza: si rinominano e si tolgono a piacere.
    pgm.sql(`INSERT INTO documenti_cartelle (nome, descrizione, ordine) VALUES
        ('Piano di protezione civile', 'Il piano comunale e i suoi allegati', 1),
        ('Procedure operative', 'Come si fa: procedure, schede di intervento, istruzioni', 2),
        ('Libretti d''uso e manutenzione', 'I libretti delle attrezzature e dei mezzi', 3),
        ('Moduli', 'Moduli da compilare e stampare', 4),
        ('Verbali e delibere', 'Verbali delle riunioni e decisioni del gruppo', 5)
        ON CONFLICT (nome) DO NOTHING`);
};

exports.down = (pgm) => {
    pgm.dropTable('documenti_beni', { ifExists: true });
    pgm.dropTable('documenti_versioni', { ifExists: true });
    pgm.dropTable('documenti', { ifExists: true });
    pgm.dropTable('documenti_cartelle', { ifExists: true });
};
