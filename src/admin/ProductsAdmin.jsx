import { useMemo, useState } from "react";
import { useProducts } from "../lib/hooks.js";
import { categories, upsertProduct, deleteProduct } from "../lib/store.js";

const EMPTY = {
  id: "",
  name: "",
  category: categories[0].id,
  unit: "",
  price: "",
  mrp: "",
  icon: "📦",
};

export default function ProductsAdmin() {
  const products = useProducts();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [editing, setEditing] = useState(null); // product object or null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchCat = catFilter === "all" || p.category === catFilter;
      const matchText = !q || p.name.toLowerCase().includes(q);
      return matchCat && matchText;
    });
  }, [products, search, catFilter]);

  const catName = (id) => categories.find((c) => c.id === id)?.name || id;

  return (
    <>
      <div className="toolbar">
        <input
          className="admin-search"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="admin-select"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="primary-btn"
          onClick={() => setEditing({ ...EMPTY })}
        >
          + Add product
        </button>
      </div>

      <section className="panel no-pad">
        <table className="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Price</th>
              <th>MRP</th>
              <th className="ta-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="cell-product">
                    <span className="cell-emoji">{p.icon}</span>
                    <span className="cell-name">{p.name}</span>
                  </div>
                </td>
                <td>{catName(p.category)}</td>
                <td>{p.unit}</td>
                <td className="mono">₹{p.price}</td>
                <td className="mono muted">₹{p.mrp}</td>
                <td className="ta-right">
                  <button className="icon-btn" onClick={() => setEditing(p)}>
                    ✏️ Edit
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => {
                      if (confirm(`Delete "${p.name}"?`)) deleteProduct(p.id);
                    }}
                  >
                    🗑️ Delete
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  No products match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {editing && (
        <ProductModal
          product={editing}
          onClose={() => setEditing(null)}
          onSave={(prod) => {
            upsertProduct(prod);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ProductModal({ product, onClose, onSave }) {
  const isNew = !product.id;
  const [form, setForm] = useState(product);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function submit(e) {
    e.preventDefault();
    const price = Number(form.price) || 0;
    const mrp = Number(form.mrp) || price;
    onSave({
      ...form,
      id: form.id || "p" + Date.now(),
      price,
      mrp: Math.max(mrp, price),
      icon: form.icon || "📦",
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <h3>{isNew ? "Add product" : "Edit product"}</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <label className="field wide">
            <span>Product name</span>
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="e.g. Fresh Banana"
              required
            />
          </label>

          <label className="field">
            <span>Category</span>
            <select
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Unit / size</span>
            <input
              value={form.unit}
              onChange={(e) => update("unit", e.target.value)}
              placeholder="e.g. 500 g"
              required
            />
          </label>

          <label className="field">
            <span>Selling price (₹)</span>
            <input
              type="number"
              min="0"
              value={form.price}
              onChange={(e) => update("price", e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>MRP (₹)</span>
            <input
              type="number"
              min="0"
              value={form.mrp}
              onChange={(e) => update("mrp", e.target.value)}
            />
          </label>

          <label className="field">
            <span>Icon (emoji)</span>
            <input
              value={form.icon}
              onChange={(e) => update("icon", e.target.value)}
              placeholder="🍎"
              maxLength={4}
            />
          </label>
        </div>

        <div className="modal-foot">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-btn">
            {isNew ? "Add product" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
