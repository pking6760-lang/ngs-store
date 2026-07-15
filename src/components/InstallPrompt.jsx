import { useEffect, useState } from "react";

// "Add to Home Screen" prompt for the website (PWA). Two flavours:
//  • Android/Chrome fires `beforeinstallprompt` → we show a one-tap Install button.
//  • iOS Safari has no such event → we show the manual "Share → Add to Home
//    Screen" instructions with a pointer to the Share button.
// It never shows inside the native Capacitor app, or once the PWA is installed
// (standalone), and it backs off for a few days after the user dismisses it.

const SNOOZE_KEY = "ngs_install_snooze";
const SNOOZE_DAYS = 3;

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );
}
function isNativeApp() {
  // Capacitor injects window.Capacitor in the native WebView.
  return !!(window.Capacitor && (window.Capacitor.isNativePlatform?.() ?? true));
}
function isIOS() {
  const ua = navigator.userAgent || "";
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ masquerades as desktop Safari — catch it via touch points.
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}
function snoozed() {
  const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
  return Date.now() < until;
}
function snooze() {
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5));
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [deferred, setDeferred] = useState(null);

  useEffect(() => {
    if (isNativeApp() || isStandalone() || snoozed()) return;

    // Android/Chrome: capture the install event so we can trigger it on tap.
    const onBIP = (e) => {
      e.preventDefault();
      setDeferred(e);
      setIos(false);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // Hide immediately if the app gets installed while the banner is open.
    const onInstalled = () => { snooze(); setShow(false); };
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt — show the manual guide after a beat
    // so it doesn't fight the first paint.
    let t = 0;
    if (isIOS()) {
      t = window.setTimeout(() => { setIos(true); setShow(true); }, 1500);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => { snooze(); setShow(false); };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* ignore */ }
    setDeferred(null);
    snooze();
    setShow(false);
  };

  return (
    <>
      <div className="install-scrim" onClick={dismiss} />
      <div className="install-sheet" role="dialog" aria-label="Install NGS app">
        <button className="install-x" onClick={dismiss} aria-label="Close">×</button>

        <div className="install-head">
          <img className="install-icon" src="/icon-192.png" alt="" width="54" height="54" />
          <div className="install-copy">
            <h3>Install the NGS app</h3>
            <p>Add Nisha General Store to your home screen — faster, full-screen, one tap to open.</p>
          </div>
        </div>

        {ios ? (
          <div className="install-ios">
            <div className="install-step">
              <span className="install-step-ic" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="m8 8 4-4 4 4" /><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>
              </span>
              <span>Tap the <b>Share</b> button in Safari's toolbar</span>
            </div>
            <div className="install-step">
              <span className="install-step-ic" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
              </span>
              <span>Choose <b>Add to Home Screen</b></span>
            </div>
            <button className="install-done" onClick={dismiss}>Got it</button>
          </div>
        ) : (
          <div className="install-actions">
            <button className="install-later" onClick={dismiss}>Not now</button>
            <button className="install-cta" onClick={install}>Install app</button>
          </div>
        )}
      </div>
    </>
  );
}
