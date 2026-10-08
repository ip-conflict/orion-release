
let ws = null;
let reconnectTimeout = null;
// Con il server giù non si martella: il primo tentativo è subito, poi
// sempre più distanziati fino a 10 secondi.
let attesaRiconnessione = 500;

function connectWebSocket() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    console.log(`Tentativo connessione WebSocket a ${wsUrl}`);

    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
        console.log('WebSocket Connesso.');
        attesaRiconnessione = 500;
    };

    ws.onclose = function (event) {
        console.log('WebSocket Disconnesso:', event.code, event.reason);
        ws = null;
        if (!reconnectTimeout) {
             reconnectTimeout = setTimeout(() => {
                console.log('Tentativo di riconnessione WebSocket...');
                reconnectTimeout = null;
                connectWebSocket();
             }, attesaRiconnessione);
             attesaRiconnessione = Math.min(attesaRiconnessione * 2, 10000);
        }
    };

    ws.onerror = function (error) {
        console.error('Errore WebSocket:', error);
    };

    ws.onmessage = (event) => {
    try {
        const message = JSON.parse(event.data);
        console.log('[WebSocket] Messaggio Ricevuto:', message); 

        if (message.action) {
            
            // 1. Costruisci il nome dell'evento custom dinamicamente
            //    Anteponiamo 'ws:' per chiarezza e per evitare conflitti.
            const eventName = `ws:${message.action}`; 
            
            // 2. Crea l'evento custom
            //    Passiamo l'intero oggetto 'message' ricevuto dal server nel campo 'detail'.
            //    Gli script che ascoltano potranno accedere ai dati con event.detail
            const customEvent = new CustomEvent(eventName, { detail: message });
            
            console.log(`[WebSocket] Invio evento custom: ${eventName}`);
            document.dispatchEvent(customEvent);
            
            // Non serve più lo switch/case o le chiamate dirette a funzioni!
            // Ogni modulo (es. centro-operativo.js) si registrerà per gli eventi 
            // specifici che gli interessano (es. 'ws:reload_location') e chiamerà
            // le proprie funzioni interne (es. loadTeamLocations).

        } else {
            console.warn("[WebSocket] Messaggio ricevuto senza campo 'action':", message);
        }

    } catch (e) {
        console.error("[WebSocket] Errore nel processare il messaggio:", e, "Dati grezzi:", event.data);
    }
};

}

// Avvia la connessione la prima volta
connectWebSocket();

