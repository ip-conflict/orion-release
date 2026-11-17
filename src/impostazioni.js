import fs from 'fs';
import logger from './logger.js';
import { registraAudit } from './audit.js';
import { checkAdminRole } from './autenticazione.js';
import { LOGO2_FILE_PATH, LOGO_FILE_PATH, cleanupRejectedFiles, uploadLogo2Multer, uploadLogoMulter, verifySingleUploadedImage } from './caricamenti.js';
import { MINUTI_ATTESA_CRITICA_MAX } from './costanti.js';
import { pool } from './db.js';
import { inviaEmailProva } from './email.js';
import { wss } from './tempoReale.js';
import { dimenticaStatoModuloVoce } from './voce.js';
import { cifraTesto, recuperoSalvato } from './cifratura.js';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { CHIAVI_FIREBASE } from './firebase.js';
import { ModelloNonValido, validaModelloTesserino } from './modelloTesserino.js';
import { DRONE_MAX_DIRETTE_LIMITE } from './drone.js';
import { controlla as controllaAllerta, controllaImpostazioniAllerta } from './allerta.js';

// "45,4064" scritto all'italiana diventava 45 e la mappa si apriva a settanta chilometri.
const LIMITI_MAPPA = {
    map_center_lat: { nome: 'La latitudine del centro della mappa', minimo: -90, massimo: 90 },
    map_center_lon: { nome: 'La longitudine del centro della mappa', minimo: -180, massimo: 180 },
    map_zoom_level: { nome: 'Il livello di zoom della mappa', minimo: 1, massimo: 18, intero: true }
};

// Ogni impostazione che si scrive da qui ha il suo tipo: una chiave inventata o un valore storto
// (porta "abc", un nome di 5000 caratteri, una configurazione della Segreteria rotta) portava ORION
// in uno stato da cui alcune pagine rispondevano 500.
const SI_NO = new Set(['primi_passi_nascosti', 'drone_enabled', 'magazzino_enabled', 'funzioni_enabled', 'attivita_enabled', 'voce_enabled', 'badge_qr_enabled',
    'badge_qr_always_on', 'badge_cf_barcode', 'app_android_enabled', 'smtp_secure']);
const TESTI = { association_name: 120, card_district_label: 150, card_regional_entity_name: 150, smtp_user: 254, smtp_pass: 512 };
const TASTI_VOCE = new Set(['F9', 'F2', 'F4', 'F8', 'Pause', 'ScrollLock', 'Insert']);
const CONTROLLATE_ALTROVE = new Set(['badge_modello', 'allerta_regione', 'allerta_comune', 'allerta_avvisa_da']);
const CAMPI_SEGRETERIA_SI_NO = ['enabled', 'block_on_medical', 'block_on_course', 'notify_user', 'notify_admin'];
const EMAIL_VALIDA = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function configSegreteriaValida(valore) {
    let config = valore;
    if (typeof valore === 'string') {
        try { config = JSON.parse(valore); } catch { return { errore: 'La configurazione della Segreteria non è un JSON valido.' }; }
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) return { errore: 'La configurazione della Segreteria non è valida.' };
    for (const [campo, v] of Object.entries(config)) {
        if (CAMPI_SEGRETERIA_SI_NO.includes(campo)) {
            if (typeof v !== 'boolean') return { errore: `Segreteria: ${campo} deve essere vero o falso.` };
        } else if (campo === 'custom_emails') {
            if (typeof v !== 'string' || v.length > 2000) return { errore: 'Segreteria: gli indirizzi in più sono un testo separato da virgole.' };
            const sbagliato = v.split(',').map(e => e.trim()).filter(Boolean).find(e => !EMAIL_VALIDA.test(e));
            if (sbagliato) return { errore: `Segreteria: "${sbagliato.slice(0, 100)}" non è un indirizzo email valido.` };
        } else if (campo === 'notice_days') {
            if (!Array.isArray(v) || v.length > 20 || !v.every(n => Number.isInteger(n) && n >= 0 && n <= 365)) {
                return { errore: 'Segreteria: i giorni di preavviso sono numeri interi fra 0 e 365.' };
            }
        } else if (campo === 'custom_user_email_template') {
            if (typeof v !== 'string' || v.length > 5000) return { errore: 'Segreteria: il testo dell\'email arriva al massimo a 5000 caratteri.' };
        } else {
            return { errore: `Segreteria: campo sconosciuto "${String(campo).slice(0, 60)}".` };
        }
    }
    return { valore: JSON.stringify(config) };
}

// Restituisce { valore } da salvare o { errore }. La stringa vuota vale "valore predefinito".
function impostazioneValida(chiave, valore) {
    if (CONTROLLATE_ALTROVE.has(chiave)) return { valore };
    if (chiave === 'segreteria_config') return valore === '' ? { valore } : configSegreteriaValida(valore);
    if (typeof valore === 'boolean' && SI_NO.has(chiave)) return { valore: String(valore) };
    if (valore === null || valore === undefined || (typeof valore !== 'string' && typeof valore !== 'number')) {
        return { errore: `${chiave}: valore mancante o di un tipo non ammesso.` };
    }
    const testo = String(valore).trim();
    if (testo === '' && chiave !== 'smtp_pass') {
        if (SI_NO.has(chiave) || Object.hasOwn(TESTI, chiave) || Object.hasOwn(LIMITI_MAPPA, chiave)
            || ['minuti_attesa_critica', 'drone_max_dirette', 'voce_tasto', 'smtp_host', 'smtp_port'].includes(chiave)) return { valore: '' };
    }
    if (SI_NO.has(chiave)) return ['true', 'false'].includes(testo) ? { valore: testo } : { errore: `${chiave} vale true o false.` };
    if (Object.hasOwn(TESTI, chiave)) {
        const testoPieno = chiave === 'smtp_pass' ? String(valore) : testo;
        return testoPieno.length <= TESTI[chiave] ? { valore: testoPieno } : { errore: `${chiave}: al massimo ${TESTI[chiave]} caratteri.` };
    }
    if (Object.hasOwn(LIMITI_MAPPA, chiave)) {
        const { nome, minimo, massimo, intero } = LIMITI_MAPPA[chiave];
        const numero = Number(testo.replace(',', '.'));
        if (!Number.isFinite(numero) || numero < minimo || numero > massimo || (intero && !Number.isInteger(numero))) {
            return { errore: `${nome} deve essere un numero${intero ? ' intero' : ''} fra ${minimo} e ${massimo}.` };
        }
        return { valore: String(numero) };
    }
    // Un valore assurdo spegnerebbe il segnale di ritardo in sala.
    if (chiave === 'minuti_attesa_critica') {
        const minuti = Number(testo);
        return Number.isInteger(minuti) && minuti >= 1 && minuti <= MINUTI_ATTESA_CRITICA_MAX ? { valore: String(minuti) }
            : { errore: `I minuti di attesa prima della segnalazione in ritardo devono essere un numero intero fra 1 e ${MINUTI_ATTESA_CRITICA_MAX}.` };
    }
    if (chiave === 'drone_max_dirette') {
        const quanti = Number(testo);
        return Number.isInteger(quanti) && quanti >= 1 && quanti <= DRONE_MAX_DIRETTE_LIMITE ? { valore: String(quanti) }
            : { errore: `I droni in onda insieme sono un numero intero fra 1 e ${DRONE_MAX_DIRETTE_LIMITE}.` };
    }
    if (chiave === 'voce_tasto') return TASTI_VOCE.has(testo) ? { valore: testo } : { errore: `Il tasto PARLA è uno fra ${[...TASTI_VOCE].join(', ')}.` };
    if (chiave === 'smtp_host') {
        return testo.length <= 253 && /^[A-Za-z0-9.\-]+$|^\[?[0-9A-Fa-f:.]+\]?$/.test(testo) ? { valore: testo }
            : { errore: 'Il server della posta è un nome come smtp.gmail.com o un indirizzo, senza spazi.' };
    }
    if (chiave === 'smtp_port') {
        const porta = Number(testo);
        return Number.isInteger(porta) && porta >= 1 && porta <= 65535 ? { valore: String(porta) } : { errore: 'La porta della posta è un numero fra 1 e 65535.' };
    }
    return { errore: `Impostazione sconosciuta: ${chiave}.` };
}

export function registraRotteImpostazioni(app) {

    app.post('/api/branding/logo', checkAdminRole, uploadLogoMulter.single('logoFile'), async (req, res) => {

        if (req.fileValidationError) {
            return res.status(400).json({ message: req.fileValidationError });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Nessun file immagine valido caricato.' });
        }
        if (!(await verifySingleUploadedImage(req, res, ['image/jpeg', 'image/png', 'image/gif']))) return;

        try {
            await fs.promises.rename(req.file.path, LOGO_FILE_PATH);
        } catch (error) {
            logger.error('Errore sostituzione del file logo:', error);
            cleanupRejectedFiles([req.file]);
            return res.status(500).json({ message: 'Errore interno durante il salvataggio del logo.' });
        }

        logger.info(`Admin ${req.user.username} ha aggiornato il logo del cliente.`);

        res.status(200).json({ message: 'Logo aggiornato con successo.' });


        wss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                try {
                    client.send(JSON.stringify({ action: 'branding_updated' }));
                } catch (e) { logger.error('WS Send Error (branding_updated):', e); }
            }
        });
    });

    app.post('/api/branding/logo2', checkAdminRole, uploadLogo2Multer.single('logoFile'), async (req, res) => {
        if (req.fileValidationError) {
            return res.status(400).json({ message: req.fileValidationError });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'Nessun file immagine valido caricato.' });
        }
        if (!(await verifySingleUploadedImage(req, res, ['image/jpeg', 'image/png', 'image/gif']))) return;

        try {
            await fs.promises.rename(req.file.path, LOGO2_FILE_PATH);
        } catch (error) {
            logger.error('Errore sostituzione del file logo2:', error);
            cleanupRejectedFiles([req.file]);
            return res.status(500).json({ message: 'Errore interno durante il salvataggio del logo.' });
        }

        logger.info(`Admin ${req.user.username} ha aggiornato il logo secondario (ente sovraordinato).`);

        res.status(200).json({ message: 'Logo secondario aggiornato con successo.' });

        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                try {
                    client.send(JSON.stringify({ action: 'branding_updated' }));
                } catch (e) { logger.error('WS Send Error (branding_updated):', e); }
            }
        });
    });

    app.get('/api/branding/settings/full', checkAdminRole, async (req, res) => {
        try {
            const result = await pool.query('SELECT setting_key, setting_value FROM branding_settings');
            const settings = result.rows.reduce((acc, row) => {
                acc[row.setting_key] = row.setting_value;
                return acc;
            }, {});
            // La password della posta non torna al browser.
            settings.smtp_pass_impostata = !!settings.smtp_pass;
            delete settings.smtp_pass;
            for (const k of CHIAVI_FIREBASE) delete settings[k];
            res.status(200).json(settings);
        } catch (error) {
            logger.error("Errore durante il recupero delle impostazioni complete di branding:", error);
            res.status(500).json({ message: "Errore interno del server." });
        }
    });

    // Lo stato degli aggiornamenti porta l'indirizzo del pacchetto: lo scrive solo la pagina Sistema.
    const CHIAVI_INTERNE = new Set(['aggiornamenti_config', 'aggiornamenti_stato', 'cifratura_impronta', 'cifratura_recupero_salvata',
        'smtp_pass_impostata', 'privacy_versione', 'privacy_pubblicata_il', ...CHIAVI_FIREBASE]);

    const LOGO_DI_SERIE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'logo.png');
    const impronta = async (file) => crypto.createHash('sha256').update(await fs.promises.readFile(file)).digest('hex');
    async function logoCaricato() {
        try {
            return (await impronta(LOGO_FILE_PATH)) !== (await impronta(LOGO_DI_SERIE));
        } catch {
            return false;
        }
    }

    app.get('/api/admin/primi-passi', checkAdminRole, async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT setting_key, setting_value FROM branding_settings
                  WHERE setting_key = ANY($1::text[])`, [['association_name', 'map_center_lat', 'smtp_host', 'smtp_user', 'primi_passi_nascosti']]);
            const imp = Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value]));
            const altre = (await pool.query(
                `SELECT count(*)::int AS n FROM users WHERE id <> $1 AND eliminato_il IS NULL AND COALESCE(temporaneo, false) = false`, [req.user.id])).rows[0].n;
            const passi = [
                { codice: 'nome', testo: "Scrivi il nome dell'associazione", fatto: !!imp.association_name?.trim(), dove: '/admin/dashboard-admin.html#sez-associazione' },
                { codice: 'logo', testo: 'Carica il logo', fatto: await logoCaricato(), dove: '/admin/dashboard-admin.html#sez-associazione' },
                { codice: 'mappa', testo: 'Scegli il centro della mappa', fatto: !!imp.map_center_lat?.trim(), dove: '/admin/dashboard-admin.html#sez-mappa' },
                { codice: 'posta', testo: 'Configura la posta', fatto: !!(imp.smtp_host?.trim() && imp.smtp_user?.trim()), dove: '/admin/dashboard-admin.html#sez-posta' },
                { codice: 'persone', testo: 'Iscrivi almeno un\'altra persona', fatto: altre > 0, dove: '/admin/admin.html' },
                { codice: 'chiave', testo: 'Metti da parte la chiave di recupero della cifratura', fatto: await recuperoSalvato(), dove: '/admin/sistema.html' }
            ];
            res.json({ nascosto: imp.primi_passi_nascosti === 'true', passi });
        } catch (e) {
            logger.error('Errore GET /api/admin/primi-passi:', e);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.put('/api/branding/settings', checkAdminRole, async (req, res) => {
        const settingsToUpdate = req.body;
        if (!settingsToUpdate || typeof settingsToUpdate !== 'object' || Array.isArray(settingsToUpdate)) {
            return res.status(400).json({ message: 'Impostazioni non valide.' });
        }
        const chiaviRifiutate = Object.keys(settingsToUpdate)
            .filter(k => CHIAVI_INTERNE.has(k) || !/^[a-z0-9_]{1,64}$/.test(k));
        if (chiaviRifiutate.length > 0) {
            return res.status(400).json({ message: `Impostazioni non modificabili da qui: ${chiaviRifiutate.join(', ')}.` });
        }
        const valori = {};
        for (const [chiave, valore] of Object.entries(settingsToUpdate)) {
            const esito = impostazioneValida(chiave, valore);
            if (esito.errore) return res.status(400).json({ message: esito.errore });
            valori[chiave] = esito.valore;
        }
        const regioneSalvata = (await pool.query(
            "SELECT setting_value FROM branding_settings WHERE setting_key = 'allerta_regione'").catch(() => ({ rows: [] }))).rows[0]?.setting_value || '';
        const erroreAllerta = controllaImpostazioniAllerta(settingsToUpdate, regioneSalvata);
        if (erroreAllerta) return res.status(400).json({ message: erroreAllerta });
        const client = await pool.connect();

        try {
            await client.query('BEGIN');


            for (const key of Object.keys(valori)) {
                let value = valori[key];
                if (key === 'smtp_pass') {
                    if (value == null || String(value).trim() === '') continue;
                    value = cifraTesto(String(value));
                }
                if (key === 'badge_modello') {
                    try {
                        value = validaModelloTesserino(value);
                    } catch (e) {
                        if (!(e instanceof ModelloNonValido)) throw e;
                        await client.query('ROLLBACK');
                        return res.status(400).json({ message: e.message });
                    }
                }
                const upsertQuery = `
                INSERT INTO branding_settings (setting_key, setting_value, updated_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (setting_key)
                DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW();
            `;
                await client.query(upsertQuery, [key, value]);
            }

            await client.query('COMMIT');
            if ('voce_enabled' in settingsToUpdate) dimenticaStatoModuloVoce();
            logger.info(`Admin ${req.user.username} ha aggiornato le impostazioni di branding.`);

            res.status(200).json({ message: 'Impostazioni aggiornate con successo.' });
            // Non si registrano i valori: fra le impostazioni ci sono le credenziali SMTP.
            registraAudit(req, 'impostazioni.modificate', { tipo: 'impostazioni', dettagli: { chiavi: Object.keys(settingsToUpdate) } });
            if (settingsToUpdate.allerta_regione && settingsToUpdate.allerta_regione !== regioneSalvata) controllaAllerta({ forza: true });

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error("Errore durante l'aggiornamento delle impostazioni di branding:", error);
            res.status(500).json({ message: "Errore interno durante l'aggiornamento." });
        } finally {
            client.release();
        }
    });
    app.post('/api/admin/email-prova', checkAdminRole, async (req, res) => {
        const corpo = (req.body && typeof req.body === 'object') ? req.body : {};
        let a = typeof corpo.a === 'string' ? corpo.a.trim() : '';
        if (a && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) {
            return res.status(400).json({ message: "L'indirizzo a cui mandare la prova non è valido." });
        }
        try {
            if (!a) {
                const r = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
                a = r.rows[0]?.email || '';
            }
            const esito = await inviaEmailProva(corpo, a);
            logger.info(`Admin ${req.user.username}: email di prova a ${esito.a || '-'} ${esito.success ? 'partita' : 'fallita'}.`);
            if (!esito.success) return res.status(422).json({ message: esito.error, dettaglio: esito.dettaglio });
            res.json({ message: `Email di prova inviata a ${esito.a}. Controlla la casella, anche nello spam.` });
        } catch (error) {
            logger.error("Errore durante l'email di prova:", error);
            res.status(500).json({ message: 'Errore interno del server.' });
        }
    });

    app.get('/api/admin/audit-log', checkAdminRole, async (req, res) => {
        const pagina = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const perPagina = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = (pagina - 1) * perPagina;

        const condizioni = [];
        const parametri = [];
        if (req.query.action) {
            parametri.push(String(req.query.action));
            condizioni.push(`action = $${parametri.length}`);
        }
        if (req.query.username) {
            parametri.push(String(req.query.username));
            condizioni.push(`username = $${parametri.length}`);
        }
        const dove = condizioni.length > 0 ? `WHERE ${condizioni.join(' AND ')}` : '';

        try {
            const conteggio = await pool.query(`SELECT COUNT(*) FROM audit_log ${dove}`, parametri);
            const totale = parseInt(conteggio.rows[0].count, 10);

            const risultato = await pool.query(
                `SELECT id, occurred_at, user_id, username, action, entity_type, entity_id, details, ip_address
             FROM audit_log ${dove}
             ORDER BY occurred_at DESC, id DESC
             LIMIT $${parametri.length + 1} OFFSET $${parametri.length + 2}`,
                [...parametri, perPagina, offset]
            );

            res.status(200).json({
                entries: risultato.rows,
                pagination: { currentPage: pagina, totalPages: Math.ceil(totale / perPagina), totalEntries: totale, limit: perPagina }
            });
        } catch (error) {
            logger.error('Errore GET /api/admin/audit-log:', error);
            res.status(500).json({ message: 'Errore nel recupero del registro operazioni.' });
        }
    });
}
