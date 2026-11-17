// I documenti caricati nella sala tornano solo come immagine, PDF, testo o allegato, qualunque nome abbiano.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/documenti-sala.mjs
// Va lanciata sulla macchina del server: mette un file a mano nella cartella dei dati (ORION_DATI_DIR).

import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { accediConFetch } from './accesso-prova.mjs';
import { RADICE_DATI } from '../src/percorsi.js';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};

console.log('\nDocumenti della sala');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const autorizza = { Authorization: `Bearer ${admin}` };
const json = async (percorso, opzioni = {}) => {
    const r = await fetch(BASE + percorso, { ...opzioni, headers: { ...autorizza, ...(opzioni.body ? { 'Content-Type': 'application/json' } : {}) } });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const carica = async (nome, contenuto, tipo = 'application/pdf') => {
    const modulo = new FormData();
    modulo.append('emergencyDocument', new Blob([contenuto], { type: tipo }), nome);
    const r = await fetch(`${BASE}/api/emergencies/documents`, { method: 'POST', headers: autorizza, body: modulo });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const scarica = async (percorso) => {
    const r = await fetch(BASE + percorso, { headers: autorizza });
    await r.arrayBuffer();
    return { stato: r.status, tipo: r.headers.get('content-type'), disposizione: r.headers.get('content-disposition') || '', csp: r.headers.get('content-security-policy') || '' };
};

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
// Un'intestazione ID3 davanti a %PDF: il riconoscimento del contenuto lo prende per un PDF.
const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const POLIGLOTTA = Buffer.concat([id3, Buffer.from('%PDF-1.4\n'), Buffer.from('alert(document.cookie)//\n')]);

let aperta = null;
const daTogliere = [];
try {
    if (!(await json('/api/emergencies/status')).corpo?.active) {
        const r = await json('/api/emergencies/open', { method: 'POST', body: JSON.stringify({ external_code: `DOC-${Date.now().toString().slice(-6)}` }) });
        verifica("si apre un'emergenza di prova", r.stato === 201, r.corpo);
        aperta = r.corpo?.emergency?.id ?? null;
    }
    const emergenza = (await json('/api/emergencies/status')).corpo?.emergency?.id ?? aperta;

    for (const nome of ['nota.ecma', 'piano.xht', 'piano.svgz', 'pagina.html', 'senza-estensione']) {
        const r = await carica(nome, POLIGLOTTA);
        verifica(`${nome} con contenuto da PDF viene rifiutato -> 400`, r.stato === 400, `HTTP ${r.stato} ${JSON.stringify(r.corpo)}`);
    }
    const finto = await carica('relazione.pdf', Buffer.from('<html><script>alert(1)</script></html>'));
    verifica('un .pdf che non è un PDF viene rifiutato -> 400', finto.stato === 400, `HTTP ${finto.stato}`);
    const testoComeWord = await carica('verbale.docx', Buffer.from('solo testo'));
    verifica('un .docx che è solo testo viene rifiutato -> 400', testoComeWord.stato === 400, `HTTP ${testoComeWord.stato}`);

    const pdf = await carica('Piano Neve.PDF', PDF, 'application/octet-stream');
    verifica('un PDF vero si carica, anche con il tipo sbagliato dal browser', pdf.stato === 201, pdf.corpo);
    const percorsoPdf = pdf.corpo?.document?.file_path || '';
    verifica("e si salva con l'estensione in minuscolo", percorsoPdf.endsWith('.pdf'), percorsoPdf);
    const datiPdf = await scarica(percorsoPdf);
    verifica('torna come application/pdf, con la politica dei contenuti chiusa',
        datiPdf.stato === 200 && datiPdf.tipo === 'application/pdf' && /sandbox/.test(datiPdf.csp) && /default-src 'none'/.test(datiPdf.csp), datiPdf);

    const txt = await carica('appunti.txt', Buffer.from('Squadra Alfa in via Roma alle 14.'), 'text/plain');
    verifica('un .txt si carica', txt.stato === 201, txt.corpo);
    const datiTxt = await scarica(txt.corpo?.document?.file_path || '');
    verifica('e torna come testo semplice', datiTxt.tipo === 'text/plain; charset=utf-8', datiTxt);

    const nomeVecchio = `${crypto.randomBytes(16).toString('hex')}.html`;
    const cartella = path.join(RADICE_DATI, 'protected_uploads', 'documents');
    fs.mkdirSync(cartella, { recursive: true });
    fs.writeFileSync(path.join(cartella, nomeVecchio), '<html><script>alert(1)</script></html>');
    daTogliere.push(path.join(cartella, nomeVecchio));
    await pool.query(
        `INSERT INTO emergency_documents (emergency_id, uploader_user_id, file_path, original_filename, file_mime_type)
         VALUES ($1, (SELECT id FROM users WHERE username = $2), $3, 'vecchio.html', 'text/html')`,
        [emergenza, process.env.ORION_ADMIN_USER || 'admin', `/uploads/documents/${nomeVecchio}`]);
    const vecchio = await scarica(`/uploads/documents/${nomeVecchio}`);
    verifica('un .html caricato prima della correzione torna come allegato da scaricare',
        vecchio.stato === 200 && vecchio.tipo === 'application/octet-stream' && /^attachment/.test(vecchio.disposizione), vecchio);
} finally {
    if (aperta) await json('/api/emergencies/close', { method: 'POST', body: JSON.stringify({}) });
    for (const f of daTogliere) fs.rmSync(f, { force: true });
    await pool.end();
}

console.log(falliti === 0 ? '\nDocumenti della sala: tutto a posto\n' : `\nDocumenti della sala: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
