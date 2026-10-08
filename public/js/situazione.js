// public/js/situazione.js
//
// Il punto di situazione su un foglio A4: /situazione.html per l'emergenza in
// corso, /situazione.html?emergenza=ID per una chiusa (il resoconto, dall'archivio).
// Con &completo=1 segue ogni segnalazione per intero: dati, diario e foto, per
// stampare tutta l'emergenza in una volta.

(function () {
    const foglio = document.getElementById('st-foglio');
    const nota = document.getElementById('st-nota');
    const parametri = new URLSearchParams(location.search);
    const emergenzaRichiesta = parametri.get('emergenza');
    const completo = parametri.get('completo') === '1';

    const STATO = { New: 'Nuova', Open: 'Aperta', InProgress: 'In corso', Closed: 'Chiusa', Resolved: 'Risolta' };
    const PRIORITA = { High: ['Alta', 'st-alta'], Medium: ['Media', 'st-media'], Low: ['Bassa', 'st-bassa'] };
    const e = (v) => escapeHTML(v == null ? '' : String(v));

    const dataOra = (v) => v ? new Date(v).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const dataLunga = (v) => new Date(v).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const ora = (v) => new Date(v).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

    // "2 h 15 min", "3 g 4 h": quanto è passato, per chi legge il foglio.
    function durata(da, a = Date.now()) {
        const minuti = Math.max(0, Math.round((new Date(a) - new Date(da)) / 60000));
        if (minuti < 60) return `${minuti} min`;
        const ore = Math.floor(minuti / 60);
        if (ore < 48) return `${ore} h ${minuti % 60} min`;
        return `${Math.floor(ore / 24)} g ${ore % 24} h`;
    }

    // Le ore accanto alle date di oggi, la data intera per i giorni prima.
    function quando(v) {
        if (!v) return '—';
        const d = new Date(v);
        return d.toDateString() === new Date().toDateString() ? ora(v) : dataOra(v);
    }

    function bollinoPriorita(p) {
        const [testo, classe] = PRIORITA[p] || [p || '—', ''];
        return `<span class="st-bollino ${classe}">${e(testo)}</span>`;
    }

    // Il caposquadra per primo, segnato.
    const persone = (membri) => [...(membri || [])].sort((a, b) => (b.caposquadra === true) - (a.caposquadra === true))
        .map(m => { const n = [m.cognome, m.nome].filter(Boolean).join(' '); return n && m.caposquadra ? `${n} (caposquadra)` : n; })
        .filter(Boolean).join(', ');

    function numero(valore, etichetta, sotto = '', allarme = false) {
        return `<div class="st-numero${allarme ? ' st-allarme' : ''}"><div class="st-valore">${e(valore)}</div>
            <div class="st-etichetta">${e(etichetta)}</div>${sotto ? `<div class="st-sotto">${e(sotto)}</div>` : ''}</div>`;
    }

    // Le note automatiche dette in italiano piano: chi legge il foglio fuori
    // dalla sala non deve decifrare "Campo 'Stato' modificato da ...".
    function notaLeggibile(testo) {
        const t = String(testo || '').trim();
        let m = t.match(/^Campo '([^']+)' modificato da .+? a '([^']+)'(?: \(([^)]+)\))?\.?$/);
        if (m) return `${m[1]}: ${m[2]}${m[3] ? ` (${m[3]})` : ''}`;
        m = t.match(/^Campo '([^']+)' modificato da .+? a non impostato\.?$/);
        if (m) return `${m[1]}: tolto`;
        m = t.match(/^Assegnazione Squadra '([^']+)' rimossa\.?$/);
        if (m) return `Squadra ${m[1]} liberata`;
        m = t.match(/^Squadra '([^']+)' assegnata\.?$/);
        if (m) return `Squadra ${m[1]} assegnata`;
        return t;
    }

    function tabellaAperte(aperte) {
        if (!aperte.length) return '<p class="st-vuoto">Nessuna segnalazione aperta.</p>';
        return `<table class="st-tabella"><thead><tr>
            <th>N.</th><th>Priorità</th><th>Segnalazione</th><th>Stato e squadre</th><th>Ultimo aggiornamento</th><th>Aperta da</th>
            </tr></thead><tbody>${aperte.map(r => `<tr>
                <td class="st-n">${e(r.numero ?? r.id)}</td>
                <td class="st-stretta">${bollinoPriorita(r.priority)}</td>
                <td><strong>${e(r.title)}</strong>
                    ${r.location_address ? `<span class="st-piccolo">${e(r.location_address)}</span>` : ''}
                    ${r.pericolo ? `<span class="st-pericolo">Pericolo: ${e(r.pericolo)}</span>` : ''}</td>
                <td><span class="st-bollino st-stato">${e(STATO[r.status] || r.status)}</span>
                    ${r.squadre ? `<span class="st-piccolo">${e(r.squadre)}</span>`
                        : r.motivo_senza_squadra ? `<span class="st-piccolo">${e(r.motivo_senza_squadra)}</span>`
                        : '<span class="st-piccolo st-senza">In attesa di squadra</span>'}</td>
                <td>${r.ultimo_testo ? `${r.ultimo_di_sistema ? `<em>${e(notaLeggibile(r.ultimo_testo))}</em>` : e(r.ultimo_testo)}<span class="st-piccolo">${e(quando(r.ultimo_il))}${r.ultimo_autore ? ` · ${e(r.ultimo_autore)}` : ''}</span>` : '<span class="st-piccolo">—</span>'}</td>
                <td class="st-stretta">${e(durata(r.created_at))}<span class="st-piccolo">dalle ${e(quando(r.created_at))}</span></td>
            </tr>`).join('')}</tbody></table>`;
    }

    function tabellaChiuse(chiuse) {
        if (!chiuse.length) return '<p class="st-vuoto">Nessuna segnalazione chiusa.</p>';
        return `<table class="st-tabella"><thead><tr>
            <th>N.</th><th>Segnalazione</th><th>Squadre</th><th>Esito</th><th>Chiusa</th>
            </tr></thead><tbody>${chiuse.map(r => `<tr>
                <td class="st-n">${e(r.numero ?? r.id)}</td>
                <td><strong>${e(r.title)}</strong>${r.location_address ? `<span class="st-piccolo">${e(r.location_address)}</span>` : ''}</td>
                <td>${e(r.squadre || r.motivo_senza_squadra || '—')}</td>
                <td>${r.ultimo_testo && !r.ultimo_di_sistema ? e(r.ultimo_testo) : '—'}</td>
                <td class="st-stretta">${e(quando(r.updated_at))}</td>
            </tr>`).join('')}</tbody></table>`;
    }

    function tabellaSquadre(squadre, chiusa) {
        if (!squadre.length) return `<p class="st-vuoto">${chiusa ? 'Nessuna squadra registrata.' : 'Nessuna squadra in campo.'}</p>`;
        if (chiusa) {
            return `<table class="st-tabella"><thead><tr><th>Squadra</th><th>Chi ne ha fatto parte</th><th>Interventi</th></tr></thead>
                <tbody>${squadre.map(s => `<tr>
                    <td class="st-stretta"><strong>${e(s.nome_radio)}</strong>${s.nome && s.nome !== s.nome_radio ? `<span class="st-piccolo">${e(s.nome)}</span>` : ''}</td>
                    <td>${e(persone(s.membri) || '—')}</td>
                    <td class="st-stretta">${e(s.interventi)}</td>
                </tr>`).join('')}</tbody></table>`;
        }
        return `<table class="st-tabella"><thead><tr><th>Squadra</th><th>Componenti</th><th>Impegno</th><th>Posizione</th></tr></thead>
            <tbody>${squadre.map(s => `<tr>
                <td class="st-stretta"><strong>${e(s.nome_radio)}</strong>${s.nome && s.nome !== s.nome_radio ? `<span class="st-piccolo">${e(s.nome)}</span>` : ''}</td>
                <td>${e(persone(s.membri) || '—')}</td>
                <td>${s.impegno ? `Su n. ${e(s.impegno.numero ?? s.impegno.id)}<span class="st-piccolo">${e(s.impegno.title)}</span>` : 'Libera'}</td>
                <td class="st-stretta">${s.ultima_posizione ? `${e(quando(s.ultima_posizione))}<span class="st-piccolo">${e(durata(s.ultima_posizione))} fa</span>` : '—'}</td>
            </tr>`).join('')}</tbody></table>`;
    }

    // Le funzioni di supporto: per ognuna il referente e i suoi incarichi,
    // prima quelli ancora da fare. È il foglio del giro di tavolo.
    const STATO_INCARICO = { aperto: 'Aperto', in_corso: 'In corso', concluso: 'Concluso' };
    function sezioneFunzioni(funzioni) {
        if (!Array.isArray(funzioni)) return '';
        const corpo = funzioni.length ? funzioni.map(f => {
            const aperti = f.incarichi.filter(i => i.stato !== 'concluso').length;
            return `<h3 class="st-funzione">${e(f.sigla)} ${e(f.nome)}
                    <span class="st-conta">${aperti} da fare, ${f.incarichi.length - aperti} conclusi${f.referenti ? ` · referente ${e(f.referenti)}` : ''}</span></h3>
                <table class="st-tabella"><thead><tr><th>N.</th><th>Segnalazione</th><th>Perché</th><th>Stato o esito</th><th>Da</th></tr></thead>
                <tbody>${f.incarichi.map(i => `<tr>
                    <td class="st-n">${e(i.numero ?? i.report_id)}</td>
                    <td><strong>${e(i.titolo)}</strong>${i.indirizzo ? `<span class="st-piccolo">${e(i.indirizzo)}</span>` : ''}</td>
                    <td>${e(i.motivazione)}</td>
                    <td>${i.stato === 'concluso'
                        ? `${e(i.esito || '')}<span class="st-piccolo">concluso ${e(quando(i.concluso_il))}${i.concluso_da ? ` · ${e(i.concluso_da)}` : ''}</span>`
                        : `<span class="st-bollino ${i.stato === 'aperto' ? 'st-alta' : 'st-media'}">${e(STATO_INCARICO[i.stato] || i.stato)}</span>${i.in_carico_da ? `<span class="st-piccolo">in carico a ${e(i.in_carico_da)}</span>` : ''}`}</td>
                    <td class="st-stretta">${i.stato === 'concluso' ? '' : e(durata(i.assegnato_il))}<span class="st-piccolo">dalle ${e(quando(i.assegnato_il))}</span></td>
                </tr>`).join('')}</tbody></table>`;
        }).join('') : '<p class="st-vuoto">Nessun incarico alle funzioni.</p>';
        return `<section class="st-sezione"><h2>Funzioni di supporto</h2>${corpo}</section>`;
    }

    // Strade chiuse e zone dell'emergenza: prima quelle in vigore.
    const TIPO_MAPPA = {
        strada_chiusa: 'Strada chiusa', zona_interdetta: 'Zona interdetta', pericolo_alluvione: 'Pericolo alluvione',
        pericolo_frana: 'Pericolo frana', pericolo_generico: 'Zona di pericolo', area_attesa: 'Area di attesa', area_accoglienza: 'Area di accoglienza',
        area_ammassamento: 'Area di ammassamento', altro: 'Altro'
    };
    function sezioneMappa(elementi, chiusa) {
        if (!Array.isArray(elementi)) return '';
        // La viabilità interessa sempre a chi legge: anche "nessuna" è un'informazione.
        if (!elementi.length) {
            return chiusa ? '' : '<section class="st-sezione"><h2>Strade chiuse e zone</h2><p class="st-vuoto">Nessuna strada chiusa e nessuna zona segnalata.</p></section>';
        }
        const inVigore = elementi.filter(m => !m.rimosso_il).length;
        return `<section class="st-sezione"><h2>Strade chiuse e zone <span class="st-conta">(${inVigore} ${chiusa ? 'rimaste' : 'in vigore'})</span></h2>
            <table class="st-tabella"><thead><tr><th>Tipo</th><th>Dove</th><th>Note</th><th>Dal</th><th>Stato</th></tr></thead>
            <tbody>${elementi.map(m => `<tr>
                <td class="st-stretta"><strong>${e(TIPO_MAPPA[m.tipo] || m.tipo)}</strong>${m.livello ? `<span class="st-piccolo">${e(m.livello)}</span>` : ''}</td>
                <td>${e(m.nome || '—')}</td>
                <td>${e(m.note || '')}</td>
                <td class="st-stretta">${e(quando(m.creato_il))}${m.creato_da ? `<span class="st-piccolo">${e(m.creato_da)}</span>` : ''}</td>
                <td class="st-stretta">${m.rimosso_il
                    ? `Tolta ${e(quando(m.rimosso_il))}${m.rimosso_da ? `<span class="st-piccolo">${e(m.rimosso_da)}</span>` : ''}`
                    : `<span class="st-bollino st-alta">In vigore</span>${m.oltre_emergenza ? '<span class="st-piccolo">resta dopo la chiusura</span>' : ''}`}</td>
            </tr>`).join('')}</tbody></table></section>`;
    }

    // Una segnalazione per intero, come la stampa della singola scheda.
    function scheda(r) {
        const coordinate = r.latitude != null && r.longitude != null ? `${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}` : null;
        const campo = (etichetta, valore) => valore ? `<div><dt>${e(etichetta)}</dt><dd>${e(valore)}</dd></div>` : '';
        const voci = (r.diario || []).map(v => `<li${v.sistema ? ' class="st-sistema"' : ''}><time>${e(quando(v.quando))}</time>${v.funzione ? `<strong>${e(v.funzione)}</strong> ` : ''}${e(v.testo)}${v.autore && !v.sistema ? ` <span class="st-autore">— ${e(v.autore)}</span>` : ''}</li>`).join('');
        return `<article class="st-scheda">
            <h3><span class="st-n">N. ${e(r.numero ?? r.id)}</span> ${e(r.title)}
                ${bollinoPriorita(r.priority)} <span class="st-bollino st-stato">${e(STATO[r.status] || r.status)}</span></h3>
            <dl class="st-campi">
                ${campo('Indirizzo', r.location_address)}${campo('Coordinate', coordinate)}
                ${campo('Segnalante', [r.reporter_name, r.reporter_contact].filter(Boolean).join(' · '))}
                ${campo('Squadre', r.squadre || r.motivo_senza_squadra || 'Nessuna squadra')}
                ${campo('Aperta', `${dataOra(r.created_at)}${r.creata_da ? ` da ${r.creata_da}` : ''}`)}
                ${campo('Ultimo aggiornamento', dataOra(r.updated_at))}
                ${campo('Pericolo ambientale', r.pericolo)}
            </dl>
            ${r.description ? `<p class="st-descrizione">${e(r.description)}</p>` : ''}
            ${(r.foto || []).length ? `<div class="st-foto">${r.foto.map(u => `<img src="${escapeHTML(String(u))}" alt="Foto della segnalazione ${escapeHTML(String(r.numero ?? r.id))}" loading="eager">`).join('')}</div>` : ''}
            <h4>Diario</h4>
            ${voci ? `<ul class="st-diario">${voci}</ul>` : '<p class="st-vuoto">Nessuna nota.</p>'}
        </article>`;
    }

    function sezioneSchede(schede) {
        if (!Array.isArray(schede)) return '';
        return `<section class="st-sezione st-schede"><h2>Le segnalazioni, una per una <span class="st-conta">(${schede.length})</span></h2>
            ${schede.length ? schede.map(scheda).join('') : '<p class="st-vuoto">Nessuna segnalazione.</p>'}</section>`;
    }

    function diario(voci, troncato) {
        if (!voci.length) return '<p class="st-vuoto">Nessuna nota di sala.</p>';
        return `${troncato ? `<p class="st-piccolo">Le ultime ${voci.length} note; le altre sono nel centro operativo.</p>` : ''}
            <ul class="st-diario">${voci.map(v => `<li><time>${e(quando(v.creata_il))}</time>${e(v.testo)}${v.autore_nome ? ` <span class="st-autore">— ${e(v.autore_nome)}</span>` : ''}</li>`).join('')}</ul>`;
    }

    // Il quadro della situazione in testa al foglio: solo quello che è stato
    // scritto, con quando e da chi, perché chi legge sappia quanto è fresco.
    const VOCI_POPOLAZIONE = [['evacuati', 'Evacuati'], ['assistiti', 'Assistiti'], ['isolati', 'Isolati'],
        ['feriti', 'Feriti'], ['dispersi', 'Dispersi'], ['deceduti', 'Deceduti']];
    function sezioneQuadro(q, chiusa) {
        const popolazione = q ? VOCI_POPOLAZIONE.filter(([k]) => Number.isInteger(q[k])) : [];
        const vuoto = !q || (!q.descrizione && !popolazione.length && !q.servizi && !q.richieste);
        if (vuoto) {
            return chiusa ? '' : `<section class="st-sezione st-solo-schermo st-quadro-vuoto"><p><strong>Il quadro della situazione non è compilato.</strong>
                È la prima cosa che cerca chi legge il foglio fuori dalla sala: che cosa succede, la popolazione coinvolta, i servizi
                interrotti, le richieste di supporto. Si compila con "Quadro della situazione", in alto.</p></section>`;
        }
        const riga = (etichetta, testo) => testo ? `<div class="st-quadro-riga"><h3>${e(etichetta)}</h3><p>${e(testo)}</p></div>` : '';
        return `<section class="st-sezione st-quadro"><h2>Quadro della situazione
                <span class="st-conta">aggiornato ${e(quando(q.aggiornato_il))}${q.aggiornato_da ? ` da ${e(q.aggiornato_da)}` : ''}</span></h2>
            ${q.descrizione ? `<p class="st-quadro-testo">${e(q.descrizione)}</p>` : ''}
            ${popolazione.length ? `<div class="st-popolazione">${popolazione.map(([k, etichetta]) =>
                `<div class="st-popolazione-voce${['feriti', 'dispersi', 'deceduti'].includes(k) && q[k] > 0 ? ' st-allarme' : ''}"><strong>${e(q[k])}</strong><span>${e(etichetta)}</span></div>`).join('')}</div>` : ''}
            ${riga('Servizi essenziali interrotti', q.servizi)}
            ${riga('Richieste di supporto', q.richieste)}
        </section>`;
    }

    // "oggi alle 14:00" o "8 ott alle 08:00" dal campo data e ora.
    function prossimoAggiornamento(v) {
        if (!v) return '';
        const d = new Date(v);
        if (isNaN(d.getTime())) return '';
        const oggi = d.toDateString() === new Date().toDateString();
        return `${oggi ? 'oggi' : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle ${ora(d)}`;
    }

    function disegna(d, logo) {
        const { emergenza, chiusa, aperte, chiuse, squadre } = d;
        const alta = aperte.filter(r => r.priority === 'High').length;
        const senzaSquadra = aperte.filter(r => !r.squadre && !r.motivo_senza_squadra).length;
        const sim = emergenza.simulazione === true;
        const titolo = chiusa ? (completo ? `Resoconto completo ${sim ? 'della simulazione' : "dell'emergenza"}` : `Resoconto ${sim ? 'della simulazione' : "dell'emergenza"}`)
            : (completo ? 'Situazione completa' : 'Punto di situazione');
        document.title = `${titolo} ${emergenza.code} - ORION`;

        const sintesi = chiusa ? [
            numero(aperte.length + chiuse.length, 'Segnalazioni'),
            numero(aperte.length, 'Rimaste aperte', '', aperte.length > 0),
            numero(squadre.length, 'Squadre impiegate'),
            numero(durata(emergenza.start_time, emergenza.end_time), 'Durata')
        ] : [
            numero(aperte.length, 'Segnalazioni aperte', [alta && `${alta} ad alta priorità`, senzaSquadra && `${senzaSquadra} in attesa di squadra`].filter(Boolean).join(' · '), alta > 0 || senzaSquadra > 0),
            numero(chiuse.length, 'Chiuse'),
            numero(squadre.filter(s => s.impegno).length, 'Squadre impegnate',
                `${squadre.filter(s => !s.impegno).length} libere · ${squadre.reduce((n, s) => n + (s.membri || []).length, 0)} volontari in squadra`),
            numero(durata(emergenza.start_time), 'In corso da')
        ];

        // Il logo del gruppo in filigrana, al centro di ogni pagina stampata.
        foglio.innerHTML = `
            ${logo ? `<img class="st-filigrana" src="${e(logo)}" alt="" aria-hidden="true">` : ''}
            ${sim ? `<div class="st-simulazione" aria-hidden="true">SIMULAZIONE</div><p class="st-fascia-simulazione">SIMULAZIONE · scenario simulato in sala, non un'emergenza reale</p>` : ''}
            <header class="st-testa">
                ${logo ? `<img src="${e(logo)}" alt="">` : ''}
                <div>
                    ${d.associazione ? `<p class="st-ente">${e(d.associazione)}</p>` : ''}
                    <h1>${titolo}</h1>
                    <p class="st-emergenza">${e(emergenza.code)}${emergenza.name ? ` — ${e(emergenza.name)}` : ''}</p>
                </div>
            </header>
            <div class="st-meta">
                <span>Aperta il <strong>${e(dataLunga(emergenza.start_time))}</strong></span>
                ${chiusa ? `<span>Chiusa il <strong>${e(dataLunga(emergenza.end_time))}</strong></span>` : `<span>Situazione alle <strong>${e(dataLunga(d.generato_il))}</strong></span>`}
                <span>Redatto da <strong>${e(d.generato_da)}</strong></span>
                ${d.quadro?.responsabile ? `<span>Responsabile <strong>${e(d.quadro.responsabile)}</strong></span>` : ''}
                ${d.quadro?.recapito ? `<span>Recapito del COC <strong>${e(d.quadro.recapito)}</strong></span>` : ''}
                ${!chiusa && d.quadro?.prossimo ? `<span class="st-prossimo">Prossimo aggiornamento <strong>${e(prossimoAggiornamento(d.quadro.prossimo))}</strong></span>` : ''}
            </div>
            ${sezioneQuadro(d.quadro, chiusa)}
            <div class="st-sintesi">${sintesi.join('')}</div>
            <section class="st-sezione"><h2>Segnalazioni ${chiusa ? 'rimaste aperte' : 'aperte'} <span class="st-conta">(${aperte.length})</span></h2>${tabellaAperte(aperte)}</section>
            ${sezioneMappa(d.mappa, chiusa)}
            ${sezioneFunzioni(d.funzioni)}
            <section class="st-sezione"><h2>Squadre <span class="st-conta">(${squadre.length})</span></h2>${tabellaSquadre(squadre, chiusa)}</section>
            <section class="st-sezione"><h2>Segnalazioni chiuse <span class="st-conta">(${chiuse.length})</span></h2>${tabellaChiuse(chiuse)}</section>
            <section class="st-sezione"><h2>Diario di sala</h2>${diario(d.diario, d.diario_troncato)}</section>
            ${sezioneSchede(d.schede)}
            <p class="st-piede">Generato da ORION il ${e(dataLunga(d.generato_il))}. ${chiusa ? '' : 'La situazione cambia: fa fede quella del centro operativo.'}</p>
            ${d.sigillo ? `<p class="st-sigillo">${d.sigillo.alla_chiusura ? 'Sigillo dello storico alla chiusura' : 'Sigillo dello storico'}: ${e(d.sigillo.testo)}</p>` : ''}`;
        foglio.setAttribute('aria-busy', 'false');
        nota.textContent = chiusa ? '' : `Aggiornato alle ${ora(d.generato_il)}`;
    }

    async function carica() {
        foglio.setAttribute('aria-busy', 'true');
        try {
            const q = new URLSearchParams();
            if (emergenzaRichiesta) q.set('emergenza', emergenzaRichiesta);
            if (completo) q.set('completo', '1');
            const url = '/api/situazione' + (q.toString() ? `?${q}` : '');
            const [dati, marchio] = await Promise.all([
                fetchApi(url),
                fetchApi('/api/branding').catch(() => null)
            ]);
            const logo = marchio?.logoUrl ? `${marchio.logoUrl}?v=${marchio.logoVersion}` : null;
            disegna(dati, logo);
            ultimiDati = dati;
            document.getElementById('st-quadro-apri').hidden = dati.chiusa;
        } catch (err) {
            foglio.innerHTML = `<div class="st-errore"><p><strong>Il punto di situazione non si è potuto preparare.</strong></p><p>${e(err.message)}</p></div>`;
        }
    }

    // --- Il modulo del quadro -----------------------------------------------
    let ultimiDati = null;
    const modulo = document.getElementById('st-quadro');
    const campo = (k) => document.getElementById(`q-${k}`);
    const CAMPI_TESTO = ['descrizione', 'servizi', 'richieste', 'recapito', 'responsabile', 'prossimo'];

    async function apriQuadro() {
        modulo.hidden = false;
        document.getElementById('q-stato').textContent = '';
        try {
            const { quadro, proposta } = await fetchApi('/api/situazione/quadro');
            const valori = quadro || proposta || {};
            CAMPI_TESTO.forEach(k => { campo(k).value = valori[k] ?? ''; });
            VOCI_POPOLAZIONE.forEach(([k]) => { campo(k).value = Number.isInteger(valori[k]) ? valori[k] : ''; });
            if (quadro) document.getElementById('q-stato').textContent = `Ultima modifica ${quando(quadro.aggiornato_il)}${quadro.aggiornato_da ? ` di ${quadro.aggiornato_da}` : ''}.`;
            else if (proposta && Object.keys(proposta).length) document.getElementById('q-stato').textContent = "Recapito e responsabile proposti dall'emergenza precedente.";
        } catch (err) {
            document.getElementById('q-stato').textContent = err.message;
        }
        campo('descrizione').focus();
        modulo.scrollIntoView({ block: 'start' });
    }

    modulo.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const corpo = {};
        CAMPI_TESTO.forEach(k => { corpo[k] = campo(k).value; });
        VOCI_POPOLAZIONE.forEach(([k]) => { corpo[k] = campo(k).value === '' ? null : Number(campo(k).value); });
        const salva = document.getElementById('q-salva');
        salva.disabled = true;
        try {
            await fetchApi('/api/situazione/quadro', { method: 'PUT', body: JSON.stringify(corpo) });
            modulo.hidden = true;
            await carica();
        } catch (err) {
            document.getElementById('q-stato').textContent = err.message;
        } finally {
            salva.disabled = false;
        }
    });
    document.getElementById('q-annulla').addEventListener('click', () => { modulo.hidden = true; });
    document.getElementById('st-quadro-apri').addEventListener('click', apriQuadro);

    document.getElementById('st-stampa').addEventListener('click', () => window.print());
    document.getElementById('st-aggiorna').addEventListener('click', carica);
    if (emergenzaRichiesta) document.getElementById('st-aggiorna').hidden = true;
    carica();
})();
