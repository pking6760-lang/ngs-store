import { useMemo } from "react";
import { useProducts, useAdminProducts, useOrders, useCategories, useSettings } from "../lib/hooks.js";
import { updateSettings } from "../lib/actions.js";

export default function Dashboard({ onNavigate }) {
  const products = useProducts();
  const adminProducts = useAdminProducts(); // carries buying cost (admin-only)
  const orders = useOrders();
  const categories = useCategories();
  const settings = useSettings();
  const threshold = settings.lowStockThreshold ?? 5;

  // Buying cost per product, for the profit figure.
  const costMap = useMemo(() => {
    const m = {};
    adminProducts.forEach((p) => { if (p.cost != null) m[p.id] = p.cost; });
    return m;
  }, [adminProducts]);

  // Items that need restocking: marked out of stock, or a stock count at/below
  // the alert threshold.
  const lowStock = useMemo(() => {
    return products
      .filter(
        (p) =>
          p.inStock === false ||
          (typeof p.stock === "number" && p.stock <= threshold)
      )
      .sort((a, b) => (a.stock ?? -1) - (b.stock ?? -1));
  }, [products, threshold]);

  const stats = useMemo(() => {
    // "Today's" figures — computed from each order's date, so they reset to
    // zero automatically at the start of a new day.
    const todaysOrders = orders.filter(
      (o) => isToday(o.createdAt) && o.status !== "Cancelled" && !o.isReturn
    );
    const revenue = todaysOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    // Gross product profit = (selling − buying cost) × qty over today's items
    // whose cost is known. It's a margin estimate (fees/payouts not deducted).
    let grossMargin = 0, sold = 0;
    todaysOrders.forEach((o) => (o.items || []).forEach((it) => {
      const c = costMap[it.id];
      if (c != null) { grossMargin += (it.price - c) * it.qty; sold += it.price * it.qty; }
    }));
    // Money the shop gives back today: points redeemed as ₹ off, coupons, and
    // refunds to wallet. These come out of profit.
    const rewardsGiven = todaysOrders.reduce((s, o) => s + (o.pointsDiscount || 0), 0);
    const couponsGiven = todaysOrders.reduce((s, o) => s + (o.couponDiscount || 0), 0);
    const refunds = todaysOrders.reduce((s, o) => s + (o.refundedAmount || 0), 0);
    const walletUsed = todaysOrders.reduce((s, o) => s + (o.walletUsed || 0), 0);
    // Net profit nets out the discounts the shop funds + refunds.
    const profit = grossMargin - rewardsGiven - couponsGiven - refunds;
    const givenBack = rewardsGiven + couponsGiven + refunds;
    // Pending = anything not yet delivered (still needs action), any day.
    const pending = orders.filter(
      (o) => o.status !== "Delivered" && o.status !== "Cancelled" && o.status !== "Returned"
    ).length;
    return {
      orders: todaysOrders.length,
      revenue,
      profit: Math.round(profit),
      marginPct: sold > 0 ? (profit / sold) * 100 : null,
      pending,
      rewardsGiven: Math.round(rewardsGiven),
      couponsGiven: Math.round(couponsGiven),
      refunds: Math.round(refunds),
      walletUsed: Math.round(walletUsed),
      givenBack: Math.round(givenBack),
    };
  }, [orders, costMap]);

  // Best sellers over the last 7 days — aggregated straight from order items,
  // so it's always accurate regardless of the pricing schedule.
  const bestSellers = useMemo(() => {
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    const tally = {};
    orders.forEach((o) => {
      if (o.status === "Cancelled" || o.isReturn || new Date(o.createdAt).getTime() < since) return;
      (o.items || []).forEach((it) => {
        const t = tally[it.id] || (tally[it.id] = { id: it.id, name: it.name, icon: it.icon, qty: 0 });
        t.qty += it.qty;
      });
    });
    return Object.values(tally).sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [orders]);

  // Revenue per day for the last 7 days (oldest → today).
  const trend = useMemo(() => {
    const now = new Date();
    const days = [];
    const idx = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toDateString();
      idx[key] = days.length;
      days.push({ key, label: d.toLocaleDateString("en-IN", { weekday: "short" }), revenue: 0 });
    }
    orders.forEach((o) => {
      if (o.status === "Cancelled" || o.isReturn) return;
      const k = new Date(o.createdAt).toDateString();
      if (k in idx) days[idx[k]].revenue += o.total || 0;
    });
    return days;
  }, [orders]);
  const trendMax = Math.max(1, ...trend.map((d) => d.revenue));

  const topCategories = useMemo(() => {
    return categories
      .map((c) => ({
        ...c,
        count: products.filter((p) => p.category === c.id).length,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [products, categories]);

  const recent = orders.slice(0, 5);

  return (
    <>
      <div className="stat-row">
        <StatCard label="Today's orders" value={stats.orders} icon="🧾" tone="blue" />
        <StatCard label="Today's revenue" value={`₹${stats.revenue}`} icon="💰" tone="amber" />
        <StatCard
          label={stats.marginPct != null ? `Today's profit · ${stats.marginPct.toFixed(0)}%` : "Today's profit"}
          value={`₹${stats.profit}`}
          icon="📈"
          tone="green"
        />
        <StatCard label="Pending orders" value={stats.pending} icon="⏳" tone="pink" />
      </div>

      {(stats.givenBack > 0 || stats.walletUsed > 0) && (
        <section className="panel dash-giveback">
          <div className="panel-head"><h3>Rewards, wallet &amp; refunds · today</h3></div>
          <div className="giveback-grid">
            <div className="giveback-item"><span>🎁 Points redeemed</span><strong>₹{stats.rewardsGiven}</strong></div>
            <div className="giveback-item"><span>🎟️ Coupons</span><strong>₹{stats.couponsGiven}</strong></div>
            <div className="giveback-item"><span>👛 Wallet used</span><strong>₹{stats.walletUsed}</strong></div>
            <div className="giveback-item"><span>↩︎ Refunds to wallet</span><strong>₹{stats.refunds}</strong></div>
          </div>
          <p className="dash-sub">Points &amp; coupons and refunds are already subtracted from today's profit above.</p>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>Last 7 days · revenue</h3>
          <span className="dash-sub">₹{trend.reduce((s, d) => s + d.revenue, 0)} total</span>
        </div>
        <div className="trend-bars">
          {trend.map((d, i) => (
            <div className="trend-col" key={d.key}>
              <div className="trend-amt">{d.revenue > 0 ? `₹${d.revenue}` : ""}</div>
              <div
                className={`trend-bar ${i === trend.length - 1 ? "today" : ""}`}
                style={{ height: `${Math.round((d.revenue / trendMax) * 100)}%` }}
              />
              <div className="trend-lbl">{d.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel lowstock-panel">
        <div className="panel-head">
          <h3>⚠️ Low stock {lowStock.length > 0 && <span className="lowstock-count">{lowStock.length}</span>}</h3>
          <label className="lowstock-thresh">
            Alert at ≤
            <input
              type="number"
              min="0"
              value={threshold}
              onChange={(e) =>
                updateSettings({ lowStockThreshold: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
        </div>
        {lowStock.length === 0 ? (
          <p className="panel-empty">Everything's well stocked. 👍</p>
        ) : (
          <div className="lowstock-list">
            {lowStock.map((p) => (
              <button
                key={p.id}
                className="lowstock-item"
                onClick={() => onNavigate("products")}
              >
                <span className="lowstock-name">{p.name}</span>
                {p.inStock === false ? (
                  <span className="lowstock-tag out">Out of stock</span>
                ) : (
                  <span className="lowstock-tag low">{p.stock} left</span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>🔥 Best sellers · 7 days</h3>
          <button className="link-btn" onClick={() => onNavigate("pricing")}>
            Pricing →
          </button>
        </div>
        {bestSellers.length === 0 ? (
          <p className="panel-empty">No sales in the last 7 days yet.</p>
        ) : (
          <div className="best-list">
            {bestSellers.map((p, i) => (
              <div className="best-row" key={p.id}>
                <span className="best-rank">{i + 1}</span>
                <span className="best-name">{p.icon ? `${p.icon} ` : ""}{p.name}</span>
                <span className="best-qty">{p.qty} sold</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>Recent orders</h3>
            <button className="link-btn" onClick={() => onNavigate("orders")}>
              View all →
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="panel-empty">No orders yet.</p>
          ) : (
            <div className="table-scroll">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">#{o.id}</td>
                    <td>{o.customer}</td>
                    <td>{o.count}</td>
                    <td>₹{o.total}</td>
                    <td>
                      <StatusPill status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Catalog by category</h3>
            <button className="link-btn" onClick={() => onNavigate("products")}>
              Manage →
            </button>
          </div>
          <div className="cat-bars">
            {topCategories.map((c) => (
              <div className="cat-bar-row" key={c.id}>
                <span className="cat-bar-label">
                  {c.icon} {c.name}
                </span>
                <div className="cat-bar-track">
                  <div
                    className="cat-bar-fill"
                    style={{
                      width: `${Math.min(100, c.count * 12)}%`,
                    }}
                  />
                </div>
                <span className="cat-bar-count">{c.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function StatCard({ label, value, icon, tone }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function isToday(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  } catch {
    return false;
  }
}

export function StatusPill({ status }) {
  const cls =
    {
      Placed: "s-placed",
      Packed: "s-packed",
      "Out for delivery": "s-out",
      Delivered: "s-delivered",
      Cancelled: "s-cancelled",
      "Return requested": "s-return",
      Returned: "s-return",
    }[status] || "s-placed";
  return <span className={`status-pill ${cls}`}>{status}</span>;
}
