// Valori condivisi fra le rotte: nomi radio, stati e priorità delle
// segnalazioni, errori con il loro codice HTTP.

import { domainName, port } from './config.js';

// Le squadre si chiamano con l'alfabeto fonetico: "Alfa" si capisce anche
// con la radio che gracchia, "Squadra 1" no.
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

// Errore nei dati della richiesta: 400, non 500.
export function erroreRichiesta(messaggio) {
    const errore = new Error(messaggio);
    errore.richiestaNonValida = true;
    return errore;
}

// Richiesta legittima ma in conflitto con lo stato dei dati (squadra già
// impegnata, segnalazione già chiusa): 409.
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

// Perché una segnalazione non aspetta una squadra: con uno di questi motivi
// il centro operativo non la segnala come in ritardo. Gli stessi codici sono in
// public/js/centro-operativo.js e nel vincolo reports_no_team_reason_check
// di db/orion-1.0.sql.
export const MOTIVI_SENZA_SQUADRA = {
    altro_ente: 'Gestita da altro ente',
    monitoraggio: 'Solo monitoraggio',
    nessun_intervento: 'Nessun intervento necessario'
};

// Il tempo dopo cui una segnalazione senza squadra diventa rossa si sceglie
// nelle impostazioni, fino a questo massimo.
export const MINUTI_ATTESA_CRITICA_MAX = 240;
