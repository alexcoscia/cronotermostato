# Cronotermostato: integrazione HA, piano 1 di 3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un'integrazione HA personalizzata (HACS) `cronotermostato`: programmi settimanali riusabili con fasce, festivi per nazione, forzatura manuale, assegnati a più stanze `climate`.

**Architecture:** Un motore puro in Python (`engine/`, nessun import di HA) calcola fasce, buchi, mezzanotte e festivi; uno strato HA (`store`, `controller`, entità, servizi, WebSocket) lo esegue. Niente comandi continui: solo ai cambi di fascia, all'avvio e alle modifiche.

**Tech Stack:** Python 3.14 (come HA), HA core 2026.10.4, libreria `holidays` (HA 2026.10.4 la fissa a `==0.106`), `pytest` + `pytest-homeassistant-custom-component`, `uv`.

**Spec:** `docs/superpowers/specs/2026-11-01-cronotermostato-design.md`. Questo piano copre la parte 1 (integrazione). L'editor in HA (parte 2) e il tile Tessera (parte 3) hanno piani propri, da scrivere dopo; il tile richiede prima una prova sull'API plugin.

## Global Constraints

- Dominio `cronotermostato`; repository HACS `cronotermostato` (la cartella di lavoro è `~/cronotermostato`).
- Modi di una fascia: solo `heat`, `cool`, `off`. `off` non ha temperatura. Niente preset, niente `heat_cool`.
- Orari come minuti dalla mezzanotte (0..1440); testo `"HH:MM"`, con `"24:00"` ammesso solo come fine.
- Fasce senza sovrapposizioni, estremi senza minuti di scarto (8:00-12:00 poi 12:00-...). Si salvano solo le fasce dell'utente; le fasce automatiche (`auto=True`, `off`) si calcolano.
- Una stanza ha un solo programma; un programma molte stanze; un'assegnazione si può mettere in pausa.
- Un giorno festivo (nazione e suddivisione scelte) usa sempre la parte festiva, anche di domenica.
- Una fascia continua oltre la mezzanotte: fasce adiacenti identiche (modo, temperatura, `auto`) a cavallo di due giorni formano un solo slot, e non c'è comando a mezzanotte.
- Forzatura: finisce alla fine dello slot in cui nasce, o con `resume_auto`; sopravvive al riavvio.
- Ordine dei comandi: prima `climate.set_hvac_mode`, poi `climate.set_temperature`. Nessuna stanza non assegnata viene mai comandata. Nessun comando periodico.
- Modo non supportato dal termostato: non si comanda, stato `unsupported_mode`.
- Interfaccia in italiano e inglese (`strings.json`, `translations/it.json`, `en.json`); codice e README in inglese.
- Un'unica istanza (`single_config_entry`). Attributi grandi esclusi dal recorder (`_unrecorded_attributes`).

## Review Focus

- Passaggio all'ora legale (2026-03-29) e solare (2026-10-25): gli slot restano contigui e crescenti, senza buchi né doppioni. Test nel Task 4.
- Riavvio di HA con forzatura attiva: la forzatura resta; se la sua fine è già passata, non vale e si applica la fascia corrente. Test nel Task 7.
- Termostato `unavailable` a un cambio di fascia: nessuna eccezione, si applica la fascia del momento quando torna disponibile. Test nel Task 7.
- Programma modificato o cancellato mentre è assegnato: modifica = ricalcolo e nuova pianificazione; cancellazione rifiutata finché ha stanze. Test nei Task 6 e 10.
- Entità `climate` sparita o rinominata in HA: nessuna eccezione, stato `missing`, assegnazione conservata. Test nel Task 7.

---

### Task 1: Struttura del repository e ambiente di test

**Files:**
- Create: `custom_components/cronotermostato/{__init__.py,manifest.json,const.py}`, `hacs.json`, `LICENSE` (MIT, `alexcoscia`), `README.md`, `pyproject.toml`, `requirements_test.txt`, `tests/conftest.py`, `tests/test_smoke.py`, `.github/workflows/ci.yml`
- Modify: `.gitignore` (aggiungere `.venv/`, `__pycache__/`)

**Interfaces:**
- Produces: `const.DOMAIN = "cronotermostato"`; ambiente `.venv` con Python 3.14; comando `uv run pytest`.

- [ ] **Step 1:** La cartella è già `~/cronotermostato` (rinominata prima di iniziare l'esecuzione); verificare con `pwd` e `git log --oneline -1`.
- [ ] **Step 2:** `uv venv --python 3.14 .venv` e installare `pytest-homeassistant-custom-component` nella versione che richiede `homeassistant==2026.10.4`. Se non esiste su PyPI, fermarsi e riferire a Alex quale versione di HA coprono i pacchetti disponibili prima di continuare.
- [ ] **Step 3:** Scrivere il test fallito `tests/test_smoke.py::test_domain` (`assert DOMAIN == "cronotermostato"`); eseguirlo e vedere il fallimento per modulo mancante.
- [ ] **Step 4:** Creare `manifest.json` con `domain`, `name`, `version "0.1.0"`, `codeowners ["@alexcoscia"]`, `config_flow true`, `integration_type "service"`, `iot_class "calculated"`, `single_config_entry true`, `requirements ["holidays==0.106"]`, `documentation` e `issue_tracker` (URL del repository GitHub), e `hacs.json` (`name`, `homeassistant: "2026.10.0"`). Verificare i campi richiesti da hassfest e HACS sulla documentazione attuale, non a memoria.
- [ ] **Step 5:** `ci.yml` con tre job: `hassfest` (azione `home-assistant/actions/hassfest`), `HACS` (azione `hacs/action`, categoria `integration`), `tests` (`uv run pytest`). Lanciare `uv run pytest`: deve passare.
- [ ] **Step 6:** Commit `"Struttura HACS e ambiente di test"`.

### Task 2: Modello dati e validazione

**Files:**
- Create: `custom_components/cronotermostato/engine/__init__.py` (vuoto), `engine/models.py`
- Test: `tests/engine/test_models.py`

**Interfaces:**
- Produces:
  - `Mode = Literal["heat","cool","off"]`
  - `@dataclass(frozen=True) Band(start:int, end:int, mode:Mode, temperature:float|None=None, auto:bool=False)`
  - `@dataclass(frozen=True) Program(id:str, name:str, week:tuple[tuple[Band,...],...], holiday:tuple[Band,...])` (`week` ha 7 giorni, lunedì = 0)
  - `class ProgramError(ValueError)`
  - `minutes_from_text(text:str)->int`, `text_from_minutes(m:int)->str`
  - `validate_bands(bands:Sequence[Band])->None`
  - `program_to_dict(p:Program)->dict`, `program_from_dict(d:Mapping)->Program` (orari come `"HH:MM"`)

- [ ] **Step 1: Test.** `test_text_roundtrip` (`"08:00"`→480, 1440→`"24:00"`, `"24:00"` rifiutato come inizio). `test_validate_rejects`: fine ≤ inizio, `end > 1440`, sovrapposizione (480-720 e 700-800), `heat` senza temperatura, `off` con temperatura, `mode` sconosciuto, temperatura non numerica: ognuno solleva `ProgramError`. `test_adjacent_ok`: 480-720 e 720-900 passa. `test_program_roundtrip`: `program_from_dict(program_to_dict(p)) == p`, e `week` con ≠ 7 giorni solleva.
- [ ] **Step 2:** Eseguire e vedere i fallimenti.
- [ ] **Step 3:** Implementare i nomi sopra in `engine/models.py`; `validate_bands` ordina per inizio e confronta le coppie adiacenti.
- [ ] **Step 4:** Eseguire: passano. Commit `"Modello di fasce e programmi con validazione"`.

### Task 3: Normalizzazione del giorno e fasce automatiche

**Files:**
- Create: `engine/day.py`
- Test: `tests/engine/test_day.py`

**Interfaces:**
- Consumes: `Band`, `validate_bands`.
- Produces: `normalize_day(bands:Sequence[Band])->tuple[Band,...]` — fasce ordinate che coprono 0..1440 senza buchi; i buchi diventano `Band(start,end,"off",None,auto=True)`.

- [ ] **Step 1: Test.** `test_spec_example`: `[Band(480,720,"heat",23), Band(1080,1380,"heat",20)]` → cinque fasce: `0-480 auto`, `480-720`, `720-1080 auto`, `1080-1380`, `1380-1440 auto`, dove le automatiche sono `off`. `test_empty_day`: nessuna fascia → una sola `0-1440 auto off`. `test_full_day`: nessuna fascia automatica. `test_input_unsorted`: ordine d'ingresso indifferente. `test_overlap_raises`.
- [ ] **Step 2-4:** Eseguire (fallisce), implementare, eseguire (passa). Commit `"Normalizzazione del giorno con fasce automatiche"`.

### Task 4: Linea del tempo, festivi e mezzanotte

**Files:**
- Create: `engine/timeline.py`
- Test: `tests/engine/test_timeline.py`

**Interfaces:**
- Consumes: `Program`, `normalize_day`.
- Produces:
  - `@dataclass(frozen=True) Slot(start:datetime, end:datetime, band:Band, holiday:bool)` (datetime con fuso)
  - `class Timeline(program:Program, is_holiday:Callable[[date],bool], tz:tzinfo)` con
    `slot_at(moment:datetime)->Slot` e `slot_after(slot:Slot)->Slot`.

- [ ] **Step 1: Test.** Programma di prova: lunedì-venerdì `[480-720 heat 23, 1080-1380 heat 20]`, sabato `[540-600 heat 21]`, festivi `[0-1440 heat 18]`; fuso `Europe/Rome`.
  - `test_slot_at_inside_band`: lunedì 2026-10-26 09:00 → slot 08:00-12:00, 23°.
  - `test_night_merges_over_midnight`: lunedì 2026-10-26 23:30 → slot `start` 23:00 lun, `end` 08:00 mar, `auto=True`.
  - `test_friday_to_saturday`: venerdì 23:30 → fine = sabato 09:00 (le due `off` automatiche si uniscono; il sabato inizia con una fascia automatica 0:00-9:00).
  - `test_holiday_overrides_sunday`: 2026-11-01 (domenica) con `is_holiday=lambda d: d==date(2026,11,1)` → `holiday=True`, 18°; il 2026-11-02 non lo è.
  - `test_slot_after_chain`: da qualsiasi slot, `slot_after(s).start == s.end`.
  - `test_dst_continuity` (Review Focus): per i tre giorni intorno al 2026-03-29 e al 2026-10-25, la catena di `slot_after` da mezzanotte a mezzanotte è strettamente crescente e contigua (`next.start == prev.end`, `end > start`), senza buchi.
- [ ] **Step 2:** Eseguire e vedere i fallimenti.
- [ ] **Step 3:** Implementare. Orari come ora locale del fuso, non come somma di durate; unire due slot adiacenti solo se hanno uguali `mode`, `temperature` e `auto`.
- [ ] **Step 4:** Eseguire: passano. Commit `"Linea del tempo con festivi, mezzanotte e ora legale"`.

### Task 5: Calendario delle festività

**Files:**
- Create: `engine/calendar.py`
- Test: `tests/engine/test_calendar.py`

**Interfaces:**
- Produces: `class HolidayCalendar(country:str, subdiv:str|None=None)` con `is_holiday(d:date)->bool`; `supported_countries()->dict[str,list[str]]` (paese → suddivisioni).

- [ ] **Step 1: Test.** `IT`: 2026-11-01 e 2026-12-25 sì, 2026-11-02 no. `DE` con `BY`: 2026-01-06 sì; `DE` senza suddivisione: no. Paese sconosciuto solleva `ValueError`. `supported_countries()["IT"]` non vuoto.
- [ ] **Step 2-4:** Fallire, implementare con `holidays.country_holidays(country, subdiv=subdiv)` (con cache per anno), passare. Commit `"Calendario delle festività per nazione"`.

### Task 6: Archivio dei programmi, assegnazioni e forzature

**Files:**
- Create: `custom_components/cronotermostato/store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Consumes: `Program`, `program_to_dict/from_dict`.
- Produces: `@dataclass Assignment(program_id:str, paused:bool=False)`, `@dataclass Override(mode:Mode, temperature:float|None, until:datetime)`;
  `class CronoStore(hass)` con `async_load()`, `programs: dict[str,Program]`, `assignments: dict[str,Assignment]` (chiave = `entity_id` del `climate`), `overrides: dict[str,Override]`,
  `async_create_program(name,week,holiday)->Program`, `async_update_program(id,*,name=None,week=None,holiday=None)->Program`, `async_delete_program(id)` (solleva `ProgramError` se ha stanze), `async_assign(climate_id,program_id)`, `async_unassign(climate_id)`, `async_set_paused(climate_id,paused)`, `async_set_override(climate_id,override)`, `async_clear_override(climate_id)`, `async_add_listener(cb)->Callable[[],None]` (chiamato a ogni modifica).

- [ ] **Step 1: Test** (fixture `hass`). Crea/aggiorna/cancella; `test_delete_assigned_refused`; `test_assign_unknown_program_raises`; `test_unassign_clears_override`; `test_persist_roundtrip` (nuovo `CronoStore` sullo stesso `hass` rilegge programmi, assegnazioni e forzatura); `test_listener_called`.
- [ ] **Step 2-4:** Fallire, implementare con `homeassistant.helpers.storage.Store` (versione 1, chiave `cronotermostato`), passare. Commit `"Archivio di programmi, assegnazioni e forzature"`.

### Task 7: Controllore di stanza

**Files:**
- Create: `custom_components/cronotermostato/controller.py`, `manager.py`
- Test: `tests/test_controller.py`

**Interfaces:**
- Consumes: `CronoStore`, `Timeline`, `HolidayCalendar`.
- Produces:
  - `RoomStatus = Literal["ok","paused","unassigned","unavailable","unsupported_mode","missing","error"]`
  - `@dataclass RoomState(program:Program|None, slot:Slot|None, next_slot:Slot|None, manual:bool, override_until:datetime|None, status:RoomStatus, holiday:bool)`
  - `class RoomController(hass, store, calendar, climate_id)` con `state: RoomState`, `async_start()`, `async_stop()`, `async_refresh()`, `async_set_manual(mode, temperature)`, `async_resume_auto()`
  - `class Manager(hass, store, calendar)` con `controllers: dict[str,RoomController]`, `async_start()`, `async_refresh_all()`, `async_sync()` (crea/ferma i controllori in base alle assegnazioni)
  - `SIGNAL_ROOM_UPDATED = "cronotermostato_room_updated_{}"` (formato con `climate_id`).

- [ ] **Step 1: Test** (un `climate` finto con `hvac_modes ["heat","off"]`, servizi `climate.set_hvac_mode`/`set_temperature` registrati e registrati i richiami; tempo con `freezer` e `async_fire_time_changed`).
  - `test_applies_at_start`: all'avvio alle 09:00 lun chiama `set_hvac_mode(heat)` poi `set_temperature(23)`, in questo ordine.
  - `test_applies_at_boundary`: a 12:00 passa alla fascia automatica: un solo `set_hvac_mode(off)`, nessuna `set_temperature`.
  - `test_no_command_at_midnight`: a cavallo di una fascia notturna unita non parte nessun comando.
  - `test_unassigned_never_commanded`, `test_paused_not_commanded`.
  - `test_assign_and_resume_apply_now`: assegnare una stanza, o riprenderla dalla pausa, applica subito la fascia corrente (modo poi temperatura).
  - `test_manual_until_end_of_slot`: `async_set_manual("heat", 24)` alle 09:00 → `manual=True`, `override_until` 12:00; a 12:00 la forzatura sparisce e si applica la fascia corrente.
  - `test_resume_auto`: riapplica la fascia corrente subito.
  - `test_override_survives_restart` (Review Focus): nuovo `Manager` sullo stesso `store` rilegge la forzatura e non comanda; con `until` già passata applica la fascia corrente.
  - `test_unavailable_then_available` (Review Focus): al cambio fascia con termostato `unavailable` nessuna eccezione, stato `unavailable`; al ritorno disponibile applica la fascia del momento.
  - `test_unsupported_mode`: fascia `cool` su termostato `["heat","off"]` → nessun comando, stato `unsupported_mode`.
  - `test_missing_climate` (Review Focus): `entity_id` assente da HA → stato `missing`, nessuna eccezione, assegnazione intatta.
  - `test_service_error_sets_error`: se `set_temperature` solleva `ServiceValidationError`, stato `error`, nessuna eccezione verso l'alto.
  - `test_program_edit_reschedules`: `async_update_program` cambia la fascia corrente → il controllore la applica alla prima `async_refresh`.
- [ ] **Step 2:** Eseguire e vedere i fallimenti.
- [ ] **Step 3:** Implementare. Pianificare il prossimo cambio con `async_track_point_in_time` sulla fine dello slot corrente; ascoltare `async_track_state_change_event` del `climate` solo per il passaggio da `unavailable` a disponibile; i comandi con `blocking=True`.
- [ ] **Step 4:** Eseguire: passano. Commit `"Controllore di stanza e gestore"`.

### Task 8: Configurazione, avvio e scaricamento

**Files:**
- Create: `config_flow.py`
- Modify: `__init__.py`, `const.py`, `strings.json`, `translations/{it,en}.json`
- Test: `tests/test_config_flow.py`, `tests/test_init.py`

**Interfaces:**
- Consumes: `supported_countries`, `Manager`, `CronoStore`.
- Produces: voce di configurazione con `data = {"country": str, "subdiv": str|None}`; `async_setup_entry` crea `CronoStore`, `HolidayCalendar`, `Manager` in `hass.data[DOMAIN]`; `async_unload_entry` li ferma. Opzioni per cambiare nazione e suddivisione (ricalcola con `manager.async_refresh_all()`).

- [ ] **Step 1: Test.** Flusso: passo 1 sceglie il paese; se ha suddivisioni, passo 2 le propone (facoltativo); creazione voce. Seconda istanza rifiutata (`single_instance_allowed`). Opzioni cambiano nazione e provocano un ricalcolo. `test_setup_unload` senza residui (timer annullati).
- [ ] **Step 2-4:** Fallire, implementare, passare. Commit `"Configurazione per nazione e ciclo di vita"`.

### Task 9: Entità

**Files:**
- Create: `sensor.py`, `switch.py`
- Modify: `__init__.py` (piattaforme), `strings.json`, `translations/*.json`
- Test: `tests/test_entities.py`

**Interfaces:**
- Consumes: `RoomState`, `SIGNAL_ROOM_UPDATED`, `Manager`.
- Produces: per stanza `sensor.<stanza>_programma` (stato = nome del programma; attributi `slot`, `next_slot`, `slot_end`, `manual`, `override_until`, `auto_slot`, `holiday`, `status`) e `switch.<stanza>_automatico` (acceso = automatico; spegnerlo = `async_set_manual` con la fascia corrente, riaccenderlo = `async_resume_auto`); per programma `sensor.programma_<nome>` con attributi `week`, `holiday` (fasce dell'utente), `week_full`, `holiday_full` (normalizzate, con `auto`), `rooms`. Tutti con `unique_id` stabile e `_unrecorded_attributes` per le definizioni.

- [ ] **Step 1: Test.** Assegnando una stanza compaiono sensor e switch (aggiunta dinamica); togliendola scompaiono. `test_attributes_after_boundary`. `test_switch_off_sets_manual`, `test_switch_on_resumes`. `test_program_sensor_has_auto_bands`: `week_full` contiene le fasce `auto` dell'esempio del Task 3. `test_unrecorded`: gli attributi delle definizioni sono in `_unrecorded_attributes`.
- [ ] **Step 2-4:** Fallire, implementare (aggiunta/rimozione tramite il listener dello `store` e `Manager.async_sync`), passare. Commit `"Entità di stanza e di programma"`.

### Task 10: Servizi

**Files:**
- Create: `services.yaml`
- Modify: `__init__.py`, `strings.json`, `translations/*.json`
- Test: `tests/test_services.py`

**Interfaces:**
- Consumes: `CronoStore`, `Manager`, `program_from_dict`.
- Produces servizi sul dominio `cronotermostato`: `create_program(name, week, holiday)` (risposta `{"program_id": str}`), `update_program(program_id, name?, week?, holiday?)`, `delete_program(program_id)`, `assign(program_id, climate_entity_id)`, `unassign(climate_entity_id)`, `pause(climate_entity_id)`, `resume(climate_entity_id)`, `set_manual(climate_entity_id, mode, temperature?)`, `resume_auto(climate_entity_id)`. `week` = lista di 7 liste di `{start, end, mode, temperature?}` con orari `"HH:MM"`; `holiday` = una lista di fasce.

- [ ] **Step 1: Test.** Creazione con risposta; fasce sovrapposte → `ServiceValidationError`; `delete_program` di un programma assegnato → errore, e dopo `unassign` riesce (Review Focus); `assign` con `climate_entity_id` non esistente → errore; `set_manual` con `mode "cool"` senza temperatura → errore; `update_program` della fascia corrente di una stanza assegnata → la stanza applica la nuova fascia; `resume_auto` ripristina.
- [ ] **Step 2-4:** Fallire, implementare (tutti gli errori come `ServiceValidationError` con testo tradotto), passare. Commit `"Servizi dell'integrazione"`.

### Task 11: API WebSocket per l'editor

**Files:**
- Create: `websocket_api.py`
- Modify: `__init__.py` (registrazione)
- Test: `tests/test_websocket.py`

**Interfaces:**
- Produces: comando `cronotermostato/state` → `{"programs": [...], "rooms": [...], "country": str, "subdiv": str|None}` (programmi con fasce utente e normalizzate; stanze con programma, stato e fascia corrente); `cronotermostato/preview_day` con `{"bands": [...]}` → `{"bands": [...normalizzate con auto...]}` o errore di validazione; `cronotermostato/countries` → `supported_countries()`.

- [ ] **Step 1: Test.** Ciascun comando con un client WebSocket di test; `preview_day` restituisce le cinque fasce del Task 3 per l'esempio; sovrapposizione → errore `invalid_format`.
- [ ] **Step 2-4:** Fallire, implementare, passare. Commit `"API WebSocket per l'editor"`.

### Task 12: Documentazione, CI e prova su Home Assistant

**Files:**
- Modify: `README.md` (inglese: installazione HACS, configurazione, servizi con esempi, convivenza con lo Scheduler)
- Create: `docs/PROVA_SU_HA.md` (elenco di verifiche manuali)

- [ ] **Step 1:** Scrivere il README e `docs/PROVA_SU_HA.md` (assegnare un programma a una sola stanza di prova, forzare, rimettere in automatico, riavviare HA durante una forzatura).
- [ ] **Step 2:** Eseguire in locale `uv run pytest` (tutto verde) e controllare che il workflow `ci.yml` passi su GitHub (hassfest, HACS, test).
- [ ] **Step 3:** **Chiedere ad Alex** prima di qualsiasi comando ai termostati reali: la prova su HA assegna un programma a una stanza che lui indica. Poi copiare `custom_components/cronotermostato` in `/config/custom_components/` (Samba o File editor), riavviare HA e seguire `docs/PROVA_SU_HA.md`.
- [ ] **Step 4:** **Chiedere ad Alex** prima di creare il repository su GitHub, di fare il push e di pubblicare la release `v0.1.0` (la release è ciò che HACS legge).
- [ ] **Step 5:** Commit `"Documentazione e prova su Home Assistant"`.
