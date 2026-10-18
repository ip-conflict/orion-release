#!/usr/bin/env node
// Cifra stdin su stdout con la chiave dei dati; senza chiave si ferma, perché quello che esce
// va su un disco che può perdersi. Lo usa l'agente per l'archivio dei file sul disco esterno.
//   tar -C /dati -cz uploads protected_uploads | node scripts/cifra-flusso.mjs > file.tar.gz

import { pipeline } from 'stream/promises';
import { flussoCifratoCon, leggiFileChiaveDa } from '../src/formatoCifrato.js';

const chiave = process.env.ORION_CHIAVE_FILE ? leggiFileChiaveDa(process.env.ORION_CHIAVE_FILE) : null;
if (!chiave) {
    console.error('Chiave dei dati non disponibile: niente archivio in chiaro.');
    process.exit(3);
}
try {
    await pipeline(process.stdin, flussoCifratoCon(chiave), process.stdout);
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
