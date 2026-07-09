// Shared data layer for the DEMO.
// Products and orders live in localStorage so the customer site and the admin
// site stay in sync within the same browser (and across tabs). This mirrors how
// a real backend + database will work later — the only difference is that this
// version is per-browser instead of shared across all devices.

import { products as seedProducts, categories as seedCategories } from "../data/products.js";

const PRODUCTS_KEY = "ngs-products-v1";
const CATEGORIES_KEY = "ngs-categories-v1";
const ORDERS_KEY = "ngs-orders-v1";
const SETTINGS_KEY = "ngs-settings-v1";
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

/* ─── Store settings ────────────────────────────────────── */
// storeOpen: customers can only order when the store is open.
// deliveryMode: "normal" → members get free delivery; "surge" → everyone pays
// (used for rain / bad weather / peak, as decided by the store).
const DEFAULT_SETTINGS = { storeOpen: true, deliveryMode: "normal" };

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
      e.key === SETTINGS_KEY
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

