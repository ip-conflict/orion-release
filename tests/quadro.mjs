// tests/quadro.mjs
//
// Il quadro della situazione: quello che la sala scrive per chi legge il
// punto di situazione da fuori (che cosa succede, popolazione coinvolta,
// servizi interrotti, richieste di supporto, recapito, prossimo
// aggiornamento). Si salva per l'emergenza aperta, finisce nel foglio, si
// controlla quello che arriva; recapito e responsabile si propongono
// dall'emergenza precedente.
//
// Se non c'è un'emergenza aperta ne apre due di seguito e le chiude; se ce
// n'è già una, prova solo quella. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/quadro.mjs

import 'dotenv/config';
import { accediConFetch } from './accesso-prova.mjs';
import { normalizzaQuadro } from '../src/situazione.js';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const errore = (f) => { try { f(); return null; } catch (e) { return e.message; } };

console.log('\nQuadro della situazione');

// I controlli sui campi, senza server.
const q = normalizzaQuadro({ descrizione: '  Piena del torrente  ', evacuati: '12', feriti: 0, dispersi: '', servizi: '   ', prossimo: '2026-10-07T18:00', altro: 'x' });
verifica('testi ripuliti, numeri interi, vuoti tolti, campi estranei ignorati',
    JSON.stringify(q) === JSON.stringify({ descrizione: 'Piena del torrente', evacuati: 12, feriti: 0, prossimo: '2026-10-07T18:00' }), q);
verifica('numero negativo rifiutato', !!errore(() => normalizzaQuadro({ evacuati: -1 })));
verifica('numero con la virgola rifiutato', !!errore(() => normalizzaQuadro({ isolati: '2.5' })));
verifica('testo troppo lungo rifiutato', !!errore(() => normalizzaQuadro({ recapito: 'x'.repeat(301) })));
verifica('ora in un formato diverso rifiutata', !!errore(() => normalizzaQuadro({ prossimo: '07/10/2026 18:00' })));

const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
const giaAperta = !!(stato?.emergency || stato?.active);
let aperta = false;
const apri = async (n) => {
    const r = await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `QUADRO-${suffisso}-${n}`, name: `Prova quadro ${n}` } });
    aperta = r.stato < 300;
    return r.corpo?.emergency;
};
const chiudi = async () => { await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} }); aperta = false; };

try {
    if (!giaAperta) {
        const fuori = await chiama('/api/situazione/quadro', { method: 'PUT', token: admin, body: { descrizione: 'x' } });
        verifica('senza emergenza aperta non si scrive', fuori.stato === 409, fuori);
        await apri(1);
    }
    const errato = await chiama('/api/situazione/quadro', { method: 'PUT', token: admin, body: { feriti: -3 } });
    verifica('un numero non valido torna indietro con 400', errato.stato === 400, errato);

    const dati = { descrizione: `Piena del torrente ${suffisso}`, evacuati: 12, isolati: 45, feriti: 1,
        servizi: 'Energia assente a Mis', richieste: 'Una idrovora', recapito: `0437 ${suffisso}`, responsabile: 'il Sindaco', prossimo: '2026-10-07T18:00' };
    const salva = await chiama('/api/situazione/quadro', { method: 'PUT', token: admin, body: dati });
    verifica('salvato, con chi e quando', salva.stato === 200 && salva.corpo?.quadro?.evacuati === 12 && !!salva.corpo.quadro.aggiornato_il && !!salva.corpo.quadro.aggiornato_da, salva);
    const letto = (await chiama('/api/situazione/quadro', { token: admin })).corpo?.quadro;
    verifica('si rilegge uguale', Object.entries(dati).every(([k, v]) => letto?.[k] === v), letto);
    const foglio = (await chiama('/api/situazione', { token: admin })).corpo;
    verifica('finisce nel punto di situazione', foglio?.quadro?.descrizione === dati.descrizione && foglio.quadro.recapito === dati.recapito, foglio?.quadro);

    // Salvare di nuovo sostituisce: un campo svuotato sparisce.
    await chiama('/api/situazione/quadro', { method: 'PUT', token: admin, body: { ...dati, richieste: '', feriti: '' } });
    const dopo = (await chiama('/api/situazione/quadro', { token: admin })).corpo?.quadro;
    verifica('un campo svuotato sparisce', dopo && !('richieste' in dopo) && !('feriti' in dopo) && dopo.evacuati === 12, dopo);

    if (!giaAperta) {
        const prima = (await chiama('/api/emergencies/status', { token: admin })).corpo;
        const idPrima = prima?.emergency?.id ?? prima?.id;
        await chiudi();
        const archivio = (await chiama(`/api/situazione?emergenza=${idPrima}`, { token: admin })).corpo;
        verifica("resta nel foglio dell'emergenza chiusa", archivio?.chiusa === true && archivio.quadro?.descrizione === dati.descrizione, archivio?.quadro);

        await apri(2);
        const nuova = (await chiama('/api/situazione/quadro', { token: admin })).corpo;
        verifica("nell'emergenza nuova il quadro è vuoto", nuova?.quadro === null, nuova);
        verifica("recapito e responsabile proposti dall'emergenza precedente",
            nuova?.proposta?.recapito === dati.recapito && nuova.proposta.responsabile === dati.responsabile && !('descrizione' in (nuova.proposta || {})), nuova?.proposta);
    } else {
        console.log("  (un'emergenza era già aperta: la proposta dall'emergenza precedente non si prova)");
    }
} finally {
    if (aperta) await chiudi();
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
