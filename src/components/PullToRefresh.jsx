import { useEffect, useRef, useState } from "react";

// Native-feeling pull-to-refresh for the customer home. Swipe down from the very
// top and a spinner drops in; past the threshold it triggers onRefresh and spins
// until the reload settles. Body-scroll based (no inner scroller), and it bows
// out of horizontal product-row swipes and any time an overlay is open.
const THRESHOLD = 66; // px pulled (after resistance) to trigger a refresh
const MAX = 92; // clamp so it can't be dragged arbitrarily far

export default function PullToRefresh({ onRefresh, disabled }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  // Mutable state the native touch listeners read without re-subscribing.
  const s = useRef({ y: 0, x: 0, active: false, pull: 0, busy: false, disabled });
  s.current.disabled = disabled;

  useEffect(() => {
    const st = s.current;
    const onStart = (e) => {
      if (st.disabled || st.busy || (window.scrollY || 0) > 0) { st.active = false; return; }
      st.y = e.touches[0].clientY;
      st.x = e.touches[0].clientX;
      st.active = true;
    };
    const onMove = (e) => {
      if (!st.active) return;
      const dy = e.touches[0].clientY - st.y;
      const dx = e.touches[0].clientX - st.x;
      // Left the top, pulling up, or a mostly-horizontal swipe → not a refresh.
      if (dy <= 0 || (window.scrollY || 0) > 2 || Math.abs(dx) > dy) {
        st.active = false; st.pull = 0; setPull(0); return;
      }
      e.preventDefault(); // suppress the browser's own overscroll while pulling
      const d = Math.min(MAX, dy * 0.55); // rubber-band resistance
      st.pull = d;
      setPull(d);
    };
    const finish = () => {
      if (!st.active) return;
      st.active = false;
      if (st.pull >= THRESHOLD && !st.busy) {
        st.busy = true; setBusy(true);
        Promise.resolve(onRefresh?.()).finally(() => {
          // Hold the spinner briefly so a fast refresh still reads as "refreshed".
          window.setTimeout(() => {
            st.busy = false; setBusy(false); st.pull = 0; setPull(0);
          }, 600);
        });
      } else if (!st.busy) {
        st.pull = 0; setPull(0);
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

  const dist = busy ? THRESHOLD : pull;
  const rot = Math.min(1, pull / THRESHOLD) * 300; // arrow-like wind-up before it spins

  return (
    <div
      className={`ptr ${busy ? "ptr--busy" : ""}`}
      style={{
        transform: `translateX(-50%) translateY(${dist - 46}px)`,
        transition: s.current.active ? "none" : "transform .3s cubic-bezier(.16,1,.3,1)",
      }}
      aria-hidden={dist === 0 && !busy}
    >
      <span className="ptr-ring" style={{ transform: busy ? undefined : `rotate(${rot}deg)` }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v5h-5" />
        </svg>
      </span>
    </div>
  );
}
