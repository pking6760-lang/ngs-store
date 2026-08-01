// Independence Day — the tricolour unfurls band by band, the Ashoka Chakra
// draws itself and turns, gentle motes rise like lamplight, and the greeting
// lifts as the peak. Saffron / white / green come from the theme palette; the
// chakra keeps its true navy. Self-contained: React + one canvas, no imports.
import { useEffect, useRef, useState } from "react";

export default function FestiveIntro({ theme, onDone }) {
  const canvasRef = useRef(null);
  const doneRef = useRef(false);
  const [phase, setPhase] = useState("enter"); // enter | leave

  const P = (theme && theme.palette) || [];
  const saffron = P[0] || "#FF9933";
  const band2 = "#FFFFFF";                       // the flag's middle band is always white
  const green = P[2] || (P.length > 1 ? P[P.length - 1] : "#138808") || "#138808";
  const navy = "#0A3A82";
  // "Jai Hind" is the hero; the full wish sits below. Strip any emoji — the look
  // stays clean and typographic.
  const strip = (s) => (s || "").replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/\s+/g, " ").trim();
  const hero = strip(theme && theme.kicker) || "Jai Hind";
  const sub = strip(theme && theme.greeting) || "Happy Independence Day";
  const greeting = hero;

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("leave");
    setTimeout(() => onDone && onDone(), 480);
  };

  useEffect(() => {
    if (theme && theme.reducedMotion) {
      const t = setTimeout(finish, 1300);
      return () => clearTimeout(t);
    }
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, raf = 0, start = 0;
    const resize = () => {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Lamplight motes drifting up.
    const motes = Array.from({ length: 34 }, () => ({
      x: Math.random(), y: 1 + Math.random() * 0.4,
      r: 0.8 + Math.random() * 2.2, s: 0.05 + Math.random() * 0.10,
      warm: Math.random() < 0.5,
    }));

    const DUR = 3100;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

    function frame(ts) {
      if (!start) start = ts;
      const e = clamp01((ts - start) / DUR);
      ctx.clearRect(0, 0, W, H);

      // Three bands sweep in from the left, staggered, with a soft flag ripple.
      const bandH = H / 3;
      const cols = [saffron, band2, green];
      for (let i = 0; i < 3; i++) {
        const prog = easeOut(clamp01(e * 1.6 - i * 0.12));
        const w = W * prog;
        const y0 = i * bandH, y1 = (i + 1) * bandH;
        const rip = (y, ph) => Math.sin(ts / 620 + y / 90 + ph) * 9 * prog;
        ctx.fillStyle = cols[i];
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.lineTo(w + rip(y0, i), y0);
        ctx.lineTo(w + rip(y1, i + 1), y1);
        ctx.lineTo(0, y1);
        ctx.closePath();
        ctx.fill();
      }

      // Ashoka Chakra draws in the centre band, then turns slowly.
      const cProg = easeOut(clamp01((e - 0.34) / 0.42));
      if (cProg > 0) {
        const cx = W / 2, cy = bandH * 1.5;
        const R = Math.min(W, H) * 0.086 * cProg;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ts / 2800);
        ctx.globalAlpha = cProg;
        ctx.strokeStyle = navy; ctx.fillStyle = navy;
        ctx.lineWidth = Math.max(1.4, R * 0.045);
        ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, R * 0.13, 0, Math.PI * 2); ctx.fill();
        const spokes = 24;
        for (let k = 0; k < spokes; k++) {
          const a = (k / spokes) * Math.PI * 2;
          const ex = Math.cos(a) * R * 0.9, ey = Math.sin(a) * R * 0.9;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.beginPath(); ctx.arc(ex, ey, R * 0.028, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // Rising motes, once the flag is mostly in.
      if (e > 0.3) {
        const a = clamp01((e - 0.3) / 0.3) * 0.55;
        for (const m of motes) {
          m.y -= m.s * 0.011;
          if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
          ctx.globalAlpha = a;
          ctx.fillStyle = m.warm ? saffron : green;
          ctx.beginPath(); ctx.arc(m.x * W, m.y * H, m.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      if (e >= 1) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`iid-cover iid-${phase}`} role="dialog" aria-label={greeting} onClick={finish}
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: navy, overflow: "hidden",
               display: "flex", alignItems: "center", justifyContent: "center" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <div className="iid-words" aria-hidden="true">
        <h1 className="iid-greet">{hero}</h1>
        <span className="iid-rule" />
        <span className="iid-sub">{sub}</span>
      </div>
      <style>{`
        .iid-cover{opacity:0;animation:iidIn .35s ease forwards}
        .iid-leave{animation:iidOut .46s ease forwards}
        @keyframes iidIn{to{opacity:1}}
        @keyframes iidOut{to{opacity:0}}
        .iid-words{position:relative;z-index:2;text-align:center;padding:0 26px;
          text-shadow:0 2px 20px rgba(0,0,0,.4)}
        .iid-greet{margin:0;font-size:clamp(40px,13vw,76px);font-weight:800;
          font-family:Georgia,'Times New Roman',serif;color:#fff;line-height:1.02;letter-spacing:.01em;
          opacity:0;transform:translateY(18px) scale(.97);
          animation:iidRise .9s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:.95s}
        .iid-rule{display:block;width:0;height:3px;margin:15px auto;border-radius:3px;
          background:#fff;opacity:.92;animation:iidRule .7s ease forwards;animation-delay:1.5s}
        .iid-sub{display:block;font-size:clamp(13px,3.6vw,16px);font-weight:600;color:#fff;
          opacity:0;transform:translateY(8px);max-width:22em;margin:0 auto;line-height:1.4;
          animation:iidRise .8s ease forwards;animation-delay:1.7s}
        @keyframes iidRise{to{opacity:1;transform:none}}
        @keyframes iidRule{to{width:78px}}
        @media (prefers-reduced-motion: reduce){
          .iid-greet,.iid-rule,.iid-sub{animation-duration:.01s;animation-delay:0s;opacity:1;transform:none;width:78px}
        }
      `}</style>
    </div>
  );
}
