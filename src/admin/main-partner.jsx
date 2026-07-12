import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PartnerApp from "./PartnerApp.jsx";
import "../styles.css";
import "./admin.css";
import "./partner.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <PartnerApp />
  </StrictMode>
);
