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
import { bulkUnitPrice } from "./lib/bulk.js";
import { getShopLocations } from "./lib/store.js";
import { LiveOrderPill, LiveTrackingSheet, isLiveOrder } from "./components/LiveOrderTracker.jsx";
import { shop } from "./data/shop.js";

const banners = [
  {
    id: "b1",
    title: "Free delivery over ₹199",
    subtitle: "On daily essentials, every order",
    emoji: "🚴",
    grad: "linear-gradient(135deg, #0a9155, #056b3c)",
    fg: "#ffffff",
  },
  {
    id: "b2",
    title: "Up to 40% off snacks",
    subtitle: "Stock up for the week",
    emoji: "🍿",
    grad: "linear-gradient(135deg, #f6c445, #e39a00)",
    fg: "#3a2a00",
  },
  {
    id: "b3",
    title: "Groceries in 12 minutes",
    subtitle: "Fresh stock, delivered fast",
    emoji: "🛍️",
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
  const { totalCount, items } = useCart();
  const { user, isLoggedIn, awaitingOtp } = useAuth();
  const [trackOpen, setTrackOpen] = useState(false);

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
  const products = useProducts();
  const settings = useSettings();
  const categories = useCategories();

  // The customer's current live order (if any) → floating tracker on the home page.
  const { orders: myOrders, reload: reloadOrders } = useMyOrders(user?.id);
  const activeOrder = useMemo(() => (myOrders || []).find(isLiveOrder) || null, [myOrders]);
  const shopLoc = getShopLocations(settings)[0] || null;
  // Close the tracker automatically once there's nothing live to track.
  useEffect(() => { if (!activeOrder) setTrackOpen(false); }, [activeOrder]);

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
      // Use the same bulk-tier price the cart charges, so the bar total matches.
      return sum + (p ? bulkUnitPrice(p, qty) * qty : 0);
    }, 0);
  }, [items, products]);

  function goHome() {
    setActiveCategory(null);
    setQuery("");
  }

  return (
    <div className="app">
      <Header
        query={query}
        onQueryChange={setQuery}
        onCartClick={() => setCartOpen(true)}
        onLogoClick={goHome}
        onAccountClick={handleAccountClick}
        onBellClick={handleBellClick}
      />

      {!settings.storeOpen && (
        <div className="store-closed-banner">
          🔴 Store is currently closed — you can browse, but ordering is paused.
        </div>
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
            onCategoryClick={setActiveCategory}
          />
        )}
      </main>

      {/* Live order tracker — floats just above the cart bar total */}
      {activeOrder && !cartOpen && !trackOpen && (
        <LiveOrderPill
          order={activeOrder}
          raised={totalCount > 0}
          onOpen={() => setTrackOpen(true)}
        />
      )}

      {/* Sticky bottom cart bar (mobile-friendly) */}
      {totalCount > 0 && !cartOpen && (
        <button className="cart-bar" onClick={() => setCartOpen(true)}>
          <span className="cart-bar-left">
            <span className="cart-bar-icon">🛒</span>
            {totalCount} item{totalCount > 1 ? "s" : ""}
          </span>
          <span className="cart-bar-right">
            ₹{cartValue} <span className="cart-bar-arrow">View cart →</span>
          </span>
        </button>
      )}

      <LiveTrackingSheet
        open={trackOpen}
        order={activeOrder}
        shopLoc={shopLoc}
        onClose={() => setTrackOpen(false)}
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
        <p className="footer-note">📍 {shop.address}</p>
        <p className="footer-note">Groceries &amp; daily essentials, delivered fast.</p>
      </footer>
    </div>
  );
}

function HomeView({ products, categories, offer, onCategoryClick }) {
  const byCategory = (id) => products.filter((p) => p.category === id);
  const bestPrices = products.filter((p) => p.bait).slice(0, 12);
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
            <div className="banner-emoji">{b.emoji}</div>
          </div>
        ))}
      </div>

      {bestPrices.length > 0 && (
        <section className="section best-prices">
          <h2 className="section-title">🔥 Best Prices</h2>
          <div className="product-row">
            {bestPrices.map((p) => (
              <ProductCard key={p.id} product={p} badge="Best price" />
            ))}
          </div>
        </section>
      )}

      {almostGone.length > 0 && (
        <section className="section">
          <h2 className="section-title">⏳ Almost Gone — hurry!</h2>
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
              style={{ background: c.color }}
              onClick={() => onCategoryClick(c)}
            >
              <span className="category-icon">{c.icon}</span>
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
        <h2 className="section-title">
          {category.icon} {category.name}
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
