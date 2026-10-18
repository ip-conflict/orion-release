import crypto from 'crypto';
import fs from 'fs';
import logger from './logger.js';
import multer from 'multer';
import path from 'path';
import { CARTELLA_BACKUP_APP } from './backup.js';
import { fileTypeFromFile } from 'file-type';
import { fileURLToPath } from 'url';
import { inviaFile } from './cifratura.js';
import { RADICE_DATI, datiSeparati } from './percorsi.js';
import { nomeBackup } from './nomiBackup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


export const certDir = path.join(RADICE_DATI, 'protected_uploads', 'certificates');
if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
}


const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, certDir); 
    },
    filename: function (req, file, cb) {
        const targetUserId = req.params.userId || req.params.id; 
        const randomString = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        
        cb(null, `cert-${targetUserId}-${randomString}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(Object.assign(new Error('Formato non ammesso: carica un PDF o una foto (JPG, PNG o WEBP).'), { status: 400 }), false);
    }
};


export const uploadCertificate = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 30 * 1024 * 1024 } // 30 MegaBytes di limite tassativo
});

// Cartella a parte: i permessi sono diversi da quelli dei fascicoli.
export const magazzinoDir = path.join(RADICE_DATI, 'protected_uploads', 'magazzino');
if (!fs.existsSync(magazzinoDir)) {
    fs.mkdirSync(magazzinoDir, { recursive: true });
}

export const uploadDocumentoMagazzino = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, magazzinoDir),
        filename: (req, file, cb) => {
            const bene = parseInt(req.params.id, 10) || 0;
            cb(null, `bene-${bene}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`);
        }
    }),
    fileFilter,
    limits: { fileSize: 30 * 1024 * 1024 }
});

export const verbaliDir = path.join(magazzinoDir, 'verbali');
fs.mkdirSync(verbaliDir, { recursive: true });
export const uploadScansioneVerbale = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, verbaliDir),
        filename: (req, file, cb) => {
            const verbale = parseInt(req.params.id, 10) || 0;
            // L'estensione dal tipo, non dal nome: un "foto.html" non torna come pagina.
            const estensione = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[file.mimetype] || '';
            cb(null, `verbale-${verbale}-${crypto.randomBytes(8).toString('hex')}${estensione}`);
        }
    }),
    fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 }
});

// Il contenuto lo verifica src/manutenzione.js prima di usarlo.
export const uploadArchivioBackup = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            fs.mkdirSync(CARTELLA_BACKUP_APP, { recursive: true });
            cb(null, CARTELLA_BACKUP_APP);
        },
        filename: (req, file, cb) => {
            cb(null, nomeBackup('caricato'));
        }
    }),

    limits: { fileSize: 500 * 1024 * 1024 }
});

const photoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(RADICE_DATI, 'uploads', 'photos');

        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `user_${crypto.randomBytes(24).toString('hex')}${path.extname(file.originalname).toLowerCase()}`);
    }
});

export const uploadPhoto = multer({ 
    storage: photoStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Max 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(Object.assign(new Error('Per la foto serve un\'immagine: JPG, PNG o WEBP.'), { status: 400 }), false);
    }
});

const protectedImagesDir = path.join(RADICE_DATI, 'protected_uploads', 'images');
if (!fs.existsSync(protectedImagesDir)) fs.mkdirSync(protectedImagesDir, { recursive: true });

const storageUpload = multer.diskStorage({ 
    destination: (req, file, cb) => cb(null, protectedImagesDir), 
    filename: (req, file, cb) => { 
        const ext = path.extname(file.originalname); 
        cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`); 
    } 
});
const imageFileFilter = (req, file, cb) => {

    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png' || file.mimetype === 'image/gif') {
      cb(null, true);
    } else {

      cb(null, false);
      req.fileValidationError = 'Tipo file non valido! Sono permesse solo immagini JPG, PNG, GIF.';
    }
  };

  export const uploadImageMulter = multer({ storage: storageUpload, limits: { fileSize: 40 * 1024 * 1024 }, fileFilter: imageFileFilter });
  const excelFileFilter = (req, file, cb) => {
    const allowedTypes = [
        'application/vnd.ms-excel', 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
        'text/csv' 
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(null, false);
        req.fileValidationError = 'Tipo file non valido! Sono permessi solo fogli Excel (.xlsx) o file CSV.';
    }
  };
  

  const excelImportTmpDir = path.join(RADICE_DATI, 'protected_uploads', 'tmp_imports');
  if (!fs.existsSync(excelImportTmpDir)) fs.mkdirSync(excelImportTmpDir, { recursive: true });
  export const uploadExcelMulter = multer({ dest: excelImportTmpDir, fileFilter: excelFileFilter });

const documentFileFilter = (req, file, cb) => {
    const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'text/csv',
        'text/plain'
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(null, false);
        req.fileValidationError = 'Tipo file non valido! Sono permessi solo PDF, Word, Excel, CSV, TXT.';
    }
};

export const protectedDocsDir = path.join(RADICE_DATI, 'protected_uploads', 'documents');
if (!fs.existsSync(protectedDocsDir)) fs.mkdirSync(protectedDocsDir, { recursive: true });

const storageDocs = multer.diskStorage({
    destination: (req, file, cb) => cb(null, protectedDocsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    }
});

export const uploadDocumentMulter = multer({
    storage: storageDocs,
    limits: { fileSize: 50 * 1024 * 1024 }, // Limite a 50MB
    fileFilter: documentFileFilter
});

export const CARTELLA_LOGHI = datiSeparati ? path.join(RADICE_DATI, 'loghi') : path.join(__dirname, '..', 'public');
const LOGO_FILENAME = 'logo.png';
export const LOGO_FILE_PATH = path.join(CARTELLA_LOGHI, LOGO_FILENAME);
export const LOGO_URL_PATH = `/${LOGO_FILENAME}`;

// Il logo nuovo prende il posto del vecchio solo dopo la verifica.
const storageLogo = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CARTELLA_LOGHI),
    filename: (req, file, cb) => {
        cb(null, `${LOGO_FILENAME}.upload-${crypto.randomBytes(8).toString('hex')}.tmp`);
    }
});

export const uploadLogoMulter = multer({
    storage: storageLogo,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limite 5MB per il logo
    fileFilter: imageFileFilter // Riusiamo lo stesso filtro per le immagini
});

const LOGO2_FILENAME = 'logo2.png';
export const LOGO2_FILE_PATH = path.join(CARTELLA_LOGHI, LOGO2_FILENAME);
export const LOGO2_URL_PATH = `/${LOGO2_FILENAME}`;

const storageLogo2 = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CARTELLA_LOGHI),
    filename: (req, file, cb) => {
        cb(null, `${LOGO2_FILENAME}.upload-${crypto.randomBytes(8).toString('hex')}.tmp`);
    }
});

export const uploadLogo2Multer = multer({
    storage: storageLogo2,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter
});

// Il tipo vero si legge dai primi byte del file salvato, non da quello dichiarato dal browser.

async function detectRealFileType(filePath) {
    try {
        return await fileTypeFromFile(filePath);
    } catch (e) {
        logger.error(`Errore rilevamento tipo file reale per ${filePath}:`, e);
        return null;
    }
}

export function cleanupRejectedFiles(files) {
    files.forEach(file => {
        fs.unlink(file.path, (err) => {
            if (err) logger.error(`Errore rimozione file rifiutato ${file.path}:`, err);
        });
    });
}

export async function verifySingleUploadedImage(req, res, allowedMimeTypes) {
    if (!req.file) return true;
    const detected = await detectRealFileType(req.file.path);
    if (!detected || !allowedMimeTypes.includes(detected.mime)) {
        cleanupRejectedFiles([req.file]);
        res.status(400).json({ message: 'Il contenuto del file non corrisponde a un formato valido tra quelli consentiti.' });
        return false;
    }
    return true;
}


export async function verifyMultipleUploadedImages(req, res, allowedMimeTypes) {
    const files = req.files || [];
    if (files.length === 0) return true;
    for (const file of files) {
        const detected = await detectRealFileType(file.path);
        if (!detected || !allowedMimeTypes.includes(detected.mime)) {
            cleanupRejectedFiles(files);
            res.status(400).json({ message: 'Il contenuto di uno o più file non corrisponde a un\'immagine valida tra quelle consentite.' });
            return false;
        }
    }
    return true;
}

// CSV e TXT, che non hanno firma, passano solo se non somigliano a un formato binario noto.
export async function verifyDocumentUpload(req, res) {
    if (!req.file) return true;
    const allowedBinaryTypes = [
        'application/pdf',
        'application/x-cfb', // formato legacy OLE/CFB: .doc e .xls "classici"
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/zip' // alcuni pacchetti OOXML vengono rilevati come zip generico
    ];
    const ext = path.extname(req.file.originalname).toLowerCase();
    const detected = await detectRealFileType(req.file.path);
    const isPlainTextExt = ext === '.csv' || ext === '.txt';
    const valid = isPlainTextExt ? !detected : (detected && allowedBinaryTypes.includes(detected.mime));
    if (!valid) {
        cleanupRejectedFiles([req.file]);
        res.status(400).json({ message: 'Il contenuto del file non corrisponde a un documento valido tra quelli consentiti.' });
        return false;
    }
    return true;
}


export async function verifyCertificateUpload(req, res) {
    return verifySingleUploadedImage(req, res, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
}


export async function verifyExcelUpload(filePath, originalname) {
    const ext = path.extname(originalname).toLowerCase();
    const detected = await detectRealFileType(filePath);
    if (ext === '.csv') return !detected;
    const allowedBinaryTypes = [
        'application/x-cfb', // .xls legacy
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/zip'
    ];
    return !!(detected && allowedBinaryTypes.includes(detected.mime));
}



if (!fs.existsSync(CARTELLA_LOGHI)) {
    fs.mkdirSync(CARTELLA_LOGHI, { recursive: true });
    logger.info(`Cartella creata: ${CARTELLA_LOGHI}`);
}
// Con i dati fuori dal codice i loghi di serie si copiano una volta; quelli caricati restano.
if (datiSeparati) {
    for (const nome of [LOGO_FILENAME, LOGO2_FILENAME]) {
        const qui = path.join(CARTELLA_LOGHI, nome);
        try {
            if (!fs.existsSync(qui)) fs.copyFileSync(path.join(__dirname, '..', 'public', nome), qui);
        } catch (e) {
            logger.warn(`Logo di serie ${nome} non copiato: ${e.message}`);
        }
    }
}

const CARTELLA_FOTO = path.resolve(RADICE_DATI, 'uploads', 'photos');

export function inviaFoto(res, nomeFile) {
    const filePath = path.resolve(CARTELLA_FOTO, nomeFile);

    if (!filePath.startsWith(CARTELLA_FOTO + path.sep)) {
        return res.status(403).json({ message: 'Accesso negato' });
    }
    inviaFile(res, filePath, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
