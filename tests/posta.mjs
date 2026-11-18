// La posta non esce mai in chiaro verso un server che non è sulla stessa macchina, e le email dei link arrivano giuste.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/posta.mjs
// Avvia tests/posta-finta.mjs sulla porta ORION_POSTA_PORTA (di serie 2527), sulla stessa macchina del server.
// Cambia le impostazioni della posta e le rimette; crea ed elimina un volontario.

import { avviaPostaFinta } from './posta-finta.mjs';
import { accediConFetch, PASSWORD_PROVA, PASSWORD_PROVA_NUOVA } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const PORTA = Number(process.env.ORION_POSTA_PORTA || 2527);
const attesa = ms => new Promise(r => setTimeout(r, ms));
let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
// Le righe lunghe arrivano in quoted-printable: "=" a fine riga le spezza, "=3D" è un "=".
const decodifica = (testo) => testo.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const linkNelMessaggio = (testo) => decodifica(testo).match(/https:\/\/\S+\/reset-password\.html\?token=([0-9a-f]+)&id=(\d+)/);

console.log('\nPosta');
const posta = avviaPostaFinta(PORTA, undefined, { ritardoMs: 1000 });
await posta.pronto;
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const prima = (await chiama('/api/branding/settings/full', { token: admin })).corpo || {};
const smtp = { smtp_port: String(PORTA), smtp_secure: 'false', smtp_user: 'orion@prova.example', smtp_pass: 'password-finta' };
let creato = null;
const nuovoMessaggio = async (giaVisti) => {
    for (let i = 0; i < 50; i++) {
        const tutti = posta.messaggi();
        if (tutti.length > giaVisti) return tutti[tutti.length - 1];
        await attesa(100);
    }
    return '';
};

try {
    const lontano = await chiama('/api/admin/email-prova', { method: 'POST', token: admin, body: { ...smtp, smtp_host: '127.0.0.2', a: 'prova@prova.example' } });
    verifica('verso un server che non offre la cifratura la prova viene rifiutata', lontano.stato === 422 && /non offre una connessione cifrata/.test(lontano.corpo?.message || ''), lontano.corpo);
    verifica('e niente arriva al server finto', posta.messaggi().length === 0, posta.messaggi().length);
    const vicino = await chiama('/api/admin/email-prova', { method: 'POST', token: admin, body: { ...smtp, smtp_host: '127.0.0.1', a: 'prova@prova.example' } });
    verifica('sulla stessa macchina parte', vicino.stato === 200 && posta.messaggi().length === 1, vicino.corpo);

    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { ...smtp, smtp_host: '127.0.0.1' } });
    let visti = posta.messaggi().length;
    const suffisso = Date.now().toString().slice(-6);
    creato = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: 'Paola', cognome: `Posta${suffisso}`, email: `paola.posta${suffisso}@prova.example`, role: 'volontario' } })).corpo;
    const attivazione = linkNelMessaggio(await nuovoMessaggio(visti));
    verifica("l'email di attivazione arriva con il link della persona", attivazione?.[2] === String(creato?.id), attivazione?.[0]);
    const attivato = await chiama('/api/auth/reset-password', { method: 'POST', body: { token: attivazione?.[1], id: Number(attivazione?.[2]), newPassword: PASSWORD_PROVA } });
    verifica('e il link attiva l\'account', attivato.stato === 200, attivato.corpo);

    visti = posta.messaggi().length;
    await chiama('/api/auth/forgot-password', { method: 'POST', body: { identificativo: creato.username } });
    const recupero = linkNelMessaggio(await nuovoMessaggio(visti));
    verifica("l'email di recupero arriva con un link valido", recupero?.[2] === String(creato.id), recupero?.[0]);

    visti = posta.messaggi().length;
    await chiama(`/api/admin/users/${creato.id}/reset-password`, { method: 'POST', token: admin, body: {} });
    const azzeramento = linkNelMessaggio(await nuovoMessaggio(visti));
    verifica("l'email dell'azzeramento chiesto dall'amministratore arriva", azzeramento?.[2] === String(creato.id), azzeramento?.[0]);
    const nuovaPassword = await chiama('/api/auth/reset-password', { method: 'POST', body: { token: azzeramento?.[1], id: Number(azzeramento?.[2]), newPassword: PASSWORD_PROVA_NUOVA } });
    verifica('e il suo link funziona', nuovaPassword.stato === 200, nuovaPassword.corpo);

    // Il server di posta finto impiega un secondo a confermare: il tempo di risposta non deve dire chi esiste.
    const tempo = async (identificativo) => {
        const inizio = performance.now();
        await chiama('/api/auth/forgot-password', { method: 'POST', body: { identificativo } });
        return performance.now() - inizio;
    };
    const mediana = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    const esistente = [], inesistente = [];
    for (let i = 0; i < 4; i++) {
        esistente.push(await tempo(creato.username));
        inesistente.push(await tempo(`nessuno${Date.now()}${i}`));
    }
    const scarto = Math.abs(mediana(esistente) - mediana(inesistente));
    verifica('il recupero risponde nello stesso tempo per chi esiste e chi no (scarto sotto i 50 ms)', scarto < 50,
        `${Math.round(mediana(esistente))} ms contro ${Math.round(mediana(inesistente))} ms`);
} finally {
    if (creato?.id) await chiama(`/api/users/${creato.id}`, { method: 'DELETE', token: admin, body: { beni: [] } });
    await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: {
        smtp_host: prima.smtp_host ?? '', smtp_port: prima.smtp_port ?? '', smtp_secure: prima.smtp_secure ?? 'true', smtp_user: prima.smtp_user ?? ''
    } });
    await posta.chiudi();
}

console.log(falliti === 0 ? '\nPosta: tutto a posto\n' : `\nPosta: ${falliti} verifiche fallite\n`);
process.exit(falliti === 0 ? 0 : 1);
