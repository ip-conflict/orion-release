// Chi può fare cosa: ogni operazione di tests/matrice-permessi.json provata con ogni profilo, contro l'esito atteso.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/matrice-permessi.mjs
// Con --fotografa riscrive gli esiti attesi con quelli di adesso: solo dopo un cambio di permessi voluto,
// da guardare riga per riga nel diff prima del commit. Vuole un'istanza senza emergenze in corso.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { accediConFetch, prendiVisione } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const FILE_ATTESE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'matrice-permessi.json');
const FOTOGRAFA = process.argv.includes('--fotografa');
const PROFILI = ['anonimo', 'volontario', 'volontario_squadra', 'coc', 'funzione', 'coordinatore', 'segreteria', 'magazziniere', 'esterno', 'amministratore'];
const NOMI_RADIO = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike',
    'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu'];

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
const deve = (r, descr) => {
    if (r.stato >= 300) throw new Error(`${descr}: HTTP ${r.stato} ${JSON.stringify(r.corpo)}`);
    return r.corpo;
};
const esito = (stato) => (stato >= 200 && stato < 300 ? 'ok' : stato === 401 || stato === 403 ? 'negato' : String(stato));

console.log('\nMatrice dei permessi');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
if ((await chiama('/api/emergencies/status', { token: admin })).corpo?.active) {
    console.error("C'è un'emergenza in corso: la matrice ne apre una sua, quindi vuole un'istanza senza.");
    process.exit(2);
}

const MODULI = ['funzioni_enabled', 'magazzino_enabled', 'attivita_enabled', 'voce_enabled', 'drone_enabled'];
const impostazioniPrima = deve(await chiama('/api/branding/settings/full', { token: admin }), 'impostazioni');
let segreteria = {};
try { segreteria = JSON.parse(impostazioniPrima.segreteria_config || '{}'); } catch { /* guasta: si riparte da vuota */ }
deve(await chiama('/api/branding/settings', {
    method: 'PUT', token: admin,
    body: { ...Object.fromEntries(MODULI.map(m => [m, 'true'])), segreteria_config: JSON.stringify({ ...segreteria, enabled: true }) }
}), 'accensione dei moduli');

// Le lettere al posto delle cifre: i nomi con le cifre non diventano nomi utente.
const sigla = [...Date.now().toString().slice(-5)].map(c => 'abcdefghij'[Number(c)]).join('');
const PASSWORD = `Ventaglio-${crypto.randomBytes(3).toString('hex')}-Corteccia!`;
const creati = [];

async function nuovaPersona(cognome, ruoli) {
    const r = deve(await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Matrice', cognome: `${cognome}${sigla}`, ruoli } }), `persona ${cognome}`);
    creati.push(r.id);
    const link = new URL(r.magicLink);
    deve(await chiama('/api/auth/reset-password', { method: 'POST', body: { token: link.searchParams.get('token'), id: link.searchParams.get('id'), newPassword: PASSWORD } }), `password di ${cognome}`);
    return r;
}
async function accedi(persona) {
    return (await accediConFetch(BASE, persona.username, PASSWORD)).token;
}

const p = {};
const token = { anonimo: null, amministratore: admin };
let emergenza = null;
let esternoId = null;
let contattoCreato = null;
const squadreCreate = [];
const risultati = {};

try {
    for (const [profilo, cognome, ruoli] of [
        ['volontario', 'Volontario', ['volontario']], ['volontario_squadra', 'Squadra', ['volontario']], ['coc', 'Coc', ['volontario']],
        ['funzione', 'Funzione', ['volontario']], ['coordinatore', 'Coordinatore', ['coordinatore']], ['segreteria', 'Segreteria', ['segreteria']],
        ['magazziniere', 'Magazziniere', ['magazziniere']], ['bersaglio', 'Bersaglio', ['volontario']]
    ]) {
        p[profilo] = await nuovaPersona(cognome, ruoli);
        if (profilo !== 'bersaglio') token[profilo] = await accedi(p[profilo]);
    }

    emergenza = deve(await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `MATRICE-${sigla.toUpperCase()}` } }), 'emergenza').emergency.id;
    const squadre = deve(await chiama('/api/squadre', { token: admin }), 'squadre');
    const coc = squadre.find(s => s.coc);
    deve(await chiama(`/api/squadre/${coc.id}`, { method: 'PUT', token: admin, body: { membri: [...coc.membri.map(m => ({ username: m.username })), { username: p.coc.username }] } }), 'squadra COC');

    async function nuovaSquadra(membri) {
        const usati = new Set((deve(await chiama('/api/squadre', { token: admin }), 'squadre')).map(s => s.nome_radio));
        for (const nome of NOMI_RADIO.filter(n => !usati.has(n))) {
            const r = await chiama('/api/squadre', { method: 'POST', token: admin, body: { nome_radio: nome, nome: 'Matrice', membri } });
            if (r.stato === 201) {
                squadreCreate.push(r.corpo.squadraId);
                return { id: r.corpo.squadraId, nome_radio: nome };
            }
        }
        throw new Error('nessun nome radio libero per le squadre della matrice');
    }
    const squadraMia = await nuovaSquadra([{ username: p.volontario_squadra.username }]);
    const squadraLibera = await nuovaSquadra([]);

    const funzione = deve(await chiama('/api/admin/funzioni', { token: admin }), 'funzioni').funzioni?.find(f => f.attiva) ?? null;
    if (!funzione) throw new Error('nessuna funzione di supporto attiva');
    deve(await chiama(`/api/funzioni/${funzione.id}/membri`, { method: 'POST', token: admin, body: { user_id: p.funzione.id } }), 'membro della funzione');

    const segnalazioneMia = deve(await chiama('/api/reports', { method: 'POST', token: admin, body: { title: 'Matrice: della squadra' } }), 'segnalazione mia').id;
    const segnalazioneAltrui = deve(await chiama('/api/reports', { method: 'POST', token: admin, body: { title: 'Matrice: di nessuno' } }), 'segnalazione altrui').id;
    deve(await chiama(`/api/reports/${segnalazioneMia}/teams`, { method: 'POST', token: admin, body: { teamId: squadraMia.id } }), 'assegnazione');
    const incarico = deve(await chiama(`/api/reports/${segnalazioneMia}/incarichi`, { method: 'POST', token: admin, body: { funzione_id: funzione.id, motivazione: 'Matrice dei permessi' } }), 'incarico').id;
    const elemento = deve(await chiama('/api/mappa/elementi', { method: 'POST', token: admin, body: { tipo: 'strada_chiusa', nome: 'Matrice', geometria: { type: 'LineString', coordinates: [[11.87, 45.40], [11.88, 45.41]] } } }), 'elemento').id;
    const contatto = deve(await chiama('/api/rubrica', { method: 'POST', token: admin, body: { nome: 'Contatto matrice', telefono: '049 000 000' } }), 'contatto').id;
    contattoCreato = contatto;

    const esterno = deve(await chiama('/api/esterni-temporanei', { method: 'POST', token: admin, body: { nome: 'Ospite Matrice', ente: 'Prova', squadra_id: squadraMia.id } }), 'esterno');
    esternoId = esterno.id;
    token.esterno = deve(await chiama('/api/accesso-temporaneo', { method: 'POST', body: { codice: esterno.codice } }), 'accesso esterno').token;
    await prendiVisione(BASE, token.esterno);

    const segnaposti = {
        ':emergenza': emergenza, ':segnalazione_mia': segnalazioneMia, ':segnalazione_altrui': segnalazioneAltrui,
        ':squadra_mia': squadraMia.id, ':nome_radio_mia': squadraMia.nome_radio, ':squadra_libera': squadraLibera.id, ':squadra_coc': coc.id,
        ':funzione': funzione.id, ':incarico': incarico, ':elemento': elemento, ':contatto': contatto, ':esterno': esternoId,
        ':utente_bersaglio': p.bersaglio.id, ':username_squadra': p.volontario_squadra.username
    };
    // Dal più lungo, perché ":squadra_mia" non diventi ":squadra" seguito da "_mia".
    const chiavi = Object.keys(segnaposti).sort((a, b) => b.length - a.length);
    const riempi = (valore, inPiu = {}) => {
        if (typeof valore === 'string') {
            let s = valore;
            for (const k of [...Object.keys(inPiu), ...chiavi]) s = s.split(k).join(String(inPiu[k] ?? segnaposti[k]));
            return /^-?\d+$/.test(s) && /^:/.test(valore) ? Number(s) : s;
        }
        if (Array.isArray(valore)) return valore.map(v => riempi(v, inPiu));
        if (valore && typeof valore === 'object') return Object.fromEntries(Object.entries(valore).map(([k, v]) => [k, riempi(v, inPiu)]));
        return valore;
    };

    const { operazioni } = JSON.parse(fs.readFileSync(FILE_ATTESE, 'utf8'));
    for (const op of operazioni) {
        const nome = `${op.metodo} ${op.percorso}`;
        risultati[nome] = {};
        for (const profilo of PROFILI) {
            const inPiu = {};
            if (op.prima) {
                const prima = deve(await chiama(riempi(op.prima.percorso), { method: op.prima.metodo, token: admin, body: riempi(op.prima.corpo) }), `preparazione di ${nome}`);
                inPiu[':id_prima'] = prima[op.prima.id_campo || 'id'];
            }
            const r = await chiama(riempi(op.percorso, inPiu), { method: op.metodo, token: token[profilo], body: riempi(op.corpo, inPiu) });
            risultati[nome][profilo] = esito(r.stato);
            if (r.stato < 300 && op.dopo) {
                inPiu[':id_creato'] = r.corpo?.[op.id_campo || 'id'];
                await chiama(riempi(op.dopo.percorso, inPiu), { method: op.dopo.metodo, token: admin, body: riempi(op.dopo.corpo, inPiu) });
            }
            if (!FOTOGRAFA) {
                const atteso = op.attese?.[profilo];
                verifica(`${nome} come ${profilo}: ${atteso}`, risultati[nome][profilo] === atteso, `${risultati[nome][profilo]} (HTTP ${r.stato}) ${JSON.stringify(r.corpo)?.slice(0, 120)}`);
            }
        }
    }
    if (FOTOGRAFA) {
        const nuovo = { ...JSON.parse(fs.readFileSync(FILE_ATTESE, 'utf8')) };
        nuovo.operazioni = nuovo.operazioni.map(op => ({ ...op, attese: risultati[`${op.metodo} ${op.percorso}`] }));
        fs.writeFileSync(FILE_ATTESE, JSON.stringify(nuovo, null, 2) + '\n');
        console.log(`  esiti di ${nuovo.operazioni.length} operazioni scritti in ${FILE_ATTESE}: guardali nel diff prima del commit`);
    }
} catch (e) {
    verifica('preparazione della matrice', false, e.message);
} finally {
    if (emergenza) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    if (esternoId) await chiama(`/api/esterni-temporanei/${esternoId}`, { method: 'DELETE', token: admin });
    for (const id of squadreCreate) await chiama(`/api/squadre/${id}`, { method: 'DELETE', token: admin });
    if (contattoCreato) await chiama(`/api/rubrica/${contattoCreato}`, { method: 'DELETE', token: admin });
    for (const id of creati) await chiama(`/api/users/${id}`, { method: 'DELETE', token: admin });
    await chiama('/api/branding/settings', {
        method: 'PUT', token: admin,
        body: { ...Object.fromEntries(MODULI.map(m => [m, impostazioniPrima[m] ?? 'false'])), segreteria_config: impostazioniPrima.segreteria_config ?? JSON.stringify({ enabled: false }) }
    });
}

console.log(`\nMatrice dei permessi: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
