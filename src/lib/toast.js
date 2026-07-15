// Minimal transient toast — a small pill at the bottom of the screen. Used for
// lightweight hints like "press back again to exit".
export function toast(msg, ms = 1600) {
  let el = document.getElementById("ngs-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ngs-toast";
    el.style.cssText =
      "position:fixed;left:50%;bottom:70px;transform:translateX(-50%);" +
      "background:rgba(20,26,34,.92);color:#fff;padding:10px 16px;border-radius:999px;" +
      "font-size:13px;font-weight:600;z-index:99999;opacity:0;transition:opacity .2s;" +
      "pointer-events:none;max-width:82vw;text-align:center";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = "0"; }, ms);
}
