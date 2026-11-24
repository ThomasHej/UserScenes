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
from homeassistant.helpers import entity_registry as er
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
        # Grid layout: scene ids in display order, "" = an empty placeholder tile
        self.layout: list[str] = []
        self._default_lock = asyncio.Lock()

    async def async_load(self) -> None:
        data = await self._store.async_load()
        self.scenes = (data or {}).get("scenes", {})
        self.layout = (data or {}).get("layout", [])

    async def _async_commit(self) -> None:
        await self._store.async_save({"scenes": self.scenes, "layout": self.layout})
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

    def members(self, entity_id: str) -> list[str]:
        """Individual lamps behind a group entity (Hue room/zone or light group).

        Returns [] when the entity is not a group or the members cannot be resolved.
        """
        if not entity_id.startswith("light."):
            return []
        state = self.hass.states.get(entity_id)
        if state is None:
            return []
        attrs = state.attributes
        ids = attrs.get("entity_id")
        if isinstance(ids, (list, tuple)) and ids:
            return [i for i in ids if isinstance(i, str) and i.startswith("light.") and i != entity_id]
        names = attrs.get("lights")
        if attrs.get("is_hue_group") and isinstance(names, (list, tuple)) and names:
            wanted = set(names)
            registry = er.async_get(self.hass)
            entry = registry.async_get(entity_id)
            platform = entry.platform if entry else "hue"
            found: dict[str, str] = {}
            for ent in registry.entities.values():
                if ent.platform != platform or ent.domain != "light" or ent.entity_id == entity_id or ent.disabled_by:
                    continue
                st = self.hass.states.get(ent.entity_id)
                if st is None or st.attributes.get("is_hue_group"):
                    continue
                name = st.attributes.get("friendly_name")
                if name in wanted:
                    found.setdefault(name, ent.entity_id)
            if len(found) == len(wanted):
                return list(found.values())
        return []

    def _uniform(self, member_ids: list[str]) -> bool:
        """True when all (available) member lamps are set identically."""
        states = [
            s
            for i in member_ids
            if (s := self.hass.states.get(i)) is not None
            and s.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)
        ]
        on = [s for s in states if s.state == STATE_ON]
        if on and len(on) != len(states):
            return False
        if not on:
            return True
        brightness = [s.attributes.get("brightness") for s in on]
        if None not in brightness and max(brightness) - min(brightness) > 10:
            return False
        colors = [s.attributes.get("rgb_color") for s in on]
        if all(colors):
            first = colors[0]
            for c in colors:
                if sum((x - y) ** 2 for x, y in zip(c, first)) ** 0.5 > 20:
                    return False
        return True

    def _snapshot_single(self, entity_id: str) -> dict[str, Any] | None:
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
        snap: dict[str, Any] = {"state": state.state, "attributes": attrs}
        # Display colour only (used by the UI icons), never used for restore
        if state.state == STATE_ON and (rgb := state.attributes.get("rgb_color")):
            snap["rgb"] = list(rgb)
        return snap

    def _snapshot(self, entity_id: str, mode: str = "auto") -> dict[str, Any] | None:
        """Snapshot an entity. Groups are stored as one entity if all members are
        identical (mode auto), or per member lamp if they differ / mode individual."""
        snap = self._snapshot_single(entity_id)
        if snap is None:
            return None
        snap["mode"] = mode
        members = self.members(entity_id)
        if len(members) >= 2 and mode != "group" and (mode == "individual" or not self._uniform(members)):
            member_snaps = {m: ms for m in members if (ms := self._snapshot_single(m)) is not None}
            if member_snaps:
                snap["members"] = member_snaps
        return snap

    def _snapshot_many(self, entity_ids: list[str], modes: dict[str, str] | None = None) -> dict[str, Any]:
        modes = modes or {}
        result: dict[str, Any] = {}
        for entity_id in entity_ids:
            if (snap := self._snapshot(entity_id, modes.get(entity_id, "auto"))) is not None:
                result[entity_id] = snap
        if not result:
            raise ServiceValidationError("None of the selected lamps could be captured")
        return result

    # --------------------------------------------------------------- operations

    async def async_save(
        self, name: str, entity_ids: list[str], group_modes: dict[str, str] | None = None
    ) -> str:
        name = name.strip()
        if not name:
            raise ServiceValidationError("Scene name is required")
        self._check_allowed(entity_ids)
        scene_id = uuid4().hex[:8]
        self.scenes[scene_id] = {
            "name": name,
            "entities": self._snapshot_many(entity_ids, group_modes),
        }
        await self._async_commit()
        return scene_id

    async def async_update(
        self,
        scene_id: str,
        name: str | None = None,
        entity_ids: list[str] | None = None,
        recapture: bool = False,
        group_modes: dict[str, str] | None = None,
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
            modes = group_modes or {}

            def mode_of(e: str) -> str:
                return modes.get(e, existing.get(e, {}).get("mode", "auto"))

            keep = [
                e
                for e in entity_ids
                if e in existing and not recapture and mode_of(e) == existing[e].get("mode", "auto")
            ]
            fresh = [e for e in entity_ids if e not in keep]
            captured = self._snapshot_many(fresh, {e: mode_of(e) for e in fresh}) if fresh else {}
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
        if len(self.scenes) <= 1:
            raise ServiceValidationError("The last scene cannot be deleted")
        del self.scenes[scene_id]
        await self._async_commit()

    async def async_reorder(self, scene_ids: list[str]) -> None:
        """Store the grid layout; "" entries are empty placeholder tiles."""
        layout = [i for i in scene_ids if i == "" or i in self.scenes]
        ordered = [i for i in layout if i]
        ordered += [i for i in self.scenes if i not in ordered]
        self.scenes = {i: self.scenes[i] for i in ordered}
        self.layout = layout
        await self._async_commit()

    async def async_ensure_default(self) -> None:
        """Create the first scene (all master-list lamps) if none exist yet."""
        async with self._default_lock:
            if self.scenes or not self.allowed:
                return
            try:
                await self.async_save("Scene 1", list(self.allowed))
            except ServiceValidationError:
                _LOGGER.debug("Default scene not created yet: lamps unavailable")

    async def async_activate(self, scene_id: str, transition: float | None = None) -> None:
        scene = self._get(scene_id)
        calls = []
        targets: dict[str, dict[str, Any]] = {}
        for entity_id, snap in scene["entities"].items():
            if snap.get("members"):
                targets.update(snap["members"])
            else:
                targets[entity_id] = snap
        for entity_id, snap in targets.items():
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
        for entity_id, result in zip(targets, results):
            if isinstance(result, Exception):
                _LOGGER.warning("Could not restore %s: %s", entity_id, result)

    @callback
    def as_list(self) -> list[dict[str, Any]]:
        return [
            {
                "id": sid,
                "name": s["name"],
                "entities": list(s["entities"]),
                "states": summarize(s["entities"]),
            }
            for sid, s in self.scenes.items()
        ]


def _brief(snap: dict[str, Any]) -> dict[str, Any]:
    brightness = snap["attributes"].get("brightness")
    return {
        "state": snap["state"],
        "brightness": round(brightness / 255 * 100) if brightness is not None else None,
        "rgb": snap.get("rgb"),
    }


def summarize(entities: dict[str, Any]) -> dict[str, Any]:
    """Compact saved state per entity (state, brightness %, colour, group mode) for the UI."""
    out: dict[str, Any] = {}
    for entity_id, snap in entities.items():
        entry = _brief(snap)
        entry["mode"] = snap.get("mode", "auto")
        if snap.get("members"):
            entry["members"] = {m: _brief(ms) for m, ms in snap["members"].items()}
        out[entity_id] = entry
    return out
