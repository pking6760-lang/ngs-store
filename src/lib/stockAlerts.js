import { useEffect, useReducer } from "react";
import * as api from "./api.js";

// A tiny shared store for "notify me when back in stock" state, so the many
// ProductCards on screen share one source of truth (no per-card fetch).
let _set = new Set();
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export async function loadStockAlerts() {
  try {
    const ids = await api.fetchMyStockAlerts();
    _set = new Set(ids);
    emit();
  } catch { /* guest or offline — no alerts */ }
}
export function clearStockAlertsLocal() {
  _set = new Set();
  emit();
}

export function useStockAlerts() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => listeners.delete(force);
  }, []);
  return {
    has: (id) => _set.has(id),
    async toggle(id) {
      if (_set.has(id)) {
        _set.delete(id); emit();
        await api.clearStockAlert(id).catch(() => {});
      } else {
        _set.add(id); emit();
        await api.setStockAlert(id).catch(() => {});
      }
    },
  };
}
