import { useCallback, useEffect, useRef, useState } from "react";

// Live selfie + liveness check for KYC. The partner is shown a RANDOM sequence
// of head-motion prompts (blink, turn left/right, look up/down). The whole
// session is recorded to a short video (so a reviewer can confirm the person
// followed the live, randomised prompts — a pre-recorded clip can't), live
// motion is measured to reject a held-up static photo, and a still selfie is
// grabbed at the end. Returns { photoBlob, videoBlob }.

const DIRS = ["left", "right", "up", "down"];
const PROMPT = {
  blink: "Blink your eyes",
  left: "Slowly turn your head to the LEFT",
  right: "Slowly turn your head to the RIGHT",
  up: "Lift your chin — look UP",
  down: "Lower your chin — look DOWN",
};
// Directional arrow icons (SVG, no emoji).
function ArrowIcon({ dir }) {
  const rot = { left: 180, right: 0, up: -90, down: 90, blink: 0 }[dir] || 0;
  if (dir === "blink") {
    return (
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function buildChallenges() {
  const shuffled = [...DIRS].sort(() => Math.random() - 0.5).slice(0, 3);
  const seq = ["blink", ...shuffled];
  return seq.sort(() => Math.random() - 0.5); // randomise order too
}

const STEP_MS = 2600; // time shown per prompt

export default function LivenessCapture({ onComplete, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const motionRef = useRef({ total: 0, prev: null }); // accumulated motion
  const rafRef = useRef(null);
  const sampleCanvas = useRef(null);

  const [phase, setPhase] = useState("intro"); // intro | running | processing | done | error
  const [challenges] = useState(buildChallenges);
  const [stepIdx, setStepIdx] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { photoUrl, photoBlob, videoBlob }

  const stopEverything = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try { recorderRef.current && recorderRef.current.state !== "inactive" && recorderRef.current.stop(); } catch { /* ignore */ }
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopEverything(), [stopEverything]);

  // Continuous motion sampling (frame differencing on a tiny grayscale canvas).
  const sampleLoop = useCallback(() => {
    const v = videoRef.current;
    const c = sampleCanvas.current;
    if (v && c && v.readyState >= 2) {
      const w = 48, h = 36;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const gray = new Float32Array(w * h);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      const prev = motionRef.current.prev;
      if (prev) {
        let sum = 0;
        for (let i = 0; i < gray.length; i++) sum += Math.abs(gray[i] - prev[i]);
        motionRef.current.total += sum / gray.length;
      }
      motionRef.current.prev = gray;
    }
    rafRef.current = requestAnimationFrame(sampleLoop);
  }, []);

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      // Record the session.
      chunksRef.current = [];
      const mime = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      recorderRef.current = rec;
      rec.start();

      motionRef.current = { total: 0, prev: null };
      rafRef.current = requestAnimationFrame(sampleLoop);
      setPhase("running");
      setStepIdx(0);
      runStep(0);
    } catch (e) {
      setError(e?.name === "NotAllowedError"
        ? "Camera permission denied. Please allow camera access and try again."
        : "Couldn't start the camera. Make sure no other app is using it.");
      setPhase("error");
    }
  }

  function runStep(i) {
    if (i >= challenges.length) return finish();
    setStepIdx(i);
    let left = Math.ceil(STEP_MS / 1000);
    setCountdown(left);
    const tick = setInterval(() => { left -= 1; setCountdown(left); if (left <= 0) clearInterval(tick); }, 1000);
    setTimeout(() => { clearInterval(tick); runStep(i + 1); }, STEP_MS);
  }

  function grabPhoto() {
    const v = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 480;
    canvas.height = v.videoHeight || 640;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.9));
  }

  async function finish() {
    setPhase("processing");
    const photoBlob = await grabPhoto();
    // Finalise the recording.
    const rec = recorderRef.current;
    const videoBlob = await new Promise((resolve) => {
      if (!rec || rec.state === "inactive") return resolve(new Blob(chunksRef.current, { type: "video/webm" }));
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: rec.mimeType || "video/webm" }));
      rec.stop();
    });
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());

    // Liveness gate: a real moving face produces plenty of frame motion; a held
    // static photo produces almost none.
    if (motionRef.current.total < 12) {
      setError("We couldn't detect live movement. Please retry and follow the on-screen prompts with your real face.");
      setPhase("error");
      return;
    }
    setResult({ photoBlob, videoBlob, photoUrl: URL.createObjectURL(photoBlob) });
    setPhase("done");
  }

  function retry() {
    stopEverything();
    setResult(null);
    setError("");
    setPhase("intro");
  }

  const cur = challenges[stepIdx];

  return (
    <div className="live-kyc">
      <div className="live-kyc-head">
        <button className="back-btn small" onClick={() => { stopEverything(); onCancel(); }} aria-label="Back">←</button>
        <h3>Live selfie verification</h3>
      </div>

      {phase === "intro" && (
        <div className="live-kyc-intro">
          <div className="live-kyc-face">
            <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="9" r="4" /><path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
            </svg>
          </div>
          <h4>Quick face check</h4>
          <p>Hold your phone at eye level in good light. Follow the prompts — you'll be asked to blink and move your head. It takes about 10 seconds.</p>
          <ul className="live-kyc-tips">
            <li>Remove masks, sunglasses or caps</li>
            <li>Keep only your face in the frame</li>
            <li>Stay in a well-lit spot</li>
          </ul>
          <button className="pd-btn" onClick={start}>Start face check</button>
        </div>
      )}

      {(phase === "running" || phase === "processing") && (
        <div className="live-kyc-stage">
          <div className="live-kyc-cam">
            <video ref={videoRef} playsInline muted className="live-kyc-video" />
            <div className="live-kyc-ring" />
          </div>
          {phase === "running" ? (
            <div className="live-kyc-prompt">
              <div className="live-kyc-arrow"><ArrowIcon dir={cur} /></div>
              <div className="live-kyc-instr">{PROMPT[cur]}</div>
              <div className="live-kyc-count">{countdown}</div>
              <div className="live-kyc-dots">
                {challenges.map((_, i) => <span key={i} className={i < stepIdx ? "done" : i === stepIdx ? "on" : ""} />)}
              </div>
            </div>
          ) : (
            <div className="live-kyc-instr">Processing…</div>
          )}
        </div>
      )}

      {phase === "done" && result && (
        <div className="live-kyc-done">
          <img src={result.photoUrl} alt="Selfie" className="live-kyc-shot" />
          <div className="live-kyc-ok">✓ Face captured</div>
          <p>Make sure your face is clear and well-lit.</p>
          <div className="live-kyc-actions">
            <button className="ghost-btn" onClick={retry}>Retake</button>
            <button className="pd-btn" onClick={() => onComplete({ photoBlob: result.photoBlob, videoBlob: result.videoBlob })}>Use this</button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="live-kyc-done">
          <div className="live-kyc-err">{error}</div>
          <button className="pd-btn" onClick={retry}>Try again</button>
        </div>
      )}

      <canvas ref={sampleCanvas} width="48" height="36" style={{ display: "none" }} />
    </div>
  );
}
