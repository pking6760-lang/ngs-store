// Customer push notifications (native Android app). Registers the device with
// Firebase Cloud Messaging and saves the token so the shop can push order
// updates, offers and admin messages. A normal (non-alarm) channel. Inactive on
// the web build (Capacitor plugin is native-only) — web push is separate.
import { supabase } from "./supabase.js";

let started = false;

export async function initCustomerPush() {
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

    // A normal heads-up channel for order updates & messages (not the loud
    // order-alarm the shop/riders use).
    try {
      await PushNotifications.createChannel({
        id: "ngs_updates",
        name: "Order updates & offers",
        description: "Order status and messages from NGS Store",
        importance: 4,
        visibility: 1,
      });
    } catch { /* ignore */ }

    await PushNotifications.addListener("registration", async (token) => {
      try { await supabase.rpc("save_customer_token", { p_token: token.value }); } catch { /* retry next launch */ }
    });
    await PushNotifications.addListener("registrationError", () => {});
    // App open when a push arrives → let the OS show it, except an incoming call:
    // wake the in-app ring immediately.
    await PushNotifications.addListener("pushNotificationReceived", (n) => {
      if (n?.data?.type === "incoming_call") {
        try { window.dispatchEvent(new CustomEvent("ngs-incoming-call", { detail: n.data })); } catch { /* ignore */ }
      }
    });
    // Tapping the call notification (app was backgrounded) → open + ring.
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
