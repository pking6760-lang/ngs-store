import { useEffect, useRef, useState } from "react";

// Pull-to-refresh for the customer home (body/window scroll). Kept deliberately
// minimal — a single clean spinner that appears just BELOW the header (never
// over the logo), winds up as you pull, spins while refreshing and shows a
// brief tick when done. No text labels. Bows out of horizontal product-row
// swipes and any time an overlay is open.
const THRESHOLD = 70; // px pulled (after resistance) to arm a refresh
const MAX = 96;       // clamp so it can't be dragged arbitrarily far

const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ } };

export default function PullToRefresh({ onRefresh, disabled }) {
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState("idle"); // idle | pulling | ready | busy | done
  const [top, setTop] = useState(150);         // sits just below the header
  const s = useRef({ y: 0, x: 0, active: false, pull: 0, phase: "idle", crossed: false, disabled });
  s.current.disabled = disabled;

  useEffect(() => {
    const st = s.current;
    const set = (p) => { if (st.phase !== "busy" && st.phase !== "done") { st.phase = p; setPhase(p); } };

    const onStart = (e) => {
      if (st.disabled || st.phase === "busy" || (window.scrollY || 0) > 0) { st.active = false; return; }
      // Anchor the spinner just under whatever the header currently is (its
      // height varies with the store-closed banner etc.), so it never overlaps.
      const sb = document.querySelector(".searchbar");
      if (sb) setTop(Math.round(sb.getBoundingClientRect().bottom) + 8);
      st.y = e.touches[0].clientY; st.x = e.touches[0].clientX; st.active = true; st.crossed = false;
    };
    const onMove = (e) => {
      if (!st.active) return;
      const dy = e.touches[0].clientY - st.y;
      const dx = e.touches[0].clientX - st.x;
      if (dy <= 0 || (window.scrollY || 0) > 2 || Math.abs(dx) > dy) {
        st.active = false; st.pull = 0; setPull(0); set("idle"); return;
      }
      e.preventDefault(); // suppress the browser's own overscroll while pulling
      const d = Math.min(MAX, dy * 0.55); // rubber-band resistance
      st.pull = d; setPull(d);
      const ready = d >= THRESHOLD;
      if (ready && !st.crossed) { st.crossed = true; buzz(12); }
      if (!ready && st.crossed) st.crossed = false;
      set(ready ? "ready" : "pulling");
    };
    const finish = () => {
      if (!st.active) return; st.active = false;
      if (st.pull >= THRESHOLD && st.phase !== "busy") {
        st.phase = "busy"; setPhase("busy"); buzz(8);
        Promise.resolve(onRefresh?.()).finally(() => {
          st.phase = "done"; setPhase("done");
          window.setTimeout(() => { st.phase = "idle"; setPhase("idle"); st.pull = 0; setPull(0); }, 600);
        });
      } else {
        st.pull = 0; setPull(0); set("idle");
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", finish, { passive: true });
    window.addEventListener("touchcancel", finish, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", finish);
      window.removeEventListener("touchcancel", finish);
    };
  }, [onRefresh]);

  const busy = phase === "busy", done = phase === "done";
  const active = pull > 0 || busy || done;
  const prog = Math.min(1, pull / THRESHOLD);
  const rot = prog * 300;                       // arrow winds up before it spins
  const scale = busy || done ? 1 : 0.5 + 0.5 * prog;
  const dropY = active ? 0 : -10;

  return (
    <div
      className={`ptr ${busy ? "ptr--busy" : ""} ${done ? "ptr--done" : ""}`}
      style={{
        top,
        transform: `translateX(-50%) translateY(${dropY}px) scale(${scale})`,
        opacity: active ? 1 : 0,
        transition: s.current.active ? "opacity .15s ease" : "transform .3s cubic-bezier(.16,1,.3,1), opacity .25s ease",
      }}
      aria-hidden={!active}
    >
      <span className="ptr-ring" style={{ transform: busy ? undefined : `rotate(${rot}deg)` }}>
        {done ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v5h-5" /></svg>
        )}
      </span>
    </div>
  );
}
