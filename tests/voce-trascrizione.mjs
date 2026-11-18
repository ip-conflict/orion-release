// La trascrizione dei messaggi vocali con un whisper finto: coda, avviso a chi ascolta, diario,
// ricerca. Il server va avviato con ORION_WHISPER=tests/whisper-finto.sh, sulla stessa macchina
// (la prova mette un modello finto nella cartella dei modelli). Serve un'emergenza aperta.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/voce-trascrizione.mjs

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { accediConFetch, prendiVisione, PASSWORD_PROVA } from './accesso-prova.mjs';
import { RADICE_DATI } from '../src/percorsi.js';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const attesa = ms => new Promise(r => setTimeout(r, ms));
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

console.log('\nTrascrizione dei messaggi vocali');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const prima = (await chiama('/api/voce/trascrizione', { token: admin })).corpo;
if (!prima?.programma) {
    console.log('  (saltata: il server non ha il programma di trascrizione; avvialo con ORION_WHISPER=tests/whisper-finto.sh)');
    process.exit(0);
}
if (!(await chiama('/api/emergencies/status', { token: admin })).corpo?.active) { console.error('Serve un\'emergenza aperta.'); process.exit(2); }
const voceDiPrima = (await chiama('/api/branding/settings', { token: admin })).corpo?.voce_enabled ?? 'false';
const modello = path.join(RADICE_DATI, 'modelli', 'ggml-base.bin');
const modelloCera = fs.existsSync(modello);
const modelloLento = path.join(RADICE_DATI, 'modelli', 'ggml-small.bin');
const modelloLentoCera = fs.existsSync(modelloLento);
const suffisso = Date.now().toString().slice(-5);
let persona = null;
let squadraId = null;
let segnalazione = null;
let ws = null;

try {
    if (!modelloCera) {
        fs.mkdirSync(path.dirname(modello), { recursive: true });
        fs.writeFileSync(modello, 'modello finto per le prove');
    }
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { voce_enabled: 'true' } });
    const scelta = await chiama('/api/voce/trascrizione', { method: 'POST', token: admin, body: { modello: 'base' } });
    verifica('l\'amministratore sceglie il modello già sul server, senza scaricarlo', scelta.stato === 200 && scelta.corpo.modello === 'base'
        && !scelta.corpo.modelli.find(m => m.id === 'base').scaricamento, scelta.corpo);
    verifica('un modello che non esiste no', (await chiama('/api/voce/trascrizione', { method: 'POST', token: admin, body: { modello: 'enorme' } })).stato === 400);

    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Teresa', cognome: `Trascrive${suffisso}`, role: 'volontario' } })).corpo;
    const q = new URL(n.magicLink).searchParams;
    const password = PASSWORD_PROVA;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const token = (await chiama('/login', { method: 'POST', body: { username: n.username, password } })).corpo.token;
    await prendiVisione(BASE, token);
    persona = { id: n.id, token };
    verifica('la scelta del modello è solo dell\'amministratore', (await chiama('/api/voce/trascrizione', { token })).stato === 403);
    for (const nome of ['Kilo', 'Lima', 'Mike', 'November', 'Juliett', 'India', 'Hotel', 'Golf', 'Foxtrot', 'Echo']) {
        const r = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: nome, nome: 'Prova trascrizione', caposquadra: n.username, membri: [{ username: n.username }] } });
        if (r.stato === 201) { squadraId = r.corpo.squadraId; break; }
    }
    segnalazione = (await chiama('/api/reports', { method: 'POST', token: admin, body: { title: 'Collaudo trascrizione', reporter_name: 'Collaudo', reporter_contact: '000', priority: 'Low' } })).corpo?.id;
    await chiama(`/api/reports/${segnalazione}/teams`, { method: 'POST', token: admin, body: { teamId: squadraId } });
    await attesa(3500);

    // Il server rilegge l'accensione della voce ogni cinque secondi.
    for (let i = 0; i < 30 && (await chiama('/api/voce/stato', { token })).corpo?.modulo_spento; i++) await attesa(250);
    const tokenVoce = (await chiama('/api/voce/token', { method: 'POST', token, body: { dispositivo: 'collaudo' } })).corpo?.voce;
    ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/voce', { headers: { Authorization: `Voce ${tokenVoce}` } });
    const ricevuti = [];
    ws.on('message', (d, binario) => { if (!binario) ricevuti.push(JSON.parse(d.toString())); });
    await new Promise((ok, ko) => { ws.on('open', ok); ws.on('error', ko); });
    const aspetta = async (filtro, ms = 8000) => {
        const fine = Date.now() + ms;
        while (Date.now() < fine) {
            const m = ricevuti.find(filtro);
            if (m) return m;
            await attesa(50);
        }
        return null;
    };
    const canale = `squadra:${squadraId}`;
    await aspetta(m => m.t === 'stato');
    const parla = async () => {
        const uuid = crypto.randomUUID();
        ws.send(JSON.stringify({ t: 'parla', uuid, canale }));
        await aspetta(m => m.t === 'parla_ok' && m.uuid === uuid);
        // Pacchetti di solo TOC (SILK, 60 ms): silenzio valido, quanto basta per il decodificatore.
        for (let i = 0; i < 12; i++) ws.send(Buffer.from([i >> 8, i & 0xff, 11 << 3]));
        ws.send(JSON.stringify({ t: 'fine', uuid, pacchetti: 12 }));
        return aspetta(m => m.t === 'salvato' && m.uuid === uuid);
    };
    const salvato = await parla();
    verifica('il messaggio è salvato', !!salvato?.id, salvato);

    const trascritto = await aspetta(m => m.t === 'trascritto' && m.id === salvato?.id, 15000);
    verifica('chi ascolta il canale riceve la trascrizione, senza le righe di silenzio', trascritto?.testo === 'Bravo arrivato sul posto, serve una motopompa.', trascritto);

    const cronologia = (await chiama(`/api/voce/messaggi?canale=${encodeURIComponent(canale)}`, { token })).corpo?.messaggi || [];
    verifica('la cronologia porta il testo', cronologia.find(m => m.id === salvato?.id)?.trascrizione === trascritto?.testo, cronologia);
    const trovati = async (testo) => ((await chiama(`/api/voce/messaggi?canale=${encodeURIComponent(canale)}&q=${encodeURIComponent(testo)}`, { token })).corpo?.messaggi || []).map(m => m.id);
    verifica('si cerca per parola, anche al plurale (motopompe)', (await trovati('motopompe')).includes(salvato?.id));
    verifica('e per pezzo di parola', (await trovati('motopom')).includes(salvato?.id));
    verifica('una parola che non c\'è non trova niente', !(await trovati('elicottero')).includes(salvato?.id));

    await attesa(1000);
    const diario = (await chiama(`/api/reports/${segnalazione}`, { token: admin })).corpo?.updates || [];
    const nota = diario.find(u => u.voce_id === salvato?.id);
    verifica('la nota del diario resta quella (storico inalterabile) e porta accanto la trascrizione', nota && /Messaggio vocale/.test(nota.update_text) && nota.voce_trascrizione === trascritto?.testo, nota);

    const stato = (await chiama('/api/voce/trascrizione', { token: admin })).corpo;
    verifica('l\'amministratore vede quanto calcolo serve per ogni secondo di voce', typeof stato?.rapporto === 'number', stato);
    verifica('e se la memoria basta per ogni modello', typeof stato?.memoria_libera_mb === 'number'
        && stato.modelli.every(m => typeof m.memoria_sufficiente === 'boolean'), stato);

    if (!modelloLentoCera) fs.writeFileSync(modelloLento, 'modello finto e lento per le prove');
    const lento = await chiama('/api/voce/trascrizione', { method: 'POST', token: admin, body: { modello: 'small' } });
    if (lento.stato === 409) {
        console.log(`  (cambio di modello saltato: ${lento.corpo?.message})`);
    } else {
        await attesa(5500);
        const secondo = await parla();
        await attesa(1500);
        verifica('col modello lento il messaggio è ancora in lavoro', !ricevuti.some(m => m.t === 'trascritto' && m.id === secondo?.id)
            && (await chiama('/api/voce/trascrizione', { token: admin })).corpo?.in_coda === 1);
        await chiama('/api/voce/trascrizione', { method: 'POST', token: admin, body: { modello: 'base' } });
        const ripreso = await aspetta(m => m.t === 'trascritto' && m.id === secondo?.id, 8000);
        verifica('tornando al modello di prima, il messaggio fermo su quello lento si trascrive subito', !!ripreso, ricevuti.filter(m => m.t === 'trascritto'));
        const terzo = await parla();
        verifica('e i messaggi nuovi pure', !!(await aspetta(m => m.t === 'trascritto' && m.id === terzo?.id, 8000)));
    }
    verifica('il modello in uso non si cancella', (await chiama('/api/voce/trascrizione/modelli/base', { method: 'DELETE', token: admin })).stato === 409);
} finally {
    try { ws?.terminate(); } catch { /* già chiusa */ }
    await chiama('/api/voce/trascrizione', { method: 'POST', token: admin, body: { modello: prima.modello } }).catch(() => {});
    if (!modelloCera) fs.rmSync(modello, { force: true });
    if (!modelloLentoCera) fs.rmSync(modelloLento, { force: true });
    if (segnalazione && squadraId) await chiama(`/api/reports/${segnalazione}/teams/${squadraId}`, { method: 'DELETE', token: admin }).catch(() => {});
    if (segnalazione) await chiama(`/api/reports/${segnalazione}`, { method: 'DELETE', token: admin }).catch(() => {});
    if (squadraId) await chiama(`/api/squadre/${squadraId}`, { method: 'DELETE', token: admin });
    if (persona) await chiama(`/api/users/${persona.id}`, { method: 'DELETE', token: admin });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { voce_enabled: voceDiPrima } });
}

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutto a posto.');
process.exit(falliti ? 1 : 0);
