# Cronotermostato: editor dell'integrazione, piano 2 di 3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un editor dei programmi, fornito dall'integrazione `cronotermostato` stessa (nessun secondo repository, nessuna risorsa da aggiungere a mano), usabile come **scheda Lovelace** e/o come **voce nella barra laterale** a scelta dell'utente: elenco programmi, settimana con fasce, parte festiva, fasce automatiche con segno, assegnazione a più stanze, pausa/ripresa, forzatura, stato delle stanze. Italiano e inglese, tema chiaro/scuro di HA, utilizzabile da telefono.

**Architecture:** Un solo componente web (custom element) che HA usa in due modi: come pannello (`hass`, `narrow`, `route`, `panel` impostati da HA) e come scheda Lovelace (`setConfig`, `hass`). Parla solo con HA: i comandi WebSocket di `cronotermostato/*` e i servizi già esistenti, più pochi comandi WebSocket nuovi (Task 4). L'interfaccia è scritta in JavaScript ES module con **Lit** copiato nel repository (file unico `lit-core.min.js`, import relativo): **nessun passo di build**, quello che sta in git è quello che HACS distribuisce. Un modulo di logica pura (orari, validazione, serializzazione) senza DOM, provato con `node --test`.

**Tech Stack:** Python 3.14 / HA 2026.10.4 per la parte server (`frontend`, `http`, `panel_custom`); JavaScript ES2022 + Lit 3 (vendored); `node --test` (Node già presente in locale) per la logica; `pytest-homeassistant-custom-component` per la parte server.

**Spec:** `docs/superpowers/specs/2026-11-01-cronotermostato-design.md` (sezioni 7 e 8, "deciso da Alex"). Piano 1: `docs/superpowers/plans/2026-11-01-cronotermostato-integrazione.md` (compresa l'aggiunta sui preset). Il tile Tessera (piano 3) ha il suo piano.

## API di Home Assistant verificate (2026.10.4)

Verificate sul sorgente installato in `.venv/lib/python3.14/site-packages/homeassistant/` (che è la versione di HA in uso) e, per il lato frontend, sulla documentazione attuale `contributors.home-assistant.io` (il vecchio dominio `developers.home-assistant.io` ora reindirizza lì). Controllato il 2026-11-01. Dove la documentazione non copre un punto è scritto.

| Cosa | Nome esatto | Fonte |
|---|---|---|
| Registrare un pannello personalizzato | `await homeassistant.components.panel_custom.async_register_panel(hass, frontend_url_path, webcomponent_name, sidebar_title=None, sidebar_icon=None, js_url=None, module_url=None, embed_iframe=False, trust_external=False, config=None, require_admin=False, config_panel_domain=None, handle_safe_area=False)`. Serve `module_url` o `js_url`, altrimenti `ValueError`. Senza `sidebar_title` il pannello non compare nella barra laterale. Internamente chiama `frontend.async_register_built_in_panel(hass, component_name="custom", ...)`. | `components/panel_custom/__init__.py` (sorgente); pagina "Custom panels" di contributors.home-assistant.io (tabella nomi YAML -> Python: `name`->`webcomponent_name`, `url_path`->`frontend_url_path`, `trust_external_script`->`trust_external`) |
| Proprietà impostate da HA sul pannello | `hass`, `narrow`, `route` (`prefix`, `path`), `panel` (`panel.config` = il nostro `config`, più `_panel_custom`). Il pannello deve disegnare da sé intestazione e tasto per aprire la barra laterale su schermi stretti. | pagina "Custom panels" (documentazione) |
| Rimuovere un pannello | `homeassistant.components.frontend.async_remove_panel(hass, frontend_url_path, *, warn_if_unknown=True)`. Registrare due volte lo stesso `frontend_url_path` senza `update=True` solleva `ValueError("Overwriting panel ...")`. | `components/frontend/__init__.py` righe 366-420 |
| Esistenza del pannello (per i test) | `frontend.async_panel_exists(hass, frontend_url_path)`; i pannelli stanno in `hass.data[frontend.DATA_PANELS]` come oggetti `Panel` con `.require_admin`, `.sidebar_title`, `.config`. | stesso file, righe 305-350 e 422 |
| `require_admin` | Il comando WebSocket `get_panels` **omette** i pannelli `require_admin` agli utenti non admin. Un admin può cambiare titolo, icona, visibilità e `require_admin` dall'interfaccia (`frontend/update_panel`, solo admin): vale l'override dell'utente. È quindi **solo visibilità nell'interfaccia, non un controllo di accesso**. Non verificato dal sorgente cosa succede aprendo a mano l'URL del pannello come non admin: da provare nel Task 14. | `components/frontend/__init__.py` righe 970-990 e 1087-1125 |
| File statici dalla cartella dell'integrazione | `await hass.http.async_register_static_paths([StaticPathConfig(url_path, path, cache_headers=True)])`, con `from homeassistant.components.http import StaticPathConfig`. `url_path` è un prefisso: se `path` è una cartella serve tutto il suo contenuto; se è un file, solo quello. Con `cache_headers=True` usa `CachingStaticResource` (cache lunga): per questo l'URL porta la versione. Lo stesso path **non si può deregistrare** né registrare due volte: va fatto una volta sola (in `async_setup`), non a ogni ricarico della voce. Le rotte statiche non richiedono autenticazione: nei file non ci possono essere dati personali. | `components/http/server.py` righe 76-83 e 354-395 |
| Registrare il JS per le schede Lovelace senza passi manuali | `homeassistant.components.frontend.add_extra_js_url(hass, url, es5=False)` (modulo ES) e `remove_extra_js_url(hass, url, es5=False)`. Il frontend aggiunge l'URL a ogni caricamento della pagina (`extra_modules`) e avvisa i client già aperti (`frontend/subscribe_extra_js`). Non viene caricato in modalità sicura. `remove_extra_js_url` non solleva se manca. La documentazione di contributors.home-assistant.io **non cita** `add_extra_js_url` (descrive solo le risorse manuali dei dashboard in Impostazioni -> Dashboard -> Risorse, tipo "modulo JavaScript"): l'API è verificata solo sul sorgente, ed è quella usata da altre integrazioni con carte incluse. | `components/frontend/__init__.py` righe 256-280, 427-443, 885-905; pagina "Dashboard resources" (documentazione) |
| Annunciare la scheda nel selettore | `window.customCards = window.customCards || []; window.customCards.push({type, name, description, preview, documentationURL})`: `type` è obbligatorio ed è il nome del tag **senza** `custom:`. Altri campi del push: dalla memoria, da verificare in prova. `static getStubConfig(hass, entities, entitiesFallback)` restituisce la configurazione iniziale (senza `type`); `static getConfigElement()` restituisce l'editor visuale (se ci sono entrambi vale `getConfigElement`). Metodi della scheda: `setConfig(config)` (obbligatorio, può sollevare un errore), `set hass(hass)`, `getCardSize()`, `getGridOptions()` (griglia a 12 colonne), `preview` impostato a `true` nell'editor. | pagine "Custom cards" e "Card editor and picker" di contributors.home-assistant.io/frontend/custom-ui/ |
| Dipendenze del manifest | `dependencies` deve contenere ogni integrazione da cui si importa (hassfest); le piattaforme di entità e alcune interne sono esentate; `homeassistant` e `persistent_notification` non vanno mai elencate. `panel_custom` dipende da `frontend`; `frontend` da `http`, `websocket_api` e altre. Per questo repository: aggiungere `frontend`, `http`, `panel_custom` a `["websocket_api"]` (si importano `frontend`, `http.StaticPathConfig`, `panel_custom`). `version` è obbligatoria per le integrazioni custom (già `0.1.0`). | `components/*/manifest.json` (sorgente); pagina "Integration manifest" (documentazione) |
| Cache busting | Il frontend non tocca gli URL: ci pensiamo noi con `?v=<versione del manifest>` (`(await async_get_integration(hass, DOMAIN)).version`, `loader.py` riga 1382). HACS aggiorna i file e HA va riavviato per il Python, quindi la versione cambia sempre insieme ai file. Anche la documentazione suggerisce `?v=2` per forzare il ricaricamento. Gli `import` relativi non ereditano la query del modulo: perciò la versione sta nel **percorso** (`/cronotermostato_static/<versione>/...`, Task 1) e cambia l'URL di ogni file, sotto-moduli compresi. | ragionamento sul sorgente; da provare nel Task 14 |
| Servizi: nessun controllo admin | `services.py` usa `hass.services.async_register` (non `async_register_admin_service`): **qualsiasi utente autenticato** può chiamare `create_program`, `update_program`, `delete_program`, `assign`, ... Perciò "solo amministratori" non si può ottenere con la sola opzione del pannello (vedi Task 4 e decisioni aperte). | `custom_components/cronotermostato/services.py` riga 213 |
| Test | `homeassistant.components.frontend` è importabile nella `.venv` (`home-assistant-frontend==20260930.5`), quindi i test possono caricarlo davvero. Le fixture `hass_client`, `hass_ws_client(hass, access_token)`, `hass_admin_user`, `hass_read_only_user`, `hass_access_token` vengono da `pytest-homeassistant-custom-component`. | manifest di `frontend`; pacchetto di test già installato |

## Scelta architetturale: build step sì o no

| Opzione | Pro | Contro |
|---|---|---|
| A. Nessun build: ES module a mano + Lit copiato in repo (`lit-core.min.js`, ~15 KB) | Quello che è in git è quello che HACS distribuisce; HACS non esegue build per le integrazioni (scarica i file della cartella `custom_components/cronotermostato`). Nessun `node_modules`, nessuna CI di compilazione, diff leggibili, debug nel browser sui sorgenti veri. Node serve solo per i test. | Niente TypeScript né decoratori (si usa `static properties`); più file = più richieste (poche, in locale). Le pagine dell'editor vanno scritte con template `html\`...\``. |
| B. TypeScript/Lit + esbuild, bundle committato in `frontend/` | Tipi, un solo file, minificato. | Passo di build da ricordare: bundle e sorgente possono divergere, serve una CI che ricompili e confronti, `node_modules` di sviluppo, aggiornamenti di dipendenze npm. Più complicato da far fare a un agente passo per passo senza sviluppare "rumore" nei diff. |
| C. Vanilla web components (nessuna libreria) | Nessuna dipendenza. | Più codice per il rendering reattivo e il diff del DOM; più bug nei form con molti campi. |

**Scelta proposta: A.** Il guadagno di B (tipi, bundle unico) non paga la complessità per un editor di dimensioni modeste; se tra due piani il codice cresce, passare a B è meccanico (stessi sorgenti ES). La libreria resta una decisione aperta per Alex (vedi in fondo).

Struttura prevista (sotto `custom_components/cronotermostato/frontend/`):

- `cronotermostato.js`: punto d'ingresso unico; registra `cronotermostato-editor` (pannello e scheda), `cronotermostato-card` e `window.customCards`.
- `lit.js` (Lit copiato, con licenza BSD-3 in `LICENSE-lit.txt`), `lib/time.js`, `lib/validate.js`, `lib/model.js` (logica pura, senza DOM), `lib/api.js` (WebSocket e servizi), `lib/i18n.js` + `i18n/it.json` ed `en.json` (importati con `fetch` relativo o come moduli JS `it.js`/`en.js`), `components/*.js`.
- Il modulo di ingresso è servito come `/cronotermostato_static/<versione>/cronotermostato.js`; la versione nel percorso (Task 1) fa cambiare l'URL di tutti i file a ogni versione. Prima di una prova su HA con codice cambiato, alzare la versione del manifest (Task 14 lo verifica).

## Nuovi comandi WebSocket e servizi (riassunto)

Esistenti (piano 1), usati così come sono: `cronotermostato/state`, `cronotermostato/preview_day`, `cronotermostato/countries`, servizi `pause`, `resume`, `set_manual`, `resume_auto` (usati dall'editor e dal tile; aperti a tutti gli utenti).

Nuovi (Task 4):

- `cronotermostato/state` guadagna per ogni programma un campo `revision` (stringa) e in cima `options: {"admin_only": bool}`; `rooms` guadagna `climate_available: bool`. Nessun campo esistente cambia.
- `cronotermostato/save_program` `{program_id?: str, name, week, holiday, expected_revision?: str}` -> `{program_id, revision}`: crea (senza `program_id`) o aggiorna con controllo di concorrenza; errore `conflict` se `expected_revision` non coincide, `invalid_format` se il programma non è valido, `unauthorized` se l'opzione "solo amministratori" è attiva e l'utente non è admin.
- `cronotermostato/delete_program` `{program_id, expected_revision?}`, `cronotermostato/assign` `{program_id, climate_entity_id}`, `cronotermostato/unassign` `{climate_entity_id}`: stessi controlli di permesso. Sono sottili involucri sulle stesse funzioni di `CronoStore`/`Manager` usate dai servizi (nessuna logica doppia).
- `cronotermostato/subscribe` -> sottoscrizione che invia `{"type": "changed"}` a ogni modifica dello `store` (listener `async_add_listener`) e a ogni `SIGNAL_ROOM_UPDATED`/`SIGNAL_ROOMS_CHANGED`; il client risponde rileggendo `state` (con anti-rimbalzo di 250 ms). Evita il polling e tiene allineati due editor aperti.
- Le **stanze `climate` disponibili** per l'assegnazione NON richiedono un comando nuovo: il frontend le legge da `hass.states` (dominio `climate`, con `friendly_name`, `hvac_modes`, `preset_modes`, `min_temp`, `max_temp`, `target_temp_step`) e dall'`entity_registry` per l'area (`hass.entities`, `hass.areas`, già in `hass`).

## Global Constraints

Ereditati dal piano 1 e validi anche qui:

- Dominio `cronotermostato`; repository HACS `cronotermostato`, cartella di lavoro `~/cronotermostato`.
- **Non fare push, non creare il repository su GitHub, non pubblicare release e non comandare termostati reali senza chiedere ad Alex.** Le prove su HA reale si fanno con una sola stanza indicata da Alex (come `docs/PROVA_SU_HA.md`). I test automatici usano climate finti.
- Convivere con lo Scheduler (HACS): non toccarlo, non leggerlo, non scrivere nulla fuori dall'integrazione. Un'assegnazione dall'editor non deve poter comandare stanze non assegnate.
- Modi di una fascia: solo `heat`, `cool`, `off`. `off` senza temperatura né preset. `heat`/`cool`: almeno uno fra preset e temperatura. Preset facoltativo, scelto fra i `preset_modes` del climate; un preset non elencato dal climate della stanza è segnalato nell'editor (stato `unsupported_preset`) ma non impedisce il salvataggio (un programma è riusabile da più stanze con preset diversi).
- Orari come testo `"HH:MM"`; `"24:00"` ammesso solo come fine; fasce senza sovrapposizioni; estremi adiacenti senza minuti di scarto (8:00-12:00 poi 12:00-...). Si salvano solo le fasce dell'utente: le fasce `auto` si calcolano (`preview_day`) e non si rimandano al salvataggio.
- Un giorno festivo usa sempre la parte festiva. Una stanza ha un solo programma; un programma molte stanze; un programma assegnato non si cancella (prima si toglie dalle stanze).
- Interfaccia in italiano e inglese (lingua di `hass.locale.language` / `hass.language`, ripiego inglese); codice e README in inglese; testi dell'integrazione in `strings.json`, `translations/it.json`, `translations/en.json`.
- Un'unica istanza (`single_config_entry`).

Specifici di questo piano:

- **La grafica è vincolata all'approvazione di Alex delle bozze (Task 0).** Nessun Task dal 7 al 13 si inizia senza un'indicazione scritta di quale bozza è approvata; fino ad allora si possono fare solo i Task 1-6 (server, logica, scheletro senza stile definitivo).
- L'editor parla solo con i comandi WebSocket e i servizi dell'integrazione; non legge né scrive `.storage`, non comanda `climate` direttamente (nemmeno per l'anteprima).
- Tutto il testo che viene dai dati (nomi di programmi, nomi di stanze, preset) entra nel DOM solo come testo (template Lit con binding normali), mai come HTML: vietati `unsafeHTML`, `innerHTML` e simili (controllo in CI, Task 14).
- Nessuna dipendenza da CDN: tutto il codice dell'editor è nella cartella dell'integrazione (HA può funzionare senza Internet).
- Nessun file generato commitato: nessun bundle, nessuna minificazione propria (solo `lit-core.min.js` di terzi, con la sua licenza).
- Sul telefono: nessuna funzione solo-mouse (trascinamento obbligatorio); tutto raggiungibile con il tocco; bersagli di almeno 44 px.

## Review Focus

- **Modifica di un programma assegnato dall'editor**: salvare ricalcola e ripianifica le stanze come fa il servizio `update_program`; non devono partire comandi inattesi (nessun comando se la fascia corrente non cambia; un solo comando ordinato modo, preset, temperatura se cambia). Test nel Task 4 (WS) con climate finti e registro delle chiamate.
- **Due editor aperti contemporaneamente**: il secondo salvataggio su una base vecchia riceve `conflict` e l'editor mostra "il programma è stato modificato altrove" con scelta ricarica/sovrascrivi; mai sovrascritto in silenzio. Test nel Task 4 e nel Task 8.
- **Programma cancellato mentre è aperto**: l'editor lo vede sparire dal `state` (sottoscrizione), mostra un avviso, non lo ricrea da sé; il salvataggio di un programma inesistente dà errore chiaro, non ne crea uno nuovo. Test nei Task 4 e 7.
- **Cache JS dopo un aggiornamento HACS**: l'URL del modulo contiene la versione; dopo l'aggiornamento e il riavvio il browser (e l'app companion) carica il codice nuovo. Verifica nel Task 3 (test sull'URL) e nel Task 14 (prova su browser con cache vecchia).
- **Sicurezza, "solo amministratori"**: un utente non admin non deve poter modificare programmi o assegnazioni dall'editor quando l'opzione è attiva (comandi WS `save_program`, `delete_program`, `assign`, `unassign` controllano `connection.user.is_admin`; test con utente non admin nel Task 4). Resta il fatto verificato che i servizi `create_program`... sono aperti a tutti gli utenti: è una decisione aperta per Alex se limitarli (vedi in fondo); il piano non la prende da solo. Il pannello `require_admin` nasconde solo la voce.
- **XSS nei nomi dei programmi**: un nome come `<img src=x onerror=alert(1)>` o `"><script>` deve apparire come testo ovunque (elenco, intestazioni, etichette `aria`, `title`, messaggi di conferma). Test node sul rendering (Task 13) e controllo statico in CI.
- **Nome programma/stanza molto lungo o con emoji**: nessuna rottura del layout; troncamento con `title`.
- **Orari al limite**: "24:00" solo come fine; una fascia 00:00-24:00; fasce adiacenti; sovrapposizione di un minuto; fascia che finisce a mezzanotte e giorno dopo che inizia a mezzanotte (nessun errore: sono giorni diversi).
- **Il client e il motore concordano**: la validazione JS non deve accettare ciò che il server rifiuta né il contrario. Test di parità con casi comuni (Task 5); il server resta l'autorità (`preview_day` e `save_program` rivalidano).
- **Preset e limiti del climate**: temperatura fuori da `min_temp`/`max_temp` della stanza assegnata mostrata come avviso (stato `out_of_range` della stanza), mai come blocco del salvataggio.
- **Pannello/scheda in HA con utente senza il programma caricato** (`not_loaded`): l'editor mostra "integrazione non caricata", non una pagina bianca.

---

### Task 0: Bozze dell'editor (da far approvare ad Alex prima di costruire)

**Files:**
- Create (fuori dal repository): 2-3 artifact HTML statici di bozza nella cartella di lavoro temporanea; nessun file in `custom_components/`.
- Create: `docs/superpowers/specs/2026-11-01-cronotermostato-editor-bozze.md` con link alle bozze, la scelta di Alex e le sue osservazioni (solo dopo l'approvazione).

**Interfaces:**
- Produces: un'indicazione scritta di Alex ("bozza X approvata, con queste modifiche") che sblocca i Task 7-13.

- [ ] **Step 1:** Preparare 2-3 schizzi HTML pubblicabili come artifact, con dati finti (nessun contatto con HA), in tema chiaro e scuro e a larghezza telefono (360 px) e desktop (1100 px). Varianti da confrontare:
  - **A, tabella per giorno:** elenco programmi a sinistra (a tendina su telefono); giorno selezionato in alto (L M M G V S D + Festivi); sotto, la tabella "Fascia 1 08:00-12:00 | modo | temperatura | preset" con righe per le fasce automatiche segnate da un'icona e un fondo tratteggiato. Vicina all'idea della tabella già decisa per il pannello Tessera.
  - **B, griglia settimanale visuale:** sette colonne (giorni) per 24 righe, fasce come blocchi colorati (ambra riscaldamento, blu raffrescamento, grigio spento, tratteggiato per le automatiche); un tocco apre il pannello di modifica della fascia. Su telefono si mostra un giorno alla volta.
  - **C, ibrido:** barra del giorno (striscia orizzontale 0-24 con le fasce) sopra la tabella del giorno; la settimana in forma di sette strisce impilate.
  Ogni bozza deve mostrare: elenco programmi, un programma con fasce, una fascia automatica con il segno, la parte festiva, la finestra di assegnazione alle stanze (con stato: `ok`, `paused`, `out_of_range`, `unsupported_preset`, `unsupported_mode`, `unavailable`, `missing`), la forzatura con "Torna in automatico", un errore di validazione (sovrapposizione), e la scheda Lovelace compatta (elenco stanze con programma attuale, fino a, tasto Auto).
- [ ] **Step 2:** Pubblicare gli schizzi come artifact privati e dare ad Alex i link; chiedere: quale bozza (o quali parti di quali), se la griglia visuale serve fin dalla prima versione o dopo la tabella, e le preferenze su colori e densità.
- [ ] **Step 3:** **Fermarsi e aspettare l'approvazione di Alex.** Registrare la scelta in `docs/superpowers/specs/2026-11-01-cronotermostato-editor-bozze.md`. Commit `"Bozze dell'editor approvate"`. Senza approvazione non si procede oltre il Task 6.

### Task 1: Dipendenze, costanti e file statici

**Files:**
- Modify: `custom_components/cronotermostato/manifest.json`, `const.py`, `__init__.py`
- Create: `custom_components/cronotermostato/frontend/cronotermostato.js` (segnaposto: un `console.info` e `customElements.define` vuoto), `custom_components/cronotermostato/frontend.py` (registrazione)
- Test: `tests/test_frontend.py`

**Interfaces:**
- Produces: `const.STATIC_URL_BASE = "/cronotermostato_static"`, `const.PANEL_URL_PATH = "cronotermostato"`, `const.PANEL_ELEMENT = "cronotermostato-panel"`, `const.CARD_ELEMENT = "cronotermostato-card"`; manifest con `"dependencies": ["frontend", "http", "panel_custom", "websocket_api"]`; `frontend.py`: `async_register_static(hass)` (una sola volta, in `async_setup`), `async def async_module_url(hass) -> str` (`/cronotermostato_static/<versione>/cronotermostato.js`).

- [ ] **Step 1: Test fallente.** `test_static_file_served`: con `async_setup_component(hass, "cronotermostato", {})` e un `hass_client`, `GET /cronotermostato_static/<versione>/cronotermostato.js` risponde 200 con tipo JavaScript; `GET` di un file inesistente 404; **path traversal**: `GET /cronotermostato_static/../manifest.json` e `%2e%2e/` non escono dalla cartella (404/403). `test_module_url_has_version`: l'URL contiene la versione letta da `async_get_integration`.
- [ ] **Step 2:** Eseguire e vedere i fallimenti.
- [ ] **Step 3:** Aggiornare le `dependencies` del manifest (vedi tabella API; controllare con `hassfest` in locale o in CI, e con `uv run pytest`). Registrare il percorso statico con `StaticPathConfig(f"{STATIC_URL_BASE}/{version}", <cartella frontend>, cache_headers=True)` dentro `async_setup` (il percorso statico non si può rimuovere né ripetere: guardia con `hass.data.setdefault(...)`). Usare il percorso con la versione nel nome così anche i sotto-moduli cambiano URL a ogni versione (risolve il problema degli import relativi senza query).
- [ ] **Step 4:** Eseguire: passano. Commit `"Editor: dipendenze e file statici"`.

### Task 2: Opzioni "barra laterale" e "solo amministratori"

**Files:**
- Modify: `config_flow.py`, `const.py`, `__init__.py` (funzione `entry_editor_options`), `strings.json`, `translations/it.json`, `translations/en.json`
- Test: `tests/test_config_flow.py`

**Interfaces:**
- Produces: `CONF_SHOW_SIDEBAR = "show_sidebar"` (default `True`), `CONF_ADMIN_ONLY = "admin_only"` (default `True`); `entry_editor_options(entry) -> tuple[bool, bool]`; `OptionsFlowWithReload` con passo iniziale a **menu** (`location`, `editor`): `location` = i passi di nazione/suddivisione già esistenti, `editor` = un passo con due caselle.
- Regola: ogni salvataggio **unisce** le opzioni esistenti (`{**entry.options, ...}`): oggi `_async_save` sostituisce tutto con `{country, subdiv}` e cancellerebbe le nuove chiavi (e viceversa). Le voci create prima di questa versione, senza le chiavi, usano i default.
- Default (scelta mia, da confermare da Alex): **voce laterale sì** e **solo amministratori sì**. Motivo: senza un editor raggiungibile l'integrazione richiede servizi a mano; la voce laterale è la via più scopribile, e lo "solo amministratori" parte dal caso più sicuro (le modifiche toccano il riscaldamento). Chi non la vuole la spegne; la scheda Lovelace è comunque sempre disponibile.

- [ ] **Step 1: Test fallenti.** Il menu offre `location` ed `editor`; il passo `editor` salva le due chiavi e ricarica la voce (`OptionsFlowWithReload`: verificare `async_reload` chiamato una volta); salvare la nazione dopo aver cambiato l'editor non perde `show_sidebar`/`admin_only`; salvare l'editor non perde `country`/`subdiv`; voce vecchia senza le chiavi -> `entry_editor_options` restituisce `(True, True)`; `entry_location` invariato.
- [ ] **Step 2:** Eseguire e vedere i fallimenti.
- [ ] **Step 3:** Implementare (`async_show_menu(step_id="init", menu_options=["location","editor"])`; rinominare i passi esistenti mantenendo `subdiv`); `strings.json`, `it.json`, `en.json` con `menu_options`, titoli, descrizioni e `data_description`, senza testi duplicati. In `description` dire chiaramente: "Solo amministratori: nasconde la voce ai non amministratori; per limitare anche le modifiche vedi la documentazione".
- [ ] **Step 4:** Eseguire: passano; `hassfest` locale se disponibile. Commit `"Opzioni dell'editor: barra laterale e solo amministratori"`.

### Task 3: Registrazione e rimozione del pannello e della risorsa Lovelace

**Files:**
- Modify: `custom_components/cronotermostato/frontend.py`, `__init__.py`
- Test: `tests/test_frontend.py`

**Interfaces:**
- Consumes: `entry_editor_options`, `async_module_url`.
- Produces: `async_register_editor(hass, entry)` e `async_unregister_editor(hass)`; in `async_setup_entry`, **dopo** il successo del manager e delle piattaforme (stesso `try` che ferma il manager in caso di errore): `add_extra_js_url(hass, module_url)` sempre; `panel_custom.async_register_panel(hass, frontend_url_path=PANEL_URL_PATH, webcomponent_name=PANEL_ELEMENT, sidebar_title="Cronotermostato", sidebar_icon="mdi:calendar-clock", module_url=module_url, require_admin=admin_only, config={...})` solo se `show_sidebar`. `async_unload_entry` chiama `async_unregister_editor` (rimuove pannello con `async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)` e `remove_extra_js_url`).
- Titolo del pannello: tradotto? `sidebar_title` è una stringa fissa in Python; usare il nome fisso "Cronotermostato" (uguale in italiano e inglese); il titolo interno dell'editor segue la lingua.

- [ ] **Step 1: Test fallenti.**
  - `test_panel_registered_by_default`: dopo setup, `frontend.async_panel_exists(hass, "cronotermostato")`, il pannello ha `require_admin=True`, `sidebar_title="Cronotermostato"`, e `config["_panel_custom"]["module_url"]` contiene la versione.
  - `test_panel_not_registered_when_disabled`: opzione `show_sidebar=False` -> nessun pannello, ma `add_extra_js_url` fatto (l'URL è in `hass.data[frontend.DATA_EXTRA_MODULE_URL].urls`).
  - `test_admin_only_false`: `require_admin=False` sul pannello.
  - `test_reload_applies_options`: cambiare le opzioni dal flusso -> la voce si ricarica; il pannello compare/scompare, **nessun `ValueError("Overwriting panel")`** e nessun avviso "Removing unknown panel" nei log.
  - `test_unload_removes_everything`: dopo l'unload il pannello e l'URL extra sono spariti; un secondo setup funziona.
  - `test_setup_failure_leaves_no_panel`: se `manager.async_start()` fallisce, nessun pannello resta registrato.
  - `test_panel_hidden_from_non_admin`: con `hass_ws_client` di un utente non admin, `get_panels` non elenca il pannello se `admin_only`; lo elenca se non lo è.
- [ ] **Step 2-4:** Eseguire (falliscono), implementare, eseguire (passano). Verificare in locale con `uv run pytest -W error` perché il progetto usa `-W error`. Commit `"Registrazione del pannello e della risorsa dell'editor"`.

### Task 4: Comandi WebSocket per il salvataggio e gli aggiornamenti

**Files:**
- Modify: `custom_components/cronotermostato/websocket_api.py`, `store.py` (solo se serve una funzione di `revision`), `services.py` (estrarre, senza cambiare il comportamento, le funzioni che servizi e WS devono condividere)
- Test: `tests/test_websocket.py`

**Interfaces:**
- Produces: vedi "Nuovi comandi WebSocket" sopra. `program_revision(program) -> str` = primi 12 caratteri esadecimali di SHA-1 del JSON canonico di `program_to_dict` (chiavi ordinate), in `engine/models.py` o `store.py`. I comandi di scrittura sono `@websocket_api.async_response`, controllano `_require_editor_rights(hass, connection, msg)` (se `admin_only` e non admin -> `connection.send_error(msg["id"], "unauthorized", ...)`), poi chiamano le stesse funzioni di `CronoStore`/`Manager` dei servizi e traducono `ProgramError` in `invalid_format`, programma sparito in `not_found`, revisione diversa in `conflict`.

- [ ] **Step 1: Test fallenti** (`hass_ws_client` con utente admin e con `hass_read_only_user`/non admin).
  - `state` contiene `revision` per programma e `options.admin_only`; due programmi uguali hanno la stessa revisione, una modifica la cambia.
  - `save_program` senza `program_id` crea e restituisce `program_id` e `revision`; con `program_id` e `expected_revision` corretta aggiorna; con revisione vecchia -> `conflict` e **niente cambiato**; programma inesistente -> `not_found` (non lo crea); sovrapposizione -> `invalid_format`; fasce `auto: true` in ingresso scartate come in `preview_day`.
  - `test_save_assigned_program_no_unexpected_commands` (Review Focus): programma assegnato a una stanza di prova (climate finto con registro delle chiamate); salvare con la fascia corrente invariata non produce chiamate; cambiare la temperatura della fascia corrente produce l'ordine `set_hvac_mode` (se cambia), `set_preset_mode` (se c'è), `set_temperature`, una volta sola; cambiare una fascia futura non produce chiamate ma sposta la prossima pianificazione.
  - `delete_program` di un programma assegnato -> errore (come il servizio); dopo `unassign` riesce.
  - `assign` a un `climate` inesistente -> errore; `assign` di un programma inesistente -> errore.
  - **Permessi:** con `admin_only=True` un non admin riceve `unauthorized` da `save_program`, `delete_program`, `assign`, `unassign`, e **nessun dato cambia**; con `admin_only=False` riesce; `state`, `preview_day`, `countries` e i servizi `pause`/`resume`/`set_manual`/`resume_auto` restano aperti a tutti (come oggi).
  - `subscribe`: dopo `save_program` da un secondo client arriva un evento `changed` al primo; chiudere la sottoscrizione toglie il listener (nessun listener residuo dopo il test).
  - `not_loaded` per tutti i comandi di scrittura se la voce non è caricata.
- [ ] **Step 2:** Eseguire e vedere i fallimenti.
- [ ] **Step 3:** Implementare. Nota di progetto da riportare nel docstring del modulo: i comandi di lettura restano aperti (i dati sono già negli attributi dei sensori, leggibili da ogni utente); i comandi di scrittura strutturali seguono l'opzione. Se Alex decide di limitare anche i servizi (decisione aperta), la modifica è separata e sta in un Task proprio.
- [ ] **Step 4:** Eseguire: passano. Commit `"API WebSocket: salvataggio con revisione e sottoscrizione"`.

### Task 5: Struttura del frontend, Lit e logica pura con test node

**Files:**
- Create: `custom_components/cronotermostato/frontend/lit.js` (copia di `lit-core.min.js` della versione 3.x scelta, con intestazione che riporta versione e URL di origine), `frontend/LICENSE-lit.txt`, `frontend/lib/time.js`, `frontend/lib/validate.js`, `frontend/lib/model.js`
- Create: `tests/frontend/package.json` (solo `{"type": "module"}`, nessuna dipendenza), `tests/frontend/time.test.mjs`, `validate.test.mjs`, `model.test.mjs`
- Modify: `.github/workflows/ci.yml` (job `frontend`: `node --test tests/frontend/`), `pyproject.toml` (nessuna modifica), `README.md` (solo la sezione "Development")

**Interfaces:**
- Produces (JS puro, senza `window`/DOM):
  - `lib/time.js`: `parseTime(text, {asEnd}) -> minuti | null` (accetta `"HH:MM"`, `"H:MM"`; `"24:00"` solo come fine; 0..1440), `formatTime(minutes) -> "HH:MM"`.
  - `lib/validate.js`: `validateDay(bands) -> Error[]` con codici (`overlap`, `end_before_start`, `bad_time`, `bad_mode`, `missing_setting`, `off_with_setting`, `bad_temperature`), indice della fascia e campo; `validateProgram(program)`; stessa semantica di `engine/models.py::validate_bands` e `validate_setting` (si ignorano le fasce `auto`).
  - `lib/model.js`: `emptyProgram(name)`, `cloneProgram`, `stripAuto(week)`, `serializeBand(band)` (omette `temperature`/`preset` nulli o vuoti; `off` non porta né l'uno né l'altro; temperatura come numero), `deserializeProgram(serverProgram)`, `sortBands`, `programsEqual(a,b)` (per la bozza non salvata), `dayName(index)` (0 = lunedì).
- Regole di parità con il server (da riprodurre con gli stessi casi del piano 1, Task 2): `24:00` rifiutato come inizio; fine <= inizio rifiutata; sovrapposizione di un minuto rifiutata; adiacente ammessa; `heat` senza temperatura né preset rifiutato; `heat` con solo preset ammesso; `off` con temperatura o preset rifiutato; `mode` sconosciuto rifiutato; temperatura non numerica rifiutata.

- [ ] **Step 1: Test fallenti** con `node --test`: `time.test.mjs` (round trip, `"24:00"`, `"7:5"` rifiutato, `"25:00"`), `validate.test.mjs` (un test per ogni regola sopra; più un test di parità che legge un file di casi condiviso `tests/frontend/cases.json` e che anche un test Python `tests/test_frontend_parity.py` esegue contro `program_from_dict`, così i due lati non divergono), `model.test.mjs` (serializzazione: ciò che esce passa `program_from_dict`; `stripAuto`; nome con `<script>` conservato come testo).
- [ ] **Step 2:** Eseguire `node --test tests/frontend/` e vedere i fallimenti.
- [ ] **Step 3:** Scaricare Lit (versione 3.x, almeno due settimane di vita, versione fissata) in `frontend/lit.js` verificando che sia il file autonomo `lit-core.min.js` e non un file che importa da CDN; registrare nel file la versione e il checksum. Implementare i tre moduli.
- [ ] **Step 4:** Eseguire: passano (`node --test` e `uv run pytest`). Commit `"Editor: Lit incluso e logica di validazione con test"`.

### Task 6: Livello dati del frontend (WebSocket, servizi, lingua, tema)

**Files:**
- Create: `frontend/lib/api.js`, `frontend/lib/store.js` (stato reattivo), `frontend/lib/i18n.js`, `frontend/i18n/it.js`, `frontend/i18n/en.js`, `frontend/lib/climate.js`
- Test: `tests/frontend/api.test.mjs`, `store.test.mjs`, `i18n.test.mjs`, `climate.test.mjs` (con un `hass` finto: `callWS`, `callService`, `connection.subscribeMessage`, `states`, `language`)

**Interfaces:**
- Produces:
  - `api.js`: `loadState(hass)`, `previewDay(hass, bands)`, `loadCountries(hass)`, `saveProgram(hass, {programId, name, week, holiday, expectedRevision})`, `deleteProgram`, `assign`, `unassign`, `pauseRoom`, `resumeRoom`, `setManual(hass, climateId, {mode, temperature, preset})`, `resumeAuto`, `subscribe(hass, onChange)` (restituisce la funzione per annullare); ogni errore WS/servizio diventa `EditorError {code, message}` con `code` fra `conflict`, `not_found`, `invalid_format`, `unauthorized`, `not_loaded`, `network`.
  - `store.js`: stato `{programs, rooms, options, loading, error}`, rilettura con anti-rimbalzo di 250 ms dopo `changed`, ordine stabile dei programmi (per nome, poi id).
  - `climate.js`: `climateRooms(hass)` (da `hass.states`: id, nome, `hvac_modes`, `preset_modes`, `min_temp`, `max_temp`, `target_temp_step` con ripieghi 5/35/0.5 come `DEFAULT_MIN_TEMP`/`DEFAULT_MAX_TEMP` del server), `roomIssues(program, room)` -> avvisi (`unsupported_mode`, `unsupported_preset`, `out_of_range`) calcolati con le stesse regole del controllore.
  - `i18n.js`: `t(key, params)` con lingua da `hass.locale?.language ?? hass.language`, ripiego su `en` e poi sulla chiave; stringhe it/en parallele (test: stesse chiavi nei due file).

- [ ] **Step 1: Test fallenti** con `hass` finto: errori WS mappati sui codici; `subscribe` annullato non lascia gestori; due `changed` ravvicinati producono una sola `loadState`; `t` con parametri e ripiego; `climate.js` su un climate con `hvac_modes ["heat","off"]` e `min_temp 15`/`max_temp 25` segnala `cool` come `unsupported_mode`, 28° come `out_of_range`, preset assente come `unsupported_preset`; i test chiavi it/en identiche.
- [ ] **Step 2-4:** Eseguire (falliscono), implementare, eseguire (passano). Commit `"Editor: livello dati, lingue e controlli sulle stanze"`.

### Task 7: Elenco dei programmi e struttura dell'editor *(sbloccato dall'approvazione del Task 0)*

**Files:**
- Create: `frontend/components/crono-editor.js` (elemento radice), `crono-program-list.js`, `crono-dialog.js` (conferma/errore accessibile), `frontend/styles.js` (variabili CSS di HA con ripiego)
- Modify: `frontend/cronotermostato.js` (registra `cronotermostato-panel` che avvolge `crono-editor` con intestazione e tasto menu per `narrow`, secondo la documentazione del pannello)
- Test: `tests/frontend/program-list.test.mjs` (logica di ordinamento/filtro/selezione e rendering di stringhe senza DOM)

**Interfaces:**
- Consumes: store del Task 6. Produces: elenco programmi (nome, numero di stanze, avvisi), nuovo / duplica / rinomina / elimina (eliminazione impedita con spiegazione se il programma ha stanze, con scorciatoia "Rimuovi dalle stanze"), selezione memorizzata nella sessione (non in `localStorage` per i dati, solo per la selezione, con `try/catch`); stati: caricamento, errore, `not_loaded`, nessun programma (invito a crearne uno).

- [ ] **Step 1: Test fallenti** sulla logica (ordine, selezione dopo cancellazione, programma sparito durante la modifica -> `status "removed"`), e sul rendering a stringa del nome `<img src=x onerror=alert(1)>` (non produce un elemento).
- [ ] **Step 2-4:** Implementare i componenti secondo la bozza approvata; Commit `"Editor: elenco dei programmi"`.

### Task 8: Fasce della settimana (tabella) con validazione e anteprima automatica

**Files:**
- Create: `frontend/components/crono-day.js` (fasce di un giorno), `crono-band-row.js`, `crono-week-tabs.js`
- Test: `tests/frontend/day-editing.test.mjs`

**Interfaces:**
- Produces: modifica di inizio, fine, modo (`heat`/`cool`/`off`), temperatura (passo `target_temp_step` della stanza, altrimenti 0.5) e preset (elenco dall'unione dei `preset_modes` delle stanze assegnate, più campo libero con avviso); aggiungi / elimina / copia giorno su altri giorni ("applica a lun-ven"); fasce automatiche mostrate dopo ogni modifica con il segno (icona + testo accessibile "calcolata"), da `previewDay` con anti-rimbalzo; la modifica di una fascia automatica la trasforma in fascia dell'utente (come previsto dal design); errori di validazione accanto al campo e sul totale, con il pulsante Salva disattivato finché ce ne sono; modifiche non salvate segnalate (bozza), con "Annulla modifiche"; salvataggio con `expectedRevision`; gestione di `conflict` (messaggio, ricarica o sovrascrivi) e di `not_found`.

- [ ] **Step 1: Test fallenti** sulla logica: aggiungere una fascia dopo l'ultima propone l'inizio uguale alla fine precedente; "24:00" proposto come fine solo ultimo; modificare la fine di una fascia in modo da creare sovrapposizione produce l'errore `overlap` sulla seconda; il serializzatore non invia mai fasce `auto`; cambio modo in `off` svuota temperatura e preset; da `off` a `heat` richiede temperatura o preset.
- [ ] **Step 2-4:** Implementare, eseguire, Commit `"Editor: fasce del giorno con validazione e fasce automatiche"`.

### Task 9: Parte festiva e nazione

**Files:**
- Create: `frontend/components/crono-holiday.js`
- Modify: `crono-editor.js`
- Test: `tests/frontend/holiday.test.mjs`

**Interfaces:**
- Produces: sezione "Festivi" dello stesso programma con lo stesso editor del giorno (stesse regole); indicazione della nazione e suddivisione attive (da `state`: `country`, `subdiv`) con collegamento alle opzioni dell'integrazione (la nazione si cambia lì, non nell'editor; `countries` serve solo per mostrare il nome); nota "Un giorno festivo usa sempre questa parte, anche di domenica".

- [ ] **Step 1-4:** Test (festivo indipendente dai giorni; copia giorno -> festivo), implementare, Commit `"Editor: parte festiva"`.

### Task 10: Assegnazione alle stanze, pausa, forzatura e stato

**Files:**
- Create: `frontend/components/crono-rooms.js`, `crono-room-card.js`, `crono-manual-dialog.js`
- Test: `tests/frontend/rooms.test.mjs`

**Interfaces:**
- Produces: per il programma selezionato, elenco di tutte le stanze `climate` di HA (con area) con interruttore "assegnata a questo programma"; una stanza assegnata a un altro programma mostra quale e chiede conferma prima di spostarla (`assign` la sposta); toglierla chiede conferma e mostra che la stanza non sarà più comandata; pausa/ripresa; stato della stanza con parola chiara in italiano/inglese per ogni `status` (`ok`, `paused`, `unassigned`, `unavailable`, `unsupported_mode`, `unsupported_preset`, `out_of_range`, `missing`, `error`, `not_running`) e per qualsiasi altro valore (mostrato così com'è: lo stato è un insieme aperto, vedi `websocket_api.py`); fascia attuale ("fino alle HH:MM", anche se è un'ora del giorno dopo) e successiva; badge `manuale` con "Torna in automatico" (`resume_auto`); forzatura: modo, temperatura (limiti della stanza), preset della stanza, con avviso che dura fino a fine fascia; avvisi di compatibilità fra programma e stanza (`roomIssues`) **prima** di assegnare.
- Nota: `out_of_range` è uno stato calcolato dal frontend o dal server? Verificare nel Task: se `RoomStatus` del server non ha `out_of_range`, mostrare l'avviso solo da `roomIssues` (lato client) e aggiungere al piano 1 un'osservazione per Alex; non inventare uno stato server.

- [ ] **Step 1: Test fallenti** (logica): testo e gravità per ogni stato, compreso uno sconosciuto; `assign` verso una stanza già assegnata altrove chiede conferma; nessun comando se l'utente annulla; `setManual` con `off` non invia temperatura né preset; temperatura fuori dai limiti della stanza bloccata nel dialogo.
- [ ] **Step 2-4:** Implementare, Commit `"Editor: assegnazione alle stanze, pausa e forzatura"`.

### Task 11: Scheda Lovelace e annuncio nel selettore

**Files:**
- Create: `frontend/components/crono-card.js`, `crono-card-editor.js`
- Modify: `frontend/cronotermostato.js`
- Test: `tests/frontend/card.test.mjs` (`setConfig`, `getStubConfig`, annuncio)

**Interfaces:**
- Produces: `cronotermostato-card` con `setConfig(config)` (che solleva errore chiaro su configurazione non valida), `set hass(hass)`, `getCardSize()`, `getGridOptions()` (`{columns: 12, rows: auto, min_columns: 6}`), `static getStubConfig()`, `static getConfigElement()` -> `cronotermostato-card-editor` (opzioni: `view` = `editor` | `rooms`, `title`, `program_id` facoltativo per aprire direttamente un programma, `rooms` elenco facoltativo di stanze da mostrare); registrazione `window.customCards.push({type: "cronotermostato-card", name: "Cronotermostato", description: ..., preview: false, documentationURL: <README>})` una sola volta (guardia se il file è caricato due volte); la scheda `view: editor` incorpora `crono-editor` (stesso componente, `hass` passato dalla scheda); `view: rooms` è una vista compatta di stato/forzatura per le stanze senza editor completo. `customCards` testato anche con `window.customCards` già pieno da altre schede.

- [ ] **Step 1-4:** Test (`setConfig` con config vuota, con vista sconosciuta -> errore; una sola voce in `customCards` dopo due caricamenti), implementare, Commit `"Scheda Lovelace dell'editor"`.

### Task 12: Griglia visuale della settimana *(facoltativo: solo se Alex la sceglie, vedi decisioni aperte)*

**Files:**
- Create: `frontend/components/crono-week-grid.js`
- Test: `tests/frontend/week-grid.test.mjs`

**Interfaces:**
- Produces: vista a blocchi della settimana (secondo la bozza B o C approvata): la stessa modifica dei dati del Task 8 (nessun secondo modello); un tocco apre la fascia nella tabella; trascinamento dei bordi solo come scorciatoia (tutto raggiungibile anche da tastiera/tocco senza trascinare); arrotondamento a 5 minuti; su telefono un giorno alla volta.

- [ ] **Step 1-4:** Test sulla conversione minuti <-> posizione, arrotondamento e vincoli (non sovrapporre); implementare; Commit `"Editor: griglia visuale della settimana"`.

### Task 13: Tema, telefono, lingua, accessibilità e sicurezza del rendering

**Files:**
- Modify: `frontend/styles.js` e i componenti; Create: `tests/frontend/xss.test.mjs`, `tests/frontend/i18n-coverage.test.mjs`

**Interfaces:**
- Produces: solo variabili CSS di HA (`--primary-color`, `--primary-text-color`, `--secondary-text-color`, `--card-background-color`, `--divider-color`, `--error-color`, `--warning-color`, `--ha-card-border-radius`, ...) con ripiego; colori dei modi: ambra riscaldamento e blu raffrescamento come nel tile, resi con contrasto sufficiente in chiaro e scuro; verifica con tema scuro e con un tema personalizzato; `@media (max-width: 600px)` e la proprietà `narrow` del pannello; bersagli >= 44 px; `aria-label` e ruoli per tabella, dialoghi e stati; focus visibile; stato non espresso solo dal colore (icona + testo); sicurezza: nessun `unsafeHTML`/`innerHTML`/`insertAdjacentHTML`/`eval`/`new Function` nel codice (test che scandisce i file `frontend/` e fallisce se compaiono), nomi con markup mostrati letterali anche in `title`, `aria-label`, dialoghi e messaggi di errore; ogni chiave `t()` usata nel codice esiste in `it.js` ed `en.js`.

- [ ] **Step 1: Test fallenti** (scansione statica, copertura chiavi, rendering a stringa dei nomi ostili: `<script>`, `"onmouseover=`, `</title>`, `${7*7}`, nome vuoto, nome di 1000 caratteri).
- [ ] **Step 2-4:** Implementare, Commit `"Editor: tema, telefono, lingue e sicurezza del rendering"`.

### Task 14: Documentazione, CI e prova su Home Assistant

**Files:**
- Modify: `README.md` (inglese: editor come pannello e come scheda, opzioni, permessi e il limite sui servizi, aggiornamento HACS e cache), `.github/workflows/ci.yml` (job `frontend` con `node --test`, e controllo che nessun file generato/minificato proprio sia in git), `hacs.json` (se serve per il rendering di file extra: verificare sulla documentazione HACS attuale, non a memoria)
- Create: `docs/PROVA_EDITOR_SU_HA.md`

**Interfaces:**
- `docs/PROVA_EDITOR_SU_HA.md`, elenco guidato di verifiche, con una sola stanza di prova indicata da Alex (nessun comando ai termostati reali senza chiederlo):
  - Installazione: copiare la cartella, riavviare, voce laterale presente (default) e scheda nel selettore **senza** aggiungere risorse a mano; il tasto "Aggiungi scheda" mostra "Cronotermostato" con descrizione.
  - Opzioni: spegnere "barra laterale" -> la voce sparisce dopo il ricarico, la scheda funziona ancora; riaccendere -> torna; attivare/disattivare "solo amministratori" e provare con un utente non amministratore (vista da telefono): voce nascosta; aprire a mano `/cronotermostato` come non admin (**da verificare cosa succede**, annotare); tentare una modifica con `Strumenti per sviluppatori` o con un client WS come non admin: `unauthorized` per i comandi dell'editor, e annotare che i servizi `cronotermostato.*` rispondono ancora (fino a decisione di Alex).
  - Programma: crea, aggiungi fasce con temperatura e con preset, errore di sovrapposizione, fasce automatiche con il segno, festivo, salva, riapri; copia giorno; elimina un programma assegnato (rifiutato) e uno libero.
  - Due editor aperti (computer e telefono): modifica sull'uno, l'altro si aggiorna; salvataggio concorrente -> avviso di conflitto.
  - Assegnazione alla stanza di prova, controllo dello stato (compresi `unsupported_preset`/`unsupported_mode`/fuori limiti con una fascia volutamente incompatibile), pausa/ripresa, forzatura e "Torna in automatico", riavvio di HA durante una forzatura.
  - Cache: aggiornare la versione (es. 0.2.0 -> 0.2.1 con una scritta cambiata), riavviare, ricaricare **senza** svuotare la cache del browser e controllare che la scritta sia nuova; ripetere nell'app companion.
  - Tema scuro, lingua inglese, telefono in verticale e in orizzontale.
- [ ] **Step 1:** Scrivere README e `docs/PROVA_EDITOR_SU_HA.md`; CI: job `frontend` e controlli di `hassfest`/HACS invariati.
- [ ] **Step 2:** Eseguire in locale `uv run pytest` e `node --test tests/frontend/` (tutto verde) e controllare la CI su GitHub quando esisterà il repository.
- [ ] **Step 3:** **Chiedere ad Alex** prima di qualsiasi prova su HA reale e prima di comandare qualunque termostato; copiare l'integrazione in `/config/custom_components/` solo dopo il suo via libera; eseguire `docs/PROVA_EDITOR_SU_HA.md` con la stanza che indica.
- [ ] **Step 4:** **Chiedere ad Alex** prima di creare il repository su GitHub, fare il push o pubblicare una release (la release è ciò che HACS legge).
- [ ] **Step 5:** Commit `"Documentazione e prova dell'editor su Home Assistant"`.

---

## Strategia di test, in sintesi

- **Python (pytest, come il piano 1):** pannello registrato/rimosso con le opzioni e il ricarico, nessun residuo dopo unload, file statico servito (e path traversal), URL con versione, opzioni unite senza perdere la nazione, nuovi comandi WebSocket con conflitto, permessi (utente non admin e admin), sottoscrizione, nessun comando inatteso al salvataggio di un programma assegnato. `-W error` come oggi.
- **JavaScript (`node --test`, nessuna dipendenza npm):** tutta la logica che non tocca il DOM (orari, validazione, serializzazione, stati delle stanze, avvisi di compatibilità, lingue, scansione statica anti-XSS), con un file di casi condiviso con un test Python di parità contro `program_from_dict`. Non si usa un browser automatico (Playwright/Cypress): costo di manutenzione alto per un editor di dimensioni modeste.
- **Prova guidata manuale:** `docs/PROVA_EDITOR_SU_HA.md`, con una sola stanza di prova.
- **CI aggiuntiva:** job `frontend` (`node --test`) e un controllo che `frontend/` non contenga file generati propri; `hassfest` verifica le nuove `dependencies`.

---

## DECISIONI APERTE PER ALEX (non decise dal piano)

1. **Bozze grafiche (Task 0):** quale bozza (A tabella, B griglia, C ibrida) e con quali modifiche. Nessuna costruzione della grafica prima di questa risposta.
2. **Solo tabella o anche griglia visuale?** Il piano mette la tabella come base (Task 8) e la griglia come Task 12 facoltativo. Se Alex vuole la griglia fin dalla prima versione, il Task 12 passa prima del Task 10.
3. **Libreria dell'interfaccia:** Lit copiato in repo senza build (proposta, Task 5), oppure TypeScript/Lit con build e bundle committato, oppure vanilla senza librerie.
4. **Default delle opzioni:** proposti "mostra nella barra laterale" = **sì** e "solo amministratori" = **sì**. Alternativa: voce laterale spenta di default (nessun cambiamento visibile per chi aggiorna).
5. **Cosa significa davvero "solo amministratori":** i servizi `create_program`, `update_program`, `delete_program`, `assign`, `unassign` oggi sono aperti a ogni utente autenticato (verificato su `services.py`). Opzioni: (a) l'opzione governa visibilità del pannello e comandi dell'editor, i servizi restano aperti (proposta del piano, meno modifiche); (b) rendere admin-only i servizi strutturali (cambia il piano 1: uso da automazioni di utenti non admin e tile); (c) un'opzione separata. `pause`/`resume`/`set_manual`/`resume_auto` restano comunque aperti perché li usa il tile.
6. **Rimuovere la voce laterale per sempre dal "solo admin":** l'admin può comunque cambiare visibilità e `require_admin` del pannello dall'interfaccia di HA (`frontend/update_panel`); il piano lo accetta.
7. **Conflitti fra due editor:** il piano propone `conflict` con scelta ricarica/sovrascrivi; alternativa più semplice: l'ultimo che salva vince, senza controllo.
8. **Titolo e icona della voce laterale:** proposti "Cronotermostato" e `mdi:calendar-clock`.
9. **Scheda Lovelace:** una sola scheda con due viste (`editor`, `rooms`), come proposto, oppure due schede distinte (`cronotermostato-editor-card` e `cronotermostato-rooms-card`).
10. **Stato `out_of_range`:** oggi non è fra i `RoomStatus` del server (piano 1). Il piano lo mostra come avviso calcolato nel client; se Alex lo vuole come stato del server, serve una modifica al piano 1.
11. **Nazione delle festività dall'editor:** il piano la lascia nelle opzioni dell'integrazione; alternativa: cambiarla dall'editor (richiederebbe un comando WS in più).
