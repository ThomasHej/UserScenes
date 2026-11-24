"""User Scenes: save and restore selected lamps/relays as named scenes."""

from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_ENTITIES,
    DOMAIN,
    FRONTEND_URL,
    SERVICE_ACTIVATE,
    SERVICE_COPY,
    SERVICE_DELETE,
    SERVICE_REORDER,
    SERVICE_SAVE,
    SERVICE_UPDATE,
    VERSION,
)
from .manager import SceneManager

PLATFORMS = ["button"]

type UserScenesConfigEntry = ConfigEntry[SceneManager]


def _manager(hass: HomeAssistant) -> SceneManager:
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is ConfigEntryState.LOADED:
            return entry.runtime_data
    raise ServiceValidationError("User Scenes is not set up")


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register frontend card, websocket API and services (once)."""
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                FRONTEND_URL,
                str(Path(__file__).parent / "www" / "user-scenes-card.js"),
                False,
            )
        ]
    )
    frontend.add_extra_js_url(hass, f"{FRONTEND_URL}?v={VERSION}")
    websocket_api.async_register_command(hass, ws_list)

    async def save(call: ServiceCall) -> dict:
        scene_id = await _manager(hass).async_save(
            call.data["name"], call.data["entities"]
        )
        return {"scene_id": scene_id}

    async def update(call: ServiceCall) -> None:
        await _manager(hass).async_update(
            call.data["scene_id"],
            call.data.get("name"),
            call.data.get("entities"),
            call.data["recapture"],
        )

    async def copy_scene(call: ServiceCall) -> dict:
        scene_id = await _manager(hass).async_copy(
            call.data["scene_id"], call.data.get("name")
        )
        return {"scene_id": scene_id}

    async def delete(call: ServiceCall) -> None:
        await _manager(hass).async_delete(call.data["scene_id"])

    async def reorder(call: ServiceCall) -> None:
        await _manager(hass).async_reorder(call.data["scene_ids"])

    async def activate(call: ServiceCall) -> None:
        await _manager(hass).async_activate(
            call.data["scene_id"], call.data.get("transition")
        )

    sid = {vol.Required("scene_id"): cv.string}
    hass.services.async_register(
        DOMAIN,
        SERVICE_SAVE,
        save,
        vol.Schema(
            {vol.Required("name"): cv.string, vol.Required("entities"): cv.entity_ids}
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_UPDATE,
        update,
        vol.Schema(
            {
                **sid,
                vol.Optional("name"): cv.string,
                vol.Optional("entities"): cv.entity_ids,
                vol.Optional("recapture", default=False): cv.boolean,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_COPY,
        copy_scene,
        vol.Schema({**sid, vol.Optional("name"): cv.string}),
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(DOMAIN, SERVICE_DELETE, delete, vol.Schema(sid))
    hass.services.async_register(
        DOMAIN,
        SERVICE_REORDER,
        reorder,
        vol.Schema({vol.Required("scene_ids"): [cv.string]}),
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_ACTIVATE,
        activate,
        vol.Schema({**sid, vol.Optional("transition"): vol.Coerce(float)}),
    )
    return True


@websocket_api.websocket_command({vol.Required("type"): "user_scenes/list"})
@websocket_api.async_response
async def ws_list(hass: HomeAssistant, connection, msg) -> None:
    """Return the master lamp list and all scenes to the card."""
    try:
        manager = _manager(hass)
    except ServiceValidationError as err:
        connection.send_error(msg["id"], "not_loaded", str(err))
        return
    await manager.async_ensure_default()
    connection.send_result(
        msg["id"],
        {
            "allowed": manager.allowed,
            "scenes": manager.as_list(),
            "layout": manager.layout,
        },
    )


async def async_setup_entry(hass: HomeAssistant, entry: UserScenesConfigEntry) -> bool:
    manager = SceneManager(hass, entry.options.get(CONF_ENTITIES, []))
    await manager.async_load()
    entry.runtime_data = manager
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: UserScenesConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: UserScenesConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
