import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { shop } from "../data/shop.js";

// Small line icons (no emoji) for the login screen.
const AIcon = {
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  chat: <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.6 8.6 0 0 1-4-.95L3 20l1.1-5.3a8.4 8.4 0 0 1-.95-3.9A8.4 8.4 0 0 1 11.5 3 8.4 8.4 0 0 1 21 11.5z" />,
  shield: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
};
function AI({ d, size = 16, sw = 1.9 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  );
}
// A tiny drawn India flag for the phone country code — cleaner than an emoji.
function IndiaFlag() {
  return (
    <svg className="cc-flag" width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
      <rect width="20" height="14" rx="2" fill="#fff" />
      <path d="M0 2a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2.67H0z" fill="#FF9933" />
      <rect y="9.33" width="20" height="2.67" fill="#138808" />
      <path d="M18 12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2h16z" fill="#138808" />
      <circle cx="10" cy="7" r="1.7" fill="none" stroke="#0a3d91" strokeWidth="0.5" />
    </svg>
  );
}

// Passwordless login. With a real backend it's email → 6-digit code. In the
// demo it's phone → 4-digit code shown on screen. `reason` optionally explains
// why we're asking.
export default function AuthModal({ open, onClose, onSuccess, reason }) {
  const { authMode, requestOtp, verifyOtp, cancelOtp, pendingContact, awaitingOtp } = useAuth();
  const email = authMode === "email";
  const [contact, setContact] = useState(awaitingOtp ? pendingContact || "" : "");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState(awaitingOtp ? "otp" : "contact"); // "contact" | "otp"
  const [isNew, setIsNew] = useState(false);
  const [demoCode, setDemoCode] = useState(""); // demo phone mode only
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // If we open (or re-open after a mobile tab reload) while a code is already
  // pending, jump straight to the code screen with the email pre-filled — the
  // customer should never be forced to request a fresh code just because they
  // popped over to their inbox.
  useEffect(() => {
    if (open && awaitingOtp && stage === "contact") {
      setStage("otp");
      if (pendingContact) setContact(pendingContact);
    }
  }, [open, awaitingOtp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // Tapping the dark area outside the box dismisses the modal — but NOT while a
  // code is in progress, otherwise a stray tap (e.g. after copying the code
  // from the email app) would throw the whole verification away.
  function onBackdrop() {
    if (stage === "otp" || busy) return;
    close();
  }

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

  // Demo phone code is 4 digits; email OTP length is set on Supabase (6–10),
  // so allow up to 10 and don't hard-cap at 6.
  const codeLen = email ? 10 : 4;

  return (
    <div className="modal-overlay" onClick={onBackdrop}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close} aria-label="Close">✕</button>

        <div className="auth-brand">
          <span className="auth-logo-badge" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="30" height="30" fill="none">
              <path d="M19 45.5 V21 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 .8.4 L37.8 37 V21 a1 1 0 0 1 1-1 h3.2 a1 1 0 0 1 1 1 v23.5 a1 1 0 0 1-1 1 h-4 a1 1 0 0 1-.8-.4 L26.2 29 v16.5 a1 1 0 0 1-1 1 H20 a1 1 0 0 1-1-1 z" fill="#fff" />
              <path d="M43.5 19.2 c1.2 -4.4 5 -6.7 9.3 -6.4 c.4 4.3 -2.2 8.4 -6.6 9.1 c-1 .16 -2 .12 -2.9 -.1 z" fill="#bdf0d0" />
            </svg>
          </span>
          <span className="auth-brand-text">
            <span className="auth-brand-name">{shop.short}</span>
            <span className="auth-brand-sub">{shop.tagline}</span>
          </span>
        </div>

        {stage === "contact" ? (
          <>
            <h2 className="auth-title">Log in or sign up</h2>
            <p className="auth-reason">
              {reason ||
                (email
                  ? "We'll email you a 6-digit code — no password needed."
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
                    <span className="phone-cc"><IndiaFlag /> +91</span>
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
                {busy ? "Sending…" : email ? "Email me a code" : "Send code on WhatsApp"}
              </button>
            </form>
            <div className="auth-trust">
              <span className="auth-trust-ic"><AI d={email ? AIcon.mail : AIcon.chat} size={15} /></span>
              <span>
                {email
                  ? "A 6-digit code arrives in your inbox — no password needed."
                  : "The code arrives on WhatsApp — no password needed."}
              </span>
            </div>
            <div className="auth-secure">
              <AI d={AIcon.lock} size={13} sw={2} /> Your details are kept private &amp; secure
            </div>
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
                  placeholder={email ? "Enter the code" : `${codeLen}-digit code`} autoFocus
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
