// La risposta a una chiamata della sala, aperta dal collegamento dell'email
// (/chiamata.html?id=N): arrivo, arrivo fra..., non posso; una volta in
// sede, "Sono arrivato". Dall'app si risponde dalla notifica.
document.addEventListener('DOMContentLoaded', async () => {
    const scheda = document.getElementById('scheda');
    let id = Number(new URLSearchParams(location.search).get('id'));
    const el = (tag, classe, testo) => {
        const e = document.createElement(tag);
        if (classe) e.className = classe;
        if (testo !== undefined && testo !== null) e.textContent = testo;
        return e;
    };
    const data = (v) => new Date(String(v).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    const ora = (v) => data(v).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

    function statoLeggibile(c) {
        switch (c.stato) {
            case 'in_arrivo': return c.risposta === 'ritardo' && c.arrivo_previsto ? `Hai risposto: arrivo verso le ${ora(c.arrivo_previsto)}.` : 'Hai risposto: arrivo.';
            case 'arrivato': return `Sei in sede dalle ${ora(c.arrivato_il)}.`;
            case 'non_disponibile': return 'Hai risposto: non posso.';
            case 'congedato': return 'La sala ti ha congedato. Grazie.';
            default: return 'Non hai ancora risposto.';
        }
    }

    async function carica() {
        let c;
        try {
            c = await fetchApi(`/api/chiamate/${id}`);
        } catch (e) {
            scheda.classList.add('chiusa');
            scheda.replaceChildren(el('p', '', e.message || 'Chiamata non trovata.'));
            return;
        }
        scheda.classList.toggle('chiusa', !c.aperta);
        scheda.replaceChildren();
        if (c.simulazione) scheda.appendChild(el('span', 'segno-simulazione', 'SIMULAZIONE'));
        scheda.appendChild(el('h2', '', c.emergency_id
            ? `Emergenza ${c.emergenza_codice}${c.emergenza_nome ? ` - ${c.emergenza_nome}` : ''}`
            : c.attivita_titolo || 'Attività'));
        scheda.appendChild(el('p', 'nota', `Chiamata delle ${ora(c.creata_il)}${c.creata_da_nome ? `, da ${c.creata_da_nome}` : ''}.`));
        scheda.appendChild(el('p', 'messaggio', c.messaggio || 'La sala ti chiama: puoi venire?'));
        if (!c.aperta) {
            scheda.appendChild(el('p', 'stato', "La chiamata è chiusa: l'emergenza o l'attività è finita."));
            return;
        }
        scheda.appendChild(el('p', 'stato', statoLeggibile(c)));
        if (!c.chiamato) return;
        const risposte = el('div', 'risposte');
        const bottone = (testo, classe, azione) => {
            const b = el('button', `button-style ${classe}`, testo);
            b.type = 'button';
            b.addEventListener('click', async () => {
                b.disabled = true;
                try { await azione(); await carica(); } catch (e) { notifica(e.message, 'errore'); b.disabled = false; }
            });
            return b;
        };
        const rispondi = (risposta, minuti) => fetchApi(`/api/chiamate/${id}/risposta`, { method: 'POST', body: JSON.stringify({ risposta, minuti }) });
        if (c.stato !== 'arrivato' && c.stato !== 'congedato') {
            risposte.append(
                bottone('Arrivo subito', 'largo', () => rispondi('arrivo')),
                bottone('Fra 30 minuti', 'button-secondary', () => rispondi('ritardo', 30)),
                bottone("Fra un'ora", 'button-secondary', () => rispondi('ritardo', 60)),
                bottone('Fra due ore', 'button-secondary', () => rispondi('ritardo', 120)),
                bottone('Non posso', 'button-secondary', () => rispondi('no'))
            );
        }
        if (c.stato === 'in_arrivo') {
            risposte.appendChild(bottone('Sono arrivato in sede', 'largo', () => fetchApi('/api/disponibilita/arrivato', {
                method: 'POST', body: JSON.stringify(c.attivita_id ? { attivita_id: c.attivita_id } : {})
            })));
        }
        scheda.appendChild(risposte);
    }

    // Aperta senza numero (dal menu, da un segnalibro): la chiamata aperta più
    // recente per questa persona, se c'è.
    if (!Number.isInteger(id) || id <= 0) {
        let mie = [];
        try { mie = await fetchApi('/api/chiamate/mie'); } catch { /* si dice sotto */ }
        const aperta = (mie || []).find(c => ['senza_risposta', 'in_arrivo', 'arrivato'].includes(c.stato));
        if (!aperta) {
            scheda.classList.add('chiusa');
            scheda.replaceChildren(el('p', '', 'In questo momento la sala non ti sta chiamando. Quando lo fa, ti arriva un avviso nell\'app o un\'email con il collegamento a questa pagina.'));
            return;
        }
        id = aperta.id;
    }
    carica();
});
