import { Component } from "react";

// Catches any render-time error so a single bad component can never white-screen
// the whole app. Shows a friendly recovery screen instead.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    // Keep a breadcrumb in the console for debugging; never crash the page.
    console.error("App error boundary caught:", error, info);
  }
  render() {
    if (this.state.failed) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 14, padding: 24,
          textAlign: "center", fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif",
          color: "#16202c", background: "#f6f8f7",
        }}>
          <div style={{
            width: 68, height: 68, borderRadius: 20, background: "#eaf6ee", color: "#178a3a",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17.5v.5" />
            </svg>
          </div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Something went wrong</h2>
          <p style={{ margin: 0, color: "#5b6470", maxWidth: 320, lineHeight: 1.5 }}>
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8, background: "#0a9155", color: "#fff", border: "none",
              borderRadius: 10, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
