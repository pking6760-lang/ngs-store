import { useEffect, useRef, useState } from "react";
import * as api from "../lib/api.js";

// A scratch-to-reveal reward card. A gold foil canvas sits over the prize; the
// customer scratches it off with a finger, and once ~45% is cleared the reward
// is claimed server-side and revealed with a pop. If the order was already
// scratched, the stored reward is shown straight away (no re-claim).
export default function ScratchCard({ orderId, existingReward }) {
  const canvasRef = useRef(null);
  const clearedRef = useRef(false);
  const claimingRef = useRef(false);
  const [reward, setReward] = useState(existingReward || null);
  const [revealed, setRevealed] = useState(!!existingReward);

  async function claim() {
    if (claimingRef.current) return;
    claimingRef.current = true;
    try {
      const r = await api.claimScratchReward(orderId);
      setReward(r);
    } catch {
      setReward({ type: "points", amount: 0 });
    } finally {
      setTimeout(() => setRevealed(true), 350);
    }
  }

  useEffect(() => {
    if (revealed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Gold foil with a shimmer.
    const g = ctx.createLinearGradient(0, 0, rect.width, rect.height);
    g.addColorStop(0, "#b8901f");
    g.addColorStop(0.45, "#f6dd8b");
    g.addColorStop(0.55, "#fff4cf");
    g.addColorStop(1, "#b8901f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "rgba(120,80,0,0.75)";
    ctx.font = "800 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🎁  Scratch here", rect.width / 2, rect.height / 2);

    let drawing = false;
    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const scratch = (e) => {
      if (!drawing) return;
      const { x, y } = point(e);
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fill();
      if (e.cancelable) e.preventDefault();
      checkCleared();
    };
    const checkCleared = () => {
      if (clearedRef.current) return;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let clear = 0, total = 0;
      for (let i = 3; i < data.length; i += 4 * 24) { total++; if (data[i] === 0) clear++; }
      if (total && clear / total > 0.45) { clearedRef.current = true; claim(); }
    };
    const start = (e) => { drawing = true; scratch(e); };
    const end = () => { drawing = false; };

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", scratch);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", scratch, { passive: false });
    window.addEventListener("touchend", end);
    return () => {
      canvas.removeEventListener("mousedown", start);
      canvas.removeEventListener("mousemove", scratch);
      window.removeEventListener("mouseup", end);
      canvas.removeEventListener("touchstart", start);
      canvas.removeEventListener("touchmove", scratch);
      window.removeEventListener("touchend", end);
    };
  }, [revealed]); // eslint-disable-line react-hooks/exhaustive-deps

  const pts = reward?.points ?? 0;
  const cash = reward?.wallet ?? 0;
  const won = pts > 0 || cash > 0;

  return (
    <div className="scratch">
      <div className="scratch-title">🎉 You've got a reward!</div>
      <div className="scratch-stage">
        <div className={`scratch-prize ${revealed ? "show" : ""}`}>
          {won ? (
            <>
              <div className="scratch-prize-emoji">{cash > 0 ? "💰" : "🎁"}</div>
              <div className="scratch-prize-rows">
                {cash > 0 && (
                  <div className="scratch-prize-row"><strong>₹{cash}</strong><span>wallet cash</span></div>
                )}
                {pts > 0 && (
                  <div className="scratch-prize-row"><strong>{pts}</strong><span>reward points</span></div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="scratch-prize-emoji">🙂</div>
              <div className="scratch-prize-lbl">No reward this time — try your next order!</div>
            </>
          )}
        </div>
        {!revealed && <canvas ref={canvasRef} className="scratch-foil" />}
      </div>
      {revealed ? (
        <div className="scratch-done">
          {won
            ? `Added ${[cash > 0 ? `₹${cash} to your wallet` : null, pts > 0 ? `${pts} points` : null].filter(Boolean).join(" + ")} 🎊`
            : "Better luck next time!"}
        </div>
      ) : (
        <div className="scratch-hint">Scratch the gold panel to reveal your prize</div>
      )}
    </div>
  );
}
