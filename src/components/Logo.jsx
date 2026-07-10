import { shop } from "../data/shop.js";

// Clean, modern wordmark: a rounded shopping-bag badge + the store name.
export default function Logo({ onClick }) {
  return (
    <button className="logo" onClick={onClick} aria-label={shop.name}>
      <span className="logo-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
          <path
            d="M6 8h12l-1 11a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 8Z"
            fill="currentColor"
          />
          <path
            d="M9 8a3 3 0 0 1 6 0"
            stroke="#fff"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="9.5" cy="12" r="1" fill="#fff" />
          <circle cx="14.5" cy="12" r="1" fill="#fff" />
        </svg>
      </span>
      <span className="logo-text">
        <span className="logo-mark">{shop.short}</span>
        <span className="logo-sub">{shop.tagline}</span>
      </span>
    </button>
  );
}
