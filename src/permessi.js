// Ogni controllo chiede un permesso, non un ruolo; i ruoli sono pacchetti. L'amministrazione
// del sistema non è un permesso: chi può dare permessi potrebbe darseli tutti.

export const CATEGORIE_PERMESSI = ['Emergenze', 'Volontari', 'Magazzino', 'Gruppo'];

export const PERMESSI = [
    {
        codice: 'emergenze.apertura', categoria: 'Emergenze',
        nome: 'Aprire e chiudere le emergenze',
        descrizione: "Aprire un'emergenza, con la scelta delle squadre da tenere, e chiuderla, con le strade da lasciare chiuse. Non eliminarla."
    },
    {
        codice: 'emergenze.archivio', categoria: 'Emergenze',
        nome: 'Consultare le emergenze passate',
        descrizione: "L'archivio delle emergenze chiuse: resoconti, punto di situazione finale, segnalazioni, foto e documenti."
    },
    {
        codice: 'emergenze.piano', categoria: 'Emergenze',
        nome: 'Gestire il piano di emergenza sulla mappa',
        descrizione: 'Le zone di pericolo e gli altri elementi permanenti della mappa: metterli, cambiarli, importarli, cancellarli.'
    },
    {
        codice: 'emergenze.funzioni', categoria: 'Emergenze',
        nome: 'Organizzare le funzioni di supporto',
        descrizione: 'Creare e cambiare le funzioni, decidere chi ne fa parte e chi è il referente.'
    },
    {
        codice: 'volontari.anagrafica', categoria: 'Volontari',
        nome: 'Gestire anagrafica e tesserini',
        descrizione: "L'elenco dei volontari con i contatti, i dati anagrafici, la foto e il tesserino; iscrivere i volontari nuovi."
    },
    {
        codice: 'volontari.sanitario', categoria: 'Volontari',
        nome: 'Gestire visite mediche e corsi',
        descrizione: 'Visite e idoneità (dati sanitari), corsi e attestati, i loro cataloghi, il cruscotto delle scadenze. Chiede la verifica in due passaggi.'
    },
    {
        codice: 'magazzino.gestione', categoria: 'Magazzino',
        nome: 'Gestire il magazzino',
        descrizione: "L'inventario: beni, modelli, categorie e ubicazioni, carichi, manutenzioni, dismissioni e rettifiche, le opzioni del modulo, gli avvisi e il riepilogo."
    },
    {
        codice: 'magazzino.consegne', categoria: 'Magazzino',
        nome: 'Consegnare e far rientrare materiale',
        descrizione: "Consegne, rientri e trasferimenti, dal web e dall'app, con i loro verbali."
    },
    {
        codice: 'gruppo.documenti', categoria: 'Gruppo',
        nome: "Gestire l'archivio dei documenti",
        descrizione: 'Caricare, ordinare, sostituire e togliere i documenti del gruppo, decidere chi li vede e quali sono consultabili in emergenza o "sempre con me" sul telefono.'
    },
    {
        codice: 'gruppo.attivita', categoria: 'Gruppo',
        nome: 'Organizzare attività e presenze',
        descrizione: "Creare le attività del calendario e convocare, vedere chi risponde, chiuderle con i presenti e le ore; correggere le presenze, anche quelle delle emergenze, e vedere il riepilogo di tutti."
    }
];

export const CODICI_PERMESSI = PERMESSI.map(p => p.codice);

// Il primo ruolo che una persona ha è il suo ruolo principale (users.role).
export const ORDINE_RUOLI = ['admin', 'coordinatore', 'segreteria', 'magazziniere', 'volontario', 'esterno'];

export const NOMI_RUOLI = {
    admin: 'Amministratore', coordinatore: 'Coordinatore', segreteria: 'Segreteria',
    magazziniere: 'Magazziniere', volontario: 'Volontario', esterno: 'Esterno'
};

export const PERMESSI_DEI_RUOLI = {
    admin: CODICI_PERMESSI,
    coordinatore: ['emergenze.apertura', 'emergenze.archivio', 'emergenze.piano', 'emergenze.funzioni', 'gruppo.attivita'],
    segreteria: ['volontari.anagrafica', 'volontari.sanitario'],
    magazziniere: ['magazzino.gestione', 'magazzino.consegne'],
    volontario: [],
    esterno: []
};

export function permessiDeiRuoli(ruoli) {
    const insieme = new Set();
    for (const r of ruoli || []) for (const p of PERMESSI_DEI_RUOLI[r] || []) insieme.add(p);
    return insieme;
}

export function permessiDi(ruoli, inPiu = []) {
    if ((ruoli || []).includes('esterno')) return [];
    const insieme = permessiDeiRuoli(ruoli);
    for (const p of inPiu || []) if (CODICI_PERMESSI.includes(p)) insieme.add(p);
    return CODICI_PERMESSI.filter(p => insieme.has(p));
}

export function ruoliConPermesso(codice) {
    return Object.entries(PERMESSI_DEI_RUOLI).filter(([, elenco]) => elenco.includes(codice)).map(([r]) => r);
}

// Restituisce la condizione e i due parametri da accodare.
export function sqlHaPermesso(codice, primoParametro, alias = 'u') {
    const a = primoParametro, b = primoParametro + 1;
    return {
        condizione: `(EXISTS (SELECT 1 FROM utenti_ruoli urp WHERE urp.user_id = ${alias}.id AND urp.ruolo::text = ANY($${a}::text[]))
                      OR (EXISTS (SELECT 1 FROM utenti_permessi upp WHERE upp.user_id = ${alias}.id AND upp.permesso = $${b})
                          AND NOT EXISTS (SELECT 1 FROM utenti_ruoli ure WHERE ure.user_id = ${alias}.id AND ure.ruolo = 'esterno')))`,
        parametri: [ruoliConPermesso(codice), codice]
    };
}

export function mfaRichiesta(ruoli, permessi) {
    return (ruoli || []).includes('admin') || (permessi || []).includes('volontari.sanitario');
}

export function haPermesso(req, ...codici) {
    const miei = req.user?.permessi;
    if (!Array.isArray(miei)) return false;
    return codici.some(c => miei.includes(c));
}

export function richiedePermesso(...codici) {
    return function (req, res, next) {
        if (haPermesso(req, ...codici)) return next();
        const nomi = codici.map(c => PERMESSI.find(p => p.codice === c)?.nome || c);
        const messaggio = `Ti serve il permesso "${nomi.join('" o "')}".`;
        if (req.originalUrl.startsWith('/api')) return res.status(403).json({ message: messaggio, permesso_richiesto: codici });
        return res.status(403).send(`<h1>Accesso negato</h1><p>${messaggio.replace(/[<>&"]/g, '')}</p><p><a href="/centro-operativo.html">Torna al Centro Operativo</a></p>`);
    };
}
