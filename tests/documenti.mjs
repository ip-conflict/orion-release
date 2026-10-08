// tests/documenti.mjs
//
// L'archivio dei documenti del gruppo (src/documenti.js). Lo consultano tutti
// gli interni; caricare, cambiare e togliere è di chi ha gruppo.documenti, che
// si concede anche da solo. Un documento riservato a un ruolo non lo vede chi
// non ce l'ha; gli esterni vedono solo quelli segnati per l'emergenza, e solo
// a emergenza aperta. Una versione nuova conserva le vecchie; il file si
// controlla nel contenuto e ha un tetto di dimensione; si collega ai beni del
// magazzino.
//
// Crea qualche persona e qualche documento e li toglie alla fine. Apre e chiude
// un'emergenza se non ce n'è una aperta. Va lanciata su un'istanza di collaudo.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/documenti.mjs

import 'dotenv/config';
import { accediConFetch } from './accesso-prova.mjs';

const BASE = (process.env.ORION_URL || 'http://localhost:3000').replace(/\/$/, '');
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
// Un caricamento col modulo, come dalla pagina.
const carica = async (percorso, token, { nome, contenuto, campi = {} }) => {
    const modulo = new FormData();
    for (const [k, v] of Object.entries(campi)) modulo.append(k, Array.isArray(v) ? v.join(',') : String(v));
    if (contenuto) modulo.append('file', new Blob([contenuto]), nome);
    const r = await fetch(BASE + percorso, { method: 'POST', body: modulo, headers: { Authorization: `Bearer ${token}` } });
    return { stato: r.status, corpo: await r.json().catch(() => null) };
};
const pdf = (testo) => Buffer.from(`%PDF-1.4\n% ${testo}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

console.log('\nArchivio dei documenti');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const persone = [];
const documenti = [];
let emergenzaAperta = false;
let bene = null;
let bene2 = null;
async function nuovo(nome, ruoli = ['volontario']) {
    const n = (await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `${nome}${suffisso}`, cognome: 'Documenti', ruoli } })).corpo;
    persone.push(n.id);
    const q = new URL(n.magicLink).searchParams;
    const password = `${nome}!${suffisso}Aa1`;
    await chiama('/api/auth/reset-password', { method: 'POST', body: { token: q.get('token'), id: Number(q.get('id')), newPassword: password } });
    return { id: n.id, token: (await accediConFetch(BASE, n.username, password)).token };
}
const elenco = async (token) => (await chiama('/api/documenti', { token })).corpo;

try {
    const catalogo = (await chiama('/api/permessi/catalogo', { token: admin })).corpo;
    verifica('il permesso gruppo.documenti è nel catalogo, categoria Gruppo',
        catalogo?.permessi?.some(p => p.codice === 'gruppo.documenti' && p.categoria === 'Gruppo'), catalogo?.categorie);

    const iniziale = await elenco(admin);
    verifica("l'archivio parte con le sue cartelle", iniziale?.cartelle?.length >= 5 && iniziale.gestisce === true && iniziale.mb_massimi === 25, iniziale);
    const procedure = iniziale.cartelle.find(c => c.nome === 'Procedure operative');

    const vol = await nuovo('Vol');
    const tenutario = await nuovo('Arch');
    const mag = await nuovo('Mag', ['volontario', 'magazziniere']);
    const est = await nuovo('Est', ['esterno']);

    const daVolontario = await carica('/api/documenti', vol.token, { nome: 'a.pdf', contenuto: pdf('a'), campi: { titolo: 'Non mio' } });
    verifica('un volontario non carica -> 403', daVolontario.stato === 403, daVolontario.stato);
    await chiama(`/api/admin/users/${tenutario.id}/permessi`, { method: 'PUT', token: admin, body: { in_piu: ['gruppo.documenti'] } });
    verifica('col permesso in più, l\'archivio è suo', (await elenco(tenutario.token))?.gestisce === true);

    // Caricare.
    const primo = await carica('/api/documenti', tenutario.token, {
        nome: 'Procedura motosega.pdf', contenuto: pdf('versione uno'),
        campi: { titolo: `Procedura motosega ${suffisso}`, cartella_id: procedure.id, descrizione: 'Uso in sicurezza', sempre_con_me: true }
    });
    verifica('documento caricato', primo.stato === 201 && primo.corpo?.versione === 1 && primo.corpo.sempre_con_me === true
        && primo.corpo.tipo === 'application/pdf' && /^[0-9a-f]{64}$/.test(primo.corpo.impronta || ''), primo);
    if (primo.corpo?.id) documenti.push(primo.corpo.id);
    const id = primo.corpo?.id;

    const finto = await carica('/api/documenti', tenutario.token, { nome: 'finto.pdf', contenuto: Buffer.from('MZ questo non è un PDF'), campi: { titolo: 'Finto' } });
    verifica('un file che non è quello che dice il nome -> 400', finto.stato === 400, finto);
    const vietato = await carica('/api/documenti', tenutario.token, { nome: 'script.exe', contenuto: Buffer.from('MZ'), campi: { titolo: 'Eseguibile' } });
    verifica('un formato non ammesso -> 400', vietato.stato === 400, vietato);
    const senzaTitolo = await carica('/api/documenti', tenutario.token, { nome: 'b.pdf', contenuto: pdf('b') });
    verifica('senza titolo -> 400', senzaTitolo.stato === 400, senzaTitolo);
    const grande = await carica('/api/documenti', tenutario.token, {
        nome: 'enorme.pdf', contenuto: Buffer.concat([pdf('grande'), Buffer.alloc(26 * 1024 * 1024)]), campi: { titolo: 'Troppo grande' }
    });
    verifica('oltre il tetto -> 413', grande.stato === 413, grande.stato);

    // Lo vede ogni interno, e lo apre.
    const visto = await elenco(vol.token);
    verifica("l'app di un volontario ha i documenti", (await chiama('/api/app/contesto', { token: vol.token })).corpo?.capacita?.includes('documenti'));
    verifica('un volontario lo vede, senza poter gestire', visto?.documenti?.some(d => d.id === id) && visto.gestisce === false && visto.byte_totali === undefined, visto?.gestisce);
    const file = await fetch(`${BASE}/api/documenti/${id}/file`, { headers: { Authorization: `Bearer ${vol.token}` } });
    const contenuto = Buffer.from(await file.arrayBuffer());
    verifica('e lo apre nel browser, in chiaro', file.status === 200 && /^inline/.test(file.headers.get('content-disposition') || '')
        && contenuto.toString().includes('versione uno'), file.status);
    verifica('un volontario non lo cambia -> 403', (await chiama(`/api/documenti/${id}`, { method: 'PUT', token: vol.token, body: { titolo: 'X' } })).stato === 403);

    // Una versione nuova conserva la vecchia.
    const seconda = await carica(`/api/documenti/${id}/versioni`, tenutario.token, { nome: 'Procedura motosega rev2.pdf', contenuto: pdf('versione due'), campi: { nota: 'Aggiornata la catena' } });
    verifica('versione nuova', seconda.stato === 201 && seconda.corpo?.versione === 2 && seconda.corpo.versioni === 2 && seconda.corpo.impronta !== primo.corpo.impronta, seconda.corpo);
    const dettaglio = (await chiama(`/api/documenti/${id}`, { token: vol.token })).corpo;
    verifica('lo storico ha le due versioni, con la nota', dettaglio?.storico?.length === 2 && dettaglio.storico[0].nota === 'Aggiornata la catena', dettaglio?.storico);
    const vecchia = await fetch(`${BASE}/api/documenti/${id}/file?versione=1`, { headers: { Authorization: `Bearer ${vol.token}` } });
    verifica('la vecchia si apre ancora', (await vecchia.text()).includes('versione uno'));

    // Riservato a un ruolo.
    const riservato = await chiama(`/api/documenti/${id}`, { method: 'PUT', token: tenutario.token, body: {
        titolo: `Procedura motosega ${suffisso}`, cartella_id: procedure.id, visibilita: 'ruoli', ruoli: ['magazziniere'], sempre_con_me: true
    } });
    verifica('riservato ai magazzinieri', riservato.stato === 200 && riservato.corpo?.visibilita === 'ruoli' && riservato.corpo.ruoli.join() === 'magazziniere', riservato);
    verifica('il volontario non lo vede più', !(await elenco(vol.token))?.documenti?.some(d => d.id === id));
    verifica('e non lo apre -> 404', (await chiama(`/api/documenti/${id}/file`, { token: vol.token })).stato === 404);
    verifica('il magazziniere sì', (await elenco(mag.token))?.documenti?.some(d => d.id === id));
    verifica('chi tiene l\'archivio lo vede comunque', (await elenco(tenutario.token))?.documenti?.some(d => d.id === id));
    const senzaRuoli = await chiama(`/api/documenti/${id}`, { method: 'PUT', token: tenutario.token, body: { titolo: `Procedura motosega ${suffisso}`, visibilita: 'ruoli', ruoli: ['inventato'] } });
    verifica('riservato a nessun ruolo valido torna a tutti gli interni', senzaRuoli.corpo?.visibilita === 'interni', senzaRuoli.corpo);

    // Gli esterni: solo i documenti per l'emergenza, a emergenza aperta.
    const piano = await carica('/api/documenti', tenutario.token, {
        nome: 'Piano.pdf', contenuto: pdf('piano'), campi: { titolo: `Piano comunale ${suffisso}`, in_emergenza: true }
    });
    if (piano.corpo?.id) documenti.push(piano.corpo.id);
    const stato = (await chiama('/api/emergencies/status', { token: admin })).corpo;
    if (!stato?.active) {
        verifica('senza emergenza un esterno non vede niente', (await elenco(est.token))?.documenti?.length === 0);
        const aperta = await chiama('/api/emergencies/open', { method: 'POST', token: admin, body: { external_code: `DOC-${suffisso}`, name: 'Prova documenti' } });
        emergenzaAperta = aperta.stato === 201;
    }
    verifica("nell'app l'esterno ha i documenti a emergenza aperta",
        (await chiama('/api/app/contesto', { token: est.token })).corpo?.capacita?.includes('documenti'));
    const visteEsterno = await elenco(est.token);
    verifica("a emergenza aperta l'esterno vede solo il piano", visteEsterno?.documenti?.length >= 1
        && visteEsterno.documenti.every(d => d.in_emergenza) && visteEsterno.documenti.some(d => d.id === piano.corpo?.id)
        && !visteEsterno.documenti.some(d => d.id === id), visteEsterno?.documenti?.map(d => d.titolo));
    verifica('e le cartelle sono solo quelle che servono', visteEsterno?.cartelle?.length === 0, visteEsterno?.cartelle);
    verifica('la procedura gli resta chiusa -> 404', (await chiama(`/api/documenti/${id}`, { token: est.token })).stato === 404);
    if (emergenzaAperta) {
        await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
        emergenzaAperta = false;
        verifica("chiusa l'emergenza, l'esterno non vede più il piano", (await elenco(est.token))?.documenti?.length === 0);
        verifica("e l'app non gli mostra più i documenti",
            !(await chiama('/api/app/contesto', { token: est.token })).corpo?.capacita?.includes('documenti'));
    }

    // Il collegamento ai beni del magazzino.
    const b = await chiama('/api/magazzino/beni', { method: 'POST', token: admin, body: { tipo: 'attrezzatura', denominazione: `Motosega ${suffisso}` } });
    if (b.stato === 201) {
        bene = b.corpo.id;
        verifica('un volontario non collega -> 403', (await chiama(`/api/documenti/${id}/beni`, { method: 'POST', token: vol.token, body: { bene_id: bene } })).stato === 403);
        const collegato = await chiama(`/api/documenti/${id}/beni`, { method: 'POST', token: mag.token, body: { bene_id: bene } });
        verifica('il magazziniere collega il libretto al bene', collegato.stato === 201 && collegato.corpo?.beni?.some(x => x.id === bene), collegato);
        const delBene = (await chiama(`/api/documenti?bene=${bene}`, { token: vol.token })).corpo;
        verifica('dalla scheda del bene si trova il libretto', delBene?.documenti?.length === 1 && delBene.documenti[0].id === id, delBene?.documenti);
        verifica('un bene inesistente -> 404', (await chiama(`/api/documenti/${id}/beni`, { method: 'POST', token: mag.token, body: { bene_id: 999999 } })).stato === 404);
        const scollegato = await chiama(`/api/documenti/${id}/beni/${bene}`, { method: 'DELETE', token: tenutario.token });
        verifica('e lo scollega chi tiene l\'archivio', scollegato.stato === 200 && scollegato.corpo?.beni?.length === 0, scollegato.corpo);

        // Dalla scheda del bene: il libretto caricato da lì, anche per i beni uguali.
        const b2 = await chiama('/api/magazzino/beni', { method: 'POST', token: admin, body: { tipo: 'attrezzatura', denominazione: `motosega ${suffisso}` } });
        bene2 = b2.corpo?.id;
        verifica('un volontario non carica il libretto -> 403',
            (await carica(`/api/magazzino/beni/${bene}/libretto`, vol.token, { nome: 'l.pdf', contenuto: pdf('l') })).stato === 403);
        const libretto = await carica(`/api/magazzino/beni/${bene}/libretto`, mag.token, { nome: 'libretto-motosega.pdf', contenuto: pdf('libretto'), campi: { simili: 'true' } });
        if (libretto.corpo?.id) documenti.push(libretto.corpo.id);
        verifica('il magazziniere carica il libretto dalla scheda del bene, anche per quello uguale',
            libretto.stato === 201 && libretto.corpo?.titolo === `Libretto Motosega ${suffisso}` && libretto.corpo?.collegati === 2
            && [bene, bene2].every(x => libretto.corpo.beni.some(y => y.id === x)), libretto.corpo);
        const cartelle = (await elenco(vol.token))?.cartelle || [];
        verifica('finisce nella cartella dei libretti, nell\'archivio di tutti', cartelle.some(c => c.id === libretto.corpo?.cartella_id && /^Libretti/.test(c.nome)), cartelle);
        verifica('si apre dalla scheda del bene uguale', ((await chiama(`/api/documenti?bene=${bene2}`, { token: vol.token })).corpo?.documenti || []).some(d => d.id === libretto.corpo?.id));
        const tutti = await chiama(`/api/documenti/${id}/beni`, { method: 'POST', token: mag.token, body: { bene_id: bene2, simili: true } });
        verifica("un documento dell'archivio si collega a tutti i beni uguali", tutti.stato === 201 && tutti.corpo?.collegati === 2, tutti.corpo);

        // Il libretto di quello che si ha in carico: l'app lo tiene sul telefono finché lo si ha.
        const segnato = async () => ((await elenco(vol.token))?.documenti || []).find(d => d.id === libretto.corpo?.id)?.in_carico;
        verifica('senza averla in carico il libretto non è segnato', (await segnato()) === false);
        const consegna = await chiama('/api/magazzino/movimenti', { method: 'POST', token: admin, body: { bene_id: bene, tipo: 'consegna', quantita: 1, destinatario: { tipo: 'persona', id: vol.id } } });
        verifica('consegnata la motosega al volontario, il suo libretto è segnato in carico', consegna.stato < 300 && (await segnato()) === true, consegna);
        verifica('agli altri no', ((await elenco(mag.token))?.documenti || []).find(d => d.id === libretto.corpo?.id)?.in_carico === false);
        const rientro = await chiama('/api/magazzino/movimenti', { method: 'POST', token: admin, body: { bene_id: bene, tipo: 'rientro', quantita: 1 } });
        verifica('rientrata in magazzino, non è più segnato', rientro.stato < 300 && (await segnato()) === false, rientro);
    } else {
        console.log(`  (magazzino non disponibile: HTTP ${b.stato}, il collegamento ai beni non si prova)`);
    }

    // Le cartelle.
    const cartella = await chiama('/api/documenti-cartelle', { method: 'POST', token: tenutario.token, body: { nome: `Prove ${suffisso}` } });
    verifica('cartella nuova', cartella.stato === 201, cartella);
    verifica('stesso nome -> 409', (await chiama('/api/documenti-cartelle', { method: 'POST', token: tenutario.token, body: { nome: `Prove ${suffisso}` } })).stato === 409);
    await chiama(`/api/documenti/${id}`, { method: 'PUT', token: tenutario.token, body: { titolo: `Procedura motosega ${suffisso}`, cartella_id: cartella.corpo.id } });
    verifica('con dentro un documento non si toglie -> 409', (await chiama(`/api/documenti-cartelle/${cartella.corpo.id}`, { method: 'DELETE', token: tenutario.token })).stato === 409);

    // Via.
    const tolto = await chiama(`/api/documenti/${id}`, { method: 'DELETE', token: tenutario.token });
    verifica('documento tolto con le sue versioni', tolto.stato === 200 && (await chiama(`/api/documenti/${id}`, { token: tenutario.token })).stato === 404);
    documenti.splice(documenti.indexOf(id), 1);
    verifica('vuota, la cartella si toglie', (await chiama(`/api/documenti-cartelle/${cartella.corpo.id}`, { method: 'DELETE', token: tenutario.token })).stato === 200);

    await chiama(`/api/admin/users/${tenutario.id}/permessi`, { method: 'PUT', token: admin, body: { in_piu: [] } });
    verifica('revocato il permesso, non carica più -> 403',
        (await carica('/api/documenti', tenutario.token, { nome: 'c.pdf', contenuto: pdf('c'), campi: { titolo: 'Dopo' } })).stato === 403);
} finally {
    if (emergenzaAperta) await chiama('/api/emergencies/close', { method: 'POST', token: admin, body: {} });
    for (const d of documenti) await chiama(`/api/documenti/${d}`, { method: 'DELETE', token: admin });
    for (const x of [bene, bene2].filter(Boolean)) await chiama('/api/magazzino/movimenti', { method: 'POST', token: admin, body: { bene_id: x, tipo: 'dismissione', quantita: 1, note: 'prova documenti' } });
    for (const p of persone.reverse()) await chiama(`/api/users/${p}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}
console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
