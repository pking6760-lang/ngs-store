import { useEffect, useState } from "react";
import Dashboard from "./Dashboard.jsx";
import ProductsAdmin from "./ProductsAdmin.jsx";
import OrdersAdmin from "./OrdersAdmin.jsx";
import CouponsAdmin from "./CouponsAdmin.jsx";
import CustomersAdmin from "./CustomersAdmin.jsx";
import DeliveryAdmin from "./DeliveryAdmin.jsx";
import EmployeeApp from "./EmployeeApp.jsx";
import IncomingOrder from "./IncomingOrder.jsx";
import { useSettings } from "../lib/hooks.js";
import { updateSettings } from "../lib/actions.js";
import * as api from "../lib/api.js";
import { unlockAudio } from "../lib/sound.js";
import { initAdminPush } from "../lib/push.js";
import {
  isBiometricAvailable, authenticateBiometric,
  storeCredentials, hasStoredCredentials, getStoredCredentials,
} from "../lib/biometric.js";

const BACKEND = api.isBackendConfigured;
// Demo-only logins (used when no backend is configured). With a backend, the
// admin signs in with the real email + password of their admin account.
const ADMIN_PASSWORD = "admin123";
const STAFF_PASSCODE = "staff123";
const ROLE_KEY = "ngs-admin-role"; // "admin" | "picker" | "delivery"
const NAME_KEY = "ngs-admin-name";

const NAV = [
  { id: "dashboard", label: "Home", icon: "📊" },
  { id: "orders", label: "Orders", icon: "🧾" },
  { id: "products", label: "Products", icon: "📦" },
  { id: "customers", label: "Customers", icon: "👥" },
  { id: "delivery", label: "Delivery", icon: "🚴" },
  { id: "offers", label: "Offers", icon: "🎟️" },
];

export default function AdminApp() {
  const [role, setRole] = useState(() => sessionStorage.getItem(ROLE_KEY) || null);
  const [name, setName] = useState(() => sessionStorage.getItem(NAME_KEY) || "");
  const [view, setView] = useState("dashboard");

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

  // Staff (picker / delivery worker) get their own focused screen.
  if (role === "picker" || role === "delivery") {
    return <EmployeeApp role={role} name={name} onLogout={logout} />;
  }

  // Admin dashboard.
  return (
    <div className="admin">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-logo">NGS</span>
          <span className="admin-logo-sub">admin</span>
        </div>
        <nav className="admin-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`admin-nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => setView(n.id)}
            >
              <span className="admin-nav-icon">{n.icon}</span>
              <span className="admin-nav-label">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <button className="admin-logout" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <h1 className="admin-title">{NAV.find((n) => n.id === view)?.label}</h1>
          <StoreControls />
          <div className="admin-user">
            <span className="admin-avatar">🧑‍💼</span>
            <span className="admin-user-name">{name || "Store Manager"}</span>
            <button className="admin-logout-icon" onClick={logout} title="Log out">
              ⎋
            </button>
          </div>
        </header>

        <div className="admin-content">
          {view === "dashboard" && <Dashboard onNavigate={setView} />}
          {view === "products" && <ProductsAdmin />}
          {view === "orders" && <OrdersAdmin />}
          {view === "customers" && <CustomersAdmin />}
          {view === "delivery" && <DeliveryAdmin />}
          {view === "offers" && <CouponsAdmin />}
        </div>
      </main>

      <nav className="admin-bottom-nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`bottom-nav-item ${view === n.id ? "active" : ""}`}
            onClick={() => setView(n.id)}
          >
            <span className="bottom-nav-icon">{n.icon}</span>
            <span className="bottom-nav-label">{n.label}</span>
          </button>
        ))}
      </nav>

      {/* Forced new-order screen with alarm (admin only). */}
      <IncomingOrder />
    </div>
  );
}

// Store open/close + delivery-mode (normal / surge) toggles.
export function StoreControls() {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  // Optimistic override so the button flips the instant it's tapped, before the
  // save round-trips. Cleared once the saved settings come back.
  const [pending, setPending] = useState(null);

  const storeOpen = pending?.storeOpen ?? settings.storeOpen;
  const surge = (pending?.deliveryMode ?? settings.deliveryMode) === "surge";

  async function change(patch) {
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

  return (
    <div className="store-controls">
      <button
        className={`store-toggle ${storeOpen ? "open" : "closed"}`}
        disabled={busy}
        onClick={() => change({ storeOpen: !storeOpen })}
      >
        <span className="store-dot" />
        {storeOpen ? "Store OPEN" : "Store CLOSED"}
      </button>
      <button
        className={`surge-toggle ${surge ? "on" : ""}`}
        disabled={busy}
        onClick={() => change({ deliveryMode: surge ? "normal" : "surge" })}
        title="Turn on during rain / bad weather / peak — members pay delivery too"
      >
        {surge ? "🌧️ Surge ON" : "☀️ Normal day"}
      </button>
    </div>
  );
}

function Login({ onSignIn }) {
  const [tab, setTab] = useState("admin"); // "admin" | "staff"
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [staffRole, setStaffRole] = useState("picker");
  const [staffName, setStaffName] = useState("");
  const [staffCode, setStaffCode] = useState("");
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

  function submitStaff(e) {
    e.preventDefault();
    unlockAudio();
    if (staffCode !== STAFF_PASSCODE) {
      setError("Incorrect staff passcode.");
      return;
    }
    const label =
      staffName.trim() || (staffRole === "picker" ? "Picker" : "Delivery");
    onSignIn(staffRole, label);
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="admin-brand center">
          <span className="admin-logo">NGS</span>
          <span className="admin-logo-sub">admin</span>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === "admin" ? "active" : ""}`}
            onClick={() => {
              setTab("admin");
              setError("");
            }}
          >
            Admin
          </button>
          <button
            className={`auth-tab ${tab === "staff" ? "active" : ""}`}
            onClick={() => {
              setTab("staff");
              setError("");
            }}
          >
            Employee
          </button>
        </div>

        {tab === "admin" ? (
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
              onChange={(e) => {
                setPw(e.target.value);
                setError("");
              }}
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
                  <span className="fingerprint-icon">☝️</span>
                  {bioBusy ? "Waiting for fingerprint…" : "Login with fingerprint"}
                </button>
              </>
            )}
          </form>
        ) : (
          <form onSubmit={submitStaff}>
            <p className="login-sub">Pickers & delivery partners</p>
            <div className="role-picker">
              <button
                type="button"
                className={`role-opt ${staffRole === "picker" ? "sel" : ""}`}
                onClick={() => setStaffRole("picker")}
              >
                🧺 Picker
              </button>
              <button
                type="button"
                className={`role-opt ${staffRole === "delivery" ? "sel" : ""}`}
                onClick={() => setStaffRole("delivery")}
              >
                🛵 Delivery
              </button>
            </div>
            <input
              className="login-input"
              type="text"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Your name"
            />
            <input
              className="login-input"
              type="password"
              value={staffCode}
              onChange={(e) => {
                setStaffCode(e.target.value);
                setError("");
              }}
              placeholder="Staff passcode"
            />
            {error && <div className="login-error">{error}</div>}
            <button className="login-btn" type="submit">
              Sign in as {staffRole}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
