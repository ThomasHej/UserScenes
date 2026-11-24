"""Scene storage, snapshot and restore logic."""

from __future__ import annotations

import asyncio
import copy
import logging
from typing import Any
from uuid import uuid4

from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import SIGNAL_SCENES_UPDATED, STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)

# light color_mode -> attribute holding the value for that mode
_COLOR_ATTR = {
    "color_temp": "color_temp_kelvin",
    "hs": "hs_color",
    "xy": "xy_color",
    "rgb": "rgb_color",
    "rgbw": "rgbw_color",
    "rgbww": "rgbww_color",
}


class SceneManager:
    """Keeps the saved scenes and applies them."""

    def __init__(self, hass: HomeAssistant, allowed: list[str]) -> None:
        self.hass = hass
        self.allowed = list(allowed)
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        # scene_id -> {"name": str, "entities": {entity_id: {"state", "attributes"}}}
        self.scenes: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load()
        self.scenes = (data or {}).get("scenes", {})

    async def _async_commit(self) -> None:
        await self._store.async_save({"scenes": self.scenes})
        async_dispatcher_send(self.hass, SIGNAL_SCENES_UPDATED)

    # ------------------------------------------------------------------ helpers

    def _get(self, scene_id: str) -> dict[str, Any]:
        if scene_id not in self.scenes:
            raise ServiceValidationError(f"Unknown scene '{scene_id}'")
        return self.scenes[scene_id]

    def _check_allowed(self, entity_ids: list[str], already: set[str] | None = None) -> None:
        already = already or set()
        bad = [e for e in entity_ids if e not in self.allowed and e not in already]
        if bad:
            raise ServiceValidationError(
                f"Not in the master lamp list: {', '.join(bad)}"
            )

    def _snapshot(self, entity_id: str) -> dict[str, Any] | None:
        state = self.hass.states.get(entity_id)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            _LOGGER.warning("Skipping %s: unavailable, cannot capture state", entity_id)
            return None
        attrs: dict[str, Any] = {}
        if entity_id.startswith("light.") and state.state == STATE_ON:
            if (brightness := state.attributes.get("brightness")) is not None:
                attrs["brightness"] = brightness
            key = _COLOR_ATTR.get(state.attributes.get("color_mode"))
            if key and (value := state.attributes.get(key)) is not None:
                attrs[key] = list(value) if isinstance(value, (tuple, list)) else value
        return {"state": state.state, "attributes": attrs}

    def _snapshot_many(self, entity_ids: list[str]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for entity_id in entity_ids:
            if (snap := self._snapshot(entity_id)) is not None:
                result[entity_id] = snap
        if not result:
            raise ServiceValidationError("None of the selected lamps could be captured")
        return result

    # --------------------------------------------------------------- operations

    async def async_save(self, name: str, entity_ids: list[str]) -> str:
        name = name.strip()
        if not name:
            raise ServiceValidationError("Scene name is required")
        self._check_allowed(entity_ids)
        scene_id = uuid4().hex[:8]
        self.scenes[scene_id] = {
            "name": name,
            "entities": self._snapshot_many(entity_ids),
        }
        await self._async_commit()
        return scene_id

    async def async_update(
        self,
        scene_id: str,
        name: str | None = None,
        entity_ids: list[str] | None = None,
        recapture: bool = False,
    ) -> None:
        """Rename and/or change the included lamps.

        Lamps already in the scene keep their saved state unless `recapture`
        is set; newly added lamps are captured from their current state.
        """
        scene = self._get(scene_id)
        if name is not None:
            if not name.strip():
                raise ServiceValidationError("Scene name is required")
            scene["name"] = name.strip()
        if entity_ids is not None:
            existing = scene["entities"]
            self._check_allowed(entity_ids, set(existing))
            keep = [e for e in entity_ids if e in existing and not recapture]
            fresh = [e for e in entity_ids if e not in keep]
            captured = self._snapshot_many(fresh) if fresh else {}
            scene["entities"] = {
                e: (existing[e] if e in keep else captured[e])
                for e in entity_ids
                if e in keep or e in captured
            }
            if not scene["entities"]:
                raise ServiceValidationError("A scene needs at least one lamp")
        await self._async_commit()

    async def async_copy(self, scene_id: str, name: str | None = None) -> str:
        scene = self._get(scene_id)
        new_id = uuid4().hex[:8]
        self.scenes[new_id] = {
            "name": (name or f"{scene['name']} (copy)").strip(),
            "entities": copy.deepcopy(scene["entities"]),
        }
        await self._async_commit()
        return new_id

    async def async_delete(self, scene_id: str) -> None:
        self._get(scene_id)
        del self.scenes[scene_id]
        await self._async_commit()

    async def async_activate(self, scene_id: str, transition: float | None = None) -> None:
        scene = self._get(scene_id)
        calls = []
        for entity_id, snap in scene["entities"].items():
            domain = entity_id.split(".")[0]
            turn_on = snap["state"] == STATE_ON
            data: dict[str, Any] = {"entity_id": entity_id}
            if domain == "light":
                service_domain, service = "light", "turn_on" if turn_on else "turn_off"
                if turn_on:
                    data.update(snap["attributes"])
                if transition is not None:
                    data["transition"] = transition
            else:
                service_domain = "homeassistant"
                service = "turn_on" if turn_on else "turn_off"
            calls.append(
                self.hass.services.async_call(
                    service_domain, service, data, blocking=True
                )
            )
        results = await asyncio.gather(*calls, return_exceptions=True)
        for entity_id, result in zip(scene["entities"], results):
            if isinstance(result, Exception):
                _LOGGER.warning("Could not restore %s: %s", entity_id, result)

    @callback
    def as_list(self) -> list[dict[str, Any]]:
        return [
            {"id": sid, "name": s["name"], "entities": list(s["entities"])}
            for sid, s in self.scenes.items()
        ]
