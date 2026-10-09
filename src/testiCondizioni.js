// Il testo predefinito delle condizioni d'uso, che chi usa ORION legge e
// accetta al primo accesso e ogni volta che cambiano. Tutela chi lo usa e chi
// l'ha scritto: dice chi risponde dell'installazione e dei dati, che il
// programma è fornito così com'è, e quali dati personali restano dopo che una
// persona viene eliminata (solo quelli che servono all'integrità dello
// storico). L'amministratore può riscriverlo per intero dalle impostazioni.
//
// Il formato è testo semplice: "# " il titolo, "## " un capitolo, una riga
// vuota fra i paragrafi. Web e app lo impaginano senza interpretare altro.

export function datiOrganizzazione(impostazioni) {
    return { associazione: String(impostazioni.association_name || '').trim() || "l'organizzazione che lo usa" };
}

export function condizioniPredefinite(d) {
    return `# Condizioni d'uso di ORION

Queste condizioni valgono per chiunque usi ORION per conto di ${d.associazione}, dal browser o dall'app.

## Che cos'è ORION e chi ne risponde

ORION è il sistema con cui ${d.associazione} organizza l'attività di protezione civile: volontari, squadre, materiali, segnalazioni ed emergenze. Lo installa, lo gestisce e decide chi può usarlo ${d.associazione}, che risponde dei dati che vi vengono inseriti e dell'uso che se ne fa.

Il programma è distribuito dal suo autore con la licenza PolyForm Noncommercial 1.0.0: si usa solo per scopi non commerciali, come l'attività di volontariato e di protezione civile. È fornito così com'è, senza garanzie di alcun tipo: né di funzionamento continuo, né di assenza di errori, né di idoneità a uno scopo particolare. L'autore non gestisce le installazioni e non ha accesso ai dati che contengono; nei limiti consentiti dalla legge non risponde di danni diretti o indiretti dovuti all'uso del programma, a un suo mancato funzionamento o alla perdita di dati.

## I dati personali

ORION tiene i dati personali delle persone solo finché servono all'attività: anagrafica, contatti, idoneità, formazione, materiali ricevuti. Quando una persona viene eliminata, i suoi dati personali si cancellano, insieme alla foto e ai certificati caricati. Restano soltanto il nome e il cognome legati alle operazioni che ha svolto (le segnalazioni e i loro aggiornamenti, il registro delle operazioni, il diario di sala, i verbali di consegna, i movimenti del magazzino, la composizione delle squadre nelle emergenze), perché servono all'integrità dello storico e al non ripudio: chi ha fatto che cosa, e quando, non deve poter essere alterato né negato. Le copie di sicurezza li contengono finché non vengono sovrascritte.

I dati restano sul server scelto da ${d.associazione}. ORION non usa servizi centrali del suo autore e non manda dati a terzi per notifiche, statistiche o pubblicità. La mappa si appoggia a servizi esterni (OpenStreetMap, Esri e altri), che ricevono la zona visualizzata o l'indirizzo cercato, non i dati delle persone.

## Cookie e memoria del browser

ORION usa solo cookie tecnici, necessari a farlo funzionare: quello della sessione, che tiene l'accesso per al massimo un giorno, e uno con il nome utente. Nel browser tiene anche qualche preferenza, come il ruolo per comporre il menu e l'aspetto della mappa. Non ci sono cookie di profilazione, di statistica o di pubblicità, e ORION non ne fa mettere a terzi: per questo non serve un consenso. Cancellando i dati del sito dal browser si esce da ORION e le preferenze tornano quelle iniziali.

## Il tuo account è personale

Le credenziali sono tue e non si cedono, nemmeno a un altro volontario e nemmeno in emergenza. Scegli una password robusta e non usarla altrove; se ti viene chiesta la verifica in due passaggi, attivala. Se pensi che qualcuno abbia usato il tuo account o perdi il telefono con l'app, avvisa subito la segreteria: l'accesso da quel telefono si può revocare.

## La riservatezza

In ORION vedi dati di altre persone: volontari, cittadini che fanno una segnalazione, persone soccorse, indirizzi, condizioni di salute, situazioni delicate. Accettando queste condizioni ti impegni a usarli solo per l'attività di protezione civile e solo per quanto ti serve. Non copiarli, non fotografare o catturare lo schermo per condividerlo, non inoltrarli in chat o sui social, nemmeno dopo la fine dell'emergenza. L'impegno alla riservatezza resta anche quando smetti di far parte dell'organizzazione.

## Usarlo bene

Scrivi informazioni vere e verificate: in emergenza su quello che scrivi si prendono decisioni. Non usare ORION per scopi personali, commerciali o politici, non cercare di vedere dati che il tuo ruolo non prevede e non caricare file che non c'entrano con l'attività. Le fotografie servono all'intervento: scatta solo quelle utili, nel rispetto della dignità delle persone.

## Il registro delle operazioni

Ogni operazione è registrata con il nome di chi la fa, la data e l'ora, in un registro che non si può alterare. Serve a ricostruire che cosa è successo durante un'emergenza e a rendere conto dell'attività svolta, non a valutare le persone.

## Quando ORION non funziona

ORION è uno strumento di supporto e non sostituisce le procedure del piano di protezione civile. Se non funziona, se manca la rete o un dato non torna, si seguono quelle procedure: radio, telefono, carta. ${d.associazione.charAt(0).toUpperCase() + d.associazione.slice(1)} può sospendere il servizio per manutenzione e sospendere un account quando serve.

## Se le regole non vengono rispettate

Un uso contrario a queste condizioni può portare alla sospensione dell'account e ai provvedimenti previsti dallo statuto o dal regolamento dell'organizzazione, oltre alle responsabilità previste dalla legge.

## Se le condizioni cambiano

Quando queste condizioni cambiano, al primo accesso successivo ORION te le mostra di nuovo e ti chiede di accettarle prima di continuare. Puoi rileggerle in ogni momento dal tuo profilo o dalla pagina di accesso.
`;
}
