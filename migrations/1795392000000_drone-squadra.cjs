// Il drone legato a chi lo vede dall'app: il pilota (e allora conta la sua squadra) o, senza pilota, una squadra scelta.
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE chiavi_drone ADD COLUMN IF NOT EXISTS pilota_id integer REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE chiavi_drone ADD COLUMN IF NOT EXISTS squadra_id integer REFERENCES squadre(id) ON DELETE SET NULL;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE chiavi_drone DROP COLUMN IF EXISTS squadra_id;
        ALTER TABLE chiavi_drone DROP COLUMN IF EXISTS pilota_id;
    `);
};
