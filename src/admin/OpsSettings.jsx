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
    note: "Base fare plus per-km from the first metre, floored so a short hop is still worth taking. Holds pay near ₹107/hour at any distance. Prime's free delivery comes out of item margin, never the rider's pay.",
    fields: [
      { key: "rider_base", label: "Base fare (₹)" },
      { key: "rider_per_km", label: "₹ per km" },
      { key: "rider_min", label: "Minimum pay per order (₹)" },
      { key: "peak_bonus", label: "Peak bonus when surge is on (₹)" },
    ],
  },
  {
    title: "Picker payout",
    note: "A base fee plus a per-line and per-unit rate, so a 1-item order and a 12-item order no longer pay the same — lines drive walking/finding time, units drive lifting/bagging time.",
    fields: [
      { key: "picker_pack_fee", label: "Base fee per order (₹)" },
      { key: "picker_per_line", label: "₹ per line item", step: "0.1" },
      { key: "picker_per_unit", label: "₹ per unit", step: "0.05" },
    ],
  },
  {
    title: "Delivery zones",
    note: "A ride costs more the farther it goes, so beyond the far-zone distance a higher free-delivery bar applies to everyone, Prime included.",
    fields: [
      { key: "far_zone_km", label: "Far zone starts at (km)", step: "0.1" },
      { key: "free_delivery_far_above", label: "Free delivery above, in the far zone (₹)" },
    ],
  },
  {
    title: "What unlocks free delivery",
    note: "An item counts toward the free-delivery bar only if it clears both floors. Percent catches thin big-ticket items like oil and atta; rupees catches ₹10 items whose margin looks fine but earns ₹1.50.",
    fields: [
      { key: "free_delivery_min_margin_pct", label: "Minimum margin to count (%)", step: "0.5" },
      { key: "free_delivery_min_margin_rupees", label: "Minimum margin to count (₹ per unit)", step: "0.5" },
    ],
  },
  {
    title: "Slot guarantee",
    note: "Tops up a booked slot to an hourly minimum if a partner shows up and the shop is quiet. Only worth turning on once slots reliably clear a few orders an hour.",
    bools: [
      { key: "slot_guarantee_enabled", label: "Guarantee a minimum hourly pay per slot" },
    ],
    fields: [
      { key: "rider_floor_hourly", label: "Rider guaranteed ₹/hour" },
      { key: "picker_floor_hourly", label: "Picker guaranteed ₹/hour" },
      { key: "slot_length_hours", label: "Slot length (hours)", step: "0.5" },
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
        (g.bools || []).forEach((b) => { patch[b.key] = !!form[b.key]; });
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

          {g.bools && (
            <div className="ops-toggles">
              {g.bools.map((b) => (
                <label className="ops-toggle-row" key={b.key}>
                  <span>{b.label}</span>
                  <input type="checkbox" checked={!!form[b.key]}
                    onChange={(e) => set(b.key, e.target.checked)} />
                </label>
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
