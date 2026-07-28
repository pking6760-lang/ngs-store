// Flash sale helpers — shared by the product card and the home rail so both
// judge "active" the exact same way the server does at checkout: a flash counts
// only while its end time is still in the future.
import { useEffect, useState } from "react";

export function flashMsLeft(product) {
  if (!product || product.flashPrice == null || !product.flashEndsAt) return 0;
  const end = new Date(product.flashEndsAt).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, end - Date.now());
}

export function flashActive(product) {
  return product && product.flashPrice != null && flashMsLeft(product) > 0;
}

// mm:ss (or h:mm:ss past an hour) for a countdown chip.
export function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Ticks once a second while the flash is live and stops at zero. Returns the
// remaining ms; components re-render on each tick to update the countdown and
// drop the flash price the instant it ends.
export function useFlashCountdown(endsAt) {
  const target = endsAt ? new Date(endsAt).getTime() : 0;
  const [ms, setMs] = useState(() => Math.max(0, target - Date.now()));
  useEffect(() => {
    if (!target) { setMs(0); return; }
    setMs(Math.max(0, target - Date.now()));
    if (target <= Date.now()) return;
    const id = setInterval(() => {
      const left = Math.max(0, target - Date.now());
      setMs(left);
      if (left <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [target]);
  return ms;
}
