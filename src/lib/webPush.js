// Browser Web Push for the customer website (ngsstore.in) via Firebase Cloud
// Messaging. Registers a dedicated messaging service worker, gets an FCM web
// token, and saves it with the same save_customer_token RPC the native app
// uses — so notify-customer / call-ring reach web and app users through one
// pipeline.
//
// iOS is strict: Web Push only works when the site is INSTALLED to the Home
// Screen and LAUNCHED from that icon (standalone mode), AND the permission
// prompt must be triggered by a real user tap — a prompt on page load is
// silently ignored. So permission is requested from enableCallAlerts() (a tap),
// and initWebPush() only (re)registers the token when permission is already
// granted.
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

let registered = false;

function pushCapable() {
  if (typeof window === "undefined") return false;
  if (window.Capacitor?.isNativePlatform?.()) return false; // native handles its own push
  if (!cfg.apiKey || !VAPID || !supabase) return false;
  return ("serviceWorker" in navigator) && ("Notification" in window) && ("PushManager" in window);
}

// True on desktop/Android always; on iOS only when launched from the Home Screen
// icon (standalone) — iOS blocks Web Push in a normal Safari tab.
export function canReceiveWebPush() {
  if (!pushCapable()) return false;
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIOS) return true;
  const standalone = window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)")?.matches;
  return !!standalone;
}

export function webPushPermission() {
  return (typeof Notification !== "undefined") ? Notification.permission : "denied";
}

// Grab the FCM web token and save it. Assumes permission is already granted.
async function registerWebToken() {
  if (registered || !pushCapable() || Notification.permission !== "granted") return;
  const { isSupported, getMessaging, getToken, onMessage } = await import("firebase/messaging");
  if (!(await isSupported().catch(() => false))) return;
  registered = true;
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
  onMessage(messaging, (payload) => {
    const d = payload.data || {};
    if (d.type === "incoming_call") {
      try { window.dispatchEvent(new CustomEvent("ngs-incoming-call", { detail: d })); } catch { /* ignore */ }
      return;
    }
    const n = payload.notification || {};
    try { new Notification(n.title || "NGS Store", { body: n.body || "", icon: "/icon-192.png" }); } catch { /* ignore */ }
  });
}

// Silent: register the token only if the user has ALREADY allowed notifications.
export async function initWebPush() {
  if (!pushCapable() || Notification.permission !== "granted") return;
  try { await registerWebToken(); } catch { registered = false; }
}

// Call DIRECTLY from a user tap. Requests permission (iOS needs the gesture),
// then registers the token. Returns true if notifications are now on.
export async function enableCallAlerts() {
  if (!pushCapable()) return false;
  try {
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    await registerWebToken();
    return true;
  } catch {
    registered = false;
    return false;
  }
}
