import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./AdminApp.jsx";
import AppSplash from "../components/AppSplash.jsx";
import "../styles.css";
import "./admin.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppSplash variant="admin" tagline="admin" />
    <AdminApp />
  </StrictMode>
);
