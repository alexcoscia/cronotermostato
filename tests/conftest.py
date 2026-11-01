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
    """
    import warnings

    from aiohttp.web_exceptions import NotAppKeyWarning

    warnings.filterwarnings("ignore", category=NotAppKeyWarning)
    yield
