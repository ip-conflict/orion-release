#!/usr/bin/env node
// Migrazioni per l'agente dei container: elenco di questa versione, applicazione, ritorno a una
// versione precedente (i suoi nomi da stdin, uno per riga).
//   node scripts/migrazioni.mjs elenco | su | verso < nomi.txt

import { pool } from '../src/db.js';
import { annullaModifiche, applicaMigrazioni, modificheDaAnnullare, nomiMigrazioni } from '../src/migrazioni.js';

const leggiStdin = async () => {
    let testo = '';
    for await (const pezzo of process.stdin) testo += pezzo;
    return testo.split('\n').map(r => r.trim()).filter(r => /^[\w.-]+$/.test(r));
};

let codice = 0;
try {
    const comando = process.argv[2];
    if (comando === 'elenco') {
        for (const nome of await nomiMigrazioni()) console.log(`MIGRAZIONE ${nome}`);
    } else if (comando === 'su') {
        for (const nome of await applicaMigrazioni()) console.log(`APPLICATA ${nome}`);
    } else if (comando === 'verso') {
        const daAnnullare = await modificheDaAnnullare(await leggiStdin());
        if (!daAnnullare.annullabili) {
            console.error(`Non annullabili: ${daAnnullare.nomi.join(', ')}`);
            codice = 3;
        } else if (daAnnullare.nomi.length) {
            await annullaModifiche(daAnnullare.nomi.length);
            for (const nome of daAnnullare.nomi) console.log(`ANNULLATA ${nome}`);
        }
    } else {
        console.error('Uso: node scripts/migrazioni.mjs elenco | su | verso < nomi.txt');
        codice = 2;
    }
} catch (e) {
    console.error(e.message);
    codice = 1;
}
await pool.end().catch(() => {});
process.exit(codice);
