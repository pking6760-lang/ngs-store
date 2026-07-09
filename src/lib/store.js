// Shared data layer for the DEMO.
// Products and orders live in localStorage so the customer site and the admin
// site stay in sync within the same browser (and across tabs). This mirrors how
// a real backend + database will work later — the only difference is that this
// version is per-browser instead of shared across all devices.

import { products as seedProducts, categories } from "../data/products.js";

const PRODUCTS_KEY = "ngs-products-v1";
const ORDERS_KEY = "ngs-orders-v1";
const CHANGE_EVENT = "ngs-store-change";

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

// A couple of sample orders so the admin dashboard isn't empty on first open.
function seedOrders() {
  const now = Date.now();
  return [
    {
      id: "NGS1042",
      createdAt: new Date(now - 18 * 60 * 1000).toISOString(),
      customer: "Aisha Khan",
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
    if (e.key === PRODUCTS_KEY || e.key === ORDERS_KEY) callback();
  };
  window.addEventListener(CHANGE_EVENT, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

export { categories };
