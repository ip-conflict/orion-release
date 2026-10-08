import rateLimit from 'express-rate-limit';

// Di chi è una richiesta, per i limiti: una persona collegata si conta per sé
// (una sala operativa esce da un solo indirizzo), chi non lo è per indirizzo,
// e un indirizzo IPv6 per la sua rete /64.
export function chiaveIndirizzo(ip) {
    const indirizzo = String(ip || '').replace(/^::ffff:/i, '');
    if (!indirizzo.includes(':')) return indirizzo;
    const [testa, coda = ''] = indirizzo.split('::');
    const gruppiTesta = testa ? testa.split(':') : [];
    const gruppiCoda = indirizzo.includes('::') && coda ? coda.split(':') : [];
    const mancanti = 8 - gruppiTesta.length - gruppiCoda.length;
    const gruppi = indirizzo.includes('::')
        ? [...gruppiTesta, ...Array(Math.max(0, mancanti)).fill('0'), ...gruppiCoda]
        : gruppiTesta;
    return gruppi.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

export const chiaveRichiesta = (req) =>
    req.user?.id ? `utente:${req.user.id}` : `indirizzo:${chiaveIndirizzo(req.ip)}`;

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
    message: 'Troppe richieste da questo utente/IP, riprova tra 15 minuti.',
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
    message: 'Troppe richieste da questa rete, riprova tra qualche minuto.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `rete:${chiaveIndirizzo(req.ip)}`,
    skip: nonContare
});

export const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  // Per indirizzo: chi tenta una password non è ancora nessuno.

  keyGenerator: (req) => `indirizzo:${chiaveIndirizzo(req.ip)}`,
  message: 'Troppi tentativi di login da questo IP, riprova più tardi.',
  standardHeaders: true,
  legacyHeaders: false
});

export const reportCreationLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, 
    max: 50, // Alzato a 50 (ora è per singolo operatore, molto generoso)
    message: 'Hai creato troppe segnalazioni, riprova tra alcuni minuti.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator // Limita per operatore
});

export const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, // Alzato a 100 (circa 6-7 caricamenti di blocchi da 15 foto per operatore)
    message: 'Hai caricato troppi file, riprova tra 15 minuti.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator // Limita per operatore
});

export const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Troppe operazioni amministrative, riprova tra 15 minuti.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKeyGenerator // Limita per operatore admin
});
