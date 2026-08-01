// Independence Day — a real scene, not a template. A tricolour flag flies on a
// pole against a dawn sky and ripples in the wind; the Ashoka Chakra turns on
// the cloth; light motes drift up. The greeting sits beside it. Hand-drawn on a
// canvas — nothing generic here.
import { useEffect, useRef } from "react";

export default function IndependenceDayBanner({ theme }) {
  const cvRef = useRef(null);
  const P = (theme?.palette && theme.palette.length ? theme.palette : ["#FF9933", "#FFFFFF", "#138808"]);
  const saffron = P[0] || "#FF9933";
  const green = P[2] || (P.length > 1 ? P[P.length - 1] : "#138808") || "#138808";
  const navy = "#0A2E6E";
  const strip = (s) => (s || "").replace(/[\p{Extended_Pictographic}️]/gu, "").replace(/\s+/g, " ").trim();
  const hero = strip(theme?.banner?.kicker) || "Jai Hind";
  const sub = strip(theme?.greeting) || "Happy Independence Day";

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, raf = 0, t0 = 0;
    const resize = () => { W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener("resize", resize);

    const motes = Array.from({ length: 16 }, () => ({ x: Math.random(), y: 1 + Math.random(), r: 0.8 + Math.random() * 1.8, s: 0.04 + Math.random() * 0.06, warm: Math.random() < 0.5 }));

    function drawFlag(t, reveal) {
      // Flag geometry — hoisted on a pole in the left third.
      const poleX = Math.max(24, W * 0.13);
      const poleTop = H * 0.18, poleBot = H * 0.94;
      const fw = Math.min(W * 0.5, 210), fh = fw * 0.62;
      const fx = poleX + 3, fy = poleTop + 4;

      // pole
      const pg = ctx.createLinearGradient(poleX - 3, 0, poleX + 3, 0);
      pg.addColorStop(0, "#9aa0a6"); pg.addColorStop(.5, "#e9edf1"); pg.addColorStop(1, "#7c828a");
      ctx.fillStyle = pg; ctx.fillRect(poleX - 2.2, poleTop - 6, 4.4, poleBot - poleTop + 6);
      ctx.fillStyle = "#d4a017"; ctx.beginPath(); ctx.arc(poleX, poleTop - 8, 4, 0, 7); ctx.fill();

      // cloth: vertical strips, each with a travelling wave that grows toward the free edge
      const bands = [saffron, "#FFFFFF", green];
      const cols = Math.max(28, Math.floor(fw / 3));
      const amp = fh * 0.13;
      for (let i = 0; i < cols; i++) {
        const px = i / (cols - 1);
        const cw = fw / cols + 1;
        const x = fx + px * fw * reveal;
        const wob = Math.sin(px * 6.0 - t * 3.2) * amp * px;      // wave
        const slope = Math.cos(px * 6.0 - t * 3.2);                // for shading
        const top = fy + wob;
        for (let b = 0; b < 3; b++) {
          ctx.fillStyle = bands[b];
          ctx.fillRect(x, top + (b * fh) / 3, cw, fh / 3 + 0.6);
        }
        // shading overlay — crests lighter, troughs darker
        ctx.fillStyle = slope > 0 ? `rgba(255,255,255,${0.10 * slope * px})` : `rgba(0,0,0,${-0.14 * slope * px})`;
        ctx.fillRect(x, top, cw, fh);
      }

      // Ashoka Chakra on the middle band, riding the same wave, slowly turning
      const cpx = 0.5;
      const cxp = fx + cpx * fw * reveal;
      const cyw = fy + Math.sin(cpx * 6.0 - t * 3.2) * amp * cpx;
      const cx = cxp + (fw / cols) / 2, cy = cyw + fh / 2, R = fh * 0.15;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.5); ctx.globalAlpha = reveal;
      ctx.strokeStyle = navy; ctx.fillStyle = navy; ctx.lineWidth = Math.max(1, R * 0.07);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R * 0.14, 0, 7); ctx.fill();
      for (let k = 0; k < 24; k++) { const a = (k / 24) * 6.2832; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88); ctx.stroke(); }
      ctx.restore(); ctx.globalAlpha = 1;
    }

    function frame(ts) {
      if (!t0) t0 = ts;
      const t = (ts - t0) / 1000;
      const reveal = reduce ? 1 : Math.min(1, t / 0.9); // flag unfurls once
      ctx.clearRect(0, 0, W, H);
      // dawn sky
      const sky = ctx.createLinearGradient(0, 0, W * 0.6, H);
      sky.addColorStop(0, "#0b2a63"); sky.addColorStop(0.55, "#294a86"); sky.addColorStop(1, "#c76a2f");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      // soft sun glow bottom-right
      const gl = ctx.createRadialGradient(W * 0.86, H * 1.02, 6, W * 0.86, H * 1.02, H * 1.1);
      gl.addColorStop(0, "rgba(255,196,120,.55)"); gl.addColorStop(1, "rgba(255,196,120,0)");
      ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
      // motes
      for (const m of motes) { if (!reduce) { m.y -= m.s * 0.02; if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); } } ctx.globalAlpha = 0.5; ctx.fillStyle = m.warm ? "#ffd9a0" : "#dfeecd"; ctx.beginPath(); ctx.arc(m.x * W, m.y * H, m.r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      drawFlag(reduce ? 1.2 : t, reveal);
      if (reduce) return; // one static frame
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="idb" role="banner" aria-label={hero}>
      <canvas ref={cvRef} className="idb-cv" />
      <div className="idb-words">
        <span className="idb-kick">Independence Day</span>
        <h2 className="idb-hero">{hero}</h2>
        <p className="idb-sub">{sub}</p>
      </div>
      <style>{`
        .idb{position:relative;isolation:isolate;overflow:hidden;margin:-6px -20px 12px;height:190px;
          border-bottom-left-radius:20px;border-bottom-right-radius:20px;box-shadow:0 10px 26px rgba(0,0,0,.18)}
        .idb-cv{position:absolute;inset:0;width:100%;height:100%}
        .idb-words{position:absolute;right:18px;bottom:16px;left:44%;text-align:right;z-index:1;color:#fff;
          text-shadow:0 2px 14px rgba(0,0,0,.45)}
        .idb-kick{display:block;font-size:10.5px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;opacity:.9;
          opacity:0;transform:translateY(8px);animation:idbRise .6s ease forwards .5s}
        .idb-hero{margin:2px 0 0;font-family:Georgia,'Times New Roman',serif;font-weight:800;font-size:clamp(26px,8vw,38px);
          line-height:1.02;opacity:0;transform:translateY(12px);animation:idbRise .8s cubic-bezier(.2,.7,.2,1) forwards .68s}
        .idb-sub{margin:7px 0 0;font-size:12px;font-weight:600;opacity:.95;line-height:1.35;max-width:15em;margin-left:auto;
          opacity:0;transform:translateY(8px);animation:idbRise .7s ease forwards .95s}
        @keyframes idbRise{to{opacity:1;transform:none}}
        @media (prefers-reduced-motion:reduce){.idb-kick,.idb-hero,.idb-sub{animation-delay:0s;animation-duration:.01s}}
      `}</style>
    </div>
  );
}
