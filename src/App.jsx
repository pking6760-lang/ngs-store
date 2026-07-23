import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useBackGuard } from "./lib/useBackGuard.js";
import Header from "./components/Header.jsx";
import ProductCard from "./components/ProductCard.jsx";
// Heavy overlays that aren't needed for the first home paint are code-split, so
// the initial bundle is smaller and startup is faster. They're prefetched on
// idle (below) so the first tap still opens instantly.
const CartDrawer = lazy(() => import("./components/CartDrawer.jsx"));
const AccountDrawer = lazy(() => import("./components/AccountDrawer.jsx"));
const AuthModal = lazy(() => import("./components/AuthModal.jsx"));
const AddressSheet = lazy(() => import("./components/AddressSheet.jsx"));
import { useCart } from "./context/CartContext.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { useProducts, useSettings, useCategories, useMyOrders, useActiveTheme } from "./lib/hooks.js";
import { tierUnitPrice } from "./lib/bulk.js";
import { getShopLocations } from "./lib/store.js";
import { LiveOrderPill, LiveTrackingSheet, isLiveOrder } from "./components/LiveOrderTracker.jsx";
import CategoryIcon from "./components/CategoryIcon.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import PullToRefresh from "./components/PullToRefresh.jsx";
import OfflineBanner from "./components/OfflineBanner.jsx";
import { fetchBuyAgain, saveCart, applyReferral } from "./lib/api.js";
import { toast } from "./lib/toast.js";
import { initCustomerPush } from "./lib/customerPush.js";
import { initWebPush } from "./lib/webPush.js";
import CallAlertsPrompt from "./components/CallAlertsPrompt.jsx";
import PromoCarousel from "./components/PromoCarousel.jsx";
import { FestiveMasthead } from "./components/FestiveDecor.jsx";
import { applyTheme } from "./lib/theme.js";
import { loadStockAlerts, clearStockAlertsLocal } from "./lib/stockAlerts.js";
import { shop } from "./data/shop.js";
import { tr } from "./lib/i18n.jsx";

const svgProps = {
  width: 66, height: 66, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round", strokeLinejoin: "round",
};
// Home promo slides — every message maps to a REAL NGS feature (no invented
// discounts). Auto-sliding carousel; all gradients are dark so white text +
// dots read cleanly on each.
const banners = [
  {
    id: "b1",
    kicker: "12-minute delivery",
    title: "Groceries at your door, fast",
    subtitle: "Fresh daily essentials, delivered in minutes",
    icon: (<svg {...svgProps}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>),
    grad: "linear-gradient(135deg, #0a9155, #045f36)",
    fg: "#ffffff",
    action: "browse",
  },
  {
    id: "b2",
    kicker: "No delivery fee",
    title: "Free delivery over ₹199",
    subtitle: "On every daily-essentials order",
    icon: (<svg {...svgProps}><path d="M1 4h12v11H1zM13 8h4l4 4v3h-8" /><circle cx="5.5" cy="18" r="1.7" /><circle cx="16.5" cy="18" r="1.7" /></svg>),
    grad: "linear-gradient(135deg, #2f6fb0, #133a63)",
    fg: "#ffffff",
    action: "cart",
  },
  {
    id: "b3",
    kicker: "Never run out",
    title: "Daily milk subscription",
    subtitle: "Prepay once — milk at your door every morning",
    icon: (<svg {...svgProps}><path d="M8 2h8l-1 3v3l2 4v9a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-9l2-4V5z" /><path d="M9 13h6" /></svg>),
    grad: "linear-gradient(135deg, #e08a12, #a5520a)",
    fg: "#ffffff",
    action: "milk",
  },
  {
    id: "b4",
    kicker: "NGS Prime",
    title: "Save up to 15% on every item",
    subtitle: "Member prices, all day, every order",
    icon: (<svg {...svgProps}><path d="M3 7l4 4 5-7 5 7 4-4v11H3z" /><path d="M3 20h18" /></svg>),
    grad: "linear-gradient(135deg, #7c3aed, #4c1d95)",
    fg: "#ffffff",
    action: "prime",
  },
  {
    id: "b5",
    kicker: "Pay your way",
    title: "UPI, NGS Wallet or Cash",
    subtitle: "Pay online in seconds, or at your doorstep",
    icon: (<svg {...svgProps}><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /><path d="M6 15h4" /></svg>),
    grad: "linear-gradient(135deg, #0d9488, #0b5e57)",
    fg: "#ffffff",
    action: "wallet",
  },
];

export default function App() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [activeCategory, setActiveCategory] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTab, setAccountTab] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const { totalCount, items, deleteItem } = useCart();
  const { user, isLoggedIn, awaitingOtp, refreshProfile } = useAuth();
  const [trackOpen, setTrackOpen] = useState(false);
  const [trackId, setTrackId] = useState(null);

  // Back button/gesture closes the open layer instead of leaving the site.
  useBackGuard(authOpen, () => setAuthOpen(false));
  useBackGuard(cartOpen, () => setCartOpen(false));
  useBackGuard(accountOpen, () => setAccountOpen(false));
  useBackGuard(!!activeCategory, () => setActiveCategory(null));

  // If a one-time code is still pending (e.g. the mobile browser reloaded the
  // tab while the customer was in their email app), re-open the login modal so
  // they land back on the code screen instead of a blank home page.
  useEffect(() => {
    if (awaitingOtp) setAuthOpen(true);
  }, [awaitingOtp]);
  // Register this device for push once the customer is signed in (native app
  // only; no-op on the web build).
  useEffect(() => {
    if (isLoggedIn) { initCustomerPush(); initWebPush(); loadStockAlerts(); }
    else clearStockAlertsLocal();
  }, [isLoggedIn]);

  // Product cards (deep in the tree, no auth handler) ask to open login via a
  // window event — e.g. a guest tapping "Notify me" on a sold-out item.
  useEffect(() => {
    const open = () => setAuthOpen(true);
    window.addEventListener("ngs:require-login", open);
    return () => window.removeEventListener("ngs:require-login", open);
  }, []);

  // Referral link: someone arriving via …/?ref=CODE. Remember the code and
  // clean it off the URL, so it survives until they sign up.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = (params.get("ref") || "").trim().toUpperCase();
      if (!ref) return;
      localStorage.setItem("ngs_ref", ref);
      params.delete("ref");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
    } catch { /* ignore */ }
  }, []);

  // Once a referred visitor signs in, auto-apply the referral (no code to type).
  // The server only accepts it for a brand-new account, so this is safe to fire
  // for anyone — a non-new user is simply rejected and the pending ref cleared.
  useEffect(() => {
    if (!isLoggedIn) return;
    let ref = null;
    try { ref = localStorage.getItem("ngs_ref"); } catch { /* ignore */ }
    if (!ref) return;
    applyReferral(ref)
      .then((r) => toast(`🎉 ₹${r?.reward || 30} added to your wallet! Use it on your first order.`))
      .catch(() => { /* already ordered / already referred — ignore */ })
      .finally(() => { try { localStorage.removeItem("ngs_ref"); } catch { /* ignore */ } });
  }, [isLoggedIn, user?.id]);

  // Warm the code-split overlays once the browser is idle after first paint, so
  // the first tap on cart / account / login opens with no fetch delay.
  useEffect(() => {
    const warm = () => {
      import("./components/CartDrawer.jsx");
      import("./components/AuthModal.jsx");
      import("./components/AccountDrawer.jsx");
      import("./components/AddressSheet.jsx");
    };
    const ric = window.requestIdleCallback || ((fn) => setTimeout(fn, 1800));
    const cic = window.cancelIdleCallback || clearTimeout;
    const id = ric(warm);
    return () => cic(id);
  }, []);

  // "Buy again": ids of what this customer has bought before. We keep just the
  // ordered ids and resolve them against the live catalog so prices/stock in the
  // row are always current. Empty (and hidden) for guests.
  const [buyAgainIds, setBuyAgainIds] = useState([]);
  useEffect(() => {
    if (!isLoggedIn) { setBuyAgainIds([]); return; }
    let alive = true;
    fetchBuyAgain(15)
      .then((rows) => { if (alive) setBuyAgainIds(rows.map((r) => r.id)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isLoggedIn, user?.id]);

  // Mirror the cart to the server (debounced) so an abandoned cart can be nudged
  // later. Only when signed in; emptying the cart on checkout syncs {} and clears
  // the server copy so no stale nudge fires.
  useEffect(() => {
    if (!isLoggedIn) return;
    const t = setTimeout(() => { saveCart(items); }, 2500);
    return () => clearTimeout(t);
  }, [items, isLoggedIn]);

  const products = useProducts();
  const settings = useSettings();
  const categories = useCategories();

  // Festival theme (Independence Day, Diwali, Dhanteras…). Repaints the whole
  // app via CSS variables and adds a greeting + falling decorations. Managed
  // from Admin → Themes (Copy-AI-prompt → paste JSON), scheduled by date.
  const activeTheme = useActiveTheme();
  useEffect(() => { applyTheme(activeTheme); }, [activeTheme]);

  // Prune phantom cart entries: an id left in the cart whose product is no longer
  // in the catalog (deleted / deactivated / out of stock) would otherwise show as
  // "1 item · ₹0" in the bar — a ghost that can never be checked out. Once the
  // catalog is loaded, drop any cart id that doesn't resolve to a live product.
  useEffect(() => {
    if (!products || products.length === 0) return; // catalog not loaded yet
    const valid = new Set(products.map((p) => p.id));
    const ghosts = Object.keys(items).filter((id) => !valid.has(id));
    if (ghosts.length) ghosts.forEach((id) => deleteItem(id));
  }, [products, items, deleteItem]);

  // The customer's current live order (if any) → floating tracker on the home page.
  const { orders: myOrders, reload: reloadOrders } = useMyOrders(user?.id);
  const activeOrder = useMemo(() => (myOrders || []).find(isLiveOrder) || null, [myOrders]);
  const shopLoc = getShopLocations(settings)[0] || null;
  // The sheet keeps showing the order it was opened on (by id) — even after the
  // reward is scratched and it leaves the "active" set — until the user closes it.
  const trackedOrder = useMemo(
    () => (myOrders || []).find((o) => o.id === trackId) || activeOrder,
    [myOrders, trackId, activeOrder]
  );
  function openTracker(o) { setTrackId(o.id); setTrackOpen(true); }

  function handleAccountClick() {
    if (isLoggedIn) {
      setAccountTab(null); // land on the account menu, not straight into orders
      setAccountOpen(true);
    } else setAuthOpen(true);
  }

  function handleBellClick() {
    setAccountTab("inbox");
    setAccountOpen(true);
  }

  function openWallet() {
    setAccountTab("wallet");
    setAccountOpen(true);
  }

  // Tap targets for the home promo carousel — each goes somewhere real.
  function handlePromo(action) {
    switch (action) {
      case "browse": goHome(); break;                         // show the full catalog
      case "cart": setCartOpen(true); break;                  // free-delivery → checkout
      case "milk": goHome(); setQuery("milk"); break;         // find milk to subscribe
      case "prime":                                           // Prime → membership / login
        if (isLoggedIn) { setAccountTab("membership"); setAccountOpen(true); }
        else setAuthOpen(true);
        break;
      case "wallet":                                          // payments → wallet / login
        if (isLoggedIn) openWallet(); else setAuthOpen(true);
        break;
      default: break;
    }
  }

  function openAddress() {
    if (isLoggedIn) setAddressOpen(true);
    else setAuthOpen(true);
  }

  // Pull-to-refresh: nudge every live hook to re-fetch (they all reload on window
  // focus) and refresh the customer's own orders, then resolve so the spinner can
  // settle. The catalog cache updates in place, so prices/stock come back fresh.
  async function handleRefresh() {
    try {
      window.dispatchEvent(new Event("focus")); // nudges the live hooks (wallet, notifications, catalog)
      await Promise.all([
        reloadOrders?.(),
        refreshProfile?.(), // points / wallet balance / membership on the profile
      ]);
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
  }

  const searching = query.trim().length > 0;
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const cat = categories.find((c) => c.name.toLowerCase().includes(q));
    const matched = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (cat && p.category === cat.id)
    );
    return sortProducts(matched, sort);
  }, [query, products, categories, sort]);

  const cartValue = useMemo(() => {
    return Object.entries(items).reduce((sum, [id, qty]) => {
      const p = products.find((x) => x.id === id);
      // Use the same tier price the cart charges, so the bar total matches.
      return sum + (p ? tierUnitPrice(p, qty, user, settings.rewards) * qty : 0);
    }, 0);
  }, [items, products, user, settings.rewards]);

  function goHome() {
    setActiveCategory(null);
    setQuery("");
  }

  return (
    <div className="app">
      <OfflineBanner />
      <CallAlertsPrompt show={isLoggedIn} />
      <PullToRefresh
        onRefresh={handleRefresh}
        disabled={cartOpen || accountOpen || authOpen || addressOpen || trackOpen}
      />
      <Header
        query={query}
        onQueryChange={setQuery}
        onCartClick={() => setCartOpen(true)}
        onLogoClick={goHome}
        onAccountClick={handleAccountClick}
        onBellClick={handleBellClick}
        onWalletClick={openWallet}
        onAddressClick={openAddress}
      />

      {!settings.storeOpen && (
        <div className="store-closed-banner">
          <span className="status-dot closed" aria-hidden="true" />
          Store is currently closed — you can browse, but ordering is paused.
        </div>
      )}

      {!isLoggedIn && (
        <button className="guest-price-banner" onClick={() => setAuthOpen(true)}>
          <span className="gpb-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 3L12 4l4.5 6L21 7l-1.8 11H4.8L3 7z" /></svg>
          </span>
          <span className="gpb-text">
            You're seeing regular prices. <b>Log in &amp; get Prime</b> to save up to 15% on every item.
          </span>
          <span className="gpb-cta">{tr("Log in")}</span>
        </button>
      )}

      <main className="main">
        {searching ? (
          <section className="section">
            <h2 className="section-title">
              {searchResults.length > 0
                ? `Results for "${query}"`
                : `No results for "${query}"`}
            </h2>
            {searchResults.length === 0 && (
              <p className="empty-search">
                Try searching for milk, bread, chips, or eggs.
              </p>
            )}
            {searchResults.length > 1 && (
              <SortBar sort={sort} onChange={setSort} />
            )}
            <div className="product-grid">
              {searchResults.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        ) : activeCategory ? (
          <CategoryView
            category={activeCategory}
            products={products}
            sort={sort}
            onSortChange={setSort}
            onBack={() => setActiveCategory(null)}
          />
        ) : (
          <HomeView
            products={products}
            categories={categories}
            offer={settings.offerBanner}
            buyAgainIds={buyAgainIds}
            onCategoryClick={setActiveCategory}
            onPromo={handlePromo}
            theme={activeTheme}
          />
        )}
      </main>

      {/* Live order tracker — floats just above the cart bar total */}
      {activeOrder && !cartOpen && !trackOpen && (
        <LiveOrderPill
          order={activeOrder}
          raised={totalCount > 0}
          onOpen={() => openTracker(activeOrder)}
        />
      )}

      {/* Sticky bottom cart bar (mobile-friendly) */}
      {totalCount > 0 && !cartOpen && (
        <button className="cart-bar" onClick={() => setCartOpen(true)}>
          <span className="cart-bar-left">
            <span className="cart-bar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.5 3h2l2.2 12.4a1.6 1.6 0 0 0 1.6 1.3h9.1a1.6 1.6 0 0 0 1.6-1.3L21.5 7H6" /></svg>
            </span>
            {totalCount} item{totalCount > 1 ? "s" : ""}
          </span>
          <span className="cart-bar-right">
            ₹{cartValue} <span className="cart-bar-arrow">View cart →</span>
          </span>
        </button>
      )}

      <LiveTrackingSheet
        open={trackOpen && !!trackedOrder}
        order={trackedOrder}
        shopLoc={shopLoc}
        onClose={() => { setTrackOpen(false); setTrackId(null); }}
        onRefresh={reloadOrders}
      />

      <Suspense fallback={null}>
        <CartDrawer
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          onRequireLogin={() => setAuthOpen(true)}
        />

        <AccountDrawer
          open={accountOpen}
          initialTab={accountTab}
          onClose={() => setAccountOpen(false)}
          onOpenCart={() => setCartOpen(true)}
        />

        <AddressSheet open={addressOpen} onClose={() => setAddressOpen(false)} />

        <AuthModal
          open={authOpen}
          onClose={() => setAuthOpen(false)}
          onSuccess={() => setAuthOpen(false)}
          reason={
            cartOpen ? "Log in to place your order and track it." : undefined
          }
        />
      </Suspense>

      <footer className="footer">
        <p className="footer-name">{shop.name}</p>
        <p className="footer-note">{shop.address}</p>
        <p className="footer-note">Groceries &amp; daily essentials, delivered fast.</p>
      </footer>

      <InstallPrompt />
    </div>
  );
}

function HomeSkeleton() {
  // Shown only on the first-ever open (empty cache). Repeat opens hydrate from
  // the cache and skip straight to real content.
  return (
    <div className="home-skel" aria-hidden="true">
      <div className="skel-banner-row">
        <div className="skel-block skel-banner" />
        <div className="skel-block skel-banner" />
      </div>
      <div className="skel-block skel-title" />
      <div className="skel-row">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="skel-card" key={i}>
            <div className="skel-block skel-thumb" />
            <div className="skel-block skel-line" />
            <div className="skel-block skel-line short" />
          </div>
        ))}
      </div>
      <div className="skel-block skel-title" />
      <div className="skel-row">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="skel-card" key={i}>
            <div className="skel-block skel-thumb" />
            <div className="skel-block skel-line" />
            <div className="skel-block skel-line short" />
          </div>
        ))}
      </div>
    </div>
  );
}

function HomeView({ products, categories, offer, buyAgainIds = [], onCategoryClick, onPromo, theme }) {
  if (products.length === 0) return <HomeSkeleton />;
  const byCategory = (id) => products.filter((p) => p.category === id);
  // Resolve the buy-again ids against the live catalog (fresh price/stock), keep
  // the server's recency order, drop anything no longer buyable.
  const buyAgain = buyAgainIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p) => p && p.active !== false)
    .slice(0, 12);
  // Best Prices: biggest genuine deals first (highest % off MRP), then any other
  // flagged deals — so the products you've discounted lead the section.
  const bestPrices = products
    .filter((p) => p.bait)
    .map((p) => ({ p, off: p.mrp > p.price ? (p.mrp - p.price) / p.mrp : 0 }))
    .sort((a, b) => b.off - a.off)
    .slice(0, 12)
    .map((x) => x.p);
  const almostGone = products
    .filter((p) => typeof p.stock === "number" && p.stock > 0 && p.stock <= 5 && p.inStock !== false)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 12);
  return (
    <>
      <FestiveMasthead theme={theme} />

      {offer && offer.trim() && (
        <div className="offer-strip">{offer}</div>
      )}

      <PromoCarousel slides={banners} onSelect={onPromo} />

      {buyAgain.length > 0 && (
        <section className="section">
          <h2 className="section-title">{tr("Buy again")}</h2>
          <div className="product-row">
            {buyAgain.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {bestPrices.length > 0 && (
        <section className="section best-prices">
          <h2 className="section-title">Best Prices</h2>
          <div className="product-row">
            {bestPrices.map((p) => (
              <ProductCard key={p.id} product={p} badge="Best price" />
            ))}
          </div>
        </section>
      )}

      {almostGone.length > 0 && (
        <section className="section">
          <h2 className="section-title">Almost Gone</h2>
          <div className="product-row">
            {almostGone.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">Shop by category</h2>
        <div className="category-grid">
          {categories.map((c) => (
            <button
              key={c.id}
              className="category-tile"
              onClick={() => onCategoryClick(c)}
            >
              <span className="category-thumb">
                {c.image
                  ? <img className="category-img" src={c.image} alt="" loading="lazy" />
                  : <CategoryIcon id={c.id} name={c.name} size={46} />}
              </span>
              <span className="category-name">{c.name}</span>
            </button>
          ))}
        </div>
      </section>

      {categories
        .filter((c) => byCategory(c.id).length > 0)
        .map((c) => (
          <section className="section" key={c.id}>
            <div className="section-head">
              <h2 className="section-title">{c.name}</h2>
              <button className="see-all" onClick={() => onCategoryClick(c)}>
                see all →
              </button>
            </div>
            <div className="product-row">
              {byCategory(c.id)
                .slice(0, 6)
                .map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
            </div>
          </section>
        ))}
    </>
  );
}

function CategoryView({ category, products, sort, onSortChange, onBack }) {
  const list = sortProducts(
    products.filter((p) => p.category === category.id),
    sort
  );
  return (
    <section className="section">
      <div className="category-header">
        <button className="back-btn" onClick={onBack}>
          ← Back
        </button>
        <h2 className="section-title cat-title">
          <CategoryIcon id={category.id} name={category.name} size={20} /> {category.name}
        </h2>
        <span className="count-pill">{list.length} items</span>
      </div>
      {list.length > 1 && <SortBar sort={sort} onChange={onSortChange} />}
      <div className="product-grid">
        {list.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

const SORTS = [
  { id: "relevance", label: "Popular" },
  { id: "price-asc", label: "Price ↑" },
  { id: "price-desc", label: "Price ↓" },
  { id: "discount", label: "Discount" },
];

function SortBar({ sort, onChange }) {
  return (
    <div className="sort-bar">
      <span className="sort-label">Sort</span>
      {SORTS.map((s) => (
        <button
          key={s.id}
          className={`sort-chip ${sort === s.id ? "active" : ""}`}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// Sort a product list. In-stock items always come before sold-out ones.
function sortProducts(list, sort) {
  const disc = (p) => (p.mrp > p.price ? (p.mrp - p.price) / p.mrp : 0);
  const arr = [...list];
  const cmp = {
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    discount: (a, b) => disc(b) - disc(a),
  }[sort];
  if (cmp) arr.sort(cmp);
  // Keep out-of-stock items at the end regardless of sort.
  arr.sort((a, b) => (a.inStock === false ? 1 : 0) - (b.inStock === false ? 1 : 0));
  return arr;
}
