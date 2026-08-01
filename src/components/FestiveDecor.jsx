import { themePalette } from "../lib/theme.js";
import IndependenceDayBanner from "./festive-banners/IndependenceDayBanner.jsx";

// Bespoke, hand-crafted banner scenes — each a genuinely different design, not a
// recoloured template. Matched by a keyword in the festival name; festivals
// without a bespoke scene fall back to the composed poster below.
const BANNERS = [
  { key: "independence", Comp: IndependenceDayBanner },
];
function bespokeBanner(theme) {
  const name = String(theme?.name || "").toLowerCase();
  const hit = BANNERS.find((b) => name.includes(b.key));
  return hit ? hit.Comp : null;
}

// ── Decorative garland (toran / bunting) ───────────────────────────────────
function garlandUri(palette, kind) {
  const cols = (palette && palette.length ? palette : ["#C21807", "#FF7A00", "#FFC300"]).slice(0, 5);
  const n = cols.length;
  const uw = 52, H = 52, W = uw * n;
  const cord = "rgba(255,255,255,.55)";
  const flags = kind === "flags" || kind === "tricolor" || kind === "bunting" || kind === "leaves";
  const parts = [];
  let d = "M0 9";
  for (let i = 0; i < n; i++) d += ` Q ${i * uw + uw / 2} 19 ${(i + 1) * uw} 9`;
  parts.push(`<path d="${d}" fill="none" stroke="${cord}" stroke-width="1.6"/>`);
  for (let i = 0; i < n; i++) {
    const cx = i * uw + uw / 2, col = cols[i];
    if (flags) {
      parts.push(`<circle cx="${cx}" cy="13" r="2.2" fill="${cord}"/>`);
      parts.push(`<path d="M ${cx - 12} 14 L ${cx + 12} 14 L ${cx} 40 Z" fill="${col}" stroke="rgba(0,0,0,.12)" stroke-width="1"/>`);
      parts.push(`<path d="M ${cx - 12} 14 L ${cx + 12} 14 L ${cx + 8} 20 L ${cx - 8} 20 Z" fill="rgba(255,255,255,.25)"/>`);
    } else {
      const fy = 33, fr = 8;
      parts.push(`<line x1="${cx}" y1="11" x2="${cx}" y2="22" stroke="${cord}" stroke-width="1.4"/>`);
      parts.push(`<ellipse cx="${cx - 7}" cy="17" rx="5" ry="2.6" fill="#2f7d32" transform="rotate(-28 ${cx - 7} 17)"/>`);
      parts.push(`<ellipse cx="${cx + 7}" cy="17" rx="5" ry="2.6" fill="#2f7d32" transform="rotate(28 ${cx + 7} 17)"/>`);
      for (let p = 0; p < 9; p++) {
        const a = (p / 9) * 2 * Math.PI;
        parts.push(`<circle cx="${(cx + Math.cos(a) * fr).toFixed(1)}" cy="${(fy + Math.sin(a) * fr).toFixed(1)}" r="4.4" fill="${col}"/>`);
      }
      parts.push(`<circle cx="${cx}" cy="${fy}" r="6" fill="${col}"/>`);
      parts.push(`<circle cx="${cx}" cy="${fy}" r="3.1" fill="#ffd24a"/>`);
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>${parts.join("")}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ── Ornamental backdrop motifs (drawn from the palette, sit behind the title) ─
function ringDots(cx, cy, r, n, rot, fill, pr, op) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI + rot;
    s += `<circle cx='${(cx + Math.cos(a) * r).toFixed(1)}' cy='${(cy + Math.sin(a) * r).toFixed(1)}' r='${pr}' fill='${fill}' opacity='${op}'/>`;
  }
  return s;
}
function motifSvg(kind, palette) {
  const p = palette.length ? palette : ["#ffffff"];
  const a = p[0], b = p[1] || a, c = p[2] || b, light = "rgba(255,255,255,.9)";
  let inner = "";
  if (kind === "rays") {
    for (let i = 0; i < 28; i++)
      inner += `<rect x='99.4' y='2' width='1.2' height='98' fill='${light}' opacity='${i % 2 ? 0.28 : 0.12}' transform='rotate(${(i / 28) * 360} 100 100)'/>`;
    inner += `<circle cx='100' cy='100' r='30' fill='none' stroke='${light}' stroke-width='1.4' opacity='.5'/>`;
  } else if (kind === "arch") {
    inner =
      `<path d='M40 190 V96 a60 60 0 0 1 120 0 V190' fill='none' stroke='${light}' stroke-width='2' opacity='.55'/>` +
      `<path d='M52 190 V96 a48 48 0 0 1 96 0 V190' fill='none' stroke='${b}' stroke-width='1.3' opacity='.45'/>` +
      ringDots(100, 96, 60, 22, 0, light, 2, 0.4);
  } else {
    // mandala / rangoli (default)
    inner =
      `<circle cx='100' cy='100' r='90' fill='none' stroke='${light}' stroke-width='1.3' opacity='.4'/>` +
      `<circle cx='100' cy='100' r='68' fill='none' stroke='${b}' stroke-width='1' opacity='.4'/>` +
      ringDots(100, 100, 82, 24, 0, light, 3, 0.45) +
      ringDots(100, 100, 60, 16, 0.2, a, 4.5, 0.5) +
      ringDots(100, 100, 38, 12, 0, c, 4, 0.55) +
      `<circle cx='100' cy='100' r='15' fill='none' stroke='${light}' stroke-width='1.4' opacity='.5'/>`;
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'>${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Which backdrop suits the festival, unless the theme names one explicitly.
function pickMotif(theme) {
  if (theme.motif) return theme.motif;
  const d = theme.decoration;
  if (d === "tricolor" || d === "flags" || d === "leaves") return "rays";
  return "mandala";
}

// An ornamental divider glyph, varied so festivals don't feel identical.
const DIVIDERS = ["✦", "❖", "✵", "❁", "◆"];
function dividerFor(theme) {
  const key = (theme.name || theme.id || "").toString();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 997;
  return DIVIDERS[h % DIVIDERS.length];
}

// ── The festive masthead: garland + an integrated, composed poster ──────────
// Full-bleed (not a floating card), with an ornamental backdrop chosen per
// festival, editorial typography and corner flourishes — so each festival is a
// genuinely different, designed poster rather than a colour swap.
export function FestiveMasthead({ theme }) {
  if (!theme?.id) return null;
  // A bespoke scene wins over the generic poster when this festival has one.
  const Bespoke = bespokeBanner(theme);
  if (Bespoke) return <Bespoke theme={{ ...theme, palette: themePalette(theme.colors || {}) }} />;
  const b = theme.banner || {};
  const c = theme.colors || {};
  const greeting = theme.greeting || b.kicker;
  const kicker = b.kicker && b.kicker !== greeting ? b.kicker : theme.name;
  const sub = b.title || b.subtitle;
  if (!greeting && !sub) return null;
  const palette = themePalette(c);
  const multi = palette.length >= 2;
  const motif = pickMotif(theme);
  const div = dividerFor(theme);
  return (
    <div className={`fest-mast motif-${motif}`} role="banner">
      {multi && (
        <div className="fest-mast-garland" aria-hidden="true"
          style={{ backgroundImage: garlandUri(palette, theme.decoration) }} />
      )}
      <div className="fest-poster">
        <span className="fest-poster-motif" aria-hidden="true"
          style={{ backgroundImage: motifSvg(motif, palette) }} />
        <span className="fest-poster-corner tl" aria-hidden="true" />
        <span className="fest-poster-corner tr" aria-hidden="true" />
        <span className="fest-poster-corner bl" aria-hidden="true" />
        <span className="fest-poster-corner br" aria-hidden="true" />
        <div className="fest-poster-in">
          {theme.emoji && <span className="fest-poster-emblem">{theme.emoji}</span>}
          {kicker && <span className="fest-poster-kicker">{kicker}</span>}
          {greeting && <h2 className="fest-poster-title">{greeting}</h2>}
          <span className="fest-poster-div"><i /><b>{div}</b><i /></span>
          {sub && <p className="fest-poster-sub">{sub}</p>}
        </div>
      </div>
    </div>
  );
}
