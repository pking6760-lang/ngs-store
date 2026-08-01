import { useEffect, useRef, useState, useMemo } from "react";
import { themePalette } from "../lib/theme.js";
import FestiveIntro from "./FestiveIntro.jsx";

// ── The festive intro "slot" ────────────────────────────────────────────────
// When a festival theme is live, this plays a full-screen intro once per day —
// a brief, festive moment, then it dissolves into the app. The animation is
// generated entirely from the theme's data (colours + pattern), which is
// delivered over-the-air — so a new festival needs only a new theme, never an
// app update.

const seenKey = (id) => `festintro2:${id}:${new Date().toISOString().slice(0, 10)}`;

function normalize(theme) {
  const c = theme.colors || {};
  const palette = themePalette(c);
  return {
    id: theme.id,
    name: theme.name || "",
    greeting: theme.greeting || theme.banner?.kicker || "",
    kicker: theme.banner?.kicker || "",
    subtitle: theme.banner?.title || theme.banner?.subtitle || "",
    pattern: theme.pattern || "",
    decoration: theme.decoration || "",
    colors: {
      primary: c.primary || palette[0] || "#1C6B45",
      accent: c.accent || palette[1] || "#E5A200",
      deep: c.primaryDark || c.accentDeep || palette[2] || "#0F3D28",
    },
    palette: palette.length ? palette : ["#1C6B45", "#E5A200", "#C0392B"],
  };
}

export default function FestiveCover({ theme }) {
  const [show, setShow] = useState(false);
  const doneRef = useRef(false);
  const id = theme?.id;
  const data = useMemo(() => (theme ? normalize(theme) : null), [theme]);

  useEffect(() => {
    doneRef.current = false;
    setShow(false);
    if (!id) return;
    // Once per festival per day — an intro on every screen open stops being
    // special and becomes an obstacle.
    let seen = false;
    try { seen = !!localStorage.getItem(seenKey(id)); } catch { /* ignore */ }
    if (seen) return;
    setShow(true);
  }, [id]);

  function done() {
    if (doneRef.current) return;
    doneRef.current = true;
    try { localStorage.setItem(seenKey(id), "1"); } catch { /* ignore */ }
    setShow(false);
  }

  if (!show || !data) return null;
  return <FestiveIntro theme={data} onDone={done} />;
}
