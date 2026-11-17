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
    /^e\(/,                  // alias locale di escapeHTML (situazione.js)
    /^[\w.]+\.length\s*[-+]\s*\w+$/,
    // .map che restituisce un template: le sue ${...} si controllano una per una.
    /^[\w.]+\.map\(\s*\(?\w+(\s*,\s*\w+)?\)?\s*=>\s*`/,
    /^[A-Z_]{3,}$/,          // costanti tutte maiuscole
    // Costruiscono markup e scappano dentro il testo che ci mettono: se una cambia, va
    // riguardata prima di lasciarla qui.
    /^(getStatusBadgeHTML|bollinoPriorita|diario|iconaTipo|(window\.)?Funzioni\??\.etichette|(window\.)?Qualifiche\??\.(bollino|cartellino|segnaposto)|ora)\(/
];

// Salta una stringa o un template che comincia in i; restituisce l'indice della chiusura.
function finePezzo(e, i) {
    const chiusa = e[i];
    for (let j = i + 1; j < e.length; j++) {
        if (e[j] === '\\') { j++; continue; }
        if (chiusa === '`' && e[j] === '$' && e[j + 1] === '{') {
            let livello = 0;
            for (j += 2; j < e.length; j++) {
                if (e[j] === '`' || e[j] === "'" || e[j] === '"') j = finePezzo(e, j);
                else if (e[j] === '{') livello++;
                else if (e[j] === '}') { if (livello === 0) break; livello--; }
            }
            continue;
        }
        if (e[j] === chiusa) return j;
    }
    return e.length;
}

// In "a ? b : c" in pagina finisce b o c, non a: si guardano solo i due rami.
function rami(e) {
    let livello = 0, domanda = -1, annidate = 0;
    for (let i = 0; i < e.length; i++) {
        const c = e[i];
        if (c === '`' || c === "'" || c === '"') i = finePezzo(e, i);
        else if ('([{'.includes(c)) livello++;
        else if (')]}'.includes(c)) livello--;
        else if (livello === 0 && c === '?' && e[i + 1] !== '.' && e[i + 1] !== '?' && e[i - 1] !== '?') {
            if (domanda === -1) domanda = i; else annidate++;
        } else if (livello === 0 && c === ':' && domanda !== -1) {
            if (annidate) annidate--; else return [e.slice(domanda + 1, i), e.slice(i + 1)];
        }
    }
    return null;
}

function innocua(e) {
    e = e.trim();
    // Un letterale, o un template annidato: le ${...} di quest'ultimo si controllano da sole.
    if (!e || /^'[^']*'$|^"[^"]*"$/.test(e) || e.startsWith('`')) return true;
    if (INNOCUE.some(x => x.test(e))) return true;
    const r = rami(e);
    if (r) return r.every(innocua);
    return !DATI_DAL_SERVER.test(e);
}

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

// Ogni ${...} della riga, con le graffe bilanciate: anche quelli dentro un template annidato.
function espressioni(riga) {
    const trovate = [];
    for (let i = riga.indexOf('${'); i !== -1; i = riga.indexOf('${', i + 2)) {
        let livello = 0, j = i + 2;
        for (; j < riga.length; j++) {
            if (riga[j] === '{') livello++;
            else if (riga[j] === '}') { if (livello === 0) break; livello--; }
        }
        trovate.push({ testo: riga.slice(i + 2, j).trim(), chiusa: j < riga.length });
    }
    return trovate;
}

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

        // Anche il testo fra i tag: <strong>${c.name}</strong> sfuggiva al solo controllo
        // degli attributi.
        if (!/<\/?[a-zA-Z][^>]*>/.test(riga)) return;
        const fuoriDagliAttributi = riga.replace(ATTRIBUTO, '');
        for (const { testo: e, chiusa } of espressioni(fuoriDagliAttributi)) {
            // Un'espressione che continua a capo non si giudica da un pezzo: le sue
            // ${...} interne stanno sulle righe dopo e si controllano lì.
            if (!chiusa || innocua(e)) continue;
            segnala(file, numero, riga,
                `nel testo della pagina il valore \${${e.slice(0, 40)}} va passato da escapeHTML.`);
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
