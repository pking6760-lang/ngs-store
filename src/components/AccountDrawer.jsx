import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useOrders } from "../lib/hooks.js";
import { googleMapsLink } from "../lib/location.js";
import { MEMBERSHIP, POINTS, redeemableRupees } from "../lib/rewards.js";
import ProductThumb from "./ProductThumb.jsx";

// Slide-in account panel. Extend it by adding a TABS entry + a matching panel.
const TABS = [
  { id: "orders", label: "My Orders", icon: "📦" },
  { id: "rewards", label: "Rewards", icon: "🎁" },
  { id: "membership", label: "Membership", icon: "👑" },
  { id: "profile", label: "Profile", icon: "👤" },
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
      <div className={`drawer-overlay ${open ? "show" : ""}`} onClick={onClose} />
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
            <div className="account-hello-info">
              <div className="account-name">
                {user.name}
                {user.member && <span className="member-chip">👑 Prime</span>}
              </div>
              <div className="account-phone">+91 {user.phone}</div>
            </div>
            <div className="account-points">
              <div className="account-points-val">{user.points || 0}</div>
              <div className="account-points-lbl">points</div>
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
          {tab === "orders" && <MyOrders user={user} />}
          {tab === "rewards" && <Rewards user={user} />}
          {tab === "membership" && <Membership />}
          {tab === "profile" && <Profile />}
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
                <ProductThumb
                  image={it.image}
                  name={it.name}
                  category={it.category}
                  size={20}
                  radius={5}
                />
                {it.name} × {it.qty}
              </span>
            ))}
          </div>

          {(o.pointsEarned > 0 || o.pointsUsed > 0) && (
            <div className="my-order-points">
              {o.pointsEarned > 0 && <span>+{o.pointsEarned} pts earned</span>}
              {o.pointsUsed > 0 && (
                <span className="used">−{o.pointsUsed} pts used</span>
              )}
            </div>
          )}

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

function Rewards({ user }) {
  const points = user?.points || 0;
  const worth = redeemableRupees(points);
  return (
    <div className="rewards-panel">
      <div className="rewards-hero">
        <div className="rewards-hero-val">{points}</div>
        <div className="rewards-hero-lbl">reward points</div>
        <div className="rewards-hero-worth">worth ₹{worth} off your next order</div>
      </div>

      <div className="rewards-how">
        <h4>How it works</h4>
        <ul>
          <li>🛍️ Earn <strong>~50 points</strong> for every ₹99 you spend.</li>
          <li>💸 <strong>{POINTS.perRupee} points = ₹1</strong> off — redeem at checkout.</li>
          <li>♻️ Points update automatically after every delivered order.</li>
        </ul>
      </div>
    </div>
  );
}

function Membership() {
  const { user, joinMembership } = useAuth();
  const isMember = user?.member;

  if (isMember) {
    return (
      <div className="membership-panel">
        <div className="member-card active">
          <div className="member-card-top">
            <span className="member-crown">👑</span>
            <span className="member-title">{MEMBERSHIP.name}</span>
            <span className="member-active-tag">ACTIVE</span>
          </div>
          <ul className="member-benefits">
            {MEMBERSHIP.benefits.map((b) => (
              <li key={b}>✅ {b}</li>
            ))}
          </ul>
          <p className="member-since">
            Member since {formatDate(user.memberSince)}
          </p>
        </div>
        <p className="member-note">
          Free delivery applies on normal days. During surge (rain / peak),
          standard delivery charges apply.
        </p>
      </div>
    );
  }

  return (
    <div className="membership-panel">
      <div className="member-card">
        <div className="member-card-top">
          <span className="member-crown">👑</span>
          <span className="member-title">{MEMBERSHIP.name}</span>
        </div>
        <div className="member-price">
          ₹{MEMBERSHIP.price}
          <small>one-time (demo)</small>
        </div>
        <ul className="member-benefits">
          {MEMBERSHIP.benefits.map((b) => (
            <li key={b}>✅ {b}</li>
          ))}
        </ul>
        <button className="checkout-btn" onClick={joinMembership}>
          Join {MEMBERSHIP.name}
        </button>
      </div>
      <p className="member-note">
        Demo: joining is instant. A real setup collects ₹{MEMBERSHIP.price} via UPI.
      </p>
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

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}
