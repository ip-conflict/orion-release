// src/email.js
//
// La posta in uscita, con le impostazioni SMTP prese dal database.

import logger from './logger.js';
import nodemailer from 'nodemailer';
import { pool } from './db.js';
import { decifraTesto } from './cifratura.js';

// I nomi finiscono nel corpo HTML dei riepiloghi: un < o > non deve diventare markup.
export function escapeHtmlForEmail(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Le impostazioni SMTP salvate nel pannello.
async function leggiConfigSmtp() {
    const res = await pool.query("SELECT setting_key, setting_value FROM branding_settings WHERE setting_key LIKE 'smtp_%'");
    const settings = {};
    res.rows.forEach(r => settings[r.setting_key] = r.setting_value);
    // Nel database è cifrata con la chiave dei dati.
    try {
        if (settings.smtp_pass) settings.smtp_pass = decifraTesto(settings.smtp_pass);
    } catch (e) {
        logger.error('[Email] La password della posta non si decifra (chiave dei dati mancante?):', e.message);
        settings.smtp_pass = '';
    }
    return settings;
}

function creaTrasporto(settings) {
    return nodemailer.createTransport({
        host: settings.smtp_host,
        port: parseInt(settings.smtp_port, 10) || 587,
        secure: settings.smtp_secure === 'true',
        auth: {
            user: settings.smtp_user,
            pass: settings.smtp_pass
        },
        // Un server di posta lento non deve bloccare chi aspetta.
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000
    });
}

// Un errore di nodemailer detto in parole, con il suggerimento per gli
// sbagli piu' comuni (porta e SSL scambiati, password normale su Gmail).
function spiegaErrore(error, settings = {}) {
    const testo = `${error.message || ''} ${error.response || ''}`;
    const porta = parseInt(settings.smtp_port, 10) || 587;
    const ssl = settings.smtp_secure === 'true';
    if (error.code === 'EENVELOPE') return "Indirizzo email non valido o rifiutato dal server.";
    if (error.code === 'EAUTH') {
        if (/application-specific|InvalidSecondFactor|534/i.test(testo) || /gmail|google/i.test(settings.smtp_host || '')) {
            return "Credenziali rifiutate. Con Gmail serve la password per le app di 16 lettere, non la password dell'account, e la verifica in due passaggi deve essere attiva.";
        }
        return "Credenziali SMTP rifiutate: controlla email mittente e password.";
    }
    if (/wrong version number|ssl3_get_record|tls_validate_record_header/i.test(testo)) {
        return `Il server non usa SSL diretto sulla porta ${porta}: metti la sicurezza SSL/TLS su "No". Con la porta 587 la connessione passa comunque a TLS.`;
    }
    if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ENOTFOUND', 'EDNS', 'EAI_AGAIN'].includes(error.code) || /timeout|greeting/i.test(testo)) {
        if (/ENOTFOUND|EAI_AGAIN|EDNS/.test(`${error.code} ${testo}`)) return `Il nome del server "${settings.smtp_host}" non esiste o non si risolve.`;
        if (porta === 465 && !ssl) return "Nessuna risposta: con la porta 465 la sicurezza SSL/TLS va su \"Sì\".";
        return `Impossibile connettersi a ${settings.smtp_host} sulla porta ${porta}. Controlla host e porta; alcuni hosting bloccano le porte della posta in uscita.`;
    }
    if (error.response) return `Rifiutato: ${error.response}`;
    return "Errore sconosciuto di rete.";
}

// Restituisce { success, error }: un invio fallito non lancia, lo dice.
export async function sendEmailUtility(to, subject, text, html) {
    let settings = {};
    try {
        settings = await leggiConfigSmtp();

        if (!settings.smtp_host || !settings.smtp_user) {
            return { success: false, error: "SMTP non configurato nel pannello Impostazioni." };
        }

        const info = await creaTrasporto(settings).sendMail({
            from: `"Sistema ORION" <${settings.smtp_user}>`,
            to: to,
            subject: subject,
            text: text,
            // Senza HTML esplicito l'email parte solo come testo.
            ...(html ? { html } : {})
        });

        if (info.rejected && info.rejected.length > 0) {
            return { success: false, error: `Indirizzo rifiutato dal server destinatario: ${info.rejected.join(', ')}` };
        }

        return { success: true };
    } catch (error) {
        logger.error("Errore SMTP:", error);
        return { success: false, error: spiegaErrore(error, settings) };
    }
}

// L'email di prova del pannello. Le impostazioni arrivano dal modulo, anche
// non ancora salvate: si prova prima di salvare. Un campo vuoto prende il
// valore salvato (la password, di solito). Restituisce anche il testo
// grezzo del server, che aiuta quando il suggerimento non basta.
export async function inviaEmailProva(modulo, destinatario) {
    const salvate = await leggiConfigSmtp();
    const settings = {};
    for (const k of ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass']) {
        const v = typeof modulo?.[k] === 'string' ? modulo[k].trim() : '';
        settings[k] = v || salvate[k] || '';
    }
    if (!settings.smtp_host || !settings.smtp_user) {
        return { success: false, error: "Compila almeno host SMTP ed email mittente." };
    }
    const a = destinatario || settings.smtp_user;
    try {
        const trasporto = creaTrasporto(settings);
        // verify() separa i problemi di connessione e accesso da quelli di invio.
        await trasporto.verify();
        const info = await trasporto.sendMail({
            from: `"Sistema ORION" <${settings.smtp_user}>`,
            to: a,
            subject: '[ORION] Email di prova',
            text: `Questa è un'email di prova del pannello di ORION.\n\nSe la leggi, la posta in uscita funziona: le email di attivazione, di recupero password e gli avvisi delle scadenze partiranno da ${settings.smtp_user}.\n`
        });
        if (info.rejected && info.rejected.length > 0) {
            return { success: false, error: `Indirizzo rifiutato: ${info.rejected.join(', ')}`, a };
        }
        return { success: true, a };
    } catch (error) {
        logger.warn(`[Email di prova] ${error.code || ''} ${error.message}`);
        return { success: false, error: spiegaErrore(error, settings), dettaglio: String(error.response || error.message || '').slice(0, 300), a };
    }
}
