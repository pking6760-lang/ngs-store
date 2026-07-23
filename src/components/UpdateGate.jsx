import { useEffect, useState } from "react";
import { getAppVersion } from "../lib/api.js";

// Forced in-app update. Runs ONLY inside the native app (Capacitor). It reads
// the installed versionCode from the native shell and compares it to the latest
// version the admin has published. If a newer build exists, it renders a
// full-screen, NON-DISMISSIBLE wall over the app: the user must download &
// install the new APK to continue. On the web there's nothing to update, so it
// simply renders the app.
function isNative() {
  return !!(typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.());
}

export default function UpdateGate({ app, children }) {
  const [block, setBlock] = useState(null); // null | { versionName, apkUrl, notes }

  useEffect(() => {
    if (!isNative()) return;
    let alive = true;
    let removeResume = null;

    (async () => {
      let installed = 0;
      try {
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        installed = Number(info?.build) || 0;
        const check = async () => {
          try {
            const v = await getAppVersion(app);
            if (!alive) return;
            if (v && v.apkUrl && Number(v.versionCode) > installed) {
              setBlock({ versionName: v.versionName, apkUrl: v.apkUrl, notes: v.releaseNotes });
            } else {
              setBlock(null); // they've updated → let them back in
            }
          } catch { /* ignore — never lock people out on a network blip */ }
        };
        await check();
        // Re-check every time the app is reopened (e.g. right after installing).
        const sub = await App.addListener("resume", check);
        removeResume = () => { try { sub.remove(); } catch { /* ignore */ } };
      } catch { /* @capacitor/app missing → don't block */ }
    })();

    return () => { alive = false; if (removeResume) removeResume(); };
  }, [app]);

  const install = () => {
    if (!block?.apkUrl) return;
    try { window.open(block.apkUrl, "_system"); }
    catch { try { window.location.href = block.apkUrl; } catch { /* ignore */ } }
  };

  return (
    <>
      {children}
      {block && (
        <div className="upd-gate" role="alertdialog" aria-modal="true" aria-label="Update required">
          <div className="upd-card">
            <span className="upd-ic" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
              </svg>
            </span>
            <h2 className="upd-title">Update required</h2>
            <p className="upd-msg">
              A new version{block.versionName ? ` (v${block.versionName})` : ""} of the NGS app is available.
              Please update to keep using the app.
            </p>
            {block.notes && <div className="upd-notes">{block.notes}</div>}
            <button className="upd-btn" onClick={install}>Download &amp; install update</button>
            <p className="upd-hint">After it installs, reopen the app.</p>
          </div>
        </div>
      )}
    </>
  );
}
