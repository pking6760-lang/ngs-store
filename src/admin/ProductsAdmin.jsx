import { useMemo, useState } from "react";
import { useBackGuard } from "../lib/useBackGuard.js";
import { useShowMore } from "../lib/useShowMore.js";
import { useAdminProducts, useCategories } from "../lib/hooks.js";
import AdminPortal from "./AdminPortal.jsx";
import Dropdown from "./Dropdown.jsx";
import {
  upsertProduct,
  deleteProduct,
  addCategory,
  deleteCategory,
  updateCategory,
} from "../lib/actions.js";
import { lookupProductByBarcode, lookupProductByName, guessCategory, resolveSuggestedCategory, proposeNewCategory } from "../lib/productLookup.js";
import { smartReprice, uploadProductImage, uploadCategoryImage } from "../lib/api.js";
import { scanBarcode } from "../lib/scanner.js";
import ProductThumb from "../components/ProductThumb.jsx";
import { Ic } from "./AdminIcons.jsx";
import CategoryIcon from "../components/CategoryIcon.jsx";

// Sentinel category values: NEW_CAT = create the AI-suggested category on save;
// ADD_CAT = the "Create new category…" row that prompts for a name.
const NEW_CAT = "__new_category__";
const ADD_CAT = "__add_category__";

// Money for display: whole rupees show as-is, paise show two decimals (₹1.50),
// so a ₹1.50 margin never reads as a misleading "₹2".
function fmtMoney(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

const EMPTY = {
  id: "",
  name: "",
  category: "",
  barcode: "",
  unit: "",
  cost: "",
  price: "",
  mrp: "",
  image: "",
  inStock: true,
  stock: "",
  noRewards: false,
  tags: "",
};

export default function ProductsAdmin() {
  const products = useAdminProducts();
  const categories = useCategories();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [editing, setEditing] = useState(null); // product object or null
  const [managingCats, setManagingCats] = useState(false);
  useBackGuard(!!editing, () => setEditing(null));
  useBackGuard(managingCats, () => setManagingCats(false));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchCat = catFilter === "all" || p.category === catFilter;
      const matchText = !q || p.name.toLowerCase().includes(q) || (p.barcode || "").includes(q)
        || (p.tags || []).some((t) => t.includes(q));
      return matchCat && matchText;
    });
  }, [products, search, catFilter]);

  const list = useShowMore(filtered, 30);

  const catName = (id) => categories.find((c) => c.id === id)?.name || id;

  // Scan a barcode to find that product in the list.
  async function scanToSearch() {
    try {
      const code = await scanBarcode();
      if (code) setSearch(code);
    } catch { /* camera unavailable — the text search still works */ }
  }

  return (
    <>
      <div className="toolbar">
        <div className="search-scan">
          <input
            className="admin-search"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className="search-scan-btn" onClick={scanToSearch} title="Scan a barcode to find a product" aria-label="Scan barcode"><Ic name="camera" size={20} /></button>
        </div>
        <Dropdown
          className="admin-select"
          title="Filter by category"
          value={catFilter}
          onChange={setCatFilter}
          options={[
            { value: "all", label: "All categories" },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <button className="ghost-btn" onClick={() => setManagingCats(true)}>
          Categories
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
            {list.shown.map((p) => (
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
                      {p.freeDeliveryExempt && (
                        <span className="stock-tag exempt">No free-del</span>
                      )}
                      <span className={`cell-barcode ${p.barcode ? "has" : "none"}`}>
                        {p.barcode ? `${p.barcode}` : "no barcode"}
                      </span>
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
            {list.more && (
              <tr>
                <td colSpan={5} style={{ padding: 0 }}>
                  <button
                    type="button"
                    className="show-more-btn"
                    onClick={list.toggle}
                  >
                    {list.label}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {editing && (
        <AdminPortal>
          <ProductModal
            key={editing.id || "new"}
            product={editing}
            categories={categories}
            products={products}
            onOpenExisting={(p) => setEditing(p)}
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
  const [newImg, setNewImg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false); // holds the id being uploaded, or "new"

  async function upload(file) {
    if (!file) return null;
    try { return await uploadCategoryImage(file); }
    catch (e) { setError(e.message || "Couldn't upload that image."); return null; }
  }

  async function pickNewImage(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setBusy("new"); setError("");
    const url = await upload(file);
    if (url) setNewImg(url);
    setBusy(false);
  }

  async function setCatImage(cat, e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setBusy(cat.id); setError("");
    const url = await upload(file);
    if (url) { const r = await updateCategory(cat.id, { image: url }); if (!r.ok) setError(r.error); }
    setBusy(false);
  }

  async function clearCatImage(cat) {
    setError("");
    const r = await updateCategory(cat.id, { image: "" });
    if (!r.ok) setError(r.error);
  }

  async function add(e) {
    e.preventDefault();
    const res = await addCategory({ name, image: newImg }, categories);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName("");
    setNewImg("");
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
            <label className="cat-add-photo" title="Add a photo (optional)">
              {newImg
                ? <img src={newImg} alt="" />
                : <span>{busy === "new" ? "…" : "＋ Photo"}</span>}
              <input type="file" accept="image/*" hidden onChange={pickNewImage} />
            </label>
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
          <p className="cat-hint">Add a photo for a more professional look — or leave it and we’ll show a matching icon.</p>
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
                    {c.image
                      ? <img className="cat-list-img" src={c.image} alt="" />
                      : <CategoryIcon id={c.id} name={c.name} size={18} />}
                  </span>
                  <span className="cat-list-name">{c.name}</span>
                  <span className="cat-list-count">{count} items</span>
                  <label className="cat-list-photo" title={c.image ? "Change photo" : "Add photo"}>
                    {busy === c.id ? "…" : <Ic name="camera" size={16} />}
                    <input type="file" accept="image/*" hidden onChange={(e) => setCatImage(c, e)} />
                  </label>
                  {c.image && (
                    <button type="button" className="cat-list-del" onClick={() => clearCatImage(c)} aria-label={`Remove ${c.name} photo`} title="Remove photo">
                      <Ic name="x" size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="cat-list-del"
                    onClick={() => remove(c)}
                    aria-label={`Delete ${c.name}`}
                  >
                    <Ic name="trash" size={16} />
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

function ProductModal({ product, categories, products = [], onOpenExisting, onClose, onSave, onDelete }) {
  const isNew = !product.id;

  // Find an EXISTING product that clashes with this one so we never create a
  // duplicate. A clash = same barcode, OR same name AND same size (a same-name
  // item in a DIFFERENT size — e.g. 455 ml vs 910 ml — is a real separate
  // product, so it's allowed). Excludes the product being edited.
  function findDuplicate({ barcode, name, unit }) {
    const bc = (barcode || "").trim();
    const nm = (name || "").trim().toLowerCase();
    const un = (unit || "").trim().toLowerCase();
    return products.find((p) => {
      if (p.id === product.id) return false;
      if (bc && (p.barcode || "").trim() === bc) return true;
      if (nm && (p.name || "").trim().toLowerCase() === nm &&
          un && (p.unit || "").trim().toLowerCase() === un) return true;
      return false;
    });
  }
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

  // Category picker: "Create new category…" prompts for a name; otherwise just
  // select. The chosen new name is created for real on Save.
  function onPickCategory(value) {
    if (value === ADD_CAT) {
      const name = (prompt("New category name") || "").trim();
      if (name) setForm((f) => ({ ...f, category: NEW_CAT, newCategoryName: name }));
      return;
    }
    update("category", value);
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
    update("barcode", code); // save the scanned barcode on the product
    // Already in the shop's catalogue? Don't add a duplicate — point to it.
    const dup = findDuplicate({ barcode: code });
    if (dup) {
      setLookup({ busy: false, ok: false, dup, msg: `“${dup.name}” is already in your list.` });
      return;
    }
    setLookup({ busy: true, msg: `Looking up ${code}…` });
    const res = await lookupProductByBarcode(code, categories.map((c) => c.name));
    applyLookup(res);
  }

  // Search product details by the typed name (for items without a barcode).
  async function doNameSearch() {
    const q = (form.name || "").trim();
    if (q.length < 3) return;
    setScanErr("");
    setLookup({ busy: true, msg: `Searching “${q}”…` });
    const res = await lookupProductByName(q, categories.map((c) => c.name));
    applyLookup(res);
  }

  function applyLookup(res) {
    // Smart category: the server's classification (existing OR a proposed new
    // name), falling back to a local keyword rule — works even when full
    // product DETAILS weren't found (e.g. tobacco).
    const smart =
      resolveSuggestedCategory(res.category, categories) ||
      proposeNewCategory(res.name || form.name, categories);
    let catMsg = "";
    setForm((f) => {
      const next = { ...f };
      if (res.found && res.name) next.name = res.name;
      if (res.found && res.unit) next.unit = res.unit;
      if (smart?.id) {
        next.category = smart.id;
      } else if (smart?.newName) {
        // No existing category fits — propose creating one; the owner confirms.
        next.category = NEW_CAT;
        next.newCategoryName = smart.newName;
        catMsg = ` New category suggested: “${smart.newName}”.`;
      } else if (res.found) {
        const cat = guessCategory(res, categories);
        if (cat) next.category = cat;
      }
      return next;
    });
    if (!res.found) {
      setLookup({
        busy: false,
        ok: !!smart,
        msg: (smart ? "Set the category below." : (res.reason || "Not found — fill it in by hand.")) + catMsg,
      });
      return;
    }
    setLookup({ busy: false, ok: true, msg: "Got the details — add your photo, price & stock." + catMsg });
  }

  async function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setImgBusy(true);
    setImgError("");
    try {
      // Upload to Storage and keep only the CDN URL — never embed base64 in
      // the products row (that bloated the list payload and stalled the app).
      const url = await uploadProductImage(file);
      update("image", url);
    } catch (err) {
      setImgError(err.message || "Couldn't upload that photo.");
    } finally {
      setImgBusy(false);
    }
  }

  const [saveBusy, setSaveBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (saveBusy) return;
    // Safety net: never save a NEW product that clashes with an existing one.
    if (isNew) {
      const dup = findDuplicate({ barcode: form.barcode, name: form.name, unit: form.unit });
      if (dup) {
        setLookup({ busy: false, ok: false, dup, msg: `“${dup.name}” is already in your list — open it to edit instead of adding a duplicate.` });
        return;
      }
    }
    const price = Number(form.price) || 0;
    const mrp = Number(form.mrp) || price;
    let categoryId = form.category;
    // Create the brand-new category (AI-suggested or hand-typed) on save.
    if (categoryId === NEW_CAT) {
      const name = (form.newCategoryName || "").trim();
      if (!name) { setLookup({ busy: false, ok: false, msg: "Name the new category first." }); return; }
      setSaveBusy(true);
      const res = await addCategory({ name }, categories);
      setSaveBusy(false);
      if (!res.ok) { setLookup({ busy: false, ok: false, msg: res.error || "Couldn't create the category." }); return; }
      categoryId = res.category.id;
    }
    onSave({
      ...form,
      category: categoryId,
      newCategoryName: undefined,
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

  // Set the selling price so it clears a target margin-on-selling from cost,
  // then round UP to a clean whole rupee — so the price is always a round
  // figure and the real margin never drops below the target you tapped.
  function setMargin(pct) {
    if (!(costNum >= 0) || form.cost === "" || form.cost == null) return;
    const price = costNum / (1 - pct / 100);
    update("price", String(Math.max(1, Math.ceil(price))));
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
              {scanBusy ? "Opening camera…" : "Scan barcode to auto-fill"}
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
                {lookup.dup && onOpenExisting && (
                  <button type="button" className="scan-open-existing" onClick={() => onOpenExisting(lookup.dup)}>
                    Open it
                  </button>
                )}
              </p>
            )}
          </div>

          <label className="field wide">
            <span>Barcode {form.barcode ? "✓ saved" : "(scan or type)"}</span>
            <input
              className="mono"
              inputMode="numeric"
              value={form.barcode ?? ""}
              onChange={(e) => update("barcode", e.target.value.replace(/\D/g, ""))}
              placeholder="Scan a barcode above, or type it — saved for in-store scanning"
            />
          </label>

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
              >Find</button>
            </div>
          </label>

          <div className="field">
            <span className="field-lbl">Category</span>
            <Dropdown
              className="cat-dd"
              title="Choose a category"
              value={form.category}
              placeholder="Choose a category"
              onChange={onPickCategory}
              options={[
                ...categories.map((c) => ({ value: c.id, label: c.name })),
                // AI-suggested brand-new category (only while it isn't real yet).
                ...(form.newCategoryName
                  ? [{ value: NEW_CAT, label: `New: ${form.newCategoryName}`, kind: "new" }]
                  : []),
                { value: ADD_CAT, label: "Create new category…", kind: "new" },
              ]}
            />
          </div>

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
            <span>Search tags (comma separated)</span>
            <input
              value={Array.isArray(form.tags) ? form.tags.join(", ") : form.tags || ""}
              onChange={(e) => update("tags", e.target.value)}
              placeholder="e.g. sarson tel, kacchi ghani, oil"
            />
          </label>

          <label className="field">
            <span>Cost price (₹)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
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
              step="0.01"
              inputMode="decimal"
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
              step="0.01"
              inputMode="decimal"
              value={form.mrp}
              onChange={(e) => update("mrp", e.target.value)}
            />
          </label>

          <div className="field wide margin-box">
            {hasMargin ? (
              <div className={`margin-read ${profit < 0 ? "loss" : ""}`}>
                <span className="margin-lbl">Margin</span>
                <strong>{profit < 0 ? "–₹" : "₹"}{fmtMoney(Math.abs(profit))}</strong>
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
                    : "Upload photo"}
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

          <label className="field wide stock-field">
            <span>Free-delivery counting</span>
            <button
              type="button"
              className={`stock-toggle ${form.freeDeliveryExempt ? "off" : "on"}`}
              onClick={() => update("freeDeliveryExempt", !form.freeDeliveryExempt)}
            >
              <span className="stock-knob" />
              <span className="stock-label">
                {form.freeDeliveryExempt ? "Excluded from ₹ minimum" : "Counts toward free delivery"}
              </span>
            </button>
            <small className="field-note">
              Turn OFF for ultra-low-margin items (milk, curd, bread) so their
              value doesn't help unlock free delivery. Customers can still buy them.
            </small>
          </label>

          <label className="field wide stock-field">
            <span>Thin margin (rewards)</span>
            <button
              type="button"
              className={`stock-toggle ${form.noRewards ? "off" : "on"}`}
              onClick={() => update("noRewards", !form.noRewards)}
            >
              <span className="stock-knob" />
              <span className="stock-label">
                {form.noRewards ? "No discount / points / reward" : "Earns member price + rewards"}
              </span>
            </button>
            <small className="field-note">
              Turn ON for zero-margin staples. Everyone pays the normal price
              (no member discount), and the item earns no points and no scratch
              reward. Still fully buyable.
            </small>
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
              Delete
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
