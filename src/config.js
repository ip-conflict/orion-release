// Va importato prima di tutto ciò che legge process.env.

import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import logger from './logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ quiet: true });
process.umask(0o027);
export const domainName = process.env.DOMAIN_NAME;
// Senza COOKIE_SECRET un segreto distinto ricavato con HMAC, da cui non si risale a JWT_SECRET.
export const cookieSecret = process.env.COOKIE_SECRET
    || (process.env.JWT_SECRET ? crypto.createHmac('sha256', process.env.JWT_SECRET).update('orion:firma-cookie').digest('hex') : undefined);
if (!process.env.COOKIE_SECRET) {
    logger.warn('[SECURITY] COOKIE_SECRET non impostato: i cookie si firmano con un segreto ricavato da JWT_SECRET. Meglio una COOKIE_SECRET propria in .env (openssl rand -hex 32).');
}
export const port = process.env.PORT || 3000;

export let versioneOrion = 'sconosciuta';
try {
    versioneOrion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || versioneOrion;
} catch (errore) {
    logger.warn('[Manutenzione] package.json illeggibile: la versione installata risultera\' sconosciuta.');
}
