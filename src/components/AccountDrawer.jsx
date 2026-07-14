import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useCart } from "../context/CartContext.jsx";
import { useMyOrders, useSettings, useUserNotifications, useWallet } from "../lib/hooks.js";
import { markUserNotificationsRead, setOrderRating, ORDER_STATUSES } from "../lib/store.js";
import * as api from "../lib/api.js";
import { googleMapsLink } from "../lib/location.js";
import { MEMBERSHIP, redeemableRupees } from "../lib/rewards.js";
import { cleanUpiQrFromImage, loadRazorpay } from "../lib/payments.js";
import { useBackGuard } from "../lib/useBackGuard.js";
import ScratchCard from "./ScratchCard.jsx";
import ProductThumb from "./ProductThumb.jsx";

// Slide-in account panel. Extend it by adding a TABS entry + a matching panel.
const TABS = [
  { id: "orders", label: "My Orders" },
  { id: "wallet", label: "Wallet" },
  { id: "inbox", label: "Inbox" },
  { id: "rewards", label: "Rewards" },
  { id: "membership", label: "Membership" },
  { id: "profile", label: "Profile" },
];

export default function AccountDrawer({ open, onClose, initialTab, onOpenCart }) {
  const { user, isLoggedIn, logout } = useAuth();
  // null = the account menu (list of sections); a tab id = that section's page.
  const [tab, setTab] = useState(null);
  const { notes, error: notesError, reload: reloadNotes } = useUserNotifications(user?.id);
  const unread = notes.filter((n) => !n.read).length;

  // Jump straight to a requested section (e.g. the bell → Inbox); otherwise
  // land on the menu each time the drawer is opened.
  useEffect(() => {
    if (open) setTab(initialTab || null);
  }, [open, initialTab]);

  function handleLogout() {
    logout();
    onClose();
  }

  const active = TABS.find((t) => t.id === tab);

  // Back button / gesture: close the drawer at the menu, or step back from a
  // section page to the menu — never fall through to the website home.
  useBackGuard(open, onClose);
  useBackGuard(open && !!active, () => setTab(null));

  return (
    <>
      <div className={`drawer-overlay ${open ? "show" : ""}`} onClick={onClose} />
      <aside className={`account-drawer ${open ? "open" : ""}`}>
        <div className="drawer-head">
          {active ? (
            <button className="back-btn small" onClick={() => setTab(null)} aria-label="Back">
              ←
            </button>
          ) : null}
          <h2>{active ? active.label : "My Account"}</h2>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!active ? (
          // ── Account menu ─────────────────────────────────────
          <div className="account-menu-scroll">
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

            <nav className="account-menu">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className="account-menu-row"
                  onClick={() => setTab(t.id)}
                >
                  <span className="account-menu-label">{t.label}</span>
                  {t.id === "inbox" && unread > 0 && (
                    <span className="account-menu-badge">{unread}</span>
                  )}
                  <span className="account-menu-arrow">›</span>
                </button>
              ))}
            </nav>
          </div>
        ) : (
          // ── Section page ─────────────────────────────────────
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
        )}

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
  // Back button closes the order detail before the section page.
  useBackGuard(!!openId, () => setOpenId(null));

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
  const returned = order.status === "Returned" || order.status === "Return requested";
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
          ) : returned ? (
            <div className="order-cancelled-note">
              {order.status === "Returned"
                ? `↩︎ This order was returned.${order.refundedAmount > 0 ? ` ₹${order.refundedAmount} was added to your NGS Wallet.` : ""}`
                : "↩︎ A return is being arranged — our partner will collect the items."}
            </div>
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
            {order.couponDiscount > 0 && <Row k={`Coupon ${order.couponCode || ""}`.trim()} v={`−₹${order.couponDiscount}`} good />}
            {order.pointsDiscount > 0 && <Row k={`Points used${order.pointsRedeemed ? ` (${order.pointsRedeemed} pts)` : ""}`} v={`−₹${order.pointsDiscount}`} good />}
            <Row k="Delivery fee" v={order.deliveryFee ? `₹${order.deliveryFee}` : "FREE"} />
            <Row k="Handling" v={`₹${order.handling}`} />
            {order.surgeFee > 0 && <Row k="Surge" v={`₹${order.surgeFee}`} />}
            {order.walletUsed > 0 && <Row k="NGS Wallet" v={`−₹${order.walletUsed}`} good />}
            <Row k="Total paid" v={`₹${order.total}`} bold />
            {order.refundedAmount > 0 && <Row k="Refunded to wallet" v={`₹${order.refundedAmount}`} good />}
            <div className="odb-pay">
              {order.payment === "razorpay" ? "Paid online"
                : order.payment === "upi" ? "Paid via UPI"
                : order.payment === "wallet" ? "Paid with NGS Wallet"
                : "Cash on delivery"}
            </div>
          </div>

          {order.status === "Delivered" && !order.scratchClaimed && (order.scratchPoints > 0 || order.scratchWallet > 0) && (
            <ScratchCard orderId={order.dbId} existingReward={null} />
          )}

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
  const cfg = settings.rewards || {};
  const redeemPer = cfg.redeemPer || 10;
  const maxRedeemPct = cfg.maxRedeemPct || 20;
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
          <li>Earn reward points on eligible items in every order you place.</li>
          <li>
            <strong>{redeemPer} points = ₹1</strong> off — redeem at checkout.
          </li>
          <li>Pay up to <strong>{maxRedeemPct}%</strong> of an order with points.</li>
          <li>Points are added once your order is confirmed.</li>
        </ul>
      </div>
    </div>
  );
}

function Membership() {
  const { user, joinMembership, applyRewards } = useAuth();
  const settings = useSettings();
  const { balance } = useWallet(user?.id);
  const plan = settings.rewards?.membership || {};
  const price = plan.price ?? MEMBERSHIP.price;
  const days = plan.days ?? 30;
  const isMember = user?.member;
  const enoughWallet = (balance || 0) >= price;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [payQr, setPayQr] = useState(false);

  async function joinWithWallet() {
    setBusy(true); setErr("");
    const res = await joinMembership();
    if (!res.ok) setErr(res.error || "Couldn't join.");
    setBusy(false);
  }

  if (payQr) {
    return (
      <div className="membership-panel">
        <MembershipQrPay
          price={price}
          onPaid={async () => { await applyRewards(); setPayQr(false); }}
          onCancel={() => setPayQr(false)}
        />
      </div>
    );
  }

  if (isMember) {
    const until = user.memberUntil ? new Date(user.memberUntil) : null;
    const daysLeft = until ? Math.max(0, Math.ceil((until.getTime() - Date.now()) / 86400000)) : 0;
    const pct = Math.max(6, Math.min(100, Math.round((daysLeft / (days || 30)) * 100)));
    return (
      <div className="membership-panel">
        <div className="prime-hero active">
          <div className="prime-sheen" />
          <div className="prime-top">
            <span className="prime-crest"><MIcon d={PIC.crown} /></span>
            <span className="prime-word">NGS <b>PRIME</b></span>
            <span className="prime-badge">ACTIVE</span>
          </div>
          <div className="prime-valid">
            <span>Valid until</span>
            <strong>{formatDate(user.memberUntil)}</strong>
          </div>
          <div className="prime-meter"><span style={{ width: `${pct}%` }} /></div>
          <div className="prime-left">{daysLeft} day{daysLeft === 1 ? "" : "s"} left</div>
        </div>

        <PrimeBenefits benefits={MEMBERSHIP.benefits} />

        <p className="prime-fine">You can renew here once your membership ends.</p>
      </div>
    );
  }

  return (
    <div className="membership-panel">
      <div className="prime-hero">
        <div className="prime-sheen" />
        <div className="prime-top">
          <span className="prime-crest"><MIcon d={PIC.crown} /></span>
          <span className="prime-word">NGS <b>PRIME</b></span>
        </div>
        <div className="prime-tagline">Free delivery &amp; member-only perks</div>
        <div className="prime-price">
          <span className="pp-cur">₹</span><span className="pp-amt">{price}</span>
          <span className="pp-per">for {days} days</span>
        </div>
      </div>

      <PrimeBenefits benefits={MEMBERSHIP.benefits} />

      {err && <div className="auth-error">{err}</div>}

      <button className="prime-cta" onClick={() => setPayQr(true)} disabled={busy}>
        <MIcon d={PIC.bolt} size={17} /> Get NGS Prime · ₹{price}
      </button>
      <button
        className="prime-cta ghost"
        onClick={enoughWallet ? joinWithWallet : undefined}
        disabled={busy || !enoughWallet}
      >
        {busy ? "Joining…" : enoughWallet ? `Pay from Wallet · ₹${price}` : `Wallet ₹${balance || 0} — not enough`}
      </button>
      <p className="prime-fine">Pay by any UPI app or your NGS Wallet · activates instantly.</p>
    </div>
  );
}

/* Premium icons for the membership screens (no emoji). */
const PIC = {
  crown: <path d="M3 8l4.5 3L12 5l4.5 6L21 8l-1.8 10.2A1 1 0 0 1 18.2 19H5.8a1 1 0 0 1-1-.8L3 8z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  truck: <><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17.5" cy="18" r="1.6" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  tag: <><path d="M20 12l-8 8-9-9V4h7l10 10-1 1z" /><circle cx="7.5" cy="7.5" r="1.2" /></>,
};
function MIcon({ d, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  );
}
function benefitIcon(text) {
  const t = text.toLowerCase();
  if (t.includes("deliver")) return PIC.truck;
  if (t.includes("priorit") || t.includes("fast")) return PIC.bolt;
  if (t.includes("offer") || t.includes("deal") || t.includes("member-only")) return PIC.tag;
  return PIC.check;
}
function PrimeBenefits({ benefits }) {
  return (
    <div className="prime-benefits">
      {benefits.map((b) => (
        <div className="prime-benefit" key={b}>
          <span className="pb-ic"><MIcon d={benefitIcon(b)} size={17} /></span>
          <span className="pb-txt">{b}</span>
        </div>
      ))}
    </div>
  );
}

// UPI/QR membership payment — creates a membership order, shows its Razorpay UPI
// QR, and polls until the webhook confirms payment, then activates.
function MembershipQrPay({ price, onPaid, onCancel }) {
  const { user } = useAuth();
  const [qr, setQr] = useState(null); // null | "loading" | "error" | { url }
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setQr("loading");
    (async () => {
      try {
        const o = await api.createMembershipOrder();
        if (!alive) return;
        setOrder(o);
        const { imageUrl, imageDataUrl } = await api.createOrderQr(o.dbId);
        const clean = await cleanUpiQrFromImage(imageDataUrl).catch(() => null);
        if (alive) setQr({ url: clean || imageDataUrl || imageUrl });
      } catch (e) {
        if (alive) { setErr(e.message || "Couldn't start the payment."); setQr("error"); }
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!order) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const st = await api.fetchOrderState(order.dbId);
        if (alive && st?.payment_status === "paid") { clearInterval(iv); onPaid(); }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the UPI apps directly (GPay / PhonePe / Paytm / any UPI) on this phone.
  async function payOnThisPhone() {
    if (!order) return;
    setErr("");
    try {
      const rp = await api.createRazorpayOrder(order.dbId);
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: rp.keyId, order_id: rp.orderId, amount: rp.amount, currency: rp.currency || "INR",
        name: "NGS Nisha General Store", description: "NGS Prime membership",
        prefill: { name: user?.name || "", email: user?.email || "", contact: user?.phone || "" },
        theme: { color: "#0a9155" },
        handler: async (resp) => {
          try {
            await api.verifyRazorpayPayment({
              orderId: order.dbId,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
          } catch { /* the polling effect / webhook still confirms it */ }
        },
      });
      rzp.on("payment.failed", (r) => setErr(r?.error?.description || "Payment failed. Please try again."));
      rzp.open();
    } catch (e) {
      setErr(e.message || "Couldn't open the payment. Please try again.");
    }
  }

  return (
    <div className="mem-qr">
      <div className="mem-qr-amt">Pay ₹{price} to join NGS Prime<span>🔒 Secured by Razorpay</span></div>
      {qr === "error" ? (
        <div className="auth-error">{err}</div>
      ) : qr && qr.url ? (
        <>
          <button className="checkout-btn" onClick={payOnThisPhone}>Pay with a UPI app on this phone</button>
          <div className="mem-qr-or">— or scan the QR —</div>
          <div className="mem-qr-wrap"><img className="mem-qr-img" src={qr.url} alt="UPI payment QR" /></div>
          <p className="member-note">Open GPay, PhonePe, Paytm or any UPI app. Your membership activates automatically the moment you pay.</p>
          {err && <div className="auth-error">{err}</div>}
        </>
      ) : (
        <div className="mem-qr-loading">Creating a secure QR…</div>
      )}
      <button className="ghost-btn full" onClick={onCancel}>Cancel</button>
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
