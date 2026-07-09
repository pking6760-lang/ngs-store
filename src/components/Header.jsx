import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function Header({
  query,
  onQueryChange,
  onCartClick,
  onLogoClick,
  onAccountClick,
}) {
  const { totalCount } = useCart();
  const { user, isLoggedIn } = useAuth();

  const firstName = isLoggedIn ? user.name.split(" ")[0] : null;

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
            {isLoggedIn && user.address
              ? user.address
              : "Home — Sector 21, New Delhi"}{" "}
            <span className="chevron">▾</span>
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

        <button
          className="account-button"
          onClick={onAccountClick}
          aria-label={isLoggedIn ? "Account" : "Log in"}
        >
          <span className="account-icon">👤</span>
          <span className="account-label">
            {isLoggedIn ? firstName : "Login"}
          </span>
        </button>

        <button className="cart-button" onClick={onCartClick}>
          <span className="cart-icon">🛒</span>
          <span className="cart-label">
            {totalCount > 0
              ? `${totalCount} item${totalCount > 1 ? "s" : ""}`
              : "My Cart"}
          </span>
        </button>
      </div>
    </header>
  );
}
