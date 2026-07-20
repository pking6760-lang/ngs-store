import { useState } from "react";
import { canReceiveWebPush, webPushPermission, enableCallAlerts } from "../lib/webPush.js";

// A slim banner that turns on browser call/notification alerts. Only shows on the
// web (not the native app), for a signed-in customer who hasn't granted
// notifications yet. On iPhone, Web Push needs the site opened from the Home
// Screen icon — so if they're in a plain Safari tab we tell them that instead of
// showing an Enable button that iOS would ignore.
export default function CallAlertsPrompt({ show }) {
  const [perm, setPerm] = useState(webPushPermission());
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const isNative = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = typeof window !== "undefined" &&
    (window.navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)")?.matches);

  if (isNative || !show || hidden || perm === "granted") return null;
  // Nothing to offer on a browser that can't do push at all.
  if (!isIOS && !canReceiveWebPush()) return null;

  // iPhone in a Safari tab: push is impossible here — guide them to the icon.
  if (isIOS && !standalone) {
    return (
      <div className="ca-banner ios">
        <span className="ca-ic">📲</span>
        <span className="ca-txt">To get call alerts on iPhone, open <b>NGS</b> from the Home&nbsp;Screen icon you added.</span>
        <button className="ca-x" onClick={() => setHidden(true)} aria-label="Dismiss">✕</button>
      </div>
    );
  }

  if (perm === "denied") {
    return (
      <div className="ca-banner">
        <span className="ca-ic">🔕</span>
        <span className="ca-txt">Call alerts are blocked. Allow notifications for NGS in your browser settings to get calls.</span>
        <button className="ca-x" onClick={() => setHidden(true)} aria-label="Dismiss">✕</button>
      </div>
    );
  }

  async function turnOn() {
    setBusy(true);
    const ok = await enableCallAlerts();     // must run inside this tap (iOS)
    setBusy(false);
    setPerm(webPushPermission());
    if (ok) setHidden(true);
  }

  return (
    <div className="ca-banner">
      <span className="ca-ic">🔔</span>
      <span className="ca-txt">Turn on call alerts so you never miss a delivery call.</span>
      <button className="ca-enable" onClick={turnOn} disabled={busy}>{busy ? "…" : "Enable"}</button>
      <button className="ca-x" onClick={() => setHidden(true)} aria-label="Dismiss">✕</button>
    </div>
  );
}
