import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Di chi è una richiesta, per i limiti: una persona collegata si conta per sé
// (una sala operativa esce da un solo indirizzo), chi non lo è per indirizzo,
// e un indirizzo IPv6 per la sua rete /64.
export const chiaveIndirizzo = (ip) => ipKeyGenerator(String(ip || ''), 64);

export const chiaveRichiesta = (req) =>
    req.user?.id ? `utente:${req.user.id}` : `indirizzo:${ipKeyGenerator(req.ip || '', 64)}`;

const userKeyGenerator = chiaveRichiesta;

// Le posizioni delle squadre (ogni 15 secondi da ogni telefono) non si contano.
// Il limitatore è montato su '/api/': il percorso intero sta in baseUrl + path.
const ePosizione = (req) => req.method === 'POST' && `${req.baseUrl || ''}${req.path}` === '/api/location';
// Nemmeno i tasselli della cartografia del territorio: una mappa a tutto
// schermo ne chiede decine a ogni spostamento.
const eTassello = (req) => req.method === 'GET' && /^\/api\/mappa\/cartografia\/\d+\/\d+\/\d+$/.test(`${req.baseUrl || ''}${req.path}`);
const nonContare = (req) => ePosizione(req) || eTassello(req);

// Un tetto contro un client impazzito, non contro chi lavora: in emergenza il
// centro operativo ricarica le segnalazioni a ogni evento, e le rotte
// pubbliche (logo, impostazioni) si contano per indirizzo, cioè per tutta la
// sala. Accesso, rinnovo e codici degli esterni hanno limiti propri, stretti.
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1500,
    message: { message: 'Troppe richieste in poco tempo: aspetta qualche minuto e riprova.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator, // per persona se collegata, altrimenti per rete
    skip: nonContare
});

// Prima di sapere chi è: un tetto alto per indirizzo, contro chi martella il
// server anche con token inventati.
export const limitePerRete = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: { message: 'Troppe richieste da questa rete: aspetta qualche minuto e riprova.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `rete:${ipKeyGenerator(req.ip || '', 64)}`,
    skip: nonContare
});

export const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  // Per indirizzo: chi tenta una password non è ancora nessuno. Contano solo
  // i tentativi sbagliati: una sala che entra tutta insieme non si blocca.
  keyGenerator: (req) => `indirizzo:${ipKeyGenerator(req.ip || '', 64)}`,
  skipSuccessfulRequests: true,
  // In JSON, come le altre risposte: la pagina d'accesso e l'app mostrano il motivo.
  message: { message: 'Troppi tentativi sbagliati da questa rete: aspetta un quarto d\'ora e riprova.' },
  standardHeaders: true,
  legacyHeaders: false
});

export const reportCreationLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, 
    max: 50, // Alzato a 50 (ora è per singolo operatore, molto generoso)
    message: { message: 'Hai creato troppe segnalazioni in poco tempo: riprova fra qualche minuto.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator // Limita per operatore
});

export const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, // Alzato a 100 (circa 6-7 caricamenti di blocchi da 15 foto per operatore)
    message: { message: 'Hai caricato troppi file in poco tempo: riprova fra un quarto d\'ora.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator // Limita per operatore
});

export const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { message: 'Troppe operazioni di amministrazione in poco tempo: riprova fra un quarto d\'ora.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator // Limita per operatore admin
});
