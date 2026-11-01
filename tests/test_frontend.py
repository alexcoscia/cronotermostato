"""Tests for the static files and the module URL of the editor."""

from yarl import URL

from homeassistant.loader import async_get_integration
from homeassistant.setup import async_setup_component

from custom_components.cronotermostato.const import DOMAIN, STATIC_URL_BASE
from custom_components.cronotermostato.frontend import async_module_url


async def _base(hass):
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    version = (await async_get_integration(hass, DOMAIN)).version
    return f"{STATIC_URL_BASE}/{version}"


async def test_static_file_served(hass, hass_client):
    base = await _base(hass)
    client = await hass_client()
    resp = await client.get(f"{base}/cronotermostato.js")
    assert resp.status == 200
    assert "javascript" in resp.headers["Content-Type"]
    assert "Cronotermostato" in await resp.text()

    assert (await client.get(f"{base}/missing.js")).status == 404


async def test_static_path_traversal(hass, hass_client):
    base = await _base(hass)
    client = await hass_client()
    # encoded=True keeps the client from normalising the dots away.
    for tail in (
        "../manifest.json",
        "%2e%2e/manifest.json",
        "%2E%2E%2Fmanifest.json",
        "..%2fmanifest.json",
        "....//manifest.json",
        "sub/../../manifest.json",
    ):
        resp = await client.get(URL(f"{base}/{tail}", encoded=True))
        assert resp.status in (400, 403, 404), (tail, resp.status)
        assert "domain" not in await resp.text(), tail


async def test_static_registered_once(hass, hass_client):
    await _base(hass)
    # A second setup pass must not try to register the path again.
    from custom_components.cronotermostato.frontend import async_register_static

    await async_register_static(hass)
    client = await hass_client()
    assert (await client.get(await async_module_url(hass))).status == 200


async def test_module_url_has_version(hass):
    version = (await async_get_integration(hass, DOMAIN)).version
    assert await async_module_url(hass) == (
        f"{STATIC_URL_BASE}/{version}/cronotermostato.js"
    )
