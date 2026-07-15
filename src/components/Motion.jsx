import { useEffect, useState } from "react";
import { randMs } from "../lib/ux.js";

// Show a brief loading state whenever `dep` changes (page/tab switch), so every
// navigation gets a themed loading beat before the content fades in.
export function useReveal(dep, min = 320, max = 720) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), randMs(min, max));
    return () => clearTimeout(t);
  }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps
  return loading;
}

// Centered themed spinner for a page/tab transition.
export function PageLoad({ variant = "customer", text = "Loading" }) {
  return (
    <div className={`pageload v-${variant}`}>
      <div className="pl-ring" />
      <div className="pl-txt">{text}</div>
    </div>
  );
}

// Full-screen overlay: a "processing" spinner or a "success" checkmark burst.
export function ActionOverlay({ variant = "customer", mode = "processing", title, sub, accent }) {
  const style = accent ? { "--ov-accent": accent } : undefined;
  return (
    <div className={`ov ov-${variant}`}>
      <div className="ov-card" style={style}>
        {mode === "success" ? (
          <svg className="ov-check" viewBox="0 0 72 72" aria-hidden="true">
            <circle cx="36" cy="36" r="27" />
            <path d="M23 37 l9 9 l17 -19" />
          </svg>
        ) : (
          <div className="ov-ring" />
        )}
        {title && <h3>{title}</h3>}
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}
