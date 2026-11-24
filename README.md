# User Scenes

Home Assistant custom integration: users snapshot the current state of a chosen subset of lamps
(Hue lights, Shelly relays/switches, any `light`/`switch`), give it a description, and get a button
that restores exactly those lamps. Lamps not in the scene are never touched.

## Install

- **Manual:** copy `custom_components/user_scenes` into your HA `config/custom_components/`, restart HA.
- **HACS:** push this folder to GitHub, add it as a custom repository (type *Integration*), install, restart.

Then *Settings → Devices & services → Add integration → User Scenes* and pick the **master list**
of lamps/relays. Change it later via the integration's **Configure** button.

## Use

Add the card (*Add card → By card → User Scenes*, or manually):

```yaml
type: custom:user-scenes-card
title: Scenes      # optional
columns: 4         # tiles per row
square: false      # square tiles
show_add: true     # show the "New scene" tile
```

- **Tap** a tile to restore the scene. A tile is highlighted when the lamps currently match it.
- **Long-press** a tile (or tap **New scene**) to open the editor side panel: edit the name (pencil),
  switch lamps in/out, see the state that will be saved, **Re-capture**, **Copy**, **Delete**, **Save**.
- Editing keeps already-saved lamp states unless *Re-capture* is used; newly added lamps are captured now.

Each scene is also a `button.*` entity (usable in automations/other dashboards) and there are services
`user_scenes.save / update / copy / delete / activate`.
