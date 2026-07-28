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

// NGS Wallet chip — the premium piece of chrome in the header. A deep-green
// "card" with a struck-gold coin bearing the rupee mark, then the balance. Reads
// as store money you'd want to spend, not a grey utility button.
function WalletChip({ balance, onClick }) {
  return (
    <button className="wallet-chip" onClick={onClick} aria-label="NGS Wallet">
      <span className="wallet-coin" aria-hidden="true">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="url(#wc-g)" />
          <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,.55)" strokeWidth="1" />
          <path d="M9 7.5h6M9 10.5h6M14.5 7.5c0 3.2-4.5 3-4.5 3l4 3.5" stroke="#6b4a06" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <defs>
            <linearGradient id="wc-g" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FDE8A6" /><stop offset=".55" stopColor="#EBAE36" /><stop offset="1" stopColor="#C6871A" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      <span className="wallet-amt">{Number(balance || 0).toFixed(2)}</span>
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

        {/* Cart and Profile live in the bottom nav. The header keeps the
            notifications bell (logged in) and the NGS Wallet — no login/logout
            button here; a guest logs in from the Profile tab or by tapping the
            wallet. */}
        <div className="header-icons">
          {isLoggedIn && (
            <button className="bell-button" onClick={onBellClick} aria-label="Notifications">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
              {unread > 0 && <span className="bell-badge">{unread}</span>}
            </button>
          )}
          <WalletChip balance={balance} onClick={isLoggedIn ? onWalletClick : onAccountClick} />
        </div>
      </div>

      {/* Row 2 — delivery ETA + address (tap to manage) */}
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
