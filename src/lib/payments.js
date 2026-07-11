import qrcode from "qrcode-generator";

// The shop's real UPI ID (VPA) that receives payments. This is a Paytm
// merchant QR handle (@ptys), so UPI apps treat payments as merchant
// collections and generally lock the pre-filled amount.
export const SHOP_UPI_ID = "paytmqr72t0sv@ptys";
export const SHOP_UPI_NAME = "NGS Store";

// Build a standard UPI deep link. On a phone, opening this URL launches the
// user's UPI app (GPay / PhonePe / Paytm / BHIM) with the amount pre-filled.
// The amount is sent as a fixed value (two decimals) so apps show it as the
// exact amount to pay rather than an editable field.
export function buildUpiLink({ amount, note, txnRef }) {
  const params = new URLSearchParams({
    pa: SHOP_UPI_ID,
    pn: SHOP_UPI_NAME,
    am: Number(amount).toFixed(2),
    cu: "INR",
  });
  if (note) params.set("tn", note);
  if (txnRef) params.set("tr", txnRef);
  return `upi://pay?${params.toString()}`;
}

// Razorpay online payments (UPI / cards / netbanking / wallets), verified on
// the server. Enabled only when a public key id is present at build time; until
// then the app keeps the simple UPI-QR + COD flow so nothing breaks.
export const RAZORPAY_ENABLED = Boolean(import.meta.env.VITE_RAZORPAY_KEY_ID);

// Load Razorpay's checkout script on demand (only when the customer actually
// chooses to pay online). Resolves with the global Razorpay constructor.
let razorpayPromise = null;
export function loadRazorpay() {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve(window.Razorpay);
  if (razorpayPromise) return razorpayPromise;
  razorpayPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => {
      razorpayPromise = null;
      reject(new Error("Couldn't load the payment screen. Check your internet and try again."));
    };
    document.body.appendChild(s);
  });
  return razorpayPromise;
}

// Render any string to a scannable QR code as a data-URI (PNG-like GIF).
// Used so a customer on desktop can scan with their phone's UPI app.
export function qrDataUri(text) {
  const qr = qrcode(0, "M"); // type 0 = auto-size, error correction M
  qr.addData(text);
  qr.make();
  // cellSize=5px, margin=4 cells — crisp and scannable.
  return qr.createDataURL(5, 4);
}
