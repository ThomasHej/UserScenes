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
title: Scenes        # optional
columns: 4           # tiles per row
square: false        # square tiles
fill_empty: false    # pad the last row with empty tiles so every row is full
show_state: false    # show "Active" / "Off" under the name (Aktiveret / Fra on Danish HA)
state_on: Active     # optional custom texts
state_off: Off
icon_mode: state     # static | state | scene_color | scene_color_always
```

A scene counts as *active* when every included lamp currently matches it (on/off, brightness and colour).
It is re-evaluated on every state change.

- The first scene ("Scene 1", all lamps in the master list) is created automatically.
  More scenes are made with **New Duplicate** in the editor.
- **Tap** a tile to restore the scene.
- **Long-press** a tile (disabled while editing the dashboard) to enter rumble mode:
  click a scene to open its editor, drag scenes (and, with `fill_empty`, the empty tiles) to change position, press **Done** when finished.
- The editor side panel: edit the name (pencil), switch lamps in/out, see the state/colour that will be saved,
  **Re-capture**, **New Duplicate**, **Delete**, **Save changes**.
- In the editor, groups are listed first, then lamps/switches alphabetically. Hue rooms/zones and light groups get the multi-lamp icon. The last remaining scene cannot be deleted.

Each scene is also a `button.*` entity (usable in automations/other dashboards) and there are services
`user_scenes.save / update / copy / delete / activate / reorder`.
