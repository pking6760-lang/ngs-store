import { useEffect, useState } from "react";
import { randMs } from "../lib/ux.js";

// A branded opening moment. Shows full-screen while the app boots behind it,
// then fades away — a randomised beat so it never feels mechanical. Themed per
// app (customer green, admin indigo, partner red/black).
export default function AppSplash({ variant = "customer", brand = "NGS", tagline = "" }) {
  const [gone, setGone] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), randMs(1400, 2200));
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setGone(true), 620); // matches the fade-out
    return () => clearTimeout(t);
  }, [leaving]);

  if (gone) return null;
  return (
    <div className={`splash splash-${variant} ${leaving ? "leaving" : ""}`}>
      <div className="splash-inner">
        <div className="splash-logo">
          {brand.split("").map((c, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.09}s` }}>{c}</span>
          ))}
        </div>
        {tagline && <div className="splash-tag">{tagline}</div>}
        <div className="splash-bar"><span /></div>
      </div>
    </div>
  );
}
