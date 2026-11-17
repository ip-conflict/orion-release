// Le regole della voce che non hanno bisogno di un server: canali per ruolo, parola, contenitore Ogg.
//   node tests/voce-regole.mjs

import crypto from 'crypto';
import { canaliDi, prioritaConsentita } from '../src/voceCanali.js';
import { creaParola } from '../src/voceParola.js';
import { campioniPacchetto, leggiOggOpus, oggInWav, scriviOggOpus } from '../src/voceOgg.js';

let falliti = 0;
const verifica = (descr, ok, dettaglio = '') => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${descr}${ok ? '' : ` -> ${JSON.stringify(dettaglio)}`}`);
    if (!ok) falliti++;
};

const persona = (extra) => ({ id: 1, nome: 'Prova', ruoli: ['volontario'], permessi: [], voce_parla: true, squadra: null, ...extra });
const contesto = { squadre: [{ id: 5, nome_radio: 'Alfa' }, { id: 6, nome_radio: 'Bravo' }], diretti: [{ user_id: 1, nome: 'Prova' }] };
const elenco = (p) => canaliDi(p, contesto).map(c => `${c.id}${c.parla ? '+' : ''}`).sort().join(' ');

console.log('\nCanali');
verifica('fuori squadra non c\'è niente', elenco(persona({ id: 9 })) === '');
verifica('il volontario: la sua squadra, avvisi e generale in ascolto, il suo diretto',
    elenco(persona({ squadra: { id: 5, nome_radio: 'Alfa', coc: false, caposquadra: false } })) === 'avvisi diretto:1+ generale squadra:5+');
verifica('il caposquadra ha anche il generale',
    elenco(persona({ id: 2, squadra: { id: 5, nome_radio: 'Alfa', coc: false, caposquadra: true } })) === 'avvisi generale+ squadra:5+');
verifica('la sala parla su tutte le squadre, sul generale, sugli avvisi e sui diretti',
    elenco(persona({ id: 3, squadra: { id: 1, nome_radio: 'COC', coc: true } })) === 'avvisi+ diretto:1+ generale+ squadra:5+ squadra:6+');
verifica('chi coordina fuori dalla sala: generale, avvisi e diretti, non i canali delle squadre',
    elenco(persona({ id: 4, permessi: ['emergenze.apertura'] })) === 'avvisi+ diretto:1+ generale+');
verifica('l\'esterno con la casella spenta ascolta la squadra ma non parla',
    elenco(persona({ id: 7, ruoli: ['esterno'], voce_parla: false, squadra: { id: 6, nome_radio: 'Bravo', coc: false } })) === 'avvisi generale squadra:6');
verifica('un esterno non coordina anche con i permessi',
    elenco(persona({ id: 8, ruoli: ['esterno'], permessi: ['emergenze.apertura'], squadra: { id: 6, nome_radio: 'Bravo', coc: false } })) === 'avvisi generale squadra:6+');
const volontario = persona({ squadra: { id: 5, coc: false } });
verifica('priorità alta solo per la sala e chi coordina', !prioritaConsentita(volontario, 'squadra:5', 'alta')
    && prioritaConsentita(persona({ squadra: { id: 1, coc: true } }), 'squadra:5', 'alta'));
verifica('l\'emergenza la può mandare chiunque', prioritaConsentita(volontario, 'squadra:5', 'emergenza'));

console.log('\nParola');
let adesso = 0;
const parola = creaParola({ ora: () => adesso });
const chi = (userId, extra = {}) => ({ userId, uuid: crypto.randomUUID(), nome: `P${userId}`, sala: false, priorita: 'normale', ...extra });
const a = chi(1);
verifica('canale libero: si parla', parola.chiedi('c', a).esito === 'parla');
verifica('fra pari vince chi c\'era prima', parola.chiedi('c', chi(2)).esito === 'occupato');
const sala = chi(3, { sala: true });
const r = parola.chiedi('c', sala);
verifica('la sala prende la parola e interrompe il volontario', r.esito === 'parla' && r.interrotto?.uuid === a.uuid);
verifica('un\'altra postazione di sala non interrompe la prima', parola.chiedi('c', chi(4, { sala: true })).esito === 'occupato');
verifica('l\'emergenza passa sopra anche alla sala', parola.chiedi('c', chi(5, { priorita: 'emergenza' })).interrotto?.userId === 3);
adesso = 63_000;
verifica('un tasto rimasto premuto scade dopo il minuto', parola.scadute().length === 1);

console.log('\nContenitore Ogg Opus');
const pacchetti = Array.from({ length: 30 }, () => Buffer.concat([Buffer.from([11 << 3]), crypto.randomBytes(120)]));
const ogg = scriviOggOpus(pacchetti);
const letto = leggiOggOpus(ogg);
verifica('si rilegge con tutti i pacchetti, e con il CRC giusto', letto.pacchetti.length === 30 && letto.pacchetti.every((p, i) => p.equals(pacchetti[i])));
verifica('60 ms per pacchetto, contati dal TOC', campioniPacchetto(pacchetti[0]) === 2880);
verifica('la testa è OpusHead', letto.testa.subarray(0, 8).toString() === 'OpusHead');
const lungo = Buffer.concat([Buffer.from([31 << 3]), crypto.randomBytes(600)]);
verifica('un pacchetto oltre i 255 byte attraversa i segmenti', leggiOggOpus(scriviOggOpus([lungo])).pacchetti[0].equals(lungo));

console.log('\nPer la trascrizione');
{
    // Un pacchetto di solo TOC (SILK, 60 ms) è silenzio valido: il decodificatore ne ricava 960 campioni.
    const silenzio = Array.from({ length: 10 }, () => Buffer.from([11 << 3]));
    const wav = await oggInWav(scriviOggOpus(silenzio));
    verifica('dal contenitore Ogg si ricava un WAV a 16 kHz, mono, 16 bit', wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE'
        && wav.readUInt32LE(24) === 16000 && wav.readUInt16LE(22) === 1 && wav.readUInt16LE(34) === 16, wav.subarray(0, 44));
    verifica('600 ms a 16 kHz: 9600 campioni', wav.readUInt32LE(40) === 9600 * 2, wav.readUInt32LE(40));
}

console.log(falliti ? `\n${falliti} verifiche fallite.` : '\nTutto a posto.');
process.exit(falliti ? 1 : 0);
