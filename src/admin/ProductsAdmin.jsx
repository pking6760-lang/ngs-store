import { useMemo, useState } from "react";
import { useAdminProducts, useCategories } from "../lib/hooks.js";
import AdminPortal from "./AdminPortal.jsx";
import {
  upsertProduct,
  deleteProduct,
  addCategory,
  deleteCategory,
} from "../lib/actions.js";
import { fileToResizedDataUrl } from "../lib/image.js";
import { lookupProductByBarcode, lookupProductByName, guessCategory } from "../lib/productLookup.js";
import { smartReprice } from "../lib/api.js";
import { scanBarcode } from "../lib/scanner.js";
import ProductThumb from "../components/ProductThumb.jsx";

const EMPTY = {
  id: "",
  name: "",
  category: "",
  unit: "",
  cost: "",
  price: "",
  mrp: "",
  image: "",
  inStock: true,
  stock: "",
};

export default function ProductsAdmin() {
  const products = useAdminProducts();
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
                    <span className="cell-name">
                      {p.name}
                      {p.inStock === false && (
                        <span className="stock-tag out">Out of stock</span>
                      )}
                    </span>
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
        <AdminPortal>
          <ProductModal
            product={editing}
            categories={categories}
            onClose={() => setEditing(null)}
            onSave={async (prod) => {
              await upsertProduct(prod);
              setEditing(null);
              // If a buying price is set, let Smart Pricing set the selling
              // price straight away instead of waiting for the next schedule.
              if (prod.cost !== "" && prod.cost != null && prod.mrp) {
                try { await smartReprice(); } catch { /* schedule will catch up */ }
              }
            }}
            onDelete={(id) => {
              deleteProduct(id);
              setEditing(null);
            }}
          />
        </AdminPortal>
      )}

      {managingCats && (
        <AdminPortal>
          <CategoryManager
            categories={categories}
            products={products}
            onClose={() => setManagingCats(false)}
          />
        </AdminPortal>
      )}
    </>
  );
}

function CategoryManager({ categories, products, onClose }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🏷️");
  const [error, setError] = useState("");

  async function add(e) {
    e.preventDefault();
    const res = await addCategory({ name, icon }, categories);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName("");
    setIcon("🏷️");
    setError("");
  }

  async function remove(cat) {
    const count = products.filter((p) => p.category === cat.id).length;
    const msg =
      count > 0
        ? `Delete "${cat.name}"? Its ${count} product${
            count > 1 ? "s" : ""
          } will move to another category.`
        : `Delete "${cat.name}"?`;
    if (!confirm(msg)) return;
    const res = await deleteCategory(cat.id, categories);
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
  const [scanBusy, setScanBusy] = useState(false);
  const [scanErr, setScanErr] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [lookup, setLookup] = useState(null); // { busy, ok, msg }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Open the native camera scanner. On success look the code up; on failure
  // reveal a type-it-in box so the flow never dead-ends.
  async function doScan() {
    setScanErr(""); setScanBusy(true);
    try {
      const code = await scanBarcode();
      if (code) await onScanned(code);
    } catch (e) {
      setScanErr(e.message || "Couldn't scan — type the barcode instead.");
    } finally {
      setScanBusy(false);
    }
  }

  // A barcode was scanned (or typed) — look it up in the open product DBs and
  // auto-fill name, size, category and photo, so the owner only sets price &
  // stock. Fields the DB doesn't know are left untouched.
  async function onScanned(code) {
    setScanErr("");
    setLookup({ busy: true, msg: `Looking up ${code}…` });
    const res = await lookupProductByBarcode(code);
    applyLookup(res);
  }

  // Search product details by the typed name (for items without a barcode).
  async function doNameSearch() {
    const q = (form.name || "").trim();
    if (q.length < 3) return;
    setScanErr("");
    setLookup({ busy: true, msg: `Searching “${q}”…` });
    const res = await lookupProductByName(q);
    applyLookup(res);
  }

  function applyLookup(res) {
    if (!res.found) {
      setLookup({ busy: false, ok: false, msg: res.reason || "Not found — fill it in by hand." });
      return;
    }
    setForm((f) => {
      const next = { ...f };
      if (res.name) next.name = res.name;
      if (res.unit) next.unit = res.unit;
      const cat = guessCategory(res, categories);
      if (cat) next.category = cat;
      return next;
    });
    setLookup({ busy: false, ok: true, msg: "Got the details — add your photo, price & stock." });
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
      cost: form.cost === "" || form.cost == null ? undefined : Math.max(0, Number(form.cost) || 0),
      image: form.image || "",
      stock: form.stock === "" || form.stock == null ? undefined : Math.max(0, Number(form.stock) || 0),
    });
  }

  // Live profit + margin from cost vs selling price. Margin is on the selling
  // price (standard retail margin) — this is the pool partners take a share of.
  const costNum = Number(form.cost);
  const priceNum = Number(form.price);
  const hasMargin = form.cost !== "" && form.cost != null && priceNum > 0 && costNum >= 0;
  const profit = hasMargin ? priceNum - costNum : 0;
  const marginPct = hasMargin && priceNum > 0 ? (profit / priceNum) * 100 : 0;

  // Set the selling price so it lands at a target margin-on-selling from cost.
  function setMargin(pct) {
    if (!(costNum >= 0) || form.cost === "" || form.cost == null) return;
    const price = costNum / (1 - pct / 100);
    update("price", String(Math.round(price)));
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
          <div className="field wide scan-field">
            <button type="button" className="scan-btn" onClick={doScan} disabled={scanBusy}>
              {scanBusy ? "Opening camera…" : "📷 Scan barcode to auto-fill"}
            </button>
            {scanErr && (
              <>
                <p className="scan-status miss">{scanErr}</p>
                <div className="scan-manual-row">
                  <input
                    inputMode="numeric"
                    placeholder="Type barcode digits"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={manualCode.replace(/\D/g, "").length < 6}
                    onClick={() => onScanned(manualCode.replace(/\D/g, ""))}
                  >Use</button>
                </div>
              </>
            )}
            {lookup && (
              <p className={`scan-status ${lookup.busy ? "busy" : lookup.ok ? "ok" : "miss"}`}>
                {lookup.busy && <span className="ngs-spin" aria-hidden />}
                {lookup.msg}
              </p>
            )}
          </div>

          <label className="field wide">
            <span>Product name</span>
            <div className="name-search">
              <input
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="e.g. Britannia Mom's Magic"
                required
              />
              <button
                type="button"
                className="name-search-btn"
                onClick={doNameSearch}
                disabled={(form.name || "").trim().length < 3 || (lookup && lookup.busy)}
                title="Auto-fill weight & details from the name"
              >🔍 Find</button>
            </div>
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
            <span>Cost price (₹)</span>
            <input
              type="number"
              min="0"
              value={form.cost ?? ""}
              onChange={(e) => update("cost", e.target.value)}
              placeholder="what you pay"
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

          <div className="field wide margin-box">
            {hasMargin ? (
              <div className={`margin-read ${profit < 0 ? "loss" : ""}`}>
                <span className="margin-lbl">Margin</span>
                <strong>{profit < 0 ? "–₹" : "₹"}{Math.abs(Math.round(profit))}</strong>
                <span className="margin-pct">{marginPct.toFixed(1)}%</span>
                {profit < 0 && <span className="margin-warn">below cost!</span>}
              </div>
            ) : (
              <p className="margin-hint">Enter cost price to see your margin.</p>
            )}
            {form.cost !== "" && form.cost != null && costNum >= 0 && (
              <div className="margin-quick">
                <span>Set price for margin:</span>
                {[12, 15, 20].map((m) => (
                  <button key={m} type="button" onClick={() => setMargin(m)}>{m}%</button>
                ))}
              </div>
            )}
          </div>

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

          <label className="field wide stock-field">
            <span>Availability</span>
            <button
              type="button"
              className={`stock-toggle ${form.inStock === false ? "off" : "on"}`}
              onClick={() => update("inStock", form.inStock === false)}
            >
              <span className="stock-knob" />
              <span className="stock-label">
                {form.inStock === false ? "Out of stock" : "In stock"}
              </span>
            </button>
          </label>

          <label className="field">
            <span>Stock quantity (optional)</span>
            <input
              type="number"
              min="0"
              value={form.stock ?? ""}
              onChange={(e) => update("stock", e.target.value)}
              placeholder="e.g. 20 — for low-stock alerts"
            />
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
