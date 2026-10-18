// Il registro delle operazioni può scadere: una cancellazione dichiarata (orion.scadenza_registro)
// e annotata nella catena, come quella di un'emergenza. Le funzioni sono quelle dello storico
// inalterabile, lette dalla sua migrazione e cambiate solo in questi due punti.

const storico = require('./1792108800000_storico-inalterabile.cjs');

const CONSENTI_EMERGENZA = "IF coalesce(current_setting('orion.cancellazione_emergenza', true), '') <> '' THEN RETURN OLD; END IF;";
const TOLTE_EMERGENZA = "c.evento = ''cancellazione_emergenza''";

function funzioniDelloStorico() {
    const parti = [];
    storico.up({ sql: (s) => parti.push(s) });
    const tutto = parti[0];
    const funzione = (nome) => {
        const inizio = tutto.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
        const fine = tutto.indexOf('END $$;', inizio) + 'END $$;'.length;
        if (inizio < 0 || fine < inizio) throw new Error(`Funzione ${nome} non trovata nello storico inalterabile.`);
        return tutto.slice(inizio, fine);
    };
    return { verifica: funzione('orion_verifica'), blocco: funzione('orion_storico_immutabile') };
}

function sostituisci(testo, prima, dopo) {
    if (!testo.includes(prima)) throw new Error(`Testo atteso non trovato: ${prima}`);
    return testo.replace(prima, dopo);
}

exports.up = (pgm) => {
    const { verifica, blocco } = funzioniDelloStorico();
    pgm.sql(sostituisci(verifica, TOLTE_EMERGENZA, "c.evento IN (''cancellazione_emergenza'', ''scadenza_registro'')"));
    pgm.sql(sostituisci(blocco, CONSENTI_EMERGENZA, `${CONSENTI_EMERGENZA}
                IF TG_TABLE_NAME = 'audit_log' AND coalesce(current_setting('orion.scadenza_registro', true), '') <> '' THEN RETURN OLD; END IF;`));
};

exports.down = (pgm) => {
    const { verifica, blocco } = funzioniDelloStorico();
    pgm.sql(verifica);
    pgm.sql(blocco);
};
