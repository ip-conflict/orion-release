// src/modelloTesserino.js
//
// Il controllo del modello del tesserino scelto dall'amministratore (la chiave
// badge_modello delle impostazioni), prima di salvarlo. Il disegno vero sta in
// public/js/tesserino.js, che rilegge il modello con le stesse regole: qui si
// tiene solo quello che ha forma e misure sensate, così una pagina che lo legge
// non trova mai valori assurdi. Gli elenchi delle chiavi vanno tenuti uguali.

const COLORI = ['sfondo', 'fascia_alta', 'fascia_ente', 'fascia_qualifica', 'nome', 'distretto', 'titolo', 'ente', 'qualifica'];
const TESTI = ['titolo', 'qualifica'];
const ELEMENTI = ['fascia_alta', 'fascia_ente', 'fascia_qualifica', 'foto', 'qr', 'titolo', 'loghi', 'codice',
    'nome', 'distretto', 'ente', 'qualifica', 'bandiera_it', 'bandiera_ue'];
const NASCONDIBILI = ['fascia_alta', 'fascia_ente', 'fascia_qualifica', 'titolo', 'loghi', 'distretto', 'ente', 'qualifica', 'bandiera_it', 'bandiera_ue'];
// Il tesserino è 243x153 punti; un po' di margine per gli arrotondamenti.
const LATO_MASSIMO = 260;
const LUNGHEZZA_MASSIMA = 8000;

export class ModelloNonValido extends Error {}

// Vuoto: si torna al tesserino predefinito. Altrimenti il modello ripulito,
// come testo JSON da salvare.
export function validaModelloTesserino(valore) {
    const testo = String(valore ?? '').trim();
    if (!testo) return '';
    if (testo.length > LUNGHEZZA_MASSIMA) throw new ModelloNonValido('Il modello del tesserino è troppo grande.');
    let m;
    try { m = JSON.parse(testo); } catch { throw new ModelloNonValido('Il modello del tesserino non è leggibile.'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ModelloNonValido('Il modello del tesserino non è leggibile.');

    const colori = {};
    for (const k of COLORI) {
        const c = m.colori?.[k];
        if (c === undefined) continue;
        if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) throw new ModelloNonValido(`Colore non valido: ${k}.`);
        colori[k] = c.toLowerCase();
    }
    const testi = {};
    for (const k of TESTI) {
        const t = m.testi?.[k];
        if (t === undefined) continue;
        if (typeof t !== 'string' || !t.trim() || t.length > 40) throw new ModelloNonValido(`Testo non valido: ${k} (da 1 a 40 caratteri).`);
        testi[k] = t.trim();
    }
    let posizioni = null;
    if (m.posizioni != null) {
        if (typeof m.posizioni !== 'object' || Array.isArray(m.posizioni)) throw new ModelloNonValido('Posizioni non valide.');
        posizioni = {};
        for (const id of ELEMENTI) {
            const p = m.posizioni[id];
            if (p === undefined) continue;
            const numeri = [p?.x, p?.y, p?.w, p?.h];
            if (!numeri.every(Number.isFinite) || p.w <= 0 || p.h <= 0 || numeri.some(x => Math.abs(x) > LATO_MASSIMO)) {
                throw new ModelloNonValido(`Posizione non valida: ${id}.`);
            }
            posizioni[id] = Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, Math.round(p[k] * 100) / 100]));
        }
    }
    if (m.nascosti !== undefined && !Array.isArray(m.nascosti)) throw new ModelloNonValido('Elenco degli elementi nascosti non valido.');
    const nascosti = [...new Set((m.nascosti || []).filter(id => NASCONDIBILI.includes(id)))];
    return JSON.stringify({ colori, testi, posizioni, nascosti });
}
