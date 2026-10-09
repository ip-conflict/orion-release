// La configurazione letta dall'ambiente (.env) e la versione installata.
// Va importato prima di tutto ciò che legge process.env.

import dotenv from 'dotenv';
import fs from 'fs';
import logger from './logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();
// I file creati dal programma non si leggono dagli altri utenti della macchina.
process.umask(0o027);
export const domainName = process.env.DOMAIN_NAME;
export const cookieSecret = process.env.COOKIE_SECRET || process.env.JWT_SECRET;
if (!process.env.COOKIE_SECRET) {
    logger.warn('[SECURITY] COOKIE_SECRET non impostato: i cookie firmati riusano JWT_SECRET. Imposta una COOKIE_SECRET distinta in .env per separare i segreti di firma dei cookie da quelli dei JWT.');
}
export const port = process.env.PORT || 3000;

// La versione sta solo in package.json e segue le migrazioni:
// 3.<ultima migrazione>.<ritocco>.
export let versioneOrion = 'sconosciuta';
try {
    versioneOrion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || versioneOrion;
} catch (errore) {
    logger.warn('[Manutenzione] package.json illeggibile: la versione installata risultera\' sconosciuta.');
}
