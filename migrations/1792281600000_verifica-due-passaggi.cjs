// 1.1.0: la verifica in due passaggi. Dopo la password un codice a tempo
// (TOTP, RFC 6238) da un'app sul telefono, o uno dei codici di riserva.
// Obbligatoria per gli amministratori, facoltativa per gli altri, esclusa per
// gli accessi esterni temporanei.
//
// mfa_segreto: il segreto condiviso con l'app, cifrato con la chiave dei dati
// (enc1:...). mfa_ultimo_passo: l'ultimo intervallo di 30 secondi usato, perché
// lo stesso codice non valga due volte. I codici di riserva si tengono solo
// come impronta. token_rinnovo.mfa: il token è nato da un accesso con la
// verifica, e solo allora vale per chi la deve fare.

exports.up = (pgm) => {
    pgm.addColumns('users', {
        mfa_attiva: { type: 'boolean', notNull: true, default: false },
        mfa_segreto: { type: 'text' },
        mfa_attivata_il: { type: 'timestamptz' },
        mfa_ultimo_passo: { type: 'bigint' }
    }, { ifNotExists: true });
    pgm.createTable('mfa_codici_riserva', {
        id: 'id',
        user_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
        impronta: { type: 'text', notNull: true },
        usato_il: { type: 'timestamptz' }
    }, { ifNotExists: true });
    pgm.createIndex('mfa_codici_riserva', ['user_id'], { ifNotExists: true });
    pgm.addColumns('token_rinnovo', {
        mfa: { type: 'boolean', notNull: true, default: false }
    }, { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropColumns('token_rinnovo', ['mfa'], { ifExists: true });
    pgm.dropTable('mfa_codici_riserva', { ifExists: true });
    pgm.dropColumns('users', ['mfa_attiva', 'mfa_segreto', 'mfa_attivata_il', 'mfa_ultimo_passo'], { ifExists: true });
};
