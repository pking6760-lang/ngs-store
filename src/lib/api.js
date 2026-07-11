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

/* ─── Shape mappers: DB (snake_case) ↔ app (camelCase) ──────────────────────
   The screens were built against the localStorage shapes, so we translate
   database rows into those same shapes and vice-versa. This keeps the UI code
   unchanged. */
const num = (v) => (v == null ? v : Number(v));

function mapProduct(r) {
  return { id: r.id, name: r.name, unit: r.unit, price: num(r.price),
    mrp: num(r.mrp), icon: r.icon, image: r.image_url, category: r.category,
    stock: r.stock, active: r.active };
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
    pointsEarned: r.points_earned, total: num(r.total), paymentStatus: r.payment_status,
    address: r.address, distanceKm: num(r.distance_km), location: r.location,
    rating: r.rating, feedback: r.feedback,
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
  const { data, error } = await must().functions.invoke("razorpay-create-order", {
    body: { orderId: orderDbId },
  });
  if (error) throw new Error(data?.error || error.message || "Couldn't start payment.");
  if (data?.error) throw new Error(data.error);
  return data; // { keyId, orderId, amount, currency, humanCode }
}

// Hand the Razorpay result back to the server, which verifies the signature and
// confirms the order. Returns { ok: true } only if the payment is genuine.
export async function verifyRazorpayPayment(payload) {
  const { data, error } = await must().functions.invoke("razorpay-verify", { body: payload });
  if (error) throw new Error(data?.error || error.message || "Couldn't verify payment.");
  if (data?.error) throw new Error(data.error);
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

/* ─── Admin: catalog ────────────────────────────────────────────────────── */

export async function upsertProduct(product) {
  const { error } = await must().from("products").upsert(product);
  if (error) throw error;
  pingLocal("products");
  return { ok: true };
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
