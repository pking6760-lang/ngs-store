// ============================================================================
// api.js — the app's single connection to the secure Supabase backend.
// ============================================================================
// Every screen reads/writes through here. The important, money-touching calls
// (placing an order, earning/spending points, rating) go through server-side
// database FUNCTIONS (rpc) that recompute everything — the app cannot set a
// price, a total, or a points balance. Reads are protected by Row-Level
// Security, so a customer only ever sees their own orders/points/profile.
import { supabase, isBackendConfigured } from "./supabase.js";
import { fileToResizedBlob } from "./image.js";
import { deviceFingerprint } from "./device.js";

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
    category: r.category, stock: r.stock, active: r.active, barcode: r.barcode || "",
    tags: r.tags || [],
    // Manual availability override (owner's "Out of stock" toggle). Defaults to
    // available when the column is absent/null so old rows read as in stock.
    inStock: r.in_stock == null ? true : r.in_stock,
    // Public merchandising flags: `bait` (best-price deal) and `hot` (selling
    // fast). Cost, tier and the sales numbers are admin-only (fetchAdminProducts).
    bait: !!r.bait, hot: !!r.hot,
    // Low-margin item (milk/curd/bread): its value does NOT count toward the
    // free-delivery threshold. Still buyable and counts toward everything else.
    freeDeliveryExempt: !!r.free_delivery_exempt || !!r.free_delivery_exempt_auto,
    // Thin-margin staple: no member discount, no points, no scratch reward.
    noRewards: !!r.no_rewards,
    // Tiered member pricing: the public deep anchor (cost + minimum margin).
    // The shopper's price sits between this and the MRP per their tier — the
    // client mirrors the server exactly (see tierUnitPrice in bulk.js).
    memberPriceFloor: r.member_price_floor != null ? Number(r.member_price_floor) : null,
    bulkTiers: Array.isArray(r.bulk_tiers) ? r.bulk_tiers : [] };
}
function mapCategory(r) {
  return { id: r.id, name: r.name, icon: r.icon, color: r.color, image: r.image_url || "" };
}
function mapCoupon(r) {
  return { code: r.code, type: r.type, value: num(r.value),
    minOrder: num(r.min_order), category: r.category || "", active: r.active,
    singleUse: !!r.single_use, guaranteed: !!r.guaranteed,
    excludedCategories: r.excluded_categories || [],
    excludedProducts: r.excluded_products || [] };
}
function couponToDb(c) {
  return { code: (c.code || "").trim().toUpperCase(), type: c.type === "flat" ? "flat" : "percent",
    value: Number(c.value) || 0, min_order: Number(c.minOrder) || 0,
    category: (c.category || "").trim(), active: c.active !== false,
    single_use: !!c.singleUse, guaranteed: !!c.guaranteed,
    excluded_categories: c.excludedCategories || [],
    excluded_products: c.excludedProducts || [] };
}
function mapSettings(r) {
  if (!r) return null;
  return { storeOpen: r.store_open, deliveryMode: r.delivery_mode,
    offerBanner: r.offer_banner, rewards: r.rewards, deliveryFee: num(r.delivery_fee),
    freeDeliveryAbove: num(r.free_delivery_above), handlingFee: num(r.handling_fee),
    surgeFee: num(r.surge_fee), maxDistanceKm: num(r.max_distance_km),
    smallCartFee: r.small_cart_fee != null ? num(r.small_cart_fee) : 0,
    smallCartThreshold: r.small_cart_threshold != null ? num(r.small_cart_threshold) : 0,
    farZoneKm: r.far_zone_km != null ? num(r.far_zone_km) : null,
    freeDeliveryFarAbove: r.free_delivery_far_above != null ? num(r.free_delivery_far_above) : null,
    farZoneKm2: r.far_zone_km_2 != null ? num(r.far_zone_km_2) : null,
    deliveryFeeMid: r.delivery_fee_mid != null ? num(r.delivery_fee_mid) : null,
    deliveryFeeFar: r.delivery_fee_far != null ? num(r.delivery_fee_far) : null,
    codCustomerLimit: num(r.cod_customer_limit),
    shopLocations: r.shop_locations || [], lowStockThreshold: r.low_stock_threshold,
    automation: r.automation || null,
    // Store contact number the customer can call about an order (live tracker).
    supportPhone: (r.support_phone || "").replace(/\D/g, ""),
    cancelFee: r.cancel_fee != null ? num(r.cancel_fee) : 20,
    subDeliveryFee: r.sub_delivery_fee != null ? num(r.sub_delivery_fee) : 10 };
}
function settingsToDb(p) {
  const map = { storeOpen: "store_open", deliveryMode: "delivery_mode",
    offerBanner: "offer_banner", rewards: "rewards", deliveryFee: "delivery_fee",
    freeDeliveryAbove: "free_delivery_above", handlingFee: "handling_fee",
    surgeFee: "surge_fee", maxDistanceKm: "max_distance_km",
    shopLocations: "shop_locations", lowStockThreshold: "low_stock_threshold",
    automation: "automation", supportPhone: "support_phone", cancelFee: "cancel_fee" };
  const out = {};
  for (const k in p) if (map[k]) out[map[k]] = p[k];
  return out;
}
function mapOrder(r) {
  return { id: r.human_code || r.id, dbId: r.id, createdAt: r.created_at,
    customer: r.customer_name, userId: r.user_id, userPhone: r.user_phone,
    // Customer's searchable code (present when the query embeds profiles).
    customerCode: r.profiles?.customer_code || r.customer_code || null,
    accepted: r.accepted, member: r.member, status: r.status,
    items: (r.order_items || []).map((i) => ({ id: i.product_id, name: i.name,
      icon: i.icon, qty: i.qty, price: num(i.price) })),
    itemTotal: num(r.item_total),
    // r.discount is the COUPON discount; r.points_discount is the points redemption.
    couponDiscount: num(r.discount), couponCode: r.coupon_code,
    pointsDiscount: num(r.points_discount), pointsRedeemed: r.points_redeemed || 0,
    deliveryFee: num(r.delivery_fee), handling: num(r.handling), surgeFee: num(r.surge_fee),
    pointsEarned: r.points_earned, total: num(r.total),
    payment: r.payment_method, paymentMethod: r.payment_method, paymentStatus: r.payment_status,
    razorpayPaymentId: r.razorpay_payment_id,
    address: r.address, distanceKm: num(r.distance_km), location: r.location,
    rating: r.rating, feedback: r.feedback, riderRating: r.rider_rating || 0, needsOwner: !!r.needs_owner,
    walletUsed: num(r.wallet_used), refundedAmount: num(r.refunded_amount), refundedAt: r.refunded_at,
    isReturn: !!r.is_return, returnOf: r.return_of, isMembership: !!r.is_membership, isTopup: !!r.is_topup,
    membershipFee: num(r.membership_fee), membershipDays: r.membership_days || 0,
    welcomeDiscount: num(r.welcome_discount),
    // Prime savings meter: what this member saved vs the normal price.
    memberSavings: num(r.member_savings),
    scratchClaimed: !!r.scratch_claimed, scratchReward: r.scratch_reward || null,
    scratchPoints: r.scratch_points || 0, scratchWallet: num(r.scratch_wallet),
    deliveryState: r.delivery_state, pickerState: r.picker_state,
    riderId: r.rider_id, pickerId: r.picker_id, deliveredAt: r.delivered_at, packedAt: r.packed_at,
    // Subscriptions: the master prepaid plan order (isSubscription) vs the daily
    // milk orders it spawns (subscriptionId set, deliverOn/deliverHour = the drop).
    isSubscription: !!r.is_subscription, subscriptionId: r.subscription_id,
    deliverOn: r.deliver_on, deliverHour: r.deliver_hour,
    // Customer-chosen delivery window (null = express "Now").
    deliverySlot: r.delivery_slot || null,
    count: (r.order_items || []).reduce((s, i) => s + i.qty, 0) };
}
function mapProfile(r) {
  if (!r) return null;
  return { id: r.id, name: r.name, phone: r.phone, email: r.email,
    address: r.address, points: r.points, member: r.is_member,
    customerCode: r.customer_code || null, orderCount: r.order_count || 0,
    memberOrderCount: r.member_order_count || 0, membershipCount: r.membership_count || 0,
    memberSince: r.member_since, memberUntil: r.member_until, role: r.role, createdAt: r.created_at };
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

/* ─── Saved addresses (Home / Work / Other) ─────────────────────────────── */

function mapAddress(a) {
  return { id: a.id, label: a.label, address: a.full_address, location: a.location, isDefault: !!a.is_default };
}

export async function fetchMyAddresses() {
  const { data, error } = await must()
    .from("customer_addresses").select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapAddress);
}

export async function addAddress({ label, address, location = null, makeDefault = true }) {
  const { data, error } = await must().rpc("add_address", {
    p_label: label, p_address: address, p_location: location, p_make_default: makeDefault,
  });
  if (error) throw new Error(error.message || "Couldn't save the address.");
  pingLocal("profiles");
  return mapAddress(Array.isArray(data) ? data[0] : data);
}

export async function updateAddress(id, { label, address, location = null }) {
  const { data, error } = await must().rpc("update_address", {
    p_id: id, p_label: label, p_address: address, p_location: location,
  });
  if (error) throw new Error(error.message || "Couldn't update the address.");
  pingLocal("profiles");
  return mapAddress(Array.isArray(data) ? data[0] : data);
}

export async function setDefaultAddress(id) {
  const { error } = await must().rpc("set_default_address", { p_id: id });
  if (error) throw new Error(error.message || "Couldn't set the address.");
  pingLocal("profiles");
  return { ok: true };
}

export async function deleteAddress(id) {
  const { error } = await must().rpc("delete_address", { p_id: id });
  if (error) throw new Error(error.message || "Couldn't delete the address.");
  pingLocal("profiles");
  return { ok: true };
}

/* ─── Catalog / settings (public read) ──────────────────────────────────── */

// High-margin "add something extra" suggestions for the cart. Cost/margin is
// computed server-side; only public product fields come back.
export async function fetchAddonSuggestions(excludeIds = [], limit = 8) {
  const { data, error } = await must().rpc("suggest_addons", { p_exclude: excludeIds, p_limit: limit });
  if (error) return [];
  return (data || []).map(mapProduct);
}

// Mirror the signed-in customer's cart to the server so an abandoned cart can be
// nudged later. Fire-and-forget; never blocks the UI. No-op for guests (RLS).
export async function saveCart(items) {
  try { await must().rpc("save_cart", { p_items: items || {} }); } catch { /* ignore */ }
}

// ── Subscriptions (prepaid daily plans) ─────────────────────────────────────
function mapSubscription(r) {
  return {
    id: r.id, items: Array.isArray(r.items) ? r.items : [],
    address: r.address || "", location: r.location || null,
    hour: r.deliver_hour ?? 8,
    daysTotal: r.days_total, daysDone: r.days_done,
    dailyTotal: Number(r.daily_total) || 0, amount: Number(r.amount) || 0,
    payMethod: r.pay_method || "wallet", status: r.status,
    startDate: r.start_date || null, lastDelivery: r.last_delivery || null,
    skipDates: Array.isArray(r.skip_dates) ? r.skip_dates : [],
    createdAt: r.created_at,
  };
}
export async function fetchMySubscriptions() {
  const { data, error } = await must()
    .from("subscriptions").select("*").order("created_at", { ascending: false });
  if (error) return [];
  return (data || []).map(mapSubscription);
}
// Buy a prepaid plan. Returns the advance-payment order ({ dbId, total, ... }).
// Wallet plans come back already paid+active; razorpay plans need a payment step.
export async function createSubscriptionOrder({ items, days, hour, address, location, pay }) {
  const { data, error } = await must().rpc("create_subscription_order", {
    p_items: items, p_days: days, p_hour: hour,
    p_address: address || null, p_location: location || null, p_pay: pay || "wallet",
  });
  if (error) throw error;
  return { dbId: data.id, subscriptionId: data.subscription_id, total: Number(data.total) || 0,
    status: data.status, payMethod: data.payment_method };
}
export async function cancelSubscription(id) {
  const { error } = await must().rpc("cancel_subscription", { p_id: id });
  if (error) throw error;
}
// Skip the plan's next delivery (not home that day). Returns the skipped date;
// the plan extends so no day is lost.
export async function skipNextDelivery(id) {
  const { data, error } = await must().rpc("skip_next_delivery", { p_id: id });
  if (error) throw new Error(error.message || "Couldn't skip that day.");
  return data;
}
// Skip the next N deliveries ("away for a few days"). Returns how many were skipped.
export async function skipDeliveries(id, count) {
  const { data, error } = await must().rpc("skip_deliveries", { p_id: id, p_count: count });
  if (error) throw new Error(error.message || "Couldn't skip those days.");
  return Number(data) || 0;
}
// The customer's nearest upcoming subscription delivery (to offer "add to it").
export async function fetchUpcomingDelivery() {
  const { data, error } = await must()
    .from("orders")
    .select("id, deliver_on, human_code, order_items(name, qty, icon)")
    .not("subscription_id", "is", null)
    .eq("is_subscription", false)
    .eq("status", "Scheduled")
    .order("deliver_on", { ascending: true })
    .limit(1);
  if (error || !data || !data.length) return null;
  const o = data[0];
  return { id: o.id, deliverOn: o.deliver_on, code: o.human_code, items: o.order_items || [] };
}
// Add items to the next subscription delivery, prepaid by wallet or online.
export async function addToDelivery(items, pay = "wallet") {
  const { data, error } = await must().rpc("add_to_delivery", { p_items: items, p_pay: pay });
  if (error) throw new Error(error.message || "Couldn't add to your delivery.");
  return { dbId: data.id, total: Number(data.total) || 0, status: data.status };
}
// Leave the online-pay screen without paying → drop the unpaid pending plan.
export async function discardPendingSubscription(id) {
  if (!id) return;
  try { await must().rpc("discard_pending_subscription", { p_id: id }); } catch { /* ignore */ }
}

// "Buy again": the products the signed-in customer has bought before, most
// useful first, filtered to what's still buyable. Empty for guests / new users.
export async function fetchBuyAgain(limit = 15) {
  const { data, error } = await must().rpc("my_buy_again", { p_limit: limit });
  if (error) return [];
  return (data || []).map(mapProduct);
}

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

// True when a one-time coupon was already redeemed by this account or on this
// physical device — checked when the customer applies the code, so they find
// out immediately instead of at checkout.
export async function couponUsed(code) {
  let device = null;
  try { device = await deviceFingerprint(); } catch { /* best-effort */ }
  const { data, error } = await must().rpc("coupon_used", { p_code: code, p_device: device });
  if (error) return false; // fail open here — checkout enforces it authoritatively
  return !!data;
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
export async function placeOrder({ items, coupon, location, payment, address, wallet, redeemPoints, membership, deliverySlot, deliverOn, deliverHour }) {
  const p_items = items.map((i) => ({ id: i.id, qty: i.qty }));
  // Device fingerprint enforces one-time coupons per physical device.
  let p_device = null;
  try { p_device = await deviceFingerprint(); } catch { /* best-effort */ }
  const { data, error } = await must().rpc("place_order", {
    p_device,
    p_items,
    p_coupon: coupon || null,
    p_location: location || null,
    p_payment: payment || "upi",
    p_address: address || null,
    p_wallet: Math.max(0, Number(wallet) || 0),
    p_redeem_points: Math.max(0, Math.floor(Number(redeemPoints) || 0)),
    p_membership: !!membership,
    p_deliver_slot: deliverySlot || null,
    // Future window → the order is held as Scheduled and released on its day.
    p_deliver_on: deliverOn || null,
    p_deliver_hour: deliverHour ?? null,
  });
  if (error) throw error;
  pingLocal("orders");
  pingLocal("products"); // stock changed
  pingLocal("customer_wallet");
  return mapOrder(data);
}

// ── Customer NGS Wallet (store credit) ──────────────────────────────────────
export async function walletBalance() {
  const { data, error } = await must().rpc("wallet_balance");
  if (error) throw error;
  return Number(data) || 0;
}
export async function fetchWalletLedger() {
  const { data, error } = await must()
    .from("customer_wallet").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id, amount: Number(r.amount), kind: r.kind, note: r.note,
    orderId: r.order_id, at: r.created_at,
  }));
}
// Admin: refund an order to the customer's NGS wallet.
export async function adminRefundToWallet(orderDbId, amount, note) {
  const { error } = await must().rpc("admin_refund_to_wallet", {
    p_order: orderDbId, p_amount: Number(amount), p_note: note || null,
  });
  if (error) throw new Error(error.message || "Couldn't process the refund.");
  pingLocal("orders");
  pingLocal("customer_wallet");
  return { ok: true };
}

// Admin: start a return for a delivered order. Optionally pass a subset of
// items to return: [{ id, qty }]. Omit (or pass null) to return everything.
// A return task is dispatched to a delivery partner to collect the items; on
// confirmation the goods value is refunded to the customer's wallet and earned
// points reversed (proportionally for a partial return).
export async function adminCreateReturn(orderDbId, items = null) {
  const { data, error } = await must().rpc("admin_create_return", {
    p_order: orderDbId,
    p_items: items && items.length ? items : null,
  });
  if (error) throw new Error(error.message || "Couldn't create the return.");
  pingLocal("orders");
  return { ok: true, returnId: data };
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

// Product details lookup (name / brand / weight) for auto-filling a product.
// Server-side: Open Food Facts, then Gemini web search for Indian brands.
export async function lookupProductDetails(barcode, name, categories) {
  return invokeFn("product-lookup", {
    barcode: barcode || "", name: name || "",
    categories: Array.isArray(categories) ? categories : [],
  });
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
// Customer-facing: the delivery partner assigned to MY order (name + phone),
// for the live tracking screen. Returns null until a rider is assigned.
export async function fetchOrderRider(dbId) {
  if (!dbId) return null;
  const { data, error } = await must().rpc("get_order_rider", { p_order: dbId });
  if (error) return null;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || !r.name) return null;
  return {
    name: r.name, phone: r.phone, deliveryState: r.delivery_state,
    lat: r.rider_lat != null ? Number(r.rider_lat) : null,
    lng: r.rider_lng != null ? Number(r.rider_lng) : null,
    locAt: r.rider_loc_at || null,
  };
}

// Rider streams their live GPS during a delivery.
export async function partnerUpdateLocation(orderId, lat, lng) {
  const { error } = await must().rpc("partner_update_location", { p_order: orderId, p_lat: lat, p_lng: lng });
  if (error) throw error;
}

// Report where the partner is while ONLINE (even when idle), so new orders go
// to the nearest free rider. Best-effort — failures are ignored.
export async function partnerPingLocation(lat, lng) {
  try { await must().rpc("partner_ping_location", { p_lat: lat, p_lng: lng }); } catch { /* ignore */ }
}

// Customer attaches their exact location to an order placed without one, so
// live tracking + the map light up. Only works while the order is in flight.
export async function setOrderLocation(orderId, location) {
  const { error } = await must().rpc("set_order_location", { p_order: orderId, p_location: location });
  if (error) throw new Error(error.message || "Couldn't save your location.");
  pingLocal("orders");
}

// Customer scratches the reward card after delivery. Returns { type, amount }.
export async function claimScratchReward(orderId) {
  const { data, error } = await must().rpc("claim_scratch_reward", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't claim the reward.");
  pingLocal("orders");
  return data; // { type, amount }
}

export async function fetchOrderState(dbId) {
  const { data, error } = await must()
    .from("orders").select("payment_status,status").eq("id", dbId).single();
  if (error) throw error;
  return data; // { payment_status, status }
}

// Customer abandoned an online payment (left the QR screen without paying).
// Cancel their still-unpaid order so any redeemed points / wallet money are
// returned to them immediately, instead of waiting for the cleanup cron.
// ── Back-in-stock alerts ────────────────────────────────────────────────────
export async function setStockAlert(productId) {
  const { error } = await must().rpc("set_stock_alert", { p_product_id: productId });
  if (error) throw error;
  return { ok: true };
}
export async function clearStockAlert(productId) {
  const { error } = await must().rpc("clear_stock_alert", { p_product_id: productId });
  if (error) throw error;
  return { ok: true };
}
export async function fetchMyStockAlerts() {
  const { data, error } = await must().rpc("my_stock_alerts");
  if (error) throw error;
  return (data || []).map((r) => (typeof r === "string" ? r : r?.my_stock_alerts ?? r));
}

// Customer cancels an active order (Placed/Packed). The server decides the fee
// (free within the grace window) and handles the refund. Returns { fee, refunded }.
export async function cancelMyOrder(dbId, reason) {
  const { data, error } = await must().rpc("cancel_my_order", { p_order: dbId, p_reason: reason || null });
  if (error) throw new Error(error.message || "Couldn't cancel the order.");
  pingLocal("orders");
  pingLocal("customer_wallet");
  return data || { ok: true };
}

export async function cancelPendingOrder(dbId) {
  if (!dbId) return;
  const { error } = await must().rpc("cancel_my_unpaid_order", { p_order_id: dbId });
  if (error) throw error;
  pingLocal("orders");
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
    // Hide online orders whose payment never completed (still awaiting, or the
    // customer abandoned the pay screen → 'Payment failed'). Never a real order.
    .neq("status", "Awaiting payment")
    .neq("status", "Payment failed")
    // Return pickups are internal logistics rows — the customer sees the parent
    // order flip to "Returned", not the pickup task itself.
    .eq("is_return", false)
    .eq("is_membership", false)
    // Wallet top-ups are payments, not orders — they show in the Wallet history.
    .eq("is_topup", false)
    // Subscription advance payments are not delivery orders (the daily deliveries
    // they create show normally).
    .eq("is_subscription", false)
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

// Customer rates the delivery partner for a delivered order.
export async function rateOrderRider(orderId, rating) {
  const { error } = await must().rpc("rate_order_rider", { p_order: orderId, p_rating: rating });
  if (error) throw error;
  pingLocal("orders");
  return { ok: true };
}

// Referral: a new customer applies a friend's code (before their first order).
// We send a deterministic device fingerprint so the same physical device can't
// farm the welcome bonus across new email accounts / incognito / a VPN.
export async function applyReferral(code) {
  let device = null;
  try { device = await deviceFingerprint(); } catch { /* best-effort */ }
  const { data, error } = await must().rpc("apply_referral", { p_code: code, p_device: device });
  if (error) throw new Error(error.message || "Couldn't apply that code.");
  pingLocal("profiles");
  return data;
}

// Referral: my share code + how many friends joined / how much I've earned.
export async function myReferralStats() {
  const { data, error } = await must().rpc("my_referral_stats");
  if (error) throw new Error(error.message || "Couldn't load referral info.");
  return data;
}

// Customer joins / renews NGS Prime, paying the fee from their wallet.
export async function joinMembership() {
  const { data, error } = await must().rpc("join_membership");
  if (error) throw new Error(error.message || "Couldn't join. Please try again.");
  pingLocal("profiles");
  pingLocal("customer_wallet");
  return data;
}

// Create a membership purchase that runs through the normal Razorpay QR flow.
export async function createMembershipOrder() {
  const { data, error } = await must().rpc("create_membership_order");
  if (error) throw new Error(error.message || "Couldn't start the payment.");
  const row = Array.isArray(data) ? data[0] : data;
  return mapOrder(row);
}

// Create a wallet top-up order (₹50–₹10,000) that runs through the same Razorpay
// QR flow. The wallet is credited server-side only once Razorpay confirms.
export async function createTopupOrder(amount) {
  const { data, error } = await must().rpc("create_topup_order", { p_amount: amount });
  if (error) throw new Error(error.message || "Couldn't start the payment.");
  const row = Array.isArray(data) ? data[0] : data;
  return mapOrder(row);
}

// Admin activates membership for a customer who paid at the shop.
export async function adminGrantMembership(userId, days = 30) {
  const { error } = await must().rpc("admin_grant_membership", { p_user_id: userId, p_days: days });
  if (error) throw new Error(error.message || "Couldn't activate membership.");
  pingLocal("profiles");
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
  // Map to the app shape (createdAt) so timestamps render in the inbox.
  return (data || []).map((n) => ({
    id: n.id, title: n.title, body: n.body, read: n.read, createdAt: n.created_at,
  }));
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
    pan: r.pan, dl: r.dl, selfiePath: r.selfie_path, livenessVideoPath: r.liveness_video_path,
    kycRequests: Array.isArray(r.kyc_requests) ? r.kyc_requests : [],
    status: r.status, createdAt: r.created_at,
    empCode: r.emp_code || null,
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

// Admin: app health snapshot (photos-in-DB, list payload size, storage ready…).
export async function fetchAppHealth() {
  const { data, error } = await must().rpc("app_health");
  if (error) throw error;
  return data;
}

// Upload a product photo to the public product-images bucket → returns its CDN
// URL. Images live in Storage (served + cached by the CDN, loaded lazily per
// card), NOT as base64 in the products row — so the product list stays tiny
// no matter how many photos are added.
export async function uploadProductImage(file) {
  const blob = await fileToResizedBlob(file);
  const name = `p${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await must().storage
    .from("product-images").upload(name, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { data } = must().storage.from("product-images").getPublicUrl(name);
  return data.publicUrl;
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

// Upload a liveness selfie (jpeg) or its motion video (webm/mp4) to the private
// KYC bucket → returns the storage path.
export async function uploadPartnerMedia(blob, kind) {
  const { data: u } = await must().auth.getUser();
  if (!u?.user) throw new Error("Please sign in again.");
  const isVideo = (blob.type || "").startsWith("video");
  let out = blob, ext = "jpg", contentType = "image/jpeg";
  if (isVideo) {
    ext = (blob.type || "").includes("mp4") ? "mp4" : "webm";
    contentType = blob.type || "video/webm";
  } else {
    out = await compressImage(blob);
  }
  const path = `${u.user.id}/${kind}.${ext}`;
  const { error } = await must().storage
    .from("partner-docs").upload(path, out, { upsert: true, contentType });
  if (error) throw error;
  return path;
}

// Admin: ask a partner to (re)submit specific KYC items (e.g. ["selfie"]).
export async function adminRequestKyc(userId, items) {
  const { error } = await must().rpc("admin_request_kyc", { p_user_id: userId, p_items: items });
  if (error) throw new Error(error.message || "Couldn't send the request.");
  pingLocal("partners");
  return { ok: true };
}

// Partner: submit ONE requested item. Selfie takes the live photo + video;
// document items take a photo file.
export async function partnerSubmitSelfie(selfieBlob, videoBlob) {
  const selfiePath = await uploadPartnerMedia(selfieBlob, "selfie");
  let videoPath = null;
  try { if (videoBlob) videoPath = await uploadPartnerMedia(videoBlob, "liveness"); } catch { /* best-effort */ }
  const { error } = await must().rpc("partner_submit_kyc_item", { p_item: "selfie", p_path: selfiePath, p_extra: videoPath });
  if (error) throw new Error(error.message || "Couldn't submit your selfie.");
  pingLocal("partners");
  return { ok: true };
}

export async function partnerSubmitDoc(item, file) {
  const path = await uploadPartnerDoc(file, item);
  const { error } = await must().rpc("partner_submit_kyc_item", { p_item: item, p_path: path, p_extra: null });
  if (error) throw new Error(error.message || "Couldn't submit your document.");
  pingLocal("partners");
  return { ok: true };
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
    pan: p.pan || null, dl: p.dl || null,
    selfie_path: p.selfie || null, liveness_video_path: p.livenessVideo || null,
    status: "pending",
  };
  const { error } = await must().from("partners").upsert(row, { onConflict: "user_id" });
  if (error) throw error;
  pingLocal("partners");
  return { ok: true };
}

// Partner re-accepts an updated Terms version (records renewed consent).
export async function acceptPartnerTerms(version) {
  const { error } = await must().rpc("partner_accept_terms", { p_version: String(version) });
  if (error) throw new Error(error.message || "Couldn't record acceptance.");
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
  // Partner-facing config only. ops_config itself is admin-only (it holds
  // margins & payout formulas a partner must not see), so read the handful of
  // fields the partner app needs via a SECURITY DEFINER RPC.
  const { data, error } = await must().rpc("get_partner_config");
  if (error) throw error;
  return data || null;
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

// Admin: live presence for every partner (who's online right now). RLS lets an
// admin read all partner_presence rows. Returns a map keyed by user_id.
export async function fetchStaffPresence() {
  const { data, error } = await must()
    .from("partner_presence")
    .select("user_id, is_online, active_order_id, went_online_at, updated_at, loc_at");
  if (error) return {};
  const out = {};
  (data || []).forEach((r) => {
    out[r.user_id] = {
      isOnline: !!r.is_online,
      activeOrderId: r.active_order_id || null,
      wentOnlineAt: r.went_online_at || null,
      updatedAt: r.updated_at || null,
      locAt: r.loc_at || null,
    };
  });
  return out;
}

/* ─── In-app updates (forced) ───────────────────────────────────────────── */

// Latest published version for an app ('customer' | 'partner' | 'admin').
export async function getAppVersion(app) {
  const { data, error } = await must().rpc("get_app_version", { p_app: app });
  if (error) return null;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  return { app: r.app, versionName: r.version_name, versionCode: Number(r.version_code), apkUrl: r.apk_url, releaseNotes: r.release_notes };
}
export async function fetchAllAppVersions() {
  const { data, error } = await must().from("app_versions").select("*").order("app");
  if (error) return [];
  return (data || []).map((r) => ({
    app: r.app, versionName: r.version_name, versionCode: Number(r.version_code),
    apkUrl: r.apk_url, releaseNotes: r.release_notes, updatedAt: r.updated_at,
  }));
}
// Brand sponsorship campaigns (admin).
export async function adminListSponsorships() {
  const { data, error } = await must().rpc("admin_list_sponsorships");
  if (error) throw new Error(error.message || "Couldn't load sponsorships.");
  return (data || []).map((r) => ({
    id: r.id, brand: r.brand, amount: Number(r.amount), spent: Number(r.spent),
    remaining: Number(r.remaining), startsOn: r.starts_on, endsOn: r.ends_on,
    active: r.active, note: r.note, deliveries: r.deliveries, lastUsed: r.last_used,
  }));
}
export async function adminSaveSponsorship({ id, brand, amount, startsOn, endsOn, active, note }) {
  const { error } = await must().rpc("admin_save_sponsorship", {
    p_id: id || null, p_brand: brand, p_amount: Number(amount),
    p_starts: startsOn || null, p_ends: endsOn || null,
    p_active: active !== false, p_note: note || null,
  });
  if (error) throw new Error(error.message || "Couldn't save.");
  return { ok: true };
}

// Is a brand currently funding delivery? Returns the brand name, or null.
// Publishes only the name — never the amount, balance, or commercial terms.
export async function sponsoredDeliveryNow(fee) {
  const { data, error } = await must().rpc("sponsored_delivery_now", { p_fee: Number(fee) || 0 });
  if (error) return null;
  return data || null;
}
// What a coupon is really worth on this cart. The payout is capped at the
// cart's margin, which needs buying prices, so only the server can say — this
// returns the amount and whether it was capped, and nothing about cost.
export async function couponQuote(items, code) {
  const { data, error } = await must().rpc("coupon_quote", { p_items: items, p_code: code });
  if (error) return null;
  return data || null;
}
// Admin: upload a new APK to the public app-releases bucket; returns its URL.
export async function adminUploadAppApk(file, app, versionCode, onProgress) {
  const path = `${app}-v${versionCode}.apk`;
  const sb = must();
  // An APK is ~25 MB and the owner uploads it from a phone, so a silent
  // "it's working, honest" spinner is not good enough — XHR is used instead of
  // the SDK's fetch upload purely because it reports real progress. Falls back
  // to the SDK if anything about the direct call is unavailable.
  const session = (await sb.auth.getSession())?.data?.session;
  const token = session?.access_token;
  const base = `${String(FN_URL).replace(/\/+$/, "")}/storage/v1`;
  let uploaded = false;
  if (token && typeof XMLHttpRequest !== "undefined" && typeof FormData !== "undefined") {
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${base}/object/app-releases/${encodeURIComponent(path)}`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("apikey", FN_ANON);
        xhr.setRequestHeader("x-upsert", "true");
        // Multipart, matching exactly what supabase-js sends. Content-Type is
        // deliberately NOT set — the browser must add its own MIME boundary.
        const form = new FormData();
        form.append("cacheControl", "3600");
        form.append("", file);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          let detail = "";
          try { detail = JSON.parse(xhr.responseText)?.message || ""; } catch { detail = ""; }
          reject(new Error(detail || `Upload failed (${xhr.status}).`));
        };
        xhr.onerror = () => reject(new Error("network"));
        xhr.ontimeout = () => reject(new Error("network"));
        xhr.send(form);
      });
      uploaded = true;
    } catch {
      uploaded = false; // fall through to the SDK, which is the known-good path
    }
  }
  if (!uploaded) {
    // No progress here, but it is the battle-tested path — never let the
    // progress-reporting shortcut be the reason a release cannot be published.
    if (onProgress) onProgress(0);
    const { error } = await sb.storage.from("app-releases")
      .upload(path, file, { contentType: "application/vnd.android.package-archive", upsert: true });
    if (error) throw new Error(error.message || "Upload failed.");
    if (onProgress) onProgress(100);
  }
  const { data } = sb.storage.from("app-releases").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`; // cache-bust so the new build downloads
}
// Admin: publish a version — every installed app below it is forced to update.
export async function adminPublishAppVersion({ app, versionName, versionCode, apkUrl, notes }) {
  const { error } = await must().rpc("admin_publish_app_version", {
    p_app: app, p_version_name: versionName, p_version_code: Number(versionCode),
    p_apk_url: apkUrl || null, p_notes: notes || null,
  });
  if (error) throw new Error(error.message || "Couldn't publish the update.");
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
  // Admin-guarded wrapper (smart_reprice itself is locked to cron/postgres now).
  const { error } = await must().rpc("admin_smart_reprice");
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
// Owner override for the Bestseller badge: 'pin' | 'hide' | null (auto).
export async function setHotOverride(productId, value) {
  const { error } = await must().from("product_costs")
    .upsert({ product_id: productId, hot_override: value });
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
// Admin corrections (fix mistakes / test data).
export async function partnerClearStrikes(userId) {
  const { error } = await must().rpc("admin_clear_strikes", { p_user: userId });
  if (error) throw new Error(error.message || "Couldn't clear strikes.");
  pingLocal("partner_strikes");
  return { ok: true };
}
// amount is signed: positive credits the partner, negative debits them.
export async function partnerWalletAdjust(userId, amount, note) {
  const { error } = await must().rpc("admin_wallet_adjust", { p_user: userId, p_amount: amount, p_note: note || null });
  if (error) throw new Error(error.message || "Couldn't adjust wallet.");
  pingLocal("wallet_ledger");
  return { ok: true };
}

// Admin: a CUSTOMER's current wallet balance (RLS lets admins read any wallet).
export async function fetchCustomerBalance(userId) {
  const { data, error } = await must().from("customer_wallet").select("amount").eq("user_id", userId);
  if (error) return 0;
  return (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
}
// Admin: give (positive) or deduct (negative) a customer's wallet money. Returns
// the new balance.
export async function adminCreditWallet(userId, amount, note) {
  const { data, error } = await must().rpc("admin_customer_wallet_credit", { p_user: userId, p_amount: amount, p_note: note || null });
  if (error) throw new Error(error.message || "Couldn't update wallet.");
  return Number(data) || 0;
}

/* ─── Business finance (admin only — every RPC is is_admin() gated) ──────── */

// The whole P&L + cash picture for a date window.
export async function adminFinanceSummary(from, to) {
  const { data, error } = await must().rpc("admin_finance_summary", { p_from: from, p_to: to });
  if (error) throw new Error(error.message || "Couldn't load the finance summary.");
  return data;
}

export async function adminTopProducts(from, to, limit = 10) {
  const { data, error } = await must().rpc("admin_top_products", { p_from: from, p_to: to, p_limit: limit });
  if (error) throw new Error(error.message || "Couldn't load product profit.");
  return Array.isArray(data) ? data : [];
}

export async function adminListExpenses(from, to) {
  const { data, error } = await must().rpc("admin_list_expenses", { p_from: from, p_to: to });
  if (error) throw new Error(error.message || "Couldn't load expenses.");
  return Array.isArray(data) ? data : [];
}

export async function adminAddExpense({ kind, amount, note, spentOn, staffId }) {
  const { data, error } = await must().rpc("admin_add_expense", {
    p_kind: kind, p_amount: Number(amount), p_note: note || null,
    p_spent_on: spentOn || null, p_staff: staffId || null,
  });
  if (error) throw new Error(error.message || "Couldn't save that expense.");
  return data;
}

export async function adminDeleteExpense(id) {
  const { error } = await must().rpc("admin_delete_expense", { p_id: id });
  if (error) throw new Error(error.message || "Couldn't delete that expense.");
}

export async function adminListStaff() {
  const { data, error } = await must().rpc("admin_list_staff");
  if (error) throw new Error(error.message || "Couldn't load staff.");
  return Array.isArray(data) ? data : [];
}

export async function adminSaveStaff({ id, name, role, phone, salary, active, note }) {
  const { data, error } = await must().rpc("admin_save_staff", {
    p_id: id || null, p_name: name, p_role: role || "helper", p_phone: phone || null,
    p_salary: Number(salary) || 0, p_active: active !== false, p_note: note || null,
  });
  if (error) throw new Error(error.message || "Couldn't save that person.");
  return data;
}

export async function adminDeleteStaff(id) {
  const { error } = await must().rpc("admin_delete_staff", { p_id: id });
  if (error) throw new Error(error.message || "Couldn't remove that person.");
}

// A customer's full wallet ledger, for the admin customer profile.
export async function adminCustomerWalletHistory(userId) {
  const { data, error } = await must().rpc("admin_customer_wallet_history", { p_user: userId });
  if (error) throw new Error(error.message || "Couldn't load wallet history.");
  return (Array.isArray(data) ? data : []).map((r) => ({
    id: r.id, amount: Number(r.amount) || 0, kind: r.kind,
    note: r.note || "", createdAt: r.created_at, orderCode: r.order_code || null,
  }));
}

// Referral watch: every referral claim with its device/IP cluster size, so the
// admin can spot one device/connection farming the welcome bonus.
export async function adminReferralWatch() {
  const { data, error } = await must().rpc("admin_referral_watch");
  if (error) throw new Error(error.message || "Couldn't load referral activity.");
  return (Array.isArray(data) ? data : []).map((r) => ({
    refereeId: r.referee_id,
    code: r.code,
    name: r.name,
    email: r.email,
    deviceHash: r.device_hash,
    ip: r.ip,
    createdAt: r.created_at,
    status: r.status,
    reward: Number(r.reward_amount) || 0,
    referrerCode: r.referrer_code,
    referrerName: r.referrer_name,
    deviceCount: Number(r.device_count) || 0,
    ipCount: Number(r.ip_count) || 0,
    walletNet: Number(r.wallet_net) || 0,
  }));
}

// Reverse a referral bonus (debits the new customer, and the referrer too if
// they were already paid). Idempotent server-side.
export async function adminReferralClawback(refereeId, reason) {
  const { data, error } = await must().rpc("admin_referral_clawback", { p_referee: refereeId, p_reason: reason || null });
  if (error) throw new Error(error.message || "Couldn't reverse that referral.");
  return data;
}

// The partner's current assigned task (minimal fields, privacy-scoped).
export async function getMyTask() {
  const { data, error } = await must().rpc("get_my_task");
  if (error) return null;
  const t = Array.isArray(data) ? data[0] : data;
  if (!t) return null;
  return {
    orderId: t.order_id, code: t.code, role: t.task_role, state: t.state,
    isCod: t.is_cod, paid: t.paid, codAmount: t.cod_amount, location: t.location,
    items: (t.items || []).map((it) => ({
      name: it.name, qty: it.qty, barcode: it.barcode || "", productId: it.productId,
    })),
    isReturn: !!t.is_return, earning: Number(t.earning) || 0,
    packed: t.packed !== false, // old payloads without the field default to true
  };
}

// What the partner ACTUALLY earned on an order — read from the wallet ledger, so
// it returns 0 until the job is finished and the money is credited. That's the
// point: the payout is never shown up front (it would only invite picking and
// choosing), and this is the reveal once the work is done. Server-side scoped to
// the caller, so it can't be used to look up anyone else's pay.
export async function getOrderEarning(orderId) {
  if (!orderId) return 0;
  const { data, error } = await must().rpc("get_order_earning", { p_order: orderId });
  if (error) return 0;
  return Number(data) || 0;
}

// The driver's subscription "milk round" for today — every stop assigned to them
// (prepaid, so no cash to collect). Each stop pays 70% of its handling.
export async function getMyRound() {
  const { data, error } = await must().rpc("get_my_round");
  if (error) return [];
  return (data || []).map((r) => ({
    orderId: r.order_id, code: r.code, state: r.state,
    location: r.location, address: r.address || "", customer: r.customer || "Customer",
    phone: r.phone || "",
    items: (r.items || []).map((it) => ({ name: it.name, qty: it.qty })),
    earning: Number(r.earning) || 0, total: Number(r.total) || 0,
  }));
}

/* ─── In-app voice calls ────────────────────────────────────────────────── */

// Call the other party on an order (masked — the callee is resolved server-side,
// so you never see their number). Returns the call row { id, ... }.
export async function callOrderParty(orderId) {
  const { data, error } = await must().rpc("call_order_party", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't start the call.");
  return Array.isArray(data) ? data[0] : data;
}
export async function setCallStatus(callId, status) {
  const { error } = await must().rpc("set_call_status", { p_call: callId, p_status: status });
  if (error) throw new Error(error.message || "Call update failed.");
  return { ok: true };
}
// Any call currently ringing me (picked up when the app opens from a call push).
export async function fetchRingingCall() {
  const { data: u } = await must().auth.getUser();
  if (!u?.user) return null;
  const cutoff = new Date(Date.now() - 40000).toISOString();
  const { data, error } = await supabase
    .from("calls").select("*")
    .eq("callee_id", u.user.id).eq("status", "ringing")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  return (data && data[0]) || null;
}

// Order lifecycle (used once dispatch is wired).
export async function partnerAccept(orderId) {
  const { error } = await must().rpc("partner_accept", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't accept."); return { ok: true };
}
// Explicitly decline a just-assigned order — instantly rolls it to the next
// nearest free partner (or the owner if none). No penalty.
export async function partnerPass(orderId) {
  const { error } = await must().rpc("partner_pass", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't pass this order."); return { ok: true };
}
export async function partnerMarkPacked(orderId) {
  const { error } = await must().rpc("partner_mark_packed", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't mark packed."); return { ok: true };
}
export async function partnerMarkOutForDelivery(orderId) {
  const { error } = await must().rpc("partner_mark_out_for_delivery", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't start delivery."); return { ok: true };
}
// tendered = cash the customer handed over. Pass it ONLY when it's more than the
// bill and the rider couldn't give change — the difference is credited to the
// customer's wallet. Omit for exact cash / prepaid / QR-paid deliveries.
export async function partnerMarkDelivered(orderId, tendered = null) {
  const params = { p_order: orderId };
  if (tendered != null && Number(tendered) > 0) params.p_tendered = Number(tendered);
  const { error } = await must().rpc("partner_mark_delivered", params);
  if (error) throw new Error(error.message || "Couldn't mark delivered."); return { ok: true };
}
export async function partnerMarkReturned(orderId) {
  const { error } = await must().rpc("partner_mark_returned", { p_order: orderId });
  if (error) throw new Error(error.message || "Couldn't confirm the return."); return { ok: true };
}

/* ─── Admin: catalog ────────────────────────────────────────────────────── */

// Bulk tag import: apply search tags to many products at once (admin "Bulk
// tags" flow — paste an AI-generated list). Updates run in small batches.
export async function bulkUpdateProductTags(rows) {
  let done = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    const results = await Promise.all(batch.map(({ id, tags }) =>
      must().from("products").update({ tags }).eq("id", id).then((r) => !r.error)
    ));
    done += results.filter(Boolean).length;
  }
  pingLocal("products");
  return done;
}

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
      hotOverride: r.hot_override || null,
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
      hotOverride: x.hotOverride || null,
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

export async function updateCategory(id, patch) {
  const p = {};
  if (patch.name !== undefined) p.name = patch.name;
  if (patch.icon !== undefined) p.icon = patch.icon;
  if (patch.image !== undefined) p.image_url = patch.image || null;
  const { error } = await must().from("categories").update(p).eq("id", id);
  if (error) throw error;
  pingLocal("categories");
  return { ok: true };
}

// Upload a category photo to the product-images CDN bucket → returns its URL.
export async function uploadCategoryImage(file) {
  const blob = await fileToResizedBlob(file, 400);   // categories are small tiles
  const name = `cat${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await must().storage
    .from("product-images").upload(name, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { data } = must().storage.from("product-images").getPublicUrl(name);
  return data.publicUrl;
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
    // Pull the customer's searchable code (customer_code) alongside the order so
    // the admin can look them up from feedback / order lists.
    .from("orders").select("*, order_items(*), profiles!orders_user_id_fkey(customer_code)")
    // Never surface an online order to the shop until its payment is confirmed,
    // and never show abandoned attempts ('Payment failed').
    .neq("status", "Awaiting payment")
    .neq("status", "Payment failed")
    // Membership purchases and wallet top-ups aren't fulfillment orders — keep
    // them out of the ops list (they're payments, not deliveries).
    .eq("is_membership", false)
    .eq("is_topup", false)
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

// Win-back: nudge customers who haven't ordered in `days` with their favourite
// item. Admin-only. Returns how many were nudged.
export async function sendWinback(days) {
  const { data, error } = await must().rpc("send_winback", { p_days: days });
  if (error) throw error;
  pingLocal("notifications");
  return { ok: true, count: data ?? 0 };
}

// Broadcast to every customer's inbox via the admin-only RPC. Returns the
// number of customers that received it.
export async function broadcastNotification(title, body) {
  const { data, error } = await must().rpc("broadcast_notification", {
    p_title: title,
    p_body: body || "",
  });
  if (error) throw error;
  pingLocal("notifications");
  return { ok: true, count: data ?? 0 };
}

/* ─── Automated notification campaigns (message bank + schedule) ───────────── */
export async function fetchNotifTemplates() {
  const { data, error } = await must().from("notification_templates")
    .select("*").order("bucket").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((t) => ({ id: t.id, bucket: t.bucket, title: t.title, body: t.body || "", active: t.active }));
}
export async function addNotifTemplate({ bucket, title, body }) {
  const { error } = await must().from("notification_templates").insert({ bucket, title, body: body || "" });
  if (error) throw new Error(error.message || "Couldn't add.");
  return { ok: true };
}
export async function setNotifTemplateActive(id, active) {
  const { error } = await must().from("notification_templates").update({ active }).eq("id", id);
  if (error) throw error; return { ok: true };
}
export async function deleteNotifTemplate(id) {
  const { error } = await must().from("notification_templates").delete().eq("id", id);
  if (error) throw error; return { ok: true };
}
export async function importNotifTemplates(items) {
  const { data, error } = await must().rpc("import_notification_templates", { p_items: items });
  if (error) throw new Error(error.message || "Import failed.");
  return { ok: true, count: data ?? 0 };
}
export async function sendBucketNow(bucket) {
  const { data, error } = await must().rpc("send_bucket_now", { p_bucket: bucket });
  if (error) throw new Error(error.message || "Couldn't send.");
  pingLocal("notifications");
  return { ok: true, count: data ?? 0 };
}

/* ─── Festival themes (customer app skin) ───────────────────────────────────
   Admin pastes a theme JSON (Copy-AI-prompt flow); the customer app fetches the
   currently-active one and repaints itself. */
function mapTheme(t) {
  const th = t.theme || {};
  return {
    id: t.id, name: t.name, emoji: t.emoji || "",
    startsOn: t.starts_on || null, endsOn: t.ends_on || null,
    active: t.active, theme: th,
  };
}
export async function fetchThemes() {
  const { data, error } = await must().from("customer_themes")
    .select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapTheme);
}
export async function importThemes(items) {
  const { data, error } = await must().rpc("import_customer_themes", { p_items: items });
  if (error) throw new Error(error.message || "Import failed.");
  pingLocal("customer_themes");
  return { ok: true, count: data ?? 0 };
}
export async function setThemeActive(id, active) {
  const { error } = await must().from("customer_themes").update({ active }).eq("id", id);
  if (error) throw error;
  pingLocal("customer_themes");
  return { ok: true };
}
export async function updateThemeSchedule(id, { startsOn, endsOn }) {
  const { error } = await must().from("customer_themes")
    .update({ starts_on: startsOn || null, ends_on: endsOn || null }).eq("id", id);
  if (error) throw error;
  pingLocal("customer_themes");
  return { ok: true };
}
export async function deleteTheme(id) {
  const { error } = await must().from("customer_themes").delete().eq("id", id);
  if (error) throw error;
  pingLocal("customer_themes");
  return { ok: true };
}
// The one theme the customer app should paint right now (or null for default).
export async function fetchActiveTheme() {
  const { data, error } = await must().rpc("get_active_theme");
  if (error) throw error;
  return data || null;
}
export async function fetchNotifCampaigns() {
  const { data, error } = await must().from("notification_campaigns")
    .select("*").order("on_date", { nullsFirst: true }).order("hour_ist");
  if (error) throw error;
  return (data || []).map((c) => ({
    id: c.id, label: c.label, bucket: c.bucket, hour: c.hour_ist,
    dow: c.dow, onDate: c.on_date, enabled: c.enabled, lastRun: c.last_run,
    recurMd: c.recur_md,
  }));
}
export async function updateNotifCampaign(id, patch) {
  const p = {};
  if (patch.enabled !== undefined) p.enabled = patch.enabled;
  if (patch.hour !== undefined) p.hour_ist = patch.hour;
  if (patch.onDate !== undefined) p.on_date = patch.onDate || null;
  if (patch.recurMd !== undefined) p.recur_md = patch.recurMd;
  const { error } = await must().from("notification_campaigns").update(p).eq("id", id);
  if (error) throw error; return { ok: true };
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
