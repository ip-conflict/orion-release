// Di solito non manca niente: servono dopo il ripristino di un backup di una versione
// precedente.

import path from 'path';
import { fileURLToPath } from 'url';
import { runner } from 'node-pg-migrate';
import logger from './logger.js';
import { connessioneDb } from './db.js';
import { allineaMigrazioni } from './allineaMigrazioni.js';

const cartella = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function applicaMigrazioniMancanti() {
    try {
        if (await allineaMigrazioni(connessioneDb) === 'allineato') {
            logger.warn('[Migrazioni] Database precedente alla 1.0: migrazioni allineate alla base della 1.0.');
        }
        const applicate = await runner({
            databaseUrl: connessioneDb,
            dir: cartella,
            migrationsTable: 'pgmigrations',
            direction: 'up',
            count: Infinity,
            log: () => {},
            logger: { debug: () => {}, info: () => {}, warn: m => logger.warn(`[Migrazioni] ${m}`), error: () => {} }
        });
        if (applicate.length > 0) {
            logger.warn(`[Migrazioni] Applicate all'avvio: ${applicate.map(m => m.name).join(', ')}.`);
        }
        return applicate.length;
    } catch (e) {
        // L'applicazione parte lo stesso: l'amministratore deve poter ripristinare un altro backup.
        logger.error(`[Migrazioni] Controllo delle migrazioni non riuscito, il database potrebbe non essere allo schema di questa versione: ${e.message}`);
        return -1;
    }
}
