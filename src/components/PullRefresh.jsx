import { useEffect, useRef, useState } from "react";

// Advanced pull-to-refresh for INNER scroll containers (admin & partner shells,
// whose content scrolls inside a fixed frame rather than the window). The
// component *becomes* the scroller — pass the scroller's className so it keeps
// the same flex/overflow/padding role. It shows a floating pill that reads
// "Pull to refresh" → "Release to refresh" → "Refreshing…" → "Updated", winds
// the arrow up as you pull, gives a haptic tick at the threshold, and holds a
// success tick briefly so a fast refresh still registers.
const THRESHOLD = 72; // px pulled (after resistance) to arm a refresh
const MAX = 104;      // clamp so it can't be dragged arbitrarily far

const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ } };

export default function PullRefresh({ onRefresh, disabled, className = "", children, tint = "#3B5BDB" }) {
  const scrollRef = useRef(null);
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState("idle"); // idle | pulling | ready | busy | done
  const s = useRef({ y: 0, x: 0, active: false, pull: 0, phase: "idle", crossed: false, disabled });
  s.current.disabled = disabled;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const st = s.current;
    const set = (p) => { if (st.phase !== "busy" && st.phase !== "done") { st.phase = p; setPhase(p); } };

    const onStart = (e) => {
      if (st.disabled || st.phase === "busy" || el.scrollTop > 0) { st.active = false; return; }
      st.y = e.touches[0].clientY; st.x = e.touches[0].clientX; st.active = true; st.crossed = false;
    };
    const onMove = (e) => {
      if (!st.active) return;
      const dy = e.touches[0].clientY - st.y;
      const dx = e.touches[0].clientX - st.x;
      // Left the top, pulling up, or a mostly-horizontal swipe → not a refresh.
      if (dy <= 0 || el.scrollTop > 2 || Math.abs(dx) > dy) {
        st.active = false; st.pull = 0; setPull(0); set("idle"); return;
      }
      e.preventDefault(); // suppress native overscroll while we own the gesture
      const d = Math.min(MAX, dy * 0.5); // rubber-band resistance
      st.pull = d; setPull(d);
      const ready = d >= THRESHOLD;
      if (ready && !st.crossed) { st.crossed = true; buzz(12); }   // tick when it arms
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

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", finish, { passive: true });
    el.addEventListener("touchcancel", finish, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", finish);
      el.removeEventListener("touchcancel", finish);
    };
  }, [onRefresh]);

  const busy = phase === "busy", done = phase === "done";
  const dist = busy || done ? THRESHOLD * 0.66 : pull;
  const rot = Math.min(1, pull / THRESHOLD) * 280; // arrow wind-up before it spins
  const label = done ? "Updated" : busy ? "Refreshing…" : phase === "ready" ? "Release to refresh" : "Pull to refresh";

  return (
    <div className={`pr ${className}`} ref={scrollRef} style={{ "--pr-tint": tint }}>
      <div
        className={`pr-cap ${busy ? "busy" : ""} ${done ? "done" : ""}`}
        style={{
          transform: `translateX(-50%) translateY(${dist - 52}px)`,
          opacity: dist > 4 || busy || done ? 1 : 0,
          transition: s.current.active ? "none" : "transform .3s cubic-bezier(.16,1,.3,1), opacity .2s ease",
        }}
        aria-hidden={dist === 0 && !busy && !done}
      >
        <span className="pr-spin" style={{ transform: busy ? undefined : `rotate(${rot}deg)` }}>
          {done ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v5h-5" /></svg>
          )}
        </span>
        <span className="pr-lbl">{label}</span>
      </div>
      {children}
    </div>
  );
}
