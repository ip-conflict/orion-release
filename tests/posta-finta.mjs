// Un server di posta finto che accetta tutto, non offre STARTTLS e salva ogni messaggio come file.
//   node tests/posta-finta.mjs [porta] [cartella]      (di serie 2525 e una cartella temporanea)
// Importato, avviaPostaFinta(porta, cartella, { ritardoMs }) lo avvia e restituisce { chiudi, messaggi };
// ritardoMs fa aspettare la conferma di ogni messaggio, come un server di posta lento.

import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export function avviaPostaFinta(porta = 2525, cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-posta-')), { ritardoMs = 0 } = {}) {
    fs.mkdirSync(cartella, { recursive: true });
    let numero = 0;
    const server = net.createServer((socket) => {
        let resto = '';
        let inDati = false;
        let corpo = [];
        let passiLogin = 0;
        const scrivi = (riga) => socket.write(`${riga}\r\n`);
        scrivi('220 posta-finta ESMTP');
        socket.on('data', (pezzo) => {
            resto += pezzo.toString('utf8');
            let fine;
            while ((fine = resto.indexOf('\r\n')) >= 0) {
                const riga = resto.slice(0, fine);
                resto = resto.slice(fine + 2);
                if (inDati) {
                    if (riga === '.') {
                        inDati = false;
                        fs.writeFileSync(path.join(cartella, `${Date.now()}-${++numero}.eml`), corpo.join('\n'));
                        corpo = [];
                        setTimeout(() => scrivi('250 messaggio salvato'), ritardoMs);
                    } else corpo.push(riga.startsWith('..') ? riga.slice(1) : riga);
                    continue;
                }
                if (passiLogin > 0) {
                    passiLogin--;
                    scrivi(passiLogin ? '334 UGFzc3dvcmQ6' : '235 accesso riuscito');
                    continue;
                }
                const comando = riga.split(' ')[0].toUpperCase();
                if (comando === 'EHLO') { scrivi('250-posta-finta'); scrivi('250-AUTH PLAIN LOGIN'); scrivi('250 8BITMIME'); }
                else if (comando === 'HELO') scrivi('250 posta-finta');
                else if (comando === 'STARTTLS') scrivi('502 cifratura non disponibile');
                else if (comando === 'AUTH') {
                    if (/^AUTH LOGIN$/i.test(riga)) { passiLogin = 2; scrivi('334 VXNlcm5hbWU6'); }
                    else scrivi('235 accesso riuscito');
                } else if (comando === 'DATA') { inDati = true; scrivi('354 scrivi pure'); }
                else if (comando === 'QUIT') { scrivi('221 ciao'); socket.end(); }
                else scrivi('250 va bene');
            }
        });
        socket.on('error', () => {});
    });
    server.listen(porta, '0.0.0.0');
    return {
        cartella,
        pronto: new Promise(r => server.once('listening', r)),
        chiudi: () => new Promise(r => server.close(r)),
        messaggi: () => fs.readdirSync(cartella).sort().map(f => fs.readFileSync(path.join(cartella, f), 'utf8'))
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const finta = avviaPostaFinta(Number(process.argv[2]) || 2525, process.argv[3]);
    await finta.pronto;
    console.log(`Posta finta in ascolto; i messaggi vanno in ${finta.cartella}`);
}
