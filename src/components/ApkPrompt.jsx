import { useEffect, useState } from "react";
import { useT } from "../lib/i18n.jsx";

// A one-time "download the Android app" banner, shown ONLY to Android visitors
// on the website — never inside the installed app (Capacitor) or the PWA, and
// snoozed for a week after it's dismissed or the download starts.
// The APK is hosted on Supabase Storage rather than Firebase Hosting: Firebase's
// free (Spark) plan forbids serving executable files (.apk), and doing so blocks
// the whole site deploy. Supabase serves it publicly with the right content-type.
const APK_URL =
  "https://wvlkhvqohkkxlatwotvy.supabase.co/storage/v1/object/public/downloads/ngs.apk";
const SNOOZE_KEY = "ngs_apk_snooze";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export default function ApkPrompt() {
  const { t } = useT();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (window.Capacitor) return;                                   // already the native app
      if (!/android/i.test(navigator.userAgent || "")) return;        // Android only
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return; // installed
      const snoozed = Number(localStorage.getItem(SNOOZE_KEY) || 0);
      if (Date.now() - snoozed < SNOOZE_MS) return;
    } catch { return; }
    const tmr = window.setTimeout(() => setShow(true), 1400);         // let the home settle first
    return () => window.clearTimeout(tmr);
  }, []);

  if (!show) return null;

  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  };

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
        <b>{t("Get the NGS app")}</b>
        <small>{t("Faster, with order alerts & calls")}</small>
      </span>
      <a className="apk-dl" href={APK_URL} download="NGS.apk" onClick={snooze}>{t("Install")}</a>
    </div>
  );
}
