// Pausa per account dopo troppi errori: ferma chi prova le password di una persona
// da molti indirizzi. Breve apposta, per non poter tenere fuori qualcuno a lungo.

const TENTATIVI_LIBERI = 5;
const PAUSA_INIZIALE_MS = 60 * 1000;
const PAUSA_MASSIMA_MS = 15 * 60 * 1000;
const DIMENTICA_DOPO_MS = 60 * 60 * 1000;
const VOCI_MASSIME = 20000;

const registro = new Map(); // nome -> { errori, ultimo, fermoFino }

const chiave = (nome) => String(nome || '').trim().toLowerCase().slice(0, 200);

function pulisci(ora) {
    if (registro.size < VOCI_MASSIME) return;
    for (const [k, v] of registro) {
        if (ora - v.ultimo > DIMENTICA_DOPO_MS && v.fermoFino < ora) registro.delete(k);
    }
    // Ancora troppe (un attacco con nomi sempre diversi): via le più vecchie.
    if (registro.size >= VOCI_MASSIME) {
        const vecchie = [...registro.entries()].sort((a, b) => a[1].ultimo - b[1].ultimo).slice(0, registro.size - VOCI_MASSIME / 2);
        vecchie.forEach(([k]) => registro.delete(k));
    }
}

export function attesaPerAccount(nome, ora = Date.now()) {
    const voce = registro.get(chiave(nome));
    if (!voce || voce.fermoFino <= ora) return 0;
    return Math.ceil((voce.fermoFino - ora) / 1000);
}

export function erroreAccesso(nome, ora = Date.now()) {
    const k = chiave(nome);
    if (!k) return 0;
    pulisci(ora);
    let voce = registro.get(k);
    if (!voce || ora - voce.ultimo > DIMENTICA_DOPO_MS) voce = { errori: 0, ultimo: ora, fermoFino: 0 };
    voce.errori++;
    voce.ultimo = ora;
    if (voce.errori >= TENTATIVI_LIBERI) {
        const pausa = Math.min(PAUSA_MASSIMA_MS, PAUSA_INIZIALE_MS * 2 ** (voce.errori - TENTATIVI_LIBERI));
        voce.fermoFino = ora + pausa;
    }
    registro.set(k, voce);
    return voce.fermoFino > ora ? Math.ceil((voce.fermoFino - ora) / 1000) : 0;
}

export function accessoRiuscito(nome) {
    registro.delete(chiave(nome));
}

export function messaggioAttesa(secondi) {
    const minuti = Math.ceil(secondi / 60);
    return `Troppi tentativi sbagliati per questo account: riprova fra ${minuti === 1 ? 'un minuto' : `${minuti} minuti`}.`;
}

export function _azzeraTentativi() {
    registro.clear();
}
