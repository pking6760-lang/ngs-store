import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "../context/AuthContext.jsx";
import AuthModal from "../components/AuthModal.jsx";
import EmployeeApp from "./EmployeeApp.jsx";
import PartnerRegister from "./PartnerRegister.jsx";
import * as api from "../lib/api.js";

function Splash({ text }) {
  return (
    <div className="partner-splash">
      <span className="admin-logo">NGS</span>
      <span className="admin-logo-sub">partner</span>
      {text && <p style={{ marginTop: 12, color: "#cfe6d3" }}>{text}</p>}
    </div>
  );
}

function PartnerInner() {
  const { user, isLoggedIn, ready, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const [partner, setPartner] = useState(undefined); // undefined=loading | null=none | obj
  const [adminRole, setAdminRole] = useState(() => {
    try { return localStorage.getItem("ngs-partner-role") || "delivery"; } catch { return "delivery"; }
  });

  useEffect(() => {
    if (!isLoggedIn || isAdmin) { setPartner(null); return; }
    let alive = true;
    api.getMyPartner()
      .then((p) => { if (alive) setPartner(p); })
      .catch(() => { if (alive) setPartner(null); });
    return () => { alive = false; };
  }, [isLoggedIn, isAdmin, user?.id]);

  async function reload() {
    try { setPartner(await api.getMyPartner()); } catch { setPartner(null); }
  }
  function chooseRole(r) {
    setAdminRole(r);
    try { localStorage.setItem("ngs-partner-role", r); } catch { /* ignore */ }
  }

  if (!ready) return <Splash />;

  if (!isLoggedIn) {
    return (
      <div className="partner-login-bg">
        <div className="partner-login-brand">
          <span className="admin-logo">NGS</span>
          <span className="admin-logo-sub">partner</span>
          <p>Picking &amp; delivery</p>
        </div>
        <AuthModal open onClose={() => {}} onSuccess={() => {}}
          reason="Log in to the NGS Partner app with your email." />
      </div>
    );
  }

  // Admin can use the partner app directly (covering a shift / testing).
  if (isAdmin) {
    return (
      <>
        <div className="partner-rolebar">
          <button className={adminRole === "picker" ? "sel" : ""} onClick={() => chooseRole("picker")}>🧺 Picking</button>
          <button className={adminRole === "delivery" ? "sel" : ""} onClick={() => chooseRole("delivery")}>🛵 Delivery</button>
        </div>
        <EmployeeApp role={adminRole} name={user?.name || "Admin"} onLogout={logout} />
      </>
    );
  }

  if (partner === undefined) return <Splash text="Loading…" />;

  // Not registered yet → KYC form.
  if (!partner) return <PartnerRegister email={user?.email} onDone={reload} />;

  if (partner.status === "pending") {
    return (
      <div className="partner-notstaff">
        <div className="empty-emoji">🕒</div>
        <h2>Under review</h2>
        <p>Thanks, <strong>{partner.fullName}</strong>! The store is reviewing your
          documents. You'll be able to start once you're approved.</p>
        <button className="emp-logout" onClick={logout}>Log out</button>
      </div>
    );
  }

  if (partner.status === "rejected") {
    return (
      <div className="partner-notstaff">
        <div className="empty-emoji">⚠️</div>
        <h2>Not approved</h2>
        <p>Your registration wasn't approved. Please contact the store, or submit again with clearer documents.</p>
        <button className="preg-next" style={{ maxWidth: 260 }} onClick={() => setPartner(null)}>Register again</button>
        <button className="emp-logout" onClick={logout}>Log out</button>
      </div>
    );
  }

  // Approved → their role decides the dashboard.
  return <EmployeeApp role={partner.role} name={partner.fullName || user?.name} onLogout={logout} />;
}

export default function PartnerApp() {
  return (
    <AuthProvider>
      <PartnerInner />
    </AuthProvider>
  );
}
