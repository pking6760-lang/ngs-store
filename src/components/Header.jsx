import { useEffect, useState } from "react";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useUserNotifications, useWallet } from "../lib/hooks.js";
import { shop } from "../data/shop.js";
import Logo from "./Logo.jsx";

// Compact wallet balance chip — sits in the location row (native chrome).
function WalletChip({ balance, onClick, className }) {
  return (
    <button className={className} onClick={onClick} aria-label="NGS Wallet">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7h16a1 1 0 0 1 1 1v3h-4a2 2 0 0 0 0 4h4" />
      </svg>
      ₹{Number(balance || 0).toFixed(2)}
    </button>
  );
}

export default function Header({
  query,
  onQueryChange,
  onCartClick,
  onLogoClick,
  onAccountClick,
  onBellClick,
  onWalletClick,
  onAddressClick,
}) {
  const { totalCount } = useCart();
  const { user, isLoggedIn } = useAuth();
  const { notes } = useUserNotifications(user?.id);
  const { balance } = useWallet(user?.id);
  const unread = notes.filter((n) => !n.read).length;

  const firstName = isLoggedIn ? user.name.split(" ")[0] : null;
  const deliverTo = isLoggedIn && user.address ? user.address : shop.area;

  // Blinkit-style header: as the page scrolls, the brand + location rows fold
  // away while the search bar stays pinned to the top. A small hysteresis gap
  // (collapse past 70px, expand under 20px) stops it flickering mid-scroll.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY || 0;
        setCompact((c) => (c ? y > 20 : y > 70));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  return (
    <header className={`header${compact ? " header--compact" : ""}`}>
      {/* Row 1 — brand + account actions */}
      <div className="header-top">
        <Logo onClick={onLogoClick} />

        <div className="header-icons">
          {isLoggedIn && (
            <button className="bell-button" onClick={onBellClick} aria-label="Notifications">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
              {unread > 0 && <span className="bell-badge">{unread}</span>}
            </button>
          )}
          <button className="account-button" onClick={onAccountClick} aria-label={isLoggedIn ? "Account" : "Log in"}>
            <span className="account-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
            </span>
            <span className="account-label">{isLoggedIn ? firstName : "Login"}</span>
          </button>
          <button className="cart-button" onClick={onCartClick}>
            <span className="cart-icon">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.5 3h2l2.2 12.4a1.6 1.6 0 0 0 1.6 1.3h9.1a1.6 1.6 0 0 0 1.6-1.3L21.5 7H6" /></svg>
            </span>
            <span className="cart-label">
              {totalCount > 0 ? `${totalCount} item${totalCount > 1 ? "s" : ""}` : "My Cart"}
            </span>
          </button>
        </div>
      </div>

      {/* Row 2 — delivery ETA + address (tap to manage) + wallet */}
      <div className="header-locrow">
        <button className="header-loc" onClick={onAddressClick}>
          <span className="hl-bolt" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>
          </span>
          <span className="hl-text">
            <span className="hl-eta">Delivery in 12 min</span>
            <span className="hl-addr">
              <span className="hl-addr-txt">{deliverTo}</span>
              <span className="hl-caret" aria-hidden="true">▾</span>
            </span>
          </span>
        </button>
        {isLoggedIn && (
          <WalletChip balance={balance} onClick={onWalletClick} className="hl-wallet" />
        )}
      </div>

      {/* Row 3 — search */}
      <div className="header-searchrow">
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
      </div>
    </header>
  );
}
