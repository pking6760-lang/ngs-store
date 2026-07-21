import { themePalette } from "../lib/theme.js";

// A premium festival hero shown at the top of home. No falling emoji, no
// gimmicks — a rich palette gradient, a soft light glow, a subtle motif
// texture, an emblem badge and elegant typography, finished with a gold/palette
// trim. The whole-app recolour (buttons, chips, badges, header band) is handled
// by lib/theme.js; this is the festive centrepiece.
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
      <div className="fest-hero-in">
        <span className="fest-hero-emblem">{emblem}</span>
        {greeting && <div className="fest-hero-greet">{greeting}</div>}
        {line && <div className="fest-hero-sub">{line}</div>}
      </div>
      <span className="fest-hero-trim" aria-hidden="true" />
    </div>
  );
}
