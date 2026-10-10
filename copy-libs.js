// Copia in public/ le librerie front-end installate con npm.
// Viene eseguito automaticamente dopo ogni "npm install" (script postinstall),
// quindi setup.sh e update.sh le rigenerano da soli senza passaggi manuali.
//
// Perché: tutte queste librerie erano caricate da CDN esterni (unpkg, jsdelivr,
// cdnjs). In una sala operativa di protezione civile la connessione a Internet
// può mancare o essere degradata proprio durante l'emergenza, e in quel caso le
// pagine non si limitavano a perdere qualche icona: senza Leaflet il codice
// andava in errore e il Centro Operativo diventava inutilizzabile.
// Servendole dal server l'applicazione funziona anche su rete locale isolata.
// (Restano necessariamente online solo le mattonelle della mappa e la ricerca
// indirizzi: senza rete la mappa resta vuota, ma l'applicazione continua a
// funzionare.)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const moduli = path.join(__dirname, 'node_modules');
const pubblico = path.join(__dirname, 'public');
const vendor = path.join(pubblico, 'vendor');

// Singoli file: [origine, destinazione]
const file = [
    ['dompurify/dist/purify.es.mjs', 'js/lib/purify.es.js'],

    ['leaflet.markercluster/dist/leaflet.markercluster.js', 'vendor/leaflet-markercluster/leaflet.markercluster.js'],
    ['leaflet.markercluster/dist/MarkerCluster.css', 'vendor/leaflet-markercluster/MarkerCluster.css'],
    ['leaflet.markercluster/dist/MarkerCluster.Default.css', 'vendor/leaflet-markercluster/MarkerCluster.Default.css'],

    ['js-cookie/dist/js.cookie.min.js', 'vendor/js-cookie/js.cookie.min.js'],

    ['pdfmake/build/pdfmake.min.js', 'vendor/pdfmake/pdfmake.min.js'],
    ['pdfmake/build/vfs_fonts.js', 'vendor/pdfmake/vfs_fonts.js'],

    ['qrcodejs/qrcode.min.js', 'vendor/qrcode/qrcode.min.js'],

    // Disegno sulla mappa (strade chiuse, zone) e lettura dei KML del piano.
    ['@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.min.js', 'vendor/geoman/leaflet-geoman.min.js'],
    ['@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css', 'vendor/geoman/leaflet-geoman.css'],
    ['@tmcw/togeojson/dist/togeojson.umd.js', 'vendor/togeojson/togeojson.umd.js'],

    ['@fortawesome/fontawesome-free/css/all.min.css', 'vendor/fontawesome/css/all.min.css']
];

// Intere cartelle (i CSS delle icone puntano a ../webfonts/)
const cartelle = [
    ['@fortawesome/fontawesome-free/webfonts', 'vendor/fontawesome/webfonts']
];

let errori = 0;

function copiaFile(origineRelativa, destinazioneRelativa) {
    const origine = path.join(moduli, origineRelativa);
    const destinazione = path.join(pubblico, destinazioneRelativa);
    try {
        fs.mkdirSync(path.dirname(destinazione), { recursive: true });
        fs.copyFileSync(origine, destinazione);
    } catch (err) {
        errori++;
        console.error(`ERRORE: impossibile copiare ${origineRelativa} (${err.code}). Esegui di nuovo 'npm install'.`);
    }
}

function copiaCartella(origineRelativa, destinazioneRelativa) {
    const origine = path.join(moduli, origineRelativa);
    const destinazione = path.join(pubblico, destinazioneRelativa);
    try {
        fs.rmSync(destinazione, { recursive: true, force: true });
        fs.cpSync(origine, destinazione, { recursive: true });
    } catch (err) {
        errori++;
        console.error(`ERRORE: impossibile copiare la cartella ${origineRelativa} (${err.code}). Esegui di nuovo 'npm install'.`);
    }
}

fs.mkdirSync(vendor, { recursive: true });
file.forEach(([da, a]) => copiaFile(da, a));
cartelle.forEach(([da, a]) => copiaCartella(da, a));

if (errori > 0) {
    console.error(`Librerie front-end: ${errori} copie non riuscite. Le pagine potrebbero non funzionare correttamente.`);
    process.exit(1);
}
console.log(`Librerie front-end copiate in public/vendor (${file.length} file, ${cartelle.length} cartelle).`);
