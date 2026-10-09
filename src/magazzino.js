// Magazzino: DPI, attrezzature e veicoli, cioè un'anagrafica dei beni e un
// registro dei movimenti. Giacenze e detentori non si scrivono: si calcolano
// dal registro nelle viste della migrazione update-19 (movimenti_effetti,
// beni_situazione).

import fs from 'fs';
import { haPermesso, richiedePermesso, sqlHaPermesso } from './permessi.js';
import path from 'path';
import crypto from 'crypto';
import { dataItaliana } from './date.js';
import { inviaFile, proteggiCaricati } from './cifratura.js';

// L'ordine conta: è quello in cui si leggono gli elenchi.
export const TIPI_BENE = ['dpi', 'attrezzatura', 'veicolo'];

export const TIPI_SCADENZA = [
    'revisione', 'assicurazione', 'bollo', 'tagliando',
    'verifica_periodica', 'scadenza_dpi', 'collaudo', 'manutenzione'
];

export const ETICHETTE_SCADENZA = {
    revisione: 'Revisione',
    assicurazione: 'Assicurazione',
    bollo: 'Bollo',
    tagliando: 'Tagliando',
    verifica_periodica: 'Verifica periodica',
    scadenza_dpi: 'Scadenza DPI',
    collaudo: 'Collaudo',
    manutenzione: 'Manutenzione'
};

export const ETICHETTE_MOVIMENTO = {
    carico: 'Carico',
    consegna: 'Consegna',
    rientro: 'Rientro',
    trasferimento: 'Trasferimento',
    manutenzione: 'In manutenzione',
    consumo: 'Consumo',
    smarrimento: 'Smarrimento',
    dismissione: 'Dismissione',
    rettifica: 'Rettifica'
};

// Le unità che si possono frazionare sono le misure: litri, chili, metri.
// Pezzi, paia, kit, sacchi e rotoli si contano interi. La stessa lista sta
// in public/js/magazzino.js e nell'app (TipiBene.frazionabile).
const UNITA_FRAZIONABILI = [
    'l', 'lt', 'litro', 'litri', 'ml', 'cl', 'hl',
    'kg', 'chilo', 'chili', 'chilogrammi', 'g', 'gr', 'grammi', 'q', 'quintali', 't', 'tonnellate',
    'm', 'mt', 'metro', 'metri', 'cm', 'mm', 'km', 'mq', 'm2', 'm²', 'mc', 'm3', 'm³'
];

export function unitaFrazionabile(unita) {
    return UNITA_FRAZIONABILI.includes(String(unita || '').trim().toLowerCase().replace(/\.$/, ''));
}

// Movimenti che chiunque può registrare: in emergenza non si aspetta il
// magazziniere per prendere una pala. Ogni movimento porta comunque il nome di
// chi l'ha fatto.
const MOVIMENTI_OPERATIVI = ['consegna', 'rientro', 'trasferimento'];
// Il materiale si consegna a una persona. Squadre e mezzi restano detentori
// solo per il materiale che avevano già, che deve poter rientrare.
const CONSEGNA_SOLO_A = 'persona';
// Movimenti che incidono sull'inventario da rendicontare: quelli no.
const MOVIMENTI_DI_INVENTARIO = ['carico', 'manutenzione', 'consumo', 'smarrimento', 'dismissione', 'rettifica'];

// Chi puo' avere materiale in carico, e i movimenti con cui il materiale gli
// esce di mano. Sui beni a quantita' questi movimenti devono dire da chi: e'
// l'unico modo di sapere quanto resta a ciascuno (vedi update-25).
const DETENTORI = ['persona', 'squadra', 'veicolo'];
const USCITE_DAL_CAMPO = ['rientro', 'consumo', 'smarrimento', 'dismissione', 'trasferimento'];

// La colonna della vista detenzioni_sfusi per ciascun tipo di detentore.
const COLONNA_DETENTORE = { persona: 'user_id', squadra: 'squadra_id', veicolo: 'veicolo_id' };

export function registraRotteMagazzino(app, ctx) {
    const {
        pool, logger, haRuolo, ruoliDi, registraAudit,
        erroreRichiesta, erroreNonTrovato, emergenzaAttiva, avvisaClienti,
        caricaDocumento, cartellaDocumenti,
        // Il foglio firmato di un verbale (foto o PDF) e la cartella dove sta.
        caricaScansione, cartellaVerbali,
        // Per gli avvisi via email: la posta e l'indirizzo dell'istanza li sa
        // già server.js, non ha senso configurarli una seconda volta qui.
        inviaEmail, escapeHtml, dominio,
        // La coda di notifiche per persona (src/appMobile.js): facoltativa,
        // chi registra le rotte senza passarla non manda notifiche.
        notifica,
        // Per togliere dalla coda cio' che non serve piu' (il DPI confermato).
        scadiNotifiche
    } = ctx;

    // Permessi
    // Chi tiene l'inventario: anagrafica, carichi, dismissioni, rettifiche.
    function soloMagazziniere(req, res, next) {
        if (haPermesso(req, 'magazzino.gestione')) return next();
        logger.warn(`[Magazzino] Accesso negato a ${req.user?.username} (ruoli: ${ruoliDi(req.user).join(', ')}) su ${req.originalUrl}`);
        return res.status(403).json({ message: 'Ti serve il permesso "Gestire il magazzino".' });
    }

    // Chi può muovere materiale sul campo: qualunque operatore, non gli
    // esterni, che vedono solo le proprie segnalazioni.
    function operatoreInterno(req, res, next) {
        if (ruoliDi(req.user).includes('esterno')) {
            return res.status(403).json({ message: 'Gli utenti esterni non possono registrare movimenti di magazzino.' });
        }
        return next();
    }

    // L'interruttore del modulo (dell'amministratore) sta separato dalle opzioni
    // (del magazziniere): nello stesso JSON chi salva per ultimo cancellerebbe
    // le scelte dell'altro.
    async function moduloAcceso() {
        try {
            const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'magazzino_enabled'");
            return r.rowCount > 0 && String(r.rows[0].setting_value) === 'true';
        } catch (e) {
            logger.error('[Magazzino] Impossibile leggere se il modulo è acceso:', e);
            return false;
        }
    }

    async function moduloAttivo(req, res, next) {
        if (await moduloAcceso()) return next();
        return res.status(403).json({
            message: 'Il modulo Magazzino è disattivato. Un amministratore può accenderlo dalle Impostazioni.',
            modulo_spento: true
        });
    }

    // Su tutte le rotte del magazzino, anche quelle aggiunte domani.
    app.use('/api/magazzino', moduloAttivo);

    // Un esterno non vede il magazzino dell'associazione: inventario, movimenti
    // e "chi ha cosa" portano i nomi e le dotazioni dei volontari. Gli restano
    // il proprio materiale in carico e i propri verbali, che le rotte stesse
    // limitano a lui.
    const PERCORSI_DELL_ESTERNO = [
        /^\/in-carico\/persona\/\d+$/, /^\/verbali\/miei$/, /^\/verbali\/\d+$/,
        /^\/verbali\/\d+\/conferma$/, /^\/verbali\/\d+\/scansione$/
    ];
    app.use('/api/magazzino', (req, res, next) => {
        if (!ruoliDi(req.user).includes('esterno')) return next();
        if (PERCORSI_DELL_ESTERNO.some(r => r.test(req.path))) return next();
        return res.status(403).json({ message: 'Il magazzino dell\'associazione non è consultabile con un accesso esterno.' });
    });

    // Le opzioni del magazzino. I mezzi con revisione o assicurazione scadute:
    // bloccati, segnalati o nessun controllo, a scelta dell'associazione.
    const CONFIG_PREDEFINITA = {
        blocco_mezzi_scaduti: 'segnalazione',
        conferma_dpi: false,
        giorni_avviso_recupero: 7,
        // Verbali di consegna e di rientro: un di più, spenti di base, e
        // separati per i DPI (verbale_consegna, verbale_rientro) e per
        // attrezzature e mezzi (..._attrezzature). Con la conferma dei DPI il
        // verbale dei DPI c'è comunque; attrezzature e mezzi non lo impongono mai.
        verbale_rientro: false,
        verbale_consegna: false,
        verbale_rientro_attrezzature: false,
        verbale_consegna_attrezzature: false
    };

    // Quali righe di una consegna o di un rientro finiscono nel verbale.
    // richiesto: chi registra ha lasciato spuntato "Preparare il verbale".
    function nelVerbale(config, tipoBene, movimento, richiesto) {
        const dpi = tipoBene === 'dpi';
        if (movimento === 'consegna') {
            if (dpi) return !!config.conferma_dpi || (!!config.verbale_consegna && richiesto);
            return !!config.verbale_consegna_attrezzature && richiesto;
        }
        return richiesto && !!(dpi ? config.verbale_rientro : config.verbale_rientro_attrezzature);
    }

    async function leggiConfig() {
        try {
            const r = await pool.query("SELECT setting_value FROM branding_settings WHERE setting_key = 'magazzino_config'");
            if (r.rowCount === 0 || !r.rows[0].setting_value) return { ...CONFIG_PREDEFINITA };
            const grezza = r.rows[0].setting_value;
            const letta = typeof grezza === 'string' ? JSON.parse(grezza) : grezza;
            return { ...CONFIG_PREDEFINITA, ...letta };
        } catch (e) {
            logger.error('[Magazzino] Configurazione illeggibile, uso i valori predefiniti:', e);
            return { ...CONFIG_PREDEFINITA };
        }
    }

    app.get('/api/magazzino/config', async (req, res) => {
        res.json(await leggiConfig());
    });

    app.put('/api/magazzino/config', soloMagazziniere, async (req, res) => {
        const stati = ['blocco', 'segnalazione', 'disattivato'];
        const corpo = req.body || {};
        if (corpo.blocco_mezzi_scaduti && !stati.includes(corpo.blocco_mezzi_scaduti)) {
            return res.status(400).json({ message: `Il blocco dei mezzi scaduti può valere ${stati.join(', ')}.` });
        }
        const attuale = await leggiConfig();
        const nuova = {
            blocco_mezzi_scaduti: corpo.blocco_mezzi_scaduti || attuale.blocco_mezzi_scaduti,
            conferma_dpi: corpo.conferma_dpi === undefined ? attuale.conferma_dpi : !!corpo.conferma_dpi,
            giorni_avviso_recupero: interoPositivo(corpo.giorni_avviso_recupero) || attuale.giorni_avviso_recupero,
            verbale_rientro: corpo.verbale_rientro === undefined ? attuale.verbale_rientro : !!corpo.verbale_rientro,
            verbale_consegna: corpo.verbale_consegna === undefined ? attuale.verbale_consegna : !!corpo.verbale_consegna,
            verbale_rientro_attrezzature: corpo.verbale_rientro_attrezzature === undefined
                ? attuale.verbale_rientro_attrezzature : !!corpo.verbale_rientro_attrezzature,
            verbale_consegna_attrezzature: corpo.verbale_consegna_attrezzature === undefined
                ? attuale.verbale_consegna_attrezzature : !!corpo.verbale_consegna_attrezzature
        };
        await pool.query(
            `INSERT INTO branding_settings (setting_key, setting_value, updated_at)
             VALUES ('magazzino_config', $1, NOW())
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
            [JSON.stringify(nuova)]);
        registraAudit(req, 'magazzino.configurazione', { dettagli: nuova });
        res.json(nuova);
    });

    // Revisione e assicurazione fermano il mezzo; le altre scadenze si segnalano.
    const SCADENZE_CHE_FERMANO = ['revisione', 'assicurazione'];

    async function scadenzeSuperate(client, beneId) {
        const r = await client.query(
            `SELECT tipo, scadenza FROM beni_scadenze
             WHERE bene_id = $1 AND scadenza < CURRENT_DATE AND tipo = ANY($2::text[])
             ORDER BY scadenza`, [beneId, SCADENZE_CHE_FERMANO]);
        return r.rows;
    }

    // Funzioni di servizio
    function nomePersona(riga) {
        if (!riga) return null;
        const intero = `${riga.nome || ''} ${riga.cognome || ''}`.trim();
        return intero || riga.username || null;
    }

    function chiOpera(req) {
        return nomePersona(req.user) || req.user?.username || 'sconosciuto';
    }

    function interoPositivo(valore) {
        // Solo cifre: parseInt('1 OR 1=1') darebbe 1, accettando come id
        // qualunque cosa cominci con un numero.
        if (!/^\d+$/.test(String(valore).trim())) return null;
        const n = parseInt(valore, 10);
        return Number.isInteger(n) && n > 0 ? n : null;
    }

    // Una manutenzione "ogni 240 mesi" è quasi sicuramente un errore di
    // battitura, e una "ogni 0 mesi" non vuol dire niente.
    function periodicitaValida(valore) {
        const n = parseInt(valore, 10);
        return Number.isInteger(n) && n > 0 && n <= 120 ? n : null;
    }

    function quantitaValida(valore, consentiNegativa = false) {
        const n = Number(valore);
        if (!Number.isFinite(n)) return null;
        if (!consentiNegativa && n <= 0) return null;
        if (consentiNegativa && n === 0) return null;
        // Due decimali: oltre non ha senso su sacchi, litri e pezzi.
        return Math.round(n * 100) / 100;
    }

    // Il destinatario completo: i riferimenti per cercare, e il nome scritto nel
    // movimento perché il registro resti leggibile quando la squadra non c'è più.
    async function risolviDestinatario(client, destinatario) {
        const tipo = destinatario?.tipo;
        const base = {
            destinatario_tipo: tipo,
            destinatario_user_id: null,
            destinatario_squadra_id: null,
            destinatario_bene_id: null,
            destinatario_ubicazione_id: null,
            destinatario_nome: null
        };

        switch (tipo) {
            case 'magazzino': {
                if (destinatario.ubicazione_id) {
                    const u = await client.query('SELECT id, nome FROM ubicazioni WHERE id = $1', [destinatario.ubicazione_id]);
                    if (u.rowCount === 0) throw erroreRichiesta('Ubicazione inesistente.');
                    base.destinatario_ubicazione_id = u.rows[0].id;
                    base.destinatario_nome = u.rows[0].nome;
                } else {
                    base.destinatario_nome = 'Magazzino';
                }
                return base;
            }
            case 'persona': {
                const id = interoPositivo(destinatario.id);
                if (!id) throw erroreRichiesta('Manca la persona a cui consegnare.');
                const r = await client.query('SELECT id, nome, cognome, username FROM users WHERE id = $1 AND COALESCE(is_active, true) = true', [id]);
                if (r.rowCount === 0) throw erroreRichiesta('La persona indicata non esiste o non è più attiva.');
                base.destinatario_user_id = r.rows[0].id;
                base.destinatario_nome = nomePersona(r.rows[0]);
                return base;
            }
            case 'squadra': {
                const id = interoPositivo(destinatario.id);
                if (!id) throw erroreRichiesta('Manca la squadra a cui consegnare.');
                const r = await client.query('SELECT id, nome, nome_radio FROM squadre WHERE id = $1', [id]);
                if (r.rowCount === 0) throw erroreRichiesta('La squadra indicata non esiste.');
                base.destinatario_squadra_id = r.rows[0].id;
                base.destinatario_nome = r.rows[0].nome
                    ? `${r.rows[0].nome_radio} - ${r.rows[0].nome}`
                    : `Squadra ${r.rows[0].nome_radio}`;
                return base;
            }
            case 'veicolo': {
                // Un veicolo è anche un contenitore: l'idrovora sta sul Daily.
                const id = interoPositivo(destinatario.id);
                if (!id) throw erroreRichiesta('Manca il veicolo su cui caricare.');
                const r = await client.query("SELECT id, denominazione, matricola FROM beni WHERE id = $1 AND tipo = 'veicolo' AND dismesso_il IS NULL", [id]);
                if (r.rowCount === 0) throw erroreRichiesta('Il veicolo indicato non esiste o è stato dismesso.');
                base.destinatario_bene_id = r.rows[0].id;
                base.destinatario_nome = r.rows[0].matricola
                    ? `${r.rows[0].denominazione} (${r.rows[0].matricola})`
                    : r.rows[0].denominazione;
                return base;
            }
            case 'officina':
                base.destinatario_nome = destinatario.nome?.trim() || 'Officina';
                return base;
            case 'esterno':
            case 'consumato':
            case 'perso':
            case 'dismesso':
                base.destinatario_nome = destinatario.nome?.trim() || null;
                return base;
            default:
                throw erroreRichiesta('Destinatario non valido.');
        }
    }

    // Il destinatario implicito di ogni tipo di movimento.
    function destinatarioPredefinito(tipo, destinatario) {
        if (destinatario?.tipo) return destinatario;
        switch (tipo) {
            case 'carico':
            case 'rientro': return { ...destinatario, tipo: 'magazzino' };
            case 'manutenzione': return { ...destinatario, tipo: 'officina' };
            case 'consumo': return { ...destinatario, tipo: 'consumato' };
            case 'smarrimento': return { ...destinatario, tipo: 'perso' };
            case 'dismissione': return { ...destinatario, tipo: 'dismesso' };
            case 'rettifica': return { ...destinatario, tipo: 'magazzino' };
            default: return destinatario || {};
        }
    }

    async function leggiSituazione(client, beneId) {
        const r = await client.query(
            `SELECT b.id, b.tipo, b.gestione, b.denominazione, b.matricola, b.taglia, b.unita_misura,
                    b.quantita_totale, b.dismesso_il, b.km,
                    s.in_magazzino, s.fuori, s.disponibile,
                    s.destinatario_tipo, s.destinatario_nome, s.destinatario_user_id,
                    s.destinatario_squadra_id, s.destinatario_bene_id,
                    s.ultimo_movimento, s.ultimo_movimento_il
             FROM beni b JOIN beni_situazione s ON s.bene_id = b.id
             WHERE b.id = $1`, [beneId]);
        if (r.rowCount === 0) throw erroreNonTrovato('Bene non trovato.');
        return r.rows[0];
    }

    // Un detentore ({ tipo, id }), anche una persona sospesa: può ancora rendere quello che ha.
    async function risolviDetentore(client, da) {
        if (!da) return null;
        const tipo = da.tipo;
        const id = interoPositivo(da.id);
        if (!DETENTORI.includes(tipo) || !id) {
            throw erroreRichiesta('Il detentore indicato non è valido: serve una persona, una squadra o un mezzo.');
        }
        const esiste = tipo === 'persona'
            ? await client.query('SELECT 1 FROM users WHERE id = $1', [id])
            : tipo === 'squadra'
                ? await client.query('SELECT 1 FROM squadre WHERE id = $1', [id])
                : await client.query("SELECT 1 FROM beni WHERE id = $1 AND tipo = 'veicolo'", [id]);
        if (esiste.rowCount === 0) throw erroreRichiesta('Il detentore indicato non esiste.');
        return {
            tipo,
            user_id: tipo === 'persona' ? id : null,
            squadra_id: tipo === 'squadra' ? id : null,
            bene_id: tipo === 'veicolo' ? id : null
        };
    }

    // Quanto di un bene a quantita' ha in carico un detentore.
    async function saldoDetentore(client, beneId, det) {
        const r = await client.query(
            `SELECT COALESCE(SUM(variazione), 0)::float AS saldo FROM detenzioni_sfusi
             WHERE bene_id = $1 AND detentore_tipo = $2 AND ${COLONNA_DETENTORE[det.tipo]} = $3`,
            [beneId, det.tipo, det.user_id ?? det.squadra_id ?? det.bene_id]);
        return r.rows[0].saldo;
    }

    // Chi ha in carico qualcosa di un bene a quantita', e quanto.
    async function detentoriDi(client, beneId) {
        const r = await client.query(
            `SELECT detentore_tipo AS tipo, user_id, squadra_id, veicolo_id AS bene_id,
                    SUM(variazione)::float AS saldo
             FROM detenzioni_sfusi WHERE bene_id = $1
             GROUP BY detentore_tipo, user_id, squadra_id, veicolo_id
             HAVING SUM(variazione) > 0`, [beneId]);
        return r.rows;
    }

    // Niente numeri impossibili: un pezzo già fuori non si consegna, e non
    // escono più sacchi di quanti ce ne sono.
    function verificaFattibilita(bene, tipo, quantita) {
        if (bene.dismesso_il && tipo !== 'rettifica') {
            throw erroreRichiesta(`"${bene.denominazione}" è stato dismesso: non si può più movimentare.`);
        }
        if (bene.gestione === 'singolo') {
            if (quantita !== 1) {
                throw erroreRichiesta(`"${bene.denominazione}" è un pezzo unico: la quantità può essere solo 1.`);
            }
            const dove = bene.destinatario_tipo || 'magazzino';
            // Dismissione e smarrimento valgono ovunque sia il bene.
            if ((tipo === 'consegna' || tipo === 'manutenzione') && dove !== 'magazzino') {
                throw erroreRichiesta(`"${bene.denominazione}" non è in magazzino: risulta presso ${bene.destinatario_nome || 'un altro detentore'}.`);
            }
            if (tipo === 'rientro' && dove === 'magazzino') {
                throw erroreRichiesta(`"${bene.denominazione}" risulta già in magazzino.`);
            }
            if (tipo === 'trasferimento' && dove === 'magazzino') {
                throw erroreRichiesta(`"${bene.denominazione}" è in magazzino: usa la consegna, non il trasferimento.`);
            }
            if (tipo === 'consumo') {
                throw erroreRichiesta('Il consumo vale solo per il materiale sfuso.');
            }
            return;
        }
        // Sfusi
        const inMagazzino = Number(bene.in_magazzino);
        const fuori = Number(bene.fuori);
        if ((tipo === 'consegna' || tipo === 'manutenzione') && quantita > inMagazzino) {
            throw erroreRichiesta(`In magazzino ci sono ${inMagazzino} ${bene.unita_misura} di "${bene.denominazione}": non se ne possono muovere ${quantita}.`);
        }
        if (tipo === 'rientro' && quantita > fuori) {
            throw erroreRichiesta(`Di "${bene.denominazione}" risultano fuori ${fuori} ${bene.unita_misura}: non se ne possono registrare ${quantita}.`);
        }
        // Sullo sfuso non se ne tolgono più di quanti ne esistono in tutto.
        if ((tipo === 'consumo' || tipo === 'smarrimento' || tipo === 'dismissione') && quantita > inMagazzino + fuori) {
            throw erroreRichiesta(`Di "${bene.denominazione}" ne esistono ${inMagazzino + fuori} ${bene.unita_misura} in tutto: non se ne possono registrare ${quantita}.`);
        }
    }

    // L'unico punto che scrive un movimento: tutte le strade passano di qui.
    async function registraMovimento(client, req, dati) {
        const { beneId, tipo, quantita = 1, destinatario, note = null, verbaleId = null, km = null, da = null } = dati;

        const bene = await leggiSituazione(client, beneId);
        const q = quantitaValida(quantita, tipo === 'rettifica');
        if (q === null) {
            throw erroreRichiesta(tipo === 'rettifica'
                ? 'La rettifica deve indicare di quanto correggere, in più o in meno.'
                : 'La quantità deve essere un numero maggiore di zero.');
        }
        if (bene.gestione === 'quantita' && !Number.isInteger(q) && !unitaFrazionabile(bene.unita_misura)) {
            throw erroreRichiesta(`"${bene.denominazione}" si conta in ${bene.unita_misura || 'pezzi'}: la quantità dev'essere un numero intero, non ${q}.`);
        }
        verificaFattibilita(bene, tipo, Math.abs(q));

        if (tipo === 'smarrimento' && !String(note || '').trim()) {
            throw erroreRichiesta('Per registrare uno smarrimento serve una nota che spieghi cosa è successo.');
        }
        if (tipo === 'dismissione' && !String(note || '').trim()) {
            throw erroreRichiesta('Per dismettere un bene serve una nota che dica perché: scaduto, rotto, venduto.');
        }
        if (tipo === 'rettifica' && !String(note || '').trim()) {
            throw erroreRichiesta('Per registrare una rettifica serve una nota: fra un anno deve essere chiaro da dove viene il numero nuovo.');
        }

        // Un mezzo con la revisione scaduta non esce dal cancello. Quanto sia
        // vincolante lo decide l'associazione dalle impostazioni.
        let avvisoScadenze = null;
        if (tipo === 'consegna' && bene.tipo === 'veicolo') {
            const config = await leggiConfig();
            if (config.blocco_mezzi_scaduti !== 'disattivato') {
                const scadute = await scadenzeSuperate(client, beneId);
                if (scadute.length > 0) {
                    const elenco = scadute.map(x => `${ETICHETTE_SCADENZA[x.tipo] || x.tipo} (scaduta il ${dataItaliana(x.scadenza)})`).join(', ');
                    if (config.blocco_mezzi_scaduti === 'blocco') {
                        throw erroreRichiesta(`"${bene.denominazione}" non può uscire: ${elenco}.`);
                    }
                    avvisoScadenze = `Attenzione: "${bene.denominazione}" ha ${elenco}.`;
                }
            }
        }

        const dest = await risolviDestinatario(client, destinatarioPredefinito(tipo, destinatario));
        const emergenza = emergenzaAttiva();

        // Da dove viene: la destinazione del movimento precedente.
        let provenienza = bene.gestione === 'singolo'
            ? (bene.destinatario_tipo || 'esterno')
            : (['consumo', 'smarrimento', 'dismissione'].includes(tipo) && Number(bene.fuori) >= Math.abs(q)
                ? 'persona' : 'magazzino');

        // E da chi: sugli sfusi lo dice chi scrive ("da"), o si deduce se il
        // detentore è uno solo; altrimenti resta non attribuito.
        let origine = null;
        if (USCITE_DAL_CAMPO.includes(tipo)) {
            if (bene.gestione === 'singolo') {
                if (DETENTORI.includes(bene.destinatario_tipo)) {
                    origine = {
                        tipo: bene.destinatario_tipo, user_id: bene.destinatario_user_id,
                        squadra_id: bene.destinatario_squadra_id, bene_id: bene.destinatario_bene_id
                    };
                    const indicato = await risolviDetentore(client, da);
                    if (indicato && (indicato.tipo !== origine.tipo || (indicato.user_id ?? indicato.squadra_id ?? indicato.bene_id) !==
                        (origine.user_id ?? origine.squadra_id ?? origine.bene_id))) {
                        throw erroreRichiesta(`"${bene.denominazione}" risulta presso ${bene.destinatario_nome || 'un altro detentore'}.`);
                    }
                }
            } else {
                const dalCampo = !['smarrimento', 'dismissione'].includes(tipo) || provenienza !== 'magazzino' || da;
                if (dalCampo) {
                    origine = await risolviDetentore(client, da);
                    if (origine) {
                        const saldo = await saldoDetentore(client, beneId, origine);
                        if (Math.abs(q) > saldo + 0.0001) {
                            throw erroreRichiesta(`Di "${bene.denominazione}" quel detentore ha in carico ${saldo} ${bene.unita_misura}: non se ne possono registrare ${Math.abs(q)}.`);
                        }
                    } else {
                        const detentori = (await detentoriDi(client, beneId))
                            .filter(d => tipo !== 'trasferimento' || !(d.tipo === destinatario?.tipo && [d.user_id, d.squadra_id, d.bene_id].includes(interoPositivo(destinatario?.id))));
                        if (detentori.length === 1 && detentori[0].saldo + 0.0001 >= Math.abs(q)) origine = detentori[0];
                    }
                    if (origine) provenienza = origine.tipo;
                }
            }
        }

        // I DPI non si legano all'emergenza: sono dotazione personale.
        const emergenzaDelMovimento = emergenza && bene.tipo !== 'dpi' ? emergenza.id : null;
        const inserimento = await client.query(
            `INSERT INTO movimenti (bene_id, tipo, quantita, destinatario_tipo, destinatario_user_id,
                                    destinatario_squadra_id, destinatario_bene_id, destinatario_ubicazione_id,
                                    destinatario_nome, bene_denominazione, emergency_id, verbale_id,
                                    km_registrati, note, eseguito_da, eseguito_da_id, proveniva_da,
                                    proveniva_user_id, proveniva_squadra_id, proveniva_bene_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
             RETURNING id, quando`,
            [beneId, tipo, q, dest.destinatario_tipo, dest.destinatario_user_id,
             dest.destinatario_squadra_id, dest.destinatario_bene_id, dest.destinatario_ubicazione_id,
             dest.destinatario_nome, bene.denominazione, emergenzaDelMovimento, verbaleId,
             km ?? null, note ? String(note).trim() : null, chiOpera(req), req.user?.id ?? null,
             provenienza, origine?.user_id ?? null, origine?.squadra_id ?? null, origine?.bene_id ?? null]
        );

        // Un bene dismesso esce dagli elenchi, non dalla storia. Sullo sfuso si
        // dismettono pezzi: il bene esce solo quando non ne resta niente.
        if (tipo === 'dismissione') {
            const restano = bene.gestione === 'quantita'
                ? Number(bene.in_magazzino) + Number(bene.fuori) - Math.abs(q)
                : 0;
            if (restano <= 0) {
                await client.query('UPDATE beni SET dismesso_il = NOW() WHERE id = $1', [beneId]);
            }
        }
        // Al rientro di un veicolo si chiedono i chilometri: è l'unico momento
        // in cui qualcuno li ha davvero sotto gli occhi.
        if (km !== null && km !== undefined && bene.tipo === 'veicolo') {
            const kmNuovi = interoPositivo(km);
            if (kmNuovi) await client.query('UPDATE beni SET km = GREATEST(COALESCE(km, 0), $1) WHERE id = $2', [kmNuovi, beneId]);
        }

        return { id: inserimento.rows[0].id, quando: inserimento.rows[0].quando, bene, destinatario: dest, avviso: avvisoScadenze };
    }

    // Cataloghi: categorie e ubicazioni
    app.get('/api/magazzino/categorie', async (req, res) => {
        try {
            const tipo = TIPI_BENE.includes(req.query.tipo) ? req.query.tipo : null;
            const r = await pool.query(
                `SELECT c.id, c.tipo, c.nome, COUNT(b.id)::int AS beni
                 FROM categorie_beni c
                 LEFT JOIN beni b ON b.categoria_id = c.id AND b.dismesso_il IS NULL
                 WHERE ($1::text IS NULL OR c.tipo::text = $1)
                 GROUP BY c.id ORDER BY c.tipo, c.nome`, [tipo]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET categorie magazzino:', e);
            res.status(500).json({ message: 'Errore nel leggere le categorie.' });
        }
    });

    app.post('/api/magazzino/categorie', soloMagazziniere, async (req, res) => {
        const { tipo, nome } = req.body;
        if (!TIPI_BENE.includes(tipo)) return res.status(400).json({ message: 'Tipo di bene non valido.' });
        if (!String(nome || '').trim()) return res.status(400).json({ message: 'Il nome della categoria è obbligatorio.' });
        if (String(nome).trim().length > 100) return res.status(400).json({ message: 'Il nome della categoria è troppo lungo.' });
        try {
            const r = await pool.query('INSERT INTO categorie_beni (tipo, nome) VALUES ($1, $2) RETURNING id, tipo, nome',
                [tipo, String(nome).trim()]);
            res.status(201).json(r.rows[0]);
        } catch (e) {
            // Stesso messaggio dei cataloghi della segreteria: il vincolo
            // ignora maiuscole e spazi ai bordi, e chi scrive deve capirlo.
            if (e.code === '23505') return res.status(409).json({ message: 'Esiste già una categoria con questo nome.' });
            logger.error('Errore POST categoria magazzino:', e);
            res.status(500).json({ message: 'Errore nel creare la categoria.' });
        }
    });

    // Il nome di una categoria si cambia, il tipo no.
    app.put('/api/magazzino/categorie/:id', soloMagazziniere, async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        const nome = String(req.body?.nome || '').trim();
        if (!nome) return res.status(400).json({ message: 'Il nome della categoria è obbligatorio.' });
        if (nome.length > 100) return res.status(400).json({ message: 'Il nome della categoria è troppo lungo.' });
        try {
            const r = await pool.query('UPDATE categorie_beni SET nome = $1 WHERE id = $2 RETURNING id, tipo, nome', [nome, id]);
            if (r.rowCount === 0) return res.status(404).json({ message: 'Categoria non trovata.' });
            registraAudit(req, 'magazzino.categoria.rinominata', { tipo: 'categoria', id, dettagli: { nome } });
            res.json(r.rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ message: 'Esiste già una categoria con questo nome.' });
            logger.error('Errore PUT categoria magazzino:', e);
            res.status(500).json({ message: 'Errore nel rinominare la categoria.' });
        }
    });

    app.delete('/api/magazzino/categorie/:id', soloMagazziniere, async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const usata = await pool.query('SELECT 1 FROM beni WHERE categoria_id = $1 LIMIT 1', [id]);
            if (usata.rowCount > 0) {
                return res.status(409).json({ message: 'La categoria è usata da uno o più beni: spostali prima in un\'altra categoria.' });
            }
            const r = await pool.query('DELETE FROM categorie_beni WHERE id = $1 RETURNING nome', [id]);
            if (r.rowCount === 0) return res.status(404).json({ message: 'Categoria non trovata.' });
            res.json({ message: `Categoria "${r.rows[0].nome}" eliminata.` });
        } catch (e) {
            logger.error('Errore DELETE categoria magazzino:', e);
            res.status(500).json({ message: 'Errore nell\'eliminare la categoria.' });
        }
    });

    app.get('/api/magazzino/ubicazioni', async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT u.id, u.nome, u.tipo, u.note, u.attiva, COUNT(b.id)::int AS beni
                 FROM ubicazioni u
                 LEFT JOIN beni b ON b.ubicazione_id = u.id AND b.dismesso_il IS NULL
                 GROUP BY u.id ORDER BY u.attiva DESC, u.nome`);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET ubicazioni:', e);
            res.status(500).json({ message: 'Errore nel leggere le ubicazioni.' });
        }
    });

    app.post('/api/magazzino/ubicazioni', soloMagazziniere, async (req, res) => {
        const { nome, tipo = 'sede', note } = req.body;
        if (!String(nome || '').trim()) return res.status(400).json({ message: 'Il nome dell\'ubicazione è obbligatorio.' });
        if (String(nome).trim().length > 100) return res.status(400).json({ message: 'Il nome dell\'ubicazione è troppo lungo.' });
        if (!['sede', 'container', 'garage', 'altro'].includes(tipo)) {
            return res.status(400).json({ message: 'Tipo di ubicazione non valido.' });
        }
        try {
            const r = await pool.query('INSERT INTO ubicazioni (nome, tipo, note) VALUES ($1,$2,$3) RETURNING id, nome, tipo, note, attiva',
                [String(nome).trim(), tipo, note ? String(note).trim() : null]);
            res.status(201).json(r.rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ message: 'Esiste già un\'ubicazione con questo nome.' });
            logger.error('Errore POST ubicazione:', e);
            res.status(500).json({ message: 'Errore nel creare l\'ubicazione.' });
        }
    });

    // Un'ubicazione si corregge o si mette a riposo (attiva = false: non si
    // propone più per i beni nuovi, ma quelli che ci stanno restano dove sono).
    app.put('/api/magazzino/ubicazioni/:id', soloMagazziniere, async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        const corpo = req.body || {};
        const nome = String(corpo.nome || '').trim();
        if (!nome) return res.status(400).json({ message: 'Il nome dell\'ubicazione è obbligatorio.' });
        if (nome.length > 100) return res.status(400).json({ message: 'Il nome dell\'ubicazione è troppo lungo.' });
        const tipo = corpo.tipo || 'sede';
        if (!['sede', 'container', 'garage', 'altro'].includes(tipo)) {
            return res.status(400).json({ message: 'Tipo di ubicazione non valido.' });
        }
        try {
            const r = await pool.query(
                `UPDATE ubicazioni SET nome = $1, tipo = $2, note = $3, attiva = $4
                 WHERE id = $5 RETURNING id, nome, tipo, note, attiva`,
                [nome, tipo, corpo.note ? String(corpo.note).trim() : null, corpo.attiva !== false, id]);
            if (r.rowCount === 0) return res.status(404).json({ message: 'Ubicazione non trovata.' });
            registraAudit(req, 'magazzino.ubicazione.modificata', { tipo: 'ubicazione', id, dettagli: r.rows[0] });
            res.json(r.rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ message: 'Esiste già un\'ubicazione con questo nome.' });
            logger.error('Errore PUT ubicazione:', e);
            res.status(500).json({ message: 'Errore nel modificare l\'ubicazione.' });
        }
    });

    // Si elimina solo un'ubicazione vuota; per le altre c'è "non più in uso".
    app.delete('/api/magazzino/ubicazioni/:id', soloMagazziniere, async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const usata = await pool.query('SELECT 1 FROM beni WHERE ubicazione_id = $1 LIMIT 1', [id]);
            if (usata.rowCount > 0) {
                return res.status(409).json({ message: 'Ci sono beni in questa ubicazione: spostali prima, oppure segnala l\'ubicazione come non più in uso.' });
            }
            const r = await pool.query('DELETE FROM ubicazioni WHERE id = $1 RETURNING nome', [id]);
            if (r.rowCount === 0) return res.status(404).json({ message: 'Ubicazione non trovata.' });
            registraAudit(req, 'magazzino.ubicazione.eliminata', { tipo: 'ubicazione', id, dettagli: { nome: r.rows[0].nome } });
            res.json({ message: `Ubicazione "${r.rows[0].nome}" eliminata.` });
        } catch (e) {
            logger.error('Errore DELETE ubicazione:', e);
            res.status(500).json({ message: 'Errore nell\'eliminare l\'ubicazione.' });
        }
    });

    // DPI a taglie: un modello tiene insieme le sue taglie, e ogni taglia è un
    // bene a quantità con lo stesso nome, come qualunque altro bene.

    // "L, XL, 44" -> ['L', 'XL', '44'], senza doppioni (maiuscole ignorate)
    function taglieValide(valore) {
        const elenco = Array.isArray(valore) ? valore : String(valore || '').split(',');
        const viste = new Set();
        const taglie = [];
        for (const t of elenco) {
            const pulita = String(t ?? '').trim().slice(0, 20);
            if (!pulita || viste.has(pulita.toLowerCase())) continue;
            viste.add(pulita.toLowerCase());
            taglie.push(pulita);
        }
        if (taglie.length > 40) throw erroreRichiesta('Al massimo 40 taglie per DPI.');
        return taglie;
    }

    // Il gruppo di taglia: busto, pantaloni, scarpe, oppure nessuno.
    const GRUPPI_TAGLIA = ['busto', 'pantaloni', 'scarpe'];
    function gruppoTaglia(valore) {
        if (valore === null || valore === undefined || valore === '') return null;
        if (!GRUPPI_TAGLIA.includes(valore)) throw erroreRichiesta('Gruppo di taglia non valido: busto, pantaloni o scarpe.');
        return valore;
    }

    // { "L": 4, "XL": 5 } -> solo le quantità valide e positive
    function quantitaPerTaglia(valore) {
        const risultato = new Map();
        if (!valore || typeof valore !== 'object') return risultato;
        for (const [taglia, n] of Object.entries(valore)) {
            if (n === '' || n === null || n === undefined || Number(n) === 0) continue;
            const q = quantitaValida(n);
            if (q === null) throw erroreRichiesta(`Quantità non valida per la taglia ${taglia}.`);
            risultato.set(String(taglia).trim(), q);
        }
        return risultato;
    }

    async function leggiModelli(esecutore, { id = null, anche_nascosti = false } = {}) {
        const r = await esecutore.query(
            `SELECT m.id, m.nome, m.categoria_id, c.nome AS categoria, m.taglie, m.unita_misura,
                    m.standard, m.nascosto, m.gruppo_taglia,
                    COALESCE(json_agg(json_build_object(
                        'bene_id', b.id, 'taglia', b.taglia, 'codice_etichetta', b.codice_etichetta,
                        'in_magazzino', s.in_magazzino, 'fuori', s.fuori,
                        'prima_scadenza', (SELECT MIN(sc.scadenza) FROM beni_scadenze sc WHERE sc.bene_id = b.id)
                    ) ORDER BY b.id) FILTER (WHERE b.id IS NOT NULL), '[]') AS varianti
             FROM modelli_dpi m
             LEFT JOIN categorie_beni c ON c.id = m.categoria_id
             LEFT JOIN beni b ON b.modello_id = m.id AND b.dismesso_il IS NULL
             LEFT JOIN beni_situazione s ON s.bene_id = b.id
             WHERE ($1::int IS NULL OR m.id = $1) AND ($2::boolean OR NOT m.nascosto)
             GROUP BY m.id, c.nome
             ORDER BY m.nascosto, LOWER(m.nome)`, [id, anche_nascosti]);
        return r.rows;
    }

    // La taglia di un modello come bene: la trova, o la crea a giacenza zero.
    async function variante(client, req, modello, taglia) {
        const esistente = await client.query(
            `SELECT id FROM beni WHERE modello_id = $1 AND dismesso_il IS NULL AND LOWER(BTRIM(taglia)) = LOWER($2)
             ORDER BY id LIMIT 1`, [modello.id, taglia]);
        if (esistente.rowCount) return esistente.rows[0].id;
        const nuovo = await client.query(
            `INSERT INTO beni (tipo, gestione, categoria_id, denominazione, taglia, unita_misura, quantita_totale, modello_id, creato_da)
             VALUES ('dpi', 'quantita', $1, $2, $3, $4, 0, $5, $6) RETURNING id`,
            [modello.categoria_id, modello.nome, taglia, modello.unita_misura, modello.id, chiOpera(req)]);
        return nuovo.rows[0].id;
    }

    async function caricaTaglie(client, req, modello, quantita, nota) {
        let totale = 0;
        for (const [taglia, q] of quantita) {
            if (!modello.taglie.some(t => t.toLowerCase() === taglia.toLowerCase())) {
                // Una taglia nuova caricata al volo entra nell'elenco del modello.
                modello.taglie.push(taglia);
                await client.query('UPDATE modelli_dpi SET taglie = $1 WHERE id = $2', [modello.taglie, modello.id]);
            }
            const beneId = await variante(client, req, modello, taglia);
            await registraMovimento(client, req, {
                beneId, tipo: 'carico', quantita: q,
                destinatario: { tipo: 'magazzino' },
                note: nota || null
            });
            totale += q;
        }
        return totale;
    }

    app.get('/api/magazzino/modelli', async (req, res) => {
        try {
            res.json(await leggiModelli(pool, { anche_nascosti: req.query.nascosti === '1' }));
        } catch (e) {
            logger.error('Errore GET modelli DPI:', e);
            res.status(500).json({ message: 'Errore nel leggere i DPI a taglie.' });
        }
    });

    // Un DPI nuovo con le sue taglie e, se si vuole, le quantità già in casa:
    // "Divisa estiva, 4 L e 5 XL" in un colpo solo.
    app.post('/api/magazzino/modelli', soloMagazziniere, async (req, res) => {
        const corpo = req.body || {};
        const client = await pool.connect();
        try {
            const nome = String(corpo.nome || '').trim();
            if (!nome) throw erroreRichiesta('Il nome del DPI è obbligatorio.');
            if (nome.length > 150) throw erroreRichiesta('Il nome del DPI è troppo lungo.');
            const taglie = taglieValide(corpo.taglie);
            if (!taglie.length) throw erroreRichiesta('Indica almeno una taglia (per un solo modello: "Unica").');
            const quantita = quantitaPerTaglia(corpo.quantita);
            const unita = String(corpo.unita_misura || 'pezzi').trim().slice(0, 20) || 'pezzi';
            const gruppo = gruppoTaglia(corpo.gruppo_taglia);

            await client.query('BEGIN');
            const r = await client.query(
                `INSERT INTO modelli_dpi (nome, categoria_id, taglie, unita_misura, gruppo_taglia)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id, nome, categoria_id, taglie, unita_misura`,
                [nome, interoPositivo(corpo.categoria_id), taglie, unita, gruppo]);
            const modello = r.rows[0];
            // Ogni taglia nasce come bene, anche a zero: ha subito la sua
            // etichetta da stampare per lo scaffale.
            for (const t of taglie) await variante(client, req, modello, t);
            const caricati = await caricaTaglie(client, req, modello, quantita, 'Carico iniziale alla creazione del DPI');
            await client.query('COMMIT');
            registraAudit(req, 'magazzino.modello.creato', { tipo: 'modello_dpi', id: modello.id, dettagli: { nome, taglie, caricati } });
            if (typeof avvisaClienti === 'function') avvisaClienti('reload_magazzino');
            res.status(201).json((await leggiModelli(pool, { id: modello.id, anche_nascosti: true }))[0]);
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
            if (e.code === '23505') return res.status(409).json({ message: 'Esiste già un DPI con questo nome.' });
            logger.error('Errore POST modello DPI:', e);
            res.status(500).json({ message: 'Errore nel creare il DPI.' });
        } finally {
            client.release();
        }
    });

    // Il nome nuovo passa a tutte le taglie; una taglia si toglie solo se vuota.
    app.put('/api/magazzino/modelli/:id', soloMagazziniere, async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        const corpo = req.body || {};
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const attuale = await client.query('SELECT * FROM modelli_dpi WHERE id = $1 FOR UPDATE', [id]);
            if (!attuale.rowCount) throw Object.assign(new Error('DPI non trovato.'), { nonTrovato: true });
            const prima = attuale.rows[0];

            const nome = corpo.nome === undefined ? prima.nome : String(corpo.nome).trim();
            if (!nome) throw erroreRichiesta('Il nome del DPI è obbligatorio.');
            if (nome.length > 150) throw erroreRichiesta('Il nome del DPI è troppo lungo.');
            const taglie = corpo.taglie === undefined ? prima.taglie : taglieValide(corpo.taglie);
            if (!taglie.length) throw erroreRichiesta('Serve almeno una taglia.');
            const categoria = corpo.categoria_id === undefined ? prima.categoria_id : interoPositivo(corpo.categoria_id);
            const unita = corpo.unita_misura === undefined ? prima.unita_misura
                : (String(corpo.unita_misura).trim().slice(0, 20) || 'pezzi');
            const nascosto = corpo.nascosto === undefined ? prima.nascosto : !!corpo.nascosto;
            const gruppo = corpo.gruppo_taglia === undefined ? prima.gruppo_taglia : gruppoTaglia(corpo.gruppo_taglia);

            // Le taglie tolte: vuote si dismettono, piene fermano tutto.
            const varianti = await client.query(
                `SELECT b.id, b.taglia, s.in_magazzino, s.fuori FROM beni b JOIN beni_situazione s ON s.bene_id = b.id
                 WHERE b.modello_id = $1 AND b.dismesso_il IS NULL`, [id]);
            const tenute = new Set(taglie.map(t => t.toLowerCase()));
            for (const v of varianti.rows) {
                if (tenute.has(String(v.taglia || '').trim().toLowerCase())) continue;
                if (Number(v.in_magazzino) > 0 || Number(v.fuori) > 0) {
                    throw Object.assign(new Error(
                        `La taglia ${v.taglia} non si può togliere: ne restano ${Number(v.in_magazzino)} in magazzino e ${Number(v.fuori)} fuori.`),
                    { conflitto: true });
                }
                await client.query('UPDATE beni SET dismesso_il = NOW() WHERE id = $1', [v.id]);
            }

            const r = await client.query(
                `UPDATE modelli_dpi SET nome = $1, categoria_id = $2, taglie = $3, unita_misura = $4, nascosto = $5,
                        gruppo_taglia = $6
                 WHERE id = $7 RETURNING id, nome, categoria_id, taglie, unita_misura`,
                [nome, categoria, taglie, unita, nascosto, gruppo, id]);
            await client.query(
                `UPDATE beni SET denominazione = $1, categoria_id = $2, unita_misura = $3
                 WHERE modello_id = $4 AND dismesso_il IS NULL`, [nome, categoria, unita, id]);
            for (const t of taglie) await variante(client, req, r.rows[0], t);
            await client.query('COMMIT');
            registraAudit(req, 'magazzino.modello.modificato', { tipo: 'modello_dpi', id, dettagli: { nome, taglie, nascosto, gruppo_taglia: gruppo } });
            if (typeof avvisaClienti === 'function') avvisaClienti('reload_magazzino');
            res.json((await leggiModelli(pool, { id, anche_nascosti: true }))[0]);
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
            if (e.nonTrovato) return res.status(404).json({ message: e.message });
            if (e.conflitto) return res.status(409).json({ message: e.message });
            if (e.code === '23505') return res.status(409).json({ message: 'Esiste già un DPI con questo nome.' });
            logger.error('Errore PUT modello DPI:', e);
            res.status(500).json({ message: 'Errore nel modificare il DPI.' });
        } finally {
            client.release();
        }
    });

    // Il carico di più taglie insieme: arriva la fornitura, si scrive quante
    // per taglia e basta.
    app.post('/api/magazzino/modelli/:id/carico', soloMagazziniere, async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        const client = await pool.connect();
        try {
            const quantita = quantitaPerTaglia(req.body?.quantita);
            if (!quantita.size) throw erroreRichiesta('Indica quanti pezzi entrano, almeno per una taglia.');
            await client.query('BEGIN');
            const m = await client.query('SELECT * FROM modelli_dpi WHERE id = $1 FOR UPDATE', [id]);
            if (!m.rowCount) throw Object.assign(new Error('DPI non trovato.'), { nonTrovato: true });
            const totale = await caricaTaglie(client, req, m.rows[0], quantita,
                req.body?.note ? String(req.body.note).trim().slice(0, 300) : null);
            await client.query('COMMIT');
            registraAudit(req, 'magazzino.modello.carico', {
                tipo: 'modello_dpi', id, dettagli: Object.fromEntries(quantita)
            });
            if (typeof avvisaClienti === 'function') avvisaClienti('reload_magazzino');
            res.json({ caricati: totale, modello: (await leggiModelli(pool, { id, anche_nascosti: true }))[0] });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
            if (e.nonTrovato) return res.status(404).json({ message: e.message });
            logger.error('Errore carico modello DPI:', e);
            res.status(500).json({ message: 'Errore nel registrare il carico.' });
        } finally {
            client.release();
        }
    });

    // I DPI proposti da ORION si nascondono, quelli creati a mano si eliminano
    // se vuoti; le taglie con movimenti si dismettono.
    app.delete('/api/magazzino/modelli/:id', soloMagazziniere, async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const m = await client.query('SELECT nome, standard FROM modelli_dpi WHERE id = $1 FOR UPDATE', [id]);
            if (!m.rowCount) throw Object.assign(new Error('DPI non trovato.'), { nonTrovato: true });
            if (m.rows[0].standard) {
                throw Object.assign(new Error('I DPI proposti da ORION non si eliminano: si nascondono.'), { conflitto: true });
            }
            const pieni = await client.query(
                `SELECT b.taglia FROM beni b JOIN beni_situazione s ON s.bene_id = b.id
                 WHERE b.modello_id = $1 AND b.dismesso_il IS NULL AND (s.in_magazzino > 0 OR s.fuori > 0)`, [id]);
            if (pieni.rowCount) {
                throw Object.assign(new Error(
                    `Ci sono ancora pezzi nelle taglie ${pieni.rows.map(r => r.taglia).join(', ')}: prima vanno scaricati o dismessi.`),
                { conflitto: true });
            }
            await client.query(
                `DELETE FROM beni b WHERE b.modello_id = $1 AND NOT EXISTS (SELECT 1 FROM movimenti mv WHERE mv.bene_id = b.id)`, [id]);
            await client.query(
                `UPDATE beni SET dismesso_il = COALESCE(dismesso_il, NOW()), modello_id = NULL WHERE modello_id = $1`, [id]);
            await client.query('DELETE FROM modelli_dpi WHERE id = $1', [id]);
            await client.query('COMMIT');
            registraAudit(req, 'magazzino.modello.eliminato', { tipo: 'modello_dpi', id, dettagli: { nome: m.rows[0].nome } });
            res.json({ message: `"${m.rows[0].nome}" eliminato.` });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.nonTrovato) return res.status(404).json({ message: e.message });
            if (e.conflitto) return res.status(409).json({ message: e.message });
            logger.error('Errore DELETE modello DPI:', e);
            res.status(500).json({ message: 'Errore nell\'eliminare il DPI.' });
        } finally {
            client.release();
        }
    });

    // Le taglie di una persona, per ogni DPI a taglie: alla consegna ORION
    // propone quelle, invece del quaderno delle taglie.
    //
    // Per un DPI già ricevuto vale la taglia che ha ancora addosso; se ne ha
    // restituite tutte, l'ultima consegnata. Così chi cambia taglia (una L
    // diventata stretta, scambiata con una XL) ha la nuova, e chi ha reso una
    // XL perché grande torna alla L che tiene ancora.
    //
    // Per un DPI mai ricevuto, la taglia di un altro DPI dello stesso gruppo
    // (busto, pantaloni, scarpe), segnata "dedotta": la giacca XL fa proporre
    // la polo XL, le scarpe 43 gli stivali 43. Solo se quella taglia esiste
    // per il DPI da consegnare; senza gruppo non si deduce niente.
    const normaTaglia = (t) => String(t).trim().toUpperCase();
    app.get('/api/magazzino/taglie/persona/:id', operatoreInterno, async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const [ricevute, modelli] = await Promise.all([
                pool.query(
                    `SELECT DISTINCT ON (b.modello_id) b.modello_id, b.taglia, md.nome AS modello, m.quando,
                            CASE WHEN b.gestione = 'singolo'
                                 THEN COALESCE(s.destinatario_tipo = 'persona' AND s.destinatario_user_id = $1, false)
                                 ELSE COALESCE((SELECT SUM(d.variazione) FROM detenzioni_sfusi d
                                                WHERE d.bene_id = b.id AND d.detentore_tipo = 'persona' AND d.user_id = $1), 0) > 0
                            END AS in_carico
                     FROM movimenti m JOIN beni b ON b.id = m.bene_id
                     JOIN modelli_dpi md ON md.id = b.modello_id
                     LEFT JOIN beni_situazione s ON s.bene_id = b.id
                     WHERE m.tipo = 'consegna' AND m.destinatario_user_id = $1
                       AND b.taglia IS NOT NULL AND LOWER(b.taglia) <> 'unica'
                     ORDER BY b.modello_id, in_carico DESC, m.quando DESC`, [id]),
                pool.query('SELECT id, nome, taglie, nascosto, gruppo_taglia FROM modelli_dpi')
            ]);
            const righe = ricevute.rows.map(r => ({
                modello_id: r.modello_id, taglia: r.taglia, modello: r.modello, dedotta: false
            }));
            const note = new Map(ricevute.rows.map(r => [r.modello_id, r]));
            const gruppoDi = new Map(modelli.rows.map(m => [m.id, m.gruppo_taglia]));
            // Fra le fonti possibili, prima quella che ha ancora in carico, poi la più recente.
            const fonti = [...ricevute.rows].sort((a, b) => (b.in_carico - a.in_carico) || (b.quando - a.quando));
            for (const m of modelli.rows) {
                const taglie = m.taglie || [];
                if (m.nascosto || !m.gruppo_taglia || note.has(m.id)) continue;
                const fonte = fonti.find(f => gruppoDi.get(f.modello_id) === m.gruppo_taglia
                    && taglie.some(t => normaTaglia(t) === normaTaglia(f.taglia)));
                if (!fonte) continue;
                righe.push({
                    modello_id: m.id, modello: m.nome, dedotta: true, da_modello: fonte.modello,
                    taglia: taglie.find(t => normaTaglia(t) === normaTaglia(fonte.taglia))
                });
            }
            res.json(righe);
        } catch (e) {
            logger.error('Errore GET taglie della persona:', e);
            res.status(500).json({ message: 'Errore nel leggere le taglie.' });
        }
    });

    // Chi può ricevere materiale: solo i nomi, non email e codici fiscali. Le
    // squadre e i mezzi compaiono solo se hanno ancora materiale in carico,
    // per poterlo far rientrare: nuove consegne vanno solo alle persone.
    app.get('/api/magazzino/destinatari', operatoreInterno, async (req, res) => {
        try {
            const [persone, squadre, veicoli] = await Promise.all([
                pool.query(`SELECT id, nome, cognome, username FROM users
                            WHERE COALESCE(is_active, true) = true AND role <> 'esterno'
                            ORDER BY cognome, nome`),
                pool.query(`SELECT s.id, s.nome, s.nome_radio FROM squadre s
                            WHERE EXISTS (SELECT 1 FROM beni_situazione bs JOIN beni b ON b.id = bs.bene_id
                                          WHERE b.gestione = 'singolo' AND b.dismesso_il IS NULL
                                            AND bs.destinatario_tipo = 'squadra' AND bs.destinatario_squadra_id = s.id)
                               OR (SELECT COALESCE(SUM(d.variazione), 0) FROM detenzioni_sfusi d
                                   WHERE d.detentore_tipo = 'squadra' AND d.squadra_id = s.id) > 0
                            ORDER BY s.nome_radio`),
                pool.query(`SELECT v.id, v.denominazione, v.matricola FROM beni v
                            WHERE v.tipo = 'veicolo' AND v.dismesso_il IS NULL
                              AND (EXISTS (SELECT 1 FROM beni_situazione bs JOIN beni b ON b.id = bs.bene_id
                                           WHERE b.gestione = 'singolo' AND b.dismesso_il IS NULL
                                             AND bs.destinatario_tipo = 'veicolo' AND bs.destinatario_bene_id = v.id)
                                OR (SELECT COALESCE(SUM(d.variazione), 0) FROM detenzioni_sfusi d
                                    WHERE d.detentore_tipo = 'veicolo' AND d.veicolo_id = v.id) > 0)
                            ORDER BY v.denominazione`)
            ]);
            res.json({
                persone: persone.rows.map(p => ({
                    id: p.id, nome: p.nome, cognome: p.cognome,
                    etichetta: nomePersona(p)
                })),
                squadre: squadre.rows.map(s => ({
                    id: s.id, nome_radio: s.nome_radio,
                    etichetta: s.nome ? `${s.nome_radio} - ${s.nome}` : `Squadra ${s.nome_radio}`
                })),
                veicoli: veicoli.rows.map(v => ({
                    id: v.id,
                    etichetta: v.matricola ? `${v.denominazione} (${v.matricola})` : v.denominazione
                }))
            });
        } catch (e) {
            logger.error('Errore GET destinatari magazzino:', e);
            res.status(500).json({ message: 'Errore nel leggere l\'elenco dei destinatari.' });
        }
    });

    // Anagrafica dei beni
    app.get('/api/magazzino/beni', async (req, res) => {
        try {
            const tipo = TIPI_BENE.includes(req.query.tipo) ? req.query.tipo : null;
            const cerca = String(req.query.q || '').trim();
            const soloDisponibili = req.query.disponibili === '1';
            const includiDismessi = req.query.dismessi === '1';
            const r = await pool.query(
                `SELECT b.id, b.tipo, b.gestione, b.denominazione, b.matricola, b.taglia,
                        b.unita_misura, b.quantita_totale, b.codice_etichetta, b.km,
                        b.patente_richiesta, b.dismesso_il, b.note, b.modello_id,
                        c.nome AS categoria, c.id AS categoria_id,
                        u.nome AS ubicazione, u.id AS ubicazione_id,
                        s.in_magazzino, s.fuori, s.disponibile,
                        s.destinatario_tipo, s.destinatario_nome, s.ultimo_movimento_il,
                        (SELECT MIN(sc.scadenza) FROM beni_scadenze sc WHERE sc.bene_id = b.id) AS prima_scadenza
                 FROM beni b
                 JOIN beni_situazione s ON s.bene_id = b.id
                 LEFT JOIN categorie_beni c ON c.id = b.categoria_id
                 LEFT JOIN ubicazioni u ON u.id = b.ubicazione_id
                 WHERE ($1::text IS NULL OR b.tipo::text = $1)
                   AND ($2 = '' OR b.denominazione ILIKE '%' || $2 || '%'
                                OR b.matricola ILIKE '%' || $2 || '%'
                                OR b.codice_etichetta ILIKE '%' || $2 || '%')
                   AND ($3::boolean = false OR s.disponibile = true)
                   AND ($4::boolean = true OR b.dismesso_il IS NULL)
                 ORDER BY b.tipo, b.denominazione, b.id`,
                [tipo, cerca, soloDisponibili, includiDismessi]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET beni:', e);
            res.status(500).json({ message: 'Errore nel leggere l\'elenco dei beni.' });
        }
    });

    // Il bene di un'etichetta: ricerca esatta, una cosa sola.
    app.get('/api/magazzino/etichetta/:codice', async (req, res) => {
        const codice = String(req.params.codice || '').trim().toUpperCase();
        if (!codice) return res.status(400).json({ message: 'Codice mancante.' });
        try {
            const r = await pool.query(
                `SELECT id, denominazione, tipo, matricola, taglia, dismesso_il
                 FROM beni WHERE UPPER(codice_etichetta) = $1`, [codice]);
            if (r.rowCount === 0) {
                return res.status(404).json({ message: `Nessun bene con l'etichetta ${codice}.` });
            }
            res.json(r.rows[0]);
        } catch (e) {
            logger.error('Errore lettura etichetta:', e);
            res.status(500).json({ message: "Errore nella lettura dell'etichetta." });
        }
    });

    // La scheda completa: anagrafica, situazione, scadenze e la sua storia.
    app.get('/api/magazzino/beni/:id', async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const bene = await pool.query(
                `SELECT b.*, c.nome AS categoria, u.nome AS ubicazione,
                        s.in_magazzino, s.fuori, s.disponibile,
                        s.destinatario_tipo, s.destinatario_nome, s.destinatario_user_id,
                        s.destinatario_squadra_id, s.ultimo_movimento, s.ultimo_movimento_il
                 FROM beni b
                 JOIN beni_situazione s ON s.bene_id = b.id
                 LEFT JOIN categorie_beni c ON c.id = b.categoria_id
                 LEFT JOIN ubicazioni u ON u.id = b.ubicazione_id
                 WHERE b.id = $1`, [id]);
            if (bene.rowCount === 0) return res.status(404).json({ message: 'Bene non trovato.' });

            const scadenze = await pool.query(
                'SELECT id, tipo, scadenza, ultimo_controllo, documento_url, note, periodicita_mesi FROM beni_scadenze WHERE bene_id = $1 ORDER BY scadenza',
                [id]);
            const storia = await pool.query(
                `SELECT id, tipo, quantita, destinatario_tipo, destinatario_nome, note,
                        quando, eseguito_da, emergency_id, km_registrati
                 FROM movimenti WHERE bene_id = $1 ORDER BY quando DESC, id DESC LIMIT 100`, [id]);

            res.json({ ...bene.rows[0], scadenze: scadenze.rows, storia: storia.rows });
        } catch (e) {
            logger.error(`Errore GET bene ${id}:`, e);
            res.status(500).json({ message: 'Errore nel leggere la scheda del bene.' });
        }
    });

    app.post('/api/magazzino/beni', soloMagazziniere, async (req, res) => {
        const client = await pool.connect();
        try {
            const dati = validaBene(req.body);
            await client.query('BEGIN');
            const r = await client.query(
                `INSERT INTO beni (tipo, gestione, categoria_id, denominazione, codice_etichetta, matricola,
                                   taglia, unita_misura, quantita_totale, ubicazione_id, km, patente_richiesta,
                                   posti, data_acquisto, valore, fornitore, note, creato_da)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
                [dati.tipo, dati.gestione, dati.categoria_id, dati.denominazione, dati.codice_etichetta,
                 dati.matricola, dati.taglia, dati.unita_misura, dati.quantita_totale, dati.ubicazione_id,
                 dati.km, dati.patente_richiesta, dati.posti, dati.data_acquisto, dati.valore,
                 dati.fornitore, dati.note, chiOpera(req)]);
            const beneId = r.rows[0].id;

            // Un bene nuovo è già in casa: il carico iniziale.
            const quantitaIniziale = dati.gestione === 'singolo' ? 1 : Number(dati.quantita_totale);
            if (quantitaIniziale > 0) {
                await registraMovimento(client, req, {
                    beneId, tipo: 'carico', quantita: quantitaIniziale,
                    destinatario: { tipo: 'magazzino', ubicazione_id: dati.ubicazione_id },
                    note: 'Carico iniziale alla creazione della scheda'
                });
            }
            await salvaScadenze(client, beneId, req.body.scadenze);
            await client.query('COMMIT');

            registraAudit(req, 'magazzino.bene.creato', {
                tipo: 'bene', id: beneId,
                dettagli: { denominazione: dati.denominazione, tipo_bene: dati.tipo, quantita: quantitaIniziale }
            });
            res.status(201).json({ id: beneId, ...dati });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
            if (e.code === '23505') return res.status(409).json({ message: 'Esiste già un bene con questo codice etichetta.' });
            logger.error('Errore POST bene:', e);
            res.status(500).json({ message: 'Errore nel creare il bene.' });
        } finally {
            client.release();
        }
    });

    app.put('/api/magazzino/beni/:id', soloMagazziniere, async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        const client = await pool.connect();
        try {
            const dati = validaBene(req.body, { modifica: true });
            await client.query('BEGIN');
            // Tipo e gestione non si cambiano: i movimenti non avrebbero più senso.
            const r = await client.query(
                `UPDATE beni SET categoria_id = $1, denominazione = $2, codice_etichetta = $3, matricola = $4,
                                 taglia = $5, unita_misura = $6, ubicazione_id = $7, km = $8,
                                 patente_richiesta = $9, posti = $10, data_acquisto = $11, valore = $12,
                                 fornitore = $13, note = $14
                 WHERE id = $15 RETURNING id, denominazione`,
                [dati.categoria_id, dati.denominazione, dati.codice_etichetta, dati.matricola, dati.taglia,
                 dati.unita_misura, dati.ubicazione_id, dati.km, dati.patente_richiesta, dati.posti,
                 dati.data_acquisto, dati.valore, dati.fornitore, dati.note, id]);
            if (r.rowCount === 0) throw erroreNonTrovato('Bene non trovato.');
            await salvaScadenze(client, id, req.body.scadenze);
            await client.query('COMMIT');
            registraAudit(req, 'magazzino.bene.modificato', { tipo: 'bene', id, dettagli: { denominazione: dati.denominazione } });
            res.json({ id, ...dati });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
            if (e.nonTrovato) return res.status(404).json({ message: e.message });
            if (e.code === '23505') return res.status(409).json({ message: 'Esiste già un bene con questo codice etichetta.' });
            logger.error(`Errore PUT bene ${id}:`, e);
            res.status(500).json({ message: 'Errore nel salvare il bene.' });
        } finally {
            client.release();
        }
    });

    function validaBene(corpo, { modifica = false } = {}) {
        const denominazione = String(corpo.denominazione || '').trim();
        if (!denominazione) throw erroreRichiesta('La denominazione è obbligatoria.');

        const tipo = corpo.tipo;
        if (!modifica && !TIPI_BENE.includes(tipo)) throw erroreRichiesta('Tipo di bene non valido (dpi, attrezzatura o veicolo).');

        const gestione = corpo.gestione === 'quantita' ? 'quantita' : 'singolo';
        if (!modifica && tipo === 'veicolo' && gestione !== 'singolo') {
            throw erroreRichiesta('Un veicolo è sempre un esemplare solo.');
        }
        let quantita = 1;
        if (!modifica && gestione === 'quantita') {
            quantita = quantitaValida(corpo.quantita_totale ?? 0, true);
            if (quantita === null || quantita < 0) throw erroreRichiesta('Indica quante unità ci sono in magazzino.');
            if (!Number.isInteger(quantita) && !unitaFrazionabile(corpo.unita_misura || 'pezzi')) {
                throw erroreRichiesta(`Si conta in ${String(corpo.unita_misura || 'pezzi').trim()}: la quantità dev'essere un numero intero.`);
            }
        }
        return {
            tipo, gestione,
            categoria_id: interoPositivo(corpo.categoria_id),
            denominazione,
            codice_etichetta: corpo.codice_etichetta ? String(corpo.codice_etichetta).trim() : null,
            matricola: corpo.matricola ? String(corpo.matricola).trim() : null,
            taglia: corpo.taglia ? String(corpo.taglia).trim() : null,
            unita_misura: String(corpo.unita_misura || 'pezzi').trim(),
            quantita_totale: quantita,
            ubicazione_id: interoPositivo(corpo.ubicazione_id),
            km: corpo.km === undefined || corpo.km === null || corpo.km === '' ? null : parseInt(corpo.km, 10) || 0,
            patente_richiesta: corpo.patente_richiesta ? String(corpo.patente_richiesta).trim() : null,
            posti: interoPositivo(corpo.posti),
            data_acquisto: corpo.data_acquisto || null,
            valore: corpo.valore === undefined || corpo.valore === null || corpo.valore === '' ? null : Number(corpo.valore),
            fornitore: corpo.fornitore ? String(corpo.fornitore).trim() : null,
            note: corpo.note ? String(corpo.note).trim() : null
        };
    }

    // Le scadenze arrivano complete, una per tipo: quelle assenti si tolgono.
    async function salvaScadenze(client, beneId, scadenze) {
        if (!Array.isArray(scadenze)) return;
        const valide = scadenze.filter(s => s && TIPI_SCADENZA.includes(s.tipo) && s.scadenza);
        const tipiTenuti = valide.map(s => s.tipo);
        await client.query(
            `DELETE FROM beni_scadenze WHERE bene_id = $1 AND ($2::text[] IS NULL OR tipo <> ALL($2::text[]))`,
            [beneId, tipiTenuti.length ? tipiTenuti : null]);
        for (const s of valide) {
            await client.query(
                `INSERT INTO beni_scadenze (bene_id, tipo, scadenza, ultimo_controllo, documento_url, note, periodicita_mesi, aggiornata_il)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
                 ON CONFLICT (bene_id, tipo) DO UPDATE
                 SET scadenza = EXCLUDED.scadenza, ultimo_controllo = EXCLUDED.ultimo_controllo,
                     documento_url = EXCLUDED.documento_url, note = EXCLUDED.note,
                     periodicita_mesi = EXCLUDED.periodicita_mesi, aggiornata_il = NOW()`,
                [beneId, s.tipo, s.scadenza, s.ultimo_controllo || null,
                 s.documento_url || null, s.note ? String(s.note).trim() : null,
                 periodicitaValida(s.periodicita_mesi)]);
        }
    }

    // Manutenzioni: registrarne una sposta la scadenza secondo la periodicità.
    app.get('/api/magazzino/beni/:id/interventi', async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const r = await pool.query(
                `SELECT id, tipo, eseguito_il, descrizione, documento_url, costo, fornitore,
                        registrato_da, registrato_il
                 FROM interventi_manutenzione WHERE bene_id = $1
                 ORDER BY eseguito_il DESC, id DESC`, [id]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET interventi:', e);
            res.status(500).json({ message: 'Errore nel leggere lo storico delle manutenzioni.' });
        }
    });

    app.post('/api/magazzino/beni/:id/interventi', soloMagazziniere,
        caricaDocumento ? caricaDocumento.single('documento') : (req, res, next) => next(),
        async (req, res) => {
            const id = interoPositivo(req.params.id);
            if (!id) return res.status(400).json({ message: 'ID non valido.' });

            const tipo = req.body?.tipo;
            if (!TIPI_SCADENZA.includes(tipo)) {
                return res.status(400).json({ message: 'Tipo di intervento non valido.' });
            }
            const eseguitoIl = req.body?.eseguito_il;
            if (!eseguitoIl || Number.isNaN(Date.parse(eseguitoIl))) {
                return res.status(400).json({ message: "Indica quando è stato fatto l'intervento." });
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const bene = await client.query('SELECT denominazione FROM beni WHERE id = $1', [id]);
                if (bene.rowCount === 0) throw erroreNonTrovato('Bene non trovato.');

                const documento = req.file ? `/api/magazzino/documenti/${req.file.filename}` : null;
                if (req.file) await proteggiCaricati(req.file);
                const intervento = await client.query(
                    `INSERT INTO interventi_manutenzione
                       (bene_id, tipo, eseguito_il, descrizione, documento_url, costo, fornitore, registrato_da)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
                    [id, tipo, eseguitoIl,
                     req.body.descrizione ? String(req.body.descrizione).trim() : null,
                     documento,
                     req.body.costo === undefined || req.body.costo === '' ? null : Number(req.body.costo),
                     req.body.fornitore ? String(req.body.fornitore).trim() : null,
                     chiOpera(req)]);

                // La prossima scadenza dalla periodicità; la prima volta si crea.
                const periodicita = periodicitaValida(req.body.periodicita_mesi);
                const esistente = await client.query(
                    'SELECT periodicita_mesi FROM beni_scadenze WHERE bene_id = $1 AND tipo = $2', [id, tipo]);
                const mesi = periodicita ?? esistente.rows[0]?.periodicita_mesi ?? null;

                let prossima = null;
                if (mesi) {
                    const r = await client.query(
                        `SELECT ($1::date + ($2::int * INTERVAL '1 month'))::date AS prossima`, [eseguitoIl, mesi]);
                    prossima = r.rows[0].prossima;
                    await client.query(
                        `INSERT INTO beni_scadenze (bene_id, tipo, scadenza, ultimo_controllo, periodicita_mesi, documento_url, aggiornata_il)
                         VALUES ($1,$2,$3,$4,$5,$6,NOW())
                         ON CONFLICT (bene_id, tipo) DO UPDATE
                         SET scadenza = EXCLUDED.scadenza, ultimo_controllo = EXCLUDED.ultimo_controllo,
                             periodicita_mesi = EXCLUDED.periodicita_mesi,
                             documento_url = COALESCE(EXCLUDED.documento_url, beni_scadenze.documento_url),
                             aggiornata_il = NOW()`,
                        [id, tipo, prossima, eseguitoIl, mesi, documento]);
                } else {
                    // Senza periodicità la scadenza non si sposta, ma almeno si
                    // segna quando è stato fatto l'ultimo controllo.
                    await client.query(
                        `UPDATE beni_scadenze SET ultimo_controllo = $3, aggiornata_il = NOW()
                         WHERE bene_id = $1 AND tipo = $2`, [id, tipo, eseguitoIl]);
                }

                await client.query('COMMIT');
                registraAudit(req, 'magazzino.manutenzione', {
                    tipo: 'bene', id,
                    dettagli: { denominazione: bene.rows[0].denominazione, intervento: tipo, eseguito_il: eseguitoIl }
                });
                res.status(201).json({ id: intervento.rows[0].id, prossima_scadenza: prossima, documento_url: documento });
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
                if (e.nonTrovato) return res.status(404).json({ message: e.message });
                logger.error('Errore POST intervento:', e);
                res.status(500).json({ message: "Errore nel registrare l'intervento." });
            } finally {
                client.release();
            }
        });

    // I documenti dei beni, dalla loro cartella.
    app.get('/api/magazzino/documenti/:filename', operatoreInterno, (req, res) => {
        if (!cartellaDocumenti) return res.status(404).json({ message: 'Documento non trovato.' });
        const percorso = path.resolve(cartellaDocumenti, req.params.filename);
        if (!percorso.startsWith(cartellaDocumenti + path.sep)) {
            logger.warn(`[SECURITY] Tentativo di path traversal sui documenti del magazzino: ${req.params.filename}`);
            return res.status(403).json({ message: 'Accesso negato.' });
        }
        if (!fs.existsSync(percorso)) return res.status(404).json({ message: 'Documento non trovato.' });
        inviaFile(res, percorso);
    });

    // Movimenti
    app.post('/api/magazzino/movimenti', operatoreInterno, async (req, res) => {
        const tipo = req.body?.tipo;
        if (!MOVIMENTI_OPERATIVI.includes(tipo) && !MOVIMENTI_DI_INVENTARIO.includes(tipo)) {
            return res.status(400).json({ message: 'Tipo di movimento non valido.' });
        }
        // Carichi, dismissioni e rettifiche a chi gestisce il magazzino; consegne,
        // rientri e trasferimenti a chi ha il permesso delle consegne.
        if (MOVIMENTI_OPERATIVI.includes(tipo) && !haPermesso(req, 'magazzino.consegne')) {
            return res.status(403).json({ message: 'Ti serve il permesso "Consegnare e far rientrare materiale".' });
        }
        if (MOVIMENTI_DI_INVENTARIO.includes(tipo) && !haPermesso(req, 'magazzino.gestione')) {
            return res.status(403).json({ message: `Serve il ruolo magazziniere per registrare un movimento di tipo "${ETICHETTE_MOVIMENTO[tipo] || tipo}".` });
        }
        const beneId = interoPositivo(req.body?.bene_id);
        if (!beneId) return res.status(400).json({ message: 'Manca il bene da movimentare.' });
        if (['consegna', 'trasferimento'].includes(tipo) && req.body?.destinatario?.tipo !== CONSEGNA_SOLO_A) {
            return res.status(400).json({ message: 'Il materiale si consegna a una persona.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const esito = await registraMovimento(client, req, {
                beneId, tipo,
                quantita: req.body.quantita ?? 1,
                destinatario: req.body.destinatario,
                note: req.body.note,
                km: req.body.km
            });
            await client.query('COMMIT');

            // Nell'audit gli atti sul patrimonio; consegne e rientri sono già nel registro.
            if (['carico', 'dismissione', 'smarrimento', 'rettifica'].includes(tipo)) {
                registraAudit(req, `magazzino.${tipo}`, {
                    tipo: 'bene', id: beneId,
                    dettagli: { denominazione: esito.bene.denominazione, quantita: req.body.quantita ?? 1, note: req.body.note || null }
                });
            }
            res.status(201).json({ id: esito.id, quando: esito.quando, destinatario: esito.destinatario.destinatario_nome, avviso: esito.avviso || null });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
            if (e.nonTrovato) return res.status(404).json({ message: e.message });
            logger.error('Errore POST movimento:', e);
            res.status(500).json({ message: 'Errore nel registrare il movimento.' });
        } finally {
            client.release();
        }
    });

    // Richieste idempotenti: l'app rimanda le consegne con una chiave, e la
    // stessa chiave non registra due volte.
    const FORMATO_CHIAVE = /^[A-Za-z0-9_-]{8,100}$/;
    const GIORNI_TENUTA_CHIAVI = 7;

    /**
     * La chiave si segna nella transazione, prima di tutto: due invii insieme
     * si mettono in fila e il secondo riceve la risposta del primo.
     * null senza chiave, { chiave } se nuova, { ripetuta: { stato, corpo } } se già servita.
     */
    async function prenotaIdempotenza(client, req, rotta) {
        const chiave = req.get('Idempotency-Key');
        if (chiave === undefined) return null;
        if (!FORMATO_CHIAVE.test(chiave)) {
            throw erroreRichiesta('Idempotency-Key non valida: da 8 a 100 caratteri fra lettere, cifre, - e _.');
        }
        const impronta = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
        const presa = await client.query(
            `INSERT INTO richieste_idempotenti (user_id, chiave, rotta, impronta)
             VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, chiave) DO NOTHING RETURNING 1`,
            [req.user.id, chiave, rotta, impronta]);
        if (presa.rowCount === 1) return { chiave };
        const prima = await client.query(
            `SELECT rotta, impronta, stato_risposta, risposta FROM richieste_idempotenti
             WHERE user_id = $1 AND chiave = $2`, [req.user.id, chiave]);
        const riga = prima.rows[0];
        if (!riga || riga.rotta !== rotta || riga.impronta !== impronta) {
            const errore = erroreRichiesta('Questa Idempotency-Key è già stata usata per una richiesta diversa.');
            errore.chiaveRiusata = true;
            throw errore;
        }
        return { ripetuta: { stato: riga.stato_risposta, corpo: riga.risposta } };
    }

    async function chiudiIdempotenza(client, req, prenotazione, stato, corpo) {
        if (!prenotazione?.chiave) return;
        await client.query(
            `UPDATE richieste_idempotenti SET stato_risposta = $3, risposta = $4
             WHERE user_id = $1 AND chiave = $2`,
            [req.user.id, prenotazione.chiave, stato, JSON.stringify(corpo)]);
    }

    async function pulisciIdempotenza() {
        try {
            const r = await pool.query(
                'DELETE FROM richieste_idempotenti WHERE creata_il < NOW() - make_interval(days => $1)',
                [GIORNI_TENUTA_CHIAVI]);
            if (r.rowCount > 0) logger.info(`[Magazzino] Rimosse ${r.rowCount} chiavi di idempotenza scadute.`);
        } catch (e) {
            logger.error('[Magazzino] Pulizia delle chiavi di idempotenza non riuscita:', { error: e.message });
        }
    }

    // Consegna di più oggetti in un colpo solo: è così che succede davvero,
    // un volontario riceve elmetto, giacca e scarponi insieme.
    app.post('/api/magazzino/consegna', richiedePermesso('magazzino.consegne'), async (req, res) => {
        const righe = Array.isArray(req.body?.righe) ? req.body.righe : [];
        if (righe.length === 0) return res.status(400).json({ message: 'Indica almeno un oggetto da consegnare.' });
        if (!req.body?.destinatario?.tipo) return res.status(400).json({ message: 'Indica a chi va la consegna.' });
        if (req.body.destinatario.tipo !== CONSEGNA_SOLO_A) {
            return res.status(400).json({ message: 'Il materiale si consegna a una persona.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const prenotazione = await prenotaIdempotenza(client, req, 'consegna');
            if (prenotazione?.ripetuta) {
                // Gia' servita: la stessa risposta, senza rifare niente.
                await client.query('ROLLBACK');
                res.set('Idempotent-Replayed', 'true');
                return res.status(prenotazione.ripetuta.stato || 201).json(prenotazione.ripetuta.corpo);
            }
            const dest = await risolviDestinatario(client, req.body.destinatario);

            // Il verbale solo a una persona. I DPI ci vanno sempre con la
            // conferma dei DPI, altrimenti se il magazzino lo prevede e chi
            // consegna lo chiede; attrezzature e mezzi solo se previsto e chiesto.
            const config = await leggiConfig();
            const idBeni = righe.map(r => interoPositivo(r?.bene_id)).filter(Boolean);
            const tipoDi = new Map((await client.query('SELECT id, tipo FROM beni WHERE id = ANY($1::int[])', [idBeni]))
                .rows.map(b => [b.id, b.tipo]));
            const richiesto = !!req.body.verbale;
            const inVerbale = (beneId) => dest.destinatario_tipo === 'persona'
                && nelVerbale(config, tipoDi.get(beneId), 'consegna', richiesto);
            const conVerbale = idBeni.some(inVerbale);
            // La conferma dal telefono solo se nel verbale ci sono dei DPI.
            const daConfermare = conVerbale && !!config.conferma_dpi && idBeni.some(id => tipoDi.get(id) === 'dpi');
            let verbaleId = null;
            if (conVerbale) {
                const v = await client.query(
                    `INSERT INTO verbali_consegna (user_id, destinatario_nome, emesso_da, stato, note)
                     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
                    [dest.destinatario_user_id, dest.destinatario_nome, chiOpera(req),
                     'da_confermare', req.body.note ? String(req.body.note).trim() : null]);
                verbaleId = v.rows[0].id;
            }

            const fatti = [];
            const avvisi = [];
            for (const riga of righe) {
                const beneId = interoPositivo(riga?.bene_id);
                if (!beneId) throw erroreRichiesta('Una delle righe non indica quale bene consegnare.');
                const esito = await registraMovimento(client, req, {
                    beneId, tipo: 'consegna',
                    quantita: riga.quantita ?? 1,
                    destinatario: req.body.destinatario,
                    note: riga.note || null,
                    verbaleId: inVerbale(beneId) ? verbaleId : null
                });
                fatti.push({ movimento_id: esito.id, bene_id: beneId, denominazione: esito.bene.denominazione });
                if (esito.avviso) avvisi.push(esito.avviso);
            }
            const risposta = { consegnati: fatti, destinatario: dest.destinatario_nome, verbale_id: verbaleId, avvisi };
            await chiudiIdempotenza(client, req, prenotazione, 201, risposta);
            await client.query('COMMIT');
            if (typeof avvisaClienti === 'function') avvisaClienti('reload_magazzino');
            // Con la conferma dei DPI, chi riceve lo sa dal telefono. Dopo il COMMIT.
            const quantiNelVerbale = fatti.filter(f => inVerbale(f.bene_id)).length;
            if (verbaleId && dest.destinatario_user_id && typeof notifica === 'function' && daConfermare) {
                await notifica(dest.destinatario_user_id, {
                    tipo: 'dpi_da_confermare',
                    titolo: 'Hai ricevuto dei DPI da confermare',
                    testo: `${quantiNelVerbale === 1 ? 'Un oggetto consegnato' : `${quantiNelVerbale} oggetti consegnati`} da ${chiOpera(req)}.`,
                    riferimento: { tipo: 'verbale', id: verbaleId }
                });
            }
            res.status(201).json(risposta);
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.chiaveRiusata) return res.status(422).json({ message: e.message });
            if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
            if (e.nonTrovato) return res.status(404).json({ message: e.message });
            logger.error('Errore POST consegna:', e);
            res.status(500).json({ message: 'Errore nel registrare la consegna.' });
        } finally {
            client.release();
        }
    });

    // Rientro. Sugli sfusi, se torna meno di quanto è uscito, chi registra dice
    // cosa ne è del resto (in carico, usato sul posto, perso): senza, si rifiuta.
    const DESTINI_RESTO = ['in_carico', 'consumo', 'perso'];
    app.post('/api/magazzino/rientro', richiedePermesso('magazzino.consegne'), async (req, res) => {
        const righe = Array.isArray(req.body?.righe) ? req.body.righe : [];
        if (righe.length === 0) return res.status(400).json({ message: 'Indica almeno un oggetto che rientra.' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const da = await risolviDetentore(client, req.body?.da);

            // Il verbale di rientro solo da una persona e solo se acceso per
            // quel genere di materiale (DPI, oppure attrezzature e mezzi):
            // spento, la richiesta lo ignora senza fallire.
            const config = await leggiConfig();
            const idBeni = righe.map(r => interoPositivo(r?.bene_id)).filter(Boolean);
            const tipoDi = new Map((await client.query('SELECT id, tipo FROM beni WHERE id = ANY($1::int[])', [idBeni]))
                .rows.map(b => [b.id, b.tipo]));
            const inVerbale = (beneId) => da?.tipo === 'persona' && nelVerbale(config, tipoDi.get(beneId), 'rientro', !!req.body?.verbale);
            let verbaleId = null;
            let collegati = 0;
            if (idBeni.some(inVerbale)) {
                const chi = await client.query('SELECT id, nome, cognome, username FROM users WHERE id = $1', [da.user_id]);
                const v = await client.query(
                    `INSERT INTO verbali_consegna (user_id, destinatario_nome, emesso_da, stato, tipo, note)
                     VALUES ($1,$2,$3,'da_firmare','rientro',$4) RETURNING id`,
                    [da.user_id, nomePersona(chi.rows[0]), chiOpera(req),
                     req.body.note ? String(req.body.note).trim() : null]);
                verbaleId = v.rows[0].id;
            }

            const fatti = [];
            // Quello che resta a chi restituisce: nel verbale va scritto, se
            // no il foglio firmato direbbe solo metà della storia.
            const restanoInCarico = [];
            for (const riga of righe) {
                const beneId = interoPositivo(riga?.bene_id);
                if (!beneId) throw erroreRichiesta('Una delle righe non indica quale bene rientra.');
                const bene = await leggiSituazione(client, beneId);

                // Quanto ne ha chi lo rende: uno, o il saldo di quel detentore.
                let origine = da;
                let uscito;
                if (bene.gestione === 'singolo') {
                    uscito = 1;
                } else if (origine) {
                    uscito = await saldoDetentore(client, beneId, origine);
                } else {
                    const detentori = await detentoriDi(client, beneId);
                    if (detentori.length > 1) {
                        throw erroreRichiesta(`"${bene.denominazione}" lo hanno in carico più detentori: indica da chi rientra.`);
                    }
                    origine = detentori[0] || null;
                    // Nessun detentore noto: materiale uscito prima che si
                    // tenesse il conto per detentore. Vale il totale fuori.
                    uscito = origine ? origine.saldo : Number(bene.fuori);
                }
                const daChi = origine ? { tipo: origine.tipo, id: origine.user_id ?? origine.squadra_id ?? origine.bene_id } : null;
                // Zero è una risposta valida: non torna niente, e si dice
                // cosa ne è del resto.
                const letta = Number(riga.quantita);
                const rientrata = riga.quantita === undefined || riga.quantita === null || riga.quantita === ''
                    ? uscito
                    : (Number.isFinite(letta) && letta >= 0 ? Math.round(letta * 100) / 100 : null);
                if (rientrata === null) throw erroreRichiesta('La quantità rientrata non è un numero valido.');
                if (rientrata > uscito) {
                    throw erroreRichiesta(`Di "${bene.denominazione}" risultano fuori ${uscito} ${bene.unita_misura}: non ne possono rientrare ${rientrata}.`);
                }

                if (rientrata > 0) {
                    const esito = await registraMovimento(client, req, {
                        beneId, tipo: 'rientro', quantita: rientrata,
                        destinatario: { tipo: 'magazzino', ubicazione_id: riga.ubicazione_id },
                        note: riga.note || null, km: riga.km, da: daChi, verbaleId: inVerbale(beneId) ? verbaleId : null
                    });
                    if (verbaleId && inVerbale(beneId)) collegati++;
                    fatti.push({ movimento_id: esito.id, bene_id: beneId, tipo: 'rientro', quantita: rientrata });
                }

                // Quello che non torna: lo dice chi registra, riga per riga.
                const mancante = Math.round((uscito - rientrata) * 100) / 100;
                if (mancante > 0 && bene.gestione === 'quantita') {
                    const resto = riga.resto;
                    const quanto = `${mancante} ${mancante === 1 && bene.unita_misura === 'pezzi' ? 'pezzo' : bene.unita_misura}`;
                    if (!DESTINI_RESTO.includes(resto)) {
                        throw erroreRichiesta(`Di "${bene.denominazione}" ne tornano ${rientrata} su ${uscito}: ` +
                            `indica se i restanti ${quanto} restano in carico, sono stati usati sul posto o sono persi.`);
                    }
                    if (resto === 'in_carico') {
                        if (!origine) {
                            throw erroreRichiesta(`Di "${bene.denominazione}" non si sa chi abbia i restanti ${quanto}: ` +
                                'non possono restare in carico a nessuno. Indica se sono stati usati o sono persi.');
                        }
                        // Nessun movimento: restano dove sono, e chi ha cosa lo mostra.
                        if (inVerbale(beneId)) restanoInCarico.push(`${bene.denominazione}${bene.taglia ? ` (taglia ${bene.taglia})` : ''}: ${quanto}`);
                    } else {
                        const tipo = resto === 'consumo' ? 'consumo' : 'smarrimento';
                        const esito = await registraMovimento(client, req, {
                            beneId, tipo, quantita: mancante,
                            destinatario: tipo === 'consumo' ? { tipo: 'consumato', nome: 'Impiegato sul posto' } : { tipo: 'perso' },
                            note: String(riga.note_resto || riga.note_consumo || '').trim() || (tipo === 'consumo'
                                ? 'Usato sul posto: non rientrato, indicato al rientro'
                                : 'Dichiarato perso al rientro'),
                            da: daChi, verbaleId: inVerbale(beneId) ? verbaleId : null
                        });
                        if (verbaleId && inVerbale(beneId)) collegati++;
                        fatti.push({ movimento_id: esito.id, bene_id: beneId, tipo, quantita: mancante });
                    }
                }
            }
            if (verbaleId && restanoInCarico.length) {
                const r = await client.query('SELECT note FROM verbali_consegna WHERE id = $1', [verbaleId]);
                const riga = `Restano in carico a chi restituisce: ${restanoInCarico.join('; ')}.`;
                await client.query('UPDATE verbali_consegna SET note = $2 WHERE id = $1',
                    [verbaleId, [r.rows[0].note, riga].filter(Boolean).join('\n')]);
            }
            // Un verbale senza righe (tutto a zero) non ha niente da far firmare.
            if (verbaleId && collegati === 0) {
                await client.query('DELETE FROM verbali_consegna WHERE id = $1', [verbaleId]);
                verbaleId = null;
            }
            await client.query('COMMIT');
            if (typeof avvisaClienti === 'function') avvisaClienti('reload_magazzino');
            res.status(201).json({ registrati: fatti, verbale_id: verbaleId });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.richiestaNonValida) return res.status(400).json({ message: e.message });
            if (e.nonTrovato) return res.status(404).json({ message: e.message });
            logger.error('Errore POST rientro:', e);
            res.status(500).json({ message: 'Errore nel registrare il rientro.' });
        } finally {
            client.release();
        }
    });

    app.get('/api/magazzino/movimenti', async (req, res) => {
        try {
            const beneId = interoPositivo(req.query.bene_id);
            const emergenzaId = interoPositivo(req.query.emergency_id);
            const limite = Math.min(interoPositivo(req.query.limit) || 100, 500);
            const r = await pool.query(
                `SELECT m.id, m.bene_id, m.bene_denominazione, m.tipo, m.quantita,
                        m.destinatario_tipo, m.destinatario_nome, m.note, m.quando,
                        m.eseguito_da, m.emergency_id, m.km_registrati, b.unita_misura, b.tipo AS tipo_bene
                 FROM movimenti m JOIN beni b ON b.id = m.bene_id
                 WHERE ($1::int IS NULL OR m.bene_id = $1)
                   AND ($2::int IS NULL OR m.emergency_id = $2)
                 ORDER BY m.quando DESC, m.id DESC LIMIT $3`,
                [beneId, emergenzaId, limite]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET movimenti:', e);
            res.status(500).json({ message: 'Errore nel leggere il registro dei movimenti.' });
        }
    });

    // Le viste operative: chi ha cosa, cosa scade, cosa manca
    app.get('/api/magazzino/chi-ha-cosa', async (req, res) => {
        try {
            // Singoli: la destinazione dell'ultimo movimento. Sfusi: il saldo per detentore.
            const singoli = await pool.query(
                `SELECT b.id AS bene_id, b.denominazione, b.tipo AS tipo_bene, b.matricola, b.gestione,
                        b.categoria_id, b.modello_id, b.taglia,
                        1::numeric AS quantita, b.unita_misura,
                        s.destinatario_tipo, s.destinatario_nome, s.destinatario_user_id,
                        s.destinatario_squadra_id, s.ultimo_movimento_il AS da_quando
                 FROM beni b JOIN beni_situazione s ON s.bene_id = b.id
                 WHERE b.gestione = 'singolo' AND b.dismesso_il IS NULL
                   AND s.destinatario_tipo IS NOT NULL
                   AND s.destinatario_tipo NOT IN ('magazzino', 'dismesso', 'consumato', 'perso')`);

            // Sugli sfusi, per detentore: arrivi meno uscite (update-25).
            // Il nome e' quello scritto nell'ultima consegna a quel detentore.
            const sfusi = await pool.query(
                `SELECT b.id AS bene_id, b.denominazione, b.tipo AS tipo_bene, b.matricola, b.gestione,
                        b.categoria_id, b.modello_id, b.taglia,
                        SUM(d.variazione) AS quantita, b.unita_misura,
                        d.detentore_tipo AS destinatario_tipo,
                        (SELECT n.detentore_nome FROM detenzioni_sfusi n
                          WHERE n.bene_id = b.id AND n.detentore_tipo = d.detentore_tipo
                            AND n.user_id IS NOT DISTINCT FROM d.user_id
                            AND n.squadra_id IS NOT DISTINCT FROM d.squadra_id
                            AND n.veicolo_id IS NOT DISTINCT FROM d.veicolo_id
                            AND n.detentore_nome IS NOT NULL
                          ORDER BY n.quando DESC LIMIT 1) AS destinatario_nome,
                        d.user_id AS destinatario_user_id, d.squadra_id AS destinatario_squadra_id,
                        MAX(d.quando) AS da_quando
                 FROM detenzioni_sfusi d
                 JOIN beni b ON b.id = d.bene_id
                 WHERE b.dismesso_il IS NULL
                 GROUP BY b.id, b.denominazione, b.tipo, b.matricola, b.gestione, b.unita_misura,
                          b.categoria_id, b.modello_id, b.taglia,
                          d.detentore_tipo, d.user_id, d.squadra_id, d.veicolo_id
                 HAVING SUM(d.variazione) > 0`);

            res.json([...singoli.rows, ...sfusi.rows].sort((a, b) =>
                String(a.destinatario_nome || '').localeCompare(String(b.destinatario_nome || ''))));
        } catch (e) {
            logger.error('Errore GET chi-ha-cosa:', e);
            res.status(500).json({ message: 'Errore nel calcolare chi ha cosa.' });
        }
    });

    // Quello che scade nei prossimi N giorni e tutto quello già scaduto. La
    // usano la pagina e l'email: una query sola, una risposta sola.
    async function scadenzeEntro(giorni) {
        const r = await pool.query(
            `SELECT s.id, s.bene_id, s.tipo, s.scadenza, s.ultimo_controllo,
                    b.denominazione, b.tipo AS tipo_bene, b.matricola,
                    (s.scadenza - CURRENT_DATE) AS giorni_restanti
             FROM beni_scadenze s JOIN beni b ON b.id = s.bene_id
             WHERE b.dismesso_il IS NULL AND (s.scadenza - CURRENT_DATE) <= $1
             ORDER BY s.scadenza`, [giorni]);
        return r.rows;
    }

    app.get('/api/magazzino/scadenze', async (req, res) => {
        try {
            const giorni = Math.min(interoPositivo(req.query.giorni) || 30, 365);
            res.json(await scadenzeEntro(giorni));
        } catch (e) {
            logger.error('Errore GET scadenze magazzino:', e);
            res.status(500).json({ message: 'Errore nel leggere le scadenze.' });
        }
    });

    // Quello che è uscito e non è tornato. Non i DPI in dotazione, che restano
    // al volontario per anni, tranne quelli di chi non è più iscritto.
    async function daRecuperare(giorni) {
        const r = await pool.query(
            `SELECT b.id AS bene_id, b.denominazione, b.tipo AS tipo_bene, b.matricola, b.gestione,
                    s.destinatario_tipo, s.destinatario_nome, s.destinatario_user_id, s.destinatario_squadra_id,
                    s.ultimo_movimento_il AS fuori_da,
                    EXTRACT(DAY FROM NOW() - s.ultimo_movimento_il)::int AS giorni_fuori,
                    (b.tipo = 'dpi' AND s.destinatario_tipo = 'persona') AS volontario_cancellato,
                    ult.emergency_id, e.code AS emergenza_codice, e.name AS emergenza_nome, e.status AS emergenza_stato
             FROM beni b
             JOIN beni_situazione s ON s.bene_id = b.id
             LEFT JOIN LATERAL (
                 SELECT m.emergency_id FROM movimenti m
                 WHERE m.bene_id = b.id ORDER BY m.quando DESC, m.id DESC LIMIT 1
             ) ult ON true
             LEFT JOIN emergencies e ON e.id = ult.emergency_id
             WHERE b.dismesso_il IS NULL
               AND s.destinatario_tipo IN ('persona', 'squadra', 'veicolo', 'officina')
               AND EXTRACT(DAY FROM NOW() - s.ultimo_movimento_il)::int >= $1
               -- Un DPI addosso a un volontario ancora iscritto è in
               -- dotazione, non in ritardo.
               AND NOT (b.tipo = 'dpi' AND s.destinatario_tipo = 'persona'
                        AND s.destinatario_user_id IS NOT NULL)
             ORDER BY s.ultimo_movimento_il`, [giorni]);
        return r.rows;
    }

    app.get('/api/magazzino/da-recuperare', async (req, res) => {
        try {
            res.json(await daRecuperare(interoPositivo(req.query.giorni) || 0));
        } catch (e) {
            logger.error('Errore GET da-recuperare:', e);
            res.status(500).json({ message: 'Errore nel calcolare cosa resta fuori.' });
        }
    });

    // Gli avvisi email delle scadenze: ognuno decide per sé se e ogni quanto.
    // Senza una riga in tabella, niente email.
    const AVVISI_PREDEFINITI = {
        attivo: false,
        frequenza: 'settimanale',
        giorni_preavviso: 30,
        includi_da_recuperare: true,
        ultimo_invio: null
    };
    const FREQUENZE = ['giornaliera', 'settimanale', 'mensile'];

    app.get('/api/magazzino/avvisi', soloMagazziniere, async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT attivo, frequenza, giorni_preavviso, includi_da_recuperare, ultimo_invio
                 FROM avvisi_magazzino WHERE user_id = $1`, [req.user.id]);
            res.json(r.rowCount > 0 ? r.rows[0] : { ...AVVISI_PREDEFINITI });
        } catch (e) {
            logger.error('Errore GET avvisi magazzino:', e);
            res.status(500).json({ message: 'Errore nel leggere le impostazioni degli avvisi.' });
        }
    });

    app.put('/api/magazzino/avvisi', soloMagazziniere, async (req, res) => {
        const corpo = req.body || {};
        const frequenza = corpo.frequenza || AVVISI_PREDEFINITI.frequenza;
        if (!FREQUENZE.includes(frequenza)) {
            return res.status(400).json({ message: `La frequenza può valere ${FREQUENZE.join(', ')}.` });
        }
        const giorni = interoPositivo(corpo.giorni_preavviso) || AVVISI_PREDEFINITI.giorni_preavviso;
        if (giorni > 365) {
            return res.status(400).json({ message: 'Il preavviso non può superare i 365 giorni.' });
        }
        try {
            // Senza indirizzo lo si dice subito.
            const utente = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
            if (corpo.attivo && !utente.rows[0]?.email) {
                return res.status(400).json({
                    message: 'Nel tuo profilo non c\'è un indirizzo email: senza quello gli avvisi non possono partire.'
                });
            }
            const r = await pool.query(
                `INSERT INTO avvisi_magazzino (user_id, attivo, frequenza, giorni_preavviso, includi_da_recuperare, aggiornato_il)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (user_id) DO UPDATE SET
                     attivo = EXCLUDED.attivo,
                     frequenza = EXCLUDED.frequenza,
                     giorni_preavviso = EXCLUDED.giorni_preavviso,
                     includi_da_recuperare = EXCLUDED.includi_da_recuperare,
                     aggiornato_il = NOW()
                 RETURNING attivo, frequenza, giorni_preavviso, includi_da_recuperare, ultimo_invio`,
                [req.user.id, !!corpo.attivo, frequenza, giorni, corpo.includi_da_recuperare !== false]);
            res.json(r.rows[0]);
        } catch (e) {
            logger.error('Errore PUT avvisi magazzino:', e);
            res.status(500).json({ message: 'Errore nel salvare le impostazioni degli avvisi.' });
        }
    });

    // Invio di prova: non tocca la data dell'ultimo invio, e parte anche senza scadenze.
    app.post('/api/magazzino/avvisi/prova', soloMagazziniere, async (req, res) => {
        try {
            const utente = await pool.query('SELECT nome, cognome, email FROM users WHERE id = $1', [req.user.id]);
            const destinatario = utente.rows[0];
            if (!destinatario?.email) {
                return res.status(400).json({ message: 'Nel tuo profilo non c\'è un indirizzo email.' });
            }
            const preferenze = await pool.query(
                'SELECT giorni_preavviso, includi_da_recuperare FROM avvisi_magazzino WHERE user_id = $1',
                [req.user.id]);
            const esito = await inviaAvvisoA({
                ...AVVISI_PREDEFINITI,
                ...(preferenze.rows[0] || {}),
                ...destinatario
            }, { anchePerNiente: true });

            if (!esito.inviato) {
                return res.status(502).json({ message: `L'email non è partita: ${esito.errore}` });
            }
            res.json({ message: `Email di prova inviata a ${destinatario.email}.` });
        } catch (e) {
            logger.error('Errore invio avviso di prova:', e);
            res.status(500).json({ message: 'Errore nell\'invio dell\'email di prova.' });
        }
    });

    // Compone e manda l'email a una persona; non lancia, restituisce l'esito.
    async function inviaAvvisoA(destinatario, opzioni = {}) {
        const config = await leggiConfig();
        const scadenze = await scadenzeEntro(destinatario.giorni_preavviso);
        const fuori = destinatario.includi_da_recuperare
            ? await daRecuperare(config.giorni_avviso_recupero)
            : [];

        if (!scadenze.length && !fuori.length && !opzioni.anchePerNiente) {
            return { inviato: false, niente: true };
        }

        const html = componiEmailAvvisi(destinatario, scadenze, fuori);
        const testo = componiTestoAvvisi(destinatario, scadenze, fuori);
        const oggetto = scadenze.length
            ? `[ORION] Magazzino: ${scadenze.length} scadenz${scadenze.length === 1 ? 'a' : 'e'} da guardare`
            : '[ORION] Magazzino: riepilogo';

        const esito = await inviaEmail(destinatario.email, oggetto, testo, html);
        return esito?.success
            ? { inviato: true, scadenze: scadenze.length, fuori: fuori.length }
            : { inviato: false, errore: esito?.error || 'errore sconosciuto' };
    }

    function statoScadenza(giorniRestanti) {
        if (giorniRestanti < 0) return { testo: `Scaduta da ${Math.abs(giorniRestanti)} gg`, colore: '#dc2626' };
        if (giorniRestanti === 0) return { testo: 'Scade oggi', colore: '#dc2626' };
        if (giorniRestanti <= 30) return { testo: `Fra ${giorniRestanti} gg`, colore: '#b45309' };
        return { testo: `Fra ${giorniRestanti} gg`, colore: '#15803d' };
    }

    function componiEmailAvvisi(destinatario, scadenze, fuori) {
        const e = escapeHtml;
        const cella = 'padding: 10px; border-bottom: 1px solid #e2e8f0; color: #334155;';
        const intestazione = 'padding: 12px 10px; border-bottom: 2px solid #cbd5e1; color: #64748b; text-align: left;';

        let corpo = '';
        if (scadenze.length) {
            corpo += `
                <h3 style="color: #1e293b; margin: 24px 0 8px 0;">Scadenze</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">
                    <thead style="background-color: #f8fafc;"><tr>
                        <th style="${intestazione}">Bene</th>
                        <th style="${intestazione}">Cosa scade</th>
                        <th style="${intestazione}">Data</th>
                        <th style="${intestazione} text-align: right;">Stato</th>
                    </tr></thead>
                    <tbody>${scadenze.map(s => {
                        const stato = statoScadenza(Number(s.giorni_restanti));
                        const dettaglio = s.matricola ? ` <span style="color:#94a3b8;">(${e(s.matricola)})</span>` : '';
                        return `<tr>
                            <td style="${cella}"><strong>${e(s.denominazione)}</strong>${dettaglio}</td>
                            <td style="${cella}">${e(ETICHETTE_SCADENZA[s.tipo] || s.tipo)}</td>
                            <td style="${cella}">${e(dataItaliana(s.scadenza))}</td>
                            <td style="${cella} text-align: right; font-weight: bold; color: ${stato.colore};">${e(stato.testo)}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>`;
        }

        if (fuori.length) {
            corpo += `
                <h3 style="color: #1e293b; margin: 24px 0 8px 0;">Materiale fuori da tempo</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">
                    <thead style="background-color: #f8fafc;"><tr>
                        <th style="${intestazione}">Bene</th>
                        <th style="${intestazione}">Chi ce l'ha</th>
                        <th style="${intestazione} text-align: right;">Da</th>
                    </tr></thead>
                    <tbody>${fuori.map(f => `<tr>
                        <td style="${cella}"><strong>${e(f.denominazione)}</strong></td>
                        <td style="${cella}">${e(f.destinatario_nome || '-')}${f.volontario_cancellato ? ' <span style="color:#dc2626;">(non più iscritto)</span>' : ''}</td>
                        <td style="${cella} text-align: right;">${e(String(f.giorni_fuori))} gg</td>
                    </tr>`).join('')}</tbody>
                </table>`;
        }

        if (!corpo) {
            corpo = '<p style="color: #334155;">In questo momento non c\'è niente in scadenza e niente fuori da recuperare.</p>';
        }

        return `
            <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-top: 0;">Magazzino: cosa guardare</h2>
                <p style="color: #334155;">Ciao ${e(destinatario.nome || '')}, ecco la situazione del magazzino al ${e(new Date().toLocaleDateString('it-IT'))}.</p>
                ${corpo}
                <p style="margin-top: 28px;"><a href="https://${e(dominio)}/magazzino.html" style="color: #2563eb;">Apri il magazzino</a></p>
                <p style="font-size: 0.8rem; color: #94a3b8; margin-top: 24px;">Ricevi questa email perché l'hai chiesto tu nelle impostazioni del magazzino. Si spegne da lì, nella scheda Impostazioni.</p>
            </div>`;
    }

    function componiTestoAvvisi(destinatario, scadenze, fuori) {
        const righe = [`Magazzino: cosa guardare (${new Date().toLocaleDateString('it-IT')})`, ''];
        if (scadenze.length) {
            righe.push('SCADENZE');
            scadenze.forEach(s => righe.push(
                `- ${s.denominazione}${s.matricola ? ` (${s.matricola})` : ''}: ${ETICHETTE_SCADENZA[s.tipo] || s.tipo}` +
                ` il ${dataItaliana(s.scadenza)} (${statoScadenza(Number(s.giorni_restanti)).testo})`));
            righe.push('');
        }
        if (fuori.length) {
            righe.push('MATERIALE FUORI DA TEMPO');
            fuori.forEach(f => righe.push(`- ${f.denominazione}: ${f.destinatario_nome || '-'}, da ${f.giorni_fuori} giorni`));
            righe.push('');
        }
        if (!scadenze.length && !fuori.length) {
            righe.push('Niente in scadenza e niente fuori da recuperare.');
            righe.push('');
        }
        righe.push(`Apri il magazzino: https://${dominio}/magazzino.html`);
        return righe.join('\n');
    }

    // Dal giro quotidiano (scadenze.js). Il periodo si misura dall'ultimo invio
    // riuscito di ciascuno: un giorno di fermo o un invio fallito si recuperano.
    async function inviaAvvisiScadenze() {
        if (!(await moduloAcceso())) return { destinatari: 0, inviati: 0 };

        const chi = sqlHaPermesso('magazzino.gestione', 1);
        const destinatari = await pool.query(`
            SELECT a.user_id, a.frequenza, a.giorni_preavviso, a.includi_da_recuperare,
                   u.nome, u.cognome, u.email
            FROM avvisi_magazzino a
            JOIN users u ON u.id = a.user_id
            WHERE a.attivo = true AND u.is_active = true AND u.email IS NOT NULL
              -- Chi non tiene più il magazzino smette di ricevere gli avvisi
              -- senza doverlo dire: basta togliergli il ruolo o il permesso.
              AND ${chi.condizione}
              AND (
                a.ultimo_invio IS NULL
                OR (a.frequenza = 'giornaliera' AND a.ultimo_invio < CURRENT_DATE)
                OR (a.frequenza = 'settimanale' AND date_trunc('week', a.ultimo_invio) < date_trunc('week', CURRENT_DATE))
                OR (a.frequenza = 'mensile' AND date_trunc('month', a.ultimo_invio) < date_trunc('month', CURRENT_DATE))
              )`, chi.parametri);

        let inviati = 0;
        let falliti = 0;
        let primoErrore = null;
        for (const destinatario of destinatari.rows) {
            const esito = await inviaAvvisoA(destinatario);
            if (esito.inviato) {
                inviati++;
                await pool.query('UPDATE avvisi_magazzino SET ultimo_invio = CURRENT_DATE WHERE user_id = $1',
                    [destinatario.user_id]);
            } else if (!esito.niente) {
                falliti++;
                primoErrore = primoErrore || esito.errore;
            }
        }

        if (inviati || falliti) {
            const riepilogo = `[Magazzino] Avvisi scadenze: ${inviati} inviati, ${falliti} non inviati.`;
            if (falliti) logger.error(`${riepilogo} Primo errore: ${primoErrore}`);
            else logger.info(riepilogo);
        }
        return { destinatari: destinatari.rowCount, inviati, falliti };
    }

    // Quello che una persona, una squadra o un mezzo ha in carico adesso.
    app.get('/api/magazzino/in-carico/:tipo/:id', async (req, res) => {
        const tipo = req.params.tipo;
        const id = interoPositivo(req.params.id);
        if (!['persona', 'squadra', 'veicolo'].includes(tipo) || !id) {
            return res.status(400).json({ message: 'Detentore non valido.' });
        }
        // Il proprio lo vede chiunque; quello degli altri ogni operatore interno.
        const proprio = tipo === 'persona' && id === req.user.id;
        if (!proprio && ruoliDi(req.user).includes('esterno')) {
            return res.status(403).json({ message: 'Puoi vedere solo il materiale che hai in carico tu.' });
        }
        try {
            res.json(await beniInCarico(pool, tipo, id));
        } catch (e) {
            logger.error('Errore GET in-carico:', e);
            res.status(500).json({ message: 'Errore nel leggere il materiale in carico.' });
        }
    });

    // Verbali di consegna

    // I propri verbali, solo i propri. Prima di /verbali/:id, che prenderebbe "miei" per un id.
    const STATI_VERBALE = ['da_confermare', 'da_firmare', 'confermato', 'firmato_cartaceo'];
    app.get('/api/magazzino/verbali/miei', async (req, res) => {
        const stato = req.query.stato === undefined ? null : String(req.query.stato);
        if (stato !== null && !STATI_VERBALE.includes(stato)) {
            return res.status(400).json({ message: `Lo stato può valere ${STATI_VERBALE.join(', ')}.` });
        }
        try {
            const r = await pool.query(
                `SELECT v.id, v.user_id, v.destinatario_nome, v.emesso_il, v.emesso_da, v.stato,
                        v.confermato_il, v.confermato_da, v.conferma_canale, v.conferma_impronta, v.note, v.tipo,
                        CASE WHEN v.scansione_file IS NULL THEN NULL
                             ELSE '/api/magazzino/verbali/' || v.id || '/scansione' END AS scansione_url,
                        COALESCE(json_agg(json_build_object(
                            'id', m.id, 'bene_id', m.bene_id, 'bene_denominazione', m.bene_denominazione,
                            'quantita', m.quantita, 'taglia', b.taglia, 'matricola', b.matricola,
                            'unita_misura', b.unita_misura) ORDER BY m.id)
                          FILTER (WHERE m.id IS NOT NULL), '[]') AS righe
                 FROM verbali_consegna v
                 LEFT JOIN movimenti m ON m.verbale_id = v.id
                 LEFT JOIN beni b ON b.id = m.bene_id
                 WHERE v.user_id = $1 AND ($2::text IS NULL OR v.stato = $2)
                 GROUP BY v.id
                 ORDER BY v.emesso_il DESC
                 LIMIT 100`, [req.user.id, stato]);
            res.json(r.rows);
        } catch (e) {
            logger.error('Errore GET verbali/miei:', e);
            res.status(500).json({ message: 'Errore nel leggere i tuoi verbali.' });
        }
    });

    app.get('/api/magazzino/verbali/:id', async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const v = await pool.query('SELECT * FROM verbali_consegna WHERE id = $1', [id]);
            if (v.rowCount === 0) return res.status(404).json({ message: 'Verbale non trovato.' });
            // Il proprio verbale lo legge il volontario; quelli altrui solo
            // chi tiene il magazzino.
            if (v.rows[0].user_id !== req.user.id && !haPermesso(req, 'magazzino.gestione', 'magazzino.consegne')) {
                return res.status(403).json({ message: 'Non sei autorizzato a leggere questo verbale.' });
            }
            const righe = await pool.query(
                `SELECT m.id, m.bene_id, m.bene_denominazione, m.quantita, m.tipo, b.taglia, b.matricola, b.unita_misura
                 FROM movimenti m JOIN beni b ON b.id = m.bene_id
                 WHERE m.verbale_id = $1 ORDER BY m.id`, [id]);
            res.json(conScansione({ ...v.rows[0], righe: righe.rows }));
        } catch (e) {
            logger.error('Errore GET verbale:', e);
            res.status(500).json({ message: 'Errore nel leggere il verbale.' });
        }
    });

    // L'impronta di una conferma: il verbale, chi, quando e gli oggetti, in
    // un testo fisso. Chi rifà il calcolo sugli stessi dati trova la stessa
    // impronta; cambiando un oggetto, una quantità o l'ora, cambia.
    function improntaConferma({ id, user_id: utente, confermato_da: chi, confermato_il: quando }, righe) {
        const testo = JSON.stringify({
            verbale: Number(id), utente: Number(utente), chi, quando: new Date(quando).toISOString(),
            oggetti: righe.map(r => [Number(r.bene_id), r.bene_denominazione, Number(r.quantita), r.taglia || null, r.matricola || null])
        });
        return crypto.createHash('sha256').update(testo).digest('hex');
    }

    // La conferma dal telefono o dal profilo, se l'associazione l'ha accesa.
    // Compila il verbale: nome di chi conferma, data e ora, da dove, e
    // l'impronta di quello che ha confermato, che va anche nel registro.
    app.post('/api/magazzino/verbali/:id/conferma', async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const v = await client.query(
                `SELECT id, user_id FROM verbali_consegna
                 WHERE id = $1 AND user_id = $2 AND stato = 'da_confermare' AND tipo = 'consegna' FOR UPDATE`, [id, req.user.id]);
            if (v.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Verbale non trovato, non tuo, o già confermato.' });
            }
            const chi = nomePersona((await client.query('SELECT nome, cognome, username FROM users WHERE id = $1', [req.user.id])).rows[0]);
            const canale = req.get('x-orion-client') === 'app' ? 'app' : 'web';
            const confermato = (await client.query(
                `UPDATE verbali_consegna SET stato = 'confermato', confermato_il = date_trunc('second', NOW()),
                        confermato_da = $2, conferma_canale = $3
                 WHERE id = $1 RETURNING id, user_id, confermato_da, confermato_il`, [id, chi, canale])).rows[0];
            const righe = (await client.query(
                `SELECT m.bene_id, m.bene_denominazione, m.quantita, b.taglia, b.matricola
                 FROM movimenti m JOIN beni b ON b.id = m.bene_id WHERE m.verbale_id = $1 ORDER BY m.id`, [id])).rows;
            const impronta = improntaConferma(confermato, righe);
            await client.query('UPDATE verbali_consegna SET conferma_impronta = $2 WHERE id = $1', [id, impronta]);
            await client.query('COMMIT');
            registraAudit(req, 'magazzino.verbale.confermato', {
                tipo: 'verbale', id, dettagli: { confermato_da: chi, canale, confermato_il: confermato.confermato_il, impronta }
            });
            if (typeof scadiNotifiche === 'function') scadiNotifiche({ tipo: 'dpi_da_confermare', riferimento: { tipo: 'verbale', id } });
            if (typeof avvisaClienti === 'function') avvisaClienti('reload_magazzino');
            res.json({ message: 'Consegna confermata.', confermato_da: chi, confermato_il: confermato.confermato_il, impronta });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            logger.error('Errore conferma verbale:', e);
            res.status(500).json({ message: 'Errore nel confermare il verbale.' });
        } finally {
            client.release();
        }
    });

    // Il nome del file resta sul server: fuori si vede solo l'indirizzo da cui
    // lo si legge, con i permessi del verbale.
    function conScansione(v) {
        const { scansione_file: file, ...resto } = v;
        return { ...resto, scansione_url: file ? `/api/magazzino/verbali/${v.id}/scansione` : null };
    }

    // I primi byte dicono cos'è davvero un file, il tipo dichiarato dal
    // browser no.
    function contenutoAmmesso(percorso) {
        const testa = Buffer.alloc(12);
        const fd = fs.openSync(percorso, 'r');
        try { fs.readSync(fd, testa, 0, 12, 0); } finally { fs.closeSync(fd); }
        const jpeg = testa[0] === 0xff && testa[1] === 0xd8 && testa[2] === 0xff;
        const png = testa.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const webp = testa.toString('latin1', 0, 4) === 'RIFF' && testa.toString('latin1', 8, 12) === 'WEBP';
        const pdf = testa.toString('latin1', 0, 5) === '%PDF-';
        return jpeg || png || webp || pdf;
    }

    // Il foglio firmato, fotografato o scansionato, diventa il verbale. Una
    // seconda foto sostituisce la prima.
    app.post('/api/magazzino/verbali/:id/scansione', richiedePermesso('magazzino.gestione', 'magazzino.consegne'), (req, res, next) => {
        if (!caricaScansione) return res.status(501).json({ message: 'Caricamento dei verbali non disponibile.' });
        caricaScansione.single('scansione')(req, res, (err) => {
            if (!err) return next();
            const troppoGrande = err.code === 'LIMIT_FILE_SIZE';
            return res.status(troppoGrande ? 413 : 400).json({
                message: troppoGrande ? 'Il file supera i 20 MB.' : err.message
            });
        });
    }, async (req, res) => {
        const id = interoPositivo(req.params.id);
        const scarta = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
        if (!id) { scarta(); return res.status(400).json({ message: 'ID non valido.' }); }
        if (!req.file) return res.status(400).json({ message: 'Allega la foto o il PDF del foglio firmato.' });
        if (!contenutoAmmesso(req.file.path)) {
            scarta();
            return res.status(400).json({ message: 'Il file non è una foto (JPG, PNG, WEBP) né un PDF.' });
        }
        await proteggiCaricati(req.file);
        try {
            const prima = await pool.query('SELECT scansione_file, stato FROM verbali_consegna WHERE id = $1', [id]);
            if (prima.rowCount === 0) { scarta(); return res.status(404).json({ message: 'Verbale non trovato.' }); }
            // La conferma dall'app resta: il foglio si aggiunge, non la cancella.
            const r = await pool.query(
                `UPDATE verbali_consegna
                 SET scansione_file = $2, scansione_caricata_il = NOW(), scansione_caricata_da = $3,
                     scansione_url = '/api/magazzino/verbali/' || id || '/scansione',
                     stato = CASE WHEN stato = 'confermato' THEN stato ELSE 'firmato_cartaceo' END
                 WHERE id = $1 RETURNING stato, scansione_caricata_il`,
                [id, req.file.filename, chiOpera(req)]);
            const vecchio = prima.rows[0].scansione_file;
            if (vecchio && cartellaVerbali) fs.unlink(path.join(cartellaVerbali, path.basename(vecchio)), () => {});
            // Firmato su carta: la richiesta di conferma dal telefono non serve piu'.
            if (typeof scadiNotifiche === 'function') scadiNotifiche({ tipo: 'dpi_da_confermare', riferimento: { tipo: 'verbale', id } });
            registraAudit(req, 'magazzino.verbale.firmato', {
                tipo: 'verbale', id, dettagli: { sostituito: !!vecchio, formato: req.file.mimetype }
            });
            if (typeof avvisaClienti === 'function') avvisaClienti('reload_magazzino');
            res.status(201).json({
                message: 'Foglio firmato allegato al verbale.',
                stato: r.rows[0].stato,
                scansione_url: `/api/magazzino/verbali/${id}/scansione`,
                scansione_caricata_il: r.rows[0].scansione_caricata_il
            });
        } catch (e) {
            scarta();
            logger.error('Errore caricamento verbale firmato:', e);
            res.status(500).json({ message: 'Errore nel salvare il foglio firmato.' });
        }
    });

    // Il foglio firmato si legge con gli stessi permessi del verbale: chi
    // l'ha firmato e chi tiene il magazzino.
    app.get('/api/magazzino/verbali/:id/scansione', async (req, res) => {
        const id = interoPositivo(req.params.id);
        if (!id) return res.status(400).json({ message: 'ID non valido.' });
        try {
            const v = await pool.query('SELECT user_id, scansione_file FROM verbali_consegna WHERE id = $1', [id]);
            if (v.rowCount === 0 || !v.rows[0].scansione_file || !cartellaVerbali) {
                return res.status(404).json({ message: 'Nessun foglio firmato per questo verbale.' });
            }
            if (v.rows[0].user_id !== req.user.id && !haPermesso(req, 'magazzino.gestione', 'magazzino.consegne')) {
                return res.status(403).json({ message: 'Non sei autorizzato a leggere questo verbale.' });
            }
            const percorso = path.join(cartellaVerbali, path.basename(v.rows[0].scansione_file));
            if (!fs.existsSync(percorso)) return res.status(404).json({ message: 'Il file del foglio firmato non si trova più.' });
            res.set('X-Content-Type-Options', 'nosniff');
            res.set('Cache-Control', 'private, no-store');
            await inviaFile(res, percorso);
        } catch (e) {
            logger.error('Errore lettura verbale firmato:', e);
            res.status(500).json({ message: 'Errore nel leggere il foglio firmato.' });
        }
    });

    app.get('/api/magazzino/verbali', richiedePermesso('magazzino.gestione', 'magazzino.consegne'), async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT v.*, COUNT(m.id)::int AS oggetti
                 FROM verbali_consegna v LEFT JOIN movimenti m ON m.verbale_id = v.id
                 GROUP BY v.id ORDER BY v.emesso_il DESC LIMIT 200`);
            res.json(r.rows.map(conScansione));
        } catch (e) {
            logger.error('Errore GET verbali:', e);
            res.status(500).json({ message: 'Errore nel leggere i verbali.' });
        }
    });

    // Per chi registra movimenti fuori da queste rotte (beniInUscita.js) e per
    // il riepilogo nell'app dei magazzinieri (null a modulo spento).
    async function riepilogoNotifica() {
        if (!(await moduloAcceso())) return null;
        const config = await leggiConfig();
        const scadenze = await scadenzeEntro(30);
        const fuori = await daRecuperare(config.giorni_avviso_recupero);
        return { scadenze: scadenze.length, fuori: fuori.length };
    }

    return { registraMovimento, inviaAvvisiScadenze, leggiConfig, pulisciIdempotenza, riepilogoNotifica };
}

// Il materiale che un detentore ha adesso (serve anche a beniInUscita.js).

export async function beniInCarico(esecutore, tipo, id) {
    const colonna = tipo === 'persona' ? 'destinatario_user_id'
        : tipo === 'squadra' ? 'destinatario_squadra_id'
        : 'destinatario_bene_id';

    const singoli = await esecutore.query(
        `SELECT b.id AS bene_id, b.denominazione, b.tipo AS tipo_bene, b.gestione, b.matricola, b.taglia,
                1::numeric AS quantita, b.unita_misura, s.ultimo_movimento_il AS da_quando
         FROM beni b JOIN beni_situazione s ON s.bene_id = b.id
         WHERE b.gestione = 'singolo' AND b.dismesso_il IS NULL
           AND s.destinatario_tipo = $1 AND s.${colonna} = $2`, [tipo, id]);

    // Gli sfusi per detentore: quello che gli e' arrivato meno quello che gli
    // e' uscito (vedi update-25).
    const colonnaDetenzione = tipo === 'persona' ? 'user_id' : tipo === 'squadra' ? 'squadra_id' : 'veicolo_id';
    const sfusi = await esecutore.query(
        `SELECT b.id AS bene_id, b.denominazione, b.tipo AS tipo_bene, b.gestione, b.matricola, b.taglia,
                SUM(d.variazione) AS quantita, b.unita_misura, MAX(d.quando) AS da_quando
         FROM detenzioni_sfusi d JOIN beni b ON b.id = d.bene_id
         WHERE b.gestione = 'quantita' AND b.dismesso_il IS NULL
           AND d.detentore_tipo = $1 AND d.${colonnaDetenzione} = $2
         GROUP BY b.id, b.denominazione, b.tipo, b.gestione, b.matricola, b.taglia, b.unita_misura
         HAVING SUM(d.variazione) > 0`, [tipo, id]);

    return [...singoli.rows, ...sfusi.rows];
}
