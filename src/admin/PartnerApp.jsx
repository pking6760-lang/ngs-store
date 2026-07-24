import { useEffect, useRef, useState } from "react";
import { initHardwareBack } from "../lib/useBackGuard.js";
import { toast } from "../lib/toast.js";
import { AuthProvider, useAuth } from "../context/AuthContext.jsx";
import PartnerDashboard from "./PartnerDashboard.jsx";
import PartnerRegister from "./PartnerRegister.jsx";
import ApkPrompt from "../components/ApkPrompt.jsx";
import { PartnerMark } from "./BrandMark.jsx";
import PartnerTerms, { TERMS_VERSION } from "./PartnerTerms.jsx";
import LivenessCapture from "./LivenessCapture.jsx";
import { Ic } from "./AdminIcons.jsx";
import * as api from "../lib/api.js";

// Mandatory re-acceptance when the Partner Terms change (e.g. new penalty /
// wallet-deduction clauses). Blocks the app until the partner accepts.
function TermsReaccept({ onAccepted }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function accept() {
    setBusy(true); setErr("");
    try { await api.acceptPartnerTerms(TERMS_VERSION); onAccepted(); }
    catch (e) { setErr(e.message || "Couldn't save. Please try again."); setBusy(false); }
  }
  return <PartnerTerms updated onAccept={accept} busy={busy} error={err} />;
}

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
        <PartnerMark size={52} />
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
      <PartnerMark size={56} />
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

  // Hardware Back: close open layers first; double-press to exit at home.
  useEffect(() => { initHardwareBack(() => toast("Press back again to exit")); }, []);

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
          <button className={adminRole === "picker" ? "sel" : ""} onClick={() => chooseRole("picker")}><Ic name="basket" size={16} /> Picking</button>
          <button className={adminRole === "delivery" ? "sel" : ""} onClick={() => chooseRole("delivery")}><Ic name="scooter" size={16} /> Delivery</button>
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
        <div className="pns-ic"><Ic name="pending" size={30} /></div>
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
        <div className="pns-ic warn"><Ic name="alert" size={30} /></div>
        <h2>Not approved</h2>
        <p>Your registration wasn't approved. Please contact the store, or submit again with clearer documents.</p>
        <button className="preg-next" style={{ maxWidth: 260 }} onClick={() => setPartner(null)}>Register again</button>
        <button className="emp-logout" onClick={logout}>Log out</button>
      </div>
    );
  }

  // Approved but on an older Terms version → must re-accept the updated Terms
  // (new earnings/penalty/wallet-deduction clauses) before continuing.
  if (partner.termsVersion !== TERMS_VERSION) {
    return <TermsReaccept onAccepted={reload} />;
  }

  // The store asked this partner to (re)submit specific KYC items → capture
  // only those, keeping the rest of their approved details untouched.
  if (partner.kycRequests && partner.kycRequests.length > 0) {
    return <KycReverify items={partner.kycRequests} onDone={reload} />;
  }

  // Approved → their role decides the dashboard.
  return (
    <>
      <PartnerDashboard role={partner.role} name={partner.fullName || user?.name} partner={partner} onLogout={logout} />
      <ApkPrompt app="partner" />
    </>
  );
}

// Item labels shared by the partner + admin re-KYC flows.
const KYC_ITEMS = {
  selfie: "Live selfie",
  aadhaar_front: "Aadhaar — front",
  aadhaar_back: "Aadhaar — back",
  pan: "PAN card",
  dl: "Driving licence",
};

// General re-verification: the store requested one or more KYC items. Complete
// them one at a time — a live face check for the selfie, a photo for documents
// — without redoing the whole registration.
function KycReverify({ items, onDone }) {
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const [pendingDoc, setPendingDoc] = useState(null);
  // What's still outstanding (server updates on reload, but track locally too).
  const [done, setDone] = useState([]);
  const remaining = items.filter((i) => !done.includes(i));

  async function submitSelfie({ photoBlob, videoBlob }) {
    setLive(false); setBusy("selfie"); setErr("");
    try { await api.partnerSubmitSelfie(photoBlob, videoBlob); setDone((d) => [...d, "selfie"]); }
    catch (e) { setErr(e.message || "Couldn't submit."); }
    finally { setBusy(""); }
  }

  function pickDoc(item) { setPendingDoc(item); setErr(""); setTimeout(() => fileRef.current?.click(), 0); }
  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingDoc) return;
    setBusy(pendingDoc);
    try { await api.partnerSubmitDoc(pendingDoc, file); setDone((d) => [...d, pendingDoc]); }
    catch (e2) { setErr(e2.message || "Couldn't upload."); }
    finally { setBusy(""); setPendingDoc(null); }
  }

  if (live) {
    return (
      <div className="live-kyc-overlay">
        <LivenessCapture onCancel={() => setLive(false)} onComplete={submitSelfie} />
      </div>
    );
  }

  if (remaining.length === 0) {
    return (
      <div className="partner-notstaff">
        <div className="pns-ic ok"><Ic name="check" size={30} /></div>
        <h2>All done</h2>
        <p>Thanks — your verification has been submitted.</p>
        <button className="pd-btn" onClick={onDone}>Continue</button>
      </div>
    );
  }

  return (
    <div className="kyc-reverify">
      <div className="pns-ic"><Ic name="lock" size={28} /></div>
      <h2>Verification needed</h2>
      <p>The store needs you to complete the item{remaining.length > 1 ? "s" : ""} below to keep your account active. The rest of your details stay as they are.</p>
      {err && <div className="preg-error">{err}</div>}
      <div className="kyc-reverify-list">
        {items.map((item) => {
          const isDone = done.includes(item);
          const loading = busy === item;
          return (
            <div className={`kyc-req-row ${isDone ? "done" : ""}`} key={item}>
              <span className="kyc-req-name">{KYC_ITEMS[item] || item}</span>
              {isDone ? (
                <span className="kyc-req-ok"><Ic name="check" size={13} /> Done</span>
              ) : item === "selfie" ? (
                <button className="kyc-req-btn" onClick={() => setLive(true)} disabled={!!busy}>
                  {loading ? "…" : "Take selfie"}
                </button>
              ) : (
                <button className="kyc-req-btn" onClick={() => pickDoc(item)} disabled={!!busy}>
                  {loading ? "Uploading…" : "Add photo"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFile} />
      {remaining.length === 0 && <button className="pd-btn" onClick={onDone}>Continue</button>}
    </div>
  );
}

export default function PartnerApp() {
  return (
    <AuthProvider>
      <PartnerInner />
    </AuthProvider>
  );
}
