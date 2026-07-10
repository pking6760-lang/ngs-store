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

// Re-renders whenever products change (in this tab or another).
export function useProducts() {
  const [products, setProducts] = useState(getProducts);
  useEffect(() => subscribe(() => setProducts(getProducts())), []);
  return products;
}

// Re-renders whenever categories change (add / remove).
export function useCategories() {
  const [categories, setCategories] = useState(getCategories);
  useEffect(() => subscribe(() => setCategories(getCategories())), []);
  return categories;
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

// Re-renders whenever coupons change.
export function useCoupons() {
  const [coupons, setCoupons] = useState(getCoupons);
  useEffect(() => subscribe(() => setCoupons(getCoupons())), []);
  return coupons;
}

// Re-renders whenever the customer list changes (admin side).
export function useCustomers() {
  const [users, setUsers] = useState(getUsers);
  useEffect(() => subscribe(() => setUsers(getUsers())), []);
  return users;
}

// Re-renders whenever a given customer's notifications change.
export function useUserNotifications(userId) {
  const [notes, setNotes] = useState(() => getUserNotifications(userId));
  useEffect(
    () => subscribe(() => setNotes(getUserNotifications(userId))),
    [userId]
  );
  return notes;
}
