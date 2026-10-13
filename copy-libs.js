// Le librerie del web si servono dal server, non da un CDN: in sala internet può mancare
// proprio durante l'emergenza. Gira dopo ogni npm install (postinstall).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const moduli = path.join(__dirname, 'node_modules');
const pubblico = path.join(__dirname, 'public');
const vendor = path.join(pubblico, 'vendor');

const file = [
    ['dompurify/dist/purify.es.mjs', 'js/lib/purify.es.js'],

    ['leaflet.markercluster/dist/leaflet.markercluster.js', 'vendor/leaflet-markercluster/leaflet.markercluster.js'],
    ['leaflet.markercluster/dist/MarkerCluster.css', 'vendor/leaflet-markercluster/MarkerCluster.css'],
    ['leaflet.markercluster/dist/MarkerCluster.Default.css', 'vendor/leaflet-markercluster/MarkerCluster.Default.css'],

    ['js-cookie/dist/js.cookie.min.js', 'vendor/js-cookie/js.cookie.min.js'],

    ['pdfmake/build/pdfmake.min.js', 'vendor/pdfmake/pdfmake.min.js'],
    ['pdfmake/build/vfs_fonts.js', 'vendor/pdfmake/vfs_fonts.js'],

    ['qrcodejs/qrcode.min.js', 'vendor/qrcode/qrcode.min.js'],

    ['@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.min.js', 'vendor/geoman/leaflet-geoman.min.js'],
    ['@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css', 'vendor/geoman/leaflet-geoman.css'],
    ['@tmcw/togeojson/dist/togeojson.umd.js', 'vendor/togeojson/togeojson.umd.js'],

    ['@fortawesome/fontawesome-free/css/all.min.css', 'vendor/fontawesome/css/all.min.css']
];

// I CSS delle icone puntano a ../webfonts/.
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
