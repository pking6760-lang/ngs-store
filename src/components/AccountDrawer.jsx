import ApkDownloadRow from "./ApkDownloadRow.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useCart } from "../context/CartContext.jsx";
import { useMyOrders, useSettings, useUserNotifications, useWallet, useProducts } from "../lib/hooks.js";
import { toast } from "../lib/toast.js";
import { markUserNotificationsRead, setOrderRating, ORDER_STATUSES } from "../lib/store.js";
import * as api from "../lib/api.js";
import { googleMapsLink } from "../lib/location.js";
import { MEMBERSHIP, redeemableRupees, pointsForSpend } from "../lib/rewards.js";
import { cleanUpiQrFromImage, decodeUpiFromQr, loadRazorpay } from "../lib/payments.js";
import UpiPayScreen from "./UpiPayScreen.jsx";
import { useBackGuard } from "../lib/useBackGuard.js";
import { useShowMore } from "../lib/useShowMore.js";
import ScratchCard from "./ScratchCard.jsx";
import ProductThumb from "./ProductThumb.jsx";
import { useTheme } from "../lib/darkMode.js";
import { tr } from "../lib/i18n.jsx";

// Appearance control — System / Light / Dark, remembered on the device. Shown to
// everyone (guests too), since the theme is a device choice, not an account one.
function ThemeToggle() {
  const { pref, setTheme } = useTheme();
  const opts = [
    { id: "system", label: tr("System"), d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 0v18" },
    { id: "light", label: tr("Light"), d: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" },
    { id: "dark", label: tr("Dark"), d: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" },
  ];
  return (
    <div className="theme-toggle">
      <span className="theme-toggle-lbl">{tr("Appearance")}</span>
      <div className="theme-seg" role="group" aria-label={tr("Appearance")}>
        {opts.map((o) => (
          <button key={o.id} type="button"
            className={pref === o.id ? "on" : ""}
            aria-pressed={pref === o.id}
            onClick={() => setTheme(o.id)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={o.d} /></svg>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Slide-in account panel. Extend it by adding a TABS entry + a matching panel.
const TABS = [
  { id: "orders", label: "My Orders" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "inbox", label: "Inbox" },
  { id: "rewards", label: "Rewards" },
  { id: "refer", label: "Refer & earn" },
  { id: "membership", label: "Membership" },
  { id: "profile", label: "Profile" },
];
// The Wallet lives on the home screen, not in this menu — but it's still a
// section page reachable from the home wallet card (initialTab="wallet").
const WALLET_TAB = { id: "wallet", label: "Wallet" };

export default function AccountDrawer({ open, onClose, initialTab, onOpenCart }) {
  const { user, isLoggedIn, logout } = useAuth();
  // null = the account menu (list of sections); a tab id = that section's page.
  const [tab, setTab] = useState(null);
  // An order code an inbox notification asked to open (e.g. "NGS6985").
  const [openOrderCode, setOpenOrderCode] = useState(null);
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

  const active = [...TABS, WALLET_TAB].find((t) => t.id === tab);

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
          <h2>{active ? tr(active.label) : tr("My Account")}</h2>
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
                    {user.member && (
                      <span className="member-chip"><MIcon d={PIC.crown} size={12} /> Prime</span>
                    )}
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
                  <span className="account-menu-label">{tr(t.label)}</span>
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
                openCode={openOrderCode}
                onOpenedCode={() => setOpenOrderCode(null)}
                onReorder={() => {
                  onClose();
                  onOpenCart && onOpenCart();
                }}
              />
            )}
            {tab === "wallet" && <WalletTab userId={user?.id} />}
            {tab === "subscriptions" && <Subscriptions onShop={() => { onClose(); }} />}
            {tab === "inbox" && (
              <Inbox
                notes={notes} userId={user?.id} error={notesError} onRetry={reloadNotes}
                onOpenOrder={(code) => { setOpenOrderCode(code); setTab("orders"); }}
              />
            )}
            {tab === "rewards" && <Rewards user={user} onShop={() => { onClose(); }} />}
            {tab === "refer" && <Referral user={user} />}
            {tab === "membership" && <Membership />}
            {tab === "profile" && <Profile />}
          </div>
        )}

        {/* Appearance, legal links and Log out belong to the account home — not
            to a section page like Orders, where they read as clutter under the
            list. Only show them on the menu. */}
        {!active && (
          <div className="account-foot">
            <ThemeToggle />
            <nav className="legal-links">
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer">{tr("Privacy")}</a>
              <a href="/terms.html" target="_blank" rel="noopener noreferrer">{tr("Terms")}</a>
              <a href="/refunds.html" target="_blank" rel="noopener noreferrer">{tr("Refunds")}</a>
              <a href="/shipping.html" target="_blank" rel="noopener noreferrer">{tr("Shipping")}</a>
              <a href="/contact.html" target="_blank" rel="noopener noreferrer">{tr("Contact")}</a>
            </nav>
            <ApkDownloadRow app="customer" />
            {isLoggedIn && (
              <button className="logout-btn" onClick={handleLogout}>
                {tr("Log out")}
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

const SUB_STATUS = {
  active: { label: "Active", cls: "on" }, pending: { label: "Awaiting payment", cls: "off" },
  completed: { label: "Completed", cls: "off" }, cancelled: { label: "Cancelled", cls: "off" },
};
const dateText = (d) => {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
// Next undelivered day = start + daysDone (the daily orders already created cover
// start … start+daysDone-1).
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// A subscription's daily 2-hour delivery window, from its start hour, as
// "8:00–10:00 AM". The am/pm is shared when both ends fall in the same half.
function deliveryWindow(hour) {
  const h = Number.isFinite(hour) ? hour : 8;
  const fmt = (x) => { const m = ((x % 24) + 24) % 24; return { hh: ((m + 11) % 12) + 1, ap: m < 12 ? "AM" : "PM" }; };
  const a = fmt(h), b = fmt(h + 2);
  return a.ap === b.ap ? `${a.hh}:00–${b.hh}:00 ${a.ap}` : `${a.hh}:00 ${a.ap} – ${b.hh}:00 ${b.ap}`;
}
function subNextDelivery(s) {
  // Next delivery = the daysDone-th date from start that isn't a skipped day
  // (orders are created a day ahead, so the latest-created one is the next drop).
  if (s.status !== "active" || !s.startDate || s.daysDone < 1 || s.daysDone > s.daysTotal) return "";
  const skips = new Set(s.skipDates || []);
  const d = new Date(s.startDate + "T00:00:00");
  let count = 0;
  for (let i = 0; i < 400; i++) {
    if (!skips.has(isoLocal(d))) { count++; if (count === s.daysDone) return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }); }
    d.setDate(d.getDate() + 1);
  }
  return "";
}
// The next `count` upcoming delivery dates (non-skipped days at positions
// daysDone, daysDone+1, …), capped by how many deliveries remain on the plan.
function upcomingDeliveries(s, count) {
  if (s.status !== "active" || !s.startDate || s.daysDone < 1) return [];
  const skips = new Set(s.skipDates || []);
  const remaining = Math.max(s.daysTotal - s.daysDone + 1, 0);
  const want = Math.min(count, remaining);
  const out = [];
  const d = new Date(s.startDate + "T00:00:00");
  let pos = 0;
  for (let i = 0; i < 500 && out.length < want; i++) {
    if (!skips.has(isoLocal(d))) { pos++; if (pos >= s.daysDone) out.push(new Date(d)); }
    d.setDate(d.getDate() + 1);
  }
  return out;
}
const skipDateText = (d) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

const SKIP_PRESETS = [1, 2, 3, 5, 7];
// "Away for a few days" — skip the next N deliveries. Each moves to the end of
// the plan (customer keeps every day they paid for). Backend: skip_deliveries.
function SkipSheet({ sub, onClose, onDone }) {
  const [days, setDays] = useState(1);
  const [mode, setMode] = useState("preset");   // "preset" | "custom"
  const [busy, setBusy] = useState(false);
  const custom = mode === "custom";
  const pickPreset = (d) => { setMode("preset"); setDays(d); };
  // You can skip up to every delivery still left on the plan (each one moves to
  // the end), so the ceiling follows the plan — not an arbitrary 14.
  const maxSkip = Math.max(sub.daysTotal - sub.daysDone + 1, 1);
  // Fine-tune with a stepper (no OS keyboard, so the date preview below stays
  // visible while you dial the number).
  // Hold a stepper button to repeat, speeding up — so reaching a full-month
  // pause is a press, not thirty taps. Self-terminates at the bound (a disabled
  // button may never fire pointer-up), and one quick tap = one step.
  const holdRef = useRef(null);
  const endHold = () => { clearTimeout(holdRef.current); holdRef.current = null; };
  const startHold = (delta) => {
    setMode("custom");
    let wait = 320;
    const tick = () => {
      let atBound = false;
      setDays((d) => {
        const next = Math.max(1, Math.min(maxSkip, d + delta));
        if (next === d) atBound = true;    // hit floor/ceiling — stop repeating
        return next;
      });
      if (atBound) { endHold(); return; }
      wait = Math.max(45, wait - 40);      // accelerate
      holdRef.current = setTimeout(tick, wait);
    };
    tick();
  };
  useEffect(() => endHold, []);            // clear any pending repeat on unmount
  const dates = upcomingDeliveries(sub, days);
  const n = dates.length;
  const after = upcomingDeliveries(sub, days + 1);
  const resume = after.length > n ? after[n] : null;

  async function confirm() {
    setBusy(true);
    try { const done = await api.skipDeliveries(sub.id, days); onDone(done); }
    catch (e) { toast(e.message || tr("Couldn't skip those days.")); setBusy(false); }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sub-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sub-head">
          <h3>{tr("Going away? Pause deliveries")}</h3>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sub-body">
          <p className="skip-lead">
            Skipped days aren't charged and move to the end — you still get all {sub.daysTotal} deliveries.
          </p>

          <div className="sub-field-lbl">{tr("How many days away?")}</div>
          <div className="sub-freq">
            {SKIP_PRESETS.map((d) => (
              <button key={d} className={`sub-freq-btn ${!custom && days === d ? "on" : ""}`} onClick={() => pickPreset(d)}>
                {d} {d === 1 ? "day" : "days"}
              </button>
            ))}
            <div className={`sub-freq-btn sub-days-stepper ${custom ? "on" : ""}`}>
              <button type="button" className="step-btn" aria-label="Fewer days"
                disabled={days <= 1}
                onPointerDown={() => startHold(-1)} onPointerUp={endHold}
                onPointerLeave={endHold} onPointerCancel={endHold}>−</button>
              <span className="step-val"><strong>{days}</strong> {days === 1 ? "day" : "days"}</span>
              <button type="button" className="step-btn" aria-label="More days"
                disabled={days >= maxSkip}
                onPointerDown={() => startHold(1)} onPointerUp={endHold}
                onPointerLeave={endHold} onPointerCancel={endHold}>+</button>
            </div>
          </div>

          {n > 0 ? (
            <div className="skip-preview">
              <div className="sub-field-lbl">Skipping {n} {n === 1 ? "delivery" : "deliveries"}</div>
              <div className="skip-dates">
                {dates.map((d, i) => <span key={i} className="skip-date-chip">{skipDateText(d)}</span>)}
              </div>
              <p className="skip-resume">
                {resume
                  ? <>{tr("Deliveries resume")} <strong>{skipDateText(resume)}</strong>. Your plan now ends {n} day{n === 1 ? "" : "s"} later.</>
                  : <>These are your last {n} day{n === 1 ? "" : "s"} — the plan finishes after them.</>}
              </p>
            </div>
          ) : (
            <p className="skip-resume">No upcoming deliveries left to skip on this plan.</p>
          )}
        </div>
        <div className="sub-foot">
          <button className="sub-start" disabled={busy || n === 0} onClick={confirm}>
            {busy ? "Skipping…" : n > 0 ? `Skip ${n} ${n === 1 ? "delivery" : "deliveries"}` : "Skip deliveries"}
          </button>
          <button className="ghost-btn full" onClick={onClose} style={{ marginTop: 10 }}>{tr("Keep my deliveries")}</button>
        </div>
      </div>
    </div>
  );
}

// Cancel a plan: unused days refunded to wallet. Professional confirm sheet.
function CancelSheet({ sub, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const left = Math.max(sub.daysTotal - sub.daysDone, 0);
  const refund = Math.round(left * sub.dailyTotal);

  async function confirm() {
    setBusy(true);
    try { await api.cancelSubscription(sub.id); onDone(); }
    catch (e) { toast(e.message || tr("Couldn't cancel.")); setBusy(false); }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sub-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sub-head">
          <h3>{tr("Cancel this plan?")}</h3>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sub-body">
          <p className="skip-lead">We'll stop future deliveries right away. Deliveries already made aren't affected.</p>
          <div className="sub-total">
            <div className="sub-total-line"><span>{tr("Unused days")}</span><span>{left} day{left === 1 ? "" : "s"}</span></div>
            <div className="sub-total-row"><span>{tr("Refund to your wallet")}</span><strong>₹{refund}</strong></div>
            <div className="sub-total-note">Refunded instantly to your NGS Wallet — use it on any order.</div>
          </div>
        </div>
        <div className="sub-foot">
          <button className="sub-start danger" disabled={busy} onClick={confirm}>
            {busy ? "Cancelling…" : refund > 0 ? `Cancel & refund ₹${refund}` : "Cancel plan"}
          </button>
          <button className="ghost-btn full" onClick={onClose} style={{ marginTop: 10 }}>{tr("Keep my plan")}</button>
        </div>
      </div>
    </div>
  );
}

// Manage prepaid plans: see progress + next delivery, cancel (unused days refund).
function Subscriptions({ onShop }) {
  const products = useProducts();
  const [subs, setSubs] = useState(null);
  const [skipFor, setSkipFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [skippingId, setSkippingId] = useState(null);
  const prodOf = (id) => products.find((p) => p.id === id) || null;
  const nameOf = (id) => prodOf(id)?.name || tr("Item");

  async function load() {
    // Hide never-paid "pending" plans — only real (paid) plans belong here.
    try { setSubs((await api.fetchMySubscriptions()).filter((s) => s.status !== "pending")); }
    catch { setSubs([]); }
  }
  useEffect(() => { load(); }, []);

  async function onSkipped(done) {
    setSkipFor(null);
    await load();
    toast(done > 1 ? `${done} deliveries skipped — they move to the end of your plan.` : "Skipped — your milk resumes the next day.");
  }
  async function onCancelled() {
    setCancelFor(null);
    await load();
    toast("Plan cancelled — refund added to your wallet.");
  }
  // One-tap skip of just the next day (moves it to the end, plan length kept).
  async function skipNextOne(s) {
    if (skippingId) return;
    setSkippingId(s.id);
    try {
      await api.skipNextDelivery(s.id);
      await load();
      toast("Next delivery skipped — it moves to the end of your plan.");
    } catch (e) {
      toast(e.message || "Couldn't skip that day.");
    } finally { setSkippingId(null); }
  }

  if (subs === null) return <p className="account-loading">Loading…</p>;
  if (subs.length === 0) {
    return (
      <div className="account-empty">
        <p>{tr("No subscriptions yet")}</p>
        <span>Add items to your cart and tap “Subscribe &amp; prepay” at checkout to get daily deliveries.</span>
        <button className="checkout-btn" onClick={onShop}>{tr("Browse products")}</button>
      </div>
    );
  }
  return (
    <div className="subs-list">
      {subs.map((s) => {
        const st = SUB_STATUS[s.status] || SUB_STATUS.pending;
        const next = subNextDelivery(s);
        const done = Math.min(s.daysDone, s.daysTotal);
        const pct = s.daysTotal > 0 ? Math.min(100, Math.round((done / s.daysTotal) * 100)) : 0;
        const lead = s.items[0];
        const leadP = lead ? prodOf(lead.id) : null;
        const active = s.status === "active";
        return (
          <div className={`sub-card ${active ? "" : "paused"}`} key={s.id}>
            <div className="sub-card-head">
              {lead && (
                <ProductThumb
                  image={leadP?.image}
                  name={nameOf(lead.id)}
                  category={leadP?.category}
                  size={46}
                  radius={12}
                />
              )}
              <div className="sub-head-text">
                <span className="sub-head-name">
                  {lead ? `${nameOf(lead.id)}${s.items.length > 1 ? ` +${s.items.length - 1} more` : ` × ${lead.qty}`}` : tr("Plan")}
                </span>
                <span className="sub-head-plan">
                  {s.daysTotal}-{tr("day plan")} · {["wallet_daily", "upi_autopay"].includes(s.payMethod)
                    ? `₹${Math.round(s.dailyTotal)}/${tr("day")}`
                    : `₹${Math.round(s.amount)}`}
                </span>
              </div>
              <span className={`sub-status ${st.cls}`}>{tr(st.label)}</span>
            </div>

            {s.items.length > 1 && (
              <div className="sub-items">
                {s.items.map((it, i) => (
                  <span key={i} className="sub-item-chip">{nameOf(it.id)} × {it.qty}</span>
                ))}
              </div>
            )}

            <div className="sub-progress">
              <div className="sub-progress-track"><span style={{ width: `${pct}%` }} /></div>
              <span className="sub-progress-lbl">{tr("Day")} {done} {tr("of")} {s.daysTotal}</span>
            </div>

            <div className="sub-info-row">
              <span className="sub-sched">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2" /></svg>
                {tr("Every day")} · {deliveryWindow(s.hour)}
              </span>
              {active && next && (
                <span className="sub-next-pill">
                  <b>{tr("Next delivery")}</b> {next}
                </span>
              )}
            </div>

            <div className="sub-pay">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" /><circle cx="16.5" cy="12.5" r="1.3" fill="currentColor" stroke="none" /></svg>
              {s.payMethod === "upi_autopay" ? tr("UPI Autopay · bank auto-debit")
                : s.payMethod === "wallet_daily" ? tr("Auto-pay from NGS Wallet")
                : s.payMethod === "wallet" ? tr("Prepaid via NGS Wallet") : tr("Prepaid via UPI")}
            </div>

            {active && (
              <div className="sub-card-actions">
                {next && (
                  <button className="sub-skip" disabled={skippingId === s.id} onClick={() => skipNextOne(s)}>
                    {skippingId === s.id ? "…" : tr("Skip next delivery")}
                  </button>
                )}
                <div className="sub-actions-main">
                  <button className="sub-pause" onClick={() => setSkipFor(s)}>{tr("Pause")}</button>
                  <button className="sub-cancel" onClick={() => setCancelFor(s)}>{tr("Cancel plan")}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {skipFor && <SkipSheet sub={skipFor} onClose={() => setSkipFor(null)} onDone={onSkipped} />}
      {cancelFor && <CancelSheet sub={cancelFor} onClose={() => setCancelFor(null)} onDone={onCancelled} />}
    </div>
  );
}

// A status pill with a small glyph so the state is recognised at a glance —
// a check for delivered, a clock for scheduled, and so on.
function OrderStatusBadge({ status }) {
  const s = slug(status);
  const ICON = {
    delivered: "M20 6 9 17l-5-5",
    scheduled: "M12 8v4l2.5 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    cancelled: "M18 6 6 18M6 6l12 12",
    returned: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
    "out-for-delivery": "M3 7h11v8H3zM14 10h4l3 3v2h-7zM7 18a2 2 0 1 0 0 .1zM18 18a2 2 0 1 0 0 .1z",
    packing: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10",
  }[s];
  return (
    <span className={`status-badge status-${s}`}>
      {ICON && (
        <svg className="status-ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={ICON} /></svg>
      )}
      {status}
    </span>
  );
}

function MyOrders({ user, onReorder, openCode, onOpenedCode }) {
  // RLS-scoped fetch of only this user's own orders (not the admin all-orders path).
  const { orders: myOrders, loading, error, reload } = useMyOrders(user?.id);
  // The catalogue carries the product photos; order lines only store name + qty,
  // so we resolve each line's image by its product id for a real thumbnail.
  const products = useProducts();
  const prodMap = useMemo(() => {
    const m = new Map();
    for (const p of products || []) m.set(p.id, p);
    return m;
  }, [products]);
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState("all");
  const openOrder = myOrders.find((o) => o.id === openId) || null;
  // Back button closes the order detail before the section page.
  useBackGuard(!!openId, () => setOpenId(null));
  // An inbox notification asked to open a specific order — jump straight to it.
  useEffect(() => {
    if (openCode && myOrders.some((o) => o.id === openCode)) {
      setOpenId(openCode);
      onOpenedCode && onOpenedCode();
    }
  }, [openCode, myOrders]); // eslint-disable-line react-hooks/exhaustive-deps

  const FILTERS = [
    { id: "all", label: tr("All") },
    { id: "active", label: tr("Active") },
    { id: "delivered", label: tr("Delivered") },
    { id: "cancelled", label: tr("Cancelled") },
  ];
  const matchFilter = (o) => {
    const s = slug(o.status);
    if (filter === "delivered") return s === "delivered";
    if (filter === "cancelled") return s === "cancelled";
    if (filter === "active") return !["delivered", "cancelled", "returned"].includes(s);
    return true;
  };
  const filtered = myOrders.filter(matchFilter);
  const list = useShowMore(filtered, 8);
  // Filter chips only earn their space once there's a real list to sift.
  const showFilters = myOrders.length > 5;

  if (error) return <RetryState error="Couldn't load your orders." onRetry={reload} label="your orders" />;

  if (myOrders.length === 0) {
    return (
      <div className="account-empty">
        <div className="empty-ic"><MIcon d={PIC.box} size={30} /></div>
        <p>{loading ? "Loading your orders…" : "No orders yet"}</p>
        {!loading && <span>Your orders and their live status will appear here.</span>}
      </div>
    );
  }

  return (
    <div className="my-orders">
      {showFilters && (
        <div className="order-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`order-filter ${filter === f.id ? "on" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {list.shown.map((o) => {
        const lead = o.items[0];
        const p = lead ? prodMap.get(lead.id) : null;
        const count = o.items.length;
        return (
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
              <OrderStatusBadge status={o.status} />
            </div>

            {lead && (
              <div className="my-order-items">
                <ProductThumb
                  image={p?.image || lead.image}
                  name={lead.name}
                  category={p?.category || lead.category}
                  size={40}
                  radius={11}
                />
                <div className="mo-item-text">
                  <span className="mo-item-name">
                    {lead.name}{count === 1 ? ` × ${lead.qty}` : ` + ${count - 1} more`}
                  </span>
                  <span className="mo-item-count">{count} {count === 1 ? tr("item") : tr("items")}</span>
                </div>
              </div>
            )}

            <div className="my-order-foot">
              <span className="my-order-pay">
                {o.rating ? "★".repeat(o.rating) : o.payment === "upi" ? "UPI" : "Cash on delivery"}
              </span>
              <span className="my-order-total">
                ₹{o.total} <span className="my-order-arrow">›</span>
              </span>
            </div>
          </button>
        );
      })}
      {filtered.length === 0 && (
        <p className="account-empty" style={{ padding: "24px 0" }}>{tr("No orders in this filter.")}</p>
      )}
      {list.more && (
        <button type="button" className="show-more-btn" onClick={list.toggle}>
          {list.label}
        </button>
      )}

      {openOrder && (
        <OrderDetail
          order={openOrder}
          onClose={() => setOpenId(null)}
          onReorder={onReorder}
          prodMap={prodMap}
        />
      )}
    </div>
  );
}

function OrderDetail({ order, onClose, onReorder, prodMap }) {
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
          {order.deliverySlot && !cancelled && (
            <div className="order-detail-slot">🕑 Delivery: {order.deliverySlot}</div>
          )}

          {cancelled ? (
            <div className="order-note cancelled">
              <span className="order-note-ic"><MIcon d={PIC.xc} size={18} /></span>
              <span>{tr("This order was cancelled.")}</span>
            </div>
          ) : returned ? (
            <div className="order-note returned">
              <span className="order-note-ic"><MIcon d={PIC.undo} size={18} /></span>
              <span>
                {order.status === "Returned"
                  ? `This order was returned.${order.refundedAmount > 0 ? ` ₹${order.refundedAmount} was added to your NGS Wallet.` : ""}`
                  : "A return is being arranged — our partner will collect the items."}
              </span>
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
            {order.items.map((it) => {
              const p = prodMap?.get(it.id);
              return (
              <div className="order-detail-item" key={it.id}>
                <ProductThumb image={p?.image || it.image} name={it.name} category={p?.category || it.category} size={38} radius={9} />
                <span className="odi-name">{it.name}</span>
                <span className="odi-qty">× {it.qty}</span>
                <span className="odi-price">₹{it.price * it.qty}</span>
              </div>
              );
            })}
          </div>

          <div className="order-detail-bill">
            <Row k="Item total" v={`₹${order.itemTotal}`} />
            {order.couponDiscount > 0 && <Row k={`Coupon ${order.couponCode || ""}`.trim()} v={`−₹${order.couponDiscount}`} good />}
            {order.pointsDiscount > 0 && <Row k={`Points used${order.pointsRedeemed ? ` (${order.pointsRedeemed} pts)` : ""}`} v={`−₹${order.pointsDiscount}`} good />}
            {order.welcomeDiscount > 0 && <Row k="Extra discount" v={`−₹${order.welcomeDiscount}`} good />}
            <Row k="Delivery fee" v={order.deliveryFee ? `₹${order.deliveryFee}` : "FREE"} />
            <Row k="Handling" v={`₹${order.handling}`} />
            {order.surgeFee > 0 && <Row k="Surge" v={`₹${order.surgeFee}`} />}
            {order.membershipFee > 0 && <Row k="NGS Prime membership" v={`₹${order.membershipFee}`} />}
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
            <MIcon d={PIC.reorder} size={17} /> Reorder these items
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
      setError(e?.message || tr("Couldn't save your rating. Please try again."));
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
      {done && <p className="rating-thanks">{tr("Thanks for your feedback!")}</p>}
    </div>
  );
}

function RetryState({ error, onRetry, label }) {
  return (
    <div className="load-retry">
      <div className="load-retry-ic"><MIcon d={PIC.alert} size={22} /></div>
      <p>{error || `Couldn't load ${label || "this"}.`}</p>
      <button className="load-retry-btn" onClick={onRetry}>
        <MIcon d={PIC.reorder} size={15} /> {tr("Retry")}
      </button>
    </div>
  );
}

function WalletTab({ userId }) {
  const { balance, ledger, loading, error, reload } = useWallet(userId);
  const [addOpen, setAddOpen] = useState(false);
  const list = useShowMore(ledger, 12);
  // Balance counts up smoothly, and the card gives a brief green glow whenever
  // the balance jumps up (money added, a refund landed).
  const shownBal = useCountUp(balance);
  const glow = useBalanceGlow(balance);
  const stats = useMemo(() => walletStats(ledger), [ledger]);
  const groups = useMemo(() => groupLedgerByDay(list.shown), [list.shown]);
  if (error) return <RetryState error="Couldn't load your wallet." onRetry={reload} label="your wallet" />;

  return (
    <div className="wallet-tab">
      <div className={`wallet-card ${glow ? "glow" : ""}`}>
        <div className="wallet-card-head">
          <span className="wallet-card-lbl">{tr("NGS Wallet balance")}</span>
          <span className="wallet-card-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,.14)" />
              <path d="M8.5 7.5h7M8.5 10.5h7M14.6 7.5c0 3.4-4.6 3.2-4.6 3.2l4.2 3.8" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <div className="wallet-card-bal">₹{shownBal.toFixed(2)}</div>
        <div className="wallet-card-note">{tr("Refunds and rewards land here, ready for your next order.")}</div>
        <button className="wallet-add-btn" onClick={() => setAddOpen(true)}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" /><circle cx="16.5" cy="12.5" r="1.4" fill="currentColor" stroke="none" /></svg>
          {tr("Add money")}
        </button>
      </div>

      {ledger.length > 0 && (
        <div className="wallet-stats">
          <WalletStat kind="earned" label={tr("Earned")} value={stats.earned} />
          <WalletStat kind="spent"  label={tr("Spent")}  value={stats.spent} />
          <WalletStat kind="added"  label={tr("Added")}  value={stats.added} />
        </div>
      )}

      {addOpen && (
        <WalletTopup
          onClose={() => setAddOpen(false)}
          onDone={() => { setAddOpen(false); reload(); }}
        />
      )}

      {loading && ledger.length === 0 ? (
        <p className="account-empty">Loading…</p>
      ) : ledger.length === 0 ? (
        <WalletEmpty />
      ) : (
        <div className="wallet-history">
          {groups.map((g) => (
            <div className="wallet-group" key={g.key}>
              <div className="wallet-group-lbl">{g.label}</div>
              <div className="wallet-list">
                {g.items.map((e) => <WalletRow key={e.id} e={e} />)}
              </div>
            </div>
          ))}
          {list.more && (
            <button type="button" className="show-more-btn" onClick={list.toggle}>
              {list.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// One ledger line: a typed icon (credit ↑ / debit ↓ / refund ↻), the label +
// time, and the signed amount. Slides in from the top on first mount.
function WalletRow({ e }) {
  const credit = e.amount >= 0;
  const refund = e.kind === "refund";
  const type = refund ? "refund" : credit ? "cr" : "dr";
  return (
    <div className="wallet-row">
      <span className={`wallet-ic ${type}`} aria-hidden="true">
        {refund ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
        ) : credit ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
        )}
      </span>
      <div className="wallet-row-main">
        <span className="wallet-row-note">{walletLabel(e)}</span>
        <span className="wallet-row-date">{fmtWalletTime(e.at)}</span>
      </div>
      <span className={`wallet-row-amt ${credit ? "cr" : "dr"}`}>
        {credit ? "+" : "−"}₹{Math.abs(e.amount).toFixed(2)}
      </span>
    </div>
  );
}

// A quick-stat cell under the balance (Earned / Spent / Added).
function WalletStat({ kind, label, value }) {
  const ICON = {
    earned: <path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8M2 7.5h20v4.5H2zM12 21V7.5M12 7.5H7.6a2.5 2.5 0 0 1 0-5C11 2.5 12 7.5 12 7.5zM12 7.5h4.4a2.5 2.5 0 0 0 0-5C13 2.5 12 7.5 12 7.5z" />,
    spent:  <path d="M3 7h18M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7M3 7l2.5-4h13L21 7M16 12h2" />,
    added:  <path d="M12 5v14M5 12h14" />,
  }[kind];
  return (
    <div className={`wallet-stat ${kind}`}>
      <span className="wallet-stat-ic" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{ICON}</svg>
      </span>
      <span className="wallet-stat-val">₹{Math.round(value).toLocaleString("en-IN")}</span>
      <span className="wallet-stat-lbl">{label}</span>
    </div>
  );
}

// Nothing to show yet — a friendly illustration instead of a blank panel.
function WalletEmpty() {
  return (
    <div className="wallet-empty">
      <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7h15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
        <circle cx="16.5" cy="12.5" r="1.6" />
      </svg>
      <p className="wallet-empty-title">{tr("No wallet activity yet")}</p>
      <p className="wallet-empty-sub">{tr("Refunds and cashback will appear here.")}</p>
    </div>
  );
}

// Add-money sheet: pick an amount, then pay by UPI. The wallet is credited
// server-side only after Razorpay confirms (same pipeline as membership pay).
function WalletTopup({ onClose, onDone }) {
  const [step, setStep] = useState("amount"); // "amount" | "pay"
  const [amount, setAmount] = useState(0);
  const [custom, setCustom] = useState("");
  const QUICK = [100, 200, 500, 1000];
  const amt = custom ? parseInt(custom, 10) || 0 : amount;
  const valid = amt >= 50 && amt <= 10000;

  useBackGuard(true, () => (step === "pay" ? setStep("amount") : onClose()));

  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div className="wtop" onClick={(e) => e.stopPropagation()}>
        <div className="wtop-grip" />
        <button className="pd-sheet-x wtop-x" onClick={onClose} aria-label="Close">✕</button>

        {step === "amount" ? (
          <>
            <div className="wtop-title">{tr("Add money")}</div>
            <div className="wtop-sub">Top up your NGS Wallet and use it on any order.</div>
            <div className="wtop-chips">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`wtop-chip ${!custom && amount === q ? "on" : ""}`}
                  onClick={() => { setAmount(q); setCustom(""); }}
                >
                  ₹{q}
                </button>
              ))}
            </div>
            <label className="wtop-custom">
              <span className="wtop-rupee">₹</span>
              <input
                type="tel"
                inputMode="numeric"
                value={custom}
                onChange={(e) => { setCustom(e.target.value.replace(/\D/g, "").slice(0, 5)); setAmount(0); }}
                placeholder="Enter another amount"
              />
            </label>
            <div className="wtop-hint">Add between ₹50 and ₹10,000.</div>
            <button className="checkout-btn" disabled={!valid} onClick={() => setStep("pay")}>
              {valid ? `Proceed to pay ₹${amt}` : "Enter an amount"}
            </button>
          </>
        ) : (
          <TopupPay amount={amt} onPaid={onDone} onBack={() => setStep("amount")} />
        )}
      </div>
    </div>,
    document.body
  );
}

// UPI/QR payment for a wallet top-up — creates a top-up order, shows its
// Razorpay UPI QR (or opens a UPI app), and polls until the webhook confirms.
function TopupPay({ amount, onPaid, onBack }) {
  const { user } = useAuth();
  const [qr, setQr] = useState("loading"); // "loading" | "error" | { url }
  const [upiIntent, setUpiIntent] = useState("");
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState("");
  const [paying, setPaying] = useState(false);
  const rzpOrderRef = useRef(null); // pre-created Razorpay order, so the tap is instant

  useEffect(() => {
    let alive = true;
    setQr("loading");
    // Warm the Razorpay SDK immediately so tapping "Pay with a UPI app" doesn't
    // stall for a few seconds downloading the checkout script.
    loadRazorpay().catch(() => {});
    (async () => {
      try {
        const o = await api.createTopupOrder(amount);
        if (!alive) return;
        setOrder(o);
        // Pre-create the Razorpay order in the background too, so the button
        // opens the payment sheet instantly instead of waiting on a round-trip.
        api.createRazorpayOrder(o.dbId).then((rp) => { if (alive) rzpOrderRef.current = rp; }).catch(() => {});
        const { imageUrl, imageDataUrl } = await api.createOrderQr(o.dbId);
        const clean = await cleanUpiQrFromImage(imageDataUrl).catch(() => null);
        const intent = await decodeUpiFromQr(imageDataUrl).catch(() => "");
        if (alive) { setUpiIntent(intent); setQr({ url: clean || imageDataUrl || imageUrl }); }
      } catch (e) {
        if (alive) { setErr(e.message || "Couldn't start the payment."); setQr("error"); }
      }
    })();
    return () => { alive = false; };
  }, [amount]);

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

  async function payOnThisPhone() {
    if (!order || paying) return;
    setErr(""); setPaying(true);
    try {
      // Use the pre-created order + pre-loaded SDK when ready (instant); fall
      // back to creating/loading on the spot if the warm-up hasn't finished.
      const rp = rzpOrderRef.current || (await api.createRazorpayOrder(order.dbId));
      rzpOrderRef.current = rp;
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: rp.keyId, order_id: rp.orderId, amount: rp.amount, currency: rp.currency || "INR",
        name: "NGS Nisha General Store", description: `Wallet top-up · ₹${amount}`,
        prefill: { name: user?.name || "", email: user?.email || "", contact: user?.phone || "" },
        theme: { color: "#0a9155" },
        modal: { ondismiss: () => setPaying(false) },
        handler: async (resp) => {
          setPaying(false);
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
      rzp.on("payment.failed", (r) => { setPaying(false); setErr(r?.error?.description || tr("Payment failed. Please try again.")); });
      rzp.open();
    } catch (e) {
      setErr(e.message || "Couldn't open the payment. Please try again.");
      setPaying(false);
    }
  }

  return (
    <div className="mem-qr">
      <UpiPayScreen
        amount={amount}
        loading={qr === null || qr === "loading"}
        qrSrc={qr && qr.url ? qr.url : null}
        upiIntent={upiIntent}
        onRazorpay={payOnThisPhone}
        error={qr === "error" ? err : ""}
        note="The money lands in your NGS Wallet automatically the moment you pay."
      />
      <button className="ghost-btn full" onClick={onBack}>
        {qr === "error" ? "Back" : "Change amount"}
      </button>
    </div>
  );
}

function walletLabel(e) {
  if (e.note) return e.note;
  return {
    refund: tr("Refund"), topup: tr("Money added"), spent: tr("Used on order"),
    referral: tr("Referral reward"), change: tr("Change returned"),
    cancel_fee: tr("Cancellation fee"), adjust: tr("Adjustment"), adjustment: tr("Adjustment"),
  }[e.kind] || e.kind;
}
// Rows sit under a day header (Today / Yesterday / date), so the line itself
// only needs the time.
function fmtWalletTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

// Three honest buckets from the ledger, no overlap: money you added (top-ups),
// money you earned another way (refunds + rewards + change), and money you spent
// from the wallet on orders.
function walletStats(ledger) {
  let added = 0, earned = 0, spent = 0;
  for (const e of ledger || []) {
    const amt = Number(e.amount) || 0;
    if (amt < 0) spent += -amt;
    else if (e.kind === "topup") added += amt;
    else earned += amt;
  }
  return { added, earned, spent };
}

// Group ledger rows under Today / Yesterday / "26 Jul" headers, newest first.
function groupLedgerByDay(items) {
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const today = startOfDay(new Date());
  const dayMs = 86400000;
  const out = [];
  const byKey = new Map();
  for (const e of items || []) {
    const d = new Date(e.at);
    const key = startOfDay(d);
    let label;
    if (key === today) label = tr("Today");
    else if (key === today - dayMs) label = tr("Yesterday");
    else {
      const sameYear = d.getFullYear() === new Date().getFullYear();
      label = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
    }
    if (!byKey.has(key)) { const g = { key, label, items: [] }; byKey.set(key, g); out.push(g); }
    byKey.get(key).items.push(e);
  }
  return out;
}

// Smoothly animates a number toward its target (~600ms ease-out). Used for the
// wallet balance so it "counts up" when the screen opens or money lands.
function useCountUp(target) {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    const to = Number(target) || 0;
    if (from === to) { setVal(to); return; }
    const dur = 600, t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return val;
}

// Brief green glow on the card whenever the balance jumps UP.
function useBalanceGlow(balance) {
  const [glow, setGlow] = useState(false);
  const prev = useRef(balance);
  useEffect(() => {
    if (balance > prev.current) {
      setGlow(true);
      const id = setTimeout(() => setGlow(false), 1300);
      prev.current = balance;
      return () => clearTimeout(id);
    }
    prev.current = balance;
  }, [balance]);
  return glow;
}

function Row({ k, v, good, bold }) {
  return (
    <div className={`odb-row ${bold ? "bold" : ""}`}>
      <span>{k}</span>
      <span className={good ? "free" : ""}>{v}</span>
    </div>
  );
}

// Six notification kinds, each with its own coloured glyph so the type reads at
// a glance. The kind is inferred from the text (there's no type column), which
// works for both old and new messages.
const NOTIF_KIND = {
  order:        { cls: "order",  d: "M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10" },
  subscription: { cls: "sub",    d: "M6.5 3h11l-1 3.5H7.5L6.5 3zM7.5 6.5h9V20a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V6.5zM7.5 10.5h9" },
  wallet:       { cls: "wallet", d: "M3 7h15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11M16.5 12.5h.01", extra: "coin" },
  reward:       { cls: "reward", d: "M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.3l6.5-.9L12 2.5z" },
  cart:         { cls: "cart",   d: "M2.5 3.5h2l2.2 12.4a1.6 1.6 0 0 0 1.6 1.3h9.1a1.6 1.6 0 0 0 1.6-1.3L21.5 7.5H6M9 21a1 1 0 1 0 .01 0M18 21a1 1 0 1 0 .01 0" },
  offer:        { cls: "offer",  d: "M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01" },
};
function classifyNote(n) {
  const t = ((n.title || "") + " " + (n.body || "")).toLowerCase();
  if (/wallet|refund|cashback|money added|added to your|credited/.test(t)) return "wallet";
  if (/reward|scratch|coupon|congrat|you won|prize|jeeta|inaam/.test(t)) return "reward";
  if (/cart|reh gaye|reh gaya|left in|wait kar/.test(t)) return "cart";
  if (/subscription|daily delivery|kal ki delivery|milk|doodh|dahi/.test(t)) return "subscription";
  if (/order|packed|on the way|out for delivery|delivered|dispatch|ngs\d+/.test(t)) return "order";
  return "offer";
}
const orderCodeOf = (n) => (((n.title || "") + " " + (n.body || "")).match(/\bNGS\d+\b/) || [])[0] || null;

// One inbox row: coloured type icon, title/body/time, unread dot. Swipe left to
// delete, swipe right to mark read; tap an order message to open that order.
function NotifRow({ n, onOpenOrder, onRead, onDelete }) {
  const kind = NOTIF_KIND[classifyNote(n)] || NOTIF_KIND.offer;
  const code = orderCodeOf(n);
  const tappable = !!code && ["order", "subscription"].includes(classifyNote(n));
  const [dx, setDx] = useState(0);
  const start = useRef(null);
  const moved = useRef(false);

  function onStart(e) { start.current = e.touches[0].clientX; moved.current = false; }
  function onMove(e) {
    if (start.current == null) return;
    const d = e.touches[0].clientX - start.current;
    if (Math.abs(d) > 6) moved.current = true;
    setDx(Math.max(-120, Math.min(120, d)));
  }
  function onEnd() {
    if (dx <= -70) { onDelete(n); return; }
    if (dx >= 70) { onRead(n); setDx(0); return; }
    setDx(0);
    start.current = null;
  }
  function onTap() {
    if (moved.current) return;
    if (tappable) { onRead(n); onOpenOrder(code); }
  }

  return (
    <div className="inbox-row">
      <div className="inbox-row-bg">
        <span className="inbox-bg-read">✓ {tr("Read")}</span>
        <span className="inbox-bg-del">{tr("Delete")} 🗑</span>
      </div>
      <div
        className={`inbox-item ${n.read ? "" : "unread"} ${tappable ? "tappable" : ""}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform .2s" }}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
        onClick={onTap} role={tappable ? "button" : undefined}
      >
        <span className={`inbox-ic ${kind.cls}`} aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={kind.d} /></svg>
        </span>
        <div className="inbox-main">
          <div className="inbox-item-title">
            {n.title}
            {!n.read && <span className="inbox-dot" aria-label="unread" />}
          </div>
          {n.body && <div className="inbox-item-body">{n.body}</div>}
          <div className="inbox-item-time">
            {formatTime(n.createdAt)}
            {tappable && <span className="inbox-open"> · {tr("Tap to view")} ›</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Inbox({ notes, userId, error, onRetry, onOpenOrder }) {
  const list = useShowMore(notes, 12);
  const unread = (notes || []).filter((n) => !n.read).length;

  const markRead = (n) => {
    if (n.read) return;
    if (api.isBackendConfigured) api.markNotificationRead(n.id);
    else markUserNotificationsRead(userId);
  };
  const del = (n) => { if (api.isBackendConfigured) api.deleteNotification(n.id); };
  const markAll = () => {
    if (api.isBackendConfigured) api.markNotificationsRead();
    else markUserNotificationsRead(userId);
  };

  if (error) return <RetryState error="Couldn't load your inbox." onRetry={onRetry} label="your inbox" />;

  if (!notes || notes.length === 0) {
    return (
      <div className="inbox-empty">
        <div className="inbox-empty-ic" aria-hidden="true">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13h4l2 3h6l2-3h4M5 13V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></svg>
        </div>
        <p className="inbox-empty-title">{tr("You're all caught up!")}</p>
        <span className="inbox-empty-sub">{tr("We'll notify you about orders, offers and deliveries.")}</span>
      </div>
    );
  }

  return (
    <div className="inbox-list">
      {unread > 0 && (
        <div className="inbox-topbar">
          <span>{unread} {unread === 1 ? tr("unread") : tr("unread")}</span>
          <button type="button" className="inbox-markall" onClick={markAll}>{tr("Mark all read")}</button>
        </div>
      )}
      {list.shown.map((n) => (
        <NotifRow key={n.id} n={n} onOpenOrder={onOpenOrder} onRead={markRead} onDelete={del} />
      ))}
      {list.more && (
        <button type="button" className="show-more-btn" onClick={list.toggle}>
          {list.label}
        </button>
      )}
    </div>
  );
}

// Value milestones — each is simply points/10 rupees, so the numbers we show
// are exactly what the customer can redeem (no invented perks like "free
// delivery" that the linear points system can't actually honour).
const REWARD_TIERS = [250, 500, 1000, 2500];

// One row in the points history. Classifies a ledger movement by its sign and
// reason so we can show the right icon and a clean label.
function ledgerFace(row) {
  const reason = String(row.reason || "").toLowerCase();
  if (row.delta < 0) return { cls: "redeem", ic: PIC.tag, label: tr("Redeemed at checkout") };
  if (reason.includes("scratch")) return { cls: "bonus", ic: PIC.gift, label: tr("Scratch card reward") };
  return { cls: "earn", ic: PIC.star, label: tr("Earned on your order") };
}

function ledgerDate(iso) {
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return ""; }
}

function Rewards({ user, onShop }) {
  const settings = useSettings();
  const cfg = settings.rewards || {};
  const redeemPer = cfg.redeemPer || 10;
  const maxRedeemPct = cfg.maxRedeemPct || 20;
  const points = user?.points || 0;
  const worth = redeemableRupees(points, cfg);

  // Count the hero number up from 0 so it feels earned, not just printed.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (points <= 0) { setShown(0); return; }
    const dur = 700, t0 = performance.now();
    let raf = 0;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      setShown(Math.round(points * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [points]);

  // Progress toward the next value milestone (falls back to the top tier once
  // every milestone is cleared, so the bar always reads full at the top).
  const nextTier = REWARD_TIERS.find((t) => t > points) || REWARD_TIERS[REWARD_TIERS.length - 1];
  const prevTier = [...REWARD_TIERS].reverse().find((t) => t <= points) || 0;
  const span = Math.max(1, nextTier - prevTier);
  const pct = Math.max(0, Math.min(100, Math.round(((points - prevTier) / span) * 100)));
  const toNext = Math.max(0, nextTier - points);
  const allCleared = points >= REWARD_TIERS[REWARD_TIERS.length - 1];

  // Real ledger history (RLS-scoped to this user).
  const [history, setHistory] = useState(null);
  useEffect(() => {
    let live = true;
    api.fetchPointsHistory(40).then((h) => { if (live) setHistory(h); }).catch(() => { if (live) setHistory([]); });
    return () => { live = false; };
  }, [user?.id, points]);

  // Accurate earn examples straight from the live config — never a rounded
  // promise. ₹399 → 50 pts, so ₹300 → 37, not "30".
  const examples = [300, 500, 1000].map((amt) => ({ amt, pts: pointsForSpend(amt, cfg) }));

  return (
    <div className="rewards-panel">
      <div className="rewards-hero">
        <div className="rewards-hero-watermark"><MIcon d={PIC.star} size={150} /></div>
        <div className="rewards-hero-top">
          <span className="rewards-hero-chip"><MIcon d={PIC.star} size={13} /> {tr("Reward points")}</span>
        </div>
        <div className="rewards-hero-val">{shown}</div>
        <div className="rewards-hero-worth">{tr("worth")} ₹{worth} {tr("off your next order")}</div>

        <div className="rewards-progress">
          <div className="rewards-progress-track">
            <div className="rewards-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="rewards-progress-cap">
            {allCleared
              ? tr("You've unlocked every reward tier")
              : <><strong>{toNext}</strong> {tr("more points to reach")} ₹{redeemableRupees(nextTier, cfg)} {tr("off")}</>}
          </div>
        </div>
      </div>

      <div className="rewards-tiers">
        {REWARD_TIERS.map((t) => {
          const reached = points >= t;
          const isNext = !reached && t === nextTier;
          return (
            <div key={t} className={`rewards-tier ${reached ? "done" : ""} ${isNext ? "next" : ""}`}>
              <div className="rewards-tier-ic"><MIcon d={reached ? PIC.check : PIC.star} size={15} /></div>
              <div className="rewards-tier-pts">{t} {tr("pts")}</div>
              <div className="rewards-tier-worth">₹{redeemableRupees(t, cfg)} {tr("off")}</div>
            </div>
          );
        })}
      </div>

      <button className="rewards-cta" onClick={onShop}>
        <MIcon d={PIC.bolt} size={16} /> {tr("Shop & earn more points")}
      </button>

      <div className="rewards-earn">
        <h4>{tr("How you earn")}</h4>
        <div className="rewards-earn-rows">
          {examples.map((e) => (
            <div key={e.amt} className="rewards-earn-row">
              <span>{tr("Spend")} ₹{e.amt}</span>
              <span className="rewards-earn-arrow">→</span>
              <strong>+{e.pts} {tr("pts")}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="rewards-how">
        <h4>{tr("How it works")}</h4>
        <ul>
          <li>{tr("Earn reward points on eligible items in every order you place.")}</li>
          <li><strong>{redeemPer} {tr("points")} = ₹1</strong> {tr("off — redeem at checkout.")}</li>
          <li>{tr("Pay up to")} <strong>{maxRedeemPct}%</strong> {tr("of an order with points.")}</li>
          <li>{tr("Points are added once your order is confirmed.")}</li>
        </ul>
      </div>

      <div className="rewards-history">
        <h4>{tr("Points history")}</h4>
        {history === null ? (
          <div className="rewards-hist-empty">{tr("Loading…")}</div>
        ) : history.length === 0 ? (
          <div className="rewards-hist-empty">
            <MIcon d={PIC.star} size={26} />
            <p>{tr("No points activity yet. Place an order to start earning.")}</p>
          </div>
        ) : (
          <div className="rewards-hist-list">
            {history.map((row) => {
              const face = ledgerFace(row);
              return (
                <div key={row.id} className="rewards-hist-row">
                  <div className={`rewards-hist-ic ${face.cls}`}><MIcon d={face.ic} size={16} /></div>
                  <div className="rewards-hist-mid">
                    <div className="rewards-hist-label">{face.label}</div>
                    <div className="rewards-hist-date">{ledgerDate(row.at)}</div>
                  </div>
                  <div className={`rewards-hist-delta ${row.delta < 0 ? "neg" : "pos"}`}>
                    {row.delta < 0 ? "" : "+"}{row.delta}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const REFER_BASE = "https://ngsstore.in";
const ShareGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5" />
  </svg>
);

function Referral({ user }) {
  const [stats, setStats] = useState(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try { setStats(await api.myReferralStats()); } catch { /* keep prior */ }
  }
  useEffect(() => { load(); }, [user?.id]);

  const amount = stats?.amount ?? 25;
  const link = stats?.code ? `${REFER_BASE}/?ref=${stats.code}` : "";
  const shareText = link &&
    `Get groceries from Nisha General Store, delivered fast. Join with my link — we both get ₹${amount} after your first delivery: ${link}`;

  const flash = () => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
  async function share() {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: "NGS — Nisha General Store", text: shareText, url: link });
      else { await navigator.clipboard.writeText(link); flash(); }
    } catch { /* user dismissed */ }
  }
  async function copyLink() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); flash(); } catch { /* no clipboard */ }
  }

  return (
    <div className="refer-panel">
      <div className="refer-hero">
        <div className="refer-hero-ic"><MIcon d={PIC.gift} size={26} /></div>
        <h3>{tr("Refer a friend — you both get")} ₹{amount}</h3>
        <p>{tr("Share your invite link. Your friend gets")} ₹{amount} {tr("instantly, and you get")} ₹{amount} {tr("after their first delivery — no code needed.")}</p>
      </div>

      <div className="refer-link-box">
        <span className="refer-code-label">{tr("Your invite link")}</span>
        <button className="refer-link" onClick={copyLink} title={tr("Tap to copy")}>{link || "…"}</button>
        <div className="refer-link-actions">
          <button className="primary-btn refer-share" onClick={share}><ShareGlyph /> {tr("Share link")}</button>
          <button className="ghost-btn refer-copy" onClick={copyLink}>{copied ? tr("Copied") : tr("Copy link")}</button>
        </div>
      </div>

      {stats && (
        <div className="refer-stats">
          <div><strong>{stats.joined}</strong><span>{tr("friends joined")}</span></div>
          <div><strong>₹{Math.round(stats.earned || 0)}</strong><span>{tr("earned so far")}</span></div>
        </div>
      )}

      <div className="refer-steps">
        <div className="refer-step"><span className="refer-step-n">1</span>{tr("Share your link with friends")}</div>
        <div className="refer-step"><span className="refer-step-n">2</span>{tr("They sign up and get")} ₹{amount} {tr("instantly")}</div>
        <div className="refer-step"><span className="refer-step-n">3</span>{tr("You get")} ₹{amount} {tr("after their first delivery")}</div>
      </div>
    </div>
  );
}

function Membership() {
  const { user, joinMembership, applyRewards } = useAuth();
  const settings = useSettings();
  const { balance } = useWallet(user?.id);
  const { orders: myOrders } = useMyOrders(user?.id);
  const now = new Date();
  const savedThisMonth = (myOrders || [])
    .filter((o) => {
      const d = new Date(o.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, o) => s + (o.memberSavings || 0), 0);
  const plan = settings.rewards?.membership || {};
  const price = plan.price ?? MEMBERSHIP.price;
  const mrp = plan.mrp ?? 199;
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
        <div className="prime-active-tag">
          <MIcon d={PIC.crown} size={14} /> Prime is active
        </div>
        <PrimeCard name={user.name} until={user.memberUntil} active />

        <div className="prime-status">
          <div className="prime-status-stats">
            <div className="prime-stat">
              <span className="prime-stat-ico"><MIcon d={PIC.tag} size={16} /></span>
              <span className="prime-stat-val">₹{Math.round(savedThisMonth)}</span>
              <span className="prime-stat-lbl">saved this month</span>
            </div>
            <div className="prime-stat">
              <span className="prime-stat-ico"><MIcon d={PIC.crown} size={16} /></span>
              <span className="prime-stat-val">{daysLeft}</span>
              <span className="prime-stat-lbl">day{daysLeft === 1 ? "" : "s"} left</span>
            </div>
          </div>
          <div className="prime-meter"><span style={{ width: `${pct}%` }} /></div>
          <div className="prime-status-note">Renew here anytime — your benefits never pause.</div>
        </div>

        <PrimeBenefits benefits={MEMBERSHIP.benefits} />
      </div>
    );
  }

  return (
    <div className="membership-panel">
      <PrimeCard name={user?.name} until={null} />

      <div className="prime-offer">
        <div className="prime-offer-l">
          <div className="prime-offer-lbl">{tr("Limited-time price")}</div>
          <div className="prime-price">
            <s>₹{mrp}</s>
            <span className="pp-amt">₹{price}</span>
            <span className="pp-per">/ {days} days</span>
          </div>
        </div>
        {mrp > price && <span className="prime-save">SAVE ₹{mrp - price}</span>}
      </div>

      <PrimeBenefits benefits={MEMBERSHIP.benefits} />

      {err && <div className="auth-error">{err}</div>}

      <button className="prime-cta" onClick={() => setPayQr(true)} disabled={busy}>
        <MIcon d={PIC.bolt} size={17} /> {tr("Get NGS Prime")} · ₹{price}
      </button>
      <button
        className="prime-cta ghost"
        onClick={enoughWallet ? joinWithWallet : undefined}
        disabled={busy || !enoughWallet}
      >
        {busy ? tr("Joining…") : enoughWallet ? `${tr("Pay from Wallet")} · ₹${price}` : `${tr("Wallet")} ₹${balance || 0} — ${tr("not enough")}`}
      </button>
      <p className="prime-fine">Pay by any UPI app or your NGS Wallet · activates instantly.</p>
    </div>
  );
}

// A premium metal-card face — the membership rendered like a real credit card.
function cardThru(until) {
  if (!until) return "••/••";
  const d = new Date(until);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
}
function PrimeCard({ name, until, active }) {
  return (
    <div className={`prime-card ${active ? "on" : ""}`}>
      <div className="pc-brush" />
      <div className="pc-shine" />
      <div className="pc-row pc-head">
        <span className="pc-brand">NGS<b>PRIME</b></span>
        <span className="pc-wave"><MIcon d={PIC.wave} size={22} /></span>
      </div>
      <div className="pc-chip"><i /><i /><i /></div>
      <div className="pc-row pc-foot">
        <div className="pc-holder">
          <span className="pc-lbl">{tr("Member")}</span>
          <span className="pc-name">{(name || tr("Your Name")).toUpperCase()}</span>
        </div>
        <div className="pc-thru">
          <span className="pc-lbl">{tr("Valid thru")}</span>
          <span className="pc-val">{cardThru(until)}</span>
        </div>
      </div>
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
  wave: <><path d="M8.5 8.5a5 5 0 0 1 0 7" /><path d="M11.5 6a9 9 0 0 1 0 12" /><path d="M5.5 11a2 2 0 0 1 0 2" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  box: <><path d="M21 8 12 3 3 8l9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" /></>,
  reorder: <><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v4h-4" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-5" /></>,
  xc: <><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>,
  alert: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17.5v.5" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  gift: <><path d="M20 12v8H4v-8M2 8h20v4H2zM12 8v12M12 8S11 3 8 3a2 2 0 0 0 0 4h4zM12 8s1-5 4-5a2 2 0 0 1 0 4h-4z" /></>,
  star: <path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18.3 6.2 21l1.1-6.5L2.6 9.8l6.5-.9L12 3z" />,
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
  const [upiIntent, setUpiIntent] = useState("");
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState("");
  const [paying, setPaying] = useState(false);
  const rzpOrderRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setQr("loading");
    loadRazorpay().catch(() => {}); // warm the SDK so the pay button is instant
    (async () => {
      try {
        const o = await api.createMembershipOrder();
        if (!alive) return;
        setOrder(o);
        api.createRazorpayOrder(o.dbId).then((rp) => { if (alive) rzpOrderRef.current = rp; }).catch(() => {});
        const { imageUrl, imageDataUrl } = await api.createOrderQr(o.dbId);
        const clean = await cleanUpiQrFromImage(imageDataUrl).catch(() => null);
        const intent = await decodeUpiFromQr(imageDataUrl).catch(() => "");
        if (alive) { setUpiIntent(intent); setQr({ url: clean || imageDataUrl || imageUrl }); }
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
    if (!order || paying) return;
    setErr(""); setPaying(true);
    try {
      const rp = rzpOrderRef.current || (await api.createRazorpayOrder(order.dbId));
      rzpOrderRef.current = rp;
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: rp.keyId, order_id: rp.orderId, amount: rp.amount, currency: rp.currency || "INR",
        name: "NGS Nisha General Store", description: "NGS Prime membership",
        prefill: { name: user?.name || "", email: user?.email || "", contact: user?.phone || "" },
        theme: { color: "#0a9155" },
        modal: { ondismiss: () => setPaying(false) },
        handler: async (resp) => {
          setPaying(false);
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
      rzp.on("payment.failed", (r) => { setPaying(false); setErr(r?.error?.description || tr("Payment failed. Please try again.")); });
      rzp.open();
    } catch (e) {
      setErr(e.message || "Couldn't open the payment. Please try again.");
      setPaying(false);
    }
  }

  return (
    <div className="mem-qr">
      <UpiPayScreen
        amount={price}
        loading={qr === null || qr === "loading"}
        qrSrc={qr && qr.url ? qr.url : null}
        upiIntent={upiIntent}
        onRazorpay={payOnThisPhone}
        error={qr === "error" ? err : ""}
        note="Your NGS Prime membership activates automatically the moment you pay."
      />
      <button className="ghost-btn full" onClick={onCancel}>{tr("Cancel")}</button>
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
      if (res && res.ok === false) setError(res.error || tr("Couldn't save. Please try again."));
      else setSaved(true);
    } catch (err) {
      setError(err?.message || tr("Couldn't save. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="profile-form" onSubmit={save}>
      <label className="field">
        <span>{tr("Full name")}</span>
        <input
          type="text"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>

      <label className="field">
        <span>{tr("Phone number")}</span>
        <input type="tel" value={user?.phone || ""} disabled />
      </label>

      <label className="field">
        <span>{tr("Email")}</span>
        <input
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="you@example.com"
        />
      </label>

      <label className="field">
        <span>{tr("Delivery address")}</span>
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
      {saved && <div className="profile-saved"><MIcon d={PIC.check} size={15} /> {tr("Saved")}</div>}
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
