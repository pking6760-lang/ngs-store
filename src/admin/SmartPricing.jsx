import { useEffect, useState } from "react";
import { Ic } from "./AdminIcons.jsx";
import { useAdminProducts } from "../lib/hooks.js";
import * as api from "../lib/api.js";
import { withMinTime } from "../lib/ux.js";

const TIER = {
  fast:   { label: "Fast", icon: "", note: "advertised as best-price bait" },
  steady: { label: "Steady", icon: "", note: "normal margin" },
  slow:   { label: "Slow", icon: "", note: "fatter margin" },
  dead:   { label: "Dead", icon: "", note: "clearance to move stock" },
  unpriced: { label: "No cost yet", icon: "＋", note: "add a buying price to auto-price" },
};
const ORDER = ["fast", "steady", "slow", "dead", "unpriced"];
const pct = (f) => Math.round((Number(f) || 0) * 1000) / 10; // 0.07 -> 7

export default function SmartPricing() {
  const products = useAdminProducts();
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.getPricingConfig().then(setCfg).catch((e) => setMsg(e.message));
  }, []);

  function set(field, value) {
    setCfg((c) => ({ ...c, [field]: value }));
  }

  async function saveAndReprice() {
    if (!cfg) return;
    setBusy(true); setMsg("");
    try {
      await withMinTime(async () => {
        await api.updatePricingConfig({
          enabled: cfg.enabled,
          window_days: Number(cfg.window_days) || 30,
          fast_min: Number(cfg.fast_min) || 20,
          slow_max: Number(cfg.slow_max) || 3,
          fast_margin: (Number(cfg.fast_margin) || 0),
          steady_margin: (Number(cfg.steady_margin) || 0),
          slow_margin: (Number(cfg.slow_margin) || 0),
          clearance_markup: (Number(cfg.clearance_markup) || 0),
          floor_markup: (Number(cfg.floor_markup) || 0),
          bait_count: Number(cfg.bait_count) || 0,
          bulk_enabled: cfg.bulk_enabled,
          bulk_min_1: Number(cfg.bulk_min_1) || 0, bulk_off_1: Number(cfg.bulk_off_1) || 0,
          bulk_min_2: Number(cfg.bulk_min_2) || 0, bulk_off_2: Number(cfg.bulk_off_2) || 0,
          bulk_min_3: Number(cfg.bulk_min_3) || 0, bulk_off_3: Number(cfg.bulk_off_3) || 0,
        });
        await api.smartReprice();
      });
      setMsg("Saved — prices recomputed.");
    } catch (e) {
      setMsg(e.message || "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function recompute() {
    setBusy(true); setMsg("");
    try {
      await withMinTime(() => api.smartReprice());
      setMsg("Prices recomputed.");
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function override(p, value) {
    // Toggle: tapping the active state clears it back to auto.
    const next = p.baitOverride === value ? null : value;
    try {
      await api.setBaitOverride(p.id, next);
      await api.smartReprice();
    } catch (e) { setMsg(e.message); }
  }

  if (!cfg) return <p className="sp-loading">Loading pricing rules…</p>;

  const groups = ORDER.map((t) => ({
    tier: t,
    items: products
      .filter((p) => (p.speedTier || "unpriced") === t)
      .sort((a, b) => (b.units30d || 0) - (a.units30d || 0)),
  })).filter((g) => g.items.length);

  const baitCount = products.filter((p) => p.bait).length;

  return (
    <div className="sp">
      <p className="sp-intro">
        Enter each product’s <strong>buying price</strong> and <strong>MRP</strong> in Products.
        This engine sets the selling price automatically from how fast it sells — fast movers get a
        thin margin and are advertised, slow movers get a fatter margin. Runs every few hours on its own.
      </p>

      <div className="sp-card">
        <div className="sp-row sp-toggle-row">
          <div>
            <strong>Smart Pricing</strong>
            <span className="sp-sub">{cfg.enabled ? "On — prices are automatic" : "Off — prices are manual"}</span>
          </div>
          <button
            type="button"
            className={`sp-switch ${cfg.enabled ? "on" : ""}`}
            onClick={() => set("enabled", !cfg.enabled)}
            aria-label="Toggle smart pricing"
          >
            <span />
          </button>
        </div>
      </div>

      <div className="sp-card">
        <h4>Target margins</h4>
        <div className="sp-grid">
          <Field label="Fast %" value={pct(cfg.fast_margin)} onChange={(v) => set("fast_margin", v / 100)} />
          <Field label="Steady %" value={pct(cfg.steady_margin)} onChange={(v) => set("steady_margin", v / 100)} />
          <Field label="Slow %" value={pct(cfg.slow_margin)} onChange={(v) => set("slow_margin", v / 100)} />
          <Field label="Clearance %" value={pct(cfg.clearance_markup)} onChange={(v) => set("clearance_markup", v / 100)} hint="over cost" />
        </div>
        <h4>Rules</h4>
        <div className="sp-grid">
          <Field label="Fast if sells ≥" value={cfg.fast_min} onChange={(v) => set("fast_min", v)} hint="units / month" />
          <Field label="Slow if sells ≤" value={cfg.slow_max} onChange={(v) => set("slow_max", v)} hint="units / month" />
          <Field label="Min margin %" value={pct(cfg.floor_markup)} onChange={(v) => set("floor_markup", v / 100)} hint="never below" />
          <Field label="Advertise top" value={cfg.bait_count} onChange={(v) => set("bait_count", v)} hint="bait deals" />
        </div>
        <button className="sp-save" disabled={busy} onClick={saveAndReprice}>
          {busy ? "Working…" : "Save & apply"}
        </button>
      </div>

      <div className="sp-card">
        <div className="sp-row sp-toggle-row">
          <div>
            <strong>Bulk pricing</strong>
            <span className="sp-sub">Buy more, pay less per unit — auto-built from cost</span>
          </div>
          <button
            type="button"
            className={`sp-switch ${cfg.bulk_enabled ? "on" : ""}`}
            onClick={() => set("bulk_enabled", !cfg.bulk_enabled)}
            aria-label="Toggle bulk pricing"
          >
            <span />
          </button>
        </div>
        {cfg.bulk_enabled && (
          <>
            <div className="sp-grid" style={{ marginTop: 10 }}>
              <Field label="Tier 1 qty ≥" value={cfg.bulk_min_1} onChange={(v) => set("bulk_min_1", v)} />
              <Field label="Tier 1 % off" value={pct(cfg.bulk_off_1)} onChange={(v) => set("bulk_off_1", v / 100)} />
              <Field label="Tier 2 qty ≥" value={cfg.bulk_min_2} onChange={(v) => set("bulk_min_2", v)} />
              <Field label="Tier 2 % off" value={pct(cfg.bulk_off_2)} onChange={(v) => set("bulk_off_2", v / 100)} />
              <Field label="Tier 3 qty ≥" value={cfg.bulk_min_3} onChange={(v) => set("bulk_min_3", v)} />
              <Field label="Tier 3 % off" value={pct(cfg.bulk_off_3)} onChange={(v) => set("bulk_off_3", v / 100)} />
            </div>
            <p className="sp-note">Discounts are capped at the floor margin, so thin-margin items get smaller (or no) breaks automatically.</p>
          </>
        )}
        <button className="sp-save" disabled={busy} onClick={saveAndReprice}>
          {busy ? "Working…" : "Save & apply"}
        </button>
      </div>

      <div className="sp-actionbar">
        <span>{baitCount} product{baitCount === 1 ? "" : "s"} advertised as deals</span>
        <button className="sp-recompute" disabled={busy} onClick={recompute}>↻ Recompute now</button>
      </div>
      {msg && <p className="sp-msg">{msg}</p>}

      {groups.map((g) => (
        <div className="sp-group" key={g.tier}>
          <div className="sp-group-head">
            <span className={`sp-tier-badge tier-${g.tier}`}>{TIER[g.tier].label}</span>
            <span className="sp-group-note">{TIER[g.tier].note}</span>
          </div>
          {g.items.map((p) => (
            <div className="sp-item" key={p.id}>
              <div className="sp-item-main">
                <span className="sp-item-name">{p.name}</span>
                <span className="sp-item-trend">
                  <Win label="1d" v={p.sold?.d1} /><Win label="3d" v={p.sold?.d3} />
                  <Win label="1w" v={p.sold?.d7} /><Win label="2w" v={p.sold?.d14} />
                  <Win label="1m" v={p.sold?.d30} />
                  {p.speedTier !== "unpriced" && <span className="sp-pace">~{p.velocityScore}/mo pace</span>}
                </span>
                <span className="sp-item-meta">
                  {p.cost != null && <>cost ₹{Math.round(p.cost)} · </>}
                  {p.mrp != null && <>MRP ₹{Math.round(p.mrp)}</>}
                </span>
              </div>
              <div className="sp-item-price">
                <strong>₹{Math.round(p.price)}</strong>
                {p.cost != null && p.price > 0 && (
                  <span className="sp-item-margin">{Math.round(((p.price - p.cost) / p.price) * 100)}%</span>
                )}
                {Array.isArray(p.bulkTiers) && p.bulkTiers.length > 0 && (
                  <span className="sp-item-bulk">
                    {p.bulkTiers.map((t) => `${t.q}+ ₹${t.price}`).join(" · ")}
                  </span>
                )}
              </div>
              {g.tier !== "unpriced" && (
                <div className="sp-item-bait">
                  <button
                    className={`sp-bait-btn pin ${p.baitOverride === "pin" ? "on" : ""} ${p.bait && p.baitOverride !== "hide" ? "live" : ""}`}
                    onClick={() => override(p, "pin")}
                    title="Always advertise" aria-label="Always advertise"
                  ><Ic name="broadcast" size={16} /></button>
                  <button
                    className={`sp-bait-btn hide ${p.baitOverride === "hide" ? "on" : ""}`}
                    onClick={() => override(p, "hide")}
                    title="Never advertise" aria-label="Never advertise"
                  ><Ic name="x" size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Win({ label, v }) {
  return (
    <span className={`sp-win ${v > 0 ? "hit" : ""}`}>
      <b>{v ?? 0}</b><em>{label}</em>
    </span>
  );
}

function Field({ label, value, onChange, hint }) {
  return (
    <label className="sp-field">
      <span>{label}{hint && <em> {hint}</em>}</span>
      <input
        type="number"
        min="0"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
    </label>
  );
}
