import { useCart } from "../context/CartContext.jsx";

export default function Header({ query, onQueryChange, onCartClick, onLogoClick }) {
  const { totalCount } = useCart();

  return (
    <header className="header">
      <div className="header-inner">
        <button className="logo" onClick={onLogoClick} aria-label="Home">
          <span className="logo-mark">NGS</span>
          <span className="logo-sub">store</span>
        </button>

        <div className="location">
          <div className="location-time">Delivery in 12 minutes</div>
          <div className="location-addr">
            Home — Sector 21, New Delhi <span className="chevron">▾</span>
          </div>
        </div>

        <div className="search-wrap">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder='Search "milk", "bread", "chips"...'
          />
        </div>

        <button className="cart-button" onClick={onCartClick}>
          <span className="cart-icon">🛒</span>
          <span className="cart-label">
            {totalCount > 0 ? `${totalCount} item${totalCount > 1 ? "s" : ""}` : "My Cart"}
          </span>
        </button>
      </div>
    </header>
  );
}
