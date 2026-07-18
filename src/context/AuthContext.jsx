import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../lib/api.js";

// Auth has two modes:
//  • BACKEND (Supabase configured): real email one-time-code login. Accounts,
//    points and membership live on the server and are tamper-proof.
//  • DEMO (no backend): passwordless phone OTP kept in localStorage so the
//    preview still works with no server.
const BACKEND = api.isBackendConfigured;
const USERS_KEY = "ngs-users-v1";
const SESSION_KEY = "ngs-current-user-v1";
// Last-known profile, cached so a returning customer is shown as logged-in
// INSTANTLY on open (no waiting for a network profile fetch). We verify the
// session + refresh the profile in the background right after.
const PROFILE_KEY = "ngs-profile-v1";
function readCachedProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); }
  catch { return null; }
}
function writeCachedProfile(p) {
  try {
    if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_KEY);
  } catch { /* ignore */ }
}
// Remember the "we've sent you a code, waiting for it" state so that if the
// customer switches to their email app (and the mobile browser reloads the
// tab when they come back) they land straight back on the code screen instead
// of starting over. sessionStorage → cleared automatically when they fully
// close the browser, so it never goes stale across days.
const PENDING_KEY = "ngs-pending-email-v1";
function readPending() {
  try { return sessionStorage.getItem(PENDING_KEY) || null; } catch { return null; }
}
function writePending(email) {
  try {
    if (email) sessionStorage.setItem(PENDING_KEY, email);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch { /* ignore */ }
}

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
  // Seed from the cached profile so the app renders logged-in on the very first
  // frame — no logged-out flash, no waiting on the network.
  const [user, setUser] = useState(readCachedProfile);
  const [ready, setReady] = useState(false);
  const [pendingEmail, setPendingEmailState] = useState(readPending);

  // Keep React state and sessionStorage in lock-step.
  function setPendingEmail(email) {
    writePending(email);
    setPendingEmailState(email);
  }

  // soft=true keeps the current profile if the re-read fails (a transient blip
  // on a focus/pull refresh must never look like a logout); the initial/auth
  // load uses the hard form so a real sign-out clears the user.
  async function refresh(soft = false) {
    try {
      const p = await api.getMyProfile();
      if (soft && !p) return; // logged in but the read came back empty → keep what we have
      setUser(p);
      writeCachedProfile(p);  // keep the instant-login cache fresh
    } catch { if (!soft) { setUser(null); writeCachedProfile(null); } }
  }

  // Track whether someone is signed in so the focus refresh doesn't hammer the
  // server while logged out.
  const loggedInRef = useRef(false);
  loggedInRef.current = !!user;

  useEffect(() => {
    let alive = true;
    api.getSession().then((s) => {
      if (!alive) return;
      if (s) {
        // Session is valid → we're logged in. Update the profile in the
        // BACKGROUND (soft, so a slow/failed network never blanks the UI). The
        // cached profile already rendered instantly above.
        refresh(true);
        setPendingEmail(null);
      } else {
        // No session → genuinely logged out. Clear the optimistic cache.
        setUser(null);
        writeCachedProfile(null);
      }
      setReady(true);
    });
    const unsub = api.onAuthChange(async (session) => {
      // Soft on sign-in / token-refresh so it never flashes to logged-out.
      if (session) { refresh(true); setPendingEmail(null); }
      else { setUser(null); writeCachedProfile(null); }
    });
    return () => { alive = false; unsub(); };
  }, []);

  // Re-read the profile (points, wallet balance, membership) whenever the app
  // comes back to the foreground or is refocused — so a reward won from a
  // scratch card, a wallet top-up, or a membership change shows up without
  // having to close and reopen the app. Soft so a network hiccup never logs out.
  useEffect(() => {
    const onWake = () => {
      if (!loggedInRef.current) return;
      if (document.visibilityState === "hidden") return;
      refresh(true);
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  const value = useMemo(() => ({
    user,
    isLoggedIn: !!user,
    authMode: "email",
    ready,
    pendingContact: pendingEmail,
    awaitingOtp: !!pendingEmail,

    // Step 1 — email the customer an 8-digit code.
    async requestOtp(email, name) {
      const clean = (email || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean))
        return { ok: false, error: "Enter a valid email address." };
      try {
        await api.sendEmailCode(clean, name);
        setPendingEmail(clean);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message || "Couldn't send the code." }; }
    },

    // Step 2 — verify the code → establishes the session.
    async verifyOtp(code) {
      if (!pendingEmail) return { ok: false, error: "Request a code first." };
      try {
        await api.verifyEmailCode(pendingEmail, code);
        await refresh();
        setPendingEmail(null);
        return { ok: true };
      } catch { return { ok: false, error: "Incorrect or expired code." }; }
    },

    cancelOtp() { setPendingEmail(null); },

    async logout() { await api.signOut(); setUser(null); writeCachedProfile(null); },

    async updateProfile(patch) {
      try {
        await api.updateMyProfile(patch);
        await refresh();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },

    // Points are granted/spent by the server; just re-read the balance.
    async applyRewards() { await refresh(); },

    // Explicit profile re-read for pull-to-refresh (soft: never logs out).
    async refreshProfile() { await refresh(true); },

    // Join / renew NGS Prime — paid from the customer's wallet, server-side.
    async joinMembership() {
      try {
        await api.joinMembership();
        await refresh();
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
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
    async refreshProfile() { /* demo profile is local — nothing to re-read */ },

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
