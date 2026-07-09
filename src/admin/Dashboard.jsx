import { useMemo } from "react";
import { useProducts, useOrders } from "../lib/hooks.js";
import { categories } from "../lib/store.js";

export default function Dashboard({ onNavigate }) {
  const products = useProducts();
  const orders = useOrders();

  const stats = useMemo(() => {
    const revenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const pending = orders.filter((o) => o.status !== "Delivered").length;
    return {
      products: products.length,
      orders: orders.length,
      revenue,
      pending,
    };
  }, [products, orders]);

  const topCategories = useMemo(() => {
    return categories
      .map((c) => ({
        ...c,
        count: products.filter((p) => p.category === c.id).length,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [products]);

  const recent = orders.slice(0, 5);

  return (
    <>
      <div className="stat-row">
        <StatCard label="Total products" value={stats.products} icon="📦" tone="green" />
        <StatCard label="Total orders" value={stats.orders} icon="🧾" tone="blue" />
        <StatCard label="Revenue" value={`₹${stats.revenue}`} icon="💰" tone="amber" />
        <StatCard label="Pending orders" value={stats.pending} icon="⏳" tone="pink" />
      </div>

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

export function StatusPill({ status }) {
  const cls =
    {
      Placed: "s-placed",
      Packed: "s-packed",
      "Out for delivery": "s-out",
      Delivered: "s-delivered",
    }[status] || "s-placed";
  return <span className={`status-pill ${cls}`}>{status}</span>;
}
