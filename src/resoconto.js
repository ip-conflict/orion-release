// Il resoconto testuale di un'emergenza, scritto alla chiusura.

import './config.js';
import fs from 'fs';
import logger from './logger.js';
import path from 'path';
import { ETICHETTA_PRIORITA, ETICHETTA_STATO, MOTIVI_SENZA_SQUADRA } from './costanti.js';
import { pool } from './db.js';
import { vociDiarioSala } from './diarioSala.js';
import { ETICHETTE_MOVIMENTO } from './magazzino.js';
import { sigilloAttuale, testoSigillo } from './integrita.js';
import { fileURLToPath } from 'url';
import { cifra, cifraturaPronta } from './cifratura.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Un .txt a larghezza fissa: si stampa, si allega alla relazione e si apre
// anche fra dieci anni, senza database né browser.
export const CARTELLA_RESOCONTI = path.join(__dirname, '..', 'protected_uploads', 'emergency_logs');
const FUSO_ORARIO_RESOCONTO = process.env.TZ || 'Europe/Rome';
const LARGHEZZA_RESOCONTO = 80;

function dataOraResoconto(valore, soloOra = false) {
    if (!valore) return 'n.d.';
    const opzioni = soloOra
        ? { timeZone: FUSO_ORARIO_RESOCONTO, hour: '2-digit', minute: '2-digit', hour12: false }
        : { timeZone: FUSO_ORARIO_RESOCONTO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };

    return new Date(valore).toLocaleString('it-IT', opzioni).replace(', ', ' ');
}

function durataLeggibile(inizio, fine) {
    if (!inizio || !fine) return 'n.d.';
    const minutiTotali = Math.max(0, Math.round((new Date(fine) - new Date(inizio)) / 60000));
    const giorni = Math.floor(minutiTotali / 1440);
    const ore = Math.floor((minutiTotali % 1440) / 60);
    const minuti = minutiTotali % 60;
    const pezzi = [];
    if (giorni) pezzi.push(`${giorni}g`);
    if (ore || giorni) pezzi.push(`${ore}h`);
    pezzi.push(`${minuti}min`);
    return pezzi.join(' ');
}

// Testo libero mandato a capo alla larghezza del foglio e rientrato.
function testoRientrato(valore, rientro = '     ') {
    if (valore === null || valore === undefined || String(valore).trim() === '') return null;
    const larghezzaUtile = LARGHEZZA_RESOCONTO - rientro.length;
    const righe = [];
    String(valore).replace(/\r\n/g, '\n').split('\n').forEach(rigaOriginale => {
        let corrente = '';
        rigaOriginale.split(/\s+/).forEach(parola => {
            if (!parola) return;
            if (corrente && (corrente.length + 1 + parola.length) > larghezzaUtile) {
                righe.push(rientro + corrente);
                corrente = parola;
            } else {
                corrente = corrente ? `${corrente} ${parola}` : parola;
            }
        });
        righe.push(rientro + corrente);
    });
    return righe.join('\n');
}

function titoloSezione(numero, testo) {
    return `\n${'-'.repeat(LARGHEZZA_RESOCONTO)}\n${numero}. ${testo.toUpperCase()}\n${'-'.repeat(LARGHEZZA_RESOCONTO)}\n`;
}

export async function componiResocontoEmergenza(emergencyId, autore = null) {
    const { rows: emergenze } = await pool.query(
        `SELECT e.id, e.code, e.name, e.start_time, e.end_time, e.status, e.sigillo_chiusura, e.simulazione, e.interrotta_il,
                a.titolo AS attivita_titolo, t.nome AS attivita_tipo, v.code AS interrotta_da_codice
           FROM emergencies e LEFT JOIN attivita a ON a.id = e.attivita_id LEFT JOIN attivita_tipi t ON t.id = a.tipo_id
           LEFT JOIN emergencies v ON v.id = e.interrotta_da
          WHERE e.id = $1`,
        [emergencyId]
    );
    if (emergenze.length === 0) return null;
    const emergenza = emergenze[0];


    const [diarioSala, segnalazioni, aggiornamenti, assegnazioni, immagini, documenti, operazioni, registroSquadre, materiali, materialiFuori, nomeAssociazione, incarichi, elementiMappa] = await Promise.all([
        vociDiarioSala(pool, emergencyId),
        pool.query(`
            SELECT r.id, r.emergency_report_number, r.title, r.description, r.status, r.priority,
                   r.location_address, r.latitude, r.longitude, r.environmental_hazard,
                   r.no_team_reason,
                   r.reporter_name, r.reporter_contact, r.created_at, r.updated_at,
                   CONCAT(u.nome, ' ', u.cognome) AS creatore
            FROM reports r LEFT JOIN users u ON r.creator_user_id = u.id
            WHERE r.emergency_id = $1
            ORDER BY COALESCE(r.emergency_report_number, r.id) ASC`, [emergencyId]),
        pool.query(`
            SELECT ru.report_id, ru.update_timestamp, ru.update_text, ru.is_system,
                   CONCAT(u.nome, ' ', u.cognome) AS autore, f.sigla AS funzione
            FROM report_updates ru
            JOIN reports r ON ru.report_id = r.id
            LEFT JOIN users u ON ru.user_id = u.id
            LEFT JOIN funzioni f ON f.id = ru.funzione_id
            WHERE r.emergency_id = $1
            ORDER BY ru.update_timestamp ASC, ru.id ASC`, [emergencyId]),
        pool.query(`
            SELECT a.report_id, a.assigned_at,
                   COALESCE(s.nome, a.squadra_nome, a.nome_radio) AS nome, COALESCE(s.nome_radio, a.nome_radio) AS nome_radio
            FROM report_team_assignments a
            JOIN reports r ON a.report_id = r.id
            -- La squadra può essere stata sciolta: restano i nomi di allora.
            LEFT JOIN squadre s ON a.squadra_id = s.id
            WHERE r.emergency_id = $1
            ORDER BY a.assigned_at ASC`, [emergencyId]),
        pool.query(`
            SELECT i.report_id, COUNT(*)::int AS quante
            FROM report_images i JOIN reports r ON i.report_id = r.id
            WHERE r.emergency_id = $1 GROUP BY i.report_id`, [emergencyId]),
        pool.query(`
            SELECT d.original_filename, d.description, d.uploaded_at,
                   COALESCE(NULLIF(TRIM(CONCAT(u.nome, ' ', u.cognome)), ''), 'ORION') AS autore
            FROM emergency_documents d LEFT JOIN users u ON d.uploader_user_id = u.id
            WHERE d.emergency_id = $1 ORDER BY d.uploaded_at ASC`, [emergencyId]),
        // Le operazioni fra apertura e chiusura, senza quelle sui DPI: sono la
        // dotazione dei volontari, non materiale dell'emergenza.
        pool.query(`
            SELECT a.occurred_at, a.username, a.action, a.entity_type, a.entity_id, a.details
            FROM audit_log a
            WHERE a.occurred_at >= $1 AND a.occurred_at <= COALESCE($2, NOW())
              AND NOT (
                  a.action LIKE 'magazzino.modello.%'
                  OR (a.entity_type = 'bene' AND a.action LIKE 'magazzino.%'
                      AND EXISTS (SELECT 1 FROM beni b WHERE b.id::text = a.entity_id AND b.tipo = 'dpi'))
                  OR (a.entity_type = 'categoria' AND a.action LIKE 'magazzino.%'
                      AND EXISTS (SELECT 1 FROM categorie_beni c WHERE c.id::text = a.entity_id AND c.tipo = 'dpi'))
                  OR (a.entity_type = 'verbale' AND a.action LIKE 'magazzino.verbale.%'
                      AND NOT EXISTS (SELECT 1 FROM movimenti m JOIN beni b ON b.id = m.bene_id
                                      WHERE m.verbale_id::text = a.entity_id AND b.tipo <> 'dpi'))
              )
            ORDER BY a.occurred_at ASC`, [emergenza.start_time, emergenza.end_time]),
        pool.query(`
            SELECT nome_radio, squadra_nome, username, nome, cognome, azione, motivo, quando, eseguita_da
            FROM emergency_team_log
            WHERE emergency_id = $1
            ORDER BY quando ASC, nome_radio ASC, cognome ASC`, [emergencyId]),
        // Mezzi e materiali dell'emergenza, con i nomi scritti nel movimento
        // (un mezzo venduto domani resta quello di allora). Niente DPI.
        pool.query(`
            SELECT m.quando, m.tipo, m.quantita, m.bene_denominazione, m.destinatario_tipo,
                   m.destinatario_nome, m.note, m.eseguito_da, m.km_registrati,
                   b.tipo AS famiglia, b.matricola, b.unita_misura, b.gestione
            FROM movimenti m JOIN beni b ON b.id = m.bene_id
            WHERE m.emergency_id = $1 AND b.tipo <> 'dpi'
            ORDER BY m.quando ASC, m.id ASC`, [emergencyId]),
        // Quello che è uscito per questa emergenza e non è ancora rientrato.
        pool.query(`
            SELECT b.denominazione, b.matricola, b.tipo AS famiglia, b.gestione, b.unita_misura,
                   s.destinatario_tipo, s.destinatario_nome, s.ultimo_movimento_il
            FROM beni b
            JOIN beni_situazione s ON s.bene_id = b.id
            WHERE b.dismesso_il IS NULL AND b.tipo <> 'dpi'
              AND s.destinatario_tipo IN ('persona', 'squadra', 'veicolo', 'officina')
              AND EXISTS (SELECT 1 FROM movimenti m WHERE m.bene_id = b.id AND m.emergency_id = $1)
            ORDER BY b.tipo, b.denominazione`, [emergencyId]),
        pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'association_name'")
            .then(r => r.rows[0]?.setting_value || null)
            .catch(() => null),
        // Gli incarichi alle funzioni di supporto: motivazione ed esito sono
        // già nel diario di ogni segnalazione, qui serve lo stato.
        pool.query(`
            SELECT i.report_id, i.stato, f.sigla
            FROM incarichi i JOIN funzioni f ON f.id = i.funzione_id JOIN reports r ON r.id = i.report_id
            WHERE r.emergency_id = $1 ORDER BY f.ordine, f.sigla`, [emergencyId])
            .then(r => r.rows).catch(() => []),
        pool.query(`SELECT tipo, nome, note, creato_il, creato_da, rimosso_il, rimosso_da, oltre_emergenza
                    FROM elementi_mappa WHERE emergency_id = $1 ORDER BY creato_il`, [emergencyId])
            .then(r => r.rows).catch(() => [])
    ]);

    const perSegnalazione = (righe, chiave = 'report_id') => {
        const mappa = new Map();
        righe.forEach(r => {
            if (!mappa.has(r[chiave])) mappa.set(r[chiave], []);
            mappa.get(r[chiave]).push(r);
        });
        return mappa;
    };
    const diari = perSegnalazione(aggiornamenti.rows);
    const squadrePerReport = perSegnalazione(assegnazioni.rows);
    const immaginiPerReport = new Map(immagini.rows.map(r => [r.report_id, r.quante]));

    const alta = segnalazioni.rows.filter(r => r.priority === 'High').length;
    const squadreImpiegate = new Set(assegnazioni.rows.map(r => r.nome));

    const parti = [];
    parti.push('='.repeat(LARGHEZZA_RESOCONTO));
    parti.push(emergenza.simulazione ? `RESOCONTO SIMULAZIONE - ${emergenza.code}` : `RESOCONTO EMERGENZA - ${emergenza.code}`);
    if (nomeAssociazione) parti.push(nomeAssociazione);
    parti.push('='.repeat(LARGHEZZA_RESOCONTO));
    parti.push('');
    // Una simulazione non deve mai poter sembrare un'emergenza vera.
    if (emergenza.simulazione) {
        parti.push("*** SIMULAZIONE: scenario simulato in sala, non un'emergenza reale ***");
        if (emergenza.attivita_titolo) parti.push(`Attivita' .........: ${emergenza.attivita_tipo ? `${emergenza.attivita_tipo}: ` : ''}${emergenza.attivita_titolo}`);
        if (emergenza.interrotta_il) parti.push(`Interrotta ........: ${dataOraResoconto(emergenza.interrotta_il)}${emergenza.interrotta_da_codice ? `, per l'emergenza ${emergenza.interrotta_da_codice}` : ''}`);
        parti.push('');
    }
    parti.push(`Codice ............: ${emergenza.code}`);
    parti.push(`Denominazione .....: ${emergenza.name || '(non indicata)'}`);
    parti.push(`Apertura ..........: ${dataOraResoconto(emergenza.start_time)}`);
    parti.push(`Chiusura ..........: ${dataOraResoconto(emergenza.end_time)}`);
    parti.push(`Durata ............: ${durataLeggibile(emergenza.start_time, emergenza.end_time)}`);
    parti.push(`Segnalazioni ......: ${segnalazioni.rows.length}${alta ? ` (di cui ${alta} ad alta priorita')` : ''}`);
    parti.push(`Squadre impiegate .: ${squadreImpiegate.size}`);
    const senzaSquadraPerScelta = segnalazioni.rows.filter(r => MOTIVI_SENZA_SQUADRA[r.no_team_reason]).length;
    if (senzaSquadraPerScelta) parti.push(`Senza squadra .....: ${senzaSquadraPerScelta} (per scelta, vedi dettaglio)`);
    parti.push(`Documenti allegati : ${documenti.rows.length}`);
    if (incarichi.length) {
        const rimasti = incarichi.filter(i => i.stato !== 'concluso').length;
        parti.push(`Incarichi funzioni : ${incarichi.length}${rimasti ? ` (${rimasti} rimasti aperti)` : ''}`);
    }
    if (diarioSala.length) parti.push(`Note di sala ......: ${diarioSala.length}`);
    if (materiali.rows.length) {
        const mezziEMateriali = new Set(materiali.rows.map(m => m.bene_denominazione)).size;
        parti.push(`Mezzi e materiali .: ${mezziEMateriali}` +
            (materialiFuori.rows.length ? ` (${materialiFuori.rows.length} ancora fuori)` : ''));
    }
    parti.push(`Op. registrate ....: ${operazioni.rows.length}`);
    parti.push('');
    parti.push(`Resoconto generato il ${dataOraResoconto(new Date())}${autore ? ` da ${autore}` : ''}.`);

    parti.push(titoloSezione(1, 'Diario di sala'));
    if (diarioSala.length === 0) {
        parti.push('Nessuna nota di sala registrata.');
    }
    diarioSala.forEach(v => {
        parti.push(`[${dataOraResoconto(v.creata_il)}] ${v.autore_nome || 'utente rimosso'}:`);
        parti.push(testoRientrato(v.testo, '     ') || '     (vuoto)');
    });

    parti.push(titoloSezione(2, 'Segnalazioni'));
    if (segnalazioni.rows.length === 0) {
        parti.push('Nessuna segnalazione registrata durante questa emergenza.');
    }
    segnalazioni.rows.forEach(r => {
        const numero = r.emergency_report_number ?? r.id;
        const priorita = ETICHETTA_PRIORITA[r.priority] || r.priority || 'N.D.';
        const stato = ETICHETTA_STATO[r.status] || r.status || 'N.D.';
        parti.push(`#${numero} - ${r.title}`);
        parti.push(`     Priorita' ...: ${priorita.padEnd(6)}    Stato finale: ${stato}`);
        parti.push(`     Aperta ......: ${dataOraResoconto(r.created_at)} da ${(r.creatore || '').trim() || 'utente rimosso'}`);
        parti.push(`     Ultimo agg. .: ${dataOraResoconto(r.updated_at)}`);
        const coordinate = (r.latitude !== null && r.longitude !== null)
            ? ` (${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)})`
            : '';
        parti.push(`     Luogo .......: ${r.location_address || 'non indicato'}${coordinate}`);
        if (r.reporter_name || r.reporter_contact) {
            parti.push(`     Segnalante ..: ${[r.reporter_name, r.reporter_contact].filter(Boolean).join(' - ')}`);
        }
        if (r.environmental_hazard) parti.push(`     Rischi ......: ${r.environmental_hazard}`);
        const squadre = squadrePerReport.get(r.id) || [];
        const motivoSenzaSquadra = MOTIVI_SENZA_SQUADRA[r.no_team_reason];

        const descrizioneSquadre = squadre.length
            ? squadre.map(s => `${s.nome} (dalle ${dataOraResoconto(s.assigned_at, true)})`).join(', ')
            : (motivoSenzaSquadra ? `nessuna - ${motivoSenzaSquadra.toLowerCase()}` : 'nessuna assegnata');
        parti.push(`     Squadre .....: ${descrizioneSquadre}`);
        const funzioniReport = incarichi.filter(i => i.report_id === r.id);
        if (funzioniReport.length) {
            parti.push(`     Funzioni ....: ${funzioniReport.map(i => `${i.sigla} ${i.stato === 'concluso' ? 'conclusa' : 'ancora aperta'}`).join(', ')}`);
        }
        const quanteImmagini = immaginiPerReport.get(r.id) || 0;
        if (quanteImmagini) parti.push(`     Immagini ....: ${quanteImmagini} allegate (consultabili in archivio)`);
        const descrizione = testoRientrato(r.description, '       ');
        if (descrizione) {
            parti.push('     Descrizione:');
            parti.push(descrizione);
        }
        parti.push('     Diario:');
        const diario = diari.get(r.id) || [];
        if (diario.length === 0) {
            parti.push('       (nessun aggiornamento registrato)');
        } else {
            diario.forEach(v => {
                const chi = (v.autore || '').trim() || 'utente rimosso';
                const perConto = v.funzione && !v.is_system ? ` per la ${v.funzione}` : '';
                const intestazione = v.is_system
                    ? `       [${dataOraResoconto(v.update_timestamp)}] (sistema, ${chi})`
                    : `       [${dataOraResoconto(v.update_timestamp)}] ${chi}${perConto}:`;
                parti.push(intestazione);
                parti.push(testoRientrato(v.update_text, '         ') || '         (vuoto)');
            });
        }
        parti.push('');
    });

    parti.push(titoloSezione(3, 'Squadre impiegate'));
    if (squadreImpiegate.size === 0) {
        parti.push('Nessuna squadra assegnata durante questa emergenza.');
    } else {
        const numeroPerReport = new Map(segnalazioni.rows.map(r => [r.id, r.emergency_report_number ?? r.id]));
        const riepilogo = new Map();
        assegnazioni.rows.forEach(a => {
            if (!riepilogo.has(a.nome)) riepilogo.set(a.nome, { prefisso: a.nome_radio, interventi: [], prima: a.assigned_at });
            riepilogo.get(a.nome).interventi.push(`#${numeroPerReport.get(a.report_id) ?? a.report_id}`);
        });
        [...riepilogo.entries()].forEach(([nome, dati]) => {
            parti.push(`${nome}${dati.prefisso && dati.prefisso !== nome ? ` (${dati.prefisso})` : ''} - ${dati.interventi.length} ${dati.interventi.length === 1 ? 'intervento' : 'interventi'}`);
            parti.push(`     Prima assegnazione: ${dataOraResoconto(dati.prima)}`);
            parti.push(testoRientrato(`Segnalazioni: ${dati.interventi.join(', ')}`, '     '));
            parti.push('');
        });
    }

    parti.push(titoloSezione(4, 'Registro delle squadre'));
    parti.push('Entrate e uscite dei volontari dalle squadre durante l\'emergenza.');
    parti.push("All'apertura chi era già in squadra risulta entrato in quel momento;");
    parti.push('alla chiusura tutti risultano usciti, perché il loro impiego in');
    parti.push('questo intervento finisce lì.');
    parti.push('');
    if (registroSquadre.rows.length === 0) {
        parti.push('(nessun movimento registrato)');
    } else {
        const DESCRIZIONE_MOTIVO = {
            apertura_emergenza: " all'apertura dell'emergenza",
            chiusura_emergenza: ' alla chiusura dell\'emergenza',
            squadra_eliminata: ' per scioglimento della squadra'
        };
        registroSquadre.rows.forEach(v => {
            const quando = dataOraResoconto(v.quando);
            const squadra = `${v.nome_radio}${v.squadra_nome ? ` (${v.squadra_nome})` : ''}`;
            const perche = DESCRIZIONE_MOTIVO[v.motivo] || '';
            const daChi = v.eseguita_da ? ` [${v.eseguita_da}]` : '';
            const chi = `${v.nome || ''} ${v.cognome || ''}`.trim() || v.username;
            if (v.azione === 'squadra_eliminata') {
                parti.push(`[${quando}] squadra ${squadra} sciolta${daChi}`);
            } else if (v.azione === 'caposquadra_nominato') {
                parti.push(`[${quando}] ${chi} caposquadra di ${squadra}${perche}${daChi}`);
            } else if (v.azione === 'caposquadra_tolto') {
                parti.push(`[${quando}] ${chi} non è più caposquadra di ${squadra}${daChi}`);
            } else {
                const verbo = v.azione === 'membro_aggiunto' ? 'entra in' : 'esce da';
                parti.push(`[${quando}] ${`${v.nome || ''} ${v.cognome || ''}`.trim() || v.username} ${verbo} ${squadra}${perche}${daChi}`);
            }
        });
    }

    parti.push(titoloSezione(5, 'Mezzi e materiali impiegati'));
    if (materiali.rows.length === 0) {
        parti.push('Nessun movimento di magazzino registrato durante questa emergenza.');
    } else {
        parti.push('Movimenti registrati fra apertura e chiusura dell\'emergenza.');
        parti.push('');
        materiali.rows.forEach(m => {
            const quando = dataOraResoconto(m.quando);
            const quanto = m.gestione === 'quantita' ? ` x${Number(m.quantita)} ${m.unita_misura}` : '';
            const quale = m.matricola ? `${m.bene_denominazione} (${m.matricola})` : m.bene_denominazione;
            const azione = ETICHETTE_MOVIMENTO[m.tipo] || m.tipo;
            const dove = m.destinatario_nome ? ` -> ${m.destinatario_nome}` : '';
            const chi = m.eseguito_da ? ` [${m.eseguito_da}]` : '';
            parti.push(`[${quando}] ${azione}: ${quale}${quanto}${dove}${chi}`);
            if (m.km_registrati) parti.push(`     Chilometri registrati: ${m.km_registrati}`);
            const nota = testoRientrato(m.note, '     ');
            if (nota) parti.push(nota);
        });

        parti.push('');
        if (materialiFuori.rows.length === 0) {
            parti.push('Tutto il materiale impiegato risulta rientrato.');
        } else {

            parti.push('ANCORA FUORI alla data del resoconto:');
            materialiFuori.rows.forEach(b => {
                const quale = b.matricola ? `${b.denominazione} (${b.matricola})` : b.denominazione;
                parti.push(`  - ${quale} presso ${b.destinatario_nome || 'destinatario non indicato'}` +
                           ` dal ${dataOraResoconto(b.ultimo_movimento_il)}`);
            });
        }
    }

    parti.push(titoloSezione(6, 'Documenti allegati'));
    if (documenti.rows.length === 0) {
        parti.push("Nessun documento caricato durante questa emergenza.");
    } else {
        parti.push("I file restano consultabili nell'archivio dell'applicazione.");
        parti.push('');
        documenti.rows.forEach(d => {
            parti.push(`[${dataOraResoconto(d.uploaded_at)}] ${d.original_filename}`);
            parti.push(`     Caricato da: ${(d.autore || '').trim() || 'utente rimosso'}`);
            const descrizione = testoRientrato(d.description, '     ');
            if (descrizione) parti.push(descrizione);
        });
    }

    parti.push(titoloSezione(7, 'Registro delle operazioni'));
    parti.push('Operazioni amministrative registrate nella finestra temporale');
    parti.push("dell'emergenza (gestione squadre, utenti, documenti, impostazioni).");
    parti.push('I DPI, dotazione personale dei volontari, non vi compaiono.');
    parti.push('');
    if (operazioni.rows.length === 0) {
        parti.push('(nessuna operazione registrata)');
    } else {
        operazioni.rows.forEach(o => {
            const bersaglio = o.entity_type ? ` su ${o.entity_type}${o.entity_id ? ` ${o.entity_id}` : ''}` : '';
            parti.push(`[${dataOraResoconto(o.occurred_at)}] ${o.username || 'sistema'} - ${o.action}${bersaglio}`);
            if (o.details) {
                const dettagli = testoRientrato(JSON.stringify(o.details), '     ');
                if (dettagli) parti.push(dettagli);
            }
        });
    }

    if (elementiMappa.length) {
        const ETICHETTE = {
            strada_chiusa: 'Strada chiusa', zona_interdetta: 'Zona interdetta', pericolo_alluvione: 'Pericolo alluvione',
            pericolo_frana: 'Pericolo frana', pericolo_generico: 'Zona di pericolo', area_attesa: 'Area di attesa', area_accoglienza: 'Area di accoglienza',
            area_ammassamento: 'Area di ammassamento', altro: 'Altro'
        };
        parti.push(titoloSezione(8, 'Strade chiuse e zone'));
        elementiMappa.forEach(m => {
            parti.push(`${ETICHETTE[m.tipo] || m.tipo}: ${m.nome || '(senza nome)'}`);
            parti.push(`     Dal .........: ${dataOraResoconto(m.creato_il)}${m.creato_da ? ` (${m.creato_da})` : ''}`);
            parti.push(`     Fino al .....: ${m.rimosso_il ? `${dataOraResoconto(m.rimosso_il)}${m.rimosso_da ? ` (${m.rimosso_da})` : ''}` : m.oltre_emergenza ? 'resta in vigore dopo la chiusura' : 'in vigore alla chiusura'}`);
            const note = testoRientrato(m.note, '     ');
            if (note) parti.push(note);
            parti.push('');
        });
    }

    // Il sigillo dello storico preso alla chiusura (o, per le emergenze
    // chiuse prima che esistesse, quello di adesso): con questa riga si
    // dimostra in seguito che note e diario non sono stati cambiati.
    const sigillo = emergenza.sigillo_chiusura || await sigilloAttuale().then(testoSigillo).catch(() => null);
    if (sigillo) {
        parti.push('');
        parti.push(emergenza.sigillo_chiusura
            ? 'Sigillo dello storico alla chiusura (per verificarlo: ORION, pagina Sistema, "Integrità dello storico"):'
            : 'Sigillo dello storico alla stesura del resoconto (per verificarlo: ORION, pagina Sistema, "Integrità dello storico"):');
        parti.push(sigillo);
    }

    parti.push('');
    parti.push('='.repeat(LARGHEZZA_RESOCONTO));
    parti.push(`Fine del resoconto - ${emergenza.code}`);
    parti.push('='.repeat(LARGHEZZA_RESOCONTO));
    parti.push('');

    return { testo: parti.join('\n'), emergenza };
}

// Scrive il resoconto su disco. Un errore non ferma la chiusura: il resoconto
// si rigenera dall'archivio.

export async function salvaResocontoEmergenza(emergencyId, autore = null) {
    try {
        const risultato = await componiResocontoEmergenza(emergencyId, autore);
        if (!risultato) return null;
        await fs.promises.mkdir(CARTELLA_RESOCONTI, { recursive: true });
        const codiceSicuro = String(risultato.emergenza.code).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'emergenza';
        const marcaTemporale = new Date().toISOString().replace(/[:.]/g, '-');
        const nomeFile = `resoconto_${codiceSicuro}_${marcaTemporale}.txt`;
        const percorso = path.join(CARTELLA_RESOCONTI, nomeFile);
        // Cifrato come gli altri file riservati, se la chiave c'è.
        await fs.promises.writeFile(percorso, cifraturaPronta() ? cifra(Buffer.from(risultato.testo, 'utf8')) : risultato.testo);
        await pool.query(
            'UPDATE emergencies SET log_file_path = $1, log_generated_at = NOW() WHERE id = $2',
            [nomeFile, emergencyId]
        );
        logger.info(`[Resoconto] Scritto resoconto dell'emergenza ${risultato.emergenza.code}: ${nomeFile}`);
        return nomeFile;
    } catch (error) {
        logger.error(`[Resoconto] Impossibile salvare il resoconto dell'emergenza ${emergencyId}:`, error);
        return null;
    }
}
