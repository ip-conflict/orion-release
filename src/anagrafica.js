// src/anagrafica.js
//
// Nomi utente, password temporanee e importazione dei volontari da un foglio.

import ExcelJS from 'exceljs';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import logger from './logger.js';
import path from 'path';
import { Readable } from 'stream';
import { domainName } from './config.js';
import { erroreRichiesta } from './costanti.js';
import { scriviRuoli } from './autenticazione.js';
import { pool } from './db.js';

// I campi dell'anagrafica con i limiti delle colonne del database. Un valore
// troppo lungo o di tipo sbagliato è un errore di chi scrive (400), non un
// guasto del server (500).
const LIMITI_ANAGRAFICA = {
    nome: 50, cognome: 50, email: 100, telefono: 20, indirizzo: 255, citta: 100, cap: 10, codice_fiscale: 16
};
const NOMI_CAMPI = {
    nome: 'Il nome', cognome: 'Il cognome', email: "L'email", telefono: 'Il telefono', indirizzo: "L'indirizzo",
    citta: 'La città', cap: 'Il CAP', codice_fiscale: 'Il codice fiscale'
};

// Restituisce { valori } con solo i campi presenti nella richiesta (stringhe
// ripulite, null se vuote), oppure { errore }. Un campo assente non si tocca.
export function leggiCampiAnagrafici(corpo, campi) {
    const valori = {};
    for (const campo of campi) {
        if (!corpo || corpo[campo] === undefined) continue;
        const grezzo = corpo[campo];
        if (grezzo !== null && typeof grezzo !== 'string' && typeof grezzo !== 'number') {
            return { errore: `${NOMI_CAMPI[campo]} non è valido.` };
        }
        let valore = grezzo === null ? '' : String(grezzo).trim();
        if (campo === 'codice_fiscale') valore = valore.toUpperCase();
        if (campo === 'email') valore = valore.toLowerCase();
        if (valore.length > LIMITI_ANAGRAFICA[campo]) {
            return { errore: `${NOMI_CAMPI[campo]} supera i ${LIMITI_ANAGRAFICA[campo]} caratteri.` };
        }
        if (campo === 'codice_fiscale' && valore && !/^[A-Z0-9]{16}$/.test(valore)) {
            return { errore: 'Il Codice Fiscale deve essere di 16 caratteri alfanumerici.' };
        }
        if (campo === 'email' && valore && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valore)) {
            return { errore: "L'indirizzo email non è valido." };
        }
        valori[campo] = valore === '' ? null : valore;
    }
    return { valori };
}

export function senzaAccenti(testo) {
    return String(testo ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export async function generateUsername(nome, cognome, pool) {

    const cleanNome = String(nome || '').trim();
    const cleanCognome = String(cognome || '').trim();

    // Nicolò D'Angelo diventa dangelonicolo, non dangelonicol.
    const baseUsernamePart1 = senzaAccenti(cleanCognome).toLowerCase().replace(/[^a-z0-9]/g, '');
    const baseUsernamePart2 = senzaAccenti(cleanNome).toLowerCase().replace(/[^a-z0-9]/g, '');


    if (!baseUsernamePart1 && !baseUsernamePart2) {
        throw new Error('Nome e Cognome forniti non contengono caratteri validi per generare uno username.');
    }

    let finalUsername = '';
    let isUnique = false;
    const maxUsernameAttempts = 50;
    let attempts = 0;

    // nome.cognome, poi solo cognome, poi solo nome, poi con un numero.
    const b1 = baseUsernamePart1;
    const b2 = baseUsernamePart2;

    for (let i = 1; i <= b2.length && attempts < maxUsernameAttempts; i++) {
        attempts++;
        const currentCandidate = b1 + b2.substring(0, i);
        if (!currentCandidate) continue;

        const checkUser = await pool.query('SELECT 1 FROM users WHERE username = $1', [currentCandidate]);
        if (checkUser.rowCount === 0) {
            finalUsername = currentCandidate;
            isUnique = true;
            break;
        }
    }


    if (!isUnique && b1 && attempts < maxUsernameAttempts && (b1 !== finalUsername)) {
        const currentCandidate = b1;
        attempts++;
        const checkUser = await pool.query('SELECT 1 FROM users WHERE username = $1', [currentCandidate]);
        if (checkUser.rowCount === 0) {
            finalUsername = currentCandidate;
            isUnique = true;
        }
    }
    

    if (!isUnique && b2 && attempts < maxUsernameAttempts && (b2 !== finalUsername)) {
        const currentCandidate = b2;
         attempts++;
        const checkUser = await pool.query('SELECT 1 FROM users WHERE username = $1', [currentCandidate]);
        if (checkUser.rowCount === 0) {
            finalUsername = currentCandidate;
            isUnique = true;
        }
    }


    if (!isUnique) {

        let baseForNumericSuffix = b1 + b2;
        if (!baseForNumericSuffix) {
            baseForNumericSuffix = "utente";
        }

        let numericSuffix = 1;
        while (attempts < maxUsernameAttempts) {
            attempts++;
            const currentCandidate = baseForNumericSuffix + numericSuffix;
            const checkUser = await pool.query('SELECT 1 FROM users WHERE username = $1', [currentCandidate]);
            if (checkUser.rowCount === 0) {
                finalUsername = currentCandidate;
                isUnique = true;
                break;
            }
            numericSuffix++;
        }
    }

    if (!isUnique) {
        throw new Error(`Impossibile generare uno username univoco per '${cleanCognome} ${cleanNome}' dopo ${attempts} tentativi.`);
    }

    return finalUsername;
}


// Il testo che l'operatore vede nella cella: date, formule, testo formattato,
// collegamenti (Excel trasforma le email in mailto:).
function valoreCella(cella) {
    const valore = cella?.value;
    if (valore === null || valore === undefined) return '';
    if (valore instanceof Date) return valore.toISOString().slice(0, 10);
    if (typeof valore === 'object') {
        if (Array.isArray(valore.richText)) return valore.richText.map(p => p.text || '').join('');
        if (typeof valore.text === 'string') return valore.text;
        if (valore.result !== undefined && valore.result !== null) return String(valore.result);
        return '';
    }
    return String(valore);
}

// Le intestazioni che una segreteria scrive davvero: "E-mail", "Cellulare",
// "Codice fiscale", con o senza accenti e maiuscole.
const SINONIMI_COLONNE = {
    nome: ['nome', 'name', 'firstname'],
    cognome: ['cognome', 'surname', 'lastname'],
    email: ['email', 'mail', 'postaelettronica', 'indirizzoemail'],
    telefono: ['telefono', 'cellulare', 'tel', 'cell', 'numeroditelefono', 'phone', 'mobile'],
    codice_fiscale: ['codicefiscale', 'cf', 'codfiscale', 'codfisc']
};

function campoDaIntestazione(intestazione) {
    const chiave = senzaAccenti(intestazione).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [campo, nomi] of Object.entries(SINONIMI_COLONNE)) {
        if (nomi.includes(chiave)) return campo;
    }
    return null;
}

// Un CSV salvato da Excel in italiano usa il punto e virgola, spesso comincia
// con il BOM e a volte non è in UTF-8 ma in Windows-1252.
function testoCsv(buffer) {
    let testo;
    try {
        testo = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        testo = new TextDecoder('windows-1252').decode(buffer);
    }
    return testo.replace(/^﻿/, '');
}

function separatoreCsv(testo) {
    const prima = testo.split(/\r?\n/, 1)[0] || '';
    const conteggi = [';', ',', '\t'].map(s => [s, prima.split(s).length - 1]);
    conteggi.sort((a, b) => b[1] - a[1]);
    return conteggi[0][1] > 0 ? conteggi[0][0] : ',';
}

// Il primo foglio di un .xlsx o .csv: per ogni riga il suo numero nel foglio
// e i campi riconosciuti. Il vecchio .xls non si legge: va salvato come .xlsx o CSV.
async function leggiRigheFoglio(filePath, nomeOriginale) {
    const estensione = path.extname(nomeOriginale || filePath).toLowerCase();
    if (estensione === '.xls') {
        throw erroreRichiesta("Il formato .xls (Excel 2003) non è supportato: aprire il file e salvarlo come .xlsx oppure come CSV.");
    }

    const cartella = new ExcelJS.Workbook();
    if (estensione === '.csv') {
        const testo = testoCsv(await fs.promises.readFile(filePath));
        await cartella.csv.read(Readable.from([testo]), { parserOptions: { delimiter: separatoreCsv(testo) } });
    } else {
        await cartella.xlsx.readFile(filePath);
    }

    const foglio = cartella.worksheets[0];
    if (!foglio) return { righe: [], colonne: [] };

    const campi = [];
    foglio.getRow(1).eachCell({ includeEmpty: true }, (cella, colonna) => {
        campi[colonna] = campoDaIntestazione(valoreCella(cella).replace(/^﻿/, '').trim());
    });
    const colonne = [...new Set(campi.filter(Boolean))];
    if (!colonne.includes('nome') || !colonne.includes('cognome')) {
        throw erroreRichiesta('Nella prima riga non trovo le colonne "Nome" e "Cognome". Controlla le intestazioni (se il file è un CSV, che sia separato da virgole o da punti e virgola).');
    }

    const righe = [];
    foglio.eachRow({ includeEmpty: false }, (riga, numero) => {
        if (numero === 1) return;
        const dati = Object.create(null);
        let vuota = true;
        riga.eachCell({ includeEmpty: false }, (cella, colonna) => {
            const campo = campi[colonna];
            if (!campo) return;
            const valore = valoreCella(cella).trim();
            if (valore !== '') vuota = false;
            dati[campo] = valore;
        });
        if (!vuota) righe.push({ numero, dati });
    });
    return { righe, colonne };
}

const normalizzaNome = t => senzaAccenti(String(t || '')).toLowerCase().replace(/\s+/g, ' ').trim();

// Importa i volontari da un foglio. Nascono senza password, ognuno con il suo
// link di attivazione, come quelli creati uno alla volta. Chi c'è già non si
// crea di nuovo: ricaricare lo stesso foglio non fa doppioni.
export async function importUsersFromExcel(filePath, nomeOriginale) {
    const { righe, colonne } = await leggiRigheFoglio(filePath, nomeOriginale);
    logger.info(`Importazione utenti: ${righe.length} righe, colonne ${colonne.join(', ')}.`);

    const esito = { processed: 0, imported: 0, skipped: 0, colonne, importati: [], righe_saltate: [] };
    const salta = (riga, persona, motivo) => {
        esito.skipped++;
        esito.righe_saltate.push({ riga, persona, motivo });
    };
    const visti = new Set();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const { numero, dati } of righe) {
            esito.processed++;
            const persona = [dati.nome, dati.cognome].filter(Boolean).join(' ') || '(senza nome)';
            if (!dati.nome || !dati.cognome) { salta(numero, persona, 'Mancano il nome o il cognome.'); continue; }

            const { valori, errore } = leggiCampiAnagrafici(dati, ['nome', 'cognome', 'email', 'telefono', 'codice_fiscale']);
            if (errore) { salta(numero, persona, errore); continue; }

            // Doppioni nello stesso foglio.
            const chiavi = [
                valori.codice_fiscale && `cf:${valori.codice_fiscale}`,
                valori.email && `email:${valori.email}`,
                `nome:${normalizzaNome(valori.nome)}|${normalizzaNome(valori.cognome)}`
            ].filter(Boolean);
            if (chiavi.some(k => visti.has(k))) { salta(numero, persona, 'Ripetuta più in alto nello stesso foglio.'); continue; }
            chiavi.forEach(k => visti.add(k));

            // Chi c'è già. Lo stesso nome con un codice fiscale diverso è
            // un omonimo, e si importa.
            const esistente = await client.query(
                `SELECT username, codice_fiscale, email, nome, cognome FROM users
                 WHERE eliminato_il IS NULL
                   AND (($1::text IS NOT NULL AND UPPER(codice_fiscale) = $1)
                    OR ($2::text IS NOT NULL AND LOWER(email) = $2)
                    OR (LOWER(nome) = LOWER($3) AND LOWER(cognome) = LOWER($4)))`,
                [valori.codice_fiscale, valori.email, valori.nome, valori.cognome]);
            const giaPresente = esistente.rows.find(u =>
                (valori.codice_fiscale && u.codice_fiscale?.toUpperCase() === valori.codice_fiscale)
                || (valori.email && u.email?.toLowerCase() === valori.email)
                || !(valori.codice_fiscale && u.codice_fiscale && u.codice_fiscale.toUpperCase() !== valori.codice_fiscale));
            if (giaPresente) {
                const perche = valori.codice_fiscale && giaPresente.codice_fiscale?.toUpperCase() === valori.codice_fiscale ? 'lo stesso codice fiscale'
                    : valori.email && giaPresente.email?.toLowerCase() === valori.email ? 'la stessa email'
                        : 'lo stesso nome e cognome';
                salta(numero, persona, `C'è già (${giaPresente.username}, con ${perche}). Se è un'altra persona, creala a mano.`);
                continue;
            }

            let username;
            try {
                username = await generateUsername(valori.nome, valori.cognome, client);
            } catch (e) {
                salta(numero, persona, e.message);
                continue;
            }

            try {
                // Il link vale 7 giorni, come per chi si crea a mano: si distribuiscono anche stampati.
                const attivazione = crypto.randomBytes(32).toString('hex');
                const impronta = await bcrypt.hash(attivazione, 10);
                const scade = new Date(Date.now() + 7 * 24 * 3600000);
                // Un savepoint per riga: una riga sbagliata non annulla le altre.
                await client.query('SAVEPOINT riga_import');
                const inserito = await client.query(
                    `INSERT INTO users (username, password, role, nome, cognome, email, telefono, codice_fiscale, reset_token, reset_token_expires)
                     VALUES ($1, NULL, 'volontario', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
                    [username, valori.nome, valori.cognome, valori.email, valori.telefono, valori.codice_fiscale, impronta, scade]);
                await scriviRuoli(client, inserito.rows[0].id, ['volontario']);
                await client.query('RELEASE SAVEPOINT riga_import');
                const magicLink = `https://${domainName}/reset-password.html?token=${attivazione}&id=${inserito.rows[0].id}`;
                esito.imported++;
                esito.importati.push({ riga: numero, username, nome: valori.nome, cognome: valori.cognome, email: valori.email, magicLink });
            } catch (e) {
                await client.query('ROLLBACK TO SAVEPOINT riga_import').catch(() => {});
                logger.error(`Importazione utenti, riga ${numero}:`, e.detail || e.message);
                salta(numero, persona, e.code === '23505' ? 'Email o codice fiscale già usati da un altro utente.' : 'Il database ha rifiutato la riga.');
            }
        }
        await client.query('COMMIT');
        logger.info(`Importazione completata: ${esito.imported} importati, ${esito.skipped} saltati.`);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Errore grave durante la transazione di importazione:', error);
        throw error;
    } finally {
        client.release();
    }
    return esito;
}
