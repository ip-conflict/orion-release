// Il giro quotidiano: avvisi di scadenza, report mensile, riepiloghi per
// segreteria e magazzino, pulizia dei token revocati.

import logger from './logger.js';
import { dataItaliana, oggiLocale } from './date.js';
import { pool } from './db.js';
import { escapeHtmlForEmail, sendEmailUtility } from './email.js';
import { magazzino } from './istanze.js';
import { notifiche } from './tempoReale.js';
import { pulisciTokenAvvisi } from './avvisi.js';
import { sqlHaPermesso } from './permessi.js';

// I riepiloghi nell'app di chi fa la segreteria e di chi tiene il magazzino
// (gli amministratori li ricevono entrambi). Uno solo valido alla volta, e
// solo se i numeri sono cambiati: un avviso identico ogni mattina non si legge.
async function accodaRiepiloghi(segreteriaAttiva) {
    // Chi ha il permesso, dal ruolo o in più (permessi.js).
    async function aChi(permesso) {
        const chi = sqlHaPermesso(permesso, 1);
        const { rows } = await pool.query(
            `SELECT u.id FROM users u WHERE COALESCE(u.is_active, true) = true AND u.eliminato_il IS NULL AND ${chi.condizione}`, chi.parametri);
        return rows.map(r => r.id);
    }
    async function accoda(permesso, tipo, titolo, testo, riferimento) {
        for (const id of await aChi(permesso)) {
            const uguale = await pool.query(
                `SELECT 1 FROM notifiche WHERE user_id = $1 AND tipo = $2 AND testo = $3
                   AND (scade_il IS NULL OR scade_il > NOW())`, [id, tipo, testo]);
            if (uguale.rowCount) continue;
            // Via il vecchio: la chiave del giorno torna libera.
            await pool.query('DELETE FROM notifiche WHERE user_id = $1 AND tipo = $2', [id, tipo]);
            await notifiche.notifica(id, { tipo, titolo, testo, riferimento, chiave: `${tipo}:${oggiLocale()}`, oreValidita: 24 * 7 });
        }
    }
    try {
        if (segreteriaAttiva) {
            const { rows: [c] } = await pool.query(`
                WITH attivi AS (
                    SELECT u.id FROM users u
                    WHERE COALESCE(u.is_active, true) = true
                      AND NOT EXISTS (SELECT 1 FROM utenti_ruoli ur WHERE ur.user_id = u.id AND ur.ruolo = 'esterno')
                ), visite AS (
                    SELECT a.id FROM attivi a
                    LEFT JOIN LATERAL (SELECT expiry_date, status FROM user_medical_records
                                       WHERE user_id = a.id ORDER BY last_visit_date DESC LIMIT 1) v ON true
                    WHERE v.expiry_date IS NULL OR v.expiry_date::date <= CURRENT_DATE + 30 OR v.status <> 'Idoneo'
                ), corsi AS (
                    SELECT DISTINCT ON (uc.user_id, uc.course_id) uc.user_id, uc.expiry_date
                    FROM user_courses uc JOIN attivi a ON a.id = uc.user_id
                    ORDER BY uc.user_id, uc.course_id, uc.acquisition_date DESC
                )
                SELECT (SELECT COUNT(*) FROM visite)::int AS visite,
                       (SELECT COUNT(*) FROM corsi WHERE expiry_date IS NOT NULL AND expiry_date::date <= CURRENT_DATE + 30)::int AS corsi,
                       (SELECT COUNT(DISTINCT id) FROM (SELECT id FROM visite UNION
                            SELECT user_id FROM corsi WHERE expiry_date IS NOT NULL AND expiry_date::date <= CURRENT_DATE + 30) p)::int AS persone`);
            if (c.persone > 0) {
                await accoda('volontari.sanitario', 'segreteria_riepilogo',
                    `Segreteria: ${c.persone} ${c.persone === 1 ? 'volontario' : 'volontari'} da sistemare`,
                    `${c.visite} ${c.visite === 1 ? 'visita' : 'visite'} e ${c.corsi} ${c.corsi === 1 ? 'corso' : 'corsi'} da rinnovare, scaduti o mancanti.`,
                    { tipo: 'segreteria', id: null });
            } else {
                await notifiche.scadi({ tipo: 'segreteria_riepilogo' });
            }
        }
        const m = await magazzino.riepilogoNotifica();
        if (m && (m.scadenze || m.fuori)) {
            const parti = [];
            if (m.scadenze) parti.push(`${m.scadenze} ${m.scadenze === 1 ? 'scadenza' : 'scadenze'} entro un mese`);
            if (m.fuori) parti.push(`${m.fuori} ${m.fuori === 1 ? 'oggetto fuori' : 'oggetti fuori'} da troppo tempo`);
            await accoda('magazzino.gestione', 'magazzino_riepilogo',
                `Magazzino: ${m.scadenze + m.fuori} ${m.scadenze + m.fuori === 1 ? 'cosa' : 'cose'} da guardare`,
                `${parti.join(', ')}.`, { tipo: 'magazzino', id: null });
        } else if (m) {
            await notifiche.scadi({ tipo: 'magazzino_riepilogo' });
        }
    } catch (e) {
        logger.error('[Notifiche] Riepiloghi di segreteria e magazzino non riusciti:', e);
    }
}

// Gira all'avvio e ogni ora, e lavora una volta al giorno. soloReport: solo il
// riepilogo alla segreteria, subito (il pulsante delle impostazioni), senza
// rimandare ai volontari gli avvisi di oggi. Restituisce com'è andato il riepilogo.
export async function runDailyExpiryCheck(forceAdminReport = false, { soloReport = false } = {}) {
    const esitoReport = { destinatari: 0, inviati: 0, falliti: 0, elencati: 0, segreteria_attiva: false, errore: null };
    let client;
    try {
        client = await pool.connect();
        const today = new Date();

        const todayStr = oggiLocale();
        const isFirstOfMonth = today.getDate() === 1;

        const lastRunRes = await client.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'last_cron_run'");
        if (!forceAdminReport && lastRunRes.rowCount > 0 && lastRunRes.rows[0].setting_value === todayStr) {
            return;
        }

        const confRes = await client.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'segreteria_config'");
        const configGrezza = confRes.rowCount > 0 ? confRes.rows[0].setting_value : null;
        const config = !configGrezza ? null
            : (typeof configGrezza === 'string' ? JSON.parse(configGrezza) : configGrezza);
        // Gli avvisi del magazzino partono anche con la segreteria spenta.
        const segreteriaAttiva = !!config?.enabled;
        esitoReport.segreteria_attiva = segreteriaAttiva;

        logger.info(`Avvio controllo scadenze... (Segreteria: ${segreteriaAttiva ? 'sì' : 'no'}, Giorno 1 del mese: ${isFirstOfMonth}, Forzato: ${forceAdminReport})`);

        if (segreteriaAttiva) {

            // Avvisi ai volontari: le soglie (di norma 30, 15 e 0 giorni) superate
            // dall'ultima esecuzione, così un giorno di fermo si recupera.
            const giorniPreavviso = Array.isArray(config.notice_days) && config.notice_days.length
                ? [...new Set(config.notice_days.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n >= 0 && n <= 365))]
                : [30, 15, 0];
            const ultimaEsecuzione = lastRunRes.rowCount > 0 ? lastRunRes.rows[0].setting_value : null;
            let giorniDaUltimaEsecuzione = 1;
            if (ultimaEsecuzione) {
                const trascorsi = Math.round((today - new Date(ultimaEsecuzione)) / 86400000);
                // Dopo un mese di fermo si riparte, senza arretrati.
                if (Number.isFinite(trascorsi)) giorniDaUltimaEsecuzione = Math.min(30, Math.max(1, trascorsi));
            }

            let avvisiInviati = 0;
            let avvisiFalliti = 0;
            let primoErrore = null;
            if (config.notify_user && !soloReport) {
                const coursesQuery = `
                    SELECT u.id AS user_id, 'corso' AS genere, uc.id AS voce_id,
                           u.nome, u.cognome, u.email, cc.name as item_name, uc.expiry_date::DATE, (uc.expiry_date::DATE - CURRENT_DATE) as days_left
                    FROM user_courses uc JOIN users u ON uc.user_id = u.id JOIN courses_catalog cc ON uc.course_id = cc.id
                    WHERE u.is_active = true AND u.role != 'esterno'
                    AND EXISTS (
                        SELECT 1 FROM unnest($1::int[]) AS soglia
                        WHERE (uc.expiry_date::DATE - CURRENT_DATE) <= soglia
                          AND (uc.expiry_date::DATE - CURRENT_DATE) + $2::int > soglia
                    )
                `;
                const medicalQuery = `
                    SELECT u.id AS user_id, 'visita' AS genere, mr.id AS voce_id,
                           u.nome, u.cognome, u.email, 'Visita Medica' as item_name, mr.expiry_date::DATE, (mr.expiry_date::DATE - CURRENT_DATE) as days_left
                    FROM users u JOIN LATERAL (SELECT id, expiry_date FROM user_medical_records WHERE user_id = u.id ORDER BY last_visit_date DESC LIMIT 1) mr ON true
                    WHERE u.is_active = true AND u.role != 'esterno'
                    AND EXISTS (
                        SELECT 1 FROM unnest($1::int[]) AS soglia
                        WHERE (mr.expiry_date::DATE - CURRENT_DATE) <= soglia
                          AND (mr.expiry_date::DATE - CURRENT_DATE) + $2::int > soglia
                    )
                `;
                const parametriSoglie = [giorniPreavviso, giorniDaUltimaEsecuzione];
                const userExpiring = [
                    ...(await client.query(coursesQuery, parametriSoglie)).rows,
                    ...(await client.query(medicalQuery, parametriSoglie)).rows
                ];


                const defaultTemplate = "Ciao {NOME},\n\nTi informiamo che il tuo requisito '{REQUISITO}' è in scadenza il giorno {SCADENZA}.\n\nTi preghiamo di contattare il coordinatore o la segreteria per organizzare il rinnovo.\n\nSaluti,\nLa Segreteria";
                const templateString = config.custom_user_email_template || defaultTemplate;

                for (const item of userExpiring) {
                    // Anche nell'app, anche a chi non ha email. Il titolo non
                    // dice cosa scade (finisce sulla schermata di blocco); la
                    // chiave con la soglia evita i doppioni nello stesso giorno.
                    const soglia = Math.min(...giorniPreavviso.filter(g => g >= item.days_left));
                    const scadenzaIso = item.expiry_date;
                    // Sostituisce quello della soglia precedente; dopo un mese sparisce.
                    const radice = `scadenza:${item.genere}:${item.voce_id}:${scadenzaIso}:`;
                    const nuova = await notifiche.notifica(item.user_id, {
                        tipo: 'scadenza',
                        titolo: item.days_left <= 0 ? 'Hai una scadenza oggi' : 'Hai una scadenza in arrivo',
                        testo: `${item.item_name}: scade il ${dataItaliana(item.expiry_date)}.`,
                        riferimento: { tipo: 'libretto', id: item.user_id },
                        chiave: `${radice}${soglia}`,
                        oreValidita: 24 * 30
                    });
                    if (nuova) {
                        await pool.query(
                            `UPDATE notifiche SET scade_il = NOW() WHERE user_id = $1 AND chiave LIKE $2 || '%' AND id <> $3
                               AND (scade_il IS NULL OR scade_il > NOW())`, [item.user_id, radice, nuova.id]);
                    }

                    if (item.email) {
                        const formattedDate = dataItaliana(item.expiry_date);
                    

                        let msgText = templateString
                            .replace(/{NOME}/g, item.nome)
                            .replace(/{COGNOME}/g, item.cognome)
                            .replace(/{REQUISITO}/g, item.item_name)
                            .replace(/{SCADENZA}/g, formattedDate);

                        // Prima l'escape, poi gli a capo in <br>.
                        const msgHtml = `<div style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">${escapeHtmlForEmail(msgText).replace(/\n/g, '<br>')}</div>`;

                        const esito = await sendEmailUtility(
                            item.email,
                            `[ORION] Avviso Scadenza Requisito: ${item.item_name}`,
                            msgText,
                            msgHtml
                        );
                        if (esito?.success) avvisiInviati++;
                        else {
                            avvisiFalliti++;
                            primoErrore = primoErrore || esito?.error || 'errore sconosciuto';
                        }
                    }
                }
                // Nel log quante sono partite davvero.
                if (avvisiInviati || avvisiFalliti) {
                    const riepilogo = `Avvisi di scadenza ai volontari: ${avvisiInviati} inviati, ${avvisiFalliti} non inviati.`;
                    if (avvisiFalliti > 0) logger.error(`${riepilogo} Primo errore: ${primoErrore}`);
                    else logger.info(riepilogo);
                }
            }

            // Report mensile alla segreteria: tre mesi indietro e tre avanti.
            if ((isFirstOfMonth || forceAdminReport) && (config.notify_admin || config.custom_emails)) {
                let adminEmails = [];
                if (config.notify_admin) {
                    const chi = sqlHaPermesso('volontari.sanitario', 1);
                    const admins = await client.query(`
                        SELECT DISTINCT u.email FROM users u
                        WHERE ${chi.condizione} AND u.is_active = true AND u.email IS NOT NULL`, chi.parametri);
                    adminEmails = admins.rows.map(a => a.email);
                }
                if (config.custom_emails) {
                    adminEmails = [...adminEmails, ...config.custom_emails.split(',').map(e => e.trim()).filter(e => e)];
                }
                adminEmails = [...new Set(adminEmails)];
                esitoReport.destinatari = adminEmails.length;

                if (adminEmails.length > 0) {
                    const adminQueryCourses = `
                        SELECT u.nome, u.cognome, cc.name as item_name, uc.expiry_date::DATE, (uc.expiry_date::DATE - CURRENT_DATE) as days_left
                        FROM user_courses uc JOIN users u ON uc.user_id = u.id JOIN courses_catalog cc ON uc.course_id = cc.id
                        WHERE u.is_active = true AND u.role != 'esterno'
                        AND uc.expiry_date::DATE >= CURRENT_DATE - INTERVAL '3 months'
                        AND uc.expiry_date::DATE <= CURRENT_DATE + INTERVAL '3 months'
                    `;
                    const adminQueryVisits = `
                        SELECT u.nome, u.cognome, 'Visita Medica' as item_name, mr.expiry_date::DATE, (mr.expiry_date::DATE - CURRENT_DATE) as days_left
                        FROM users u JOIN LATERAL (SELECT expiry_date FROM user_medical_records WHERE user_id = u.id ORDER BY last_visit_date DESC LIMIT 1) mr ON true
                        WHERE u.is_active = true AND u.role != 'esterno'
                        AND mr.expiry_date::DATE >= CURRENT_DATE - INTERVAL '3 months'
                        AND mr.expiry_date::DATE <= CURRENT_DATE + INTERVAL '3 months'
                    `;
                    let adminExpiring = [...(await client.query(adminQueryCourses)).rows, ...(await client.query(adminQueryVisits)).rows];


                    adminExpiring.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
                    esitoReport.elencati = adminExpiring.length;

                    if (adminExpiring.length > 0) {
                        let htmlRows = '';
                        adminExpiring.forEach(item => {
                            let color = '#10b981';
                            let statusText = `Tra ${item.days_left} gg`;
                        
                            if (item.days_left < 0) {
                                color = '#ef4444';
                                statusText = `Scaduto da ${Math.abs(item.days_left)} gg`;
                            } else if (item.days_left === 0) {
                                color = '#ef4444';
                                statusText = 'SCADE OGGI';
                            } else if (item.days_left <= 30) {
                                color = '#f59e0b';
                            }

                            const dateStr = dataItaliana(item.expiry_date);

                            htmlRows += `
                                <tr>
                                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #1e293b;"><strong>${escapeHtmlForEmail(item.nome)} ${escapeHtmlForEmail(item.cognome)}</strong></td>
                                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #334155;">${escapeHtmlForEmail(item.item_name)}</td>
                                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #64748b;">${escapeHtmlForEmail(dateStr)}</td>
                                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: ${color}; text-align: right;">${escapeHtmlForEmail(statusText)}</td>
                                </tr>
                            `;
                        });

                        const htmlBody = `
                            <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                                <h2 style="color: #3b82f6; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Report Operativo Mensile Segreteria</h2>
                                <p style="color: #334155;">Riepilogo dei requisiti operativi dei volontari scaduti negli <strong>ultimi 3 mesi</strong> e in scadenza nei <strong>prossimi 3 mesi</strong>.</p>
                            
                                <table style="width: 100%; border-collapse: collapse; margin-top: 20px; text-align: left; font-size: 0.95rem;">
                                    <thead style="background-color: #f8fafc;">
                                        <tr>
                                            <th style="padding: 12px 10px; border-bottom: 2px solid #cbd5e1; color: #64748b;">Volontario</th>
                                            <th style="padding: 12px 10px; border-bottom: 2px solid #cbd5e1; color: #64748b;">Requisito</th>
                                            <th style="padding: 12px 10px; border-bottom: 2px solid #cbd5e1; color: #64748b;">Data</th>
                                            <th style="padding: 12px 10px; border-bottom: 2px solid #cbd5e1; color: #64748b; text-align: right;">Stato</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${htmlRows}
                                    </tbody>
                                </table>
                                <p style="font-size: 0.85rem; color: #94a3b8; margin-top: 30px; text-align: center;">Generato dal Sistema Informatico ORION</p>
                            </div>
                        `;

                        let reportInviati = 0;
                        let reportFalliti = 0;
                        let erroreReport = null;
                        for (const email of adminEmails) {
                            const esito = await sendEmailUtility(email, "[ORION] Report Mensile Scadenze Operative", "Riepilogo Scadenze. Apri in un client HTML.", htmlBody);
                            if (esito?.success) reportInviati++;
                            else { reportFalliti++; erroreReport = erroreReport || esito?.error || 'errore sconosciuto'; }
                        }
                        Object.assign(esitoReport, { inviati: reportInviati, falliti: reportFalliti, errore: erroreReport });
                        const riepilogoReport = `Report mensile scadenze: ${reportInviati} inviati, ${reportFalliti} non inviati (${adminExpiring.length} requisiti elencati).`;
                        if (reportFalliti > 0) logger.error(`${riepilogoReport} Primo errore: ${erroreReport}`);
                        else logger.info(riepilogoReport);
                    }
                }
            }
        }

        // Gli avvisi del magazzino, a chi li ha chiesti. Un errore qui non
        // impedisce di segnare il giro di oggi come fatto.
        try {
            if (!soloReport) await magazzino.inviaAvvisiScadenze();
            if (!soloReport) await accodaRiepiloghi(segreteriaAttiva);
        } catch (erroreMagazzino) {
            logger.error('[Magazzino] Invio degli avvisi di scadenza non riuscito:', { error: erroreMagazzino.message });
        }


        if (!forceAdminReport) {
            await client.query("INSERT INTO branding_settings (setting_key, setting_value) VALUES ('last_cron_run', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1", [todayStr]);
        }
        logger.info("Controllo scadenze completato.");
        return esitoReport;

    } catch (error) {
        logger.error("Errore durante il cron delle scadenze:", error);
    } finally {
        if (client) client.release();
    }
}


// I token revocati scaduti non servono più nell'elenco (un token dura un
// giorno), e nemmeno i token di rinnovo scaduti.

export async function cleanupRevokedTokens() {
    try {
        const result = await pool.query("DELETE FROM revoked_tokens WHERE revoked_at < NOW() - INTERVAL '2 days'");
        if (result.rowCount > 0) {
            logger.info(`[Manutenzione] Rimossi ${result.rowCount} token revocati ormai scaduti.`);
        }
        const rinnovi = await pool.query('DELETE FROM token_rinnovo WHERE scade_il < NOW()');
        if (rinnovi.rowCount > 0) logger.info(`[Manutenzione] Rimossi ${rinnovi.rowCount} token di rinnovo scaduti.`);
        await pulisciTokenAvvisi();
    } catch (error) {
        logger.error('[Manutenzione] Pulizia revoked_tokens fallita:', { error });
    }
}
