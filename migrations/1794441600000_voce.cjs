// ORION Voce: i messaggi vocali, chi li ha ascoltati, i canali diretti aperti dalla sala, i
// token con cui il telefono resta collegato alla voce per tutta l'emergenza, e per gli esterni
// temporanei la casella "può parlare sul canale della squadra".
//
// Squadre e persone possono sparire durante l'emergenza: i messaggi tengono una copia del
// nome radio e del nome di chi ha parlato, come fanno le assegnazioni delle squadre.

exports.up = (pgm) => {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS voce_messaggi (
            id serial PRIMARY KEY,
            uuid uuid NOT NULL UNIQUE,
            emergency_id integer NOT NULL REFERENCES emergencies(id) ON DELETE CASCADE,
            canale varchar(30) NOT NULL,
            tipo varchar(10) NOT NULL CHECK (tipo IN ('squadra', 'generale', 'avviso', 'diretto')),
            squadra_id integer REFERENCES squadre(id) ON DELETE SET NULL,
            nome_radio varchar(15),
            persona_id integer REFERENCES users(id) ON DELETE SET NULL,
            autore_id integer REFERENCES users(id) ON DELETE SET NULL,
            autore_nome varchar(120) NOT NULL,
            autore_squadra varchar(15),
            da_sala boolean NOT NULL DEFAULT false,
            report_id integer REFERENCES reports(id) ON DELETE SET NULL,
            priorita varchar(10) NOT NULL DEFAULT 'normale' CHECK (priorita IN ('normale', 'alta', 'emergenza')),
            stato varchar(12) NOT NULL DEFAULT 'in_diretta' CHECK (stato IN ('in_diretta', 'completo', 'interrotto')),
            differito boolean NOT NULL DEFAULT false,
            registrato_il timestamptz NOT NULL,
            arrivato_il timestamptz NOT NULL DEFAULT now(),
            durata_ms integer,
            simulazione boolean NOT NULL DEFAULT false,
            file varchar(200),
            ricevuto_da_id integer REFERENCES users(id) ON DELETE SET NULL,
            ricevuto_da_nome varchar(120),
            ricevuto_il timestamptz,
            ritardo_ms integer,
            latitudine double precision,
            longitudine double precision,
            presa_da_id integer REFERENCES users(id) ON DELETE SET NULL,
            presa_da_nome varchar(120),
            presa_il timestamptz
        );
        CREATE INDEX IF NOT EXISTS voce_messaggi_canale ON voce_messaggi (emergency_id, canale, id);

        CREATE TABLE IF NOT EXISTS voce_ascolti (
            messaggio_id integer NOT NULL REFERENCES voce_messaggi(id) ON DELETE CASCADE,
            user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            ascoltato_il timestamptz NOT NULL DEFAULT now(),
            in_diretta boolean NOT NULL,
            da_sala boolean NOT NULL,
            PRIMARY KEY (messaggio_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS voce_diretti (
            id serial PRIMARY KEY,
            emergency_id integer NOT NULL REFERENCES emergencies(id) ON DELETE CASCADE,
            user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            aperto_da integer REFERENCES users(id) ON DELETE SET NULL,
            aperto_il timestamptz NOT NULL DEFAULT now(),
            chiuso_il timestamptz
        );
        CREATE UNIQUE INDEX IF NOT EXISTS voce_diretti_aperto ON voce_diretti (emergency_id, user_id) WHERE chiuso_il IS NULL;

        CREATE TABLE IF NOT EXISTS token_voce (
            id serial PRIMARY KEY,
            user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            emergency_id integer NOT NULL REFERENCES emergencies(id) ON DELETE CASCADE,
            impronta varchar(64) NOT NULL UNIQUE,
            dispositivo varchar(100),
            creato_il timestamptz NOT NULL DEFAULT now()
        );

        ALTER TABLE users ADD COLUMN IF NOT EXISTS voce_parla boolean NOT NULL DEFAULT true;

        -- Senza vincolo: le note sono storico inalterabile e un "imposta a vuoto" le toccherebbe.
        ALTER TABLE report_updates ADD COLUMN IF NOT EXISTS voce_id integer;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE report_updates DROP COLUMN IF EXISTS voce_id;
        ALTER TABLE users DROP COLUMN IF EXISTS voce_parla;
        DROP TABLE IF EXISTS token_voce;
        DROP TABLE IF EXISTS voce_diretti;
        DROP TABLE IF EXISTS voce_ascolti;
        DROP TABLE IF EXISTS voce_messaggi;
    `);
};
