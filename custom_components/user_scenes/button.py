"""One button entity per saved scene."""

from __future__ import annotations

from typing import Any

from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SIGNAL_SCENES_UPDATED
from .manager import SceneManager, summarize


async def async_setup_entry(
    hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback
) -> None:
    manager: SceneManager = entry.runtime_data
    known: dict[str, SceneButton] = {}

    @callback
    def _sync() -> None:
        new = [
            SceneButton(manager, sid) for sid in manager.scenes if sid not in known
        ]
        for button in new:
            known[button.scene_id] = button
        if new:
            async_add_entities(new)
        for sid in [s for s in known if s not in manager.scenes]:
            hass.async_create_task(known.pop(sid).async_remove_scene())

    _sync()
    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_SCENES_UPDATED, _sync)
    )


class SceneButton(ButtonEntity):
    """Pressing the button restores the scene."""

    _attr_should_poll = False
    _attr_icon = "mdi:lightbulb-group"

    def __init__(self, manager: SceneManager, scene_id: str) -> None:
        self._manager = manager
        self.scene_id = scene_id
        self._attr_unique_id = f"{DOMAIN}_{scene_id}"

    @property
    def name(self) -> str:
        scene = self._manager.scenes.get(self.scene_id)
        return scene["name"] if scene else self.scene_id

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        scene = self._manager.scenes.get(self.scene_id, {"entities": {}})
        return {
            "user_scenes": True,
            "scene_id": self.scene_id,
            "entities": list(scene["entities"]),
            "states": summarize(scene["entities"]),
        }

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, SIGNAL_SCENES_UPDATED, self._handle_update
            )
        )

    @callback
    def _handle_update(self) -> None:
        if self.scene_id in self._manager.scenes:
            self.async_write_ha_state()

    async def async_press(self) -> None:
        await self._manager.async_activate(self.scene_id)

    async def async_remove_scene(self) -> None:
        registry = er.async_get(self.hass)
        entity_id = self.entity_id
        await self.async_remove()
        if registry.async_get(entity_id):
            registry.async_remove(entity_id)
