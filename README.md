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
- **Tap** a tile to restore the scene.
- **Long-press** a tile (disabled while editing the dashboard) to get a menu:
  - **Activate and Edit Scene** - restores the scene, then opens the editor side panel: edit the name (pencil),
    switch lamps in/out, adjust lamps anywhere (HA, Hue app, ...). Everything you see is what **Save** stores
    (auto-capture). Each lamp shows **Saved** (unchanged) or **Changed** (differs from the saved scene, or was added/removed).
    Also: **New Duplicate**, **Delete**.
  - **Reorder Scenes** - rumble mode: drag scenes (and, with `fill_empty`, the empty tiles) to change position,
    press **Done** when finished.
  - **Create new Scene** - opens the editor with a blank scene (all lamps off); enter a name, switch on the
    lamps to include and save.
  - **Delete Scene** - deletes the scene (the last remaining scene cannot be deleted).

Scenes are stored in `config/.storage/user_scenes.scenes`, so they are included in normal Home Assistant backups.
- **Groups (Hue rooms/zones, light groups):** each group row has a mode button.
  *Auto* saves the group as one if all its lamps are set identically, otherwise each lamp individually;
  *Individual* always saves per lamp; *As group* always saves the group. The row shows which will happen and, when expanded, lists each lamp with its colour/brightness.
  The members are resolved from the group's attributes (`entity_id`, or the Hue `lights` names).
- In the editor, long-press a lamp icon or name to open that lamp's advanced (more-info) dialog.
- In the editor, groups are listed first, then lamps/switches alphabetically. Hue rooms/zones and light groups get the multi-lamp icon. The last remaining scene cannot be deleted.

Each scene is also a `button.*` entity (usable in automations/other dashboards) and there are services
`user_scenes.save / update / copy / delete / activate / reorder`.
