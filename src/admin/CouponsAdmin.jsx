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
      <MembershipSettings settings={settings} />
      <MemberPricingSettings settings={settings} />
      <LifecycleSettings settings={settings} />
      <CouponManager coupons={coupons} categories={categories} />
    </div>
  );
}

// New-customer honeymoon: generous first orders that taper to a non-zero floor.
// Applies to everyone; Prime always gets the stronger curve.
function LifecycleSettings({ settings }) {
  const cfg = settings.rewards?.lifecycle || {};
  const m = cfg.member || {};
  const fp = cfg.floorPct || {};
  const [form, setForm] = useState({
    enabled: cfg.enabled ?? true,
    welcomeOrders: cfg.welcomeOrders ?? 5,
    taperOrders: cfg.taperOrders ?? 15,
    shopFloorRupees: cfg.shopFloorRupees ?? 6,
    shopFloorPct: cfg.shopFloorPct ?? 3,
    normalPct: cfg.normalPct ?? 55,
    m_boost: m.pointsBoost ?? 2.5, m_disc: m.discPct ?? 12, m_discMax: m.discMax ?? 60,
    fl_normal: fp.normal ?? 3, fl_prime: fp.prime ?? 8, fl_renew: fp.renew ?? 15,
  });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };
  const num = (v) => Math.max(0, Number(v) || 0);

  function save() {
    updateSettings({
      rewards: {
        ...(settings.rewards || {}),
        lifecycle: {
          ...(settings.rewards?.lifecycle || {}),
          enabled: !!form.enabled,
          welcomeOrders: Math.max(0, Math.round(num(form.welcomeOrders))),
          taperOrders: Math.max(1, Math.round(num(form.taperOrders))),
          shopFloorRupees: num(form.shopFloorRupees),
          shopFloorPct: num(form.shopFloorPct),
          normalPct: Math.min(100, num(form.normalPct)),
          member: { pointsBoost: num(form.m_boost), discPct: num(form.m_disc), discMax: num(form.m_discMax) },
          floorPct: { normal: Math.min(100, num(form.fl_normal)), prime: Math.min(100, num(form.fl_prime)), renew: Math.min(100, num(form.fl_renew)) },
        },
      },
    });
    setSaved(true);
  }

  return (
    <section className="panel offer-card">
      <h3>New-member rewards (honeymoon)</h3>
      <p className="sub">
        A new member gets boosted points/wallet + a welcome discount for their first orders, tapering
        little by little to a permanent floor (never zero). Set the <b>Prime</b> perk once; a <b>Normal</b>
        member (hasn't bought membership) automatically gets a share of it. A new Prime member's own fee
        funds their honeymoon, so they always come out ahead — and every giveaway is capped by real profit.
      </p>
      <label className="preg-ev" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>Turn on new-member boost</span>
      </label>
      <div className="rewards-rule">
        <span>Full boost for first</span>
        <input type="number" min="0" value={form.welcomeOrders} onChange={(e) => set("welcomeOrders", e.target.value)} />
        <span>orders, then taper over</span>
        <input type="number" min="1" value={form.taperOrders} onChange={(e) => set("taperOrders", e.target.value)} />
        <span>orders.</span>
      </div>
      <div className="rewards-rule">
        <span>Always keep at least ₹</span>
        <input type="number" min="0" value={form.shopFloorRupees} onChange={(e) => set("shopFloorRupees", e.target.value)} />
        <span>or</span>
        <input type="number" min="0" value={form.shopFloorPct} onChange={(e) => set("shopFloorPct", e.target.value)} />
        <span>% profit per order.</span>
      </div>
      <p className="sub" style={{ margin: "10px 0 4px", fontWeight: 700 }}>Peak perk (a new member starts at 100% of this)</p>
      <div className="rewards-rule">
        <span>Prime points/wallet ×</span>
        <input type="number" step="0.1" value={form.m_boost} onChange={(e) => set("m_boost", e.target.value)} />
        <span>· discount</span>
        <input type="number" value={form.m_disc} onChange={(e) => set("m_disc", e.target.value)} />
        <span>% · max ₹</span>
        <input type="number" value={form.m_discMax} onChange={(e) => set("m_discMax", e.target.value)} />
      </div>
      <div className="rewards-rule">
        <span>Normal member gets</span>
        <input type="number" min="0" max="100" value={form.normalPct} onChange={(e) => set("normalPct", e.target.value)} />
        <span>% of the Prime peak (50–60% recommended).</span>
      </div>
      <p className="sub" style={{ margin: "10px 0 4px", fontWeight: 700 }}>Settles to (% of the peak — never zero)</p>
      <div className="rewards-rule">
        <span>Normal</span>
        <input type="number" min="0" max="100" value={form.fl_normal} onChange={(e) => set("fl_normal", e.target.value)} />
        <span>% · New Prime</span>
        <input type="number" min="0" max="100" value={form.fl_prime} onChange={(e) => set("fl_prime", e.target.value)} />
        <span>% · Renewed Prime</span>
        <input type="number" min="0" max="100" value={form.fl_renew} onChange={(e) => set("fl_renew", e.target.value)} />
        <span>%.</span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
        <button className="primary-btn" onClick={save}>Save new-member rewards</button>
        {saved && <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>✅ Saved</span>}
      </div>
    </section>
  );
}

// NGS Prime member pricing — the two invisible modes. These dials feed
// smart_reprice(), which reshuffles every product's member factor each cycle.
function MemberPricingSettings({ settings }) {
  const cfg = settings.rewards?.member || {};
  const [form, setForm] = useState({
    enabled: cfg.enabled ?? true,
    markupPct: cfg.markupPct ?? 6,
    dipMax: cfg.dipMax ?? 3,
    modeASharePct: cfg.modeASharePct ?? 55,
    rewardBackPct: cfg.rewardBackPct ?? 60,
  });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };

  function save() {
    updateSettings({
      rewards: {
        ...(settings.rewards || {}),
        member: {
          enabled: !!form.enabled,
          markupPct: Math.min(50, Math.max(0, Number(form.markupPct) || 0)),
          dipMax: Math.min(50, Math.max(0, Number(form.dipMax) || 0)),
          modeASharePct: Math.min(100, Math.max(0, Number(form.modeASharePct) || 0)),
          rewardBackPct: Math.min(100, Math.max(0, Number(form.rewardBackPct) || 0)),
        },
      },
    });
    setSaved(true);
  }

  return (
    <section className="panel offer-card">
      <h3>Prime member pricing</h3>
      <p className="sub">
        Members see only their own price, so it just feels like good deals. Some items are marked up a little
        (60% of the extra comes back to them as points/wallet, the rest funds their free delivery); others are
        a little cheaper with normal rewards. Reshuffles automatically every few hours — nothing is given from your pocket.
      </p>
      <label className="preg-ev" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>Turn on member pricing</span>
      </label>
      <div className="rewards-rule">
        <span>Mark up (max)</span>
        <input type="number" min="0" max="50" value={form.markupPct} onChange={(e) => set("markupPct", e.target.value)} />
        <span>% · discount up to</span>
        <input type="number" min="0" max="50" value={form.dipMax} onChange={(e) => set("dipMax", e.target.value)} />
        <span>%.</span>
      </div>
      <div className="rewards-rule">
        <span>Mark up on</span>
        <input type="number" min="0" max="100" value={form.modeASharePct} onChange={(e) => set("modeASharePct", e.target.value)} />
        <span>% of items · give back</span>
        <input type="number" min="0" max="100" value={form.rewardBackPct} onChange={(e) => set("rewardBackPct", e.target.value)} />
        <span>% of the extra.</span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
        <button className="primary-btn" onClick={save}>Save member pricing</button>
        {saved && <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>✅ Saved · applies at next reprice</span>}
      </div>
    </section>
  );
}

function MembershipSettings({ settings }) {
  const cfg = settings.rewards?.membership || {};
  const [form, setForm] = useState({
    enabled: cfg.enabled ?? true,
    price: cfg.price ?? 99,
    mrp: cfg.mrp ?? 199,
    days: cfg.days ?? 30,
  });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };

  function save() {
    updateSettings({
      rewards: {
        ...(settings.rewards || {}),
        membership: {
          enabled: !!form.enabled,
          price: Math.max(0, Number(form.price) || 0),
          mrp: Math.max(0, Number(form.mrp) || 0),
          days: Math.max(1, Number(form.days) || 1),
        },
      },
    });
    setSaved(true);
  }

  return (
    <section className="panel offer-card">
      <h3>NGS Prime membership</h3>
      <p className="sub">Customers pay from their NGS Wallet to join. Members get free delivery on normal days. (We'll add more perks next.)</p>
      <label className="preg-ev" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>Offer membership to customers</span>
      </label>
      <div className="rewards-rule">
        <span>Price ₹</span>
        <input type="number" min="0" value={form.price} onChange={(e) => set("price", e.target.value)} />
        <span>for</span>
        <input type="number" min="1" value={form.days} onChange={(e) => set("days", e.target.value)} />
        <span>days.</span>
      </div>
      <div className="rewards-rule">
        <span>Show original price ₹</span>
        <input type="number" min="0" value={form.mrp} onChange={(e) => set("mrp", e.target.value)} />
        <span>crossed out (₹{form.mrp} → ₹{form.price}).</span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
        <button className="primary-btn" onClick={save}>Save membership</button>
        {saved && <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>✅ Saved</span>}
      </div>
    </section>
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
