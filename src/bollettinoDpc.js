// Il bollettino nazionale di criticità del DPC (CC-BY 4.0, github.com/pcm-dpc/
// DPC-Bollettini-Criticita-Idrogeologica-Idraulica). Zip e DBF si leggono qui, senza dipendenze.

import zlib from 'zlib';

export const LIVELLI = ['verde', 'gialla', 'arancione', 'rossa'];
export const RISCHI = ['idrogeologico', 'idraulico', 'temporali'];

// Solo "store" e "deflate".
export function leggiZip(dati) {
    let fine = -1;
    for (let i = dati.length - 22; i >= Math.max(0, dati.length - 65557); i--) {
        if (dati.readUInt32LE(i) === 0x06054b50) { fine = i; break; }
    }
    if (fine < 0) throw new Error('Archivio zip non leggibile.');
    const quanti = dati.readUInt16LE(fine + 10);
    let p = dati.readUInt32LE(fine + 16);
    const file = {};
    for (let n = 0; n < quanti; n++) {
        if (dati.readUInt32LE(p) !== 0x02014b50) throw new Error('Archivio zip non leggibile.');
        const metodo = dati.readUInt16LE(p + 10);
        const compresso = dati.readUInt32LE(p + 20);
        const lungNome = dati.readUInt16LE(p + 28);
        const lungExtra = dati.readUInt16LE(p + 30);
        const lungNota = dati.readUInt16LE(p + 32);
        const locale = dati.readUInt32LE(p + 42);
        const nome = dati.subarray(p + 46, p + 46 + lungNome).toString('utf8');
        p += 46 + lungNome + lungExtra + lungNota;
        if (nome.endsWith('/')) continue;
        const inizio = locale + 30 + dati.readUInt16LE(locale + 26) + dati.readUInt16LE(locale + 28);
        const contenuto = dati.subarray(inizio, inizio + compresso);
        if (metodo === 0) file[nome] = Buffer.from(contenuto);
        else if (metodo === 8) file[nome] = zlib.inflateRawSync(contenuto);
    }
    return file;
}

// Testi in latin1, come li scrive il Dipartimento.
export function leggiDbf(dati) {
    const righe = dati.readUInt32LE(4);
    const testa = dati.readUInt16LE(8);
    const lunghezza = dati.readUInt16LE(10);
    const campi = [];
    for (let p = 32; p < testa - 1 && dati[p] !== 0x0d; p += 32) {
        campi.push({ nome: dati.subarray(p, p + 11).toString('latin1').replace(/\0.*$/s, ''), lunghezza: dati[p + 16] });
    }
    const risultato = [];
    for (let i = 0; i < righe; i++) {
        const inizio = testa + i * lunghezza;
        if (dati[inizio] === 0x2a) continue; // riga cancellata
        let p = inizio + 1;
        const riga = {};
        for (const c of campi) {
            riga[c.nome] = dati.subarray(p, p + c.lunghezza).toString('latin1').trim();
            p += c.lunghezza;
        }
        risultato.push(riga);
    }
    return risultato;
}

export function livelloDa(testo) {
    const t = String(testo || '').toUpperCase();
    if (t.includes('ALLERTA ROSSA')) return 'rossa';
    if (t.includes('ALLERTA ARANCIONE')) return 'arancione';
    if (t.includes('ALLERTA GIALLA')) return 'gialla';
    if (t.includes('NESSUNA ALLERTA')) return 'verde';
    return null;
}

function livelliDelGiorno(dbf) {
    const zone = {};
    for (const r of leggiDbf(dbf)) {
        if (!r.Zona_all) continue;
        zone[r.Zona_all] = {
            nome: r.Nome_zona,
            idrogeologico: livelloDa(r.Idrogeo),
            idraulico: livelloDa(r.Idraulico),
            temporali: livelloDa(r.Temporali)
        };
    }
    return zone;
}

export function leggiBollettino(zip) {
    const file = leggiZip(zip);
    const nomi = Object.keys(file);
    const oggi = nomi.find(n => /^(\d{8}_\d{4})_today\.dbf$/.test(n));
    const domani = nomi.find(n => /_tomorrow\.dbf$/.test(n));
    if (!oggi || !domani) throw new Error("Nell'archivio del bollettino mancano le zone d'allerta.");
    const chiave = oggi.slice(0, 13);
    const pdfNome = nomi.find(n => /\.pdf$/i.test(n)) || null;
    const cap = nomi.find(n => /^Cap_.*\.xml$/i.test(n));
    const inviato = cap ? (file[cap].toString('utf8').match(/<sent>([^<]+)<\/sent>/) || [])[1] : null;
    const [, a, m, g, h, min] = chiave.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/);
    const tipo = (pdfNome?.match(/_\d{8}_([a-z]+)_/i) || [])[1]?.toLowerCase() || 'first';
    return {
        chiave,
        emesso: inviato ? new Date(inviato) : new Date(`${a}-${m}-${g}T${h}:${min}:00`),
        giorno: `${a}-${m}-${g}`,
        tipo,
        titolo: `Bollettino di criticità del ${g}/${m}/${a} ore ${h}:${min}${tipo === 'first' ? '' : ' (aggiornamento)'}`,
        pdfNome,
        pdf: pdfNome ? file[pdfNome] : null,
        oggi: livelliDelGiorno(file[oggi]),
        domani: livelliDelGiorno(file[domani])
    };
}

export function livelloMassimo(giorno) {
    if (!giorno) return null;
    const noti = RISCHI.map(r => giorno[r]).filter(Boolean);
    if (!noti.length) return null;
    return noti.reduce((a, b) => (LIVELLI.indexOf(b) > LIVELLI.indexOf(a) ? b : a));
}
