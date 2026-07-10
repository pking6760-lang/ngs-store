import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

// Passwordless login. With a real backend it's email → 6-digit code. In the
// demo it's phone → 4-digit code shown on screen. `reason` optionally explains
// why we're asking.
export default function AuthModal({ open, onClose, onSuccess, reason }) {
  const { authMode, requestOtp, verifyOtp, cancelOtp } = useAuth();
  const email = authMode === "email";
  const [contact, setContact] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("contact"); // "contact" | "otp"
  const [isNew, setIsNew] = useState(false);
  const [demoCode, setDemoCode] = useState(""); // demo phone mode only
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  function close() {
    cancelOtp();
    setStage("contact"); setContact(""); setName(""); setCode("");
    setError(""); setDemoCode("");
    onClose();
  }

  async function sendCode(e) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await requestOtp(contact, name);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setIsNew(res.isNewUser || false);
    if (res.code) setDemoCode(res.code); // demo only
    setStage("otp");
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await verifyOtp(code, name);
    setBusy(false);
    if (res.ok) { close(); onSuccess && onSuccess(); }
    else setError(res.error);
  }

  const codeLen = email ? 6 : 4;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close} aria-label="Close">✕</button>

        <div className="auth-brand">
          <span className="logo-mark big">NGS</span>
          <span className="logo-sub">store</span>
        </div>

        {stage === "contact" ? (
          <>
            <h2 className="auth-title">Log in or sign up</h2>
            <p className="auth-reason">
              {reason ||
                (email
                  ? "We'll email you a one-time code — no password needed."
                  : "We'll send a one-time code to your WhatsApp.")}
            </p>
            <form className="auth-form" onSubmit={sendCode}>
              {email ? (
                <>
                  <label className="field">
                    <span>Email address</span>
                    <input
                      type="email" value={contact}
                      onChange={(e) => { setContact(e.target.value); setError(""); }}
                      placeholder="you@example.com" autoFocus
                    />
                  </label>
                  <label className="field">
                    <span>Your name <em>(new customers)</em></span>
                    <input
                      type="text" value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Priya Sharma"
                    />
                  </label>
                </>
              ) : (
                <label className="field">
                  <span>Phone number</span>
                  <div className="phone-input">
                    <span className="phone-cc">🇮🇳 +91</span>
                    <input
                      type="tel" inputMode="numeric" value={contact}
                      onChange={(e) => {
                        setContact(e.target.value.replace(/\D/g, "").slice(0, 10));
                        setError("");
                      }}
                      placeholder="10-digit mobile number" autoFocus
                    />
                  </div>
                </label>
              )}
              {error && <div className="auth-error">{error}</div>}
              <button className="checkout-btn" type="submit" disabled={busy}>
                {busy ? "Sending…" : email ? "Send code to email" : "Send code on WhatsApp"}
              </button>
            </form>
            <p className="auth-switch">
              <span className="wa-note">
                {email
                  ? "📧 The code arrives in your inbox — no password needed."
                  : "💬 The code arrives on WhatsApp — no password needed."}
              </span>
            </p>
          </>
        ) : (
          <>
            <h2 className="auth-title">Enter the code</h2>
            <p className="auth-reason">
              Sent to {email ? contact : `+91 ${contact}`}.{" "}
              <button
                className="link-btn"
                onClick={() => { setStage("contact"); setCode(""); cancelOtp(); }}
              >Change</button>
            </p>

            {demoCode && (
              <div className="otp-demo-note">
                Demo code (would arrive on WhatsApp): <strong>{demoCode}</strong>
              </div>
            )}

            <form className="auth-form" onSubmit={verify}>
              {!email && isNew && (
                <label className="field">
                  <span>Your name</span>
                  <input
                    type="text" value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                  />
                </label>
              )}
              <label className="field">
                <span>One-time code</span>
                <input
                  className="otp-input" type="tel" inputMode="numeric" value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, codeLen));
                    setError("");
                  }}
                  placeholder={`${codeLen}-digit code`} autoFocus
                />
              </label>
              {error && <div className="auth-error">{error}</div>}
              <button className="checkout-btn" type="submit" disabled={busy}>
                {busy ? "Verifying…" : "Verify & continue"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
