// 1.1.0: una zona di pericolo generica, per quello che non è alluvione o
// frana (incendio, crollo, valanga, fuga di gas, inquinamento...): il
// livello e le note dicono di che pericolo si tratta.

const TIPI_PRIMA = ['strada_chiusa', 'zona_interdetta', 'pericolo_alluvione', 'pericolo_frana',
    'area_attesa', 'area_accoglienza', 'area_ammassamento', 'altro'];
const vincolo = (tipi) => `tipo IN (${tipi.map(t => `'${t}'`).join(', ')})`;

exports.up = (pgm) => {
    pgm.dropConstraint('elementi_mappa', 'elementi_mappa_tipo_check', { ifExists: true });
    pgm.addConstraint('elementi_mappa', 'elementi_mappa_tipo_check', { check: vincolo([...TIPI_PRIMA, 'pericolo_generico']) });
};

exports.down = (pgm) => {
    pgm.sql("UPDATE elementi_mappa SET tipo = 'altro' WHERE tipo = 'pericolo_generico'");
    pgm.dropConstraint('elementi_mappa', 'elementi_mappa_tipo_check', { ifExists: true });
    pgm.addConstraint('elementi_mappa', 'elementi_mappa_tipo_check', { check: vincolo(TIPI_PRIMA) });
};
