// src/beniInUscita.js
//
// Il materiale in carico a una squadra o a un volontario che sta per sparire.
// Non può sparire con lui: l'operazione si ferma e chiede riga per riga se è
// rientrato, perso o da recuperare, e ogni scelta diventa un movimento con il
// nome di chi ha deciso. "da_recuperare" non muove niente: il bene resta fra
// le cose da riprendere, con il nome del detentore nell'ultimo movimento.

import { erroreRichiesta } from './costanti.js';
import { magazzino } from './istanze.js';
import { beniInCarico } from './magazzino.js';

const DECISIONI_BENI = ['rientrata', 'persa', 'da_recuperare'];

export async function sistemaBeniInCarico(client, req, tipo, id, decisioni) {
    const inCarico = await beniInCarico(client, tipo, id);
    if (inCarico.length === 0) return { sistemati: [] };

    const scelte = new Map(
        (Array.isArray(decisioni) ? decisioni : [])
            .filter(d => d && DECISIONI_BENI.includes(d.decisione))
            .map(d => [parseInt(d.bene_id, 10), d])
    );

    const senzaScelta = inCarico.filter(b => !scelte.has(b.bene_id));
    if (senzaScelta.length > 0) {
        const errore = erroreRichiesta(
            `Ci sono ${inCarico.length} cose ancora in carico: prima di procedere indica per ognuna se è rientrata, persa o da recuperare.`);
        errore.beniInCarico = inCarico;
        errore.conflitto = true;
        throw errore;
    }

    const sistemati = [];
    for (const bene of inCarico) {
        const scelta = scelte.get(bene.bene_id);
        if (scelta.decisione === 'da_recuperare') {
            sistemati.push({ bene_id: bene.bene_id, denominazione: bene.denominazione, decisione: 'da_recuperare' });
            continue;
        }
        const movimento = scelta.decisione === 'rientrata' ? 'rientro' : 'smarrimento';
        const nota = String(scelta.note || '').trim() ||
            (movimento === 'smarrimento'
                ? `Dichiarata persa alla ${tipo === 'squadra' ? 'chiusura della squadra' : 'cancellazione del volontario'}`
                : null);
        await magazzino.registraMovimento(client, req, {
            beneId: bene.bene_id,
            tipo: movimento,
            quantita: bene.quantita,
            note: nota,
            da: { tipo, id }
        });
        sistemati.push({ bene_id: bene.bene_id, denominazione: bene.denominazione, decisione: scelta.decisione });
    }
    return { sistemati };
}
