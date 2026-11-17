// Il drone: le chiavi con cui un pilota trasmette in un'emergenza (o simulazione) e le registrazioni
// che ne restano, cifrate fra i dati dell'emergenza. Della chiave si tiene l'impronta per riconoscerla
// e la chiave cifrata per costruire l'indirizzo della diretta.
exports.up = (pgm) => {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS chiavi_drone (
            id serial PRIMARY KEY,
            emergency_id integer NOT NULL REFERENCES emergencies(id) ON DELETE CASCADE,
            nome varchar(80) NOT NULL,
            impronta char(64) NOT NULL UNIQUE,
            chiave_cifrata text NOT NULL,
            creata_il timestamptz NOT NULL DEFAULT now(),
            creata_da integer REFERENCES users(id) ON DELETE SET NULL,
            revocata_il timestamptz,
            ultima_diretta_il timestamptz
        );
        CREATE INDEX IF NOT EXISTS chiavi_drone_emergenza ON chiavi_drone (emergency_id);

        CREATE TABLE IF NOT EXISTS registrazioni_drone (
            id serial PRIMARY KEY,
            emergency_id integer NOT NULL REFERENCES emergencies(id) ON DELETE CASCADE,
            chiave_id integer REFERENCES chiavi_drone(id) ON DELETE SET NULL,
            nome_drone varchar(80) NOT NULL,
            iniziata_il timestamptz NOT NULL,
            finita_il timestamptz NOT NULL,
            dimensione bigint NOT NULL,
            file varchar(255) NOT NULL UNIQUE,
            raccolta_il timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS registrazioni_drone_emergenza ON registrazioni_drone (emergency_id, iniziata_il);

        INSERT INTO branding_settings (setting_key, setting_value) VALUES ('drone_enabled', 'false') ON CONFLICT (setting_key) DO NOTHING;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        DROP TABLE IF EXISTS registrazioni_drone;
        DROP TABLE IF EXISTS chiavi_drone;
        DELETE FROM branding_settings WHERE setting_key = 'drone_enabled';
    `);
};
