import { useEffect, useState } from "react";

// "Add to Home Screen" prompt for the website (PWA). Two flavours:
//  • Android/Chrome fires `beforeinstallprompt` → we show a one-tap Install button.
//  • iOS Safari has no such event → we show the manual "Share → Add to Home
//    Screen" instructions with a pointer to the Share button.
// It never shows inside the native Capacitor app, or once the PWA is installed
// (standalone), and it backs off for a few days after the user dismisses it.

// Forceful "Add to Home Screen": we want it to reappear on EVERY visit until
// the customer actually installs — not a multi-day snooze. So dismissal is only
// for the current tab session (sessionStorage); opening the site again re-shows
// it. Once installed (standalone) it never shows.
const SESSION_KEY = "ngs_install_dismissed";

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
  try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
}
function snooze() {
  try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ }
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [deferred, setDeferred] = useState(null);

  useEffect(() => {
    // Android gets the native-APK download prompt instead (ApkPrompt), so the
    // PWA "add to home screen" banner only runs on iOS / desktop.
    if (isNativeApp() || isStandalone() || snoozed()) return;
    if (/android/i.test(navigator.userAgent || "")) return;

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

    // iOS never fires beforeinstallprompt — show the manual guide quickly.
    // Android usually fires beforeinstallprompt; if it's throttled and hasn't
    // fired shortly, still show a manual "browser menu → Install" guide so the
    // prompt appears on every visit regardless.
    let t = 0;
    if (isIOS()) {
      t = window.setTimeout(() => { setIos(true); setShow(true); }, 700);
    } else {
      t = window.setTimeout(() => {
        setShow((cur) => {
          if (cur) return cur;      // beforeinstallprompt already showed it
          setIos(false);
          return true;              // manual fallback (Install button no-ops → guide)
        });
      }, 2500);
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
        ) : deferred ? (
          <div className="install-actions">
            <button className="install-later" onClick={dismiss}>Not now</button>
            <button className="install-cta" onClick={install}>Install app</button>
          </div>
        ) : (
          <div className="install-ios">
            <div className="install-step">
              <span className="install-step-ic" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
              </span>
              <span>Open your browser menu (<b>⋮</b> top-right)</span>
            </div>
            <div className="install-step">
              <span className="install-step-ic" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
              </span>
              <span>Tap <b>Install app</b> / <b>Add to Home screen</b></span>
            </div>
            <button className="install-done" onClick={dismiss}>Got it</button>
          </div>
        )}
      </div>
    </>
  );
}
