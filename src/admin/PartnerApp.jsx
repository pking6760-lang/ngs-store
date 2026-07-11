import { useState } from "react";
import { AuthProvider, useAuth } from "../context/AuthContext.jsx";
import AuthModal from "../components/AuthModal.jsx";
import EmployeeApp from "./EmployeeApp.jsx";

// The NGS Partner app — a standalone app for employees (pickers & delivery
// partners). They log in with their email (one-time code), same as customers,
// and the store owner marks their account as "staff". Only staff/admin accounts
// can use it; everything money-related stays out of their hands.
function PartnerInner() {
  const { user, isLoggedIn, ready, logout } = useAuth();
  const [role, setRole] = useState(() => {
    try { return localStorage.getItem("ngs-partner-role") || "delivery"; } catch { return "delivery"; }
  });

  function chooseRole(r) {
    setRole(r);
    try { localStorage.setItem("ngs-partner-role", r); } catch { /* ignore */ }
  }

  if (!ready) {
    return (
      <div className="partner-splash">
        <span className="admin-logo">NGS</span>
        <span className="admin-logo-sub">partner</span>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="partner-login-bg">
        <div className="partner-login-brand">
          <span className="admin-logo">NGS</span>
          <span className="admin-logo-sub">partner</span>
          <p>Picking &amp; delivery</p>
        </div>
        <AuthModal
          open
          onClose={() => {}}
          onSuccess={() => {}}
          reason="Log in to the NGS Partner app with your email."
        />
      </div>
    );
  }

  const staff = user?.role === "staff" || user?.role === "admin";
  if (!staff) {
    return (
      <div className="partner-notstaff">
        <div className="empty-emoji">🚫</div>
        <h2>Not a partner yet</h2>
        <p>
          Your account <strong>{user?.email}</strong> isn't set up as an NGS
          partner. Ask the store owner to add you, then log in again.
        </p>
        <button className="emp-logout" onClick={logout}>Log out</button>
      </div>
    );
  }

  return (
    <>
      <div className="partner-rolebar">
        <button className={role === "picker" ? "sel" : ""} onClick={() => chooseRole("picker")}>
          🧺 Picking
        </button>
        <button className={role === "delivery" ? "sel" : ""} onClick={() => chooseRole("delivery")}>
          🛵 Delivery
        </button>
      </div>
      <EmployeeApp role={role} name={user?.name || "Partner"} onLogout={logout} />
    </>
  );
}

export default function PartnerApp() {
  return (
    <AuthProvider>
      <PartnerInner />
    </AuthProvider>
  );
}
