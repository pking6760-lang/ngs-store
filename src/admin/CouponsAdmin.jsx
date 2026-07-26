import { useMemo, useState } from "react";
import { Ic } from "./AdminIcons.jsx";
import { useCoupons, useSettings, useCategories, useProducts } from "../lib/hooks.js";
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
      <LifecycleSettings settings={settings} />
      <CouponManager coupons={coupons} categories={categories} />
    </div>
  );
}

// Member honeymoon + tiered pricing. New Prime gets the deepest prices; Renewal
// a middle deal; Normal the smallest. After each tier's order limit the price
// rises little-by-little to its settled level, and points/scratch switch to the
// 5-order surprise bag. Defaults are pre-balanced — change only if you're sure.
function LifecycleSettings({ settings }) {
  const cfg = settings.rewards?.lifecycle || {};
  const W = cfg.windows || {};
  const P = cfg.pricing || {};
  const [form, setForm] = useState({
    enabled: cfg.enabled ?? true,
    w_normal: W.normal ?? 6, w_prime: W.prime ?? 10, w_renew: W.renew ?? 7,
    taperOrders: cfg.taperOrders ?? 15,
    shopFloorRupees: cfg.shopFloorRupees ?? 6,
    shopFloorPct: cfg.shopFloorPct ?? 3,
    deepMarginPct: P.deepMarginPct ?? 7,
    maxDiscountPct: P.maxDiscountPct ?? 20,
    pr_s: P.prime?.start ?? 25, pr_e: P.prime?.end ?? 75,
    rn_s: P.renew?.start ?? 50, rn_e: P.renew?.end ?? 75,
    no_s: P.normal?.start ?? 75, no_e: P.normal?.end ?? 100,
  });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };
  const num = (v) => Math.max(0, Number(v) || 0);
  const pct = (v) => Math.min(100, num(v));

  function save() {
    updateSettings({
      rewards: {
        ...(settings.rewards || {}),
        lifecycle: {
          ...(settings.rewards?.lifecycle || {}),
          enabled: !!form.enabled,
          taperOrders: Math.max(1, Math.round(num(form.taperOrders))),
          shopFloorRupees: num(form.shopFloorRupees),
          shopFloorPct: num(form.shopFloorPct),
          windows: {
            normal: Math.max(0, Math.round(num(form.w_normal))),
            prime: Math.max(0, Math.round(num(form.w_prime))),
            renew: Math.max(0, Math.round(num(form.w_renew))),
          },
          pricing: {
            ...(cfg.pricing || {}),
            enabled: true,
            deepMarginPct: num(form.deepMarginPct),
            maxDiscountPct: pct(form.maxDiscountPct),
            prime: { start: pct(form.pr_s), end: pct(form.pr_e) },
            renew: { start: pct(form.rn_s), end: pct(form.rn_e) },
            normal: { start: pct(form.no_s), end: pct(form.no_e) },
          },
        },
      },
    });
    setSaved(true);
  }

  return (
    <section className="panel offer-card">
      <h3>Member pricing &amp; honeymoon</h3>
      <p className="sub">
        Each member type sees its own price between your buying price and the MRP —
        <b> New Prime deepest, Renewal middle, Normal smallest</b> — rising to the
        settled level after their order limit. 0% = cost + minimum margin, 100% = MRP.
        No item ever sells below cost.
      </p>
      <label className="preg-ev" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>Turn on member pricing &amp; honeymoon</span>
      </label>
      <div className="rewards-rule">
        <span>Order limit: Normal</span>
        <input type="number" min="0" value={form.w_normal} onChange={(e) => set("w_normal", e.target.value)} />
        <span>· New Prime</span>
        <input type="number" min="0" value={form.w_prime} onChange={(e) => set("w_prime", e.target.value)} />
        <span>· Renewal</span>
        <input type="number" min="0" value={form.w_renew} onChange={(e) => set("w_renew", e.target.value)} />
        <span>orders, then ease over</span>
        <input type="number" min="1" value={form.taperOrders} onChange={(e) => set("taperOrders", e.target.value)} />
        <span>orders.</span>
      </div>
      <div className="rewards-rule">
        <span>Deepest price = cost +</span>
        <input type="number" min="0" value={form.deepMarginPct} onChange={(e) => set("deepMarginPct", e.target.value)} />
        <span>% margin · but never more than</span>
        <input type="number" min="0" max="100" value={form.maxDiscountPct} onChange={(e) => set("maxDiscountPct", e.target.value)} />
        <span>% off MRP.</span>
      </div>
      <div className="rewards-rule">
        <span>Always keep ≥ ₹</span>
        <input type="number" min="0" value={form.shopFloorRupees} onChange={(e) => set("shopFloorRupees", e.target.value)} />
        <span>or</span>
        <input type="number" min="0" value={form.shopFloorPct} onChange={(e) => set("shopFloorPct", e.target.value)} />
        <span>% profit per order.</span>
      </div>
      <p className="sub" style={{ margin: "10px 0 4px", fontWeight: 700 }}>Price position (0% deepest → 100% MRP): start → settled</p>
      <div className="rewards-rule">
        <span>New Prime</span>
        <input type="number" min="0" max="100" value={form.pr_s} onChange={(e) => set("pr_s", e.target.value)} />
        <span>→</span>
        <input type="number" min="0" max="100" value={form.pr_e} onChange={(e) => set("pr_e", e.target.value)} />
        <span>% · Renewal</span>
        <input type="number" min="0" max="100" value={form.rn_s} onChange={(e) => set("rn_s", e.target.value)} />
        <span>→</span>
        <input type="number" min="0" max="100" value={form.rn_e} onChange={(e) => set("rn_e", e.target.value)} />
        <span>% · Normal</span>
        <input type="number" min="0" max="100" value={form.no_s} onChange={(e) => set("no_s", e.target.value)} />
        <span>→</span>
        <input type="number" min="0" max="100" value={form.no_e} onChange={(e) => set("no_e", e.target.value)} />
        <span>%.</span>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        After the limit, points &amp; scratch run the 5-order surprise mix automatically
        (Normal: 3 low · 1 mid · 1 high — Prime: 2 low · 2 mid · 1 high).
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
        <button className="primary-btn" onClick={save}>Save member pricing</button>
        {saved && <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>Saved</span>}
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
        {saved && <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>Saved</span>}
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
        {saved && <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>Saved</span>}
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
          <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>Saved</span>
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
        placeholder="e.g. Diwali sale — 10% off with code NISHA10"
      />
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button className="primary-btn" onClick={save}>
          Save banner
        </button>
        {saved && <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>Saved</span>}
      </div>
    </section>
  );
}

function CouponManager({ coupons, categories }) {
  const products = useProducts();
  const emptyForm = {
    code: "",
    type: "percent",
    value: "",
    minOrder: "",
    category: "",
    singleUse: false,
    guaranteed: false,
    excludedCategories: [],
    excludedProducts: [],
  };
  const [form, setForm] = useState(emptyForm);
  const [prodQuery, setProdQuery] = useState("");
  const [error, setError] = useState("");

  const catName = (id) => categories.find((c) => c.id === id)?.name || id;
  const prodName = (id) => products.find((p) => p.id === id)?.name || id;

  // Product search for exclusions — top matches not already excluded.
  const prodMatches = useMemo(() => {
    const q = prodQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter((p) => p.name?.toLowerCase().includes(q) && !form.excludedProducts.includes(p.id))
      .slice(0, 6);
  }, [prodQuery, products, form.excludedProducts]);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setError("");
  }
  function toggleExCat(id) {
    set("excludedCategories", form.excludedCategories.includes(id)
      ? form.excludedCategories.filter((c) => c !== id)
      : [...form.excludedCategories, id]);
  }

  async function add(e) {
    e.preventDefault();
    const res = await upsertCoupon(form);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setForm(emptyForm);
    setProdQuery("");
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
        <Dropdown
          title="Payout"
          value={form.guaranteed ? "exact" : "upto"}
          onChange={(v) => set("guaranteed", v === "exact")}
          options={[
            { value: "upto", label: "Up to (protects your margin)" },
            { value: "exact", label: "Exact — always pay in full" },
          ]}
        />
        <p className="coupon-cap-note">
          {form.guaranteed ? (
            <>
              <b>Exact.</b> The customer always gets the full{" "}
              {form.type === "percent" ? `${form.value || 0}%` : `₹${form.value || 0}`}. On a
              thin-margin cart that can exceed what the order earns, so you take the loss.
            </>
          ) : (
            <>
              <b>Up to.</b> The discount never exceeds the margin on the cart, so you
              can't be sold below cost. Shown as “up to{" "}
              {form.type === "percent" ? `${form.value || 0}%` : `₹${form.value || 0}`} off”, with
              the exact amount visible before they pay.
            </>
          )}
        </p>
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

        <label className="preg-ev full" style={{ margin: "2px 0" }}>
          <input type="checkbox" checked={form.singleUse}
            onChange={(e) => set("singleUse", e.target.checked)} />
          <span>One-time use — once per customer <b>and</b> once per device (a farmer
            can't re-use it from new accounts on the same phone)</span>
        </label>

        <div className="coupon-excl full">
          <span className="coupon-excl-label">Doesn't qualify (excluded) — these items neither
            count toward the minimum nor get the discount:</span>
          <div className="coupon-excl-chips">
            {categories.map((c) => (
              <button type="button" key={c.id}
                className={`coupon-chip ${form.excludedCategories.includes(c.id) ? "on" : ""}`}
                onClick={() => toggleExCat(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
          <input
            value={prodQuery}
            onChange={(e) => setProdQuery(e.target.value)}
            placeholder="Exclude a single product — type to search…"
          />
          {prodMatches.length > 0 && (
            <div className="coupon-excl-hits">
              {prodMatches.map((p) => (
                <button type="button" key={p.id} onClick={() => {
                  set("excludedProducts", [...form.excludedProducts, p.id]);
                  setProdQuery("");
                }}>+ {p.name}</button>
              ))}
            </div>
          )}
          {form.excludedProducts.length > 0 && (
            <div className="coupon-excl-chips">
              {form.excludedProducts.map((id) => (
                <button type="button" key={id} className="coupon-chip on"
                  onClick={() => set("excludedProducts", form.excludedProducts.filter((x) => x !== id))}>
                  {prodName(id)} ✕
                </button>
              ))}
            </div>
          )}
        </div>

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
                <div className="coupon-code">{c.code}</div>
                <div className="coupon-desc">
                  {c.guaranteed
                    ? (c.type === "percent" ? `${c.value}% off (exact)` : `₹${c.value} off (exact)`)
                    : (c.type === "percent" ? `up to ${c.value}% off` : `up to ₹${c.value} off`)}
                  {c.category ? ` · only ${catName(c.category)}` : ""}
                  {c.minOrder > 0 ? ` · min ₹${c.minOrder}` : ""}
                  {c.singleUse ? " · one-time per customer/device" : ""}
                  {(c.excludedCategories?.length || 0) + (c.excludedProducts?.length || 0) > 0
                    ? ` · excludes ${[
                        ...(c.excludedCategories || []).map(catName),
                        ...(c.excludedProducts || []).map(prodName),
                      ].join(", ")}`
                    : ""}
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
                <Ic name="trash" size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
