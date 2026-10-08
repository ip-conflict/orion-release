// public/js/magazzino-verbale.js
//
// Il verbale di consegna (o di rientro) da stampare e far firmare. Lo apre il
// magazziniere subito dopo la consegna (o dall'elenco dei verbali) e il
// volontario dal suo profilo: il server decide chi può leggere quale.
//
// Sopra il modulo c'è il foglio firmato: il magazziniere che preferisce la
// carta lo fotografa e lo allega qui, e quella foto diventa il verbale.

document.addEventListener('DOMContentLoaded', async () => {
    const $ = (id) => document.getElementById(id);

    const ETICHETTE_STATO = {
        da_confermare: 'In attesa di conferma',
        da_firmare: 'Da firmare',
        confermato: 'Confermato dal volontario',
        firmato_cartaceo: 'Firmato su carta'
    };

    // Da dove si è arrivati è da dove si torna: il magazziniere al magazzino,
    // il volontario al suo profilo.
    const daProfilo = new URLSearchParams(window.location.search).get('da') === 'profilo';
    const indietro = $('link-indietro');
    if (daProfilo || !haPermesso('magazzino.gestione', 'magazzino.consegne')) {
        indietro.href = '/profile.html';
        indietro.textContent = 'Torna al profilo';
    } else {
        indietro.href = '/magazzino.html?scheda=registro';
        indietro.textContent = 'Torna ai verbali';
    }
    $('btn-stampa').addEventListener('click', () => window.print());

    function dataOra(valore) {
        if (!valore) return '';
        return new Date(valore).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }

    function mostraErrore(testo) {
        $('errore').textContent = testo;
        $('errore').hidden = false;
        $('btn-stampa').disabled = true;
    }

    const id = parseInt(new URLSearchParams(window.location.search).get('id'), 10);
    if (!Number.isInteger(id) || id <= 0) return mostraErrore('Manca il numero del verbale.');

    let verbale;
    try {
        verbale = await fetchApi(`/api/magazzino/verbali/${id}`);
    } catch (e) {
        return mostraErrore(e.message || 'Non riesco a leggere il verbale.');
    }

    // Intestazione dell'associazione: senza, il foglio resta valido lo stesso.
    try {
        const [impostazioni, marchio] = await Promise.all([
            fetch('/api/branding/settings').then(r => r.json()),
            fetch('/api/branding').then(r => r.json())
        ]);
        $('associazione').textContent = impostazioni.association_name || '';
        if (marchio.logoUrl) {
            $('logo').src = `${marchio.logoUrl}?v=${marchio.logoVersion}`;
            $('logo').hidden = false;
        }
    } catch { /* un foglio senza logo si firma lo stesso */ }

    const rientro = verbale.tipo === 'rientro';
    const titolo = rientro ? 'Verbale di rientro' : 'Verbale di consegna';
    document.title = `${titolo} n. ${verbale.id}`;
    $('titolo-barra').textContent = `${titolo} n. ${verbale.id}`;
    $('titolo-tipo').textContent = titolo;
    if (rientro) {
        // Nel rientro le parti si scambiano: firma chi restituisce, riceve il magazzino.
        $('etichetta-destinatario').textContent = 'Restituito da';
        $('etichetta-emesso-da').textContent = 'Ricevuto da';
        $('titolo-firma-consegna').textContent = 'Chi restituisce';
        $('titolo-firma-riceve').textContent = 'Chi riceve per il magazzino';
        $('dichiarazione').textContent =
            'Chi firma dichiara di aver restituito al magazzino il materiale elencato. ' +
            'Le voci segnate come usate sul posto o perse non sono rientrate; quello che resta in carico è scritto nelle note.';
    }
    $('numero').textContent = verbale.id;
    $('destinatario').textContent = verbale.destinatario_nome || '—';
    $('data').textContent = dataOra(verbale.emesso_il);
    $('emesso-da').textContent = verbale.emesso_da || '—';
    $('stato').textContent = ETICHETTE_STATO[verbale.stato] || verbale.stato;
    // "In attesa di conferma" su un foglio da firmare confonde: la firma è
    // proprio la conferma. Lo stato si scrive solo quando c'è già.
    $('campo-stato').hidden = verbale.stato === 'da_confermare' || verbale.stato === 'da_firmare';
    $('firma-consegna').textContent = (rientro ? verbale.destinatario_nome : verbale.emesso_da) || '';
    $('firma-riceve').textContent = (rientro ? verbale.emesso_da : verbale.destinatario_nome) || '';

    const corpo = $('righe');
    if (!verbale.righe?.length) {
        const tr = corpo.insertRow();
        const td = tr.insertCell();
        td.colSpan = 3;
        td.textContent = 'Nessun oggetto collegato a questo verbale.';
    }
    (verbale.righe || []).forEach(r => {
        const tr = corpo.insertRow();
        const esito = { consumo: ' — non rientrato: usato sul posto', smarrimento: ' — non rientrato: dichiarato perso' }[r.tipo] || '';
        tr.insertCell().textContent = `${r.bene_denominazione}${esito}`;
        tr.insertCell().textContent = [r.taglia ? `taglia ${r.taglia}` : '', r.matricola || ''].filter(Boolean).join(' · ') || '—';
        const quanti = tr.insertCell();
        quanti.className = 'numero';
        const n = Number(r.quantita);
        quanti.textContent = `${Number.isInteger(n) ? n : n.toLocaleString('it-IT')} ${r.unita_misura || ''}`.trim();
    });

    if (verbale.note) {
        $('note').textContent = `Note: ${verbale.note}`;
        $('note').hidden = false;
    }

    // Confermato dall'app o dal profilo: il verbale si compila da sé con il
    // nome, la data e la firma di chi ha ricevuto (la conferma elettronica,
    // con l'impronta di quello che ha confermato).
    if (verbale.stato === 'confermato' && verbale.confermato_il) {
        const chi = verbale.confermato_da || verbale.destinatario_nome || 'chi ha ricevuto';
        const quando = dataOra(verbale.confermato_il);
        const da = { app: "dall'app Orion Mobile", web: 'dal proprio profilo' }[verbale.conferma_canale] || 'con il proprio account';
        $('conferma').textContent = `Ricevuta confermata da ${chi} ${da} il ${quando}.` +
            (verbale.conferma_impronta ? ` Impronta della conferma: ${verbale.conferma_impronta}.` : '');
        $('conferma').hidden = false;
        $('luogo-data').textContent = `Data: ${quando} (conferma elettronica ${da})`;
        $('segno-riceve').textContent = chi;
        $('segno-riceve').hidden = false;
        $('firma-riceve').textContent = chi;
        $('firma-elettronica').textContent = verbale.conferma_impronta
            ? `Firmato con conferma elettronica · impronta ${verbale.conferma_impronta.slice(0, 16)}…`
            : 'Firmato con conferma elettronica';
        $('firma-elettronica').hidden = false;
    }

    $('foglio').hidden = false;

    // Il foglio firmato
    const puoAllegare = haPermesso('magazzino.gestione', 'magazzino.consegne');

    // Il file sta dietro l'autenticazione: si scarica con il token e si
    // mostra da un indirizzo locale del browser.
    async function scaricaFirmato(url) {
        const token = getToken();
        const risposta = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!risposta.ok) throw new Error('Non riesco a leggere il foglio firmato.');
        return risposta.blob();
    }

    async function mostraFirmato(v) {
        const blocco = $('blocco-firmato');
        const anteprima = $('anteprima-firmato');
        anteprima.innerHTML = '';
        $('comandi-firmato').hidden = !puoAllegare;
        if (!v.scansione_url && !puoAllegare) { blocco.hidden = true; return; }
        blocco.hidden = false;

        if (!v.scansione_url) {
            $('spiega-firmato').textContent = v.tipo === 'rientro'
                ? 'Stampa il modulo qui sotto e fallo firmare a chi restituisce (oppure usa un foglio tuo), poi fotografalo e allegalo: la foto diventa il verbale.'
                : 'Stampa il modulo qui sotto e fallo firmare a chi riceve (oppure usa un foglio tuo), poi fotografalo e allegalo: la foto diventa il verbale.';
            $('etichetta-file-firmato').textContent = 'Allega la foto del foglio firmato';
            return;
        }

        const quando = v.scansione_caricata_il ? ` il ${dataOra(v.scansione_caricata_il)}` : '';
        const chi = v.scansione_caricata_da ? ` da ${v.scansione_caricata_da}` : '';
        $('spiega-firmato').textContent = `Allegato${quando}${chi}. È questo il verbale firmato.`;
        $('etichetta-file-firmato').textContent = 'Sostituisci con un\'altra foto';
        try {
            const blob = await scaricaFirmato(v.scansione_url);
            const indirizzo = URL.createObjectURL(blob);
            if (blob.type === 'application/pdf') {
                const a = document.createElement('a');
                a.href = indirizzo;
                a.target = '_blank';
                a.rel = 'noopener';
                a.textContent = 'Apri il PDF firmato';
                anteprima.appendChild(a);
            } else {
                const a = document.createElement('a');
                a.href = indirizzo;
                a.target = '_blank';
                a.rel = 'noopener';
                const img = document.createElement('img');
                img.src = indirizzo;
                img.alt = 'Foto del foglio firmato';
                a.appendChild(img);
                anteprima.appendChild(a);
            }
        } catch (e) {
            anteprima.textContent = e.message;
        }
    }

    // Le foto dei telefoni pesano parecchi MB: per leggere una firma bastano
    // 2400 pixel sul lato lungo. Un PDF, o una foto già piccola, va com'è.
    async function riduci(file) {
        if (!file.type.startsWith('image/') || file.size < 1.5 * 1024 * 1024) return file;
        try {
            const bitmap = await createImageBitmap(file);
            const scala = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
            const tela = document.createElement('canvas');
            tela.width = Math.round(bitmap.width * scala);
            tela.height = Math.round(bitmap.height * scala);
            tela.getContext('2d').drawImage(bitmap, 0, 0, tela.width, tela.height);
            const blob = await new Promise(ok => tela.toBlob(ok, 'image/jpeg', 0.85));
            return blob && blob.size < file.size ? new File([blob], 'verbale.jpg', { type: 'image/jpeg' }) : file;
        } catch {
            return file;
        }
    }

    $('file-firmato').addEventListener('change', async () => {
        const scelto = $('file-firmato').files[0];
        if (!scelto) return;
        const esito = $('esito-firmato');
        esito.className = 'esito';
        esito.textContent = 'Carico...';
        try {
            const dati = new FormData();
            dati.append('scansione', await riduci(scelto));
            await fetchApi(`/api/magazzino/verbali/${verbale.id}/scansione`, { method: 'POST', body: dati });
            verbale = await fetchApi(`/api/magazzino/verbali/${verbale.id}`);
            esito.textContent = 'Foglio firmato allegato.';
            $('stato').textContent = ETICHETTE_STATO[verbale.stato] || verbale.stato;
            $('campo-stato').hidden = verbale.stato === 'da_confermare' || verbale.stato === 'da_firmare';
            await mostraFirmato(verbale);
        } catch (e) {
            esito.className = 'esito errore-invio';
            esito.textContent = e.message || 'Caricamento non riuscito.';
        } finally {
            $('file-firmato').value = '';
        }
    });

    mostraFirmato(verbale);
});
