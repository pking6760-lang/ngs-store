import { useState } from "react";
import { useOrders } from "../lib/hooks.js";
import { ORDER_STATUSES, updateOrderStatus } from "../lib/store.js";
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

              <div className="order-customer">👤 {o.customer}</div>

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

              <div className="order-card-foot">
                <div className="order-total">
                  Total <strong>₹{o.total}</strong>
                </div>
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
