import { useEffect, useState } from "react";
import { getAppVersion } from "../lib/api.js";

// A persistent "Download the Android app" button that always shows the LATEST
// published version (read live from the app-versions registry the admin updates).
// Only rendered on Android in a browser — hidden inside the native app, on the
// installed PWA, and on non-Android devices (there's no APK for them).
export default function ApkDownloadRow({ app = "customer", className = "" }) {
  const [ver, setVer] = useState(null); // { versionName, apkUrl }

  useEffect(() => {
    let alive = true;
    try {
      if (window.Capacitor) return;                                    // native app already
      if (!/android/i.test(navigator.userAgent || "")) return;         // Android only
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return; // installed PWA
    } catch { return; }
    getAppVersion(app).then((v) => { if (alive && v?.apkUrl) setVer({ versionName: v.versionName, apkUrl: v.apkUrl }); }).catch(() => {});
    return () => { alive = false; };
  }, [app]);

  if (!ver) return null;
  const fileName = app === "partner" ? "NGS-Partner.apk" : "NGS.apk";
  const label = app === "partner" ? "Download the Partner app" : "Download the Android app";

  return (
    <a className={`apk-row ${className}`} href={ver.apkUrl} download={fileName}>
      <span className="apk-row-ic" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" />
        </svg>
      </span>
      <span className="apk-row-txt">
        <b>{label}</b>
        <small>Latest version{ver.versionName ? ` · v${ver.versionName}` : ""}</small>
      </span>
      <span className="apk-row-cta">Get</span>
    </a>
  );
}
