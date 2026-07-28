import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useUserNotifications, useWallet } from "../lib/hooks.js";
import { useT } from "../lib/i18n.jsx";
import { shop } from "../data/shop.js";
import Logo from "./Logo.jsx";

// EN ⇄ हिंदी switch. One tap flips the whole app's language (persisted).
function LangToggle() {
  const { lang, setLang } = useT();
  return (
    <button className="lang-toggle" onClick={() => setLang(lang === "hi" ? "en" : "hi")}
      aria-label="Change language">
      <span className={lang === "en" ? "on" : ""}>EN</span>
      <span className={lang === "hi" ? "on" : ""}>हिं</span>
    </button>
  );
}

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
  onSearchFocus,
  onSearchSubmit,
  searchSlot,
}) {
  const { totalCount } = useCart();
  const { user, isLoggedIn } = useAuth();
  const { notes } = useUserNotifications(user?.id);
  const { balance } = useWallet(user?.id);
  const { t } = useT();
  const unread = notes.filter((n) => !n.read).length;

  const firstName = isLoggedIn ? user.name.split(" ")[0] : null;
  const deliverTo = isLoggedIn && user.address ? user.address : shop.area;

  // Blinkit-style header: the brand + location rows sit in a normal (non-sticky)
  // block that scrolls away, while the search bar below is `position: sticky` and
  // pins to the top of the viewport. Because nothing changes height on scroll,
  // there's no layout feedback loop — the search just glides up and stays put.
  return (
    <>
      <header className="header">
      {/* Row 1 — brand + account actions */}
      <div className="header-top">
        <Logo onClick={onLogoClick} />

        {/* Cart and Account now live in the bottom nav — the header keeps only
            the notifications bell so they're never shown twice. For a logged-out
            visitor a small Login button stands in for the bell. */}
        <div className="header-icons">
          {isLoggedIn ? (
            <button className="bell-button" onClick={onBellClick} aria-label="Notifications">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
              {unread > 0 && <span className="bell-badge">{unread}</span>}
            </button>
          ) : (
            <button className="header-login" onClick={onAccountClick}>{t("Login")}</button>
          )}
        </div>
      </div>

      {/* Row 2 — delivery ETA + address (tap to manage) + wallet */}
      <div className="header-locrow">
        <button className="header-loc" onClick={onAddressClick}>
          <span className="hl-bolt" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>
          </span>
          <span className="hl-text">
            <span className="hl-eta">{t("Delivery in")} 12 {t("min")}</span>
            <span className="hl-addr">
              <span className="hl-addr-txt">{deliverTo}</span>
              <span className="hl-caret" aria-hidden="true">▾</span>
            </span>
          </span>
        </button>
        <LangToggle />
        {isLoggedIn && (
          <WalletChip balance={balance} onClick={onWalletClick} className="hl-wallet" />
        )}
      </div>
      </header>

      {/* Search — sticks to the top of the viewport as the page scrolls */}
      <div className="searchbar">
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
              onFocus={onSearchFocus}
              onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); onSearchSubmit?.(query); }
                                  if (e.key === "Escape") onQueryChange(""); }}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              placeholder={t('Search "milk", "bread", "atta"...')}
            />
            {query && (
              <button type="button" className="search-clear" aria-label="Clear search"
                onClick={() => onQueryChange("")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
          {searchSlot}
        </div>
      </div>
    </>
  );
}
