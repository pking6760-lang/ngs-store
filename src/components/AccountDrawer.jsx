import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useCart } from "../context/CartContext.jsx";
import { useMyOrders, useSettings, useUserNotifications, useWallet } from "../lib/hooks.js";
import { markUserNotificationsRead, setOrderRating, ORDER_STATUSES } from "../lib/store.js";
import * as api from "../lib/api.js";
import { googleMapsLink } from "../lib/location.js";
import { MEMBERSHIP, redeemableRupees } from "../lib/rewards.js";
import ProductThumb from "./ProductThumb.jsx";

// Slide-in account panel. Extend it by adding a TABS entry + a matching panel.
const TABS = [
  { id: "orders", label: "My Orders", icon: "📦" },
  { id: "wallet", label: "Wallet", icon: "💰" },
  { id: "inbox", label: "Inbox", icon: "🔔" },
  { id: "rewards", label: "Rewards", icon: "🎁" },
  { id: "membership", label: "Membership", icon: "👑" },
  { id: "profile", label: "Profile", icon: "👤" },
];

export default function AccountDrawer({ open, onClose, initialTab, onOpenCart }) {
  const { user, isLoggedIn, logout } = useAuth();
  const [tab, setTab] = useState("orders");
  const { notes, error: notesError, reload: reloadNotes } = useUserNotifications(user?.id);
  const unread = notes.filter((n) => !n.read).length;

  // Jump to the requested tab whenever the drawer is opened.
  useEffect(() => {
    if (open) setTab(initialTab || "orders");
  }, [open, initialTab]);

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
              {(user.name || "?").trim().charAt(0).toUpperCase() || "?"}
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
              {t.id === "inbox" && unread > 0 && (
                <span className="tab-badge">{unread}</span>
              )}
            </button>
          ))}
        </div>

        <div className="account-body">
          {tab === "orders" && (
            <MyOrders
              user={user}
              onReorder={() => {
                onClose();
                onOpenCart && onOpenCart();
              }}
            />
          )}
          {tab === "wallet" && <WalletTab userId={user?.id} />}
          {tab === "inbox" && <Inbox notes={notes} userId={user?.id} error={notesError} onRetry={reloadNotes} />}
          {tab === "rewards" && <Rewards user={user} />}
          {tab === "membership" && <Membership />}
          {tab === "profile" && <Profile />}
        </div>

        <div className="account-foot">
          <nav className="legal-links">
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy</a>
            <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms</a>
            <a href="/refunds.html" target="_blank" rel="noopener noreferrer">Refunds</a>
            <a href="/shipping.html" target="_blank" rel="noopener noreferrer">Shipping</a>
            <a href="/contact.html" target="_blank" rel="noopener noreferrer">Contact</a>
          </nav>
          {isLoggedIn && (
            <button className="logout-btn" onClick={handleLogout}>
              Log out
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function MyOrders({ user, onReorder }) {
  // RLS-scoped fetch of only this user's own orders (not the admin all-orders path).
  const { orders: myOrders, loading, error, reload } = useMyOrders(user?.id);
  const [openId, setOpenId] = useState(null);
  const openOrder = myOrders.find((o) => o.id === openId) || null;

  if (error) return <RetryState error="Couldn't load your orders." onRetry={reload} label="your orders" />;

  if (myOrders.length === 0) {
    return (
      <div className="account-empty">
        <div className="empty-emoji">📦</div>
        <p>{loading ? "Loading your orders…" : "No orders yet"}</p>
        {!loading && <span>Your orders and their live status will appear here.</span>}
      </div>
    );
  }

  return (
    <div className="my-orders">
      {myOrders.map((o) => (
        <button
          className="my-order-card tappable"
          key={o.id}
          onClick={() => setOpenId(o.id)}
        >
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

          <div className="my-order-foot">
            <span className="my-order-pay">
              {o.rating ? "★".repeat(o.rating) : o.payment === "upi" ? "UPI" : "Cash on delivery"}
            </span>
            <span className="my-order-total">
              ₹{o.total} <span className="my-order-arrow">›</span>
            </span>
          </div>
        </button>
      ))}

      {openOrder && (
        <OrderDetail
          order={openOrder}
          onClose={() => setOpenId(null)}
          onReorder={onReorder}
        />
      )}
    </div>
  );
}

function OrderDetail({ order, onClose, onReorder }) {
  const { add } = useCart();
  const cancelled = order.status === "Cancelled";
  const currentStep = ORDER_STATUSES.indexOf(order.status);

  function reorder() {
    order.items.forEach((it) => {
      for (let i = 0; i < it.qty; i++) add(it.id);
    });
    onReorder && onReorder();
  }

  return (
    <div className="order-detail-sheet">
      <div className="order-detail">
        <div className="drawer-head">
          <button className="back-btn small" onClick={onClose} aria-label="Back">←</button>
          <h2>Order #{order.id}</h2>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="order-detail-body">
          <div className="order-detail-time">{formatTime(order.createdAt)}</div>

          {cancelled ? (
            <div className="order-cancelled-note">✖ This order was cancelled.</div>
          ) : (
            <ol className="status-steps">
              {ORDER_STATUSES.map((s, i) => (
                <li
                  key={s}
                  className={`step ${i < currentStep ? "done" : ""} ${
                    i === currentStep ? "current" : ""
                  }`}
                >
                  <span className="step-dot" />
                  <span className="step-label">{s}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="order-detail-items">
            {order.items.map((it) => (
              <div className="order-detail-item" key={it.id}>
                <ProductThumb image={it.image} name={it.name} category={it.category} size={38} radius={9} />
                <span className="odi-name">{it.name}</span>
                <span className="odi-qty">× {it.qty}</span>
                <span className="odi-price">₹{it.price * it.qty}</span>
              </div>
            ))}
          </div>

          <div className="order-detail-bill">
            <Row k="Item total" v={`₹${order.itemTotal}`} />
            {order.discount > 0 && <Row k="Points discount" v={`−₹${order.discount}`} good />}
            {order.couponDiscount > 0 && <Row k={`Coupon ${order.couponCode}`} v={`−₹${order.couponDiscount}`} good />}
            <Row k="Delivery fee" v={order.deliveryFee ? `₹${order.deliveryFee}` : "FREE"} />
            <Row k="Handling" v={`₹${order.handling}`} />
            <Row k="Total paid" v={`₹${order.total}`} bold />
            <div className="odb-pay">{order.payment === "upi" ? "Paid via UPI" : "Cash on delivery"}</div>
          </div>

          {order.status === "Delivered" && (
            <RatingBox order={order} />
          )}

          <button className="checkout-btn reorder" onClick={reorder}>
            🔁 Reorder these items
          </button>
        </div>
      </div>
    </div>
  );
}

function RatingBox({ order }) {
  const [stars, setStars] = useState(order.rating || 0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState(order.feedback || "");
  const [done, setDone] = useState(!!order.rating);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!stars || busy) return;
    setBusy(true);
    setError("");
    try {
      // Only mark it saved once the server actually confirms — otherwise the
      // rating silently fails and keeps re-prompting on the next open.
      if (api.isBackendConfigured) await api.rateOrder(order.dbId, stars, feedback);
      else setOrderRating(order.id, stars, feedback);
      setDone(true);
    } catch (e) {
      setError(e?.message || "Couldn't save your rating. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rating-box">
      <h4>{done ? "Your rating" : "Rate this order"}</h4>
      <div className="stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`star ${n <= (hover || stars) ? "on" : ""}`}
            onMouseEnter={() => !done && setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => !done && setStars(n)}
            disabled={done}
            aria-label={`${n} star`}
          >
            ★
          </button>
        ))}
      </div>
      {!done && (
        <>
          <textarea
            className="rating-feedback"
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Tell us how it went (optional)"
          />
          {error && <p className="rating-error">{error}</p>}
          <button className="rating-submit" onClick={submit} disabled={!stars || busy}>
            {busy ? "Saving…" : "Submit rating"}
          </button>
        </>
      )}
      {done && order.feedback && <p className="rating-fb">“{order.feedback}”</p>}
      {done && <p className="rating-thanks">Thanks for your feedback! 💚</p>}
    </div>
  );
}

function RetryState({ error, onRetry, label }) {
  return (
    <div className="load-retry">
      <div className="load-retry-ic">⚠️</div>
      <p>{error || `Couldn't load ${label || "this"}.`}</p>
      <button className="load-retry-btn" onClick={onRetry}>↻ Retry</button>
    </div>
  );
}

function WalletTab({ userId }) {
  const { balance, ledger, loading, error, reload } = useWallet(userId);
  if (error) return <RetryState error="Couldn't load your wallet." onRetry={reload} label="your wallet" />;
  return (
    <div className="wallet-tab">
      <div className="wallet-card">
        <div className="wallet-card-lbl">NGS Wallet balance</div>
        <div className="wallet-card-bal">₹{balance.toFixed(2)}</div>
        <div className="wallet-card-note">Refunds land here and apply on your next order.</div>
        <button
          className="wallet-add-btn"
          onClick={() =>
            alert("Adding money to your wallet is coming soon. For now, refunds and returns are credited here automatically.")
          }
        >
          + Add money
        </button>
      </div>

      <h4 className="wallet-h">History</h4>
      {loading && ledger.length === 0 ? (
        <p className="account-empty">Loading…</p>
      ) : ledger.length === 0 ? (
        <p className="account-empty">No wallet activity yet.</p>
      ) : (
        <div className="wallet-list">
          {ledger.map((e) => (
            <div className="wallet-row" key={e.id}>
              <div className="wallet-row-main">
                <span className="wallet-row-note">{walletLabel(e)}</span>
                <span className="wallet-row-date">{fmtWalletDate(e.at)}</span>
              </div>
              <span className={`wallet-row-amt ${e.amount >= 0 ? "cr" : "dr"}`}>
                {e.amount >= 0 ? "+" : "−"}₹{Math.abs(e.amount).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function walletLabel(e) {
  if (e.note) return e.note;
  return { refund: "Refund", topup: "Money added", spent: "Used on order", adjust: "Adjustment" }[e.kind] || e.kind;
}
function fmtWalletDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function Row({ k, v, good, bold }) {
  return (
    <div className={`odb-row ${bold ? "bold" : ""}`}>
      <span>{k}</span>
      <span className={good ? "free" : ""}>{v}</span>
    </div>
  );
}

function Inbox({ notes, userId, error, onRetry }) {
  // Mark everything read once the inbox is opened.
  useEffect(() => {
    if (api.isBackendConfigured) api.markNotificationsRead().catch(() => {});
    else markUserNotificationsRead(userId);
  }, [userId]);

  if (error) return <RetryState error="Couldn't load your inbox." onRetry={onRetry} label="your inbox" />;

  if (!notes || notes.length === 0) {
    return (
      <div className="account-empty">
        <div className="empty-emoji">🔔</div>
        <p>No messages yet</p>
        <span>Offers and updates from the store will appear here.</span>
      </div>
    );
  }

  return (
    <div className="inbox-list">
      {notes.map((n) => (
        <div className={`inbox-item ${n.read ? "" : "unread"}`} key={n.id}>
          <div className="inbox-item-title">🔔 {n.title}</div>
          {n.body && <div className="inbox-item-body">{n.body}</div>}
          <div className="inbox-item-time">{formatTime(n.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}

function Rewards({ user }) {
  const settings = useSettings();
  const cfg = settings.rewards || { earnPoints: 50, earnPer: 399, redeemPer: 10 };
  const points = user?.points || 0;
  const worth = redeemableRupees(points, cfg);
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
          <li>
            🛍️ Earn <strong>{cfg.earnPoints} points</strong> for every ₹
            {cfg.earnPer} you spend.
          </li>
          <li>
            💸 <strong>{cfg.redeemPer} points = ₹1</strong> off — redeem at checkout.
          </li>
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
    setError("");
  }

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // Only show "Saved" once the server actually confirms.
      const res = await updateProfile(form);
      if (res && res.ok === false) setError(res.error || "Couldn't save. Please try again.");
      else setSaved(true);
    } catch (err) {
      setError(err?.message || "Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
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

      <button className="checkout-btn" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save changes"}
      </button>
      {error && <div className="auth-error">{error}</div>}
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
