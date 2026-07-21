import { themePalette } from "../lib/theme.js";

// ── Themed decorative garland (toran / bunting) ────────────────────────────
// Drawn as an SVG from the festival's palette and tiled horizontally, so it
// hangs across the full width at any screen size. Static — it hangs, it doesn't
// fall. Marigold-flower garland for most festivals; flag bunting for flag days.
function garlandUri(palette, kind) {
  const cols = (palette && palette.length ? palette : ["#C21807", "#FF7A00", "#FFC300"]).slice(0, 5);
  const n = cols.length;
  const uw = 52, H = 52, W = uw * n;
  const cord = "rgba(110,66,0,.85)";
  const flags = kind === "flags" || kind === "tricolor" || kind === "bunting" || kind === "leaves";
  const parts = [];
  // The hanging cord: a gentle wave that meets the tile edges at the same height
  // so tiles join seamlessly.
  let d = "M0 9";
  for (let i = 0; i < n; i++) d += ` Q ${i * uw + uw / 2} 19 ${(i + 1) * uw} 9`;
  parts.push(`<path d="${d}" fill="none" stroke="${cord}" stroke-width="2"/>`);
  for (let i = 0; i < n; i++) {
    const cx = i * uw + uw / 2;
    const col = cols[i];
    if (flags) {
      parts.push(`<circle cx="${cx}" cy="13" r="2.2" fill="${cord}"/>`);
      parts.push(`<path d="M ${cx - 12} 14 L ${cx + 12} 14 L ${cx} 40 Z" fill="${col}" stroke="rgba(0,0,0,.10)" stroke-width="1"/>`);
      parts.push(`<path d="M ${cx - 12} 14 L ${cx + 12} 14 L ${cx + 8} 20 L ${cx - 8} 20 Z" fill="rgba(255,255,255,.22)"/>`);
    } else {
      // Marigold: a stem, two leaves and a layered petal flower with a gold centre.
      const fy = 33, fr = 8;
      parts.push(`<line x1="${cx}" y1="11" x2="${cx}" y2="22" stroke="${cord}" stroke-width="1.6"/>`);
      parts.push(`<ellipse cx="${cx - 7}" cy="17" rx="5" ry="2.6" fill="#2f7d32" transform="rotate(-28 ${cx - 7} 17)"/>`);
      parts.push(`<ellipse cx="${cx + 7}" cy="17" rx="5" ry="2.6" fill="#2f7d32" transform="rotate(28 ${cx + 7} 17)"/>`);
      for (let p = 0; p < 9; p++) {
        const a = (p / 9) * 2 * Math.PI;
        const px = (cx + Math.cos(a) * fr).toFixed(1);
        const py = (fy + Math.sin(a) * fr).toFixed(1);
        parts.push(`<circle cx="${px}" cy="${py}" r="4.4" fill="${col}"/>`);
      }
      parts.push(`<circle cx="${cx}" cy="${fy}" r="6" fill="${col}"/>`);
      parts.push(`<circle cx="${cx}" cy="${fy}" r="3.1" fill="#ffd24a"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// The garland strip, hung across the top of the home screen.
export function FestiveToran({ theme }) {
  if (!theme?.id) return null;
  const pal = themePalette(theme.colors || {});
  if (pal.length < 2) return null;
  return (
    <div
      className="fest-toran"
      aria-hidden="true"
      style={{ backgroundImage: garlandUri(pal, theme.decoration) }}
    />
  );
}

// A premium festival hero. No falling emoji — a rich palette gradient, a soft
// glow, an ornamental motif, corner flourishes, an emblem badge and elegant
// typography, finished with a gold/palette trim. The whole-app recolour is
// handled by lib/theme.js; this is the festive centrepiece.
export function FestiveHero({ theme }) {
  if (!theme?.id) return null;
  const b = theme.banner || {};
  const c = theme.colors || {};
  const greeting = theme.greeting || b.kicker;
  const line = b.title || b.subtitle;
  if (!greeting && !line) return null;
  const emblem = theme.emoji || "✨";
  const multi = themePalette(c).length >= 2;
  return (
    <div className={`fest-hero ${multi ? "multi" : ""}`} role="banner">
      <span className="fest-hero-glow" aria-hidden="true" />
      <span className="fest-hero-motif" aria-hidden="true" />
      <span className="fest-hero-corner tl" aria-hidden="true" />
      <span className="fest-hero-corner tr" aria-hidden="true" />
      <div className="fest-hero-in">
        <span className="fest-hero-emblem">{emblem}</span>
        {greeting && <div className="fest-hero-greet">{greeting}</div>}
        {line && <div className="fest-hero-sub">{line}</div>}
      </div>
      <span className="fest-hero-trim" aria-hidden="true" />
    </div>
  );
}
