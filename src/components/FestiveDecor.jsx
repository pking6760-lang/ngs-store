import { useMemo } from "react";

// Falling festive decorations + a greeting ribbon, driven by the active theme.
// Pure emoji (no image assets), pointer-events:none, so it never blocks taps.

const SETS = {
  diyas: ["🪔", "✨", "🪔", "🟡"],
  lanterns: ["🏮", "✨", "🏮"],
  flags: ["🇮🇳", "🧡", "🤍", "💚"],
  tricolor: ["🇮🇳", "🧡", "🤍", "💚"],
  confetti: ["🎉", "🎊", "✨", "🎈"],
  crackers: ["🎆", "🎇", "✨"],
  fireworks: ["🎆", "🎇", "✨"],
  petals: ["🌸", "🌼", "🍃"],
  flowers: ["🌸", "🌼", "🌺"],
  marigold: ["🌼", "🟠", "🌿"],
  rangoli: ["🪔", "🌸", "✨"],
  sparkles: ["✨", "⭐", "🌟"],
  snow: ["❄️", "🌨️", "✨"],
  leaves: ["🍂", "🍁", "🍃"],
  hearts: ["💚", "💛", "❤️"],
  coins: ["🪙", "✨", "💰"], // Dhanteras
  bow: ["🏹", "✨"],          // Dussehra
};
const emojiFor = (name) => SETS[String(name || "").toLowerCase()] || ["✨", "🌟"];

// Deterministic spread so particles don't re-shuffle on every render.
function buildParticles(decoration) {
  const set = emojiFor(decoration);
  const N = 18;
  return Array.from({ length: N }, (_, i) => ({
    ch: set[i % set.length],
    left: (i * 61 + 9) % 100,
    delay: +(((i * 7) % 20) / 2).toFixed(2),
    dur: 7 + (i % 6),
    size: 15 + (i % 4) * 6,
    drift: (i % 2 ? 1 : -1) * (12 + (i % 3) * 10),
    spin: i % 2 ? 1 : -1,
  }));
}

export default function FestiveDecor({ theme }) {
  const decoration = theme?.decoration;
  const on = !!theme?.id && decoration !== "none";
  const particles = useMemo(() => (on ? buildParticles(decoration) : []), [on, decoration]);
  if (!particles.length) return null;
  return (
    <div className="fest-decor" aria-hidden="true">
      {particles.map((p, i) => (
        <span
          key={i}
          className="fest-p"
          style={{
            left: p.left + "%",
            animationDelay: p.delay + "s",
            animationDuration: p.dur + "s",
            fontSize: p.size + "px",
            "--drift": p.drift + "px",
            "--spin": p.spin,
          }}
        >
          {p.ch}
        </span>
      ))}
    </div>
  );
}

// A slim festive greeting at the top of home. For a multi-colour festival
// (Independence Day, Republic Day, Holi…) the theme carries a `stripe` array,
// so we frame the greeting with a real tricolour flag-band above and below and
// keep the greeting itself on a solid, readable colour.
export function FestiveRibbon({ theme }) {
  if (!theme?.id) return null;
  const b = theme.banner || {};
  const c = theme.colors || {};
  const lead = theme.greeting || b.kicker;
  const sub = b.title || b.subtitle;
  if (!lead && !sub) return null;
  const badge = theme.emoji || "✨";
  const stripe = Array.isArray(c.stripe) ? c.stripe.filter(Boolean) : [];
  const tricolor = stripe.length >= 2;
  const ribbonStyle = tricolor ? { background: c.primary || c.headerFrom || "#12306e" } : undefined;
  const band = <div className="fest-stripe" style={{ background: "var(--fest-stripe)" }} aria-hidden="true" />;
  return (
    <div className="fest-greet">
      {tricolor && band}
      <div className="fest-ribbon" style={ribbonStyle} role="note">
        <span className="fest-ribbon-badge">{badge}</span>
        <span className="fest-ribbon-txt">
          {lead && <strong>{lead}</strong>}
          {sub && <em>{sub}</em>}
        </span>
        <span className="fest-ribbon-badge">{badge}</span>
      </div>
      {tricolor && band}
    </div>
  );
}
