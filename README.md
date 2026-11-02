# Cronotermostato

Home Assistant custom integration (HACS): reusable weekly thermostat programs
(time slots with mode and temperature, plus a holiday day chosen by country),
assigned to any number of `climate` entities ("rooms"), with a manual override.

Status: version 0.3.0, **not yet tested on a live Home Assistant** (neither the integration nor
the editor). Parts 1 and 2 of 3 (the integration and its editor) are in this repository; the Tessera
tile is a separate project.

Requires Home Assistant 2026.10.0 or newer. The `holidays` Python library is
installed automatically.

## Installation (HACS, custom repository)

> The repository URL below is provisional: it is the one written in
> `manifest.json`, and the repository may not be published yet.

1. HACS -> three-dot menu -> **Custom repositories**.
2. Repository: `https://github.com/alexcoscia/cronotermostato`, category **Integration**.
3. Install **Cronotermostato** and restart Home Assistant.
4. Settings -> Devices & services -> **Add integration** -> *Cronotermostato*.

Manual install: copy `custom_components/cronotermostato` into `/config/custom_components/`
and restart.

## Configuration

Only one instance can be configured. The setup asks for:

- **Country**: its public holidays select the holiday part of every program.
  Defaults to the country of your Home Assistant.
- **Region** (optional, only for countries that have regions).

Both can be changed later from the integration's **Configure** button; the
integration reloads and recomputes every room. Times follow the Home Assistant
time zone.

## Options

From the integration's **Configure** button (Settings -> Devices & services -> Cronotermostato):

| Option | Default | What it does |
| --- | --- | --- |
| Country / Region | country of Home Assistant | Public holidays of every program (see above). |
| **Show in sidebar** | on | Adds the editor to the sidebar as `/cronotermostato`. Turning it off removes the entry; the Lovelace card keeps working. |
| **Administrators only** | on | Hides the sidebar entry from users who are not administrators, and makes the editor's write commands answer `unauthorized` for them (see Permissions). |

Saving the options reloads the integration; reload the browser page to see the sidebar entry appear
or disappear.

## Editor

The editor edits programs (days, slots, holiday part), assigns them to rooms, pauses a room and
forces it manually. It works in two places, both loaded by the integration itself: **you do not
add any Lovelace resource by hand**.

- **Sidebar panel** "Cronotermostato" (icon `mdi:calendar-clock`), if *Show in sidebar* is on.
- **Lovelace card** `cronotermostato-card`, listed as "Cronotermostato" in the card picker, with a
  visual configuration editor. Options:

  | Option | Meaning |
  | --- | --- |
  | `view` | `rooms` (default): compact status of the rooms that follow a program, with pause and manual override, read only. `editor`: the full editor inside the card. |
  | `title` | Optional text above the card. |
  | `program_id` | `rooms` view: only the rooms that run this program. `editor` view: opens this program. |
  | `rooms` | `rooms` view: list of `climate.*` entity ids to show; empty or missing means all. |

  ```yaml
  type: custom:cronotermostato-card
  view: rooms
  title: Heating
  rooms:
    - climate.soggiorno
  ```

The editor texts are in Italian and English (they follow the language of the Home Assistant user).
Colours come from the Home Assistant theme.

### Permissions, and an honest limit

- `admin_only` (default on) controls two things: whether the sidebar entry is visible to
  non-administrators, and whether the editor's write commands (`save_program`, `delete_program`,
  `assign`, `unassign` over the WebSocket) are accepted from a non-administrator
  (`unauthorized` otherwise).
- Pause, resume, manual override and "back to automatic" are open to every authenticated user, on
  purpose: they are what a wall tile or a family member needs.
- **The `cronotermostato.*` services are not restricted**: every authenticated user can call
  `create_program`, `update_program`, `delete_program`, `assign`, `unassign` and `set_day` (for example from
  Developer tools), whatever `admin_only` says. This now includes `set_day`, which changes the
  **shared** program of a room (and so every room that uses it). `admin_only` is not a security boundary.
- Hiding the sidebar entry is only visibility: an administrator can change it in the Home Assistant
  UI, and opening `/cronotermostato` by hand as a non-administrator has not been checked yet.
- The static files of the editor are served without authentication (like all Home Assistant
  static paths); they contain no personal data.

### Installing and updating

Install through HACS as described above (or copy the folder) and restart Home Assistant: the card
and the sidebar entry appear, nothing else to configure.

To update, update through HACS (or copy the folder) and **restart Home Assistant**. The URL of the
editor files is `/cronotermostato_static/<version>-<fingerprint>/...`, where the fingerprint is the
first 8 hex digits of a sha256 over the names and contents of all the files in `frontend/`,
computed once when Home Assistant starts. Any change to the JavaScript, with or without a new
version in `manifest.json`, therefore gives new URLs (sub-modules included) and the browser does not
serve the old code. The restart is still needed: the Python side and the new static path are only
loaded at startup. This is the design; it has not been verified on a live system. If an old page
stays open it keeps the old code until it is reloaded; if the companion app still shows old code
after a restart, clear its frontend cache.

## Concepts

- **Program**: a name, seven days (Monday first) of slots, and one holiday day.
- **Slot (band)**: `start`, `end` (`HH:MM`, `24:00` allowed as end), `mode`
  (`heat`, `cool`, `off`) and `temperature` (required for `heat`/`cool`, not allowed
  for `off`). Slots of a day cannot overlap; adjacent ones are fine. Gaps are filled
  automatically with `off` slots (shown with `auto: true`).
- A slot lasts until the next one, even across midnight: the last slot of a day
  continues until the first slot of the next day, which may belong to a different
  day type (weekday, holiday...).
- **Holidays**: on a public holiday of the configured country the holiday day is
  used, even on a Sunday.
- **Room**: a `climate` entity with exactly one program; one program can serve many rooms.

## Services

Services are in the `cronotermostato` domain. Times are `HH:MM`. The `week` field is
a list of exactly 7 lists (Monday to Sunday).

### `cronotermostato.create_program`

Creates a program and returns its id (the slug of the name; a numeric suffix is added
if it already exists). Fields: `name` (1-100 characters), `week`, `holiday` (all required).

Each band has `start`, `end`, `mode` (`heat`, `cool`, `off`) and two optional fields,
`temperature` and `preset` (a string: one of the `preset_modes` of the thermostat, for
example `home`, `eco`, `sleep`, or `none` if the thermostat lists it). For `heat` and
`cool` at least one of the two is required (both are allowed); `off` takes neither.

```yaml
action: cronotermostato.create_program
data:
  name: Casa
  week:
    - [{start: "06:30", end: "08:00", mode: heat, temperature: 20.5},
       {start: "17:00", end: "22:30", mode: heat, temperature: 21},
       {start: "22:30", end: "24:00", mode: heat, preset: sleep}]
    - []
    - []
    - []
    - []
    - [{start: "08:00", end: "23:00", mode: heat, temperature: 20.5}]
    - [{start: "08:00", end: "23:00", mode: heat, temperature: 20.5}]
  holiday:
    - {start: "08:00", end: "23:00", mode: heat, temperature: 20}
response_variable: result   # result.program_id == "casa"
```

### `cronotermostato.update_program`

Fields: `program_id` (required), and any of `name`, `week`, `holiday`. Omitted fields
are left unchanged. Rooms using the program apply the change immediately.

```yaml
action: cronotermostato.update_program
data:
  program_id: casa
  holiday:
    - {start: "09:00", end: "22:00", mode: heat, temperature: 19.5}
```

### `cronotermostato.delete_program`

Deletes a program; fails if any room still uses it. Field: `program_id`.

```yaml
action: cronotermostato.delete_program
data:
  program_id: casa
```

### `cronotermostato.assign`

Assigns a program to a room and applies the current slot straight away. Fields:
`program_id`, `climate_entity_id`. Assigning a room that already has a program
switches it to the new one.

```yaml
action: cronotermostato.assign
data:
  program_id: casa
  climate_entity_id: climate.soggiorno
```

### `cronotermostato.unassign`

Removes the program from a room and stops controlling it (the thermostat keeps its
last setting). Field: `climate_entity_id`.

```yaml
action: cronotermostato.unassign
data:
  climate_entity_id: climate.soggiorno
```

### `cronotermostato.pause` / `cronotermostato.resume`

`pause` stops all commands to the room while keeping its assignment (also manual
ones take effect only after resume). `resume` applies the current slot again.
Field: `climate_entity_id`.

```yaml
action: cronotermostato.pause
data:
  climate_entity_id: climate.soggiorno
```

### `cronotermostato.set_manual`

Forces a setting **until the end of the current slot**. Fields:
`climate_entity_id`, `mode` (`heat`, `cool`, `off`), `temperature` and `preset` (both
optional, but `heat`/`cool` need at least one; both are ignored for `off`).

```yaml
action: cronotermostato.set_manual
data:
  climate_entity_id: climate.soggiorno
  mode: heat
  temperature: 22
```

```yaml
action: cronotermostato.set_manual
data:
  climate_entity_id: climate.soggiorno
  mode: heat
  preset: eco      # preset only: no set_temperature is sent
```

### `cronotermostato.resume_auto`

Drops the override and applies the current slot. Field: `climate_entity_id`.

```yaml
action: cronotermostato.resume_auto
data:
  climate_entity_id: climate.soggiorno
```

### `cronotermostato.set_day`

Replaces **the bands you set for today** in the program of a room (made for the Tessera
display, but usable from anywhere). Fields: `climate_entity_id`, `day_kind` and `bands`.

**The program is shared**: the change applies to every room that uses it, and to every
future occurrence of that weekday (or of the holiday day). The other days and the name are
left unchanged. Like the other services, it is open to every authenticated user.

- `day_kind` is the day the caller believes it is editing: `mon`, `tue`, `wed`, `thu`, `fri`,
  `sat`, `sun` or `holiday`. The integration works out today's day for the room (local time of
  Home Assistant, public holidays of the configured country: on a holiday it is `holiday`, even on
  a Sunday). If it is not the same, nothing is changed and the call fails with `stale_day`: a page
  that stayed open across midnight cannot write on the wrong day.
- `bands` is a compact text, at most 1024 characters, at most 24 bands:

  ```
  bands  := ""  |  band ( ";" band )* [ ";" ]
  band   := HH:MM "-" HH:MM  mode  { temperature | "preset=" NAME }
  mode   := heat | cool | off
  ```

  Times go from `00:00` to `24:00` (`24:00` only as an end; `7:00` is accepted). The temperature
  is a number with a point or a comma and at most two decimals (`20`, `20.5`, `20,5`). `NAME` is
  a preset of the thermostat (letters, digits, `_`, `-`, at most 40). `heat` and `cool` need a
  temperature, a preset or both (in any order, once each); `off` takes neither. Spaces and line
  breaks between tokens are free, the order of the bands is free, bands must not overlap.
  An empty text removes all your bands from that day (the automatic `off` bands fill it).
- Only your bands are written: the automatic `off` bands are recalculated and cannot be written.
- If the resulting day is the same as the stored one, nothing is saved and nothing is re-applied.
  Otherwise rooms using the program apply the new setting at once, like `update_program`.
- The temperatures are checked **before** saving against the limits of the room in the call (the
  same as `set_manual`: its `min_temp`/`max_temp`, else 5-35): a band outside them fails with
  `temperature_out_of_range` and nothing is written. The program is shared, so another room that
  uses it, with narrower limits, may still show `out_of_range` when it applies the band.
- **Last writer wins**: there is no revision check, also between the Home Assistant editor and a
  display. If both change the same day, the later save silently overwrites the earlier one.
- A day that cannot be written in this text is **never changed by `set_day`**: if the stored bands of
  that day have a preset outside `[A-Za-z0-9_-]` (or longer than 40 characters) or a temperature
  with more than two decimals (or negative, or 1000 and over), the call fails with `day_locked`;
  change that day in the editor. A day with more than 24 user bands can be read from the sensor
  but `set_day` refuses to write more than 24 (it never truncates).
- `bands_to_text` in `engine/bands_text.py` (the inverse of the parser, used by tests and tools)
  raises `BandsTextError` for a band it cannot express (for example the preset `Fuori casa`, an
  accented preset, a temperature of `20.125`, `-5` or `1234.5`) instead of writing a text that
  would be read back differently.

```yaml
action: cronotermostato.set_day
data:
  climate_entity_id: climate.soggiorno
  day_kind: mon
  bands: "07:00-09:00 heat 21; 18:00-22:30 heat 20,5; 22:30-24:00 heat preset=eco"
```

Errors: `stale_day` (the day is not today's), `day_locked`, `temperature_out_of_range`, `invalid_bands` (with the band number and the
column of the problem, for example `band 2, column 34: unknown mode 'warm' (use heat, cool or
off)`), `room_not_assigned`. The room sensor also keeps the code of the last refused attempt in
`last_error`.

Room services fail with an error if the room is not assigned; invalid programs
fail with an `invalid_program` error that says what is wrong. `set_manual` with a
temperature outside the limits of the thermostat fails with `temperature_out_of_range`.

## Entities

For each assigned room (one device per room; entity ids use the room name, in Italian):

- `sensor.<room>_programma`: state is the name of the program. Attributes: `slot` and
  `next_slot` (`start`, `end`, `mode`, `temperature`, `preset`, `auto`), `slot_end`, `manual`,
  `override_until`, `auto_slot`, `holiday` (today is a holiday), `status`.
  `status` is one of `ok`, `paused`, `unavailable`, `unsupported_mode`, `unsupported_preset`, `out_of_range`,
  `missing`, `error`.
  Flat attributes for displays that cannot read dictionaries (the Tessera tile); they are not
  recorded in the history:
  - `today_start`, `today_end` (minutes from midnight, wall clock), `today_mode`
    (`0` off, `1` heat, `2` cool), `today_temp`, `today_auto` (`1` for the automatic `off`
    bands that fill the gaps, else `0`: numbers, because Tessera drops lists of booleans): parallel lists with the normalized bands of today's local date
    (holiday or weekday of the assigned program). `today_temp` is `-100` for a band without
    temperature (`off`, or a preset only). On a day with 23 or 25 hours the times stay wall-clock
    (as in the program); a band lying entirely in the spring gap is left out. The lists are empty
    when the room is paused (see `status`) or has no program. They follow the program, not a
    manual override. At midnight the sensor refreshes by itself.
  - `slot_mode`, `slot_temp`, `slot_start_time`, `slot_end_time`, `next_mode`, `next_temp`,
    `next_start_time`: the current and the next slot (same codes as `today_mode`; `*_temp` is
    `null` when the slot has no temperature), and `override_until_time`. The `*_time`
    attributes are ISO 8601 timestamps with time zone, like `slot_end` and `override_until`
    (`slot_end_time` equals `slot_end`); `null` when there is no such slot or override.
  - `program_name` (name of the program of the room), `program_rooms` (how many rooms use it:
    the program is shared, a change from `set_day` applies to all of them), `today_kind`
    (`mon` .. `sun`, or `holiday` when today is a public holiday, consistent with `holiday`;
    it is the day `set_day` edits; changes at midnight) and `last_error` (code of the last
    `set_day` of this room that was refused: `stale_day`, `invalid_bands` or `invalid_program`;
    `null` after a successful attempt or when there is none; kept in memory only, so a restart
    clears it). Example: `program_name: Casa`, `program_rooms: 3`, `today_kind: mon`,
    `last_error: null`. `last_error` is also cleared at midnight and at every restart/reload.
    Like the other flat attributes they are not recorded in the history.
  - `today_preset` and `today_locked`: parallel to `today_*` (one entry per band, automatic
    bands included). `today_preset` is the preset name of the band, `""` if none (always `""` for
    automatic bands). `today_locked` is `1` when a display must **not** edit the band because it
    cannot be written safely in the `set_day` text (preset outside `[A-Za-z0-9_-]{1,40}`,
    temperature with more than two decimals, negative or 1000 and over), else `0`. A day with a
    locked band is refused by `set_day` (`day_locked`).
- `switch.<room>_automatico`: on while the room follows its program. Turning it off
  forces the current slot's setting until the slot ends; turning it on goes back to
  the program.

For each program:

- `sensor.programma_<program_id>`: state is the number of rooms using it. Attributes:
  `program_id`, `name`, `week`, `holiday` (what you saved), `week_full`,
  `holiday_full` (with the automatic `off` slots), `rooms`.

Entities appear and disappear as rooms and programs are created and removed.

## WebSocket API

Used by the editor. The commands below are read-only or pure and open to every authenticated user
(there are also `subscribe`, which notifies changes, and the write commands `save_program`,
`delete_program`, `assign`, `unassign`, which follow `admin_only`):

- `cronotermostato/state`: programs (`week`, `holiday`, `week_full`, `holiday_full`),
  rooms (`climate_entity_id`, `name`, `program_id`, `program_name`, `paused`,
  `status`, `slot`, `next_slot`, `manual`, `override_until`, `holiday`), `country`,
  `subdiv`. Error `not_loaded` if the integration is not loaded.
- `cronotermostato/preview_day` with `bands`: validates the slots of one day and
  returns them with the automatic `off` slots.
- `cronotermostato/countries`: country code -> list of region codes.

Programs can also be changed with the services.

## Behaviour

- Commands are sent (in this order: the mode, the preset if the slot has one, the temperature if it has one) at a slot change if the
  setting differs from the last one applied, at Home Assistant start, on assignment,
  on resume, after a program edit, when the thermostat comes back from
  `unavailable`, and when an override starts or ends. **No periodic commands.**
- Changes made elsewhere (dial, app) are not detected; they last until the next slot change.
- A manual override lasts until the end of the current slot and is kept across a restart.
  If the thermostat is already available when Home Assistant starts, no command is sent
  for it. At a real start the `climate` entity often does not exist yet (state
  `missing`/`unavailable`): when it appears the controller applies the active override
  or the current slot, so commands after a restart, once the thermostat is back, are normal.
- If the thermostat is `unavailable`, nothing is sent; when it comes back the
  current slot is applied. If it does not support the slot's mode, nothing is sent
  and the status is `unsupported_mode`.
- Presets are checked like modes, against the `preset_modes` attribute of the `climate`
  entity (`none` is valid if the thermostat lists it). A slot or override with a preset
  the thermostat does not list sends nothing at all (not even the mode): status
  `unsupported_preset` and one warning in the log per change. The temperature limits are
  checked only when the slot has a temperature. Slots that differ only by preset are
  different slots (never merged), and a command is sent at their boundary.
- Temperature limits come from the `climate` entity (`min_temp`, `max_temp` attributes);
  if they are missing or invalid (not numbers, or min >= max) 5.0 and 35.0 °C are used.
  A `heat`/`cool` slot (or override) outside the limits is not sent at all (neither mode
  nor preset nor temperature, so the room is not left half set): status `out_of_range` and one
  warning in the log. The next slot change, or an explicit action, tries again. `off`
  has no temperature and is never out of range.
- Holidays come from the `holidays` library for the chosen country and region.
- Daylight saving time: a time that does not exist (29 March in Italy) moves to the
  hour of the change; a repeated time (25 October) means its first occurrence.

## Coexisting with the HACS Scheduler

This integration does not read, change or disable the Scheduler. Both can drive the
same house; the sensible way to migrate is room by room: remove a room from the
Scheduler yourself, then assign it here. Never leave the same thermostat in both, or
the two will overwrite each other.

## Known limits

- Saving a program does **not** check temperatures against any thermostat (a program
  does not know its rooms, and the same program can serve rooms with different limits).
  A slot outside the limits of a room shows up only when it is applied, as status
  `out_of_range`. `set_manual` and the automatic switch, which target one room, do
  check and fail with `temperature_out_of_range`. A thermostat that rejects a value
  within the declared limits still gives status `error`.
- After `error` there is no retry until the next slot change, until the thermostat
  comes back, or until an explicit action (assign, resume, resume_auto, program edit).
- An override whose command never went out (Home Assistant stopped right after saving
  it) is not re-sent after the restart.
- Some thermostats change the preset by themselves when they receive a manual
  temperature (observed on the test thermostat). For a slot with **both** a preset and a
  temperature the temperature is sent last, so it may make the thermostat switch its
  preset. For this kind of thermostat use a preset alone or a temperature alone in a slot.
- The thermostat is not asked whether a preset really took effect; a rejected command
  gives status `error`.
- The temperature selector of `set_manual` in `services.yaml` shows 5-35 as a hint; the
  real limits are those of the room's `climate`, checked when the service runs.
- Program names are at most 100 characters; ids are slugs of at most 50 characters.
- `cronotermostato/state` is readable by every authenticated user.
- The `cronotermostato.*` services are open to every authenticated user; `admin_only` does not
  restrict them (see Permissions).
- The editor has been tested with automated tests only, not yet on a live Home Assistant.
- Only one configuration entry; one program per room.
- The icon is in `custom_components/cronotermostato/brand/` (`icon.png`, `icon@2x.png`). Whether it
  satisfies the `brands` check of HACS has not been verified: that needs the CI (`hacs/action`) to
  run, and it has not run yet.
- The colours of errors, warnings and modes (heat, cool, off) are fixed, to guarantee the contrast
  of the text on them; they do not follow `--error-color` / `--warning-color` of custom themes.
  Text, surfaces, lines and the focus ring follow the theme; the primary button uses the theme's
  accent darkened by half so white text stays readable.

## Development

```
uv venv --python 3.14 .venv
uv pip install --python .venv/bin/python -r requirements_test.txt
uv run --no-sync pytest -W error -q
node --test "tests/frontend/*.test.mjs"
```

The last command runs the tests of the editor's pure JavaScript logic (Node 22, no
dependencies to install). The cases in `tests/frontend/cases.json` are shared with
`tests/test_frontend_parity.py`, so the editor and the server validate programs the same way.
The editor ships Lit as a single file, `frontend/lit.js`: a third-party bundle that we built
ourselves from the official npm packages (Lit 3.3.3), not a ready-made file downloaded from
somewhere; its header lists the exact packages, their integrity hashes, the build command and the
checksum of the body, which `tests/frontend/lit.test.mjs` verifies. There is no build step in this
repository: the files in `custom_components/cronotermostato/frontend/` are written by hand, not
generated or minified (CI fails if a `*.min.js` or `*.map` file appears there), and the only
third-party file is `lit.js` (license in `LICENSE-lit.txt`).

A guided manual check on a real Home Assistant is in `docs/PROVA_EDITOR_SU_HA.md` (Italian; the
integration alone: `docs/PROVA_SU_HA.md`).

The Lovelace card announces `https://github.com/alexcoscia/cronotermostato#readme` as its
documentation link in the card picker (`documentationURL`). The GitHub repository does not exist
yet, so that URL is provisional: change it in `frontend/components/crono-card.js` (and in the exact
URL that `tests/frontend/xss.test.mjs` allows) when the repository is published.

## License

MIT
