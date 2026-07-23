// Web Push for the NGS Partner web app (ngsstore.in/partner) via Firebase Cloud
// Messaging — so a partner on iPhone/desktop (no native app) still gets a
// notification the instant an order is assigned. It gets an FCM web token and
// saves it with the SAME save_partner_token RPC the native app uses, so the
// existing notify-partner / dispatch pipeline reaches web and app riders alike.
//
// iOS rules (strict): Web Push works ONLY when the app is INSTALLED to the Home
// Screen and LAUNCHED from that icon (standalone), AND the permission prompt is
// triggered by a real user tap. So permission is requested from
// enablePartnerAlerts() (a tap); initPartnerWebPush() only silently (re)saves
// the token when permission is already granted.
//
// No-op inside the native Capacitor app (that uses partnerPush.js), when the
// browser can't do push, or until the VAPID key is configured.
import { supabase } from "./supabase.js";
import { startAlarm } from "./sound.js";

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

function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.navigator.standalone === true ||
    !!window.matchMedia?.("(display-mode: standalone)")?.matches;
}

// True on desktop/Android always; on iOS only when launched from the Home Screen
// icon (standalone) — iOS blocks Web Push in a normal Safari tab.
export function canReceivePartnerWebPush() {
  if (!pushCapable()) return false;
  return isIOS() ? isStandalone() : true;
}

// For the UI: is this an iOS Safari tab that still needs "Add to Home Screen"
// before push can be enabled at all?
export function partnerNeedsHomeScreen() {
  if (!pushCapable()) return false;
  return isIOS() && !isStandalone();
}

export function partnerWebPushPermission() {
  return (typeof Notification !== "undefined") ? Notification.permission : "denied";
}

// Grab the FCM web token and save it against the partner. Assumes permission
// is already granted.
async function registerPartnerWebToken() {
  if (registered || !pushCapable() || Notification.permission !== "granted") return false;
  const { isSupported, getMessaging, getToken, onMessage } = await import("firebase/messaging");
  if (!(await isSupported().catch(() => false))) return false;
  registered = true;
  const { initializeApp, getApps } = await import("firebase/app");
  const app = getApps().length ? getApps()[0] : initializeApp(cfg);
  const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
    scope: "/firebase-cloud-messaging-push-scope",
  });
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID, serviceWorkerRegistration: reg });
  if (!token) { registered = false; return false; }
  try { await supabase.rpc("save_partner_token", { p_token: token }); } catch { /* retry next visit */ }

  // App is OPEN when the push lands: an assigned order rings the loud in-app
  // alarm; an incoming voice call is handed to the call UI.
  onMessage(messaging, (payload) => {
    const d = payload.data || {};
    if (d.type === "incoming_call") {
      try { window.dispatchEvent(new CustomEvent("ngs-incoming-call", { detail: d })); } catch { /* ignore */ }
      return;
    }
    try { startAlarm(); } catch { /* ignore */ }
    const title = d.title || payload.notification?.title || "🛵 New order!";
    const body = d.body || payload.notification?.body || "Tap to accept";
    try { new Notification(title, { body, icon: "/icon-192.png", tag: "ngs-new-task", renotify: true }); } catch { /* ignore */ }
  });
  return true;
}

// Silent: save the token only if the partner has ALREADY allowed notifications.
export async function initPartnerWebPush() {
  if (!pushCapable() || Notification.permission !== "granted") return;
  try { await registerPartnerWebToken(); } catch { registered = false; }
}

// Call DIRECTLY from a user tap. Requests permission (iOS needs the gesture),
// then saves the token. Returns true if notifications are now on.
export async function enablePartnerAlerts() {
  if (!pushCapable()) return false;
  try {
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    return await registerPartnerWebToken();
  } catch {
    registered = false;
    return false;
  }
}
