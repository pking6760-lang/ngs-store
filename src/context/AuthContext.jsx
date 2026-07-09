import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Demo-only auth. Accounts live in localStorage so the flow works with no
// backend yet. A real server will replace this later (same UI, real security).
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

// Strip the password before we hand a user object to the UI.
function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => publicUser(readSession()));

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

      // Returns { ok: true } or { ok: false, error }
      signup({ name, phone, email, password }) {
        const cleanPhone = (phone || "").trim();
        const cleanEmail = (email || "").trim().toLowerCase();
        if (!name.trim()) return { ok: false, error: "Please enter your name." };
        if (!/^\d{10}$/.test(cleanPhone))
          return { ok: false, error: "Enter a valid 10-digit phone number." };
        if (!password || password.length < 4)
          return { ok: false, error: "Password must be at least 4 characters." };

        const users = readUsers();
        if (users.some((u) => u.phone === cleanPhone))
          return { ok: false, error: "An account with this phone already exists." };

        const newUser = {
          id: "u" + cleanPhone,
          name: name.trim(),
          phone: cleanPhone,
          email: cleanEmail,
          password, // demo only — never do this with a real backend
          address: "",
          createdAt: new Date().toISOString(),
        };
        writeUsers([...users, newUser]);
        setUser(publicUser(newUser));
        return { ok: true };
      },

      login({ phone, password }) {
        const cleanPhone = (phone || "").trim();
        const users = readUsers();
        const found = users.find((u) => u.phone === cleanPhone);
        if (!found) return { ok: false, error: "No account found for this phone." };
        if (found.password !== password)
          return { ok: false, error: "Incorrect password." };
        setUser(publicUser(found));
        return { ok: true };
      },

      logout() {
        setUser(null);
      },

      // Update name / email / address for the logged-in user.
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
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
