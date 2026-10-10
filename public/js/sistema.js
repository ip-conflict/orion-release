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
        if (controllo.errore) {
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

    async function salvaConfigAggiornamenti(messaggio) {
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
            $('stato-controllo').textContent = messaggio;
            await caricaVersione();
        } catch (e) {
            $('stato-controllo').textContent = e.message;
        }
    }

    $('btn-salva-aggiornamenti').addEventListener('click', () => salvaConfigAggiornamenti('Origine salvata.'));
    // La casella vale da sola: niente Salva da ricordarsi.
    $('aggiornamenti-attivo').addEventListener('change', (e) => salvaConfigAggiornamenti(e.target.checked
        ? 'Controllo giornaliero acceso.'
        : 'Controllo giornaliero spento.'));

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

    // --- Versioni precedenti ---------------------------------------------------
    let ritornoScelto = null;

    async function caricaVersioniPrecedenti() {
        const elenco = $('elenco-versioni-precedenti');
        try {
            const dati = await fetchApi('/api/sistema/versioni-precedenti');
            elenco.innerHTML = '';
            if (!dati.versioni.length) {
                const li = document.createElement('li');
                li.className = 'vuoto';
                li.textContent = 'Nessuna versione messa da parte: compaiono qui dopo il primo aggiornamento fatto da questa pagina.';
                elenco.append(li);
                return;
            }
            dati.versioni.forEach(v => {
                const li = document.createElement('li');
                const testo = document.createElement('span');
                const nome = document.createElement('span');
                nome.className = 'versione-nome';
                nome.textContent = `Versione ${v.versione}`;
                const dettagli = document.createElement('span');
                dettagli.className = 'versione-dettagli';
                dettagli.textContent = `Messa da parte il ${quandoLeggibile(v.lasciata_il)}${v.dati ? ', con i dati di quel momento' : ', senza backup dei dati'}`;
                testo.append(nome, dettagli);
                const bottone = document.createElement('button');
                bottone.type = 'button';
                bottone.className = 'button-style button-secondary';
                bottone.textContent = 'Torna a questa';
                bottone.addEventListener('click', () => apriRitorno(v, dati.versione_installata));
                li.append(testo, bottone);
                elenco.append(li);
            });
        } catch (e) {
            elenco.innerHTML = '';
            const li = document.createElement('li');
            li.className = 'vuoto';
            li.textContent = e.message;
            elenco.append(li);
        }
    }

    function apriRitorno(v, installata) {
        ritornoScelto = v;
        $('ritorno-scelto').textContent = `Dalla versione ${installata} alla ${v.versione}`;
        $('ritorno-dati').checked = false;
        $('ritorno-dati').disabled = !v.dati;
        $('ritorno-dati-quando').textContent = v.dati
            ? `Il backup del ${quandoLeggibile(v.dati.del)}: quello che è stato fatto dopo sparisce.`
            : 'Per questa versione non c\'è il backup dei dati di allora.';
        const modifiche = v.modifiche?.elenco || [];
        $('ritorno-senza-dati').textContent = !v.modifiche
            ? 'Senza la casella i dati restano quelli di adesso.'
            : !v.modifiche.annullabili
                ? 'Il database ha modifiche che quella versione non conosce e che non si possono annullare: per tornare a questa versione bisogna riportare anche i dati.'
                : modifiche.length
                    ? `Senza la casella i dati restano quelli di adesso. Si tolgono solo le parti del database aggiunte dalle versioni successive (${modifiche.join(', ')}), con quello che contenevano.`
                    : 'Senza la casella i dati restano tutti quelli di adesso: il database va già bene a quella versione.';
        if (v.modifiche && !v.modifiche.annullabili && v.dati) $('ritorno-dati').checked = true;
        $('ritorno-pericolo').hidden = !$('ritorno-dati').checked;
        $('ritorno-senza-dati').hidden = false;
        $('password-ritorno').value = '';
        $('parola-ritorno').value = '';
        $('errore-ritorno').hidden = true;
        $('modale-ritorno').hidden = false;
    }

    $('ritorno-dati').addEventListener('change', () => {
        $('ritorno-pericolo').hidden = !$('ritorno-dati').checked;
    });
    function chiudiRitorno() { $('modale-ritorno').hidden = true; }
    $('chiudi-modale-ritorno').addEventListener('click', chiudiRitorno);
    $('annulla-ritorno').addEventListener('click', chiudiRitorno);
    $('versioni-precedenti').addEventListener('toggle', () => {
        if ($('versioni-precedenti').open) caricaVersioniPrecedenti();
    });

    $('conferma-ritorno').addEventListener('click', async (evento) => {
        if (!ritornoScelto) return;
        const pulsante = evento.currentTarget;
        pulsante.disabled = true;
        $('errore-ritorno').hidden = true;
        try {
            await fetchApi('/api/sistema/versioni-precedenti/torna', {
                method: 'POST',
                body: JSON.stringify({
                    nome: ritornoScelto.nome,
                    dati: $('ritorno-dati').checked,
                    password: $('password-ritorno').value,
                    conferma: $('parola-ritorno').value.trim().toUpperCase()
                })
            });
            chiudiRitorno();
            seguiOperazione();
        } catch (e) {
            $('errore-ritorno').textContent = e.message;
            $('errore-ritorno').hidden = false;
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

    // Si chiude anche sul server: ricaricando la pagina non torna.
    $('btn-chiudi-operazione').addEventListener('click', async () => {
        $('riquadro-operazione').hidden = true;
        try { await fetchApi('/api/sistema/operazione', { method: 'DELETE' }); } catch { /* resta solo per questa volta */ }
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
        caricaIntegrita();
        caricaCifratura();
        caricaFirebase();
    })();

    // --- Notifiche Firebase --------------------------------------------------
    function esitoFirebase(testo, tipo = '') {
        const esito = $('esito-firebase');
        esito.textContent = testo;
        esito.className = `nota${tipo ? ` ${tipo}` : ''}`;
    }

    async function caricaFirebase() {
        const box = $('stato-firebase');
        try {
            const f = await fetchApi('/api/admin/firebase');
            box.innerHTML = '';
            if (!f.configurato) {
                box.append(voceStato('Firebase', 'spento: avvisi dal collegamento col server'));
            } else {
                box.append(
                    voceStato('Firebase', 'attivo'),
                    voceStato('Progetto', f.progetto),
                    voceStato('Telefoni registrati', String(f.telefoni)),
                    voceStato('Ultimo segnale', f.ultimo_invio ? quandoLeggibile(f.ultimo_invio) : 'nessuno da quando il server è partito')
                );
                if (f.ultimo_errore) box.append(voceStato('Ultimo errore', `${quandoLeggibile(f.ultimo_errore.il)}: ${f.ultimo_errore.messaggio}`, 'attenzione'));
            }
            $('btn-attiva-firebase').textContent = f.configurato ? 'Sostituisci i file' : 'Attiva';
            $('btn-spegni-firebase').hidden = !f.configurato;
            $('btn-prova-firebase').hidden = !f.configurato;
        } catch (e) {
            box.innerHTML = '';
            box.append(voceStato('Firebase', e.message, 'attenzione'));
        }
    }

    const leggiFile = (input) => new Promise((ok, ko) => {
        const file = input.files?.[0];
        if (!file) return ok(null);
        if (file.size > 100 * 1024) return ko(new Error(`${file.name} è troppo grande per essere un file di Firebase.`));
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => ko(new Error(`${file.name} non si legge.`));
        r.readAsText(file);
    });

    $('btn-attiva-firebase').addEventListener('click', async () => {
        const bottone = $('btn-attiva-firebase');
        try {
            const [googleServices, account] = await Promise.all([leggiFile($('file-google-services')), leggiFile($('file-account-firebase'))]);
            if (!googleServices || !account) return esitoFirebase('Scegli entrambi i file: google-services.json e la chiave dell\'account di servizio.', 'ko');
            bottone.disabled = true;
            esitoFirebase('Controllo la chiave con Google…');
            const r = await fetchApi('/api/admin/firebase', { method: 'PUT', body: JSON.stringify({ google_services: googleServices, account }) });
            $('file-google-services').value = '';
            $('file-account-firebase').value = '';
            esitoFirebase(r.message, 'ok');
            await caricaFirebase();
        } catch (e) {
            esitoFirebase(e.message, 'ko');
        } finally {
            bottone.disabled = false;
        }
    });

    $('btn-spegni-firebase').addEventListener('click', async () => {
        try {
            const r = await fetchApi('/api/admin/firebase', { method: 'DELETE' });
            esitoFirebase(r.message, 'ok');
            await caricaFirebase();
        } catch (e) {
            esitoFirebase(e.message, 'ko');
        }
    });

    $('btn-prova-firebase').addEventListener('click', async () => {
        try {
            const r = await fetchApi('/api/notifiche/prova', { method: 'POST', body: JSON.stringify({ ritardo: 0 }) });
            esitoFirebase(`${r.message} Arriva sui telefoni con l'app ORION collegati al tuo account.`, 'ok');
            setTimeout(caricaFirebase, 3000);
        } catch (e) {
            esitoFirebase(e.message, 'ko');
        }
    });

    // --- Cifratura ---------------------------------------------------------
    let modoRecupero = null; // 'mostra' | 'inserisci'
    async function caricaCifratura() {
        try {
            const c = await fetchApi('/api/sistema/cifratura');
            const STATI = { pronta: ['Attiva', null], mancante: ['Chiave mancante', 'allarme'], diversa: ['Chiave sbagliata', 'allarme'] };
            const [testo, gravita] = STATI[c.stato] || [c.stato, 'attenzione'];
            $('stato-cifratura').replaceChildren(
                voceStato('Cifratura', testo, gravita),
                voceStato('Chiave di recupero', c.recupero_salvato ? 'Conservata' : 'Da conservare', c.recupero_salvato ? null : 'attenzione'),
                voceStato('File ancora in chiaro', c.file_in_chiaro === 0 ? 'Nessuno' : `${c.file_in_chiaro} (si cifrano entro un'ora)`, c.file_in_chiaro ? 'attenzione' : null)
            );
            $('avviso-recupero').hidden = c.recupero_salvato || c.stato !== 'pronta';
            $('btn-mostra-recupero').hidden = c.stato !== 'pronta';
            if (c.stato !== 'pronta') {
                const p = document.createElement('div');
                p.className = 'integrita-problema';
                const t = document.createElement('strong');
                t.textContent = 'I file e i backup cifrati non si leggono. ';
                p.append(t, c.stato === 'mancante'
                    ? `Sul server manca la chiave dei dati (${c.file_chiave}). Inserisci la chiave di recupero che hai conservato.`
                    : 'La chiave sul server non è quella con cui sono stati cifrati i dati (succede dopo un ripristino da un\'altra installazione). Inserisci la chiave di recupero di quella installazione.');
                $('stato-cifratura').after(p);
            }
        } catch (e) {
            $('stato-cifratura').replaceChildren(voceStato('Cifratura', e.message, 'allarme'));
        }
    }

    function apriRecupero(modo) {
        modoRecupero = modo;
        $('riquadro-recupero').hidden = false;
        $('chiave-mostrata').hidden = true;
        $('campo-chiave-inserita').hidden = modo !== 'inserisci';
        $('testo-recupero-istruzioni').textContent = modo === 'mostra'
            ? 'Per vedere la chiave di recupero serve la tua password. Mostrala solo dove nessuno guarda lo schermo.'
            : 'Incolla o ricopia la chiave di recupero (52 caratteri a gruppi di quattro) e conferma con la tua password.';
        $('esito-recupero').textContent = '';
        $('password-recupero').value = '';
        $('password-recupero').closest('label').hidden = false;
        $('btn-conferma-recupero').hidden = false;
        (modo === 'inserisci' ? $('chiave-inserita') : $('password-recupero')).focus();
    }
    function chiudiRecupero() {
        $('riquadro-recupero').hidden = true;
        $('testo-chiave-recupero').textContent = '';
        $('password-recupero').value = '';
        $('chiave-inserita').value = '';
    }
    $('btn-mostra-recupero').addEventListener('click', () => apriRecupero('mostra'));
    $('btn-inserisci-chiave').addEventListener('click', () => apriRecupero('inserisci'));
    $('btn-annulla-recupero').addEventListener('click', chiudiRecupero);
    $('btn-conferma-recupero').addEventListener('click', async () => {
        const esito = $('esito-recupero');
        esito.className = 'nota';
        esito.textContent = '';
        try {
            if (modoRecupero === 'mostra') {
                const r = await fetchApi('/api/sistema/cifratura/recupero', { method: 'POST', body: JSON.stringify({ password: $('password-recupero').value }) });
                $('testo-chiave-recupero').textContent = r.chiave;
                $('chiave-mostrata').hidden = false;
                $('password-recupero').value = '';
                $('password-recupero').closest('label').hidden = true;
                $('btn-conferma-recupero').hidden = true;
                $('testo-recupero-istruzioni').textContent = 'Ecco la chiave di recupero. Stampala o ricopiala adesso: chiudendo il riquadro sparisce dallo schermo.';
            } else {
                const r = await fetchApi('/api/sistema/cifratura/chiave', { method: 'POST', body: JSON.stringify({ password: $('password-recupero').value, chiave: $('chiave-inserita').value }) });
                esito.className = 'nota ok';
                esito.textContent = r.message;
                $('chiave-inserita').value = '';
                $('password-recupero').value = '';
                caricaCifratura();
            }
        } catch (e) {
            esito.className = 'nota ko';
            esito.textContent = e.message;
        }
    });
    $('btn-stampa-recupero').addEventListener('click', () => {
        const finestra = window.open('', '_blank', 'width=700,height=500');
        if (!finestra) return notifica('Il browser ha bloccato la finestra di stampa: ricopia la chiave a mano.', 'attenzione');
        const doc = finestra.document;
        doc.title = 'Chiave di recupero ORION';
        const h = doc.createElement('h1'); h.textContent = 'ORION - chiave di recupero dei dati';
        const p = doc.createElement('p'); p.textContent = `Server: ${location.host}. Stampata il ${new Date().toLocaleString('it-IT')}. Senza questa chiave i file e i backup cifrati non si aprono se la chiave sul server va persa. Conservala in cassaforte.`;
        const k = doc.createElement('pre'); k.textContent = $('testo-chiave-recupero').textContent;
        k.style.cssText = 'font-size:20px;letter-spacing:2px;white-space:pre-wrap;border:1px solid #000;padding:16px';
        doc.body.append(h, p, k);
        finestra.print();
    });
    $('btn-recupero-conservato').addEventListener('click', async () => {
        try {
            await fetchApi('/api/sistema/cifratura/recupero-salvato', { method: 'POST' });
            chiudiRecupero();
            caricaCifratura();
            notifica('Chiave di recupero segnata come conservata.', 'successo');
        } catch (e) { notifica(e.message, 'errore'); }
    });

    // --- Integrità dello storico -------------------------------------------
    const NOMI_TABELLE = {
        report_updates: 'note delle segnalazioni', diario_sala: 'diario di sala', audit_log: 'registro delle operazioni',
        movimenti: 'movimenti del magazzino', emergency_team_log: 'registro delle squadre'
    };
    const elencoRighe = (esempi) => esempi.map(e => `${NOMI_TABELLE[e.tabella] || e.tabella} (n. ${e.righe.join(', ')})`).join('; ');

    async function caricaIntegrita() {
        const box = $('stato-integrita');
        box.replaceChildren(voceStato('Verifica', 'in corso…'));
        $('dettagli-integrita').replaceChildren();
        try {
            const d = await fetchApi('/api/sistema/integrita');
            box.replaceChildren(
                voceStato('Storico', d.integro ? 'Integro' : 'Alterato', d.integro ? null : 'allarme'),
                voceStato('Voci sigillate', Number(d.anelli).toLocaleString('it-IT')),
                voceStato('Ultima verifica', new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }))
            );
            const problemi = [];
            if (d.catena_rotta) problemi.push(`la catena è spezzata all'anello n. ${d.catena_rotta.id} (${quandoLeggibile(d.catena_rotta.quando)}): da lì il registro è stato riscritto`);
            if (d.alterate) problemi.push(`${d.alterate} ${d.alterate === 1 ? 'voce è stata modificata' : 'voci sono state modificate'}: ${elencoRighe(d.esempi_alterate)}`);
            if (d.mancanti) problemi.push(`${d.mancanti} ${d.mancanti === 1 ? 'voce è stata cancellata' : 'voci sono state cancellate'} fuori da una cancellazione di emergenza: ${elencoRighe(d.esempi_mancanti)}`);
            if (problemi.length) {
                const p = document.createElement('div');
                p.className = 'integrita-problema';
                const t = document.createElement('strong');
                t.textContent = 'Lo storico non è più quello registrato. ';
                p.append(t, `Qualcuno è intervenuto direttamente sul database: ${problemi.join('; ')}. Non toccare niente, scarica il sigillo di adesso e un backup, e avvisa chi gestisce il server.`);
                $('dettagli-integrita').append(p);
            }
            $('sigillo-attuale').textContent = d.sigillo || 'Ancora nessuna voce sigillata.';
            disegnaCancellazioni(d.cancellazioni || []);
        } catch (e) {
            box.replaceChildren(voceStato('Verifica', e.message, 'allarme'));
        }
    }

    function disegnaCancellazioni(elenco) {
        const box = $('cancellazioni-integrita');
        box.replaceChildren();
        if (!elenco.length) return;
        box.className = 'integrita-cancellazioni';
        const h = document.createElement('h3');
        h.textContent = 'Emergenze archiviate cancellate';
        const spiega = document.createElement('p');
        spiega.className = 'spiegazione';
        spiega.textContent = 'Cancellarle libera spazio; nella catena resta chi lo ha fatto, quando, e quali voci sono uscite.';
        const ul = document.createElement('ul');
        elenco.forEach(c => {
            const li = document.createElement('li');
            const em = c.emergenza || {};
            li.textContent = `${em.codice || '?'}${em.nome ? ` — ${em.nome}` : ''}: cancellata il ${quandoLeggibile(c.quando)}${c.eseguita_da ? ` da ${c.eseguita_da}` : ''}, ${c.righe || 0} voci (anello n. ${c.id})`;
            ul.append(li);
        });
        box.append(h, spiega, ul);
    }

    $('btn-verifica-integrita').addEventListener('click', caricaIntegrita);
    $('btn-copia-sigillo').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($('sigillo-attuale').textContent);
            notifica('Sigillo copiato: incollalo dove lo conservi.', 'successo');
        } catch {
            notifica('Copia non riuscita: seleziona il testo del sigillo e copialo a mano.', 'attenzione');
        }
    });
    $('btn-confronta-sigillo').addEventListener('click', async () => {
        const esito = $('esito-confronto');
        esito.className = 'nota';
        esito.textContent = 'Confronto…';
        try {
            const r = await fetchApi('/api/sistema/integrita/confronta', { method: 'POST', body: JSON.stringify({ sigillo: $('sigillo-da-confrontare').value }) });
            esito.textContent = r.message;
            esito.className = `nota ${r.ok ? 'ok' : 'ko'}`;
        } catch (e) {
            esito.textContent = e.message;
            esito.className = 'nota ko';
        }
    });
});
