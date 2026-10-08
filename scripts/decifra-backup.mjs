#!/usr/bin/env node
// scripts/decifra-backup.mjs
//
// Decifra un backup di ORION fuori dall'applicazione, per un ripristino a mano
// o su un'altra macchina. Serve la chiave dei dati: il suo file, oppure la
// chiave di recupero che l'amministratore ha conservato.
//
//   node scripts/decifra-backup.mjs <backup cifrato> <uscita.sql.gz> [file della chiave]
//   ORION_CHIAVE_RECUPERO='XXXX-XXXX-...' node scripts/decifra-backup.mjs <backup> <uscita.sql.gz>
//
// Poi, per esempio:  gunzip -c uscita.sql.gz | sudo -u postgres psql <database>

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
