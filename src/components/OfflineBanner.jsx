import { useEffect, useState } from "react";
import { useT } from "../lib/i18n.jsx";

// A small, unobtrusive connectivity banner. Shows "You're offline" while the
// device has no network, and a brief "Back online" confirmation when it
// returns. Uses the browser's online/offline events (instant) — the live data
// hooks already refetch on reconnect/focus, so nothing else is needed.
export default function OfflineBanner() {
  const { t } = useT();
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [justBack, setJustBack] = useState(false);

  useEffect(() => {
    const goOffline = () => { setOffline(true); setJustBack(false); };
    const goOnline = () => {
      setOffline(false);
      setJustBack(true);
      window.setTimeout(() => setJustBack(false), 2200);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline && !justBack) return null;

  return (
    <div className={`net-banner ${offline ? "off" : "on"}`} role="status" aria-live="polite">
      <span className="net-dot" />
      {offline ? (
        <span className="net-txt"><strong>{t("You're offline")}</strong> · {t("Check your connection — we'll reconnect automatically.")}</span>
      ) : (
        <span className="net-txt"><strong>{t("Back online")}</strong></span>
      )}
    </div>
  );
}
