// Storico inalterabile, lato applicazione (il resto è nella migrazione storico-inalterabile).

import { pool } from './db.js';
import logger from './logger.js';
import { sendEmailUtility } from './email.js';

const OGNI_MINUTO = 60 * 1000;

export async function sigilla() {
    try {
        const r = await pool.query('SELECT orion_sigilla() AS n');
        return r.rows[0].n;
    } catch (e) {
        logger.error('[Integrità] Sigillatura non riuscita:', e);
        return null;
    }
}

export async function sigilloAttuale(esecutore = pool) {
    await esecutore.query('SELECT orion_sigilla()');
    const r = await esecutore.query('SELECT id, impronta, quando FROM registro_integrita ORDER BY id DESC LIMIT 1');
    return r.rows[0] ? { id: Number(r.rows[0].id), impronta: r.rows[0].impronta.trim(), quando: r.rows[0].quando } : null;
}

export function testoSigillo(s) {
    if (!s) return 'ORION - nessun sigillo (registro ancora vuoto)';
    const quando = new Date(s.quando).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    return `ORION sigillo n. ${s.id} del ${quando}: ${s.impronta}`;
}

export function leggiSigillo(testo) {
    const t = String(testo || '');
    const impronta = /\b([0-9a-f]{64})\b/i.exec(t)?.[1]?.toLowerCase();
    const id = /n\.?\s*(\d+)/i.exec(t)?.[1] || /#\s*(\d+)/.exec(t)?.[1];
    return impronta && id ? { id: Number(id), impronta } : null;
}

// La prima subito: alla prima versione con il registro sigilla tutto lo storico di prima.
export function avviaIntegrita() {
    sigilla();
    setInterval(sigilla, OGNI_MINUTO);
}

export async function sigillaChiusura(emergenza) {
    const testo = testoSigillo(await sigilloAttuale());
    await pool.query('UPDATE emergencies SET sigillo_chiusura = $1 WHERE id = $2', [testo, emergenza.id]);
    inviaSigilloChiusura(emergenza, testo).catch(e => logger.error('[Integrità] Email del sigillo di chiusura non inviata:', e));
    return testo;
}

export function registraIntegrita(app, { soloAdmin, registraAudit, dominio }) {

    app.get('/api/sistema/integrita', soloAdmin, async (req, res) => {
        try {
            await sigilla();
            const verifica = (await pool.query('SELECT orion_verifica() AS v')).rows[0].v;
            const cancellazioni = (await pool.query(
                `SELECT id, quando, dettagli->'emergenza' AS emergenza, dettagli->>'eseguita_da' AS eseguita_da,
                        (SELECT sum(jsonb_array_length(v)) FROM jsonb_each(dettagli->'righe') AS e(k, v))::int AS righe
                 FROM registro_integrita WHERE evento = 'cancellazione_emergenza' ORDER BY id DESC LIMIT 20`)).rows;
            const ultimo = verifica.ultimo ? { ...verifica.ultimo, id: Number(verifica.ultimo.id) } : null;
            // Una verifica integra non si registra: la voce verrebbe sigillata e ogni clic cambierebbe
            // il sigillo.
            if (!verifica.integro) registraAudit(req, 'integrita.verificata', { dettagli: { integro: false, anelli: verifica.anelli } });
            res.json({ ...verifica, ultimo, sigillo: ultimo ? testoSigillo({ ...ultimo, impronta: ultimo.impronta.trim() }) : null, cancellazioni });
        } catch (e) {
            logger.error('Errore verifica integrità:', e);
            res.status(500).json({ message: 'Errore nella verifica dello storico.' });
        }
    });

    app.get('/api/sistema/integrita/sigillo', soloAdmin, async (req, res) => {
        try {
            const s = await sigilloAttuale();
            const giorno = new Date().toISOString().slice(0, 10);
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="orion-sigillo-${giorno}.txt"`);
            res.send([
                testoSigillo(s), '',
                `Server: ${dominio || ''}`,
                'Questo è il sigillo dello storico di ORION: note delle segnalazioni, diario di sala,',
                'registro delle operazioni, movimenti del magazzino, registro delle squadre.',
                'Conservalo fuori dal server. Per verificare che lo storico fino a qui non sia stato',
                'modificato: ORION, pagina Sistema, "Integrità dello storico", incolla questa riga.', ''
            ].join('\n'));
        } catch (e) {
            logger.error('Errore sigillo:', e);
            res.status(500).json({ message: 'Errore nel preparare il sigillo.' });
        }
    });

    app.post('/api/sistema/integrita/confronta', soloAdmin, async (req, res) => {
        const s = leggiSigillo(req.body?.sigillo);
        if (!s) return res.status(400).json({ message: 'Non trovo nel testo il numero dell\'anello e l\'impronta (64 caratteri esadecimali).' });
        try {
            const r = await pool.query('SELECT impronta, quando FROM registro_integrita WHERE id = $1', [s.id]);
            const verifica = (await pool.query('SELECT orion_verifica() AS v')).rows[0].v;
            const anello = r.rows[0];
            const uguale = !!anello && anello.impronta.trim() === s.impronta;
            const rotta = verifica.catena_rotta;
            const ok = uguale && (!rotta || Number(rotta.id) > s.id) && verifica.integro;
            if (!uguale || !verifica.integro) registraAudit(req, 'integrita.sigillo_confrontato', { dettagli: { anello: s.id, uguale, integro: verifica.integro } });
            res.json({
                ok, uguale, anello: s.id, quando: anello?.quando || null,
                message: !anello ? `Nel registro non c'è l'anello n. ${s.id}: lo storico è stato riscritto o il sigillo è di un altro server.`
                    : !uguale ? `L'anello n. ${s.id} ha un'impronta diversa da quella del sigillo: lo storico fino a quel punto è stato riscritto.`
                        : ok ? `Il sigillo corrisponde: lo storico fino all'anello n. ${s.id} è quello di allora, e da lì a oggi la catena è intatta.`
                            : `Il sigillo corrisponde, ma la verifica di adesso trova delle differenze: guarda il riquadro sopra.`
            });
        } catch (e) {
            logger.error('Errore confronto sigillo:', e);
            res.status(500).json({ message: 'Errore nel confronto del sigillo.' });
        }
    });
}

async function inviaSigilloChiusura(emergenza, testo) {
    const smtp = (await pool.query("SELECT 1 FROM branding_settings WHERE setting_key = 'smtp_host' AND setting_value <> ''")).rowCount;
    if (!smtp) return;
    const admin = (await pool.query(
        `SELECT DISTINCT u.email FROM users u JOIN utenti_ruoli r ON r.user_id = u.id
         WHERE r.ruolo = 'admin' AND COALESCE(u.is_active, true) AND u.email IS NOT NULL AND u.email <> ''`)).rows.map(r => r.email);
    if (!admin.length) return;
    const nome = [emergenza.code, emergenza.name].filter(Boolean).join(' - ');
    const corpo = [
        'Buongiorno,', '',
        `l'emergenza ${nome} è stata chiusa. Questo è il sigillo dello storico al momento della chiusura:`, '',
        testo, '',
        "Tieni questa email. Se un giorno qualcuno dubitasse che il diario o le note dell'emergenza",
        'siano stati modificati, in ORION, pagina Sistema, "Integrità dello storico", incolli questa',
        'riga e ORION dice se lo storico fino alla chiusura è rimasto quello.', '',
        'ORION'
    ].join('\n');
    const esito = await sendEmailUtility(admin.join(', '), `ORION: sigillo di chiusura dell'emergenza ${emergenza.code}`, corpo);
    if (esito.success) logger.info(`[Integrità] Sigillo di chiusura di ${emergenza.code} inviato a ${admin.length} amministratori.`);
    else logger.warn(`[Integrità] Sigillo di chiusura non inviato: ${esito.error}`);
}
