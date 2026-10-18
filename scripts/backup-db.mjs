#!/usr/bin/env node
// Dump del database compresso e, se c'è la chiave, cifrato, su stdout: lo usa l'agente dei
// container, che lo scrive dove l'applicazione può leggerlo ma non cancellarlo.
//   node scripts/backup-db.mjs > db_<data>_<motivo>.sql.gz

import 'dotenv/config';
import zlib from 'zlib';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { flussoCifratoCon, leggiFileChiaveDa } from '../src/formatoCifrato.js';

const chiave = process.env.ORION_CHIAVE_FILE ? leggiFileChiaveDa(process.env.ORION_CHIAVE_FILE) : null;
if (!chiave) console.error('Chiave dei dati non disponibile: dump in chiaro.');

// La password nell'ambiente, non negli argomenti: 'ps' li mostra a tutti.
const dump = spawn('pg_dump', ['-h', process.env.DB_HOST, '-p', String(process.env.DB_PORT || 5432),
    '-U', process.env.DB_USER, '-d', process.env.DB_DATABASE, '--no-password'],
    { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' }, stdio: ['ignore', 'pipe', 'inherit'] });
const uscita = new Promise((risolvi, rifiuta) => {
    dump.on('error', rifiuta);
    dump.on('close', c => (c === 0 ? risolvi() : rifiuta(new Error(`pg_dump terminato con codice ${c}`))));
});
try {
    await Promise.all([pipeline(dump.stdout, zlib.createGzip(), ...(chiave ? [flussoCifratoCon(chiave)] : []), process.stdout), uscita]);
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
