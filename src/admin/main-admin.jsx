import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./AdminApp.jsx";
import AppSplash from "../components/AppSplash.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import { CallProvider } from "../components/CallProvider.jsx";
import "../styles.css";
import "./admin.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <AppSplash variant="admin" tagline="admin" />
      <CallProvider app="admin">
        <AdminApp />
      </CallProvider>
    </ErrorBoundary>
  </StrictMode>
);
