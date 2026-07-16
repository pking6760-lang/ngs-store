// Shared UPI-payment helpers used by both the checkout pay screen and the
// membership pay screen, so the two look and behave identically.
import gpayLogo from "../assets/upi/gpay.png";
import phonepeLogo from "../assets/upi/phonepe.png";
import paytmLogo from "../assets/upi/paytm.png";
import bhimLogo from "../assets/upi/bhim.png";

// iOS has no UPI "app chooser" like Android — a raw upi:// link opens whatever
// single app claimed the scheme, so on iPhone/iPad we target each app's scheme.
export const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1));

// UPI apps shown as direct buttons. Each opens that specific app with the amount
// pre-filled via the app's own URL scheme (works from the WebView and browser).
export const UPI_APPS = [
  { id: "gpay", name: "Google Pay", logo: gpayLogo, scheme: "tez://upi/pay" },
  { id: "phonepe", name: "PhonePe", logo: phonepeLogo, scheme: "phonepe://pay" },
  { id: "paytm", name: "Paytm", logo: paytmLogo, scheme: "paytmmp://pay" },
  { id: "bhim", name: "BHIM UPI", logo: bhimLogo, scheme: "upi://pay" },
];

export function upiAppHref(upiIntent, app) {
  if (!upiIntent || upiIntent.indexOf("?") < 0) return "#";
  const q = upiIntent.slice(upiIntent.indexOf("?") + 1);
  return `${app.scheme}?${q}`;
}

// Amount → Indian rupees in words ("Rupees One Hundred Ninety Six Only").
export function rupeesInWords(amount) {
  let num = Math.round(Number(amount) || 0);
  if (num === 0) return "Rupees Zero Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
  const three = (n) => {
    const h = Math.floor(n / 100), r = n % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  let w = "";
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) w += two(crore) + " Crore ";
  if (lakh) w += two(lakh) + " Lakh ";
  if (thousand) w += two(thousand) + " Thousand ";
  if (num) w += three(num);
  return "Rupees " + w.trim() + " Only";
}
