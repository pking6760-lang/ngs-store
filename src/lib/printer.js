// Thermal printer over Bluetooth (classic SPP) via cordova-plugin-bluetooth-serial.
// Native Android only. The chosen printer is remembered in localStorage. We send
// raw ESC/POS command bytes (58mm, 32 characters per line).

const KEY = "ngs-printer-v1";

function bt() {
  return typeof window !== "undefined" ? window.bluetoothSerial : null;
}

// Is Bluetooth thermal printing available (i.e. running in the native app)?
export function isPrinterSupported() {
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  return !!(bt() && cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
}

function call(method, arg) {
  return new Promise((resolve, reject) => {
    const b = bt();
    if (!b) return reject(new Error("Bluetooth not available on this device."));
    const ok = (r) => resolve(r);
    const err = (e) => reject(new Error(typeof e === "string" ? e : "Bluetooth error."));
    if (arg === undefined) b[method](ok, err);
    else b[method](arg, ok, err);
  });
}

// Paired Bluetooth devices → [{ name, address, id }]
export function listPairedPrinters() {
  return call("list");
}

export function savedPrinter() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export function savePrinter(dev) {
  try { localStorage.setItem(KEY, JSON.stringify({ name: dev.name, address: dev.address })); } catch { /* ignore */ }
}

async function isConnected() {
  try { await call("isConnected"); return true; } catch { return false; }
}

function connectPrinter(address) {
  return new Promise((resolve, reject) => {
    const b = bt();
    if (!b) return reject(new Error("Bluetooth not available."));
    let settled = false;
    b.connect(
      address,
      () => { if (!settled) { settled = true; resolve(); } },
      (e) => { if (!settled) { settled = true; reject(new Error(typeof e === "string" ? e : "Couldn't connect to the printer.")); } },
    );
  });
}

async function ensureConnected(address) {
  if (await isConnected()) return;
  await connectPrinter(address);
  // Give the socket a moment to settle before writing.
  await new Promise((r) => setTimeout(r, 400));
}

function writeBytes(uint8) {
  return call("write", uint8);
}

// Connect (if needed) and print the receipt for an order.
export async function printReceiptBluetooth(order, shop, address) {
  const addr = address || savedPrinter()?.address;
  if (!addr) throw new Error("No printer selected.");
  await ensureConnected(addr);
  await writeBytes(buildReceiptBytes(order, shop));
}

/* ─── ESC/POS receipt (58mm, 32 cols) ──────────────────────────────────────── */
const W = 32;
const enc = (s) => Array.from(String(s), (c) => c.charCodeAt(0) & 0xff);
const line = (s = "") => [...enc(s), 0x0a];
const padR = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n) : s + " ".repeat(n - s.length); };
const padL = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n) : " ".repeat(n - s.length) + s; };
function lr(l, r, w = W) {
  const rs = String(r);
  const ls = String(l).slice(0, Math.max(0, w - rs.length - 1));
  return ls + " ".repeat(Math.max(1, w - ls.length - rs.length)) + rs;
}
function fmt(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
}

export function buildReceiptBytes(order, shop) {
  const b = [];
  const p = (arr) => { for (const x of arr) b.push(x); };
  const feed = (n = 1) => p([0x1b, 0x64, n]);   // blank lines
  const rule = () => p(line("-".repeat(W)));
  const rs = (v) => "Rs " + Math.round(Number(v) || 0);

  p([0x1b, 0x40]);                 // initialise
  p([0x1b, 0x33, 40]);             // line spacing ~40 dots (a bit airier)

  // ── Header (centered) ──
  p([0x1b, 0x61, 1]);
  p([0x1d, 0x21, 0x11]); p([0x1b, 0x45, 1]); p(line(shop.brand)); p([0x1b, 0x45, 0]); p([0x1d, 0x21, 0x00]);
  feed(1);
  p([0x1b, 0x45, 1]); p(line(shop.name)); p([0x1b, 0x45, 0]);
  p(line(shop.address));
  if (shop.phone) p(line("Ph: " + shop.phone));
  p([0x1b, 0x61, 0]);              // back to left
  feed(1);
  rule();

  // ── Order info ──
  p(line(lr("Bill No", order.id)));
  p(line(lr("Date", fmt(order.createdAt))));
  if (order.customer) p(line(lr("Name", order.customer)));
  if (order.userPhone) p(line(lr("Phone", order.userPhone)));
  rule();

  // ── Items ──
  p([0x1b, 0x45, 1]); p(line(padR("Item", 17) + padL("Qty", 5) + padL("Amt", 10))); p([0x1b, 0x45, 0]);
  feed(1);
  for (const it of order.items) {
    const amt = padL(rs(it.price * it.qty), 10);
    const qty = padL(it.qty, 5);
    // Long names wrap onto their own line so the qty/amount always line up.
    if (String(it.name).length > 17) {
      p(line(it.name));
      p(line(padR("", 17) + qty + amt));
    } else {
      p(line(padR(it.name, 17) + qty + amt));
    }
  }
  rule();

  // ── Bill ──
  p(line(lr("Subtotal", rs(order.itemTotal))));
  if (order.couponDiscount > 0) p(line(lr("Coupon", "-" + rs(order.couponDiscount))));
  if (order.discount > 0) p(line(lr("Points disc", "-" + rs(order.discount))));
  if (order.deliveryFee > 0) p(line(lr("Delivery", rs(order.deliveryFee))));
  if (order.handling > 0) p(line(lr("Handling", rs(order.handling))));
  if (order.surgeFee > 0) p(line(lr("Surge", rs(order.surgeFee))));
  rule();

  // ── Total ──
  feed(1);
  p([0x1b, 0x45, 1]); p([0x1d, 0x21, 0x01]);   // bold + double height
  p(line(lr("TOTAL", rs(order.total))));
  p([0x1d, 0x21, 0x00]); p([0x1b, 0x45, 0]);
  feed(1);
  const paid = order.paymentStatus === "paid"
    ? (order.razorpayPaymentId ? "PAID ONLINE" : "PAID CASH")
    : "TO PAY";
  p(line(lr("Payment", paid)));
  feed(1);
  rule();

  // ── Footer ──
  feed(1);
  p([0x1b, 0x61, 1]);
  p(line("Thank you! Visit again"));
  p(line("- " + shop.brand + " -"));
  p([0x1b, 0x61, 0]);
  p([0x1b, 0x64, 5]);              // feed to tear off
  p([0x1d, 0x56, 0x00]);           // cut (ignored if no cutter)

  return new Uint8Array(b);
}
