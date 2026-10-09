
import './config.js';
import logger from './logger.js';
import pg from 'pg';

const { Pool, types } = pg;

// Date e orari restano testo, come li scrive PostgreSQL: un Date a mezzanotte
// italiana in JSON diventerebbe il giorno prima alle 22:00 UTC.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (val) => val);
types.setTypeParser(types.builtins.DATE, (val) => val);

export const dbUser = process.env.DB_USER;
const dbPassword = encodeURIComponent(process.env.DB_PASSWORD || '');
export const dbHost = process.env.DB_HOST;
export const dbPort = process.env.DB_PORT;
export const dbDatabase = process.env.DB_DATABASE;

// Con DB_SSL il certificato si verifica solo se DB_SSL_STRICT=true: molte
// installazioni usano certificati autofirmati.
const dbSslStrict = process.env.DB_SSL_STRICT === 'true';
if (process.env.DB_SSL === 'true' && !dbSslStrict) {
    logger.warn('[SECURITY] DB_SSL è attivo ma la verifica del certificato è disabilitata (rejectUnauthorized: false). Imposta DB_SSL_STRICT=true per abilitare la verifica reale del certificato e prevenire attacchi MITM sulla connessione al database.');
}

export const connessioneDb = {
    connectionString: `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabase}`,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: dbSslStrict } : false
};

export const pool = new Pool({
    ...connessioneDb,
    max: 20,
    idleTimeoutMillis: 30000,
    // Senza, con il database irraggiungibile la richiesta resterebbe appesa.
    connectionTimeoutMillis: 10000
});

// Una connessione inattiva caduta (riavvio del database, rete) si scarta da
// sola: fermare il processo butterebbe giù tutte le postazioni.
pool.on('error', (err) => {
    logger.error('Errore su un client inattivo del pool DB (il pool si riprende da solo)', { error: err });
});
logger.info("Pool di connessioni PostgreSQL configurato.");
