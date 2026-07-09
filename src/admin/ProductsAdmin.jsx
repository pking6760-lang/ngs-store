import { useMemo, useState } from "react";
import { useProducts, useCategories } from "../lib/hooks.js";
import {
  upsertProduct,
  deleteProduct,
  addCategory,
  deleteCategory,
} from "../lib/store.js";
import { fileToResizedDataUrl } from "../lib/image.js";
import ProductThumb from "../components/ProductThumb.jsx";

const EMPTY = {
  id: "",
  name: "",
  category: "",
  unit: "",
  price: "",
  mrp: "",
  image: "",
};

export default function ProductsAdmin() {
  const products = useProducts();
  const categories = useCategories();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [editing, setEditing] = useState(null); // product object or null
  const [managingCats, setManagingCats] = useState(false);

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
        <button className="ghost-btn" onClick={() => setManagingCats(true)}>
          🏷️ Categories
        </button>
        <button
          className="primary-btn"
          onClick={() =>
            setEditing({ ...EMPTY, category: categories[0]?.id || "" })
          }
        >
          + Add product
        </button>
      </div>

      <p className="products-hint">Tap a product to edit it.</p>

      <section className="panel no-pad">
        <table className="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Price</th>
              <th>MRP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                className="row-clickable"
                onClick={() => setEditing(p)}
              >
                <td>
                  <div className="cell-product">
                    <ProductThumb
                      image={p.image}
                      name={p.name}
                      category={p.category}
                      size={40}
                      radius={8}
                    />
                    <span className="cell-name">{p.name}</span>
                  </div>
                </td>
                <td>{catName(p.category)}</td>
                <td>{p.unit}</td>
                <td className="mono">₹{p.price}</td>
                <td className="mono muted">₹{p.mrp}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-cell">
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
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={(prod) => {
            upsertProduct(prod);
            setEditing(null);
          }}
          onDelete={(id) => {
            deleteProduct(id);
            setEditing(null);
          }}
        />
      )}

      {managingCats && (
        <CategoryManager
          categories={categories}
          products={products}
          onClose={() => setManagingCats(false)}
        />
      )}
    </>
  );
}

function CategoryManager({ categories, products, onClose }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🏷️");
  const [error, setError] = useState("");

  function add(e) {
    e.preventDefault();
    const res = addCategory({ name, icon });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName("");
    setIcon("🏷️");
    setError("");
  }

  function remove(cat) {
    const count = products.filter((p) => p.category === cat.id).length;
    const msg =
      count > 0
        ? `Delete "${cat.name}"? Its ${count} product${
            count > 1 ? "s" : ""
          } will move to another category.`
        : `Delete "${cat.name}"?`;
    if (!confirm(msg)) return;
    const res = deleteCategory(cat.id);
    if (!res.ok) setError(res.error);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Categories</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cat-manager">
          <form className="cat-add" onSubmit={add}>
            <input
              className="cat-icon-input"
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 2))}
              aria-label="Category icon"
              maxLength={2}
            />
            <input
              className="cat-name-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              placeholder="New category name"
            />
            <button type="submit" className="primary-btn">
              Add
            </button>
          </form>
          {error && <div className="auth-error">{error}</div>}

          <ul className="cat-list">
            {categories.map((c) => {
              const count = products.filter((p) => p.category === c.id).length;
              return (
                <li className="cat-list-item" key={c.id}>
                  <span
                    className="cat-list-swatch"
                    style={{ background: c.color }}
                  >
                    {c.icon}
                  </span>
                  <span className="cat-list-name">{c.name}</span>
                  <span className="cat-list-count">{count} items</span>
                  <button
                    type="button"
                    className="cat-list-del"
                    onClick={() => remove(c)}
                    aria-label={`Delete ${c.name}`}
                  >
                    🗑️
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ProductModal({ product, categories, onClose, onSave, onDelete }) {
  const isNew = !product.id;
  const [form, setForm] = useState(product);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState("");

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setImgBusy(true);
    setImgError("");
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      update("image", dataUrl);
    } catch (err) {
      setImgError(err.message);
    } finally {
      setImgBusy(false);
    }
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
      image: form.image || "",
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

          <label className="field wide">
            <span>Product image</span>
            <div className="image-uploader">
              <ProductThumb
                image={form.image}
                name={form.name}
                category={form.category}
                size={64}
                radius={10}
              />
              <div className="image-uploader-actions">
                <label className="upload-btn">
                  {imgBusy
                    ? "Processing…"
                    : form.image
                    ? "Change photo"
                    : "📷 Upload photo"}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={pickImage}
                    hidden
                  />
                </label>
                {form.image && (
                  <button
                    type="button"
                    className="image-remove"
                    onClick={() => update("image", "")}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {imgError && <div className="auth-error">{imgError}</div>}
          </label>
        </div>

        <div className="modal-foot">
          {!isNew && (
            <button
              type="button"
              className="delete-btn"
              onClick={() => {
                if (confirm(`Delete "${form.name}"?`)) onDelete(product.id);
              }}
            >
              🗑️ Delete
            </button>
          )}
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
