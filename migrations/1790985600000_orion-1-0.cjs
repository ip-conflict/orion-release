// La base di ORION 1.0: lo schema completo e i dati di partenza (i DPI
// proposti, le categorie, il corso base) in un passo solo. Riunisce le 37
// migrazioni della numerazione interna 3.x; il testo sta in db/orion-1.0.sql.
//
// Da qui in avanti ogni cambiamento allo schema e' una migrazione nuova:
// "npm run migrate:create -- nome" le da' un nome col timestamp, che la mette
// in coda a questa.

const fs = require('fs');
const path = require('path');

exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.sql(fs.readFileSync(path.join(__dirname, '..', 'db', 'orion-1.0.sql'), 'utf8'));
};

exports.down = () => {
    throw new Error('La base della 1.0 non si annulla: per tornare indietro si ripristina un backup.');
};
