// "Recently viewed" — a purely local memory of the products this device opened.
//
// It lives only in localStorage: no server, no account needed, nothing leaves
// the phone. We keep an ordered list of product ids (most recent first, no
// duplicates, capped) and let the home screen resolve those ids against the
// live catalogue — so anything since gone out of stock simply drops out.

const KEY = "ngs.recentViews";
const CAP = 20;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function write(ids) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(0, CAP)));
  } catch {
    /* private mode / quota — recently-viewed is a nicety, never fatal */
  }
}

// Note that this device just looked at a product. Newest wins: an id already in
// the list moves to the front rather than duplicating.
export function recordView(id) {
  if (id == null) return;
  const key = String(id);
  if (!key) return;
  const next = [key, ...read().filter((x) => x !== key)];
  write(next);
  try {
    window.dispatchEvent(new Event("ngs:recent-views"));
  } catch {
    /* no window (SSR/tests) — the write still stuck */
  }
}

// The ordered ids, most-recent first. The caller resolves them to products.
export function getRecentIds() {
  return read();
}

export function clearRecentViews() {
  write([]);
  try {
    window.dispatchEvent(new Event("ngs:recent-views"));
  } catch {
    /* ignore */
  }
}
