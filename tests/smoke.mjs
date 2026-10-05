// tests/smoke.mjs
//
// Batteria di controlli rapidi sulle API di ORION: verifica che le funzioni
// principali rispondano e che i permessi siano applicati.
//
// Non serve alcuna libreria esterna: usa solo Node (fetch integrato).
//
// USO:
//   ORION_URL=https://orion.esempio.it \
//   ORION_ADMIN_USER=admin ORION_ADMIN_PASSWORD='...' \
//   npm test
//
// ATTENZIONE: il test crea e poi elimina un utente di prova, quindi va eseguito
// su un'istanza di collaudo, NON sull'installazione in produzione.
//
// I limiti di frequenza sono 1500 richieste e 100 operazioni amministrative
// ogni quarto d'ora per utente (e 5000 per rete, prima di sapere chi è), e
// 100 tentativi di accesso per indirizzo. Eseguirla più volte di fila con lo
// stesso account può arrivare a 429: non è un difetto del programma. Si
// aspetta un quarto d'ora, o si riavvia il server di collaudo (i contatori
// stanno in memoria).
//
// Questi controlli coprono gli errori realmente trovati durante l'audit: rotte
// finite dietro il middleware sbagliato, risposte 500 al posto di 401/403,
// permessi mancanti e dati riservati esposti su endpoint pubblici.

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_USER = process.env.ORION_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ORION_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error("Manca ORION_ADMIN_PASSWORD (password dell'utente amministratore).");
    process.exit(2);
}

// I certificati self-signed degli ambienti di collaudo non devono bloccare i test
if (process.env.ORION_IGNORA_CERTIFICATO === '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

let superati = 0;
let falliti = 0;
const fallimenti = [];

function verifica(descrizione, condizione, dettaglio = '') {
    if (condizione) {
        superati++;
        console.log(`  OK   ${descrizione}`);
    } else {
        falliti++;
        fallimenti.push(`${descrizione}${dettaglio ? ' -> ' + dettaglio : ''}`);
        console.log(`  FAIL ${descrizione}${dettaglio ? ' -> ' + dettaglio : ''}`);
    }
}

// Client HTTP che conserva i cookie di sessione, come farebbe un browser
function creaClient() {
    const cookies = new Map();
    return {
        cookies,
        async chiamata(percorso, opzioni = {}) {
            const headers = { ...(opzioni.headers || {}) };
            if (cookies.size > 0) {
                headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
            }
            if (opzioni.body && typeof opzioni.body === 'object' && !(opzioni.body instanceof FormData)) {
                headers['Content-Type'] = 'application/json';
                opzioni = { ...opzioni, body: JSON.stringify(opzioni.body) };
            }
            const risposta = await fetch(`${BASE}${percorso}`, { ...opzioni, headers, redirect: 'manual' });
            for (const [nome, valore] of risposta.headers) {
                if (nome.toLowerCase() === 'set-cookie') {
                    valore.split(/,(?=[^;]+=)/).forEach(pezzo => {
                        const [coppia] = pezzo.split(';');
                        const indice = coppia.indexOf('=');
                        if (indice > 0) cookies.set(coppia.slice(0, indice).trim(), coppia.slice(indice + 1).trim());
                    });
                }
            }
            let corpo = null;
            const testo = await risposta.text();
            try { corpo = JSON.parse(testo); } catch { corpo = testo; }
            return { stato: risposta.status, corpo, tipo: risposta.headers.get('content-type') };
        }
    };
}

const anonimo = creaClient();
const admin = creaClient();
const volontario = creaClient();
let idVolontario = null;
let utenteDiProva = null;
let passwordDiProva = null;

async function eseguiTest() {
    console.log(`ORION smoke test -> ${BASE}\n`);

    // ------------------------------------------------------------------
    console.log('[1] Accesso e sessione');
    const login = await admin.chiamata('/login', { method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PASSWORD } });
    verifica('login amministratore riuscito', login.stato === 200, `HTTP ${login.stato}`);
    if (login.stato !== 200) {
        console.error('\nImpossibile proseguire senza una sessione amministratore valida.');
        return;
    }
    verifica('il login restituisce il ruolo', login.corpo?.role === 'admin');

    const loginErrato = await creaClient().chiamata('/login', { method: 'POST', body: { username: ADMIN_USER, password: 'password-sbagliata-xyz' } });
    verifica('password errata -> 401 (non 500)', loginErrato.stato === 401, `HTTP ${loginErrato.stato}`);

    const senzaSessione = await anonimo.chiamata('/api/users/me');
    verifica('endpoint protetto senza sessione -> 401', senzaSessione.stato === 401, `HTTP ${senzaSessione.stato}`);

    // ------------------------------------------------------------------
    console.log('\n[2] Recupero password (deve essere raggiungibile SENZA sessione)');
    const recuperoEsistente = await anonimo.chiamata('/api/auth/forgot-password', { method: 'POST', body: { identificativo: ADMIN_USER } });
    verifica('recupero password raggiungibile da utente non autenticato', recuperoEsistente.stato === 200, `HTTP ${recuperoEsistente.stato}`);

    const recuperoInesistente = await anonimo.chiamata('/api/auth/forgot-password', { method: 'POST', body: { identificativo: 'utente-che-non-esiste-xyz' } });
    verifica('risposta identica per utente inesistente (nessuna enumerazione)',
        recuperoInesistente.stato === recuperoEsistente.stato &&
        JSON.stringify(recuperoInesistente.corpo) === JSON.stringify(recuperoEsistente.corpo));

    // ------------------------------------------------------------------
    console.log('\n[3] Dati riservati sugli endpoint pubblici');
    const brandingPubblico = await anonimo.chiamata('/api/branding/settings');
    const chiaviPubbliche = Object.keys(brandingPubblico.corpo || {});
    verifica('impostazioni pubbliche raggiungibili', brandingPubblico.stato === 200, `HTTP ${brandingPubblico.stato}`);
    verifica('le credenziali SMTP non sono esposte pubblicamente',
        !chiaviPubbliche.some(k => k.startsWith('smtp_')), `chiavi: ${chiaviPubbliche.join(', ')}`);

    const brandingCompleto = await anonimo.chiamata('/api/branding/settings/full');
    verifica('impostazioni complete negate senza privilegi admin', [401, 403].includes(brandingCompleto.stato), `HTTP ${brandingCompleto.stato}`);

    // ------------------------------------------------------------------
    console.log('\n[4] Creazione utente di prova e attivazione');
    const suffisso = Date.now().toString().slice(-6);
    const nuovo = await admin.chiamata('/api/users', {
        method: 'POST',
        body: { nome: `Collaudo${suffisso}`, cognome: `Smoke${suffisso}`, role: 'volontario' }
    });
    verifica('creazione utente riuscita', nuovo.stato === 201, `HTTP ${nuovo.stato}`);
    verifica('viene generato un link di attivazione', typeof nuovo.corpo?.magicLink === 'string');

    if (nuovo.stato === 201) {
        idVolontario = nuovo.corpo.id;
        utenteDiProva = nuovo.corpo.username;
        const parametri = new URL(nuovo.corpo.magicLink).searchParams;
        const passwordProva = `Collaudo!${suffisso}Aa1`;
        passwordDiProva = passwordProva;

        // Un utente appena creato non ha ancora una password: il tentativo di
        // accesso deve essere respinto in modo pulito, non generare un errore
        // interno (bcrypt confrontato con un hash nullo).
        const accessoPrimaAttivazione = await creaClient().chiamata('/login', {
            method: 'POST',
            body: { username: nuovo.corpo.username, password: 'qualsiasi-cosa-123' }
        });
        verifica('accesso a un account non ancora attivato -> 401 (non 500)',
            accessoPrimaAttivazione.stato === 401, `HTTP ${accessoPrimaAttivazione.stato}`);

        const attivazione = await anonimo.chiamata('/api/auth/reset-password', {
            method: 'POST',
            body: { token: parametri.get('token'), id: Number(parametri.get('id')), newPassword: passwordProva }
        });
        verifica('attivazione tramite link riuscita', attivazione.stato === 200, `HTTP ${attivazione.stato}`);

        const loginVolontario = await volontario.chiamata('/login', { method: 'POST', body: { username: nuovo.corpo.username, password: passwordProva } });
        verifica('il nuovo utente riesce ad accedere', loginVolontario.stato === 200, `HTTP ${loginVolontario.stato}`);

        // ------------------------------------------------------------------
        console.log('\n[5] Permessi del ruolo volontario');
        const prove = [
            ['/api/users', 'elenco utenti'],
            ['/api/admin/users', 'elenco utenti amministrativo'],
            ['/api/branding/settings/full', 'impostazioni complete'],
            ['/admin/dashboard-admin.html', 'pagina Impostazioni'],
            ['/admin/admin.html', 'pagina Gestione Utenti'],
            ['/admin/archive.html', 'pagina Archivio']
        ];
        for (const [percorso, nome] of prove) {
            const r = await volontario.chiamata(percorso);
            verifica(`volontario: ${nome} negato`, r.stato === 403, `HTTP ${r.stato}`);
        }

        const librettoAltrui = await volontario.chiamata('/api/users/1/libretto');
        verifica('volontario: libretto di un altro utente negato', librettoAltrui.stato === 403, `HTTP ${librettoAltrui.stato}`);

        const certificatoAltrui = await volontario.chiamata('/api/documents/certificates/cert-1-aaaaaaaa.pdf');
        verifica('volontario: certificato di un altro utente negato', certificatoAltrui.stato === 403, `HTTP ${certificatoAltrui.stato}`);

        const proprioLibretto = await volontario.chiamata(`/api/users/${idVolontario}/libretto`);
        verifica('volontario: il proprio libretto è accessibile', proprioLibretto.stato === 200, `HTTP ${proprioLibretto.stato}`);
    }

    // ------------------------------------------------------------------
    // L'elenco dei membri di una squadra e' quello che il coordinatore legge
    // alla radio e che finisce nel resoconto: non deve poter contenere
    // nominativi inventati ne' la stessa persona in due squadre.
    console.log('\n[5-quinquies] Composizione delle squadre');
    const squadre = await admin.chiamata('/api/squadre');
    verifica('elenco squadre consultabile', squadre.stato === 200, `HTTP ${squadre.stato}`);

    const nomeRadioInventato = await admin.chiamata('/api/squadre', {
        method: 'POST', body: { nome_radio: 'Pippo', nome: 'Collaudo', membri: [] }
    });
    verifica('nome radio non valido rifiutato', nomeRadioInventato.stato === 400, `HTTP ${nomeRadioInventato.stato}`);

    const membroInventato = await admin.chiamata('/api/squadre', {
        method: 'POST', body: { nome_radio: 'Zulu', nome: 'Collaudo', membri: [{ username: 'nessuno-con-questo-nome' }] }
    });
    verifica('squadra con un nominativo inesistente rifiutata', membroInventato.stato === 400, `HTTP ${membroInventato.stato}`);

    const squadraEsistente = Array.isArray(squadre.corpo) ? squadre.corpo.find(s => Array.isArray(s.membri) && s.membri.length > 0) : null;
    if (squadraEsistente) {
        const duplicato = await admin.chiamata('/api/squadre', {
            method: 'POST', body: { nome_radio: 'Zulu', nome: 'Collaudo', membri: [{ username: squadraEsistente.membri[0].username }] }
        });
        verifica('volontario gia\' in una squadra non puo\' entrare in un\'altra', duplicato.stato === 400, `HTTP ${duplicato.stato}`);
        const eliminaInesistente = await admin.chiamata('/api/squadre/99999999', { method: 'DELETE' });
        verifica('eliminazione di squadra inesistente -> 404', eliminaInesistente.stato === 404, `HTTP ${eliminaInesistente.stato}`);

        // Il registro delle squadre dell'emergenza: esiste solo mentre
        // un'emergenza e' aperta, e il resoconto lo riporta.
        const statoEmergenza = await admin.chiamata('/api/emergencies/status');
        if (statoEmergenza.corpo?.active && statoEmergenza.corpo?.emergency?.id) {
            const eventi = await admin.chiamata(`/api/emergencies/${statoEmergenza.corpo.emergency.id}/eventi`);
            verifica('eventi dell\'emergenza consultabili', eventi.stato === 200, `HTTP ${eventi.stato}`);
        }

        const modificaInesistente = await admin.chiamata('/api/squadre/99999999', {
            method: 'PUT', body: { nome_radio: 'Zulu', nome: 'Collaudo', membri: [{ username: squadraEsistente.membri[0].username }] }
        });
        verifica('modifica di squadra inesistente -> 404', modificaInesistente.stato === 404, `HTTP ${modificaInesistente.stato}`);
        verifica('l\'errore non rivela la struttura del database',
            typeof modificaInesistente.corpo?.message === 'string' && !/squadra_membri|fkey|constraint/i.test(modificaInesistente.corpo.message),
            modificaInesistente.corpo?.message);
    }

    // ------------------------------------------------------------------
    // Sospendere un utente deve togliergli l'accesso davvero: sia impedendo un
    // nuovo ingresso, sia interrompendo la sessione che ha gia' aperto. Prima
    // non faceva ne' l'una ne' l'altra cosa, e chi sospendeva un volontario lo
    // credeva fuori mentre continuava a lavorare.
    if (idVolontario && utenteDiProva) {
        console.log('\n[5-quater] Sospensione di un utente');
        const sospendi = await admin.chiamata(`/api/admin/users/${idVolontario}/toggle-status`, { method: 'PATCH' });
        verifica('sospensione registrata', sospendi.stato === 200 && sospendi.corpo?.user?.is_active === false, `HTTP ${sospendi.stato}`);

        const sessioneSospesa = await volontario.chiamata('/api/users/me');
        verifica('la sessione gia\' aperta viene interrotta', sessioneSospesa.stato === 403, `HTTP ${sessioneSospesa.stato}`);

        const rientro = await creaClient().chiamata('/login', {
            method: 'POST', body: { username: utenteDiProva, password: passwordDiProva }
        });
        verifica('nuovo accesso rifiutato a un sospeso', rientro.stato === 403, `HTTP ${rientro.stato}`);
        verifica("il messaggio spiega che l'account e' sospeso",
            typeof rientro.corpo?.message === 'string' && /sospes/i.test(rientro.corpo.message), rientro.corpo?.message);

        const riattiva = await admin.chiamata(`/api/admin/users/${idVolontario}/toggle-status`, { method: 'PATCH' });
        verifica('riattivazione registrata', riattiva.stato === 200 && riattiva.corpo?.user?.is_active === true, `HTTP ${riattiva.stato}`);

        const rientroOk = await volontario.chiamata('/login', {
            method: 'POST', body: { username: utenteDiProva, password: passwordDiProva }
        });
        verifica('dopo la riattivazione si rientra', rientroOk.stato === 200, `HTTP ${rientroOk.stato}`);
    }

    // ------------------------------------------------------------------
    // Una persona puo' avere piu' ruoli: segretaria e magazziniera insieme, per
    // dire. I permessi sono l'unione dei ruoli, e un cambio di ruolo deve
    // valere subito, non alla scadenza del token (un giorno intero).
    console.log('\n[5-sexies] Ruoli multipli');
    const suffissoRuoli = Date.now().toString().slice(-6);
    const doppioRuolo = await admin.chiamata('/api/users', {
        method: 'POST',
        body: { nome: `Doppia${suffissoRuoli}`, cognome: `Ruoli${suffissoRuoli}`, ruoli: ['segreteria', 'magazziniere'] }
    });
    verifica('creazione con due ruoli riuscita', doppioRuolo.stato === 201, `HTTP ${doppioRuolo.stato}`);
    verifica('il ruolo principale e\' il piu\' alto dei due', doppioRuolo.corpo?.role === 'segreteria', doppioRuolo.corpo?.role);

    const mixVietato = await admin.chiamata('/api/users', {
        method: 'POST',
        body: { nome: `Mix${suffissoRuoli}`, cognome: `Vietato${suffissoRuoli}`, ruoli: ['esterno', 'volontario'] }
    });
    verifica('esterno non si combina con altri ruoli -> 400', mixVietato.stato === 400, `HTTP ${mixVietato.stato}`);

    const ruoloInventato = await admin.chiamata('/api/users', {
        method: 'POST',
        body: { nome: `Falso${suffissoRuoli}`, cognome: `Ruolo${suffissoRuoli}`, ruoli: ['presidente'] }
    });
    verifica('ruolo inesistente rifiutato -> 400', ruoloInventato.stato === 400, `HTTP ${ruoloInventato.stato}`);

    const meAdmin = await admin.chiamata('/api/me/status');
    verifica('lo stato della sessione riporta l\'elenco dei ruoli',
        Array.isArray(meAdmin.corpo?.ruoli) && meAdmin.corpo.ruoli.includes('admin'),
        JSON.stringify(meAdmin.corpo?.ruoli));

    if (idVolontario) {
        const autoDeclassamento = await admin.chiamata(`/api/users/${meAdmin.corpo.userId}`, {
            method: 'PUT', body: { nome: 'Prova', cognome: 'Prova', ruoli: ['volontario'] }
        });
        verifica('un amministratore non puo\' togliersi il ruolo da solo -> 403',
            autoDeclassamento.stato === 403, `HTTP ${autoDeclassamento.stato}`);

        // Il volontario di prova ha la sessione aperta: gli si aggiunge la
        // segreteria e l'accesso deve aprirsi senza rifare il login.
        const primaDelCambio = await volontario.chiamata('/api/admin/users');
        verifica('il volontario non vede l\'elenco utenti', primaDelCambio.stato === 403, `HTTP ${primaDelCambio.stato}`);

        await admin.chiamata(`/api/users/${idVolontario}`, {
            method: 'PUT', body: { nome: `Collaudo${suffisso}`, cognome: `Smoke${suffisso}`, ruoli: ['volontario', 'segreteria'] }
        });
        const dopoAggiunta = await volontario.chiamata('/api/admin/users');
        verifica('aggiunto il ruolo segreteria, l\'accesso vale subito sulla stessa sessione',
            dopoAggiunta.stato === 200, `HTTP ${dopoAggiunta.stato}`);

        await admin.chiamata(`/api/users/${idVolontario}`, {
            method: 'PUT', body: { nome: `Collaudo${suffisso}`, cognome: `Smoke${suffisso}`, ruoli: ['volontario'] }
        });
        const dopoRimozione = await volontario.chiamata('/api/admin/users');
        verifica('tolto il ruolo, l\'accesso e\' revocato subito', dopoRimozione.stato === 403, `HTTP ${dopoRimozione.stato}`);
    }

    if (doppioRuolo.stato === 201) {
        await admin.chiamata(`/api/users/${doppioRuolo.corpo.id}`, { method: 'DELETE' });
    }

    // ------------------------------------------------------------------
    // Il catalogo di corsi e visite non deve riempirsi di doppioni: la
    // segretaria sceglie da un elenco, e tre righe identiche rendono
    // impossibile sapere quale sia quella giusta.
    console.log('\n[5-ter] Segreteria: cataloghi e scadenze');
    // Su un'installazione nuova il modulo e' spento: lo si accende per le
    // prove e alla fine si rimette com'era.
    const segreteriaOriginale = (await admin.chiamata('/api/branding/settings')).corpo?.segreteria_config;
    await admin.chiamata('/api/branding/settings', { method: 'PUT', body: { segreteria_config: JSON.stringify({ enabled: true }) } });
    const catalogo = await admin.chiamata('/api/admin/courses-catalog');
    verifica('catalogo corsi consultabile', catalogo.stato === 200, `HTTP ${catalogo.stato}`);
    const primoCorso = Array.isArray(catalogo.corpo) ? catalogo.corpo[0] : null;
    if (primoCorso?.name) {
        const doppione = await admin.chiamata('/api/admin/courses-catalog', {
            method: 'POST', body: { name: primoCorso.name.toUpperCase() }
        });
        verifica('corso con nome già in catalogo rifiutato', doppione.stato === 400, `HTTP ${doppione.stato}`);
    }
    // Il volontario apre i suoi corsi dall'app: nome, codice, validità e
    // l'attestato, che scarica con la sua sessione.
    if (primoCorso?.id && idVolontario) {
        const modulo = new FormData();
        modulo.append('course_id', String(primoCorso.id));
        modulo.append('acquisition_date', '2025-03-15');
        modulo.append('document', new Blob(['%PDF-1.4\n% attestato di prova\n'], { type: 'application/pdf' }), 'attestato.pdf');
        const aggiunto = await admin.chiamata(`/api/admin/users/${idVolontario}/courses`, { method: 'POST', body: modulo });
        verifica('corso con attestato registrato al volontario', aggiunto.stato === 201, `HTTP ${aggiunto.stato} ${JSON.stringify(aggiunto.corpo)}`);
        const libretto = await volontario.chiamata(`/api/users/${idVolontario}/libretto`);
        const corso = (libretto.corpo?.courses || []).find(c => c.course_id === primoCorso.id && c.document_url);
        verifica('nel libretto il corso ha codice, validità e attestato',
            !!corso && 'course_code' in corso && 'validity_months' in corso && corso.document_url.startsWith('/api/documents/certificates/'),
            JSON.stringify(corso));
        if (corso) {
            const attestato = await volontario.chiamata(corso.document_url);
            verifica('il volontario scarica il proprio attestato', attestato.stato === 200 && /pdf/.test(attestato.tipo || ''),
                `HTTP ${attestato.stato} ${attestato.tipo}`);
        }
    }
    const catalogoVolontario = await volontario.chiamata('/api/admin/courses-catalog', {
        method: 'POST', body: { name: 'Corso non autorizzato' }
    });
    verifica('modifica catalogo negata al volontario', [401, 403].includes(catalogoVolontario.stato), `HTTP ${catalogoVolontario.stato}`);

    // Il modulo Segreteria si accende dalle impostazioni: se è spento, le sue
    // rotte rispondono 403 a chiunque ed è giusto così. I controlli sul
    // cruscotto hanno senso solo quando è acceso.
    const impostazioni = await admin.chiamata('/api/branding/settings');
    let segreteriaAccesa = false;
    try {
        const conf = impostazioni.corpo?.segreteria_config;
        const letta = typeof conf === 'string' ? JSON.parse(conf) : conf;
        segreteriaAccesa = letta?.enabled === true;
    } catch { segreteriaAccesa = false; }

    if (segreteriaAccesa) {
        const cruscotto = await admin.chiamata('/api/admin/segreteria/dashboard');
        verifica('cruscotto scadenze consultabile', cruscotto.stato === 200, `HTTP ${cruscotto.stato}`);
        verifica('il cruscotto elenca visite e corsi',
            Array.isArray(cruscotto.corpo?.expiring_medical) && Array.isArray(cruscotto.corpo?.expired_courses));
        const cruscottoVolontario = await volontario.chiamata('/api/admin/segreteria/dashboard');
        verifica('cruscotto scadenze negato al volontario', [401, 403].includes(cruscottoVolontario.stato), `HTTP ${cruscottoVolontario.stato}`);
    } else {
        console.log('  --   modulo Segreteria spento: controlli sul cruscotto saltati');
    }
    await admin.chiamata('/api/branding/settings', {
        method: 'PUT',
        body: { segreteria_config: typeof segreteriaOriginale === 'string' ? segreteriaOriginale : JSON.stringify(segreteriaOriginale ?? { enabled: false }) }
    });

    // ------------------------------------------------------------------
    console.log('\n[5-bis] Registro operazioni');
    const registro = await admin.chiamata('/api/admin/audit-log?limit=50');
    verifica('registro operazioni consultabile dall\'amministratore', registro.stato === 200, `HTTP ${registro.stato}`);
    verifica('il registro contiene le operazioni recenti', Array.isArray(registro.corpo?.entries) && registro.corpo.entries.length > 0);
    verifica('la creazione utente è stata registrata',
        (registro.corpo?.entries || []).some(v => v.action === 'utente.creato'));
    const registroVolontario = await volontario.chiamata('/api/admin/audit-log');
    verifica('registro operazioni negato al volontario', [401, 403].includes(registroVolontario.stato), `HTTP ${registroVolontario.stato}`);

    // ------------------------------------------------------------------
    // L'email di prova: solo all'amministratore, con l'errore detto in parole.
    // Una porta chiusa sulla macchina stessa fallisce subito e sempre.
    console.log('\n[5-bis-2] Email di prova');
    const provaVolontario = await volontario.chiamata('/api/admin/email-prova', { method: 'POST', body: {} });
    verifica('email di prova negata al volontario', [401, 403].includes(provaVolontario.stato), `HTTP ${provaVolontario.stato}`);
    const provaIndirizzo = await admin.chiamata('/api/admin/email-prova', { method: 'POST', body: { a: 'non-una-email' } });
    verifica('email di prova: indirizzo non valido rifiutato', provaIndirizzo.stato === 400, `HTTP ${provaIndirizzo.stato}`);
    const provaChiusa = await admin.chiamata('/api/admin/email-prova', {
        method: 'POST',
        body: { a: 'prova@esempio.it', smtp_host: '127.0.0.1', smtp_port: '1', smtp_secure: 'false', smtp_user: 'prova@esempio.it', smtp_pass: 'x' }
    });
    verifica('email di prova: il server che non risponde è detto in parole',
        provaChiusa.stato === 422 && /connettersi/.test(provaChiusa.corpo?.message || '') && /ECONNREFUSED/.test(provaChiusa.corpo?.dettaglio || ''),
        `HTTP ${provaChiusa.stato} ${JSON.stringify(provaChiusa.corpo)}`);

    // ------------------------------------------------------------------
    // Il magazzino tiene DPI, attrezzature e veicoli con un registro dei
    // movimenti: la giacenza e il detentore si CALCOLANO dal registro, non si
    // scrivono. Questi controlli servono a verificare che il calcolo torni e
    // che non si possano registrare movimenti impossibili.
    console.log('\n[5-septies] Magazzino');
    const etichetta = Date.now().toString().slice(-6);

    // Il modulo si accende e si spegne dalle impostazioni, come la segreteria.
    // A modulo spento tutte le rotte devono rifiutare: una sola lasciata aperta
    // vorrebbe dire che si può ancora scrivere in un magazzino che
    // l'associazione crede chiuso.
    const impostazioniPrima = await admin.chiamata('/api/branding/settings/full');
    const impostazioniBase = {};
    // Senza la posta e senza le configurazioni dei moduli (magazzino_config,
    // segreteria_config...): hanno le loro rotte, e riscriverle da questa
    // foto rimetterebbe le opzioni di prima a meta' delle prove. Lo stato
    // degli aggiornamenti lo scrive solo il programma: da qui e' rifiutato.
    Object.entries(impostazioniPrima.corpo || {}).forEach(([k, v]) => {
        if (!k.startsWith('smtp_') && !k.endsWith('_config') && !k.startsWith('aggiornamenti_')) impostazioniBase[k] = v;
    });

    await admin.chiamata('/api/branding/settings', {
        method: 'PUT', body: { ...impostazioniBase, magazzino_enabled: 'false' }
    });
    const spentoLettura = await admin.chiamata('/api/magazzino/beni');
    verifica('a modulo spento le letture sono rifiutate -> 403',
        spentoLettura.stato === 403 && spentoLettura.corpo?.modulo_spento === true, `HTTP ${spentoLettura.stato}`);
    const spentoScrittura = await admin.chiamata('/api/magazzino/beni', {
        method: 'POST', body: { tipo: 'dpi', denominazione: 'Non deve entrare' }
    });
    verifica('a modulo spento le scritture sono rifiutate -> 403',
        spentoScrittura.stato === 403 && spentoScrittura.corpo?.modulo_spento === true, `HTTP ${spentoScrittura.stato}`);

    const accensione = await admin.chiamata('/api/branding/settings', {
        method: 'PUT', body: { ...impostazioniBase, magazzino_enabled: 'true' }
    });
    verifica('il modulo si accende dalle impostazioni', accensione.stato === 200, `HTTP ${accensione.stato}`);
    // Il verbale di consegna è un'opzione (dalla 3.35): le prove che seguono
    // lo usano, e alla fine si rimette com'era.
    const verbaleConsegnaPrima = !!(await admin.chiamata('/api/magazzino/config')).corpo?.verbale_consegna;
    await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { verbale_consegna: true } });
    const dopoAccensione = await admin.chiamata('/api/magazzino/beni');
    verifica('acceso, il magazzino risponde', dopoAccensione.stato === 200, `HTTP ${dopoAccensione.stato}`);

    const categoria = await admin.chiamata('/api/magazzino/categorie', {
        method: 'POST', body: { tipo: 'attrezzatura', nome: `Prova${etichetta}` }
    });
    verifica('creazione categoria riuscita', categoria.stato === 201, `HTTP ${categoria.stato}`);

    const doppione = await admin.chiamata('/api/magazzino/categorie', {
        method: 'POST', body: { tipo: 'attrezzatura', nome: `  prova${etichetta}  ` }
    });
    verifica('categoria doppia (maiuscole e spazi diversi) rifiutata -> 409', doppione.stato === 409, `HTTP ${doppione.stato}`);

    // Categorie e ubicazioni si gestiscono dalle impostazioni del magazzino:
    // rinominare, eliminare se vuote, mettere a riposo un'ubicazione.
    if (categoria.stato === 201) {
        const rinominata = await admin.chiamata(`/api/magazzino/categorie/${categoria.corpo.id}`, {
            method: 'PUT', body: { nome: `Rinominata${etichetta}` }
        });
        verifica('una categoria si rinomina', rinominata.stato === 200 && rinominata.corpo?.nome === `Rinominata${etichetta}`,
            `HTTP ${rinominata.stato}`);
        const vuota = await admin.chiamata(`/api/magazzino/categorie/${categoria.corpo.id}`, { method: 'PUT', body: { nome: '  ' } });
        verifica('un nome vuoto -> 400', vuota.stato === 400, `HTTP ${vuota.stato}`);
        const dalVolontario = await volontario.chiamata(`/api/magazzino/categorie/${categoria.corpo.id}`, { method: 'PUT', body: { nome: 'x' } });
        verifica('rinominare è da magazziniere -> 403', dalVolontario.stato === 403, `HTTP ${dalVolontario.stato}`);
        const eliminata = await admin.chiamata(`/api/magazzino/categorie/${categoria.corpo.id}`, { method: 'DELETE' });
        verifica('una categoria vuota si elimina', eliminata.stato === 200, `HTTP ${eliminata.stato}`);
    }
    const ubicazione = await admin.chiamata('/api/magazzino/ubicazioni', {
        method: 'POST', body: { nome: `Container ${etichetta}`, tipo: 'container' }
    });
    verifica('creazione ubicazione riuscita', ubicazione.stato === 201, `HTTP ${ubicazione.stato}`);
    if (ubicazione.stato === 201) {
        const idUbic = ubicazione.corpo.id;
        const contenuto = await admin.chiamata('/api/magazzino/beni', {
            method: 'POST', body: { tipo: 'attrezzatura', denominazione: `Pala ${etichetta}`, ubicazione_id: idUbic }
        });
        const piena = await admin.chiamata(`/api/magazzino/ubicazioni/${idUbic}`, { method: 'DELETE' });
        verifica('un\'ubicazione con dei beni non si elimina -> 409', piena.stato === 409, `HTTP ${piena.stato}`);
        const aRiposo = await admin.chiamata(`/api/magazzino/ubicazioni/${idUbic}`, {
            method: 'PUT', body: { nome: `Container ${etichetta} vecchio`, tipo: 'container', attiva: false }
        });
        verifica('ma si mette a riposo', aRiposo.stato === 200 && aRiposo.corpo?.attiva === false, `HTTP ${aRiposo.stato}`);
        const elenco = await admin.chiamata('/api/magazzino/ubicazioni');
        const letta = (elenco.corpo || []).find(u => u.id === idUbic);
        verifica('l\'elenco dice quanti beni contiene', letta?.beni === 1 && letta?.attiva === false, JSON.stringify(letta));
        if (contenuto.stato === 201) {
            await admin.chiamata(`/api/magazzino/beni/${contenuto.corpo.id}`, {
                method: 'PUT', body: { tipo: 'attrezzatura', denominazione: `Pala ${etichetta}`, ubicazione_id: null }
            });
            await admin.chiamata('/api/magazzino/movimenti', {
                method: 'POST', body: { bene_id: contenuto.corpo.id, tipo: 'dismissione', quantita: 1, note: 'prova' }
            });
        }
        const svuotata = await admin.chiamata(`/api/magazzino/ubicazioni/${idUbic}`, { method: 'DELETE' });
        verifica('vuota, si elimina', svuotata.stato === 200, `HTTP ${svuotata.stato} ${svuotata.corpo?.message}`);
    }

    // DPI a taglie: un modello con le sue taglie, ciascuna un bene a quantità.
    const modelliStandard = await admin.chiamata('/api/magazzino/modelli');
    verifica('ci sono i DPI standard proposti da ORION',
        modelliStandard.stato === 200 && (modelliStandard.corpo || []).some(m => m.standard && m.nome === 'Guanti da lavoro'),
        `HTTP ${modelliStandard.stato}`);
    const divisa = await admin.chiamata('/api/magazzino/modelli', {
        method: 'POST', body: { nome: `Divisa estiva ${etichetta}`, taglie: ['L', 'XL', 'l'], quantita: { L: 4, XL: 5 } }
    });
    const varianti = divisa.corpo?.varianti || [];
    const quanti = (t) => Number(varianti.find(v => v.taglia === t)?.in_magazzino);
    verifica('un DPI nuovo nasce con una scheda per taglia e le quantità in casa',
        divisa.stato === 201 && varianti.length === 2 && quanti('L') === 4 && quanti('XL') === 5,
        `HTTP ${divisa.stato} ${JSON.stringify(varianti)}`);
    if (divisa.stato === 201) {
        const idDivisa = divisa.corpo.id;
        const carico = await admin.chiamata(`/api/magazzino/modelli/${idDivisa}/carico`, {
            method: 'POST', body: { quantita: { L: 2, XXL: 3 }, note: 'fornitura di prova' }
        });
        const dopo = carico.corpo?.modello?.varianti || [];
        verifica('il carico per taglie somma e aggiunge la taglia nuova',
            carico.stato === 200 && carico.corpo?.caricati === 5
            && Number(dopo.find(v => v.taglia === 'L')?.in_magazzino) === 6
            && Number(dopo.find(v => v.taglia === 'XXL')?.in_magazzino) === 3
            && carico.corpo?.modello?.taglie?.includes('XXL'),
            JSON.stringify(carico.corpo));
        const caricoVolontario = await volontario.chiamata(`/api/magazzino/modelli/${idDivisa}/carico`, {
            method: 'POST', body: { quantita: { L: 1 } }
        });
        verifica('il carico è da magazziniere -> 403', caricoVolontario.stato === 403, `HTTP ${caricoVolontario.stato}`);
        const rinominata = await admin.chiamata(`/api/magazzino/modelli/${idDivisa}`, {
            method: 'PUT', body: { nome: `Divisa estiva ${etichetta} 2026` }
        });
        const beniDivisa = (await admin.chiamata(`/api/magazzino/beni?q=${encodeURIComponent(`Divisa estiva ${etichetta}`)}`)).corpo || [];
        verifica('il nome nuovo passa a tutte le taglie',
            rinominata.stato === 200 && beniDivisa.length === 3 && beniDivisa.every(b => b.denominazione === `Divisa estiva ${etichetta} 2026` && b.modello_id === idDivisa),
            JSON.stringify(beniDivisa.map(b => b.denominazione)));
        const togliPiena = await admin.chiamata(`/api/magazzino/modelli/${idDivisa}`, { method: 'PUT', body: { taglie: ['XL', 'XXL'] } });
        verifica('una taglia con dei pezzi non si toglie -> 409', togliPiena.stato === 409, `HTTP ${togliPiena.stato}`);
        const standard = (modelliStandard.corpo || []).find(m => m.standard);
        if (standard) {
            const eliminaStandard = await admin.chiamata(`/api/magazzino/modelli/${standard.id}`, { method: 'DELETE' });
            verifica('un DPI standard non si elimina, si nasconde -> 409', eliminaStandard.stato === 409, `HTTP ${eliminaStandard.stato}`);
        }
        const piena = await admin.chiamata(`/api/magazzino/modelli/${idDivisa}`, { method: 'DELETE' });
        verifica('un DPI con dei pezzi non si elimina -> 409', piena.stato === 409, `HTTP ${piena.stato}`);
        // Buttare qualche pezzo non fa sparire la taglia con quelli che restano.
        const tagliaL = beniDivisa.find(b => b.taglia === 'L');
        if (tagliaL) {
            await admin.chiamata('/api/magazzino/movimenti', {
                method: 'POST', body: { bene_id: tagliaL.id, tipo: 'dismissione', quantita: 2, note: 'consumate' }
            });
            const letta = (await admin.chiamata(`/api/magazzino/beni/${tagliaL.id}`)).corpo;
            verifica('dismettere 2 pezzi su 6 lascia la taglia con gli altri 4',
                !letta?.dismesso_il && Number(letta?.in_magazzino) === 4, JSON.stringify({ d: letta?.dismesso_il, q: letta?.in_magazzino }));
            tagliaL.in_magazzino = 4;
        }
        for (const v of beniDivisa) {
            await admin.chiamata('/api/magazzino/movimenti', {
                method: 'POST', body: { bene_id: v.id, tipo: 'dismissione', quantita: Number(v.in_magazzino), note: 'pulizia del collaudo' }
            });
        }
        const eliminata = await admin.chiamata(`/api/magazzino/modelli/${idDivisa}`, { method: 'DELETE' });
        verifica('vuoto, si elimina', eliminata.stato === 200, `HTTP ${eliminata.stato} ${eliminata.corpo?.message}`);
    }

    const sfuso = await admin.chiamata('/api/magazzino/beni', {
        method: 'POST',
        body: { tipo: 'attrezzatura', gestione: 'quantita', denominazione: `Sacchi${etichetta}`,
                unita_misura: 'sacchi', quantita_totale: 100 }
    });
    verifica('creazione bene sfuso riuscita', sfuso.stato === 201, `HTTP ${sfuso.stato}`);

    const veicoloSfuso = await admin.chiamata('/api/magazzino/beni', {
        method: 'POST', body: { tipo: 'veicolo', gestione: 'quantita', denominazione: `Furgoni${etichetta}`, quantita_totale: 3 }
    });
    verifica('un veicolo "sfuso" viene rifiutato -> 400', veicoloSfuso.stato === 400, `HTTP ${veicoloSfuso.stato}`);

    if (sfuso.stato === 201) {
        const idSfuso = sfuso.corpo.id;
        const appena = await admin.chiamata(`/api/magazzino/beni/${idSfuso}`);
        verifica('il bene appena creato risulta caricato in magazzino',
            Number(appena.corpo?.in_magazzino) === 100, `${appena.corpo?.in_magazzino}`);

        const troppo = await admin.chiamata('/api/magazzino/movimenti', {
            method: 'POST', body: { bene_id: idSfuso, tipo: 'consegna', quantita: 500, destinatario: { tipo: 'persona', id: idVolontario } }
        });
        verifica('non si consegna piu\' di quanto c\'e\' -> 400', troppo.stato === 400 && /disponibil|ci sono|restano|solo/i.test(troppo.corpo?.message || ''),
            `HTTP ${troppo.stato} ${troppo.corpo?.message}`);

        // I sacchi si contano interi: mezzo sacco non si consegna né si rettifica.
        const mezzo = await admin.chiamata('/api/magazzino/consegna', {
            method: 'POST', body: { destinatario: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: idSfuso, quantita: 1.5 }] }
        });
        verifica('un materiale che si conta non si consegna a metà -> 400',
            mezzo.stato === 400 && /numero intero/.test(mezzo.corpo?.message || ''), `HTTP ${mezzo.stato} ${mezzo.corpo?.message}`);
        const rettificaMezza = await admin.chiamata('/api/magazzino/movimenti', {
            method: 'POST', body: { bene_id: idSfuso, tipo: 'rettifica', quantita: -0.5, note: 'prova' }
        });
        verifica('né si rettifica di mezzo sacco -> 400', rettificaMezza.stato === 400, `HTTP ${rettificaMezza.stato}`);
        const nuovoAMezzo = await admin.chiamata('/api/magazzino/beni', {
            method: 'POST', body: { tipo: 'dpi', gestione: 'quantita', denominazione: `Guanti${etichetta}`, unita_misura: 'paia', quantita_totale: 2.5 }
        });
        verifica('un bene nuovo a paia non nasce con mezzo paio -> 400', nuovoAMezzo.stato === 400, `HTTP ${nuovoAMezzo.stato}`);
        const gasolio = await admin.chiamata('/api/magazzino/beni', {
            method: 'POST', body: { tipo: 'attrezzatura', gestione: 'quantita', denominazione: `Gasolio${etichetta}`, unita_misura: 'litri', quantita_totale: 20.5 }
        });
        verifica('una misura si fraziona: 20,5 litri di gasolio', gasolio.stato === 201, `HTTP ${gasolio.stato} ${gasolio.corpo?.message}`);
        if (gasolio.stato === 201) {
            const litri = await admin.chiamata('/api/magazzino/consegna', {
                method: 'POST', body: { destinatario: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: gasolio.corpo.id, quantita: 2.5 }] }
            });
            verifica('e se ne consegnano 2,5 litri', litri.stato === 201, `HTTP ${litri.stato} ${litri.corpo?.message}`);
        }

        // Il materiale si consegna a una persona: non a una squadra né a un mezzo.
        for (const tipo of ['squadra', 'veicolo']) {
            const aUnGruppo = await admin.chiamata('/api/magazzino/consegna', {
                method: 'POST', body: { destinatario: { tipo, id: 1 }, righe: [{ bene_id: idSfuso, quantita: 1 }] }
            });
            verifica(`consegna a ${tipo === 'squadra' ? 'una squadra' : 'un mezzo'} rifiutata -> 400`,
                aUnGruppo.stato === 400 && /a una persona/.test(aUnGruppo.corpo?.message || ''), `HTTP ${aUnGruppo.stato}`);
            const conMovimento = await admin.chiamata('/api/magazzino/movimenti', {
                method: 'POST', body: { bene_id: idSfuso, tipo: 'consegna', quantita: 1, destinatario: { tipo, id: 1 } }
            });
            verifica(`anche come movimento singolo -> 400`, conMovimento.stato === 400, `HTTP ${conMovimento.stato}`);
        }

        const rettificaMuta = await admin.chiamata('/api/magazzino/movimenti', {
            method: 'POST', body: { bene_id: idSfuso, tipo: 'rettifica', quantita: -5 }
        });
        verifica('una rettifica senza spiegazione e\' rifiutata -> 400', rettificaMuta.stato === 400, `HTTP ${rettificaMuta.stato}`);

        const rettifica = await admin.chiamata('/api/magazzino/movimenti', {
            method: 'POST',
            body: { bene_id: idSfuso, tipo: 'rettifica', quantita: -5, note: 'Inventario fisico del collaudo' }
        });
        verifica('rettifica con spiegazione accettata', rettifica.stato === 201, `HTTP ${rettifica.stato}`);

        const dopo = await admin.chiamata(`/api/magazzino/beni/${idSfuso}`);
        verifica('la giacenza segue il registro: 100 - 5 = 95',
            Number(dopo.corpo?.in_magazzino) === 95, `${dopo.corpo?.in_magazzino}`);

        const smarrimentoMuto = await admin.chiamata('/api/magazzino/movimenti', {
            method: 'POST', body: { bene_id: idSfuso, tipo: 'smarrimento', quantita: 1 }
        });
        verifica('uno smarrimento senza nota e\' rifiutato -> 400', smarrimentoMuto.stato === 400, `HTTP ${smarrimentoMuto.stato}`);
    }

    // Un pezzo unico ha un solo detentore: consegnato due volte deve rifiutare.
    const unico = await admin.chiamata('/api/magazzino/beni', {
        method: 'POST', body: { tipo: 'attrezzatura', gestione: 'singolo', denominazione: `Motosega${etichetta}`, matricola: `MS-${etichetta}` }
    });
    if (unico.stato === 201 && idVolontario) {
        const prima = await admin.chiamata('/api/magazzino/consegna', {
            method: 'POST', body: { destinatario: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: unico.corpo.id }] }
        });
        verifica('consegna di un pezzo unico riuscita', prima.stato === 201, `HTTP ${prima.stato}`);

        const seconda = await admin.chiamata('/api/magazzino/consegna', {
            method: 'POST', body: { destinatario: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: unico.corpo.id }] }
        });
        verifica('lo stesso pezzo unico non si consegna due volte -> 400', seconda.stato === 400, `HTTP ${seconda.stato}`);

        const inCarico = await admin.chiamata(`/api/magazzino/in-carico/persona/${idVolontario}`);
        verifica('risulta in carico a chi l\'ha ricevuto',
            Array.isArray(inCarico.corpo) && inCarico.corpo.some(b => b.bene_id === unico.corpo.id),
            `${inCarico.stato}`);

        // Eliminare chi ha roba in carico deve fermarsi e chiedere cosa farne.
        const cancellazione = await admin.chiamata(`/api/users/${idVolontario}`, { method: 'DELETE' });
        verifica('non si elimina un volontario che ha materiale in carico -> 409',
            cancellazione.stato === 409 && Array.isArray(cancellazione.corpo?.beni_in_carico),
            `HTTP ${cancellazione.stato}`);

        // Rimettiamo a posto: il pezzo rientra, cosi' la pulizia finale funziona.
        await admin.chiamata('/api/magazzino/rientro', {
            method: 'POST', body: { righe: [{ bene_id: unico.corpo.id }] }
        });
    }

    // Un DPI in dotazione a un volontario attivo non e' "materiale non
    // rientrato": e' la sua condizione normale. In quella lista ci finirebbero
    // decine di righe che non sono un problema, e allora non la guarda piu'
    // nessuno - insieme alle due che invece contano.
    const dpiInDotazione = await admin.chiamata('/api/magazzino/beni', {
        method: 'POST', body: { tipo: 'dpi', gestione: 'singolo', denominazione: `Elmetto${etichetta}`, taglia: 'M' }
    });
    if (dpiInDotazione.stato === 201 && idVolontario) {
        await admin.chiamata('/api/magazzino/consegna', {
            method: 'POST',
            body: { destinatario: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: dpiInDotazione.corpo.id }] }
        });
        const daRecuperare = await admin.chiamata('/api/magazzino/da-recuperare');
        verifica('un DPI in dotazione non compare fra le cose da recuperare',
            Array.isArray(daRecuperare.corpo) && !daRecuperare.corpo.some(b => b.bene_id === dpiInDotazione.corpo.id),
            `${daRecuperare.stato}`);

        const chiHaCosa = await admin.chiamata('/api/magazzino/chi-ha-cosa');
        verifica('ma resta visibile in "chi ha cosa"',
            Array.isArray(chiHaCosa.corpo) && chiHaCosa.corpo.some(b => b.bene_id === dpiInDotazione.corpo.id),
            `${chiHaCosa.stato}`);

        // Un DPI scade dove si trova e li' si butta: obbligare a farlo prima
        // rientrare vorrebbe dire far scrivere una cosa che non e' successa.
        const dismissioneMuta = await admin.chiamata('/api/magazzino/movimenti', {
            method: 'POST', body: { bene_id: dpiInDotazione.corpo.id, tipo: 'dismissione' }
        });
        verifica('una dismissione senza spiegazione e\' rifiutata -> 400',
            dismissioneMuta.stato === 400, `HTTP ${dismissioneMuta.stato}`);

        const dismissione = await admin.chiamata('/api/magazzino/movimenti', {
            method: 'POST',
            body: { bene_id: dpiInDotazione.corpo.id, tipo: 'dismissione', note: 'Scaduto e buttato' }
        });
        verifica('si dismette un DPI che e\' in dotazione al volontario',
            dismissione.stato === 201, `HTTP ${dismissione.stato}`);

        const dopoDismissione = await admin.chiamata(`/api/magazzino/beni/${dpiInDotazione.corpo.id}`);
        verifica('la giacenza del magazzino non va sotto zero',
            Number(dopoDismissione.corpo?.in_magazzino) === 0, `${dopoDismissione.corpo?.in_magazzino}`);
        verifica('e la sua storia resta leggibile',
            Array.isArray(dopoDismissione.corpo?.storia) &&
            dopoDismissione.corpo.storia.some(m => m.tipo === 'dismissione'), '');
    }

    // Etichette QR: ogni bene nasce col suo codice, e dal codice si torna al bene.
    if (unico.stato === 201) {
        const scheda = await admin.chiamata(`/api/magazzino/beni/${unico.corpo.id}`);
        verifica('ogni bene nasce con un codice etichetta',
            typeof scheda.corpo?.codice_etichetta === 'string' && scheda.corpo.codice_etichetta.length === 6,
            scheda.corpo?.codice_etichetta);

        const daEtichetta = await admin.chiamata(`/api/magazzino/etichetta/${scheda.corpo.codice_etichetta}`);
        verifica('dal codice si ritrova il bene',
            daEtichetta.stato === 200 && daEtichetta.corpo?.id === unico.corpo.id, `HTTP ${daEtichetta.stato}`);

        const etichettaFinta = await admin.chiamata('/api/magazzino/etichetta/ZZZZZZ');
        verifica('un codice inesistente -> 404', etichettaFinta.stato === 404, `HTTP ${etichettaFinta.stato}`);

        // Manutenzioni periodiche: la prossima data si calcola da sola.
        const intervento = await admin.chiamata(`/api/magazzino/beni/${unico.corpo.id}/interventi`, {
            method: 'POST',
            body: { tipo: 'manutenzione', eseguito_il: '2026-03-10', periodicita_mesi: 6, descrizione: 'Collaudo di prova' }
        });
        verifica('si registra una manutenzione con periodicita\'', intervento.stato === 201, `HTTP ${intervento.stato}`);
        verifica('la prossima scadenza si calcola da sola (sei mesi dopo)',
            String(intervento.corpo?.prossima_scadenza || '').startsWith('2026-09-10'),
            `${intervento.corpo?.prossima_scadenza}`);

        const storico = await admin.chiamata(`/api/magazzino/beni/${unico.corpo.id}/interventi`);
        verifica('lo storico conserva gli interventi',
            Array.isArray(storico.corpo) && storico.corpo.length === 1, `${storico.corpo?.length}`);

        const interventoAlVolontario = await volontario.chiamata(`/api/magazzino/beni/${unico.corpo.id}/interventi`, {
            method: 'POST', body: { tipo: 'manutenzione', eseguito_il: '2026-03-10' }
        });
        verifica('un volontario non registra manutenzioni -> 403',
            interventoAlVolontario.stato === 403, `HTTP ${interventoAlVolontario.stato}`);
    }

    // Il fascicolo del volontario mostra i DPI in dotazione, e dice alla pagina
    // se il magazzino è acceso: senza quel modulo la sezione non deve
    // comparire, perché sarebbe un riquadro vuoto per sempre.
    if (idVolontario) {
        const librettoConMagazzino = await admin.chiamata(`/api/users/${idVolontario}/libretto`);
        verifica('il fascicolo dice che il magazzino è acceso',
            librettoConMagazzino.corpo?.magazzino_attivo === true, `${librettoConMagazzino.stato}`);

        const suoi = await volontario.chiamata(`/api/users/${idVolontario}/libretto`);
        verifica('il volontario vede i propri DPI dal suo fascicolo',
            Array.isArray(suoi.corpo?.equipment), `${suoi.stato}`);

        // A modulo spento la sezione sparisce insieme ai dati.
        await admin.chiamata('/api/branding/settings', {
            method: 'PUT', body: { ...impostazioniBase, magazzino_enabled: 'false' }
        });
        const librettoSenzaMagazzino = await admin.chiamata(`/api/users/${idVolontario}/libretto`);
        verifica('a magazzino spento il fascicolo non riporta DPI',
            librettoSenzaMagazzino.corpo?.magazzino_attivo === false &&
            Array.isArray(librettoSenzaMagazzino.corpo?.equipment) &&
            librettoSenzaMagazzino.corpo.equipment.length === 0,
            `attivo=${librettoSenzaMagazzino.corpo?.magazzino_attivo}`);
        await admin.chiamata('/api/branding/settings', {
            method: 'PUT', body: { ...impostazioniBase, magazzino_enabled: 'true' }
        });
    }

    const magazzinoAlVolontario = await volontario.chiamata('/api/magazzino/beni', {
        method: 'POST', body: { tipo: 'dpi', denominazione: 'Abusivo' }
    });
    verifica('un volontario non crea beni -> 403', magazzinoAlVolontario.stato === 403, `HTTP ${magazzinoAlVolontario.stato}`);

    // Avvisi di scadenza: sono una scelta personale di chi li riceve. Si
    // provano sull'utente di prova, che non li ha mai toccati: l'amministratore
    // potrebbe averli accesi davvero, e un controllo che dipende da com'è
    // configurata l'istanza non verifica niente.
    const avvisiAlVolontario = await volontario.chiamata('/api/magazzino/avvisi');
    verifica('un volontario non configura gli avvisi del magazzino -> 403',
        avvisiAlVolontario.stato === 403, `HTTP ${avvisiAlVolontario.stato}`);

    if (idVolontario) {
        await admin.chiamata(`/api/users/${idVolontario}`, {
            method: 'PUT', body: { nome: `Collaudo${suffisso}`, cognome: `Smoke${suffisso}`, ruoli: ['volontario', 'magazziniere'] }
        });

        const avvisiIniziali = await volontario.chiamata('/api/magazzino/avvisi');
        verifica('per chi non li ha mai chiesti gli avvisi risultano spenti',
            avvisiIniziali.stato === 200 && avvisiIniziali.corpo?.attivo === false,
            `HTTP ${avvisiIniziali.stato} ${JSON.stringify(avvisiIniziali.corpo)}`);

        const frequenzaAssurda = await volontario.chiamata('/api/magazzino/avvisi', {
            method: 'PUT', body: { attivo: true, frequenza: 'ogni_ora' }
        });
        verifica('una frequenza inventata viene rifiutata -> 400',
            frequenzaAssurda.stato === 400, `HTTP ${frequenzaAssurda.stato}`);

        const preavvisoAssurdo = await volontario.chiamata('/api/magazzino/avvisi', {
            method: 'PUT', body: { attivo: true, frequenza: 'settimanale', giorni_preavviso: 4000 }
        });
        verifica('un preavviso oltre l\'anno viene rifiutato -> 400',
            preavvisoAssurdo.stato === 400, `HTTP ${preavvisoAssurdo.stato}`);

        // L'utente di prova non ha un indirizzo email: accendere gli avvisi
        // deve dirlo subito, non far credere per un mese che partano.
        const senzaEmail = await volontario.chiamata('/api/magazzino/avvisi', {
            method: 'PUT', body: { attivo: true, frequenza: 'settimanale', giorni_preavviso: 20 }
        });
        verifica('senza indirizzo email gli avvisi non si accendono -> 400',
            senzaEmail.stato === 400 && /email/i.test(senzaEmail.corpo?.message || ''),
            `HTTP ${senzaEmail.stato} ${JSON.stringify(senzaEmail.corpo)}`);

        const salvate = await volontario.chiamata('/api/magazzino/avvisi', {
            method: 'PUT', body: { attivo: false, frequenza: 'settimanale', giorni_preavviso: 20, includi_da_recuperare: false }
        });
        verifica('le preferenze si salvano e tornano indietro come sono state scritte',
            salvate.stato === 200 && salvate.corpo?.attivo === false &&
            salvate.corpo?.giorni_preavviso === 20 && salvate.corpo?.includi_da_recuperare === false,
            `HTTP ${salvate.stato} ${JSON.stringify(salvate.corpo)}`);

        await admin.chiamata(`/api/users/${idVolontario}`, {
            method: 'PUT', body: { nome: `Collaudo${suffisso}`, cognome: `Smoke${suffisso}`, ruoli: ['volontario'] }
        });
        const dopoIlRuoloTolto = await volontario.chiamata('/api/magazzino/avvisi');
        verifica('tolto il ruolo magazziniere gli avvisi non si configurano più -> 403',
            dopoIlRuoloTolto.stato === 403, `HTTP ${dopoIlRuoloTolto.stato}`);
    }

    // ------------------------------------------------------------------
    // Il materiale a quantità (DPI per taglia, guanti, sacchi) si tiene per
    // detentore: chi ha cosa è la somma di quello che gli è arrivato meno
    // quello che gli è uscito. Un rientro deve scalare chi lo ha reso, e solo
    // lui: prima scalava solo il totale, e il "mancante" lo calcolava su tutti.
    console.log('\n[5-octies] Magazzino: il materiale a quantità si tiene per persona');
    if (idVolontario) {
        const io = await admin.chiamata('/api/users/me');
        const idAdmin = io.corpo?.id;
        const guanti = await admin.chiamata('/api/magazzino/beni', {
            method: 'POST',
            body: { tipo: 'dpi', gestione: 'quantita', denominazione: `Guanti per detentore ${Date.now().toString().slice(-6)}`,
                    taglia: 'L', unita_misura: 'paia', quantita_totale: 10 }
        });
        if (guanti.stato === 201 && idAdmin) {
            const idGuanti = guanti.corpo.id;
            const quantiNe = async (tipo, id) => {
                const r = await volontario.chiamata(`/api/magazzino/in-carico/${tipo}/${id}`);
                const riga = (Array.isArray(r.corpo) ? r.corpo : []).find(b => b.bene_id === idGuanti);
                return riga ? Number(riga.quantita) : 0;
            };
            const situazione = async () => {
                const r = await volontario.chiamata(`/api/magazzino/beni/${idGuanti}`);
                return { magazzino: Number(r.corpo?.in_magazzino), fuori: Number(r.corpo?.fuori) };
            };
            await volontario.chiamata('/api/magazzino/consegna', {
                method: 'POST', body: { destinatario: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: idGuanti, quantita: 3 }] }
            });
            await volontario.chiamata('/api/magazzino/consegna', {
                method: 'POST', body: { destinatario: { tipo: 'persona', id: idAdmin }, righe: [{ bene_id: idGuanti, quantita: 2 }] }
            });
            const [primaV, primaA] = [await quantiNe('persona', idVolontario), await quantiNe('persona', idAdmin)];
            verifica('dopo le consegne ciascuno ha i suoi: 3 e 2', primaV === 3 && primaA === 2, `${primaV} e ${primaA}`);

            // Il volontario ne rende 2 su 3. Del terzo il server non indovina
            // niente: chi registra deve dire se resta a lui, è usato o è perso.
            const ambiguo = await volontario.chiamata('/api/magazzino/rientro', {
                method: 'POST',
                body: { da: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: idGuanti, quantita: 2 }] }
            });
            verifica('rientro parziale senza dire cosa ne è del resto -> 400', ambiguo.stato === 400 && /restano in carico/.test(ambiguo.corpo?.message || ''),
                `HTTP ${ambiguo.stato} ${ambiguo.corpo?.message}`);
            verifica('e non registra niente a metà', (await quantiNe('persona', idVolontario)) === 3);
            const rientro = await volontario.chiamata('/api/magazzino/rientro', {
                method: 'POST',
                body: { da: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: idGuanti, quantita: 2, resto: 'consumo' }] }
            });
            verifica('rientro parziale accettato', rientro.stato === 201, `HTTP ${rientro.stato} ${JSON.stringify(rientro.corpo)}`);
            const [dopoV, dopoA] = [await quantiNe('persona', idVolontario), await quantiNe('persona', idAdmin)];
            verifica('il rientro scala chi lo ha reso: il volontario non ha più niente', dopoV === 0, `${dopoV}`);
            verifica("e non tocca gli altri: l'amministratore ha ancora i suoi 2", dopoA === 2, `${dopoA}`);
            const dopoRientro = await situazione();
            verifica('i conti generali tornano: 7 in magazzino, 2 fuori',
                dopoRientro.magazzino === 7 && dopoRientro.fuori === 2, JSON.stringify(dopoRientro));

            const troppi = await volontario.chiamata('/api/magazzino/rientro', {
                method: 'POST', body: { da: { tipo: 'persona', id: idAdmin }, righe: [{ bene_id: idGuanti, quantita: 5 }] }
            });
            verifica('non rientra più di quanto quella persona ha -> 400', troppi.stato === 400, `HTTP ${troppi.stato}`);

            const chiHaCosa = await volontario.chiamata('/api/magazzino/chi-ha-cosa');
            const righeGuanti = (chiHaCosa.corpo || []).filter(r => r.bene_id === idGuanti);
            verifica('chi ha cosa elenca solo chi li ha davvero',
                righeGuanti.length === 1 && righeGuanti[0].destinatario_user_id === idAdmin && Number(righeGuanti[0].quantita) === 2,
                JSON.stringify(righeGuanti));

            // Con due detentori, un rientro che non dice da chi non si può
            // attribuire: il server lo chiede invece di indovinare.
            await volontario.chiamata('/api/magazzino/consegna', {
                method: 'POST', body: { destinatario: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: idGuanti, quantita: 1 }] }
            });
            const senzaDetentore = await volontario.chiamata('/api/magazzino/rientro', {
                method: 'POST', body: { righe: [{ bene_id: idGuanti, quantita: 1 }] }
            });
            verifica('rientro senza detentore con più detentori -> 400', senzaDetentore.stato === 400,
                `HTTP ${senzaDetentore.stato} ${JSON.stringify(senzaDetentore.corpo)}`);

            // Il fascicolo del volontario mostra anche i DPI a quantità.
            const fascicolo = await volontario.chiamata(`/api/users/${idVolontario}/libretto`);
            const nelFascicolo = (fascicolo.corpo?.equipment || []).find(e => e.id === idGuanti);
            verifica('il fascicolo mostra i DPI a quantità in carico', !!nelFascicolo && Number(nelFascicolo.quantita) === 1,
                JSON.stringify(nelFascicolo));

            // Pulizia: tutto torna, da ciascuno.
            await volontario.chiamata('/api/magazzino/rientro', {
                method: 'POST', body: { da: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: idGuanti, quantita: 1 }] }
            });
            await volontario.chiamata('/api/magazzino/rientro', {
                method: 'POST', body: { da: { tipo: 'persona', id: idAdmin }, righe: [{ bene_id: idGuanti, quantita: 2 }] }
            });
            const finale = await situazione();
            verifica('alla fine tutto è rientrato: 9 in magazzino (1 consumato), 0 fuori',
                finale.magazzino === 9 && finale.fuori === 0, JSON.stringify(finale));
        }
    }

    // ------------------------------------------------------------------
    // L'app manda le consegne con una chiave e, se non sa com'e' andata, le
    // rimanda con la stessa chiave: devono contare una volta sola. E il
    // volontario vede l'elenco dei propri verbali, e solo quelli.
    console.log('\n[5-novies] Consegne idempotenti e verbali propri');
    if (idVolontario) {
        const scarpe = await admin.chiamata('/api/magazzino/beni', {
            method: 'POST',
            body: { tipo: 'dpi', gestione: 'quantita', denominazione: `Scarpe idempotenti ${Date.now().toString().slice(-6)}`,
                    taglia: '42', unita_misura: 'paia', quantita_totale: 6 }
        });
        if (scarpe.stato === 201) {
            const idScarpe = scarpe.corpo.id;
            const giacenza = async () => Number((await volontario.chiamata(`/api/magazzino/beni/${idScarpe}`)).corpo?.in_magazzino);
            const corpo = { destinatario: { tipo: 'persona', id: idVolontario }, verbale: true, righe: [{ bene_id: idScarpe, quantita: 1 }] };
            const chiave = `prova-${Date.now()}`;
            const conChiave = (c, k, b = corpo) => c.chiamata('/api/magazzino/consegna', { method: 'POST', body: b, headers: { 'Idempotency-Key': k } });

            const prima = await conChiave(admin, chiave);
            verifica('consegna con chiave registrata', prima.stato === 201, `HTTP ${prima.stato}`);
            const ripetuta = await conChiave(admin, chiave);
            verifica('lo stesso invio ripetuto restituisce la stessa risposta',
                ripetuta.stato === 201 && ripetuta.corpo?.verbale_id === prima.corpo?.verbale_id,
                `${ripetuta.stato} ${JSON.stringify(ripetuta.corpo)}`);
            const g1 = await giacenza();
            verifica('e non scala due volte la giacenza: 6 - 1 = 5', g1 === 5, `${g1}`);

            const diversa = await conChiave(admin, chiave, { ...corpo, righe: [{ bene_id: idScarpe, quantita: 2 }] });
            verifica('la stessa chiave per una consegna diversa -> 422', diversa.stato === 422, `HTTP ${diversa.stato}`);
            const malformata = await conChiave(admin, 'x');
            verifica('una chiave malformata -> 400', malformata.stato === 400, `HTTP ${malformata.stato}`);

            // Due invii nello stesso istante: uno aspetta l'altro, e ne riceve la risposta.
            const insieme = `insieme-${Date.now()}`;
            const [a, b] = await Promise.all([conChiave(admin, insieme), conChiave(admin, insieme)]);
            const g2 = await giacenza();
            verifica('due invii contemporanei con la stessa chiave contano una volta',
                a.stato === 201 && b.stato === 201 && a.corpo?.verbale_id === b.corpo?.verbale_id && g2 === 4,
                `${a.stato}/${b.stato} verbali ${a.corpo?.verbale_id}/${b.corpo?.verbale_id} giacenza ${g2}`);

            // La chiave e' di chi la usa: la stessa per un'altra persona e' una richiesta nuova.
            const altraPersona = await conChiave(volontario, chiave);
            verifica("la stessa chiave usata da un'altra persona e' una consegna nuova",
                altraPersona.stato === 201 && altraPersona.corpo?.verbale_id !== prima.corpo?.verbale_id && (await giacenza()) === 3,
                `${altraPersona.stato} ${JSON.stringify(altraPersona.corpo)}`);

            const senzaChiave = await volontario.chiamata('/api/magazzino/consegna', { method: 'POST', body: corpo });
            verifica('senza chiave la consegna funziona come prima', senzaChiave.stato === 201 && (await giacenza()) === 2,
                `HTTP ${senzaChiave.stato}`);

            const miei = await volontario.chiamata('/api/magazzino/verbali/miei');
            const idMiei = (miei.corpo || []).map(v => v.id);
            verifica('il volontario vede i suoi verbali',
                miei.stato === 200 && [prima.corpo?.verbale_id, senzaChiave.corpo?.verbale_id].every(id => idMiei.includes(id)),
                `HTTP ${miei.stato} ${JSON.stringify(idMiei)}`);
            const unVerbale = (miei.corpo || []).find(v => v.id === prima.corpo?.verbale_id);
            verifica('ogni verbale porta le sue righe',
                unVerbale?.righe?.length === 1 && unVerbale.righe[0].bene_id === idScarpe && unVerbale.righe[0].taglia === '42',
                JSON.stringify(unVerbale));
            const daConfermare = await volontario.chiamata('/api/magazzino/verbali/miei?stato=da_confermare');
            verifica('si filtrano per stato', daConfermare.stato === 200 && daConfermare.corpo.every(v => v.stato === 'da_confermare'));
            // Il verbale da stampare: il proprio lo apre il volontario, quelli
            // degli altri solo il magazzino; la conferma vale una volta.
            const suo = await volontario.chiamata(`/api/magazzino/verbali/${prima.corpo?.verbale_id}`);
            verifica('il volontario apre il suo verbale da stampare',
                suo.stato === 200 && suo.corpo?.righe?.length === 1, `HTTP ${suo.stato}`);
            const confermato = await volontario.chiamata(`/api/magazzino/verbali/${prima.corpo?.verbale_id}/conferma`, { method: 'POST' });
            verifica('e lo conferma dal profilo', confermato.stato === 200, `HTTP ${confermato.stato}`);
            const dueVolte = await volontario.chiamata(`/api/magazzino/verbali/${prima.corpo?.verbale_id}/conferma`, { method: 'POST' });
            verifica('una seconda conferma -> 404', dueVolte.stato === 404, `HTTP ${dueVolte.stato}`);
            const tutti = await admin.chiamata('/api/magazzino/verbali');
            const nellElenco = (tutti.corpo || []).find(v => v.id === prima.corpo?.verbale_id);
            verifica('il magazzino lo vede confermato nell\'elenco dei verbali',
                nellElenco?.stato === 'confermato' && nellElenco?.oggetti === 1, JSON.stringify(nellElenco));
            const elencoAlVolontario = await volontario.chiamata('/api/magazzino/verbali');
            verifica('l\'elenco di tutti i verbali non è per il volontario -> 403', elencoAlVolontario.stato === 403,
                `HTTP ${elencoAlVolontario.stato}`);
            const io = await admin.chiamata('/api/users/me');
            const aAdmin = await admin.chiamata('/api/magazzino/consegna', {
                method: 'POST', body: { destinatario: { tipo: 'persona', id: io.corpo?.id }, verbale: true, righe: [{ bene_id: idScarpe, quantita: 1 }] }
            });
            if (aAdmin.stato === 201) {
                const altrui = await volontario.chiamata(`/api/magazzino/verbali/${aAdmin.corpo.verbale_id}`);
                verifica('il verbale di un altro non si apre -> 403', altrui.stato === 403, `HTTP ${altrui.stato}`);
                const confermaAltrui = await volontario.chiamata(`/api/magazzino/verbali/${aAdmin.corpo.verbale_id}/conferma`, { method: 'POST' });
                verifica('né si conferma -> 404', confermaAltrui.stato === 404, `HTTP ${confermaAltrui.stato}`);
                await admin.chiamata('/api/magazzino/rientro', {
                    method: 'POST', body: { da: { tipo: 'persona', id: io.corpo?.id }, righe: [{ bene_id: idScarpe, quantita: 1 }] }
                });
            }

            const statoInventato = await volontario.chiamata('/api/magazzino/verbali/miei?stato=qualunque');
            verifica('uno stato inventato -> 400', statoInventato.stato === 400, `HTTP ${statoInventato.stato}`);
            const dellAdmin = await admin.chiamata('/api/magazzino/verbali/miei');
            verifica("nessuno vede i verbali degli altri, nemmeno l'amministratore da qui",
                !(dellAdmin.corpo || []).some(v => idMiei.includes(v.id)));
            const anonimi = await anonimo.chiamata('/api/magazzino/verbali/miei');
            verifica('senza sessione -> 401', anonimi.stato === 401, `HTTP ${anonimi.stato}`);

            // Il verbale di rientro e il foglio firmato fotografato. Ne tornano
            // 3 su 4: il quarto paio resta al volontario, e il verbale lo dice.
            // Il verbale di rientro è un'opzione del magazzino (dalla 3.33):
            // qui si accende, e alla fine si rimette com'era.
            const verbaleRientroPrima = !!(await admin.chiamata('/api/magazzino/config')).corpo?.verbale_rientro;
            await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { verbale_rientro: true } });
            const ctxConVerbale = await admin.chiamata('/api/app/contesto');
            verifica('il contesto dice che il verbale di rientro è acceso', ctxConVerbale.corpo?.magazzino?.verbale_rientro === true,
                JSON.stringify(ctxConVerbale.corpo?.magazzino));
            const conVerbale = await admin.chiamata('/api/magazzino/rientro', {
                method: 'POST', body: { da: { tipo: 'persona', id: idVolontario }, verbale: true, righe: [{ bene_id: idScarpe, quantita: 3, resto: 'in_carico' }] }
            });
            const idRientro = conVerbale.corpo?.verbale_id;
            verifica('il rientro di una persona produce il suo verbale', conVerbale.stato === 201 && Number.isInteger(idRientro),
                `HTTP ${conVerbale.stato} ${JSON.stringify(conVerbale.corpo)}`);
            if (idRientro) {
                const vr = await volontario.chiamata(`/api/magazzino/verbali/${idRientro}`);
                verifica('verbale di rientro: tipo, "da firmare", una riga',
                    vr.corpo?.tipo === 'rientro' && vr.corpo?.stato === 'da_firmare' && vr.corpo?.righe?.length === 1
                        && vr.corpo?.scansione_file === undefined,
                    JSON.stringify(vr.corpo));
                verifica('il verbale scrive cosa resta in carico',
                    /Restano in carico a chi restituisce: .*: 1 paia/.test(vr.corpo?.note || ''), vr.corpo?.note);
                const ancoraSuo = await volontario.chiamata(`/api/magazzino/in-carico/persona/${idVolontario}`);
                verifica("il paio non rientrato è ancora del volontario",
                    Number((ancoraSuo.corpo || []).find(b => b.bene_id === idScarpe)?.quantita) === 1, JSON.stringify(ancoraSuo.corpo));
                const confermaRientro = await volontario.chiamata(`/api/magazzino/verbali/${idRientro}/conferma`, { method: 'POST' });
                verifica('un rientro non si "conferma" dal telefono -> 404', confermaRientro.stato === 404, `HTTP ${confermaRientro.stato}`);

                const allega = (client, id, contenuto, tipo, nome = 'foglio.jpg') => {
                    const modulo = new FormData();
                    modulo.append('scansione', new Blob([contenuto], { type: tipo }), nome);
                    return client.chiamata(`/api/magazzino/verbali/${id}/scansione`, { method: 'POST', body: modulo });
                };
                const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xD9]);
                const dalVolontario = await allega(volontario, idRientro, jpeg, 'image/jpeg');
                verifica('il foglio firmato lo allega solo il magazziniere -> 403', dalVolontario.stato === 403, `HTTP ${dalVolontario.stato}`);
                const finto = await allega(admin, idRientro, '<script>alert(1)</script>', 'image/jpeg', 'foglio.html');
                verifica('un file che non è una foto né un PDF -> 400', finto.stato === 400, `HTTP ${finto.stato}`);
                const allegato = await allega(admin, idRientro, jpeg, 'image/jpeg');
                verifica('foto del foglio firmato allegata: il verbale è "firmato su carta"',
                    allegato.stato === 201 && allegato.corpo?.stato === 'firmato_cartaceo',
                    `HTTP ${allegato.stato} ${JSON.stringify(allegato.corpo)}`);
                const letto = await volontario.chiamata(`/api/magazzino/verbali/${idRientro}/scansione`);
                verifica('chi ha firmato rilegge il suo foglio', letto.stato === 200 && /image\/jpeg/.test(letto.tipo || ''),
                    `HTTP ${letto.stato} ${letto.tipo}`);
                const anonimoFoglio = await anonimo.chiamata(`/api/magazzino/verbali/${idRientro}/scansione`);
                verifica('senza sessione il foglio non si legge -> 401', anonimoFoglio.stato === 401, `HTTP ${anonimoFoglio.stato}`);
                const elenco = await admin.chiamata('/api/magazzino/verbali');
                const riga = (elenco.corpo || []).find(v => v.id === idRientro);
                verifica("nell'elenco il verbale ha il foglio, non il nome del file",
                    riga?.scansione_url === `/api/magazzino/verbali/${idRientro}/scansione` && !('scansione_file' in (riga || {})),
                    JSON.stringify(riga));
                // Una consegna già confermata dall'app resta confermata: il
                // foglio si aggiunge.
                const suConfermato = await allega(admin, prima.corpo?.verbale_id, jpeg, 'image/jpeg');
                verifica('il foglio su un verbale già confermato non ne cambia lo stato',
                    suConfermato.stato === 201 && suConfermato.corpo?.stato === 'confermato',
                    `HTTP ${suConfermato.stato} ${JSON.stringify(suConfermato.corpo)}`);

                const restoInventato = await admin.chiamata('/api/magazzino/rientro', {
                    method: 'POST', body: { da: { tipo: 'persona', id: idVolontario }, righe: [{ bene_id: idScarpe, quantita: 0, resto: 'boh' }] }
                });
                verifica('un destino inventato per il resto -> 400', restoInventato.stato === 400, `HTTP ${restoInventato.stato}`);
                // L'ultimo paio non torna più: si dichiara perso, con zero
                // rientrati. Con il verbale di rientro spento, chi lo chiede
                // lo stesso non lo ottiene e il rientro si registra.
                await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { verbale_rientro: false } });
                const ctxSenza = await admin.chiamata('/api/app/contesto');
                verifica('il contesto dice che il verbale di rientro è spento', ctxSenza.corpo?.magazzino?.verbale_rientro === false,
                    JSON.stringify(ctxSenza.corpo?.magazzino));
                const perso = await admin.chiamata('/api/magazzino/rientro', {
                    method: 'POST', body: { da: { tipo: 'persona', id: idVolontario }, verbale: true, righe: [{ bene_id: idScarpe, quantita: 0, resto: 'perso' }] }
                });
                verifica('il resto dichiarato perso diventa uno smarrimento',
                    perso.stato === 201 && perso.corpo?.registrati?.length === 1 && perso.corpo.registrati[0].tipo === 'smarrimento',
                    `HTTP ${perso.stato} ${JSON.stringify(perso.corpo)}`);
                verifica('verbale di rientro spento: niente verbale anche se richiesto', perso.corpo?.verbale_id === null,
                    JSON.stringify(perso.corpo));
            }
            await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { verbale_rientro: verbaleRientroPrima } });

        }
    }

    // ------------------------------------------------------------------
    console.log('\n[6] Percorsi dei file');
    const traversalUploads = await admin.chiamata('/uploads/..%2F..%2Fpackage.json');
    verifica('path traversal su /uploads bloccato', traversalUploads.stato === 403, `HTTP ${traversalUploads.stato}`);

    const traversalCertificati = await admin.chiamata('/api/documents/certificates/cert-1-..%2F..%2F..%2Fetc%2Fpasswd');
    verifica('path traversal sui certificati bloccato', [400, 403, 404].includes(traversalCertificati.stato), `HTTP ${traversalCertificati.stato}`);

    // ------------------------------------------------------------------
    console.log('\n[7] Funzioni operative');
    const endpointLetturaAdmin = [
        ['/api/squadre', 'elenco squadre'],
        ['/api/reports', 'elenco segnalazioni'],
        ['/api/emergencies/status', 'stato emergenza'],
        ['/api/location', 'posizioni squadre'],
        ['/api/admin/courses-catalog', 'catalogo corsi'],
        ['/api/admin/medical-visit-types', 'catalogo visite'],
        ['/api/users/me', 'profilo personale'],
        ['/api/branding', 'logo e branding']
    ];
    for (const [percorso, nome] of endpointLetturaAdmin) {
        const r = await admin.chiamata(percorso);
        verifica(`${nome} risponde`, r.stato === 200, `HTTP ${r.stato}`);
    }

    // ------------------------------------------------------------------
    // Una richiesta con dati sbagliati deve tornare 400 con la spiegazione:
    // un 500 manda l'operatore a cercare un guasto che non c'è.
    console.log('\n[7-quater] Dati non validi nelle modifiche');
    const sogliaAssurda = await admin.chiamata('/api/branding/settings', {
        method: 'PUT', body: { minuti_attesa_critica: 'non-un-numero' }
    });
    verifica('soglia attesa non numerica rifiutata con 400', sogliaAssurda.stato === 400, `HTTP ${sogliaAssurda.stato}`);
    const sogliaZero = await admin.chiamata('/api/branding/settings', {
        method: 'PUT', body: { minuti_attesa_critica: '0' }
    });
    verifica('soglia attesa a zero rifiutata con 400', sogliaZero.stato === 400, `HTTP ${sogliaZero.stato}`);

    const segnalazioneInesistente = await admin.chiamata('/api/reports/99999999', {
        method: 'PUT', body: { title: 'Non esiste' }
    });
    verifica('modifica di segnalazione inesistente -> 404', segnalazioneInesistente.stato === 404, `HTTP ${segnalazioneInesistente.stato}`);

    // Nomi, email e anagrafica: un valore troppo lungo o sbagliato è un 400
    // che dice cosa non va, non un 500 dal database.
    const nomeLungo = await admin.chiamata('/api/users', { method: 'POST', body: { nome: 'N'.repeat(51), cognome: 'Lungo', ruoli: ['volontario'] } });
    verifica('nome oltre i 50 caratteri -> 400', nomeLungo.stato === 400, `HTTP ${nomeLungo.stato} ${JSON.stringify(nomeLungo.corpo)}`);
    const emailStorta = await admin.chiamata('/api/users', { method: 'POST', body: { nome: 'Email', cognome: 'Storta', email: 'non-una-email', ruoli: ['volontario'] } });
    verifica('email non valida -> 400', emailStorta.stato === 400, `HTTP ${emailStorta.stato}`);
    if (idVolontario) {
        await volontario.chiamata('/api/users/me/anagrafica', { method: 'PUT', body: { citta: 'Valdoro', telefono: '0437000000' } });
        await volontario.chiamata('/api/users/me/anagrafica', { method: 'PUT', body: { cap: '32100' } });
        const dopo = (await volontario.chiamata('/api/users/me')).corpo;
        verifica('l\'anagrafica si aggiorna per campi: quelli non inviati restano',
            dopo?.citta === 'Valdoro' && dopo?.telefono === '0437000000' && dopo?.cap === '32100', JSON.stringify({ c: dopo?.citta, t: dopo?.telefono, p: dopo?.cap }));
        for (const [campo, valore] of [['codice_fiscale', 'ABC'], ['telefono', '1'.repeat(21)], ['indirizzo', { via: 'x' }]]) {
            const r = await volontario.chiamata('/api/users/me/anagrafica', { method: 'PUT', body: { [campo]: valore } });
            verifica(`anagrafica con ${campo} non valido -> 400`, r.stato === 400, `HTTP ${r.stato}`);
        }
    }

    // ------------------------------------------------------------------
    // L'importazione legge un file caricato da fuori: i formati che non sa
    // leggere devono produrre un errore comprensibile, non un 500 generico né
    // un utente creato a metà.
    console.log('\n[7-ter] Importazione utenti da foglio');
    const inviaFoglio = async (nomeFile, contenuto, tipo) => {
        const modulo = new FormData();
        modulo.append('file', new Blob([contenuto], { type: tipo }), nomeFile);
        return admin.chiamata('/api/admin/import-users', { method: 'POST', body: modulo });
    };
    // Intestazione CFB: è così che comincia un vero .xls di Excel 2003.
    const intestazioneXls = new Uint8Array(512);
    intestazioneXls.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    const vecchioXls = await inviaFoglio('elenco.xls', intestazioneXls, 'application/vnd.ms-excel');
    verifica('formato .xls rifiutato con 400', vecchioXls.stato === 400, `HTTP ${vecchioXls.stato}`);
    verifica('il messaggio spiega come salvare il file',
        typeof vecchioXls.corpo?.message === 'string' && /\.xlsx|CSV/i.test(vecchioXls.corpo.message),
        vecchioXls.corpo?.message);

    const nonFoglio = await inviaFoglio('elenco.xlsx', '%PDF-1.4 non sono un foglio', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    verifica('file che non è un foglio rifiutato con 400', nonFoglio.stato === 400, `HTTP ${nonFoglio.stato}`);

    // Un import vero, con il CSV come lo salva l'Excel italiano: punto e
    // virgola, BOM, accenti. Ricaricato, non crea doppioni.
    {
        const s = Date.now().toString().slice(-6);
        const csv = `\uFEFFNome;Cognome;E-mail;Cellulare\r\nNicolò${s};D'Angelo${s};nicolo.${s}@esempio.it;3330000000\r\n;SenzaNome${s};;\r\n`;
        const primo = await inviaFoglio('volontari.csv', Buffer.from(csv, 'utf8'), 'text/csv');
        verifica('import di un CSV italiano: una persona entra, la riga senza nome no',
            primo.stato === 200 && primo.corpo?.details?.imported === 1 && primo.corpo?.details?.righe_saltate?.[0]?.riga === 3,
            `HTTP ${primo.stato} ${JSON.stringify(primo.corpo?.details)}`);
        const importato = primo.corpo?.details?.importati?.[0];
        verifica("l'importato ha username senza accenti e il suo link di attivazione",
            /^dangelo\d+n/.test(importato?.username || '') && /reset-password\.html\?token=/.test(importato?.magicLink || ''), JSON.stringify(importato));
        const secondo = await inviaFoglio('volontari.csv', Buffer.from(csv, 'utf8'), 'text/csv');
        verifica('lo stesso foglio ricaricato non crea doppioni e dice perché',
            secondo.stato === 200 && secondo.corpo?.details?.imported === 0
                && secondo.corpo?.details?.righe_saltate?.some(r => /C'è già/.test(r.motivo)), JSON.stringify(secondo.corpo?.details));
        const senzaColonne = await inviaFoglio('altro.csv', Buffer.from('Matricola;Reparto\r\n1;x\r\n'), 'text/csv');
        verifica('un foglio senza le colonne Nome e Cognome -> 400 che lo spiega',
            senzaColonne.stato === 400 && /Nome.*Cognome/.test(senzaColonne.corpo?.message || ''), `HTTP ${senzaColonne.stato}`);
        const id = (await admin.chiamata('/api/users')).corpo?.find(u => u.username === importato?.username)?.id;
        if (id) await admin.chiamata(`/api/users/${id}`, { method: 'DELETE' });
    }

    const importVolontario = await volontario.chiamata('/api/admin/import-users', { method: 'POST' });
    verifica('importazione negata al volontario', [401, 403].includes(importVolontario.stato), `HTTP ${importVolontario.stato}`);

    // ------------------------------------------------------------------
    console.log('\n[7-bis] Resoconto testuale delle emergenze');
    const archivio = await admin.chiamata('/api/admin/emergencies/closed');
    verifica('elenco emergenze archiviate consultabile', archivio.stato === 200, `HTTP ${archivio.stato}`);
    const emergenzaArchiviata = Array.isArray(archivio.corpo) ? archivio.corpo[0] : null;
    if (emergenzaArchiviata) {
        const resoconto = await admin.chiamata(`/api/admin/emergencies/${emergenzaArchiviata.id}/resoconto`);
        verifica('resoconto scaricabile dall\'amministratore', resoconto.stato === 200, `HTTP ${resoconto.stato}`);
        // Il resoconto viene rigenerato se il file manca: deve arrivare comunque
        // testo leggibile, non un errore o un oggetto JSON.
        verifica('il resoconto contiene le sezioni attese',
            typeof resoconto.corpo === 'string'
            && resoconto.corpo.includes('RESOCONTO EMERGENZA')
            // I resoconti scritti prima della 3.34 non hanno il diario di sala
            // e numerano le sezioni da 1: si controllano i titoli, non i numeri.
            && /\d\. SEGNALAZIONI/.test(resoconto.corpo)
            && /\d\. REGISTRO DELLE SQUADRE/.test(resoconto.corpo)
            && /\d\. MEZZI E MATERIALI IMPIEGATI/.test(resoconto.corpo)
            && /\d\. REGISTRO DELLE OPERAZIONI/.test(resoconto.corpo));
        const resocontoVolontario = await volontario.chiamata(`/api/admin/emergencies/${emergenzaArchiviata.id}/resoconto`);
        verifica('resoconto negato al volontario', [401, 403].includes(resocontoVolontario.stato), `HTTP ${resocontoVolontario.stato}`);

        // Un'emergenza chiusa e' archivio: solo l'amministratore la riapre.
        const idArchiviata = emergenzaArchiviata.id;
        const documentiAdmin = await admin.chiamata(`/api/emergencies/${idArchiviata}/documents`);
        const documentiVolontario = await volontario.chiamata(`/api/emergencies/${idArchiviata}/documents`);
        verifica("i documenti di un'emergenza chiusa li vede l'amministratore", documentiAdmin.stato === 200, `HTTP ${documentiAdmin.stato}`);
        verifica("i documenti di un'emergenza chiusa sono negati al volontario", documentiVolontario.stato === 403, `HTTP ${documentiVolontario.stato}`);
        const eventiVolontario = await volontario.chiamata(`/api/emergencies/${idArchiviata}/eventi`);
        verifica("gli eventi di un'emergenza chiusa sono negati al volontario", eventiVolontario.stato === 403, `HTTP ${eventiVolontario.stato}`);
        const segnalazioniArchiviate = await admin.chiamata(`/api/reports?emergency_id=${idArchiviata}&status_type=all&limit=1`);
        const segnalazioneArchiviata = segnalazioniArchiviate.corpo?.reports?.[0];
        if (segnalazioneArchiviata) {
            const perAdmin = await admin.chiamata(`/api/reports/${segnalazioneArchiviata.id}`);
            const perVolontario = await volontario.chiamata(`/api/reports/${segnalazioneArchiviata.id}`);
            verifica("una segnalazione di un'emergenza chiusa la apre l'amministratore", perAdmin.stato === 200, `HTTP ${perAdmin.stato}`);
            verifica("una segnalazione di un'emergenza chiusa e' negata al volontario", perVolontario.stato === 403, `HTTP ${perVolontario.stato}`);
        }
    } else {
        console.log('  --   nessuna emergenza archiviata: controlli sul resoconto saltati');
    }
    const resocontoInesistente = await admin.chiamata('/api/admin/emergencies/999999/resoconto');
    verifica('resoconto di emergenza inesistente -> 404', resocontoInesistente.stato === 404, `HTTP ${resocontoInesistente.stato}`);
    const resocontoIdNonValido = await admin.chiamata('/api/admin/emergencies/non-un-numero/resoconto');
    verifica('resoconto con ID non valido -> 400', resocontoIdNonValido.stato === 400, `HTTP ${resocontoIdNonValido.stato}`);

    // ------------------------------------------------------------------
    // La posizione delle squadre arriva dall'app sul telefono dei caposquadra.
    // Il centro operativo decide se una squadra è "viva" confrontando l'ora
    // dell'ultimo invio con l'ora attuale: un orario nel futuro spegnerebbe per
    // sempre quel controllo, e una squadra con l'app spenta continuerebbe a
    // sembrare in servizio.
    console.log('\n[7-quinquies] Posizioni delle squadre');
    const posizioni = await admin.chiamata('/api/location');
    verifica('elenco posizioni consultabile', posizioni.stato === 200, `HTTP ${posizioni.stato}`);
    if (Array.isArray(posizioni.corpo) && posizioni.corpo.length > 0) {
        const adesso = Date.now();
        const nelFuturo = posizioni.corpo.filter(r => {
            const t = new Date(String(r.last_update).replace(' ', 'T')).getTime();
            return !isNaN(t) && t - adesso > 60000; // un minuto di tolleranza
        });
        verifica('nessuna posizione datata nel futuro', nelFuturo.length === 0,
            nelFuturo.map(r => `${r.squadra_nome_descrittivo}: ${r.last_update}`).join(', '));
    } else {
        console.log('  --   nessuna posizione registrata: controllo saltato');
    }
    const posizioneSenzaDati = await admin.chiamata('/api/location', { method: 'POST', body: { squadra_id: 1 } });
    verifica('posizione senza coordinate rifiutata', posizioneSenzaDati.stato === 400, `HTTP ${posizioneSenzaDati.stato}`);

    // ------------------------------------------------------------------
    // Uscire deve invalidare il token davvero. La revoca lo cercava solo nel
    // cookie, quindi per l'app Android - che si autentica con l'intestazione
    // Authorization e cookie non ne ha - non revocava niente: il volontario
    // vedeva la schermata di accesso, ma il suo token restava buono fino alla
    // scadenza naturale, cioe' per un giorno intero.
    console.log('\n[7-septies] Il logout revoca il token');
    if (utenteDiProva && passwordDiProva) {
        const conBearer = creaClient();
        const accesso = await conBearer.chiamata('/login', {
            method: 'POST', body: { username: utenteDiProva, password: passwordDiProva }
        });
        const gettone = accesso.corpo?.token;
        if (!gettone) {
            console.log('  --   nessun token restituito dal login: controllo saltato');
        } else {
            // Un client senza cookie, come l'app: solo l'intestazione.
            const intestazione = { Authorization: `Bearer ${gettone}` };
            const primaDelLogout = await anonimo.chiamata('/api/users/me', { headers: intestazione });
            verifica('il token appena emesso funziona', primaDelLogout.stato === 200, `HTTP ${primaDelLogout.stato}`);

            const uscita = await anonimo.chiamata('/logout', { method: 'POST', headers: intestazione });
            verifica('logout accettato', uscita.stato === 200, `HTTP ${uscita.stato}`);

            const dopoIlLogout = await anonimo.chiamata('/api/users/me', { headers: intestazione });
            verifica("dopo il logout lo stesso token non funziona piu'",
                dopoIlLogout.stato === 401, `HTTP ${dopoIlLogout.stato}`);
            verifica("la risposta dice al client che la sessione e' finita",
                dopoIlLogout.corpo?.sessione_terminata === true,
                JSON.stringify(dopoIlLogout.corpo));
        }
    }

    // ------------------------------------------------------------------
    // Le risposte che chiudono la sessione vanno distinte da quelle che negano
    // una singola operazione: un client che le confonde o lascia l'utente
    // bloccato su un errore che non si sblocca, o lo butta fuori mentre lavora.
    // Attenzione: un token SCADUTO o non valido da' 403, non 401 (il 401 e'
    // riservato al token assente), quindi il codice da solo non basta.
    console.log('\n[7-octies] Le risposte che chiudono la sessione sono riconoscibili');
    const tokenRotto = await anonimo.chiamata('/api/users/me', { headers: { Authorization: 'Bearer non.un.token' } });
    verifica('token non valido contrassegnato come fine sessione',
        tokenRotto.corpo?.sessione_terminata === true, `HTTP ${tokenRotto.stato} ${JSON.stringify(tokenRotto.corpo)}`);
    const senzaToken = await anonimo.chiamata('/api/users/me');
    verifica('token assente contrassegnato come fine sessione',
        senzaToken.corpo?.sessione_terminata === true, `HTTP ${senzaToken.stato}`);
    const credenzialiSbagliate = await creaClient().chiamata('/login', {
        method: 'POST', body: { username: ADMIN_USER, password: 'password-sbagliata-xyz' }
    });
    verifica("una password sbagliata NON e' una sessione finita",
        credenzialiSbagliate.corpo?.sessione_terminata !== true, JSON.stringify(credenzialiSbagliate.corpo));

    // ------------------------------------------------------------------
    // Una squadra sta su una segnalazione sola. E' la regola su cui si regge
    // tutto il resto: il centro operativo offre come "disponibili" solo le
    // squadre libere, e la app delle squadre chiede la propria assegnazione con
    // limit=1 perche' ne esiste una.
    //
    // Il controllo che la fa rispettare guardava pero' solo la riga della
    // segnalazione: due operatori che assegnavano la STESSA squadra a DUE
    // segnalazioni diverse nello stesso momento bloccavano righe diverse, non si
    // vedevano, e passavano entrambi. Lanciando due richieste insieme la
    // violazione si otteneva ogni volta, non una ogni tanto.
    console.log('\n[7-sexies] Una squadra, una sola segnalazione');
    const emergenzaPerSquadre = await admin.chiamata('/api/emergencies/status');
    if (!emergenzaPerSquadre.corpo?.active) {
        console.log('  --   nessuna emergenza attiva: controllo saltato');
    } else {
        const nomiRadioLiberi = ['Xray', 'Yankee', 'Zulu', 'Whiskey', 'Victor'];
        let squadraProva = null;
        for (const nomeRadio of nomiRadioLiberi) {
            const tentativo = await admin.chiamata('/api/squadre', {
                method: 'POST', body: { nome_radio: nomeRadio, nome: 'Collaudo concorrenza', membri: [] }
            });
            if (tentativo.stato === 201 && tentativo.corpo?.squadraId) {
                squadraProva = tentativo.corpo.squadraId;
                break;
            }
        }
        if (!squadraProva) {
            console.log('  --   nessun nome radio libero per la squadra di prova: controllo saltato');
        } else {
            const creaSegnalazione = async (titolo) => {
                const r = await admin.chiamata('/api/reports', {
                    method: 'POST',
                    body: { title: titolo, reporter_name: 'Collaudo', reporter_contact: '000', priority: 'Low' }
                });
                return r.corpo?.id;
            };
            const primaSegnalazione = await creaSegnalazione('Collaudo concorrenza A');
            const secondaSegnalazione = await creaSegnalazione('Collaudo concorrenza B');

            if (!primaSegnalazione || !secondaSegnalazione) {
                console.log('  --   impossibile creare le segnalazioni di prova: controllo saltato');
            } else {
                // Le due richieste partono insieme, come da due postazioni diverse.
                const assegna = (idSegnalazione) => admin.chiamata(`/api/reports/${idSegnalazione}/teams`, {
                    method: 'POST', body: { teamId: squadraProva }
                });
                const esiti = await Promise.all([assegna(primaSegnalazione), assegna(secondaSegnalazione)]);
                const accettate = esiti.filter(e => e.stato === 201).length;
                const respinte = esiti.filter(e => e.stato === 409).length;
                verifica('due assegnazioni simultanee: una passa e una viene respinta con 409',
                    accettate === 1 && respinte === 1,
                    esiti.map(e => `HTTP ${e.stato}`).join(' / '));

                const attive = await admin.chiamata('/api/reports?status_type=active&limit=1000');
                const suQuante = (attive.corpo?.reports || [])
                    .filter(r => (r.assigned_teams || []).some(t => t.id === squadraProva)).length;
                verifica('la squadra risulta su una sola segnalazione attiva', suQuante <= 1,
                    `risulta su ${suQuante}`);

                // Le squadre offerte come disponibili devono essere quelle che il
                // server accetterebbe davvero: se le due definizioni divergono, il
                // centro operativo propone squadre che poi vengono rifiutate.
                const disponibili = await admin.chiamata('/api/squadre/disponibili');
                const elencoDisponibili = Array.isArray(disponibili.corpo) ? disponibili.corpo : [];
                verifica('una squadra impegnata non compare fra le disponibili',
                    suQuante === 0 || !elencoDisponibili.some(s => s.id === squadraProva));

                // Un rifiuto legittimo non deve presentarsi come un guasto.
                const chiusura = await admin.chiamata(`/api/reports/${secondaSegnalazione}`, {
                    method: 'PUT', body: { status: 'Closed' }
                });
                if (chiusura.stato === 200) {
                    const suChiusa = await admin.chiamata(`/api/reports/${secondaSegnalazione}/teams`, {
                        method: 'POST', body: { teamId: squadraProva }
                    });
                    verifica('assegnare a una segnalazione chiusa -> 409 (non 500)',
                        suChiusa.stato === 409, `HTTP ${suChiusa.stato}`);
                }
                const squadraInesistente = await admin.chiamata(`/api/reports/${primaSegnalazione}/teams`, {
                    method: 'POST', body: { teamId: 99999999 }
                });
                verifica('assegnare una squadra inesistente -> 404 (non 500)',
                    squadraInesistente.stato === 404, `HTTP ${squadraInesistente.stato}`);

                // Pulizia: le segnalazioni non si cancellano una per una, ma
                // chiuderle le toglie dalla coda operativa.
                await admin.chiamata(`/api/reports/${primaSegnalazione}`, { method: 'PUT', body: { status: 'Closed' } });
            }
            const eliminaSquadra = await admin.chiamata(`/api/squadre/${squadraProva}`, { method: 'DELETE' });
            verifica('squadra di prova eliminata', eliminaSquadra.stato === 200, `HTTP ${eliminaSquadra.stato}`);
        }
    }

    // ------------------------------------------------------------------
    // L'app Android chiede al server, in una chiamata sola, chi è e cosa può
    // fare, e legge una coda di notifiche che è solo sua. Qui si controlla che
    // la coda sia davvero personale, che arrivi anche dal WebSocket a chi è
    // collegato, e che un token revocato non possa restare in ascolto.
    console.log('\n[7-nonies] App Android: contesto e notifiche');
    if (idVolontario && utenteDiProva && passwordDiProva) {
        const contesto = await volontario.chiamata('/api/app/contesto');
        verifica('il contesto risponde al volontario', contesto.stato === 200, `HTTP ${contesto.stato}`);
        verifica('il contesto dichiara la versione del contratto', contesto.corpo?.contratto === 1,
            JSON.stringify(contesto.corpo?.contratto));
        verifica('il contesto dice chi sono', contesto.corpo?.utente?.id === idVolontario);
        verifica('un volontario ha il modulo Io', (contesto.corpo?.capacita || []).includes('io'),
            JSON.stringify(contesto.corpo?.capacita));
        verifica("nell'app la consegna dei DPI non è del volontario",
            !(contesto.corpo?.capacita || []).includes('magazzino.consegna'), JSON.stringify(contesto.corpo?.capacita));
        const contestoAdmin = await admin.chiamata('/api/app/contesto');
        verifica("l'amministratore, a magazzino acceso, consegna dall'app",
            contestoAdmin.corpo?.moduli?.magazzino !== true || (contestoAdmin.corpo?.capacita || []).includes('magazzino.consegna'),
            JSON.stringify(contestoAdmin.corpo?.capacita));
        verifica("un volontario non ha l'inventario del magazzino",
            !(contesto.corpo?.capacita || []).includes('magazzino.inventario'));
        verifica("il contesto dice ogni quanto controllare la coda ad app chiusa",
            Number.isInteger(contesto.corpo?.notifiche?.controllo_minuti) && contesto.corpo.notifiche.controllo_minuti >= 15);

        const dopoRotto = await volontario.chiamata('/api/notifiche?dopo=abc');
        verifica('"dopo" non numerico -> 400', dopoRotto.stato === 400, `HTTP ${dopoRotto.stato}`);
        const letteVuoto = await volontario.chiamata('/api/notifiche/lette', { method: 'POST', body: {} });
        verifica('segnare come lette senza dire quali -> 400', letteVuoto.stato === 400, `HTTP ${letteVuoto.stato}`);

        const primaDellaConsegna = await volontario.chiamata('/api/notifiche');
        let ultimoVisto = (primaDellaConsegna.corpo?.notifiche || []).reduce((m, n) => Math.max(m, n.id), 0);

        // Il volontario collegato col solo token, come l'app.
        const accessoApp = await creaClient().chiamata('/login', {
            method: 'POST', body: { username: utenteDiProva, password: passwordDiProva }
        });
        const gettoneApp = accessoApp.corpo?.token;

        let WebSocketNode = null;
        try { ({ WebSocket: WebSocketNode } = await import('ws')); } catch { /* controllo saltato sotto */ }
        const indirizzoWs = BASE.replace(/^http/, 'ws');
        const ricevuti = [];
        let canale = null;
        if (WebSocketNode && gettoneApp) {
            canale = await new Promise(risolvi => {
                const c = new WebSocketNode(indirizzoWs, { headers: { Authorization: `Bearer ${gettoneApp}` } });
                c.on('open', () => risolvi(c));
                c.on('error', () => risolvi(null));
                c.on('message', m => { try { ricevuti.push(JSON.parse(m.toString())); } catch { /* ignora */ } });
            });
            verifica("l'app si collega al WebSocket con il token", canale !== null);
        } else {
            console.log('  --   libreria ws o token assenti: controlli sul WebSocket saltati');
        }

        const configMagazzino = await admin.chiamata('/api/magazzino/config');
        const confermaPrima = configMagazzino.corpo?.conferma_dpi === true;
        const scarpe = await admin.chiamata('/api/magazzino/beni', {
            method: 'POST',
            body: { tipo: 'dpi', gestione: 'quantita', denominazione: `Scarpe antinfortunistiche ${Date.now().toString().slice(-6)}`,
                    taglia: '44', unita_misura: 'paia', quantita_totale: 7 }
        });
        verifica('un DPI a quantità con taglia si carica', scarpe.stato === 201, `HTTP ${scarpe.stato}`);

        if (scarpe.stato === 201) {
            // Verbale di consegna spento e conferma spenta: la consegna è solo
            // la consegna, anche se qualcuno chiede il verbale.
            await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { conferma_dpi: false, verbale_consegna: false } });
            const ctxBase = await admin.chiamata('/api/app/contesto');
            verifica('il contesto dice che il verbale di consegna è spento', ctxBase.corpo?.magazzino?.verbale_consegna === false,
                JSON.stringify(ctxBase.corpo?.magazzino));
            const base = await admin.chiamata('/api/magazzino/consegna', {
                method: 'POST',
                body: { destinatario: { tipo: 'persona', id: idVolontario }, verbale: true, righe: [{ bene_id: scarpe.corpo.id, quantita: 1 }] }
            });
            verifica('verbale di consegna spento: niente verbale anche se richiesto', base.stato === 201 && base.corpo?.verbale_id === null,
                `HTTP ${base.stato} ${JSON.stringify(base.corpo)}`);
            // Con la conferma dei DPI accesa il verbale c'è sempre: la conferma
            // si fa su di lui.
            await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { conferma_dpi: true, verbale_consegna: false } });
            const soloConferma = await admin.chiamata('/api/magazzino/consegna', {
                method: 'POST',
                body: { destinatario: { tipo: 'persona', id: idVolontario }, verbale: false, righe: [{ bene_id: scarpe.corpo.id, quantita: 1 }] }
            });
            verifica('con la conferma dei DPI il verbale c\'è sempre', soloConferma.stato === 201 && Number.isInteger(soloConferma.corpo?.verbale_id),
                `HTTP ${soloConferma.stato} ${JSON.stringify(soloConferma.corpo)}`);
            if (soloConferma.corpo?.verbale_id) {
                await volontario.chiamata(`/api/magazzino/verbali/${soloConferma.corpo.verbale_id}/conferma`, { method: 'POST' });
            }
            ultimoVisto = Math.max(ultimoVisto, ...(((await volontario.chiamata(`/api/notifiche?dopo=${ultimoVisto}`)).corpo?.notifiche || []).map(n => n.id)));

            // Conferma dall'app spenta: la consegna non deve chiedere niente a
            // nessuno, perché nessuno gli ha spiegato cosa fare.
            await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { conferma_dpi: false, verbale_consegna: true } });
            const senzaConferma = await admin.chiamata('/api/magazzino/consegna', {
                method: 'POST',
                body: { destinatario: { tipo: 'persona', id: idVolontario }, verbale: true, righe: [{ bene_id: scarpe.corpo.id, quantita: 1 }] }
            });
            verifica('consegna con verbale riuscita', senzaConferma.stato === 201, `HTTP ${senzaConferma.stato}`);
            const nienteNotifiche = await volontario.chiamata(`/api/notifiche?dopo=${ultimoVisto}`);
            verifica('a conferma spenta la consegna non produce notifiche',
                (nienteNotifiche.corpo?.notifiche || []).length === 0, JSON.stringify(nienteNotifiche.corpo));

            await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { conferma_dpi: true } });
            const conConferma = await admin.chiamata('/api/magazzino/consegna', {
                method: 'POST',
                body: { destinatario: { tipo: 'persona', id: idVolontario }, verbale: true, righe: [{ bene_id: scarpe.corpo.id, quantita: 1 }] }
            });
            verifica('seconda consegna con verbale riuscita', conConferma.stato === 201, `HTTP ${conConferma.stato}`);

            const nuove = await volontario.chiamata(`/api/notifiche?dopo=${ultimoVisto}`);
            const dpi = (nuove.corpo?.notifiche || []).find(n => n.tipo === 'dpi_da_confermare');
            verifica('a conferma accesa il volontario trova i DPI da confermare nella coda', !!dpi, JSON.stringify(nuove.corpo));
            verifica('la notifica porta al verbale giusto',
                dpi?.riferimento_tipo === 'verbale' && dpi?.riferimento_id === conConferma.corpo?.verbale_id,
                JSON.stringify(dpi));
            verifica('la notifica risulta non letta', (nuove.corpo?.non_lette || 0) >= 1);
            verifica('la notifica ha la sua categoria', dpi?.categoria === 'personale', JSON.stringify(dpi));

            if (canale) {
                await new Promise(r => setTimeout(r, 500));
                verifica("la notifica arriva subito anche dal WebSocket a chi e' collegato",
                    ricevuti.some(m => m.action === 'notifica' && m.notifica?.id === dpi?.id),
                    JSON.stringify(ricevuti.filter(m => m.action === 'notifica')));
            }

            const altrui = await admin.chiamata(`/api/notifiche?dopo=${(dpi?.id || 1) - 1}`);
            verifica("la coda e' personale: l'amministratore non vede le notifiche del volontario",
                !(altrui.corpo?.notifiche || []).some(n => n.id === dpi?.id));
            const letturaAltrui = await admin.chiamata('/api/notifiche/lette', { method: 'POST', body: { ids: [dpi?.id] } });
            verifica("non si segnano come lette le notifiche degli altri",
                letturaAltrui.corpo?.segnate === 0, JSON.stringify(letturaAltrui.corpo));

            const lette = await volontario.chiamata('/api/notifiche/lette', { method: 'POST', body: { fino_a: dpi?.id } });
            verifica('segnate come lette fino all\'ultima, non ne resta nessuna',
                lette.stato === 200 && lette.corpo?.non_lette === 0, JSON.stringify(lette.corpo));

            // Confermati i DPI, la richiesta di conferma sparisce dalla coda:
            // ha perso di significato.
            await volontario.chiamata(`/api/magazzino/verbali/${conConferma.corpo?.verbale_id}/conferma`, { method: 'POST' });
            const dopoConferma = await volontario.chiamata(`/api/notifiche?dopo=${(dpi?.id || 1) - 1}`);
            verifica('confermati i DPI, la notifica non è più in coda',
                !(dopoConferma.corpo?.notifiche || []).some(n => n.id === dpi?.id), JSON.stringify(dopoConferma.corpo));

            await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { conferma_dpi: confermaPrima } });
        }

        if (canale) canale.close();

        // Un token revocato col logout non deve poter aprire il canale.
        if (WebSocketNode && gettoneApp) {
            await anonimo.chiamata('/logout', { method: 'POST', headers: { Authorization: `Bearer ${gettoneApp}` } });
            const rifiutato = await new Promise(risolvi => {
                const c = new WebSocketNode(indirizzoWs, { headers: { Authorization: `Bearer ${gettoneApp}` } });
                c.on('open', () => { c.close(); risolvi(false); });
                c.on('error', () => risolvi(true));
                c.on('unexpected-response', () => risolvi(true));
            });
            verifica('un token revocato non apre il WebSocket', rifiutato);
        }

        // Il materiale in carico: il proprio lo vede chiunque, quello degli
        // altri non un utente esterno.
        const esterno = await admin.chiamata('/api/users', {
            method: 'POST', body: { nome: `Esterno${Date.now().toString().slice(-6)}`, cognome: 'Collaudo', role: 'esterno' }
        });
        if (esterno.stato === 201) {
            const parametri = new URL(esterno.corpo.magicLink).searchParams;
            const passwordEsterno = `Esterno!${Date.now().toString().slice(-6)}Aa1`;
            await anonimo.chiamata('/api/auth/reset-password', {
                method: 'POST', body: { token: parametri.get('token'), id: Number(parametri.get('id')), newPassword: passwordEsterno }
            });
            const clientEsterno = creaClient();
            await clientEsterno.chiamata('/login', { method: 'POST', body: { username: esterno.corpo.username, password: passwordEsterno } });

            const inCaricoAltrui = await clientEsterno.chiamata(`/api/magazzino/in-carico/persona/${idVolontario}`);
            verifica("un esterno non vede cosa ha in carico un volontario -> 403",
                inCaricoAltrui.stato === 403, `HTTP ${inCaricoAltrui.stato}`);
            const inCaricoProprio = await clientEsterno.chiamata(`/api/magazzino/in-carico/persona/${esterno.corpo.id}`);
            verifica("un esterno vede il proprio materiale in carico", inCaricoProprio.stato === 200, `HTTP ${inCaricoProprio.stato}`);
            const inCaricoDaInterno = await volontario.chiamata(`/api/magazzino/in-carico/persona/${esterno.corpo.id}`);
            verifica("un operatore interno vede il materiale altrui (serve al rientro)",
                inCaricoDaInterno.stato === 200, `HTTP ${inCaricoDaInterno.stato}`);

            const squadraEsterno = await clientEsterno.chiamata('/api/squadre', {
                method: 'POST', body: { nome_radio: 'Oscar', nome: 'Creata da un esterno', membri: [] }
            });
            verifica('un esterno non crea squadre -> 403', squadraEsterno.stato === 403, `HTTP ${squadraEsterno.stato}`);
            const eliminaEsterno = await clientEsterno.chiamata('/api/squadre/999999', { method: 'DELETE' });
            verifica('un esterno non elimina squadre -> 403', eliminaEsterno.stato === 403, `HTTP ${eliminaEsterno.stato}`);
            const disponibiliEsterno = await clientEsterno.chiamata('/api/users/unassigned');
            verifica("un esterno non vede l'idoneita' dei volontari -> 403", disponibiliEsterno.stato === 403, `HTTP ${disponibiliEsterno.stato}`);

            // Nell'app un esterno ha solo l'emergenza: la vede e, in squadra,
            // ne manda la posizione (la Croce Rossa arrivata al COC).
            const contestoEsterno = await clientEsterno.chiamata('/api/app/contesto');
            verifica("per un esterno l'app ha solo l'emergenza",
                contestoEsterno.stato === 200 && (contestoEsterno.corpo?.capacita || []).join() === 'emergenza',
                `HTTP ${contestoEsterno.stato} ${JSON.stringify(contestoEsterno.corpo?.capacita)}`);
            const offertaEsterno = await clientEsterno.chiamata('/api/app/offerta');
            verifica("anche a un esterno il web può proporre l'app", offertaEsterno.stato === 200, `HTTP ${offertaEsterno.stato}`);

            await admin.chiamata(`/api/users/${esterno.corpo.id}`, { method: 'DELETE' });
        }
    }

    // ------------------------------------------------------------------
    console.log('\n[8] Tesserino pubblico');
    if (idVolontario) {
        const profilo = await volontario.chiamata('/api/users/me');
        const token = profilo.corpo?.public_token;
        if (token) {
            const statoEmergenza = await admin.chiamata('/api/emergencies/status');
            const badge = await anonimo.chiamata(`/api/public/volunteer/${token}`);
            verifica('tesserino pubblico raggiungibile senza sessione', badge.stato === 200, `HTTP ${badge.stato}`);
            if (statoEmergenza.corpo?.active) {
                verifica('con emergenza attiva il tesserino mostra i dati', badge.corpo?.available === true);
            } else {
                verifica('senza emergenza attiva il tesserino non rivela dati',
                    badge.corpo?.available === false && !badge.corpo?.cognome);
            }
            // Chi ha fatto l'accesso lo vede sempre, emergenza o no.
            const badgeConAccesso = await volontario.chiamata(`/api/public/volunteer/${token}`);
            verifica('con l\'accesso il tesserino si vede sempre',
                badgeConAccesso.stato === 200 && badgeConAccesso.corpo?.available === true, `HTTP ${badgeConAccesso.stato}`);
        }
        const badgeInventato = await anonimo.chiamata('/api/public/volunteer/token-non-valido');
        verifica('token del tesserino non valido rifiutato', badgeInventato.stato === 400, `HTTP ${badgeInventato.stato}`);

        // La foto profilo: chi ha fatto l'accesso la vede, chi ha solo il
        // link no. Il tesserino pubblico la mostra tramite il proprio token.
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        const moduloFoto = new FormData();
        moduloFoto.append('photo', new Blob([png], { type: 'image/png' }), 'io.png');
        const foto = await volontario.chiamata('/api/users/me/photo', { method: 'POST', body: moduloFoto });
        const urlFoto = foto.corpo?.photo_url;
        verifica('la foto profilo si carica', foto.stato === 200 && urlFoto?.startsWith('/api/photos/'), `HTTP ${foto.stato}`);
        if (urlFoto) {
            const fotoAnonima = await anonimo.chiamata(urlFoto);
            verifica('senza accesso la foto profilo non si scarica', fotoAnonima.stato === 401, `HTTP ${fotoAnonima.stato}`);
            const fotoPropria = await volontario.chiamata(urlFoto);
            verifica('con l\'accesso la foto profilo si scarica', fotoPropria.stato === 200, `HTTP ${fotoPropria.stato}`);
            if (token) {
                const badgeConFoto = await anonimo.chiamata(`/api/public/volunteer/${token}`);
                const fotoTesserino = await anonimo.chiamata(`/api/public/volunteer/${token}/photo`);
                if (badgeConFoto.corpo?.available) {
                    verifica('il tesserino pubblico mostra la foto dal proprio indirizzo',
                        badgeConFoto.corpo.photo_url === `/api/public/volunteer/${token}/photo` && fotoTesserino.stato === 200,
                        `${badgeConFoto.corpo.photo_url} HTTP ${fotoTesserino.stato}`);
                } else {
                    verifica('senza emergenza la foto del tesserino non si vede', fotoTesserino.stato === 404, `HTTP ${fotoTesserino.stato}`);
                }
            }
        }
    }

    // ------------------------------------------------------------------
    console.log('\n[8-quater] App Android: proposta e interruttore dell\'amministratore');
    const offertaPrima = await volontario.chiamata('/api/app/offerta');
    verifica('il web chiede se proporre l\'app', offertaPrima.stato === 200 && typeof offertaPrima.corpo?.disponibile === 'boolean',
        `HTTP ${offertaPrima.stato}`);
    const offertaAnonima = await anonimo.chiamata('/api/app/offerta');
    verifica('senza accesso non si chiede', [401, 403].includes(offertaAnonima.stato), `HTTP ${offertaAnonima.stato}`);
    const impostazioniApp = await anonimo.chiamata('/api/branding/settings');
    const valorePrima = impostazioniApp.corpo?.app_android_enabled ?? 'true';
    const spegni = await admin.chiamata('/api/branding/settings', { method: 'PUT', body: { app_android_enabled: 'false' } });
    verifica('l\'amministratore puo\' togliere l\'app al personale', spegni.stato === 200, `HTTP ${spegni.stato}`);
    const offertaSpenta = await volontario.chiamata('/api/app/offerta');
    verifica('app tolta: il web non la propone', offertaSpenta.corpo?.disponibile === false, JSON.stringify(offertaSpenta.corpo));
    const apkSpento = await anonimo.chiamata('/app/orion.apk');
    verifica('app tolta: l\'APK non si scarica', apkSpento.stato === 404, `HTTP ${apkSpento.stato}`);
    const contestoSpento = await volontario.chiamata('/api/app/contesto');
    verifica('app tolta: l\'app non propone aggiornamenti', contestoSpento.stato === 200 && contestoSpento.corpo?.app === null,
        JSON.stringify(contestoSpento.corpo?.app));
    await admin.chiamata('/api/branding/settings', { method: 'PUT', body: { app_android_enabled: valorePrima } });

    // ------------------------------------------------------------------
    console.log('\n[8-quinquies] Sessioni, token di rinnovo, tesserino rigenerato');
    {
        const persona = await admin.chiamata('/api/users', {
            method: 'POST', body: { nome: `Sessioni${Date.now().toString().slice(-6)}`, cognome: 'Collaudo', role: 'volontario' }
        });
        if (persona.stato === 201) {
            const parametri = new URL(persona.corpo.magicLink).searchParams;
            const primaPassword = `Sessioni!${Date.now().toString().slice(-6)}Aa1`;
            await anonimo.chiamata('/api/auth/reset-password', {
                method: 'POST', body: { token: parametri.get('token'), id: Number(parametri.get('id')), newPassword: primaPassword }
            });
            const web = creaClient();
            const telefono = creaClient();
            await web.chiamata('/login', { method: 'POST', body: { username: persona.corpo.username, password: primaPassword } });
            const accessoTelefono = await telefono.chiamata('/login', { method: 'POST', body: { username: persona.corpo.username, password: primaPassword } });
            const tokenTelefono = accessoTelefono.corpo?.token;
            const conToken = (percorso, opzioni = {}) => creaClient().chiamata(percorso, { ...opzioni, headers: { Authorization: `Bearer ${tokenTelefono}` } });

            const rinnovo = await conToken('/api/app/rinnovo', { method: 'POST', body: { dispositivo: 'Collaudo' } });
            verifica("l'app ottiene un token di rinnovo", rinnovo.stato === 201 && typeof rinnovo.corpo?.rinnovo === 'string', `HTTP ${rinnovo.stato}`);
            const conRinnovo = await anonimo.chiamata('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: rinnovo.corpo?.rinnovo } });
            verifica('con il token di rinnovo si entra senza password', conRinnovo.stato === 200 && typeof conRinnovo.corpo?.token === 'string',
                `HTTP ${conRinnovo.stato}`);
            const rinnovoFinto = await anonimo.chiamata('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: 'x'.repeat(43) } });
            verifica('un token di rinnovo inventato -> 401', rinnovoFinto.stato === 401, `HTTP ${rinnovoFinto.stato}`);

            const nuovaPassword = `Cambiata!${Date.now().toString().slice(-6)}Bb2`;
            const cambio = await web.chiamata('/api/users/change-password', {
                method: 'POST', body: { currentPassword: primaPassword, newPassword: nuovaPassword, confirmPassword: nuovaPassword }
            });
            verifica('cambio password riuscito', cambio.stato === 200, `HTTP ${cambio.stato}`);
            const webDopo = await web.chiamata('/api/users/me');
            verifica('chi cambia la password resta dentro', webDopo.stato === 200, `HTTP ${webDopo.stato}`);
            const telefonoDopo = await conToken('/api/users/me');
            verifica('le altre sessioni si chiudono al cambio password', [401, 403].includes(telefonoDopo.stato), `HTTP ${telefonoDopo.stato}`);
            const rinnovoDopo = await anonimo.chiamata('/api/app/rinnovo/accesso', { method: 'POST', body: { rinnovo: rinnovo.corpo?.rinnovo } });
            verifica('e anche i token di rinnovo', rinnovoDopo.stato === 401, `HTTP ${rinnovoDopo.stato}`);

            // Un tesserino perso: il QR vecchio smette di funzionare.
            const vecchio = (await web.chiamata('/api/users/me')).corpo?.public_token;
            const rigenera = await admin.chiamata(`/api/admin/users/${persona.corpo.id}/rigenera-tesserino`, { method: 'POST' });
            verifica('la segreteria rigenera il QR del tesserino',
                rigenera.stato === 200 && rigenera.corpo?.public_token && rigenera.corpo.public_token !== vecchio, `HTTP ${rigenera.stato}`);
            if (vecchio) {
                const tesserinoVecchio = await web.chiamata(`/api/public/volunteer/${vecchio}`);
                verifica('il QR vecchio non vale piu\'', tesserinoVecchio.stato === 404, `HTTP ${tesserinoVecchio.stato}`);
            }
            const rigeneraVolontario = await volontario.chiamata(`/api/admin/users/${persona.corpo.id}/rigenera-tesserino`, { method: 'POST' });
            verifica('un volontario non rigenera tesserini', [401, 403].includes(rigeneraVolontario.stato), `HTTP ${rigeneraVolontario.stato}`);

            // Il fascicolo della segreteria legge QR e foto di una persona sola;
            // l'elenco degli utenti non li porta.
            const tesserino = await admin.chiamata(`/api/admin/users/${persona.corpo.id}/tesserino`);
            verifica('la segreteria legge il QR del tesserino di un volontario',
                tesserino.stato === 200 && /^[0-9a-f-]{36}$/.test(tesserino.corpo?.public_token || ''), `HTTP ${tesserino.stato}`);
            const elencoUtenti = await admin.chiamata('/api/admin/users');
            verifica("l'elenco degli utenti non porta i token dei tesserini",
                elencoUtenti.stato === 200 && !JSON.stringify(elencoUtenti.corpo).includes('public_token'));
            const tesserinoAlVolontario = await volontario.chiamata(`/api/admin/users/${persona.corpo.id}/tesserino`);
            verifica('un volontario non legge il tesserino degli altri -> 403', tesserinoAlVolontario.stato === 403, `HTTP ${tesserinoAlVolontario.stato}`);
            const fotoDalVolontario = await volontario.chiamata(`/api/admin/users/${persona.corpo.id}/photo`, { method: 'POST' });
            verifica('un volontario non cambia la foto degli altri -> 403', fotoDalVolontario.stato === 403, `HTTP ${fotoDalVolontario.stato}`);
            const fotoVuota = await admin.chiamata(`/api/admin/users/${persona.corpo.id}/photo`, { method: 'POST' });
            verifica('senza immagine la foto non cambia -> 400', fotoVuota.stato === 400, `HTTP ${fotoVuota.stato}`);

            // QR spenti dall'amministrazione: il token non esce da nessuna
            // parte e la pagina pubblica non verifica piu' niente.
            const tokenPrima = tesserino.corpo?.public_token;
            const spegni = await admin.chiamata('/api/branding/settings', { method: 'PUT', body: { badge_qr_enabled: 'false' } });
            verifica("l'amministratore spegne i QR dei volontari", spegni.stato === 200, `HTTP ${spegni.stato}`);
            const tesserinoSpento = await admin.chiamata(`/api/admin/users/${persona.corpo.id}/tesserino`);
            verifica('spenti, il fascicolo non riceve il token',
                tesserinoSpento.stato === 200 && tesserinoSpento.corpo?.public_token === null && tesserinoSpento.corpo?.qr_attivo === false);
            const profiloSpento = await volontario.chiamata('/api/users/me');
            verifica('spenti, nemmeno il profilo del volontario', profiloSpento.stato === 200 && profiloSpento.corpo?.public_token === null);
            const contestoSpento = await volontario.chiamata('/api/app/contesto');
            verifica("spenti, il contesto dell'app lo dice", contestoSpento.corpo?.moduli?.tesserini_qr === false,
                JSON.stringify(contestoSpento.corpo?.moduli));
            if (tokenPrima) {
                const pubblicoSpento = await anonimo.chiamata(`/api/public/volunteer/${tokenPrima}`);
                verifica('spenti, la pagina pubblica non verifica i tesserini gia\' stampati',
                    pubblicoSpento.corpo?.available === false && !pubblicoSpento.corpo?.nome, JSON.stringify(pubblicoSpento.corpo));
            }
            await admin.chiamata('/api/branding/settings', { method: 'PUT', body: { badge_qr_enabled: 'true' } });
            const riacceso = await admin.chiamata(`/api/admin/users/${persona.corpo.id}/tesserino`);
            verifica('riaccesi, torna lo stesso QR', riacceso.corpo?.public_token === tokenPrima);

            await admin.chiamata(`/api/users/${persona.corpo.id}`, { method: 'DELETE' });
        } else {
            console.log('  --   utente di prova non creato: controlli saltati');
        }

        // Le impostazioni pubbliche non devono portarsi dietro gli indirizzi
        // della segreteria.
        const completa = await admin.chiamata('/api/branding/settings/full');
        const segreteriaPrima = completa.corpo?.segreteria_config;
        const prova = JSON.stringify({ enabled: false, custom_emails: 'interno@esempio.it', custom_user_email_template: 'Ciao {NOME}' });
        await admin.chiamata('/api/branding/settings', { method: 'PUT', body: { segreteria_config: prova } });
        const pubbliche = await anonimo.chiamata('/api/branding/settings');
        verifica('le email interne della segreteria non sono pubbliche',
            !JSON.stringify(pubbliche.corpo || {}).includes('interno@esempio.it'), JSON.stringify(pubbliche.corpo?.segreteria_config));
        // Il riepilogo delle scadenze mandato a mano: con la segreteria spenta
        // lo dice, invece di rispondere "inviato" senza aver mandato niente.
        const reportSpento = await admin.chiamata('/api/admin/report-scadenze', { method: 'POST' });
        verifica('il riepilogo a segreteria spenta non parte e lo dice -> 409',
            reportSpento.stato === 409 && /spento/i.test(reportSpento.corpo?.message || ''), `HTTP ${reportSpento.stato}`);
        const reportVolontario = await volontario.chiamata('/api/admin/report-scadenze', { method: 'POST' });
        verifica('un volontario non manda il riepilogo -> 403', reportVolontario.stato === 403, `HTTP ${reportVolontario.stato}`);
        const vecchiaRotta = await admin.chiamata('/api/admin/test-cron');
        verifica('la vecchia rotta GET che mandava email non esiste più', vecchiaRotta.stato === 404, `HTTP ${vecchiaRotta.stato}`);

        await admin.chiamata('/api/branding/settings', {
            method: 'PUT', body: { segreteria_config: typeof segreteriaPrima === 'string' ? segreteriaPrima : JSON.stringify(segreteriaPrima ?? { enabled: false }) }
        });
    }

    // ------------------------------------------------------------------
    console.log('\n[8-ter] Pagine riservate');
    for (const pagina of ['/centro-operativo.html', '/admin-segreteria.html', '/magazzino.html', '/profile.html', '/print-report.html', '/magazzino-etichette.html', '/magazzino-verbale.html']) {
        const senza = await anonimo.chiamata(pagina);
        verifica(`${pagina} senza accesso rimanda al login`, senza.stato === 302, `HTTP ${senza.stato}`);
    }
    const paginaConAccesso = await volontario.chiamata('/centro-operativo.html');
    verifica('con l\'accesso la pagina si apre', paginaConAccesso.stato === 200, `HTTP ${paginaConAccesso.stato}`);
    for (const pagina of ['/', '/badge.html', '/reset-password.html', '/logo.png']) {
        const pubblica = await anonimo.chiamata(pagina);
        verifica(`${pagina} resta pubblica`, pubblica.stato === 200 || (pagina === '/logo.png' && pubblica.stato === 404), `HTTP ${pubblica.stato}`);
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    console.log('\n[8-bis] Sistema: backup e ripristino');
    // Qui NON si ripristina niente: un ripristino cancella il database, e
    // questa batteria gira anche su istanze di collaudo con dentro dati veri.
    // Si controlla chi può fare cosa e che le conferme deboli vengano rifiutate.
    const backupAmministratore = await admin.chiamata('/api/sistema/backup');
    verifica('l\'amministratore vede l\'elenco dei backup',
        backupAmministratore.stato === 200 && Array.isArray(backupAmministratore.corpo?.backup),
        `HTTP ${backupAmministratore.stato}`);

    const primoBackup = backupAmministratore.corpo?.backup?.[0];
    if (primoBackup) {
        const verificato = await admin.chiamata(
            `/api/sistema/backup/${primoBackup.cartella}/${encodeURIComponent(primoBackup.nome)}/verifica`, { method: 'POST' });
        verifica('un backup si verifica dalla pagina Sistema',
            verificato.stato === 200 && typeof verificato.corpo?.valido === 'boolean', `HTTP ${verificato.stato}`);
    }

    const backupAlVolontario = await volontario.chiamata('/api/sistema/backup');
    verifica('un volontario non vede i backup -> 403', backupAlVolontario.stato === 403, `HTTP ${backupAlVolontario.stato}`);

    const backupAnonimo = await anonimo.chiamata('/api/sistema/backup');
    verifica('senza sessione i backup non si leggono -> 401',
        backupAnonimo.stato === 401, `HTTP ${backupAnonimo.stato}`);

    const ripristinoSenzaConferma = await admin.chiamata('/api/sistema/ripristino', {
        method: 'POST', body: { cartella: 'app', nome: 'db_20200101_000000_finto.sql.gz', password: ADMIN_PASSWORD }
    });
    verifica('senza la parola di conferma il ripristino non parte -> 400',
        ripristinoSenzaConferma.stato === 400, `HTTP ${ripristinoSenzaConferma.stato}`);

    const ripristinoPasswordSbagliata = await admin.chiamata('/api/sistema/ripristino', {
        method: 'POST', body: { cartella: 'app', nome: 'db_20200101_000000_finto.sql.gz', password: 'non-la-mia-password', conferma: 'RIPRISTINA' }
    });
    verifica('con la password sbagliata il ripristino non parte -> 403',
        ripristinoPasswordSbagliata.stato === 403, `HTTP ${ripristinoPasswordSbagliata.stato}`);

    const ripristinoFileInventato = await admin.chiamata('/api/sistema/ripristino', {
        method: 'POST', body: { cartella: 'app', nome: 'db_20200101_000000_inesistente.sql.gz', password: ADMIN_PASSWORD, conferma: 'RIPRISTINA' }
    });
    verifica('un archivio inesistente viene rifiutato prima di toccare il database -> 400',
        ripristinoFileInventato.stato === 400, `HTTP ${ripristinoFileInventato.stato}`);

    const nomeConPercorso = await admin.chiamata('/api/sistema/backup/app/..%2F..%2Fetc%2Fpasswd');
    verifica('un nome di file che esce dalla cartella viene rifiutato',
        nomeConPercorso.stato === 400 || nomeConPercorso.stato === 404, `HTTP ${nomeConPercorso.stato}`);

    // Aggiornamenti: qui NON si aggiorna niente. Si controlla che il contatto
    // col mondo esterno sia spento finché qualcuno non lo accende, e che
    // nessuno oltre all'amministratore possa toccarlo.
    const versione = await admin.chiamata('/api/sistema/versione');
    verifica('la pagina Sistema sa dire che versione è installata',
        versione.stato === 200 && typeof versione.corpo?.versione_installata === 'string',
        `HTTP ${versione.stato}`);

    const versioneAlVolontario = await volontario.chiamata('/api/sistema/versione');
    verifica('un volontario non legge lo stato dell\'installazione -> 403',
        versioneAlVolontario.stato === 403, `HTTP ${versioneAlVolontario.stato}`);

    const configAlVolontario = await volontario.chiamata('/api/sistema/aggiornamenti/config', {
        method: 'PUT', body: { attivo: true }
    });
    verifica('un volontario non configura gli aggiornamenti -> 403',
        configAlVolontario.stato === 403, `HTTP ${configAlVolontario.stato}`);

    const origineInventata = await admin.chiamata('/api/sistema/aggiornamenti/config', {
        method: 'PUT', body: { origine: 'piccione-viaggiatore' }
    });
    verifica('un\'origine degli aggiornamenti inventata viene rifiutata -> 400',
        origineInventata.stato === 400, `HTTP ${origineInventata.stato}`);

    const chiaveInterna = await admin.chiamata('/api/branding/settings', {
        method: 'PUT', body: { aggiornamenti_stato: JSON.stringify({ versione: '99.0.0', pacchetto: 'http://altrove.invalid/x.tgz' }) }
    });
    verifica('lo stato degli aggiornamenti non si scrive dalle impostazioni -> 400', chiaveInterna.stato === 400, `HTTP ${chiaveInterna.stato}`);
    const chiaveStrana = await admin.chiamata('/api/branding/settings', { method: 'PUT', body: { 'Chiave Strana!': 'x' } });
    verifica('una chiave di impostazione malformata -> 400', chiaveStrana.stato === 400, `HTTP ${chiaveStrana.stato}`);

    // Un dump con un comando di psql ("\\!" esegue un programma sul server)
    // viene rifiutato già al caricamento.
    {
        const { gzipSync } = await import('zlib');
        const righe = ['--', '-- PostgreSQL database dump', '--', 'SET statement_timeout = 0;'];
        for (let i = 0; i < 200; i++) righe.push(`-- ${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`);
        righe.push('\\! touch /tmp/orion-collaudo-non-deve-esistere');
        const archivio = gzipSync(Buffer.from(righe.join('\n') + '\n'));
        const modulo = new FormData();
        modulo.append('archivio', new Blob([archivio]), 'db_20200101_000000_manomesso.sql.gz');
        const caricato = await admin.chiamata('/api/sistema/backup/carica', { method: 'POST', body: modulo });
        verifica('un backup con un comando di psql viene rifiutato al caricamento -> 400',
            caricato.stato === 400 && /comando di psql/.test(caricato.corpo?.message || ''), `HTTP ${caricato.stato} ${JSON.stringify(caricato.corpo)}`);
    }

    // "Controlla adesso" funziona anche con il controllo giornaliero spento.
    // Il servizio è una porta chiusa sulla macchina stessa: niente rete.
    {
        const configPrima = (await admin.chiamata('/api/sistema/versione')).corpo?.aggiornamenti || {};
        await admin.chiamata('/api/sistema/aggiornamenti/config', {
            method: 'PUT', body: { attivo: false, origine: 'manifesto', manifesto: 'http://127.0.0.1:1/orion.json' }
        });
        const aMano = await admin.chiamata('/api/sistema/aggiornamenti/controlla', { method: 'POST' });
        verifica('il controllo a mano parte anche col giornaliero spento (servizio irraggiungibile -> 502)',
            aMano.stato === 502 && !/spento/.test(aMano.corpo?.message || ''), `HTTP ${aMano.stato} ${JSON.stringify(aMano.corpo)}`);
        await admin.chiamata('/api/sistema/aggiornamenti/config', {
            method: 'PUT', body: { attivo: !!configPrima.attivo, origine: configPrima.origine || 'github', manifesto: configPrima.manifesto || '' }
        });
    }

    // Con un'emergenza aperta non si aggiorna: lo dicono già i requisiti.
    {
        const stato = await admin.chiamata('/api/emergencies/status');
        const giaAperta = !!(stato.corpo?.emergency || stato.corpo?.active);
        if (!giaAperta) await admin.chiamata('/api/emergencies/open', { method: 'POST', body: { external_code: `AGG-${Date.now().toString().slice(-6)}` } });
        const inEmergenza = await admin.chiamata('/api/sistema/versione');
        verifica('con un\'emergenza aperta l\'aggiornamento è bloccato',
            inEmergenza.corpo?.requisiti?.pronto === false && (inEmergenza.corpo?.requisiti?.problemi || []).some(p => /emergenza aperta/.test(p)),
            JSON.stringify(inEmergenza.corpo?.requisiti));
        if (!giaAperta) await admin.chiamata('/api/emergencies/close', { method: 'POST', body: {} });
    }

    const aggiornaSenzaConferma = await admin.chiamata('/api/sistema/aggiornamenti/applica', {
        method: 'POST', body: { password: ADMIN_PASSWORD }
    });
    verifica('senza la parola di conferma l\'aggiornamento non parte -> 400',
        aggiornaSenzaConferma.stato === 400, `HTTP ${aggiornaSenzaConferma.stato}`);

    const aggiornaPasswordSbagliata = await admin.chiamata('/api/sistema/aggiornamenti/applica', {
        method: 'POST', body: { password: 'non-la-mia-password', conferma: 'AGGIORNA' }
    });
    verifica('con la password sbagliata l\'aggiornamento non parte -> 403',
        aggiornaPasswordSbagliata.stato === 403, `HTTP ${aggiornaPasswordSbagliata.stato}`);

    const paginaSistemaAlVolontario = await volontario.chiamata('/admin/sistema.html');
    verifica('la pagina Sistema non si apre senza essere amministratori -> 403',
        paginaSistemaAlVolontario.stato === 403, `HTTP ${paginaSistemaAlVolontario.stato}`);

    // ------------------------------------------------------------------
    // Gli esterni temporanei: la Croce Rossa arriva al COC, le si dà un
    // accesso con un nome e un QR, entra in una squadra e manda la posizione.
    // Tutto finisce con l'emergenza.
    console.log('\n[8-sexies] Esterni temporanei');
    {
        const stato = await admin.chiamata('/api/emergencies/status');
        const giaAperta = !!(stato.corpo?.emergency || stato.corpo?.active);
        if (!giaAperta) {
            const senza = await volontario.chiamata('/api/esterni-temporanei', { method: 'POST', body: { nome: 'Nessuna Emergenza' } });
            verifica("senza emergenza l'accesso temporaneo non si crea -> 409", senza.stato === 409, `HTTP ${senza.stato}`);
        }
        const aperta = giaAperta ? null : await admin.chiamata('/api/emergencies/open', {
            method: 'POST', body: { external_code: `PROVA-EST-${Date.now().toString().slice(-6)}`, name: 'Prova esterni temporanei' }
        });
        if (!giaAperta) verifica('emergenza di prova aperta', aperta.stato === 200 || aperta.stato === 201, `HTTP ${aperta?.stato}`);
        let avvisoApertura = null;
        if (!giaAperta) {
            // L'apertura finisce nella coda di tutti (non per email).
            for (let i = 0; i < 20 && !avvisoApertura; i++) {
                await new Promise(r => setTimeout(r, 150));
                avvisoApertura = ((await volontario.chiamata('/api/notifiche')).corpo?.notifiche || [])
                    .find(n => n.tipo === 'emergenza_aperta' && n.riferimento_id === aperta.corpo?.emergency?.id);
            }
            verifica("l'apertura dell'emergenza arriva nella coda dei volontari, come emergenza",
                avvisoApertura?.categoria === 'emergenza' && !!avvisoApertura?.scade_il, JSON.stringify(avvisoApertura));
            const contestoEmergenza = await volontario.chiamata('/api/app/contesto');
            verifica("in emergenza l'app controlla la coda ogni 15 minuti",
                contestoEmergenza.corpo?.notifiche?.controllo_minuti === 15, JSON.stringify(contestoEmergenza.corpo?.notifiche));

            // Il diario di sala: note che non riguardano una segnalazione.
            const notaSala = await volontario.chiamata('/api/emergencies/diario-sala', {
                method: 'POST', body: { testo: 'Telefonata dalla Prefettura: allerta arancione fino a domani' }
            });
            verifica('nota nel diario di sala registrata', notaSala.stato === 201 && notaSala.corpo?.testo?.startsWith('Telefonata'),
                `HTTP ${notaSala.stato} ${JSON.stringify(notaSala.corpo)}`);
            const notaVuota = await volontario.chiamata('/api/emergencies/diario-sala', { method: 'POST', body: { testo: '   ' } });
            verifica('nota di sala vuota -> 400', notaVuota.stato === 400, `HTTP ${notaVuota.stato}`);
            const eventiSala = await volontario.chiamata(`/api/emergencies/${aperta.corpo?.emergency?.id}/eventi`);
            verifica('la nota di sala compare fra gli eventi',
                (eventiSala.corpo || []).some(e => e.tipo === 'sala' && /Prefettura/.test(e.testo || '')), JSON.stringify((eventiSala.corpo || []).slice(0, 2)));
        }

        const squadre = await admin.chiamata('/api/squadre');
        const usati = new Set((squadre.corpo || []).map(s => s.nome_radio));
        const vuoto = await volontario.chiamata('/api/esterni-temporanei', { method: 'POST', body: { nome: '   ' } });
        verifica('senza nome -> 400', vuoto.stato === 400, `HTTP ${vuoto.stato}`);
        // Un nome radio libero: quelli delle squadre sciolte in questa
        // emergenza (anche da giri di prova precedenti) sono bloccati.
        let creato = null;
        let libero = null;
        for (const n of ['Zulu', 'Yankee', 'X-ray', 'Whiskey', 'Victor', 'Uniform', 'Tango', 'Sierra', 'Romeo', 'Quebec', 'Papa'].filter(n => !usati.has(n))) {
            libero = n;
            creato = await volontario.chiamata('/api/esterni-temporanei', {
                method: 'POST', body: { nome: 'Mario Soccorso', ente: 'Croce Rossa', nuova_squadra: { nome_radio: n, nome: 'Ambulanza CRI prova' } }
            });
            if (creato.stato !== 400 || !/nome radio/.test(creato.corpo?.message || '')) break;
        }
        verifica("un volontario al COC crea l'accesso con un nome, e una squadra nuova",
            creato.stato === 201 && /\/accesso\.html\?c=/.test(creato.corpo?.link || '') && creato.corpo?.squadra?.nome_radio === libero,
            `HTTP ${creato.stato} ${JSON.stringify(creato.corpo)}`);
        const codice = creato.corpo?.codice;
        const idTemp = creato.corpo?.id;
        const idSquadra = creato.corpo?.squadra?.id;

        const sbagliato = await anonimo.chiamata('/api/accesso-temporaneo', { method: 'POST', body: { codice: 'x'.repeat(24) } });
        verifica('un codice inventato -> 401', sbagliato.stato === 401, `HTTP ${sbagliato.stato}`);

        const cri = creaClient();
        const entrato = await cri.chiamata('/api/accesso-temporaneo', { method: 'POST', body: { codice } });
        verifica('con il codice si entra, come esterno',
            entrato.stato === 200 && !!entrato.corpo?.token && (entrato.corpo?.ruoli || []).join() === 'esterno' && entrato.corpo?.ente === 'Croce Rossa',
            `HTTP ${entrato.stato} ${JSON.stringify(entrato.corpo)}`);
        const contestoCri = await cri.chiamata('/api/app/contesto');
        verifica("nell'app l'esterno ha l'emergenza, e sa di essere temporaneo",
            contestoCri.stato === 200 && (contestoCri.corpo?.capacita || []).join() === 'emergenza'
                && contestoCri.corpo?.utente?.temporaneo === true && contestoCri.corpo?.squadra?.id === idSquadra,
            `HTTP ${contestoCri.stato} ${JSON.stringify({ c: contestoCri.corpo?.capacita, u: contestoCri.corpo?.utente, s: contestoCri.corpo?.squadra })}`);
        const posizione = await cri.chiamata('/api/location', { method: 'POST', body: { squadra_id: idSquadra, latitude: 46.14, longitude: 12.21 } });
        verifica('e manda la posizione della sua squadra', posizione.stato === 200, `HTTP ${posizione.stato} ${JSON.stringify(posizione.corpo)}`);
        const creaDaEsterno = await cri.chiamata('/api/esterni-temporanei', { method: 'POST', body: { nome: 'Altro' } });
        verifica('un esterno non crea altri accessi -> 403', creaDaEsterno.stato === 403, `HTTP ${creaDaEsterno.stato}`);

        // Il magazzino dell'associazione non è suo: inventario, movimenti e
        // "chi ha cosa" portano nomi e dotazioni dei volontari.
        for (const percorso of ['/api/magazzino/beni', '/api/magazzino/chi-ha-cosa', '/api/magazzino/movimenti', '/api/magazzino/categorie']) {
            const r = await cri.chiamata(percorso);
            verifica(`un esterno non legge ${percorso} -> 403`, r.stato === 403, `HTTP ${r.stato}`);
        }
        const verbaliEsterno = await cri.chiamata('/api/magazzino/verbali/miei');
        verifica('ma i propri verbali sì (o il modulo è spento)', [200, 403].includes(verbaliEsterno.stato) && (verbaliEsterno.stato === 200 || verbaliEsterno.corpo?.modulo_spento),
            `HTTP ${verbaliEsterno.stato}`);
        const documentoEsterno = await cri.chiamata('/api/emergencies/documents', { method: 'POST', body: new FormData() });
        verifica("un esterno non carica documenti nell'emergenza -> 403", documentoEsterno.stato === 403, `HTTP ${documentoEsterno.stato}`);
        const rinnovoEsterno = await cri.chiamata('/api/app/rinnovo', { method: 'POST', body: { dispositivo: 'Collaudo' } });
        verifica('un accesso temporaneo non ottiene token di rinnovo -> 403', rinnovoEsterno.stato === 403, `HTTP ${rinnovoEsterno.stato}`);

        // Un esterno agisce solo sulle segnalazioni della sua squadra: una
        // segnalazione non assegnata a lui non la tocca, né con una nota né
        // spostandone il punto (le foto erano già protette così).
        const segnAltrui = await admin.chiamata('/api/reports', {
            method: 'POST', body: { title: 'Intervento di un\'altra squadra', reporter_name: 'Collaudo', reporter_contact: '000', priority: 'Low' }
        });
        if (segnAltrui.stato === 201) {
            const notaAltrui = await cri.chiamata(`/api/reports/${segnAltrui.corpo.id}/updates`, { method: 'POST', body: { update_text: 'non dovrei poterla scrivere' } });
            verifica('un esterno non annota una segnalazione non della sua squadra -> 403', notaAltrui.stato === 403, `HTTP ${notaAltrui.stato}`);
            const spostaAltrui = await cri.chiamata(`/api/reports/${segnAltrui.corpo.id}/coordinates`, { method: 'PUT', body: { latitude: 46.1, longitude: 12.1 } });
            verifica('un esterno non sposta il punto di una segnalazione non sua -> 403', spostaAltrui.stato === 403, `HTTP ${spostaAltrui.stato}`);
            await admin.chiamata(`/api/reports/${segnAltrui.corpo.id}`, { method: 'PUT', body: { status: 'Closed' } });
        }

        const elenco = await volontario.chiamata('/api/esterni-temporanei');
        verifica("l'elenco dell'emergenza lo mostra, entrato e in squadra",
            (elenco.corpo || []).some(v => v.id === idTemp && v.usato_il && v.nome_radio === libero), JSON.stringify(elenco.corpo));

        const nuovo = await volontario.chiamata(`/api/esterni-temporanei/${idTemp}/codice`, { method: 'POST' });
        const vecchio = await creaClient().chiamata('/api/accesso-temporaneo', { method: 'POST', body: { codice } });
        const conNuovo = await creaClient().chiamata('/api/accesso-temporaneo', { method: 'POST', body: { codice: nuovo.corpo?.codice } });
        verifica('un QR nuovo annulla il vecchio', nuovo.stato === 200 && vecchio.stato === 401 && conNuovo.stato === 200,
            `${nuovo.stato}/${vecchio.stato}/${conNuovo.stato}`);

        const revoca = await volontario.chiamata(`/api/esterni-temporanei/${idTemp}`, { method: 'DELETE' });
        const dopoRevoca = await cri.chiamata('/api/app/contesto');
        verifica("revocato, l'esterno è fuori subito, e l'app sa perché",
            revoca.stato === 200 && dopoRevoca.stato === 403 && dopoRevoca.corpo?.motivo === 'accesso_temporaneo_finito',
            `${revoca.stato}/${dopoRevoca.stato} ${JSON.stringify(dopoRevoca.corpo)}`);

        // Alla chiusura dell'emergenza gli accessi rimasti finiscono da soli.
        if (!giaAperta) {
            const secondo = await volontario.chiamata('/api/esterni-temporanei', {
                method: 'POST', body: { nome: 'Luca Tecnico', ente: 'Comune', squadra_id: idSquadra }
            });
            const tecnico = creaClient();
            await tecnico.chiamata('/api/accesso-temporaneo', { method: 'POST', body: { codice: secondo.corpo?.codice } });
            const notaEsterno = await tecnico.chiamata('/api/emergencies/diario-sala', { method: 'POST', body: { testo: 'Sono un esterno' } });
            verifica('un esterno non scrive nel diario di sala -> 403', notaEsterno.stato === 403, `HTTP ${notaEsterno.stato}`);
            const chiusa = await admin.chiamata('/api/emergencies/close', { method: 'POST' });
            const dopoChiusura = await tecnico.chiamata('/api/app/contesto');
            const codiceDopo = await creaClient().chiamata('/api/accesso-temporaneo', { method: 'POST', body: { codice: secondo.corpo?.codice } });
            verifica("chiusa l'emergenza, l'accesso temporaneo finisce: sessione e codice",
                secondo.stato === 201 && chiusa.stato === 200 && dopoChiusura.stato === 403
                    && dopoChiusura.corpo?.motivo === 'accesso_temporaneo_finito' && codiceDopo.stato === 401,
                `${secondo.stato}/${chiusa.stato}/${dopoChiusura.stato}/${codiceDopo.stato}`);
            const codaDopo = await volontario.chiamata('/api/notifiche');
            verifica("chiusa l'emergenza, il suo avviso esce dalla coda",
                !(codaDopo.corpo?.notifiche || []).some(n => n.id === avvisoApertura?.id), JSON.stringify(codaDopo.corpo?.notifiche?.slice(-3)));
            const contestoDopo = await volontario.chiamata('/api/app/contesto');
            verifica("fuori emergenza l'app controlla la coda ogni ora",
                contestoDopo.corpo?.notifiche?.controllo_minuti === 60, JSON.stringify(contestoDopo.corpo?.notifiche));
            // La squadra dell'ambulanza è rimasta vuota: si chiude d'ufficio,
            // dopo il resoconto (che gira subito dopo la risposta).
            let ancoraLi = true;
            for (let i = 0; i < 20 && ancoraLi; i++) {
                await new Promise(r => setTimeout(r, 250));
                ancoraLi = ((await admin.chiamata('/api/squadre')).corpo || []).some(s => s.id === idSquadra);
            }
            verifica("la squadra rimasta vuota si chiude d'ufficio alla chiusura", !ancoraLi);
            const resocontoProva = await admin.chiamata(`/api/admin/emergencies/${aperta.corpo?.emergency?.id}/resoconto`);
            verifica('il resoconto riporta il diario di sala',
                typeof resocontoProva.corpo === 'string' && resocontoProva.corpo.includes('1. DIARIO DI SALA')
                    && resocontoProva.corpo.includes('Telefonata dalla Prefettura'), `HTTP ${resocontoProva.stato}`);
        }
        if (idSquadra) await admin.chiamata(`/api/squadre/${idSquadra}`, { method: 'DELETE' });
    }

    // ------------------------------------------------------------------
    console.log('\n[9] Pulizia');
    await admin.chiamata('/api/magazzino/config', { method: 'PUT', body: { verbale_consegna: verbaleConsegnaPrima } });
    if (idVolontario) {
        // Il volontario di prova ha ancora in carico le scarpe consegnate in
        // [7-nonies]: si dichiarano rientrate, come farebbe l'amministratore.
        const inCaricoFinale = await admin.chiamata(`/api/magazzino/in-carico/persona/${idVolontario}`);
        const beni = (Array.isArray(inCaricoFinale.corpo) ? inCaricoFinale.corpo : [])
            .map(b => ({ bene_id: b.bene_id, decisione: 'rientrata' }));
        const eliminazione = await admin.chiamata(`/api/users/${idVolontario}`, { method: 'DELETE', body: { beni } });
        verifica('utente di prova eliminato', eliminazione.stato === 200, `HTTP ${eliminazione.stato}`);
    }
}

eseguiTest()
    .catch(err => {
        falliti++;
        fallimenti.push(`errore imprevisto durante i test: ${err.message}`);
        console.error('\nErrore imprevisto:', err.message);
    })
    .finally(() => {
        console.log(`\n${'='.repeat(56)}`);
        console.log(`Esiti: ${superati} superati, ${falliti} falliti`);
        if (falliti > 0) {
            console.log('\nControlli non superati:');
            fallimenti.forEach(f => console.log(`  - ${f}`));
        }
        console.log('='.repeat(56));
        process.exit(falliti > 0 ? 1 : 0);
    });
