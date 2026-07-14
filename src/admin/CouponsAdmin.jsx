import { useState } from "react";
import { useCoupons, useSettings, useCategories } from "../lib/hooks.js";
import { upsertCoupon, deleteCoupon, updateSettings } from "../lib/actions.js";
import Dropdown from "./Dropdown.jsx";

export default function CouponsAdmin() {
  const coupons = useCoupons();
  const settings = useSettings();
  const categories = useCategories();

  return (
    <div className="offers-wrap">
      <OfferBanner settings={settings} />
      <RewardsSettings settings={settings} />
      <ScratchSettings settings={settings} />
      <CouponManager coupons={coupons} categories={categories} />
    </div>
  );
}

function ScratchSettings({ settings }) {
  const cfg = settings.rewards?.scratch || {};
  const [form, setForm] = useState({
    enabled: cfg.enabled ?? true,
    pointsSharePct: cfg.pointsSharePct ?? 30,
    highMarginRupees: cfg.highMarginRupees ?? 20,
    walletCutPct: cfg.walletCutPct ?? 10,
    walletMaxRupees: cfg.walletMaxRupees ?? 8,
    minOrder: cfg.minOrder ?? 0,
  });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };

  function save() {
    updateSettings({
      rewards: {
        ...(settings.rewards || {}),
        scratch: {
          enabled: !!form.enabled,
          pointsSharePct: Math.min(100, Math.max(0, Number(form.pointsSharePct) || 0)),
          highMarginRupees: Math.max(0, Number(form.highMarginRupees) || 0),
          walletCutPct: Math.min(100, Math.max(0, Number(form.walletCutPct) || 0)),
          walletMaxRupees: Math.max(0, Number(form.walletMaxRupees) || 0),
          minOrder: Math.max(0, Number(form.minOrder) || 0),
        },
      },
    });
    setSaved(true);
  }

  return (
    <section className="panel offer-card">
      <h3>Scratch card reward</h3>
      <p className="sub">After delivery the customer scratches a card. The reward comes out of the margin you already made — never a loss.</p>

      <label className="preg-ev" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>Show a scratch card after delivery</span>
      </label>

      <div className="rewards-rule">
        <span>Hold</span>
        <input type="number" min="0" max="100" value={form.pointsSharePct} onChange={(e) => set("pointsSharePct", e.target.value)} />
        <span>% of the points a customer earns for the scratch card (the rest is given right away).</span>
      </div>

      <p className="sub" style={{ marginTop: 10, marginBottom: 4, fontWeight: 700 }}>Wallet cash from high-margin items</p>
      <div className="rewards-rule">
        <span>An item counts as high-margin when you make over ₹</span>
        <input type="number" min="0" value={form.highMarginRupees} onChange={(e) => set("highMarginRupees", e.target.value)} />
        <span>profit on it.</span>
      </div>
      <div className="rewards-rule">
        <span>Give back</span>
        <input type="number" min="0" max="100" value={form.walletCutPct} onChange={(e) => set("walletCutPct", e.target.value)} />
        <span>% of that margin as wallet cash, up to ₹</span>
        <input type="number" min="0" value={form.walletMaxRupees} onChange={(e) => set("walletMaxRupees", e.target.value)} />
        <span>per order.</span>
      </div>
      <div className="rewards-rule">
        <span>Only orders of at least ₹</span>
        <input type="number" min="0" value={form.minOrder} onChange={(e) => set("minOrder", e.target.value)} />
        <span>get a scratch card.</span>
      </div>

      <p className="rewards-preview">
        Example: a customer buys an item you make <strong>₹{Math.max(form.highMarginRupees, 40)} profit</strong> on →
        scratch gives about <strong>₹{Math.min(Math.round(Math.max(form.highMarginRupees, 40) * (Number(form.walletCutPct) || 0) / 100), Number(form.walletMaxRupees) || 0)}</strong> wallet cash
        plus <strong>{form.pointsSharePct}%</strong> of the order's points.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
        <button className="primary-btn" onClick={save}>Save scratch rule</button>
        {saved && <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>✅ Saved</span>}
      </div>
    </section>
  );
}

function RewardsSettings({ settings }) {
  const cfg = settings.rewards || {};
  const [form, setForm] = useState({
    marginPointsPerRupee: cfg.marginPointsPerRupee ?? 0.4,
    pointsMinMarginPct: cfg.pointsMinMarginPct ?? 12,
    redeemPer: cfg.redeemPer ?? 10,
    maxRedeemPct: cfg.maxRedeemPct ?? 20,
  });
  const [saved, setSaved] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }

  function save() {
    updateSettings({
      rewards: {
        ...cfg, // keep any legacy fields
        marginPointsPerRupee: Math.max(0, Number(form.marginPointsPerRupee) || 0),
        pointsMinMarginPct: Math.max(0, Number(form.pointsMinMarginPct) || 0),
        redeemPer: Math.max(1, Number(form.redeemPer) || 1),
        maxRedeemPct: Math.min(100, Math.max(0, Number(form.maxRedeemPct) || 0)),
      },
    });
    setSaved(true);
  }

  // Preview: a product with ₹50 profit → points given.
  const previewPts = Math.floor(50 * (Number(form.marginPointsPerRupee) || 0));

  return (
    <section className="panel offer-card">
      <h3>Reward points</h3>
      <p className="sub">Points are earned from your PROFIT — only on items above the margin threshold — and redeemed as money.</p>

      <div className="rewards-rule">
        <span>Give</span>
        <input type="number" min="0" step="0.1" value={form.marginPointsPerRupee}
          onChange={(e) => set("marginPointsPerRupee", e.target.value)} />
        <span>points per ₹1 of profit.</span>
      </div>
      <div className="rewards-rule">
        <span>Only items with margin above</span>
        <input type="number" min="0" value={form.pointsMinMarginPct}
          onChange={(e) => set("pointsMinMarginPct", e.target.value)} />
        <span>% earn points.</span>
      </div>
      <div className="rewards-rule">
        <input type="number" min="1" value={form.redeemPer}
          onChange={(e) => set("redeemPer", e.target.value)} />
        <span>points = ₹1 off at checkout.</span>
      </div>
      <div className="rewards-rule">
        <span>Customers can pay up to</span>
        <input type="number" min="0" max="100" value={form.maxRedeemPct}
          onChange={(e) => set("maxRedeemPct", e.target.value)} />
        <span>% of an order with points.</span>
      </div>

      <p className="rewards-preview">
        Example: a product you make <strong>₹50 profit</strong> on gives{" "}
        <strong>{previewPts} points</strong>
        {" "}(≈ ₹{form.redeemPer ? (previewPts / form.redeemPer).toFixed(1) : 0} back).
        Low-margin staples (milk/curd/bread) earn nothing.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
        <button className="primary-btn" onClick={save}>Save points rule</button>
        {saved && (
          <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>✅ Saved</span>
        )}
      </div>
    </section>
  );
}

function OfferBanner({ settings }) {
  const [text, setText] = useState(settings.offerBanner || "");
  const [saved, setSaved] = useState(false);

  function save() {
    updateSettings({ offerBanner: text });
    setSaved(true);
  }

  return (
    <section className="panel offer-card">
      <h3>Offer banner</h3>
      <p className="sub">Shown across the top of the customer home page. Leave empty to hide it.</p>
      <textarea
        className="offer-banner-input"
        rows={2}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        placeholder="e.g. 🎉 Diwali sale — 10% off with code NISHA10"
      />
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button className="primary-btn" onClick={save}>
          Save banner
        </button>
        {saved && <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>✅ Saved</span>}
      </div>
    </section>
  );
}

function CouponManager({ coupons, categories }) {
  const [form, setForm] = useState({
    code: "",
    type: "percent",
    value: "",
    minOrder: "",
    category: "",
  });
  const [error, setError] = useState("");

  const catName = (id) => categories.find((c) => c.id === id)?.name || id;

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setError("");
  }

  async function add(e) {
    e.preventDefault();
    const res = await upsertCoupon(form);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setForm({ code: "", type: "percent", value: "", minOrder: "", category: "" });
  }

  function toggleActive(c) {
    upsertCoupon({ ...c, active: !c.active });
  }

  return (
    <section className="panel offer-card">
      <h3>Coupons</h3>
      <p className="sub">Discount codes customers type at checkout.</p>

      <form className="coupon-form" onSubmit={add}>
        <input
          className="full"
          value={form.code}
          onChange={(e) => set("code", e.target.value.toUpperCase())}
          placeholder="Code (e.g. NISHA10)"
        />
        <Dropdown
          title="Discount type"
          value={form.type}
          onChange={(v) => set("type", v)}
          options={[
            { value: "percent", label: "% off" },
            { value: "flat", label: "₹ off (flat)" },
          ]}
        />
        <input
          type="number"
          min="0"
          value={form.value}
          onChange={(e) => set("value", e.target.value)}
          placeholder={form.type === "percent" ? "Percent, e.g. 10" : "Amount, e.g. 30"}
        />
        <input
          type="number"
          min="0"
          value={form.minOrder}
          onChange={(e) => set("minOrder", e.target.value)}
          placeholder="Min order ₹ (optional)"
        />
        <Dropdown
          title="Applies to"
          value={form.category}
          onChange={(v) => set("category", v)}
          options={[
            { value: "", label: "Any product" },
            ...categories.map((c) => ({ value: c.id, label: `Only ${c.name}` })),
          ]}
        />
        {error && <div className="auth-error full">{error}</div>}
        <button className="primary-btn full" type="submit">
          Add coupon
        </button>
      </form>

      <div className="coupon-rows">
        {coupons.length === 0 ? (
          <p className="panel-empty">No coupons yet.</p>
        ) : (
          coupons.map((c) => (
            <div className="coupon-rowc" key={c.code}>
              <div>
                <div className="coupon-code">🎟️ {c.code}</div>
                <div className="coupon-desc">
                  {c.type === "percent" ? `${c.value}% off` : `₹${c.value} off`}
                  {c.category ? ` · only ${catName(c.category)}` : ""}
                  {c.minOrder > 0 ? ` · min ₹${c.minOrder}` : ""}
                </div>
              </div>
              <span className="spacer" />
              <button
                className={`coupon-active ${c.active ? "on" : "off"}`}
                onClick={() => toggleActive(c)}
                title="Turn on/off"
              >
                {c.active ? "Active" : "Off"}
              </button>
              <button
                className="coupon-del"
                onClick={() => {
                  if (confirm(`Delete coupon ${c.code}?`)) deleteCoupon(c.code);
                }}
                aria-label={`Delete ${c.code}`}
              >
                🗑️
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
