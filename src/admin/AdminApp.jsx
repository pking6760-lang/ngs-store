import { useEffect, useState } from "react";
import { useBackGuard, initHardwareBack } from "../lib/useBackGuard.js";
import { toast } from "../lib/toast.js";
import Dashboard from "./Dashboard.jsx";
import ProductsAdmin from "./ProductsAdmin.jsx";
import SmartPricing from "./SmartPricing.jsx";
import OrdersAdmin from "./OrdersAdmin.jsx";
import CollectQR from "./CollectQR.jsx";
import CouponsAdmin from "./CouponsAdmin.jsx";
import CustomersAdmin from "./CustomersAdmin.jsx";
import NotifyAdmin from "./NotifyAdmin.jsx";
import AutoNotify from "./AutoNotify.jsx";
import ThemesAdmin from "./ThemesAdmin.jsx";
import AppHealth from "./AppHealth.jsx";
import FeedbackAdmin from "./FeedbackAdmin.jsx";
import DeliveryAdmin from "./DeliveryAdmin.jsx";
import PartnersAdmin from "./PartnersAdmin.jsx";
import AppUpdatesAdmin from "./AppUpdatesAdmin.jsx";
import ReferralWatchAdmin from "./ReferralWatchAdmin.jsx";
import MoneyAdmin from "./MoneyAdmin.jsx";
import OpsSettings from "./OpsSettings.jsx";
import { AdminMark } from "./BrandMark.jsx";
import { Ic } from "./AdminIcons.jsx";
import PullRefresh from "../components/PullRefresh.jsx";
import { useReveal, PageLoad } from "../components/Motion.jsx";
import { useSettings, useOrders, usePartners } from "../lib/hooks.js";
import { updateSettings } from "../lib/actions.js";
import * as api from "../lib/api.js";
import { unlockAudio } from "../lib/sound.js";
import { initAdminPush } from "../lib/push.js";
import {
  isBiometricAvailable, authenticateBiometric,
  storeCredentials, hasStoredCredentials, getStoredCredentials,
} from "../lib/biometric.js";

const BACKEND = api.isBackendConfigured;
// Pull-to-refresh: every live hook (orders, partners, products, settings…)
// reloads on window "focus", so one dispatched focus event re-fetches the whole
// screen. The short settle keeps the spinner honest on a fast connection.
async function refreshAdmin() {
  try { window.dispatchEvent(new Event("focus")); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 500));
}
// Demo-only logins (used when no backend is configured). With a backend, the
// admin signs in with the real email + password of their admin account.
const ADMIN_PASSWORD = "admin123";
const ROLE_KEY = "ngs-admin-role"; // "admin"
const NAME_KEY = "ngs-admin-name";

const TILES = [
  { id: "dashboard", label: "Overview", icon: "dashboard", tint: "#4C6EF5" },
  { id: "orders", label: "Orders", icon: "orders", tint: "#1C7ED6" },
  { id: "collect", label: "Collect payment", icon: "qr", tint: "#0B6B3A" },
  { id: "products", label: "Products", icon: "products", tint: "#F08C00" },
  { id: "pricing", label: "Smart Pricing", icon: "pricing", tint: "#12B886" },
  { id: "customers", label: "Customers", icon: "customers", tint: "#7048E8" },
  { id: "feedback", label: "Feedback", icon: "feedback", tint: "#F59F00" },
  { id: "partners", label: "Partners", icon: "partners", tint: "#0CA678" },
  { id: "delivery", label: "Delivery", icon: "delivery", tint: "#0C8599" },
  { id: "offers", label: "Offers", icon: "offers", tint: "#E64980" },
  { id: "notify", label: "Notify", icon: "notify", tint: "#F76707" },
  { id: "auto", label: "Auto notify", icon: "broadcast", tint: "#B197FC" },
  { id: "themes", label: "Festival themes", icon: "offers", tint: "#E8590C" },
  { id: "health", label: "App health", icon: "dashboard", tint: "#0CA678" },
  { id: "updates", label: "App updates", icon: "broadcast", tint: "#4263EB" },
  { id: "money", label: "Money", icon: "pricing", tint: "#0CA678" },
  { id: "referrals", label: "Referral watch", icon: "customers", tint: "#E8590C" },
  { id: "settings", label: "Settings", icon: "settings", tint: "#5C6570" },
];

export default function AdminApp() {
  const [role, setRole] = useState(() => sessionStorage.getItem(ROLE_KEY) || null);
  const [name, setName] = useState(() => sessionStorage.getItem(NAME_KEY) || "");
  const [view, setView] = useState("menu");
  // Optional target when opening a section — e.g. a customer id to jump into.
  const [navArg, setNavArg] = useState(null);
  const openSection = (v, arg = null) => { setNavArg(arg); setView(v); };

  // Hardware Back: close the open section/modal, exit only at the home menu.
  useEffect(() => { initHardwareBack(() => toast("Press back again to exit")); }, []);
  useBackGuard(view !== "menu", () => setView("menu"));

  // In backend mode, restore an existing admin session on load so a signed-in
  // admin isn't asked to log in again.
  useEffect(() => {
    if (!BACKEND || role) return;
    let alive = true;
    (async () => {
      const session = await api.getSession();
      if (!session || !alive) return;
      const profile = await api.getMyProfile();
      if (alive && profile?.role === "admin") signIn("admin", profile.name || "Store Manager");
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Register for order push notifications once an admin is signed in.
  useEffect(() => {
    if (role === "admin") initAdminPush();
  }, [role]);

  // Finish off deletes: when a product is deleted or its photo replaced, the
  // database notes that the old file should go, and this removes it for real.
  // It runs here because storage files can only be deleted by something holding
  // a session — and the admin app already has one. Silent either way; there is
  // nothing for anyone to do about it.
  useEffect(() => {
    if (role !== "admin" || !BACKEND) return;
    const t = setTimeout(() => { api.sweepDeletedFiles().catch(() => {}); }, 4000);
    return () => clearTimeout(t);
  }, [role]);

  function signIn(nextRole, displayName) {
    sessionStorage.setItem(ROLE_KEY, nextRole);
    sessionStorage.setItem(NAME_KEY, displayName);
    setRole(nextRole);
    setName(displayName);
  }

  async function logout() {
    if (BACKEND) await api.signOut();
    sessionStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem(NAME_KEY);
    setRole(null);
  }

  if (!role) return <Login onSignIn={signIn} />;

  // One clean screen: a home menu of tiles → each opens a section with a back
  // button. No sidebar, no bottom bar. (Employees use the NGS Partner app.)
  return (
    <div className="adm">
      {view === "menu" ? (
        <AdminHome name={name} onOpen={openSection} onLogout={logout} />
      ) : (
        <AdminSection view={view} navArg={navArg} onOpen={openSection} />
      )}
    </div>
  );
}

function AdminHome({ name, onOpen, onLogout }) {
  const orders = useOrders();
  const partners = usePartners();
  // Pending = orders that still need action now. A future "Scheduled"
  // subscription order isn't actionable until its delivery day, and the prepaid
  // plan "master" isn't a fulfilment order at all — exclude both (kept in sync
  // with the Overview dashboard so the two screens never disagree).
  // 'Awaiting payment'/'Payment failed' are online orders the customer never
  // paid for (they bounced off the UPI screen) — not real work, so they must
  // never inflate the pending badge.
  const activeOrders = orders.filter(
    (o) => o.status !== "Delivered" && o.status !== "Cancelled" && o.status !== "Returned"
      && o.status !== "Scheduled" && o.status !== "Awaiting payment"
      && o.status !== "Payment failed" && !o.isSubscription
  ).length;
  const pendingPartners = partners.filter((p) => p.status === "pending").length;
  const badge = { orders: activeOrders, partners: pendingPartners };

  // Today's figures for the glanceable hero strip (reset automatically each day).
  // A prepaid plan is booked in full the day it's bought (the "master" order);
  // the daily orders it later spawns are just fulfilment of that money, so they
  // never count as revenue again. Kept in sync with the Overview dashboard.
  const isToday = (iso) => {
    const d = new Date(iso), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  };
  const isSubDaily = (o) => o.subscriptionId && !o.isSubscription;
  const todays = orders.filter((o) => isToday(o.createdAt) && o.status !== "Cancelled"
    && o.status !== "Awaiting payment" && o.status !== "Payment failed"
    && !o.isReturn && !isSubDaily(o));
  const todaysRevenue = todays.reduce((s, o) => s + (o.total || 0), 0);

  return (
    <PullRefresh className="adm-home" onRefresh={refreshAdmin}>
      <header className="adm-hero">
        <div className="adm-hero-top">
          <div className="adm-brand">
            <AdminMark size={30} />
            <span className="adm-logo">NGS</span>
            <span className="adm-sub">admin</span>
          </div>
          <button className="adm-logout" onClick={onLogout}>Log out</button>
        </div>
        <div className="adm-hello">Hi, {name || "Store Manager"}</div>
        <div className="adm-hero-stats">
          <button className="adm-hstat" onClick={() => onOpen("orders")}>
            <div className="adm-hstat-val">{todays.length}</div>
            <div className="adm-hstat-lbl">Orders today</div>
          </button>
          <button className="adm-hstat" onClick={() => onOpen("dashboard")}>
            <div className="adm-hstat-val">₹{todaysRevenue}</div>
            <div className="adm-hstat-lbl">Revenue today</div>
          </button>
          <button className="adm-hstat" onClick={() => onOpen("orders")}>
            <div className="adm-hstat-val">{activeOrders}</div>
            <div className="adm-hstat-lbl">Pending</div>
          </button>
        </div>
        <StoreControls />
      </header>

      <div className="adm-grid">
        {TILES.map((t) => (
          <button key={t.id} className="adm-tile" onClick={() => onOpen(t.id)}>
            <span className="adm-tile-ic" style={{ background: `${t.tint}1A`, color: t.tint }}><Ic name={t.icon} size={24} /></span>
            <span className="adm-tile-lbl">{t.label}</span>
            {badge[t.id] > 0 && <span className="adm-tile-badge">{badge[t.id]}</span>}
          </button>
        ))}
      </div>
    </PullRefresh>
  );
}

function AdminSection({ view, navArg, onOpen }) {
  const label = TILES.find((t) => t.id === view)?.label || "";
  const loading = useReveal(view, 320, 680);
  return (
    <div className="adm-sec">
      <header className="adm-secbar">
        <button className="adm-back" onClick={() => onOpen("menu")} aria-label="Back">←</button>
        <h1>{label}</h1>
      </header>
      <PullRefresh className="adm-sec-body" onRefresh={refreshAdmin}>
        {loading ? (
          <PageLoad variant="admin" text={label} />
        ) : (
          <div className="fade-up">
            {view === "dashboard" && <Dashboard onNavigate={onOpen} />}
            {view === "products" && <ProductsAdmin />}
            {view === "pricing" && <SmartPricing />}
            {view === "orders" && <OrdersAdmin onOpen={onOpen} />}
            {view === "collect" && <CollectQR />}
            {view === "customers" && <CustomersAdmin initialCustomerId={navArg} />}
            {view === "feedback" && <FeedbackAdmin />}
            {view === "partners" && <PartnersAdmin />}
            {view === "delivery" && <DeliveryAdmin />}
            {view === "offers" && <CouponsAdmin />}
            {view === "notify" && <NotifyAdmin />}
            {view === "auto" && <AutoNotify />}
            {view === "themes" && <ThemesAdmin />}
            {view === "health" && <AppHealth />}
            {view === "updates" && <AppUpdatesAdmin />}
            {view === "money" && <MoneyAdmin />}
            {view === "referrals" && <ReferralWatchAdmin />}
            {view === "settings" && <OpsSettings />}
          </div>
        )}
      </PullRefresh>
    </div>
  );
}

// Sensible defaults if a store has no automation config saved yet.
const DEFAULT_AUTOMATION = {
  hours: { on: true, open: 8, close: 23 }, rain: { on: true }, peak: { on: true, min: 4, mult: 3 },
};
const hourText = (h) => {
  const n = Number(h); if (Number.isNaN(n)) return "--";
  const ap = n < 12 ? "am" : "pm"; let hh = n % 12; if (hh === 0) hh = 12;
  return `${hh}${ap}`;
};

// Store open/close + delivery-mode (normal / surge) toggles, plus the auto-pilot
// panel that opens/closes the store on a schedule and surges on rain / peak.
export function StoreControls() {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  // Optimistic override so the button flips the instant it's tapped, before the
  // save round-trips. Cleared once the saved settings come back.
  const [pending, setPending] = useState(null);
  const [showAuto, setShowAuto] = useState(false);

  const storeOpen = pending?.storeOpen ?? settings.storeOpen;
  // Rain and peak are separate surcharges funding separate people: rain pays the
  // rider, peak pays the picker. The customer pays one flat charge either way.
  const mode = pending?.deliveryMode ?? settings.deliveryMode ?? "normal";
  const rainNow = mode === "rain" || mode === "both" || mode === "surge";
  const peakNow = mode === "peak" || mode === "both";
  const modeFrom = (r, p) => (r && p ? "both" : r ? "rain" : p ? "peak" : "normal");
  const auto = pending?.automation ?? settings.automation ?? DEFAULT_AUTOMATION;
  const hoursOn = !!auto?.hours?.on, rainOn = !!auto?.rain?.on, peakOn = !!auto?.peak?.on;
  const autoCount = (hoursOn ? 1 : 0) + (rainOn ? 1 : 0) + (peakOn ? 1 : 0);

  async function save(patch) {
    if (busy) return;
    setBusy(true);
    setPending((p) => ({ ...p, ...patch }));
    try {
      await updateSettings(patch);
    } catch (e) {
      setPending(null); // revert the optimistic flip
      alert(e.message || "Couldn't save. Check your connection / admin login.");
    } finally {
      setBusy(false);
      // Let the fetched value take over on the next render tick.
      setTimeout(() => setPending(null), 400);
    }
  }
  const setAuto = (next) => save({ automation: next });
  const patchHours = (p) => setAuto({ ...auto, hours: { ...(auto.hours || {}), ...p } });

  return (
    <div className="store-controls-wrap">
      <div className="store-controls">
        <button
          className={`store-toggle ${storeOpen ? "open" : "closed"}`}
          disabled={busy}
          onClick={() => save({ storeOpen: !storeOpen })}
        >
          <span className="store-dot" />
          {storeOpen ? "Store OPEN" : "Store CLOSED"}
          {hoursOn && <span className="ap-badge">AUTO</span>}
        </button>
        <button
          className={`surge-toggle ${rainNow ? "on" : ""}`}
          disabled={busy}
          onClick={() => save({ deliveryMode: modeFrom(!rainNow, peakNow) })}
          title="Raining — the surcharge pays the rider's bonus"
        >
          <Ic name={rainNow ? "rain" : "sun"} size={17} />
          {rainNow ? "Rain ON" : "Rain"}
          {rainOn && <span className="ap-badge">AUTO</span>}
        </button>
        <button
          className={`surge-toggle ${peakNow ? "on" : ""}`}
          disabled={busy}
          onClick={() => save({ deliveryMode: modeFrom(rainNow, !peakNow) })}
          title="Busy hour — the surcharge pays the picker's bonus"
        >
          <Ic name="trending" size={17} />
          {peakNow ? "Peak ON" : "Peak"}
          {peakOn && <span className="ap-badge">AUTO</span>}
        </button>
      </div>

      <button className="ap-open" onClick={() => setShowAuto((v) => !v)}>
        <span>⚙ Auto-pilot · {autoCount} on</span>
        <span className="ap-caret">{showAuto ? "▲" : "▼"}</span>
      </button>

      {showAuto && (
        <div className="ap-panel">
          <div className="ap-row">
            <div className="ap-row-main">
              <strong>Auto open &amp; close</strong>
              <span className="ap-sub">
                {hoursOn ? `Open ${hourText(auto.hours?.open)} – ${hourText(auto.hours?.close)} daily` : "Off — you open/close by hand"}
              </span>
            </div>
            <button
              className={`ap-switch ${hoursOn ? "on" : ""}`}
              disabled={busy}
              onClick={() => patchHours({ on: !hoursOn })}
              aria-label="Toggle auto hours"
            ><span /></button>
          </div>
          {hoursOn && (
            <div className="ap-hours">
              <label>Open
                <select value={auto.hours?.open ?? 8} disabled={busy}
                  onChange={(e) => patchHours({ open: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourText(h)}</option>)}
                </select>
              </label>
              <label>Close
                <select value={auto.hours?.close ?? 23} disabled={busy}
                  onChange={(e) => patchHours({ close: Number(e.target.value) })}>
                  {Array.from({ length: 25 }, (_, h) => <option key={h} value={h}>{h === 24 ? "12am" : hourText(h)}</option>)}
                </select>
              </label>
            </div>
          )}

          <div className="ap-row">
            <div className="ap-row-main">
              <strong>Surge when raining</strong>
              <span className="ap-sub">Higher delivery fee while it's raining at the shop</span>
            </div>
            <button
              className={`ap-switch ${rainOn ? "on" : ""}`}
              disabled={busy}
              onClick={() => setAuto({ ...auto, rain: { ...(auto.rain || {}), on: !rainOn } })}
              aria-label="Toggle rain surge"
            ><span /></button>
          </div>

          <div className="ap-row">
            <div className="ap-row-main">
              <strong>Surge when busy</strong>
              <span className="ap-sub">Auto-surge when orders spike, back to normal when it calms</span>
            </div>
            <button
              className={`ap-switch ${peakOn ? "on" : ""}`}
              disabled={busy}
              onClick={() => setAuto({ ...auto, peak: { ...(auto.peak || {}), on: !peakOn } })}
              aria-label="Toggle peak surge"
            ><span /></button>
          </div>

          <p className="ap-note">
            When you flip Store or Surge by hand, auto-pilot pauses that switch for 2 hours,
            then takes over again.
          </p>
        </div>
      )}
    </div>
  );
}

function Login({ onSignIn }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bioBusy, setBioBusy] = useState(false);
  // Biometrics available on this phone, and whether we have saved admin
  // credentials to unlock with them.
  const [bioOk, setBioOk] = useState(false);
  const [bioSaved, setBioSaved] = useState(false);

  useEffect(() => {
    let active = true;
    isBiometricAvailable().then((ok) => active && setBioOk(ok));
    hasStoredCredentials().then((ok) => active && setBioSaved(ok));
    return () => {
      active = false;
    };
  }, []);

  async function fingerprintLogin() {
    unlockAudio();
    setError("");
    setBioBusy(true);
    try {
      const ok = await authenticateBiometric();
      if (!ok) {
        setError("Fingerprint not recognised. Try again or use your password.");
        return;
      }
      if (!BACKEND) { onSignIn("admin", "Store Manager"); return; }
      // Backend: retrieve the saved credentials and open a real session.
      const creds = await getStoredCredentials();
      if (!creds?.username) {
        setError("Sign in with your password once to enable fingerprint.");
        return;
      }
      await api.signInWithPassword(creds.username, creds.password);
      const profile = await api.getMyProfile();
      if (profile?.role === "admin") onSignIn("admin", profile.name || "Store Manager");
      else { await api.signOut(); setError("This account is not an admin."); }
    } catch {
      setError("Couldn't sign in with fingerprint. Use your password.");
    } finally {
      setBioBusy(false);
    }
  }

  async function submitAdmin(e) {
    e.preventDefault();
    unlockAudio(); // prime the alarm sound on this click
    if (BACKEND) {
      setBusy(true); setError("");
      try {
        await api.signInWithPassword(email, pw);
        const profile = await api.getMyProfile();
        if (profile?.role === "admin") {
          // Save the credentials behind the fingerprint for next time.
          if (bioOk) storeCredentials(email.trim(), pw).catch(() => {});
          onSignIn("admin", profile.name || "Store Manager");
        } else { await api.signOut(); setError("This account is not an admin."); }
      } catch {
        setError("Wrong email or password.");
      } finally { setBusy(false); }
      return;
    }
    if (pw === ADMIN_PASSWORD) onSignIn("admin", "Store Manager");
    else setError("Incorrect password. Try again.");
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="admin-brand center">
          <AdminMark size={44} />
          <span className="admin-logo">NGS</span>
          <span className="admin-logo-sub">admin</span>
        </div>

        <form onSubmit={submitAdmin}>
          <p className="login-sub">Manage products, orders and the store</p>
          {BACKEND && (
            <input
              className="login-input"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="Admin email"
              autoFocus
            />
          )}
          <input
            className="login-input"
            type="password"
            value={pw}
            onChange={(e) => { setPw(e.target.value); setError(""); }}
            placeholder="Password"
          />
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in as admin"}
          </button>
          {/* Fingerprint shows in the demo, or on the backend once the admin
              has signed in with a password at least once (creds saved). */}
          {bioOk && (!BACKEND || bioSaved) && (
            <>
              <div className="login-or">or</div>
              <button
                type="button"
                className="fingerprint-btn"
                onClick={fingerprintLogin}
                disabled={bioBusy}
              >
                <span className="fingerprint-icon"><Ic name="fingerprint" size={20} /></span>
                {bioBusy ? "Waiting for fingerprint…" : "Login with fingerprint"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
