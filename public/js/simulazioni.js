// La pagina Simulazioni, per chi organizza le attività: la biblioteca degli
// scenari (src/scenari.js) e, sotto, le simulazioni in programma e quelle
// svolte. Uno scenario si crea con i suoi dati e si passa subito al copione
// (/copione.html?scenario=N); "Pianifica" apre il calendario con il modulo
// della nuova attività già riempito dallo scenario.

document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const el = (tag, classe, testo) => {
        const e = document.createElement(tag);
        if (classe) e.className = classe;
        if (testo !== undefined && testo !== null) e.textContent = testo;
        return e;
    };
    const data = (v) => new Date(String(v).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    const giorno = (v) => data(v).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    const giornoOra = (v) => data(v).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const ore = (n) => (n === 1 ? 'circa 1 ora' : `circa ${n} ore`);
    const NATURE = { addestramento: 'Addestramento', esercitazione: 'Esercitazione' };

    let elenco = null;          // la risposta di GET /api/scenari
    let inModifica = null;      // lo scenario nel modulo (null: nuovo)

    function link(testo, href, icona) {
        const a = el('a', 'button-style button-secondary');
        a.href = href;
        if (icona) { const i = el('i', `fas ${icona}`); i.setAttribute('aria-hidden', 'true'); a.appendChild(i); }
        a.append(testo);
        return a;
    }
    function bottoneIcona(icona, titolo, azione, classe = '') {
        const b = el('button', `btn-icona ${classe}`.trim());
        b.type = 'button';
        b.title = titolo;
        b.setAttribute('aria-label', titolo);
        const i = el('i', `fas ${icona}`); i.setAttribute('aria-hidden', 'true');
        b.appendChild(i);
        b.addEventListener('click', azione);
        return b;
    }

    // --- Gli scenari -----------------------------------------------------------------------
    function usoDi(s) {
        if (s.prossimo_uso) return `In programma il ${giorno(s.prossimo_uso)}${s.usi > 1 ? ` · usato ${s.usi} volte` : ''}`;
        if (s.usi) return `Usato ${s.usi === 1 ? 'una volta' : `${s.usi} volte`}, l'ultima il ${giorno(s.ultimo_uso || s.aggiornato_il)}`;
        return 'Mai usato';
    }

    function disegnaScenari() {
        const box = $('elenco-scenari');
        box.replaceChildren();
        const cerca = $('cerca-scenari').value.trim().toLowerCase();
        const scenari = elenco.scenari.filter(s => !cerca || [s.titolo, s.scenario, s.obiettivi, s.enti].some(t => (t || '').toLowerCase().includes(cerca)));
        if (!elenco.scenari.length) {
            const v = el('div', 'vuoto-scenari');
            v.appendChild(el('p', '', 'Nessuno scenario ancora. Preparane uno con calma: la situazione, gli obiettivi e gli eventi del copione. Poi lo pianifichi quando vuoi, anche più volte.'));
            const b = el('button', 'button-style', 'Prepara il primo scenario');
            b.type = 'button';
            b.addEventListener('click', () => apriModulo());
            v.appendChild(b);
            box.appendChild(v);
            return;
        }
        if (!scenari.length) { box.appendChild(el('p', 'nota', 'Nessuno scenario corrisponde alla ricerca.')); return; }
        for (const s of scenari) {
            const c = el('article', 'scheda-scenario');
            // In testa il titolo e, a destra, i comandi di servizio.
            const testa = el('div', 'testa-scenario');
            testa.appendChild(el('h3', '', s.titolo));
            const secondarie = el('div', 'secondarie');
            secondarie.append(
                bottoneIcona('fa-pen', 'Modifica i dati', () => apriModulo(s)),
                bottoneIcona('fa-clone', 'Duplica (con il copione)', () => duplica(s)),
                bottoneIcona('fa-trash', 'Togli lo scenario', () => togli(s), 'pericolo'));
            testa.appendChild(secondarie);
            c.appendChild(testa);
            const segni = el('div', 'segni');
            segni.appendChild(el('span', 'pastiglia simulazione', NATURE[s.natura]));
            segni.appendChild(el('span', 'pastiglia neutra', ore(s.durata_ore)));
            segni.appendChild(el('span', `pastiglia ${s.eventi ? 'ok' : 'attesa'}`, s.eventi ? `${s.eventi} ${s.eventi === 1 ? 'evento' : 'eventi'}` : 'copione vuoto'));
            c.appendChild(segni);
            if (s.scenario) c.appendChild(el('p', 'testo-scenario', s.scenario));
            c.appendChild(el('p', 'uso nota', usoDi(s)));
            const azioni = el('div', 'azioni-scenario');
            const copione = link(' Copione', `/copione.html?scenario=${s.id}`, 'fa-list-ol');
            copione.className = 'button-style';
            azioni.append(copione, link(' Pianifica', `/calendario.html?scenario=${s.id}`, 'fa-calendar-plus'));
            c.appendChild(azioni);
            box.appendChild(c);
        }
    }

    // --- Le simulazioni del calendario ------------------------------------------------------------
    function disegnaSimulazioni(id, righe, vuoto, svolte) {
        const ul = $(id);
        ul.replaceChildren();
        if (!righe.length) { ul.appendChild(el('li', 'nota', vuoto)); return; }
        for (const a of righe) {
            const li = el('li');
            li.appendChild(el('span', 'quando', giornoOra(a.inizio)));
            const cosa = el('span', 'cosa');
            cosa.appendChild(el('strong', '', a.titolo));
            const dettagli = [a.tipo, a.simulazione === 'sala' ? 'scenario in sala' : 'solo allertamento',
                a.simulazione === 'sala' ? (a.eventi ? `${a.eventi} ${a.eventi === 1 ? 'evento' : 'eventi'}` : 'copione vuoto') : null,
                a.scenario_titolo ? `dallo scenario "${a.scenario_titolo}"` : null,
                a.sala ? `sala ${a.sala}` : null];
            cosa.appendChild(el('small', '', dettagli.filter(Boolean).join(' · ')));
            li.appendChild(cosa);
            const vai = el('span', 'link-riga');
            if (a.simulazione === 'sala') {
                const c = el('a', '', svolte ? 'Valutazione' : 'Copione');
                c.href = `/copione.html?attivita=${a.id}${svolte ? '#valutazione' : ''}`;
                vai.appendChild(c);
            }
            const cal = el('a', '', 'Nel calendario');
            cal.href = `/calendario.html?attivita=${a.id}`;
            vai.appendChild(cal);
            li.appendChild(vai);
            ul.appendChild(li);
        }
    }

    async function carica() {
        try {
            elenco = await fetchApi('/api/scenari');
        } catch (e) {
            if (e.body?.modulo_spento) {
                $('modulo-spento').hidden = false;
                $('contenuto-simulazioni').hidden = true;
                return;
            }
            // Senza il permesso resta solo il motivo: niente pulsanti che poi rispondono di no.
            if (e.status === 403) {
                $('contenuto-simulazioni').replaceChildren(el('p', 'riquadro-avviso', `${e.message} Se ti serve, chiedilo a un amministratore.`));
                return;
            }
            $('elenco-scenari').replaceChildren(el('p', 'nota', e.message));
            return;
        }
        disegnaScenari();
        disegnaSimulazioni('elenco-programmate', elenco.programmate, 'Nessuna simulazione in programma. Si pianifica da uno scenario, o dal calendario.');
        disegnaSimulazioni('elenco-svolte', elenco.svolte, 'Nessuna simulazione svolta.', true);
    }

    // --- Il modulo dello scenario ------------------------------------------------------------------
    for (const h of [1, 2, 3, 4, 5, 6, 8, 10, 12, 24, 36, 48, 72]) $('s-durata').appendChild(new Option(h === 1 ? '1 ora' : `${h} ore`, h));
    const aggiornaEnti = () => { $('campo-s-enti').hidden = $('s-natura').value !== 'esercitazione'; };
    $('s-natura').addEventListener('change', aggiornaEnti);

    function apriModulo(s = null) {
        inModifica = s;
        $('form-scenario').reset();
        $('scenario-titolo').textContent = s ? 'Modifica lo scenario' : 'Nuovo scenario';
        $('salva-scenario').textContent = s ? 'Salva' : 'Crea e scrivi il copione';
        $('s-titolo').value = s?.titolo || '';
        $('s-natura').value = s?.natura || 'addestramento';
        // Una durata scritta a mano (per esempio 7) resta fra le scelte.
        const durata = String(s?.durata_ore || 3);
        if (![...$('s-durata').options].some(o => o.value === durata)) $('s-durata').appendChild(new Option(`${durata} ore`, durata));
        $('s-durata').value = durata;
        $('s-scenario').value = s?.scenario || '';
        $('s-obiettivi').value = s?.obiettivi || '';
        $('s-enti').value = s?.enti || '';
        aggiornaEnti();
        $('modale-scenario').hidden = false;
        $('s-titolo').focus();
    }
    const chiudiModulo = () => { $('modale-scenario').hidden = true; };
    $('modale-scenario').addEventListener('click', (e) => {
        if (e.target === $('modale-scenario') || e.target.closest('[data-chiudi]')) chiudiModulo();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modale-scenario').hidden) chiudiModulo(); });

    $('form-scenario').addEventListener('submit', async (e) => {
        e.preventDefault();
        const corpo = {
            titolo: $('s-titolo').value.trim(),
            natura: $('s-natura').value,
            durata_ore: Number($('s-durata').value),
            scenario: $('s-scenario').value.trim(),
            obiettivi: $('s-obiettivi').value.trim(),
            enti: $('s-natura').value === 'esercitazione' ? $('s-enti').value.trim() : ''
        };
        const pulsante = $('salva-scenario');
        pulsante.disabled = true;
        try {
            if (inModifica) {
                await fetchApi(`/api/scenari/${inModifica.id}`, { method: 'PUT', body: JSON.stringify(corpo) });
                chiudiModulo();
                notifica('Scenario salvato.', 'successo');
                await carica();
            } else {
                // Uno scenario nuovo non ha ancora eventi: si va subito a scriverli.
                const s = await fetchApi('/api/scenari', { method: 'POST', body: JSON.stringify(corpo) });
                window.location.href = `/copione.html?scenario=${s.id}`;
            }
        } catch (err) {
            notifica(err.message, 'errore');
        } finally {
            pulsante.disabled = false;
        }
    });

    async function duplica(s) {
        try {
            const nuovo = await fetchApi(`/api/scenari/${s.id}/duplica`, { method: 'POST', body: '{}' });
            notifica(`Creato "${nuovo.titolo}": cambialo come serve.`, 'successo');
            await carica();
        } catch (e) { notifica(e.message, 'errore'); }
    }

    async function togli(s) {
        const usato = !s.usi ? '' : s.usi === 1 ? "\n\nL'attività già nata da questo scenario resta, con la sua copia del copione."
            : `\n\nLe ${s.usi} attività già nate da questo scenario restano, con la loro copia del copione.`;
        if (!confirm(`Togliere lo scenario "${s.titolo}" e il suo copione?${usato}`)) return;
        try {
            await fetchApi(`/api/scenari/${s.id}`, { method: 'DELETE' });
            notifica('Scenario tolto.', 'successo');
            await carica();
        } catch (e) { notifica(e.message, 'errore'); }
    }

    $('btn-nuovo-scenario').addEventListener('click', () => apriModulo());
    $('cerca-scenari').addEventListener('input', () => { if (elenco) disegnaScenari(); });
    carica();
});
