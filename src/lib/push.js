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

    // Max-importance channel that rings a LOUD, long alarm sound even when the
    // phone is locked / the app is closed — so the owner never sleeps through an
    // order. A channel's sound is fixed at creation, so this uses a fresh id
    // (the server sends this same channel_id). res/raw/alarm.ogg is a ~24s siren.
    try {
      await PushNotifications.createChannel({
        id: "orders_alarm",
        name: "New order alarm",
        description: "Loud alarm when a customer places an order",
        importance: 5,
        visibility: 1,
        sound: "alarm.ogg",
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
