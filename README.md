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

Add the card to a dashboard (manual card):

```yaml
type: custom:user-scenes-card
title: Scenes
```

- **+ New scene:** set your lamps (native apps or HA), tick which ones to include, type a description,
  *Save current state*.
- Click a scene button to restore. ✎ opens the editor: rename, add/remove lamps, *Make a copy*, *Delete*.
- Editing keeps already-saved lamp states unless *Re-capture* is ticked; newly added lamps are captured now.

Each scene is also a `button.*` entity (usable in automations/other dashboards) and there are services
`user_scenes.save / update / copy / delete / activate`.
