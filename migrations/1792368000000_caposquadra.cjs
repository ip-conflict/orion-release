// 1.1.0: il caposquadra. Uno per squadra al massimo, facoltativo: è un segno
// sul membro, così chi esce dalla squadra smette anche di esserlo.
//
// posizioni_squadre.inviata_da: chi ha mandato l'ultima posizione della
// squadra. Con più telefoni nella stessa squadra la manda uno solo (il
// caposquadra, se c'è), e gli altri subentrano solo quando tace.
//
// Il registro delle squadre annota anche nomine e revoche, per il resoconto.

const AZIONI = ['membro_aggiunto', 'membro_rimosso', 'squadra_eliminata', 'caposquadra_nominato', 'caposquadra_tolto'];
const vincolo = (azioni) => `azione IN (${azioni.map(a => `'${a}'`).join(', ')})`;

exports.up = (pgm) => {
    pgm.addColumns('squadra_membri', {
        caposquadra: { type: 'boolean', notNull: true, default: false }
    }, { ifNotExists: true });
    pgm.createIndex('squadra_membri', ['squadra_id'], {
        name: 'squadra_membri_un_caposquadra', unique: true, where: 'caposquadra', ifNotExists: true
    });
    pgm.addColumns('posizioni_squadre', {
        inviata_da: { type: 'varchar(50)' }
    }, { ifNotExists: true });
    pgm.dropConstraint('emergency_team_log', 'emergency_team_log_azione_check', { ifExists: true });
    pgm.addConstraint('emergency_team_log', 'emergency_team_log_azione_check', { check: vincolo(AZIONI) });
};

// Il vincolo del registro resta largo: il registro non si cancella, e le
// nomine già scritte non passerebbero quello di prima.
exports.down = (pgm) => {
    pgm.dropColumns('posizioni_squadre', ['inviata_da'], { ifExists: true });
    pgm.dropIndex('squadra_membri', ['squadra_id'], { name: 'squadra_membri_un_caposquadra', ifExists: true });
    pgm.dropColumns('squadra_membri', ['caposquadra'], { ifExists: true });
};
