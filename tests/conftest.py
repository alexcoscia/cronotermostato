"""Shared fixtures for the cronotermostato tests."""

import pytest


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Allow Home Assistant to load the custom integration under test."""
    yield


@pytest.fixture(autouse=True)
def ignore_core_http_app_key_warning():
    """Ignore a warning raised by Home Assistant's own ``http`` component.

    The manifest depends on ``websocket_api``, which sets up ``http``; with
    ``-W error`` aiohttp's NotAppKeyWarning from core would fail every setup.
    The filter is added inside pytest's per-test warning context.

    Why a fixture and not ``filterwarnings`` in ``pyproject.toml``: a ``-W error``
    given on the command line is applied after (and so overrides) the ini
    filters, and the ini ``ignore`` would then not help; a filter installed
    inside the test does take precedence. Kept narrow: only this message.
    """
    import warnings

    from aiohttp.web_exceptions import NotAppKeyWarning

    warnings.filterwarnings(
        "ignore",
        message="It is recommended to use web\\.(AppKey|RequestKey) instances",
        category=NotAppKeyWarning,
    )
    yield
