// Chi viene eliminato ma compare nello storico (segnalazioni, aggiornamenti,
// documenti delle emergenze) non si può cancellare senza rompere il registro:
// la riga resta con il solo nome e cognome e tutto il resto si cancella.
// eliminato_il la segna: non compare più negli elenchi e non si riattiva.

exports.up = (pgm) => {
    pgm.addColumns('users', {
        eliminato_il: { type: 'timestamptz' }
    }, { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropColumns('users', ['eliminato_il'], { ifExists: true });
};
