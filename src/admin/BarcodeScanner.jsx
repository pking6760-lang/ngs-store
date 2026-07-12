import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import AdminPortal from "./AdminPortal.jsx";

// Live camera barcode scanner for the admin. Uses ZXing entirely in the WebView
// (no native plugin), the rear camera, and only the retail 1-D formats a
// product carries (EAN / UPC / Code-128) so it locks on fast. On success it
// hands the digits back and closes; if the camera can't start, it offers a
// manual-entry fallback so the flow never dead-ends.
const RETAIL_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
];

export default function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const doneRef = useRef(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");

  useEffect(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, RETAIL_FORMATS);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
    let cancelled = false;

    (async () => {
      try {
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result, _err, ctrl) => {
            if (result && !doneRef.current) {
              doneRef.current = true;
              ctrl.stop();
              // Small haptic-style pause so the frame flash is visible.
              onDetected(result.getText());
            }
          }
        );
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      } catch (e) {
        setError(
          e?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access for NGS Admin in your phone settings, or type the barcode below."
            : "Couldn't start the camera. Type the barcode below instead."
        );
      }
    })();

    return () => {
      cancelled = true;
      try { controlsRef.current?.stop(); } catch { /* already stopped */ }
    };
  }, [onDetected]);

  function submitManual(e) {
    e.preventDefault();
    const code = manual.replace(/\D/g, "");
    if (code.length >= 6) onDetected(code);
  }

  return (
    <AdminPortal>
      <div className="scan-overlay">
        <div className="scan-head">
          <span>Scan product barcode</span>
          <button type="button" className="scan-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!error ? (
          <div className="scan-stage">
            <video ref={videoRef} className="scan-video" muted playsInline />
            <div className="scan-frame">
              <span className="scan-corner tl" /><span className="scan-corner tr" />
              <span className="scan-corner bl" /><span className="scan-corner br" />
              <div className="scan-laser" />
            </div>
            <p className="scan-hint">Point the camera at the barcode</p>
          </div>
        ) : (
          <div className="scan-error">
            <p>{error}</p>
          </div>
        )}

        <form className="scan-manual" onSubmit={submitManual}>
          <input
            inputMode="numeric"
            placeholder="or type barcode digits"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button type="submit" disabled={manual.replace(/\D/g, "").length < 6}>Use</button>
        </form>
      </div>
    </AdminPortal>
  );
}
