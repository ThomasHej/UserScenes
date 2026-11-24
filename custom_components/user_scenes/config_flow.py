"""Config flow: pick the master list of lamps/relays users can choose from."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import EntitySelector, EntitySelectorConfig

from .const import ALLOWED_DOMAINS, CONF_ENTITIES, DOMAIN


def _schema(default: list[str]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(CONF_ENTITIES, default=default): EntitySelector(
                EntitySelectorConfig(domain=ALLOWED_DOMAINS, multiple=True)
            )
        }
    )


class UserScenesConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(
                title="User Scenes", data={}, options=user_input
            )
        return self.async_show_form(step_id="user", data_schema=_schema([]))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry) -> OptionsFlow:
        return UserScenesOptionsFlow()


class UserScenesOptionsFlow(OptionsFlow):
    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=_schema(self.config_entry.options.get(CONF_ENTITIES, [])),
        )
