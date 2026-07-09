// Fingerprint / face-unlock login via the device's biometric hardware.
// Uses the native plugin on the Android app; on a plain web browser the plugin
// isn't available, so these helpers report "unavailable" and the UI hides the
// fingerprint button.
//
// Note: we resolve to a plain { plugin } wrapper (never the Capacitor plugin
// proxy directly) — returning the proxy from an async function makes JS try to
// "unwrap" it as a thenable, which errors on web.
let pluginPromise;

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
