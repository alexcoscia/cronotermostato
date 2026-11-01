# Cronotermostato

Home Assistant custom integration (HACS): reusable weekly thermostat programs
(time slots with mode and temperature, holidays per country), assigned to
multiple `climate` rooms, with manual override.

Status: under development (0.1.0, work in progress).

## Development

```
uv venv --python 3.14 .venv
uv pip install --python .venv/bin/python -r requirements_test.txt
uv run pytest
```

## License

MIT
