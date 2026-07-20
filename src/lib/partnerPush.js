// NGS Partner push notifications (native Android). Registers the device with
// Firebase Cloud Messaging, saves the token so the server can ring this phone
// the instant an order is assigned, and sounds the loud alarm when a push
// lands while the app is open. Inactive until google-services.json is present.
import { supabase } from "./supabase.js";
import { startAlarm } from "./sound.js";

let started = false;

export async function initPartnerPush() {
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

    // Max-importance alarm channel that rings a LOUD, long siren even when the
    // phone is locked / the app is closed — so a rider never misses an assigned
    // order. A channel's sound is fixed at creation, so this uses a fresh id
    // (the server sends this same channel_id). res/raw/alarm.ogg is a ~24s siren.
    try {
      await PushNotifications.createChannel({
        id: "orders_alarm_v2",
        name: "New order alarm",
        description: "Loud alarm when you're assigned an order",
        importance: 5,
        visibility: 1,
        sound: "alarm.ogg",
        vibration: true,
      });
    } catch { /* ignore */ }

    await PushNotifications.addListener("registration", async (token) => {
      try { await supabase.rpc("save_partner_token", { p_token: token.value }); } catch { /* retry next launch */ }
    });
    await PushNotifications.addListener("registrationError", () => {});
    // App OPEN when a push arrives. An incoming voice call rings in-app (not the
    // order siren); everything else sounds the looping order alarm.
    await PushNotifications.addListener("pushNotificationReceived", (n) => {
      if (n?.data?.type === "incoming_call") {
        try { window.dispatchEvent(new CustomEvent("ngs-incoming-call", { detail: n.data })); } catch { /* ignore */ }
        return;
      }
      try { startAlarm(); } catch { /* ignore */ }
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
      if (a?.notification?.data?.type === "incoming_call") {
        try { window.dispatchEvent(new CustomEvent("ngs-incoming-call", { detail: a.notification.data })); } catch { /* ignore */ }
      }
    });

    await PushNotifications.register();
  } catch {
    /* ignore — push just won't be active */
  }
}
