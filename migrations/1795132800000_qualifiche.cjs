// La qualifica di chi viene da fuori (Vigili del Fuoco, Polizia Locale...) e delle loro squadre:
// facoltativa, la sala la usa per distinguerle dalle squadre del gruppo. Gli stessi codici di QUALIFICHE in src/costanti.js.
const CODICI = ['vvf', 'pc_esterno', 'polizia_locale', 'polizia', 'carabinieri', 'sanitario', 'soccorso_alpino', 'forze_armate', 'altro_ente'];
const ammesse = CODICI.map(c => `'${c}'`).join(', ');

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS qualifica varchar(30);
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_qualifica_valida;
        ALTER TABLE users ADD CONSTRAINT users_qualifica_valida CHECK (qualifica IS NULL OR qualifica IN (${ammesse}));
        ALTER TABLE squadre ADD COLUMN IF NOT EXISTS qualifica varchar(30);
        ALTER TABLE squadre DROP CONSTRAINT IF EXISTS squadre_qualifica_valida;
        ALTER TABLE squadre ADD CONSTRAINT squadre_qualifica_valida CHECK (qualifica IS NULL OR qualifica IN (${ammesse}));
        ALTER TABLE report_team_assignments ADD COLUMN IF NOT EXISTS qualifica varchar(30);

        -- Come nome e nome radio: la qualifica dell'assegnazione resta anche se la squadra si scioglie.
        CREATE OR REPLACE FUNCTION assegnazione_nome_squadra() RETURNS trigger AS $$
        BEGIN
            IF NEW.squadra_id IS NOT NULL AND NEW.nome_radio IS NULL THEN
                SELECT s.nome_radio, s.nome, s.qualifica INTO NEW.nome_radio, NEW.squadra_nome, NEW.qualifica
                  FROM squadre s WHERE s.id = NEW.squadra_id;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        CREATE OR REPLACE FUNCTION assegnazione_nome_squadra() RETURNS trigger AS $$
        BEGIN
            IF NEW.squadra_id IS NOT NULL AND NEW.nome_radio IS NULL THEN
                SELECT s.nome_radio, s.nome INTO NEW.nome_radio, NEW.squadra_nome
                  FROM squadre s WHERE s.id = NEW.squadra_id;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        ALTER TABLE report_team_assignments DROP COLUMN IF EXISTS qualifica;
        ALTER TABLE squadre DROP CONSTRAINT IF EXISTS squadre_qualifica_valida;
        ALTER TABLE squadre DROP COLUMN IF EXISTS qualifica;
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_qualifica_valida;
        ALTER TABLE users DROP COLUMN IF EXISTS qualifica;
    `);
};
