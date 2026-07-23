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
  const [dl, setDl] = useState(null);       // null | number(0-100) | 'opening' | 'error'

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

  const openInBrowser = () => {
    try { window.open(block.apkUrl, "_system"); }
    catch { try { window.location.href = block.apkUrl; } catch { /* ignore */ } }
  };

  const install = async () => {
    if (!block?.apkUrl) return;
    if (dl !== null && dl !== "error") return; // already working
    // Native: download the APK inside the app, then hand it straight to
    // Android's package installer — no browser tab.
    if (isNative()) {
      let sub = null;
      try {
        setDl(0);
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { FileOpener } = await import("@capacitor-community/file-opener");
        try {
          sub = await Filesystem.addListener("progress", (p) => {
            const total = Number(p?.contentLength) || 0;
            if (total > 0) setDl(Math.min(99, Math.round((Number(p.bytes) / total) * 100)));
          });
        } catch { /* progress is best-effort */ }
        const res = await Filesystem.downloadFile({
          url: block.apkUrl,
          path: `ngs-update-${Date.now()}.apk`,
          directory: Directory.Cache,
          progress: true,
        });
        if (sub) { try { await sub.remove(); } catch { /* ignore */ } sub = null; }
        setDl("opening");
        await FileOpener.open({ filePath: res.uri || res.path, contentType: "application/vnd.android.package-archive" });
        setDl(null); // installer is up; when they return, resume-check re-runs
        return;
      } catch {
        if (sub) { try { await sub.remove(); } catch { /* ignore */ } }
        setDl("error"); // fall back to the browser download below
        openInBrowser();
        return;
      }
    }
    openInBrowser();
  };

  const btnLabel =
    dl === "opening" ? "Opening installer…"
      : typeof dl === "number" ? `Downloading… ${dl}%`
        : dl === "error" ? "Retry download"
          : "Download & install update";

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
            {typeof dl === "number" && (
              <div className="upd-bar"><span style={{ width: `${dl}%` }} /></div>
            )}
            <button className="upd-btn" onClick={install}
              disabled={typeof dl === "number" || dl === "opening"}>
              {btnLabel}
            </button>
            <p className="upd-hint">
              {dl === "opening" ? "Tap Install when Android asks."
                : typeof dl === "number" ? "Downloading the update…"
                  : "Tap to download and install the latest version."}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
