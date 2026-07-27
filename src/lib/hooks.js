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

// Stale-while-revalidate cache: the public catalog (products, categories,
// settings) is stashed in localStorage so a repeat open paints the last-known
// data INSTANTLY, then revalidates in the background — instead of a blank grid
// while the first network fetch runs. Quota failures (large base64 images) fail
// soft: we just drop the cache and keep working from the network.
function readCache(key, fallback) {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function writeCache(key, data) {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(data)); }
  catch { try { localStorage.removeItem(key); } catch { /* ignore */ } }
}

// Generic backend hook: fetch once, then re-fetch on any realtime change to the
// given tables. `fetcher` returns app-shaped data; `initial` shows instantly.
// `cacheKey` (optional) turns on the stale-while-revalidate localStorage cache.
// Data restored from localStorage is marked __stale until the first live fetch
// lands. Screens that would otherwise flash yesterday's state (e.g. "store
// closed" first thing in the morning) can wait for the confirmed value.
function markStale(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...v, __stale: true } : v;
}
// Collapse a burst of change events into ONE fetch. Realtime delivers a row at
// a time, so a single statement that touches many rows used to fire a full
// re-fetch per row — the repricer alone did that 118 times in a row, to every
// open app at once. Nothing is lost by waiting a moment: the fetch that runs
// still returns the final state.
function coalesce(fn, ms = 400) {
  let t = null;
  const run = () => { t = null; fn(); };
  const wrapped = () => { if (t) clearTimeout(t); t = setTimeout(run, ms); };
  wrapped.cancel = () => { if (t) clearTimeout(t); t = null; };
  return wrapped;
}

// `source` says how this data learns it has changed:
//   ["orders"]                 row-level realtime — for tables a screen truly
//                              needs live, and only a handful of staff devices
//   { catalog: ["products_v"] } the shop-wide change signal: one small event for
//                              the whole shop instead of one per row per user.
//                              The right default for anything everyone shares.
//   { local: ["profiles"] }    same-device refresh only, plus the poll. For
//                              tables deliberately left unpublished.
function useBackend(fetcher, source, initial, pollMs = 30000, cacheKey = null) {
  const [data, setData] = useState(() => markStale(readCache(cacheKey, initial)));
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetcher().then((d) => { if (alive) { setData(d); writeCache(cacheKey, d); } }).catch(() => {});
    const reload = coalesce(load);
    load();
    // Live updates: same-device bus + cross-device Realtime.
    const unsubs = Array.isArray(source)
      ? source.map((t) => api.subscribeTable(t, reload))
      : source.catalog
        ? [api.subscribeCatalog(source.catalog, reload)]
        : source.local.map((t) => api.subscribeLocal(t, reload));
    // Safety net so data never gets stuck stale even if Realtime is off:
    // refetch when the tab is refocused/made visible, and on a light timer.
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", reload);
    const poll = setInterval(load, pollMs);
    return () => {
      alive = false;
      reload.cancel();
      unsubs.forEach((u) => u && u());
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", reload);
      clearInterval(poll);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

export function useProducts() {
  if (BACKEND) return useBackend(api.fetchProducts, { catalog: ["products_v"] }, [], 600000, "ngs_cache_products");
  const [products, setProducts] = useState(getProducts);
  useEffect(() => subscribe(() => setProducts(getProducts())), []);
  return products;
}

// Admin-only variant: same products, but with each item's private buying price
// (cost) merged in. Never use this in the customer app — it reads the admin
// product_costs table.
export function useAdminProducts() {
  if (BACKEND) return useBackend(api.fetchAdminProducts, { catalog: ["products_v"] }, [], 120000);
  const [products, setProducts] = useState(getProducts);
  useEffect(() => subscribe(() => setProducts(getProducts())), []);
  return products;
}

// Fetch a per-signed-in-user resource with loading/error/reload, keyed on the
// user id so it RESETS on login/logout, live-updating via realtime + poll +
// focus. On error it surfaces the message (no silent false-empty) and offers a
// retry. `map` transforms the fetched rows into the shape a screen renders.
// `table` may be "orders" or ["orders", "user_id"] — the second form subscribes
// with a server-side filter on that column, so this customer is only told about
// their own rows. Unfiltered, every customer is pushed every other customer's
// order and re-fetches on each one.
function useUserFetch(fetcher, table, userId, empty, map = (x) => x) {
  const [data, setData] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    if (!userId) { setData(empty); setLoading(false); setError(""); return; }
    let alive = true;
    setLoading(true);
    const load = () =>
      fetcher()
        .then((d) => { if (alive) { setData(map(d)); setError(""); setLoading(false); } })
        .catch((e) => { if (alive) { setError(e?.message || "Couldn't load. Please retry."); setLoading(false); } });
    const refresh = coalesce(load);
    load();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const [tbl, col] = Array.isArray(table) ? table : [table, null];
    const u1 = api.subscribeTable(tbl, refresh, col ? `${col}=eq.${userId}` : undefined);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    const poll = setInterval(load, 60000);
    return () => {
      alive = false; u1 && u1(); refresh.cancel();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      clearInterval(poll);
    };
  }, [userId, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, loading, error, reload };
}

// Customer NGS wallet: { balance, ledger, loading, error, reload }. Keyed on the
// signed-in user so it never shows a previous account's balance.
export function useWallet(userId) {
  const empty = { balance: 0, ledger: [] };
  if (!BACKEND) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [w] = useState(empty);
    return { ...w, loading: false, error: "", reload: () => {} };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { data, loading, error, reload } = useUserFetch(
    api.fetchWalletLedger, ["customer_wallet", "user_id"], userId, empty
  );
  return { ...data, loading, error, reload };
}

export function useCategories() {
  if (BACKEND) return useBackend(api.fetchCategories, { catalog: ["categories_v"] }, [], 600000, "ngs_cache_categories");
  const [categories, setCategories] = useState(getCategories);
  useEffect(() => subscribe(() => setCategories(getCategories())), []);
  return categories;
}

export function useOrders() {
  // The shop floor: a new order has to appear immediately, so this keeps its
  // row-level subscription on orders and order_items. Only staff run this
  // screen, so the fan-out is a handful of devices, not the whole customer base.
  // The 5-second poll behind it is now 20: Realtime is the live path, and the
  // poll is only the safety net for when it drops. Each run is a windowed list
  // (see fetchAllOrders), not the whole history.
  if (BACKEND) return useBackend(api.fetchAllOrders, ["orders", "order_items"], [], 20000);
  const [orders, setOrders] = useState(getOrders);
  useEffect(() => subscribe(() => setOrders(getOrders())), []);
  return orders;
}

// Only the signed-in customer's own orders (admin uses useOrders()).
// { orders, loading, error, reload } — RLS-scoped to the signed-in user.
export function useMyOrders(userId) {
  if (!BACKEND) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [orders, setOrders] = useState([]);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const load = () => setOrders(getOrders().filter((o) => o.userId === userId));
      load();
      return subscribe(load);
    }, [userId]);
    return { orders, loading: false, error: "", reload: () => {} };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { data, loading, error, reload } = useUserFetch(api.fetchMyOrders, ["orders", "user_id"], userId, []);
  return { orders: data, loading, error, reload };
}

export function useSettings() {
  // Start from the demo defaults so the UI has sensible values before the first
  // fetch resolves.
  if (BACKEND) return useBackend(api.fetchSettings, { catalog: ["settings_v"] }, getSettings(), 300000, "ngs_cache_settings");
  const [settings, setSettings] = useState(getSettings);
  useEffect(() => subscribe(() => setSettings(getSettings())), []);
  return settings;
}

// Festival theme the customer app should paint right now (null = default look).
// Cached so a repeat open paints the festive skin instantly, revalidated live.
export function useActiveTheme() {
  if (BACKEND) return useBackend(api.fetchActiveTheme, { catalog: ["themes_v"] }, null, 600000, "ngs_cache_theme");
  return null;
}

// Admin-side list of all saved themes.
export function useThemes() {
  if (BACKEND) return useBackend(api.fetchThemes, { catalog: ["themes_v"] }, [], 120000);
  return [];
}

export function useCoupons() {
  if (BACKEND) return useBackend(api.fetchCoupons, { catalog: ["coupons_v"] }, [], 300000);
  const [coupons, setCoupons] = useState(getCoupons);
  useEffect(() => subscribe(() => setCoupons(getCoupons())), []);
  return coupons;
}

export function useCustomers() {
  if (BACKEND) return useBackend(api.fetchCustomers, { local: ["profiles"] }, [], 60000);
  const [users, setUsers] = useState(getUsers);
  useEffect(() => subscribe(() => setUsers(getUsers())), []);
  return users;
}

export function usePartners() {
  return useBackend(api.fetchPartners, ["partners"], []);
}

// { notes, loading, error, reload }.
export function useUserNotifications(userId) {
  if (!BACKEND) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [notes, setNotes] = useState([]);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const load = () => setNotes(getUserNotifications(userId));
      load();
      return subscribe(load);
    }, [userId]);
    return { notes, loading: false, error: "", reload: () => {} };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { data, loading, error, reload } = useUserFetch(api.fetchMyNotifications, ["notifications", "user_id"], userId, []);
  return { notes: data, loading, error, reload };
}
