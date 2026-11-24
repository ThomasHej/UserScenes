"""Constants for User Scenes."""

DOMAIN = "user_scenes"
VERSION = "0.6.0"

CONF_ENTITIES = "entities"

STORAGE_KEY = f"{DOMAIN}.scenes"
STORAGE_VERSION = 1

SIGNAL_SCENES_UPDATED = f"{DOMAIN}_scenes_updated"

ALLOWED_DOMAINS = ["light", "switch"]

FRONTEND_URL = f"/{DOMAIN}_static/user-scenes-card.js"

SERVICE_SAVE = "save"
SERVICE_UPDATE = "update"
SERVICE_COPY = "copy"
SERVICE_DELETE = "delete"
SERVICE_ACTIVATE = "activate"
SERVICE_REORDER = "reorder"
