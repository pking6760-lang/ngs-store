import { useMemo, useState, useEffect } from "react";
import { useProducts, useAdminProducts, useOrders, useCategories, useSettings } from "../lib/hooks.js";
import { updateSettings } from "../lib/actions.js";
import { getOpsConfigRaw } from "../lib/api.js";
import { Ic } from "./AdminIcons.jsx";
import CategoryIcon from "../components/CategoryIcon.jsx";

export default function Dashboard({ onNavigate }) {
  const products = useProducts();
  const adminProducts = useAdminProducts(); // carries buying cost (admin-only)
  const orders = useOrders();
  const categories = useCategories();
  const settings = useSettings();
  const threshold = settings.lowStockThreshold ?? 5;

  // Ops rates + who covers picking/delivery — to net staff payouts out of profit.
  const [ops, setOps] = useState(null);
  useEffect(() => { getOpsConfigRaw().then(setOps).catch(() => {}); }, []);

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
    const todaysAll = orders.filter(
      (o) => isToday(o.createdAt) && o.status !== "Cancelled"
        && o.status !== "Awaiting payment" && o.status !== "Payment failed" && !o.isReturn
    );
    // A daily plan order (subscription_id set, not the master) is just fulfilment
    // of money already collected up-front — never counts as new revenue.
    const isSubDaily = (o) => o.subscriptionId && !o.isSubscription;
    // Revenue = cash received today: normal orders + the prepaid plan "master"
    // (its full amount is booked the day the customer subscribes). The daily
    // orders it later spawns are excluded so the plan is never counted twice.
    const revenueOrders = todaysAll.filter((o) => !isSubDaily(o));
    const revenue = revenueOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    // Margin & cost accrue as the milk is actually delivered, so profit is built
    // from the daily fulfilment orders (which carry the items + cost) plus normal
    // orders. The master has no line items, so it's excluded from the profit math.
    const todaysOrders = todaysAll.filter((o) => !o.isSubscription);
    // Gross product profit = (selling − buying cost) × qty over today's items
    // whose cost is known. It's a margin estimate (fees/payouts not deducted).
    let grossMargin = 0, sold = 0;
    todaysOrders.forEach((o) => (o.items || []).forEach((it) => {
      const c = costMap[it.id];
      if (c != null) { grossMargin += (it.price - c) * it.qty; sold += it.price * it.qty; }
    }));
    // Fees the shop COLLECTS (delivery + handling + surge) are income on top of
    // product margin — added to profit.
    const feesCollected = todaysOrders.reduce(
      (s, o) => s + (o.deliveryFee || 0) + (o.handling || 0) + (o.surgeFee || 0), 0);
    // Reward the shop HANDS OUT on each order (the scratch prize): wallet cash at
    // face value + points at their redemption value. Booked here as a cost so
    // profit reflects it. Points now come ONLY from the scratch card, so this is
    // the whole reward liability (no double count with later redemption).
    const redeemPer = Number(settings.rewards?.redeemPer) || 10;
    const rewardsGiven = todaysOrders.reduce(
      (s, o) => s + (o.scratchWallet || 0) + (o.scratchPoints || 0) / redeemPer, 0);
    const couponsGiven = todaysOrders.reduce((s, o) => s + (o.couponDiscount || 0), 0);
    const refunds = todaysOrders.reduce((s, o) => s + (o.refundedAmount || 0), 0);
    const walletUsed = todaysOrders.reduce((s, o) => s + (o.walletUsed || 0), 0);

    // Staff payouts — booked ONLY when a partner actually did the work. If YOU
    // pack an order it has no picker_id (no picker pay); if YOU deliver it there's
    // no rider_id (no driver pay). So doing both yourself means the whole margin
    // is yours, automatically — no dependence on the coverage setting.
    const n = (v) => Number(v) || 0;
    let pickerPay = 0, driverPay = 0;
    todaysOrders.forEach((o) => {
      if (o.pickerId) pickerPay += n(ops?.picker_pack_fee);
      if (o.riderId) {
        const base = o.member && ops?.rider_member_base != null ? n(ops.rider_member_base) : n(ops?.rider_base);
        const perKm = Math.max(n(o.distanceKm) - n(ops?.rider_free_km), 0) * n(ops?.rider_per_km);
        const peak = (o.surgeFee || 0) > 0 ? n(ops?.peak_bonus) : 0;
        driverPay += base + perKm + peak;
      }
    });
    const staffPay = pickerPay + driverPay;

    // Net profit = product margin + fees collected − rewards − coupons − refunds − staff pay.
    const profit = grossMargin + feesCollected - rewardsGiven - couponsGiven - refunds - staffPay;
    const givenBack = rewardsGiven + couponsGiven + refunds;
    // Pending = anything not yet delivered (still needs action), any day.
    const pending = orders.filter(
      (o) => o.status !== "Delivered" && o.status !== "Cancelled" && o.status !== "Returned"
        && o.status !== "Scheduled" && o.status !== "Awaiting payment"
        && o.status !== "Payment failed" && !o.isSubscription
    ).length;
    return {
      orders: revenueOrders.length,
      revenue,
      profit: Math.round(profit),
      marginPct: sold > 0 ? (profit / sold) * 100 : null,
      pending,
      rewardsGiven: Math.round(rewardsGiven),
      couponsGiven: Math.round(couponsGiven),
      refunds: Math.round(refunds),
      walletUsed: Math.round(walletUsed),
      givenBack: Math.round(givenBack),
      pickerPay: Math.round(pickerPay),
      driverPay: Math.round(driverPay),
      staffPay: Math.round(staffPay),
      feesCollected: Math.round(feesCollected),
    };
  }, [orders, costMap, settings, ops]);

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

  // The subscription master isn't a fulfilment order — keep it out of the feed.
  const recent = orders.filter((o) => !o.isSubscription).slice(0, 5);

  return (
    <>
      <div className="stat-row">
        <StatCard label="Today's orders" value={stats.orders} icon="orders" tone="blue" />
        <StatCard label="Today's revenue" value={`₹${stats.revenue}`} icon="revenue" tone="amber" />
        <StatCard
          label={stats.marginPct != null ? `Today's profit · ${stats.marginPct.toFixed(0)}%` : "Today's profit"}
          value={`₹${stats.profit}`}
          icon="profit"
          tone="green"
        />
        <StatCard label="Pending orders" value={stats.pending} icon="pending" tone="pink" />
      </div>

      {(stats.givenBack > 0 || stats.walletUsed > 0 || stats.staffPay > 0 || stats.feesCollected > 0) && (
        <section className="panel dash-giveback">
          <div className="panel-head"><h3>Income &amp; costs · today</h3></div>
          <div className="giveback-grid">
            {stats.feesCollected > 0 && (
              <div className="giveback-item"><span><Ic name="revenue" size={15} /> Fees collected</span><strong className="gb-income">+₹{stats.feesCollected}</strong></div>
            )}
            {stats.pickerPay > 0 && (
              <div className="giveback-item"><span><Ic name="box" size={15} /> Picker pay</span><strong>₹{stats.pickerPay}</strong></div>
            )}
            {stats.driverPay > 0 && (
              <div className="giveback-item"><span><Ic name="delivery" size={15} /> Driver pay</span><strong>₹{stats.driverPay}</strong></div>
            )}
            <div className="giveback-item"><span><Ic name="gift" size={15} /> Rewards given (scratch)</span><strong>₹{stats.rewardsGiven}</strong></div>
            <div className="giveback-item"><span><Ic name="coupon" size={15} /> Coupons</span><strong>₹{stats.couponsGiven}</strong></div>
            <div className="giveback-item"><span><Ic name="wallet" size={15} /> Wallet used</span><strong>₹{stats.walletUsed}</strong></div>
            <div className="giveback-item"><span><Ic name="refund" size={15} /> Refunds to wallet</span><strong>₹{stats.refunds}</strong></div>
          </div>
          <p className="dash-sub">
            Fees collected are added, and picker &amp; driver pay, scratch rewards,
            coupons and refunds are subtracted — all reflected in today's profit above.
            {stats.staffPay === 0 && " You cover picking & delivery yourself, so all the margin is yours."}
          </p>
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
          <h3><Ic name="alert" size={17} /> Low stock {lowStock.length > 0 && <span className="lowstock-count">{lowStock.length}</span>}</h3>
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
          <p className="panel-empty">Everything's well stocked.</p>
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
          <h3><Ic name="flame" size={17} /> Best sellers · 7 days</h3>
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
                <span className="best-name">{p.name}</span>
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
                  <CategoryIcon id={c.id} name={c.name} size={16} /> {c.name}
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
      <div className="stat-icon"><Ic name={icon} size={22} /></div>
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
      Scheduled: "s-scheduled",
      Subscription: "s-sub",
    }[status] || "s-placed";
  return <span className={`status-pill ${cls}`}>{status}</span>;
}
