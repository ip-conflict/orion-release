// src/backup.js
//
// I backup che l'applicazione fa da sola e lo stato di manutenzione.

import './config.js';
import fs from 'fs';
import logger from './logger.js';
import path from 'path';
import zlib from 'zlib';
import { dbDatabase, dbHost, dbPort, dbUser } from './db.js';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';

// Oltre al backup notturno di cron, l'applicazione ne fa da sé alla chiusura di
// un'emergenza e quando l'ultimo è troppo vecchio (il server era spento alle
// 3:30). Li scrive in una cartella sua: quelli di cron, scritti da root, non
// li può cancellare.
export const CARTELLA_BACKUP_APP = process.env.ORION_BACKUP_DIR || '/var/backups/orion/auto';
export const CARTELLA_BACKUP_CRON = '/var/backups/orion/db';
const GIORNI_BACKUP = parseInt(process.env.ORION_BACKUP_RETENTION_DAYS, 10) || 30;
const ORE_MAX_SENZA_BACKUP = 20;
export const CARTELLA_BACKUP_FILE = '/var/backups/orion/files';

// Durante un ripristino o un aggiornamento nessuno scrive: server.js chiude le
// API finché questo è impostato.
export let manutenzioneInCorso = null;
export function impostaManutenzione(stato) {
    manutenzioneInCorso = stato;
    if (stato) logger.warn(`[Manutenzione] Modalità manutenzione ATTIVA: ${stato.motivo}.`);
    else logger.info('[Manutenzione] Modalità manutenzione disattivata.');
}
let backupInCorso = false;
let backupDisabilitato = false; // impostato se la cartella non è scrivibile

export async function eseguiBackupDatabase(motivo) {
    if (backupDisabilitato || backupInCorso) return null;
    backupInCorso = true;
    const inizio = Date.now();

    try {
        await fs.promises.mkdir(CARTELLA_BACKUP_APP, { recursive: true });

        const orario = new Date().toISOString().replace(/[:-]/g, '').replace(/\..+/, '').replace('T', '_');
        const percorsoFile = path.join(CARTELLA_BACKUP_APP, `db_${orario}_${motivo}.sql.gz`);

        // La password nell'ambiente, non negli argomenti: 'ps' li mostra a tutti.
        const processoDump = spawn('pg_dump', [
            '-h', dbHost, '-p', String(dbPort), '-U', dbUser, '-d', dbDatabase, '--no-password'
        ], { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' } });

        let erroriDump = '';
        processoDump.stderr.on('data', pezzo => { erroriDump += pezzo.toString(); });

        const uscitaDump = new Promise((risolvi, rifiuta) => {
            processoDump.on('error', rifiuta);
            processoDump.on('close', codice => codice === 0
                ? risolvi()
                : rifiuta(new Error(`pg_dump terminato con codice ${codice}: ${erroriDump.trim().slice(0, 300)}`)));
        });

        await Promise.all([
            pipeline(processoDump.stdout, zlib.createGzip(), fs.createWriteStream(percorsoFile)),
            uscitaDump
        ]);

        // Un dump troncato è peggio di nessun dump: meglio accorgersene subito.
        const info = await fs.promises.stat(percorsoFile);
        if (info.size < 1000) {
            await fs.promises.unlink(percorsoFile).catch(() => {});
            throw new Error(`il file prodotto è troppo piccolo (${info.size} byte)`);
        }

        const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
        logger.info(`[Backup] Backup del database completato (${motivo}) in ${secondi}s: ${percorsoFile} (${Math.round(info.size / 1024)} KB)`);

        await rimuoviBackupScaduti();
        return percorsoFile;

    } catch (errore) {
        if (errore.code === 'EACCES' || errore.code === 'EPERM') {
            backupDisabilitato = true;
            logger.error(`[Backup] Cartella ${CARTELLA_BACKUP_APP} non scrivibile dall'utente dell'applicazione: i backup automatici sono disattivati. Esegui: sudo mkdir -p ${CARTELLA_BACKUP_APP} && sudo chown -R <utente_app> ${CARTELLA_BACKUP_APP}`);
        } else if (errore.code === 'ENOENT' && errore.syscall === 'spawn pg_dump') {
            backupDisabilitato = true;
            logger.error('[Backup] Comando pg_dump non disponibile sul server: i backup automatici sono disattivati. Installa il pacchetto postgresql-client.');
        } else {
            logger.error(`[Backup] Backup del database non riuscito (${motivo}):`, { error: errore.message });
        }
        return null;
    } finally {
        backupInCorso = false;
    }
}

async function rimuoviBackupScaduti() {
    try {
        const limite = Date.now() - GIORNI_BACKUP * 24 * 3600 * 1000;
        const elenco = await fs.promises.readdir(CARTELLA_BACKUP_APP);
        for (const nome of elenco) {
            if (!nome.startsWith('db_') || !nome.endsWith('.sql.gz')) continue;
            const percorso = path.join(CARTELLA_BACKUP_APP, nome);
            const info = await fs.promises.stat(percorso);
            if (info.mtimeMs < limite) {
                await fs.promises.unlink(percorso);
                logger.debug(`[Backup] Rimosso backup scaduto: ${nome}`);
            }
        }
    } catch (errore) {
        logger.error('[Backup] Pulizia dei backup scaduti non riuscita:', { error: errore.message });
    }
}

// L'ultimo backup, dell'applicazione o di cron.
async function dataUltimoBackup() {
    let piuRecente = 0;
    for (const cartella of [CARTELLA_BACKUP_APP, CARTELLA_BACKUP_CRON]) {
        try {
            for (const nome of await fs.promises.readdir(cartella)) {
                if (!nome.endsWith('.sql.gz')) continue;
                const info = await fs.promises.stat(path.join(cartella, nome));
                if (info.mtimeMs > piuRecente) piuRecente = info.mtimeMs;
            }
        } catch { /* cartella assente o non leggibile: equivale a nessun backup */ }
    }
    return piuRecente;
}

// Il backup saltato perché la macchina era spenta all'ora di cron.

export async function backupDiRecupero() {
    if (backupDisabilitato) return;
    const ultimo = await dataUltimoBackup();
    const oreTrascorse = ultimo === 0 ? Infinity : (Date.now() - ultimo) / 3600000;
    if (oreTrascorse >= ORE_MAX_SENZA_BACKUP) {
        const descrizione = ultimo === 0 ? 'nessun backup presente' : `ultimo backup ${Math.round(oreTrascorse)} ore fa`;
        logger.info(`[Backup] Avvio backup di recupero (${descrizione}).`);
        await eseguiBackupDatabase('recupero');
    }
}
