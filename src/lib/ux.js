// Small UX helpers so instant operations still feel like a real app: a brief,
// randomised loading beat (never the same twice) that runs alongside the real
// work, so the spinner shows for a natural moment even when the backend is fast.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A random duration in [min, max) — keeps loading feeling organic.
export const randMs = (min = 600, max = 1500) => min + Math.random() * (max - min);

// Run an async action but keep it "loading" for at least a random beat.
export async function withMinTime(fn, min = 600, max = 1500) {
  const [res] = await Promise.all([
    Promise.resolve().then(fn),
    sleep(randMs(min, max)),
  ]);
  return res;
}

// Copy text to the clipboard. Returns true only if it really went in.
//
// navigator.clipboard is undefined outside a secure context and can reject
// without a user gesture, and some Android WebViews block it outright. The
// caller MUST be able to tell — this is used for bank account numbers, where a
// silent failure means pasting whatever was on the clipboard before into a
// payment app. Hence the execCommand fallback and the honest boolean.
export async function copyText(text) {
  const s = String(text ?? "");
  if (!s) return false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(s); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, s.length);   // iOS needs the explicit range
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch { return false; }
}
