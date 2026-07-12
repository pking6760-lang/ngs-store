import { useCart } from "../context/CartContext.jsx";
import ProductThumb from "./ProductThumb.jsx";

// Show scarcity urgency when stock is running low.
const LOW_STOCK = 5;

export default function ProductCard({ product, badge }) {
  const { items, add, remove } = useCart();
  const qty = items[product.id] || 0;
  const discount = Math.round(((product.mrp - product.price) / product.mrp) * 100);
  const savings = product.mrp - product.price;
  const outOfStock = product.inStock === false;
  const lowStock =
    typeof product.stock === "number" && product.stock > 0 && product.stock <= LOW_STOCK;

  return (
    <div className={`product-card ${outOfStock ? "sold-out" : ""}`}>
      <div className="product-image">
        <ProductThumb
          image={product.image}
          name={product.name}
          category={product.category}
          fill
          radius={14}
        />
        {badge && !outOfStock && <span className="product-best">{badge}</span>}
        {discount > 0 && !outOfStock && (
          <span className="product-badge">
            <span className="product-badge-inner">
              <b>{discount}%</b> OFF
            </span>
          </span>
        )}
        <span className="product-delivery">⚡ 12 min</span>
        {lowStock && !outOfStock && (
          <span className="product-lowstock">
            {product.hot ? "🔥 Selling fast · " : "⚡ "}Only {product.stock} left
          </span>
        )}
        {outOfStock && <span className="sold-out-tag">Out of stock</span>}
      </div>
      <div className="product-name">{product.name}</div>
      <div className="product-unit">
        {product.unit}
        {product.hot && !lowStock && !outOfStock && (
          <span className="product-hot">🔥 Bestseller</span>
        )}
      </div>
      <div className="product-footer">
        <div className="product-price">
          <div className="price-line">
            <span className="price-now">₹{product.price}</span>
            {product.mrp > product.price && (
              <span className="price-mrp">₹{product.mrp}</span>
            )}
          </div>
          {savings > 0 && !outOfStock && (
            <span className="save-pill">Save ₹{savings}</span>
          )}
        </div>
        {outOfStock ? (
          <button className="add-btn out" disabled>
            Sold out
          </button>
        ) : qty === 0 ? (
          <button className="add-btn" onClick={() => add(product.id)}>
            ADD
          </button>
        ) : (
          <div className="qty-stepper">
            <button onClick={() => remove(product.id)} aria-label="Remove one">
              −
            </button>
            <span>{qty}</span>
            <button onClick={() => add(product.id)} aria-label="Add one">
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
