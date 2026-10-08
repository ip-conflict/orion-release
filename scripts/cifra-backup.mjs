#!/usr/bin/env node
// scripts/cifra-backup.mjs
//
// Cifra al suo posto un dump del database con la chiave dei dati di ORION.
// Lo chiama backup.sh (il backup notturno, come root) dopo aver verificato
// il dump. Senza chiave non fa niente e lo dice: il backup resta in chiaro.
//
//   node scripts/cifra-backup.mjs <file> [file della chiave]

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { MAGIA, flussoCifratoCon, leggiFileChiaveDa } from '../src/formatoCifrato.js';

const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [file, fileChiave = process.env.ORION_CHIAVE_FILE || path.join(radice, 'chiave-dati.key')] = process.argv.slice(2);
if (!file) { console.error('Uso: node scripts/cifra-backup.mjs <file> [file della chiave]'); process.exit(2); }

const chiave = leggiFileChiaveDa(fileChiave);
if (!chiave) { console.error(`Chiave dei dati non trovata in ${fileChiave}: il backup resta in chiaro.`); process.exit(3); }

const testa = Buffer.alloc(MAGIA.length);
const fd = fs.openSync(file, 'r'); fs.readSync(fd, testa, 0, MAGIA.length, 0); fs.closeSync(fd);
if (testa.equals(MAGIA)) { console.log(`${file} è già cifrato.`); process.exit(0); }

const info = fs.statSync(file);
const temporaneo = `${file}.cifra-${process.pid}.tmp`;
await pipeline(fs.createReadStream(file), flussoCifratoCon(chiave), fs.createWriteStream(temporaneo, { mode: info.mode & 0o777 }));
try { fs.chownSync(temporaneo, info.uid, info.gid); } catch { /* non root: va bene così */ }
fs.renameSync(temporaneo, file);
console.log(`${file} cifrato.`);
