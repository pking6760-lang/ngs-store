import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

// Passwordless login: phone → WhatsApp OTP → verify.
// `reason` is an optional line explaining why we're asking.
export default function AuthModal({ open, onClose, onSuccess, reason }) {
  const { requestOtp, verifyOtp, cancelOtp } = useAuth();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("phone"); // "phone" | "otp"
  const [isNew, setIsNew] = useState(false);
  const [demoCode, setDemoCode] = useState(""); // shown only in the demo
  const [error, setError] = useState("");

  if (!open) return null;

  function close() {
    cancelOtp();
    setStage("phone");
    setPhone("");
    setName("");
    setCode("");
    setError("");
    onClose();
  }

  function sendCode(e) {
    e.preventDefault();
    const res = requestOtp(phone);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setIsNew(res.isNewUser);
    setDemoCode(res.code);
    setStage("otp");
    setError("");
  }

  function verify(e) {
    e.preventDefault();
    const res = verifyOtp(code, name);
    if (res.ok) {
      close();
      onSuccess && onSuccess();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close} aria-label="Close">
          ✕
        </button>

        <div className="auth-brand">
          <span className="logo-mark big">NGS</span>
          <span className="logo-sub">store</span>
        </div>

        {stage === "phone" ? (
          <>
            <h2 className="auth-title">Log in or sign up</h2>
            <p className="auth-reason">
              {reason || "We'll send a one-time code to your WhatsApp."}
            </p>
            <form className="auth-form" onSubmit={sendCode}>
              <label className="field">
                <span>Phone number</span>
                <div className="phone-input">
                  <span className="phone-cc">🇮🇳 +91</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                      setError("");
                    }}
                    placeholder="10-digit mobile number"
                    autoFocus
                  />
                </div>
              </label>
              {error && <div className="auth-error">{error}</div>}
              <button className="checkout-btn" type="submit">
                Send code on WhatsApp
              </button>
            </form>
            <p className="auth-switch">
              <span className="wa-note">
                💬 The code arrives on WhatsApp — no password needed.
              </span>
            </p>
          </>
        ) : (
          <>
            <h2 className="auth-title">Enter the code</h2>
            <p className="auth-reason">
              Sent to WhatsApp on +91 {phone}.{" "}
              <button
                className="link-btn"
                onClick={() => {
                  setStage("phone");
                  setCode("");
                  cancelOtp();
                }}
              >
                Change
              </button>
            </p>

            {/* Demo only — a real setup delivers this over WhatsApp. */}
            <div className="otp-demo-note">
              Demo code (would arrive on WhatsApp): <strong>{demoCode}</strong>
            </div>

            <form className="auth-form" onSubmit={verify}>
              {isNew && (
                <label className="field">
                  <span>Your name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                  />
                </label>
              )}
              <label className="field">
                <span>One-time code</span>
                <input
                  className="otp-input"
                  type="tel"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
                    setError("");
                  }}
                  placeholder="4-digit code"
                  autoFocus
                />
              </label>
              {error && <div className="auth-error">{error}</div>}
              <button className="checkout-btn" type="submit">
                Verify & continue
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
