# App Android distribuita dal server

Questa cartella viaggia dentro la release del server: così ogni associazione
ha l'app giusta per la versione del suo web, e nessuno deve distribuirla a mano.

Contiene due file, messi qui al momento della release:

- `orion.apk`: l'app firmata, scaricabile da `/app/orion.apk` senza accesso
  (chi deve installarla non ha ancora modo di autenticarsi; l'APK non contiene
  niente di riservato).
- `versione.json`: quale versione è e qual è la più vecchia che questo server
  accetta ancora.

```json
{ "codice": 3, "nome": "0.3.0", "minima": 2, "certificato_sha256": "9E:EC:…:A9" }
```

I due file li prepara `scripts/pubblica.sh` del repository dell'app, a
partire dall'APK firmato: controlla la firma, legge la versione e scrive
l'impronta SHA-256 del certificato. Il web la mostra accanto a "Scarica
l'app", così chi installa la può confrontare con quella pubblicata nel
README dell'app. Gli aggiornamenti li protegge Android: accetta solo un APK
firmato con la stessa chiave.

`codice` e `minima` sono i `versionCode` Android. Il server li riporta in
`GET /api/app/contesto` (campo `app`), e l'app propone di aggiornarsi quando
è più vecchia di `ultima`, o si ferma quando è più vecchia di `minima`.

Se la cartella è vuota il contesto riporta `app: null` e tutto il resto
funziona lo stesso.

Con l'aggiornamento dalla pagina Sistema l'APK della release nuova prende il
posto di quello installato solo se è più recente e firmato con la stessa
chiave; un APK diverso messo qui a mano resta com'è.

L'amministratore può togliere l'app al personale dalle impostazioni
(App Android → Disponibile al personale): l'APK smette di scaricarsi e
nessuno se la vede più proporre, anche se i file sono qui.
