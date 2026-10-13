#!/usr/bin/env node
// Decifra un backup fuori dall'applicazione, con il file della chiave o la chiave di recupero.
//   node scripts/decifra-backup.mjs <backup cifrato> <uscita.sql.gz> [file della chiave]
//   ORION_CHIAVE_RECUPERO='XXXX-XXXX-...' node scripts/decifra-backup.mjs <backup> <uscita.sql.gz>

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { apriFileCon, leggiChiaveDiRecupero, leggiFileChiaveDa } from '../src/formatoCifrato.js';

const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [entrata, uscita, fileChiave = process.env.ORION_CHIAVE_FILE || path.join(radice, 'chiave-dati.key')] = process.argv.slice(2);
if (!entrata || !uscita) { console.error('Uso: node scripts/decifra-backup.mjs <backup cifrato> <uscita.sql.gz> [file della chiave]'); process.exit(2); }

const chiave = process.env.ORION_CHIAVE_RECUPERO ? leggiChiaveDiRecupero(process.env.ORION_CHIAVE_RECUPERO) : leggiFileChiaveDa(fileChiave);
if (!chiave) { console.error('Chiave non valida o non trovata: indica il file della chiave o ORION_CHIAVE_RECUPERO.'); process.exit(3); }
try {
    await pipeline(await apriFileCon(chiave, entrata), fs.createWriteStream(uscita, { mode: 0o600 }));
    console.log(`Decifrato in ${uscita}.`);
} catch (e) {
    fs.rmSync(uscita, { force: true });
    console.error(`Non si decifra: chiave sbagliata, oppure il file è troncato o alterato (${e.message}).`);
    process.exit(1);
}
