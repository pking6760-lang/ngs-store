// Registry of per-festival intro animations.
//
// Each festival gets its OWN bespoke, full-screen intro component — generated
// from the "Festive Intro" AI prompt (see docs/festive-intro-prompt.md) and
// dropped into this folder. Register it here by the theme's id (or a keyword its
// name contains) and it plays automatically when that festival's theme is live.
//
// A component MUST default-export  function FestiveIntro({ theme, onDone })  and
// be fully self-contained (React only, no app imports). See the prompt for the
// exact contract.
//
// To add one:
//   1. Save the generated file here, e.g.  ./diwali.jsx
//   2. Add a line below:  diwali: () => import("./diwali.jsx"),
// That's it — the slot picks it up.

// id / keyword  →  lazy import of the component module (default export)
const INTROS = {
  independence: () => import("./independence-day.jsx"),
  // diwali:           () => import("./diwali.jsx"),
  // holi:             () => import("./holi.jsx"),
  // dhanteras:        () => import("./dhanteras.jsx"),
  // rakhi:            () => import("./rakhi.jsx"),
};

// Resolve the best intro for a theme: exact id first, then a keyword contained in
// the id or name (so "independence_day_2026" still matches "independence"). Returns
// a lazy import fn, or null if this festival has no bespoke intro yet.
export function resolveIntro(theme) {
  if (!theme) return null;
  const id = String(theme.id || "").toLowerCase();
  const name = String(theme.name || "").toLowerCase();
  if (INTROS[id]) return INTROS[id];
  for (const key of Object.keys(INTROS)) {
    if (id.includes(key) || name.includes(key)) return INTROS[key];
  }
  return null;
}
