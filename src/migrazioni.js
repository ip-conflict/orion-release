// Di solito non manca niente: servono dopo il ripristino di un backup di una versione
// precedente.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runner } from 'node-pg-migrate';
import logger from './logger.js';
import { connessioneDb, pool } from './db.js';
import { allineaMigrazioni } from './allineaMigrazioni.js';

const cartella = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const registro = { debug: () => {}, info: () => {}, warn: m => logger.warn(`[Migrazioni] ${m}`), error: m => logger.error(`[Migrazioni] ${m}`) };

export async function applicaMigrazioni() {
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
        logger: { ...registro, error: () => {} }
    });
    return applicate.map(m => m.name);
}

export const nomiMigrazioni = async () => (await fs.promises.readdir(cartella))
    .map(f => f.match(/^(.+)\.c?js$/)?.[1]).filter(Boolean).sort();

// Tenendo i dati, le migrazioni che una versione precedente non conosce si annullano dalla più
// recente con il "down" di questa versione: si può solo se sono le ultime applicate.
export async function modificheDaAnnullare(nomiVecchi) {
    const { rows } = await pool.query('SELECT name FROM pgmigrations ORDER BY run_on DESC, id DESC');
    const vecchie = new Set(nomiVecchi);
    const extra = rows.map(r => r.name).filter(n => !vecchie.has(n));
    const ultime = rows.slice(0, extra.length).map(r => r.name);
    const inCoda = extra.every(n => ultime.includes(n));
    const qui = new Set(await nomiMigrazioni());
    return { nomi: extra, annullabili: inCoda && extra.every(n => qui.has(n)) };
}

export async function annullaModifiche(quante) {
    await runner({
        databaseUrl: connessioneDb,
        dir: cartella,
        migrationsTable: 'pgmigrations',
        direction: 'down',
        count: quante,
        singleTransaction: true,
        log: () => {},
        logger: registro
    });
}

export async function applicaMigrazioniMancanti() {
    try {
        const applicate = await applicaMigrazioni();
        if (applicate.length > 0) {
            logger.warn(`[Migrazioni] Applicate all'avvio: ${applicate.join(', ')}.`);
        }
        return applicate.length;
    } catch (e) {
        // L'applicazione parte lo stesso: l'amministratore deve poter ripristinare un altro backup.
        logger.error(`[Migrazioni] Controllo delle migrazioni non riuscito, il database potrebbe non essere allo schema di questa versione: ${e.message}`);
        return -1;
    }
}
