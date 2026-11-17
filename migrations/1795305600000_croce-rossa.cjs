// La Croce Rossa ha una qualifica sua, prima stava con il soccorso sanitario. Gli stessi codici di QUALIFICHE in src/costanti.js.
const PRIMA = ['vvf', 'pc_esterno', 'polizia_locale', 'polizia', 'carabinieri', 'sanitario', 'soccorso_alpino', 'forze_armate', 'altro_ente'];
const DOPO = [...PRIMA, 'croce_rossa'];
const vincoli = (codici) => {
    const ammesse = codici.map(c => `'${c}'`).join(', ');
    return ['users', 'squadre'].map(t => `
        ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${t}_qualifica_valida;
        ALTER TABLE ${t} ADD CONSTRAINT ${t}_qualifica_valida CHECK (qualifica IS NULL OR qualifica IN (${ammesse}));`).join('');
};

exports.up = (pgm) => { pgm.sql(vincoli(DOPO)); };

exports.down = (pgm) => {
    pgm.sql(`
        UPDATE users SET qualifica = 'sanitario' WHERE qualifica = 'croce_rossa';
        UPDATE squadre SET qualifica = 'sanitario' WHERE qualifica = 'croce_rossa';
        UPDATE report_team_assignments SET qualifica = 'sanitario' WHERE qualifica = 'croce_rossa';
        ${vincoli(PRIMA)}
    `);
};
