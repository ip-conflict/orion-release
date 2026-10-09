// Il ritaglio della foto profilo prima del caricamento: la cornice ha le
// proporzioni della foto del tesserino (5 x 6), con un ovale che suggerisce
// dove mettere il viso. Si trascina per spostare, si ingrandisce con la
// rotella o il cursore, si gira di 90 gradi. Ne esce un JPEG di 500 x 600:
// leggero, e uguale per tutti i tesserini.
//
// window.ritagliaFoto(file) -> Promise<Blob|null> (null: annullato)

(function () {
    const USCITA_L = 500, USCITA_A = 600;   // la foto che si carica
    const VISTA_L = 300, VISTA_A = 360;     // la cornice a schermo

    function stile() {
        if (document.getElementById('stile-ritaglio-foto')) return;
        const s = document.createElement('style');
        s.id = 'stile-ritaglio-foto';
        s.textContent = `
.rf-velo { position: fixed; inset: 0; z-index: 6000; background: rgba(15, 23, 42, .6); display: flex; align-items: center; justify-content: center; padding: 16px; }
.rf-finestra { background: var(--surface-color, #fff); color: var(--text-color, #111); border-radius: 12px; padding: 18px 20px; width: min(380px, 100%); box-shadow: 0 20px 50px rgba(0,0,0,.35); box-sizing: border-box; }
.rf-finestra h2 { margin: 0 0 4px; font-size: 1.2rem; }
.rf-finestra p { margin: 0 0 12px; font-size: .86rem; color: var(--text-muted, #64748b); }
.rf-cornice { position: relative; width: ${VISTA_L}px; max-width: 100%; aspect-ratio: ${VISTA_L} / ${VISTA_A}; margin: 0 auto; border-radius: 8px; overflow: hidden; background: #111; touch-action: none; cursor: grab; }
.rf-cornice:active { cursor: grabbing; }
.rf-cornice canvas { width: 100%; height: 100%; display: block; }
.rf-ovale { position: absolute; left: 18%; right: 18%; top: 10%; bottom: 22%; border: 2px dashed rgba(255,255,255,.75); border-radius: 50%; pointer-events: none; box-shadow: 0 0 0 999px rgba(0,0,0,.25); }
.rf-comandi { display: flex; align-items: center; gap: 10px; margin: 12px 0 4px; }
.rf-comandi input[type=range] { flex: 1; }
.rf-comandi button { flex-shrink: 0; }
.rf-azioni { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }`;
        document.head.appendChild(s);
    }

    async function caricaImmagine(file) {
        // createImageBitmap rispetta l'orientamento scritto dalla fotocamera.
        if (window.createImageBitmap) {
            try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* si prova con <img> */ }
        }
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            return img;
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    }

    window.ritagliaFoto = async function (file) {
        let immagine;
        try { immagine = await caricaImmagine(file); } catch {
            notifica?.('Il file scelto non è un\'immagine che il browser sa aprire.', 'errore');
            return null;
        }
        stile();
        return new Promise((risolvi) => {
            const velo = document.createElement('div');
            velo.className = 'rf-velo';
            velo.innerHTML = `
<div class="rf-finestra" role="dialog" aria-modal="true" aria-labelledby="rf-titolo">
    <h2 id="rf-titolo">Inquadra la foto</h2>
    <p>Trascina per spostarla e ingrandisci finché il viso sta nell'ovale: è la foto del tesserino.</p>
    <div class="rf-cornice"><canvas width="${VISTA_L * 2}" height="${VISTA_A * 2}"></canvas><div class="rf-ovale"></div></div>
    <div class="rf-comandi">
        <i class="fas fa-search-minus" aria-hidden="true"></i>
        <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Ingrandimento">
        <i class="fas fa-search-plus" aria-hidden="true"></i>
        <button type="button" class="button-style button-secondary rf-ruota" title="Gira di 90 gradi"><i class="fas fa-redo" aria-hidden="true"></i></button>
    </div>
    <div class="rf-azioni">
        <button type="button" class="button-style button-secondary rf-annulla">Annulla</button>
        <button type="button" class="button-style rf-usa">Usa questa foto</button>
    </div>
</div>`;
            document.body.appendChild(velo);
            const canvas = velo.querySelector('canvas');
            const ctx = canvas.getContext('2d');
            const cursore = velo.querySelector('input[type=range]');
            const CW = canvas.width, CH = canvas.height;

            // Stato: rotazione (0..3 quarti), zoom sopra il minimo che copre la cornice, spostamento del centro.
            let giri = 0, zoom = 1, dx = 0, dy = 0;
            const lati = () => giri % 2 ? [immagine.height, immagine.width] : [immagine.width, immagine.height];
            const scalaBase = () => { const [l, a] = lati(); return Math.max(CW / l, CH / a); };
            function limita() {
                const [l, a] = lati();
                const s = scalaBase() * zoom;
                const maxX = Math.max(0, (l * s - CW) / 2), maxY = Math.max(0, (a * s - CH) / 2);
                dx = Math.min(maxX, Math.max(-maxX, dx));
                dy = Math.min(maxY, Math.max(-maxY, dy));
            }
            function disegna(c, larghezza, altezza) {
                const fattore = larghezza / CW;
                const s = scalaBase() * zoom * fattore;
                c.save();
                c.fillStyle = '#fff';
                c.fillRect(0, 0, larghezza, altezza);
                c.translate(larghezza / 2 + dx * fattore, altezza / 2 + dy * fattore);
                c.rotate(giri * Math.PI / 2);
                c.drawImage(immagine, -immagine.width * s / 2, -immagine.height * s / 2, immagine.width * s, immagine.height * s);
                c.restore();
            }
            const ridisegna = () => { limita(); disegna(ctx, CW, CH); };
            ridisegna();

            // Trascinare: in coordinate del canvas (è disegnato al doppio).
            let presa = null;
            const cornice = velo.querySelector('.rf-cornice');
            cornice.addEventListener('pointerdown', (e) => { presa = { x: e.clientX, y: e.clientY, dx, dy }; cornice.setPointerCapture(e.pointerId); });
            cornice.addEventListener('pointermove', (e) => {
                if (!presa) return;
                const k = CW / cornice.clientWidth;
                dx = presa.dx + (e.clientX - presa.x) * k;
                dy = presa.dy + (e.clientY - presa.y) * k;
                ridisegna();
            });
            cornice.addEventListener('pointerup', () => { presa = null; });
            cornice.addEventListener('wheel', (e) => {
                e.preventDefault();
                zoom = Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
                cursore.value = zoom;
                ridisegna();
            }, { passive: false });
            cursore.addEventListener('input', () => { zoom = Number(cursore.value); ridisegna(); });
            velo.querySelector('.rf-ruota').addEventListener('click', () => { giri = (giri + 1) % 4; dx = dy = 0; ridisegna(); });

            const chiudi = (esito) => { velo.remove(); document.removeEventListener('keydown', tasti); risolvi(esito); };
            const tasti = (e) => { if (e.key === 'Escape') chiudi(null); };
            document.addEventListener('keydown', tasti);
            velo.querySelector('.rf-annulla').addEventListener('click', () => chiudi(null));
            velo.querySelector('.rf-usa').addEventListener('click', () => {
                const uscita = document.createElement('canvas');
                uscita.width = USCITA_L; uscita.height = USCITA_A;
                disegna(uscita.getContext('2d'), USCITA_L, USCITA_A);
                uscita.toBlob((blob) => chiudi(blob), 'image/jpeg', 0.9);
            });
            velo.querySelector('.rf-usa').focus();
        });
    };
})();
