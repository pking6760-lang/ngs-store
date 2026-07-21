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
const FEST_VARS = ["--fest-header-from", "--fest-header-to", "--fest-accent", "--fest-stripe", "--fest-stripe-v", "--fest-ribbon", "--fest-pattern", "--fest-pattern-size"];

// A festival-SPECIFIC background motif, scattered sparsely and faintly across
// the whole app (every page + drawer). Each festival gets its own character —
// Holi = colour splashes, flag days = little tricolour flags, Diwali = diyas,
// Dhanteras = coins, and so on — never a generic texture. Kept subtle enough
// that content stays perfectly readable.
function uriOf(svg) { return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`; }
function festPattern(kind, palette, accent) {
  const p = palette && palette.length ? palette : [accent || "#F5B301"];
  const col = (i) => p[i % p.length];
  const dot = (x, y, r, c, o) => `<circle cx='${x}' cy='${y}' r='${r}' fill='${c}' opacity='${o}'/>`;
  let S = 200, inner = "";

  if (kind === "splash") {
    // Holi: soft paint splats + droplets, a few palette colours, here & there.
    const splat = (cx, cy, R, c) => {
      let s = dot(cx, cy, R, c, 0.11);
      for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.283; s += dot((cx + Math.cos(a) * (R + 5 + (k % 3) * 5)).toFixed(1), (cy + Math.sin(a) * (R + 5 + (k % 3) * 5)).toFixed(1), (2.4 - (k % 2)).toFixed(1), c, 0.11); }
      return s;
    };
    inner = splat(46, 52, 15, col(0)) + splat(150, 74, 12, col(1)) + splat(98, 150, 17, col(2)) + splat(172, 168, 9, col(3));
  } else if (kind === "flags" || kind === "tricolor") {
    // Flag days: small waving tricolour flags scattered.
    const c1 = p[0], c2 = p[1] || "#ffffff", c3 = p[2] || p[0];
    const flag = (x, y, s, rot) =>
      `<g transform='translate(${x} ${y}) rotate(${rot})' opacity='0.17'>` +
      `<line x1='0' y1='0' x2='0' y2='${(s * 1.4).toFixed(1)}' stroke='#8a744a' stroke-width='1'/>` +
      `<rect x='0' y='0' width='${s}' height='${(s / 3).toFixed(1)}' fill='${c1}'/>` +
      `<rect x='0' y='${(s / 3).toFixed(1)}' width='${s}' height='${(s / 3).toFixed(1)}' fill='${c2}'/>` +
      `<rect x='0' y='${(s * 2 / 3).toFixed(1)}' width='${s}' height='${(s / 3).toFixed(1)}' fill='${c3}'/></g>`;
    inner = flag(30, 34, 20, -8) + flag(142, 58, 15, 7) + flag(78, 150, 22, -5) + flag(168, 150, 13, 10);
  } else if (kind === "diyas") {
    // Diwali: small diyas with a flame + a couple of sparkles.
    const flame = p[Math.min(2, p.length - 1)];
    const diya = (x, y, s, c) =>
      `<g transform='translate(${x} ${y})' opacity='0.13'>` +
      `<path d='M${-s} 0 Q0 ${(s * 0.85).toFixed(1)} ${s} 0 Z' fill='${c}'/>` +
      `<path d='M0 -1 q ${(s * 0.28).toFixed(1)} ${(-s * 0.55).toFixed(1)} 0 ${(-s * 1.1).toFixed(1)} q ${(-s * 0.28).toFixed(1)} ${(s * 0.55).toFixed(1)} 0 ${(s * 1.1).toFixed(1)}' fill='${flame}'/></g>`;
    const spark = (x, y, r, c) => `<path d='M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z' fill='${c}' opacity='0.14'/>`;
    inner = diya(48, 62, 15, col(0)) + diya(152, 150, 13, col(1)) + spark(150, 48, 6, col(2)) + spark(50, 150, 5, col(2)) + spark(112, 104, 4, col(1));
  } else if (kind === "coins") {
    // Dhanteras: gold coins.
    const coin = (x, y, r, c) => `<g opacity='0.15'><circle cx='${x}' cy='${y}' r='${r}' fill='none' stroke='${c}' stroke-width='2'/><circle cx='${x}' cy='${y}' r='${r - 4}' fill='${c}' opacity='0.5'/></g>`;
    inner = coin(52, 56, 14, col(0)) + coin(150, 150, 12, col(1)) + coin(150, 54, 8, col(0)) + coin(54, 150, 9, col(1));
  } else if (kind === "petals" || kind === "flowers") {
    // Flower festivals: little scattered blooms.
    const bloom = (x, y, s, c) => { let g = `<g opacity='0.13'>`; for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.283; g += `<ellipse cx='${(x + Math.cos(a) * s).toFixed(1)}' cy='${(y + Math.sin(a) * s).toFixed(1)}' rx='${(s * 0.7).toFixed(1)}' ry='${(s * 0.34).toFixed(1)}' fill='${c}' transform='rotate(${(a * 57.3).toFixed(0)} ${(x + Math.cos(a) * s).toFixed(1)} ${(y + Math.sin(a) * s).toFixed(1)})'/>`; } g += dot(x, y, s * 0.5, p[1] || c, 1) + `</g>`; return g; };
    inner = bloom(52, 58, 9, col(0)) + bloom(150, 150, 8, col(1)) + bloom(150, 56, 6, col(2)) + bloom(54, 150, 7, col(0));
  } else {
    // Default: faint 4-point sparkles + dot grid.
    S = 46;
    const c = accent || p[0];
    inner = `<g fill='${c}' opacity='0.06'><path d='M23 8 L26 20 L23 32 L20 20 Z'/><path d='M8 23 L20 20 L38 23 L20 26 Z'/><circle cx='23' cy='1.5' r='1.3'/><circle cx='1.5' cy='23' r='1.3'/><circle cx='44.5' cy='23' r='1.3'/><circle cx='23' cy='44.5' r='1.3'/></g>`;
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${S}' height='${S}' viewBox='0 0 ${S} ${S}'>${inner}</svg>`;
  return { uri: uriOf(svg), size: `${S}px ${S}px` };
}

// Which background motif suits the festival, unless the theme names one.
function pickPattern(t) {
  if (t.pattern) return t.pattern;
  const d = t.decoration;
  if (d === "tricolor" || d === "flags") return "flags";
  if (d === "marigold") return "diyas";
  return "sparkles";
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
// `stripe` (back-compat), else built from primary+accent. Capped at 3 MAIN
// colours — a clean tricolour-style band, never a busy 4-5 colour smear.
export function themePalette(c = {}) {
  const p = Array.isArray(c.palette) ? c.palette.filter(Boolean)
          : Array.isArray(c.stripe) ? c.stripe.filter(Boolean) : [];
  if (p.length >= 2) return p.slice(0, 3);
  const built = [c.primary, c.accent, c.primaryDark || c.accentDeep].filter(Boolean);
  return built.length >= 2 ? built.slice(0, 3) : [];
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

  // App-wide festival-specific background motif (Holi splashes, flags, diyas…).
  const pat = festPattern(pickPattern(t), palette, c.accent || palette[1] || c.primary || "");
  el.style.setProperty("--fest-pattern", pat.uri);
  el.style.setProperty("--fest-pattern-size", pat.size);

  el.setAttribute("data-festival", t.decoration || "on");
}
