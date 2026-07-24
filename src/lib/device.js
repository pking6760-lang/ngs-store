// Device fingerprint for referral-farming defence.
//
// The value is DETERMINISTIC — derived from the hardware/browser, not a random
// id we store. That's deliberate: a random id in localStorage is wiped by
// incognito mode or an app reinstall, but a computed fingerprint recomputes to
// the SAME hash on the same device, so those tricks don't hand a farmer a fresh
// "new device". A VPN doesn't change any of these signals either (it only hides
// the IP), so VPN + incognito together still map back to one device.
//
// Limits (be honest): different browsers on one phone can differ, and cheap
// identical phones can collide — so the server treats a match as a HARD block
// but records the IP too, and an admin can reverse a rare false positive.

async function sha256Hex(str) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Fallback: FNV-1a (good enough when SubtleCrypto is unavailable, e.g. http).
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}

function canvasSignal() {
  try {
    const c = document.createElement("canvas");
    c.width = 220; c.height = 40;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60"; ctx.fillRect(0, 0, 220, 40);
    ctx.fillStyle = "#069"; ctx.fillText("NGS-store-\u{1F6D2}-₹", 2, 2);
    ctx.strokeStyle = "rgba(0,80,120,0.6)"; ctx.beginPath(); ctx.arc(180, 20, 14, 0, Math.PI * 2); ctx.stroke();
    return c.toDataURL();
  } catch { return ""; }
}

let _cached = null;

// Returns a stable hex fingerprint for this device (or null if it can't be
// computed). Cached for the session so we don't recompute on every call.
export async function deviceFingerprint() {
  if (_cached) return _cached;
  try {
    const n = navigator || {};
    const parts = [
      n.userAgent || "",
      n.language || "",
      (n.languages || []).join(","),
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      String(new Date().getTimezoneOffset()),
      String(n.hardwareConcurrency || ""),
      String(n.deviceMemory || ""),
      String(n.platform || ""),
      String(n.maxTouchPoints || ""),
      canvasSignal(),
    ];
    _cached = await sha256Hex(parts.join("|"));
    // Keep a copy so support can read it off a device if needed; harmless if wiped.
    try { localStorage.setItem("ngs-did", _cached); } catch { /* ignore */ }
    return _cached;
  } catch {
    try { return localStorage.getItem("ngs-did"); } catch { return null; }
  }
}
