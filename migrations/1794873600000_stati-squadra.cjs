// Lo stato di ogni squadra su una segnalazione (partita, sul posto, conclusa, rientrata) e il suo
// storico, che entra nello storico sigillato come le note. Le tre funzioni che elencano le tabelle
// si prendono da storico-inalterabile, con la modifica di scadenza-registro e una tabella in più.

const base = require('./1792108800000_storico-inalterabile.cjs');
const STATI = ['assegnata', 'partita', 'sul_posto', 'conclusa', 'rientrata'];
const DELLA_CATENA = ['orion_contenuto', 'orion_sigilla', 'orion_verifica'];

function sostituisci(testo, prima, dopo) {
    if (!testo.includes(prima)) throw new Error(`Testo atteso non trovato: ${prima.slice(0, 60)}`);
    return testo.split(prima).join(dopo);
}

// Rifare tutta storico-inalterabile riporterebbe orion_verifica a prima di scadenza-registro.
function funzioniDellaCatena(conStati) {
    const pezzi = [];
    base.up({ sql: (s) => pezzi.push(s) });
    const tutto = pezzi[0];
    const funzione = (nome) => {
        const inizio = tutto.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
        const dopo = tutto.indexOf('CREATE OR REPLACE FUNCTION', inizio + 10);
        if (inizio < 0 || dopo < 0) throw new Error(`Funzione ${nome} non trovata nello storico inalterabile.`);
        return tutto.slice(inizio, dopo);
    };
    let [contenuto, sigilla, verifica] = DELLA_CATENA.map(funzione);
    verifica = sostituisci(verifica, "c.evento = ''cancellazione_emergenza''", "c.evento IN (''cancellazione_emergenza'', ''scadenza_registro'')");
    if (conStati) {
        const elenco = "'audit_log', 'diario_sala', 'emergency_team_log', 'movimenti', 'report_updates'";
        sigilla = sostituisci(sigilla, elenco, `${elenco}, 'stati_squadra'`);
        verifica = sostituisci(verifica, elenco, `${elenco}, 'stati_squadra'`);
        // stati_squadra.id è bigint, gli altri integer: la stessa variabile del ciclo non può cambiare tipo a metà.
        sigilla = sostituisci(sigilla, "'SELECT x.id, to_jsonb(x) AS j FROM %I x", "'SELECT x.id::bigint AS id, to_jsonb(x) AS j FROM %I x");
        const caso = "                WHEN 'emergency_team_log' THEN";
        contenuto = sostituisci(contenuto, caso, `                WHEN 'stati_squadra' THEN jsonb_build_object('id', r->'id', 'report_id', r->'report_id',
                    'nome_radio', r->'nome_radio', 'stato', r->'stato', 'quando', orion_ts(r->>'quando'), 'autore', r->'autore_nome')
${caso}`);
    }
    return [contenuto, sigilla, verifica].join('\n');
}

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE report_team_assignments
            ADD COLUMN IF NOT EXISTS stato varchar(20) NOT NULL DEFAULT 'assegnata',
            ADD COLUMN IF NOT EXISTS stato_il timestamptz;
        ALTER TABLE report_team_assignments DROP CONSTRAINT IF EXISTS report_team_assignments_stato_valido;
        ALTER TABLE report_team_assignments ADD CONSTRAINT report_team_assignments_stato_valido
            CHECK (stato IN (${STATI.map(s => `'${s}'`).join(', ')}));

        CREATE TABLE IF NOT EXISTS stati_squadra (
            id bigserial PRIMARY KEY,
            report_id integer NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
            squadra_id integer REFERENCES squadre(id) ON DELETE SET NULL,
            nome_radio varchar(15),
            stato varchar(20) NOT NULL CHECK (stato IN (${STATI.map(s => `'${s}'`).join(', ')})),
            quando timestamptz NOT NULL DEFAULT now(),
            registrato_il timestamptz NOT NULL DEFAULT now(),
            user_id integer REFERENCES users(id) ON DELETE SET NULL,
            autore_nome varchar(255)
        );
        CREATE INDEX IF NOT EXISTS stati_squadra_report ON stati_squadra (report_id, quando);
    `);
    pgm.sql(funzioniDellaCatena(true));
    pgm.sql(`
        DROP TRIGGER IF EXISTS stati_squadra_immutabile ON stati_squadra;
        CREATE TRIGGER stati_squadra_immutabile BEFORE UPDATE OR DELETE ON stati_squadra
            FOR EACH ROW EXECUTE FUNCTION orion_storico_immutabile();
        DROP TRIGGER IF EXISTS stati_squadra_non_si_svuota ON stati_squadra;
        CREATE TRIGGER stati_squadra_non_si_svuota BEFORE TRUNCATE ON stati_squadra
            FOR EACH STATEMENT EXECUTE FUNCTION orion_storico_immutabile();
    `);
};

exports.down = (pgm) => {
    pgm.sql(funzioniDellaCatena(false));
    pgm.sql(`
        DROP TABLE IF EXISTS stati_squadra;
        ALTER TABLE report_team_assignments DROP CONSTRAINT IF EXISTS report_team_assignments_stato_valido;
        ALTER TABLE report_team_assignments DROP COLUMN IF EXISTS stato_il, DROP COLUMN IF EXISTS stato;
    `);
};
