// src/logger.js

import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

// Ottieni il percorso della directory corrente in un modulo ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Definisci i livelli di log personalizzati se necessario (qui usiamo quelli standard)
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Scegli il livello di log in base all'ambiente
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'warn';
};

// Colori per i log in console
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};
winston.addColors(colors);

// Formato personalizzato per i log
const format = winston.format.combine(
  // Aggiunge il timestamp con un formato leggibile
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  // Formato per la console con colori
  winston.format.colorize({ all: true }),
  // Formato di stampa che include timestamp, livello e messaggio
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Definisci i "transports", ovvero dove verranno salvati i log
const transports = [
  // 1. Log in console (per lo sviluppo)
  new winston.transports.Console({
    format: format, // Applica il formato colorato
  }),
  // 2. File per i log di errore
  new winston.transports.File({
    filename: path.join(__dirname, '..', 'logs', 'error.log'),
    level: 'error', // Logga solo gli errori
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()), // Formato JSON per i file
  }),
  // 3. File per tutti i log
  new winston.transports.File({
    filename: path.join(__dirname, '..', 'logs', 'all.log'),
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  }),
];

// Crea l'istanza del logger
const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
  // Gestisce le eccezioni non catturate
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(__dirname, '..', 'logs', 'exceptions.log') }),
  ],
  // Gestisce le promise rejection non gestite
  rejectionHandlers: [
     new winston.transports.File({ filename: path.join(__dirname, '..', 'logs', 'rejections.log') }),
  ],
  exitOnError: false, // Non terminare l'applicazione in caso di eccezione non gestita
});

export default logger;
