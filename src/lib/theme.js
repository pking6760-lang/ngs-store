// Paints a pasted festival theme onto the running customer app.
//
// The app's brand colours are CSS custom properties used hundreds of times
// (var(--green), var(--green-dark), var(--yellow)…). Setting those same
// properties inline on <html> overrides every :root block, so a single call
// here re-skins the whole app — header, buttons, chips, prices, everything —
// with no per-component work. We also expose a few --fest-* vars for the
// festive chrome (greeting ribbon, decorations) and flag a data-festival
// attribute for optional CSS touches.

const root = () => (typeof document !== "undefined" ? document.documentElement : null);

// theme.colors key → the app CSS variables it should drive.
const VAR_MAP = {
  primary:     ["--green"],
  primaryDark: ["--green-dark"],
  accent:      ["--yellow", "--gold"],
  accentDeep:  ["--gold-deep"],
  tint:        ["--green-tint", "--gold-tint"],
  bg:          ["--bg-soft"],
};
const FEST_VARS = ["--fest-header-from", "--fest-header-to", "--fest-accent", "--fest-stripe", "--fest-ribbon"];

// A hard-stop gradient from a list of colours → a crisp flag-like band.
export function stripeGradient(colors, angle = "90deg") {
  const n = colors.length;
  if (!n) return "";
  const stops = colors.map((col, i) => `${col} ${((i / n) * 100).toFixed(3)}% ${(((i + 1) / n) * 100).toFixed(3)}%`);
  return `linear-gradient(${angle}, ${stops.join(", ")})`;
}

let applied = []; // brand vars we overrode, so we can revert cleanly

export function applyTheme(t) {
  const el = root();
  if (!el) return;

  // Revert whatever the previous theme set.
  applied.forEach((v) => el.style.removeProperty(v));
  FEST_VARS.forEach((v) => el.style.removeProperty(v));
  el.removeAttribute("data-festival");
  applied = [];

  if (!t || !t.id) return; // no active theme → back to the default green look

  const c = t.colors || {};
  Object.entries(VAR_MAP).forEach(([key, vars]) => {
    const val = c[key];
    if (val) vars.forEach((v) => { el.style.setProperty(v, val); applied.push(v); });
  });

  const from = c.headerFrom || c.primary || "";
  const via = c.headerVia || "";
  const to = c.headerTo || c.primaryDark || c.primary || "";
  if (from) el.style.setProperty("--fest-header-from", from);
  if (to) el.style.setProperty("--fest-header-to", to);
  if (c.accent) el.style.setProperty("--fest-accent", c.accent);

  // Multi-colour festivals (Independence Day, Republic Day, Holi…) carry a
  // `stripe` array → a real tricolour band under the header + a matching ribbon.
  const stripe = Array.isArray(c.stripe) ? c.stripe.filter(Boolean) : [];
  if (stripe.length >= 2) {
    el.style.setProperty("--fest-stripe", stripeGradient(stripe));
    // Ribbon becomes the tricolour band (softened) so it reads as the flag.
    el.style.setProperty("--fest-ribbon", stripeGradient(stripe, "100deg"));
  } else {
    // Single-colour festivals: ribbon is the header gradient (2 or 3 stops).
    const grad = via ? `linear-gradient(100deg, ${from}, ${via}, ${to})` : `linear-gradient(100deg, ${from}, ${to})`;
    if (from) el.style.setProperty("--fest-ribbon", grad);
  }

  el.setAttribute("data-festival", t.decoration || "on");
}
