// 1.1.0: gli elementi disegnati sulla mappa. Due famiglie nella stessa
// tabella: quelli del piano (emergency_id NULL), che restano fra
// un'emergenza e l'altra (zone di pericolosità, aree di attesa e di
// accoglienza, spesso importate da QGIS), e quelli di un'emergenza (strade
// chiuse, zone interdette), che si tolgono quando la situazione cambia ma
// restano nel registro con chi e quando.
//
// La forma è GeoJSON in WGS84 (gradi): niente PostGIS, la mappa la disegna
// il browser.

exports.up = (pgm) => {
    pgm.createTable('elementi_mappa', {
        id: 'id',
        emergency_id: { type: 'integer', references: 'emergencies', onDelete: 'CASCADE' },
        tipo: { type: 'varchar(30)', notNull: true },
        nome: { type: 'varchar(150)' },
        livello: { type: 'varchar(40)' },
        note: { type: 'text' },
        geometria: { type: 'jsonb', notNull: true },
        origine: { type: 'varchar(150)' },
        creato_il: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') },
        creato_da: { type: 'varchar(150)' },
        modificato_il: { type: 'timestamptz' },
        modificato_da: { type: 'varchar(150)' },
        rimosso_il: { type: 'timestamptz' },
        rimosso_da: { type: 'varchar(150)' }
    }, { ifNotExists: true });
    pgm.addConstraint('elementi_mappa', 'elementi_mappa_tipo_check', {
        check: `tipo IN ('strada_chiusa', 'zona_interdetta', 'pericolo_alluvione', 'pericolo_frana',
                         'area_attesa', 'area_accoglienza', 'area_ammassamento', 'altro')`
    });
    pgm.createIndex('elementi_mappa', 'emergency_id', { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropTable('elementi_mappa', { ifExists: true });
};
