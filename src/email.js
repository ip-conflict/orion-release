// src/email.js
//
// La posta in uscita, con le impostazioni SMTP prese dal database.

import logger from './logger.js';
import nodemailer from 'nodemailer';
import { pool } from './db.js';

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

// Restituisce { success, error }: un invio fallito non lancia, lo dice.
export async function sendEmailUtility(to, subject, text, html) {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT setting_key, setting_value FROM branding_settings WHERE setting_key LIKE 'smtp_%'");
        const settings = {};
        res.rows.forEach(r => settings[r.setting_key] = r.setting_value);

        if (!settings.smtp_host || !settings.smtp_user) {
            return { success: false, error: "SMTP non configurato nel pannello Impostazioni." };
        }

        const transporter = nodemailer.createTransport({
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

        const info = await transporter.sendMail({
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
        let userFriendlyError = "Errore sconosciuto di rete.";
        if (error.code === 'EENVELOPE') {
            userFriendlyError = "Indirizzo email non valido o rifiutato dal server.";
        } else if (error.code === 'EAUTH') {
            userFriendlyError = "Credenziali SMTP mittente errate (Controlla le impostazioni).";
        } else if (error.code === 'ESOCKET' || error.code === 'ECONNREFUSED') {
            userFriendlyError = "Impossibile connettersi al server SMTP.";
        } else if (error.response) {
            userFriendlyError = `Rifiutato: ${error.response}`;
        }
        return { success: false, error: userFriendlyError };
    } finally {
        client.release();
    }
}
