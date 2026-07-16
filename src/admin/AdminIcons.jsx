// Clean line-icons for the admin app — one consistent set, replacing all emoji.
// Every icon inherits `currentColor`, so context colors it.
const s = {
  fill: "none", stroke: "currentColor", strokeWidth: 1.8,
  strokeLinecap: "round", strokeLinejoin: "round",
};

// Small helper so call-sites can size an icon inline: <Ic name="cash" size={18} />
export function Ic({ name, size = 20 }) {
  const p = PATHS[name];
  if (!p) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...s} aria-hidden="true">
      {p}
    </svg>
  );
}

const PATHS = {
  // Navigation (dashboard tiles)
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  orders: <><path d="M6 2h9l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M14 2v5h5" /><path d="M8 13h8M8 17h5" /></>,
  products: <><path d="M21 8 12 3 3 8l9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
  pricing: <><path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.6l8 8a2 2 0 0 1 0 2.4z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  customers: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 20c0-2.6-1-4.4-2.5-5.4" /></>,
  feedback: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />,
  partners: <><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M6 17 10 8h3l2 4h3M13 8h3" /></>,
  delivery: <><rect x="1.5" y="6" width="12" height="10" rx="1" /><path d="M13.5 9h4l3 3v4h-7" /><circle cx="6" cy="18" r="1.8" /><circle cx="16.5" cy="18" r="1.8" /></>,
  offers: <><path d="M4 5h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V6a1 1 0 0 1 1-1z" /><path d="M14 5v14" strokeDasharray="1.5 2.5" /></>,
  notify: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,

  // Stats
  revenue: <><circle cx="12" cy="12" r="9" /><path d="M9 8h6M9 11h6M13 8c1.6 0 2.5 1.2 2.5 2.6 0 1.5-1 2.4-2.7 2.4H10l4 3.5" /></>,
  profit: <><path d="M3 17l6-6 4 4 7-7" /><path d="M17 8h4v4" /></>,
  pending: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 9v5M12 17.5v.2" /></>,
  trending: <><path d="M14 3h7v7" /><path d="M21 3l-9 9-4-4-6 6" /></>,
  check: <path d="M4 12l5 5L20 6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,

  // Rewards / money
  gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13" /><path d="M12 8S10 3 7.5 4.5 9 8 12 8zM12 8s2-5 4.5-3.5S15 8 12 8z" /></>,
  coupon: <><path d="M4 6h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V7a1 1 0 0 1 1-1z" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 14h2" /></>,
  cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  payout: <><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></>,
  adjust: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></>,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  refund: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,

  // Order / detail
  crown: <path d="M3 8l3.5 3L12 5l5.5 6L21 8l-1.5 10h-15L3 8z" />,
  phone: <path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v4a2 2 0 0 1-2.2 2A16 16 0 0 1 2 6.2 2 2 0 0 1 4 4z" />,
  pin: <><path d="M12 22s7-6.3 7-12A7 7 0 0 0 5 10c0 5.7 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  print: <><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M8 17h8v4H8z" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v7M17 21h4M17 17h.01" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  bank: <><path d="M3 10 12 4l9 6" /><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18" /></>,

  // Actions
  camera: <><path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>,
  barcode: <><path d="M3 5v14M6.5 5v14M10 5v14M14 5v10M17.5 5v14M21 5v14" /></>,
  tag: <><path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.6l8 8a2 2 0 0 1 0 2.4z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  trash: <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 5v6m4-6v6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></>,
  broadcast: <><path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z" /><path d="M17 8a5 5 0 0 1 0 8M20 5a9 9 0 0 1 0 14" /></>,
  moon: <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>,
  rain: <><path d="M7 15a4.5 4.5 0 0 1 .5-9 5.5 5.5 0 0 1 10.6 1.4A3.8 3.8 0 0 1 17.5 15H7z" /><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2" /></>,
  flame: <path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-1.5.6-2.7 1.4-3.6C8.2 9 9 10 10 10c0-2 2-4 2-8z" />,
  fingerprint: <><path d="M12 11a1.5 1.5 0 0 1 1.5 1.5c0 2.5-.7 4.3-.7 4.3" /><path d="M8.7 10.3a4 4 0 0 1 7.3 2.2c0 3-.8 5-.8 5" /><path d="M5.8 12a7 7 0 0 1 13.2-3.2" /><path d="M6 15.5c.4 1.6.3 3 .3 3" /><path d="M20 13.5c.1 1.2 0 2.4-.2 3.5" /></>,
  basket: <><path d="M4 9h16l-1.4 9.3a2 2 0 0 1-2 1.7H7.4a2 2 0 0 1-2-1.7L4 9z" /><path d="M4 9l2.4-5M20 9l-2.4-5M9.5 13v3M14.5 13v3" /></>,
  scooter: <><circle cx="6" cy="17" r="2.4" /><circle cx="17" cy="17" r="2.4" /><path d="M6 17h7l3-6h3M13 11l-2-5H8M16 17h-3" /></>,
  home: <path d="M3 11l9-8 9 8M5 10v10h6v-6h2v6h6V10" />,
  signal: <><path d="M5 12.5a9 9 0 0 1 14 0M8 15.5a5 5 0 0 1 8 0" /><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none" /></>,
  box: <><path d="M21 8 12 3 3 8l9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
};
export const ICONS = PATHS;
