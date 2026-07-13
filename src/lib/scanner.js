import { BarcodeScanner } from "@capacitor-mlkit/barcode-scanning";

// Native barcode scanning via Google ML Kit. Uses the built-in Google code
// scanner UI on Android (fast, focuses/decodes on-device). Returns the scanned
// digits, or null if the user backed out. Throws with a friendly message when
// the camera is blocked or the device can't scan (the caller then offers manual
// entry).

// The Google code-scanner module is delivered by Play Services on first use.
// Make sure it's present before scanning so the first tap doesn't fail.
async function ensureModule() {
  let available = true;
  try {
    ({ available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable());
  } catch {
    return; // check not supported here → assume the scanner is ready
  }
  if (available) return;
  await new Promise((resolve) => {
    let done = false;
    let handle;
    const finish = () => {
      if (done) return;
      done = true;
      try { handle && handle.remove(); } catch { /* ignore */ }
      resolve();
    };
    (async () => {
      try {
        handle = await BarcodeScanner.addListener(
          "googleBarcodeScannerModuleInstallProgress",
          (p) => { if ([3, 4, 5].includes(p.state)) finish(); } // canceled / completed / failed
        );
        await BarcodeScanner.installGoogleBarcodeScannerModule();
      } catch {
        finish();
      }
      setTimeout(finish, 15000); // never hang if no progress arrives
    })();
  });
}

export async function scanBarcode() {
  const supported = await BarcodeScanner.isSupported().then((r) => r.supported).catch(() => false);
  if (!supported) {
    throw new Error("This device can't scan barcodes — type it in instead.");
  }
  const perm = await BarcodeScanner.requestPermissions();
  if (perm.camera !== "granted" && perm.camera !== "limited") {
    throw new Error("Camera is off for NGS Admin. Turn it on in your phone Settings, or type the barcode.");
  }
  await ensureModule();
  const { barcodes } = await BarcodeScanner.scan();
  return barcodes && barcodes.length ? barcodes[0].rawValue : null;
}
