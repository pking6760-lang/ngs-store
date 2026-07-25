import { useEffect, useState } from "react";
import * as api from "../lib/api.js";
import { withMinTime } from "../lib/ux.js";

// The owner's control panel for the partner engine. Every dial the pricing +
// payout system reads lives here.
const GROUPS = [
  {
    title: "Who does the work",
    note: "Switch to Staff once you've hired. In 'Me', orders come to this admin app.",
    toggles: [
      { key: "coverage_picking", label: "Picking" },
      { key: "coverage_delivery", label: "Delivery" },
    ],
  },
  {
    title: "Customer charges (₹)",
    fields: [
      { key: "handling_fee", label: "Handling fee (every order)" },
      { key: "delivery_fee", label: "Delivery fee (below free threshold)" },
      { key: "free_delivery_threshold", label: "Free delivery above" },
      { key: "surge_fee", label: "Surge charge (rain/peak)" },
      { key: "small_cart_fee", label: "Small cart charge (0 = off)" },
      { key: "small_cart_threshold", label: "…charged below this cart value" },
      { key: "cod_customer_limit", label: "COD limit (above → online only)" },
    ],
  },
  {
    title: "Delivery partner payout",
    note: "Flat, predictable pay: a base per delivery + distance beyond the free radius + a peak (rain/night) bonus. Members get free delivery (handling is charged to everyone), so their orders use the lower member base (distance + peak still apply).",
    fields: [
      { key: "rider_base", label: "Base per delivery (₹)" },
      { key: "rider_member_base", label: "Base for Prime member deliveries (₹)" },
      { key: "rider_free_km", label: "Free distance (km)", step: "0.1" },
      { key: "rider_per_km", label: "₹ per km beyond that" },
      { key: "peak_bonus", label: "Peak bonus when surge is on (₹)" },
    ],
  },
  {
    title: "Picker payout",
    fields: [
      { key: "picker_pack_fee", label: "Flat fee per order packed (₹)" },
    ],
  },
  {
    title: "Cash & penalties (₹)",
    fields: [
      { key: "rider_cash_cap", label: "Rider cash-in-hand cap" },
      { key: "penalty_fine_2", label: "2nd-strike fine" },
      { key: "penalty_fine_3", label: "3rd-strike fine" },
      { key: "penalty_block_days", label: "Block days after 3rd strike" },
    ],
  },
  {
    title: "Store hours & dispatch",
    fields: [
      { key: "store_open_hour", label: "Open hour (0–23)" },
      { key: "store_close_hour", label: "Close hour (0–24)" },
      { key: "dispatch_stagger_seconds", label: "Delivery ring delay (sec)" },
      { key: "assignment_timeout_seconds", label: "Rollover if unaccepted (sec)" },
    ],
  },
];

export default function OpsSettings() {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.getOpsConfigRaw().then((c) => { setCfg(c); setForm(c || {}); }).catch((e) => setErr(e.message));
  }, []);

  if (!cfg) return <section className="panel"><p className="panel-empty">{err || "Loading settings…"}</p></section>;

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };

  async function save() {
    setBusy(true); setErr(""); setSaved(false);
    try {
      const patch = {};
      GROUPS.forEach((g) => {
        (g.fields || []).forEach((f) => { patch[f.key] = Number(form[f.key]); });
        (g.toggles || []).forEach((t) => { patch[t.key] = form[t.key]; });
      });
      await withMinTime(() => api.updateOpsConfig(patch), 650, 1300);
      setSaved(true);
    } catch (e) { setErr(e.message || "Couldn't save."); }
    finally { setBusy(false); }
  }

  return (
    <div className="ops-settings">
      <p className="ops-intro">These control the whole partner system — pricing, payouts, cash caps and dispatch. Change any number and Save.</p>
      {GROUPS.map((g) => (
        <section className="panel ops-group" key={g.title}>
          <h3 className="ops-group-title">{g.title}</h3>
          {g.note && <p className="ops-group-note">{g.note}</p>}

          {g.toggles && (
            <div className="ops-toggles">
              {g.toggles.map((t) => (
                <div className="ops-toggle-row" key={t.key}>
                  <span>{t.label}</span>
                  <div className="ops-seg">
                    <button className={form[t.key] === "me" ? "on" : ""} onClick={() => set(t.key, "me")}>Me</button>
                    <button className={form[t.key] === "staff" ? "on" : ""} onClick={() => set(t.key, "staff")}>Staff</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {g.fields && (
            <div className="ops-grid">
              {g.fields.map((f) => (
                <label className="ops-field" key={f.key}>
                  <span>{f.label}</span>
                  <input type="number" step={f.step || "1"} inputMode="decimal"
                    value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                </label>
              ))}
            </div>
          )}
        </section>
      ))}

      {err && <div className="preg-error" style={{ margin: "0 0 10px" }}>{err}</div>}
      <div className="ops-save-bar">
        {saved && <span className="ops-saved">✓ Saved</span>}
        <button className="ops-save" disabled={busy} onClick={save}>{busy ? <><span className="ngs-spin" /> Saving…</> : "Save settings"}</button>
      </div>
    </div>
  );
}
