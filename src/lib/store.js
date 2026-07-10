// Shared data layer for the DEMO.
// Products and orders live in localStorage so the customer site and the admin
// site stay in sync within the same browser (and across tabs). This mirrors how
// a real backend + database will work later — the only difference is that this
// version is per-browser instead of shared across all devices.

import { products as seedProducts, categories as seedCategories } from "../data/products.js";

// v3 catalog: fruits removed too.
const PRODUCTS_KEY = "ngs-products-v3";
const CATEGORIES_KEY = "ngs-categories-v3";
const ORDERS_KEY = "ngs-orders-v1";
const SETTINGS_KEY = "ngs-settings-v1";
const COUPONS_KEY = "ngs-coupons-v1";
// Shared with the customer app's AuthContext (same localStorage key).
const USERS_KEY = "ngs-users-v1";
const NOTIFICATIONS_KEY = "ngs-notifications-v1";
const CHANGE_EVENT = "ngs-store-change";

// Soft background colours cycled through for new categories.
const CATEGORY_COLORS = [
  "#e7f7e9", "#fdf4e3", "#fce8ec", "#e6f0fb",
  "#f3ecfb", "#fdeae6", "#e7f6f6", "#eef2e6",
];

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private-mode errors */
  }
  // Notify listeners in THIS tab (the native "storage" event only fires in
  // OTHER tabs). Together they keep every open tab in sync.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
}

/* ─── Products ──────────────────────────────────────────── */
export function getProducts() {
  const existing = read(PRODUCTS_KEY, null);
  if (!existing) {
    write(PRODUCTS_KEY, seedProducts);
    return seedProducts;
  }
  return existing;
}

export function saveProducts(list) {
  write(PRODUCTS_KEY, list);
}

export function upsertProduct(product) {
  const list = getProducts();
  const idx = list.findIndex((p) => p.id === product.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = product;
    saveProducts(next);
  } else {
    saveProducts([product, ...list]);
  }
}

export function deleteProduct(id) {
  saveProducts(getProducts().filter((p) => p.id !== id));
}

/* ─── Categories ────────────────────────────────────────── */
export function getCategories() {
  const existing = read(CATEGORIES_KEY, null);
  if (!existing) {
    write(CATEGORIES_KEY, seedCategories);
    return seedCategories;
  }
  return existing;
}

export function saveCategories(list) {
  write(CATEGORIES_KEY, list);
}

// Add a category. Returns { ok, category } or { ok:false, error }.
export function addCategory({ name, icon }) {
  const clean = (name || "").trim();
  if (!clean) return { ok: false, error: "Please enter a category name." };
  const list = getCategories();
  if (list.some((c) => c.name.toLowerCase() === clean.toLowerCase()))
    return { ok: false, error: "That category already exists." };
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const category = {
    id: (base || "cat") + "-" + Math.random().toString(36).slice(2, 6),
    name: clean,
    icon: (icon || "").trim() || "🏷️",
    color: CATEGORY_COLORS[list.length % CATEGORY_COLORS.length],
  };
  saveCategories([...list, category]);
  return { ok: true, category };
}

// Remove a category. Any products in it move to another category so nothing is
// orphaned. You can't delete the last remaining category.
export function deleteCategory(id) {
  const list = getCategories();
  if (list.length <= 1)
    return { ok: false, error: "Keep at least one category." };
  const fallback = list.find((c) => c.id !== id);
  const moved = getProducts().map((p) =>
    p.category === id ? { ...p, category: fallback.id } : p
  );
  saveProducts(moved);
  saveCategories(list.filter((c) => c.id !== id));
  return { ok: true, movedTo: fallback };
}

/* ─── Coupons / offers ──────────────────────────────────── */
// A coupon:
//   { code, type: "percent"|"flat", value, minOrder,
//     category: ""|<categoryId>, active }
// `category` optional — when set, the coupon only counts items from that
// category (a "this type of product" condition); `minOrder` is the "amount has
// to be this" condition.
function seedCoupons() {
  return [
    { code: "NISHA10", type: "percent", value: 10, minOrder: 199, category: "", active: true },
    { code: "FLAT30", type: "flat", value: 30, minOrder: 149, category: "", active: true },
    { code: "SNACK15", type: "percent", value: 15, minOrder: 99, category: "snacks", active: true },
  ];
}

export function getCoupons() {
  const existing = read(COUPONS_KEY, null);
  if (!existing) {
    const seeded = seedCoupons();
    write(COUPONS_KEY, seeded);
    return seeded;
  }
  return existing;
}

export function saveCoupons(list) {
  write(COUPONS_KEY, list);
}

export function upsertCoupon(coupon) {
  const code = coupon.code.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a coupon code." };
  const value = Number(coupon.value) || 0;
  if (value <= 0) return { ok: false, error: "Enter a discount value." };
  const next = {
    code,
    type: coupon.type === "flat" ? "flat" : "percent",
    value,
    minOrder: Number(coupon.minOrder) || 0,
    category: (coupon.category || "").trim(),
    active: coupon.active !== false,
  };
  const list = getCoupons().filter((c) => c.code !== code);
  saveCoupons([next, ...list]);
  return { ok: true };
}

export function deleteCoupon(code) {
  saveCoupons(getCoupons().filter((c) => c.code !== code));
}

// Validate a code against the cart. `ctx` can be a plain number (item total)
// or { itemTotal, catTotals, catName } where catTotals maps categoryId ->
// subtotal and catName(id) returns a readable name. Returns { ok, discount } or
// { ok:false, error }.
export function applyCoupon(code, ctx) {
  const itemTotal = typeof ctx === "number" ? ctx : ctx?.itemTotal || 0;
  const catTotals = (typeof ctx === "object" && ctx?.catTotals) || {};
  const catName =
    (typeof ctx === "object" && ctx?.catName) || ((id) => id);

  const clean = (code || "").trim().toUpperCase();
  if (!clean) return { ok: false, error: "Enter a coupon code." };
  const coupon = getCoupons().find((c) => c.code === clean);
  if (!coupon || !coupon.active)
    return { ok: false, error: "This coupon isn't valid." };

  const scoped = !!coupon.category;
  const eligible = scoped ? catTotals[coupon.category] || 0 : itemTotal;

  if (scoped && eligible <= 0)
    return { ok: false, error: `Add ${catName(coupon.category)} items to use ${clean}.` };
  if (eligible < (coupon.minOrder || 0))
    return {
      ok: false,
      error: `Add ₹${coupon.minOrder - eligible} more${
        scoped ? ` in ${catName(coupon.category)}` : ""
      } to use ${clean}.`,
    };

  const raw =
    coupon.type === "percent"
      ? Math.floor((eligible * coupon.value) / 100)
      : coupon.value;
  return {
    ok: true,
    code: clean,
    discount: Math.min(raw, itemTotal),
    category: coupon.category || null,
  };
}

/* ─── Customers ─────────────────────────────────────────── */
// A couple of demo customers so the admin Customers tab isn't empty before a
// real shopper signs up. (Shares the key the customer app writes to.)
function seedUsers() {
  const now = Date.now();
  return [
    {
      id: "u9990000001",
      name: "Aisha Khan",
      phone: "9990000001",
      email: "aisha@example.com",
      address: "B-12, Sultanpur, New Delhi 110030",
      points: 120,
      member: true,
      memberSince: new Date(now - 30 * 864e5).toISOString(),
      createdAt: new Date(now - 40 * 864e5).toISOString(),
    },
    {
      id: "u9990000002",
      name: "Rahul Verma",
      phone: "9990000002",
      email: "",
      address: "House 5, Sultanpur, New Delhi 110030",
      points: 40,
      member: false,
      memberSince: null,
      createdAt: new Date(now - 12 * 864e5).toISOString(),
    },
  ];
}

// Returns customers (without passwords). Seeds demo customers once if empty.
export function getUsers() {
  const existing = read(USERS_KEY, null);
  if (!existing) {
    const seeded = seedUsers();
    write(USERS_KEY, seeded);
    return seeded;
  }
  return existing.map(({ password, ...u }) => u);
}

/* ─── Notifications (admin → customer) ──────────────────── */
export function getNotifications() {
  return read(NOTIFICATIONS_KEY, []) || [];
}

export function getUserNotifications(userId) {
  if (!userId) return [];
  return getNotifications().filter((n) => n.userId === userId);
}

export function sendNotification({ userId, title, body }) {
  if (!userId || !title?.trim()) return { ok: false, error: "Missing details." };
  const note = {
    id: "n" + Math.random().toString(36).slice(2, 9),
    userId,
    title: title.trim(),
    body: (body || "").trim(),
    createdAt: new Date().toISOString(),
    read: false,
  };
  write(NOTIFICATIONS_KEY, [note, ...getNotifications()]);
  return { ok: true };
}

// Mark a customer's notifications as read (called when they open their inbox).
export function markUserNotificationsRead(userId) {
  if (!userId) return;
  const all = getNotifications();
  if (!all.some((n) => n.userId === userId && !n.read)) return;
  write(
    NOTIFICATIONS_KEY,
    all.map((n) => (n.userId === userId ? { ...n, read: true } : n))
  );
}

/* ─── Store settings ────────────────────────────────────── */
// storeOpen: customers can only order when the store is open.
// deliveryMode: "normal" → members get free delivery; "surge" → everyone pays
// (used for rain / bad weather / peak, as decided by the store).
const DEFAULT_SETTINGS = {
  storeOpen: true,
  deliveryMode: "normal",
  // A promotional line shown across the top of the customer home page.
  offerBanner: "🎉 Welcome to Nisha General Store — daily essentials delivered fast!",
  // Reward points rule (editable from admin → Offers → Reward points).
  rewards: { earnPoints: 50, earnPer: 399, redeemPer: 10 },
};

export function getSettings() {
  const existing = read(SETTINGS_KEY, null);
  if (!existing) {
    write(SETTINGS_KEY, DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
  return { ...DEFAULT_SETTINGS, ...existing };
}

export function updateSettings(patch) {
  write(SETTINGS_KEY, { ...getSettings(), ...patch });
}

/* ─── Orders ────────────────────────────────────────────── */
export const ORDER_STATUSES = [
  "Placed",
  "Packed",
  "Out for delivery",
  "Delivered",
];

export function getOrders() {
  const existing = read(ORDERS_KEY, null);
  if (!existing) {
    const seeded = seedOrders();
    write(ORDERS_KEY, seeded);
    return seeded;
  }
  return existing;
}

export function saveOrder(order) {
  write(ORDERS_KEY, [order, ...getOrders()]);
}

export function updateOrderStatus(id, status) {
  write(
    ORDERS_KEY,
    getOrders().map((o) => (o.id === id ? { ...o, status } : o))
  );
}

// Admin accepts a freshly-placed order (from the incoming-order screen).
export function acceptOrder(id) {
  write(
    ORDERS_KEY,
    getOrders().map((o) => (o.id === id ? { ...o, accepted: true } : o))
  );
}

// Admin rejects a freshly-placed order — it's marked cancelled.
export function rejectOrder(id) {
  write(
    ORDERS_KEY,
    getOrders().map((o) =>
      o.id === id ? { ...o, accepted: false, status: "Cancelled" } : o
    )
  );
}

// A couple of sample orders so the admin dashboard isn't empty on first open.
function seedOrders() {
  const now = Date.now();
  return [
    {
      id: "NGS1042",
      createdAt: new Date(now - 18 * 60 * 1000).toISOString(),
      customer: "Aisha Khan",
      userId: "u9990000001",
      userPhone: "9990000001",
      accepted: true,
      member: true,
      priority: true,
      status: "Out for delivery",
      items: [
        { id: "p9", name: "Amul Toned Milk", icon: "🥛", qty: 2, price: 27 },
        { id: "p10", name: "Brown Bread", icon: "🍞", qty: 1, price: 45 },
        { id: "p11", name: "Farm Eggs", icon: "🥚", qty: 1, price: 66 },
      ],
      itemTotal: 165,
      deliveryFee: 25,
      handling: 5,
      total: 195,
      count: 4,
    },
    {
      id: "NGS1041",
      createdAt: new Date(now - 55 * 60 * 1000).toISOString(),
      customer: "Rahul Verma",
      userId: "u9990000002",
      userPhone: "9990000002",
      accepted: true,
      member: false,
      priority: false,
      status: "Delivered",
      items: [
        { id: "p21", name: "Coca-Cola", icon: "🥤", qty: 2, price: 40 },
        { id: "p15", name: "Lay's Classic Salted", icon: "🥔", qty: 3, price: 20 },
      ],
      itemTotal: 140,
      deliveryFee: 25,
      handling: 5,
      total: 170,
      count: 5,
    },
  ];
}

/* ─── Subscriptions ─────────────────────────────────────── */
export function subscribe(callback) {
  const onLocal = () => callback();
  const onStorage = (e) => {
    if (
      e.key === PRODUCTS_KEY ||
      e.key === CATEGORIES_KEY ||
      e.key === ORDERS_KEY ||
      e.key === SETTINGS_KEY ||
      e.key === COUPONS_KEY ||
      e.key === USERS_KEY ||
      e.key === NOTIFICATIONS_KEY
    )
      callback();
  };
  window.addEventListener(CHANGE_EVENT, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

