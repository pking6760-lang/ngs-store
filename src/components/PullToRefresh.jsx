import { useEffect, useRef, useState } from "react";

// Advanced pull-to-refresh for the customer home (body/window scroll). Swipe
// down from the very top: a pill drops in reading "Pull to refresh" → "Release
// to refresh" → "Refreshing…" → "Updated", the arrow winds up as you pull, a
// haptic tick fires when it arms, and a success tick holds briefly so a fast
// refresh still registers. Bows out of horizontal product-row swipes and any
// time an overlay is open.
const THRESHOLD = 70; // px pulled (after resistance) to arm a refresh
const MAX = 96;       // clamp so it can't be dragged arbitrarily far

const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ } };

export default function PullToRefresh({ onRefresh, disabled }) {
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState("idle"); // idle | pulling | ready | busy | done
  // Mutable state the native touch listeners read without re-subscribing.
  const s = useRef({ y: 0, x: 0, active: false, pull: 0, phase: "idle", crossed: false, disabled });
  s.current.disabled = disabled;

  useEffect(() => {
    const st = s.current;
    const set = (p) => { if (st.phase !== "busy" && st.phase !== "done") { st.phase = p; setPhase(p); } };

    const onStart = (e) => {
      if (st.disabled || st.phase === "busy" || (window.scrollY || 0) > 0) { st.active = false; return; }
      st.y = e.touches[0].clientY; st.x = e.touches[0].clientX; st.active = true; st.crossed = false;
    };
    const onMove = (e) => {
      if (!st.active) return;
      const dy = e.touches[0].clientY - st.y;
      const dx = e.touches[0].clientX - st.x;
      // Left the top, pulling up, or a mostly-horizontal swipe → not a refresh.
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
          window.setTimeout(() => { st.phase = "idle"; setPhase("idle"); st.pull = 0; setPull(0); }, 650);
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
  const dist = busy || done ? THRESHOLD * 0.7 : pull;
  const rot = Math.min(1, pull / THRESHOLD) * 300; // arrow wind-up before it spins
  const label = done ? "Updated" : busy ? "Refreshing…" : phase === "ready" ? "Release to refresh" : "Pull to refresh";

  return (
    <div
      className={`ptr ${busy ? "ptr--busy" : ""} ${done ? "ptr--done" : ""}`}
      style={{
        transform: `translateX(-50%) translateY(${dist - 52}px)`,
        opacity: dist > 4 || busy || done ? 1 : 0,
        transition: s.current.active ? "none" : "transform .3s cubic-bezier(.16,1,.3,1), opacity .2s ease",
      }}
      aria-hidden={dist === 0 && !busy && !done}
    >
      <span className="ptr-ring" style={{ transform: busy ? undefined : `rotate(${rot}deg)` }}>
        {done ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v5h-5" /></svg>
        )}
      </span>
      <span className="ptr-lbl">{label}</span>
    </div>
  );
}
