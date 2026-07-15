// Fingerprint / face-unlock login via the device's biometric hardware.
// Uses the native plugin on the Android app; on a plain web browser the plugin
// isn't available, so these helpers report "unavailable" and the UI hides the
// fingerprint button.
//
// Note: we resolve to a plain { plugin } wrapper (never the Capacitor plugin
// proxy directly) — returning the proxy from an async function makes JS try to
// "unwrap" it as a thenable, which errors on web.
import { Capacitor } from "@capacitor/core";

let pluginPromise;

// True inside the installed Android app (false in a plain web browser). We show
// the fingerprint button whenever we're in the app, then handle "no fingerprint
// set up" when the user taps it — rather than hiding the button on a strict
// availability check that some phones report inconsistently.
export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function loadPlugin() {
  if (!pluginPromise) {
    pluginPromise = import("capacitor-native-biometric")
      .then((m) => ({ plugin: m.NativeBiometric || null }))
      .catch(() => ({ plugin: null }));
  }
  return pluginPromise;
}

// True only when the phone has biometrics set up (and we're in the native app).
export async function isBiometricAvailable() {
  const { plugin } = await loadPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.isAvailable({ useFallback: true });
    return !!result?.isAvailable;
  } catch {
    return false;
  }
}

// Shows the OS fingerprint prompt. Resolves true if the user is verified.
export async function authenticateBiometric() {
  const { plugin } = await loadPlugin();
  if (!plugin) return false;
  try {
    await plugin.verifyIdentity({
      title: "NGS Admin",
      subtitle: "Confirm your fingerprint",
      description: "Unlock the dashboard",
      useFallback: true, // let the user fall back to the device PIN
    });
    return true;
  } catch {
    return false;
  }
}

// ── Secure credential storage (so fingerprint can actually sign in) ──────────
// The admin's email + password are stored encrypted on the device and only
// released behind the fingerprint, so tapping "Login with fingerprint" can
// retrieve them and open a real Supabase session.
const CRED_SERVER = "ngs-admin";

export async function storeCredentials(username, password) {
  const { plugin } = await loadPlugin();
  if (!plugin) return false;
  try {
    await plugin.setCredentials({ username, password, server: CRED_SERVER });
    return true;
  } catch {
    return false;
  }
}

export async function hasStoredCredentials() {
  const { plugin } = await loadPlugin();
  if (!plugin) return false;
  try {
    const c = await plugin.getCredentials({ server: CRED_SERVER });
    return !!(c && c.password);
  } catch {
    return false;
  }
}

export async function getStoredCredentials() {
  const { plugin } = await loadPlugin();
  if (!plugin) return null;
  try {
    return await plugin.getCredentials({ server: CRED_SERVER });
  } catch {
    return null;
  }
}

export async function clearStoredCredentials() {
  const { plugin } = await loadPlugin();
  if (!plugin) return;
  try {
    await plugin.deleteCredentials({ server: CRED_SERVER });
  } catch {
    /* ignore */
  }
}
