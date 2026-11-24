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
```

- The first scene ("Scene 1", all lamps in the master list) is created automatically.
  More scenes are made with **New Duplicate** in the editor.
- **Tap** a tile to restore the scene. A tile is highlighted when the lamps currently match it.
- **Long-press** a tile to open the editor side panel (disabled while editing the dashboard):
  edit the name (pencil), switch lamps in/out, see the state/colour that will be saved,
  **Re-capture**, **New Duplicate**, **Move**, **Delete**, **Save changes**.
- **Move** puts the grid in rearrange mode: tiles wiggle and get arrows; press **Done** to keep the order.
- Hue rooms/zones and light groups get the multi-lamp icon. The last remaining scene cannot be deleted.

Each scene is also a `button.*` entity (usable in automations/other dashboards) and there are services
`user_scenes.save / update / copy / delete / activate / reorder`.
