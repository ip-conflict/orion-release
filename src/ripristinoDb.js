// Verifica e ripristino di un dump: li usano la pagina Sistema e scripts/ripristina-db.mjs.

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import { spawn } from 'child_process';
import { PassThrough, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { StringDecoder } from 'string_decoder';
import logger from './logger.js';
import { apriFile, cifraturaPronta, fileCifrato } from './cifratura.js';

export async function verificaArchivio(percorso) {
    const info = await fs.promises.stat(percorso).catch(() => null);
    if (!info || !info.isFile()) return { valido: false, motivo: 'il file non esiste' };
    if (info.size < 1000) return { valido: false, motivo: `il file è troppo piccolo (${info.size} byte)` };

    // Il controllo del contenuto (e del tag di autenticità) si fa sul flusso decifrato.
    const cifrato = await fileCifrato(percorso);
    if (cifrato && !cifraturaPronta()) {
        return { valido: false, motivo: 'è cifrato e la chiave dei dati non è disponibile: inserisci prima la chiave di recupero (riquadro Cifratura)' };
    }
    if (!cifrato) {
        const magici = Buffer.alloc(2);
        const handle = await fs.promises.open(percorso, 'r');
        try {
            await handle.read(magici, 0, 2, 0);
        } finally {
            await handle.close();
        }
        if (magici[0] !== 0x1f || magici[1] !== 0x8b) {
            return { valido: false, motivo: 'non è un file compresso con gzip' };
        }
    }

    const inizio = await new Promise(async (risolvi, rifiuta) => {
        let letto = '';
        const decompressore = zlib.createGunzip();
        let lettura;
        try { lettura = await apriFile(percorso); } catch (e) { return rifiuta(e); }
        decompressore.on('data', pezzo => {
            letto += pezzo.toString('utf8');
            if (letto.length > 4000) {
                lettura.destroy();
                decompressore.destroy();
                risolvi(letto);
            }
        });
        decompressore.on('end', () => risolvi(letto));
        decompressore.on('error', e => (letto ? risolvi(letto) : rifiuta(e)));
        lettura.on('error', rifiuta);
        lettura.pipe(decompressore);
    }).catch(() => null);

    if (inizio === null) return { valido: false, motivo: 'il file è compresso male o troncato' };
    if (!/PostgreSQL database dump/i.test(inizio)) {
        return { valido: false, motivo: 'non sembra un backup del database di ORION' };
    }
    const comando = await primoComandoPsql(percorso);
    if (comando === false) return { valido: false, motivo: cifrato ? 'il file è troncato, alterato o cifrato con un\'altra chiave' : 'il file è compresso male o troncato' };
    if (comando) {
        logger.warn(`[Manutenzione] Archivio ${path.basename(percorso)} rifiutato: contiene un comando di psql alla riga ${comando.riga}.`);
        return { valido: false, motivo: `contiene un comando di psql che un backup di ORION non ha (riga ${comando.riga})` };
    }
    return { valido: true, dimensione: info.size };
}

// psql esegue anche i comandi con la barra rovesciata ("\! comando" lancia un
// programma). pg_dump usa solo \restrict, \unrestrict e \. : qualunque altro è un
// archivio manomesso.
function esaminaRiga(stato, riga) {
    if (stato.inCopy) {
        if (riga === '\\.') stato.inCopy = false;
        return null;
    }
    if (/^COPY\s.+\sFROM\s+stdin;\s*$/i.test(riga)) {
        stato.inCopy = true;
        return null;
    }
    const pulita = riga.trimStart();
    if (pulita.startsWith('\\') && !/^\\(restrict|unrestrict)(\s|$)/.test(pulita)) return pulita.slice(0, 40);
    return null;
}

async function primoComandoPsql(percorso) {
    const stato = { inCopy: false };
    let numero = 0;
    try {
        // .pipe() non passa gli errori: un tag di autenticità sbagliato
        // (backup cifrato alterato) deve far fallire la lettura.
        const sorgente = await apriFile(percorso);
        const decompresso = zlib.createGunzip();
        sorgente.on('error', e => decompresso.destroy(e));
        const righe = readline.createInterface({
            input: sorgente.pipe(decompresso),
            crlfDelay: Infinity
        });
        for await (const riga of righe) {
            numero++;
            const trovato = esaminaRiga(stato, riga);
            if (trovato) {
                righe.close();
                return { riga: numero, testo: trovato };
            }
        }
        return null;
    } catch {
        return false;
    }
}

// Lo stesso controllo mentre il dump scorre verso psql, se il file fosse cambiato dopo la verifica.
function filtroComandiPsql(alRifiuto) {
    const stato = { inCopy: false };
    const decodifica = new StringDecoder('utf8');
    let resto = '';
    const controlla = (riga) => {
        if (!esaminaRiga(stato, riga)) return;
        // Prima di tutto si ferma psql: se vedesse chiudersi il flusso
        // farebbe COMMIT di quello che ha già letto.
        alRifiuto();
        throw new Error('il backup contiene un comando di psql non ammesso: ripristino interrotto.');
    };
    return new Transform({
        transform(pezzo, _codifica, fatto) {
            try {
                const testo = resto + decodifica.write(pezzo);
                const righe = testo.split('\n');
                resto = righe.pop();
                righe.forEach(controlla);
                fatto(null, pezzo);
            } catch (e) {
                fatto(e);
            }
        },
        flush(fatto) {
            try {
                resto += decodifica.end();
                if (resto) controlla(resto);
                fatto();
            } catch (e) {
                fatto(e);
            }
        }
    });
}

export async function ripristinaDatabase(percorso, connessioneDb) {
    const prefisso =
        '-- Preparato da ORION prima del ripristino\n' +
        'DROP SCHEMA IF EXISTS public CASCADE;\n' +
        'CREATE SCHEMA public;\n';

    const processo = spawn('psql', [
        '-h', connessioneDb.host,
        '-p', String(connessioneDb.porta),
        '-U', connessioneDb.utente,
        '-d', connessioneDb.database,
        '--no-password',
        '--no-psqlrc',
        '--quiet',
        '--single-transaction',
        '-v', 'ON_ERROR_STOP=1',
        '-f', '-'
    ], {
        // La password passa dall'ambiente, non dagli argomenti: la riga di
        // comando la legge chiunque con 'ps'.
        env: { ...process.env, PGPASSWORD: connessioneDb.password || '' }
    });

    let errori = '';
    processo.stderr.on('data', pezzo => { errori += pezzo.toString(); });
    processo.stdout.on('data', () => {});

    const uscita = new Promise((risolvi, rifiuta) => {
        processo.on('error', rifiuta);
        processo.on('close', codice => codice === 0
            ? risolvi()
            : rifiuta(new Error(spiegaErrorePsql(errori, codice))));
    });

    const flusso = new PassThrough();
    flusso.write(prefisso);
    let erroreFiltro = null;
    let fermatoDalFiltro = false;
    const fermaPsql = () => { fermatoDalFiltro = true; processo.kill('SIGKILL'); };
    const invio = pipeline(await apriFile(percorso), zlib.createGunzip(), filtroComandiPsql(fermaPsql), flusso)
        .catch(e => { erroreFiltro = e; });
    const scrittura = pipeline(flusso, processo.stdin).catch(() => {});

    // Se psql si ferma da solo, l'invio finisce in EPIPE: il motivo vero è quello di psql.
    try {
        await Promise.all([uscita, invio, scrittura]);
    } catch (e) {
        if (fermatoDalFiltro && erroreFiltro) throw new Error(`${erroreFiltro.message} Il database NON è stato modificato.`);
        throw e;
    }
    if (erroreFiltro) throw new Error(`${erroreFiltro.message} Il database NON è stato modificato.`);
}

function spiegaErrorePsql(errori, codice) {
    // Il DROP ... CASCADE iniziale riempie stderr di avvisi: conta la riga con l'errore.
    const testo = (errori || '').split('\n').filter(r => /ERROR|FATAL|could not|error:/i.test(r)).join('\n').trim() || (errori || '').trim();
    if (/role .* does not exist/i.test(testo)) {
        const ruolo = (testo.match(/role "([^"]+)" does not exist/i) || [])[1] || 'quello indicato';
        return `il backup viene da un'installazione il cui utente di database si chiama "${ruolo}", che qui non esiste. ` +
               `Un backup si ripristina su un'installazione con lo stesso utente di database. Dettaglio: ${testo.slice(0, 300)}`;
    }
    if (/permission denied|must be owner/i.test(testo)) {
        return `l'utente del database non ha i permessi per rifare lo schema. Dettaglio: ${testo.slice(0, 300)}`;
    }
    if (/could not connect|connection refused/i.test(testo)) {
        return `il database non risponde. Dettaglio: ${testo.slice(0, 300)}`;
    }
    return `psql è terminato con codice ${codice}. Il database NON è stato modificato. Dettaglio: ${testo.slice(0, 400)}`;
}
