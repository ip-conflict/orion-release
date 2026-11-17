// Pausa dopo troppi errori, per account e rete: chi sbaglia da una rete ferma solo quella.
// Contata sul solo account, un tentativo ogni quarto d'ora da fuori teneva fuori la persona
// per sempre. Contro chi prova da molte reti c'è una soglia per l'account intero, a durata fissa,
// che non ferma le reti da cui la persona è già entrata.

const TENTATIVI_LIBERI = 5;
const PAUSA_INIZIALE_MS = 60 * 1000;
const PAUSA_MASSIMA_MS = 15 * 60 * 1000;
const DIMENTICA_DOPO_MS = 60 * 60 * 1000;
const SOGLIA_ACCOUNT = 30;
const FINESTRA_ACCOUNT_MS = 60 * 60 * 1000;
const PAUSA_ACCOUNT_MS = 5 * 60 * 1000;
const VOCI_MASSIME = 20000;
const RETI_FIDATE_PER_ACCOUNT = 20;
const FIDATA_PER_MS = 30 * 24 * 60 * 60 * 1000;

const perRete = new Map();    // "nome|rete" -> { errori, ultimo, fermoFino }
const perAccount = new Map(); // nome -> { errori: [istanti], fermoFino, avvisatoIl }
// A parte, e scritta solo da un accesso riuscito: chi prova nomi a caso non la può svuotare.
const retiFidate = new Map(); // nome -> Map(rete -> ultimo accesso)
// Le verifiche partite e non ancora finite contano come errori: senza, cento richieste mandate
// insieme passavano tutte il controllo prima che la prima arrivasse a contare.
const inCorso = new Map(); // chiave -> quante

const chiave = (nome) => String(nome || '').trim().toLowerCase().slice(0, 200);
const chiaveRete = (nome, rete) => `${chiave(nome)}|${String(rete || '').slice(0, 100)}`;
const secondi = (fino, ora) => (fino > ora ? Math.ceil((fino - ora) / 1000) : 0);

// Un attacco con nomi sempre diversi non deve riempire la memoria: via le voci più vecchie.
function sfoltisci(mappa, ultimo, dimenticabile, ora) {
    if (mappa.size < VOCI_MASSIME) return;
    for (const [k, v] of mappa) if (dimenticabile(v, ora)) mappa.delete(k);
    if (mappa.size < VOCI_MASSIME) return;
    [...mappa.entries()].sort((a, b) => ultimo(a[1]) - ultimo(b[1]))
        .slice(0, mappa.size - VOCI_MASSIME / 2).forEach(([k]) => mappa.delete(k));
}

function pulisci(ora) {
    sfoltisci(perRete, v => v.ultimo, (v, t) => t - v.ultimo > DIMENTICA_DOPO_MS && v.fermoFino < t, ora);
    sfoltisci(perAccount, v => v.errori.at(-1) || 0,
        (v, t) => !v.errori.some(e => t - e < FINESTRA_ACCOUNT_MS) && v.fermoFino < t, ora);
}

const fidata = (nome, rete, ora) => ora - (retiFidate.get(chiave(nome))?.get(String(rete || '')) || -Infinity) < FIDATA_PER_MS;

export function attesaPerAccount(nome, rete, ora = Date.now()) {
    const perTutto = fidata(nome, rete, ora) ? 0 : secondi(perAccount.get(chiave(nome))?.fermoFino, ora);
    return Math.max(perTutto, secondi(perRete.get(chiaveRete(nome, rete))?.fermoFino, ora));
}

function occupa(...chiavi) {
    chiavi.forEach(k => inCorso.set(k, (inCorso.get(k) || 0) + 1));
    let liberato = false;
    return () => {
        if (liberato) return;
        liberato = true;
        chiavi.forEach(k => { const n = inCorso.get(k) - 1; if (n > 0) inCorso.set(k, n); else inCorso.delete(k); });
    };
}
// Oltre la soglia ne passa uno alla volta: la pausa scatta al primo errore, non dopo il centesimo.
const occupato = (k, errori, soglia) => (inCorso.get(k) || 0) >= Math.max(1, soglia - errori);
const ATTESA_SE_OCCUPATO = 5;

// Da chiamare prima di controllare la password; fine() quando il controllo è finito, comunque sia andato.
export function iniziaAccesso(nome, rete, ora = Date.now()) {
    const attesa = attesaPerAccount(nome, rete, ora);
    if (attesa) return { attesa };
    const k = chiave(nome), kr = chiaveRete(nome, rete);
    const r = perRete.get(kr);
    const erroriRete = r && ora - r.ultimo <= DIMENTICA_DOPO_MS ? r.errori : 0;
    const erroriAccount = (perAccount.get(k)?.errori || []).filter(t => ora - t < FINESTRA_ACCOUNT_MS).length;
    if (occupato(`r:${kr}`, erroriRete, TENTATIVI_LIBERI)
        || (!fidata(nome, rete, ora) && occupato(`a:${k}`, erroriAccount, SOGLIA_ACCOUNT))) {
        return { attesa: ATTESA_SE_OCCUPATO };
    }
    return { attesa: 0, fine: occupa(`r:${kr}`, `a:${k}`) };
}

// sogliaSuperata vale una volta all'ora per account: è il momento di avvisare la persona.
export function erroreAccesso(nome, rete, ora = Date.now()) {
    const k = chiave(nome);
    if (!k) return { attesa: 0, sogliaSuperata: false };
    pulisci(ora);

    const kr = chiaveRete(nome, rete);
    let r = perRete.get(kr);
    if (!r || ora - r.ultimo > DIMENTICA_DOPO_MS) r = { errori: 0, ultimo: ora, fermoFino: 0 };
    r.errori++;
    r.ultimo = ora;
    if (r.errori >= TENTATIVI_LIBERI) {
        r.fermoFino = ora + Math.min(PAUSA_MASSIMA_MS, PAUSA_INIZIALE_MS * 2 ** (r.errori - TENTATIVI_LIBERI));
    }
    perRete.set(kr, r);

    const a = perAccount.get(k) || { errori: [], fermoFino: 0, avvisatoIl: 0 };
    a.errori = [...a.errori.filter(t => ora - t < FINESTRA_ACCOUNT_MS), ora].slice(-SOGLIA_ACCOUNT * 2);
    let sogliaSuperata = false;
    // Non si allunga riprovando: durante la pausa il login risponde prima di contare.
    if (a.errori.length >= SOGLIA_ACCOUNT && a.fermoFino <= ora) {
        a.fermoFino = ora + PAUSA_ACCOUNT_MS;
        // Si riparte da zero: altrimenti un errore solo, appena finita la pausa, la rimetteva.
        a.errori = [];
        if (ora - a.avvisatoIl > FINESTRA_ACCOUNT_MS) {
            a.avvisatoIl = ora;
            sogliaSuperata = true;
        }
    }
    perAccount.set(k, a);
    return { attesa: Math.max(secondi(r.fermoFino, ora), secondi(a.fermoFino, ora)), sogliaSuperata };
}

// Azzera la rete da cui si è entrati e la ricorda come fidata; il conto dell'account resta, se no
// una persona che entra cancellerebbe le tracce di chi la sta attaccando da altre reti.
export function accessoRiuscito(nome, rete, ora = Date.now()) {
    perRete.delete(chiaveRete(nome, rete));
    const k = chiave(nome);
    if (!k) return;
    const fidate = retiFidate.get(k) || new Map();
    fidate.delete(String(rete || ''));
    fidate.set(String(rete || ''), ora);
    while (fidate.size > RETI_FIDATE_PER_ACCOUNT) fidate.delete(fidate.keys().next().value);
    retiFidate.set(k, fidate);
}

export function messaggioAttesa(secondi) {
    const minuti = Math.ceil(secondi / 60);
    const fra = secondi < 60 ? 'qualche secondo' : minuti === 1 ? 'un minuto' : `${minuti} minuti`;
    return `Troppi tentativi sbagliati per questo account: riprova fra ${fra}.`;
}

// Chi sbaglia il codice dell'app ha già la password: si ferma l'account intero, non la rete.
// Il telefono collegato e i codici di riserva restano buoni, così la persona vera entra lo stesso.
const CODICI_LIBERI = 10;
const PAUSA_CODICI_INIZIALE_MS = 5 * 60 * 1000;
const PAUSA_CODICI_MASSIMA_MS = 60 * 60 * 1000;
const DIMENTICA_CODICI_DOPO_MS = 24 * 60 * 60 * 1000;
const codiciSbagliati = new Map(); // id utente -> { errori, ultimo, fermoFino, avvisatoIl }

export function attesaCodici(userId, ora = Date.now()) {
    return secondi(codiciSbagliati.get(userId)?.fermoFino, ora);
}

// Come iniziaAccesso, per i codici dell'app.
export function iniziaCodice(userId, ora = Date.now()) {
    const attesa = attesaCodici(userId, ora);
    if (attesa) return { attesa };
    const c = codiciSbagliati.get(userId);
    const errori = c && ora - c.ultimo <= DIMENTICA_CODICI_DOPO_MS ? c.errori : 0;
    if (occupato(`c:${userId}`, errori, CODICI_LIBERI)) return { attesa: ATTESA_SE_OCCUPATO };
    return { attesa: 0, fine: occupa(`c:${userId}`) };
}

// primaPausa vale al massimo una volta al giorno per account: è il momento di avvisare la persona.
export function codiceSbagliato(userId, ora = Date.now()) {
    sfoltisci(codiciSbagliati, v => v.ultimo, (v, t) => t - v.ultimo > DIMENTICA_CODICI_DOPO_MS && v.fermoFino < t, ora);
    let c = codiciSbagliati.get(userId);
    if (!c || ora - c.ultimo > DIMENTICA_CODICI_DOPO_MS) c = { errori: 0, ultimo: ora, fermoFino: 0, avvisatoIl: c?.avvisatoIl || 0 };
    c.errori++;
    c.ultimo = ora;
    let primaPausa = false;
    if (c.errori >= CODICI_LIBERI) {
        c.fermoFino = ora + Math.min(PAUSA_CODICI_MASSIMA_MS, PAUSA_CODICI_INIZIALE_MS * 2 ** (c.errori - CODICI_LIBERI));
        if (!c.avvisatoIl || ora - c.avvisatoIl > DIMENTICA_CODICI_DOPO_MS) {
            c.avvisatoIl = ora;
            primaPausa = true;
        }
    }
    codiciSbagliati.set(userId, c);
    return { attesa: secondi(c.fermoFino, ora), primaPausa };
}

export function azzeraCodiciSbagliati(userId) {
    const c = codiciSbagliati.get(userId);
    if (c) codiciSbagliati.set(userId, { errori: 0, ultimo: c.ultimo, fermoFino: 0, avvisatoIl: c.avvisatoIl });
}

// Ogni link nuovo annulla il precedente: senza tetto, chi conosce il nome terrebbe sempre
// scaduto quello che la persona sta per aprire, e le riempirebbe la casella.
const LINK_PER_FINESTRA = 3;
const FINESTRA_LINK_MS = 60 * 60 * 1000;
const linkRecupero = new Map(); // id utente -> [istanti]

export function attesaLinkRecupero(userId, ora = Date.now()) {
    const recenti = (linkRecupero.get(userId) || []).filter(t => ora - t < FINESTRA_LINK_MS);
    return recenti.length < LINK_PER_FINESTRA ? 0 : secondi(recenti[0] + FINESTRA_LINK_MS, ora);
}

export function linkRecuperoMandato(userId, ora = Date.now()) {
    sfoltisci(linkRecupero, v => v.at(-1) || 0, (v, t) => !v.some(e => t - e < FINESTRA_LINK_MS), ora);
    linkRecupero.set(userId, [...(linkRecupero.get(userId) || []).filter(t => ora - t < FINESTRA_LINK_MS), ora]);
}

export function _azzeraTentativi() {
    perRete.clear();
    perAccount.clear();
    codiciSbagliati.clear();
    linkRecupero.clear();
    retiFidate.clear();
    inCorso.clear();
}
