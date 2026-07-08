import { useMemo, useState } from "react";
import Header from "./components/Header.jsx";
import ProductCard from "./components/ProductCard.jsx";
import CartDrawer from "./components/CartDrawer.jsx";
import { useCart } from "./context/CartContext.jsx";
import {
  categories,
  products,
  getProductsByCategory,
  searchProducts,
} from "./data/products.js";

const banners = [
  { id: "b1", title: "Fresh fruits & veggies", subtitle: "Farm-fresh, every day", emoji: "🥦", bg: "#e7f7e9" },
  { id: "b2", title: "Up to 40% off snacks", subtitle: "Munchies for movie night", emoji: "🍿", bg: "#fce8ec" },
  { id: "b3", title: "Cold drinks & juices", subtitle: "Chilled and ready", emoji: "🥤", bg: "#e6f0fb" },
];

export default function App() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const { totalCount, items } = useCart();

  const searching = query.trim().length > 0;
  const searchResults = useMemo(() => searchProducts(query), [query]);

  const cartValue = useMemo(() => {
    return Object.entries(items).reduce((sum, [id, qty]) => {
      const p = products.find((x) => x.id === id);
      return sum + (p ? p.price * qty : 0);
    }, 0);
  }, [items]);

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
      />

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
            <div className="product-grid">
              {searchResults.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        ) : activeCategory ? (
          <CategoryView
            category={activeCategory}
            onBack={() => setActiveCategory(null)}
          />
        ) : (
          <HomeView onCategoryClick={setActiveCategory} />
        )}
      </main>

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

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />

      <footer className="footer">
        <p>NGS Store — groceries delivered in minutes.</p>
        <p className="footer-note">Demo app. Prices are illustrative.</p>
      </footer>
    </div>
  );
}

function HomeView({ onCategoryClick }) {
  return (
    <>
      <div className="banner-row">
        {banners.map((b) => (
          <div className="banner" key={b.id} style={{ background: b.bg }}>
            <div className="banner-text">
              <h3>{b.title}</h3>
              <p>{b.subtitle}</p>
            </div>
            <div className="banner-emoji">{b.emoji}</div>
          </div>
        ))}
      </div>

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

      {categories.map((c) => (
        <section className="section" key={c.id}>
          <div className="section-head">
            <h2 className="section-title">{c.name}</h2>
            <button className="see-all" onClick={() => onCategoryClick(c)}>
              see all →
            </button>
          </div>
          <div className="product-row">
            {getProductsByCategory(c.id)
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

function CategoryView({ category, onBack }) {
  const list = getProductsByCategory(category.id);
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
      <div className="product-grid">
        {list.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
