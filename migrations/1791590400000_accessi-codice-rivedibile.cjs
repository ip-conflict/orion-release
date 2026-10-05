// 1.0.3: il codice di un accesso temporaneo si puo' rivedere, non solo
// rigenerare. Si tiene cifrato (AES-GCM, chiave derivata da JWT_SECRET)
// accanto alla sua impronta, che resta quella con cui si entra.

exports.up = (pgm) => {
    pgm.addColumn('accessi_temporanei', { codice_cifrato: { type: 'text' } }, { ifNotExists: true });
};

exports.down = (pgm) => {
    pgm.dropColumn('accessi_temporanei', 'codice_cifrato', { ifExists: true });
};
