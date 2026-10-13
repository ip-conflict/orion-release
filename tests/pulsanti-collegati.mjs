// Ogni pulsante con un id nelle pagine deve essere usato da qualche script:
// un pulsante che nessuno ascolta si clicca e non fa niente. Successe al
// "Tesserino da divisa" della segreteria, perso in una riscrittura.
// Senza server: legge solo i file.
//   node tests/pulsanti-collegati.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const radice = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const leggi = (cartella, estensione) => fs.readdirSync(path.join(radice, cartella))
    .filter(f => f.endsWith(estensione)).map(f => ({ nome: `${cartella}/${f}`, testo: fs.readFileSync(path.join(radice, cartella, f), 'utf8') }));

const pagine = [...leggi('public', '.html'), ...leggi('src/admin', '.html')];
const script = leggi('public/js', '.js').map(s => s.testo).join('\n');
const usato = (id, pagina) => {
    const modi = new RegExp(`['"\`]#?${id}['"\`]|#${id}\\b`);
    const inLinea = [...pagina.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    return modi.test(script) || modi.test(inLinea);
};

let scollegati = 0;
for (const { nome, testo } of pagine) {
    for (const [, tag] of testo.matchAll(/(<button\b[^>]*>)/g)) {
        const id = tag.match(/\bid="([^"]+)"/)?.[1];
        if (!id || /\bonclick=|\btype="submit"/.test(tag)) continue;
        if (!usato(id, testo)) {
            console.log(`  FAIL ${nome}: il pulsante #${id} non è usato da nessuno script`);
            scollegati++;
        }
    }
}
console.log(scollegati ? `\n${scollegati} pulsanti scollegati.\n` : 'Tutti i pulsanti sono collegati.');
process.exit(scollegati ? 1 : 0);
