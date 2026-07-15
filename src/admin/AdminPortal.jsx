import { createPortal } from "react-dom";

// Render a full-screen admin modal/overlay at <body> so its position:fixed
// anchors to the viewport — not to the scrolling section whose fade-up
// transform would otherwise trap it and make it open scrolled off-screen
// (forcing the user to scroll up to find it). The wrapper carries the admin's
// indigo theme tokens, since portaled content lives outside .adm and would
// otherwise fall back to the shared customer green/olive palette.
export default function AdminPortal({ children }) {
  return createPortal(
    <div className="adm-modal-portal">{children}</div>,
    document.body
  );
}
