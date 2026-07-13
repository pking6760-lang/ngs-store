import { useMemo, useState } from "react";
import { useBackGuard } from "../lib/useBackGuard.js";
import { useCustomers, useOrders, useUserNotifications } from "../lib/hooks.js";
import { sendNotification } from "../lib/actions.js";
import AdminPortal from "./AdminPortal.jsx";

export default function CustomersAdmin() {
  const customers = useCustomers();
  const orders = useOrders();
  const [selectedId, setSelectedId] = useState(null);
  useBackGuard(!!selectedId, () => setSelectedId(null));

  // Quick per-customer stats for the list.
  const statsFor = (userId) => {
    const theirs = orders.filter(
      (o) => o.userId === userId && o.status !== "Cancelled"
    );
    const spend = theirs.reduce((s, o) => s + (o.total || 0), 0);
    return { orders: theirs.length, spend };
  };

  const selected = customers.find((c) => c.id === selectedId) || null;

  return (
    <>
      {customers.length === 0 ? (
        <section className="panel">
          <p className="panel-empty">No customers yet.</p>
        </section>
      ) : (
        <div className="customer-list">
          {customers.map((c) => {
            const s = statsFor(c.id);
            return (
              <button
                className="customer-row"
                key={c.id}
                onClick={() => setSelectedId(c.id)}
              >
                <span className="customer-avatar">
                  {c.name.charAt(0).toUpperCase()}
                </span>
                <span className="customer-row-main">
                  <span className="customer-row-name">
                    {c.name}
                    {c.member && <span className="member-chip">👑 Prime</span>}
                  </span>
                  <span className="customer-row-sub">
                    +91 {c.phone} · {s.orders} order{s.orders === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="customer-row-spend">₹{s.spend}</span>
                <span className="customer-row-arrow">›</span>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <AdminPortal>
          <CustomerDetail
            customer={selected}
            orders={orders.filter((o) => o.userId === selected.id)}
            onClose={() => setSelectedId(null)}
          />
        </AdminPortal>
      )}
    </>
  );
}

function CustomerDetail({ customer, orders, onClose }) {
  const notes = useUserNotifications(customer.id);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  const valid = orders.filter((o) => o.status !== "Cancelled");
  const totalSpend = valid.reduce((s, o) => s + (o.total || 0), 0);

  function send(e) {
    e.preventDefault();
    if (!title.trim()) return;
    sendNotification({ userId: customer.id, title, body });
    setTitle("");
    setBody("");
    setSent(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card customer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Customer</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="customer-detail">
          <div className="customer-hero">
            <span className="customer-avatar big">
              {customer.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <div className="customer-hero-name">
                {customer.name}
                {customer.member ? (
                  <span className="member-chip">👑 Prime</span>
                ) : (
                  <span className="nonmember-chip">Not a member</span>
                )}
              </div>
              <div className="customer-hero-phone">+91 {customer.phone}</div>
            </div>
          </div>

          <div className="customer-stats">
            <div className="cstat">
              <strong>₹{totalSpend}</strong>
              <span>Total spent</span>
            </div>
            <div className="cstat">
              <strong>{valid.length}</strong>
              <span>Orders</span>
            </div>
            <div className="cstat">
              <strong>{customer.points || 0}</strong>
              <span>Points</span>
            </div>
          </div>

          <div className="customer-fields">
            {customer.email && (
              <div className="cfield">
                <span>Email</span>
                <b>{customer.email}</b>
              </div>
            )}
            <div className="cfield">
              <span>Address</span>
              <b>{customer.address || "—"}</b>
            </div>
            <div className="cfield">
              <span>Member since</span>
              <b>{customer.memberSince ? fmtDate(customer.memberSince) : "—"}</b>
            </div>
            <div className="cfield">
              <span>Joined</span>
              <b>{customer.createdAt ? fmtDate(customer.createdAt) : "—"}</b>
            </div>
          </div>

          <h4 className="customer-sec">Order history</h4>
          {orders.length === 0 ? (
            <p className="panel-empty">No orders yet.</p>
          ) : (
            <div className="customer-orders">
              {orders.map((o) => (
                <div className="customer-order" key={o.id}>
                  <div>
                    <span className="order-id">#{o.id}</span>
                    <span className="order-time">{fmtDate(o.createdAt)}</span>
                  </div>
                  <span className="customer-order-right">
                    <span className={`status-badge status-${slug(o.status)}`}>
                      {o.status}
                    </span>
                    <b>₹{o.total}</b>
                  </span>
                </div>
              ))}
            </div>
          )}

          <h4 className="customer-sec">Send a notification / offer</h4>
          <form className="notify-form" onSubmit={send}>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setSent(false);
              }}
              placeholder="Title — e.g. Special 20% off for you!"
            />
            <textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message (optional) — e.g. Use code NISHA20 today."
            />
            <div className="notify-actions">
              <button className="primary-btn" type="submit">
                Send to {customer.name.split(" ")[0]}
              </button>
              {sent && <span className="notify-sent">✅ Sent</span>}
            </div>
          </form>

          {notes.length > 0 && (
            <>
              <h4 className="customer-sec">Sent notifications</h4>
              <div className="notify-history">
                {notes.map((n) => (
                  <div className="notify-item" key={n.id}>
                    <div className="notify-item-title">
                      🔔 {n.title}
                      {!n.read && <span className="notify-unread">Unread</span>}
                    </div>
                    {n.body && <div className="notify-item-body">{n.body}</div>}
                    <div className="notify-item-time">{fmtDate(n.createdAt)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function slug(s) {
  return (s || "").toLowerCase().replace(/\s+/g, "-");
}
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
