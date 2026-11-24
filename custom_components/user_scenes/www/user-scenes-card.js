/* User Scenes card: scene buttons + editor (create / edit / copy / delete). */
const US_DOMAIN = "user_scenes";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

class UserScenesCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._editing = null;
    this._data = null;
    this._sig = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
      this.shadowRoot.addEventListener("input", (e) => this._onInput(e));
      this.shadowRoot.addEventListener("change", (e) => this._onInput(e));
    }
    this._render();
  }

  getCardSize() {
    return 4;
  }

  static getStubConfig() {
    return { title: "Scenes" };
  }

  set hass(hass) {
    this._hass = hass;
    const sig = JSON.stringify(
      Object.values(hass.states)
        .filter((s) => s.entity_id.startsWith("button.") && s.attributes.user_scenes)
        .map((s) => [s.attributes.scene_id, s.attributes.friendly_name, s.attributes.entities])
    );
    if (sig !== this._sig) {
      this._sig = sig;
      this._load();
    }
  }

  async _load() {
    try {
      this._data = await this._hass.callWS({ type: "user_scenes/list" });
      this._error = null;
    } catch (err) {
      this._error = err.message || "User Scenes integration not loaded";
    }
    if (!this._editing) this._render();
  }

  async _call(service, data, response = false) {
    if (!response) return this._hass.callService(US_DOMAIN, service, data);
    const r = await this._hass.callWS({
      type: "call_service",
      domain: US_DOMAIN,
      service,
      service_data: data,
      return_response: true,
    });
    return r.response;
  }

  _scene(id) {
    return this._data?.scenes.find((s) => s.id === id);
  }

  _friendly(eid) {
    return this._hass?.states[eid]?.attributes.friendly_name || eid;
  }

  _render() {
    if (!this.shadowRoot) return;
    const d = this._data;
    let body = "";
    if (this._error) {
      body = `<p class="err">${esc(this._error)}</p>`;
    } else if (!d) {
      body = `<p>Loading…</p>`;
    } else if (this._editing) {
      body = this._renderEditor(d);
    } else {
      const scenes = d.scenes
        .map(
          (s) => `<div class="scene">
            <button class="run" data-action="activate" data-id="${s.id}">${esc(s.name)}</button>
            <button class="icon" title="Edit" data-action="edit" data-id="${s.id}">✎</button>
          </div>`
        )
        .join("");
      body = `<div class="scenes">${scenes || "<p>No scenes yet.</p>"}</div>
        <button class="primary" data-action="new">+ New scene</button>`;
    }
    this.shadowRoot.innerHTML = `
      <style>
        .wrap { padding: 16px; }
        .scenes { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .scene { display: flex; }
        button { font: inherit; cursor: pointer; border: 1px solid var(--divider-color); border-radius: 8px;
                 background: var(--secondary-background-color); color: var(--primary-text-color); padding: 10px 14px; }
        button.run { border-radius: 8px 0 0 8px; background: var(--primary-color); color: var(--text-primary-color, #fff); border: none; }
        button.icon { border-radius: 0 8px 8px 0; padding: 10px; }
        button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border: none; }
        button.danger { color: var(--error-color); }
        input[type=text] { width: 100%; box-sizing: border-box; padding: 10px; font: inherit; margin: 6px 0 12px;
                           background: var(--card-background-color); color: var(--primary-text-color);
                           border: 1px solid var(--divider-color); border-radius: 6px; }
        label.lamp { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
        label.opt { display: flex; gap: 10px; padding: 8px 0; font-size: 0.9em; color: var(--secondary-text-color); }
        .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--disabled-text-color); }
        .dot.on { background: var(--state-light-active-color, #ffc107); }
        .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
        .err { color: var(--error-color); }
        h3 { margin: 0 0 8px; }
      </style>
      <ha-card header="${esc(this._config.title || "Scenes")}"><div class="wrap">${body}</div></ha-card>`;
  }

  _renderEditor(d) {
    const e = this._editing;
    const lamps = d.allowed
      .map((eid) => {
        const on = this._hass.states[eid]?.state === "on";
        return `<label class="lamp"><input type="checkbox" data-eid="${esc(eid)}" ${e.selected.has(eid) ? "checked" : ""}>
          <span class="dot ${on ? "on" : ""}"></span>${esc(this._friendly(eid))}</label>`;
      })
      .join("");
    // lamps saved in the scene but no longer in the master list
    const orphans = [...e.selected]
      .filter((eid) => !d.allowed.includes(eid))
      .map(
        (eid) => `<label class="lamp"><input type="checkbox" data-eid="${esc(eid)}" checked>
          <span class="dot"></span>${esc(this._friendly(eid))} (not in master list)</label>`
      )
      .join("");
    const isNew = !e.id;
    return `<h3>${isNew ? "New scene" : "Edit scene"}</h3>
      <p style="margin:0;color:var(--secondary-text-color);font-size:.9em">
        ${isNew ? "Set your lamps as you want them first, then pick which ones to include." : ""}</p>
      <input type="text" id="name" placeholder="Description" value="${esc(e.name)}">
      ${lamps}${orphans}
      ${isNew ? "" : `<label class="opt"><input type="checkbox" id="recapture" ${e.recapture ? "checked" : ""}>
        Re-capture current state of all selected lamps (otherwise saved states are kept; newly added lamps use their current state)</label>`}
      <div class="row">
        <button class="primary" data-action="save">${isNew ? "Save current state" : "Save changes"}</button>
        ${isNew ? "" : `<button data-action="copy">Make a copy</button>
        <button class="danger" data-action="delete">Delete</button>`}
        <button data-action="cancel">Cancel</button>
      </div>`;
  }

  _onInput(ev) {
    const t = ev.composedPath()[0];
    if (!this._editing || !t) return;
    if (t.id === "name") this._editing.name = t.value;
    else if (t.id === "recapture") this._editing.recapture = t.checked;
    else if (t.dataset?.eid) {
      t.checked ? this._editing.selected.add(t.dataset.eid) : this._editing.selected.delete(t.dataset.eid);
    }
  }

  _open(id) {
    const s = id ? this._scene(id) : null;
    this._editing = {
      id: id || null,
      name: s ? s.name : "",
      selected: new Set(s ? s.entities : []),
      recapture: false,
    };
    this._render();
  }

  async _onClick(ev) {
    const btn = ev.composedPath().find((n) => n.dataset?.action);
    if (!btn) return;
    const { action, id } = btn.dataset;
    const e = this._editing;
    try {
      switch (action) {
        case "activate":
          await this._call("activate", { scene_id: id });
          break;
        case "edit":
          this._open(id);
          break;
        case "new":
          this._open(null);
          break;
        case "cancel":
          this._editing = null;
          this._render();
          break;
        case "save": {
          const name = e.name.trim();
          const entities = [...e.selected];
          if (!name) return alert("Please enter a description.");
          if (!entities.length) return alert("Select at least one lamp.");
          if (e.id) await this._call("update", { scene_id: e.id, name, entities, recapture: e.recapture });
          else await this._call("save", { name, entities });
          this._editing = null;
          await this._load();
          break;
        }
        case "copy": {
          const r = await this._call("copy", { scene_id: e.id, name: `${e.name.trim() || "Scene"} (copy)` }, true);
          this._editing = null;
          await this._load();
          this._open(r.scene_id);
          break;
        }
        case "delete":
          if (!confirm(`Delete scene "${e.name}"?`)) return;
          await this._call("delete", { scene_id: e.id });
          this._editing = null;
          await this._load();
          break;
      }
    } catch (err) {
      alert(err.message || String(err));
    }
  }
}

customElements.define("user-scenes-card", UserScenesCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "user-scenes-card",
  name: "User Scenes",
  description: "Save, edit, copy and restore lamp scenes.",
});
