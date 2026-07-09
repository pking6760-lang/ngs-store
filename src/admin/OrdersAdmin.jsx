import { useState } from "react";
import { useOrders } from "../lib/hooks.js";
import { ORDER_STATUSES, updateOrderStatus } from "../lib/store.js";
import { googleMapsLink } from "../lib/location.js";
import { StatusPill } from "./Dashboard.jsx";

export default function OrdersAdmin() {
  const orders = useOrders();
  const [filter, setFilter] = useState("all");

  const shown =
    filter === "all" ? orders : orders.filter((o) => o.status === filter);

  return (
    <>
      <div className="toolbar">
        <div className="filter-chips">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
          {ORDER_STATUSES.map((s) => (
            <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <section className="panel">
          <p className="panel-empty">No orders in this view yet.</p>
        </section>
      ) : (
        <div className="orders-list">
          {shown.map((o) => (
            <div className="order-card" key={o.id}>
              <div className="order-card-head">
                <div>
                  <span className="order-id">#{o.id}</span>
                  <span className="order-time">{formatTime(o.createdAt)}</span>
                </div>
                <StatusPill status={o.status} />
              </div>

              <div className="order-customer">
                👤 {o.customer}
                {o.userPhone ? ` · 📞 +91 ${o.userPhone}` : ""}
                {o.member && <span className="member-chip">👑 Prime</span>}
                {o.accepted === false && o.status !== "Cancelled" && (
                  <span className="await-chip">⏳ Awaiting accept</span>
                )}
              </div>

              {o.address && <div className="order-address">🏠 {o.address}</div>}

              <div className="order-meta">
                <span className="order-pay-tag">
                  {o.payment === "upi"
                    ? "🟣 UPI"
                    : o.payment === "cod"
                    ? "💵 Cash on delivery"
                    : "💳 —"}
                </span>
                {o.location ? (
                  <a
                    className="order-track-link"
                    href={googleMapsLink(o.location)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    📍 Track on Google Maps
                  </a>
                ) : (
                  <span className="order-noloc">📍 No location shared</span>
                )}
              </div>

              <div className="order-items">
                {o.items.map((it) => (
                  <div className="order-item" key={it.id}>
                    <span className="order-item-icon">{it.icon}</span>
                    <span className="order-item-name">{it.name}</span>
                    <span className="order-item-qty">× {it.qty}</span>
                    <span className="order-item-price">₹{it.price * it.qty}</span>
                  </div>
                ))}
              </div>

              {(o.pointsEarned > 0 || o.pointsUsed > 0 || o.discount > 0) && (
                <div className="order-points-row">
                  {o.discount > 0 && <span>₹{o.discount} points discount</span>}
                  {o.pointsUsed > 0 && <span>−{o.pointsUsed} pts used</span>}
                  {o.pointsEarned > 0 && <span>+{o.pointsEarned} pts earned</span>}
                </div>
              )}

              <div className="order-card-foot">
                <div className="order-total">
                  Total <strong>₹{o.total}</strong>
                </div>
                {o.status === "Delivered" ? (
                  <span className="order-done-tag">✅ Delivered</span>
                ) : o.status === "Cancelled" ? (
                  <span className="order-cancel-tag">✖ Cancelled</span>
                ) : (
                  <label className="order-status-select">
                    <span>Update status</span>
                    <select
                      value={o.status}
                      onChange={(e) => updateOrderStatus(o.id, e.target.value)}
                    >
                      {ORDER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button className={`chip ${active ? "active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
