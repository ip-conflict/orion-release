// 1.0.3: chi è intervenuto su una segnalazione resta scritto anche quando la
// squadra non c'è più. Le squadre vuote si chiudono d'ufficio alla fine
// dell'emergenza e si possono sciogliere all'apertura della successiva: prima
// le loro assegnazioni sparivano con loro, e resoconti e archivio dicevano
// "nessuna squadra" su interventi fatti.
//
// L'assegnazione tiene il nome radio e il nome della squadra di allora (li
// scrive un trigger, qualunque sia la rotta che assegna); eliminata la
// squadra, squadra_id diventa NULL e il resto rimane.

exports.up = (pgm) => {
    pgm.addColumns('report_team_assignments', {
        nome_radio: { type: 'varchar(15)' },
        squadra_nome: { type: 'varchar(255)' }
    }, { ifNotExists: true });

    pgm.sql(`
        UPDATE report_team_assignments a
           SET nome_radio = s.nome_radio, squadra_nome = s.nome
          FROM squadre s
         WHERE s.id = a.squadra_id AND a.nome_radio IS NULL;

        CREATE OR REPLACE FUNCTION assegnazione_nome_squadra() RETURNS trigger AS $$
        BEGIN
            IF NEW.squadra_id IS NOT NULL AND NEW.nome_radio IS NULL THEN
                SELECT s.nome_radio, s.nome INTO NEW.nome_radio, NEW.squadra_nome
                  FROM squadre s WHERE s.id = NEW.squadra_id;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS assegnazione_nome_squadra ON report_team_assignments;
        CREATE TRIGGER assegnazione_nome_squadra
            BEFORE INSERT ON report_team_assignments
            FOR EACH ROW EXECUTE FUNCTION assegnazione_nome_squadra();

        ALTER TABLE report_team_assignments ALTER COLUMN squadra_id DROP NOT NULL;
        ALTER TABLE report_team_assignments DROP CONSTRAINT IF EXISTS report_team_assignments_squadra_id_fkey;
        ALTER TABLE report_team_assignments ADD CONSTRAINT report_team_assignments_squadra_id_fkey
            FOREIGN KEY (squadra_id) REFERENCES squadre(id) ON DELETE SET NULL;

        -- Le assegnazioni già perse si ritrovano nel diario delle segnalazioni,
        -- dove il sistema ha scritto "Squadra 'Alfa' assegnata." e, se tolta,
        -- "Assegnazione Squadra 'Alfa' rimossa.": vale l'ultima delle due.
        INSERT INTO report_team_assignments (report_id, squadra_id, nome_radio, assigned_at)
        SELECT e.report_id, NULL, LEFT(e.nome_radio, 15), e.quando
        FROM (
            SELECT DISTINCT ON (ru.report_id, m.nome_radio)
                   ru.report_id, m.nome_radio, ru.update_timestamp AS quando, m.azione
            FROM report_updates ru
            CROSS JOIN LATERAL (
                SELECT (regexp_match(ru.update_text, '^Squadra ''(.+)'' assegnata\.$'))[1] AS nome_radio, 'assegnata' AS azione
                UNION ALL
                SELECT (regexp_match(ru.update_text, '^Assegnazione Squadra ''(.+)'' rimossa\.$'))[1], 'rimossa'
            ) m
            WHERE ru.is_system AND m.nome_radio IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM report_team_assignments a WHERE a.report_id = ru.report_id)
            ORDER BY ru.report_id, m.nome_radio, ru.update_timestamp DESC, ru.id DESC
        ) e
        WHERE e.azione = 'assegnata';
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        DELETE FROM report_team_assignments WHERE squadra_id IS NULL;
        ALTER TABLE report_team_assignments DROP CONSTRAINT IF EXISTS report_team_assignments_squadra_id_fkey;
        ALTER TABLE report_team_assignments ADD CONSTRAINT report_team_assignments_squadra_id_fkey
            FOREIGN KEY (squadra_id) REFERENCES squadre(id) ON DELETE CASCADE;
        ALTER TABLE report_team_assignments ALTER COLUMN squadra_id SET NOT NULL;
        DROP TRIGGER IF EXISTS assegnazione_nome_squadra ON report_team_assignments;
        DROP FUNCTION IF EXISTS assegnazione_nome_squadra();
    `);
    pgm.dropColumns('report_team_assignments', ['nome_radio', 'squadra_nome'], { ifExists: true });
};
