// L'ordine conta: prima le rotte pubbliche, poi il controllo della sessione, poi il resto.

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import { registraRotteApp } from './appMobile.js';
import { avviaAllerta, registraRotteAllerta } from './allerta.js';
import { registraAudit } from './audit.js';
import { creaIdempotenza } from './middleware/idempotenza.js';
import { authenticateToken, checkAdminRole, chiudiSessioni, haRuolo, nomeUtente, nonEsterni, ruoliDi, ruoloPrincipale, scriviRuoli } from './autenticazione.js';
import { verifyJwtToken } from './authHelper.js';
import { CARTELLA_BACKUP_APP, CARTELLA_BACKUP_CRON, CARTELLA_BACKUP_FILE, backupDiRecupero, eseguiBackupDatabase, impostaManutenzione, manutenzioneInCorso } from './backup.js';
import { CARTELLA_LOGHI, magazzinoDir, uploadArchivioBackup, uploadDocumentoMagazzino, uploadScansioneVerbale, verbaliDir } from './caricamenti.js';
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
import { RADICE_APP, RADICE_DATI, datiSeparati } from './percorsi.js';
import { portaAppAndroid } from './appAndroid.js';
import { CARTELLA_APK, registraRottePubbliche } from './pubbliche.js';
import { cleanupRevokedTokens, runDailyExpiryCheck } from './scadenze.js';
import { registraRotteSegnalazioni } from './segnalazioni.js';
import { registraRotteLetture } from './letture.js';
import { registraRotteSegreteria } from './segreteria.js';
import { registraRotteSessioni } from './sessioni.js';
import { registraRotteAvvisi, registraRotteAvvisiTelefono } from './avvisi.js';
import { registraRotteFirebase, registraRotteFirebaseTelefono } from './firebase.js';
import { registraRotteGestionePermessi } from './gestionePermessi.js';
import { richiedePermesso } from './permessi.js';
import { registraRotteFunzioni } from './funzioni.js';
import { registraRotteMappaElementi } from './mappaElementi.js';
import { registraRotteCartografia } from './cartografia.js';
import { registraRotteMfa } from './mfa.js';
import { registraRotteConfermeTelefono, registraRotteTelefoni, registraRotteTelefoniPubbliche } from './telefoniChiave.js';
import { preparaPrimoAccesso, registraRottePrimoAccesso } from './primoAccesso.js';
import { avviaIntegrita, registraIntegrita } from './integrita.js';
import { cifraFileInChiaro, preparaCifratura, registraRotteCifratura } from './cifratura.js';
import { registraRotteRubrica } from './rubrica.js';
import { registraRotteInformativa, registraRotteInformativaPubblica } from './informativa.js';
import { caricaVersioneInformativa } from './statoInformativa.js';
import { registraRotteSituazione } from './situazione.js';
import { registraRotteDocumenti } from './documenti.js';
import { registraRotteAttivita } from './attivita.js';
import { registraRottePresenze } from './presenze.js';
import { registraRotteChiamate } from './chiamate.js';
import { registraRotteCopione } from './copione.js';
import { registraRotteScenari } from './scenari.js';
import { annotaRegistroSquadre, nomiRadioBloccati, registraRotteSquadre } from './squadre.js';
import { activeEmergency, loadActiveEmergency } from './statoEmergenza.js';
import { avviaTempoReale, avvisaClienti, avvisaTelefoniInAscolto, notifiche } from './tempoReale.js';
import { registraRotteUtenti } from './utenti.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);

// Un'eccezione fuori dalle richieste lascia il processo in uno stato incerto: si esce
// e Docker lo riavvia.
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection (richiesta non gestita, il server resta attivo):', { error: reason });
});
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception: arresto del processo per farlo ripartire pulito.', { error: err });
    process.exit(1);
});

avviaTempoReale(server);

app.set('trust proxy', 1);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        // Di solito DOMAIN_NAME è diverso dal nome con cui si raggiunge il sito (www.).
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
            "script-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "img-src": ["'self'", "data:", "blob:", "*.tile.openstreetmap.org", "*.tile.osm.org", "server.arcgisonline.com"],
            "connect-src": ["'self'", "nominatim.openstreetmap.org", "photon.komoot.io", "router.project-osrm.org", `wss://${domainName}`]
        }
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(cookieParser(cookieSecret));
// Il limite alto solo con un token valido: un anonimo non fa leggere 8 mega al server
// per sentirsi rispondere 401.
const jsonDiSerie = express.json();
const jsonMappa = express.json({ limit: '8mb' });
app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/mappa/')) return jsonDiSerie(req, res, next);
    const token = req.signedCookies['__Secure-token'] || req.headers['authorization']?.split(' ')[1];
    try {
        await verifyJwtToken(token);
    } catch {
        return jsonDiSerie(req, res, next);
    }
    jsonMappa(req, res, next);
});
app.use(express.urlencoded({ extended: true }));
// Express 5 lascia req.body indefinito quando la richiesta non ha un corpo.
app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    next();
});

const PAGINE_RISERVATE = new Set([
    '/centro-operativo.html', '/profile.html', '/admin-segreteria.html',
    '/magazzino.html', '/magazzino-etichette.html', '/magazzino-verbale.html',
    '/print-report.html', '/situazione.html', '/rubrica.html', '/documenti.html', '/calendario.html',
    '/chiamata.html', '/copione.html', '/simulazioni.html'
]);
app.use(async (req, res, next) => {
    if (!PAGINE_RISERVATE.has(req.path)) return next();
    if (!manutenzioneInCorso) return authenticateToken(req, res, next);
    // Durante un ripristino il database può non rispondere: basta un token valido.
    const token = req.signedCookies['__Secure-token'] || req.headers['authorization']?.split(' ')[1];
    try {
        await verifyJwtToken(token);
        next();
    } catch (e) {
        res.redirect('/login.html?redirect=' + encodeURIComponent(req.originalUrl));
    }
});
let migrazioniFallite = false;
// Per il controllo di salute del container; il server ascolta solo a avvio finito.
app.get('/api/salute', (req, res) => res.status(migrazioniFallite ? 503 : 200).json({ ok: !migrazioniFallite }));

if (datiSeparati) {
    app.get(['/logo.png', '/logo2.png'], (req, res, next) =>
        res.sendFile(path.join(CARTELLA_LOGHI, path.basename(req.path)), e => e && next()));
}
app.use(express.static(path.join(__dirname, '..', 'public')));

// Anche l'accesso è chiuso: una sessione aperta ora varrebbe per un database che sta cambiando.
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

// I caricamenti sono esclusi: dipendono dalla banda di chi carica.
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
registraRottePrimoAccesso(app);
registraRotteInformativaPubblica(app);
registraRotteTelefoniPubbliche(app, { notifiche, cartellaApk: CARTELLA_APK });

// Il limite per persona viene dopo: una sala dietro lo stesso indirizzo non deve
// dividersi un limite solo.
app.use('/api/', limitePerRete);
registraRotteAvvisiTelefono(app);
registraRotteFirebaseTelefono(app);
registraRotteConfermeTelefono(app, { notifiche });
app.use(authenticateToken);
app.use('/api/', apiLimiter);
app.use('/api/', creaIdempotenza({ pool, logger, escluse: ['/magazzino/'] }));

registraRotteAvvisi(app, { notifiche });
registraRotteFirebase(app, { avvisaTelefoni: () => avvisaTelefoniInAscolto() });
registraRotteGestionePermessi(app);

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

registraRotteDocumenti(app, { emergenzaAttiva: () => activeEmergency });
registraRotteAttivita(app);
registraRottePresenze(app);
registraRotteChiamate(app);
registraRotteCopione(app);
registraRotteScenari(app);

registraRotteRubrica(app, { pool, logger, nonEsterni, registraAudit, nomeUtente, avvisaClienti });

registraRotteMappaElementi(app, {
    pool, logger, haRuolo, ruoliDi, registraAudit, nomeUtente, avvisaClienti, checkAdminRole,
    emergenzaAttiva: () => activeEmergency
});

registraRotteCartografia(app, { logger, registraAudit });
registraRotteAllerta(app);

registraRotteFunzioni(app, {
    pool, logger, haRuolo, ruoliDi, registraAudit, nomeUtente, avvisaClienti, checkAdminRole,
    notificaA: notifiche.notificaA, emergenzaAttiva: () => activeEmergency
});

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

registraIntegrita(app, { soloAdmin: checkAdminRole, registraAudit, dominio: domainName });
registraRotteCifratura(app, { soloAdmin: checkAdminRole, registraAudit });

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
    cartellaDati: RADICE_DATI,
    cartellaAgente: process.env.ORION_AGENTE_DIR || null,
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
app.get('/admin/admin.html', authenticateToken, richiedePermesso('volontari.anagrafica'), pagina(ADMIN, 'admin.html'));
app.get('/admin/dashboard-admin.html', authenticateToken, checkAdminRole, pagina(ADMIN, 'dashboard-admin.html'));
app.get('/admin/squadre.html', authenticateToken, pagina(ADMIN, 'squadre.html'));
app.get('/admin/archive.html', authenticateToken, richiedePermesso('emergenze.archivio'), pagina(ADMIN, 'archive.html'));
app.get('/admin/sistema.html', authenticateToken, checkAdminRole, pagina(ADMIN, 'sistema.html'));
app.get('/admin/funzioni.html', authenticateToken, richiedePermesso('emergenze.funzioni'), pagina(ADMIN, 'funzioni.html'));
app.get('/admin/tesserino.html', authenticateToken, checkAdminRole, pagina(ADMIN, 'tesserino.html'));

registraRotteSessioni(app);
registraRotteInformativa(app);
registraRotteMfa(app);
registraRotteTelefoni(app, { notifiche });
registraRotteImpostazioni(app);
registraRotteEmergenze(app);
registraRotteUtenti(app);
registraRotteSquadre(app);
registraRotteSegnalazioni(app);
registraRotteLetture(app);
registraRotteSegreteria(app);

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
        migrazioniFallite = (await applicaMigrazioniMancanti()) < 0;
        if (datiSeparati) {
            const apk = await portaAppAndroid(path.join(RADICE_APP, 'app-android'), CARTELLA_APK);
            if (apk.esito === 'copiata') logger.info(`[App Android] Portata la versione ${apk.nuova.nome || apk.nuova.codice} dall'immagine.`);
            else if (apk.esito === 'altra-chiave') logger.warn('[App Android] L\'APK dell\'immagine è firmato con un\'altra chiave: resta quello installato.');
            else if (apk.esito === 'errore') logger.error(`[App Android] Copia dall'immagine non riuscita: ${apk.errore}`);
        }
        await preparaCifratura();
        cifraFileInChiaro().catch(e => logger.error('[Cifratura] Giro dei file non riuscito:', e));
        setInterval(() => cifraFileInChiaro().catch(() => {}), 3600000);
        await loadActiveEmergency();
        await caricaVersioneInformativa();
        await preparaPrimoAccesso();
        avviaIntegrita();
        runDailyExpiryCheck();
        setInterval(runDailyExpiryCheck, 3600000);
        cleanupRevokedTokens();
        setInterval(cleanupRevokedTokens, 24 * 3600000);
        notifiche.pulisci();
        setInterval(notifiche.pulisci, 24 * 3600000);
        magazzino.pulisciIdempotenza();
        setInterval(magazzino.pulisciIdempotenza, 24 * 3600000);
        backupDiRecupero();
        setInterval(backupDiRecupero, 6 * 3600000);
        avviaAllerta();
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
