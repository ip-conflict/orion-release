// Il recupero della password cerca l'email in minuscolo. Due account con la stessa email scritta
// in modo diverso restano come sono: unirli o sceglierne uno lo decide una persona.

exports.up = (pgm) => {
    pgm.sql(`
        DO $$
        DECLARE doppie integer;
        BEGIN
            UPDATE users u SET email = lower(u.email)
             WHERE u.email <> lower(u.email)
               AND NOT EXISTS (SELECT 1 FROM users a WHERE a.id <> u.id AND lower(a.email) = lower(u.email));
            SELECT count(*) INTO doppie FROM users WHERE email <> lower(email);
            IF doppie > 0 THEN
                RAISE WARNING 'Email con maiuscole lasciate com''erano in % account: un altro account ha la stessa email.', doppie;
            END IF;
        END $$;
    `);
};

exports.down = () => {};
