import { createContext, useContext, useEffect, useMemo, useReducer } from "react";

const CartContext = createContext(null);

const STORAGE_KEY = "ngs-cart-v1";

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// State shape: { [productId]: quantity }
function reducer(state, action) {
  switch (action.type) {
    case "ADD": {
      const qty = (state[action.id] || 0) + 1;
      return { ...state, [action.id]: qty };
    }
    case "REMOVE": {
      const current = state[action.id] || 0;
      if (current <= 1) {
        const next = { ...state };
        delete next[action.id];
        return next;
      }
      return { ...state, [action.id]: current - 1 };
    }
    case "DELETE": {
      const next = { ...state };
      delete next[action.id];
      return next;
    }
    case "CLEAR":
      return {};
    default:
      return state;
  }
}

export function CartProvider({ children }) {
  const [items, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore quota / private mode errors */
    }
  }, [items]);

  const value = useMemo(
    () => ({
      items,
      add: (id) => dispatch({ type: "ADD", id }),
      remove: (id) => dispatch({ type: "REMOVE", id }),
      deleteItem: (id) => dispatch({ type: "DELETE", id }),
      clear: () => dispatch({ type: "CLEAR" }),
      totalCount: Object.values(items).reduce((a, b) => a + b, 0),
    }),
    [items]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
