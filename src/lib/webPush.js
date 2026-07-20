// Browser Web Push for the customer website (ngsstore.in) via Firebase Cloud
// Messaging. Registers a dedicated messaging service worker, gets an FCM web
// token, and saves it with the same save_customer_token RPC the native app
// uses — so notify-customer reaches web and app users through one pipeline.
//
// No-op inside the native Capacitor app (that uses customerPush.js), when the
// browser can't do push, or until the VAPID key is configured.
import { supabase } from "./supabase.js";

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY;

let started = false;

export async function initWebPush() {
  if (started) return;
  if (typeof window === "undefined") return;
  if (window.Capacitor?.isNativePlatform?.()) return; // native app handles its own push
  if (!cfg.apiKey || !VAPID || !supabase) return;      // not configured yet
  if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) return;

  try {
    const { isSupported, getMessaging, getToken, onMessage } = await import("firebase/messaging");
    if (!(await isSupported().catch(() => false))) return;

    // Ask for permission. On iOS this only works once the site is installed to
    // the Home Screen (that's what the install prompt is for).
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return;

    started = true;
    const { initializeApp, getApps } = await import("firebase/app");
    const app = getApps().length ? getApps()[0] : initializeApp(cfg);

    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
      scope: "/firebase-cloud-messaging-push-scope",
    });
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: reg });
    if (token) {
      try { await supabase.rpc("save_customer_token", { p_token: token }); } catch { /* retry next visit */ }
    }
    // Foreground message.
    onMessage(messaging, (payload) => {
      const d = payload.data || {};
      if (d.type === "incoming_call") {
        // The app is open — let the CallProvider ring in-app (it also catches
        // this instantly over Realtime; this is a belt-and-braces nudge).
        try { window.dispatchEvent(new CustomEvent("ngs-incoming-call", { detail: d })); } catch { /* ignore */ }
        return;
      }
      const n = payload.notification || {};
      try {
        new Notification(n.title || "NGS Store", { body: n.body || "", icon: "/icon-192.png" });
      } catch { /* ignore */ }
    });
  } catch {
    started = false; // let a later visit retry
  }
}
