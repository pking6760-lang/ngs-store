import { useEffect, useState } from "react";
import {
  getProducts,
  getCategories,
  getOrders,
  getSettings,
  getCoupons,
  getUsers,
  getUserNotifications,
  subscribe,
} from "./store.js";
import * as api from "./api.js";

// When a Supabase backend is configured we read from it (live, cross-device);
// otherwise we fall back to the localStorage demo layer. The public shape of
// each hook is identical in both modes, so screens don't change. BACKEND is a
// module-level constant, so the branch below is stable for the app's lifetime
// (hook order never changes between renders).
const BACKEND = api.isBackendConfigured;

// Generic backend hook: fetch once, then re-fetch on any realtime change to the
// given tables. `fetcher` returns app-shaped data; `initial` shows instantly.
function useBackend(fetcher, tables, initial, pollMs = 30000) {
  const [data, setData] = useState(initial);
  useEffect(() => {
    let alive = true;
    const load = () => fetcher().then((d) => alive && setData(d)).catch(() => {});
    load();
    // Live updates: same-device bus + cross-device Realtime.
    const unsubs = tables.map((t) => api.subscribeTable(t, load));
    // Safety net so data never gets stuck stale even if Realtime is off:
    // refetch when the tab is refocused/made visible, and on a light timer.
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", load);
    const poll = setInterval(load, pollMs);
    return () => {
      alive = false;
      unsubs.forEach((u) => u && u());
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", load);
      clearInterval(poll);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

export function useProducts() {
  if (BACKEND) return useBackend(api.fetchProducts, ["products"], []);
  const [products, setProducts] = useState(getProducts);
  useEffect(() => subscribe(() => setProducts(getProducts())), []);
  return products;
}

// Admin-only variant: same products, but with each item's private buying price
// (cost) merged in. Never use this in the customer app — it reads the admin
// product_costs table.
export function useAdminProducts() {
  if (BACKEND) return useBackend(api.fetchAdminProducts, ["products"], []);
  const [products, setProducts] = useState(getProducts);
  useEffect(() => subscribe(() => setProducts(getProducts())), []);
  return products;
}

// Customer NGS wallet: { balance, ledger }. Keyed on the signed-in user so it
// RESETS on login/logout (never shows a previous account's balance), and only
// ever holds the caller's own rows (also enforced by RLS).
export function useWallet(userId) {
  const [w, setW] = useState({ balance: 0, ledger: [] });
  useEffect(() => {
    if (!BACKEND || !userId) { setW({ balance: 0, ledger: [] }); return; }
    let alive = true;
    const load = () =>
      api.fetchWalletLedger()
        .then((ledger) => alive && setW({ balance: ledger.reduce((s, e) => s + e.amount, 0), ledger }))
        .catch(() => {});
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    const u1 = api.subscribeTable("customer_wallet", load);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", load);
    const poll = setInterval(load, 30000);
    return () => {
      alive = false; u1 && u1();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", load);
      clearInterval(poll);
    };
  }, [userId]);
  return w;
}

export function useCategories() {
  if (BACKEND) return useBackend(api.fetchCategories, ["categories"], []);
  const [categories, setCategories] = useState(getCategories);
  useEffect(() => subscribe(() => setCategories(getCategories())), []);
  return categories;
}

export function useOrders() {
  // Admin watches for incoming orders — poll fast (5s) as a fallback so a new
  // order shows quickly even before Realtime pushes it.
  if (BACKEND) return useBackend(api.fetchAllOrders, ["orders", "order_items"], [], 5000);
  const [orders, setOrders] = useState(getOrders);
  useEffect(() => subscribe(() => setOrders(getOrders())), []);
  return orders;
}

// Only the signed-in customer's own orders (admin uses useOrders()).
export function useMyOrders(userId) {
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    if (!BACKEND) {
      const load = () => setOrders(getOrders().filter((o) => o.userId === userId));
      load();
      return subscribe(load);
    }
    if (!userId) { setOrders([]); return; }
    let alive = true;
    const load = () => api.fetchMyOrders().then((d) => alive && setOrders(d)).catch(() => {});
    load();
    const u1 = api.subscribeTable("orders", load);
    return () => { alive = false; u1 && u1(); };
  }, [userId]);
  return orders;
}

export function useSettings() {
  // Start from the demo defaults so the UI has sensible values before the first
  // fetch resolves.
  if (BACKEND) return useBackend(api.fetchSettings, ["settings"], getSettings());
  const [settings, setSettings] = useState(getSettings);
  useEffect(() => subscribe(() => setSettings(getSettings())), []);
  return settings;
}

export function useCoupons() {
  if (BACKEND) return useBackend(api.fetchCoupons, ["coupons"], []);
  const [coupons, setCoupons] = useState(getCoupons);
  useEffect(() => subscribe(() => setCoupons(getCoupons())), []);
  return coupons;
}

export function useCustomers() {
  if (BACKEND) return useBackend(api.fetchCustomers, ["profiles"], []);
  const [users, setUsers] = useState(getUsers);
  useEffect(() => subscribe(() => setUsers(getUsers())), []);
  return users;
}

export function usePartners() {
  return useBackend(api.fetchPartners, ["partners"], []);
}

export function useUserNotifications(userId) {
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    if (!BACKEND) {
      const load = () => setNotes(getUserNotifications(userId));
      load();
      return subscribe(load);
    }
    if (!userId) { setNotes([]); return; }
    let alive = true;
    const load = () => api.fetchMyNotifications().then((d) => alive && setNotes(d)).catch(() => {});
    load();
    const u1 = api.subscribeTable("notifications", load);
    return () => { alive = false; u1 && u1(); };
  }, [userId]);
  return notes;
}
