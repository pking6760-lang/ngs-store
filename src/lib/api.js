// ============================================================================
// api.js — the app's single connection to the secure Supabase backend.
// ============================================================================
// Every screen reads/writes through here. The important, money-touching calls
// (placing an order, earning/spending points, rating) go through server-side
// database FUNCTIONS (rpc) that recompute everything — the app cannot set a
// price, a total, or a points balance. Reads are protected by Row-Level
// Security, so a customer only ever sees their own orders/points/profile.
import { supabase, isBackendConfigured } from "./supabase.js";

export { isBackendConfigured };

function must() {
  if (!supabase) throw new Error("Backend is not configured.");
  return supabase;
}

// Call a Supabase Edge Function with a plain fetch. supabase-js's
// functions.invoke() can throw "Failed to send a request to the Edge Function"
// inside the Android WebView; a direct fetch to the function URL is reliable
// there and gives us the real server error message.
const FN_URL = import.meta.env.VITE_SUPABASE_URL;
const FN_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
async function invokeFn(name, body) {
  let token = FN_ANON;
  try {
    const { data } = await must().auth.getSession();
    if (data?.session?.access_token) token = data.session.access_token;
  } catch { /* fall back to anon */ }
  let res;
  try {
    res = await fetch(`${FN_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: FN_ANON,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new Error("Network error — please check your connection and try again.");
  }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok || data?.error) throw new Error(data?.error || `Request failed (${res.status}).`);
  return data;
}

/* ─── Shape mappers: DB (snake_case) ↔ app (camelCase) ──────────────────────
   The screens were built against the localStorage shapes, so we translate
   database rows into those same shapes and vice-versa. This keeps the UI code
   unchanged. */
const num = (v) => (v == null ? v : Number(v));

function mapProduct(r) {
  // Note: buying price (cost) is intentionally NOT here — it lives in the
  // admin-only product_costs table and is merged in by fetchAdminProducts only.
  return { id: r.id, name: r.name, unit: r.unit, price: num(r.price),
    mrp: num(r.mrp), icon: r.icon, image: r.image_url,
    category: r.category, stock: r.stock, active: r.active,
    // Public merchandising flags: `bait` (best-price deal) and `hot` (selling
    // fast). Cost, tier and the sales numbers are admin-only (fetchAdminProducts).
    bait: !!r.bait, hot: !!r.hot };
}
function mapCategory(r) {
  return { id: r.id, name: r.name, icon: r.icon, color: r.color };
}
function mapCoupon(r) {
  return { code: r.code, type: r.type, value: num(r.value),
    minOrder: num(r.min_order), category: r.category || "", active: r.active };
}
function couponToDb(c) {
  return { code: (c.code || "").trim().toUpperCase(), type: c.type === "flat" ? "flat" : "percent",
    value: Number(c.value) || 0, min_order: Number(c.minOrder) || 0,
    category: (c.category || "").trim(), active: c.active !== false };
}
function mapSettings(r) {
  if (!r) return null;
  return { storeOpen: r.store_open, deliveryMode: r.delivery_mode,
    offerBanner: r.offer_banner, rewards: r.rewards, deliveryFee: num(r.delivery_fee),
    freeDeliveryAbove: num(r.free_delivery_above), handlingFee: num(r.handling_fee),
    surgeFee: num(r.surge_fee), maxDistanceKm: num(r.max_distance_km),
    shopLocations: r.shop_locations || [], lowStockThreshold: r.low_stock_threshold };
}
function settingsToDb(p) {
  const map = { storeOpen: "store_open", deliveryMode: "delivery_mode",
    offerBanner: "offer_banner", rewards: "rewards", deliveryFee: "delivery_fee",
    freeDeliveryAbove: "free_delivery_above", handlingFee: "handling_fee",
    surgeFee: "surge_fee", maxDistanceKm: "max_distance_km",
    shopLocations: "shop_locations", lowStockThreshold: "low_stock_threshold" };
  const out = {};
  for (const k in p) if (map[k]) out[map[k]] = p[k];
  return out;
}
function mapOrder(r) {
  return { id: r.human_code || r.id, dbId: r.id, createdAt: r.created_at,
    customer: r.customer_name, userId: r.user_id, userPhone: r.user_phone,
    accepted: r.accepted, member: r.member, status: r.status,
    items: (r.order_items || []).map((i) => ({ id: i.product_id, name: i.name,
      icon: i.icon, qty: i.qty, price: num(i.price) })),
    itemTotal: num(r.item_total), discount: num(r.discount), couponCode: r.coupon_code,
    deliveryFee: num(r.delivery_fee), handling: num(r.handling), surgeFee: num(r.surge_fee),
    pointsEarned: r.points_earned, total: num(r.total),
    payment: r.payment_method, paymentMethod: r.payment_method, paymentStatus: r.payment_status,
    razorpayPaymentId: r.razorpay_payment_id,
    address: r.address, distanceKm: num(r.distance_km), location: r.location,
    rating: r.rating, feedback: r.feedback, needsOwner: !!r.needs_owner,
    deliveryState: r.delivery_state, pickerState: r.picker_state,
    count: (r.order_items || []).reduce((s, i) => s + i.qty, 0) };
}
function mapProfile(r) {
  if (!r) return null;
  return { id: r.id, name: r.name, phone: r.phone, email: r.email,
    address: r.address, points: r.points, member: r.is_member,
    memberSince: r.member_since, role: r.role, createdAt: r.created_at };
}

/* ─── Auth (email OTP) ──────────────────────────────────────────────────── */

// Email a 6-digit one-time code. Creates the account on first use. Requires the
// project's email template to include the code token ({{ .Token }}), which
// needs custom SMTP configured on Supabase (see EMAIL_OTP_SETUP.md).
export async function sendEmailCode(email, name) {
  const { error } = await must().auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true, data: name ? { name } : undefined },
  });
  if (error) throw error;
  return { ok: true };
}

// Verify the code the customer typed → establishes a logged-in session.
export async function verifyEmailCode(email, token) {
  const e = email.trim();
  const t = token.trim();
  // A code can be a sign-in OTP ("email") or a new-account confirmation
  // ("signup"). Try the common case first, fall back to the other.
  const first = await must().auth.verifyOtp({ email: e, token: t, type: "email" });
  if (!first.error) return first.data.session;
  const second = await must().auth.verifyOtp({ email: e, token: t, type: "signup" });
  if (second.error) throw second.error;
  return second.data.session;
}

export async function signInWithPassword(email, password) {
  const { data, error } = await must().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await must().auth.signOut();
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Fire `cb` whenever the login state changes (sign in / out / token refresh).
export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/* ─── Profile ───────────────────────────────────────────────────────────── */

export async function getMyProfile() {
  const { data: u } = await must().auth.getUser();
  if (!u?.user) return null;
  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", u.user.id).maybeSingle();
  if (error) throw error;
  return mapProfile(data);
}

// Customer edits their own name/phone/address (points/role/membership are
// server-protected and silently ignored if tampered with).
export async function updateMyProfile(patch) {
  const { data: u } = await must().auth.getUser();
  if (!u?.user) throw new Error("Not signed in.");
  const allowed = {};
  for (const k of ["name", "phone", "address", "email"]) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { error } = await supabase.from("profiles").update(allowed).eq("id", u.user.id);
  if (error) throw error;
  pingLocal("profiles");
  return { ok: true };
}

/* ─── Catalog / settings (public read) ──────────────────────────────────── */

export async function fetchProducts() {
  const { data, error } = await must()
    .from("products").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapProduct);
}

export async function fetchCategories() {
  const { data, error } = await must()
    .from("categories").select("*").order("sort", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapCategory);
}

export async function fetchCoupons() {
  const { data, error } = await must().from("coupons").select("*");
  if (error) throw error;
  return (data || []).map(mapCoupon);
}

export async function fetchSettings() {
  const { data, error } = await must()
    .from("settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return mapSettings(data);
}

/* ─── Orders (customer) ─────────────────────────────────────────────────── */

// Place an order. The phone sends only product ids + quantities (+ optional
// coupon and location); the SERVER computes prices, discount, delivery, total
// and points. Returns the created order row.
export async function placeOrder({ items, coupon, location, payment, address }) {
  const p_items = items.map((i) => ({ id: i.id, qty: i.qty }));
  const { data, error } = await must().rpc("place_order", {
    p_items,
    p_coupon: coupon || null,
    p_location: location || null,
    p_payment: payment || "upi",
    p_address: address || null,
  });
  if (error) throw error;
  pingLocal("orders");
  pingLocal("products"); // stock changed
  return mapOrder(data);
}

// Ask the server to create a Razorpay order for an already-placed (held) order.
// The server reads the real total from the DB — the phone never sends an amount.
export async function createRazorpayOrder(orderDbId) {
  return invokeFn("razorpay-create-order", { orderId: orderDbId });
}

// Admin/delivery: create a Razorpay UPI QR for a not-yet-paid order. Any UPI app
// scans it and pays directly; the qr_code.credited webhook then confirms the
// order (turns it green live). Returns { imageUrl, qrId, amount }.
export async function createOrderQr(orderDbId) {
  return invokeFn("razorpay-create-qr", { orderId: orderDbId });
}

// Create a Razorpay payment link for a not-yet-paid order — used for the
// "pay on this phone" button on the customer checkout (opens the secure Razorpay
// page). Verified server-side by the payment_link.paid webhook.
export async function createCollectionLink(orderDbId) {
  return invokeFn("razorpay-collect-link", { orderId: orderDbId });
}

// Read the live payment/status of one of the customer's own orders. Used to
// confirm success via the webhook when the in-page Razorpay callback doesn't
// fire (common with async UPI). RLS lets a customer read only their own order.
export async function fetchOrderState(dbId) {
  const { data, error } = await must()
    .from("orders").select("payment_status,status").eq("id", dbId).single();
  if (error) throw error;
  return data; // { payment_status, status }
}

// Hand the Razorpay result back to the server, which verifies the signature and
// confirms the order. Returns { ok: true } only if the payment is genuine.
export async function verifyRazorpayPayment(payload) {
  const data = await invokeFn("razorpay-verify", payload);
  pingLocal("orders");
  pingLocal("products");
  return data;
}

export async function fetchMyOrders() {
  const { data, error } = await must()
    .from("orders")
    .select("*, order_items(*)")
    // Hide online orders whose payment never completed.
    .neq("status", "Awaiting payment")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapOrder);
}

export async function rateOrder(orderId, rating, feedback) {
  const { error } = await must().rpc("rate_order", {
    p_order: orderId, p_rating: rating, p_feedback: feedback || "",
  });
  if (error) throw error;
  pingLocal("orders");
  return { ok: true };
}

export async function redeemPoints(points) {
  const { data, error } = await must().rpc("redeem_points", { p_points: points });
  if (error) throw error;
  pingLocal("profiles");
  return data; // new balance
}

/* ─── Notifications (customer) ──────────────────────────────────────────── */

export async function fetchMyNotifications() {
  const { data, error } = await must()
    .from("notifications").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function markNotificationsRead() {
  const { data: u } = await must().auth.getUser();
  if (!u?.user) return;
  await supabase.from("notifications").update({ read: true })
    .eq("user_id", u.user.id).eq("read", false);
  pingLocal("notifications");
}

/* ─── NGS Partner onboarding (KYC) ──────────────────────────────────────── */

// Resolve an IFSC code → bank name + branch using the free, public IFSC
// directory (no key). Returns null for an unknown/invalid code so the caller
// can reject it. IFSC format: 4 letters + '0' + 6 alphanumerics.
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export async function lookupIfsc(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!IFSC_RE.test(c)) return null;
  try {
    const r = await fetch(`https://ifsc.razorpay.com/${c}`);
    if (!r.ok) return null; // 404 = no such branch
    const d = await r.json();
    if (!d || !d.BANK) return null;
    const city = d.CITY || d.CENTRE || d.DISTRICT || "";
    return {
      ifsc: c,
      bank: d.BANK,
      branch: d.BRANCH || "",
      city,
      state: d.STATE || "",
    };
  } catch { return null; }
}

function mapPartner(r) {
  if (!r) return null;
  return {
    id: r.id, userId: r.user_id, role: r.role, fullName: r.full_name,
    phone: r.phone, email: r.email, address: r.address,
    bankAccount: r.bank_account, bankIfsc: r.bank_ifsc, bankHolder: r.bank_holder,
    bankName: r.bank_name, bankBranch: r.bank_branch,
    aadhaarNumber: r.aadhaar_number, panNumber: r.pan_number, dlNumber: r.dl_number,
    termsAcceptedAt: r.terms_accepted_at, termsVersion: r.terms_version,
    usesEv: r.uses_ev, aadhaarFront: r.aadhaar_front, aadhaarBack: r.aadhaar_back,
    pan: r.pan, dl: r.dl, status: r.status, createdAt: r.created_at,
  };
}

// Downscale + JPEG-compress a photo before upload so documents stay small.
async function compressImage(file, max = 1600, quality = 0.82) {
  if (typeof document === "undefined") return file;
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = URL.createObjectURL(file);
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob || file;
  } catch { return file; }
}

// NGS Partner login — a branded OTP email, separate from the customer login.
export async function partnerLoginSend(email) {
  return invokeFn("partner-otp-send", { email: (email || "").trim() });
}
export async function partnerLoginVerify(email, code) {
  const data = await invokeFn("partner-otp-verify", { email: (email || "").trim(), code: (code || "").trim() });
  // Exchange the one-time token for a real session.
  const { error } = await must().auth.verifyOtp({ token_hash: data.tokenHash, type: "magiclink" });
  if (error) throw new Error(error.message || "Couldn't complete login. Try again.");
  return { ok: true };
}

// The signed-in person's own partner registration (or null if not registered).
export async function getMyPartner() {
  const { data: u } = await must().auth.getUser();
  if (!u?.user) return null;
  const { data, error } = await must()
    .from("partners").select("*").eq("user_id", u.user.id).maybeSingle();
  if (error) throw error;
  return mapPartner(data);
}

// Upload one KYC photo to the private bucket → returns its storage path.
export async function uploadPartnerDoc(file, kind) {
  const { data: u } = await must().auth.getUser();
  if (!u?.user) throw new Error("Please sign in again.");
  const blob = await compressImage(file);
  const path = `${u.user.id}/${kind}.jpg`;
  const { error } = await must().storage
    .from("partner-docs").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

// Submit (or resubmit) a partner registration. Starts as 'pending'.
export async function registerPartner(p) {
  const { data: u } = await must().auth.getUser();
  if (!u?.user) throw new Error("Please sign in again.");
  const row = {
    user_id: u.user.id, role: p.role, full_name: p.fullName, phone: p.phone || null,
    email: u.user.email || p.email || null, address: p.address || null,
    bank_account: p.bankAccount || null, bank_ifsc: p.bankIfsc || null, bank_holder: p.bankHolder || null,
    bank_name: p.bankName || null, bank_branch: p.bankBranch || null,
    aadhaar_number: p.aadhaarNumber || null, pan_number: p.panNumber || null, dl_number: p.dlNumber || null,
    terms_accepted_at: p.termsAccepted ? new Date().toISOString() : null,
    terms_version: p.termsAccepted ? (p.termsVersion || null) : null,
    uses_ev: !!p.usesEv, aadhaar_front: p.aadhaarFront || null, aadhaar_back: p.aadhaarBack || null,
    pan: p.pan || null, dl: p.dl || null, status: "pending",
  };
  const { error } = await must().from("partners").upsert(row, { onConflict: "user_id" });
  if (error) throw error;
  pingLocal("partners");
  return { ok: true };
}

// Admin: review + decide partners.
export async function fetchPartners() {
  const { data, error } = await must()
    .from("partners").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapPartner);
}
export async function setPartnerStatus(userId, status) {
  const { error } = await must().rpc("set_partner_status", { p_user: userId, p_status: status });
  if (error) throw error;
  pingLocal("partners");
  return { ok: true };
}
// A signed URL to view a private document photo (admin). Valid 24h; also
// regenerated on tap so it's never stale.
export async function partnerDocUrl(path) {
  if (!path) return null;
  const { data, error } = await must().storage.from("partner-docs").createSignedUrl(path, 86400);
  if (error) return null;
  return data?.signedUrl || null;
}

/* ─── NGS Partner: live dashboard (Home/Slots/Earnings/Wallet) ───────────── */

async function myUid() {
  const { data } = await must().auth.getUser();
  return data?.user?.id || null;
}

// The owner-controlled dials (rates, caps, hours) — the partner app reads them.
export async function getOpsConfig() {
  const { data, error } = await must().from("ops_config").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    handling: Number(data.handling_fee), deliveryFee: Number(data.delivery_fee),
    freeThreshold: Number(data.free_delivery_threshold), surgeFee: Number(data.surge_fee),
    surgeOn: !!data.surge_on, codCustomerLimit: Number(data.cod_customer_limit),
    riderCashCap: Number(data.rider_cash_cap), pickerSlotMin: Number(data.picker_slot_min),
    storeOpenHour: data.store_open_hour, storeCloseHour: data.store_close_hour,
    coveragePicking: data.coverage_picking, coverageDelivery: data.coverage_delivery,
  };
}

// Online / offline presence.
export async function getMyPresence() {
  const uid = await myUid();
  if (!uid) return { isOnline: false, activeOrderId: null };
  const { data } = await must().from("partner_presence").select("*").eq("user_id", uid).maybeSingle();
  return { isOnline: !!data?.is_online, activeOrderId: data?.active_order_id || null };
}
export async function setOnline(on) {
  const { error } = await must().rpc("set_online", { p_online: !!on });
  if (error) throw new Error(error.message || "Couldn't update your status.");
  return { ok: true };
}

// Slot bookings (mine) + live availability counts for the grid.
export async function getMySlots() {
  const { data, error } = await must().from("partner_slots")
    .select("*").order("slot_date").order("start_hour");
  if (error) throw error;
  return (data || []).map((s) => ({ id: s.id, date: s.slot_date, hour: s.start_hour, role: s.role, status: s.status }));
}
export async function getSlotCounts(dateISO) {
  const { data, error } = await must().rpc("slot_counts", { p_date: dateISO });
  if (error) return {};
  const out = {};
  (data || []).forEach((r) => { out[`${r.role}:${r.start_hour}`] = Number(r.cnt); });
  return out;
}
export async function bookSlot(role, dateISO, hour) {
  const { error } = await must().rpc("book_slot", { p_role: role, p_date: dateISO, p_hour: hour });
  if (error) throw new Error(error.message || "Couldn't book that slot.");
  return { ok: true };
}

// Wallet: full ledger + derived balance and cash-in-hand.
export async function getMyWallet() {
  const uid = await myUid();
  if (!uid) return { balance: 0, cashInHand: 0, ledger: [] };
  // Prefer the RPC that joins the real order code; fall back to the plain table.
  let rows = null;
  const { data: rpcRows, error: rpcErr } = await must().rpc("get_my_ledger");
  if (!rpcErr && Array.isArray(rpcRows)) rows = rpcRows;
  if (!rows) {
    const { data, error } = await must().from("wallet_ledger")
      .select("*").eq("partner_id", uid).order("created_at", { ascending: false });
    if (error) throw error;
    rows = data || [];
  }
  const ledger = rows.map((r) => ({
    id: r.id, kind: r.kind, amount: Number(r.amount), cashDelta: Number(r.cash_delta),
    note: r.note, orderId: r.order_id, code: r.code || null, at: r.at || r.created_at,
  }));
  const balance = ledger.reduce((s, l) => s + l.amount, 0);
  const cashInHand = ledger.reduce((s, l) => s + l.cashDelta, 0);
  return { balance, cashInHand, ledger };
}

// Reliability record (strikes).
export async function getMyStrikes() {
  const uid = await myUid();
  if (!uid) return [];
  const { data } = await must().from("partner_strikes")
    .select("*").eq("partner_id", uid).order("created_at", { ascending: false });
  return (data || []).map((s) => ({ id: s.id, reason: s.reason, at: s.created_at }));
}

// Admin: raw ops_config for the settings editor + update.
// ── Smart pricing (auto selling price from cost + MRP + sales velocity) ──────
export async function getPricingConfig() {
  const { data, error } = await must().from("pricing_config").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}
export async function updatePricingConfig(patch) {
  const { error } = await must().from("pricing_config").update(patch).eq("id", 1);
  if (error) throw new Error(error.message || "Couldn't save pricing rules.");
  pingLocal("products");
  return { ok: true };
}
// Recompute every product's tier + auto price now (admin button, and it also
// runs on a schedule server-side).
export async function smartReprice() {
  const { error } = await must().rpc("smart_reprice");
  if (error) throw new Error(error.message || "Couldn't recompute prices.");
  pingLocal("products");
  return { ok: true };
}
// Owner override for the advertised "best price" strip: 'pin' | 'hide' | null.
export async function setBaitOverride(productId, value) {
  const { error } = await must().from("product_costs")
    .upsert({ product_id: productId, bait_override: value });
  if (error) throw new Error(error.message || "Couldn't update.");
  pingLocal("products");
  return { ok: true };
}

export async function getOpsConfigRaw() {
  const { data, error } = await must().from("ops_config").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}
export async function updateOpsConfig(patch) {
  const { error } = await must().from("ops_config")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw new Error(error.message || "Couldn't save settings.");
  pingLocal("ops_config");
  return { ok: true };
}

// Admin: every partner's wallet balance, cash-in-hand and strike count.
export async function fetchPartnerWallets() {
  const [led, strk] = await Promise.all([
    must().from("wallet_ledger").select("partner_id,amount,cash_delta"),
    must().from("partner_strikes").select("partner_id"),
  ]);
  const map = {};
  const get = (id) => (map[id] || (map[id] = { balance: 0, cashInHand: 0, strikes: 0 }));
  (led.data || []).forEach((r) => { const m = get(r.partner_id); m.balance += Number(r.amount); m.cashInHand += Number(r.cash_delta); });
  (strk.data || []).forEach((r) => { get(r.partner_id).strikes += 1; });
  return map;
}
export async function partnerDepositCash(userId, amount) {
  const { error } = await must().rpc("partner_deposit_cash", { p_user: userId, p_amount: amount });
  if (error) throw new Error(error.message || "Couldn't record deposit.");
  pingLocal("wallet_ledger");
  return { ok: true };
}
export async function partnerRecordPayoutAdmin(userId, amount, note) {
  const { error } = await must().rpc("partner_record_payout", { p_user: userId, p_amount: amount, p_note: note || null });
  if (error) throw new Error(error.message || "Couldn't record payout.");
  pingLocal("wallet_ledger");
  return { ok: true };
}

// The partner's current assigned task (minimal fields, privacy-scoped).
export async function getMyTask() {
  const { data, error } = await must().rpc("get_my_task");
  if (error) return null;
  const t = Array.isArray(data) ? data[0] : data;
  if (!t) return null;
  return {
    orderId: t.order_id, code: t.code, role: t.task_role, state: t.state,
    isCod: t.is_cod, paid: t.paid, codAmount: t.cod_amount, location: t.location, items: t.items || [],
  };
}

// Order lifecycle (used once dispatch is wired).
export async function partnerAccept(orderId) {
  const { error } = await must().rpc("partner_accept", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't accept."); return { ok: true };
}
export async function partnerMarkPacked(orderId) {
  const { error } = await must().rpc("partner_mark_packed", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't mark packed."); return { ok: true };
}
export async function partnerMarkDelivered(orderId) {
  const { error } = await must().rpc("partner_mark_delivered", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't mark delivered."); return { ok: true };
}

/* ─── Admin: catalog ────────────────────────────────────────────────────── */

export async function upsertProduct(product, cost) {
  const { error } = await must().from("products").upsert(product);
  if (error) throw error;
  // Buying price is written to the admin-only side table. `undefined` means the
  // caller didn't touch cost; null/"" clears it.
  if (cost !== undefined) {
    const value = cost === "" || cost == null ? null : Number(cost);
    const { error: e2 } = await must().from("product_costs")
      .upsert({ product_id: product.id, cost: value });
    if (e2) throw new Error(e2.message || "Couldn't save cost price.");
  }
  pingLocal("products");
  return { ok: true };
}

// Admin: private per-product data (cost + sales analytics), keyed by product id.
export async function fetchProductPrivate() {
  const { data, error } = await must().from("product_costs").select("*");
  if (error) throw error;
  const m = {};
  (data || []).forEach((r) => {
    m[r.product_id] = {
      cost: num(r.cost),
      speedTier: r.speed_tier || null,
      units30d: r.units_30d ?? 0,
      velocityScore: r.velocity_score ?? 0,
      sold: { d1: r.sold_1d ?? 0, d3: r.sold_3d ?? 0, d7: r.sold_7d ?? 0, d14: r.sold_14d ?? 0, d30: r.sold_30d ?? 0 },
      baitOverride: r.bait_override || null,
    };
  });
  return m;
}
// Admin: products with their private cost + analytics merged in.
export async function fetchAdminProducts() {
  const [prods, priv] = await Promise.all([fetchProducts(), fetchProductPrivate()]);
  return prods.map((p) => {
    const x = priv[p.id] || {};
    return {
      ...p,
      cost: x.cost ?? null,
      speedTier: x.speedTier || "unpriced",
      units30d: x.units30d ?? 0,
      velocityScore: x.velocityScore ?? 0,
      sold: x.sold || { d1: 0, d3: 0, d7: 0, d14: 0, d30: 0 },
      baitOverride: x.baitOverride || null,
    };
  });
}

export async function deleteProduct(id) {
  const { error } = await must().from("products").delete().eq("id", id);
  if (error) throw error;
  pingLocal("products");
  return { ok: true };
}

export async function addCategory(cat) {
  const { error } = await must().from("categories").insert(cat);
  if (error) throw error;
  pingLocal("categories");
  return { ok: true };
}

export async function deleteCategory(id) {
  const { error } = await must().from("categories").delete().eq("id", id);
  if (error) throw error;
  pingLocal("categories");
  return { ok: true };
}

export async function upsertCoupon(coupon) {
  const { error } = await must().from("coupons").upsert(couponToDb(coupon));
  if (error) throw error;
  pingLocal("coupons");
  return { ok: true };
}

export async function deleteCoupon(code) {
  const { error } = await must().from("coupons").delete().eq("code", code);
  if (error) throw error;
  pingLocal("coupons");
  return { ok: true };
}

export async function updateSettings(patch) {
  // .select() returns the changed rows; if RLS blocked the write (caller isn't
  // an admin) it succeeds with 0 rows — surface that as a clear error.
  const { data, error } = await must()
    .from("settings").update(settingsToDb(patch)).eq("id", 1).select();
  if (error) throw error;
  if (!data || data.length === 0)
    throw new Error("Not saved — you must be signed in as an admin.");
  pingLocal("settings");
  return { ok: true };
}

/* ─── Admin: orders ─────────────────────────────────────────────────────── */

export async function fetchAllOrders() {
  const { data, error } = await must()
    .from("orders").select("*, order_items(*)")
    // Never surface an online order to the shop until its payment is confirmed.
    .neq("status", "Awaiting payment")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapOrder);
}

export async function updateOrderById(dbId, patch) {
  const { error } = await must().from("orders").update(patch).eq("id", dbId);
  if (error) throw error;
  pingLocal("orders");
  return { ok: true };
}

// These take the order's database id (order.dbId from mapOrder), not the
// human_code shown in the UI.
export async function updateOrderStatus(dbId, status) {
  const { error } = await must().from("orders").update({ status }).eq("id", dbId);
  if (error) throw error;
  pingLocal("orders");
  return { ok: true };
}

// Staff (NGS Partner app) advance an order's status via a role-checked RPC —
// they can't touch prices or payments, only move the status forward.
export async function advanceOrderStatus(dbId, status) {
  const { error } = await must().rpc("advance_order_status", { p_order: dbId, p_status: status });
  if (error) throw error;
  pingLocal("orders");
  return { ok: true };
}

export async function acceptOrder(dbId) {
  const { error } = await must().from("orders").update({ accepted: true }).eq("id", dbId);
  if (error) throw error;
  pingLocal("orders");
  return { ok: true };
}

export async function rejectOrder(dbId) {
  const { error } = await must()
    .from("orders").update({ accepted: false, status: "Cancelled" }).eq("id", dbId);
  if (error) throw error;
  pingLocal("orders");
  return { ok: true };
}

/* ─── Admin: customers ──────────────────────────────────────────────────── */

export async function fetchCustomers() {
  const { data, error } = await must()
    .from("profiles").select("*").eq("role", "customer")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapProfile);
}

export async function setMembership(userId, isMember) {
  const patch = { is_member: isMember, member_since: isMember ? new Date().toISOString() : null };
  const { error } = await must().from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
  pingLocal("profiles");
  return { ok: true };
}

export async function sendNotification({ userId, title, body }) {
  const { error } = await must().from("notifications")
    .insert({ user_id: userId, title, body: body || "" });
  if (error) throw error;
  pingLocal("notifications");
  return { ok: true };
}

/* ─── Change notifications ──────────────────────────────────────────────────
   Two ways a screen learns data changed:
   1. LOCAL bus — a write on THIS device immediately tells every hook here to
      refetch, so the UI updates instantly even if Supabase Realtime isn't
      enabled on the tables. This is what makes the admin toggles feel live.
   2. Supabase Realtime — pushes changes made on OTHER devices (needs the tables
      added to the realtime publication; see the setup SQL). */
const LOCAL_CHANGE = "ngs-backend-change";

// Call after a successful write so same-device screens refetch right away.
export function pingLocal(table) {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(LOCAL_CHANGE, { detail: { table } }));
}

let channelSeq = 0;
export function subscribeTable(table, cb) {
  if (!supabase) return () => {};
  // Local (same-device) updates.
  const onLocal = (e) => { if (!e?.detail || e.detail.table === table) cb(); };
  if (typeof window !== "undefined") window.addEventListener(LOCAL_CHANGE, onLocal);
  // Cross-device updates via Realtime. Unique channel name per subscription.
  const ch = supabase
    .channel(`rt-${table}-${++channelSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table }, cb)
    .subscribe();
  return () => {
    if (typeof window !== "undefined") window.removeEventListener(LOCAL_CHANGE, onLocal);
    supabase.removeChannel(ch);
  };
}
