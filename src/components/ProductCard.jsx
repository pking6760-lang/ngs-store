import { useCart } from "../context/CartContext.jsx";

export default function ProductCard({ product }) {
  const { items, add, remove } = useCart();
  const qty = items[product.id] || 0;
  const discount = Math.round(((product.mrp - product.price) / product.mrp) * 100);

  return (
    <div className="product-card">
      {discount > 0 && <span className="product-badge">{discount}% OFF</span>}
      <div className="product-image">
        <span className="product-emoji">{product.icon}</span>
      </div>
      <div className="product-delivery">⚡ 12 MINS</div>
      <div className="product-name">{product.name}</div>
      <div className="product-unit">{product.unit}</div>
      <div className="product-footer">
        <div className="product-price">
          <span className="price-now">₹{product.price}</span>
          {product.mrp > product.price && (
            <span className="price-mrp">₹{product.mrp}</span>
          )}
        </div>
        {qty === 0 ? (
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
