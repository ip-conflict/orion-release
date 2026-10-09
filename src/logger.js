
import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'warn';
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};
winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

const transports = [
  new winston.transports.Console({
    format: format, // Applica il formato colorato
  }),
  new winston.transports.File({
    filename: path.join(__dirname, '..', 'logs', 'error.log'),
    level: 'error', // Logga solo gli errori
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()), // Formato JSON per i file
  }),
  new winston.transports.File({
    filename: path.join(__dirname, '..', 'logs', 'all.log'),
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(__dirname, '..', 'logs', 'exceptions.log') }),
  ],
  rejectionHandlers: [
     new winston.transports.File({ filename: path.join(__dirname, '..', 'logs', 'rejections.log') }),
  ],
  exitOnError: false, // Non terminare l'applicazione in caso di eccezione non gestita
});

export default logger;
