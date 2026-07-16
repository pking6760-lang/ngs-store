// A loud, repeating alarm for the incoming-order screen — generated with the
// Web Audio API so no audio file needs bundling. Browsers require a user
// gesture before audio can play, so call unlockAudio() from a click (we do
// this on admin login) to prime it.
let ctx = null;
let timer = null;

export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    /* audio not available */
  }
}

function beep() {
  if (!ctx) return;
  const now = ctx.currentTime;
  // Two-tone chirp so it sounds like an alert, not a flat tone.
  [880, 1320].forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = freq;
    const t = now + i * 0.18;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.18);
  });
}

export function startAlarm() {
  unlockAudio();
  if (!ctx || timer) return;
  beep();
  timer = setInterval(beep, 1100);
  // Buzz the phone too, if supported.
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
}

// Short "beep-beep" error buzz for a wrong barcode scan (two low square blips
// + a double vibrate). Distinct from the alarm so a mis-scan is unmistakable.
export function errorBeep() {
  unlockAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  [230, 190].forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = freq;
    const t = now + i * 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.2);
  });
  if (navigator.vibrate) navigator.vibrate([120, 70, 120]);
}

// A single short confirming blip for a correct scan.
export function okBeep() {
  unlockAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = 1040;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(now);
  o.stop(now + 0.13);
  if (navigator.vibrate) navigator.vibrate(40);
}

export function stopAlarm() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (navigator.vibrate) navigator.vibrate(0);
}
