#!/usr/bin/env node
// Ripristino di un dump senza passare dalla pagina Sistema: lo usa l'agente dei container per
// tornare a una versione precedente con i dati di allora.
//   node scripts/ripristina-db.mjs <file .sql.gz>

import { pool } from '../src/db.js';
import { preparaCifratura, usaChiaveDelFile } from '../src/cifratura.js';
import { ripristinaDatabase, verificaArchivio } from '../src/ripristinoDb.js';

const file = process.argv[2];
if (!file) {
    console.error('Uso: node scripts/ripristina-db.mjs <file .sql.gz>');
    process.exit(2);
}
let codice = 0;
try {
    await preparaCifratura().catch(() => usaChiaveDelFile());
    const verifica = await verificaArchivio(file);
    if (!verifica.valido) throw new Error(`Archivio non utilizzabile: ${verifica.motivo}.`);
    await ripristinaDatabase(file, {
        host: process.env.DB_HOST, porta: process.env.DB_PORT || 5432, utente: process.env.DB_USER,
        database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD || ''
    });
    console.log('RIPRISTINATO');
} catch (e) {
    console.error(e.message);
    codice = 1;
}
await pool.end().catch(() => {});
process.exit(codice);
