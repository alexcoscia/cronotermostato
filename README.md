# Cronotermostato

Home Assistant custom integration (HACS): reusable weekly thermostat programs
(time slots with mode and temperature, plus a holiday day chosen by country),
assigned to any number of `climate` entities ("rooms"), with a manual override.

Status: version 0.1.0, not yet tested on a live Home Assistant. This is part 1 of 3
(the integration); the in-HA editor and the Tessera tile are separate projects.

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

```yaml
action: cronotermostato.create_program
data:
  name: Casa
  week:
    - [{start: "06:30", end: "08:00", mode: heat, temperature: 20.5},
       {start: "17:00", end: "22:30", mode: heat, temperature: 21}]
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

Forces a mode and temperature **until the end of the current slot**. Fields:
`climate_entity_id`, `mode` (`heat`, `cool`, `off`), `temperature` (required for
`heat`/`cool`, ignored for `off`).

```yaml
action: cronotermostato.set_manual
data:
  climate_entity_id: climate.soggiorno
  mode: heat
  temperature: 22
```

### `cronotermostato.resume_auto`

Drops the override and applies the current slot. Field: `climate_entity_id`.

```yaml
action: cronotermostato.resume_auto
data:
  climate_entity_id: climate.soggiorno
```

Room services fail with an error if the room is not assigned; invalid programs
fail with an `invalid_program` error that says what is wrong.

## Entities

For each assigned room (one device per room; entity ids use the room name, in Italian):

- `sensor.<room>_programma`: state is the name of the program. Attributes: `slot` and
  `next_slot` (`start`, `end`, `mode`, `temperature`, `auto`), `slot_end`, `manual`,
  `override_until`, `auto_slot`, `holiday` (today is a holiday), `status`.
  `status` is one of `ok`, `paused`, `unavailable`, `unsupported_mode`, `missing`,
  `error`.
- `switch.<room>_automatico`: on while the room follows its program. Turning it off
  forces the current slot's setting until the slot ends; turning it on goes back to
  the program.

For each program:

- `sensor.programma_<program_id>`: state is the number of rooms using it. Attributes:
  `program_id`, `name`, `week`, `holiday` (what you saved), `week_full`,
  `holiday_full` (with the automatic `off` slots), `rooms`.

Entities appear and disappear as rooms and programs are created and removed.

## WebSocket API

For the editor (read-only or pure; open to every authenticated user):

- `cronotermostato/state`: programs (`week`, `holiday`, `week_full`, `holiday_full`),
  rooms (`climate_entity_id`, `name`, `program_id`, `program_name`, `paused`,
  `status`, `slot`, `next_slot`, `manual`, `override_until`, `holiday`), `country`,
  `subdiv`. Error `not_loaded` if the integration is not loaded.
- `cronotermostato/preview_day` with `bands`: validates the slots of one day and
  returns them with the automatic `off` slots.
- `cronotermostato/countries`: country code -> list of region codes.

Changes to programs are made only with the services.

## Behaviour

- Commands are sent (first the mode, then the temperature) at a slot change if the
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
- Holidays come from the `holidays` library for the chosen country and region.
- Daylight saving time: a time that does not exist (29 March in Italy) moves to the
  hour of the change; a repeated time (25 October) means its first occurrence.

## Coexisting with the HACS Scheduler

This integration does not read, change or disable the Scheduler. Both can drive the
same house; the sensible way to migrate is room by room: remove a room from the
Scheduler yourself, then assign it here. Never leave the same thermostat in both, or
the two will overwrite each other.

## Known limits

- Slots have no temperature limit. If the thermostat rejects a value outside its
  range, the room goes to status `error`.
- After `error` there is no retry until the next slot change, until the thermostat
  comes back, or until an explicit action (assign, resume, resume_auto, program edit).
- An override whose command never went out (Home Assistant stopped right after saving
  it) is not re-sent after the restart.
- The temperature selector of `set_manual` in `services.yaml` shows 5-35, but the schema
  does not enforce these limits (consistent with slots having no limit).
- Program names are at most 100 characters; ids are slugs of at most 50 characters.
- `cronotermostato/state` is readable by every authenticated user.
- Only one configuration entry; one program per room.
- No icon/brand image yet (HACS asks for `brand/icon.png`).

## Development

```
uv venv --python 3.14 .venv
uv pip install --python .venv/bin/python -r requirements_test.txt
uv run pytest
```

## License

MIT
