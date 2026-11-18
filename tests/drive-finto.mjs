// Un Google finto per le prove della copia su Drive: il consenso OAuth con PKCE, i token, la revoca e le
// poche chiamate di Drive che usa ORION, compreso il caricamento a riprese. Con interrompi(n) i prossimi
// n caricamenti perdono la connessione a metà, con pieno(true) lo spazio è finito.
//
//   node tests/drive-finto.mjs 3095
// e il server con ORION_DRIVE_AUTH_URL=http://127.0.0.1:3095/o/oauth2/v2/auth
// ORION_DRIVE_TOKEN_URL=http://127.0.0.1:3095/token ORION_DRIVE_REVOKE_URL=http://127.0.0.1:3095/revoke
// ORION_DRIVE_URL=http://127.0.0.1:3095

import crypto from 'crypto';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

export const ACCOUNT = 'associazione.prova@gmail.com';

export function servi(porta, { clientId, segreto } = {}) {
    const client = { id: clientId, segreto };
    const codici = new Map(); // code -> { challenge, redirect }
    const rinnovi = new Map(); // refresh -> attivo
    const accessi = new Map(); // access -> refresh
    const file = new Map(); // id -> { id, name, mimeType, parents, appProperties, createdTime, trashed, contenuto }
    const sessioni = new Map(); // upload_id -> { metadati, totale, ricevuti: Buffer[] }
    const revocati = [];
    let daInterrompere = 0, spazioFinito = false, contatore = 0;
    const nuovoId = () => `f${++contatore}${crypto.randomBytes(4).toString('hex')}`;

    const server = http.createServer((req, res) => {
        const pezzi = [];
        req.on('data', c => pezzi.push(c));
        req.on('end', () => {
            const corpo = Buffer.concat(pezzi);
            const url = new URL(req.url, `http://127.0.0.1:${porta}`);
            const json = (stato, o, intestazioni = {}) => { res.writeHead(stato, { 'Content-Type': 'application/json', ...intestazioni }); res.end(o === undefined ? '' : JSON.stringify(o)); };
            const modulo = () => new URLSearchParams(corpo.toString());

            if (req.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') {
                const p = url.searchParams;
                if (p.get('client_id') !== client.id || p.get('scope') !== 'https://www.googleapis.com/auth/drive.file'
                    || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge') || p.get('access_type') !== 'offline' || !p.get('state')) {
                    return json(400, { error: 'invalid_request' });
                }
                const code = `4/finto-${crypto.randomBytes(8).toString('hex')}`;
                codici.set(code, { challenge: p.get('code_challenge'), redirect: p.get('redirect_uri') });
                const ritorno = new URL(p.get('redirect_uri'));
                ritorno.searchParams.set('code', code);
                ritorno.searchParams.set('state', p.get('state'));
                res.writeHead(302, { Location: ritorno.toString() });
                return res.end();
            }
            if (req.method === 'POST' && url.pathname === '/token') {
                const p = modulo();
                if (p.get('client_id') !== client.id || p.get('client_secret') !== client.segreto) return json(401, { error: 'invalid_client' });
                let refresh;
                if (p.get('grant_type') === 'authorization_code') {
                    const atteso = codici.get(p.get('code'));
                    codici.delete(p.get('code'));
                    const verifica = crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url');
                    if (!atteso || atteso.redirect !== p.get('redirect_uri') || atteso.challenge !== verifica) return json(400, { error: 'invalid_grant' });
                    refresh = `1//finto-${crypto.randomBytes(8).toString('hex')}`;
                    rinnovi.set(refresh, true);
                } else if (p.get('grant_type') === 'refresh_token') {
                    refresh = p.get('refresh_token');
                    if (!rinnovi.get(refresh)) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
                } else {
                    return json(400, { error: 'unsupported_grant_type' });
                }
                const access = `ya29.finto-${crypto.randomBytes(8).toString('hex')}`;
                accessi.set(access, refresh);
                return json(200, { access_token: access, expires_in: 3599, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/drive.file', ...(p.get('grant_type') === 'authorization_code' ? { refresh_token: refresh } : {}) });
            }
            if (req.method === 'POST' && url.pathname === '/revoke') {
                const token = modulo().get('token');
                revocati.push(token);
                rinnovi.set(token, false);
                return json(200, {});
            }

            const refresh = accessi.get((req.headers.authorization || '').replace(/^Bearer /, ''));
            if (!url.pathname.startsWith('/upload/drive/v3/files') || !url.searchParams.has('upload_id')) {
                if (!refresh || !rinnovi.get(refresh)) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
            }

            if (req.method === 'GET' && url.pathname === '/drive/v3/about') {
                const usato = [...file.values()].reduce((t, f) => t + f.contenuto.length, 0);
                return json(200, { user: { emailAddress: ACCOUNT }, storageQuota: { limit: String(15 * 1024 ** 3), usage: String(usato) } });
            }
            if (req.method === 'POST' && url.pathname === '/drive/v3/files') {
                const m = JSON.parse(corpo.toString() || '{}');
                const id = nuovoId();
                file.set(id, { id, ...m, createdTime: new Date().toISOString(), trashed: false, contenuto: Buffer.alloc(0) });
                return json(200, { id });
            }
            if (req.method === 'GET' && url.pathname === '/drive/v3/files') {
                const genitore = /'([^']+)' in parents/.exec(url.searchParams.get('q') || '')?.[1];
                const elenco = [...file.values()].filter(f => !f.trashed && (!genitore || f.parents?.includes(genitore)))
                    .map(({ id, name, createdTime, appProperties, contenuto }) => ({ id, name, createdTime, appProperties, size: String(contenuto.length) }));
                return json(200, { files: elenco });
            }
            const unFile = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
            if (unFile) {
                const f = file.get(decodeURIComponent(unFile[1]));
                if (!f) return json(404, { error: { code: 404, message: 'File not found.' } });
                if (req.method === 'GET') return json(200, { id: f.id, trashed: f.trashed });
                if (req.method === 'DELETE') { file.delete(f.id); return json(204); }
            }
            if (req.method === 'POST' && url.pathname === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'resumable') {
                if (spazioFinito) return json(403, { error: { code: 403, errors: [{ reason: 'storageQuotaExceeded' }], message: 'The user\'s Drive storage quota has been exceeded.' } });
                const id = crypto.randomBytes(8).toString('hex');
                const totale = req.headers['x-upload-content-length'];
                sessioni.set(id, { metadati: JSON.parse(corpo.toString() || '{}'), totale: totale ? Number(totale) : null, ricevuti: Buffer.alloc(0), interrompi: daInterrompere > 0 });
                if (daInterrompere > 0) daInterrompere--;
                return json(200, {}, { Location: `http://127.0.0.1:${porta}/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` });
            }
            if (req.method === 'PUT' && url.pathname === '/upload/drive/v3/files') {
                const s = sessioni.get(url.searchParams.get('upload_id'));
                if (!s) return json(404, {});
                const m = /^bytes (?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(req.headers['content-range'] || '');
                if (!m) return json(400, {});
                if (m[3] !== '*') s.totale = Number(m[3]);
                if (m[1] !== undefined) {
                    if (Number(m[1]) !== s.ricevuti.length) return json(400, { error: 'pezzo fuori posto' });
                    if (s.interrompi && corpo.length > 1) {
                        s.interrompi = false;
                        s.ricevuti = Buffer.concat([s.ricevuti, corpo.subarray(0, Math.floor(corpo.length / 2))]);
                        return req.socket.destroy();
                    }
                    s.ricevuti = Buffer.concat([s.ricevuti, corpo]);
                }
                if (s.totale !== null && s.ricevuti.length >= s.totale) {
                    const id = nuovoId();
                    file.set(id, { id, ...s.metadati, createdTime: new Date().toISOString(), trashed: false, contenuto: s.ricevuti });
                    sessioni.delete(url.searchParams.get('upload_id'));
                    return json(200, { id, size: String(s.ricevuti.length) });
                }
                res.writeHead(308, s.ricevuti.length ? { Range: `bytes=0-${s.ricevuti.length - 1}` } : {});
                return res.end();
            }
            json(404, { error: { code: 404, message: 'Not found' } });
        });
    });
    return new Promise(r => server.listen(porta, '127.0.0.1', () => r({
        server, file, revocati,
        cliente: (id, s) => { client.id = id; client.segreto = s; },
        interrompi: (n) => { daInterrompere = n; },
        pieno: (si) => { spazioFinito = si; },
        revocaTutto: () => { for (const k of rinnovi.keys()) rinnovi.set(k, false); },
        aggiungi: (f) => { const id = nuovoId(); file.set(id, { id, trashed: false, contenuto: Buffer.alloc(0), createdTime: new Date().toISOString(), ...f }); return id; }
    })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const porta = Number(process.argv[2] || 3095);
    await servi(porta, { clientId: process.env.CLIENT_ID || '123-prova.apps.googleusercontent.com', segreto: process.env.CLIENT_SECRET || 'GOCSPX-segreto-di-prova' });
    console.log(`Google Drive finto su http://127.0.0.1:${porta}`);
}
