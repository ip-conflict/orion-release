// Orion Voice: canali, parola, inoltro in diretta, archivio. Il protocollo è nel manuale tecnico.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { haRuolo, tokenSuperato } from './autenticazione.js';
import { ChiaveNonDisponibile, cifra, inviaFile } from './cifratura.js';
import { pool } from './db.js';
import { RADICE_DATI } from './percorsi.js';
import { haPermesso } from './permessi.js';
import { impronta } from './pubbliche.js';
import { activeEmergency } from './statoEmergenza.js';
import { aggiungiPercorsoUpgrade, avvisaClienti, utenteDiSessione } from './tempoReale.js';
import {
    AVVISI, apreDiretti, canaleDiretto, canaliDi, leggiDiretti, leggiProfili, leggiSquadre,
    numeroCanale, prioritaConsentita, ruoloVoce, tipoCanale
} from './voceCanali.js';
import { campioniPacchetto, scriviOggOpus } from './voceOgg.js';
import { DURATA_MASSIMA_MS, creaParola } from './voceParola.js';
import { leggiConfigSegreteria } from './configSegreteria.js';
import {
    MODELLI, accodaTrascrizione, avviaTrascrizione, comeAlzareLaMemoria, eliminaModello, memoriaPerTrascrivereMb, modelloCambiato, modelloScaricato,
    modelloScelto, programmaDisponibile, scaricaModello, statoTrascrizione
} from './voceTrascrizione.js';

export const CARTELLA_VOCE = path.join(RADICE_DATI, 'protected_uploads', 'voce');

const DURATA_MINIMA_MS = 500;
// Contano i messaggi salvati: un tocco a vuoto, un canale occupato o un messaggio annullato no.
// Le richieste hanno un tetto a parte, contro chi preme a raffica.
const MAX_MESSAGGI_AL_MINUTO = 30;
const MAX_RICHIESTE_AL_MINUTO = 90;
const MAX_PACCHETTO = 1500;
const MAX_PACCHETTI = 3200;
// Nginx chiude un collegamento muto dopo 60 secondi: il ping del server lo tiene aperto senza
// toccare la configurazione delle istanze già installate.
const PING_MS = 25_000;
const CONTROLLO_MS = 3_000;
// La rete cade a metà frase: il telefono continua a registrare e manda il resto quando torna.
const ATTESA_RIPRESA_MS = 10 * 60_000;
const SILENZIO_MASSIMO_MS = 60_000;
// Il telefono manda un pacchetto ogni 60 ms anche nelle pause: cinque secondi muti vogliono dire
// rete persa senza chiusura, e il canale resterebbe occupato fino al ping, quasi un minuto.
const SILENZIO_DIRETTA_MS = 5_000;
const ETA_MASSIMA_MS = 24 * 3600_000;
const ECO_RITARDO_MS = 2_000;
const MAX_TOKEN_PER_PERSONA = 3;
// Un messaggio rimasto a metà tiene il suo audio in memoria fino a dieci minuti: senza tetto si
// accumulerebbero riaprendo il collegamento. Chi perde la rete ne lascia uno, che poi riprende.
const MAX_APERTI_PER_PERSONA = 3;
const CHIUSURA = { spenta: 4000, altroTelefono: 4001, emergenzaChiusa: 4002, sessione: 4003 };

const wssVoce = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
const parola = creaParola();
const trasmissioni = new Map();
const inviiRecenti = new Map();
const richiesteRecenti = new Map();
let ultimoStatoModulo = { valore: false, letto: 0 };
let contesto = { squadre: [], diretti: [] };

// Chi spegne la voce dalle Impostazioni non deve aspettare che scada la lettura tenuta da parte.
export function dimenticaStatoModuloVoce() {
    ultimoStatoModulo = { valore: false, letto: 0 };
}

export async function moduloVoceAcceso() {
    if (Date.now() - ultimoStatoModulo.letto < 5_000) return ultimoStatoModulo.valore;
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'voce_enabled'");
    ultimoStatoModulo = { valore: String(r.rows[0]?.setting_value) === 'true', letto: Date.now() };
    return ultimoStatoModulo.valore;
}

// Un'intestazione sua, come gli avvisi: non si confonde con la sessione.
function tokenVoceDa(intestazione) {
    if (typeof intestazione !== 'string' || !intestazione.startsWith('Voce ')) return null;
    const token = intestazione.slice(5).trim();
    return token && token.length <= 200 ? token : null;
}

async function leggiTokenVoce(token, emergencyId) {
    const r = await pool.query(
        `SELECT t.id, t.user_id, (EXTRACT(EPOCH FROM t.creato_il) * 1000)::bigint AS creato
           FROM token_voce t JOIN users u ON u.id = t.user_id
          WHERE t.impronta = $1 AND t.emergency_id = $2
            AND COALESCE(u.is_active, true) AND u.eliminato_il IS NULL
            AND (u.sessioni_valide_dal IS NULL OR t.creato_il >= u.sessioni_valide_dal)`,
        [impronta(token), emergencyId]);
    return r.rows[0] || null;
}

const inviaJson = (ws, dati) => {
    if (ws?.readyState === 1) {
        try { ws.send(JSON.stringify(dati)); } catch { /* si riconnette */ }
    }
};
const collegati = () => [...wssVoce.clients].filter(ws => ws.voce?.profilo && ws.readyState === 1);
const chiAscolta = (canale) => collegati().filter(ws => ws.voce.canali.has(canale));
const diSala = (ws) => { const r = ruoloVoce(ws.voce.profilo); return r.sala || r.coordinatore; };

function rispondiAChiAscolta(canale, dati, tranne = null) {
    for (const ws of chiAscolta(canale)) if (ws !== tranne) inviaJson(ws, dati);
}

function metaMessaggio(m, extra = {}) {
    return {
        id: m.id, uuid: m.uuid, canale: m.canale, tipo: m.tipo, nome_radio: m.nome_radio,
        autore: { id: m.autore_id, nome: m.autore_nome, squadra: m.autore_squadra },
        da_sala: m.da_sala, priorita: m.priorita, differito: m.differito, stato: m.stato,
        registrato_il: m.registrato_il, arrivato_il: m.arrivato_il, durata_ms: m.durata_ms,
        report_id: m.report_id, simulazione: m.simulazione,
        ricevuto_da: m.ricevuto_da_nome || null, riprodotto_in_sala: m.riprodotto_in_sala === true,
        posizione: m.latitudine != null && m.longitudine != null ? { lat: m.latitudine, lon: m.longitudine } : null,
        presa_da: m.presa_da_nome || null,
        trascrizione: m.trascrizione || null,
        ...extra
    };
}

// Le parole intere passano dall'indice; un pezzo di parola o un nome radio scritto a metà dal confronto semplice.
const FILTRO_TESTO = (p) => `(${p}::text IS NULL OR m.ricerca @@ websearch_to_tsquery('italian', ${p})
    OR strpos(lower(coalesce(m.trascrizione, '')), lower(${p})) > 0 OR strpos(lower(m.autore_nome), lower(${p})) > 0
    OR strpos(lower(coalesce(m.nome_radio, '')), lower(${p})) > 0)`;
const testoCercato = (req) => (typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 100) : null);

const SELECT_MESSAGGIO = `
    SELECT m.*, EXISTS (SELECT 1 FROM voce_ascolti a WHERE a.messaggio_id = m.id AND a.da_sala) AS riprodotto_in_sala
      FROM voce_messaggi m`;

async function segnalazioneDellaSquadra(squadraId, quando) {
    if (!squadraId) return null;
    const r = await pool.query(
        `SELECT a.report_id FROM report_team_assignments a JOIN reports r ON r.id = a.report_id
          WHERE a.squadra_id = $1 AND r.emergency_id = $3 AND a.assigned_at <= $2
            AND (a.removed_at IS NULL OR a.removed_at > $2::timestamptz)
          ORDER BY a.assigned_at DESC LIMIT 1`, [squadraId, quando, activeEmergency?.id ?? null]);
    return r.rows[0]?.report_id ?? null;
}

function ultimoMinuto(registro, userId) {
    const adesso = Date.now();
    const recenti = (registro.get(userId) || []).filter(t => adesso - t < 60_000);
    registro.set(userId, recenti);
    return recenti;
}

function troppiMessaggi(userId) {
    const richieste = ultimoMinuto(richiesteRecenti, userId);
    richieste.push(Date.now());
    return richieste.length > MAX_RICHIESTE_AL_MINUTO || ultimoMinuto(inviiRecenti, userId).length >= MAX_MESSAGGI_AL_MINUTO;
}

const contaMessaggio = (userId) => ultimoMinuto(inviiRecenti, userId).push(Date.now());

const durataPacchetti = (pacchetti) => Math.round(pacchetti.reduce((n, p) => n + campioniPacchetto(p), 0) / 48);

const coordinata = (v, limite) => (Number.isFinite(Number(v)) && Math.abs(Number(v)) <= limite ? Number(v) : null);

async function nuovaTrasmissione(ws, { uuid, canale, priorita, differito, etaMs, posizione }) {
    const profilo = ws.voce.profilo;
    const emergenza = activeEmergency;
    const tipo = tipoCanale(canale);
    const quando = new Date(Date.now() - (differito ? etaMs : 0)).toISOString();
    const squadraCanale = tipo === 'squadra' ? numeroCanale(canale) : null;
    const nomeRadio = squadraCanale ? (contesto.squadre.find(s => s.id === squadraCanale)?.nome_radio ?? null) : null;
    const { rows: [m] } = await pool.query(
        `INSERT INTO voce_messaggi (uuid, emergency_id, canale, tipo, squadra_id, nome_radio, persona_id, autore_id, autore_nome,
                                    autore_squadra, da_sala, report_id, priorita, differito, registrato_il, simulazione, latitudine, longitudine)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING *`,
        [uuid, emergenza.id, canale, tipo, squadraCanale, nomeRadio, tipo === 'diretto' ? numeroCanale(canale) : null,
            profilo.id, profilo.nome, profilo.squadra?.nome_radio ?? null, diSala(ws),
            await segnalazioneDellaSquadra(squadraCanale, quando), priorita, differito, quando, emergenza.simulazione === true,
            coordinata(posizione?.lat, 90), coordinata(posizione?.lon, 180)]);
    const t = { uuid, id: m.id, canale, riga: m, pacchetti: [], ws, userId: profilo.id, diretta: !differito, chiusa: false, timer: null,
        inizio: Date.now(), ultimo: Date.now(), ripreso: differito };
    trasmissioni.set(uuid, t);
    ws.voce.trasmissione = t;
    return t;
}

async function chiedeLaParola(ws, richiesta) {
    const { uuid, canale } = richiesta;
    const priorita = ['normale', 'alta', 'emergenza'].includes(richiesta.priorita) ? richiesta.priorita : (canale === AVVISI ? 'alta' : 'normale');
    const differito = richiesta.differito === true;
    const etaMs = Math.min(Math.max(Number(richiesta.eta_ms) || 0, 0), ETA_MASSIMA_MS);
    const rifiuta = (motivo, messaggio) => inviaJson(ws, { t: 'negato', uuid, motivo, messaggio });

    if (typeof uuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(uuid)) return rifiuta('richiesta', 'Identificativo del messaggio non valido.');
    if (canale === 'prova') return provaVoce(ws, uuid);

    const gia = await pool.query('SELECT id, stato FROM voce_messaggi WHERE uuid = $1', [uuid]);
    if (gia.rows[0] && gia.rows[0].stato !== 'in_diretta') return inviaJson(ws, { t: 'salvato', uuid, id: gia.rows[0].id });
    const inCorso = trasmissioni.get(uuid);
    if (inCorso) {
        if (inCorso.userId !== ws.voce.profilo.id) return rifiuta('richiesta', 'Identificativo già usato.');
        clearTimeout(inCorso.timer);
        inCorso.ws = ws;
        inCorso.ripreso = true;
        ws.voce.trasmissione = inCorso;
        return inviaJson(ws, { t: 'parla_ok', uuid, id: inCorso.id, ricevuti: inCorso.pacchetti.length });
    }
    // L'audio era nella memoria di un server che nel frattempo è ripartito: il telefono lo rimanda da capo.
    if (gia.rows[0]) await pool.query("DELETE FROM voce_messaggi WHERE id = $1 AND stato = 'in_diretta'", [gia.rows[0].id]);
    if (!activeEmergency) return rifiuta('emergenza', 'L\'emergenza è chiusa.');

    const info = ws.voce.canali.get(canale);
    // Chi ascolta soltanto la squadra (l'esterno senza "Può parlare") l'emergenza la manda lo stesso;
    // sul generale e sugli avvisi no, arriverebbe a tutti.
    const emergenzaDaChiAscolta = priorita === 'emergenza' && ['squadra', 'diretto'].includes(info?.tipo);
    if (!info || (!info.parla && !emergenzaDaChiAscolta)) return rifiuta('canale', 'Su questo canale non puoi parlare.');
    if (!prioritaConsentita(ws.voce.profilo, canale, priorita)) return rifiuta('priorita', 'Questa priorità non è per te.');
    if (ws.voce.trasmissione && !ws.voce.trasmissione.chiusa) return rifiuta('richiesta', 'Stai già parlando.');

    if (troppiMessaggi(ws.voce.profilo.id)) return rifiuta('frequenza', 'Troppi messaggi in un minuto: aspetta un momento.');
    const aperti = [...trasmissioni.values()].filter(t => t.userId === ws.voce.profilo.id && !t.chiusa).length;
    if (aperti >= MAX_APERTI_PER_PERSONA) return rifiuta('frequenza', 'Hai dei messaggi rimasti a metà: aspetta che arrivino.');
    if (differito) {
        const t = await nuovaTrasmissione(ws, { uuid, canale, priorita, differito: true, etaMs, posizione: richiesta.posizione });
        return inviaJson(ws, { t: 'parla_ok', uuid, id: t.id, ricevuti: 0 });
    }
    const chi = { userId: ws.voce.profilo.id, uuid, nome: ws.voce.profilo.nome, squadra: ws.voce.profilo.squadra?.nome_radio ?? null, sala: diSala(ws), priorita };
    const esito = parola.chiedi(canale, chi);
    if (esito.esito === 'occupato') {
        return inviaJson(ws, { t: 'occupato', uuid, canale, da: { nome: esito.da.nome, squadra: esito.da.squadra, sala: esito.da.sala } });
    }
    if (esito.interrotto) {
        const vecchia = trasmissioni.get(esito.interrotto.uuid);
        if (vecchia) {
            inviaJson(vecchia.ws, { t: 'interrotto', uuid: vecchia.uuid, da: { nome: chi.nome, sala: chi.sala } });
            await chiudiTrasmissione(vecchia, 'interrotto', { parolaGiaPresa: true });
        }
    }
    let t;
    try {
        t = await nuovaTrasmissione(ws, { uuid, canale, priorita, differito: false, etaMs: 0, posizione: richiesta.posizione });
    } catch (e) {
        parola.rilascia(canale, uuid);
        throw e;
    }
    inviaJson(ws, { t: 'parla_ok', uuid, id: t.id, ricevuti: 0 });
    t.annunciato = true;
    rispondiAChiAscolta(canale, { t: 'inizio', messaggio: metaMessaggio(t.riga) }, ws);
    annunciaParola(canale);
}

function annunciaParola(canale) {
    const chi = parola.di(canale);
    rispondiAChiAscolta(canale, { t: 'parola', canale, da: chi ? { nome: chi.nome, squadra: chi.squadra, sala: chi.sala, priorita: chi.priorita } : null });
}

function riceviPacchetto(ws, dati) {
    const t = ws.voce.trasmissione;
    if (!t || t.chiusa || dati.length < 3 || dati.length > MAX_PACCHETTO + 2) return;
    const seq = dati.readUInt16BE(0);
    if (seq !== t.pacchetti.length) return;
    const pacchetto = Buffer.from(dati.subarray(2));
    t.pacchetti.push(pacchetto);
    t.ultimo = Date.now();
    if (t.eco) return;
    if (t.diretta) {
        const trama = Buffer.alloc(6 + pacchetto.length);
        trama.writeUInt32BE(t.id, 0);
        trama.writeUInt16BE(seq, 4);
        pacchetto.copy(trama, 6);
        for (const altro of chiAscolta(t.canale)) {
            if (altro !== ws) {
                try { altro.send(trama, { binary: true }); } catch { /* si riconnette */ }
            }
        }
    }
    if (t.pacchetti.length >= MAX_PACCHETTI) chiudiTrasmissione(t, 'completo').catch(e => logger.error('[Voce] Chiusura per lunghezza non riuscita:', e));
}

async function fineTrasmissione(ws, { uuid, pacchetti }) {
    const t = trasmissioni.get(uuid);
    if (!t || t.ws !== ws) {
        const gia = await pool.query('SELECT id FROM voce_messaggi WHERE uuid = $1 AND stato <> $2', [uuid, 'in_diretta']);
        return inviaJson(ws, gia.rows[0] ? { t: 'salvato', uuid, id: gia.rows[0].id } : { t: 'negato', uuid, motivo: 'richiesta', messaggio: 'Messaggio sconosciuto.' });
    }
    if (t.eco) return rimandaEco(t);
    if (Number.isInteger(pacchetti) && pacchetti > t.pacchetti.length) {
        lasciaLaDiretta(t);
        return inviaJson(ws, { t: 'manca', uuid, ricevuti: t.pacchetti.length });
    }
    await chiudiTrasmissione(t, 'completo');
}

async function annullaTrasmissione(ws, { uuid }) {
    const t = trasmissioni.get(uuid);
    if (!t || t.ws !== ws) return;
    t.chiusa = true;
    trasmissioni.delete(uuid);
    if (ws.voce.trasmissione === t) ws.voce.trasmissione = null;
    if (t.eco) return;
    if (t.diretta && parola.rilascia(t.canale, t.uuid)) annunciaParola(t.canale);
    await pool.query("DELETE FROM voce_messaggi WHERE id = $1 AND stato = 'in_diretta'", [t.id]);
    if (t.annunciato) rispondiAChiAscolta(t.canale, { t: 'annullato', id: t.id });
    inviaJson(ws, { t: 'annullato', uuid });
}

async function scriviAudio(t) {
    const relativo = path.join(String(t.riga.emergency_id), `${t.uuid}.ogg`);
    const percorso = path.join(CARTELLA_VOCE, relativo);
    const ogg = scriviOggOpus(t.pacchetti, { seriale: t.id, etichette: { TITLE: `${t.riga.autore_nome} ${t.riga.registrato_il}` } });
    let dati = ogg;
    try {
        dati = cifra(ogg);
    } catch (e) {
        // Senza chiave resta in chiaro e lo cifra il giro orario, come gli altri caricamenti.
        if (!(e instanceof ChiaveNonDisponibile)) throw e;
    }
    await fs.promises.mkdir(path.dirname(percorso), { recursive: true });
    const temporaneo = `${percorso}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaneo, dati, { mode: 0o640 });
    await fs.promises.rename(temporaneo, percorso);
    return relativo;
}

const secondi = (ms) => `${Math.max(1, Math.round(ms / 1000))} s`;

async function scriviNeiDiari(m) {
    if (m.report_id) {
        const testo = m.da_sala
            ? `Messaggio vocale della sala${m.nome_radio ? ` a ${m.nome_radio}` : ''}, ${secondi(m.durata_ms)}`
            : `Messaggio vocale${m.autore_squadra ? ` da ${m.autore_squadra}` : ''}, ${secondi(m.durata_ms)}`;
        const { rows: [nota] } = await pool.query(
            `WITH nuova AS (
                INSERT INTO report_updates (report_id, update_text, user_id, update_timestamp, is_system, voce_id)
                VALUES ($1, $2, $3, $4, true, $5) RETURNING *
             )
             SELECT n.*, CONCAT(u.nome, ' ', u.cognome) AS updater_fullname FROM nuova n JOIN users u ON u.id = n.user_id`,
            [m.report_id, testo, m.autore_id, m.registrato_il, m.id]);
        await pool.query('UPDATE reports SET updated_at = NOW() WHERE id = $1', [m.report_id]);
        avvisaClienti('new_report_update', { reportId: m.report_id, update: nota });
    }
    if (m.tipo === 'avviso' || m.priorita === 'emergenza') {
        const testo = m.priorita === 'emergenza'
            ? `Messaggio vocale di EMERGENZA da ${m.autore_nome}${m.autore_squadra ? ` (${m.autore_squadra})` : ''}, ${secondi(m.durata_ms)}`
            : `Avviso vocale a tutti di ${m.autore_nome}, ${secondi(m.durata_ms)}`;
        const { rows: [voce] } = await pool.query(
            `INSERT INTO diario_sala (emergency_id, testo, autore_id, autore_nome) VALUES ($1, $2, $3, $4)
             RETURNING id, testo, autore_nome, creata_il`, [m.emergency_id, testo, m.autore_id, m.autore_nome]);
        avvisaClienti('nota_sala', { emergency_id: m.emergency_id, voce });
    }
}

async function chiudiTrasmissione(t, stato, { parolaGiaPresa = false } = {}) {
    if (t.chiusa) return;
    t.chiusa = true;
    clearTimeout(t.timer);
    trasmissioni.delete(t.uuid);
    if (t.ws?.voce?.trasmissione === t) t.ws.voce.trasmissione = null;
    if (!parolaGiaPresa && parola.rilascia(t.canale, t.uuid)) annunciaParola(t.canale);
    const durata = durataPacchetti(t.pacchetti);
    if (durata < DURATA_MINIMA_MS) {
        await pool.query("DELETE FROM voce_messaggi WHERE id = $1 AND stato = 'in_diretta'", [t.id]);
        // Chi aveva ricevuto l'inizio lo toglie, anche se nel frattempo la diretta era stata lasciata.
        if (t.annunciato) rispondiAChiAscolta(t.canale, { t: 'annullato', id: t.id });
        inviaJson(t.ws, { t: 'annullato', uuid: t.uuid, motivo: 'breve' });
        return;
    }
    contaMessaggio(t.userId);
    const file = await scriviAudio(t);
    // Quanto è arrivato dopo il parlato: vicino a zero se la rete regge. I differiti si contano a parte.
    const ritardo = t.ripreso ? null : Math.max(0, t.ultimo - t.inizio - durata);
    const { rows: [m] } = await pool.query(
        `UPDATE voce_messaggi SET stato = $2, durata_ms = $3, file = $4, arrivato_il = NOW(), ritardo_ms = $5 WHERE id = $1 RETURNING *`,
        [t.id, stato, durata, file, ritardo]);
    inviaJson(t.ws, { t: 'salvato', uuid: t.uuid, id: m.id, stato });
    if (t.diretta) rispondiAChiAscolta(t.canale, { t: 'fine', id: m.id, durata_ms: durata, stato }, t.ws);
    else rispondiAChiAscolta(t.canale, { t: 'messaggio', messaggio: metaMessaggio(m) }, t.ws);
    scriviNeiDiari(m).catch(e => logger.error(`[Voce] Messaggio ${m.id} non scritto nel diario:`, e));
    accodaTrascrizione(m.id).catch(e => logger.error(`[Voce] Messaggio ${m.id} non messo in coda per la trascrizione:`, e));
}

function lasciaLaDiretta(t) {
    if (!t.diretta) return;
    t.diretta = false;
    t.ripreso = true;
    if (parola.rilascia(t.canale, t.uuid)) annunciaParola(t.canale);
    rispondiAChiAscolta(t.canale, { t: 'fine', id: t.id, stato: 'in_ritardo' });
}

// Chi perde la rete a metà frase lascia libero il canale; il messaggio resta aperto e si
// completa quando il telefono torna, oppure si salva com'è.
function sospendiTrasmissione(t) {
    if (t.chiusa) return;
    if (t.eco) {
        trasmissioni.delete(t.uuid);
        return;
    }
    lasciaLaDiretta(t);
    if (t.ws?.voce?.trasmissione === t) t.ws.voce.trasmissione = null;
    t.ws = null;
    t.timer = setTimeout(() => chiudiTrasmissione(t, 'interrotto').catch(e => logger.error('[Voce] Salvataggio di un messaggio rimasto a metà non riuscito:', e)), ATTESA_RIPRESA_MS);
    t.timer.unref?.();
}

function provaVoce(ws, uuid) {
    const t = { uuid, eco: true, pacchetti: [], ws, chiusa: false };
    trasmissioni.set(uuid, t);
    ws.voce.trasmissione = t;
    inviaJson(ws, { t: 'parla_ok', uuid, id: 0, ricevuti: 0 });
}

function rimandaEco(t) {
    t.chiusa = true;
    trasmissioni.delete(t.uuid);
    if (t.ws.voce.trasmissione === t) t.ws.voce.trasmissione = null;
    const ws = t.ws;
    setTimeout(() => {
        inviaJson(ws, { t: 'eco', uuid: t.uuid, durata_ms: durataPacchetti(t.pacchetti) });
        t.pacchetti.forEach((p, seq) => {
            const trama = Buffer.alloc(6 + p.length);
            trama.writeUInt32BE(0, 0);
            trama.writeUInt16BE(seq, 4);
            p.copy(trama, 6);
            if (ws.readyState === 1) ws.send(trama, { binary: true });
        });
        inviaJson(ws, { t: 'eco_fine', uuid: t.uuid });
    }, ECO_RITARDO_MS).unref?.();
}

async function segnaAscolto(userId, messaggioId, inDiretta, daSala) {
    const { rows: [m] } = await pool.query(
        `SELECT m.id, m.uuid, m.autore_id, m.canale,
                EXISTS (SELECT 1 FROM voce_ascolti a WHERE a.messaggio_id = m.id AND a.da_sala) AS gia_in_sala
           FROM voce_messaggi m WHERE m.id = $1`, [messaggioId]);
    if (!m) return null;
    const r = await pool.query(
        `INSERT INTO voce_ascolti (messaggio_id, user_id, in_diretta, da_sala) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`, [messaggioId, userId, inDiretta === true, daSala]);
    if (r.rowCount && daSala && !m.gia_in_sala) {
        for (const ws of collegati()) {
            if (ws.voce.profilo.id === m.autore_id) inviaJson(ws, { t: 'riprodotto', id: m.id, uuid: m.uuid });
            else if (diSala(ws) && ws.voce.canali.has(m.canale)) inviaJson(ws, { t: 'riprodotto', id: m.id });
        }
    }
    return m;
}

async function segnaRicevuto(profilo, messaggioId) {
    const { rows: [m] } = await pool.query(
        `UPDATE voce_messaggi SET ricevuto_da_id = $2, ricevuto_da_nome = $3, ricevuto_il = NOW()
          WHERE id = $1 AND ricevuto_il IS NULL AND autore_id IS DISTINCT FROM $2 RETURNING id, uuid, autore_id, canale`,
        [messaggioId, profilo.id, profilo.nome]);
    if (!m) return false;
    for (const ws of collegati()) {
        if (ws.voce.profilo.id === m.autore_id) inviaJson(ws, { t: 'ricevuto', id: m.id, uuid: m.uuid, da: profilo.nome });
        else if (ws.voce.canali.has(m.canale) && diSala(ws)) inviaJson(ws, { t: 'ricevuto', id: m.id, da: profilo.nome });
    }
    return true;
}

async function comando(ws, testo) {
    let c;
    try {
        c = JSON.parse(testo);
    } catch {
        return;
    }
    if (!ws.voce.profilo) return;
    switch (c?.t) {
        case 'parla': return chiedeLaParola(ws, c);
        case 'fine': return fineTrasmissione(ws, c);
        case 'annulla': return annullaTrasmissione(ws, c);
        case 'ascoltato': {
            const id = Number(c.id);
            if (!Number.isInteger(id) || id <= 0) return;
            const m = (await pool.query('SELECT canale FROM voce_messaggi WHERE id = $1', [id])).rows[0];
            if (m && ws.voce.canali.has(m.canale)) await segnaAscolto(ws.voce.profilo.id, id, c.in_diretta, diSala(ws));
            return;
        }
        case 'ricevuto': {
            const id = Number(c.id);
            if (!Number.isInteger(id) || id <= 0 || !diSala(ws)) return;
            const m = (await pool.query('SELECT canale FROM voce_messaggi WHERE id = $1', [id])).rows[0];
            if (m && ws.voce.canali.has(m.canale)) await segnaRicevuto(ws.voce.profilo, id);
            return;
        }
        case 'ciao': return mandaPersi(ws, Number(c.ultimo) || 0);
        case 'cuffie': {
            if (!Array.isArray(c.canali)) return;
            ws.voce.cuffie = new Set(c.canali.map(String).filter(id => ws.voce.canali.has(id)));
            presenzeCambiate();
            return;
        }
    }
}

async function mandaPersi(ws, ultimo) {
    const emergenza = activeEmergency;
    const canali = [...ws.voce.canali.keys()];
    if (!emergenza || !canali.length) return inviaJson(ws, { t: 'persi', messaggi: [] });
    const dal = ws.voce.profilo.ruoli.includes('esterno') ? ws.voce.profilo.squadra?.entrato_il ?? null : null;
    const { rows } = await pool.query(
        `${SELECT_MESSAGGIO}
          WHERE m.emergency_id = $1 AND m.canale = ANY($2::text[]) AND m.id > $3 AND m.stato <> 'in_diretta'
            AND ($4::timestamp IS NULL OR m.registrato_il >= $4::timestamp)
          ORDER BY m.id DESC LIMIT 100`, [emergenza.id, canali, ultimo, dal]);
    inviaJson(ws, { t: 'persi', messaggi: rows.reverse().map(m => metaMessaggio(m)) });
}

function statoPer(ws) {
    const canali = [...ws.voce.canali.values()];
    return {
        t: 'stato',
        emergenza: activeEmergency ? { id: activeEmergency.id, codice: activeEmergency.code, simulazione: activeEmergency.simulazione === true } : null,
        utente: { id: ws.voce.profilo.id, nome: ws.voce.profilo.nome, ...ruoloVoce(ws.voce.profilo) },
        canali,
        parola: Object.fromEntries(canali.map(c => [c.id, parola.di(c.id)]).filter(([, chi]) => chi)
            .map(([id, chi]) => [id, { nome: chi.nome, squadra: chi.squadra, sala: chi.sala, priorita: chi.priorita }]))
    };
}

// Un telefono che si ricollega parla subito, prima che il profilo sia letto: i messaggi
// aspettano in fila, nell'ordine in cui arrivano, pacchetti compresi.
function inFila(ws, lavoro) {
    ws.voce.fila = ws.voce.fila.then(lavoro).catch(e => {
        logger.error(`[Voce] Comando non riuscito per ${ws.voce.profilo?.username || ws.voce.userId}:`, e);
        inviaJson(ws, { t: 'errore', messaggio: 'Il server non è riuscito a completare la richiesta.' });
    });
}

async function collegato(ws) {
    ws.vivo = true;
    let pronto;
    ws.voce.fila = new Promise(r => { pronto = r; });
    ws.on('pong', () => { ws.vivo = true; });
    ws.on('message', (dati, binario) => {
        inFila(ws, () => binario ? riceviPacchetto(ws, dati) : comando(ws, dati.toString('utf8')));
    });
    ws.on('close', () => {
        const t = ws.voce.trasmissione;
        if (t && !t.chiusa) sospendiTrasmissione(t);
        presenzeCambiate();
    });
    ws.on('error', (e) => logger.warn(`[Voce] Errore sul collegamento di ${ws.voce.userId}: ${e.message}`));

    if (ws.voce.app) {
        for (const altro of collegati()) {
            if (altro !== ws && altro.voce.app && altro.voce.userId === ws.voce.userId) {
                inviaJson(altro, { t: 'chiuso', motivo: 'altro_telefono', messaggio: 'La voce è passata a un altro telefono.' });
                altro.close(CHIUSURA.altroTelefono, 'altro telefono');
            }
        }
    }
    const profilo = (await leggiProfili(pool, [ws.voce.userId])).get(ws.voce.userId);
    if (!profilo?.attivo) return ws.close(CHIUSURA.sessione, 'account');
    ws.voce.profilo = profilo;
    ws.voce.canali = new Map(canaliDi(profilo, contesto).map(c => [c.id, c]));
    ws.voce.firmaCanali = JSON.stringify([...ws.voce.canali.values()]);
    inviaJson(ws, statoPer(ws));
    // Agli altri si mandano solo i cambiamenti: chi arriva adesso ha bisogno del quadro intero.
    if (diSala(ws)) inviaJson(ws, { t: 'presenze', canali: calcolaPresenze() });
    pronto();
    presenzeCambiate();
}

async function gestisciUpgrade(request, socket, head) {
    const rifiuta = (riga) => {
        socket.write(`HTTP/1.1 ${riga}\r\n\r\n`);
        socket.destroy();
    };
    try {
        if (!(await moduloVoceAcceso())) return rifiuta('404 Not Found');
        const emergenza = activeEmergency;
        if (!emergenza) return rifiuta('409 Conflict');
        const tokenVoce = tokenVoceDa(request.headers.authorization);
        let voce;
        if (tokenVoce) {
            const t = await leggiTokenVoce(tokenVoce, emergenza.id);
            if (!t) return rifiuta('401 Unauthorized');
            voce = { userId: t.user_id, app: true, creato: Number(t.creato), emergencyId: emergenza.id };
        } else {
            const utente = (await utenteDiSessione(request))?.utente;
            if (!utente) return rifiuta('401 Unauthorized');
            voce = { userId: utente.id, app: request.headers['x-orion-client'] === 'app', sessione: utente, emergencyId: emergenza.id };
        }
        wssVoce.handleUpgrade(request, socket, head, (ws) => {
            ws.voce = { ...voce, canali: new Map(), trasmissione: null };
            collegato(ws).catch(e => {
                logger.error('[Voce] Apertura del collegamento non riuscita:', e);
                ws.close(1011, 'errore');
            });
        });
    } catch (e) {
        logger.error('[Voce] Verifica del collegamento non riuscita:', e);
        rifiuta('503 Service Unavailable');
    }
}

let firmaPresenze = '';
let presenzeInAttesa = null;
function presenzeCambiate() {
    if (presenzeInAttesa) return;
    presenzeInAttesa = setTimeout(() => {
        presenzeInAttesa = null;
        mandaPresenze();
    }, 500);
}

// La sala vede quanti telefoni di ogni squadra hanno la voce accesa: parlare a una squadra
// che non ascolta è come parlare al vuoto.
function calcolaPresenze() {
    const telefoni = new Map();
    for (const ws of collegati()) {
        if (!ws.voce.app) continue;
        for (const id of ws.voce.canali.keys()) {
            if (!telefoni.has(id)) telefoni.set(id, new Set());
            telefoni.get(id).add(ws.voce.profilo.id);
        }
    }
    // Le postazioni di sala con la cuffia accesa su ogni canale: con nessuna, la sala non sente.
    const postazioni = new Map();
    for (const ws of collegati()) {
        if (ws.voce.app || !diSala(ws) || !ws.voce.cuffie) continue;
        for (const id of ws.voce.cuffie) postazioni.set(id, (postazioni.get(id) || 0) + 1);
    }
    const presenze = {};
    const metti = (id, membri) => {
        presenze[id] = { in_ascolto: telefoni.get(id)?.size || 0, membri, postazioni: postazioni.get(id) || 0 };
    };
    for (const s of contesto.squadre) metti(`squadra:${s.id}`, s.membri);
    for (const d of contesto.diretti) metti(canaleDiretto(d.user_id), 1);
    metti('generale', null);
    metti(AVVISI, null);
    return presenze;
}

function mandaPresenze() {
    const presenze = calcolaPresenze();
    const firma = JSON.stringify(presenze);
    if (firma === firmaPresenze) return;
    firmaPresenze = firma;
    for (const ws of collegati()) if (diSala(ws)) inviaJson(ws, { t: 'presenze', canali: presenze });
}

function chiudiTutti(codice, motivo, messaggio) {
    for (const ws of [...wssVoce.clients]) {
        inviaJson(ws, { t: 'chiuso', motivo, messaggio });
        ws.close(codice, motivo);
    }
}

// Squadre, caposquadra, emergenza e account cambiano da molti punti del codice: invece di
// inseguirli tutti si ricontrolla qui, con una lettura sola per tutti i collegati.
async function controllaCollegati() {
    const acceso = await moduloVoceAcceso();
    const emergenza = activeEmergency;
    if (!acceso) return chiudiTutti(CHIUSURA.spenta, 'voce_spenta', 'La voce è stata spenta dall\'amministratore.');
    for (const ws of collegati()) {
        if (!emergenza || ws.voce.emergencyId !== emergenza.id) {
            inviaJson(ws, { t: 'chiuso', motivo: 'emergenza_chiusa', messaggio: 'L\'emergenza è chiusa: la voce si spegne.' });
            ws.close(CHIUSURA.emergenzaChiusa, 'emergenza chiusa');
        }
    }
    if (!emergenza) {
        contesto = { squadre: [], diretti: [] };
        return;
    }
    const [squadre, diretti] = await Promise.all([leggiSquadre(pool), leggiDiretti(pool, emergenza.id)]);
    contesto = { squadre, diretti };
    const persone = collegati();
    const profili = await leggiProfili(pool, [...new Set(persone.map(ws => ws.voce.userId))]);
    for (const ws of persone) {
        const profilo = profili.get(ws.voce.userId);
        const superato = ws.voce.sessione ? tokenSuperato(ws.voce.sessione, profilo?.valide_dal) : (profilo?.valide_dal != null && ws.voce.creato < profilo.valide_dal);
        if (!profilo?.attivo || superato) {
            inviaJson(ws, { t: 'chiuso', motivo: 'sessione', messaggio: 'La sessione non è più valida.' });
            ws.close(CHIUSURA.sessione, 'sessione');
            continue;
        }
        ws.voce.profilo = profilo;
        const canali = canaliDi(profilo, contesto);
        const firma = JSON.stringify(canali);
        if (firma === ws.voce.firmaCanali) continue;
        ws.voce.canali = new Map(canali.map(c => [c.id, c]));
        ws.voce.firmaCanali = firma;
        const t = ws.voce.trasmissione;
        // Tolta dalla squadra mentre parla: il messaggio si chiude e resta salvato.
        if (t && !t.chiusa && !t.eco && !ws.voce.canali.get(t.canale)?.parla) {
            inviaJson(ws, { t: 'interrotto', uuid: t.uuid, motivo: 'canale' });
            await chiudiTrasmissione(t, 'interrotto');
        }
        inviaJson(ws, { t: 'canali', canali });
    }
    for (const t of trasmissioni.values()) {
        if (t.ws && t.diretta && Date.now() - t.ultimo > SILENZIO_DIRETTA_MS) lasciaLaDiretta(t);
        else if (t.ws && !t.diretta && !t.eco && Date.now() - t.ultimo > SILENZIO_MASSIMO_MS) sospendiTrasmissione(t);
    }
    for (const scaduta of parola.scadute()) {
        const t = trasmissioni.get(scaduta.uuid);
        if (t) await chiudiTrasmissione(t, 'completo');
        else parola.rilascia(scaduta.canale, scaduta.uuid);
    }
    mandaPresenze();
}

export function avviaVoce() {
    aggiungiPercorsoUpgrade('/voce', gestisciUpgrade);
    avviaTrascrizione({ annuncia: ({ id, canale, testo }) => rispondiAChiAscolta(canale, { t: 'trascritto', id, testo }) });
    setInterval(() => {
        for (const ws of wssVoce.clients) {
            if (!ws.vivo) {
                ws.terminate();
                continue;
            }
            ws.vivo = false;
            try { ws.ping(); } catch { /* chiusa nel frattempo */ }
        }
    }, PING_MS).unref();
    let inCorso = false;
    let rimastiAMeta = true;
    const avvio = new Date().toISOString();
    setInterval(async () => {
        if (inCorso) return;
        inCorso = true;
        try {
            // Dopo le migrazioni, che all'avvio arrivano dopo: l'audio di questi era nella memoria del server di prima.
            if (rimastiAMeta) {
                await pool.query("DELETE FROM voce_messaggi WHERE stato = 'in_diretta' AND arrivato_il < $1", [avvio]);
                rimastiAMeta = false;
            }
            await controllaCollegati();
        } catch (e) {
            logger.error('[Voce] Controllo dei collegamenti non riuscito:', e);
        } finally {
            inCorso = false;
        }
    }, CONTROLLO_MS).unref();
}

async function profiloDi(req) {
    return (await leggiProfili(pool, [req.user.id])).get(req.user.id) || null;
}

async function canaliDellaRichiesta(req) {
    const profilo = await profiloDi(req);
    if (!profilo || !activeEmergency) return { profilo, canali: new Map() };
    if (!contesto.squadre.length) contesto = { squadre: await leggiSquadre(pool), diretti: await leggiDiretti(pool, activeEmergency.id) };
    return { profilo, canali: new Map(canaliDi(profilo, contesto).map(c => [c.id, c])) };
}

export function registraRotteVoce(app) {
    async function soloSeAcceso(req, res, next) {
        try {
            if (await moduloVoceAcceso()) return next();
            res.status(404).json({ message: 'La voce non è attiva.', modulo_spento: true });
        } catch (e) {
            logger.error('Errore lettura voce_enabled:', e);
            res.status(500).json({ message: 'Errore interno.' });
        }
    }

    // Il centro operativo la chiede sempre: a modulo spento un 404 riempirebbe la console di errori.
    async function statoSeSpento(req, res, next) {
        try {
            if (await moduloVoceAcceso()) return next();
            res.json({ attiva: false, modulo_spento: true });
        } catch (e) {
            logger.error('Errore lettura voce_enabled:', e);
            res.status(500).json({ message: 'Errore interno.' });
        }
    }

    app.get('/api/voce/stato', statoSeSpento, async (req, res) => {
        try {
            const { profilo, canali } = await canaliDellaRichiesta(req);
            res.json({
                attiva: !!activeEmergency && canali.size > 0,
                emergenza: activeEmergency ? { id: activeEmergency.id, codice: activeEmergency.code, simulazione: activeEmergency.simulazione === true } : null,
                ruolo: profilo ? ruoloVoce(profilo) : null,
                canali: [...canali.values()],
                apre_diretti: profilo ? apreDiretti(profilo) : false
            });
        } catch (e) {
            logger.error('Errore GET /api/voce/stato:', e);
            res.status(500).json({ message: 'Errore nel leggere lo stato della voce.' });
        }
    });

    app.post('/api/voce/token', soloSeAcceso, async (req, res) => {
        const emergenza = activeEmergency;
        if (!emergenza) return res.status(409).json({ message: 'La voce c\'è solo a emergenza aperta.' });
        const dispositivo = typeof req.body?.dispositivo === 'string' ? req.body.dispositivo.slice(0, 100) : null;
        const token = crypto.randomBytes(32).toString('base64url');
        try {
            const { canali } = await canaliDellaRichiesta(req);
            if (!canali.size) return res.status(403).json({ message: 'Non sei in una squadra: la voce non ha canali per te.' });
            await pool.query(
                'INSERT INTO token_voce (user_id, emergency_id, impronta, dispositivo) VALUES ($1, $2, $3, $4)',
                [req.user.id, emergenza.id, impronta(token), dispositivo]);
            await pool.query(
                `DELETE FROM token_voce WHERE user_id = $1 AND id NOT IN
                   (SELECT id FROM token_voce WHERE user_id = $1 AND emergency_id = $2 ORDER BY creato_il DESC LIMIT $3)`,
                [req.user.id, emergenza.id, MAX_TOKEN_PER_PERSONA]);
            res.status(201).json({ voce: token, emergenza_id: emergenza.id });
        } catch (e) {
            logger.error('Errore POST /api/voce/token:', e);
            res.status(500).json({ message: 'Errore nel preparare la voce per questo telefono.' });
        }
    });

    app.get('/api/voce/messaggi', soloSeAcceso, async (req, res) => {
        const emergenza = activeEmergency;
        if (!emergenza) return res.json({ messaggi: [] });
        const prima = req.query.prima === undefined ? null : Number.parseInt(req.query.prima, 10);
        const limite = Math.min(Math.max(Number.parseInt(req.query.limite, 10) || 50, 1), 200);
        try {
            const { profilo, canali } = await canaliDellaRichiesta(req);
            const richiesti = req.query.canale ? [String(req.query.canale)].filter(c => canali.has(c)) : [...canali.keys()];
            if (!richiesti.length) return res.json({ messaggi: [] });
            const dal = profilo.ruoli.includes('esterno') ? profilo.squadra?.entrato_il ?? null : null;
            const { rows } = await pool.query(
                `${SELECT_MESSAGGIO}
                  WHERE m.emergency_id = $1 AND m.canale = ANY($2::text[]) AND m.stato <> 'in_diretta'
                    AND ($3::int IS NULL OR m.id < $3) AND ($5::timestamp IS NULL OR m.registrato_il >= $5::timestamp)
                    AND ${FILTRO_TESTO('$6')}
                  ORDER BY m.id DESC LIMIT $4`, [emergenza.id, richiesti, Number.isInteger(prima) ? prima : null, limite, dal, testoCercato(req)]);
            res.json({ messaggi: rows.reverse().map(m => metaMessaggio(m)) });
        } catch (e) {
            logger.error('Errore GET /api/voce/messaggi:', e);
            res.status(500).json({ message: 'Errore nel leggere la cronologia.' });
        }
    });

    app.get('/api/voce/messaggi/:id/audio', async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Messaggio non valido.' });
        try {
            const m = (await pool.query('SELECT id, emergency_id, canale, file, registrato_il FROM voce_messaggi WHERE id = $1', [id])).rows[0];
            if (!m?.file) return res.status(404).json({ message: 'Messaggio non trovato.' });
            const inCorso = activeEmergency && m.emergency_id === activeEmergency.id;
            let consentito = false;
            if (inCorso) {
                const { profilo, canali } = await canaliDellaRichiesta(req);
                const dal = profilo?.ruoli.includes('esterno') ? profilo.squadra?.entrato_il : null;
                consentito = canali.has(m.canale) && (!dal || new Date(m.registrato_il) >= new Date(dal));
            }
            if (!consentito && haPermesso(req, 'emergenze.archivio')) {
                consentito = true;
                registraAudit(req, 'voce.ascolto_archivio', { tipo: 'voce', id: m.id, dettagli: { emergenza: m.emergency_id, canale: m.canale } });
            }
            if (!consentito) return res.status(403).json({ message: 'Questo messaggio non è per te.' });
            const percorso = path.join(CARTELLA_VOCE, m.file);
            if (!percorso.startsWith(CARTELLA_VOCE + path.sep)) return res.status(404).json({ message: 'Messaggio non trovato.' });
            await inviaFile(res, percorso, { headers: { 'Cache-Control': 'private, max-age=3600' } });
        } catch (e) {
            logger.error(`Errore GET /api/voce/messaggi/${id}/audio:`, e);
            if (!res.headersSent) res.status(500).json({ message: 'Errore nel leggere il messaggio.' });
        }
    });

    app.post('/api/voce/messaggi/:id/ascolto', soloSeAcceso, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Messaggio non valido.' });
        try {
            const { profilo, canali } = await canaliDellaRichiesta(req);
            const m = (await pool.query('SELECT canale FROM voce_messaggi WHERE id = $1', [id])).rows[0];
            if (!m || !canali.has(m.canale)) return res.status(404).json({ message: 'Messaggio non trovato.' });
            const r = ruoloVoce(profilo);
            await segnaAscolto(profilo.id, id, req.body?.in_diretta === true, r.sala || r.coordinatore);
            res.json({ ok: true });
        } catch (e) {
            logger.error(`Errore POST /api/voce/messaggi/${id}/ascolto:`, e);
            res.status(500).json({ message: 'Ascolto non registrato.' });
        }
    });

    app.post('/api/voce/messaggi/:id/ricevuto', soloSeAcceso, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Messaggio non valido.' });
        try {
            const { profilo, canali } = await canaliDellaRichiesta(req);
            const r = profilo ? ruoloVoce(profilo) : {};
            if (!r.sala && !r.coordinatore) return res.status(403).json({ message: 'La conferma di ricezione la dà la sala.' });
            const m = (await pool.query('SELECT canale FROM voce_messaggi WHERE id = $1', [id])).rows[0];
            if (!m || !canali.has(m.canale)) return res.status(404).json({ message: 'Messaggio non trovato.' });
            res.json({ ok: await segnaRicevuto(profilo, id) });
        } catch (e) {
            logger.error(`Errore POST /api/voce/messaggi/${id}/ricevuto:`, e);
            res.status(500).json({ message: 'Conferma non registrata.' });
        }
    });

    app.post('/api/voce/diretti', soloSeAcceso, async (req, res) => {
        const emergenza = activeEmergency;
        let userId = Number.parseInt(req.body?.user_id, 10);
        if (!emergenza) return res.status(409).json({ message: 'La voce c\'è solo a emergenza aperta.' });
        if (!Number.isInteger(userId) && typeof req.body?.username === 'string') {
            userId = (await pool.query('SELECT id FROM users WHERE username = $1', [req.body.username])).rows[0]?.id;
        }
        if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ message: 'Indica la persona.' });
        try {
            const profili = await leggiProfili(pool, [req.user.id, userId]);
            const io = profili.get(req.user.id);
            const persona = profili.get(userId);
            if (!io || !apreDiretti(io)) return res.status(403).json({ message: 'I canali diretti li apre la sala.' });
            if (!persona?.attivo || !persona.squadra || persona.squadra.coc) return res.status(404).json({ message: 'La persona non è in una squadra.' });
            await pool.query(
                `INSERT INTO voce_diretti (emergency_id, user_id, aperto_da) VALUES ($1, $2, $3)
                 ON CONFLICT (emergency_id, user_id) WHERE chiuso_il IS NULL DO NOTHING`, [emergenza.id, userId, req.user.id]);
            registraAudit(req, 'voce.diretto_aperto', { tipo: 'utente', id: userId, dettagli: { emergenza: emergenza.id } });
            res.status(201).json({ canale: canaleDiretto(userId) });
        } catch (e) {
            logger.error('Errore POST /api/voce/diretti:', e);
            res.status(500).json({ message: 'Canale diretto non aperto.' });
        }
    });

    app.delete('/api/voce/diretti/:userId', soloSeAcceso, async (req, res) => {
        const emergenza = activeEmergency;
        const userId = Number.parseInt(req.params.userId, 10);
        if (!emergenza || !Number.isInteger(userId)) return res.status(404).json({ message: 'Canale diretto non trovato.' });
        try {
            const io = (await leggiProfili(pool, [req.user.id])).get(req.user.id);
            if (!io || !apreDiretti(io)) return res.status(403).json({ message: 'I canali diretti li chiude la sala.' });
            await pool.query('UPDATE voce_diretti SET chiuso_il = NOW() WHERE emergency_id = $1 AND user_id = $2 AND chiuso_il IS NULL', [emergenza.id, userId]);
            res.json({ ok: true });
        } catch (e) {
            logger.error('Errore DELETE /api/voce/diretti:', e);
            res.status(500).json({ message: 'Canale diretto non chiuso.' });
        }
    });

    async function diSalaLaRichiesta(req) {
        const profilo = await profiloDi(req);
        const r = profilo ? ruoloVoce(profilo) : {};
        return (r.sala || r.coordinatore) && activeEmergency ? profilo : null;
    }

    // Il telefono di chi chiede aiuto si mostra con la stessa regola dei membri delle squadre.
    async function telefonoVisibile() {
        const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'segreteria_config'");
        return leggiConfigSegreteria(r.rows[0]?.setting_value).enabled === true;
    }

    app.get('/api/voce/emergenze', soloSeAcceso, async (req, res) => {
        try {
            if (!(await diSalaLaRichiesta(req))) return res.json({ emergenze: [] });
            const conTelefono = await telefonoVisibile();
            const { rows } = await pool.query(
                `SELECT m.*, EXISTS (SELECT 1 FROM voce_ascolti a WHERE a.messaggio_id = m.id AND a.da_sala) AS riprodotto_in_sala,
                        CASE WHEN $2 THEN NULLIF(TRIM(u.telefono), '') END AS telefono,
                        p.latitude AS squadra_lat, p.longitude AS squadra_lon
                   FROM voce_messaggi m LEFT JOIN users u ON u.id = m.autore_id
                   LEFT JOIN posizioni_squadre p ON p.squadra_id = m.squadra_id
                  WHERE m.emergency_id = $1 AND m.priorita = 'emergenza' AND m.presa_il IS NULL
                  ORDER BY m.id`, [activeEmergency.id, conTelefono]);
            res.json({ emergenze: rows.map(m => metaMessaggio(m, {
                telefono: m.telefono || null,
                posizione: m.latitudine != null ? { lat: m.latitudine, lon: m.longitudine }
                    : m.squadra_lat != null ? { lat: Number(m.squadra_lat), lon: Number(m.squadra_lon), della_squadra: true } : null
            })) });
        } catch (e) {
            logger.error('Errore GET /api/voce/emergenze:', e);
            res.status(500).json({ message: 'Errore nel leggere le emergenze vocali.' });
        }
    });

    app.post('/api/voce/messaggi/:id/presa-in-carico', soloSeAcceso, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'Messaggio non valido.' });
        try {
            const profilo = await diSalaLaRichiesta(req);
            if (!profilo) return res.status(403).json({ message: 'L\'emergenza la prende in carico la sala.' });
            const { rows: [m] } = await pool.query(
                `UPDATE voce_messaggi SET presa_da_id = $2, presa_da_nome = $3, presa_il = NOW()
                  WHERE id = $1 AND priorita = 'emergenza' AND presa_il IS NULL RETURNING *`, [id, profilo.id, profilo.nome]);
            if (!m) {
                const gia = (await pool.query('SELECT presa_da_nome FROM voce_messaggi WHERE id = $1', [id])).rows[0];
                return res.status(409).json({ message: gia?.presa_da_nome ? `L'ha già presa in carico ${gia.presa_da_nome}.` : 'Messaggio non trovato.' });
            }
            const testo = `${profilo.nome} prende in carico l'emergenza vocale di ${m.autore_nome}${m.autore_squadra ? ` (${m.autore_squadra})` : ''}`;
            const { rows: [voce] } = await pool.query(
                `INSERT INTO diario_sala (emergency_id, testo, autore_id, autore_nome) VALUES ($1, $2, $3, $4)
                 RETURNING id, testo, autore_nome, creata_il`, [m.emergency_id, testo, profilo.id, profilo.nome]);
            avvisaClienti('nota_sala', { emergency_id: m.emergency_id, voce });
            registraAudit(req, 'voce.emergenza_presa', { tipo: 'voce', id: m.id, dettagli: { autore: m.autore_nome } });
            for (const ws of collegati()) {
                if (diSala(ws) || ws.voce.profilo.id === m.autore_id) inviaJson(ws, { t: 'presa_in_carico', id: m.id, uuid: ws.voce.profilo.id === m.autore_id ? m.uuid : undefined, da: profilo.nome });
            }
            res.json({ ok: true, da: profilo.nome });
        } catch (e) {
            logger.error(`Errore POST /api/voce/messaggi/${id}/presa-in-carico:`, e);
            res.status(500).json({ message: 'Presa in carico non registrata.' });
        }
    });

    // Lo spostamento resta tracciato: le note del diario non si cambiano, se ne scrive una in tutte e due.
    app.post('/api/voce/messaggi/:id/segnalazione', soloSeAcceso, async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);
        const reportId = Number.parseInt(req.body?.report_id, 10);
        if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(reportId) || reportId <= 0) return res.status(400).json({ message: 'Indica messaggio e segnalazione.' });
        const client = await pool.connect();
        try {
            const profilo = await diSalaLaRichiesta(req);
            if (!profilo) return res.status(403).json({ message: 'I messaggi li sposta la sala.' });
            await client.query('BEGIN');
            const m = (await client.query('SELECT * FROM voce_messaggi WHERE id = $1 AND emergency_id = $2 FOR UPDATE', [id, activeEmergency.id])).rows[0];
            const nuova = (await client.query('SELECT id, emergency_report_number FROM reports WHERE id = $1 AND emergency_id = $2', [reportId, activeEmergency.id])).rows[0];
            if (!m?.file || !nuova) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Messaggio o segnalazione non trovati in questa emergenza.' });
            }
            if (m.report_id === reportId) {
                await client.query('ROLLBACK');
                return res.json({ ok: true });
            }
            const vecchia = m.report_id ? (await client.query('SELECT id, emergency_report_number FROM reports WHERE id = $1', [m.report_id])).rows[0] : null;
            const ora = new Date(m.registrato_il).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Rome' });
            const numero = (r) => `#${r.emergency_report_number ?? r.id}`;
            await client.query('UPDATE voce_messaggi SET report_id = $2 WHERE id = $1', [id, reportId]);
            const note = [];
            const scrivi = async (rid, testo, voceId) => {
                const { rows: [n] } = await client.query(
                    `WITH nuova AS (
                        INSERT INTO report_updates (report_id, update_text, user_id, is_system, voce_id) VALUES ($1, $2, $3, true, $4) RETURNING *
                     )
                     SELECT n.*, CONCAT(u.nome, ' ', u.cognome) AS updater_fullname FROM nuova n JOIN users u ON u.id = n.user_id`,
                    [rid, testo, profilo.id, voceId]);
                await client.query('UPDATE reports SET updated_at = NOW() WHERE id = $1', [rid]);
                note.push([rid, n]);
            };
            await scrivi(reportId, `Messaggio vocale di ${m.autore_nome} delle ${ora}, ${secondi(m.durata_ms)}${vecchia ? `, spostato qui da ${numero(vecchia)}` : ''}`, id);
            if (vecchia) await scrivi(vecchia.id, `Messaggio vocale di ${m.autore_nome} delle ${ora} spostato su ${numero(nuova)}`, null);
            await client.query('COMMIT');
            for (const [rid, n] of note) avvisaClienti('new_report_update', { reportId: rid, update: n });
            registraAudit(req, 'voce.spostato', { tipo: 'voce', id, dettagli: { da: vecchia?.id ?? null, a: reportId } });
            res.json({ ok: true });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error(`Errore POST /api/voce/messaggi/${id}/segnalazione:`, e);
            res.status(500).json({ message: 'Messaggio non spostato.' });
        } finally {
            client.release();
        }
    });

    app.get('/api/voce/archivio/:emergenza', async (req, res) => {
        const emergencyId = Number.parseInt(req.params.emergenza, 10);
        if (!Number.isInteger(emergencyId)) return res.status(400).json({ message: 'Emergenza non valida.' });
        if (!haPermesso(req, 'emergenze.archivio')) return res.status(403).json({ message: 'Ti serve il permesso di consultare le emergenze passate.' });
        try {
            const { rows } = await pool.query(
                `${SELECT_MESSAGGIO} WHERE m.emergency_id = $1 AND m.stato <> 'in_diretta' AND ${FILTRO_TESTO('$2')} ORDER BY m.registrato_il, m.id`,
                [emergencyId, testoCercato(req)]);
            res.json({ messaggi: rows.map(m => metaMessaggio(m)) });
        } catch (e) {
            logger.error('Errore GET /api/voce/archivio:', e);
            res.status(500).json({ message: 'Errore nel leggere i messaggi vocali.' });
        }
    });

    app.get('/api/voce/trascrizione', async (req, res) => {
        if (!haRuolo(req, 'admin')) return res.status(403).json({ message: 'Solo per gli amministratori.' });
        try {
            res.json({ modello: await modelloScelto(), ...statoTrascrizione() });
        } catch (e) {
            logger.error('Errore GET /api/voce/trascrizione:', e);
            res.status(500).json({ message: 'Errore nel leggere lo stato della trascrizione.' });
        }
    });

    // Sceglie il modello (o nessuno) e, se manca, lo scarica: la trascrizione parte quando il file c'è.
    app.post('/api/voce/trascrizione', async (req, res) => {
        if (!haRuolo(req, 'admin')) return res.status(403).json({ message: 'Solo per gli amministratori.' });
        const modello = req.body?.modello ?? null;
        if (modello !== null && !MODELLI[modello]) return res.status(400).json({ message: 'Modello sconosciuto.' });
        if (modello && !programmaDisponibile()) return res.status(409).json({ message: 'In questa installazione manca il programma di trascrizione.' });
        const libera = memoriaPerTrascrivereMb();
        if (modello && MODELLI[modello].memoria_mb > libera) {
            return res.status(409).json({
                message: `Il modello ${MODELLI[modello].nome} chiede circa ${MODELLI[modello].memoria_mb} MB di memoria e ORION ne ha liberi ${libera}. `
                    + (comeAlzareLaMemoria() || 'Serve una macchina con più memoria.')
            });
        }
        try {
            if (modello && !modelloScaricato(modello)) await scaricaModello(modello);
            await pool.query(
                `INSERT INTO branding_settings (setting_key, setting_value) VALUES ('voce_trascrizione', $1)
                 ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`, [modello || '']);
            registraAudit(req, 'voce.trascrizione', { tipo: 'impostazione', dettagli: { modello } });
            modelloCambiato();
            res.json({ modello, ...statoTrascrizione() });
        } catch (e) {
            res.status(400).json({ message: e.message });
        }
    });

    app.delete('/api/voce/trascrizione/modelli/:id', async (req, res) => {
        if (!haRuolo(req, 'admin')) return res.status(403).json({ message: 'Solo per gli amministratori.' });
        if (!MODELLI[req.params.id]) return res.status(404).json({ message: 'Modello sconosciuto.' });
        if (await modelloScelto() === req.params.id) return res.status(409).json({ message: 'È il modello in uso: scegline un altro o spegni la trascrizione.' });
        await eliminaModello(req.params.id);
        res.json(statoTrascrizione());
    });

    // I due numeri che dicono se la voce funziona sul campo: il ritardo e quanti arrivano in differita.
    app.get('/api/voce/statistiche', async (req, res) => {
        if (!haRuolo(req, 'admin')) return res.status(403).json({ message: 'Solo per gli amministratori.' });
        try {
            const emergencyId = activeEmergency?.id
                ?? (await pool.query('SELECT emergency_id FROM voce_messaggi ORDER BY id DESC LIMIT 1')).rows[0]?.emergency_id ?? null;
            const { rows: [n] } = await pool.query(
                `SELECT COUNT(*)::int AS messaggi,
                        COUNT(*) FILTER (WHERE differito OR ritardo_ms IS NULL)::int AS in_differita,
                        COUNT(*) FILTER (WHERE stato = 'interrotto')::int AS interrotti,
                        ROUND(AVG(ritardo_ms))::int AS ritardo_medio_ms,
                        (PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ritardo_ms))::int AS ritardo_p90_ms,
                        MAX(arrivato_il) AS ultimo
                   FROM voce_messaggi WHERE emergency_id = $1 AND stato <> 'in_diretta'`, [emergencyId]);
            const conn = collegati();
            res.json({
                attiva: await moduloVoceAcceso(),
                emergenza_id: emergencyId,
                in_corso: !!activeEmergency && emergencyId === activeEmergency.id,
                ...n,
                collegati: { telefoni: conn.filter(ws => ws.voce.app).length, postazioni: conn.filter(ws => !ws.voce.app).length }
            });
        } catch (e) {
            logger.error('Errore GET /api/voce/statistiche:', e);
            res.status(500).json({ message: 'Errore nel leggere i numeri della voce.' });
        }
    });
}

export async function eliminaAudioEmergenza(emergencyId) {
    await fs.promises.rm(path.join(CARTELLA_VOCE, String(Number(emergencyId))), { recursive: true, force: true });
}
