// tests/informativa.mjs
//
// L'accettazione delle condizioni d'uso: chi entra per la prima volta riceve
// 428 su ogni richiesta finché non le accetta; il testo si legge anche senza
// accesso; una versione nuova pubblicata dall'amministratore la fa accettare
// di nuovo a tutti; il registro tiene ogni accettazione con l'impronta del
// testo. L'informativa sul trattamento dei dati per ora non c'è.
//
// Crea un volontario di prova e lo toglie alla fine; ripubblica il testo così
// com'era (la versione sale di due: è normale su un'istanza di collaudo).
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/informativa.mjs

import 'dotenv/config';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token, accetta } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(accetta ? { Accept: accetta } : {}) }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null), dove: r.headers.get('location') };
};

console.log('\nCondizioni d\'uso');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
let persona = null;
let statoIniziale = null;

try {
    const pubblica = await chiama('/api/pubblico/informativa');
    verifica('il testo si legge senza accesso', pubblica.stato === 200 && /Condizioni d'uso/.test(pubblica.corpo?.condizioni), pubblica);
    verifica("l'informativa non c'è più", pubblica.corpo?.informativa === '' && pubblica.corpo?.breve === '' && !/titolare del trattamento/.test(pubblica.corpo?.condizioni));
    verifica('le condizioni dicono che è fornito così com\'è e chi ne risponde', /così com'è/.test(pubblica.corpo?.condizioni) && /che risponde dei dati/.test(pubblica.corpo?.condizioni));
    verifica('dicono che ci sono solo cookie tecnici', /solo cookie tecnici/.test(pubblica.corpo?.condizioni));
    verifica('e quali dati restano dopo l\'eliminazione', /non ripudio/.test(pubblica.corpo?.condizioni) && /si cancellano/.test(pubblica.corpo?.condizioni));

    // Un volontario nuovo, con la sua password.
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `Privacy${suffisso}`, cognome: 'Collaudo', role: 'volontario' } })).corpo;
    persona = n.id;
    const q = new URL(n.magicLink).searchParams;
    const password = `Privacy!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    const token = (await chiama('/login', { method: 'POST', body: { username: n.username, password } })).corpo?.token;
    verifica("l'accesso riesce: l'accettazione viene dopo", !!token);

    const bloccata = await chiama('/api/app/contesto', { token });
    verifica('prima di accettare le API rispondono 428', bloccata.stato === 428 && bloccata.corpo?.informativa_da_vedere === true, bloccata);
    const pagina = await chiama('/profile.html', { token, accetta: 'text/html' });
    verifica('e le pagine portano alle condizioni', pagina.stato === 302 && pagina.dove?.startsWith('/informativa.html?redirect='), pagina);

    const testi = await chiama('/api/informativa', { token });
    verifica('il testo si legge anche prima', testi.stato === 200 && testi.corpo?.presa_visione === null && Number.isInteger(testi.corpo?.versione), testi);
    const vecchia = await chiama('/api/informativa/presa-visione', { method: 'POST', token, body: { versione: testi.corpo.versione - 1 } });
    verifica('accettare una versione superata -> 409', vecchia.stato === 409, vecchia);
    const vista = await chiama('/api/informativa/presa-visione', { method: 'POST', token, body: { versione: testi.corpo.versione } });
    verifica('accettazione registrata', vista.stato === 200, vista);
    const sbloccata = await chiama('/api/app/contesto', { token });
    verifica('dopo, si lavora', sbloccata.stato === 200, sbloccata.stato);

    // L'amministratore riscrive il testo e pubblica: si riaccetta.
    statoIniziale = (await chiama('/api/admin/informativa', { token: admin })).corpo;
    verifica('lo stato per l\'amministratore conta chi ha accettato',
        statoIniziale?.con_presa_visione >= 2 && statoIniziale?.attivi >= statoIniziale?.con_presa_visione, statoIniziale);
    const volontarioNo = await chiama('/api/admin/informativa', { token });
    verifica('lo stato è solo per l\'amministratore', volontarioNo.stato === 403, volontarioNo.stato);
    const pubblicata = await chiama('/api/admin/informativa', { method: 'PUT', token: admin, body: {
        testi: { condizioni: `${statoIniziale.predefiniti.condizioni}\nRiga di prova ${suffisso}.` } } });
    verifica('pubblicare crea una versione nuova', pubblicata.stato === 200 && pubblicata.corpo?.versione === statoIniziale.versione + 1, pubblicata);
    const testoNuovo = (await chiama('/api/informativa', { token: admin })).corpo;
    verifica('vale il testo nuovo', testoNuovo?.condizioni?.includes(`Riga di prova ${suffisso}.`));
    verifica('chi pubblica le ha già accettate', !!testoNuovo?.presa_visione, testoNuovo?.presa_visione);
    const dinuovo = await chiama('/api/app/contesto', { token });
    verifica('il volontario deve riaccettarle', dinuovo.stato === 428, dinuovo.stato);

    const interna = await chiama('/api/branding/settings', { method: 'PUT', token: admin, body: { privacy_versione: '1' } });
    verifica('la versione non si cambia dalle impostazioni generali', interna.stato === 400, interna.stato);
} finally {
    // Il testo torna com'era.
    if (statoIniziale) await chiama('/api/admin/informativa', { method: 'PUT', token: admin, body: { testi: statoIniziale.testi } });
    if (persona) await chiama(`/api/users/${persona}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}

console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
