import { useEffect, useState } from "react";
import { useT } from "../lib/i18n.jsx";
import { getAppVersion } from "../lib/api.js";

// "Download the Android app" banner, shown ONLY to Android visitors on the
// website — never inside the installed app (Capacitor) or the PWA, and snoozed
// for a week after it's dismissed or the download starts.
//
// The version + APK link are read LIVE from the app-versions registry (the same
// one the admin's "App updates" screen publishes to). So the moment the owner
// publishes a new APK, this browser download offers the latest version too — no
// code change or redeploy needed. `app` selects which app's APK: 'customer' or
// 'partner'.
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export default function ApkPrompt({ app = "customer" }) {
  const { t } = useT();
  const [show, setShow] = useState(false);
  const [ver, setVer] = useState(null); // { versionName, apkUrl }
  const snoozeKey = `ngs_apk_snooze_${app}`;

  useEffect(() => {
    let alive = true;
    try {
      if (window.Capacitor) return;                                   // already the native app
      if (!/android/i.test(navigator.userAgent || "")) return;        // Android only
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return; // installed PWA
      const snoozed = Number(localStorage.getItem(snoozeKey) || 0);
      if (Date.now() - snoozed < SNOOZE_MS) return;
    } catch { return; }
    // Only show once we know there's an APK published for this app.
    getAppVersion(app).then((v) => {
      if (!alive || !v?.apkUrl) return;
      setVer({ versionName: v.versionName, apkUrl: v.apkUrl });
      window.setTimeout(() => alive && setShow(true), 1400);          // let the page settle
    }).catch(() => {});
    return () => { alive = false; };
  }, [app, snoozeKey]);

  if (!show || !ver) return null;

  const snooze = () => {
    try { localStorage.setItem(snoozeKey, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  };

  const fileName = app === "partner" ? "NGS-Partner.apk" : "NGS.apk";
  const title = app === "partner" ? t("Get the NGS Partner app") : t("Get the NGS app");

  return (
    <div className="apk-prompt" role="dialog" aria-label="Download the NGS app">
      <button className="apk-x" onClick={snooze} aria-label="Not now">✕</button>
      <span className="apk-ic" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="30" height="30" fill="none">
          <path d="M19 45.5 V21 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 .8.4 L37.8 37 V21 a1 1 0 0 1 1-1 h3.2 a1 1 0 0 1 1 1 v23.5 a1 1 0 0 1-1 1 h-4 a1 1 0 0 1-.8-.4 L26.2 29 v16.5 a1 1 0 0 1-1 1 H20 a1 1 0 0 1-1-1 z" fill="#fff" />
          <path d="M43.5 19.2 c1.2 -4.4 5 -6.7 9.3 -6.4 c.4 4.3 -2.2 8.4 -6.6 9.1 c-1 .16 -2 .12 -2.9 -.1 z" fill="#bdf0d0" />
        </svg>
      </span>
      <span className="apk-txt">
        <b>{title}{ver.versionName ? ` v${ver.versionName}` : ""}</b>
        <small>{t("Faster, with order alerts & calls")}</small>
      </span>
      <a className="apk-dl" href={ver.apkUrl} download={fileName} onClick={snooze}>{t("Install")}</a>
    </div>
  );
}
