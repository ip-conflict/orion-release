// 1.1.0: lo storico inalterabile.
//
// Le tabelle che fanno da registro (note delle segnalazioni, diario di sala,
// registro delle operazioni, movimenti del magazzino, registro delle squadre)
// non si modificano e non si cancellano: un trigger lo rifiuta. Fanno
// eccezione la cancellazione di un'emergenza archiviata, che l'applicazione
// dichiara con orion.cancellazione_emergenza, e gli "imposta a vuoto" dei
// collegamenti (una persona o una squadra eliminata), che non toccano il
// contenuto registrato.
//
// Ogni riga riceve un'impronta SHA-256 del suo contenuto, e le impronte sono
// legate in catena in registro_integrita: ogni anello contiene il precedente.
// Cambiare, togliere o inserire una riga nel mezzo spezza la catena da lì in
// poi. La sigillatura (orion_sigilla) la fa l'applicazione ogni minuto, non
// il trigger d'inserimento: così chi scrive in sala non aspetta nessuno.
//
// Chi ha in mano il database può ricalcolare tutta la catena: per questo
// l'ultima impronta esce dal server (resoconto, punto di situazione, email
// giornaliera, sigillo scaricabile) e con un sigillo conservato si dimostra
// se lo storico è stato riscritto.
//
// Il contenuto di una riga è una scelta fissa di colonne, con le date in UTC:
// un ALTER TABLE futuro o un fuso orario diverso non cambiano l'impronta. Le
// colonne che il database può mettere a NULL da sé (ON DELETE SET NULL) non
// ne fanno parte.

const TABELLE = ['audit_log', 'diario_sala', 'emergency_team_log', 'movimenti', 'report_updates'];

exports.up = (pgm) => {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS registro_integrita (
            id bigserial PRIMARY KEY,
            quando timestamptz NOT NULL DEFAULT now(),
            evento varchar(30) NOT NULL,
            tabella varchar(40),
            riga_id bigint,
            impronta_riga char(64),
            dettagli jsonb,
            impronta char(64) NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS registro_integrita_riga ON registro_integrita (tabella, riga_id) WHERE evento = 'riga';

        CREATE OR REPLACE FUNCTION orion_utc(t timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$
            SELECT CASE WHEN t IS NULL THEN NULL ELSE to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END
        $$;

        -- to_jsonb scrive le date in ISO con lo scarto orario: si rileggono e si portano in UTC.
        CREATE OR REPLACE FUNCTION orion_ts(v text) RETURNS text LANGUAGE sql STABLE AS $$
            SELECT orion_utc(v::timestamptz)
        $$;

        CREATE OR REPLACE FUNCTION orion_sha(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
            SELECT encode(sha256(convert_to(coalesce(v, ''), 'UTF8')), 'hex')
        $$;

        CREATE OR REPLACE FUNCTION orion_contenuto(tabella text, r jsonb) RETURNS text LANGUAGE sql STABLE AS $$
            SELECT (CASE tabella
                WHEN 'report_updates' THEN jsonb_build_object('id', r->'id', 'report_id', r->'report_id',
                    'quando', orion_ts(r->>'update_timestamp'), 'testo', r->'update_text', 'user_id', r->'user_id', 'di_sistema', r->'is_system')
                WHEN 'diario_sala' THEN jsonb_build_object('id', r->'id', 'emergency_id', r->'emergency_id',
                    'testo', r->'testo', 'autore', r->'autore_nome', 'quando', orion_ts(r->>'creata_il'))
                WHEN 'audit_log' THEN jsonb_build_object('id', r->'id', 'quando', orion_ts(r->>'occurred_at'),
                    'username', r->'username', 'azione', r->'action', 'tipo', r->'entity_type', 'entita', r->'entity_id',
                    'dettagli', r->'details', 'ip', r->'ip_address')
                WHEN 'movimenti' THEN jsonb_build_object('id', r->'id', 'bene_id', r->'bene_id', 'tipo', r->'tipo',
                    'quantita', r->'quantita', 'destinatario_tipo', r->'destinatario_tipo', 'destinatario', r->'destinatario_nome',
                    'bene', r->'bene_denominazione', 'km', r->'km_registrati', 'note', r->'note', 'quando', orion_ts(r->>'quando'),
                    'eseguito_da', r->'eseguito_da', 'proveniva_da', r->'proveniva_da')
                WHEN 'emergency_team_log' THEN jsonb_build_object('id', r->'id', 'emergency_id', r->'emergency_id',
                    'nome_radio', r->'nome_radio', 'squadra', r->'squadra_nome', 'username', r->'username', 'nome', r->'nome',
                    'cognome', r->'cognome', 'azione', r->'azione', 'motivo', r->'motivo', 'quando', orion_ts(r->>'quando'),
                    'eseguita_da', r->'eseguita_da')
            END)::text
        $$;

        -- Un anello: l'impronta precedente più tutto quello che dice questo.
        CREATE OR REPLACE FUNCTION orion_anello(prec text, id bigint, evento text, tabella text, riga_id bigint,
                                                impronta_riga text, dettagli jsonb, quando timestamptz)
        RETURNS text LANGUAGE sql IMMUTABLE AS $$
            SELECT orion_sha(concat_ws('|', coalesce(prec, ''), id::text, evento, coalesce(tabella, ''), coalesce(riga_id::text, ''),
                                       coalesce(impronta_riga, ''), coalesce(dettagli::text, ''), orion_utc(quando)))
        $$;

        -- Un evento a sé (la cancellazione di un'emergenza): si accoda alla catena.
        CREATE OR REPLACE FUNCTION orion_annota_evento(p_evento text, p_dettagli jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
        DECLARE prec text; nuovo bigint; adesso timestamptz := clock_timestamp();
        BEGIN
            PERFORM pg_advisory_xact_lock(hashtext('orion-registro-integrita'));
            SELECT impronta INTO prec FROM registro_integrita ORDER BY id DESC LIMIT 1;
            nuovo := nextval(pg_get_serial_sequence('registro_integrita', 'id'));
            INSERT INTO registro_integrita (id, quando, evento, dettagli, impronta)
            VALUES (nuovo, adesso, p_evento, p_dettagli, orion_anello(prec, nuovo, p_evento, NULL, NULL, NULL, p_dettagli, adesso));
            RETURN nuovo;
        END $$;

        -- Sigilla le righe nuove dei registri: un anello per riga, in ordine.
        CREATE OR REPLACE FUNCTION orion_sigilla() RETURNS integer LANGUAGE plpgsql AS $$
        DECLARE prec text; t text; r record; n integer := 0; nuovo bigint; adesso timestamptz; impr text;
        BEGIN
            PERFORM pg_advisory_xact_lock(hashtext('orion-registro-integrita'));
            SELECT impronta INTO prec FROM registro_integrita ORDER BY id DESC LIMIT 1;
            FOREACH t IN ARRAY ARRAY[${TABELLE.map(t => `'${t}'`).join(', ')}] LOOP
                FOR r IN EXECUTE format(
                    'SELECT x.id, to_jsonb(x) AS j FROM %I x
                      WHERE NOT EXISTS (SELECT 1 FROM registro_integrita g WHERE g.evento = ''riga'' AND g.tabella = %L AND g.riga_id = x.id)
                      ORDER BY x.id', t, t)
                LOOP
                    nuovo := nextval(pg_get_serial_sequence('registro_integrita', 'id'));
                    adesso := clock_timestamp();
                    impr := orion_sha(orion_contenuto(t, r.j));
                    prec := orion_anello(prec, nuovo, 'riga', t, r.id, impr, NULL, adesso);
                    INSERT INTO registro_integrita (id, quando, evento, tabella, riga_id, impronta_riga, impronta)
                    VALUES (nuovo, adesso, 'riga', t, r.id, impr, prec);
                    n := n + 1;
                END LOOP;
            END LOOP;
            RETURN n;
        END $$;

        -- La verifica: la catena anello per anello, poi ogni riga sigillata
        -- confrontata con il suo contenuto di adesso.
        CREATE OR REPLACE FUNCTION orion_verifica() RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE
            prec text; g record; atteso text; anelli bigint := 0; rottura jsonb; t text;
            alterate bigint := 0; mancanti bigint := 0; non_sigillate bigint := 0;
            es_alterate jsonb := '[]'; es_mancanti jsonb := '[]'; parziale record; ultimo record;
        BEGIN
            FOR g IN SELECT * FROM registro_integrita ORDER BY id LOOP
                anelli := anelli + 1;
                atteso := orion_anello(prec, g.id, g.evento, g.tabella, g.riga_id, g.impronta_riga, g.dettagli, g.quando);
                IF rottura IS NULL AND atteso IS DISTINCT FROM g.impronta THEN
                    rottura := jsonb_build_object('id', g.id, 'quando', g.quando, 'tabella', g.tabella, 'riga_id', g.riga_id);
                END IF;
                prec := g.impronta;
            END LOOP;
            FOREACH t IN ARRAY ARRAY[${TABELLE.map(t => `'${t}'`).join(', ')}] LOOP
                EXECUTE format(
                    'WITH tolte AS (
                        SELECT (jsonb_array_elements_text(c.dettagli->''righe''->%L))::bigint AS riga_id
                        FROM registro_integrita c WHERE c.evento = ''cancellazione_emergenza''
                     ), confronto AS (
                        SELECT g.riga_id, x.id IS NULL AS manca, orion_sha(orion_contenuto(%L, to_jsonb(x))) AS adesso, g.impronta_riga
                        FROM registro_integrita g LEFT JOIN %I x ON x.id = g.riga_id
                        WHERE g.evento = ''riga'' AND g.tabella = %L
                     )
                     SELECT count(*) FILTER (WHERE NOT manca AND adesso <> impronta_riga) AS alterate,
                            count(*) FILTER (WHERE manca AND riga_id NOT IN (SELECT riga_id FROM tolte)) AS mancanti,
                            coalesce((SELECT jsonb_agg(riga_id) FROM (SELECT riga_id FROM confronto WHERE NOT manca AND adesso <> impronta_riga ORDER BY riga_id LIMIT 20) a), ''[]'') AS es_alterate,
                            coalesce((SELECT jsonb_agg(riga_id) FROM (SELECT riga_id FROM confronto WHERE manca AND riga_id NOT IN (SELECT riga_id FROM tolte) ORDER BY riga_id LIMIT 20) m), ''[]'') AS es_mancanti,
                            (SELECT count(*) FROM %I y WHERE NOT EXISTS (SELECT 1 FROM registro_integrita h WHERE h.evento = ''riga'' AND h.tabella = %L AND h.riga_id = y.id)) AS non_sigillate
                     FROM confronto', t, t, t, t, t, t) INTO parziale;
                alterate := alterate + parziale.alterate;
                mancanti := mancanti + parziale.mancanti;
                non_sigillate := non_sigillate + parziale.non_sigillate;
                IF parziale.alterate > 0 THEN es_alterate := es_alterate || jsonb_build_object('tabella', t, 'righe', parziale.es_alterate); END IF;
                IF parziale.mancanti > 0 THEN es_mancanti := es_mancanti || jsonb_build_object('tabella', t, 'righe', parziale.es_mancanti); END IF;
            END LOOP;
            SELECT id, impronta, quando INTO ultimo FROM registro_integrita ORDER BY id DESC LIMIT 1;
            RETURN jsonb_build_object(
                'integro', rottura IS NULL AND alterate = 0 AND mancanti = 0,
                'anelli', anelli, 'catena_rotta', rottura,
                'alterate', alterate, 'esempi_alterate', es_alterate,
                'mancanti', mancanti, 'esempi_mancanti', es_mancanti,
                'non_sigillate', non_sigillate,
                'ultimo', CASE WHEN ultimo.id IS NULL THEN NULL ELSE jsonb_build_object('id', ultimo.id, 'impronta', ultimo.impronta, 'quando', ultimo.quando) END);
        END $$;

        -- Il blocco: niente modifiche al contenuto, niente cancellazioni fuori
        -- dalla cancellazione di un'emergenza archiviata.
        CREATE OR REPLACE FUNCTION orion_storico_immutabile() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'TRUNCATE' THEN
                RAISE EXCEPTION 'Lo storico non si svuota (%).', TG_TABLE_NAME USING ERRCODE = 'check_violation';
            ELSIF TG_OP = 'DELETE' THEN
                IF coalesce(current_setting('orion.cancellazione_emergenza', true), '') <> '' THEN RETURN OLD; END IF;
                RAISE EXCEPTION 'Lo storico non si cancella (% %).', TG_TABLE_NAME, OLD.id USING ERRCODE = 'check_violation';
            ELSE
                IF orion_contenuto(TG_TABLE_NAME, to_jsonb(OLD)) IS NOT DISTINCT FROM orion_contenuto(TG_TABLE_NAME, to_jsonb(NEW)) THEN RETURN NEW; END IF;
                RAISE EXCEPTION 'Lo storico non si modifica (% %): una correzione si scrive come nuova voce.', TG_TABLE_NAME, OLD.id USING ERRCODE = 'check_violation';
            END IF;
        END $$;

        CREATE OR REPLACE FUNCTION orion_registro_immutabile() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Il registro di integrità non si modifica.' USING ERRCODE = 'check_violation';
        END $$;

        DROP TRIGGER IF EXISTS registro_integrita_immutabile ON registro_integrita;
        CREATE TRIGGER registro_integrita_immutabile BEFORE UPDATE OR DELETE ON registro_integrita
            FOR EACH ROW EXECUTE FUNCTION orion_registro_immutabile();
        DROP TRIGGER IF EXISTS registro_integrita_non_si_svuota ON registro_integrita;
        CREATE TRIGGER registro_integrita_non_si_svuota BEFORE TRUNCATE ON registro_integrita
            FOR EACH STATEMENT EXECUTE FUNCTION orion_registro_immutabile();
    `);
    for (const t of TABELLE) {
        pgm.sql(`
            DROP TRIGGER IF EXISTS ${t}_immutabile ON ${t};
            CREATE TRIGGER ${t}_immutabile BEFORE UPDATE OR DELETE ON ${t}
                FOR EACH ROW EXECUTE FUNCTION orion_storico_immutabile();
            DROP TRIGGER IF EXISTS ${t}_non_si_svuota ON ${t};
            CREATE TRIGGER ${t}_non_si_svuota BEFORE TRUNCATE ON ${t}
                FOR EACH STATEMENT EXECUTE FUNCTION orion_storico_immutabile();
        `);
    }
};

exports.down = (pgm) => {
    for (const t of TABELLE) {
        pgm.sql(`DROP TRIGGER IF EXISTS ${t}_immutabile ON ${t}; DROP TRIGGER IF EXISTS ${t}_non_si_svuota ON ${t};`);
    }
    pgm.sql(`
        DROP TABLE IF EXISTS registro_integrita;
        DROP FUNCTION IF EXISTS orion_verifica(); DROP FUNCTION IF EXISTS orion_sigilla();
        DROP FUNCTION IF EXISTS orion_annota_evento(text, jsonb);
        DROP FUNCTION IF EXISTS orion_anello(text, bigint, text, text, bigint, text, jsonb, timestamptz);
        DROP FUNCTION IF EXISTS orion_contenuto(text, jsonb); DROP FUNCTION IF EXISTS orion_sha(text);
        DROP FUNCTION IF EXISTS orion_ts(text); DROP FUNCTION IF EXISTS orion_utc(timestamptz);
        DROP FUNCTION IF EXISTS orion_storico_immutabile(); DROP FUNCTION IF EXISTS orion_registro_immutabile();
    `);
};
