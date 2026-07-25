import { StrictMode } from "react";
import { lockZoomInStandalone } from "../lib/noZoom.js";
import { createRoot } from "react-dom/client";
import PartnerApp from "./PartnerApp.jsx";
import AppSplash from "../components/AppSplash.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import { CallProvider } from "../components/CallProvider.jsx";
import UpdateGate from "../components/UpdateGate.jsx";
import "../styles.css";
import "./admin.css";
import "./partner.css";

lockZoomInStandalone();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <AppSplash variant="partner" tagline="partner" />
      <UpdateGate app="partner">
        <CallProvider app="partner">
          <PartnerApp />
        </CallProvider>
      </UpdateGate>
    </ErrorBoundary>
  </StrictMode>
);
