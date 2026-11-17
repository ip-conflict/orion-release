// Un MediaMTX finto per le prove del drone: l'API delle dirette e delle connessioni, il WHEP e la
// domanda di autorizzazione a ORION che MediaMTX fa a ogni pilota e a ogni spettatore.
//   import { avviaMediaMtxFinto } from './mediamtx-finto.mjs'   (porta 3096, come in batteria.mjs)

import http from 'http';

export function avviaMediaMtxFinto({ porta = 3096, orion, segreto }) {
    const dirette = new Map();
    const richieste = [];
    const sessioni = new Set();

    // Come MediaMTX: chiede a ORION prima di accettare chi trasmette o chi guarda.
    async function autorizza(corpo) {
        const r = await fetch(`${orion}/api/drone/autorizza?s=${encodeURIComponent(segreto)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
        });
        return r.status;
    }

    const server = http.createServer(async (req, res) => {
        let corpo = '';
        for await (const pezzo of req) corpo += pezzo;
        richieste.push({ metodo: req.method, url: req.url, autorizzazione: req.headers.authorization || null, corpo });
        const url = new URL(req.url, 'http://x');
        if (req.method === 'GET' && url.pathname === '/v3/paths/list') {
            const items = [...dirette.entries()].map(([name, d]) => ({ name, ready: true, readyTime: d.da, bytesReceived: 1000 }));
            return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ itemCount: items.length, items }));
        }
        if (req.method === 'GET' && url.pathname === '/v3/rtmpconns/list') {
            const items = [...dirette.keys()].map((path, i) => ({ id: `conn-${i}-${path.length}`, path, state: 'publish' }));
            return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ itemCount: items.length, items }));
        }
        const kick = /^\/v3\/rtmpconns\/kick\/(.+)$/.exec(url.pathname);
        if (req.method === 'POST' && kick) {
            const idx = Number(kick[1].split('-')[1]);
            const path = [...dirette.keys()][idx];
            if (path) dirette.delete(path);
            return res.writeHead(200).end();
        }
        const whep = /^\/(drone\/[^/]+)\/whep$/.exec(url.pathname);
        if (req.method === 'POST' && whep) {
            const [utente, password] = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':');
            const stato = await autorizza({ action: 'read', path: whep[1], protocol: 'webrtc', user: utente || '', password: password || '', ip: '172.20.0.3' });
            if (stato !== 200) return res.writeHead(401).end();
            if (!dirette.has(whep[1])) return res.writeHead(404).end();
            const id = `s${sessioni.size + 1}`;
            sessioni.add(id);
            return res.writeHead(201, { 'Content-Type': 'application/sdp', Location: `/${whep[1]}/whep/${id}` })
                .end('v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n');
        }
        const sessione = /^\/drone\/[^/]+\/whep\/(.+)$/.exec(url.pathname);
        if (sessione && ['DELETE', 'PATCH'].includes(req.method)) {
            if (req.method === 'DELETE') sessioni.delete(sessione[1]);
            return res.writeHead(sessioni.has(sessione[1]) || req.method === 'DELETE' ? 200 : 404).end();
        }
        res.writeHead(404).end();
    });

    return new Promise(pronto => server.listen(porta, '127.0.0.1', () => pronto({
        richieste, sessioni,
        // Un pilota che si collega con l'indirizzo del QR: MediaMTX chiede, e se ORION dice sì la diretta parte.
        async trasmetti(percorso, { protocollo = 'rtmp' } = {}) {
            const stato = await autorizza({ action: 'publish', path: percorso, protocol: protocollo, user: '', password: '', ip: '203.0.113.7', query: '' });
            if (stato === 200) dirette.set(percorso, { da: new Date().toISOString() });
            return stato;
        },
        smetti(percorso) { dirette.delete(percorso); },
        inOnda(percorso) { return dirette.has(percorso); },
        chiudi() { return new Promise(fatto => server.close(fatto)); }
    })));
}
