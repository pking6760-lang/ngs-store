import { shop } from "../data/shop.js";

// Clean, modern wordmark: a rounded shopping-bag badge + the store name.
export default function Logo({ onClick }) {
  return (
    <button className="logo" onClick={onClick} aria-label={shop.name}>
      <span className="logo-badge" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="26" height="26" fill="none">
          <path
            d="M19 45.5 V21 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 .8.4 L37.8 37 V21 a1 1 0 0 1 1-1 h3.2 a1 1 0 0 1 1 1 v23.5 a1 1 0 0 1-1 1 h-4 a1 1 0 0 1-.8-.4 L26.2 29 v16.5 a1 1 0 0 1-1 1 H20 a1 1 0 0 1-1-1 z"
            fill="#fff"
          />
          <path
            d="M43.5 19.2 c1.2 -4.4 5 -6.7 9.3 -6.4 c.4 4.3 -2.2 8.4 -6.6 9.1 c-1 .16 -2 .12 -2.9 -.1 z"
            fill="#bdf0d0"
          />
        </svg>
      </span>
      <span className="logo-text">
        <span className="logo-mark">{shop.short}</span>
        <span className="logo-sub">{shop.tagline}</span>
      </span>
    </button>
  );
}
