import { useEffect, useRef, useState, Suspense, lazy, useMemo } from "react";
import { themePalette } from "../lib/theme.js";
import { resolveIntro } from "./festive-intros/registry.js";

// ── The festive intro "slot" ────────────────────────────────────────────────
// When a festival theme is live, this plays that festival's OWN bespoke intro
// animation once per day — a brief, full-screen moment, then it dissolves into
// the app. The animations themselves live in ./festive-intros/ (one per
// festival, generated from the prompt); this just picks the right one, gates it,
// and gives it a clean stage. Nothing plays if the festival has no intro yet.

const seenKey = (id) => `festintro:${id}:${new Date().toISOString().slice(0, 10)}`;

function normalize(theme) {
  const c = theme.colors || {};
  const palette = themePalette(c);
  return {
    id: theme.id,
    name: theme.name || "",
    greeting: theme.greeting || theme.banner?.kicker || "",
    kicker: theme.banner?.kicker || theme.name || "",
    subtitle: theme.banner?.title || theme.banner?.subtitle || "",
    pattern: theme.pattern || "",
    decoration: theme.decoration || "",
    colors: {
      primary: c.primary || palette[0] || "#1C6B45",
      accent: c.accent || palette[1] || "#E5A200",
      deep: c.primaryDark || c.accentDeep || palette[2] || "#0F3D28",
      tint: c.tint || "#ffffff",
      bg: c.bg || "#ffffff",
      ink: c.ink || "#1a1a1a",
    },
    palette: palette.length ? palette : ["#1C6B45", "#E5A200", "#C0392B"],
    reducedMotion: typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false,
  };
}

export default function FestiveCover({ theme }) {
  const [Comp, setComp] = useState(null);
  const [gone, setGone] = useState(false);
  const doneRef = useRef(false);

  const id = theme?.id;
  const loader = useMemo(() => resolveIntro(theme), [theme]);
  const data = useMemo(() => (theme ? normalize(theme) : null), [theme]);

  useEffect(() => {
    doneRef.current = false;
    setGone(false);
    setComp(null);
    if (!id || !loader) return;
    // Once per festival per day — an intro that greets you on every screen open
    // stops being special and starts being an obstacle.
    let seen = false;
    try { seen = !!sessionStorage.getItem(seenKey(id)) || !!localStorage.getItem(seenKey(id)); } catch { /* ignore */ }
    if (seen) return;
    let alive = true;
    loader().then((m) => { if (alive) setComp(() => (m.default || m)); }).catch(() => {});
    return () => { alive = false; };
  }, [id, loader]);

  function done() {
    if (doneRef.current) return;
    doneRef.current = true;
    try { sessionStorage.setItem(seenKey(id), "1"); localStorage.setItem(seenKey(id), "1"); } catch { /* ignore */ }
    setGone(true);
    setTimeout(() => setComp(null), 460); // let the intro's own fade finish
  }

  if (!Comp || !data || gone) return null;
  const Intro = Comp;
  return (
    <Suspense fallback={null}>
      <Intro theme={data} onDone={done} />
    </Suspense>
  );
}
