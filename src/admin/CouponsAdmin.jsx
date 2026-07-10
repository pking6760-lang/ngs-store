import { useState } from "react";
import { useCoupons, useSettings, useCategories } from "../lib/hooks.js";
import { upsertCoupon, deleteCoupon, updateSettings } from "../lib/store.js";

export default function CouponsAdmin() {
  const coupons = useCoupons();
  const settings = useSettings();
  const categories = useCategories();

  return (
    <div className="offers-wrap">
      <OfferBanner settings={settings} />
      <CouponManager coupons={coupons} categories={categories} />
    </div>
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

  function add(e) {
    e.preventDefault();
    const res = upsertCoupon(form);
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
        <select value={form.type} onChange={(e) => set("type", e.target.value)}>
          <option value="percent">% off</option>
          <option value="flat">₹ off (flat)</option>
        </select>
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
        <select
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
        >
          <option value="">Any product</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              Only {c.name}
            </option>
          ))}
        </select>
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
