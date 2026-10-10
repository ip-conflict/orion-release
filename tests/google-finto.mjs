// Un Google finto per le prove di Firebase, senza uscire su internet: rilascia
// il token di accesso solo a una chiave di cui conosce la parte pubblica
// (verifica la firma, come Google) e raccoglie i messaggi mandati a FCM.
// Gli identificativi che cominciano con "morto" rispondono UNREGISTERED,
// come un telefono che ha disinstallato l'app.
//
//   node tests/google-finto.mjs 3098
// e il server con ORION_GOOGLE_TOKEN_URL=http://127.0.0.1:3098/token
// ORION_FCM_URL=http://127.0.0.1:3098

import crypto from 'crypto';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

/** Una chiave di account di servizio finta, come la scarica Firebase. */
export function creaAccount(progetto, email = `orion@${progetto}.iam.gserviceaccount.com`) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
        account: {
            type: 'service_account', project_id: progetto, private_key_id: crypto.randomBytes(20).toString('hex'),
            private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: email,
            client_id: '1234567890', token_uri: 'https://oauth2.googleapis.com/token'
        },
        pubblica: publicKey
    };
}

/** google-services.json di un progetto con l'app ORION (o un'altra). */
export function creaGoogleServices(progetto, { pacchetto = 'it.orion.app', numero = '987654321012' } = {}) {
    return {
        project_info: { project_number: numero, project_id: progetto, storage_bucket: `${progetto}.appspot.com` },
        client: [{
            client_info: { mobilesdk_app_id: `1:${numero}:android:0a1b2c3d4e5f6a7b`, android_client_info: { package_name: pacchetto } },
            oauth_client: [], api_key: [{ current_key: 'AIzaSyFintaChiaveDiProva0123456789abc' }]
        }],
        configuration_version: '1'
    };
}

export function servi(porta) {
    const chiavi = new Map(); // email -> chiave pubblica
    const messaggi = [];
    const tokenValidi = new Set();
    const server = http.createServer((req, res) => {
        let corpo = '';
        req.on('data', c => { corpo += c; });
        req.on('end', () => {
            const rispondi = (stato, o) => { res.writeHead(stato, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
            if (req.method === 'POST' && req.url === '/token') {
                const assertion = new URLSearchParams(corpo).get('assertion') || '';
                const [testa, dati, firma] = assertion.split('.');
                try {
                    const claims = JSON.parse(Buffer.from(dati, 'base64url').toString());
                    const pubblica = chiavi.get(claims.iss);
                    const buona = pubblica && crypto.verify('RSA-SHA256', Buffer.from(`${testa}.${dati}`), pubblica, Buffer.from(firma, 'base64url'));
                    if (!buona || claims.scope !== 'https://www.googleapis.com/auth/firebase.messaging' || claims.exp <= Date.now() / 1000) {
                        return rispondi(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
                    }
                    const token = `ya29.finto-${crypto.randomBytes(8).toString('hex')}`;
                    tokenValidi.add(token);
                    return rispondi(200, { access_token: token, expires_in: 3599, token_type: 'Bearer' });
                } catch {
                    return rispondi(400, { error: 'invalid_request' });
                }
            }
            const m = req.url.match(/^\/v1\/projects\/([^/]+)\/messages:send$/);
            if (req.method === 'POST' && m) {
                const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
                if (!tokenValidi.has(bearer)) return rispondi(401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
                const messaggio = JSON.parse(corpo).message;
                messaggi.push({ progetto: m[1], ...messaggio });
                if (String(messaggio.token).startsWith('morto')) {
                    return rispondi(404, { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } });
                }
                return rispondi(200, { name: `projects/${m[1]}/messages/${messaggi.length}` });
            }
            rispondi(404, {});
        });
    });
    return new Promise(r => server.listen(porta, '127.0.0.1', () => r({
        server, messaggi,
        conosci: (email, pubblica) => chiavi.set(email, pubblica)
    })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const porta = Number(process.argv[2] || 3098);
    await servi(porta);
    console.log(`Google finto su http://127.0.0.1:${porta}`);
}
