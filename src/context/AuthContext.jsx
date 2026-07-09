import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Demo-only auth. Login is passwordless: enter phone → get a one-time code
// (in production, sent over WhatsApp) → verify. Accounts + points live in
// localStorage so the flow works with no backend yet.
const USERS_KEY = "ngs-users-v1";
const SESSION_KEY = "ngs-current-user-v1";

const AuthContext = createContext(null);

function readUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeUsers(list) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// A random 4-digit code. In production the backend sends this via WhatsApp.
function makeOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readSession());
  // Holds the code we're waiting to verify: { phone, code, isNewUser }
  const [pending, setPending] = useState(null);

  useEffect(() => {
    try {
      if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      isLoggedIn: !!user,

      // Step 1 — "send" a WhatsApp OTP. Returns { ok, code, isNewUser }.
      // (code is returned so the demo can show it on screen.)
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

      // Step 2 — verify the code. For a new number, `name` creates the account.
      verifyOtp(code, name) {
        if (!pending) return { ok: false, error: "Request a code first." };
        if ((code || "").trim() !== pending.code)
          return { ok: false, error: "Incorrect code. Please try again." };

        const users = readUsers();
        let account = users.find((u) => u.phone === pending.phone);

        if (!account) {
          account = {
            id: "u" + pending.phone,
            name: (name || "").trim() || "NGS Customer",
            phone: pending.phone,
            email: "",
            address: "",
            points: 0,
            member: false,
            memberSince: null,
            createdAt: new Date().toISOString(),
          };
          writeUsers([...users, account]);
        }
        setPending(null);
        setUser(account);
        return { ok: true };
      },

      cancelOtp() {
        setPending(null);
      },

      pendingPhone: pending?.phone || null,
      awaitingOtp: !!pending,
      pendingIsNew: pending?.isNewUser || false,

      logout() {
        setUser(null);
      },

      updateProfile(patch) {
        if (!user) return { ok: false, error: "Not logged in." };
        const users = readUsers();
        const next = users.map((u) =>
          u.id === user.id ? { ...u, ...patch } : u
        );
        writeUsers(next);
        setUser((prev) => ({ ...prev, ...patch }));
        return { ok: true };
      },

      // Add earned points and subtract redeemed points in one update.
      applyRewards({ earned = 0, used = 0 }) {
        if (!user) return;
        const nextPoints = Math.max(0, (user.points || 0) + earned - used);
        const users = readUsers();
        writeUsers(
          users.map((u) =>
            u.id === user.id ? { ...u, points: nextPoints } : u
          )
        );
        setUser((prev) => ({ ...prev, points: nextPoints }));
      },

      // Join membership (demo: just flips the flag; real setup bills via UPI).
      joinMembership() {
        if (!user) return;
        const users = readUsers();
        const patch = { member: true, memberSince: new Date().toISOString() };
        writeUsers(
          users.map((u) => (u.id === user.id ? { ...u, ...patch } : u))
        );
        setUser((prev) => ({ ...prev, ...patch }));
      },
    }),
    [user, pending]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
