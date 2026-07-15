import { useOrders } from "../lib/hooks.js";
import { advanceStatus } from "../lib/actions.js";
import { googleMapsLink } from "../lib/location.js";
import ProductThumb from "../components/ProductThumb.jsx";

// A focused, task-only screen for staff. Two roles:
//  • picker   — packs newly accepted orders (Placed → Packed)
//  • delivery — takes packed orders out and delivers (Packed → Out → Delivered)
export default function EmployeeApp({ role, name, onLogout }) {
  const orders = useOrders();
  const accepted = orders.filter((o) => o.accepted && o.status !== "Cancelled");

  const isPicker = role === "picker";
  const roleLabel = isPicker ? "Picker" : "Delivery partner";
  const roleIcon = isPicker ? "🧺" : "🛵";

  // Members first, then oldest first — so priority orders bubble up.
  const queue = accepted
    .filter((o) =>
      isPicker
        ? o.status === "Placed"
        : o.status === "Packed" || o.status === "Out for delivery"
    )
    .sort((a, b) => {
      if (!!b.member !== !!a.member) return b.member ? 1 : -1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

  const done = accepted.filter((o) =>
    isPicker
      ? o.status !== "Placed"
      : o.status === "Delivered"
  ).length;

  return (
    <div className="emp">
      <header className="emp-topbar">
        <div className="emp-brand">
          <span className="emp-role-icon">{roleIcon}</span>
          <div>
            <div className="emp-role">{roleLabel}</div>
            <div className="emp-name">{name}</div>
          </div>
        </div>
        <button className="emp-logout" onClick={onLogout}>
          Log out
        </button>
      </header>

      <div className="emp-summary">
        <div className="emp-stat">
          <strong>{queue.length}</strong>
          <span>{isPicker ? "to pack" : "to deliver"}</span>
        </div>
        <div className="emp-stat">
          <strong>{done}</strong>
          <span>done</span>
        </div>
      </div>

      <main className="emp-list">
        {queue.length === 0 ? (
          <div className="emp-empty">
            <div className="empty-emoji">✅</div>
            <p>All caught up!</p>
            <span>New tasks will appear here automatically.</span>
          </div>
        ) : (
          queue.map((o) => (
            <div className="emp-card" key={o.id}>
              <div className="emp-card-head">
                <span className="order-id">#{o.id}</span>
                {o.member && <span className="member-chip">👑 Priority</span>}
                <span className="emp-card-total">₹{o.total}</span>
              </div>

              <div className="emp-items">
                {o.items.map((it) => (
                  <div className="emp-item" key={it.id}>
                    <span className="emp-item-name">
                      <ProductThumb
                        image={it.image}
                        name={it.name}
                        category={it.category}
                        size={26}
                        radius={6}
                      />
                      {it.name}
                    </span>
                    <span className="emp-item-qty">× {it.qty}</span>
                  </div>
                ))}
              </div>

              {!isPicker && (
                <>
                  <div className="emp-address">🏠 {o.address || "—"}</div>
                  <div className="emp-pay-row">
                    <span className="emp-pay">
                      {o.payment === "upi"
                        ? "🟣 Paid via UPI"
                        : `💵 Collect ₹${o.total} cash`}
                    </span>
                    {o.location && (
                      <a
                        className="emp-map"
                        href={googleMapsLink(o.location)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        📍 Navigate
                      </a>
                    )}
                  </div>
                </>
              )}

              {isPicker ? (
                <button
                  className="emp-action"
                  onClick={() => advanceStatus(o, "Packed")}
                >
                  ✅ Mark packed
                </button>
              ) : o.status === "Packed" ? (
                <button
                  className="emp-action"
                  onClick={() => advanceStatus(o, "Out for delivery")}
                >
                  🛵 Start delivery
                </button>
              ) : (
                <button
                  className="emp-action deliver"
                  onClick={() => advanceStatus(o, "Delivered")}
                >
                  📦 Mark delivered
                </button>
              )}
            </div>
          ))
        )}
      </main>
    </div>
  );
}
