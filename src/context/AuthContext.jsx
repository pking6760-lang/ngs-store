import { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as api from "../lib/api.js";

// Auth has two modes:
//  • BACKEND (Supabase configured): real email one-time-code login. Accounts,
//    points and membership live on the server and are tamper-proof.
//  • DEMO (no backend): passwordless phone OTP kept in localStorage so the
//    preview still works with no server.
const BACKEND = api.isBackendConfigured;
const USERS_KEY = "ngs-users-v1";
const SESSION_KEY = "ngs-current-user-v1";

const AuthContext = createContext(null);

function readUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); }
  catch { return []; }
}
function writeUsers(list) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}
function makeOtp() { return String(Math.floor(1000 + Math.random() * 9000)); }

export function AuthProvider({ children }) {
  return BACKEND ? <BackendAuth>{children}</BackendAuth> : <DemoAuth>{children}</DemoAuth>;
}

/* ─── Backend auth (Supabase email OTP) ─────────────────────────────────── */
function BackendAuth({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(null);

  async function refresh() {
    try { setUser(await api.getMyProfile()); } catch { setUser(null); }
  }

  useEffect(() => {
    let alive = true;
    api.getSession().then(async (s) => {
      if (!alive) return;
      if (s) await refresh();
      setReady(true);
    });
    const unsub = api.onAuthChange(async (session) => {
      if (session) await refresh();
      else setUser(null);
    });
    return () => { alive = false; unsub(); };
  }, []);

  const value = useMemo(() => ({
    user,
    isLoggedIn: !!user,
    authMode: "email",
    ready,
    pendingContact: pendingEmail,
    awaitingOtp: !!pendingEmail,

    // Email the customer a magic sign-in link. When they tap it, the site
    // reopens already signed in (handled by onAuthChange above).
    async requestOtp(email, name) {
      const clean = (email || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean))
        return { ok: false, error: "Enter a valid email address." };
      try {
        await api.sendMagicLink(clean, name);
        setPendingEmail(clean);
        return { ok: true, magicLink: true };
      } catch (e) { return { ok: false, error: e.message || "Couldn't send the link." }; }
    },

    // No code step for magic links — kept for interface compatibility.
    async verifyOtp() { return { ok: false, error: "Please tap the link in your email." }; },

    cancelOtp() { setPendingEmail(null); },

    async logout() { await api.signOut(); setUser(null); },

    async updateProfile(patch) {
      try {
        await api.updateMyProfile(patch);
        await refresh();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Points are granted/spent by the server; just re-read the balance.
    async applyRewards() { await refresh(); },

    // Membership is activated by the store (admin) on the server.
    joinMembership() {
      return { ok: false, error: "Membership is activated by the store." };
    },
  }), [user, ready, pendingEmail]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ─── Demo auth (localStorage phone OTP) ────────────────────────────────── */
function DemoAuth({ children }) {
  const [user, setUser] = useState(() => readSession());
  const [pending, setPending] = useState(null);

  useEffect(() => {
    try {
      if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
  }, [user]);

  const value = useMemo(() => ({
    user,
    isLoggedIn: !!user,
    authMode: "phone",
    ready: true,
    pendingContact: pending?.phone || null,
    awaitingOtp: !!pending,
    pendingIsNew: pending?.isNewUser || false,

    requestOtp(phone) {
      const cleanPhone = (phone || "").trim();
      if (!/^\d{10}$/.test(cleanPhone))
        return { ok: false, error: "Enter a valid 10-digit phone number." };
      const users = readUsers();
      const isNewUser = !users.some((u) => u.phone === cleanPhone);
      const code = makeOtp();
      setPending({ phone: cleanPhone, code, isNewUser });
      return { ok: true, code, isNewUser };
    },

    verifyOtp(code, name) {
      if (!pending) return { ok: false, error: "Request a code first." };
      if ((code || "").trim() !== pending.code)
        return { ok: false, error: "Incorrect code. Please try again." };
      const users = readUsers();
      let account = users.find((u) => u.phone === pending.phone);
      if (!account) {
        account = {
          id: "u" + pending.phone, name: (name || "").trim() || "NGS Customer",
          phone: pending.phone, email: "", address: "", points: 0,
          member: false, memberSince: null, createdAt: new Date().toISOString(),
        };
        writeUsers([...users, account]);
      }
      setPending(null);
      setUser(account);
      return { ok: true };
    },

    cancelOtp() { setPending(null); },
    logout() { setUser(null); },

    updateProfile(patch) {
      if (!user) return { ok: false, error: "Not logged in." };
      writeUsers(readUsers().map((u) => (u.id === user.id ? { ...u, ...patch } : u)));
      setUser((prev) => ({ ...prev, ...patch }));
      return { ok: true };
    },

    applyRewards({ earned = 0, used = 0 }) {
      if (!user) return;
      const nextPoints = Math.max(0, (user.points || 0) + earned - used);
      writeUsers(readUsers().map((u) => (u.id === user.id ? { ...u, points: nextPoints } : u)));
      setUser((prev) => ({ ...prev, points: nextPoints }));
    },

    joinMembership() {
      if (!user) return;
      const patch = { member: true, memberSince: new Date().toISOString() };
      writeUsers(readUsers().map((u) => (u.id === user.id ? { ...u, ...patch } : u)));
      setUser((prev) => ({ ...prev, ...patch }));
    },
  }), [user, pending]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
