import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useUserNotifications } from "../lib/hooks.js";
import { shop } from "../data/shop.js";
import Logo from "./Logo.jsx";

export default function Header({
  query,
  onQueryChange,
  onCartClick,
  onLogoClick,
  onAccountClick,
  onBellClick,
}) {
  const { totalCount } = useCart();
  const { user, isLoggedIn } = useAuth();
  const { notes } = useUserNotifications(user?.id);
  const unread = notes.filter((n) => !n.read).length;

  const firstName = isLoggedIn ? user.name.split(" ")[0] : null;

  const deliverTo = isLoggedIn && user.address ? user.address : shop.area;

  return (
    <header className="header">
      <div className="header-inner">
        <Logo onClick={onLogoClick} />

        <div className="location">
          <div className="location-time">Delivery in 12 minutes</div>
          <div className="location-addr">
            {isLoggedIn && user.address ? user.address : shop.area}{" "}
            <span className="chevron">▾</span>
          </div>
        </div>

        <div className="search-wrap">
          <span className="search-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          </span>
          <input
            className="search-input"
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder='Search "milk", "bread", "atta"...'
          />
        </div>

        {isLoggedIn && (
          <button
            className="bell-button"
            onClick={onBellClick}
            aria-label="Notifications"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
            {unread > 0 && <span className="bell-badge">{unread}</span>}
          </button>
        )}

        <button
          className="account-button"
          onClick={onAccountClick}
          aria-label={isLoggedIn ? "Account" : "Log in"}
        >
          <span className="account-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
          </span>
          <span className="account-label">
            {isLoggedIn ? firstName : "Login"}
          </span>
        </button>

        <button className="cart-button" onClick={onCartClick}>
          <span className="cart-icon">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.5 3h2l2.2 12.4a1.6 1.6 0 0 0 1.6 1.3h9.1a1.6 1.6 0 0 0 1.6-1.3L21.5 7H6" /></svg>
          </span>
          <span className="cart-label">
            {totalCount > 0
              ? `${totalCount} item${totalCount > 1 ? "s" : ""}`
              : "My Cart"}
          </span>
        </button>
      </div>

      <button className="delivery-bar" onClick={onAccountClick}>
        <span className="db-bolt" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>
        </span>
        <span className="db-text">
          Delivery in <strong>12 minutes</strong>
          <span className="db-addr">to {deliverTo}</span>
        </span>
        <span className="db-chevron" aria-hidden="true">▾</span>
      </button>
    </header>
  );
}
