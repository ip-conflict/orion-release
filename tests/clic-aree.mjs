// Le aree di ORION usate con i clic, una dopo l'altra: magazzino, segreteria, calendario, chiamata,
// funzioni di supporto, documenti, utenti e sistema, mappa, copione e regia, drone (i giri sono in tests/clic/).
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... [ORION_CHROMIUM=/percorso/chrome] node tests/clic-aree.mjs [area...]
// Apre e chiude emergenze e simulazioni sue: vuole un'istanza di collaudo senza emergenze in corso.

import { spawn } from 'child_process';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const CARTELLA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'clic');
const AREE = ['magazzino', 'segreteria', 'calendario', 'chiamata', 'funzioni', 'documenti', 'utenti', 'mappa', 'regia', 'drone'];
const scelte = process.argv.slice(2).filter(a => AREE.includes(a));

console.log('\nLe aree con i clic');
const rotte = [];
for (const area of scelte.length ? scelte : AREE) {
    console.log(`\n${area}`);
    const codice = await new Promise(risolvi => {
        const figlio = spawn(process.execPath, [path.join(CARTELLA, `${area}.mjs`)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        // Riga per riga e rientrate, come le altre prove: la batteria conta le righe OK e FAIL.
        for (const flusso of [figlio.stdout, figlio.stderr]) readline.createInterface({ input: flusso }).on('line', r => console.log(`  ${r}`));
        figlio.on('close', risolvi);
    });
    if (codice !== 0) rotte.push(area);
}

console.log(rotte.length ? `\nAree con i clic: rotte ${rotte.join(', ')}\n` : '\nAree con i clic: tutto a posto\n');
process.exit(rotte.length ? 1 : 0);
