# Prova dell'editor su Home Assistant (verifiche manuali)

> **Prima di cominciare**
>
> - **Nessun comando ai termostati reali senza il via libera di Alex.** Tutte le prove di questo documento che
>   fanno partire un comando (assegnazione, forzatura, pausa, riavvio con forzatura) si fanno solo sulla stanza di
>   prova e solo dopo un esplicito "via".
> - **La copia in `/config/custom_components/` e il riavvio di HA li fa Alex** (o li autorizza). Chi scrive questa
>   lista non ha accesso a HA reale e non lo ha usato.
> - **Per provare codice nuovo non serve alzare la versione**: il percorso dei file e'
>   `/cronotermostato_static/<versione>-<impronta>/...`, dove l'impronta (8 caratteri esadecimali) e' lo sha256 di nomi e
>   contenuti di tutti i file di `frontend/`, calcolata all'avvio di HA: se il codice cambia, l'URL cambia. **Resta
>   il riavvio di HA** (a cura di Alex) per caricare il Python e il nuovo percorso statico. La versione del manifest
>   (ora **0.1.0**) la alza Alex solo per le release.
> - Lo Scheduler resta com'e' e non si tocca; la stanza di prova va tolta dallo Scheduler (o se ne disattiva solo la
>   regola di quella stanza) per tutta la durata della prova.
> - L'integrazione base (servizi, controllore) ha la sua lista: `docs/PROVA_SU_HA.md`. Questa copre l'editor.

Stanza di prova: `climate.termostato_casa` (stessa convenzione di `PROVA_SU_HA.md`: min 15, max 25, `hvac_modes`
heat/off, preset `none`, `away`, `comfort`, `eco`, `home`, `sleep`, `activity`) - **da confermare da Alex**: ______
Versione installata: ______   Data: ______   Browser / telefono: ______

Per ogni voce: spuntare se va come descritto; altrimenti annotare cosa e' successo (testo esatto, schermata,
riga del log).

## 1. Installazione

- [ ] Copiare la cartella (a cura di Alex), riavviare HA, aggiungere l'integrazione se non c'e' gia'.
      Osservare: nessun errore per `cronotermostato` nel log.
- [ ] Nella barra laterale c'e' la voce **Cronotermostato** (default: visibile).
- [ ] **Senza aggiungere nessuna risorsa a mano** (Impostazioni -> Dashboard -> Risorse invariata): in una dashboard,
      "Aggiungi scheda" mostra **Cronotermostato** con la descrizione. Annotare il testo mostrato.
- [ ] La console del browser (F12) non mostra errori rossi caricando il pannello e una dashboard con la scheda.

Note: ______

## 2. Opzioni e permessi

- [ ] Integrazione -> Configura: ci sono "Mostra nella barra laterale" e "Solo amministratori", con i valori
      predefiniti attivi, e la nazione/regione intatta (salvando, la nazione non cambia).
- [ ] Spegnere "barra laterale", salvare, ricaricare la pagina: la voce **sparisce**; la scheda in dashboard
      **funziona ancora**.
- [ ] Riaccenderla: la voce **torna** (dopo il ricarico).
- [ ] Utente **non amministratore** (da telefono, con un secondo utente):
  - [ ] "Solo amministratori" attivo: la voce laterale non c'e'.
  - [ ] Aprire a mano `/cronotermostato` come non admin: **da verificare cosa succede** (pagina, errore, vuoto,
        editor funzionante?). Annotare: ______
  - [ ] "Solo amministratori" disattivato: la voce c'e' per il non admin e l'editor si apre.
  - [ ] Con "solo admin" attivo, un salvataggio/assegnazione/eliminazione da un client WebSocket come non admin
        risponde `unauthorized` (es. Strumenti per sviluppatori non basta: serve un client WS, o provare dalla scheda
        `editor` aperta da un non admin e annotare il messaggio mostrato). Annotare: ______
  - [ ] **Limite noto:** come non admin, `cronotermostato.create_program`/`assign` da Strumenti per sviluppatori
        (o da un'automazione) **funzionano ancora**. Annotare se e' cosi' (e' il comportamento documentato, in attesa
        di una decisione di Alex).
  - [ ] Pausa, ripresa, forzatura e "Torna in automatico" funzionano anche per il non admin (scelta voluta).

Note: ______

## 3. Programma

- [ ] Crea un programma (nome con accento e spazi, ad esempio "Prova casa").
- [ ] Aggiungi fasce con **temperatura** e fasce con **preset**; salva, richiudi l'editor, riaprilo: ritrovi tutto.
- [ ] Una fascia che si sovrappone a un'altra: errore chiaro, non si salva.
- [ ] Le fasce **automatiche** (buchi riempiti con "spento") hanno il segno che le distingue.
- [ ] Giorno festivo: modifica e salva; il collegamento "opzioni dell'integrazione" per la nazione e' presente.
- [ ] Copia giorno (su uno o piu' giorni): il risultato e' quello atteso.
- [ ] Elimina un programma **assegnato**: rifiutato con messaggio. Elimina uno **libero**: riesce.
- [ ] Nome di programma molto lungo e con caratteri strani (`<b>x</b>`, `"`): mostrato come testo, l'elenco non si rompe.

Note: ______

## 4. Due editor / due dispositivi

- [ ] Aprire l'editor sul computer e sul telefono. Modificare e salvare un programma su uno: l'altro si aggiorna da solo.
- [ ] Salvataggio concorrente (stesso programma modificato su entrambi, poi salvare in sequenza): sul secondo compare
      l'avviso di **conflitto** con la scelta ricarica / sovrascrivi; entrambe le scelte fanno quello che dicono.
- [ ] Due schede nella stessa dashboard (o scheda + pannello aperti insieme): nessun doppione di dati, nessun errore in console.

Note: ______

## 5. Stanza di prova (SOLO con il via libera di Alex)

Via libera ricevuto: [ ] si'  (da Alex, il ______)

- [ ] Assegna il programma alla stanza di prova dall'editor: il termostato riceve modo e temperatura della fascia
      attuale; nessun altro termostato e' stato comandato.
- [ ] Lo stato mostrato nell'editor coincide con `sensor.<stanza>_programma` (fascia attuale, prossima, stato).
- [ ] Fascia volutamente incompatibile, una alla volta (poi ripristinare):
  - [ ] preset non elencato dal termostato (es. `boost`): `unsupported_preset`, l'editor avvisa, nessun comando.
  - [ ] modo non supportato (`cool` su un termostato heat/off): `unsupported_mode`, l'editor avvisa.
  - [ ] temperatura fuori limiti (30): `out_of_range`, l'editor avvisa prima/dopo il salvataggio, nessun comando.
- [ ] **Pausa** e **Riprendi** dall'editor e dalla scheda `rooms`: `status: paused`, poi la fascia attuale riapplicata.
- [ ] **Forzatura** (temperatura/preset/spento) fino a fine fascia e **Torna in automatico**: il termostato segue,
      lo switch automatico e l'editor sono coerenti.
- [ ] Togliere la stanza dal programma dall'editor: il termostato resta com'e'.

Note: ______

## 6. Riavvio di HA con forzatura attiva (SOLO con il via libera di Alex)

Via libera ricevuto: [ ] si'

- [ ] Forzare la stanza di prova dall'editor; verificare che il comando sia arrivato.
- [ ] Riavviare HA (a cura di Alex).
- [ ] Dopo il riavvio l'editor e la scheda mostrano ancora la forzatura con la stessa fine; comandi al termostato
      solo come descritto in `PROVA_SU_HA.md` sezione 4 (all'avvio il `climate` puo' essere `missing`).
- [ ] L'editor si riconnette da solo (o dopo ricarico: annotare quale) senza lasciare dati vecchi a schermo.

Note: ______

## 7. Scheda nell'editor Lovelace reale

- [ ] Selettore schede: "Cronotermostato" con descrizione e icona/anteprima come atteso (l'anteprima e' disattivata
      di proposito: annotare cosa si vede).
- [ ] L'editor visuale della scheda: cambio vista (`rooms` / `editor`), titolo, programma, scelta delle stanze; il
      YAML risultante e' corretto e le opzioni sconosciute del YAML (`grid_options`, `visibility`) non spariscono.
- [ ] Modificare dal YAML con una configurazione sbagliata (`view: x`, `rooms: [sensor.a]`): messaggio comprensibile
      al posto della scheda, nessuna dashboard rotta.
- [ ] Dashboard a **sezioni**: la scheda si ridimensiona (larghezza minima 6 colonne, altezza automatica), si sposta
      e non esce dalla sezione; provare anche la dashboard classica (masonry).
- [ ] La vista `editor` in una scheda funziona come nel pannello (apri/salva un programma).
- [ ] Salvare la dashboard e ricaricare: la scheda torna uguale.

Note: ______

## 8. Tema, lingua, telefono, tastiera

- [ ] Tema **scuro** di HA: testi leggibili, colori dei modi (riscaldamento/raffrescamento) distinguibili, stato non
      espresso solo dal colore.
- [ ] Un **tema personalizzato** (annotare quale): nessun colore fuori posto, contrasto sufficiente.
- [ ] Lingua inglese (profilo utente): nessuna scritta italiana rimasta ne' chiave grezza (`band.xxx`).
- [ ] Telefono in verticale e in orizzontale (pannello e scheda): nessuno scorrimento orizzontale, bersagli
      toccabili senza sbagliare.
- [ ] **Tastiera**: Tab percorre tabella, pulsanti e campi in ordine sensato, con focus ben visibile.
- [ ] Nei **dialoghi** (forzatura, conferma eliminazione, conflitto): il focus entra nel dialogo, Tab non esce,
      Esc chiude, e alla chiusura il focus **torna** al pulsante che l'aveva aperto.
- [ ] Un lettore di schermo (se a portata) legge i nomi dei pulsanti e lo stato delle stanze.

Note: ______

## 9. Link alle opzioni dell'integrazione e app companion

- [ ] Dentro il **pannello**: il collegamento alle opzioni dell'integrazione (nazione, festivi) porta alla pagina
      giusta e il tasto indietro riporta all'editor.
- [ ] Dentro una **scheda** in dashboard: lo stesso collegamento; se ci sono modifiche non salvate si apre in una
      nuova scheda (`target=_blank`) e le modifiche non si perdono.
- [ ] **App companion** (telefono): il pannello e la scheda si aprono; il collegamento con `target=_blank` si apre
      (nel browser o nell'app: annotare come) e si puo' tornare indietro.
- [ ] App companion: la scheda `rooms` mostra e forza le stanze come nel browser.

Note: ______

## 10. Cache dopo un aggiornamento

Non serve alzare la versione: basta che cambi il contenuto di un file di `frontend/`.

- [ ] Con l'editor gia' aperto/caricato nel browser e nell'app, cambiare una scritta visibile (es. un'etichetta in
      `frontend/i18n/it.js`).
- [ ] Copiare, riavviare HA (a cura di Alex), ricaricare la pagina **senza** svuotare la cache: la scritta nuova c'e'.
- [ ] Controllare in F12 -> Rete che i file arrivino da `/cronotermostato_static/<versione>-<nuova impronta>/...` (l'impronta
      e' diversa da quella di prima).
- [ ] Ripetere nell'app companion senza svuotarne la cache. Se serve un ricarico forzato o "Cancella cache del
      frontend" nell'app, annotarlo: e' un limite da dire nel README.
- [ ] Prova negativa (facoltativa): copiare i file nuovi **senza riavviare** HA: l'URL non cambia (l'impronta si
      calcola all'avvio) e puo' presentarsi il JS vecchio; conferma che il riavvio serve.

Note: ______

## Esito

Tutto spuntato: [ ] si'  [ ] no. Problemi trovati e da correggere: ______
