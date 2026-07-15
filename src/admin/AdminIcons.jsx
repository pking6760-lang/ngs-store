// Clean line-icons for the admin navigation tiles (professional dashboard look).
// Each inherits `currentColor`, so the tile tint colors it.
const s = {
  width: 24, height: 24, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
};

export const ICONS = {
  dashboard: (
    <svg {...s}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  orders: (
    <svg {...s}><path d="M6 2h9l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M14 2v5h5" /><path d="M8 13h8M8 17h5" /></svg>
  ),
  products: (
    <svg {...s}><path d="M21 8 12 3 3 8l9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
  ),
  pricing: (
    <svg {...s}><path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.6l8 8a2 2 0 0 1 0 2.4z" /><circle cx="7.5" cy="7.5" r="1.4" /></svg>
  ),
  customers: (
    <svg {...s}><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 20c0-2.6-1-4.4-2.5-5.4" /></svg>
  ),
  feedback: (
    <svg {...s}><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9L12 3.5z" /></svg>
  ),
  partners: (
    <svg {...s}><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M6 17 10 8h3l2 4h3" /><path d="M13 8h3" /></svg>
  ),
  delivery: (
    <svg {...s}><rect x="1.5" y="6" width="12" height="10" rx="1" /><path d="M13.5 9h4l3 3v4h-7" /><circle cx="6" cy="18" r="1.8" /><circle cx="16.5" cy="18" r="1.8" /></svg>
  ),
  offers: (
    <svg {...s}><path d="M4 5h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V6a1 1 0 0 1 1-1z" /><path d="M14 5v14" strokeDasharray="1.5 2.5" /></svg>
  ),
  notify: (
    <svg {...s}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
  ),
  settings: (
    <svg {...s}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 15 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>
  ),
};
