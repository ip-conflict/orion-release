// Il telefono come secondo fattore e l'attivazione dall'app, con un telefono finto (chiave P-256).
// Crea ed elimina utenti di prova: va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_USER=... ORION_ADMIN_PASSWORD=... node tests/telefoni.mjs

import 'dotenv/config';
import crypto from 'crypto';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN = process.env.ORION_ADMIN_USER || 'admin';

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${typeof dettaglio === 'string' ? dettaglio : JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};
const chiama = async (percorso, { method = 'GET', body, token, avvisi } = {}) => {
    const r = await fetch(BASE + percorso, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(avvisi ? { Authorization: `Avvisi ${avvisi}` } : {})
        }
    });
    return { stato: r.status, corpo: await r.json().catch(() => null), cookie: r.headers.get('set-cookie') || '' };
};
const login = (username, password) => chiama('/login', { method: 'POST', body: { username, password } });

function nuovoTelefono(nome) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const chiave = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const firma = (testo) => crypto.sign('sha256', Buffer.from(testo), privateKey).toString('base64');
    return { chiave, firma, nome, perCollegare: () => ({ chiave, nome, firma: firma(`orion-collega:${chiave}`) }) };
}

console.log('\nTelefono come secondo fattore');

const admin = await accediConFetch(BASE, ADMIN, process.env.ORION_ADMIN_PASSWORD);
const tokenAdmin = admin.token;
const suffisso = Date.now().toString().slice(-6);
const password = `Telefono!${suffisso}Aa1`;
const creati = [];

async function iscrivi(nome, role = 'volontario') {
    const r = await chiama('/api/users', { method: 'POST', token: tokenAdmin, body: { nome: `${nome}${suffisso}`, cognome: `Prova${suffisso}`, role } });
    creati.push(r.corpo.id);
    const p = new URL(r.corpo.magicLink).searchParams;
    return { id: Number(p.get('id')), token: p.get('token'), username: r.corpo.username, userId: r.corpo.id };
}

try {
    const { versione } = (await chiama('/api/pubblico/informativa')).corpo;
    const vol = await iscrivi('Tel');

    let r = await chiama(`/api/attivazione?id=${vol.id}&token=sbagliato`);
    verifica('un link sbagliato non dice niente della persona', r.stato === 400 && !r.corpo?.username, r);
    r = await chiama(`/api/attivazione?id=${vol.id}&token=${vol.token}`);
    verifica('il link giusto dà nome, nome utente e cosa serve', r.stato === 200 && r.corpo.username === vol.username && r.corpo.verifica === 'facoltativa' && r.corpo.condizioni === versione, r.corpo);

    const telefono = nuovoTelefono('Telefono di prova');
    r = await chiama('/api/attivazione', { method: 'POST', body: { id: vol.id, token: vol.token, password: 'debole', condizioni: versione } });
    verifica('una password debole è rifiutata con il motivo', r.stato === 400 && r.corpo?.campo === 'password', r.corpo);
    r = await chiama('/api/attivazione', { method: 'POST', body: { id: vol.id, token: vol.token, password, condizioni: versione + 100 } });
    verifica('condizioni di un\'altra versione -> 409', r.stato === 409, r.corpo);
    r = await chiama('/api/attivazione', { method: 'POST', body: { id: vol.id, token: vol.token, password, condizioni: versione, telefono: { ...telefono.perCollegare(), firma: telefono.firma('altro') } } });
    verifica('una chiave non firmata non si collega e non consuma il link', r.stato === 400 && r.corpo?.campo === 'telefono', r.corpo);
    r = await chiama('/api/attivazione', { method: 'POST', body: { id: vol.id, token: vol.token, password, condizioni: versione, telefono: telefono.perCollegare() } });
    verifica('attivazione: sessione, telefono collegato, dieci codici di riserva', r.stato === 200 && !!r.corpo?.token && Number.isInteger(r.corpo?.telefono) && r.corpo?.codici_riserva?.length === 10, r.corpo);
    let sessione = r.corpo.token;
    const idTelefono = r.corpo.telefono;
    r = await chiama('/api/attivazione', { method: 'POST', body: { id: vol.id, token: vol.token, password, condizioni: versione } });
    verifica('il link non vale una seconda volta', r.stato === 400, r.corpo);
    r = await chiama('/api/users/me', { token: sessione });
    verifica('le condizioni risultano accettate: niente 428', r.stato === 200, r.stato);
    r = await chiama('/api/mfa', { token: sessione });
    verifica('la verifica è attiva con un telefono e senza app dei codici', r.corpo?.attiva === true && r.corpo?.telefoni === 1 && r.corpo?.totp === false, r.corpo);

    r = await login(vol.username, password);
    verifica('la password da sola non basta: sfida con telefoni', r.stato === 401 && r.corpo?.mfa === 'codice' && r.corpo?.telefoni === 1 && r.corpo?.totp === false, r.corpo);
    let sfida = r.corpo.sfida;
    r = await chiama('/api/accesso/mfa', { method: 'POST', body: { sfida, codice: '123456' } });
    verifica('un codice a sei cifre senza app dei codici spiega cosa fare', r.stato === 401 && /conferma dal telefono/.test(r.corpo?.message || ''), r.corpo);
    r = await chiama('/api/accesso/chiave', { method: 'POST', body: { sfida, telefono: idTelefono, firma: telefono.firma('orion-accesso:altra') } });
    verifica("con la firma d'altro non si entra", r.stato === 401 && !r.corpo?.token, r.corpo);
    r = await chiama('/api/accesso/chiave', { method: 'POST', body: { sfida, telefono: idTelefono, firma: telefono.firma(`orion-accesso:${sfida}`) } });
    verifica("l'app sul telefono collegato entra firmando la sfida", r.stato === 200 && !!r.corpo?.token, r.corpo);
    sessione = r.corpo.token;

    r = await chiama('/api/app/avvisi', { method: 'POST', token: sessione, body: { dispositivo: 'Prova' } });
    const avvisi = r.corpo?.avvisi;
    verifica('il telefono ha il suo token degli avvisi', !!avvisi, r.corpo);

    r = await login(vol.username, password);
    sfida = r.corpo.sfida;
    r = await chiama('/api/accesso/telefono/stato', { method: 'POST', body: { sfida } });
    verifica('senza richiesta in corso lo stato dice 409', r.stato === 409, r.corpo);
    r = await chiama('/api/accesso/telefono', { method: 'POST', body: { sfida } });
    const numero = r.corpo?.numero;
    verifica('il browser chiede la conferma e riceve il numero', r.stato === 200 && numero >= 10 && numero <= 99, r.corpo);
    r = await chiama('/api/accesso/telefono/stato', { method: 'POST', body: { sfida } });
    verifica('finché il telefono non risponde: 202', r.stato === 202, r.corpo);
    r = await chiama('/api/avvisi/conferme', { avvisi });
    let conferma = r.corpo?.[0];
    verifica('il telefono vede la richiesta, con tre numeri fra cui quello giusto', r.stato === 200 && conferma?.scelte?.length === 3 && conferma.scelte.includes(numero) && typeof conferma.browser === 'string', r.corpo);
    r = await chiama('/api/avvisi/conferme', {});
    verifica('senza token degli avvisi le richieste non si vedono', r.stato === 401, r.stato);
    r = await chiama('/api/notifiche', { token: sessione });
    verifica('arriva anche come notifica, senza il numero', (r.corpo?.notifiche || r.corpo || []).some?.(n => n.tipo === 'conferma_accesso' && !String(n.testo).includes(String(numero))), r.corpo);
    const sbagliato = conferma.scelte.find(n => n !== numero);
    r = await chiama(`/api/avvisi/conferme/${conferma.id}`, { method: 'POST', avvisi, body: { risposta: 'si', telefono: idTelefono, numero: sbagliato, firma: telefono.firma(`orion-conferma:${conferma.id}:${sbagliato}`) } });
    verifica('il numero sbagliato blocca l\'accesso', r.stato === 409, r.corpo);
    r = await chiama('/api/accesso/telefono/stato', { method: 'POST', body: { sfida } });
    verifica('e il browser lo sa', r.stato === 401 && r.corpo?.rifiutata === true, r.corpo);

    r = await login(vol.username, password);
    sfida = r.corpo.sfida;
    await chiama('/api/accesso/telefono', { method: 'POST', body: { sfida } });
    conferma = (await chiama('/api/avvisi/conferme', { avvisi })).corpo[0];
    r = await chiama(`/api/avvisi/conferme/${conferma.id}`, { method: 'POST', avvisi, body: { risposta: 'no' } });
    verifica('"Non sono io" blocca l\'accesso', r.stato === 200, r.corpo);
    r = await chiama('/api/accesso/telefono/stato', { method: 'POST', body: { sfida } });
    verifica('e il browser resta fuori', r.stato === 401 && !r.corpo?.token, r.corpo);

    r = await login(vol.username, password);
    sfida = r.corpo.sfida;
    const giusto = (await chiama('/api/accesso/telefono', { method: 'POST', body: { sfida } })).corpo.numero;
    conferma = (await chiama('/api/avvisi/conferme', { avvisi })).corpo[0];
    r = await chiama(`/api/avvisi/conferme/${conferma.id}`, { method: 'POST', avvisi, body: { risposta: 'si', telefono: idTelefono, numero: giusto, firma: telefono.firma(`orion-conferma:${conferma.id}:${giusto + 1}`) } });
    verifica('una firma che non corrisponde al numero non vale', r.stato === 401, r.corpo);
    r = await chiama(`/api/avvisi/conferme/${conferma.id}`, { method: 'POST', avvisi, body: { risposta: 'si', telefono: idTelefono, numero: giusto, firma: telefono.firma(`orion-conferma:${conferma.id}:${giusto}`) } });
    verifica('con il numero giusto e l\'impronta il telefono conferma', r.stato === 200, r.corpo);
    r = await chiama('/api/accesso/telefono/stato', { method: 'POST', body: { sfida } });
    verifica('e il browser entra, con il cookie della sessione', r.stato === 200 && !!r.corpo?.token && r.cookie.includes('__Secure-token'), r.corpo);
    r = await chiama('/api/accesso/telefono/stato', { method: 'POST', body: { sfida } });
    verifica('la stessa sfida non fa entrare due volte', r.stato === 401, r.corpo);
    r = await chiama('/api/avvisi/conferme', { avvisi });
    verifica('non resta nessuna richiesta in attesa', Array.isArray(r.corpo) && r.corpo.length === 0, r.corpo);

    const secondo = nuovoTelefono('Secondo');
    r = await chiama('/api/telefoni', { method: 'POST', token: sessione, body: { password: 'sbagliata', telefono: secondo.perCollegare() } });
    verifica('collegare un altro telefono chiede la password', r.stato === 403, r.corpo);
    r = await chiama('/api/telefoni', { method: 'POST', token: sessione, body: { password, telefono: secondo.perCollegare() } });
    verifica('si collega un secondo telefono, senza codici nuovi', r.stato === 201 && !r.corpo?.codici_riserva, r.corpo);
    r = await chiama('/api/telefoni', { method: 'POST', token: sessione, body: { password, telefono: secondo.perCollegare() } });
    verifica('lo stesso telefono non si collega due volte', r.stato === 400, r.corpo);
    r = await chiama('/api/telefoni', { token: sessione });
    verifica("l'elenco ha due telefoni, senza chiavi", r.corpo?.length === 2 && r.corpo.every(t => !('chiave_pubblica' in t)), r.corpo);
    r = await chiama(`/api/telefoni/${idTelefono}`, { method: 'DELETE', token: sessione, body: { password } });
    verifica('si scollega il primo', r.stato === 200, r.corpo);
    r = await login(vol.username, password);
    r = await chiama('/api/accesso/chiave', { method: 'POST', body: { sfida: r.corpo.sfida, telefono: idTelefono, firma: telefono.firma(`orion-accesso:${r.corpo.sfida}`) } });
    verifica('il telefono scollegato non fa più entrare', r.stato === 401 && r.corpo?.telefono_scollegato === true, r.corpo);
    const idSecondo = (await chiama('/api/telefoni', { token: sessione })).corpo[0].id;
    r = await chiama(`/api/telefoni/${idSecondo}`, { method: 'DELETE', token: sessione, body: { password } });
    verifica("togliendo l'ultimo telefono la verifica si spegne (volontario)", r.stato === 200 && /spenta/.test(r.corpo?.message || ''), r.corpo);
    r = await login(vol.username, password);
    verifica('e si entra di nuovo con la sola password', r.stato === 200 && !!r.corpo?.token, r.corpo);

    const capo = await iscrivi('Adm', 'admin');
    r = await chiama(`/api/attivazione?id=${capo.id}&token=${capo.token}`);
    verifica("per un amministratore la verifica è obbligatoria", r.corpo?.verifica === 'obbligatoria', r.corpo);
    r = await chiama('/api/attivazione', { method: 'POST', body: { id: capo.id, token: capo.token, password, condizioni: versione } });
    verifica('senza telefono un amministratore non si attiva', r.stato === 400 && r.corpo?.campo === 'telefono', r.corpo);
    const telCapo = nuovoTelefono('Capo');
    r = await chiama('/api/attivazione', { method: 'POST', body: { id: capo.id, token: capo.token, password, condizioni: versione, telefono: telCapo.perCollegare() } });
    verifica('con il telefono sì, e la sessione vale per le pagine da amministratore', r.stato === 200 && !!r.corpo?.token, r.corpo);
    r = await chiama('/api/admin/users', { token: r.corpo?.token });
    verifica('niente 401 mfa_richiesta', r.stato === 200, r.stato);

    r = await chiama(`/api/admin/users/${capo.userId}/reset-password`, { method: 'POST', token: tokenAdmin });
    const p = new URL(r.corpo.magicLink).searchParams;
    r = await chiama('/api/attivazione', { method: 'POST', body: { id: Number(p.get('id')), token: p.get('token'), password: `${password}x`, condizioni: versione, telefono: nuovoTelefono('Intruso').perCollegare() } });
    verifica('un link di ripristino a chi ha già la verifica non collega telefoni e non apre sessioni', r.stato === 200 && r.corpo?.accedi === true && !r.corpo?.token, r.corpo);
    r = await login(capo.username, `${password}x`);
    verifica('serve sempre il telefono di prima', r.stato === 401 && r.corpo?.telefoni === 1, r.corpo);

    const promosso = await iscrivi('Pro');
    await chiama('/api/attivazione', { method: 'POST', body: { id: promosso.id, token: promosso.token, password, condizioni: versione } });
    await chiama(`/api/users/${promosso.userId}`, { method: 'PUT', token: tokenAdmin, body: { nome: `Pro${suffisso}`, cognome: `Prova${suffisso}`, ruoli: ['admin'] } });
    r = await login(promosso.username, password);
    verifica('chi diventa amministratore deve attivare la verifica', r.stato === 401 && r.corpo?.mfa === 'attivazione', r.corpo);
    const telPro = nuovoTelefono('Promosso');
    r = await chiama('/api/accesso/mfa/telefono', { method: 'POST', body: { sfida: r.corpo.sfida, telefono: telPro.perCollegare() } });
    verifica("e la attiva collegando il telefono dall'app", r.stato === 200 && !!r.corpo?.token && r.corpo?.codici_riserva?.length === 10, r.corpo);
    r = await chiama('/api/notifiche', { token: r.corpo?.token });
    verifica('e riceve l\'avviso del telefono nuovo', (r.corpo?.notifiche || r.corpo || []).some?.(n => n.tipo === 'telefono_collegato'), r.corpo);
} finally {
    for (const id of creati) await chiama(`/api/users/${id}`, { method: 'DELETE', token: tokenAdmin });
}

console.log(`\nTelefono come secondo fattore: ${falliti === 0 ? 'tutto a posto' : `${falliti} falliti`}`);
process.exit(falliti === 0 ? 0 : 1);
