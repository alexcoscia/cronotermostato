"""Public holiday lookup by country and subdivision (no Home Assistant imports)."""

from __future__ import annotations

from datetime import date

import holidays


def supported_countries() -> dict[str, list[str]]:
    """Return country code -> sorted subdivision codes (empty if none)."""
    supported = holidays.list_supported_countries(include_aliases=False)
    return {country: sorted(subdivs) for country, subdivs in sorted(supported.items())}


class HolidayCalendar:
    """Tells whether a date is a public holiday, caching one year at a time."""

    def __init__(self, country: str, subdiv: str | None = None) -> None:
        self.country = country
        self.subdiv = subdiv
        self._years: dict[int, frozenset[date]] = {}
        try:
            holidays.country_holidays(country, subdiv=subdiv, years=date.today().year)
        except NotImplementedError as err:
            raise ValueError(
                f"Unsupported country or subdivision: {country!r}/{subdiv!r}"
            ) from err

    def is_holiday(self, d: date) -> bool:
        days = self._years.get(d.year)
        if days is None:
            days = frozenset(
                holidays.country_holidays(
                    self.country, subdiv=self.subdiv, years=d.year
                )
            )
            self._years[d.year] = days
        return d in days
