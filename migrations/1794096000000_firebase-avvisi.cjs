// Le notifiche Firebase, se l'associazione le configura: il telefono
// registra il suo identificativo Firebase accanto al token degli avvisi.
// Senza configurazione la colonna resta vuota e tutto va come prima.

exports.up = (pgm) => {
    pgm.addColumn('token_avvisi', {
        fcm_token: { type: 'text' },
        fcm_progetto: { type: 'varchar(100)' },
        fcm_il: { type: 'timestamptz' }
    }, { ifNotExists: true });
    pgm.createIndex('token_avvisi', 'fcm_token', { ifNotExists: true, where: 'fcm_token IS NOT NULL' });
};

exports.down = (pgm) => {
    pgm.dropColumns('token_avvisi', ['fcm_token', 'fcm_progetto', 'fcm_il'], { ifExists: true });
};
