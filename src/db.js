
import './config.js';
import logger from './logger.js';
import pg from 'pg';
import { opzioniSslDatabase } from './sslDatabase.js';

const { Pool, types } = pg;

// Date e orari restano testo: un Date a mezzanotte italiana in JSON diventerebbe il giorno
// prima alle 22:00 UTC.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (val) => val);
types.setTypeParser(types.builtins.DATE, (val) => val);

export const dbUser = process.env.DB_USER;
const dbPassword = encodeURIComponent(process.env.DB_PASSWORD || '');
export const dbHost = process.env.DB_HOST;
export const dbPort = process.env.DB_PORT;
export const dbDatabase = process.env.DB_DATABASE;

const sslDatabase = opzioniSslDatabase();
if (sslDatabase && !sslDatabase.rejectUnauthorized) {
    logger.warn('[SECURITY] DB_SSL_STRICT=false: la connessione al database è cifrata ma il certificato non si verifica, quindi chi sta in mezzo potrebbe fingersi il database. Indica l\'autorità del certificato in DB_SSL_CA e togli DB_SSL_STRICT.');
}

export const connessioneDb = {
    connectionString: `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbDatabase}`,
    ssl: sslDatabase
};

export const pool = new Pool({
    ...connessioneDb,
    max: 20,
    idleTimeoutMillis: 30000,
    // Senza, con il database irraggiungibile la richiesta resterebbe appesa.
    connectionTimeoutMillis: 10000
});

// Una connessione inattiva caduta si scarta da sola: fermare il processo butterebbe giù
// tutte le postazioni.
pool.on('error', (err) => {
    logger.error('Errore su un client inattivo del pool DB (il pool si riprende da solo)', { error: err });
});
logger.info("Pool di connessioni PostgreSQL configurato.");
