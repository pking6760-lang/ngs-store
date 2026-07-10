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
function useBackend(fetcher, tables, initial) {
  const [data, setData] = useState(initial);
  useEffect(() => {
    let alive = true;
    const load = () => fetcher().then((d) => alive && setData(d)).catch(() => {});
    load();
    const unsubs = tables.map((t) => api.subscribeTable(t, load));
    return () => { alive = false; unsubs.forEach((u) => u && u()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

export function useProducts() {
  if (BACKEND) return useBackend(api.fetchProducts, ["products"], []);
  const [products, setProducts] = useState(getProducts);
  useEffect(() => subscribe(() => setProducts(getProducts())), []);
  return products;
}

export function useCategories() {
  if (BACKEND) return useBackend(api.fetchCategories, ["categories"], []);
  const [categories, setCategories] = useState(getCategories);
  useEffect(() => subscribe(() => setCategories(getCategories())), []);
  return categories;
}

export function useOrders() {
  if (BACKEND) return useBackend(api.fetchAllOrders, ["orders", "order_items"], []);
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
