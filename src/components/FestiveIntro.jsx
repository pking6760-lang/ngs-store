// Generic, data-driven festive intro — ONE engine for every festival.
//
// It reads the active theme (which is delivered over-the-air) and plays a
// full-screen animation matching that festival's `pattern` in its own palette:
//   flags/tricolor → tricolour bands sweep in + the Ashoka Chakra turns
//   diyas          → warm lamp-glows rise from the dark
//   coins          → gold coins cascade and glint
//   petals         → flower petals drift down
//   splash         → colour-powder bursts bloom and rain (Holi)
//   sparkles/other → a soft field of twinkles (graceful default)
// Then the greeting lifts as the peak and it dissolves into the app.
//
// Because it is fully driven by theme data, adding a new festival needs only a
// new theme (no app update). Self-contained: React + one canvas.
import { useEffect, useRef, useState } from "react";

const RM = () => typeof window !== "undefined"
  && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const rnd = (a, b) => a + Math.random() * (b - a);

// Which engine mode a theme's pattern maps to.
function modeOf(theme) {
  const p = String(theme?.pattern || "").toLowerCase();
  const d = String(theme?.decoration || "").toLowerCase();
  if (p.includes("flag") || d === "tricolor") return "flags";
  if (p.includes("diya")) return "diyas";
  if (p.includes("coin")) return "coins";
  if (p.includes("petal") || d === "marigold") return "petals";
  if (p.includes("splash")) return "splash";
  return "sparkles";
}

export default function FestiveIntro({ theme, onDone }) {
  const canvasRef = useRef(null);
  const doneRef = useRef(false);
  const [phase, setPhase] = useState("enter");

  const strip = (s) => (s || "").replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/\s+/g, " ").trim();
  const P = (theme?.palette && theme.palette.length ? theme.palette : ["#1C6B45", "#E5A200", "#C0392B"]);
  const deep = theme?.colors?.deep || "#0E1512";
  const hero = strip(theme?.kicker) || strip(theme?.greeting) || "";
  const sub = strip(theme?.greeting) && strip(theme?.greeting) !== hero ? strip(theme?.greeting) : "";
  const mode = modeOf(theme);
  const bg = mode === "flags" ? "#0A3A82"
    : mode === "diyas" ? "#160D06"
    : mode === "splash" ? "#12101A"
    : mode === "petals" ? "#1a1210" : deep;

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("leave");
    setTimeout(() => onDone && onDone(), 480);
  };

  useEffect(() => {
    if (RM()) { const t = setTimeout(finish, 1300); return () => clearTimeout(t); }
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, raf = 0, start = 0;
    const resize = () => { W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener("resize", resize);

    // Particle field, seeded per mode.
    let parts = [];
    const N = mode === "sparkles" ? 60 : 44;
    const seed = () => {
      parts = Array.from({ length: N }, () => {
        const c = P[Math.floor(Math.random() * P.length)] || "#fff";
        if (mode === "diyas") return { x: Math.random(), y: rnd(1, 1.5), r: rnd(1.5, 4), s: rnd(0.05, 0.12), c: Math.random() < 0.6 ? "#FFB63E" : c, tw: Math.random() * 6 };
        if (mode === "coins") return { x: Math.random(), y: rnd(-0.4, -0.05), r: rnd(4, 9), s: rnd(0.10, 0.22), c, spin: Math.random() * 6, sp: rnd(2, 5) };
        if (mode === "petals") return { x: Math.random(), y: rnd(-0.3, -0.02), r: rnd(4, 8), s: rnd(0.05, 0.11), c, sway: Math.random() * 6, amp: rnd(6, 16) };
        if (mode === "splash") return { x: rnd(0.15, 0.85), y: rnd(0.2, 0.8), r: 0, R: rnd(26, 66), c, t0: rnd(0, 0.5) };
        return { x: Math.random(), y: Math.random(), r: rnd(0.7, 2.4), s: rnd(0.2, 0.9), c, tw: Math.random() * 6 }; // sparkles
      });
    };
    seed();

    const DUR = 3100;

    function chakra(cx, cy, R, ts, prog) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ts / 2800); ctx.globalAlpha = prog;
      ctx.strokeStyle = "#0A3A82"; ctx.fillStyle = "#0A3A82"; ctx.lineWidth = Math.max(1.4, R * 0.045);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R * 0.13, 0, 7); ctx.fill();
      for (let k = 0; k < 24; k++) { const a = (k / 24) * 6.2832; const ex = Math.cos(a) * R * 0.9, ey = Math.sin(a) * R * 0.9; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex, ey); ctx.stroke(); ctx.beginPath(); ctx.arc(ex, ey, R * 0.028, 0, 7); ctx.fill(); }
      ctx.restore(); ctx.globalAlpha = 1;
    }

    function frame(ts) {
      if (!start) start = ts;
      const e = clamp01((ts - start) / DUR);
      ctx.clearRect(0, 0, W, H);

      if (mode === "flags") {
        const bandH = H / 3, cols = [P[0] || "#FF9933", "#FFFFFF", P[2] || P[P.length - 1] || "#138808"];
        for (let i = 0; i < 3; i++) {
          const prog = easeOut(clamp01(e * 1.6 - i * 0.12)), w = W * prog, y0 = i * bandH, y1 = (i + 1) * bandH;
          const rip = (y, ph) => Math.sin(ts / 620 + y / 90 + ph) * 9 * prog;
          ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w + rip(y0, i), y0); ctx.lineTo(w + rip(y1, i + 1), y1); ctx.lineTo(0, y1); ctx.closePath(); ctx.fill();
        }
        const cp = easeOut(clamp01((e - 0.34) / 0.42));
        if (cp > 0) chakra(W / 2, bandH * 1.5, Math.min(W, H) * 0.086 * cp, ts, cp);
      } else {
        // particle modes over the mode's backdrop
        const inA = clamp01(e / 0.25), outA = 1 - clamp01((e - 0.82) / 0.18);
        ctx.globalAlpha = Math.min(inA, outA);
        for (const p of parts) {
          if (mode === "diyas") {
            p.y -= p.s * 0.011; if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
            const x = p.x * W, y = p.y * H, fl = 0.6 + 0.4 * Math.sin(ts / 220 + p.tw);
            const g = ctx.createRadialGradient(x, y, 0, x, y, p.r * 5);
            g.addColorStop(0, p.c); g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g; ctx.globalAlpha = Math.min(inA, outA) * fl; ctx.beginPath(); ctx.arc(x, y, p.r * 5, 0, 7); ctx.fill();
          } else if (mode === "coins") {
            p.y += p.s * 0.012; p.spin += 0.12; if (p.y > 1.08) { p.y = -0.1; p.x = Math.random(); }
            const x = p.x * W, y = p.y * H, w = p.r * Math.abs(Math.cos(p.spin));
            ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(x, y, Math.max(1, w), p.r, 0, 0, 7); ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.ellipse(x - w * 0.2, y - p.r * 0.2, Math.max(0.5, w * 0.4), p.r * 0.4, 0, 0, 7); ctx.fill();
          } else if (mode === "petals") {
            p.y += p.s * 0.011; p.sway += 0.03; const x = (p.x + Math.sin(p.sway) * p.amp / W) * W, y = p.y * H;
            if (p.y > 1.08) { p.y = -0.08; p.x = Math.random(); }
            ctx.fillStyle = p.c; ctx.save(); ctx.translate(x, y); ctx.rotate(p.sway);
            ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.5, 0, 0, 7); ctx.fill(); ctx.restore();
          } else if (mode === "splash") {
            const lt = clamp01((e - p.t0) / 0.5); p.r = p.R * easeOut(lt);
            ctx.globalAlpha = Math.min(inA, outA) * (1 - lt) * 0.5; ctx.fillStyle = p.c;
            ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r, 0, 7); ctx.fill();
          } else {
            const x = p.x * W, y = p.y * H, tw = 0.4 + 0.6 * Math.abs(Math.sin(ts / 380 + p.tw));
            ctx.globalAlpha = Math.min(inA, outA) * tw; ctx.fillStyle = p.c;
            ctx.beginPath(); ctx.arc(x, y, p.r, 0, 7); ctx.fill();
          }
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
    <div className={`fint fint-${phase}`} role="dialog" aria-label={hero || "Festival"} onClick={finish}
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: bg, overflow: "hidden",
               display: "flex", alignItems: "center", justifyContent: "center" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <div className="fint-words" aria-hidden="true">
        {hero && <h1 className="fint-hero">{hero}</h1>}
        <span className="fint-rule" />
        {sub && <span className="fint-sub">{sub}</span>}
      </div>
      <style>{`
        .fint{opacity:0;animation:fintIn .35s ease forwards}
        .fint-leave{animation:fintOut .46s ease forwards}
        @keyframes fintIn{to{opacity:1}} @keyframes fintOut{to{opacity:0}}
        .fint-words{position:relative;z-index:2;text-align:center;padding:0 26px;text-shadow:0 2px 20px rgba(0,0,0,.45)}
        .fint-hero{margin:0;font-size:clamp(38px,12vw,72px);font-weight:800;font-family:Georgia,'Times New Roman',serif;
          color:#fff;line-height:1.03;opacity:0;transform:translateY(18px) scale(.97);
          animation:fintRise .9s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:1s}
        .fint-rule{display:block;width:0;height:3px;margin:15px auto;border-radius:3px;background:#fff;opacity:.9;
          animation:fintRule .7s ease forwards;animation-delay:1.55s}
        .fint-sub{display:block;font-size:clamp(13px,3.6vw,16px);font-weight:600;color:#fff;max-width:22em;margin:0 auto;
          line-height:1.4;opacity:0;transform:translateY(8px);animation:fintRise .8s ease forwards;animation-delay:1.75s}
        @keyframes fintRise{to{opacity:1;transform:none}} @keyframes fintRule{to{width:78px}}
        @media (prefers-reduced-motion:reduce){.fint-hero,.fint-rule,.fint-sub{animation-duration:.01s;animation-delay:0s;opacity:1;transform:none;width:78px}}
      `}</style>
    </div>
  );
}
