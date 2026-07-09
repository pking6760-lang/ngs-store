import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useOrders } from "../lib/hooks.js";
import { googleMapsLink } from "../lib/location.js";

// Slide-in account panel with two sections: My Orders and Personal Information.
// Built to be easy to extend — add another entry to TABS and a matching panel.
const TABS = [
  { id: "orders", label: "My Orders", icon: "📦" },
  { id: "profile", label: "Personal Information", icon: "👤" },
];

export default function AccountDrawer({ open, onClose }) {
  const { user, isLoggedIn, logout } = useAuth();
  const [tab, setTab] = useState("orders");

  function handleLogout() {
    logout();
    onClose();
  }

  return (
    <>
      <div
        className={`drawer-overlay ${open ? "show" : ""}`}
        onClick={onClose}
      />
      <aside className={`account-drawer ${open ? "open" : ""}`}>
        <div className="drawer-head">
          <h2>My Account</h2>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {isLoggedIn && (
          <div className="account-hello">
            <div className="account-avatar">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="account-name">{user.name}</div>
              <div className="account-phone">+91 {user.phone}</div>
            </div>
          </div>
        )}

        <div className="account-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`account-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <span className="account-tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="account-body">
          {tab === "orders" ? <MyOrders user={user} /> : <Profile />}
        </div>

        {isLoggedIn && (
          <div className="account-foot">
            <button className="logout-btn" onClick={handleLogout}>
              Log out
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

function MyOrders({ user }) {
  const allOrders = useOrders();
  const myOrders = useMemo(
    () => allOrders.filter((o) => o.userId === user?.id),
    [allOrders, user]
  );

  if (myOrders.length === 0) {
    return (
      <div className="account-empty">
        <div className="empty-emoji">📦</div>
        <p>No orders yet</p>
        <span>Your orders and their live status will appear here.</span>
      </div>
    );
  }

  return (
    <div className="my-orders">
      {myOrders.map((o) => (
        <div className="my-order-card" key={o.id}>
          <div className="my-order-head">
            <div>
              <span className="order-id">#{o.id}</span>
              <span className="order-time">{formatTime(o.createdAt)}</span>
            </div>
            <span className={`status-badge status-${slug(o.status)}`}>
              {o.status}
            </span>
          </div>

          <div className="my-order-items">
            {o.items.map((it) => (
              <span className="my-order-chip" key={it.id}>
                {it.icon} {it.name} × {it.qty}
              </span>
            ))}
          </div>

          <div className="my-order-foot">
            <span className="my-order-pay">
              {o.payment === "upi" ? "UPI" : "Cash on delivery"}
            </span>
            <span className="my-order-total">₹{o.total}</span>
          </div>

          {o.location && (
            <a
              className="my-order-map"
              href={googleMapsLink(o.location)}
              target="_blank"
              rel="noopener noreferrer"
            >
              📍 Delivery location on map
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function Profile() {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({
    name: user?.name || "",
    email: user?.email || "",
    address: user?.address || "",
  });
  const [saved, setSaved] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }

  function save(e) {
    e.preventDefault();
    updateProfile(form);
    setSaved(true);
  }

  return (
    <form className="profile-form" onSubmit={save}>
      <label className="field">
        <span>Full name</span>
        <input
          type="text"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>

      <label className="field">
        <span>Phone number</span>
        <input type="tel" value={user?.phone || ""} disabled />
      </label>

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="you@example.com"
        />
      </label>

      <label className="field">
        <span>Delivery address</span>
        <textarea
          rows={3}
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="House / flat no, street, area, city, PIN"
        />
      </label>

      <button className="checkout-btn" type="submit">
        Save changes
      </button>
      {saved && <div className="profile-saved">✅ Saved</div>}
    </form>
  );
}

function slug(status) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function formatTime(iso) {
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
