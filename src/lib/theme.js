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
const FEST_VARS = ["--fest-header-from", "--fest-header-to", "--fest-accent", "--fest-stripe", "--fest-stripe-v", "--fest-ribbon", "--fest-pattern"];

// A faint, tasteful festival texture (a 4-point sparkle + dot grid) tinted with
// the theme's accent. Applied app-wide as a background watermark so every page
// and drawer shares one festive canvas — subtle enough that text stays clean.
function festPattern(color) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='46' height='46' viewBox='0 0 46 46'>` +
    `<g fill='${color}' opacity='0.06'>` +
    `<path d='M23 8 L26 20 L23 32 L20 20 Z'/>` +
    `<path d='M8 23 L20 20 L38 23 L20 26 Z'/>` +
    `<circle cx='23' cy='1.5' r='1.3'/><circle cx='1.5' cy='23' r='1.3'/>` +
    `<circle cx='44.5' cy='23' r='1.3'/><circle cx='23' cy='44.5' r='1.3'/>` +
    `</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// A hard-stop gradient from a list of colours → a crisp banded strip (flag,
// festive bunting, rangoli edge…). Used for the thin band under the header.
export function stripeGradient(colors, angle = "90deg") {
  const n = colors.length;
  if (!n) return "";
  const stops = colors.map((col, i) => `${col} ${((i / n) * 100).toFixed(3)}% ${(((i + 1) / n) * 100).toFixed(3)}%`);
  return `linear-gradient(${angle}, ${stops.join(", ")})`;
}
// A smooth blend across the palette → the festive ribbon background.
export function blendGradient(colors, angle = "100deg") {
  if (!colors.length) return "";
  return `linear-gradient(${angle}, ${colors.join(", ")})`;
}
// Every festival's colours: an explicit `palette`, else the flag-style
// `stripe` (back-compat), else built from primary+accent so even a minimal
// theme still reads as multi-colour.
export function themePalette(c = {}) {
  const p = Array.isArray(c.palette) ? c.palette.filter(Boolean)
          : Array.isArray(c.stripe) ? c.stripe.filter(Boolean) : [];
  if (p.length >= 2) return p;
  const built = [c.primary, c.accent, c.primaryDark || c.accentDeep].filter(Boolean);
  return built.length >= 2 ? built : [];
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

  // EVERY festival is multi-colour: its palette drives a colour band under the
  // header (on every screen) and the festive greeting ribbon. Falls back to a
  // primary→accent blend so even a minimal theme still looks multi-colour.
  const palette = themePalette(c);
  if (palette.length >= 2) {
    el.style.setProperty("--fest-stripe", stripeGradient(palette));        // horizontal band
    el.style.setProperty("--fest-stripe-v", stripeGradient(palette, "180deg")); // vertical (section bars)
    el.style.setProperty("--fest-ribbon", blendGradient(palette));         // ribbon blend
  } else {
    const grad = via ? `linear-gradient(100deg, ${from}, ${via}, ${to})` : `linear-gradient(100deg, ${from}, ${to})`;
    if (from) el.style.setProperty("--fest-ribbon", grad);
  }

  // App-wide festive texture, tinted with the accent (or a palette colour).
  const patColor = c.accent || palette[1] || c.primary || "";
  if (patColor) el.style.setProperty("--fest-pattern", festPattern(patColor));

  el.setAttribute("data-festival", t.decoration || "on");
}
