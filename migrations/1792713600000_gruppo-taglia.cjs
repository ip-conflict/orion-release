// Il gruppo di taglia di un DPI: busto (giacche, polo, gilet, giubbotti),
// pantaloni o scarpe. Alla consegna, per un DPI mai ricevuto ORION propone la
// taglia che la persona ha in un altro DPI dello stesso gruppo. Lo sceglie
// il magazziniere nella scheda del DPI; quelli proposti all'installazione
// partono già al loro posto.

exports.up = (pgm) => {
    pgm.addColumns('modelli_dpi', {
        gruppo_taglia: { type: 'varchar(12)', check: "gruppo_taglia IN ('busto', 'pantaloni', 'scarpe')" }
    }, { ifNotExists: true });
    pgm.sql(`UPDATE modelli_dpi SET gruppo_taglia = CASE
                 WHEN nome IN ('Giacca alta visibilità', 'Gilet alta visibilità', 'Polo', 'Giubbotto antipioggia') THEN 'busto'
                 WHEN nome = 'Pantaloni da intervento' THEN 'pantaloni'
                 WHEN nome IN ('Scarpe antinfortunistiche', 'Stivali di sicurezza') THEN 'scarpe'
             END
             WHERE standard AND gruppo_taglia IS NULL`);
};

exports.down = (pgm) => {
    pgm.dropColumns('modelli_dpi', ['gruppo_taglia'], { ifExists: true });
};
