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

// ── Payment soundbox ────────────────────────────────────────────────────────
// A pleasant rising "cash received" chime, then a spoken announcement of the
// amount — the shop's own version of a Paytm/PhonePe soundbox.
export function successChime() {
  unlockAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  [[659, 0], [988, 0.14], [1319, 0.28]].forEach(([freq, dt]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    const t = now + dt;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.36);
  });
  if (navigator.vibrate) navigator.vibrate(90);
}

// Speak a line via the device's own text-to-speech (no bundled audio, so any
// amount can be read). Falls back silently if TTS isn't available.
export function speak(text, lang = "en-IN") {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel(); // don't queue behind a previous announcement
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.95;
    u.pitch = 1;
    u.volume = 1;
    const voices = synth.getVoices() || [];
    const v = voices.find((x) => x.lang === lang)
      || voices.find((x) => (x.lang || "").toLowerCase().startsWith(lang.slice(0, 2)));
    if (v) u.voice = v;
    synth.speak(u);
  } catch { /* no TTS on this device */ }
}

// Chime, then announce "Payment received, <amount> rupees" (the TTS voice reads
// the numeral in its own language, so no manual number-words are needed).
// If a payer name is known (from the name book), it's added: "…from <name>".
export function announcePayment(amount, lang = "en-IN", name = "") {
  successChime();
  const amt = Math.round(Number(amount) || 0);
  const who = String(name || "").trim();
  const text = String(lang).startsWith("hi")
    ? `पेमेंट प्राप्त हुआ, ${amt} रुपये${who ? `, ${who} से` : ""}`
    : `Payment received, ${amt} rupees${who ? ` from ${who}` : ""}`;
  // Let the chime ring first so it doesn't collide with the voice.
  setTimeout(() => speak(text, lang), 480);
}
