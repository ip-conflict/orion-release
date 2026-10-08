// tests/taglie.mjs
//
// Le taglie di una persona alla consegna: per un DPI già ricevuto vale la
// taglia che ha ancora in carico, altrimenti l'ultima consegnata; per un DPI
// mai ricevuto si deduce dalla taglia di un DPI dello stesso gruppo (busto,
// pantaloni, scarpe: la giacca XL propone la polo XL), mai fra gruppi diversi
// (le scarpe 44 non dicono niente dei pantaloni 44) né per un DPI senza
// gruppo. La taglia "Unica" non conta.
//
// Crea un volontario e alcuni DPI di prova, e alla fine li toglie.
//   ORION_URL=http://localhost:3010 ORION_ADMIN_PASSWORD=... node tests/taglie.mjs

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

console.log('\nTaglie alla consegna');
const admin = (await accediConFetch(BASE, process.env.ORION_ADMIN_USER || 'admin', process.env.ORION_ADMIN_PASSWORD)).token;
const suffisso = Date.now().toString().slice(-5);
const modelli = [];
let persona = null;

const nuovoModello = async (nome, taglie, quantita, gruppo_taglia = null) => {
    const r = await chiama('/api/magazzino/modelli', { method: 'POST', token: admin, body: { nome: `${nome} ${suffisso}`, taglie, quantita, gruppo_taglia } });
    if (r.corpo?.id) modelli.push(r.corpo);
    return r.corpo;
};
const variante = (modello, taglia) => modello.varianti.find(v => v.taglia === taglia).bene_id;
const consegna = (beneId) => chiama('/api/magazzino/consegna', {
    method: 'POST', token: admin, body: { destinatario: { tipo: 'persona', id: persona }, righe: [{ bene_id: beneId, quantita: 1 }] }
});
const rientro = (beneId) => chiama('/api/magazzino/rientro', {
    method: 'POST', token: admin, body: { da: { tipo: 'persona', id: persona }, righe: [{ bene_id: beneId, quantita: 1 }] }
});
const taglie = async () => {
    const righe = (await chiama(`/api/magazzino/taglie/persona/${persona}`, { token: admin })).corpo || [];
    return new Map(righe.map(r => [r.modello_id, r]));
};

try {
    const utente = await chiama('/api/users', { method: 'POST', token: admin, body: { nome: `Taglie${suffisso}`, cognome: 'Collaudo', role: 'volontario' } });
    persona = utente.corpo?.id;
    verifica('volontario di prova creato', !!persona, utente);

    const sbagliato = await chiama('/api/magazzino/modelli', { method: 'POST', token: admin, body: { nome: `Cappello prova ${suffisso}`, taglie: ['M'], gruppo_taglia: 'testa' } });
    verifica('un gruppo di taglia che non esiste -> 400', sbagliato.stato === 400, sbagliato);
    const giacca = await nuovoModello('Giacca prova', ['S', 'M', 'L', 'XL', 'XXL'], { L: 3, XL: 3 }, 'busto');
    const polo = await nuovoModello('Polo prova', ['S', 'M', 'L', 'XL', 'XXL'], { L: 2, XL: 2 }, 'busto');
    const felpa = await nuovoModello('Felpa prova', ['S', 'M', 'L', 'XL', 'XXL'], { XL: 1 });
    const scarpe = await nuovoModello('Scarpe prova', ['40', '41', '42', '43', '44', '45', '46'], { 44: 2 }, 'scarpe');
    const stivali = await nuovoModello('Stivali prova', ['42', '43', '44', '45'], { 44: 1 });
    const pantaloni = await nuovoModello('Pantaloni prova', ['44', '46', '48', '50', '52'], { 44: 1, 46: 1 }, 'pantaloni');
    const casco = await nuovoModello('Casco prova', ['Unica'], { Unica: 2 });
    verifica('DPI di prova creati, con il loro gruppo', modelli.length === 7 && giacca.gruppo_taglia === 'busto' && felpa.gruppo_taglia === null,
        modelli.map(m => `${m.nome}:${m.gruppo_taglia}`));

    let t = await taglie();
    verifica('senza consegne: nessuna taglia', ![giacca, polo, scarpe, pantaloni].some(m => t.has(m.id)), [...t.values()]);

    await consegna(variante(giacca, 'L'));
    await consegna(variante(giacca, 'XL'));
    await consegna(variante(scarpe, '44'));
    await consegna(variante(casco, 'Unica'));
    t = await taglie();
    verifica('due taglie della stessa giacca, tutte e due in carico: vale l\'ultima (XL)',
        t.get(giacca.id)?.taglia === 'XL' && t.get(giacca.id)?.dedotta === false, t.get(giacca.id));
    verifica('la polo mai ricevuta: XL dedotta dalla giacca',
        t.get(polo.id)?.taglia === 'XL' && t.get(polo.id)?.dedotta === true && t.get(polo.id)?.da_modello === giacca.nome, t.get(polo.id));
    verifica('i pantaloni (gruppo pantaloni) non si deducono dalle scarpe 44', !t.has(pantaloni.id), t.get(pantaloni.id));
    verifica('la felpa senza gruppo: niente proposta', !t.has(felpa.id), t.get(felpa.id));
    verifica('gli stivali senza gruppo: niente proposta', !t.has(stivali.id), t.get(stivali.id));
    const messi = await chiama(`/api/magazzino/modelli/${stivali.id}`, { method: 'PUT', token: admin, body: { gruppo_taglia: 'scarpe' } });
    t = await taglie();
    verifica('messi gli stivali fra le scarpe: 44 dedotta', messi.corpo?.gruppo_taglia === 'scarpe' && t.get(stivali.id)?.taglia === '44' && t.get(stivali.id)?.dedotta,
        { gruppo: messi.corpo?.gruppo_taglia, t: t.get(stivali.id) });
    const rinominati = await chiama(`/api/magazzino/modelli/${stivali.id}`, { method: 'PUT', token: admin, body: { nome: `Stivali nuovi ${suffisso}` } });
    verifica('cambiando solo il nome il gruppo resta', rinominati.corpo?.gruppo_taglia === 'scarpe', rinominati.corpo?.gruppo_taglia);
    verifica('la taglia Unica non conta', !t.has(casco.id), t.get(casco.id));

    // Rende la XL perché grande: vale la L che ha ancora, anche per la polo.
    await rientro(variante(giacca, 'XL'));
    t = await taglie();
    verifica('resa la XL, vale la L che ha ancora', t.get(giacca.id)?.taglia === 'L', t.get(giacca.id));
    verifica('e la polo dedotta segue: L', t.get(polo.id)?.taglia === 'L', t.get(polo.id));

    // Resa anche la L: non ha più niente, vale l'ultima consegnata.
    await rientro(variante(giacca, 'L'));
    t = await taglie();
    verifica('resa anche la L, vale l\'ultima consegnata (XL)', t.get(giacca.id)?.taglia === 'XL', t.get(giacca.id));

    // Una polo ricevuta davvero prevale sulla dedotta.
    await consegna(variante(polo, 'L'));
    t = await taglie();
    verifica('ricevuta la polo L: è sua, non più dedotta', t.get(polo.id)?.taglia === 'L' && t.get(polo.id)?.dedotta === false, t.get(polo.id));
    await rientro(variante(polo, 'L'));
    await rientro(variante(scarpe, '44'));
    await rientro(variante(casco, 'Unica'));
} finally {
    for (const m of modelli) {
        const letto = (await chiama('/api/magazzino/modelli?nascosti=1', { token: admin })).corpo?.find(x => x.id === m.id);
        for (const v of letto?.varianti || []) {
            if (Number(v.in_magazzino) > 0) await chiama('/api/magazzino/movimenti', {
                method: 'POST', token: admin, body: { bene_id: v.bene_id, tipo: 'dismissione', quantita: Number(v.in_magazzino), note: 'pulizia del collaudo' }
            });
        }
        await chiama(`/api/magazzino/modelli/${m.id}`, { method: 'DELETE', token: admin });
    }
    if (persona) await chiama(`/api/users/${persona}`, { method: 'DELETE', token: admin, body: { beni: [] } });
}

console.log(falliti === 0 ? '\nTutto a posto.\n' : `\n${falliti} verifiche fallite.\n`);
process.exit(falliti === 0 ? 0 : 1);
