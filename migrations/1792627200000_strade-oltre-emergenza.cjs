// Una strada chiusa o una zona interdetta può restare in vigore dopo la
// chiusura dell'emergenza (una frana che tiene chiusa la strada per mesi):
// resta sulla mappa, la gestiscono gli operatori interni, e si toglie quando
// la strada riapre. Il registro resta quello dell'emergenza che l'ha messa.

exports.up = (pgm) => {
    pgm.addColumns('elementi_mappa', {
        oltre_emergenza: { type: 'boolean', notNull: true, default: false }
    }, { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropColumns('elementi_mappa', ['oltre_emergenza'], { ifExists: true });
};
