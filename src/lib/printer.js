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

// Android 12+ gates getBondedDevices() and the RFCOMM socket behind a RUNTIME
// BLUETOOTH_CONNECT grant. cordova-plugin-bluetooth-serial predates that and
// never asks, so without this every list/connect dies with a bare
// SecurityException. Asked here, at the moment of printing, where the reason for
// the dialog is obvious.
export class PrinterPermissionError extends Error {
  constructor(blocked) {
    super(blocked
      ? "Bluetooth permission is switched off for this app. Open app settings and turn on “Nearby devices”."
      : "Bluetooth permission is needed to reach the printer. Tap Print again and choose Allow.");
    this.name = "PrinterPermissionError";
    this.blocked = blocked;
  }
}

function btPerm() {
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  return cap?.Plugins?.BtPerm || null;
}

export async function ensurePrinterPermission() {
  const p = btPerm();
  // Older build without the plugin, or not native: let the call itself fail and
  // report whatever the platform says rather than inventing a reason.
  if (!p) return;
  let s = await p.status();
  if (s.granted) return;
  s = await p.request();
  if (!s.granted) throw new PrinterPermissionError(!!s.blocked);
}

export async function openAppSettings() {
  await btPerm()?.openSettings();
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
export async function listPairedPrinters() {
  await ensurePrinterPermission();
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
  await ensurePrinterPermission();
  await ensureConnected(addr);
  await writeBytes(buildReceiptBytes(order, shop));
}

/* ─── ESC/POS receipt (58mm, 32 cols) ────────────────────────────────────────
 *
 * What a 58mm roll gives you: 32 monospaced characters, black or white, one
 * accent (double size) and one inversion. That is the whole palette, so the
 * design has to come from ARRANGEMENT — column discipline, deliberate rules,
 * and one thing per band — rather than from decoration.
 *
 * The old receipt printed the name and the line amount only, so a customer
 * could not check a single figure on it; ruled everything with the same row of
 * hyphens, so nothing looked more important than anything else; and ended on a
 * bare "Payment  TO PAY" that was easy to miss on a bill someone still owed.
 * ────────────────────────────────────────────────────────────────────────── */
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
// Break a long line on spaces so an address never gets chopped mid-word.
function wrap(s, w = W) {
  const out = [];
  let cur = "";
  for (const word of String(s || "").split(/\s+/).filter(Boolean)) {
    if (!cur.length) cur = word;
    else if (cur.length + 1 + word.length <= w) cur += " " + word;
    else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out;
}
function fmt(iso) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).replace(",", "");
  } catch { return ""; }
}

export function buildReceiptBytes(order, shop) {
  const b = [];
  const p = (arr) => { for (const x of arr) b.push(x); };
  const feed = (n = 1) => p([0x1b, 0x64, n]);
  const thin = () => p(line("-".repeat(W)));
  const thick = () => p(line("=".repeat(W)));      // reads as a heavier rule
  const bold = (on) => p([0x1b, 0x45, on ? 1 : 0]);
  const big = (on) => p([0x1d, 0x21, on ? 0x11 : 0x00]);   // double W + H
  const tall = (on) => p([0x1d, 0x21, on ? 0x01 : 0x00]);  // double H only
  const inv = (on) => p([0x1d, 0x42, on ? 1 : 0]);         // white-on-black
  const mid = (on) => p([0x1b, 0x61, on ? 1 : 0]);         // centre / left
  const n = (v) => Math.round(Number(v) || 0);
  const rs = (v) => "Rs " + n(v);

  p([0x1b, 0x40]);          // initialise
  p([0x1b, 0x33, 36]);      // line spacing

  /* ── Masthead ─────────────────────────────────────────────────────────── */
  mid(true);
  bold(true); big(true); p(line(shop.brand)); big(false); bold(false);
  bold(true); p(line(shop.name)); bold(false);
  for (const l of wrap(shop.address)) p(line(l));
  if (shop.phone) p(line("Ph: " + shop.phone));
  mid(false);
  feed(1);

  /* ── Which bill, whose, when ──────────────────────────────────────────── */
  thick();
  p(line(lr("BILL NO", order.id)));
  p(line(lr("DATE", fmt(order.createdAt))));
  if (order.customer) p(line(lr("CUSTOMER", String(order.customer).slice(0, 20))));
  if (order.userPhone) p(line(lr("PHONE", order.userPhone)));
  if (order.deliverySlot) p(line(lr("SLOT", String(order.deliverySlot).slice(0, 20))));
  if (order.address) {
    p(line("DELIVER TO"));
    for (const l of wrap(order.address, W - 2)) p(line("  " + l));
  }

  /* ── Items ────────────────────────────────────────────────────────────── */
  thick();
  // Columns: name 15 · qty 3 · rate 6 · amount 8 = 32. RATE is the column the
  // old receipt left out, and it is the one that lets a customer check the bill.
  bold(true);
  p(line(padR("ITEM", 15) + padL("QTY", 3) + padL("RATE", 6) + padL("AMT", 8)));
  bold(false);
  thin();
  for (const it of order.items || []) {
    const nm = String(it.name || "");
    const cols = padL(it.qty, 3) + padL(n(it.price), 6) + padL(n(it.price * it.qty), 8);
    if (nm.length > 15) {
      // Full name on its own line, figures beneath — the columns never break.
      for (const l of wrap(nm)) p(line(l));
      p(line(padR("", 15) + cols));
    } else {
      p(line(padR(nm, 15) + cols));
    }
  }
  thin();

  /* ── The arithmetic ───────────────────────────────────────────────────── */
  const count = (order.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
  p(line(lr(count + (count === 1 ? " item" : " items"), rs(order.itemTotal))));
  if (order.couponDiscount > 0)
    p(line(lr("Coupon " + (order.couponCode || ""), "-" + rs(order.couponDiscount))));
  if (order.pointsDiscount > 0) p(line(lr("Points discount", "-" + rs(order.pointsDiscount))));
  if (order.deliveryFee > 0) p(line(lr("Delivery", rs(order.deliveryFee))));
  if (order.handling > 0) p(line(lr("Handling", rs(order.handling))));
  if (order.surgeFee > 0) p(line(lr("Surge", rs(order.surgeFee))));
  if (order.walletUsed > 0) p(line(lr("NGS Wallet", "-" + rs(order.walletUsed))));

  /* ── The number ───────────────────────────────────────────────────────── */
  thick();
  bold(true); tall(true);
  p(line(lr("TOTAL", rs(order.total), W)));
  tall(false); bold(false);
  thick();
  feed(1);

  /* ── Paid, or not ─────────────────────────────────────────────────────── */
  // Inverted, because "this bill is still owed" is the one thing on the paper
  // that must not be skimmed past. Printers without inversion still print it.
  const paid = order.paymentStatus === "paid";
  const badge = paid ? (order.razorpayPaymentId ? " PAID ONLINE " : " PAID - CASH ") : " TO PAY ";
  mid(true);
  inv(true); bold(true); p(line(badge)); bold(false); inv(false);
  mid(false);

  if (order.memberSavings > 0) {
    feed(1);
    mid(true);
    p(line("NGS Prime saved you " + rs(order.memberSavings)));
    mid(false);
  }

  /* ── Footer ───────────────────────────────────────────────────────────── */
  feed(1);
  thin();
  mid(true);
  bold(true); p(line("Thank you! Visit again")); bold(false);
  p(line("Groceries delivered in 12 min"));
  // The last line is the one people keep. Bold, because it is the only thing on
  // the paper asking them to come back, and the shop's number is already in the
  // masthead — repeating it here said nothing new.
  if (shop.site) { bold(true); p(line("Order again: " + shop.site)); bold(false); }
  mid(false);
  feed(1);

  p([0x1b, 0x64, 4]);       // feed clear of the tear bar
  p([0x1d, 0x56, 0x00]);    // cut, ignored if the printer has no cutter
  return new Uint8Array(b);
}
