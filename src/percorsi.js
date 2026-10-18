// Il logger lo importa prima che config.js abbia letto .env: per questo legge .env anche qui.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ quiet: true });

export const RADICE_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Nei container il codice sta nell'immagine, a sola lettura: i dati vivono altrove.
export const RADICE_DATI = process.env.ORION_DATI_DIR ? path.resolve(process.env.ORION_DATI_DIR) : RADICE_APP;
export const datiSeparati = RADICE_DATI !== RADICE_APP;
