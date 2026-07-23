import { useMemo } from "react";
import { Ic } from "./AdminIcons.jsx";
import { updateSettings } from "../lib/actions.js";

// ── Owner autopilot ──────────────────────────────────────────────────────────
// Turns the shop's own sales data into daily decisions:
//   • Reorder now — what to restock, sized from how fast it actually sells.
//   • Today / tomorrow prep — milk & subscription quantities to arrange.
//   • Insights — profit leaders and items that aren't moving.
// Reads adminProducts (which already carry cost + stock + sold {d7,d14,d30}).

const dayKey = (d) => { try { return new Date(d).toLocaleDateString("en-CA"); } catch { return ""; } };

export default function Autopilot({ adminProducts, orders, settings, onNavigate }) {
  const threshold = settings.lowStockThreshold ?? 5;

  // Sales pace per product → reorder list, sized to a week of cover.
  const reorder = useMemo(() => {
    return adminProducts
      .map((p) => {
        const d7 = p.sold?.d7 ?? 0;
        const d30 = p.sold?.d30 ?? 0;
        const perDay = d7 > 0 ? d7 / 7 : d30 / 30; // prefer recent pace
        const stock = typeof p.stock === "number" ? p.stock : null;
        const cover = perDay > 0 && stock != null ? stock / perDay : null;
        const out = p.inStock === false;
        const low = stock != null && stock <= threshold;
        const thin = cover != null && cover < 3;
        const suggest = Math.max(1, Math.ceil(perDay * 7) - (stock ?? 0));
        return { id: p.id, name: p.name, unit: p.unit, perDay, stock, cover, out, suggest, need: out || low || thin };
      })
      .filter((p) => p.need)
      .sort((a, b) => {
        if (a.out !== b.out) return a.out ? -1 : 1;                 // out of stock first
        const ac = a.cover == null ? 1e9 : a.cover, bc = b.cover == null ? 1e9 : b.cover;
        if (ac !== bc) return ac - bc;                              // then least cover
        return (a.stock ?? 0) - (b.stock ?? 0);
      });
  }, [adminProducts, threshold]);

  // Subscription (milk) quantities due today & tomorrow, so the owner buys right.
  const forecast = useMemo(() => {
    const now = Date.now();
    const t = new Date(now); t.setDate(t.getDate() + 1);
    const todayK = dayKey(now), tmrwK = dayKey(t.getTime());
    const bucket = (key) => {
      const rows = {}; let count = 0;
      orders.forEach((o) => {
        if (!o.subscriptionId || o.isSubscription) return;         // only daily plan drops
        if (o.status === "Cancelled" || o.status === "Returned") return;
        if (!o.deliverOn || dayKey(o.deliverOn) !== key) return;
        count += 1;
        (o.items || []).forEach((it) => {
          const r = rows[it.id] || (rows[it.id] = { name: it.name, qty: 0 });
          r.qty += it.qty;
        });
      });
      return { count, items: Object.values(rows).sort((a, b) => b.qty - a.qty) };
    };
    return { today: bucket(todayK), tomorrow: bucket(tmrwK) };
  }, [orders]);

  // 7-day profit leaders (price − cost × units sold) and the fastest movers to
  // keep stocked.
  const { leaders, fast } = useMemo(() => {
    const leaders = adminProducts
      .filter((p) => p.cost != null && (p.sold?.d7 ?? 0) > 0)
      .map((p) => ({ id: p.id, name: p.name, d7: p.sold.d7, profit: Math.round((p.price - p.cost) * p.sold.d7) }))
      .filter((p) => p.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);
    const fast = adminProducts
      .filter((p) => (p.sold?.d7 ?? 0) > 0 && p.inStock !== false)
      .map((p) => ({ id: p.id, name: p.name, d7: p.sold.d7 }))
      .sort((a, b) => b.d7 - a.d7)
      .slice(0, 4);
    return { leaders, fast };
  }, [adminProducts]);

  const cover = (c) => (c == null ? null : c < 1 ? "<1d cover" : `${Math.round(c)}d cover`);
  const pace = (n) => (n >= 1 ? `sells ~${n < 10 ? n.toFixed(1) : Math.round(n)}/day` : n > 0 ? "sells slowly" : "no recent sales");

  return (
    <div className="ap">
      <div className="ap-head">
        <span className="ap-badge"><Ic name="flame" size={15} /> Owner autopilot</span>
        <span className="ap-hint">from your last 7 days of sales</span>
      </div>

      {/* Reorder now */}
      <section className="panel ap-panel">
        <div className="panel-head">
          <h3><Ic name="box" size={16} /> Reorder now {reorder.length > 0 && <span className="ap-count">{reorder.length}</span>}</h3>
          <label className="lowstock-thresh">
            Alert ≤
            <input type="number" min="0" value={threshold}
              onChange={(e) => updateSettings({ lowStockThreshold: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
        {reorder.length === 0 ? (
          <>
            <p className="panel-empty">Nothing marked out of stock. Fastest movers to keep stocked:</p>
            {fast.length > 0 && (
              <div className="ap-fast">
                {fast.map((p) => (
                  <span className="ap-fast-tag" key={p.id}>{p.name} <b>{p.d7}</b></span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="ap-list">
            {reorder.map((p) => (
              <button key={p.id} className="ap-row" onClick={() => onNavigate("products")}>
                <span className="ap-row-main">
                  <span className="ap-row-name">{p.name}</span>
                  <span className="ap-row-sub">
                    {pace(p.perDay)}{p.stock != null ? ` · ${p.stock} left` : ""}{cover(p.cover) ? ` · ${cover(p.cover)}` : ""}
                  </span>
                </span>
                {p.out
                  ? <span className="ap-tag out">Out{p.perDay > 0 ? ` — order ~${p.suggest}` : ""}</span>
                  : <span className="ap-tag order">Order ~{p.suggest}</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Today / tomorrow prep (subscriptions / milk) */}
      {(forecast.today.count > 0 || forecast.tomorrow.count > 0) && (
        <section className="panel ap-panel">
          <div className="panel-head"><h3><Ic name="delivery" size={16} /> Prep for scheduled deliveries</h3></div>
          <div className="ap-prep">
            {[["Today", forecast.today], ["Tomorrow", forecast.tomorrow]].map(([label, f]) => (
              <div className="ap-prep-day" key={label}>
                <div className="ap-prep-h">{label} <span>{f.count} {f.count === 1 ? "delivery" : "deliveries"}</span></div>
                {f.items.length === 0 ? (
                  <div className="ap-prep-empty">Nothing scheduled.</div>
                ) : (
                  <div className="ap-prep-items">
                    {f.items.map((it, i) => (
                      <span className="ap-prep-item" key={i}><b>{it.qty}×</b> {it.name}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Insights: profit leaders */}
      {leaders.length > 0 && (
        <section className="panel ap-panel">
          <div className="panel-head">
            <h3><Ic name="revenue" size={16} /> Top earners · 7 days</h3>
            <span className="dash-sub">profit after cost</span>
          </div>
          <div className="ap-lead">
            {leaders.map((p, i) => (
              <div className="ap-lead-row" key={p.id}>
                <span className="ap-lead-rank">{i + 1}</span>
                <span className="ap-lead-name">{p.name}</span>
                <span className="ap-lead-meta">{p.d7} sold · <strong>₹{p.profit}</strong></span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
