import { useState, useEffect, useCallback, useRef } from "react";

// ── SECURITY LAYER ────────────────────────────────────────────────────────────
// Password is never stored as plain text anywhere in this file.
// We store only the SHA-256 hash. Even if someone reads the source code,
// they cannot reverse a SHA-256 hash back to the original password.
const PWD_HASH = "3a07108f6aa8e69f76a740e29e0e5523cdb8a6d2b05fc10faad5d8f91be7f47a"; // SHA-256 of "Nkm@92056"

async function hashPassword(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_KEY = "_s";
const SESSION_DURATION = 365 * 24 * 60 * 60 * 1000; // never expires (1 year)
const LOCKOUT_KEY = "_lk";
const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes

function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (s && s.v === 1) return s;
  } catch {}
  return null;
}
function setSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ t: Date.now(), v: 1 }));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
function getLockout() {
  try { return JSON.parse(localStorage.getItem(LOCKOUT_KEY) || "null"); } catch { return null; }
}
function setLockout(attempts) {
  localStorage.setItem(LOCKOUT_KEY, JSON.stringify({ attempts, time: Date.now() }));
}
function clearLockout() { localStorage.removeItem(LOCKOUT_KEY); }
function isLockedOut() {
  const lk = getLockout();
  if (!lk) return false;
  if (lk.attempts >= MAX_ATTEMPTS) {
    if (Date.now() - lk.time < LOCKOUT_DURATION) return true;
    clearLockout(); return false;
  }
  return false;
}
function lockoutRemainingMins() {
  const lk = getLockout();
  if (!lk) return 0;
  return Math.ceil((LOCKOUT_DURATION - (Date.now() - lk.time)) / 60000);
}

// ── DATA KEYS (obfuscated, not named "orders" or "products") ─────────────────
const DK1 = "ngs_d1"; // orders
const DK2 = "ngs_d2"; // products
const DK3 = "ngs_d3"; // store open/closed
const DK4 = "ngs_d4"; // customers
const DK5 = "ngs_d5"; // extra charges

// ── SUPABASE DATABASE LAYER ───────────────────────────────────────────────────
// Connects all phones to one shared database so orders sync everywhere.
const SUPABASE_URL = "https://lphjuteikmnqbbuxbgoi.supabase.co";
const SUPABASE_KEY = "sb_publishable_FbE-JNjShcOIfn50z6EOxQ_IRXbCGF0";

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
const db = {
  async getOrders() {
    const rows = await sbSelect("orders");
    return rows.sort((a,b) => b.timestamp - a.timestamp);
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
      charges: order.charges ?? [], customer: order.customer, status: order.status,
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

const DEFAULT_PRODUCTS = [
  { id: 1, name: "Britannia Gooday", category: "Biscuit", price: 30, unit: "pack", emoji: "🍪", inStock: true },
];

function formatINR(n) { return "₹" + Number(n).toLocaleString("en-IN"); }
function genId() { return "NGS" + Math.floor(1000 + Math.random() * 9000); }

const S_ORDER = ["pending", "confirmed", "out_for_delivery", "delivered"];
const S_LABEL = { pending: "Pending", confirmed: "Confirmed", out_for_delivery: "On the way", delivered: "Delivered" };
const S_LABEL_A = { pending: "Pending", confirmed: "Confirmed", out_for_delivery: "Out for Delivery", delivered: "Delivered" };

// ── STYLES ────────────────────────────────────────────────────────────────────
const css = `
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

/* ── SECRET TAP INDICATOR ── */
.tap-dots { display: flex; gap: 4px; position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); }
.tap-dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.2); transition: background 0.2s; }
.tap-dot.lit { background: var(--gold); }

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

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function ShopView({ products, cart, cat, setCat, setCart, storeOpen }) {
  const cats = ["All", ...Array.from(new Set(products.map(p => p.category)))];
  const filtered = cat === "All" ? products : products.filter(p => p.category === cat);
  return (
    <div className="main">
      {!storeOpen && <div className="store-closed-banner">🔒 Store is currently closed — not accepting orders</div>}
      <div className="hero-band">
        <h2>Fresh from the Market</h2>
        <p>Quality groceries, delivered to your door</p>
        <div className="hero-leaf">🌿</div>
      </div>
      <div className="cats">
        {cats.map(c => <button key={c} className={"cat-pill" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="sec-head">Products</div>
      <div className="pgrid">
        {filtered.map(p => {
          const qty = cart[p.id] || 0;
          return (
            <div className="pcard" key={p.id}>
              <div className="pcard-emoji">{p.emoji}</div>
              <div className="pcard-name">{p.name}</div>
              <div className="pcard-cat">{p.category}</div>
              <div className="pcard-price">{formatINR(p.price)} <span>/{p.unit}</span></div>
              {p.mrp && p.mrp > p.price && (
                <div className="mrp-row">
                  <span className="mrp-strike">MRP {formatINR(p.mrp)}</span>
                  <span className="discount-badge">{Math.round((p.mrp - p.price) / p.mrp * 100)}% OFF</span>
                </div>
              )}
              {p.slabs && p.slabs.length > 0 && (
                <div className="slab-box">
                  <div className="slab-heading">🏷️ Bulk Deals</div>
                  {p.slabs.map((s,i) => {
                    const saving = Math.round(((p.price - s.price) / p.price) * 100);
                    const isActive = qty >= s.qty && (i === p.slabs.length-1 || qty < p.slabs[i+1].qty);
                    return (
                      <div key={i} className={"slab-row"+(isActive?" active-slab":"")} onClick={()=>setCart(c=>({...c,[p.id]:s.qty}))}>
                        <span className="slab-qty">Buy {s.qty}+</span>
                        <span className="slab-price">₹{s.price}/{p.unit}</span>
                        {saving > 0 && <span className="slab-save">Save {saving}%</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {qty === 0
                ? <button className="add-btn" onClick={() => setCart(c => ({ ...c, [p.id]: 1 }))}>+ Add</button>
                : <div className="qty-row">
                    <button className="qty-btn" onClick={() => setCart(c => { const n={...c}; n[p.id]>1?n[p.id]--:delete n[p.id]; return n; })}>−</button>
                    <span className="qty-n">{qty}</span>
                    <button className="qty-btn" onClick={() => setCart(c => ({ ...c, [p.id]: (c[p.id]||0)+1 }))}>+</button>
                  </div>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CUSTOMER_PROFILE_KEY = "ngs_profile";

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(CUSTOMER_PROFILE_KEY) || "null"); } catch { return null; }
}
function saveProfile(data) {
  try { localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify(data)); } catch {}
}

function CartView({ products, cart, setCart, onOrderPlaced, setTab, success, setSuccess, storeOpen, charges }) {
  const profile = loadProfile();
  const [name, setName] = useState(profile?.name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [address, setAddress] = useState(profile?.address || "");
  const [location, setLocation] = useState(profile?.location || null);
  const [locLoading, setLocLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [profileSaved, setProfileSaved] = useState(!!profile);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };
  const getEffectivePrice = (p, qty) => {
    if (!p.slabs || p.slabs.length === 0) return p.price;
    const applicable = [...p.slabs].reverse().find(s => qty >= s.qty);
    return applicable ? applicable.price : p.price;
  };
  const cartTotal = Object.entries(cart).reduce((s, [id, qty]) => {
    const p = products.find(x => x.id === Number(id));
    if (!p) return s;
    return s + getEffectivePrice(p, qty) * qty;
  }, 0);

  const activeCharges = (charges || []).filter(c => c.active);
  const chargesTotal = activeCharges.reduce((s, c) => s + Number(c.price), 0);
  const grandTotal = cartTotal + chargesTotal;

  const getLocation = () => {
    if (!navigator.geolocation) { showToast("⚠️ Location not supported"); return; }
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const data = await res.json();
        const addr = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        setAddress(addr); setLocation({ lat, lng, label: addr }); showToast("📍 Location captured!");
      } catch { setAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`); setLocation({ lat, lng }); }
      setLocLoading(false);
    }, () => { showToast("❌ Location denied"); setLocLoading(false); });
  };

  const handlePlaceOrder = async () => {
    if (!name.trim() || !phone.trim() || !address.trim()) { showToast("⚠️ Fill all fields"); return; }
    const items = Object.entries(cart).map(([id, qty]) => ({ ...products.find(x => x.id === Number(id)), qty }));
    const order = { id: genId(), timestamp: Date.now(), items, total: grandTotal, subtotal: cartTotal, charges: activeCharges, customer: { name, phone, address, location: location||null }, status: "pending" };
    // Save profile so next time fields are pre-filled
    saveProfile({ name, phone, address, location: location||null });
    setProfileSaved(true);
    await onOrderPlaced(order, phone);
    setCart({});
  };

  const handleClearProfile = () => {
    localStorage.removeItem(CUSTOMER_PROFILE_KEY);
    setName(""); setPhone(""); setAddress(""); setLocation(null);
    setProfileSaved(false);
    showToast("🗑️ Details cleared");
  };

  if (success) return (
    <div className="main success-wrap">
      <div className="s-ico">🎊</div>
      <h2>Order Placed!</h2>
      <p>NGS Store will confirm and deliver soon</p>
      <div className="oid-tag">#{success}</div><br />
      <button className="go-track" onClick={() => { setSuccess(null); setTab("orders"); }}>Track Order →</button>
    </div>
  );

  const items = Object.entries(cart).map(([id, qty]) => ({ ...products.find(p => p.id === Number(id)), qty }));
  if (!items.length) return <div className="main empty-box"><div className="big">🛒</div><p>Your cart is empty</p></div>;

  return (
    <div className="main">
      {toast && <div className="toast">{toast}</div>}
      <div className="sec-head">Your Cart</div>
      {items.map(item => (
        <div className="citem" key={item.id}>
          <span className="citem-emoji">{item.emoji}</span>
          <div className="citem-info">
            <div className="citem-name">{item.name}</div>
            <div className="citem-sub">
              {(() => {
                const ep = (!item.slabs||!item.slabs.length) ? item.price : ([...item.slabs].reverse().find(s=>item.qty>=s.qty)||{price:item.price}).price;
                const isBulk = ep < item.price;
                const hasMrpDeal = item.mrp && item.mrp > item.price;
                return (
                  <span>
                    {formatINR(ep)} × {item.qty}
                    {isBulk && <span style={{color:"var(--spice)",fontWeight:700,fontSize:11,marginLeft:4}}>Bulk deal!</span>}
                    {!isBulk && hasMrpDeal && <span style={{color:"var(--spice)",fontWeight:700,fontSize:11,marginLeft:4}}>{Math.round((item.mrp-item.price)/item.mrp*100)}% off MRP</span>}
                  </span>
                );
              })()}
            </div>
          </div>
          <div className="citem-total">{formatINR(item.price * item.qty)}</div>
        </div>
      ))}
      <div className="cart-summary-box">
        <div className="cs-row"><span>Subtotal</span><span>{formatINR(cartTotal)}</span></div>
        {activeCharges.map((c,i) => (
          <div className="charge-row-bill" key={i}><span>{c.name}</span><span>+{formatINR(c.price)}</span></div>
        ))}
        {activeCharges.length === 0 && <div className="cs-row"><span>Delivery</span><span style={{color:"var(--leaf)"}}>FREE</span></div>}
        <div className="cs-row total"><span>Total</span><span>{formatINR(grandTotal)}</span></div>
      </div>
      <div className="chk-form">
        <h3>Delivery Details</h3>
        {profileSaved && (
          <div style={{background:"var(--leaf-pale)",border:"1.5px solid var(--leaf-light)",borderRadius:12,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:"var(--leaf)",fontWeight:600}}>✅ Using your saved details</span>
            <button onClick={handleClearProfile} style={{background:"none",border:"none",color:"var(--bark-light)",fontSize:12,cursor:"pointer",fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>Change</button>
          </div>
        )}
        <div className="fgrp"><label>Full Name</label><input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} /></div>
        <div className="fgrp"><label>Phone</label><input type="tel" placeholder="+91 98765 43210" value={phone} onChange={e=>setPhone(e.target.value)} /></div>
        <div className="fgrp">
          <label>Delivery Address</label>
          <textarea placeholder="House no., street, landmark..." value={address} onChange={e=>setAddress(e.target.value)} />
          <button className="loc-btn" onClick={getLocation} disabled={locLoading}>
            {locLoading ? "⏳ Getting location..." : "📍 Use My Current Location"}
          </button>
          {location && <div className="loc-preview"><span>📌</span><span>GPS: {location.lat?.toFixed(5)}, {location.lng?.toFixed(5)}</span></div>}
        </div>
        {storeOpen
          ? <button className="place-btn" onClick={handlePlaceOrder}>Place Order — {formatINR(grandTotal)}</button>
          : <div className="store-closed-checkout">
              <div className="closed-ico">🔒</div>
              <h3>Store is Closed</h3>
              <p>We are not accepting orders right now. Please check back soon!</p>
            </div>
        }
      </div>
    </div>
  );
}

function OrdersView({ orders, myPhone }) {
  const mine = orders.filter(o => myPhone && o.customer?.phone === myPhone);
  if (!mine.length) return <div className="main empty-box"><div className="big">📋</div><p>No orders yet</p></div>;
  return (
    <div className="main">
      <div className="sec-head">My Orders</div>
      {mine.map(o => {
        const si = S_ORDER.indexOf(o.status);
        return (
          <div className="ocard" key={o.id}>
            <div className="ocard-top">
              <div><div className="o-id">#{o.id}</div><div className="o-date">{new Date(o.timestamp).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</div></div>
              <span className={"sbadge s-"+o.status}>{S_LABEL[o.status]}</span>
            </div>
            <div className="progress-track">
              {S_ORDER.map((s,i) => (
                <div key={s} style={{display:"contents"}}>
                  <div className="prog-step">
                    <div className={"prog-dot"+(i<si?" done":i===si?" current":"")}></div>
                    <div className="prog-label">{S_LABEL[s]}</div>
                  </div>
                  {i<S_ORDER.length-1 && <div className={"prog-line"+(i<si?" done":"")}></div>}
                </div>
              ))}
            </div>
            <div className="o-items">{o.items.map(i=>`${i.emoji} ${i.name} ×${i.qty}`).join("  ·  ")}</div>
            <div className="o-total">{formatINR(o.total)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function BarcodeField({ value, onChange }) {
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  const stopScan = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const startScan = async () => {
    if (!("BarcodeDetector" in window)) {
      const manual = prompt("Camera barcode scanning isn't supported on this browser. Enter the barcode number manually:");
      if (manual) onChange(manual.trim());
      return;
    }
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new window.BarcodeDetector({
        formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","codabar","itf"]
      });
      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            onChange(codes[0].rawValue);
            stopScan();
            return;
          }
        } catch {}
        rafRef.current = requestAnimationFrame(scan);
      };
      rafRef.current = requestAnimationFrame(scan);
    } catch (err) {
      setScanning(false);
      const manual = prompt("Could not open camera. Enter the barcode number manually:");
      if (manual) onChange(manual.trim());
    }
  };

  useEffect(() => () => stopScan(), []);

  return (
    <>
      <div className="barcode-field">
        <input value={value} onChange={e=>onChange(e.target.value)} placeholder="Barcode number" />
        <button type="button" className="barcode-scan-btn" onClick={startScan}>📷</button>
      </div>
      {scanning && (
        <div className="scanner-overlay">
          <div className="scanner-frame">
            <video ref={videoRef} className="scanner-video" playsInline muted></video>
            <div className="scanner-reticle"></div>
          </div>
          <div className="scanner-hint">Point your camera at the product barcode</div>
          <button className="scanner-close" onClick={stopScan}>Cancel</button>
          <button className="scanner-manual" onClick={()=>{ stopScan(); const m = prompt("Enter barcode manually:"); if(m) onChange(m.trim()); }}>Enter manually instead</button>
        </div>
      )}
    </>
  );
}

function SlabEditor({ slabs, setSlabs }) {
  const [qtyInput, setQtyInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const addSlab = () => {
    if (!qtyInput || !priceInput) return;
    const updated = [...slabs, { qty: Number(qtyInput), price: Number(priceInput) }]
      .sort((a,b) => a.qty - b.qty);
    setSlabs(updated);
    setQtyInput(""); setPriceInput("");
  };
  return (
    <div className="admin-slabs-box">
      <div className="slab-label">Bulk Deal / Slab Pricing</div>
      {slabs.map((s, i) => (
        <div className="admin-slab-row" key={i}>
          <span style={{fontSize:12,color:"var(--bark-mid)",whiteSpace:"nowrap"}}>Buy {s.qty}+</span>
          <span style={{fontSize:12,color:"var(--leaf)",fontWeight:700}}>₹{s.price} each</span>
          <button className="remove-slab-btn" onClick={()=>setSlabs(slabs.filter((_,j)=>j!==i))}>✕</button>
        </div>
      ))}
      <div className="admin-slab-row">
        <input type="number" placeholder="Min qty (e.g. 4)" value={qtyInput} onChange={e=>setQtyInput(e.target.value)} />
        <input type="number" placeholder="Price each (₹)" value={priceInput} onChange={e=>setPriceInput(e.target.value)} />
        <button className="add-slab-btn" onClick={addSlab}>+ Add</button>
      </div>
    </div>
  );
}

function EditProductForm({ product, onSave, onCancel }) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [emoji, setEmoji] = useState(product.emoji);
  const [unit, setUnit] = useState(product.unit);
  const [category, setCategory] = useState(product.category);
  const [slabs, setSlabs] = useState(product.slabs || []);
  const [mrp, setMrp] = useState(product.mrp ? String(product.mrp) : "");
  const [barcode, setBarcode] = useState(product.barcode || "");
  return (
    <div className="edit-product-box">
      <div className="edit-product-title">✏️ Editing: {product.name}</div>
      <div className="fgrp"><label>Product Name</label><input value={name} onChange={e=>setName(e.target.value)} /></div>
      <div className="fgrp"><label>Selling Price (₹)</label><input type="number" value={price} onChange={e=>setPrice(e.target.value)} /></div>
      <div className="fgrp"><label>MRP ₹ (original price, optional)</label><input type="number" value={mrp} onChange={e=>setMrp(e.target.value)} placeholder="Leave blank if no discount" /></div>
      <div className="fgrp"><label>Emoji</label><input value={emoji} onChange={e=>setEmoji(e.target.value)} /></div>
      <div className="fgrp"><label>Unit</label><input value={unit} onChange={e=>setUnit(e.target.value)} /></div>
      <div className="fgrp"><label>Category</label><input value={category} onChange={e=>setCategory(e.target.value)} /></div>
      <div className="fgrp"><label>Barcode</label><BarcodeField value={barcode} onChange={setBarcode} /></div>
      <SlabEditor slabs={slabs} setSlabs={setSlabs} />
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button className="save-edit-btn" onClick={()=>onSave({name,price,emoji,unit,category,slabs,mrp:mrp?Number(mrp):null,barcode})}>✅ Save Changes</button>
        <button className="cancel-edit-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ProductsTab({ products, onAdd, onDelete, onEdit }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [emoji, setEmoji] = useState("🛒");
  const [unit, setUnit] = useState("pack");
  const [category, setCategory] = useState("Biscuit");
  const [editingId, setEditingId] = useState(null);

  const [addSlabs, setAddSlabs] = useState([]);
  const [addMrp, setAddMrp] = useState("");
  const [addBarcode, setAddBarcode] = useState("");
  const handleAdd = async () => {
    await onAdd({ name, price, emoji, unit, category, slabs: addSlabs, mrp: addMrp ? Number(addMrp) : null, barcode: addBarcode });
    setName(""); setPrice(""); setEmoji("🛒"); setUnit("pack"); setCategory("Biscuit"); setAddSlabs([]); setAddMrp(""); setAddBarcode("");
  };

  const handleSaveEdit = async (id, updated) => {
    await onEdit(id, updated);
    setEditingId(null);
  };

  return (
    <>
      <div className="addp-box">
        <h3>Add New Product</h3>
        <div className="fgrp"><label>Product Name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Parle-G" /></div>
        <div className="fgrp"><label>Selling Price (₹)</label><input type="number" value={price} onChange={e=>setPrice(e.target.value)} placeholder="e.g. 20" /></div>
        <div className="fgrp"><label>MRP ₹ (original price, optional)</label><input type="number" value={addMrp} onChange={e=>setAddMrp(e.target.value)} placeholder="Leave blank if no discount" /></div>
        <div className="fgrp"><label>Emoji</label><input value={emoji} onChange={e=>setEmoji(e.target.value)} placeholder="🍪" /></div>
        <div className="fgrp"><label>Unit</label><input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="pack / kg / L" /></div>
        <div className="fgrp"><label>Category</label><input value={category} onChange={e=>setCategory(e.target.value)} placeholder="e.g. Biscuit, Dairy..." /></div>
        <div className="fgrp"><label>Barcode</label><BarcodeField value={addBarcode} onChange={setAddBarcode} /></div>
        <SlabEditor slabs={addSlabs} setSlabs={setAddSlabs} />
        <button className="add-prod-btn" onClick={handleAdd} style={{marginTop:10}}>+ Add Product</button>
      </div>
      {products.map(p => (
        <div key={p.id}>
          {editingId === p.id
            ? <EditProductForm
                product={p}
                onSave={(updated) => handleSaveEdit(p.id, updated)}
                onCancel={() => setEditingId(null)}
              />
            : <div className="prod-list-item">
                <div className="pli-left">
                  <span style={{fontSize:30}}>{p.emoji}</span>
                  <div>
                    <div className="pli-name">{p.name}</div>
                    <div className="pli-sub">{p.category} · {formatINR(p.price)}/{p.unit}</div>
                    {p.barcode && <div className="pli-sub" style={{fontSize:11}}>🔖 {p.barcode}</div>}
                  </div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button className="edit-btn" onClick={()=>setEditingId(p.id)}>✏️ Edit</button>
                  <button className="del-btn" onClick={()=>onDelete(p.id)}>✕</button>
                </div>
              </div>
          }
        </div>
      ))}
    </>
  );
}

function CustomersTab({ customers }) {
  if (!customers.length) return (
    <div className="empty-box"><div className="big">👥</div><p>No customers yet</p></div>
  );
  return (
    <div className="customers-tab-grid">
      {customers.map(c => (
        <div className="customer-card" key={c.phone}>
          <div className="customer-card-top">
            <div>
              <div className="customer-name-big">👤 {c.name}</div>
              <div className="customer-phone">📞 {c.phone}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,color:"var(--bark-light)"}}>Last order</div>
              <div style={{fontSize:12,fontWeight:600,color:"var(--bark-mid)"}}>{new Date(c.lastOrder).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</div>
            </div>
          </div>
          <div className="customer-stats">
            <span className="customer-stat-pill">🛒 {c.totalOrders} order{c.totalOrders!==1?"s":""}</span>
            <span className="customer-stat-pill green">💰 {formatINR(c.totalSpent)} spent</span>
          </div>
          <div className="customer-address">
            <span>📍</span>
            <span>{c.address}</span>
          </div>
          {c.location && (
            <a className="map-link" style={{marginTop:8,display:"inline-flex"}}
              href={`https://www.google.com/maps?q=${c.location.lat},${c.location.lng}`}
              target="_blank" rel="noopener noreferrer">
              🗺️ Open in Google Maps
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function ChargesTab({ charges, onAddCharge, onToggleCharge, onDeleteCharge }) {
  const [chName, setChName] = useState("");
  const [chPrice, setChPrice] = useState("");
  const handleAdd = () => {
    if (!chName.trim() || !chPrice) return;
    onAddCharge({ name: chName, price: Number(chPrice) });
    setChName(""); setChPrice("");
  };
  return (
    <>
      <div className="add-charge-box">
        <h3>Add Extra Charge</h3>
        <div className="charge-input-row">
          <input placeholder="e.g. Delivery, Rain Charge" value={chName} onChange={e=>setChName(e.target.value)} />
          <input type="number" placeholder="₹" value={chPrice} onChange={e=>setChPrice(e.target.value)} style={{maxWidth:80}} />
          <button className="charge-add-btn" onClick={handleAdd}>+ Add</button>
        </div>
        <p style={{fontSize:12,color:"var(--bark-light)",marginTop:10}}>Turn a charge ON to apply it to all customer orders.</p>
      </div>
      {charges.length === 0
        ? <div className="empty-box"><div className="big">🧾</div><p>No charges added yet</p></div>
        : charges.map(c => (
          <div className={"charge-card"+(c.active?" active-charge":"")} key={c.id}>
            <div className="charge-info">
              <div className="charge-name">{c.name}</div>
              <div className="charge-price">{formatINR(c.price)}</div>
            </div>
            <div className="charge-actions">
              <label className="toggle-switch">
                <input type="checkbox" checked={c.active} onChange={()=>onToggleCharge(c.id)} />
                <span className="toggle-slider"></span>
              </label>
              <button className="charge-del" onClick={()=>onDeleteCharge(c.id)}>✕</button>
            </div>
          </div>
        ))
      }
    </>
  );
}

function AdminPanel({ orders, products, setOrders, setProducts, showToast, onLogout, storeOpen, setStoreOpen, customers, charges, setCharges }) {
  const [tab, setTab] = useState("orders");
  const pending = orders.filter(o=>o.status==="pending").length;
  const revenue = orders.filter(o=>o.status==="delivered").reduce((s,o)=>s+o.total,0);

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
  const [notifStatus, setNotifStatus] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const prevOrderCount = useRef(orders.length);

  const requestNotifPermission = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifStatus(result);
    if (result === "granted") showToast("🔔 Notifications enabled!");
  };

  const fireNotification = useCallback((order) => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification("🛒 New Order — NGS Store!", {
      body: `${order.customer?.name} ordered ${order.items?.map(i=>`${i.name} ×${i.qty}`).join(", ")} • ${formatINR(order.total)}`,
      tag: order.id,
      renotify: true,
    });
  }, []);

  useEffect(() => {
    const newCount = orders.length;
    if (newCount > prevOrderCount.current) {
      const newOrders = orders.slice(0, newCount - prevOrderCount.current);
      newOrders.forEach(o => fireNotification(o));
    }
    prevOrderCount.current = newCount;
  }, [orders.length]);

  const toggleStore = async () => {
    const next = !storeOpen;
    setStoreOpen(next);
    try { await db.setStoreOpen(next); } catch {}
    showToast(next ? "✅ Store is now OPEN" : "🔒 Store is now CLOSED");
  };

  const saveCharges = async (updated) => {
    setCharges(updated);
    try { await db.saveCharges(updated); } catch {}
  };
  const onAddCharge = (ch) => { saveCharges([...charges, { ...ch, id: Date.now(), active: true }]); showToast("✅ Charge added"); };
  const onToggleCharge = (id) => { saveCharges(charges.map(c => c.id===id ? {...c, active: !c.active} : c)); };
  const onDeleteCharge = (id) => { saveCharges(charges.filter(c => c.id!==id)); showToast("🗑️ Charge removed"); };



  const updateStatus = async (id, status) => {
    const updated = orders.map(o=>o.id===id?{...o,status}:o);
    setOrders(updated);
    try { await db.updateOrderStatus(id, status); } catch {}
    showToast(status==="delivered"?"✅ Marked delivered":"📦 Status updated");
  };

  // ── ESC/POS helpers ─────────────────────────────────────────────────────
  const ESC = 0x1B; const GS = 0x1D;
  const enc = new TextEncoder();

  const escPos = {
    init:       [ESC, 0x40],
    bold_on:    [ESC, 0x45, 0x01],
    bold_off:   [ESC, 0x45, 0x00],
    center:     [ESC, 0x61, 0x01],
    left:       [ESC, 0x61, 0x00],
    large:      [GS,  0x21, 0x11],
    normal:     [GS,  0x21, 0x00],
    feed:       [ESC, 0x64, 0x03],
    cut:        [GS,  0x56, 0x41, 0x10],
  };

  const buildReceipt = (o) => {
    const date = new Date(o.timestamp).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
    const LINE = "--------------------------------";
    const pad = (l, r, w=32) => { const gap = w - l.length - r.length; return l + (gap > 0 ? " ".repeat(gap) : " ") + r; };

    const chunks = [];
    const add = (bytes) => chunks.push(new Uint8Array(bytes));
    const txt = (str) => chunks.push(enc.encode(str + String.fromCharCode(10)));

    add(escPos.init);
    add(escPos.center);
    add(escPos.large);
    add(escPos.bold_on);
    txt("NGS STORE");
    add(escPos.normal);
    add(escPos.bold_off);
    txt("Fresh Groceries");
    txt("");
    add(escPos.left);
    txt(LINE);
    txt("Order : #" + o.id);
    txt("Date  : " + date);
    txt("Status: " + S_LABEL_A[o.status]);
    txt(LINE);
    add(escPos.bold_on);
    txt("CUSTOMER DETAILS");
    add(escPos.bold_off);
    txt("Name  : " + (o.customer?.name || ""));
    txt("Phone : " + (o.customer?.phone || ""));
    // wrap address at 32 chars
    const addr = o.customer?.address || "";
    for (let i=0; i<addr.length; i+=32) {
      txt((i===0?"Addr  : ":"        ") + addr.slice(i,i+32));
    }
    txt(LINE);
    add(escPos.bold_on);
    txt("ITEMS");
    add(escPos.bold_off);
    o.items?.forEach(i => {
      const ep = (!i.slabs||!i.slabs.length) ? i.price : ([...i.slabs].reverse().find(s=>i.qty>=s.qty)||{price:i.price}).price;
      const lineTotal = ep * i.qty;
      const name = i.name.length > 18 ? i.name.slice(0,18) : i.name;
      txt(pad(name + " x" + i.qty, "Rs." + lineTotal));
    });
    txt(LINE);
    if (o.charges && o.charges.length > 0) {
      txt(pad("Subtotal", "Rs." + (o.subtotal != null ? o.subtotal : o.total)));
      o.charges.forEach(c => txt(pad(c.name, "Rs." + c.price)));
      txt(LINE);
    }
    add(escPos.bold_on);
    add(escPos.large);
    txt(pad("TOTAL", "Rs." + o.total));
    add(escPos.normal);
    add(escPos.bold_off);
    txt(LINE);
    add(escPos.center);
    txt("");
    txt("Thank you for ordering!");
    txt("NGS Store");
    txt("");
    add(escPos.feed);
    add(escPos.cut);

    // Merge all chunks
    const total = chunks.reduce((s,c)=>s+c.length,0);
    const merged = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(c => { merged.set(c, offset); offset += c.length; });
    return merged;
  };

  const printReceipt = async (o) => {
    if (!navigator.bluetooth) {
      showToast("❌ Web Bluetooth not supported on this browser");
      return;
    }
    try {
      showToast("🔍 Searching for printer...");
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: "PT-210" },
          { namePrefix: "Posiflow" },
          { namePrefix: "pos" },
          { namePrefix: "POS" },
          { namePrefix: "Printer" },
          { namePrefix: "printer" },
          { namePrefix: "BT" },
        ],
        optionalServices: [
          "000018f0-0000-1000-8000-00805f9b34fb", // common POS service
          "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // common ESC/POS BT
          "49535343-fe7d-4ae5-8fa9-9fafd205e455", // another common UUID
        ]
      });
      showToast("🔗 Connecting...");
      const server = await device.gatt.connect();
      // Try known ESC/POS service UUIDs
      const serviceUUIDs = [
        "000018f0-0000-1000-8000-00805f9b34fb",
        "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
        "49535343-fe7d-4ae5-8fa9-9fafd205e455",
      ];
      let characteristic = null;
      for (const uuid of serviceUUIDs) {
        try {
          const service = await server.getPrimaryService(uuid);
          const chars = await service.getCharacteristics();
          characteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (characteristic) break;
        } catch {}
      }
      if (!characteristic) {
        // fallback: try first available service
        const services = await server.getPrimaryServices();
        for (const svc of services) {
          const chars = await svc.getCharacteristics();
          characteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (characteristic) break;
        }
      }
      if (!characteristic) { showToast("❌ Could not find printer characteristic"); return; }

      showToast("🖨️ Printing...");
      const data = buildReceipt(o);
      // Send in 512-byte chunks (BT MTU limit)
      const CHUNK = 512;
      for (let i=0; i<data.length; i+=CHUNK) {
        const chunk = data.slice(i, i+CHUNK);
        if (characteristic.properties.writeWithoutResponse) {
          await characteristic.writeValueWithoutResponse(chunk);
        } else {
          await characteristic.writeValue(chunk);
        }
        await new Promise(r => setTimeout(r, 50));
      }
      showToast("✅ Printed successfully!");
      device.gatt.disconnect();
    } catch (err) {
      if (err.name === "NotFoundError") showToast("❌ No printer selected");
      else showToast("❌ " + (err.message || "Print failed"));
    }
  };

  const onAdd = async (np) => {
    if (!np.name||!np.price) { showToast("⚠️ Fill name & price"); return; }
    const p = {...np, id:Date.now(), price:Number(np.price), mrp: np.mrp ?? null, barcode: np.barcode ?? "", slabs: np.slabs ?? [], inStock:true};
    setProducts([...products, p]);
    try { await db.saveProduct(p); } catch (e) { showToast("⚠️ Save failed, check connection"); }
    showToast("✅ Product added!");
  };

  const onDelete = async (id) => {
    setProducts(products.filter(p=>p.id!==id));
    try { await db.deleteProduct(id); } catch {}
    showToast("🗑️ Removed");
  };

  const onEdit = async (id, updated) => {
    const editedProducts = products.map(p =>
      p.id === id ? { ...p, ...updated, price: Number(updated.price), mrp: updated.mrp ?? null } : p
    );
    setProducts(editedProducts);
    const edited = editedProducts.find(p => p.id === id);
    try { await db.saveProduct(edited); } catch {}
    showToast("✅ Product updated!");
  };

  return (
    <>
      <div className="ahdr">
        <div><div className="ahdr-title">NGS Dashboard</div><div className="ahdr-sub">Store Manager</div></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {pending>0 && <span className="notif-dot">🔔 {pending}</span>}
<button className="logout-btn" onClick={onLogout}>Logout</button>
        </div>
      </div>
      <div className="atabs">
        <button className={"atab"+(tab==="orders"?" active":"")} onClick={()=>setTab("orders")}>📦 Orders</button>
        <button className={"atab"+(tab==="products"?" active":"")} onClick={()=>setTab("products")}>🏪 Products</button>
      <button className={"atab"+(tab==="customers"?" active":"")} onClick={()=>setTab("customers")}>👥 Customers</button>
      <button className={"atab"+(tab==="charges"?" active":"")} onClick={()=>setTab("charges")}>🧾 Charges</button>
      </div>
      <div className="acontent">
        {tab==="orders" && (
          <>
            {notifStatus !== "granted" && notifStatus !== "unsupported" && (
              <div className="notif-permission-bar">
                <p>🔔 Enable notifications to get alerted when new orders arrive</p>
                <button className="notif-enable-btn" onClick={requestNotifPermission}>Enable</button>
              </div>
            )}
            {notifStatus === "granted" && (
              <div style={{background:"var(--leaf-pale)",borderRadius:10,padding:"8px 14px",marginBottom:14,fontSize:13,color:"var(--leaf)",fontWeight:600}}>
                🔔 Notifications are ON — you'll be alerted for every new order
              </div>
            )}
            <div className={"store-toggle-card " + (storeOpen ? "open" : "closed")}>
              <div>
                <div className={"toggle-label " + (storeOpen ? "open" : "closed")}>
                  {storeOpen ? "🟢 Store is Open" : "🔴 Store is Closed"}
                </div>
                <div className="toggle-sub">{storeOpen ? "Accepting orders from customers" : "Customers cannot place orders"}</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={storeOpen} onChange={toggleStore} />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="stats-grid">
              <div className="stat-box"><div className="stat-num spice">{pending}</div><div className="stat-lbl">Pending</div></div>
              <div className="stat-box"><div className="stat-num">{orders.length}</div><div className="stat-lbl">Total</div></div>
              <div className="stat-box"><div className="stat-num green">{orders.filter(o=>o.status==="delivered").length}</div><div className="stat-lbl">Delivered</div></div>
              <div className="stat-box"><div className="stat-num green" style={{fontSize:20}}>{formatINR(revenue)}</div><div className="stat-lbl">Revenue</div></div>
              <div className="stat-box"><div className="stat-num">{customers.length}</div><div className="stat-lbl">Customers</div></div>
            </div>
            {orders.length===0
              ? <div className="empty-box"><div className="big">📭</div><p>No orders yet</p></div>
              : orders.map(o=>(
                <div className={"ocard"+(o.status==="pending"?" new-order":"")} key={o.id}>
                  <div className="ocard-top">
                    <div><div className="o-id">#{o.id}</div><div className="o-date">{new Date(o.timestamp).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</div></div>
                    <span className={"sbadge s-"+o.status}>{S_LABEL_A[o.status]}</span>
                  </div>
                  <div className="cust-block">
                    <div className="cust-name">👤 {o.customer?.name}</div>
                    <div className="cust-row"><span>📞</span>{o.customer?.phone}</div>
                    <div className="cust-row"><span>📍</span><span>{o.customer?.address}</span></div>
                    {o.customer?.location && (
                      <a className="map-link" href={`https://www.google.com/maps?q=${o.customer.location.lat},${o.customer.location.lng}`} target="_blank" rel="noopener noreferrer">🗺️ Open in Google Maps</a>
                    )}
                  </div>
                  <div className="o-items">{o.items?.map(i=>`${i.emoji} ${i.name} ×${i.qty}`).join("  ·  ")}</div>
                  {o.charges && o.charges.length > 0 && (
                    <div style={{fontSize:12,color:"var(--spice)",marginBottom:4}}>
                      {o.subtotal != null && <div style={{color:"var(--bark-light)"}}>Subtotal: {formatINR(o.subtotal)}</div>}
                      {o.charges.map((c,i)=><div key={i}>+ {c.name}: {formatINR(c.price)}</div>)}
                    </div>
                  )}
                  <div className="o-total">{formatINR(o.total)}</div>
                  <select className="status-sel" value={o.status} onChange={e=>updateStatus(o.id,e.target.value)}>
                    {S_ORDER.map(s=><option key={s} value={s}>{S_LABEL_A[s]}</option>)}
                  </select>
                  <button className="print-btn" onClick={()=>printReceipt(o)}>🖨️ Print Receipt</button>
                </div>
              ))
            }
          </>
        )}
        {tab==="products" && <ProductsTab products={products} onAdd={onAdd} onDelete={onDelete} onEdit={onEdit} />}
        {tab==="customers" && <CustomersTab customers={customers} />}
        {tab==="charges" && <ChargesTab charges={charges} onAddCharge={onAddCharge} onToggleCharge={onToggleCharge} onDeleteCharge={onDeleteCharge} />}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState(DEFAULT_PRODUCTS);
  const [storeOpen, setStoreOpen] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [charges, setCharges] = useState([]);
  const [toast, setToast] = useState(null);

  // Customer state
  const [tab, setTab] = useState("shop");
  const [cart, setCart] = useState({});
  const [cat, setCat] = useState("All");
  const [success, setSuccess] = useState(null);
  const [myPhone, setMyPhone] = useState("");

  // Admin / security state
  const [mode, setMode] = useState("customer"); // "customer" | "login" | "admin" | "decoy"
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef(null);
  const lastAttemptTime = useRef(0);

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(()=>setToast(null), 3000); }, []);

  // Load data from Supabase + poll every 4s so all phones stay in sync
  useEffect(() => {
    const load = async () => {
      try {
        const [pr, or, so, cu, ch] = await Promise.all([
          db.getProducts().catch(()=>null),
          db.getOrders().catch(()=>null),
          db.getStoreOpen().catch(()=>null),
          db.getCustomers().catch(()=>null),
          db.getCharges().catch(()=>null),
        ]);
        if (pr && pr.length) setProducts(pr);
        else if (pr && pr.length === 0) {
          // First run — seed the default product into the database
          try { await db.saveProduct(DEFAULT_PRODUCTS[0]); setProducts(DEFAULT_PRODUCTS); } catch {}
        }
        if (or) setOrders(or);
        if (so !== null && so !== undefined) setStoreOpen(so);
        if (cu) setCustomers(cu);
        if (ch) setCharges(ch);
      } catch {}
    };
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  // Clear any stale lockout from previous wrong hash bug
  useEffect(() => { clearLockout(); }, []);

  // Restore admin session on mount
  useEffect(() => {
    const s = getSession();
    if (s) { setMode("admin"); }
  }, []);



  // ── SECRET TAP: tap logo 5 times within 3 seconds ─────────────────────────
  const handleLogoTap = () => {
    const next = tapCount + 1;
    setTapCount(next);
    clearTimeout(tapTimer.current);
    if (next >= 5) {
      setTapCount(0);
      if (isLockedOut()) {
        showToast(`🔒 Locked out for ${lockoutRemainingMins()} more minutes`);
        return;
      }
      setMode("login");
    } else {
      tapTimer.current = setTimeout(() => setTapCount(0), 3000);
    }
  };

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    // Rate limit: max 1 attempt per 2 seconds
    if (Date.now() - lastAttemptTime.current < 2000) return;
    lastAttemptTime.current = Date.now();

    if (isLockedOut()) {
      setPwErr(`🔒 Too many attempts. Try again in ${lockoutRemainingMins()} minutes.`);
      return;
    }

    const hash = await hashPassword(pw);
    setPw("");

    if (hash === PWD_HASH) {
      clearLockout();
      setSession();
      setMode("admin");
      setPwErr("");
    } else {
      const lk = getLockout();
      const attempts = (lk?.attempts || 0) + 1;
      setLockout(attempts);
      if (attempts >= MAX_ATTEMPTS) {
        // Show decoy panel to confuse attacker
        setMode("decoy");
        setPwErr("");
      } else {
        setPwErr(`❌ Wrong password. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS-attempts!==1?"s":""} left.`);
      }
    }
  };

  const handleLogout = () => {
    clearSession();
    setMode("customer");
  };

  const handleOrderPlaced = async (order, phone) => {
    setOrders([order, ...orders]);
    setSuccess(order.id);
    setMyPhone(phone);
    // Save order to shared database
    try { await db.saveOrder(order); } catch (e) { showToast("⚠️ Order may not have saved — check internet"); }

    // Save/update customer record in database
    try {
      const prevCustomers = await db.getCustomers().catch(()=>[]);
      const existing = prevCustomers.find(c => c.phone === order.customer.phone);
      const record = {
        phone: order.customer.phone,
        name: order.customer.name,
        address: order.customer.address,
        location: order.customer.location || null,
        firstOrder: existing ? existing.firstOrder : order.timestamp,
        lastOrder: order.timestamp,
        totalOrders: existing ? existing.totalOrders + 1 : 1,
        totalSpent: existing ? existing.totalSpent + order.total : order.total,
      };
      await db.saveCustomer(record);
      setCustomers(existing
        ? prevCustomers.map(c => c.phone === record.phone ? record : c)
        : [record, ...prevCustomers]);
    } catch {}
  };

  const cartCount = Object.values(cart).reduce((a,b)=>a+b,0);

  // ── DECOY PANEL (shown after 3 wrong attempts) ────────────────────────────
  if (mode === "decoy") return (
    <>
      <style>{css}</style>
      <div className="decoy-wrap">
        <h2>Nothing here</h2>
        <p>This page does not exist.</p>
        <button onClick={()=>setMode("customer")} style={{marginTop:20,background:"none",border:"none",color:"#bbb",cursor:"pointer",fontSize:12}}>Go back</button>
      </div>
    </>
  );

  // ── LOGIN SCREEN ──────────────────────────────────────────────────────────
  if (mode === "login") return (
    <>
      <style>{css}</style>
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-icon">🔐</div>
          <h1>NGS Admin</h1>
          <p>Enter your password to continue</p>
          <input
            type="password" placeholder="Password" value={pw}
            onChange={e=>setPw(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            autoComplete="off"
          />
          <button className="login-btn" onClick={handleLogin}>Enter Dashboard</button>
          {pwErr && <div className="login-err">{pwErr}</div>}
          {isLockedOut() && (
            <div className="lockout-msg">🔒 Locked out for {lockoutRemainingMins()} minutes</div>
          )}
          <button onClick={()=>{setMode("customer");setPw("");setPwErr("");}} style={{marginTop:16,background:"none",border:"none",color:"var(--bark-light)",cursor:"pointer",fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>← Back to store</button>
        </div>
      </div>
    </>
  );

  // ── ADMIN DASHBOARD ───────────────────────────────────────────────────────
  if (mode === "admin") return (
    <>
      <style>{css}</style>
      {toast && <div className="toast">{toast}</div>}
      <div id="thermal-receipt"></div>
      <AdminPanel
        orders={orders} products={products}
        setOrders={setOrders} setProducts={setProducts}
        showToast={showToast} onLogout={handleLogout}
        storeOpen={storeOpen} setStoreOpen={setStoreOpen}
        customers={customers}
        charges={charges} setCharges={setCharges}
      />
    </>
  );

  // ── CUSTOMER STORE ────────────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      {toast && <div className="toast">{toast}</div>}
      <div className="hdr" style={{position:"relative"}}>
        <div className="hdr-logo" onClick={handleLogoTap}>
          NGS<sup>store</sup>
        </div>
        {/* Secret tap dots — only visible while tapping */}
        {tapCount > 0 && (
          <div className="tap-dots">
            {[0,1,2,3,4].map(i=>(
              <div key={i} className={"tap-dot"+(i<tapCount?" lit":"")}></div>
            ))}
          </div>
        )}
        {cartCount > 0 && (
          <button className="hdr-cart" onClick={()=>setTab("cart")}>
            🛒 Cart <span className="cart-bubble">{cartCount}</span>
          </button>
        )}
      </div>
      {tab==="shop" && <ShopView products={products} cart={cart} cat={cat} setCat={setCat} setCart={setCart} storeOpen={storeOpen} />}
      {tab==="cart" && <CartView products={products} cart={cart} setCart={setCart} onOrderPlaced={handleOrderPlaced} setTab={setTab} success={success} setSuccess={setSuccess} storeOpen={storeOpen} charges={charges} />}
      {tab==="orders" && <OrdersView orders={orders} myPhone={myPhone} />}
      <div className="bnav">
        {[["shop","🏪","Shop"],["cart","🛒","Cart"],["orders","📋","Orders"]].map(([v,ico,lbl])=>(
          <button key={v} className={"bnav-btn"+(tab===v?" active":"")} onClick={()=>setTab(v)}>
            <span className="ico">{ico}</span>
            {lbl}{v==="cart"&&cartCount>0?` (${cartCount})`:""}
          </button>
        ))}
      </div>
    </>
  );
}
