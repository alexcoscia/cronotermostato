# Piano 3 — Tile Tessera `cronotermostato`

Stato: **bozza da approvare** (Alex, 2026-11-02). Parte 3 di 3 del progetto (vedi `specs/2026-11-01-cronotermostato-design.md`, sezioni 7 e 8).
Esecuzione con agenti, come da `CLAUDE.md`: un agente per passo, un revisore prima del passo successivo, revisione finale.

## Scelte di Alex (2026-11-02)
- **Misura minima 2x2** (il 2x1 del design è abbandonato). Niente tile più piccolo.
- **Disposizione**: tasto **`+` a sinistra**, **setpoint e temperatura reale al centro**, tasto **`−` a destra**.
  (Nota: `thermo_dial` ha `−` a sinistra e `+` a destra; qui è invertito su richiesta di Alex.)
- **Barra orizzontale sotto**, per il **giorno attuale**, con **colori diversi per le fasce** (ambra riscaldamento, blu
  raffrescamento, grigio spento), con lo stesso disegno della barra 0–24 dell'editor di HA (`crono-day.js`,
  `lib/day-editing.js` `stripSegments`).
- Restano dal design: nome stanza, pillola programma "fino alle HH:MM", tasti Auto / Manuale, "MANUALE ✕" per tornare in
  automatico, colori del setpoint ambra/blu come `thermo_dial` 0.3.1.

## Come è fatto un plugin Tessera (regole in `~/tessera-plugins/AGENTS.md`)
Cartella con `tessera-plugin.yaml`, `plugin.yaml` (ESPHome), `components/cronotermostato/` (C++), `translations/en.json`
(+ `it.json`), `README.md`, `CHANGELOG.md`, `preview.yaml`, `store.png`. Id `cronotermostato`, per sempre. Si parte
da `python3 tools/new_plugin.py cronotermostato ../tessera-cronotermostato`. Si verifica con `tools/check.py` e con il
banco (`tools/preview.py --strict`). Niente parole nel codice (solo chiavi di traduzione), colori solo per ruolo/tono,
dimensioni con `ui::mm`/`ui::px`, nessun timer (solo `on_tick`), nessun gestore di click LVGL (solo `Tile::on_tap`).

## I dati (decisione di progetto)
**API dei plugin: 0.24** (`~/espscreen/components/smart_display/plugin_api.h`; la 0.14 che dava la copia locale di
`tessera-plugins` era vecchia: aggiornata il 2026-11-02 con un fast-forward). Il manifest dichiarerà `api: "0.24"`
(minimo 0.15 per l'opzione `entity`). Con la 0.24 `tessera::action` si chiama solo con `(service, entity, fields)` e
`memory` è un numero.

Un tile ha **un'entità sua** e può avere **opzioni di tipo `entity`** (0.15) che arrivano a `on_state` sotto `entities`.
Quindi, senza copiare nulla:
- **Entità del tile = il `climate`** (come `thermo_dial`): `target`, `current_temperature`, `hvac_action`, `min_temp`,
  `max_temp`, `target_temp_step`, nome.
- **Opzione `room` (sensore di stanza `sensor.<stanza>_programma`)**: `slot`, `next_slot`, `slot_end`, `manual`,
  `override_until`, `status` (già esposti) **più le fasce del giorno attuale, che oggi mancano**.
- Dimensione: entità e opzioni si dividono 2,6 KB: le fasce vanno in forma compatta (liste piatte).

**Integrazione 0.2.0 (solo aggiunte, mia scelta):** il sensore di stanza espone `today_start`, `today_end` (minuti dalla
mezzanotte), `today_mode` (0 spento / 1 caldo / 2 freddo), `today_temp`, `today_auto` (liste parallele (più, piatti, `slot_mode`, `slot_temp`, `slot_start_time`, `slot_end_time`, `next_mode`, `next_temp`, `next_start_time`, `override_until_time`, perché i dizionari non arrivano al tile), perché i `fields`
con `as: numbers` tengono liste di numeri e non di oggetti). Nessun attributo copiato dal climate.

**Azioni:** `+`/`−` con `cronotermostato.set_manual` (così la forzatura dura fino alla fine della fascia; un
`climate.set_temperature` verrebbe riscritto al prossimo cambio di fascia senza dirlo), Auto e "MANUALE ✕" con
`cronotermostato.resume_auto`, dichiarate in `permissions.home_assistant_actions`. Da verificare nel passo 0 che
l'azione di un'altra integrazione si possa chiamare con l'entità del tile.

**Firmware di Alex:** serve un Tessera con API ≥ 0.15 (thermo_dial dichiara 0.12). Da chiedere ad Alex la versione.

## Esiti del passo 0 (spike, `~/tessera-cronotermostato/SPIKE.md`, commit dbca4f8)
- Il tile riceve il climate come entità sua e il sensore di stanza in `entities.room`; le liste di numeri arrivano intere
  (3-10 fasce ≈ 0,6 KB su 2,6). **I dizionari (`slot`, `next_slot`) NON arrivano**: servono attributi piatti.
- `slot_end` e `override_until` arrivano come testo ISO: solo i nomi che finiscono per `_at`, `_time`, `date` diventano
  epoch → l'integrazione deve esporre anche `slot_end_time` e `override_until_time`.
- Colori: ambra `Tone::BUSY`, blu `Tone::ACCENT`, grigio `Tone::NORMAL` + `theme::SUBTLE`, fondo `theme::TRACK`, tacca
  `theme::INK`. Il setpoint ambra dà il warning "too faint" (lo dà anche `thermo_dial`): `--strict` non sarà pulito per
  quello, da discutere con Alex.
- **Azioni**: si chiamano con `entity = ""` e `climate_entity_id` nei campi (i servizi dell'integrazione non hanno
  `entity_id`). Con `entity` vuota il tile non aspetta la risposta: il ritorno al valore reale dopo 5 s è compito del tile.
  Il firmware non controlla `home_assistant_actions`, ma si dichiarano comunque.
- Tocco sulla barra → `open_card` con lo stesso messaggio (c'è anche `entities.room`): card con fino a 16 righe.
- 2x2 ok su CYD orizzontale (nome nascosto per altezza), Guition 4", 7B, 10.1"; **non si può mettere su schede verticali a
  1 colonna** (Waveshare 4.3", CYD verticale). La 7B di Alex va in entrambe le orientazioni.
- La tacca "adesso" e la barra usano minuti da orologio a muro 0-1440 anche nei giorni da 23/25 ore (integrazione 0.2.0).
- Non verificato: schermo vero, HA vero, `tap_point()` sulla barra, formato di `temperature` nei servizi.

## Passi

**Passo 0 — Verifica dell'API (prove rapide, nessuna promessa).** Sul banco di `tessera-plugins`: (a) un tile 2x2 con un
sensore e liste di numeri in `fields`; (b) una fila di `ui::block` colorati con `ui::set_fill` per la barra e la tacca
dell'ora attuale; (c) `tessera::action(service, entity, fields)` verso un servizio di un'altra integrazione, con l'entità del tile (il climate) e `entity_id` tra i campi; (d) quanti
segmenti ci stanno (limite di memoria `memory` del tile; la barra ha di solito 3–9 fasce: prevedere un massimo, es. 16);
(e) se i toni dispongono di ambra e blu (come `thermo_dial`) o servono ruoli diversi. Esito scritto in `SPIKE.md` del nuovo
repository. Se (c) non è possibile, il `+`/`−` ripiega su `climate.set_temperature` e si dice ad Alex.

**Passo 1 — Integrazione 0.2.0: fasce di oggi sul sensore di stanza** (repository `cronotermostato`). Test Python prima
(TDD): fasce di oggi con fasce automatiche, giorno festivo, cambio di giorno a mezzanotte, ora legale, stanza senza
programma (attributi vuoti), pausa, forzatura; il sensore si aggiorna al cambio del climate. Documentare in README.

**Passo 2 — Scheletro del plugin** in `~/tessera-cronotermostato` (solo locale, nessun push): `new_plugin.py`, manifest
(tile `room`, `domains: [sensor]`, `has_attributes` per proporre solo i sensori dell'integrazione, `sizes` min 2x2),
`permissions` (le due azioni), traduzioni en/it, `check.py` verde.

**Passo 3 — Logica pura in C++ con test** (`tests/test_logic.cpp`, come `thermo_dial`): da minuti a posizioni dei
segmenti (stessa matematica di `stripSegments`, parità con i casi di `frontend/tests`), arrotondamento al passo, limiti,
testo "fino alle HH:MM", scelta del tono, ritorno al valore reale dopo 5 s senza conferma, invio ritardato di 600 ms.

**Passo 4 — Il tile 2x2** (solo vista): nome, `+`/valori/`−`, barra con tacca "adesso", pillola programma. Banco su tutte
le schermate, chiaro e scuro; `preview.yaml` con dati reali (riscaldamento, raffrescamento, spento, forzatura, programma
assente, non disponibile).

**Passo 5 — Interazione**: `+`/`−` (azione `set_manual`, ritardo 600 ms), Auto/Manuale, "MANUALE ✕", stato non disponibile
(trattino e tasti inerti). Tocco sulla barra: nessuna azione nella v1 del tile (decisione di Alex da prendere dopo la prova).

**Passo 6 — Rifinitura e pubblicazione locale**: README (`## Set up`), `CHANGELOG.md`, `store.png`, `check.py` e banco
`--strict` verdi. Prova su schermo vero (Waveshare 7" come `thermo_dial`) copiando la cartella in `tessera-plugins/` di
HA: **solo con il via libera di Alex**, e nessun comando a termostati reali senza il suo via libera (stanza di prova
`climate.termostato_casa`).

**Fase 2 (dopo la prova)**: tabella delle fasce del giorno modificabile dal pannello (design sezione 8), se l'API lo permette.

## Non si fa senza chiedere
Push, creazione del repository GitHub, release, comandi a termostati reali, modifiche allo Scheduler.

## Decisioni prese da Alex (2026-11-02)
- Tessera **0.4.93 (firmware 0.59.0)**: API plugin 0.24 disponibile (dalla 0.4.91).
- **Il tocco sulla barra apre l'elenco delle fasce del giorno** (una *card* del plugin, API "A card"): da aggiungere al passo 5.
- **Integrazione 0.2.0** con le fasce di oggi sul sensore di stanza: approvata.
- Repository `tessera-cronotermostato`, solo locale.

## Decisioni aperte per Alex (ormai chiuse sopra, tranne la 4)
1. Va bene aggiungere le fasce di oggi al sensore di stanza (integrazione 0.2.0)? Il resto lo legge il tile dal climate.
   Che versione di Tessera hai (serve API ≥ 0.15)?
2. Il tocco sulla barra: nulla (proposta), oppure apre una scheda con l'elenco delle fasce del giorno?
3. Nome del repository `tessera-cronotermostato`, solo locale per ora.
4. Quali schermi vuoi coprire oltre al Waveshare 7"? (il banco ne prova altri; il minimo 2x2 su schermi piccoli come il CYD
   potrebbe essere stretto: la barra dovrebbe restare leggibile.)
