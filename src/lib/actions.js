// actions.js — write operations that work in BOTH modes.
// When a Supabase backend is configured, writes go to the server (protected by
// the admin role); otherwise they use the localStorage demo layer. Read screens
// refresh automatically via the realtime subscriptions in hooks.js.
import * as api from "./api.js";
import * as store from "./store.js";

const BACKEND = api.isBackendConfigured;
const CATEGORY_COLORS = [
  "#e7f7e9", "#fdf4e3", "#fce8ec", "#e6f0fb",
  "#f3ecfb", "#fdeae6", "#e7f6f6", "#eef2e6",
];

/* ─── Products ──────────────────────────────────────────── */
function productToDb(p) {
  return { id: p.id, name: p.name, unit: p.unit || "", price: Number(p.price) || 0,
    mrp: p.mrp != null ? Number(p.mrp) : null, icon: p.icon || "",
    barcode: p.barcode ? String(p.barcode).replace(/\D/g, "") || null : null,
    image_url: p.image || null, category: p.category,
    stock: p.stock === "" || p.stock == null ? null : Number(p.stock),
    free_delivery_exempt: p.freeDeliveryExempt === true,
    active: p.active !== false };
}
export async function upsertProduct(p) {
  // Cost (buying price) is stored separately in the admin-only table.
  if (BACKEND) return api.upsertProduct(productToDb(p), p.cost);
  return store.upsertProduct(p);
}
export async function deleteProduct(id) {
  if (BACKEND) return api.deleteProduct(id);
  return store.deleteProduct(id);
}

/* ─── Categories ────────────────────────────────────────── */
export async function addCategory({ name, icon }, existing = []) {
  const clean = (name || "").trim();
  if (!clean) return { ok: false, error: "Please enter a category name." };
  if (!BACKEND) return store.addCategory({ name, icon });
  if (existing.some((c) => c.name.toLowerCase() === clean.toLowerCase()))
    return { ok: false, error: "That category already exists." };
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const category = { id: (base || "cat") + "-" + Math.random().toString(36).slice(2, 6),
    name: clean, icon: (icon || "").trim() || "🏷️",
    color: CATEGORY_COLORS[existing.length % CATEGORY_COLORS.length], sort: existing.length };
  try { await api.addCategory(category); return { ok: true, category }; }
  catch (e) { return { ok: false, error: e.message }; }
}
// Reassign products out of the category, then delete it (keeps the FK valid).
export async function deleteCategory(id, existing = []) {
  if (!BACKEND) return store.deleteCategory(id);
  if (existing.length <= 1) return { ok: false, error: "Keep at least one category." };
  const fallback = existing.find((c) => c.id !== id);
  try {
    const prods = await api.fetchProducts();
    for (const p of prods.filter((p) => p.category === id))
      await api.upsertProduct(productToDb({ ...p, category: fallback.id }));
    await api.deleteCategory(id);
    return { ok: true, movedTo: fallback };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ─── Coupons ───────────────────────────────────────────── */
export async function upsertCoupon(coupon) {
  const code = (coupon.code || "").trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a coupon code." };
  if ((Number(coupon.value) || 0) <= 0) return { ok: false, error: "Enter a discount value." };
  if (!BACKEND) return store.upsertCoupon(coupon);
  try { await api.upsertCoupon(coupon); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}
export async function deleteCoupon(code) {
  if (BACKEND) return api.deleteCoupon(code);
  return store.deleteCoupon(code);
}

/* ─── Settings ──────────────────────────────────────────── */
export async function updateSettings(patch) {
  if (BACKEND) return api.updateSettings(patch);
  return store.updateSettings(patch);
}

/* ─── Orders ────────────────────────────────────────────── */
// Admin order actions take the order object so we can use its db id on the
// backend and its display id in the demo.
export async function updateOrderStatus(order, status) {
  if (BACKEND) return api.updateOrderStatus(order.dbId || order.id, status);
  return store.updateOrderStatus(order.id ?? order, status);
}
// The rider collected CASH at the door — mark the order paid (no Razorpay id,
// so it reads as "paid cash"). A QR payment sets razorpay_payment_id instead.
export async function markCashReceived(order) {
  if (BACKEND) return api.updateOrderById(order.dbId || order.id, { payment_status: "paid" });
  return store.updateOrderStatus(order.id ?? order, order.status);
}
// Staff (NGS Partner app) move an order forward through the flow.
export async function advanceStatus(order, status) {
  if (BACKEND) return api.advanceOrderStatus(order.dbId || order.id, status);
  return store.updateOrderStatus(order.id ?? order, status);
}
export async function acceptOrder(order) {
  if (BACKEND) return api.acceptOrder(order.dbId || order.id);
  return store.acceptOrder(order.id ?? order);
}
export async function rejectOrder(order) {
  if (BACKEND) return api.rejectOrder(order.dbId || order.id);
  return store.rejectOrder(order.id ?? order);
}

/* ─── Customers / notifications ─────────────────────────── */
export async function sendNotification({ userId, title, body }) {
  if (!title?.trim()) return { ok: false, error: "Missing details." };
  if (BACKEND) {
    try { await api.sendNotification({ userId, title: title.trim(), body }); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  return store.sendNotification({ userId, title, body });
}
