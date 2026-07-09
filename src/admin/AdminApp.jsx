import { useState } from "react";
import Dashboard from "./Dashboard.jsx";
import ProductsAdmin from "./ProductsAdmin.jsx";
import OrdersAdmin from "./OrdersAdmin.jsx";

// Demo-only login. A real backend will replace this with proper authentication.
const DEMO_PASSWORD = "admin123";
const AUTH_KEY = "ngs-admin-auth";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "products", label: "Products", icon: "📦" },
  { id: "orders", label: "Orders", icon: "🧾" },
];

export default function AdminApp() {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem(AUTH_KEY) === "1"
  );
  const [view, setView] = useState("dashboard");

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

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
              {n.label}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <a className="admin-view-store" href="/" target="_blank" rel="noreferrer">
            ↗ View storefront
          </a>
          <button
            className="admin-logout"
            onClick={() => {
              sessionStorage.removeItem(AUTH_KEY);
              setAuthed(false);
            }}
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <h1 className="admin-title">
            {NAV.find((n) => n.id === view)?.label}
          </h1>
          <div className="admin-user">
            <span className="admin-avatar">🧑‍💼</span>
            <span>Store Manager</span>
          </div>
        </header>

        <div className="admin-content">
          {view === "dashboard" && <Dashboard onNavigate={setView} />}
          {view === "products" && <ProductsAdmin />}
          {view === "orders" && <OrdersAdmin />}
        </div>
      </main>
    </div>
  );
}

function Login({ onSuccess }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");

  function submit(e) {
    e.preventDefault();
    if (pw === DEMO_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, "1");
      onSuccess();
    } else {
      setError("Incorrect password. Try again.");
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="admin-brand center">
          <span className="admin-logo">NGS</span>
          <span className="admin-logo-sub">admin</span>
        </div>
        <h2>Sign in to your dashboard</h2>
        <p className="login-sub">Manage your products and orders</p>
        <input
          className="login-input"
          type="password"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setError("");
          }}
          placeholder="Password"
          autoFocus
        />
        {error && <div className="login-error">{error}</div>}
        <button className="login-btn" type="submit">
          Sign in
        </button>
        <div className="login-hint">Demo password: <code>admin123</code></div>
      </form>
    </div>
  );
}
