import { useEffect, useState } from "react";
import Dashboard from "./Dashboard.jsx";
import ProductsAdmin from "./ProductsAdmin.jsx";
import OrdersAdmin from "./OrdersAdmin.jsx";
import EmployeeApp from "./EmployeeApp.jsx";
import IncomingOrder from "./IncomingOrder.jsx";
import { useSettings } from "../lib/hooks.js";
import { updateSettings } from "../lib/store.js";
import { unlockAudio } from "../lib/sound.js";
import { isBiometricAvailable, authenticateBiometric } from "../lib/biometric.js";

// Demo-only logins. A real backend will replace these with proper accounts.
const ADMIN_PASSWORD = "admin123";
const STAFF_PASSCODE = "staff123";
const ROLE_KEY = "ngs-admin-role"; // "admin" | "picker" | "delivery"
const NAME_KEY = "ngs-admin-name";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "products", label: "Products", icon: "📦" },
  { id: "orders", label: "Orders", icon: "🧾" },
];

export default function AdminApp() {
  const [role, setRole] = useState(() => sessionStorage.getItem(ROLE_KEY) || null);
  const [name, setName] = useState(() => sessionStorage.getItem(NAME_KEY) || "");
  const [view, setView] = useState("dashboard");

  function signIn(nextRole, displayName) {
    sessionStorage.setItem(ROLE_KEY, nextRole);
    sessionStorage.setItem(NAME_KEY, displayName);
    setRole(nextRole);
    setName(displayName);
  }

  function logout() {
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
  return (
    <div className="store-controls">
      <button
        className={`store-toggle ${settings.storeOpen ? "open" : "closed"}`}
        onClick={() => updateSettings({ storeOpen: !settings.storeOpen })}
      >
        <span className="store-dot" />
        {settings.storeOpen ? "Store OPEN" : "Store CLOSED"}
      </button>
      <button
        className={`surge-toggle ${settings.deliveryMode === "surge" ? "on" : ""}`}
        onClick={() =>
          updateSettings({
            deliveryMode: settings.deliveryMode === "surge" ? "normal" : "surge",
          })
        }
        title="Turn on during rain / bad weather / peak — members pay delivery too"
      >
        {settings.deliveryMode === "surge" ? "🌧️ Surge ON" : "☀️ Normal day"}
      </button>
    </div>
  );
}

function Login({ onSignIn }) {
  const [tab, setTab] = useState("admin"); // "admin" | "staff"
  const [pw, setPw] = useState("");
  const [staffRole, setStaffRole] = useState("picker");
  const [staffName, setStaffName] = useState("");
  const [staffCode, setStaffCode] = useState("");
  const [error, setError] = useState("");
  const [bioOk, setBioOk] = useState(false);

  // Show the fingerprint button only if the phone actually supports it.
  useEffect(() => {
    let active = true;
    isBiometricAvailable().then((ok) => active && setBioOk(ok));
    return () => {
      active = false;
    };
  }, []);

  async function fingerprintLogin() {
    unlockAudio();
    setError("");
    const ok = await authenticateBiometric();
    if (ok) onSignIn("admin", "Store Manager");
    else setError("Fingerprint not recognised. Use your password.");
  }

  function submitAdmin(e) {
    e.preventDefault();
    unlockAudio(); // prime the alarm sound on this click
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
            <input
              className="login-input"
              type="password"
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setError("");
              }}
              placeholder="Admin password"
              autoFocus
            />
            {error && <div className="login-error">{error}</div>}
            <button className="login-btn" type="submit">
              Sign in as admin
            </button>
            {bioOk && (
              <>
                <div className="login-or">or</div>
                <button
                  type="button"
                  className="fingerprint-btn"
                  onClick={fingerprintLogin}
                >
                  <span className="fingerprint-icon">🔒</span>
                  Login with fingerprint
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
