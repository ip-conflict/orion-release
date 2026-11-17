// Chi ha la parola su ogni canale. Vive in memoria: se il server riparte, tutti i canali
// ripartono liberi, e un tasto rimasto premuto non resta occupato per sempre.

export const DURATA_MASSIMA_MS = 60_000;
const GRAZIA_MS = 2_000;
const PESO_PRIORITA = { normale: 0, alta: 1, emergenza: 2 };

const peso = (t) => (PESO_PRIORITA[t.priorita] ?? 0) * 2 + (t.sala ? 1 : 0);

export function creaParola({ ora = Date.now } = {}) {
    const canali = new Map();

    // La sala supera un volontario, l'emergenza supera tutto; fra pari vince chi c'era prima.
    function chiedi(canale, chi) {
        const attuale = canali.get(canale);
        const nuovo = { ...chi, dal: ora() };
        if (!attuale || attuale.userId === chi.userId) {
            canali.set(canale, nuovo);
            return { esito: 'parla', interrotto: attuale && attuale.uuid !== chi.uuid ? attuale : null };
        }
        if (peso(nuovo) > peso(attuale)) {
            canali.set(canale, nuovo);
            return { esito: 'parla', interrotto: attuale };
        }
        return { esito: 'occupato', da: attuale };
    }

    function rilascia(canale, uuid) {
        const attuale = canali.get(canale);
        if (!attuale || attuale.uuid !== uuid) return false;
        canali.delete(canale);
        return true;
    }

    function rilasciaDi(userId) {
        const tolti = [];
        for (const [canale, t] of canali) {
            if (t.userId === userId) {
                canali.delete(canale);
                tolti.push({ canale, ...t });
            }
        }
        return tolti;
    }

    function scadute() {
        const limite = ora() - DURATA_MASSIMA_MS - GRAZIA_MS;
        return [...canali].filter(([, t]) => t.dal < limite).map(([canale, t]) => ({ canale, ...t }));
    }

    return {
        chiedi, rilascia, rilasciaDi, scadute,
        di: (canale) => canali.get(canale) || null,
        tutte: () => Object.fromEntries(canali)
    };
}
