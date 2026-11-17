// Nelle installazioni in servizio possono esserci già numeri doppi: con quelli l'indice non si
// crea e il server non partirebbe. Allora si lascia stare, e il blocco nel codice basta a non farne altri.

exports.up = (pgm) => {
    pgm.sql(`
        DO $$
        DECLARE doppi integer;
        BEGIN
            SELECT count(*) INTO doppi FROM (
                SELECT 1 FROM reports
                 WHERE emergency_id IS NOT NULL AND emergency_report_number IS NOT NULL
                 GROUP BY emergency_id, emergency_report_number HAVING count(*) > 1) d;
            IF doppi > 0 THEN
                RAISE WARNING 'Numeri delle segnalazioni doppi in % casi: l''indice unico non si crea, i numeri esistenti restano come sono.', doppi;
            ELSE
                CREATE UNIQUE INDEX IF NOT EXISTS reports_numero_unico ON reports (emergency_id, emergency_report_number);
            END IF;
        END $$;
    `);
};

exports.down = (pgm) => {
    pgm.sql('DROP INDEX IF EXISTS reports_numero_unico;');
};
