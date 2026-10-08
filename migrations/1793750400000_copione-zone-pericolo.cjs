// Il copione: le zone di pericolo fra gli eventi (src/copione.js).
//
// Un evento "pericolo" disegna sulla mappa della sala una zona di pericolo
// (alluvione, frana o altro), come quelle del piano: le segnalazioni che ci
// cadono dentro prendono il rischio. Chiusa la simulazione, la zona sparisce
// con le strade chiuse simulate.

exports.up = (pgm) => {
    pgm.dropConstraint('copione_eventi', 'copione_eventi_tipo_check', { ifExists: true });
    pgm.addConstraint('copione_eventi', 'copione_eventi_tipo_check', {
        check: "tipo IN ('segnalazione', 'aggravamento', 'comunicazione', 'imprevisto', 'strada', 'pericolo')"
    });
    pgm.dropConstraint('copione_eventi', 'copione_eventi_elemento_tipo_check', { ifExists: true });
    pgm.addConstraint('copione_eventi', 'copione_eventi_elemento_tipo_check', {
        check: "elemento_tipo IS NULL OR elemento_tipo IN ('strada_chiusa', 'zona_interdetta', 'pericolo_alluvione', 'pericolo_frana', 'pericolo_generico')"
    });
};

exports.down = (pgm) => {
    pgm.sql("DELETE FROM copione_eventi WHERE tipo = 'pericolo'");
    pgm.dropConstraint('copione_eventi', 'copione_eventi_tipo_check', { ifExists: true });
    pgm.addConstraint('copione_eventi', 'copione_eventi_tipo_check', {
        check: "tipo IN ('segnalazione', 'aggravamento', 'comunicazione', 'imprevisto', 'strada')"
    });
    pgm.dropConstraint('copione_eventi', 'copione_eventi_elemento_tipo_check', { ifExists: true });
    pgm.addConstraint('copione_eventi', 'copione_eventi_elemento_tipo_check', {
        check: "elemento_tipo IS NULL OR elemento_tipo IN ('strada_chiusa', 'zona_interdetta')"
    });
};
