// public/js/sistema.js
//
// Pagina Sistema: backup, ripristino e stato dell'installazione.
//
// Il ripristino è l'unica cosa nell'applicazione che cancella i dati di tutti
// di proposito. Da qui l'interfaccia: il pulsante rosso sta dentro una finestra
// che prima spiega cosa si perde, chiede la password e fa scrivere una parola
// per esteso. Una conferma che si clicca per abitudine non è una conferma.

document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);

    let backupDisponibili = [];
    let sceltoPerRipristino = null;
    let dataCopiaFile = null;
    let sondaOperazione = null;

    // Utilità
    function dimensioneLeggibile(byte) {
        if (byte >= 1024 * 1024 * 1024) return `${(byte / 1024 / 1024 / 1024).toFixed(1)} GB`;
        if (byte >= 1024 * 1024) return `${(byte / 1024 / 1024).toFixed(1)} MB`;
        return `${Math.max(1, Math.round(byte / 1024))} KB`;
    }

    function quandoLeggibile(iso) {
        const data = new Date(iso);
        return data.toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function daQuanto(iso) {
        const ore = (Date.now() - new Date(iso).getTime()) / 3600000;
        if (ore < 1) return 'meno di un\'ora fa';
        if (ore < 24) return `${Math.round(ore)} ore fa`;
        const giorni = Math.round(ore / 24);
        return giorni === 1 ? 'ieri' : `${giorni} giorni fa`;
    }

    // Stato e elenco
    async function caricaTutto() {
        try {
            const dati = await fetchApi('/api/sistema/backup');
            backupDisponibili = dati.backup || [];
            dataCopiaFile = dati.copia_file;
            disegnaStato(dati);
            disegnaElenco();
        } catch (e) {
            $('elenco-backup').innerHTML = '';
            const riga = document.createElement('tr');
            const cella = document.createElement('td');
            cella.colSpan = 4;
            cella.style.textAlign = 'center';
            cella.style.padding = '20px';
            cella.textContent = e.message;
            riga.appendChild(cella);
            $('elenco-backup').appendChild(riga);
        }
    }

    function voceStato(etichetta, valore, gravita) {
        const riquadro = document.createElement('div');
        riquadro.className = 'voce-stato';
        const e = document.createElement('span');
        e.className = 'etichetta';
        e.textContent = etichetta;
        const v = document.createElement('span');
        v.className = `valore${gravita ? ' ' + gravita : ''}`;
        v.textContent = valore;
        riquadro.append(e, v);
        return riquadro;
    }

    function disegnaStato(dati) {
        const contenitore = $('stato-sistema');
        contenitore.innerHTML = '';

        const ultimo = backupDisponibili[0];
        if (!ultimo) {
            contenitore.appendChild(voceStato('Ultimo backup', 'nessuno', 'allarme'));
        } else {
            const ore = (Date.now() - new Date(ultimo.quando).getTime()) / 3600000;
            contenitore.appendChild(voceStato(
                'Ultimo backup',
                `${quandoLeggibile(ultimo.quando)} (${daQuanto(ultimo.quando)})`,
                ore > 48 ? 'allarme' : ore > 26 ? 'attenzione' : null
            ));
        }

        contenitore.appendChild(voceStato('Backup disponibili', String(backupDisponibili.length)));
        contenitore.appendChild(voceStato(
            'Spazio occupato',
            dimensioneLeggibile(backupDisponibili.reduce((somma, b) => somma + b.dimensione, 0))
        ));
        contenitore.appendChild(voceStato(
            'Copia dei file caricati',
            dati.copia_file ? `${quandoLeggibile(dati.copia_file)} (${daQuanto(dati.copia_file)})` : 'nessuna'
        ));
    }

    function disegnaElenco() {
        const corpo = $('elenco-backup');
        corpo.innerHTML = '';

        if (!backupDisponibili.length) {
            const riga = document.createElement('tr');
            const cella = document.createElement('td');
            cella.colSpan = 4;
            cella.style.textAlign = 'center';
            cella.style.padding = '20px';
            cella.style.color = 'var(--text-muted)';
            cella.textContent = 'Nessun backup disponibile.';
            riga.appendChild(cella);
            corpo.appendChild(riga);
            return;
        }

        backupDisponibili.forEach(backup => {
            const riga = document.createElement('tr');

            const quando = document.createElement('td');
            quando.textContent = quandoLeggibile(backup.quando);
            if (backup.motivo) {
                const motivo = document.createElement('small');
                motivo.style.display = 'block';
                motivo.style.color = 'var(--text-muted)';
                motivo.textContent = backup.motivo;
                quando.appendChild(motivo);
            }

            const origine = document.createElement('td');
            origine.textContent = backup.origine;

            const dimensione = document.createElement('td');
            dimensione.textContent = dimensioneLeggibile(backup.dimensione);

            const azioni = document.createElement('td');
            azioni.style.textAlign = 'right';
            const gruppo = document.createElement('div');
            gruppo.className = 'gruppo-azioni a-destra';

            const scarica = document.createElement('a');
            scarica.className = 'button-style button-small button-secondary';
            scarica.href = `/api/sistema/backup/${backup.cartella}/${encodeURIComponent(backup.nome)}`;
            scarica.textContent = 'Scarica';
            gruppo.appendChild(scarica);

            // Controllare un archivio prima di averne bisogno: un backup
            // troncato si scopre adesso, non il giorno del ripristino.
            const verifica = document.createElement('button');
            verifica.type = 'button';
            verifica.className = 'button-style button-small button-secondary';
            verifica.textContent = 'Verifica';
            verifica.addEventListener('click', () => verificaBackup(backup, verifica));
            gruppo.appendChild(verifica);

            const ripristina = document.createElement('button');
            ripristina.type = 'button';
            ripristina.className = 'button-style button-small btn-pericolo';
            ripristina.textContent = 'Ripristina';
            ripristina.addEventListener('click', () => apriRipristino(backup));
            gruppo.appendChild(ripristina);

            if (backup.cancellabile) {
                const elimina = document.createElement('button');
                elimina.type = 'button';
                elimina.className = 'button-style button-small btn-discreto';
                elimina.textContent = 'Elimina';
                elimina.addEventListener('click', () => eliminaBackup(backup));
                gruppo.appendChild(elimina);
            }

            azioni.appendChild(gruppo);
            riga.append(quando, origine, dimensione, azioni);
            corpo.appendChild(riga);
        });
    }

    // Azioni sui backup
    $('btn-backup-adesso').addEventListener('click', async (evento) => {
        const pulsante = evento.currentTarget;
        pulsante.disabled = true;
        pulsante.textContent = 'Backup in corso...';
        try {
            const esito = await fetchApi('/api/sistema/backup', { method: 'POST' });
            $('stato-caricamento').textContent = esito.message;
            await caricaTutto();
        } catch (e) {
            $('stato-caricamento').textContent = e.message;
        } finally {
            pulsante.disabled = false;
            pulsante.textContent = 'Fai un backup adesso';
        }
    });

    $('btn-carica').addEventListener('click', () => $('file-archivio').click());

    $('file-archivio').addEventListener('change', async (evento) => {
        const file = evento.target.files[0];
        if (!file) return;
        $('stato-caricamento').textContent = `Caricamento di ${file.name}...`;
        const modulo = new FormData();
        modulo.append('archivio', file);
        try {
            const esito = await fetchApi('/api/sistema/backup/carica', { method: 'POST', body: modulo });
            $('stato-caricamento').textContent = esito.message;
            await caricaTutto();
        } catch (e) {
            $('stato-caricamento').textContent = e.message;
        } finally {
            evento.target.value = '';
        }
    });

    async function verificaBackup(backup, pulsante) {
        pulsante.disabled = true;
        pulsante.textContent = 'Verifica...';
        try {
            const esito = await fetchApi(`/api/sistema/backup/${backup.cartella}/${encodeURIComponent(backup.nome)}/verifica`, { method: 'POST' });
            $('stato-caricamento').textContent = esito.valido
                ? `Il backup del ${quandoLeggibile(backup.quando)} è leggibile e contiene un database di ORION.`
                : `Il backup del ${quandoLeggibile(backup.quando)} NON è utilizzabile: ${esito.motivo}.`;
            pulsante.textContent = esito.valido ? 'Integro' : 'Danneggiato';
        } catch (e) {
            $('stato-caricamento').textContent = e.message;
            pulsante.textContent = 'Verifica';
        } finally {
            pulsante.disabled = false;
        }
    }

    async function eliminaBackup(backup) {
        if (!confirm(`Eliminare il backup del ${quandoLeggibile(backup.quando)}?`)) return;
        try {
            await fetchApi(`/api/sistema/backup/${backup.cartella}/${encodeURIComponent(backup.nome)}`, { method: 'DELETE' });
            await caricaTutto();
        } catch (e) {
            $('stato-caricamento').textContent = e.message;
        }
    }

    // Ripristino
    function apriRipristino(backup) {
        sceltoPerRipristino = backup;
        $('backup-scelto').textContent =
            `Backup del ${quandoLeggibile(backup.quando)} — ${backup.origine}, ${dimensioneLeggibile(backup.dimensione)}`;
        $('data-copia-file').textContent = dataCopiaFile
            ? `La copia disponibile è quella del ${quandoLeggibile(dataCopiaFile)}: è l'ultima fatta, non necessariamente quella del giorno di questo backup.`
            : 'Non risulta nessuna copia dei file: i documenti resteranno quelli attuali.';
        $('ripristina-file').checked = false;
        $('ripristina-file').disabled = !dataCopiaFile;
        $('password-conferma').value = '';
        $('parola-conferma').value = '';
        $('errore-ripristino').hidden = true;
        $('modale-ripristino').hidden = false;
    }

    function chiudiRipristino() {
        $('modale-ripristino').hidden = true;
        sceltoPerRipristino = null;
    }

    $('chiudi-modale-ripristino').addEventListener('click', chiudiRipristino);
    $('annulla-ripristino').addEventListener('click', chiudiRipristino);

    $('conferma-ripristino').addEventListener('click', async (evento) => {
        if (!sceltoPerRipristino) return;
        const pulsante = evento.currentTarget;
        pulsante.disabled = true;
        $('errore-ripristino').hidden = true;
        try {
            await fetchApi('/api/sistema/ripristino', {
                method: 'POST',
                body: JSON.stringify({
                    cartella: sceltoPerRipristino.cartella,
                    nome: sceltoPerRipristino.nome,
                    password: $('password-conferma').value,
                    conferma: $('parola-conferma').value.trim().toUpperCase(),
                    ripristina_file: $('ripristina-file').checked
                })
            });
            chiudiRipristino();
            seguiOperazione();
        } catch (e) {
            $('errore-ripristino').textContent = e.message;
            $('errore-ripristino').hidden = false;
        } finally {
            pulsante.disabled = false;
        }
    });

    // Versione e aggiornamenti
    let versione = null;

    async function caricaVersione() {
        try {
            versione = await fetchApi('/api/sistema/versione');
            disegnaVersione();
        } catch (e) {
            $('stato-versione').textContent = e.message;
        }
    }

    function disegnaVersione() {
        const contenitore = $('stato-versione');
        contenitore.innerHTML = '';
        contenitore.appendChild(voceStato('Versione installata', versione.versione_installata));

        const controllo = versione.ultimo_controllo || {};
        if (!versione.aggiornamenti.attivo) {
            contenitore.appendChild(voceStato('Controllo aggiornamenti', 'spento'));
        } else if (controllo.errore) {
            contenitore.appendChild(voceStato('Ultimo controllo', controllo.errore, 'attenzione'));
        } else if (controllo.versione) {
            contenitore.appendChild(voceStato(
                'Ultima versione pubblicata',
                `${controllo.versione}${controllo.controllato_il ? ` (visto ${daQuanto(controllo.controllato_il)})` : ''}`,
                versione.disponibile ? 'attenzione' : null
            ));
        } else {
            contenitore.appendChild(voceStato('Ultimo controllo', 'mai'));
        }

        if (versione.disponibile) {
            contenitore.appendChild(voceStato('Aggiornamento', `disponibile la ${versione.disponibile}`, 'attenzione'));
        } else if (controllo.versione) {
            contenitore.appendChild(voceStato('Aggiornamento', 'sei alla versione più recente'));
        }

        $('aggiornamenti-attivo').checked = !!versione.aggiornamenti.attivo;
        $('aggiornamenti-origine').value = versione.aggiornamenti.origine || 'github';
        $('aggiornamenti-repo').value = versione.aggiornamenti.repo || '';
        $('aggiornamenti-manifesto').value = versione.aggiornamenti.manifesto || '';
        mostraCampiOrigine();

        // I motivi per cui non si può aggiornare si dicono prima, non a metà
        // strada: a metà strada l'installazione è già stata toccata.
        const requisiti = $('requisiti-aggiornamento');
        requisiti.innerHTML = '';
        (versione.requisiti?.problemi || []).forEach(testo => {
            const riga = document.createElement('p');
            riga.className = 'errore';
            riga.textContent = testo;
            requisiti.appendChild(riga);
        });
        (versione.requisiti?.avvertenze || []).forEach(testo => {
            const riga = document.createElement('p');
            riga.className = 'avvertenza';
            riga.textContent = testo;
            requisiti.appendChild(riga);
        });

        $('btn-aggiorna').hidden = !(versione.disponibile && versione.requisiti?.pronto);

        const note = controllo.note;
        $('note-versione').hidden = !(versione.disponibile && note);
        $('testo-note').textContent = note || '';
    }

    function mostraCampiOrigine() {
        const perGitHub = $('aggiornamenti-origine').value === 'github';
        $('campo-repo').hidden = !perGitHub;
        $('campo-manifesto').hidden = perGitHub;
    }

    $('aggiornamenti-origine').addEventListener('change', mostraCampiOrigine);

    $('btn-salva-aggiornamenti').addEventListener('click', async () => {
        try {
            await fetchApi('/api/sistema/aggiornamenti/config', {
                method: 'PUT',
                body: JSON.stringify({
                    attivo: $('aggiornamenti-attivo').checked,
                    origine: $('aggiornamenti-origine').value,
                    repo: $('aggiornamenti-repo').value.trim(),
                    manifesto: $('aggiornamenti-manifesto').value.trim()
                })
            });
            $('stato-controllo').textContent = 'Impostazioni salvate.';
            await caricaVersione();
        } catch (e) {
            $('stato-controllo').textContent = e.message;
        }
    });

    $('btn-controlla').addEventListener('click', async (evento) => {
        const pulsante = evento.currentTarget;
        pulsante.disabled = true;
        $('stato-controllo').textContent = 'Controllo in corso...';
        try {
            versione = await fetchApi('/api/sistema/aggiornamenti/controlla', { method: 'POST' });
            disegnaVersione();
            $('stato-controllo').textContent = versione.disponibile
                ? `C'è la versione ${versione.disponibile}.`
                : 'Nessuna versione più recente.';
        } catch (e) {
            $('stato-controllo').textContent = e.message;
        } finally {
            pulsante.disabled = false;
        }
    });

    $('btn-aggiorna').addEventListener('click', () => {
        $('versione-scelta').textContent =
            `Dalla versione ${versione.versione_installata} alla ${versione.disponibile}`;
        $('password-aggiornamento').value = '';
        $('parola-aggiornamento').value = '';
        $('errore-aggiornamento').hidden = true;
        $('modale-aggiornamento').hidden = false;
    });

    function chiudiAggiornamento() { $('modale-aggiornamento').hidden = true; }
    $('chiudi-modale-aggiornamento').addEventListener('click', chiudiAggiornamento);
    $('annulla-aggiornamento').addEventListener('click', chiudiAggiornamento);

    $('conferma-aggiornamento').addEventListener('click', async (evento) => {
        const pulsante = evento.currentTarget;
        pulsante.disabled = true;
        $('errore-aggiornamento').hidden = true;
        try {
            await fetchApi('/api/sistema/aggiornamenti/applica', {
                method: 'POST',
                body: JSON.stringify({
                    password: $('password-aggiornamento').value,
                    conferma: $('parola-aggiornamento').value.trim().toUpperCase()
                })
            });
            chiudiAggiornamento();
            seguiOperazione();
        } catch (e) {
            $('errore-aggiornamento').textContent = e.message;
            $('errore-aggiornamento').hidden = false;
        } finally {
            pulsante.disabled = false;
        }
    });

    // Come sta andando
    // Mentre il ripristino lavora, l'applicazione risponde "in manutenzione" a
    // tutto il resto: questa pagina continua a chiedere solo a che punto è.
    function seguiOperazione() {
        $('riquadro-operazione').hidden = false;
        $('btn-chiudi-operazione').hidden = true;
        if (sondaOperazione) clearInterval(sondaOperazione);
        sondaOperazione = setInterval(aggiornaOperazione, 1200);
        aggiornaOperazione();
    }

    async function aggiornaOperazione() {
        let operazione = null;
        try {
            operazione = await fetchApi('/api/sistema/operazione');
        } catch {
            // Durante il riavvio il server non risponde: è previsto, si
            // continua a chiedere finché non torna.
            return;
        }
        if (!operazione) {
            if (sondaOperazione) clearInterval(sondaOperazione);
            $('riquadro-operazione').hidden = true;
            return;
        }
        disegnaOperazione(operazione);
        if (operazione.finita) {
            if (sondaOperazione) clearInterval(sondaOperazione);
            sondaOperazione = null;
            $('btn-chiudi-operazione').hidden = false;
            caricaTutto();
            caricaVersione();
        }
    }

    function disegnaOperazione(operazione) {
        $('titolo-operazione').textContent = operazione.finita
            ? (operazione.esito === 'fatto' ? 'Operazione completata' : 'Operazione non riuscita')
            : 'Operazione in corso';

        const elenco = $('passi-operazione');
        elenco.innerHTML = '';
        (operazione.passi || []).forEach(passo => {
            const voce = document.createElement('li');
            voce.className = passo.stato;
            voce.textContent = passo.testo;
            elenco.appendChild(voce);
        });

        const esito = $('esito-operazione');
        esito.textContent = operazione.messaggio || '';
        esito.className = `esito${operazione.esito ? ' ' + operazione.esito : ''}`;
    }

    $('btn-chiudi-operazione').addEventListener('click', () => {
        $('riquadro-operazione').hidden = true;
    });

    // All'apertura della pagina: se c'è un'operazione in corso o appena
    // conclusa (tipicamente si è appena riavviato tutto), si mostra subito.
    (async () => {
        try {
            const operazione = await fetchApi('/api/sistema/operazione');
            if (operazione) {
                $('riquadro-operazione').hidden = false;
                disegnaOperazione(operazione);
                if (!operazione.finita) seguiOperazione();
                else $('btn-chiudi-operazione').hidden = false;
            }
        } catch { /* niente di grave: la pagina funziona lo stesso */ }
        caricaTutto();
        caricaVersione();
    })();
});
