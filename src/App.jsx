import { useEffect, useMemo, useState } from "react";
import { useBackGuard } from "./lib/useBackGuard.js";
import Header from "./components/Header.jsx";
import ProductCard from "./components/ProductCard.jsx";
import CartDrawer from "./components/CartDrawer.jsx";
import AccountDrawer from "./components/AccountDrawer.jsx";
import AuthModal from "./components/AuthModal.jsx";
import { useCart } from "./context/CartContext.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { useProducts, useSettings, useCategories, useMyOrders } from "./lib/hooks.js";
import { tierUnitPrice } from "./lib/bulk.js";
import { getShopLocations } from "./lib/store.js";
import { LiveOrderPill, LiveTrackingSheet, isLiveOrder } from "./components/LiveOrderTracker.jsx";
import CategoryIcon from "./components/CategoryIcon.jsx";
import AddressSheet from "./components/AddressSheet.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import PullToRefresh from "./components/PullToRefresh.jsx";
import { fetchBuyAgain, saveCart } from "./lib/api.js";
import { initCustomerPush } from "./lib/customerPush.js";
import { initWebPush } from "./lib/webPush.js";
import CallAlertsPrompt from "./components/CallAlertsPrompt.jsx";
import { shop } from "./data/shop.js";

const svgProps = {
  width: 66, height: 66, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round", strokeLinejoin: "round",
};
const banners = [
  {
    id: "b1",
    title: "Free delivery over ₹199",
    subtitle: "On daily essentials, every order",
    icon: (
      <svg {...svgProps}><path d="M1 4h12v11H1zM13 8h4l4 4v3h-8" /><circle cx="5.5" cy="18" r="1.7" /><circle cx="16.5" cy="18" r="1.7" /></svg>
    ),
    grad: "linear-gradient(135deg, #0a9155, #056b3c)",
    fg: "#ffffff",
  },
  {
    id: "b2",
    title: "Up to 40% off snacks",
    subtitle: "Stock up for the week",
    icon: (
      <svg {...svgProps}><path d="M20.6 13.6 13 21.2a2 2 0 0 1-2.8 0L3 14V4a1 1 0 0 1 1-1h7l8.6 8.6a2 2 0 0 1 0 2z" /><circle cx="7.5" cy="7.5" r="1.4" /></svg>
    ),
    grad: "linear-gradient(135deg, #f6c445, #e39a00)",
    fg: "#3a2a00",
  },
  {
    id: "b3",
    title: "Groceries in 12 minutes",
    subtitle: "Fresh stock, delivered fast",
    icon: (
      <svg {...svgProps}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>
    ),
    grad: "linear-gradient(135deg, #2f6fb0, #16406e)",
    fg: "#ffffff",
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
    if (isLoggedIn) { initCustomerPush(); initWebPush(); }
  }, [isLoggedIn]);

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
          <span className="gpb-cta">Log in</span>
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

function HomeView({ products, categories, offer, buyAgainIds = [], onCategoryClick }) {
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
      {offer && offer.trim() && (
        <div className="offer-strip">{offer}</div>
      )}

      <div className="banner-row">
        {banners.map((b) => (
          <div
            className="banner"
            key={b.id}
            style={{ background: b.grad, color: b.fg }}
          >
            <div className="banner-text">
              <h3>{b.title}</h3>
              <p>{b.subtitle}</p>
            </div>
            <div className="banner-icon">{b.icon}</div>
          </div>
        ))}
      </div>

      {buyAgain.length > 0 && (
        <section className="section">
          <h2 className="section-title">Buy again</h2>
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
