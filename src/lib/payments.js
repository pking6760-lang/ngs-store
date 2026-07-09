import qrcode from "qrcode-generator";

// The shop's UPI ID (VPA) that receives payments. For the demo this is a
// placeholder — replace it with the store's real UPI ID (e.g. from GPay /
// PhonePe / Paytm / a bank) and money will actually land in that account.
export const SHOP_UPI_ID = "ngsstore@upi";
export const SHOP_UPI_NAME = "NGS Store";

// Build a standard UPI deep link. On a phone, opening this URL launches the
// user's UPI app (GPay / PhonePe / Paytm / BHIM) pre-filled with the amount.
export function buildUpiLink({ amount, note, txnRef }) {
  const params = new URLSearchParams({
    pa: SHOP_UPI_ID,
    pn: SHOP_UPI_NAME,
    am: String(amount),
    cu: "INR",
  });
  if (note) params.set("tn", note);
  if (txnRef) params.set("tr", txnRef);
  return `upi://pay?${params.toString()}`;
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
