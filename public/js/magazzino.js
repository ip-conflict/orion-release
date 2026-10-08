// public/js/magazzino.js
//
// Le quattro cose che servono davvero: consegna, rientro, chi ha cosa, cosa
// scade e cosa manca. Il resto (anagrafica, impostazioni) sta in una quinta
// scheda che vede solo il magazziniere.
//
// Chi usa questa pagina è un volontario, spesso col telefono in mano e di
// fretta: ogni schermata fa una cosa sola, in tre passi numerati, e i
// bersagli da toccare sono grandi. Niente scorciatoie da tastiera, niente
// tabelle da far scorrere di lato.

document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);

    const ETICHETTE_FAMIGLIA = { dpi: 'DPI', attrezzatura: 'Attrezzatura', veicolo: 'Veicolo' };
    const GRUPPI_TAGLIA = { busto: 'taglie del busto', pantaloni: 'taglie dei pantaloni', scarpe: 'taglie delle scarpe' };
    const ETICHETTE_SCADENZA = {
        revisione: 'Revisione', assicurazione: 'Assicurazione', bollo: 'Bollo',
        tagliando: 'Tagliando', verifica_periodica: 'Verifica periodica',
        scadenza_dpi: 'Scadenza DPI', collaudo: 'Collaudo', manutenzione: 'Manutenzione'
    };
    const ETICHETTE_MOVIMENTO = {
        carico: 'Carico', consegna: 'Consegna', rientro: 'Rientro',
        trasferimento: 'Trasferimento', manutenzione: 'In manutenzione',
        consumo: 'Consumo', smarrimento: 'Smarrimento',
        dismissione: 'Dismissione', rettifica: 'Rettifica'
    };
    // Le scadenze che ha senso chiedere cambiano con la famiglia: un elmetto non
    // fa la revisione e una motosega non ha una "scadenza DPI". Proporle tutte
    // significa far scegliere fra voci che non c'entrano.
    const SCADENZE_PER_TIPO = {
        veicolo: ['revisione', 'assicurazione', 'bollo', 'tagliando'],
        attrezzatura: ['manutenzione', 'verifica_periodica', 'collaudo'],
        dpi: ['scadenza_dpi', 'verifica_periodica']
    };

    // Le unità che si possono frazionare sono le misure (litri, chili, metri):
    // pezzi, paia, kit e sacchi si contano interi, e le frecce dei campi
    // scalano di uno. La stessa lista sta in src/magazzino.js, che controlla.
    const UNITA_FRAZIONABILI = [
        'l', 'lt', 'litro', 'litri', 'ml', 'cl', 'hl',
        'kg', 'chilo', 'chili', 'chilogrammi', 'g', 'gr', 'grammi', 'q', 'quintali', 't', 'tonnellate',
        'm', 'mt', 'metro', 'metri', 'cm', 'mm', 'km', 'mq', 'm2', 'm²', 'mc', 'm3', 'm³'
    ];
    const frazionabile = (unita) => UNITA_FRAZIONABILI.includes(String(unita || '').trim().toLowerCase().replace(/\.$/, ''));
    // Il passo dei campi quantità: un casco si consegna intero.
    const passo = (unita) => (frazionabile(unita) ? '0.01' : '1');

    const stato = {
        beni: [],
        persone: [],
        squadre: [],
        veicoli: [],
        categorie: [],
        ubicazioni: [],
        scelti: new Map(),     // bene_id -> quantità da consegnare
        rientranti: new Map(), // bene_id -> { quantita, km }
        // Le opzioni del magazzino che cambiano i moduli (verbale di rientro):
        // lette una volta, quando servono.
        config: null
    };

    async function configMagazzino() {
        if (!stato.config) {
            try { stato.config = await fetchApi('/api/magazzino/config'); } catch { stato.config = {}; }
        }
        return stato.config;
    }

    // Dai permessi (src/permessi.js): l'inventario a chi gestisce il magazzino,
    // consegne e rientri a chi ha il permesso delle consegne.
    const sonoMagazziniere = haPermesso('magazzino.gestione');
    const consegnaERientra = haPermesso('magazzino.consegne');

    // Il bene aperto nella scheda: lo leggono i movimenti e le manutenzioni,
    // che lavorano su quello e non su una riga dell'elenco.
    let beneCorrente = null;

    // Servizio
    // Con un'azione (per esempio "Stampa il verbale") l'avviso resta finché
    // non si fa altro: sparendo da solo dopo sei secondi, il link si perdeva.
    let timerAvviso = null;
    function avvisa(testo, genere = 'avviso', azione = null) {
        const box = $('avviso-magazzino');
        box.className = `avviso ${genere === 'avviso' ? '' : genere}`.trim();
        box.textContent = testo;
        if (azione) {
            const link = document.createElement('a');
            link.className = 'azione-avviso';
            link.href = azione.href;
            link.textContent = azione.testo;
            if (azione.nuovaScheda) { link.target = '_blank'; link.rel = 'noopener'; }
            box.appendChild(link);
        }
        box.hidden = false;
        clearTimeout(timerAvviso);
        if (genere === 'fatto' && !azione) timerAvviso = setTimeout(() => { box.hidden = true; }, 6000);
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function nascondiAvviso() { $('avviso-magazzino').hidden = true; }

    function dataBreve(valore) {
        if (!valore) return '';
        return new Date(valore).toLocaleDateString('it-IT');
    }

    function dataOra(valore) {
        if (!valore) return '';
        return new Date(valore).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // "fra 3 giorni", "scaduta da 12 giorni": un numero di giorni da solo
    // obbliga a fare il conto, e chi legge ha fretta.
    function quantoManca(giorni) {
        const n = Number(giorni);
        if (!Number.isFinite(n)) return '';
        if (n < 0) return `scaduta da ${Math.abs(n)} giorn${Math.abs(n) === 1 ? 'o' : 'i'}`;
        if (n === 0) return 'scade oggi';
        if (n === 1) return 'scade domani';
        return `fra ${n} giorni`;
    }

    function descriviBene(bene) {
        const pezzi = [];
        if (bene.matricola) pezzi.push(bene.matricola);
        if (bene.taglia) pezzi.push(`taglia ${bene.taglia}`);
        if (bene.categoria) pezzi.push(bene.categoria);
        return pezzi.join(' · ');
    }

    function quantitaDisponibile(bene) {
        return bene.gestione === 'quantita' ? Number(bene.in_magazzino) : 1;
    }

    // Schede
    const pannelli = {
        consegna: $('pannello-consegna'),
        rientro: $('pannello-rientro'),
        'chi-ha-cosa': $('pannello-chi-ha-cosa'),
        scadenze: $('pannello-scadenze'),
        inventario: $('pannello-inventario'),
        registro: $('pannello-registro'),
        impostazioni: $('pannello-impostazioni')
    };

    function apriScheda(nome) {
        nascondiAvviso();
        document.querySelectorAll('.schede-magazzino .scheda').forEach(b => {
            b.classList.toggle('attiva', b.dataset.scheda === nome);
        });
        Object.entries(pannelli).forEach(([chiave, pannello]) => {
            if (pannello) pannello.hidden = chiave !== nome;
        });
        if (nome === 'chi-ha-cosa') caricaChiHaCosa();
        if (nome === 'scadenze') caricaScadenze();
        if (nome === 'inventario') caricaInventario();
        if (nome === 'registro') caricaRegistro();
        if (nome === 'impostazioni') caricaImpostazioni();
        if (nome === 'rientro') aggiornaDetentoriRientro();
    }

    document.querySelectorAll('.schede-magazzino .scheda').forEach(b => {
        b.addEventListener('click', () => apriScheda(b.dataset.scheda));
    });

    // Caricamento iniziale
    // Modulo spento: la pagina lo dice una volta sola e si ferma, invece di
    // mostrare quattro schede vuote e una fila di messaggi d'errore.
    function mostraModuloSpento() {
        nascondiAvviso();
        document.querySelector('.schede-magazzino').hidden = true;
        Object.values(pannelli).forEach(p => { if (p) p.hidden = true; });
        $('modulo-spento').hidden = false;
    }

    async function caricaTutto() {
        try {
            const [beni, destinatari] = await Promise.all([
                fetchApi('/api/magazzino/beni'),
                fetchApi('/api/magazzino/destinatari')
            ]);
            stato.beni = beni;
            stato.persone = destinatari.persone;
            // Squadre e mezzi solo se hanno ancora materiale da far rientrare.
            stato.squadre = destinatari.squadre;
            stato.veicoli = destinatari.veicoli;
            riempiDestinatari();
            disegnaConsegnabili();
            await segnalaScadenzeSullaScheda();
        } catch (e) {
            if (e.body?.modulo_spento) return mostraModuloSpento();
            avvisa(`Non riesco a caricare il magazzino: ${e.message}`, 'errore');
        }
    }

    // Il materiale si consegna a una persona.
    function riempiDestinatari() {
        const select = $('destinatario');
        select.innerHTML = '';
        const voci = stato.persone.map(u => [u.id, u.etichetta]);

        if (voci.length === 0) {
            select.innerHTML = '<option value="">(nessuno disponibile)</option>';
            return;
        }
        voci.forEach(([id, testo]) => {
            const o = document.createElement('option');
            o.value = id;
            o.textContent = testo;
            select.appendChild(o);
        });
        aggiornaRigaVerbale();
        caricaTagliePersona();
    }

    // Il verbale dipende da cosa si consegna. DPI: con la conferma dei DPI
    // c'è sempre e non si sceglie, altrimenti si propone se il magazzino lo
    // prevede. Attrezzature e mezzi: si propone solo se previsto, mai imposto.
    async function aggiornaRigaVerbale() {
        const config = await configMagazzino();
        const tipi = [...stato.scelti.keys()].map(id => stato.beni.find(b => b.id === id)?.tipo).filter(Boolean);
        const dpi = tipi.includes('dpi');
        const altro = tipi.some(t => t !== 'dpi');
        const scegliDpi = dpi && !config.conferma_dpi && !!config.verbale_consegna;
        const scegliAltro = altro && !!config.verbale_consegna_attrezzature;
        const riga = $('riga-verbale');
        const appena = riga.hidden;
        riga.hidden = !(scegliDpi || scegliAltro);
        // Proposto spuntato quando compare; poi resta la scelta di chi consegna.
        if (appena && !riga.hidden) $('genera-verbale').checked = true;
        $('testo-verbale').textContent = dpi && config.conferma_dpi && scegliAltro
            ? 'Mettere nel verbale anche attrezzature e mezzi (i DPI ci sono comunque, con la conferma)'
            : 'Preparare il verbale di consegna: da stampare e far firmare, oppure fotografare il foglio firmato';
        $('nota-conferma-dpi').hidden = !(dpi && config.conferma_dpi);
    }

    // Lo stesso per il rientro: solo da una persona, e secondo cosa torna.
    async function aggiornaRigaVerbaleRientro() {
        const config = await configMagazzino();
        const persona = $('detentore-rientro').value.startsWith('persona:');
        const tipi = [...document.querySelectorAll('#elenco-rientro .riga-bene')]
            .filter(r => r._campi?.spunta.checked).map(r => r._campi.bene.tipo_bene);
        const previsto = persona && tipi.some(t => t === 'dpi' ? config.verbale_rientro : config.verbale_rientro_attrezzature);
        const riga = $('riga-verbale-rientro');
        const appena = riga.hidden;
        riga.hidden = !previsto;
        if (appena && previsto) $('genera-verbale-rientro').checked = true;
    }

    // Le taglie della persona scelta, dal server: quelle dei DPI che ha già
    // ricevuto (si dicono sotto il nome) e quelle dedotte da un DPI con la
    // stessa scala (la polo XL da chi ha la giacca XL). Nel riquadro del DPI
    // la taglia giusta è segnata.
    stato.taglie = new Map();
    async function caricaTagliePersona() {
        const id = $('destinatario').value;
        stato.taglie = new Map();
        $('taglie-persona').hidden = true;
        if (id) {
            try {
                const righe = await fetchApi(`/api/magazzino/taglie/persona/${id}`);
                righe.forEach(r => stato.taglie.set(r.modello_id, r));
                const sue = righe.filter(r => !r.dedotta);
                if (sue.length) {
                    $('taglie-persona').textContent = `Le sue taglie, dalle consegne di prima: ${sue.map(r => `${r.modello} ${r.taglia}`).join(' · ')}`;
                    $('taglie-persona').hidden = false;
                }
            } catch { /* senza le taglie si consegna come sempre */ }
        }
        disegnaConsegnabili();
    }
    $('destinatario').addEventListener('change', caricaTagliePersona);
    // 'sua' se l'ha già ricevuta per questo DPI, 'probabile' se viene da un altro.
    const taglieUguali = (a, b) => String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
    function suaTaglia(b) {
        const t = b.modello_id && stato.taglie.get(b.modello_id);
        if (!t || !b.taglia || !taglieUguali(t.taglia, b.taglia)) return null;
        return t.dedotta ? 'probabile' : 'sua';
    }
    const LETTERE = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];
    function ordineTaglie(a, b) {
        const chiave = (t) => {
            const x = String(t || '').trim().toUpperCase();
            if (LETTERE.includes(x)) return [0, LETTERE.indexOf(x), ''];
            if (/^\d+([.,]\d+)?$/.test(x)) return [1, Number(x.replace(',', '.')), ''];
            return [2, 0, x];
        };
        const [ka, kb] = [chiave(a.taglia), chiave(b.taglia)];
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
    }
    const nomeConTaglia = (b) => b.taglia && !taglieUguali(b.taglia, 'unica') ? `${b.denominazione} ${b.taglia}` : b.denominazione;

    function disegnaConsegnabili() {
        // Ogni parola cercata deve comparire: "giacca xl" trova la giacca in XL.
        const parole = $('cerca-consegna').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const contenitore = $('elenco-consegnabili');
        contenitore.innerHTML = '';

        const disponibili = stato.beni.filter(b => b.disponibile && !b.dismesso_il).filter(b => {
            const dove = `${b.denominazione} ${b.taglia || ''} ${b.matricola || ''} ${b.categoria || ''} ${b.codice_etichetta || ''}`.toLowerCase();
            return parole.every(p => dove.includes(p));
        });

        if (disponibili.length === 0) {
            contenitore.innerHTML = '<p class="vuoto">Niente di disponibile con questa ricerca.</p>';
            return;
        }

        // Le taglie di uno stesso DPI stanno in un solo riquadro.
        const gruppi = new Map();
        disponibili.forEach(b => {
            const chiave = b.modello_id && b.gestione === 'quantita' ? `m${b.modello_id}` : `b${b.id}`;
            if (!gruppi.has(chiave)) gruppi.set(chiave, []);
            gruppi.get(chiave).push(b);
        });
        gruppi.forEach(beni => contenitore.appendChild(beni.length > 1
            ? rigaGruppoTaglie(beni.sort(ordineTaglie))
            : rigaConsegnabile(beni[0])));
    }

    function campoQuantita(bene) {
        const quantita = document.createElement('input');
        quantita.type = 'number';
        quantita.step = passo(bene.unita_misura);
        quantita.min = quantita.step;
        quantita.max = String(quantitaDisponibile(bene));
        quantita.value = stato.scelti.get(bene.id) ?? 1;
        quantita.addEventListener('click', e => e.preventDefault());
        quantita.addEventListener('input', () => {
            if (stato.scelti.has(bene.id)) stato.scelti.set(bene.id, Number(quantita.value));
            aggiornaRiepilogoConsegna();
        });
        return quantita;
    }

    // Un DPI a taglie: il nome una volta, le taglie disponibili come pulsanti.
    // Toccata una taglia, compare il campo per quante.
    function rigaGruppoTaglie(beni) {
        const primo = beni[0];
        const riga = document.createElement('div');
        riga.className = 'riga-bene gruppo-taglie' + (beni.some(b => stato.scelti.has(b.id)) ? ' scelta' : '');

        const totale = beni.reduce((n, b) => n + quantitaDisponibile(b), 0);
        const dettagli = document.createElement('div');
        dettagli.className = 'dettagli';
        dettagli.innerHTML = '<span class="nome-bene"></span><span class="sottotesto"></span>';
        dettagli.querySelector('.nome-bene').textContent = primo.denominazione;
        dettagli.querySelector('.sottotesto').textContent =
            [primo.categoria, `${totale} ${primo.unita_misura} disponibili`].filter(Boolean).join(' · ');
        const famiglia = document.createElement('span');
        famiglia.className = 'etichetta-famiglia';
        famiglia.textContent = ETICHETTE_FAMIGLIA[primo.tipo] || primo.tipo;
        riga.append(dettagli, famiglia);

        const taglie = document.createElement('div');
        taglie.className = 'taglie-consegna';
        let proposta = null;
        beni.forEach(bene => {
            const segno = suaTaglia(bene);
            if (segno) proposta = { bene, segno };
            const pulsante = document.createElement('button');
            pulsante.type = 'button';
            pulsante.className = 'taglia-consegna' + (segno ? ` ${segno}` : '') + (stato.scelti.has(bene.id) ? ' scelta' : '');
            pulsante.setAttribute('aria-pressed', String(stato.scelti.has(bene.id)));
            pulsante.title = `${quantitaDisponibile(bene)} ${bene.unita_misura} disponibili`;
            pulsante.innerHTML = '<span></span><small></small>';
            pulsante.querySelector('span').textContent = bene.taglia;
            pulsante.querySelector('small').textContent = quantitaDisponibile(bene);
            pulsante.addEventListener('click', () => {
                if (stato.scelti.has(bene.id)) stato.scelti.delete(bene.id);
                else stato.scelti.set(bene.id, 1);
                disegnaConsegnabili();
                aggiornaRiepilogoConsegna();
            });
            taglie.appendChild(pulsante);
        });
        riga.appendChild(taglie);

        if (proposta) {
            const nota = document.createElement('p');
            nota.className = `nota-taglia ${proposta.segno}`;
            const t = stato.taglie.get(primo.modello_id);
            nota.textContent = proposta.segno === 'sua'
                ? `Sua taglia: ${proposta.bene.taglia}`
                : `Taglia probabile: ${proposta.bene.taglia}, come per ${t.da_modello}`;
            riga.appendChild(nota);
        }

        const scelti = beni.filter(b => stato.scelti.has(b.id));
        if (scelti.length) {
            const quanti = document.createElement('div');
            quanti.className = 'quantita-taglie';
            scelti.forEach(bene => {
                const campo = document.createElement('label');
                campo.append(`${bene.taglia}`, campoQuantita(bene));
                quanti.appendChild(campo);
            });
            riga.appendChild(quanti);
        }
        return riga;
    }

    function rigaConsegnabile(bene) {
        const riga = document.createElement('label');
        riga.className = 'riga-bene' + (stato.scelti.has(bene.id) ? ' scelta' : '');

        const spunta = document.createElement('input');
        spunta.type = 'checkbox';
        spunta.checked = stato.scelti.has(bene.id);

        const dettagli = document.createElement('div');
        dettagli.className = 'dettagli';
        const disponibile = quantitaDisponibile(bene);
        const quanti = bene.gestione === 'quantita' ? ` — ${disponibile} ${bene.unita_misura} disponibili` : '';
        dettagli.innerHTML = `<span class="nome-bene"></span><span class="sottotesto"></span>`;
        dettagli.querySelector('.nome-bene').textContent = bene.denominazione;
        dettagli.querySelector('.sottotesto').textContent = `${descriviBene(bene)}${quanti}`;

        const famiglia = document.createElement('span');
        famiglia.className = 'etichetta-famiglia';
        famiglia.textContent = ETICHETTE_FAMIGLIA[bene.tipo] || bene.tipo;
        const segno = suaTaglia(bene);
        if (segno) {
            famiglia.textContent = segno === 'sua' ? 'Sua taglia' : 'Taglia probabile';
            famiglia.classList.add('sua-taglia');
        }

        riga.append(spunta, dettagli, famiglia);

        // Sugli sfusi si sceglie quanti; sui pezzi unici la domanda non
        // esiste e il campo non compare.
        const quantita = bene.gestione === 'quantita' ? campoQuantita(bene) : null;
        if (quantita) riga.appendChild(quantita);

        spunta.addEventListener('change', () => {
            if (spunta.checked) {
                stato.scelti.set(bene.id, quantita ? Number(quantita.value) : 1);
            } else {
                stato.scelti.delete(bene.id);
            }
            riga.classList.toggle('scelta', spunta.checked);
            aggiornaRiepilogoConsegna();
        });
        return riga;
    }

    function aggiornaRiepilogoConsegna() {
        const riepilogo = $('riepilogo-consegna');
        aggiornaRigaVerbale();
        if (stato.scelti.size === 0) {
            riepilogo.textContent = 'Nessun oggetto scelto.';
            $('btn-consegna').disabled = true;
            return;
        }
        const righe = [...stato.scelti.entries()].map(([id, q]) => {
            const bene = stato.beni.find(b => b.id === id);
            if (!bene) return '';
            return bene.gestione === 'quantita' ? `${nomeConTaglia(bene)} x${q} ${bene.unita_misura}` : nomeConTaglia(bene);
        });
        riepilogo.textContent = righe.join(', ');
        $('btn-consegna').disabled = false;
    }

    $('cerca-consegna').addEventListener('input', disegnaConsegnabili);

    $('btn-consegna').addEventListener('click', async () => {
        const destinatarioId = $('destinatario').value;
        if (!destinatarioId) return avvisa('Scegli prima a chi va la consegna.', 'errore');

        const corpo = {
            destinatario: { tipo: 'persona', id: Number(destinatarioId) },
            verbale: !$('riga-verbale').hidden && $('genera-verbale').checked,
            righe: [...stato.scelti.entries()].map(([bene_id, quantita]) => ({ bene_id, quantita }))
        };

        $('btn-consegna').disabled = true;
        try {
            const esito = await fetchApi('/api/magazzino/consegna', { method: 'POST', body: JSON.stringify(corpo) });
            stato.scelti.clear();
            await ricaricaBeni();
            aggiornaRiepilogoConsegna();
            const quanti = esito.consegnati.length;
            let testo = `${quanti === 1 ? 'Consegnato 1 oggetto' : `Consegnati ${quanti} oggetti`} a ${esito.destinatario}.`;
            if (esito.verbale_id) testo += ` Verbale n. ${esito.verbale_id} pronto.`;
            if (esito.avvisi?.length) testo += ` ${esito.avvisi.join(' ')}`;
            // Dal verbale si stampa, oppure si allega la foto del foglio firmato.
            const stampa = esito.verbale_id
                ? { testo: 'Apri il verbale (stampa o foto)', href: `/magazzino-verbale.html?id=${esito.verbale_id}`, nuovaScheda: true }
                : null;
            avvisa(testo, esito.avvisi?.length ? 'avviso' : 'fatto', stampa);
            if (esito.verbale_id) segnalaVerbaliSullaScheda();
        } catch (e) {
            avvisa(e.message, 'errore');
            $('btn-consegna').disabled = false;
        }
    });

    async function ricaricaBeni() {
        stato.beni = await fetchApi('/api/magazzino/beni');
        disegnaConsegnabili();
        await segnalaScadenzeSullaScheda();
    }

    function aggiornaDetentoriRientro() {
        const select = $('detentore-rientro');
        const precedente = select.value;
        select.innerHTML = '<option value="">Scegli chi restituisce...</option>';
        stato.persone.forEach(u => {
            const o = document.createElement('option');
            o.value = `persona:${u.id}`;
            o.textContent = u.etichetta;
            select.appendChild(o);
        });
        stato.squadre.forEach(s => {
            const o = document.createElement('option');
            o.value = `squadra:${s.id}`;
            o.textContent = s.etichetta;
            select.appendChild(o);
        });
        stato.veicoli.forEach(v => {
            const o = document.createElement('option');
            o.value = `veicolo:${v.id}`;
            o.textContent = v.etichetta;
            select.appendChild(o);
        });
        if (precedente) select.value = precedente;
    }

    $('detentore-rientro').addEventListener('change', async () => {
        stato.rientranti.clear();
        $('btn-rientro').disabled = true;
        const scelta = $('detentore-rientro').value;
        const contenitore = $('elenco-rientro');
        // Come per la consegna, il verbale lo firma una persona: una squadra
        // o un mezzo non firmano. E solo se il magazzino lo ha acceso per
        // quello che torna (aggiornaRigaVerbaleRientro): di base il rientro è
        // spunta e registra, niente altro. Acceso, parte spuntato.
        $('riga-verbale-rientro').hidden = true;
        if (!scelta) { contenitore.innerHTML = ''; return; }

        const [tipo, id] = scelta.split(':');
        contenitore.innerHTML = '<p class="vuoto">Carico...</p>';
        try {
            const inCarico = await fetchApi(`/api/magazzino/in-carico/${tipo}/${id}`);
            disegnaRientro(inCarico);
        } catch (e) {
            contenitore.innerHTML = '';
            avvisa(e.message, 'errore');
        }
    });

    function disegnaRientro(inCarico) {
        const contenitore = $('elenco-rientro');
        contenitore.innerHTML = '';
        if (inCarico.length === 0) {
            contenitore.innerHTML = '<p class="vuoto">Non risulta avere niente in carico.</p>';
            return;
        }

        inCarico.forEach(bene => {
            const riga = document.createElement('label');
            riga.className = 'riga-bene';

            const spunta = document.createElement('input');
            spunta.type = 'checkbox';

            const dettagli = document.createElement('div');
            dettagli.className = 'dettagli';
            dettagli.innerHTML = `<span class="nome-bene"></span><span class="sottotesto"></span>`;
            dettagli.querySelector('.nome-bene').textContent = bene.denominazione;
            const quanti = bene.gestione === 'quantita'
                ? `${Number(bene.quantita)} ${bene.unita_misura} usciti`
                : (bene.matricola || '');
            dettagli.querySelector('.sottotesto').textContent =
                `${quanti}${bene.da_quando ? ` · dal ${dataBreve(bene.da_quando)}` : ''}`;

            riga.append(spunta, dettagli);

            // Sugli sfusi si scrive quanti ne tornano: la differenza il server
            // la registra come consumo, senza chiedere altro.
            let quantita = null;
            if (bene.gestione === 'quantita') {
                quantita = document.createElement('input');
                quantita.type = 'number';
                quantita.min = '0';
                quantita.step = passo(bene.unita_misura);
                quantita.max = String(Number(bene.quantita));
                quantita.value = Number(bene.quantita);
                quantita.addEventListener('click', e => e.preventDefault());
                quantita.addEventListener('input', aggiornaRientranti);
                riga.appendChild(quantita);
            }

            // Se ne torna meno di quanto è uscito, il resto va detto: niente
            // scelta preimpostata, perché qualunque default sarebbe sbagliato
            // una volta su due (i guanti restano al volontario, i sacchi di
            // sabbia sono finiti nell'argine).
            let resto = null;
            if (bene.gestione === 'quantita') {
                resto = document.createElement('select');
                resto.className = 'scelta-resto';
                resto.hidden = true;
                resto.addEventListener('click', e => e.preventDefault());
                resto.addEventListener('change', aggiornaRientranti);
                riga.appendChild(resto);
            }

            // Sui veicoli si chiedono i chilometri: è l'unico momento in cui
            // qualcuno li ha davvero sotto gli occhi.
            let km = null;
            if (bene.tipo_bene === 'veicolo') {
                km = document.createElement('input');
                km.type = 'number';
                km.min = '0';
                km.placeholder = 'km';
                km.addEventListener('click', e => e.preventDefault());
                km.addEventListener('input', aggiornaRientranti);
                riga.appendChild(km);
            }

            spunta.addEventListener('change', () => {
                riga.classList.toggle('scelta', spunta.checked);
                aggiornaRientranti();
            });

            riga.dataset.beneId = bene.bene_id;
            riga._campi = { spunta, quantita, km, resto, bene };
            contenitore.appendChild(riga);
        });
    }

    function aggiornaRientranti() {
        stato.rientranti.clear();
        let mancaScelta = false;
        document.querySelectorAll('#elenco-rientro .riga-bene').forEach(riga => {
            const { spunta, quantita, km, resto, bene } = riga._campi;
            const uscito = Number(bene.quantita);
            const torna = quantita ? Number(quantita.value) : uscito;
            const mancano = Math.round((uscito - torna) * 100) / 100;
            if (resto) {
                const serve = spunta.checked && mancano > 0;
                if (serve) {
                    const scelto = resto.value;
                    const persona = $('detentore-rientro').value.startsWith('persona:');
                    resto.innerHTML = '';
                    [['', `Il resto (${mancano} ${bene.unita_misura})…`],
                     ['in_carico', persona ? 'restano a questa persona' : 'restano in carico'],
                     ['consumo', 'usati sul posto'],
                     ['perso', 'persi']].forEach(([valore, testo]) => {
                        const o = document.createElement('option');
                        o.value = valore;
                        o.textContent = testo;
                        resto.appendChild(o);
                    });
                    resto.value = scelto;
                    if (!resto.value) mancaScelta = true;
                }
                resto.hidden = !serve;
                resto.classList.toggle('da-scegliere', serve && !resto.value);
            }
            if (!spunta.checked) return;
            stato.rientranti.set(bene.bene_id, {
                quantita: quantita ? Number(quantita.value) : undefined,
                km: km && km.value ? Number(km.value) : undefined,
                resto: resto && !resto.hidden ? resto.value || undefined : undefined
            });
        });
        $('btn-rientro').disabled = stato.rientranti.size === 0 || mancaScelta;
        $('btn-rientro').title = mancaScelta ? 'Scegli cosa ne è del materiale che non torna' : '';
        aggiornaRigaVerbaleRientro();
    }

    $('btn-rientro').addEventListener('click', async () => {
        const righe = [...stato.rientranti.entries()].map(([bene_id, dati]) => ({
            bene_id, quantita: dati.quantita, km: dati.km, resto: dati.resto
        }));
        // Da chi rientra: e' il detentore scelto sopra. Il server ne ha
        // bisogno per scalare il materiale a quantita' a lui, e solo a lui.
        const [tipoDetentore, idDetentore] = $('detentore-rientro').value.split(':');
        const da = tipoDetentore && idDetentore ? { tipo: tipoDetentore, id: Number(idDetentore) } : undefined;
        const verbale = tipoDetentore === 'persona' && !$('riga-verbale-rientro').hidden && $('genera-verbale-rientro').checked;
        $('btn-rientro').disabled = true;
        try {
            const esito = await fetchApi('/api/magazzino/rientro', { method: 'POST', body: JSON.stringify({ righe, da, verbale }) });
            const consumi = esito.registrati.filter(r => r.tipo === 'consumo').length;
            const persi = esito.registrati.filter(r => r.tipo === 'smarrimento').length;
            const rientrati = esito.registrati.filter(r => r.tipo === 'rientro').length;
            let testo = rientrati === 1 ? 'Registrato 1 rientro.' : `Registrati ${rientrati} rientri.`;
            if (consumi) testo += consumi === 1 ? ' 1 voce registrata come usata sul posto.' : ` ${consumi} voci registrate come usate sul posto.`;
            if (persi) testo += persi === 1 ? ' 1 voce registrata come persa.' : ` ${persi} voci registrate come perse.`;
            if (esito.verbale_id) testo += ` Verbale di rientro n. ${esito.verbale_id} pronto.`;
            avvisa(testo, 'fatto', esito.verbale_id
                ? { testo: 'Apri il verbale (stampa o foto)', href: `/magazzino-verbale.html?id=${esito.verbale_id}`, nuovaScheda: true }
                : null);
            if (esito.verbale_id) segnalaVerbaliSullaScheda();
            if (tipoDetentore !== 'persona') {
                // Una squadra o un mezzo che ha reso tutto esce dall'elenco.
                const destinatari = await fetchApi('/api/magazzino/destinatari');
                stato.squadre = destinatari.squadre;
                stato.veicoli = destinatari.veicoli;
                aggiornaDetentoriRientro();
            }
            $('detentore-rientro').dispatchEvent(new Event('change'));
            await ricaricaBeni();
        } catch (e) {
            avvisa(e.message, 'errore');
            $('btn-rientro').disabled = false;
        }
    });

    let detentoriCaricati = [];

    async function caricaChiHaCosa() {
        const contenitore = $('elenco-detentori');
        contenitore.innerHTML = '<p class="vuoto">Carico...</p>';
        try {
            const [righe, categorie, modelliDpi] = await Promise.all([
                fetchApi('/api/magazzino/chi-ha-cosa'),
                fetchApi('/api/magazzino/categorie').catch(() => []),
                fetchApi('/api/magazzino/modelli?nascosti=1').catch(() => [])
            ]);
            detentoriCaricati = righe;
            // Solo le categorie e i modelli di cui qualcosa è fuori: le altre voci darebbero un elenco vuoto.
            const presenti = new Set(righe.flatMap(r => [`c:${r.categoria_id || 0}`, r.modello_id ? `m:${r.modello_id}` : null]));
            riempiFiltroCategoria($('filtro-categoria-detentori'), categorie, modelliDpi, '', presenti);
            disegnaChiHaCosa();
        } catch (e) {
            contenitore.innerHTML = '';
            avvisa(e.message, 'errore');
        }
    }

    function disegnaChiHaCosa() {
        const cerca = $('cerca-detentori').value.trim().toLowerCase();
        const contenitore = $('elenco-detentori');
        contenitore.innerHTML = '';

        const categoria = $('filtro-categoria-detentori').value;
        const righe = detentoriCaricati
            .filter(r => corrispondeCategoria(r, categoria))
            .filter(r => !cerca || `${r.destinatario_nome || ''} ${r.denominazione}`.toLowerCase().includes(cerca));

        if (righe.length === 0) {
            contenitore.innerHTML = '<p class="vuoto">Non risulta niente fuori dal magazzino.</p>';
            return;
        }

        // Raggruppato per detentore: la domanda è "chi ha cosa", non
        // "quale oggetto sta dove".
        const gruppi = new Map();
        righe.forEach(r => {
            const chiave = r.destinatario_nome || 'Destinatario non indicato';
            if (!gruppi.has(chiave)) gruppi.set(chiave, []);
            gruppi.get(chiave).push(r);
        });

        [...gruppi.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([nome, cose]) => {
            const blocco = document.createElement('div');
            blocco.className = 'gruppo-detentore';
            const titolo = document.createElement('h3');
            const quanti = document.createElement('span');
            quanti.textContent = `${cose.length} ogget${cose.length === 1 ? 'to' : 'ti'}`;
            const chi = document.createElement('span');
            chi.textContent = nome;
            titolo.append(chi, quanti);

            const elenco = document.createElement('ul');
            cose.forEach(c => {
                const li = document.createElement('li');
                const quantita = c.gestione === 'quantita' ? ` x${Number(c.quantita)} ${c.unita_misura}` : '';
                const matricola = c.matricola ? ` (${c.matricola})` : '';
                // La taglia: è quella che serve per sostituirlo o riconsegnarne uno uguale.
                const taglia = c.taglia && c.taglia !== 'Unica' ? ` · taglia ${c.taglia}` : '';
                li.textContent = `${c.denominazione}${taglia}${matricola}${quantita} — dal ${dataBreve(c.da_quando)}`;
                elenco.appendChild(li);
            });

            blocco.append(titolo, elenco);
            contenitore.appendChild(blocco);
        });
    }

    $('cerca-detentori').addEventListener('input', disegnaChiHaCosa);
    $('filtro-categoria-detentori').addEventListener('change', disegnaChiHaCosa);

    async function caricaScadenze() {
        const boxScadenze = $('elenco-scadenze');
        const boxFuori = $('elenco-da-recuperare');
        boxScadenze.innerHTML = '<p class="vuoto">Carico...</p>';
        boxFuori.innerHTML = '';
        try {
            const [scadenze, fuori] = await Promise.all([
                fetchApi('/api/magazzino/scadenze?giorni=30'),
                fetchApi('/api/magazzino/da-recuperare')
            ]);

            boxScadenze.innerHTML = '';
            if (scadenze.length === 0) {
                boxScadenze.innerHTML = '<p class="vuoto">Niente in scadenza nei prossimi 30 giorni.</p>';
            } else {
                scadenze.forEach(s => {
                    const riga = document.createElement('div');
                    riga.className = 'riga-avviso ' + (s.giorni_restanti < 0 ? 'scaduto' : 'vicino');
                    const testo = document.createElement('span');
                    const matricola = s.matricola ? ` (${s.matricola})` : '';
                    testo.textContent = `${ETICHETTE_SCADENZA[s.tipo] || s.tipo} — ${s.denominazione}${matricola}`;
                    const quando = document.createElement('span');
                    quando.className = 'quando';
                    quando.textContent = `${dataBreve(s.scadenza)} · ${quantoManca(s.giorni_restanti)}`;
                    riga.append(testo, quando);
                    boxScadenze.appendChild(riga);
                });
            }

            boxFuori.innerHTML = '';
            if (fuori.length === 0) {
                boxFuori.innerHTML = '<p class="vuoto">Tutto rientrato.</p>';
            } else {
                fuori.forEach(f => {
                    const riga = document.createElement('div');
                    riga.className = 'riga-avviso ' + (f.giorni_fuori >= 7 ? 'scaduto' : '');
                    const testo = document.createElement('span');
                    const matricola = f.matricola ? ` (${f.matricola})` : '';
                    const emergenza = f.emergenza_codice ? ` · uscito per ${f.emergenza_codice}` : '';
                    testo.textContent = `${f.denominazione}${matricola} presso ${f.destinatario_nome || 'sconosciuto'}${emergenza}`;
                    const quando = document.createElement('span');
                    quando.className = 'quando';
                    quando.textContent = f.giorni_fuori === 0
                        ? 'uscito oggi'
                        : `fuori da ${f.giorni_fuori} giorn${f.giorni_fuori === 1 ? 'o' : 'i'}`;
                    riga.append(testo, quando);
                    boxFuori.appendChild(riga);
                });
            }
        } catch (e) {
            avvisa(e.message, 'errore');
        }
    }

    // Il pallino rosso sulla scheda: si deve vedere che c'è da guardare senza
    // dover aprire.
    async function segnalaScadenzeSullaScheda() {
        try {
            const scadenze = await fetchApi('/api/magazzino/scadenze?giorni=15');
            $('pallino-scadenze').hidden = scadenze.length === 0;
        } catch { /* un pallino mancante non è un motivo per disturbare */ }
    }

    if (sonoMagazziniere) {
        document.querySelectorAll('.solo-magazziniere').forEach(e => { e.hidden = false; });
    }
    // Senza il permesso delle consegne niente Consegna e Rientro: si parte da "Chi ha cosa".
    if (!consegnaERientra) {
        document.querySelectorAll('.schede-magazzino .scheda[data-scheda="consegna"], .schede-magazzino .scheda[data-scheda="rientro"]')
            .forEach(b => { b.hidden = true; });
        apriScheda('chi-ha-cosa');
    }

    // Il filtro per categoria: le categorie del tipo scelto e, sotto quelle
    // dei DPI, i singoli modelli a taglie ("Calzature" e, dentro, "Scarpe
    // antinfortunistiche"). Valori: "c:<id>" categoria (0 = senza), "m:<id>" modello.
    // [presenti], se c'è, limita le voci a quelle che hanno qualcosa da mostrare.
    function riempiFiltroCategoria(select, categorie, modelliDpi, tipo, presenti = null) {
        const prima = select.value;
        const c = (v) => !presenti || presenti.has(v);
        select.innerHTML = '';
        select.append(new Option('Tutte le categorie', ''));
        const nomeTipo = { dpi: 'DPI', attrezzatura: 'Attrezzature', veicolo: 'Veicoli' };
        categorie.filter(k => !tipo || k.tipo === tipo).forEach(k => {
            const suoi = modelliDpi.filter(m => m.categoria_id === k.id && c(`m:${m.id}`));
            if (!c(`c:${k.id}`) && !suoi.length) return;
            const etichetta = tipo ? k.nome : `${k.nome} (${nomeTipo[k.tipo] || k.tipo})`;
            if (!suoi.length) { select.append(new Option(etichetta, `c:${k.id}`)); return; }
            const gruppo = document.createElement('optgroup');
            gruppo.label = etichetta;
            gruppo.append(new Option(`Tutta la categoria: ${k.nome}`, `c:${k.id}`));
            suoi.forEach(m => gruppo.append(new Option(m.nome, `m:${m.id}`)));
            select.append(gruppo);
        });
        if (c('c:0')) select.append(new Option('Senza categoria', 'c:0'));
        select.value = [...select.options].some(o => o.value === prima) ? prima : '';
    }

    // Un bene (o un modello, o una riga di "chi ha cosa") rientra nel filtro?
    function corrispondeCategoria(voce, valore) {
        if (!valore) return true;
        const id = Number(valore.slice(2));
        if (valore.startsWith('m:')) return voce.modello_id === id;
        return id === 0 ? !voce.categoria_id : voce.categoria_id === id;
    }

    async function caricaCataloghi() {
        const [categorie, ubicazioni] = await Promise.all([
            fetchApi('/api/magazzino/categorie'),
            fetchApi('/api/magazzino/ubicazioni')
        ]);
        stato.categorie = categorie;
        stato.ubicazioni = ubicazioni;
    }

    async function caricaInventario() {
        if (!sonoMagazziniere) return;
        try {
            await Promise.all([caricaCataloghi(), caricaModelli()]);
            riempiFiltroCategoria($('filtro-categoria'), stato.categorie || [], modelli, $('filtro-tipo').value);
            disegnaInventario();
        } catch (e) {
            avvisa(e.message, 'errore');
        }
    }

    function disegnaInventario() {
        const cerca = $('cerca-inventario').value.trim().toLowerCase();
        const tipo = $('filtro-tipo').value;
        const contenitore = $('elenco-inventario');
        contenitore.innerHTML = '';

        // Le taglie dei DPI a taglie stanno nei loro riquadri qui sopra.
        const categoria = $('filtro-categoria').value;
        const righe = stato.beni
            .filter(b => !b.modello_id)
            .filter(b => !tipo || b.tipo === tipo)
            // Scegliendo un modello di DPI a taglie qui sotto non resta niente: è nel suo riquadro.
            .filter(b => !categoria.startsWith('m:') && corrispondeCategoria(b, categoria))
            .filter(b => !cerca || `${b.denominazione} ${b.matricola || ''} ${b.categoria || ''}`.toLowerCase().includes(cerca));

        if (righe.length === 0) {
            contenitore.innerHTML = '<p class="vuoto">Nessun bene con questi criteri.</p>';
            return;
        }

        righe.forEach(bene => {
            const riga = document.createElement('div');
            riga.className = 'riga-bene';
            const dettagli = document.createElement('div');
            dettagli.className = 'dettagli';
            dettagli.innerHTML = `<span class="nome-bene"></span><span class="sottotesto"></span>`;
            dettagli.querySelector('.nome-bene').textContent = bene.denominazione;
            const dove = bene.disponibile
                ? (bene.gestione === 'quantita' ? `${Number(bene.in_magazzino)} ${bene.unita_misura} in magazzino` : 'in magazzino')
                : `presso ${bene.destinatario_nome || 'destinatario non indicato'}`;
            dettagli.querySelector('.sottotesto').textContent = `${descriviBene(bene)} — ${dove}`;

            const famiglia = document.createElement('span');
            famiglia.className = 'etichetta-famiglia';
            famiglia.textContent = ETICHETTE_FAMIGLIA[bene.tipo] || bene.tipo;

            riga.append(dettagli, famiglia);
            riga.addEventListener('click', () => apriSchedaBene(bene.id));
            contenitore.appendChild(riga);
        });
    }

    // Il foglio delle etichette stampa quello che si sta guardando, non tutto
    // il magazzino: i filtri dell'inventario viaggiano nell'indirizzo.
    function aggiornaLinkEtichette() {
        const p = new URLSearchParams();
        if ($('filtro-tipo').value) p.set('tipo', $('filtro-tipo').value);
        if ($('cerca-inventario').value.trim()) p.set('q', $('cerca-inventario').value.trim());
        const categoria = $('filtro-categoria').value;
        if (categoria.startsWith('m:')) p.set('modello', categoria.slice(2));
        else if (categoria.startsWith('c:')) p.set('categoria', categoria.slice(2));
        const coda = p.toString();
        $('btn-etichette').href = `/magazzino-etichette.html${coda ? '?' + coda : ''}`;
    }

    $('cerca-inventario').addEventListener('input', () => { disegnaInventario(); disegnaModelli(); aggiornaLinkEtichette(); });
    $('filtro-tipo').addEventListener('change', () => {
        // Le categorie cambiano col tipo: una scelta che non c'è più si azzera.
        riempiFiltroCategoria($('filtro-categoria'), stato.categorie || [], modelli, $('filtro-tipo').value);
        disegnaInventario(); disegnaModelli(); aggiornaLinkEtichette();
    });
    $('filtro-categoria').addEventListener('change', () => { disegnaInventario(); disegnaModelli(); aggiornaLinkEtichette(); });

    // DPI a taglie
    let modelli = [];
    const numero = (v) => { const n = Number(v); return Number.isInteger(n) ? n : Math.round(n * 100) / 100; };

    async function caricaModelli() {
        const tutti = await fetchApi('/api/magazzino/modelli?nascosti=1');
        const nonUsati = tutti.filter(m => m.nascosto).length;
        $('etichetta-non-usati').textContent = `Mostra anche quelli non usati${nonUsati ? ` (${nonUsati})` : ''}`;
        modelli = $('mostra-modelli-nascosti').checked ? tutti : tutti.filter(m => !m.nascosto);
        riempiFiltroCategoria($('filtro-categoria'), stato.categorie || [], modelli, $('filtro-tipo').value);
        disegnaModelli();
    }

    function disegnaModelli() {
        const box = $('elenco-modelli');
        const cerca = $('cerca-inventario').value.trim().toLowerCase();
        const tipo = $('filtro-tipo').value;
        box.innerHTML = '';
        // Sono DPI: con il filtro su attrezzature o veicoli non c'entrano.
        const categoria = $('filtro-categoria').value;
        const visibili = tipo && tipo !== 'dpi' ? [] : modelli
            .filter(m => categoria.startsWith('m:') ? String(m.id) === categoria.slice(2) : corrispondeCategoria(m, categoria))
            .filter(m => !cerca || `${m.nome} ${m.categoria || ''} ${m.taglie.join(' ')}`.toLowerCase().includes(cerca));
        if (!visibili.length) {
            box.innerHTML = '<p class="vuoto">Nessun DPI a taglie con questi criteri.</p>';
            return;
        }
        visibili.forEach(m => box.appendChild(schedaModello(m)));
    }

    function schedaModello(m) {
        const scheda = document.createElement('div');
        scheda.className = 'scheda-modello' + (m.nascosto ? ' nascosto' : '');

        const testa = document.createElement('div');
        testa.className = 'intestazione';
        const titolo = document.createElement('div');
        const nome = document.createElement('div');
        nome.className = 'nome';
        nome.textContent = m.nome;
        const sotto = document.createElement('div');
        sotto.className = 'sotto';
        sotto.textContent = [m.categoria, GRUPPI_TAGLIA[m.gruppo_taglia], m.nascosto ? 'non usato' : null].filter(Boolean).join(' · ') || 'senza categoria';
        titolo.append(nome, sotto);
        const inCasa = m.varianti.reduce((t, v) => t + Number(v.in_magazzino || 0), 0);
        const fuori = m.varianti.reduce((t, v) => t + Number(v.fuori || 0), 0);
        const totale = document.createElement('div');
        totale.className = 'totale';
        totale.textContent = `${numero(inCasa)} ${m.unita_misura}` + (fuori ? ` · ${numero(fuori)} fuori` : '');
        testa.append(titolo, totale);

        // Una casella per taglia, nell'ordine del modello. Toccandola si apre
        // la scheda di quella taglia: movimenti, scadenze, etichetta.
        const taglie = document.createElement('div');
        taglie.className = 'taglie-modello';
        m.taglie.forEach(t => {
            const v = m.varianti.find(x => String(x.taglia || '').toLowerCase() === t.toLowerCase());
            const qui = numero(v?.in_magazzino || 0);
            const via = numero(v?.fuori || 0);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'taglia-chip' + (qui === 0 ? ' vuota' : qui <= 2 ? ' scarsa' : '');
            chip.title = v ? `Taglia ${t}: ${qui} in magazzino, ${via} fuori. Apri la scheda.` : `Taglia ${t}: niente in magazzino`;
            const etichetta = document.createElement('strong');
            etichetta.textContent = t;
            const conto = document.createElement('span');
            conto.textContent = qui;
            chip.append(etichetta, conto);
            if (via) {
                const f = document.createElement('span');
                f.className = 'fuori';
                f.textContent = `+${via} fuori`;
                chip.appendChild(f);
            }
            if (v) chip.addEventListener('click', () => apriSchedaBene(v.bene_id));
            else chip.disabled = true;
            taglie.appendChild(chip);
        });

        const azioni = document.createElement('div');
        azioni.className = 'azioni';
        const carica = document.createElement('button');
        carica.type = 'button';
        carica.className = 'principale';
        carica.textContent = 'Carica';
        carica.addEventListener('click', () => apriModaleModello('carico', m));
        const modifica = document.createElement('button');
        modifica.type = 'button';
        modifica.textContent = 'Modifica';
        modifica.addEventListener('click', () => apriModaleModello('modifica', m));
        // Le etichette di tutte le taglie, una per scomparto dello scaffale.
        const etichette = document.createElement('a');
        etichette.href = `/magazzino-etichette.html?modello=${m.id}`;
        etichette.target = '_blank';
        etichette.rel = 'noopener';
        etichette.textContent = 'Etichette';
        azioni.append(carica, modifica);
        if (m.varianti.length) azioni.appendChild(etichette);

        scheda.append(testa, taglie, azioni);
        return scheda;
    }

    $('mostra-modelli-nascosti').addEventListener('change', () => caricaModelli().catch(e => avvisa(e.message, 'errore')));

    // Una finestra sola per tre cose: nuovo DPI (nome, taglie e quantità
    // iniziali), modifica (nome, categoria, taglie) e carico (solo quantità).
    let modaleModello = { modo: 'nuovo', modello: null };

    function taglieDalCampo() {
        const viste = new Set();
        return $('modello-taglie').value.split(',').map(t => t.trim()).filter(t => {
            if (!t || viste.has(t.toLowerCase())) return false;
            viste.add(t.toLowerCase());
            return true;
        });
    }

    function disegnaQuantitaModello() {
        const box = $('quantita-modello');
        const precedenti = {};
        box.querySelectorAll('input[data-taglia]').forEach(i => { precedenti[i.dataset.taglia] = i.value; });
        box.innerHTML = '';
        const taglie = modaleModello.modo === 'carico' ? modaleModello.modello.taglie : taglieDalCampo();
        if (!taglie.length) {
            box.innerHTML = '<p class="nota" style="grid-column: 1 / -1;">Scrivi le taglie, o scegline una serie qui sopra.</p>';
            return;
        }
        taglie.forEach(t => {
            const label = document.createElement('label');
            label.append(document.createTextNode(t));
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.step = '1';
            input.placeholder = '0';
            input.dataset.taglia = t;
            input.value = precedenti[t] ?? '';
            label.appendChild(input);
            if (modaleModello.modo === 'carico') {
                const v = modaleModello.modello.varianti.find(x => String(x.taglia || '').toLowerCase() === t.toLowerCase());
                const attuale = document.createElement('span');
                attuale.className = 'attuale';
                attuale.textContent = `ora ${numero(v?.in_magazzino || 0)}`;
                label.appendChild(attuale);
            }
            box.appendChild(label);
        });
    }

    function apriModaleModello(modo, m = null) {
        modaleModello = { modo, modello: m };
        const nuovo = modo === 'nuovo', carico = modo === 'carico';
        $('titolo-modale-modello').textContent = nuovo ? 'Nuovo DPI a taglie' : carico ? `Carica: ${m.nome}` : `Modifica: ${m.nome}`;
        $('campi-anagrafica-modello').hidden = carico;
        $('blocco-quantita-modello').hidden = !(nuovo || carico);
        $('campo-nota-carico').hidden = !carico;
        $('titolo-quantita-modello').textContent = carico ? 'Quanti ne entrano, per taglia' : 'Quanti ce ne sono già in magazzino (facoltativo)';
        $('salva-modello').textContent = carico ? 'Registra il carico' : nuovo ? 'Crea' : 'Salva';
        $('elimina-modello').hidden = modo !== 'modifica' || !!m?.standard;
        $('nascondi-modello').hidden = modo !== 'modifica';
        if (m) $('nascondi-modello').textContent = m.nascosto ? 'Lo usiamo di nuovo' : 'Non lo usiamo';

        riempiSelect($('modello-categoria'), stato.categorie.filter(c => c.tipo === 'dpi'), '(senza categoria)');
        $('modello-nome').value = m?.nome || '';
        $('modello-categoria').value = m?.categoria_id || '';
        $('modello-unita').value = m?.unita_misura || 'pezzi';
        $('modello-gruppo').value = m?.gruppo_taglia || '';
        $('modello-taglie').value = (m?.taglie || []).join(', ');
        $('modello-nota').value = '';
        $('modello-nome').required = !carico;
        $('quantita-modello').innerHTML = '';
        disegnaQuantitaModello();
        $('modale-modello').hidden = false;
        (carico ? $('quantita-modello').querySelector('input') : $('modello-nome'))?.focus();
    }

    function chiudiModaleModello() { $('modale-modello').hidden = true; }

    $('btn-nuovo-modello').addEventListener('click', () => apriModaleModello('nuovo'));
    $('chiudi-modale-modello').addEventListener('click', chiudiModaleModello);
    $('annulla-modello').addEventListener('click', chiudiModaleModello);
    $('modello-taglie').addEventListener('input', disegnaQuantitaModello);
    document.querySelectorAll('.scorciatoie-taglie button').forEach(b => {
        b.addEventListener('click', () => { $('modello-taglie').value = b.dataset.taglie; disegnaQuantitaModello(); });
    });

    function quantitaInserite() {
        const q = {};
        $('quantita-modello').querySelectorAll('input[data-taglia]').forEach(i => {
            if (i.value && Number(i.value) > 0) q[i.dataset.taglia] = Number(i.value);
        });
        return q;
    }

    async function dopoModello(messaggio) {
        chiudiModaleModello();
        await Promise.all([caricaModelli(), ricaricaBeni()]);
        disegnaInventario();
        avvisa(messaggio, 'fatto');
    }

    $('form-modello').addEventListener('submit', async (e) => {
        e.preventDefault();
        const { modo, modello } = modaleModello;
        try {
            if (modo === 'carico') {
                const quantita = quantitaInserite();
                if (!Object.keys(quantita).length) return avvisa('Scrivi quanti pezzi entrano, almeno per una taglia.', 'errore');
                const esito = await fetchApi(`/api/magazzino/modelli/${modello.id}/carico`, {
                    method: 'POST', body: JSON.stringify({ quantita, note: $('modello-nota').value.trim() || null })
                });
                return dopoModello(`${modello.nome}: caricati ${numero(esito.caricati)} ${modello.unita_misura}.`);
            }
            const corpo = {
                nome: $('modello-nome').value.trim(),
                categoria_id: $('modello-categoria').value || null,
                unita_misura: $('modello-unita').value,
                gruppo_taglia: $('modello-gruppo').value || null,
                taglie: taglieDalCampo()
            };
            if (modo === 'nuovo') {
                await fetchApi('/api/magazzino/modelli', { method: 'POST', body: JSON.stringify({ ...corpo, quantita: quantitaInserite() }) });
                return dopoModello(`${corpo.nome} creato: una scheda per taglia, con la sua etichetta.`);
            }
            await fetchApi(`/api/magazzino/modelli/${modello.id}`, { method: 'PUT', body: JSON.stringify(corpo) });
            return dopoModello(`${corpo.nome} aggiornato.`);
        } catch (err) {
            avvisa(err.message, 'errore');
        }
    });

    $('nascondi-modello').addEventListener('click', async () => {
        const m = modaleModello.modello;
        try {
            await fetchApi(`/api/magazzino/modelli/${m.id}`, { method: 'PUT', body: JSON.stringify({ nascosto: !m.nascosto }) });
            dopoModello(m.nascosto ? `${m.nome} è di nuovo in elenco.` : `${m.nome} messo da parte: lo ritrovi con «Mostra anche quelli non usati».`);
        } catch (err) { avvisa(err.message, 'errore'); }
    });

    $('elimina-modello').addEventListener('click', async () => {
        const m = modaleModello.modello;
        try {
            const esito = await fetchApi(`/api/magazzino/modelli/${m.id}`, { method: 'DELETE' });
            dopoModello(esito.message);
        } catch (err) { avvisa(err.message, 'errore'); }
    });

    $('btn-salva-config').addEventListener('click', async () => {
        try {
            await fetchApi('/api/magazzino/config', {
                method: 'PUT',
                body: JSON.stringify({
                    blocco_mezzi_scaduti: $('blocco-mezzi').value,
                    conferma_dpi: $('conferma-dpi').checked,
                    verbale_rientro: $('verbale-rientro').checked,
                    verbale_consegna: $('verbale-consegna').checked,
                    verbale_rientro_attrezzature: $('verbale-rientro-attrezzature').checked,
                    verbale_consegna_attrezzature: $('verbale-consegna-attrezzature').checked,
                    giorni_avviso_recupero: Number($('giorni-recupero').value)
                })
            });
            stato.config = null;
            aggiornaRigaVerbale();
            avvisa('Impostazioni salvate.', 'fatto');
        } catch (e) {
            avvisa(e.message, 'errore');
        }
    });

    // I miei avvisi via email
    // Le impostazioni qui sopra valgono per l'associazione, queste solo per
    // chi è collegato: due blocchi vicini che fanno cose diverse, quindi il
    // titolo lo dice ("I tuoi avvisi") e la nota pure.
    function mostraAvvisi(avvisi) {
        $('avvisi-attivo').checked = !!avvisi.attivo;
        $('avvisi-frequenza').value = avvisi.frequenza;
        $('avvisi-preavviso').value = avvisi.giorni_preavviso;
        $('avvisi-recuperi').checked = avvisi.includi_da_recuperare !== false;
        $('avvisi-ultimo-invio').textContent = avvisi.ultimo_invio
            ? `Ultimo riepilogo inviato il ${new Date(avvisi.ultimo_invio).toLocaleDateString('it-IT')}.`
            : 'Nessun riepilogo inviato finora.';
    }

    $('btn-salva-avvisi').addEventListener('click', async () => {
        try {
            const salvati = await fetchApi('/api/magazzino/avvisi', {
                method: 'PUT',
                body: JSON.stringify({
                    attivo: $('avvisi-attivo').checked,
                    frequenza: $('avvisi-frequenza').value,
                    giorni_preavviso: Number($('avvisi-preavviso').value),
                    includi_da_recuperare: $('avvisi-recuperi').checked
                })
            });
            mostraAvvisi(salvati);
            avvisa($('avvisi-attivo').checked ? 'Avvisi accesi.' : 'Avvisi spenti.', 'fatto');
        } catch (e) {
            avvisa(e.message, 'errore');
        }
    });

    // Una prova serve a sapere se la posta funziona prima di fidarsi: la
    // configurazione SMTP sbagliata si scopre così, non fra un mese quando una
    // revisione è scaduta e l'email non è mai arrivata.
    $('btn-prova-avvisi').addEventListener('click', async (evento) => {
        const pulsante = evento.currentTarget;
        pulsante.disabled = true;
        pulsante.textContent = 'Invio in corso...';
        try {
            const esito = await fetchApi('/api/magazzino/avvisi/prova', { method: 'POST' });
            avvisa(esito.message, 'fatto');
        } catch (e) {
            avvisa(e.message, 'errore');
        } finally {
            pulsante.disabled = false;
            pulsante.textContent = 'Mandami una prova adesso';
        }
    });

    const ETICHETTE_STATO_VERBALE = {
        da_confermare: 'Da confermare', da_firmare: 'Da firmare', confermato: 'Confermato', firmato_cartaceo: 'Firmato su carta'
    };
    let verbaliCaricati = [];
    let movimentiCaricati = [];
    // Due elenchi lunghi nella stessa scheda: si mostrano i più recenti e il
    // resto a richiesta, altrimenti il registro finisce sotto duecento verbali.
    const PASSO_VERBALI = 12;
    const PASSO_MOVIMENTI = 50;
    let quantiVerbali = PASSO_VERBALI;
    let quantiMovimenti = PASSO_MOVIMENTI;

    function pulsanteAltri(box, rimasti, passo, suClic) {
        if (rimasti <= 0) return;
        const altri = document.createElement('button');
        altri.type = 'button';
        altri.className = 'bottone-contorno mostra-altri';
        altri.textContent = `Mostra altri ${Math.min(rimasti, passo)} (ne restano ${rimasti})`;
        altri.addEventListener('click', suClic);
        box.appendChild(altri);
    }

    async function caricaRegistro() {
        if (!sonoMagazziniere) return;
        $('elenco-verbali').innerHTML = '<p class="vuoto">Carico...</p>';
        $('elenco-movimenti').innerHTML = '';
        try {
            [verbaliCaricati, movimentiCaricati] = await Promise.all([
                fetchApi('/api/magazzino/verbali'),
                fetchApi('/api/magazzino/movimenti?limit=500')
            ]);
            quantiVerbali = PASSO_VERBALI;
            quantiMovimenti = PASSO_MOVIMENTI;
            disegnaVerbali();
            disegnaMovimenti();
        } catch (e) {
            $('elenco-verbali').innerHTML = '';
            avvisa(e.message, 'errore');
        }
    }

    function disegnaVerbali() {
        const cerca = $('cerca-verbali').value.trim().toLowerCase();
        const filtro = $('filtro-verbali').value;
        const box = $('elenco-verbali');
        box.innerHTML = '';
        const righe = verbaliCaricati
            .filter(v => !filtro || v.stato === filtro)
            .filter(v => !cerca || `${v.id} ${v.destinatario_nome || ''} ${v.emesso_da || ''}`.toLowerCase().includes(cerca));
        if (righe.length === 0) {
            box.innerHTML = verbaliCaricati.length
                ? '<p class="vuoto">Nessun verbale con questi criteri.</p>'
                : '<p class="vuoto">Nessun verbale finora. Si creano consegnando a una persona con "Preparare il verbale" spuntato.</p>';
            return;
        }
        righe.slice(0, quantiVerbali).forEach(v => {
            const riga = document.createElement('a');
            riga.className = 'riga-bene';
            riga.href = `/magazzino-verbale.html?id=${v.id}`;
            riga.target = '_blank';
            riga.rel = 'noopener';
            const dettagli = document.createElement('div');
            dettagli.className = 'dettagli';
            dettagli.innerHTML = '<span class="nome-bene"></span><span class="sottotesto"></span>';
            dettagli.querySelector('.nome-bene').textContent =
                `N. ${v.id} · ${v.tipo === 'rientro' ? 'Rientro da ' : ''}${v.destinatario_nome || 'destinatario non indicato'}`;
            const oggetti = `${v.oggetti} ogget${v.oggetti === 1 ? 'to' : 'ti'}`;
            const confermato = v.confermato_il ? ` · confermato il ${dataBreve(v.confermato_il)}` : '';
            const foglio = v.scansione_url ? ' · foglio firmato allegato' : '';
            dettagli.querySelector('.sottotesto').textContent =
                `${dataOra(v.emesso_il)} · ${oggetti}${v.emesso_da ? ` · da ${v.emesso_da}` : ''}${confermato}${foglio}`;
            const statoV = document.createElement('span');
            statoV.className = `stato-verbale ${v.stato}`;
            statoV.textContent = ETICHETTE_STATO_VERBALE[v.stato] || v.stato;
            riga.append(dettagli, statoV);
            box.appendChild(riga);
        });
        pulsanteAltri(box, righe.length - quantiVerbali, PASSO_VERBALI, () => { quantiVerbali += PASSO_VERBALI; disegnaVerbali(); });
    }

    function disegnaMovimenti() {
        const cerca = $('cerca-movimenti').value.trim().toLowerCase();
        const filtro = $('filtro-movimenti').value;
        const box = $('elenco-movimenti');
        box.innerHTML = '';
        const righe = movimentiCaricati
            .filter(m => !filtro || m.tipo === filtro)
            .filter(m => !cerca || `${m.bene_denominazione} ${m.destinatario_nome || ''} ${m.eseguito_da || ''} ${m.note || ''}`
                .toLowerCase().includes(cerca));
        if (righe.length === 0) {
            box.innerHTML = '<p class="vuoto">Nessun movimento con questi criteri.</p>';
            return;
        }
        righe.slice(0, quantiMovimenti).forEach(m => {
            const riga = document.createElement('div');
            riga.className = 'riga-registro';
            const quando = document.createElement('span');
            quando.className = 'quando';
            quando.textContent = dataOra(m.quando);
            const tipo = document.createElement('span');
            tipo.className = 'tipo';
            tipo.textContent = ETICHETTE_MOVIMENTO[m.tipo] || m.tipo;
            const cosa = document.createElement('span');
            cosa.className = 'cosa';
            const n = Number(m.quantita);
            const quanti = n !== 1 || m.unita_misura !== 'pezzi' ? ` x${n} ${m.unita_misura || ''}`.trimEnd() : '';
            const verso = m.destinatario_nome ? ` → ${m.destinatario_nome}` : '';
            const km = m.km_registrati ? ` · ${m.km_registrati} km` : '';
            cosa.textContent = `${m.bene_denominazione}${quanti}${verso}${km}`;
            const chi = document.createElement('span');
            chi.className = 'chi';
            chi.textContent = [m.eseguito_da ? `da ${m.eseguito_da}` : '', m.note || ''].filter(Boolean).join(' — ');
            riga.append(quando, tipo, cosa);
            if (chi.textContent) riga.appendChild(chi);
            box.appendChild(riga);
        });
        pulsanteAltri(box, righe.length - quantiMovimenti, PASSO_MOVIMENTI, () => { quantiMovimenti += PASSO_MOVIMENTI; disegnaMovimenti(); });
    }

    const daCapoVerbali = () => { quantiVerbali = PASSO_VERBALI; disegnaVerbali(); };
    const daCapoMovimenti = () => { quantiMovimenti = PASSO_MOVIMENTI; disegnaMovimenti(); };
    $('cerca-verbali').addEventListener('input', daCapoVerbali);
    $('filtro-verbali').addEventListener('change', daCapoVerbali);
    $('cerca-movimenti').addEventListener('input', daCapoMovimenti);
    $('filtro-movimenti').addEventListener('change', daCapoMovimenti);

    // Il pallino sulla scheda: ci sono consegne che il volontario non ha
    // ancora confermato.
    async function segnalaVerbaliSullaScheda() {
        if (!sonoMagazziniere) return;
        try {
            const verbali = await fetchApi('/api/magazzino/verbali');
            $('pallino-verbali').hidden = !verbali.some(v => v.stato === 'da_confermare' || v.stato === 'da_firmare');
        } catch { /* come per le scadenze: un pallino mancante non disturba */ }
    }

    async function caricaImpostazioni() {
        if (!sonoMagazziniere) return;
        try {
            const [config, avvisi] = await Promise.all([
                fetchApi('/api/magazzino/config'),
                fetchApi('/api/magazzino/avvisi'),
                caricaCataloghi()
            ]);
            $('blocco-mezzi').value = config.blocco_mezzi_scaduti;
            $('conferma-dpi').checked = !!config.conferma_dpi;
            $('verbale-rientro').checked = !!config.verbale_rientro;
            $('verbale-consegna').checked = !!config.verbale_consegna;
            $('verbale-rientro-attrezzature').checked = !!config.verbale_rientro_attrezzature;
            $('verbale-consegna-attrezzature').checked = !!config.verbale_consegna_attrezzature;
            $('giorni-recupero').value = config.giorni_avviso_recupero;
            mostraAvvisi(avvisi);
            disegnaCategorie();
            disegnaUbicazioni();
        } catch (e) {
            avvisa(e.message, 'errore');
        }
    }

    const ETICHETTE_TIPO_UBICAZIONE = { sede: 'Sede', container: 'Container', garage: 'Garage', altro: 'Altro' };

    function bottone(testo, classe = '') {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = testo;
        if (classe) b.className = classe;
        return b;
    }

    // Una voce del catalogo che si modifica sul posto: niente finestre in più
    // per cambiare una parola.
    function voceCatalogo({ nome, sottotitolo, aRiposo, modifica, elimina, eliminabile, perche }) {
        const voce = document.createElement('div');
        voce.className = 'voce-catalogo' + (aRiposo ? ' a-riposo' : '');
        const testo = document.createElement('span');
        testo.className = 'nome';
        testo.textContent = nome;
        const piccolo = document.createElement('small');
        piccolo.textContent = sottotitolo;
        testo.appendChild(piccolo);
        const btnModifica = bottone('Modifica');
        const btnElimina = bottone('Elimina', 'pericolo');
        btnElimina.disabled = !eliminabile;
        if (!eliminabile) btnElimina.title = perche;
        btnModifica.addEventListener('click', () => modifica(voce));
        btnElimina.addEventListener('click', elimina);
        voce.append(testo, btnModifica, btnElimina);
        return voce;
    }

    function disegnaCategorie() {
        const box = $('elenco-categorie');
        box.innerHTML = '';
        if (stato.categorie.length === 0) {
            box.innerHTML = '<p class="vuoto">Nessuna categoria. Aggiungine una qui sopra: poi la scegli nella scheda di ogni bene.</p>';
            return;
        }
        Object.entries(ETICHETTE_FAMIGLIA).forEach(([tipo, etichetta]) => {
            const categorie = stato.categorie.filter(c => c.tipo === tipo);
            if (categorie.length === 0) return;
            const titolo = document.createElement('h3');
            titolo.textContent = etichetta;
            box.appendChild(titolo);
            categorie.forEach(c => {
                box.appendChild(voceCatalogo({
                    nome: c.nome,
                    sottotitolo: c.beni ? `${c.beni} ben${c.beni === 1 ? 'e' : 'i'}` : 'vuota',
                    eliminabile: !c.beni,
                    perche: 'Contiene dei beni: spostali prima in un\'altra categoria.',
                    modifica: (voce) => modificaSulPosto(voce, c.nome, async (nome) => {
                        await fetchApi(`/api/magazzino/categorie/${c.id}`, { method: 'PUT', body: JSON.stringify({ nome }) });
                        avvisa('Categoria rinominata.', 'fatto');
                    }),
                    elimina: async () => {
                        try {
                            const esito = await fetchApi(`/api/magazzino/categorie/${c.id}`, { method: 'DELETE' });
                            avvisa(esito.message, 'fatto');
                            await ricaricaCataloghi();
                        } catch (e) { avvisa(e.message, 'errore'); }
                    }
                }));
            });
        });
    }

    function disegnaUbicazioni() {
        const box = $('elenco-ubicazioni');
        box.innerHTML = '';
        if (stato.ubicazioni.length === 0) {
            box.innerHTML = '<p class="vuoto">Nessuna ubicazione. Aggiungine una qui sopra: poi la scegli nella scheda di ogni bene.</p>';
            return;
        }
        stato.ubicazioni.forEach(u => {
            const pezzi = [ETICHETTE_TIPO_UBICAZIONE[u.tipo] || u.tipo, u.beni ? `${u.beni} ben${u.beni === 1 ? 'e' : 'i'}` : 'vuota'];
            if (!u.attiva) pezzi.push('non più in uso');
            if (u.note) pezzi.push(u.note);
            box.appendChild(voceCatalogo({
                nome: u.nome,
                sottotitolo: pezzi.join(' · '),
                aRiposo: !u.attiva,
                eliminabile: !u.beni,
                perche: 'Ci sono dei beni: spostali, oppure segnala l\'ubicazione come non più in uso.',
                modifica: (voce) => modificaUbicazione(voce, u),
                elimina: async () => {
                    try {
                        const esito = await fetchApi(`/api/magazzino/ubicazioni/${u.id}`, { method: 'DELETE' });
                        avvisa(esito.message, 'fatto');
                        await ricaricaCataloghi();
                    } catch (e) { avvisa(e.message, 'errore'); }
                }
            }));
        });
    }

    async function ricaricaCataloghi() {
        try {
            await caricaCataloghi();
            disegnaCategorie();
            disegnaUbicazioni();
        } catch (e) { avvisa(e.message, 'errore'); }
    }

    function campoTesto(valore) {
        const campo = document.createElement('input');
        campo.type = 'text';
        campo.maxLength = 100;
        campo.value = valore;
        return campo;
    }

    function modificaSulPosto(voce, valore, salva) {
        const campo = campoTesto(valore);
        const ok = bottone('Salva');
        const annulla = bottone('Annulla');
        voce.replaceChildren(campo, ok, annulla);
        campo.focus();
        annulla.addEventListener('click', ricaricaCataloghi);
        const conferma = async () => {
            const nome = campo.value.trim();
            if (!nome) return avvisa('Il nome non può essere vuoto.', 'errore');
            try {
                await salva(nome);
                await ricaricaCataloghi();
            } catch (e) { avvisa(e.message, 'errore'); }
        };
        ok.addEventListener('click', conferma);
        campo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); conferma(); } });
    }

    function modificaUbicazione(voce, u) {
        const nome = campoTesto(u.nome);
        const tipo = document.createElement('select');
        Object.entries(ETICHETTE_TIPO_UBICAZIONE).forEach(([valore, etichetta]) => {
            const o = document.createElement('option');
            o.value = valore;
            o.textContent = etichetta;
            tipo.appendChild(o);
        });
        tipo.value = u.tipo;
        const note = campoTesto(u.note || '');
        note.placeholder = 'Note (facoltative)';
        note.maxLength = 300;
        const inUso = document.createElement('label');
        inUso.className = 'riga-opzione';
        inUso.style.marginBottom = '0';
        const spunta = document.createElement('input');
        spunta.type = 'checkbox';
        spunta.checked = u.attiva;
        inUso.append(spunta, document.createTextNode(' In uso'));
        const ok = bottone('Salva');
        const annulla = bottone('Annulla');
        voce.replaceChildren(nome, tipo, note, inUso, ok, annulla);
        nome.focus();
        annulla.addEventListener('click', ricaricaCataloghi);
        ok.addEventListener('click', async () => {
            try {
                await fetchApi(`/api/magazzino/ubicazioni/${u.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ nome: nome.value.trim(), tipo: tipo.value, note: note.value.trim() || null, attiva: spunta.checked })
                });
                avvisa('Ubicazione aggiornata.', 'fatto');
                await ricaricaCataloghi();
            } catch (e) { avvisa(e.message, 'errore'); }
        });
    }

    $('form-categoria').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await fetchApi('/api/magazzino/categorie', {
                method: 'POST',
                body: JSON.stringify({ tipo: $('nuova-categoria-tipo').value, nome: $('nuova-categoria-nome').value.trim() })
            });
            $('nuova-categoria-nome').value = '';
            avvisa('Categoria aggiunta.', 'fatto');
            await ricaricaCataloghi();
        } catch (err) { avvisa(err.message, 'errore'); }
    });

    $('form-ubicazione').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await fetchApi('/api/magazzino/ubicazioni', {
                method: 'POST',
                body: JSON.stringify({ tipo: $('nuova-ubicazione-tipo').value, nome: $('nuova-ubicazione-nome').value.trim() })
            });
            $('nuova-ubicazione-nome').value = '';
            avvisa('Ubicazione aggiunta.', 'fatto');
            await ricaricaCataloghi();
        } catch (err) { avvisa(err.message, 'errore'); }
    });

    // Scheda di un bene
    function riempiSelect(select, voci, vuoto, attuale = null) {
        select.innerHTML = `<option value="">${vuoto}</option>`;
        voci.filter(v => v.attiva !== false || v.id === attuale).forEach(v => {
            const o = document.createElement('option');
            o.value = v.id;
            o.textContent = v.attiva === false ? `${v.nome} (non più in uso)` : v.nome;
            select.appendChild(o);
        });
    }

    function adattaCampiAlTipo() {
        const tipo = $('bene-tipo').value;
        const gestione = $('bene-gestione').value;
        const veicolo = tipo === 'veicolo';
        $('bene-quantita').step = passo($('bene-unita').value);
        $('campo-km').hidden = !veicolo;
        $('campo-patente').hidden = !veicolo;
        $('campo-taglia').hidden = tipo !== 'dpi';
        $('campo-quantita').hidden = gestione !== 'quantita';
        $('campo-unita').hidden = gestione !== 'quantita';
        if (veicolo) {
            // Un veicolo è sempre un esemplare solo: il menu lo dice e non
            // lascia scegliere l'opzione che poi il server rifiuterebbe.
            $('bene-gestione').value = 'singolo';
            $('bene-gestione').disabled = true;
        } else {
            $('bene-gestione').disabled = false;
        }
        disegnaCampiScadenze(SCADENZE_PER_TIPO[tipo] || SCADENZE_PER_TIPO.attrezzatura);
    }

    function disegnaCampiScadenze(tipi, valori = {}) {
        const box = $('campi-scadenze');
        box.innerHTML = '';
        tipi.forEach(tipo => {
            const label = document.createElement('label');
            label.textContent = ETICHETTE_SCADENZA[tipo] || tipo;

            const riga = document.createElement('div');
            riga.className = 'scadenza-con-periodo';

            const data = document.createElement('input');
            data.type = 'date';
            data.dataset.scadenza = tipo;
            if (valori[tipo]?.scadenza) data.value = String(valori[tipo].scadenza).slice(0, 10);

            // La periodicità accanto alla data: "scade il 5 ottobre, ogni 12
            // mesi" è una frase sola, e messa in un campo lontano nessuno la
            // compilerebbe. Lasciandola vuota la scadenza resta una tantum,
            // come prima.
            const ogni = document.createElement('span');
            ogni.className = 'ogni';
            ogni.textContent = 'ogni';

            const mesi = document.createElement('input');
            mesi.type = 'number';
            mesi.min = '1';
            mesi.max = '120';
            mesi.placeholder = 'mesi';
            mesi.dataset.periodicita = tipo;
            if (valori[tipo]?.periodicita_mesi) mesi.value = valori[tipo].periodicita_mesi;

            riga.append(data, ogni, mesi);
            label.appendChild(riga);
            box.appendChild(label);
        });
    }

    $('bene-tipo').addEventListener('change', () => { adattaCampiAlTipo(); riempiCategorie(); });
    $('bene-unita').addEventListener('input', () => { $('bene-quantita').step = passo($('bene-unita').value); });
    $('bene-gestione').addEventListener('change', adattaCampiAlTipo);

    // Le categorie si offrono per il tipo scelto: un veicolo nella categoria
    // "Calzature" non lo cerca nessuno.
    function riempiCategorie(attuale = null) {
        const tipo = $('bene-tipo').value;
        riempiSelect($('bene-categoria'), stato.categorie.filter(c => c.tipo === tipo || c.id === attuale), '(senza categoria)');
        if (attuale) $('bene-categoria').value = attuale;
    }

    function apriModaleBene(bene = null) {
        riempiCategorie(bene?.categoria_id || null);
        riempiSelect($('bene-ubicazione'), stato.ubicazioni, '(senza ubicazione)', bene?.ubicazione_id || null);
        $('modale-bene').hidden = false;
    }

    $('btn-nuovo-bene').addEventListener('click', () => {
        $('form-bene').reset();
        $('bene-denominazione').readOnly = false;
        $('bene-denominazione').title = '';
        $('bene-id').value = '';
        $('titolo-modale-bene').textContent = 'Nuovo bene';
        $('bene-tipo').disabled = false;
        $('storia-bene').hidden = true;
        $('documenti-bene').hidden = true;
        // Un bene che non esiste ancora non si può movimentare né manutenere.
        beneCorrente = null;
        $('azioni-bene').hidden = true;
        $('manutenzioni-bene').hidden = true;
        adattaCampiAlTipo();
        apriModaleBene();
    });

    // I documenti dell'archivio del gruppo collegati a un bene: il libretto
    // d'uso e manutenzione, prima di tutto. Si aprono in un'altra scheda.
    // [modifica]: chi tiene l'archivio o il magazzino li toglie con la x.
    async function disegnaDocumentiBene(id, box, modifica = false) {
        box.replaceChildren();
        let documenti = [];
        try { documenti = (await fetchApi(`/api/documenti?bene=${id}`)).documenti || []; } catch { /* senza archivio, niente */ }
        for (const d of documenti) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = `/api/documenti/${d.id}/file`;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = d.titolo;
            li.appendChild(a);
            if (modifica) {
                const x = document.createElement('button');
                x.type = 'button';
                x.className = 'btn-icona togli-documento';
                x.title = `Scollega "${d.titolo}" da questo bene (il documento resta nell'archivio)`;
                x.setAttribute('aria-label', x.title);
                x.innerHTML = '<i class="fas fa-link-slash"></i>';
                x.addEventListener('click', async () => {
                    try {
                        await fetchApi(`/api/documenti/${d.id}/beni/${id}`, { method: 'DELETE' });
                        avvisa('Documento scollegato.', 'successo');
                        await mostraDocumentiBene(beneCorrente);
                    } catch (e) { avvisa(e.message, 'errore'); }
                });
                li.appendChild(x);
            }
            box.appendChild(li);
        }
        return documenti.length;
    }

    // I documenti nella scheda del bene: chi tiene l'archivio o il magazzino li
    // collega dall'archivio o carica il libretto da qui, anche per i beni uguali.
    const puoCollegare = () => haPermesso('gruppo.documenti', 'magazzino.gestione');
    async function mostraDocumentiBene(bene) {
        if (!bene) return;
        const modifica = puoCollegare() && !bene.dismesso_il;
        const quanti = await disegnaDocumentiBene(bene.id, $('elenco-documenti-bene'), modifica);
        $('documenti-bene').hidden = !quanti && !modifica;
        $('documenti-bene-vuoto').hidden = !!quanti || !modifica;
        $('documenti-bene-azioni').hidden = !modifica;
        if (!modifica) return;
        const simili = (stato.beni || []).filter(b => b.id !== bene.id && b.tipo === bene.tipo && !b.dismesso_il
            && String(b.denominazione).toLowerCase() === String(bene.denominazione).toLowerCase()).length;
        $('riga-doc-simili').hidden = !simili;
        $('doc-simili').checked = false;
        $('testo-doc-simili').textContent = simili === 1 ? "Anche all'altro bene uguale (stessa denominazione)" : `Anche agli altri ${simili} beni uguali (stessa denominazione)`;
        const scelta = $('doc-da-collegare');
        scelta.replaceChildren(new Option("Collega un documento dell'archivio…", ''));
        try {
            const archivio = await fetchApi('/api/documenti');
            const collegati = new Set([...$('elenco-documenti-bene').querySelectorAll('a')].map(a => a.getAttribute('href')));
            for (const c of [...(archivio.cartelle || []), { id: null, nome: 'Senza cartella' }]) {
                const docs = (archivio.documenti || []).filter(d => (d.cartella_id ?? null) === c.id && !collegati.has(`/api/documenti/${d.id}/file`));
                if (!docs.length) continue;
                const g = document.createElement('optgroup');
                g.label = c.nome;
                for (const d of docs) g.appendChild(new Option(d.titolo, d.id));
                scelta.appendChild(g);
            }
        } catch { /* senza archivio resta il caricamento */ }
    }

    $('doc-da-collegare')?.addEventListener('change', async (e) => {
        const documento = e.target.value;
        if (!documento || !beneCorrente) return;
        try {
            const r = await fetchApi(`/api/documenti/${documento}/beni`, { method: 'POST', body: JSON.stringify({ bene_id: beneCorrente.id, simili: $('doc-simili').checked }) });
            avvisa(r.collegati > 1 ? `Documento collegato a ${r.collegati} beni.` : 'Documento collegato.', 'successo');
            await mostraDocumentiBene(beneCorrente);
        } catch (err) { avvisa(err.message, 'errore'); e.target.value = ''; }
    });
    $('carica-libretto')?.addEventListener('click', () => $('file-libretto').click());
    $('file-libretto')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file || !beneCorrente) return;
        const modulo = new FormData();
        modulo.append('file', file);
        modulo.append('simili', $('doc-simili').checked ? 'true' : 'false');
        $('carica-libretto').disabled = true;
        try {
            const r = await fetchApi(`/api/magazzino/beni/${beneCorrente.id}/libretto`, { method: 'POST', body: modulo });
            avvisa(`"${r.titolo}" caricato${r.collegati > 1 ? ` e collegato a ${r.collegati} beni` : ''}: è anche in Documenti del gruppo.`, 'successo');
            await mostraDocumentiBene(beneCorrente);
        } catch (err) {
            avvisa(err.message, 'errore');
        } finally {
            $('carica-libretto').disabled = false;
            e.target.value = '';
        }
    });

    async function apriSchedaBene(id) {
        try {
            const bene = await fetchApi(`/api/magazzino/beni/${id}`);
            beneCorrente = bene;
            $('form-bene').reset();
            $('bene-id').value = bene.id;
            $('titolo-modale-bene').textContent = bene.denominazione;
            $('bene-tipo').value = bene.tipo;
            $('bene-tipo').disabled = true;       // cambiarlo renderebbe assurda la sua storia
            $('bene-gestione').value = bene.gestione;
            $('bene-gestione').disabled = true;
            $('bene-denominazione').value = bene.denominazione;
            // Una taglia di un DPI a taglie prende nome e categoria dal suo
            // modello: si cambiano da lì, per tutte le taglie insieme.
            $('bene-denominazione').readOnly = !!bene.modello_id;
            $('bene-denominazione').title = bene.modello_id ? 'Il nome si cambia dal DPI a taglie, per tutte le taglie insieme.' : '';
            $('bene-matricola').value = bene.matricola || '';
            $('bene-taglia').value = bene.taglia || '';
            $('bene-unita').value = bene.unita_misura || 'pezzi';
            $('bene-km').value = bene.km ?? '';
            $('bene-patente').value = bene.patente_richiesta || '';
            $('bene-etichetta').value = bene.codice_etichetta || '';
            $('bene-note').value = bene.note || '';
            adattaCampiAlTipo();
            $('bene-gestione').disabled = true;
            $('campo-quantita').hidden = true;    // la giacenza si cambia con un movimento, non a mano

            const valori = {};
            (bene.scadenze || []).forEach(s => { valori[s.tipo] = s; });
            disegnaCampiScadenze(SCADENZE_PER_TIPO[bene.tipo] || SCADENZE_PER_TIPO.attrezzatura, valori);

            apriModaleBene(bene);
            $('bene-categoria').value = bene.categoria_id || '';
            $('bene-ubicazione').value = bene.ubicazione_id || '';

            const storia = $('elenco-storia');
            storia.innerHTML = '';
            (bene.storia || []).forEach(m => {
                const d = document.createElement('div');
                const quanto = bene.gestione === 'quantita' ? ` x${Number(m.quantita)}` : '';
                const dove = m.destinatario_nome ? ` → ${m.destinatario_nome}` : '';
                d.textContent = `${dataOra(m.quando)} · ${ETICHETTE_MOVIMENTO[m.tipo] || m.tipo}${quanto}${dove}` +
                    (m.eseguito_da ? ` (${m.eseguito_da})` : '') + (m.note ? ` — ${m.note}` : '');
                storia.appendChild(d);
            });
            $('storia-bene').hidden = false;
            await mostraDocumentiBene(bene);

            // Movimenti e manutenzioni sono cose da magazziniere: chi non lo è
            // la scheda non la apre nemmeno, ma il controllo sta anche qui.
            chiudiFormMovimento();
            $('form-intervento').hidden = true;
            $('azioni-bene').hidden = !sonoMagazziniere;
            $('manutenzioni-bene').hidden = !sonoMagazziniere;

            if (sonoMagazziniere) {
                // Un bene già dismesso non si movimenta più: i pulsanti che
                // non porterebbero a niente non si mostrano.
                const dismesso = !!bene.dismesso_il;
                document.querySelectorAll('.azione-movimento').forEach(b => {
                    // La rettifica corregge una giacenza: su un pezzo unico,
                    // che è uno per definizione, non vuol dire niente.
                    const soloSfusi = b.dataset.movimento === 'rettifica' && bene.gestione !== 'quantita';
                    b.hidden = dismesso || soloSfusi;
                });
                $('link-etichetta-bene').href = `/magazzino-etichette.html?ids=${bene.id}`;
                $('link-etichetta-bene').hidden = dismesso || !bene.codice_etichetta;
                if (dismesso) {
                    $('spiega-movimento').textContent = '';
                    $('form-movimento').hidden = true;
                }
                try {
                    disegnaInterventi(await fetchApi(`/api/magazzino/beni/${id}/interventi`));
                } catch { disegnaInterventi([]); }
            }
        } catch (e) {
            avvisa(e.message, 'errore');
        }
    }

    function chiudiModaleBene() { $('modale-bene').hidden = true; }
    $('chiudi-modale-bene').addEventListener('click', chiudiModaleBene);
    $('annulla-bene').addEventListener('click', chiudiModaleBene);

    $('form-bene').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('bene-id').value;
        const scadenze = [...document.querySelectorAll('#campi-scadenze input[data-scadenza]')]
            .filter(i => i.value)
            .map(i => {
                const mesi = document.querySelector(`#campi-scadenze input[data-periodicita="${i.dataset.scadenza}"]`);
                return {
                    tipo: i.dataset.scadenza,
                    scadenza: i.value,
                    periodicita_mesi: mesi && mesi.value ? Number(mesi.value) : null
                };
            });

        const corpo = {
            tipo: $('bene-tipo').value,
            gestione: $('bene-gestione').value,
            categoria_id: $('bene-categoria').value || null,
            ubicazione_id: $('bene-ubicazione').value || null,
            denominazione: $('bene-denominazione').value.trim(),
            matricola: $('bene-matricola').value.trim() || null,
            taglia: $('bene-taglia').value.trim() || null,
            unita_misura: $('bene-unita').value.trim() || 'pezzi',
            quantita_totale: Number($('bene-quantita').value || 0),
            km: $('bene-km').value || null,
            patente_richiesta: $('bene-patente').value.trim() || null,
            codice_etichetta: $('bene-etichetta').value.trim() || null,
            note: $('bene-note').value.trim() || null,
            scadenze
        };

        try {
            await fetchApi(id ? `/api/magazzino/beni/${id}` : '/api/magazzino/beni', {
                method: id ? 'PUT' : 'POST',
                body: JSON.stringify(corpo)
            });
            chiudiModaleBene();
            await ricaricaBeni();
            disegnaInventario();
            avvisa(id ? 'Bene aggiornato.' : 'Bene creato e caricato in magazzino.', 'fatto');
        } catch (err) {
            avvisa(err.message, 'errore');
        }
    });

    // Movimenti sulla scheda di un bene
    // Queste operazioni avevano l'API ma nessun pulsante: il magazziniere non
    // aveva modo di buttare un DPI scaduto, mandare una motosega in officina o
    // correggere una giacenza dopo un inventario. Stanno tutte qui, sulla
    // scheda del bene, perché è lì che uno le pensa.
    const MOVIMENTI = {
        carico: {
            titolo: 'Quante unità entrano in magazzino',
            spiega: 'Acquisto, donazione, o rientro dall\'officina.',
            nota: 'Nota (facoltativa)', notaObbligatoria: false
        },
        manutenzione: {
            titolo: 'Quante unità vanno in officina',
            spiega: 'Il bene esiste ma non è disponibile finché non rientra con un carico.',
            nota: 'Cosa deve essere fatto', notaObbligatoria: false
        },
        smarrimento: {
            titolo: 'Quante unità sono sparite',
            spiega: 'Resta nella storia del bene: fra un anno si saprà che era stato dichiarato perso.',
            nota: 'Cosa è successo', notaObbligatoria: true
        },
        dismissione: {
            titolo: 'Quante unità si buttano',
            spiega: 'Il bene esce dagli elenchi ma non dalla storia. Vale anche se è in mano a qualcuno: un DPI scade dove si trova.',
            nota: 'Perché (scaduto, rotto, venduto)', notaObbligatoria: true
        },
        rettifica: {
            titolo: 'Di quanto correggere (negativo per toglierne)',
            spiega: 'Dopo un inventario fisico, per dire "contati, sono 170 e non 172".',
            nota: 'Da dove viene il numero nuovo', notaObbligatoria: true
        }
    };

    let movimentoScelto = null;

    function mostraFormMovimento(tipo) {
        const bene = beneCorrente;
        if (!bene) return;
        movimentoScelto = tipo;
        const config = MOVIMENTI[tipo];

        document.querySelectorAll('.azione-movimento').forEach(b => {
            b.classList.toggle('scelta', b.dataset.movimento === tipo);
        });

        $('spiega-movimento').textContent = config.spiega;
        $('etichetta-nota-movimento').textContent = config.nota;
        $('movimento-nota').value = '';

        // Su un pezzo unico la quantità è sempre 1 e chiederla è un campo in
        // più da sbagliare. L'unica eccezione è la rettifica, che sui pezzi
        // unici non ha senso e infatti non si propone.
        const sfuso = bene.gestione === 'quantita';
        $('campo-quantita-movimento').hidden = !sfuso;
        $('etichetta-quantita-movimento').textContent = `${config.titolo} (${bene.unita_misura})`;
        $('movimento-quantita').value = 1;
        $('movimento-quantita').step = passo(bene.unita_misura);
        $('movimento-quantita').min = tipo === 'rettifica' ? '-100000' : $('movimento-quantita').step;

        $('form-movimento').hidden = false;
        $('movimento-nota').focus();
    }

    function chiudiFormMovimento() {
        movimentoScelto = null;
        $('form-movimento').hidden = true;
        document.querySelectorAll('.azione-movimento').forEach(b => b.classList.remove('scelta'));
    }

    document.querySelectorAll('.azione-movimento').forEach(b => {
        b.addEventListener('click', () => mostraFormMovimento(b.dataset.movimento));
    });
    $('annulla-movimento').addEventListener('click', chiudiFormMovimento);

    $('form-movimento').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!movimentoScelto || !beneCorrente) return;
        const config = MOVIMENTI[movimentoScelto];
        const nota = $('movimento-nota').value.trim();
        if (config.notaObbligatoria && !nota) {
            return avvisa(`Per questa operazione serve una spiegazione: ${config.nota.toLowerCase()}.`, 'errore');
        }
        // Chiedere conferma solo dove serve: la dismissione è l'unica che non
        // si annulla con un movimento contrario.
        if (movimentoScelto === 'dismissione' &&
            !confirm(`"${beneCorrente.denominazione}" uscirà dagli elenchi del magazzino. La sua storia resta. Procedo?`)) {
            return;
        }

        const quantita = beneCorrente.gestione === 'quantita' ? Number($('movimento-quantita').value) : 1;
        try {
            await fetchApi('/api/magazzino/movimenti', {
                method: 'POST',
                body: JSON.stringify({ bene_id: beneCorrente.id, tipo: movimentoScelto, quantita, note: nota })
            });
            chiudiFormMovimento();
            await apriSchedaBene(beneCorrente.id);
            await ricaricaBeni();
            disegnaInventario();
            avvisa('Movimento registrato.', 'fatto');
        } catch (err) {
            avvisa(err.message, 'errore');
        }
    });

    // Manutenzioni
    function disegnaInterventi(interventi) {
        const box = $('elenco-interventi');
        box.innerHTML = '';
        if (!interventi || interventi.length === 0) {
            box.innerHTML = '<p class="nota" style="margin-top:10px;">Nessun intervento registrato finora.</p>';
            return;
        }
        interventi.forEach(i => {
            const riga = document.createElement('div');
            riga.className = 'riga-intervento';

            const data = document.createElement('span');
            data.className = 'data';
            data.textContent = dataBreve(i.eseguito_il);

            const cosa = document.createElement('span');
            const pezzi = [ETICHETTE_SCADENZA[i.tipo] || i.tipo];
            if (i.descrizione) pezzi.push(i.descrizione);
            if (i.fornitore) pezzi.push(i.fornitore);
            if (i.costo) pezzi.push(`${Number(i.costo).toFixed(2)} €`);
            cosa.textContent = pezzi.join(' · ');

            riga.append(data, cosa);

            if (i.documento_url) {
                const allegato = document.createElement('span');
                allegato.className = 'allegato';
                const link = document.createElement('a');
                link.href = i.documento_url;
                link.target = '_blank';
                link.rel = 'noopener';
                link.textContent = 'verbale';
                allegato.appendChild(link);
                riga.appendChild(allegato);
            }
            box.appendChild(riga);
        });
    }

    $('btn-nuovo-intervento').addEventListener('click', () => {
        const form = $('form-intervento');
        form.hidden = !form.hidden;
        if (form.hidden || !beneCorrente) return;

        const tipi = SCADENZE_PER_TIPO[beneCorrente.tipo] || SCADENZE_PER_TIPO.attrezzatura;
        const select = $('intervento-tipo');
        select.innerHTML = '';
        tipi.forEach(t => {
            const o = document.createElement('option');
            o.value = t;
            o.textContent = ETICHETTE_SCADENZA[t] || t;
            select.appendChild(o);
        });
        // La data di oggi già compilata: si registra quasi sempre l'intervento
        // appena fatto, e una data vuota è un campo in più da riempire.
        $('intervento-data').value = new Date().toISOString().slice(0, 10);

        // Se la scadenza ha già una periodicità la si ripropone, così non va
        // ridigitata a ogni giro.
        const scadenzaEsistente = (beneCorrente.scadenze || []).find(x => x.tipo === select.value);
        $('intervento-periodicita').value = scadenzaEsistente?.periodicita_mesi || '';
    });

    $('annulla-intervento').addEventListener('click', () => { $('form-intervento').hidden = true; });

    $('form-intervento').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!beneCorrente) return;
        const dati = new FormData();
        dati.append('tipo', $('intervento-tipo').value);
        dati.append('eseguito_il', $('intervento-data').value);
        if ($('intervento-periodicita').value) dati.append('periodicita_mesi', $('intervento-periodicita').value);
        if ($('intervento-costo').value) dati.append('costo', $('intervento-costo').value);
        if ($('intervento-fornitore').value.trim()) dati.append('fornitore', $('intervento-fornitore').value.trim());
        if ($('intervento-descrizione').value.trim()) dati.append('descrizione', $('intervento-descrizione').value.trim());
        const file = $('intervento-documento').files[0];
        if (file) dati.append('documento', file);

        try {
            const esito = await fetchApi(`/api/magazzino/beni/${beneCorrente.id}/interventi`, { method: 'POST', body: dati });
            $('form-intervento').hidden = true;
            $('form-intervento').reset();
            await apriSchedaBene(beneCorrente.id);
            avvisa(esito.prossima_scadenza
                ? `Intervento registrato. Prossima scadenza: ${dataBreve(esito.prossima_scadenza)}.`
                : 'Intervento registrato.', 'fatto');
        } catch (err) {
            avvisa(err.message, 'errore');
        }
    });

    // Barra laterale e avvio
    (async () => {
        try {
            const impostazioni = await fetch('/api/branding/settings').then(r => r.json());
            if (haRuolo('admin')) $('sidebar-settings').style.display = 'block';
            if (impostazioni.segreteria_config) {
                const conf = typeof impostazioni.segreteria_config === 'string'
                    ? JSON.parse(impostazioni.segreteria_config) : impostazioni.segreteria_config;
                if (conf.enabled && haPermesso('volontari.sanitario', 'volontari.anagrafica')) $('sidebar-segreteria').style.display = 'block';
            }
        } catch { /* la barra laterale incompleta non impedisce di lavorare */ }
        await caricaTutto();
        segnalaVerbaliSullaScheda();

        // Una scheda precisa dall'indirizzo (?scheda=registro): ci si torna dal
        // verbale stampato, e ci arrivano i collegamenti dalle altre pagine.
        const schedaChiesta = new URLSearchParams(window.location.search).get('scheda');
        const bottoneScheda = schedaChiesta && document.querySelector(`.schede-magazzino .scheda[data-scheda="${CSS.escape(schedaChiesta)}"]`);
        if (bottoneScheda && !bottoneScheda.hidden && $('modulo-spento').hidden) apriScheda(schedaChiesta);

        // Arrivo da un QR: si apre direttamente la scheda del bene inquadrato.
        // Il codice sta nell'indirizzo, così la fotocamera di qualunque
        // telefono basta e non serve un'applicazione.
        const parametri = new URLSearchParams(window.location.search);

        // Arrivo dal fascicolo di un volontario: la consegna si apre già
        // puntata su di lui, che è la ragione per cui si è cliccato.
        const persona = parseInt(parametri.get('persona'), 10);
        if (persona) {
            const select = $('destinatario');
            if (consegnaERientra && select && [...select.options].some(o => Number(o.value) === persona)) {
                select.value = String(persona);
                apriScheda('consegna');
            }
        }

        const codice = parametri.get('e');
        const idDiretto = parseInt(parametri.get('bene'), 10);
        if (codice || idDiretto) {
            try {
                const id = idDiretto || (await fetchApi(`/api/magazzino/etichetta/${encodeURIComponent(codice)}`)).id;
                if (sonoMagazziniere) {
                    apriScheda('inventario');
                    await caricaInventario();
                    await apriSchedaBene(id);
                } else {
                    // Chi non tiene l'inventario non ha la scheda, ma la
                    // domanda che si fa inquadrando un'etichetta è "cos'è
                    // questo e chi ce l'ha": quella si può rispondere lo stesso.
                    const bene = await fetchApi(`/api/magazzino/beni/${id}`);
                    const dove = bene.disponibile
                        ? 'in magazzino'
                        : `presso ${bene.destinatario_nome || 'un detentore non indicato'}`;
                    avvisa(`${bene.denominazione}${bene.matricola ? ` (${bene.matricola})` : ''} — ${dove}.`);
                    // E il suo libretto, che è l'altra cosa che si cerca col bene in mano.
                    $('documenti-qr').hidden = !(await disegnaDocumentiBene(bene.id, $('documenti-qr')));
                }
            } catch (e) {
                avvisa(e.message, 'errore');
            }
        }
    })();
});
