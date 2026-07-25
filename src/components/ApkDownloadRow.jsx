import { useEffect, useState } from "react";
import { getAppVersion } from "../lib/api.js";

// A persistent "Download the Android app" button that always shows the LATEST
// published version (read live from the app-versions registry the admin updates).
//
// Hidden only where the APK is genuinely no use: inside the native app itself,
// and on iPhone/iPad. It DOES show on the home-screen web app — that's the main
// place someone still needs the real APK, because the web app can't do the
// full-screen order alarm or partner calls — and on desktop, so the owner can
// grab the file to share.

// The URL comes from the database. Only an admin can write it, but an href is
// an injection surface (javascript:, data:), so it is checked before rendering.
function safeApkUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

export default function ApkDownloadRow({ app = "customer", className = "" }) {
  const [ver, setVer] = useState(null); // { versionName, apkUrl }

  useEffect(() => {
    let alive = true;
    try {
      // NOTE: window.Capacitor also exists on the WEBSITE (the shim is bundled),
      // so only isNativePlatform() actually means "running inside the APK".
      if (window.Capacitor?.isNativePlatform?.()) return;                  // native app already
      if (/iphone|ipad|ipod/i.test(navigator.userAgent || "")) return;     // an APK can't install on iOS
    } catch { return; }
    getAppVersion(app).then((v) => {
      const href = safeApkUrl(v?.apkUrl);
      if (alive && href) setVer({ versionName: v.versionName, apkUrl: href });
    }).catch(() => {});
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
