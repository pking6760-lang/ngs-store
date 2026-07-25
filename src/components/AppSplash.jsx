import { useEffect, useState } from "react";
import { randMs } from "../lib/ux.js";
import { endBootSplash } from "../lib/bootsplash.js";

// The opening moment. A brand mark settles in, the wordmark rises letter by
// letter, a hairline draws out beneath it, and a progress bar sweeps — then the
// whole thing lifts away. Themed per app (customer green, admin indigo,
// partner red/black).

// The shared NGS "N" monogram — identical to the one in admin/BrandMark.jsx so
// the splash and the in-app header show the same letterform.
const N_PATH =
  "M19 45.5 V21 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 .8.4 L37.8 37 V21 a1 1 0 0 1 1-1 h3.2 a1 1 0 0 1 1 1 v23.5 a1 1 0 0 1-1 1 h-4 a1 1 0 0 1-.8-.4 L26.2 29 v16.5 a1 1 0 0 1-1 1 H20 a1 1 0 0 1-1-1 z";

// Each app carries its own cue on the N's shoulder, matching its real logo:
// customer = leaf, admin = dashboard grid, partner = delivery pin. The leaf is
// the customer brand only — it must never show up on the internal apps.
function MarkCue({ variant }) {
  if (variant === "admin") {
    return (
      <g className="sm-cue sm-dots">
        <rect x="43.5" y="13" width="4.6" height="4.6" rx="1.3" />
        <rect x="49.6" y="13" width="4.6" height="4.6" rx="1.3" />
        <rect x="43.5" y="19.1" width="4.6" height="4.6" rx="1.3" />
        <rect x="49.6" y="19.1" width="4.6" height="4.6" rx="1.3" />
      </g>
    );
  }
  if (variant === "partner") {
    return (
      <g className="sm-cue sm-pin">
        <path d="M49 11 c3.6 0 6.5 2.9 6.5 6.5 c0 4.4 -6.5 10 -6.5 10 s-6.5 -5.6 -6.5 -10 c0 -3.6 2.9 -6.5 6.5 -6.5 z" />
        <circle className="sm-pin-hole" cx="49" cy="17.4" r="2.3" />
      </g>
    );
  }
  return (
    <path
      className="sm-cue sm-leaf"
      d="M43.5 19.2 c1.2 -4.4 5 -6.7 9.3 -6.4 c.4 4.3 -2.2 8.4 -6.6 9.1 c-1 .16 -2 .12 -2.9 -.1 z"
    />
  );
}

function SplashMark({ variant }) {
  return (
    <svg className="splash-mark" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="spTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,.24)" />
          <stop offset="1" stopColor="rgba(255,255,255,.06)" />
        </linearGradient>
      </defs>
      <rect className="sm-tile" width="64" height="64" rx="17" fill="url(#spTile)" />
      <path className="sm-n" d={N_PATH} />
      <MarkCue variant={variant} />
    </svg>
  );
}

export default function AppSplash({ variant = "customer", brand = "NGS", tagline = "" }) {
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), randMs(1500, 2100));
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => { setGone(true); endBootSplash(); }, 700); // matches the fade-out
    return () => clearTimeout(t);
  }, [leaving]);

  if (gone) return null;
  return (
    <div className={`splash splash-${variant} ${leaving ? "leaving" : ""}`}>
      <div className="splash-glow" aria-hidden="true" />
      <div className="splash-inner">
        <SplashMark variant={variant} />
        <div className="splash-logo">
          {brand.split("").map((c, i) => (
            <span key={i} style={{ animationDelay: `${0.3 + i * 0.075}s` }}>{c}</span>
          ))}
        </div>
        {tagline && <div className="splash-tag">{tagline}</div>}
        <div className="splash-rule" aria-hidden="true" />
        <div className="splash-bar"><span /></div>
      </div>
    </div>
  );
}
