// Controllo statico: il testo che arriva dal server non deve finire dentro una
// pagina senza essere scappato.
//
// Nasce da un difetto vero. Il centro operativo passava i campi delle
// segnalazioni a DOMPurify, che è un sanificatore di HTML, non un escape di
// testo: lasciava passare tranquillamente `<div style="position:fixed;inset:0">`
// e, dentro un attributo, non toccava nemmeno le virgolette. Bastava il titolo
// di una segnalazione scritto da un volontario per coprire lo schermo della
// sala operativa, o per aggiungere attributi a piacere all'elemento.
//
// La regola è una sola e semplice da ricordare:
//
//   TESTO      -> escapeHTML(...)         (scappa anche virgolette e apici)
//   MARKUP     -> DOMPurify.sanitize(..., { ALLOWED_TAGS: [...], ALLOWED_ATTR: [] })
//   ATTRIBUTI  -> solo escapeHTML o encodeURIComponent, mai un sanificatore
//
// Questo controllo non ha bisogno del server né del database: gira in un
// secondo, prima di tutto il resto.

import fs from 'fs';
import path from 'path';

const CARTELLA = path.join(process.cwd(), 'public', 'js');

// Espressioni che non hanno bisogno di escape perché non sono testo libero:
// numeri, lunghezze, valori calcolati dal programma stesso.
const INNOCUE = [
    /^\s*\d+\s*$/,
    /^[^'"]*\?\s*'[^']*'\s*:\s*'[^']*'\s*$/,
    /\.(id|length|rowCount)\s*$/,
    /^(Number|parseInt|parseFloat|Math\.|String\()/,
    /^(escapeHTML|encodeURIComponent|DOMPurify)/,
    /^[A-Z_]{3,}$/           // costanti tutte maiuscole
];

// I dati che arrivano dal server stanno quasi sempre su questi oggetti: sono
// loro a poter contenere quello che qualcuno ha scritto in un campo.
const DATI_DAL_SERVER = /\b(report|user|utente|membro|squadra|team|teamData|teamFullData|evento|update|doc|documento|bene|movimento|verbale|c|m|a|d|s|t|l|v|f|r)\.[a-zA-Z_]/;

let errori = 0;
let avvisi = 0;

function segnala(file, riga, testo, messaggio, grave = true) {
    const dove = `${path.relative(process.cwd(), file)}:${riga}`;
    console.log(`  ${grave ? 'ERRORE' : 'avviso'}  ${dove}\n          ${testo.trim().slice(0, 110)}\n          ${messaggio}`);
    if (grave) errori++; else avvisi++;
}

const ATTRIBUTO = /\b([a-zA-Z-]+)\s*=\s*"([^"]*\$\{[^}]*\}[^"]*)"/g;

for (const nome of fs.readdirSync(CARTELLA).filter(n => n.endsWith('.js'))) {
    const file = path.join(CARTELLA, nome);
    const righe = fs.readFileSync(file, 'utf8').split('\n');

    righe.forEach((riga, indice) => {
        const numero = indice + 1;
        if (!riga.includes('${')) return;
        if (/querySelector|\.closest\(|\.matches\(|getElementById/.test(riga)) return;

        for (const trovato of riga.matchAll(ATTRIBUTO)) {
            const valore = trovato[2];
            if (valore.includes('DOMPurify')) {
                segnala(file, numero, riga,
                    `dentro l'attributo ${trovato[1]}="..." serve escapeHTML, non un sanificatore.`);
                continue;
            }
            for (const espressione of valore.matchAll(/\$\{([^}]*)\}/g)) {
                const e = espressione[1].trim();
                if (INNOCUE.some(x => x.test(e))) continue;
                if (DATI_DAL_SERVER.test(e)) {
                    segnala(file, numero, riga,
                        `dentro l'attributo ${trovato[1]}="..." il valore \${${e.slice(0, 40)}} va passato da escapeHTML.`);
                }
            }
        }
    });
}

const sorgenti = fs.readdirSync(CARTELLA)
    .filter(n => n.endsWith('.js'))
    .map(n => [path.join(CARTELLA, n), fs.readFileSync(path.join(CARTELLA, n), 'utf8')]);

for (const [file, testo] of sorgenti) {
    for (const uso of testo.matchAll(/DOMPurify\.sanitize\(/g)) {
        const argomenti = testo.slice(uso.index, uso.index + 600).split('\n').slice(0, 3).join(' ');
        if (!/ALLOWED_TAGS/.test(argomenti)) {
            const numero = testo.slice(0, uso.index).split('\n').length;
            segnala(file, numero, argomenti,
                'DOMPurify senza ALLOWED_TAGS accetta quasi tutto l\'HTML, style compreso.');
        } else if (!/ALLOWED_ATTR/.test(argomenti)) {
            const numero = testo.slice(0, uso.index).split('\n').length;
            segnala(file, numero, argomenti,
                'con i soli ALLOWED_TAGS gli attributi passano: aggiungi ALLOWED_ATTR.');
        }
    }
}

console.log(`\nControllo della resa in pagina: ${errori} errori, ${avvisi} avvisi.`);
if (errori > 0) {
    console.log('\nRegola: il testo si scappa con escapeHTML, il markup si sanifica con');
    console.log('liste chiuse, e dentro un attributo non ci va mai un sanificatore.');
    process.exit(1);
}
console.log('Nessun testo del server finisce in pagina senza essere scappato.');
