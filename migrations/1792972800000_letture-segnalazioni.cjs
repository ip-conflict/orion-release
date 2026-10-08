// Fin dove ciascuno ha letto ogni segnalazione. Prima stava nel browser: si
// perdeva ricaricando la pagina o cambiando computer, e con lei i contatori
// delle novità. Una riga per persona e segnalazione, con l'ora dell'ultima
// voce del diario vista.

exports.up = (pgm) => {
    pgm.createTable('letture_segnalazioni', {
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        report_id: { type: 'integer', notNull: true, references: 'reports', onDelete: 'CASCADE' },
        letta_il: { type: 'timestamptz', notNull: true }
    }, { ifNotExists: true });
    pgm.addConstraint('letture_segnalazioni', 'letture_segnalazioni_pkey', { primaryKey: ['user_id', 'report_id'] });
};

exports.down = (pgm) => {
    pgm.dropTable('letture_segnalazioni', { ifExists: true });
};
