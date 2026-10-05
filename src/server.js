// src/server.js
//
// Il punto d'avvio: configura Express, registra le rotte dei moduli e avvia il
// server. L'ordine conta: prima le rotte pubbliche, poi il controllo della
// sessione, poi tutto il resto.

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import { registraRotteApp } from './appMobile.js';
import { registraAudit } from './audit.js';
import { authenticateToken, checkAdminRole, chiudiSessioni, haRuolo, nomeUtente, nonEsterni, ruoliDi, ruoloPrincipale, scriviRuoli } from './autenticazione.js';
import { verifyJwtToken } from './authHelper.js';
import { CARTELLA_BACKUP_APP, CARTELLA_BACKUP_CRON, CARTELLA_BACKUP_FILE, backupDiRecupero, eseguiBackupDatabase, impostaManutenzione, manutenzioneInCorso } from './backup.js';
import { magazzinoDir, uploadArchivioBackup, uploadDocumentoMagazzino, uploadScansioneVerbale, verbaliDir } from './caricamenti.js';
import { cookieSecret, domainName, port, versioneOrion } from './config.js';
import { NOMI_RADIO, allowedOrigins, erroreNonTrovato, erroreRichiesta } from './costanti.js';
import { dbDatabase, dbHost, dbPort, dbUser, pool } from './db.js';
import { registraRotteDiarioSala } from './diarioSala.js';
import { escapeHtmlForEmail, sendEmailUtility } from './email.js';
import { registraRotteEmergenze } from './emergenze.js';
import { registraRotteEsterniTemporanei } from './esterniTemporanei.js';
import { registraRotteImpostazioni } from './impostazioni.js';
import { collegaMagazzino } from './istanze.js';
import { registraRotteMagazzino } from './magazzino.js';
import { registraRotteManutenzione } from './manutenzione.js';
import { apiLimiter, limitePerRete } from './middleware/rateLimiters.js';
import { applicaMigrazioniMancanti } from './migrazioni.js';
import { CARTELLA_APK, registraRottePubbliche } from './pubbliche.js';
import { cleanupRevokedTokens, runDailyExpiryCheck } from './scadenze.js';
import { registraRotteSegnalazioni } from './segnalazioni.js';
import { registraRotteSegreteria } from './segreteria.js';
import { registraRotteSessioni } from './sessioni.js';
import { registraRotteRubrica } from './rubrica.js';
import { registraRotteSituazione } from './situazione.js';
import { annotaRegistroSquadre, nomiRadioBloccati, registraRotteSquadre } from './squadre.js';
import { activeEmergency, loadActiveEmergency } from './statoEmergenza.js';
import { avviaTempoReale, avvisaClienti, notifiche } from './tempoReale.js';
import { registraRotteUtenti } from './utenti.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);

// Un errore non gestito in una richiesta non deve fermare il server per tutti:
// lo si annota e si va avanti. Un'eccezione fuori dalle richieste invece lascia
// il processo in uno stato incerto: si esce e PM2 lo riavvia.
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection (richiesta non gestita, il server resta attivo):', { error: reason });
});
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception: arresto del processo per permettere a PM2 di riavviarlo pulito.', { error: err });
    process.exit(1);
});

avviaTempoReale(server);

app.set('trust proxy', 1);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        // Un 403 che dice quale origine: di solito è DOMAIN_NAME diverso dal
        // nome con cui si raggiunge il sito (il prefisso www.).
        logger.warn(`[CORS] Richiesta rifiutata: origine '${origin}' non ammessa. Origini consentite: ${allowedOrigins.join(', ')}. Verifica DOMAIN_NAME nel file .env.`);
        const corsError = new Error('Origine della richiesta non consentita.');
        corsError.status = 403;
        callback(corsError);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            // Le librerie del web sono servite dall'applicazione: nessun CDN.
            "script-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            // Le mattonelle della mappa sono l'unica cosa remota: senza rete la
            // mappa resta vuota, il resto funziona.
            "img-src": ["'self'", "data:", "blob:", "*.tile.openstreetmap.org", "*.tile.osm.org", "server.arcgisonline.com"],
            // Indirizzi (Nominatim, Photon) e percorsi (OSRM): tutti di
            // OpenStreetMap, chiesti dal browser della sala.
            "connect-src": ["'self'", "nominatim.openstreetmap.org", "photon.komoot.io", "router.project-osrm.org", `wss://${domainName}`]
        }
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(cookieParser(cookieSecret));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Le pagine di lavoro stanno in public/ con quelle pubbliche: senza sessione
// non si servono.
const PAGINE_RISERVATE = new Set([
    '/centro-operativo.html', '/profile.html', '/admin-segreteria.html',
    '/magazzino.html', '/magazzino-etichette.html', '/magazzino-verbale.html',
    '/print-report.html', '/situazione.html', '/rubrica.html'
]);
app.use(async (req, res, next) => {
    if (!PAGINE_RISERVATE.has(req.path)) return next();
    if (!manutenzioneInCorso) return authenticateToken(req, res, next);
    // Durante un ripristino il database può non rispondere: basta un token
    // valido, e la pagina mostrerà da sé il velo della manutenzione.
    const token = req.signedCookies['__Secure-token'] || req.headers['authorization']?.split(' ')[1];
    try {
        await verifyJwtToken(token);
        next();
    } catch (e) {
        res.redirect('/login.html?redirect=' + encodeURIComponent(req.originalUrl));
    }
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// Durante un ripristino o un aggiornamento le API rispondono 503, tranne
// quelle di sistema che dicono a che punto è l'operazione. Anche l'accesso è
// chiuso: una sessione aperta ora varrebbe per un database che sta cambiando.
app.use((req, res, next) => {
    if (!manutenzioneInCorso) return next();
    if (!req.path.startsWith('/api/') && req.path !== '/login') return next();
    if (req.path.startsWith('/api/sistema/')) return next();
    const motivo = manutenzioneInCorso.motivo;
    return res.status(503).json({
        manutenzione: true,
        message: `${motivo.charAt(0).toUpperCase()}${motivo.slice(1)}. Riprova fra poco.`
    });
});

app.use((req, res, next) => {
    logger.debug(`${new Date().toISOString()} - ${req.method} ${req.originalUrl} - User: ${req.user?.username || 'Anonimo'}`);
    next();
});

// Ogni richiesta riceve una risposta entro un minuto, anche se un gestore
// async si è perso per strada. I caricamenti sono esclusi: dipendono dalla
// banda di chi carica.
const REQUEST_WATCHDOG_MS = 60000;
app.use((req, res, next) => {
    if (req.headers['content-type']?.includes('multipart/form-data')) return next();
    const watchdog = setTimeout(() => {
        if (!res.headersSent) {
            logger.error(`[Watchdog] Nessuna risposta per ${req.method} ${req.originalUrl} entro ${REQUEST_WATCHDOG_MS / 1000}s: invio 503.`);
            res.status(503).json({ message: 'Il server non è riuscito a completare la richiesta in tempo. Riprova tra poco.' });
        }
    }, REQUEST_WATCHDOG_MS);
    res.on('finish', () => clearTimeout(watchdog));
    res.on('close', () => clearTimeout(watchdog));
    next();
});

registraRottePubbliche(app);

// Da qui in poi serve una sessione. Prima un limite per indirizzo contro chi
// martella il server, poi chi è, poi il limite per persona: una sala operativa
// dietro lo stesso indirizzo non deve dividersi un limite solo.
app.use('/api/', limitePerRete);
app.use(authenticateToken);
app.use('/api/', apiLimiter);

registraRotteEsterniTemporanei(app, {
    pool, logger, registraAudit, nomeUtente, emergenzaAttiva: () => activeEmergency, erroreRichiesta, nonEsterni,
    scriviRuoli, annotaRegistroSquadre, nomiRadioBloccati, NOMI_RADIO, avvisaClienti,
    inviaEmail: sendEmailUtility, dominio: domainName, chiudiSessioni
});

registraRotteDiarioSala(app, {
    pool, logger, nonEsterni, nomeUtente, avvisaClienti, emergenzaAttiva: () => activeEmergency
});

registraRotteSituazione(app, {
    pool, logger, nonEsterni, haRuolo, registraAudit, emergenzaAttiva: () => activeEmergency
});

registraRotteRubrica(app, { pool, logger, nonEsterni, registraAudit, nomeUtente, avvisaClienti });

const magazzino = registraRotteMagazzino(app, {
    pool, logger, haRuolo, ruoliDi, registraAudit,
    erroreRichiesta, erroreNonTrovato,
    emergenzaAttiva: () => activeEmergency,
    avvisaClienti,
    caricaDocumento: uploadDocumentoMagazzino,
    cartellaDocumenti: magazzinoDir,
    caricaScansione: uploadScansioneVerbale,
    cartellaVerbali: verbaliDir,
    inviaEmail: sendEmailUtility,
    escapeHtml: escapeHtmlForEmail,
    dominio: domainName,
    notifica: notifiche.notifica,
    scadiNotifiche: notifiche.scadi
});
collegaMagazzino(magazzino);

registraRotteApp(app, {
    pool, logger, haRuolo, ruoliDi, ruoloPrincipale,
    emergenzaAttiva: () => activeEmergency,
    versioneServer: versioneOrion,
    cartellaApk: CARTELLA_APK,
    leggiConfigMagazzino: magazzino.leggiConfig
});

const manutenzione = registraRotteManutenzione(app, {
    pool, logger, registraAudit, avvisaClienti,
    emergenzaAttiva: () => activeEmergency,
    notificaA: notifiche.notificaA,
    inviaEmail: sendEmailUtility,
    soloAdmin: checkAdminRole,
    eseguiBackup: eseguiBackupDatabase,
    cartellaApp: CARTELLA_BACKUP_APP,
    cartellaCron: CARTELLA_BACKUP_CRON,
    cartellaFile: CARTELLA_BACKUP_FILE,
    cartellaApplicazione: path.join(__dirname, '..'),
    versioneInstallata: versioneOrion,
    connessioneDb: {
        host: dbHost, porta: dbPort, utente: dbUser,
        database: dbDatabase, password: process.env.DB_PASSWORD || ''
    },
    impostaManutenzione,
    caricaArchivio: uploadArchivioBackup
});

const pagina = (cartella, nome) => (req, res) => res.sendFile(path.join(cartella, nome));
const PUBBLICA = path.join(__dirname, '..', 'public');
const ADMIN = path.join(__dirname, 'admin');
app.get('/centro-operativo.html', authenticateToken, pagina(PUBBLICA, 'centro-operativo.html'));
app.get('/profile.html', authenticateToken, pagina(PUBBLICA, 'profile.html'));
app.get('/admin/admin.html', authenticateToken, checkAdminRole, pagina(ADMIN, 'admin.html'));
app.get('/admin/dashboard-admin.html', authenticateToken, checkAdminRole, pagina(ADMIN, 'dashboard-admin.html'));
// Le squadre le compongono tutti: in sala è un lavoro condiviso.
app.get('/admin/squadre.html', authenticateToken, pagina(ADMIN, 'squadre.html'));
app.get('/admin/archive.html', authenticateToken, checkAdminRole, pagina(ADMIN, 'archive.html'));
app.get('/admin/sistema.html', authenticateToken, checkAdminRole, pagina(ADMIN, 'sistema.html'));

registraRotteSessioni(app);
registraRotteImpostazioni(app);
registraRotteEmergenze(app);
registraRotteUtenti(app);
registraRotteSquadre(app);
registraRotteSegnalazioni(app);
registraRotteSegreteria(app);

// L'ultimo: gli errori che nessuna rotta ha gestito. In produzione il
// messaggio interno resta nel log, al client va una frase generica.
app.use((err, req, res, next) => {
    logger.error("ERRORE NON GESTITO:", err);
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    const isDevelopment = process.env.NODE_ENV === 'development';
    const clientMessage = (status < 500 && err.expose !== false && err.message)
        ? err.message
        : 'Errore interno del server.';
    res.status(status).json({
        message: isDevelopment ? (err.message || clientMessage) : clientMessage,
        details: isDevelopment ? err.stack : undefined
    });
});

(async () => {
    try {
        await applicaMigrazioniMancanti();
        await loadActiveEmergency();
        runDailyExpiryCheck();
        setInterval(runDailyExpiryCheck, 3600000);
        cleanupRevokedTokens();
        setInterval(cleanupRevokedTokens, 24 * 3600000);
        notifiche.pulisci();
        setInterval(notifiche.pulisci, 24 * 3600000);
        magazzino.pulisciIdempotenza();
        setInterval(magazzino.pulisciIdempotenza, 24 * 3600000);
        // Il backup notturno saltato perché il server era spento.
        backupDiRecupero();
        setInterval(backupDiRecupero, 6 * 3600000);
        // Il controllo giornaliero delle versioni, se acceso: guarda ogni ora
        // se è passato un giorno dall'ultimo.
        manutenzione.controlloAutomatico();
        setInterval(manutenzione.controlloAutomatico, 3600000);
        server.listen(port, () => {
            logger.info(`Server in esecuzione su porta ${port}`);
            logger.info(`Accesso web app: http://localhost:${port} o https://${domainName}`);
        });
    } catch (startupError) {
        logger.error("Errore critico durante l'avvio del server:", startupError);
        process.exit(1);
    }
})();

function chiudi(segnale) {
    logger.info(`${segnale}: chiusura del server`);
    server.close(() => {
        pool.end(() => {
            logger.info('Server e connessioni al database chiusi.');
            process.exit(0);
        });
    });
}
process.on('SIGTERM', () => chiudi('SIGTERM'));
process.on('SIGINT', () => chiudi('SIGINT'));
