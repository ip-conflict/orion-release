// Regole delle password nuove, uguali dappertutto: oltre alla forma si rifiutano parole
// comuni con numeri e simboli, i propri dati e i caratteri ripetuti.

export const REGOLA_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|\\;:'",.<>\/?~]).{12,}$/;
const LUNGHEZZA_MASSIMA = 128;

const COMUNI = new Set(`
password passw passwd pass parola parolachiave segreto segreta chiave accesso accedi login entra benvenuto benvenuta
admin administrator amministratore amministrazione root utente user guest test prova demo sistema system
qwerty qwertyuiop qwertz azerty asdfgh asdfghjkl zxcvbn zxcvbnm qazwsx qwertyu abcdef abcdefgh abcdefghi
ciao ciaociao amore amoremio tiamo teamo ciaobella bella bello cucciolo tesoro stella sole luna mare cielo
principessa principe angelo angela dragon drago monkey scimmia gatto cane micio pippo pluto topolino
juventus juve inter milan roma lazio napoli torino fiorentina forzajuve forzainter forzamilan forzanapoli
calcio football soccer baseball basket pallavolo
italia italiano italiana venezia veneto milano roma torino bologna firenze genova verona padova belluno treviso vicenza
dolomiti montagna alpini
protezione protezionecivile civile protciv volontario volontaria volontari volontariato emergenza emergenze
soccorso soccorritore pompiere pompieri vigili vigilidelfuoco croce croceverde crocerossa ambulanza sanitario
orion orionpc orionmobile coordinamento sala salaoperativa comune comunale squadra squadre radio
sunshine shadow master superman batman iloveyou letmein welcome hello freedom whatever trustno trustnoone
football princess charlie michael jennifer jordan hunter ranger buster soccer harley
gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre
lunedi martedi mercoledi giovedi venerdi sabato domenica estate inverno primavera autunno natale pasqua
`.split(/\s+/).filter(Boolean));

const SOSTITUZIONI = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i', '€': 'e' };

function letteraleDi(testo) {
    return [...String(testo).toLowerCase()].map(c => SOSTITUZIONI[c] ?? c)
        .join('').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

export function controllaPassword(password, persona = {}) {
    if (typeof password !== 'string' || !password) return 'Serve una password.';
    if (password.length > LUNGHEZZA_MASSIMA) return `La password può avere al massimo ${LUNGHEZZA_MASSIMA} caratteri.`;
    if (!REGOLA_PASSWORD.test(password)) {
        return 'La password deve avere almeno 12 caratteri, con maiuscole, minuscole, un numero e un simbolo.';
    }
    if (new Set(password.toLowerCase()).size < 6) return 'La password ripete troppo gli stessi caratteri: usane di più diversi.';

    // Tre letture: con le sostituzioni, senza numeri e simboli in testa e in coda
    // ("Juventus1897!"), con le sole lettere.
    const lettere = letteraleDi(password);
    const varianti = new Set([
        lettere,
        letteraleDi(password.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')),
        letteraleDi(password.replace(/[^\p{L}]/gu, ''))
    ]);
    if (lettere.length < 4) return 'La password è troppo facile da indovinare: ha troppo poche lettere. Usa una frase o più parole che non stanno insieme.';
    for (const variante of varianti) {
        const ripetuta = variante.match(/^(.+?)\1+$/)?.[1];
        if (COMUNI.has(variante) || (ripetuta && COMUNI.has(ripetuta))) {
            return 'La password è troppo facile da indovinare: è una parola comune con numeri e simboli. Usa una frase o più parole che non stanno insieme.';
        }
        for (const parola of COMUNI) {
            if (parola.length >= 6 && variante.includes(parola) && parola.length >= variante.length - 3) {
                return 'La password è troppo facile da indovinare: è quasi tutta una parola comune. Usa una frase o più parole che non stanno insieme.';
            }
        }
    }
    const propri = [persona.username, persona.nome, persona.cognome, String(persona.email || '').split('@')[0]]
        .map(letteraleDi).filter(p => p.length >= 4);
    if (propri.some(p => [...varianti].some(v => v.includes(p)))) return 'La password non deve contenere il tuo nome, cognome o nome utente.';
    return null;
}
