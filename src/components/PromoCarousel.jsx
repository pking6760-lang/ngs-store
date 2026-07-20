import { useEffect, useRef, useState } from "react";

// Professional auto-sliding promo carousel: advances left→right on a timer,
// loops, pauses on touch/hover and when the tab is hidden, and is swipeable.
// One full-width slide at a time with animated dot indicators.
export default function PromoCarousel({ slides, interval = 4200 }) {
  const [i, setI] = useState(0);
  const n = slides.length;
  const paused = useRef(false);
  const touch = useRef({ x: 0, dx: 0, active: false });
  const resumeT = useRef(null);

  const go = (idx) => setI(((idx % n) + n) % n);
  const holdPause = (ms = 5000) => {
    paused.current = true;
    if (resumeT.current) clearTimeout(resumeT.current);
    resumeT.current = setTimeout(() => { paused.current = false; }, ms);
  };

  useEffect(() => {
    if (n <= 1) return;
    const id = setInterval(() => { if (!paused.current) setI((p) => (p + 1) % n); }, interval);
    return () => clearInterval(id);
  }, [n, interval]);

  useEffect(() => {
    const onVis = () => { paused.current = document.visibilityState !== "visible"; };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); if (resumeT.current) clearTimeout(resumeT.current); };
  }, []);

  function onTouchStart(e) { paused.current = true; touch.current = { x: e.touches[0].clientX, dx: 0, active: true }; }
  function onTouchMove(e) { if (touch.current.active) touch.current.dx = e.touches[0].clientX - touch.current.x; }
  function onTouchEnd() {
    const dx = touch.current.dx; touch.current.active = false;
    if (dx < -40) go(i + 1);
    else if (dx > 40) go(i - 1);
    holdPause();
  }

  return (
    <div
      className="promo-carousel"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; }}
    >
      <div className="promo-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {slides.map((b) => (
          <div className="promo-slide" key={b.id} style={{ background: b.grad, color: b.fg }}>
            <div className="promo-text">
              {b.kicker && <span className="promo-kicker">{b.kicker}</span>}
              <h3>{b.title}</h3>
              <p>{b.subtitle}</p>
            </div>
            <div className="promo-icon">{b.icon}</div>
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="promo-dots">
          {slides.map((_, d) => (
            <button
              key={d}
              type="button"
              className={`promo-dot ${d === i ? "on" : ""}`}
              aria-label={`Go to slide ${d + 1}`}
              onClick={() => { go(d); holdPause(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
