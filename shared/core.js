// ─────────────────────────────────────────────────────────────────────────────
// NGS STORE — SHARED CORE
// This module is shared by BOTH apps (customer + admin). It holds the single
// source of truth: the Supabase database layer, payment/UPI helpers, formatters,
// search, status labels, and the visual design system (CSS).
//
// Because both apps talk to the SAME Supabase tables through `db` below, they
// stay connected: an order placed in the customer app shows up in the admin
// app within seconds, and product / price / store-open changes made in the
// admin app flow back to every customer.
// ─────────────────────────────────────────────────────────────────────────────

// ── UPI PAYMENT ────────────────────────────────────────────────────────────
export const UPI_ID = "Q006245410@ybl";
export const UPI_PAYEE_NAME = "NGS Store";

// Builds a standard UPI deep link with the exact order amount, locked (not editable by the customer)
export function buildUpiLink(amount, orderId) {
  const params = new URLSearchParams({
    pa: UPI_ID,
    pn: UPI_PAYEE_NAME,
    am: amount.toFixed(2),
    cu: "INR",
    tn: "NGS Store Order " + orderId,
  });
  return "upi://pay?" + params.toString();
}

// Generates a QR code image URL for the UPI link (uses a free public QR API)
export function buildUpiQrUrl(upiLink) {
  return "https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=" + encodeURIComponent(upiLink);
}

// ── SUPABASE DATABASE LAYER ───────────────────────────────────────────────────
// Connects all phones (customer + admin) to one shared database so orders sync everywhere.
export const SUPABASE_URL = "https://lphjuteikmnqbbuxbgoi.supabase.co";
export const SUPABASE_KEY = "sb_publishable_FbE-JNjShcOIfn50z6EOxQ_IRXbCGF0";

const sbHeaders = {
  "apikey": SUPABASE_KEY,
  "Authorization": "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json",
};

async function sbSelect(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, { headers: sbHeaders });
  if (!res.ok) throw new Error("select failed");
  return await res.json();
}

// Upsert one or many rows
async function sbUpsert(table, rows) {
  const body = Array.isArray(rows) ? rows : [rows];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("upsert failed: " + (await res.text()));
}

async function sbDelete(table, idField, idValue) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${idField}=eq.${encodeURIComponent(idValue)}`, {
    method: "DELETE",
    headers: sbHeaders,
  });
  if (!res.ok) throw new Error("delete failed");
}

// ── Mappers: convert between app objects and database rows ───────────────────
const mapProductToRow = (p) => ({
  id: p.id, name: p.name, price: p.price, mrp: p.mrp ?? null,
  category: p.category, unit: p.unit, emoji: p.emoji, barcode: p.barcode ?? null,
  slabs: p.slabs ?? [], in_stock: p.inStock ?? true,
});
const mapRowToProduct = (r) => ({
  id: r.id, name: r.name, price: Number(r.price), mrp: r.mrp != null ? Number(r.mrp) : null,
  category: r.category, unit: r.unit, emoji: r.emoji, barcode: r.barcode || "",
  slabs: r.slabs || [], inStock: r.in_stock,
});
const mapCustomerToRow = (c) => ({
  phone: c.phone, name: c.name, address: c.address, location: c.location ?? null,
  first_order: c.firstOrder, last_order: c.lastOrder,
  total_orders: c.totalOrders, total_spent: c.totalSpent,
});
const mapRowToCustomer = (r) => ({
  phone: r.phone, name: r.name, address: r.address, location: r.location,
  firstOrder: r.first_order, lastOrder: r.last_order,
  totalOrders: r.total_orders, totalSpent: Number(r.total_spent),
});

// ── Compatibility wrapper so existing code keeps working ──────────────────────
// Emulates window.storage.get/set but routes to Supabase tables.
export const db = {
  async getOrders() {
    const rows = await sbSelect("orders");
    const mapped = rows.map(o => {
      const payment = o.customer?._payment || null;
      const customer = o.customer ? { ...o.customer } : o.customer;
      if (customer && "_payment" in customer) delete customer._payment;
      return { ...o, customer, payment };
    });
    return mapped.sort((a,b) => b.timestamp - a.timestamp);
  },
  async getProducts() {
    const rows = await sbSelect("products");
    return rows.map(mapRowToProduct);
  },
  async getCustomers() {
    const rows = await sbSelect("customers");
    return rows.map(mapRowToCustomer).sort((a,b) => b.lastOrder - a.lastOrder);
  },
  async getCharges() {
    return await sbSelect("charges");
  },
  async getStoreOpen() {
    const rows = await sbSelect("settings");
    const row = rows.find(r => r.key === "store_open");
    return row ? row.value : true;
  },
  async saveOrder(order) {
    await sbUpsert("orders", {
      id: order.id, timestamp: order.timestamp, items: order.items,
      total: order.total, subtotal: order.subtotal ?? order.total,
      charges: order.charges ?? [],
      // payment info is nested inside customer JSON since the orders table has no dedicated column for it
      customer: { ...order.customer, _payment: order.payment ?? null },
      status: order.status,
    });
  },
  async updateOrderStatus(id, status) {
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...sbHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify({ status }),
    });
  },
  async saveProduct(p) { await sbUpsert("products", mapProductToRow(p)); },
  async deleteProduct(id) { await sbDelete("products", "id", id); },
  async saveCustomer(c) { await sbUpsert("customers", mapCustomerToRow(c)); },
  async saveCharges(charges) {
    // Replace all: simplest reliable approach for small lists
    const existing = await sbSelect("charges");
    for (const e of existing) {
      if (!charges.find(c => c.id === e.id)) await sbDelete("charges", "id", e.id);
    }
    if (charges.length) await sbUpsert("charges", charges.map(c => ({ id: c.id, name: c.name, price: c.price, active: c.active })));
  },
  async setStoreOpen(open) {
    await sbUpsert("settings", { key: "store_open", value: open });
  },
};

export const DEFAULT_PRODUCTS = [
  { id: 1, name: "Britannia Gooday", category: "Biscuit", price: 30, unit: "pack", emoji: "🍪", inStock: true },
];

export function formatINR(n) { return "₹" + (Number(n) || 0).toLocaleString("en-IN"); }
export function genId() { return "NGS" + Math.floor(1000 + Math.random() * 9000); }

// ── SMART SEARCH ───────────────────────────────────────────────────────────
// Matches even with typos, partial words, or different word order.
// Scores results so the best matches show first.
export function fuzzyScore(text, query) {
  text = (text || "").toLowerCase();
  query = (query || "").trim().toLowerCase();
  if (!query) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 90;
  if (text.includes(query)) return 70;

  // word-by-word match (handles different word order, e.g. "gooday britannia")
  const queryWords = query.split(/\s+/).filter(Boolean);
  const textWords = text.split(/\s+/).filter(Boolean);
  let wordHits = 0;
  for (const qw of queryWords) {
    if (textWords.some(tw => tw.includes(qw) || qw.includes(tw))) wordHits++;
  }
  if (wordHits === queryWords.length && queryWords.length > 0) return 60;
  if (wordHits > 0) return 40 * (wordHits / queryWords.length);

  // typo tolerance: simple character overlap check for short queries
  if (query.length >= 3) {
    let matchedChars = 0;
    let ti = 0;
    for (const ch of query) {
      const idx = text.indexOf(ch, ti);
      if (idx !== -1) { matchedChars++; ti = idx + 1; }
    }
    const ratio = matchedChars / query.length;
    if (ratio > 0.75) return 25 * ratio;
  }
  return 0;
}

export function searchProducts(products, query) {
  if (!query || !query.trim()) return products;
  const scored = products
    .map(p => ({
      product: p,
      score: Math.max(
        fuzzyScore(p.name, query),
        fuzzyScore(p.category, query) * 0.8,
        fuzzyScore(p.barcode, query) * 0.9
      ),
    }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map(x => x.product);
}

export const S_ORDER = ["pending", "confirmed", "out_for_delivery", "delivered"];
export const S_LABEL = { pending: "Pending", confirmed: "Confirmed", out_for_delivery: "On the way", delivered: "Delivered" };
export const S_LABEL_A = { pending: "Pending", confirmed: "Confirmed", out_for_delivery: "Out for Delivery", delivered: "Delivered" };

// ── STYLES ────────────────────────────────────────────────────────────────────
export const css = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --cream: #f5f0e8; --parchment: #ede7d9; --bark: #3d2b1f; --bark-mid: #6b4c3b;
  --bark-light: #a07858; --leaf: #4a7c59; --leaf-light: #6aac7e; --leaf-pale: #e8f2eb;
  --spice: #c8602a; --spice-light: #e07848; --gold: #c49a3c; --white: #fffefb;
  --danger: #c0392b; --danger-pale: #fdecea;
  --shadow: 0 2px 16px rgba(61,43,31,0.10); --shadow-lg: 0 8px 32px rgba(61,43,31,0.16);
  --radius: 18px;
}
html, body { background: var(--cream); font-family: 'DM Sans', sans-serif; color: var(--bark); min-height: 100vh; }
.hdr { background: var(--bark); padding: 0 18px; height: 62px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 200; }
.hdr-logo { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 800; color: var(--cream); letter-spacing: 1px; cursor: pointer; user-select: none; }
.hdr-logo sup { font-size: 10px; font-family: 'DM Sans', sans-serif; font-weight: 500; color: var(--gold); letter-spacing: 2px; vertical-align: super; margin-left: 4px; text-transform: uppercase; }
.hdr-cart { background: var(--spice); border: none; border-radius: 12px; color: white; font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 14px; padding: 8px 14px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.2s, transform 0.15s; }
.hdr-cart:hover { background: var(--spice-light); transform: scale(1.04); }
.cart-bubble { background: var(--cream); color: var(--spice); border-radius: 50%; width: 20px; height: 20px; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.bnav { position: fixed; bottom: 0; left: 0; right: 0; background: var(--white); border-top: 1px solid var(--parchment); display: flex; z-index: 200; box-shadow: 0 -4px 20px rgba(61,43,31,0.08); }
.bnav-btn { flex: 1; border: none; background: none; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 500; color: var(--bark-light); display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 10px 0; transition: color 0.2s; }
.bnav-btn.active { color: var(--leaf); }
.bnav-btn .ico { font-size: 20px; }
.main { padding: 18px 16px 88px; max-width: 480px; margin: 0 auto; }
.hero-band { background: var(--bark); border-radius: var(--radius); padding: 22px 20px 18px; margin-bottom: 20px; position: relative; overflow: hidden; }
.hero-band h2 { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; color: var(--cream); margin-bottom: 4px; }
.hero-band p { font-size: 13px; color: var(--bark-light); }
.hero-leaf { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); font-size: 56px; opacity: 0.15; }
.cats { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; margin-bottom: 18px; scrollbar-width: none; }
.cats::-webkit-scrollbar { display: none; }

/* ── SEARCH BAR ── */
.search-box { position: relative; margin-bottom: 16px; }
.search-input { width: 100%; padding: 13px 16px 13px 42px; border: 1.5px solid var(--parchment); border-radius: 16px; font-family: 'DM Sans', sans-serif; font-size: 15px; color: var(--bark); background: var(--white); outline: none; transition: border-color 0.2s, box-shadow 0.2s; box-shadow: var(--shadow); }
.search-input:focus { border-color: var(--leaf); box-shadow: 0 0 0 3px rgba(74,124,89,0.12); }
.search-icon { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); font-size: 17px; color: var(--bark-light); pointer-events: none; }
.search-clear { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: var(--parchment); color: var(--bark-mid); border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.search-results-info { font-size: 13px; color: var(--bark-light); margin: -6px 0 14px 4px; }
.search-no-results { text-align: center; padding: 40px 20px; }
.search-no-results .big { font-size: 48px; margin-bottom: 10px; }
.cat-pill { white-space: nowrap; padding: 6px 16px; border-radius: 30px; border: 1.5px solid var(--parchment); background: var(--white); font-family: 'DM Sans', sans-serif; font-weight: 500; font-size: 13px; color: var(--bark-mid); cursor: pointer; transition: all 0.18s; }
.cat-pill.active { background: var(--leaf); color: white; border-color: var(--leaf); }
.sec-head { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; color: var(--bark); margin-bottom: 14px; }
.pgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pcard { background: var(--white); border-radius: var(--radius); padding: 14px 12px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); transition: transform 0.18s, box-shadow 0.18s; }
.pcard:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }
.pcard-emoji { font-size: 42px; text-align: center; margin-bottom: 8px; }
.pcard-name { font-weight: 600; font-size: 13px; line-height: 1.35; margin-bottom: 3px; color: var(--bark); }
.pcard-cat { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--bark-light); margin-bottom: 8px; }
.pcard-price { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 700; color: var(--leaf); }
.pcard-price span { font-size: 11px; font-family: 'DM Sans', sans-serif; color: var(--bark-light); font-weight: 400; }
.add-btn { width: 100%; margin-top: 10px; padding: 7px; border: 1.5px solid var(--leaf); border-radius: 10px; background: transparent; color: var(--leaf); font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.18s; }
.add-btn:hover { background: var(--leaf); color: white; }
.qty-row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.qty-btn { width: 28px; height: 28px; border-radius: 8px; border: none; background: var(--leaf); color: white; font-size: 16px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.qty-n { font-weight: 700; font-size: 15px; color: var(--bark); }
.slab-box { margin-top: 8px; border-top: 1px dashed var(--parchment); padding-top: 8px; }
.slab-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border-radius: 8px; margin-bottom: 3px; font-size: 12px; cursor: pointer; transition: background 0.15s; border: 1.5px solid transparent; }
.slab-row:hover { background: var(--leaf-pale); }
.slab-row.active-slab { background: var(--leaf-pale); border-color: var(--leaf-light); }
.slab-qty { font-weight: 700; color: var(--bark-mid); }
.slab-price { font-family: 'Playfair Display', serif; font-weight: 700; color: var(--leaf); font-size: 13px; }
.slab-save { background: var(--spice); color: white; border-radius: 6px; padding: 1px 6px; font-size: 10px; font-weight: 700; }
.slab-heading { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--bark-light); font-weight: 600; margin-bottom: 4px; }
.admin-slabs-box { margin-top: 10px; padding-top: 10px; border-top: 1.5px dashed var(--parchment); }
.admin-slab-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.admin-slab-row input { flex: 1; padding: 7px 10px; border: 1.5px solid var(--parchment); border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; background: var(--cream); outline: none; }
.admin-slab-row input:focus { border-color: var(--leaf); background: white; }
.add-slab-btn { padding: 7px 12px; border: 1.5px dashed var(--leaf); border-radius: 8px; background: transparent; color: var(--leaf); font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.remove-slab-btn { padding: 5px 8px; border: none; border-radius: 6px; background: var(--danger-pale); color: var(--danger); font-size: 12px; font-weight: 700; cursor: pointer; }
.slab-label { font-size: 11px; font-weight: 700; color: var(--bark-light); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.mrp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.mrp-strike { font-size: 12px; color: var(--bark-light); text-decoration: line-through; font-family: 'DM Sans', sans-serif; }
.discount-badge { background: var(--spice); color: white; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 6px; letter-spacing: 0.3px; }
.empty-box { text-align: center; padding: 60px 20px; }
.empty-box .big { font-size: 60px; margin-bottom: 14px; }
.empty-box p { font-size: 15px; color: var(--bark-light); font-weight: 500; }
.citem { background: var(--white); border-radius: var(--radius); padding: 14px 16px; display: flex; align-items: center; gap: 12px; margin-bottom: 10px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); }
.citem-emoji { font-size: 30px; }
.citem-info { flex: 1; }
.citem-name { font-weight: 600; font-size: 14px; }
.citem-sub { font-size: 12px; color: var(--bark-light); margin-top: 2px; }
.citem-total { font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 700; color: var(--leaf); }
.cart-summary-box { background: var(--white); border-radius: var(--radius); padding: 16px; margin-top: 14px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); }
.cs-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 8px; color: var(--bark-mid); }
.cs-row.total { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 700; color: var(--bark); border-top: 1.5px dashed var(--parchment); padding-top: 10px; margin-top: 4px; }
.chk-form { background: var(--white); border-radius: var(--radius); padding: 18px; margin-top: 14px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); }
.chk-form h3 { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; margin-bottom: 16px; color: var(--bark); }
.fgrp { margin-bottom: 12px; }
.fgrp label { font-size: 11px; font-weight: 600; color: var(--bark-light); text-transform: uppercase; letter-spacing: 0.8px; display: block; margin-bottom: 5px; }
.fgrp input, .fgrp textarea { width: 100%; padding: 11px 13px; border: 1.5px solid var(--parchment); border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 16px; color: var(--bark); background: var(--cream); outline: none; transition: border-color 0.2s, background 0.2s; }
.fgrp input:focus, .fgrp textarea:focus { border-color: var(--leaf); background: var(--white); }
.fgrp textarea { resize: none; height: 72px; }
.loc-btn { width: 100%; padding: 10px; margin-top: 6px; border: 1.5px dashed var(--leaf); border-radius: 12px; background: var(--leaf-pale); color: var(--leaf); font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.18s; }
.loc-btn:hover { background: var(--leaf); color: white; border-style: solid; }
.loc-btn:disabled { opacity: 0.6; cursor: wait; }
.loc-preview { margin-top: 8px; padding: 10px 12px; background: var(--leaf-pale); border-radius: 10px; border: 1px solid var(--leaf-light); font-size: 12px; color: var(--leaf); font-weight: 500; display: flex; align-items: flex-start; gap: 6px; }
.place-btn { width: 100%; padding: 15px; margin-top: 12px; border: none; border-radius: var(--radius); background: var(--bark); color: var(--cream); font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; cursor: pointer; transition: background 0.2s, transform 0.15s; box-shadow: 0 4px 16px rgba(61,43,31,0.25); }
.place-btn:hover { background: var(--bark-mid); transform: translateY(-1px); }

/* ── PAYMENT METHOD ── */
.pay-method-row { display: flex; gap: 8px; }
.pay-method-btn { flex: 1; padding: 12px 8px; border: 1.5px solid var(--parchment); border-radius: 12px; background: var(--cream); color: var(--bark-mid); font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.18s; }
.pay-method-btn.active { background: var(--leaf-pale); border-color: var(--leaf); color: var(--leaf); }

/* ── UPI PAYMENT MODAL ── */
.upi-overlay { position: fixed; inset: 0; background: rgba(61,43,31,0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; }
.upi-modal { background: var(--white); border-radius: 24px; padding: 22px; width: 100%; max-width: 380px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
.upi-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.upi-modal-header h3 { font-family: 'Playfair Display', serif; font-size: 19px; font-weight: 700; color: var(--bark); }
.upi-close { background: var(--cream); border: none; border-radius: 50%; width: 30px; height: 30px; font-size: 14px; color: var(--bark-mid); cursor: pointer; }
.upi-amount-lock { text-align: center; background: var(--leaf-pale); border-radius: 14px; padding: 14px; margin-bottom: 16px; }
.upi-amount-lock-label { font-size: 11px; color: var(--bark-light); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
.upi-amount-lock-value { font-family: 'Playfair Display', serif; font-size: 30px; font-weight: 800; color: var(--leaf); margin: 4px 0; }
.upi-amount-lock-note { font-size: 11px; color: var(--leaf); font-weight: 600; }
.upi-qr-img { display: block; width: 220px; height: 220px; margin: 0 auto 14px; border-radius: 12px; border: 1.5px solid var(--parchment); }
.upi-or-divider { text-align: center; margin: 10px 0; position: relative; }
.upi-or-divider span { background: var(--white); padding: 0 12px; color: var(--bark-light); font-size: 12px; font-weight: 600; }
.upi-or-divider::before { content: ""; position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: var(--parchment); z-index: -1; }
.upi-tap-btn { display: block; text-align: center; padding: 14px; background: #5f259f; color: white; border-radius: 14px; font-family: 'DM Sans', sans-serif; font-weight: 700; font-size: 15px; text-decoration: none; margin-bottom: 14px; }
.upi-hint { font-size: 12px; color: var(--bark-light); text-align: center; margin-bottom: 16px; line-height: 1.5; }
.upi-confirm-btn { width: 100%; padding: 14px; border: none; border-radius: 14px; background: var(--leaf); color: white; font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 700; cursor: pointer; }
.upi-confirm-btn:disabled { background: var(--leaf-light); cursor: not-allowed; }
.success-wrap { text-align: center; padding: 52px 20px; }
.success-wrap .s-ico { font-size: 70px; margin-bottom: 16px; animation: pop 0.5s ease; }
@keyframes pop { 0%{transform:scale(0.5);opacity:0} 80%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
.success-wrap h2 { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 800; color: var(--leaf); margin-bottom: 8px; }
.success-wrap p { font-size: 14px; color: var(--bark-light); margin-bottom: 20px; }
.oid-tag { display: inline-block; background: var(--bark); color: var(--cream); padding: 6px 18px; border-radius: 20px; font-weight: 700; font-size: 14px; margin-bottom: 24px; letter-spacing: 1px; }
.go-track { display: inline-block; padding: 12px 28px; background: var(--leaf); color: white; border: none; border-radius: 14px; font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 15px; cursor: pointer; }
.ocard { background: var(--white); border-radius: var(--radius); padding: 16px; margin-bottom: 12px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); }
.ocard.new-order { border-color: var(--spice); box-shadow: 0 0 0 3px rgba(200,96,42,0.1); }
.ocard-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.o-id { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 700; color: var(--bark); }
.o-date { font-size: 11px; color: var(--bark-light); margin-top: 2px; }
.sbadge { padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.s-pending { background: #fff3e0; color: #bf360c; }
.s-confirmed { background: #e3f2fd; color: #0d47a1; }
.s-out_for_delivery { background: #f3e5f5; color: #4a148c; }
.s-delivered { background: var(--leaf-pale); color: var(--leaf); }
.o-items { font-size: 13px; color: var(--bark-light); margin-bottom: 6px; line-height: 1.6; }
.o-total { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 16px; color: var(--bark); }
.progress-track { display: flex; align-items: center; margin: 12px 0 8px; }
.prog-step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.prog-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--parchment); border: 2px solid var(--parchment); transition: all 0.3s; }
.prog-dot.done { background: var(--leaf); border-color: var(--leaf); }
.prog-dot.current { background: var(--spice); border-color: var(--spice); box-shadow: 0 0 0 3px rgba(200,96,42,0.2); }
.prog-label { font-size: 9px; color: var(--bark-light); text-align: center; font-weight: 500; white-space: nowrap; }
.prog-line { flex: 1; height: 2px; background: var(--parchment); margin-bottom: 14px; transition: background 0.3s; }
.prog-line.done { background: var(--leaf); }
.toast { position: fixed; top: 70px; left: 50%; transform: translateX(-50%); background: var(--bark); color: var(--cream); padding: 11px 20px; border-radius: 12px; font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 13px; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: fadeSlide 0.3s ease; }
@keyframes fadeSlide { from{opacity:0;transform:translateX(-50%) translateY(-12px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

/* ── ADMIN LOGIN ── */
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bark); padding: 20px; }
.login-card { background: var(--white); border-radius: 24px; padding: 36px 28px; width: 100%; max-width: 360px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; }
.login-icon { font-size: 52px; margin-bottom: 12px; }
.login-card h1 { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 800; color: var(--bark); margin-bottom: 4px; }
.login-card p { font-size: 13px; color: var(--bark-light); margin-bottom: 28px; }
.login-card input { width: 100%; padding: 13px 16px; border: 2px solid var(--parchment); border-radius: 14px; font-family: 'DM Sans', sans-serif; font-size: 16px; color: var(--bark); background: var(--cream); outline: none; margin-bottom: 12px; transition: border-color 0.2s; }
.login-card input:focus { border-color: var(--leaf); background: var(--white); }
.login-btn { width: 100%; padding: 14px; border: none; border-radius: 14px; background: var(--bark); color: var(--cream); font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; cursor: pointer; transition: background 0.2s; }
.login-btn:hover { background: var(--bark-mid); }
.login-err { color: var(--danger); font-size: 13px; margin-top: 10px; font-weight: 500; }
.lockout-msg { background: var(--danger-pale); color: var(--danger); border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; margin-top: 10px; }

/* ── FAKE DECOY PANEL ── */
.decoy-wrap { min-height: 100vh; background: #f8f8f8; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #999; font-family: 'DM Sans', sans-serif; }
.decoy-wrap h2 { font-size: 18px; margin-bottom: 8px; }
.decoy-wrap p { font-size: 13px; }

/* ── ADMIN HEADER ── */
.ahdr { background: var(--bark); padding: 0 18px; height: 62px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 200; }
.ahdr-title { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 800; color: var(--cream); }
.ahdr-sub { font-size: 11px; color: var(--bark-light); margin-top: 1px; }
.notif-dot { background: var(--spice); color: white; border-radius: 20px; padding: 4px 10px; font-size: 12px; font-weight: 700; animation: pulse 1.5s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.65} }
.logout-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: var(--cream); border-radius: 8px; padding: 6px 12px; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; }
.logout-btn:hover { background: rgba(255,255,255,0.2); }
.atabs { display: flex; background: var(--white); border-bottom: 1.5px solid var(--parchment); }
.atab { flex: 1; padding: 13px; border: none; background: none; font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 14px; color: var(--bark-light); cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -1.5px; transition: all 0.2s; }
.atab.active { color: var(--leaf); border-bottom-color: var(--leaf); }
.acontent { padding: 16px 16px 40px; max-width: 600px; margin: 0 auto; }
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
.stat-box { background: var(--white); border-radius: var(--radius); padding: 16px; box-shadow: var(--shadow); text-align: center; border: 1.5px solid var(--parchment); }
.stat-num { font-family: 'Playfair Display', serif; font-size: 30px; font-weight: 800; color: var(--bark); }
.stat-num.green { color: var(--leaf); }
.stat-num.spice { color: var(--spice); }
.stat-lbl { font-size: 11px; color: var(--bark-light); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
.cust-block { background: var(--cream); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
.cust-name { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
.cust-row { font-size: 13px; color: var(--bark-mid); margin-bottom: 3px; display: flex; align-items: flex-start; gap: 6px; }
.map-link { display: inline-flex; align-items: center; gap: 5px; background: var(--leaf-pale); color: var(--leaf); padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; text-decoration: none; margin-top: 6px; border: 1px solid var(--leaf-light); transition: background 0.18s; }
.map-link:hover { background: var(--leaf); color: white; }
.status-sel { width: 100%; padding: 10px 13px; margin-top: 12px; border: 2px solid var(--parchment); border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; color: var(--bark); background: var(--cream); cursor: pointer; outline: none; }
.status-sel:focus { border-color: var(--leaf); background: var(--white); }
.addp-box { background: var(--white); border-radius: var(--radius); padding: 18px; margin-bottom: 16px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); }
.addp-box h3 { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; margin-bottom: 14px; }
.add-prod-btn { width: 100%; padding: 12px; border: none; border-radius: 12px; background: var(--leaf); color: white; font-family: 'DM Sans', sans-serif; font-weight: 700; font-size: 15px; cursor: pointer; margin-top: 6px; }
.add-prod-btn:hover { background: var(--leaf-light); }
.prod-list-item { background: var(--white); border-radius: 14px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); }
.pli-left { display: flex; align-items: center; gap: 10px; }
.pli-name { font-weight: 600; font-size: 14px; }
.pli-sub { font-size: 12px; color: var(--bark-light); }
.del-btn { background: var(--danger-pale); color: var(--danger); border: none; border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 700; cursor: pointer; }
.del-btn:hover { background: var(--danger); color: white; }
.edit-btn { background: #e8f2eb; color: var(--leaf); border: none; border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 700; cursor: pointer; transition: background 0.18s; }
.edit-btn:hover { background: var(--leaf); color: white; }
.edit-product-box { background: var(--leaf-pale); border: 2px solid var(--leaf-light); border-radius: var(--radius); padding: 16px; margin-bottom: 8px; }
.edit-product-title { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 700; color: var(--leaf); margin-bottom: 12px; }
.save-edit-btn { flex: 1; padding: 10px; border: none; border-radius: 10px; background: var(--leaf); color: white; font-family: 'DM Sans', sans-serif; font-weight: 700; font-size: 14px; cursor: pointer; }
.save-edit-btn:hover { background: var(--leaf-light); }
.cancel-edit-btn { padding: 10px 16px; border: 1.5px solid var(--parchment); border-radius: 10px; background: white; color: var(--bark-mid); font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 14px; cursor: pointer; }
/* ── HISTORY ── */
.history-day { background: var(--white); border-radius: var(--radius); margin-bottom: 12px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); overflow: hidden; }
.history-day-header { padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; background: var(--cream); }
.history-date { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 15px; color: var(--bark); }
.history-day-stats { font-size: 12px; color: var(--bark-light); margin-top: 2px; }
.history-day-revenue { font-family: 'Playfair Display', serif; font-weight: 800; font-size: 16px; color: var(--leaf); }
.history-chevron { font-size: 14px; color: var(--bark-light); transition: transform 0.2s; }
.history-chevron.open { transform: rotate(180deg); }
.history-orders { padding: 8px 12px 12px; }
.history-order { background: var(--cream); border-radius: 10px; padding: 12px; margin-top: 8px; }
.history-order-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.history-order-id { font-weight: 700; font-size: 13px; color: var(--bark); }
.history-order-items { font-size: 12px; color: var(--bark-light); margin-bottom: 4px; }

/* ── BARCODE ── */
.barcode-field { display: flex; gap: 8px; align-items: stretch; }
.barcode-field input { flex: 1; }
.barcode-scan-btn { padding: 0 14px; border: 1.5px solid var(--leaf); border-radius: 12px; background: var(--leaf-pale); color: var(--leaf); font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; white-space: nowrap; }
.barcode-scan-btn:hover { background: var(--leaf); color: white; }
.scanner-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
.scanner-video { width: 100%; max-width: 400px; border-radius: 16px; background: #000; }
.scanner-frame { position: relative; width: 100%; max-width: 400px; }
.scanner-reticle { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 70%; height: 80px; border: 3px solid var(--leaf-light); border-radius: 12px; box-shadow: 0 0 0 2000px rgba(0,0,0,0.3); }
.scanner-hint { color: white; font-family: 'DM Sans', sans-serif; font-size: 14px; margin-top: 20px; text-align: center; }
.scanner-close { margin-top: 20px; padding: 12px 28px; background: white; color: var(--bark); border: none; border-radius: 12px; font-family: 'DM Sans', sans-serif; font-weight: 700; font-size: 15px; cursor: pointer; }
.scanner-manual { margin-top: 14px; color: var(--leaf-light); font-size: 13px; background: none; border: none; cursor: pointer; text-decoration: underline; }

/* ── EXTRA CHARGES ── */
.charge-card { background: var(--white); border-radius: 14px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); }
.charge-card.active-charge { border-color: var(--leaf); background: var(--leaf-pale); }
.charge-info { flex: 1; }
.charge-name { font-weight: 600; font-size: 14px; color: var(--bark); }
.charge-price { font-size: 13px; color: var(--leaf); font-weight: 700; margin-top: 2px; }
.charge-actions { display: flex; align-items: center; gap: 8px; }
.charge-del { background: var(--danger-pale); color: var(--danger); border: none; border-radius: 8px; padding: 6px 9px; font-size: 12px; font-weight: 700; cursor: pointer; }
.add-charge-box { background: var(--white); border-radius: var(--radius); padding: 16px; margin-bottom: 16px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); }
.add-charge-box h3 { font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 700; margin-bottom: 12px; }
.charge-input-row { display: flex; gap: 8px; }
.charge-input-row input { flex: 1; padding: 10px 12px; border: 1.5px solid var(--parchment); border-radius: 10px; font-family: 'DM Sans', sans-serif; font-size: 14px; background: var(--cream); outline: none; }
.charge-input-row input:focus { border-color: var(--leaf); background: white; }
.charge-add-btn { padding: 10px 16px; border: none; border-radius: 10px; background: var(--leaf); color: white; font-family: 'DM Sans', sans-serif; font-weight: 700; font-size: 14px; cursor: pointer; white-space: nowrap; }
.charge-row-bill { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 8px; color: var(--spice); }

/* ── THERMAL PRINT ── */
.print-btn { width: 100%; margin-top: 10px; padding: 10px; border: 1.5px dashed var(--bark-mid); border-radius: 10px; background: transparent; color: var(--bark-mid); font-family: 'DM Sans', sans-serif; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.18s; }
.print-btn:hover { background: var(--bark); color: white; border-style: solid; }

@media print {
  body * { visibility: hidden !important; }
  #thermal-receipt, #thermal-receipt * { visibility: visible !important; }
  #thermal-receipt { position: fixed !important; left: 0 !important; top: 0 !important; width: 80mm !important; margin: 0 !important; padding: 0 !important; }
}

#thermal-receipt {
  display: none;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  width: 80mm;
  color: #000;
  background: #fff;
  padding: 4mm;
}
.tr-center { text-align: center; }
.tr-bold { font-weight: bold; }
.tr-big { font-size: 16px; font-weight: bold; }
.tr-divider { border: none; border-top: 1px dashed #000; margin: 4px 0; }
.tr-row { display: flex; justify-content: space-between; margin: 2px 0; }
.tr-row-item { display: flex; justify-content: space-between; margin: 2px 0; font-size: 11px; }
.tr-small { font-size: 10px; color: #444; }
.tr-total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; margin-top: 4px; }

.customers-tab-grid { display: flex; flex-direction: column; gap: 10px; }
.customer-card { background: var(--white); border-radius: var(--radius); padding: 16px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); }
.customer-card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
.customer-name-big { font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 700; color: var(--bark); }
.customer-phone { font-size: 13px; color: var(--bark-mid); margin-top: 2px; }
.customer-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.customer-stat-pill { background: var(--cream); border-radius: 8px; padding: 4px 10px; font-size: 12px; font-weight: 600; color: var(--bark-mid); }
.customer-stat-pill.green { background: var(--leaf-pale); color: var(--leaf); }
.customer-address { font-size: 12px; color: var(--bark-light); margin-top: 8px; display: flex; gap: 5px; align-items: flex-start; }
.notif-permission-bar { background: #fff3e0; border: 1.5px solid #ffb74d; border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.notif-permission-bar p { font-size: 13px; color: var(--bark-mid); font-weight: 500; flex: 1; }
.notif-enable-btn { background: var(--spice); color: white; border: none; border-radius: 8px; padding: 7px 14px; font-family: 'DM Sans', sans-serif; font-weight: 700; font-size: 13px; cursor: pointer; white-space: nowrap; }
.store-toggle-card { background: var(--white); border-radius: var(--radius); padding: 16px 18px; margin-bottom: 18px; border: 1.5px solid var(--parchment); box-shadow: var(--shadow); display: flex; align-items: center; justify-content: space-between; }
.store-toggle-card.open { border-color: var(--leaf); background: var(--leaf-pale); }
.store-toggle-card.closed { border-color: var(--danger); background: var(--danger-pale); }
.toggle-label { font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 700; }
.toggle-label.open { color: var(--leaf); }
.toggle-label.closed { color: var(--danger); }
.toggle-sub { font-size: 12px; color: var(--bark-light); margin-top: 2px; }
.toggle-switch { position: relative; width: 54px; height: 30px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; cursor: pointer; inset: 0; background: #ccc; border-radius: 30px; transition: 0.3s; }
.toggle-slider:before { content: ""; position: absolute; width: 22px; height: 22px; left: 4px; bottom: 4px; background: white; border-radius: 50%; transition: 0.3s; }
input:checked + .toggle-slider { background: var(--leaf); }
input:checked + .toggle-slider:before { transform: translateX(24px); }
.store-closed-banner { background: var(--danger); color: white; text-align: center; padding: 14px 16px; font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 700; }
.store-closed-checkout { background: var(--danger-pale); border: 2px solid var(--danger); border-radius: var(--radius); padding: 24px; text-align: center; margin-top: 14px; }
.store-closed-checkout .closed-ico { font-size: 48px; margin-bottom: 10px; }
.store-closed-checkout h3 { font-family: 'Playfair Display', serif; font-size: 18px; color: var(--danger); margin-bottom: 6px; }
.store-closed-checkout p { font-size: 13px; color: var(--bark-light); }
`;
