// iOS home-screen apps have no address bar, so once a stray pinch or double-tap
// zooms the page there is no way for the customer to zoom back out — the app
// just looks broken until they delete and re-add it. Safari ignores
// user-scalable=no in a normal browser tab (correctly, for accessibility) but
// honours it once the site is installed, so blocking the WebKit gesture events
// ONLY in standalone mode gives us the best of both: pinch-zoom still works for
// anyone browsing in Safari/Chrome, and the installed app stays stable.
export function lockZoomInStandalone() {
  try {
    const standalone =
      window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      !!window.Capacitor; // packaged APK — always app-like
    if (!standalone) return;

    const stop = (e) => e.preventDefault();
    ["gesturestart", "gesturechange", "gestureend"].forEach((t) =>
      document.addEventListener(t, stop, { passive: false })
    );

    // Belt and braces: swallow the second tap of a double-tap, which iOS treats
    // as zoom even when gestures are blocked.
    let lastTouch = 0;
    document.addEventListener("touchend", (e) => {
      const now = Date.now();
      if (now - lastTouch <= 320) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  } catch { /* never let this break boot */ }
}
