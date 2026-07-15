// NGS brand marks for the internal apps. Same "N" monogram as the customer
// logo (family look), but each surface gets its own identity + palette:
//   • Admin   — professional indigo + a dashboard-grid cue
//   • Partner — dark charcoal + a red delivery-pin cue
const N_PATH =
  "M19 45.5 V21 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 .8.4 L37.8 37 V21 a1 1 0 0 1 1-1 h3.2 a1 1 0 0 1 1 1 v23.5 a1 1 0 0 1-1 1 h-4 a1 1 0 0 1-.8-.4 L26.2 29 v16.5 a1 1 0 0 1-1 1 H20 a1 1 0 0 1-1-1 z";

export function AdminMark({ size = 30 }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size} height={size}>
        <defs>
          <linearGradient id="bmAdmin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4f6bff" />
            <stop offset="1" stopColor="#25307a" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="url(#bmAdmin)" />
        <path d={N_PATH} fill="#fff" />
        <g fill="#a9baff">
          <rect x="43.5" y="13" width="4.6" height="4.6" rx="1.3" />
          <rect x="49.6" y="13" width="4.6" height="4.6" rx="1.3" />
          <rect x="43.5" y="19.1" width="4.6" height="4.6" rx="1.3" />
          <rect x="49.6" y="19.1" width="4.6" height="4.6" rx="1.3" />
        </g>
      </svg>
    </span>
  );
}

export function PartnerMark({ size = 30 }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size} height={size}>
        <defs>
          <linearGradient id="bmPartner" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3a3f4b" />
            <stop offset="1" stopColor="#111318" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="url(#bmPartner)" />
        <path d={N_PATH} fill="#fff" />
        <path
          d="M49 11 c3.6 0 6.5 2.9 6.5 6.5 c0 4.4 -6.5 10 -6.5 10 s-6.5 -5.6 -6.5 -10 c0 -3.6 2.9 -6.5 6.5 -6.5 z"
          fill="#ff5a4d"
        />
        <circle cx="49" cy="17.4" r="2.3" fill="#15171c" />
      </svg>
    </span>
  );
}
