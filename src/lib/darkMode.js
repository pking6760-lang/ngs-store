// Dark mode — a single source of truth for the customer app's theme.
//
// The preference is one of "system" | "light" | "dark". "system" follows the
// phone's setting live. Whatever resolves, we stamp data-theme="light|dark" on
// <html>; the dark palette in styles.css keys off that attribute, so one flip
// reskins every screen. The choice is remembered on the device.
import { useEffect, useState } from "react";

const KEY = "ngs.theme";
const root = () => (typeof document !== "undefined" ? document.documentElement : null);
const mql = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

export function getThemePref() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

// The theme actually shown right now, resolving "system" against the phone.
export function resolvedTheme(pref = getThemePref()) {
  if (pref === "light" || pref === "dark") return pref;
  const m = mql();
  return m && m.matches ? "dark" : "light";
}

function paint(pref) {
  const el = root();
  if (!el) return;
  const theme = resolvedTheme(pref);
  el.setAttribute("data-theme", theme);
  // Keep the mobile status-bar / browser chrome in step with the app.
  try {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", theme === "dark" ? "#0B0E0C" : "#ffffff");
  } catch {
    /* no document head (tests) — the data-theme attribute is what matters */
  }
}

// Called once at boot (before React paints) so there's no light-mode flash.
export function initTheme() {
  const pref = getThemePref();
  paint(pref);
  const m = mql();
  if (m) {
    const onSys = () => { if (getThemePref() === "system") paint("system"); };
    m.addEventListener ? m.addEventListener("change", onSys) : m.addListener(onSys);
  }
}

export function setThemePref(pref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* private mode — the attribute below still applies for this session */
  }
  paint(pref);
  try {
    window.dispatchEvent(new Event("ngs:theme"));
  } catch {
    /* ignore */
  }
}

// React binding for the toggle in Profile. Returns the stored preference, the
// resolved theme, and a setter; re-renders when either the preference or the
// system setting changes.
export function useTheme() {
  const [pref, setPref] = useState(getThemePref);
  const [resolved, setResolved] = useState(() => resolvedTheme());
  useEffect(() => {
    const sync = () => { setPref(getThemePref()); setResolved(resolvedTheme()); };
    window.addEventListener("ngs:theme", sync);
    const m = mql();
    const onSys = () => sync();
    if (m) (m.addEventListener ? m.addEventListener("change", onSys) : m.addListener(onSys));
    return () => {
      window.removeEventListener("ngs:theme", sync);
      if (m) (m.removeEventListener ? m.removeEventListener("change", onSys) : m.removeListener(onSys));
    };
  }, []);
  return { pref, resolved, setTheme: setThemePref };
}
