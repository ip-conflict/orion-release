// La conferma della ricezione dall'app o dal profilo compila il verbale: chi
// ha confermato (nome e cognome di quel momento), da dove (app o web) e
// l'impronta di quello che ha confermato (verbale, persona, ora, oggetti).
// La conferma resta anche nel registro delle operazioni, che è sigillato.

exports.up = (pgm) => {
    pgm.addColumns('verbali_consegna', {
        confermato_da: { type: 'varchar(150)' },
        conferma_canale: { type: 'varchar(10)' },
        conferma_impronta: { type: 'char(64)' }
    }, { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropColumns('verbali_consegna', ['confermato_da', 'conferma_canale', 'conferma_impronta'], { ifExists: true });
};
