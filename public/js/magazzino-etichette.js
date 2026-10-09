// Foglio di etichette QR da stampare su carta adesiva.
//
// Una riga dell'inventario = un'etichetta. Per i DPI questo vuol dire già una
// etichetta per taglia, perché un elmetto taglia M e uno taglia L sono due
// righe diverse: è la stessa distinzione che serve quando si consegna.
//
// Il QR porta l'indirizzo della scheda del bene, non un numero: inquadrandolo
// con la fotocamera del telefono si apre ORION alla pagina giusta, senza
// bisogno di nessuna applicazione; l'app Android legge lo stesso indirizzo e
// apre la scheda del bene.
//
// Cosa si stampa: quello che si stava guardando nell'inventario (tipo e
// ricerca), un bene solo (?ids=, dalla sua scheda) o le taglie di un DPI
// (?modello=). Come: in formato libero da ritagliare, o sulle fustelle dei
// fogli adesivi A4 più comuni, con copie, posizioni già usate da saltare e una
// correzione per le stampanti che spostano tutto di un paio di millimetri.

// Le misure dei fogli adesivi A4 più diffusi (in millimetri): margine in alto
// e a sinistra fino alla prima fustella, e lo spazio fra una fustella e
// l'altra. Sono gli stessi numeri stampati sulla confezione.
const FORMATI = {
    libero: { nome: 'Libero, da ritagliare' },
    'a4-3x8': { nome: 'A4 · 24 da 70 × 37 mm (3 × 8)', colonne: 3, righe: 8, w: 70, h: 37, alto: 0.5, sinistra: 0, spazioX: 0, spazioY: 0 },
    'a4-3x7': { nome: 'A4 · 21 da 70 × 42,3 mm (3 × 7)', colonne: 3, righe: 7, w: 70, h: 42.3, alto: 0.45, sinistra: 0, spazioX: 0, spazioY: 0 },
    'a4-2x7': { nome: 'A4 · 14 da 99,1 × 38,1 mm (2 × 7)', colonne: 2, righe: 7, w: 99.1, h: 38.1, alto: 15.15, sinistra: 4.65, spazioX: 2.5, spazioY: 0 },
    'a4-2x4': { nome: 'A4 · 8 da 99,1 × 67,7 mm (2 × 4)', colonne: 2, righe: 4, w: 99.1, h: 67.7, alto: 13.1, sinistra: 4.65, spazioX: 2.5, spazioY: 0 },
    'a4-4x10': { nome: 'A4 · 40 da 45,7 × 25,4 mm (4 × 10)', colonne: 4, righe: 10, w: 45.7, h: 25.4, alto: 21.5, sinistra: 9.7, spazioX: 2.6, spazioY: 0 }
};

const PREFERENZE = 'orion-etichette';

// Un indirizzo che fuori dalla sede non porta da nessuna parte: stampato nel
// QR, l'adesivo funziona solo sul computer da cui si è stampato.
function indirizzoLocale(host) {
    return host === 'localhost' || host === '[::1]' || host.endsWith('.local') ||
        /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

document.addEventListener('DOMContentLoaded', () => {
    const parametri = new URLSearchParams(window.location.search);
    const $ = (id) => document.getElementById(id);
    const foglio = $('foglio');

    let beni = [];
    const escluse = new Set();
    const immaginiQr = new Map();

    // Le scelte sul formato valgono anche la prossima volta: chi ha i fogli
    // da 70 × 37 li ha sempre quelli, e la correzione è della sua stampante.
    function leggiPreferenze() {
        try { return JSON.parse(localStorage.getItem(PREFERENZE)) || {}; } catch { return {}; }
    }
    function salvaPreferenze() {
        try {
            localStorage.setItem(PREFERENZE, JSON.stringify({
                formato: $('formato').value, dimensione: $('dimensione').value,
                x: $('correzione-x').value, y: $('correzione-y').value
            }));
        } catch { /* senza memoria del browser si riparte dai valori di sempre */ }
    }

    Object.entries(FORMATI).forEach(([chiave, f]) => {
        const o = document.createElement('option');
        o.value = chiave;
        o.textContent = f.nome;
        $('formato').appendChild(o);
    });
    const salvate = leggiPreferenze();
    if (FORMATI[salvate.formato]) $('formato').value = salvate.formato;
    if (salvate.dimensione) $('dimensione').value = salvate.dimensione;
    $('correzione-x').value = salvate.x || 0;
    $('correzione-y').value = salvate.y || 0;

    if (indirizzoLocale(window.location.hostname)) {
        $('avviso-indirizzo').hidden = false;
        $('avviso-indirizzo').textContent =
            `Stai stampando da ${window.location.origin}: è l'indirizzo che finisce nei QR. ` +
            'Un telefono fuori da questa rete non lo raggiunge, e l\'app Android scarta le etichette ' +
            'di un indirizzo diverso da quello con cui è collegata. Apri questa pagina dall\'indirizzo ' +
            'che usano tutti (lo stesso configurato nell\'app) e stampa da lì.';
    }

    function indirizzoScheda(bene) {
        // Con il codice e non con l'id: se domani il magazzino viene
        // ricostruito da un salvataggio, gli id possono cambiare, il codice
        // stampato sull'adesivo no.
        return `${window.location.origin}/magazzino.html?e=${encodeURIComponent(bene.codice_etichetta || '')}`;
    }

    // Un'immagine per bene, riusata per tutte le copie e a ogni ridisegno.
    function immagineQr(bene) {
        if (immaginiQr.has(bene.id)) return immaginiQr.get(bene.id);
        const appoggio = document.createElement('div');
        // La correzione d'errore alta serve davvero: questi adesivi finiscono
        // su una motosega, e un angolo sporco di resina non deve rendere
        // illeggibile il codice.
        new QRCode(appoggio, {
            text: indirizzoScheda(bene),
            width: 256, height: 256,
            colorDark: '#000000', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
        const tela = appoggio.querySelector('canvas');
        const src = tela ? tela.toDataURL('image/png') : (appoggio.querySelector('img') || {}).src;
        immaginiQr.set(bene.id, src);
        return src;
    }

    function descrivi(bene) {
        const pezzi = [];
        if (bene.matricola) pezzi.push(bene.matricola);
        if (bene.taglia) pezzi.push(`taglia ${bene.taglia}`);
        if (bene.categoria) pezzi.push(bene.categoria);
        return pezzi.join(' · ');
    }

    function etichetta(bene, latoQr) {
        const e = document.createElement('div');
        e.className = 'etichetta' + (escluse.has(bene.id) ? ' esclusa' : '');
        e.title = escluse.has(bene.id) ? 'Tolta dal foglio: tocca per rimetterla' : 'Tocca per toglierla dal foglio';

        const qr = document.createElement('div');
        qr.className = 'qr';
        const img = document.createElement('img');
        img.alt = `QR ${bene.codice_etichetta}`;
        img.src = immagineQr(bene);
        img.style.width = latoQr;
        img.style.height = latoQr;
        qr.appendChild(img);

        const testo = document.createElement('div');
        testo.className = 'testo';
        const nome = document.createElement('div');
        nome.className = 'nome';
        nome.textContent = bene.denominazione;
        const dettaglio = document.createElement('div');
        dettaglio.className = 'dettaglio';
        dettaglio.textContent = descrivi(bene);
        const codice = document.createElement('div');
        codice.className = 'codice';
        codice.textContent = bene.codice_etichetta;
        // Nelle etichette piccole il dettaglio sparisce: la taglia no, sta col nome.
        if (bene.taglia) nome.dataset.taglia = bene.taglia;
        testo.append(nome, dettaglio, codice);

        e.append(qr, testo);
        e.addEventListener('click', () => {
            if (escluse.has(bene.id)) escluse.delete(bene.id); else escluse.add(bene.id);
            disegna();
        });
        return e;
    }

    function disegna() {
        const formato = FORMATI[$('formato').value] || FORMATI.libero;
        const suFoglio = !!formato.colonne;
        const copie = Math.min(50, Math.max(1, parseInt($('copie').value, 10) || 1));
        const stampabili = beni.filter(b => b.codice_etichetta);

        $('campo-dimensione').hidden = suFoglio;
        $('campo-salta').hidden = !suFoglio;
        $('campo-correzione').hidden = !suFoglio;
        $('btn-includi-tutte').hidden = escluse.size === 0;
        $('avviso-formato').hidden = !suFoglio;
        $('avviso-formato').textContent = suFoglio
            ? 'Nella finestra di stampa scegli scala 100% («Dimensioni effettive») e margini «Nessuno»: ' +
              'altrimenti le etichette scivolano rispetto alle fustelle. La prima volta stampa su un foglio ' +
              'normale e sovrapponilo controluce a quello adesivo; se è tutto spostato, usa la correzione.'
            : '';
        $('stile-pagina').textContent = suFoglio
            ? '@media print { @page { size: A4; margin: 0; } }'
            : '@media print { @page { size: A4; margin: 8mm; } }';

        foglio.innerHTML = '';
        foglio.className = 'foglio' + (suFoglio ? '' : ' libero');

        if (stampabili.length === 0) {
            foglio.innerHTML = '<p class="vuoto">Nessun bene da etichettare con questi criteri.</p>';
            $('conteggio').textContent = '';
            return;
        }

        // Ogni bene tante volte quante le copie, uno di seguito all'altro:
        // le copie dello stesso oggetto stanno vicine sul foglio.
        const coda = [];
        stampabili.forEach(b => {
            const volte = escluse.has(b.id) ? 1 : copie;
            for (let i = 0; i < volte; i++) coda.push(b);
        });
        const daStampare = coda.filter(b => !escluse.has(b.id)).length;

        if (!suFoglio) {
            const lato = `${parseInt($('dimensione').value, 10) || 90}px`;
            coda.forEach(b => foglio.appendChild(etichetta(b, lato)));
            $('conteggio').textContent = `${daStampare} etichett${daStampare === 1 ? 'a' : 'e'}`;
            return;
        }

        // Sulle fustelle una tolta non occupa posto: la pagina a schermo è
        // quella che uscirà dalla stampante. Le tolte si vedono sotto, per
        // poterle rimettere.
        const perPagina = formato.colonne * formato.righe;
        $('salta').max = perPagina - 1;
        const salta = Math.min(perPagina - 1, Math.max(0, parseInt($('salta').value, 10) || 0));
        const celle = [...Array(salta).fill(null), ...coda.filter(b => !escluse.has(b.id))];
        const dx = Number($('correzione-x').value) || 0;
        const dy = Number($('correzione-y').value) || 0;
        const latoQr = `${Math.min(formato.h - 4, formato.w * 0.46).toFixed(1)}mm`;
        const taglia = formato.h < 30 ? ' piccole' : formato.h < 45 ? ' medie' : '';

        let pagine = 0;
        for (let inizio = 0; inizio < celle.length; inizio += perPagina) {
            const pagina = document.createElement('div');
            pagina.className = 'pagina' + taglia;
            pagina.style.position = 'relative';
            const griglia = document.createElement('div');
            Object.assign(griglia.style, {
                position: 'absolute',
                left: `${formato.sinistra + dx}mm`,
                top: `${formato.alto + dy}mm`,
                display: 'grid',
                gridTemplateColumns: `repeat(${formato.colonne}, ${formato.w}mm)`,
                gridTemplateRows: `repeat(${formato.righe}, ${formato.h}mm)`,
                columnGap: `${formato.spazioX}mm`,
                rowGap: `${formato.spazioY}mm`
            });
            celle.slice(inizio, inizio + perPagina).forEach(b => {
                const cella = document.createElement('div');
                cella.className = 'cella' + (b ? '' : ' saltata');
                if (b) cella.appendChild(etichetta(b, latoQr));
                else cella.title = 'Posizione già usata: resta vuota';
                griglia.appendChild(cella);
            });
            pagina.appendChild(griglia);
            foglio.appendChild(pagina);
            pagine++;
        }

        const tolte = stampabili.filter(b => escluse.has(b.id));
        if (tolte.length) {
            const riquadro = document.createElement('div');
            riquadro.className = 'foglio libero solo-schermo';
            const titolo = document.createElement('p');
            titolo.style.gridColumn = '1 / -1';
            titolo.style.margin = '8px 0 0';
            titolo.textContent = `Tolte dal foglio (${tolte.length}): tocca per rimetterle`;
            riquadro.appendChild(titolo);
            tolte.forEach(b => riquadro.appendChild(etichetta(b, '60px')));
            foglio.appendChild(riquadro);
        }

        $('conteggio').textContent = `${daStampare} etichett${daStampare === 1 ? 'a' : 'e'} su ${pagine} fogl${pagine === 1 ? 'io' : 'i'}`;
    }

    // Le taglie di un DPI nell'ordine del modello (S, M, L…), non in quello
    // in cui sono state caricate la prima volta.
    function ordinaTaglie(elenco, modelli) {
        const ordine = new Map(modelli.map(m => [m.id, m.taglie.map(t => t.toLowerCase())]));
        const posto = (b) => {
            const i = (ordine.get(b.modello_id) || []).indexOf(String(b.taglia || '').toLowerCase());
            return i < 0 ? Number.MAX_SAFE_INTEGER : i;
        };
        const risultato = [];
        const fatti = new Set();
        elenco.forEach(b => {
            if (!b.modello_id) { risultato.push(b); return; }
            if (fatti.has(b.modello_id)) return;
            fatti.add(b.modello_id);
            risultato.push(...elenco.filter(x => x.modello_id === b.modello_id).sort((a, c) => posto(a) - posto(c)));
        });
        return risultato;
    }

    ['formato', 'dimensione', 'correzione-x', 'correzione-y'].forEach(id =>
        $(id).addEventListener('change', () => { salvaPreferenze(); disegna(); }));
    ['copie', 'salta'].forEach(id => $(id).addEventListener('input', disegna));
    $('btn-includi-tutte').addEventListener('click', () => { escluse.clear(); disegna(); });
    $('btn-stampa').addEventListener('click', () => window.print());

    (async () => {
        try {
            // Gli stessi filtri dell'inventario, passati nell'indirizzo: si
            // stampa quello che si stava guardando, non tutto il magazzino.
            const soloQuesti = (parametri.get('ids') || '')
                .split(',').map(n => parseInt(n, 10)).filter(Boolean);
            const modello = parseInt(parametri.get('modello'), 10) || null;
            const richiesta = new URLSearchParams();
            if (modello) richiesta.set('tipo', 'dpi');
            else if (!soloQuesti.length) {
                if (parametri.get('tipo')) richiesta.set('tipo', parametri.get('tipo'));
                if (parametri.get('q')) richiesta.set('q', parametri.get('q'));
            }

            const [tutti, modelli] = await Promise.all([
                fetchApi(`/api/magazzino/beni?${richiesta.toString()}`),
                fetchApi('/api/magazzino/modelli?nascosti=1').catch(() => [])
            ]);
            let scelti = tutti;
            if (soloQuesti.length) scelti = tutti.filter(b => soloQuesti.includes(b.id));
            else if (modello) scelti = tutti.filter(b => b.modello_id === modello);
            const categoria = parametri.has('categoria') ? parseInt(parametri.get('categoria'), 10) : null;
            if (!soloQuesti.length && !modello && categoria !== null && !Number.isNaN(categoria)) {
                scelti = scelti.filter(b => categoria === 0 ? !b.categoria_id : b.categoria_id === categoria);
            }
            beni = ordinaTaglie(scelti, modelli);
            disegna();
        } catch (e) {
            foglio.innerHTML = '';
            const p = document.createElement('p');
            p.className = 'vuoto';
            p.textContent = `Non riesco a leggere l'inventario: ${e.message}`;
            foglio.appendChild(p);
        }
    })();
});
