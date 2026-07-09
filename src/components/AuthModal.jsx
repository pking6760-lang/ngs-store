import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

// Login / sign-up dialog. `reason` is an optional line explaining why we're
// asking (e.g. shown when the customer tries to check out).
export default function AuthModal({ open, onClose, onSuccess, reason }) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");

  if (!open) return null;

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setError("");
  }

  function submit(e) {
    e.preventDefault();
    const result =
      mode === "login"
        ? login({ phone: form.phone, password: form.password })
        : signup(form);
    if (result.ok) {
      onSuccess ? onSuccess() : onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="auth-brand">
          <span className="logo-mark big">NGS</span>
          <span className="logo-sub">store</span>
        </div>
        <h2 className="auth-title">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h2>
        {reason && <p className="auth-reason">{reason}</p>}

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Log in
          </button>
          <button
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
            Sign up
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label className="field">
              <span>Full name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Priya Sharma"
                autoFocus
              />
            </label>
          )}

          <label className="field">
            <span>Phone number</span>
            <input
              type="tel"
              inputMode="numeric"
              value={form.phone}
              onChange={(e) =>
                set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))
              }
              placeholder="10-digit mobile number"
              autoFocus={mode === "login"}
            />
          </label>

          {mode === "signup" && (
            <label className="field">
              <span>Email (optional)</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="you@example.com"
              />
            </label>
          )}

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder={mode === "signup" ? "At least 4 characters" : "Your password"}
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button className="checkout-btn" type="submit">
            {mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? (
            <>
              New to NGS Store?{" "}
              <button className="link-btn" onClick={() => setMode("signup")}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button className="link-btn" onClick={() => setMode("login")}>
                Log in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
