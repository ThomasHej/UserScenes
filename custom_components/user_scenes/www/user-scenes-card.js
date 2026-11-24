/* User Scenes card
 * - Tile grid of scenes (configurable columns / square tiles), auto-filled from saved scenes.
 * - Tap = activate scene, long-press = rumble mode (not while editing the dashboard):
 *   click a tile to edit it, drag a tile to change its position.
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
    this._id = scene.id;
    this._name = scene.name;
    this._saved = scene.states || {};
    this._selected = new Set(scene.entities);
    this._recapture = false;
    this._editName = false;
    const orphans = scene.entities.filter((e) => !allowed.includes(e));
    this._rows = [...allowed, ...orphans];
    this._allowed = allowed;
    this._many = (card._data?.scenes.length || 0) > 1;

    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { position: fixed; inset: 0; z-index: 100; display: block;
                font-family: var(--primary-font-family, Roboto, sans-serif); }
        .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
        .panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(440px, 100vw);
                 display: flex; flex-direction: column; box-sizing: border-box;
                 background: var(--card-background-color, #fff); color: var(--primary-text-color);
                 box-shadow: -4px 0 16px rgba(0,0,0,.3); animation: slide .2s ease-out; }
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
        .row { display: flex; align-items: center; gap: 16px; padding: 10px 20px; border-bottom: 1px solid var(--divider-color); }
        .row ha-icon { --mdc-icon-size: 28px; color: var(--disabled-text-color); flex: none; }
        .row ha-icon.on { color: var(--state-light-active-color, #ffc107); }
        .row .nm { flex: 1; min-width: 0; }
        .row .nm div:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row .sub { font-size: .8em; color: var(--secondary-text-color); }
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
          <p>Set the lamps the way you want them first (in Home Assistant or the native apps).
             The icons show the state that will be saved when you press <b>Save</b>.</p>
          <p>Use <b>Re-capture</b> to update all included lamps to their current state.
             Lamps that are not selected are never touched.</p>
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

    this._renderHead();
    root.getElementById("list").innerHTML = this._rows
      .map(
        (eid) => `<div class="row" data-eid="${esc(eid)}">
          <ha-icon></ha-icon>
          <div class="nm"><div>${esc(friendly(hass, eid))}${this._allowed.includes(eid) ? "" : " (not in master list)"}</div><div class="sub"></div></div>
          <ha-switch></ha-switch></div>`
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

  // What will be stored for a lamp if Save is pressed now (null = not included)
  _effective(eid) {
    if (!this._selected.has(eid)) return null;
    if (this._saved[eid] && !this._recapture) return { ...this._saved[eid], from: "saved" };
    return { ...this._current(eid), from: "current" };
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
      // Realistic colour (like the Hue app): actual colour + brightness of what will be saved
      if (on && eff && v.rgb) {
        icon.style.color = `rgb(${v.rgb.join(",")})`;
        icon.style.opacity = String(0.5 + (0.5 * (v.brightness ?? 100)) / 100);
      } else {
        icon.style.color = "";
        icon.style.opacity = "";
      }
      row.classList.toggle("off", !eff);
      let sub = "Not included";
      if (eff) {
        sub = v.state === "unavailable" ? "Unavailable – will be skipped" : on ? "On" + (v.brightness != null ? ` · ${v.brightness}%` : "") : "Off";
        if (v.state !== "unavailable") sub += eff.from === "saved" ? " — saved state" : " — current state";
      }
      row.querySelector(".sub").textContent = sub;
      const sw = row.querySelector("ha-switch");
      if (sw.checked !== !!eff) sw.checked = !!eff;
    }
  }

  _renderHead() {
    const root = this.shadowRoot;
    const title = this._editName
      ? `<input id="name" type="text" placeholder="Scene description" value="${esc(this._name)}">
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
    this.shadowRoot.getElementById("foot").innerHTML = `
      <button class="b primary" data-action="save">Save changes</button>
      <button class="b ${this._recapture ? "on" : ""}" data-action="recapture"><ha-icon icon="mdi:camera-retake"></ha-icon>Re-capture</button>
      <button class="b" data-action="copy"><ha-icon icon="mdi:content-copy"></ha-icon>New Duplicate</button>
      ${this._many ? `<button class="b danger" data-action="delete"><ha-icon icon="mdi:delete"></ha-icon>Delete</button>` : ""}
      <button class="b" data-action="close">Cancel</button>
      ${this._recapture ? `<div class="hint">All selected lamps will be saved with their current state.</div>` : ""}`;
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
        case "recapture":
          this._recapture = !this._recapture;
          this._renderFoot();
          this._refreshRows();
          break;
        case "save": {
          const name = this._name.trim();
          const entities = this._rows.filter((x) => this._selected.has(x));
          if (!name) {
            this._editName = true;
            this._renderHead();
            return alert("Please enter a description for the scene.");
          }
          if (!entities.length) return alert("Select at least one lamp.");
          await usCall(this._hass, "update", { scene_id: this._id, name, entities, recapture: this._recapture });
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

/* -------------------------------------------------------------------- card */

class UserScenesCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("user-scenes-card-editor");
  }

  static getStubConfig() {
    return { title: "", columns: 4, square: false, fill_empty: false };
  }

  setConfig(config) {
    this._config = { columns: 4, square: false, fill_empty: false, ...config };
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
    if (!this._data || !this._scene(id)) return;
    const ed = document.createElement("user-scenes-editor");
    ed.open({ hass: this._hass, card: this, allowed: this._data.allowed, scene: this._scene(id) });
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

  // ---- rumble mode: click = edit, drag = change position
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
    for (const t of root.querySelectorAll(".tile[data-id]")) {
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
          for (const o of grid.querySelectorAll(".tile[data-id]")) {
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
          if (!d.moved) {
            if (ev.type === "pointerup") this._edit(d.id);
            return;
          }
          const order = [...grid.querySelectorAll(".tile[data-id]")].map((x) => x.dataset.id);
          const byId = Object.fromEntries(this._data.scenes.map((x) => [x.id, x]));
          this._data.scenes = order.map((id) => byId[id]);
          usCall(this._hass, "reorder", { scene_ids: order }).catch((err) => alert(err.message || String(err)));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      });
    }
  }

  // Highlight scenes whose saved on/off states currently match reality
  _updateActive() {
    if (!this._data || !this.shadowRoot) return;
    for (const tile of this.shadowRoot.querySelectorAll(".tile[data-id]")) {
      const scene = this._scene(tile.dataset.id);
      const active =
        scene && Object.entries(scene.states).every(([eid, v]) => this._hass.states[eid]?.state === v.state);
      tile.classList.toggle("active", !!active);
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
      const tiles = d.scenes
        .map(
          (s) => `<div class="tile ${reorder ? "wiggle" : ""}" tabindex="0" data-id="${s.id}">
            <ha-icon icon="mdi:lightbulb-group"></ha-icon><span>${esc(s.name)}</span></div>`
        )
        .join("");
      const cols = Math.max(1, Number(c.columns) || 4);
      const pad = c.fill_empty ? (cols - (d.scenes.length % cols)) % cols : 0;
      const empties = `<div class="tile empty" aria-hidden="true">&nbsp;</div>`.repeat(pad);
      const bar = reorder
        ? `<div class="bar"><span>Click a scene to edit it. Click and drag to change position.</span><button data-done="1">Done</button></div>`
        : "";
      body = `${bar}<div class="grid">${tiles}${empties}</div>`;
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
        .tile.active > ha-icon { color: var(--state-light-active-color, #ffc107); }
        .tile.pressed { transform: scale(.95); }
        .tile.wiggle { cursor: grab; touch-action: none; animation: wiggle .28s ease-in-out infinite alternate; }
        .tile.wiggle:nth-child(2n) { animation-delay: -.14s; }
        .tile.dragging { animation: none; cursor: grabbing; z-index: 5; opacity: .92; box-shadow: 0 6px 18px rgba(0,0,0,.35); transition: none; }
        .tile.empty { pointer-events: none; }
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
          this._startReorder();
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
      const labels = { title: "Title (optional)", columns: "Columns", square: "Square tiles", fill_empty: "Fill with empty rectangles" };
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => labels[s.name] || s.name;
      this._form.schema = [
        { name: "title", selector: { text: {} } },
        { name: "columns", selector: { number: { min: 1, max: 10, mode: "box" } } },
        { name: "square", selector: { boolean: {} } },
        { name: "fill_empty", selector: { boolean: {} } },
      ];
      this._form.addEventListener("value-changed", (e) => {
        this._config = e.detail.value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { columns: 4, square: false, fill_empty: false, ...this._config };
  }
}

customElements.define("user-scenes-editor", UserScenesEditor);
customElements.define("user-scenes-card", UserScenesCard);
customElements.define("user-scenes-card-editor", UserScenesCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "user-scenes-card",
  name: "User Scenes",
  description: "Tile grid of lamp scenes: tap to activate, long-press to edit.",
});
