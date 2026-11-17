// "Avvisami delle novità della sala", per chi apre le emergenze. Vuoto vale acceso: è il coordinatore
// fuori sala che ne ha bisogno, e non deve doverlo scoprire.

exports.up = (pgm) => {
    pgm.sql('ALTER TABLE users ADD COLUMN IF NOT EXISTS avvisi_sala boolean;');
};

exports.down = (pgm) => {
    pgm.sql('ALTER TABLE users DROP COLUMN IF EXISTS avvisi_sala;');
};
