import { useEffect, useRef } from "react";

// The apps navigate with React state, not URLs — so the Back button/gesture has
// no history to pop and the OS just exits the app. These helpers give Back
// something to do: each open drawer/modal/sub-view registers a layer, so Back
// closes the TOP-most layer instead of leaving the app. Only at the true home
// does Back exit (with a double-press guard on the native apps).

// A stack of the currently-open layers (top = last). One shared popstate
// listener drives it, so a single Back press only ever closes the top layer.
const stack = [];
let listening = false;
// Set when WE call history.back() ourselves (to consume an entry after a UI
// close) so that self-triggered popstate doesn't also close the layer beneath.
let ignoreNextPop = false;

export const backDepth = () => stack.length;

function onPopState() {
  if (ignoreNextPop) { ignoreNextPop = false; return; }
  const top = stack[stack.length - 1];
  if (top) { top.viaPop = true; top.close(); }
}
function ensureListening() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", onPopState);
}

// Guard one UI layer against Back. While `open` is true, pressing Back runs
// `onBack()` (to close this layer) instead of navigating away. Nesting works.
export function useBackGuard(open, onBack) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    if (!open) return;
    ensureListening();
    const entry = { close: () => cb.current(), viaPop: false };
    stack.push(entry);
    window.history.pushState({ ngsGuard: Date.now() }, "");
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      // Closed by the UI (tapped ✕), not by Back: consume the history entry we
      // pushed so a later Back press doesn't land on a stale entry. Flag it so
      // our own popstate is ignored (it must not close the layer beneath).
      if (!entry.viaPop) { ignoreNextPop = true; window.history.back(); }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Native apps (Capacitor): route the hardware Back button through the same
// stack, and require a double-press to exit at the home screen so Back never
// closes the app by accident. Safe no-op on the plain web.
export async function initHardwareBack(onExitHint) {
  let App;
  try {
    ({ App } = await import("@capacitor/app"));
  } catch {
    return; // not a Capacitor app (customer website) — the browser handles Back
  }
  let lastPress = 0;
  App.addListener("backButton", () => {
    if (stack.length > 0) {
      window.history.back(); // close the top-most open layer
      return;
    }
    const now = Date.now();
    if (now - lastPress < 2000) App.exitApp();
    else { lastPress = now; if (onExitHint) onExitHint(); }
  });
}
