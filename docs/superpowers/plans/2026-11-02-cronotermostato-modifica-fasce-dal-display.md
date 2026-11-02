# Piano 4 — Modifica delle fasce dal display Tessera

Stato: **approvato nelle linee generali da Alex (2026-11-02)**. Esecuzione con agenti come da `CLAUDE.md` (un agente per passo,
revisore prima del passo successivo). Nessun push, nessun comando a termostati reali senza via libera.

## Decisioni di Alex
- Il programma è **condiviso**: la modifica dal display cambia il programma per **tutte** le stanze che lo usano. Si dice in
  modo ben visibile ("Programma «Casa», usato da N stanze"). Nessuna copia per stanza.
- Si modifica **solo il giorno attuale** (il giorno della settimana di oggi; la parte festiva se oggi è festa). Gli altri
  giorni restano nell'editor di HA.
- Opzione del tile **"Consenti la modifica delle fasce"**, **attiva di default**.

## Come funziona
- Dalla card (tocco sulla barra) si entra nella modifica: una riga per fascia; tocco sulla riga → pannello con **inizio,
  fine, modo, temperatura** (`+`/`−`, passi di 5 min e del passo del termostato), **Aggiungi**, **Elimina**, **Salva**.
- Si scrive con un nuovo servizio dell'integrazione `cronotermostato.set_day` (lato integrazione: stessa validazione e
  normalizzazione dell'editor di HA; le fasce automatiche "spento" restano calcolate e non si modificano).
- Il formato delle fasce nel servizio è **compatto e testuale** (da verificare nello spike che l'API del display lo
  permette e quanti byte ha un campo): es. `07:00-22:00 heat 20.5; 22:00-24:00 off`.
- Feedback: il sensore di stanza si aggiorna (`today_*`); se l'integrazione rifiuta, un attributo `last_error`
  (codice breve) lo dice e il display mostra "Non salvato: <motivo>". Se non cambia nulla entro ~5 s: "Non salvato".
- Il tile deve conoscere nome del programma e numero di stanze (attributi piatti nel sensore di stanza: `program_name`,
  `program_rooms`), il giorno modificato (`today_kind`: giorno della settimana o `holiday`) e `last_error`.

## Passi
**A — Integrazione 0.3.0** (repo `cronotermostato`): servizio `set_day(climate_entity_id, bands)` e attributi `program_name`,
`program_rooms`, `today_kind`, `last_error`; test prima; revisione; README; permessi/limiti come per gli altri servizi
(restano aperti a ogni utente, vedi README). Il giorno modificato è deciso dall'integrazione (oggi della stanza), non dal
display, per evitare che una pagina vecchia scriva sul giorno sbagliato; il display manda anche la data/`today_kind`
che vede e l'integrazione rifiuta se non coincide (`stale_day`).
**B — Spike sul banco** (plugin): popup o pannello nella card con tasti? lunghezza di un campo testuale in `tessera::action`?
tocchi ripetuti, scorrimento, righe ≥7 mm, schermi piccoli. Esito in `docs/SPIKE_MODIFICA.md`.
**C — Logica pura C++ con test**: modello di modifica (elenco fasce utente, selezione, +/−, aggiungi/elimina, validazione
locale: inizio<fine, 00:00–24:00, nessuna sovrapposizione, ordine, massimo fasce), codifica del testo del servizio,
stato di salvataggio (in attesa/ok/errore/timeout).
**D — Interfaccia**: card in modifica, pannello fascia, opzione `edit` del tile (attiva), traduzioni en/it.
**E — Revisione finale e prova su schermo con la stanza di prova** (`climate.termostato_casa`; la modifica cambia un
programma: usare un programma di prova assegnato solo alla stanza di prova).

## Esiti dello spike (passo B, `~/tessera-cronotermostato/docs/SPIKE_MODIFICA.md`) e decisioni conseguenti
- **Pannello = card, non popup** (il popup su CYD taglia la riga Elimina/Salva, non scorre e non riceve `on_state`). La card
  riceve `on_state` anche con un popup sopra. Un solo `on_tap` per card: i tasti si riconoscono con `tessera::tap_point()`.
- **Righe da 7 mm:** CYD 3 (2 con intestazione), Hosyond 4, Guition 4" 6, 7B 8, 10.1" 14. Niente scorrimento: **pagine
  con `<` `>`**. Dettaglio a 4 righe (Inizio, Fine, Modo+Temperatura, Elimina/Salva/Indietro): ci sta su tutte (CYD per 7 px,
  senza riga di stato: lo stato di salvataggio va dentro il tasto Salva: "…", "Salvato", "Errore").
- **Tocchi ripetuti:** due tocchi sullo stesso punto entro ~600 ms valgono come uno → **passi grandi**: orari con
  `−1h −15 +15 +1h` (non 5 minuti); temperatura col passo del termostato.
- **Testo del servizio:** limite 1024 byte totali nei `fields` → ≤ **960 caratteri** di fasce (16 fasce ≈ 370).
- **Limite di 16 attributi per entità nell'opzione `room`:** oggi 15. Si fa spazio: l'integrazione aggiunge un unico attributo di
  testo **`edit_info`** = `<today_kind>;<program_rooms>;<program_revision>;<last_error>` (gli attributi separati restano per
  chi usa HA) più `today_preset` e `today_locked`; il manifest toglie quelli inutili (`slot_mode`, `slot_temp` se non usati).
- **Conflitti:** il core non chiude il pannello se `on_state` cambia le fasce. Il display tiene la revisione vista
  (`program_revision`) e, se cambia mentre è in modifica, torna all'elenco con "Cambiato altrove". L'integrazione rifiuta
  anche con `conflict` se `set_day` riceve `base_revision` diverso da quella attuale (campo opzionale per gli altri client).
- **Fasce bloccate** (`today_locked`) o giorno con `day_locked`: il display mostra le fasce ma non permette Salva e lo dice.
- **Collaudo:** logica pura con test C++; lo script di tocchi su banco dello spike (`flow.py`) come prova di regressione nel
  repo del plugin; prova su schermo vero.
