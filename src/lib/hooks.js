import { useEffect, useState } from "react";
import { getProducts, getOrders, getSettings, subscribe } from "./store.js";

// Re-renders whenever products change (in this tab or another).
export function useProducts() {
  const [products, setProducts] = useState(getProducts);
  useEffect(() => subscribe(() => setProducts(getProducts())), []);
  return products;
}

// Re-renders whenever orders change.
export function useOrders() {
  const [orders, setOrders] = useState(getOrders);
  useEffect(() => subscribe(() => setOrders(getOrders())), []);
  return orders;
}

// Re-renders whenever store settings (open/close, delivery mode) change.
export function useSettings() {
  const [settings, setSettings] = useState(getSettings);
  useEffect(() => subscribe(() => setSettings(getSettings())), []);
  return settings;
}
