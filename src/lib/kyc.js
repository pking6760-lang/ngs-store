// Smart KYC validation — checks that document NUMBERS are well-formed and, for
// Aadhaar, mathematically genuine. This does NOT contact any government
// database (that needs a paid API); it catches fake, random, and mistyped
// numbers, and structures the owner's final review. The photos + the owner's
// approval remain the real gate.

/* ── Aadhaar: 12 digits validated by the Verhoeff checksum ──────────────────
   Every genuine Aadhaar number passes Verhoeff; a made-up or mistyped number
   almost always fails. The last digit is the check digit. */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function cleanAadhaar(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 12);
}

export function aadhaarValid(v) {
  const s = cleanAadhaar(v);
  if (!/^\d{12}$/.test(s)) return false;
  if (s[0] === "0" || s[0] === "1") return false;      // UIDAI numbers start 2–9
  if (/^(\d)\1{11}$/.test(s)) return false;            // all-same digits
  let c = 0;
  const rev = s.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = D[c][P[i % 8][Number(rev[i])]];
  return c === 0;
}

// Group as XXXX XXXX XXXX for display / entry.
export function formatAadhaar(v) {
  return cleanAadhaar(v).replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

// Mask all but the last 4 digits, e.g. "XXXX XXXX 1234" (UIDAI norm).
export function maskAadhaar(v) {
  const s = cleanAadhaar(v);
  if (s.length < 4) return s;
  return `XXXX XXXX ${s.slice(-4)}`;
}

/* ── PAN: five letters, four digits, one letter (ABCDE1234F) ────────────────
   4th letter is the holder type — 'P' = individual person. */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export function cleanPan(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}
export function panValid(v) {
  return PAN_RE.test(cleanPan(v));
}
// True when the PAN's holder-type letter says "individual person".
export function panIsIndividual(v) {
  const s = cleanPan(v);
  return PAN_RE.test(s) && s[3] === "P";
}

/* ── Driving licence: 2-letter state + digits, 15–16 chars overall ──────────
   Formats vary by state, so this is a lenient sanity check (e.g. DL14
   20110012345 / MH0320110012345). */
export function cleanDl(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}
export function dlValid(v) {
  const s = cleanDl(v);
  return /^[A-Z]{2}\d{2}\d{10,12}$/.test(s) && s.length >= 15 && s.length <= 16;
}

// One-shot report used by the owner's review screen.
export function kycReport(p) {
  const items = [
    { key: "aadhaar", label: "Aadhaar number", value: p.aadhaarNumber,
      ok: aadhaarValid(p.aadhaarNumber), show: maskAadhaar(p.aadhaarNumber),
      okText: "12 digits · checksum verified", badText: "Fails the Aadhaar checksum" },
    { key: "pan", label: "PAN number", value: p.panNumber,
      ok: panValid(p.panNumber), show: cleanPan(p.panNumber),
      okText: panIsIndividual(p.panNumber) ? "Valid PAN · individual" : "Valid PAN format",
      badText: "Not a valid PAN format" },
  ];
  if (p.dlNumber) {
    items.push({ key: "dl", label: "Licence number", value: p.dlNumber,
      ok: dlValid(p.dlNumber), show: cleanDl(p.dlNumber),
      okText: "Valid licence format", badText: "Doesn't look like a licence number" });
  }
  return items;
}
