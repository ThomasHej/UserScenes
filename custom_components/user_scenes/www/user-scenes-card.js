/* User Scenes card
 * - Tile grid of scenes (configurable columns / square tiles), auto-filled from saved scenes.
 * - Tap = activate scene, long-press = menu (not while editing the dashboard):
 *   Activate and Edit Scene / Reorder Scenes (rumble mode, drag tiles) / Create new Scene / Delete Scene.
 */
const US_DOMAIN = "user_scenes";
const LONG_PRESS_MS = 500;
const EDIT_TAGS = ["HUI-CARD-EDIT-MODE", "HUI-CARD-OPTIONS", "HUI-CARD-PREVIEW", "HUI-DIALOG-EDIT-CARD", "HUI-DIALOG-SUGGEST-CARD"];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Hue rooms/zones (and generic light groups) get the "multi lamp" icon
const isGroup = (hass, eid) => {
  const a = hass.states[eid]?.attributes || {};
  return a.is_hue_group === true || a.hue_type !== undefined || Array.isArray(a.entity_id);
};

const lampIcon = (hass, eid, on) => {
  if (eid.startsWith("switch.")) return on ? "mdi:toggle-switch" : "mdi:toggle-switch-off-outline";
  if (isGroup(hass, eid)) return on ? "mdi:lightbulb-group" : "mdi:lightbulb-group-outline";
  return on ? "mdi:lightbulb" : "mdi:lightbulb-outline";
};

const MODE_LABEL = { auto: "Auto", individual: "Individual", group: "As group" };

// Are all (available) member lamps of a group set identically? (mirrors the backend test)
const uniform = (hass, ids) => {
  const sts = ids.map((i) => hass.states[i]).filter((x) => x && !["unavailable", "unknown"].includes(x.state));
  const on = sts.filter((x) => x.state === "on");
  if (on.length && on.length !== sts.length) return false;
  if (!on.length) return true;
  const b = on.map((x) => x.attributes.brightness);
  if (!b.some((v) => v == null) && Math.max(...b) - Math.min(...b) > 10) return false;
  const c = on.map((x) => x.attributes.rgb_color);
  if (c.every(Boolean)) {
    for (const x of c) if (Math.hypot(x[0] - c[0][0], x[1] - c[0][1], x[2] - c[0][2]) > 20) return false;
  }
  return true;
};

// Does the live state of an entity match a saved summary (on/off, brightness, colour; expanded groups per lamp)?
const matchEntity = (hass, eid, v) => {
  if (v.members) return Object.entries(v.members).every(([m, mv]) => matchEntity(hass, m, mv));
  const st = hass.states[eid];
  if (!st || st.state !== v.state) return false;
  if (v.state !== "on") return true;
  const b = st.attributes.brightness;
  if (v.brightness != null && b != null && Math.abs(Math.round((b / 255) * 100) - v.brightness) > 3) return false;
  const c = st.attributes.rgb_color;
  if (v.rgb && c && Math.hypot(c[0] - v.rgb[0], c[1] - v.rgb[1], c[2] - v.rgb[2]) > 30) return false;
  return true;
};

const friendly = (hass, eid) => hass.states[eid]?.attributes.friendly_name || eid;

async function usCall(hass, service, data, response = false) {
  if (!response) return hass.callService(US_DOMAIN, service, data);
  const r = await hass.callWS({
    type: "call_service",
    domain: US_DOMAIN,
    service,
    service_data: data,
    return_response: true,
  });
  return r.response;
}

/* ------------------------------------------------------------------ editor */

class UserScenesEditor extends HTMLElement {
  open({ hass, card, allowed, scene }) {
    this._hass = hass;
    this._card = card;
    this._id = scene?.id || null; // null = brand new, blank scene
    this._name = scene?.name || "";
    this._saved = scene?.states || {};
    this._selected = new Set(scene?.entities || []);
    this._editName = !scene;
    const orphans = (scene?.entities || []).filter((e) => !allowed.includes(e));
    this._rows = [...allowed, ...orphans].sort(
      (a, b) =>
        Number(isGroup(hass, b)) - Number(isGroup(hass, a)) ||
        friendly(hass, a).localeCompare(friendly(hass, b), undefined, { numeric: true, sensitivity: "base" })
    );
    this._allowed = allowed;
    this._many = (card._data?.scenes.length || 0) > 1;
    this._groups = card._data?.groups || {}; // group entity -> member lamps
    this._savedModes = {};
    this._modes = {};
    for (const eid of this._rows) {
      this._savedModes[eid] = this._saved[eid]?.mode || "auto";
      this._modes[eid] = this._savedModes[eid];
    }

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { position: fixed; inset: 0; z-index: 100; display: block;
                font-family: var(--primary-font-family, Roboto, sans-serif); }
        .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
        .panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(440px, 100vw);
                 display: flex; flex-direction: column; box-sizing: border-box;
                 background: var(--card-background-color, #fff); color: var(--primary-text-color);
                 box-shadow: -4px 0 16px rgba(0,0,0,.3); animation: slide .2s ease-out;
                 padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
        @keyframes slide { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
        #head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 4px; }
        #head h2 { flex: 1; margin: 0; font-size: 1.4em; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #head input { flex: 1; font: inherit; font-size: 1.2em; padding: 8px; min-width: 0;
                      background: var(--secondary-background-color); color: var(--primary-text-color);
                      border: none; border-bottom: 2px solid var(--primary-color); border-radius: 4px 4px 0 0; }
        .ib { background: none; border: none; cursor: pointer; color: var(--primary-text-color);
              border-radius: 50%; width: 40px; height: 40px; padding: 0; display: grid; place-items: center; }
        .ib:hover { background: var(--secondary-background-color); }
        #info { padding: 4px 20px 8px; color: var(--secondary-text-color); font-size: .9em; line-height: 1.4; }
        #info p { margin: 6px 0; }
        #list { flex: 1; overflow-y: auto; border-top: 1px solid var(--divider-color); }
        .row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 10px 20px; border-bottom: 1px solid var(--divider-color); }
        .row ha-icon { --mdc-icon-size: 28px; color: var(--disabled-text-color); flex: none; cursor: pointer;
                       -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
        .row ha-icon.on { color: var(--state-light-active-color, #ffc107); }
        .row .nm { flex: 1; min-width: 0; }
        .row .nm div:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row .sub { font-size: .8em; color: var(--secondary-text-color); }
        .chip { font: inherit; font-size: .75em; padding: 4px 10px; border-radius: 12px; flex: none; cursor: pointer;
                border: 1px solid var(--divider-color); background: var(--secondary-background-color); color: var(--primary-text-color); }
        .row .nm { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; cursor: pointer; }
        .mem { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 6px; padding: 0 0 2px 44px; margin-top: -6px; }
        .pill { display: inline-flex; align-items: center; gap: 6px; font-size: .78em; padding: 3px 9px; border-radius: 12px;
                background: var(--secondary-background-color); color: var(--primary-text-color); }
        .pill .dot { width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--divider-color); flex: none; }
        .st.saved { color: var(--secondary-text-color); }
        .st.changed { color: var(--warning-color, #ff9800); font-weight: 500; }
        .row.off .nm div:first-child { color: var(--secondary-text-color); }
        .row.off ha-icon { opacity: .45; }
        #foot { padding: 12px 16px; border-top: 1px solid var(--divider-color); display: flex; flex-wrap: wrap; gap: 8px; }
        #foot .hint { flex-basis: 100%; font-size: .85em; color: var(--secondary-text-color); }
        button.b { font: inherit; cursor: pointer; padding: 8px 14px; border-radius: 8px; display: inline-flex; gap: 6px; align-items: center;
                   background: var(--secondary-background-color); color: var(--primary-text-color); border: 1px solid var(--divider-color); }
        button.b.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
        button.b.on { border-color: var(--primary-color); color: var(--primary-color); }
        button.b.danger { color: var(--error-color); }
        button.b ha-icon { --mdc-icon-size: 18px; }
      </style>
      <div class="backdrop" data-action="close"></div>
      <div class="panel">
        <div id="head"></div>
        <div id="info">
          <p>Select the lights/lamps you want to include in this scene.</p>
          <p>The scene was activated when you opened this dialog. Adjust the lamps here, in Home Assistant or in the native apps:
             the icons show their live state, and exactly what you see is saved when you press <b>Save</b>.</p>
          <p><b>Saved</b> = unchanged since the scene was saved. <b>Changed</b> = differs from the saved scene
             (a lamp was changed, added or removed). Lamps that are not selected are never touched.</p>
          <p>Long-press a lamp icon or name to open that lamp's advanced dialog.</p>
        </div>
        <div id="list"></div>
        <div id="foot"></div>
      </div>`;

    root.addEventListener("click", (e) => this._onClick(e));
    root.addEventListener("change", (e) => this._onChange(e));
    root.addEventListener("input", (e) => {
      if (e.target.id === "name") this._name = e.target.value;
    });
    root.addEventListener("keydown", (e) => {
      if (e.target.id === "name" && e.key === "Enter") this._nameDone();
    });
    this._key = (e) => e.key === "Escape" && this.close();
    document.addEventListener("keydown", this._key);

    // long-press on a lamp icon -> HA's more-info dialog for that entity
    root.addEventListener("pointerdown", (e) => {
      const hit = e
        .composedPath()
        .find((n) => n.parentElement?.classList?.contains("row") && (n.tagName === "HA-ICON" || n.classList?.contains("nm")));
      if (!hit) return;
      const eid = hit.parentElement.dataset.eid;
      clearTimeout(this._lpTimer);
      this._lpTimer = setTimeout(() => {
        this._card.dispatchEvent(
          new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: eid } })
        );
      }, 500);
    });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
      root.addEventListener(ev, () => clearTimeout(this._lpTimer));
    }
    root.addEventListener("contextmenu", (e) => {
      if (e.composedPath().some((n) => n.parentElement?.classList?.contains("row") && (n.tagName === "HA-ICON" || n.classList?.contains("nm"))))
        e.preventDefault();
    });

    this._renderHead();
    root.getElementById("list").innerHTML = this._rows
      .map(
        (eid) => `<div class="row" data-eid="${esc(eid)}">
          <ha-icon></ha-icon>
          <div class="nm"><div>${esc(friendly(hass, eid))}${this._allowed.includes(eid) ? "" : " (not in master list)"}</div><div class="sub"></div></div>
          ${(this._groups[eid] || []).length >= 2 ? `<button class="chip" data-action="mode" data-eid="${esc(eid)}"></button>` : ""}
          <ha-switch></ha-switch>${(this._groups[eid] || []).length >= 2 ? `<div class="mem"></div>` : ""}</div>`
      )
      .join("");
    this._renderFoot();
    this._refreshRows();
  }

  setHass(hass) {
    this._hass = hass;
    this._refreshRows();
  }

  close() {
    document.removeEventListener("keydown", this._key);
    this.remove();
  }

  // What will be stored for a lamp if Save is pressed now (null = not included).
  // The editor auto-captures: everything shown is the live state.
  _effective(eid) {
    return this._selected.has(eid) ? { ...this._current(eid) } : null;
  }

  // saved = identical to the stored scene, changed = differs, none = never part of the scene
  _status(eid) {
    const sv = this._saved[eid];
    if (!this._selected.has(eid)) return sv ? "changed" : "none";
    if (!this._id) return "new";
    if (!sv) return "changed";
    if (this._modes[eid] !== this._savedModes[eid]) return "changed";
    let same = matchEntity(this._hass, eid, sv);
    const members = this._groups[eid] || [];
    if (same && !sv.members && members.length >= 2 && this._modes[eid] !== "group" && !uniform(this._hass, members)) same = false;
    return same ? "saved" : "changed";
  }

  _current(eid) {
    const s = this._hass.states[eid];
    if (!s || ["unavailable", "unknown"].includes(s.state)) return { state: "unavailable", brightness: null, rgb: null };
    const b = s.attributes.brightness;
    return {
      state: s.state,
      brightness: b != null ? Math.round((b / 255) * 100) : null,
      rgb: s.state === "on" ? s.attributes.rgb_color || null : null,
    };
  }

  _refreshRows() {
    const root = this.shadowRoot;
    for (const row of root.querySelectorAll(".row")) {
      const eid = row.dataset.eid;
      const eff = this._effective(eid);
      const v = eff || this._current(eid);
      const on = v.state === "on";
      const icon = row.querySelector("ha-icon");
      icon.setAttribute("icon", lampIcon(this._hass, eid, on));
      icon.classList.toggle("on", on && !!eff);
      // Realistic colour (like the Hue app): actual colour + brightness
      if (on && eff && v.rgb) {
        icon.style.color = `rgb(${v.rgb.join(",")})`;
        icon.style.opacity = String(0.5 + (0.5 * (v.brightness ?? 100)) / 100);
      } else {
        icon.style.color = "";
        icon.style.opacity = "";
      }
      row.classList.toggle("off", !eff);
      let desc = "Not included";
      if (eff) desc = v.state === "unavailable" ? "Unavailable – will be skipped" : on ? "On" + (v.brightness != null ? ` · ${v.brightness}%` : "") : "Off";
      const members = this._groups[eid] || [];
      const chip = row.querySelector(".chip");
      const mem = row.querySelector(".mem");
      let indiv = false;
      if (chip) {
        chip.textContent = MODE_LABEL[this._modes[eid]];
        chip.title = "Auto: saved as the group if all lamps are identical, otherwise each lamp individually. Individual: always per lamp. As group: always the group.";
        chip.style.display = eff ? "" : "none";
        if (eff && v.state !== "unavailable") {
          indiv = this._modes[eid] === "individual" || (this._modes[eid] === "auto" && !uniform(this._hass, members));
          desc += indiv ? ` · ${members.length} lamps individually` : " · as group";
        }
      }
      if (mem) {
        if (eff && indiv) {
          mem.innerHTML = members
            .map((id) => ({ id, ...this._current(id) }))
            .map((x) => {
              const mon = x.state === "on";
              const col = mon ? (x.rgb ? `rgb(${x.rgb.join(",")})` : "var(--state-light-active-color, #ffc107)") : "var(--disabled-text-color)";
              const txt = mon ? (x.brightness != null ? ` ${x.brightness}%` : "") : x.state === "off" ? " off" : " n/a";
              return `<span class="pill"><span class="dot" style="background:${col}"></span>${esc(friendly(this._hass, x.id))}${txt}</span>`;
            })
            .join("");
          mem.style.display = "";
        } else {
          mem.innerHTML = "";
          mem.style.display = "none";
        }
      }
      const st = this._status(eid);
      const label = { saved: "Saved", changed: "Changed" }[st];
      row.querySelector(".sub").innerHTML = esc(desc) + (label ? ` · <span class="st ${st}">${label}</span>` : "");
      const sw = row.querySelector("ha-switch");
      if (sw.checked !== !!eff) sw.checked = !!eff;
    }
  }

  _renderHead() {
    const root = this.shadowRoot;
    const title = this._editName
      ? `<input id="name" type="text" placeholder="Scene name" value="${esc(this._name)}">
         <button class="ib" data-action="name-done" title="OK"><ha-icon icon="mdi:check"></ha-icon></button>`
      : `<h2>${esc(this._name)}</h2>
         <button class="ib" data-action="name-edit" title="Edit name"><ha-icon icon="mdi:pencil"></ha-icon></button>`;
    root.getElementById("head").innerHTML =
      `<button class="ib" data-action="close" title="Close"><ha-icon icon="mdi:arrow-left"></ha-icon></button>${title}`;
    if (this._editName) {
      const input = root.getElementById("name");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  _renderFoot() {
    const isNew = !this._id;
    this.shadowRoot.getElementById("foot").innerHTML = isNew
      ? `<button class="b primary" data-action="save">Save new scene</button>
         <button class="b" data-action="close">Cancel</button>`
      : `
      <button class="b primary" data-action="save">Save changes</button>
      <button class="b" data-action="copy"><ha-icon icon="mdi:content-copy"></ha-icon>New Duplicate</button>
      ${this._many ? `<button class="b danger" data-action="delete"><ha-icon icon="mdi:delete"></ha-icon>Delete</button>` : ""}
      <button class="b" data-action="close">Cancel</button>`;
  }

  _nameDone() {
    if (!this._name.trim()) return;
    this._editName = false;
    this._renderHead();
  }

  _onChange(e) {
    const row = e.target.closest?.(".row");
    if (!row || e.target.tagName !== "HA-SWITCH") return;
    const eid = row.dataset.eid;
    e.target.checked ? this._selected.add(eid) : this._selected.delete(eid);
    this._refreshRows();
  }

  async _onClick(e) {
    const btn = e.composedPath().find((n) => n.dataset?.action);
    if (!btn) return;
    try {
      switch (btn.dataset.action) {
        case "close":
          this.close();
          break;
        case "name-edit":
          this._editName = true;
          this._renderHead();
          break;
        case "name-done":
          this._nameDone();
          break;
        case "mode": {
          const order = ["auto", "individual", "group"];
          const eid = btn.dataset.eid;
          this._modes[eid] = order[(order.indexOf(this._modes[eid]) + 1) % order.length];
          this._refreshRows();
          break;
        }
        case "save": {
          const name = this._name.trim();
          const entities = this._rows.filter((x) => this._selected.has(x));
          if (!name) {
            this._editName = true;
            this._renderHead();
            return alert("Please enter a description for the scene.");
          }
          if (!entities.length) return alert("Select at least one lamp.");
          const group_modes = {};
          for (const x of entities) if ((this._groups[x] || []).length >= 2) group_modes[x] = this._modes[x];
          if (this._id) await usCall(this._hass, "update", { scene_id: this._id, name, entities, recapture: true, group_modes });
          else await usCall(this._hass, "save", { name, entities, group_modes });
          await this._card._load();
          this.close();
          break;
        }
        case "copy": {
          const r = await usCall(this._hass, "copy", { scene_id: this._id, name: `${this._name.trim()} (copy)` }, true);
          await this._card._load();
          this.close();
          this._card._edit(r.scene_id);
          break;
        }
        case "delete":
          if (!confirm(`Delete scene "${this._name}"?`)) return;
          await usCall(this._hass, "delete", { scene_id: this._id });
          await this._card._load();
          this.close();
          break;
      }
    } catch (err) {
      alert(err.message || String(err));
    }
  }
}

/* -------------------------------------------------------------------- menu */

class UserScenesMenu extends HTMLElement {
  open({ card, id, name }) {
    const many = (card._data?.scenes.length || 0) > 1;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
                font-family: var(--primary-font-family, Roboto, sans-serif); }
        .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
        .dlg { position: relative; width: min(340px, 90vw); padding: 8px 0; border-radius: 16px;
               background: var(--card-background-color, #fff); color: var(--primary-text-color);
               box-shadow: 0 8px 32px rgba(0,0,0,.4); animation: pop .15s ease-out; }
        @keyframes pop { from { transform: scale(.92); opacity: 0; } to { transform: none; opacity: 1; } }
        h3 { margin: 0; padding: 14px 20px 8px; font-weight: 500; font-size: 1.1em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button { display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 20px; font: inherit; text-align: left;
                 background: none; border: none; color: inherit; cursor: pointer; }
        button:hover { background: var(--secondary-background-color); }
        ha-icon { color: var(--secondary-text-color); }
        button.danger, button.danger ha-icon { color: var(--error-color); }
      </style>
      <div class="backdrop" data-a="close"></div>
      <div class="dlg">
        <h3>${esc(name)}</h3>
        <button data-a="edit"><ha-icon icon="mdi:pencil"></ha-icon>Activate and Edit Scene</button>
        <button data-a="reorder"><ha-icon icon="mdi:swap-horizontal"></ha-icon>Reorder Scenes</button>
        <button data-a="new"><ha-icon icon="mdi:plus"></ha-icon>Create new Scene</button>
        ${many ? `<button class="danger" data-a="delete"><ha-icon icon="mdi:delete"></ha-icon>Delete Scene</button>` : ""}
      </div>`;
    root.addEventListener("click", (e) => {
      const a = e.composedPath().find((n) => n.dataset?.a)?.dataset.a;
      if (!a) return;
      this.close();
      if (a === "edit") card._activateAndEdit(id);
      else if (a === "reorder") card._startReorder();
      else if (a === "new") card._edit(null);
      else if (a === "delete") card._deleteScene(id);
    });
    this._key = (e) => e.key === "Escape" && this.close();
    document.addEventListener("keydown", this._key);
  }

  close() {
    document.removeEventListener("keydown", this._key);
    this.remove();
  }
}

/* -------------------------------------------------------------------- card */

class UserScenesCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("user-scenes-card-editor");
  }

  static getStubConfig() {
    return { title: "", columns: 4, square: false, fill_empty: false, show_state: false, icon_mode: "state" };
  }

  setConfig(config) {
    this._config = { columns: 4, square: false, fill_empty: false, show_state: false, icon_mode: "state", ...config };
    this._sig = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
  }

  set preview(v) {
    this._preview = v;
  }

  set editMode(v) {
    this._editModeProp = v;
  }

  getCardSize() {
    return Math.max(2, Math.ceil((this._data?.scenes.length || 1) / this._config.columns) * 2);
  }

  set hass(hass) {
    this._hass = hass;
    const sig = JSON.stringify(
      Object.values(hass.states)
        .filter((s) => s.entity_id.startsWith("button.") && s.attributes.user_scenes)
        .map((s) => [s.attributes.scene_id, s.attributes.friendly_name, s.attributes.entities, s.attributes.states])
    );
    if (sig !== this._sig) {
      this._sig = sig;
      this._load();
    }
    this._updateActive();
    if (this._editor?.isConnected) this._editor.setHass(hass);
  }

  // True while the dashboard / this card is being edited (long-press must not open the editor then)
  _inEditMode() {
    if (this._preview || this._editModeProp) return true;
    let n = this;
    while (n) {
      if (n.tagName && EDIT_TAGS.includes(n.tagName)) return true;
      n = n.parentNode || n.host;
    }
    return false;
  }

  async _load() {
    try {
      this._data = await this._hass.callWS({ type: "user_scenes/list" });
      this._error = null;
    } catch (err) {
      this._error = err.message || "User Scenes integration not loaded";
    }
    this._render();
  }

  _scene(id) {
    return this._data?.scenes.find((s) => s.id === id);
  }

  _edit(id) {
    const scene = id ? this._scene(id) : null;
    if (!this._data || (id && !scene)) return;
    const ed = document.createElement("user-scenes-editor");
    ed.open({ hass: this._hass, card: this, allowed: this._data.allowed, scene });
    document.body.appendChild(ed);
    this._editor = ed;
  }

  async _activate(tile) {
    tile.classList.add("pressed");
    setTimeout(() => tile.classList.remove("pressed"), 250);
    try {
      await usCall(this._hass, "activate", { scene_id: tile.dataset.id });
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  // Display order: scene ids, "" = empty placeholder tile (only with fill_empty)
  _tokens() {
    const d = this._data;
    const c = this._config;
    const cols = Math.max(1, Number(c.columns) || 4);
    const ids = new Set(d.scenes.map((x) => x.id));
    const seen = new Set();
    const t = (d.layout || []).filter((x) => x === "" || (ids.has(x) && !seen.has(x) && seen.add(x)));
    for (const sc of d.scenes) {
      if (seen.has(sc.id)) continue;
      seen.add(sc.id);
      // a new scene takes the place of an empty tile (if any), otherwise it is appended
      const e = c.fill_empty ? t.lastIndexOf("") : -1;
      if (e >= 0) t[e] = sc.id;
      else t.push(sc.id);
    }
    if (!c.fill_empty) return t.filter((x) => x !== "");
    const need = (cols - (d.scenes.length % cols)) % cols;
    let have = t.filter((x) => x === "").length;
    while (have > need) {
      t.splice(t.lastIndexOf(""), 1);
      have--;
    }
    while (have < need) {
      t.push("");
      have++;
    }
    return t;
  }

  async _activateAndEdit(id) {
    try {
      await usCall(this._hass, "activate", { scene_id: id });
    } catch (err) {
      alert(err.message || String(err));
    }
    this._edit(id);
  }

  async _deleteScene(id) {
    const sc = this._scene(id);
    if (!sc || !confirm(`Delete scene "${sc.name}"?`)) return;
    try {
      await usCall(this._hass, "delete", { scene_id: id });
      await this._load();
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  _openMenu(id) {
    const scene = this._scene(id);
    if (!scene) return;
    const menu = document.createElement("user-scenes-menu");
    menu.open({ card: this, id, name: scene.name });
    document.body.appendChild(menu);
  }

  // ---- rumble mode (Reorder Scenes): drag to change position
  _startReorder() {
    this._reorder = true;
    this._render();
  }

  _exitReorder() {
    this._reorder = false;
    this._render();
  }

  _bindReorder(root) {
    const grid = root.querySelector(".grid");
    for (const t of root.querySelectorAll(".tile")) {
      t.addEventListener("pointerdown", (e) => {
        if (e.button) return;
        const r = t.getBoundingClientRect();
        this._drag = { tile: t, id: t.dataset.id, sx: e.clientX, sy: e.clientY, gx: e.clientX - r.left, gy: e.clientY - r.top, moved: false };
        const move = (ev) => {
          const d = this._drag;
          if (!d) return;
          if (!d.moved) {
            if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 8) return;
            d.moved = true;
            d.tile.classList.add("dragging");
          }
          d.tile.style.transform = "none";
          const n = d.tile.getBoundingClientRect();
          d.tile.style.transform = `translate(${ev.clientX - d.gx - n.left}px, ${ev.clientY - d.gy - n.top}px)`;
          for (const o of grid.querySelectorAll(".tile")) {
            if (o === d.tile) continue;
            const r2 = o.getBoundingClientRect();
            if (ev.clientX >= r2.left && ev.clientX <= r2.right && ev.clientY >= r2.top && ev.clientY <= r2.bottom) {
              const kids = [...grid.children];
              grid.insertBefore(d.tile, kids.indexOf(o) < kids.indexOf(d.tile) ? o : o.nextSibling);
              break;
            }
          }
        };
        const end = (ev) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          const d = this._drag;
          this._drag = null;
          if (!d) return;
          d.tile.style.transform = "";
          d.tile.classList.remove("dragging");
          if (!d.moved) return;
          const order = [...grid.querySelectorAll(".tile")].map((x) => x.dataset.id || "");
          const byId = Object.fromEntries(this._data.scenes.map((x) => [x.id, x]));
          this._data.scenes = order.filter(Boolean).map((id) => byId[id]);
          this._data.layout = order;
          usCall(this._hass, "reorder", { scene_ids: order }).catch((err) => alert(err.message || String(err)));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      });
    }
  }

  // Does reality currently match the scene (on/off, brightness and colour of every included lamp)?
  _sceneActive(scene) {
    return Object.entries(scene.states).every(([eid, v]) => matchEntity(this._hass, eid, v));
  }

  // Brightness-weighted average colour of the lamps that are on in the scene
  _sceneColor(scene) {
    let r = 0, g = 0, b = 0, w = 0;
    for (const v of Object.values(scene.states).flatMap((x) => (x.members ? Object.values(x.members) : [x]))) {
      if (v.state !== "on" || !v.rgb) continue;
      const wt = v.brightness || 1;
      r += v.rgb[0] * wt;
      g += v.rgb[1] * wt;
      b += v.rgb[2] * wt;
      w += wt;
    }
    return w ? `rgb(${Math.round(r / w)},${Math.round(g / w)},${Math.round(b / w)})` : null;
  }

  // Re-evaluated on every state change in HA: active class, state text and icon colour
  _updateActive() {
    if (!this._data || !this.shadowRoot || !this._hass) return;
    const c = this._config;
    const da = (this._hass.language || "").startsWith("da");
    const onText = c.state_on || (da ? "Aktiveret" : "Active");
    const offText = c.state_off || (da ? "Fra" : "Off");
    const activeColor = "var(--state-light-active-color, #ffc107)";
    for (const tile of this.shadowRoot.querySelectorAll(".tile[data-id]")) {
      const scene = this._scene(tile.dataset.id);
      if (!scene) continue;
      const active = this._sceneActive(scene);
      tile.classList.toggle("active", active);
      const st = tile.querySelector(".st");
      if (st) st.textContent = active ? onText : offText;
      const sc = this._sceneColor(scene);
      let color = "";
      switch (c.icon_mode) {
        case "static":
          break;
        case "scene_color":
          color = active ? sc || activeColor : "";
          break;
        case "scene_color_always":
          color = sc || (active ? activeColor : "");
          break;
        default: // "state"
          color = active ? activeColor : "";
      }
      tile.querySelector("ha-icon").style.color = color;
    }
  }

  _render() {
    if (this._drag?.moved) return;
    const c = this._config;
    const d = this._data;
    const reorder = this._reorder && d;
    let body;
    if (this._error) body = `<p class="msg err">${esc(this._error)}</p>`;
    else if (!d) body = `<p class="msg">Loading…</p>`;
    else {
      const byId = Object.fromEntries(d.scenes.map((x) => [x.id, x]));
      const tiles = this._tokens()
        .map((tok) => {
          if (!tok) return `<div class="tile empty ${reorder ? "wiggle" : ""}" aria-hidden="true">&nbsp;</div>`;
          const sc = byId[tok];
          return `<div class="tile ${reorder ? "wiggle" : ""}" tabindex="0" data-id="${sc.id}">
            <ha-icon icon="mdi:lightbulb-group"></ha-icon><span>${esc(sc.name)}</span>${c.show_state ? `<span class="st"></span>` : ""}</div>`;
        })
        .join("");
      const bar = reorder
        ? `<div class="bar"><span>Drag the scenes to change their position.</span><button data-done="1">Done</button></div>`
        : "";
      body = `${bar}<div class="grid">${tiles}</div>`;
    }
    this.shadowRoot.innerHTML = `
      <style>
        .title { padding: 0 8px 8px; font-size: 1.2em; font-weight: 500; color: var(--primary-text-color); }
        .grid { display: grid; grid-template-columns: repeat(${Math.max(1, Number(c.columns) || 4)}, minmax(0, 1fr)); gap: 8px; }
        .tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
                padding: 16px 8px; min-height: 100px; box-sizing: border-box; text-align: center; cursor: pointer;
                border-radius: var(--ha-card-border-radius, 12px); border: 1px solid var(--divider-color);
                background: var(--ha-card-background, var(--card-background-color, #fff)); color: var(--primary-text-color);
                user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation;
                transition: transform .12s, border-color .2s; }
        ${c.square ? ".tile { aspect-ratio: 1 / 1; }" : ""}
        .tile > ha-icon { --mdc-icon-size: 40px; color: var(--state-icon-color, var(--secondary-text-color)); pointer-events: none; }
        .tile span { font-size: 1.05em; overflow-wrap: anywhere; pointer-events: none; }
        .tile span.st { font-size: .85em; color: var(--secondary-text-color); margin-top: -4px; }
        .tile.pressed { transform: scale(.95); }
        .tile.wiggle { cursor: grab; touch-action: none; animation: wiggle .28s ease-in-out infinite alternate; }
        .tile.wiggle:nth-child(2n) { animation-delay: -.14s; }
        .tile.dragging { animation: none; cursor: grabbing; z-index: 5; opacity: .92; box-shadow: 0 6px 18px rgba(0,0,0,.35); transition: none; }
        .tile.empty { pointer-events: none; }
        .tile.wiggle.empty { pointer-events: auto; border-style: dashed; opacity: .75; }
        @keyframes wiggle { from { transform: rotate(-1.2deg); } to { transform: rotate(1.2deg); } }
        .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px 10px; color: var(--secondary-text-color); }
        .bar button { font: inherit; cursor: pointer; padding: 8px 18px; border: none; border-radius: 8px;
                      background: var(--primary-color); color: var(--text-primary-color, #fff); }
        .msg { padding: 8px; } .err { color: var(--error-color); }
      </style>
      <div>${c.title ? `<div class="title">${esc(c.title)}</div>` : ""}${body}</div>`;

    const root = this.shadowRoot;
    if (reorder) {
      root.querySelector("[data-done]")?.addEventListener("click", () => this._exitReorder());
      this._bindReorder(root);
      return;
    }
    for (const t of root.querySelectorAll(".tile[data-id]")) {
      t.addEventListener("pointerdown", () => {
        this._lp = false;
        clearTimeout(this._timer);
        if (this._inEditMode()) return;
        this._timer = setTimeout(() => {
          this._lp = true;
          this._openMenu(t.dataset.id);
        }, LONG_PRESS_MS);
      });
      for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
        t.addEventListener(ev, () => clearTimeout(this._timer));
      }
      t.addEventListener("click", () => {
        if (this._lp) {
          this._lp = false;
          return;
        }
        this._activate(t);
      });
      t.addEventListener("keydown", (e) => e.key === "Enter" && t.click());
      t.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    this._updateActive();
  }
}

/* ------------------------------------------------- visual config editor */

class UserScenesCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      const labels = { title: "Title (optional)", columns: "Columns", square: "Square tiles",
        fill_empty: "Fill with empty rectangles",
        show_state: "Show state (Active / Off)",
        state_on: "Text when active (optional)",
        state_off: "Text when not active (optional)",
        icon_mode: "Icon behaviour",
      };
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => labels[s.name] || s.name;
      this._form.schema = [
        { name: "title", selector: { text: {} } },
        { name: "columns", selector: { number: { min: 1, max: 10, mode: "box" } } },
        { name: "square", selector: { boolean: {} } },
        { name: "fill_empty", selector: { boolean: {} } },
        { name: "show_state", selector: { boolean: {} } },
        { name: "state_on", selector: { text: {} } },
        { name: "state_off", selector: { text: {} } },
        {
          name: "icon_mode",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "static", label: "Static (never changes)" },
                { value: "state", label: "Yellow when active" },
                { value: "scene_color", label: "Scene colour when active" },
                { value: "scene_color_always", label: "Scene colour always" },
              ],
            },
          },
        },
      ];
      this._form.addEventListener("value-changed", (e) => {
        this._config = e.detail.value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { columns: 4, square: false, fill_empty: false, show_state: false, icon_mode: "state", ...this._config };
  }
}

customElements.define("user-scenes-editor", UserScenesEditor);
customElements.define("user-scenes-menu", UserScenesMenu);
customElements.define("user-scenes-card", UserScenesCard);
customElements.define("user-scenes-card-editor", UserScenesCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "user-scenes-card",
  name: "User Scenes",
  description: "Tile grid of lamp scenes: tap to activate, long-press to edit.",
});
