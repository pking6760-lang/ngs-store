// Admin push notifications (native Android only). Registers the device with
// Firebase Cloud Messaging, saves the token to the backend so the server can
// alert this phone when a new order arrives, and plays the alarm when a push
// lands while the app is open.
import { supabase } from "./supabase.js";
import { startAlarm } from "./sound.js";

let started = false;

export async function initAdminPush() {
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  if (!cap?.isNativePlatform?.() || !supabase || started) return;
  started = true;

  let PushNotifications;
  try {
    ({ PushNotifications } = await import("@capacitor/push-notifications"));
  } catch {
    return; // plugin not available
  }

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return;

    // High-importance channel so order alerts pop up with sound (Android 8+
    // requires a channel; it must match channel_id sent by the server).
    try {
      await PushNotifications.createChannel({
        id: "orders",
        name: "New orders",
        description: "Alerts when a customer places an order",
        importance: 5,
        visibility: 1,
        vibration: true,
      });
    } catch { /* ignore */ }

    // Fires with the FCM token once registered.
    await PushNotifications.addListener("registration", async (token) => {
      try {
        await supabase.rpc("save_push_token", { p_token: token.value });
      } catch { /* ignore — will retry next launch */ }
    });
    await PushNotifications.addListener("registrationError", () => {});
    // App is OPEN when the push arrives → sound the alarm (the OS shows the
    // banner itself when the app is backgrounded/closed).
    await PushNotifications.addListener("pushNotificationReceived", () => {
      try { startAlarm(); } catch { /* ignore */ }
    });

    await PushNotifications.register();
  } catch {
    /* ignore — push just won't be active */
  }
}
