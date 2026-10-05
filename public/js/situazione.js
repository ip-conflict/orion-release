// public/js/situazione.js
//
// Il punto di situazione su un foglio A4: /situazione.html per l'emergenza in
// corso, /situazione.html?emergenza=ID per una chiusa (il resoconto, dall'archivio).

(function () {
    const foglio = document.getElementById('st-foglio');
    const nota = document.getElementById('st-nota');
    const emergenzaRichiesta = new URLSearchParams(location.search).get('emergenza');

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

    const persone = (membri) => (membri || []).map(m => [m.cognome, m.nome].filter(Boolean).join(' ')).filter(Boolean).join(', ');

    function numero(valore, etichetta, sotto = '', allarme = false) {
        return `<div class="st-numero${allarme ? ' st-allarme' : ''}"><div class="st-valore">${e(valore)}</div>
            <div class="st-etichetta">${e(etichetta)}</div>${sotto ? `<div class="st-sotto">${e(sotto)}</div>` : ''}</div>`;
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
                        : '<span class="st-piccolo st-senza">Nessuna squadra</span>'}</td>
                <td>${r.ultimo_testo ? `${e(r.ultimo_testo)}<span class="st-piccolo">${e(quando(r.ultimo_il))}${r.ultimo_autore ? ` · ${e(r.ultimo_autore)}` : ''}</span>` : '<span class="st-piccolo">—</span>'}</td>
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

    function diario(voci, troncato) {
        if (!voci.length) return '<p class="st-vuoto">Nessuna nota di sala.</p>';
        return `${troncato ? `<p class="st-piccolo">Le ultime ${voci.length} note; le altre sono nel centro operativo.</p>` : ''}
            <ul class="st-diario">${voci.map(v => `<li><time>${e(quando(v.creata_il))}</time>${e(v.testo)}${v.autore_nome ? ` <span class="st-autore">— ${e(v.autore_nome)}</span>` : ''}</li>`).join('')}</ul>`;
    }

    function disegna(d, logo) {
        const { emergenza, chiusa, aperte, chiuse, squadre } = d;
        const alta = aperte.filter(r => r.priority === 'High').length;
        const senzaSquadra = aperte.filter(r => !r.squadre && !r.motivo_senza_squadra).length;
        const titolo = chiusa ? "Resoconto dell'emergenza" : 'Punto di situazione';
        document.title = `${titolo} ${emergenza.code} - ORION`;

        const sintesi = chiusa ? [
            numero(aperte.length + chiuse.length, 'Segnalazioni'),
            numero(aperte.length, 'Rimaste aperte', '', aperte.length > 0),
            numero(squadre.length, 'Squadre impiegate'),
            numero(durata(emergenza.start_time, emergenza.end_time), 'Durata')
        ] : [
            numero(aperte.length, 'Segnalazioni aperte', [alta && `${alta} ad alta priorità`, senzaSquadra && `${senzaSquadra} senza squadra`].filter(Boolean).join(' · '), alta > 0 || senzaSquadra > 0),
            numero(chiuse.length, 'Chiuse'),
            numero(squadre.filter(s => s.impegno).length, 'Squadre impegnate', `${squadre.filter(s => !s.impegno).length} libere`),
            numero(durata(emergenza.start_time), 'In corso da')
        ];

        foglio.innerHTML = `
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
            </div>
            <div class="st-sintesi">${sintesi.join('')}</div>
            <section class="st-sezione"><h2>Segnalazioni ${chiusa ? 'rimaste aperte' : 'aperte'} <span class="st-conta">(${aperte.length})</span></h2>${tabellaAperte(aperte)}</section>
            <section class="st-sezione"><h2>Squadre <span class="st-conta">(${squadre.length})</span></h2>${tabellaSquadre(squadre, chiusa)}</section>
            <section class="st-sezione"><h2>Segnalazioni chiuse <span class="st-conta">(${chiuse.length})</span></h2>${tabellaChiuse(chiuse)}</section>
            <section class="st-sezione"><h2>Diario di sala</h2>${diario(d.diario, d.diario_troncato)}</section>
            <p class="st-piede">Generato da ORION il ${e(dataLunga(d.generato_il))}. ${chiusa ? '' : 'La situazione cambia: fa fede quella del centro operativo.'}</p>`;
        foglio.setAttribute('aria-busy', 'false');
        nota.textContent = chiusa ? '' : `Aggiornato alle ${ora(d.generato_il)}`;
    }

    async function carica() {
        foglio.setAttribute('aria-busy', 'true');
        try {
            const url = '/api/situazione' + (emergenzaRichiesta ? `?emergenza=${encodeURIComponent(emergenzaRichiesta)}` : '');
            const [dati, marchio] = await Promise.all([
                fetchApi(url),
                fetchApi('/api/branding').catch(() => null)
            ]);
            const logo = marchio?.logoUrl ? `${marchio.logoUrl}?v=${marchio.logoVersion}` : null;
            disegna(dati, logo);
        } catch (err) {
            foglio.innerHTML = `<div class="st-errore"><p><strong>Il punto di situazione non si è potuto preparare.</strong></p><p>${e(err.message)}</p></div>`;
        }
    }

    document.getElementById('st-stampa').addEventListener('click', () => window.print());
    document.getElementById('st-aggiorna').addEventListener('click', carica);
    if (emergenzaRichiesta) document.getElementById('st-aggiorna').hidden = true;
    carica();
})();
