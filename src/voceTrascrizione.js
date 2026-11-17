// La trascrizione dei messaggi vocali con whisper.cpp, sul server dell'associazione.

import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import logger from './logger.js';
import { leggiFile } from './cifratura.js';
import { pool } from './db.js';
import { RADICE_DATI } from './percorsi.js';
import { oggInWav } from './voceOgg.js';

// Le impronte sono quelle pubblicate da whisper.cpp (models/README.md): un file diverso non si usa.
export const MODELLI = {
    base: { file: 'ggml-base.bin', sha1: '465707469ff3a37a2b9b8d8f89f2f99de7299dac', mb: 142, nome: 'Veloce', memoria_mb: 400 },
    small: { file: 'ggml-small.bin', sha1: '55356645c2b361a969dfd0ef2c5a50d530afd8d5', mb: 466, nome: 'Equilibrata', memoria_mb: 900 },
    'large-v3-turbo-q5_0': { file: 'ggml-large-v3-turbo-q5_0.bin', sha1: 'e050f7970618a659205450ad97eb95a18d69c9ee', mb: 547, nome: 'Accurata', memoria_mb: 1300 }
};
const ORIGINE_MODELLI = process.env.ORION_MODELLI_ORIGINE || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
export const CARTELLA_MODELLI = path.join(RADICE_DATI, 'modelli');
const WHISPER = process.env.ORION_WHISPER || '/opt/whisper/whisper-cli';
// Un core resta alla voce in diretta e al resto di ORION.
const THREAD = Math.max(1, Math.min(4, os.availableParallelism() - 1));
const ATTESA_MINIMA_MS = 60_000;

// I messaggi appena detti passano davanti agli arretrati: accendendo un modello si riprende l'ultimo
// giorno, e in collaudo un messaggio nuovo è rimasto dietro a cento vecchi per minuti.
const coda = [];
const arretrati = [];
let inLavoro = null;
let girando = false;
let figlioInCorso = null;
let ultimoErrore = null;
let suTrascritto = () => {};
const scaricamenti = new Map();
const tempi = [];
let ultimoModello = { valore: null, letto: 0 };

export const programmaDisponibile = () => fs.existsSync(WHISPER);
const percorsoModello = (id) => path.join(CARTELLA_MODELLI, MODELLI[id].file);
export const modelloScaricato = (id) => !!MODELLI[id] && fs.existsSync(percorsoModello(id));

export async function modelloScelto() {
    if (Date.now() - ultimoModello.letto < 5_000) return ultimoModello.valore;
    const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'voce_trascrizione'");
    const valore = r.rows[0]?.setting_value;
    ultimoModello = { valore: MODELLI[valore] ? valore : null, letto: Date.now() };
    return ultimoModello.valore;
}

// Dentro Docker il limite è quello del container (ORION_MEMORIA), spesso molto sotto la RAM della macchina.
function limiteContainerMb() {
    for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
        try {
            const limite = Number(fs.readFileSync(file, 'utf8').trim());
            if (Number.isFinite(limite) && limite > 0 && limite < os.totalmem()) return Math.round(limite / 1024 / 1024);
        } catch { /* niente cgroup con quel nome */ }
    }
    return null;
}

const memoriaTotaleMb = () => limiteContainerMb() ?? Math.round(os.totalmem() / 1024 / 1024);

export function memoriaPerTrascrivereMb() {
    return Math.max(0, memoriaTotaleMb() - Math.round(process.memoryUsage().rss / 1024 / 1024));
}

export function comeAlzareLaMemoria() {
    const limite = limiteContainerMb();
    if (limite == null) return null;
    const istanza = process.env.ORION_ISTANZA || '<istanza>';
    return `Il container di ORION ha un limite di ${limite} MB: si alza dalla pagina Sistema, alla voce «Memoria di ORION». `
        + `Se la pagina non lo permette, chi gestisce il server lo alza con orion-agente memoria ${istanza} 2048.`;
}

export function statoTrascrizione() {
    const memoria = memoriaPerTrascrivereMb();
    const media = tempi.length ? Math.round(tempi.reduce((a, t) => a + t.ms, 0) / tempi.length) : null;
    const lentezza = tempi.length ? tempi.reduce((a, t) => a + t.ms / Math.max(t.durata, 1), 0) / tempi.length : null;
    return {
        programma: programmaDisponibile(),
        thread: THREAD,
        memoria_libera_mb: memoria,
        memoria_limite_mb: limiteContainerMb(),
        come_alzare_la_memoria: comeAlzareLaMemoria(),
        ultimo_errore: ultimoErrore,
        in_coda: coda.length + arretrati.length + (inLavoro ? 1 : 0),
        tempo_medio_ms: media,
        // Quanti secondi di calcolo per ogni secondo di voce: sopra 1 la coda cresce durante un'emergenza intensa.
        rapporto: lentezza == null ? null : Math.round(lentezza * 100) / 100,
        modelli: Object.entries(MODELLI).map(([id, m]) => ({
            id, nome: m.nome, mb: m.mb, memoria_mb: m.memoria_mb,
            scaricato: modelloScaricato(id), scaricamento: (!modelloScaricato(id) && scaricamenti.get(id)) || null,
            memoria_sufficiente: m.memoria_mb <= memoria
        }))
    };
}

export async function scaricaModello(id) {
    const m = MODELLI[id];
    if (!m) throw new Error('Modello sconosciuto.');
    const inCorso = scaricamenti.get(id);
    if (inCorso && !inCorso.errore) return;
    await fs.promises.mkdir(CARTELLA_MODELLI, { recursive: true });
    const libero = await fs.promises.statfs(CARTELLA_MODELLI).then(s => s.bavail * s.bsize).catch(() => Infinity);
    if (libero < m.mb * 1024 * 1024 * 1.2) throw new Error(`Servono circa ${Math.ceil(m.mb * 1.2)} MB liberi sul disco.`);
    const stato = { ricevuti_mb: 0, totale_mb: m.mb };
    scaricamenti.set(id, stato);
    const temporaneo = `${percorsoModello(id)}.${process.pid}.tmp`;
    (async () => {
        try {
            const r = await fetch(ORIGINE_MODELLI + m.file, { redirect: 'follow' });
            if (!r.ok || !r.body) throw new Error(`il server dei modelli risponde ${r.status}`);
            const impronta = crypto.createHash('sha1');
            const uscita = fs.createWriteStream(temporaneo, { mode: 0o640 });
            let ricevuti = 0;
            for await (const pezzo of r.body) {
                impronta.update(pezzo);
                ricevuti += pezzo.length;
                stato.ricevuti_mb = Math.round(ricevuti / 1024 / 1024);
                if (!uscita.write(pezzo)) await new Promise(ok => uscita.once('drain', ok));
            }
            await new Promise((ok, ko) => uscita.end(e => (e ? ko(e) : ok())));
            if (impronta.digest('hex') !== m.sha1) throw new Error('il file scaricato non è quello atteso (impronta diversa)');
            await fs.promises.rename(temporaneo, percorsoModello(id));
            scaricamenti.delete(id);
            logger.info(`[Voce] Modello di trascrizione ${id} scaricato.`);
            riprendiArretrati().catch(() => {});
        } catch (e) {
            await fs.promises.rm(temporaneo, { force: true });
            stato.errore = e.message;
            logger.error(`[Voce] Scaricamento del modello ${id} non riuscito: ${e.message}`);
        }
    })();
}

export async function eliminaModello(id) {
    if (!MODELLI[id]) throw new Error('Modello sconosciuto.');
    await fs.promises.rm(percorsoModello(id), { force: true });
    scaricamenti.delete(id);
}

// Quello che whisper scrive quando non sente parole.
const SENZA_PAROLE = /^\s*[[(][^\])]*[\])]\s*$/;

export function pulisciTesto(uscita) {
    return uscita.split('\n').map(r => r.trim()).filter(r => r && !SENZA_PAROLE.test(r)).join(' ').replace(/\s+/g, ' ').trim();
}

function esegui(args, limiteMs) {
    return new Promise((ok, ko) => {
        const figlio = spawn(WHISPER, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LD_LIBRARY_PATH: path.dirname(WHISPER) } });
        figlioInCorso = figlio;
        try { os.setPriority(figlio.pid, 10); } catch { /* resta alla priorità normale */ }
        let uscita = '';
        let errori = '';
        figlio.stdout.on('data', d => { uscita += d; });
        figlio.stderr.on('data', d => { errori = (errori + d).slice(-2000); });
        const timer = setTimeout(() => figlio.kill('SIGKILL'), limiteMs);
        figlio.on('error', e => { clearTimeout(timer); ko(e); });
        figlio.on('exit', () => {
            if (figlioInCorso === figlio) figlioInCorso = null;
            if (figlio.annullato) { clearTimeout(timer); ko(new Annullata()); }
        });
        figlio.on('close', (codice, segnale) => {
            clearTimeout(timer);
            if (codice === 0) ok(uscita);
            else ko(new Error(segnale ? `interrotta (${segnale}): troppo lenta o senza memoria` : `uscita ${codice}: ${errori.trim().split('\n').pop()}`));
        });
    });
}

// I nomi radio delle squadre aiutano il modello: "Bravo" non diventa "bravo" o "Bravò".
async function suggerimento() {
    const r = await pool.query('SELECT nome_radio FROM squadre WHERE nome_radio IS NOT NULL ORDER BY nome_radio LIMIT 40').catch(() => ({ rows: [] }));
    const nomi = r.rows.map(s => s.nome_radio).join(', ');
    return `Comunicazione radio di protezione civile tra le squadre${nomi ? ` ${nomi}` : ''} e la sala operativa.`;
}

class Annullata extends Error {}

async function trascrivi(id, modello) {
    const m = (await pool.query('SELECT id, file, canale, durata_ms FROM voce_messaggi WHERE id = $1', [id])).rows[0];
    if (!m?.file) return;
    const cartellaVoce = path.join(RADICE_DATI, 'protected_uploads', 'voce');
    const percorso = path.join(cartellaVoce, m.file);
    if (!percorso.startsWith(cartellaVoce + path.sep)) return;
    const audio = path.join(os.tmpdir(), `orion-voce-${crypto.randomUUID()}.wav`);
    const inizio = Date.now();
    try {
        await fs.promises.writeFile(audio, await oggInWav(await leggiFile(percorso)), { mode: 0o600 });
        const testo = pulisciTesto(await esegui(
            ['-m', percorsoModello(modello), '-l', 'it', '-nt', '-np', '-t', String(THREAD), '--prompt', await suggerimento(), '-f', audio],
            Math.max(ATTESA_MINIMA_MS, (m.durata_ms || 0) * 15)));
        const ms = Date.now() - inizio;
        tempi.push({ ms, durata: m.durata_ms || 1 });
        if (tempi.length > 50) tempi.shift();
        ultimoErrore = null;
        await pool.query(
            `UPDATE voce_messaggi SET trascrizione = $2, trascrizione_stato = $3, trascritto_il = NOW(), trascrizione_ms = $4 WHERE id = $1`,
            [id, testo || null, testo ? 'fatta' : 'vuota', ms]);
        if (testo) suTrascritto({ id, canale: m.canale, testo });
    } catch (e) {
        if (e instanceof Annullata) return;
        logger.warn(`[Voce] Trascrizione del messaggio ${id} non riuscita: ${e.message}`);
        ultimoErrore = { messaggio: e.message, modello, il: new Date().toISOString() };
        await pool.query("UPDATE voce_messaggi SET trascrizione_stato = 'errore', trascritto_il = NOW() WHERE id = $1", [id]).catch(() => {});
    } finally {
        await fs.promises.rm(audio, { force: true });
    }
}

// Il segnale si alza prima di ogni attesa: con due giri insieme partirebbero due whisper, e la memoria non basta.
async function giro() {
    if (girando) return;
    girando = true;
    try {
        while (coda.length || arretrati.length) {
            const modello = await modelloScelto().catch(() => null);
            if (!modello || !modelloScaricato(modello) || !programmaDisponibile()) {
                coda.length = 0;
                arretrati.length = 0;
                return;
            }
            inLavoro = coda.length ? coda.shift() : arretrati.shift();
            try {
                await trascrivi(inLavoro, modello);
            } finally {
                inLavoro = null;
            }
        }
    } finally {
        girando = false;
    }
}

export async function accodaTrascrizione(id, { arretrato = false } = {}) {
    const modello = await modelloScelto().catch(() => null);
    if (!modello || !modelloScaricato(modello) || !programmaDisponibile()) return false;
    if (coda.includes(id) || arretrati.includes(id) || inLavoro === id) return true;
    (arretrato ? arretrati : coda).push(id);
    giro().catch(e => logger.error('[Voce] Coda delle trascrizioni:', e));
    return true;
}

// Dopo un riavvio, o quando si accende la trascrizione, si recuperano i messaggi dell'ultimo giorno.
// Con un modello nuovo si riprovano anche quelli falliti: spesso col modello di prima mancava la memoria.
export async function riprendiArretrati({ ancheFalliti = false } = {}) {
    const modello = await modelloScelto();
    if (!modello || !modelloScaricato(modello) || !programmaDisponibile()) return 0;
    const r = await pool.query(
        `SELECT id FROM voce_messaggi
          WHERE (trascrizione_stato IS NULL OR ($1 AND trascrizione_stato = 'errore'))
            AND file IS NOT NULL AND stato <> 'in_diretta' AND arrivato_il > NOW() - interval '1 day'
          ORDER BY id DESC`, [ancheFalliti]);
    for (const { id } of r.rows) await accodaTrascrizione(id, { arretrato: true });
    return r.rowCount;
}

// Il messaggio a metà non resta col modello di prima: si ferma e lo riprende il nuovo.
export function modelloCambiato() {
    ultimoModello = { valore: null, letto: 0 };
    ultimoErrore = null;
    coda.length = 0;
    arretrati.length = 0;
    if (figlioInCorso) {
        figlioInCorso.annullato = true;
        figlioInCorso.kill('SIGKILL');
    }
    setTimeout(() => riprendiArretrati({ ancheFalliti: true }).catch(e => logger.warn(`[Voce] Arretrati della trascrizione: ${e.message}`)), 1_000).unref();
}

export function avviaTrascrizione({ annuncia }) {
    suTrascritto = annuncia;
    setTimeout(() => riprendiArretrati().catch(e => logger.warn(`[Voce] Arretrati della trascrizione: ${e.message}`)), 15_000).unref();
}
