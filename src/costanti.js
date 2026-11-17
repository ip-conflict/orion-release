import { domainName, port } from './config.js';

// L'alfabeto fonetico si capisce anche con la radio che gracchia.
export const NOMI_RADIO = [
    'Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
    'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa',
    'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey',
    'X-ray', 'Yankee', 'Zulu'
];

export const allowedOrigins = [
    "https://" + domainName,
    "http://localhost:" + port
];

export const VALID_REPORT_STATUSES = ['New', 'Open', 'InProgress', 'Closed'];
export const ACTIVE_REPORT_STATUSES_BACKEND = ['New', 'Open', 'InProgress'];
export const TERMINAL_REPORT_STATUSES_BACKEND = ['Closed'];

export function erroreRichiesta(messaggio) {
    const errore = new Error(messaggio);
    errore.richiestaNonValida = true;
    return errore;
}

export function erroreConflitto(messaggio) {
    const errore = new Error(messaggio);
    errore.conflitto = true;
    return errore;
}

export function erroreNonTrovato(messaggio = 'Segnalazione non trovata.') {
    const errore = new Error(messaggio);
    errore.nonTrovato = true;
    return errore;
}

export const ETICHETTA_PRIORITA = { High: 'ALTA', Medium: 'MEDIA', Low: 'BASSA' };
export const ETICHETTA_STATO = { New: 'Nuova', Open: 'Aperta', InProgress: 'In corso', Closed: 'Chiusa', Resolved: 'Risolta' };

// L'ordine conta: dal campo si va solo avanti (si può saltare), indietro corregge la sala.
export const STATI_SQUADRA = ['assegnata', 'partita', 'sul_posto', 'conclusa', 'rientrata'];
export const ETICHETTA_STATO_SQUADRA = { assegnata: 'assegnata', partita: 'partita', sul_posto: 'sul posto', conclusa: 'intervento concluso', rientrata: 'rientrata' };

// Gli stessi codici nel vincolo della colonna reports.tipo.
export const TIPI_SEGNALAZIONE = {
    allagamento: 'Allagamento', albero: 'Albero o ramo', frana: 'Frana o smottamento', persona: 'Persona da soccorrere o assistere',
    viabilita: 'Viabilità', struttura: 'Edificio o struttura', altro: 'Altro'
};

// Gli stessi codici nella migrazione qualifiche e in public/js/qualifiche.js, che ne tiene colori e icone.
export const QUALIFICHE = {
    vvf: 'Vigili del Fuoco', pc_esterno: 'Gruppo di protezione civile esterno', polizia_locale: 'Polizia Locale',
    polizia: 'Polizia di Stato', carabinieri: 'Carabinieri', sanitario: 'Soccorso sanitario (118)', croce_rossa: 'Croce Rossa Italiana',
    soccorso_alpino: 'Soccorso Alpino', forze_armate: 'Forze Armate', altro_ente: 'Altro ente'
};

// Vuoto vuol dire "nessuna": è facoltativa.
export function leggiQualifica(valore) {
    if (valore === undefined || valore === null || valore === '') return { valore: null };
    const codice = String(valore);
    return Object.hasOwn(QUALIFICHE, codice) ? { valore: codice } : { errore: `La qualifica è una fra: ${Object.values(QUALIFICHE).join(', ')}.` };
}

// Gli stessi codici in public/js/centro-operativo.js e nel vincolo
// reports_no_team_reason_check di db/orion-1.0.sql.
export const MOTIVI_SENZA_SQUADRA = {
    altro_ente: 'Gestita da altro ente',
    monitoraggio: 'Solo monitoraggio',
    nessun_intervento: 'Nessun intervento necessario'
};

export const MINUTI_ATTESA_CRITICA_MAX = 240;
