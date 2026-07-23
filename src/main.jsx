import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AppSplash from "./components/AppSplash.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { CartProvider } from "./context/CartContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { CallProvider } from "./components/CallProvider.jsx";
import { LangProvider } from "./lib/i18n.jsx";
import UpdateGate from "./components/UpdateGate.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <LangProvider>
        <AppSplash variant="customer" tagline="Nisha General Store" />
        <UpdateGate app="customer">
          <AuthProvider>
            <CartProvider>
              <CallProvider>
                <App />
              </CallProvider>
            </CartProvider>
          </AuthProvider>
        </UpdateGate>
      </LangProvider>
    </ErrorBoundary>
  </StrictMode>
);

// Register the service worker so the store is installable ("Add to Home
// Screen"). Web only — the packaged Capacitor apps use their own entry points.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* non-fatal */ });
  });
}
