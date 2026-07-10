import { useMemo } from "react";
import { useProducts, useOrders, useCategories, useSettings } from "../lib/hooks.js";
import { updateSettings } from "../lib/store.js";

export default function Dashboard({ onNavigate }) {
  const products = useProducts();
  const orders = useOrders();
  const categories = useCategories();
  const settings = useSettings();
  const threshold = settings.lowStockThreshold ?? 5;

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
      (o) => isToday(o.createdAt) && o.status !== "Cancelled"
    );
    const revenue = todaysOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    // Pending = anything not yet delivered (still needs action), any day.
    const pending = orders.filter(
      (o) => o.status !== "Delivered" && o.status !== "Cancelled"
    ).length;
    return {
      orders: todaysOrders.length,
      revenue,
      pending,
    };
  }, [orders]);

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
        <StatCard label="Pending orders" value={stats.pending} icon="⏳" tone="pink" />
      </div>

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
    }[status] || "s-placed";
  return <span className={`status-pill ${cls}`}>{status}</span>;
}
