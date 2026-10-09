// I bollettini di allerta meteo-idro (src/allerta.js): una riga per ogni
// versione pubblicata, con i livelli delle zone della Regione scelta. Il PDF
// si tiene finché serve: quello in vigore e quelli allegati a un'emergenza.
// I documenti di un'emergenza possono ora arrivare da ORION stesso, senza
// una persona che li carica.

exports.up = (pgm) => {
    pgm.createTable('bollettini_allerta', {
        id: 'id',
        chiave: { type: 'varchar(40)', notNull: true, unique: true },
        regione: { type: 'varchar(40)', notNull: true },
        emesso_il: { type: 'timestamptz', notNull: true },
        giorno: { type: 'date', notNull: true },
        tipo: { type: 'varchar(20)', notNull: true, default: 'first' },
        titolo: { type: 'text', notNull: true },
        zone: { type: 'jsonb', notNull: true },
        pdf_file: { type: 'varchar(255)' },
        pdf_nome: { type: 'varchar(255)' },
        scaricato_il: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') }
    });
    pgm.createIndex('bollettini_allerta', ['regione', 'emesso_il']);
    pgm.alterColumn('emergency_documents', 'uploader_user_id', { notNull: false });
    pgm.addColumn('emergency_documents', {
        bollettino_id: { type: 'integer', references: 'bollettini_allerta', onDelete: 'SET NULL' }
    });
    pgm.addConstraint('emergency_documents', 'emergency_documents_bollettino_unico', { unique: ['emergency_id', 'bollettino_id'] });
};

exports.down = (pgm) => {
    pgm.dropConstraint('emergency_documents', 'emergency_documents_bollettino_unico');
    pgm.dropColumn('emergency_documents', 'bollettino_id');
    pgm.sql('DELETE FROM emergency_documents WHERE uploader_user_id IS NULL');
    pgm.alterColumn('emergency_documents', 'uploader_user_id', { notNull: true });
    pgm.dropTable('bollettini_allerta');
};
