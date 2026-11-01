# Cronotermostato: progetto

Data: 2026-11-01. Stato: bozza da approvare. Parti scritte da chi ha chiesto il progetto sono segnate "deciso"; le scelte
fatte da chi scrive sono segnate "mia scelta" e vanno controllate.

## 1. A cosa serve

Alex ha in Home Assistant (HA) 12 entità `climate`: sette termostati di riscaldamento (Casa, Bagno, Camera 1, Camera 2,
Cucina, Salotto, Vetrina bar), due condizionatori, due OpenTherm e un termostato non disponibile. Oggi li programma con lo
Scheduler (HACS): ogni schedule è legato a un elenco di stanze e a giorni fissi, quindi lo stesso orario "feriale" va
rifatto per ogni gruppo di stanze e cambiarlo vuol dire cambiarlo in più punti.

Si vuole un **cronotermostato**: programmi settimanali con fasce orarie, temperature e modo, definiti **una volta** e
**assegnati a più stanze**, con una parte dedicata ai giorni di festa. Deve funzionare **anche senza il pannello**, essere
modificabile **sia dal pannello a tocco sia da HA/telefono**, e mostrare sul pannello il programma attivo, fino a quando
dura e cosa viene dopo. Deve poter essere **pubblicato su HACS** come integrazione indipendente.

## 2. Obiettivi, non obiettivi, anti-obiettivi

Obiettivi (deciso):
- Un programma è un'entità riusabile; più stanze possono usare lo stesso programma (es. "Feriale" su Bagno e Cucina).
- Ogni programma ha una parte per i **giorni normali** (impostata per giorno della settimana) e una parte per i **festivi**.
- Fasce con ora di inizio e di fine, modo e temperatura. Il programma calcola da solo le fasce rimaste vuote e le mostra
  come **fasce automatiche, spente di default**; l'utente può modificarle e allora diventano sue.
- Modi di una fascia: riscaldamento, raffrescamento, spento (anche per i condizionatori).
- Le festività dipendono dalla **nazione scelta** (non fissa sull'Italia).
- Forzatura manuale per stanza: dura fino al prossimo cambio di fascia, oppure finché l'utente non rimette in automatico.
- Funziona senza il pannello: a comandare i termostati è l'integrazione di HA.
- Convive con lo Scheduler: l'utente lo sostituisce una stanza alla volta.
- Tile Tessera (2x1 e 2x2) sul modello del `thermo_dial`, con i colori già scelti (ambra riscaldamento, blu raffrescamento).

Non obiettivi (mia scelta, per la prima versione):
- Giorni di festa personalizzati (patrono, ferie): solo quelli della nazione scelta.
- Preset dei termostati (`home`, `away`, `eco`…) come azione di una fascia: una fascia dà modo e temperatura.
- Modi diversi da riscaldamento, raffrescamento e spento (niente `heat_cool`, `auto`, `fan_only`).
- Rilevare modifiche fatte altrove (manopola fisica del termostato, app del costruttore) e trattarle come forzature.
- Sostituire o migrare in automatico gli schedule dello Scheduler.

Anti-obiettivi (un risultato che sarebbe un fallimento anche se "funziona"):
- Una stanza non assegnata a nessun programma non viene mai comandata.
- Nessun conflitto con lo Scheduler: l'integrazione tocca solo le stanze assegnate e non scrive nulla fuori da sé.
- Nessuna dipendenza dal pannello per eseguire i programmi.
- Nessun comando a ogni minuto: si comanda solo quando cambia la fascia, all'avvio e quando si cambia la configurazione.

## 3. Come è fatto (tre parti)

1. **Integrazione HA `cronotermostato`** (HACS): la logica, le entità, i servizi. Si costruisce per prima.
2. **Editor in HA** (scheda Lovelace fornita dall'integrazione): per creare e modificare programmi da HA e dal telefono.
3. **Tile Tessera `cronotermostato`**: vede lo stato, forza e rimette in automatico; l'editing dal pannello è un obiettivo
   da verificare (vedi sezione 8).

Repository: la parte 1 e 2 stanno in un repository HACS (nome `cronotermostato`, mia scelta); la parte 3 in un repository
plugin Tessera separato (`tessera-cronotermostato`), perché Tessera pretende la struttura del plugin alla radice. La
cartella creata oggi, `~/tessera-cronotermostato`, ospita per ora questo documento e sarà rinominata o riusata quando si
parte (da decidere con Alex).

## 4. Modello dei dati

**Fascia**: `inizio`, `fine`, `modo` (`heat`, `cool`, `off`), `temperatura` (assente se `off`), `automatica` (vero se
calcolata dal programma).

**Giorno**: una sequenza di fasce che copre le 24 ore senza buchi né sovrapposizioni. L'utente inserisce le fasce che
vuole; lo spazio rimasto viene riempito da fasce automatiche `off`. Estremi senza minuti di scarto (mia scelta): la fascia
8:00-12:00 e la successiva dal 12:00; sul tile si legge "fino alle 12:00". Le fasce non possono sovrapporsi: l'editor e i
servizi rifiutano un programma con sovrapposizioni.

**Continuità oltre la mezzanotte**: la fascia dopo l'ultima del giorno dura fino alla prima del giorno dopo, che può essere
di un altro tipo (feriale, sabato, festivo); quindi "fino a…" può essere un'ora del giorno successivo.

**Programma**: `nome`; sette giorni (lunedì-domenica) di fasce per i giorni normali; un giorno di fasce per i festivi.
Un giorno festivo (secondo la nazione scelta) usa sempre la parte festiva, anche se cade di domenica.

**Assegnazione**: una stanza (entità `climate`) ha **un solo programma** alla volta (mia scelta); un programma ha molte
stanze. Un'assegnazione si può mettere in pausa senza toglierla.

**Forzatura**: per stanza. Si imposta con un servizio (modo e temperatura) e finisce al prossimo cambio di fascia della
stanza, oppure con "rimetti in automatico". Una forzatura sopravvive al riavvio di HA fino alla sua fine.

**Configurazione generale**: nazione (e, se la libreria lo prevede, suddivisione/regione) per le festività.

## 5. Comportamento

- **Motore**: un'attività per stanza programma il prossimo cambio di fascia e lo rinnova a ogni cambio, a ogni modifica di
  programma o di assegnazione, a ogni riavvio. Orari secondo il fuso orario di HA; il cambio dell'ora legale non crea buchi.
- **Quando comanda**: al cambio di fascia, all'avvio di HA (applica la fascia corrente, a meno di una forzatura attiva),
  quando una stanza viene assegnata o ripresa dalla pausa, e quando una forzatura finisce. Ordine dei comandi: prima il
  modo, poi la temperatura.
- **Termostato non disponibile** al momento del cambio: riprova quando torna disponibile e applica la fascia di quel momento.
- **Modo non supportato** (es. `cool` su un termostato che ha solo `heat` e `off`): non comanda quella fascia, lo segnala
  nel log e in un'entità di stato della stanza. Non cambia modo da solo.
- **Festività**: dalla libreria Python `holidays` (la stessa dell'integrazione Festività di HA), con nazione e suddivisione
  scelte dall'utente (mia scelta sulla libreria; da verificare i requisiti di HACS).
- **Modifiche fatte altrove** (manopola, app): non sono viste come forzature. Valgono finché non cambia la fascia.

## 6. Entità e servizi (nomi provvisori)

Per ogni stanza assegnata:
- `sensor.<stanza>_programma`: stato = nome del programma attivo; attributi: fascia attuale (inizio, fine, modo,
  temperatura), fascia successiva, `fine_fascia`, `manuale` (vero/falso), `fine_forzatura`, `automatica` (la fascia è
  calcolata), `festivo` (oggi vale la parte festiva).
- `switch.<stanza>_automatico`: acceso = automatico, spento = forzatura. Accenderlo rimette in automatico (è il tasto Auto
  del tile e la scritta MANUALE).

Per ogni programma: `sensor.programma_<nome>` con la definizione completa negli attributi e l'elenco delle stanze.

Servizi: `create_program`, `update_program`, `delete_program`, `assign`, `unassign`, `pause`, `resume`, `set_manual`
(stanza, modo, temperatura), `resume_auto` (stanza). In più un'API WebSocket per l'editor.

## 7. Schermate

Tile Tessera (bozze approvate da Alex: B per il 2x2, A per il 2x1, la scritta "MANUALE" come tasto nel 2x1):
- **2x2**: nome della stanza, `−` setpoint `+`, temperatura reale con il simbolo di stato, pillola col nome del programma e
  "fino alle HH:MM", riga "poi <programma> · <temp>", tasti Auto / Manuale.
- **2x1**: `−` setpoint `+`, temperatura reale e simbolo sotto, riga col programma e "fino alle HH:MM". In forzatura la riga
  diventa la pillola arancione "MANUALE ✕", che riporta in automatico se toccata.
- **Colori**: ambra quando riscalda, blu quando raffredda, colori attuali negli altri casi (come `thermo_dial` 0.3.1).
- Le fasce automatiche si vedono anche nell'editor, con un segno che dice che sono calcolate.

Editor in HA: scheda Lovelace con l'elenco dei programmi, la griglia della settimana, la parte festiva e l'assegnazione alle
stanze (ispirata allo Scheduler già installato).

## 8. Rischi e cose da verificare presto

- **Editing dal pannello**: Alex lo vuole. Dipende da ciò che l'API plugin di Tessera permette (campi di inserimento, liste
  scorrevoli). Da provare con una prova veloce prima di promettere. Se non basta, il pannello vede/forza e le modifiche si
  fanno da HA (da concordare con Alex).
- **Il tile deve leggere due entità** (il termostato e il suo sensore di programma): da verificare nell'API plugin.
  Alternativa: tile legato al sensore del programma, con l'id del termostato negli attributi.
- **Requisiti HACS** (struttura, `manifest.json`, `hacs.json`, icone, release GitHub): da verificare sulla documentazione
  attuale all'inizio della costruzione.
- **Lingue**: interfaccia in italiano e inglese; codice e README in inglese (mia scelta).

## 9. Lasciato a chi costruisce

Formato interno di salvataggio, struttura dei moduli Python, nomi definitivi delle entità e dei servizi, test (la logica
dei programmi deve girare e provarsi senza HA: fasce, riempimento dei buchi, mezzanotte, ora legale, festività,
fine della forzatura), grafica dell'editor entro le bozze approvate.

## 10. Ordine di lavoro proposto (mia scelta)

1. Integrazione `cronotermostato` (logica, entità, servizi, festività, test).
2. Editor in HA.
3. Tile Tessera: prima solo vista e Auto/Manuale, poi la prova sull'editing dal pannello.
