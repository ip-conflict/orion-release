// public/js/tesserino.js
//
// Il tesserino da divisa (formato CR80, 86x54 mm, cioè 243x153 punti PDF),
// disegnato da un modello che l'amministratore può personalizzare: i colori
// delle fasce e delle scritte, i due testi fissi, e se vuole la posizione e la
// dimensione di ogni elemento.
//
// Il disegno si calcola una volta sola, come elenco di forme (rettangoli,
// testi, immagini, QR, barre), e poi si traduce in due modi: in pdfMake per la
// stampa e in SVG per l'anteprima del configuratore. Così quello che si vede
// nel configuratore è quello che esce dalla stampante.
//
// Il modello:
//   { colori: { fascia_alta: '#0b1f3a', ... },
//     testi: { titolo: 'PROTEZIONE CIVILE', qualifica: 'VOLONTARIO' },
//     posizioni: null | { qr: { x, y, w, h }, ... },
//     nascosti: ['bandiera_ue', ...] }
// Con posizioni null gli elementi si dispongono da soli e si adattano a quello
// che c'è (QR, codice fiscale, nome dell'ente); con posizioni salvate restano
// dove li ha messi l'amministratore, e quello che manca lascia il suo spazio.
//
// Va caricato dopo pdfmake e vfs_fonts (per i caratteri) e codice-barre.js.

(function () {
    const W = 243, H = 153;
    // Un punto di una stampante per tesserini a 300 dpi.
    const PUNTO = 72 / 300;
    // Code 128 di un codice fiscale: 16 caratteri, sempre 211 moduli, più
    // dieci moduli bianchi per lato perché il lettore trovi l'inizio.
    const MODULI_CF = 211, RISPETTO = 10;
    // Roboto, il carattere di pdfMake: altezza della riga e linea di base.
    const RIGA = 1.2, ASCESA = 0.928;

    const COLORI = {
        sfondo: '#ffffff',
        fascia_alta: '#0b1f3a',
        fascia_ente: '#0f505e',
        fascia_qualifica: '#ffcc00',
        nome: '#f4c430',
        distretto: '#ffffff',
        titolo: '#0b1f3a',
        ente: '#ffffff',
        qualifica: '#0b1f3a'
    };
    const NOMI_COLORI = {
        sfondo: 'Sfondo', fascia_alta: 'Fascia in alto', fascia_ente: "Fascia dell'ente", fascia_qualifica: 'Fascia della qualifica',
        nome: 'Nome', distretto: 'Distretto', titolo: 'Scritta centrale', ente: "Nome dell'ente", qualifica: 'Qualifica'
    };
    const TESTI = { titolo: 'PROTEZIONE CIVILE', qualifica: 'VOLONTARIO' };

    // Gli elementi, nell'ordine in cui si disegnano (i primi stanno sotto).
    // min: la dimensione sotto cui non si scende (in punti); nascondibile: si
    // può togliere dal tesserino; colori: quelli che lo riguardano.
    const ELEMENTI = [
        { id: 'fascia_alta', nome: 'Fascia in alto', fascia: true, min: [20, 6], nascondibile: true, colori: ['fascia_alta'] },
        { id: 'fascia_ente', nome: "Fascia dell'ente", fascia: true, min: [20, 6], nascondibile: true, colori: ['fascia_ente'] },
        { id: 'fascia_qualifica', nome: 'Fascia della qualifica', fascia: true, min: [20, 6], nascondibile: true, colori: ['fascia_qualifica'] },
        { id: 'foto', nome: 'Foto', min: [34, 40], colori: [] },
        { id: 'qr', nome: 'QR di verifica', min: [38, 38], quadrato: true, colori: [] },
        { id: 'titolo', nome: 'Scritta centrale', min: [20, 6], nascondibile: true, colori: ['titolo'], testo: 'titolo' },
        { id: 'loghi', nome: 'Loghi', min: [16, 12], nascondibile: true, colori: [] },
        { id: 'codice', nome: 'Codice fiscale (codice a barre)', min: [(MODULI_CF + 2 * RISPETTO) * 3 * PUNTO, 16], colori: [] },
        { id: 'nome', nome: 'Nome e cognome', min: [30, 7], colori: ['nome'] },
        { id: 'distretto', nome: 'Distretto', min: [20, 5], nascondibile: true, colori: ['distretto'] },
        { id: 'ente', nome: "Nome dell'ente", min: [20, 5], nascondibile: true, colori: ['ente'] },
        { id: 'qualifica', nome: 'Qualifica', min: [20, 6], nascondibile: true, colori: ['qualifica'], testo: 'qualifica' },
        { id: 'bandiera_it', nome: 'Bandiera italiana', min: [9, 6], nascondibile: true, colori: [] },
        { id: 'bandiera_ue', nome: 'Bandiera europea', min: [9, 6], nascondibile: true, colori: [] }
    ];
    const PER_ID = Object.fromEntries(ELEMENTI.map(e => [e.id, e]));

    // Le posizioni automatiche: il layout A, con QR e loghi in alto e sotto il
    // codice a barre largo quanto lo spazio a sinistra della foto. Senza QR la
    // colonna centrale si allarga; senza codice fiscale QR e loghi prendono
    // tutta la zona bianca.
    function automatiche(v) {
        const NAVY_H = 32, TEAL_Y = 104, TEAL_H = 18, YELLOW_Y = 122;
        const BIANCO_Y = NAVY_H, BIANCO_H = TEAL_Y - NAVY_H;
        const FOTO_W = 55, FOTO_H = 66, FOTO_X = W - 8 - FOTO_W, FOTO_Y = BIANCO_Y + (BIANCO_H - FOTO_H) / 2;
        const B_W = 27, B_H = 18, B_Y = YELLOW_Y + (H - YELLOW_Y - B_H) / 2, ITA_X = 10, UE_X = W - 10 - B_W;
        const zona = v.codice ? { y: BIANCO_Y + 3, h: 44 } : { y: BIANCO_Y, h: BIANCO_H };
        const QR = v.codice ? 44 : 58, QR_X = 8, QR_Y = zona.y + (zona.h - QR) / 2;
        const cx = v.qr ? QR_X + QR + 4 : 8, cw = FOTO_X - 6 - cx;
        const ts = Math.min(v.qr ? (v.codice ? 11 : 12) : (v.codice ? 12.5 : 15), cw / 9.3);
        const lato = v.qr ? (v.codice ? 27 : 36) : (v.codice ? 25 : 42);
        const cy = zona.y + (zona.h - (ts * RIGA + 5 + lato)) / 2;
        return {
            fascia_alta: { x: 0, y: 0, w: W, h: NAVY_H },
            fascia_ente: { x: 0, y: TEAL_Y, w: W, h: TEAL_H },
            fascia_qualifica: { x: 0, y: YELLOW_Y, w: W, h: H - YELLOW_Y },
            foto: { x: FOTO_X, y: FOTO_Y, w: FOTO_W, h: FOTO_H },
            qr: { x: QR_X, y: QR_Y, w: QR, h: QR },
            titolo: { x: cx, y: cy, w: cw, h: ts * RIGA },
            loghi: { x: cx, y: cy + ts * RIGA + 5, w: cw, h: lato },
            codice: { x: 4, y: zona.y + zona.h + 3, w: FOTO_X - 2 - 4, h: 21.6 },
            nome: { x: 8, y: 4.5, w: W - 16, h: 13 * RIGA },
            distretto: { x: 8, y: 19.5, w: W - 16, h: 7.5 * RIGA },
            ente: { x: 8, y: TEAL_Y + 4, w: W - 16, h: 9 * RIGA },
            qualifica: { x: ITA_X + B_W + 4, y: B_Y, w: UE_X - ITA_X - B_W - 8, h: 15 * RIGA },
            bandiera_it: { x: ITA_X, y: B_Y, w: B_W, h: B_H },
            bandiera_ue: { x: UE_X, y: B_Y, w: B_W, h: B_H }
        };
    }

    // ---- Il modello: si accetta solo quello che ha senso ----------------------

    const COLORE = /^#[0-9a-f]{6}$/i;
    function normalizza(grezzo) {
        let m = grezzo;
        if (typeof m === 'string') { try { m = m.trim() ? JSON.parse(m) : {}; } catch { m = {}; } }
        if (!m || typeof m !== 'object' || Array.isArray(m)) m = {};
        const colori = { ...COLORI };
        for (const k of Object.keys(COLORI)) if (COLORE.test(m.colori?.[k] || '')) colori[k] = m.colori[k].toLowerCase();
        const testi = { ...TESTI };
        for (const k of Object.keys(TESTI)) {
            const t = m.testi?.[k];
            if (typeof t === 'string' && t.trim() && t.length <= 40) testi[k] = t.trim();
        }
        let posizioni = null;
        if (m.posizioni && typeof m.posizioni === 'object') {
            posizioni = {};
            for (const e of ELEMENTI) {
                const p = m.posizioni[e.id];
                if (!p || ![p.x, p.y, p.w, p.h].every(Number.isFinite)) continue;
                const w = Math.min(W, Math.max(e.min[0], p.w)), h = Math.min(H, Math.max(e.min[1], p.h));
                posizioni[e.id] = {
                    x: Math.min(W - w, Math.max(0, p.x)), y: Math.min(H - h, Math.max(0, p.y)),
                    w: e.quadrato ? Math.min(w, h) : w, h: e.quadrato ? Math.min(w, h) : h
                };
            }
            if (!Object.keys(posizioni).length) posizioni = null;
        }
        const nascosti = Array.isArray(m.nascosti) ? [...new Set(m.nascosti.filter(id => PER_ID[id]?.nascondibile))] : [];
        return { colori, testi, posizioni, nascosti };
    }

    // ---- Misura dei testi, con lo stesso carattere del PDF ----------------------

    let misuratore = null;
    let pronto = null;
    function caratteri() {
        if (pronto) return pronto;
        pronto = (async () => {
            // vfs_fonts.js dichiara i caratteri in una variabile globale "vfs";
            // pdfMake 0.2 li copia dentro di sé senza esporli.
            const vfs = window.pdfMake?.vfs || window.vfs;
            if (!vfs || typeof FontFace === 'undefined') return false;
            const carica = async (famiglia, file) => {
                const dati = vfs[file];
                if (!dati) return false;
                const byte = Uint8Array.from(atob(typeof dati === 'string' ? dati : ''), c => c.charCodeAt(0));
                const f = new FontFace(famiglia, byte.buffer);
                await f.load();
                document.fonts.add(f);
                return true;
            };
            try {
                const ok = await carica('OrionTesserinoMedium', 'Roboto-Medium.ttf') && await carica('OrionTesserinoRegular', 'Roboto-Regular.ttf');
                if (ok) misuratore = document.createElement('canvas').getContext('2d');
                return ok;
            } catch { return false; }
        })();
        return pronto;
    }
    // Larghezza del testo a un punto di corpo, in punti.
    function larghezza(testo, grassetto) {
        if (!misuratore) return testo.length * (grassetto ? 0.64 : 0.56);
        misuratore.font = `100px ${grassetto ? 'OrionTesserinoMedium' : 'OrionTesserinoRegular'}`;
        return misuratore.measureText(testo).width / 100;
    }

    // ---- Il disegno -----------------------------------------------------------

    // Un testo su una riga, il più grande che sta nel riquadro.
    function testo(p, contenuto, o) {
        const spazio = o.spaziatura || 0;
        const perPunto = larghezza(contenuto, o.grassetto) + spazio * contenuto.length;
        const corpo = Math.max(1, Math.min(p.h / RIGA, perPunto > 0 ? p.w / perPunto : p.h));
        return { tipo: 'testo', x: p.x, y: p.y + (p.h - corpo * RIGA) / 2, w: p.w, h: corpo * RIGA, corpo, testo: contenuto,
            colore: o.colore, grassetto: !!o.grassetto, allinea: o.allinea || 'center', spaziatura: spazio * corpo };
    }

    function segnapostoFoto(p) {
        // La sagoma: testa e spalle, le spalle tagliate al bordo del riquadro.
        const cx = p.x + p.w / 2, cy = p.y + p.h * (68 / 66), r = p.w * 0.4;
        const a0 = Math.asin(Math.max(-1, Math.min(1, (p.y + p.h - cy) / r)));
        const punti = Array.from({ length: 41 }, (_, k) => {
            const a = Math.PI - a0 + (k / 40) * (Math.PI + 2 * a0);
            return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        });
        return [
            { tipo: 'rett', x: p.x, y: p.y, w: p.w, h: p.h, colore: '#e2e8f0' },
            { tipo: 'ellisse', cx, cy: p.y + p.h * (24 / 66), rx: p.w * 0.2, ry: p.h * (12 / 66), colore: '#94a3b8' },
            { tipo: 'poligono', punti, colore: '#94a3b8' }
        ];
    }

    function bandiera(p, europea) {
        // Proporzioni ufficiali 3:2, centrata nel riquadro.
        const w = Math.min(p.w, p.h * 1.5), h = w / 1.5, x = p.x + (p.w - w) / 2, y = p.y + (p.h - h) / 2;
        if (!europea) return [
            { tipo: 'rett', x, y, w: w / 3, h, colore: '#009246' },
            { tipo: 'rett', x: x + w / 3, y, w: w / 3, h, colore: '#ffffff' },
            { tipo: 'rett', x: x + 2 * w / 3, y, w: w / 3, h, colore: '#ce2b37' }
        ];
        // Dodici stelle d'oro su un cerchio di raggio un terzo dell'altezza,
        // ognuna larga un nono dell'altezza, con una punta verso l'alto.
        const stella = (sx, sy, r) => ({
            tipo: 'poligono', colore: '#ffcc00',
            punti: Array.from({ length: 10 }, (_, k) => {
                const raggio = k % 2 === 0 ? r : r * 0.382, a = -Math.PI / 2 + (k * Math.PI) / 5;
                return [sx + raggio * Math.cos(a), sy + raggio * Math.sin(a)];
            })
        });
        return [
            { tipo: 'rett', x, y, w, h, colore: '#003399' },
            ...Array.from({ length: 12 }, (_, k) => {
                const a = (Math.PI * 2 * k) / 12 - Math.PI / 2;
                return stella(x + w / 2 + (h / 3) * Math.cos(a), y + h / 2 + (h / 3) * Math.sin(a), h / 18);
            })
        ];
    }

    function codiceBarre(p, cf) {
        const barre = window.codice128(cf);
        const corpoTesto = Math.min(9, Math.max(4.5, p.h * 0.255));
        const altezza = Math.max(4, p.h - corpoTesto * RIGA - 1);
        // Ogni modulo un numero intero di punti della stampante: barre nette.
        const modulo = Math.max(1, Math.min(5, Math.floor(p.w / (barre.moduli + 2 * RISPETTO) / PUNTO))) * PUNTO;
        const inizio = Math.round((p.x + (p.w - barre.moduli * modulo) / 2) / PUNTO) * PUNTO;
        const margine = RISPETTO * modulo;
        return [
            // Sempre su bianco, con il suo margine: su un colore il lettore non
            // legge. Il bianco copre le barre e i margini, non tutto il riquadro.
            { tipo: 'rett', x: inizio - margine, y: p.y, w: barre.moduli * modulo + 2 * margine, h: p.h, colore: '#ffffff' },
            { tipo: 'barre', x: inizio, y: p.y, h: altezza, modulo, barre },
            { tipo: 'testo', x: p.x, y: p.y + altezza + 1, w: p.w, h: corpoTesto * RIGA, corpo: corpoTesto, testo: cf,
                colore: '#0f172a', grassetto: true, allinea: 'center', spaziatura: corpoTesto * 0.25 }
        ];
    }

    // Che cosa c'è su questo tesserino: dipende dai dati e dalle impostazioni.
    function varianti(dati) {
        return { qr: !!dati.qr, codice: !!dati.cf, ente: !!String(dati.ente || '').trim() };
    }

    // Dove sta ogni elemento, per questi dati.
    function posizioni(modello, v) {
        const m = normalizza(modello);
        if (!m.posizioni) return automatiche(v);
        return { ...automatiche({ qr: true, codice: true, ente: true }), ...m.posizioni };
    }

    // Le forme del tesserino, dal basso verso l'alto.
    //   dati: { nome, distretto, ente, qualifica?, foto (dataURL)?, qr (indirizzo)?,
    //           qrImmagine (dataURL, solo anteprima)?, cf?, loghi: [dataURL...] }
    function componi(modello, dati) {
        const m = normalizza(modello);
        const v = varianti(dati);
        const pos = posizioni(m, v);
        const c = m.colori;
        const visibile = (id) => !m.nascosti.includes(id);
        const forme = [{ tipo: 'rett', x: 0, y: 0, w: W, h: H, colore: c.sfondo, sfondo: true }];
        const aggiungi = (id, ...f) => f.flat().forEach(x => forme.push({ ...x, elemento: id }));
        const nome = String(dati.nome || '').trim().toUpperCase();
        const distretto = String(dati.distretto || '').trim();
        const ente = String(dati.ente || '').trim().toUpperCase();
        const loghi = (dati.loghi || []).filter(Boolean);

        for (const e of ELEMENTI) {
            const p = pos[e.id];
            if (!p || !visibile(e.id)) continue;
            switch (e.id) {
                case 'fascia_alta': case 'fascia_qualifica':
                    aggiungi(e.id, { tipo: 'rett', ...p, colore: c[e.id], sfondo: true }); break;
                case 'fascia_ente':
                    if (v.ente) aggiungi(e.id, { tipo: 'rett', ...p, colore: c.fascia_ente, sfondo: true }); break;
                case 'foto':
                    aggiungi(e.id, dati.foto ? { tipo: 'immagine', ...p, src: dati.foto, riempi: true } : segnapostoFoto(p)); break;
                case 'qr': if (v.qr) {
                    const lato = Math.min(p.w, p.h), x = p.x + (p.w - lato) / 2, y = p.y + (p.h - lato) / 2;
                    aggiungi(e.id, { tipo: 'rett', x: x - 2, y: y - 2, w: lato + 4, h: lato + 4, colore: '#ffffff' },
                        { tipo: 'qr', x, y, lato, valore: dati.qr, immagine: dati.qrImmagine });
                } break;
                case 'titolo':
                    aggiungi(e.id, testo(p, m.testi.titolo, { colore: c.titolo, grassetto: true })); break;
                case 'loghi': if (loghi.length) {
                    const n = loghi.length, lato = Math.min(p.h, p.w / (n + 0.3 * (n - 1))), spazio = lato * 0.3;
                    const x0 = p.x + (p.w - (n * lato + (n - 1) * spazio)) / 2, y0 = p.y + (p.h - lato) / 2;
                    aggiungi(e.id, loghi.map((src, i) => ({ tipo: 'immagine', x: x0 + i * (lato + spazio), y: y0, w: lato, h: lato, src })));
                } break;
                case 'codice':
                    if (v.codice && typeof window.codice128 === 'function') aggiungi(e.id, codiceBarre(p, dati.cf)); break;
                case 'nome':
                    if (nome) aggiungi(e.id, testo(p, nome, { colore: c.nome, grassetto: true, allinea: 'left' })); break;
                case 'distretto':
                    if (distretto) aggiungi(e.id, testo(p, distretto, { colore: c.distretto, allinea: 'left' })); break;
                case 'ente':
                    if (v.ente) aggiungi(e.id, testo(p, ente, { colore: c.ente, grassetto: true })); break;
                case 'qualifica':
                    aggiungi(e.id, testo(p, dati.qualifica || m.testi.qualifica, { colore: c.qualifica, grassetto: true, spaziatura: 2 / 15 })); break;
                case 'bandiera_it': aggiungi(e.id, bandiera(p, false)); break;
                case 'bandiera_ue': aggiungi(e.id, bandiera(p, true)); break;
            }
        }
        return { forme, posizioni: pos, varianti: v, modello: m };
    }

    // ---- In pdfMake -------------------------------------------------------------

    function inPdf(disegno) {
        const sfondo = [], contenuto = [];
        for (const f of disegno.forme) {
            if (f.tipo === 'rett' && f.sfondo) { sfondo.push({ type: 'rect', x: f.x, y: f.y, w: f.w, h: f.h, color: f.colore }); continue; }
            switch (f.tipo) {
                case 'rett': contenuto.push({ canvas: [{ type: 'rect', x: 0, y: 0, w: f.w, h: f.h, color: f.colore }], absolutePosition: { x: f.x, y: f.y } }); break;
                case 'ellisse': contenuto.push({ canvas: [{ type: 'ellipse', x: f.rx, y: f.ry, r1: f.rx, r2: f.ry, color: f.colore }], absolutePosition: { x: f.cx - f.rx, y: f.cy - f.ry } }); break;
                case 'poligono': {
                    const x0 = Math.min(...f.punti.map(p => p[0])), y0 = Math.min(...f.punti.map(p => p[1]));
                    contenuto.push({ canvas: [{ type: 'polyline', closePath: true, lineWidth: 0, color: f.colore, points: f.punti.map(p => ({ x: p[0] - x0, y: p[1] - y0 })) }], absolutePosition: { x: x0, y: y0 } });
                    break;
                }
                case 'testo':
                    // Una colonna larga quanto il riquadro: con la sola posizione
                    // assoluta pdfMake centrerebbe sul resto della pagina.
                    contenuto.push({ columns: [{ width: f.w, text: f.testo, fontSize: f.corpo, bold: f.grassetto, color: f.colore, alignment: f.allinea,
                        characterSpacing: f.spaziatura || undefined, noWrap: true, lineHeight: 1 }], absolutePosition: { x: f.x, y: f.y + (f.h - f.corpo * 1.172) / 2 } });
                    break;
                case 'immagine':
                    contenuto.push(f.riempi ? { image: f.src, width: f.w, height: f.h, absolutePosition: { x: f.x, y: f.y } }
                        : { image: f.src, fit: [f.w, f.h], absolutePosition: { x: f.x, y: f.y } });
                    break;
                case 'qr': contenuto.push({ qr: f.valore, fit: f.lato, absolutePosition: { x: f.x, y: f.y } }); break;
                case 'barre': contenuto.push({ canvas: f.barre.map(b => ({ type: 'rect', x: b.x * f.modulo, y: 0, w: b.w * f.modulo, h: f.h, color: '#000000' })), absolutePosition: { x: f.x, y: f.y } }); break;
            }
        }
        return {
            pageSize: { width: W, height: H },
            pageMargins: [0, 0, 0, 0],
            // Lo sfondo in un disegno solo: pdfMake impila i disegni separati
            // uno sotto l'altro, e finirebbero fuori dal tesserino.
            background: { canvas: sfondo },
            content: contenuto
        };
    }

    // ---- In SVG, per l'anteprima ----------------------------------------------

    // Nodi costruiti uno per uno (niente markup composto a mano): i testi e le
    // immagini arrivano dai dati e dalle impostazioni.
    const NS = 'http://www.w3.org/2000/svg';
    const n = (x) => String(Math.round(x * 100) / 100);
    function nodo(nome, attributi) {
        const e = document.createElementNS(NS, nome);
        for (const [k, v] of Object.entries(attributi)) if (v !== undefined && v !== null) e.setAttribute(k, v);
        return e;
    }
    function inSvg(disegno) {
        const g = nodo('g', {});
        for (const f of disegno.forme) {
            switch (f.tipo) {
                case 'rett': g.appendChild(nodo('rect', { x: n(f.x), y: n(f.y), width: n(f.w), height: n(f.h), fill: f.colore })); break;
                case 'ellisse': g.appendChild(nodo('ellipse', { cx: n(f.cx), cy: n(f.cy), rx: n(f.rx), ry: n(f.ry), fill: f.colore })); break;
                case 'poligono': g.appendChild(nodo('polygon', { points: f.punti.map(p => `${n(p[0])},${n(p[1])}`).join(' '), fill: f.colore })); break;
                case 'testo': {
                    const x = f.allinea === 'left' ? f.x : f.allinea === 'right' ? f.x + f.w : f.x + f.w / 2;
                    const t = nodo('text', {
                        x: n(x), y: n(f.y + (f.h - f.corpo * 1.172) / 2 + f.corpo * ASCESA),
                        'font-family': `${f.grassetto ? 'OrionTesserinoMedium' : 'OrionTesserinoRegular'}, Roboto, sans-serif`,
                        'font-weight': f.grassetto ? '500' : '400', 'font-size': n(f.corpo), fill: f.colore,
                        'text-anchor': f.allinea === 'left' ? 'start' : f.allinea === 'right' ? 'end' : 'middle',
                        'letter-spacing': f.spaziatura ? n(f.spaziatura) : undefined, style: 'white-space:pre'
                    });
                    t.textContent = f.testo;
                    g.appendChild(t);
                    break;
                }
                case 'immagine':
                    g.appendChild(nodo('image', { href: f.src, x: n(f.x), y: n(f.y), width: n(f.w), height: n(f.h),
                        preserveAspectRatio: f.riempi ? 'xMidYMid slice' : 'xMinYMin meet' }));
                    break;
                case 'qr':
                    g.appendChild(f.immagine
                        ? nodo('image', { href: f.immagine, x: n(f.x), y: n(f.y), width: n(f.lato), height: n(f.lato), style: 'image-rendering:pixelated' })
                        : nodo('rect', { x: n(f.x), y: n(f.y), width: n(f.lato), height: n(f.lato), fill: '#cbd5e1' }));
                    break;
                case 'barre': {
                    const b = nodo('g', { transform: `translate(${n(f.x)} ${n(f.y)})`, fill: '#000' });
                    f.barre.forEach(x => b.appendChild(nodo('rect', { x: n(x.x * f.modulo), y: '0', width: n(x.w * f.modulo), height: n(f.h) })));
                    g.appendChild(b);
                    break;
                }
            }
        }
        return g;
    }

    window.Tesserino = {
        LARGHEZZA: W, ALTEZZA: H, PUNTO, COLORI, NOMI_COLORI, TESTI, ELEMENTI, PER_ID,
        automatiche, normalizza, varianti, posizioni, componi, inPdf, inSvg, nodo, caratteri,
        // La larghezza minima del codice a barre, perché ogni modulo sia di
        // almeno tre punti (0,254 mm).
        LARGHEZZA_MINIMA_CODICE: (MODULI_CF + 2 * RISPETTO) * 3 * PUNTO
    };
})();
