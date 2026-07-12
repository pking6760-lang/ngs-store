import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "../context/AuthContext.jsx";
import PartnerDashboard from "./PartnerDashboard.jsx";
import PartnerRegister from "./PartnerRegister.jsx";
import * as api from "../lib/api.js";

// Branded "NGS Partner" email-code login (separate from the customer login).
function PartnerLogin() {
  const [stage, setStage] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api.partnerLoginSend(email); setStage("code"); }
    catch (err) { setError(err.message || "Couldn't send the code."); }
    finally { setBusy(false); }
  }
  async function verify(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api.partnerLoginVerify(email, code); } // success → session set → parent re-renders
    catch (err) { setError(err.message || "Couldn't verify."); setBusy(false); }
  }

  return (
    <div className="partner-login-bg">
      <div className="partner-login-brand">
        <span className="admin-logo">NGS</span>
        <span className="admin-logo-sub">partner</span>
        <p>Picking &amp; delivery</p>
      </div>
      <div className="partner-login-card">
        {stage === "email" ? (
          <form onSubmit={send}>
            <p className="pl-sub">Log in with your email — we'll send you a code.</p>
            <input className="login-input" type="email" value={email} autoFocus
              onChange={(e) => { setEmail(e.target.value); setError(""); }} placeholder="you@example.com" />
            {error && <div className="login-error">{error}</div>}
            <button className="login-btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p className="pl-sub">Enter the code sent to <strong>{email}</strong>.{" "}
              <button type="button" className="link-btn" onClick={() => { setStage("email"); setCode(""); setError(""); }}>Change</button></p>
            <input className="login-input" type="tel" inputMode="numeric" value={code} autoFocus
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} placeholder="6-digit code" />
            {error && <div className="login-error">{error}</div>}
            <button className="login-btn" type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify & continue"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

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
    if (isAdmin) { setPartner(null); return; }
    if (!isLoggedIn) { setPartner(undefined); return; }
    let alive = true;
    setPartner(undefined); // show the loading splash — never flash the register form
    const load = () => api.getMyPartner()
      .then((p) => { if (alive) setPartner(p); })
      .catch(() => { if (alive) setPartner(null); });
    load();
    // Live: reflect approval/rejection the instant the owner decides.
    const unsub = api.subscribeTable("partners", load);
    return () => { alive = false; unsub && unsub(); };
  }, [isLoggedIn, isAdmin, user?.id]);

  async function reload() {
    try { setPartner(await api.getMyPartner()); } catch { setPartner(null); }
  }
  function chooseRole(r) {
    setAdminRole(r);
    try { localStorage.setItem("ngs-partner-role", r); } catch { /* ignore */ }
  }

  if (!ready) return <Splash />;

  if (!isLoggedIn) return <PartnerLogin />;

  // Admin can use the partner app directly (covering a shift / testing).
  if (isAdmin) {
    return (
      <>
        <div className="partner-rolebar">
          <button className={adminRole === "picker" ? "sel" : ""} onClick={() => chooseRole("picker")}>🧺 Picking</button>
          <button className={adminRole === "delivery" ? "sel" : ""} onClick={() => chooseRole("delivery")}>🛵 Delivery</button>
        </div>
        <PartnerDashboard role={adminRole} name={user?.name || "Admin"} partner={null} onLogout={logout} />
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
  return <PartnerDashboard role={partner.role} name={partner.fullName || user?.name} partner={partner} onLogout={logout} />;
}

export default function PartnerApp() {
  return (
    <AuthProvider>
      <PartnerInner />
    </AuthProvider>
  );
}
