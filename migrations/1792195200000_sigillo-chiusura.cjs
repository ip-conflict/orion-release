// 1.1.0: il sigillo dello storico preso alla chiusura di un'emergenza. Lo si
// mostra a chi la chiude, va per email agli amministratori e si stampa nel
// resoconto: è il "timbro" di com'era lo storico quando l'emergenza è finita.

exports.up = (pgm) => {
    pgm.addColumn('emergencies', { sigillo_chiusura: { type: 'text' } }, { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropColumn('emergencies', 'sigillo_chiusura', { ifExists: true });
};
