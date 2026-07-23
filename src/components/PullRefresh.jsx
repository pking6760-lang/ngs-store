import { useEffect, useRef, useState } from "react";

// Pull-to-refresh for INNER scroll containers (admin & partner shells, whose
// content scrolls inside a fixed frame rather than the window). The component
// *becomes* the scroller — pass the scroller's className so it keeps the same
// flex/overflow/padding role. Deliberately minimal: a single clean spinner at
// the top of the content that winds up as you pull, spins while refreshing and
// shows a brief tick when done. No text labels. The spinner is out of flow, so
// it never disturbs the container's own layout.
const THRESHOLD = 72; // px pulled (after resistance) to arm a refresh
const MAX = 108;      // clamp so it can't be dragged arbitrarily far

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
      if (dy <= 0 || el.scrollTop > 2 || Math.abs(dx) > dy) {
        st.active = false; st.pull = 0; setPull(0); set("idle"); return;
      }
      e.preventDefault(); // own the gesture; suppress native overscroll
      const d = Math.min(MAX, dy * 0.5); // rubber-band resistance
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
  const active = pull > 0 || busy || done;
  const prog = Math.min(1, pull / THRESHOLD);
  const rot = prog * 300;                       // arrow winds up before it spins
  const scale = busy || done ? 1 : 0.4 + 0.6 * prog;
  const drop = busy || done ? 40 : Math.min(48, pull * 0.7); // how far it slides in

  return (
    <div className={`pr ${className}`} ref={scrollRef} style={{ "--pr-tint": tint }}>
      <div
        className={`pr-spin ${busy ? "busy" : ""} ${done ? "done" : ""}`}
        style={{
          opacity: active ? 1 : 0,
          transform: `translateX(-50%) translateY(${drop}px) scale(${scale})`,
          transition: s.current.active ? "opacity .15s ease" : "transform .32s cubic-bezier(.16,1,.3,1), opacity .2s ease",
        }}
        aria-hidden={!active}
      >
        <span className="pr-ring" style={{ transform: busy || done ? undefined : `rotate(${rot}deg)` }}>
          {done ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v5h-5" /></svg>
          )}
        </span>
      </div>
      {children}
    </div>
  );
}
