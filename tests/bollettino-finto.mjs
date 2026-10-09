// Un archivio del bollettino di criticità come quello del Dipartimento
// (latest_all.zip), con le zone del Veneto e i livelli scelti: per le prove
// e per il server dimostrativo, senza uscire su internet.
//
//   node tests/bollettino-finto.mjs 3099
// serve http://127.0.0.1:3099/latest_all.zip con le allerte di esempio, da
// dare al server con ORION_ALLERTA_URL. POST /pubblica { livelli, tipo }
// pubblica una versione nuova.

import fs from 'fs';
import http from 'http';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZONE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'dati', 'zone-allerta', 'veneto.json'), 'utf8')).zone;

const TESTI = {
    verde: 'Assenza di fenomeni significativi prevedibili / NESSUNA ALLERTA',
    gialla: 'Ordinaria / ALLERTA GIALLA',
    arancione: 'Moderata / ALLERTA ARANCIONE',
    rossa: 'Elevata / ALLERTA ROSSA'
};

function dbf(righe) {
    const campi = [['Zona_all', 80], ['Nome_zona', 146], ['Criticita', 80], ['Idrogeo', 80], ['Temporali', 80], ['Idraulico', 80]];
    const lunghezza = 1 + campi.reduce((n, [, l]) => n + l, 0);
    const testa = 32 + campi.length * 32 + 1;
    const b = Buffer.alloc(testa + righe.length * lunghezza + 1, 0x20);
    b.fill(0, 0, testa);
    b[0] = 3;
    b.writeUInt32LE(righe.length, 4);
    b.writeUInt16LE(testa, 8);
    b.writeUInt16LE(lunghezza, 10);
    campi.forEach(([nome, l], i) => {
        b.write(nome, 32 + i * 32, 'latin1');
        b[32 + i * 32 + 11] = 0x43;
        b[32 + i * 32 + 16] = l;
    });
    b[testa - 1] = 0x0d;
    righe.forEach((r, i) => {
        let p = testa + i * lunghezza + 1;
        for (const [nome, l] of campi) {
            b.write(String(r[nome] || '').slice(0, l), p, 'latin1');
            p += l;
        }
    });
    b[b.length - 1] = 0x1a;
    return b;
}

function zip(file) {
    const locali = [], centrali = [];
    let posizione = 0;
    for (const [nome, dati] of Object.entries(file)) {
        const compressi = zlib.deflateRawSync(dati);
        const n = Buffer.from(nome, 'utf8');
        const crc = zlib.crc32(dati);
        const locale = Buffer.alloc(30);
        locale.writeUInt32LE(0x04034b50, 0); locale.writeUInt16LE(20, 4); locale.writeUInt16LE(8, 8);
        locale.writeUInt32LE(crc, 14); locale.writeUInt32LE(compressi.length, 18); locale.writeUInt32LE(dati.length, 22);
        locale.writeUInt16LE(n.length, 26);
        const centrale = Buffer.alloc(46);
        centrale.writeUInt32LE(0x02014b50, 0); centrale.writeUInt16LE(20, 4); centrale.writeUInt16LE(20, 6); centrale.writeUInt16LE(8, 10);
        centrale.writeUInt32LE(crc, 16); centrale.writeUInt32LE(compressi.length, 20); centrale.writeUInt32LE(dati.length, 24);
        centrale.writeUInt16LE(n.length, 28); centrale.writeUInt32LE(posizione, 42);
        locali.push(locale, n, compressi);
        centrali.push(centrale, n);
        posizione += 30 + n.length + compressi.length;
    }
    const dimensione = centrali.reduce((t, b) => t + b.length, 0);
    const fine = Buffer.alloc(22);
    fine.writeUInt32LE(0x06054b50, 0);
    fine.writeUInt16LE(Object.keys(file).length, 8); fine.writeUInt16LE(Object.keys(file).length, 10);
    fine.writeUInt32LE(dimensione, 12); fine.writeUInt32LE(posizione, 16);
    return Buffer.concat([...locali, ...centrali, fine]);
}

// Un PDF di una pagina, valido, con una riga di testo.
function pdf(testo) {
    const flusso = `BT /F1 14 Tf 60 780 Td (${testo.replace(/[()\\]/g, '')}) Tj ET`;
    const oggetti = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${flusso.length} >>\nstream\n${flusso}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    let corpo = '%PDF-1.4\n';
    const posizioni = [];
    oggetti.forEach((o, i) => { posizioni.push(corpo.length); corpo += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = corpo.length;
    corpo += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n${posizioni.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
    corpo += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(corpo, 'latin1');
}

const giorno = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * livelli: { oggi: { 'Vene-E1': { idrogeologico, idraulico, temporali } }, domani: {...} };
 * le zone non citate sono verdi. tipo: first o update.
 */
export function creaBollettino({ data = new Date(), ora = '14:10', tipo = 'first', livelli = {} } = {}) {
    const g = giorno(data).replace(/-/g, '');
    const chiave = `${g}_${ora.replace(':', '')}`;
    const righe = (quando) => ZONE.map(z => {
        const l = livelli[quando]?.[z.codice] || {};
        const idrogeo = l.idrogeologico || 'verde', idraulico = l.idraulico || 'verde', temporali = l.temporali || 'verde';
        return { Zona_all: z.codice, Nome_zona: z.nome, Criticita: TESTI.verde, Idrogeo: TESTI[idrogeo], Temporali: TESTI[temporali], Idraulico: TESTI[idraulico] };
    });
    const [a, m, d] = [g.slice(0, 4), g.slice(4, 6), g.slice(6, 8)];
    return {
        chiave,
        zip: zip({
            [`${chiave}_today.dbf`]: dbf(righe('oggi')),
            [`${chiave}_tomorrow.dbf`]: dbf(righe('domani')),
            [`Cap_${chiave}.xml`]: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><sent>${a}-${m}-${d}T${ora}:00+02:00</sent></alert>`),
            [`cf_centrale_${g}_${tipo}_1.pdf`]: pdf(`Bollettino di criticita di prova del ${d}/${m}/${a} ore ${ora}`),
            'README.txt': Buffer.from('Bollettino di prova.')
        })
    };
}

export const ESEMPIO = {
    oggi: { 'Vene-E1': { idraulico: 'gialla' }, 'Vene-E3': { idraulico: 'gialla', idrogeologico: 'gialla' } },
    domani: { 'Vene-E1': { idrogeologico: 'arancione', idraulico: 'gialla' } }
};

/** Un server che pubblica l'archivio, con l'ETag come quello vero. */
export function servi(porta, iniziale = creaBollettino({ livelli: ESEMPIO })) {
    let attuale = iniziale;
    let versione = 1;
    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/pubblica') {
            let corpo = '';
            req.on('data', c => { corpo += c; });
            req.on('end', () => {
                const opzioni = corpo ? JSON.parse(corpo) : {};
                attuale = creaBollettino(opzioni);
                versione++;
                res.end(JSON.stringify({ chiave: attuale.chiave }));
            });
            return;
        }
        if (req.url !== '/latest_all.zip') { res.statusCode = 404; return res.end(); }
        const etag = `"prova-${versione}"`;
        if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
        res.setHeader('ETag', etag);
        res.setHeader('Content-Type', 'application/zip');
        res.end(attuale.zip);
    });
    return new Promise(r => server.listen(porta, '127.0.0.1', () => r({
        server,
        pubblica: (opzioni) => { attuale = creaBollettino(opzioni); versione++; return attuale.chiave; }
    })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const porta = Number(process.argv[2] || 3099);
    await servi(porta);
    console.log(`Bollettino di prova su http://127.0.0.1:${porta}/latest_all.zip`);
}
