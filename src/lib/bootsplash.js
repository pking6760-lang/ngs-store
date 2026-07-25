import { useEffect, useState } from "react";

// The opening AppSplash is rendered as a sibling overlay, so the app underneath
// keeps mounting behind it. Without this, a screen that shows its own "loading…"
// placeholder appears the instant the splash lifts — the user sees two loading
// screens back to back. Anything with a boot placeholder asks here first and
// stays blank while the splash is still covering the screen.
let up = true;
const subs = new Set();

function set(v) {
  if (up === v) return;
  up = v;
  subs.forEach((f) => f(v));
}

export function endBootSplash() {
  set(false);
}

// Safety net: if no AppSplash ever mounts (a different entry point, or it is
// skipped), never leave the app stuck behind an invisible boot flag.
if (typeof window !== "undefined") setTimeout(() => set(false), 4000);

export function useBootSplashUp() {
  const [v, setV] = useState(up);
  useEffect(() => {
    subs.add(setV);
    setV(up);
    return () => { subs.delete(setV); };
  }, []);
  return v;
}
